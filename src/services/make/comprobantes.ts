/**
 * Lectura AUTOMÁTICA del comprobante de un cobro.
 *
 * El usuario sube un documento —comprobante de transferencia, cheque, certificado de retención o
 * cupón de tarjeta— y este servicio se lo manda a un escenario de Make.com, que lo lee y devuelve
 * los datos ya extraídos. Con eso el formulario se completa solo y el usuario pasa de TIPEAR el
 * comprobante a REVISARLO, que es donde su tiempo vale.
 *
 * Lo que se registra en Monday sigue saliendo del formulario, no de esta respuesta: lo que llega de
 * Make se vuelca sobre los campos y ahí queda a la vista, editable, antes de agregar el movimiento.
 * Un OCR que se equivoca tiene que poder corregirse, y el usuario firma lo que ve.
 *
 * ── Contrato con el escenario ──
 * PIDE (multipart/form-data):
 *   jobId         · identificador de la llamada, vuelve en la respuesta
 *   formaPago     · medio que se está cargando ("Transferencia", "Cheque", "Retencion IVA"…)
 *   nombreArchivo · nombre original del documento
 *   tipoArchivo   · MIME ("application/pdf", "image/jpeg"…)
 *   origen        · qué app llamó, para separar tráfico en el historial del escenario
 *   archivo       · el binario
 *
 * DEVUELVE (JSON). Los datos pueden venir en la raíz o dentro de `datos`/`data`/`resultado`, y cada
 * campo acepta varios nombres (ver `ALIAS`): el escenario se arma del otro lado y no tiene por qué
 * calzar letra por letra con el modelo de la app. Un error se declara con `{ ok: false, error }`.
 */
import { round2 } from '@/lib/format'
import type { FormaPago, FormatoCheque } from '@/types'
import { mensajeDelEscenario, nuevoJobId, postWebhook, type OpcionesWebhook } from './sdk'

/**
 * Webhook del escenario que lee los comprobantes.
 *
 * Viaja por entorno y no escrita acá porque el repositorio es público: una URL de hook commiteada la
 * encuentran los bots que rastrean GitHub, y con ella cualquiera dispara el escenario y consume las
 * operaciones de la cuenta de Make. En el bundle termina igual —esto corre en el navegador—, pero
 * eso expone el hook a quien usa la app, no a quien mira el repositorio.
 */
export const WEBHOOK_COMPROBANTES =
  (import.meta.env.VITE_MAKE_WEBHOOK_COMPROBANTES as string | undefined)?.trim() || ''

/** Qué se acepta subir: el `accept` del input y el filtro que corre antes de gastar una llamada. */
export const ACEPTA_ARCHIVO = 'application/pdf,image/*'

/** Tope de tamaño. Un comprobante es una hoja: por encima de esto hay un archivo equivocado. */
const MAX_MB = 10

/**
 * Por qué NO se puede leer este archivo, o `null` si está bien. Se valida ANTES de llamar al
 * escenario: mandar un .docx de 40 MB para que Make lo rechace sería hacerle esperar al usuario un
 * viaje de ida y vuelta para enterarse de algo que se sabe en el acto.
 */
export function archivoNoSoportado(archivo: File): string | null {
  const esPdf = archivo.type === 'application/pdf' || /\.pdf$/i.test(archivo.name)
  const esImagen = archivo.type.startsWith('image/')
  if (!esPdf && !esImagen) return 'El comprobante tiene que ser un PDF o una imagen.'
  if (archivo.size > MAX_MB * 1024 * 1024) return `El archivo supera los ${MAX_MB} MB.`
  if (archivo.size === 0) return 'El archivo está vacío.'
  return null
}

/**
 * Datos que el escenario puede devolver. Son EXACTAMENTE los campos del formulario de cobro que se
 * pueden leer de un documento: cada uno viaja ya normalizado al formato con el que vive en el
 * borrador (fechas dd/MM/yyyy, importes numéricos, CUIT con guiones).
 *
 * Todos son opcionales: un comprobante de transferencia no trae número de cupón, y un cupón no trae
 * año de retención. Lo que no vino, no se toca en el formulario.
 */
