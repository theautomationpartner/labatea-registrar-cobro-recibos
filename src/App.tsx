import { useEffect, useRef } from 'react'
import { getUsuarioActual, getUsuarios } from '@/services/monday'
import { ModalErrorMonday } from '@/components/ui/ModalErrorMonday'
import { ClienteView } from '@/features/cliente/ClienteView'
import { CobroView } from '@/features/cobro/CobroView'
import { AnticiposView } from '@/features/anticipos/AnticiposView'
import { FacturasView } from '@/features/facturas/FacturasView'
import { PagosView } from '@/features/pagos/PagosView'
import { ReciboView } from '@/features/recibo/ReciboView'
import { useApp, useDispatch } from '@/state/hooks'
import type { Paso } from '@/types'

/**
 * Vista de cada etapa del módulo de COBROS. El estado dice en qué paso está y acá se resuelve qué
 * se dibuja. PAGOS no entra en esta tabla: es una operación independiente, con su propio ruteo.
 */
const VISTAS: Record<Paso, () => JSX.Element | null> = {
  cliente: ClienteView,
  ventas: FacturasView,
  cobro: CobroView,
  recibo: ReciboView,
}

export function App() {
  const { operacionApp, paso, tipoOperacion } = useApp()
  const dispatch = useDispatch()
  const scrollRef = useRef<HTMLDivElement>(null)
  /* Ruteo en DOS niveles, y en este orden:

       1. el MÓDULO. Cobros y Pagos son operaciones independientes —etapas propias, pantallas
          propias—, así que lo primero que se decide es cuál se está operando. Pagos todavía no
          tiene circuito definido y por eso resuelve en una sola vista.
       2. dentro de Cobros, la ETAPA. El paso 3 tiene DOS vistas según lo que se registre: con
          dinero (formas de pago) o aplicando el saldo a favor del cliente. Es la única etapa que
          cambia de pantalla según la operación; el resto del recorrido es el mismo. */
  const Vista =
    operacionApp === 'PAGOS'
      ? PagosView
      : paso === 'cobro' && tipoOperacion === 'aplicacion'
        ? AnticiposView
        : VISTAS[paso]

  /* Cada paso arranca desde arriba, como en una navegación real. Cambiar de MÓDULO también: es la
     navegación más grande que hace la app, así que con más razón no puede aterrizar a media
     pantalla. */
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [paso, operacionApp])

  /* Datos de sesión: se leen UNA sola vez, al montar la app. No dependen del cliente ni del cobro,
     así que no hay motivo para volver a pedirlos al avanzar de paso.

     `vivo` corta el dispatch si el componente se desmontó antes de que respondiera la API (y evita
     el doble efecto del StrictMode en desarrollo). */
  useEffect(() => {
    let vivo = true

    /* Usuarios de los equipos "Vendedores" y "Administradores": pueblan el selector del encabezado.
       Ante un error se deja la lista vacía —el selector deja de estar "Cargando…"— y se avisa por
       el modal: sin usuarios no hay a nombre de quién registrar el cobro, así que el problema no
       puede quedar mudo. */
    getUsuarios()
      .then((us) => vivo && dispatch({ type: 'setUsuarios', usuarios: us }))
      .catch(() => {
        if (!vivo) return
        dispatch({ type: 'setUsuarios', usuarios: [] })
        dispatch({ type: 'errorMonday', accion: 'obtener los usuarios de Monday' })
      })

    /* Usuario logueado en Monday (query `me`): define el responsable por defecto y los permisos del
       selector (RBAC). Ante un error queda sin sesión, sin cartel: la app sigue usable y el rol cae
       en el comportamiento por defecto de `lib/permisos`. */
    getUsuarioActual()
      .then((u) => vivo && dispatch({ type: 'setUsuarioActual', usuario: u }))
      .catch(() => vivo && dispatch({ type: 'setUsuarioActual', usuario: null }))

    return () => {
      vivo = false
    }
  }, [dispatch])

  return (
    <div className="scroll" ref={scrollRef}>
      <Vista />
      {/* Único punto donde la app comunica un fallo de la API de Monday, para cualquier pantalla. */}
      <ModalErrorMonday />
    </div>
  )
}
