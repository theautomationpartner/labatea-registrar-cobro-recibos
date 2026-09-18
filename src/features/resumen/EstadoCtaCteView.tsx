import { useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import {
  descripcionDePaso,
  descripcionFacturasQueDebe,
  etiquetaDePaso,
  numeroDePaso,
  pasoAnterior,
  siguientePaso,
} from '@/lib/pasos'
import { MOVIMIENTOS_POR_PAGINA, totalesDeFacturas } from '@/lib/resumenCtaCte'
import { useApp, useDispatch } from '@/state/hooks'
import { PanelTresMetricas } from './PanelTresMetricas'
import { TablaFacturasAdeudadas } from './TablaFacturasAdeudadas'
import { useFacturasAdeudadas } from './useFacturasAdeudadas'

/**
 * RESUMEN DE CTA CTE · paso 3: FACTURAS QUE DEBE. Las facturas del cliente que todavía no están
 * canceladas al 100%, con su vencimiento.
 *
 * Es la MISMA pantalla que la del rango de fechas, pieza por pieza: la tabla (`TablaPaginada`, de a
 * diez con alto fijo) y, cerrando la card, el panel de tres métricas del PASE DE SALDO con TOTAL
 * DEUDA, TOTAL COBRADO y DEUDA PENDIENTE. Por eso la vista se monta con las mismas clases
 * (`cobro-v2 pases-v2 resumen-v2`). Es sólo informativa: nada se elige ni se edita.
 *
 * La deuda NO depende del período del paso 2: es la que el cliente tiene hoy.
 */
export function EstadoCtaCteView() {
  const { cliente, tipoOperacion, facturasAdeudadas } = useApp()
  const dispatch = useDispatch()
  const { cargando, fallo, listo, reintentar } = useFacturasAdeudadas()
  const [aviso, setAviso] = useState<'cargando' | 'fallo' | null>(null)

  /* Esta etapa existe SÓLO cuando el resumen lleva el estado de cuenta: si se llegó hasta acá,
     el recorrido es el largo. De ahí el true fijo. */
  const destino = siguientePaso('estadoCtaCte', tipoOperacion, true)
  const anterior = pasoAnterior('estadoCtaCte', tipoOperacion, true)
  const SIGUIENTE_PASO = destino ? etiquetaDePaso(destino, tipoOperacion) : ''
  const conTabla = listo && facturasAdeudadas.length > 0
  const totales = totalesDeFacturas(facturasAdeudadas)

  /* Se puede seguir aunque no deba nada; lo que no se deja es avanzar sin saberlo todavía. */
  const continuar = () => {
    if (cliente && (cargando || fallo)) {
      setAviso(cargando ? 'cargando' : 'fallo')
      return
    }
    if (destino) dispatch({ type: 'goto', paso: destino })
  }

  return (
    <section className="view cobro-v2 pases-v2 resumen-v2 paso-layout">
      <PasoHeader />

      <div className="paso-body">
        <PasoTitulo
          numero={numeroDePaso('estadoCtaCte', tipoOperacion, true)}
          titulo={etiquetaDePaso('estadoCtaCte', tipoOperacion)}
          descripcion={
            cliente
              ? descripcionFacturasQueDebe(cliente.name)
              : descripcionDePaso('estadoCtaCte', tipoOperacion)
          }
        />

        <div className="cobro-static">
          {/* Con la tabla a la vista, el panel de totales CIERRA la card, como en el paso anterior. */}
          <div className={`cobro-card ${conTabla ? 'cobro-card--cierre' : ''}`}>
            {!cliente ? (
              <p className="cobro-vacio">
                <i className="fas fa-user-slash" /> Todavía no hay un cliente seleccionado. Volvé al
                paso 1 para elegirlo.
              </p>
            ) : (
              <>
                <h3 className="cobro-card-title">Facturas pendientes de {cliente.name}</h3>

                {cargando ? (
                  <p className="cobro-vacio">
                    <i className="fas fa-spinner fa-spin" /> Buscando las facturas que debe el
                    cliente...
                  </p>
                ) : fallo ? (
                  <p className="cobro-vacio">
                    <i className="fas fa-triangle-exclamation" /> No se pudieron leer las facturas del
                    cliente.{' '}
                    <button type="button" className="cobro-reintentar" onClick={reintentar}>
                      Reintentar
                    </button>
                  </p>
                ) : facturasAdeudadas.length === 0 ? (
                  <p className="cobro-vacio">
                    <i className="fas fa-circle-check" /> <strong>{cliente.name}</strong> no tiene
                    facturas pendientes de cobro.
                  </p>
                ) : (
                  /* De a diez por página, con el mismo alto fijo que la tabla de movimientos. La
                     `key` es el cliente: otra lista arranca en la primera página. */
                  <TablaFacturasAdeudadas
                    key={cliente.id}
                    facturas={facturasAdeudadas}
                    porPagina={MOVIMIENTOS_POR_PAGINA}
                  />
                )}

                {/* Los totales de TODAS las facturas, no de la página en pantalla. */}
                {conTabla && (
                  <PanelTresMetricas
                    titulo="Resumen de Facturas Adeudadas"
                    primera={{ rotulo: 'TOTAL DEUDA', importe: totales.deuda }}
                    segunda={{ rotulo: 'TOTAL COBRADO', importe: totales.cobrado }}
                    tercera={{ rotulo: 'DEUDA PENDIENTE', importe: totales.pendiente }}
                  />
                )}
              </>
            )}
          </div>
        </div>

        <div className="actions-footer">
          <button
            type="button"
            className="btn btn-out"
            onClick={() => anterior && dispatch({ type: 'goto', paso: anterior })}
          >
            <i className="fas fa-arrow-left" /> Volver
          </button>
          <div className="actions-footer-fin">
            <button type="button" className="btn btn-primary" onClick={continuar}>
              Continuar a {SIGUIENTE_PASO} <i className="fas fa-arrow-right" />
            </button>
          </div>
        </div>
      </div>

      {aviso === 'cargando' && (
        <AvisoModal titulo="Las facturas todavía se están cargando" onClose={() => setAviso(null)}>
          Esperá a que terminen de cargarse las facturas que debe el cliente y volvé a intentar.
        </AvisoModal>
      )}
      {aviso === 'fallo' && (
        <AvisoModal titulo="No se pudieron leer las facturas" onClose={() => setAviso(null)}>
          Usá <strong>Reintentar</strong> para volver a leer las facturas que debe el cliente y,
          cuando carguen, continuá.
        </AvisoModal>
      )}
    </section>
  )
}
