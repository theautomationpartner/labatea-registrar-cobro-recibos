/**
 * GESTIÓN DE COBRANZA: la ÚNICA operación de la app que no escribe nada en Monday. Todo lo de acá
 * es lectura, y son dos consultas encadenadas por los dos criterios de búsqueda:
 *
 *   1. LAS CUENTAS · "💵Cta Cte Cliente" (18421858736), filtradas por "🤖 Estado del Saldo"
 *      (`formula_mm6sr4rn`): "Saldo a Cobrar", "Saldo Cero" o "Saldo a Favor".
 *   2. SUS FACTURAS · "💰Fact Vtas Pends de Cobro" (18421035508), las de los clientes de esas
 *      cuentas que no están canceladas al 100%, filtradas por "🤖Estado de Vencimiento"
 *      (`color_mm6symyx`): los tramos que el usuario pidió.
 *
 * ── Por qué el primer filtro corre sobre la RESPUESTA y no como regla de la consulta ──
 *
 * "🤖 Estado del Saldo" es una columna FÓRMULA, y la API de Monday no admite fórmulas en las reglas
 * de `items_page`. Así que las cuentas se traen todas —paginando con su cursor— y el estado se
 * compara acá contra el `display_value`. Es el mismo camino que ya toma el escenario de Make que
 * manda los resúmenes de los deudores (ver `make-blueprints/`), y por el mismo motivo.
 *
 * El segundo filtro, en cambio, va donde corresponde: `color_mm6symyx` es una status, así que el
 * tramo viaja como regla y el tablero devuelve sólo las facturas pedidas.
 */
import { CUENTAS_COBRANZA_MOCK } from '@/data/mock'
import { estadoSaldoDeLabel, TRAMOS_VENCIMIENTO } from '@/lib/cobranza'
import { round2 } from '@/lib/format'
import type {
  CriterioCobranza,
  CuentaCobranza,
  FacturaCobranza,
  ResultadoCobranza,
  TramoVencimiento,
} from '@/types'
import { BOARDS, COL, ESTADO_VENCIMIENTO_INDEX, FACT_PENDIENTE_ESTADO_INDEX } from './columns'
import { num } from './parse'
import {
  CAMPOS_FACTURA_ADEUDADA,
  mapFacturaAdeudada,
  porVencimiento,
  type ItemFactura,
  type ValorColumna,
} from './resumenCtaCte'
import { mondayApi, mondayHabilitado } from './sdk'

/**
 * El ÍNDICE de "🤖Estado de Vencimiento" con el que viaja cada tramo en la regla de la consulta.
 *
 * Es `ESTADO_VENCIMIENTO_INDEX` tal cual: sus claves son exactamente las de `TramoVencimiento`, y
 * declararlo con este tipo es lo que hace que el compilador avise si algún día dejan de coincidir
 * —un tramo nuevo sin índice, o un índice que se renombra— en vez de armar una consulta que
 * devuelve menos facturas de las que debería.
 */
const INDICE_DE_TRAMO: Record<TramoVencimiento, number> = ESTADO_VENCIMIENTO_INDEX

/** El camino inverso: de qué tramo es una factura, según el índice que publica el tablero. */
const TRAMO_DE_INDICE: Record<number, TramoVencimiento> = Object.fromEntries(
  (Object.keys(INDICE_DE_TRAMO) as TramoVencimiento[]).map((t) => [INDICE_DE_TRAMO[t], t]),
)

/** Cuántos ítems se piden por página (el máximo que acepta `items_page`). */
const POR_CONSULTA = 500

/**
 * Cuántos clientes entran en una misma regla `any_of`. Las facturas se piden por LOTES de clientes y
 * no de a uno: una consulta por cliente serían cientos de pedidos para llenar una pantalla.
 */
const CLIENTES_POR_CONSULTA = 100

/**
 * Importe de una columna de la cuenta: vacío vale 0, y las fórmulas y las mirrors llegan con ruido
 * de coma flotante. Se tipa por la FORMA que necesita —el texto y el valor mostrado— y no por el
 * tipo de una columna concreta: la misma función sirve para la cuenta y para cualquier otra lectura.
 */
