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
import { parseDate, sumarDias } from '@/lib/dates'
import { money, round2 } from '@/lib/format'
import type { Cliente, FormaPago, FormatoCheque, MovimientoPago } from '@/types'

/** Medios de cobro que se ofrecen, en el orden en que aparecen en el selector. */
export const FORMAS_PAGO: readonly FormaPago[] = [
  'Efectivo',
  'Cheque',
  'Echeq',
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
const MEDIOS_SIN_RETENCION = FORMAS_PAGO.filter((f) => !esRetencion(f))

/* Dónde se inserta la opción genérica: justo DESPUÉS de la transferencia, que es donde termina el
   dinero que entra en efectivo o por banco y empieza lo demás. Se busca por nombre y no por
   posición: sumar un medio al catálogo —como el eCheq— movería un índice fijo y mandaría la
   retención al medio de la lista. */
const CORTE_RETENCION = MEDIOS_SIN_RETENCION.indexOf('Transferencia') + 1

export const MEDIOS_COBRO: readonly string[] = [
  ...MEDIOS_SIN_RETENCION.slice(0, CORTE_RETENCION),
  MEDIO_RETENCION,
  ...MEDIOS_SIN_RETENCION.slice(CORTE_RETENCION),
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

/**
 * El medio es un CHEQUE, de papel o electrónico. Los dos son medios propios del catálogo y piden
 * exactamente los mismos datos —número, las dos fechas, CUIT del emisor y banco—, así que comparten
 * ramal de carga, validaciones y detalle en la tabla. Mismo criterio que las dos tarjetas.
 */
export const esChequeDeCobro = (forma: FormaPago | string | null | undefined): boolean =>
  forma === 'Cheque' || forma === 'Echeq'

/**
 * Qué DOCUMENTO es el cheque, a partir del medio elegido. Es la única traducción entre las dos
 * formas de nombrar lo mismo: el catálogo del cobro ("Cheque" / "Echeq") y el formato con el que el
 * tablero identifica al papel y al electrónico (ver `CHEQUE_ORIGEN_LABEL`).
 *
 * Existe para que el formato NO sea un dato guardado al lado del medio: derivándolo, no hay forma
 * de registrar un movimiento que diga "Echeq" y viaje al tablero como cheque de papel.
 */
export const formatoDeCheque = (forma: FormaPago | string): FormatoCheque =>
  forma === 'Echeq' ? 'eCheq' : 'FISICO'

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

/* ===== eCheq: el endoso ===== */

/**
 * CUIT de LA BATEA. Es el destinatario que tiene que figurar en el endoso de un eCheq para que se
 * lo pueda depositar.
 *
 * Va escrito con los guiones del formato del país, igual que todo CUIT en esta app: la comparación
 * es por dígitos (`mismoCuit`), así que el formato es sólo para que se lea.
 */
export const CUIT_LA_BATEA = '30-70906788-1'

/**
 * El eCheq quedó A NOMBRE DE LA BATEA: el CUIT del beneficiario que devolvió la lectura es el
 * nuestro.
 *
 * A diferencia del cheque de papel —que se recibe con el documento en la mano—, un eCheq vive en el
 * sistema del banco y sólo lo puede depositar aquel a cuyo favor está. Por eso el control NO es
 * contra el cliente sino contra NOSOTROS: un eCheq que quedó a nombre de otro contribuyente no lo
 * cobra La Batea por más que todos sus datos estén completos y el cliente sea el correcto.
 *
 * Se compara el DESTINO y nunca el endosante: el endosante es quien nos transfirió el cheque —un
 * tercero, por definición— y exigirle nuestro CUIT rechazaría todos los eCheq endosados, que son
 * justamente los que llegan bien.
 *
 * Que el endoso figure PENDIENTE de aceptación no lo invalida: el cheque ya está a nuestro nombre y
 * aceptarlo es un trámite nuestro en el banco. El escenario lo informa como advertencia y así se
 * muestra, sin frenar la carga.
 *
 * Sin CUIT de destino devuelve `false`, y a propósito: acá la ausencia del dato NO es un permiso
 * —al revés que en el resto de las validaciones de la app—. Un eCheq del que no se pudo leer a
 * nombre de quién quedó es exactamente el que no se sabe si se va a poder cobrar.
 */
export const endosadoALaBatea = (cuitDestinatario: string | undefined): boolean =>
  mismoCuit(cuitDestinatario, CUIT_LA_BATEA)

/**
 * Lo que se dice cuando el eCheq no quedó a nuestro nombre. Nombra las DOS salidas posibles —que se
 * endose a La Batea, o que se cobre con otro medio—, porque desde la pantalla no hay nada que
 * corregir: el endoso se hace en el banco, no en este formulario.
 */
export const MSG_ECHEQ_SIN_ENDOSO =
  `El eCheq no figura a nombre de La Batea (CUIT ${CUIT_LA_BATEA}), así que no se va a poder depositar. Pedí que se endose a La Batea y volvé a cargar el comprobante, o registrá el cobro con otro medio.`

/**
 * Las DOS fechas de un cheque, que no son la misma:
 *
 *   · FECHA DE PAGO   · el día a partir del cual el banco lo paga. Es la que trae el documento y la
 *                       que el usuario carga; en un cheque de pago diferido es la del diferimiento.
 *   · VENCIMIENTO     · el último día para presentarlo al cobro, treinta días después de la de
 *                       pago. NO se carga: se DERIVA, así que no puede quedar en desacuerdo con la
 *                       de pago ni depender de que alguien la calcule bien a mano.
 *
 * Antes había una sola fecha —llamada "vencimiento" pero cargada con la de pago—, y esa mezcla es
 * la que este par deshace.
 */
export const DIAS_VENCIMIENTO_CHEQUE = 30

/**
 * El vencimiento que le corresponde a esa fecha de pago. Vacío si la fecha de pago todavía no está
 * completa: de una fecha a medio cargar no se deriva otra.
 */
export const vencimientoDeCheque = (fechaPago: string | undefined): string =>
  sumarDias(fechaPago ?? '', DIAS_VENCIMIENTO_CHEQUE)

/** Es anterior a HOY, comparando por día y nunca por hora. Vacía cuenta como inválida. */
function anteriorAHoy(fecha: string | undefined): boolean {
  const f = parseDate(fecha ?? '')
  if (!f) return true
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  return f.getTime() < hoy.getTime()
}

/**
 * REGLA 1 · la FECHA DE PAGO no puede ser anterior al día en que se emite el recibo, que es hoy.
 * Un cheque cuya fecha de pago ya pasó es un cheque que se debió depositar antes, así que tomarlo
 * como cobro de hoy asienta un ingreso que no va a ocurrir en esta operación.
 *
 * De hoy en adelante entra todo: un cheque al día se paga hoy mismo y uno diferido más adelante, y
 * los dos son cobrables. No hay tope por arriba —una fecha de pago lejana es un cheque diferido, no
 * un error—, así que lo único que se controla es que no haya quedado atrás.
 *
 * Vale IGUAL para el papel y para el eCheq (ver `esChequeDeCobro`). La fecha de EMISIÓN no entra en
 * ninguna de las dos reglas: es un dato del documento —cuándo lo libró su emisor— y puede ser de
 * cualquier día anterior; se pide cargada, nada más.
 */
export const MSG_CHEQUE_PAGO_ANTERIOR =
  'La fecha de pago del cheque no puede ser anterior a la fecha del recibo: un cheque con fecha de pago vencida no corresponde a este cobro'

/**
 * La misma regla, dicha en el ancho de un campo. Debajo de un input hay lugar para un renglón, no
 * para la explicación entera: ahí se dice QUÉ tiene que pasar, y el porqué queda para el aviso del
 * pie del paso, que sí tiene el ancho de la pantalla.
 */
export const MSG_CHEQUE_PAGO_CORTO = 'La fecha de pago no puede ser anterior a hoy'

/** La fecha de pago quedó antes de hoy (o no está cargada). */
export const fechaPagoChequeInvalida = (fechaPago: string | undefined): boolean =>
  anteriorAHoy(fechaPago)

/**
 * REGLA 2 · el VENCIMIENTO —la fecha de pago más treinta días— tampoco puede haber quedado atrás:
 * pasado ese día el banco ya no lo paga y el cheque no se puede depositar.
 *
 * Es consecuencia de la regla 1 y no una condición independiente: con una fecha de pago válida el
 * vencimiento cae siempre treinta días más adelante, así que esta regla sólo puede saltar cuando la
 * de pago ya quedó atrás por más de un mes. Se evalúa igual, y por separado, porque lo que hay que
 * decirle al usuario en ese caso es otra cosa: el cheque no está "mal cargado", está VENCIDO y no
 * sirve ninguna corrección sobre él.
 */
export const MSG_CHEQUE_VENCIDO =
  'El cheque está vencido: pasaron más de 30 días desde su fecha de pago y el banco ya no lo paga'

/** La misma, en el ancho del campo. Nombra la salida: con este cheque no hay nada que corregir. */
export const MSG_CHEQUE_VENCIDO_CORTO = 'Cheque VENCIDO. Ingresá otro cheque'

/**
 * El vencimiento derivado de esa fecha de pago ya pasó.
 *
 * SIN fecha de pago devuelve `false`: no saber cuándo se paga no es lo mismo que estar vencido, y
 * decir "cheque VENCIDO" sobre un campo todavía vacío mandaría a descartar un cheque que puede
 * estar perfecto. Ese caso lo reclama `fechaPagoChequeInvalida`, que es de quien es.
 */
export const chequeVencido = (fechaPago: string | undefined): boolean =>
  !!parseDate(fechaPago ?? '') && anteriorAHoy(vencimientoDeCheque(fechaPago))

/** El cheque incumple alguna de las dos reglas de fecha (o no tiene fecha de pago cargada). */
export function chequeInvalido(
  m: Pick<MovimientoPago, 'formaPago' | 'fechaPagoCheque'>,
): boolean {
  if (!esChequeDeCobro(m.formaPago)) return false
  return fechaPagoChequeInvalida(m.fechaPagoCheque) || chequeVencido(m.fechaPagoCheque)
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

  /* Se nombra el MEDIO y no "Cheque" a secas: en la lista pueden convivir un cheque de papel y un
     eCheq, y decirle "Cheque" a los dos obligaría a buscar cuál es cuál en la tabla. */
  const nombrar = (m: MovimientoPago) => `${m.formaPago} ${m.numeroCheque?.trim() || 's/nro'}`

  /* El VENCIDO se reclama primero y con su propio aviso: es el caso sin arreglo —el banco ya no lo
     paga—, mientras que una fecha de pago pasada por pocos días puede ser un tipeo. Meterlos en un
     solo mensaje obligaría a un texto genérico que no diría cuál de los dos problemas es. */
  const vencidos = movimientos.filter((m) => esChequeDeCobro(m.formaPago) && chequeVencido(m.fechaPagoCheque))
  if (vencidos.length > 0) {
    return {
      titulo: 'Hay un cheque vencido',
      mensaje: `${MSG_CHEQUE_VENCIDO}.`,
      faltantes: vencidos.map(nombrar),
    }
  }

  const fueraDeFecha = movimientos.filter(chequeInvalido)
  if (fueraDeFecha.length > 0) {
    return {
      titulo: 'Hay un cheque con la fecha de pago vencida',
      mensaje: `${MSG_CHEQUE_PAGO_ANTERIOR}.`,
      faltantes: fueraDeFecha.map(nombrar),
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

/* ===== Un movimiento no se carga dos veces ===== */

/**
 * QUÉ identifica a un movimiento de forma única, o `''` cuando ese medio no tiene con qué
 * identificarse. Es la clave contra la que se compara si ya está cargado en la tabla.
 *
 * Cada medio tiene su número, y cada uno con su matiz:
 *
 *   · CHEQUE y ECHEQ · CUIT del emisor + número, por DÍGITOS del CUIT. NO entra el medio: un mismo
 *     papel no puede estar dos veces, se lo haya cargado como cheque o como eCheq —es la misma
 *     chequera y el mismo número—.
 *   · TRANSFERENCIA  · el número de la operación bancaria.
 *   · TARJETAS       · el número de cupón, compartido entre débito y crédito: sale del mismo posnet,
 *     así que dos movimientos con el mismo cupón son el mismo cobro cargado dos veces.
 *   · RETENCIONES    · el impuesto MÁS el número del certificado. El impuesto entra porque cada
 *     organismo numera por su cuenta: un certificado de IVA y uno de IIBB pueden compartir número
 *     sin ser el mismo papel, y tratarlos como uno rechazaría una retención legítima.
 *
 * EFECTIVO y ANTICIPO devuelven `''` a propósito: no tienen número que los distinga, y dos entregas
 * de efectivo en el mismo cobro son dos movimientos válidos.
 */
export function identidadDeMovimiento(m: MovimientoPago | Omit<MovimientoPago, 'id'>): string {
  if (esChequeDeCobro(m.formaPago)) {
    const nro = (m.numeroCheque ?? '').trim().toLowerCase()
    const cuit = digitosCuit(m.cuitEmisor)
    return nro && cuit ? `cheque|${cuit}|${nro}` : ''
  }
  if (m.formaPago === 'Transferencia') {
    const nro = (m.nroComprobanteTransferencia ?? '').trim().toLowerCase()
    return nro ? `transferencia|${nro}` : ''
  }
  if (esPagoConTarjeta(m.formaPago)) {
    const nro = (m.numeroCupon ?? '').trim().toLowerCase()
    return nro ? `tarjeta|${nro}` : ''
  }
  if (esRetencion(m.formaPago)) {
    const nro = (m.nroComprobanteRetencion ?? '').trim().toLowerCase()
    return nro ? `retencion|${tipoDeRetencion(m.formaPago).toLowerCase()}|${nro}` : ''
  }
  return ''
}

/**
 * El movimiento que se quiere agregar YA está en la tabla, o `null` si es nuevo. Devuelve el
 * movimiento REPETIDO —y no un booleano— para que el aviso pueda nombrarlo.
 *
 * Sin identidad no hay repetición posible: un medio sin número propio (efectivo, anticipo) o con su
 * número todavía sin cargar no se compara con nada. Lo que falte por cargar ya lo reclama el
 * formulario por su lado.
 */
export function movimientoRepetido(
  movimientos: readonly MovimientoPago[],
  candidato: MovimientoPago | Omit<MovimientoPago, 'id'>,
): MovimientoPago | null {
  const identidad = identidadDeMovimiento(candidato)
  if (!identidad) return null
  return movimientos.find((m) => identidadDeMovimiento(m) === identidad) ?? null
}

/** Cómo se nombra el número que identifica al movimiento, para poder decir cuál está repetido. */
export function numeroDeMovimiento(m: MovimientoPago | Omit<MovimientoPago, 'id'>): string {
  if (esChequeDeCobro(m.formaPago)) return m.numeroCheque?.trim() ?? ''
  if (m.formaPago === 'Transferencia') return m.nroComprobanteTransferencia?.trim() ?? ''
  if (esPagoConTarjeta(m.formaPago)) return m.numeroCupon?.trim() ?? ''
  if (esRetencion(m.formaPago)) return m.nroComprobanteRetencion?.trim() ?? ''
  return ''
}

/**
 * Qué le falta al anticipo para poder registrarse. Lo que falte se reclama JUNTO: es un solo bloque
 * de la pantalla, así que nombrarlo de a un dato obligaría a intentar avanzar varias veces para
 * enterarse de todo.
 *
 * Es la ÚNICA definición de "el anticipo está completo": la usan el bloqueo del paso y el
 * formulario de carga, así no pueden discrepar sobre cuándo se puede empezar a cargar pagos.
 */
export function faltantesDeAnticipo(
  datos: DatosAnticipo,
  /**
   * ¿El DETALLE y la FECHA DE VENCIMIENTO son obligatorios?
   *
   * Hoy NINGUNO de los dos circuitos los exige (ver `ANTICIPO_COBRO_EXIGE_DETALLE_Y_VENC` y
   * `ANTICIPO_PAGO_EXIGE_DETALLE_Y_VENC`): son datos descriptivos del anticipo y su falta no impide
   * registrarlo ni emitir el documento —las columnas del tablero se omiten cuando vienen vacías—.
   * El ÚNICO dato que se sigue exigiendo es el importe, y por un motivo estructural: de él sale el
   * TOTAL A CANCELAR que las formas de pago tienen que igualar, así que sin él no hay contra qué
   * cargarlas.
   *
   * El parámetro se queda igual, con el default en `true`: que las dos respuestas coincidan hoy no
   * las hace la misma decisión, y son de dos circuitos que pueden volver a separarse.
   */
  exigeDetalleYVencimiento = true,
): string[] {
  return [
    !(datos.importe > 0) && 'Importe del anticipo',
    exigeDetalleYVencimiento && !datos.detalle.trim() && 'Detalle',
    exigeDetalleYVencimiento && !datos.vencimiento.trim() && 'Fecha Vto',
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
  /* Acá el detalle y el vencimiento NO se exigen: son opcionales del cobro (ver
     `ANTICIPO_COBRO_EXIGE_DETALLE_Y_VENC`). Lo único que frena es el importe. */
  const faltantes = faltantesDeAnticipo(datos, ANTICIPO_COBRO_EXIGE_DETALLE_Y_VENC)
  if (faltantes.length > 0) {
    return {
      titulo: 'Falta el importe del anticipo',
      mensaje:
        'Completá arriba el importe del anticipo que entrega el cliente a cuenta: es el total que el recibo va a declarar, y el que las formas de pago tienen que igualar.',
      faltantes,
    }
  }
  return bloqueoCobro(movimientos, resumen, false)
}

/**
 * En el COBRO, ¿el detalle y el vencimiento del anticipo son obligatorios? NO: son opcionales.
 *
 * Vive acá, en una constante, porque la respuesta la necesitan TRES lugares —el bloqueo del avance,
 * la apertura del formulario de cobros y el asterisco de los campos— y separarse en cualquiera de
 * ellos dejaría la pantalla pidiendo algo que la validación ya no exige, o al revés.
 */
export const ANTICIPO_COBRO_EXIGE_DETALLE_Y_VENC = false

/** Los datos que declaran un anticipo. Cuál de ellos frena el recorrido depende del módulo. */
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
