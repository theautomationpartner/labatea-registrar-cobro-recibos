import { useCallback, useEffect, useRef, useState } from 'react'
import {
  emitirRecibo,
  getEstadoEmision,
  marcarAEmitir,
  reciboCompleto,
  type DatosRecibo,
} from '@/services/monday'

/**
 * En qué anda la emisión, desde el punto de vista de la PANTALLA:
 *
 *   idle      · todavía no se pidió nada.
 *   creando   · se está escribiendo el recibo y sus subelementos en Monday.
 *   emitiendo · el recibo ya está escrito y se le pidió la emisión al tablero; se espera su PDF.
 *   emitido   · el tablero cerró la emisión con éxito.
 *   error     · falló algo (la escritura, la lectura del estado, o el propio tablero).
 *
 * `creando` y `emitiendo` se ven casi igual en pantalla, pero NO son lo mismo: en la primera la
 * app está escribiendo y en la segunda está esperando a Monday. Separarlas es lo que permite decir
 * con precisión qué pasó cuando algo falla.
 */
export type FaseEmision = 'idle' | 'creando' | 'emitiendo' | 'emitido' | 'error'

export interface ErrorEmision {
  /** Estado que se muestra al lado del mensaje: la etiqueta del tablero o el origen del fallo. */
  estado: string
  /** El detalle. Cuando el fallo es una excepción, es el mensaje capturado en el `catch`. */
  mensaje: string
}

/** Cada cuánto se le vuelve a preguntar al tablero por el estado de la emisión. */
const INTERVALO_MS = 3000

/**
 * Hasta cuándo se espera al tablero. Sin tope, un recibo que la automatización nunca resuelve
 * dejaría la pantalla girando para siempre. Al vencer NO se da por emitido: se dice que la emisión
 * no terminó, que es lo único que se sabe con certeza.
 */
const LIMITE_MS = 2 * 60 * 1000

/**
 * Lecturas fallidas seguidas que se toleran antes de cortar. La consulta se repite durante minutos,
 * así que un corte de red puntual no puede dar por fallada una emisión que en el tablero va bien.
 */
const REINTENTOS_LECTURA = 3

/** Mensaje de una excepción, sea un `Error` o cualquier cosa que haya llegado al `catch`. */
const mensajeDeError = (e: unknown): string =>
  e instanceof Error && e.message.trim() ? e.message : 'No se pudo completar la operación.'

/**
 * Ciclo completo de la emisión del recibo: escribirlo, pedirle al tablero que lo emita y seguir el
 * resultado hasta que cierre.
 *
 * El seguimiento existe porque la emisión NO es de la app: la app pide ("A emitir") y la
 * automatización de Monday genera el PDF y mueve "🤖Estado de Emision". Por eso la única forma de
 * saber si salió bien es volver a leer esa columna, que es lo que hace el sondeo.
 *
 * Vive en un hook y no en el servicio porque todo lo delicado acá es de React: los temporizadores
 * se cancelan al desmontar y ninguna respuesta que llega tarde escribe estado de un componente que
 * ya no está.
 */
