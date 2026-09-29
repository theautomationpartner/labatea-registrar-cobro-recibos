/**
 * El TÍTULO y el CONTENIDO de la actividad "Envío de Resumen de cuenta corriente" que "Registrar
 * Resumen" crea en el timeline del cliente. Es el paso "Construir tittle, content and summary" del
 * escenario de Make que la registraba, portado tal cual:
 *
 *   título    · "Envio de Resumen de cuenta corriente desde 01/09/2026 hasta 16/09/2026 para Ana
 *               Pérez, Juan Gómez" (máx. 255 caracteres).
 *   contenido · HTML: el remitente y un link por archivo adjunto.
 *
 * Puro: no sabe de Monday. Los links y los nombres llegan de los archivos ya subidos a la cuenta.
 */
import type { CanalEnvio, Contacto, MedioEnvio } from '@/types'
import { desdeIso } from './dates'
import { pulseIdDe } from './envioDocumento'

/**
 * A quiénes les llegó el resumen y por dónde, según lo que devolvió el envío: los contactos con algún
 * canal confirmado y el medio que resulta de esos canales. Si el envío no dejó el detalle por
 * contacto, cuentan todos los elegidos con el medio elegido.
 */
export function envioDelResumen(
  contactos: readonly Contacto[],
  medio: MedioEnvio,
  enviados: Readonly<Record<string, readonly CanalEnvio[]>>,
): { medio: MedioEnvio; contactos: { itemId: string; nombre: string }[] } {
  const recibieron = contactos.filter((c) => (enviados[pulseIdDe(c)]?.length ?? 0) > 0)
  const lista = recibieron.length > 0 ? recibieron : contactos
  const canales = new Set(recibieron.flatMap((c) => enviados[pulseIdDe(c)] ?? []))
  const medioReal: MedioEnvio =
    canales.size === 0 ? medio : canales.has('email') && canales.has('whatsapp') ? 'Ambos' : canales.has('email') ? 'Email' : 'WhatsApp'
  return { medio: medioReal, contactos: lista.map((c) => ({ itemId: pulseIdDe(c), nombre: c.name })) }
}

const ENCABEZADO = 'Envio de Resumen de cuenta corriente'
const SIN_CONTACTOS = 'Contacto no especificado'
const MAX_TITULO = 255
/** 2 documentos (resumen y estado) x 2 formatos (PDF y Excel). */
const MAX_ENLACES = 4

export interface DatosActividadResumen {
  /** Las dos puntas del período del resumen, en ISO. */
  periodo: { desde: string; hasta: string } | null
  /** A quiénes se les envió: su nombre completo. */
  contactos: readonly string[]
  /** Los archivos del resumen ya subidos a la cuenta: con qué nombre y en qué link. */
  archivos: readonly { nombre: string; url: string }[]
  /** "Enviado desde". Vacío = no se muestra. */
  remitente: string
}

/** Escapa texto para el HTML del contenido. */
const escaparHtml = (texto: string): string =>
  texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\\/g, '&#92;')

/** El nombre sin el código numérico que arrastra el ítem ("Luciano 1 - 1111" → "Luciano 1"). */
const limpiarNombre = (valor: string): string =>
  valor.replace(/[\s_-]+\d+\s*$/, '').replace(/\s+/g, ' ').trim()

/** Los nombres de los contactos, sin repetidos y separados por coma. */
export function nombresContactos(contactos: readonly string[]): string {
  const vistos = new Set<string>()
  const nombres = contactos.map(limpiarNombre).filter((n) => {
    const clave = n.toLowerCase()
    if (!n || vistos.has(clave)) return false
    vistos.add(clave)
    return true
  })
  return nombres.length ? nombres.join(', ') : SIN_CONTACTOS
}

export function tituloActividadResumen(d: Pick<DatosActividadResumen, 'periodo' | 'contactos'>): string {
  const desde = d.periodo ? desdeIso(d.periodo.desde) : ''
  const hasta = d.periodo ? desdeIso(d.periodo.hasta) : ''
  const tramo = desde && hasta ? ` desde ${desde} hasta ${hasta}` : ''
  const titulo = `${ENCABEZADO}${tramo} para ${nombresContactos(d.contactos)}`
    .replace(/\s+/g, ' ')
    .replace(/["\\]/g, "'")
    .trim()
  return titulo.length > MAX_TITULO ? `${titulo.slice(0, MAX_TITULO - 3)}...` : titulo
}

export function contenidoActividadResumen(d: Pick<DatosActividadResumen, 'archivos' | 'remitente'>): string {
  const lineas: string[] = []
  if (d.remitente.trim()) lineas.push(`✉️ Enviado desde: <b>${escaparHtml(d.remitente.trim())}</b>`)

  const enlaces = d.archivos.filter((a) => /^https?:\/\//i.test(a.url)).slice(0, MAX_ENLACES)
  if (enlaces.length === 0) {
    lineas.push('⚠️ No se encontraron documentos adjuntos')
  } else {
    lineas.push(`📄 ${enlaces.length > 1 ? 'Archivos adjuntos' : 'Archivo adjunto'}:`)
    enlaces.forEach((a, i) => {
      const nombre = a.nombre.trim() || `Archivo ${i + 1}`
      lineas.push(
        `&nbsp;&nbsp;🔗 <a href="${escaparHtml(a.url)}" target="_blank" rel="noopener">${escaparHtml(nombre)}</a>`,
      )
    })
  }
  return lineas.join('<br>')
}
