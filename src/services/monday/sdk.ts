/**
 * Acceso a la API de Monday por HTTP contra su endpoint GraphQL.
 *
 * - En desarrollo se pega contra `/monday-api`, proxy de Vite hacia api.monday.com (evita CORS).
 *   El token sale de `.env.local` (VITE_MONDAY_TOKEN) y viaja en la Authorization.
 * - En producción se pega contra `/api/monday`, una Serverless Function (ver `api/monday.ts`)
 *   que inyecta el token del lado servidor (`MONDAY_TOKEN`). Así el token nunca se incrusta en
 *   el bundle del navegador.
 *
 * ── Autorización (Capas 2 y 3) ──
 * En producción la Authorization NO lleva un token de Monday sino el *session token* del usuario
 * (`Bearer <jwt>`, ver `src/lib/mondayAuth.ts`). Es lo que le permite al backend saber QUIÉN está
 * pidiendo: verifica la firma, consulta la lista blanca y exige el segundo factor antes de gastar
 * el token del servidor. El dispositivo confiable de la Capa 3 viaja aparte, en `X-Device-Token`.
 * En desarrollo la app pega directo contra Monday por el proxy de Vite, así que ahí sigue viajando
 * el token personal de `.env.local` y ninguna de las tres capas existe.
 */
import { leerDeviceToken, olvidarDeviceToken } from '@/lib/deviceToken'
import { notificarErrorSeguridad, type ClaseErrorSeguridad } from '@/lib/errorSeguridad'
import { getSessionToken, invalidarSessionToken, sessionTokenEnCache } from '@/lib/mondayAuth'

const TOKEN = (import.meta.env.VITE_MONDAY_TOKEN as string | undefined)?.trim() || undefined

const ENDPOINT = import.meta.env.DEV ? '/monday-api' : '/api/monday'
/**
 * Los archivos NO van al endpoint GraphQL común: Monday los recibe en `/v2/file`, por
 * multipart/form-data. Mismo esquema de proxy que el resto (Vite en desarrollo, función
 * serverless en producción), porque también necesita el token del servidor.
 */
const ENDPOINT_ARCHIVO = import.meta.env.DEV ? '/monday-api-file' : '/api/monday-upload'
const API_VERSION = '2024-10'

/**
 * En desarrollo hay acceso real a Monday sólo si hay token local; si no, los servicios usan mock.
 * En producción el proxy server-side siempre resuelve la autenticación, así que se asume habilitado
 * (requiere que `MONDAY_TOKEN` esté configurado en el entorno del deploy).
 */
export const mondayHabilitado = (): boolean => (import.meta.env.DEV ? Boolean(TOKEN) : true)

interface ApiError {
  message: string
}

/**
 * El backend rechazó al usuario: o no pudo probar quién es (401) o no está habilitado en la lista
 * blanca (403). Es distinto de un fallo de la API y se muestra distinto: reintentar no cambia nada,
 * hay que pedir el alta.
 */
const MENSAJE_RECHAZO: Record<number, string> = {
  401: 'Tu sesión de Monday no pudo verificarse. Recargá la app.',
  403: 'No tenés acceso habilitado a esta app. Pedile el alta al administrador.',
  429: 'Demasiados intentos. Esperá 15 minutos y volvé a probar.',
}

export class AccesoDenegado extends Error {
  constructor(public readonly status: number) {
    super(MENSAJE_RECHAZO[status] ?? 'No se pudo verificar tu acceso a esta app.')
    this.name = 'AccesoDenegado'
  }
}

/**
 * El backend pide el segundo factor: o el usuario no lo enroló, o el dispositivo confiable venció
 * o fue revocado. Es un estado distinto de "no tenés permiso" —tiene arreglo, y lo tiene el
 * propio usuario— así que la UI lo trata aparte y manda a la pantalla de enrolamiento.
 */
export class SegundoFactorRequerido extends Error {
  constructor() {
    super('Necesitás verificar tu segundo factor para seguir.')
    this.name = 'SegundoFactorRequerido'
  }
}

