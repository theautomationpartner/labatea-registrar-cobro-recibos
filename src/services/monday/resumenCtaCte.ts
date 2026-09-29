/**
 * RESUMEN DE CTA CTE: lectura de los movimientos de la cuenta corriente del cliente y registro del
 * resumen emitido. Tablero "💵Cta Cte Cliente" (18421858736).
 *
 * La cuenta es UN ítem por cliente y cada movimiento es un SUBELEMENTO suyo (18421858762). La app
 * NO escribe ningún movimiento: los lee, los filtra por período y los muestra.
 *
 * Los archivos del resumen los genera la APP al emitir (ver `features/documentos`) y el envío lo
 * despacha el escenario de Make. Lo único que se escribe en Monday es "Registrar Resumen": los
 * archivos sobre el ítem de la cuenta y la actividad del envío en el timeline del cliente (ver
 * `registrarResumenCtaCte`).
 */
import { FACTURAS_PENDIENTES, MERCADERIA_PEND_FACTURAR_MOCK, MOVIMIENTOS_CTA_CTE_MOCK } from '@/data/mock'
import { contenidoActividadResumen, tituloActividadResumen } from '@/lib/actividadResumen'
import { round2 } from '@/lib/format'
import {
  comprobanteDeMovimiento,
  dentroDelPeriodo,
  nroDeFactura,
  reciboEn,
  type ClaseMovimiento,
} from '@/lib/resumenCtaCte'
import type {
  ArchivoCtaCte,
  Cliente,
  FacturaAdeudada,
  FormatoResumen,
  MedioEnvio,
  MovimientoCtaCte,
  MovimientosDelPeriodo,
  PeriodoResumen,
  TramoVencimiento,
} from '@/types'
import {
  ACTIVIDAD_ENVIO_RESUMEN,
  BOARDS,
  COL,
  ESTADO_VENCIMIENTO_INDEX,
  FACT_PENDIENTE_ESTADO_INDEX,
  FORMATO_RESUMEN_IDS,
  MEDIO_ENVIO_RESUMEN_IDS,
  MOVIMIENTO_CTA_CTE_CLIENTE_INDEX,
} from './columns'
import { escribirColumnas, subirArchivoAColumna, type ArchivoSubido } from './documentos'
import { num, sumaMirror } from './parse'
import { mondayApi, mondayHabilitado } from './sdk'
/* ===== Forma de las respuestas =====
   Tipos locales y no los de `parse`: acá los vinculados vienen SIN `column_values` (sólo interesa
   de qué tablero son y cómo se llaman), y declararlos como si los trajeran sería mentirle al
   compilador. */

/**
 * Una columna tal como llega de la API. Se exporta porque el servicio de la GESTIÓN DE COBRANZA lee
 * las MISMAS facturas con las mismas columnas (ver `services/monday/cobranza`).
 */
export interface ValorColumna {
  id: string
  text: string | null
  index?: number | null
  display_value?: string | null
  linked_items?: { id: string; name?: string; board?: { id: string } | null }[]
}

/** Índice de "🤖Movimiento" → clase de movimiento con la que se lo nombra en el resumen. */
const CLASE_DE_INDICE: Record<number, ClaseMovimiento> = {
  [MOVIMIENTO_CTA_CTE_CLIENTE_INDEX.ventaPendiente]: 'venta',
  [MOVIMIENTO_CTA_CTE_CLIENTE_INDEX.cobro]: 'cobro',
  [MOVIMIENTO_CTA_CTE_CLIENTE_INDEX.anticipo]: 'anticipo',
  [MOVIMIENTO_CTA_CTE_CLIENTE_INDEX.saldoInicial]: 'saldoInicial',
  [MOVIMIENTO_CTA_CTE_CLIENTE_INDEX.creditoPase]: 'creditoPase',
  [MOVIMIENTO_CTA_CTE_CLIENTE_INDEX.debitoPase]: 'debitoPase',
}

const claseDe = (cv?: ValorColumna): ClaseMovimiento =>
  (cv?.index != null ? CLASE_DE_INDICE[cv.index] : undefined) ?? 'otro'

interface Subelemento {
  id: string
  name: string
  column_values: ValorColumna[]
}

/** Las facturas de venta pendientes pueden estar en cualquiera de sus DOS tableros. */
const TABLEROS_FACTURA_VENTA = new Set([
  String(BOARDS.factPendientes),
  String(BOARDS.factPendientesCobradas),
])

/** Cuántos ids acepta `items(ids:)` por consulta. */
const IDS_POR_CONSULTA = 100

const trozos = <T>(lista: readonly T[], tam: number): T[][] =>
  Array.from({ length: Math.ceil(lista.length / tam) }, (_, i) => lista.slice(i * tam, (i + 1) * tam))

/** Importe de una columna: vacío vale 0, y las fórmulas llegan con ruido de coma flotante. */
const importe = (cv?: ValorColumna): number => round2(num(cv?.display_value ?? cv?.text ?? ''))

