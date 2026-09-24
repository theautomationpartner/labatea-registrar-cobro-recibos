import { useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { useEmision } from '@/features/recibo/useEmisionRecibo'
import { RESUMEN_CTA_CTE_EMISIBLE } from '@/features/shared/emisiones'
import { EnviarDocumento } from '@/features/shared/EnviarDocumento'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { descripcionDePaso, etiquetaDePaso, numeroDePaso, pasoAnterior } from '@/lib/pasos'
import { periodoDelCriterio, rotuloCriterio } from '@/lib/resumenCtaCte'
import { criterioResumen } from '@/state/appState'
import { useApp, useDispatch } from '@/state/hooks'
import { FichaResumenCtaCte } from './FichaResumenCtaCte'
import { ResumenCtaCteAGenerar } from './ResumenCtaCteAGenerar'
import { useFacturasAdeudadas } from './useFacturasAdeudadas'
import { useMovimientosCtaCte } from './useMovimientosCtaCte'

/** Qué ventana está abierta, si hay una. */
type Aviso = 'sin-formato' | 'sin-periodo' | 'cargando' | 'fallo' | 'sin-cuenta' | 'sin-emitir'

/**
 * RESUMEN DE CTA CTE · paso 2 y último: emitir el resumen y enviárselo al cliente. Misma grilla que
 * la emisión del recibo —la ficha con el botón a la izquierda, el documento y su envío a la derecha—.
 *
 * ACÁ se consulta la cuenta: al entrar a esta etapa salen las dos lecturas que arman los documentos
 * —los movimientos del período y, si el resumen lleva el estado de la cuenta, las facturas que el
 * cliente debe—, con lo elegido en el paso 1. Los resultados se ven en las cards "Resumen de Cta
 * Cte" y "Estado de Cta Cte", que es donde tienen sentido: ya con la forma del documento.
 *
 * Emitir NO crea un ítem: deja escrito el pedido en la cuenta corriente del cliente y le pide al
 * tablero que genere el archivo, y se sigue esa generación hasta que cierre (ver
 * `RESUMEN_CTA_CTE_EMISIBLE`). El envío se habilita recién con el archivo generado.
 */
export function ResumenCtaCteView() {
  const state = useApp()
  const {
    cliente,
    tipoOperacion,
    movimientosCtaCte,
    mercaderiaPendFacturar,
    ctaCteId,
    resumenFormato,
    resumenEstadoCtaCte,
    facturasAdeudadas,
  } = state
  const dispatch = useDispatch()

  const criterio = criterioResumen(state)
  const { periodo } = periodoDelCriterio(criterio)
  const incluyeEstado = resumenEstadoCtaCte === 'INCLUIR'
  /* Las dos lecturas de la etapa. Las facturas SÓLO si el resumen las va a mostrar: sin el estado de
     la cuenta no hay documento que las liste. */
  const lectura = useMovimientosCtaCte()
  const facturas = useFacturasAdeudadas(incluyeEstado)

  const { fase, estado, error, documentos, puedeReintentar, emitir } =
    useEmision(RESUMEN_CTA_CTE_EMISIBLE)
  const [aviso, setAviso] = useState<Aviso | null>(null)
  const [marcarFormato, setMarcarFormato] = useState(false)

  const anterior = pasoAnterior('resumenCtaCte', tipoOperacion)
  const movimientos = lectura.listo ? movimientosCtaCte : []
  const saldoFinal = movimientos.length > 0 ? movimientos[movimientos.length - 1].saldoFinal : 0
  /* La cuenta se leyó y el cliente no tiene ninguna asignada: no hay sobre qué emitir. */
  const sinCuenta = lectura.listo && ctaCteId === null

  const emitirResumen = () => {
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
    if (lectura.cargando) {
      setAviso('cargando')
      return
    }
    if (lectura.fallo) {
      setAviso('fallo')
      return
    }
    if (!ctaCteId) {
      setAviso('sin-cuenta')
      return
    }
    void emitir({ ctaCteId, formato: resumenFormato, periodo, incluyeEstado })
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
              fase={fase}
              error={error}
              documentos={documentos}
              puedeReintentar={puedeReintentar}
              marcarFormato={marcarFormato}
              onEmitir={emitirResumen}
            />

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
                facturas={facturas.listo ? facturasAdeudadas : []}
                cargandoFacturas={facturas.cargando}
                fase={fase}
                documentos={documentos}
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
          No hay un período definido para el resumen. Volvé al paso{' '}
          {numeroDePaso('cliente', tipoOperacion)} e indicá qué movimientos de la cuenta corriente
          entran.
        </AvisoModal>
      )}
      {aviso === 'cargando' && (
        <AvisoModal titulo="Los movimientos todavía se están cargando" onClose={() => setAviso(null)}>
          Esperá a que terminen de cargarse los movimientos del período y volvé a intentar.
        </AvisoModal>
      )}
      {aviso === 'fallo' && (
        <AvisoModal titulo="No se pudieron leer los movimientos" onClose={() => setAviso(null)}>
          Sin los movimientos de la cuenta corriente no se puede armar el resumen. Usá
          <strong> Reintentar</strong> y, cuando carguen, emitilo.
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
