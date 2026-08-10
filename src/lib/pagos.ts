/**
 * Reglas del REGISTRO del cobro: qué medios se ofrecen, qué datos exige cada uno y cuándo lo
 * recibido cierra contra lo que hay que cancelar. Puras —sin React, sin estado, sin red—, así el
 * formulario, la tabla, la cabecera y el bloqueo del avance responden todos al mismo criterio.
 *
 * Van aparte de `lib/cobros.ts`, que resuelve el paso ANTERIOR (qué factura se cancela y por
 * cuánto). Acá el total a cancelar llega como un número ya calculado: este módulo no sabe —ni
 * necesita saber— cómo se armó.
 *
 * NO hay descuentos por medio de pago. En la app de operaciones de venta el descuento por pronto
 * pago se aplica sobre la venta; en una cobranza de facturas ya emitidas no existe tal cosa: lo
 * que cancela la deuda es exactamente el importe recibido. Por eso "TOTAL RECIBIDO" puede —y
 * debe— igualar clavado al "TOTAL A CANCELAR".
 */
import { parseDate } from '@/lib/dates'
import { money, round2 } from '@/lib/format'
import type { Cliente, FormaPago, MovimientoPago } from '@/types'

/** Medios de cobro que se ofrecen, en el orden en que aparecen en el selector. */
export const FORMAS_PAGO: readonly FormaPago[] = [
  'Efectivo',
  'Cheque',
  'Transferencia',
  'Retencion IVA',
  'Retencion IIBB',
  'Retencion GAN',
  'Tarjeta de débito',
  'Tarjeta de crédito',
]

/**
 * El medio de cobro es una RETENCIÓN impositiva. No se enumeran las retenciones una por una: se
 * reconocen porque el nombre EMPIEZA con "Retencion" (con o sin tilde, sin distinguir mayúsculas),
 * así agregar "Retencion IVA", "Retencion SUSS" o la que venga al catálogo alcanza para que hereden
 * su ramal de carga —importe + comprobante adjunto obligatorio— sin tocar esta lógica.
 */
export const esRetencion = (forma: string | null | undefined): boolean =>
  /^retenci[oó]n\b/i.test((forma ?? '').trim())

/** Una retención sólo se puede cargar con su comprobante adjunto. */
export const retencionSinComprobante = (
  m: Pick<MovimientoPago, 'formaPago' | 'comprobanteNombre'>,
): boolean => esRetencion(m.formaPago) && !m.comprobanteNombre?.trim()

/** Las dos tarjetas comparten el mismo ramal de carga (datos del plástico + acreditación). */
export const esPagoConTarjeta = (forma: FormaPago | null | undefined): boolean =>
  forma === 'Tarjeta de débito' || forma === 'Tarjeta de crédito'

/** Sólo el crédito tiene plan de cuotas; el débito se acredita en un pago. */
export const esTarjetaDeCredito = (forma: FormaPago | null | undefined): boolean =>
  forma === 'Tarjeta de crédito'

/* ===== Cheque ===== */

/** Aviso al lado del medio de cobro que el CRM del cliente no habilita. */
export const MSG_CLIENTE_SIN_CHEQUE = 'cliente no acepta cheque'

/**
 * El cliente no puede pagar con cheque: su CRM dice que no le recibimos cheques
 * ("Recibimos CHEQUE" = NO). Acá la regla es de UNA sola condición, a diferencia de la venta, donde
 * además tenía que tratarse de una operación de CONTADO: en una cobranza no hay forma de pago de la
 * venta que la module, el cheque se recibe o no se recibe. Sin el dato cargado el medio se ofrece:
 * la restricción la marca un "NO" explícito, no la ausencia de la columna.
 */
export const chequeBloqueado = (
  cliente: Pick<Cliente, 'aceptaCheques'> | null | undefined,
): boolean => cliente?.aceptaCheques === false

/** Mensaje único de la regla de vencimiento del cheque: lo comparten el formulario y el bloqueo. */
export const MSG_CHEQUE_VENCIMIENTO = 'La fecha de vencimiento debe ser como máximo la fecha de hoy'

/**
 * Regla de negocio del cheque: el vencimiento NO puede ser posterior al día de hoy (venc <= hoy),
 * así que sólo se aceptan cheques ya vencidos o que vencen en el día. Se compara por DÍA —hoy a la
 * medianoche—, no por hora, para que un cheque con fecha de hoy sea siempre válido.
 */
