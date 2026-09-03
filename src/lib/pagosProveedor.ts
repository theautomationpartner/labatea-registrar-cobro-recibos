/**
 * Reglas del módulo de PAGOS: con quién se puede operar, qué cajas se ofrecen, qué datos exige cada
 * una y cuándo lo pagado cierra contra lo que hay que pagar. Puras —sin React, sin estado, sin
 * red—, así el formulario, la tabla, la cabecera y el bloqueo del avance responden todos al mismo
 * criterio.
 *
 * Es el espejo de `lib/cobros` + `lib/pagos`, que resuelven lo mismo del lado de la cobranza. Lo que
 * NO se repite acá es lo que ya es idéntico: la imputación a facturas se valida con las MISMAS
 * funciones del cobro (`bloqueoDeImputacion`, `impactoImputacion`), porque "cuánto de este
 * comprobante se cancela" es exactamente la misma pregunta se cobre o se pague.
 */
import { desdeIso, diasHasta } from '@/lib/dates'
import { money, round2 } from '@/lib/format'
import {
  chequeVencido,
  faltantesDeAnticipo,
  fechaPagoChequeInvalida,
  vencimientoDeCheque,
  type DatosAnticipo,
} from '@/lib/pagos'
import { esProveedor } from '@/lib/personas'
import type { ComprobanteCancelado, PagoRecibido, Recibo } from '@/lib/recibo'
import type { CajaPago, FacturaCompraPendiente, MovimientoCaja, Proveedor } from '@/types'

/* ===== Con quién se puede operar ===== */

/** La condición de pago que habilita cancelar una factura de compra pendiente. */
export const COND_PAGO_CTA_CTE = 'CUENTA CORRIENTE'

/**
 * Mensaje EXACTO del bloqueo cuando el proveedor opera en cuenta corriente pero el sistema no le
 * tiene ninguna asignada. Es una constante y no un literal suelto porque lo dicen dos lugares —el
 * renglón del pie del paso y la ventana que se abre al intentar avanzar—, y son el mismo problema.
 */
export const MSG_SIN_CTA_CTE =
  'El Proveedor no tiene una cuenta corriente de proveedor asignada en el sistema'

/**
 * El proveedor opera en CUENTA CORRIENTE. Es lo que se lee de "✋️Cond Pago Habilitadas"
 * (dropdown_mm54yq06) del board de Personas, comparado sin distinguir mayúsculas ni espacios: la
 * etiqueta del tablero es texto cargado a mano y un espacio de más no debería cambiar el veredicto.
 */
export const operaEnCuentaCorriente = (proveedor: Proveedor | null): boolean =>
  (proveedor?.condicionPago ?? '').trim().toUpperCase() === COND_PAGO_CTA_CTE

/**
 * Por qué NO se puede seleccionar a esta persona, o `null` si se puede.
 *
 * Se resuelve en el momento de ELEGIRLA, no al intentar avanzar: quien no sirve para esta operación
 * no llega siquiera a mostrarse en la ficha. Mostrarle al usuario los datos de alguien con quien no
 * va a poder operar —y recién avisárselo dos clicks después— es hacerle leer una pantalla entera
 * para nada.
 *
 * El orden importa: primero QUIÉN es y después CÓMO opera. A un cliente no tiene sentido
 * reclamarle su condición de pago, porque el problema no es esa columna.
 *
 * Quién es lo decide `esProveedor` (`lib/personas`), que es la MISMA función —vista desde el otro
 * lado— con la que Cobros y Pases exigen un cliente.
 */
export type RechazoProveedor = 'no-es-proveedor' | 'condicion-de-pago' | null

export function rechazoAlSeleccionar(persona: Proveedor): RechazoProveedor {
  if (!esProveedor(persona)) return 'no-es-proveedor'
  if (!operaEnCuentaCorriente(persona)) return 'condicion-de-pago'
  return null
}

/**
 * El proveedor opera en cuenta corriente pero NO tiene una asignada en el sistema: la operación se
 * frena acá, antes de hacerle elegir facturas que no va a poder imputar.
 *
 * La validación sólo corre sobre los de cuenta corriente: al que opera al contado ni siquiera se le
 * pregunta, porque de entrada no puede cancelar una factura pendiente (ver `MSG_SOLO_CTA_CTE`).
 */
export const proveedorSinCtaCte = (proveedor: Proveedor | null): boolean =>
  operaEnCuentaCorriente(proveedor) && !proveedor?.tieneCtaCte

/**
 * RESTRICCIÓN DE NEGOCIO: para habilitar la cancelación de una factura de compra pendiente de pago
 * sólo se consideran válidos los proveedores cuya condición de pago sea explícitamente "CUENTA
 * CORRIENTE". Cualquier otra —contado, proveed 45/90 días— queda afuera del circuito.
 */
export const MSG_SOLO_CTA_CTE =
  'Sólo se pueden cancelar facturas de compra de proveedores cuya condición de pago sea CUENTA CORRIENTE.'

/* ===== Cajas ===== */

/**
 * Cajas con las que se paga, en el orden en que aparecen en el selector "Seleccionar Caja". Son las
 * del tablero de cajas, con su rótulo tal cual: cualquier divergencia de texto rompería la
 * imputación del movimiento.
 */
export const CAJAS_PAGO: readonly CajaPago[] = [
  'Cheque',
  'Transferencia',
  'Efectivo',
  /* La retención no es dinero que sale: es impuesto que se le retiene al proveedor. Su importe NO
     lo escribe el usuario —se calcula solo al elegirla— y cancela deuda igual que las demás. */
  'Retencion GAN',
  /* Último, y sólo se OFRECE cuando hay excedente (ver `ofreceAnticipo` en el formulario): no es
     una forma de pagar, es la salida para lo que se entregó de más. */
  'Anticipo',
]

