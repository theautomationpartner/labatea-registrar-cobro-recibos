import { useEffect, useRef, useState } from 'react'
import { MS_DESPLIEGUE, MS_PLEGADO } from '@/features/recibo/usePlegable'

export interface FilaDesplegada {
  /** La cuenta desplegada, o `null` si ninguna. */
  abierta: string | null
  /** La que se acaba de abrir: es la única que se anima al entrar. */
  abriendo: string | null
  /**
   * La que se está plegando: ya está cerrada, pero su detalle sigue montado hasta que termina la
   * animación de salida. Sin esto, cerrar lo desmonta en el acto y desaparece de un corte.
   */
  plegando: string | null
  /** ¿El detalle de esta cuenta tiene que estar en el DOM? */
  montada: (id: string) => boolean
  /** Abre la cuenta, o la cierra si ya estaba abierta. */
  alternar: (id: string) => void
  /** La abre sí o sí (lo que hace el ranking al señalar un deudor). */
  abrir: (id: string) => void
  /** Cierra la que esté abierta, sin animar: se usa cuando la lista entera se reemplaza. */
  cerrarYa: () => void
}

/**
 * Qué fila de la tabla está desplegada, con su animación de apertura y de cierre.
 *
 * Es el MISMO mecanismo que el de las cards del recibo (`usePlegable`) y de las facturas
 * pendientes, y usa sus mismas duraciones —importadas, no copiadas—: abrir y cerrar algo tiene que
 * sentirse igual en toda la app, y con los tiempos escritos dos veces la animación se desincroniza
 * del momento en que el contenido se desmonta.
 *
 * Lo que cambia respecto de aquél es que acá no hay UN plegable sino una lista: en vez de un
 * booleano se lleva CUÁL está abierta, cuál se está abriendo y cuál se está plegando. Las tres son
 * ids distintos a propósito: cambiar de una fila a otra cierra la primera MIENTRAS abre la segunda,
 * y las dos animaciones corren a la vez.
 */
export function useFilaDesplegada(): FilaDesplegada {
  const [abierta, setAbierta] = useState<string | null>(null)
  const [abriendo, setAbriendo] = useState<string | null>(null)
  const [plegando, setPlegando] = useState<string | null>(null)
  const relojAbrir = useRef<ReturnType<typeof setTimeout>>()
  const relojCerrar = useRef<ReturnType<typeof setTimeout>>()

  /* Al desmontar (salir del módulo, cambiar de operación) no pueden quedar temporizadores buscando
     un componente que ya no está. */
  useEffect(
    () => () => {
      clearTimeout(relojAbrir.current)
      clearTimeout(relojCerrar.current)
    },
    [],
  )

  /** Deja una fila plegándose: cerrada, pero montada el tiempo que dura su salida. */
  const plegar = (id: string) => {
    clearTimeout(relojCerrar.current)
    setPlegando(id)
    relojCerrar.current = setTimeout(() => setPlegando(null), MS_PLEGADO)
  }

  const abrir = (id: string) => {
    clearTimeout(relojAbrir.current)
    /* Pasar de una fila a otra: la anterior se pliega y la nueva se despliega, las dos a la vez. */
    if (abierta !== null && abierta !== id) plegar(abierta)
    setAbierta(id)
    setAbriendo(id)
    /* La marca de "abriendo" dura lo que dura la animación y se borra sola: si no, la fila se
       volvería a desplegar en la cara del usuario cada vez que la tabla se re-renderiza. */
    relojAbrir.current = setTimeout(() => setAbriendo(null), MS_DESPLIEGUE)
  }

  const cerrar = () => {
    if (abierta === null) return
    clearTimeout(relojAbrir.current)
    setAbriendo(null)
    plegar(abierta)
    setAbierta(null)
  }

  return {
    abierta,
    abriendo,
    plegando,
    montada: (id) => id === abierta || id === plegando,
    alternar: (id) => (id === abierta ? cerrar() : abrir(id)),
    abrir,
    cerrarYa: () => {
      clearTimeout(relojAbrir.current)
      clearTimeout(relojCerrar.current)
      setAbierta(null)
      setAbriendo(null)
      setPlegando(null)
    },
  }
}
