/**
 * Usuarios de Monday y sus EQUIPOS. De acá salen las dos cosas que necesita la app:
 *
 *   · el selector "Seleccionar usuario" del encabezado: los miembros de los equipos "Vendedores"
 *     y "Administradores" (ver `EQUIPOS_OPERADORES`);
 *   · el rol del usuario logueado (`me`), que es lo que habilita o bloquea ese selector (ver
 *     `lib/permisos`).
 *
 * Filtros del selector:
 *   · Equipo: sólo miembros de alguno de los equipos operadores.
 *   · Rol: se excluyen Visores (is_view_only) y los usuarios desactivados. Los INVITADOS sí entran:
 *     quién puede operar lo decide la lista blanca de la Capa 2, no un flag de Monday (ver abajo).
 *     El id numérico viaja como valor para asignar el cobro.
 */
import { USUARIOS } from '@/data/mock'
import { EQUIPOS_OPERADORES } from '@/lib/permisos'
import type { Usuario, UsuarioActual } from '@/types'
import { cabecerasPropias, mondayApi, mondayHabilitado, verificarRespuesta } from './sdk'

/** Tope de usuarios que trae la consulta. La cuenta es chica; alcanza y evita paginar. */
const LIMITE_USUARIOS = 500

/** Equipo tal como lo devuelve la API: acá sólo interesa el nombre. */
interface MondayTeam {
  id: string
  name: string
}

/** Usuario de la cuenta, YA con los equipos a los que pertenece. */
interface MondayUser {
  id: string
  name: string
  enabled?: boolean | null
  is_view_only?: boolean | null
  teams?: MondayTeam[] | null
}

interface MondayMe extends MondayUser {
  is_admin?: boolean | null
}

/** Nombres de equipo normalizados (sin espacios sobrantes y sin vacíos). */
const nombresDeEquipos = (teams: MondayTeam[] | null | undefined): string[] =>
  (teams ?? []).map((t) => (t.name ?? '').trim()).filter(Boolean)

/** ¿El usuario pertenece a alguno de estos equipos? Por nombre, sin distinguir mayúsculas. */
const enAlgunEquipo = (u: MondayUser, equipos: readonly string[]): boolean => {
  const propios = nombresDeEquipos(u.teams).map((n) => n.toLowerCase())
  return equipos.some((e) => propios.includes(e.trim().toLowerCase()))
}

/**
 * Usuario logueado, CON sus equipos: son los que definen el rol y, con él, qué puede editar en la
 * app. Sin token (modo local) devuelve null: no hay sesión.
 *
 * ── Por qué en producción NO se usa `me` ──
 * `me` viaja por el proxy, y el proxy inyecta el token del SERVIDOR: contesta quién es el dueño de
 * ese token, no quién abrió la app. Con una sola cuenta de servicio para todos, la app creía que
 * todos eran esa persona —y les daba su rol—. En producción la identidad sale de `/api/usuario`,
 * que la lee del session token ya verificado (ver `api/usuario.ts`).
 *
 * Ese mismo pedido es el PASO 1 de la secuencia de arranque: si contesta, el usuario pasó la firma
 * y la lista blanca. Un rechazo suyo se propaga como `AccesoDenegado` y `App.tsx` lo trata como lo
 * que es —la puerta cerrada— en vez de como una sesión que no se pudo leer.
 *
 * En desarrollo no hay funciones serverless ni iframe, así que ahí se sigue usando `me` contra el
 * proxy de Vite con el token personal: es la única identidad disponible en localhost.
 */
