import { Fragment, useRef, useState } from 'react'
import {
  CUIT_TRAMOS,
  FORMAS_PAGO,
  MSG_CHEQUE_CLIENTE_NO,
  MSG_CHEQUE_VENCIMIENTO,
  validarCuitEmisor,
  cuitCompleto,
  esPagoConTarjeta,
  esRetencion,
  importeSugeridoTarjeta,
  PAGOS_TARJETA,
  partesCuit,
  soloDigitos,
  tramoCuitIncompleto,
  vencimientoChequeInvalido,
} from '@/lib/pagos'
import { aIso, desdeIso } from '@/lib/dates'
import { formatearImporteAR, importeATexto, money } from '@/lib/format'
import { useApp, useDispatch } from '@/state/hooks'
import type { FormaPago, FormatoCheque, MovimientoPago } from '@/types'
import { AdjuntoComprobante } from './AdjuntoComprobante'
import { BancoEmisorSelect } from './BancoEmisorSelect'
import { TipoTarjetaSelect } from './TipoTarjetaSelect'
import { textoCuentasVacio, useCuentasPropias } from './useCuentasPropias'

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
  bancoTarjeta: '',
  tipoTarjeta: null,
  vencimientoTarjeta: '',
  numeroCupon: '',
}

/** Formato del cheque: el valor es el del sistema, el rótulo es el que ve el usuario. */
const FORMATOS_CHEQUE: { valor: FormatoCheque; rotulo: string }[] = [
  { valor: 'FISICO', rotulo: 'Papel' },
  { valor: 'eCheq', rotulo: 'eCheq' },
]

/** En qué quedó la validación del CUIT del emisor: sin validar, validado o rechazado. */
type EstadoCuit = 'pendiente' | 'ok' | 'error'

/** Falta el clic en "Validar": el cheque no se registra con un CUIT sin contrastar. */
const MSG_CUIT_SIN_VALIDAR = 'Validá el CUIT del emisor para poder agregar el cheque'

/** Dígitos del año de la retención: se pide el ejercicio completo (2026), no dos cifras. */
const ANIO_DIGITOS = 4

/** Tope del número de certificado. Holgado: acota el desborde, no la forma del comprobante. */
const NRO_COMPROBANTE_DIGITOS = 20

/** Asterisco rojo que marca un campo obligatorio. */
const Req = () => <span className="cobro-req"> *</span>

