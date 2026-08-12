/**
 * Reglas de la imputación del cobro: qué se le asigna a cada factura y cuándo el paso está listo
 * para avanzar. Puras (sin React ni servicios), así la tabla, el total y la validación del botón
 * responden todas al mismo criterio.
 */
import { money, round2 } from '@/lib/format'
import type { AnticipoPendiente, FacturaPendiente } from '@/types'

/** `id de factura → importe a cancelar`. Que la clave exista marca la factura como seleccionada. */
export type Imputaciones = Record<string, number>

/** TOTAL A CANCELAR: la suma de todos los importes imputados. Es el importe del cobro. */
export const totalACancelar = (imputaciones: Imputaciones): number =>
  round2(Object.values(imputaciones).reduce((acc, n) => acc + (Number.isFinite(n) ? n : 0), 0))

/**
 * Facturas que coinciden con lo tecleado en el filtro. Se busca por número de comprobante y también
 * por el ID de la venta, que es el nombre con el que la fila se identifica en pantalla: filtrar por
 * algo que está a la vista y no encontrarlo sería desconcertante.
 *
 * La coincidencia es parcial y sin distinguir mayúsculas, así "42" alcanza para llegar a
 * "FPENCOB-042" sin tener que escribir el prefijo. Sin término devuelve todo.
 */
export function filtrarFacturas(
  facturas: readonly FacturaPendiente[],
  termino: string,
): FacturaPendiente[] {
  const t = termino.trim().toLowerCase()
  if (!t) return [...facturas]
  return facturas.filter(
    (f) => f.nro.toLowerCase().includes(t) || f.idVenta.toLowerCase().includes(t),
  )
}

/** Facturas elegidas, en el orden en que se muestran (no en el que se fueron marcando). */
export const facturasElegidas = (
  facturas: readonly FacturaPendiente[],
  imputaciones: Imputaciones,
): FacturaPendiente[] => facturas.filter((f) => f.id in imputaciones)

/** El importe imputado supera lo que la factura debe: no se puede cobrar más que el saldo. */
export const excedeSaldo = (factura: FacturaPendiente, importe: number): boolean =>
  Number.isFinite(importe) && round2(importe) > round2(factura.pendiente)

/** Mensaje único del exceso: el input y la ventana de bloqueo dicen exactamente lo mismo. */
export const MENSAJE_EXCESO =
  'El importe a cancelar no puede superar el pendiente de cancelar de la factura.'

/**
 * Color de una cancelación según cuánto cubre. Es el criterio ÚNICO del paso: lo usan el anillo
 * histórico de cada fila y el que se recalcula en vivo, así una factura mitad cancelada se ve
 * igual en los dos lugares.
 *
 * Amarillo mientras la cancelación es PARCIAL y verde recién cuando cubre el 100%: el amarillo es
 * lo que avisa de un saldo que sigue vivo.
 */
export function colorCancelacion(pct: number): string {
  if (pct >= 100) return 'var(--green)'
  if (pct > 0) return 'var(--yellow)'
  return 'var(--primary-blue)'
}

/**
 * Qué impide avanzar al paso siguiente. Devuelve el mensaje y, si corresponde, el detalle de las
 * facturas mal cargadas; `null` cuando el paso está listo.
 *
 * Son tres reglas: tiene que haber AL MENOS UNA factura elegida, TODAS las elegidas tienen que
 * llevar un importe mayor a 0, y ninguna puede superar su saldo pendiente. Una factura marcada con
 * importe en 0 no cancela nada: o se le carga un importe o se la desmarca.
 */
export interface BloqueoImputacion {
  titulo: string
  mensaje: string
  /** Comprobantes concretos que hay que corregir. Vacío cuando el problema no es de una factura. */
  faltantes: string[]
}

export function bloqueoDeImputacion(
  facturas: readonly FacturaPendiente[],
  imputaciones: Imputaciones,
): BloqueoImputacion | null {
  const elegidas = facturasElegidas(facturas, imputaciones)
  if (elegidas.length === 0) {
    return {
      titulo: 'No seleccionaste ninguna factura',
      mensaje:
        'Para continuar tenés que seleccionar al menos una factura pendiente e indicar cuánto se cancela de ella.',
      faltantes: [],
    }
  }
  const sinImporte = elegidas.filter((f) => !(imputaciones[f.id] > 0))
  if (sinImporte.length > 0) {
    return {
      titulo: 'Falta el importe a cancelar',
      mensaje:
        'Todas las facturas seleccionadas tienen que tener un importe a cancelar mayor a $ 0. Completá el importe o desmarcá la factura.',
      faltantes: sinImporte.map((f) => `Factura ${f.nro}`),
    }
  }
  const excedidas = elegidas.filter((f) => excedeSaldo(f, imputaciones[f.id]))
  if (excedidas.length > 0) {
    return {
      titulo: 'El importe supera el saldo de la factura',
      mensaje: MENSAJE_EXCESO,
      faltantes: excedidas.map((f) => `Factura ${f.nro} · máximo ${money(f.pendiente)}`),
    }
  }
  return null
}

