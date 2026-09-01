/**
 * Facturas de compra pendientes de pago del proveedor: tablero "❓ Facturas Compra Pend de Pago"
 * (18425512701).
 *
 * Es el espejo de `./facturas`, que resuelve lo mismo del lado de las ventas, y por eso repite sus
 * dos decisiones:
 *
 *   · los DOS filtros viajan como REGLAS de la consulta, no se aplican sobre la respuesta: el
 *     proveedor ("🤖Proveedor") y el estado, limitado a lo que todavía se puede pagar (pendiente
 *     100% o pagada parcialmente), por ÍNDICE de etiqueta.
 *   · el id del proveedor en la regla de `board_relation` va como NÚMERO. Entre comillas la
 *     consulta devuelve 0 ítems en vez de fallar, así que el error no se nota hasta que la pantalla
 *     aparece vacía.
 *
 * LECTURA PURA: nada de este módulo escribe en el tablero.
 */
import { FACTURAS_COMPRA_PENDIENTES } from '@/data/mock'
import { parseIso } from '@/lib/dates'
import { round2 } from '@/lib/format'
import type { FacturaCompraPendiente } from '@/types'
import { BOARDS, COL, FACT_COMPRA_ESTADO_INDEX, FACT_COMPRA_ESTADOS_PAGABLES } from './columns'
import { byId, num, sumaMirror, valor, type MondayItem } from './parse'
import { mondayApi, mondayHabilitado } from './sdk'

/** Tope de facturas que trae la consulta. Un proveedor con más deuda que esto es un caso aparte. */
const TOPE_FACTURAS = 200

const columnasFactura = Object.values(COL.factCompra)

/**
 * Columnas que se leen de la factura de compra VINCULADA. Se filtran las vacías: `total` todavía no
 * tiene su id configurado (ver `COL.factCompraDoc.total`), y pedirle a Monday una columna con id
 * vacío hace fallar la consulta entera.
 */
const columnasFacturaDoc = Object.values(COL.factCompraDoc).filter(Boolean)

/**
 * Los importes viven en columnas mirror y fórmula: las dos devuelven su valor en `display_value`
 * (con su fragmento), nunca en `text`. Sin los fragmentos, todo llegaría en 0.
 *
 * La FACTURA vinculada viaja anidada por DOS cosas: su ID —que es el nombre con el que la fila se
 * identifica en pantalla— y su IMPORTE NETO, que no se muestra en ninguna parte pero es la base con
 * la que se calcula la retención de Ganancias. Las dos se traen en la misma consulta para no
 * disparar una por fila.
 *
 * De la vinculada se pide además su `board`: el neto sólo vale si el ítem conectado es realmente una
 * factura de compra (18425512689). La columna de relación acepta un solo tablero, pero comprobarlo
 * es barato y es lo que permite distinguir "no tiene neto cargado" de "está conectado a otra cosa".
 */
const CAMPOS_FACTURA = `
  id name
  column_values(ids: ${JSON.stringify(columnasFactura)}) {
    id text
    ... on MirrorValue { display_value }
    ... on FormulaValue { display_value }
    ... on StatusValue { index }
    ... on BoardRelationValue {
      linked_items {
        id name
        board { id }
        column_values(ids: ${JSON.stringify(columnasFacturaDoc)}) { id text }
      }
    }
  }`

/**
 * Orden del listado: por VENCIMIENTO, de la más vieja a la más nueva. Es el orden en que se paga
 * una cuenta —primero lo que lleva más tiempo impago, que es lo que más mora acumula—, así que la
 * factura más urgente queda arriba sin que haya que buscarla.
 *
 * Las que no tienen vencimiento cargado van al FINAL: no se puede afirmar que sean las más viejas.
 */
const porVencimiento = (a: FacturaCompraPendiente, b: FacturaCompraPendiente): number => {
  const va = parseIso(a.vencimiento)?.getTime()
  const vb = parseIso(b.vencimiento)?.getTime()
  if (va === undefined) return vb === undefined ? 0 : 1
  if (vb === undefined) return -1
  return va - vb
}

