import { useCallback, useEffect, useState } from 'react'
import { getMovimientosCtaCte } from '@/services/monday'
import { claveMovimientosCtaCte } from '@/state/appState'
import { useApp, useDispatch } from '@/state/hooks'

/**
 * Lee los movimientos de la cuenta corriente del cliente para el período elegido. La consulta sale
 * en cuanto hay cliente y período, y se vuelve a pedir cada vez que cambia cualquiera de los dos.
 *
 * El resultado vive en el estado GLOBAL con su clave de caché (cliente + período): volver a esta
 * etapa con el stepper, o pasar a la de emisión, reencuentra la lista sin consultar de nuevo.
 *
 * Un fallo NO se reintenta solo: se avisa por la ventana global y la pantalla ofrece reintentar. Sin
 * ese freno, una API caída convertiría cada render en otra consulta —y otra ventana de error—.
 */
export function useMovimientosCtaCte() {
  const { cliente, resumenRango, movimientosCtaCteClave } = useApp()
  const dispatch = useDispatch()
  /* La clave que falló la última vez. Mientras siga siendo la vigente no se vuelve a consultar sola;
     `reintentar` la limpia. */
  const [fallida, setFallida] = useState<string | null>(null)

  const clave = cliente && resumenRango ? claveMovimientosCtaCte(cliente.id, resumenRango) : null
  const leida = clave !== null && movimientosCtaCteClave === clave
  const fallo = clave !== null && fallida === clave

  useEffect(() => {
    if (!cliente || !resumenRango || !clave || leida || fallo) return
    let vivo = true
    getMovimientosCtaCte(cliente, resumenRango)
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
  }, [cliente, resumenRango, clave, leida, fallo, dispatch])

  return {
    /**
     * Todavía no está la lista del período vigente: hay una consulta en curso. Se DERIVA de la clave
     * de caché en vez de llevarse aparte, así no hay un "cargando" que pueda quedar encendido.
     */
    cargando: clave !== null && !leida && !fallo,
    /** La última lectura del período vigente falló. */
    fallo,
    /** La lista en el estado es la del cliente y el período elegidos. */
    listo: leida,
    reintentar: useCallback(() => setFallida(null), []),
  }
}
