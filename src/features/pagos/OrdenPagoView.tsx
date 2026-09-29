import { useCallback, useMemo, useRef, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { ModalCargando } from '@/components/ui/ModalCargando'
import { generarConstanciaRetencionPdf, generarOrdenPagoPdf } from '@/features/documentos/generarDocumentos'
import { LOGO_DOCUMENTOS } from '@/features/documentos/pdf/comun'
import { DocumentoDesactualizado } from '@/features/recibo/DocumentoDesactualizado'
import { ReciboAGenerar, ROTULOS_DOC_OP } from '@/features/recibo/ReciboAGenerar'
import { ResumenRecibo, ROTULOS_RESUMEN_OP } from '@/features/recibo/ResumenRecibo'
import { EnviarDocumento } from '@/features/shared/EnviarDocumento'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { useReemision } from '@/features/shared/useReemision'
import { VerImprimirPdf } from '@/features/shared/VerImprimirPdf'
import type { DatosConstanciaRetencionPdf, DatosOrdenPagoPdf } from '@/lib/documentoComprobante'
import { firmaDe } from '@/lib/firma'
import { RetencionAGenerar, type LineaRetencion } from './RetencionAGenerar'
import { armarOrdenDePago, esRetencionGAN } from '@/lib/pagosProveedor'
import { pagosDeAnticipos } from '@/lib/recibo'
import {
  descripcionDePasoPago,
  etiquetaDePasoPago,
  numeroDePasoPago,
  pasoAnteriorPago,
} from '@/lib/pasosPago'
import {
  adjuntarPdfOP,
  crearOrdenDePago,
  ErrorRegistroPago,
  getProximoNroRetencion,
  getProximoNroOP,
  leerNroOP,
  mondayHabilitado,
  nombreAnticipoPago,
  ordenPagoCompleta,
  registrarPago,
  type AvanceRegistroPago,
  type DatosOrdenPago,
  type ResultadoOrdenPago,
} from '@/services/monday'
import { useApp, useDispatch } from '@/state/hooks'

/** Qué subelementos faltaron, nombrados como los nombra la orden de pago. */
export const faltantesOrdenPago = (r: ResultadoOrdenPago): string[] =>
  [
    r.facturasCreadas < r.facturasEsperadas &&
      `Facturas de compra canceladas: entraron ${r.facturasCreadas} de ${r.facturasEsperadas}`,
    r.pagosCreados < r.pagosEsperados && `Cajas entregadas: entraron ${r.pagosCreados} de ${r.pagosEsperados}`,
  ].filter((x): x is string => typeof x === 'string')

/**
 * Etapa 4 de PAGOS: la orden de pago —resumen a la izquierda, documento a la derecha—.
 *
 * Es el paso 4 de Cobros pieza por pieza: el resumen, la card del documento, el "Ver / Imprimir" y
 * el bloque de envío son LOS MISMOS componentes, con los rótulos del egreso. Y los dos momentos
 * también son los mismos:
 *
 *   1. "Emitir orden de pago" genera el PDF EN LA APP. No toca Monday.
 *   2. "Registrar Pago" crea la orden con sus subitems y, en paralelo, le sube ese PDF y registra el
 *      pago en cada tablero —cajas, cheques, retenciones, facturas, anticipos y la cuenta corriente
 *      del proveedor— (`registrarPago`, lo que antes hacía el escenario de Make).
 */
export function OrdenPagoView() {
  const {
    proveedor,
    usuario,
    facturasCompra,
    imputacionesPago,
    pago,
    tipoOperacionPago,
    importeAnticipo,
    detalleAnticipo,
    vencimientoAnticipo,
    anticipos,
    aplicaciones,
    ordenPagoId,
    ordenPagoDoc,
    emisionOP,
    emisionNro,
  } = useApp()
  const esAnticipo = tipoOperacionPago === 'anticipo'
  const esAplicacion = tipoOperacionPago === 'aplicacion'

  /* Los anticipos que se imputan, en el orden en que se muestran —no en el que se fueron marcando—:
     así la orden sale siempre igual para la misma aplicación, con el mismo criterio con el que
     `armarOrdenDePago` recorre las facturas. Fuera de la aplicación no hay ninguno. */
  const anticiposAplicados = useMemo(
    () =>
      esAplicacion
        ? anticipos
            .filter((a) => a.id in aplicaciones)
            .map((a) => ({ id: a.id, nro: a.nombre, importe: aplicaciones[a.id] }))
        : [],
    [esAplicacion, anticipos, aplicaciones],
  )
  /* El detalle de la CONSTANCIA de retención, si la orden practicó alguna. Cada movimiento de
     retención es una línea; el comprobante de origen son las facturas que formaron su base —las
     mismas que se están pagando—, que es lo que la constancia declara. */
  const lineasRetencion = useMemo<LineaRetencion[]>(() => {
    const retenciones = pago.movimientos.filter((m) => esRetencionGAN(m.formaPago))
    if (retenciones.length === 0) return []
    const origen = facturasCompra
      .filter((f) => (imputacionesPago[f.id] ?? 0) > 0)
      .map((f) => `Factura N° ${f.nro}`)
      .join(', ')
    return retenciones.map((m) => ({
      id: m.id,
      regimen: m.formaPago,
      comprobante: origen,
      baseImponible: m.baseImponible ?? null,
      alicuota: m.alicuota ?? null,
      retenido: m.importe,
    }))
  }, [pago.movimientos, facturasCompra, imputacionesPago])

  const dispatch = useDispatch()
  // Aviso al intentar registrar sin haber emitido la orden.
  const [aviso, setAviso] = useState(false)
  // Aviso al intentar registrar con datos que cambiaron después de emitir.
  const [avisoCambios, setAvisoCambios] = useState(false)
  /* El registro está en vuelo: tapa la pantalla con `ModalCargando` y frena un segundo click, porque
     es la escritura que impacta la cuenta corriente del proveedor. */
  const [registrando, setRegistrando] = useState(false)
  /* Lo que "Registrar Pago" no pudo impactar. Se informa ACÁ y en ningún otro lado: no se escribe
     ningún estado ni update en Monday. La orden ya está creada; el reintento retoma lo que faltó. */
  const [falloRegistro, setFalloRegistro] = useState<string[] | null>(null)
  // Monday le dio a la orden otro número que el del PDF enviado.
  const [numeroCambiado, setNumeroCambiado] = useState<{ emitido: string; real: string } | null>(null)
  const [verIncompleto, setVerIncompleto] = useState(false)
  // Cerrojo sincrónico contra el doble click en "Emitir".
  const emitiendoRef = useRef(false)

  /* En una APLICACIÓN las líneas de lo entregado son los anticipos imputados: no sale plata, se
     cubren las facturas con el saldo a favor que ya teníamos. De ahí sale el TOTAL ENTREGADO, que
     por eso coincide con el TOTAL CANCELADO. */
  const orden = useMemo(
    () =>
      armarOrdenDePago(
        facturasCompra,
        imputacionesPago,
        pago.movimientos,
        esAplicacion ? pagosDeAnticipos(anticiposAplicados) : undefined,
      ),
    [facturasCompra, imputacionesPago, pago.movimientos, esAplicacion, anticiposAplicados],
  )

  /* En un ANTICIPO no hay facturas que cancelar: lo que el documento declara es el importe
     entregado a cuenta, así que ése es su TOTAL CANCELADO. Es la misma corrección que hace la vista
     del recibo. */
  const totalCancelado = esAnticipo ? importeAnticipo : orden.totalCancelado
  /* La línea del anticipo sale con el MISMO nombre con el que se escribe el subelemento —"Anticipo ·
     <detalle>"— y con el vencimiento cargado: en la card y en el PDF. */
  /* La fecha de EMISIÓN del anticipo es la del pago: el anticipo nace con esta orden, que ahora se
     emite en la app (antes la ponía el tablero al emitir). */
  const lineaAnticipo = esAnticipo
    ? {
        importe: importeAnticipo,
        nombre: nombreAnticipoPago(detalleAnticipo),
        emision: pago.fecha,
        vencimiento: vencimientoAnticipo,
      }
    : null

  const anterior = pasoAnteriorPago('orden', tipoOperacionPago)

  /** Lo que "Registrar Pago" escribe en Monday. Se congela al emitir (`ordenPagoDoc.datos`). */
  const datos = useMemo<DatosOrdenPago | null>(
    () =>
      proveedor
        ? {
            proveedorId: proveedor.id,
            nombreProveedor: proveedor.name,
            vendedorId: usuario?.id ?? null,
            /* SÓLO las facturas: el anticipo también figura entre los comprobantes cancelados del
               documento, pero no es un ítem del tablero de facturas de compra y el servicio arma su
               línea por su cuenta a partir de los movimientos. */
            facturas: orden.comprobantes
              .filter((c) => !c.esAnticipo)
              .map((c) => ({ id: c.id, nro: c.nro, importe: c.cancelado })),
            /* En una aplicación no hay cajas: lo que cubre las facturas son los anticipos. */
            movimientos: esAplicacion ? [] : pago.movimientos,
            tipo: esAnticipo ? 'anticipo' : esAplicacion ? 'aplicacion' : 'facturas',
            /* Los tres datos del anticipo viajan juntos: describen la misma línea del documento. */
            anticipo: esAnticipo ? importeAnticipo : undefined,
            detalleAnticipo: esAnticipo ? detalleAnticipo : undefined,
            vencimientoAnticipo: esAnticipo ? vencimientoAnticipo : undefined,
            anticiposAplicados: esAplicacion ? anticiposAplicados : undefined,
          }
        : null,
    [
      proveedor,
      usuario,
      orden.comprobantes,
      esAplicacion,
      esAnticipo,
      pago.movimientos,
      importeAnticipo,
      detalleAnticipo,
      vencimientoAnticipo,
      anticiposAplicados,
    ],
  )
  const firma = useMemo(() => firmaDe({ datos, fecha: pago.fecha }), [datos, pago.fecha])
  const desactualizado = ordenPagoDoc !== null && ordenPagoDoc.firma !== firma

  /** Lo que lleva el PDF, con el número que se le pase. Sale de la MISMA card que ve el usuario. */
  const datosPdf = (numero: string): Omit<DatosOrdenPagoPdf, 'nombre'> | null =>
    proveedor && {
      variante: esAnticipo ? 'anticipo' : esAplicacion ? 'aplicacion' : 'facturas',
      numero,
      // La fecha del PAGO es la del día en que se opera, la misma que lleva la operación.
      fechaEmision: pago.fecha,
      titular: proveedor,
      documento: orden,
      anticipo: lineaAnticipo,
      logoSrc: LOGO_DOCUMENTOS,
    }

  /**
   * Lo que lleva la CONSTANCIA de retención, con su número de certificado y el de la orden que la
   * practicó. Sale de la MISMA card "Retención a generar" (`lineasRetencion`).
   */
  const datosConstancia = (
    certificado: string,
    refOrdenPago: string,
  ): Omit<DatosConstanciaRetencionPdf, 'nombre'> | null =>
    proveedor && {
      certificado,
      fechaRetencion: pago.fecha,
      refOrdenPago,
      retenido: proveedor,
      retenciones: lineasRetencion.map((l) => ({
        regimen: l.regimen,
        comprobante_origen: l.comprobante,
        monto_base: l.baseImponible,
        alicuota: l.alicuota,
        monto_retenido: l.retenido,
      })),
      logoSrc: LOGO_DOCUMENTOS,
    }

  /**
   * "Emitir orden de pago": pide el número con el que va a nacer la orden y genera su PDF con lo que
   * muestra la card —y, si la orden practicó una retención de Ganancias, también la CONSTANCIA de
   * retención—. NO escribe en Monday —eso lo hace `registrar`—, así que se puede VOLVER A EMITIR: el
   * documento nuevo reemplaza al anterior y el envío vuelve a cero (ver `useReemision`).
   */
  const emitir = async () => {
    const pdf0 = datosPdf('')
    if (!pdf0 || !datos || ordenPagoId || emitiendoRef.current) return
    emitiendoRef.current = true
    dispatch({ type: 'setEmisionOP', emision: { fase: 'creando', estado: 'Generando PDF', error: null } })
    let numero: string | null = null
    /* El número de certificado de la constancia, si la orden retuvo: se predice igual que el de la
       orden, y es el mismo que después se escribe en la línea de la retención. */
    let certificado: string | null = null
    try {
      numero = await getProximoNroOP()
      if (!numero) throw new Error('sin número')
      if (lineasRetencion.length > 0) {
        certificado = await getProximoNroRetencion()
        if (!certificado) throw new Error('sin número de retención')
      }
    } catch {
      dispatch({
        type: 'setEmisionOP',
        emision: {
          fase: 'error',
          estado: '',
          error: {
            estado: 'No se pudo obtener el número de la orden',
            mensaje:
              'No pudimos leer en Monday el número con el que va a salir la orden de pago (o su constancia de retención). Tocá el botón para reintentar.',
          },
        },
      })
      emitiendoRef.current = false
      return
    }
    try {
      const datosRet = certificado ? datosConstancia(certificado, numero) : null
      const [pdf, pdfConstancia] = await Promise.all([
        /* La línea de la retención lleva en "Nro de comprobante" el certificado de su constancia. */
        generarOrdenPagoPdf({
          ...pdf0,
          numero,
          documento: certificado
            ? {
                ...pdf0.documento,
                pagos: pdf0.documento.pagos.map((p) =>
                  esRetencionGAN(p.descripcion) ? { ...p, comprobante: certificado as string } : p,
                ),
              }
            : pdf0.documento,
        }),
        datosRet ? generarConstanciaRetencionPdf(datosRet) : Promise.resolve(null),
      ])
      dispatch({
        type: 'setOrdenPagoDoc',
        doc: {
          numero,
          fechaEmision: pago.fecha,
          pdf,
          /* La línea de la retención se escribe con el MISMO número que dice la constancia. */
          datos: certificado ? { ...datos, nroRetencion: certificado } : datos,
          firma,
          registro: { pdfSubido: false, incompleto: null },
          constancia: pdfConstancia && certificado ? { pdf: pdfConstancia, numero: certificado } : null,
        },
      })
      dispatch({ type: 'setEmisionOP', emision: { fase: 'emitido', estado: 'Emitido', error: null } })
    } catch (e) {
      console.error('No se pudo generar el PDF de la orden de pago', e)
      dispatch({
        type: 'setEmisionOP',
        emision: {
          fase: 'error',
          estado: '',
          error: {
            estado: 'Error de emisión',
            mensaje:
              'La app no está pudiendo generar el PDF de la orden de pago. Tocá el botón para reintentar; si vuelve a fallar, contactate con el soporte de TAP.',
          },
        },
      })
    } finally {
      emitiendoRef.current = false
    }
  }

  /**
   * "Registrar Pago": el ÚNICO lugar donde la orden nace en Monday. Dos tiempos, con la ventana de
   * espera arriba —el mismo recorrido que "Registrar Cobro"—:
   *   1. la orden con TODOS sus subitems (`crearOrdenDePago`); si alguno no entró, se corta ahí;
   *   2. EN PARALELO: el PDF emitido a su columna file, con la orden en "Emitido" (`adjuntarPdfOP`),
   *      y el registro del pago en cada tablero (`registrarPago`) —con la constancia de retención,
   *      si la hubo—.
   * Recién con los dos confirmados se cierra la operación. Retoma donde quedó si algo falla.
   */
  const registrar = async () => {
    if (!ordenPagoDoc) {
      setAviso(true)
      return
    }
    if (desactualizado) {
      setAvisoCambios(true)
      return
    }
    if (ordenPagoDoc.registro.incompleto) {
      setVerIncompleto(true)
      return
    }
    if (registrando) return
    setRegistrando(true)
    let accion = 'registrar la orden de pago'
    try {
      let id = ordenPagoId
      let avancePago: AvanceRegistroPago | undefined = ordenPagoDoc.registro.pago
      if (!id) {
        const creada = await crearOrdenDePago(ordenPagoDoc.datos)
        id = creada.id
        avancePago = { lineas: creada.lineas, hechos: {} }
        dispatch({ type: 'setOrdenPagoId', id })
        dispatch({ type: 'avanceRegistro', documento: 'ordenPago', avance: { pago: avancePago } })
        if (!ordenPagoCompleta(creada)) {
          dispatch({
            type: 'avanceRegistro',
            documento: 'ordenPago',
            avance: { incompleto: faltantesOrdenPago(creada) },
          })
          setRegistrando(false)
          setVerIncompleto(true)
          return
        }
      }
      const ordenCreada = id
      const lineas = avancePago?.lineas ?? []
      if (mondayHabilitado() && lineas.length === 0) {
        throw new Error('La orden está creada, pero la app no tiene sus subelementos para registrar el pago.')
      }

      /* El PDF. El número del PDF era una predicción: si Monday le dio otro, lo que queda en el
         tablero tiene que decir el REAL, así que se regenera con ése antes de subirlo. */
      const subirPdf = async (): Promise<{ emitido: string; real: string } | null> => {
        if (ordenPagoDoc.registro.pdfSubido) return null
        const real = await leerNroOP(ordenCreada)
        let pdf = ordenPagoDoc.pdf
        let cambio: { emitido: string; real: string } | null = null
        if (real && real !== ordenPagoDoc.numero) {
          const conReal = datosPdf(real)
          if (conReal) pdf = await generarOrdenPagoPdf(conReal)
          cambio = { emitido: ordenPagoDoc.numero, real }
        }
        await adjuntarPdfOP(ordenCreada, pdf, ordenPagoDoc.fechaEmision)
        dispatch({ type: 'avanceRegistro', documento: 'ordenPago', avance: { pdfSubido: true } })
        return cambio
      }

      const constancia = ordenPagoDoc.constancia
      const [pdf, registro] = await Promise.allSettled([
        subirPdf(),
        registrarPago(
          {
            ordenId: ordenCreada,
            tipo: esAnticipo ? 'anticipo' : esAplicacion ? 'aplicacion' : 'pago',
            proveedorId: ordenPagoDoc.datos.proveedorId,
            fechaPago: ordenPagoDoc.fechaEmision,
            lineas,
            nroRetencion: ordenPagoDoc.datos.nroRetencion,
            /* La constancia va a la fila de "🔃Retenciones" que crea el registro. Si Monday le dio
               al certificado o a la orden otro número que el del PDF, se regenera con el REAL. */
            constancia: constancia
              ? {
                  pdf: constancia.pdf,
                  numero: constancia.numero,
                  nroOrden: ordenPagoDoc.numero,
                  regenerar: async (certificado, nroOrden) => {
                    const d = datosConstancia(certificado, nroOrden)
                    return d ? generarConstanciaRetencionPdf(d) : constancia.pdf
                  },
                }
              : null,
          },
          { hechos: { ...(avancePago?.hechos ?? {}) } },
          (hechos) =>
            dispatch({
              type: 'avanceRegistro',
              documento: 'ordenPago',
              avance: { pago: { lineas, hechos: { ...hechos } } },
            }),
        ),
      ])

      setRegistrando(false)
      if (registro.status === 'rejected') {
        const e: unknown = registro.reason
        setFalloRegistro(
          e instanceof ErrorRegistroPago
            ? e.fallas
            : [e instanceof Error && e.message.trim() ? e.message : 'Monday no respondió al registrar el pago.'],
        )
        return
      }
      if (pdf.status === 'rejected') {
        accion = 'subir el PDF de la orden de pago'
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
  const descartar = useCallback(() => dispatch({ type: 'descartarEmision', documento: 'ordenPago' }), [dispatch])
  const { pedirEmision, modal: modalReemision } = useReemision({
    nombre: 'la orden de pago',
    emitido: ordenPagoDoc !== null,
    firmaEmitida: ordenPagoDoc?.firma ?? null,
    firmaActual: firma,
    creado: ordenPagoId !== null,
    descartar,
    emitir: () => void emitir(),
  })

  return (
    <section className="view recibo-v2 paso-layout">
      <PasoHeader />

      <div className="paso-body">
        <PasoTitulo
          numero={numeroDePasoPago('orden', tipoOperacionPago)}
          titulo={etiquetaDePasoPago('orden', tipoOperacionPago)}
          descripcion={descripcionDePasoPago('orden', tipoOperacionPago)}
        />

        {!proveedor ? (
          <div className="card rec-vacio">
            <i className="fas fa-user-slash" /> Todavía no hay un proveedor seleccionado. Volvé al
            paso 1 para elegirlo.
          </div>
        ) : (
          <div className="recibo-grid">
            <ResumenRecibo
              cliente={proveedor}
              /* La fecha del PAGO es la del día en que se opera, la misma que lleva la operación. */
              fechaEmision={pago.fecha}
              totalRecibido={orden.totalEntregado}
              totalCancelado={totalCancelado}
              fase={emisionOP.fase}
              error={emisionOP.error}
              onEmitir={pedirEmision}
              bloqueado={ordenPagoId !== null}
              rotulos={ROTULOS_RESUMEN_OP}
            >
              {/* La orden y, si retuvo, su constancia: "Ver / Imprimir (2)". */}
              <VerImprimirPdf
                archivos={
                  ordenPagoDoc
                    ? ordenPagoDoc.constancia
                      ? [ordenPagoDoc.pdf, ordenPagoDoc.constancia.pdf]
                      : [ordenPagoDoc.pdf]
                    : null
                }
              />
              {desactualizado && ordenPagoId !== null && <DocumentoDesactualizado documento="la orden de pago" />}
            </ResumenRecibo>

            {/* Columna derecha: el documento y, debajo, su envío al proveedor. */}
            <div className="recibo-col-der">
              {/* `anticipo` es lo que hace que la card se dibuje como la de un anticipo: pastilla
                  "Anticipo", métrica "Concepto" y una sola fila en lugar de la tabla de facturas.
                  Es exactamente el mismo interruptor que usa el recibo. */}
              <ReciboAGenerar
                recibo={orden}
                fase={emisionOP.fase}
                estado={emisionOP.estado}
                anticipo={lineaAnticipo}
                rotulos={ROTULOS_DOC_OP}
                /* En una APLICACIÓN la tabla de lo entregado lista los anticipos imputados, no
                   cajas: acá no salió plata, se usó la que ya estaba a favor nuestro. */
                columnaEntregado={esAplicacion ? 'Anticipos' : undefined}
              >
                {/* La constancia sale JUNTO con la orden, así que se dibuja como una card más del
                    mismo comprobante a generar. Sin retención practicada no hay constancia. */}
                {lineasRetencion.length > 0 && <RetencionAGenerar lineas={lineasRetencion} />}
              </ReciboAGenerar>

              {/* El MISMO bloque de envío del recibo. La clave elige el comprobante del catálogo, y
                  de ahí sale todo lo propio de la orden: que los contactos son los del PROVEEDOR y
                  que sin uno que la acepte el envío queda inhabilitado. */}
              {/* Por documento emitido: uno nuevo es otro documento, y el envío arranca de cero. */}
              <EnviarDocumento key={`emision-${emisionNro}`} documento="ordenPago" />
            </div>
          </div>
        )}

        <div className="actions-footer">
          {/* Volver no descarta nada: el pago, su imputación y la emisión ya hecha viven en el
              estado global, así que al regresar la etapa se reencuentra tal como quedó. */}
          <button
            type="button"
            className="btn btn-out"
            onClick={() => anterior && dispatch({ type: 'gotoPago', paso: anterior })}
          >
            <i className="fas fa-arrow-left" /> Volver
          </button>

          <div className="actions-footer-fin">
            <button
              type="button"
              className="btn btn-primary"
              disabled={registrando}
              title={ordenPagoDoc ? undefined : 'Emití la orden de pago para poder registrar el pago.'}
              onClick={() => void registrar()}
            >
              <i className="fas fa-flag-checkered" /> Registrar Pago
            </button>
          </div>
        </div>
      </div>

      {/* La MISMA ventana —y los mismos estilos— con los que se registra un cobro. */}
      {registrando && (
        <ModalCargando
          titulo="Registrando pago en el sistema"
          detalle="Estamos registrando la orden de pago en el sistema junto a sus cajas, sus facturas, sus comprobantes y su PDF. Espera unos segundos y no salgas de la app"
        />
      )}

      {modalReemision}

      {/* La orden está creada, pero algo del registro no entró. Se nombra qué, y nada se escribe en
          Monday para contarlo: ni estados ni updates. */}
      {falloRegistro && (
        <AvisoModal
          titulo="No se pudo registrar todo el pago"
          faltantes={falloRegistro}
          onClose={() => setFalloRegistro(null)}
        >
          La orden de pago quedó creada en Monday, pero esto no se pudo registrar. Tocá{' '}
          <strong>Registrar Pago</strong> para reintentar: se retoma desde donde se cortó, sin
          duplicar lo que ya quedó registrado. Si vuelve a fallar, contactate con el soporte de TAP.
        </AvisoModal>
      )}

      {numeroCambiado && (
        <AvisoModal
          titulo="La orden quedó registrada con otro número"
          onClose={() => {
            setNumeroCambiado(null)
            dispatch({ type: 'reset' })
          }}
        >
          El pago se registró correctamente, pero Monday le asignó el número{' '}
          <strong>{numeroCambiado.real}</strong> y el PDF se había emitido como{' '}
          <strong>{numeroCambiado.emitido}</strong> (otra orden tomó ese número en el medio). En
          Monday quedó el PDF con el número correcto; si ya se lo enviaste al proveedor, reenviáselo
          desde el tablero.
        </AvisoModal>
      )}

      {aviso && (
        <AvisoModal titulo="Todavía no emitiste la orden de pago" onClose={() => setAviso(false)}>
          El pago no se puede registrar hasta que se emite su orden. Emitila desde el resumen y
          después registrá el pago.
        </AvisoModal>
      )}

      {avisoCambios && (
        <AvisoModal titulo="La orden emitida ya no coincide" onClose={() => setAvisoCambios(false)}>
          Cambiaste datos del pago después de emitir la orden, así que el PDF ya no dice lo que se
          registraría. Volvé a emitirla desde el resumen antes de registrar el pago.
        </AvisoModal>
      )}

      {/* La orden se creó a medias: se nombra exactamente qué no entró. */}
      {verIncompleto && ordenPagoDoc?.registro.incompleto && (
        <AvisoModal
          titulo="La orden de pago quedó incompleta"
          faltantes={ordenPagoDoc.registro.incompleto}
          onClose={() => setVerIncompleto(false)}
        >
          La orden se creó en Monday, pero no entraron todos sus subelementos, así que
          <strong> no se le subió el PDF ni se registró el pago</strong>: el pago quedaría
          registrado sin esas líneas. Completala en el tablero y registrala desde ahí; volver a
          registrarla desde acá la duplicaría.
        </AvisoModal>
      )}
    </section>
  )
}
