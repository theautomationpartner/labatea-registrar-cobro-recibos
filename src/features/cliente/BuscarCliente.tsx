import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { useClickOutside } from '@/hooks/useClickOutside'
import { buscarEnPadron, type EntradaPadron } from '@/lib/busquedaPersonas'
import { esContado } from '@/lib/pases'
import { ROTULO_ROL, type RolPersona } from '@/lib/personas'
import {
  buscarClientes,
  buscarProveedores,
  getPadron,
  recordarPersonas,
  refrescarPersona,
  type ResultadoBusqueda,
} from '@/services/monday'
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
  /** Texto del campo vacío. Por defecto, el del rol. */
  placeholder?: string
  /**
   * Contra QUÉ consulta Monday el botón Buscar. Por defecto, la del rol: clientes o proveedores del
   * board de Personas. Se puede pisar, pero tiene que buscar la MISMA categoría que `rol`: el live
   * search sale del padrón de ese rol, y dos fuentes de categorías distintas en el mismo campo
   * serían una lista que cambia de lado del mostrador según se tipee o se apriete Buscar.
   */
  buscarPersonas?: (termino: string) => Promise<ResultadoBusqueda<Cliente>>
  /**
   * Cómo se nombra lo que se busca en el mensaje de error de la API ("buscar el cliente"). Por
   * defecto, el del rol.
   */
  sujeto?: string
  /** Texto del campo vacío cuando no se ingresó nada. Por defecto, el del rol. */
  mensajeVacio?: string
  /**
   * De qué lado del mostrador está lo que se busca. Decide TRES cosas, y por eso es una sola prop:
   *
   *   · qué padrón recorre el live search —los clientes o los proveedores cacheados—, que es el
   *     cerrojo que impide ofrecer a un proveedor en un cobro;
   *   · contra qué se relee a la persona al elegirla (`refrescarPersona`) y contra qué consulta el
   *     botón Buscar;
   *   · cómo se nombra a la persona en la ventana del rechazo por CONTADO.
   *
   * Por defecto, un cliente: es lo que buscan Cobros, Rechazos, Resumen y el pase entre clientes.
   */
  rol?: RolPersona
  /**
   * ¿La operación decide PLATA con la persona elegida?
   *
   * En `true` (lo normal) al elegirla del live search se la relee de Monday: el padrón tiene hasta
   * 5 minutos y de ese objeto salen el saldo, la situación y —en un proveedor— si tiene la cuenta
   * corriente conectada. En `false` se carga en el acto con lo que trae el padrón; lo usa el
   * RESUMEN DE CTA CTE, que sólo documenta la cuenta y lee sus movimientos aparte. Mismo criterio
   * que el `conCredito` del buscador de la app de ventas.
   */
  conCredito?: boolean
}

/**
 * Búsqueda de la persona, en dos velocidades. Mismo diseño que el buscador de clientes de la app de
 * operaciones de venta, para que las dos apps se usen igual:
 *
 * 1. **Mientras se escribe**, sobre el padrón cacheado en la base por el Cron Job de aquella app y
 *    bajado una vez por sesión (`services/monday/padronPersonas.ts`). No sale un solo pedido de red:
 *    la lista se rearma en cada tecla y el que más matchea encabeza. Los espacios no cuentan: se
 *    compara la forma compacta de lo escrito contra la del nombre (ver `lib/busquedaPersonas.ts`).
 * 2. **El botón Buscar** sigue consultando Monday directo. Es la salida para la persona que todavía
 *    no está cacheada —dada de alta hace dos minutos— y para cuando el padrón no se pudo bajar.
 *
 * ── Los cerrojos ──
 * El live search nunca ofrece a alguien del otro lado del mostrador: el servidor sólo entrega la
 * categoría pedida y el índice la vuelve a exigir con la misma regla que valida la pantalla
 * (`cumpleRol`). La pantalla, además, sigue validando al elegir (`onElegir`), así que son tres
 * barreras para la misma regla, y el rechazo por CONTADO sigue corriendo acá, sobre el dato fresco.
 *
 * ── Teclado ──
 * Las flechas recorren los resultados y Enter carga el resaltado; la primera fila —la que más
 * matchea— arranca marcada, así que Enter siempre confirma algo que se está viendo. Enter sale a
 * Monday SÓLO cuando no hay ningún resultado para lo escrito. Escape repliega la lista.
 */
