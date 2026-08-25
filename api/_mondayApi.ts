/**
 * Consultas a Monday hechas por el SERVIDOR, con su propio token.
 *
 * Distinto del proxy `/api/monday`, que reenvía lo que pide el navegador. Acá la consulta la
 * escribe el servidor y el cliente no la ve ni la puede cambiar. Es lo que hace falta para leer el
 * tablero de la lista blanca: es privado, sólo el token del servidor lo puede leer, y su contenido
 * —quién está habilitado— no tiene por qué viajar como una consulta que el cliente pueda modificar.
 */
const API_MONDAY = 'https://api.monday.com/v2'
const API_VERSION = '2024-10'

/** El error dice qué falló, sin filtrarse a la respuesta: quien llama decide qué contarle al cliente. */
export class ErrorMondayServidor extends Error {}

export async function mondayServidor<T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  /* `MONDAY_API_TOKEN` es el de solo lectura para la lista blanca; si no está, se usa el mismo del
     proxy. Tenerlos separados permite que la consulta que decide quién entra no lleve permisos de
     escritura, pero no obliga a configurar dos tokens para arrancar. */
  const token = (process.env.MONDAY_API_TOKEN ?? process.env.MONDAY_TOKEN)?.trim()
  if (!token) throw new ErrorMondayServidor('falta MONDAY_API_TOKEN / MONDAY_TOKEN')

  let res: Response
  try {
    res = await fetch(API_MONDAY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token,
        'API-Version': API_VERSION,
      },
      body: JSON.stringify({ query, variables }),
    })
  } catch (e) {
    throw new ErrorMondayServidor('no se pudo contactar a Monday: ' + (e as Error).message)
  }

  if (!res.ok) throw new ErrorMondayServidor('Monday respondió HTTP ' + res.status)

  const json = (await res.json()) as { data?: T; errors?: { message: string }[] }
  if (json.errors?.length) throw new ErrorMondayServidor(json.errors[0].message)
  if (!json.data) throw new ErrorMondayServidor('Monday no devolvió datos')
  return json.data
}
