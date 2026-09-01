/**
 * Anticipos con saldo a favor NUESTRO con el proveedor: tablero "Anticipos y Creditos x pase de
 * saldo PARA PROVEEDORES - Pends de Aplicar" (18428353259).
 *
 * Es el espejo de `./anticipos`, que resuelve lo mismo del lado de los clientes, y repite sus dos
 * decisiones:
 *
 *   · los DOS filtros viajan como REGLAS de la consulta, no se aplican sobre la respuesta: el
 *     proveedor y el estado, limitado a los anticipos con saldo DISPONIBLE —"Pend de Aplicar" y
 *     "Aplicado Parcialmente"— por ÍNDICE de etiqueta. Los índices del tablero NO son correlativos,
 *     así que compararlos por texto sería atarse al rótulo.
 *   · el id del proveedor en la regla de `board_relation` va como NÚMERO: entre comillas la consulta
 *     devuelve 0 ítems en vez de fallar, y el error no se nota hasta que la pantalla aparece vacía.
 *
 * Se leen EXACTAMENTE las mismas columnas que del lado de los clientes —fecha, detalle, importe,
 * pendiente y estado—: son el mismo dato y lo único que los distingue es de quién es el saldo. El
 * board publica además un "🤖ID Anticipo", pero NO se lee: es un `item_id`, y por API devuelve el id
 * crudo del ítem en vez del código con prefijo que se ve en pantalla, así que mostrarlo habría
 * puesto un número de once dígitos donde Cobros muestra el nombre del anticipo.
 *
 * El parcialmente aplicado entra porque le QUEDA saldo: se usó una parte y el resto sigue a favor.
 * Cuánto queda lo dice su "🤖Pend de Aplicar", que es el mismo tope que se respeta para cualquier
 * otro.
 *
 * LECTURA PURA: lo único que este módulo escribe está en `./ordenPago`, al aplicar el saldo.
 */
import { ANTICIPOS_PENDIENTES_PROVEEDOR } from '@/data/mock'
import { parseIso } from '@/lib/dates'
import type { AnticipoPendiente } from '@/types'
import { ANTICIPO_ESTADOS_APLICABLES, BOARDS, COL } from './columns'
import { byId, num, valor, type MondayItem } from './parse'
import { mondayApi, mondayHabilitado } from './sdk'

/** Tope de anticipos que trae la consulta. Un proveedor con más saldos abiertos es un caso aparte. */
const TOPE_ANTICIPOS = 200

const columnasAnticipo = Object.values(COL.anticipoProveedor)

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
    fecha: c[COL.anticipoProveedor.fecha]?.text?.trim() ?? '',
    importe: num(valor(c[COL.anticipoProveedor.importe])),
    pendiente: num(valor(c[COL.anticipoProveedor.pendiente])),
    comentario: c[COL.anticipoProveedor.detalle]?.text?.trim() ?? '',
  }
}

/**
 * Anticipos del proveedor que todavía tienen saldo para aplicar, del más viejo al más nuevo. Sin
 * proveedor devuelve vacío: no hay a quién buscarle el saldo. Sin token (modo local) devuelve el
 * mock, ordenado con el MISMO criterio para que el prototipo se recorra igual que con datos reales.
 */
export async function getAnticiposProveedor(proveedorId: string): Promise<AnticipoPendiente[]> {
  if (!proveedorId) return []
  if (!mondayHabilitado()) return [...ANTICIPOS_PENDIENTES_PROVEEDOR].sort(porFecha)

  const data = await mondayApi<{ boards: { items_page: { items: MondayItem[] } }[] }>(
    `query {
      boards(ids: [${BOARDS.anticiposProveedor}]) {
        items_page(
          limit: ${TOPE_ANTICIPOS},
          query_params: {rules: [
            {column_id: "${COL.anticipoProveedor.proveedor}", compare_value: [${Number(proveedorId)}], operator: any_of},
            {column_id: "${COL.anticipoProveedor.estado}", compare_value: [${ANTICIPO_ESTADOS_APLICABLES.join(', ')}], operator: any_of}
          ]}
        ) {
          items { ${CAMPOS_ANTICIPO} }
        }
      }
    }`,
  )

  return (
    (data.boards?.[0]?.items_page.items ?? [])
      .map(mapAnticipo)
      /* Un anticipo sin saldo no sirve para cancelar nada, aunque el estado del tablero todavía no
         se haya movido: aplicarle un peso no descontaría de ninguna factura. */
      .filter((a) => a.pendiente > 0)
      .sort(porFecha)
  )
}
