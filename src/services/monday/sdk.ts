/**
 * Acceso a la API de Monday por HTTP contra su endpoint GraphQL.
 *
 * - En desarrollo se pega contra `/monday-api`, proxy de Vite hacia api.monday.com (evita CORS).
 *   El token sale de `.env.local` (VITE_MONDAY_TOKEN) y viaja en la Authorization.
 * - En producción se pega contra `/api/monday`, una Serverless Function (ver `api/monday.ts`)
 *   que inyecta el token del lado servidor (`MONDAY_TOKEN`). Así el token nunca se incrusta en
 *   el bundle del navegador.
 */
const TOKEN = (import.meta.env.VITE_MONDAY_TOKEN as string | undefined)?.trim() || undefined

const ENDPOINT = import.meta.env.DEV ? '/monday-api' : '/api/monday'
/**
 * Los archivos NO van al endpoint GraphQL común: Monday los recibe en `/v2/file`, por
 * multipart/form-data. Mismo esquema de proxy que el resto (Vite en desarrollo, función
 * serverless en producción), porque también necesita el token del servidor.
 */
const ENDPOINT_ARCHIVO = import.meta.env.DEV ? '/monday-api-file' : '/api/monday-upload'
const API_VERSION = '2024-10'

/**
 * En desarrollo hay acceso real a Monday sólo si hay token local; si no, los servicios usan mock.
 * En producción el proxy server-side siempre resuelve la autenticación, así que se asume habilitado
 * (requiere que `MONDAY_TOKEN` esté configurado en el entorno del deploy).
 */
export const mondayHabilitado = (): boolean => (import.meta.env.DEV ? Boolean(TOKEN) : true)

interface ApiError {
  message: string
}

/** Ejecuta una query/mutation GraphQL contra la API de Monday y devuelve `data`; lanza si falla. */
export async function mondayApi<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: TOKEN ?? '',
      'API-Version': API_VERSION,
    },
    body: JSON.stringify({ query, variables: variables ?? {} }),
  })
  if (!res.ok) throw new Error(`Monday API HTTP ${res.status}`)
  const json = (await res.json()) as { data?: T; errors?: ApiError[] }
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join(' · '))
  if (!json.data) throw new Error('Monday no devolvió datos.')
  return json.data
}

/**
 * Sube un archivo a una columna `file`. Es el ÚNICO camino: las columnas de archivo no se pueden
 * completar por `column_values` —ahí sólo viaja JSON—, hay que mandar el binario.
 *
 * El cuerpo va como multipart en el formato que documenta Monday: la `query` en una parte y el
 * binario en `variables[file]`, que es la variable `$file` de la mutación. El `Content-Type` NO se
 * setea a mano: lo arma el navegador con el `boundary` que corresponde.
 */
export async function mondaySubirArchivo<T>(query: string, archivo: File): Promise<T> {
  const form = new FormData()
  form.append('query', query)
  form.append('variables[file]', archivo, archivo.name)

  const res = await fetch(ENDPOINT_ARCHIVO, {
    method: 'POST',
    headers: { Authorization: TOKEN ?? '', 'API-Version': API_VERSION },
    body: form,
  })
  if (!res.ok) throw new Error(`Monday API (archivos) HTTP ${res.status}`)
  const json = (await res.json()) as { data?: T; errors?: ApiError[] }
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join(' · '))
  if (!json.data) throw new Error('Monday no devolvió datos al subir el archivo.')
  return json.data
}