const importe = (cv?: { text?: string | null; display_value?: string | null }): number =>
  round2(num(cv?.display_value ?? cv?.text ?? ''))

const trozos = <T>(lista: readonly T[], tam: number): T[][] =>
  Array.from({ length: Math.ceil(lista.length / tam) }, (_, i) => lista.slice(i * tam, (i + 1) * tam))

/* ===== Paso 1 · las cuentas corrientes ===== */

/**
 * Una cuenta tal como llega de la API. Su relación con el cliente trae los vinculados CON sus
 * columnas —de ahí sale el código del cliente—, así que no es la `ValorColumna` común: ésa declara
 * los vinculados sin columnas, y decir que las traen sería mentirle al compilador.
 */
interface ColumnaCuenta extends Omit<ValorColumna, 'linked_items'> {
  linked_items?: { id: string; name?: string; column_values?: ValorColumna[] }[]
}

interface ItemCuenta {
  id: string
  name: string
  column_values: ColumnaCuenta[]
}

const CAMPOS_CUENTA = `
  id name
  column_values(ids: ["${COL.ctaCte.nro}","${COL.ctaCte.estadoSaldo}","${COL.ctaCte.ventasPendCancelar}","${COL.ctaCte.anticiposPendAplicar}","${COL.ctaCte.limite}","${COL.ctaCte.lineaUtilizada}","${COL.ctaCte.remitosPendFacturar}","${COL.ctaCte.cliente}"]) {
    id text
    ... on MirrorValue { display_value }
    ... on FormulaValue { display_value }
    ... on BoardRelationValue {
      linked_items {
        id name
        column_values(ids: ["${COL.cliente.codigo}"]) { id text }
      }
    }
  }`

/**
 * TODAS las cuentas del tablero, página por página con su cursor. Se recorren completas porque el
 * filtro por estado del saldo corre después, sobre la respuesta: cortar en la primera página dejaría
 * afuera deudores sin avisar, que es exactamente el error que un tablero de cobranza no puede tener.
 */
async function getCuentas(): Promise<ItemCuenta[]> {
  type Pagina = { cursor: string | null; items: ItemCuenta[] }
  const primera = await mondayApi<{ boards: { items_page: Pagina }[] }>(
    `query {
      boards(ids: [${BOARDS.ctaCte}]) {
        items_page(limit: ${POR_CONSULTA}) {
          cursor
          items { ${CAMPOS_CUENTA} }
        }
      }
    }`,
  )
  const items = [...(primera.boards?.[0]?.items_page.items ?? [])]
  let cursor = primera.boards?.[0]?.items_page.cursor ?? null
  while (cursor) {
    const siguiente: { next_items_page: Pagina } = await mondayApi(
      `query ($cursor: String!) {
        next_items_page(limit: ${POR_CONSULTA}, cursor: $cursor) {
          cursor
          items { ${CAMPOS_CUENTA} }
        }
      }`,
      { cursor },
    )
    items.push(...(siguiente.next_items_page?.items ?? []))
    cursor = siguiente.next_items_page?.cursor ?? null
  }
  return items
}

/**
 * Un ítem de la cuenta → el modelo del tablero.
 *
 * El NOMBRE del cliente sale del vinculado en "🤖Personas" y no del nombre del ítem de la cuenta:
 * ése es interno ("Cta Cte - 4192 - La Batea S.A"). Sin vinculado se cae al nombre del ítem, que es
 * lo único que queda para identificar la fila —y esa cuenta igual queda afuera del listado, porque
 * sin cliente no hay facturas que pedirle—.
 */
