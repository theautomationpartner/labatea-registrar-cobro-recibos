/**
 * Las facturas pendientes de cobro contra Postgres: lo que escribe el cron y lo que lee
 * `/api/facturas-cobranza`.
 *
 * Esquema en `db/facturas-cobro.sql`. Mismo reparto que el padrón de la app de ventas: todo lo que
 * toca la base vive acá, el cron sólo habla con Monday y el endpoint sólo sirve.
 */
import { consultar } from './_db.js'
import type { FilaFactura, ItemFactura } from './_facturasCobro.js'

/** Cuántas filas entran en cada `insert` del upsert por lotes. */
const LOTE = 500

/**
 * Cuánto puede durar una corrida antes de que se la considere colgada y otra pueda tomar el lock.
 * Más que el techo de la función (180 s, `vercel.json`) y con margen.
 */
const LOCK_VENCIDO = '10 minutes'

export interface EstadoSync {
  ultimo_ok: Date | null
  facturas: number
  duracion_ms: number | null
  error: string | null
}

/**
 * Toma el lock de corrida. `false` = hay otra corriendo y esta invocación se retira.
 *
 * `update` condicional y no `select` + `update`: entre esas dos sentencias entran dos corridas.
 */
export async function tomarLock(): Promise<boolean> {
  const filas = await consultar<{ id: number }>(
    `update facturas_cobro_sync
        set corriendo_desde = now()
      where id = 1
        and (corriendo_desde is null or corriendo_desde < now() - interval '${LOCK_VENCIDO}')
      returning id`,
  )
  return filas.length > 0
}

/** Libera el lock. Va SIEMPRE en un `finally`: un lock que no se suelta frena todas las corridas. */
export async function soltarLock(): Promise<void> {
  await consultar(`update facturas_cobro_sync set corriendo_desde = null where id = 1`)
}

export async function leerEstado(): Promise<EstadoSync> {
  const filas = await consultar<EstadoSync>(
    `select ultimo_ok, facturas, duracion_ms, error from facturas_cobro_sync where id = 1`,
  )
  return filas[0] ?? { ultimo_ok: null, facturas: 0, duracion_ms: null, error: null }
}

/**
 * Cierre de una corrida. Con `error` en null es un éxito y mueve `ultimo_ok`; con error, `ultimo_ok`
 * queda donde estaba —es lo que le permite al navegador ver que el caché se está poniendo viejo—.
 */
export async function cerrarCorrida(datos: {
  facturas: number
  duracionMs: number
  error: string | null
}): Promise<void> {
  await consultar(
    `update facturas_cobro_sync
        set ultimo_ok   = case when $3::text is null then now() else ultimo_ok end,
            facturas    = case when $3::text is null then $1::int else facturas end,
            duracion_ms = $2::int,
            error       = $3::text
      where id = 1`,
    [datos.facturas, datos.duracionMs, datos.error],
  )
}

/**
 * Mete o actualiza facturas, de a lotes. `visto_en` se pisa siempre —es lo que permite barrer al
 * final—; `actualizado_en` sólo si el ítem cambió de verdad.
 */
export async function guardarFacturas(filas: FilaFactura[]): Promise<void> {
  /* Sin ids repetidos: Postgres rechaza el statement entero si el mismo `item_id` aparece dos veces
     en un `insert … on conflict do update`. Gana la última versión vista. */
  const unicas = [...new Map(filas.map((f) => [f.id, f])).values()]

  for (let i = 0; i < unicas.length; i += LOTE) {
    const lote = unicas.slice(i, i + LOTE)
    const valores: unknown[] = []
    const tuplas = lote.map((f, n) => {
      const b = n * 5
      valores.push(f.id, f.clienteId, f.tramoIndice, f.vencimiento, JSON.stringify(f.datos))
      return `($${b + 1}, $${b + 2}, $${b + 3}::int, $${b + 4}::date, $${b + 5}::jsonb)`
    })
    await consultar(
      `insert into facturas_cobro_cache (item_id, cliente_id, tramo_indice, vencimiento, datos)
       values ${tuplas.join(', ')}
       on conflict (item_id) do update set
         cliente_id     = excluded.cliente_id,
         tramo_indice   = excluded.tramo_indice,
         vencimiento    = excluded.vencimiento,
         datos          = excluded.datos,
         visto_en       = now(),
         actualizado_en = case
           when facturas_cobro_cache.datos is distinct from excluded.datos then now()
           else facturas_cobro_cache.actualizado_en
         end`,
      valores,
    )
  }
}

/**
 * Cierre del barrido: lo que no se vio en esta vuelta ya no está pendiente —se canceló al 100% o se
 * borró del tablero— y sale del caché. `desde` es el instante en que arrancó la corrida.
 *
 * Sólo se llama con el barrido COMPLETO terminado: cortado a mitad, lo no alcanzado figuraría como
 * ausente y se borraría media cartera de un saque.
 */
export async function barrerNoVistas(desde: Date): Promise<number> {
  const borradas = await consultar<{ item_id: string }>(
    `delete from facturas_cobro_cache where visto_en < $1 returning item_id`,
    [desde],
  )
  return borradas.length
}

/**
 * Las facturas de esos clientes, en esos tramos. `tramos` en `null` = sin filtro de tramo, que es lo
 * que se pide con los CINCO tramos elegidos: así entran también las que el tablero todavía no
 * tramificó, igual que en la consulta directa a Monday (ver `reglaDeTramos` en el navegador).
 *
 * Ordenadas por vencimiento, la más vieja arriba y las sin fecha al final.
 */
export async function leerFacturas(
  clienteIds: readonly string[],
  tramos: readonly number[] | null,
): Promise<ItemFactura[]> {
  if (clienteIds.length === 0) return []
  const params: unknown[] = [clienteIds]
  let donde = `cliente_id = any($1::text[])`
  if (tramos) {
    params.push(tramos)
    donde += ` and tramo_indice = any($2::int[])`
  }
  const filas = await consultar<{ datos: ItemFactura }>(
    `select datos from facturas_cobro_cache
      where ${donde}
      order by vencimiento asc nulls last, item_id`,
    params,
  )
  return filas.map((f) => f.datos)
}

/** Una foto de la tabla, para diagnosticar desde afuera sin abrir la base (`?modo=estado`). */
export async function estadoCache(): Promise<{
  filas: number
  sinCliente: number
  sinTramo: number
  sync: EstadoSync
}> {
  const [c] = await consultar<{ filas: string; sin_cliente: string; sin_tramo: string }>(
    `select count(*)                                   as filas,
            count(*) filter (where cliente_id = '')    as sin_cliente,
            count(*) filter (where tramo_indice is null) as sin_tramo
       from facturas_cobro_cache`,
  )
  return {
    filas: Number(c?.filas ?? 0),
    sinCliente: Number(c?.sin_cliente ?? 0),
    sinTramo: Number(c?.sin_tramo ?? 0),
    sync: await leerEstado(),
  }
}
