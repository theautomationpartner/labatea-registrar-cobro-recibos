import { useEffect, useState } from 'react'
import { getChequesDeCliente } from '@/services/monday'
import { useApp, useDispatch } from '@/state/hooks'

/**
 * Cheques USADOS del cliente DEUDOR, con la misma caché por cliente que el resto de la app: la
 * lista vive en el estado global junto a la clave de quién es (`chequesRechazoClienteId`), así que
 * volver al paso con el stepper no vuelve a consultar el tablero.
 *
 * No es `useChequesCartera`: ese trae la CARTERA entera —otro tablero— y se dispara al abrir una
 * modalidad del formulario de pago, sin cliente de por medio ni estado global donde apoyarse. Acá
 * la lectura es por cliente y tiene que sobrevivir a la navegación, que es exactamente lo que hacen
 * los anticipos del pase (ver `PaseAnticipoView`) —y por eso sigue ese esquema y no el otro—.
 *
 * Ante un fallo la clave de caché va en `null`: un error NO se cachea, así el próximo ingreso
 * reintenta en vez de dejar la cartera vacía para siempre.
 */
export function useChequesDelDeudor(): { cargando: boolean } {
  const { cliente, chequesRechazoClienteId } = useApp()
  const dispatch = useDispatch()
  const enCache = !!cliente && chequesRechazoClienteId === cliente.id
  const [cargando, setCargando] = useState(!enCache)

  useEffect(() => {
    if (!cliente || chequesRechazoClienteId === cliente.id) {
      setCargando(false)
      return
    }
    let vivo = true
    setCargando(true)
    getChequesDeCliente(cliente.id)
      .then((cs) => {
        if (!vivo) return
        dispatch({ type: 'setChequesRechazo', cheques: cs, clienteId: cliente.id })
        setCargando(false)
      })
      .catch(() => {
        if (!vivo) return
        dispatch({ type: 'setChequesRechazo', cheques: [], clienteId: null })
        dispatch({ type: 'errorMonday', accion: 'obtener los cheques usados del cliente' })
        setCargando(false)
      })
    return () => {
      vivo = false
    }
  }, [cliente, chequesRechazoClienteId, dispatch])

  return { cargando }
}
