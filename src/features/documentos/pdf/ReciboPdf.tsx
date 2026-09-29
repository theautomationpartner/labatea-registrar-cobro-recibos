import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import {
  diasPromedioDelPdf,
  filasComprobantes,
  filasPagos,
  totalComprobantes,
  variablesRecibo,
  type DatosReciboPdf,
} from '@/lib/documentoComprobante'
import { importeFila, num, px } from './comun'
import {
  CajaTitular,
  Encabezado,
  estilos,
  Leyenda,
  SubtituloTabla,
  TablaPdf,
  TituloDocumento,
  TotalPdf,
  type ColumnaPdf,
} from './Plantilla'

const s = StyleSheet.create({
  // .saldo-pendiente-container { margin-top: 40px; padding-top: 15px; border-top: 1px dashed #bbb; text-align: right }
  saldo: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'baseline',
    marginTop: px(40),
    paddingTop: px(15),
    borderTopWidth: px(1),
    borderTopStyle: 'dashed',
    borderTopColor: '#bbb',
  },
  // .saldo-label { font-size: 16px; font-weight: bold; color: #333; margin-right: 15px }
  saldoLabel: { fontFamily: 'Helvetica-Bold', fontSize: px(16), color: '#333', marginRight: px(15) },
  // .saldo-monto { font-size: 18px; font-weight: bold; color: #d92121 }
  saldoMonto: { fontFamily: 'Helvetica-Bold', fontSize: px(18), color: '#d92121' },
  // .dias-label { font-size: 16px; font-weight: bold; color: #333; margin-left: 40px; margin-right: 15px }
  diasLabel: { fontFamily: 'Helvetica-Bold', fontSize: px(16), color: '#333', marginLeft: px(40), marginRight: px(15) },
  // .dias-monto { font-size: 18px; font-weight: bold; color: #000000 }
  diasMonto: { fontFamily: 'Helvetica-Bold', fontSize: px(18), color: '#000' },
})

/**
 * El PDF del RECIBO: el template HTML del recibo, con sus variables (`doc_tipo`, `mostrar_recibimos`,
 * `subtitulo_sup`, `col_sup`, `tot_sup`, `subtitulo_inf`, `col_inf`, `tot_inf`) resueltas por
 * recorrido en `variablesRecibo`.
 *
 *   · Tabla 1 — los PAGOS (orígenes): forma de pago / caja, nro de comprobante e importe.
 *   · Tabla 2 — los COMPROBANTES (destinos): lo que el recibo cancela, con sus fechas.
 *   · Al pie, el saldo pendiente de la cuenta corriente y, en un cobro contra facturas, los días
 *     promedio de cobro.
 */
export function ReciboPdf(d: DatosReciboPdf) {
  const v = variablesRecibo(d.variante)
  const dias = diasPromedioDelPdf(d.diasPromedio)
  const pagos = filasPagos(d)
  const comprobantes = filasComprobantes(d)

  const colsSup: ColumnaPdf[] = [
    { titulo: v.col_sup, alinear: 'left' },
    { titulo: 'Nro de comprobante', ancho: 230 },
    { titulo: 'Importe', ancho: 150, alinear: 'right' },
  ]
  const colsInf: ColumnaPdf[] = [
    { titulo: v.col_inf, alinear: 'left' },
    { titulo: 'Fecha Emisión', ancho: 140 },
    { titulo: 'Fecha Venc.', ancho: 140 },
    { titulo: 'Importe', ancho: 150, alinear: 'right' },
  ]

  return (
    <Document title={d.nombre} author="La Batea S.A." subject={`Recibo ${d.numero}`}>
      <Page size="A4" style={estilos.page}>
        <Encabezado logoSrc={d.logoSrc} />

        <TituloDocumento
          titulo="RECIBO"
          bajada={v.doc_tipo}
          datos={[
            ['Nº de Documento:', d.numero],
            ['Fecha de Emisión:', d.fechaEmision],
          ]}
        />

        <CajaTitular
          izquierda={[
            ['Cliente:', d.titular.name],
            ['Dirección:', d.titular.addr],
          ]}
          derecha={[['CUIT:', d.titular.cuit]]}
        />

        {v.mostrar_recibimos && <Leyenda>RECIBIMOS CONFORME EL IMPORTE DETALLADO.</Leyenda>}

        {/* TABLA 1: ORÍGENES / PAGOS / DÉBITO */}
        {v.subtitulo_sup && <SubtituloTabla>{v.subtitulo_sup}</SubtituloTabla>}
        <TablaPdf
          columnas={colsSup}
          filas={pagos.map((p) => [p.caja, p.nro_comprobante, importeFila(p.importe)])}
        />
        <TotalPdf rotulo={v.tot_sup} importe={d.documento.totalEntregado} />

        {/* TABLA 2: DESTINOS / COMPROBANTES / CRÉDITO */}
        <SubtituloTabla>{v.subtitulo_inf}</SubtituloTabla>
        <TablaPdf
          columnas={colsInf}
          filas={comprobantes.map((c) => [
            c.comprobante,
            c.fecha_emision_comp,
            c.fecha_vencimiento_comp,
            importeFila(c.importe),
          ])}
        />
        <TotalPdf rotulo={v.tot_inf} importe={totalComprobantes(d)} />

        {/* SALDO PENDIENTE Y DÍAS PROMEDIO */}
        <View style={s.saldo} wrap={false}>
          <Text style={s.saldoLabel}>Saldo Pendiente Cta Cte:</Text>
          <Text style={s.saldoMonto}>{`$ ${d.saldoPendiente == null ? '-' : num(d.saldoPendiente)}`}</Text>
          {dias && (
            <>
              <Text style={s.diasLabel}>Días Promedio:</Text>
              <Text style={s.diasMonto}>{dias}</Text>
            </>
          )}
        </View>
      </Page>
    </Document>
  )
}
