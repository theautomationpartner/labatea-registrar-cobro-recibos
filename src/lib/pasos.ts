import type { Paso, TipoOperacion } from '@/types'

/**
 * Recorrido de la app. Ya NO es único: lo ramifica lo que el usuario elige registrar en el paso 1
 * (ver `TipoOperacion`). Toda la navegación —stepper, títulos de paso, índice de avance, botones de
 * avanzar y volver— sale de este archivo: si mañana cambia un recorrido, se cambia acá y la app
 * entera queda consistente.
 */
export const ETAPA = {
  cliente: 'Selección de Cliente',
  ventas: 'Seleccionar Vtas Pend de Cobro',
  cobro: 'Registrar Cobro',
  recibo: 'Emitir y Enviar Recibo',
  anticipoOrigen: 'Seleccionar Anticipo',
  destino: 'Seleccionar Cuenta Destino',
  chequeRechazado: 'Seleccionar Cheque Rechazado',
  proveedorAcreedor: 'Seleccionar Proveedor Acreedor',
  configResumen: 'Configurar Emisión de Resumen de Cuenta',
  resumenCtaCte: 'Emitir y Enviar',
} as const

/** Etiquetas que PISAN a las de `ETAPA` en el recorrido del anticipo. */
const ETAPA_ANTICIPO: Partial<Record<Paso, string>> = {
  cobro: 'Registrar Anticipo',
}

/**
 * Etiquetas que PISAN a las de `ETAPA` en un PASE DE SALDO.
 *
 * El pase nombra CUENTAS y no personas, y por eso sus tres etapas son las MISMAS se haga entre
 * cuentas de clientes o entre cuentas de proveedores: lo que se elige en cada una —la cuenta de la
 * que sale el saldo, el anticipo que lo tiene y la cuenta que lo recibe— es exactamente lo mismo de
 * los dos lados del mostrador. Con "Cliente Origen" había que decidir el texto según el lado, y eso
 * era ramificar un rótulo que no dice nada distinto.
 */
const ETAPA_PASES: Partial<Record<Paso, string>> = {
  cliente: 'Seleccionar Cuenta Origen',
}

/** Etiquetas que PISAN a las de `ETAPA` al aplicar un anticipo contra facturas. */
const ETAPA_APLICACION: Partial<Record<Paso, string>> = {
  cobro: 'Aplicar Anticipo',
}

/**
 * Etiquetas que PISAN a las de `ETAPA` en un RECHAZO DE CHEQUE.
 *
 * El paso 1 es el mismo buscador de siempre, pero acá la persona no es "el cliente de la operación"
 * sino el DEUDOR: el que entregó el cheque que el banco devolvió y por eso vuelve a deber la plata.
 * Nombrarlo así es lo que hace que el operador sepa a quién tiene que buscar.
 */
const ETAPA_RECHAZOS: Partial<Record<Paso, string>> = {
  cliente: 'Seleccionar Cliente Deudor',
}

/** Etiquetas que PISAN a las de `ETAPA` en un RESUMEN DE CTA CTE. */
const ETAPA_RESUMEN: Partial<Record<Paso, string>> = {
  cliente: 'Seleccionar Cliente',
}

/**
 * Etiquetas ABREVIADAS para el stepper. El stepper es una tira de etapas en el encabezado, con una
 * columna angosta por etapa: un nombre largo se parte en cuatro renglones y empuja hacia abajo TODA
 * la barra de contexto. Acá va la versión corta de esos nombres; el título de la etapa —el de la
 * pantalla y el del botón que lleva a ella— sigue siendo el completo de `ETAPA`.
 */
const ETIQUETA_STEPPER: Partial<Record<Paso, string>> = {
  configResumen: 'Configurar Emisión',
}

/** Qué etiquetas propias tiene cada recorrido. Los que no figuran usan las de `ETAPA` tal cual. */
const ETAPAS_PROPIAS: Partial<Record<TipoOperacion, Partial<Record<Paso, string>>>> = {
  anticipo: ETAPA_ANTICIPO,
  aplicacion: ETAPA_APLICACION,
  pases: ETAPA_PASES,
  rechazos: ETAPA_RECHAZOS,
  resumen: ETAPA_RESUMEN,
}


/**
 * Etapas de cada operación, en orden. El ANTICIPO no pasa por "Seleccionar Vtas Pend de Cobro": no
 * cancela facturas, así que el importe lo declara el propio paso de registro.
 *
 * La APLICACIÓN recorre las mismas cuatro etapas que el cobro y REUTILIZA las dos primeras tal
 * cual: se elige el cliente y sus facturas pendientes igual que siempre. Lo único distinto es el
 * paso 3, donde el dinero no entra por una forma de pago sino por el saldo a favor del cliente.
 */
