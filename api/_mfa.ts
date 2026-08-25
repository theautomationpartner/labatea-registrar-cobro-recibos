/**
 * Capa 3 — segundo factor (TOTP) y dispositivos confiables.
 *
 * Las tres capas responden preguntas distintas: la 1, de dónde viene el pedido; la 2, quién lo
 * firma; esta, si esa persona demostró hace poco tener su teléfono. Es la única que sobrevive a que
 * a alguien le roben la sesión de Monday.
 *
 * ── Decisiones que vale la pena conocer ──
 *
 * · El secreto TOTP se guarda CIFRADO (AES-256-GCM) con una clave que vive en el entorno del
 *   deploy. Una base filtrada, sin esa clave, no alcanza para generar códigos.
 * · Los códigos de recuperación y los tokens de dispositivo se guardan HASHEADOS. Son secretos de
 *   alta entropía generados por nosotros, no contraseñas elegidas por una persona: por eso alcanza
 *   con un HMAC-SHA256 y no hace falta un KDF lento —bcrypt existe para frenar la fuerza bruta
 *   sobre contraseñas adivinables, y acá no hay nada que adivinar—.
 * · La reutilización de un código la corta afterTimeStep, que rechaza cualquier código de un paso
 *   ya usado. Sin eso, un código sigue sirviendo los 30 s que le quedan de vida: suficiente para
 *   que alguien que lo vio por encima del hombro lo repita.
 * · Nada de cookies. La app corre en un iframe de monday.com y Safari (y Chrome, cada vez más)
 *   bloquean las cookies de terceros: una sesión basada en cookies simplemente no llega. El
 *   dispositivo confiable viaja en una cabecera propia que manda el frontend.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'
import { generateSecret, generateURI, verifySync } from 'otplib'
import QRCode from 'qrcode'
import { ErrorAuth } from './_errores.js'
import { mfaStore, type Usuario } from './_mfaStore.js'

/**
 * Tolerancia de ±30 s, o sea un período TOTP para cada lado.
 *
 * En otplib 13 la tolerancia se expresa en SEGUNDOS (epochTolerance); el window de la v12 ya no
 * existe, y son la misma cosa: un período de 30 s antes y uno después del actual.
 */
const TOLERANCIA_S = 30

/** Límite de velocidad: cinco fallos en quince minutos y la puerta se cierra. */
const MAX_FALLOS = 5
const VENTANA_LIMITE_MS = 15 * 60_000

/**
 * Cuánto dura el dispositivo. Una sola duración: la jornada.
 *
 * Hubo una casilla de "confiar en este dispositivo por 30 días" y se sacó a propósito. La decisión
 * es que el segundo factor se pida TODOS los días: doce horas cubren un turno de trabajo completo
 * —quien entra a la mañana no vuelve a escribir el código hasta el día siguiente— y no más que eso.
 *
 * El token del dispositivo sigue existiendo porque es la ÚNICA prueba de que se pasó el segundo
 * factor; lo que cambió es cuánto vale.
 */
const HORAS_SESION = 12

const CANT_CODIGOS_RECUPERACION = 10

/**
 * Lo que devuelve una verificación TOTP.
 *
 * Se declara acá porque el tipo que exporta otplib es la unión de TOTP y HOTP, y sólo la rama de
 * TOTP trae `timeStep` —justo el dato del que depende la protección anti-reutilización—. Esto
 * deja escrito, en un solo lugar, qué parte de la librería se está usando de verdad.
 */
type ResultadoTotp =
  | { valid: true; timeStep: number; delta: number; epoch: number }
  | { valid: false; timeStep?: undefined }

/** Sin I, L, O, U, 0 ni 1: se dictan por teléfono y se copian a mano sin confundir caracteres. */
const ALFABETO = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'

// ── Criptografía ────────────────────────────────────────────────────────────────────────────────