/**
 * Cómo queda una factura si se le imputa `importe`: qué porcentaje de su saldo cancela y cuánto
 * le queda pendiente. Es lo que alimenta el gráfico en vivo del panel de pago.
 *
 * El porcentaje se mide contra el SALDO PENDIENTE de la factura (no contra su total): lo que el
 * usuario está decidiendo es qué parte de lo que se debe se cancela ahora.
 */
export interface ImpactoImputacion {
  pct: number
  aCobrar: number
  pendienteResultante: number
}

export function impactoImputacion(
  factura: FacturaPendiente,
  importe: number,
): ImpactoImputacion {
  const aCobrar = round2(Number.isFinite(importe) ? Math.max(importe, 0) : 0)
  const pct = factura.pendiente > 0 ? Math.round((aCobrar / factura.pendiente) * 100) : 0
  return {
    pct: Math.min(Math.max(pct, 0), 100),
    aCobrar,
    pendienteResultante: round2(Math.max(factura.pendiente - aCobrar, 0)),
  }
}

/* ===== Aplicación de anticipos contra facturas ===== */

/** `id de anticipo → importe aplicado`. Que la clave exista marca el anticipo como elegido. */
export type Aplicaciones = Record<string, number>

/** TOTAL APLICADO: la suma de lo que se le imputa a las facturas desde los anticipos. */
export const totalAplicado = (aplicaciones: Aplicaciones): number =>
  round2(Object.values(aplicaciones).reduce((acc, n) => acc + (Number.isFinite(n) ? n : 0), 0))

/** Anticipos elegidos, en el orden en que se muestran. */
export const anticiposElegidos = (
  anticipos: readonly AnticipoPendiente[],
  aplicaciones: Aplicaciones,
): AnticipoPendiente[] => anticipos.filter((a) => a.id in aplicaciones)

/** El importe aplicado supera el saldo a favor del anticipo: no se puede aplicar lo que no hay. */
export const excedeAnticipo = (anticipo: AnticipoPendiente, importe: number): boolean =>
  Number.isFinite(importe) && round2(importe) > round2(anticipo.pendiente)

/**
 * Qué impide emitir el recibo de una aplicación de anticipos.
 *
 * La regla dura es la DIFERENCIA EN CERO ABSOLUTO: lo aplicado tiene que cubrir exactamente lo
 * imputado a las facturas, ni un peso de más ni de menos. A diferencia del cobro con dinero —donde
 * una diferencia de centavos se tolera porque el redondeo del efectivo es real—, acá los dos lados
 * de la cuenta son saldos del sistema: si no cierran, el que está mal es el dato.
 */
export function bloqueoAplicacion(
  anticipos: readonly AnticipoPendiente[],
  aplicaciones: Aplicaciones,
  aCancelar: number,
): BloqueoImputacion | null {
  const elegidos = anticiposElegidos(anticipos, aplicaciones)
  if (elegidos.length === 0) {
    return {
      titulo: 'No seleccionaste ningún anticipo',
      mensaje:
        'Para continuar tenés que elegir al menos un anticipo del cliente e indicar cuánto se aplica de su saldo a favor.',
      faltantes: [],
    }
  }
  const sinImporte = elegidos.filter((a) => !(aplicaciones[a.id] > 0))
  if (sinImporte.length > 0) {
    return {
      titulo: 'Falta el importe a aplicar',
      mensaje:
        'Todos los anticipos seleccionados tienen que tener un importe mayor a $ 0. Completalo o desmarcá el anticipo.',
      faltantes: sinImporte.map((a) => `Anticipo ${a.recibo || a.nombre}`),
    }
  }
  const excedidos = elegidos.filter((a) => excedeAnticipo(a, aplicaciones[a.id]))
  if (excedidos.length > 0) {
    return {
      titulo: 'El importe supera el saldo del anticipo',
      mensaje: 'No se puede aplicar más de lo que el anticipo tiene pendiente de aplicar.',
      faltantes: excedidos.map(
        (a) => `Anticipo ${a.recibo || a.nombre} · máximo ${money(a.pendiente)}`,
      ),
    }
  }

  const diferencia = round2(aCancelar - totalAplicado(aplicaciones))
  if (diferencia !== 0) {
    return {
      titulo: 'La diferencia tiene que ser $ 0,00',
      mensaje:
        diferencia > 0
          ? `Todavía faltan ${money(diferencia)} para cubrir el total de las facturas seleccionadas. El recibo sólo se emite cuando los anticipos aplicados cubren exactamente ese total.`
          : `Los anticipos aplicados superan en ${money(-diferencia)} el total de las facturas seleccionadas. El recibo sólo se emite cuando la diferencia es exactamente $ 0,00.`,
      faltantes: [],
    }
  }
  return null
}
