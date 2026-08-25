/**
 * Session token de Monday — la credencial del usuario que está mirando la app (Capa 2).
 *
 * Monday firma este JWT con el *Signing Secret* de la app y se lo entrega al iframe cuando se lo
 * pide por el SDK. Adentro viaja quién es el usuario (`user_id`, `account_id`, `is_guest`); la firma
 * es lo que hace que el backend pueda creerle. El navegador NO lo valida ni decide nada con él: sólo
 * lo transporta. Toda la decisión pasa en `api/_guard.ts`, que verifica la firma con el secreto —que
 * nunca sale del servidor— antes de mirar el contenido.
 *
 * Qué NO es: un token de la API de Monday. Con esto no se puede pegar contra `api.monday.com`; sirve
 * únicamente para que nuestro backend sepa quién está del otro lado.
 *
 * Fuera del iframe (desarrollo en localhost) no hay nadie que conteste: `monday.get` manda un
 * postMessage al contenedor y espera respuesta. Por eso hay un tope de espera y se devuelve `null`
 * en vez de dejar la promesa colgada para siempre.
 */
import mondaySdk from 'monday-sdk-js'

/**
 * El cliente se construye tarde y una sola vez. `mondaySdk()` se suscribe a los `message` del
 * `window` apenas se lo llama: hacerlo al importar el módulo revienta en cualquier contexto sin
 * DOM —los tests corren en node— y deja el efecto colgado del import, que es donde menos se ve.
 */
let sdk: ReturnType<typeof mondaySdk> | null = null

function cliente(): ReturnType<typeof mondaySdk> {
  sdk ??= mondaySdk()
  return sdk
}

/**
 * ¿Hay un contenedor de Monday del otro lado?
 *
 * Sin `window` (node) o sin iframe (la app abierta derecho en una pestaña) no hay a quién
 * preguntarle: el postMessage se manda y no contesta nadie. Se responde `null` en el acto en vez
 * de esperar el tope; el tope queda como red para el caso raro de un contenedor que no responde.
 */
export function enMonday(): boolean {
  try {
    return typeof window !== 'undefined' && window.parent !== window
  } catch {
    /* Un `window.parent` de otro origen puede tirar en navegadores viejos: si tira, hay padre. */
    return true
  }
}

/**
 * Margen contra el `exp` real. Un token que vence en veinte segundos alcanza para pedirlo pero no
 * para que el viaje de ida y vuelta termine: se renueva antes de llegar a ese borde.
 */
const MARGEN_MS = 60_000

/** Sin `exp` legible se cachea poco: mejor pedirlo de nuevo que arrastrar uno vencido. */
const VIDA_POR_DEFECTO_MS = 5 * 60_000

/** Tope de espera del postMessage. Fuera del iframe de Monday no contesta nadie. */
const ESPERA_MAX_MS = 5_000

let cache: { token: string; venceEn: number } | null = null

/** Pedido en vuelo. Sin esto, diez llamadas simultáneas al arrancar piden diez tokens. */
let enCurso: Promise<string | null> | null = null

/**
 * El session token del usuario, o `null` si la app no está corriendo dentro de Monday.
 *
 * Cachea en memoria hasta poco antes del vencimiento que declara el propio token.
 */
export async function getSessionToken(): Promise<string | null> {
  if (cache && Date.now() < cache.venceEn) return cache.token

  enCurso ??= pedirToken().finally(() => {
    enCurso = null
  })
  return enCurso
}

/**
 * El token que YA se tiene, sin prometer nada. Tres respuestas distintas:
 *  · `string`  — hay uno válido en caché, se puede usar en el acto;
 *  · `null`    — no hay sesión posible (no estamos dentro de Monday), tampoco la va a haber;
 *  · `undefined` — hay que ir a pedirlo, y eso es asincrónico.
 *
 * Existe para que el camino normal no pague un salto de microtask antes de cada `fetch`. Sonará
 * a detalle, pero cambia el orden en que salen las llamadas que se disparan sin esperarse
 * —`dispararRegistro` en `cobrar.ts` es una— y ese orden es una regla del sistema, con tests
 * propios que lo fijan.
 */
