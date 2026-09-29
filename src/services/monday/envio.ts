/**
 * Los CONTACTOS a los que se les envía un documento (recibo, orden de pago, resumen de cta cte).
 *
 * El envío en sí ya no pasa por el tablero: lo despacha el escenario de Make con el PDF que generó la
 * app (ver `services/make/envioDocumento`). De Monday sólo hace falta saber a quién se le puede
 * mandar: los contactos de la persona y si declaran aceptar ESE documento en su "Para Enviar".
 */
import { CONTACTOS_INICIALES } from '@/data/mock'
import type { Contacto } from '@/types'
import { COL } from './columns'
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
    ...(nombre ? { primerNombre: nombre } : {}),
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
