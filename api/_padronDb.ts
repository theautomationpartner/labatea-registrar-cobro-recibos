/**
 * El padrón de PERSONAS cacheado en Postgres, en modo SÓLO LECTURA.
 *
 * ── De quién es este padrón ──
 * Esta app NO lo mantiene. Lo escribe el Cron Job de la app de operaciones de venta
 * (`labatea-operaciones-de-venta`, `api/cron/personas.ts`) sobre la MISMA base de Neon: las dos apps
 * leen el mismo tablero de Personas (18420688238) y un segundo cron barriendo lo mismo sólo
 * duplicaría el consumo del cupo de Monday para llegar al mismo resultado.
 *
 * Por eso acá no hay ni una sentencia de escritura: si el padrón está roto o viejo, se arregla desde
 * aquella app (su `?modo=estado` dice cómo está), no desde ésta. El esquema también vive allá, en
 * `db/personas.sql`; lo que sigue es la parte de lectura, espejo de su `api/_padronDb.ts`.
 *
 * Que esta app lea tabla ajena la ata a un contrato: las columnas `categorias`, `datos`,
 * `actualizado_en`, `nombre` de `personas_cache`, la tabla `personas_bajas` y la fila de
 * `personas_sync`. Si allá cambian, se rompe acá.
 */
import { VERSION_CACHE, consultar } from './_db.js'

/**
 * El registro tal como lo guarda el cron de la otra app. Se declara sólo lo que el endpoint
 * necesita tocar; el resto viaja tal cual hacia el navegador, que es quien lo mapea al modelo de
 * esta app (ver `src/services/monday/padronPersonas.ts`).
 */
export interface PersonaCache {
  id: string
  [campo: string]: unknown
}

export interface EstadoSync {
  marca: Date | null
  ultimo_ok: Date | null
  ultimo_completo: Date | null
  personas: number
  duracion_ms: number | null
  error: string | null
}

export async function leerEstado(): Promise<EstadoSync> {
  const filas = await consultar<EstadoSync>(
    `select marca, ultimo_ok, ultimo_completo, personas, duracion_ms, error
       from personas_sync where id = 1`,
  )
  return (
    filas[0] ?? {
      marca: null,
      ultimo_ok: null,
      ultimo_completo: null,
      personas: 0,
      duracion_ms: null,
      error: null,
    }
  )
}

export interface Delta {
  /** Identidad del snapshot y cursor del próximo pedido: el `actualizado_en` más nuevo. */
  version: string | null
  personas: PersonaCache[]
  bajas: string[]
}

/**
 * Lo que el consumidor todavía no tiene, acotado a una categoría. Idéntico a `leerDelta` de la app
 * de ventas, incluido el orden de lectura de la versión (ver el comentario de abajo).
 *
 * La categoría es el PRIMER cerrojo: el buscador de clientes pide `'cliente'` y el de proveedores
 * `'proveedor'`, y lo que no es de esa categoría ni siquiera llega al navegador.
 */
export async function leerDelta(desde: string | null, categoria: string | null): Promise<Delta> {
  /* La versión se lee ANTES que las filas, y las filas se acotan a ella. Leída después, una
     escritura del cron colada entre las dos consultas quedaría fuera del delta pero dentro de la
     versión, y el navegador no volvería a pedir esa fila nunca. Sale como TEXTO con microsegundos
     (ver `VERSION_CACHE`): como `Date`, la fila más nueva quedaría afuera de su propia versión. */
  const marca = await consultar<{ version: string | null }>(
    `select ${VERSION_CACHE} as version from personas_cache`,
  )
  const version = marca[0]?.version ?? null

  const condiciones: string[] = []
  const params: unknown[] = []
  if (desde) {
    params.push(desde)
    condiciones.push(`actualizado_en > $${params.length}::timestamptz`)
  }
  if (version) {
    params.push(version)
    condiciones.push(`actualizado_en <= $${params.length}::timestamptz`)
  }
  if (categoria) {
    params.push([categoria])
    condiciones.push(`categorias @> $${params.length}::text[]`)
  }
  const donde = condiciones.length ? `where ${condiciones.join(' and ')}` : ''

  const personas = await consultar<{ datos: PersonaCache }>(
    `select datos from personas_cache ${donde} order by nombre`,
    params,
  )

  /* Las bajas NO se filtran por categoría: la fila ya no está en `personas_cache`, así que no hay
     de dónde leerle la categoría. Mandar de más es inofensivo —el navegador borra un id que no
     tiene— y filtrar de menos le dejaría vivo un registro dado de baja. */
  const bajas = desde
    ? await consultar<{ item_id: string }>(
        `select item_id from personas_bajas where baja_en > $1::timestamptz`,
        [desde],
      )
    : []

  return {
    version,
    personas: personas.map((p) => p.datos),
    bajas: bajas.map((b) => b.item_id),
  }
}
