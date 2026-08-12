/**
 * Facturas pendientes de cobro del cliente: tablero "💰Fact Vtas Pends de Cobro" (18421035508).
 *
 * Los dos filtros viajan como REGLAS de la consulta, no se aplican sobre la respuesta:
 *   · el cliente ("🤖Personas"), y
 *   · el estado, limitado a lo que todavía se puede cobrar (pendiente 100% o cancelada
 *     parcialmente), por ÍNDICE de etiqueta.
 *
 * OJO con el id del cliente en la regla de `board_relation`: va como NÚMERO. Verificado contra el
 * tablero: con el mismo id entre comillas la consulta devuelve 0 ítems en vez de fallar, así que
 * el error no se nota hasta que la pantalla aparece vacía.
 */
import { FACTURAS_PENDIENTES } from '@/data/mock'
import { parseIso } from '@/lib/dates'
import type { FacturaPendiente } from '@/types'
import { COL, BOARDS, FACT_PENDIENTE_ESTADO_INDEX, FACT_PENDIENTE_ESTADOS_COBRABLES } from './columns'
import { byId, num, valor, type MondayItem } from './parse'
import { mondayApi, mondayHabilitado } from './sdk'

/** Tope de facturas que trae la consulta. Un cliente con más deuda que esto es un caso a mirar aparte. */
const TOPE_FACTURAS = 200

const columnasFactura = Object.values(COL.factPendiente)

/**
 * Los importes viven en columnas mirror y fórmula: las dos devuelven su valor en `display_value`
 * (con su fragmento), nunca en `text`. Sin los fragmentos, todo llegaría en 0.
 *
 * La VENTA vinculada viaja anidada por UNA sola cosa: su número ("VTA-094"), que es el nombre con
 * el que la fila se identifica en pantalla. Se trae en la misma consulta para no disparar una por
 * fila. Las FECHAS ya no salen de ahí: emisión y vencimiento son columnas de la propia factura.
 */
const CAMPOS_FACTURA = `
  id name
  column_values(ids: ${JSON.stringify(columnasFactura)}) {
    id text
    ... on MirrorValue { display_value }
    ... on FormulaValue { display_value }
    ... on StatusValue { index }
    ... on BoardRelationValue {
      linked_items {
        id name
        column_values(ids: ["${COL.venta.idVenta}"]) { id text }
      }
    }
  }`

/**
 * Orden del listado: por VENCIMIENTO, de la más vieja a la más nueva. Es el orden en que se cobra
 * una cuenta —primero lo que lleva más tiempo impago, que es lo que más mora acumula—, así que la
 * factura más urgente queda arriba sin que haya que buscarla.
 *
 * Las que no tienen vencimiento cargado van al FINAL: no se puede afirmar que sean las más viejas,
 * y mandarlas al fondo evita que encabecen la lista por un dato que falta.
 */
const porVencimiento = (a: FacturaPendiente, b: FacturaPendiente): number => {
  const va = parseIso(a.vencimiento)?.getTime()
  const vb = parseIso(b.vencimiento)?.getTime()
  if (va === undefined) return vb === undefined ? 0 : 1
  if (vb === undefined) return -1
  return va - vb
}

function mapFactura(item: MondayItem): FacturaPendiente {
  const c = byId(item)
  const indiceEstado = c[COL.factPendiente.estado]?.index
  /* Venta vinculada. Muchas facturas del tablero no la tienen conectada, así que su número es
     opcional: la fila se muestra igual, con ese campo vacío. */
  const venta = c[COL.factPendiente.venta]?.linked_items?.[0]
  const ventaCols = venta ? byId(venta) : {}
  return {
    id: item.id,
    // Sin número de comprobante cargado queda el id del ítem: siempre hay algo que mostrar.
    nro: c[COL.factPendiente.nro]?.text?.trim() || item.id,
    idVenta: ventaCols[COL.venta.idVenta]?.text?.trim() ?? '',
    /* Las dos fechas son de la FACTURA, no de su venta: de la emisión sale lo que el recibo
       declara para el comprobante, y del vencimiento salen el orden del listado y la mora. */
    emision: c[COL.factPendiente.fechaEmision]?.text?.trim() ?? '',
    vencimiento: c[COL.factPendiente.fechaVencimiento]?.text?.trim() ?? '',
    total: num(valor(c[COL.factPendiente.total])),
    // Sin cobros previos la mirror llega vacía: son 0 pesos cobrados, no un dato faltante.
    cobrado: num(valor(c[COL.factPendiente.cobrado])),
    // El porcentaje llega como "19%": `num` se queda con el número.
    cobradoPct: num(valor(c[COL.factPendiente.cobradoPct])),
    pendiente: num(valor(c[COL.factPendiente.pendiente])),
    estado: c[COL.factPendiente.estado]?.text ?? '',
    parcial: indiceEstado === FACT_PENDIENTE_ESTADO_INDEX.canceladaParcialmente,
  }
}

/**
 * Facturas del cliente que todavía deben algo, de la más vencida a la más nueva. Sin cliente
 * devuelve vacío: no hay a quién cobrarle. Sin token (modo local) devuelve el mock, ordenado con el
 * MISMO criterio para que el prototipo se recorra igual que con datos reales.
 */
export async function getFacturasPendientes(clienteId: string): Promise<FacturaPendiente[]> {
  if (!clienteId) return []
  if (!mondayHabilitado()) return [...FACTURAS_PENDIENTES].sort(porVencimiento)

  const data = await mondayApi<{ boards: { items_page: { items: MondayItem[] } }[] }>(
    `query {
      boards(ids: [${BOARDS.factPendientes}]) {
        items_page(
          limit: ${TOPE_FACTURAS},
          query_params: {rules: [
            {column_id: "${COL.factPendiente.cliente}", compare_value: [${Number(clienteId)}], operator: any_of},
            {column_id: "${COL.factPendiente.estado}", compare_value: [${FACT_PENDIENTE_ESTADOS_COBRABLES.join(', ')}], operator: any_of}
          ]}
        ) {
          items { ${CAMPOS_FACTURA} }
        }
      }
    }`,
  )

  return (
    (data.boards?.[0]?.items_page.items ?? [])
      .map(mapFactura)
      /* Una factura sin saldo no es cobrable, aunque el estado del tablero todavía no se haya
         movido: imputarle un peso no cancelaría nada. */
      .filter((f) => f.pendiente > 0)
      /* El orden se resuelve ACÁ y no en la consulta: el vencimiento se lee de una columna del
         tablero, pero la lista ya viene filtrada en memoria, así que ordenarla es una pasada más
         sobre lo mismo y no depende de que el board tenga su vista ordenada. */
      .sort(porVencimiento)
  )
}