/** Fecha ISO de una columna date. Lo que no sea una fecha completa cuenta como vacío. */
const fechaIso = (cv?: { text: string | null }): string => {
  const t = (cv?.text ?? '').trim().slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : ''
}

/* ===== Paso 1 · qué cuenta corriente tiene asignada el cliente ===== */

/**
 * El ítem de la cuenta corriente conectado en el cliente ("💵Cta Cte", board_relation_mm5ep5qd).
 *
 * Esa columna conecta con DOS tableros —la cuenta de clientes y la de proveedores—, porque una misma
 * persona puede tener una de cada lado. El resumen es de la cuenta de CLIENTE, así que se toma el
 * vinculado de ese tablero y se ignora el otro: sumar la del proveedor mezclaría lo que el cliente
 * nos debe con lo que le debemos.
 */
async function getCtaCteDeCliente(clienteId: string): Promise<string | null> {
  const data = await mondayApi<{ items: { column_values: ValorColumna[] }[] }>(
    `query ($ids: [ID!]) {
      items(ids: $ids) {
        column_values(ids: ["${COL.cliente.ctaCte}"]) {
          id
          ... on BoardRelationValue { linked_items { id board { id } } }
        }
      }
    }`,
    { ids: [clienteId] },
  )
  const vinculados = data.items?.[0]?.column_values?.[0]?.linked_items ?? []
  return vinculados.find((v) => v.board?.id === String(BOARDS.ctaCte))?.id ?? null
}

/* ===== Paso 2 · los movimientos de esa cuenta ===== */

/**
 * Los movimientos de la cuenta y, en la MISMA consulta, la "🤖Remito Pends de Facturar" del propio
 * ítem de la cuenta: es la mercadería entregada y todavía sin facturar que la ficha del resumen
 * muestra debajo del saldo.
 */
async function getCuenta(
  ctaCteId: string,
): Promise<{ subelementos: Subelemento[]; mercaderiaPendFacturar: number; nro: string }> {
  const s = COL.ctaCteSub
  const data = await mondayApi<{
    items: { column_values: ValorColumna[]; subitems: Subelemento[] | null }[]
  }>(
    `query ($ids: [ID!]) {
      items(ids: $ids) {
        column_values(ids: ["${COL.ctaCte.remitosPendFacturar}","${COL.ctaCte.nro}"]) { id text }
        subitems {
          id name
          column_values(ids: ["${s.movimiento}","${s.fechaEmision}","${s.saldoInicial}","${s.suma}","${s.resta}","${s.saldoFinal}","${s.origen}"]) {
            id text
            ... on StatusValue { index }
            ... on FormulaValue { display_value }
            ... on BoardRelationValue { linked_items { id name board { id } } }
          }
        }
      }
    }`,
    { ids: [ctaCteId] },
  )
  const cuenta = data.items?.[0]
  return {
    subelementos: cuenta?.subitems ?? [],
    /* Por id y no por posición: la API no garantiza el orden de las columnas pedidas. */
    mercaderiaPendFacturar: importe(
      cuenta?.column_values?.find((c) => c.id === COL.ctaCte.remitosPendFacturar),
    ),
    nro: cuenta?.column_values?.find((c) => c.id === COL.ctaCte.nro)?.text?.trim() ?? '',
  }
}

/* ===== El "🤖ID Anticipo" de los movimientos de anticipo ===== */

/**
 * El "🤖ID Anticipo" ("ANTICIPO-020") de cada movimiento de anticipo, por id de movimiento.
 *
 * El movimiento NO trae ese código: vive en el ítem del anticipo ("Anticipos y Credito x pase de
 * Saldo - Pends de Aplicar"). Para llegar a él se prueban tres caminos, del más firme al menos:
 *
 *   1. el anticipo conectado en el "🤖Origen" del movimiento;
 *   2. el anticipo que conecta a ESE movimiento en su propia relación con la cuenta corriente;
 *   3. el anticipo del cliente nacido del MISMO recibo: "Anticipo - RECIBO-074" en los dos lados.
 *
 * El tercero existe porque hoy los dos primeros vienen vacíos en el tablero (verificado): el recibo
 * que se lee en los dos nombres es el único vínculo que hay. Sólo se consideran los ítems cuyo
 * nombre empieza con "Anticipo": el crédito de un pase también vive en ese tablero y también
 * nombra un recibo, pero no es el anticipo de este movimiento.
 */