export function sessionTokenEnCache(): string | null | undefined {
  if (!enMonday()) return null
  if (cache && Date.now() < cache.venceEn) return cache.token
  return undefined
}

/**
 * Tira el token cacheado. Se llama cuando el backend contesta 401: puede ser un token vencido antes
 * de tiempo (relojes corridos entre el navegador y el servidor), y pedir uno nuevo lo resuelve.
 */
export function invalidarSessionToken(): void {
  cache = null
}

async function pedirToken(): Promise<string | null> {
  if (!enMonday()) {
    cache = null
    return null
  }

  let token: string | null = null
  try {
    const consulta = cliente()
      .get('sessionToken')
      .then((res) => {
        const dato: unknown = (res as { data?: unknown })?.data
        return typeof dato === 'string' && dato.length > 0 ? dato : null
      })
    const tope = new Promise<null>((listo) => setTimeout(() => listo(null), ESPERA_MAX_MS))
    token = await Promise.race([consulta, tope])
  } catch {
    /* Afuera del iframe el SDK puede rechazar en vez de colgarse. Da igual: no hay sesión. */
    token = null
  }

  cache = token ? { token, venceEn: vencimiento(token) } : null
  return token
}

/**
 * Cuándo conviene renovar, leído del `exp` del propio token.
 *
 * Esto es un `decode`, NO una validación: acá no se decide nada, sólo se programa el refresco. La
 * firma la verifica el servidor. Si el payload no se puede leer, se usa una vida corta y listo.
 */
/**
 * Qué forma tiene el token que nos dio Monday, sin verificar nada.
 *
 * Sirve para diagnosticar un rechazo del servidor sin acceso a sus logs: dice con qué algoritmo
 * viene firmado y si trae los datos que el backend busca. Decodificar es leer el papel sin mirar
 * el sello —no prueba nada— pero acá no se decide nada con esto: sólo se escribe en la consola.
 *
 * NO incluye el token ni la firma: sólo la forma.
 */
export function resumenSessionToken(token: string): Record<string, unknown> {
  const parte = (i: number): Record<string, unknown> => {
    try {
      const trozo = token.split('.')[i]
      if (!trozo) return {}
      return JSON.parse(atob(trozo.replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>
    } catch {
      return {}
    }
  }

  const cabecera = parte(0)
  const cuerpo = parte(1)
  const dat = (cuerpo.dat ?? {}) as Record<string, unknown>
  const exp = typeof cuerpo.exp === 'number' ? cuerpo.exp : null

  return {
    alg: cabecera.alg ?? '(sin alg)',
    partes: token.split('.').length,
    claves: Object.keys(cuerpo),
    tieneDat: Boolean(cuerpo.dat),
    /* Si el token no es de NUESTRA app, su `app_id` no va a coincidir con el Client ID: eso
       pasa cuando la URL se embebe con un widget de iframe genérico en vez de un app
       feature propio, y ahí ningún secreto nuestro puede verificarlo. */
    appId: dat.app_id ?? '(falta)',
    userId: dat.user_id ?? cuerpo.user_id ?? cuerpo.userId ?? '(falta)',
    accountId: dat.account_id ?? cuerpo.account_id ?? cuerpo.accountId ?? '(falta)',
    vencido: exp === null ? '(sin exp)' : exp * 1000 < Date.now(),
  }
}

function vencimiento(token: string): number {
  try {
    const payload = token.split('.')[1]
    if (!payload) return Date.now() + VIDA_POR_DEFECTO_MS
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    const exp = (JSON.parse(json) as { exp?: number }).exp
    if (typeof exp !== 'number') return Date.now() + VIDA_POR_DEFECTO_MS
    return exp * 1000 - MARGEN_MS
  } catch {
    return Date.now() + VIDA_POR_DEFECTO_MS
  }
}