export function vencimientoChequeInvalido(vencimiento: string | undefined): boolean {
  const venc = parseDate(vencimiento ?? '')
  if (!venc) return true
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  return venc.getTime() > hoy.getTime()
}

/** El cheque tiene una fecha de vencimiento que incumple la regla (o no la tiene cargada). */
export function chequeInvalido(m: Pick<MovimientoPago, 'formaPago' | 'chequeVencimiento'>): boolean {
  if (m.formaPago !== 'Cheque') return false
  return vencimientoChequeInvalido(m.chequeVencimiento)
}

/**
 * CUIT del emisor del cheque, cargado en tres tramos con el formato XX-XXXXXXXX-X. Cada tramo
 * exige EXACTAMENTE su cantidad de dígitos: menos que eso es un CUIT incompleto y no se puede
 * agregar el movimiento. El mensaje identifica cuál de los tres quedó corto.
 */
export const CUIT_TRAMOS = [
  {
    clave: 'prefijo',
    digitos: 2,
    aria: 'Primeros dos números del CUIT',
    error: 'El primer tramo del CUIT debe tener 2 números',
  },
  {
    clave: 'documento',
    digitos: 8,
    aria: 'DNI del CUIT, ocho números',
    error: 'El DNI del CUIT debe tener 8 números',
  },
  {
    clave: 'verificador',
    digitos: 1,
    aria: 'Último número del CUIT',
    error: 'El último tramo del CUIT debe tener 1 número',
  },
] as const

/**
 * Deja sólo los dígitos de lo tipeado y recorta al tope del tramo. Es lo que hace que el campo NO
 * acepte letras ni un dígito de más: lo que no cumple, simplemente no entra (sin mensaje de error).
 */
export const soloDigitos = (entrada: string, maximo: number): string =>
  (entrada ?? '').replace(/\D/g, '').slice(0, maximo)

/** Los tres tramos del CUIT. Los guiones son fijos, así que siempre devuelve tres strings. */
export const partesCuit = (cuit: string | undefined): [string, string, string] => {
  const [a = '', b = '', c = ''] = (cuit ?? '').split('-')
  return [a, b, c]
}

/** Índice del primer tramo del CUIT que quedó por debajo de sus dígitos, o -1 si está completo. */
export const tramoCuitIncompleto = (cuit: string | undefined): number =>
  partesCuit(cuit).findIndex((p, i) => p.length !== CUIT_TRAMOS[i].digitos)

/** El CUIT tiene los tres tramos completos: 2 + 8 + 1 dígitos. */
export const cuitCompleto = (cuit: string | undefined): boolean => tramoCuitIncompleto(cuit) === -1

/* ===== Tarjeta ===== */

/** Cuotas que se ofrecen en el crédito. Son fijas: las define el acuerdo con la tarjeta. */
export const CUOTAS_CREDITO = [3, 6, 12] as const

/** Dígitos reales de un número de tarjeta, sin los espacios del agrupado visual. */
export const NRO_TARJETA_DIGITOS = 16

export const MSG_NRO_TARJETA = 'Número de tarjeta inválido. Debe contener 16 dígitos'

/**
 * Número de tarjeta agrupado de a 4 para mostrar ("XXXX XXXX XXXX XXXX"), junto con los dígitos
 * puros que se guardan. Lo que no es número no entra y de 16 dígitos no se pasa: el agrupado es
 * sólo presentación, nunca parte del dato.
 */
export function formatearNroTarjeta(entrada: string): { texto: string; digitos: string } {
  const digitos = soloDigitos(entrada, NRO_TARJETA_DIGITOS)
  return { texto: digitos.replace(/(.{4})/g, '$1 ').trim(), digitos }
}

/** El número de tarjeta está completo: los 16 dígitos, ni uno menos. */
export const nroTarjetaCompleto = (numero: string | undefined): boolean =>
  (numero ?? '').length === NRO_TARJETA_DIGITOS

/**
 * Valor de cada cuota: el importe repartido en la cantidad de cuotas. Se recalcula solo cada vez
 * que cambia el importe del movimiento. Sin cuotas (débito) no hay valor por cuota.
 */
export const valorPorCuota = (importe: number, cuotas: number | undefined): number | null =>
  cuotas && cuotas > 0 ? round2(importe / cuotas) : null

/* ===== Resumen del cobro ===== */

export interface ResumenCobro {
  /** Lo que suman las facturas imputadas en el paso anterior: es lo que hay que cubrir. */
  totalACancelar: number
  /** Lo que el cliente entrega, sumando todos los movimientos cargados. */
  totalRecibido: number
  /** Lo que falta recibir (>0) o lo que se recibió de más (<0). */
  diferencia: number
}