async function getIdsAnticipo(
  clienteId: string,
  movimientos: readonly { id: string; nombre: string; origenIds: readonly string[] }[],
): Promise<Map<string, string>> {
  const resultado = new Map<string, string>()
  if (movimientos.length === 0) return resultado

  const a = COL.anticipo
  const data = await mondayApi<{
    boards: {
      items_page: {
        items: {
          id: string
          name: string
          column_values: { id: string; text: string | null; linked_item_ids?: string[] }[]
        }[]
      }
    }[]
  }>(
    `query {
      boards(ids: [${BOARDS.anticipos}]) {
        items_page(
          limit: 500,
          query_params: {rules: [
            {column_id: "${a.cliente}", compare_value: [${Number(clienteId)}], operator: any_of}
          ]}
        ) {
          items {
            id name
            column_values(ids: ["${a.idAnticipo}","${a.movimientoCtaCte}"]) {
              id text
              ... on BoardRelationValue { linked_item_ids }
            }
          }
        }
      }
    }`,
  )

  const porItem = new Map<string, string>()
  const porMovimiento = new Map<string, string>()
  const porRecibo = new Map<string, string>()
  for (const item of data.boards?.[0]?.items_page.items ?? []) {
    const cols = Object.fromEntries(item.column_values.map((c) => [c.id, c]))
    const codigo = (cols[a.idAnticipo]?.text ?? '').trim()
    if (!codigo) continue
    porItem.set(item.id, codigo)
    for (const mov of cols[a.movimientoCtaCte]?.linked_item_ids ?? []) porMovimiento.set(String(mov), codigo)
    const recibo = reciboEn(item.name)
    if (recibo && /^anticipo\b/i.test(item.name.trim()) && !porRecibo.has(recibo)) {
      porRecibo.set(recibo, codigo)
    }
  }

  for (const m of movimientos) {
    const codigo =
      m.origenIds.map((id) => porItem.get(id)).find(Boolean) ??
      porMovimiento.get(m.id) ??
      porRecibo.get(reciboEn(m.nombre))
    if (codigo) resultado.set(m.id, codigo)
  }
  return resultado
}

/* ===== Paso 3 · número y vencimiento de las facturas conectadas ===== */

interface DatosFactura {
  /** "🤖ID Venta" de la venta de la factura ("VTA-111"). Vacío si no tiene la venta conectada. */
  nro: string
  /** "🤖Fecha Vto" de la factura, en ISO. */
  vencimiento: string
}

/**
 * El número y el vencimiento de cada factura, por id. El número NO está en la factura: es el
 * "🤖ID Venta" de la venta que la originó, un nivel más abajo en la relación "📈Ventas". Hoy ese es el
 * número con el que se identifica la factura; el día que la factura tenga su número real, se cambia
 * acá y la pantalla no se entera.
 *
 * Se consultan sólo las facturas de los movimientos que YA entraron en el período, y de a cien ids
 * por consulta, que es lo que acepta `items(ids:)`.
 */
async function getDatosFacturas(ids: readonly string[]): Promise<Map<string, DatosFactura>> {
  const datos = new Map<string, DatosFactura>()
  for (const lote of trozos([...new Set(ids)], IDS_POR_CONSULTA)) {
    const data = await mondayApi<{
      items: {
        id: string
        column_values: {
          id: string
          text: string | null
          linked_items?: { column_values: { id: string; text: string | null }[] }[]
        }[]
      }[]
    }>(
      `query ($ids: [ID!]) {
        items(ids: $ids) {
          id
          column_values(ids: ["${COL.factPendiente.fechaVencimiento}","${COL.factPendiente.venta}"]) {
            id text
            ... on BoardRelationValue {
              linked_items { column_values(ids: ["${COL.venta.idVenta}"]) { id text } }
            }
          }
        }
      }`,
      { ids: lote },
    )
    for (const item of data.items ?? []) {
      const cols = Object.fromEntries(item.column_values.map((c) => [c.id, c]))
      const venta = cols[COL.factPendiente.venta]?.linked_items?.[0]
      datos.set(item.id, {
        nro: (venta?.column_values?.[0]?.text ?? '').trim(),
        vencimiento: fechaIso(cols[COL.factPendiente.fechaVencimiento]),
      })
    }
  }
  return datos
}

/**
 * Los movimientos de la cuenta corriente del cliente que caen dentro del período pedido.
 *
 * El período se decide por la "🤖Fecha Emision" de cada movimiento. Los que no la tienen cargada no
 * se pueden ubicar en ningún período: quedan afuera y se CUENTAN (`sinFecha`), así la pantalla puede
 * decirlo en vez de mostrar un resumen que parece completo y no lo es.
 *
 * El filtro va sobre la respuesta y no como regla de la consulta: los subelementos se piden a través
 * de su ítem padre, y ahí Monday no acepta reglas. Es una sola cuenta, así que el volumen es acotado.
 *
 * Cada movimiento se nombra según su "🤖Movimiento" (ver `comprobanteDeMovimiento`). Una VENTA
 * PENDIENTE DE COBRO trae además el vencimiento de su factura, y se reconoce por DOS cosas a la vez:
 * su etiqueta y un "🤖Origen" que sea una factura de venta. Con sólo la conexión no alcanza —un cobro
 * también linkea la factura que canceló—.
 */
