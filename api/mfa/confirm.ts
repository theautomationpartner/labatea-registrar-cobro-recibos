/**
 * `POST /api/mfa/confirm` — confirma el enrolamiento con el primer código.
 *
 * Cuerpo: `{ "codigo": "123456" }`.
 *
 * Si el código valida, el segundo factor queda activo y se devuelven los diez códigos de
 * recuperación. Es la ÚNICA vez que se ven: en la base sólo queda su hash. La UI tiene que
 * mostrarlos y obligar a guardarlos antes de seguir.
 */
import type { ServerResponse } from 'node:http'
import { confirmarEnrolamiento } from '../_mfa.js'
import { endpointMfa, type Pedido } from '../_http.js'

interface Cuerpo {
  codigo?: string
}

export default async function handler(req: Pedido, res: ServerResponse): Promise<void> {
  await endpointMfa<Cuerpo>(req, res, async ({ sesion, cuerpo }) => {
    return confirmarEnrolamiento(sesion, cuerpo.codigo ?? '')
  })
}
