/**
 * Cuentas bancarias PROPIAS de La Batea: dónde entra el dinero que se cobra. Las necesitan dos
 * medios de cobro —la transferencia (cuenta de destino) y la tarjeta (banco de acreditación)—, y
 * son la misma lista en los dos casos.
 */
import { CUENTAS_PROPIAS } from '@/data/mock'
import type { CuentaPropia } from '@/types'
import { BOARDS, COL } from './columns'
import { byId, valor, type MondayItem } from './parse'
import { mondayApi, mondayHabilitado } from './sdk'

/** Etiqueta de "Tipo de Config" que identifica las cuentas bancarias propias de La Batea. */
const CTA_PROPIA_LABEL = 'Ctas Bancarias Propias'

/** Tope de ítems del board de configuración que trae la consulta. */
const TOPE_CONFIG = 200

/**
 * Cuentas propias del board de configuración (18421035530): los ítems cuyo "Tipo de Config" es
 * "Ctas Bancarias Propias". El board mezcla configuraciones de todo tipo, así que el filtro por la
 * etiqueta es lo que separa las cuentas del resto; se devuelve sólo id y nombre, que es lo único
 * que el selector muestra y lo único que la relación del recibo necesita.
 *
 * Sin token (modo local) devuelve el mock, igual que el resto de los servicios.
 */
export async function getCuentasBancariasPropias(): Promise<CuentaPropia[]> {
  if (!mondayHabilitado()) return CUENTAS_PROPIAS

  const data = await mondayApi<{ boards: { items_page: { items: MondayItem[] } }[] }>(
    `query {
      boards(ids: [${BOARDS.config}]) {
        items_page(limit: ${TOPE_CONFIG}) {
          items {
            id name
            column_values(ids: ["${COL.config.tipo}"]) { id text }
          }
        }
      }
    }`,
  )

  return (data.boards?.[0]?.items_page.items ?? [])
    .filter((item) => valor(byId(item)[COL.config.tipo]) === CTA_PROPIA_LABEL)
    .map((item) => ({ id: item.id, name: item.name }))
}