export async function getMovimientosCtaCte(
  cliente: Pick<Cliente, 'id' | 'codigo' | 'name'>,
  periodo: PeriodoResumen,
): Promise<MovimientosDelPeriodo> {
  if (!mondayHabilitado()) return movimientosMock(cliente, periodo)

  const ctaCteId = await getCtaCteDeCliente(cliente.id)
  if (!ctaCteId) {
    return { ctaCteId: null, ctaCteNro: '', movimientos: [], sinFecha: 0, mercaderiaPendFacturar: 0 }
  }

  const { subelementos, mercaderiaPendFacturar, nro } = await getCuenta(ctaCteId)
  const s = COL.ctaCteSub

  let sinFecha = 0
  const enPeriodo: {
    sub: Subelemento
    cols: Record<string, ValorColumna>
    clase: ClaseMovimiento
    facturaId: string | null
  }[] = []
  for (const sub of subelementos) {
    const cols = Object.fromEntries(sub.column_values.map((c) => [c.id, c]))
    const emision = fechaIso(cols[s.fechaEmision])
    if (!emision) {
      sinFecha += 1
      continue
    }
    if (!dentroDelPeriodo(emision, periodo)) continue
    const clase = claseDe(cols[s.movimiento])
    const factura =
      clase === 'venta'
        ? cols[s.origen]?.linked_items?.find((v) => v.board && TABLEROS_FACTURA_VENTA.has(v.board.id))
        : undefined
    enPeriodo.push({ sub, cols, clase, facturaId: factura?.id ?? null })
  }

  /* Los dos datos que viven en OTROS tableros se piden en paralelo, y sólo para los movimientos del
     período que los necesitan. */
  const [facturas, anticipos] = await Promise.all([
    getDatosFacturas(enPeriodo.map((m) => m.facturaId).filter((id): id is string => id !== null)),
    getIdsAnticipo(
      cliente.id,
      enPeriodo
        .filter((m) => m.clase === 'anticipo')
        .map((m) => ({
          id: m.sub.id,
          nombre: m.sub.name,
          origenIds: (m.cols[s.origen]?.linked_items ?? []).map((v) => v.id),
        })),
    ),
  ])

  const movimientos: MovimientoCtaCte[] = enPeriodo.map(({ sub, cols, clase, facturaId }) => {
    const factura = facturaId ? facturas.get(facturaId) : undefined
    const tipo = (cols[s.movimiento]?.text ?? '').trim()
    return {
      id: sub.id,
      comprobante: comprobanteDeMovimiento({
        clase,
        etiqueta: tipo,
        nombre: sub.name,
        cliente,
        nroFactura: factura?.nro,
        idAnticipo: anticipos.get(sub.id),
        nombresOrigen: (cols[s.origen]?.linked_items ?? []).map((v) => v.name ?? ''),
      }),
      tipo,
      emision: fechaIso(cols[s.fechaEmision]),
      vencimiento: factura?.vencimiento ?? '',
      saldoInicial: importe(cols[s.saldoInicial]),
      ventas: importe(cols[s.suma]),
      cobros: importe(cols[s.resta]),
      saldoFinal: importe(cols[s.saldoFinal]),
      esVentaPendiente: facturaId !== null,
    }
  })

  return { ctaCteId, ctaCteNro: nro, movimientos, sinFecha, mercaderiaPendFacturar }
}

/** Modo local: los movimientos de prueba, pasados por el MISMO filtro y las mismas reglas de nombre. */
function movimientosMock(
  cliente: Pick<Cliente, 'codigo' | 'name'>,
  periodo: { desde: string; hasta: string },
): MovimientosDelPeriodo {
  const pad = (n: number) => String(n).padStart(2, '0')
  const iso = (dias: number) => {
    const d = new Date()
    d.setDate(d.getDate() + dias)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }
  const sinFecha = MOVIMIENTOS_CTA_CTE_MOCK.filter((m) => m.diasAtras === null).length
  const movimientos = MOVIMIENTOS_CTA_CTE_MOCK.filter(
    (m) => m.diasAtras !== null && dentroDelPeriodo(iso(-m.diasAtras), periodo),
  ).map<MovimientoCtaCte>((m) => ({
    id: m.id,
    comprobante: comprobanteDeMovimiento({
      clase: m.clase,
      etiqueta: m.tipo,
      nombre: m.nombre,
      cliente,
      nroFactura: m.factura?.nro,
      idAnticipo: m.idAnticipo,
    }),
    tipo: m.tipo,
    emision: iso(-(m.diasAtras ?? 0)),
    vencimiento: m.factura ? iso(m.factura.venceEnDias) : '',
    saldoInicial: m.saldoInicial,
    ventas: m.ventas,
    cobros: m.cobros,
    saldoFinal: round2(m.saldoInicial + m.ventas - m.cobros),
    esVentaPendiente: m.clase === 'venta' && Boolean(m.factura),
  }))
  return {
    ctaCteId: 'ctacte-mock',
    ctaCteNro: 'CTACTEC-001',
    movimientos,
    sinFecha,
    mercaderiaPendFacturar: MERCADERIA_PEND_FACTURAR_MOCK,
  }
}

/* ===== Facturas que debe ===== */

/** Cuántas facturas se piden por página de la consulta (el máximo que acepta `items_page`). */
const FACTURAS_POR_CONSULTA = 500

/**
 * Índice de "🤖Estado de Vencimiento" → tramo. Es `ESTADO_VENCIMIENTO_INDEX` dado vuelta, y vive acá
 * —donde se mapea la factura— para que el resumen y la GESTIÓN DE COBRANZA lean el mismo tramo de la
 * misma columna.
 */