/**
 * La caja es la RETENCIÓN de Ganancias. Pide un tratamiento propio en el formulario: su importe se
 * calcula solo y no se puede tipear.
 */
export const esRetencionGAN = (caja: CajaPago | string | null | undefined): boolean =>
  caja === 'Retencion GAN'

/**
 * La caja es un ANTICIPO: el sobrante que queda a favor nuestro cuando lo entregado supera lo que
 * se está cancelando.
 *
 * Es el espejo exacto de `esAnticipoDeCobro`: se carga como una caja más del formulario, pero
 * cuenta al revés que las otras —suma del lado de lo CANCELADO (ver `resumenPago`)—, que es lo que
 * lleva la diferencia a cero.
 */
export const esAnticipoDePago = (caja: CajaPago | string | null | undefined): boolean =>
  caja === 'Anticipo'

/** La caja elegida es la del cheque: es la única con un segundo nivel de decisión (ver `ModalidadCheque`). */
export const esCajaCheque = (caja: CajaPago | string | null | undefined): boolean =>
  caja === 'Cheque'

/** La caja elegida es una transferencia: pide, además del importe, el banco de ORIGEN. */
export const esCajaTransferencia = (caja: CajaPago | string | null | undefined): boolean =>
  caja === 'Transferencia'

/**
 * Las dos modalidades del cheque, con el rótulo que ve el usuario. El selector arranca VACÍO: no hay
 * una más probable que la otra, así que preseleccionar una sería decidir por el usuario.
 */
export const MODALIDADES_CHEQUE = [
  { valor: 'cartera', rotulo: 'En Cartera' },
  { valor: 'nuevo', rotulo: 'Nuevo' },
] as const

/**
 * A cuántos días de su vencimiento un cheque se considera PRÓXIMO a vencer. Los que caen dentro de
 * esa ventana —y los que ya vencieron— se muestran en rojo en la cartera, para que se vean antes de
 * elegir con cuál pagar.
 *
 * El número es una CONVENCIÓN de la pantalla, no una regla del tablero: quince días es media
 * quincena de gestión, que es lo que da margen para reemplazarlo si hace falta. Vive acá, con
 * nombre, para poder cambiarlo en un solo lugar el día que el negocio fije otro plazo.
 */
export const DIAS_VENC_PROXIMO = 15

/**
 * El cheque vence pronto (o ya venció). Sin fecha cargada devuelve `false`: no se puede afirmar que
 * algo esté por vencer cuando no se sabe cuándo vence, y pintarlo de rojo sería alarmar por un dato
 * que falta —eso se ve en la propia columna, que muestra "—"—.
 */
export const vencimientoProximo = (vencimientoIso: string): boolean => {
  const dias = diasHasta(vencimientoIso)
  return dias !== null && dias <= DIAS_VENC_PROXIMO
}

/* ===== Resumen del pago ===== */

export interface ResumenPago {
  /** Lo que suman las facturas imputadas en la etapa 2: es lo que hay que cubrir. */
  totalAPagar: number
  /** Lo que se lleva cargado, sumando todas las cajas. */
  totalPagado: number
  /** Lo que falta pagar (>0) o lo que se pagó de más (<0). */
  diferencia: number
}

/**
 * Los tres números de la cabecera. Todo se redondea a dos decimales, que es la precisión con la que
 * se escriben los importes: es la MISMA métrica contra la que se decide si se puede confirmar.
 */
export function resumenPago(
  movimientos: readonly MovimientoCaja[],
  totalAPagar: number,
): ResumenPago {
  const importe = (m: MovimientoCaja) => (Number.isFinite(m.importe) ? m.importe : 0)
  /* Los ANTICIPOS no son plata que salió: son el sobrante que queda a favor nuestro con el
     proveedor. Por eso suman a lo CANCELADO y no a lo entregado —el dinero ya está contado en el
     cheque que lo produjo, y contarlo dos veces duplicaría el pago—. Cargar uno por la diferencia
     es, exactamente, lo que la lleva a cero. Es la misma cuenta que hace `resumenCobro`. */
  const anticipos = round2(
    movimientos.filter((m) => esAnticipoDePago(m.formaPago)).reduce((acc, m) => acc + importe(m), 0),
  )
  const totalPagado = round2(
    movimientos
      .filter((m) => !esAnticipoDePago(m.formaPago))
      .reduce((acc, m) => acc + importe(m), 0),
  )
  const total = round2(round2(totalAPagar) + anticipos)
  return { totalAPagar: total, totalPagado, diferencia: round2(total - totalPagado) }
}

/**
 * La diferencia llegó a CERO EXACTO. Es la única condición que habilita confirmar el pago.
 *
 * Acá NO rige la tolerancia de centavos del cobro (`TOLERANCIA_DIFERENCIA`), y es a propósito: el
 * requerimiento del módulo la fija en `0` exacto —"la operación sólo se considera completada cuando
 * el TOTAL DIFERENCIA alcance exactamente el valor 0"—. Un pago se arma eligiendo cuánto se imputa
 * a cada factura, así que siempre se puede hacer cerrar al centavo; en una cobranza no, porque lo
 * que entra es el importe que trae el cliente.
 */
export const diferenciaSaldadaPago = (resumen: ResumenPago): boolean => resumen.diferencia === 0

/**
 * El pago ya está CUBIERTO: salió dinero y lo pagado iguala lo que hay que pagar.
 *
 * NO cierra el formulario, a diferencia de su equivalente en el cobro. Acá queda una caja más que
 * tiene sentido cargar con el total ya cubierto: la RETENCIÓN, que no suma dinero sino que se
 * descuenta de lo que se iba a entregar (ver `descontarRetencion`). Cerrar el formulario obligaba a
 * deshacer lo cargado para poder retener, que es exactamente al revés del orden natural —primero se
 * arma el pago y al final se retiene—.
 *
 * Lo que sí hace es AVISAR que el pago cierra, para que quien no necesite retener sepa que terminó.
 */
