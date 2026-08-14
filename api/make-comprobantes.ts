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
 */

/*
 * Runtime `nodejs` —no `edge` como los proxies de Monday— por el tiempo que tarda la respuesta: del
 * otro lado hay un módulo de IA leyendo un documento, no una consulta a una base. Las funciones edge
 * cortan bastante antes, y un corte acá se vería como un fallo del escenario cuando en realidad
 * estaba por contestar bien.
 *
 * 60 s es el techo del plan Hobby. En Pro se puede subir hasta 300 s, más cerca del tope que espera
 * el cliente (ver `TIMEOUT_MS` en `src/services/make/sdk.ts`).
 */
export const config = { maxDuration: 60 }

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const webhook = process.env.MAKE_WEBHOOK_COMPROBANTES?.trim()
  if (!webhook) {
    return json({ error: 'MAKE_WEBHOOK_COMPROBANTES no está configurado en el servidor.' }, 500)
  }

  const contentType = req.headers.get('content-type')
  if (!contentType?.startsWith('multipart/form-data')) {
    return json({ error: 'El comprobante tiene que viajar como multipart.' }, 400)
  }

  /* Se bufferea el cuerpo en lugar de reenviar el stream: es un comprobante —una hoja— y evita
     depender del soporte de `duplex: 'half'` del runtime. Mismo criterio que `/api/monday-upload`. */
  const body = await req.arrayBuffer()

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
    return json({ error: 'No se pudo conectar con Make.' }, 502)
  }

  /* La respuesta del escenario se devuelve intacta —cuerpo y status—: el cliente ya sabe leerla,
     incluidos los errores que Make declara con un 200 y el 410 del escenario apagado. */
  const text = await upstream.text()
  return new Response(text, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  })
}

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
