/**
 * Reglas del RESUMEN DE CTA CTE: qué períodos se ofrecen, qué fechas abarca cada uno y cómo se
 * nombra un movimiento dentro del resumen. Puras —sin React ni servicios—, así las comparten la
 * consulta, las dos pantallas que muestran los movimientos y los tests, sin poder discrepar.
 */
import { round2 } from '@/lib/format'
import type { EstadoCtaCteResumen, FormatoResumen, RangoResumen } from '@/types'

const pad = (n: number) => String(n).padStart(2, '0')

/** Date local → yyyy-MM-dd. Con los componentes locales, no con `toISOString` (que es UTC). */
const aIsoLocal = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/**
 * Los períodos que se pueden pedir, en el orden del selector. El AÑO no se cuenta en días: "último
 * año" es desde la misma fecha del año pasado, y 365 días se correría uno en un año bisiesto.
 */
export const RANGOS_RESUMEN: readonly {
  valor: RangoResumen
  label: string
  dias?: number
  anios?: number
}[] = [
  { valor: 'ultimos15', label: 'Últimos 15 días', dias: 15 },
  { valor: 'ultimos30', label: 'Últimos 30 días', dias: 30 },
  { valor: 'ultimos45', label: 'Últimos 45 días', dias: 45 },
  { valor: 'ultimos60', label: 'Últimos 60 días', dias: 60 },
  { valor: 'ultimoAnio', label: 'Último año', anios: 1 },
]

/** Cómo se nombra un período en pantalla. */
export const rotuloRango = (rango: RangoResumen): string =>
  RANGOS_RESUMEN.find((r) => r.valor === rango)?.label ?? ''

/**
 * Las dos puntas del período, en ISO y AMBAS inclusive: desde N días (o un año) atrás hasta HOY.
 *
 * `hoy` se recibe para que la regla sea testeable; en la app es la fecha del día. Se trabaja sobre
 * un `Date` local a medianoche, así los cambios de mes y de año los resuelve el calendario.
 */
export function periodoDeRango(rango: RangoResumen, hoy: Date = new Date()): { desde: string; hasta: string } {
  const opcion = RANGOS_RESUMEN.find((r) => r.valor === rango)
  const hasta = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())
  const desde = new Date(hasta)
  if (opcion?.anios) desde.setFullYear(desde.getFullYear() - opcion.anios)
  else desde.setDate(desde.getDate() - (opcion?.dias ?? 0))
  return { desde: aIsoLocal(desde), hasta: aIsoLocal(hasta) }
}

/**
 * ¿La fecha cae dentro del período? Las fechas ISO se comparan como texto: con el formato fijo
 * yyyy-MM-dd el orden alfabético ES el cronológico. Sin fecha, no cae en ninguno.
 */
export const dentroDelPeriodo = (iso: string, periodo: { desde: string; hasta: string }): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(iso) && iso >= periodo.desde && iso <= periodo.hasta

/** Normaliza para comparar: sin tildes, sin mayúsculas y sin espacios de más. */
const norm = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

/**
 * El nombre de un movimiento SIN el cliente. Los subelementos de la cuenta se nombran pegando partes
 * con " - " —"Movimiento - VTA-108 - 4179 - La Batea S.A"—, y en el resumen de SU cuenta el código y
 * el nombre del cliente no dicen nada: se quitan esas partes y queda "Movimiento - VTA-108".
 *
 * El nombre del cliente se reconoce aunque no sea idéntico al de hoy: el subelemento guarda el que
 * tenía al crearse ("La Batea S.A" contra "La Batea S.A TEST"), así que se quita toda parte que esté
 * CONTENIDA en el nombre actual o que lo contenga. Se exige un largo mínimo para no borrar una parte
 * corta que coincida de casualidad.
 *
 * Si quitar esas partes no dejara nada, se devuelve el nombre original: un comprobante sin nombre es
 * peor que uno redundante.
 */
