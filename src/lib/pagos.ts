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
  'Anticipo',
]

/**
 * El medio de cobro es una RETENCIÓN impositiva. No se enumeran las retenciones una por una: se
 * reconocen porque el nombre EMPIEZA con "Retencion" (con o sin tilde, sin distinguir mayúsculas),
 * así agregar "Retencion IVA", "Retencion SUSS" o la que venga al catálogo alcanza para que hereden
 * su ramal de carga —importe + comprobante adjunto obligatorio— sin tocar esta lógica.
 */
export const esRetencion = (forma: string | null | undefined): boolean =>
  /^retenci[oó]n\b/i.test((forma ?? '').trim())

/**
 * El movimiento es un ANTICIPO: no es plata que entra sino el sobrante que queda a favor del
 * cliente cuando lo recibido supera lo que se está cancelando —el caso típico es un cheque más
 * grande que la deuda, que no se puede partir—.
 *
 * Se carga como un medio más del formulario, pero cuenta al revés que los otros: suma del lado de
 * lo CANCELADO (ver `resumenCobro`), que es lo que lleva la diferencia a cero.
 */
export const esAnticipoDeCobro = (forma: FormaPago | string | null | undefined): boolean =>
  forma === 'Anticipo'

/** Cómo se llama el medio genérico en el selector, con todas las retenciones bajo una sola opción. */
export const MEDIO_RETENCION = 'Retencion'

/**
 * Medios que ofrece el selector de "Medio de Cobro". Las retenciones NO se enumeran una por una:
 * entran como una sola opción —"Retencion"— y el impuesto se elige en un segundo selector, al lado.
 *
 * Es la diferencia entre una lista de seis opciones y una de diez, casi todas iguales salvo la
 * sigla: el usuario elige primero CÓMO le pagaron y recién después, si hace falta, el detalle.
 */
export const MEDIOS_COBRO: readonly string[] = [
  ...FORMAS_PAGO.filter((f) => !esRetencion(f)).slice(0, 3),
  MEDIO_RETENCION,
  ...FORMAS_PAGO.filter((f) => !esRetencion(f)).slice(3),
]

/**
 * Impuestos que se pueden retener, tal como los ofrece el segundo selector: es la sigla de cada
 * forma de pago del catálogo, sin la palabra "Retencion" adelante.
 *
 * Sale de `FORMAS_PAGO` y no de una lista aparte: sumar "Retencion SUSS" al catálogo alcanza para
 * que aparezca en el selector, sin tocar nada más.
 */
export const TIPOS_RETENCION: readonly string[] = FORMAS_PAGO.filter(esRetencion).map((f) =>
  f.replace(/^retenci[oó]n\s*/i, ''),
)

/** La forma de pago que corresponde a un tipo de retención ("IVA" → "Retencion IVA"). */
export const retencionDeTipo = (tipo: string): FormaPago =>
  `${MEDIO_RETENCION} ${tipo}`.trim() as FormaPago

/** El tipo de una retención ("Retencion IVA" → "IVA"), o '' si la forma no es una retención. */
export const tipoDeRetencion = (forma: FormaPago | string | undefined): string =>
  esRetencion(forma) ? (forma ?? '').replace(/^retenci[oó]n\s*/i, '') : ''

/** Las dos tarjetas comparten el mismo ramal de carga (datos del plástico + acreditación). */
export const esPagoConTarjeta = (forma: FormaPago | null | undefined): boolean =>
  forma === 'Tarjeta de débito' || forma === 'Tarjeta de crédito'

/* ===== Cheque ===== */

/** Error bajo el CUIT del emisor cuando el cheque es del propio cliente y no se le reciben. */
export const MSG_CHEQUE_CLIENTE_NO = 'No se reciben cheques de este cliente: ingresá otro CUIT'

/** Sólo los dígitos: el mismo CUIT con guiones o sin ellos es el mismo CUIT. */
const digitosCuit = (cuit: string | null | undefined): string => (cuit ?? '').replace(/\D/g, '')

/**
 * CUIT con el formato del país: XX-XXXXXXXX-X.
 *
 * El tablero lo guarda como once dígitos corridos, y así es ilegible: la app lo muestra y lo compara
 * SIEMPRE con sus guiones, que es como está impreso en un cheque o en un certificado. Se formatea
 * al leerlo del board, una sola vez, y de ahí en más viaja formateado por todo el circuito.
 *
 * Lo que no tenga once dígitos vuelve tal cual: un dato a medio cargar se muestra como está en vez
 * de disfrazarse de CUIT.
 */
