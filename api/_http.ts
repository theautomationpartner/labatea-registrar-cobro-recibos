/**
 * Andamiaje común de los endpoints de `/api/mfa/*`.
 *
 * Los cuatro hacen lo mismo alrededor de su única línea propia: aceptar sólo POST, autorizar,
 * leer el cuerpo, responder JSON y traducir los rechazos. Con esto, cada endpoint queda del tamaño
 * de lo que realmente decide.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { autorizarPedido, autorizarSinMfa, respuestaDeError } from './_guard.js'
import type { Sesion } from './_errores.js'

/** El cuerpo puede venir ya parseado por el runtime: con `application/json`, siempre lo está. */
export type Pedido = IncomingMessage & { body?: unknown }

/** Lo que recibe cada endpoint, ya masticado. */
export interface Contexto<T> {
  sesion: Sesion
  cuerpo: T
  /** El dispositivo confiable que mandó el navegador, si tenía uno guardado. */
  deviceToken: string | undefined
}

export function responderJson(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  /* Nada de esto se cachea: son respuestas por usuario y, en el caso del enrolamiento, contienen
     secretos de un solo uso. */
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(data))
}

/** La cabecera del dispositivo confiable. No es una cookie a propósito: ver `_mfa.ts`. */
export function deviceTokenDe(req: IncomingMessage): string | undefined {
  const valor = req.headers['x-device-token']
  const texto = Array.isArray(valor) ? valor[0] : valor
  return texto?.trim() || undefined
}

/**
 * Corre un endpoint protegido: sólo POST, con las capas ya aplicadas y el cuerpo parseado.
 *
 * `conSegundoFactor` es la única diferencia entre los dos usos, y no es un detalle: los endpoints
 * de `/api/mfa/*` NO pueden exigirlo —pedir el segundo factor para poder enrolarse dejaría a todo
 * el mundo afuera para siempre—, y todo el resto SÍ.
 */
async function correr<T>(
  req: Pedido,
  res: ServerResponse,
  fn: (ctx: Contexto<T>) => Promise<unknown>,
  conSegundoFactor: boolean,
): Promise<void> {
  if (req.method !== 'POST') {
    return responderJson(res, 405, { error: 'Method Not Allowed' })
  }

  try {
    const deviceToken = deviceTokenDe(req)
    const sesion = conSegundoFactor
      ? await autorizarPedido(req.headers.authorization, deviceToken)
      : await autorizarSinMfa(req.headers.authorization)
    const cuerpo = await leerJson<T>(req)
    responderJson(res, 200, await fn({ sesion, cuerpo, deviceToken }))
  } catch (e) {
    // Un cuerpo ilegible es culpa de quien lo mandó, no del servidor.
    if (e instanceof SyntaxError) return responderJson(res, 400, { error: 'Bad Request' })
    const { status, cuerpo } = respuestaDeError(e)
    responderJson(res, status, cuerpo)
  }
}

/** Endpoint de datos: firma + lista blanca + segundo factor. */
export async function endpointDatos<T>(
  req: Pedido,
  res: ServerResponse,
  fn: (ctx: Contexto<T>) => Promise<unknown>,
): Promise<void> {
  return correr(req, res, fn, true)
}

/** Endpoint del propio segundo factor: firma + lista blanca, sin exigir el factor que va a crear. */
export async function endpointMfa<T>(
  req: Pedido,
  res: ServerResponse,
  fn: (ctx: Contexto<T>) => Promise<unknown>,
): Promise<void> {
  return correr(req, res, fn, false)
}

/** El cuerpo como objeto. Un cuerpo vacío es `{}`: varios endpoints no necesitan ninguno. */
async function leerJson<T>(req: Pedido): Promise<T> {
  if (req.body && typeof req.body === 'object') return req.body as T

  const crudo =
    typeof req.body === 'string' ? req.body : await new Promise<string>((listo, falla) => {
      const partes: Buffer[] = []
      req.on('data', (trozo: Buffer) => partes.push(Buffer.from(trozo)))
      req.on('end', () => listo(Buffer.concat(partes).toString('utf8')))
      req.on('error', falla)
    })

  if (!crudo.trim()) return {} as T
  try {
    return JSON.parse(crudo) as T
  } catch {
    // Un cuerpo ilegible es un pedido mal armado, no un problema del servidor.
    throw new SyntaxError('el cuerpo del pedido no es JSON válido')
  }
}
