import { Fragment, useRef, useState } from 'react'
import {
  CUIT_TRAMOS,
  CUOTAS_CREDITO,
  FORMAS_PAGO,
  MSG_CHEQUE_VENCIMIENTO,
  MSG_CLIENTE_SIN_CHEQUE,
  MSG_NRO_TARJETA,
  cuitCompleto,
  esPagoConTarjeta,
  esRetencion,
  esTarjetaDeCredito,
  formatearNroTarjeta,
  nroTarjetaCompleto,
  partesCuit,
  soloDigitos,
  tramoCuitIncompleto,
  vencimientoChequeInvalido,
} from '@/lib/pagos'
import { aIso, desdeIso } from '@/lib/dates'
import { formatearImporteAR, money } from '@/lib/format'
import { useDispatch } from '@/state/hooks'
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
  bancoTarjeta: '',
  tipoTarjeta: null,
  cuotas: 0,
  numeroTarjeta: '',
  titularTarjeta: '',
  vencimientoTarjeta: '',
  numeroCupon: '',
}

/** Formato del cheque: el valor es el del sistema, el rótulo es el que ve el usuario. */
const FORMATOS_CHEQUE: { valor: FormatoCheque; rotulo: string }[] = [
  { valor: 'FISICO', rotulo: 'Papel' },
  { valor: 'eCheq', rotulo: 'eCheq' },
]

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
  onCambio,
}: {
  valor: string
  /** Se intentó agregar el movimiento: el CUIT incompleto ya no espera al blur para avisar. */
  forzarError: boolean
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
                iMal === i ? 'cobro-in--error' : ''
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
      </div>
      {iMal >= 0 && (
        <span className="cobro-in-err" role="alert">
          {CUIT_TRAMOS[iMal].error}
        </span>
      )}
    </div>
  )
}

interface FormularioCobroProps {
  /** El CRM del cliente no habilita el cheque: el medio se ofrece inhabilitado. */
  chequeBloqueado?: boolean
  /** Lo que falta recibir. Sólo alimenta la ayuda al pie: el importe no se precarga. */
  diferencia: number
  /** Cobro ya registrado: se muestra, no se edita. */
  bloqueado?: boolean
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
export function FormularioCobro({
  chequeBloqueado = false,
  diferencia,
  bloqueado = false,
}: FormularioCobroProps) {
  const dispatch = useDispatch()
  const [borrador, setBorrador] = useState<Borrador>(BORRADOR_VACIO)
  // Texto formateado (miles con punto, coma decimal) del importe del borrador.
  const [importeTexto, setImporteTexto] = useState('')
  // Recién al intentar agregar se muestran los errores: no se reta al usuario mientras carga.
  const [intento, setIntento] = useState(false)

  const esCheque = borrador.formaPago === 'Cheque'
  const esTransferencia = borrador.formaPago === 'Transferencia'
  /* Cualquier medio que empiece con "Retencion" (IVA, IIBB, GAN…) comparte el mismo ramal:
     importe + comprobante adjunto, los dos obligatorios para poder agregar el movimiento. */
  const esRet = esRetencion(borrador.formaPago)
  /* Débito y crédito son dos medios distintos, pero un mismo ramal de carga: los datos del
     plástico. Lo único propio del crédito es el plan de cuotas. */
  const esTarjeta = esPagoConTarjeta(borrador.formaPago)
  const esCredito = esTarjetaDeCredito(borrador.formaPago)

  /* Cuentas propias: las piden la transferencia (cuenta de destino) y la tarjeta (banco de
     acreditación). Se consultan recién cuando uno de esos medios entra en pantalla. */
  const { cuentas, estado: estadoCuentas } = useCuentasPropias(esTransferencia || esTarjeta)

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
    fechaEmision: esCheque && !borrador.fechaEmisionCheque?.trim(),
    vencimiento: esCheque && vencMal,
    // TRANSFERENCIA
    cuenta: esTransferencia && !borrador.cuentaPropiaId,
    comprobanteTransf: esTransferencia && !borrador.comprobanteNombre,
    // RETENCIÓN
    comprobanteRet: esRet && !borrador.comprobanteNombre,
    // TARJETA (débito y crédito)
    titular: esTarjeta && !borrador.titularTarjeta?.trim(),
    bancoTarjeta: esTarjeta && !borrador.bancoTarjeta?.trim(),
    tipoTarjeta: esTarjeta && !borrador.tipoTarjeta,
    /* No alcanza con que el número esté cargado: tiene que tener los 16 dígitos, y por eso lleva
       su propio mensaje. */
    numeroTarjeta: esTarjeta && !nroTarjetaCompleto(borrador.numeroTarjeta),
    vencTarjeta: esTarjeta && !borrador.vencimientoTarjeta,
    comprobanteTarj: esTarjeta && !borrador.comprobanteNombre,
    acreditacion: esTarjeta && !borrador.cuentaPropiaId,
    // Sólo el crédito tiene plan de cuotas.
    cuotas: esCredito && !(borrador.cuotas && borrador.cuotas > 0),
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
  }

