/**
 * Capa 2 — el guardián criptográfico. Decide si un pedido llega a gastar el token del servidor.
 *
 * El archivo arranca con `_` a propósito: Vercel no publica como ruta los archivos de `/api` que
 * empiezan así, es un módulo compartido y no un endpoint.
 *
 * Qué mira, en orden:
 *  1. La FIRMA del session token contra `MONDAY_SIGNING_SECRET`. Con `jwt.verify`, nunca con
 *     `jwt.decode`: decodificar es leer un papel sin mirar el sello, y cualquiera escribe un papel.
 *  2. El algoritmo, fijado a HS256. Sin esa lista un token con `alg: none` —o firmado con otro
 *     esquema— entraría con la firma vacía: es el ataque clásico contra las librerías de JWT.
 *  3. La cuenta, si `MONDAY_ACCOUNT_ID` está configurada.
 *     La app se instala por cuenta y el token es legítimo para cualquiera que la instale; esto la
 *     deja atada a la cuenta que corresponde.
 *  4. La lista blanca del tablero privado (ver `_whitelist.ts`).
 *
 * Lo que NO mira: si el usuario es invitado (`is_guest`) de Monday. Hubo una regla que los rechazaba
 * de plano, y se sacó porque contradecía a la lista blanca: un permiso EXPLÍCITO —una fila en un
 * tablero privado que sólo un administrador edita— quedaba anulado por un flag implícito, y el
 * rechazo se veía igual que "no estás en la lista". Quién entra lo decide un solo lugar.
 *
 * Hacia afuera todos los rechazos dicen lo mismo —"Unauthorized" o "Forbidden", sin detalle—. El
 * motivo queda del lado del servidor: contar si el usuario existe en el tablero, si su estado está
 * revocado o si la firma no cerró es regalarle al que prueba un mapa de por dónde seguir.
 */
import jwt from 'jsonwebtoken'
import { ErrorAuth, type CodigoRechazo, type Sesion } from './_errores.js'
import { exigirMfa } from './_mfa.js'
import { exigirListaBlanca } from './_whitelist.js'

/* El vocabulario de rechazo vive en `_errores.ts` para que los imports no se hagan circulares;
   se reexporta acá porque `_guard` sigue siendo la puerta por la que entra el resto. */
export { ErrorAuth, type Sesion } from './_errores.js'

/**
 * Payload del session token. Monday lo manda con los datos adentro de `dat`; algunos tokens de la
 * plataforma los ponen en la raíz, así que se contemplan las dos formas.
 */
interface PayloadMonday {
  dat?: {
    user_id?: number | string
    account_id?: number | string
    is_guest?: boolean
    is_admin?: boolean
    app_id?: number | string
    user_kind?: string
  }
  user_id?: number | string
  userId?: number | string
  account_id?: number | string
  accountId?: number | string
  is_guest?: boolean
  isGuest?: boolean
  is_admin?: boolean
}

/** Tolerancia de reloj entre Monday y el servidor. Sin esto, unos segundos de desfasaje son un 401. */
const TOLERANCIA_RELOJ_S = 30

/**
 * Verifica la firma del session token y devuelve quién es el usuario.
 *
 * Lanza `ErrorAuth` 401 si el token falta, está vencido o la firma no cierra; 403 si es de otra
 * cuenta de Monday. Ser invitado no decide nada acá: lo resuelve la lista blanca.
 */
export function verificarSesion(authorization: string | undefined): Sesion {
  const claves = clavesDeFirma()
  if (claves.length === 0) {
    /* Sin secreto no se puede verificar NADA. Se corta con 401 en vez de dejar pasar: una app mal
       configurada tiene que quedar cerrada, no abierta. */
    throw new ErrorAuth(
      401,
      'ni MONDAY_CLIENT_SECRET ni MONDAY_SIGNING_SECRET están configurados',
      'config',
    )
  }

  const token = authorization?.replace(/^Bearer\s+/i, '').trim()
  if (!token) throw new ErrorAuth(401, 'sin Authorization', 'sesion')

  const payload = verificarConAlguna(token, claves)

  const dat = payload.dat ?? {}
  const userId = texto(dat.user_id ?? payload.user_id ?? payload.userId)
  const accountId = texto(dat.account_id ?? payload.account_id ?? payload.accountId)
  const isGuest = Boolean(dat.is_guest ?? payload.is_guest ?? payload.isGuest)
  /* Del token, no de una consulta: es un dato firmado por Monday sobre ESTE usuario, así
     que no se puede falsear ni confundir con el del token del servidor. */
  const isAdmin = Boolean(dat.is_admin ?? payload.is_admin)
  const appId = texto(dat.app_id)

  if (!userId || !accountId) /* La firma cerró: el token es de Monday. Lo que falla es su CONTENIDO, y eso apunta a otro
       lado que una firma inválida —a la forma del token, no al secreto—. */
    throw new ErrorAuth(401, 'el token no trae user_id / account_id', 'token_incompleto')

  const cuentaEsperada = process.env.MONDAY_ACCOUNT_ID?.trim()
  if (cuentaEsperada && accountId !== cuentaEsperada) {
    throw new ErrorAuth(403, `cuenta ajena (${accountId})`, 'no_habilitado')
  }

  return { userId, accountId, isGuest, isAdmin, appId }
}

