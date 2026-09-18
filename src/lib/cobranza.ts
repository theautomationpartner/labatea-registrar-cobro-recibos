/**
 * Reglas de la GESTIÓN DE COBRANZA: qué se puede pedir en cada criterio de búsqueda, cómo se
 * reparte la deuda de cada cuenta y en qué orden se listan. Puras —sin React ni servicios—, así las
 * comparten la consulta, los widgets del tablero y los tests, sin poder discrepar.
 *
 * El módulo NO escribe nada en Monday: todo lo de acá sirve para LEER, agrupar y ordenar.
 */
import { diasDeMora } from '@/lib/dates'
import { round2 } from '@/lib/format'
import { usoDeLinea } from '@/lib/selectors'
import type {
  CriterioCobranza,
  CuentaCobranza,
  EstadoSaldo,
  FacturaCobranza,
  ResultadoCobranza,
  TramoVencimiento,
} from '@/types'

/* ===== Criterio 1 · estado del saldo de la cuenta ===== */

/**
 * Cómo se llama cada estado en "🤖 Estado del Saldo" (`formula_mm6sr4rn`), TAL CUAL lo devuelve la
 * fórmula del tablero. Es lo único con lo que se puede filtrar: la columna es una fórmula, así que
 * no admite reglas en la consulta y la comparación corre sobre el texto de la respuesta (ver
 * `services/monday/cobranza`).
 */
export const ESTADO_SALDO_LABEL: Record<EstadoSaldo, string> = {
  aCobrar: 'Saldo a Cobrar',
  cero: 'Saldo Cero',
  aFavor: 'Saldo a Favor',
}

/**
 * Las tres opciones del primer criterio, en el orden en que se ofrecen: de la que hay que reclamar a
 * la que no. Cada una lleva su ícono y su tono, que son los que después pintan la pastilla de la
 * tabla de cuentas.
 */
export const ESTADOS_SALDO: readonly {
  valor: EstadoSaldo
  label: string
  /** Lo que el estado significa para la cobranza, en una línea. Va en el tooltip del chip. */
  ayuda: string
  icono: string
  tono: 'deuda' | 'cero' | 'favor'
}[] = [
  {
    valor: 'aCobrar',
    label: ESTADO_SALDO_LABEL.aCobrar,
    ayuda: 'La cuenta tiene saldo deudor: el cliente nos debe.',
    icono: 'fa-arrow-trend-up',
    tono: 'deuda',
  },
  {
    valor: 'cero',
    label: ESTADO_SALDO_LABEL.cero,
    ayuda: 'La cuenta está en cero: no debe ni tiene saldo a favor.',
    icono: 'fa-equals',
    tono: 'cero',
  },
  {
    valor: 'aFavor',
    label: ESTADO_SALDO_LABEL.aFavor,
    ayuda: 'La cuenta tiene saldo a favor del cliente, todavía sin aplicar.',
    icono: 'fa-arrow-trend-down',
    tono: 'favor',
  },
]

/** Normaliza para comparar etiquetas: sin tildes, sin mayúsculas y sin espacios de más. */
const norm = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

/**
 * A qué opción del filtro corresponde una etiqueta del tablero. Se compara NORMALIZADO —el tablero
 * la publica con un espacio de más o con otra capitalización según la fila— y devuelve `null` si no
 * es ninguna de las tres: una etiqueta nueva no se puede hacer pasar por una conocida.
 */
export const estadoSaldoDeLabel = (label: string): EstadoSaldo | null => {
  const n = norm(label)
  return (
    (Object.keys(ESTADO_SALDO_LABEL) as EstadoSaldo[]).find(
      (k) => norm(ESTADO_SALDO_LABEL[k]) === n,
    ) ?? null
  )
}

/* ===== Criterio 2 · tramo de vencimiento de la factura ===== */

/**
 * Los cinco tramos de "🤖Estado de Vencimiento" (`color_mm6symyx`), en orden de GRAVEDAD y con la
 * etiqueta tal como la publica el tablero.
 *
 * El `color` es el de la franja en la batería del tablero y el de su punto en la leyenda: un
 * degradé del verde de lo que todavía no venció al rojo profundo de lo que lleva más de sesenta
 * días. Sale de los tokens de la app (ver `base.css`), así que el tablero no introduce una paleta
 * nueva.
 *
 * El `tono` es el MISMO de la pastilla de vencimiento del RESUMEN DE CTA CTE
 * (`FacturaAdeudada.tonoVencimiento`), para que una factura no se vea de un color en una pantalla y
 * de otro en la otra.
 */
