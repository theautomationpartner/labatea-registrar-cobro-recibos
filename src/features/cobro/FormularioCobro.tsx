import { Fragment, useEffect, useRef, useState } from 'react'
import {
  CUIT_TRAMOS,
  MEDIOS_COBRO,
  MEDIO_RETENCION,
  retencionDeTipo,
  TIPOS_RETENCION,
  MSG_CHEQUE_CLIENTE_NO,
  MSG_CHEQUE_VENC_CORTO,
  MSG_TARJETA_VENC_CORTO,
  validarCuitEmisor,
  cuitCompleto,
  emisorDelCliente,
  esAnticipoDeCobro,
  esPagoConTarjeta,
  esRetencion,
  partesCuit,
  soloDigitos,
  tramoCuitIncompleto,
  vencimientoChequeInvalido,
  vencimientoTarjetaInvalido,
} from '@/lib/pagos'
import { aIso, desdeIso, manana } from '@/lib/dates'
import { formatearImporteAR, importeATexto, money } from '@/lib/format'
import type { DatosComprobante } from '@/services/make'
import { useApp, useDispatch } from '@/state/hooks'
import type { CuentaPropia, FormaPago, FormatoCheque, MovimientoPago } from '@/types'
import { BancoEmisorSelect } from './BancoEmisorSelect'
import { LectorComprobante, type VolcadoDatos } from './LectorComprobante'
import { TipoTarjetaSelect } from './TipoTarjetaSelect'
import { textoCuentasVacio, useCuentasPropias } from './useCuentasPropias'
import {
  BANCOS_EMISORES_BASE,
  opcionCanonica,
  TIPOS_TARJETA_CREDITO,
  TIPOS_TARJETA_DEBITO,
} from './useOpcionesRecordadas'

type Borrador = Omit<MovimientoPago, 'id'>

const BORRADOR_VACIO: Borrador = {
  formaPago: 'Efectivo',
  importe: 0,
  chequeVencimiento: '',
  numeroCheque: '',
  fechaEmisionCheque: '',
  bancoEmisor: '',
  cuitEmisor: '',
  formatoCheque: 'FISICO',
  cuentaPropia: null,
  cuentaPropiaId: null,
  comprobanteNombre: '',
  comprobanteArchivo: null,
  anioRetencion: '',
  nroComprobanteRetencion: '',
  tipoTarjeta: null,
  vencimientoTarjeta: '',
  numeroCupon: '',
}

/** Formato del cheque: el valor es el del sistema, el rótulo es el que ve el usuario. */
const FORMATOS_CHEQUE: { valor: FormatoCheque; rotulo: string }[] = [
  { valor: 'FISICO', rotulo: 'Papel' },
  { valor: 'eCheq', rotulo: 'eCheq' },
]

/**
 * Cuánto dura el PLEGADO del bloque de un medio de cobro, en ms. Tiene que coincidir con la
 * animación `cobro-cond-out` de `cobro.css`: es el tiempo que el bloque anterior sigue montado
 * después de cambiar de medio, para que se retire en vez de desaparecer de un corte.
 *
 * Son los mismos tiempos que el resto de los plegados de la app (facturas, pagos, recibo).
 */
const MS_SALIDA_RAMAL = 200

/** Ramal de campos que muestra el formulario, o `null` cuando el medio no pide ninguno. */
type Ramal = 'cheque' | 'transferencia' | 'retencion' | 'tarjeta' | null

/**
 * Qué ramal de campos le corresponde a un medio de cobro. Es UNA sola función porque la consultan
 * dos momentos —el que está en pantalla y el que viene— y de compararlos sale si hay que animar:
 * cambiar de "Retencion IVA" a "Retencion IIBB" no mueve un solo campo, así que plegar y desplegar
 * el bloque sería un parpadeo gratuito.
 */
const ramalDe = (forma: string): Ramal => {
  if (forma === 'Cheque') return 'cheque'
  if (forma === 'Transferencia') return 'transferencia'
  if (esRetencion(forma)) return 'retencion'
  if (esPagoConTarjeta(forma as FormaPago)) return 'tarjeta'
  return null
}

/** En qué quedó la validación del CUIT del emisor: sin validar, validado o rechazado. */
type EstadoCuit = 'pendiente' | 'ok' | 'error'

/** Dígitos del año de la retención: se pide el ejercicio completo (2026), no dos cifras. */
const ANIO_DIGITOS = 4

/** Tope del número de certificado. Holgado: acota el desborde, no la forma del comprobante. */
const NRO_COMPROBANTE_DIGITOS = 20

/** Tope del número de operación de una transferencia. Mismo criterio: acota, no da forma. */
const NRO_OPERACION_LARGO = 30

/**
 * Cuenta propia que viene elegida en TODO medio que pregunte dónde se acredita el dinero: la
 * transferencia y las dos tarjetas. Es a la que entra casi siempre, y dejarla elegida ahorra el
 * clic de todos los cobros para pedirlo sólo en la excepción.
 *
 * Se busca por nombre contra el tablero de configuración —no por id, que cambia entre entornos— y
 * se resuelve con la misma tolerancia que el resto: "Banco Credicoop Cta Cte 1234" también es
 * Credicoop.
 */
const CUENTA_ACREDITACION_DEFECTO = 'Credicoop'

/** Lo que se le pide al usuario cuando la lectura del documento no completó un campo obligatorio. */
const MSG_FALTA_LECTURA = 'Completa este dato para poder agregar'

/** Lo que se reclama debajo del selector de impuesto mientras la retención no tiene uno elegido. */
const MSG_FALTA_TIPO_RET = 'Indica el tipo de retención'

/** Lo mismo, dicho dentro del recuadro de carga: ahí lo que importa es por qué no arrancó la lectura. */
const MSG_FALTA_TIPO_RET_LECTOR =
  'Elegí el tipo de retención para procesar el comprobante: es el dato con el que se lee el documento.'

/**
 * ¿Se controla que el certificado lo haya emitido el cliente de la operación?
 *
 * En FALSE la lectura se carga venga de quien venga. Es una llave para PROBAR: permite usar los
 * comprobantes que haya a mano —que casi nunca son del cliente con el que se está probando— sin
 * que la app los rechace antes de mostrar lo que leyó.
 *
 * En producción va en TRUE. Apagada, nada impide que una retención de otro contribuyente entre al
 * recibo: los datos pueden estar perfectos y aun así pertenecer a otra cobranza, y ese es
 * exactamente el error que esta validación existe para atajar.
 */
const VALIDAR_CUIT_EMISOR = true

/**
 * El certificado leído lo emitió OTRO contribuyente: la retención que se está por registrar no es
 * de este cliente.
 *
 * Es la validación que ningún dato del formulario puede reemplazar —el importe, el año y el número
 * pueden estar perfectos y aun así pertenecer a otra cobranza—, así que no se carga NADA: cargar
 * la mitad invitaría a completar el resto a mano sobre un comprobante que no corresponde.
 */
const MSG_OTRO_CLIENTE =
  'El comprobante asignado NO fue emitido por el cliente seleccionado en la operación. Cargá el comprobante emitido que corresponde al cliente seleccionado.'

/**
 * El documento se leyó pero de él no salió el CUIT del emisor. Sin ese dato no se puede decidir si
 * la retención es de este cliente, y la app NO asume: entre cargar datos que podrían ser de otra
 * cobranza y no cargar nada, no cargar nada es lo único correcto.
 */
const MSG_SIN_EMISOR =
  'No se pudo identificar el CUIT del emisor en el comprobante compartido y el documento no se procesó porque no se puede determinar si pertenece al cliente seleccionado. Cargá otro comprobante o ingresá los datos manualmente.'

/**
 * Nombre en pantalla de cada campo obligatorio que puede salir del documento. Con esto el recuadro
 * de carga puede NOMBRAR lo que faltó en vez de decir "faltan datos" y mandar a buscarlos.
 *
 * Sólo están los que la lectura puede completar: los medios que no aplican quedan afuera solos,
 * porque sus claves nunca figuran como faltantes (ver `faltantes`).
 */
const ROTULO_CAMPO: Record<string, string> = {
  importe: 'Importe',
  // CHEQUE
  numeroCheque: 'Nro. de Cheque',
  fechaEmision: 'Fecha de Emisión',
  vencimiento: 'Fecha de Vencimiento',
  cuit: 'CUIT del emisor',
  bancoEmisor: 'Banco Emisor',
  // TRANSFERENCIA
  nroCompTransf: 'Nro de Comprobante',
  // RETENCIÓN
  anioRet: 'Año de la retención',
  nroCompRet: 'Nro de Comprobante',
  // TARJETA
  tipoTarjeta: 'Tipo Tarjeta',
  vencTarjeta: 'Fecha de Venc.',
  acreditacion: 'Banco de Acreditación',
}

