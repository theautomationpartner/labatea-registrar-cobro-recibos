/** Fechas: Monday las guarda en ISO (yyyy-MM-dd) y el ERP las muestra en dd/MM/yyyy. */

const pad = (n: number) => String(n).padStart(2, '0')

const MS_DIA = 24 * 60 * 60 * 1000

/**
 * yyyy-MM-dd → Date local a medianoche. Se arma con los componentes y NO con `new Date(iso)`:
 * ese constructor interpreta la cadena como UTC, así que en Argentina (UTC−3) una fecha volvía
 * un día para atrás.
 */
export function parseIso(value: string): Date | null {
  const [y, m, d] = (value ?? '').split('-').map(Number)
  if (!y || !m || !d) return null
  const fecha = new Date(y, m - 1, d)
  return Number.isNaN(fecha.getTime()) ? null : fecha
}

/** yyyy-MM-dd → dd/MM/yyyy. Devuelve '' si no viene una fecha completa. */
export function desdeIso(value: string): string {
  const fecha = parseIso(value)
  return fecha ? `${pad(fecha.getDate())}/${pad(fecha.getMonth() + 1)}/${fecha.getFullYear()}` : ''
}

/**
 * dd/MM/yyyy → Date local a medianoche. Es el reverso de `desdeIso`: las fechas que el usuario carga
 * (vencimiento del cheque, emisión, vencimiento del plástico) viven en el estado con el formato del
 * ERP, y las reglas de negocio necesitan compararlas como fechas.
 */
export function parseDate(value: string): Date | null {
  const [d, m, y] = (value ?? '').split('/').map(Number)
  if (!d || !m || !y) return null
  const fecha = new Date(y, m - 1, d)
  return Number.isNaN(fecha.getTime()) ? null : fecha
}

/** dd/MM/yyyy → yyyy-MM-dd, el formato que piden los `input[type=date]` y Monday. */
export function aIso(value: string): string {
  const fecha = parseDate(value)
  return fecha
    ? `${fecha.getFullYear()}-${pad(fecha.getMonth() + 1)}-${pad(fecha.getDate())}`
    : ''
}

/** El día en que se opera, en dd/MM/yyyy. La fecha del cobro no se edita: siempre es hoy. */
export function hoy(): string {
  const d = new Date()
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}

/**
 * El día SIGUIENTE al de la operación, en dd/MM/yyyy. Es el primer vencimiento que una tarjeta
 * puede tener para seguir vigente (ver `vencimientoTarjetaInvalido`), y con él el calendario del
 * campo deja de ofrecer fechas que la validación va a rechazar.
 */
export function manana(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}

/**
 * La misma fecha corrida `dias` hacia adelante, en dd/MM/yyyy. Vacío si no entra una fecha completa:
 * de una fecha a medio cargar no se puede derivar otra, y devolver algo igual sería inventarla.
 *
 * Se suma sobre un `Date` local a medianoche, así que los cambios de mes, de año y de horario de
 * verano los resuelve el propio calendario en vez de una cuenta de milisegundos.
 */
export function sumarDias(value: string, dias: number): string {
  const fecha = parseDate(value)
  if (!fecha) return ''
  fecha.setDate(fecha.getDate() + dias)
  return `${pad(fecha.getDate())}/${pad(fecha.getMonth() + 1)}/${fecha.getFullYear()}`
}

/**
 * Días que FALTAN hasta esa fecha, contados por día y nunca por hora. Negativo si ya pasó, 0 si es
 * hoy. Sin fecha devuelve `null`: no es lo mismo "vence hoy" que "no se sabe cuándo vence".
 *
 * Es el reverso de `diasDeMora`, que mira hacia atrás y recorta en cero. Acá el signo importa: la
 * pregunta es cuánto falta, y un vencimiento pasado tiene que poder decirse como tal.
 */
export function diasHasta(iso: string): number | null {
  const fecha = parseIso(iso)
  if (!fecha) return null
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  return Math.floor((fecha.getTime() - hoy.getTime()) / MS_DIA)
}

/**
 * Días transcurridos desde el vencimiento hasta HOY. Si todavía no venció da 0 —no días
 * negativos: "faltan 5 días" no es mora—. Sin fecha de vencimiento devuelve `null`, que la UI
 * muestra como "—": no es lo mismo no deber días que no saber cuántos.
 */
export function diasDeMora(vencimientoIso: string): number | null {
  const venc = parseIso(vencimientoIso)
  if (!venc) return null
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  return Math.max(Math.floor((hoy.getTime() - venc.getTime()) / MS_DIA), 0)
}