function mapCuenta(item: ItemCuenta): CuentaCobranza {
  const c = Object.fromEntries(item.column_values.map((cv) => [cv.id, cv]))
  const k = COL.ctaCte
  const persona = c[k.cliente]?.linked_items?.[0]
  const codigo = persona?.column_values?.find((cv) => cv.id === COL.cliente.codigo)?.text ?? ''
  const label = (c[k.estadoSaldo]?.display_value ?? c[k.estadoSaldo]?.text ?? '').trim()

  return {
    id: item.id,
    nro: (c[k.nro]?.text ?? '').trim() || item.name,
    clienteId: persona?.id ?? '',
    cliente: (persona?.name ?? '').trim() || item.name,
    codigo: codigo.trim(),
    estadoSaldoLabel: label,
    estadoSaldo: estadoSaldoDeLabel(label),
    ventasPendCancelar: importe(c[k.ventasPendCancelar]),
    anticipos: importe(c[k.anticiposPendAplicar]),
    limite: importe(c[k.limite]),
    lineaUtilizada: importe(c[k.lineaUtilizada]),
    mercaderiaPendFacturar: importe(c[k.remitosPendFacturar]),
  }
}

/* ===== Paso 2 · las facturas de esas cuentas ===== */

/** La factura, con el cliente al que está conectada (es lo único que se le suma a la lectura común). */
type ItemFacturaCobranza = ItemFactura & {
  personas: { id: string; linked_item_ids?: string[] }[]
}

/**
 * Los campos de la factura: los MISMOS que lee el RESUMEN DE CTA CTE (ver `CAMPOS_FACTURA_ADEUDADA`)
 * más la relación con el cliente, pedida con un ALIAS.
 *
 * El alias es lo que permite sumar una columna sin tocar el bloque compartido: dos `column_values`
 * en el mismo ítem chocarían por nombre, y GraphQL sólo deja pedirlos dos veces si uno se renombra.
 */
const CAMPOS_FACTURA_COBRANZA = `
  ${CAMPOS_FACTURA_ADEUDADA}
  personas: column_values(ids: ["${COL.factPendiente.cliente}"]) {
    id
    ... on BoardRelationValue { linked_item_ids }
  }`

/**
 * La regla de vencimiento de la consulta, o `''` si no hay que poner ninguna.
 *
 * Con los CINCO tramos elegidos no se filtra: "todos los tramos" quiere decir toda la deuda, y una
 * regla `any_of` con los cinco índices dejaría afuera justamente las facturas a las que el tablero
 * todavía no les puso el estado —que sin cancelar siguen siendo deuda—. Es el mismo criterio con el
 * que el estado de cobro se pide como `not_any_of`.
 */
const reglaDeTramos = (tramos: readonly TramoVencimiento[]): string => {
  if (tramos.length >= TRAMOS_VENCIMIENTO.length) return ''
  const indices = tramos.map((t) => INDICE_DE_TRAMO[t]).join(', ')
  return `,\n            {column_id: "${COL.factPendiente.estadoVencimiento}", compare_value: [${indices}], operator: any_of}`
}

/**
 * Las facturas pendientes de un LOTE de clientes, en los tramos pedidos, recorriendo todas las
 * páginas de la consulta.
 *
 * Los ids de los clientes van como NÚMEROS en la regla: con comillas la consulta devuelve 0 ítems
 * sin fallar, así que el error no se nota hasta que la pantalla aparece vacía (es la misma trampa
 * que documentan `saldos.ts` y el resto de la capa).
 */
