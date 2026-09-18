import { paginasVisibles } from '@/lib/resumenCtaCte'

interface PaginadorMovimientosProps {
  pagina: number
  totalPaginas: number
  /** Posición de la primera y la última fila de la página, y cuántas hay en total. */
  desde: number
  hasta: number
  total: number
  /** Cómo se nombran las filas: "movimientos", "facturas". */
  sustantivo: string
  onCambiar: (pagina: number) => void
}

/**
 * Navegación entre páginas de una tabla del resumen (ver `TablaPaginada`): a la izquierda qué filas
 * se están viendo y a la derecha los botones —anterior, los números de página y siguiente—.
 *
 * Son los ÚNICOS controles de la tabla: mueven qué filas se muestran, nunca los datos. Los botones de
 * las puntas se apagan en la primera y la última página en vez de desaparecer, así la fila de botones
 * no cambia de ancho al navegar.
 */
export function PaginadorMovimientos({
  pagina,
  totalPaginas,
  desde,
  hasta,
  total,
  sustantivo,
  onCambiar,
}: PaginadorMovimientosProps) {
  return (
    <nav className="mov-paginador" aria-label={`Paginación de ${sustantivo}`}>
      <span className="mov-pag-info">
        Mostrando <strong>{desde}</strong>–<strong>{hasta}</strong> de <strong>{total}</strong> {sustantivo}
      </span>

      <div className="mov-pag-botones">
        <button
          type="button"
          className="mov-pag-btn"
          disabled={pagina <= 1}
          aria-label="Página anterior"
          onClick={() => onCambiar(pagina - 1)}
        >
          <i className="fas fa-chevron-left" />
        </button>

        {paginasVisibles(pagina, totalPaginas).map((n, i) =>
          n === '…' ? (
            <span key={`salto-${i}`} className="mov-pag-salto" aria-hidden="true">
              …
            </span>
          ) : (
            <button
              key={n}
              type="button"
              className={`mov-pag-btn ${n === pagina ? 'mov-pag-btn--on' : ''}`}
              aria-label={`Página ${n}`}
              aria-current={n === pagina ? 'page' : undefined}
              onClick={() => n !== pagina && onCambiar(n)}
            >
              {n}
            </button>
          ),
        )}

        <button
          type="button"
          className="mov-pag-btn"
          disabled={pagina >= totalPaginas}
          aria-label="Página siguiente"
          onClick={() => onCambiar(pagina + 1)}
        >
          <i className="fas fa-chevron-right" />
        </button>
      </div>
    </nav>
  )
}
