/**
 * Reglas del REGISTRO del cobro: qué medios se ofrecen, qué datos exige cada uno y cuándo lo
 * recibido cierra contra lo que hay que cancelar. Puras —sin React, sin estado, sin red—, así el
 * formulario, la tabla, la cabecera y el bloqueo del avance responden todos al mismo criterio.
 *
 * Van aparte de `lib/cobros.ts`, que resuelve el paso ANTERIOR (qué factura se cancela y por
 * cuánto). Acá el total a cancelar llega como un número ya calculado: este módulo no sabe —ni
 * necesita saber— cómo se armó.
 *
 * NO hay descuentos por medio de pago. En la app de operaciones de venta el descuento por pronto
 * pago se aplica sobre la venta; en una cobranza de facturas ya emitidas no existe tal cosa: lo
 * que cancela la deuda es exactamente el importe recibido. Por eso "TOTAL RECIBIDO" tiene que
 * igualar al "TOTAL A CANCELAR" hasta el peso: lo único que se le perdona son los centavos (ver
 * `TOLERANCIA_DIFERENCIA`).
 */
import { parseDate } from '@/lib/dates'
import { money, round2 } from '@/lib/format'
import type { Cliente, FormaPago, MovimientoPago } from '@/types'

/** Medios de cobro que se ofrecen, en el orden en que aparecen en el selector. */
export const FORMAS_PAGO: readonly FormaPago[] = [
  'Efectivo',
  'Cheque',
  'Transferencia',
  'Retencion IVA',
  'Retencion IIBB',
  'Retencion GAN',
  'Retencion CCSS',
  'Retencion SUSS',
  'Tarjeta de débito',
  'Tarjeta de crédito',
]

/**
 * El medio de cobro es una RETENCIÓN impositiva. No se enumeran las retenciones una por una: se
 * reconocen porque el nombre EMPIEZA con "Retencion" (con o sin tilde, sin distinguir mayúsculas),
 * así agregar "Retencion IVA", "Retencion SUSS" o la que venga al catálogo alcanza para que hereden
 * su ramal de carga —importe + comprobante adjunto obligatorio— sin tocar esta lógica.
 */
export const esRetencion = (forma: string | null | undefined): boolean =>
  /^retenci[oó]n\b/i.test((forma ?? '').trim())

/** Una retención sólo se puede cargar con su comprobante adjunto. */
export const retencionSinComprobante = (
  m: Pick<MovimientoPago, 'formaPago' | 'comprobanteNombre'>,
): boolean => esRetencion(m.formaPago) && !m.comprobanteNombre?.trim()

/** Las dos tarjetas comparten el mismo ramal de carga (datos del plástico + acreditación). */
export const esPagoConTarjeta = (forma: FormaPago | null | undefined): boolean =>
  forma === 'Tarjeta de débito' || forma === 'Tarjeta de crédito'

/* ===== Cheque ===== */

/** Error bajo el CUIT del emisor cuando el cheque es del propio cliente y no se le reciben. */
export const MSG_CHEQUE_CLIENTE_NO =
  'No se reciben cheques del cliente seleccionado. Ingrese otro CUIT.'

/** Sólo los dígitos: el mismo CUIT con guiones o sin ellos es el mismo CUIT. */
const digitosCuit = (cuit: string | undefined): string => (cuit ?? '').replace(/\D/g, '')

/** En qué termina la validación del CUIT del emisor. */
export type ResultadoCuitEmisor =
  /** Se puede registrar: o es de un tercero, o es del cliente y sí le tomamos cheques. */
  | 'ok'
  /** Es del PROPIO cliente y su CRM dice que no le recibimos cheques. */
  | 'cliente-no-acepta'

/**
 * Valida el CUIT del emisor del cheque contra el cliente de la operación.
 *
 * La restricción es del EMISOR, no del medio: un cheque de un TERCERO se recibe siempre, aunque al
 * cliente no le tomemos los suyos. Sólo cuando el CUIT coincide con el del cliente se mira su
 * columna "Recibimos CHEQUE"; sin ese dato cargado el cheque se acepta, porque la restricción la
 * marca un "NO" explícito y no la ausencia de la columna.
 *
 * Se compara por DÍGITOS: el mismo CUIT con guiones o sin ellos es el mismo CUIT.
 */
export function validarCuitEmisor(
  cliente: Pick<Cliente, 'cuit' | 'aceptaCheques'> | null | undefined,
  cuitEmisor: string | undefined,
): ResultadoCuitEmisor {
  if (!cliente || cliente.aceptaCheques !== false) return 'ok'
  const delCliente = digitosCuit(cliente.cuit)
  if (delCliente === '') return 'ok'
  return digitosCuit(cuitEmisor) === delCliente ? 'cliente-no-acepta' : 'ok'
}

