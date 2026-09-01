/**
 * Búsqueda del cliente contra el board de Personas de Monday.
 *
 * La consulta se resuelve EN EL SERVIDOR (reglas de `items_page`), no trayendo el tablero entero
 * y filtrando en memoria: Personas tiene miles de ítems, así que cualquier filtrado del lado del
 * cliente devuelve "no existe" para todo el que caiga fuera de la primera página.
 */
import { CLIENTES } from '@/data/mock'
import { formatearCuit } from '@/lib/pagos'
import type {
  ActividadCliente,
  Cliente,
  CondicionPago,
  ListaPrecio,
  SituacionCliente,
} from '@/types'
import {
  BOARDS,
  CATEGORIA_CLIENTE_INDEX,
  CLIENTE_ACTIVO_INDEX,
  COL,
  SITUACION_CLIENTE_INDEX,
} from './columns'
import { byId, num, numCol, sumaMirror, type MondayItem } from './parse'
import { mondayApi, mondayHabilitado } from './sdk'

/* ===== Similitud para la búsqueda por nombre en modo local (mock) ===== */

const norm = (s: string) => s.toLowerCase().trim()

/** Coincidencia mínima para dar por bueno un nombre parecido (≈60%). */
const UMBRAL_SIMILITUD = 0.6

/**
 * Parecido entre lo tecleado y el nombre del cliente: 1 si el nombre contiene el término, y si no,
 * la proporción de palabras del término que aparecen en el nombre. Alcanza para el mock; contra
 * Monday la coincidencia parcial la resuelve el operador `contains_text` de la API.
 */
function similitud(termino: string, nombre: string): number {
  const t = norm(termino)
  const n = norm(nombre)
  if (!t) return 0
  if (n.includes(t)) return 1
  const palabras = t.split(/\s+/).filter(Boolean)
  if (palabras.length === 0) return 0
  return palabras.filter((p) => n.includes(p)).length / palabras.length
}

/**
 * Qué ingresó el usuario. NO se intenta distinguir código de CUIT por la cantidad de dígitos: los
 * códigos del tablero van de 1 a 4 dígitos hoy y nada impide que mañana lleguen a 6, así que
 * cualquier corte por longitud tarde o temprano manda un código al ramal del CUIT. Un término
 * NUMÉRICO se busca en las DOS columnas y se unen los resultados.
 */
type TipoBusqueda = 'numero' | 'nombre'
const tipoBusqueda = (t: string): TipoBusqueda =>
  /^[\d.\s-]+$/.test(t) && /\d/.test(t) ? 'numero' : 'nombre'

/**
 * Situación del cliente a partir del ÍNDICE de la columna status, no de su texto: las etiquetas
 * del board ("0-Liberado Con Credito"…) se pueden reescribir, los índices no.
 *
 * Sin índice cargado se asume la situación más restrictiva que NO bloquea ("Liberado sin
 * crédito"): que a un cliente le falte la etiqueta no es una decisión de nadie de bloquearlo, y
 * bloquearlo por omisión frenaría cobranzas legítimas. El bloqueo tiene que ser explícito.
 */
function situacionDe(indice: number | null | undefined): SituacionCliente {
  switch (indice) {
    case SITUACION_CLIENTE_INDEX.liberadoConCredito:
      return 'Liberado con crédito'
    case SITUACION_CLIENTE_INDEX.bloqueado:
      return 'Bloqueado'
    default:
      return 'Liberado sin crédito'
  }
}

const columnasCliente = Object.values(COL.cliente)

/**
 * Etiquetas de "✋Categoria" de la persona. La columna es multi-valor y Monday devuelve su texto
 * como una lista separada por comas ("Clientes, Proveedores"), así que se parte y se limpia.
 *
 * De acá sale para qué operación sirve la persona (ver `lib/personas`), así que lo lee el mapeo
 * común y no cada módulo: los dos lados del mostrador miran exactamente la misma columna.
 */
export const categoriasDePersona = (item: MondayItem): string[] =>
  (byId(item)[COL.cliente.categoria]?.text ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)

/** Campos que trae cada persona, con la Cta Cte conectada anidada (de ahí sale el crédito). */
const CAMPOS_CLIENTE = `
  id name
  column_values(ids: ${JSON.stringify(columnasCliente)}) {
    id text
    ... on StatusValue { index }
    ... on BoardRelationValue {
      linked_items {
        id name
        column_values(ids: ["${COL.ctaCte.totalVentas}","${COL.ctaCte.totalCobros}","${COL.ctaCte.remitosPendFacturar}","${COL.ctaCte.limite}"]) {
          id text
          ... on MirrorValue { display_value }
        }
      }
    }
  }`

/**
 * Reglas que TODA búsqueda de clientes arrastra, resueltas en el servidor junto con el término:
 * la persona tiene que ser de categoría "Clientes" y estar ACTIVA.
 *
 * Van por ÍNDICE de etiqueta, no por texto: aguantan que en el board renombren "Activo" o
 * "Clientes" sin que la app deje de encontrar a nadie. Y van en la consulta —no filtrando la
 * respuesta— para que los lugares del resultado los ocupen sólo clientes utilizables.
 */
