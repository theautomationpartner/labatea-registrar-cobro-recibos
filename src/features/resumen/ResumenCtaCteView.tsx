import { useCallback, useMemo, useRef, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { ModalCargando } from '@/components/ui/ModalCargando'
import { generarDocumentosCtaCte } from '@/features/documentos/generarDocumentos'
import { LOGO_DOCUMENTOS } from '@/features/documentos/pdf/comun'
import { DescargarExcel } from '@/features/shared/DescargarArchivos'
import { EnviarDocumento } from '@/features/shared/EnviarDocumento'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { useReemision } from '@/features/shared/useReemision'
import { VerImprimirPdf } from '@/features/shared/VerImprimirPdf'
import { hoy, hoyIso } from '@/lib/dates'
import { firmaDe } from '@/lib/firma'
import { descripcionDePaso, etiquetaDePaso, numeroDePaso, pasoAnterior } from '@/lib/pasos'
import { envioDelResumen } from '@/lib/actividadResumen'
import { periodoDelCriterio, rotuloCriterio } from '@/lib/resumenCtaCte'
import {
  AVANCE_REGISTRO_RESUMEN_INICIAL,
  ErrorRegistroResumen,
  registrarResumenCtaCte,
  type AvanceRegistroResumen,
  type DatosRegistroResumen,
  type PasoRegistroResumen,
} from '@/services/monday'

/** Qué dice la ventana de advertencia según el paso en el que se cortó "Registrar Resumen". */
const FALLO_REGISTRO: Record<PasoRegistroResumen, string> = {
  archivos:
    'No se pudieron guardar los archivos del resumen en la cuenta corriente del cliente, así que la actividad del envío no se registró.',
  actividad:
    'Los archivos del resumen se guardaron, pero no se pudo crear la actividad del envío en el timeline del cliente.',
  completar:
    'La actividad del envío se creó en el timeline del cliente, pero no se le pudieron cargar los contactos ni marcarla como completada.',
}
import { criterioResumen } from '@/state/appState'
import { useApp, useDispatch } from '@/state/hooks'
import { FichaResumenCtaCte } from './FichaResumenCtaCte'
import { ResumenCtaCteAGenerar } from './ResumenCtaCteAGenerar'
import { useFacturasAdeudadas } from './useFacturasAdeudadas'
import { useMovimientosCtaCte } from './useMovimientosCtaCte'

/** Qué ventana está abierta, si hay una. */
type Aviso =
  | 'sin-formato'
  | 'sin-periodo'
  | 'cargando'
  | 'fallo'
  | 'sin-cuenta'
  | 'fallo-facturas'
  | 'sin-emitir'
  | 'sin-enviar'
  | 'cambios'

/**
 * RESUMEN DE CTA CTE · paso 2 y último: emitir el resumen, enviárselo al cliente y registrarlo. Misma
 * grilla que la emisión del recibo —la ficha con el botón a la izquierda, el documento y su envío a la
 * derecha—.
 *
 * ACÁ se consulta la cuenta: al entrar a esta etapa salen las dos lecturas que arman los documentos
 * —los movimientos del período y, si el resumen lleva el estado de la cuenta, las facturas que el
 * cliente debe—, con lo elegido en el paso 1.
 *
 * Son dos momentos separados, igual que en el recibo:
 *   1. "Emitir Resumen Cta Cte" genera los archivos EN LA APP —el resumen y, si se incluye, el estado
 *      de cuenta, en PDF y/o Excel— con lo que muestran las cards. No toca Monday.
 *   2. "Registrar Resumen", con el resumen ya ENVIADO, los deja en la cuenta corriente del cliente en
 *      Monday y registra la actividad del envío en su timeline.
 */
export function ResumenCtaCteView() {
  const state = useApp()
  const {
    cliente,
    tipoOperacion,
    movimientosCtaCte,
    mercaderiaPendFacturar,
    ctaCteId,
    ctaCteNro,
    resumenFormato,
    resumenEstadoCtaCte,
    facturasAdeudadas,
    resumenDoc,
    emisionResumen,
    emisionNro,
    documentoEnviado,
    contactos,
    medioEnvio,
    enviadosPorContacto,
  } = state
  const dispatch = useDispatch()

  const criterio = criterioResumen(state)
  const { periodo } = periodoDelCriterio(criterio)
  const incluyeEstado = resumenEstadoCtaCte === 'INCLUIR'
  /* Las dos lecturas de la etapa. Las facturas SÓLO si el resumen las va a mostrar: sin el estado de
     la cuenta no hay documento que las liste. */
  const lectura = useMovimientosCtaCte()
  const facturas = useFacturasAdeudadas(incluyeEstado)

  const [aviso, setAviso] = useState<Aviso | null>(null)
  const [marcarFormato, setMarcarFormato] = useState(false)
  // "Registrar Resumen" en curso: tapa la pantalla con la ventana de espera.
  const [registrando, setRegistrando] = useState(false)
  // "Registrar Resumen" falló: en qué paso, para la ventana de advertencia.
  const [falloRegistro, setFalloRegistro] = useState<PasoRegistroResumen | null>(null)
  // Cerrojo sincrónico contra el doble click en "Emitir".
  const emitiendoRef = useRef(false)

  const anterior = pasoAnterior('resumenCtaCte', tipoOperacion)
  const movimientos = lectura.listo ? movimientosCtaCte : []
  const facturasDelEstado = incluyeEstado && facturas.listo ? facturasAdeudadas : []
  const saldoFinal = movimientos.length > 0 ? movimientos[movimientos.length - 1].saldoFinal : 0
  /* La cuenta se leyó y el cliente no tiene ninguna asignada: no hay sobre qué emitir. */
  const sinCuenta = lectura.listo && ctaCteId === null

  /** Lo que "Registrar Resumen" escribe sobre la cuenta. */
  const clienteId = cliente?.id ?? ''
  const datos = useMemo<DatosRegistroResumen | null>(
    () =>
      ctaCteId && clienteId && resumenFormato && periodo
        ? { ctaCteId, clienteId, formato: resumenFormato, periodo, incluyeEstado }
        : null,
    [ctaCteId, clienteId, resumenFormato, periodo, incluyeEstado],
  )
  /* La huella de lo que los documentos dirían HOY: el pedido y lo leído de la cuenta. Si una lectura
     nueva trae otros movimientos después de emitir, deja de coincidir con la del emitido. */
  const firma = useMemo(
    () => firmaDe({ datos, movimientos, facturas: facturasDelEstado, ctaCteNro }),
    [datos, movimientos, facturasDelEstado, ctaCteNro],
  )
  const desactualizado = resumenDoc !== null && resumenDoc.firma !== firma

  /**
   * "Emitir Resumen Cta Cte": genera los archivos con lo que muestran las cards. No escribe en Monday,
   * así que se puede VOLVER A EMITIR: los archivos nuevos reemplazan a los anteriores y el envío vuelve
   * a cero (ver `useReemision`).
   */
  const emitirResumen = async () => {
    if (emitiendoRef.current || !cliente) return
    /* El formato primero: es el único dato de ESTA etapa, y el que la ficha marca en rojo. */
    if (!resumenFormato) {
      setMarcarFormato(true)
      setAviso('sin-formato')
      return
    }
    /* Después, lo que se trae del paso 1 y de su lectura, en el orden en que puede faltar. */
    if (!periodo) {
      setAviso('sin-periodo')
      return
    }
    if (lectura.cargando || (incluyeEstado && facturas.cargando)) {
      setAviso('cargando')
      return
    }
    if (lectura.fallo) {
      setAviso('fallo')
      return
    }
    if (!ctaCteId || !datos) {
      setAviso('sin-cuenta')
      return
    }
    // El estado de cuenta no se puede armar sin las facturas que el cliente debe.
    if (incluyeEstado && !facturas.listo) {
      setAviso('fallo-facturas')
      return
    }
    emitiendoRef.current = true
    dispatch({ type: 'setEmisionResumen', emision: { fase: 'creando', estado: 'Generando archivos', error: null } })
    try {
      const hoyAhora = hoyIso()
      const titular = { name: cliente.name, cuit: cliente.cuit, addr: cliente.addr }
      const archivos = await generarDocumentosCtaCte({
        formato: resumenFormato,
        incluyeEstado,
        resumen: { cliente: titular, cuentaNro: ctaCteNro, hoy: hoyAhora, periodo, movimientos, logoSrc: LOGO_DOCUMENTOS },
        estado: incluyeEstado
          ? { cliente: titular, cuentaNro: ctaCteNro, hoy: hoyAhora, facturas: facturasDelEstado, logoSrc: LOGO_DOCUMENTOS }
          : undefined,
      })
      dispatch({
        type: 'setResumenDoc',
        doc: {
          // Con qué número se lo identifica en el envío: el de la cuenta.
          numero: ctaCteNro || `Resumen Cta Cte ${cliente.codigo}`,
          fechaEmision: hoy(),
          archivos,
          datos,
          firma,
        },
      })
      dispatch({ type: 'setEmisionResumen', emision: { fase: 'emitido', estado: 'Generado', error: null } })
    } catch (e) {
      console.error('No se pudieron generar los archivos del resumen de cta cte', e)
      dispatch({
        type: 'setEmisionResumen',
        emision: {
          fase: 'error',
          estado: '',
          error: {
            estado: 'Error de emisión',
            mensaje:
              'La app no está pudiendo generar los archivos del resumen. Tocá el botón para reintentar; si vuelve a fallar, contactate con el soporte de TAP.',
          },
        },
      })
    } finally {
      emitiendoRef.current = false
    }
  }

  /* Hasta dónde llegó un registro que se cortó, POR EMISIÓN: el reintento retoma desde ahí —sin
     volver a crear la actividad del timeline— y un resumen nuevo arranca de cero. */
  const avanceRef = useRef<{ doc: typeof resumenDoc; avance: AvanceRegistroResumen }>({
    doc: null,
    avance: AVANCE_REGISTRO_RESUMEN_INICIAL,
  })

  /**
   * "Registrar Resumen": sólo con el resumen EMITIDO y ENVIADO. Deja en la cuenta corriente del
   * cliente los archivos emitidos —y el formato, el período, los contactos y el medio del envío— y
   * registra la actividad del envío en el timeline del cliente, como lo hacía el escenario de Make.
   * Con eso se cierra la operación.
   */
  const registrar = async () => {
    if (!resumenDoc) {
      setAviso('sin-emitir')
      return
    }
    if (desactualizado) {
      setAviso('cambios')
      return
    }
    if (!documentoEnviado) {
      setAviso('sin-enviar')
      return
    }
    if (registrando) return
    setRegistrando(true)
    if (avanceRef.current.doc !== resumenDoc) {
      avanceRef.current = { doc: resumenDoc, avance: AVANCE_REGISTRO_RESUMEN_INICIAL }
    }
    try {
      await registrarResumenCtaCte(
        resumenDoc.datos,
        resumenDoc.archivos,
        envioDelResumen(contactos, medioEnvio, enviadosPorContacto),
        avanceRef.current.avance,
        (avance) => {
          avanceRef.current = { doc: resumenDoc, avance }
        },
      )
      dispatch({ type: 'setResumenCtaCteId', id: resumenDoc.datos.ctaCteId })
      dispatch({ type: 'reset' })
    } catch (e) {
      /* El fallo se informa SÓLO en la app: no se deja update ni se cambia ningún estado en Monday. */
      console.error('No se pudo registrar el resumen de cta cte', e)
      setRegistrando(false)
      setFalloRegistro(e instanceof ErrorRegistroResumen ? e.paso : 'archivos')
    }
  }

  /* Reemisión, con el mismo criterio que la app de ventas: el botón de emitir sigue habilitado, y
     archivos que quedaron viejos (cambió la cuenta o lo pedido) se descartan solos. */
  const descartar = useCallback(() => dispatch({ type: 'descartarEmision', documento: 'resumen' }), [dispatch])
  const { pedirEmision, modal: modalReemision } = useReemision({
    nombre: 'el resumen de cuenta corriente',
    emitido: resumenDoc !== null,
    firmaEmitida: resumenDoc?.firma ?? null,
    firmaActual: firma,
    creado: false,
    descartar,
    emitir: () => void emitirResumen(),
  })

  const pdfs = resumenDoc ? resumenDoc.archivos.filter((a) => a.formato === 'pdf').map((a) => a.archivo) : null
  const excels = resumenDoc ? resumenDoc.archivos.filter((a) => a.formato === 'xlsx').map((a) => a.archivo) : null

  return (
    <section className="view recibo-v2 resumen-v2 paso-layout">
      <PasoHeader />

      <div className="paso-body">
        <PasoTitulo
          numero={numeroDePaso('resumenCtaCte', tipoOperacion)}
          titulo={etiquetaDePaso('resumenCtaCte', tipoOperacion)}
          descripcion={descripcionDePaso('resumenCtaCte', tipoOperacion)}
        />

        {!cliente ? (
          <div className="card rec-vacio">
            <i className="fas fa-user-slash" /> Todavía no hay un cliente seleccionado. Volvé al paso
            1 para elegirlo.
          </div>
        ) : (
          <div className="recibo-grid">
            <FichaResumenCtaCte
              cliente={cliente}
              rotuloPeriodo={rotuloCriterio(criterio)}
              saldoFinal={saldoFinal}
              mercaderiaPendFacturar={lectura.listo ? mercaderiaPendFacturar : 0}
              fase={emisionResumen.fase}
              error={emisionResumen.error}
              marcarFormato={marcarFormato}
              onEmitir={pedirEmision}
            >
              {/* "Ver / Imprimir" abre los PDF y "Descargar Excel" baja los Excel, uno por clic. Cada
                  botón aparece sólo con el formato que lo usa. */}
              {resumenFormato !== 'Excel' && <VerImprimirPdf archivos={pdfs} />}
              {resumenFormato !== 'PDF' && <DescargarExcel archivos={excels} />}
            </FichaResumenCtaCte>

            <div className="recibo-col-der">
              {/* La lectura falló: el documento no se puede armar, y se ofrece volver a intentarla
                  sin salir de la etapa. */}
              {lectura.fallo && (
                <div className="card rec-vacio">
                  <i className="fas fa-triangle-exclamation" /> No se pudieron leer los movimientos
                  de la cuenta corriente.{' '}
                  <button type="button" className="cobro-reintentar" onClick={lectura.reintentar}>
                    Reintentar
                  </button>
                </div>
              )}
              {sinCuenta && (
                <div className="card rec-vacio">
                  <i className="fas fa-circle-exclamation" /> <strong>{cliente.name}</strong> no
                  tiene una cuenta corriente asignada en el tablero de Personas, así que no hay
                  movimientos que resumir.
                </div>
              )}

              <ResumenCtaCteAGenerar
                movimientos={movimientos}
                rotuloPeriodo={rotuloCriterio(criterio)}
                desde={periodo?.desde ?? ''}
                formato={resumenFormato}
                incluyeEstado={incluyeEstado}
                cargandoMovimientos={lectura.cargando}
                facturas={facturasDelEstado}
                cargandoFacturas={facturas.cargando}
                fase={emisionResumen.fase}
                estado={emisionResumen.estado}
              />

              {/* Por documento emitido: uno nuevo es otro documento, y el envío arranca de cero. */}
              <EnviarDocumento key={`emision-${emisionNro}`} documento="resumenCtaCte" />
            </div>
          </div>
        )}

        <div className="actions-footer">
          <button
            type="button"
            className="btn btn-out"
            onClick={() => anterior && dispatch({ type: 'goto', paso: anterior })}
          >
            <i className="fas fa-arrow-left" /> Volver
          </button>
          <div className="actions-footer-fin">
            <button
              type="button"
              className="btn btn-primary"
              /* Sólo con el resumen emitido Y enviado: lo que se registra es la actividad del envío. */
              disabled={registrando || !resumenDoc || !documentoEnviado}
              title={
                !resumenDoc
                  ? 'Emití y enviá el resumen para poder registrarlo.'
                  : !documentoEnviado
                    ? 'Enviá el resumen a los contactos para poder registrarlo.'
                    : undefined
              }
              onClick={() => void registrar()}
            >
              <i className="fas fa-flag-checkered" /> Registrar Resumen
            </button>
          </div>
        </div>
      </div>

      {modalReemision}

      {registrando && (
        <ModalCargando
          titulo="Registrando resumen en el sistema"
          detalle="Estamos guardando el resumen de cuenta corriente en la cuenta del cliente y registrando la actividad del envío. Espera unos segundos y no salgas de la app"
        />
      )}

      {aviso === 'sin-formato' && (
        <AvisoModal titulo="Falta elegir el formato" onClose={() => setAviso(null)}>
          Para emitir el resumen de cuenta corriente tenés que seleccionar en{' '}
          <strong>Formato</strong> si el archivo se genera en Excel, en PDF o en ambos.
        </AvisoModal>
      )}
      {aviso === 'sin-periodo' && (
        <AvisoModal titulo="Falta el período del resumen" onClose={() => setAviso(null)}>
          No hay un período definido para el resumen. Volvé al paso{' '}
          {numeroDePaso('cliente', tipoOperacion)} e indicá qué movimientos de la cuenta corriente
          entran.
        </AvisoModal>
      )}
      {aviso === 'cargando' && (
        <AvisoModal titulo="La cuenta todavía se está cargando" onClose={() => setAviso(null)}>
          Esperá a que terminen de cargarse los movimientos del período
          {incluyeEstado ? ' y los comprobantes pendientes' : ''} y volvé a intentar.
        </AvisoModal>
      )}
      {aviso === 'fallo' && (
        <AvisoModal titulo="No se pudieron leer los movimientos" onClose={() => setAviso(null)}>
          Sin los movimientos de la cuenta corriente no se puede armar el resumen. Usá
          <strong> Reintentar</strong> y, cuando carguen, emitilo.
        </AvisoModal>
      )}
      {aviso === 'fallo-facturas' && (
        <AvisoModal titulo="No se pudieron leer los comprobantes pendientes" onClose={() => setAviso(null)}>
          El resumen se pidió CON el estado de la cuenta corriente, y sin los comprobantes que el
          cliente debe ese documento no se puede armar. Volvé a entrar a la etapa para reintentar la
          lectura.
        </AvisoModal>
      )}
      {aviso === 'sin-cuenta' && (
        <AvisoModal titulo="El cliente no tiene cuenta corriente" onClose={() => setAviso(null)}>
          No hay una cuenta corriente asignada al cliente sobre la cual generar el resumen.
          Asignásela en el tablero de Personas y volvé a reintentar.
        </AvisoModal>
      )}
      {aviso === 'sin-emitir' && (
        <AvisoModal titulo="Todavía no emitiste el resumen" onClose={() => setAviso(null)}>
          El resumen no se puede registrar hasta que se emite. Emitilo desde la ficha y después
          registralo.
        </AvisoModal>
      )}
      {falloRegistro && (
        <AvisoModal titulo="No se pudo registrar la actividad" onClose={() => setFalloRegistro(null)}>
          {FALLO_REGISTRO[falloRegistro]} Tocá <strong>Registrar Resumen</strong> para reintentar: se
          retoma desde donde se cortó, sin duplicar lo que ya quedó hecho. Si vuelve a fallar,
          contactate con el soporte de TAP.
        </AvisoModal>
      )}
      {aviso === 'sin-enviar' && (
        <AvisoModal titulo="Todavía no enviaste el resumen" onClose={() => setAviso(null)}>
          Registrar el resumen deja asentada la actividad de su envío, así que primero tenés que
          enviárselo a los contactos. Tocá <strong>Confirmar y Enviar</strong> y después registralo.
        </AvisoModal>
      )}
      {aviso === 'cambios' && (
        <AvisoModal titulo="El resumen emitido ya no coincide" onClose={() => setAviso(null)}>
          La cuenta corriente cambió después de emitir el resumen, así que sus archivos ya no dicen lo
          que se registraría. Volvé a emitirlo desde la ficha antes de registrarlo.
        </AvisoModal>
      )}
    </section>
  )
}
