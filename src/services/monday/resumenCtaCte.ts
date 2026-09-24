/**
 * RESUMEN DE CTA CTE: lectura de los movimientos de la cuenta corriente del cliente y pedido de
 * generación del resumen. Tablero "💵Cta Cte Cliente" (18421858736).
 *
 * La cuenta es UN ítem por cliente y cada movimiento es un SUBELEMENTO suyo (18421858762). La app
 * NO escribe ningún movimiento: los lee, los filtra por período y los muestra. Lo único que escribe
 * es sobre el ítem de la cuenta, para pedirle al tablero que genere el archivo:
 *
 *   1. "🤖Formato Archivo Resumen Cta Cte" con el formato elegido (Excel o PDF);
 *   2. le pide el resumen DIRECTO al escenario de Make y espera su respuesta, que dice qué documento
 *      salió (`emitirResumenPorApp`).
 *
 * La app NO mueve "🤖Estado Resumen Cta Cte" a "Generar": ése es el disparador de la automatización
 * de Monday, que llama al MISMO escenario, y moverlo generaría el resumen dos veces.
 */
import { FACTURAS_PENDIENTES, MERCADERIA_PEND_FACTURAR_MOCK, MOVIMIENTOS_CTA_CTE_MOCK } from '@/data/mock'
import { round2 } from '@/lib/format'
import {
  comprobanteDeMovimiento,
  dentroDelPeriodo,
  nroDeFactura,
  reciboEn,
  type ClaseMovimiento,
} from '@/lib/resumenCtaCte'
import type {
  Cliente,
  DocumentosEmision,
  EstadoDocumentoEmision,
  FacturaAdeudada,
  FormatoResumen,
  MedioEnvio,
  MovimientoCtaCte,
  MovimientosDelPeriodo,
  PeriodoResumen,
  TramoVencimiento,
} from '@/types'
import {
  BOARDS,
  COL,
  ESTADO_ENVIO_RESUMEN_INDEX,
  ESTADO_RESUMEN_INDEX,
  ESTADO_VENCIMIENTO_INDEX,
  FACT_PENDIENTE_ESTADO_INDEX,
  FORMATO_RESUMEN_IDS,
  MEDIO_ENVIO_RESUMEN_IDS,
  MOVIMIENTO_CTA_CTE_CLIENTE_INDEX,
} from './columns'
import { num, sumaMirror } from './parse'
import { cabecerasPropias, mondayApi, mondayHabilitado, verificarRespuesta } from './sdk'
/* El armado del evento y la lectura de la respuesta son los MISMOS que usa la función de Vercel:
   el módulo es puro, sin nada de Node, para que en desarrollo lo use el navegador. */