export const TRAMOS_VENCIMIENTO: readonly {
  valor: TramoVencimiento
  /** Etiqueta del tablero. Es la que se muestra en el chip del filtro y en la tabla. */
  label: string
  /** Versión corta, para la leyenda de la batería y los ejes. */
  corto: string
  tono: 'ok' | 'alerta' | 'vencida'
  color: string
}[] = [
  { valor: 'noVencido', label: 'No vencido', corto: 'No vencido', tono: 'ok', color: '#00c875' },
  {
    valor: 'vencido0a15',
    label: 'Vencido 0 a 15 Dias',
    corto: '0 a 15 días',
    tono: 'alerta',
    color: '#ffcb00',
  },
  {
    valor: 'vencido15a30',
    label: 'Vencido 15 a 30 dias',
    corto: '15 a 30 días',
    tono: 'alerta',
    color: '#fdab3d',
  },
  {
    valor: 'vencido30a60',
    label: 'Vencido + 30 - 60  Dias',
    corto: '30 a 60 días',
    tono: 'vencida',
    color: '#e2445c',
  },
  {
    valor: 'vencidoMas60',
    label: 'Vencido + 60',
    corto: '+ 60 días',
    tono: 'vencida',
    color: '#9c2334',
  },
]


/**
 * ¿Sobre este color el texto tiene que ir en CLARO?
 *
 * La escala de la batería va del verde al rojo profundo, así que ningún color de texto fijo se lee
 * sobre las cinco franjas: en blanco desaparece sobre el amarillo y en oscuro sobre el "+ 60". Se
 * decide por la luminancia relativa del color (la fórmula de contraste de la WCAG), que es la misma
 * cuenta que haría un diseñador a ojo y no se rompe si mañana se cambia un color de la escala.
 */
export function textoClaroSobre(hex: string): boolean {
  const canal = (i: number) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const luminancia = 0.2126 * canal(0) + 0.7152 * canal(1) + 0.0722 * canal(2)
  return luminancia < 0.4
}

/* ===== El criterio de búsqueda ===== */

/**
 * Con qué criterio abre el tablero: las cuentas que DEBEN y sus facturas en cualquier tramo.
 *
 * Es la pregunta que trae el operador cuando entra a cobrar —"¿quién me debe y desde cuándo?"—, así
 * que la pantalla ya la contesta sin obligarlo a armar el filtro. Los otros dos estados de saldo
 * quedan afuera a propósito: una cuenta en cero o con saldo a favor no tiene nada que reclamar, y
 * traerlas de entrada diluiría la lista con las cuentas que no se cobran.
 */
export const CRITERIO_INICIAL: CriterioCobranza = {
  estados: ['aCobrar'],
  tramos: TRAMOS_VENCIMIENTO.map((t) => t.valor),
}

/**
 * Clave de caché del resultado: de QUÉ criterio son las cuentas y las facturas que hay en pantalla.
 * Si coincide con el criterio elegido, lo que se muestra es la respuesta a lo que se está
 * preguntando; si no, los filtros se movieron y hay que volver a buscar.
 *
 * Las dos listas se ORDENAN antes de pegarse: elegir los mismos tramos en otro orden es el mismo
 * pedido, y sin esto el tablero se daría por desactualizado sin que nada hubiera cambiado.
 */
export const claveCobranza = (criterio: CriterioCobranza): string =>
  `${[...criterio.estados].sort().join(',')}·${[...criterio.tramos].sort().join(',')}`

/**
 * ¿El criterio se puede consultar? Las dos listas tienen que tener al menos una opción: sin estado
 * de saldo no hay cuentas que traer, y sin tramo no hay facturas que listar.
 *
 * Desde la pantalla no puede fallar —los dos criterios salen de sendos selects, que siempre tienen un
 * valor—, y por eso vive en el reducer: es la red que evita salir a la red por un criterio que no se
 * puede consultar, venga de donde venga.
 */
export const criterioCompleto = (criterio: CriterioCobranza): boolean =>
  criterio.estados.length > 0 && criterio.tramos.length > 0


/* ===== Reparto de la deuda: una fila por cuenta ===== */

/** El importe pendiente de cada tramo, con los cinco tramos SIEMPRE presentes (en 0 si no hay). */
export type PorTramo = Record<TramoVencimiento, number>

const enCero = (): PorTramo =>
  TRAMOS_VENCIMIENTO.reduce((acc, t) => ({ ...acc, [t.valor]: 0 }), {} as PorTramo)

/**
 * Una CUENTA con su deuda ya repartida: es la unidad de la tabla del tablero y la que alimenta cada
 * widget. Todo lo que se muestra sale de acá, así que ningún componente vuelve a sumar nada.
 */