/**
 * REGLA DEL CHEQUE: el VENCIMIENTO tiene que ser el día de hoy, que es la fecha con la que se emite
 * el recibo y se registra el cobro. Un cheque cuyo vencimiento no es hoy —diferido o ya vencido—
 * dejaría asentado un ingreso de dinero que no ocurrió en esta operación.
 *
 * La fecha de EMISIÓN del cheque no entra en la regla: es un dato del documento —cuándo lo libró su
 * emisor— y puede ser de cualquier día anterior. Se pide cargada, nada más.
 *
 * Se compara por DÍA —hoy a la medianoche—, nunca por hora.
 */
export const MSG_CHEQUE_VENCIMIENTO =
  'El cheque tiene que vencer HOY, en la fecha del recibo: no se reciben diferidos ni vencidos'

/**
 * La misma regla, dicha en el ancho de un campo. Debajo de un input hay lugar para un renglón, no
 * para la explicación entera: ahí se dice QUÉ tiene que pasar, y el porqué queda para el aviso del
 * pie del paso, que sí tiene el ancho de la pantalla.
 */
export const MSG_CHEQUE_VENC_CORTO = 'El vencimiento tiene que ser hoy'

/** El vencimiento del cheque no es hoy (o no está cargado). */
export function vencimientoChequeInvalido(vencimiento: string | undefined): boolean {
  const venc = parseDate(vencimiento ?? '')
  if (!venc) return true
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  return venc.getTime() !== hoy.getTime()
}

/** El cheque tiene un vencimiento que incumple la regla (o no lo tiene cargado). */
export function chequeInvalido(
  m: Pick<MovimientoPago, 'formaPago' | 'chequeVencimiento'>,
): boolean {
  if (m.formaPago !== 'Cheque') return false
  return vencimientoChequeInvalido(m.chequeVencimiento)
}

/**
 * CUIT del emisor del cheque, cargado en tres tramos con el formato XX-XXXXXXXX-X. Cada tramo
 * exige EXACTAMENTE su cantidad de dígitos: menos que eso es un CUIT incompleto y no se puede
 * agregar el movimiento. El mensaje identifica cuál de los tres quedó corto.
 */
export const CUIT_TRAMOS = [
  {
    clave: 'prefijo',
    digitos: 2,
    aria: 'Primeros dos números del CUIT',
    error: 'El primer tramo del CUIT debe tener 2 números',
  },
  {
    clave: 'documento',
    digitos: 8,
    aria: 'DNI del CUIT, ocho números',
    error: 'El DNI del CUIT debe tener 8 números',
  },
  {
    clave: 'verificador',
    digitos: 1,
    aria: 'Último número del CUIT',
    error: 'El último tramo del CUIT debe tener 1 número',
  },
] as const

/**
 * Deja sólo los dígitos de lo tipeado y recorta al tope del tramo. Es lo que hace que el campo NO
 * acepte letras ni un dígito de más: lo que no cumple, simplemente no entra (sin mensaje de error).
 */
export const soloDigitos = (entrada: string, maximo: number): string =>
  (entrada ?? '').replace(/\D/g, '').slice(0, maximo)

/** Los tres tramos del CUIT. Los guiones son fijos, así que siempre devuelve tres strings. */
export const partesCuit = (cuit: string | undefined): [string, string, string] => {
  const [a = '', b = '', c = ''] = (cuit ?? '').split('-')
  return [a, b, c]
}

/** Índice del primer tramo del CUIT que quedó por debajo de sus dígitos, o -1 si está completo. */
export const tramoCuitIncompleto = (cuit: string | undefined): number =>
  partesCuit(cuit).findIndex((p, i) => p.length !== CUIT_TRAMOS[i].digitos)

/** El CUIT tiene los tres tramos completos: 2 + 8 + 1 dígitos. */
export const cuitCompleto = (cuit: string | undefined): boolean => tramoCuitIncompleto(cuit) === -1

/* ===== Tarjeta ===== */

/**
 * Un cobro con tarjeta —débito o crédito— se puede partir en UNA o DOS tarjetas. Es el mismo
 * catálogo que usa la app de operaciones de venta, de donde viene esta lógica.
 *
 * No es un plan de cuotas: son cuántos PLÁSTICOS cubren el importe. Con "2", el primero lo escribe
 * el usuario y el segundo se precarga con lo que quede pendiente (ver `importeSugeridoTarjeta`),
 * que es lo que evita tener que restar a mano para que la diferencia cierre en cero.
 *
 * Dos es el tope: partir un cobro en más plásticos no es un caso del circuito, y cada tarjeta suma
 * un movimiento propio al recibo.
 */
