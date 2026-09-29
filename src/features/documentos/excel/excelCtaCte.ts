import type { Borders, Fill, Font, Worksheet } from 'exceljs'
import { parseIso } from '@/lib/dates'
import { round2 } from '@/lib/format'
import { detalleDeMovimientos, estadoDeCuenta } from '@/lib/resumenCtaCte'
import type { DatosEstadoCtaCtePdf } from '../pdf/EstadoCtaCtePdf'
import type { DatosResumenCtaCtePdf } from '../pdf/ResumenCtaCtePdf'

/*
 * Los Excel del RESUMEN y del ESTADO DE CTA CTE, con el mismo armado que la planilla de Google
 * Sheets de la que salían en el escenario de Make: el encabezado de La Batea, el bloque del cliente
 * (con las mismas celdas combinadas), la tabla con su fila de totales y los medios de pago al pie.
 *
 * Las fechas van como FECHAS y los importes como NÚMEROS —no como texto con formato—: es lo que
 * permite ordenar, filtrar y sumar la planilla, que es para lo que el cliente la pide en Excel.
 *
 * `exceljs` entra por `import()`, igual que react-pdf: sólo hace falta al emitir el resumen, y así no
 * engorda la carga inicial de la app.
 */

const VIOLETA = 'FF5C4B8E'
const FORMATO_IMPORTE = '"$"#,##0.00'
const FORMATO_FECHA = 'dd/mm/yyyy'

const fuente = (extra: Partial<Font> = {}): Partial<Font> => ({ name: 'Arial', size: 10, ...extra })
const relleno = (argb: string): Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })
const bordeAbajo = (argb = 'FFDDDDDD'): Partial<Borders> => ({ bottom: { style: 'thin', color: { argb } } })

/** Una fecha ISO como fecha de Excel (sin hora ni corrimiento de zona), o `null` si no hay. */
const fecha = (iso: string): Date | null => {
  const f = parseIso(iso)
  return f ? new Date(Date.UTC(f.getFullYear(), f.getMonth(), f.getDate())) : null
}

/** Encabezado de La Batea, título del documento y el bloque del cliente. Devuelve la próxima fila libre. */
function encabezado(
  hoja: Worksheet,
  titulo: string,
  cliente: { name: string; cuit: string; addr: string },
  cuentaNro: string,
  extra: readonly (readonly [string, Date | null, string, Date | null])[] = [],
): number {
  hoja.getCell('A1').value = 'LA BATEA S.A.'
  hoja.getCell('A1').font = fuente({ size: 14, bold: true, color: { argb: VIOLETA } })
  hoja.getRow(1).height = 19.5
  hoja.getCell('A2').value = 'Macaya 1273 - 7000 TANDIL   ·   Tel. 0249-4442646   ·   info@labatea.biz'
  hoja.getCell('A2').font = fuente({ color: { argb: 'FF555555' } })
  hoja.getRow(3).height = 6
  for (const col of ['A', 'B', 'C', 'D', 'E', 'F']) hoja.getCell(`${col}3`).border = bordeAbajo(VIOLETA)
  hoja.getCell('A4').value = titulo
  hoja.getCell('A4').font = fuente({ size: 16, bold: true })
  hoja.getRow(4).height = 24

  const filasCliente: [string, string | Date | null, string, string | Date | null][] = [
    ['CLIENTE', cliente.name, 'CUIT', cliente.cuit],
    ['DIRECCIÓN', cliente.addr, 'CUENTA Nº', cuentaNro],
    ...extra.map((e) => [...e] as [string, Date | null, string, Date | null]),
  ]
  filasCliente.forEach(([r1, v1, r2, v2], i) => {
    const n = 6 + i
    const fila = hoja.getRow(n)
    fila.height = 18
    hoja.mergeCells(`B${n}:C${n}`)
    hoja.mergeCells(`E${n}:F${n}`)
    for (const [col, valor, esRotulo] of [
      ['A', r1, true],
      ['B', v1, false],
      ['D', r2, true],
      ['E', v2, false],
    ] as const) {
      const celda = hoja.getCell(`${col}${n}`)
      celda.value = valor ?? ''
      celda.font = fuente(esRotulo ? { bold: true, color: { argb: 'FF555555' }, size: 9 } : {})
      celda.fill = relleno('FFF8F9FA')
      if (valor instanceof Date) celda.numFmt = FORMATO_FECHA
      celda.alignment = { vertical: 'middle', horizontal: 'left', wrapText: !esRotulo }
    }
  })
  return 6 + filasCliente.length + 1
}

/** El título de la tabla y su fila de encabezados. Devuelve la primera fila de datos. */
function cabeceraTabla(hoja: Worksheet, desde: number, titulo: string, columnas: readonly string[]): number {
  hoja.getCell(`A${desde}`).value = titulo
  hoja.getCell(`A${desde}`).font = fuente({ size: 12, bold: true })
  hoja.getRow(desde).height = 19.5
  const fila = hoja.getRow(desde + 1)
  fila.height = 25.5
  columnas.forEach((c, i) => {
    const celda = fila.getCell(i + 1)
    celda.value = c
    celda.font = fuente({ bold: true, color: { argb: 'FFFFFFFF' } })
    celda.fill = relleno(VIOLETA)
    celda.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  })
  return desde + 2
}

/** Una fila de datos: fechas, textos e importes, cada uno con su formato. */
function filaDatos(hoja: Worksheet, n: number, valores: readonly (string | number | Date | null)[], opciones: { negrita?: boolean; colorTexto?: string } = {}) {
  const fila = hoja.getRow(n)
  fila.height = 16.5
  valores.forEach((v, i) => {
    const celda = fila.getCell(i + 1)
    celda.value = typeof v === 'number' ? round2(v) : v
    celda.font = fuente({ bold: opciones.negrita, color: opciones.colorTexto ? { argb: opciones.colorTexto } : undefined })
    celda.border = bordeAbajo()
    if (typeof v === 'number') {
      celda.numFmt = FORMATO_IMPORTE
      celda.alignment = { horizontal: 'right' }
    } else if (v instanceof Date) {
      celda.numFmt = FORMATO_FECHA
      celda.alignment = { horizontal: 'center' }
    }
  })
}

