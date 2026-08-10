import type { Paso } from '@/types'

/**
 * Recorrido de la app. Es ÚNICO —no hay tipos de operación que lo ramifiquen—, así que las etapas
 * son una constante y no una función de la configuración. Toda la navegación (stepper, títulos de
 * paso, índice de avance) sale de acá: si mañana cambia el recorrido, se cambia en este archivo y
 * la app entera queda consistente.
 */
export const ETAPA = {
  cliente: 'Selección de Cliente',
  ventas: 'Seleccionar Vtas Pend de Cobro',
  cobro: 'Registrar Cobro',
  recibo: 'Emitir y Enviar Recibo',
} as const

/** Etiquetas del stepper, en orden. */
export const PASOS = [ETAPA.cliente, ETAPA.ventas, ETAPA.cobro, ETAPA.recibo] as const

/**
 * Claves de `Paso` en el MISMO orden que las etiquetas de `PASOS`: mapea el índice del stepper a la
 * etapa a la que se navega al hacer clic en su círculo. Las dos listas se recorren juntas, así que
 * agregar una etapa exige tocar ambas (el tipo `Paso` obliga a que la clave exista).
 */
export const PASOS_KEYS: readonly Paso[] = ['cliente', 'ventas', 'cobro', 'recibo']

/**
 * Bajada de cada etapa: la explicación que acompaña al título del paso. Vive junto a las etiquetas
 * para que el nombre y su descripción no se contradigan.
 */
export const DESCRIPCION: Record<Paso, string> = {
  cliente: 'Buscá y seleccioná el cliente al que se le va a registrar el cobro.',
  ventas: 'Elegí las facturas pendientes del cliente e indicá cuánto se cancela de cada una.',
  cobro: 'Registrá el cobro: medio de pago, importe e imputación sobre las ventas seleccionadas.',
  recibo: 'Emití el recibo en Monday y enviáselo al cliente.',
}

/**
 * En qué posición del stepper cae una etapa. Es lo que cada vista usa para marcarse como actual y
 * para numerar su título. Se busca por la CLAVE de `Paso`, no por la etiqueta: la clave es la
 * identidad de navegación y no cambia porque se reescriba un rótulo.
 *
 * Sin la etapa en el recorrido devuelve 0: es preferible marcar la primera antes que romper.
 */
export function indiceDePaso(paso: Paso): number {
  const i = PASOS_KEYS.indexOf(paso)
  return i >= 0 ? i : 0
}

/** Número de paso que se muestra en pantalla (1-based), el mismo que marca el stepper. */
export const numeroDePaso = (paso: Paso): number => indiceDePaso(paso) + 1
