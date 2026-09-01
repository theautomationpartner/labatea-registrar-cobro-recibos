interface FiltroFacturasProps {
  valor: string
  onValor: (valor: string) => void
  /** Anula el filtro y vuelve a mostrar la lista completa. */
  onVerTodas: () => void
  hayFiltro: boolean
  /**
   * Marca o desmarca TODAS las facturas a la vista. Es una sola acción con dos caras: mientras
   * quede alguna sin marcar suma las que faltan, y con todas marcadas las libera.
   */
  onAlternarTodas: () => void
  /** Todas las facturas visibles están seleccionadas: el botón pasa a "Deseleccionar todos". */
  todasElegidas: boolean
  /** No hay facturas a la vista: no hay nada que marcar ni que liberar. */
  sinFacturas: boolean
  /**
   * La lista todavía no está (se está consultando, o no hay cliente). La barra se muestra igual
   * —su lugar es fijo— pero sin poder usarse: filtrar una lista que no llegó no haría nada.
   */
  deshabilitado?: boolean
  /**
   * Texto del campo vacío y su etiqueta accesible. Por defecto, los de COBROS. El módulo de PAGOS
   * los cambia para nombrar la factura de compra; el resto de la barra —los dos botones, sus
   * tooltips y su comportamiento— es idéntico.
   */
  placeholder?: string
  aria?: string
}

/**
 * Barra de filtrado de la tabla: buscar una factura por su número y volver a la lista completa.
 *
 * "Ver todas" queda apagada mientras no haya un filtro puesto —no hay nada que anular—, y el
 * `title` explica por qué en vez de dejar un botón mudo. Marcar facturas es trabajo de las casillas
 * de la tabla: la del encabezado marca o desmarca todo lo que está a la vista, así que un botón
 * aparte para lo mismo sólo agregaba una segunda forma de hacer lo que ya se hace en su lugar.
 */
export function FiltroFacturas({
  valor,
  onValor,
  onVerTodas,
  hayFiltro,
  onAlternarTodas,
  todasElegidas,
  sinFacturas,
  deshabilitado = false,
  placeholder = 'Filtrar por número de factura...',
  aria = 'Filtrar facturas por número',
}: FiltroFacturasProps) {
  return (
    <div className="fact-filtro">
      <div className="fact-filtro-campo">
        <i className="fas fa-search" aria-hidden="true" />
        <input
          type="text"
          className="fact-filtro-input"
          placeholder={placeholder}
          autoComplete="off"
          aria-label={aria}
          disabled={deshabilitado}
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

      {/* Un solo botón para las dos acciones: son la misma decisión —"todas sí" o "todas no"— y
          alternarlas en el mismo lugar evita tener un control muerto la mitad del tiempo. Opera
          sobre lo VISIBLE: con un filtro puesto, marcar en silencio lo que no está en pantalla
          sería lo contrario de lo que el usuario pidió al filtrar. */}
      <button
        type="button"
        className="fact-filtro-btn fact-filtro-btn--todas"
        disabled={sinFacturas || deshabilitado}
        title={
          sinFacturas
            ? 'No hay facturas para seleccionar.'
            : todasElegidas
              ? 'Quitar la selección de todas las facturas a la vista.'
              : 'Seleccionar todas las facturas a la vista.'
        }
        onClick={onAlternarTodas}
      >
        <span className="fact-filtro-btn-cara">
          {todasElegidas ? (
            <>
              <i className="fas fa-square-minus" /> Deseleccionar todos
            </>
          ) : (
            <>
              <i className="fas fa-check-double" /> Seleccionar todos
            </>
          )}
        </span>
        {/* Fantasma con la etiqueta MÁS LARGA: es lo que fija el ancho del botón. Sin él, alternar
            entre "Seleccionar" y "Deseleccionar" cambiaba su medida y el buscador de al lado se
            estiraba y encogía de golpe. Reservar por construcción evita adivinar un ancho en px. */}
        <span className="fact-filtro-btn-fantasma" aria-hidden="true">
          <i className="fas fa-square-minus" /> Deseleccionar todos
        </span>
      </button>

      <button
        type="button"
        className="fact-filtro-btn"
        disabled={!hayFiltro || deshabilitado}
        title={hayFiltro ? undefined : 'No hay ningún filtro aplicado.'}
        onClick={onVerTodas}
      >
        <i className="fas fa-list" /> Ver todas
      </button>
    </div>
  )
}