export function nombreSinCliente(nombre: string, cliente: { codigo: string; name: string }): string {
  const codigo = norm(cliente.codigo)
  const razon = norm(cliente.name)
  const partes = nombre.split(' - ').map((p) => p.trim()).filter(Boolean)
  const propias = partes.filter((p) => {
    const n = norm(p)
    if (codigo && n === codigo) return false
    if (razon && n.length >= 4 && (razon.includes(n) || n.includes(razon))) return false
    return true
  })
  return propias.length > 0 ? propias.join(' - ') : nombre.trim()
}

/**
 * De qué clase es un movimiento de la cuenta, según su "🤖Movimiento". La traducción desde los
 * índices del tablero la hace el servicio: estas reglas no conocen a Monday.
 */
export type ClaseMovimiento =
  | 'venta'
  | 'cobro'
  | 'anticipo'
  | 'saldoInicial'
  | 'creditoPase'
  | 'debitoPase'
  | 'otro'

/** Lo que hace falta para nombrar un movimiento. */
export interface DatosNombreMovimiento {
  clase: ClaseMovimiento
  /** Etiqueta de "🤖Movimiento" tal como la publica el tablero. */
  etiqueta: string
  /** Nombre del subelemento. */
  nombre: string
  cliente: { codigo: string; name: string }
  /** Venta: el número de su factura ("VTA-111"), si se pudo leer. */
  nroFactura?: string
  /** Anticipo: su "🤖ID Anticipo" ("ANTICIPO-020"), si se pudo resolver. */
  idAnticipo?: string
  /** Nombres de los ítems conectados en "🤖Origen": ahí puede estar el recibo de un cobro. */
  nombresOrigen?: readonly string[]
}

/** El primer "RECIBO-XXX" de un texto, en mayúsculas. Vacío si no hay ninguno. */
export const reciboEn = (texto: string): string =>
  (texto.match(/RECIBO-\d+/i)?.[0] ?? '').toUpperCase()

/** Cómo se llaman las dos patas del pase si el tablero no publicara la etiqueta. */
const ROTULO_PASE: Record<'creditoPase' | 'debitoPase', string> = {
  creditoPase: 'Credito x Pase de Saldo',
  debitoPase: 'Debito x Pase de Saldo',
}

/**
 * El "Nro de Comprobante" de un movimiento en el resumen. Los nombres de los subelementos son
 * INTERNOS ("Mov - Recibo - RECIBO-072 - 7001 - La Batea S.A"), así que cada clase se nombra con lo
 * que el cliente reconoce:
 *
 *   · VENTA          · el número de la factura ("VTA-111").
 *   · COBRO          · el recibo, solo: "RECIBO-072". Se busca en el nombre del movimiento y, si no
 *                      está, en lo que tenga conectado en "🤖Origen".
 *   · ANTICIPO       · "Pago por Anticipo - ANTICIPO-020", con el "🤖ID Anticipo".
 *   · SALDO INICIAL  · "Saldo Inicial".
 *   · PASE DE SALDO  · el nombre del movimiento tal cual lo publica el tablero: "Credito x Pase de
 *                      Saldo" o "Debito x Pase de Saldo".
 *   · el resto       · el nombre del subelemento sin el código ni la razón social del cliente.
 *
 * Cuando falta el dato con el que se nombra una clase —una venta sin factura, un cobro sin recibo—,
 * se cae al nombre limpio: siempre hay algo con qué identificar la fila. El anticipo sin su ID queda
 * en "Pago por Anticipo", sin inventarle un número.
 */
export function comprobanteDeMovimiento(d: DatosNombreMovimiento): string {
  const limpio = () => nombreSinCliente(d.nombre, d.cliente)
  switch (d.clase) {
    case 'venta':
      return d.nroFactura || limpio()
    case 'cobro':
      return reciboEn(d.nombre) || (d.nombresOrigen ?? []).map(reciboEn).find(Boolean) || limpio()
    case 'anticipo':
      return d.idAnticipo ? `Pago por Anticipo - ${d.idAnticipo}` : 'Pago por Anticipo'
    case 'saldoInicial':
      return 'Saldo Inicial'
    case 'creditoPase':
    case 'debitoPase':
      return d.etiqueta.trim() || ROTULO_PASE[d.clase]
    default:
      return limpio()
  }
}

/* ===== Paginado de la tabla de movimientos ===== */