/**
 * Clave de 32 bytes desde MFA_ENCRYPTION_KEY (base64 o hex).
 *
 * Se lee en cada uso y no al importar el módulo: así una variable mal cargada da un error claro en
 * la request y no una función que ni siquiera arranca.
 */
function clave(): Buffer {
  const bruta = process.env.MFA_ENCRYPTION_KEY?.trim()
  if (!bruta) throw new Error('MFA_ENCRYPTION_KEY no está configurada en el servidor')

  const buf = Buffer.from(bruta, bruta.length === 64 ? 'hex' : 'base64')
  if (buf.length !== 32) {
    throw new Error('MFA_ENCRYPTION_KEY tiene que ser de 32 bytes (base64 o hex)')
  }
  return buf
}

/**
 * Cifra con AES-256-GCM. El resultado es iv.tag.datos en base64.
 *
 * GCM y no CBC porque además de ocultar, AUTENTICA: si alguien edita el secreto en la base, el
 * descifrado falla en vez de devolver basura que después genera códigos que nunca validan.
 */
function cifrar(texto: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', clave(), iv)
  const datos = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), datos].map((p) => p.toString('base64')).join('.')
}

function descifrar(guardado: string): string {
  const [iv, tag, datos] = guardado.split('.').map((p) => Buffer.from(p, 'base64'))
  if (!iv || !tag || !datos) throw new Error('el secreto guardado no tiene el formato esperado')

  const decipher = createDecipheriv('aes-256-gcm', clave(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(datos), decipher.final()]).toString('utf8')
}

/** Huella de un secreto de alta entropía. La clave hace de pimienta: sin ella no se recalcula. */
function huella(valor: string): string {
  return createHmac('sha256', clave()).update(valor).digest('hex')
}