export const PAGOS_TARJETA = ['1', '2'] as const

export type CantPagosTarjeta = (typeof PAGOS_TARJETA)[number]

/**
 * Qué importe se le propone a la tarjeta que se está cargando.
 *
 * Con UN pago, la tarjeta tiene que cancelar todo lo que falta: se sugiere la diferencia entera.
 * Con DOS, la PRIMERA la escribe el usuario —es él quien decide cómo repartir— y por eso arranca
 * en cero; la segunda vuelve a sugerir la diferencia, que a esa altura es exactamente el resto.
 *
 * `cargadas` es cuántas tarjetas ya entraron al cobro: es lo que distingue la primera de la
 * segunda sin necesidad de llevar un contador aparte.
 */
export function importeSugeridoTarjeta(
  cantPagos: string,
  cargadas: number,
  diferencia: number,
): number {
  if (cantPagos === '2' && cargadas === 0) return 0
  return Math.max(diferencia, 0)
}

/* ===== Resumen del cobro ===== */

export interface ResumenCobro {
  /** Lo que suman las facturas imputadas en el paso anterior: es lo que hay que cubrir. */
  totalACancelar: number
  /** Lo que el cliente entrega, sumando todos los movimientos cargados. */
  totalRecibido: number
  /** Lo que falta recibir (>0) o lo que se recibió de más (<0). */
  diferencia: number
}

/**
 * Los tres números de la cabecera. La diferencia se redondea a dos decimales, que es la precisión
 * con la que se escriben los importes: es la MISMA métrica contra la que se decide si se avanza.
 */
export function resumenCobro(
  movimientos: readonly MovimientoPago[],
  totalACancelar: number,
): ResumenCobro {
  const totalRecibido = round2(movimientos.reduce((acc, m) => acc + m.importe, 0))
  return {
    totalACancelar: round2(totalACancelar),
    totalRecibido,
    diferencia: round2(totalACancelar - totalRecibido),
  }
}

/**
 * Hasta cuánta diferencia se da por cancelada. Lo que no puede quedar pendiente son PESOS: los
 * centavos son redondeo de la propia operación (retenciones, cupones, prorrateos entre facturas) y
 * exigir que cierren al centavo obligaría a maquillar un movimiento para tapar $ 0,03.
 *
 * Un peso entero, en cambio, SÍ es plata pendiente: con $ 1,00 de diferencia el cobro no está
 * cancelado en su totalidad. Por eso el tope es estricto —"menos de un peso"—: 0,99 cierra, 1,00 no.
 */
export const TOLERANCIA_DIFERENCIA = 1

/**
 * La diferencia quedó saldada: lo recibido iguala lo que hay que cancelar, salvo centavos. Es la
 * ÚNICA condición que habilita el avance de etapa, y vale para los dos lados —faltar un peso y
 * pasarse un peso frenan igual—, comparada con la misma precisión con la que se escribe.
 */
export const diferenciaSaldada = (resumen: ResumenCobro): boolean =>
  Math.abs(resumen.diferencia) < TOLERANCIA_DIFERENCIA

/**
 * Motivo por el que el cobro todavía no cierra, o `null` cuando está listo. Misma forma que el
 * bloqueo del paso 2 (`BloqueoImputacion`), para que las dos etapas avisen igual: la ventana de
 * aviso y el pie del paso lo consumen sin adaptaciones.
 */
export interface BloqueoCobro {
  titulo: string
  mensaje: string
  /** Movimientos concretos que hay que corregir. Vacío cuando el problema no es de un movimiento. */
  faltantes: string[]
}

/**
 * Qué impide registrar el cobro y avanzar. Las reglas se evalúan en orden de gravedad: primero que
 * haya algo cargado, después que cada movimiento sea válido y por último que los números cierren.
 *
 * Las dos reglas del medio —cheque vencido y retención sin comprobante— ya las impone el
 * formulario al agregar, pero se vuelven a mirar acá: el importe de un movimiento se puede editar
 * en la tabla, y esta función es la que decide el avance. Que la regla viva en un solo lugar es lo
 * que evita que las dos validaciones se separen.
 */
