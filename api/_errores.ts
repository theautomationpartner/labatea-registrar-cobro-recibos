/**
 * El vocabulario de rechazo, en un módulo sin dependencias.
 *
 * Vive aparte por una razón práctica: `_guard`, `_whitelist` y `_mfa` lo necesitan, y `_guard`
 * necesita a los otros dos. Si el tipo viviera en `_guard`, los imports se harían circulares —anda,
 * pero es el tipo de fragilidad que rompe el día que un bundler cambia el orden de evaluación—.
 */

/**
 * Qué falló, en una palabra que la interfaz sabe traducir.
 *
 *  · `config`        el servidor no tiene con qué verificar (falta un secreto). Lo arregla soporte.
 *  · `sesion`        la credencial falta, venció o su firma no cierra.
 *  · `token_incompleto` la firma cerró, pero el token no trae quién es el usuario.
 *  · `no_habilitado` el usuario no está dado de alta. Lo arregla un administrador.
 *  · `mfa`           falta el segundo factor. Lo arregla el propio usuario.
 */
export type CodigoRechazo =
  | 'config'
  | 'sesion'
  | 'token_incompleto'
  | 'no_habilitado'
  | 'mfa'

/** Quién es el usuario, según lo que la firma de Monday deja probar. */
export interface Sesion {
  userId: string
  accountId: string
  isGuest: boolean
  /** Admin de la CUENTA de Monday, según el propio token firmado. Define el rol en la app. */
  isAdmin: boolean
  /**
   * De qué app de Monday es este token, según el propio token firmado.
   *
   * Es lo que permite que la lista blanca dé permiso POR APP: dos apps distintas comparten los
   * usuarios y la base, pero cada token viene firmado con el secreto de la suya, así que este
   * dato no se puede inventar desde afuera.
   */
  appId: string
}

/**
 * Rechazo de acceso. `status` es lo único que sale a la red junto con un mensaje genérico; `motivo`
 * existe para el log del servidor.
 */
export class ErrorAuth extends Error {
  readonly status: 401 | 403 | 429
  readonly motivo: string
  /**
   * Qué control cortó. Es la única excepción al mensaje mudo, y existe porque sin ella la pantalla
   * no puede decir qué hacer: "no estás habilitado", "tu sesión no vale" y "al servidor le falta
   * configuración" son tres problemas con tres soluciones distintas, y los tres se veían como el
   * mismo 401 mudo.
   *
   * No filtra nada aprovechable: para recibirlo hay que haber pasado la Capa 1, y ningún código
   * dice si un usuario existe ni entrega credenciales.
   */
  readonly codigo?: CodigoRechazo

  /*
   * Los campos se declaran y se asignan a mano en vez de usar propiedades de constructor
   * (`constructor(readonly status: ...)`). Es equivalente y funciona en cualquier runtime, sin
   * depender de que quien compile sepa transformar esa forma abreviada.
   */
  constructor(status: 401 | 403 | 429, motivo: string, codigo?: CodigoRechazo) {
    super(MENSAJES[status])
    this.status = status
    this.motivo = motivo
    this.codigo = codigo
    this.name = 'ErrorAuth'
  }
}

/** Lo único que ve el que golpea la puerta. Ni una palabra sobre qué control fue el que falló. */
const MENSAJES: Record<401 | 403 | 429, string> = {
  401: 'Unauthorized',
  403: 'Forbidden',
  429: 'Too Many Requests',
}
