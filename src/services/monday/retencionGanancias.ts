/**
 * Los dos datos que la RETENCIÓN DE GANANCIAS necesita de Monday y que no están en la operación:
 * sus parámetros de configuración y si al proveedor ya se le descontó la base no imponible este mes.
 *
 * LECTURA PURA: la retención no escribe nada acá. Lo único que se escribe es su línea en la orden de
 * pago (ver `./ordenPago`), y de ESA línea sale después la respuesta a "¿ya se aplicó este mes?".
 */
import { NRO_RETENCION_MOCK, PARAMETROS_RETENCION_MOCK } from '@/data/mock'
import { BOARDS, CAJA_PAGO_INDEX, COL } from './columns'
import { byId, num, valor, type MondayItem } from './parse'
import { mondayApi, mondayHabilitado } from './sdk'

/** Tope de ítems del board de configuración que trae la consulta. Mismo criterio que las cuentas. */
const TOPE_CONFIG = 200

/** Tope de órdenes del proveedor que se revisan para saber si ya hubo retención este mes. */
const TOPE_ORDENES = 100

/**
 * El número que sigue en una serie con prefijo: "RETENC-004" → "RETENC-005".
 *
 * Conserva el ANCHO de lo que leyó en vez de aplicar un relleno propio: el tablero muestra tres
 * dígitos aunque su configuración diga dos, así que la única fuente confiable de cómo se ve la serie
 * es la serie misma. Si el número desborda el ancho (999 → 1000), crece; no se recorta.
 *
 * Devuelve `null` si el texto no termina en dígitos: sin una serie que continuar, inventar un
 * formato sería peor que no escribir nada.
 */
export function siguienteNroSerie(actual: string): string | null {
  const partes = /^(.*?)(\d+)\s*$/.exec(actual.trim())
  if (!partes) return null
  const [, prefijo, digitos] = partes
  const siguiente = String(Number(digitos) + 1)
  return `${prefijo}${siguiente.padStart(digitos.length, '0')}`
}

/**
 * Con qué número va a nacer la próxima retención en "🔃Retenciones": se lee el de la ÚLTIMA fila
 * creada y se le suma uno.
 *
 * Es una PREDICCIÓN, no una reserva. La fila del tablero la crea una automatización después, y su
 * "🤖ID Retencion" se lo asigna Monday con su propio contador; acá se anticipa ese valor para
 * dejarlo escrito en la línea de la orden. Dos operaciones simultáneas —o una fila creada a mano
 * entre medio— pueden hacer que el número real termine siendo otro.
 *
 * `null` = no hay de dónde sacarlo (el tablero está vacío, la columna vino sin valor o el código no
 * termina en dígitos). En ese caso la línea se escribe SIN el número, que es preferible a estampar
 * uno inventado que después choque con el real.
 */
export async function getProximoNroRetencion(): Promise<string | null> {
  if (!mondayHabilitado()) return NRO_RETENCION_MOCK

  const data = await mondayApi<{ boards: { items_page: { items: MondayItem[] } }[] }>(
    `query {
      boards(ids: [${BOARDS.retenciones}]) {
        items_page(
          limit: 1,
          query_params: {order_by: [{column_id: "__creation_log__", direction: desc}]}
        ) {
          items {
            id
            column_values(ids: ["${COL.retencion.nro}"]) { id text }
          }
        }
      }
    }`,
  )

  const ultima = data.boards?.[0]?.items_page.items?.[0]
  if (!ultima) return null
  const codigo = byId(ultima)[COL.retencion.nro]?.text?.trim() ?? ''
  return codigo ? siguienteNroSerie(codigo) : null
}

/**
 * Los dos parámetros del cálculo, tal como están en el tablero. Se devuelven CRUDOS —incluso
 * inválidos— a propósito: quién decide si sirven es la regla de negocio (`calcularRetencionGAN`),
 * que además necesita mostrar el valor leído para que se pueda depurar.
 *
 * `null` = la columna vino vacía. Es distinto de un cero, y los dos son inválidos por motivos
 * distintos que el mensaje de error nombra por separado.
 */
export interface ParametrosRetencion {
  /** "Base NO imponible" (numeric_mm6m9qr): el tramo que no tributa. */
  baseNoImponible: number | null
  /** "Alicuota %" (numeric_mm6mf3cm): el porcentaje que se aplica a la base imponible. */
  alicuota: number | null
  /**
   * Id de la fila de configuración de la que salieron los dos números. Viaja hasta el subelemento
   * de la orden para dejar asentado CON QUÉ parámetros se retuvo: si mañana cambian la alícuota,
   * las retenciones ya emitidas siguen apuntando a los valores con los que se practicaron.
   *
   * `null` = no se encontró la fila, y entonces tampoco hay parámetros.
   */
  itemId: string | null
}

/**
 * Etiqueta de "Tipo de Config" que identifica la fila con los parámetros de la retención. El board
 * mezcla configuraciones de todo tipo —de ahí salen también las cuentas propias—, y esta columna es
 * la que las separa, con el mismo criterio que `CTA_PROPIA_LABEL` en `./cuentas`.
 */
