/**
 * Las facturas PENDIENTES DE COBRO leídas por el SERVIDOR: qué columnas se piden, cuáles entran y
 * qué se desnormaliza para poder filtrar en la base.
 *
 * ── Por qué esto no importa de `src/` ──
 * `api/` es autocontenido, igual que en la app de ventas: un import que cruce a `src/` cambia la raíz
 * que calcula `tsc` con `tsconfig.api.json` y las funciones de Vercel terminan resolviendo mal. El
 * precio es que los ids de columna viven en DOS lugares: acá y en `COL.factPendiente`
 * (`src/services/monday/columns.ts`). `npm run test:facturas-cache` compara los dos y exige que la
 * consulta del cron pida exactamente las columnas que el navegador mapea.
 */

/** "💰Fact Vtas Pends de Cobro". Espejo de `BOARDS.factPendientes`. */
export const BOARD_FACT_PENDIENTES = 18421035508

/** Ids de columna. Espejo EXACTO de las que usa `COL.factPendiente`; lo verifica el test. */
export const COL_FACT = {
  cliente: 'board_relation_mm5zaxck',
  fechaEmision: 'date_mm648d33',
  fechaVencimiento: 'date_mm647vwr',
  total: 'numeric_mkwbck5d',
  cobrado: 'lookup_mm4c3vc8',
  pendiente: 'formula_mkwbrnk1',
  estado: 'color_mkwb727e',
  estadoVencimiento: 'color_mm6symyx',
} as const

/** Índice de "Cancelada 100%" en "🤖Estado". Espejo de `FACT_PENDIENTE_ESTADO_INDEX.cancelada`. */
export const ESTADO_CANCELADA_INDEX = 1

/**
 * Los campos de cada factura. Son los de `CAMPOS_FACTURA_COBRANZA` en el navegador —las columnas de
 * `CAMPOS_FACTURA_ADEUDADA` más la relación con el cliente bajo el alias `personas`—, así el ítem
 * que se guarda es exactamente el que `mapFacturaAdeudada` sabe leer.
 */
export const CAMPOS_FACTURA = `
  id name
  column_values(ids: ${JSON.stringify([
    COL_FACT.estado,
    COL_FACT.fechaEmision,
    COL_FACT.total,
    COL_FACT.cobrado,
    COL_FACT.pendiente,
    COL_FACT.fechaVencimiento,
    COL_FACT.estadoVencimiento,
  ])}) {
    id text
    ... on StatusValue { index }
    ... on MirrorValue { display_value }
    ... on FormulaValue { display_value }
  }
  personas: column_values(ids: ["${COL_FACT.cliente}"]) {
    id
    ... on BoardRelationValue { linked_item_ids }
  }`

/**
 * La única regla de la consulta: fuera las canceladas al 100%. Es `not_any_of` y no un `any_of` con
 * los otros estados, igual que en el navegador: así también entra la factura con el estado vacío,
 * que sin cancelar sigue siendo deuda.
 */
export const REGLAS_PENDIENTE = `{column_id: "${COL_FACT.estado}", compare_value: [${ESTADO_CANCELADA_INDEX}], operator: not_any_of}`

export interface CV {
  id: string
  text?: string | null
  index?: number | null
  display_value?: string | null
}

export interface ItemFactura {
  id: string
  name: string
  column_values: CV[]
  personas?: { id: string; linked_item_ids?: string[] }[]
}

/** Una fila de `facturas_cobro_cache`, lista para el upsert. */
export interface FilaFactura {
  id: string
  clienteId: string
  tramoIndice: number | null
  vencimiento: string | null
  datos: ItemFactura
}

const ISO = /^\d{4}-\d{2}-\d{2}$/

/**
 * El ítem de Monday → la fila del caché. Lo único que se calcula es lo que la base necesita para
 * filtrar y ordenar; el ítem viaja crudo en `datos` (ver `db/facturas-cobro.sql`).
 *
 * Pura y exportada para el test: si el cliente o el tramo se leyeran mal acá, la factura quedaría
 * asignada a otra cuenta o afuera de su tramo, y en pantalla eso se ve como deuda que no existe.
 */
export function filaDeFactura(item: ItemFactura): FilaFactura {
  const col = (id: string): CV | undefined => item.column_values.find((c) => c.id === id)
  const tramo = col(COL_FACT.estadoVencimiento)?.index
  const vto = (col(COL_FACT.fechaVencimiento)?.text ?? '').trim()
  return {
    id: item.id,
    clienteId: String(item.personas?.[0]?.linked_item_ids?.[0] ?? ''),
    tramoIndice: typeof tramo === 'number' ? tramo : null,
    vencimiento: ISO.test(vto) ? vto : null,
    datos: item,
  }
}