export function BuscarCliente({
  estado,
  onEstado,
  onElegir,
  rol = 'cliente',
  placeholder = `Buscar ${ROTULO_ROL[rol].singular} por código, nombre o CUIT...`,
  buscarPersonas = rol === 'proveedor' ? buscarProveedores : buscarClientes,
  sujeto = `el ${ROTULO_ROL[rol].singular}`,
  mensajeVacio = `Ingresá un nombre, código de ${ROTULO_ROL[rol].singular} o CUIT.`,
  conCredito = true,
}: BuscarClienteProps) {
  const { operacionApp } = useApp()
  const dispatch = useDispatch()
  // El campo arranca (y queda) vacío: no muestra el cliente elegido, para encadenar búsquedas.
  const [termino, setTermino] = useState('')
  const [errorInput, setErrorInput] = useState('')
  /* Resultados de la consulta DIRECTA a Monday (botón Buscar), con su aviso de truncado. `null` =
     no se consultó, y entonces manda el live search. Distinguir "no busqué" de "busqué y no hay" es
     lo que evita que la lista local tape un "no encontrado" que el usuario acaba de pedir. */
  const [remotos, setRemotos] = useState<{ personas: Cliente[]; truncado: boolean } | null>(null)
  const [padron, setPadron] = useState<readonly EntradaPadron[]>([])
  const [abierto, setAbierto] = useState(false)
  /**
   * Fila resaltada, la que carga el Enter. Arranca en 0: con la lista ordenada por cuánto matchea,
   * la primera es la mejor coincidencia.
   */
  const [activo, setActivo] = useState(0)
  /* Persona elegida que se RECHAZÓ por operar al contado. Guarda a la persona, no un booleano,
     porque la ventana la nombra. */
  const [contado, setContado] = useState<Cliente | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const listaRef = useRef<HTMLDivElement>(null)
  /**
   * El resaltado se está moviendo con el teclado. Mientras sea `true`, el mouse quieto no roba el
   * resaltado por el solo hecho de que la lista scrollee debajo de él.
   */
  const conTeclado = useRef(false)
  useClickOutside(ref, useCallback(() => setAbierto(false), []), abierto)
  const buscando = estado === 'buscando'

  /* Quien opera al CONTADO no tiene cuenta corriente, así que no puede entrar ni en un cobro ni en
     un pase de saldo —las dos operaciones se saldan CONTRA esa cuenta—. Se corta en la elección y
     no al avanzar. */
  const bloqueaContado = operacionApp === 'COBROS' || operacionApp === 'PASES'
  // Cómo se nombra a la persona rechazada. En un pase entre proveedores, "el proveedor".
  const rotulo = ROTULO_ROL[rol]

  /* El padrón del ROL se pide al montar y cada vez que el rol cambia —el pase declara "De
     Proveedores" después de haber montado el buscador—. Al cambiar de rol se vacía primero lo que
     había: la lista de clientes no puede quedar a la vista ni un instante en un buscador que ya es
     de proveedores. Si la carga falla, queda vacío y el botón Buscar sigue funcionando. */
  useEffect(() => {
    let vivo = true
    setPadron([])
    setRemotos(null)
    void getPadron(rol).then((p) => {
      if (vivo) setPadron(p.entradas)
    })
    return () => {
      vivo = false
    }
  }, [rol])

  /* La búsqueda local. `useMemo` y no estado: es una función del término y del padrón. */
  const locales = useMemo(() => buscarEnPadron(padron, termino), [padron, termino])

  /* Lo que se muestra: lo que trajo Monday si se apretó Buscar, el live search si no. */
  const resultados = remotos?.personas ?? locales.personas
  const truncada = remotos?.truncado ?? locales.truncado
  const desplegado = abierto && resultados.length > 0

  /* Acotado al render: la lista cambia con cada tecla y el índice guardado puede quedar apuntando
     más allá del final por un instante. */
  const indiceActivo = resultados.length > 0 ? Math.min(activo, resultados.length - 1) : -1
  const marcado = desplegado && indiceActivo >= 0 ? resultados[indiceActivo] : null

  /* Cambió lo que se está mostrando: el resaltado vuelve a la mejor coincidencia. */
  useEffect(() => {
    setActivo(0)
  }, [termino, remotos])

  /**
   * El resaltado tiene que verse: se desplaza la lista lo mínimo para dejarlo dentro.
   *
   * A mano y NO con `scrollIntoView`, que desplaza todos los ancestros scrolleables —incluida la
   * página— aunque la fila ya estuviera visible. Acá se toca un solo `scrollTop`: el de la lista.
   */
  useEffect(() => {
    if (!desplegado || indiceActivo < 0) return
    const cont = listaRef.current
    const fila = cont?.children[indiceActivo] as HTMLElement | undefined
    if (!cont || !fila) return
    const caja = cont.getBoundingClientRect()
    const f = fila.getBoundingClientRect()
    if (f.top < caja.top) cont.scrollTop -= caja.top - f.top
    else if (f.bottom > caja.bottom) cont.scrollTop += f.bottom - caja.bottom
  }, [desplegado, indiceActivo])

  const limpiar = () => {
    // El campo queda vacío tras elegir: el resultado se ve en la ficha, no en el buscador.
    setTermino('')
    setRemotos(null)
    setAbierto(false)
    setActivo(0)
  }

  /** Entrega la persona ya confirmada: rechazo por contado o la validación del módulo. */
  const entregar = (c: Cliente) => {
    limpiar()
    onEstado('idle')
    /* Rechazado: se avisa por ventana y NO se asigna, ni acá ni en el destino de un pase. */
    if (bloqueaContado && esContado(c.condicionPago)) {
      setContado(c)
      return
    }
    onElegir(c)
  }

  /**
   * Carga la persona elegida.
   *
   * `fresca` = viene de la consulta directa a Monday (botón Buscar), que ya es el dato del momento.
   * Del live search, en cambio, llega del padrón y se RELEE antes de cargarla (ver `conCredito`).
   * La relectura NO es opcional y su fallo NO cae al dato cacheado: operar sobre un saldo que no se
   * pudo confirmar es exactamente lo que no se puede hacer. Se avisa con la ventana de siempre.
   */
  const elegir = async (c: Cliente, fresca: boolean) => {
    setAbierto(false)
    if (fresca || !conCredito) {
      entregar(c)
      return
    }
    onEstado('buscando')
    try {
      const actual = await refrescarPersona(rol, c.id)
      if (!actual) {
        /* Estaba en el padrón pero ya no está en Monday: la borraron entre la última corrida del
           cron y ahora. Se trata como no encontrada, que es lo que es. */
        limpiar()
        onEstado('no-encontrado')
        return
      }
      entregar(actual)
    } catch {
      onEstado('error')
      dispatch({ type: 'errorMonday', accion: `leer los datos del ${rotulo.singular}` })
    }
  }

  /** El botón Buscar: consulta directa a Monday, para la persona que el padrón no tiene. */
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
      const { personas: encontrados, truncado } = await buscarPersonas(t)
      setRemotos({ personas: encontrados, truncado })
      /* Lo que trajo Monday se suma al padrón de la sesión: sería absurdo encontrarlo por acá y que
         el live search siguiera sin conocerlo dos segundos después. */
      recordarPersonas(rol, encontrados)
      if (encontrados.length === 0) {
        onEstado('no-encontrado')
        return
      }
      /* Una sola coincidencia: se carga directo. Con la lista truncada NO, aunque haya venido una
         sola: puede no ser la que el usuario busca. */
      if (encontrados.length === 1 && !truncado) {
        await elegir(encontrados[0], true)
        return
      }
      setAbierto(true)
      onEstado('idle')
    } catch {
      /* El fallo de la API lo comunica la ventana global (`ModalErrorMonday`); el estado 'error'
         sólo sirve para que la vista no muestre la ficha como si hubiera resultado. */
      onEstado('error')
      dispatch({ type: 'errorMonday', accion: `buscar ${sujeto}` })
    }
  }

  /**
   * Teclado del buscador: flechas para recorrer los resultados, Enter para confirmar, Escape para
   * replegar.
   *
   * Enter carga la persona resaltada, y sólo sale a Monday cuando NO hay ningún resultado para lo
   * escrito —el padrón no la tiene y puede ser un alta posterior a la última corrida del cron—.
   *
   * Cuelga del CONTENEDOR y no del `<input>`: apretar Buscar con el mouse deja el foco en el BOTÓN,
   * y desde ahí un manejador puesto en el input no se entera de nada.
   */
  const alPresionarTecla = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (buscando) return
    const navegar = (delta: number) => {
      if (resultados.length === 0) return
      // Sin esto el cursor salta al principio o al final del texto, y la página scrollea.
      e.preventDefault()
      conTeclado.current = true
      if (!abierto) {
        // La lista estaba replegada: la primera flecha la vuelve a abrir.
        setAbierto(true)
        return
      }
      setActivo((i) => Math.min(resultados.length - 1, Math.max(0, i + delta)))
    }
    switch (e.key) {
      case 'ArrowDown':
        return navegar(1)
      case 'ArrowUp':
        return navegar(-1)
      case 'Escape':
        if (abierto) {
          e.preventDefault()
          setAbierto(false)
        }
        return
      case 'Enter':
        e.preventDefault()
        if (marcado) void elegir(marcado, remotos !== null)
        else void buscar()
        return
      default:
        return
    }
  }

  const idLista = `${rol}-listbox`

  return (
    /* El envoltorio existe SÓLO para que el teclado llegue desde cualquier punto del buscador: el
       campo y el botón Buscar son hermanos. Va con `display: contents`, así que no existe para el
       layout —los dos siguen siendo los ítems flex de `.unified-toolbar`— pero sí para los eventos. */
    <div className="search-teclado" onKeyDown={alPresionarTecla}>
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
              /* Editar descarta el resultado de la consulta directa: lo que se ve vuelve a ser el
                 live search sobre lo nuevo que se está escribiendo. */
              setRemotos(null)
              setAbierto(true)
              // Editar la búsqueda limpia el resultado anterior (aviso / error).
              if (estado !== 'idle') onEstado('idle')
            }}
            onFocus={() => setAbierto(true)}
            role="combobox"
            aria-expanded={desplegado}
            aria-controls={idLista}
            aria-activedescendant={marcado ? `${rol}-op-${indiceActivo}` : undefined}
          />
        </div>
        {/* El renglón se monta SIEMPRE, con o sin texto: es lo que reserva su lugar. Lleva el error
            del campo vacío o el aviso de que la lista se cortó —callarlo es lo que hacía creer que
            la persona no existía cuando en realidad no había entrado en la lista—. */}
        <span
          className={`search-helper ${errorInput ? 'search-helper--error' : ''}`}
          role="status"
          aria-live="polite"
        >
          {errorInput ||
            (desplegado && truncada
              ? `Demasiadas coincidencias: se muestran las primeras ${resultados.length}. Afiná el término.`
              : '')}
        </span>

        {/* Los resultados: los del padrón mientras se escribe, los de Monday si se apretó Buscar. */}
        {desplegado && (
          <div
            className="results"
            role="listbox"
            id={idLista}
            aria-label={`Resultados de ${rotulo.plural}`}
            ref={listaRef}
            /* El mouse recupera el mando recién cuando se mueve de verdad, no cuando la lista le
               pasa por debajo al scrollear con el teclado. */
            onMouseMove={() => {
              conTeclado.current = false
            }}
          >
            {resultados.map((c, i) => (
              <div
                className={`ritem ${i === indiceActivo ? 'ritem--activo' : ''}`}
                key={c.id}
                id={`${rol}-op-${i}`}
                role="option"
                aria-selected={i === indiceActivo}
                onClick={() => void elegir(c, remotos !== null)}
                /* El mousedown por defecto le saca el foco al campo, y desde la fila las flechas
                   vuelven a scrollear la página. Cancelarlo deja el foco donde estaba. */
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => {
                  if (!conTeclado.current) setActivo(i)
                }}
              >
                <span className="ritem-name">{c.name}</span>
                <span className="ritem-code">{c.codigo}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* El botón dejó de ser el único camino: ahora es el escape para la persona que el padrón
          todavía no tiene. El título lo explica sin ocupar lugar en pantalla. */}
      <button
        type="button"
        className="btn-buscar"
        onClick={buscar}
        disabled={buscando}
        title={`Buscar este ${rotulo.singular} directamente en Monday, por si todavía no está en la lista`}
      >
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
          asignó. Se la nombra por su ROL —cliente o proveedor—. */}
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
    </div>
  )
}
