import { useCallback, useMemo, useRef, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { ModalCargando } from '@/components/ui/ModalCargando'
import { generarReciboPdf } from '@/features/documentos/generarDocumentos'
import { LOGO_DOCUMENTOS } from '@/features/documentos/pdf/comun'
import { EnviarDocumento } from '@/features/shared/EnviarDocumento'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { useReemision } from '@/features/shared/useReemision'
import { VerImprimirPdf } from '@/features/shared/VerImprimirPdf'
import { diasPromedioCobro, formatoDiasPromedio } from '@/lib/diasPromedio'
import { saldoConRecibo, type DatosReciboPdf } from '@/lib/documentoComprobante'
import { firmaDe } from '@/lib/firma'
import { descripcionDePaso, etiquetaDePaso, numeroDePaso, pasoAnterior } from '@/lib/pasos'
import { armarRecibo, pagosDeAnticipos } from '@/lib/recibo'
import {
  adjuntarPdfRecibo,
  crearRecibo,
  ErrorRegistroCobro,
  getProximoNroRecibo,
  leerNroRecibo,
  mondayHabilitado,
  reciboCompleto,
  registrarCobro,
  type AvanceRegistroCobro,
  type DatosRecibo,
  type ResultadoRecibo,
} from '@/services/monday'
import { useApp, useDispatch } from '@/state/hooks'
import { DocumentoDesactualizado } from './DocumentoDesactualizado'
import { ReciboAGenerar } from './ReciboAGenerar'
import { ResumenRecibo } from './ResumenRecibo'

/** Qué subelementos faltaron, nombrados como los nombra el recibo. */
export const faltantesRecibo = (datos: DatosRecibo, r: ResultadoRecibo): string[] =>
  [
    r.facturasCreadas < r.facturasEsperadas &&
      `${datos.tipo === 'anticipo' ? 'Línea del anticipo' : 'Facturas canceladas'}: entraron ${r.facturasCreadas} de ${r.facturasEsperadas}`,
    r.pagosCreados < r.pagosEsperados &&
      `Formas de pago y ajustes: entraron ${r.pagosCreados} de ${r.pagosEsperados}`,
  ].filter((x): x is string => typeof x === 'string')

/**
 * Paso 4: el recibo de la cobranza —resumen a la izquierda, documento a la derecha—.
 *
 * Esta etapa NO decide nada: las facturas canceladas y las formas de pago ya quedaron cerradas en
 * los pasos 2 y 3. Son dos momentos separados, igual que el presupuesto de la app de ventas:
 *
 *   1. "Emitir el recibo" genera el PDF EN LA APP, con la plantilla que usaba Make.com y los importes
 *      de la card "Recibo a generar". No toca Monday. "Ver / Imprimir (1)" lo abre y el envío lo
 *      manda a los contactos del cliente por el escenario de Make.
 *   2. "Registrar Cobro" recién ahí escribe en Monday: crea el recibo con sus subitems y, con eso,
 *      en paralelo le sube ese mismo PDF y registra el cobro en cada tablero que impacta —cajas,
 *      cheques, tarjetas, retenciones, facturas, anticipos y la cuenta corriente— (`registrarCobro`).
 */
export function ReciboView() {
  const {
    cliente,
    usuario,
    facturas,
    imputaciones,
    cobro,
    tipoOperacion,
    importeAnticipo,
    detalleAnticipo,
    vencimientoAnticipo,
    anticipos,
    aplicaciones,
    reciboId,
    reciboDoc,
    emision,
    emisionNro,
  } = useApp()
  const dispatch = useDispatch()
  // Aviso al intentar registrar sin haber emitido el recibo.
  const [aviso, setAviso] = useState(false)
  // Aviso al intentar registrar con datos que cambiaron después de emitir.
  const [avisoCambios, setAvisoCambios] = useState(false)
  /* El registro está en vuelo. Mientras tanto el botón se apaga y la pantalla se tapa: es una
     escritura que impacta la cuenta corriente del cliente, y repetirla por un doble click la
     pediría dos veces. */
  const [registrando, setRegistrando] = useState(false)
  /* Lo que "Registrar Cobro" no pudo impactar. Se informa ACÁ y en ningún otro lado: no se escribe
     ningún estado ni update en Monday. El recibo ya está creado; el reintento retoma lo que faltó. */
  const [falloRegistro, setFalloRegistro] = useState<string[] | null>(null)
  /* Monday le dio al recibo otro número que el del PDF enviado (otro recibo le ganó el número entre
     la emisión y el registro). Se avisa antes de cerrar la operación. */
  const [numeroCambiado, setNumeroCambiado] = useState<{ emitido: string; real: string } | null>(null)
  // Los subelementos que no entraron al crear el recibo: el detalle de su ventana.
  const [verIncompleto, setVerIncompleto] = useState(false)
  // Cerrojo sincrónico contra el doble click en "Emitir": entre el click y el re-render hay await.
  const emitiendoRef = useRef(false)

  const esAnticipo = tipoOperacion === 'anticipo'
  const esAplicacion = tipoOperacion === 'aplicacion'

  /* Los anticipos que se imputan, en el orden en que se muestran —no en el que se fueron
     marcando—: así el recibo sale siempre igual para la misma aplicación, con el mismo criterio con
     el que `armarRecibo` recorre las facturas. Fuera de la aplicación no hay ninguno. */
  const anticiposAplicados = useMemo(
    () =>
      esAplicacion
        ? anticipos
            .filter((a) => a.id in aplicaciones)
            .map((a) => ({ id: a.id, nro: a.nombre, importe: aplicaciones[a.id] }))
        : [],
    [esAplicacion, anticipos, aplicaciones],
  )

  /* En una APLICACIÓN las formas de pago del documento son los anticipos imputados: el cliente no
     entrega dinero, cubre las facturas con su saldo a favor. De ahí sale el TOTAL ENTREGADO, que
     por eso coincide con el TOTAL CANCELADO. */
  const recibo = useMemo(
    () =>
      armarRecibo(
        facturas,
        imputaciones,
        cobro.movimientos,
        esAplicacion ? pagosDeAnticipos(anticiposAplicados) : undefined,
      ),
    [facturas, imputaciones, cobro.movimientos, esAplicacion, anticiposAplicados],
  )

  /* En un ANTICIPO no hay facturas que cancelar: lo que el recibo declara es el importe entregado a
     cuenta, así que ése es su TOTAL CANCELADO (el que `armarRecibo` deriva de los comprobantes
     daría 0, que sería decir que el recibo no cancela nada). */
  const totalCancelado = esAnticipo ? importeAnticipo : recibo.totalCancelado

  /* Sale de los comprobantes del recibo, así que se recalcula solo si el usuario vuelve y cambia
     una factura o lo que le cancela. En un anticipo no hay facturas: el renglón no se muestra. */
  const diasPromedio = useMemo(
    () => (esAnticipo ? null : diasPromedioCobro(recibo.comprobantes, cobro.fecha)),
    [esAnticipo, recibo.comprobantes, cobro.fecha],
  )
  const anterior = pasoAnterior('recibo', tipoOperacion)

  /**
   * Lo que "Registrar Cobro" escribe en Monday, armado con lo que hay en pantalla. Se congela al
   * emitir (`reciboDoc.datos`): lo que se registra es lo que dice el PDF.
   */
  const datos = useMemo<DatosRecibo | null>(
    () =>
      cliente
        ? {
            clienteId: cliente.id,
            nombreCliente: cliente.name,
            vendedorId: usuario?.id ?? null,
            tipo: esAnticipo ? 'anticipo' : esAplicacion ? 'aplicacion' : 'cobro',
            /* SÓLO las facturas: los anticipos también figuran entre los comprobantes cancelados
               del documento, pero no son ítems del tablero de facturas y el servicio los arma por su
               cuenta a partir de los movimientos. Mandarlos acá los escribiría dos veces. */
            facturas: recibo.comprobantes
              .filter((c) => !c.esAnticipo)
              .map((c) => ({ id: c.id, nro: c.nro, importe: c.cancelado })),
            /* En una aplicación no hay formas de pago: lo que cubre las facturas son los anticipos. */
            movimientos: esAplicacion ? [] : cobro.movimientos,
            /* Los tres datos del anticipo viajan juntos: describen la misma línea del recibo. */
            anticipo: esAnticipo ? importeAnticipo : undefined,
            detalleAnticipo: esAnticipo ? detalleAnticipo : undefined,
            vencimientoAnticipo: esAnticipo ? vencimientoAnticipo : undefined,
            anticiposAplicados: esAplicacion ? anticiposAplicados : undefined,
            /* La DEUDA de la cuenta ANTES de este recibo: es el mismo "Saldo Cta Cte (deuda)" que la
               ficha del cliente muestra en el paso 1. Con ella se declara cómo queda la cuenta con
               el cobro ya aplicado —en el tablero y en el PDF—. */
            saldoCtaCte: cliente.saldoCtaCte,
          }
        : null,
    [
      cliente,
      usuario,
      esAnticipo,
      esAplicacion,
      recibo.comprobantes,
      cobro.movimientos,
      importeAnticipo,
      detalleAnticipo,
      vencimientoAnticipo,
      anticiposAplicados,
    ],
  )
  /* La huella de lo que el recibo diría HOY. Si no coincide con la del emitido, el usuario volvió y
     cambió algo: el PDF ya no dice lo que se registraría. */
  const firma = useMemo(() => firmaDe({ datos, fecha: cobro.fecha }), [datos, cobro.fecha])
  const desactualizado = reciboDoc !== null && reciboDoc.firma !== firma

  /** Lo que lleva el PDF, con el número que se le pase. Sale de la MISMA card que ve el usuario. */
  const datosPdf = (numero: string): Omit<DatosReciboPdf, 'nombre'> | null =>
    cliente && {
      variante: esAnticipo ? 'anticipo' : esAplicacion ? 'aplicacion' : 'facturas',
      numero,
      fechaEmision: cobro.fecha,
      titular: cliente,
      documento: recibo,
      anticipo: esAnticipo ? { importe: importeAnticipo, vencimiento: vencimientoAnticipo } : null,
      saldoPendiente: saldoConRecibo(cliente.saldoCtaCte, recibo.totalEntregado),
      diasPromedio,
      logoSrc: LOGO_DOCUMENTOS,
    }

  /**
   * "Emitir el recibo": pide el número con el que va a nacer el recibo y genera el PDF con lo que
   * muestra la card. NO escribe en Monday —eso lo hace `registrar`—, así que un error se reintenta
   * sin dejar nada a medias en el tablero, y un recibo ya emitido se puede VOLVER A EMITIR: el PDF
   * nuevo reemplaza al anterior y el envío vuelve a cero (ver `useReemision`).
   *
   * Lo único que no se permite es emitir con el recibo ya creado en Monday, ni dos veces a la vez.
   */
  const emitir = async () => {
    const pdf0 = datosPdf('')
    if (!pdf0 || !datos || reciboId || emitiendoRef.current) return
    emitiendoRef.current = true
    dispatch({ type: 'setEmision', emision: { fase: 'creando', estado: 'Generando PDF', error: null } })
    let numero: string | null = null
    try {
      numero = await getProximoNroRecibo()
      if (!numero) throw new Error('sin número')
    } catch {
      dispatch({
        type: 'setEmision',
        emision: {
          fase: 'error',
          estado: '',
          error: {
            estado: 'No se pudo obtener el número del recibo',
            mensaje: 'No pudimos leer en Monday el número con el que va a salir el recibo. Tocá el botón para reintentar.',
          },
        },
      })
      emitiendoRef.current = false
      return
    }
    try {
      const pdf = await generarReciboPdf({ ...pdf0, numero })
      dispatch({
        type: 'setReciboDoc',
        doc: { numero, fechaEmision: cobro.fecha, pdf, datos, firma, registro: { pdfSubido: false, incompleto: null } },
      })
      dispatch({ type: 'setEmision', emision: { fase: 'emitido', estado: 'Emitido', error: null } })
    } catch (e) {
      console.error('No se pudo generar el PDF del recibo', e)
      dispatch({
        type: 'setEmision',
        emision: {
          fase: 'error',
          estado: '',
          error: {
            estado: 'Error de emisión',
            mensaje:
              'La app no está pudiendo generar el PDF del recibo. Tocá el botón para reintentar; si vuelve a fallar, contactate con el soporte de TAP.',
          },
        },
      })
    } finally {
      emitiendoRef.current = false
    }
  }

  /**
   * "Registrar Cobro": el ÚNICO lugar donde el recibo nace en Monday. Dos tiempos, con la ventana de
   * espera arriba:
   *   1. el recibo con TODOS sus subitems (`crearRecibo`); si alguno no entró, se corta ahí;
   *   2. EN PARALELO: el PDF emitido a su columna file, con el recibo en "Emitido"
   *      (`adjuntarPdfRecibo`), y el registro del cobro en cada tablero (`registrarCobro`) —lo que
   *      antes hacía el escenario de Make—.
   * Recién con los dos confirmados se cierra la operación.
   *
   * Retoma donde quedó: si el recibo ya se creó, un reintento no lo vuelve a crear; si el PDF ya se
   * subió, no lo vuelve a subir; y lo que el registro ya impactó queda anotado y no se repite.
   */
  const registrar = async () => {
    if (!reciboDoc) {
      setAviso(true)
      return
    }
    if (desactualizado) {
      setAvisoCambios(true)
      return
    }
    if (reciboDoc.registro.incompleto) {
      setVerIncompleto(true)
      return
    }
    if (registrando) return
    setRegistrando(true)
    let accion = 'registrar el recibo'
    try {
      let id = reciboId
      let avanceCobro: AvanceRegistroCobro | undefined = reciboDoc.registro.cobro
      if (!id) {
        const creado = await crearRecibo(reciboDoc.datos)
        id = creado.id
        avanceCobro = { lineas: creado.lineas, hechos: {} }
        dispatch({ type: 'setReciboId', id })
        dispatch({ type: 'avanceRegistro', documento: 'recibo', avance: { cobro: avanceCobro } })
        if (!reciboCompleto(creado)) {
          dispatch({
            type: 'avanceRegistro',
            documento: 'recibo',
            avance: { incompleto: faltantesRecibo(reciboDoc.datos, creado) },
          })
          setRegistrando(false)
          setVerIncompleto(true)
          return
        }
      }
      const reciboCreado = id
      const lineas = avanceCobro?.lineas ?? []
      if (mondayHabilitado() && lineas.length === 0) {
        throw new Error('El recibo está creado, pero la app no tiene sus subelementos para registrar el cobro.')
      }

      /* El PDF. El número del PDF era una predicción: si Monday le dio otro, lo que queda en el
         tablero tiene que decir el REAL, así que se regenera con ése antes de subirlo. */
      const subirPdf = async (): Promise<{ emitido: string; real: string } | null> => {
        if (reciboDoc.registro.pdfSubido) return null
        const real = await leerNroRecibo(reciboCreado)
        let pdf = reciboDoc.pdf
        let cambio: { emitido: string; real: string } | null = null
        if (real && real !== reciboDoc.numero) {
          const conReal = datosPdf(real)
          if (conReal) pdf = await generarReciboPdf(conReal)
          cambio = { emitido: reciboDoc.numero, real }
        }
        await adjuntarPdfRecibo(reciboCreado, pdf, reciboDoc.fechaEmision)
        dispatch({ type: 'avanceRegistro', documento: 'recibo', avance: { pdfSubido: true } })
        return cambio
      }

      const [pdf, registro] = await Promise.allSettled([
        subirPdf(),
        registrarCobro(
          {
            reciboId: reciboCreado,
            tipo: reciboDoc.datos.tipo ?? 'cobro',
            clienteId: reciboDoc.datos.clienteId,
            fechaRecibo: reciboDoc.fechaEmision,
            lineas,
          },
          { hechos: { ...(avanceCobro?.hechos ?? {}) } },
          (hechos) =>
            dispatch({
              type: 'avanceRegistro',
              documento: 'recibo',
              avance: { cobro: { lineas, hechos: { ...hechos } } },
            }),
        ),
      ])

      setRegistrando(false)
      if (registro.status === 'rejected') {
        const e: unknown = registro.reason
        setFalloRegistro(
          e instanceof ErrorRegistroCobro
            ? e.fallas
            : [e instanceof Error && e.message.trim() ? e.message : 'Monday no respondió al registrar el cobro.'],
        )
        return
      }
      if (pdf.status === 'rejected') {
        accion = 'subir el PDF del recibo'
        throw pdf.reason
      }
      /* Registro CONFIRMADO: eso cierra la operación. Si el número cambió, antes se avisa. */
      if (pdf.value) {
        setNumeroCambiado(pdf.value)
        return
      }
      dispatch({ type: 'reset' })
    } catch {
      setRegistrando(false)
      // Se puede reintentar y retoma donde quedó.
      dispatch({ type: 'errorMonday', accion })
    }
  }

  /* Reemisión, con el mismo criterio que la app de ventas: el botón de emitir sigue habilitado, y un
     PDF que quedó viejo (se cambiaron datos en un paso anterior) se descarta solo. */
  const descartar = useCallback(() => dispatch({ type: 'descartarEmision', documento: 'recibo' }), [dispatch])
  const { pedirEmision, modal: modalReemision } = useReemision({
    nombre: 'el recibo',
    emitido: reciboDoc !== null,
    firmaEmitida: reciboDoc?.firma ?? null,
    firmaActual: firma,
    creado: reciboId !== null,
    descartar,
    emitir: () => void emitir(),
  })

  return (
    <section className="view recibo-v2 paso-layout">
      <PasoHeader />

      <div className="paso-body">
        <PasoTitulo
          numero={numeroDePaso('recibo', tipoOperacion)}
          titulo={etiquetaDePaso('recibo', tipoOperacion)}
          descripcion={descripcionDePaso('recibo', tipoOperacion)}
        />

        {!cliente ? (
          <div className="card rec-vacio">
            <i className="fas fa-user-slash" /> Todavía no hay un cliente seleccionado. Volvé al
            paso 1 para elegirlo.
          </div>
        ) : (
          <div className="recibo-grid">
            <ResumenRecibo
              cliente={cliente}
              fechaEmision={cobro.fecha}
              totalRecibido={recibo.totalEntregado}
              totalCancelado={totalCancelado}
              diasPromedio={diasPromedio ? formatoDiasPromedio(diasPromedio) : undefined}
              fase={emision.fase}
              error={emision.error}
              onEmitir={pedirEmision}
              bloqueado={reciboId !== null}
            >
              <VerImprimirPdf archivos={reciboDoc ? [reciboDoc.pdf] : null} />
              {desactualizado && reciboId !== null && <DocumentoDesactualizado documento="el recibo" />}
            </ResumenRecibo>

            {/* Columna derecha: el documento y, debajo, su envío al cliente. */}
            <div className="recibo-col-der">
              <ReciboAGenerar
                recibo={recibo}
                fase={emision.fase}
                estado={emision.estado}
                anticipo={esAnticipo ? { importe: importeAnticipo } : null}
              />

              {/* La clave elige el comprobante del catálogo. Intentar enviar sin haber emitido abre
                  su propio aviso: lo resuelve el componente. */}
              {/* Por documento emitido: uno nuevo es otro documento, y el envío arranca de cero. */}
              <EnviarDocumento key={`emision-${emisionNro}`} documento="recibo" />
            </div>
          </div>
        )}

        <div className="actions-footer">
          {/* Volver no descarta nada: el cobro, su imputación y la emisión ya hecha viven en el
              estado global, así que al regresar la etapa se reencuentra tal como quedó. */}
          <button
            type="button"
            className="btn btn-out"
            onClick={() => anterior && dispatch({ type: 'goto', paso: anterior })}
          >
            <i className="fas fa-arrow-left" /> Volver
          </button>

          <div className="actions-footer-fin">
            {/* Registra el cobro en Monday (ítem, subitems, PDF y registro) y cierra la operación.
                Con el recibo sin emitir sigue activo a propósito: la ventana explica por qué no se
                puede registrar, en vez de dejar un botón muerto sin motivo. */}
            <button
              type="button"
              className="btn btn-primary"
              disabled={registrando}
              title={reciboDoc ? undefined : 'Emití el recibo para poder registrar el cobro.'}
              onClick={() => void registrar()}
            >
              <i className="fas fa-flag-checkered" /> Registrar Cobro
            </button>
          </div>
        </div>
      </div>

      {/* Tapa la pantalla desde que se empieza a escribir hasta que el cobro queda registrado.
          Es el MISMO componente con los que la app de operaciones de venta registra un presupuesto. */}
      {registrando && (
        <ModalCargando
          titulo="Registrando cobro en el sistema"
          detalle="Estamos registrando el recibo en el sistema junto a sus formas de pago, sus comprobantes y su PDF. Espera unos segundos y no salgas de la app"
        />
      )}

      {modalReemision}

      {/* El recibo está creado, pero algo del registro no entró. Se nombra qué, y nada se escribe en
          Monday para contarlo: ni estados ni updates. */}
      {falloRegistro && (
        <AvisoModal
          titulo="No se pudo registrar todo el cobro"
          faltantes={falloRegistro}
          onClose={() => setFalloRegistro(null)}
        >
          El recibo quedó creado en Monday, pero esto no se pudo registrar. Tocá{' '}
          <strong>Registrar Cobro</strong> para reintentar: se retoma desde donde se cortó, sin
          duplicar lo que ya quedó registrado. Si vuelve a fallar, contactate con el soporte de TAP.
        </AvisoModal>
      )}

      {numeroCambiado && (
        <AvisoModal
          titulo="El recibo quedó registrado con otro número"
          onClose={() => {
            setNumeroCambiado(null)
            dispatch({ type: 'reset' })
          }}
        >
          El cobro se registró correctamente, pero Monday le asignó el número{' '}
          <strong>{numeroCambiado.real}</strong> y el PDF se había emitido como{' '}
          <strong>{numeroCambiado.emitido}</strong> (otro recibo tomó ese número en el medio). En
          Monday quedó el PDF con el número correcto; si ya se lo enviaste al cliente, reenviáselo
          desde el tablero.
        </AvisoModal>
      )}

      {aviso && (
        <AvisoModal titulo="Todavía no emitiste el recibo" onClose={() => setAviso(false)}>
          El cobro no se puede registrar hasta que se emite su recibo. Emitilo desde el resumen y
          después registrá el cobro.
        </AvisoModal>
      )}

      {avisoCambios && (
        <AvisoModal titulo="El recibo emitido ya no coincide" onClose={() => setAvisoCambios(false)}>
          Cambiaste datos del cobro después de emitir el recibo, así que el PDF ya no dice lo que se
          registraría. Volvé a emitirlo desde el resumen antes de registrar el cobro.
        </AvisoModal>
      )}

      {/* El recibo se creó a medias: se nombra exactamente qué no entró. */}
      {verIncompleto && reciboDoc?.registro.incompleto && (
        <AvisoModal
          titulo="El recibo quedó incompleto"
          faltantes={reciboDoc.registro.incompleto}
          onClose={() => setVerIncompleto(false)}
        >
          El recibo se creó en Monday, pero no entraron todos sus subelementos, así que
          <strong> no se le subió el PDF ni se registró el cobro</strong>: el cobro quedaría
          registrado sin esas líneas. Completalo en el tablero y registralo desde ahí; volver a
          registrarlo desde acá lo duplicaría.
        </AvisoModal>
      )}
    </section>
  )
}
