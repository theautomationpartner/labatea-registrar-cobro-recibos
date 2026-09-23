/**
 * El caché de facturas pendientes de cobro: que lo que guarda el cron (`api/`) sea exactamente lo
 * que el navegador sabe leer (`src/`).
 *
 * `api/` no puede importar de `src/` (ver `api/_facturasCobro.ts`), así que los ids de columna viven
 * dos veces. Este test es lo que impide que se separen: si alguien toca un id de un lado y no del
 * otro, falla acá y no en el tablero de cobranza —donde se vería como deuda que desaparece—.
 */
import {
  BOARD_FACT_PENDIENTES,
  CAMPOS_FACTURA,
  COL_FACT,
  ESTADO_CANCELADA_INDEX,
  filaDeFactura,
  type ItemFactura,
} from '../api/_facturasCobro'
import { BOARDS, COL, ESTADO_VENCIMIENTO_INDEX, FACT_PENDIENTE_ESTADO_INDEX } from '@/services/monday/columns'
import { CAMPOS_FACTURA_ADEUDADA, mapFacturaAdeudada } from '@/services/monday/resumenCtaCte'
import { config as porteroConfig } from '../middleware'
import vercel from '../vercel.json'

let fallas = 0
const chequear = (grupo: string, nombre: string, ok: boolean) => {
  if (!ok) fallas++
  console.log(`${ok ? 'OK    ' : 'FALLA '} ${grupo} · ${nombre}`)
}

/* ── Los dos mapas de columnas son el mismo ── */
chequear('columnas', 'mismo tablero', BOARD_FACT_PENDIENTES === BOARDS.factPendientes)
for (const [clave, id] of Object.entries(COL_FACT)) {
  const delNavegador = (COL.factPendiente as Record<string, string>)[clave]
  chequear('columnas', `${clave} = ${id}`, delNavegador === id)
}
chequear('columnas', 'mismo índice de "Cancelada 100%"', ESTADO_CANCELADA_INDEX === FACT_PENDIENTE_ESTADO_INDEX.cancelada)

/* Las columnas que pide el cron son las que pide el navegador para mapear la factura: ni una de
   menos (el mapeo leería vacío) ni el orden importa. */
const idsDe = (campos: string) =>
  [...(campos.match(/column_values\(ids: (\[[^\]]*\])/)?.[1].matchAll(/"([^"]+)"/g) ?? [])]
    .map((m) => m[1])
    .sort()
    .join(',')
chequear('columnas', 'el cron pide las mismas columnas que mapFacturaAdeudada', idsDe(CAMPOS_FACTURA) === idsDe(CAMPOS_FACTURA_ADEUDADA))
chequear('columnas', 'y la relación con el cliente bajo el alias `personas`', /personas: column_values\(ids: \["board_relation_mm5zaxck"\]\)/.test(CAMPOS_FACTURA))

/* ── Un ítem real del tablero (tomado de la API al escribir el cron) ── */
const ITEM: ItemFactura = {
  id: '12976668415',
  name: 'VTA-117 - 7001 - La Batea S.A TEST',
  column_values: [
    { id: 'date_mm648d33', text: '2026-09-04' },
    { id: 'numeric_mkwbck5d', text: '98285.88' },
    { id: 'lookup_mm4c3vc8', text: null, display_value: '1000, 285.88' },
    { id: 'formula_mkwbrnk1', text: '', display_value: '97000' },
    { id: 'color_mkwb727e', text: 'Cancelada Parcialmente', index: 0 },
    { id: 'date_mm647vwr', text: '2026-10-04' },
    { id: 'color_mm6symyx', text: 'Vencido 15 a 30 dias', index: 2 },
  ],
  personas: [{ id: 'board_relation_mm5zaxck', linked_item_ids: ['12524661079'] }],
}

const fila = filaDeFactura(ITEM)
chequear('fila', 'el cliente sale de la relación "🤖Personas"', fila.clienteId === '12524661079')
chequear('fila', 'el tramo es el ÍNDICE de la status', fila.tramoIndice === ESTADO_VENCIMIENTO_INDEX.vencido15a30)
chequear('fila', 'el vencimiento en ISO', fila.vencimiento === '2026-10-04')
chequear('fila', 'el ítem se guarda crudo', fila.datos === ITEM)

const sinDatos = filaDeFactura({ id: '1', name: 'x', column_values: [] })
chequear('fila', 'sin cliente conectado queda vacío (y no entra en ninguna cuenta)', sinDatos.clienteId === '')
chequear('fila', 'sin tramo queda NULL (entra sólo con los cinco tramos)', sinDatos.tramoIndice === null)
chequear('fila', 'sin fecha, NULL y no un texto que la base rechace', sinDatos.vencimiento === null)

/* El ítem que devuelve el caché —el mismo JSON, ida y vuelta por la base— se mapea igual que el que
   devuelve Monday. */
const idaYVuelta = JSON.parse(JSON.stringify(fila.datos)) as ItemFactura
const f = mapFacturaAdeudada(
  { ...idaYVuelta, column_values: idaYVuelta.column_values.map((c) => ({ text: null, ...c })) },
  { codigo: '7001', name: 'La Batea S.A TEST' },
)
chequear('mapeo', 'importe', f.importe === 98285.88)
chequear('mapeo', 'cobrado suma la mirror de varios cobros', f.cobrado === 1285.88)
chequear('mapeo', 'pendiente sale de la fórmula', f.pendiente === 97000)
chequear('mapeo', 'tramo', f.tramo === 'vencido15a30')

/* ── El cron se puede invocar ── */
const matcher: string[] = porteroConfig.matcher
chequear('portero', 'el cron NO pasa por el portero (Vercel lo llama sin Referer)', !matcher.some((m) => m.startsWith('/api/cron')))
chequear('portero', 'los endpoints de datos cacheados SÍ pasan', matcher.includes('/api/personas') && matcher.includes('/api/facturas-cobranza'))
chequear('vercel', 'el cron está programado', vercel.crons.some((c) => c.path === '/api/cron/facturas-cobro'))
chequear('vercel', 'y tiene su maxDuration', (vercel.functions as Record<string, { maxDuration: number }>)['api/cron/facturas-cobro.ts']?.maxDuration === 180)

if (fallas > 0) {
  console.error(`\n${fallas} chequeo(s) fallaron`)
  process.exit(1)
}
console.log('\nTodo OK')
