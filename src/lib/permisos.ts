/**
 * RBAC de la app: qué puede editar el usuario logueado, según su EQUIPO en Monday.
 *
 * Dos grupos, definidos por el nombre del equipo al que pertenece el usuario de la sesión:
 *   · "Administradores" (privilegiado): puede registrar el cobro a nombre de OTRO usuario, es decir
 *     cambiar el responsable de la operación desde el selector del encabezado.
 *   · "Vendedores" (estándar): opera siempre a su propio nombre; el selector queda bloqueado en él.
 *
 * Los dos equipos pueblan el selector: un cobro puede quedar a nombre de cualquiera de ellos.
 *
 * Reglas puras (sin React ni servicios): se testean solas y las consumen tanto el encabezado como
 * las vistas, así ninguna de las dos puede discrepar sobre quién puede editar qué.
 */
import type { UsuarioActual } from '@/types'

/** Equipo de Monday cuyos miembros son administradores de la app (grupo privilegiado). */
export const EQUIPO_ADMINISTRADORES = 'Administradores'
/** Equipo de Monday cuyos miembros son vendedores (grupo estándar). */
export const EQUIPO_VENDEDORES = 'Vendedores'

/**
 * Equipos cuyos miembros pueden ser responsables de un cobro: son los que pueblan el selector del
 * encabezado. Un usuario que esté en los dos aparece UNA sola vez (se filtra por usuario, no por
 * equipo).
 */
export const EQUIPOS_OPERADORES: readonly string[] = [EQUIPO_VENDEDORES, EQUIPO_ADMINISTRADORES]

/**
 * IDs de usuarios de Monday que cuentan como administradores aunque no estén en el equipo
 * (Gerentes / Supervisores). Vacío = manda exclusivamente el equipo.
 */
export const IDS_ADMINISTRADOR: readonly string[] = []

export type RolUsuario = 'ADMINISTRADOR' | 'VENDEDOR'

/** ¿El usuario pertenece a este equipo? Por nombre, sin distinguir mayúsculas ni espacios. */
export const perteneceAEquipo = (u: UsuarioActual | null, equipo: string): boolean =>
  (u?.equipos ?? []).some((e) => e.trim().toLowerCase() === equipo.trim().toLowerCase())

/**
 * Rol del usuario de la sesión.
 *
 * Es ADMINISTRADOR si está en el equipo "Administradores", si figura en `IDS_ADMINISTRADOR`, o si
 * es admin de la CUENTA de Monday (`is_admin`): ése ya puede editar cualquier valor directo en los
 * tableros, así que bloquearlo en la app no protegería nada.
 *
 * SIN usuario (modo local sin token, o falló la lectura de la sesión) el rol es ADMINISTRADOR a
 * propósito: en desarrollo no hay sesión que consultar y trabar la app no aportaría nada. En
 * producción siempre hay `me`, así que el permiso real lo decide el equipo.
 */
export function rolUsuario(u: UsuarioActual | null): RolUsuario {
  if (!u) return 'ADMINISTRADOR'
  if (u.isAdmin) return 'ADMINISTRADOR'
  if (IDS_ADMINISTRADOR.includes(u.id)) return 'ADMINISTRADOR'
  return perteneceAEquipo(u, EQUIPO_ADMINISTRADORES) ? 'ADMINISTRADOR' : 'VENDEDOR'
}

export const esAdministrador = (u: UsuarioActual | null): boolean =>
  rolUsuario(u) === 'ADMINISTRADOR'

/**
 * ¿Se puede cambiar el USUARIO responsable de la operación? Sólo el administrador, en CUALQUIER
 * etapa: el caso real es detectar a mitad del circuito que el cobro va a nombre de otro.
 */
export const puedeElegirUsuario = (u: UsuarioActual | null): boolean => esAdministrador(u)