export function bloqueoCobro(
  movimientos: readonly MovimientoPago[],
  resumen: ResumenCobro,
): BloqueoCobro | null {
  if (movimientos.length === 0) {
    return {
      titulo: 'No registraste ningún cobro',
      mensaje:
        'Para continuar tenés que cargar al menos un movimiento de cobro que cubra el total a cancelar.',
      faltantes: [],
    }
  }

  const fueraDeFecha = movimientos.filter(chequeInvalido)
  if (fueraDeFecha.length > 0) {
    return {
      titulo: 'Hay un cheque que no vence hoy',
      mensaje: `${MSG_CHEQUE_VENCIMIENTO}.`,
      faltantes: fueraDeFecha.map((m) => `Cheque ${m.numeroCheque?.trim() || 's/nro'}`),
    }
  }

  const sinComprobante = movimientos.filter(retencionSinComprobante)
  if (sinComprobante.length > 0) {
    return {
      titulo: 'Falta el comprobante de una retención',
      mensaje: 'Las retenciones necesitan el comprobante adjunto para poder registrarse.',
      faltantes: sinComprobante.map((m) => `${m.formaPago} · ${money(m.importe)}`),
    }
  }

  /* Recibir de menos deja facturas sin cancelar y recibir de más no corresponde a este cobro: en
     los dos casos se frena el avance. Lo que se mira son PESOS —los centavos ya los absorbe
     `diferenciaSaldada`—, así que llegar acá significa que hay al menos un peso descolocado. */
  if (!diferenciaSaldada(resumen)) {
    const falta = resumen.diferencia
    return falta > 0
      ? {
          titulo: 'El total recibido no cubre el total a cancelar',
          mensaje: `Todavía faltan ${money(falta)} para cerrar el cobro: cargá o ajustá los movimientos hasta que el TOTAL RECIBIDO iguale el TOTAL A CANCELAR.`,
          faltantes: [],
        }
      : {
          titulo: 'El total recibido supera el total a cancelar',
          mensaje: `Lo recibido se pasa en ${money(-falta)}: ajustá los importes de los movimientos o volvé al paso anterior para imputar más facturas.`,
          faltantes: [],
        }
  }

  return null
}

/**
 * Qué le falta al anticipo para poder registrarse. Los tres datos se reclaman JUNTOS: son un solo
 * bloque de la pantalla, así que nombrarlos de a uno obligaría a intentar avanzar tres veces para
 * enterarse de todo lo que falta.
 *
 * Es la ÚNICA definición de "el anticipo está completo": la usan el bloqueo del paso y el
 * formulario de carga, así no pueden discrepar sobre cuándo se puede empezar a cargar pagos.
 */
export function faltantesDeAnticipo(datos: DatosAnticipo): string[] {
  return [
    !(datos.importe > 0) && 'Importe del anticipo',
    !datos.detalle.trim() && 'Detalle',
    !datos.vencimiento.trim() && 'Fecha Vto',
  ].filter((x): x is string => typeof x === 'string')
}

/**
 * Qué impide registrar un ANTICIPO. Es el mismo bloqueo del cobro con UNA regla antes: sin importe
 * declarado no hay nada que cancelar, así que ni siquiera tiene sentido mirar los movimientos.
 *
 * A partir de ahí las reglas son idénticas —los medios de pago y la diferencia saldada se validan
 * igual—, porque lo que cambia entre los dos recorridos es de dónde sale el TOTAL A CANCELAR (la
 * imputación a facturas o este importe), no cómo se controla que lo recibido lo iguale.
 */
export function bloqueoAnticipo(
  datos: DatosAnticipo,
  movimientos: readonly MovimientoPago[],
  resumen: ResumenCobro,
): BloqueoCobro | null {
  const faltantes = faltantesDeAnticipo(datos)
  if (faltantes.length > 0) {
    return {
      titulo: 'Faltan datos del anticipo',
      mensaje:
        'Completá arriba los datos del anticipo: el importe que entrega el cliente a cuenta —que es el total que el recibo va a declarar—, el detalle de por qué se registra y su fecha de vencimiento.',
      faltantes,
    }
  }
  return bloqueoCobro(movimientos, resumen)
}

/** Los tres datos que declaran un anticipo. Sin ellos el recorrido no avanza. */
export interface DatosAnticipo {
  importe: number
  detalle: string
  /** dd/MM/yyyy, el formato del ERP. */
  vencimiento: string
}

/** El cobro se puede registrar: hay movimientos, todos válidos, y la diferencia quedó saldada. */
export const cobroCompleto = (
  movimientos: readonly MovimientoPago[],
  resumen: ResumenCobro,
): boolean => bloqueoCobro(movimientos, resumen) === null
