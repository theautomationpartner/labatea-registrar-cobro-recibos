/**
 * Conexión a Postgres (Capa 3).
 *
 * Sirve igual para Neon y para Supabase: los dos entregan una `DATABASE_URL` de Postgres. Lo que
 * SÍ importa es cuál: tiene que ser la cadena **con pooler** (Supabase, puerto 6543; Neon, el host
 * `-pooler`). Una función serverless puede levantar decenas de instancias a la vez, y contra el
 * puerto directo eso agota las conexiones de la base en el primer pico de uso.
 *
 * El pool se arma una sola vez por instancia y con `max: 1`: la instancia atiende un pedido por vez,
 * así que más conexiones no dan más velocidad y sí más presión sobre la base.
 */
import { Pool } from 'pg'

let pool: Pool | null = null

function conexion(): Pool {
  if (pool) return pool

  /* La integración de Neon en Vercel inyecta varias variables con la misma cadena; se aceptan las
     tres para no depender de cuál nombre usó la plantilla del día. La que interesa es la del
     POOLER: contra el puerto directo, un pico de tráfico agota las conexiones de la base. */
  const url =
    process.env.DATABASE_URL?.trim() ||
    process.env.POSTGRES_URL?.trim() ||
    process.env.POSTGRES_PRISMA_URL?.trim()
  if (!url) {
    throw new Error('falta DATABASE_URL (o POSTGRES_URL) en el servidor')
  }

  const { cadena, ssl } = conSslExplicito(url)

  pool = new Pool({
    connectionString: cadena,
    ssl,
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  })
  return pool
}

/** Verificación completa del certificado: cadena de confianza Y nombre del host. */
const VERIFICA_TODO = { rejectUnauthorized: true } as const

/**
 * Saca `sslmode` de la cadena y decide ACÁ la verificación del certificado.
 *
 * Existe por una advertencia que `pg-connection-string` escribe al parsear la cadena, y que no es
 * cosmética: hoy `sslmode=require` se trata como `verify-full` —se valida el certificado—, pero en
 * `pg` v9 va a adoptar la semántica de libpq, donde `require` cifra pero NO valida nada. O sea que
 * una actualización de dependencias debilitaría la conexión a la base sola, sin que nadie lo decida
 * y sin que se note: la app seguiría andando igual.
 *
 * Fijarlo acá resuelve las dos cosas. La validación queda explícita y deja de depender de qué
 * versión de `pg` esté instalada. Y el log se limpia: la advertencia sale UNA vez por proceso, que
 * en serverless es una por arranque en frío, y va por stderr —así que el panel de Vercel la cuenta
 * como error y pinta la invocación en rojo—. Un cron que corre cada cinco minutos sobre funciones
 * que se apagan entre corridas deja el log lleno de errores falsos, y ahí el error de verdad no se
 * encuentra.
 *
 * No se toca `DATABASE_URL`: la administra la integración de Neon en Vercel, que puede reescribirla
 * en cualquier momento y dejar el arreglo sin efecto.
 */
export function conSslExplicito(url: string): {
  cadena: string
  ssl: typeof VERIFICA_TODO | false
} {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    /* Cadena con formato propio (no URL): se deja intacta y se pide verificación igual. Neon y
       Supabase exigen TLS, así que es el valor correcto y no hay nada que adivinar. */
    return { cadena: url, ssl: VERIFICA_TODO }
  }

  const modo = parsed.searchParams.get('sslmode')?.trim().toLowerCase()
  parsed.searchParams.delete('sslmode')
  // Sólo tiene sentido junto a `sslmode`; suelto, deja la advertencia viva.
  parsed.searchParams.delete('uselibpqcompat')

  /* `disable` es la única salida sin TLS, y se respeta por si alguna vez esto corre contra un
     Postgres local. Cualquier otro valor —incluido no tener ninguno— verifica: ante la duda, la
     opción segura, que además es cómo se comporta hoy. */
  return { cadena: parsed.toString(), ssl: modo === 'disable' ? false : VERIFICA_TODO }
}

/**
 * La VERSIÓN de un caché: el `actualizado_en` más nuevo de la tabla, como texto y con la precisión
 * completa. Se embebe en el `select` de cada caché (`select ${VERSION_CACHE} as version from …`).
 *
 * Por qué no se lee como fecha, que sería lo obvio: `timestamptz` guarda MICROSEGUNDOS y el `Date`
 * de JavaScript sólo llega al milisegundo. Al leer el máximo como `Date` y volver a usarlo para
 * acotar las filas (`actualizado_en <= version`), la fila que PRODUJO ese máximo queda afuera de su
 * propia versión por los microsegundos que se perdieron al redondear.
 *
 * Y no es un caso de laboratorio: la fila con el `actualizado_en` más alto es, por definición, la
 * última que se modificó —justo la que alguien acaba de tocar en Monday y sale a buscar—. Medido
 * contra la base real: `10:56:29.463732` volvía como `10:56:29.463`, y ese cliente no llegaba nunca
 * al buscador. Ninguna corrida posterior lo rescataba, porque `actualizado_en` no se mueve si los
 * datos no cambian.
 *
 * `to_json` de un `timestamptz` emite ISO 8601 con microsegundos Y con el huso explícito
 * ("2026-09-23T07:56:29.463732-03:00"), así que vuelve a `::timestamptz` sin ambigüedad y sin
 * depender del huso del servidor. El `#>>'{}'` es lo que lo saca del JSON como texto pelado.
 */
export const VERSION_CACHE = `to_json(max(actualizado_en))#>>'{}'`

/**
 * Una consulta parametrizada. Los valores van SIEMPRE por `params` ($1, $2, …), nunca interpolados
 * en el texto: es lo que hace imposible una inyección SQL, y acá entran datos que vienen del token
 * de un usuario.
 */
export async function consultar<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await conexion().query(sql, params)
  return res.rows as T[]
}
