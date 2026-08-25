/**
 * `POST /api/mfa/verify` — verificación diaria del segundo factor.
 *
 * Cuerpo: `{ "codigo": "123456" }`.
 *
 * Acepta tanto un código de la app (seis dígitos) como uno de recuperación. Si el usuario pidió
 * confiar en el dispositivo, la respuesta trae un `deviceToken` que el frontend guarda en
 * `localStorage` y manda después en `X-Device-Token`. No es una cookie: adentro del iframe de
 * monday.com las cookies de terceros no sobreviven a Safari.
 *
 * El límite de cinco fallos cada quince minutos vive en `_mfa.ts`, contra la base: en serverless un
 * contador en memoria no limita nada, porque cada instancia arranca con el suyo en cero.
 */
import type { ServerResponse } from 'node:http'
import { verificar } from '../_mfa.js'
import { endpointMfa, type Pedido } from '../_http.js'

interface Cuerpo {
  codigo?: string
}

export default async function handler(req: Pedido, res: ServerResponse): Promise<void> {
  await endpointMfa<Cuerpo>(req, res, async ({ sesion, cuerpo }) =>
    verificar(sesion, cuerpo.codigo ?? ''),
  )
}