export interface DatosComprobante {
  importe?: number
  // Cheque
  numeroCheque?: string
  fechaEmisionCheque?: string
  chequeVencimiento?: string
  bancoEmisor?: string
  cuitEmisor?: string
  formatoCheque?: FormatoCheque
  // Retenciones
  anioRetencion?: string
  nroComprobanteRetencion?: string
  /** Transferencia: número de la operación que figura en el comprobante bancario. */
  nroComprobanteTransferencia?: string
  // Tarjeta
  bancoTarjeta?: string
  tipoTarjeta?: string
  vencimientoTarjeta?: string
  numeroCupon?: string
  /**
   * Nombre de la cuenta propia (destino de la transferencia o banco de acreditación). Es un NOMBRE
   * y no un id: el escenario lee un papel, no el tablero de configuración. Quien lo consume lo
   * resuelve contra el catálogo de cuentas ya cargado.
   */
  cuentaPropia?: string
}

/** Resultado de leer un comprobante. */
export interface LecturaComprobante {
  jobId: string
  datos: DatosComprobante
  /**
   * Cuántos campos se pudieron completar. En cero la lectura NO sirvió, y eso hay que decirlo con
   * una advertencia: un "procesado correctamente" con el formulario vacío se lee como una falla
   * silenciosa, y el usuario se entera recién al intentar agregar el movimiento.
   */
  campos: number
  /**
   * El escenario devolvió un JSON, en vez de acusar recibo y cortar. En `false` no hubo respuesta
   * de verdad: el escenario no termina con un módulo "Webhook response", así que Make contesta
   * "Accepted" apenas recibe el archivo y la app nunca llega a ver lo que leyó la IA.
   *
   * Se distingue del JSON vacío porque lo que hay que corregir es OTRO: allá falta el módulo de
   * respuesta; acá el módulo está y lo que falló fue la lectura del documento.
   */
  respondioJson: boolean
}

/**
 * Manda el comprobante al escenario y devuelve lo que pudo leer.
 *
 * `signal` cancela la llamada en curso: si el usuario carga otro documento antes de que vuelva la
 * primera, la respuesta vieja no puede pisar los campos de la nueva. `onReintento` avisa cuando la
 * llamada se vuelve a intentar, para que la pantalla lo diga en vez de parecer colgada.
 */
