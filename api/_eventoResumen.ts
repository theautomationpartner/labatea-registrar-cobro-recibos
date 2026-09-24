/**
 * El evento que recibe el escenario de Make que genera el RESUMEN DE CTA CTE cuando lo pide la app.
 *
 * El escenario tiene DOS disparadores posibles: la automatización de Monday (la columna "🤖Estado
 * Resumen Cta Cte" pasa a "Generar") y la app. Los dos le pegan al MISMO webhook, cuya estructura de
 * datos ya está armada con lo que manda Monday. Por eso la app no inventa un formato: arma el evento
 * que Monday habría mandado por ese mismo cambio de columna, campo por campo, y le agrega uno solo,
 * `appJobId`. Ése es el que distingue a simple vista una ejecución de la app (lo trae) de una de
 * Monday (no lo trae), y el que el escenario devuelve en cada aviso.
 *
 * La app, en cambio, NO mueve la columna a "Generar": eso dispararía también la automatización de
 * Monday y el resumen se generaría dos veces.
 *
 * El módulo es PURO —sin nada de Node—, a propósito: lo usa la función de Vercel en producción y el
 * navegador en desarrollo, donde no hay funciones serverless y el pedido sale por el proxy de Vite.
 */

/** "💵Cta Cte Cliente". Sólo sobre ítems de este tablero se puede pedir un resumen. */
export const BOARD_CTA_CTE = '18421858736'
/** "🤖Estado Resumen Cta Cte". */
export const COL_ESTADO_RESUMEN = 'color_mm76s2eq'
const TITULO_ESTADO_RESUMEN = '🤖Estado Resumen Cta Cte'
/** El índice de "Generar": el cambio que la app está reemplazando. */
const INDEX_GENERAR = 3

/**
 * El `style` de cada etiqueta, tal cual lo manda Monday. Sólo se conocen las que aparecieron en un
 * evento real; del resto se manda `null` —el escenario no lo usa, y un color inventado sería peor
 * que ninguno—.
 */
const ESTILOS: Record<number, { color: string; border: string; var_name: string }> = {
  3: { color: '#007eb5', border: '#3db0df', var_name: 'blue-links' },
  5: { color: '#c4c4c4', border: '#b0b0b0', var_name: 'grey' },
}

/** Lo que hace falta leer del ítem para armar el evento. */
export interface ItemCtaCte {
  id: string
  name: string
  board: { id: string; groups: { id: string }[] }
  group: { id: string }
  column_values: { text: string | null; index?: number | null }[]
}

export const CONSULTA_ITEM = `query ($ids: [ID!], $col: [String!]) {
  items(ids: $ids) {
    id
    name
    board { id groups { id } }
    group { id }
    column_values(ids: $col) { text ... on StatusValue { index } }
  }
}`

/** 32 caracteres hexadecimales, como el `triggerUuid` de Monday. */
const hex32 = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')

const etiqueta = (index: number, text: string | null) => ({
  label: { index, text, style: ESTILOS[index] ?? null, is_done: false },
  post_id: null,
})

/**
 * El evento, con la misma forma que el `event` de Monday. Lo que la app no tiene —la suscripción del
 * webhook de Monday— va en `null`; lo demás sale del ítem real y de la sesión del usuario.
 */
export function eventoDeResumen(datos: {
  item: ItemCtaCte
  userId: string
  appJobId: string
  ahora?: Date
}) {
  const { item, userId, appJobId } = datos
  const ahora = datos.ahora ?? new Date()
  const previo = item.column_values[0]
  return {
    app: 'monday',
    type: 'update_column_value',
    triggerTime: ahora.toISOString(),
    subscriptionId: null,
    isRetry: false,
    userId: Number(userId),
    originalTriggerUuid: null,
    boardId: Number(item.board.id),
    groupId: item.group.id,
    pulseId: Number(item.id),
    pulseName: item.name,
    columnId: COL_ESTADO_RESUMEN,
    columnType: 'color',
    columnTitle: TITULO_ESTADO_RESUMEN,
    value: etiqueta(INDEX_GENERAR, 'Generar'),
    // Una columna que nunca tuvo valor no tiene índice: Monday manda `null` en ese caso.
    previousValue:
      typeof previo?.index === 'number' ? etiqueta(previo.index, previo.text?.trim() || null) : null,
    changedAt: ahora.getTime() / 1000,
    isTopGroup: item.board.groups[0]?.id === item.group.id,
    triggerUuid: hex32(),
    appJobId,
  }
}

/* ── La respuesta del escenario ────────────────────────────────────────────────────────────── */

/**
 * El cuerpo del escenario como objeto, o `null` si no es JSON —el "Accepted" que Make contesta
 * solo cuando el escenario no llega a un `Webhook Response`—.
 *
 * Tolera lo que el mapeo de Make deja mal armado (ver `repararJson`): los saltos de línea crudos del
 * `mensajeError` escrito a mano, y las banderas `*_generado` —que van SIN comillas, como booleanos—
 * cuya variable quedó vacía.
 */
export function comoJson(texto: string): unknown {
  if (!texto.trim()) return null
  try {
    return JSON.parse(texto)
  } catch {
    try {
      return JSON.parse(repararJson(texto))
    } catch {
      return null
    }
  }
}

/**
 * Arregla lo que el mapeo de Make rompe de un JSON, sin tocar nada más:
 *
 *   · un salto de línea CRUDO adentro de un string se escapa (los de entre campos quedan igual);
 *   · un valor mapeado SIN comillas cuya variable quedó vacía —`"estado_excel_generado":,`— pasa a
 *     `null`. Es justo el caso de un documento que no se generó: su bandera nunca se escribió.
 */
function repararJson(texto: string): string {
  let salida = ''
  let enString = false
  // El último carácter significativo fuera de un string: si es ':' y viene ',' o '}', falta el valor.
  let previo = ''
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]
    if (enString) {
      if (c === '\\') {
        salida += c + (texto[i + 1] ?? '')
        i++
        continue
      }
      if (c === '"') enString = false
      if (c === '\n') salida += '\\n'
      else if (c !== '\r') salida += c
      continue
    }
    if (c === '"') enString = true
    if ((c === ',' || c === '}') && previo === ':') salida += 'null'
    if (!/\s/.test(c)) previo = c
    salida += c
  }
  return salida
}
