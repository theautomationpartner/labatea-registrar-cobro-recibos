/**
 * Reglas de negocio puras (sin React, sin DOM) derivadas de los datos que trae la capa de
 * servicio. Mismo lugar y misma firma que en la app de operaciones de venta, así el código que
 * las consume (la ficha del cliente, hoy) se mueve de una app a la otra sin tocar imports.
 */
import type { Cliente } from '@/types'

/** Umbrales de semáforo sobre el % de crédito utilizado. */
const CREDITO_ALERTA = 50
const CREDITO_CRITICO = 90

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

  let color = 'var(--green)'
  let clase: CreditoCliente['clase'] = 'v-green'
  if (usadoPct >= CREDITO_CRITICO) {
    color = 'var(--red)'
    clase = 'v-red'
  } else if (usadoPct >= CREDITO_ALERTA) {
    color = 'var(--yellow)'
    clase = 'v-orange'
  }

  return {
    disponible,
    usadoPct,
    disponiblePct,
    color,
    clase,
    bloqueado: c.situation === 'Bloqueado',
  }
}
