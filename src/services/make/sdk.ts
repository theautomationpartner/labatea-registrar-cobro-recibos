/**
 * Acceso a los escenarios de Make.com.
 *
 * NUNCA se pega directo contra el webhook: la llamada pasa por un proxy propio que guarda su
 * dirección del lado del servidor (`MAKE_WEBHOOK_COMPROBANTES`, ver `api/make-comprobantes.ts`).
 * El hook no lleva credenciales, pero sí es la llave para hacer correr el escenario: publicada en el
 * bundle, cualquiera la lee con las herramientas del navegador y gasta las operaciones de la cuenta.
 * Mismo esquema que Monday —Vite en desarrollo, función serverless en producción—, sólo que acá lo
 * que se esconde es el destino y no un token.
 *
 * El cuerpo va SIEMPRE como `multipart/form-data`: los documentos son binarios (PDF o imagen) y
 * meterlos en un JSON obligaría a pasarlos por base64, que los infla un tercio y obliga a Make a
 * reconstruirlos antes de leerlos.
 */
const ENDPOINT = import.meta.env.DEV ? '/make-comprobantes' : '/api/make-comprobantes'

/**
 * Cuánto se espera la respuesta del escenario. Es un techo generoso a propósito: del otro lado hay
 * un módulo de IA leyendo un documento, no una consulta a una base, y cortar a los diez segundos
 * daría por fallido un procesamiento que estaba por terminar bien.
 *
 * La app NO es la que apura: quien corta primero es Make, que tiene su propio tope para el módulo
 * "Webhook response". Este tiempo existe sólo para que un escenario colgado no deje la pantalla
 * esperando para siempre.
 */
const TIMEOUT_MS = 120_000

/** Lo que devolvió el escenario: el texto crudo y, si era JSON válido, ya parseado. */
export interface RespuestaMake {
  /** Cuerpo tal como llegó. Sirve para el mensaje de error cuando no vino JSON. */
  texto: string
  /** El cuerpo parseado, o `null` si no era JSON (Make responde "Accepted" cuando no hay módulo de respuesta). */
  json: unknown
}

/** El escenario tardó más de lo aceptable. Se distingue de un fallo para poder ofrecer reintentar. */
export class TimeoutMake extends Error {
  constructor() {
    super('El escenario de Make tardó demasiado en responder. Probá de nuevo.')
    this.name = 'TimeoutMake'
  }
}

/**
 * El documento no se puede procesar, y con ESTE archivo no se va a poder: el escenario no logró
 * convertirlo a PDF, así que la IA nunca llega a tener algo que leer.
 *
 * Se distingue de cualquier otro error porque cambia lo que hay que hacer: no es cuestión de
 * reintentar —el resultado sería idéntico— sino de subir otro archivo. La UI lo dice así, sin
 * ofrecer un botón que no lleva a ningún lado.
 */
export class ErrorFatalMake extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'ErrorFatalMake'
  }
}

/**
 * Códigos con los que el escenario declara ese fallo de conversión: la herramienta de PDF falló, o
 * ni siquiera pudo descargar el archivo que se le mandó. Viajan en la clave del error (ver
 * `CLAVES_CODIGO`) junto al 400.
 */
const CODIGOS_FATALES = ['PDFCO_ERROR', 'DOWNLOAD_FILE_ERROR']

/**
 * El escenario NO llegó a procesar el documento y puede llegar a hacerlo en un rato: está apagado,
 * Make devolvió un error de su gateway, o la red falló. Se reintenta solo.
 *
 * Es la diferencia que decide si vale la pena insistir: acá no corrió nada, así que reintentar no
 * duplica trabajo. Un escenario que SÍ recibió el documento —aunque no haya devuelto datos— nunca
 * entra por acá: volver a mandárselo lo haría procesar dos veces el mismo comprobante.
 */
class FalloTransitorio extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'FalloTransitorio'
  }
}

