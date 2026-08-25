/**
 * Capa 2 — la lista blanca, leída de un tablero PRIVADO de Monday.
 *
 * La firma del session token prueba QUIÉN es el usuario; esto decide si ese usuario puede usar la
 * app. Vive en un tablero privado porque así el alta y la baja las hace un administrador desde
 * Monday, sin tocar el código ni redeployar: agregar una fila habilita, cambiar el estado revoca.
 *
 * Se consulta SIEMPRE del lado del servidor, con un token de integración propio
 * (`MONDAY_API_TOKEN`). Si esta consulta viviera en el frontend el control no existiría: el usuario
 * puede responderse que sí a sí mismo. Y el tablero es privado justamente para que el propio
 * usuario no pueda editar la lista que lo habilita.
 *
 * Falla CERRADA: si el tablero no se puede leer —token vencido, API caída, board mal configurado—
 * nadie entra. Es la decisión correcta para una lista blanca: un error de infraestructura no puede
 * transformarse en acceso abierto. El fallo no se cachea, así que en cuanto Monday responde, la
 * app vuelve sola.
 */
import { ErrorAuth, type Sesion } from './_errores.js'
import { mondayServidor } from './_mondayApi.js'

const API_MONDAY = 'https://api.monday.com/v2'
const API_VERSION = '2024-10'

/**
 * Cuánto vale un "sí" cacheado. Es el techo de lo que tarda una REVOCACIÓN en hacerse efectiva:
 * cinco minutos después de cambiar el estado en el tablero, el usuario queda afuera.
 */
const TTL_PERMITIDO_MS = 5 * 60_000

/**
 * Un "no" se cachea mucho menos. No es por seguridad sino por operación: recién dado de alta, el
 * usuario entra en medio minuto en vez de esperar cinco. El costo de cuota es despreciable porque
 * un usuario rechazado no genera tráfico sostenido.
 */
const TTL_DENEGADO_MS = 30_000

/**
 * Caché en memoria del proceso. En serverless cada instancia tiene la suya y se pierde al reciclar:
 * es un ahorro de cuota, no una fuente de verdad. Por eso los TTL son cortos y el tablero manda.
 */
const cache = new Map<string, { permitido: boolean; hasta: number }>()

/** Ids de columna del tablero de lista blanca. Configurables por si el tablero se rearma. */
const columnaUsuario = (): string => process.env.WHITELIST_COLUMN_USER?.trim() || 'text_mm6hqsmt'
const columnaEstado = (): string => process.env.WHITELIST_COLUMN_STATUS?.trim() || 'status'
/**
 * Columna con los IDs de las apps que ese usuario puede usar (un dropdown de varias etiquetas).
 *
 * Estar activo ya no alcanza: el permiso es POR APP y tiene que ser EXPLÍCITO. Una fila con esta
 * celda vacía no entra a ningún lado, y es a propósito: si el vacío significara "todas las apps",
 * dar de alta a alguien en una le abriría la puerta de todas las demás sin que nadie lo decida.
 */
const columnaApps = (): string => process.env.WHITELIST_COLUMN_APPS?.trim() || 'dropdown_mm6jamkm'

/**
 * Con qué ID se identifica ESTA app en esa columna.
 *
 * Por defecto, el `app_id` que viene FIRMADO adentro del session token: no hay que configurar
 * nada y no se puede falsear, porque cada app de Monday firma con su propio secreto. `APP_ID` lo
 * pisa para cuando se prefiere etiquetar con otra cosa —el Project ID de Vercel, por ejemplo—, a
 * costa de tener que mantener esa variable en cada deploy.
 */
function idDeEstaApp(sesion: Sesion): string {
  return process.env.APP_ID?.trim() || sesion.appId
}

/** ¿La celda del dropdown incluye este id? Monday la devuelve como texto separado por comas. */
function habilitaLaApp(celda: string | null, id: string): boolean {
  if (!id) return false
  return (celda ?? '')
    .split(',')
    .map((etiqueta) => etiqueta.trim())
    .includes(id)
}

/** La etiqueta que habilita. Cualquier otra —"Revocado", vacía, la que sea— deja afuera. */
const etiquetaActiva = (): string => process.env.WHITELIST_STATUS_ACTIVO?.trim() || 'Activo'

const QUERY = `
  query ($board: ID!, $columna: String!, $usuario: String!, $estado: [String!]) {
    items_page_by_column_values(
      board_id: $board
      limit: 5
      columns: [{ column_id: $columna, column_values: [$usuario] }]
    ) {
      items {
        id
        column_values(ids: $estado) {
          id
          text
        }
      }
    }
  }
`

interface RespuestaLista {
  data?: {
    items_page_by_column_values?: {
      items?: { id: string; column_values?: { id: string; text: string | null }[] }[]
    }
  }
  errors?: { message: string }[]
}

/**
 * Deja pasar sólo si el usuario tiene una fila en el tablero con el estado activo.
 *
 * Lanza `ErrorAuth` 403 en todos los casos negativos —no está, está revocado, no se pudo consultar—
 * con el mismo mensaje hacia afuera. La diferencia queda en el `motivo`, que va al log.
 */
