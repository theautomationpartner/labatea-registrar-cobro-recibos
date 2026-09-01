import { useCallback, useEffect, useRef, useState } from 'react'
import { RECIBO_EMISIBLE, type Emisible } from '@/features/shared/emisiones'
import type { DatosRecibo } from '@/services/monday'
import { useApp, useDispatch } from '@/state/hooks'

/** Cada cuánto se le vuelve a preguntar al tablero por el estado de la emisión. */
const INTERVALO_MS = 3000

/**
 * Hasta cuándo se espera al tablero: un minuto y medio, que es lo que la automatización puede llegar
 * a tardar en emitir el PDF cuando está cargada. Sin tope, un recibo que nunca se resuelve dejaría
 * la pantalla girando para siempre.
 *
 * Vencido el plazo sin un "Emitido", el desenlace es ERROR. No se da por emitido ni se deja la
 * espera abierta: lo único que se sabe con certeza es que la emisión no terminó, y anunciarla como
 * buena sería inventar un recibo que el tablero nunca generó.
 */
const LIMITE_MS = 90 * 1000

/**
 * Lecturas fallidas seguidas que se toleran antes de cortar. La consulta se repite durante todo el
 * plazo, así que un corte de red puntual no puede dar por fallada una emisión que en el tablero va
 * bien.
 */
const REINTENTOS_LECTURA = 3

/** Mensaje de una excepción, sea un `Error` o cualquier cosa que haya llegado al `catch`. */
const mensajeDeError = (e: unknown): string =>
  e instanceof Error && e.message.trim() ? e.message : 'No se pudo completar la operación.'

/**
 * Ciclo completo de la emisión del recibo: escribirlo, pedirle al tablero que lo emita y seguir el
 * resultado hasta que cierre.
 *
 * El seguimiento existe porque la emisión NO es de la app: la app la PIDE —"A emitir" en "🤖Estado
 * de Emision"— y la automatización de Monday genera el PDF y mueve esa misma columna. Por eso la
 * única forma de saber si salió bien es volver a leerla, que es lo que hace el sondeo: se pide y se
 * espera en la MISMA columna.
 *
 * El estado de la emisión —fase, etiqueta del tablero y error— NO vive acá: vive en el estado
 * GLOBAL (`emision`), igual que el id del recibo y que la marca de envío. Es un hecho de la
 * OPERACIÓN, no de la pantalla: el recibo se emite una sola vez. Con la fase adentro del hook,
 * volver un paso desmontaba la vista, la fase caía a `idle` y al regresar la app volvía a ofrecer
 * emitir un recibo que ya estaba escrito en Monday —y aceptar habría creado un segundo ítem—.
 *
 * Lo que sí es del hook es todo lo delicado de React: los temporizadores se cancelan al desmontar, y
 * el sondeo se retoma al volver porque la fase persistida dice que la emisión sigue en curso.
 */
