import { useEffect, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { clienteBloqueado, MENSAJE_CLIENTE_BLOQUEADO } from '@/lib/credito'
import { DESCRIPCION, ETAPA, numeroDePaso } from '@/lib/pasos'
import { faltantesCliente } from '@/lib/validaciones'
import { useApp, useDispatch } from '@/state/hooks'
import { BuscarCliente, type BusquedaEstado } from './BuscarCliente'
import { ClienteFicha } from './ClienteFicha'

/** Qué viene después de confirmar el cliente. Sale de `lib/pasos`, no de un texto suelto. */
const SIGUIENTE_PASO = ETAPA.ventas

/**
 * Paso 1: búsqueda y validación del cliente al que se le va a registrar el cobro.
 *
 * A diferencia de la app de operaciones de venta, acá no hay configuración de operación que elegir
 * (tipo de venta, entrega, emisión del remito): el recorrido es único, así que lo único que decide
 * este paso es CON QUIÉN se opera.
 */
export function ClienteView() {
  const { cliente } = useApp()
  const dispatch = useDispatch()
  // Estado de la búsqueda: gobierna qué se muestra en el lugar de la ficha del cliente.
  const [estadoBusqueda, setEstadoBusqueda] = useState<BusquedaEstado>('idle')
  // Aviso emergente al intentar operar con un cliente bloqueado.
  const [avisoBloqueado, setAvisoBloqueado] = useState(false)
  // Aviso emergente cuando al cliente le faltan datos en el board.
  const [avisoDatos, setAvisoDatos] = useState(false)
  // Aviso emergente al intentar avanzar sin un cliente cargado.
  const [avisoSinCliente, setAvisoSinCliente] = useState(false)
  // Ventana emergente cuando la búsqueda no encuentra al cliente: es el ÚNICO aviso de ese caso.
  const [avisoNoEncontrado, setAvisoNoEncontrado] = useState(false)

  // Cada vez que la búsqueda termina en "no encontrado", se abre la ventana emergente.
  useEffect(() => {
    if (estadoBusqueda === 'no-encontrado') setAvisoNoEncontrado(true)
  }, [estadoBusqueda])

  const bloqueado = clienteBloqueado(cliente)
  // Sin condición fiscal ni condición de pago no se puede emitir el recibo ni saber qué se cobra.
  const faltantes = cliente ? faltantesCliente(cliente) : []
  /* El cliente está confirmado: hay uno cargado y la búsqueda no está en curso ni terminó mal. */
  const clienteListo = estadoBusqueda === 'idle' && !!cliente

  const continuar = () => {
    /* Sin un cliente confirmado el botón sigue a la vista: se avisa que hace falta cargarlo. */
    if (!clienteListo) {
      setAvisoSinCliente(true)
      return
    }
    /* Con el cliente bloqueado el botón sigue activo a propósito: la ventana explica por qué no se
       puede seguir, en vez de dejar un botón muerto sin motivo. */
    if (bloqueado) {
      setAvisoBloqueado(true)
      return
    }
    if (faltantes.length > 0) {
      setAvisoDatos(true)
      return
    }
    dispatch({ type: 'goto', paso: 'ventas' })
  }

  /* Por qué todavía no se puede avanzar. Se muestra en el footer, al lado del botón. */
  const motivoBloqueo = !clienteListo
    ? 'Buscá y confirmá un cliente para continuar'
    : bloqueado
      ? 'Cliente bloqueado: no se puede operar'
      : faltantes.length > 0
        ? 'Al cliente le faltan datos en el sistema'
        : undefined

  return (
    <section className="view cliente-v2 paso-layout">
      {/* ZONA 1 · contexto de la operación y navegación, siempre a la vista. */}
      <PasoHeader />

      {/* ZONA 2 · el trabajo del paso: buscar y validar al cliente. */}
      <div className="paso-body">
        <PasoTitulo
          numero={numeroDePaso('cliente')}
          titulo={ETAPA.cliente}
          descripcion={DESCRIPCION.cliente}
        />

        {/* Buscador del cliente. El vendedor de la operación ya se ve —y se cambia— en el selector
            del encabezado, así que no se repite acá. */}
        <div className="toolbar-wrapper">
          <div className="card unified-toolbar">
            <BuscarCliente estado={estadoBusqueda} onEstado={setEstadoBusqueda} />
          </div>
        </div>

        {/* Ni el cliente no encontrado ni el fallo de la API tienen cartel en línea: los dos se
            avisan por ventana emergente (el segundo, desde `ModalErrorMonday`).

            La ficha se muestra SIEMPRE: skeleton mientras no hay cliente o se consulta, y se
            rellena con los datos reales al resolver la búsqueda. */}
        <ClienteFicha
          cliente={estadoBusqueda === 'idle' ? cliente : null}
          cargando={estadoBusqueda === 'buscando'}
        />

        {/* El avance queda SIEMPRE a la vista, haya o no cliente. El botón NUNCA se apaga: si falta
            algo, la ventana lo explica al hacer click, en vez de dejar un botón muerto sin motivo. */}
        <div className="actions-footer">
          <span className={`paso-siguiente ${motivoBloqueo ? 'paso-siguiente--bloqueo' : ''}`}>
            {motivoBloqueo ? (
              <>
                <i className="fas fa-circle-exclamation" /> {motivoBloqueo}
              </>
            ) : (
              <>
                <i className="fas fa-arrow-turn-up paso-siguiente-ic" /> Siguiente: {SIGUIENTE_PASO}
              </>
            )}
          </span>
          <button type="button" className="btn btn-primary" onClick={continuar}>
            Continuar a {SIGUIENTE_PASO} <i className="fas fa-arrow-right" />
          </button>
        </div>
      </div>

      {/* Sin cliente cargado no se puede avanzar: se explica al intentarlo. */}
      {avisoSinCliente && (
        <AvisoModal titulo="Falta cargar un cliente" onClose={() => setAvisoSinCliente(false)}>
          Para continuar tenés que buscar y cargar un cliente. Usá el buscador de arriba para
          seleccionarlo y volvé a intentar.
        </AvisoModal>
      )}

      {/* Cliente no encontrado: la ventana es el único aviso, no hay cartel en línea. */}
      {avisoNoEncontrado && (
        <AvisoModal titulo="Cliente no encontrado" onClose={() => setAvisoNoEncontrado(false)}>
          El cliente que buscó no existe o está inactivo en el sistema.
        </AvisoModal>
      )}

      {/* Cliente bloqueado en el board: no puede usarse en el sistema. */}
      {avisoBloqueado && (
        <AvisoModal titulo="Cliente bloqueado" onClose={() => setAvisoBloqueado(false)}>
          {MENSAJE_CLIENTE_BLOQUEADO}
        </AvisoModal>
      )}

      {/* Datos del cliente sin los que no se puede registrar el cobro. */}
      {avisoDatos && cliente && (
        <AvisoModal
          titulo="Faltan datos del cliente"
          faltantes={faltantes}
          onClose={() => setAvisoDatos(false)}
        >
          No se puede continuar porque a <strong>{cliente.name}</strong> le faltan datos en el
          sistema. Completalos en el tablero de Personas y volvé a reintentar.
        </AvisoModal>
      )}
    </section>
  )
}