export async function procesarComprobante(
  archivo: File,
  formaPago: FormaPago,
  opciones: OpcionesWebhook = {},
): Promise<LecturaComprobante> {
  /* Sin webhook configurado no hay a quién preguntarle. Se corta acá y con el nombre de la variable
     que falta: dejarlo seguir daría un fallo de red contra una URL vacía, que no dice qué arreglar. */
  if (!WEBHOOK_COMPROBANTES) {
    throw new Error('Falta configurar VITE_MAKE_WEBHOOK_COMPROBANTES para poder leer comprobantes.')
  }

  const jobId = nuevoJobId()

  const form = new FormData()
  form.append('jobId', jobId)
  form.append('formaPago', formaPago)
  form.append('nombreArchivo', archivo.name)
  form.append('tipoArchivo', archivo.type || 'application/octet-stream')
  form.append('origen', 'registrar-cobros-recibos')
  form.append('archivo', archivo, archivo.name)

  /* Se ESPERA la respuesta del escenario completo, no el acuse de recibo: el módulo de IA tiene que
     leer el documento y devolver los campos, y recién ahí la promesa se resuelve. Del lado de Make
     eso exige que el escenario termine con un módulo "Webhook response": sin él, Make contesta
     "Accepted" apenas recibe el archivo y corta la llamada antes de que la IA haya leído nada. */
  const { texto, json } = await postWebhook(WEBHOOK_COMPROBANTES, form, opciones)

  // Sin JSON no hubo respuesta de verdad. No se inventa un éxito: se devuelve vacío y la UI advierte.
  if (json === null) {
    if (/error|failed/i.test(texto)) throw new Error(texto.slice(0, 200))
    return { jobId, datos: {}, campos: 0, respondioJson: false }
  }

  const raiz = objeto(json)
  /* Error declarado por el propio escenario, con un 200 igual: manda SU mensaje, que sabe más que
     cualquier texto que pueda inventar la app. Se extrae con el mismo criterio que el de un HTTP de
     error —nunca se muestra el JSON crudo—. */
  if (raiz.ok === false || raiz.error) {
    throw new Error(mensajeDelEscenario(raiz) || 'El escenario no pudo leer el documento.')
  }

  /* La IA rechazó el documento: leyó bien, y lo que leyó no es el comprobante que se esperaba. Es
     un error del archivo subido —no de la lectura—, así que se dice como tal y con el tipo que sí
     reconoció, que es lo único accionable: cambiar el archivo o cambiar el medio de cobro. */
  const indice = indexar(raiz)
  const valido = buscar(indice, ALIAS_VALIDO)
  // El `false` puede venir como booleano o como texto, según cómo arme el JSON el módulo de IA.
  if (valido === false || crudo(valido).toLowerCase() === 'false') {
    const detectado = aTexto(buscar(indice, ALIAS_TIPO))
    throw new Error(
      `El documento no corresponde a ${formaPago}${detectado ? `: se reconoció "${detectado}"` : ''}.`,
    )
  }

  const datos = normalizar(indice)
  return {
    jobId: crudo(raiz.jobId) || jobId,
    datos,
    campos: Object.keys(datos).length,
    respondioJson: true,
  }
}

/* ===== Normalización de la respuesta ===== */

/**
 * Nombres que se aceptan para cada campo. La clave del mapa es el campo del formulario; la lista,
 * cómo lo puede haber llamado el escenario.
 *
 * La comparación IGNORA mayúsculas, tildes y separadores (ver `clave`), así que un alias cubre a la
 * vez "numeroCheque", "numero_cheque", "Número de Cheque" y "NUMERO CHEQUE". Los alias existen para
 * absorber esa variedad, no para adivinar: el escenario se arma del otro lado y renombrar un campo
 * allá no puede obligar a tocar la app.
 */
const ALIAS: Record<keyof DatosComprobante, string[]> = {
  importe: ['importe', 'importeRetencion', 'montoRetenido', 'monto', 'total', 'amount'],
  numeroCheque: ['numeroCheque', 'nroCheque', 'chequeNumero', 'checkNumber'],
  fechaEmisionCheque: ['fechaEmisionCheque', 'fechaEmision', 'emision', 'issueDate'],
  chequeVencimiento: [
    'chequeVencimiento',
    'fechaVencimientoCheque',
    'fechaVencimiento',
    'vencimiento',
    'dueDate',
  ],
  bancoEmisor: ['bancoEmisor', 'banco', 'bankName'],
  cuitEmisor: ['cuitEmisor', 'cuit', 'cuitLibrador', 'taxId'],
  formatoCheque: ['formatoCheque', 'tipoCheque', 'formato'],
  anioRetencion: [
    'anioRetencion',
    'anoRetencion',
    'anioEmision',
    'anioComprobante',
    'anio',
    'ejercicio',
    'periodo',
    'year',
  ],
  nroComprobanteRetencion: [
    'nroComprobanteRetencion',
    'numeroComprobanteRetencion',
    'numeroComprobante',
    'nroComprobante',
    'numeroCertificado',
    'nroCertificado',
    'certificado',
  ],
  /* Comparte los alias con el número del certificado —los dos son "el número del comprobante"— y
     eso no los mezcla: cuál de los dos se carga lo decide el medio de cobro (ver `camposDelMedio`
     en el formulario), y un mismo documento nunca es las dos cosas a la vez. */
  nroComprobanteTransferencia: [
    'nroComprobanteTransferencia',
    'numeroTransferencia',
    'nroTransferencia',
    'numeroComprobante',
    'nroComprobante',
    'nroOperacion',
    'numeroOperacion',
    'idTransferencia',
    'comprobante',
    'operacion',
  ],
  bancoTarjeta: ['bancoTarjeta', 'bancoEmisorTarjeta', 'bancoDeLaTarjeta'],
  tipoTarjeta: ['tipoTarjeta', 'marcaTarjeta', 'tarjeta', 'cardBrand'],
  vencimientoTarjeta: [
    'vencimientoTarjeta',
    'fechaVencimientoTarjeta',
    'vencimientoPlastico',
    'expiry',
  ],
  numeroCupon: ['numeroCupon', 'nroCupon', 'cupon', 'couponNumber'],
  cuentaPropia: ['cuentaPropia', 'cuentaDestino', 'cuentaBancaria', 'bancoAcreditacion', 'cuenta'],
}

