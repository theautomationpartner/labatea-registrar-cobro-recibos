/**
 * Cheques de terceros disponibles en cartera: tablero "🧾Cheques/eCheq en Cartera" (18425237398).
 *
 * Sólo se listan los que están en estado "Pendiente" —el filtro viaja como REGLA de la consulta, por
 * ÍNDICE de etiqueta y nunca por su texto—: un cheque ya usado no se puede volver a endosar, así
 * que ofrecerlo sería invitar a pagar dos veces con el mismo papel.
 *
 * LECTURA PURA: este módulo no escribe una sola columna del tablero.
 */
import { CHEQUES_EN_CARTERA } from '@/data/mock'
import { formatearCuit } from '@/lib/pagos'
import type { ChequeEnCartera } from '@/types'
import { BOARDS, CHEQUE_CARTERA_ESTADO_INDEX, COL } from './columns'
import { byId, num, valor, type MondayItem } from './parse'
import { mondayApi, mondayHabilitado } from './sdk'

/** Tope de cheques que trae la consulta. Una cartera más grande que esto es un caso a mirar aparte. */
const TOPE_CHEQUES = 200

const columnasCheque = Object.values(COL.chequeCartera)

const CAMPOS_CHEQUE = `
  id name
  column_values(ids: ${JSON.stringify(columnasCheque)}) {
    id text
    ... on StatusValue { index }
  }`

/**
 * Orden de la cartera: por VENCIMIENTO, del que vence antes al que vence después. Es el orden en
 * que conviene desprenderse de ellos, así que el primero de la lista es el candidato natural.
 * Los que no tienen vencimiento cargado van al final.
 */
const porVencimiento = (a: ChequeEnCartera, b: ChequeEnCartera): number => {
  if (!a.vencimiento) return b.vencimiento ? 1 : 0
  if (!b.vencimiento) return -1
  return a.vencimiento.localeCompare(b.vencimiento)
}

function mapCheque(item: MondayItem): ChequeEnCartera {
  const c = byId(item)
  return {
    id: item.id,
    // Sin "🤖ID Cheque" cargado queda el nombre del ítem: siempre hay algo que mostrar.
    codigo: c[COL.chequeCartera.codigo]?.text?.trim() || item.name.trim() || item.id,
    numero: c[COL.chequeCartera.numero]?.text?.trim() ?? '',
    importe: num(valor(c[COL.chequeCartera.importe])),
    vencimiento: c[COL.chequeCartera.vencimiento]?.text?.trim() ?? '',
    emision: c[COL.chequeCartera.emision]?.text?.trim() ?? '',
    banco: c[COL.chequeCartera.banco]?.text?.trim() ?? '',
    /* El tablero lo guarda como once dígitos corridos. Se formatea ACÁ, en el borde de entrada, con
       el mismo criterio que el CUIT del cliente: de ahí en más viaja con sus guiones. */
    cuitEmisor: formatearCuit(c[COL.chequeCartera.cuitEmisor]?.text),
    tipo: c[COL.chequeCartera.tipo]?.text?.trim() ?? '',
    estado: c[COL.chequeCartera.estado]?.text?.trim() ?? '',
  }
}

/**
 * Cheques en cartera que todavía se pueden usar, del que vence antes al que vence después. Sin
 * token (modo local) devuelve el mock, ordenado con el MISMO criterio.
 */
export async function getChequesEnCartera(): Promise<ChequeEnCartera[]> {
  if (!mondayHabilitado()) return [...CHEQUES_EN_CARTERA].sort(porVencimiento)

  const data = await mondayApi<{ boards: { items_page: { items: MondayItem[] } }[] }>(
    `query {
      boards(ids: [${BOARDS.chequesCartera}]) {
        items_page(
          limit: ${TOPE_CHEQUES},
          query_params: {rules: [
            {column_id: "${COL.chequeCartera.estado}", compare_value: [${CHEQUE_CARTERA_ESTADO_INDEX.pendiente}], operator: any_of}
          ]}
        ) {
          items { ${CAMPOS_CHEQUE} }
        }
      }
    }`,
  )

  return (data.boards?.[0]?.items_page.items ?? []).map(mapCheque).sort(porVencimiento)
}
