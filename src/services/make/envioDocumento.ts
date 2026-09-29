/**
 * Envío de un documento a los contactos por el escenario de Make.com: el MISMO webhook
 * (`MAKE_WEBHOOK_ENVIOS_URL`) con el que la app de operaciones de venta envía el presupuesto, el
 * remito y la proforma. Esta app le manda el recibo, la orden de pago y el resumen de cta cte.
 *
 * Igual que la lectura de comprobantes, NUNCA se pega directo al webhook: en producción pasa por
 * `api/make-comprobantes.ts` (`?escenario=envio-documento`) y en desarrollo por el proxy de Vite. La
 * dirección del hook no llega al bundle.
 *
 * El cuerpo es JSON —no multipart— para que el webhook de Make lo reciba YA estructurado:
 * `appJobId`, `documento`, `cliente`, `vendedor`, `medio`, `destinatarios[]`, `pdf` y `adjuntos[]`.
 * Los archivos van en base64 (pesan unos KB); en Make se pasan a archivo con
 * `toBinary(pdf.data; "base64")`.
 *
 *   · `pdf`      · el archivo PRINCIPAL, con la misma forma que usa la app de ventas. Con el recibo y
 *                  la orden de pago es el único.
 *   · `adjuntos` · TODOS los archivos, en orden (el primero es `pdf`). Existe por el resumen de cta
 *                  cte, que puede llevar el resumen y el estado de cuenta, en PDF y en Excel.
 *
 * El escenario CONTESTA cómo terminó el envío, con un módulo "Webhook response" (200 o 400) y este
 * JSON (ver `RespuestaEscenario`):
 *   { "operacion", "medio", "mensajeError", "enviados_whatsapp": [...], "enviosEmail": [...] }
 * Los dos arrays traen UN ítem por contacto: `{ envio_email }` y, por WhatsApp, el id en 360Messenger
 * del mensaje de texto y de cada documento (ver `entregaWhatsapp`). Con esos ids se confirma que
 * salieron de verdad, TODOS (`src/services/whatsapp/estadoMensaje.ts`). Un 200 NO alcanza para dar el
 * envío por hecho: lo que vale es cada ítem (`evaluarEnvio`).
 *
 * A diferencia de la lectura, acá NO se reintenta solo: si el escenario llegó a correr, reintentar
 * mandaría el documento dos veces a los mismos contactos. El reintento lo decide el usuario.
 */
import type { EnvioDocumentoMake, ResultadoEntrega, ResultadosEnvio } from '@/lib/envioDocumento'
import { cabecerasPropias, verificarRespuesta } from '@/services/monday/sdk'
import { mensajeDelEscenario } from './sdk'

const ENDPOINT = import.meta.env.DEV
  ? '/make-envio-documento'
  : '/api/make-comprobantes?escenario=envio-documento'

/**
 * Techo de la espera. El envío es mandar un mail y un WhatsApp, no leer un documento: si en un
 * minuto no contestó, el escenario está trabado y no vale la pena dejar el botón girando.
 */
const TIMEOUT_MS = 60_000

/** Cómo terminó el envío, ya traducido para la pantalla. */
export type ResultadoEnvioMake =
  /**
   * El escenario contestó (200 o 400): el resultado de cada contacto por cada canal y, si falló
   * algo, su `mensajeError`. Si respondió sin el JSON, los arrays vienen vacíos: nada confirmado.
   */
  | {
      tipo: 'respuesta'
      resultados: ResultadosEnvio
      mensaje?: string
      /**
       * El escenario contestó, pero su respuesta no trae el resultado por contacto (no se pudo leer, o
       * no tiene `enviosEmail` / `enviosWhatsapp`). NO quiere decir que haya fallado: no se sabe qué
       * salió, y reintentar podría mandarlo dos veces.
       */
      ilegible?: boolean
    }
  /** No se llegó a saber qué pasó del otro lado: sin conexión, sin configurar, apagado, vencido. */
  | { tipo: 'fallo'; mensaje: string }

/**
 * El JSON con el que contesta el escenario, en un 200 y en un 400:
 *   {
 *     "operacion": "ENVIO RECIBO",
 *     "medio": "Ambos",
 *     "mensajeError": null,
 *     "enviosWhatsapp": [{ "messageId": "f4376401-…", "envio_whatsapp": true }],
 *     "enviosEmail": [{ "envio_email": true }]
 *   }
 */
interface RespuestaEscenario {
  operacion?: unknown
  medio?: unknown
  mensajeError?: unknown
  enviosEmail?: unknown
  /** Formato anterior de los WhatsApp: `{ envio_whatsapp, messageId }`. */
  enviosWhatsapp?: unknown
  /** Los WhatsApp, con el id del texto y el de cada documento (ver `entregaWhatsapp`). */
  enviados_whatsapp?: unknown
}