/**
 * Cuántas veces se intenta EN TOTAL antes de darse por vencido, y cuánto se espera entre intentos.
 *
 * Existe para el caso más común mientras se arma el escenario: el documento se sube con el
 * escenario todavía apagado. En vez de fallar en el acto, la app espera —con la animación en
 * marcha— y vuelve a probar, así activarlo alcanza para que la carga siga sola.
 *
 * Las esperas suben: si al primer respiro no estaba listo, el segundo da más margen. Son dos
 * reintentos y ~15 segundos de tolerancia; más que eso ya es hacerle esperar al usuario por algo
 * que no se va a arreglar solo.
 */
const INTENTOS = 3
const ESPERAS_MS = [5_000, 10_000]

/** Espera cancelable: si el usuario cambia el documento, el reintento no llega a salir. */
const esperar = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const reloj = setTimeout(fin, ms)
    function fin() {
      clearTimeout(reloj)
      signal?.removeEventListener('abort', fin)
      resolve()
    }
    signal?.addEventListener('abort', fin)
  })

/** Qué le puede pasar a una llamada al webhook, más allá de la respuesta. */
export interface OpcionesWebhook {
  /** Cancela la llamada y los reintentos pendientes. */
  signal?: AbortSignal
  /**
   * Se avisa ANTES de cada espera, para que la pantalla diga que se sigue intentando. Sin esto, los
   * quince segundos de tolerancia se verían como una app colgada.
   */
  onReintento?: (intento: number, total: number, esperaMs: number) => void
}

/**
 * Manda un `FormData` a un webhook de Make y devuelve su respuesta, insistiendo mientras el
 * escenario todavía no esté en condiciones de atender (ver `FalloTransitorio`).
 *
 * Un fallo que NO es transitorio corta en el primer intento: si el escenario contestó —con datos,
 * con un error propio o con un acuse de recibo—, ya dijo lo que tenía para decir, y volver a
 * mandarle el documento sólo lo haría procesarlo de nuevo.
 */
export async function postWebhook(
  form: FormData,
  { signal, onReintento }: OpcionesWebhook = {},
): Promise<RespuestaMake> {
  for (let intento = 1; ; intento++) {
    try {
      return await unIntento(form, signal)
    } catch (e) {
      const espera = ESPERAS_MS[intento - 1]
      // Se reintenta sólo lo que puede cambiar solo, y mientras queden intentos y nadie cancele.
      if (!(e instanceof FalloTransitorio) || intento >= INTENTOS || signal?.aborted) throw e
      onReintento?.(intento, INTENTOS, espera)
      await esperar(espera, signal)
      if (signal?.aborted) throw e
    }
  }
}

/**
 * Un intento contra el webhook.
 *
 * El `Content-Type` NO se setea a mano: lo arma el navegador con el `boundary` que corresponde al
 * multipart —fijarlo a mano rompe el cuerpo—.
 *
 * La cancelación tiene dos fuentes que terminan en el mismo `AbortController`: el `signal` de quien
 * llama (el usuario cargó otro documento, o se fue de la pantalla) y el vencimiento del tiempo de
 * espera. Se distinguen por la bandera `vencio`, porque una es un error que se muestra y la otra no.
 */
