/**
 * Serverless Function (Vercel) — estado de un mensaje de WhatsApp enviado por 360Messenger.
 *
 * El escenario de Make que envía los documentos manda el WhatsApp por 360Messenger y devuelve su
 * `messageId`. La app pregunta acá si ese mensaje salió de verdad: `GET /api/whatsapp-estado?id=…`,
 * que reenvía a `GET https://api.360messenger.com/v2/message/status?id=…` con la API key del
 * servidor. La key nunca llega al navegador.
 *
 * Qué key: `WHATSAPP_API_KEY` (la del número de producción) y, si no está, `WHATSAPP_API_KEY_TEST`
 * (la del número de testeo). Así el mismo código sirve para probar y para producción: alcanza con
 * cargar la de producción en el deploy.
 *
 * La respuesta de 360Messenger se devuelve tal cual —status y cuerpo—: la interpreta el cliente
 * (`src/services/whatsapp/estadoMensaje.ts`), igual que en desarrollo, donde la misma consulta pasa
 * por el proxy de Vite (`/messenger360-estado`).
 *
 * Pasa por el mismo guardián que el resto (Capa 2): sin él, cualquiera consulta mensajes de la
 * cuenta de WhatsApp con la key del servidor. Corre en Node porque el guardián usa `jsonwebtoken`.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { autorizarPedido, respuestaDeError } from './_guard.js'
import { deviceTokenDe } from './_http.js'

const API_360 = 'https://api.360messenger.com/v2/message/status'

/**
 * Forma aceptada del id: el de 360Messenger es un UUID. Se acota a letras, números y guiones para que
 * el parámetro no pueda meter otra cosa en la URL que se arma.
 */
const ID_VALIDO = /^[A-Za-z0-9-]{8,64}$/

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET') {
    return responder(res, 405, { error: 'Method Not Allowed' })
  }

  try {
    await autorizarPedido(req.headers.authorization, deviceTokenDe(req))
  } catch (e) {
    const { status, cuerpo } = respuestaDeError(e)
    return responder(res, status, cuerpo)
  }

  const clave = (process.env.WHATSAPP_API_KEY || process.env.WHATSAPP_API_KEY_TEST)?.trim()
  if (!clave) {
    return responder(res, 500, { error: 'La consulta de WhatsApp no está configurada.' })
  }

  const id = new URL(req.url ?? '/', 'http://localhost').searchParams.get('id') ?? ''
  if (!ID_VALIDO.test(id)) {
    return responder(res, 400, { error: 'Id de mensaje inválido.' })
  }

  let upstream: Response
  try {
    upstream = await fetch(`${API_360}?id=${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${clave}`, Accept: 'application/json' },
    })
  } catch {
    return responder(res, 502, { error: 'No se pudo contactar a 360Messenger.' })
  }

  const texto = await upstream.text()
  res.statusCode = upstream.status
  res.setHeader('content-type', upstream.headers.get('content-type') ?? 'application/json')
  res.end(texto)
}

function responder(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(data))
}