/** El texto de un campo, o `''` si no vino, es `null` o no es texto. */
const campo = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/**
 * Una bandera del escenario. Make la puede mandar como booleano o, si se armó el JSON con texto,
 * como "true"/"false": las dos formas valen. Cualquier otra cosa —vacío, null, sin la clave— es
 * `false`: lo que el escenario no confirmó no se da por enviado.
 */
const bandera = (v: unknown): boolean => v === true || campo(v).toLowerCase() === 'true'

/**
 * Los ítems de un array del escenario. Acepta el array tal cual y también el array serializado como
 * texto (pasa si en el Webhook response se lo mapea entre comillas); un objeto suelto cuenta como
 * un ítem. Cualquier otra cosa es "sin resultados".
 */
function items(v: unknown): Record<string, unknown>[] {
  let valor = v
  if (typeof valor === 'string' && /^\s*[[{]/.test(valor)) valor = parsear(valor)
  const lista = Array.isArray(valor) ? valor : valor && typeof valor === 'object' ? [valor] : []
  return lista.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object')
}

/** Lo común a los dos canales: de quién es el ítem y, si falló, por qué. */
function datosDelItem(item: Record<string, unknown>): Pick<ResultadoEntrega, 'pulseId' | 'motivo'> {
  const pulseId = campo(item.pulseId) || (typeof item.pulseId === 'number' ? String(item.pulseId) : '')
  const motivo = campo(item.mensajeError) || campo(item.motivo)
  return { ...(pulseId ? { pulseId } : {}), ...(motivo ? { motivo } : {}) }
}

/** Un ítem de `enviosEmail` → el resultado de ese email. */
function entregaEmail(item: Record<string, unknown>): ResultadoEntrega {
  return { ok: bandera(item.envio_email), ...datosDelItem(item) }
}

/**
 * El id en 360Messenger de un mensaje de la respuesta. Llega como `{ phonenumber, id }` o, en los
 * documentos, envuelto en `data` (`{ data: { phonenumber, id } }`).
 */
function idMensaje(v: unknown): string {
  if (!v || typeof v !== 'object') return ''
  const o = v as Record<string, unknown>
  return campo(o.id) || idMensaje(o.data)
}

/**
 * Un ítem de `enviados_whatsapp` → el resultado de ese WhatsApp. Es el formato del escenario:
 *
 *   { "nombre", "pulseId",
 *     "envio_mensaje_texto": { "phonenumber", "id" },
 *     "envio_mensaje_documentos": [{ "data": { "phonenumber", "id" } }] }
 *
 * No trae una bandera: Make lo dio por enviado si devolvió los ids —el del texto y el de al menos un
 * documento—, y después cada uno se confirma contra 360Messenger (`verificarWhatsapps`). Un
 * `envio_whatsapp: false` explícito lo da por no enviado.
 *
 * Se sigue aceptando el formato anterior (`{ envio_whatsapp, messageId }`), que sólo confirmaba el
 * texto.
 */
function entregaWhatsapp(item: Record<string, unknown>): ResultadoEntrega {
  const datos = datosDelItem(item)
  const nuevo = 'envio_mensaje_texto' in item || 'envio_mensaje_documentos' in item
  if (!nuevo) {
    const texto = campo(item.messageId)
    return {
      ok: bandera(item.envio_whatsapp),
      ...datos,
      ...(texto ? { whatsapp: { texto, documentos: [], exigeDocumentos: false } } : {}),
    }
  }
  const texto = idMensaje(item.envio_mensaje_texto)
  const documentos = items(item.envio_mensaje_documentos).map(idMensaje)
  const rechazado = 'envio_whatsapp' in item && !bandera(item.envio_whatsapp)
  const sinDocumentos = documentos.length === 0 || !documentos.every(Boolean)
  // Si Make no dijo el motivo, se dice qué parte no salió.
  const motivo =
    datos.motivo ??
    (rechazado || !texto
      ? 'no se envió el mensaje de WhatsApp'
      : sinDocumentos
        ? 'el mensaje de WhatsApp salió, pero no el documento'
        : undefined)
  return {
    ok: !rechazado && Boolean(texto) && !sinDocumentos,
    ...datos,
    ...(motivo && (rechazado || !texto || sinDocumentos) ? { motivo } : {}),
    whatsapp: { ...(texto ? { texto } : {}), documentos: documentos.filter(Boolean), exigeDocumentos: true },
  }
}

/**
 * La respuesta como un solo objeto. Make puede devolverla como el bundle del módulo —un array con un
 * objeto, `[{ "enviados_whatsapp": [...] }]`—: se juntan sus claves.
 */
function comoObjeto(cuerpo: unknown): RespuestaEscenario {
  if (Array.isArray(cuerpo)) {
    return Object.assign({}, ...cuerpo.filter((x) => x && typeof x === 'object' && !Array.isArray(x)))
  }
  return (cuerpo && typeof cuerpo === 'object' ? cuerpo : {}) as RespuestaEscenario
}

/** Lee lo que contestó el escenario: el resultado de cada envío y, si trae, el motivo del error. */
export function leerRespuesta(cuerpo: unknown): ResultadoEnvioMake {
  const r = comoObjeto(cuerpo)
  const whatsapp = 'enviados_whatsapp' in r ? r.enviados_whatsapp : r.enviosWhatsapp
  const ilegible = !('enviosEmail' in r) && !('enviosWhatsapp' in r) && !('enviados_whatsapp' in r)
  /* Con la clave del contrato presente —aunque venga en null, como en un 200— manda ella. Sin la
     clave, se busca el motivo en las claves genéricas (`error`, `mensaje`…). */
  const mensaje = 'mensajeError' in r ? campo(r.mensajeError) : mensajeDelEscenario(cuerpo)
  // La operación no se muestra: sirve para cruzar el aviso con el historial del escenario.
  if (mensaje && campo(r.operacion)) console.warn(`Envío por Make falló en: ${campo(r.operacion)}`)
  return {
    tipo: 'respuesta',
    resultados: {
      email: items(r.enviosEmail).map(entregaEmail),
      whatsapp: items(whatsapp).map(entregaWhatsapp),
    },
    ...(mensaje ? { mensaje } : {}),
    ...(ilegible ? { ilegible } : {}),
  }
}

/** El cuerpo como JSON, o `null` si no lo era. */
function parsear(texto: string): unknown {
  try {
    return JSON.parse(texto)
  } catch {
    return null
  }
}

/** Claves de los resultados por contacto, que el escenario puede mandar sin corchetes. */
const CLAVES_ENVIOS = ['enviosEmail', 'enviosWhatsapp', 'enviados_whatsapp']

/**
 * Desde `desde` (que apunta a un `{`), el índice justo después de su `}` de cierre, respetando las
 * comillas. `-1` si el objeto no cierra.
 */
function finDeObjeto(texto: string, desde: number): number {
  let nivel = 0
  let enTexto = false
  for (let i = desde; i < texto.length; i++) {
    const c = texto[i]
    if (enTexto) {
      if (c === '\\') i++
      else if (c === '"') enTexto = false
      continue
    }
    if (c === '"') enTexto = true
    else if (c === '{') nivel++
    else if (c === '}' && --nivel === 0) return i + 1
  }
  return -1
}

/**
 * Repara el JSON que arma a mano el módulo "Webhook response" del escenario. Ese módulo no serializa:
 * pega el texto de sus variables en una plantilla, y lo que sale no siempre es JSON válido. Visto en
 * el escenario (con un pedido sin destinatarios):
 *
 *   "enviosWhatsapp": ,          ← el agregador vacío no deja nada
 *   "enviosEmail":
 *
 * y, con más de un contacto, los ítems pegados sin corchetes: `"enviosEmail": {…},{…}`.
 *
 * Sin reparar, `JSON.parse` falla, la app se queda sin resultados y dice "no confirmó el envío"
 * aunque los mensajes hayan salido.
 */
export function repararJsonEscenario(texto: string): string {
  let t = texto
  // Los ítems sueltos de cada array, entre corchetes.
  for (const clave of CLAVES_ENVIOS) {
    const m = new RegExp(`"${clave}"\\s*:\\s*`).exec(t)
    if (!m) continue
    const inicio = m.index + m[0].length
    if (t[inicio] !== '{') continue
    let fin = finDeObjeto(t, inicio)
    if (fin === -1) continue
    for (;;) {
      const siguiente = /^\s*,\s*\{/.exec(t.slice(fin))
      if (!siguiente) break
      const otro = finDeObjeto(t, fin + siguiente[0].length - 1)
      if (otro === -1) break
      fin = otro
    }
    t = `${t.slice(0, inicio)}[${t.slice(inicio, fin)}]${t.slice(fin)}`
  }
  // Un valor vacío (`"clave": ,` o al final del objeto) pasa a `null`.
  return t.replace(/:\s*(?=,|\})/g, ': null')
}

/** La respuesta del escenario como JSON, reparándola si hace falta. `null` si ni así se puede leer. */
export function parsearRespuestaEscenario(texto: string): unknown {
  const directo = parsear(texto)
  if (directo !== null) return directo
  return parsear(repararJsonEscenario(texto))
}

/** Un archivo dentro del JSON: su nombre, su tipo y el contenido en base64. */
export interface ArchivoAdjunto {
  name: string
  mime: string
  data: string
}

/** Lo que viaja al webhook: la estructura del envío con los archivos adjuntos. */
export type CuerpoEnvioDocumento = EnvioDocumentoMake & {
  /** El archivo principal: el primero de `adjuntos`. */
  pdf: ArchivoAdjunto
  /** Todos los archivos, en orden. */
  adjuntos: ArchivoAdjunto[]
}

/** Bytes → base64, por tandas: `String.fromCharCode(...bytes)` de un archivo entero rompe la pila. */
function aBase64(bytes: Uint8Array): string {
  let binario = ''
  const TANDA = 0x8000
  for (let i = 0; i < bytes.length; i += TANDA) {
    binario += String.fromCharCode(...bytes.subarray(i, i + TANDA))
  }
  return btoa(binario)
}

async function adjunto(archivo: File): Promise<ArchivoAdjunto> {
  const data = aBase64(new Uint8Array(await archivo.arrayBuffer()))
  return { name: archivo.name, mime: archivo.type || 'application/pdf', data }
}

/** Arma el cuerpo: los datos del envío en la raíz, el archivo principal en `pdf` y todos en `adjuntos`. */
export async function cuerpoEnvioDocumento(
  datos: EnvioDocumentoMake,
  archivos: readonly File[],
): Promise<CuerpoEnvioDocumento> {
  const adjuntos = await Promise.all(archivos.map(adjunto))
  return { ...datos, pdf: adjuntos[0], adjuntos }
}

/**
 * Dispara el escenario y espera su respuesta. Sólo lanza por un rechazo de acceso (401/403/429): lo
 * comunica la ventana de seguridad, igual que en el resto de los pedidos a nuestro backend.
 */
export async function enviarDocumentoMake(
  datos: EnvioDocumentoMake,
  archivos: readonly File[],
): Promise<ResultadoEnvioMake> {
  if (archivos.length === 0) return { tipo: 'fallo', mensaje: 'No hay ningún documento para enviar.' }
  const ctrl = new AbortController()
  let vencio = false
  const reloj = setTimeout(() => {
    vencio = true
    ctrl.abort()
  }, TIMEOUT_MS)

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      body: JSON.stringify(await cuerpoEnvioDocumento(datos, archivos)),
      /* En desarrollo el destino es el proxy de Vite, que va derecho al webhook: no hay guardián al
         que presentarle la sesión (mismo criterio que la lectura de comprobantes). */
      headers: import.meta.env.DEV
        ? { 'Content-Type': 'application/json' }
        : await cabecerasPropias({ 'Content-Type': 'application/json' }),
      signal: ctrl.signal,
    })
    // El guardián rechazó al usuario: se levanta la ventana de seguridad y se corta acá.
    if (res.status === 401 || res.status === 403 || res.status === 429) {
      await verificarRespuesta(res, 'Envío del documento')
    }
    const texto = await res.text()
    // 200 o 400: el escenario corrió y dice, canal por canal, qué salió.
    if (res.ok || res.status === 400) {
      const respuesta = leerRespuesta(parsearRespuestaEscenario(texto))
      // Para diagnosticar del lado del escenario: lo que contestó, tal cual.
      if (respuesta.tipo === 'respuesta' && respuesta.ilegible) {
        console.warn('El escenario de envío contestó sin un resultado legible:', texto)
      }
      return respuesta
    }

    // Sin la variable del webhook la ruta no existe (desarrollo) o el proxy lo dice (producción).
    if (res.status === 404) {
      return { tipo: 'fallo', mensaje: 'El servicio de envío de documentos no está configurado.' }
    }
    // El escenario está apagado: no corrió nada, así que reintentar más tarde es seguro.
    if (res.status === 410) {
      return {
        tipo: 'fallo',
        mensaje: 'El servicio de envío no está disponible en este momento. Probá de nuevo en unos minutos.',
      }
    }
    /* Cualquier otro código es de la plataforma, no del escenario: su cuerpo (HTML, diagnóstico)
       no se muestra. */
    return { tipo: 'fallo', mensaje: 'El envío no se pudo completar. Probá de nuevo en unos minutos.' }
  } catch (e) {
    if (vencio) {
      return {
        tipo: 'fallo',
        mensaje:
          'El servicio de envío tardó demasiado en responder. Revisá en unos minutos si el documento llegó antes de reintentar.',
      }
    }
    // `fetch` sólo rechaza con TypeError cuando no hubo conexión: no llegó a correr nada.
    if (e instanceof TypeError) {
      return { tipo: 'fallo', mensaje: 'No se pudo conectar con el servidor. Revisá la conexión y reintentá.' }
    }
    throw e
  } finally {
    clearTimeout(reloj)
  }
}