/** Un renglón del formulario: agrupa los campos de esa línea. */
const Fila = ({ children }: { children: React.ReactNode }) => (
  <div className="cobro-fila">{children}</div>
)

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
  onValidar,
  onCambio,
}: {
  valor: string
  /** Se intentó agregar el movimiento: el CUIT incompleto ya no espera al blur para avisar. */
  forzarError: boolean
  /** Error de NEGOCIO sobre un CUIT bien escrito, resuelto por la validación contra el cliente. */
  errorExterno?: string
  /** En qué quedó la validación del CUIT: sin validar, validado o rechazado. */
  estado: EstadoCuit
  onValidar: () => void
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
  /* Sin los once dígitos no hay nada que comparar contra el cliente: el botón espera. Ya validado,
     el CUIT queda congelado: no se edita lo que se dio por bueno. */
  const puedeValidar = cuitCompleto(valor) && !validado

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
              disabled={validado}
              value={partes[i]}
              onChange={(e) => escribir(i, e.target.value)}
              onBlur={() => setTocados((prev) => prev.map((v, j) => (j === i ? true : v)))}
            />
          </Fragment>
        ))}

        {/* Validar el CUIT contra el cliente es un paso EXPLÍCITO, y el color del botón es todo el
            feedback: verde con tilde si el cheque se puede registrar, rojo con cruz si es del
            cliente y no le tomamos cheques. */}
        <button
          type="button"
          className={`cobro-cuit-validar ${
            validado
              ? 'cobro-cuit-validar--ok'
              : estado === 'error'
                ? 'cobro-cuit-validar--err'
                : ''
          }`}
          disabled={!puedeValidar}
          aria-label={
            validado ? 'CUIT validado' : estado === 'error' ? 'CUIT rechazado' : 'Validar el CUIT'
          }
          title={
            validado
              ? 'CUIT validado'
              : cuitCompleto(valor)
                ? 'Validar el CUIT contra el cliente'
                : 'Completá los once dígitos del CUIT para validarlo'
          }
          onClick={onValidar}
        >
          {validado ? (
            <i className="fas fa-check" />
          ) : estado === 'error' ? (
            <i className="fas fa-xmark" />
          ) : (
            'Validar'
          )}
        </button>
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
   * Lo que falta cobrar en este momento. Sólo lo usa la TARJETA, para precargar su importe según
   * en cuántos plásticos se parta el cobro (ver `importeSugeridoTarjeta`). Los demás medios no
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
  const { cliente, cobro } = useApp()
  const dispatch = useDispatch()
  const [borrador, setBorrador] = useState<Borrador>(BORRADOR_VACIO)
  // Texto formateado (miles con punto, coma decimal) del importe del borrador.
  const [importeTexto, setImporteTexto] = useState('')
  /* Validación del CUIT del emisor. Vive en el formulario —y no en el campo— porque es lo que
     habilita el alta: sin ese clic, el cheque no entra a la tabla. */
  const [estadoCuit, setEstadoCuit] = useState<EstadoCuit>('pendiente')
  // Recién al intentar agregar se muestran los errores: no se reta al usuario mientras carga.
  const [intento, setIntento] = useState(false)

  const esCheque = borrador.formaPago === 'Cheque'
  const esTransferencia = borrador.formaPago === 'Transferencia'
  /* Cualquier medio que empiece con "Retencion" (IVA, IIBB, GAN…) comparte el mismo ramal:
     importe + comprobante adjunto, los dos obligatorios para poder agregar el movimiento. */
  const esRet = esRetencion(borrador.formaPago)
  /* Débito y crédito son dos medios distintos, pero comparten ramal de carga —los datos del
     plástico— y piden exactamente los mismos campos, incluida la cantidad de pagos. */
  const esTarjeta = esPagoConTarjeta(borrador.formaPago)

  /* --- Cobro con tarjeta partido en dos plásticos ---
     Cuántas tarjetas ya entraron al cobro. Sale de los movimientos ya cargados y no de un contador
     propio: es el mismo dato, y llevarlo aparte sólo abriría la posibilidad de que se desincronice
     al quitar un movimiento de la tabla. */
  const tarjetasCargadas = cobro.movimientos.filter((m) => esPagoConTarjeta(m.formaPago)).length
  const [cantPagos, setCantPagos] = useState<string>(PAGOS_TARJETA[0])
  /* La PRIMERA de dos tarjetas la escribe el usuario: es él quien decide cómo repartir el importe
     entre los dos plásticos, así que arranca vacía en vez de proponerle todo el saldo. */
  const enManual = esTarjeta && cantPagos === '2' && tarjetasCargadas === 0

  /* Precarga del importe de la tarjeta. Se recalcula SÓLO cuando cambia el medio, la cantidad de
     pagos o entra una tarjeta nueva —nunca con la diferencia en vivo—: si dependiera de ella,
     pisaría el importe justo mientras se lo está tipeando.

     La clave vacía fuera de la tarjeta es lo que mantiene intactos a los demás medios: ahí no se
     precarga nada y el usuario escribe cuánto entró. */
  const clavePrecarga = esTarjeta ? `${cantPagos}·${tarjetasCargadas}` : ''
  const [clavePrevia, setClavePrevia] = useState(clavePrecarga)
  if (clavePrevia !== clavePrecarga) {
    setClavePrevia(clavePrecarga)
    if (esTarjeta) {
      const sugerido = importeSugeridoTarjeta(cantPagos, tarjetasCargadas, diferencia)
      setBorrador((b) => ({ ...b, importe: sugerido }))
      setImporteTexto(sugerido > 0 ? importeATexto(sugerido) : '')
    }
  }

  /* Cuentas propias: las piden la transferencia (cuenta de destino) y la tarjeta (banco de
     acreditación). Se consultan recién cuando uno de esos medios entra en pantalla. */
  const { cuentas, estado: estadoCuentas } = useCuentasPropias(esTransferencia || esTarjeta)

  /* El CUIT validado resultó ser del propio cliente y su CRM no le toma cheques. */
  const chequeRechazado = esCheque && estadoCuit === 'error'

  /**
   * Valida el CUIT contra el cliente del paso 1. Rechazado, se BORRA el CUIT cargado: hay que
   * ingresar otro, y dejar a la vista el que no sirve sólo invita a reintentar con el mismo. El
   * mensaje queda hasta que se escriba uno nuevo.
   */
  const validarCuit = () => {
    if (validarCuitEmisor(cliente, borrador.cuitEmisor) === 'ok') {
      setEstadoCuit('ok')
      return
    }
    setEstadoCuit('error')
    setBorrador((b) => ({ ...b, cuitEmisor: '' }))
  }

  const vencMal = esCheque && vencimientoChequeInvalido(borrador.chequeVencimiento)
  /* El vencimiento avisa apenas se carga una fecha que incumple la regla; vacío, recién al intentar
     agregar (que es cuando pasa de "falta cargarlo" a error). */
  const mostrarErrorVenc = vencMal && (!!borrador.chequeVencimiento || intento)
  /* Campos obligatorios del movimiento, por medio de cobro. Cada clave enciende el borde rojo y el
     mensaje de su campo cuando se intenta agregar. */
  const faltantes: Record<string, boolean> = {
    importe: borrador.importe <= 0,
    // CHEQUE
    bancoEmisor: esCheque && !borrador.bancoEmisor?.trim(),
    cuit: esCheque && !cuitCompleto(borrador.cuitEmisor),
    numeroCheque: esCheque && !borrador.numeroCheque?.trim(),
    /* El CUIT tiene que estar VALIDADO antes de agregar el cheque: sin ese clic no se registra,
       ni siquiera con todo lo demás completo. */
    cuitValidado: esCheque && estadoCuit !== 'ok',
    fechaEmision: esCheque && !borrador.fechaEmisionCheque?.trim(),
    vencimiento: esCheque && vencMal,
    // TRANSFERENCIA
    cuenta: esTransferencia && !borrador.cuentaPropiaId,
    comprobanteTransf: esTransferencia && !borrador.comprobanteNombre,
    // RETENCIÓN
    /* El año va completo: con menos de cuatro dígitos no se sabe de qué ejercicio es el
       certificado, así que se pide entero y no "lo que se haya tipeado". */
    anioRet: esRet && (borrador.anioRetencion ?? '').length !== ANIO_DIGITOS,
    nroCompRet: esRet && !borrador.nroComprobanteRetencion?.trim(),
    comprobanteRet: esRet && !borrador.comprobanteNombre,
    // TARJETA (débito y crédito)
    bancoTarjeta: esTarjeta && !borrador.bancoTarjeta?.trim(),
    tipoTarjeta: esTarjeta && !borrador.tipoTarjeta,
    vencTarjeta: esTarjeta && !borrador.vencimientoTarjeta,
    comprobanteTarj: esTarjeta && !borrador.comprobanteNombre,
    acreditacion: esTarjeta && !borrador.cuentaPropiaId,
  }
  const completo = !Object.values(faltantes).some(Boolean)
  const mal = (campo: string) => intento && faltantes[campo]

  const agregar = () => {
    setIntento(true)
    if (!completo || bloqueado) return
    dispatch({ type: 'agregarMovimientoPago', movimiento: borrador })
    setBorrador(BORRADOR_VACIO)
    setImporteTexto('')
    setIntento(false)
    // El próximo cheque trae su propio CUIT: el visto bueno no se hereda.
    setEstadoCuit('pendiente')
  }

  /** Cambiar de forma de pago descarta lo que sólo valía para la anterior. */
  const cambiarForma = (formaPago: FormaPago) => {
    setIntento(false)
    setEstadoCuit('pendiente')
    setBorrador({ ...BORRADOR_VACIO, formaPago, importe: borrador.importe })
  }

  /* Se guarda el archivo además del nombre: el nombre es lo que se muestra, pero la columna `file`
     del recibo sólo se completa subiendo el binario. */
  const tomarArchivo = (f: File | null) =>
    setBorrador({ ...borrador, comprobanteNombre: f?.name ?? '', comprobanteArchivo: f })

  /** Selector de cuenta propia: la misma lista para la transferencia y para la tarjeta. */
  const campoCuentaPropia = (id: string, etiqueta: string, claveError: string) => (
    <div className="cobro-form-campo cobro-form-campo--val cobro-form-campo--cuenta">
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
          Elegí la cuenta bancaria
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
          value={borrador.formaPago}
          onChange={(e) => cambiarForma(e.target.value as FormaPago)}
        >
          {/* El cheque se ofrece SIEMPRE: que al cliente no le tomemos los suyos no impide recibir
              el de un tercero. La restricción se evalúa sobre el CUIT del emisor, más abajo. */}
          {FORMAS_PAGO.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>

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
            Ingresá el importe a cobrar
          </span>
        )}
      </div>

      {/* EFECTIVO: no pide nada más, así que el "+ Agregar" cierra la fila principal. */}
      {!esCheque && !esTransferencia && !esRet && !esTarjeta && botonAgregar()}

      {/* CHEQUE. Dos renglones, en el orden en que se lee el papel que el cliente tiene en la mano:
          primero QUÉ documento es (tipo, número y sus dos fechas) y después QUIÉN responde por él
          (CUIT del emisor, ya validado, y el banco contra el que se libra). */}
      {esCheque && (
        <div className="cobro-cond" key="cheque">
          {/* CHEQUE · fila 1: el documento. */}
          <Fila>
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
                  Ingresá el número de cheque
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
                  setBorrador({ ...borrador, fechaEmisionCheque: desdeIso(e.target.value) })
                }
              />
              {mal('fechaEmision') && (
                <span className="cobro-in-err" role="alert">
                  Ingresá la fecha de emisión
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
                  setBorrador({ ...borrador, chequeVencimiento: desdeIso(e.target.value) })
                }
              />
              {mostrarErrorVenc && (
                <span className="cobro-in-err" id="cobro-cheque-venc-err" role="alert">
                  {borrador.chequeVencimiento
                    ? MSG_CHEQUE_VENCIMIENTO
                    : 'Ingresá la fecha de vencimiento'}
                </span>
              )}
            </div>
          </Fila>

          {/* CHEQUE · fila 2: quién responde por el cheque y, a su derecha, el "+ Agregar". El CUIT
              va ANTES del banco: es el dato que se valida contra el cliente, y de él depende que el
              cheque se pueda registrar. */}
          <Fila>
            <CampoCuit
              valor={borrador.cuitEmisor ?? ''}
              forzarError={intento && faltantes.cuit}
              errorExterno={
                chequeRechazado
                  ? MSG_CHEQUE_CLIENTE_NO
                  : intento && faltantes.cuitValidado && cuitCompleto(borrador.cuitEmisor)
                    ? MSG_CUIT_SIN_VALIDAR
                    : undefined
              }
              estado={estadoCuit}
              onValidar={validarCuit}
              /* Editar el CUIT invalida el visto bueno: era de ESE número, no del campo. */
              onCambio={(cuitEmisor) => {
                setEstadoCuit('pendiente')
                setBorrador({ ...borrador, cuitEmisor })
              }}
            />

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
          </Fila>
        </div>
      )}

      {/* TRANSFERENCIA: cuenta propia de destino + comprobante (drag & drop). */}
      {esTransferencia && (
        <div className="cobro-cond" key="transferencia">
          {campoCuentaPropia('cobro-cuenta', 'Cuenta bancaria', 'cuenta')}

          <div className="cobro-form-campo cobro-form-campo--val cobro-form-campo--drop">
            <label htmlFor="cobro-transf-file">
              Comprobante de transferencia
              <Req />
            </label>
            <AdjuntoComprobante
              id="cobro-transf-file"
              nombre={borrador.comprobanteNombre ?? ''}
              onArchivo={tomarArchivo}
            />
            {mal('comprobanteTransf') && (
              <span className="cobro-in-err" role="alert">
                Adjuntá el comprobante
              </span>
            )}
          </div>

          {botonAgregar()}
        </div>
      )}

      {/* RETENCIÓN (IVA / IIBB / GAN / la que se sume): comprobante adjunto obligatorio. El importe
          se carga en la fila principal; sin archivo, el movimiento no se agrega. */}
      {esRet && (
        <div className="cobro-cond" key="retencion">
          {/* AÑO y NRO DE COMPROBANTE del certificado, a la izquierda del adjunto: son los datos
              con los que la retención se identifica ante el fisco, y el archivo es su respaldo. */}
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
                Ingresá el año con sus cuatro dígitos
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
                Ingresá el número del comprobante
              </span>
            )}
          </div>

          <div className="cobro-form-campo cobro-form-campo--val cobro-form-campo--drop">
            <label htmlFor="cobro-ret-file">
              Comprobante de la retención
              <Req />
            </label>
            <AdjuntoComprobante
              id="cobro-ret-file"
              nombre={borrador.comprobanteNombre ?? ''}
              onArchivo={tomarArchivo}
            />
            {mal('comprobanteRet') && (
              <span className="cobro-in-err" role="alert">
                Adjuntá el comprobante
              </span>
            )}
          </div>

          {botonAgregar()}
        </div>
      )}

      {/* TARJETA (débito / crédito). Dos renglones, en el orden del circuito: primero los datos del
          plástico y después el respaldo del cobro (cupón, comprobante y dónde se acredita). */}
      {esTarjeta && (
        <div className="cobro-cond cobro-cond--tarjeta" key="tarjeta">
          <Fila>
            {/* CANT. PAGOS — para los DOS tipos de tarjeta: el cobro se puede partir en uno o dos
                plásticos. No es un plan de cuotas: es cuántas tarjetas cubren el importe. */}
            <div className="cobro-form-campo cobro-campo--pagos">
              <label htmlFor="cobro-tarj-pagos">Cant. Pagos</label>
              <select
                id="cobro-tarj-pagos"
                className="cobro-in"
                value={cantPagos}
                onChange={(e) => setCantPagos(e.target.value)}
              >
                {PAGOS_TARJETA.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            <div className="cobro-form-campo cobro-form-campo--val">
              <label htmlFor="cobro-tarj-banco">
                Banco Emisor
                <Req />
              </label>
              <BancoEmisorSelect
                id="cobro-tarj-banco"
                value={borrador.bancoTarjeta ?? ''}
                onChange={(banco) => setBorrador({ ...borrador, bancoTarjeta: banco })}
                error={mal('bancoTarjeta')}
              />
            </div>

            <div className="cobro-form-campo cobro-form-campo--val">
              <label htmlFor="cobro-tarj-tipo">
                Tipo Tarjeta
                <Req />
              </label>
              <TipoTarjetaSelect
                id="cobro-tarj-tipo"
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
              <input
                id="cobro-tarj-venc"
                type="date"
                className={`cobro-in ${mal('vencTarjeta') ? 'cobro-in--error' : ''}`}
                aria-invalid={mal('vencTarjeta') || undefined}
                value={aIso(borrador.vencimientoTarjeta ?? '')}
                onChange={(e) =>
                  setBorrador({ ...borrador, vencimientoTarjeta: desdeIso(e.target.value) })
                }
              />
              {mal('vencTarjeta') && (
                <span className="cobro-in-err" role="alert">
                  Ingresá el vencimiento
                </span>
              )}
            </div>
          </Fila>

          <Fila>
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

            <div className="cobro-form-campo cobro-form-campo--val cobro-form-campo--drop cobro-campo--cupon">
              <label htmlFor="cobro-tarj-file">
                Comprobante
                <Req />
              </label>
              <AdjuntoComprobante
                id="cobro-tarj-file"
                nombre={borrador.comprobanteNombre ?? ''}
                onArchivo={tomarArchivo}
              />
              {mal('comprobanteTarj') && (
                <span className="cobro-in-err" role="alert">
                  Adjuntá el comprobante
                </span>
              )}
            </div>

            {/* BANCO DE ACREDITACIÓN: dónde entra la plata (cuentas propias de La Batea). */}
            {campoCuentaPropia('cobro-tarj-acred', 'Banco de Acreditación', 'acreditacion')}

            {botonAgregar()}
          </Fila>

          {/* De dónde sale el importe precargado. Se dice en vez de dejar que el usuario descubra
              por qué el campo vino lleno —o por qué, partiendo en dos, vino vacío—. */}
          {!bloqueado && diferencia > 0 && (
            <p className="cobro-form-hint">
              <i className="fas fa-circle-info" />{' '}
              {enManual
                ? `Cargá el importe de la primera tarjeta; la segunda se precarga con lo que quede (hoy faltan ${money(diferencia)}).`
                : `Importe sugerido: ${money(diferencia)}, lo que falta para cerrar el cobro.`}
            </p>
          )}
        </div>
      )}

    </fieldset>
  )
}