export const pagoCubierto = (resumen: ResumenPago): boolean =>
  resumen.totalPagado > 0 && diferenciaSaldadaPago(resumen)

/** Lo que se dice cuando el pago ya cierra. Es una confirmación, no un bloqueo: se puede seguir. */
export const MSG_PAGO_CUBIERTO =
  'El total pagado ya cubre el total a pagar. Podés confirmar, o agregar una retención: su importe se descuenta de las cajas ya registradas.'

/* ===== Reparto de la retención sobre lo ya cargado ===== */

/**
 * Lo que se dice cuando el reparto no entra. Es la única forma en que agregar una retención puede
 * fallar por culpa de lo que ya está cargado.
 */
export const MSG_REPARTO_IMPOSIBLE =
  'El importe de la retención no entra en las cajas ya registradas: repartido entre ellas, alguna quedaría sin importe. Ajustá o quitá alguna caja antes de agregarla.'

/**
 * Las cajas ya registradas, con la RETENCIÓN descontada de cada una. `null` si el reparto no entra.
 *
 * Una retención no es dinero nuevo que sale: es plata que se le retiene al proveedor y que, en vez
 * de entregársela, se ingresa al fisco. Por eso NO se suma a lo ya cargado —eso pagaría de más—,
 * sino que se DESCUENTA de lo que se iba a entregar. Así el total pagado no se mueve y la operación
 * sigue cerrando en cero exacto.
 *
 * El reparto es en partes IGUALES entre las cajas que ya estaban, no proporcional a sus importes:
 * es lo que pide el circuito. Los centavos del redondeo se cargan a la ÚLTIMA para que la suma de
 * las cuotas dé exactamente el monto retenido —con un pago que sólo cierra en cero absoluto, un
 * centavo perdido en la división lo dejaría sin poder confirmarse—.
 *
 * Devuelve `null` cuando alguna caja quedaría en cero o en negativo. Recortar en cero no es opción:
 * dejaría la retención declarada por un importe que las cajas no alcanzan a cubrir, y el pago
 * cerraría en pantalla con plata que no salió de ningún lado.
 *
 * Sin cajas previas no hay nada que repartir y la lista vuelve igual: es el recorrido de quien carga
 * la retención PRIMERO y el resto después.
 */
export function descontarRetencion(
  movimientos: readonly MovimientoCaja[],
  monto: number,
): MovimientoCaja[] | null {
  /* Sólo se le descuenta a las cajas que entregan dinero. Una retención anterior no puede absorber
     a otra: no hay plata ahí de la cual descontar. */
  const alcanzados = movimientos.filter((m) => !esRetencionGAN(m.formaPago))
  if (alcanzados.length === 0) return [...movimientos]

  const cuota = round2(monto / alcanzados.length)
  /* La última carga el resto de la división, así las cuotas suman EXACTAMENTE el monto retenido. */
  const ultimoIdx = alcanzados.length - 1
  const cuotaDe = (i: number) =>
    i === ultimoIdx ? round2(monto - cuota * ultimoIdx) : cuota

  const nuevos = new Map<string, number>()
  for (let i = 0; i < alcanzados.length; i++) {
    const restante = round2(alcanzados[i].importe - cuotaDe(i))
    // Una caja sin importe no declara nada: el paso la rechazaría igual (ver `bloqueoPago`).
    if (restante <= 0) return null
    nuevos.set(alcanzados[i].id, restante)
  }

  return movimientos.map((m) =>
    nuevos.has(m.id) ? { ...m, importe: nuevos.get(m.id) as number } : m,
  )
}

/**
 * Motivo por el que el pago todavía no cierra, o `null` cuando está listo. Misma forma que
 * `BloqueoCobro` y `BloqueoImputacion`, para que las tres etapas avisen igual: la ventana de aviso
 * y el pie del paso lo consumen sin adaptaciones.
 */
export interface BloqueoPago {
  titulo: string
  mensaje: string
  /** Movimientos concretos que hay que corregir. Vacío cuando el problema no es de un movimiento. */
  faltantes: string[]
}

/**
 * Qué impide confirmar el pago. Las reglas se evalúan en orden de gravedad: primero que haya algo
 * cargado, después que cada caja esté completa y por último que los números cierren en cero exacto.
 *
 * Las validaciones de cada caja se vuelven a mirar acá aunque el formulario ya las imponga al
 * agregar: el importe de un movimiento se puede editar en la tabla, y esta función es la que decide
 * el avance. Que la regla viva en un solo lugar es lo que evita que las dos se separen.
 */
