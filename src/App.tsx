import { useEffect, useRef } from 'react'
import { getUsuarioActual, getUsuarios } from '@/services/monday'
import { ModalErrorMonday } from '@/components/ui/ModalErrorMonday'
import { ClienteView } from '@/features/cliente/ClienteView'
import { CobroView } from '@/features/cobro/CobroView'
import { FacturasView } from '@/features/facturas/FacturasView'
import { ReciboView } from '@/features/recibo/ReciboView'
import { useApp, useDispatch } from '@/state/hooks'
import type { Paso } from '@/types'

/**
 * Vista de cada etapa. Es la ÚNICA tabla de ruteo de la app: el estado dice en qué paso está y acá
 * se resuelve qué se dibuja.
 */
const VISTAS: Record<Paso, () => JSX.Element | null> = {
  cliente: ClienteView,
  ventas: FacturasView,
  cobro: CobroView,
  recibo: ReciboView,
}

export function App() {
  const { paso } = useApp()
  const dispatch = useDispatch()
  const scrollRef = useRef<HTMLDivElement>(null)
  const Vista = VISTAS[paso]

  // Cada paso arranca desde arriba, como en una navegación real.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [paso])

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
