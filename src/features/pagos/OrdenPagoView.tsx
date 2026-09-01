import { useMemo, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { ReciboAGenerar, ROTULOS_DOC_OP } from '@/features/recibo/ReciboAGenerar'
import { ResumenRecibo, ROTULOS_RESUMEN_OP } from '@/features/recibo/ResumenRecibo'
import { useEmision } from '@/features/recibo/useEmisionRecibo'
import { EnviarDocumento } from '@/features/shared/EnviarDocumento'
import { ORDEN_PAGO_EMISIBLE } from '@/features/shared/emisiones'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { RetencionAGenerar, type LineaRetencion } from './RetencionAGenerar'
import { armarOrdenDePago, esRetencionGAN } from '@/lib/pagosProveedor'
import { pagosDeAnticipos } from '@/lib/recibo'
import {
  descripcionDePasoPago,
  etiquetaDePasoPago,
  numeroDePasoPago,
  pasoAnteriorPago,
} from '@/lib/pasosPago'
import type { DatosOrdenPago } from '@/services/monday'
import { nombreAnticipoPago, pedirRegistroOP } from '@/services/monday/ordenPago'
import { useApp, useDispatch } from '@/state/hooks'

/**
 * Número de la orden. Es un valor de maqueta, igual que `NRO_RECIBO`: el definitivo lo asigna
 * Monday al crear el ítem ("🤖ID Orden de Pago", con su prefijo IDPAGO).
 */
const NRO_ORDEN = 'IDPAGO-00001'

/**
 * Etapa 4 de PAGOS: la orden de pago —resumen a la izquierda, documento a la derecha—.
 *
 * Es el paso 4 de Cobros pieza por pieza: el resumen, la card del documento y el bloque de envío son
 * LOS MISMOS componentes, con los rótulos del egreso (ver `ROTULOS_RESUMEN_OP` y `ROTULOS_DOC_OP`).
 * Hasta el ciclo de la emisión es el mismo hook: lo que cambia —qué se escribe, en qué tablero y
 * cómo se lo nombra— vive en `ORDEN_PAGO_EMISIBLE`, no acá.
 *
 * Esta etapa NO decide nada: las facturas canceladas y las cajas ya quedaron cerradas en las etapas
 * 2 y 3, y la etapa 3 no deja llegar hasta acá si la diferencia no está en cero exacto. Lo único que
 * se hace es mostrar el documento que sale de eso, emitirlo y enviarlo.
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
     mismas que se están pagando—, que es lo que la constancia declara.

     Los tres datos del cálculo viajan en el propio movimiento desde que se agregó a la tabla, así
     que acá no se recalcula nada: se muestra lo que se practicó. */
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
  // Aviso al intentar cerrar la operación sin haber emitido la orden.
  const [aviso, setAviso] = useState(false)
  /* El pedido de registro está en vuelo. Mientras tanto el botón de cierre se apaga: es una
     escritura que impacta la cuenta corriente del proveedor, y repetirla por un doble click la
     pediría dos veces. */
  const [registrando, setRegistrando] = useState(false)
  /* Todo el ciclo de la emisión —escritura, pedido al tablero y seguimiento del estado— vive en el
     hook, con el adaptador de la orden. Su estado lo guarda en el estado GLOBAL, así que volver un
     paso y regresar reencuentra la orden emitida en vez de reofrecer la emisión. */
  const { fase, estado, error, incompleto, puedeReintentar, emitir, limpiarIncompleto } =
    useEmision<DatosOrdenPago>(ORDEN_PAGO_EMISIBLE)

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
     entregado a cuenta, así que ése es su TOTAL CANCELADO (el que `armarOrdenDePago` deriva de los
     comprobantes daría 0, que sería decir que la orden no cancela nada). Es la misma corrección que
     hace la vista del recibo. */
  const totalCancelado = esAnticipo ? importeAnticipo : orden.totalCancelado

  const anterior = pasoAnteriorPago('orden', tipoOperacionPago)

  const emitirOrden = () => {
    if (!proveedor) return
    void emitir({
      proveedorId: proveedor.id,
      nombreProveedor: proveedor.name,
      vendedorId: usuario?.id ?? null,
      /* SÓLO las facturas: el anticipo también figura entre los comprobantes cancelados del
         documento, pero no es un ítem del tablero de facturas de compra y el servicio arma su línea
         por su cuenta a partir de los movimientos. Mandarlo acá lo escribiría dos veces —y con una
         relación que no linkea nada—. Es el mismo filtro que hace la vista del recibo. */
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
    })
  }

  /**
   * Cierra la operación y deja la app lista para el próximo pago. Con la orden sin emitir el botón
   * sigue activo a propósito: la ventana explica por qué no se puede cerrar, en vez de dejar un
   * botón muerto sin motivo (mismo criterio que el resto de los pasos).
   *
   * Antes de cerrar le PIDE al tablero que registre el pago —"🤖Estado Registro de Pago" en
   * "Registrar"—, que es lo que dispara la automatización que impacta la cuenta corriente del
   * proveedor y marca las facturas como pagadas. Va acá y no al crear la orden porque necesita que
   * el ítem tenga ya todos sus subelementos colgados.
   *
   * Se ESPERA la respuesta en vez de largarla y cerrar: si la escritura falla, la operación queda
   * a medio camino —la orden existe y el documento se emitió, pero nada impactó en la cuenta— y el
   * usuario ya se fue a la pantalla siguiente, sin nada que le avise. Por eso el cierre sólo ocurre
   * cuando el pedido entró; si no, se avisa y el botón queda disponible para reintentar.
   */
  const finalizar = () => {
    if (fase !== 'emitido') {
      setAviso(true)
      return
    }
    if (registrando) return
    /* Sin id no hay a quién pedirle el registro. No debería pasar —la orden emitida siempre dejó su
       ítem—, pero de darse, cerrar igual es mejor que dejar al usuario encerrado en la etapa. */
    if (!ordenPagoId) {
      dispatch({ type: 'reset' })
      return
    }
    setRegistrando(true)
    pedirRegistroOP(ordenPagoId)
      .then(() => dispatch({ type: 'reset' }))
      .catch(() => {
        setRegistrando(false)
        dispatch({ type: 'errorMonday', accion: 'pedir el registro del pago' })
      })
  }

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
              fase={fase}
              error={error}
              puedeReintentar={puedeReintentar}
              onEmitir={emitirOrden}
              rotulos={ROTULOS_RESUMEN_OP}
            />

            {/* Columna derecha: el documento y, debajo, su envío al proveedor. */}
            <div className="recibo-col-der">
              {/* `anticipo` es lo que hace que la card se dibuje como la de un anticipo: pastilla
                  "Anticipo", métrica "Concepto" y una sola fila en lugar de la tabla de facturas.
                  Es exactamente el mismo interruptor que usa el recibo. */}
              <ReciboAGenerar
                recibo={orden}
                fase={fase}
                estado={estado}
                /* La línea sale con el MISMO nombre con el que se va a escribir el subelemento
                   —"Anticipo · <detalle>"— y con el vencimiento cargado, que es como la publica el
                   PDF de la orden. La emisión la pone el tablero al emitir, así que acá va vacía y
                   se muestra marcada como sin dato. */
                anticipo={
                  esAnticipo
                    ? {
                        importe: importeAnticipo,
                        nombre: nombreAnticipoPago(detalleAnticipo),
                        vencimiento: vencimientoAnticipo,
                      }
                    : null
                }
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
                  de ahí sale todo lo propio de la orden: de qué ítem se despacha, que los contactos
                  son los del PROVEEDOR y que sin uno que la acepte el envío queda inhabilitado. */}
              <EnviarDocumento documento="ordenPago" numero={NRO_ORDEN} />
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
            {/* Mientras el pedido viaja, el botón lo dice en vez de quedarse mudo: es la última
                escritura de la operación y la que impacta la cuenta corriente. */}
            <button
              type="button"
              className="btn btn-primary"
              disabled={registrando}
              onClick={finalizar}
            >
              {registrando ? (
                <>
                  <i className="fas fa-circle-notch fa-spin" /> Registrando el pago…
                </>
              ) : (
                <>
                  <i className="fas fa-flag-checkered" /> Finalizar Operación
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {aviso && (
        <AvisoModal titulo="Todavía no emitiste la orden de pago" onClose={() => setAviso(false)}>
          El pago no queda cerrado hasta que se emite su orden. Emitila desde el resumen y después
          finalizá la operación.
        </AvisoModal>
      )}

      {/* La orden se creó a medias: se nombra exactamente qué no entró. */}
      {incompleto && (
        <AvisoModal
          titulo="La orden de pago quedó incompleta"
          faltantes={incompleto}
          onClose={limpiarIncompleto}
        >
          La orden se creó en Monday, pero no entraron todos sus subelementos, así que
          <strong> no se pidió su emisión</strong>: el documento saldría sin esas líneas.
          Completala en el tablero y emitila desde ahí; volver a emitirla desde acá la duplicaría.
        </AvisoModal>
      )}
    </section>
  )
}