/**
 * Cómo puede llamarse el veredicto del escenario sobre el documento. En `false` la IA dice que lo
 * que subieron NO es el comprobante que se esperaba, y eso no es una lectura vacía: es un rechazo
 * con motivo, y se muestra como error en vez de como "no se obtuvieron los datos".
 */
const ALIAS_VALIDO = ['tipoValido', 'esValido', 'valido', 'valid']

/** Qué tipo de documento reconoció la IA. Sólo se usa para explicar un rechazo. */
const ALIAS_TIPO = ['tipoDetectado', 'tipoDocumento', 'tipo']

/**
 * Convierte la respuesta del escenario —ya aplanada por `indexar`— en datos del formulario. Sólo
 * entran los campos que llegaron con algo adentro: un `""` o un `null` no es un dato, es la
 * ausencia de uno, y volcarlo BORRARÍA lo que el usuario ya hubiera cargado a mano.
 */
function normalizar(fuente: Record<string, unknown>): DatosComprobante {
  const leer = (campo: keyof DatosComprobante): unknown => buscar(fuente, ALIAS[campo])

  const datos: DatosComprobante = {}
  const poner = <K extends keyof DatosComprobante>(campo: K, valor: DatosComprobante[K]) => {
    if (valor !== undefined) datos[campo] = valor
  }

  poner('importe', aNumero(leer('importe')))
  poner('numeroCheque', aTexto(leer('numeroCheque')))
  poner('fechaEmisionCheque', aFecha(leer('fechaEmisionCheque')))
  poner('chequeVencimiento', aFecha(leer('chequeVencimiento')))
  poner('bancoEmisor', aTexto(leer('bancoEmisor')))
  poner('cuitEmisor', aCuit(leer('cuitEmisor')))
  poner('formatoCheque', aFormatoCheque(leer('formatoCheque')))
  poner('anioRetencion', aAnio(leer('anioRetencion')))
  poner('nroComprobanteRetencion', aDigitos(leer('nroComprobanteRetencion')))
  /* El de la transferencia va TAL CUAL: su columna en el tablero es de texto, y el número de
     operación de un banco puede llevar letras o guiones que son parte del dato. */
  poner('nroComprobanteTransferencia', aTexto(leer('nroComprobanteTransferencia')))
  poner('bancoTarjeta', aTexto(leer('bancoTarjeta')))
  poner('tipoTarjeta', aTexto(leer('tipoTarjeta')))
  poner('vencimientoTarjeta', aVencimientoTarjeta(leer('vencimientoTarjeta')))
  poner('numeroCupon', aTexto(leer('numeroCupon')))
  poner('cuentaPropia', aTexto(leer('cuentaPropia')))
  return datos
}