export function bloqueoPago(
  movimientos: readonly MovimientoCaja[],
  resumen: ResumenPago,
  /**
   * El recorrido ofrece la caja "Anticipo" para absorber lo que se entregó de más. Hoy la ofrece el
   * único recorrido que hay; el parámetro existe para que el MENSAJE no nombre una salida que la
   * pantalla no tenga (mismo criterio que `bloqueoCobro`).
   */
  ofreceAnticipo = true,
): BloqueoPago | null {
  if (movimientos.length === 0) {
    return {
      titulo: 'No registraste ninguna caja',
      mensaje:
        'Para confirmar tenés que cargar al menos un movimiento de pago que cubra el total a pagar.',
      faltantes: [],
    }
  }

  /* Vale para TODAS las cajas, el anticipo incluido: una línea en cero no declara nada. */
  const sinImporte = movimientos.filter((m) => !(m.importe > 0))
  if (sinImporte.length > 0) {
    return {
      titulo: 'Falta el importe de una caja',
      mensaje:
        'Todas las cajas registradas tienen que tener un importe mayor a $ 0. Completalo o quitá la caja.',
      faltantes: sinImporte.map((m) => m.formaPago),
    }
  }

  /* La transferencia sin banco de origen no se puede imputar: el dinero tiene que salir de una
     cuenta concreta, y sin ella el movimiento no dice de dónde salió. */
  const sinBanco = movimientos.filter((m) => esCajaTransferencia(m.formaPago) && !m.bancoOrigenId)
  if (sinBanco.length > 0) {
    return {
      titulo: 'Falta el banco de origen',
      mensaje:
        'Toda transferencia tiene que indicar desde qué banco se realiza. Completalo o quitá el movimiento.',
      faltantes: sinBanco.map((m) => `Transferencia · ${money(m.importe)}`),
    }
  }

  const chequesIncompletos = movimientos.filter(
    (m) => esCajaCheque(m.formaPago) && !chequeCompleto(m),
  )
  if (chequesIncompletos.length > 0) {
    return {
      titulo: 'Hay un cheque incompleto',
      mensaje:
        'Cada cheque tiene que estar identificado: elegido de la cartera, o cargado con su número, sus fechas y su banco emisor.',
      faltantes: chequesIncompletos.map((m) => `Cheque ${m.numeroCheque?.trim() || 's/nro'}`),
    }
  }

  /* Pagar de menos deja facturas sin cancelar y pagar de más no corresponde a esta operación: en
     los dos casos se frena. Acá el corte es en CERO EXACTO (ver `diferenciaSaldadaPago`). */
  if (!diferenciaSaldadaPago(resumen)) {
    const falta = resumen.diferencia
    return falta > 0
      ? {
          titulo: 'El total pagado no cubre el total a pagar',
          mensaje: `Todavía faltan ${money(falta)} para cerrar el pago: cargá o ajustá las cajas hasta que el TOTAL PAGADO iguale exactamente el TOTAL A PAGAR.`,
          faltantes: [],
        }
      : {
          titulo: 'El total pagado supera el total a pagar',
          mensaje: MSG_EXCESO_PAGO(-falta, ofreceAnticipo),
          faltantes: [],
        }
  }

  return null
}

/**
 * Lo que se dice cuando lo pagado SE PASA del total. Es UN solo texto para los dos lugares donde
 * aparece —el renglón de avisos del paso y la ventana que se abre al confirmar—: son el mismo
 * problema, así que decirlo distinto en cada uno haría dudar de si son dos.
 */
export const MSG_EXCESO_PAGO = (exceso: number, ofreceAnticipo = true): string =>
  `El total pagado supera el total a pagar en ${money(exceso)}: ${
    ofreceAnticipo
      ? 'ajustá los importes o registrá un anticipo por esa diferencia'
      : 'ajustá los importes para que la diferencia sea exactamente $ 0,00'
  }`

/**
 * Un movimiento de cheque está identificado: o se eligió uno de la cartera, o se cargaron a mano
 * los datos con los que se libra un cheque propio.
 *
 * Es la ÚNICA definición de "el cheque está completo": la usan el alta del formulario y el bloqueo
 * del paso, así no pueden discrepar.
 */
export function chequeCompleto(
  m: Pick<
    MovimientoCaja,
    | 'modalidadCheque'
    | 'chequeId'
    | 'numeroCheque'
    | 'chequeVencimiento'
    | 'fechaEmisionCheque'
    | 'bancoEmisor'
    | 'fechaPagoCheque'
  >,
): boolean {
  /* Sin modalidad elegida no hay cheque que validar: todavía no se dijo de dónde sale. */
  if (!m.modalidadCheque) return false
  if (m.modalidadCheque === 'cartera') return !!m.chequeId
  return (
    !!m.numeroCheque?.trim() &&
    !!m.fechaEmisionCheque?.trim() &&
    !!m.bancoEmisor?.trim() &&
    /* Las DOS reglas de fecha, las mismas que el cheque de un cobro: la de pago no puede haber
       quedado atrás, y el vencimiento que sale de ella tampoco. Un cheque que se libra hoy con
       fecha de pago pasada es un cheque que no se va a poder depositar. */
    !fechaPagoChequeInvalida(m.fechaPagoCheque) &&
    !chequeVencido(m.fechaPagoCheque)
  )
}

/**
 * En el PAGO, ¿el detalle y el vencimiento del anticipo son obligatorios? NO: son opcionales.
 *
 * Describen la entrega pero no la definen. El único dato que frena es el IMPORTE, y por un motivo
 * estructural: de él sale el TOTAL A PAGAR que las cajas tienen que igualar, así que sin él no hay
 * contra qué cargarlas. Los otros dos tienen columna propia en el tablero y se omiten cuando vienen
 * vacías (ver `columnasAnticipoPago`), así que su falta no rompe nada río abajo.
 *
 * Es el espejo de `ANTICIPO_COBRO_EXIGE_DETALLE_Y_VENC`, y vive en una constante por el mismo
 * motivo: la respuesta la necesitan TRES lugares —el bloqueo del avance, la apertura del formulario
 * de cajas y el asterisco de los campos— y separarse en cualquiera de ellos dejaría la pantalla
 * pidiendo algo que la validación ya no exige, o al revés.
 */
export const ANTICIPO_PAGO_EXIGE_DETALLE_Y_VENC = false

/**
 * Qué IDENTIFICA a una caja ya cargada, para poder decir que la misma se está cargando dos veces.
 * Cadena vacía = no tiene identidad y no se compara con nada.
 *
 * Es el espejo de `identidadDeMovimiento` del cobro, con los matices de este circuito:
 *
 *   · CHEQUE · el número, más el CUIT del emisor cuando lo hay. El de CARTERA lo trae del tablero;
 *     el NUEVO lo libramos nosotros, así que su emisor es siempre el mismo y el número alcanza para
 *     distinguirlo —es una sola chequera—. NO entra el formato: un mismo papel no puede estar dos
 *     veces, se lo haya cargado como cheque o como eCheq.
 *   · TRANSFERENCIA · el número de la operación bancaria.
 *   · RETENCIÓN · no lleva número propio: el suyo lo asigna el tablero al emitir, y para una misma
 *     orden sería el mismo. Su identidad es la caja a secas, o sea que una orden practica UNA
 *     retención: dos serían dos veces el mismo impuesto sobre las mismas facturas.
 *
 * EFECTIVO y ANTICIPO devuelven `''` a propósito: no tienen número que los distinga, y dos entregas
 * de efectivo en el mismo pago son dos movimientos válidos.
 */
