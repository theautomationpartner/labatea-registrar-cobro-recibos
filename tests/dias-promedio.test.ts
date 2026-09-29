/**
 * Días promedio de cobro: que la app dé EXACTAMENTE lo mismo que la planilla "Comp de cobranzas"
 * y que el módulo de Make que lo calcula al emitir. Si los dos números se separan, el recibo en
 * pantalla y el del tablero dirían cosas distintas.
 */
import { diasPromedioCobro, formatoDiasPromedio } from '@/lib/diasPromedio'
import type { ComprobanteCancelado } from '@/lib/recibo'

let fallas = 0
const chequear = (grupo: string, nombre: string, ok: boolean) => {
  if (!ok) fallas++
  console.log(`${ok ? 'OK    ' : 'FALLA '} ${grupo} · ${nombre}`)
}

const fact = (nro: string, vencimiento: string, cancelado: number): ComprobanteCancelado => ({
  id: nro,
  nro,
  emision: '',
  vencimiento,
  cancelado,
})

/* ── El caso de la planilla: 7 facturas, recibo del 03/08/2026 ── */
const excel = [
  fact('FA-7356', '10/06/2026', 342918.26),
  fact('FA-22377', '13/06/2026', 524313.01),
  fact('FA-45813', '23/06/2026', 212152.4),
  fact('FA-45848', '26/06/2026', 42125.16),
  fact('FA-45900', '03/07/2026', 263481.81),
  fact('FA-45928', '08/07/2026', 94181.98),
  fact('FA-45939', '10/07/2026', 70379.48),
]
const r = diasPromedioCobro(excel, '03/08/2026')
chequear('planilla', 'vencimiento promedio 20/06/2026', r?.ok === true && r.fecha === '20/06/2026')
chequear('planilla', '44 días', r?.ok === true && r.dias === 44)
chequear('planilla', 'formato', r !== null && formatoDiasPromedio(r) === '20/06/2026 (44 Dias)')

/* ── Pondera por importe y trunca ── */
const chico = diasPromedioCobro(
  [fact('A', '01/09/2026', 100000), fact('B', '21/09/2026', 250000)],
  '25/09/2026',
)
chequear('cálculo', 'ponderado y truncado: 15/09/2026, 10 días', chico?.ok === true && chico.fecha === '15/09/2026' && chico.dias === 10)

/* ── Recalcula con lo que el recibo cancela ── */
const otroImporte = diasPromedioCobro(
  [fact('A', '01/09/2026', 300000), fact('B', '21/09/2026', 50000)],
  '25/09/2026',
)
chequear('recálculo', 'otro importe mueve el promedio', otroImporte?.ok === true && otroImporte.fecha === '03/09/2026' && otroImporte.dias === 22)

/* ── Pago antes del vencimiento ── */
const anticipado = diasPromedioCobro([fact('A', '10/10/2026', 1000)], '25/09/2026')
chequear('signo', 'negativo si pagó antes', anticipado?.ok === true && anticipado.dias === -15)
chequear('signo', 'formato negativo', anticipado !== null && formatoDiasPromedio(anticipado) === '10/10/2026 (-15 Dias)')
const unDia = diasPromedioCobro([fact('A', '24/09/2026', 1000)], '25/09/2026')
chequear('formato', 'singular', unDia !== null && formatoDiasPromedio(unDia) === '24/09/2026 (1 Dia)')

/* ── Casos sin cálculo ── */
chequear('bordes', 'sin facturas → null', diasPromedioCobro([], '25/09/2026') === null)
chequear(
  'bordes',
  'sólo anticipo → null',
  diasPromedioCobro([{ ...fact('Anticipo', '', 5000), esAnticipo: true }], '25/09/2026') === null,
)
const conAnticipo = diasPromedioCobro(
  [fact('A', '01/09/2026', 1000), { ...fact('Anticipo', '', 999999), esAnticipo: true }],
  '25/09/2026',
)
chequear('bordes', 'el anticipo no pesa en el promedio', conAnticipo?.ok === true && conAnticipo.dias === 24)
const sinVenc = diasPromedioCobro([fact('A', '01/09/2026', 1000), fact('FPENCOB-042', '', 500)], '25/09/2026')
chequear('bordes', 'nombra la factura sin vencimiento', sinVenc?.ok === false && sinVenc.motivo.includes('FPENCOB-042'))

if (fallas > 0) {
  console.error(`\n${fallas} chequeo(s) fallaron`)
  process.exit(1)
}
console.log('\nTodo OK')
