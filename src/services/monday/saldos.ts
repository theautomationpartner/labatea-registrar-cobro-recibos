/**
 * Saldos de la cuenta corriente del cliente: tablero de Cta Cte (18421858736).
 *
 * La cuenta es UN ítem por cliente y, colgando de él, un SUBÍTEM por movimiento. De ahí salen los
 * dos totales que muestra la ficha:
 *
 *   · SALDO PEND DE CANCELAR · lo que suman los movimientos "Vta Pend de Cobro".
 *   · SALDO POR ANTICIPOS    · lo que suman los movimientos "Anticipo".
 *
 * Es UNA sola consulta: el ítem del cliente y sus subelementos con sus columnas viajan anidados en
 * la misma query. Buscar primero la cuenta y después sus movimientos serían dos viajes para un dato
 * que la API sabe resolver de una, y duplicaría las chances de cortarse por red.
 *
 * El filtro por cliente va como REGLA de la consulta —no sobre la respuesta—, igual que en el resto
 * de la capa: traer todas las cuentas para quedarse con una sería pedirle al tablero entero lo que
 * se sabe pedir puntual. OJO con el id en la regla de `board_relation`: va como NÚMERO (con el mismo
 * id entre comillas la consulta devuelve 0 ítems en vez de fallar, así que el error no se nota
 * hasta que la pantalla aparece vacía).
 */
import { SALDOS_CLIENTE } from '@/data/mock'
import { round2 } from '@/lib/format'
import type { SaldosCliente } from '@/types'
import { BOARDS, COL, CTA_CTE_MOV } from './columns'
import { byId, num, valor, type MondayItem } from './parse'
import { mondayApi, mondayHabilitado } from './sdk'

/**
 * Tope de movimientos que trae la consulta. Una cuenta con más que esto es un caso a mirar aparte:
 * los totales saldrían incompletos, así que el corte tiene que ser evidente y no silencioso.
 */
const TOPE_MOVIMIENTOS = 500

/** Saldos en cero: es lo que devuelve una cuenta sin movimientos, y NUNCA `null` ni `NaN`. */
export const SALDOS_EN_CERO: SaldosCliente = { pendienteDeCancelar: 0, anticipos: 0 }

/** Un subelemento de la cuenta corriente, tal como llega anidado en la respuesta. */
interface MovimientoCtaCte {
  id: string
  column_values: { id: string; text: string | null; index?: number | null }[]
}

/**
 * Compara la etiqueta de un movimiento contra la que se busca, sin distinguir mayúsculas ni
 * espacios de más. Que el rótulo del tablero venga como "VTA PEND DE COBRO" no puede dejar el
 * saldo en cero.
 */
const esTipo = (etiqueta: string | null | undefined, buscada: string): boolean =>
  (etiqueta ?? '').trim().toLowerCase() === buscada.toLowerCase()

/**
 * Suma una columna numérica sobre los movimientos de un tipo. El valor se parsea SIEMPRE —Monday
 * devuelve los números como texto—, y lo que no es un número cuenta como 0: un movimiento con la
 * columna vacía no puede convertir el total en `NaN` y arrastrar toda la ficha.
 */
function sumarPorTipo(
  movimientos: readonly MovimientoCtaCte[],
  tipo: string,
  columnaImporte: string,
): number {
  const total = movimientos.reduce((acc, m) => {
    const cols = byId(m)
    if (!esTipo(cols[COL.ctaCteSub.tipo]?.text, tipo)) return acc
    return acc + num(valor(cols[columnaImporte]))
  }, 0)
  return round2(total)
}

/**
 * Los dos saldos del cliente. Sin cliente devuelve ceros: no hay cuenta que mirar. Sin token (modo
 * local) devuelve el mock.
 *
 * Una cuenta que no existe, sin movimientos, o cuyos movimientos no son de ninguno de los dos tipos
 * devuelve CERO en lo que corresponda —nunca `null`—: la ficha muestra un importe, y "no hay saldo"
 * es un cero, no un hueco.
 */
export async function getSaldosCliente(clienteId: string): Promise<SaldosCliente> {
  if (!clienteId) return SALDOS_EN_CERO
  if (!mondayHabilitado()) return SALDOS_CLIENTE

  const data = await mondayApi<{
    boards: { items_page: { items: (MondayItem & { subitems?: MovimientoCtaCte[] })[] } }[]
  }>(
    `query {
      boards(ids: [${BOARDS.ctaCte}]) {
        items_page(
          limit: 1,
          query_params: {rules: [
            {column_id: "${COL.ctaCte.cliente}", compare_value: [${Number(clienteId)}], operator: any_of}
          ]}
        ) {
          items {
            id
            subitems {
              id
              column_values(ids: ["${COL.ctaCteSub.tipo}","${COL.ctaCteSub.pendiente}","${COL.ctaCteSub.anticipo}"]) {
                id text
                ... on StatusValue { index }
              }
            }
          }
        }
      }
    }`,
  )

  /* Sin cuenta para ese cliente no hay error que reportar: todavía no operó, así que sus saldos
     son cero. */
  const cuenta = data.boards?.[0]?.items_page.items?.[0]
  const movimientos = (cuenta?.subitems ?? []).slice(0, TOPE_MOVIMIENTOS)
  if (movimientos.length === 0) return SALDOS_EN_CERO

  /* Los dos totales se calculan por separado sobre la MISMA lista: cada tipo de movimiento lleva su
     importe en su propia columna, así que no se pueden derivar uno del otro. */
  return {
    pendienteDeCancelar: sumarPorTipo(
      movimientos,
      CTA_CTE_MOV.pendienteDeCobro,
      COL.ctaCteSub.pendiente,
    ),
    anticipos: sumarPorTipo(movimientos, CTA_CTE_MOV.anticipo, COL.ctaCteSub.anticipo),
  }
}
