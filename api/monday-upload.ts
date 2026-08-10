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
 */
export const config = { runtime: 'edge' }

const API_VERSION = '2024-10'

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const token = process.env.MONDAY_TOKEN
  if (!token) {
    return json({ errors: [{ message: 'MONDAY_TOKEN no está configurado en el servidor.' }] }, 500)
  }

  const contentType = req.headers.get('content-type')
  if (!contentType?.startsWith('multipart/form-data')) {
    return json({ errors: [{ message: 'La subida de archivos tiene que ser multipart.' }] }, 400)
  }

  /* Se bufferea el cuerpo en lugar de reenviar el stream: son comprobantes (archivos chicos) y
     evita depender del soporte de `duplex: 'half'` del runtime. */
  const body = await req.arrayBuffer()
  const upstream = await fetch('https://api.monday.com/v2/file', {
    method: 'POST',
    headers: {
      'Content-Type': contentType,
      Authorization: token,
      'API-Version': API_VERSION,
    },
    body,
  })

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