/**
 * Faltantes que NO se le reclaman a una lectura incompleta: no son datos del documento sino pasos
 * del usuario —validar el CUIT contra el cliente— o el archivo adjunto en sí, que a esa altura ya
 * está cargado. Marcarlos en rojo apenas termina de leerse el comprobante sería retar por algo que
 * el documento nunca iba a traer.
 */
const AJENOS_A_LA_LECTURA = new Set([
  'cuitValidado',
  /* El rechazo del comprobante se explica DENTRO del recuadro de carga: marcar además un campo del
     formulario diría que el problema está en un dato, cuando el problema es el documento. */
  'comprobanteAjeno',
  /* Datos del cobro con TARJETA que no están en el cupón: el vencimiento del plástico y la cuenta
     donde se acredita. Los declara el usuario, así que marcarlos en rojo apenas termina la lectura
     sería retar por algo que el documento nunca iba a traer. */
  'vencTarjeta',
  'acreditacion',
  /* El impuesto lo declara el usuario ANTES de cargar el certificado: es lo que decide a qué caja
     va el movimiento, y no se lo reclama por una lectura que no tenía por qué traerlo. */
  'tipoRet',
  /* La cuenta de destino la elige el usuario: ningún comprobante dice en qué cuenta de La Batea
     entró el dinero, así que reclamarla apenas termina la lectura sería retar por algo que el
     documento nunca iba a traer. */
  'cuenta',
])

/** Asterisco rojo que marca un campo obligatorio. */
const Req = () => <span className="cobro-req"> *</span>

/**
 * CUIT del emisor del cheque en tres tramos (XX-XXXXXXXX-X). Los campos NO dejan escribir nada que
 * no sea un número ni pasarse del tope de dígitos: la tecla se descarta en silencio, sin mensaje.
 *
 * El cursor AVANZA solo: apenas un tramo se completa (2 dígitos el prefijo, 8 el DNI) el foco salta
 * al siguiente, para cargar el CUIT de corrido sin tocar el mouse ni el tabulador.
 *
 * El tramo corto se avisa cuando el usuario lo dejó (blur) o cuando intentó agregar el movimiento.
 */
function CampoCuit({
  valor,
  forzarError,
  errorExterno,
  estado,
  onCambio,
}: {
  valor: string
  /** Se intentó agregar el movimiento: el CUIT incompleto ya no espera al blur para avisar. */
  forzarError: boolean
  /** Error de NEGOCIO sobre un CUIT bien escrito, resuelto por la validación contra el cliente. */
  errorExterno?: string
  /** En qué quedó la validación del CUIT: sin validar, validado o rechazado. */
  estado: EstadoCuit
  onCambio: (cuit: string) => void
}) {
  const [tocados, setTocados] = useState([false, false, false])
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const partes = partesCuit(valor)

  const escribir = (i: number, entrada: string) => {
    const nuevas = [...partes]
    nuevas[i] = soloDigitos(entrada, CUIT_TRAMOS[i].digitos)
    onCambio(nuevas.join('-'))
    // Tramo completo: el foco pasa al siguiente bloque (el último no tiene a dónde saltar).
    if (nuevas[i].length === CUIT_TRAMOS[i].digitos && i < CUIT_TRAMOS.length - 1) {
      refs.current[i + 1]?.focus()
    }
  }

  /* Primer tramo con menos dígitos de los que pide. Al intentar agregar se marca aunque esté vacío;
     mientras se carga, sólo si ya se lo visitó y tiene algo escrito. */
  const iMal = forzarError
    ? tramoCuitIncompleto(valor)
    : partes.findIndex((p, i) => tocados[i] && p.length > 0 && p.length < CUIT_TRAMOS[i].digitos)

  const validado = estado === 'ok'

  return (
    <div className="cobro-form-campo cobro-form-campo--val cobro-campo--cuit">
      <label htmlFor="cobro-cheque-cuit-0">
        CUIT del emisor
        <Req />
      </label>
      <div className="cobro-cuit">
        {CUIT_TRAMOS.map((t, i) => (
          <Fragment key={t.clave}>
            {/* Separador fijo del formato: es texto, no un carácter que se tipee. */}
            {i > 0 && <span className="cobro-cuit-sep">-</span>}
            <input
              id={`cobro-cheque-cuit-${i}`}
              ref={(el) => {
                refs.current[i] = el
              }}
              className={`cobro-in cobro-cuit-in cobro-cuit-in--${t.digitos} ${
                iMal === i || errorExterno ? 'cobro-in--error' : ''
              }`}
              inputMode="numeric"
              autoComplete="off"
              maxLength={t.digitos}
              placeholder={'0'.repeat(t.digitos)}
              aria-label={t.aria}
              aria-invalid={iMal === i || undefined}
              value={partes[i]}
              onChange={(e) => escribir(i, e.target.value)}
              onBlur={() => setTocados((prev) => prev.map((v, j) => (j === i ? true : v)))}
            />
          </Fragment>
        ))}

        {/* RESULTADO de la validación, no un control: el CUIT se contrasta contra el cliente solo,
            apenas se completan los once dígitos —los tipee el usuario o los traiga la lectura del
            cheque—. El color es todo el feedback: verde con tilde si el cheque se puede registrar,
            rojo con cruz si es del cliente y no le tomamos cheques.

            El recuadro se dibuja SIEMPRE, aunque esté vacío: así los tramos no se corren de lugar
            cuando aparece el resultado. */}
        <span
          className={`cobro-cuit-estado ${
            validado ? 'cobro-cuit-estado--ok' : estado === 'error' ? 'cobro-cuit-estado--err' : ''
          }`}
          role={estado === 'pendiente' ? undefined : 'img'}
          aria-label={
            validado
              ? 'CUIT válido para recibir el cheque'
              : estado === 'error'
                ? 'CUIT rechazado'
                : undefined
          }
        >
          {validado ? (
            <i className="fas fa-check" />
          ) : estado === 'error' ? (
            <i className="fas fa-xmark" />
          ) : null}
        </span>
      </div>
      {/* El tramo incompleto manda: sin un CUIT bien escrito no hay nada que validar contra el
          cliente. */}
      {iMal >= 0 ? (
        <span className="cobro-in-err" role="alert">
          {CUIT_TRAMOS[iMal].error}
        </span>
      ) : (
        errorExterno && (
          <span className="cobro-in-err" role="alert">
            {errorExterno}
          </span>
        )
      )}
    </div>
  )
}

interface FormularioCobroProps {
  /**
   * El formulario se muestra, pero no se edita: el cobro ya quedó registrado, o todavía faltan los
   * datos del anticipo. POR QUÉ está cerrado lo dice la vista, en el renglón de avisos del paso:
   * acá sólo se apaga.
   */
  bloqueado?: boolean
  /**
   * Lo que falta cobrar en este momento. Sólo lo usa la TARJETA, para precargar su importe con lo
   * que quede por cubrir. Los demás medios no
   * precargan nada: se cargan de a uno y el usuario escribe cuánto entró con cada uno.
   */
  diferencia?: number
}

/**
 * Carga de un pago: al agregarlo pasa a la tabla de cobros registrados. Según el medio de cobro
 * pide datos distintos —cheque, transferencia, retención o tarjeta—, que aparecen en una fila
 * condicional debajo de la principal, y el "+ Agregar" queda a la derecha del último campo de esa
 * fila.
 *
 * La validación corre al hacer CLICK en "+ Agregar": marca en rojo cada campo que falte y muestra
 * su mensaje debajo, sin agregar nada. No se deshabilita el botón: así se ve POR QUÉ no se agrega
 * en lugar de toparse con un control muerto.
 */
