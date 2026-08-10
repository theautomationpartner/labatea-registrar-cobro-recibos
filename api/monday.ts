/**
 * Serverless Function (Vercel) — proxy de la API GraphQL de Monday.
 *
 * El navegador pega contra `/api/monday` (mismo origen, sin CORS) y esta función reenvía a
 * https://api.monday.com/v2 inyectando el token desde `MONDAY_TOKEN` (variable de entorno del
 * servidor, SIN prefijo VITE_). Así el token nunca viaja al bundle del cliente.
 *
 * Equivale al proxy de Vite (`/monday-api`) que sólo existe en desarrollo.
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

  // Se reenvía el body tal cual (query + variables). La Authorization del cliente se ignora
  // a propósito: siempre se usa el token del servidor.
  const body = await req.text()
  const upstream = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
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
