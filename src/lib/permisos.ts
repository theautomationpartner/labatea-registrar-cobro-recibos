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
import type { RolPersona } from '@/lib/personas'
import type { OperacionApp, UsuarioActual } from '@/types'

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

/* ===== Equipo "Pago a Proveedores" =====
   Quién ve qué módulo. Es una regla de INTEGRIDAD de los datos —los pagos y los rechazos mueven la
   cuenta corriente de proveedores—, así que se escribe distinto que el rol de arriba en dos puntos:
   va por ID de equipo y falla CERRADA. */

/**
 * Id del equipo de Monday "Pago a Proveedores" (1501065). Sus miembros —y SÓLO ellos— operan PAGOS y
 * RECHAZO DE CHEQUE, y hacen pases de saldo entre cuentas de PROVEEDORES.
 *
 * Por ID y no por nombre, a diferencia de "Administradores" y "Vendedores": renombrar el equipo en
 * Monday no puede quitarle el acceso a nadie, y —más importante— crear OTRO equipo con el mismo
 * nombre no puede dárselo a nadie.
 */
export const EQUIPO_PAGO_PROVEEDORES_ID = '1501065'

/**
 * ¿El usuario de la sesión está en el equipo "Pago a Proveedores"?
 *
 * Falla CERRADA, al revés que `rolUsuario`: sin usuario, o con un usuario que no trae sus ids de
 * equipo —un servidor desactualizado, una lectura del perfil que falló—, la respuesta es NO. Ahí un
 * error no puede abrir la puerta: en el peor caso alguien del equipo ve la app recortada y avisa, que
 * es un problema visible; al revés, alguien de afuera registraría pagos y nadie se enteraría.
 */
export const esDelEquipoProveedores = (u: UsuarioActual | null): boolean =>
  !!u && (u.equipoIds ?? []).includes(EQUIPO_PAGO_PROVEEDORES_ID)

/**
 * Todos los módulos, en el orden en que los ofrece el encabezado. RESUMEN es para todos, como
 * COBROS: documenta la cuenta de un CLIENTE y no mueve saldo de nadie. COBRANZA, con más razón: sólo
 * LEE las cuentas de los clientes y sus facturas —no escribe una sola columna en Monday—, y es la
 * pantalla con la que un vendedor sale a cobrar lo suyo.
 */
const OPERACIONES: readonly OperacionApp[] = [
  'COBROS',
  'PASES',
  'PAGOS',
  'RECHAZOS',
  'RESUMEN',
  'COBRANZA',
]

/** Los que sólo existen para el equipo. PASES no está: es compartido (ver `ladosDePase`). */
const OPERACIONES_DEL_EQUIPO: readonly OperacionApp[] = ['PAGOS', 'RECHAZOS']

/**
 * Los módulos que este usuario puede ver en "Seleccionar Operación". Los demás NO se ofrecen —ni
 * deshabilitados—: quien no tiene acceso no tiene por qué saber que existen.
 */
export const operacionesPermitidas = (u: UsuarioActual | null): readonly OperacionApp[] =>
  esDelEquipoProveedores(u)
    ? OPERACIONES
    : OPERACIONES.filter((o) => !OPERACIONES_DEL_EQUIPO.includes(o))

/** ¿Puede operar este módulo? Es lo que consulta el reducer, además de lo que muestra el selector. */
export const puedeOperar = (u: UsuarioActual | null, op: OperacionApp | null): boolean =>
  op !== null && operacionesPermitidas(u).includes(op)

/**
 * Entre qué cuentas puede hacer un PASE DE SALDO este usuario.
 *
 * El módulo es COMPARTIDO: lo que el equipo cambia es con qué cuentas. El del equipo "Pago a
 * Proveedores" puede elegir entre las dos —clientes o proveedores—; el resto sólo entre cuentas de
 * CLIENTES, porque mover saldo entre proveedores es mover plata que se les debe.
 *
 * CLIENTES va siempre primero y está en las dos listas: es el lado que puede cualquiera, y por eso es
 * también el respaldo seguro cuando hace falta uno y todavía no se eligió (ver `ladosDePase(u)[0]`).
 * Sin usuario, sólo CLIENTES: falla cerrada, igual que el resto de la regla.
 */
export const ladosDePase = (u: UsuarioActual | null): readonly RolPersona[] =>
  esDelEquipoProveedores(u) ? ['cliente', 'proveedor'] : ['cliente']

/** ¿Puede hacer un pase entre cuentas de este tipo? Es lo que consulta el reducer. */
export const puedePasarEntre = (u: UsuarioActual | null, rol: RolPersona): boolean =>
  ladosDePase(u).includes(rol)

/**
 * Con qué lado NACE el pase. Si el usuario tiene una sola opción, ésa —no hay nada que decidir—; si
 * tiene dos, ninguna: preseleccionar una de las dos sería decidir por él de qué lado mueve el saldo.
 */
export const ladoInicialDePase = (u: UsuarioActual | null): RolPersona | null => {
  const lados = ladosDePase(u)
  return lados.length === 1 ? lados[0] : null
}
