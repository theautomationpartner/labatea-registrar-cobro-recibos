/**
 * "🤖Estado Registro de Cobro" (color_mm5zkr61): el semáforo con el que el TABLERO procesa un ítem
 * de "➡️Recibos y Cobros", cualquiera sea la operación que lo creó.
 *
 * La app escribe UNA sola etiqueta —"Registrar"— y de ahí en más sólo lee. Ese cambio es lo que
 * dispara la automatización; el resto de los estados los mueve ella.
 *
 * Hoy lo usa UN solo circuito, el PASE DE SALDO (`pases.ts`): pide el registro y espera a que esta
 * misma columna llegue a "Registrado".
 *
 * El COBRO no pasa por acá: un recibo se pide por su propia columna, "🤖Estado de Emision", que es
 * también donde se lo espera (ver `pedirEmision` y `getEstadoEmision` en `recibos.ts`). Son dos
 * semáforos distintos porque son dos trabajos distintos del tablero —registrar un movimiento y
 * emitir un documento—, y mezclarlos hacía que una operación esperara la señal de la otra.
 */
import { COL, BOARDS, ESTADO_REGISTRO_INDEX } from './columns'
import { byId, type MondayItem } from './parse'
import { mondayApi, mondayHabilitado } from './sdk'

/**
 * Pide que el tablero PROCESE el ítem: pone "🤖Estado Registro de Cobro" en "Registrar".
 *
 * Se escribe por ÍNDICE y no por etiqueta, igual que el resto de las columnas status: el índice es
 * la identidad de la opción en el board, así que un cambio de rótulo no puede desviar la operación
 * a otro estado.
 */
export async function pedirRegistro(itemId: string): Promise<void> {
  if (!mondayHabilitado()) return
  await mondayApi(
    `mutation ($id: ID!, $board: ID!, $cv: JSON!) {
      change_multiple_column_values(item_id: $id, board_id: $board, column_values: $cv) { id }
    }`,
    {
      id: itemId,
      board: BOARDS.cobros,
      cv: JSON.stringify({
        [COL.cobro.estadoRegistro]: { index: ESTADO_REGISTRO_INDEX.registrar },
      }),
    },
  )
}

/**
 * En qué anda el registro, según el tablero. Los cinco estados de la columna se reducen a los TRES
 * que le importan a quien espera: sigue en curso, cerró bien o cerró mal.
 *
 * La traducción se hace acá —y no en la pantalla— para que los índices de Monday no se filtren
 * fuera de esta capa: quien consume esto no tiene por qué saber que "Registrado" es el 1.
 */
export type FaseRegistroBoard = 'en-curso' | 'registrado' | 'error'

export interface EstadoRegistro {
  fase: FaseRegistroBoard
  /** Etiqueta tal cual la muestra el tablero. Es lo que se le muestra al usuario. */
  label: string
}

/**
 * Lee "🤖Estado Registro de Cobro" del ítem.
 *
 * Una columna vacía o un ítem que no se pudo leer cuentan como "en curso", NO como error: recién se
 * pidió el registro y el tablero todavía no la movió. Lo que corta la espera es un estado terminal
 * o el tope de tiempo de quien sondea, nunca una lectura ambigua.
 *
 * En modo local no hay automatización que registre nada, así que se responde "Registrado" de una:
 * el prototipo tiene que poder recorrerse entero sin cuenta de Monday.
 */
export async function getEstadoRegistro(itemId: string): Promise<EstadoRegistro> {
  if (!mondayHabilitado()) return { fase: 'registrado', label: 'Registrado' }

  const data = await mondayApi<{ items: MondayItem[] }>(
    `query ($id: [ID!]) {
      items(ids: $id) {
        id
        column_values(ids: ["${COL.cobro.estadoRegistro}"]) {
          id text
          ... on StatusValue { index }
        }
      }
    }`,
    { id: [itemId] },
  )

  const item = data.items?.[0]
  const cv = item ? byId(item)[COL.cobro.estadoRegistro] : undefined
  const index = cv?.index ?? null
  const fase: FaseRegistroBoard =
    index === ESTADO_REGISTRO_INDEX.registrado
      ? 'registrado'
      : index === ESTADO_REGISTRO_INDEX.error
        ? 'error'
        : 'en-curso'
  return { fase, label: cv?.text?.trim() ?? '' }
}

/** Cada cuánto se le vuelve a preguntar al tablero por el estado del registro. */
const INTERVALO_MS = 3000

/**
 * Hasta cuándo se lo espera: un minuto y medio, el mismo plazo que la emisión del recibo. Sin tope,
 * un ítem que la automatización nunca resuelve dejaría la pantalla tapada para siempre.
 *
 * Vencido el plazo sin un "Registrado", el desenlace es ERROR. No se da por registrado ni se sigue
 * esperando: lo único que se sabe con certeza es que el tablero no confirmó, y aplicar los efectos
 * del cierre ahí sería anunciar un pase que quizá nunca se procesó.
 */
const LIMITE_MS = 90 * 1000

/**
 * Lecturas fallidas seguidas que se toleran antes de cortar. La consulta se repite durante todo el
 * plazo, así que un corte de red puntual no puede dar por fallado un registro que del lado del
 * tablero va bien.
 */
const REINTENTOS_LECTURA = 3

const esperar = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms))

/**
 * Espera a que el tablero termine de registrar el ítem: sondea la columna hasta que llega a
 * "Registrado", y sólo entonces vuelve.
 *
 * Es la contracara de `pedirRegistro`: la app pide, la automatización trabaja, y esto es lo que
 * verifica que haya trabajado. Sin esta espera, dar la operación por buena apenas escrito el ítem
 * sería inventar un éxito que el tablero nunca confirmó.
 *
 * Cualquier final que no sea "Registrado" —el error del propio tablero, el vencimiento del tiempo,
 * o la red caída más veces seguidas de las que se toleran— sale por excepción, con un mensaje que
 * dice qué pasó. NO distingue entre "falló" y "todavía no terminó" a la hora de dar por cerrada la
 * operación: en los dos casos lo cierto es lo mismo, que el registro no está confirmado.
 */
export async function esperarRegistro(itemId: string): Promise<void> {
  const vence = Date.now() + LIMITE_MS
  let fallosSeguidos = 0

  for (;;) {
    await esperar(INTERVALO_MS)
    let actual: EstadoRegistro
    try {
      actual = await getEstadoRegistro(itemId)
      fallosSeguidos = 0
    } catch (e) {
      /* Una lectura suelta puede fallar por red sin que el registro esté mal: se reintenta unas
         cuantas veces y recién ahí se da por perdida. */
      fallosSeguidos += 1
      if (fallosSeguidos <= REINTENTOS_LECTURA && Date.now() < vence) continue
      throw new Error(
        `No se pudo consultar el estado del registro${e instanceof Error && e.message.trim() ? `: ${e.message}` : '.'}`,
      )
    }

    if (actual.fase === 'registrado') return
    if (actual.fase === 'error') {
      throw new Error(
        `El tablero no pudo registrar la operación${actual.label ? ` ("${actual.label}")` : ''}. Revisá el ítem en Monday para ver el detalle.`,
      )
    }
    // Sigue en curso: se vuelve a mirar, mientras quede tiempo.
    if (Date.now() >= vence) {
      throw new Error(
        'El registro no terminó dentro del tiempo de espera. La operación ya está escrita en Monday: revisá su estado antes de volver a intentarla.',
      )
    }
  }
}
