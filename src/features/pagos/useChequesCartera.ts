import { useEffect, useRef, useState } from 'react'
import { getChequesEnCartera } from '@/services/monday'
import { useDispatch } from '@/state/hooks'
import type { ChequeEnCartera } from '@/types'

/** Estado de la consulta de la cartera: gobierna qué se muestra en el lugar de la tabla. */
export type EstadoCartera = 'idle' | 'cargando' | 'listo' | 'error'

/**
 * Cheques de terceros disponibles en cartera. Se consultan UNA sola vez, recién cuando la modalidad
 * "En Cartera" entra en pantalla (`activo`): antes de eso no hay nada que mostrar y la llamada
 * sería trabajo tirado.
 *
 * Mismo esquema que `useCuentasPropias`: el ref evita re-consultar al volver a entrar, y `estado`
 * NO puede ir en las deps del efecto (su set lo re-ejecutaría y cancelaría la consulta recién
 * lanzada).
 *
 * El fallo se avisa por la ventana global UNA sola vez: sin el ref, cada render volvería a abrirla
 * sobre un error que el usuario ya vio.
 */
export function useChequesCartera(activo: boolean): {
  cheques: ChequeEnCartera[]
  estado: EstadoCartera
} {
  const dispatch = useDispatch()
  const [cheques, setCheques] = useState<ChequeEnCartera[]>([])
  const [estado, setEstado] = useState<EstadoCartera>('idle')
  const cargados = useRef(false)
  const avisado = useRef(false)

  useEffect(() => {
    if (!activo || cargados.current) return
    let vivo = true
    setEstado('cargando')
    getChequesEnCartera()
      .then((cs) => {
        if (!vivo) return
        cargados.current = true
        setCheques(cs)
        setEstado('listo')
      })
      .catch(() => {
        if (!vivo) return
        setEstado('error')
        if (avisado.current) return
        avisado.current = true
        dispatch({ type: 'errorMonday', accion: 'obtener los cheques en cartera' })
      })
    return () => {
      vivo = false
    }
  }, [activo, dispatch])

  return { cheques, estado }
}
