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
}

/**
 * Búsqueda del cliente contra el tablero de Personas de Monday (capa de servicio). Detecta si se
 * ingresó nombre, código o CUIT y no exige coincidencia exacta. Si hay una sola coincidencia se
 * carga directo; si hay varias —dos clientes con el mismo nombre— se abren como desplegable para
 * elegir cuál. El loading y el «no encontrado» los muestra la vista, no acá.
 */
export function BuscarCliente({ estado, onEstado }: BuscarClienteProps) {
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
    dispatch({ type: 'setCliente', cliente: c })
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

  return (
    <>
      <div className="search-container" ref={ref}>
        <div className="search-wrapper">
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
            placeholder="Buscar cliente por código, nombre o CUIT..."
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
        <span className={`search-helper ${errorInput ? 'search-helper--error' : ''}`}>
          {errorInput || 'Buscar por razón social, código de cliente o Cuil/CUIT.'}
        </span>

        {/* Varios clientes con el mismo nombre: se elige por código. */}
        {abierto && resultados.length > 0 && (
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