const RECORRIDO: Record<TipoOperacion, readonly Paso[]> = {
  cobro: ['cliente', 'ventas', 'cobro', 'recibo'],
  anticipo: ['cliente', 'cobro', 'recibo'],
  aplicacion: ['cliente', 'ventas', 'cobro', 'recibo'],
  /* PASES DE SALDO: el anticipo de un cliente se mueve a la cuenta de otro. TRES etapas: de dónde
     sale (cliente origen), QUÉ saldo se mueve (su anticipo) y a dónde va (cuenta destino). La
     última cierra la operación: el pase se registra ahí mismo, sin una pantalla de resultado que
     sólo repetiría lo que ya está en pantalla. */
  pases: ['cliente', 'anticipoOrigen', 'destino'],
  /* RECHAZO DE CHEQUE: el banco devolvió un cheque y la deuda que ese cheque había cancelado
     vuelve a estar viva de los DOS lados. TRES etapas: QUIÉN vuelve a deber (el cliente deudor),
     CUÁL de sus cheques en cartera rebotó y a QUIÉN se le había endosado (el proveedor acreedor).
     La última cierra la operación: el rechazo se registra ahí mismo, sin una pantalla de resultado
     que sólo repetiría lo que ya está en pantalla. */
  rechazos: ['cliente', 'chequeRechazado', 'proveedorAcreedor'],
  /* RESUMEN DE CTA CTE: se documenta la cuenta corriente de un cliente, sin mover saldo. TRES
     etapas: A QUIÉN (el cliente), CÓMO se arma el documento —qué movimientos de su cuenta entran y
     si lleva el estado de la cuenta— y la EMISIÓN con su envío, que cierra la operación. La consulta
     a los tableros sale al avanzar a la emisión: lo que se ve ahí es el documento, no una lista
     intermedia que habría que volver a mirar. */
  resumen: ['cliente', 'configResumen', 'resumenCtaCte'],
}

/**
 * Recorrido vigente. Sin operación elegida se usa el del COBRO: es el recorrido completo, así que
 * el stepper muestra todas las etapas mientras el usuario todavía no decidió qué registrar.
 */
export const pasosDe = (tipo: TipoOperacion | null): readonly Paso[] => RECORRIDO[tipo ?? 'cobro']

/** Etiquetas del stepper para una operación, en orden: las abreviadas donde hay una. */
export const etiquetasDe = (tipo: TipoOperacion | null): string[] =>
  pasosDe(tipo).map((p) => ETIQUETA_STEPPER[p] ?? etiquetaDePaso(p, tipo))

/**
 * Cómo se llama una etapa en ESTA operación. El mismo paso `cobro` es "Registrar Cobro" cuando se
 * cancelan facturas y "Registrar Anticipo" cuando el cliente entrega dinero a cuenta: es el mismo
 * lugar del recorrido, con otro nombre.
 */
export const etiquetaDePaso = (paso: Paso, tipo: TipoOperacion | null): string =>
  (tipo ? ETAPAS_PROPIAS[tipo]?.[paso] : undefined) ?? ETAPA[paso]

/**
 * Bajada del paso "destino". Es una PLANTILLA y no un texto fijo porque nombra el IMPORTE que se
 * está moviendo, que sólo se conoce en tiempo de ejecución: la vista la llama con el número ya
 * formateado.
 *
 * La frase está construida alrededor de ese importe ("los … seleccionados"), así que NO admite un
 * sustantivo genérico en su lugar: el texto neutro de `DESCRIPCION` es otro, escrito aparte.
 */
export const descripcionDestino = (loQueRecibe: string): string =>
  `Buscá la cuenta que va a recibir los ${loQueRecibe} pesos seleccionados en el paso anterior`

/**
 * Bajada de cada etapa: la explicación que acompaña al título del paso. Vive junto a las etiquetas
 * para que el nombre y su descripción no se contradigan.
 */
