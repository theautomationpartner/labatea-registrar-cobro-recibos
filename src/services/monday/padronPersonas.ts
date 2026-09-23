/**
 * El padrón de personas en el navegador: se baja una vez por sesión, se revalida por delta y lo
 * consume el buscador para resolver la búsqueda en local mientras se escribe.
 *
 * ── De dónde sale ──
 * Del Cron Job de la app de operaciones de venta, que cachea el tablero de Personas en la misma
 * base de Neon que usa esta app. Esta app no tiene cron de personas propio: lo sirve
 * `/api/personas` leyendo aquella tabla (ver `api/_padronDb.ts`). Acá no se le pregunta nada a
 * Monday: ese es el punto del caché.
 *
 * ── Un padrón por lado del mostrador ──
 * El caché guarda clientes Y proveedores, y cada buscador pide SÓLO los suyos (`categoria` en el
 * pedido): COBROS, RECHAZO, RESUMEN y el pase "De Clientes" bajan los clientes; PAGOS y el pase
 * "De Proveedores", los proveedores. Son dos padrones independientes —cada uno con su versión y su
 * espejo en sessionStorage— porque cada uno sirve a una pantalla distinta y ninguno tiene por qué
 * esperar al otro.
 *
 * ── Qué NO se decide con esto ──
 * El padrón tiene hasta 5 minutos de antigüedad. Sirve para ENCONTRAR a la persona; al elegirla, el
 * buscador la relee de Monday (`refrescarPersona`) porque de ese objeto salen el saldo, la situación
 * y —en un proveedor— si tiene la cuenta corriente conectada, que es con lo que se decide si la
 * operación puede seguir.
 *
 * ── Dónde vive ──
 * En memoria mientras la pestaña está viva, espejado en `sessionStorage` para que recargar no cueste
 * la bajada completa. No en `localStorage`: es la cartera con sus saldos y no tiene por qué
 * sobrevivir a la sesión en el disco de la máquina.
 */
import { CLIENTES, PROVEEDORES } from '@/data/mock'
import { indexarPadron, type EntradaPadron } from '@/lib/busquedaPersonas'
import { formatearCuit } from '@/lib/pagos'
import { CATEGORIA_CLIENTE, CATEGORIA_PROVEEDOR, type RolPersona } from '@/lib/personas'
import type { Cliente } from '@/types'
import { getPersonaItemPorId, mapPersona } from './clientes'
import { mapProveedor } from './proveedores'
import { cabecerasPropias, mondayHabilitado, verificarRespuesta } from './sdk'

/* La versión de la clave sube con cada cambio de forma de lo guardado, para que un espejo viejo no
   se lea como si fuera del formato nuevo. */
const CLAVE_SESION: Record<RolPersona, string> = {
  cliente: 'padron-clientes-v1',
  proveedor: 'padron-proveedores-v1',
}

/** Cada cuánto se vuelve a preguntar por novedades. El cron corre cada 5 minutos; esto lo sigue. */
const REVALIDAR_CADA_MS = 5 * 60_000

/**
 * Cómo guarda la categoría el cron de la otra app (`'cliente' | 'proveedor'`) → cómo la nombra ESTA
 * app, que es la etiqueta del tablero (ver `lib/personas`). Sin esta traducción, `cumpleRol` no
 * reconocería a nadie del padrón y el buscador quedaría vacío.
 */
const ETIQUETA_DE_CATEGORIA: Record<string, string> = {
  cliente: CATEGORIA_CLIENTE,
  proveedor: CATEGORIA_PROVEEDOR,
}

/**
 * Un registro tal como lo guarda el cron (`PersonaCache` en la app de ventas). Es la forma de
 * `Cliente` salvo en dos campos: el CUIT viene crudo y las categorías en el vocabulario del cron.
 */
type RegistroPadron = Omit<Cliente, 'categorias'> & { categorias?: string[] }

interface RespuestaPadron {
  version: string | null
  completo: boolean
  personas: RegistroPadron[]
  bajas: string[]
  sincronizado: string | null
  error: string | null
}

export interface Padron {
  /** Ya normalizado para buscar, y ya pasado por el cerrojo del rol. */
  entradas: EntradaPadron[]
  /** Cuándo corrió por última vez —con éxito— la sincronización del servidor. */
  sincronizado: string | null
  /** El servidor no pudo actualizar el padrón. */
  error: string | null
}

/**
 * El registro del caché → el `Cliente` de esta app. Es el MISMO criterio de `mapPersona`
 * (`services/monday/clientes.ts`) en los dos campos en que el cron difiere: el CUIT se formatea en
 * el borde de entrada, y las categorías se nombran como en el tablero.
 *
 * Exportada para el test: si esto se rompe, el cerrojo por rol deja a todos afuera en silencio.
 */
