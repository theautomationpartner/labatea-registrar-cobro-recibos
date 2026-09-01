import { useEffect, useRef, useState } from 'react'

/**
 * Cuánto dura el PLEGADO, en ms. Tiene que coincidir con la animación `rec-plegar` de `recibo.css`:
 * es el tiempo que el cuerpo sigue montado después de cerrarse, para que la salida se vea en vez de
 * desaparecer de un corte.
 *
 * Son los MISMOS tiempos que el despliegue de las facturas pendientes (ver `TablaFacturas`).
 */
const MS_PLEGADO = 200

/** Cuánto dura el DESPLIEGUE. Coincide con `rec-desplegar`. */
const MS_DESPLIEGUE = 240

export interface Plegable {
  /** La card está abierta: gobierna el chevron y el `aria-expanded` del botón. */
  abierta: boolean
  /** Se está abriendo AHORA. Es la única fase que se anima al entrar. */
  abriendo: boolean
  /** Se está cerrando: ya está cerrada, pero el cuerpo sigue montado hasta que termina la salida. */
  cerrando: boolean
  /** El cuerpo tiene que estar en el DOM (se lo está leyendo o se está plegando). */
  visible: boolean
  alternar: () => void
}

/**
 * El plegado de una card del documento: qué está abierto, qué se está animando y cuándo el cuerpo
 * se puede desmontar.
 *
 * Vive acá y no dentro de una card porque las dos que dibuja esta etapa —el documento y la
 * constancia de retención— se pliegan IGUAL, y el tiempo de la animación tiene que seguir atado a
 * un solo lugar: si el CSS cambia, cambia una constante y no dos que se corrigen por separado.
 *
 * Lo que NO se comparte es la cabecera ni el cuerpo: cada card muestra lo suyo. Acá sólo está el
 * mecanismo.
 */
export function usePlegable(inicial = true): Plegable {
  const [abierta, setAbierta] = useState(inicial)
  /* Cuerpo que se está PLEGANDO: ya está cerrado, pero sigue montado hasta que termina la animación
     de salida. Sin esto, cerrar lo desmonta en el acto y desaparece de un corte. */
  const [cerrando, setCerrando] = useState(false)
  /* Cuerpo recién abierto: es el único que se anima. La marca dura lo que dura la animación y se
     borra sola, así la card no se despliega de nuevo en la cara del usuario cuando el componente se
     re-renderiza por otro motivo —el estado de la emisión cambia varias veces—.

     Arranca APAGADA aunque la card nazca abierta: al montarse no hay nada que animar. */
  const [abriendo, setAbriendo] = useState(false)
  const reloj = useRef<ReturnType<typeof setTimeout>>()

  // Al desmontar (cambio de paso, fin de la operación) no puede quedar un temporizador buscándolo.
  useEffect(() => () => clearTimeout(reloj.current), [])

  /** Abre o cierra el cuerpo, dejándolo montado el tiempo que dura la animación de salida. */
  const alternar = () => {
    // Abrir y cerrar rápido no puede dejar dos animaciones peleándose por el mismo cuerpo.
    clearTimeout(reloj.current)
    if (abierta) {
      setAbierta(false)
      setAbriendo(false)
      setCerrando(true)
      reloj.current = setTimeout(() => setCerrando(false), MS_PLEGADO)
      return
    }
    setCerrando(false)
    setAbierta(true)
    setAbriendo(true)
    reloj.current = setTimeout(() => setAbriendo(false), MS_DESPLIEGUE)
  }

  /* El cuerpo está en pantalla mientras se lo lee Y mientras se pliega: hasta que la salida termina,
     la card sigue siendo una card abierta. */
  return { abierta, abriendo, cerrando, visible: abierta || cerrando, alternar }
}
