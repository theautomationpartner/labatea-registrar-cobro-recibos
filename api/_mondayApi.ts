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

  const json = (await res.json()) as { data?: T; errors?: ErrorGraphQL[] }
  if (json.errors?.length) throw deError(json.errors[0])
  if (!json.data) throw new ErrorMondayServidor('Monday no devolvió datos')
  return json.data
}

/* ── Límite por minuto de un campo ───────────────────────────────────────────────────────────── */

/** Un error de GraphQL con lo que Monday agrega cuando el que se agotó es el cupo de un campo. */
interface ErrorGraphQL {
  message: string
  extensions?: { code?: string; retry_in_seconds?: number }
}

/**
 * Cuántos segundos hay que esperar antes de reintentar, o `null` si el error no es un límite.
 *
 * Monday tiene un cupo POR CAMPO Y POR MINUTO aparte del límite general de la cuenta, y el que se
 * agota primero acá es `display_value`: es el único que devuelve el valor calculado de una fórmula
 * o una mirror, y cada factura pendiente de cobro trae dos columnas de ese tipo (el cobrado y el
 * pendiente). Mismo helper que el cron del padrón en la app de ventas.
 */
function esperaPorLimite(e: ErrorGraphQL): number | null {
  if (!e.extensions?.code?.includes('RATE_LIMIT')) return null
  /* El `retry_in_seconds` viene del servidor; el default cubre el caso de que no lo mande. Se le
     suma un segundo porque la ventana es de minuto redondo: reintentar en el borde exacto vuelve
     a caer del lado equivocado. */
  return (e.extensions.retry_in_seconds ?? 15) + 1
}

/**
 * El error de GraphQL como excepción. El del cupo por minuto sale distinguible —y con su espera—
 * para que `mondayServidorConEspera` lo pueda reintentar; todo lo demás es un fallo común.
 */
function deError(e: ErrorGraphQL): ErrorMondayServidor {
  const segundos = esperaPorLimite(e)
  return segundos === null
    ? new ErrorMondayServidor(e.message)
    : new ErrorLimiteCampo(e.message, segundos)
}

const dormir = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Como `mondayServidor`, pero esperando y reintentando cuando Monday contesta que se agotó el cupo
 * por minuto de un campo.
 *
 * Es para el CRON y sólo para el cron: ahí nadie está esperando la respuesta, así que dormir veinte
 * segundos y volver a pedir es gratis. En un endpoint que atiende al navegador sería al revés —el
 * usuario se come la espera—, y por eso `mondayServidor` sigue fallando de una.
 *
 * `agotado` no se traga el error: si después de todos los intentos el cupo sigue cerrado, se
 * propaga. La corrida falla, la marca NO avanza y la siguiente reintoma el mismo tramo.
 */
export async function mondayServidorConEspera<T>(
  query: string,
  variables: Record<string, unknown>,
  intentos = 4,
): Promise<T> {
  for (let intento = 0; ; intento++) {
    try {
      return await mondayServidor<T>(query, variables)
    } catch (e) {
      const segundos = e instanceof ErrorLimiteCampo ? e.segundos : null
      if (segundos === null || intento >= intentos) throw e
      console.warn(`[monday] cupo por minuto agotado: se reintenta en ${segundos}s`)
      await dormir(segundos * 1000)
    }
  }
}

/** El error que sí se puede reintentar: el cupo por minuto de un campo, con su espera. */
export class ErrorLimiteCampo extends ErrorMondayServidor {
  constructor(
    message: string,
    readonly segundos: number,
  ) {
    super(message)
  }
}
