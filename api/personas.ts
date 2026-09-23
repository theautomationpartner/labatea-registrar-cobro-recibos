/**
 * `POST /api/personas` — el padrón cacheado, para buscar clientes y proveedores sin consultar Monday.
 *
 * Lo que devuelve sale de la base, no de Monday: la llena el Cron Job de la app de operaciones de
 * venta (ver `api/_padronDb.ts`), que comparte con ésta el tablero de Personas y la base de Neon.
 * Esta app no tiene cron de personas propio a propósito: reusa lo que aquél ya cachea.
 *
 * Mismo contrato que el `/api/personas` de aquella app, para que los dos navegadores hablen igual:
 *
 *   · `categoria` — `'cliente'` o `'proveedor'`. Es el primer cerrojo: el buscador de COBROS nunca
 *     recibe a un proveedor, y el de PAGOS nunca a un cliente. El segundo lo pone el navegador al
 *     indexar (`lib/busquedaPersonas`).
 *   · `desde` — la versión que el navegador ya tiene. Con ella sólo vuelve lo que cambió; en
 *     régimen, dos arreglos vacíos.
 *
 * Detrás de las tres capas de siempre (`endpointDatos`: firma + lista blanca + segundo factor): es
 * la cartera entera de clientes y proveedores con sus saldos, no un catálogo público.
 */
import type { ServerResponse } from 'node:http'
import { endpointDatos, type Pedido } from './_http.js'
import { leerDelta, leerEstado } from './_padronDb.js'

/**
 * Las categorías que se pueden pedir. Lista cerrada: un typo ("clientes" en plural) tiene que caer
 * en "todas" —y que el cerrojo del navegador filtre— y no devolver cero personas en silencio.
 */
const CATEGORIAS = ['cliente', 'proveedor'] as const

interface Cuerpo {
  desde?: string
  categoria?: string
}

export default async function handler(req: Pedido, res: ServerResponse): Promise<void> {
  await endpointDatos<Cuerpo>(req, res, async ({ cuerpo }) => {
    /* Un `desde` basura no puede hacer que la consulta devuelva vacío y el navegador concluya que
       el padrón no tiene a nadie: ante la duda, todo. */
    const desde = fechaValida(cuerpo?.desde)
    const categoria = categoriaValida(cuerpo?.categoria)
    const [delta, estado] = await Promise.all([leerDelta(desde, categoria), leerEstado()])

    return {
      version: delta.version,
      categoria,
      /* Si lo que llega REEMPLAZA el padrón del navegador o se le suma. Sin esto, un delta vacío
         sería indistinguible de un padrón vacío. */
      completo: desde === null,
      personas: delta.personas,
      bajas: delta.bajas,
      /* Cuándo sincronizó por última vez el cron y si la última corrida falló: el navegador lo usa
         para no presentar un padrón roto como "no hay coincidencias". */
      sincronizado: estado.ultimo_ok,
      error: estado.error,
    }
  })
}

function fechaValida(valor: string | undefined): string | null {
  if (typeof valor !== 'string' || !valor.trim()) return null
  return Number.isFinite(Date.parse(valor)) ? valor : null
}

function categoriaValida(valor: string | undefined): string | null {
  const v = valor?.trim().toLowerCase()
  return CATEGORIAS.find((c) => c === v) ?? null
}
