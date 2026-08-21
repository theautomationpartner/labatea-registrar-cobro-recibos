/**
 * Reglas de uso del límite de crédito. Un único lugar decide si el crédito del cliente entra
 * en juego, para que la ficha, los cálculos de la operación y los bloqueos de escritura
 * respondan todos al mismo criterio.
 *
 * El crédito sólo se considera cuando la operación va a cuenta corriente Y el cliente está
 * liberado con crédito. Al contado no hay línea que consumir, y un cliente liberado sin
 * crédito opera sin tope: en los dos casos los importes se muestran, pero no se calculan.
 */
import { money, round2 } from '@/lib/format'
import type { Cliente, CondicionPago } from '@/types'

/** Condiciones de pago que consumen la línea de crédito del cliente. */
const CONDICIONES_A_CREDITO: readonly CondicionPago[] = [
  'CUENTA CORRIENTE',
  'PROVEED 45 DIAS',
  'PROVEED 90 DIAS',
]

/** La operación se cobra después, contra la cuenta corriente del cliente. */
export const esVentaACredito = (c: Cliente): boolean =>
  !!c.condicionPago && CONDICIONES_A_CREDITO.includes(c.condicionPago)

/** Bloqueado: no puede operar en el sistema, sea cual sea su condición de pago. */
export const clienteBloqueado = (c: Cliente | null | undefined): boolean =>
  c?.situation === 'Bloqueado'

/**
 * El límite de crédito rige esta operación. Es la pregunta que hacen los cálculos: con `false`
 * no se proyecta uso, no se pinta la barra y no se bloquea nada por crédito.
 */
export const aplicaCredito = (c: Cliente | null | undefined): boolean =>
  !!c && !clienteBloqueado(c) && esVentaACredito(c) && c.situation === 'Liberado con crédito'

/**
 * Por qué el límite no se va a considerar, para avisarlo en la ficha. `null` cuando sí rige o
 * cuando el cliente está bloqueado (eso se avisa aparte, con más peso).
 *
 * NO depende de que el cliente tenga valores cargados. Dependía cuando la ficha escondía el bloque
 * financiero de los clientes en cero: sin bloque no había nada que aclarar. Ahora el bloque se
 * muestra siempre, así que callar el motivo dejaría sus números en gris sin decir por qué —que es
 * justo lo que la aclaración existe para evitar—.
 */
export function motivoCreditoIgnorado(c: Cliente): string | null {
  if (clienteBloqueado(c) || aplicaCredito(c)) return null
  // Sin condición de pago no hay forma de saber cómo se cobra: se avisa por su cuenta, no como CONTADO.
  if (!c.condicionPago) {
    return 'No se considerará el crédito porque el cliente no tiene asignado una condición de pago en el sistema.'
  }
  if (!esVentaACredito(c)) {
    return 'No se considerará el crédito asignado al cliente porque su condición de pago es CONTADO.'
  }
  return 'El límite de crédito no será considerado durante la operación porque el cliente tiene estado "Liberado sin Crédito".'
}

/** Mensaje único del cliente bloqueado: se usa igual en la ficha y en los bloqueos. */
export const MENSAJE_CLIENTE_BLOQUEADO =
  'El cliente se encuentra bloqueado por lo que no es posible utilizarlo en el sistema.'

/**
 * Base de la línea de crédito ya consumida: la deuda de la cuenta corriente más los remitos
 * pendientes de facturar. Es lo que ya se le descontó del límite.
 */
export const creditoUsado = (c: Cliente): number => round2(c.saldoCtaCte + c.remitosPendFacturar)

/**
 * El cliente AGOTÓ su línea: lo consumido (deuda + remitos por facturar) llegó o superó el límite
 * asignado a su cuenta corriente.
 *
 * Sólo tiene sentido preguntarlo cuando el límite rige (`aplicaCredito`): al contado no hay línea
 * que consumir y un cliente liberado sin crédito opera sin tope, así que en esos casos no hay
 * límite que alcanzar. Sin límite asignado (0) tampoco: no hay tope contra el cual medir, y
 * tratarlo como "alcanzado" frenaría a cualquier cliente al que todavía no le cargaron el dato.
 */
export function limiteCreditoAlcanzado(c: Cliente | null | undefined): boolean {
  if (!aplicaCredito(c)) return false
  const cliente = c as Cliente
  if (cliente.limit <= 0) return false
  return creditoUsado(cliente) >= round2(cliente.limit)
}

/**
 * Por qué se frena la operación cuando la línea está agotada, con los números que lo sustentan:
 * cuánto tiene tomado sobre cuánto tiene asignado.
 */
export const mensajeLimiteCredito = (c: Cliente): string =>
  `${c.name} alcanzó el límite de crédito de su cuenta corriente: tiene ${money(creditoUsado(c))} ` +
  `tomados de los ${money(c.limit)} asignados. No se puede continuar con el cobro hasta que se ` +
  `regularice su situación crediticia.`
