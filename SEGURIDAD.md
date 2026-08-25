# Seguridad — las tres capas

Esta app corre **sólo** dentro de un iframe de monday.com y comparte usuarios, lista blanca y
enrolamientos de segundo factor con la app de **operaciones de venta**. La implementación es la
misma: quien ya se enroló allá entra acá sin volver a escanear nada.

Las tres capas contestan preguntas distintas:

| Capa | Pregunta | Se puede falsificar |
| --- | --- | --- |
| 1 · El portero | ¿De **dónde** viene el pedido? | Sí, por un cliente que no sea un navegador |
| 2 · Firma + lista blanca | ¿**Quién** lo firma, y está habilitado? | No |
| 3 · Segundo factor | ¿Esa persona **tiene su teléfono**? | No |

---

# Capa 1 — "El Portero"

Hace cumplir desde el borde (Vercel), antes de que la petición llegue al código, que la app sólo
funcione embebida en Monday. No autentica usuarios.

| Archivo | Qué hace |
| --- | --- |
| [vercel.json](vercel.json) | Cabeceras de seguridad en todas las rutas + fallback SPA de Vite |
| [middleware.ts](middleware.ts) | Valida la procedencia (`Referer`) de las rutas caras; 403 si no cierra |
| [tests/portero-referer.test.ts](tests/portero-referer.test.ts) | Fija la comparación por sufijo (`npm run test:portero`) |

### Cabeceras (`vercel.json`)

- `Content-Security-Policy: frame-ancestors https://*.monday.com https://*.monday.app;` — sólo
  Monday puede embeber la app. Es lo que corta el **clickjacking**: cualquier otra página que la
  ponga en un iframe recibe un frame en blanco. Se prefiere a `X-Frame-Options` porque `ALLOW-FROM`
  está deprecado y `SAMEORIGIN` rompería el iframe.
- `X-Content-Type-Options: nosniff` — el navegador no adivina tipos; nada servido como texto se
  ejecuta como script.
