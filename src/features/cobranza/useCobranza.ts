import { useEffect, useState } from 'react'
import { claveCobranza } from '@/lib/cobranza'
import { buscarCobranza } from '@/services/monday'
import { useApp, useDispatch } from '@/state/hooks'

/**
 * La lectura del tablero de cobranza. Mismo criterio que el resto de los hooks del proyecto: el
 * resultado vive en el estado GLOBAL con su clave de caché, y un fallo NO se reintenta solo —se
 * avisa por la ventana global y la pantalla ofrece reintentar—, para que una API caída no convierta
 * cada render en otra consulta.
 *
 * Lo que lo diferencia de los demás es QUIÉN dispara la consulta: acá no la dispara el paso al que
 * se entra sino un PEDIDO explícito (`cobranzaPedida`), y el único que lo hace es el botón "Buscar".
 * Entrar al módulo no consulta nada —el tablero abre en blanco— y cambiar un criterio tampoco: el
 * criterio lo arma el usuario, y salir a la red con cada cambio serían varias consultas para llegar
 * a la que quería.
 */
export function useCobranza() {
  const { cobranzaCriterio, cobranzaResultado, cobranzaClave, cobranzaPedida } = useApp()
  const dispatch = useDispatch()
  /* La clave del criterio cuya consulta falló. Se guarda la CLAVE y no un booleano: si el usuario
     cambia el criterio, el fallo del anterior ya no aplica y la pantalla vuelve a ofrecer buscar. */
  const [fallida, setFallida] = useState<string | null>(null)

  const clave = claveCobranza(cobranzaCriterio)
  const fallo = cobranzaPedida !== null && fallida === cobranzaPedida
  /* Hay una consulta por hacer: se pidió una y todavía no llegó la respuesta de ESE criterio. */
  const cargando = cobranzaPedida !== null && cobranzaPedida !== cobranzaClave && !fallo

  useEffect(() => {
    if (!cargando) return
    let vivo = true
    buscarCobranza(cobranzaCriterio)
      .then((resultado) => {
        if (vivo) dispatch({ type: 'setCobranzaResultado', resultado, clave })
      })
      .catch(() => {
        if (!vivo) return
        setFallida(clave)
        dispatch({
          type: 'errorMonday',
          accion: 'obtener las cuentas corrientes y sus facturas pendientes',
        })
      })
    return () => {
      vivo = false
    }
    /* `cobranzaCriterio` NO entra en las dependencias a propósito: su CLAVE sí, y es lo que lo
       identifica. Con el objeto, cualquier render que lo recreara —sin cambiarle nada— volvería a
       salir a la red. Los campos quedan trabados mientras la consulta está en vuelo (ver
       `CriteriosCobranza`), así que el criterio no puede cambiar debajo de este efecto. */
  }, [cargando, clave, dispatch])

  return {
    /** Hay una consulta en vuelo. */
    cargando,
    /** La consulta del criterio pedido falló. */
    fallo,
    /** Lo que devolvió la última búsqueda, o `null` si todavía no se buscó ninguna vez. */
    resultado: cobranzaResultado,
    /** Pide la consulta del criterio elegido. Es lo ÚNICO que sale a la red en todo el módulo. */
    buscar: () => {
      setFallida(null)
      dispatch({ type: 'pedirCobranza' })
    },
  }
}
