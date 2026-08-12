/**
 * Anticipos del cliente con saldo a favor: tablero "Anticipos Pends de Aplicar" (18426066447).
 *
 * Los dos filtros viajan como REGLAS de la consulta, no se aplican sobre la respuesta:
 *   · el cliente ("Cliente", `board_relation_mm64zh21`), y
 *   · el estado, limitado a "Pend de Aplicar" por ÍNDICE de etiqueta (17, ver
 *     `ANTICIPO_ESTADO_INDEX`). Los índices del tablero NO son correlativos, así que compararlos
 *     por texto sería atarse al rótulo.
 *
 * OJO con el id del cliente en la regla de `board_relation`: va como NÚMERO. Verificado contra el
 * tablero: con el mismo id entre comillas la consulta devuelve 0 ítems en vez de fallar, así que el
 * error no se nota hasta que la pantalla aparece vacía.
 */
import { ANTICIPOS_PENDIENTES } from '@/data/mock'
import { parseIso } from '@/lib/dates'
import type { AnticipoPendiente } from '@/types'
import { ANTICIPO_ESTADO_INDEX, BOARDS, COL } from './columns'
import { byId, num, valor, type MondayItem } from './parse'
import { mondayApi, mondayHabilitado } from './sdk'

/** Tope de anticipos que trae la consulta. Un cliente con más saldos abiertos es un caso a mirar aparte. */
const TOPE_ANTICIPOS = 200

const columnasAnticipo = Object.values(COL.anticipo)

/** El saldo pendiente es una FÓRMULA: sin su fragmento llegaría vacío y todo daría 0. */
const CAMPOS_ANTICIPO = `
  id name
  column_values(ids: ${JSON.stringify(columnasAnticipo)}) {
    id text
    ... on MirrorValue { display_value }
    ... on FormulaValue { display_value }
    ... on StatusValue { index }
  }`

/**
 * Orden del listado: por FECHA, del anticipo más viejo al más nuevo. Es el orden en que conviene
 * consumirlos —primero el saldo que lleva más tiempo sin aplicarse—, así que el que corresponde
 * usar queda arriba. Los que no tienen fecha cargada van al final.
 */
const porFecha = (a: AnticipoPendiente, b: AnticipoPendiente): number => {
  const fa = parseIso(a.fecha)?.getTime()
  const fb = parseIso(b.fecha)?.getTime()
  if (fa === undefined) return fb === undefined ? 0 : 1
  if (fb === undefined) return -1
  return fa - fb
}

function mapAnticipo(item: MondayItem): AnticipoPendiente {
  const c = byId(item)
  return {
    id: item.id,
    nombre: item.name,
    recibo: c[COL.anticipo.recibo]?.text?.trim() ?? '',
    fecha: c[COL.anticipo.fecha]?.text?.trim() ?? '',
    importe: num(valor(c[COL.anticipo.importe])),
    pendiente: num(valor(c[COL.anticipo.pendiente])),
    comentario: c[COL.anticipo.comentario]?.text?.trim() ?? '',
  }
}

/**
 * Anticipos del cliente que todavía tienen saldo para aplicar, del más viejo al más nuevo. Sin
 * cliente devuelve vacío: no hay a quién buscarle el saldo. Sin token (modo local) devuelve el mock,
 * ordenado con el MISMO criterio para que el prototipo se recorra igual que con datos reales.
 */
export async function getAnticiposPendientes(clienteId: string): Promise<AnticipoPendiente[]> {
  if (!clienteId) return []
  if (!mondayHabilitado()) return [...ANTICIPOS_PENDIENTES].sort(porFecha)

  const data = await mondayApi<{ boards: { items_page: { items: MondayItem[] } }[] }>(
    `query {
      boards(ids: [${BOARDS.anticipos}]) {
        items_page(
          limit: ${TOPE_ANTICIPOS},
          query_params: {rules: [
            {column_id: "${COL.anticipo.cliente}", compare_value: [${Number(clienteId)}], operator: any_of},
            {column_id: "${COL.anticipo.estado}", compare_value: [${ANTICIPO_ESTADO_INDEX.pendienteDeAplicar}], operator: any_of}
          ]}
        ) {
          items { ${CAMPOS_ANTICIPO} }
        }
      }
    }`,
  )

  return (data.boards?.[0]?.items_page.items ?? [])
    .map(mapAnticipo)
    /* Un anticipo sin saldo no sirve para cancelar nada, aunque el estado del tablero todavía no se
       haya movido: aplicarle un peso no descontaría de ninguna factura. */
    .filter((a) => a.pendiente > 0)
    .sort(porFecha)
}