export const TRAMO_DE_INDICE: Record<number, TramoVencimiento> = Object.fromEntries(
  Object.entries(ESTADO_VENCIMIENTO_INDEX).map(([tramo, indice]) => [indice, tramo]),
) as Record<number, TramoVencimiento>

/** Índice de "🤖Estado de Vencimiento" → tono con el que se colorea en la tabla. */
const TONO_DE_VENCIMIENTO: Record<number, FacturaAdeudada['tonoVencimiento']> = {
  [ESTADO_VENCIMIENTO_INDEX.noVencido]: 'ok',
  [ESTADO_VENCIMIENTO_INDEX.vencido0a15]: 'alerta',
  [ESTADO_VENCIMIENTO_INDEX.vencido15a30]: 'alerta',
  [ESTADO_VENCIMIENTO_INDEX.vencido30a60]: 'vencida',
  [ESTADO_VENCIMIENTO_INDEX.vencidoMas60]: 'vencida',
}

/** Orden del listado: por vencimiento, la más vieja arriba; las que no tienen fecha, al final. */
export const porVencimiento = (a: FacturaAdeudada, b: FacturaAdeudada): number => {
  if (!a.vencimiento) return b.vencimiento ? 1 : 0
  if (!b.vencimiento) return -1
  return a.vencimiento < b.vencimiento ? -1 : a.vencimiento > b.vencimiento ? 1 : 0
}

export interface ItemFactura {
  id: string
  name: string
  column_values: ValorColumna[]
}

/**
 * Las columnas con las que se lee una factura adeudada. Se exporta —igual que `mapFacturaAdeudada`—
 * porque la GESTIÓN DE COBRANZA lista las MISMAS facturas del mismo tablero: con dos juegos de
 * columnas y dos mapeos, una pantalla podía empezar a mostrar un importe distinto de la otra.
 */
export const CAMPOS_FACTURA_ADEUDADA = `
  id name
  column_values(ids: ["${COL.factPendiente.estado}","${COL.factPendiente.fechaEmision}","${COL.factPendiente.total}","${COL.factPendiente.cobrado}","${COL.factPendiente.pendiente}","${COL.factPendiente.fechaVencimiento}","${COL.factPendiente.estadoVencimiento}"]) {
    id text
    ... on StatusValue { index }
    ... on MirrorValue { display_value }
    ... on FormulaValue { display_value }
  }`

export function mapFacturaAdeudada(
  item: ItemFactura,
  cliente: Pick<Cliente, 'codigo' | 'name'>,
): FacturaAdeudada {
  const c = Object.fromEntries(item.column_values.map((cv) => [cv.id, cv]))
  const f = COL.factPendiente
  const vencimiento = c[f.estadoVencimiento]
  return {
    id: item.id,
    comprobante: nroDeFactura(item.name, cliente),
    estadoCobro: c[f.estado]?.text?.trim() ?? '',
    emision: fechaIso(c[f.fechaEmision]),
    vencimiento: fechaIso(c[f.fechaVencimiento]),
    importe: importe(c[f.total]),
    /* "🤖Cobrado $" es un MIRROR de los subelementos de la factura: con más de un cobro llega como
       lista ("100000, 10000"), así que se SUMA. Pasarla entera por `num` borraría las comas y
       concatenaría los números. Sin cobros llega vacía y suma 0. */
    cobrado: round2(
      sumaMirror({ id: f.cobrado, text: c[f.cobrado]?.text ?? null, display_value: c[f.cobrado]?.display_value }),
    ),
    pendiente: importe(c[f.pendiente]),
    estadoVencimiento: vencimiento?.text?.trim() ?? '',
    tonoVencimiento:
      vencimiento?.index != null ? (TONO_DE_VENCIMIENTO[vencimiento.index] ?? null) : null,
    tramo: vencimiento?.index != null ? (TRAMO_DE_INDICE[vencimiento.index] ?? null) : null,
  }
}

/**
 * Las facturas que el cliente todavía debe: las de "💰Fact Vtas Pends de Cobro" (18421035508)
 * conectadas a él en "🤖Personas" y cuyo "🤖Estado de Cobro" NO es "Cancelada 100%".
 *
 * Los dos filtros van como REGLAS de la consulta. El del estado es `not_any_of` y no un `any_of` con
 * los otros estados: así también entra una factura con el estado vacío, que sin cancelar sigue siendo
 * deuda. El id del cliente va como NÚMERO (con comillas la consulta devuelve 0 ítems sin fallar).
 *
 * Se recorren TODAS las páginas de la consulta con su cursor: la tabla pagina en pantalla, pero los
 * totales tienen que sumar la deuda entera.
 */