  /** Cambiar de forma de pago descarta lo que sólo valía para la anterior. */
  const cambiarForma = (formaPago: FormaPago) => {
    setIntento(false)
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
          {FORMAS_PAGO.map((f) => {
            /* El cheque que el CRM no habilita se sigue VIENDO, pero no se puede elegir: queda
               tachado en rojo y el motivo aparece al pasarle el mouse por encima. */
            const vedado = f === 'Cheque' && chequeBloqueado
            return (
              <option
                key={f}
                value={f}
                disabled={vedado}
                title={vedado ? MSG_CLIENTE_SIN_CHEQUE : undefined}
                className={vedado ? 'cobro-op--vedada' : undefined}
              >
                {f}
              </option>
            )
          })}
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

      {/* CHEQUE · fila 1: datos del emisor y del documento. */}
      {esCheque && (
        <div className="cobro-cond" key="cheque">
          <Fila>
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

            <CampoCuit
              valor={borrador.cuitEmisor ?? ''}
              forzarError={intento && faltantes.cuit}
              onCambio={(cuitEmisor) => setBorrador({ ...borrador, cuitEmisor })}
            />

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
          </Fila>

          {/* CHEQUE · fila 2: las fechas y, a su derecha, el "+ Agregar". */}
          <Fila>
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
            <div className="cobro-form-campo cobro-form-campo--val">
              <label htmlFor="cobro-tarj-titular">
                Titular Tarjeta
                <Req />
              </label>
              <input
                id="cobro-tarj-titular"
                className={`cobro-in ${mal('titular') ? 'cobro-in--error' : ''}`}
                placeholder="Como figura en la tarjeta"
                aria-invalid={mal('titular') || undefined}
                value={borrador.titularTarjeta ?? ''}
                onChange={(e) => setBorrador({ ...borrador, titularTarjeta: e.target.value })}
              />
              {mal('titular') && (
                <span className="cobro-in-err" role="alert">
                  Ingresá el titular de la tarjeta
                </span>
              )}
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

            {/* NRO. TARJETA — se agrupa de a 4 mientras se escribe y exige los 16 dígitos. */}
            <div className="cobro-form-campo cobro-form-campo--val cobro-campo--nrotarj">
              <label htmlFor="cobro-tarj-nro">
                Nro. Tarjeta
                <Req />
              </label>
              <input
                id="cobro-tarj-nro"
                className={`cobro-in ${mal('numeroTarjeta') ? 'cobro-in--error' : ''}`}
                inputMode="numeric"
                autoComplete="off"
                placeholder="XXXX XXXX XXXX XXXX"
                aria-invalid={mal('numeroTarjeta') || undefined}
                value={formatearNroTarjeta(borrador.numeroTarjeta ?? '').texto}
                onChange={(e) =>
                  setBorrador({
                    ...borrador,
                    numeroTarjeta: formatearNroTarjeta(e.target.value).digitos,
                  })
                }
              />
              {mal('numeroTarjeta') && (
                <span className="cobro-in-err" role="alert">
                  {MSG_NRO_TARJETA}
                </span>
              )}
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

            {/* CANT. CUOTAS — sólo crédito: el débito se acredita en un pago. */}
            {esCredito && (
              <div className="cobro-form-campo cobro-form-campo--val cobro-campo--cuotas">
                <label htmlFor="cobro-tarj-cuotas">
                  Cant. Cuotas
                  <Req />
                </label>
                <select
                  id="cobro-tarj-cuotas"
                  className={`cobro-in ${mal('cuotas') ? 'cobro-in--error' : ''}`}
                  aria-invalid={mal('cuotas') || undefined}
                  value={borrador.cuotas || ''}
                  onChange={(e) => setBorrador({ ...borrador, cuotas: Number(e.target.value) || 0 })}
                >
                  <option value="">Seleccionar…</option>
                  {CUOTAS_CREDITO.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                {mal('cuotas') && (
                  <span className="cobro-in-err" role="alert">
                    Elegí la cantidad de cuotas
                  </span>
                )}
              </div>
            )}
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
        </div>
      )}

      {/* Cuánto falta para que la diferencia llegue a 0: es lo que hay que cargar. */}
      {!bloqueado && diferencia > 0 && (
        <p className="cobro-form-hint">
          <i className="fas fa-circle-info" /> Faltan {money(diferencia)} para cubrir el total a
          cancelar.
        </p>
      )}
    </fieldset>
  )
}