/**
 * Busca en la respuesta el primer valor útil para una lista de alias, en dos pasadas:
 *
 *   1. EXACTA: la clave es el alias. Es la que manda, y por eso corre primero para TODOS los alias
 *      antes de aflojar el criterio.
 *   2. PARCIAL: la clave CONTIENE al alias. Es lo que hace que "importe_retencion" caiga en el
 *      importe y "anio_emision" en el año, sin tener que enumerar de antemano cada calificativo que
 *      se le ocurra agregar a la IA cuando redacta el JSON.
 *
 * Los alias se recorren en orden y el primero que encuentra algo gana: por eso el más específico va
 * primero en cada lista.
 *
 * Sólo se aceptan valores PRIMITIVOS. Un objeto anidado —como el `origen` con el que la IA explica
 * de dónde sacó cada dato— nunca es el valor de un campo, y dejarlo entrar cargaría un
 * "[object Object]" en el formulario.
 */
function buscar(fuente: Record<string, unknown>, alias: string[]): unknown {
  const sirve = (v: unknown) =>
    v !== undefined && v !== null && v !== '' && typeof v !== 'object' && typeof v !== 'function'

  for (const a of alias) {
    const v = fuente[clave(a)]
    if (sirve(v)) return v
  }
  for (const a of alias) {
    const parcial = clave(a)
    for (const [k, v] of Object.entries(fuente)) {
      if (k.includes(parcial) && sirve(v)) return v
    }
  }
  return undefined
}

/**
 * Índice plano de la respuesta, con las claves normalizadas. Aplana UN nivel de anidado en las
 * envolturas habituales (`datos`, `data`, `resultado`, `fields`, `output`), porque un escenario
 * puede devolver los campos sueltos o envueltos y las dos formas dicen lo mismo.
 *
 * La raíz se indexa DESPUÉS que las envolturas: si un campo aparece en las dos, gana el de adentro,
 * que es el que el escenario armó a propósito.
 */
const ENVOLTURAS = ['datos', 'data', 'resultado', 'result', 'fields', 'output']

function indexar(raiz: Record<string, unknown>): Record<string, unknown> {
  const plano: Record<string, unknown> = {}
  const volcar = (fuente: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(fuente)) plano[clave(k)] = v
  }
  volcar(raiz)
  for (const envoltura of ENVOLTURAS) {
    const anidado = raiz[envoltura]
    if (anidado && typeof anidado === 'object' && !Array.isArray(anidado)) {
      volcar(anidado as Record<string, unknown>)
    }
  }
  return plano
}

/**
 * Palabras que no distinguen un campo de otro. Se descartan para que "Número DE Cheque" y
 * "numeroCheque" se reconozcan como el mismo dato: el escenario nombra los campos como le queda
 * cómodo y esa diferencia no puede costar un campo sin completar.
 */
const CONECTORES = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y'])

/**
 * Clave comparable: sin tildes, sin mayúsculas, sin separadores y sin conectores. El camelCase se
 * corta antes de bajar a minúsculas ("numeroDeCheque" → "numero de cheque"), que es lo que permite
 * sacarle el conector a una clave escrita de corrido.
 */
const clave = (k: string): string =>
  k
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((parte) => parte && !CONECTORES.has(parte))
    .join('')

const objeto = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

/** Valor como texto crudo, sin recortar ni validar. Sirve para mensajes y para los parsers. */
const crudo = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))

/** Texto de un campo, ya recortado. Vacío se descarta: no es un dato leído. */
const aTexto = (v: unknown): string | undefined => {
  const s = crudo(v).trim()
  return s || undefined
}

const aDigitos = (v: unknown): string | undefined => {
  const s = crudo(v).replace(/\D/g, '')
  return s || undefined
}

/**
 * Importe leído del documento. Acepta el número tal cual o el texto del papel, con símbolos y con
 * cualquiera de las dos convenciones de miles: "$ 1.234,56" y "1,234.56" son el mismo importe.
 *
 * Cuál es el separador DECIMAL lo decide el último que aparezca y cuántos dígitos lo siguen: uno o
 * dos son centavos, tres son miles ("1.234" son mil doscientos treinta y cuatro pesos).
 */