export function identidadDeCaja(m: Pick<MovimientoCaja, 'formaPago' | 'numeroCheque' | 'cuitEmisor' | 'nroComprobanteTransferencia'>): string {
  if (esCajaCheque(m.formaPago)) {
    const nro = (m.numeroCheque ?? '').trim().toLowerCase()
    if (!nro) return ''
    const cuit = (m.cuitEmisor ?? '').replace(/\D/g, '')
    /* Sin CUIT el cheque es NUESTRO: lo libramos contra una cuenta propia, así que el número no se
       repite salvo que sea el mismo papel. */
    return `cheque|${cuit || 'propio'}|${nro}`
  }
  if (esCajaTransferencia(m.formaPago)) {
    const nro = (m.nroComprobanteTransferencia ?? '').trim().toLowerCase()
    return nro ? `transferencia|${nro}` : ''
  }
  if (esRetencionGAN(m.formaPago)) return 'retencion'
  return ''
}

/**
 * La caja que se quiere agregar YA está en la tabla, o `null` si es nueva. Devuelve el movimiento
 * REPETIDO —y no un booleano— para que el aviso pueda nombrarlo.
 */
export function cajaRepetida(
  movimientos: readonly MovimientoCaja[],
  candidato: MovimientoCaja | Omit<MovimientoCaja, 'id'>,
): MovimientoCaja | null {
  const identidad = identidadDeCaja(candidato)
  if (!identidad) return null
  return movimientos.find((m) => identidadDeCaja(m) === identidad) ?? null
}

/** El número con el que se nombra la caja repetida en el aviso. */
export function numeroDeCaja(m: Pick<MovimientoCaja, 'formaPago' | 'numeroCheque' | 'nroComprobanteTransferencia'>): string {
  if (esCajaCheque(m.formaPago)) return m.numeroCheque?.trim() ?? ''
  if (esCajaTransferencia(m.formaPago)) return m.nroComprobanteTransferencia?.trim() ?? ''
  return ''
}

/**
 * El VENCIMIENTO de un movimiento de cheque, venga de donde venga.
 *
 * Son dos orígenes y una sola respuesta:
 *
 *   · el cheque NUEVO lo declara con su FECHA DE PAGO, y el vencimiento se deriva sumándole 30
 *     días —el plazo para presentarlo al cobro—, así que no puede quedar en desacuerdo con ella ni
 *     depender de que alguien lo calcule a mano;
 *   · el de CARTERA ya existe en el tablero con su propio vencimiento cargado, y ése es el que vale.
 *
 * Se define UNA vez y la usan el formulario, la fila de la tabla y el subelemento que se escribe:
 * si cada uno lo resolviera por su cuenta, la pantalla podría mostrar una fecha y el tablero recibir
 * otra.
 */
export const vencimientoDeCajaCheque = (
  m: Pick<MovimientoCaja, 'fechaPagoCheque' | 'chequeVencimiento'>,
): string =>
  m.fechaPagoCheque?.trim()
    ? vencimientoDeCheque(m.fechaPagoCheque)
    : (m.chequeVencimiento?.trim() ?? '')

/**
 * Qué impide registrar un ANTICIPO al proveedor. Es el mismo bloqueo del pago con UNA regla antes:
 * sin importe declarado no hay nada que cancelar, así que ni siquiera tiene sentido mirar las cajas.
 *
 * A partir de ahí las reglas son idénticas —las cajas y la diferencia en cero se validan igual—,
 * porque lo que cambia entre los dos recorridos es de dónde sale el TOTAL A PAGAR (la imputación a
 * facturas o este importe), no cómo se controla que lo entregado lo iguale.
 */
export function bloqueoAnticipoPago(
  datos: DatosAnticipo,
  movimientos: readonly MovimientoCaja[],
  resumen: ResumenPago,
): BloqueoPago | null {
  /* Acá el detalle y el vencimiento NO se exigen: son opcionales del pago (ver
     `ANTICIPO_PAGO_EXIGE_DETALLE_Y_VENC`). Lo único que frena es el importe. */
  const faltantes = faltantesDeAnticipo(datos, ANTICIPO_PAGO_EXIGE_DETALLE_Y_VENC)
  if (faltantes.length > 0) {
    return {
      titulo: 'Falta el importe del anticipo',
      mensaje:
        'Cargá arriba el importe que se le entrega al proveedor a cuenta: es el total que la orden va a declarar y el que las cajas tienen que igualar. El detalle y la fecha de vencimiento son opcionales.',
      faltantes,
    }
  }
  /* Sin la salida del anticipo: en este recorrido TODO ya es un anticipo, así que ofrecer registrar
     otro por el excedente mandaría a buscar un control que el selector no tiene. */
  return bloqueoPago(movimientos, resumen, false)
}

/* ===== El documento: la ORDEN DE PAGO ===== */

/**
 * Cómo se nombra la línea del anticipo en la tabla de lo cancelado. No es un número de comprobante
 * —el saldo a favor no tiene uno— sino el concepto, que es lo que corresponde leer en esa columna.
 * Es el mismo criterio, y el mismo texto, que `NOMBRE_ANTICIPO` en el recibo.
 */
export const NOMBRE_ANTICIPO_PAGO = 'Anticipo'