export async function getFacturasAdeudadas(
  cliente: Pick<Cliente, 'id' | 'codigo' | 'name'>,
): Promise<FacturaAdeudada[]> {
  if (!cliente.id) return []
  if (!mondayHabilitado()) return facturasAdeudadasMock(cliente)

  const f = COL.factPendiente
  type Pagina = { cursor: string | null; items: ItemFactura[] }
  const primera = await mondayApi<{ boards: { items_page: Pagina }[] }>(
    `query {
      boards(ids: [${BOARDS.factPendientes}]) {
        items_page(
          limit: ${FACTURAS_POR_CONSULTA},
          query_params: {rules: [
            {column_id: "${f.cliente}", compare_value: [${Number(cliente.id)}], operator: any_of},
            {column_id: "${f.estado}", compare_value: [${FACT_PENDIENTE_ESTADO_INDEX.cancelada}], operator: not_any_of}
          ]}
        ) {
          cursor
          items { ${CAMPOS_FACTURA_ADEUDADA} }
        }
      }
    }`,
  )
  const items = [...(primera.boards?.[0]?.items_page.items ?? [])]
  let cursor = primera.boards?.[0]?.items_page.cursor ?? null
  while (cursor) {
    const siguiente: { next_items_page: Pagina } = await mondayApi(
      `query ($cursor: String!) {
        next_items_page(limit: ${FACTURAS_POR_CONSULTA}, cursor: $cursor) {
          cursor
          items { ${CAMPOS_FACTURA_ADEUDADA} }
        }
      }`,
      { cursor },
    )
    items.push(...(siguiente.next_items_page?.items ?? []))
    cursor = siguiente.next_items_page?.cursor ?? null
  }

  return items.map((it) => mapFacturaAdeudada(it, cliente)).sort(porVencimiento)
}

/** Modo local: las facturas de prueba de COBROS, con la misma forma y el mismo orden. */
function facturasAdeudadasMock(cliente: Pick<Cliente, 'codigo' | 'name'>): FacturaAdeudada[] {
  const hoyIso = new Date().toISOString().slice(0, 10)
  return FACTURAS_PENDIENTES.map<FacturaAdeudada>((fp) => {
    const vencida = !!fp.vencimiento && fp.vencimiento < hoyIso
    return {
      id: fp.id,
      comprobante: nroDeFactura(`${fp.idVenta || fp.nro} - ${cliente.codigo} - ${cliente.name}`, cliente),
      estadoCobro: fp.estado,
      emision: fp.emision,
      vencimiento: fp.vencimiento,
      importe: fp.total,
      cobrado: fp.cobrado,
      pendiente: fp.pendiente,
      estadoVencimiento: vencida ? 'Vencido + 60' : 'No vencido',
      tonoVencimiento: vencida ? 'vencida' : 'ok',
      tramo: vencida ? 'vencido30a60' : 'noVencido',
    }
  }).sort(porVencimiento)
}

/* ===== Generación del resumen ===== */

/**
 * Deja escrito en la cuenta QUÉ se genera: el FORMATO del archivo, el PERÍODO que abarca ("🤖Fecha
 * Desde" / "🤖Fecha Hasta") y si va CON el estado de la cuenta ("🤖Incluye Estado Cta Cte"). Va antes
 * del pedido de generación, y en UNA sola mutación: la automatización lee el ítem para saber qué
 * armar, así que las columnas tienen que estar puestas —y ser del mismo pedido— cuando la columna de
 * estado se mueva.
 */
export async function escribirDatosResumen(
  ctaCteId: string,
  formato: FormatoResumen,
  periodo: { desde: string; hasta: string },
  incluyeEstado: boolean,
): Promise<void> {
  if (!mondayHabilitado()) return
  await mondayApi(
    `mutation ($id: ID!, $board: ID!, $cv: JSON!) {
      change_multiple_column_values(item_id: $id, board_id: $board, column_values: $cv) { id }
    }`,
    {
      id: ctaCteId,
      board: BOARDS.ctaCte,
      cv: JSON.stringify(columnasDatosResumen(formato, periodo, incluyeEstado)),
    },
  )
}

/**
 * Los `column_values` de esa mutación. Aparte para poder verificarlos sin tocar la API.
 *
 * El checkbox se tilda con `{ checked: "true" }` y se destilda mandando `null`, que es como la API de
 * Monday limpia esa columna. Se escribe SIEMPRE, también en `false`: si la cuenta quedó tildada de un
 * resumen anterior, un NO INCLUIR tiene que destildarla.
 */
export const columnasDatosResumen = (
  formato: FormatoResumen,
  periodo: { desde: string; hasta: string },
  incluyeEstado: boolean,
): Record<string, unknown> => ({
  [COL.ctaCte.formatoResumen]: { ids: FORMATO_RESUMEN_IDS[formato] },
  [COL.ctaCte.fechaDesdeResumen]: { date: periodo.desde },
  [COL.ctaCte.fechaHastaResumen]: { date: periodo.hasta },
  [COL.ctaCte.incluyeEstadoResumen]: incluyeEstado ? { checked: 'true' } : null,
})

/* ===== Registro del resumen emitido ===== */