export const REGLAS_CLIENTE_OPERABLE = reglasDePersona(CATEGORIA_CLIENTE_INDEX)

/**
 * Las mismas reglas para CUALQUIER categoría del board de Personas: activa y de la categoría que se
 * pida. Existe como función porque el módulo de PAGOS busca exactamente igual pero del otro lado
 * del mostrador —categoría "Proveedores"—, y duplicar la consulta habría sido duplicar también la
 * regla de "sólo personas activas", que es la que hace que un ítem dado de baja se comporte como
 * inexistente.
 */
export function reglasDePersona(categoriaIndex: number): string {
  return [
    `{column_id: "${COL.cliente.estado}", compare_value: [${CLIENTE_ACTIVO_INDEX}], operator: any_of}`,
    `{column_id: "${COL.cliente.categoria}", compare_value: [${categoriaIndex}], operator: any_of}`,
  ].join(', ')
}

/** Tope de coincidencias por columna. Sobra: si una búsqueda trae tantas, hay que afinarla. */
const TOPE_RESULTADOS = 50

/** Escapa el término para poder interpolarlo en la query sin romperla. */
const literal = (t: string): string => JSON.stringify(t).slice(1, -1)

/** Una consulta con nombre propio: `alias` la identifica en la respuesta. */
const consultaPersonas = (
  alias: string,
  columna: string,
  valor: string,
  reglas: string,
): string => `
  ${alias}: boards(ids: [${BOARDS.personas}]) {
    items_page(
      limit: ${TOPE_RESULTADOS},
      query_params: {rules: [
        {column_id: "${columna}", compare_value: ["${valor}"], operator: contains_text},
        ${reglas}
      ]}
    ) {
      items { ${CAMPOS_CLIENTE} }
    }
  }`

type RespuestaPersonas = Record<string, { items_page: { items: MondayItem[] } }[]>

/**
 * Busca personas por una o más columnas a la vez (una consulta con alias por columna, todas en la
 * misma solicitud). Devuelve los ítems sin repetir, respetando el orden en que se pidieron.
 */
async function buscarPersonas(
  porColumna: readonly { columna: string; valor: string }[],
  reglas: string,
) {
  const usables = porColumna.filter((x) => x.valor.trim() !== '')
  if (usables.length === 0) return []
  const data = await mondayApi<RespuestaPersonas>(
    `query { ${usables
      .map((x, i) => consultaPersonas(`q${i}`, x.columna, literal(x.valor), reglas))
      .join('')} }`,
  )
  const vistos = new Set<string>()
  const items: MondayItem[] = []
  usables.forEach((_, i) => {
    for (const it of data[`q${i}`]?.[0]?.items_page.items ?? []) {
      if (vistos.has(it.id)) continue
      vistos.add(it.id)
      items.push(it)
    }
  })
  return items
}

/**
 * Una fila del board de Personas → el modelo de la app. Se llama `mapPersona` y no `mapCliente`
 * porque el board no distingue: la MISMA fila es un cliente o un proveedor según su "✋Categoria",
 * y el módulo de PAGOS la lee campo por campo igual que éste (ver `services/monday/proveedores`).
 */