/** Cuántos movimientos se muestran por página en la etapa del rango de fechas. */
export const MOVIMIENTOS_POR_PAGINA = 10

export interface Pagina<T> {
  /** Las filas de ESTA página. */
  items: T[]
  /** La página en pantalla (1-based), ya acotada a las que existen. */
  pagina: number
  totalPaginas: number
  /** Posición (1-based) de la primera y la última fila de la página; 0 y 0 sin filas. */
  desde: number
  hasta: number
  total: number
  /**
   * Cuántas filas le FALTAN a esta página para llegar a `porPagina`. La tabla las rellena en blanco
   * para que su alto no cambie al pasar a la última página, que suele venir incompleta.
   */
  vacias: number
}

/**
 * Una página de la lista. La página pedida se ACOTA a las que existen: si la lista se achica —otro
 * período con menos movimientos—, se muestra la última en vez de una página vacía.
 */
export function paginar<T>(lista: readonly T[], pagina: number, porPagina: number): Pagina<T> {
  const total = lista.length
  const totalPaginas = Math.max(1, Math.ceil(total / porPagina))
  const actual = Math.min(Math.max(1, Math.floor(pagina) || 1), totalPaginas)
  const inicio = (actual - 1) * porPagina
  const items = lista.slice(inicio, inicio + porPagina)
  return {
    items,
    pagina: actual,
    totalPaginas,
    desde: total === 0 ? 0 : inicio + 1,
    hasta: inicio + items.length,
    total,
    vacias: Math.max(porPagina - items.length, 0),
  }
}

/**
 * Qué números de página se ofrecen como botón. Con pocas páginas, todas; con muchas, la primera, la
 * última y las vecinas de la actual, con "…" en los saltos: una fila de treinta botones no ayuda a
 * encontrar nada.
 */
export function paginasVisibles(actual: number, totalPaginas: number): (number | '…')[] {
  if (totalPaginas <= 7) return Array.from({ length: totalPaginas }, (_, i) => i + 1)
  const vecinas = new Set([1, totalPaginas, actual - 1, actual, actual + 1])
  const numeros = [...vecinas].filter((n) => n >= 1 && n <= totalPaginas).sort((a, b) => a - b)
  const resultado: (number | '…')[] = []
  numeros.forEach((n, i) => {
    if (i > 0 && n - numeros[i - 1] > 1) resultado.push('…')
    resultado.push(n)
  })
  return resultado
}

/** Los tres totales del período: lo que sumaron las ventas, lo cobrado y el saldo con que termina. */
export function totalesDelPeriodo(
  movimientos: readonly { ventas: number; cobros: number; saldoFinal: number }[],
): { ventas: number; cobros: number; saldoFinal: number } {
  return {
    ventas: round2(movimientos.reduce((acc, m) => acc + m.ventas, 0)),
    cobros: round2(movimientos.reduce((acc, m) => acc + m.cobros, 0)),
    /* El saldo con el que la cuenta TERMINA el período es el del último movimiento: cada uno arrastra
       el del anterior. Sumar saldos no tendría sentido. */
    saldoFinal: movimientos.length > 0 ? movimientos[movimientos.length - 1].saldoFinal : 0,
  }
}

/* ===== Facturas que debe ===== */

/**
 * El número de una factura a partir del nombre de su ítem ("VTA-111 - 7001 - La Batea S.A TEST" →
 * "VTA-111"). Hoy el número es el de la venta que la originó; el día que la factura tenga su número
 * real, se cambia acá. Sin un "VTA-XXX" en el nombre, el nombre sin el cliente.
 */
export const nroDeFactura = (nombre: string, cliente: { codigo: string; name: string }): string =>
  (nombre.match(/VTA-\d+/i)?.[0] ?? '').toUpperCase() || nombreSinCliente(nombre, cliente)

/**
 * Los tres totales de las facturas que debe: TOTAL DEUDA (lo facturado), TOTAL COBRADO (lo que ya se
 * cobró de ellas) y DEUDA PENDIENTE (lo que queda). Se suman los pendientes que publica el tablero y
 * no se restan los otros dos: así el total dice lo mismo que la columna de la tabla.
 */
