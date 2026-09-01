/**
 * Recorrido del módulo de PAGOS. Es el equivalente de `lib/pasos` para el otro circuito: toda su
 * navegación —stepper, títulos, índice de avance, botones de avanzar y volver— sale de este archivo.
 *
 * Vive APARTE y no como una rama más de `lib/pasos` porque Pagos es una operación independiente:
 * sus etapas no son las de Cobros, no comparte una sola clave con ellas, y meter las dos en la
 * misma tabla obligaría a que cada consulta aclarara de qué módulo está hablando.
 *
 * Igual que allá, el recorrido YA NO es único: lo ramifica lo que el usuario elige pagar en la
 * etapa 1 (ver `TipoOperacionPago`).
 */
import type { PasoPago, TipoOperacionPago } from '@/types'

/** Etiqueta de cada etapa, en el orden en que se recorren. */
export const ETAPA_PAGO: Record<PasoPago, string> = {
  proveedor: 'Seleccionar Proveedor',
  facturasCompra: 'Seleccionar Facts Compra Pends de Pago',
  pago: 'Registrar Pagos',
  orden: 'Emitir y Enviar Orden de Pago',
}

/** Etiquetas que PISAN a las de `ETAPA_PAGO` en el recorrido del anticipo. */
const ETAPA_PAGO_ANTICIPO: Partial<Record<PasoPago, string>> = {
  pago: 'Registrar Anticipo',
}

/** Etiquetas que PISAN a las de `ETAPA_PAGO` al aplicar un anticipo contra facturas de compra. */
const ETAPA_PAGO_APLICACION: Partial<Record<PasoPago, string>> = {
  pago: 'Aplicar Anticipo',
}

/** Bajada de cada etapa: la explicación que acompaña al título del paso. */
export const DESCRIPCION_PAGO: Record<PasoPago, string> = {
  proveedor: 'Elegí qué vas a pagar y buscá el proveedor de la operación.',
  facturasCompra:
    'Elegí las facturas de compra pendientes del proveedor e indicá cuánto se paga de cada una.',
  pago: 'Registrá el pago: caja, importe e imputación sobre las facturas seleccionadas.',
  orden: 'Emití la orden de pago en Monday y enviásela al proveedor.',
}

/** Bajadas que PISAN a las de `DESCRIPCION_PAGO` en el recorrido del anticipo. */
const DESCRIPCION_PAGO_ANTICIPO: Partial<Record<PasoPago, string>> = {
  pago: 'Cargá el importe que se le entrega al proveedor a cuenta y con qué cajas se entrega.',
  orden: 'Emití la orden de pago del anticipo en Monday y enviásela al proveedor.',
}

/** Bajadas que PISAN a las de `DESCRIPCION_PAGO` al aplicar un anticipo contra facturas. */
const DESCRIPCION_PAGO_APLICACION: Partial<Record<PasoPago, string>> = {
  pago: 'Elegí los anticipos del proveedor e indicá cuánto se aplica de cada saldo a favor.',
  orden: 'Emití la orden de pago de la aplicación en Monday y enviásela al proveedor.',
}

/**
 * Etapas de cada operación, en orden. El ANTICIPO no pasa por "Seleccionar Facts Compra Pends de
 * Pago": no cancela facturas, así que el importe lo declara el propio paso de registro.
 *
 * Es exactamente la misma ramificación que en Cobros, donde el anticipo también se saltea el paso
 * de los comprobantes pendientes.
 */
const RECORRIDO_PAGO: Record<TipoOperacionPago, readonly PasoPago[]> = {
  facturasCompra: ['proveedor', 'facturasCompra', 'pago', 'orden'],
  anticipo: ['proveedor', 'pago', 'orden'],
  /* La APLICACIÓN recorre las mismas cuatro etapas que el pago y REUTILIZA las dos primeras tal
     cual: se elige el proveedor y sus facturas de compra pendientes igual que siempre. Lo único
     distinto es la etapa 3, donde el dinero no sale por una caja sino del saldo a favor que ya
     teníamos con él. */
  aplicacion: ['proveedor', 'facturasCompra', 'pago', 'orden'],
}

/**
 * Recorrido vigente. Sin operación elegida se usa el de las FACTURAS: es el recorrido completo, así
 * que el stepper muestra todas las etapas mientras el usuario todavía no decidió qué registrar.
 */
export const pasosDePago = (tipo: TipoOperacionPago | null): readonly PasoPago[] =>
  RECORRIDO_PAGO[tipo ?? 'facturasCompra']

/**
 * Cómo se llama una etapa en ESTA operación. El mismo paso `pago` es "Registrar Pagos" cuando se
 * cancelan facturas de compra y "Registrar Anticipo" cuando se le entrega dinero a cuenta al
 * proveedor: es el mismo lugar del recorrido, con otro nombre.
 */
export const etiquetaDePasoPago = (paso: PasoPago, tipo: TipoOperacionPago | null): string => {
  const propia =
    tipo === 'anticipo'
      ? ETAPA_PAGO_ANTICIPO
      : tipo === 'aplicacion'
        ? ETAPA_PAGO_APLICACION
        : undefined
  return propia?.[paso] ?? ETAPA_PAGO[paso]
}

/** La bajada de la etapa en ESTA operación. */
export const descripcionDePasoPago = (paso: PasoPago, tipo: TipoOperacionPago | null): string => {
  const propia =
    tipo === 'anticipo'
      ? DESCRIPCION_PAGO_ANTICIPO
      : tipo === 'aplicacion'
        ? DESCRIPCION_PAGO_APLICACION
        : undefined
  return propia?.[paso] ?? DESCRIPCION_PAGO[paso]
}

/** Etiquetas del stepper para una operación, en orden. */
export const etiquetasPago = (tipo: TipoOperacionPago | null): string[] =>
  pasosDePago(tipo).map((p) => etiquetaDePasoPago(p, tipo))

/**
 * En qué posición del recorrido cae una etapa. Sin la etapa en el recorrido devuelve 0: es
 * preferible marcar la primera antes que romper (mismo criterio que `indiceDePaso`).
 */
export function indiceDePasoPago(paso: PasoPago, tipo: TipoOperacionPago | null = null): number {
  const i = pasosDePago(tipo).indexOf(paso)
  return i >= 0 ? i : 0
}

/** Número de paso que se muestra en pantalla (1-based), el mismo que marca el stepper. */
export const numeroDePasoPago = (paso: PasoPago, tipo: TipoOperacionPago | null = null): number =>
  indiceDePasoPago(paso, tipo) + 1

/** La etapa que sigue en ESTE recorrido, o `null` si la actual es la última. */
export function siguientePasoPago(
  paso: PasoPago,
  tipo: TipoOperacionPago | null,
): PasoPago | null {
  const recorrido = pasosDePago(tipo)
  return recorrido[recorrido.indexOf(paso) + 1] ?? null
}

/** La etapa anterior en ESTE recorrido, o `null` si la actual es la primera. */
export function pasoAnteriorPago(paso: PasoPago, tipo: TipoOperacionPago | null): PasoPago | null {
  const recorrido = pasosDePago(tipo)
  const i = recorrido.indexOf(paso)
  return i > 0 ? recorrido[i - 1] : null
}