function aNumero(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? round2(v) : undefined
  const limpio = crudo(v).replace(/[^\d.,-]/g, '')
  if (!/\d/.test(limpio)) return undefined

  const iDec = Math.max(limpio.lastIndexOf(','), limpio.lastIndexOf('.'))
  const decimales = limpio.length - iDec - 1
  const hayDecimales = iDec >= 0 && decimales >= 1 && decimales <= 2
  const entero = (hayDecimales ? limpio.slice(0, iDec) : limpio).replace(/[.,]/g, '')
  const dec = hayDecimales ? limpio.slice(iDec + 1) : ''

  const n = Number(`${entero || '0'}.${dec || '0'}`)
  return Number.isFinite(n) ? round2(n) : undefined
}

/**
 * Fecha en el formato del formulario (dd/MM/yyyy). Acepta ISO —lo que devuelve cualquier módulo de
 * Make que tipe la fecha— y el formato del papel, con barras, guiones o puntos. El año de dos
 * dígitos se completa al 2000: un comprobante de cobranza no es de 1998.
 */
function aFecha(v: unknown): string | undefined {
  const s = crudo(v).trim()
  if (!s) return undefined

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s)
  if (iso) return armarFecha(Number(iso[3]), Number(iso[2]), Number(iso[1]))

  const dmy = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(s)
  if (dmy) return armarFecha(Number(dmy[1]), Number(dmy[2]), Number(dmy[3]))

  return undefined
}

/**
 * Vencimiento del PLÁSTICO. Además de una fecha completa acepta el "MM/AA" impreso en la tarjeta,
 * que es lo que suele traer un cupón. Se toma el ÚLTIMO día del mes: una tarjeta 08/29 sirve todo
 * agosto, así que fecharla el día 1 la daría por vencida un mes antes de tiempo.
 */
function aVencimientoTarjeta(v: unknown): string | undefined {
  const completa = aFecha(v)
  if (completa) return completa

  const mmaa = /^(\d{1,2})[/\-.](\d{2,4})$/.exec(crudo(v).trim())
  if (!mmaa) return undefined
  const mes = Number(mmaa[1])
  const anio = Number(mmaa[2])
  if (mes < 1 || mes > 12) return undefined
  const anioPleno = anio < 100 ? 2000 + anio : anio
  // Día 0 del mes SIGUIENTE: el último del mes pedido, sin tabla de cuántos días tiene cada uno.
  return armarFecha(new Date(anioPleno, mes, 0).getDate(), mes, anioPleno)
}

/** dd/MM/yyyy con ceros a la izquierda, o `undefined` si los números no forman una fecha real. */
function armarFecha(dia: number, mes: number, anio: number): string | undefined {
  const anioPleno = anio < 100 ? 2000 + anio : anio
  const fecha = new Date(anioPleno, mes - 1, dia)
  // El Date "corrige" un 31/02 al 3/03: si no quedó el mismo día, la fecha no existía.
  if (fecha.getDate() !== dia || fecha.getMonth() !== mes - 1) return undefined
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(dia)}/${pad(mes)}/${anioPleno}`
}

/** Año fiscal de la retención: los cuatro dígitos. Cualquier otra cosa no se cae en el campo. */
function aAnio(v: unknown): string | undefined {
  const s = crudo(v).replace(/\D/g, '')
  if (s.length === 4) return s
  // "26" o una fecha entera de la que se rescata el año.
  if (s.length === 2) return `20${s}`
  const conAnio = /(\d{4})/.exec(crudo(v))
  return conAnio ? conAnio[1] : undefined
}

/** CUIT en los tres tramos que espera el formulario (XX-XXXXXXXX-X). Sin once dígitos, no hay CUIT. */
function aCuit(v: unknown): string | undefined {
  const d = crudo(v).replace(/\D/g, '')
  return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : undefined
}

/** Formato del cheque: sólo el electrónico se nombra; cualquier otra cosa es un cheque de papel. */
function aFormatoCheque(v: unknown): FormatoCheque | undefined {
  const s = crudo(v).trim()
  if (!s) return undefined
  if (/e-?cheq|electr/i.test(s)) return 'eCheq'
  if (/fisic|papel|f[ií]sico/i.test(s)) return 'FISICO'
  return undefined
}