export async function exigirListaBlanca(sesion: Sesion): Promise<void> {
  /* La clave incluye la cuenta: dos cuentas de Monday pueden tener ids de usuario iguales, y una no
     tiene por qué heredar el permiso de la otra. */
  /* La app entra en la clave: el mismo usuario puede estar habilitado en una y no en otra, y dos
     apps que comparten esta base compartirían la respuesta cacheada si no se distinguieran. */
  const app = idDeEstaApp(sesion)
  const clave = `${sesion.accountId}:${sesion.userId}:${app}`

  const guardado = cache.get(clave)
  if (guardado && Date.now() < guardado.hasta) {
    if (!guardado.permitido) throw new ErrorAuth(403, `fuera de la lista blanca (caché) ${clave}`, 'no_habilitado')
    return
  }

  const permitido = await consultarTablero(sesion.userId, app)
  cache.set(clave, {
    permitido,
    hasta: Date.now() + (permitido ? TTL_PERMITIDO_MS : TTL_DENEGADO_MS),
  })

  if (!permitido) throw new ErrorAuth(403, `fuera de la lista blanca ${clave}`, 'no_habilitado')
}

/** Vacía la caché. Existe para los tests; en producción los TTL alcanzan. */
export function limpiarCacheListaBlanca(): void {
  cache.clear()
}

async function consultarTablero(userId: string, app: string): Promise<boolean> {
  const token = (process.env.MONDAY_API_TOKEN ?? process.env.MONDAY_TOKEN)?.trim()
  const board = process.env.WHITELIST_BOARD_ID?.trim()
  if (!token || !board) {
    throw new ErrorAuth(
      403,
      'lista blanca sin configurar (MONDAY_API_TOKEN / WHITELIST_BOARD_ID)',
      'config',
    )
  }

  let res: Response
  try {
    res = await fetch(API_MONDAY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token,
        'API-Version': API_VERSION,
      },
      body: JSON.stringify({
        query: QUERY,
        variables: {
          board,
          columna: columnaUsuario(),
          usuario: userId,
          estado: [columnaEstado(), columnaApps()],
        },
      }),
    })
  } catch (e) {
    throw new ErrorAuth(403, `no se pudo consultar la lista blanca: ${(e as Error).message}`)
  }

  if (!res.ok) throw new ErrorAuth(403, `la lista blanca respondió HTTP ${res.status}`)

  const json = (await res.json()) as RespuestaLista
  if (json.errors?.length) {
    throw new ErrorAuth(403, `la lista blanca dio error: ${json.errors[0].message}`)
  }

  const items = json.data?.items_page_by_column_values?.items ?? []
  const activa = etiquetaActiva().toLowerCase()

  /* Alcanza con UNA fila activa: si quedó una vieja duplicada y revocada, la habilitación vigente
     manda. Lo que no habilita es no tener ninguna. */
  return items.some((item) => {
    const estado = item.column_values?.find((c) => c.id === columnaEstado())?.text ?? ''
    const apps = item.column_values?.find((c) => c.id === columnaApps())?.text ?? null
    // Las DOS condiciones: activo Y con permiso explícito para esta app.
    return estado.trim().toLowerCase() === activa && habilitaLaApp(apps, app)
  })
}

/**
 * Nombre y equipos del usuario de la SESIÓN, leídos por el servidor con su propio token.
 *
 * De acá sale el rol de la app (ver `src/lib/permisos.ts`, que trabaja con NOMBRES de equipo). Va
 * aparte de la lista blanca a propósito: la lista blanca decide QUIÉN entra —y falla cerrada—,
 * esto es dato de presentación y de rol, así que un fallo suyo no puede dejar a nadie afuera.
 *
 * `kind === 'admin'` es el admin de la CUENTA de Monday: manda aunque no esté en ningún equipo.
 */
export interface PerfilUsuario {
  nombre: string
  equipos: string[]
  esAdminDeCuenta: boolean
}

const QUERY_PERFIL = `
  query ($ids: [ID!]) {
    users(ids: $ids) {
      id
      name
      kind
      teams {
        id
        name
      }
    }
  }
`

interface RespuestaPerfil {
  users?: { id: string; name: string; kind?: string; teams?: { name: string }[] }[]
}

/**
 * El perfil del usuario, o `null` si no se pudo leer.
 *
 * No lanza: quien llama decide qué hacer sin él. Sin equipos, `lib/permisos` cae en el rol más
 * restrictivo —VENDEDOR—, que es el lado seguro para fallar. Un problema para leer los equipos no
 * tiene por qué frenar el registro de un cobro.
 */
export async function perfilDe(userId: string): Promise<PerfilUsuario | null> {
  try {
    const data = await mondayServidor<RespuestaPerfil>(QUERY_PERFIL, { ids: [userId] })
    const usuario = data.users?.find((u) => String(u.id) === userId)
    if (!usuario) return null
    return {
      nombre: usuario.name ?? '',
      equipos: (usuario.teams ?? []).map((t) => (t.name ?? '').trim()).filter(Boolean),
      esAdminDeCuenta: usuario.kind === 'admin',
    }
  } catch {
    return null
  }
}
