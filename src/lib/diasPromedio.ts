/**
 * DÍAS PROMEDIO DE COBRO de un recibo: cuántos días tardó el cliente en pagar las facturas que el
 * recibo cancela, contando desde su VENCIMIENTO (no desde la emisión).
 *
 *   días promedio = fecha del recibo − vencimiento promedio
 *
 * El vencimiento promedio es PONDERADO por lo que el recibo le cancela a cada factura (método de
 * numerales, el de la planilla "Comp de cobranzas"):
 *   1. Cada vencimiento se pasa a número de día desde el 01/01/2014.
 *   2. numeral = día de vencimiento × importe cancelado (en centavos).
 *   3. día promedio = TRUNCAR(Σ numerales ÷ Σ importes).
 *   4. días promedio = día del recibo − día promedio.
 *
 * Ponderado, porque una factura chica muy vieja no tiene que hacer parecer moroso a quien pagó
 * casi todo a tiempo. Truncado, para dar lo mismo que la planilla y que el módulo de Make que lo
 * calcula al emitir (`make-blueprints/modulo-dias-promedio-cobro.js`): los dos números tienen que
 * coincidir. Negativo = pagó antes del vencimiento promedio, y es un resultado válido.
 *
 * Puro: sin React, sin estado y sin red, igual que `lib/recibo`.
 */
import { parseDate } from '@/lib/dates'
import type { ComprobanteCancelado } from '@/lib/recibo'

const FECHA_BASE = Date.UTC(2014, 0, 1)
const MS_DIA = 24 * 60 * 60 * 1000

export type DiasPromedio =
  /** `fecha` en dd/MM/yyyy: el vencimiento promedio. */
  | { ok: true; fecha: string; dias: number }
  /** No se pudo calcular: `motivo` dice qué dato falta y de qué factura. */
  | { ok: false; motivo: string }

/**
 * dd/MM/yyyy → número de día desde la base. En UTC y no en hora local: un día con cambio de
 * horario duraría 23 o 25 horas y la división dejaría de dar un entero.
 */
function diaDe(fecha: string): number | null {
  const f = parseDate(fecha)
  if (!f) return null
  return Math.round((Date.UTC(f.getFullYear(), f.getMonth(), f.getDate()) - FECHA_BASE) / MS_DIA)
}

function fechaDelDia(dia: number): string {
  const f = new Date(FECHA_BASE + dia * MS_DIA)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(f.getUTCDate())}/${pad(f.getUTCMonth() + 1)}/${f.getUTCFullYear()}`
}

/**
 * Los días promedio de cobro de las FACTURAS del recibo, a la fecha `fechaRecibo` (dd/MM/yyyy).
 *
 * Toma los comprobantes que arma `armarRecibo`, así que se recalcula solo con lo que el recibo
 * cancela: si el usuario vuelve y cambia una factura o un importe, el número cambia con él. Los
 * anticipos quedan afuera —no vencen—. Sin facturas devuelve `null`: no hay nada que promediar.
 */
export function diasPromedioCobro(
  comprobantes: readonly ComprobanteCancelado[],
  fechaRecibo: string,
): DiasPromedio | null {
  const facturas = comprobantes.filter((c) => !c.esAnticipo)
  if (facturas.length === 0) return null

  const diaRecibo = diaDe(fechaRecibo)
  if (diaRecibo === null) return { ok: false, motivo: 'Falta la fecha del recibo' }

  const sinVencimiento = facturas.filter((f) => diaDe(f.vencimiento) === null).map((f) => f.nro)
  if (sinVencimiento.length > 0) {
    return { ok: false, motivo: `Sin vencimiento: ${sinVencimiento.join(', ')}` }
  }

  let numerales = 0
  let centavos = 0
  for (const f of facturas) {
    const c = Math.round(f.cancelado * 100)
    numerales += (diaDe(f.vencimiento) as number) * c
    centavos += c
  }
  if (centavos <= 0) return { ok: false, motivo: 'Las facturas no tienen importe cancelado' }

  const diaPromedio = Math.floor(numerales / centavos)
  return { ok: true, fecha: fechaDelDia(diaPromedio), dias: diaRecibo - diaPromedio }
}

/** Cómo lo muestra el resumen del recibo: "20/06/2026 (44 Dias)". */
export function formatoDiasPromedio(d: DiasPromedio): string {
  if (!d.ok) return d.motivo
  return `${d.fecha} (${d.dias} ${Math.abs(d.dias) === 1 ? 'Dia' : 'Dias'})`
}