/** Comparación en tiempo constante, para no filtrar por cuánto tarda en decir que no. */
function igualSeguro(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** Un código de recuperación con forma A3F2-9K7Q: 8 caracteres del alfabeto, casi 40 bits. */
function nuevoCodigoRecuperacion(): string {
  const bytes = randomBytes(8)
  const chars = [...bytes].map((b) => ALFABETO[b % ALFABETO.length])
  return chars.slice(0, 4).join('') + '-' + chars.slice(4).join('')
}

/** Normaliza lo que tipeó la persona: mayúsculas y sin guiones ni espacios. */
function normalizarCodigo(codigo: string): string {
  return codigo.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** 32 bytes al azar. Es el dispositivo confiable; sólo el frontend ve este valor. */
function nuevoTokenDispositivo(): string {
  return randomBytes(32).toString('base64url')
}

// ── Enrolamiento ────────────────────────────────────────────────────────────────────────────────

export interface Enrolamiento {
  /** El otpauth:// que la app de autenticación entiende. */
  uri: string
  /** El mismo URI como PNG en un data URI, listo para un <img src>. */
  qr: string
  /** Para tipear a mano cuando la cámara no coopera. */
  secreto: string
}

/**
 * Arranca el enrolamiento: secreto nuevo, guardado cifrado y en estado pendiente.
 *
 * Queda PENDIENTE a propósito. Si se marcara confirmado acá, alguien que abandona a mitad de camino
 * —cerró la pestaña sin escanear— se quedaría con un segundo factor que no puede usar, y sin forma
 * de entrar. Confirmado significa que probó que su app genera códigos que validan.
 */
export async function iniciarEnrolamiento(u: Usuario, etiqueta: string): Promise<Enrolamiento> {
  const secreto = generateSecret()
  await mfaStore().guardarPendiente(u, cifrar(secreto))

  const uri = generateURI({
    issuer: process.env.MFA_EMISOR?.trim() || 'La Batea',
    label: etiqueta,
    secret: secreto,
  })

  return { uri, qr: await QRCode.toDataURL(uri), secreto }
}

/**
 * Confirma el enrolamiento con el primer código y devuelve los códigos de recuperación.
 *
 * Los códigos se devuelven en claro UNA sola vez: de la base sólo se puede sacar su hash, así que
 * si el usuario no los guarda ahora, no hay forma de mostrárselos después. Se regeneran, no se
 * recuperan.
 */
export async function confirmarEnrolamiento(
  u: Usuario,
  codigo: string,
): Promise<{ codigosRecuperacion: string[]; deviceToken: string; expiraEn: string }> {
  const registro = await mfaStore().leerRegistro(u)
  if (!registro) throw new ErrorAuth(403, 'confirmar sin enrolamiento previo')

  const resultado = verificarTotp(descifrar(registro.secreto), normalizarCodigo(codigo), registro.ultimoPaso)
  if (!resultado.valid || resultado.timeStep === undefined) {
    await mfaStore().anotarIntento(u, false)
    throw new ErrorAuth(401, 'el código de confirmación no validó')
  }

  await mfaStore().confirmar(u, resultado.timeStep)
  await mfaStore().anotarIntento(u, true)

  const codigos = Array.from({ length: CANT_CODIGOS_RECUPERACION }, nuevoCodigoRecuperacion)
  await mfaStore().guardarCodigos(u, codigos.map((c) => huella(normalizarCodigo(c))))

  /* Un enrolamiento nuevo invalida los dispositivos viejos: si alguien re-enrola porque perdió el
     teléfono, lo último que se quiere es que el equipo del ladrón siga entrando sin preguntar. */
  await mfaStore().olvidarDispositivos(u)

  /* Y se emite el dispositivo de la jornada: acaba de probar que tiene la app, pedirle un segundo
     código a los diez segundos sería puro trámite. */
  const dispositivo = await emitirDispositivo(u)

  return {
    codigosRecuperacion: codigos,
    deviceToken: dispositivo.token,
    expiraEn: dispositivo.expiraEn,
  }
}

// ── Verificación ────────────────────────────────────────────────────────────────────────────────

export interface ResultadoVerificacion {
  /** Presente sólo si el usuario pidió confiar en el dispositivo. Se muestra una vez y se guarda. */
  deviceToken?: string
  expiraEn?: string
  codigosRestantes?: number
  /** true si entró con un código de recuperación y no con la app. */
  conRecuperacion: boolean
}

/**
 * Verifica un código —de la app o de recuperación— y, si corresponde, emite el dispositivo confiable.
 *
 * El orden importa: primero el límite de velocidad, que corta ANTES de mirar el código. Un límite
 * que sólo se aplica después de verificar no frena una fuerza bruta, apenas la registra.
 */
export async function verificar(u: Usuario, codigo: string): Promise<ResultadoVerificacion> {
  const almacen = mfaStore()

  const fallos = await almacen.contarFallos(u, new Date(Date.now() - VENTANA_LIMITE_MS))
  if (fallos >= MAX_FALLOS) {
    /* Se corta incluso si el código es correcto. Es a propósito: si el atacante pudiera distinguir
       bloqueado de código malo probando uno bueno, el límite le contaría cuándo acertó. */
    throw new ErrorAuth(429, 'límite de intentos alcanzado: ' + fallos + ' fallos en 15 min')
  }

  const registro = await almacen.leerRegistro(u)
  if (!registro?.confirmado) throw new ErrorAuth(403, 'segundo factor no enrolado')

  const limpio = normalizarCodigo(codigo)
  const esTotp = /^[0-9]{6}$/.test(limpio)

  let conRecuperacion = false

  if (esTotp) {
    const resultado = verificarTotp(descifrar(registro.secreto), limpio, registro.ultimoPaso)
    if (!resultado.valid || resultado.timeStep === undefined) {
      await almacen.anotarIntento(u, false)
      throw new ErrorAuth(401, 'código TOTP inválido, vencido o ya usado')
    }
    // Anotar el paso ANTES de responder: es lo que hace que este mismo código no entre de nuevo.
    await almacen.registrarPaso(u, resultado.timeStep)
  } else {
    const usado = await almacen.consumirCodigo(u, huella(limpio))
    if (!usado) {
      await almacen.anotarIntento(u, false)
      throw new ErrorAuth(401, 'código de recuperación inválido o ya usado')
    }
    conRecuperacion = true
  }

  await almacen.anotarIntento(u, true)

  const salida: ResultadoVerificacion = { conRecuperacion }
  if (conRecuperacion) salida.codigosRestantes = await almacen.cuantosCodigosQuedan(u)

  const dispositivo = await emitirDispositivo(u)
  salida.deviceToken = dispositivo.token
  salida.expiraEn = dispositivo.expiraEn

  return salida
}

/** Emite el dispositivo de la jornada y guarda su huella. */
async function emitirDispositivo(u: Usuario): Promise<{ token: string; expiraEn: string }> {
  const token = nuevoTokenDispositivo()
  const ms = HORAS_SESION * 60 * 60_000
  const expira = new Date(Date.now() + ms)
  await mfaStore().guardarDispositivo(u, huella(token), expira)
  return { token, expiraEn: expira.toISOString() }
}

/** Un solo lugar donde se fijan la tolerancia y la protección anti-reutilización. */
function verificarTotp(secreto: string, codigo: string, ultimoPaso: number | null): ResultadoTotp {
  return verifySync({
    secret: secreto,
    token: codigo,
    epochTolerance: TOLERANCIA_S,
    ...(ultimoPaso === null ? {} : { afterTimeStep: ultimoPaso }),
  }) as ResultadoTotp
}

// ── Dispositivos confiables ─────────────────────────────────────────────────────────────────────

export interface EstadoMfa {
  enrolado: boolean
  confirmado: boolean
  dispositivoConfiable: boolean
  codigosRestantes: number
  /** false mientras MFA_REQUERIDO esté apagado: la UI no pide lo que el backend no exige. */
  exigido: boolean
}

export async function estadoMfa(u: Usuario, deviceToken: string | undefined): Promise<EstadoMfa> {
  const registro = await mfaStore().leerRegistro(u)
  return {
    enrolado: registro !== null,
    confirmado: registro?.confirmado ?? false,
    dispositivoConfiable: await dispositivoConfiable(u, deviceToken),
    codigosRestantes: registro?.confirmado ? await mfaStore().cuantosCodigosQuedan(u) : 0,
    exigido: mfaRequerido(),
  }
}

async function dispositivoConfiable(u: Usuario, deviceToken: string | undefined): Promise<boolean> {
  if (!deviceToken) return false
  return mfaStore().dispositivoVigente(u, huella(deviceToken))
}

/**
 * Corta el paso si el usuario no tiene un dispositivo confiable vigente.
 *
 * Se llama desde el guardián, así que protege TODOS los endpoints de datos de una sola vez: no hay
 * forma de saltear el segundo factor pegándole directo a /api/monday.
 */
export async function exigirMfa(u: Usuario, deviceToken: string | undefined): Promise<void> {
  if (!mfaRequerido()) return

  const registro = await mfaStore().leerRegistro(u)
  if (!registro?.confirmado) throw new ErrorAuth(403, 'sin segundo factor enrolado: ' + u.userId, 'mfa')

  if (!(await dispositivoConfiable(u, deviceToken))) {
    throw new ErrorAuth(403, 'dispositivo no confiable: ' + u.userId, 'mfa')
  }
}

/**
 * El interruptor. Apagado, la Capa 3 queda escrita pero inerte.
 *
 * Existe porque encenderla sin las pantallas de enrolamiento deja a todo el mundo afuera sin manera
 * de entrar: nadie puede enrolarse desde una app a la que no puede entrar.
 */
export function mfaRequerido(): boolean {
  const valor = process.env.MFA_REQUERIDO?.trim().toLowerCase()
  return valor === '1' || valor === 'true'
}

/** Expuesto para los tests: comparación en tiempo constante y normalización de códigos. */
export const _interno = { igualSeguro, huella, normalizarCodigo }
