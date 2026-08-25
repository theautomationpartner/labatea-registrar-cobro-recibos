/**
 * Serverless Function (Vercel) — proxy de la API GraphQL de Monday.
 *
 * El navegador pega contra `/api/monday` (mismo origen, sin CORS) y esta función reenvía a
 * https://api.monday.com/v2 inyectando el token desde `MONDAY_TOKEN` (variable de entorno del
 * servidor, SIN prefijo VITE_). Así el token nunca viaja al bundle del cliente.
 *
 * Equivale al proxy de Vite (`/monday-api`) que sólo existe en desarrollo.
 *
 * ── El portero de esta puerta (Capa 2) ──
 * Antes de reenviar nada se verifica la firma del session token del usuario y su alta en la lista
 * blanca (`_guard.ts` / `_whitelist.ts`). Sin eso, esta ruta sería un token de Monday con permisos
 * de escritura publicado en internet: quien la encontrara escribiría en los tableros sin necesidad
 * de tener credenciales propias.
 *
 * ── Por qué la firma es (req, res) y corre en Node ──
 * `jsonwebtoken` necesita el runtime de Node (usa `crypto` y `Buffer`), así que esta función dejó de
 * ser edge. Y en Node, Vercel invoca al `export default` con los objetos de `node:http`: el `req` es
 * un `IncomingMessage`, no un `Request` del estándar web. Escrita con la firma web, la primera
 * línea que toca `req.headers.get(...)` revienta con un TypeError y la respuesta es
 * `FUNCTION_INVOCATION_FAILED`. Mismo criterio que `make-comprobantes.ts`.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { autorizarPedido, respuestaDeError } from './_guard.js'
import { deviceTokenDe } from './_http.js'

const API_VERSION = '2024-10'

/** El cuerpo puede venir ya parseado por el runtime: con `application/json`, lo hace siempre. */
type Pedido = IncomingMessage & { body?: unknown }

export default async function handler(req: Pedido, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    return responder(res, 405, { errors: [{ message: 'Method Not Allowed' }] })
  }

  try {
    await autorizarPedido(req.headers.authorization, deviceTokenDe(req))

    const token = process.env.MONDAY_TOKEN
    if (!token) {
      return responder(res, 500, {
        errors: [{ message: 'MONDAY_TOKEN no está configurado en el servidor.' }],
      })
    }

    // Se reenvía el body tal cual (query + variables). La Authorization del cliente NO se reenvía:
    // es el session token del usuario, que contra la API de Monday no vale nada. Siempre se usa el
    // token del servidor, y sólo después de que el guardián dio el visto bueno.
    const body = await leerCuerpo(req)
    const upstream = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token,
        'API-Version': API_VERSION,
      },
      body,
    })

    const texto = await upstream.text()
    res.statusCode = upstream.status
    res.setHeader('content-type', upstream.headers.get('content-type') ?? 'application/json')
    res.end(texto)
  } catch (e) {
    /* Un solo lugar para todos los rechazos: 401 si la firma no cerró, 403 si el usuario no está
       habilitado, 500 para lo inesperado. El detalle queda en el log del servidor. */
    const { status, cuerpo } = respuestaDeError(e)
    /* El `codigo` viaja junto al mensaje: es lo que le permite a la pantalla distinguir "no
       estás habilitado" de "tu sesión no vale" de "al servidor le falta una variable". Sin él, los
       tres se ven como el mismo 401 mudo. */
    return responder(res, status, {
      errors: [{ message: cuerpo.error }],
      ...(cuerpo.codigo ? { codigo: cuerpo.codigo } : {}),
    })
  }
}

/** El cuerpo crudo, tal como lo mandó el cliente. Con JSON el runtime ya lo parseó: se rearma. */
async function leerCuerpo(req: Pedido): Promise<string> {
  if (typeof req.body === 'string') return req.body
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8')
  if (req.body && typeof req.body === 'object') return JSON.stringify(req.body)

  const partes: Buffer[] = []
  for await (const trozo of req) partes.push(Buffer.from(trozo))
  return Buffer.concat(partes).toString('utf8')
}

function responder(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(data))
}
