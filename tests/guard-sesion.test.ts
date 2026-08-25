/**
 * El guardián criptográfico (Capa 2) sólo acepta tokens que Monday firmó de verdad.
 *
 * Los casos que importan no son los felices sino los tres engaños clásicos contra un JWT:
 *  · firmarlo con otro secreto (el atacante inventa el token entero),
 *  · mandarlo con `alg: none` y la firma vacía (la librería que no fija algoritmos lo acepta),
 *  · seguir usando uno vencido.
 * Los tres tienen que dar 401. A eso se suman las reglas de negocio: el invitado externo y la
 * cuenta ajena dan 403, y hacia afuera ningún mensaje cuenta cuál de todas fue.
 *
 * Se corre con esbuild + node (`npm run test:guard`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'
import { ErrorAuth, verificarSesion } from '../api/_guard'

const SECRETO = 'secreto-de-prueba-de-la-app'
process.env.MONDAY_SIGNING_SECRET = SECRETO
delete process.env.MONDAY_ACCOUNT_ID

/** Un session token como el que arma Monday: los datos del usuario viajan adentro de `dat`. */
function firmar(dat: Record<string, unknown>, opciones: jwt.SignOptions = {}, secreto = SECRETO) {
  return jwt.sign({ dat }, secreto, { expiresIn: '5m', ...opciones })
}

const base = { user_id: 107870718, account_id: 35883216, is_guest: false }

/** Corre `verificarSesion` y devuelve el status del rechazo, o 'ok' si dejó pasar. */
function status(authorization: string | undefined): number | 'ok' {
  try {
    verificarSesion(authorization)
    return 'ok'
  } catch (e) {
    assert.ok(e instanceof ErrorAuth, `esperaba ErrorAuth y vino ${String(e)}`)
    return e.status
  }
}

// --- Lo que tiene que pasar ---------------------------------------------------------------------
const sesion = verificarSesion(`Bearer ${firmar(base)}`)
assert.deepEqual(sesion, {
  userId: '107870718',
  accountId: '35883216',
  isGuest: false,
  isAdmin: false,
  appId: '',
})

/* De qué app es el token. Sale firmado, así que la lista blanca puede dar permiso POR APP sin que
   nadie pueda decir que viene de otra: cada app de Monday firma con su propio secreto. */
assert.equal(
  verificarSesion(`Bearer ${firmar({ ...base, app_id: 11968092 })}`).appId,
  '11968092',
  'el token declara de qué app viene',
)

/* `is_admin` sale del token FIRMADO, no de una consulta. Es lo que define el rol en la app, y
   tomarlo de `me` a través del proxy daba el rol del dueño del token del servidor: con una sola
   cuenta de servicio, todos heredaban su permiso. */
assert.equal(
  verificarSesion(`Bearer ${firmar({ ...base, is_admin: true })}`).isAdmin,
  true,
  'el token declara al admin de la cuenta',
)
assert.equal(
  verificarSesion(`Bearer ${firmar(base)}`).isAdmin,
  false,
  'sin la marca en el token, no es admin',
)

// Los ids se normalizan a texto vengan como vengan.
assert.equal(verificarSesion(`Bearer ${firmar({ ...base, user_id: '107870718' })}`).userId, '107870718')

// Algunos tokens de la plataforma traen los datos en la raíz y no en `dat`.
const raiz = jwt.sign({ userId: 5, accountId: 9, isGuest: false }, SECRETO, { expiresIn: '5m' })
assert.equal(verificarSesion(`Bearer ${raiz}`).userId, '5')

// El prefijo Bearer no distingue mayúsculas, y sin prefijo también se acepta.
assert.equal(status(`bearer ${firmar(base)}`), 'ok')
assert.equal(status(firmar(base)), 'ok')

// --- 401: no se puede probar quién es ------------------------------------------------------------
assert.equal(status(undefined), 401, 'sin Authorization')
assert.equal(status('Bearer '), 401, 'Authorization vacía')
assert.equal(status('Bearer no-es-un-jwt'), 401, 'no es un JWT')
assert.equal(status(`Bearer ${firmar(base, {}, 'otro-secreto')}`), 401, 'firmado con otro secreto')
assert.equal(status(`Bearer ${firmar(base, { expiresIn: -60 })}`), 401, 'vencido')