export const DESCRIPCION: Record<Paso, string> = {
  cliente: 'Elegí qué vas a cobrar y buscá el cliente de la operación.',
  ventas: 'Elegí las facturas pendientes del cliente e indicá cuánto se cancela de cada una.',
  cobro: 'Registrá el cobro: medio de pago, importe e imputación sobre las ventas seleccionadas.',
  recibo: 'Emití el recibo en Monday y enviáselo al cliente.',
  anticipoOrigen: 'Elegí el anticipo de la cuenta origen cuyo saldo se va a pasar a otra cuenta.',
  /* Sin importe a la vista —nadie llegó al paso todavía— se describe el paso, no la operación en
     curso. La versión con el número la arma la vista con `descripcionDestino`. */
  destino: 'Buscá la cuenta que va a recibir el saldo seleccionado en el paso anterior.',
  chequeRechazado: 'Elegí entre los cheques ya usados del cliente el que el banco rechazó.',
  proveedorAcreedor:
    'Buscá al proveedor al que se le había endosado el cheque: se le vuelve a deber su importe.',
  configResumen:
    'Indicá cómo se van a obtener los movimientos de la cuenta del cliente para generar el resumen.',
  resumenCtaCte: 'Emití el resumen de cuenta corriente y enviáselo al cliente.',
}

/** Bajadas que PISAN a las de `DESCRIPCION` en un RESUMEN DE CTA CTE. */
const DESCRIPCION_RESUMEN: Partial<Record<Paso, string>> = {
  cliente: 'Buscá el cliente al cual se le va a generar el resumen de cuenta.',
}

/** Bajadas que PISAN a las de `DESCRIPCION` en un PASE DE SALDO. Neutras como sus etiquetas: el
    paso habla de la CUENTA a la que se le debita, sea de un cliente o de un proveedor. */
const DESCRIPCION_PASES: Partial<Record<Paso, string>> = {
  cliente: 'Busca la cuenta a la cual se le debita de la cuenta corriente este movimiento',
}

/** Bajadas que PISAN a las de `DESCRIPCION` en un RECHAZO DE CHEQUE. */
const DESCRIPCION_RECHAZOS: Partial<Record<Paso, string>> = {
  cliente: 'Buscá al cliente que entregó el cheque que el banco rechazó.',
}

/** Bajadas que PISAN a las de `DESCRIPCION` al aplicar un anticipo contra facturas. */
const DESCRIPCION_APLICACION: Partial<Record<Paso, string>> = {
  cobro: 'Elegí los anticipos del cliente e indicá cuánto se aplica de cada saldo a favor.',
  recibo: 'Emití el recibo de la aplicación en Monday y enviáselo al cliente.',
}

/** Bajadas que PISAN a las de `DESCRIPCION` en el recorrido del anticipo. */
const DESCRIPCION_ANTICIPO: Partial<Record<Paso, string>> = {
  cobro: 'Cargá el importe que entrega el cliente a cuenta y con qué medios lo entrega.',
  recibo: 'Emití el recibo del anticipo en Monday y enviáselo al cliente.',
}

/** La bajada de la etapa en ESTA operación. */
const DESCRIPCIONES_PROPIAS: Partial<Record<TipoOperacion, Partial<Record<Paso, string>>>> = {
  anticipo: DESCRIPCION_ANTICIPO,
  aplicacion: DESCRIPCION_APLICACION,
  pases: DESCRIPCION_PASES,
  rechazos: DESCRIPCION_RECHAZOS,
  resumen: DESCRIPCION_RESUMEN,
}

export const descripcionDePaso = (paso: Paso, tipo: TipoOperacion | null): string =>
  (tipo ? DESCRIPCIONES_PROPIAS[tipo]?.[paso] : undefined) ?? DESCRIPCION[paso]

/**
 * En qué posición del recorrido cae una etapa. Es lo que cada vista usa para marcarse como actual y
 * para numerar su título. Se busca por la CLAVE de `Paso`, no por la etiqueta: la clave es la
 * identidad de navegación y no cambia porque se reescriba un rótulo.
 *
 * Sin la etapa en el recorrido devuelve 0: es preferible marcar la primera antes que romper.
 */
export function indiceDePaso(paso: Paso, tipo: TipoOperacion | null = null): number {
  const i = pasosDe(tipo).indexOf(paso)
  return i >= 0 ? i : 0
}

/** Número de paso que se muestra en pantalla (1-based), el mismo que marca el stepper. */
export const numeroDePaso = (paso: Paso, tipo: TipoOperacion | null = null): number =>
  indiceDePaso(paso, tipo) + 1

/** La etapa que sigue en ESTE recorrido, o `null` si la actual es la última. */
export function siguientePaso(paso: Paso, tipo: TipoOperacion | null): Paso | null {
  const recorrido = pasosDe(tipo)
  return recorrido[recorrido.indexOf(paso) + 1] ?? null
}

/** La etapa anterior en ESTE recorrido, o `null` si la actual es la primera. */
export function pasoAnterior(paso: Paso, tipo: TipoOperacion | null): Paso | null {
  const recorrido = pasosDe(tipo)
  const i = recorrido.indexOf(paso)
  return i > 0 ? recorrido[i - 1] : null
}
