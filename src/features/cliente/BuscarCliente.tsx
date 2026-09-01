import { useCallback, useRef, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { useClickOutside } from '@/hooks/useClickOutside'
import { esContado } from '@/lib/pases'
import { ROTULO_ROL, type RolPersona } from '@/lib/personas'
import { buscarClientes } from '@/services/monday'
import { useApp, useDispatch } from '@/state/hooks'
import type { Cliente } from '@/types'

/** Estado de la búsqueda del cliente, compartido con la vista para renderizar el resultado. */
export type BusquedaEstado = 'idle' | 'buscando' | 'no-encontrado' | 'error'

interface BuscarClienteProps {
  estado: BusquedaEstado
  onEstado: (estado: BusquedaEstado) => void
  /**
   * Qué hacer con la persona elegida. Es OBLIGATORIO, y no tiene comportamiento por defecto a
   * propósito: cada módulo tiene que VALIDAR que esa persona sirva para su operación antes de
   * cargarla (ver `lib/personas`), y un `dispatch` por defecto acá dejaría que un lugar nuevo se
   * saltee esa validación sin que nada lo delate.
   *
   * El buscador se usa en tres lugares con el mismo comportamiento y distinto destinatario: el
   * paso 1 de Cobros elige a quién se le cobra, el destino de un pase elige quién RECIBE el saldo,
   * y la etapa 1 de Pagos elige a quién se le paga. Todo lo demás —cómo se busca, qué se muestra,
   * cómo se resuelven varias coincidencias— es idéntico, así que se parametriza el efecto y no se
   * duplica el componente.
   */
  onElegir: (persona: Cliente) => void
  /** Texto del campo vacío. Por defecto, el del paso 1. */
  placeholder?: string
  /**
   * Contra QUÉ se busca. Por defecto, los clientes del board de Personas.
   *
   * Existe porque el módulo de PAGOS busca PROVEEDORES, que son ítems del MISMO tablero y con los
   * MISMOS campos: lo único que los distingue es su "✋Categoria". Todo lo demás —cómo se busca,
   * qué se muestra, cómo se resuelven varias coincidencias, cuándo se avisa que no existe— es
   * idéntico, así que se parametriza la consulta y no se duplica el componente.
   */
  buscarPersonas?: (termino: string) => Promise<Cliente[]>
  /**
   * Cómo se nombra lo que se busca en el mensaje de error de la API ("buscar el cliente"). Va
   * junto con `buscarPersonas`: si cambia contra qué se busca, tiene que cambiar qué se dice
   * cuando falla.
   */
  sujeto?: string
  /** Texto del campo vacío cuando no se ingresó nada. Acompaña a `sujeto`. */
  mensajeVacio?: string
  /**
   * De qué lado del mostrador está lo que se busca. Lo ÚNICO que decide es cómo se nombra a la
   * persona en la ventana del rechazo por CONTADO —que es un rechazo del propio buscador, así que
   * su texto se arma acá y no en la vista—.
   *
   * Existe por el PASE DE SALDO, que se recorre igual entre cuentas de clientes y entre cuentas de
   * proveedores: sin esto, a un proveedor rechazado se le decía "el cliente opera al contado" y se
   * lo mandaba a revisar la columna equivocada. Por defecto, un cliente: es lo que buscan Cobros y
   * el pase entre clientes.
   */
  rol?: RolPersona
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
  buscarPersonas = buscarClientes,
  sujeto = 'el cliente',
  mensajeVacio = 'Ingresá un nombre, código de cliente o CUIT.',
  rol = 'cliente',
}: BuscarClienteProps) {
  const { operacionApp } = useApp()
  const dispatch = useDispatch()
  // El campo arranca (y queda) vacío: no muestra el cliente elegido, para encadenar búsquedas.
  const [termino, setTermino] = useState('')
  const [errorInput, setErrorInput] = useState('')
  const [resultados, setResultados] = useState<Cliente[]>([])
  const [abierto, setAbierto] = useState(false)
  /* Cliente elegido que se RECHAZÓ por operar al contado. Guarda al cliente, no un booleano,
     porque la ventana lo nombra: es lo que vuelve entendible cuál de las coincidencias se
     descartó cuando la búsqueda trajo varias. */
  const [contado, setContado] = useState<Cliente | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, useCallback(() => setAbierto(false), []), abierto)
  const buscando = estado === 'buscando'

  /* Quien opera al CONTADO no tiene cuenta corriente, así que no puede entrar ni en un cobro ni en
     un pase de saldo —las dos operaciones se saldan CONTRA esa cuenta—. Se corta en la elección y
     no al avanzar: asignarlo para frenarlo tres campos después dejaría media pantalla trabajando
     sobre alguien que nunca iba a servir. */
  const bloqueaContado = operacionApp === 'COBROS' || operacionApp === 'PASES'
  // Cómo se nombra a la persona rechazada. En un pase entre proveedores, "el proveedor".
  const rotulo = ROTULO_ROL[rol]

  const elegir = (c: Cliente) => {
    // El campo queda vacío tras elegir: el resultado se ve en la ficha, no en el buscador.
    setTermino('')
    setResultados([])
    setAbierto(false)
    onEstado('idle')
    /* Rechazado: se avisa por ventana y NO se asigna, ni acá ni en el destino de un pase. La
       búsqueda queda lista para el siguiente intento. */
    if (bloqueaContado && esContado(c.condicionPago)) {
      setContado(c)
      return
    }
    if (onElegir) onElegir(c)
    else dispatch({ type: 'setCliente', cliente: c })
  }

  const buscar = async () => {
    const t = termino.trim()
    if (!t) {
      setErrorInput(mensajeVacio)
      return
    }
    setErrorInput('')
    setAbierto(false)
    onEstado('buscando')
    try {
      const encontrados = await buscarPersonas(t)
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
      dispatch({ type: 'errorMonday', accion: `buscar ${sujeto}` })
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

      {/* La persona elegida opera al contado: la ventana explica por qué quedó afuera y no se
          asignó. Se la nombra por su ROL —cliente o proveedor—, que es el que dice en qué ficha del
          tablero hay que ir a mirar la condición de pago. */}
      {contado && (
        <AvisoModal
          titulo={`El ${rotulo.singular} opera al contado`}
          onClose={() => setContado(null)}
        >
          El {rotulo.singular} seleccionado <strong>{contado.name}</strong> tiene condicion de pago{' '}
          <strong>CONTADO</strong>. Los {rotulo.plural} con condición CONTADO no operan contra una
          cuenta corriente, así que no se los puede usar en esta operación. Su estado debe ser{' '}
          <strong>CUENTA CORRIENTE</strong>.
        </AvisoModal>
      )}
    </>
  )
}
