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
import { BOARDS, CHEQUE_CARTERA_ESTADO_INDEX, COL, COL_CHEQUE_USADO } from './columns'
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
 * Los mismos campos, pero con los ids del tablero de cheques USADOS (18426604104): comparte todos
 * menos la fecha de pago (ver `COL_CHEQUE_USADO`).
 *
 * Y con un nivel más de anidado, que es lo que resuelve las dos columnas de ORIGEN de la tabla: el
 * cheque conoce los SUBELEMENTOS del recibo y de la orden de pago, pero el código que ve el usuario
 * —"RECIBO-078", "IDPAGO-012"— vive en el ítem PADRE de cada uno. Se piden las dos columnas de id
 * sobre los dos padres: cada tablero devuelve sólo la suya, así que no hace falta separar las
 * consultas.
 *
 * Traerlo acá y no en una segunda vuelta es lo que evita una consulta por fila: la lista se arma
 * entera con una sola solicitud, igual que antes de tener estas columnas.
 */
const CAMPOS_CHEQUE_USADO = `
  id name
  column_values(ids: ${JSON.stringify(Object.values(COL_CHEQUE_USADO))}) {
    id text
    ... on StatusValue { index }
    ... on BoardRelationValue {
      linked_items {
        id
        parent_item {
          id
          column_values(ids: ["${COL.cobro.nro}", "${COL.ordenPago.nro}"]) { id text }
        }
      }
    }
  }`

/**
 * El código del documento del que cuelga un subelemento: "RECIBO-078" o "IDPAGO-012".
 *
 * `relacion` es la columna del cheque que apunta al subelemento, y `columna` la del id en su padre.
 * Vacío si el cheque no pasó por ese lado —no tiene esa relación conectada—, que es un dato y no un
 * faltante: un cheque que todavía no se usó no tiene orden de pago.
 */
const idDelDocumento = (
  cols: ReturnType<typeof byId>,
  relacion: string,
  columna: string,
): string => {
  const sub = cols[relacion]?.linked_items?.[0]
  if (!sub?.parent_item) return ''
  return byId(sub.parent_item)[columna]?.text?.trim() ?? ''
}

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

/**
 * Una fila del tablero → el cheque de la app.
 *
 * `cols` dice de QUÉ tablero es la fila: cartera o usados. Los dos son espejos y comparten todos
 * los ids menos la fecha de pago, así que el mapeo es UNO solo y lo único que se le pasa es el
 * descriptor de columnas (ver `COL_CHEQUE_USADO`). Escribirlo dos veces habría dejado dos lecturas
 * del mismo dato que se corrigen por separado.
 */
function mapCheque(
  item: MondayItem,
  cols: typeof COL.chequeCartera | typeof COL_CHEQUE_USADO = COL.chequeCartera,
): ChequeEnCartera {
  const c = byId(item)
  return {
    id: item.id,
    // Sin "🤖ID Cheque" cargado queda el nombre del ítem: siempre hay algo que mostrar.
    codigo: c[cols.codigo]?.text?.trim() || item.name.trim() || item.id,
    numero: c[cols.numero]?.text?.trim() ?? '',
    importe: num(valor(c[cols.importe])),
    vencimiento: c[cols.vencimiento]?.text?.trim() ?? '',
    emision: c[cols.emision]?.text?.trim() ?? '',
    fechaPago: c[cols.fechaPago]?.text?.trim() ?? '',
    banco: c[cols.banco]?.text?.trim() ?? '',
    /* El tablero lo guarda como once dígitos corridos. Se formatea ACÁ, en el borde de entrada, con
       el mismo criterio que el CUIT del cliente: de ahí en más viaja con sus guiones. */
    cuitEmisor: formatearCuit(c[cols.cuitEmisor]?.text),
    tipo: c[cols.tipo]?.text?.trim() ?? '',
    estado: c[cols.estado]?.text?.trim() ?? '',
    /* Sólo llegan cuando la consulta pidió el anidado de los padres (la lista de USADOS). La
       cartera del formulario de pago no lo pide, así que ahí quedan en `''` y no se muestran. */
    idRecibo: idDelDocumento(c, COL_CHEQUE_USADO.subRecibo, COL.cobro.nro),
    idPago: idDelDocumento(c, COL_CHEQUE_USADO.subPago, COL.ordenPago.nro),
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

  /* La lambda no sobra: `map` pasa el ÍNDICE como segundo argumento, y `mapCheque` espera ahí el
     descriptor de columnas. Sin ella, cada fila se mapearía contra un número. */
  return (data.boards?.[0]?.items_page.items ?? [])
    .map((item) => mapCheque(item))
    .sort(porVencimiento)
}

/**
 * Los cheques USADOS de UN cliente, del que vence antes al que vence después.
 *
 * Sale de OTRO tablero: "🧾Cheques/eCheq en Cartera USADOS" (18426604104), no el de cartera. Es la
 * lista del RECHAZO DE CHEQUE, y la diferencia no es un detalle de dónde buscar: un cheque que el
 * banco devuelve es uno que YA se usó —se endosó a un proveedor o se depositó—, así que el papel
 * que rebota nunca está entre los disponibles para pagar. La cartera no interviene en ese circuito.
 *
 * Dos reglas, las dos resueltas EN EL SERVIDOR: la relación a Personas
 * (`board_relation_mm643x5f`), que es de quién se recibió el papel —ofrecerle al operador los
 * cheques de todos lo obligaría a encontrar el suyo entre los ajenos—, y el estado en "100% Usado",
 * por ÍNDICE y nunca por su texto.
 *
 * El id del cliente va como NÚMERO en la regla del `board_relation`, igual que en los anticipos y
 * en las facturas pendientes: entre comillas la consulta devuelve 0 ítems en vez de fallar, así que
 * el error no se nota hasta que la pantalla aparece vacía.
 *
 * Sin cliente devuelve vacío: no hay a quién buscarle los cheques. Sin token (modo local) devuelve
 * el mock COMPLETO —los cheques de prueba no tienen persona conectada—, con el mismo orden, para
 * que el prototipo se recorra igual que con datos reales.
 */
export async function getChequesDeCliente(clienteId: string): Promise<ChequeEnCartera[]> {
  if (!clienteId) return []
  if (!mondayHabilitado()) return [...CHEQUES_EN_CARTERA].sort(porVencimiento)

  const data = await mondayApi<{ boards: { items_page: { items: MondayItem[] } }[] }>(
    `query {
      boards(ids: [${BOARDS.chequesUsados}]) {
        items_page(
          limit: ${TOPE_CHEQUES},
          query_params: {rules: [
            {column_id: "${COL_CHEQUE_USADO.persona}", compare_value: [${Number(clienteId)}], operator: any_of},
            {column_id: "${COL_CHEQUE_USADO.estado}", compare_value: [${CHEQUE_CARTERA_ESTADO_INDEX.usado}], operator: any_of}
          ]}
        ) {
          items { ${CAMPOS_CHEQUE_USADO} }
        }
      }
    }`,
  )

  return (data.boards?.[0]?.items_page.items ?? [])
    .map((item) => mapCheque(item, COL_CHEQUE_USADO))
    .sort(porVencimiento)
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
  /**
   * Acota la búsqueda a un TIPO del tablero ("Cheque" / "eCheq"). Sin valor busca en los dos, que es
   * lo que corresponde cuando lo que se controla es el papel y no su formato.
   */
  tipo?: string
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
  tipo,
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
            ${tipo ? `,{column_id: "${COL.chequeCartera.tipo}", compare_value: ${JSON.stringify([tipo])}, operator: any_of}` : ''}
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