async function unIntento(form: FormData, signal?: AbortSignal): Promise<RespuestaMake> {
  const ctrl = new AbortController()
  let vencio = false

  const reloj = setTimeout(() => {
    vencio = true
    ctrl.abort()
  }, TIMEOUT_MS)
  const cancelar = () => ctrl.abort()
  signal?.addEventListener('abort', cancelar)

  try {
    const res = await fetch(ENDPOINT, { method: 'POST', body: form, signal: ctrl.signal })
    const texto = await res.text()
    if (!res.ok) {
      /* 410 es el caso típico y merece su propio mensaje: el escenario existe pero no está
         escuchando —quedó apagado, o Make lo puso en pausa después de capturar la estructura—.
         Nada corrió del otro lado, así que se reintenta: activarlo alcanza para que la carga siga. */
      if (res.status === 410) {
        throw new FalloTransitorio(
          'El escenario de Make no está activo: activalo para poder procesar el documento.',
        )
      }
      /* 5xx y 429 son de la infraestructura de Make, no del escenario: puede andar en el próximo
         intento. Un 4xx es una respuesta del escenario y no cambia por insistir. */
      if (res.status >= 500 || res.status === 429) {
        throw new FalloTransitorio(mensajeDeFallo(texto, res.status))
      }
      /* El archivo no se pudo convertir a PDF: es del documento, no del escenario ni del momento.
         Se lanza aparte para que la pantalla lo trate como lo que es —un error fatal de ESTE
         archivo— en vez de invitar a reintentar. */
      const fatal = mensajeFatal(texto)
      if (fatal) throw new ErrorFatalMake(fatal)
      throw new Error(mensajeDeFallo(texto, res.status))
    }
    return { texto, json: parsearJson(texto) }
  } catch (e) {
    if (vencio) throw new TimeoutMake()
    /* La red se cayó o el servidor no atendió: `fetch` sólo rechaza por eso, y es lo más
       transitorio que hay. Se distingue de los errores que se lanzan acá arriba a propósito. */
    if (e instanceof TypeError) {
      throw new FalloTransitorio('No se pudo conectar con Make. Revisá la conexión.')
    }
    throw e
  } finally {
    clearTimeout(reloj)
    signal?.removeEventListener('abort', cancelar)
  }
}

/* ===== Errores del escenario ===== */

/**
 * Claves donde el escenario puede dejar el MENSAJE del error. La primera es la del contrato actual
 * —un fallo del módulo de IA vuelve como `{ "Clave": "CLAUDE_ERROR", "error": "…" }`—; las demás
 * cubren las formas habituales de nombrar lo mismo.
 */
const CLAVES_MENSAJE = ['error', 'mensaje', 'message', 'detalle', 'detail', 'descripcion']

/** Claves donde viene el CÓDIGO del error ("CLAUDE_ERROR"). Sólo se usa si no hay mensaje. */
const CLAVES_CODIGO = ['clave', 'codigo', 'code', 'tipo']

/** Tope del mensaje en pantalla: un párrafo se lee, media pantalla de texto no. */
const MAX_MENSAJE = 220

/** Clave comparable: sin mayúsculas, tildes ni separadores ("Clave" y "clave" son la misma). */
const clave = (k: string): string =>
  k
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

/**
 * Busca en un cuerpo de error el texto que se le puede MOSTRAR al usuario, recorriendo hasta dos
 * niveles de anidado. Devuelve `''` si no hay ninguno.
 *
 * Existe porque el cuerpo crudo NO es un mensaje: volcar `{"Clave":"CLAUDE_ERROR","error":"…"}` en
 * pantalla obliga a leer JSON para enterarse de algo que el escenario ya dijo en castellano.
 */
export function mensajeDelEscenario(cuerpo: unknown, profundidad = 2): string {
  if (typeof cuerpo === 'string') return cuerpo.trim()
  if (!cuerpo || typeof cuerpo !== 'object') return ''
  const entradas = Object.entries(cuerpo as Record<string, unknown>)

  // Primero las claves que NOMBRAN un mensaje, en orden de preferencia.
  for (const objetivo of CLAVES_MENSAJE) {
    for (const [k, v] of entradas) {
      if (clave(k) !== objetivo) continue
      if (typeof v === 'string' && v.trim()) return v.trim()
      // `error` puede ser un objeto con el texto adentro (`{ error: { message } }`).
      if (profundidad > 0) {
        const anidado = mensajeDelEscenario(v, profundidad - 1)
        if (anidado) return anidado
      }
    }
  }
  // Y si no, un nivel más adentro: el mensaje puede venir envuelto en `body`, `data` o similar.
  if (profundidad > 0) {
    for (const [, v] of entradas) {
      if (v && typeof v === 'object') {
        const anidado = mensajeDelEscenario(v, profundidad - 1)
        if (anidado) return anidado
      }
    }
  }
  return ''
}