export function deRegistro(r: RegistroPadron): Cliente {
  return {
    ...r,
    cuit: formatearCuit(r.cuit),
    categorias: (r.categorias ?? []).map((c) => ETIQUETA_DE_CATEGORIA[c] ?? c),
  }
}

/** Estado de UN padrón. Hay uno por rol y por pestaña. */
interface EstadoPadron {
  porId: Map<string, Cliente>
  version: string | null
  sincronizado: string | null
  error: string | null
  indice: EntradaPadron[] | null
  ultimaRevalidacion: number
  enCurso: Promise<Padron> | null
}

const nuevoEstado = (): EstadoPadron => ({
  porId: new Map(),
  version: null,
  sincronizado: null,
  error: null,
  indice: null,
  ultimaRevalidacion: 0,
  enCurso: null,
})

const estados: Record<RolPersona, EstadoPadron> = {
  cliente: nuevoEstado(),
  proveedor: nuevoEstado(),
}

/** El índice se rearma sólo cuando el padrón cambió; en cada tecla se reusa el de antes. */
function padronActual(rol: RolPersona): Padron {
  const e = estados[rol]
  e.indice ??= indexarPadron([...e.porId.values()], rol)
  return { entradas: e.indice, sincronizado: e.sincronizado, error: e.error }
}

/**
 * El padrón de ese rol, listo para buscar.
 *
 * La primera llamada lo baja; las siguientes devuelven lo que ya está y revalidan por detrás si
 * pasó el intervalo. Las llamadas concurrentes comparten la promesa en curso. Nunca rechaza: sin
 * padrón el buscador sigue funcionando con el botón Buscar, que consulta Monday directo.
 */
export function getPadron(rol: RolPersona): Promise<Padron> {
  const e = estados[rol]
  if (e.porId.size > 0) {
    if (Date.now() - e.ultimaRevalidacion > REVALIDAR_CADA_MS) void revalidar(rol)
    return Promise.resolve(padronActual(rol))
  }
  e.enCurso ??= cargar(rol).finally(() => {
    e.enCurso = null
  })
  return e.enCurso
}

/** Fuerza una revalidación. Un fallo NO vacía lo que ya está: mejor un padrón de hace 5 minutos. */
export async function revalidar(rol: RolPersona): Promise<Padron> {
  try {
    await pedir(rol, estados[rol].version)
  } catch (e) {
    console.warn(`[padrón ${rol}] no se pudo revalidar:`, (e as Error).message)
  }
  return padronActual(rol)
}

async function cargar(rol: RolPersona): Promise<Padron> {
  const e = estados[rol]
  /* Sin token no hay a quién preguntarle: el buscador trabaja sobre el mock, que es chico y alcanza
     para recorrer la pantalla. */
  if (!mondayHabilitado()) {
    const mock: Cliente[] = rol === 'proveedor' ? PROVEEDORES : CLIENTES
    e.porId = new Map(mock.map((c) => [c.id, c]))
    e.indice = null
    return padronActual(rol)
  }
  /* En desarrollo CON token no hay funciones serverless —`/api/*` no existe— pero sí Monday: el
     live search queda vacío y el botón Buscar consulta el tablero real, como antes del caché. */
  if (import.meta.env.DEV) return padronActual(rol)

  desdeSesion(rol)
  try {
    await pedir(rol, e.version)
  } catch (err) {
    /* Sin padrón, el live search no funciona pero el botón Buscar sí: la app queda como estaba
       antes de este caché, no rota. Por eso esto no propaga el error. */
    console.warn(`[padrón ${rol}] no se pudo cargar:`, (err as Error).message)
    e.error = (err as Error).message
  }
  return padronActual(rol)
}

/** Pide al servidor lo que falte desde `desde` y lo aplica. */
async function pedir(rol: RolPersona, desde: string | null): Promise<void> {
  const res = await fetch('/api/personas', {
    method: 'POST',
    headers: await cabecerasPropias({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ desde, categoria: rol }),
  })
  /* Un 5xx del padrón NO pasa por `verificarRespuesta`: ahí levantaría la ventana de "la app no
     puede trabajar", y sin padrón la app sí puede —con el botón Buscar—. Los rechazos de seguridad
     (401/403/429) sí pasan: tienen que levantar su ventana igual que en cualquier otra consulta. */
  if (res.status >= 500) throw new Error(`Padrón de personas HTTP ${res.status}`)
  await verificarRespuesta(res, 'Padrón de personas')
  aplicar(rol, (await res.json()) as RespuestaPadron)
}

