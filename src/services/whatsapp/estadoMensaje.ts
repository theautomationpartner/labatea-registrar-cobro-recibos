/**
 * Confirmación del WhatsApp de un documento (recibo, orden de pago, resumen) contra 360Messenger.
 *
 * El escenario de Make manda el WhatsApp por 360Messenger —el mensaje de texto y cada documento, como
 * mensajes separados— y contesta el id de cada uno. Que Make los haya entregado a 360Messenger no
 * quiere decir que hayan salido: 360Messenger los encola y los procesa después (en las pruebas, 37 s
 * más tarde), y ahí pueden fallar —número inexistente, sin WhatsApp—. Por eso se consulta
 * `GET /v2/message/status?id=<id>` por CADA mensaje hasta que 360Messenger diga cómo terminó, y el
 * WhatsApp se da por enviado SÓLO si confirma todos (ver `verificarWhatsapps`).
 *
 * La API key no pasa por acá: la pone el servidor (`api/whatsapp-estado.ts`) o, en desarrollo, el
 * proxy de Vite (`/messenger360-estado`).
 */
import { cabecerasPropias } from '@/services/monday/sdk'

const ENDPOINT = import.meta.env.DEV ? '/messenger360-estado' : '/api/whatsapp-estado'

/**
 * El estado que devuelve 360Messenger (sólo lo que se usa). Viene en `data` —así contesta la API—,
 * aunque el ejemplo de su documentación lo muestra en `result`: se aceptan los dos.
 *
 * Un número inexistente, tal como lo devolvió la API:
 *   { "status": "ERROR", "statusInfo": "message sending failed", "delivery": "error", … }
 */
export interface EstadoMensaje360 {
  /** "OK", "ERROR", "NOT FOUND"… */
  status?: string
  /** El motivo, en inglés: "message sending failed", "user not found". */
  statusInfo?: string
  /** "device", "error", "not found"… */
  delivery?: string
}

/** Cómo quedó el mensaje, para la app. */
export type ConfirmacionWhatsapp =
  /** 360Messenger lo dio por enviado. */
  | { estado: 'enviado' }
  /** 360Messenger dice que falló: el WhatsApp NO salió. */
  | { estado: 'fallido'; motivo: string }
  /** Sigue en cola después de esperar: no falló, pero tampoco se confirmó. */
  | { estado: 'pendiente' }
  /** No se pudo consultar (sin key, sin conexión, 360Messenger caído): no se sabe. */
  | { estado: 'sin-verificar'; motivo: string }

/**
 * Estados que 360Messenger usa para un mensaje que NO salió. "NOT FOUND" con "user not found" es el
 * número sin WhatsApp; los demás cubren el fallo explícito.
 */
const FALLIDOS = ['FAILED', 'FAIL', 'ERROR', 'REJECTED', 'NOT FOUND', 'NOT_FOUND', 'UNDELIVERED']
/** Estados de un mensaje que salió. */
const ENVIADOS = ['OK', 'SENT', 'DELIVERED', 'READ', 'PLAYED', 'DEVICE', 'SERVER']

const norm = (v: string | undefined): string => (v ?? '').trim().toUpperCase()

/** Traducciones de los motivos más comunes de 360Messenger, para el vendedor. */
const MOTIVOS: Record<string, string> = {
  'USER NOT FOUND': 'el número no tiene WhatsApp',
  'NOT FOUND': 'el número no tiene WhatsApp',
  'MESSAGE SENDING FAILED': 'WhatsApp no pudo entregar el mensaje; revisá que el número sea correcto',
}

/**
 * Qué dice un estado de 360Messenger. Manda el fallo: si `status` o `delivery` dicen que falló, falló,
 * aunque el otro campo diga otra cosa. Lo que no es ni fallo ni envío (en cola, procesando) queda
 * pendiente.
 */
