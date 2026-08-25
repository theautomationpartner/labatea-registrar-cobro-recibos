/**
 * El dispositivo confiable (Capa 3), guardado en el navegador.
 *
 * ── Por qué no una cookie ──
 * La app corre en un iframe servido desde otro dominio que monday.com. Para el navegador eso es
 * contexto de terceros: Safari bloquea esas cookies desde hace años y Chrome va en el mismo camino.
 * Una sesión basada en cookies no llegaría nunca al servidor, y lo peor es cómo falla —anda en el
 * navegador del que programa y no en el del que trabaja—. Por eso el token viaja en una cabecera
 * propia (`X-Device-Token`) que la app pone a mano en cada pedido.
 *
 * ── Sobre localStorage en un iframe ──
 * Los navegadores modernos lo PARTICIONAN: lo que se guarda acá adentro queda atado al par
 * (monday.com, esta app) y no se comparte con nada más. Para lo que hace falta, eso está bien: el
 * token es de este dispositivo y de este contexto. Pero el acceso puede fallar directamente
 * —navegación privada, almacenamiento bloqueado por configuración—, y ahí `localStorage` no
 * devuelve `null`: TIRA. De ahí el try/catch de cada operación y el respaldo en memoria, que dura
 * lo que dure la pestaña: el usuario tendrá que poner el código la próxima vez, pero la sesión de
 * hoy no se rompe.
 */
const CLAVE = 'labatea.mfa.dispositivo'

/** Respaldo para cuando el navegador no deja escribir. Vive lo que vive la pestaña. */
let enMemoria: string | null = null

export function leerDeviceToken(): string | null {
  try {
    return window.localStorage.getItem(CLAVE) ?? enMemoria
  } catch {
    return enMemoria
  }
}

export function guardarDeviceToken(token: string): void {
  enMemoria = token
  try {
    window.localStorage.setItem(CLAVE, token)
  } catch {
    /* Sin almacenamiento persistente el token igual sirve para esta sesión. No se avisa nada: la
       app funciona, sólo va a pedir el código de nuevo la próxima vez. */
  }
}

/**
 * Borra el dispositivo confiable.
 *
 * Se llama cuando el backend contesta que el segundo factor falta: si el token que estamos
 * mandando ya no vale —venció, o alguien lo revocó volviendo a enrolarse— guardarlo sólo sirve
 * para seguir mandando algo muerto en cada pedido.
 */
export function olvidarDeviceToken(): void {
  enMemoria = null
  try {
    window.localStorage.removeItem(CLAVE)
  } catch {
    /* Si no se puede tocar el almacenamiento, con limpiar la memoria alcanza. */
  }
}
