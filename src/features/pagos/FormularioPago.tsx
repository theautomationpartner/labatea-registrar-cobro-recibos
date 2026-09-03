import { useEffect, useRef, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { textoCuentasVacio, useCuentasPropias } from '@/features/cobro/useCuentasPropias'
import { aIso, desdeIso } from '@/lib/dates'
import { formatearImporteAR, importeATexto } from '@/lib/format'
import {
  CAJAS_PAGO,
  calcularRetencionGAN,
  descontarRetencion,
  esAnticipoDePago,
  esCajaCheque,
  esCajaTransferencia,
  esFaltaDeDatos,
  esRetencionGAN,
  mensajeSinRetencion,
  MODALIDADES_CHEQUE,
  MSG_REPARTO_IMPOSIBLE,
  MSG_RETENCION_MINIMO,
  MSG_RETENCION_MINIMO_CORTO,
  type ResultadoRetencion,
} from '@/lib/pagosProveedor'
import { getFacturasCompraPendientes } from '@/services/monday'
import {
  chequeVencido,
  fechaPagoChequeInvalida,
  MSG_CHEQUE_PAGO_CORTO,
  MSG_CHEQUE_VENCIDO_CORTO,
  vencimientoDeCheque,
} from '@/lib/pagos'
import { useApp, useDispatch } from '@/state/hooks'
import type {
  CajaPago,
  ChequeEnCartera,
  FormatoCheque,
  ModalidadCheque,
  MovimientoCaja,
} from '@/types'
import { TablaChequesCartera } from './TablaChequesCartera'
import { useChequesCartera } from './useChequesCartera'
import { useRetencionGanancias } from './useRetencionGanancias'

type Borrador = Omit<MovimientoCaja, 'id'>

/**
 * Con qué arranca el formulario. La caja inicial es el CHEQUE porque es la primera del catálogo
 * —el orden del selector lo fija el requerimiento—, y su modalidad arranca SIN elegir: ninguna de
 * las dos es más probable que la otra, así que preseleccionar una sería decidir por el usuario.
 */
const BORRADOR_VACIO: Borrador = {
  formaPago: CAJAS_PAGO[0],
  importe: 0,
  modalidadCheque: undefined,
  chequeId: '',
  numeroCheque: '',
  chequeVencimiento: '',
  fechaPagoCheque: '',
  fechaEmisionCheque: '',
  bancoEmisor: '',
  bancoEmisorId: null,
  cuitEmisor: '',
  formatoCheque: undefined,
  bancoOrigen: null,
  bancoOrigenId: null,
}

/** Formato del cheque que se libra: el valor es el del sistema, el rótulo el que ve el usuario. */
const FORMATOS_CHEQUE: { valor: FormatoCheque; rotulo: string }[] = [
  { valor: 'FISICO', rotulo: 'Cheque' },
  { valor: 'eCheq', rotulo: 'Echeq' },
]

/**
 * Cuánto dura el PLEGADO del bloque de una caja, en ms. Tiene que coincidir con la animación
 * `cobro-cond-out` de `cobro.css`: es el tiempo que el bloque anterior sigue montado después de
 * cambiar de caja, para que se retire en vez de desaparecer de un corte.
 */
const MS_SALIDA_RAMAL = 200

/** Ramal de campos que muestra el formulario, o `null` cuando la caja no pide ninguno. */
type Ramal = 'cheque' | 'transferencia' | null

/** Qué ramal le corresponde a una caja. De comparar el actual con el próximo sale si hay que animar. */
const ramalDe = (caja: string): Ramal => {
  if (esCajaCheque(caja)) return 'cheque'
  if (esCajaTransferencia(caja)) return 'transferencia'
  return null
}

/** Asterisco rojo que marca un campo obligatorio. Mismo tratamiento que en el formulario de cobros. */
const Req = () => <span className="cobro-req"> *</span>

/** Lo que se reclama al intentar agregar sin haber marcado ningún cheque de la cartera. */
const MSG_SIN_CHEQUE =
  'Seleccioná al menos un cheque en cartera antes de agregarlo a la tabla de cajas registradas.'

/** Lo que la ventana de la retención muestra: un título, el porqué y —si aplica— qué falta. */
interface AvisoRetencion {
  titulo: string
  mensaje: string
  faltantes: string[]
}

interface FormularioPagoProps {
  /**
   * El formulario se muestra, pero no se edita: el pago ya está cubierto. POR QUÉ está cerrado lo
   * dice la vista, en el renglón de avisos del paso: acá sólo se apaga.
   */
  bloqueado?: boolean
  /**
   * Lo que falta pagar en este momento. Es lo que precarga el importe de las cajas que lo declaran
   * a mano: como el pago tiene que cerrar en CERO EXACTO, proponer la diferencia es proponer el
   * número correcto. Los cheques de cartera NO lo miran: su importe es el del papel.
   */
  diferencia?: number
}

/**
 * Carga de una caja: al agregarla pasa a la tabla de cajas registradas. Según la caja pide datos
 * distintos —el cheque y la transferencia—, que aparecen en una fila condicional debajo de la
 * principal.
 *
 * SIN LECTURA DE COMPROBANTES. A diferencia del formulario de cobros, acá el usuario indica a mano
 * cómo se paga: no hay recuadro de carga, ni llamada al escenario de Make, ni ninguna dependencia
 * de procesamiento de imágenes. Es una decisión del requerimiento, no una etapa pendiente: al pagar,
 * el documento lo emite La Batea, así que no hay nada que leer.
 *
 * La validación corre al hacer CLICK en "+ Agregar": marca en rojo lo que falte y muestra su
 * mensaje, sin agregar nada. No se deshabilita el botón: así se ve POR QUÉ no se agrega en lugar de
 * toparse con un control muerto. Es el mismo criterio del formulario de cobros.
 */
export function FormularioPago({ bloqueado = false, diferencia = 0 }: FormularioPagoProps) {
  const { pago, tipoOperacionPago, proveedor, facturasCompra, imputacionesPago } = useApp()
  const dispatch = useDispatch()
  /* El borrador nace con lo que FALTA para cerrar el pago, no en cero: es el número correcto en el
     caso habitual —una sola caja que cubre todo—, y el usuario lo pisa cuando el pago se parte en
     varias. Se resuelve en el inicializador y no en un efecto para que el primer pintado ya lo
     tenga: con un efecto, el campo aparecería vacío y se llenaría solo un cuadro después. */
  const [borrador, setBorrador] = useState<Borrador>(() => ({
    ...BORRADOR_VACIO,
    importe: Math.max(diferencia, 0),
  }))
  // Texto formateado (miles con punto, coma decimal) del importe del borrador.
  const [importeTexto, setImporteTexto] = useState(() =>
    diferencia > 0 ? importeATexto(diferencia) : '',
  )
  /**
   * Cheques de la cartera marcados para pagar. Se pueden elegir VARIOS de una vez y cada uno entra
   * como su propia caja registrada, con SU importe: juntarlos en una sola línea perdería de qué
   * papel salió cada peso.
   *
   * Vive acá y no en el borrador porque no es un dato del movimiento sino una selección de la
   * pantalla: el borrador describe UN movimiento, y esto produce varios.
   */
  const [chequesElegidos, setChequesElegidos] = useState<string[]>([])
  // Recién al intentar agregar se muestran los errores: no se reta al usuario mientras carga.
  const [intento, setIntento] = useState(false)
  /**
   * Lo que hay que decirle al usuario sobre la retención, cuando esa retención no se puede agregar.
   * `null` = no hay nada que avisar.
   *
   * Es UNO solo para los dos motivos que la frenan —datos que faltan en un tablero, o un monto que
   * no llega al mínimo—: los dos interrumpen, ninguno se arregla tipeando en este formulario, y
   * tenerlos separados obligaba a duplicar el disparo y el re-disparo.
   */
  const [avisoRetencion, setAvisoRetencion] = useState<AvisoRetencion | null>(null)
  /* Ramal que se está RETIRANDO: la caja ya cambió, pero sus campos siguen montados hasta que
     termina la animación de salida. Sin esto, elegir otra caja los borra de un corte. */
  const [saliendo, setSaliendo] = useState<Ramal>(null)
  const relojRamal = useRef<ReturnType<typeof setTimeout>>()

  // Al desmontar el formulario no puede quedar un temporizador buscando un ramal que ya no está.
  useEffect(() => () => clearTimeout(relojRamal.current), [])

  const esCheque = esCajaCheque(borrador.formaPago)
  const esTransferencia = esCajaTransferencia(borrador.formaPago)
  const esRetencion = esRetencionGAN(borrador.formaPago)
  /* ANTICIPO: el sobrante que queda a favor nuestro cuando lo entregado supera lo que se cancela.
     No trae datos propios —sólo el importe—, así que se carga como el efectivo. */
  const esAnticipo = esAnticipoDePago(borrador.formaPago)
  const esDeCartera = esCheque && borrador.modalidadCheque === 'cartera'
  const esNuevo = esCheque && borrador.modalidadCheque === 'nuevo'
  const ramalActual = ramalDe(borrador.formaPago)

  /* Cuándo se OFRECE el anticipo. Son dos condiciones, y las dos por el mismo motivo: el anticipo
     no es una forma de pagar, es la salida para lo que se entregó DE MÁS.

       · sólo al cancelar facturas de compra pendientes, que es el único recorrido del módulo;
       · sólo con la diferencia NEGATIVA, o sea con lo entregado por encima de lo que se cancela.
         Con la diferencia en cero o a favor no hay sobrante que dejar a cuenta, y ofrecerlo ahí
         invitaría a inventar un saldo que nadie entregó.

     La opción se mantiene mientras esté ELEGIDA, aunque la diferencia deje de ser negativa: si
     desapareciera de la lista con la caja puesta, el selector quedaría en blanco mostrando un valor
     que ya no existe entre sus opciones. Agregarla igual no se puede —el importe sugerido cae en
     cero y el alta lo reclama—, así que la salida es cambiar de caja.

     Es, palabra por palabra, la misma regla que `ofreceAnticipo` en el formulario de cobros. */
  const hayExcedente = diferencia < 0
  const ofreceAnticipo = tipoOperacionPago === 'facturasCompra' && (hayExcedente || esAnticipo)
  const cajasDisponibles = CAJAS_PAGO.filter((c) => !esAnticipoDePago(c) || ofreceAnticipo)

  /* La cartera se consulta recién cuando esa modalidad entra en pantalla: antes no hay nada que
     mostrar y la llamada sería trabajo tirado. */
  const { cheques, estado: estadoCartera } = useChequesCartera(esDeCartera)

  /* Cuentas propias: las piden la transferencia —de qué banco SALE el dinero— y el cheque NUEVO
     —contra qué cuenta se lo libra—. Es el mismo catálogo que en Cobros usa como cuenta de destino:
     el tablero de cuentas de La Batea es uno solo. */
  const { cuentas, estado: estadoCuentas } = useCuentasPropias(esTransferencia || esNuevo)

  /* Los dos datos de la retención que vienen de Monday. Se piden recién cuando la caja entra en
     pantalla, y su clave es el proveedor: "¿ya se usó la base no imponible este mes?" es una
     pregunta sobre ÉL. */
  const {
    parametros,
    baseNoImponibleDisponible,
    estado: estadoRetencion,
    reintentar: reintentarParametros,
  } = useRetencionGanancias(esRetencion, proveedor?.id ?? null)

  /* Las FACTURAS también se están releyendo. Va aparte del estado del hook porque son dos lecturas
     distintas —la configuración y el listado de facturas— y el campo de importe tiene que mostrar la
     espera hasta que terminen las DOS. */
  const [releyendoFacturas, setReleyendoFacturas] = useState(false)

  /**
   * Vuelve a intentar el cálculo, releyendo TODO lo que puede haberse corregido en Monday:
   *
   *   · los parámetros de la retención —la alícuota, la base no imponible—, y
   *   · las FACTURAS de compra, de donde salen el importe neto y el total.
   *
   * Releer las facturas es lo que hace útil al botón: el listado está cacheado por proveedor, así
   * que corregir el importe neto en el tablero no cambiaba nada mientras la app siguiera mirando la
   * copia vieja. Sin esto, reintentar habría dado siempre el mismo error.
   */
  const reintentarCalculo = () => {
    reintentarParametros()
    if (!proveedor || releyendoFacturas) return
    setReleyendoFacturas(true)
    getFacturasCompraPendientes(proveedor.id)
      .then((fs) => dispatch({ type: 'setFacturasCompra', facturas: fs, proveedorId: proveedor.id }))
      .catch(() =>
        dispatch({
          type: 'errorMonday',
          accion: 'volver a leer las facturas de compra del proveedor',
        }),
      )
      .finally(() => setReleyendoFacturas(false))
  }

  /**
   * Lo que se le retiene, recalculado con lo que hay en pantalla. Se resuelve en cada render y no en
   * un efecto: es una función pura de las facturas imputadas y los dos parámetros, así que guardarlo
   * en un estado sólo abriría la puerta a que quede viejo.
   *
   * `null` mientras los datos no llegaron: ahí todavía no hay nada que decir.
   */
  const retencion: ResultadoRetencion | null =
    esRetencion && estadoRetencion === 'listo' && parametros
      ? calcularRetencionGAN({
          facturas: facturasCompra,
          imputaciones: imputacionesPago,
          parametros,
          baseNoImponibleDisponible,
        })
      : null

  /**
   * Cheques que TODAVÍA se pueden elegir: los de la cartera menos los que ya entraron a la tabla de
   * cajas registradas.
   *
   * Un cheque se endosa UNA vez. Sin este corte, el mismo papel podía cargarse dos veces y el TOTAL
   * PAGADO cerraba con plata que no existe —el tablero seguiría teniendo un solo cheque—.
   */
  const yaUsados = new Set(
    pago.movimientos.map((m) => m.chequeId).filter((id): id is string => !!id),
  )
  const disponibles = cheques.filter((c) => !yaUsados.has(c.id))

  /* La cartera está EN PANTALLA con cheques para elegir. Lo miran dos cosas: la tabla, para
     dibujarse, y el renglón de aviso de abajo, para reservar su lugar. Con una sola condición no
     pueden desincronizarse —y un renglón reservado donde no hay tabla sería un hueco sin motivo—. */
  const muestraCartera = esDeCartera && estadoCartera === 'listo' && disponibles.length > 0

  /* Precarga del importe con lo que FALTA para cerrar el pago. Se recalcula sólo al cambiar de caja
     o después de agregar una —nunca con la diferencia en vivo—: si dependiera de ella, pisaría el
     importe justo mientras se lo está tipeando. */
  const sugerir = (falta: number, caja: string = borrador.formaPago) => {
    /* La RETENCIÓN no se precarga con nada: su importe sale de una fórmula, no de lo que falta
       cobrar. Proponerle la diferencia dejaba el campo mostrando OTRA cifra —la pendiente— como si
       fuera el monto retenido, y así se quedaba cuando el cálculo daba cero. */
    if (esRetencionGAN(caja)) {
      setImporteTexto('')
      return 0
    }
    /* El anticipo se precarga con lo que SOBRA y el resto con lo que FALTA: en los dos casos es el
       número que lleva la diferencia a cero, y en los dos el usuario puede pisarlo. */
    const sugerido = Math.max(esAnticipoDePago(caja) ? -falta : falta, 0)
    setImporteTexto(sugerido > 0 ? importeATexto(sugerido) : '')
    return sugerido
  }

  /**
   * El importe de la RETENCIÓN se escribe SOLO, apenas el cálculo resuelve.
   *
   * No es un efecto: se compara el monto calculado con el que hay en el borrador y, si cambió, se
   * corrige en el mismo render (el patrón de estado derivado que React recomienda sobre `useEffect`
   * para esto). Así el campo nunca muestra por un cuadro un importe que ya no corresponde.
   *
   * El usuario NO puede tipearlo: es el resultado de una fórmula fiscal, y dejarlo editable sería
   * invitar a declarar una retención distinta de la que corresponde practicar.
   */
  /* El importe que muestra el campo es SIEMPRE el que dio la fórmula, llegue o no al mínimo: es el
     número real, y esconderlo dejaba el campo mostrando la diferencia pendiente —otra cifra— como
     si fuera la retención. */
  /**
   * El monto calculado, o `null` mientras no hay uno.
   *
   * El `null` es la parte importante: un cálculo que da CERO —la base quedó por debajo del tramo
   * exento— es un resultado tan válido como cualquier otro, y hay que mostrarlo. Comparando sólo
   * números, ese cero era indistinguible de "todavía no calculé", el volcado no corría y el campo se
   * quedaba con lo que tuviera antes.
   */
  const montoRetencion = retencion?.ok ? retencion.monto : null
  /**
   * El cálculo dio un número que NO alcanza el mínimo no retenible. Se muestra igual y se marca en
   * rojo, como cualquier otro campo mal cargado: lo único que no se puede es agregarlo.
   */
  const retencionBajoMinimo = esRetencion && !!retencion?.ok && !retencion.alcanzaElMinimo
  const [ultimaRetencion, setUltimaRetencion] = useState<number | null>(null)
  if (esRetencion && montoRetencion !== null && ultimaRetencion !== montoRetencion) {
    setUltimaRetencion(montoRetencion)
    setBorrador((b) => ({ ...b, importe: montoRetencion }))
    /* Se escribe SIEMPRE, incluso un cero: es el valor real que dio la fórmula. Dejarlo en blanco
       escondía el resultado justo en el caso en que hay que explicarlo. */
    setImporteTexto(importeATexto(montoRetencion))
  }

  /* El cálculo todavía no resolvió: sus dos consultas a Monday siguen en vuelo. Lo miran el campo de
     importe —que muestra la espera en su lugar— y el renglón de abajo, que mientras tanto no dice
     nada: el estado ya se ve donde va a aparecer el número. */
  const calculandoRetencion =
    esRetencion &&
    (estadoRetencion === 'cargando' || estadoRetencion === 'idle' || releyendoFacturas)

  /**
   * Por qué la retención NO se puede agregar, o `null` si se puede. Son dos motivos y los dos se
   * avisan igual:
   *
   *   · faltan DATOS en un tablero —el importe neto de una factura, o los parámetros de la
   *     configuración—: se nombra qué falta, comprobante por comprobante;
   *   · el monto no llega al MÍNIMO no retenible: el cálculo salió bien, pero no corresponde
   *     practicar la retención.
   *
   * Ninguno de los dos se arregla desde este formulario, así que los dos interrumpen con una
   * ventana en vez de quedar en un renglón al pie.
   */
  const motivoParaAvisar = (): AvisoRetencion | null => {
    if (!esRetencion || !retencion) return null
    if (!retencion.ok) {
      return esFaltaDeDatos(retencion)
        ? { ...mensajeSinRetencion(retencion), faltantes: retencion.faltantes }
        : null
    }
    if (!retencion.alcanzaElMinimo) {
      return { titulo: 'La retención no llega al mínimo', mensaje: MSG_RETENCION_MINIMO, faltantes: [] }
    }
    /* El monto es válido, pero puede no ENTRAR en lo ya cargado: se descuenta en partes iguales de
       las cajas registradas, y si alguna quedara sin importe el reparto no se puede hacer. */
    return descontarRetencion(pago.movimientos, retencion.monto) === null
      ? { titulo: 'La retención no entra en las cajas registradas', mensaje: MSG_REPARTO_IMPOSIBLE, faltantes: [] }
      : null
  }

  /**
   * La ventana se abre SOLA apenas el cálculo termina, sin esperar a que el usuario apriete
   * "+ Agregar": es información que decide si la retención existe o no.
   *
   * Se abre UNA vez por motivo. La firma es el propio mensaje, así que cerrarla no la reabre, pero
   * un motivo distinto —otra factura incompleta, un monto que pasó a estar por debajo del mínimo—
   * sí vuelve a avisar.
   */
  const avisoActual = motivoParaAvisar()
  const firmaAviso = avisoActual ? `${avisoActual.titulo}·${avisoActual.mensaje}` : ''
  const [ultimaFirma, setUltimaFirma] = useState('')
  if (firmaAviso !== ultimaFirma) {
    setUltimaFirma(firmaAviso)
    setAvisoRetencion(avisoActual)
  }

  /* Campos obligatorios del movimiento, por caja. Cada clave enciende el borde rojo y el mensaje de
     su campo cuando se intenta agregar. */
  /* El error de la fecha de pago NO espera al "+ Agregar": el importe lo tipea el usuario y hay que
     dejarlo terminar, pero una fecha se elige de un calendario y ya está completa cuando llega. */
  const mostrarErrorPago =
    esNuevo &&
    fechaPagoChequeInvalida(borrador.fechaPagoCheque) &&
    (!!borrador.fechaPagoCheque?.trim() || intento)

  /* El VENCIMIENTO que le corresponde a la fecha de pago cargada: 30 días después. Se deriva acá y
     no se guarda —el movimiento lo vuelve a derivar cuando hace falta (ver `vencimientoDeCajaCheque`)—,
     así la pantalla y el tablero no pueden mostrar fechas distintas. */
  const vencimientoCheque = vencimientoDeCheque(borrador.fechaPagoCheque)
  /* El cheque quedó VENCIDO: su fecha de pago está a más de 30 días atrás. No es un dato mal
     cargado sino un cheque que ya no sirve, y por eso se dice aparte. */
  const chequeEstaVencido = esNuevo && chequeVencido(borrador.fechaPagoCheque)

  const faltantes: Record<string, boolean> = {
    /* El importe se declara a mano en TODAS las cajas menos en un cheque de cartera, donde sale del
       propio papel y no hay nada que tipear. */
    /* La RETENCIÓN queda afuera: su importe lo pone la fórmula, así que "falta cargarlo" no es un
       estado posible. Lo que puede pasarle —no llegar al mínimo— tiene su propio aviso. */
    importe: !esDeCartera && !esRetencion && borrador.importe <= 0,
    // CHEQUE: de dónde sale es lo primero que hay que decir.
    modalidad: esCheque && !borrador.modalidadCheque,
    // CHEQUE de cartera: hay que marcar al menos uno.
    chequesCartera: esDeCartera && chequesElegidos.length === 0,
    // CHEQUE nuevo: se libra ahora, así que sus datos se cargan a mano.
    numeroCheque: esNuevo && !borrador.numeroCheque?.trim(),
    fechaEmision: esNuevo && !borrador.fechaEmisionCheque?.trim(),
    /* La FECHA DE PAGO reemplazó al vencimiento como el dato que se carga: el vencimiento ahora se
       deriva de ella. Falta tanto si está vacía como si quedó antes de hoy —las dos cosas impiden
       agregar el cheque—, y cuál de las dos es lo dice el mensaje del campo. */
    fechaPago: esNuevo && fechaPagoChequeInvalida(borrador.fechaPagoCheque),
    bancoEmisorId: esNuevo && !borrador.bancoEmisorId,
    /* TRANSFERENCIA: de qué banco sale el dinero. Es obligatorio.

       La clave es `bancoOrigenId` y NO `bancoOrigen`: tiene que coincidir con la que el campo le
       pasa a `mal()`, que es el id de la cuenta. Con el nombre desalineado la búsqueda no encontraba
       nada, `mal()` daba siempre falso y el campo se quedaba mudo —sin borde rojo y sin mensaje—
       aunque el avance sí estuviera frenado. */
    bancoOrigenId: esTransferencia && !borrador.bancoOrigenId,
  }
  const completo = !Object.values(faltantes).some(Boolean)

  /** Un campo se marca en rojo recién al intentar agregar. */
  const mal = (campo: string) => intento && faltantes[campo]

  /** Deja el formulario listo para la próxima caja, sin perder la decisión de con qué se paga. */
  const limpiar = (faltaAhora: number) => {
    /* El monto volcado se olvida: si no, un cálculo que diera el MISMO número que el anterior no se
       volvería a aplicar y el campo se quedaría con lo que dejó `sugerir`. */
    setUltimaRetencion(null)
    setBorrador({
      ...BORRADOR_VACIO,
      formaPago: borrador.formaPago,
      modalidadCheque: borrador.modalidadCheque,
      importe: sugerir(faltaAhora),
    })
    setChequesElegidos([])
    setIntento(false)
  }

  const agregar = () => {
    setIntento(true)

    /* RETENCIÓN · lo que decide si se puede agregar NO es el formulario sino el cálculo: si no
       cerró, se explica por qué y no entra nada. Es la barrera del mínimo no retenible y también la
       de los datos que faltan en los tableros. */
    if (esRetencion) {
      /* Insistir con el botón vuelve a abrir la MISMA ventana. Es a propósito: el usuario ya la
         cerró una vez, y si vuelve a intentar es porque no le quedó claro por qué no se agrega.
         Dejarlo apretar un botón que no hace nada sería peor. */
      if (avisoActual) {
        setAvisoRetencion(avisoActual)
        return
      }
      if (!retencion?.ok) return
      if (bloqueado) return
      dispatch({
        type: 'agregarMovimientoCaja',
        movimiento: {
          formaPago: borrador.formaPago,
          importe: retencion.monto,
          /* Los dos números del cálculo viajan con el movimiento: son la única forma de explicar de
             dónde salió el monto cuando alguien lo revise en la tabla. */
          baseImponible: retencion.baseImponible,
          alicuota: retencion.alicuota,
          baseNoImponibleAplicada: retencion.baseNoImponibleAplicada,
        },
      })
      /* La diferencia NO se mueve cuando hay cajas de las que descontar: la retención reemplaza
         parte de lo que se iba a entregar, no se suma a ello. Con la lista vacía sí baja, y de eso
         se encarga el propio `diferencia` que la vista recalcula en el próximo render. */
      limpiar(diferencia)
      return
    }

    if (!completo || bloqueado) return

    /* CARTERA · un movimiento por cheque. El importe NO se pide: es el del papel, y es exactamente
       lo que va a sumar al TOTAL PAGADO. Los datos del cheque se copian del tablero en vez de
       volver a pedirlos: ya están, y hacerlos tipear sería invitar a que no coincidan. */
    if (esDeCartera) {
      for (const id of chequesElegidos) {
        const c = disponibles.find((x) => x.id === id)
        if (!c) continue
        dispatch({
          type: 'agregarMovimientoCaja',
          movimiento: {
            formaPago: borrador.formaPago,
            importe: c.importe,
            modalidadCheque: 'cartera',
            chequeId: c.id,
            numeroCheque: c.numero,
            chequeVencimiento: desdeIso(c.vencimiento),
            fechaEmisionCheque: desdeIso(c.emision),
            bancoEmisor: c.banco,
            cuitEmisor: c.cuitEmisor,
            /* "🤖Tipo de Cheque" del tablero trae tres etiquetas —"Cheque", "eCheq" y "Papel"—
               que en los hechos son DOS cosas. Se reducen acá, con el mismo criterio con el que la
               tabla las muestra, para que el subelemento de la orden declare un origen y no una
               etiqueta suelta. */
            formatoCheque: /echeq/i.test(c.tipo) ? 'eCheq' : 'FISICO',
          },
        })
      }
      /* Lo que falta después de sumar los elegidos: es lo que se propone para la caja siguiente. */
      const sumado = chequesElegidos.reduce(
        (acc, id) => acc + (disponibles.find((x) => x.id === id)?.importe ?? 0),
        0,
      )
      limpiar(diferencia - sumado)
      return
    }

    dispatch({ type: 'agregarMovimientoCaja', movimiento: borrador })
    limpiar(diferencia - borrador.importe)
  }

  /** Cambiar de caja descarta lo que sólo valía para la anterior, y anima el bloque que se va. */
  const cambiarCaja = (caja: string) => {
    /* El ramal que estaba en pantalla se despide antes de irse. Se marca ANTES de tocar el
       borrador: a partir del próximo render la caja ya es otra, así que si no se anotó acá cuál
       era, después no hay forma de saberlo. */
    const proximo = ramalDe(caja)
    clearTimeout(relojRamal.current)
    if (ramalActual && ramalActual !== proximo) {
      setSaliendo(ramalActual)
      relojRamal.current = setTimeout(() => setSaliendo(null), MS_SALIDA_RAMAL)
    } else {
      setSaliendo(null)
    }
    setIntento(false)
    setChequesElegidos([])
    setUltimaRetencion(null)
    setBorrador({
      ...BORRADOR_VACIO,
      formaPago: caja as CajaPago,
      importe: sugerir(diferencia, caja),
    })
  }

  /** Cambiar de modalidad descarta los datos de la otra: son dos cheques distintos. */
  const cambiarModalidad = (modalidad: ModalidadCheque) => {
    setIntento(false)
    setChequesElegidos([])
    setBorrador({
      ...BORRADOR_VACIO,
      formaPago: borrador.formaPago,
      modalidadCheque: modalidad,
      importe: sugerir(diferencia),
    })
  }

  /** Marca o desmarca un cheque de la cartera. Se pueden elegir varios. */
  const alternarCheque = (cheque: ChequeEnCartera) =>
    setChequesElegidos((actual) =>
      actual.includes(cheque.id)
        ? actual.filter((id) => id !== cheque.id)
        : [...actual, cheque.id],
    )

  /* El importe del pago. Es una función y no JSX suelto porque cambia de LUGAR según la caja: en el
     cheque nuevo y la transferencia baja al bloque condicional, junto a los campos de esa caja, y
     en el resto queda en la fila principal, al lado del selector. En un cheque de CARTERA no
     aparece: su importe es el del papel. */
  const campoImporte = () => (
    <div className="cobro-form-campo cobro-form-campo--val cobro-form-campo--importe">
      <label htmlFor="pago-importe">
        Importe
        <Req />
      </label>
      {/* Importe como número con separador de miles (formato AR): "30409" → "30.409"; la coma
          agrega centavos. Se guarda el número en el borrador. */}
      {calculandoRetencion ? (
        /* La espera ocurre DENTRO del campo, que es donde va a aparecer el número: así el lugar del
           importe no queda vacío ni con un cero mientras se calcula, y el usuario mira un solo
           punto de la pantalla. Es un `div` con las clases del input —mismo alto, mismo borde—, no
           un input deshabilitado: no hay nada que tipear ni que leer todavía.

           `aria-live` para que un lector de pantalla anuncie el importe cuando reemplace a esto. */
        <div className="cobro-in pago-importe-calc" aria-live="polite">
          <i className="fas fa-circle-notch fa-spin" /> Calculando retención…
        </div>
      ) : (
        <input
          id="pago-importe"
          /* El borde rojo del mínimo NO espera al "+ Agregar": el importe no lo tipeó el usuario,
             así que no hay nada que esperar a que termine de escribir. */
          className={`cobro-in ${mal('importe') || retencionBajoMinimo ? 'cobro-in--error' : ''}`}
          inputMode="decimal"
          placeholder={esRetencion ? 'Se calcula solo' : '$ 0'}
          aria-invalid={mal('importe') || undefined}
          /* En la RETENCIÓN el importe es el resultado de una fórmula fiscal: se muestra, no se
             edita. `readOnly` y no `disabled` a propósito: el valor tiene que seguir siendo legible
             y copiable, que es lo que hace falta para controlarlo contra el papel. */
          readOnly={esRetencion}
          value={importeTexto}
          onChange={(e) => {
            if (esRetencion) return
            const { texto, valor } = formatearImporteAR(e.target.value)
            setImporteTexto(texto)
            setBorrador({ ...borrador, importe: valor })
          }}
        />
      )}
      {/* El mensaje va DEBAJO del campo, como el del resto de las validaciones: es el mismo tipo de
          aviso —un valor que no sirve— y tiene que leerse en el mismo lugar. */}
      {retencionBajoMinimo ? (
        <span className="cobro-in-err" role="alert">
          {MSG_RETENCION_MINIMO_CORTO}
        </span>
      ) : (
        mal('importe') && (
          <span className="cobro-in-err" role="alert">
            Ingresá el importe
          </span>
        )
      )}
    </div>
  )

  /**
   * Selector de CUENTA PROPIA de La Batea. Lo comparten la transferencia —de qué banco sale el
   * dinero— y el cheque nuevo —contra qué cuenta se lo libra—: es el mismo catálogo y la misma
   * decisión, así que es el mismo control.
   */
  const campoCuentaPropia = (
    id: string,
    etiqueta: string,
    clave: 'bancoOrigenId' | 'bancoEmisorId',
    clase = '',
  ) => (
    <div className={`cobro-form-campo cobro-form-campo--val cobro-form-campo--cuenta ${clase}`}>
      <label htmlFor={id}>
        {etiqueta}
        <Req />
      </label>
      <select
        id={id}
        className={`cobro-in ${mal(clave) ? 'cobro-in--error' : ''}`}
        disabled={estadoCuentas !== 'listo' || cuentas.length === 0}
        aria-invalid={mal(clave) || undefined}
        /* El valor del selector es el ID del ítem: es lo que necesita la relación del subelemento.
           El nombre se guarda aparte, que es lo que se muestra en el detalle del movimiento. */
        value={(clave === 'bancoOrigenId' ? borrador.bancoOrigenId : borrador.bancoEmisorId) ?? ''}
        onChange={(e) => {
          const elegida = cuentas.find((c) => c.id === e.target.value)
          setBorrador(
            clave === 'bancoOrigenId'
              ? {
                  ...borrador,
                  bancoOrigenId: elegida?.id ?? null,
                  bancoOrigen: elegida?.name ?? null,
                }
              : {
                  ...borrador,
                  bancoEmisorId: elegida?.id ?? null,
                  bancoEmisor: elegida?.name ?? '',
                },
          )
        }}
      >
        <option value="">{textoCuentasVacio(estadoCuentas, cuentas.length)}</option>
        {cuentas.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      {mal(clave) && (
        <span className="cobro-in-err" role="alert">
          {/* Nombra el campo en vez de decir "Elegí la cuenta": los dos usos de este selector son
              cuentas propias, así que el genérico no distinguía cuál de los dos faltaba. */}
          Elegí el {etiqueta.toLowerCase()}
        </span>
      )}
    </div>
  )

  /**
   * "Reintentar", al lado del "+ Agregar". Aparece SÓLO cuando hay algo que reintentar: un dato que
   * falta en un tablero, o una lectura que falló. Con el cálculo resuelto no se muestra —no hay nada
   * que volver a pedir— y con la retención por debajo del mínimo tampoco, salvo que el motivo sea un
   * parámetro mal cargado, que es justamente uno de los casos de arriba.
   *
   * Mismos estilos que el "+ Agregar": es la otra acción del formulario y tiene el mismo peso.
   */
  const puedeReintentar =
    esRetencion &&
    !calculandoRetencion &&
    (estadoRetencion === 'error' || (!!retencion && !retencion.ok))

  const botonReintentar = () => (
    <div className="cobro-form-campo cobro-form-campo--val cobro-form-campo--accion">
      <button type="button" className="cobro-btn cobro-btn--primary" onClick={reintentarCalculo}>
        <i className="fas fa-rotate-right" /> Reintentar
      </button>
    </div>
  )

  /* "+ Agregar". Valida al hacer click. Es una FUNCIÓN que devuelve JSX y no un componente
     declarado acá adentro: así React reusa el mismo botón entre renders en lugar de recrearlo (y
     perderle el foco).

     Se APAGA mientras se calcula la retención. Todavía no hay importe que agregar —el campo está
     mostrando la espera—, así que insistir sólo podía cargar una línea con el monto anterior o con
     un cero. En cuanto el cálculo resuelve, el botón vuelve. */
  const botonAgregar = () => (
    <div className="cobro-form-campo cobro-form-campo--val cobro-form-campo--accion">
      <button
        type="button"
        className="cobro-btn cobro-btn--primary"
        disabled={calculandoRetencion}
        title={calculandoRetencion ? 'Esperá a que termine el cálculo de la retención' : undefined}
        onClick={agregar}
      >
        <i className="fas fa-plus" /> Agregar
      </button>
    </div>
  )

  return (
    <fieldset className="cobro-form" disabled={bloqueado}>
      <div className="cobro-form-campo cobro-form-campo--val cobro-form-campo--forma">
        <label htmlFor="pago-caja">Seleccionar Caja</label>
        <select
          id="pago-caja"
          className="cobro-in"
          value={borrador.formaPago}
          onChange={(e) => cambiarCaja(e.target.value)}
        >
          {cajasDisponibles.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {/* MODALIDAD, pegada a la caja: decide de dónde sale el cheque, así que va antes de cualquier
          dato. Arranca VACÍA —"Seleccionar…"— porque ninguna de las dos opciones es la esperable. */}
      {esCheque && (
        <div className="cobro-form-campo cobro-form-campo--val cobro-campo--tiporet">
          <label htmlFor="pago-cheque-modalidad">
            Modalidad
            <Req />
          </label>
          <select
            id="pago-cheque-modalidad"
            className={`cobro-in ${mal('modalidad') ? 'cobro-in--error' : ''}`}
            aria-invalid={mal('modalidad') || undefined}
            value={borrador.modalidadCheque ?? ''}
            onChange={(e) => cambiarModalidad(e.target.value as ModalidadCheque)}
          >
            <option value="" disabled>
              Seleccionar…
            </option>
            {MODALIDADES_CHEQUE.map((m) => (
              <option key={m.valor} value={m.valor}>
                {m.rotulo}
              </option>
            ))}
          </select>
          {mal('modalidad') && (
            <span className="cobro-in-err" role="alert">
              Indicá de dónde sale el cheque
            </span>
          )}
        </div>
      )}

      {/* El "+ Agregar" del CHEQUE queda a la derecha de la modalidad, en la fila principal, y no
          abajo con los campos: es el mismo botón para las dos modalidades, así que cambiar de una a
          otra no lo mueve de lugar. */}
      {esCheque && botonAgregar()}

      {/* El IMPORTE vive en la fila principal, al lado del selector de caja, en todas las cajas que
          lo declaran a mano: efectivo, las dos tarjetas y la transferencia. Es el mismo dato en
          todas —cuánto sale—, así que tiene que estar siempre en el mismo lugar: si la
          transferencia lo bajara a su bloque condicional, cambiar de caja movería el campo de
          lugar y habría que volver a buscarlo con la vista.

          El CHEQUE es la excepción y por un motivo de fondo: en cartera el importe no se declara
          —es el del papel— y en un cheque nuevo es un dato más del documento que se está librando,
          así que va con el resto de sus campos. */}
      {!esCheque && campoImporte()}

      {/* EFECTIVO, RETENCIÓN y ANTICIPO no piden nada más, así que el "+ Agregar" cierra la fila
          principal. La transferencia sí pide algo más, y su botón cierra ese bloque. */}
      {!esCheque && !esTransferencia && botonAgregar()}

      {/* Y, si hay algo que corregir en Monday, el "Reintentar" a la derecha del "+ Agregar". */}
      {puedeReintentar && botonReintentar()}

      {/* CHEQUE. Dos caminos excluyentes: elegir de la cartera —los cheques ya existen con todos sus
          datos, así que sólo se decide con cuáles— o cargar a mano el que se libra ahora. Sin
          modalidad elegida no se dibuja ninguno: todavía no se dijo de dónde sale. */}
      {((esCheque && borrador.modalidadCheque) || saliendo === 'cheque') && (
        <div
          className={`cobro-cond ${saliendo === 'cheque' ? 'cobro-cond--saliendo' : ''}`}
          key="cheque"
        >
          {esDeCartera && (
            <div className="pago-cartera-bloque">
              {/* Mismo encabezado que el bloque de anticipos del cobro, con los rótulos del pago. */}
              <h3 className="cobro-card-title">Cheques/Echeqs en cartera pendientes</h3>
              <p className="cobro-card-desc">
                Selecciona con cuales de los cheques disponibles queres pagar
              </p>

              {estadoCartera === 'cargando' || estadoCartera === 'idle' ? (
                <p className="cobro-vacio">
                  <i className="fas fa-spinner fa-spin" /> Buscando los cheques disponibles en
                  cartera...
                </p>
              ) : estadoCartera === 'error' ? (
                <p className="cobro-vacio">
                  <i className="fas fa-triangle-exclamation" /> No se pudieron traer los cheques en
                  cartera.
                </p>
              ) : !muestraCartera ? (
                <p className="cobro-vacio">
                  <i className="fas fa-circle-info" />{' '}
                  {cheques.length === 0
                    ? 'No hay cheques pendientes en cartera.'
                    : 'Ya cargaste todos los cheques disponibles en cartera.'}{' '}
                  Elegí <strong>Nuevo</strong> para registrar un cheque emitido.
                </p>
              ) : (
                <TablaChequesCartera
                  cheques={disponibles}
                  elegidos={chequesElegidos}
                  onAlternar={alternarCheque}
                  error={mal('chequesCartera')}
                />
              )}
            </div>
          )}

          {/* CHEQUE NUEVO: el documento todavía no existe en ningún tablero, así que se carga a
              mano. Los campos van en el orden en que se lee un cheque: cuánto es, qué documento es
              (número y sus dos fechas) y contra qué banco se libra. */}
          {esNuevo && (
            /* El cheque que se LIBRA, en dos renglones: arriba QUÉ documento es —cuánto, de qué
               tipo, con qué número y contra qué cuenta nuestra— y abajo sus dos fechas. El corte es
               explícito y no depende de dónde envuelva la grilla: las fechas se leen juntas. */
            <div className="cobro-lector-campos">
              {campoImporte()}

              <div className="cobro-form-campo cobro-form-campo--val cobro-campo--formato">
                <label htmlFor="pago-cheque-tipo">
                  Tipo
                  <Req />
                </label>
                <select
                  id="pago-cheque-tipo"
                  className="cobro-in"
                  value={borrador.formatoCheque ?? 'FISICO'}
                  onChange={(e) =>
                    setBorrador({ ...borrador, formatoCheque: e.target.value as FormatoCheque })
                  }
                >
                  {FORMATOS_CHEQUE.map((f) => (
                    <option key={f.valor} value={f.valor}>
                      {f.rotulo}
                    </option>
                  ))}
                </select>
              </div>

              <div className="cobro-form-campo cobro-form-campo--val cobro-campo--nro">
                <label htmlFor="pago-cheque-nro">
                  Nro. de Cheque
                  <Req />
                </label>
                <input
                  id="pago-cheque-nro"
                  className={`cobro-in ${mal('numeroCheque') ? 'cobro-in--error' : ''}`}
                  placeholder="Ej: 00123456"
                  autoComplete="off"
                  aria-invalid={mal('numeroCheque') || undefined}
                  value={borrador.numeroCheque ?? ''}
                  onChange={(e) => setBorrador({ ...borrador, numeroCheque: e.target.value })}
                />
                {mal('numeroCheque') && (
                  <span className="cobro-in-err" role="alert">
                    Ingresá el número
                  </span>
                )}
              </div>

              {/* El banco contra el que se libra es una cuenta NUESTRA, así que sale del mismo
                  tablero de configuración que la cuenta de origen de una transferencia —y no del
                  catálogo de bancos de terceros, que es para los cheques que se RECIBEN—. */}
              {campoCuentaPropia('pago-cheque-banco', 'Banco Emisor', 'bancoEmisorId')}

              <span className="cobro-lector-corte" aria-hidden="true" />

              <div className="cobro-form-campo cobro-form-campo--val cobro-campo--fecha">
                <label htmlFor="pago-cheque-emision">
                  Fecha de Emisión
                  <Req />
                </label>
                <input
                  id="pago-cheque-emision"
                  type="date"
                  className={`cobro-in ${mal('fechaEmision') ? 'cobro-in--error' : ''}`}
                  aria-invalid={mal('fechaEmision') || undefined}
                  value={aIso(borrador.fechaEmisionCheque ?? '')}
                  onChange={(e) =>
                    setBorrador({ ...borrador, fechaEmisionCheque: desdeIso(e.target.value) })
                  }
                />
                {mal('fechaEmision') && (
                  <span className="cobro-in-err" role="alert">
                    Ingresá la fecha
                  </span>
                )}
              </div>

              {/* FECHA DE PAGO · el día desde el que el banco paga el cheque. Es la que se carga;
                  en un diferido, la del diferimiento.

                  Regla: no puede quedar antes de hoy. Librar hoy un cheque con fecha de pago pasada
                  es librar uno que no se va a poder depositar. El error se muestra apenas hay una
                  fecha cargada —no hace falta esperar al "+ Agregar" para saber que esa no sirve—. */}
              <div className="cobro-form-campo cobro-form-campo--val cobro-campo--fecha">
                <label htmlFor="pago-cheque-pago">
                  Fecha de Pago
                  <Req />
                </label>
                <input
                  id="pago-cheque-pago"
                  type="date"
                  className={`cobro-in ${mostrarErrorPago ? 'cobro-in--error' : ''}`}
                  aria-invalid={mostrarErrorPago || undefined}
                  aria-describedby={mostrarErrorPago ? 'pago-cheque-pago-err' : undefined}
                  value={aIso(borrador.fechaPagoCheque ?? '')}
                  onChange={(e) =>
                    setBorrador({ ...borrador, fechaPagoCheque: desdeIso(e.target.value) })
                  }
                />
                {mostrarErrorPago && (
                  <span className="cobro-in-err" id="pago-cheque-pago-err" role="alert">
                    {borrador.fechaPagoCheque ? MSG_CHEQUE_PAGO_CORTO : 'Ingresá la fecha'}
                  </span>
                )}
              </div>

              {/* FECHA DE VENC. · derivada, nunca editable: es la de pago más 30 días, que es el
                  plazo que tiene el cheque para presentarse al cobro. Se muestra igual —y no se
                  esconde— porque es lo que decide si el cheque sirve, y el usuario tiene que poder
                  verla antes de agregarlo.

                  Va `readOnly` y no `disabled`: apagado no lo leerían los lectores de pantalla ni se
                  podría copiar, y lo que se busca es que se vea, no que se ignore. */}
              <div className="cobro-form-campo cobro-form-campo--val cobro-campo--fecha">
                <label htmlFor="pago-cheque-venc">Fecha de Venc.</label>
                <input
                  id="pago-cheque-venc"
                  type="date"
                  readOnly
                  tabIndex={-1}
                  className={`cobro-in cobro-in--ro ${chequeEstaVencido ? 'cobro-in--error' : ''}`}
                  aria-invalid={chequeEstaVencido || undefined}
                  aria-describedby={chequeEstaVencido ? 'pago-cheque-venc-err' : undefined}
                  title="Se calcula sola: 30 días después de la fecha de pago"
                  value={aIso(vencimientoCheque)}
                  /* Sin `onChange` React la trataría como no controlada; el campo es de sólo
                     lectura, así que no hay nada que hacer con el evento. */
                  onChange={() => undefined}
                />
                {chequeEstaVencido && (
                  <span className="cobro-in-err" id="pago-cheque-venc-err" role="alert">
                    {MSG_CHEQUE_VENCIDO_CORTO}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TRANSFERENCIA: de qué banco SALE el dinero. Es obligatorio —sin él el movimiento no dice
          de dónde salió—, y sale del mismo tablero de cuentas propias de La Batea. */}
      {(esTransferencia || saliendo === 'transferencia') && (
        <div
          className={`cobro-cond ${saliendo === 'transferencia' ? 'cobro-cond--saliendo' : ''}`}
          key="transferencia"
        >
          <div className="cobro-lector-campos">
            {/* Sólo lo PROPIO de la transferencia: el importe ya se cargó arriba, con el resto de
                las cajas. Es el MISMO selector que el banco emisor de un cheque librado: las dos
                preguntas son "qué cuenta de La Batea interviene". */}
            {campoCuentaPropia(
              'pago-banco-origen',
              'Banco de Origen',
              'bancoOrigenId',
              'cobro-campo--ctatransf pago-campo--banco-origen',
            )}

            {botonAgregar()}
          </div>
        </div>
      )}

      {/* RETENCIÓN · de dónde salió el número. Se muestra el cálculo entero —base, alícuota y el
          descuento mensual si corrió— porque es un importe que el usuario no puede tipear ni
          verificar de otra forma: sin esto, el campo trae una cifra sin explicación. */}
      {esRetencion && !bloqueado && (
        <p className="cobro-form-hint">
          {/* La espera NO se repite acá: ya se ve dentro del campo de importe, que es donde el
              número va a aparecer. */}
          {estadoRetencion === 'error' ? (
            <>
              <i className="fas fa-triangle-exclamation" /> No se pudieron leer los datos de la
              retención.
            </>
          ) : retencion && !esFaltaDeDatos(retencion) && !retencion.ok ? (
            /* Lo único que queda acá es el estado de la OPERACIÓN: que todavía no haya facturas
               elegidas. Los datos que faltan en un tablero y el monto que no llega al mínimo se
               avisan con la VENTANA —los dos frenan la retención y ninguno se arregla desde esta
               pantalla—, y el desglose del cálculo se fue: el número está en su campo. */
            <>
              <i className="fas fa-circle-exclamation" /> {mensajeSinRetencion(retencion).titulo}.
            </>
          ) : null}
        </p>
      )}

      {/* De dónde sale el importe precargado del ANTICIPO. Se dice en vez de dejar que el usuario
          descubra por qué el campo vino lleno. */}
      {esAnticipo && !bloqueado && hayExcedente && (
        <p className="cobro-form-hint">
          <i className="fas fa-circle-info" /> Importe sugerido: lo que se entregó de más. Queda
          como saldo a favor nuestro con el proveedor y lleva la diferencia a $ 0,00.
        </p>
      )}

      {/* Se apretó "+ Agregar" sin marcar ningún cheque. El aviso va acá, al final del formulario,
          que es justo ANTES de la tabla de cajas registradas: es donde el usuario mira después de
          apretar el botón y ver que no pasó nada. Las filas de la cartera se pintan en rojo al
          mismo tiempo, así el mensaje y lo que hay que corregir se leen juntos.

          El renglón se monta SIEMPRE que la cartera esté en pantalla, con o sin mensaje: es lo que
          RESERVA su lugar. Lo que aparece y desaparece es el texto de adentro, así la distancia
          entre la tabla de cheques y la de cajas registradas es la misma haya error o no, y marcar
          un cheque no hace saltar media pantalla. Es el mismo criterio que la franja de avisos del
          registro del cobro (`cobro-card-acts`). */}
      {muestraCartera && (
        <p className="pago-form-error" role="alert">
          {mal('chequesCartera') && (
            <>
              <i className="fas fa-circle-exclamation" /> {MSG_SIN_CHEQUE}
            </>
          )}
        </p>
      )}
      {/* El cálculo no se pudo hacer. Es un problema de DATOS —de la factura de compra o del
          tablero de configuración— y por eso se explica en una ventana, con el valor leído: es lo
          que hace falta para ir a arreglarlo sin adivinar. */}
      {avisoRetencion && (
        <AvisoModal
          titulo={avisoRetencion.titulo}
          /* Qué falta, comprobante por comprobante. `AvisoModal` los lista debajo del mensaje, que
             es exactamente para lo que existe esa prop. Vacío cuando el motivo no es un dato que
             falte, como el mínimo no retenible. */
          faltantes={avisoRetencion.faltantes}
          onClose={() => setAvisoRetencion(null)}
        >
          {avisoRetencion.mensaje}
        </AvisoModal>
      )}
    </fieldset>
  )
}