/**
 * La Authorization de cada pedido.
 *
 * En desarrollo, el token personal (el destino es api.monday.com por el proxy de Vite).
 * En producción, el session token del usuario, que es lo que el backend sabe verificar.
 *
 * Devuelve un `string` cuando la respuesta ya se sabe —y así el `fetch` sale en el mismo turno,
 * sin correr de lugar a las llamadas que se disparan sin esperarse— y una promesa sólo la
 * primera vez, cuando todavía hay que pedirle el token al contenedor de Monday.
 */
function autorizacion(): string | Promise<string> {
  if (import.meta.env.DEV) return TOKEN ?? ''
  const enCache = sessionTokenEnCache()
  if (enCache !== undefined) return enCache ? `Bearer ${enCache}` : ''
  return getSessionToken().then((token) => (token ? `Bearer ${token}` : ''))
}

/**
 * Las cabeceras que van en todos los pedidos.
 *
 * `X-Device-Token` es el dispositivo confiable de la Capa 3. Va en una cabecera propia y no en
 * una cookie porque adentro del iframe de monday.com las cookies de terceros no llegan; leerlo
 * es sincrónico, así que no agrega esperas al camino del `fetch`.
 */
function cabeceras(auth: string, extra: Record<string, string>): Record<string, string> {
  const device = leerDeviceToken()
  return {
    ...extra,
    Authorization: auth,
    'API-Version': API_VERSION,
    ...(device ? { 'X-Device-Token': device } : {}),
  }
}

/**
 * Cabeceras autenticadas para pegarle a NUESTROS endpoints (`/api/*`): el de la sesión, los del
 * segundo factor y el proxy de Make.
 *
 * Existe para que ningún pedido se olvide de la credencial. En el repo del que sale esta
 * implementación pasó: un endpoint propio se escribió con las cabeceras a mano y sin la
 * Authorization, y como era el pedido del que depende el arranque, la app entera quedó
 * rechazándose a sí misma con un 401 que parecía un problema de secretos.
 */
export async function cabecerasPropias(
  extra: Record<string, string> = {},
): Promise<Record<string, string>> {
  const auth = autorizacion()
  const device = leerDeviceToken()
  return {
    ...extra,
    Authorization: typeof auth === 'string' ? auth : await auth,
    ...(device ? { 'X-Device-Token': device } : {}),
  }
}

/** Un intento, con el `fetch` disparado apenas se sabe la Authorization. */
function conAutorizacion(url: string, init: (auth: string) => RequestInit): Promise<Response> {
  const auth = autorizacion()
  return typeof auth === 'string' ? fetch(url, init(auth)) : auth.then((a) => fetch(url, init(a)))
}

/**
 * Reintenta UNA vez ante un 401 con el token renovado.
 *
 * El caso real: el token venció antes de lo que la app calculaba —relojes corridos entre el
 * navegador y el servidor—. Pedir uno nuevo lo arregla; insistir con el mismo, no. Un 403 no se
 * reintenta: ahí la firma estaba bien y la respuesta no va a cambiar.
 */
async function pedir(url: string, init: (auth: string) => RequestInit): Promise<Response> {
  const res = await conAutorizacion(url, init)
  if (res.status !== 401 || import.meta.env.DEV) return res
  invalidarSessionToken()
  return conAutorizacion(url, init)
}

/**
 * Traduce el rechazo del backend; el resto de los errores HTTP quedan como estaban.
 *
 * El 403 se lee: si trae la pista `mfa`, lo que falta es el segundo factor y no el permiso. En ese
 * caso se tira el dispositivo confiable guardado —seguir mandando uno muerto en cada pedido no
 * lleva a ningún lado— y se lanza el error que la UI sabe interpretar.
 */