import {
  COL_ESTADO_RESUMEN,
  comoJson,
  CONSULTA_ITEM,
  eventoDeResumen,
  type ItemCtaCte,
} from '../../../api/_eventoResumen'
import {
  COL_ARCHIVO_RESUMEN,
  CONSULTA_ARCHIVOS,
  pdfDelDocumento,
  sinPdf,
  type ArchivoCtaCte,
  type DocumentoArchivo,
} from '../../../api/_archivoResumen'

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
): Promise<{ subelementos: Subelemento[]; mercaderiaPendFacturar: number }> {
  const s = COL.ctaCteSub
  const data = await mondayApi<{
    items: { column_values: ValorColumna[]; subitems: Subelemento[] | null }[]
  }>(
    `query ($ids: [ID!]) {
      items(ids: $ids) {
        column_values(ids: ["${COL.ctaCte.remitosPendFacturar}"]) { id text }
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
    mercaderiaPendFacturar: importe(cuenta?.column_values?.[0]),
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
  if (!ctaCteId) return { ctaCteId: null, movimientos: [], sinFecha: 0, mercaderiaPendFacturar: 0 }

  const { subelementos, mercaderiaPendFacturar } = await getCuenta(ctaCteId)
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

  return { ctaCteId, movimientos, sinFecha, mercaderiaPendFacturar }
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
  return { ctaCteId: 'ctacte-mock', movimientos, sinFecha, mercaderiaPendFacturar: MERCADERIA_PEND_FACTURAR_MOCK }
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

/**
 * En qué anda la generación, según el tablero, reducida a lo que le importa a quien espera. Una
 * columna vacía o todavía en "Generar" cuenta como en curso: la automatización recién arranca.
 *
 * Ya no la usa la emisión de la app —el escenario contesta con el desenlace—: queda como la lectura
 * del estado para quien la necesite. En modo local sin token se responde "Generado" de una.
 */
export async function getEstadoResumenCtaCte(
  ctaCteId: string,
): Promise<{ fase: 'en-curso' | 'emitido' | 'error'; label: string }> {
  if (!mondayHabilitado()) return { fase: 'emitido', label: 'Generado' }
  const data = await mondayApi<{ items: { column_values: ValorColumna[] }[] }>(
    `query ($ids: [ID!]) {
      items(ids: $ids) {
        column_values(ids: ["${COL.ctaCte.estadoResumen}"]) { id text ... on StatusValue { index } }
      }
    }`,
    { ids: [ctaCteId] },
  )
  const cv = data.items?.[0]?.column_values?.[0]
  const label = cv?.text?.trim() ?? ''
  if (cv?.index === ESTADO_RESUMEN_INDEX.generado) return { fase: 'emitido', label }
  if (cv?.index === ESTADO_RESUMEN_INDEX.error) return { fase: 'error', label }
  return { fase: 'en-curso', label }
}

/* ===== Generación pedida por la app, directo al escenario ===== */

/**
 * Cómo cerró una emisión pedida por la app, ya traducida a lo que muestra la pantalla: la fase del
 * botón, el avance de cada card y, si falló, qué decirle al usuario.
 */
export interface CierreResumen {
  fase: 'emitido' | 'error'
  label: string
  documentos: DocumentosEmision
  /** Qué se le dice al usuario cuando la emisión cerró en error. */
  mensaje?: string
  /** El detalle técnico, informativo, cuando el que falló fue un módulo del escenario. */
  detalle?: string
}

/**
 * Le pide el resumen DIRECTO al escenario de Make, por `/api/resumen-cta-cte`, y espera a que
 * termine: el escenario contesta al final con qué documento salió y cuál no. La función arma el
 * evento con la forma del de Monday más el `appJobId`.
 *
 * NO mueve "🤖Estado Resumen Cta Cte" a "Generar": eso dispararía también la automatización de
 * Monday y el resumen saldría dos veces.
 *
 * En desarrollo no hay funciones serverless: el evento se arma acá y sale por el proxy de Vite
 * (`/make-resumen-cta-cte`, ver `emitirResumenEnLocal`). Nunca se toca la columna de estado.
 */
export async function emitirResumenPorApp(
  ctaCteId: string,
  formato: FormatoResumen,
  incluyeEstado: boolean,
): Promise<CierreResumen> {
  if (import.meta.env.DEV) return emitirResumenEnLocal(ctaCteId, formato, incluyeEstado)
  const res = await fetch('/api/resumen-cta-cte', {
    method: 'POST',
    headers: await cabecerasPropias({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ ctaCteId }),
  })
  /* Los rechazos de seguridad levantan su ventana. Un 5xx de la función —no pudo leer la cuenta en
     Monday— es de esta emisión y se cuenta en el botón, no como la app caída. */
  if (res.status === 401 || res.status === 403 || res.status === 429) {
    await verificarRespuesta(res, 'Resumen de cta cte')
  }
  if (!res.ok) {
    throw new Error('No pudimos iniciar la generación del resumen. Probá de nuevo en unos minutos.')
  }
  const { status, cuerpo } = (await res.json()) as { status: number; cuerpo: unknown }
  return interpretarRespuestaResumen(status, cuerpo, formato, incluyeEstado)
}

/**
 * La misma emisión, en localhost: lo que en producción hace `api/resumen-cta-cte.ts` —leer el ítem,
 * armar el evento con la forma del de Monday y mandárselo al webhook— se hace desde el navegador,
 * con el token de desarrollo y por el proxy de Vite. La dirección del webhook sale de
 * `MAKE_WEBHOOK_RESUMEN_CTA_CTE` en `.env.local` y no entra al bundle.
 *
 * Sin token de Monday (datos mock) no hay cuenta real sobre la cual generar: se da por emitido.
 */
async function emitirResumenEnLocal(
  ctaCteId: string,
  formato: FormatoResumen,
  incluyeEstado: boolean,
): Promise<CierreResumen> {
  if (!mondayHabilitado()) {
    return {
      fase: 'emitido',
      label: 'Generado',
      documentos: { resumen: 'ok', estado: incluyeEstado ? 'ok' : 'no_pedido' },
    }
  }
  const [data, yo] = await Promise.all([
    mondayApi<{ items: ItemCtaCte[] }>(CONSULTA_ITEM, { ids: [ctaCteId], col: [COL_ESTADO_RESUMEN] }),
    // El usuario del token de desarrollo: en producción es el del session token firmado.
    mondayApi<{ me: { id: string } }>('query { me { id } }'),
  ])
  const item = data.items?.[0]
  if (!item) throw new Error('No se encontró la cuenta corriente del cliente.')

  const event = eventoDeResumen({ item, userId: yo.me.id, appJobId: `rcc_local_${crypto.randomUUID()}` })
  const res = await fetch('/make-resumen-cta-cte', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event }),
  })
  // Sin la variable, el proxy no existe y Vite contesta 404 con su propia página.
  if (res.status === 404 && !res.headers.get('content-type')?.includes('json')) {
    throw new Error('Falta MAKE_WEBHOOK_RESUMEN_CTA_CTE en .env.local (y reiniciar `npm run dev`).')
  }
  return interpretarRespuestaResumen(res.status, comoJson(await res.text()), formato, incluyeEstado)
}

/** Lo que puede contestar el escenario, en cualquiera de sus salidas. */
interface RespuestaEscenario {
  resultado?: string
  documento?: string | null
  formato?: string | null
  mensajeError?: string | null
  [generado: string]: unknown
}

type DocumentoPedido = 'resumen' | 'estado'

const NOMBRE_DOCUMENTO: Record<DocumentoPedido, string> = {
  resumen: 'Resumen de Cta Cte',
  estado: 'Estado de Cta Cte',
}
const FORMATOS_DE: Record<FormatoResumen, readonly ('pdf' | 'excel')[]> = {
  PDF: ['pdf'],
  Excel: ['excel'],
  Ambos: ['pdf', 'excel'],
}
const CONTACTAR_SOPORTE = 'Contactate con soporte para revisar lo sucedido.'

/**
 * Las banderas `*_generado` llegan como BOOLEANOS: el escenario las mapea sin comillas. Sólo `true`
 * cuenta como generado; `false` o `null` —la variable quedó vacía y el servidor la repara a `null`,
 * ver `comoJson` en `api/resumen-cta-cte.ts`— es un documento que no salió. El texto `"true"` se
 * acepta igual, por si un escenario viejo las sigue mandando entre comillas.
 */
const generado = (v: unknown): boolean =>
  v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true')

/** "El Resumen de Cta Cte y el Estado de Cta Cte NO se pudieron emitir. Contactate con soporte…" */
export function avisoDocumentosFallidos(fallidos: readonly DocumentoPedido[]): string {
  const sujeto = fallidos.map((d) => `el ${NOMBRE_DOCUMENTO[d]}`).join(' y ')
  const verbo = fallidos.length > 1 ? 'NO se pudieron emitir' : 'NO se pudo emitir'
  return `${sujeto.charAt(0).toUpperCase()}${sujeto.slice(1)} ${verbo}. ${CONTACTAR_SOPORTE}`
}

/**
 * El `mensajeError` de la validación trae un renglón "- …" por cada chequeo, y los que pasaron
 * quedan como "- " vacíos (su `if` da `null`). Se sacan esos renglones y los espacios de sobra.
 */
export function limpiarMensajeError(texto: string): string {
  return texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^[-•]\s*$/.test(l))
    .join('\n')
}

/**
 * Traduce la respuesta del escenario —status HTTP y cuerpo— a cómo cierra la emisión en pantalla.
 *
 *   · 200 `completado`   · cada documento pedido se da por emitido si TODOS sus formatos salieron
 *                          (con "Ambos", PDF y Excel). Alguno emitido → la emisión cierra bien y la
 *                          pantalla avisa lo que faltó; ninguno → error.
 *   · `error_validacion` · no se generó nada: el `mensajeError` del escenario, tal cual.
 *   · `error_emision`    · falló un documento. Si el que falló fue el módulo que arma el archivo
 *                          (PDF.co / Excel), su mensaje es técnico: queda como detalle, y al usuario
 *                          se le dice qué no salió y a quién recurrir.
 */
export function interpretarRespuestaResumen(
  status: number,
  cuerpo: unknown,
  formato: FormatoResumen,
  incluyeEstado: boolean,
): CierreResumen {
  const r = (cuerpo && typeof cuerpo === 'object' ? cuerpo : {}) as RespuestaEscenario
  const pedidos: DocumentoPedido[] = incluyeEstado ? ['resumen', 'estado'] : ['resumen']
  const todos = (e: EstadoDocumentoEmision): DocumentosEmision => ({
    resumen: e,
    estado: incluyeEstado ? e : 'no_pedido',
  })
  const mensajeError = typeof r.mensajeError === 'string' ? limpiarMensajeError(r.mensajeError) : ''
  const error = (documentos: DocumentosEmision, mensaje: string, detalle?: string): CierreResumen => ({
    fase: 'error',
    label: 'Error en emisión',
    documentos,
    mensaje,
    ...(detalle ? { detalle } : {}),
  })

  if (status >= 200 && status < 300 && r.resultado === 'completado') {
    const salio = (doc: DocumentoPedido) =>
      FORMATOS_DE[formato].every((f) => generado(r[`${doc}_${f}_generado`]))
    const documentos: DocumentosEmision = {
      resumen: salio('resumen') ? 'ok' : 'error',
      estado: incluyeEstado ? (salio('estado') ? 'ok' : 'error') : 'no_pedido',
    }
    const fallidos = pedidos.filter((d) => documentos[d] === 'error')
    if (fallidos.length < pedidos.length) return { fase: 'emitido', label: 'Generado', documentos }
    return error(documentos, avisoDocumentosFallidos(fallidos))
  }

  if (r.resultado === 'error_validacion') {
    return error(todos('error'), mensajeError || `No pudimos generar el resumen. ${CONTACTAR_SOPORTE}`)
  }

  if (r.resultado === 'error_emision') {
    const doc: DocumentoPedido | null =
      r.documento === 'estado_cta_cte' ? 'estado' : r.documento === 'resumen_cta_cte' ? 'resumen' : null
    const documentos: DocumentosEmision = doc ? { ...todos('pendiente'), [doc]: 'error' } : todos('error')
    if (mensajeError && !/^error en m[oó]dulo/i.test(mensajeError)) return error(documentos, mensajeError)
    const f = r.formato?.toLowerCase()
    const archivo = f === 'excel' ? 'el Excel' : f === 'pdf' ? 'el PDF' : 'el archivo'
    return error(
      documentos,
      `Ocurrió un error al generar ${archivo}${doc ? ` del ${NOMBRE_DOCUMENTO[doc]}` : ''}. ${CONTACTAR_SOPORTE}`,
      mensajeError || undefined,
    )
  }

  // Un rechazo de la propia función (cuenta inválida, webhook que no respondió…): trae su mensaje.
  if (r.resultado === 'error_app' && mensajeError) return error(todos('pendiente'), mensajeError)

  if (status === 410) {
    return error(
      todos('pendiente'),
      'El generador de resúmenes está pausado. Avisale al administrador y volvé a intentarlo.',
    )
  }

  /* Un 2xx sin resultado —el "Accepted" que Make contesta solo cuando el escenario no llega a un
     Webhook Response— o un status que el escenario no declara: no se sabe qué se generó. */
  return {
    fase: 'error',
    label: 'Emisión sin confirmar',
    documentos: todos('pendiente'),
    mensaje: `No pudimos confirmar la emisión de los documentos. ${CONTACTAR_SOPORTE}`,
  }
}

/* ===== PDF del resumen emitido ===== */

/**
 * El PDF de un documento de la última emisión, tal cual quedó en "🤖Resumen Cta Cte" de la cuenta,
 * para abrirlo en una pestaña e imprimirlo desde ahí.
 *
 * En producción lo baja `/api/resumen-archivo`: el enlace de Monday lo serviría como descarga (ver
 * el encabezado de esa función). En desarrollo no hay funciones serverless: el archivo se elige acá,
 * con el token de desarrollo, y se baja por el proxy de Vite (`/monday-files`).
 */
export async function pdfDeResumen(ctaCteId: string, documento: DocumentoArchivo): Promise<Blob> {
  if (import.meta.env.DEV) return pdfDeResumenEnLocal(ctaCteId, documento)
  const res = await fetch('/api/resumen-archivo', {
    method: 'POST',
    headers: await cabecerasPropias({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ ctaCteId, documento }),
  })
  /* Como en la emisión: los rechazos de seguridad levantan su ventana, y el resto de los errores son
     de este PDF y se cuentan al lado del botón. */
  if (res.status === 401 || res.status === 403 || res.status === 429) {
    await verificarRespuesta(res, 'PDF del resumen')
  }
  if (!res.ok) {
    const cuerpo = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(
      res.status === 404 && cuerpo.error ? cuerpo.error : 'No pudimos abrir el PDF. Probá de nuevo en unos minutos.',
    )
  }
  return res.blob()
}

async function pdfDeResumenEnLocal(ctaCteId: string, documento: DocumentoArchivo): Promise<Blob> {
  if (!mondayHabilitado()) throw new Error('Sin conexión a Monday no hay un PDF para mostrar.')
  const data = await mondayApi<{ items: { assets: ArchivoCtaCte[] }[] }>(CONSULTA_ARCHIVOS, {
    ids: [ctaCteId],
    col: [COL_ARCHIVO_RESUMEN],
  })
  const archivo = pdfDelDocumento(data.items?.[0]?.assets ?? [], documento)
  if (!archivo) throw new Error(sinPdf(documento))
  const url = new URL(archivo.public_url)
  if (url.hostname !== 'files-monday-com.s3.amazonaws.com') {
    throw new Error(`El PDF está en ${url.hostname}, que el proxy de desarrollo no cubre.`)
  }
  const res = await fetch(`/monday-files${url.pathname}${url.search}`)
  if (!res.ok) throw new Error(`No pudimos traer el PDF (HTTP ${res.status}).`)
  return res.blob()
}

/* ===== Envío del resumen ===== */

/**
 * Despacho del resumen ya generado. Como en el recibo, la app NO manda el mail ni el WhatsApp: deja
 * escrito en la cuenta a quiénes y por dónde, y una automatización de Monday lo despacha.
 *
 *   1. "🤖Medio de Envio" (Email siempre; Whatsapp también si se tildó) y "🤖Contactos" con los
 *      destinatarios elegidos, en UNA sola mutación: son el mismo dato para la automatización, y
 *      escribirlos por separado abría un instante con el medio puesto y sin destinatarios;
 *   2. "🤖Estado de Envio Resumen Cta Cte" en "Enviar", que dispara la automatización;
 *   3. se sigue esa columna hasta que el tablero la cierre en "Enviado" o "Error de Envio".
 *
 * El estado se pone en "Enviar" DESPUÉS de los destinatarios, y es lo que evita además leer como
 * éxito un "Enviado" que quedó de un envío anterior sobre la misma cuenta.
 */
export async function enviarResumenCtaCte({
  itemId,
  medio,
  contactoIds,
  onProgreso,
  intentos = 30,
  intervalo = 2000,
}: {
  itemId: string
  medio: MedioEnvio
  contactoIds: readonly string[]
  onProgreso: (estado: string) => void
  intentos?: number
  intervalo?: number
}): Promise<'ok' | 'error-envio'> {
  const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

  /* En modo local no hay automatización: se simula el ciclo, como el resto del prototipo. */
  if (!mondayHabilitado()) {
    onProgreso('Enviando')
    await esperar(1200)
    onProgreso('Enviado')
    return 'ok'
  }

  const cv: Record<string, unknown> = {
    [COL.ctaCte.medioEnvioResumen]: { ids: MEDIO_ENVIO_RESUMEN_IDS[medio] },
  }
  /* Sólo ids numéricos válidos: la relación los pide como números, y uno que no lo sea haría rebotar
     la mutación entera. Sin destinatarios se OMITE la columna, igual que el resto de la capa. */
  const ids = contactoIds.map(Number).filter((n) => Number.isFinite(n) && n > 0)
  if (ids.length > 0) cv[COL.ctaCte.contactosResumen] = { item_ids: ids }

  const cambiar = (valores: Record<string, unknown>) =>
    mondayApi(
      `mutation ($id: ID!, $board: ID!, $cv: JSON!) {
        change_multiple_column_values(item_id: $id, board_id: $board, column_values: $cv) { id }
      }`,
      { id: itemId, board: BOARDS.ctaCte, cv: JSON.stringify(valores) },
    )

  await cambiar(cv)
  await cambiar({ [COL.ctaCte.estadoEnvioResumen]: { index: ESTADO_ENVIO_RESUMEN_INDEX.enviar } })

  /* Si se agotan los intentos sin un estado final, NO se da por enviado: lo único cierto es que el
     tablero no lo confirmó. */
  let ultimaEtiqueta = ''
  for (let i = 0; i < intentos; i++) {
    await esperar(intervalo)
    const data = await mondayApi<{ items: { column_values: ValorColumna[] }[] }>(
      `query ($ids: [ID!]) {
        items(ids: $ids) {
          column_values(ids: ["${COL.ctaCte.estadoEnvioResumen}"]) { id text ... on StatusValue { index } }
        }
      }`,
      { ids: [itemId] },
    )
    const estado = data.items?.[0]?.column_values?.[0]
    const etiqueta = estado?.text?.trim() ?? ''
    if (etiqueta && etiqueta !== ultimaEtiqueta) {
      ultimaEtiqueta = etiqueta
      onProgreso(etiqueta)
    }
    if (estado?.index === ESTADO_ENVIO_RESUMEN_INDEX.enviado) return 'ok'
    if (estado?.index === ESTADO_ENVIO_RESUMEN_INDEX.error) return 'error-envio'
  }
  return 'error-envio'
}
