/**
 * Serverless Function (Vercel) — el PDF del RESUMEN DE CTA CTE que quedó en la cuenta, para abrirlo
 * en una pestaña e imprimirlo desde ahí. Detrás del guardián (firma + lista blanca + MFA), como el
 * resto de `/api`.
 *
 * Existe por una cabecera: el enlace que da Monday para bajar un archivo (`public_url`, un enlace
 * firmado de S3) lo sirve con `Content-Disposition: attachment`, y el navegador lo DESCARGA en vez de
 * mostrarlo. La cabecera no se puede cambiar desde el enlace sin romper su firma, así que el archivo
 * pasa por acá y sale `inline`.
 *
 * La pantalla manda qué cuenta y qué documento; la columna, la consulta y la elección del archivo son
 * del servidor (ver `_archivoResumen.ts`).
 */
import type { ServerResponse } from 'node:http'
import {
  COL_ARCHIVO_RESUMEN,
  CONSULTA_ARCHIVOS,
  pdfDelDocumento,
  sinPdf,
  type ArchivoCtaCte,
  type DocumentoArchivo,
} from './_archivoResumen.js'
import { BOARD_CTA_CTE } from './_eventoResumen.js'
import { autorizarPedido, respuestaDeError } from './_guard.js'
import { deviceTokenDe, leerJson, responderJson, type Pedido } from './_http.js'
import { mondayServidor } from './_mondayApi.js'

interface Cuerpo {
  ctaCteId?: unknown
  documento?: unknown
}

const DOCUMENTOS: readonly DocumentoArchivo[] = ['resumen', 'estado']

export default async function handler(req: Pedido, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') return responderJson(res, 405, { error: 'Method Not Allowed' })

  try {
    await autorizarPedido(req.headers.authorization, deviceTokenDe(req))
    const cuerpo = await leerJson<Cuerpo>(req)
    const ctaCteId = String(cuerpo.ctaCteId ?? '')
    const documento = DOCUMENTOS.find((d) => d === cuerpo.documento)
    if (!/^\d+$/.test(ctaCteId) || !documento) {
      return responderJson(res, 400, { error: 'El pedido del PDF no es válido.' })
    }

    const data = await mondayServidor<{ items: { board: { id: string }; assets: ArchivoCtaCte[] }[] }>(
      CONSULTA_ARCHIVOS,
      { ids: [ctaCteId], col: [COL_ARCHIVO_RESUMEN] },
    )
    const item = data.items?.[0]
    /* Sólo cuentas corrientes: el id llega del navegador, y sin esto se podría bajar un archivo de
       cualquier ítem que el token del servidor alcance a leer. */
    if (!item || item.board.id !== BOARD_CTA_CTE) {
      return responderJson(res, 404, { error: 'No se encontró la cuenta corriente del cliente.' })
    }
    const archivo = pdfDelDocumento(item.assets ?? [], documento)
    if (!archivo) return responderJson(res, 404, { error: sinPdf(documento) })

    const upstream = await fetch(archivo.public_url)
    if (!upstream.ok) {
      console.error(`[resumen-archivo] el archivo respondió HTTP ${upstream.status}`)
      return responderJson(res, 502, { error: 'No pudimos traer el PDF. Probá de nuevo en unos minutos.' })
    }

    /* Bufferado y no en stream: son PDFs de pocas páginas, lejos del tope de respuesta de Vercel. */
    const pdf = Buffer.from(await upstream.arrayBuffer())
    res.statusCode = 200
    res.setHeader('content-type', 'application/pdf')
    res.setHeader('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(archivo.name)}`)
    res.setHeader('cache-control', 'no-store')
    res.end(pdf)
  } catch (e) {
    if (e instanceof SyntaxError) return responderJson(res, 400, { error: 'Bad Request' })
    const { status, cuerpo } = respuestaDeError(e)
    responderJson(res, status, cuerpo)
  }
}
