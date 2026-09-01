/**
 * Catálogo de comprobantes ENVIABLES. Es el punto de extensión del envío: cada comprobante
 * describe, en un objeto, todo lo que lo distingue de los demás.
 *
 * Hoy la app envía uno solo —el recibo—, pero el catálogo se conserva igual que en la app de
 * operaciones de venta: sin él, la diferencia entre comprobantes vuelve a ser una cadena de
 * `if (documento === '…')` adentro del componente, y sumar uno nuevo obliga a tocarlo en cuatro
 * lugares distintos (el artículo del texto, la bandera de emitido, la rama de envío y el bloqueo
 * por crédito). Acá se agrega una entrada y no se toca nada más.
 *
 * El componente no sabe qué comprobante está enviando: le pide al adaptador el id del ítem, si ya
 * se emitió y que ejecute el envío.
 */
import {
  asignarDestinoEnvio,
  asignarDestinoEnvioOP,
  dispararEnvioOP,
  dispararEnvioRecibo,
  reciboPdfGenerado,
  seguirEnvioOP,
  seguirEnvioRecibo,
  ENVIO_RECIBO_INDEX,
  OP_ENVIO_INDEX,
} from '@/services/monday'
import type { AppState } from '@/state/appState'
import type { Cliente, MedioEnvio } from '@/types'

/** Cómo terminó el intento de envío. Cada motivo lo comunica el componente a su manera. */
export type ResultadoEnvio =
  /** Salió: la automatización del tablero cerró el envío sin error. */
  | { estado: 'ok' }
  /** El PDF todavía no existe en su columna. No es un fallo: hay que esperar y reintentar. */
  | { estado: 'sin-documento' }
  /** El tablero reportó un error de envío (destinatarios, medio, la automatización). */
  | { estado: 'error-envio' }

/** Lo que el envío necesita saber para despachar UN comprobante. */
export interface ComprobanteEnviable {
  /** Clave del catálogo. Es lo que la vista pasa por prop. */
  id: string
  /** Cómo se lo nombra en los textos ("el recibo", "la factura"). */
  articulo: 'el' | 'la'
  /** Nombre en minúscula, tal como aparece en los mensajes. */
  nombre: string
  /**
   * Texto con el que el contacto declara que acepta este comprobante, en su columna "Para Enviar"
   * del tablero de Contactos. Se compara normalizado (sin tildes ni mayúsculas) y por inclusión.
   * Sin valor se usa `nombre`.
   */
  etiquetaContacto?: string
  /**
   * Ítem de Monday desde el que se despacha. `null` = todavía no existe, así que no hay nada que
   * enviar (el comprobante no se emitió).
   */
  itemId: (state: AppState) => string | null
  /**
   * El comprobante ya se emitió y por lo tanto se puede enviar. Es una pregunta aparte del
   * `itemId` porque no siempre coinciden: puede haber ítem sin que la emisión haya cerrado.
   */
  emitido: (state: AppState) => boolean
  /** El envío se frena si el cliente está bloqueado o con su línea de crédito agotada. */
  frenaPorCredito: boolean
  /**
   * De QUIÉN son los contactos a los que se le manda. En un recibo es el CLIENTE de la operación;
   * en una orden de pago, el PROVEEDOR. Los dos salen del mismo board de Personas y cuelgan de la
   * misma columna conectada, así que la consulta es una sola: lo único que cambia es de qué ítem.
   *
   * `null` = todavía no hay con quién operar, y por lo tanto no hay contactos que traer.
   */
  titular: (state: AppState) => Cliente | null
  /**
   * El envío exige AL MENOS UN contacto que acepte este comprobante, y no sólo que el titular
   * tenga contactos cargados.
   *
   * Son dos reglas distintas: el recibo se puede mandar a alguien que no lo declaró en su "Para
   * Enviar" —el usuario decide—, mientras que la orden de pago NO: sin un contacto que la admita,
   * la función de envío queda inhabilitada por completo.
   */
  exigeContactoQueAcepta?: boolean
  /**
   * Qué se dice cuando NO hay a quién enviarle. Vive acá y no dentro del componente por el mismo
   * motivo que el resto de este archivo: es lo que distingue a un comprobante de otro, y el
   * componente sólo lo muestra.
   *
   * El mensaje recibe el nombre del titular porque la frase lo nombra: "PROVEEDOR TEST NO tiene…".
   */
  sinContactos: {
    titulo: string
    mensaje: (titular: string) => string
  }
  /**
   * Despacha el comprobante: valida que el PDF exista, asigna el medio, dispara el envío y sigue
   * la columna de estado hasta que la automatización la cierra.
   *
   * `onProgreso` recibe el estado que va reportando el tablero. Un `throw` acá se toma como fallo
   * de la API y lo comunica la ventana global de error.
   */
  enviar: (args: {
    state: AppState
    itemId: string
    contactoIds: string[]
    medio: MedioEnvio
    onProgreso: (estado: string) => void
  }) => Promise<ResultadoEnvio>
}