export function FormularioCobro({ bloqueado = false, diferencia = 0 }: FormularioCobroProps) {
  const { cliente, cobro, tipoOperacion } = useApp()
  const dispatch = useDispatch()
  const [borrador, setBorrador] = useState<Borrador>(BORRADOR_VACIO)
  // Texto formateado (miles con punto, coma decimal) del importe del borrador.
  const [importeTexto, setImporteTexto] = useState('')
  /* Validación del CUIT del emisor. Vive en el formulario —y no en el campo— porque es lo que
     habilita el alta: sin ese clic, el cheque no entra a la tabla. */
  const [estadoCuit, setEstadoCuit] = useState<EstadoCuit>('pendiente')
  // Recién al intentar agregar se muestran los errores: no se reta al usuario mientras carga.
  const [intento, setIntento] = useState(false)
  /**
   * Impuesto elegido en el segundo selector. Vacío mientras no se eligió ninguno, que es como
   * arranca al pasar a "Retencion": el medio dice CÓMO pagaron y este dato QUÉ se retuvo, y sin él
   * el movimiento no se puede registrar —cada impuesto va a una caja distinta del tablero—.
   *
   * Vive aparte del borrador porque el borrador guarda la forma de pago ya compuesta
   * ("Retencion IVA"), y ahí no hay manera de expresar "todavía sin elegir".
   */
  const [tipoRetencion, setTipoRetencion] = useState('')
  /* Ya corrió una lectura sobre este borrador y algo entró. A partir de ahí los campos obligatorios
     que quedaron vacíos se marcan solos: son justamente los que el documento no traía, y esperar al
     clic en "+ Agregar" para decirlo esconde el único trabajo que quedó por hacer. */
  const [revisarLectura, setRevisarLectura] = useState(false)
  /* El documento cargado resultó ser de OTRO: la lectura lo rechazó de plano. Mientras siga
     adjunto, el movimiento no se agrega —aunque los campos se completen a mano—, porque el recibo
     terminaría llevando el comprobante de una operación ajena. Se limpia al cargar otro. */
  const [comprobanteAjeno, setComprobanteAjeno] = useState(false)

  /* Ramal que se está RETIRANDO: el medio ya cambió, pero sus campos siguen montados hasta que
     termina la animación de salida. Sin esto, elegir otro medio los borra de un corte y la card se
     encoge de golpe —que es exactamente lo que se siente brusco cuando el bloque es grande, como el
     del cheque—. */
  const [saliendo, setSaliendo] = useState<Ramal>(null)
  const relojRamal = useRef<ReturnType<typeof setTimeout>>()

  // Al desmontar el formulario no puede quedar un temporizador buscando un ramal que ya no está.
  useEffect(() => () => clearTimeout(relojRamal.current), [])

  const esCheque = borrador.formaPago === 'Cheque'
  const esTransferencia = borrador.formaPago === 'Transferencia'
  /* Cualquier medio que empiece con "Retencion" (IVA, IIBB, GAN…) comparte el mismo ramal:
     importe + comprobante adjunto, los dos obligatorios para poder agregar el movimiento. */
  const esRet = esRetencion(borrador.formaPago)
  /* Débito y crédito son dos medios distintos, pero comparten ramal de carga —los datos del
     plástico— y piden exactamente los mismos campos, incluida la cantidad de pagos. */
  const esTarjeta = esPagoConTarjeta(borrador.formaPago)
  /** El ramal que el medio actual tiene en pantalla. De acá sale cuál se despide al cambiarlo. */
  const ramalActual = ramalDe(borrador.formaPago)
  /* ANTICIPO: el sobrante que queda a favor del cliente cuando lo recibido supera lo que se
     cancela. No trae documento ni datos propios —sólo el importe—, así que se carga como el
     efectivo: importe y "+ Agregar", nada más. */
  const esAnticipoCobro = esAnticipoDeCobro(borrador.formaPago)

  /* Cuándo se OFRECE el anticipo. Son dos condiciones, y las dos por el mismo motivo: el anticipo
     no es una forma de cobrar, es la salida para lo que se recibió DE MÁS.

       · sólo al cancelar ventas pendientes: en el registro de un anticipo todo el recorrido YA es
         uno, y en la aplicación no entra plata nueva que pueda sobrar;
       · sólo con la diferencia NEGATIVA, o sea con lo recibido por encima de lo que se cancela.
         Con la diferencia en cero o a favor no hay sobrante que dejar a cuenta, y ofrecerlo ahí
         invitaría a inventar un saldo que el cliente no entregó.

     La opción se mantiene mientras esté ELEGIDA, aunque la diferencia deje de ser negativa: si
     desapareciera de la lista con el medio puesto, el selector quedaría en blanco mostrando un
     valor que ya no existe entre sus opciones. Agregarla igual no se puede —el importe sugerido
     cae en cero y el alta lo reclama—, así que la salida es cambiar de medio. */
  const hayExcedente = diferencia < 0
  const ofreceAnticipo = tipoOperacion === 'cobro' && (hayExcedente || esAnticipoCobro)
  const mediosDisponibles = MEDIOS_COBRO.filter((m) => !esAnticipoDeCobro(m) || ofreceAnticipo)
  /* Medios que se cargan LEYENDO un documento: todos menos el efectivo. Comparten la disposición
     —el recuadro de carga a la izquierda y sus campos a la derecha— y por eso el importe y el
     "+ Agregar" viajan adentro del bloque en lugar de quedarse en la fila principal. */
  const conLector = esCheque || esTransferencia || esRet || esTarjeta

  /* --- Cobro con tarjeta ---
     Cuántas tarjetas ya entraron al cobro. Sale de los movimientos ya cargados y no de un contador
     propio: es el mismo dato, y llevarlo aparte sólo abriría la posibilidad de que se desincronice
     al quitar un movimiento de la tabla.

     Partir el cobro en dos plásticos no se declara en ninguna parte: se cargan DOS movimientos de
     tarjeta, uno por cada uno. Por eso lo único que hace falta saber es cuántos ya entraron. */
  const tarjetasCargadas = cobro.movimientos.filter((m) => esPagoConTarjeta(m.formaPago)).length

  /* Precarga del importe de la tarjeta con lo que falta para cerrar el cobro. Se recalcula SÓLO
     cuando cambia el medio o entra una tarjeta nueva —nunca con la diferencia en vivo—: si
     dependiera de ella, pisaría el importe justo mientras se lo está tipeando. Así, con dos
     plásticos, el segundo movimiento viene con el resto ya calculado.

     La clave vacía fuera de la tarjeta es lo que mantiene intactos a los demás medios: ahí no se
     precarga nada y el usuario escribe cuánto entró. */
  const clavePrecarga = esTarjeta ? `t${tarjetasCargadas}` : esAnticipoCobro ? 'anticipo' : ''
  const [clavePrevia, setClavePrevia] = useState(clavePrecarga)
  if (clavePrevia !== clavePrecarga) {
    setClavePrevia(clavePrecarga)
    if (clavePrecarga) {
      /* La tarjeta se precarga con lo que FALTA y el anticipo con lo que SOBRA: en los dos casos es
         el número que lleva la diferencia a cero, y en los dos el usuario puede pisarlo. */
      const sugerido = Math.max(esAnticipoCobro ? -diferencia : diferencia, 0)
      setBorrador((b) => ({ ...b, importe: sugerido }))
      setImporteTexto(sugerido > 0 ? importeATexto(sugerido) : '')
    }
  }

  /* Cuentas propias: las piden la transferencia (cuenta de destino) y la tarjeta (banco de
     acreditación). Se consultan recién cuando uno de esos medios entra en pantalla. */
  const { cuentas, estado: estadoCuentas } = useCuentasPropias(esTransferencia || esTarjeta)

  /**
   * Cuenta de acreditación por defecto: la misma para la transferencia y para las dos tarjetas, que
   * son los medios que preguntan dónde entra el dinero.
   *
   * Se aplica cuando el catálogo terminó de cargar y el borrador todavía no tiene cuenta: al
   * cambiar de medio, después de agregar un movimiento o al subir otro documento —los tres limpian
   * el borrador—, la propuesta vuelve sola. Y si el tablero no tiene esa cuenta, no se elige nada:
   * el selector queda en blanco, como antes.
   */
  useEffect(() => {
    if (!esTransferencia && !esTarjeta) return
    if (estadoCuentas !== 'listo' || borrador.cuentaPropiaId) return
    const porDefecto = cuentaPorNombre(CUENTA_ACREDITACION_DEFECTO)
    if (porDefecto) {
      setBorrador((b) => ({ ...b, cuentaPropiaId: porDefecto.id, cuentaPropia: porDefecto.name }))
    }
    /* Depende de que HAYA cuentas y de que falte elegir una; `cuentaPorNombre` se recrea en cada
       render y meterlo acá volvería a correr el efecto todo el tiempo. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esTransferencia, esTarjeta, estadoCuentas, cuentas, borrador.cuentaPropiaId])

  /* El CUIT validado resultó ser del propio cliente y su CRM no le toma cheques. */
  const chequeRechazado = esCheque && estadoCuit === 'error'

  /**
   * Valida el CUIT del emisor contra el cliente del paso 1, SOLA, apenas están los once dígitos.
   *
   * Corre por igual con lo que tipea el usuario y con lo que devuelve la lectura del cheque: el dato
   * es el mismo y la regla también, así que pedir además un clic en "Validar" era un trámite que no
   * agregaba ninguna decisión. Con el CUIT incompleto vuelve a "pendiente": no hay nada que
   * comparar, y un veredicto viejo sobre un número a medio escribir sería mentira.
   *
   * El CUIT rechazado NO se borra: queda a la vista, en rojo, para que se vea cuál fue el que no
   * sirve mientras se escribe otro.
   */
  useEffect(() => {
    if (!esCheque) return
    if (!cuitCompleto(borrador.cuitEmisor)) {
      setEstadoCuit('pendiente')
      return
    }
    setEstadoCuit(validarCuitEmisor(cliente, borrador.cuitEmisor) === 'ok' ? 'ok' : 'error')
  }, [esCheque, borrador.cuitEmisor, cliente])

  /* El vencimiento tiene que ser el día de hoy, el del recibo (ver `MSG_CHEQUE_VENC_CORTO`). Avisa
     apenas se carga una fecha que incumple la regla; vacío, recién al intentar agregar —o cuando la
     lectura del cheque no lo trajo—, que es cuando pasa de "falta cargarlo" a error. */
  const vencMal = esCheque && vencimientoChequeInvalido(borrador.chequeVencimiento)
  const mostrarErrorVenc = vencMal && (!!borrador.chequeVencimiento || intento || revisarLectura)
  /* La tarjeta tiene que seguir VIGENTE: vence después de hoy, nunca hoy mismo ni antes. Avisa con
     el mismo criterio que el cheque —apenas hay una fecha cargada que incumple, o al intentar
     agregar—, para no retar por un campo que todavía está vacío. */
  const vencTarjMal = esTarjeta && vencimientoTarjetaInvalido(borrador.vencimientoTarjeta)
  const mostrarErrorVencTarj =
    vencTarjMal && (!!borrador.vencimientoTarjeta || intento || revisarLectura)
  /* Campos obligatorios del movimiento, por medio de cobro. Cada clave enciende el borde rojo y el
     mensaje de su campo cuando se intenta agregar. */
  const faltantes: Record<string, boolean> = {
    importe: borrador.importe <= 0,
    // CHEQUE
    bancoEmisor: esCheque && !borrador.bancoEmisor?.trim(),
    cuit: esCheque && !cuitCompleto(borrador.cuitEmisor),
    numeroCheque: esCheque && !borrador.numeroCheque?.trim(),
    /* El CUIT rechazado frena el alta aunque todo lo demás esté completo. No se mira "sin validar":
       la validación corre sola con los once dígitos, y que falten los cubre `cuit`. */
    cuitValidado: esCheque && estadoCuit === 'error',
    /* La emisión del cheque se pide cargada y nada más: es la fecha en que lo libró su emisor, y
       puede ser de cualquier día anterior. */
    fechaEmision: esCheque && !borrador.fechaEmisionCheque?.trim(),
    vencimiento: esCheque && vencMal,
    // TRANSFERENCIA
    cuenta: esTransferencia && !borrador.cuentaPropiaId,
    nroCompTransf: esTransferencia && !borrador.nroComprobanteTransferencia?.trim(),
    // RETENCIÓN
    /* El año va completo: con menos de cuatro dígitos no se sabe de qué ejercicio es el
       certificado, así que se pide entero y no "lo que se haya tipeado". */
    /* Sin impuesto elegido no hay caja a la que mandar el movimiento: el medio quedó a medio
       declarar y el alta se frena, aunque el resto esté completo. */
    /* El comprobante adjunto no es de este cliente: hasta reemplazarlo no hay movimiento que
       registrar. El recuadro de carga ya explica por qué, en rojo. */
    comprobanteAjeno,
    tipoRet: esRet && !tipoRetencion,
    anioRet: esRet && (borrador.anioRetencion ?? '').length !== ANIO_DIGITOS,
    nroCompRet: esRet && !borrador.nroComprobanteRetencion?.trim(),
    // TARJETA (débito y crédito)
    tipoTarjeta: esTarjeta && !borrador.tipoTarjeta,
    vencTarjeta: vencTarjMal,
    acreditacion: esTarjeta && !borrador.cuentaPropiaId,
  }
  const completo = !Object.values(faltantes).some(Boolean)

  /**
   * El impuesto está sin elegir y ya hay un certificado esperando. Es lo que RETIENE la lectura: sin
   * ese dato el escenario leería el documento contra el tipo equivocado.
   *
   * Se marca en rojo apenas se carga el documento, sin esperar al "+ Agregar": a esa altura el dato
   * dejó de ser un campo más por completar y pasó a ser lo único que traba el circuito.
   */
  const faltaTipoRetencion = esRet && !tipoRetencion
  const trabaLaLectura = faltaTipoRetencion && !!borrador.comprobanteArchivo

  /* Un campo se marca en rojo al intentar agregar y, además, cuando una lectura ya corrió y no lo
     completó: el usuario no tiene por qué apretar "+ Agregar" para enterarse de que el documento
     no traía el año del certificado. */
  const mal = (campo: string) =>
    (campo === 'tipoRet' && trabaLaLectura) ||
    ((intento || (revisarLectura && !AJENOS_A_LA_LECTURA.has(campo))) && faltantes[campo])

  /** Qué decir debajo de un campo vacío, según por qué se lo está reclamando. */
  const textoFalta = (especifico: string) => (intento ? especifico : MSG_FALTA_LECTURA)

  /**
   * Campos que SÍ se leyeron pero cuyo valor no cumple una regla: el vencimiento del cheque, que
   * tiene que ser el de hoy, y el año del certificado a medio tipear.
   *
   * No son un fallo de la lectura —el dato salió del documento—, así que el recuadro de carga no
   * los nombra: el propio campo ya explica en rojo qué tiene de malo, y decir "no se pudo leer la
   * fecha de vencimiento" sobre una fecha que está a la vista sería mentir.
   */
  const leidoPeroInvalido = (campo: string): boolean =>
    (campo === 'vencimiento' && !!borrador.chequeVencimiento) ||
    (campo === 'anioRet' && !!borrador.anioRetencion)

  /* Campos que la lectura NO completó, con el nombre que tienen en pantalla. Es lo que el recuadro
     de carga muestra en rojo: nombrar lo que falta evita mandar a buscarlo por el formulario. */
  const faltantesTrasLectura = revisarLectura
    ? Object.entries(ROTULO_CAMPO)
        .filter(([campo]) => faltantes[campo] && !leidoPeroInvalido(campo))
        .map(([, rotulo]) => rotulo)
    : []

  const agregar = () => {
    setIntento(true)
    if (!completo || bloqueado) return
    dispatch({ type: 'agregarMovimientoPago', movimiento: borrador })
    /* El formulario queda limpio para el próximo movimiento pero SIGUE en el mismo medio de cobro:
       quien está cargando tres retenciones no eligió "Retencion IVA" para que el selector le vuelva
       solo a Efectivo después de cada una. Lo que se descarta son los DATOS del movimiento ya
       registrado —importe, comprobante, campos del medio—, no la decisión de con qué se está
       cobrando, que es del usuario y él la cambia cuando quiere. */
    setBorrador({ ...BORRADOR_VACIO, formaPago: borrador.formaPago })
    setImporteTexto('')
    setIntento(false)
    /* El medio se conserva, el impuesto NO: dos retenciones seguidas son casi siempre de impuestos
       distintos, y heredar el anterior es la forma más fácil de registrar una con la caja de otra. */
    setTipoRetencion('')
    // El movimiento ya entró: lo que faltaba de aquella lectura dejó de faltar.
    setRevisarLectura(false)
    setComprobanteAjeno(false)
    // El próximo cheque trae su propio CUIT: el visto bueno no se hereda.
    setEstadoCuit('pendiente')
  }

  /** Cambiar de forma de pago descarta lo que sólo valía para la anterior. */
  const cambiarForma = (formaPago: FormaPago) => {
    setIntento(false)
    // Otro medio pide otros campos: lo que faltaba en el anterior ya no significa nada.
    setRevisarLectura(false)
    setComprobanteAjeno(false)
    setEstadoCuit('pendiente')
    setBorrador({ ...BORRADOR_VACIO, formaPago, importe: borrador.importe })
  }

  /**
   * Medio elegido en el primer selector. "Retencion" no es una forma de pago registrable —le falta
   * el impuesto—, así que el borrador arranca con la primera del catálogo como valor de trabajo y
   * el tipo queda VACÍO: hasta que se elija uno, el movimiento no se agrega.
   */
  const cambiarMedio = (medio: string) => {
    /* El ramal que estaba en pantalla se despide antes de irse. Se marca ANTES de tocar el
       borrador: a partir del próximo render el medio ya es otro, así que si no se anotó acá cuál
       era, después no hay forma de saberlo. Sólo se anima cuando el ramal cambia de verdad —pasar
       de "Retencion IVA" a "Retencion IIBB" no mueve nada, y plegarlo y desplegarlo sería un
       parpadeo gratuito—. */
    const proximo = ramalDe(medio === MEDIO_RETENCION ? retencionDeTipo(TIPOS_RETENCION[0]) : medio)
    clearTimeout(relojRamal.current)
    if (ramalActual && ramalActual !== proximo) {
      setSaliendo(ramalActual)
      relojRamal.current = setTimeout(() => setSaliendo(null), MS_SALIDA_RAMAL)
    } else {
      setSaliendo(null)
    }

    if (medio !== MEDIO_RETENCION) {
      setTipoRetencion('')
      cambiarForma(medio as FormaPago)
      return
    }
    setTipoRetencion('')
    cambiarForma(retencionDeTipo(TIPOS_RETENCION[0]))
  }

  /** Elegido el impuesto, la forma de pago queda completa: "IVA" → "Retencion IVA". */
  const elegirTipoRetencion = (tipo: string) => {
    setTipoRetencion(tipo)
    setBorrador((b) => ({ ...b, formaPago: retencionDeTipo(tipo) }))
  }

  /**
   * Toma el comprobante. Se guarda el archivo además del nombre: el nombre es lo que se muestra,
   * pero la columna `file` del recibo sólo se completa subiendo el binario.
   *
   * Un documento NUEVO empieza de cero: se borran todos los campos del medio antes de que corra su
   * lectura. Si no, lo que el documento anterior había traído quedaría mezclado con lo que traiga
   * este —el año de un certificado con el número de otro—, y encima daría por completo un campo que
   * nadie leyó del papel que finalmente se adjunta.
   *
   * QUITAR el comprobante no borra nada: ahí no viene ninguna lectura a rellenar los campos, y
   * llevarse puesto lo que el usuario venía cargando a mano sería una sorpresa desagradable.
   */
  const tomarArchivo = (f: File | null) => {
    if (!f) {
      setBorrador((b) => ({ ...b, comprobanteNombre: '', comprobanteArchivo: null }))
      return
    }
    /* Con qué importe queda el formulario limpio: cero, salvo en la TARJETA, donde el importe no
       sale del cupón sino de cuánto falta para cerrar el cobro. Ahí la sugerencia se vuelve a
       calcular en lugar de perderse. */
    const importe = esTarjeta ? Math.max(diferencia, 0) : 0
    setBorrador((b) => ({
      ...BORRADOR_VACIO,
      formaPago: b.formaPago,
      importe,
      comprobanteNombre: f.name,
      comprobanteArchivo: f,
    }))
    setImporteTexto(importe > 0 ? importeATexto(importe) : '')
    // Se apagan las marcas de la lectura anterior: volverán —o no— cuando esta termine.
    setRevisarLectura(false)
    setComprobanteAjeno(false)
    setIntento(false)
    // El CUIT que se validó era el del cheque anterior: el nuevo tiene que validarse de nuevo.
    setEstadoCuit('pendiente')
  }

  /**
   * Cuenta propia que corresponde al nombre leído del documento. El escenario lee un PAPEL, no el
   * tablero de configuración, así que devuelve un nombre y hay que resolverlo contra el catálogo:
   * primero exacto y después por coincidencia parcial, que es lo que hace calzar un "Galicia Cta
   * Cte" del comprobante con el "Banco Galicia" del tablero.
   *
   * Sin coincidencia NO se elige nada: que el usuario tenga que abrir el selector es mucho mejor
   * que acreditar la plata en la cuenta equivocada.
   */
  const cuentaPorNombre = (nombre: string): CuentaPropia | undefined => {
    const limpiar = (s: string) =>
      s
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
    const buscado = limpiar(nombre)
    if (!buscado) return undefined
    return (
      cuentas.find((c) => limpiar(c.name) === buscado) ??
      /* Parcial sólo con texto suficiente: con dos o tres letras cualquier cuenta "coincide". */
      (buscado.length >= 4
        ? cuentas.find((c) => {
            const nombreCuenta = limpiar(c.name)
            return nombreCuenta.includes(buscado) || buscado.includes(nombreCuenta)
          })
        : undefined)
    )
  }

  /**
   * Qué campos acepta el medio que se está cargando. El importe está SIEMPRE —lo pide la fila
   * principal, cualquiera sea el medio—; el resto son exactamente los inputs que ese ramal muestra.
   *
   * Es lo que ata la lectura a la pantalla: un dato que este medio no tiene dónde mostrar no se
   * guarda en el borrador, porque terminaría viajando al recibo sin que nadie lo haya visto ni
   * podido corregir.
   */
  const camposDelMedio = (): Set<keyof DatosComprobante> => {
    if (esCheque)
      return new Set([
        'importe',
        'numeroCheque',
        'fechaEmisionCheque',
        'chequeVencimiento',
        'bancoEmisor',
        'cuitEmisor',
        'formatoCheque',
      ] as const)
    /* La CUENTA no está: el comprobante de una transferencia dice de dónde salió el dinero, no en
       cuál de las cuentas de La Batea entró. Eso lo elige el usuario. */
    if (esTransferencia) return new Set(['importe', 'nroComprobanteTransferencia'] as const)
    if (esRet)
      return new Set([
        'importe',
        'tipoRetencion',
        'anioRetencion',
        'nroComprobanteRetencion',
      ] as const)
    /* El cupón dice cuánto, con qué plástico y con qué número de operación. NO dice el banco
       emisor, ni el vencimiento de la tarjeta, ni en qué cuenta de La Batea se acredita: esos tres
       los carga el usuario, así que la lectura no los toca ni aunque el escenario los devuelva. */
    if (esTarjeta) return new Set(['importe', 'tipoTarjeta', 'numeroCupon'] as const)
    // Efectivo: sólo el importe, que es todo lo que pide.
    return new Set(['importe'] as const)
  }

  /** Catálogo de tipos de tarjeta del medio que se está cargando: el de débito o el de crédito. */
  const tiposTarjeta =
    borrador.formaPago === 'Tarjeta de crédito' ? TIPOS_TARJETA_CREDITO : TIPOS_TARJETA_DEBITO

  /**
   * Lo que la IA leyó, traducido a la OPCIÓN del catálogo cuando existe. Un "Banco Nacion" leído de
   * un cheque tiene que quedar como el "Banco Nación" que ya está en la lista: escrito tal cual
   * vino, sería una opción nueva en el selector y una etiqueta nueva en Monday —que las crea al
   * vuelo— conviviendo con la que ya existía.
   *
   * Sin coincidencia se respeta lo leído: ahí sí es un banco que el catálogo no tiene.
   */
  const deCatalogo = (valor: string, catalogo: readonly string[]) =>
    opcionCanonica(valor, catalogo) ?? valor

  /**
   * Vuelca sobre el borrador lo que el escenario de Make leyó del comprobante y devuelve CUÁNTOS
   * campos entraron, que es lo que el lector informa arriba.
   *
   * Sólo se escriben los campos que VINIERON y que este medio muestra: lo que el usuario ya cargó a
   * mano sobrevive a la lectura, porque un dato que la IA no encontró no es un dato en blanco.
   *
   * Nada se da por validado: el CUIT leído del cheque sigue necesitando su clic en "Validar" —es la
   * comparación contra el cliente lo que habilita el alta, y eso no lo puede traer un documento—.
   */
  const aplicarDatos = (datos: DatosComprobante): VolcadoDatos => {
    /* RETENCIONES · el certificado tiene que ser del cliente de la operación. La comparación es
       contra el CUIT que la lectura sacó del propio documento, y se hace ANTES de tocar un solo
       campo: si el comprobante es de otro contribuyente, no hay nada suyo que valga la pena cargar.

       Sin CUIT en el cliente no hay contra qué comparar y la validación se saltea, igual que en el
       cheque: la restricción la marca una diferencia comprobada, no la falta del dato. */
    if (VALIDAR_CUIT_EMISOR && (esRet || esTransferencia) && cliente) {
      const veredicto = emisorDelCliente(
        { cuit: datos.cuitEmisor, razonSocial: datos.razonSocialOrigen },
        cliente,
      )
      if (veredicto === 'no-identificado') return { cargados: 0, rechazo: MSG_SIN_EMISOR }
      if (veredicto === 'otro') {
        /* En la TRANSFERENCIA es bloqueante: el dinero salió de una cuenta que no es del cliente,
           así que el comprobante no respalda ESTE cobro por más que sus datos estén completos, y
           mientras siga adjunto el movimiento no se puede agregar. */
        return { cargados: 0, rechazo: MSG_OTRO_CLIENTE, bloqueante: esTransferencia }
      }
    }

    const acepta = camposDelMedio()
    const d = Object.fromEntries(
      Object.entries(datos).filter(
        ([campo, valor]) => valor !== undefined && acepta.has(campo as keyof DatosComprobante),
      ),
    ) as DatosComprobante

    /* El impuesto llega como sigla o como nombre largo ("IIBB", "Ingresos Brutos"): se resuelve
       contra el catálogo y, si no calza con ninguno, se ignora —el tipo lo sigue eligiendo el
       usuario— en vez de inventar una retención que el tablero no tiene. */
    const tipoLeido = d.tipoRetencion ? opcionCanonica(d.tipoRetencion, TIPOS_RETENCION) : undefined

    /* La cuenta llega como nombre y puede no existir en el tablero. Si no se resuelve, no se carga
       nada y tampoco se la cuenta: sería anunciar un campo completo que quedó vacío. */
    const cuenta = d.cuentaPropia ? cuentaPorNombre(d.cuentaPropia) : undefined
    if (d.cuentaPropia && !cuenta) delete d.cuentaPropia

    setBorrador((b) => {
      const s: Borrador = { ...b }
      if (d.importe !== undefined) s.importe = d.importe
      if (d.numeroCheque) s.numeroCheque = d.numeroCheque
      if (d.fechaEmisionCheque) s.fechaEmisionCheque = d.fechaEmisionCheque
      if (d.chequeVencimiento) s.chequeVencimiento = d.chequeVencimiento
      if (d.bancoEmisor) s.bancoEmisor = deCatalogo(d.bancoEmisor, BANCOS_EMISORES_BASE)
      if (d.cuitEmisor) s.cuitEmisor = d.cuitEmisor
      if (d.formatoCheque) s.formatoCheque = d.formatoCheque
      /* El impuesto que reconoció el documento MANDA sobre el que se había declarado: los datos
         que entran son los de ese certificado, y dejarlos bajo otro tipo los mandaría a la caja
         equivocada. El escenario avisa del cambio con una advertencia; acá se acata. */
      if (tipoLeido) s.formaPago = retencionDeTipo(tipoLeido)
      if (d.anioRetencion) s.anioRetencion = d.anioRetencion
      if (d.nroComprobanteRetencion) s.nroComprobanteRetencion = d.nroComprobanteRetencion
      if (d.nroComprobanteTransferencia) {
        s.nroComprobanteTransferencia = d.nroComprobanteTransferencia
      }
      if (d.tipoTarjeta) s.tipoTarjeta = deCatalogo(d.tipoTarjeta, tiposTarjeta)
      if (d.vencimientoTarjeta) s.vencimientoTarjeta = d.vencimientoTarjeta
      if (d.numeroCupon) s.numeroCupon = d.numeroCupon
      if (cuenta) {
        s.cuentaPropiaId = cuenta.id
        s.cuentaPropia = cuenta.name
      }
      return s
    })
    // El importe vive en dos lados: el número del borrador y el texto formateado del input.
    if (tipoLeido) setTipoRetencion(tipoLeido)
    if (d.importe !== undefined) setImporteTexto(d.importe > 0 ? importeATexto(d.importe) : '')
    if (d.cuitEmisor) setEstadoCuit('pendiente')

    const cargados = Object.keys(d).length
    /* Con al menos un dato leído, los obligatorios que sigan vacíos son los que el documento no
       trajo: se marcan en el acto. Sin ningún dato no se marca nada —el recuadro ya avisa que la
       lectura no sirvió, y pintar el formulario entero de rojo encima sería ensañarse—. */
    setRevisarLectura(cargados > 0)
    return { cargados }
  }

  /**
   * Carga automática del comprobante, a la izquierda de los campos del medio. Es OPCIONAL: leerlo
   * ahorra tipear, pero los mismos datos se pueden cargar a mano y el movimiento se registra igual.
   * El documento que se suba queda además adjunto al recibo.
   *
   * NO lleva rótulo arriba, a diferencia del resto de los campos: la consigna está DENTRO del
   * recuadro, y repetirla afuera sería decir dos veces lo mismo sobre el mismo control.
   */
  const campoLector = (idInput: string) => (
    <div className="cobro-form-campo cobro-form-campo--lector">
      <LectorComprobante
        id={idInput}
        formaPago={borrador.formaPago}
        /* El impuesto es el contexto con el que el escenario lee el certificado, así que la lectura
           ESPERA a que se elija: mandarla antes gastaría la llamada para que el documento vuelva
           procesado contra el tipo equivocado. El documento se puede cargar igual —queda en el
           borrador— y la lectura arranca sola en cuanto el impuesto aparece. */
        esperandoPor={faltaTipoRetencion ? MSG_FALTA_TIPO_RET_LECTOR : undefined}
        archivo={borrador.comprobanteArchivo ?? null}
        faltantes={faltantesTrasLectura}
        deshabilitado={bloqueado}
        onArchivo={tomarArchivo}
        onDatos={aplicarDatos}
        onRechazo={setComprobanteAjeno}
      />
    </div>
  )

  /**
   * Importe del cobro. Es una función y no JSX suelto porque cambia de LUGAR según el medio: en las
   * retenciones va al costado del recuadro de carga, con los demás campos que la lectura completa,
   * y en el resto queda en la fila principal, al lado del selector de medio.
   */
  const campoImporte = () => (
    <div className="cobro-form-campo cobro-form-campo--val cobro-form-campo--importe">
      <label htmlFor="cobro-importe">
        Importe
        <Req />
      </label>
      {/* Importe como número con separador de miles (formato AR): "30409" → "30.409"; la coma
          agrega centavos. Se guarda el número en el borrador. */}
      <input
        id="cobro-importe"
        className={`cobro-in ${mal('importe') ? 'cobro-in--error' : ''}`}
        inputMode="decimal"
        placeholder="$ 0"
        aria-invalid={mal('importe') || undefined}
        value={importeTexto}
        onChange={(e) => {
          const { texto, valor } = formatearImporteAR(e.target.value)
          setImporteTexto(texto)
          setBorrador({ ...borrador, importe: valor })
        }}
      />
      {mal('importe') && (
        <span className="cobro-in-err" role="alert">
          {textoFalta('Ingresá el importe')}
        </span>
      )}
    </div>
  )

  /** Selector de cuenta propia: la misma lista para la transferencia y para la tarjeta. */
  const campoCuentaPropia = (id: string, etiqueta: string, claveError: string, clase = '') => (
    <div className={`cobro-form-campo cobro-form-campo--val cobro-form-campo--cuenta ${clase}`}>
      <label htmlFor={id}>
        {etiqueta}
        <Req />
      </label>
      <select
        id={id}
        className={`cobro-in ${mal(claveError) ? 'cobro-in--error' : ''}`}
        disabled={estadoCuentas !== 'listo' || cuentas.length === 0}
        aria-invalid={mal(claveError) || undefined}
        /* El valor del selector es el ID del ítem: es lo que necesita la relación del recibo.
           El nombre se guarda aparte, que es lo que se muestra en el detalle del movimiento. */
        value={borrador.cuentaPropiaId ?? ''}
        onChange={(e) => {
          const elegida = cuentas.find((c) => c.id === e.target.value)
          setBorrador({
            ...borrador,
            cuentaPropiaId: elegida?.id ?? null,
            cuentaPropia: elegida?.name ?? null,
          })
        }}
      >
        <option value="">{textoCuentasVacio(estadoCuentas, cuentas.length)}</option>
        {cuentas.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      {mal(claveError) && (
        <span className="cobro-in-err" role="alert">
          {textoFalta('Elegí la cuenta')}
        </span>
      )}
    </div>
  )

  /* "+ Agregar", siempre a la derecha del último campo de la fila. Valida al hacer click.
     Es una FUNCIÓN que devuelve JSX, no un componente declarado acá adentro: así React reusa el
     mismo botón entre renders en lugar de recrearlo (y perderle el foco). */
  const botonAgregar = () => (
    <div className="cobro-form-campo cobro-form-campo--val cobro-form-campo--accion">
      <button type="button" className="cobro-btn cobro-btn--primary" onClick={agregar}>
        <i className="fas fa-plus" /> Agregar
      </button>
    </div>
  )

  return (
    <fieldset className="cobro-form" disabled={bloqueado}>
      <div className="cobro-form-campo cobro-form-campo--val cobro-form-campo--forma">
        <label htmlFor="cobro-forma">Seleccionar Medio de Cobro</label>
        <select
          id="cobro-forma"
          className="cobro-in"
          /* Las retenciones se muestran TODAS como "Retencion": cuál es se elige al lado. */
          value={esRet ? MEDIO_RETENCION : borrador.formaPago}
          onChange={(e) => cambiarMedio(e.target.value)}
        >
          {/* El cheque se ofrece SIEMPRE: que al cliente no le tomemos los suyos no impide recibir
              el de un tercero. La restricción se evalúa sobre el CUIT del emisor, más abajo. */}
          {mediosDisponibles.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>

      {/* TIPO DE RETENCIÓN, pegado al medio: aparece sólo cuando hace falta y completa la forma de
          pago que se va a registrar. Sin él no se agrega el movimiento (ver `faltantes.tipoRet`). */}
      {esRet && (
        <div className="cobro-form-campo cobro-form-campo--val cobro-campo--tiporet">
          <label htmlFor="cobro-tipo-ret">
            Tipo de Retención
            <Req />
          </label>
          <select
            id="cobro-tipo-ret"
            className={`cobro-in ${mal('tipoRet') ? 'cobro-in--error' : ''}`}
            aria-invalid={mal('tipoRet') || undefined}
            value={tipoRetencion}
            onChange={(e) => elegirTipoRetencion(e.target.value)}
          >
            <option value="" disabled>
              Seleccionar…
            </option>
            {TIPOS_RETENCION.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          {/* Un solo texto, se reclame por la lectura retenida o por el intento de agregar: en los
              dos casos lo que falta es exactamente lo mismo, y cambiar de redacción según el momento
              sólo haría dudar de si son dos problemas distintos. */}
          {mal('tipoRet') && (
            <span className="cobro-in-err" role="alert">
              {MSG_FALTA_TIPO_RET}
            </span>
          )}
        </div>
      )}

      {/* El importe acompaña al selector de medio SÓLO en el efectivo, que no tiene documento que
          leer. En los demás baja al bloque de carga, junto a los campos que la lectura completa. */}
      {!conLector && campoImporte()}

      {/* EFECTIVO: no pide nada más, así que el "+ Agregar" cierra la fila principal. */}
      {!conLector && botonAgregar()}

      {/* CHEQUE. El papel —o el PDF del eCheq— trae TODOS los datos, así que la pantalla se arma
          igual que la de retenciones: el recuadro de carga a la izquierda y, a su derecha, los
          campos que esa lectura completa.

          Van en el orden en que se lee el cheque que el cliente tiene en la mano: cuánto es, QUÉ
          documento es (tipo, número y sus dos fechas) y QUIÉN responde por él (CUIT del emisor, que
          además hay que validar contra el cliente, y el banco contra el que se libra). */}
      {(esCheque || saliendo === 'cheque') && (
        <div
          className={`cobro-cond ${saliendo === 'cheque' ? 'cobro-cond--saliendo' : ''}`}
          key="cheque"
        >
          <div className="cobro-lector-bloque">
            {campoLector('cobro-cheque-lector')}

            <div className="cobro-lector-campos">
              {campoImporte()}

              <div className="cobro-form-campo cobro-form-campo--val cobro-campo--formato">
                <label htmlFor="cobro-cheque-formato">
                  Tipo
                  <Req />
                </label>
                <select
                  id="cobro-cheque-formato"
                  className="cobro-in"
                  value={borrador.formatoCheque ?? 'FISICO'}
                  onChange={(e) =>
                    setBorrador({
                      ...borrador,
                      formatoCheque: e.target.value as FormatoCheque,
                    })
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
                <label htmlFor="cobro-cheque-nro">
                  Nro. de Cheque
                  <Req />
                </label>
                <input
                  id="cobro-cheque-nro"
                  className={`cobro-in ${mal('numeroCheque') ? 'cobro-in--error' : ''}`}
                  placeholder="Ej: 00123456"
                  aria-invalid={mal('numeroCheque') || undefined}
                  value={borrador.numeroCheque ?? ''}
                  onChange={(e) => setBorrador({ ...borrador, numeroCheque: e.target.value })}
                />
                {mal('numeroCheque') && (
                  <span className="cobro-in-err" role="alert">
                    {textoFalta('Ingresá el número')}
                  </span>
                )}
              </div>
              <div className="cobro-form-campo cobro-form-campo--val cobro-campo--fecha">
                <label htmlFor="cobro-cheque-emision">
                  Fecha de Emisión
                  <Req />
                </label>
                <input
                  id="cobro-cheque-emision"
                  type="date"
                  className={`cobro-in ${mal('fechaEmision') ? 'cobro-in--error' : ''}`}
                  aria-invalid={mal('fechaEmision') || undefined}
                  value={aIso(borrador.fechaEmisionCheque ?? '')}
                  onChange={(e) =>
                    setBorrador({
                      ...borrador,
                      fechaEmisionCheque: desdeIso(e.target.value),
                    })
                  }
                />
                {mal('fechaEmision') && (
                  <span className="cobro-in-err" role="alert">
                    {textoFalta('Ingresá la fecha')}
                  </span>
                )}
              </div>

              <div className="cobro-form-campo cobro-form-campo--val cobro-campo--fecha">
                <label htmlFor="cobro-cheque-venc">
                  Fecha de Vencimiento
                  <Req />
                </label>
                {/* Regla: el vencimiento no puede ser posterior a hoy. En error, el campo se pinta de
                  rojo y el mensaje se muestra ABAJO en posición absoluta, dentro del espacio que el
                  campo ya reserva (`--val`): aparecer o desaparecer no mueve ni redimensiona nada. */}
                <input
                  id="cobro-cheque-venc"
                  type="date"
                  className={`cobro-in ${mostrarErrorVenc ? 'cobro-in--error' : ''}`}
                  aria-invalid={mostrarErrorVenc || undefined}
                  aria-describedby={mostrarErrorVenc ? 'cobro-cheque-venc-err' : undefined}
                  value={aIso(borrador.chequeVencimiento)}
                  onChange={(e) =>
                    setBorrador({
                      ...borrador,
                      chequeVencimiento: desdeIso(e.target.value),
                    })
                  }
                />
                {mostrarErrorVenc && (
                  <span className="cobro-in-err" id="cobro-cheque-venc-err" role="alert">
                    {borrador.chequeVencimiento
                      ? MSG_CHEQUE_VENC_CORTO
                      : textoFalta('Ingresá la fecha')}
                  </span>
                )}
              </div>
              {/* El CUIT va ANTES del banco: es el dato que se valida contra el cliente, y de él
                  depende que el cheque se pueda registrar. */}
              <CampoCuit
                valor={borrador.cuitEmisor ?? ''}
                forzarError={mal('cuit')}
                errorExterno={chequeRechazado ? MSG_CHEQUE_CLIENTE_NO : undefined}
                estado={estadoCuit}
                /* El veredicto lo recalcula el efecto de arriba con cada cambio: era de ESE
                   número, no del campo. */
                onCambio={(cuitEmisor) => setBorrador({ ...borrador, cuitEmisor })}
              />

              {/* Corte de renglón: el banco y el "+ Agregar" cierran abajo, en su propia línea. */}
              <span className="cobro-lector-corte" aria-hidden="true" />

              <div className="cobro-form-campo cobro-form-campo--val cobro-campo--banco">
                <label htmlFor="cobro-cheque-banco">
                  Banco Emisor
                  <Req />
                </label>
                <BancoEmisorSelect
                  id="cobro-cheque-banco"
                  value={borrador.bancoEmisor ?? ''}
                  onChange={(banco) => setBorrador({ ...borrador, bancoEmisor: banco })}
                  error={mal('bancoEmisor')}
                />
              </div>

              {botonAgregar()}
            </div>
          </div>
        </div>
      )}

      {/* TRANSFERENCIA: cuenta propia de destino + comprobante (drag & drop). */}
      {(esTransferencia || saliendo === 'transferencia') && (
        <div
          className={`cobro-cond ${saliendo === 'transferencia' ? 'cobro-cond--saliendo' : ''}`}
          key="transferencia"
        >
          <div className="cobro-lector-bloque">
            {campoLector('cobro-transf-lector')}

            <div className="cobro-lector-campos">
              {campoImporte()}

              {/* NRO DE COMPROBANTE: el número de la operación bancaria, que es con lo que después
                  se concilia el movimiento contra el extracto. Sale del mismo comprobante que se
                  carga al lado, así que lo completa la lectura. */}
              <div className="cobro-form-campo cobro-form-campo--val cobro-campo--nrotransf">
                <label htmlFor="cobro-transf-nro">
                  Nro de Comprobante
                  <Req />
                </label>
                <input
                  id="cobro-transf-nro"
                  className={`cobro-in ${mal('nroCompTransf') ? 'cobro-in--error' : ''}`}
                  autoComplete="off"
                  placeholder="Nro de la operación"
                  maxLength={NRO_OPERACION_LARGO}
                  aria-invalid={mal('nroCompTransf') || undefined}
                  value={borrador.nroComprobanteTransferencia ?? ''}
                  /* Se acepta TAL CUAL: su columna en el tablero es de texto, y un número de
                     operación bancaria puede llevar letras o guiones que son parte del dato. */
                  onChange={(e) =>
                    setBorrador({
                      ...borrador,
                      nroComprobanteTransferencia: e.target.value.slice(0, NRO_OPERACION_LARGO),
                    })
                  }
                />
                {mal('nroCompTransf') && (
                  <span className="cobro-in-err" role="alert">
                    {textoFalta('Ingresá el número')}
                  </span>
                )}
              </div>

              {/* Corte de renglón: la cuenta cierra abajo, con su ancho de siempre. La elige el
                  USUARIO —es una decisión de La Batea, no un dato del papel—, así que va separada
                  de los campos que la lectura completa sola. */}
              <span className="cobro-lector-corte" aria-hidden="true" />

              {campoCuentaPropia(
                'cobro-cuenta',
                'Cuenta de Acreditación',
                'cuenta',
                'cobro-campo--ctatransf',
              )}

              {botonAgregar()}
            </div>
          </div>
        </div>
      )}

      {/* RETENCIÓN (IVA / IIBB / GAN / la que se sume). El certificado es a la vez el respaldo del
          movimiento y la FUENTE de sus tres datos, así que la pantalla lo dice en ese orden: el
          recuadro de carga a la izquierda y, a su derecha, los campos que esa lectura completa.
          No hay campo de "Comprobante" aparte: el archivo se sube una sola vez, acá. */}
      {(esRet || saliendo === 'retencion') && (
        <div
          className={`cobro-cond ${saliendo === 'retencion' ? 'cobro-cond--saliendo' : ''}`}
          key="retencion"
        >
          <div className="cobro-lector-bloque">
            {campoLector('cobro-ret-lector')}

            <div className="cobro-lector-campos">
              {campoImporte()}

              {/* AÑO y NRO DE COMPROBANTE del certificado: son los datos con los que la retención se
              identifica ante el fisco, y el archivo de al lado es su respaldo. */}
              <div className="cobro-form-campo cobro-form-campo--val cobro-campo--anio">
                <label htmlFor="cobro-ret-anio">
                  Año de la retención
                  <Req />
                </label>
                <input
                  id="cobro-ret-anio"
                  className={`cobro-in ${mal('anioRet') ? 'cobro-in--error' : ''}`}
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={ANIO_DIGITOS}
                  placeholder="AAAA"
                  aria-invalid={mal('anioRet') || undefined}
                  value={borrador.anioRetencion ?? ''}
                  /* Sólo dígitos y nunca más de cuatro: lo que no cumple no entra, sin mensaje. */
                  onChange={(e) =>
                    setBorrador({
                      ...borrador,
                      anioRetencion: soloDigitos(e.target.value, ANIO_DIGITOS),
                    })
                  }
                />
                {mal('anioRet') && (
                  <span className="cobro-in-err" role="alert">
                    {textoFalta('Ingresá el año (4 dígitos)')}
                  </span>
                )}
              </div>

              <div className="cobro-form-campo cobro-form-campo--val cobro-campo--nroret">
                <label htmlFor="cobro-ret-nro">
                  Nro de Comprobante
                  <Req />
                </label>
                <input
                  id="cobro-ret-nro"
                  className={`cobro-in ${mal('nroCompRet') ? 'cobro-in--error' : ''}`}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="Nro del certificado"
                  aria-invalid={mal('nroCompRet') || undefined}
                  value={borrador.nroComprobanteRetencion ?? ''}
                  /* Sólo dígitos: la columna del tablero es NUMÉRICA, así que una letra tipeada acá
                 haría fallar la creación del subelemento entero. Lo que no es número no entra. */
                  onChange={(e) =>
                    setBorrador({
                      ...borrador,
                      nroComprobanteRetencion: soloDigitos(e.target.value, NRO_COMPROBANTE_DIGITOS),
                    })
                  }
                />
                {mal('nroCompRet') && (
                  <span className="cobro-in-err" role="alert">
                    {textoFalta('Ingresá el número')}
                  </span>
                )}
              </div>

              {botonAgregar()}
            </div>
          </div>
        </div>
      )}

      {/* TARJETA (débito / crédito). Misma disposición que los demás medios que se cargan leyendo
          un documento: el cupón a la izquierda y, a su derecha, los campos que esa lectura
          completa, en el orden del circuito —cuánto, con qué plástico y dónde se acredita—. */}
      {(esTarjeta || saliendo === 'tarjeta') && (
        <div
          className={`cobro-cond cobro-cond--tarjeta ${saliendo === 'tarjeta' ? 'cobro-cond--saliendo' : ''}`}
          key="tarjeta"
        >
          <div className="cobro-lector-bloque">
            {campoLector('cobro-tarj-lector')}

            <div className="cobro-lector-campos">
              {campoImporte()}

              <div className="cobro-form-campo cobro-form-campo--val">
                <label htmlFor="cobro-tarj-tipo">
                  Tipo Tarjeta
                  <Req />
                </label>
                <TipoTarjetaSelect
                  id="cobro-tarj-tipo"
                  formaPago={borrador.formaPago}
                  value={borrador.tipoTarjeta ?? ''}
                  onChange={(tipo) => setBorrador({ ...borrador, tipoTarjeta: tipo || null })}
                  error={mal('tipoTarjeta')}
                />
              </div>

              <div className="cobro-form-campo cobro-form-campo--val cobro-campo--fecha">
                <label htmlFor="cobro-tarj-venc">
                  Fecha de Venc.
                  <Req />
                </label>
                {/* `min` es el día DESPUÉS de hoy: el calendario ya no ofrece fechas vencidas, así
                  que el error queda para lo que el picker no puede frenar —una fecha tipeada a mano
                  o traída por la lectura del comprobante—. */}
                <input
                  id="cobro-tarj-venc"
                  type="date"
                  min={aIso(manana())}
                  className={`cobro-in ${mostrarErrorVencTarj ? 'cobro-in--error' : ''}`}
                  aria-invalid={mostrarErrorVencTarj || undefined}
                  aria-describedby={mostrarErrorVencTarj ? 'cobro-tarj-venc-err' : undefined}
                  value={aIso(borrador.vencimientoTarjeta ?? '')}
                  onChange={(e) =>
                    setBorrador({
                      ...borrador,
                      vencimientoTarjeta: desdeIso(e.target.value),
                    })
                  }
                />
                {mostrarErrorVencTarj && (
                  <span className="cobro-in-err" id="cobro-tarj-venc-err" role="alert">
                    {borrador.vencimientoTarjeta
                      ? MSG_TARJETA_VENC_CORTO
                      : textoFalta('Ingresá el vencimiento')}
                  </span>
                )}
              </div>

              {/* NRO CUPÓN — el número que imprime el posnet. Va a la izquierda del comprobante: es
                el dato del mismo papel que se adjunta al lado. */}
              <div className="cobro-form-campo cobro-form-campo--val cobro-campo--nrocupon">
                <label htmlFor="cobro-tarj-cupon">Nro Cupon</label>
                <input
                  id="cobro-tarj-cupon"
                  className="cobro-in"
                  autoComplete="off"
                  value={borrador.numeroCupon ?? ''}
                  onChange={(e) => setBorrador({ ...borrador, numeroCupon: e.target.value })}
                />
              </div>

              {/* BANCO DE ACREDITACIÓN: dónde entra la plata (cuentas propias de La Batea). */}
              {campoCuentaPropia('cobro-tarj-acred', 'Banco de Acreditación', 'acreditacion')}

              {botonAgregar()}
            </div>
          </div>

          {/* De dónde sale el importe precargado. Se dice en vez de dejar que el usuario descubra
              por qué el campo vino lleno. */}
          {!bloqueado && diferencia > 0 && (
            <p className="cobro-form-hint">
              <i className="fas fa-circle-info" /> Importe sugerido: {money(diferencia)}, lo que
              falta para cerrar el cobro. Si el cobro se parte en dos tarjetas, ajustá este importe
              y cargá la otra como un movimiento aparte.
            </p>
          )}
        </div>
      )}
    </fieldset>
  )
}
