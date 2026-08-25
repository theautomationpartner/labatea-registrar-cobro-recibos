/**
 * `POST /api/mfa/setup` — arranca el enrolamiento del segundo factor.
 *
 * Devuelve el QR para escanear con Google Authenticator (o la que use la persona) y el secreto en
 * texto por si la cámara no coopera. El secreto queda guardado CIFRADO y en estado pendiente: no
 * habilita nada hasta que `/api/mfa/confirm` reciba un código válido.
 *
 * Volver a llamarlo REEMPLAZA el enrolamiento anterior. Es lo que se quiere cuando alguien cambió
 * de teléfono, y no es un agujero: para llegar acá hay que tener firma válida y estar en la lista
 * blanca, o sea ser ya ese usuario.
 */
import type { ServerResponse } from 'node:http'
import { iniciarEnrolamiento } from '../_mfa.js'
import { endpointMfa, type Pedido } from '../_http.js'

export default async function handler(req: Pedido, res: ServerResponse): Promise<void> {
  await endpointMfa(req, res, async ({ sesion }) => {
    /* La etiqueta es lo que la app de autenticación muestra en la lista. Lleva la cuenta y el
       usuario para que quien administre dos cuentas no vea dos entradas idénticas. */
    const etiqueta = `usuario ${sesion.userId} · cuenta ${sesion.accountId}`
    return iniciarEnrolamiento(sesion, etiqueta)
  })
}