export function totalesDeFacturas(
  facturas: readonly { importe: number; cobrado: number; pendiente: number }[],
): { deuda: number; cobrado: number; pendiente: number } {
  const suma = (campo: 'importe' | 'cobrado' | 'pendiente') =>
    round2(facturas.reduce((acc, f) => acc + f[campo], 0))
  return { deuda: suma('importe'), cobrado: suma('cobrado'), pendiente: suma('pendiente') }
}

/* ===== Documentos a generar (etapa Emitir y Enviar) ===== */

/**
 * Los números del "Detalle de Movimientos" del resumen: la fila de SALDO INICIAL con la que abre el
 * período y la de TOTAL con la que cierra.
 *
 *   · Saldo inicial · con cuánto venía la cuenta al empezar el período: el saldo inicial del PRIMER
 *                     movimiento. Sin movimientos no hay de dónde leerlo, y queda en 0.
 *   · Debe / Haber  · lo que sumaron las ventas y lo que restaron los cobros del período.
 *   · Saldo         · con cuánto termina: el saldo final del ÚLTIMO movimiento (o el inicial, si no
 *                     hubo ninguno).
 */
export function detalleDeMovimientos(
  movimientos: readonly { saldoInicial: number; ventas: number; cobros: number; saldoFinal: number }[],
): { saldoInicial: number; debe: number; haber: number; saldo: number } {
  const { ventas, cobros, saldoFinal } = totalesDelPeriodo(movimientos)
  const saldoInicial = movimientos.length > 0 ? movimientos[0].saldoInicial : 0
  return {
    saldoInicial,
    debe: ventas,
    haber: cobros,
    saldo: movimientos.length > 0 ? saldoFinal : saldoInicial,
  }
}

/**
 * Los números del "Estado de Cta Cte": los TOTALES de la tabla de comprobantes pendientes y cómo se
 * reparte la deuda entre lo que está AL DÍA y lo VENCIDO.
 *
 * Qué está vencido lo dice el "🤖Estado de Vencimiento" del tablero —el mismo que muestra la
 * columna—, para que la franja no contradiga a la tabla. Una factura sin ese estado se decide por su
 * fecha de vencimiento contra `hoy`; sin fecha tampoco, se la cuenta al día: no hay cómo afirmar que
 * venció.
 */
export function estadoDeCuenta(
  facturas: readonly {
    importe: number
    cobrado: number
    pendiente: number
    vencimiento: string
    tonoVencimiento: 'ok' | 'alerta' | 'vencida' | null
  }[],
  hoy: string,
): { importe: number; pagado: number; pendiente: number; aVencer: number; vencido: number } {
  const vencida = (f: (typeof facturas)[number]) =>
    f.tonoVencimiento !== null ? f.tonoVencimiento !== 'ok' : !!f.vencimiento && f.vencimiento < hoy
  const { deuda, cobrado, pendiente } = totalesDeFacturas(facturas)
  const vencido = round2(facturas.filter(vencida).reduce((acc, f) => acc + f.pendiente, 0))
  return { importe: deuda, pagado: cobrado, pendiente, vencido, aVencer: round2(pendiente - vencido) }
}


/** Las dos respuestas posibles de "Estado de Cta Cte", con su rótulo. */
export const OPCIONES_ESTADO_CTA_CTE: readonly { valor: EstadoCtaCteResumen; label: string }[] = [
  { valor: 'INCLUIR', label: 'INCLUIR' },
  { valor: 'NO_INCLUIR', label: 'NO INCLUIR' },
]

/** Los formatos del archivo, en el orden del selector. */
export const FORMATOS_RESUMEN: readonly FormatoResumen[] = ['Excel', 'PDF', 'Ambos']

/**
 * Lo que se dice al intentar avanzar sin declarar el estado de la cuenta. UN solo texto para la
 * ventana y el pie del paso: es el mismo hueco.
 */
export const MSG_SIN_ESTADO_CTA_CTE =
  'Para continuar tenés que especificar en "Estado de Cta Cte" si el resumen de cuenta corriente se emite con el estado de la cuenta corriente (INCLUIR) o sin él (NO INCLUIR).'
