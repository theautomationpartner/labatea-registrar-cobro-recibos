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

  pool = new Pool({
    connectionString: url,
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  })
  return pool
}

/**
 * Una consulta parametrizada. Los valores van SIEMPRE por `params` ($1, $2, …), nunca interpolados
 * en el texto: es lo que hace imposible una inyección SQL, y acá entran datos que vienen del token
 * de un usuario.
 */
export async function consultar<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await conexion().query(sql, params)
  return res.rows as T[]
}
