import { useCallback, useRef, useState } from 'react'
import { useClickOutside } from '@/hooks/useClickOutside'
import { buscarClientes } from '@/services/monday'
import { useDispatch } from '@/state/hooks'
import type { Cliente } from '@/types'

/** Estado de la búsqueda del cliente, compartido con la vista para renderizar el resultado. */
export type BusquedaEstado = 'idle' | 'buscando' | 'no-encontrado' | 'error'

interface BuscarClienteProps {
  estado: BusquedaEstado
  onEstado: (estado: BusquedaEstado) => void
  /**
   * Qué hacer con el cliente elegido. Por defecto pasa a ser el cliente de la OPERACIÓN, que es el
   * caso del paso 1.
   *
   * Existe porque el buscador se usa en dos lugares con el mismo comportamiento y distinto
   * destinatario: el paso 1 elige a quién se le cobra, y el destino de un pase elige quién RECIBE
   * el saldo. Todo lo demás —cómo se busca, qué se muestra, cómo se resuelven varias coincidencias—
   * es idéntico, así que se parametriza el efecto y no se duplica el componente.
   */
  onElegir?: (cliente: Cliente) => void
  /** Texto del campo vacío. Por defecto, el del paso 1. */
  placeholder?: string
}

/**
 * Búsqueda del cliente contra el tablero de Personas de Monday (capa de servicio). Detecta si se
 * ingresó nombre, código o CUIT y no exige coincidencia exacta. Si hay una sola coincidencia se
 * carga directo; si hay varias —dos clientes con el mismo nombre— se abren como desplegable para
 * elegir cuál. El loading y el «no encontrado» los muestra la vista, no acá.
 */
export function BuscarCliente({
  estado,
  onEstado,
  onElegir,
  placeholder = 'Buscar cliente por código, nombre o CUIT...',
}: BuscarClienteProps) {
  const dispatch = useDispatch()
  // El campo arranca (y queda) vacío: no muestra el cliente elegido, para encadenar búsquedas.
  const [termino, setTermino] = useState('')
  const [errorInput, setErrorInput] = useState('')
  const [resultados, setResultados] = useState<Cliente[]>([])
  const [abierto, setAbierto] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, useCallback(() => setAbierto(false), []), abierto)
  const buscando = estado === 'buscando'

  const elegir = (c: Cliente) => {
    // El campo queda vacío tras elegir: el resultado se ve en la ficha, no en el buscador.
    setTermino('')
    setResultados([])
    setAbierto(false)
    if (onElegir) onElegir(c)
    else dispatch({ type: 'setCliente', cliente: c })
    onEstado('idle')
  }

  const buscar = async () => {
    const t = termino.trim()
    if (!t) {
      setErrorInput('Ingresá un nombre, código de cliente o CUIT.')
      return
    }
    setErrorInput('')
    setAbierto(false)
    onEstado('buscando')
    try {
      const encontrados = await buscarClientes(t)
      if (encontrados.length === 0) {
        onEstado('no-encontrado')
        return
      }
      // Una sola coincidencia: se carga directo. Varias: se muestran para elegir.
      if (encontrados.length === 1) {
        elegir(encontrados[0])
        return
      }
      setResultados(encontrados)
      setAbierto(true)
      onEstado('idle')
    } catch {
      /* El fallo de la API lo comunica la ventana global (`ModalErrorMonday`); el estado 'error'
         sólo sirve para que la vista no muestre la ficha como si hubiera resultado. */
      onEstado('error')
      dispatch({ type: 'errorMonday', accion: 'buscar el cliente' })
    }
  }

  /* Hay resultados desplegados. Se calcula una sola vez porque lo miran los dos: el campo, para
     pegarse a la lista, y la lista, para mostrarse. */
  const desplegado = abierto && resultados.length > 0

  return (
    <>
      <div className="search-container" ref={ref}>
        <div className={`search-wrapper ${desplegado ? 'search-wrapper--abierto' : ''}`}>
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            className="search-input"
            placeholder={placeholder}
            autoComplete="off"
            value={termino}
            disabled={buscando}
            onChange={(e) => {
              setTermino(e.target.value)
              if (errorInput) setErrorInput('')
              if (abierto) setAbierto(false)
              // Editar la búsqueda limpia el resultado anterior (aviso / error).
              if (estado !== 'idle') onEstado('idle')
            }}
            onKeyDown={(e) => e.key === 'Enter' && !buscando && buscar()}
          />
        </div>
        {/* El renglón se monta SIEMPRE, con o sin texto: es lo que reserva su lugar. Sólo lleva
            contenido cuando hay algo que corregir —el campo vacío—, así el error no empuja al
            buscador ni a la ficha de abajo al aparecer. La ayuda fija se fue: el placeholder del
            campo ya dice por dónde se puede buscar. */}
        <span className="search-helper search-helper--error" role="alert">
          {errorInput}
        </span>

        {/* Varios clientes con el mismo nombre: se elige por código. */}
        {desplegado && (
          <div className="results">
            {resultados.map((c) => (
              <div className="ritem" key={c.id} onClick={() => elegir(c)}>
                <span className="ritem-name">{c.name}</span>
                <span className="ritem-code">{c.codigo}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <button type="button" className="btn-buscar" onClick={buscar} disabled={buscando}>
        {buscando ? (
          <>
            <i className="fas fa-spinner fa-spin" /> Buscando...
          </>
        ) : (
          <>
            <i className="fas fa-search" /> Buscar
          </>
        )}
      </button>
    </>
  )
}