/** Lo que "Registrar Resumen" necesita: sobre qué cuenta, en qué formato y de qué período. */
export interface DatosRegistroResumen {
  ctaCteId: string
  /**
   * El cliente en Personas: el dueño del timeline donde se crea la actividad del envío (el
   * "🤖Personas" de la cuenta, que es el que usaba el escenario).
   */
  clienteId: string
  formato: FormatoResumen
  /** Las dos puntas del período del resumen, en ISO (yyyy-MM-dd). */
  periodo: { desde: string; hasta: string }
  /** En el paso 1 se eligió INCLUIR el estado de la cuenta corriente. */
  incluyeEstado: boolean
}

/** A quiénes se les envió el resumen y por dónde: lo que la actividad deja asentado. */
export interface EnvioDelResumen {
  medio: MedioEnvio
  contactos: readonly { itemId: string; nombre: string }[]
}

/**
 * Hasta dónde llegó un "Registrar Resumen" que se cortó. Cada paso que ya se hizo NO se repite al
 * reintentar: volver a crear la actividad del timeline dejaría DOS actividades del mismo envío.
 */
export interface AvanceRegistroResumen {
  /** Los archivos ya subidos a "🤖Resumen Cta Cte", con su link. */
  archivos: ArchivoSubido[] | null
  /** La actividad del timeline ya se creó: desde cuándo buscar su ítem en "Actividades". */
  actividadDesde: string | null
}

export const AVANCE_REGISTRO_RESUMEN_INICIAL: AvanceRegistroResumen = { archivos: null, actividadDesde: null }

/** Cuántas veces, y cada cuánto, se busca en "Actividades" el ítem de la actividad recién creada. */
const BUSQUEDA_ACTIVIDAD = { intentos: 8, esperaMs: 2500 }
/** Margen contra la diferencia de reloj entre la PC y Monday al comparar fechas de creación. */
const MARGEN_RELOJ_MS = 2 * 60 * 1000

const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** El formato de fecha que pide `create_timeline_item`: ISO 8601 sin milisegundos. */
const timestampActividad = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, 'Z')

/** En qué paso se cortó un "Registrar Resumen": lo que la ventana de la app le cuenta al usuario. */
export type PasoRegistroResumen = 'archivos' | 'actividad' | 'completar'

/**
 * El registro no se pudo terminar. NO se deja rastro en Monday —ni update ni cambio de estado—: el
 * aviso es sólo de la app, con el paso en el que se cortó.
 */
export class ErrorRegistroResumen extends Error {
  constructor(
    readonly paso: PasoRegistroResumen,
    readonly causa: unknown,
  ) {
    super(`No se pudo registrar el resumen (paso: ${paso}): ${causa instanceof Error ? causa.message : String(causa)}`)
    this.name = 'ErrorRegistroResumen'
  }
}

/** Corre un paso y, si falla, lo marca con su nombre. */
async function paso<T>(nombre: PasoRegistroResumen, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    throw e instanceof ErrorRegistroResumen ? e : new ErrorRegistroResumen(nombre, e)
  }
}

/**
 * "Registrar Resumen": deja asentado en Monday el resumen que la app emitió Y ENVIÓ. Hace lo que antes
 * hacía el escenario de Make "Cuando 🤖Estado de Registro Actividad cambia a Registrar", más la carga
 * de los archivos que antes hacía el de generación:
 *
 *   1. en la cuenta, los datos del pedido —formato, período, si incluye el estado—, los contactos y
 *      el medio del envío, y los archivos emitidos en "🤖Resumen Cta Cte" REEMPLAZANDO los de la
 *      emisión anterior;
 *   2. la actividad "Envío de Resumen de cuenta corriente" en el timeline del cliente, con el título
 *      y el contenido del escenario (ver `lib/actividadResumen`);
 *   3. el ítem que Monday crea para esa actividad en "Actividades": se lo busca —tarda unos segundos
 *      en aparecer— y se le asignan los contactos, "Completado" y el modo de carga "Automatico".
 *
 * NO toca "🤖Estado Resumen Cta Cte" ni "🤖Estado de Registro Actividad Resumen Cta Cte", ni deja updates: si algo falla, lanza un
 * `ErrorRegistroResumen` y el aviso lo muestra la app. Tampoco escribe "Generar" ni "Registrar", los
 * disparadores de los escenarios de Make viejos.
 *
 * Reanudable: `avance` dice qué pasos ya se hicieron y `alAvanzar` avisa cada uno que se completa, así
 * un reintento no vuelve a crear la actividad.
 */
