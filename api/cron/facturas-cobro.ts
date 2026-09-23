/**
 * Vercel Cron Job — mantiene cacheadas en la base las facturas de venta PENDIENTES DE COBRO
 * ("💰Fact Vtas Pends de Cobro", 18421035508), que es lo que consume la GESTIÓN DE COBRANZA.
 *
 * Corre cada 5 minutos (`crons` en `vercel.json`) y cada corrida es un BARRIDO COMPLETO de las
 * facturas no canceladas al 100%. No hay corrida incremental, y no por simplicidad: lo que importa
 * de una factura —lo cobrado y lo pendiente— son una mirror y una fórmula, y Monday no mueve el
 * `updated_at` del ítem cuando esas cambian. Una incremental "sólo lo modificado" dejaría el
 * pendiente cacheado congelado después de cada cobro. Ver `db/facturas-cobro.sql`.
 *
 * Medido al escribirlo: 12 facturas pendientes, una página, ~4 s. La consulta ya viene filtrada
 * en Monday (sin las canceladas), así que lo que crece el barrido es la deuda abierta, no la
 * historia del tablero. Si algún día el barrido se acerca a `PRESUPUESTO_MS`, la corrida falla con
 * el motivo guardado y el navegador vuelve solo a consultar Monday directo (ver
 * `services/monday/cobranza.ts`): se degrada a como era antes, no se rompe.
 *
 * ── Idempotencia ──
 * Todo es reconciliación: correrlo dos veces con los mismos datos deja el mismo estado, y saltearse
 * una corrida —Vercel documenta la entrega como "best effort"— se recupera en la siguiente.
 *
 * `?modo=estado` no barre nada: devuelve cuántas facturas hay cacheadas y cómo terminó la última
 * corrida. Es de sólo lectura, así que se puede correr en cualquier momento.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mondayServidorConEspera } from '../_mondayApi.js'
import {
  BOARD_FACT_PENDIENTES,
  CAMPOS_FACTURA,
  REGLAS_PENDIENTE,
  filaDeFactura,
  type ItemFactura,
} from '../_facturasCobro.js'
import {
  barrerNoVistas,
  cerrarCorrida,
  estadoCache,
  guardarFacturas,
  soltarLock,
  tomarLock,
} from '../_facturasCobroDb.js'

/** Ítems por página: el máximo de `items_page`. Cada factura trae sólo ocho columnas planas. */
const PAGINA = 500

/**
 * Presupuesto de tiempo. `maxDuration` está en 180 s; se corta antes por las buenas para poder
 * cerrar la corrida y soltar el lock, en vez de que la función muera a mitad.
 */
const PRESUPUESTO_MS = 150_000

interface PaginaItems {
  cursor: string | null
  items: ItemFactura[]
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  /* Falla CERRADA: sin `CRON_SECRET` configurada nadie entra. Si el secreto faltante dejara pasar,
     esta ruta sería un barrido del tablero a pedido de cualquiera que la encuentre. Vercel manda el
     valor como `Authorization: Bearer <secreto>`. */
  const secreto = process.env.CRON_SECRET?.trim()
  if (!secreto || req.headers.authorization !== `Bearer ${secreto}`) {
    return responder(res, 401, { error: 'No autorizado' })
  }

  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.searchParams.get('modo') === 'estado') {
    return responder(res, 200, await estadoCache())
  }

  if (!(await tomarLock())) {
    /* 200 y no error: que otra corrida esté trabajando es el funcionamiento normal. */
    return responder(res, 200, { omitido: 'ya hay una corrida en curso' })
  }

  const arranque = Date.now()
  const inicio = new Date()
  try {
    const resultado = await barrido(inicio, arranque)
    await cerrarCorrida({ facturas: resultado.facturas, duracionMs: Date.now() - arranque, error: null })
    return responder(res, 200, { ...resultado, duracionMs: Date.now() - arranque })
  } catch (e) {
    const mensaje = (e as Error).message
    /* El error queda guardado —no sólo en el log— para que el endpoint de lectura lo devuelva y el
       navegador sepa que el caché dejó de actualizarse. */
    await cerrarCorrida({ facturas: 0, duracionMs: Date.now() - arranque, error: mensaje }).catch(
      () => {},
    )
    console.error('[cron facturas-cobro]', mensaje)
    return responder(res, 500, { error: mensaje })
  } finally {
    /* Sin esto, una corrida que revienta deja el lock tomado y frena todas las siguientes. */
    await soltarLock().catch(() => {})
  }
}

/**
 * Barre todas las facturas no canceladas, las guarda y da de baja las que no aparecieron.
 *
 * Las bajas van SÓLO al final y SÓLO si se recorrieron todas las páginas: cortado por tiempo o por
 * un error, lo que no se alcanzó a ver figuraría como cancelado y se borraría del caché.
 */
async function barrido(
  inicio: Date,
  arranque: number,
): Promise<{ facturas: number; bajas: number; paginas: number }> {
  let cursor: string | null = null
  let paginas = 0
  let facturas = 0

  do {
    if (Date.now() - arranque > PRESUPUESTO_MS) {
      throw new Error(`barrido cortado por tiempo tras ${paginas} páginas`)
    }
    const pagina: PaginaItems = await traerPagina(cursor)
    const filas = pagina.items.map(filaDeFactura)
    if (filas.length > 0) await guardarFacturas(filas)
    facturas += filas.length
    cursor = pagina.cursor
    paginas++
  } while (cursor)

  const bajas = await barrerNoVistas(inicio)
  return { facturas, bajas, paginas }
}

async function traerPagina(cursor: string | null): Promise<PaginaItems> {
  if (cursor) {
    const data = await mondayServidorConEspera<{ next_items_page: PaginaItems }>(
      `query ($cursor: String!) { next_items_page(limit: ${PAGINA}, cursor: $cursor) {
         cursor items { ${CAMPOS_FACTURA} }
       } }`,
      { cursor },
    )
    return data.next_items_page
  }

  const data = await mondayServidorConEspera<{ boards: { items_page: PaginaItems }[] }>(
    `query { boards(ids: [${BOARD_FACT_PENDIENTES}]) {
       items_page(limit: ${PAGINA}, query_params: {rules: [${REGLAS_PENDIENTE}]}) {
         cursor items { ${CAMPOS_FACTURA} }
       }
     } }`,
    {},
  )
  /* Sin tablero en la respuesta NO es "no hay deuda": es que el token del servidor no ve el tablero
     (o el id cambió). Seguir de largo barrería el caché entero y lo dejaría vacío con la corrida
     marcada como exitosa, y en pantalla eso se leería como una cartera sin deudores. */
  const tablero = data.boards?.[0]
  if (!tablero) {
    throw new Error(`el token del servidor no ve el tablero ${BOARD_FACT_PENDIENTES}`)
  }
  return tablero.items_page ?? { cursor: null, items: [] }
}

function responder(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(data))
}
