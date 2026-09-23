/**
 * Similitud entre textos para las búsquedas que no exigen coincidencia exacta.
 *
 * Copia de `src/lib/similitud.ts` de la app de operaciones de venta: el live search de clientes y
 * proveedores (`lib/busquedaPersonas.ts`) tiene que comportarse igual en las dos apps, que buscan
 * sobre el mismo padrón. Si se ajusta allá, se ajusta acá.
 */

/** Todo se compara en minúsculas y sin espacios en los bordes. */
export const norm = (s: string): string => s.toLowerCase().trim()

/**
 * Normalización para BUSCAR: además de minúsculas, saca los acentos y unifica los espacios. Sin
 * esto, "MARTINEZ" no encuentra a "MARTÍNEZ", que en un padrón cargado a mano es la mitad de las
 * veces.
 */
export const normBusqueda = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

/**
 * La forma COMPACTA de un texto: sin acentos, en minúsculas y **sin espacios ni puntuación**.
 *
 * Existe porque nadie escribe los nombres como están cargados. Quien busca "The Automation Partner
 * S.A TEST" tipea "theautomationpartner" de un tirón, y hasta que esto existió no encontraba nada:
 * el buscador exigía reproducir cada espacio del nombre. Comparando las dos puntas compactadas, el
 * espacio deja de ser un carácter que haya que adivinar.
 *
 *   "The Automation Partner S.A TEST" → "theautomationpartnersatest"
 *   "theautomationpartner"            → "theautomationpartner"   (y ahí sí, uno empieza con el otro)
 */
export const compactar = (s: string): string => normBusqueda(s).replace(/[^a-z0-9]/g, '')

export function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (!m) return n
  if (!n) return m
  const fila = Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    let prev = fila[0]
    fila[0] = i
    for (let j = 1; j <= n; j++) {
      const tmp = fila[j]
      fila[j] = Math.min(fila[j] + 1, fila[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return fila[n]
}

/** Similitud 0..1 entre dos textos; la subcadena cuenta como coincidencia fuerte. */
export function similitud(a: string, b: string): number {
  const x = norm(a)
  const y = norm(b)
  if (!x || !y) return 0
  if (x === y) return 1
  if (y.includes(x) || x.includes(y)) return 0.9
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length)
}

/** Debajo de esto, dos textos no se consideran el mismo. */
export const UMBRAL_SIMILITUD = 0.6