export interface FilaCobranza {
  cuenta: CuentaCobranza
  /** Sus facturas, de la más vieja a la más nueva. */
  facturas: FacturaCobranza[]
  /** Cuántas son. */
  cantidad: number
  /** Lo facturado, lo ya cobrado de esas facturas y lo que queda por cobrar. */
  total: number
  cobrado: number
  pendiente: number
  /** Cómo se reparte ese pendiente: lo que ya venció y lo que todavía no. */
  vencido: number
  aVencer: number
  /** Y en qué tramos cae, para la batería y el detalle de la fila. */
  porTramo: PorTramo
  /** Vencimiento MÁS ANTIGUO entre sus facturas vencidas, en ISO. Vacío si ninguna venció. */
  vencimientoMasViejo: string
  /** Días de mora de ESA factura: la antigüedad de la deuda. `null` si ninguna venció. */
  diasMora: number | null
  /** Qué porcentaje del límite de crédito tiene tomado la cuenta. `null` sin límite asignado. */
  usoLinea: number | null
  /**
   * Lo que le queda de línea: límite − línea utilizada. Puede ser NEGATIVO, y se deja así: una
   * cuenta pasada de su límite es exactamente lo que el tablero tiene que poder mostrar, y
   * recortarlo en cero escondería por cuánto se pasó.
   */
  creditoDisponible: number
}

/** Orden del listado de facturas de una cuenta: por vencimiento, la más vieja arriba. */
const porVencimiento = (a: FacturaCobranza, b: FacturaCobranza): number => {
  if (!a.vencimiento) return b.vencimiento ? 1 : 0
  if (!b.vencimiento) return -1
  return a.vencimiento < b.vencimiento ? -1 : a.vencimiento > b.vencimiento ? 1 : 0
}


/**
 * Las cuentas del resultado con su deuda repartida, una fila por cuenta.
 *
 * Las facturas llegan en UNA sola lista —la consulta las pide todas juntas— y acá se reparten por
 * cliente. Una cuenta SIN facturas en los tramos pedidos igual entra en el listado: que una cuenta
 * con saldo declarado no tenga facturas en el tramo consultado es exactamente el tipo de cosa que el
 * tablero tiene que poder mostrar, y esconderla haría que los totales no cerraran con la lista.
 *
 * Qué está vencido lo dice el TRAMO que publica el tablero, el mismo que muestra la tabla: así la
 * batería no puede contradecir a la columna de al lado.
 */
export function filasDeCobranza(resultado: ResultadoCobranza): FilaCobranza[] {
  const porCliente = new Map<string, FacturaCobranza[]>()
  for (const f of resultado.facturas) {
    const lista = porCliente.get(f.clienteId)
    if (lista) lista.push(f)
    else porCliente.set(f.clienteId, [f])
  }

  return resultado.cuentas.map((cuenta) => {
    const facturas = [...(porCliente.get(cuenta.clienteId) ?? [])].sort(porVencimiento)
    const porTramo = enCero()
    let vencido = 0
    let masViejo = ''
    for (const f of facturas) {
      if (f.tramo) porTramo[f.tramo] = round2(porTramo[f.tramo] + f.pendiente)
      /* Sin tramo cargado NO se cuenta como vencida: el tablero no lo afirmó, y darlo por vencido
         inflaría justo el número que se usa para reclamar. */
      if (!f.tramo || f.tramo === 'noVencido') continue
      vencido = round2(vencido + f.pendiente)
      if (f.vencimiento && (!masViejo || f.vencimiento < masViejo)) masViejo = f.vencimiento
    }
    const suma = (campo: 'importe' | 'cobrado' | 'pendiente') =>
      round2(facturas.reduce((acc, f) => acc + f[campo], 0))
    const pendiente = suma('pendiente')

    return {
      cuenta,
      facturas,
      cantidad: facturas.length,
      total: suma('importe'),
      cobrado: suma('cobrado'),
      pendiente,
      vencido,
      aVencer: round2(pendiente - vencido),
      porTramo,
      vencimientoMasViejo: masViejo,
      diasMora: masViejo ? diasDeMora(masViejo) : null,
      usoLinea: usoDeLinea(cuenta.limite, cuenta.lineaUtilizada),
      creditoDisponible: round2(cuenta.limite - cuenta.lineaUtilizada),
    }
  })
}

/* ===== Los totales del tablero ===== */

/** Los números de la fila de indicadores y de la batería: los de TODAS las filas, no de una página. */
export interface ResumenCobranza {
  /** Cuántas cuentas trajo el criterio. */
  cuentas: number
  /** Cuántas de ellas tienen al menos una factura en los tramos pedidos. */
  cuentasConFacturas: number
  facturas: number
  total: number
  cobrado: number
  pendiente: number
  vencido: number
  aVencer: number
  porTramo: PorTramo
  /** Suma de lo que las CUENTAS declaran como deuda ("Fact Vent pend de Aplciar"). */
  saldoDeclarado: number
  /** Suma del saldo a favor de esas cuentas ("Anticipo pend de Aplicar"). */
  anticipos: number
  /** La mora más vieja del conjunto, en días. `null` si nada venció. */
  moraMaxima: number | null
}

