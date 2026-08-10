/**
 * Redondeo de importes: hasta dos decimales. Es el ÚNICO redondeo que se le aplica a un monto en
 * toda la app, para que lo que se muestra, lo que se calcula y lo que se escribe en Monday
 * coincidan.
 *
 * El `Number.EPSILON` corrige el arrastre binario del punto flotante: sin él, 1.005 redondea
 * a 1 en vez de a 1.01 porque en realidad vale 1.00499999999999989.
 */
export const round2 = (n: number): number =>
  Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 100) / 100 : 0

const ARS = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** "$ 10.465,78" — formato usado en toda la app, siempre con sus dos decimales. */
export const money = (n: number): string => `$ ${ARS.format(round2(n))}`

export const pct = (n: number): string => `${Math.round(n)}%`

const DEC = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })

/** Número → texto AR para un input de importe (miles con punto, coma decimal, sin símbolo). */
export const importeATexto = (n: number): string => (Number.isFinite(n) ? DEC.format(n) : '')

/**
 * Da formato ARGENTINO a lo tecleado en un input de importe: miles con punto y decimales con coma
 * (hasta 2). Devuelve el `texto` ya formateado para el input y el `valor` numérico para el estado.
 * Se descartan los puntos de miles y todo lo que no sea dígito o la coma decimal, así el usuario
 * puede escribir de corrido. Ej.: "30409" → { texto: "30.409", valor: 30409 };
 * "30409,5" → { texto: "30.409,5", valor: 30409.5 }.
 */
export function formatearImporteAR(entrada: string): { texto: string; valor: number } {
  const limpio = entrada.replace(/\./g, '').replace(/[^\d,]/g, '')
  const iComa = limpio.indexOf(',')
  const enteroRaw = (iComa >= 0 ? limpio.slice(0, iComa) : limpio).replace(/^0+(?=\d)/, '')
  const decRaw = iComa >= 0 ? limpio.slice(iComa + 1).replace(/,/g, '').slice(0, 2) : ''
  // Miles con punto en la parte entera; si sólo se tecleó la coma, se muestra "0,".
  const enteroFmt = (enteroRaw || (iComa >= 0 ? '0' : '')).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const texto = iComa >= 0 ? `${enteroFmt},${decRaw}` : enteroFmt
  const valor = round2(Number(`${enteroRaw || '0'}.${decRaw || '0'}`))
  return { texto, valor }
}
