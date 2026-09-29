import { Document, Page } from '@react-pdf/renderer'
import type { ReactNode } from 'react'
import {
  esMixto,
  filasComprobantes,
  filasPagos,
  totalComprobantes,
  type DatosOrdenPagoPdf,
} from '@/lib/documentoComprobante'
import { importeFila } from './comun'
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

/*
 * La ORDEN DE PAGO tiene TRES templates HTML —el pago normal, la entrega de anticipo y la aplicación
 * de cta cte—, uno por recorrido. Comparten el encabezado, el título y el recuadro del proveedor
 * (`PaginaOrdenPago`); lo que cambia es la leyenda, las columnas y los títulos de las dos tablas.
 * Cada template es su propio componente: `OrdenPagoPdf`, `OrdenPagoAnticipoPdf`,
 * `OrdenPagoAplicacionPdf`.
 */

/** Lo común a los tres templates: `.header`, `.titulo-seccion` y `.cliente-box` del proveedor. */
function PaginaOrdenPago({ d, children }: { d: DatosOrdenPagoPdf; children: ReactNode }) {
  return (
    <Document title={d.nombre} author="La Batea S.A." subject={`Orden de Pago ${d.numero}`}>
      <Page size="A4" style={estilos.page}>
        <Encabezado logoSrc={d.logoSrc} />
        <TituloDocumento
          titulo="ORDEN DE PAGO"
          bajada="Documento de pago"
          datos={[
            ['Nº de Orden de Pago:', d.numero],
            ['Fecha de Emisión:', d.fechaEmision],
          ]}
        />
        <CajaTitular
          izquierda={[
            ['Proveedor:', d.titular.name],
            ['Dirección:', d.titular.addr],
          ]}
          derecha={[['CUIT:', d.titular.cuit]]}
        />
        {children}
      </Page>
    </Document>
  )
}

/** La tabla de `pagos` con su TOTAL ENTREGADO. `primera`: el encabezado de la primera columna. */
function TablaPagos({ d, primera }: { d: DatosOrdenPagoPdf; primera: string }) {
  const columnas: ColumnaPdf[] = [
    { titulo: primera, alinear: 'left' },
    { titulo: 'Nro de comprobante', ancho: 220 },
    { titulo: 'Importe Entregado', ancho: 160, alinear: 'right' },
  ]
  return (
    <>
      <TablaPdf
        columnas={columnas}
        filas={filasPagos(d).map((p) => [p.caja, p.nro_comprobante, importeFila(p.importe)])}
      />
      <TotalPdf rotulo="TOTAL ENTREGADO:" importe={d.documento.totalEntregado} />
    </>
  )
}

/** La tabla de `comprobantes` con su TOTAL CANCELADO. `primera`: el encabezado de la primera columna. */
function TablaComprobantes({ d, primera }: { d: DatosOrdenPagoPdf; primera: string }) {
  const columnas: ColumnaPdf[] = [
    { titulo: primera, alinear: 'left' },
    { titulo: 'Fecha Emisión', ancho: 120 },
    { titulo: 'Fecha Venc.', ancho: 120 },
    { titulo: 'Importe Cancelado', ancho: 160, alinear: 'right' },
  ]
  return (
    <>
      <TablaPdf
        columnas={columnas}
        filas={filasComprobantes(d).map((c) => [
          c.comprobante,
          c.fecha_emision_comp,
          c.fecha_vencimiento_comp,
          importeFila(c.importe),
        ])}
      />
      <TotalPdf rotulo="TOTAL CANCELADO:" importe={totalComprobantes(d)} />
    </>
  )
}

/**
 * Template "Orden de pago normal": se pagan facturas con cajas. Con `es_mixto` —el pago dejó además
 * un anticipo por el sobrante— la tabla de abajo pasa a "Facturas Pagadas y Entrega de Anticipo".
 */
export function OrdenPagoPdf(d: DatosOrdenPagoPdf) {
  const mixto = esMixto(d)
  return (
    <PaginaOrdenPago d={d}>
      <Leyenda>PAGAMOS CONFORME EL IMPORTE DETALLADO.</Leyenda>
      <TablaPagos d={d} primera="Forma de Pago / Caja" />
      <SubtituloTabla>{mixto ? 'Facturas Pagadas y Entrega de Anticipo' : 'Facturas Pagadas'}</SubtituloTabla>
      <TablaComprobantes d={d} primera={mixto ? 'Comprobantes' : 'Facturas'} />
    </PaginaOrdenPago>
  )
}

/** Template "Orden de pago por anticipo": se entrega dinero a cuenta, no hay facturas. */
export function OrdenPagoAnticipoPdf(d: DatosOrdenPagoPdf) {
  return (
    <PaginaOrdenPago d={d}>
      <Leyenda>PAGAMOS CONFORME EL IMPORTE DETALLADO.</Leyenda>
      <TablaPagos d={d} primera="Forma de Pago / Caja" />
      <SubtituloTabla>Entrega de Anticipos</SubtituloTabla>
      <TablaComprobantes d={d} primera="ANTICIPOS" />
    </PaginaOrdenPago>
  )
}

/** Template "Orden de pago por Aplicación Cta Cte": el anticipo que ya teníamos cancela facturas. */
export function OrdenPagoAplicacionPdf(d: DatosOrdenPagoPdf) {
  return (
    <PaginaOrdenPago d={d}>
      <Leyenda>APLICAMOS ANTICIPO CONFORME EL IMPORTE DETALLADO.</Leyenda>
      <TablaPagos d={d} primera="ANTICIPO" />
      <SubtituloTabla>Facturas canceladas</SubtituloTabla>
      <TablaComprobantes d={d} primera="Facturas" />
    </PaginaOrdenPago>
  )
}

/** El template que corresponde a cada recorrido. */
export const TEMPLATE_ORDEN_PAGO = {
  facturas: OrdenPagoPdf,
  anticipo: OrdenPagoAnticipoPdf,
  aplicacion: OrdenPagoAplicacionPdf,
} as const