export function resumenCobranza(filas: readonly FilaCobranza[]): ResumenCobranza {
  const porTramo = enCero()
  for (const fila of filas) {
    for (const t of TRAMOS_VENCIMIENTO) {
      porTramo[t.valor] = round2(porTramo[t.valor] + fila.porTramo[t.valor])
    }
  }
  const suma = (campo: 'total' | 'cobrado' | 'pendiente' | 'vencido' | 'aVencer') =>
    round2(filas.reduce((acc, f) => acc + f[campo], 0))
  const moras = filas.map((f) => f.diasMora).filter((d): d is number => d !== null)

  return {
    cuentas: filas.length,
    cuentasConFacturas: filas.filter((f) => f.cantidad > 0).length,
    facturas: filas.reduce((acc, f) => acc + f.cantidad, 0),
    total: suma('total'),
    cobrado: suma('cobrado'),
    pendiente: suma('pendiente'),
    vencido: suma('vencido'),
    aVencer: suma('aVencer'),
    porTramo,
    saldoDeclarado: round2(filas.reduce((acc, f) => acc + f.cuenta.ventasPendCancelar, 0)),
    anticipos: round2(filas.reduce((acc, f) => acc + f.cuenta.anticipos, 0)),
    moraMaxima: moras.length > 0 ? Math.max(...moras) : null,
  }
}

/**
 * Qué proporción del total representa una parte, 0-100 y con dos decimales. Sobre un total en cero
 * devuelve 0: no hay proporción que calcular, y un `NaN` se propagaría al ancho de una franja.
 */
export const proporcion = (parte: number, total: number): number =>
  total > 0 ? round2((parte / total) * 100) : 0

/* ===== Orden del listado ===== */

/** Por qué columna se puede ordenar la tabla de cuentas. */
export type OrdenCobranza = 'cliente' | 'saldo' | 'anticipos' | 'facturas' | 'pendiente' | 'vencido'

/**
 * Cómo arranca ordenada la tabla: por lo que queda por cobrar, de mayor a menor. Es la pregunta con
 * la que se entra al tablero —"¿dónde está la plata?"—, así que la primera fila ya es la que más
 * importa.
 */
export const ORDEN_INICIAL: OrdenCobranza = 'pendiente'

/** Los importes y los conteos arrancan de MAYOR a menor; el nombre del cliente, de la A a la Z. */
export const DESCENDENTE_POR_DEFECTO: Record<OrdenCobranza, boolean> = {
  cliente: false,
  saldo: true,
  anticipos: true,
  facturas: true,
  pendiente: true,
  vencido: true,
}

/** El valor por el que se compara cada orden. Los que pueden faltar valen −1, así caen al final. */
const valorDe = (fila: FilaCobranza, orden: OrdenCobranza): number | string => {
  switch (orden) {
    case 'cliente':
      return fila.cuenta.cliente.toLowerCase()
    case 'saldo':
      return fila.cuenta.ventasPendCancelar
    case 'anticipos':
      return fila.cuenta.anticipos
    case 'facturas':
      return fila.cantidad
    case 'pendiente':
      return fila.pendiente
    case 'vencido':
      return fila.vencido
  }
}

/**
 * Las filas ordenadas. Devuelve una copia: el resultado de la búsqueda vive en el estado y no se
 * reordena en su lugar, así volver al orden inicial no depende de haber guardado el original.
 *
 * El desempate va SIEMPRE por lo pendiente, de mayor a menor: con dos cuentas con la misma cantidad
 * de facturas —o las dos sin mora— el orden dejaría de ser estable entre renders y las filas se
 * mezclarían solas al tocar cualquier otra cosa de la pantalla.
 */
export function ordenarFilas(
  filas: readonly FilaCobranza[],
  orden: OrdenCobranza,
  descendente: boolean,
): FilaCobranza[] {
  const signo = descendente ? -1 : 1
  return [...filas].sort((a, b) => {
    const va = valorDe(a, orden)
    const vb = valorDe(b, orden)
    if (va !== vb) return (va < vb ? -1 : 1) * signo
    return b.pendiente - a.pendiente
  })
}

/**
 * Las cuentas que más deben, para el ranking. Se dejan afuera las que no deben nada: una barra en
 * cero no dice nada y le roba lugar a las que sí.
 */
export const topDeudores = (filas: readonly FilaCobranza[], cuantas: number): FilaCobranza[] =>
  ordenarFilas(filas, 'pendiente', true)
    .filter((f) => f.pendiente > 0)
    .slice(0, cuantas)

/** Cuántas cuentas se muestran por página en la tabla del tablero. */
export const CUENTAS_POR_PAGINA = 10

/** Cuántas cuentas entran en el ranking de deudores. */
export const TOP_DEUDORES = 8

