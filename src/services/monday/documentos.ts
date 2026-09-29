/**
 * Las piezas de Monday que comparten el RECIBO y la ORDEN DE PAGO desde que su PDF lo genera la app:
 *
 *   1. el NÚMERO con el que va a nacer el documento, que el PDF necesita ANTES de que el ítem exista;
 *   2. el número REAL que le dio Monday al crearlo, para confirmar que coincide con el del PDF;
 *   3. la subida del PDF a la columna file del ítem, al registrar.
 *
 * Es el mismo esquema que el presupuesto de la app de operaciones de venta
 * (`getProximoNroPresupuesto` y `adjuntarPdfPresupuesto`).
 */
import { byId, type MondayItem } from './parse'
import { siguienteNroSerie } from './retencionGanancias'
import { mondayApi, mondayHabilitado, mondaySubirArchivo } from './sdk'

/**
 * Con qué número va a nacer el próximo ítem del tablero: se lee el de la ÚLTIMA fila creada
 * ("RECIBO-124") y se le suma uno, conservando prefijo y ceros ("RECIBO-125").
 *
 * Es una PREDICCIÓN, no una reserva: el número definitivo lo asigna Monday con su propio contador al
 * crear el ítem. Por eso se lee al EMITIR —y no al arrancar la operación—, para achicar la ventana en
 * la que otro documento puede ganarle el número; y por eso, al registrar, se compara con el real
 * (`leerNroDocumento`).
 *
 * `null` = no hay de dónde sacarlo (el tablero está vacío o el código no termina en dígitos).
 */
export async function getProximoNroDocumento(board: number, columna: string): Promise<string | null> {
  const data = await mondayApi<{ boards: { items_page: { items: MondayItem[] } }[] }>(
    `query {
      boards(ids: [${board}]) {
        items_page(limit: 1, query_params: {order_by: [{column_id: "__creation_log__", direction: desc}]}) {
          items { id column_values(ids: ["${columna}"]) { id text } }
        }
      }
    }`,
  )
  const ultimo = data.boards?.[0]?.items_page?.items?.[0]
  const codigo = ultimo ? (byId(ultimo)[columna]?.text?.trim() ?? '') : ''
  return codigo ? siguienteNroSerie(codigo) : null
}

/** El número que Monday le asignó a un ítem ya creado ("RECIBO-125"). `''` si no se pudo leer. */
export async function leerNroDocumento(itemId: string, columna: string): Promise<string> {
  if (!mondayHabilitado()) return ''
  const data = await mondayApi<{ items: MondayItem[] }>(
    `query ($id: [ID!]) { items(ids: $id) { id column_values(ids: ["${columna}"]) { id text } } }`,
    { id: [itemId] },
  )
  const item = data.items?.[0]
  return item ? (byId(item)[columna]?.text?.trim() ?? '') : ''
}

/**
 * Sube un archivo a una columna `file` del ítem. El id va INLINE en la mutación —en un multipart la
 * única variable es el archivo—, así que se exige que sea numérico y no un texto cualquiera metido en
 * la query.
 *
 * Devuelve el archivo subido: su `url` es el enlace PERMANENTE del asset en Monday (pide sesión), el
 * que se puede dejar escrito en otro lado —el `public_url` vence a la hora—. `null` sin Monday.
 */
export async function subirArchivoAColumna(
  itemId: string,
  columna: string,
  archivo: File,
): Promise<ArchivoSubido | null> {
  if (!mondayHabilitado()) return null
  const id = Number(itemId)
  if (!Number.isFinite(id) || id <= 0) throw new Error(`Id de ítem inválido: ${itemId}`)
  const data = await mondaySubirArchivo<{ add_file_to_column: { id: string; name?: string; url?: string } | null }>(
    `mutation ($file: File!) {
      add_file_to_column(item_id: ${id}, column_id: "${columna}", file: $file) { id name url }
    }`,
    archivo,
  )
  const asset = data?.add_file_to_column
  return asset ? { id: String(asset.id), nombre: asset.name || archivo.name, url: asset.url ?? '' } : null
}

/** Un archivo ya subido a una columna `file`. */
export interface ArchivoSubido {
  id: string
  nombre: string
  url: string
}

/** Escribe columnas de un ítem en UNA mutación. */
export async function escribirColumnas(
  itemId: string,
  board: number,
  columnas: Record<string, unknown>,
): Promise<void> {
  if (!mondayHabilitado()) return
  await mondayApi(
    `mutation ($id: ID!, $board: ID!, $cv: JSON!) {
      change_multiple_column_values(item_id: $id, board_id: $board, column_values: $cv) { id }
    }`,
    { id: itemId, board, cv: JSON.stringify(columnas) },
  )
}
