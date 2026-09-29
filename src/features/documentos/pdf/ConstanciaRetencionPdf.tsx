import { Document, Page } from '@react-pdf/renderer'
import { totalRetenido, type DatosConstanciaRetencionPdf } from '@/lib/documentoComprobante'
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

const COLUMNAS: ColumnaPdf[] = [
  { titulo: 'Régimen', alinear: 'left' },
  { titulo: 'Comprobante Origen', ancho: 190 },
  { titulo: 'Base Imponible', ancho: 110, alinear: 'right' },
  { titulo: 'Alícuota', ancho: 70, alinear: 'right' },
  { titulo: 'Monto Retenido', ancho: 110, alinear: 'right' },
]

/**
 * El PDF de la CONSTANCIA DE RETENCIÓN del Impuesto a las Ganancias: el template HTML que usaba
 * Make.com. Sale JUNTO con la orden de pago que practicó la retención.
 *
 *   A. Datos del agente de retención (La Batea), con su logo.
 *   B. Datos del sujeto retenido: el proveedor.
 *   C. Detalle de la retención practicada —régimen, comprobante de origen, base, alícuota y monto— y
 *      el TOTAL RETENIDO.
 */
export function ConstanciaRetencionPdf(d: DatosConstanciaRetencionPdf) {
  return (
    <Document title={d.nombre} author="La Batea S.A." subject={`Constancia de Retención ${d.certificado}`}>
      <Page size="A4" style={estilos.page}>
        {/* A. DATOS DEL AGENTE DE RETENCIÓN — `.logo img { max-width: 120px }` */}
        <Encabezado logoSrc={d.logoSrc} anchoLogo={120} />

        <TituloDocumento
          titulo="CONSTANCIA DE RETENCIÓN"
          bajada="Impuesto a las Ganancias"
          // <span style="font-size: 10px; color: #888; text-transform: uppercase; font-weight: bold;">
          estiloBajada={{ fontSize: px(10), textTransform: 'uppercase', fontFamily: 'Helvetica-Bold' }}
          datos={[
            ['Certificado Nº:', d.certificado],
            ['Fecha de Retención:', d.fechaRetencion],
            ...(d.refOrdenPago
              ? ([['Ref. O.P.:', d.refOrdenPago, { marginTop: px(3) }]] as const)
              : []),
          ]}
        />

        {/* B. DATOS DEL SUJETO RETENIDO */}
        <SubtituloTabla>Datos del Sujeto Retenido</SubtituloTabla>
        <CajaTitular
          izquierda={[
            ['Razón Social:', d.retenido.name],
            ['Domicilio:', d.retenido.addr],
          ]}
          derecha={[['C.U.I.T. N°:', d.retenido.cuit]]}
        />

        {/* C. DATOS DE LA RETENCIÓN PRACTICADA */}
        <SubtituloTabla>Detalle de la Retención Practicada</SubtituloTabla>
        <TablaPdf
          columnas={COLUMNAS}
          filas={d.retenciones.map((r) => [
            r.regimen,
            r.comprobante_origen || '-',
            r.monto_base == null ? '-' : importeFila(r.monto_base),
            r.alicuota == null ? '-' : `${num(r.alicuota)}%`,
            importeFila(r.monto_retenido),
          ])}
        />
        <TotalPdf rotulo="TOTAL RETENIDO:" importe={totalRetenido(d.retenciones)} />

        <Leyenda>Documento emitido según normativas vigentes de A.F.I.P.</Leyenda>
      </Page>
    </Document>
  )
}