/** Recorta un mensaje largo sin cortar la palabra por la mitad. */
const recortar = (mensaje: string): string =>
  mensaje.length <= MAX_MENSAJE ? mensaje : `${mensaje.slice(0, MAX_MENSAJE).trimEnd()}…`

/**
 * Qué se le muestra al usuario cuando Make responde con un código de error.
 *
 * El orden es: el mensaje que mandó el escenario, el código de error si sólo vino eso, y recién al
 * final uno genérico con el HTTP. Lo que NUNCA se muestra es el cuerpo crudo —JSON o HTML—: para
 * quien está cargando una cobranza es ruido, y el detalle técnico ya está en el historial de Make.
 */
function mensajeDeFallo(texto: string, status: number): string {
  const cuerpo = parsearJson(texto)
  if (cuerpo === null) {
    /* Sin JSON, el cuerpo suele ser una línea de texto legible. Se muestra salvo que sea una página
       HTML de error, que no le dice nada a nadie. */
    const plano = texto.trim()
    if (plano && !plano.startsWith('<')) return recortar(plano)
    return `El escenario de Make falló (HTTP ${status}). Volvé a intentar en unos segundos.`
  }

  const mensaje = mensajeDelEscenario(cuerpo)
  if (mensaje) return recortar(mensaje)

  const codigo = codigoDelEscenario(cuerpo)
  return codigo
    ? `El escenario de Make falló con el error "${codigo}". Volvé a intentar en unos segundos.`
    : `El escenario de Make falló (HTTP ${status}). Volvé a intentar en unos segundos.`
}

/**
 * Mensaje del fallo de CONVERSIÓN del archivo, o `''` si el error es de otra cosa.
 *
 * Se reconoce por el código que manda el escenario, no por el texto: el texto lo redacta la IA y
 * puede cambiar, el código es el contrato.
 */
function mensajeFatal(texto: string): string {
  const cuerpo = parsearJson(texto)
  const codigo = clave(codigoDelEscenario(cuerpo))
  if (!codigo || !CODIGOS_FATALES.some((c) => clave(c) === codigo)) return ''

  const detalle = mensajeDelEscenario(cuerpo)
  return recortar(
    `El documento no se pudo convertir a PDF, así que no hay nada que leer. Subí otro archivo: con este el resultado va a ser el mismo.${
      detalle ? ` (${detalle})` : ''
    }`,
  )
}

/** Código del error, para nombrarlo cuando el escenario no mandó ningún texto. */
function codigoDelEscenario(cuerpo: unknown): string {
  if (!cuerpo || typeof cuerpo !== 'object') return ''
  for (const [k, v] of Object.entries(cuerpo as Record<string, unknown>)) {
    if (CLAVES_CODIGO.includes(clave(k)) && typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

/** El cuerpo como JSON, o `null` si no lo era. No lanza: que no sea JSON es un caso previsto. */
function parsearJson(texto: string): unknown {
  const limpio = texto.trim()
  if (!limpio || !/^[[{]/.test(limpio)) return null
  try {
    return JSON.parse(limpio)
  } catch {
    return null
  }
}

/**
 * Identificador de la llamada. Viaja en el `FormData` y vuelve en la respuesta: es lo que permite
 * seguir un documento puntual en el historial del escenario cuando hay que auditar qué leyó.
 *
 * Formato `job_<fecha>_<azar>`: el prefijo temporal ordena los intentos a simple vista y el sufijo
 * los hace únicos aunque se disparen dos en el mismo milisegundo.
 */
export function nuevoJobId(): string {
  const azar =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  return `job_${Date.now()}_${azar}`
}
