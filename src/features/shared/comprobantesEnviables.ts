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
  dispararEnvioRecibo,
  reciboPdfGenerado,
  seguirEnvioRecibo,
  ENVIO_RECIBO_INDEX,
} from '@/services/monday'
import type { AppState } from '@/state/appState'
import type { MedioEnvio } from '@/types'

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

const CATALOGO: Record<string, ComprobanteEnviable> = {
  [RECIBO.id]: RECIBO,
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
