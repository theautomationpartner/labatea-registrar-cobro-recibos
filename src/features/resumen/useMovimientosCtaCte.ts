import { useCallback, useEffect, useState } from 'react'
import { getMovimientosCtaCte } from '@/services/monday'
import { claveMovimientosCtaCte, periodoResumen } from '@/state/appState'
import { useApp, useDispatch } from '@/state/hooks'

/**
 * Lee los movimientos de la cuenta corriente del cliente para el período que define el criterio de
 * la etapa de configuración (ver `periodoDelCriterio`). La consulta NO sale sola: sale cuando el
 * usuario aprieta "Buscar movimientos", que es lo que guarda `resumenBusquedaPedida`. Cambiar el
 * criterio descarta ese pedido, así que nada se consulta mientras se está eligiendo.
 *
 * El resultado vive en el estado GLOBAL con su clave de caché (cliente + las dos puntas del
 * período): volver al paso 1 y avanzar de nuevo reencuentra la lista sin consultar otra vez.
 *
 * Un fallo NO se reintenta solo: se avisa por la ventana global y la pantalla ofrece reintentar. Sin
 * ese freno, una API caída convertiría cada render en otra consulta —y otra ventana de error—.
 */
export function useMovimientosCtaCte() {
  const state = useApp()
  const { cliente, movimientosCtaCteClave, resumenBusquedaPedida } = state
  const dispatch = useDispatch()
  /* La clave que falló la última vez. Mientras siga siendo la vigente no se vuelve a consultar sola;
     `reintentar` la limpia. */
  const [fallida, setFallida] = useState<string | null>(null)

  const periodo = periodoResumen(state)
  const clave = cliente && periodo ? claveMovimientosCtaCte(cliente.id, periodo) : null
  /** La búsqueda de ESTA clave ya fue pedida con el botón: es lo único que dispara la consulta. */
  const pedida = clave !== null && resumenBusquedaPedida === clave
  /* La lista en el estado es de esta clave: ya está, venga de donde venga el pedido. Por eso la
     etapa de emisión la encuentra sin volver a pedir nada. */
  const leida = clave !== null && movimientosCtaCteClave === clave
  const fallo = pedida && fallida === clave
  /* Las dos puntas, sueltas, para las dependencias del efecto: un objeto nuevo en cada render las
     dispararía siempre. */
  const desde = periodo?.desde ?? ''
  const hasta = periodo?.hasta ?? ''

  useEffect(() => {
    if (!cliente || !clave || !pedida || leida || fallo) return
    let vivo = true
    getMovimientosCtaCte(cliente, { desde, hasta })
      .then((resultado) => {
        if (vivo) dispatch({ type: 'setMovimientosCtaCte', resultado, clave })
      })
      .catch(() => {
        if (!vivo) return
        setFallida(clave)
        dispatch({ type: 'errorMonday', accion: 'obtener los movimientos de la cuenta corriente' })
      })
    return () => {
      vivo = false
    }
  }, [cliente, clave, pedida, desde, hasta, leida, fallo, dispatch])

  return {
    /**
     * Todavía no está la lista del período vigente: hay una consulta en curso. Se DERIVA de la clave
     * de caché en vez de llevarse aparte, así no hay un "cargando" que pueda quedar encendido.
     */
    cargando: pedida && !leida && !fallo,
    /** La última lectura del período vigente falló. */
    fallo,
    /** La lista en el estado es la del cliente y el período elegidos. */
    listo: leida,
    reintentar: useCallback(() => setFallida(null), []),
  }
}
