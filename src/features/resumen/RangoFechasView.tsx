import { useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { desdeIso } from '@/lib/dates'
import {
  descripcionDePaso,
  etiquetaDePaso,
  numeroDePaso,
  pasoAnterior,
  siguientePaso,
} from '@/lib/pasos'
import { MOVIMIENTOS_POR_PAGINA, periodoDeRango, RANGOS_RESUMEN } from '@/lib/resumenCtaCte'
import { generacionResumenEnVuelo } from '@/state/appState'
import { useApp, useDispatch } from '@/state/hooks'
import type { RangoResumen } from '@/types'
import { AvisoSinFecha } from './AvisoSinFecha'
import { TablaMovimientosCtaCte } from './TablaMovimientosCtaCte'
import { TotalesMovimientos } from './TotalesMovimientos'
import { useMovimientosCtaCte } from './useMovimientosCtaCte'

/** Por qué no se puede avanzar, cuando no se puede. Cada motivo tiene su ventana. */
type Bloqueo = 'sin-rango' | 'cargando' | 'fallo' | 'sin-cuenta'

/**
 * RESUMEN DE CTA CTE · paso 2: qué período abarca el resumen.
 *
 * Elegir el rango DISPARA la lectura de la cuenta corriente del cliente, y la tabla muestra los
 * movimientos que caen en ese período. La tabla es sólo informativa —nada se edita ni se clickea—:
 * sirve para revisar QUÉ va a documentar el resumen antes de emitirlo.
 */
export function RangoFechasView() {
  const state = useApp()
  const {
    cliente,
    resumenRango,
    resumenEstadoCtaCte,
    movimientosCtaCte,
    movimientosCtaCteClave,
    movimientosSinFecha,
    ctaCteId,
    tipoOperacion,
  } = state
  const dispatch = useDispatch()
  const { cargando, fallo, listo, reintentar } = useMovimientosCtaCte()
  const [bloqueo, setBloqueo] = useState<Bloqueo | null>(null)
  /* Se intentó avanzar sin rango: el selector queda en rojo hasta que se elija uno. */
  const [marcarRango, setMarcarRango] = useState(false)

  /* Sin estado de cuenta, de acá se va derecho a la emisión: no hay facturas que listar. */
  const incluyeEstado = resumenEstadoCtaCte === 'INCLUIR'
  const destino = siguientePaso('rangoFechas', tipoOperacion, incluyeEstado)
  const anterior = pasoAnterior('rangoFechas', tipoOperacion, incluyeEstado)
  const SIGUIENTE_PASO = destino ? etiquetaDePaso(destino, tipoOperacion) : ''
  const periodo = resumenRango ? periodoDeRango(resumenRango) : null
  const sinCuenta = listo && ctaCteId === null
  /* La tabla (y con ella el panel de totales) se dibuja sólo con movimientos del período ya leídos. */
  const conTabla = !!resumenRango && listo && !sinCuenta && movimientosCtaCte.length > 0
  /* Con el resumen generándose no se cambia el período: el archivo en curso es de ESTE. */
  const rangoTrabado = generacionResumenEnVuelo(state)

  const continuar = () => {
    const motivo: Bloqueo | null = !resumenRango
      ? 'sin-rango'
      : cargando
        ? 'cargando'
        : fallo
          ? 'fallo'
          : sinCuenta
            ? 'sin-cuenta'
            : null
    if (motivo) {
      if (motivo === 'sin-rango') setMarcarRango(true)
      setBloqueo(motivo)
      return
    }
    if (destino) dispatch({ type: 'goto', paso: destino })
  }

  return (
    <section className="view cobro-v2 pases-v2 resumen-v2 paso-layout">
      <PasoHeader />

      <div className="paso-body">
        <PasoTitulo
          numero={numeroDePaso('rangoFechas', tipoOperacion, incluyeEstado)}
          titulo={etiquetaDePaso('rangoFechas', tipoOperacion)}
          descripcion={descripcionDePaso('rangoFechas', tipoOperacion)}
        />

        {!cliente ? (
          <div className="cobro-static">
            <div className="cobro-card">
              <p className="cobro-vacio">
                <i className="fas fa-user-slash" /> Todavía no hay un cliente seleccionado. Volvé al
                paso 1 para elegirlo.
              </p>
            </div>
          </div>
        ) : (
          <div className="cobro-static">
            {/* Con la tabla a la vista, el panel de totales CIERRA la card —como en el destino del
                pase—, así que la card pierde su relleno inferior (`cobro-card--cierre`). */}
            <div className={`cobro-card ${conTabla ? 'cobro-card--cierre' : ''}`}>
              <h3 className="cobro-card-title">Movimientos de cuenta corriente de {cliente.name}</h3>

              <div className="res-rango">
                <div className="igp res-rango-campo">
                  <label htmlFor="res-rango">Rango de fechas *</label>
                  <select
                    id="res-rango"
                    className={`full res-rango-sel ${
                      marcarRango && !resumenRango ? 'res-sel--error' : ''
                    } ${resumenRango ? '' : 'res-sel--ph'}`}
                    aria-invalid={(marcarRango && !resumenRango) || undefined}
                    disabled={rangoTrabado}
                    value={resumenRango ?? ''}
                    onChange={(e) =>
                      dispatch({ type: 'setResumenRango', rango: e.target.value as RangoResumen })
                    }
                  >
                    <option value="" disabled>
                      Seleccionar...
                    </option>
                    {RANGOS_RESUMEN.map((r) => (
                      <option key={r.valor} value={r.valor}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>
                {periodo && (
                  <p className="res-periodo">
                    <i className="far fa-calendar" /> Del <strong>{desdeIso(periodo.desde)}</strong>{' '}
                    al <strong>{desdeIso(periodo.hasta)}</strong>
                  </p>
                )}
              </div>

              {!resumenRango ? (
                <p className="cobro-vacio">
                  <i className="fas fa-circle-info" /> Elegí un rango de fechas para ver los
                  movimientos de la cuenta corriente.
                </p>
              ) : cargando ? (
                <p className="cobro-vacio">
                  <i className="fas fa-spinner fa-spin" /> Buscando los movimientos de la cuenta
                  corriente...
                </p>
              ) : fallo ? (
                <p className="cobro-vacio">
                  <i className="fas fa-triangle-exclamation" /> No se pudieron leer los movimientos
                  de la cuenta corriente.{' '}
                  <button type="button" className="cobro-reintentar" onClick={reintentar}>
                    Reintentar
                  </button>
                </p>
              ) : sinCuenta ? (
                <p className="cobro-vacio">
                  <i className="fas fa-circle-exclamation" /> <strong>{cliente.name}</strong> no tiene
                  una cuenta corriente asignada en el tablero de Personas, así que no hay movimientos
                  que resumir.
                </p>
              ) : movimientosCtaCte.length === 0 ? (
                <p className="cobro-vacio">
                  <i className="fas fa-circle-info" /> La cuenta corriente no tiene movimientos en
                  este período.
                </p>
              ) : (
                /* De a diez por página. La `key` es la del cliente y el período: una lista nueva
                   arranca en la primera página. */
                <TablaMovimientosCtaCte
                  key={movimientosCtaCteClave ?? ''}
                  movimientos={movimientosCtaCte}
                  porPagina={MOVIMIENTOS_POR_PAGINA}
                />
              )}

              {listo && !sinCuenta && <AvisoSinFecha cantidad={movimientosSinFecha} />}

              {/* Los totales de TODO el período, no de la página en pantalla. Van al final: igual que
                  el resumen del destino del pase, es la banda que cierra la card. */}
              {conTabla && <TotalesMovimientos movimientos={movimientosCtaCte} />}
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
            {/* El botón NO se apaga: si falta algo, la ventana lo dice. */}
            <button type="button" className="btn btn-primary" onClick={continuar}>
              Continuar a {SIGUIENTE_PASO} <i className="fas fa-arrow-right" />
            </button>
          </div>
        </div>
      </div>

      {bloqueo === 'sin-rango' && (
        <AvisoModal titulo="Falta elegir el rango de fechas" onClose={() => setBloqueo(null)}>
          Para continuar tenés que seleccionar en <strong>Rango de fechas</strong> el período que
          abarca el resumen de cuenta corriente.
        </AvisoModal>
      )}
      {bloqueo === 'cargando' && (
        <AvisoModal titulo="Los movimientos todavía se están cargando" onClose={() => setBloqueo(null)}>
          Esperá a que terminen de cargarse los movimientos del período y volvé a intentar.
        </AvisoModal>
      )}
      {bloqueo === 'fallo' && (
        <AvisoModal titulo="No se pudieron leer los movimientos" onClose={() => setBloqueo(null)}>
          Sin los movimientos de la cuenta corriente no se puede armar el resumen. Usá
          <strong> Reintentar</strong> y, cuando carguen, continuá.
        </AvisoModal>
      )}
      {bloqueo === 'sin-cuenta' && cliente && (
        <AvisoModal titulo="El cliente no tiene cuenta corriente" onClose={() => setBloqueo(null)}>
          <strong>{cliente.name}</strong> no tiene una cuenta corriente asignada en el tablero de
          Personas, así que no es posible emitir su resumen. Asignásela y volvé a reintentar.
        </AvisoModal>
      )}
    </section>
  )
}
