import {
  MSG_PERIODO,
  OPCIONES_ESTADO_CTA_CTE,
  periodoDelCriterio,
  RANGOS_RESUMEN,
} from '@/lib/resumenCtaCte'
import { criterioResumen, generacionResumenEnVuelo } from '@/state/appState'
import { useApp, useDispatch } from '@/state/hooks'
import type { EstadoCtaCteResumen, RangoResumen } from '@/types'

/** En qué anda la búsqueda de la cuenta corriente, ya resumida para la pantalla. */
export interface BusquedaResumen {
  /** `idle` = todavía no se apretó "Confirmar". */
  estado: 'idle' | 'buscando' | 'listo' | 'fallo'
  /** Cuántos movimientos trajo el período. */
  movimientos: number
  /** Cuántos comprobantes pendientes trajo, o `null` si el resumen va sin el estado de la cuenta. */
  comprobantes: number | null
  /** Se leyó y el cliente no tiene cuenta corriente asignada: no hay resumen posible. */
  sinCuenta: boolean
  onBuscar: () => void
  onReintentar: () => void
}

interface ConfigResumenCtaCteProps {
  /** Se intentó buscar con un criterio que no define período: los campos quedan en rojo. */
  marcarPeriodo: boolean
  /** Se intentó buscar sin contestar si el resumen lleva el estado de la cuenta. */
  marcarEstado: boolean
  busqueda: BusquedaResumen
}

/** El ícono con el que se reconoce cada respuesta en su caja. */
const ICONO_ESTADO: Record<EstadoCtaCteResumen, string> = {
  INCLUIR: 'fa-circle-check',
  NO_INCLUIR: 'fa-circle-minus',
}

/**
 * El formulario de la etapa "Configurar Emisión de Resumen de Cuenta": qué movimientos de la cuenta
 * corriente del cliente entran en el documento y si el resumen va acompañado del estado de la cuenta.
 *
 * Son tres preguntas, en el orden en que se deciden:
 *
 *   1. una VENTANA de días contada desde hoy ("Últimos 30 días"),
 *   2. un RANGO de fechas concretas,
 *   3. si el documento lleva el estado de la cuenta corriente.
 *
 * Las dos primeras se combinan punta por punta y la FECHA manda sobre el período (ver
 * `periodoDelCriterio`), que es lo que permite pedir "el último año, pero del 01/01/2025 al
 * 01/07/2025". Al menos una hace falta; la tercera es obligatoria siempre.
 *
 * La consulta NO sale sola: la dispara el botón "Confirmar", igual que el buscador de clientes del
 * paso 1. Mientras el tablero contesta, el formulario muestra en qué anda —y al terminar, qué
 * trajo—, porque de ese resultado salen los documentos de la etapa siguiente.
 */
