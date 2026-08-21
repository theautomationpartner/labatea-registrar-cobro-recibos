/**
 * Envío del recibo al cliente. La app NO manda el mail ni el WhatsApp: deja el recibo listo en el
 * tablero y una automatización de Monday lo despacha. El circuito son cuatro pasos:
 *
 *   1. verificar que el PDF ya exista en su columna file (sin documento no hay nada que enviar);
 *   2. escribir el medio elegido en "✋Enviar por:" y los contactos en "🤖Contactos";
 *   3. poner "🤖Estado de Emision" en "Enviar", que es lo que dispara la automatización;
 *   4. seguir esa misma columna hasta que el tablero la cierre en "Enviado" o "Error - Enviar".
 *
 * Es el mismo esquema que usa la emisión (`pedirEmision` + `getEstadoEmision`): la app escribe
 * una sola vez y después sólo mira.
 */
import { CONTACTOS_INICIALES } from '@/data/mock'
import type { Contacto, MedioEnvio } from '@/types'
import {
  BOARDS,
  COL,
  ENVIO_RECIBO_FINALES,
  ENVIO_RECIBO_INDEX,
  MEDIO_ENVIO_IDS,
} from './columns'
import { byId, type MondayItem } from './parse'
import { mondayApi, mondayHabilitado } from './sdk'

/* ===== Contactos del cliente ===== */

/** Normaliza para comparar sin tildes ni mayúsculas: los rótulos del board no son estables. */
const norm = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

function mapContacto(item: MondayItem, documento: string): Contacto {
  const c = byId(item)
  const paraEnviar = c[COL.contacto.paraEnviar]?.text ?? ''
  // Acepta el documento si su nombre figura entre los valores de "Para Enviar".
  const ok = norm(paraEnviar).includes(norm(documento))

  /* El nombre se arma con las columnas Nombre + Apellido del board, no con el `name` del ítem
     (que suele traer la empresa). Si ninguna vino cargada, se cae al nombre del ítem. */
  const nombre = (c[COL.contacto.nombre]?.text ?? '').trim()
  const apellido = (c[COL.contacto.apellido]?.text ?? '').trim()
  const completo = [nombre, apellido].filter(Boolean).join(' ') || item.name

  return {
    id: c[COL.contacto.codigo]?.text || item.id,
    itemId: item.id,
    name: completo,
    phone: c[COL.contacto.telefono]?.text ?? '',
    email: c[COL.contacto.email]?.text ?? '',
    // Iniciales: la del nombre y la del apellido cuando existen.
    ini: completo
      .split(' ')
      .filter(Boolean)
      .map((p) => p[0])
      .slice(0, 2)
      .join('')
      .toUpperCase(),
    color: '#0073ea',
    status: ok ? `ACEPTA ${documento.toUpperCase()}` : `NO ACEPTA ${documento.toUpperCase()}`,
    ok,
  }
}

/** Resultados ya resueltos, por cliente y documento. Ver `getContactosCliente`. */
const cacheContactos = new Map<string, Promise<Contacto[]>>()

async function getContactosClienteImpl(clienteId: string, documento: string): Promise<Contacto[]> {
  if (!mondayHabilitado()) return CONTACTOS_INICIALES
  const data = await mondayApi<{ items: MondayItem[] }>(
    `query ($ids: [ID!]) {
      items(ids: $ids) {
        column_values(ids: ["${COL.cliente.contactos}"]) {
          ... on BoardRelationValue {
            linked_items {
              id name
              column_values(ids: ["${COL.contacto.codigo}","${COL.contacto.nombre}","${COL.contacto.apellido}","${COL.contacto.email}","${COL.contacto.telefono}","${COL.contacto.paraEnviar}"]) { id text }
            }
          }
        }
      }
    }`,
    { ids: [clienteId] },
  )
  const linked = data.items[0]?.column_values[0]?.linked_items ?? []
  return linked.map((it) => mapContacto(it, documento))
}

/**
 * Contactos del cliente (columna conectada `account_contact`), clasificados según si aceptan el
 * documento. `documento` es el texto que el contacto declara en su "Para Enviar" ("Recibo").
 *
 * CACHEADO por cliente y documento: volver a la etapa con el stepper reutiliza el resultado, sin
 * pegarle de nuevo a Monday ni parpadear el "Cargando contactos…" —que además taparía el
 * "Enviado exitosamente"—. Un error no queda cacheado: se reintenta en la próxima entrada.
 */
export function getContactosCliente(clienteId: string, documento = 'Recibo'): Promise<Contacto[]> {
  const clave = `${clienteId}·${documento}`
  const cacheado = cacheContactos.get(clave)
  if (cacheado) return cacheado
  const pedido = getContactosClienteImpl(clienteId, documento).catch((e) => {
    cacheContactos.delete(clave)
    throw e
  })
  cacheContactos.set(clave, pedido)
  return pedido
}

/* ===== Envío ===== */

/**
 * ¿El PDF del recibo ya está en su columna file? La automatización lo genera después de emitir, y
 * hasta que no exista no hay documento que despachar.
 */
