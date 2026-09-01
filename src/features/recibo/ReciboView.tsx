import { useMemo, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { EnviarDocumento } from '@/features/shared/EnviarDocumento'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { descripcionDePaso, etiquetaDePaso, numeroDePaso, pasoAnterior } from '@/lib/pasos'
import { armarRecibo, pagosDeAnticipos, NRO_RECIBO } from '@/lib/recibo'
import { useApp, useDispatch } from '@/state/hooks'
import { ReciboAGenerar } from './ReciboAGenerar'
import { ResumenRecibo } from './ResumenRecibo'
import { useEmisionRecibo } from './useEmisionRecibo'

/**
 * Paso 4: el recibo de la cobranza —resumen a la izquierda, documento a la derecha—.
 *
 * Esta etapa NO decide nada: las facturas canceladas y las formas de pago ya quedaron cerradas en
 * los pasos 2 y 3, y el paso 3 no deja llegar hasta acá si la diferencia no está en cero. Lo único
 * que se hace es mostrar el documento que sale de eso y emitirlo.
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
  } = useApp()
  const dispatch = useDispatch()
  // Aviso al intentar cerrar la operación sin haber emitido el recibo.
  const [aviso, setAviso] = useState(false)
  /* Todo el ciclo de la emisión —escritura, pedido al tablero y seguimiento del estado— vive en el
     hook. Acá sólo se lo dispara y se reparte su estado entre las dos cards. Ese estado lo guarda el
     hook en el estado GLOBAL, así que volver un paso y regresar reencuentra el recibo emitido en vez
     de reofrecer la emisión. */
  const { fase, estado, error, incompleto, puedeReintentar, emitir, limpiarIncompleto } =
    useEmisionRecibo()

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
  const anterior = pasoAnterior('recibo', tipoOperacion)

  const emitirRecibo = () => {
    if (!cliente) return
    void emitir({
      clienteId: cliente.id,
      nombreCliente: cliente.name,
      vendedorId: usuario?.id ?? null,
      tipo: esAnticipo ? 'anticipo' : esAplicacion ? 'aplicacion' : 'cobro',
      /* SÓLO las facturas: los anticipos también figuran entre los comprobantes cancelados del
         documento, pero no son ítems del tablero de facturas y el servicio los arma por su cuenta
         a partir de los movimientos. Mandarlos acá los escribiría dos veces. */
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
         ficha del cliente muestra en el paso 1, no un número nuevo. Viaja para que el servicio
         pueda declarar en el tablero cómo queda la cuenta con el cobro ya aplicado; en la app no
         se muestra en ninguna parte. */
      saldoCtaCte: cliente.saldoCtaCte,
    })
  }

  /* Cierra la operación y deja la app lista para la próxima cobranza. Con el recibo sin emitir el
     botón sigue activo a propósito: la ventana explica por qué no se puede cerrar, en vez de dejar
     un botón muerto sin motivo (mismo criterio que el resto de los pasos). */
  const finalizar = () => {
    if (fase !== 'emitido') {
      setAviso(true)
      return
    }
    dispatch({ type: 'reset' })
  }

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
              fase={fase}
              error={error}
              puedeReintentar={puedeReintentar}
              onEmitir={emitirRecibo}
            />

            {/* Columna derecha: el documento y, debajo, su envío al cliente. */}
            <div className="recibo-col-der">
              <ReciboAGenerar
                recibo={recibo}
                fase={fase}
                estado={estado}
                anticipo={esAnticipo ? { importe: importeAnticipo } : null}
              />

              {/* En la vista, el envío es una línea. La clave elige el comprobante del catálogo.
                  Intentar enviar sin haber emitido abre su propio aviso: lo resuelve el componente. */}
              {/* Sin `onEnviado`: el resultado del envío lo muestra la propia card —y lo persiste
                  en `documentoEnviado`—, así que la vista no necesita enterarse. */}
              <EnviarDocumento documento="recibo" numero={NRO_RECIBO} />
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
            {/* Sin rótulo de estado al lado del botón: en qué anda la emisión ya lo dicen el propio
                botón "Emitir el recibo" y el semáforo de la card del documento, los dos a la vista.
                Repetirlo acá era decir tres veces lo mismo. */}
            <button type="button" className="btn btn-primary" onClick={finalizar}>
              <i className="fas fa-flag-checkered" /> Finalizar Operación
            </button>
          </div>
        </div>
      </div>

      {aviso && (
        <AvisoModal titulo="Todavía no emitiste el recibo" onClose={() => setAviso(false)}>
          El cobro no queda cerrado hasta que se emite su recibo. Emitilo desde el resumen y después
          finalizá la operación.
        </AvisoModal>
      )}

      {/* El recibo se creó a medias: se nombra exactamente qué no entró. */}
      {incompleto && (
        <AvisoModal
          titulo="El recibo quedó incompleto"
          faltantes={incompleto}
          onClose={limpiarIncompleto}
        >
          El recibo se creó en Monday, pero no entraron todos sus subelementos, así que
          <strong> no se pidió su emisión</strong>: el PDF saldría sin esas líneas. Completalo en el
          tablero y emitilo desde ahí; volver a emitirlo desde acá lo duplicaría.
        </AvisoModal>
      )}
    </section>
  )
}