export function clasificarEstado(e: EstadoMensaje360): ConfirmacionWhatsapp {
  const status = norm(e.status)
  const delivery = norm(e.delivery)
  if (FALLIDOS.includes(status) || FALLIDOS.includes(delivery)) {
    const info = norm(e.statusInfo)
    return { estado: 'fallido', motivo: MOTIVOS[info] ?? MOTIVOS[status] ?? (e.statusInfo?.trim() || 'el envío falló') }
  }
  if (ENVIADOS.includes(status) || ENVIADOS.includes(delivery)) return { estado: 'enviado' }
  return { estado: 'pendiente' }
}

const esperar = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Una consulta. Devuelve el estado, o `sin-verificar` si la consulta en sí no anduvo.
 *
 * Un 404 DE 360MESSENGER cuenta como pendiente: es lo que contesta por un id que todavía no
 * registró (`{ "success": false, "statusCode": 404, "message": "Not Found" }`). Cualquier otra cosa
 * que no sea su JSON —la ruta de la consulta no existe en el deploy, o el servidor de desarrollo
 * devuelve la página de la app porque arrancó sin la key— NO es el mensaje en cola: es que la
 * consulta no está llegando a 360Messenger, y se dice así en vez de esperar 90 s para nada.
 */
async function consultar(messageId: string): Promise<ConfirmacionWhatsapp> {
  let res: Response
  try {
    res = await fetch(`${ENDPOINT}?id=${encodeURIComponent(messageId)}`, {
      /* En desarrollo el proxy de Vite pone la key y no hay guardián: la sesión no viaja. */
      headers: import.meta.env.DEV ? undefined : await cabecerasPropias(),
    })
  } catch {
    return { estado: 'sin-verificar', motivo: 'sin conexión con 360Messenger' }
  }
  let cuerpo: { success?: unknown; statusCode?: unknown; error?: unknown; data?: EstadoMensaje360; result?: EstadoMensaje360 } | null
  try {
    cuerpo = await res.json()
  } catch {
    cuerpo = null
  }
  if (!cuerpo || typeof cuerpo !== 'object') {
    return { estado: 'sin-verificar', motivo: NO_CONFIGURADA }
  }
  if (res.status === 404) {
    // El 404 propio de 360Messenger trae su JSON; el de una ruta inexistente, no.
    return cuerpo.success === false ? { estado: 'pendiente' } : { estado: 'sin-verificar', motivo: NO_CONFIGURADA }
  }
  if (!res.ok) {
    // El proxy explica su propio fallo ("La consulta de WhatsApp no está configurada.").
    const detalle = typeof cuerpo.error === 'string' ? cuerpo.error.replace(/\.$/, '') : ''
    return { estado: 'sin-verificar', motivo: detalle || `360Messenger respondió ${res.status}` }
  }
  const estado = cuerpo.data ?? cuerpo.result
  if (!estado || typeof estado !== 'object') return { estado: 'sin-verificar', motivo: 'respuesta sin estado' }
  return clasificarEstado(estado)
}

/**
 * Motivo cuando la consulta no llega a 360Messenger. Lo lee el vendedor pero lo resuelve quien
 * mantiene la app: falta `WHATSAPP_API_KEY(_TEST)` en el deploy, la función `api/whatsapp-estado` no
 * está publicada, o el servidor de desarrollo se levantó antes de cargar la key.
 */
const NO_CONFIGURADA = 'la consulta a 360Messenger no está configurada en la app'

/**
 * Confirma el mensaje: consulta hasta que 360Messenger diga que salió o que falló. Mientras siga en
 * cola, vuelve a preguntar cada `intervalo` ms, hasta `intentos` veces: por defecto cada 3 s durante
 * 90 s. En las pruebas el mensaje se procesó 37 s después de encolarse; con 12 s de espera la app
 * lo encontraba en cola todavía, y un número inexistente salía como enviado.
 */
export async function confirmarWhatsapp(
  messageId: string,
  { intentos = 30, intervalo = 3000 }: { intentos?: number; intervalo?: number } = {},
): Promise<ConfirmacionWhatsapp> {
  for (let i = 1; ; i++) {
    const estado = await consultar(messageId)
    if (estado.estado !== 'pendiente' || i >= intentos) return estado
    await esperar(intervalo)
  }
}