export function useEmision<D>(documento: Emisible<D>) {
  const state = useApp()
  const dispatch = useDispatch()
  const emision = documento.emision(state)
  const itemIdGuardado = documento.itemId(state)
  const { fase, estado, error } = emision
  /* Los subelementos que no entraron. Éste SÍ es local: es el detalle de una ventana que se cierra
     leyéndola. Lo que tiene que sobrevivir a la navegación es el error de la card —y ése ya está en
     `emision`—, no el aviso que el usuario ya despachó. */
  const [incompleto, setIncompleto] = useState<string[] | null>(null)

  /* El id del recibo en una ref, SEMBRADA con el que ya haya en el estado: el sondeo lo necesita, y
     al volver a la etapa es lo que impide reemitir un recibo que ya está creado. */
  const idRef = useRef<string | null>(itemIdGuardado)
  /* Emisión en vuelo. Va en una ref y no en el estado porque se lee y se escribe SINCRÓNICAMENTE,
     en la misma invocación: entre el click y el `idRef` ya escrito hay un viaje a la API, y en esa
     ventana el botón todavía no se volvió a renderizar. Sin este cerrojo, dos clicks seguidos
     crearían DOS recibos en el tablero. */
  const enVueloRef = useRef(false)

  /**
   * Escribe el recibo y le pide la emisión al tablero. Al volver deja la fase en `emitiendo`, que
   * es lo que dispara el sondeo.
   */
  const emitir = useCallback(
    async (datos: D) => {
      // Con un recibo ya creado no se reintenta: volver a emitir duplicaría el ítem y sus subítems.
      if (idRef.current || enVueloRef.current) return
      enVueloRef.current = true
      dispatch(documento.parchear({ fase: 'creando', error: null }))
      setIncompleto(null)
      try {
        /* 1) Cabecera → bulk de facturas → bulk de formas de pago → comprobantes, encadenados dentro
              del servicio. Se espera a que TODO termine: la automatización lee el ítem para armar el
              PDF, así que no se le puede pedir la emisión a un recibo a medio escribir. */
        const resultado = await documento.crear(datos)
        idRef.current = resultado.id
        /* El id va al estado global apenas existe: de ahí lo saca el envío, y es —junto con la
           fase— lo que hace que volver a esta etapa reencuentre el recibo ya creado. */
        dispatch(documento.guardarId(resultado.id))

        /* 2) La emisión se pide SÓLO con el recibo completo. Si algún subelemento no entró —sin que
              la mutación fallara— el PDF saldría sin esas líneas: un recibo que declara menos de lo
              que el cliente pagó. Antes que emitir eso, se frena y se dice qué falta. */
        if (!documento.completo(resultado)) {
          setIncompleto(documento.faltantes(datos, resultado))
          dispatch(
            documento.parchear({
              fase: 'error',
              error: {
                estado: 'Documento incompleto',
                mensaje: documento.mensajeIncompleto,
              },
            }),
          )
          return
        }

        /* 3) Con el recibo entero escrito, se le pide la EMISIÓN: "🤖Estado de Emision" → "A
              emitir". Ese cambio es el disparador de la automatización que genera el PDF, y es la
              MISMA columna que el sondeo de abajo mira hasta que llegue a "Emitido". */
        await documento.pedirEmision(resultado.id)
        dispatch(documento.parchear({ fase: 'emitiendo', estado: 'A emitir' }))
      } catch (e) {
        /* El mensaje del `catch` es lo que se muestra: dice qué rechazó Monday (columna inválida,
           permisos, límite de complejidad), que es justo lo que hace falta para resolverlo. */
        dispatch(
          documento.parchear({
            fase: 'error',
            error: {
              estado: idRef.current
                ? 'Error al pedir la emisión'
                : `Error al crear ${documento.nombre}`,
              mensaje: mensajeDeError(e),
            },
          }),
        )
      } finally {
        /* Se libera SIEMPRE: si el intento no llegó a crear el ítem (`idRef` vacío), el botón vuelve
           a habilitarse para reintentar. Si sí lo creó, el que sigue frenando es `idRef`. */
        enVueloRef.current = false
      }
    },
    [dispatch, documento],
  )

  /* Sondeo del estado de emisión. Corre sólo mientras la fase es `emitiendo` y se corta solo al
     llegar a un estado terminal, al vencer el límite o al desmontarse la vista.

     Con la fase en el estado global, volver a la etapa con la emisión todavía en curso RETOMA el
     sondeo en vez de dejarlo perdido: el efecto se vuelve a montar leyendo `emitiendo`, y el id ya
     está en `idRef` porque se sembró del estado. */
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
        const actual = await documento.getEstado(itemId)
        if (!vivo) return
        fallosSeguidos = 0
        if (actual.label) dispatch(documento.parchear({ estado: actual.label }))

        if (actual.fase === 'emitido') {
          dispatch(documento.parchear({ fase: 'emitido' }))
          return
        }
        if (actual.fase === 'error') {
          dispatch(
            documento.parchear({
              fase: 'error',
              error: {
                // La etiqueta del propio tablero: el error se muestra tal como él lo nombra.
                estado: actual.label || 'Error - Emision',
                mensaje: `El tablero no pudo generar ${documento.nombre}. Revisá el update del ítem en Monday para ver el detalle.`,
              },
            }),
          )
          return
        }
        // Sigue en curso ("A emitir" / "Emitiendo"): se vuelve a mirar, mientras haya tiempo.
        if (Date.now() >= vence) {
          dispatch(
            documento.parchear({
              fase: 'error',
              error: {
                estado: actual.label || 'Emisión sin terminar',
                mensaje: `La emisión no terminó dentro del tiempo de espera. ${documento.nombre === 'el recibo' ? 'El recibo ya está creado' : 'La orden ya está creada'}: revisá su estado en Monday antes de volver a intentarlo.`,
              },
            }),
          )
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
        dispatch(
          documento.parchear({
            fase: 'error',
            error: { estado: 'Error al consultar el estado', mensaje: mensajeDeError(e) },
          }),
        )
      }
    }

    timer = window.setTimeout(mirar, INTERVALO_MS)
    return () => {
      vivo = false
      window.clearTimeout(timer)
    }
  }, [fase, dispatch, documento])

  return {
    fase,
    /** Etiqueta del estado de emisión que publica el tablero. */
    estado,
    error,
    incompleto,
    emitir,
    /** El documento todavía no se creó, así que un intento fallido se puede repetir sin duplicar nada. */
    puedeReintentar: fase === 'error' && itemIdGuardado === null,
    limpiarIncompleto: useCallback(() => setIncompleto(null), []),
  }
}

/**
 * El ciclo de emisión del RECIBO. Es `useEmision` con el adaptador del recibo puesto: existe para
 * que la vista del paso 4 de Cobros no tenga que conocer el catálogo, igual que antes.
 */
export const useEmisionRecibo = () => useEmision<DatosRecibo>(RECIBO_EMISIBLE)
