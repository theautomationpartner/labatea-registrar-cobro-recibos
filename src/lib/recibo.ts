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

/** Un anticipo imputado en una APLICACIÓN, tal como lo declara el recibo. */
export interface AnticipoAplicado {
  /** Id del anticipo en Monday. */
  id: string
  /** Número con el que se lo identifica ("REC1005"). */
  nro: string
  /** Importe que se aplica de su saldo a favor. */
  importe: number
}

/**
 * Los anticipos aplicados, como FORMAS DE PAGO del recibo. En una aplicación el cliente no entrega
 * dinero: lo que cubre las facturas es su saldo a favor, así que cada anticipo ocupa un renglón de
 * esa tabla y su suma es el TOTAL ENTREGADO —el mismo importe que el TOTAL CANCELADO—.
 *
 * Sin número de comprobante: el anticipo ya es el comprobante, y su identificación viaja en el
 * nombre de la forma de pago.
 */
export const pagosDeAnticipos = (aplicados: readonly AnticipoAplicado[]): PagoRecibido[] =>
  aplicados.map((a) => ({
    id: a.id,
    descripcion: a.nro ? `Anticipo ${a.nro}` : 'Anticipo',
    comprobante: '',
    entregado: round2(a.importe),
  }))

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
 * NRO DE COMPROBANTE del renglón: el número con el que se identifica el pago, y sólo lo tienen
 * tres medios —el cheque su número, la tarjeta su cupón y la retención el número del certificado—.
 *
 * El EFECTIVO y la TRANSFERENCIA no llevan ninguno: lo que respalda a la transferencia es un
 * archivo adjunto, y el nombre de ese archivo no es un número de comprobante. Ponerlo ahí llenaba
 * la columna con algo que el documento no declara.
 */
export function comprobanteDePago(m: MovimientoPago): string {
  if (m.formaPago === 'Cheque') return m.numeroCheque?.trim() ?? ''
  if (esPagoConTarjeta(m.formaPago)) return m.numeroCupon?.trim() ?? ''
  if (esRetencion(m.formaPago)) return m.nroComprobanteRetencion?.trim() ?? ''
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
  /**
   * Sólo APLICACIÓN: las formas de pago ya resueltas a partir de los anticipos imputados. Cuando
   * viene, REEMPLAZA a las de los movimientos —que en ese recorrido no existen—, y con ellas el
   * TOTAL ENTREGADO pasa a ser lo aplicado.
   */
  pagosAplicados?: readonly PagoRecibido[],
): Recibo {
  const comprobantes: ComprobanteCancelado[] = facturas
    .filter((f) => f.id in imputaciones)
    .map((f) => ({
      id: f.id,
      nro: f.nro,
      emision: desdeIso(f.emision),
      vencimiento: desdeIso(f.vencimiento),
      cancelado: round2(imputaciones[f.id]),
    }))

  const pagos: PagoRecibido[] = pagosAplicados
    ? [...pagosAplicados]
    : movimientos.map((m) => ({
        id: m.id,
        /* Sólo el NOMBRE de la forma de pago. El banco del cheque, la cuenta que recibió la
           transferencia o la marca de la tarjeta ya se cargaron en el paso 3 y viajan a sus
           columnas del subelemento: repetirlos acá alargaba la fila sin agregar nada al documento.
           El dato que identifica al pago sigue estando en su columna, "Nro de Comprobante". */
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