export function formatearCuit(cuit: string | null | undefined): string {
  const d = digitosCuit(cuit)
  if (d.length !== 11) return (cuit ?? '').trim()
  return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`
}

/**
 * Dos CUIT son el MISMO, comparados por dígitos: da igual con qué formato se escriba cada uno
 * ("30-71011711-6" y "30710117116"), porque el formato es de la pantalla y el número es del titular.
 *
 * Con alguno de los dos vacío devuelve `false`: sin número no hay identidad que comparar, y darlo
 * por igual sería dejar pasar justamente lo que se quiere controlar.
 */
export function mismoCuit(uno: string | undefined, otro: string | undefined): boolean {
  const a = digitosCuit(uno)
  const b = digitosCuit(otro)
  return a !== '' && a === b
}

/**
 * Forma comparable de una razón social: sin tildes, sin mayúsculas, sin puntuación y sin la forma
 * jurídica del final.
 *
 * Esa cola es la que más varía entre un papel y un tablero —"SAN LUCIANO SA", "San Luciano S.A.",
 * "SAN LUCIANO S A"— y no distingue a una empresa de otra, así que compararla sólo produciría
 * rechazos falsos.
 */
const FORMAS_JURIDICAS = ['sa', 'srl', 'sas', 'sca', 'scs', 'sh', 'saic', 'saci', 'sacif']

const nombreComparable = (nombre: string | null | undefined): string => {
  const limpio = (nombre ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  while (limpio.length > 1 && FORMAS_JURIDICAS.includes(limpio[limpio.length - 1])) limpio.pop()
  return limpio.join(' ')
}

/** Dos razones sociales nombran a la MISMA empresa. Vacías, no: no hay nada que comparar. */
export function mismaRazonSocial(
  una: string | null | undefined,
  otra: string | null | undefined,
): boolean {
  const a = nombreComparable(una)
  const b = nombreComparable(otra)
  return a !== '' && b !== '' && (a === b || a.includes(b) || b.includes(a))
}

/** En qué termina la validación del emisor de un comprobante contra el cliente de la operación. */
export type VeredictoEmisor =
  /** El comprobante es del cliente: su CUIT coincide, o su razón social cuando no hay CUIT. */
  | 'del-cliente'
  /** Es de OTRO contribuyente: el dato que identifica al emisor no es el del cliente. */
  | 'otro'
  /** El documento no dijo quién lo emitió, así que no se puede determinar de quién es. */
  | 'no-identificado'

/**
 * De quién es el comprobante que se acaba de leer.
 *
 * Manda el CUIT: es la identidad fiscal y no admite matices. La razón social sólo decide cuando el
 * documento no trajo CUIT —una transferencia suele mostrar el titular de la cuenta y no su número—,
 * y se compara con tolerancia porque un mismo nombre se escribe de varias formas.
 *
 * Sin CUIT del cliente cargado en el tablero, el CUIT del papel no se puede contrastar: ahí decide
 * el nombre, y si tampoco alcanza, el veredicto es que no se pudo identificar.
 */
export function emisorDelCliente(
  emisor: { cuit?: string; razonSocial?: string },
  cliente: Pick<Cliente, 'cuit' | 'name'>,
): VeredictoEmisor {
  if (cuitCompleto(emisor.cuit) && digitosCuit(cliente.cuit) !== '') {
    return mismoCuit(emisor.cuit, cliente.cuit) ? 'del-cliente' : 'otro'
  }
  const nombre = (emisor.razonSocial ?? '').trim()
  if (nombre === '') return 'no-identificado'
  return mismaRazonSocial(nombre, cliente.name) ? 'del-cliente' : 'otro'
}

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
 * REGLA DEL CHEQUE: el VENCIMIENTO no puede ser ANTERIOR al día en que se emite el recibo, que es
 * hoy. Un cheque ya vencido no lo paga el banco, así que darlo por cobrado dejaría asentado un
 * ingreso de dinero que no va a ocurrir.
 *
 * De hoy en adelante entra todo: un cheque al día vence hoy mismo y uno de pago diferido vence
 * después, y los dos son cobrables.
 *
 * La fecha de EMISIÓN del cheque no entra en la regla: es un dato del documento —cuándo lo libró su
 * emisor— y puede ser de cualquier día anterior. Se pide cargada, nada más.
 *
 * Se compara por DÍA —hoy a la medianoche—, nunca por hora, para que un cheque que vence hoy sea
 * válido a cualquier hora de la jornada.
 */
export const MSG_CHEQUE_VENCIMIENTO =
  'El cheque no puede vencer antes de la fecha del recibo: un cheque ya vencido no se cobra'

/**
 * La misma regla, dicha en el ancho de un campo. Debajo de un input hay lugar para un renglón, no
 * para la explicación entera: ahí se dice QUÉ tiene que pasar, y el porqué queda para el aviso del
 * pie del paso, que sí tiene el ancho de la pantalla.
 */
export const MSG_CHEQUE_VENC_CORTO = 'No puede vencer antes de hoy'

/** El vencimiento del cheque quedó antes de hoy (o no está cargado). */
export function vencimientoChequeInvalido(vencimiento: string | undefined): boolean {
  const venc = parseDate(vencimiento ?? '')
  if (!venc) return true
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  return venc.getTime() < hoy.getTime()
}

/** El cheque tiene un vencimiento que incumple la regla (o no lo tiene cargado). */
export function chequeInvalido(
  m: Pick<MovimientoPago, 'formaPago' | 'chequeVencimiento'>,
): boolean {
  if (m.formaPago !== 'Cheque') return false
  return vencimientoChequeInvalido(m.chequeVencimiento)
}

/**
 * REGLA DE LA TARJETA: el plástico tiene que seguir VIGENTE el día en que se emite el recibo, o sea
 * vencer DESPUÉS de hoy. Una tarjeta que vence hoy mismo ya no da garantía de acreditación, así que
 * se exige que quede al menos un día por delante.
 *
 * Es más estricta que la del cheque, y por un motivo distinto: el cheque se cobra POR su
 * vencimiento —vencer hoy es exactamente estar al día—, mientras que la tarjeta sirve MIENTRAS no
 * vence. Por eso la fecha de hoy es válida para uno e inválida para la otra.
 *
 * Se compara por DÍA —hoy a la medianoche—, nunca por hora.
 */
export const MSG_TARJETA_VENCIMIENTO =
  'La tarjeta tiene que estar vigente: su vencimiento debe ser posterior a la fecha del recibo'

/**
 * La misma regla, dicha en el ancho de un campo. Debajo de un input hay lugar para un renglón, no
 * para la explicación entera (mismo criterio que `MSG_CHEQUE_VENC_CORTO`).
 */
export const MSG_TARJETA_VENC_CORTO = 'Tiene que vencer después de hoy'

/** El vencimiento de la tarjeta es hoy o anterior (o no está cargado). */
export function vencimientoTarjetaInvalido(vencimiento: string | undefined): boolean {
  const venc = parseDate(vencimiento ?? '')
  if (!venc) return true
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  return venc.getTime() <= hoy.getTime()
}

/** La tarjeta tiene un vencimiento que incumple la regla (o no lo tiene cargado). */
export function tarjetaInvalida(
  m: Pick<MovimientoPago, 'formaPago' | 'vencimientoTarjeta'>,
): boolean {
  if (!esPagoConTarjeta(m.formaPago)) return false
  return vencimientoTarjetaInvalido(m.vencimientoTarjeta)
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

/* El cobro con tarjeta se puede partir en varios plásticos, y eso NO se declara en ninguna parte:
   se carga un movimiento por cada uno. El formulario propone en cada uno lo que falta para cerrar
   el cobro, así que el segundo viene con el resto ya calculado. */

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
  /* Los ANTICIPOS no son plata que entró: son el sobrante que queda a favor del cliente. Por eso
     suman a lo CANCELADO y no a lo recibido —el dinero ya está contado en el cheque que lo produjo,
     y contarlo dos veces duplicaría el cobro—. Cargar uno por la diferencia es, exactamente, lo que
     la lleva a cero. */
  const anticipos = round2(
    movimientos
      .filter((m) => esAnticipoDeCobro(m.formaPago))
      .reduce((acc, m) => acc + m.importe, 0),
  )
  const totalRecibido = round2(
    movimientos
      .filter((m) => !esAnticipoDeCobro(m.formaPago))
      .reduce((acc, m) => acc + m.importe, 0),
  )
  const cancelado = round2(totalACancelar + anticipos)
  return {
    totalACancelar: cancelado,
    totalRecibido,
    diferencia: round2(cancelado - totalRecibido),
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
 * El cobro ya está CUBIERTO: entró dinero y lo recibido iguala lo que hay que cancelar.
 *
 * A partir de acá no hay lugar para otro movimiento: cualquiera que se agregue —aunque sea un peso—
 * deja el total recibido por encima del que hay que cancelar, que es exactamente lo que impide
 * emitir el recibo. Se frena ANTES de cargarlo, en vez de dejar cargarlo y después reclamar el
 * exceso: pedir que se deshaga algo que la app dejó hacer es peor que no dejarlo hacer.
 *
 * Se exige que haya entrado ALGO (`totalRecibido > 0`) y no sólo que la diferencia dé cero: con el
 * paso recién abierto los dos totales pueden valer cero, y ahí no hay nada cubierto —hay un cobro
 * sin empezar—.
 *
 * Para cargar otro movimiento hay que quitar o ajustar alguno de los registrados, que siguen
 * editables en la tabla.
 */
export const cobroCubierto = (resumen: ResumenCobro): boolean =>
  resumen.totalRecibido > 0 && diferenciaSaldada(resumen)

/** Lo que se dice cuando el formulario se cierra por eso. Nombra la salida, no sólo el bloqueo. */
export const MSG_COBRO_CUBIERTO =
  'El total recibido ya cubre el total a cancelar: para cargar otro movimiento, quitá o ajustá alguno de los registrados.'

/**
 * Lo que se dice cuando lo recibido SE PASA del total a cancelar. Es UN solo texto para los dos
 * lugares donde aparece —el renglón de avisos del paso y la ventana que se abre al intentar
 * avanzar—: son el mismo problema, así que decirlo distinto en cada uno haría dudar de si son dos.
 *
 * Nombra las salidas que EXISTEN en cada recorrido. Cancelando ventas pendientes son dos —corregir
 * los importes, o registrar un ANTICIPO por la diferencia, que es un medio más del formulario—; al
 * registrar un anticipo queda sólo la primera, porque ahí el catálogo no ofrece ese medio: todo el
 * recorrido YA es un anticipo. Ofrecer una salida que la pantalla no tiene manda a buscar un
 * control que no existe.
 */
export const MSG_EXCESO = (exceso: number, ofreceAnticipo = true): string =>
  `El total recibido supera el total a cancelar en ${money(exceso)}: ${
    ofreceAnticipo
      ? 'ajustá los importes o registra un anticipo por esa diferencia'
      : 'ajustá los importes para que la diferencia sea 0'
  }`

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
 * La regla del cheque —su vencimiento— ya la impone el formulario al agregar, pero se vuelve a
 * mirar acá: el importe de un movimiento se puede editar en la tabla, y esta función es la que
 * decide el avance. Que la regla viva en un solo lugar es lo que evita que las dos validaciones se
 * separen.
 *
 * El COMPROBANTE no entra: adjuntarlo es opcional. Los datos del movimiento se pueden cargar a mano
 * —el documento sólo ahorra tipearlos—, así que exigir el archivo frenaría un cobro que está
 * completo.
 */
export function bloqueoCobro(
  movimientos: readonly MovimientoPago[],
  resumen: ResumenCobro,
  /**
   * El recorrido ofrece el medio "Anticipo" para absorber lo que se recibió de más. Sólo lo tiene
   * la cancelación de ventas pendientes; al registrar un anticipo, no (ver `MSG_EXCESO`).
   */
  ofreceAnticipo = true,
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
      titulo: 'Hay un cheque vencido',
      mensaje: `${MSG_CHEQUE_VENCIMIENTO}.`,
      faltantes: fueraDeFecha.map((m) => `Cheque ${m.numeroCheque?.trim() || 's/nro'}`),
    }
  }

  /* La tarjeta se mira aparte del cheque: su regla es otra —tiene que seguir vigente— y el mensaje
     nombra otro documento. Juntarlas en un solo aviso obligaría a un texto genérico que no diría
     cuál de los dos hay que corregir. */
  const vencidas = movimientos.filter(tarjetaInvalida)
  if (vencidas.length > 0) {
    return {
      titulo: 'Hay una tarjeta vencida',
      mensaje: `${MSG_TARJETA_VENCIMIENTO}.`,
      faltantes: vencidas.map((m) => `${m.formaPago} ${m.tipoTarjeta?.trim() || 's/tipo'}`),
    }
  }

  /* Recibir de menos deja facturas sin cancelar y recibir de más no corresponde a este cobro: en
     los dos casos se frena el avance. Lo que se mira son PESOS —los centavos ya los absorbe
     `diferenciaSaldada`—, así que llegar acá significa que hay al menos un peso descolocado.

     Pasarse tiene DOS salidas, y el mensaje las ofrece las dos: bajar los importes, o registrar un
     ANTICIPO por la diferencia —el sobrante queda a favor del cliente y el cobro cierra igual—. */
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
          mensaje: MSG_EXCESO(-falta, ofreceAnticipo),
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
  return bloqueoCobro(movimientos, resumen, false)
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