export function mapPersona(item: MondayItem): Cliente {
  const c = byId(item)
  /* Cta Cte conectada. El crédito se calcula acá a partir de las columnas base, no de las
     fórmulas del board:
        saldo            = total ventas − total cobros
        línea utilizada  = saldo + remitos pendientes de facturar
        disponible       = límite − línea utilizada
     El límite sale de la mirror de la cuenta y, si no viene, del propio cliente. */
  const cta = c[COL.cliente.ctaCte]?.linked_items?.[0]
  const ctaCols = cta ? byId(cta) : {}
  const limiteCliente = num(c[COL.cliente.limite]?.text)
  /* Ventas y cobros son mirror de VARIOS movimientos: su display llega como lista ("977,
     3161621") y hay que sumarla. Remitos es un numérico común, y el límite una mirror de un
     solo valor: con `sumaMirror` un valor único se suma consigo mismo, así que va con numCol. */
  const totalVentas = sumaMirror(ctaCols[COL.ctaCte.totalVentas])
  const totalCobros = sumaMirror(ctaCols[COL.ctaCte.totalCobros])
  const remitosPendFacturar = numCol(ctaCols[COL.ctaCte.remitosPendFacturar])
  const limite = numCol(ctaCols[COL.ctaCte.limite]) || limiteCliente
  const saldoCtaCte = totalVentas - totalCobros
  const lineaUtilizada = saldoCtaCte + remitosPendFacturar
  const agente = c[COL.cliente.agenteRet]?.text ?? ''
  return {
    id: item.id,
    // El código del sistema es el que ve el usuario; el id del ítem queda para la API.
    codigo: c[COL.cliente.codigo]?.text?.trim() || item.id,
    name: item.name,
    /* El board lo guarda como once dígitos corridos ("30709067881"). Se formatea ACÁ, en el borde
       de entrada, para que el resto del circuito —la ficha, el buscador, la comparación contra el
       emisor de un cheque o de una retención— trabaje siempre con el mismo formato. */
    cuit: formatearCuit(c[COL.cliente.cuit]?.text),
    categorias: categoriasDePersona(item),
    ptype: c[COL.cliente.tipoPersona]?.text ?? '',
    status: c[COL.cliente.condFiscal]?.text ?? '',
    list: (c[COL.cliente.listaPrecio]?.text as ListaPrecio) || null,
    ret: agente || 'Ninguna',
    agenteRetencion: agente.trim().length > 0,
    // Sin condición de pago en el board llega null: no se asume ninguna.
    condicionPago: (c[COL.cliente.condPago]?.text?.trim() || null) as CondicionPago | null,
    /* "Recibimos CHEQUE": sólo un "NO" explícito bloquea el cobro con cheque. Sin la columna
       cargada NO se asume lo restrictivo. */
    aceptaCheques: (c[COL.cliente.aceptaCheques]?.text ?? '').trim().toUpperCase() !== 'NO',
    limit: limite,
    // Deuda real de la cuenta corriente: lo facturado menos lo cobrado. Es lo que hay para cobrar.
    saldoCtaCte,
    lineaUtilizada,
    remitosPendFacturar,
    /* Sin Cta Cte conectada queda el límite completo: sin movimientos no se puede asumir deuda. */
    disponible: cta ? limite - lineaUtilizada : limite,
    addr: c[COL.cliente.dirFiscal]?.text ?? '',
    activity: (c[COL.cliente.estado]?.index === CLIENTE_ACTIVO_INDEX
      ? 'Activo'
      : 'Inactivo') as ActividadCliente,
    situation: situacionDe(c[COL.cliente.situacion]?.index),
  }
}

/**
 * Busca clientes por nombre, código de cliente o CUIT/CUIL (entero o parcial). Un término numérico
 * se busca a la vez por código y por CUIT; uno con letras, por nombre.
 *
 * La categoría ("Clientes") y el estado ACTIVO ya vienen aplicados en la consulta
 * (`REGLAS_CLIENTE_OPERABLE`): lo que llega es directamente operable, y un cliente inactivo se
 * comporta como inexistente.
 */
export async function buscarClientes(termino: string): Promise<Cliente[]> {
  const t = termino.trim()
  if (!t) return []

  // Modo local: el mock es chico, así que se filtra en memoria con el mismo criterio.
  if (!mondayHabilitado()) return filtrarPersonasEnMemoria(CLIENTES, t)

  return (await buscarPersonasPorTermino(t, REGLAS_CLIENTE_OPERABLE)).map(mapPersona)
}

/**
 * Busca en el board de Personas por nombre, código o CUIT, con las reglas que se le pasen (la
 * categoría y el estado activo). Un término NUMÉRICO se busca a la vez por código y por CUIT; uno
 * con letras, por nombre.
 *
 * Es el buscador entero, sin el mapeo: lo comparten clientes y proveedores, que se buscan con los
 * mismos criterios sobre el mismo tablero y sólo se diferencian en su categoría.
 */
export async function buscarPersonasPorTermino(
  termino: string,
  reglas: string,
): Promise<MondayItem[]> {
  const t = termino.trim()
  if (!t) return []
  /* El CUIT se guarda SIN separadores ("30526228746"), así que se busca por sus dígitos: el
     usuario puede escribirlo con guiones o sin ellos y da lo mismo. */
  return tipoBusqueda(t) === 'numero'
    ? buscarPersonas(
        [
          { columna: COL.cliente.codigo, valor: t },
          { columna: COL.cliente.cuit, valor: t.replace(/\D/g, '') },
        ],
        reglas,
      )
    : buscarPersonas([{ columna: 'name', valor: t }], reglas)
}

/**
 * Filtrado en memoria para el modo local (mock): el mismo criterio que resuelve la API con sus
 * operadores —código o CUIT para un término numérico, nombre parecido para uno con letras—.
 *
 * Vive acá y se exporta porque el mock de proveedores se recorre igual: sin esto, el modo local
 * tendría dos buscadores que se comportan distinto según a quién se busque.
 */
export function filtrarPersonasEnMemoria<T extends Cliente>(personas: readonly T[], termino: string): T[] {
  const t = termino.trim()
  if (!t) return []
  const activos = personas.filter((c) => c.activity === 'Activo')
  if (tipoBusqueda(t) === 'numero') {
    const digitos = t.replace(/\D/g, '')
    return activos.filter(
      (c) => norm(c.codigo).includes(norm(t)) || c.cuit.replace(/\D/g, '').includes(digitos),
    )
  }
  return activos
    .map((c) => ({ c, s: similitud(t, c.name) }))
    .filter((x) => x.s >= UMBRAL_SIMILITUD)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.c)
}
