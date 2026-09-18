/**
 * Reglas de negocio puras (sin React, sin DOM) derivadas de los datos que trae la capa de
 * servicio. Mismo lugar y misma firma que en la app de operaciones de venta, así el código que
 * las consume (la ficha del cliente, hoy) se mueve de una app a la otra sin tocar imports.
 */
import { round2 } from '@/lib/format'
import type { Cliente } from '@/types'

/** Umbrales de semáforo sobre el % de crédito utilizado. */
const CREDITO_ALERTA = 50
const CREDITO_CRITICO = 90

/** El semáforo de una línea de crédito: de qué color se pinta un uso del `pct` por ciento. */
export interface SemaforoCredito {
  /** Color del semáforo, en variables CSS. */
  color: string
  /** Clase de texto asociada al semáforo. */
  clase: 'v-green' | 'v-orange' | 'v-red'
}

/**
 * El semáforo que le corresponde a un porcentaje de uso de la línea.
 *
 * Vive aparte de `creditoCliente` porque lo mira algo más que la ficha del cliente: la tabla de la
 * GESTIÓN DE COBRANZA pinta el uso de línea de cada cuenta, y con los umbrales escritos dos veces
 * una pantalla podía mostrar en amarillo lo que la otra mostraba en verde.
 */
/**
 * Qué porcentaje del límite de crédito tiene tomado la cuenta, con dos decimales. `null` sin
 * límite asignado: un porcentaje sobre cero no es un dato.
 *
 * La miran el documento del RESUMEN DE CTA CTE y la tabla de la GESTIÓN DE COBRANZA, así que vive
 * acá y no en el módulo de una de las dos.
 */
export const usoDeLinea = (limite: number, lineaUtilizada: number): number | null =>
  limite > 0 ? round2((lineaUtilizada / limite) * 100) : null

export function semaforoDeCredito(pct: number): SemaforoCredito {
  if (pct >= CREDITO_CRITICO) return { color: 'var(--red)', clase: 'v-red' }
  if (pct >= CREDITO_ALERTA) return { color: 'var(--yellow)', clase: 'v-orange' }
  return { color: 'var(--green)', clase: 'v-green' }
}

export interface CreditoCliente {
  disponible: number
  usadoPct: number
  disponiblePct: number
  /** Color del semáforo, en variables CSS. */
  color: string
  /** Clase de texto asociada al semáforo. */
  clase: 'v-green' | 'v-orange' | 'v-red'
  bloqueado: boolean
}

/**
 * Estado de crédito del cliente. El disponible viene de la cuenta corriente (límite − línea
 * utilizada); el uso es lo que falta para llegar al límite, no un cálculo propio.
 */
export function creditoCliente(c: Cliente): CreditoCliente {
  const disponible = c.disponible
  const usado = c.limit - disponible
  const usadoPct = c.limit > 0 ? Math.round((usado / c.limit) * 100) : 0
  const disponiblePct = c.limit > 0 ? Math.round((disponible / c.limit) * 100) : 100

  const { color, clase } = semaforoDeCredito(usadoPct)

  return {
    disponible,
    usadoPct,
    disponiblePct,
    color,
    clase,
    bloqueado: c.situation === 'Bloqueado',
  }
}