export function useEmisionRecibo() {
  const [fase, setFase] = useState<FaseEmision>('idle')
  /** Id del recibo creado. Con esto cargado, NO se puede volver a emitir: se duplicaría. */
  const [reciboId, setReciboId] = useState<string | null>(null)
  /** Etiqueta del tablero, tal cual: es lo que se muestra para que la pantalla no invente estados. */
  const [estado, setEstado] = useState('')
  const [error, setError] = useState<ErrorEmision | null>(null)
  /** Subelementos que no entraron, si los hubo. */
  const [incompleto, setIncompleto] = useState<string[] | null>(null)

  /* El id también en una ref: el sondeo lo necesita, y así el efecto no depende de un estado que
     cambia justo cuando arranca. */
  const idRef = useRef<string | null>(null)
  /* Emisión en vuelo. Va en una ref y no en el estado porque se lee y se escribe SINCRÓNICAMENTE,
     en la misma invocación: entre el click y el `idRef` ya escrito hay un viaje a la API, y en esa
     ventana el botón todavía no se volvió a renderizar. Sin este cerrojo, dos clicks seguidos
     crearían DOS recibos en el tablero. */
  const enVueloRef = useRef(false)

  /**
   * Escribe el recibo y le pide la emisión al tablero. Al volver deja la fase en `emitiendo`, que
   * es lo que dispara el sondeo.
   */
  const emitir = useCallback(async (datos: DatosRecibo) => {
    // Con un recibo ya creado no se reintenta: volver a emitir duplicaría el ítem y sus subítems.
    if (idRef.current || enVueloRef.current) return
    enVueloRef.current = true
    setFase('creando')
    setError(null)
    setIncompleto(null)
    try {
      /* 1) Cabecera → bulk de facturas → bulk de formas de pago → comprobantes, encadenados dentro
            del servicio. Se espera a que TODO termine: la automatización lee el ítem para armar el
            PDF, así que no se le puede pedir la emisión a un recibo a medio escribir. */
      const resultado = await emitirRecibo(datos)
      idRef.current = resultado.id
      setReciboId(resultado.id)

      /* 2) La emisión se pide SÓLO con el recibo completo. Si algún subelemento no entró —sin que
            la mutación fallara— el PDF saldría sin esas líneas: un recibo que declara menos de lo
            que el cliente pagó. Antes que emitir eso, se frena y se dice qué falta. */
      if (!reciboCompleto(resultado)) {
        setIncompleto(
          [
            resultado.facturasCreadas < resultado.facturasEsperadas &&
              `Facturas canceladas: entraron ${resultado.facturasCreadas} de ${resultado.facturasEsperadas}`,
            resultado.pagosCreados < resultado.pagosEsperados &&
              `Formas de pago: entraron ${resultado.pagosCreados} de ${resultado.pagosEsperados}`,
          ].filter((x): x is string => typeof x === 'string'),
        )
        setError({
          estado: 'Recibo incompleto',
          mensaje:
            'No se pidió la emisión: al recibo le faltan subelementos y el PDF saldría sin ellos. Completalo en Monday y emitilo desde el tablero.',
        })
        setFase('error')
        return
      }

      // 3) Con el recibo entero escrito: "🤖Estado de Emision" → "A emitir".
      await marcarAEmitir(resultado.id)
      setEstado('A emitir')
      setFase('emitiendo')
    } catch (e) {
      /* El mensaje del `catch` es lo que se muestra: dice qué rechazó Monday (columna inválida,
         permisos, límite de complejidad), que es justo lo que hace falta para resolverlo. */
      setError({
        estado: idRef.current ? 'Error al pedir la emisión' : 'Error al crear el recibo',
        mensaje: mensajeDeError(e),
      })
      setFase('error')
    } finally {
      /* Se libera SIEMPRE: si el intento no llegó a crear el ítem (`idRef` vacío), el botón vuelve
         a habilitarse para reintentar. Si sí lo creó, el que sigue frenando es `idRef`. */
      enVueloRef.current = false
    }
  }, [])

  /* Sondeo del estado de emisión. Corre sólo mientras la fase es `emitiendo` y se corta solo al
     llegar a un estado terminal, al vencer el límite o al desmontarse la vista. */
  useEffect(() => {
    if (fase !== 'emitiendo') return
    const itemId = idRef.current
    if (!itemId) return

    let vivo = true
    let timer = 0
    let fallosSeguidos = 0
    const vence = Date.now() + LIMITE_MS

    const mirar = async () => {
      try {
        const actual = await getEstadoEmision(itemId)
        if (!vivo) return
        fallosSeguidos = 0
        if (actual.label) setEstado(actual.label)

        if (actual.fase === 'emitido') {
          setFase('emitido')
          return
        }
        if (actual.fase === 'error') {
          setError({
            // La etiqueta del propio tablero: el estado de error se muestra tal como él lo nombra.
            estado: actual.label || 'Error - Emision',
            mensaje:
              'El tablero no pudo generar el recibo. Revisá el update del ítem en Monday para ver el detalle.',
          })
          setFase('error')
          return
        }
        // Sigue en curso ("A emitir" / "Emitiendo"): se vuelve a mirar, mientras haya tiempo.
        if (Date.now() >= vence) {
          setError({
            estado: actual.label || 'Emisión sin terminar',
            mensaje:
              'La emisión no terminó dentro del tiempo de espera. El recibo ya está creado: revisá su estado en Monday antes de volver a intentarlo.',
          })
          setFase('error')
          return
        }
        timer = window.setTimeout(mirar, INTERVALO_MS)
      } catch (e) {
        if (!vivo) return
        /* Una lectura suelta puede fallar por red sin que la emisión esté mal: se reintenta unas
           cuantas veces y recién ahí se da por perdida. */
        fallosSeguidos += 1
        if (fallosSeguidos <= REINTENTOS_LECTURA && Date.now() < vence) {
          timer = window.setTimeout(mirar, INTERVALO_MS)
          return
        }
        setError({ estado: 'Error al consultar el estado', mensaje: mensajeDeError(e) })
        setFase('error')
      }
    }

    timer = window.setTimeout(mirar, INTERVALO_MS)
    return () => {
      vivo = false
      window.clearTimeout(timer)
    }
  }, [fase])

  return {
    fase,
    /** Etiqueta del estado de emisión que publica el tablero. */
    estado,
    error,
    incompleto,
    reciboId,
    emitir,
    /** El recibo todavía no se creó, así que un intento fallido se puede repetir sin duplicar nada. */
    puedeReintentar: fase === 'error' && reciboId === null,
    limpiarIncompleto: useCallback(() => setIncompleto(null), []),
  }
}
