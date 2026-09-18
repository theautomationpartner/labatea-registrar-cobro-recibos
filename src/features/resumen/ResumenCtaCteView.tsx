import { useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { useEmision } from '@/features/recibo/useEmisionRecibo'
import { RESUMEN_CTA_CTE_EMISIBLE } from '@/features/shared/emisiones'
import { EnviarDocumento } from '@/features/shared/EnviarDocumento'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { descripcionDePaso, etiquetaDePaso, numeroDePaso, pasoAnterior } from '@/lib/pasos'
import { periodoDeRango } from '@/lib/resumenCtaCte'
import { useApp, useDispatch } from '@/state/hooks'
import { FichaResumenCtaCte } from './FichaResumenCtaCte'
import { ResumenCtaCteAGenerar } from './ResumenCtaCteAGenerar'
import { useFacturasAdeudadas } from './useFacturasAdeudadas'
import { useMovimientosCtaCte } from './useMovimientosCtaCte'

/** Qué ventana está abierta, si hay una. */
type Aviso = 'sin-formato' | 'sin-periodo' | 'sin-cuenta' | 'sin-emitir'

/**
 * RESUMEN DE CTA CTE · paso 4: emitir el resumen y enviárselo al cliente. Misma grilla que la
 * emisión del recibo —la ficha con el botón a la izquierda, el documento y su envío a la derecha—.
 *
 * Emitir NO crea un ítem: deja escrito el formato en la cuenta corriente del cliente y le pide al
 * tablero que genere el archivo, y se sigue esa generación hasta que cierre (ver
 * `RESUMEN_CTA_CTE_EMISIBLE`). El envío se habilita recién con el archivo generado.
 */
export function ResumenCtaCteView() {
  const {
    cliente,
    tipoOperacion,
    movimientosCtaCte,
    mercaderiaPendFacturar,
    ctaCteId,
    resumenRango,
    resumenFormato,
    resumenEstadoCtaCte,
    facturasAdeudadas,
  } = useApp()
  const dispatch = useDispatch()
  /* Si se llega por el stepper sin haber pasado por el período —o la lista quedó de otro—, se lee
     acá: la ficha y el documento necesitan los movimientos. */
  const { cargando, listo } = useMovimientosCtaCte()
  /* Las facturas del estado de cuenta: ya leídas en la etapa anterior (caché), o se leen acá. */
  const facturasLeidas = useFacturasAdeudadas()
  const incluyeEstado = resumenEstadoCtaCte === 'INCLUIR'
  const { fase, estado, error, puedeReintentar, emitir } = useEmision(RESUMEN_CTA_CTE_EMISIBLE)
  const [aviso, setAviso] = useState<Aviso | null>(null)
  const [marcarFormato, setMarcarFormato] = useState(false)

  const anterior = pasoAnterior('resumenCtaCte', tipoOperacion, incluyeEstado)
  const movimientos = listo ? movimientosCtaCte : []
  const saldoFinal = movimientos.length > 0 ? movimientos[movimientos.length - 1].saldoFinal : 0

  const emitirResumen = () => {
    /* El formato primero: es el único dato de ESTA etapa, y el que la ficha marca en rojo. */
    if (!resumenFormato) {
      setMarcarFormato(true)
      setAviso('sin-formato')
      return
    }
    if (!resumenRango || cargando) {
      setAviso('sin-periodo')
      return
    }
    if (!ctaCteId) {
      setAviso('sin-cuenta')
      return
    }
    /* El período se calcula AL EMITIR, contra la fecha de hoy: es el mismo que muestra la ficha. */
    void emitir({
      ctaCteId,
      formato: resumenFormato,
      periodo: periodoDeRango(resumenRango),
      incluyeEstado,
    })
  }

  /* Cierra la operación y deja la app lista para la próxima. Sin el resumen emitido el botón sigue
     activo a propósito: la ventana explica por qué no se puede cerrar. */
  const finalizar = () => {
    if (fase !== 'emitido') {
      setAviso('sin-emitir')
      return
    }
    dispatch({ type: 'reset' })
  }

  return (
    <section className="view recibo-v2 resumen-v2 paso-layout">
      <PasoHeader />

      <div className="paso-body">
        <PasoTitulo
          numero={numeroDePaso('resumenCtaCte', tipoOperacion, incluyeEstado)}
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
              saldoFinal={saldoFinal}
              mercaderiaPendFacturar={listo ? mercaderiaPendFacturar : 0}
              fase={fase}
              error={error}
              puedeReintentar={puedeReintentar}
              marcarFormato={marcarFormato}
              onEmitir={emitirResumen}
            />

            <div className="recibo-col-der">
              <ResumenCtaCteAGenerar
                cliente={cliente}
                movimientos={movimientos}
                rango={resumenRango}
                formato={resumenFormato}
                mercaderiaPendFacturar={listo ? mercaderiaPendFacturar : 0}
                incluyeEstado={incluyeEstado}
                facturas={facturasLeidas.listo ? facturasAdeudadas : []}
                cargandoFacturas={facturasLeidas.cargando}
                fase={fase}
                estado={estado}
              />

              <EnviarDocumento documento="resumenCtaCte" numero={`Resumen Cta Cte ${cliente.codigo}`} />
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
            <button type="button" className="btn btn-primary" onClick={finalizar}>
              <i className="fas fa-flag-checkered" /> Finalizar Operación
            </button>
          </div>
        </div>
      </div>

      {aviso === 'sin-formato' && (
        <AvisoModal titulo="Falta elegir el formato" onClose={() => setAviso(null)}>
          Para emitir el resumen de cuenta corriente tenés que seleccionar en{' '}
          <strong>Formato</strong> si el archivo se genera en Excel, en PDF o en ambos.
        </AvisoModal>
      )}
      {aviso === 'sin-periodo' && (
        <AvisoModal titulo="Falta el período del resumen" onClose={() => setAviso(null)}>
          Todavía no están los movimientos del período. Volvé al paso{' '}
          {numeroDePaso('rangoFechas', tipoOperacion, incluyeEstado)} para elegir el rango de fechas,
          terminen de cargar.
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
          La operación no queda cerrada hasta que se emite el resumen de cuenta corriente. Emitilo
          desde la ficha y después finalizá la operación.
        </AvisoModal>
      )}
    </section>
  )
}
