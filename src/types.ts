/** Modelo de dominio. La capa de servicio (Monday) debe devolver exactamente estas formas. */

/**
 * Etapas de la app. A diferencia de "Operaciones de venta", acá hay UN SOLO recorrido —registrar
 * un cobro y emitir su recibo—, así que no existe un paso previo de elección de operación: la app
 * arranca directamente en la selección de cliente.
 */
export type Paso = 'cliente' | 'ventas' | 'cobro' | 'recibo'

/**
 * Usuario que puede quedar como responsable de la operación: sale de los equipos "Vendedores" y
 * "Administradores" de Monday y puebla el selector del encabezado.
 */
export interface Usuario {
  /** ID numérico del usuario de Monday. Se guarda para asignar el cobro/recibo en las mutaciones. */
  id: string
  name: string
  /** Iniciales para el avatar (dos letras). */
  ini: string
  /** Color del avatar. Estable por usuario: sale de su id, no de su posición en la lista. */
  color: string
}

/** Usuario logueado en Monday: define el responsable por defecto y los permisos de la UI (RBAC). */
export interface UsuarioActual {
  /** ID numérico del usuario de Monday (query `me`). */
  id: string
  name: string
  /** Admin de la CUENTA de Monday (`is_admin`), distinto del equipo "Administradores". */
  isAdmin: boolean
  /** Nombres de los equipos a los que pertenece. De acá sale el rol: ver `lib/permisos`. */
  equipos: string[]
}