- `Referrer-Policy: strict-origin-when-cross-origin` — hacia afuera sólo viaja el origen, nunca la
  URL completa con `boardId`/`itemId`. Hacia adentro (mismo origen) sigue viajando entera, que es
  justo lo que el middleware necesita para trabajar.
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` — dos años de https
  obligatorio, sin primera visita en claro.

El bloque `git.deploymentEnabled` que ya estaba se conservó: sólo `main` genera despliegues.

### Portero de la API (`middleware.ts`)

Protege las rutas que gastan un recurso del servidor: `/api/monday` y `/api/monday-upload` (que
usan `MONDAY_TOKEN`), `/api/make-comprobantes` (que consume operaciones de la cuenta de Make),
`/api/usuario` y `/api/mfa/*`. Deja pasar si el `Referer`:

1. es el **host propio del deploy** (la app pegándose a sí misma desde adentro del iframe — el
   tráfico normal, porque el bundle se sirve desde Vercel, no desde Monday); o
2. es **https** y su `new URL(referer).hostname` termina en `.monday.com` / `.monday.app`, o es el
   dominio pelado.

Cualquier otra cosa —o la falta de `Referer`— es **403**. La comparación es por sufijo con el punto
incluido, nunca `.includes()`: `monday.com.sitio-malicioso.net` y `falsomonday.com` quedan afuera.

**Alcance real:** un `Referer` lo puede inventar cualquier cliente que no sea un navegador (`curl`).
Esta regla frena el acceso casual, el embebido ajeno y los scripts que peguen desde otro sitio; el
control que no se puede falsificar llega con la Capa 2 y con el WAF de acá abajo.

## Pasos manuales en el panel de Vercel (WAF / Firewall)

Panel → proyecto `registrar-cobros-recibos` → pestaña **Firewall** → **Configure**.

### 1. Rate limiting global (anti-saturación)

1. **Firewall → Custom Rules → New Rule**. Nombre: `rate-limit-global`.
2. Condición: `Request Path` → `starts with` → `/`.
3. Acción: **Rate Limit**.
4. Límite: **200 peticiones / 60 s**, agrupadas por **IP Address**.
5. Al superarlo: **Deny** (403), ventana de bloqueo **60 s**.
6. **Save** y luego **Publish** (los cambios del firewall no aplican hasta publicarlos).

> Referencia para ajustar: registrar un cobro con varios movimientos y emitir el recibo dispara
> varias decenas de llamadas a `/api/monday` en pocos segundos. Arrancá en 200/min, mirá
> **Firewall → Observability** una semana y bajalo si sobra margen.

### 2. Límite estricto del endpoint del código de 6 dígitos

1. **New Rule**. Nombre: `rate-limit-codigo`.
2. Condición: `Request Path` → `starts with` → `/api/mfa/`
   **AND** `Request Method` → `equals` → `POST`.
3. Acción: **Rate Limit**.
4. Límite: **5 peticiones / 900 s** (15 minutos), agrupadas por **IP Address**.
   Si se puede agrupar también por el header `X-Device-Token`, mejor: es lo que impide que una sola
   IP pruebe códigos contra muchas cuentas.
5. Al superarlo: **Deny**, ventana de bloqueo **900 s**.
6. Ordená esta regla **por encima** de `rate-limit-global` (las reglas evalúan de arriba hacia
   abajo y gana la primera que matchea).
7. **Save** → **Publish**.

Esto **duplica** el límite que ya vive en la base (cinco fallos cada quince minutos por usuario, ver
Capa 3) y es a propósito: el de la base cuenta por persona y no frena a quien prueba contra muchas;
el del WAF cuenta por IP y no frena a quien tiene muchas. Los dos juntos cierran las dos puertas.

### 3. Complementos recomendados (una sola vez)

- **Attack Challenge Mode**: dejarlo *off* en operación normal; encenderlo si aparece un pico de
  tráfico raro. Mete un challenge del navegador que el iframe de Monday resuelve solo.
- **Bot Filter / managed rules**: activar el bloqueo de bots maliciosos conocidos.
- **Firewall → Observability**: revisar semanalmente los 403 con la cabecera `x-portero`; ahí se ve
  si alguien está golpeando `/api/monday` desde afuera.

---

# Capa 2 — autenticación criptográfica y lista blanca

La Capa 1 mira DE DÓNDE viene el pedido. Esta mira QUIÉN lo hace, y no se puede falsificar: el
navegador manda un token que firmó Monday, y el servidor verifica esa firma con un secreto que nunca
sale del deploy.

## El recorrido de un pedido

1. El iframe le pide a Monday el **session token** del usuario ([src/lib/mondayAuth.ts](src/lib/mondayAuth.ts)),
   lo cachea en memoria y lo manda en `Authorization: Bearer <jwt>`
   ([src/services/monday/sdk.ts](src/services/monday/sdk.ts)).
2. La Edge Middleware (Capa 1) revisa la procedencia.
3. [api/_guard.ts](api/_guard.ts) verifica la **firma** con `MONDAY_CLIENT_SECRET` —y si no cierra,
   reintenta con `MONDAY_SIGNING_SECRET`—, fijando `algorithms: ['HS256']`, y saca `user_id`,
   `account_id`, `is_admin` y `app_id`.
4. [api/_whitelist.ts](api/_whitelist.ts) consulta el **tablero privado** y exige el estado activo
   **y** el ID de esta app declarado.
5. [api/_mfa.ts](api/_mfa.ts) exige el segundo factor (Capa 3).
6. Recién ahí el endpoint usa `MONDAY_TOKEN` y habla con la API de Monday.

Rechazos: **401** si no se puede probar quién es (falta el token, está vencido, la firma no cierra);
**403** si se sabe quién es pero no corresponde (cuenta ajena, fuera de la lista, sin segundo
factor). Hacia afuera van sólo `Unauthorized` / `Forbidden`: el motivo queda en el log del servidor,
porque contarle al que prueba si el usuario existe en el tablero es entregarle la mitad del trabajo.

## Decisiones que conviene conocer

- **`jwt.verify`, nunca `jwt.decode`.** Decodificar es leer un papel sin mirar el sello. Y el
  algoritmo va fijado a HS256: sin esa lista, un token con `alg: none` y la firma vacía entra como
  si fuera legítimo. Los dos casos están cubiertos por [tests/guard-sesion.test.ts](tests/guard-sesion.test.ts).
- **Dos claves posibles, un solo intento de rescate.** Monday firma el session token con el
  **Client Secret** —su ejemplo es literalmente `jwt.verify(token, MY_CLIENT_SECRET)`—, y algunas
  configuraciones usan el *Signing Secret*. Son dos secretos privados de la misma app: aceptar
  cualquiera de los dos prueba el origen igual de bien. Un token **vencido** corta el reintento
  —la firma cerró, el problema es otro— para que el log diga "vencido" y no "firma inválida".
- **La lista blanca se consulta en el backend, siempre.** Si la consulta viviera en el frontend, el
  usuario se estaría respondiendo que sí a sí mismo.
- **El tablero es privado** para que el propio usuario no pueda editar la lista que lo habilita.
- **El permiso es POR APP y explícito.** Las dos apps comparten el tablero; una celda vacía en
  "ID APP" no significa "todas", porque si lo significara, dar de alta a alguien en cobros le
  abriría la puerta de operaciones de venta sin que nadie lo decidiera.
- **Falla cerrada.** Si Monday no contesta, no entra nadie. El fallo no se cachea, así que la app
  vuelve sola en cuanto la API responde.
- **Caché de 5 min para los "sí"** (es el techo de lo que tarda una revocación en hacerse efectiva) y
  **30 s para los "no"** (un alta recién hecha entra enseguida). Es por instancia de la función: es
  un ahorro de cuota, no una fuente de verdad.
- **La identidad no sale de `me`.** `me` viaja por el proxy, que inyecta el token del SERVIDOR: con
  una sola cuenta de servicio, contesta quién es el dueño de ese token y no quién abrió la app —y la
  app le daba a todos el rol de esa persona—. Quién es el usuario sale de `/api/usuario`, que lo lee
  del session token ya verificado.
- **Los endpoints corren en Node, no en edge.** `jsonwebtoken` necesita `crypto` y `Buffer`. Y en
  Node, Vercel invoca al `export default` con los objetos de `node:http`, así que la firma es
  `(req, res)` — con la firma web da `FUNCTION_INVOCATION_FAILED`. Por eso `api/monday.ts` y
  `api/monday-upload.ts` dejaron de declarar `runtime: 'edge'`.

## Puesta en marcha (pasos manuales)

### 1. Tablero "Lista Blanca" (id `18427866249`) — ya existe

Es el mismo que usa operaciones de venta. Tablero **privado**, con cuatro columnas que importan:

| Columna | Id | Para qué |
| --- | --- | --- |
| Name | `name` | el nombre de la persona, para leerlo de un vistazo |
| User ID | `text_mm6hqsmt` | **la que decide**: el id numérico del usuario en Monday |
| Estado | `status` | `Activo` habilita; cualquier otra etiqueta (`Inactivo`) deja afuera |
| ID APP | `dropdown_mm6jamkm` | **los IDs de las apps que esa persona puede usar** |

**Lo único que hay que hacer para esta app:** agregar el **App ID de la app de cobros** como
etiqueta nueva del dropdown "ID APP", y tildarlo en la fila de cada persona que tenga que entrar
acá. Estar `Activo` no alcanza: sin el ID declarado, no entra.

- **Dar de alta:** fila nueva con el nombre, el User ID, el estado en `Activo` **y el ID de esta app
  en "ID APP"**. Entra en menos de 30 s (es lo que dura un "no" en caché).
- **Dar de baja:** cambiar el estado a `Inactivo`, o destildar el ID de esta app si sólo hay que
  sacarlo de acá. Queda afuera en hasta 5 minutos, sin tocar código ni redeployar.
- El User ID de cualquier persona sale de monday.com → su perfil → el número en la URL.

### 2. App de Monday

monday.com → Developers → **la app que embebe la vista de cobros** → **Basic Information** → copiá
el **Client Secret** (y de paso el Signing Secret, que va como rescate). De la misma pantalla sale
el **App ID**, que es el que va en la columna "ID APP" del tablero.

**Cuál app importa.** El session token lleva su `app_id` adentro: con el secreto de otra app la
firma no cierra nunca, y el síntoma es un 401 idéntico al de un usuario sin permisos. Ante la duda,
el log del servidor dice `token inválido (app NNN)` y ese número tiene que ser el App ID del
Developer Center. **No sirve el secreto de la app de operaciones de venta**: son dos apps distintas
con dos secretos distintos, aunque compartan usuarios y base.

### 3. Probar en local

**En `npm run dev` no te rechaza nada, y es a propósito.** En desarrollo la app no toca `/api/*`:
pega contra el proxy de Vite (`/monday-api`) con el token personal de `.env.local`. Las funciones
serverless no corren, el middleware es de Vercel, y el guardián vive adentro de esas funciones. Las
tres capas simplemente no existen en localhost.

La contracara: **el desarrollo diario nunca ejercita las capas**, así que un error de configuración
recién aparece en el deploy. Por eso los tests de abajo no son opcionales, y conviene abrir un
Preview antes de tocar producción.

Si querés ejercitarlas igual: `vercel dev` con las variables cargadas y un JWT firmado a mano con el
mismo secreto —es lo que hace `test:guard`—:

```bash
node -e "console.log(require('jsonwebtoken').sign({dat:{user_id:107870718,account_id:35883216,app_id:'<APP_ID>',is_guest:false}}, process.env.MONDAY_CLIENT_SECRET, {expiresIn:'5m'}))"

curl -X POST http://localhost:3000/api/monday -H "Authorization: Bearer <el-token>" -H "Content-Type: application/json" -d "{\"query\":\"{ me { id } }\"}"
```

Cambiá el estado de la fila a `Inactivo` y la misma llamada tiene que pasar de 200 a 403.

---

# Capa 3 — segundo factor (TOTP) y dispositivos de la jornada

Las capas 1 y 2 prueban de dónde viene el pedido y quién lo firma. Esta prueba que la persona tiene
su teléfono, y es la única que sobrevive a que a alguien le roben la sesión de Monday.

**Estado: completa (backend + muro visual) y APAGADA hasta cargar sus variables.** Con
`MFA_REQUERIDO` sin encender, el guardián no la exige y la app funciona como hasta ahora.

## Piezas

| Archivo | Qué hace |
| --- | --- |
| [db/mfa.sql](db/mfa.sql) | Las cuatro tablas. Ya están creadas en la Neon compartida |
| [api/_db.ts](api/_db.ts) | Pool de Postgres, una conexión por instancia |
| [api/_mfaStore.ts](api/_mfaStore.ts) | Persistencia detrás de una interfaz (los tests usan una en memoria) |
| [api/_mfa.ts](api/_mfa.ts) | Cifrado, TOTP, códigos de recuperación, límite de intentos, dispositivos |
| [api/mfa/setup.ts](api/mfa/setup.ts) | `POST` · devuelve el QR y deja el secreto pendiente |
| [api/mfa/confirm.ts](api/mfa/confirm.ts) | `POST` · primer código; activa y entrega 10 códigos de recuperación |
| [api/mfa/verify.ts](api/mfa/verify.ts) | `POST` · verificación diaria; emite el dispositivo |
| [api/mfa/status.ts](api/mfa/status.ts) | `POST` · qué pantalla mostrar |
| [src/lib/deviceToken.ts](src/lib/deviceToken.ts) | El token en `localStorage`, con respaldo en memoria |
| [src/services/mfa.ts](src/services/mfa.ts) | Cliente de los cuatro endpoints |
| [src/components/ui/MfaGuard.tsx](src/components/ui/MfaGuard.tsx) | El muro: QR, códigos de rescate y verificación diaria |
| [tests/mfa.test.ts](tests/mfa.test.ts) | `npm run test:mfa` |

## Decisiones que conviene conocer

- **El secreto TOTP se guarda cifrado** (AES-256-GCM, clave en el entorno del deploy). Una base
  filtrada, sin esa clave, no alcanza para generar códigos. GCM y no CBC porque además de ocultar
  autentica: un secreto editado en la base falla al descifrarse en vez de devolver basura.
- **Los códigos de recuperación y los tokens de dispositivo se guardan hasheados** (HMAC-SHA256 con
  la clave de pimienta). No hace falta un KDF lento: son secretos de alta entropía generados por
  nosotros, no contraseñas elegidas por una persona.
- **Un código no se puede usar dos veces.** Se guarda el time step de cada verificación y se rechaza
  cualquier código de ese paso o anterior. Sin esto, un código sigue sirviendo los segundos que le
  quedan de vida: suficiente para que alguien que lo vio por encima del hombro lo repita.
- **La tolerancia es de ±30 s**, un período para cada lado (`epochTolerance: 30` en otplib 13).
- **El límite de intentos vive en la base, no en memoria.** Cinco fallos cada quince minutos por
  usuario. En serverless un contador en memoria no limita nada: cada instancia arranca con el suyo
  en cero. Corta ANTES de mirar el código, así que ni uno correcto pasa — si pasara, el propio
  límite le diría al atacante cuándo acertó.
- **Nada de cookies.** La app corre en un iframe servido desde otro dominio: para el navegador es
  contexto de terceros, y Safari bloquea esas cookies desde hace años. El dispositivo viaja en
  `X-Device-Token`, una cabecera que el frontend pone a mano.
- **`localStorage` en un iframe está particionado**, y para esto está bien. Pero el acceso puede
  TIRAR —navegación privada, almacenamiento bloqueado—, así que cada operación va en try/catch con
  respaldo en memoria: la sesión de hoy no se rompe, el usuario tipea el código de nuevo mañana.
- **Re-enrolarse invalida los dispositivos viejos.** Si alguien vuelve a enrolarse porque perdió el
  teléfono, lo último que se quiere es que el equipo del que lo encontró siga entrando.
- **El segundo factor se exige en el guardián**, junto con la firma y la lista blanca. No hay
  endpoint de datos que no pase por ahí, así que no existe la puerta de atrás de pegarle directo a
  `/api/monday`. Los `/api/mfa/*` y `/api/usuario` son la excepción necesaria: piden firma y lista
  blanca, pero no segundo factor.

### Por qué NO hay casilla de "confiar 30 días"

El requerimiento original pedía un checkbox de **"Confiar en este dispositivo por 30 días"**. No
está, y es deliberado: el dispositivo dura **una jornada (12 h)** y el código se pide todos los días.
Tres razones:

1. Es la decisión que ya tomó la app de operaciones de venta, y **las dos comparten la tabla
   `mfa_dispositivos`**. Dos duraciones distintas sobre las mismas filas serían una fuente de
   confusión sin nada a cambio.
2. Doce horas cubren un turno completo: quien entra a la mañana no vuelve a escribir el código hasta
   el día siguiente. El costo real para el usuario es un código por jornada.
3. Un dispositivo de 30 días en un equipo compartido es un segundo factor que dejó de existir
   durante un mes.

Si hiciera falta volver atrás, es un solo número: `HORAS_SESION` en [api/_mfa.ts](api/_mfa.ts) — más
la casilla en el muro y el flag en el cuerpo de `/api/mfa/verify`.

## La secuencia, en tres pasos

[src/App.tsx](src/App.tsx) es una máquina de estados y no dibuja nada de la operación hasta superar
los tres:

1. **Lista blanca.** Se pide el `sessionToken` a Monday y se consulta `/api/usuario`, que verifica la
   firma y busca al usuario en el tablero privado. Este endpoint **no** exige segundo factor, y es a
   propósito: es el paso 1, y exigir el paso 3 acá haría imposible llegar al muro.
2. **Caché del usuario.** El usuario habilitado queda en el estado global (`setUsuarioActual`) con
   sus equipos de Monday, de los que sale el rol —Administrador o Vendedor, ver
   [src/lib/permisos.ts](src/lib/permisos.ts)—. Tiene que pasar antes de dibujar: media app pregunta
   si puede editar tal cosa. Sin equipos legibles queda **Vendedor**, que es el rol más restrictivo.
3. **Muro del segundo factor.** Se renderiza únicamente [MfaGuard](src/components/ui/MfaGuard.tsx).
   La app se libera sólo cuando el backend confirma el código y emite el `deviceToken`.

Con un dispositivo vigente el paso 3 no pregunta nada. Si `MFA_REQUERIDO` está apagado, se pasa de
largo y la capa queda inerte.

## El muro (MfaGuard)

- **Primera vez:** llama a `/api/mfa/setup`, muestra el QR (y el secreto en texto por si la cámara no
  coopera), pide el primer código contra `/api/mfa/confirm` y entrega los **diez códigos de rescate**.
  Se ven una sola vez —en la base sólo queda su hash— y hay que tildar "ya los guardé" para seguir.
- **Uso regular:** input de seis dígitos contra `/api/mfa/verify`. El mismo campo acepta un código
  de rescate: quien perdió el teléfono no tiene que buscar otra pantalla.
- Ante el límite de intentos el formulario queda cerrado: reintentar antes de los 15 minutos da el
  mismo rechazo, y un botón habilitado invita a gastar intentos al pedo.
- **Confirmar el alta ya deja entrar.** El servidor emite ahí mismo el dispositivo de la jornada;
  sin eso, quien termina de enrolarse chocaría contra el muro un segundo después.

**Quien ya se enroló en operaciones de venta no ve el QR:** su fila ya está en `mfa_usuarios`, así
que acá le toca directamente el campo de seis dígitos.

## Base de datos (Neon compartida)

La base **ya existe**: es la que creó la app de operaciones de venta desde Vercel → Storage → Neon,
llamada **`La Batea Authenticated Users`**. Compartirla es lo que hace que los enrolamientos valgan
para las dos apps.

1. Vercel → proyecto `registrar-cobros-recibos` → **Storage** → **Connect Store** → elegí la base
   existente **La Batea Authenticated Users**. La integración inyecta sola `DATABASE_URL` /
   `POSTGRES_URL`, y el código acepta cualquiera de las dos.
2. **No hace falta correr el SQL de nuevo**: las tablas ya están. [db/mfa.sql](db/mfa.sql) queda en el
   repo como referencia del esquema y es idempotente (`IF NOT EXISTS`), así que correrlo no rompe
   nada si hiciera falta rearmar el entorno desde cero.
3. Las cuatro tablas: `mfa_usuarios` (secreto TOTP cifrado), `mfa_recuperacion` (códigos hasheados),
   `mfa_dispositivos` (tokens hasheados con vencimiento) y `mfa_intentos` (el límite de velocidad).

---

# Variables de entorno en Vercel

Project → Settings → Environment Variables. **Production y Preview** (Development no hace falta:
localhost no ejercita ninguna capa).

| Variable | Capa | Obligatoria | Valor |
| --- | --- | --- | --- |
| `MONDAY_TOKEN` | — | sí (ya estaba) | token de API con escritura, el que gasta el proxy |
| `MAKE_WEBHOOK_COMPROBANTES` | — | sí (ya estaba) | webhook del escenario de Make |
| `MONDAY_CLIENT_SECRET` | 2 | **sí** | Client Secret de **la app de cobros** (Developers → Basic Information) |
| `MONDAY_SIGNING_SECRET` | 2 | recomendada | Signing Secret de la misma pantalla, como clave de rescate |
| `MONDAY_API_TOKEN` | 2 | recomendada | token de solo lectura sobre el tablero privado; sin ella se usa `MONDAY_TOKEN` |
| `WHITELIST_BOARD_ID` | 2 | **sí** | `18427866249` |
| `MONDAY_ACCOUNT_ID` | 2 | opcional | `35883216` — ata la app a la cuenta |
| `APP_ID` | 2 | opcional | sólo si se etiqueta la app con algo distinto del `app_id` firmado |
| `WHITELIST_COLUMN_USER` · `_STATUS` · `_APPS` · `WHITELIST_STATUS_ACTIVO` | 2 | opcionales | sólo si el tablero se rearma |
| `DATABASE_URL` | 3 | **sí** | la inyecta la integración de Neon al conectar la base compartida |
| `MFA_ENCRYPTION_KEY` | 3 | **sí** | **la MISMA que la de operaciones de venta**, copiada tal cual |
| `MFA_EMISOR` | 3 | opcional | por defecto `La Batea`; conviene dejarlo igual en las dos apps |
| `MFA_REQUERIDO` | 3 | para encender | `1` |

Ninguna lleva prefijo `VITE_`: si lo llevara, Vite la incrustaría en el bundle y dejaría de ser un
secreto.

## Orden de encendido

Al revés, el primero que queda afuera sos vos:

1. Cargar `MONDAY_CLIENT_SECRET` (+ `MONDAY_SIGNING_SECRET`), `MONDAY_API_TOKEN` y
   `WHITELIST_BOARD_ID` → **redeploy**.
2. Agregar el App ID de esta app a la columna "ID APP" del tablero, en la fila de cada persona.
3. Verificar que se entra desde Monday y que `curl` a `/api/monday` sin token da 401.
4. Conectar la base Neon compartida (`DATABASE_URL`) y copiar `MFA_ENCRYPTION_KEY` desde el otro
   proyecto → **redeploy**.
5. Recién ahí `MFA_REQUERIDO=1` → **otro redeploy**.

> Si se pierde `MFA_ENCRYPTION_KEY` se pierden todos los enrolamientos **de las dos apps**: hay que
> volver a enrolar a todo el mundo.

---

# Verificación

```bash
npm run test:seguridad   # las cuatro de abajo, en orden
npm run test:portero     # Capa 1: procedencia por sufijo de dominio
npm run test:guard       # Capa 2: firma, alg:none, vencido, cuenta ajena
npm run test:whitelist   # Capa 2: activo / no activo / ausente, permiso por app, caché, falla cerrada
npm run test:mfa         # Capa 3: reutilización, límite de intentos, códigos de rescate, dispositivos
npm run typecheck        # frontend + middleware.ts
npm run typecheck:api    # las funciones serverless de /api
```

Y en el deploy: entrar desde Monday tiene que andar; pegarle a `/api/monday` con `curl` (sin token
o con uno inventado) tiene que devolver 401, y sin `Referer` de Monday, 403.
