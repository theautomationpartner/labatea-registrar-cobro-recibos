/**
 * Datos sin los que el cliente no puede usarse en un cobro. Reglas puras: las consume la vista del
 * paso 1 para frenar el avance y nombrar exactamente qué falta cargar en el board.
 */
import type { Cliente, MedioEnvio } from '@/types'

/** Texto vacío o sólo espacios cuenta como dato ausente. */
const vacio = (v: string | null | undefined) => !v || !v.trim()

/**
 * Datos del cliente sin los que no se puede armar la operación: sin lista de precio no hay precios
 * que traer, y sin condición de pago no se sabe cómo se cobra (contado / cuenta corriente), de lo
 * que depende el resto del flujo.
 *
 * La CONDICIÓN FISCAL no entra: en esta app no se emite una factura sino un RECIBO por dinero que
 * ya se cobró, así que no hay que decidir si el precio lleva IVA —eso lo resolvió la venta que dejó
 * la deuda—. Un cliente sin esa columna cargada opera igual, y frenarlo acá sería pedirle completar
 * el board para un dato que este circuito nunca usa.
 */
export function faltantesCliente(cliente: Cliente): string[] {
  const faltan: string[] = []
  if (vacio(cliente.list)) faltan.push('Lista de precio')
  if (vacio(cliente.condicionPago)) faltan.push('Condición de pago')
  return faltan
}

/* ===== Envío del comprobante ===== */

/**
 * Qué dato de contacto FALTA para el medio elegido. Con "Ambos" se miran los dos; con un medio
 * puntual, sólo el que ese canal necesita.
 */
export function faltaParaMedio(
  contacto: { phone: string; email: string },
  medio: MedioEnvio,
): { telefono: boolean; email: boolean } {
  return {
    telefono: (medio === 'WhatsApp' || medio === 'Ambos') && !contacto.phone.trim(),
    email: (medio === 'Email' || medio === 'Ambos') && !contacto.email.trim(),
  }
}

/**
 * El contacto NO tiene por dónde recibir el documento con el medio elegido.
 *
 * Con "Ambos" alcanza con UNO de los dos datos: se envía por el canal que tenga y se omite el
 * otro. Tratarlo como incompleto por faltarle cualquiera de los dos marcaría como problemáticos a
 * contactos perfectamente alcanzables.
 */
export function sinViaDeEnvio(
  contacto: { phone: string; email: string },
  medio: MedioEnvio,
): boolean {
  const falta = faltaParaMedio(contacto, medio)
  return medio === 'Ambos' ? falta.telefono && falta.email : falta.telefono || falta.email
}

/**
 * Los contactos elegidos que NO pueden recibir el documento por el medio elegido. Con "Ambos" no hay
 * ninguno: se le envía a cada uno por el canal que tenga.
 */
export function contactosSinVia<T extends { phone: string; email: string }>(
  contactos: readonly T[],
  medio: MedioEnvio,
): T[] {
  if (medio === 'Ambos') return []
  return contactos.filter((c) => sinViaDeEnvio(c, medio))
}

/** Cómo se nombra en el mensaje el dato que cada medio necesita. */
const DATO_DEL_MEDIO: Record<Exclude<MedioEnvio, 'Ambos'>, string> = {
  Email: 'una dirección de email cargada',
  WhatsApp: 'un número de teléfono cargado',
}

/**
 * Por qué ese contacto no puede recibir el documento. Nombra las TRES cosas que hacen falta para
 * entenderlo sin ir a buscar nada: el medio elegido, el contacto, y qué le falta.
 */
export const msgContactoSinVia = (nombre: string, medio: MedioEnvio): string =>
  medio === 'Ambos'
    ? ''
    : `Seleccionó ${medio.toLowerCase()} como medio de envío, pero el contacto ${nombre} NO tiene ${DATO_DEL_MEDIO[medio]}.`
