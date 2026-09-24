/**
 * La emisión del resumen de cta cte pedida por la APP, del lado del servidor:
 *
 *  · el evento que recibe Make tiene EXACTAMENTE la forma del que manda Monday por el cambio de
 *    "🤖Estado Resumen Cta Cte" a "Generar", más `appJobId` y nada más. El escenario tiene una sola
 *    estructura de datos para los dos disparadores; un campo de más o de menos la rompe.
 *  · la respuesta final del escenario se lee aunque el `mensajeError` venga con saltos de línea
 *    crudos, como sale de un texto escrito a mano en Make.
 *  · el PDF que se abre para imprimir es el del documento pedido, aunque la columna tenga también
 *    los Excel y el otro documento, y el nombre venga con guiones bajos o con espacios.
 *
 * Se corre con esbuild + node (`npm run test:emision-resumen`); vive fuera de `src/`.
 */
import { pdfDelDocumento, type ArchivoCtaCte } from '../api/_archivoResumen'
import { comoJson, eventoDeResumen, type ItemCtaCte } from '../api/_eventoResumen'

let fallas = 0
const chequear = (grupo: string, nombre: string, ok: boolean) => {
  if (!ok) fallas++
  console.log(`${ok ? 'OK    ' : 'FALLA '} ${grupo} · ${nombre}`)
}

/* ── El evento ────────────────────────────────────────────────────────────────────────────────── */

/** Un evento real de Monday (el bundle del módulo 1 del escenario). */
const DE_MONDAY = {
  app: 'monday',
  type: 'update_column_value',
  triggerTime: '2026-09-23T12:03:55.044Z',
  subscriptionId: 810765988,
  isRetry: false,
  userId: 107870718,
  originalTriggerUuid: null,
  boardId: 18421858736,
  groupId: 'topics',
  pulseId: 12736724196,
  pulseName: 'The Automation Partner S.A',
  columnId: 'color_mm76s2eq',
  columnType: 'color',
  columnTitle: '🤖Estado Resumen Cta Cte',
  value: {
    label: {
      index: 3,
      text: 'Generar',
      style: { color: '#007eb5', border: '#3db0df', var_name: 'blue-links' },
      is_done: false,
    },
    post_id: null,
  },
  previousValue: {
    label: {
      index: 5,
      text: null,
      style: { color: '#c4c4c4', border: '#b0b0b0', var_name: 'grey' },
      is_done: false,
    },
    post_id: null,
  },
  changedAt: 1790165018.6281064,
  isTopGroup: true,
  triggerUuid: '9347407c17576bdfcd3161bdf73f2622',
}

const item: ItemCtaCte = {
  id: '12736724196',
  name: 'The Automation Partner S.A',
  board: { id: '18421858736', groups: [{ id: 'topics' }, { id: 'otro' }] },
  group: { id: 'topics' },
  column_values: [{ text: '', index: 5 }],
}

const ahora = new Date('2026-09-23T12:03:55.044Z')
const evento = eventoDeResumen({ item, userId: '107870718', appJobId: 'rcc_prueba', ahora })

/** Las claves de un objeto, recursivamente, como rutas ("value.label.style.color"). */
const claves = (o: unknown, prefijo = ''): string[] =>
  o && typeof o === 'object'
    ? Object.entries(o).flatMap(([k, v]) => [`${prefijo}${k}`, ...claves(v, `${prefijo}${k}.`)])
    : []

const deMonday = claves(DE_MONDAY).sort()
const deLaApp = claves(evento).sort()
chequear(
  'evento',
  'las mismas claves que el de Monday, más appJobId',
  JSON.stringify(deLaApp) === JSON.stringify([...deMonday, 'appJobId'].sort()),
)
chequear('evento', 'appJobId viaja en la raíz del evento', evento.appJobId === 'rcc_prueba')
chequear('evento', 'los ids numéricos van como número, igual que en Monday', evento.userId === 107870718 && evento.boardId === 18421858736 && evento.pulseId === 12736724196)
chequear('evento', 'value es "Generar" con el estilo del tablero', JSON.stringify(evento.value) === JSON.stringify(DE_MONDAY.value))
chequear('evento', 'previousValue sale de la columna real', JSON.stringify(evento.previousValue) === JSON.stringify(DE_MONDAY.previousValue))
chequear('evento', 'isTopGroup: el grupo del ítem es el primero del tablero', evento.isTopGroup === true)
chequear('evento', 'triggerTime y changedAt son el mismo instante', evento.triggerTime === DE_MONDAY.triggerTime && evento.changedAt === ahora.getTime() / 1000)
chequear('evento', 'triggerUuid con el formato de Monday (32 hex)', /^[0-9a-f]{32}$/.test(evento.triggerUuid))
chequear(
  'evento',
  'columna sin valor → previousValue null; ítem en otro grupo → isTopGroup false',
  (() => {
    const e = eventoDeResumen({
      item: { ...item, group: { id: 'otro' }, column_values: [{ text: null, index: null }] },
      userId: '1',
      appJobId: 'x',
    })
    return e.previousValue === null && e.isTopGroup === false
  })(),
)