/**
 * La orden de pago que se emite por esta operación: qué facturas de compra cancela y con qué cajas
 * se las paga.
 *
 * Devuelve la MISMA forma que `armarRecibo` (`Recibo`, de `lib/recibo`) y es a propósito: las dos
 * cards del paso 4 —el resumen y el documento— consumen esa forma, así que hablar su idioma es lo
 * que permite reusarlas tal cual en vez de escribir otras. La orden no calcula nada nuevo: traduce
 * lo que ya decidieron las etapas 2 y 3.
 *
 * Las facturas se recorren en el orden en que se muestran —no en el que se fueron marcando—, con el
 * mismo criterio que el recibo: así el documento sale siempre igual para la misma operación.
 */
export function armarOrdenDePago(
  facturas: readonly FacturaCompraPendiente[],
  imputaciones: Record<string, number>,
  movimientos: readonly MovimientoCaja[],
  /**
   * Sólo APLICACIÓN: las líneas de lo entregado ya resueltas a partir de los anticipos imputados.
   * Cuando viene, REEMPLAZA a las de las cajas —que en ese recorrido no existen—, y con ellas el
   * TOTAL ENTREGADO pasa a ser lo aplicado. Es el mismo parámetro que `armarRecibo`.
   */
  pagosAplicados?: readonly PagoRecibido[],
): Recibo {
  /* Los ANTICIPOS cargados como caja son el sobrante que queda a favor nuestro: no son plata que
     salió, sino algo MÁS que esta orden cancela. Por eso figuran entre los comprobantes cancelados
     —a continuación de las facturas— y no entre las cajas entregadas: es lo que hace que el total
     cancelado iguale a lo entregado en lugar de quedar corto. Igual que en `armarRecibo`. */
  const anticipos = movimientos.filter((m) => esAnticipoDePago(m.formaPago))
  const entregadas = movimientos.filter((m) => !esAnticipoDePago(m.formaPago))

  const comprobantes: ComprobanteCancelado[] = [
    ...facturas
      .filter((f) => f.id in imputaciones)
      .map((f) => ({
        id: f.id,
        nro: f.nro,
        /* La factura de compra no tiene fecha de emisión en su tablero de pendientes: la columna
           queda vacía y la tabla la muestra con su marca de "sin dato", igual que una venta sin
           fecha cargada. */
        emision: '',
        vencimiento: desdeIso(f.vencimiento),
        cancelado: round2(imputaciones[f.id]),
      })),
    /* El anticipo no tiene número de comprobante ni fechas: todavía no es un documento, es saldo a
       favor. Las columnas quedan vacías y la tabla las muestra con su marca de "sin dato". */
    ...anticipos.map((m) => ({
      id: m.id,
      nro: NOMBRE_ANTICIPO_PAGO,
      emision: '',
      vencimiento: '',
      cancelado: round2(m.importe),
      esAnticipo: true,
    })),
  ]

  const pagos: PagoRecibido[] = pagosAplicados
    ? [...pagosAplicados]
    : entregadas.map((m) => ({
        id: m.id,
        /* Sólo el NOMBRE de la caja. El banco del cheque o la cuenta de origen de la transferencia
           ya se cargaron en la etapa 3 y viajan a sus columnas del subelemento: repetirlos acá
           alargaría la fila sin agregar nada al documento. */
        descripcion: m.formaPago,
        /* El número del cheque es lo único que identifica una caja en este circuito: ni el efectivo
           ni la transferencia ni las tarjetas traen un comprobante propio (ver `comprobanteDePago`,
           que resuelve lo mismo del lado del recibo). */
        comprobante: esCajaCheque(m.formaPago) ? (m.numeroCheque?.trim() ?? '') : '',
        entregado: round2(m.importe),
      }))

  return {
    comprobantes,
    pagos,
    /* Los dos totales se calculan por separado, cada uno sobre su tabla, y NO se copian el uno del
       otro: que coincidan es justamente lo que la etapa 3 exige para llegar hasta acá (diferencia
       en cero exacto), y el documento tiene que poder mostrarlo. */
    totalCancelado: round2(comprobantes.reduce((acc, c) => acc + c.cancelado, 0)),
    totalEntregado: round2(pagos.reduce((acc, p) => acc + p.entregado, 0)),
  }
}

/* ===== Retención del impuesto a las GANANCIAS ===== */

/**
 * Monto retenido MÍNIMO para que la retención se practique. Por debajo de este importe no se retiene
 * y la caja no se puede agregar al pago.
 *
 * Los $ 240 son el mínimo no retenible para proveedores RESPONSABLES INSCRIPTOS. Otras condiciones
 * frente al IVA tienen su propio mínimo; el día que haga falta distinguirlas, este número deja de
 * ser una constante y pasa a depender de la condición fiscal del proveedor.
 */
export const RETENCION_GAN_MINIMO = 240

/**
 * Por qué no se puede agregar una retención que no llega al mínimo. Es el texto LARGO, con su
 * porqué; debajo de un campo no entra, y para eso está el corto de abajo.
 */
export const MSG_RETENCION_MINIMO = `El monto retenido queda por debajo del mínimo no retenible de ${money(RETENCION_GAN_MINIMO)} para proveedores responsables inscriptos, así que no corresponde practicar la retención.`

/**
 * La misma regla, dicha en el ancho de un campo. Debajo de un input hay lugar para un renglón, no
 * para la explicación entera: ahí se dice QUÉ pasa, y el porqué queda para el texto largo. Mismo
 * criterio que `MSG_CHEQUE_VENC_CORTO` en el formulario de cobros.
 */
export const MSG_RETENCION_MINIMO_CORTO = `No llega al mínimo de ${money(RETENCION_GAN_MINIMO)}`

