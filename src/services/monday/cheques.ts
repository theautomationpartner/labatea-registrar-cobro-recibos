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
import { formatearCuit, mismoCuit } from '@/lib/pagos'
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
    fechaPago: c[COL.chequeCartera.fechaPago]?.text?.trim() ?? '',
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

/* ===== Control de DUPLICADOS ===== */

/** Qué identifica a un cheque dentro de la cuenta de una persona. */
export interface ChequeABuscar {
  /** Ítem de Personas del cliente de la operación: acota la búsqueda a SUS cheques. */
  clienteId: string
  /** Número tal como figura en el papel. Se compara sin espacios y sin distinguir mayúsculas. */
  numero: string | undefined
  /** CUIT del librador, con guiones o sin ellos: se compara por dígitos. */
  cuitEmisor: string | undefined
}

/**
 * ¿Este cheque YA está registrado para este cliente?
 *
 * Lo que identifica a un cheque es el par EMISOR + NÚMERO, y sólo dentro de la cuenta de la persona
 * que lo entregó: el mismo número existe en tantas chequeras como bancos hay, así que buscarlo
 * suelto daría por duplicado un cheque que no lo es.
 *
 * Por eso la consulta filtra por la relación a Personas —server-side, con el mismo criterio que las
 * facturas pendientes— y la comparación de los dos datos se hace acá: son campos de TEXTO del
 * tablero, donde el CUIT vive sin guiones y el número puede traer espacios, y esas diferencias de
 * formato no pueden decidir si un cheque entra o no.
 *
 * Sin número o sin CUIT devuelve `false`: no hay con qué comparar, y dar por duplicado un cheque a
 * medio cargar frenaría un alta que el formulario ya está reclamando por otro lado.
 *
 * En modo local (sin token) devuelve `false`: el prototipo tiene que poder recorrerse entero, y no
 * hay tablero contra el cual verificar nada.
 */
export async function chequeYaRegistrado({
  clienteId,
  numero,
  cuitEmisor,
}: ChequeABuscar): Promise<boolean> {
  const nro = (numero ?? '').trim()
  if (!nro || !cuitEmisor?.trim() || !clienteId) return false
  if (!mondayHabilitado()) return false

  const data = await mondayApi<{ boards: { items_page: { items: MondayItem[] } }[] }>(
    `query {
      boards(ids: [${BOARDS.chequesCartera}]) {
        items_page(
          limit: ${TOPE_CHEQUES},
          query_params: {rules: [
            {column_id: "${COL.chequeCartera.persona}", compare_value: [${Number(clienteId)}], operator: any_of}
          ]}
        ) {
          items {
            id
            column_values(ids: ["${COL.chequeCartera.numero}", "${COL.chequeCartera.cuitEmisor}"]) {
              id text
            }
          }
        }
      }
    }`,
  )

  /* Los dos datos tienen que coincidir en el MISMO cheque: un número que ya existe con otro emisor
     no es un duplicado, y tomarlo como tal rechazaría un cheque legítimo. */
  const mismoNumero = (a: string) => a.trim().localeCompare(nro, undefined, { sensitivity: 'base' }) === 0

  return (data.boards?.[0]?.items_page.items ?? []).some((item) => {
    const c = byId(item)
    return (
      mismoNumero(c[COL.chequeCartera.numero]?.text ?? '') &&
      mismoCuit(c[COL.chequeCartera.cuitEmisor]?.text ?? undefined, cuitEmisor)
    )
  })
}
