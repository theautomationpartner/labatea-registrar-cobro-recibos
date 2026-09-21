import { useCallback, useEffect, useState } from 'react'
import { getFacturasAdeudadas } from '@/services/monday'
import { useApp, useDispatch } from '@/state/hooks'

/**
 * Lee las facturas que el cliente todavía debe: lo que lista el documento "Estado de Cta Cte". Mismo
 * criterio que `useMovimientosCtaCte`: la lista vive en el estado GLOBAL con su clave de caché (el
 * cliente), así que volver a la etapa no vuelve a consultar; y un fallo NO se reintenta solo —se
 * avisa por la ventana global y la pantalla ofrece reintentar—, para que una API caída no convierta
 * cada render en otra consulta.
 *
 * `activo` es lo que decide si la consulta sale: con el resumen SIN el estado de la cuenta no hay
 * documento que las muestre, así que no se le pide al tablero una lista que nadie va a ver.
 */
export function useFacturasAdeudadas(activo = true) {
  const { cliente, facturasAdeudadasClienteId } = useApp()
  const dispatch = useDispatch()
  const [fallida, setFallida] = useState<string | null>(null)

  const clienteId = cliente?.id ?? null
  const leida = clienteId !== null && facturasAdeudadasClienteId === clienteId
  const fallo = clienteId !== null && fallida === clienteId

  useEffect(() => {
    if (!activo || !cliente || leida || fallo) return
    let vivo = true
    getFacturasAdeudadas(cliente)
      .then((facturas) => {
        if (vivo) dispatch({ type: 'setFacturasAdeudadas', facturas, clienteId: cliente.id })
      })
      .catch(() => {
        if (!vivo) return
        setFallida(cliente.id)
        dispatch({ type: 'errorMonday', accion: 'obtener las facturas que debe el cliente' })
      })
    return () => {
      vivo = false
    }
  }, [activo, cliente, leida, fallo, dispatch])

  return {
    /** Todavía no está la lista del cliente en curso: hay una consulta en vuelo. */
    cargando: activo && clienteId !== null && !leida && !fallo,
    fallo,
    listo: leida,
    reintentar: useCallback(() => setFallida(null), []),
  }
}