/** Los medios de pago vigentes, al pie. */
function mediosDePago(hoja: Worksheet, desde: number) {
  hoja.getCell(`A${desde}`).value = 'MEDIOS DE PAGO VIGENTES:'
  hoja.getCell(`A${desde}`).font = fuente({ bold: true })
  hoja.getCell(`A${desde + 1}`).value = 'Valores a nombre de La Batea S.A. - Trans. Bco. Credicoop-136-002902/1'
  hoja.getCell(`A${desde + 2}`).value = 'CBU 1910136355013600290214 - Visa Débito y Crédito Tarjetas Rurales.'
  for (const n of [desde + 1, desde + 2]) hoja.getCell(`A${n}`).font = fuente({ color: { argb: 'FF555555' } })
}

async function libroNuevo() {
  const { default: ExcelJS } = await import('exceljs')
  const libro = new ExcelJS.Workbook()
  libro.creator = 'La Batea S.A.'
  return libro
}

const aArchivo = async (libro: { xlsx: { writeBuffer(): Promise<ArrayBuffer> } }, nombre: string): Promise<File> =>
  new File([await libro.xlsx.writeBuffer()], `${nombre}.xlsx`, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })

/** El Excel del RESUMEN DE CUENTA: los movimientos del período, con su saldo inicial y sus totales. */
export async function generarResumenCtaCteExcel(datos: DatosResumenCtaCtePdf): Promise<File> {
  const libro = await libroNuevo()
  const hoja = libro.addWorksheet('Resumen de Cuenta', {
    views: [{ showGridLines: false }],
    pageSetup: { fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  })
  hoja.columns = [{ width: 12 }, { width: 46 }, { width: 13 }, { width: 14 }, { width: 14 }, { width: 15 }]

  const detalle = detalleDeMovimientos(datos.movimientos)
  let n = encabezado(hoja, 'RESUMEN DE CUENTA', datos.cliente, datos.cuentaNro, [
    ['PERÍODO DESDE', fecha(datos.periodo.desde), 'PERÍODO HASTA', fecha(datos.periodo.hasta)],
  ])
  n = cabeceraTabla(hoja, n, 'Detalle de Movimientos', ['Fecha', 'Comprobante', 'Vencimiento', 'Debe $', 'Haber $', 'Saldo $'])

  filaDatos(hoja, n++, [fecha(datos.periodo.desde), 'Saldo Inicial', '', null, null, detalle.saldoInicial], { negrita: true })
  for (const m of datos.movimientos) {
    const vence = m.esVentaPendiente && m.vencimiento ? m.vencimiento : ''
    filaDatos(hoja, n++, [
      fecha(m.emision),
      m.comprobante,
      vence ? fecha(vence) : '',
      m.ventas || null,
      m.cobros || null,
      m.saldoFinal,
    ])
  }
  filaDatos(hoja, n++, ['TOTAL', '', '', detalle.debe, detalle.haber, detalle.saldo], { negrita: true })

  mediosDePago(hoja, n + 1)
  return aArchivo(libro, datos.nombre)
}

/** El Excel del ESTADO DE CUENTA: los comprobantes pendientes y cómo se reparte la deuda. */
export async function generarEstadoCtaCteExcel(datos: DatosEstadoCtaCtePdf): Promise<File> {
  const libro = await libroNuevo()
  const hoja = libro.addWorksheet('Estado de Cuenta', {
    views: [{ showGridLines: false }],
    pageSetup: { fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  })
  hoja.columns = [{ width: 22 }, { width: 14 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 24 }]

  const estado = estadoDeCuenta(datos.facturas, datos.hoy)
  let n = encabezado(hoja, 'ESTADO DE CUENTA', datos.cliente, datos.cuentaNro)
  n = cabeceraTabla(hoja, n, 'Comprobantes Pendientes de Pago', [
    'Comprobante',
    'Vencimiento',
    'Importe $',
    'Pagado $',
    'Pendiente $',
    'Estado de Vencimiento',
  ])
  for (const f of datos.facturas) {
    const vencida = f.tramo !== null && f.tramo !== 'noVencido'
    filaDatos(
      hoja,
      n++,
      [f.comprobante, fecha(f.vencimiento), f.importe, f.cobrado, f.pendiente, f.estadoVencimiento],
      { colorTexto: vencida ? 'FFD00000' : undefined },
    )
  }
  filaDatos(hoja, n++, ['TOTALES', null, estado.importe, estado.pagado, estado.pendiente, ''], { negrita: true })

  n += 1
  for (const [rotulo, valor, color] of [
    ['TOTAL A VENCER', estado.aVencer, 'FF00A859'],
    ['TOTAL VENCIDO', estado.vencido, 'FFD00000'],
    ['DEUDA TOTAL PENDIENTE', estado.pendiente, 'FF1E293B'],
  ] as const) {
    hoja.getRow(n).height = 18
    hoja.getCell(`A${n}`).value = rotulo
    hoja.getCell(`A${n}`).font = fuente({ bold: true })
    const celda = hoja.getCell(`C${n}`)
    celda.value = round2(valor)
    celda.numFmt = FORMATO_IMPORTE
    celda.font = fuente({ bold: true, color: { argb: color } })
    n++
  }

  mediosDePago(hoja, n + 1)
  return aArchivo(libro, datos.nombre)
}
