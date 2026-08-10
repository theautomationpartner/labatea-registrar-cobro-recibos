interface FiltroFacturasProps {
  valor: string
  onValor: (valor: string) => void
  /** Anula el filtro y vuelve a mostrar la lista completa. */
  onVerTodas: () => void
  hayFiltro: boolean
}

/**
 * Barra de filtrado de la tabla: buscar una factura por su número y volver a la lista completa.
 *
 * "Ver todas" queda apagada mientras no haya un filtro puesto —no hay nada que anular—, y el
 * `title` explica por qué en vez de dejar un botón mudo. Marcar facturas es trabajo de las casillas
 * de la tabla: la del encabezado marca o desmarca todo lo que está a la vista, así que un botón
 * aparte para lo mismo sólo agregaba una segunda forma de hacer lo que ya se hace en su lugar.
 */
export function FiltroFacturas({ valor, onValor, onVerTodas, hayFiltro }: FiltroFacturasProps) {
  return (
    <div className="fact-filtro">
      <div className="fact-filtro-campo">
        <i className="fas fa-search" aria-hidden="true" />
        <input
          type="text"
          className="fact-filtro-input"
          placeholder="Filtrar por número de factura..."
          autoComplete="off"
          aria-label="Filtrar facturas por número"
          value={valor}
          onChange={(e) => onValor(e.target.value)}
        />
        {/* Con algo tecleado, la cruz limpia el campo sin tener que borrar carácter por carácter. */}
        {valor !== '' && (
          <button
            type="button"
            className="fact-filtro-limpiar"
            aria-label="Limpiar el filtro"
            onClick={() => onValor('')}
          >
            <i className="fas fa-times" />
          </button>
        )}
      </div>

      <button
        type="button"
        className="fact-filtro-btn"
        disabled={!hayFiltro}
        title={hayFiltro ? undefined : 'No hay ningún filtro aplicado.'}
        onClick={onVerTodas}
      >
        <i className="fas fa-list" /> Ver todas
      </button>
    </div>
  )
}