/* ── La respuesta del escenario ───────────────────────────────────────────────────────────────── */

/* El mensaje de la validación se escribe en Make con renglones a mano: llega con saltos de línea
   CRUDOS adentro del string, que JSON no admite. Tiene que leerse igual, sin romper los saltos de
   entre campos del JSON indentado. */
const validacion = comoJson(`{
  "appJobId": "rcc_1",
  "documento": "",
  "resultado": "error_validacion",
  "mensajeError": "NO pudimos generar el documento porque faltan los siguientes datos:
- ❌NO hay un formato de documento especificado.
- ",
  "executionId": "abc"
}`) as { resultado?: string; mensajeError?: string } | null
chequear('respuesta', 'JSON con saltos crudos adentro de un string se lee igual', validacion?.resultado === 'error_validacion')
chequear('respuesta', 'y el mensaje conserva sus renglones', validacion?.mensajeError?.split('\n').length === 3)
chequear('respuesta', 'un JSON válido se lee tal cual', (comoJson('{"a":"x\\ny"}') as { a: string }).a === 'x\ny')
/* Las banderas van SIN comillas: una variable vacía deja `"x":,` o `"x":}`, que tiene que leerse
   como `null` —el documento no salió— en vez de tirar abajo la respuesta entera. */
{
  const r = comoJson(
    '{"appJobId":"rcc_1","resumen_pdf_generado":true,"resumen_excel_generado":true,"estado_pdf_generado":true,"estado_excel_generado":,"resultado":"completado","executionId":"e"}',
  ) as Record<string, unknown> | null
  chequear('respuesta', 'booleanos sin comillas se leen como booleanos', r?.resumen_pdf_generado === true)
  chequear('respuesta', 'bandera vacía ("x":,) → null, y el resto se lee igual', r !== null && r.estado_excel_generado === null && r.resultado === 'completado')
}
{
  const r = comoJson('{\n  "a": true,\n  "b":   \n}') as Record<string, unknown> | null
  chequear('respuesta', 'bandera vacía al final (con espacios y saltos) → null', r !== null && r.a === true && r.b === null)
}
chequear('respuesta', 'un ":," adentro de un string no se toca', (comoJson('{"m":"a:,b","x":}') as { m: string } | null)?.m === 'a:,b')
chequear('respuesta', 'el "Accepted" de Make no es JSON → null', comoJson('Accepted') === null)
chequear('respuesta', 'cuerpo vacío → null', comoJson('') === null)

/* ── El PDF para imprimir ─────────────────────────────────────────────────────────────────────── */

const archivo = (name: string, created_at: string): ArchivoCtaCte => ({
  name,
  file_extension: name.slice(name.lastIndexOf('.')),
  public_url: `https://files/${name}`,
  created_at,
})
/* Los nombres, tal cual los dejó el escenario en una cuenta real. */
const COLUMNA = [
  archivo('Resumen_Cta_Cte-Periodo-25_07_2026-23-09-2026.pdf', '2026-09-23T12:00:34Z'),
  archivo('Estado_Cta_Cte-Fecha-23-09-2026.xlsx', '2026-09-23T12:00:57Z'),
  archivo('Resumen Cta Cte-Periodo-25-07-2026-23-09-2026.xlsx', '2026-09-23T12:01:15Z'),
]
chequear('pdf', 'el resumen: su PDF, no su Excel', pdfDelDocumento(COLUMNA, 'resumen')?.name.endsWith('.pdf') === true)
chequear('pdf', 'el estado sólo en Excel → sin PDF', pdfDelDocumento(COLUMNA, 'estado') === null)
chequear(
  'pdf',
  'el estado con espacios en el nombre también se encuentra',
  pdfDelDocumento([...COLUMNA, archivo('Estado Cta Cte-Fecha-23-09-2026.pdf', '2026-09-23T12:02:00Z')], 'estado') !== null,
)
chequear(
  'pdf',
  'si quedó uno viejo, el más nuevo',
  pdfDelDocumento(
    [archivo('Resumen_Cta_Cte-viejo.pdf', '2026-08-01T10:00:00Z'), ...COLUMNA],
    'resumen',
  )?.name === COLUMNA[0].name,
)
chequear('pdf', 'columna vacía → sin PDF', pdfDelDocumento([], 'resumen') === null)

if (fallas > 0) {
  console.error(`\n${fallas} chequeo(s) fallaron`)
  process.exit(1)
}
console.log('\nTodo OK')
