import { ESTADOS_SALDO, TRAMOS_VENCIMIENTO } from '@/lib/cobranza'
import { useApp, useDispatch } from '@/state/hooks'
import type { EstadoSaldo, TramoVencimiento } from '@/types'

/**
 * Valor del select cuando NO se acota el criterio. Es una opción más de la lista y no una casilla
 * aparte: "todos" es una respuesta a la misma pregunta, no otra pregunta.
 */
const TODOS = 'TODOS'

interface CriteriosCobranzaProps {
  /** Hay una consulta en vuelo: los dos campos y el botón quedan trabados. */
  cargando: boolean
  onBuscar: () => void
}

/**
 * La configuración de la búsqueda: los DOS criterios y el botón que dispara la consulta.
 *
 * Son dos `select` y un botón, sin controles propios: es un formulario de búsqueda como el de
 * cualquier tablero. Los dos campos se arman con la MISMA estructura que los selectores del
 * encabezado —rótulo arriba, caja con su chevron a la derecha, y sus mismas clases— para que el
 * usuario no tenga que aprender dos formas de elegir algo; lo único que cambia es el color: acá la
 * caja es neutra, porque el azul del encabezado marca el contexto de toda la operación y no un campo
 * más de un formulario. Elegir una opción NO consulta nada —sólo arma el criterio—;
 * la consulta la dispara el click en "Buscar", y hasta entonces lo que está abajo sigue siendo la
 * respuesta a la búsqueda anterior.
 *
 * Cada criterio ofrece además su opción "Todos", que es con la que el tablero abre: la pregunta con
 * la que se entra a cobrar es "quién me debe", sin acotar por tramo.
 *
 * Cambiar un campo NO avisa nada: el botón "Buscar" al lado ya dice qué falta hacer, y un cartel
 * saltando con cada cambio de select era ruido en el camino de armar la consulta.
 */
export function CriteriosCobranza({ cargando, onBuscar }: CriteriosCobranzaProps) {
  const { cobranzaCriterio } = useApp()
  const dispatch = useDispatch()
  const { estados, tramos } = cobranzaCriterio

  /* El criterio viaja como LISTA —así lo consulta el servicio y así se cachea—, y el select maneja
     un valor solo: "todas las opciones" es la lista entera, y una opción elegida es una lista de
     uno. La traducción vive acá, que es el único lugar donde el criterio se elige de a uno. */
  const valorEstado = estados.length === ESTADOS_SALDO.length ? TODOS : (estados[0] ?? TODOS)
  const valorTramo = tramos.length === TRAMOS_VENCIMIENTO.length ? TODOS : (tramos[0] ?? TODOS)

  const elegirEstado = (valor: string) =>
    dispatch({
      type: 'setCobranzaEstados',
      estados: valor === TODOS ? ESTADOS_SALDO.map((e) => e.valor) : [valor as EstadoSaldo],
    })

  const elegirTramo = (valor: string) =>
    dispatch({
      type: 'setCobranzaTramos',
      tramos: valor === TODOS ? TRAMOS_VENCIMIENTO.map((t) => t.valor) : [valor as TramoVencimiento],
    })

  return (
    <div className="cbz-busqueda">
      <div className="topsel-item cbz-campo">
        <label className="topsel-lbl" htmlFor="cbz-estado">
          Obtener cuentas corrientes por:
        </label>
        <span className="cbz-selbox">
          <select
            id="cbz-estado"
            className="selbox selbox--fix selbox--btn cbz-sel"
            disabled={cargando}
            value={valorEstado}
            onChange={(e) => elegirEstado(e.target.value)}
          >
            <option value={TODOS}>Todos los estados de saldo</option>
            {ESTADOS_SALDO.map((e) => (
              <option key={e.valor} value={e.valor}>
                {e.label}
              </option>
            ))}
          </select>
          {/* El mismo chevron que los selectores del encabezado, en el mismo lugar: el del navegador
              se apaga con `appearance: none` porque cambia de dibujo en cada sistema. */}
          <i className="fas fa-chevron-down cbz-sel-chevron" aria-hidden="true" />
        </span>
      </div>

      <div className="topsel-item cbz-campo">
        <label className="topsel-lbl" htmlFor="cbz-tramo">
          Buscar facturas por:
        </label>
        <span className="cbz-selbox">
          <select
            id="cbz-tramo"
            className="selbox selbox--fix selbox--btn cbz-sel"
            disabled={cargando}
            value={valorTramo}
            onChange={(e) => elegirTramo(e.target.value)}
          >
            <option value={TODOS}>Todos los estados de vencimiento</option>
            {TRAMOS_VENCIMIENTO.map((t) => (
              <option key={t.valor} value={t.valor}>
                {t.label}
              </option>
            ))}
          </select>
          <i className="fas fa-chevron-down cbz-sel-chevron" aria-hidden="true" />
        </span>
      </div>

      <button
        type="button"
        className="btn btn-primary cbz-buscar"
        disabled={cargando}
        aria-busy={cargando}
        onClick={onBuscar}
      >
        {cargando ? (
          <>
            <i className="fas fa-circle-notch fa-spin" /> Buscando...
          </>
        ) : (
          <>
            <i className="fas fa-magnifying-glass" /> Buscar
          </>
        )}
      </button>
    </div>
  )
}
