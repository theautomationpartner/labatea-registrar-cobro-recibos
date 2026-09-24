/**
 * Serverless Function (Vercel) — proxy del escenario de Make que genera el RESUMEN DE CTA CTE cuando
 * lo pide la app. Detrás del guardián (firma + lista blanca + MFA), como el resto de `/api`.
 *
 * Arma el evento con la forma del de Monday más `appJobId` (ver `_eventoResumen.ts`), se lo manda al
 * webhook y ESPERA: el escenario contesta recién al terminar, con un `Webhook Response` —200 con qué
 * documento salió y cuál no, o 400 con el motivo—. Esa respuesta vuelve a la pantalla tal cual,
 * envuelta en `{ status, cuerpo }`, y es la pantalla la que la interpreta (ver
 * `interpretarRespuestaResumen` en `services/monday/resumenCtaCte`).
 *
 * El webhook se llama desde ACÁ y no desde el navegador por lo mismo que `make-comprobantes`: su
 * dirección en el bundle alcanza para que cualquiera dispare el escenario. Y es el servidor el que
 * sabe QUIÉN pide: el `userId` del evento sale del token firmado.
 */
import type { ServerResponse } from 'node:http'
import {
  BOARD_CTA_CTE,
  COL_ESTADO_RESUMEN,
  comoJson,
  CONSULTA_ITEM,
  eventoDeResumen,
  type ItemCtaCte,
} from './_eventoResumen.js'
import { endpointDatos, type Pedido } from './_http.js'
import { mondayServidor } from './_mondayApi.js'

/**
 * Cuánto se espera la respuesta del escenario. Make corta la espera de un `Webhook Response` a los
 * 180 s; un poco más acá, para que el que corte —si alguien corta— sea Make y no esta función.
 */
const TIMEOUT_WEBHOOK_MS = 190_000

/* Por encima de la espera al webhook, con margen para la consulta a Monday. */
export const config = { maxDuration: 210 }

interface Cuerpo {
  ctaCteId?: unknown
}

/**
 * Lo que vuelve a la pantalla: el status HTTP del escenario y su cuerpo, si fue JSON. Los status
 * propios —la cuenta no es válida, el webhook no respondió— usan la misma forma, con un `cuerpo`
 * que imita el del escenario para que la pantalla lo lea igual.
 */
interface Respuesta {
  status: number
  cuerpo: unknown
}

const propio = (status: number, mensajeError: string): Respuesta => ({
  status,
  cuerpo: { resultado: 'error_app', mensajeError },
})

export default async function handler(req: Pedido, res: ServerResponse): Promise<void> {
  await endpointDatos<Cuerpo>(req, res, ({ sesion, cuerpo }) =>
    emitir(String(cuerpo.ctaCteId ?? ''), sesion.userId),
  )
}

async function emitir(ctaCteId: string, userId: string): Promise<Respuesta> {
  if (!/^\d+$/.test(ctaCteId)) return propio(400, 'La cuenta corriente no es válida.')

  const webhook = process.env.MAKE_WEBHOOK_RESUMEN_CTA_CTE?.trim()
  if (!webhook) return propio(500, 'La generación del resumen no está configurada.')

  const data = await mondayServidor<{ items: ItemCtaCte[] }>(CONSULTA_ITEM, {
    ids: [ctaCteId],
    col: [COL_ESTADO_RESUMEN],
  })
  const item = data.items?.[0]
  /* Sólo cuentas corrientes: el id llega del navegador, y sin esto se podría disparar el escenario
     sobre cualquier ítem que el token del servidor alcance a leer. */
  if (!item || item.board.id !== BOARD_CTA_CTE) {
    return propio(404, 'No se encontró la cuenta corriente del cliente.')
  }

  const event = eventoDeResumen({ item, userId, appJobId: `rcc_${crypto.randomUUID()}` })
  let upstream: Response
  try {
    upstream = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event }),
      signal: AbortSignal.timeout(TIMEOUT_WEBHOOK_MS),
    })
  } catch (e) {
    const vencido = (e as Error).name === 'TimeoutError'
    console.error(`[resumen-cta-cte] el webhook ${vencido ? 'no respondió a tiempo' : 'no se pudo contactar'}:`, (e as Error).message)
    return vencido
      ? propio(504, 'La generación del resumen no terminó a tiempo. Revisá en Monday si el resumen se generó antes de volver a intentarlo.')
      : propio(502, 'No pudimos contactar al generador de resúmenes. Probá de nuevo en unos minutos.')
  }

  const texto = await upstream.text().catch(() => '')
  if (!upstream.ok) {
    console.error(`[resumen-cta-cte] el escenario respondió HTTP ${upstream.status}: ${texto.slice(0, 300)}`)
  }
  return { status: upstream.status, cuerpo: comoJson(texto) }
}