export async function verificarRespuesta(res: Response, contexto: string): Promise<void> {
  if (res.status === 401 || res.status === 403 || res.status === 429) {
    const cuerpo = (await res.json().catch(() => ({}))) as { codigo?: string }
    const clase = claseDeRechazo(res.status, cuerpo.codigo)

    if (clase === 'segundoFactor') olvidarDeviceToken()
    notificarErrorSeguridad(clase, res.status)

    if (clase === 'segundoFactor') throw new SegundoFactorRequerido()
    throw new AccesoDenegado(res.status)
  }

  /* Un 5xx de NUESTRO backend no es un dato que falta: es la app que no puede trabajar. Se avisa
     igual que un rechazo, porque el silencio ante esto sale caro —una pantalla que se ve entera
     pero donde nada funciona, y una consola llena de 500 que el usuario no mira—. */
  if (res.status >= 500) {
    notificarErrorSeguridad('servidor', res.status)
    throw new Error(`${contexto} HTTP ${res.status}`)
  }

  if (!res.ok) throw new Error(`${contexto} HTTP ${res.status}`)
}

/**
 * Qué pantalla corresponde, según lo que el servidor dice que falló.
 *
 * El `codigo` lo manda el guardián y es lo que permite distinguir tres cosas que si no se verían
 * como el mismo 401 mudo: que al servidor le falte configuración, que la credencial no valga, o
 * que el usuario no esté dado de alta. Sin ese dato la app le diría a un usuario legítimo que su
 * dominio no está autorizado, que es falso y no lo lleva a ningún lado.
 */
function claseDeRechazo(status: number, codigo: string | undefined): ClaseErrorSeguridad {
  if (codigo === 'mfa') return 'segundoFactor'
  if (codigo === 'no_habilitado') return 'sinPermiso'
  if (codigo === 'config') return 'configuracion'
  /* `token_incompleto` comparte pantalla con `sesion`: para quien lo ve, la acción es la misma.
     La distinción vive en el código de la respuesta, que es donde sirve para diagnosticar. */
  if (status === 429) return 'demasiadosIntentos'
  return status === 401 ? 'sesion' : 'sinPermiso'
}

/** Ejecuta una query/mutation GraphQL contra la API de Monday y devuelve `data`; lanza si falla. */
export async function mondayApi<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const cuerpo = JSON.stringify({ query, variables: variables ?? {} })
  const res = await pedir(ENDPOINT, (auth) => ({
    method: 'POST',
    headers: cabeceras(auth, { 'Content-Type': 'application/json' }),
    body: cuerpo,
  }))
  await verificarRespuesta(res, 'Monday API')
  const json = (await res.json()) as { data?: T; errors?: ApiError[] }
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join(' · '))
  if (!json.data) throw new Error('Monday no devolvió datos.')
  return json.data
}

/**
 * Sube un archivo a una columna `file`. Es el ÚNICO camino: las columnas de archivo no se pueden
 * completar por `column_values` —ahí sólo viaja JSON—, hay que mandar el binario.
 *
 * El cuerpo va como multipart en el formato que documenta Monday: la `query` en una parte y el
 * binario en `variables[file]`, que es la variable `$file` de la mutación. El `Content-Type` NO se
 * setea a mano: lo arma el navegador con el `boundary` que corresponde.
 *
 * El `FormData` se arma de nuevo en cada intento a propósito: un cuerpo ya consumido no se puede
 * reenviar, y el reintento por token vencido necesita uno entero.
 */
export async function mondaySubirArchivo<T>(query: string, archivo: File): Promise<T> {
  const res = await pedir(ENDPOINT_ARCHIVO, (auth) => {
    const form = new FormData()
    form.append('query', query)
    form.append('variables[file]', archivo, archivo.name)
    return {
      method: 'POST',
      headers: cabeceras(auth, {}),
      body: form,
    }
  })
  await verificarRespuesta(res, 'Monday API (archivos)')
  const json = (await res.json()) as { data?: T; errors?: ApiError[] }
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join(' · '))
  if (!json.data) throw new Error('Monday no devolvió datos al subir el archivo.')
  return json.data
}
