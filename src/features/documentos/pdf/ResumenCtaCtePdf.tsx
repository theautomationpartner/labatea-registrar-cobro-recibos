import { Document, Page, StyleSheet } from '@react-pdf/renderer'
import { desdeIso, desdeIsoCorta, desdeIsoDiaMes } from '@/lib/dates'
import { detalleDeMovimientos } from '@/lib/resumenCtaCte'
import type { MovimientoCtaCte } from '@/types'
import { importeFila, px } from './comun'
import {
  CajaTitular,
  Encabezado,
  estilos,
  MediosDePago,
  SubtituloTabla,
  TablaPdf,
  TituloDocumento,
  VIOLETA,
  type CeldaPdf,
  type ColumnaPdf,
} from './Plantilla'

/** Lo que comparten los dos documentos de la cuenta corriente. */
export interface BaseCtaCtePdf {
  /** Nombre del archivo, sin extensión: también es el título del documento. */
  nombre: string
  cliente: { name: string; cuit: string; addr: string }
  /** `cuenta_numero`: el "🤖ID Cta Cte" de la cuenta ("CTACTEC-003"). Vacío si no se pudo leer. */
  cuentaNro: string
  /** Hoy, en ISO: con él se decide qué está vencido. */
  hoy: string
  logoSrc?: string
}

export interface DatosResumenCtaCtePdf extends BaseCtaCtePdf {
  /** `fecha_desde` / `fecha_hasta`: las dos puntas del período, en ISO. */
  periodo: { desde: string; hasta: string }
  movimientos: readonly MovimientoCtaCte[]
}

const e = StyleSheet.create({
  // tr.fila-saldo-inicial td { font-weight: bold; color: #222 }
  saldoInicialCelda: { fontFamily: 'Helvetica-Bold', color: '#222' },
  // tr.fila-totales td { border-top: 2px solid #5c4b8e; border-bottom: none }
  totalesFila: { borderTopWidth: px(2), borderTopColor: VIOLETA, borderBottomWidth: 0 },
  // tr.fila-totales td { font-weight: bold; color: #000; padding-top/bottom: 10px; font-size: 12px }
  totalesCelda: { fontFamily: 'Helvetica-Bold', color: '#000', paddingTop: px(10), paddingBottom: px(10), fontSize: px(12) },
})

/** Las filas especiales de las tablas de la cuenta corriente, para `TablaPdf.estiloFila`. */
export const estilosCtaCte = {
  filaSaldoInicial: { celda: e.saldoInicialCelda },
  filaTotales: { fila: e.totalesFila, celda: e.totalesCelda },
}

const s = StyleSheet.create({
  // .texto-rojo { color: #dc2626 !important; font-weight: bold }
  textoRojo: { color: '#dc2626', fontFamily: 'Helvetica-Bold' },
})

/* El ancho útil de la página es de ~680 px: las columnas de importes se llevan lo justo para un
   "$2.780.000,00" (`white-space: nowrap`) y el comprobante, que es el texto largo, el resto. */
const COLUMNAS: ColumnaPdf[] = [
  { titulo: 'Fecha', ancho: 70 },
  { titulo: 'Comprobante', alinear: 'left' },
  { titulo: 'Vencimiento', ancho: 80 },
  { titulo: 'Saldo Inicial $', ancho: 98, alinear: 'right' },
  { titulo: 'Debe $', ancho: 92, alinear: 'right' },
  { titulo: 'Haber $', ancho: 92, alinear: 'right' },
  { titulo: 'Saldo $', ancho: 98, alinear: 'right' },
]

/** Un importe que la fila no mueve se deja vacío (`{{#if this.debe}}`), como en la card. */
const importeOVacio = (n: number): string => (n === 0 ? '' : importeFila(n))

/**
 * El PDF del RESUMEN DE CUENTA: el template HTML del resumen. El "Detalle de Movimientos" del
 * período —la misma tabla que la card "Resumen de Cta Cte" (`DetalleMovimientos`)—: la fila de saldo
 * inicial, una por movimiento y la de totales, integrada en la tabla. La venta VENCIDA lleva su
 * vencimiento y su debe en rojo (`is_vencido`).
 */
export function ResumenCtaCtePdf({ nombre, cliente, cuentaNro, hoy, periodo, movimientos, logoSrc }: DatosResumenCtaCtePdf) {
  const detalle = detalleDeMovimientos(movimientos)
  const filas: CeldaPdf[][] = [
    [desdeIso(periodo.desde), 'Saldo Inicial', '', '', '', '', importeFila(detalle.saldoInicial)],
    ...movimientos.map((m): CeldaPdf[] => {
      const vence = m.esVentaPendiente && m.vencimiento ? m.vencimiento : ''
      const vencido = vence !== '' && vence < hoy
      const rojo = vencido ? s.textoRojo : undefined
      return [
        desdeIsoCorta(m.emision),
        m.comprobante,
        { texto: vence ? desdeIsoDiaMes(vence) : '', estilo: rojo },
        importeFila(m.saldoInicial),
        { texto: importeOVacio(m.ventas), estilo: rojo },
        importeOVacio(m.cobros),
        importeFila(m.saldoFinal),
      ]
    }),
    ['TOTAL', '', '', '', importeFila(detalle.debe), importeFila(detalle.haber), importeFila(detalle.saldo)],
  ]
  const ultima = filas.length - 1

  return (
    <Document title={nombre} author="La Batea S.A." subject="Resumen de Cuenta">
      <Page size="A4" style={estilos.page}>
        <Encabezado logoSrc={logoSrc} />
        <TituloDocumento
          titulo="RESUMEN DE CUENTA"
          // La misma bajada que el recibo y la orden de pago ("Documento de pago").
          bajada="Documento Cta Cte"
          datos={[['Período:', `del ${desdeIso(periodo.desde)} al ${desdeIso(periodo.hasta)}`]]}
        />
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

        <SubtituloTabla>Detalle de Movimientos</SubtituloTabla>
        <TablaPdf
          columnas={COLUMNAS}
          filas={filas}
          margenInferior={25}
          estiloFila={(i) =>
            i === 0 ? estilosCtaCte.filaSaldoInicial : i === ultima ? estilosCtaCte.filaTotales : undefined
          }
        />

        <MediosDePago />
      </Page>
    </Document>
  )
}
