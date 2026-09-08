/**
 * Búsqueda del PROVEEDOR contra el board de Personas de Monday (18420688238), el MISMO tablero del
 * que salen los clientes.
 *
 * No hay un board de proveedores: en el sistema una persona es cliente o proveedor según su
 * "✋Categoria", y todo lo demás —código, CUIT, condición fiscal, condición de pago, cuenta
 * corriente— son exactamente las mismas columnas. Por eso acá no se vuelve a escribir ni la
 * consulta ni el mapeo: los dos salen de `./clientes`, y lo único propio de este archivo es la
 * regla de categoría y el dato con el que la etapa 1 decide si se puede operar (`tieneCtaCte`).
 *
 * LECTURA PURA. Este módulo no escribe una sola columna del tablero.
 */
import { PROVEEDORES } from '@/data/mock'
import type { Proveedor } from '@/types'
import {
  buscarPersonasPorTermino,
  filtrarPersonasEnMemoria,
  getPersonaItemPorId,
  mapPersona,
  reglasDePersona,
} from './clientes'
import { CATEGORIA_PROVEEDOR_INDEX, COL, COL_CHEQUE_USADO } from './columns'
import { byId, type MondayItem } from './parse'
import { mondayApi, mondayHabilitado } from './sdk'

/**
 * Reglas que TODA búsqueda de proveedores arrastra: la persona tiene que ser de categoría
 * "Proveedores" y estar ACTIVA. Van por ÍNDICE de etiqueta y resueltas EN EL SERVIDOR, con el mismo
 * criterio que las de clientes (ver `REGLAS_CLIENTE_OPERABLE`).
 */
const REGLAS_PROVEEDOR_OPERABLE = reglasDePersona(CATEGORIA_PROVEEDOR_INDEX)

/**
 * La persona tiene su cuenta corriente conectada.
 *
 * Se mira "💵Cta Cte" (board_relation_mm5ep5qd), que es la MISMA columna para clientes y
 * proveedores: el tablero de facturas de compra la espeja como "🤖Cta Cte Prov"
 * (`COL.factCompra.ctaCteProveedor`), así que ésa es la cuenta corriente de proveedor del sistema.
 *
 * Sin ítem vinculado no hay cuenta: es lo que frena la operación cuando el proveedor opera en
 * CUENTA CORRIENTE (ver `proveedorSinCtaCte` en `lib/pagosProveedor`).
 */
const tieneCtaCteConectada = (item: MondayItem): boolean =>
  (byId(item)[COL.cliente.ctaCte]?.linked_items?.length ?? 0) > 0

/**
 * Una fila de Personas → el proveedor de la app: el mapeo común más lo propio del módulo.
 *
 * Las CATEGORÍAS no se calculan acá: las trae `mapPersona`, porque son el dato con el que los dos
 * módulos deciden si la persona sirve (ver `lib/personas`) y leerlas dos veces habría abierto la
 * puerta a que un lado las interpretara distinto del otro.
 */
const mapProveedor = (item: MondayItem): Proveedor => ({
  ...mapPersona(item),
  tieneCtaCte: tieneCtaCteConectada(item),
})

/**
 * Busca proveedores por nombre, código o CUIT/CUIL (entero o parcial), con los mismos criterios y
 * la misma experiencia que el buscador de clientes: un término numérico se busca a la vez por
 * código y por CUIT; uno con letras, por nombre.
 *
 * La categoría ("Proveedores") y el estado ACTIVO ya vienen aplicados en la consulta: lo que llega
 * es directamente operable, y un proveedor inactivo se comporta como inexistente.
 */
export async function buscarProveedores(termino: string): Promise<Proveedor[]> {
  const t = termino.trim()
  if (!t) return []

  // Modo local: el mock es chico, así que se filtra en memoria con el mismo criterio.
  if (!mondayHabilitado()) return filtrarPersonasEnMemoria(PROVEEDORES, t)

  return (await buscarPersonasPorTermino(t, REGLAS_PROVEEDOR_OPERABLE)).map(mapProveedor)
}

/**
 * El proveedor al que se le endosó un cheque, resuelto a partir del cheque mismo.
 *
 * La cadena es cheque → facturas de compra → proveedor, y la recorre UNA sola consulta anidando dos
 * niveles de `linked_items`:
 *
 *   1. del ítem del cheque sale "🗒️ Facturas Compras" (`board_relation_mm7098sj`), las facturas
 *      que ese cheque pagó;
 *   2. de la factura sale "🤖 Proveedor" (`board_relation_mm6kpn8`), la persona a la que se le
 *      compró.
 *
 * Se toma la PRIMERA factura conectada aunque haya varias: un cheque puede haber cancelado más de
 * una, pero todas son del mismo proveedor —a un tercero no se le endosa el mismo papel—, así que
 * recorrerlas todas daría siempre la misma respuesta. Si algún día no fuera así, el que llama se
 * enteraría por el proveedor equivocado y no por un error, y por eso queda dicho acá.
 *
 * Con la persona identificada se la lee ENTERA con la misma consulta del buscador
 * (`getPersonaItemPorId`): la ficha tiene que verse igual se haya buscado a mano o resuelto sola.
 *
 * Devuelve `null` cuando la cadena se corta —el cheque sin facturas conectadas, o la factura sin
 * proveedor—: es un dato que falta en el tablero, no un error de la app, y la pantalla lo dice y
 * deja seguir por otro camino. En modo local (sin token) devuelve el primer proveedor del mock,
 * para que el prototipo se recorra entero.
 */
export async function getProveedorDelCheque(chequeId: string): Promise<Proveedor | null> {
  if (!chequeId) return null
  if (!mondayHabilitado()) return PROVEEDORES[0] ?? null

  const data = await mondayApi<{ items: MondayItem[] }>(
    `query {
      items(ids: [${Number(chequeId)}]) {
        id
        column_values(ids: ["${COL_CHEQUE_USADO.facturasCompra}"]) {
          id
          ... on BoardRelationValue {
            linked_items {
              id
              column_values(ids: ["${COL.factCompraDoc.proveedor}"]) {
                id
                ... on BoardRelationValue { linked_items { id } }
              }
            }
          }
        }
      }
    }`,
  )

  const cheque = data.items?.[0]
  if (!cheque) return null
  const factura = byId(cheque)[COL_CHEQUE_USADO.facturasCompra]?.linked_items?.[0]
  if (!factura) return null
  const personaId = byId(factura)[COL.factCompraDoc.proveedor]?.linked_items?.[0]?.id
  if (!personaId) return null

  const item = await getPersonaItemPorId(personaId)
  return item ? mapProveedor(item) : null
}