/* `alg: none` con la firma vacía: el token dice "no hace falta verificarme". Una librería sin la
   lista de algoritmos lo da por bueno y el atacante escribe el payload que quiera. */
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
const sinAlgoritmo = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ dat: base })}.`
assert.equal(status(`Bearer ${sinAlgoritmo}`), 401, 'alg: none')

// El token no dice quién es.
assert.equal(status(`Bearer ${firmar({ is_guest: false })}`), 401, 'sin user_id / account_id')

// Sin ningún secreto configurado la app queda CERRADA, no abierta.
delete process.env.MONDAY_SIGNING_SECRET
assert.equal(status(`Bearer ${firmar(base)}`), 401, 'servidor sin secretos')
process.env.MONDAY_SIGNING_SECRET = SECRETO

// --- El rescate con el Client Secret ------------------------------------------------------------
/* Monday documenta el CLIENT SECRET como la clave del session token: su ejemplo es literalmente
   `jwt.verify(token, MY_CLIENT_SECRET)`. El Signing Secret queda como rescate porque algunas
   configuraciones usan ése. Los dos son secretos privados de la misma app, así que aceptar
   cualquiera prueba el origen igual de bien y evita un 401 sistémico por haber cargado uno solo.
   Este test existe porque cargar el que no era costó una tarde de diagnóstico. */
const CLIENTE = 'client-secret-de-prueba'
process.env.MONDAY_CLIENT_SECRET = CLIENTE

assert.equal(status(`Bearer ${firmar(base)}`), 'ok', 'firmado con el Signing Secret')
assert.equal(status(`Bearer ${firmar(base, {}, CLIENTE)}`), 'ok', 'firmado con el Client Secret')
assert.equal(
  status(`Bearer ${firmar(base, {}, 'un-tercer-secreto')}`),
  401,
  'ninguna de las dos claves cierra',
)

// Con el Signing Secret sin cargar, el Client Secret solo alcanza.
delete process.env.MONDAY_SIGNING_SECRET
assert.equal(status(`Bearer ${firmar(base, {}, CLIENTE)}`), 'ok', 'sólo Client Secret configurado')
process.env.MONDAY_SIGNING_SECRET = SECRETO

/* Un token vencido corta el reintento: la firma cerró, el problema es otro. El motivo del log
   tiene que decir eso y no "firma inválida", que es lo que diría la segunda clave. */
const vencido = (() => {
  try {
    /* Firmado con la PRIMERA clave que se prueba: así el vencimiento es lo primero que
       aparece, que es la situación que este test quiere fijar. */
    verificarSesion(`Bearer ${firmar(base, { expiresIn: -60 }, CLIENTE)}`)
  } catch (e) {
    return e as ErrorAuth
  }
  throw new Error('debería haber rechazado')
})()
assert.equal(vencido.status, 401)
assert.match(vencido.motivo, /expired/, 'el log dice que venció')
assert.doesNotMatch(
  vencido.motivo,
  /MONDAY_SIGNING_SECRET/,
  'no llegó a probar la segunda clave',
)

delete process.env.MONDAY_CLIENT_SECRET

// --- 403: la firma cierra, pero no corresponde ---------------------------------------------------
/* Ser INVITADO de Monday no decide nada acá, y es deliberado: quién entra lo resuelve la lista
   blanca, que es un permiso explícito en un tablero privado. Hubo una regla que los rechazaba de
   plano y contradecía a esa lista —un flag implícito anulaba una autorización explícita, con un
   rechazo que además se veía igual que "no estás en la lista"—. */
assert.equal(status(`Bearer ${firmar({ ...base, is_guest: true })}`), 'ok', 'el invitado pasa el guardián')
assert.equal(
  verificarSesion(`Bearer ${firmar({ ...base, is_guest: true })}`).isGuest,
  true,
  'pero la sesión declara que lo es, para el log y para la lista blanca',
)

process.env.MONDAY_ACCOUNT_ID = '35883216'
assert.equal(status(`Bearer ${firmar(base)}`), 'ok', 'la cuenta esperada pasa')
assert.equal(status(`Bearer ${firmar({ ...base, account_id: 999 })}`), 403, 'cuenta ajena')
delete process.env.MONDAY_ACCOUNT_ID

// --- Hacia afuera, ningún mensaje cuenta qué falló -----------------------------------------------
process.env.MONDAY_ACCOUNT_ID = '35883216'
const rechazo = (() => {
  try {
    verificarSesion(`Bearer ${firmar({ ...base, account_id: 777 })}`)
  } catch (e) {
    return e as ErrorAuth
  }
  throw new Error('debería haber rechazado')
})()
assert.equal(rechazo.message, 'Forbidden', 'el mensaje público no da detalle')
assert.match(rechazo.motivo, /cuenta ajena/, 'el detalle queda para el log')
delete process.env.MONDAY_ACCOUNT_ID

console.log('guard-sesion: OK')
