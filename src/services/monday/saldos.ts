/**
 * Saldos de la cuenta corriente del cliente: tablero "💵Cta Cte Cliente" (18421858736).
 *
 * La cuenta es UN ítem por cliente, y los dos totales que muestra la ficha son columnas de ESE
 * ítem —ya calculadas por el tablero—:
 *
 *   · VENTAS PENDS DE CANCELAR · "Fact Vent pend de Aplciar", lo que el cliente todavía debe.
 *   · ANTICIPOS PENDS DE APLICAR · "Anticipo pend de Aplicar", su saldo a favor sin usar.
 *
 * La DEUDA de la cuenta ("🤖Saldo Cta Cte") NO se lee acá: ya viene con el cliente, calculada sobre
 * las mismas mirrors de este ítem (ver `mapCliente`), y es la que muestra la ficha. Leerla otra vez
 * dejaría el mismo número en dos lugares que pueden discrepar.
 *
 * La app los LEE, no los suma: antes se recorrían los subelementos de la cuenta clasificándolos por
 * tipo de movimiento, lo que ataba la ficha a la lista completa de movimientos —y a un tope— para
 * llegar a un número que el propio tablero ya publica. Leer la columna es una consulta más chica,
 * sin subítems, y no se puede desincronizar del total que se ve en Monday.
 *
 * El filtro por cliente va como REGLA de la consulta —no sobre la respuesta—, igual que en el resto
 * de la capa. OJO con el id en la regla de `board_relation`: va como NÚMERO (con el mismo id entre
 * comillas la consulta devuelve 0 ítems en vez de fallar, así que el error no se nota hasta que la
 * pantalla aparece vacía).
 */
import { SALDOS_CLIENTE } from '@/data/mock'
import { round2 } from '@/lib/format'
import type { SaldosCliente } from '@/types'
import { BOARDS, COL } from './columns'
import { byId, num, valor, type MondayItem } from './parse'
import { mondayApi, mondayHabilitado } from './sdk'

/** Saldos en cero: es lo que devuelve una cuenta que no existe, y NUNCA `null` ni `NaN`. */
export const SALDOS_EN_CERO: SaldosCliente = { pendienteDeCancelar: 0, anticipos: 0 }

/**
 * Importe de una columna de la cuenta. Monday devuelve los números como TEXTO, así que se parsea
 * siempre; una columna vacía —o con algo que no es un número— vale 0 y no `NaN`: la ficha muestra
 * un importe, y "no hay saldo" es un cero, no un hueco ni un `NaN` que se propague.
 */
const importe = (cols: ReturnType<typeof byId>, columna: string): number =>
  round2(num(valor(cols[columna])))

/**
 * Los dos saldos del cliente. Sin cliente devuelve ceros: no hay cuenta que mirar. Sin token (modo
 * local) devuelve el mock.
 */
export async function getSaldosCliente(clienteId: string): Promise<SaldosCliente> {
  if (!clienteId) return SALDOS_EN_CERO
  if (!mondayHabilitado()) return SALDOS_CLIENTE

  const data = await mondayApi<{ boards: { items_page: { items: MondayItem[] } }[] }>(
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
            column_values(ids: ["${COL.ctaCte.ventasPendCancelar}","${COL.ctaCte.anticiposPendAplicar}"]) {
              id text
            }
          }
        }
      }
    }`,
  )

  /* Sin cuenta para ese cliente no hay error que reportar: todavía no operó, así que sus saldos
     son cero. */
  const cuenta = data.boards?.[0]?.items_page.items?.[0]
  if (!cuenta) return SALDOS_EN_CERO

  const cols = byId(cuenta)
  return {
    pendienteDeCancelar: importe(cols, COL.ctaCte.ventasPendCancelar),
    anticipos: importe(cols, COL.ctaCte.anticiposPendAplicar),
  }
}
