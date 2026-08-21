/**
 * Reglas del PASE DE SALDO. Puras —sin React ni servicios—, así el bloqueo del paso 1, el del paso
 * 3 y sus ventanas de aviso responden todos al mismo criterio.
 */
import { excedeAnticipo } from '@/lib/cobros'
import { money, round2 } from '@/lib/format'
import type { AnticipoPendiente, CondicionPago } from '@/types'

/**
 * El cliente opera al CONTADO, y por eso no puede participar de un pase —ni de un lado ni del otro—.
 *
 * Un pase mueve saldo de cuenta corriente: a quien paga al contado no se le lleva una, así que
 * debitarle o acreditarle un saldo dejaría un movimiento sin cuenta donde impactar. La regla vale
 * para las DOS puntas, y por eso vive acá y no adentro de una pantalla.
 *
 * Sin condición de pago cargada NO se frena: la restricción la marca un CONTADO explícito y no la
 * ausencia del dato, igual que el resto de las validaciones de la app.
 */
export const esContado = (condicion: CondicionPago | null | undefined): boolean =>
  condicion === 'CONTADO'

/** Lo que se dice cuando el ORIGEN opera al contado. Nombra por qué, no sólo que no se puede. */
export const MSG_CONTADO_ORIGEN =
  'El cliente opera al CONTADO: no tiene cuenta corriente de la que debitar un saldo, así que no se le puede registrar un pase'

/** Lo mismo para el DESTINO, que es la punta que recibe. */
export const MSG_CONTADO_DESTINO =
  'La cuenta destino opera al CONTADO: no tiene cuenta corriente donde acreditar el saldo, así que el pase no se puede registrar'

/**
 * La DIFERENCIA de un pase: lo debitado al origen menos lo acreditado al destino.
 *
 * Por definición de la operación tiene que dar CERO —un pase mueve saldo, no lo crea ni lo
 * destruye—, y hoy los dos importes salen de la misma variable, así que la cuenta es redundante.
 * Se calcula igual, y a propósito: es la forma de que un futuro cambio que los separe no pueda
 * escribir un pase descuadrado sin que nadie se entere. Lo que se manda al tablero es ESTE número,
 * no un cero escrito a mano.
 */
export const diferenciaPase = (debitado: number, acreditado: number): number =>
  round2(debitado - acreditado)

/** El pase cuadra: lo que sale de una cuenta es exactamente lo que entra en la otra. */
export const paseCuadra = (debitado: number, acreditado: number): boolean =>
  diferenciaPase(debitado, acreditado) === 0

/** Lo que se dice cuando no cuadra. No debería pasar nunca: si pasa, hay que mirarlo. */
export const MSG_PASE_DESCUADRADO =
  'El pase no cuadra: lo debitado al origen no coincide con lo acreditado al destino'

/**
 * Lo que se dice cuando el importe a debitar de un anticipo supera su saldo pendiente. Es UN solo
 * texto para los dos lugares donde aparece —debajo del campo y en la ventana que se abre al
 * intentar avanzar—: es el mismo problema, y decirlo distinto en cada uno haría dudar de si son dos.
 */
export const MSG_EXCEDE_ANTICIPO =
  'El importe a debitar no puede ser mayor que el pend de aplicar del anticipo'

/** Y cuando un anticipo quedó marcado pero sin importe: no hay saldo que mover. */
export const MSG_SIN_IMPORTE_ANTICIPO =
  'Cargá cuánto se debita de cada anticipo elegido: el importe tiene que ser mayor a cero'

/**
 * Qué impide avanzar desde la selección de anticipos, o `null` cuando está listo. Misma forma que
 * los demás bloqueos de la app, así la ventana de aviso y el renglón del paso lo consumen sin
 * adaptaciones.
 *
 * El orden de las reglas es el de gravedad: primero que haya algo elegido, después que cada importe
 * sea válido. Un anticipo que se pasa de su saldo se nombra: "revisá los importes" a secas obligaría
 * a recorrer la tabla buscando cuál.
 */
export function bloqueoDePases(
  anticipos: readonly AnticipoPendiente[],
  pases: Record<string, number>,
): { titulo: string; mensaje: string; faltantes: string[] } | null {
  const elegidos = anticipos.filter((a) => a.id in pases)
  if (elegidos.length === 0) {
    return {
      titulo: 'No elegiste ningún anticipo',
      mensaje:
        'Para continuar tenés que elegir al menos un anticipo e indicar cuánto se debita de su saldo.',
      faltantes: [],
    }
  }

  const excedidos = elegidos.filter((a) => excedeAnticipo(a, pases[a.id]))
  if (excedidos.length > 0) {
    return {
      titulo: 'El importe supera el saldo del anticipo',
      mensaje: `${MSG_EXCEDE_ANTICIPO}.`,
      faltantes: excedidos.map((a) => `${a.recibo || a.nombre} · máximo ${money(a.pendiente)}`),
    }
  }

  const sinImporte = elegidos.filter((a) => !(pases[a.id] > 0))
  if (sinImporte.length > 0) {
    return {
      titulo: 'Falta el importe a debitar',
      mensaje: `${MSG_SIN_IMPORTE_ANTICIPO}.`,
      faltantes: sinImporte.map((a) => a.recibo || a.nombre),
    }
  }

  return null
}
