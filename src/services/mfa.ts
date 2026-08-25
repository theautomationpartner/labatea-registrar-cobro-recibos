/**
 * Cliente del segundo factor (Capa 3).
 *
 * Es la contraparte de `api/mfa/*`. La pantalla no habla con `fetch`: llama a estas cuatro
 * funciones, y el guardado del dispositivo confiable pasa acá adentro —en `verificarCodigo`— para
 * que ninguna vista tenga que acordarse de hacerlo.
 *
 * En desarrollo estos endpoints no existen (no corren las funciones serverless), así que
 * `estadoSegundoFactor` devuelve un estado "no exigido" y la app sigue de largo. Es la misma
 * decisión que en las otras dos capas: localhost no simula el borde.
 */
import { guardarDeviceToken, olvidarDeviceToken } from '@/lib/deviceToken'
import { cabecerasPropias } from '@/services/monday/sdk'

export interface EstadoSegundoFactor {
  enrolado: boolean
  confirmado: boolean
  dispositivoConfiable: boolean
  codigosRestantes: number
  /** `false` mientras el backend no lo exija: la UI no molesta con algo que nadie va a pedir. */
  exigido: boolean
}

export interface Enrolamiento {
  /** PNG en data URI, para un `<img src={qr}>`. */
  qr: string
  /** El mismo secreto en texto, para tipear a mano si la cámara no anda. */
  secreto: string
  uri: string
}

export interface ResultadoVerificacion {
  conRecuperacion: boolean
  codigosRestantes?: number
  expiraEn?: string
}

/** El código que tipeó la persona no validó. La UI lo dice y deja reintentar. */
export class CodigoInvalido extends Error {
  constructor() {
    super('El código no es válido o ya venció. Probá con el siguiente.')
    this.name = 'CodigoInvalido'
  }
}

/** Demasiados intentos fallidos: hay que esperar. Reintentar ahora no cambia nada. */
export class DemasiadosIntentos extends Error {
  constructor() {
    super('Demasiados intentos fallidos. Esperá 15 minutos y volvé a probar.')
    this.name = 'DemasiadosIntentos'
  }
}

const enDesarrollo = import.meta.env.DEV

async function pedir<T>(ruta: string, cuerpo: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`/api/mfa/${ruta}`, {
    method: 'POST',
    headers: await cabecerasPropias({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(cuerpo),
  })

  if (res.status === 429) throw new DemasiadosIntentos()
  if (res.status === 401) throw new CodigoInvalido()
  if (!res.ok) throw new Error(`Segundo factor: HTTP ${res.status}`)
  return (await res.json()) as T
}

/** Qué pantalla corresponde. En desarrollo nunca exige nada. */
export async function estadoSegundoFactor(): Promise<EstadoSegundoFactor> {
  if (enDesarrollo) {
    return {
      enrolado: false,
      confirmado: false,
      dispositivoConfiable: false,
      codigosRestantes: 0,
      exigido: false,
    }
  }
  return pedir<EstadoSegundoFactor>('status')
}

/** Paso 1: el QR para escanear. El secreto queda pendiente hasta que se confirme. */
export async function iniciarEnrolamiento(): Promise<Enrolamiento> {
  return pedir<Enrolamiento>('setup')
}

/**
 * Paso 2: el primer código. Devuelve los códigos de recuperación.
 *
 * Se ven UNA sola vez: el servidor guarda el hash y no puede volver a mostrarlos. La pantalla tiene
 * que dejarlos copiar antes de seguir.
 */
export async function confirmarEnrolamiento(codigo: string): Promise<string[]> {
  const res = await pedir<{
    codigosRecuperacion: string[]
    deviceToken?: string
  }>('confirm', { codigo })

  /* Confirmar YA deja entrar: el servidor emite el dispositivo de la jornada. Sin esto, quien
     termina de enrolarse volvería a chocar contra el muro un segundo después. */
  if (res.deviceToken) guardarDeviceToken(res.deviceToken)
  return res.codigosRecuperacion
}

/**
 * Verificación diaria. Si el usuario marcó "confiar en este dispositivo", el token que devuelve el
 * servidor se guarda acá mismo y a partir de ahí viaja solo en cada pedido.
 */
export async function verificarCodigo(codigo: string): Promise<ResultadoVerificacion> {
  const res = await pedir<ResultadoVerificacion & { deviceToken?: string }>('verify', { codigo })

  if (res.deviceToken) guardarDeviceToken(res.deviceToken)
  return res
}

/** Deja de confiar en ESTE navegador. El servidor sigue teniendo el suyo hasta que venza. */
export function olvidarEsteDispositivo(): void {
  olvidarDeviceToken()
}