/**
 * Los tres números de la cabecera. La diferencia se redondea a dos decimales, que es la precisión
 * con la que se escriben los importes: es la MISMA métrica contra la que se decide si se avanza.
 */
export function resumenCobro(
  movimientos: readonly MovimientoPago[],
  totalACancelar: number,
): ResumenCobro {
  const totalRecibido = round2(movimientos.reduce((acc, m) => acc + m.importe, 0))
  return {
    totalACancelar: round2(totalACancelar),
    totalRecibido,
    diferencia: round2(totalACancelar - totalRecibido),
  }
}

/**
 * La diferencia quedó en CERO exacto: lo recibido iguala lo que hay que cancelar. Es la ÚNICA
 * condición que habilita el avance de etapa —ni de menos (falta cobrar) ni de más (cobro
 * excedente)—, comparada con la misma precisión con la que se escribe: dos decimales.
 */
export const diferenciaEnCero = (resumen: ResumenCobro): boolean => resumen.diferencia === 0

/**
 * Motivo por el que el cobro todavía no cierra, o `null` cuando está listo. Misma forma que el
 * bloqueo del paso 2 (`BloqueoImputacion`), para que las dos etapas avisen igual: la ventana de
 * aviso y el pie del paso lo consumen sin adaptaciones.
 */
export interface BloqueoCobro {
  titulo: string
  mensaje: string
  /** Movimientos concretos que hay que corregir. Vacío cuando el problema no es de un movimiento. */
  faltantes: string[]
}

/**
 * Qué impide registrar el cobro y avanzar. Las reglas se evalúan en orden de gravedad: primero que
 * haya algo cargado, después que cada movimiento sea válido y por último que los números cierren.
 *
 * Las dos reglas del medio —cheque vencido y retención sin comprobante— ya las impone el
 * formulario al agregar, pero se vuelven a mirar acá: el importe de un movimiento se puede editar
 * en la tabla, y esta función es la que decide el avance. Que la regla viva en un solo lugar es lo
 * que evita que las dos validaciones se separen.
 */
export function bloqueoCobro(
  movimientos: readonly MovimientoPago[],
  resumen: ResumenCobro,
): BloqueoCobro | null {
  if (movimientos.length === 0) {
    return {
      titulo: 'No registraste ningún cobro',
      mensaje:
        'Para continuar tenés que cargar al menos un movimiento de cobro que cubra el total a cancelar.',
      faltantes: [],
    }
  }

  const vencidos = movimientos.filter(chequeInvalido)
  if (vencidos.length > 0) {
    return {
      titulo: 'Hay un cheque con el vencimiento mal cargado',
      mensaje: `${MSG_CHEQUE_VENCIMIENTO}.`,
      faltantes: vencidos.map((m) => `Cheque ${m.numeroCheque?.trim() || 's/nro'}`),
    }
  }

  const sinComprobante = movimientos.filter(retencionSinComprobante)
  if (sinComprobante.length > 0) {
    return {
      titulo: 'Falta el comprobante de una retención',
      mensaje: 'Las retenciones necesitan el comprobante adjunto para poder registrarse.',
      faltantes: sinComprobante.map((m) => `${m.formaPago} · ${money(m.importe)}`),
    }
  }

  /* Todo o nada: recibir de menos deja facturas sin cancelar y recibir de más no corresponde a
     este cobro. En los dos casos se frena el avance. */
  if (!diferenciaEnCero(resumen)) {
    const falta = resumen.diferencia
    return falta > 0
      ? {
          titulo: 'El total recibido no cubre el total a cancelar',
          mensaje: `Todavía faltan ${money(falta)} para cerrar el cobro: cargá o ajustá los movimientos hasta que el TOTAL RECIBIDO iguale el TOTAL A CANCELAR.`,
          faltantes: [],
        }
      : {
          titulo: 'El total recibido supera el total a cancelar',
          mensaje: `Lo recibido se pasa en ${money(-falta)}: ajustá los importes de los movimientos o volvé al paso anterior para imputar más facturas.`,
          faltantes: [],
        }
  }

  return null
}

/** El cobro se puede registrar: hay movimientos, todos válidos, y la diferencia quedó en cero. */
export const cobroCompleto = (
  movimientos: readonly MovimientoPago[],
  resumen: ResumenCobro,
): boolean => bloqueoCobro(movimientos, resumen) === null