/**
 * El control completo: firma + lista blanca + segundo factor. Es lo que llaman los endpoints de
 * datos.
 *
 * Que las tres capas se apliquen en UN solo lugar es lo que hace que no haya puerta de atrás: no
 * existe un endpoint que use el token del servidor sin pasar por acá.
 *
 * Devuelve la sesión ya validada —sirve para logs y para saber en nombre de quién se está
 * trabajando— o lanza `ErrorAuth`.
 */
export async function autorizarPedido(
  authorization: string | undefined,
  deviceToken?: string,
): Promise<Sesion> {
  const sesion = await autorizarSinMfa(authorization)
  await exigirMfa(sesion, deviceToken)
  return sesion
}

/**
 * Firma + lista blanca, SIN exigir el segundo factor.
 *
 * Es lo que usan los propios endpoints de `/api/mfa/*`, y no puede ser de otra manera: pedir el
 * segundo factor para poder enrolarse dejaría a todo el mundo afuera para siempre. Lo que sí se
 * exige es lo de las dos capas anteriores, así que sólo un usuario ya habilitado puede enrolarse.
 */
export async function autorizarSinMfa(authorization: string | undefined): Promise<Sesion> {
  const sesion = verificarSesion(authorization)
  await exigirListaBlanca(sesion)
  return sesion
}

/** Lo único que sale a la red. `mfa` aparece sólo cuando lo que falta es el segundo factor. */
export interface CuerpoDeError {
  error: string
  codigo?: CodigoRechazo
}

/**
 * Traduce el rechazo a una respuesta HTTP sin detalle. Cualquier otro error es un 500 igual de mudo.
 * El motivo se escribe en el log del servidor, que es donde se puede mirar sin ser el atacante.
 */
export function respuestaDeError(e: unknown): { status: number; cuerpo: CuerpoDeError } {
  if (e instanceof ErrorAuth) {
    console.warn(`[guard] ${e.status} · ${e.motivo}`)
    return { status: e.status, cuerpo: { error: e.message, ...(e.codigo ? { codigo: e.codigo } : {}) } }
  }
  console.error('[guard] error inesperado', e)
  return { status: 500, cuerpo: { error: 'Internal Server Error' } }
}

/** Una clave candidata y su nombre, que es lo que se escribe en el log cuando no cierra. */
interface ClaveDeFirma {
  nombre: string
  valor: string
}

/**
 * Las claves con las que puede venir firmado el token, en orden de preferencia.
 *
 * Monday documenta el *Client Secret* como la clave del session token: su ejemplo es literalmente
 * `jwt.verify(token, MY_CLIENT_SECRET)`. Se prueba PRIMERO ése. El *Signing Secret* queda como
 * rescate porque algunas configuraciones de app usan ése, y son dos secretos privados de la misma
 * app: aceptar cualquiera de los dos prueba el origen igual de bien.
 *
 * El orden importa poco para la seguridad y mucho para el log: probando primero el que documenta
 * Monday, el caso normal no deja rastro de un intento fallido.
 */
function clavesDeFirma(): ClaveDeFirma[] {
  return [
    { nombre: 'MONDAY_CLIENT_SECRET', valor: process.env.MONDAY_CLIENT_SECRET?.trim() ?? '' },
    { nombre: 'MONDAY_SIGNING_SECRET', valor: process.env.MONDAY_SIGNING_SECRET?.trim() ?? '' },
  ].filter((clave) => clave.valor !== '')
}

/**
 * Verifica con la primera clave y, si no cierra, reintenta con la siguiente.
 *
 * Un token VENCIDO corta el reintento: la firma cerró, el problema es otro, y probar la segunda
 * clave sólo cambiaría el mensaje del log por uno peor ("firma inválida" en vez de "vencido").
 *
 * `algorithms` va fijado en cada intento: sin esa lista, un token con `alg: none` entra con la
 * firma vacía y no hay clave que valga.
 */
function verificarConAlguna(token: string, claves: ClaveDeFirma[]): PayloadMonday {
  const fallos: string[] = []

  for (const clave of claves) {
    try {
      const verificado = jwt.verify(token, clave.valor, {
        algorithms: ['HS256'],
        clockTolerance: TOLERANCIA_RELOJ_S,
      })
      if (typeof verificado === 'string') throw new Error('el payload no es un objeto')
      return verificado as PayloadMonday
    } catch (e) {
      const error = e as Error
      fallos.push(`${clave.nombre}: ${error.message}`)
      if (error.name === 'TokenExpiredError') break
    }
  }

  /* Al log va DE QUÉ APP dice ser el token. Cuando la firma no cierra, el 99% de las veces es que
     el secreto cargado pertenece a otra app, y sin este dato eso no se puede ver desde afuera:
     costó una tarde entera de diagnóstico descubrirlo mirando la consola del navegador.
     Se lee SIN verificar y sólo para escribirlo: con esto no se decide absolutamente nada. */
  throw new ErrorAuth(401, `token inválido (app ${appDelToken(token)}) · ${fallos.join(' | ')}`, 'sesion')
}

/** De qué app dice ser el token, para el log. Sin verificar: no vale como prueba de nada. */
function appDelToken(token: string): string {
  try {
    const payload = token.split('.')[1]
    if (!payload) return '?'
    const json = Buffer.from(payload, 'base64url').toString('utf8')
    const dat = (JSON.parse(json) as { dat?: { app_id?: unknown } }).dat
    return String(dat?.app_id ?? '?')
  } catch {
    return '?'
  }
}

/** Los ids de Monday llegan como número o como texto según el token; adentro se usan como texto. */
function texto(valor: number | string | undefined): string {
  return valor === undefined || valor === null ? '' : String(valor).trim()
}
