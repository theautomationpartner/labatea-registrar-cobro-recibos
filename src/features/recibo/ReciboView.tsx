import { useEffect, useMemo, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { EnviarDocumento } from '@/features/shared/EnviarDocumento'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { DESCRIPCION, ETAPA, numeroDePaso } from '@/lib/pasos'
import { armarRecibo, NRO_RECIBO } from '@/lib/recibo'
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
  const { cliente, usuario, facturas, imputaciones, cobro, documentoEnviado } = useApp()
  const dispatch = useDispatch()
  // Aviso al intentar cerrar la operación sin haber emitido el recibo.
  const [aviso, setAviso] = useState(false)
  /* El envío terminó bien en ESTA pantalla. La bandera global (`documentoEnviado`) es la que
     persiste; ésta sólo refleja el envío recién hecho para el rótulo del pie. */
  const [listoParaCerrar, setListoParaCerrar] = useState(false)
  /* Todo el ciclo de la emisión —escritura, pedido al tablero y seguimiento del estado— vive en el
     hook. Acá sólo se lo dispara y se reparte su estado entre las dos cards. */
  const { fase, estado, error, incompleto, puedeReintentar, emitir, limpiarIncompleto, reciboId } =
    useEmisionRecibo()

  /* El id del recibo emitido va al estado GLOBAL: es de ahí de donde el envío saca el ítem a
     despachar, y tiene que sobrevivir a la navegación con el stepper —el hook lo pierde al
     desmontarse la vista—. */
  useEffect(() => {
    if (reciboId) dispatch({ type: 'setReciboId', id: reciboId })
  }, [reciboId, dispatch])

  /* Envío ya completado: la bandera global sobrevive a la navegación; el estado local cubre el
     envío recién hecho en esta pantalla. */
  const enviado = documentoEnviado || listoParaCerrar

  const recibo = useMemo(
    () => armarRecibo(facturas, imputaciones, cobro.movimientos),
    [facturas, imputaciones, cobro.movimientos],
  )

  const emitirRecibo = () => {
    if (!cliente) return
    void emitir({
      clienteId: cliente.id,
      nombreCliente: cliente.name,
      vendedorId: usuario?.id ?? null,
      facturas: recibo.comprobantes.map((c) => ({ id: c.id, nro: c.nro, importe: c.cancelado })),
      movimientos: cobro.movimientos,
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
          numero={numeroDePaso('recibo')}
          titulo={ETAPA.recibo}
          descripcion={DESCRIPCION.recibo}
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
              totalCancelado={recibo.totalCancelado}
              fase={fase}
              error={error}
              puedeReintentar={puedeReintentar}
              onEmitir={emitirRecibo}
            />

            {/* Columna derecha: el documento y, debajo, su envío al cliente. */}
            <div className="recibo-col-der">
              <ReciboAGenerar recibo={recibo} fase={fase} estado={estado} />

              {/* En la vista, el envío es una línea. La clave elige el comprobante del catálogo.
                  Intentar enviar sin haber emitido abre su propio aviso: lo resuelve el componente. */}
              <EnviarDocumento
                documento="recibo"
                numero={NRO_RECIBO}
                onEnviado={() => setListoParaCerrar(true)}
              />
            </div>
          </div>
        )}

        <div className="actions-footer">
          {/* Volver no descarta nada: el cobro y su imputación viven en el estado. */}
          <button
            type="button"
            className="btn btn-out"
            onClick={() => dispatch({ type: 'goto', paso: 'cobro' })}
          >
            <i className="fas fa-arrow-left" /> Volver
          </button>

          <div className="actions-footer-fin">
            <span
              className={`paso-siguiente ${fase === 'emitido' ? '' : 'paso-siguiente--bloqueo'}`}
            >
              {fase === 'emitido' ? (
                <>
                  <i className="fas fa-circle-check" /> Recibo emitido
                  {enviado ? ' y enviado' : ' · envío pendiente'}
                </>
              ) : fase === 'creando' || fase === 'emitiendo' ? (
                <>
                  <i className="fas fa-circle-notch fa-spin" /> Emitiendo el recibo…
                </>
              ) : (
                <>
                  <i className="fas fa-circle-exclamation" /> Falta emitir el recibo
                </>
              )}
            </span>
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
