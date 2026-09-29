import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import { desdeIso } from '@/lib/dates'
import { estadoDeCuenta } from '@/lib/resumenCtaCte'
import type { FacturaAdeudada, TramoVencimiento } from '@/types'
import { importeFila, importeTotal, px } from './comun'
import {
  CajaTitular,
  Encabezado,
  estilos,
  MediosDePago,
  SubtituloTabla,
  TablaPdf,
  TituloDocumento,
  type CeldaPdf,
  type ColumnaPdf,
} from './Plantilla'
import { estilosCtaCte, type BaseCtaCtePdf } from './ResumenCtaCtePdf'

export interface DatosEstadoCtaCtePdf extends BaseCtaCtePdf {
  /** `facturas_pendientes`. */
  facturas: readonly FacturaAdeudada[]
}

/**
 * Color de cada tramo vencido: las clases del template (`vencido-0-15`, `vencido-15-30`,
 * `vencido-30-60`, `vencido-mas-60`). Lo que no venció queda en el #444 de la tabla.
 */
const COLOR_TRAMO: Record<Exclude<TramoVencimiento, 'noVencido'>, string> = {
  vencido0a15: '#fdab3d',
  vencido15a30: '#ff7575',
  vencido30a60: '#bb3354',
  vencidoMas60: '#ce3048',
}

const s = StyleSheet.create({
  // td.estado-col { font-weight: bold; font-size: 10px }
  estadoCol: { fontFamily: 'Helvetica-Bold', fontSize: px(10) },
  pendiente: { fontFamily: 'Helvetica-Bold' },
  // .credito-box { padding: 15px 0; margin-bottom: 20px; border-top/bottom: 1px solid #e2e8f0 }
  creditoBox: {
    flexDirection: 'row',
    paddingVertical: px(15),
    marginBottom: px(20),
    borderTopWidth: px(1),
    borderBottomWidth: px(1),
    borderColor: '#e2e8f0',
  },
  // .credito-item { text-align: center; border-right: 1px solid #d1d5db }
  creditoItem: { flex: 1, alignItems: 'center', borderRightWidth: px(1), borderRightColor: '#d1d5db' },
  creditoItemUltimo: { borderRightWidth: 0 },
  // .credito-label { font-size: 9px; color: #64748b; uppercase; margin-bottom: 4px; bold }
  creditoLabel: {
    fontFamily: 'Helvetica-Bold',
    fontSize: px(9),
    color: '#64748b',
    textTransform: 'uppercase',
    marginBottom: px(4),
  },
  // .credito-valor { font-size: 15px; font-weight: bold; color: #1e293b }
  creditoValor: { fontFamily: 'Helvetica-Bold', fontSize: px(15), color: '#1e293b' },
})

const COLUMNAS: ColumnaPdf[] = [
  { titulo: 'Comprobante', alinear: 'left' },
  { titulo: 'Vencimiento', ancho: 95 },
  { titulo: 'Importe $', ancho: 105, alinear: 'right' },
  { titulo: 'Pagado $', ancho: 100, alinear: 'right' },
  { titulo: 'Pendiente $', ancho: 105, alinear: 'right' },
  { titulo: 'Estado de Vencimiento', ancho: 150 },
]

/** Un dato del `.credito-box`. */
function Credito({ rotulo, valor, color, ultimo }: { rotulo: string; valor: number; color?: string; ultimo?: boolean }) {
  return (
    <View style={[s.creditoItem, ultimo ? s.creditoItemUltimo : {}]}>
      <Text style={s.creditoLabel}>{rotulo}</Text>
      <Text style={[s.creditoValor, color ? { color } : {}]}>{importeTotal(valor)}</Text>
    </View>
  )
}

/**
 * El PDF del ESTADO DE CUENTA: el template HTML del estado. Los "Comprobantes Pendientes de Pago" del
 * cliente —la misma tabla que la card "Estado de Cta Cte" (`ComprobantesPendientes`)— con la fila de
 * totales y, debajo, cómo se reparte la deuda entre lo que no venció y lo vencido. Las celdas de cada
 * fila vencida llevan el color de su tramo.
 */
export function EstadoCtaCtePdf({ nombre, cliente, cuentaNro, hoy, facturas, logoSrc }: DatosEstadoCtaCtePdf) {
  const estado = estadoDeCuenta(facturas, hoy)
  const filas: CeldaPdf[][] = [
    ...facturas.map((f): CeldaPdf[] => {
      const color = f.tramo && f.tramo !== 'noVencido' ? { color: COLOR_TRAMO[f.tramo] } : {}
      return [
        { texto: f.comprobante, estilo: color },
        { texto: desdeIso(f.vencimiento), estilo: color },
        importeFila(f.importe),
        importeFila(f.cobrado),
        { texto: importeFila(f.pendiente), estilo: { ...s.pendiente, ...color } },
        { texto: f.estadoVencimiento, estilo: { ...s.estadoCol, ...color } },
      ]
    }),
    ['TOTALES', '', importeFila(estado.importe), importeFila(estado.pagado), importeFila(estado.pendiente), ''],
  ]
  const ultima = filas.length - 1

  return (
    <Document title={nombre} author="La Batea S.A." subject="Estado de Cuenta">
      <Page size="A4" style={estilos.page}>
        <Encabezado logoSrc={logoSrc} />
        {/* La misma bajada que el recibo y la orden de pago ("Documento de pago"). */}
        <TituloDocumento titulo="ESTADO DE CUENTA" bajada="Documento Cta Cte" datos={[]} />
        <CajaTitular
          margenInferior={15}
          izquierda={[
            ['Cliente:', cliente.name],
            ['Dirección:', cliente.addr],
          ]}
          derecha={[
            ['CUIT:', cliente.cuit],
            ['Cuenta Nº:', cuentaNro],
          ]}
        />

        <SubtituloTabla>Comprobantes Pendientes de Pago</SubtituloTabla>
        <TablaPdf
          columnas={COLUMNAS}
          filas={filas}
          margenInferior={25}
          estiloFila={(i) => (i === ultima ? estilosCtaCte.filaTotales : undefined)}
        />

        <View style={s.creditoBox} wrap={false}>
          <Credito rotulo="Deuda Total Pendiente" valor={estado.pendiente} />
          <Credito rotulo="Total NO Vencido" valor={estado.aVencer} color="#16a34a" />
          <Credito rotulo="Total Vencido" valor={estado.vencido} color="#dc2626" ultimo />
        </View>

        <MediosDePago />
      </Page>
    </Document>
  )
}
