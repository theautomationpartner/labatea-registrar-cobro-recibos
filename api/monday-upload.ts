/**
 * Serverless Function (Vercel) — proxy de la subida de archivos a Monday.
 *
 * Las columnas `file` no se completan por `column_values`: hay que mandar el binario a
 * https://api.monday.com/v2/file (multipart/form-data). El navegador pega contra
 * `/api/monday-upload` (mismo origen, sin CORS) y esta función reenvía inyectando el token desde
 * `MONDAY_TOKEN`, igual que `/api/monday` con el GraphQL común.
 *
 * El cuerpo se reenvía TAL CUAL, con su `Content-Type` original: ahí viaja el `boundary` del
 * multipart, y sin él la API no puede separar las partes.
 *
 * Equivale al proxy de Vite (`/monday-api-file`) que sólo existe en desarrollo.
 *
 * Pasa por el mismo guardián que `/api/monday` (firma del session token + lista blanca) y por la
 * misma razón: sin él, cualquiera sube archivos a los tableros con el token del servidor. Corre en
 * Node —no en edge— porque `jsonwebtoken` lo necesita; ver el encabezado de `monday.ts`.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { autorizarPedido, respuestaDeError } from './_guard.js'
import { deviceTokenDe } from './_http.js'

const API_VERSION = '2024-10'

/** El multipart el runtime no lo parsea, pero el tipo contempla que el cuerpo pueda venir leído. */
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

    const contentType = req.headers['content-type']
    if (!contentType?.startsWith('multipart/form-data')) {
      return responder(res, 400, {
        errors: [{ message: 'La subida de archivos tiene que ser multipart.' }],
      })
    }

    /* Se bufferea el cuerpo en lugar de reenviar el stream: son comprobantes (archivos chicos) y
       evita depender del soporte de `duplex: 'half'` del runtime. */
    const body = await leerCuerpo(req)
    const upstream = await fetch('https://api.monday.com/v2/file', {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
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

/**
 * El cuerpo crudo del pedido. El runtime deja el multipart sin tocar, así que casi siempre hay que
 * leer el stream; se contempla igual el caso de que ya venga leído.
 */
async function leerCuerpo(req: Pedido): Promise<ArrayBuffer> {
  if (Buffer.isBuffer(req.body)) return bytes(req.body)
  if (typeof req.body === 'string') return bytes(Buffer.from(req.body))

  const partes: Buffer[] = []
  for await (const trozo of req) partes.push(Buffer.from(trozo))
  return bytes(Buffer.concat(partes))
}

/** La ventana exacta del Buffer: `fetch` sólo declara `ArrayBuffer` como cuerpo binario. */
function bytes(b: Buffer): ArrayBuffer {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}

function responder(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(data))
}