const RETENCION_GAN_LABEL = 'Retencion GAN'

/**
 * Parámetros de la retención, de la fila "Retencion GAN" del board "⚙️Configuracion - Sistema"
 * (18421035530).
 *
 * Si esa fila no existe —o existe con sus dos columnas vacías— los parámetros vuelven en `null` y el
 * cálculo se frena con su mensaje, que nombra el valor leído. Es a propósito que no se busque "la
 * primera fila que tenga algo": los parámetros de una retención tienen que venir de la fila que el
 * tablero declara como suya, no de cualquiera que casualmente tenga esas columnas cargadas.
 */
export async function getParametrosRetencion(): Promise<ParametrosRetencion> {
  if (!mondayHabilitado()) return PARAMETROS_RETENCION_MOCK

  const data = await mondayApi<{ boards: { items_page: { items: MondayItem[] } }[] }>(
    `query {
      boards(ids: [${BOARDS.config}]) {
        items_page(limit: ${TOPE_CONFIG}) {
          items {
            id name
            column_values(ids: ["${COL.config.tipo}","${COL.config.baseNoImponible}","${COL.config.alicuotaGanancias}"]) {
              id text
            }
          }
        }
      }
    }`,
  )

  const fila = (data.boards?.[0]?.items_page.items ?? []).find(
    (item) => valor(byId(item)[COL.config.tipo]).trim() === RETENCION_GAN_LABEL,
  )
  if (!fila) return { baseNoImponible: null, alicuota: null, itemId: null }

  const c = byId(fila)
  const base = c[COL.config.baseNoImponible]?.text?.trim() ?? ''
  const alicuota = c[COL.config.alicuotaGanancias]?.text?.trim() ?? ''
  return {
    baseNoImponible: base === '' ? null : num(base),
    alicuota: alicuota === '' ? null : num(alicuota),
    itemId: fila.id,
  }
}

/** Año y mes de una fecha ISO ("2026-08-27" → "2026-08"). Es la clave del período. */
const periodoDe = (iso: string): string => iso.slice(0, 7)

/**
 * ¿Al proveedor YA se le descontó la base no imponible en el mes en curso?
 *
 * Se DERIVA de las órdenes de pago ya emitidas en vez de guardarse en una bandera: se buscan las
 * órdenes de ese proveedor y se mira si alguna, creada este mes, tiene una línea de retención de
 * Ganancias. Si la hay, la base no imponible ya se consumió.
 *
 * Se eligió así sobre una columna en Personas por tres motivos:
 *
 *   · el board de Personas se opera en LECTURA PURA, y una bandera ahí sería escribirlo;
 *   · no hace falta ningún reinicio mensual —el día que la automatización del reset no corriera,
 *     todas las retenciones saldrían mal sin que nadie se entere—;
 *   · se AUTOCORRIGE: si una orden se borra o se rehace, el próximo cálculo lo refleja solo.
 *
 * Ante un error de lectura NO se asume nada y la excepción se propaga: dar por bueno cualquiera de
 * los dos supuestos cambia el importe que se le retiene al proveedor.
 */
export async function baseNoImponibleYaAplicada(
  proveedorId: string,
  hoyIso: string,
): Promise<boolean> {
  if (!proveedorId) return false
  // Modo local: no hay historial que consultar, así que el mes siempre arranca sin usar.
  if (!mondayHabilitado()) return false

  const data = await mondayApi<{ boards: { items_page: { items: OrdenConSubitems[] } }[] }>(
    `query {
      boards(ids: [${BOARDS.ordenesPago}]) {
        items_page(
          limit: ${TOPE_ORDENES},
          query_params: {rules: [
            {column_id: "${COL.ordenPago.proveedor}", compare_value: [${Number(proveedorId)}], operator: any_of}
          ]}
        ) {
          items {
            id
            created_at
            subitems {
              id
              column_values(ids: ["${COL.ordenPagoSub.caja}"]) {
                id
                ... on StatusValue { index }
              }
            }
          }
        }
      }
    }`,
  )

  const periodo = periodoDe(hoyIso)
  /* Se compara por ÍNDICE y no por el rótulo: es la identidad de la etiqueta en el board, así que
     renombrarla en Monday no puede hacer que la app deje de reconocer las retenciones ya hechas —y
     vuelva a descontar una base no imponible que ya se usó—. */
  const retencion = CAJA_PAGO_INDEX['Retencion GAN']
  return (data.boards?.[0]?.items_page.items ?? []).some((orden) => {
    /* `created_at` viene en ISO con hora ("2026-08-27T13:05:00Z"): los diez primeros caracteres son
       la fecha, y de ahí sale el período. */
    if (periodoDe(orden.created_at ?? '') !== periodo) return false
    return (orden.subitems ?? []).some(
      (sub) => byId(sub)[COL.ordenPagoSub.caja]?.index === retencion,
    )
  })
}

/** Una orden con sus subelementos, que es lo único que esta consulta necesita de ella. */
interface OrdenConSubitems {
  id: string
  created_at?: string
  subitems?: { id: string; column_values: MondayItem['column_values'] }[]
}