async function getFacturasDeLote(
  clienteIds: readonly string[],
  tramos: readonly TramoVencimiento[],
): Promise<ItemFacturaCobranza[]> {
  const ids = clienteIds.map(Number).filter((n) => Number.isFinite(n) && n > 0)
  if (ids.length === 0) return []

  const f = COL.factPendiente
  type Pagina = { cursor: string | null; items: ItemFacturaCobranza[] }
  const primera = await mondayApi<{ boards: { items_page: Pagina }[] }>(
    `query {
      boards(ids: [${BOARDS.factPendientes}]) {
        items_page(
          limit: ${POR_CONSULTA},
          query_params: {
            rules: [
              {column_id: "${f.cliente}", compare_value: [${ids.join(', ')}], operator: any_of},
              {column_id: "${f.estado}", compare_value: [${FACT_PENDIENTE_ESTADO_INDEX.cancelada}], operator: not_any_of}${reglaDeTramos(tramos)}
            ],
            order_by: [{column_id: "${f.fechaVencimiento}", direction: asc}]
          }
        ) {
          cursor
          items { ${CAMPOS_FACTURA_COBRANZA} }
        }
      }
    }`,
  )
  const items = [...(primera.boards?.[0]?.items_page.items ?? [])]
  let cursor = primera.boards?.[0]?.items_page.cursor ?? null
  while (cursor) {
    const siguiente: { next_items_page: Pagina } = await mondayApi(
      `query ($cursor: String!) {
        next_items_page(limit: ${POR_CONSULTA}, cursor: $cursor) {
          cursor
          items { ${CAMPOS_FACTURA_COBRANZA} }
        }
      }`,
      { cursor },
    )
    items.push(...(siguiente.next_items_page?.items ?? []))
    cursor = siguiente.next_items_page?.cursor ?? null
  }
  return items
}

/** El tramo de una factura, leído del ÍNDICE de su status y nunca de su texto. */
const tramoDeFactura = (item: ItemFacturaCobranza): TramoVencimiento | null => {
  const cv = item.column_values.find((c) => c.id === COL.factPendiente.estadoVencimiento)
  return cv?.index != null ? (TRAMO_DE_INDICE[cv.index] ?? null) : null
}

/* ===== La búsqueda completa ===== */

/**
 * Las cuentas que cumplen el criterio de saldo y las facturas de esas cuentas que cumplen el de
 * vencimiento.
 *
 * Las cuentas SIN cliente conectado no entran en el listado —no hay a quién pedirle las facturas— y
 * se cuentan aparte, con el mismo criterio que los movimientos sin fecha del resumen: un dato que
 * falta se dice, no se omite.
 *
 * Sin token (modo local) devuelve el mock, igual que el resto de la capa.
 */
export async function buscarCobranza(criterio: CriterioCobranza): Promise<ResultadoCobranza> {
  if (criterio.estados.length === 0 || criterio.tramos.length === 0) {
    return { cuentas: [], facturas: [], sinCliente: 0, totalLeidas: 0 }
  }
  if (!mondayHabilitado()) return cobranzaMock(criterio)

  const leidas = await getCuentas()
  const pedidos = new Set(criterio.estados)
  const alcanzadas = leidas
    .map(mapCuenta)
    .filter((c) => c.estadoSaldo !== null && pedidos.has(c.estadoSaldo))

  const cuentas = alcanzadas.filter((c) => c.clienteId !== '')
  const sinCliente = alcanzadas.length - cuentas.length

  /* Una cuenta por cliente es la regla del tablero, pero si un cliente tuviera dos su factura se
     asignaría a la primera: el índice se arma con `set` y no se sobreescribe. */
  const porCliente = new Map<string, CuentaCobranza>()
  for (const c of cuentas) if (!porCliente.has(c.clienteId)) porCliente.set(c.clienteId, c)

  /* Los lotes de clientes van EN PARALELO: son consultas independientes, y en serie el tablero
     tardaría la suma de todas en vez de la más lenta. */
  const lotes = await Promise.all(
    trozos([...porCliente.keys()], CLIENTES_POR_CONSULTA).map((lote) =>
      getFacturasDeLote(lote, criterio.tramos),
    ),
  )

  const facturas: FacturaCobranza[] = []
  for (const item of lotes.flat()) {
    const clienteId = String(item.personas?.[0]?.linked_item_ids?.[0] ?? '')
    const cuenta = porCliente.get(clienteId)
    /* Sin cuenta entre las pedidas la factura no es de este resultado. Puede pasar si el cliente
       está conectado en la factura pero su cuenta quedó afuera del criterio de saldo. */
    if (!cuenta) continue
    facturas.push({
      ...mapFacturaAdeudada(item, { codigo: cuenta.codigo, name: cuenta.cliente }),
      clienteId,
      tramo: tramoDeFactura(item),
    })
  }

  return { cuentas, facturas, sinCliente, totalLeidas: leidas.length }
}