/* ===== Los comprobantes que hoy se envían ===== */

const RECIBO: ComprobanteEnviable = {
  id: 'recibo',
  articulo: 'el',
  nombre: 'recibo',
  /* Se despacha desde el ítem de "➡️Recibos y Cobros": ahí vive el PDF y la columna de estado que
     la automatización mueve. */
  itemId: (s) => s.reciboId,
  emitido: (s) => Boolean(s.reciboId),
  // El recibo es una salida del sistema: no sale nada de un cliente bloqueado o excedido.
  frenaPorCredito: true,
  titular: (s) => s.cliente,
  sinContactos: {
    titulo: 'No tiene contactos asignados',
    mensaje: (titular) =>
      `${titular} no tiene contactos cargados en el tablero de Contactos, así que no es posible realizar el envío. Asignale al menos un contacto y volvé a reintentar.`,
  },
  async enviar({ itemId, contactoIds, medio, onProgreso }) {
    // El PDF lo genera el tablero después de emitir: sin él no hay documento que despachar.
    if (!(await reciboPdfGenerado(itemId))) return { estado: 'sin-documento' }
    /* Destinatarios y medio, antes del disparo: la automatización lee el ítem para saber a quién
       mandarle el documento. */
    await asignarDestinoEnvio(itemId, medio, contactoIds)
    await dispararEnvioRecibo(itemId)
    const final = await seguirEnvioRecibo(itemId, onProgreso)
    return final === ENVIO_RECIBO_INDEX.enviado ? { estado: 'ok' } : { estado: 'error-envio' }
  },
}


/**
 * ORDEN DE PAGO. Se despacha desde el ítem de "⬅️ Pagos - PENDIENTES", donde vive la columna de
 * estado que la automatización mueve.
 *
 * Dos diferencias de fondo con el recibo:
 *
 *   · NO frena por crédito. El límite de crédito es lo que NOSOTROS le damos a un cliente; a un
 *     proveedor no se le asigna ninguno, y mirarlo acá frenaría pagos por una línea que no existe.
 *   · EXIGE un contacto que acepte la orden. Sin ninguno, el envío queda inhabilitado por completo
 *     (ver `exigeContactoQueAcepta`).
 *
 * Tampoco se comprueba que el PDF exista antes de despachar, como sí hace el recibo: el tablero de
 * órdenes NO tiene columna `file`, así que no hay dónde mirarlo. Lo que garantiza que haya algo que
 * enviar es que la emisión ya haya cerrado, que es lo que el paso exige antes de habilitar el botón.
 */
const ORDEN_PAGO: ComprobanteEnviable = {
  id: 'ordenPago',
  articulo: 'la',
  nombre: 'orden de pago',
  /* Con este texto el contacto declara, en su "✋Para Enviar", que acepta recibir órdenes de pago. */
  etiquetaContacto: 'Orden de Pago',
  itemId: (s) => s.ordenPagoId,
  emitido: (s) => Boolean(s.ordenPagoId),
  frenaPorCredito: false,
  titular: (s) => s.proveedor,
  exigeContactoQueAcepta: true,
  sinContactos: {
    titulo: 'No hay contactos que acepten recibir la orden de pago',
    mensaje: (titular) =>
      `${titular} NO tiene ningun contacto asignado al cual se le pueda enviar orden de pago o retencion, por ende NO es posible realizar el envio. Para la proxima revisa y asigna contactos al proveedor.`,
  },
  async enviar({ itemId, contactoIds, medio, onProgreso }) {
    /* Destinatarios y medio, antes del disparo: la automatización lee el ítem para saber a quién
       mandarle el documento. */
    await asignarDestinoEnvioOP(itemId, medio, contactoIds)
    await dispararEnvioOP(itemId)
    const final = await seguirEnvioOP(itemId, onProgreso)
    return final === OP_ENVIO_INDEX.enviado ? { estado: 'ok' } : { estado: 'error-envio' }
  },
}

const CATALOGO: Record<string, ComprobanteEnviable> = {
  [RECIBO.id]: RECIBO,
  [ORDEN_PAGO.id]: ORDEN_PAGO,
}

/**
 * Comprobante del catálogo. Una clave desconocida es un error de programación —la vista pasó algo
 * que no existe—, así que se corta ahí en vez de enviar cualquier cosa.
 */
export function comprobanteEnviable(id: string): ComprobanteEnviable {
  const comprobante = CATALOGO[id]
  if (!comprobante) throw new Error(`No hay un comprobante enviable con la clave "${id}"`)
  return comprobante
}