/** Los parámetros del cálculo, tal como salen del tablero de configuración. */
export interface ParametrosGanancias {
  /** Tramo que NO tributa. Se descuenta UNA vez por proveedor y por mes. */
  baseNoImponible: number | null
  /** Porcentaje que se aplica a la base imponible (35 = 35 %). */
  alicuota: number | null
}

/** Por qué NO se pudo calcular la retención. Cada motivo se explica distinto y se arregla en otro lado. */
export type MotivoSinRetencion =
  /** A alguna factura elegida le falta su importe neto: sin él no hay base que prorratear. */
  | 'sin-importe-neto'
  /**
   * El total de la factura pendiente NO coincide con el de la factura de compra que tiene
   * vinculada. Son el mismo importe visto desde dos tableros: si difieren, uno de los dos está mal
   * cargado y el prorrateo de la retención saldría sobre una proporción falsa.
   */
  | 'total-no-coincide'
  /** La base NO imponible del tablero está vacía o es negativa. */
  | 'base-no-imponible-invalida'
  /** La alícuota del tablero está vacía o no es mayor a cero. */
  | 'alicuota-invalida'
  /** No hay facturas elegidas: no hay nada sobre lo que retener. */
  | 'sin-facturas'

/** El resultado del cálculo: el monto y de dónde salió, o el motivo por el que no se pudo. */
export type ResultadoRetencion =
  | {
      /**
       * El cálculo SALIÓ. `ok` no significa "se puede practicar": significa que los datos alcanzaron
       * para llegar a un número. Si ese número no llega al mínimo, el resultado sigue siendo válido
       * —y hay que MOSTRARLO— pero la retención no se puede agregar (ver `alcanzaElMinimo`).
       *
       * Se modeló así, y no como un fallo más, porque un monto por debajo del mínimo no es un dato
       * roto: es el resultado correcto de la fórmula. Tratarlo como error obligaba a esconder el
       * número, y el campo terminaba mostrando cualquier otra cosa en su lugar.
       */
      ok: true
      /** Lo que da la fórmula. Se muestra SIEMPRE, llegue o no al mínimo. */
      monto: number
      /** Base sobre la que se aplicó la alícuota, ya neta de la base no imponible si correspondía. */
      baseImponible: number
      alicuota: number
      /** Cuánto se descontó por base no imponible. 0 = no correspondía (ya se usó este mes). */
      baseNoImponibleAplicada: number
      /** El monto llega al mínimo no retenible, así que la retención se puede practicar. */
      alcanzaElMinimo: boolean
    }
  | {
      ok: false
      motivo: MotivoSinRetencion
      /** El dato concreto que hay que mirar para arreglarlo: un valor leído o un comprobante. */
      detalle: string
      /**
       * QUÉ falta, uno por renglón, para listarlo en la ventana. Cada entrada nombra el comprobante
       * Y el dato que le falta: con tres facturas incompletas hay que poder arreglar las tres sin
       * volver a intentar tres veces.
       *
       * Vacío cuando el problema no es de un comprobante sino de la configuración.
       */
      faltantes: string[]
    }

/**
 * El fallo es de DATOS que faltan en un tablero, y no de la operación en curso.
 *
 * Los tres primeros motivos no se arreglan desde esta pantalla —hay que ir a Monday—, así que se
 * avisan con una ventana apenas se detectan. Los otros dos («no hay facturas», «no llega al
 * mínimo») describen el estado de lo que el usuario está armando y se dicen en línea, sin
 * interrumpirlo.
 */
export const esFaltaDeDatos = (r: ResultadoRetencion): boolean =>
  !r.ok &&
  (r.motivo === 'sin-importe-neto' ||
    r.motivo === 'total-no-coincide' ||
    r.motivo === 'base-no-imponible-invalida' ||
    r.motivo === 'alicuota-invalida')

/**
 * Cuánto se le retiene de Ganancias al proveedor por este pago.
 *
 * El cálculo tiene tres tramos, y este orden lo fija la norma y no una conveniencia:
 *
 *   1. BASE IMPONIBLE de cada factura elegida, prorrateada por lo que se le está cancelando:
 *
 *          (importe a pagar de la factura / total de la factura) x importe neto de la factura
 *
 *      Se prorratea porque un pago parcial retiene sobre la parte que paga, no sobre la factura
 *      entera. Con varias facturas, cada una aporta la suya y se SUMAN.
 *
 *   2. BASE NO IMPONIBLE, restada UNA sola vez al total —no a cada factura—: es un tramo mensual por
 *      proveedor, no por comprobante. Sólo se descuenta si es el primer pago del mes a ese proveedor
 *      (`baseNoImponibleDisponible`); si ya se usó, el tramo no se vuelve a descontar.
 *
 *   3. ALÍCUOTA sobre lo que quedó. El resultado es el MONTO RETENIDO.
 *
 * Los tres datos del tablero se validan ANTES de operar y cada fallo se nombra por separado, con el
 * valor leído: un cálculo de impuestos que sale mal en silencio es peor que uno que no sale.
 */