/* ===== Modo local ===== */

/** La fecha de HOY corrida `dias` (negativo = hacia atrás), en ISO. */
const iso = (dias: number): string => {
  const pad = (n: number) => String(n).padStart(2, '0')
  const d = new Date()
  d.setDate(d.getDate() + dias)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** La etiqueta con la que el tablero nombra un tramo. Vacía cuando la factura no tiene estado. */
const labelDeTramo = (tramo: TramoVencimiento | null): string =>
  tramo ? (TRAMOS_VENCIMIENTO.find((t) => t.valor === tramo)?.label ?? '') : ''

/** El tono con el que se pinta ese tramo, el mismo que usa el resumen. */
const tonoDeTramo = (tramo: TramoVencimiento | null): 'ok' | 'alerta' | 'vencida' | null =>
  tramo ? (TRAMOS_VENCIMIENTO.find((t) => t.valor === tramo)?.tono ?? null) : null

/**
 * Modo local: las cuentas de prueba pasadas por los MISMOS dos filtros que la consulta real —el
 * estado del saldo sobre la cuenta y el tramo sobre la factura—, así el tablero se puede recorrer
 * entero sin token y los chips cambian de verdad lo que se lista.
 */
function cobranzaMock(criterio: CriterioCobranza): ResultadoCobranza {
  const pedidos = new Set(criterio.estados)
  const tramos = new Set(criterio.tramos)
  const todos = criterio.tramos.length >= TRAMOS_VENCIMIENTO.length

  const alcanzadas = CUENTAS_COBRANZA_MOCK.filter((c) => pedidos.has(c.estado))
  const conCliente = alcanzadas.filter((c) => c.clienteId !== '')

  const cuentas = conCliente.map<CuentaCobranza>((c) => ({
    id: c.id,
    nro: c.nro,
    clienteId: c.clienteId,
    cliente: c.cliente,
    codigo: c.codigo,
    estadoSaldoLabel: labelDeEstado(c.estado),
    estadoSaldo: c.estado,
    ventasPendCancelar: c.ventasPendCancelar,
    anticipos: c.anticipos,
    limite: c.limite,
    lineaUtilizada: round2(c.ventasPendCancelar + c.mercaderiaPendFacturar),
    mercaderiaPendFacturar: c.mercaderiaPendFacturar,
  }))

  const facturas = conCliente
    .flatMap((c) =>
      c.facturas
        /* Igual que la consulta real: con los cinco tramos pedidos no se filtra, así la factura sin
           estado de vencimiento también entra. */
        .filter((f) => todos || (f.tramo !== null && tramos.has(f.tramo)))
        .map<FacturaCobranza>((f) => ({
          id: f.id,
          clienteId: c.clienteId,
          comprobante: f.nro,
          estadoCobro: f.cobrado > 0 ? 'Cancelada Parcialmente' : 'Pend de Cobrar 100%',
          emision: iso(-f.emitidaHaceDias),
          vencimiento: f.venceEnDias === null ? '' : iso(f.venceEnDias),
          importe: f.importe,
          cobrado: f.cobrado,
          pendiente: round2(f.importe - f.cobrado),
          estadoVencimiento: labelDeTramo(f.tramo),
          tonoVencimiento: tonoDeTramo(f.tramo),
          tramo: f.tramo,
        })),
    )
    .sort(porVencimiento)

  return {
    cuentas,
    facturas,
    sinCliente: alcanzadas.length - conCliente.length,
    totalLeidas: CUENTAS_COBRANZA_MOCK.length,
  }
}

/** La etiqueta del estado del saldo en el mock: la misma que publicaría la fórmula del tablero. */
const labelDeEstado = (estado: CuentaCobranza['estadoSaldo']): string =>
  estado === 'aCobrar' ? 'Saldo a Cobrar' : estado === 'cero' ? 'Saldo Cero' : 'Saldo a Favor'