function aplicar(rol: RolPersona, data: RespuestaPadron): void {
  const e = estados[rol]
  /* `completo` marca si lo que llegó REEMPLAZA el padrón o se le suma. */
  if (data.completo) e.porId = new Map()
  for (const registro of data.personas) e.porId.set(registro.id, deRegistro(registro))
  /* Las bajas DESPUÉS de las altas: una persona que se dio de baja y volvió llega en las dos
     listas, y lo que vale es que está de vuelta. */
  const altas = new Set(data.personas.map((p) => p.id))
  for (const id of data.bajas) if (!altas.has(id)) e.porId.delete(id)

  e.version = data.version
  e.sincronizado = data.sincronizado
  e.error = data.error
  e.ultimaRevalidacion = Date.now()
  e.indice = null
  guardarEnSesion(rol)

  /* Que un padrón roto NO se vea como un buscador que simplemente no encuentra a nadie. */
  if (e.error) {
    console.warn(
      `[padrón ${rol}] el servidor no pudo actualizarlo: ${e.error}. Los resultados pueden estar ` +
        'incompletos; el botón Buscar consulta Monday directo.',
    )
  } else if (e.porId.size === 0) {
    console.warn(
      `[padrón ${rol}] llegó VACÍO. El live search no va a encontrar nada hasta que el cron de ` +
        'personas (app de operaciones de venta) complete un barrido; el botón Buscar sigue funcionando.',
    )
  }
}

/**
 * Suma al padrón las personas traídas por el botón Buscar (consulta directa a Monday): sería absurdo
 * encontrarla por Monday y que dos segundos después el live search siga sin conocerla. No se toca
 * la versión —no vinieron del servidor—, así que la próxima revalidación las confirma o corrige.
 */
export function recordarPersonas(rol: RolPersona, personas: readonly Cliente[]): void {
  if (personas.length === 0) return
  const e = estados[rol]
  for (const p of personas) e.porId.set(p.id, p)
  e.indice = null
}

/**
 * La persona elegida en el live search, RELEÍDA de Monday por su id.
 *
 * El padrón sirve para encontrarla, no para operar con ella: tiene hasta 5 minutos de antigüedad y
 * de este objeto salen el saldo de la cuenta corriente, la situación de crédito y la condición de
 * pago —con lo que la pantalla decide si la operación puede seguir—, y en un proveedor además si
 * tiene la cuenta corriente conectada, dato que el caché ni siquiera guarda. Es la misma relectura
 * que hace la app de ventas al elegir un cliente (`refrescarCliente`).
 *
 * Trae los MISMOS campos y el MISMO mapeo que el botón Buscar (`getPersonaItemPorId` + `mapPersona`
 * / `mapProveedor`), así que la ficha es idéntica venga de donde venga. `null` = ya no está en
 * Monday: se la borró entre la última corrida del cron y ahora.
 */
export async function refrescarPersona(rol: RolPersona, id: string): Promise<Cliente | null> {
  if (!mondayHabilitado()) {
    const mock: Cliente[] = rol === 'proveedor' ? PROVEEDORES : CLIENTES
    return mock.find((c) => c.id === id) ?? null
  }
  const item = await getPersonaItemPorId(id)
  if (!item) return null
  return rol === 'proveedor' ? mapProveedor(item) : mapPersona(item)
}

/* ── Espejo en sessionStorage ───────────────────────────────────────────────────────────────── */

function desdeSesion(rol: RolPersona): void {
  const e = estados[rol]
  try {
    const crudo = sessionStorage.getItem(CLAVE_SESION[rol])
    if (!crudo) return
    const guardado = JSON.parse(crudo) as { version: string | null; personas: Cliente[] }
    if (!Array.isArray(guardado.personas)) return
    /* Un espejo VACÍO no se restaura con su versión: con el padrón en cero y una versión guardada,
       el pedido siguiente sería un delta, el servidor contestaría —correctamente— que no cambió
       nada, y el padrón quedaría vacío PARA SIEMPRE. Sin versión se pide entero. Es el bug que ya
       se pagó en la app de ventas. */
    if (guardado.personas.length === 0) return
    e.porId = new Map(guardado.personas.map((c) => [c.id, c]))
    e.version = guardado.version
    e.indice = null
  } catch {
    /* Un espejo ilegible —formato viejo, cuota llena, modo privado— se ignora y se baja el padrón
       completo, que es el camino de la primera vez. */
  }
}

function guardarEnSesion(rol: RolPersona): void {
  const e = estados[rol]
  try {
    sessionStorage.setItem(
      CLAVE_SESION[rol],
      JSON.stringify({ version: e.version, personas: [...e.porId.values()] }),
    )
  } catch {
    /* Sin lugar en sessionStorage el padrón sigue en memoria: sólo se pierde el atajo al recargar. */
  }
}