export async function registrarResumenCtaCte(
  datos: DatosRegistroResumen,
  archivos: readonly ArchivoCtaCte[],
  envio: EnvioDelResumen,
  avance: AvanceRegistroResumen = AVANCE_REGISTRO_RESUMEN_INICIAL,
  alAvanzar: (avance: AvanceRegistroResumen) => void = () => {},
): Promise<void> {
  if (!mondayHabilitado()) return
  const { ctaCteId, clienteId, formato, periodo, incluyeEstado } = datos
  const contactoIds = envio.contactos.map((c) => Number(c.itemId)).filter((n) => Number.isFinite(n) && n > 0)
  let actual = avance
  const avanzar = (parcial: Partial<AvanceRegistroResumen>) => {
    actual = { ...actual, ...parcial }
    alAvanzar(actual)
  }

  /* 1 · La cuenta. La columna de archivos se vacía primero: sin esto, los de este resumen se sumarían
     a los del anterior y la cuenta quedaría con dos resúmenes mezclados. */
  if (!actual.archivos) {
    const subidos = await paso('archivos', async () => {
      await escribirColumnas(ctaCteId, BOARDS.ctaCte, {
        ...columnasDatosResumen(formato, periodo, incluyeEstado),
        [COL.ctaCte.archivoResumen]: { clear_all: true },
        [COL.ctaCte.contactosResumen]: { item_ids: contactoIds },
        [COL.ctaCte.medioEnvioResumen]: { ids: MEDIO_ENVIO_RESUMEN_IDS[envio.medio] },
      })
      // En serie: la columna los muestra en el orden en que llegan.
      const lista: ArchivoSubido[] = []
      for (const a of archivos) {
        const subido = await subirArchivoAColumna(ctaCteId, COL.ctaCte.archivoResumen, a.archivo)
        lista.push(subido ?? { id: '', nombre: a.archivo.name, url: '' })
      }
      return lista
    })
    avanzar({ archivos: subidos })
  }

  /* 2 · La actividad en el timeline del cliente. */
  if (!actual.actividadDesde) {
    const ahora = new Date()
    await paso('actividad', () =>
      crearActividadTimeline(clienteId, {
        titulo: tituloActividadResumen({ periodo, contactos: envio.contactos.map((c) => c.nombre) }),
        contenido: contenidoActividadResumen({
          archivos: actual.archivos ?? [],
          remitente: ACTIVIDAD_ENVIO_RESUMEN.remitente,
        }),
        timestamp: timestampActividad(ahora),
      }),
    )
    avanzar({ actividadDesde: new Date(ahora.getTime() - MARGEN_RELOJ_MS).toISOString() })
  }

  /* 3 · Su ítem en "Actividades": los contactos, completada y cargada en automático. */
  await paso('completar', async () => {
    const actividadId = await buscarActividadCreada(clienteId, actual.actividadDesde!)
    if (!actividadId) {
      throw new Error('El ítem de la actividad todavía no aparece en el tablero de Actividades.')
    }
    await escribirColumnas(actividadId, BOARDS.actividades, {
      [COL.actividad.contactos]: { item_ids: contactoIds },
      [COL.actividad.estado]: { label: 'Completado' },
      [COL.actividad.modoCarga]: { label: 'Automatico' },
    })
  })
}

/** `create_timeline_item`: la actividad personalizada del envío, en el timeline de la persona. */
async function crearActividadTimeline(
  personaId: string,
  a: { titulo: string; contenido: string; timestamp: string },
): Promise<void> {
  await mondayApi(
    `mutation ($item: ID!, $tipo: String!, $titulo: String!, $contenido: String, $ts: ISO8601DateTime!) {
      create_timeline_item(
        item_id: $item
        custom_activity_id: $tipo
        title: $titulo
        content: $contenido
        timestamp: $ts
      ) { id }
    }`,
    {
      item: personaId,
      tipo: ACTIVIDAD_ENVIO_RESUMEN.customActivityId,
      titulo: a.titulo,
      contenido: a.contenido,
      ts: a.timestamp,
    },
  )
}

/**
 * El ítem que Monday crea en "Actividades" para la actividad recién creada: el ÚLTIMO de la persona
 * con el tipo "Envío de Resumen", siempre que haya nacido DESPUÉS de crear la actividad —uno anterior
 * es la actividad de otro envío, y completarlo sería pisar la de otro resumen—.
 *
 * Monday lo crea unos segundos después de la actividad (el escenario esperaba 10 s), así que se lo
 * busca varias veces antes de darse por vencido. `null` = no apareció.
 */
async function buscarActividadCreada(personaId: string, desdeIso: string): Promise<string | null> {
  const desde = Date.parse(desdeIso)
  for (let intento = 0; intento < BUSQUEDA_ACTIVIDAD.intentos; intento++) {
    await esperar(BUSQUEDA_ACTIVIDAD.esperaMs)
    const data = await mondayApi<{ boards: { items_page: { items: { id: string; created_at: string }[] } }[] }>(
      `query {
        boards(ids: [${BOARDS.actividades}]) {
          items_page(
            limit: 1
            query_params: {
              rules: [
                {column_id: "${COL.actividad.persona}", compare_value: [${Number(personaId)}], operator: any_of}
                {column_id: "${COL.actividad.tipo}", compare_value: [${ACTIVIDAD_ENVIO_RESUMEN.tipoIndex}], operator: any_of}
              ]
              operator: and
              order_by: [{column_id: "__creation_log__", direction: desc}]
            }
          ) { items { id created_at } }
        }
      }`,
    )
    const item = data.boards?.[0]?.items_page?.items?.[0]
    if (item && (!Number.isFinite(desde) || Date.parse(item.created_at) >= desde)) return item.id
  }
  return null
}
