import { desdeIso } from '@/lib/dates'
import {
  esIsoFecha,
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
 * Son dos preguntas, las dos obligatorias:
 *
 *   1. el PERÍODO: una ventana de días contada desde hoy ("Últimos 30 días") o un período
 *      personalizado, que despliega debajo las dos fechas con que se arma (ver `periodoDelCriterio`),
 *   2. si el documento lleva el estado de la cuenta corriente.
 *
 * Debajo del período se lee siempre de qué fecha a qué fecha se va a buscar: con una ventana, es la
 * cuenta hecha; con el personalizado, lo que se lleva cargado.
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

  const { periodo, problema } = periodoDelCriterio(criterioResumen(state))
  /* Con la generación en vuelo el criterio queda fijo: el archivo que se está armando es de ESTE. */
  const trabado = generacionResumenEnVuelo(state)

  /* Que FALTE algo —el período, o una fecha del personalizado— se pinta en rojo recién después de
     intentar buscar: al entrar al paso no hay nada elegido todavía y eso no es un error. Las fechas
     AL REVÉS se marcan en cuanto pasa: ahí ya hay algo mal cargado. */
  const errorCriterio = problema !== null && (problema === 'fechas-invertidas' || marcarPeriodo)
  const errorRango = errorCriterio && problema === 'sin-criterio'
  /* Fechas al revés: las dos en rojo. Falta alguna: sólo la que está vacía. */
  const errorFechas = errorCriterio && problema !== 'sin-criterio'
  const errorDesde = errorFechas && (problema === 'fechas-invertidas' || !resumenDesde)
  const errorHasta = errorFechas && (problema === 'fechas-invertidas' || !resumenHasta)
  const errorEstado = marcarEstado && !resumenEstadoCtaCte
  const personalizado = resumenRango === 'personalizado'
  const conFechas = !!resumenDesde || !!resumenHasta

  /* Las puntas que se leen debajo del selector: con una ventana, la cuenta ya hecha; con el
     personalizado, lo que se lleva cargado —y la fecha que falta, como el hueco que es—. */
  const puntas = personalizado ? { desde: resumenDesde, hasta: resumenHasta } : periodo
  const fecha = (iso: string) => (esIsoFecha(iso) ? desdeIso(iso) : 'dd/mm/aaaa')

  return (
    <section className="card res-form">
      <header className="res-form-head">
        <i className="fas fa-clipboard-list" aria-hidden="true" />
        <h3 className="res-form-head-tit">Movimientos de la cuenta corriente</h3>
      </header>

      <div className="res-form-body">
        <div className="res-periodo">
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
              <option value="">Seleccionar...</option>
              {RANGOS_RESUMEN.map((r) => (
                <option key={r.valor} value={r.valor}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          {/* Las fechas existen SÓLO para el período personalizado: aparecen desplegándose debajo
              del selector en cuanto se lo elige. */}
          {personalizado && (
            <div className="res-campo res-periodo-fechas">
              <div className="res-fechas">
                <input
                  id="res-desde"
                  type="date"
                  className={`res-campo-in ${errorDesde ? 'res-campo-in--error' : ''}`}
                  aria-label="Fecha desde"
                  aria-invalid={errorDesde || undefined}
                  disabled={trabado}
                  value={resumenDesde}
                  onChange={(e) => dispatch({ type: 'setResumenDesde', fecha: e.target.value })}
                />
                <span className="res-fechas-nexo">al</span>
                <input
                  id="res-hasta"
                  type="date"
                  className={`res-campo-in ${errorHasta ? 'res-campo-in--error' : ''}`}
                  aria-label="Fecha hasta"
                  aria-invalid={errorHasta || undefined}
                  disabled={trabado}
                  value={resumenHasta}
                  onChange={(e) => dispatch({ type: 'setResumenHasta', fecha: e.target.value })}
                />
                {/* Vaciar los dos campos a mano es incómodo: con un click se vuelve a empezar. */}
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
          )}

          {puntas && (
            <p className="res-periodo-rango">
              <i className="fas fa-calendar-days" aria-hidden="true" /> Se buscarán los movimientos
              desde <strong>{fecha(puntas.desde)}</strong> al <strong>{fecha(puntas.hasta)}</strong>
            </p>
          )}
        </div>

        {/* Lo que está MAL cargado, aparte del renglón que cuenta de qué fecha a qué fecha se busca. */}
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
