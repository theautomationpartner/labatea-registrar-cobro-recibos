/**
 * `POST /api/facturas-cobranza` — las facturas pendientes de cobro de un conjunto de clientes, desde
 * el caché que mantiene el Cron Job (`api/cron/facturas-cobro.ts`). No consulta Monday.
 *
 * Es la segunda mitad de la GESTIÓN DE COBRANZA. La primera —qué cuentas corrientes cumplen el
 * criterio de saldo— la sigue resolviendo el navegador contra Monday, porque "🤖 Estado del Saldo"
 * es la fórmula que el usuario está filtrando y tiene que ser la del momento. Con esas cuentas en
 * mano, el navegador manda acá los clientes y los tramos pedidos, y recibe las facturas crudas
 * —como las devolvería Monday— para mapearlas con el mismo código que el RESUMEN DE CTA CTE.
 *
 * Devuelve además cuándo sincronizó el cron por última vez y si la última corrida falló: con eso el
 * navegador decide si confía en el caché o vuelve a consultar Monday directo.
 *
 * Detrás de las tres capas (`endpointDatos`): es la deuda de toda la cartera.
 */
import type { ServerResponse } from 'node:http'
import { endpointDatos, type Pedido } from './_http.js'
import { leerEstado, leerFacturas } from './_facturasCobroDb.js'

/**
 * Tope de clientes por pedido. Es de seguridad, no de negocio: el padrón entero son ~2700 clientes,
 * así que un pedido legítimo nunca se acerca. Un cuerpo con cien mil ids no llega a la base.
 */
const TOPE_CLIENTES = 10_000

interface Cuerpo {
  clienteIds?: unknown
  /** Índices de "🤖Estado de Vencimiento". Ausente o `null` = sin filtro de tramo. */
  tramos?: unknown
}

export default async function handler(req: Pedido, res: ServerResponse): Promise<void> {
  await endpointDatos<Cuerpo>(req, res, async ({ cuerpo }) => {
    const clienteIds = idsValidos(cuerpo?.clienteIds)
    const tramos = tramosValidos(cuerpo?.tramos)
    const [facturas, estado] = await Promise.all([
      leerFacturas(clienteIds, tramos),
      leerEstado(),
    ])
    return { facturas, sincronizado: estado.ultimo_ok, error: estado.error }
  })
}

/** Sólo ids de ítem de Monday (dígitos). Cualquier otra cosa se descarta en silencio. */
function idsValidos(valor: unknown): string[] {
  if (!Array.isArray(valor)) return []
  const ids = valor.map((v) => String(v ?? '').trim()).filter((v) => /^\d{1,20}$/.test(v))
  return [...new Set(ids)].slice(0, TOPE_CLIENTES)
}

/**
 * `null` = sin filtro. Un arreglo se acepta sólo con enteros chicos (los índices de una status):
 * un arreglo que llegara vacío por un error de armado NO se trata como "sin filtro" —devolvería toda
 * la deuda como si se la hubiera pedido— sino como "ningún tramo", que no devuelve nada.
 */
function tramosValidos(valor: unknown): number[] | null {
  if (valor === undefined || valor === null) return null
  if (!Array.isArray(valor)) return []
  return valor.filter((v): v is number => Number.isInteger(v) && v >= 0 && v < 100)
}
