/**
 * Serverless Function (Vercel) — proxy del escenario de Make que lee los comprobantes.
 *
 * El navegador pega contra `/api/make-comprobantes` y esta función reenvía al webhook, cuya
 * dirección sale de `MAKE_WEBHOOK_COMPROBANTES` (variable de entorno del servidor, SIN prefijo
 * VITE_). Así la URL del hook nunca viaja al bundle: si estuviera en el cliente —aunque fuera
 * inyectada por entorno— se leería con las herramientas del navegador, y con ella cualquiera
 * dispararía el escenario y consumiría las operaciones de la cuenta de Make.
 *
 * El cuerpo se reenvía TAL CUAL, con su `Content-Type` original: ahí viaja el `boundary` del
 * multipart, y sin él Make no puede separar el archivo del resto de los campos.
 *
 * Equivale al proxy de Vite (`/make-comprobantes`) que sólo existe en desarrollo.
 *
 * ── Por qué la firma es (req, res) y no (Request) → Response ──
 * Esta función corre en el runtime de NODE, no en el edge, y ahí Vercel invoca al `export default`
 * con los objetos de `node:http` —el `req` es un `IncomingMessage`, no un `Request` del estándar
 * web—. Escrita con la firma web, la primera línea que tocaba `req.headers.get(...)` reventaba con
 * un TypeError y Vercel devolvía `FUNCTION_INVOCATION_FAILED` antes de llegar a Make.
 *
 * Los proxies de Monday sí usan la firma web porque declaran `runtime: 'edge'`, donde ESA es la
 * correcta. Acá el edge no sirve: corta la respuesta mucho antes de lo que tarda el módulo de IA en
 * leer un documento, y por eso esta función se quedó en Node con su `maxDuration`.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

/*
 * 60 s es el techo del plan Hobby. En Pro se puede subir hasta 300 s, más cerca del tope que espera
 * el cliente (ver `TIMEOUT_MS` en `src/services/make/sdk.ts`).
 */
export const config = { maxDuration: 60 }

/** El cuerpo puede venir ya leído por el runtime, según el `Content-Type` que haya reconocido. */
type Pedido = IncomingMessage & { body?: unknown }

export default async function handler(req: Pedido, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    return responder(res, 405, { error: 'Method Not Allowed' })
  }

  const webhook = process.env.MAKE_WEBHOOK_COMPROBANTES?.trim()
  if (!webhook) {
    return responder(res, 500, { error: 'El servicio de lectura no está configurado.' })
  }

  const contentType = req.headers['content-type']
  if (!contentType?.startsWith('multipart/form-data')) {
    return responder(res, 400, { error: 'El comprobante tiene que viajar como multipart.' })
  }

  const body = await leerCuerpo(req)

  let upstream: Response
  try {
    upstream = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
    })
  } catch {
    /* No se pudo llegar a Make. Se responde 502 —y no 500— porque el sdk trata los 5xx como fallo
       transitorio y reintenta, que es exactamente lo que corresponde acá. El detalle del error no se
       reenvía: diría el hostname del hook, que es justo lo que esta función existe para no mostrar. */
    return responder(res, 502, { error: 'No se pudo contactar el servicio de lectura.' })
  }

  /* La respuesta del escenario se devuelve intacta —cuerpo y status—: el cliente ya sabe leerla,
     incluidos los errores que Make declara con un 200 y el 410 del escenario apagado. */
  const texto = await upstream.text()
  res.statusCode = upstream.status
  res.setHeader('content-type', upstream.headers.get('content-type') ?? 'application/json')
  res.end(texto)
}

/**
 * El cuerpo crudo del pedido.
 *
 * El runtime parsea solo lo que reconoce (JSON, formularios simples) y deja el multipart sin tocar,
 * así que casi siempre hay que leer el stream. Se contempla igual el caso de que ya venga leído:
 * consumir un stream vacío devolvería un cuerpo de cero bytes y Make recibiría un multipart sin
 * partes, que es más difícil de diagnosticar que un error.
 *
 * Devuelve un `Uint8Array` —del que `Buffer` es una especialización— porque es lo que acepta el
 * `body` de `fetch` sin pedirle al tipado que confíe en nadie.
 */
async function leerCuerpo(req: Pedido): Promise<Uint8Array> {
  if (Buffer.isBuffer(req.body)) return req.body
  if (typeof req.body === 'string') return Buffer.from(req.body)

  const partes: Buffer[] = []
  for await (const trozo of req) partes.push(Buffer.from(trozo))
  return Buffer.concat(partes)
}

function responder(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(data))
}