export function ConfigResumenCtaCte({
  marcarPeriodo,
  marcarEstado,
  busqueda,
}: ConfigResumenCtaCteProps) {
  const state = useApp()
  const { resumenRango, resumenDesde, resumenHasta, resumenEstadoCtaCte } = state
  const dispatch = useDispatch()

  const { problema } = periodoDelCriterio(criterioResumen(state))
  /* Con la generación en vuelo el criterio queda fijo: el archivo que se está armando es de ESTE. */
  const trabado = generacionResumenEnVuelo(state)

  /* Que FALTE el criterio se pinta en rojo recién después de intentar buscar: al entrar al paso no
     hay nada elegido todavía y eso no es un error. Un criterio IMPOSIBLE —fechas al revés, o una
     ventana que arranca después de la fecha de corte— se marca en cuanto pasa: ahí ya hay algo mal
     cargado. */
  const errorCriterio = problema !== null && (problema !== 'sin-criterio' || marcarPeriodo)
  const errorFechas = errorCriterio && problema !== 'sin-criterio'
  const errorRango = errorCriterio && !errorFechas
  const errorEstado = marcarEstado && !resumenEstadoCtaCte
  const conFechas = !!resumenDesde || !!resumenHasta

  return (
    <section className="card res-form">
      <header className="res-form-head">
        <i className="fas fa-clipboard-list" aria-hidden="true" />
        <h3 className="res-form-head-tit">Movimientos de la cuenta corriente</h3>
      </header>

      <div className="res-form-body">
        {/* Los dos filtros van en la MISMA línea: son dos maneras de acotar lo mismo y se combinan. */}
        <div className="res-form-fila">
          <div className="res-campo res-campo--ancho">
            <label className="res-campo-lbl" htmlFor="res-rango">
              Buscar movimientos en la cuenta corriente de los:
            </label>
            <select
              id="res-rango"
              className={`res-campo-in ${resumenRango ? '' : 'res-campo-in--ph'} ${
                errorRango ? 'res-campo-in--error' : ''
              }`}
              aria-invalid={errorRango || undefined}
              disabled={trabado}
              value={resumenRango ?? ''}
              onChange={(e) =>
                dispatch({
                  type: 'setResumenRango',
                  rango: e.target.value ? (e.target.value as RangoResumen) : null,
                })
              }
            >
              {/* Se puede volver a dejarlo sin elegir: el criterio puede ser sólo de fechas. */}
              <option value="">Seleccionar...</option>
              {RANGOS_RESUMEN.map((r) => (
                <option key={r.valor} value={r.valor}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          <div className="res-campo">
            <label className="res-campo-lbl" htmlFor="res-desde">
              Seleccionar rango de fechas
            </label>
            <div className="res-fechas">
              <input
                id="res-desde"
                type="date"
                className={`res-campo-in ${errorFechas ? 'res-campo-in--error' : ''}`}
                aria-label="Fecha desde"
                aria-invalid={errorFechas || undefined}
                disabled={trabado}
                value={resumenDesde}
                onChange={(e) => dispatch({ type: 'setResumenDesde', fecha: e.target.value })}
              />
              <span className="res-fechas-nexo">al</span>
              <input
                id="res-hasta"
                type="date"
                className={`res-campo-in ${errorFechas ? 'res-campo-in--error' : ''}`}
                aria-label="Fecha hasta"
                aria-invalid={errorFechas || undefined}
                disabled={trabado}
                value={resumenHasta}
                onChange={(e) => dispatch({ type: 'setResumenHasta', fecha: e.target.value })}
              />
              {/* Vaciar los dos campos a mano es incómodo: con un click el criterio vuelve a ser
                  sólo el período. */}
              {conFechas && !trabado && (
                <button
                  type="button"
                  className="res-form-limpiar"
                  onClick={() => {
                    dispatch({ type: 'setResumenDesde', fecha: '' })
                    dispatch({ type: 'setResumenHasta', fecha: '' })
                  }}
                >
                  <i className="fas fa-eraser" /> Limpiar fechas
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Lo único que el formulario escribe de más es lo que está MAL cargado: qué período resultó
            no hace falta contarlo, se lee de los propios campos. */}
        {errorCriterio && problema && (
          <p className="res-form-nota res-form-nota--error">
            <i className="fas fa-circle-exclamation" /> {MSG_PERIODO[problema]}
          </p>
        )}

        {/* La última pregunta y, a su derecha —a la misma altura y con la misma separación que hay
            entre las dos cajas—, el botón que dispara la consulta. */}
        <div className="res-form-cierre">
          <fieldset className="res-form-pregunta">
            <legend className="res-campo-lbl">
              ¿Desea incluir el estado de cuenta corriente?
              <span className="res-campo-req">*</span>
            </legend>
            <div className="res-opciones">
              {OPCIONES_ESTADO_CTA_CTE.map((o) => {
                const elegida = resumenEstadoCtaCte === o.valor
                return (
                  <label
                    key={o.valor}
                    /* La respuesta elegida se marca por el BORDE de su caja —verde la que suma el
                       estado de cuenta, gris la que no—: son dos opciones a la vista, no una lista
                       de tildes que haya que leer una por una. */
                    className={`res-opcion ${
                      elegida ? `res-opcion--on res-opcion--${o.valor.toLowerCase()}` : ''
                    } ${errorEstado ? 'res-opcion--error' : ''} ${trabado ? 'res-opcion--off' : ''}`}
                  >
                    <input
                      type="radio"
                      name="res-estado"
                      className="res-opcion-input"
                      value={o.valor}
                      checked={elegida}
                      disabled={trabado}
                      onChange={() => dispatch({ type: 'setResumenEstadoCtaCte', estado: o.valor })}
                    />
                    <i className={`fas ${ICONO_ESTADO[o.valor]} res-opcion-ic`} aria-hidden="true" />
                    <span className="res-opcion-txt">{o.label}</span>
                  </label>
                )
              })}
            </div>
          </fieldset>

          <button
            type="button"
            className="btn-buscar res-buscar"
            disabled={busqueda.estado === 'buscando' || trabado}
            onClick={busqueda.onBuscar}
          >
            <i className="fas fa-search" /> Confirmar
          </button>
        </div>

        {/* En qué anda la consulta, centrado al pie del formulario: es lo que explica que el avance
            espere, y al terminar es el recibo de lo que se trajo.

            El renglón está SIEMPRE, aunque todavía no se haya buscado nada: si apareciera recién al
            apretar Confirmar, la card crecería de golpe y todo lo de abajo —el pie con sus botones—
            saltaría de lugar justo cuando el usuario acaba de hacer click. */}
        <div className={`res-busqueda res-busqueda--${busqueda.estado}`} aria-live="polite">
          {busqueda.estado === 'idle' ? null : busqueda.estado === 'buscando' ? (
            <>
              <i className="fas fa-circle-notch fa-spin" /> Buscando movimientos en la cuenta
              corriente...
            </>
          ) : busqueda.estado === 'fallo' ? (
            <>
              <i className="fas fa-circle-exclamation" /> No se pudo leer la cuenta corriente.
              <button type="button" className="res-form-limpiar" onClick={busqueda.onReintentar}>
                <i className="fas fa-rotate-right" /> Reintentar
              </button>
            </>
          ) : busqueda.sinCuenta ? (
            <>
              <i className="fas fa-circle-exclamation" /> El cliente no tiene una cuenta corriente
              asignada: no hay movimientos que resumir.
            </>
          ) : (
            <>
              <i className="fas fa-circle-check" /> {busqueda.movimientos}{' '}
              {busqueda.movimientos === 1 ? 'movimiento encontrado' : 'movimientos encontrados'}
              {busqueda.comprobantes !== null && (
                <>
                  {' '}
                  y {busqueda.comprobantes}{' '}
                  {busqueda.comprobantes === 1 ? 'comprobante pendiente' : 'comprobantes pendientes'}
                </>
              )}
              .
            </>
          )}
        </div>
      </div>
    </section>
  )
}
