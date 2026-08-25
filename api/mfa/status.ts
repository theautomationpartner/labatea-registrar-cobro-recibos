/**
 * `POST /api/mfa/status` — qué pantalla tiene que mostrar el frontend.
 *
 * Sin esto la app no puede decidir sola entre "enrolate", "pedime el código" y "pasá": el estado
 * del segundo factor vive en la base, y el navegador no tiene forma de saberlo. Contesta también si
 * el `X-Device-Token` que mandó sigue vigente, que es lo que evita pedir el código todos los días.
 *
 * Es POST y no GET a propósito: así viaja por el mismo camino que el resto —mismo manejo de
 * autorización, sin caché intermedia— y ninguna respuesta con estado de seguridad queda guardada en
 * un proxy.
 */
import type { ServerResponse } from 'node:http'
import { estadoMfa } from '../_mfa.js'
import { endpointMfa, type Pedido } from '../_http.js'

export default async function handler(req: Pedido, res: ServerResponse): Promise<void> {
  await endpointMfa(req, res, async ({ sesion, deviceToken }) => estadoMfa(sesion, deviceToken))
}
