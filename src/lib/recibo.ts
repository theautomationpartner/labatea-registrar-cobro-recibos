/**
 * Armado del RECIBO: qué dice el documento que se emite al cerrar la cobranza.
 *
 * El recibo no calcula nada nuevo. Es la vista documental de lo que ya decidieron los dos pasos
 * anteriores: las facturas imputadas (paso 2) son los comprobantes que se cancelan, y los
 * movimientos de pago (paso 3) son las formas de pago recibidas. Por eso este módulo sólo TRADUCE
 * el estado a las dos tablas del documento —y sus totales— sin volver a decidir importes.
 *
 * Puro: sin React, sin estado y sin red, igual que `lib/cobros` y `lib/pagos`.
 */
import { desdeIso } from '@/lib/dates'
import { round2 } from '@/lib/format'
import { esPagoConTarjeta, esRetencion } from '@/lib/pagos'
import type { Imputaciones } from '@/lib/cobros'
import type { FacturaPendiente, MovimientoPago } from '@/types'

/**
 * Número del recibo. Es un valor de maqueta: el definitivo lo asigna Monday al crear el ítem en
 * "➡️Recibos y Cobros", igual que el número de comprobante lo asigna la facturación.
 */
export const NRO_RECIBO = '0001-00001236'

/** Marca de un dato que el tablero no tiene cargado. La misma en las dos tablas del documento. */
export const SIN_DATO = '—'

/** Una factura cancelada por este recibo: una fila de la tabla "Comprobantes". */
export interface ComprobanteCancelado {
  /** Id de la factura pendiente en Monday: es la clave de la fila. */
  id: string
  /** Número del comprobante que ve el usuario ("FPENCOB-042"). */
  nro: string
  /** Venta que dejó la deuda ("VTA-094"). Vacía si la factura no la tiene conectada. */
  idVenta: string
  /** Fecha de emisión en dd/MM/yyyy. Vacía si el tablero no la tiene cargada. */
  emision: string
  /** Fecha de vencimiento en dd/MM/yyyy. Vacía si el tablero no la tiene cargada. */
  vencimiento: string
  /** Importe que ESTE recibo le cancela: lo imputado en el paso 2. */
  cancelado: number
}

/** Un pago recibido: una fila de la tabla "Forma de pago / caja". */
export interface PagoRecibido {
  /** Id local del movimiento. */
  id: string
  /** Nombre de la forma de pago, tal cual ("Efectivo", "Transferencia", "Tarjeta de débito"). */
  descripcion: string
  /** Comprobante que respalda el pago (nro de cheque, cupón, archivo adjunto). */
  comprobante: string
  /** Importe entregado con ese medio. */
  entregado: number
}

/** El documento completo: sus dos tablas y los totales que cierran cada una. */
export interface Recibo {
  comprobantes: ComprobanteCancelado[]
  pagos: PagoRecibido[]
  /** TOTAL CANCELADO: lo que suman las facturas del recibo. */
  totalCancelado: number
  /** TOTAL ENTREGADO: lo que suman las formas de pago del recibo. */
  totalEntregado: number
}

/**
 * Comprobante que respalda un pago, según su medio: el número del cheque, el cupón del posnet o
 * el archivo adjunto de la transferencia y las retenciones. El efectivo no tiene ninguno.
 */
export function comprobanteDePago(m: MovimientoPago): string {
  if (m.formaPago === 'Cheque') return m.numeroCheque?.trim() ?? ''
  if (esPagoConTarjeta(m.formaPago)) return m.numeroCupon?.trim() || m.comprobanteNombre?.trim() || ''
  if (m.formaPago === 'Transferencia' || esRetencion(m.formaPago)) {
    return m.comprobanteNombre?.trim() ?? ''
  }
  return ''
}

/**
 * El recibo que se emite por esta cobranza. Las facturas se recorren en el orden en que se
 * muestran —no en el que se fueron marcando—, así el documento sale siempre igual para la misma
 * cobranza.
 *
 * Los dos totales se calculan por separado, cada uno sobre su tabla, y NO se copian el uno del
 * otro: que coincidan es justamente lo que el paso 3 exige para llegar hasta acá (diferencia en
 * cero), y el documento tiene que poder mostrarlo.
 */
export function armarRecibo(
  facturas: readonly FacturaPendiente[],
  imputaciones: Imputaciones,
  movimientos: readonly MovimientoPago[],
): Recibo {
  const comprobantes: ComprobanteCancelado[] = facturas
    .filter((f) => f.id in imputaciones)
    .map((f) => ({
      id: f.id,
      nro: f.nro,
      idVenta: f.idVenta,
      emision: desdeIso(f.emision),
      vencimiento: desdeIso(f.vencimiento),
      cancelado: round2(imputaciones[f.id]),
    }))

  const pagos: PagoRecibido[] = movimientos.map((m) => ({
    id: m.id,
    /* Sólo el NOMBRE de la forma de pago. El banco del cheque, la cuenta que recibió la
       transferencia o la marca de la tarjeta ya se cargaron en el paso 3 y viajan a sus columnas
       del subelemento: repetirlos acá alargaba la fila sin agregar nada al documento. El dato que
       identifica al pago sigue estando en su columna, "Nro de Comprobante". */
    descripcion: m.formaPago,
    comprobante: comprobanteDePago(m),
    entregado: round2(m.importe),
  }))

  return {
    comprobantes,
    pagos,
    totalCancelado: round2(comprobantes.reduce((acc, c) => acc + c.cancelado, 0)),
    totalEntregado: round2(pagos.reduce((acc, p) => acc + p.entregado, 0)),
  }
}