export function calcularRetencionGAN(args: {
  /** Las facturas elegidas, con su total y su importe neto. */
  facturas: readonly FacturaCompraPendiente[]
  /** `id de factura -> importe a pagar`. Sólo cuentan las que están acá. */
  imputaciones: Record<string, number>
  parametros: ParametrosGanancias
  /** Es el PRIMER pago del mes a este proveedor, así que la base no imponible todavía no se usó. */
  baseNoImponibleDisponible: boolean
}): ResultadoRetencion {
  const { facturas, imputaciones, parametros, baseNoImponibleDisponible } = args
  const elegidas = facturas.filter((f) => f.id in imputaciones && imputaciones[f.id] > 0)

  if (elegidas.length === 0) {
    return {
      ok: false,
      motivo: 'sin-facturas',
      detalle: 'No hay ninguna factura de compra seleccionada con importe a pagar.',
      faltantes: [],
    }
  }

  /* Sin importe neto no hay base que prorratear, y sin total no hay proporción que calcular. Se
     nombran TODAS las facturas incompletas —no la primera— y con el dato que le falta a cada una:
     si faltan tres, hay que poder arreglar las tres sin volver a intentar tres veces. */
  const incompletas = elegidas.flatMap((f) => {
    const faltan = [
      f.importeNeto === null && 'Importe Neto de la factura de compra asociada',
      !(f.total > 0) && 'Total a pagar de la factura',
    ].filter((x): x is string => typeof x === 'string')
    return faltan.length > 0 ? [`${f.nro} · falta ${faltan.join(' y ')}`] : []
  })
  if (incompletas.length > 0) {
    return {
      ok: false,
      motivo: 'sin-importe-neto',
      detalle: incompletas.join(' · '),
      faltantes: incompletas,
    }
  }

  /* Los dos totales tienen que ser el MISMO número: el de la factura pendiente y el de la factura
     de compra que tiene vinculada. Una diferencia no es un dato que falte sino uno mal cargado, y es
     más grave: el prorrateo de la retención divide por ese total, así que con el número equivocado
     el cálculo sale mal en silencio y con una cifra creíble.

     Se compara con `round2` en los dos lados —la precisión con la que se escriben los importes— y
     nunca se compara si el total de la vinculada no se pudo leer: hoy es el caso normal, porque su
     columna todavía no está configurada (ver `COL.factCompraDoc.total`). */
  const discrepantes = elegidas.flatMap((f) =>
    f.totalFactura !== null && round2(f.totalFactura) !== round2(f.total)
      ? [`${f.nro} · pendiente ${money(f.total)} vs factura ${money(f.totalFactura)}`]
      : [],
  )
  if (discrepantes.length > 0) {
    return {
      ok: false,
      motivo: 'total-no-coincide',
      detalle: discrepantes.join(' · '),
      faltantes: discrepantes,
    }
  }

  /* La base NO imponible se valida SIEMPRE, aunque este mes no corresponda descontarla: un valor
     inválido en el tablero es un problema de configuración que hay que ver ahora y no el mes que
     viene, cuando el cálculo dependa de él. */
  const { baseNoImponible, alicuota } = parametros
  if (baseNoImponible === null || !Number.isFinite(baseNoImponible) || baseNoImponible < 0) {
    return {
      ok: false,
      motivo: 'base-no-imponible-invalida',
      detalle: baseNoImponible === null ? '(vacía)' : String(baseNoImponible),
      faltantes: [],
    }
  }
  if (alicuota === null || !Number.isFinite(alicuota) || alicuota <= 0) {
    return {
      ok: false,
      motivo: 'alicuota-invalida',
      detalle: alicuota === null ? '(vacía)' : String(alicuota),
      faltantes: [],
    }
  }

  /* Tramo 1: la base de cada factura, prorrateada por lo que se le paga. */
  const bruta = round2(
    elegidas.reduce(
      (acc, f) => acc + (imputaciones[f.id] / f.total) * (f.importeNeto as number),
      0,
    ),
  )
  /* Tramo 2: el descuento mensual, UNA vez sobre el total. */
  const descuento = baseNoImponibleDisponible ? baseNoImponible : 0
  /* No baja de cero: una base negativa daría una retención negativa, que sería devolverle impuesto
     al proveedor. Si el pago no llega a cubrir el tramo exento, no hay base sobre la que retener. */
  const baseImponible = round2(Math.max(bruta - descuento, 0))
  /* Tramo 3: la alícuota, que es un PORCENTAJE. */
  const monto = round2((baseImponible * alicuota) / 100)

  /* Por debajo del mínimo el cálculo NO falla: el número es correcto y se devuelve igual, con la
     marca de que no corresponde practicarlo. Quien decide qué hacer con eso es la pantalla —lo
     muestra y no deja agregarlo—, no esta función. */
  return {
    ok: true,
    monto,
    baseImponible,
    alicuota,
    baseNoImponibleAplicada: descuento,
    alcanzaElMinimo: monto >= RETENCION_GAN_MINIMO,
  }
}

/**
 * Qué se le dice al usuario cuando la retención no se puede calcular. Cada motivo nombra QUÉ está
 * mal y DÓNDE mirarlo: los tres primeros son datos que faltan en un tablero, así que el mensaje
 * incluye el valor leído para poder depurarlo sin abrir Monday a ciegas.
 */
export function mensajeSinRetencion(r: Extract<ResultadoRetencion, { ok: false }>): {
  titulo: string
  mensaje: string
} {
  switch (r.motivo) {
    case 'sin-importe-neto':
      return {
        titulo: 'Faltan datos en la factura de compra',
        mensaje:
          'No se puede calcular la retención de Ganancias porque a las facturas de compra pendientes de pago que se están cancelando les faltan datos en el tablero. Completalos y volvé a elegir la caja.',
      }
    case 'total-no-coincide':
      return {
        titulo: 'El total de la factura no coincide',
        mensaje:
          'No se puede calcular la retención de Ganancias: el total de la factura de compra pendiente de pago no coincide con el de la factura de compra que tiene vinculada. Son el mismo importe, así que uno de los dos está mal cargado. Corregilo en el tablero y volvé a elegir la caja.',
      }
    case 'base-no-imponible-invalida':
      return {
        titulo: 'La base NO imponible es inválida',
        mensaje: `No es posible calcular la base imponible porque la base NO imponible es inválida. Valor leído en Configuración del Sistema: ${r.detalle}.`,
      }
    case 'alicuota-invalida':
      return {
        titulo: 'La alícuota es inválida',
        mensaje: `No es posible calcular la retención porque la alícuota tiene un valor inválido. Valor leído en Configuración del Sistema: ${r.detalle}.`,
      }
    default:
      return { titulo: 'No hay facturas seleccionadas', mensaje: r.detalle }
  }
}