export async function reciboPdfGenerado(itemId: string): Promise<boolean> {
  if (!mondayHabilitado()) return true
  const data = await mondayApi<{ items: MondayItem[] }>(
    `query ($id: [ID!]) {
      items(ids: $id) { id column_values(ids: ["${COL.cobro.pdf}"]) { id text } }
    }`,
    { id: [itemId] },
  )
  const item = data.items?.[0]
  const archivo = item ? byId(item)[COL.cobro.pdf]?.text ?? '' : ''
  return archivo.trim() !== ''
}

/**
 * Paso 2: deja escrito A QUIÉNES y POR DÓNDE se envía.
 *
 * Las dos cosas viajan en UNA sola mutación porque son el mismo dato para la automatización: el
 * destino del documento. Escribirlas por separado abría un estado intermedio —el medio puesto y los
 * destinatarios no— en el que un envío disparado justo ahí saldría sin saber a quién.
 *
 * El medio se manda por ID de etiqueta (ver `MEDIO_ENVIO_IDS`); "Ambos" son las dos, porque la
 * columna del tablero es multi-valor. Los contactos van como relación al board de Contactos.
 */
export async function asignarDestinoEnvio(
  itemId: string,
  medio: MedioEnvio,
  contactoIds: readonly string[] = [],
): Promise<void> {
  if (!mondayHabilitado()) return

  const cv: Record<string, unknown> = { [COL.cobro.enviarPor]: { ids: MEDIO_ENVIO_IDS[medio] } }
  /* Sólo ids numéricos válidos: la relación los pide como números, y uno que no lo sea haría
     rebotar la mutación entera —con ella, el envío—. */
  const ids = contactoIds
    .map((id) => Number(id))
    .filter((n) => Number.isFinite(n) && n > 0)
  // Sin destinatarios se OMITE la columna, igual que el resto de la capa: no se manda vacía.
  if (ids.length > 0) cv[COL.cobro.contactos] = { item_ids: ids }

  await mondayApi(
    `mutation ($id: ID!, $board: ID!, $cv: JSON!) {
      change_multiple_column_values(item_id: $id, board_id: $board, column_values: $cv) { id }
    }`,
    { id: itemId, board: BOARDS.cobros, cv: JSON.stringify(cv) },
  )
}

/** Paso 3: pone el estado en "Enviar". Ese cambio es el que dispara el envío del tablero. */
export async function dispararEnvioRecibo(itemId: string): Promise<void> {
  if (!mondayHabilitado()) return
  await mondayApi(
    `mutation ($id: ID!, $board: ID!, $cv: JSON!) {
      change_multiple_column_values(item_id: $id, board_id: $board, column_values: $cv) { id }
    }`,
    {
      id: itemId,
      board: BOARDS.cobros,
      cv: JSON.stringify({ [COL.cobro.estadoEmision]: { index: ENVIO_RECIBO_INDEX.enviar } }),
    },
  )
}

/** Estado del envío tal como lo reporta el tablero: el índice decide, la etiqueta se muestra. */
export interface EstadoEnvioRecibo {
  index: number | null
  label: string
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function getEstadoEnvio(itemId: string): Promise<EstadoEnvioRecibo> {
  const data = await mondayApi<{ items: MondayItem[] }>(
    `query ($id: [ID!]) {
      items(ids: $id) {
        id
        column_values(ids: ["${COL.cobro.estadoEmision}"]) { id text ... on StatusValue { index } }
      }
    }`,
    { id: [itemId] },
  )
  const item = data.items?.[0]
  const cv = item ? byId(item)[COL.cobro.estadoEmision] : undefined
  return { index: cv?.index ?? null, label: cv?.text?.trim() ?? '' }
}

/**
 * Paso 4: espera a que la automatización cierre el envío, informando por `onEstado` cada cambio de
 * etiqueta —es lo que se le muestra al usuario, para que la pantalla diga lo mismo que el board—.
 *
 * Devuelve el índice final. Si se agotan los intentos devuelve el último visto: no se inventa un
 * "enviado" que el tablero nunca confirmó.
 *
 * En modo local no hay automatización: simula el ciclo y responde "Enviado", así el prototipo se
 * puede recorrer entero sin cuenta de Monday.
 */
export async function seguirEnvioRecibo(
  itemId: string,
  onEstado: (estado: string) => void,
  { intentos = 30, intervalo = 2000 }: { intentos?: number; intervalo?: number } = {},
): Promise<number | null> {
  if (!mondayHabilitado()) {
    onEstado('Enviando')
    await esperar(1200)
    onEstado('Enviado')
    return ENVIO_RECIBO_INDEX.enviado
  }
  let ultimo: number | null = null
  let ultimaEtiqueta = ''
  for (let i = 0; i < intentos; i++) {
    const { index, label } = await getEstadoEnvio(itemId)
    if (label && label !== ultimaEtiqueta) {
      ultimaEtiqueta = label
      onEstado(label)
    }
    ultimo = index
    if (index !== null && ENVIO_RECIBO_FINALES.includes(index)) return index
    await esperar(intervalo)
  }
  return ultimo
}