export async function getUsuarioActual(): Promise<UsuarioActual | null> {
  if (!mondayHabilitado()) return null

  if (!import.meta.env.DEV) {
    const res = await fetch('/api/usuario', {
      method: 'POST',
      headers: await cabecerasPropias({ 'Content-Type': 'application/json' }),
      body: '{}',
    })
    await verificarRespuesta(res, 'Sesión')
    return (await res.json()) as UsuarioActual
  }

  const data = await mondayApi<{ me: MondayMe | null }>(
    `query {
      me {
        id
        name
        is_admin
        teams { id name }
      }
    }`,
  )
  const me = data.me
  if (!me) return null
  return {
    id: String(me.id),
    name: me.name,
    isAdmin: Boolean(me.is_admin),
    equipos: nombresDeEquipos(me.teams),
  }
}

/** Paleta de colores para el avatar. */
const COLORES_USUARIO = [
  'var(--avatar-orange)',
  'var(--red)',
  'var(--green)',
  '#575ce5',
  'var(--primary-blue)',
  'var(--purple)',
] as const

/**
 * Color del avatar, derivado del ID del usuario. Se elige por HASH y no por posición en la lista:
 * la lista se ordena por nombre y puede crecer, así que con el índice el color de una persona
 * cambiaba al entrar alguien nuevo antes que ella. Con el id, cada usuario conserva siempre el
 * mismo color, que es lo que lo vuelve reconocible de un vistazo.
 */
const colorDe = (id: string): string => {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return COLORES_USUARIO[h % COLORES_USUARIO.length]
}

/** Iniciales del nombre: la primera letra de las dos primeras palabras, en mayúscula. */
const iniciales = (nombre: string): string =>
  nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase()

/**
 * Usuarios habilitados a operar: miembros de "Vendedores" o "Administradores", ya filtrados por rol
 * (sin visores ni desactivados) y mapeados al `Usuario` que consume la interfaz. Sin token (modo
 * local) devuelve el mock.
 *
 * Se consulta `users` con SUS equipos (en vez de traer los `teams` con sus usuarios): así quien está
 * en los dos equipos aparece UNA sola vez, sin deduplicar después, y es la misma entidad que
 * necesita el RBAC —un solo modelo alcanza para el selector y para el rol—.
 *
 * El orden es alfabético: la lista se lee como una agenda, no como el orden en que Monday
 * devuelve los usuarios (que es arbitrario y cambia).
 */
export async function getUsuarios(): Promise<Usuario[]> {
  if (!mondayHabilitado()) return USUARIOS

  const data = await mondayApi<{ users: MondayUser[] }>(
    `query ($limite: Int!) {
      users(limit: $limite) {
        id
        name
        enabled
        is_view_only
        teams { id name }
      }
    }`,
    { limite: LIMITE_USUARIOS },
  )

  // El filtro por nombre de equipo se resuelve en memoria: la API no filtra usuarios por equipo.
  return (data.users ?? [])
    .filter((u) => enAlgunEquipo(u, EQUIPOS_OPERADORES))
    /* Rol: se excluyen Visores (`is_view_only`) y los usuarios desactivados. Un visor no puede
       operar nada y un usuario dado de baja no puede ser responsable de un cobro.

       Los INVITADOS (`is_guest`) sí entran, y sacar esa exclusión fue un arreglo, no un descuido.
       Varias de las personas que operan la app son invitados de la cuenta —Dev TAP y Camila
       Ferreras, hoy— y quedaban afuera del selector aunque el tablero privado de la lista blanca
       las habilita explícitamente. El síntoma era que el selector arrancaba VACÍO en vez de
       preseleccionar al usuario logueado: `usuarioPorDefecto` cruza la sesión contra esta lista, y
       si la sesión no está en ella, no hay con qué matchear.

       El criterio es el mismo que ya fija la Capa 2: quién puede operar lo decide la lista blanca
       —una fila que sólo un administrador edita—, no un flag implícito de Monday. Dejar que
       `is_guest` mande acá anulaba un permiso explícito con uno implícito, y encima en silencio. */
    .filter((u) => !u.is_view_only && u.enabled !== false)
    .map((u) => ({
      id: String(u.id),
      name: u.name,
      ini: iniciales(u.name),
      color: colorDe(String(u.id)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
}