function mapFacturaCompra(item: MondayItem): FacturaCompraPendiente {
  const c = byId(item)
  const indiceEstado = c[COL.factCompra.estado]?.index
  /* Factura de compra vinculada: de ahí sale el ID con el que se identifica la fila. Muchos ítems
     del tablero no la tienen conectada, así que es opcional y hay dos respaldos —el número impreso
     del comprobante y, en última instancia, el nombre del propio ítem—: siempre hay algo que
     mostrar. */
  const factura = c[COL.factCompra.factura]?.linked_items?.[0]
  const facturaCols = factura ? byId(factura) : {}
  /* IMPORTE NETO de la factura vinculada. Vale SÓLO si el ítem conectado es del tablero de facturas
     de compra y la columna trae un número mayor a cero. En cualquier otro caso queda `null`, que es
     lo que después frena el cálculo de la retención con un mensaje concreto en vez de tomar un cero
     y devolver una base imponible falsa. */
  const netoTexto = facturaCols[COL.factCompraDoc.importeNeto]?.text?.trim() ?? ''
  const deFacturasCompra = String(factura?.board?.id ?? '') === String(BOARDS.factCompras)
  const neto = num(netoTexto)
  const importeNeto = deFacturasCompra && netoTexto !== '' && neto > 0 ? neto : null
  /* TOTAL de la vinculada, para controlarlo contra el de la pendiente. Queda en `null` mientras la
     columna no esté configurada, y ahí el control no corre: ver `COL.factCompraDoc.total`. */
  const totalTexto = COL.factCompraDoc.total
    ? (facturaCols[COL.factCompraDoc.total]?.text?.trim() ?? '')
    : ''
  const totalFactura = deFacturasCompra && totalTexto !== '' ? num(totalTexto) : null
  const total = num(valor(c[COL.factCompra.total]))
  /* "🤖Pagado $" es mirror de los SUBELEMENTOS del ítem: con más de un pago su `display_value`
     llega como lista ("500000, 900000") y hay que SUMARLA. Pasarla por `num()` de una borra las
     comas y concatena. Sin pagos previos la lista viene vacía y suma 0, que son cero pesos pagados
     y no un dato faltante. */
  const pagado = sumaMirror(c[COL.factCompra.pagado])
  return {
    id: item.id,
    nro:
      factura?.name?.trim() ||
      facturaCols[COL.factCompraDoc.nro]?.text?.trim() ||
      item.name.trim() ||
      item.id,
    vencimiento: c[COL.factCompra.fechaVencimiento]?.text?.trim() ?? '',
    total,
    pagado,
    /* El porcentaje se CALCULA: el tablero no tiene una columna que lo diga (a diferencia del de
       ventas, que trae su "🤖Cobrado %"). Sin total no hay proporción posible, y ahí es 0. */
    pagadoPct: total > 0 ? Math.min(Math.max(Math.round((pagado / total) * 100), 0), 100) : 0,
    pendiente: round2(num(valor(c[COL.factCompra.pendiente]))),
    importeNeto,
    totalFactura,
    estado: c[COL.factCompra.estado]?.text ?? '',
    parcial: indiceEstado === FACT_COMPRA_ESTADO_INDEX.pagadaParcialmente,
  }
}

/**
 * Facturas de compra del proveedor que todavía deben algo, de la más vencida a la más nueva. Sin
 * proveedor devuelve vacío: no hay a quién pagarle, y es la dependencia estricta que impide que el
 * listado se dispare antes de la etapa 1. Sin token (modo local) devuelve el mock, ordenado con el
 * MISMO criterio para que el prototipo se recorra igual que con datos reales.
 */
export async function getFacturasCompraPendientes(
  proveedorId: string,
): Promise<FacturaCompraPendiente[]> {
  if (!proveedorId) return []
  if (!mondayHabilitado()) return [...FACTURAS_COMPRA_PENDIENTES].sort(porVencimiento)

  const data = await mondayApi<{ boards: { items_page: { items: MondayItem[] } }[] }>(
    `query {
      boards(ids: [${BOARDS.factComprasPendientes}]) {
        items_page(
          limit: ${TOPE_FACTURAS},
          query_params: {rules: [
            {column_id: "${COL.factCompra.proveedor}", compare_value: [${Number(proveedorId)}], operator: any_of},
            {column_id: "${COL.factCompra.estado}", compare_value: [${FACT_COMPRA_ESTADOS_PAGABLES.join(', ')}], operator: any_of}
          ]}
        ) {
          items { ${CAMPOS_FACTURA} }
        }
      }
    }`,
  )

  /*
   * NO se filtra por "pendiente > 0", y es a propósito.
   *
   * "🤖Pend de Pagar $" es la fórmula `{$ Total a pagar} - {Pagado $}`, así que da CERO por dos
   * motivos que no se parecen en nada: porque la factura ya se pagó, o porque a la factura nunca le
   * cargaron su total. El primero ya lo descarta la consulta —el estado "Pagada 100%" no entra en
   * `FACT_COMPRA_ESTADOS_PAGABLES`—, así que todo lo que llegaría a este filtro es lo SEGUNDO: un
   * dato incompleto del tablero.
   *
   * Descartarlo acá le decía al usuario "este proveedor no tiene facturas pendientes de pago"
   * mientras el tablero mostraba una. Un dato que falta tiene que verse y poder arreglarse, no
   * desaparecer: la fila se muestra igual y el paso 2 la marca como no imputable, nombrando qué le
   * falta (ver `motivoNoImputable`).
   */
  return (data.boards?.[0]?.items_page.items ?? []).map(mapFacturaCompra).sort(porVencimiento)
}
