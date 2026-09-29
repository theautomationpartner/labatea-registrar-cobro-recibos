/**
 * Qué dicen los PDF del RECIBO, la ORDEN DE PAGO y la CONSTANCIA DE RETENCIÓN que genera la app al
 * emitir. Los templates son los HTML que usaba Make.com (ver `features/documentos/pdf`); acá viven los
 * DATOS que los completan y las variables de template que cambian según el recorrido.
 *
 * Los importes NO se calculan acá: vienen del mismo `Recibo` que arma `armarRecibo` /
 * `armarOrdenDePago` y que muestra la card "Recibo a generar". Así el PDF dice exactamente lo mismo
 * que vio el usuario.
 *
 * Puro: sin React, sin estado y sin red.
 */
import { round2 } from '@/lib/format'
import type { DiasPromedio } from '@/lib/diasPromedio'
import type { Recibo } from '@/lib/recibo'

/**
 * Qué recorrido generó el documento:
 *   · facturas   · un cobro (o un pago) contra facturas: entra (o sale) plata y se cancelan facturas.
 *   · anticipo   · plata a cuenta: no hay facturas que cancelar.
 *   · aplicacion · no se mueve plata: el saldo a favor que ya estaba cancela facturas.
 */
export type VarianteComprobante = 'facturas' | 'anticipo' | 'aplicacion'

/** El titular del documento: cliente, proveedor o sujeto retenido. */
export interface TitularPdf {
  name: string
  cuit: string
  addr: string
}

/** La línea del anticipo cuando el documento ES un anticipo (no cancela facturas). */
export interface AnticipoDelDocumento {
  importe: number
  /** Cómo se nombra la línea. Por defecto, "Anticipo". */
  nombre?: string
  /** Emisión en dd/MM/yyyy (la orden de pago la imprime: es la del pago). */
  emision?: string
  /** Vencimiento en dd/MM/yyyy, si se cargó. */
  vencimiento?: string
}

/** Lo que comparten el recibo y la orden de pago. */
interface BaseComprobantePdf {
  variante: VarianteComprobante
  /** "RECIBO-125" / "IDPAGO-021". */
  numero: string
  /** Nombre del archivo, sin extensión: también es el título del documento (el de la pestaña). */
  nombre: string
  /** dd/MM/yyyy. */
  fechaEmision: string
  titular: TitularPdf
  /** Las dos tablas y sus totales, tal como los arma `armarRecibo` / `armarOrdenDePago`. */
  documento: Recibo
  /** Sólo en la variante ANTICIPO: la línea que ocupa el lugar de las facturas. */
  anticipo?: AnticipoDelDocumento | null
  /** Logo. Opcional: en los tests (Node) no hay de dónde bajarlo. */
  logoSrc?: string
}

export interface DatosReciboPdf extends BaseComprobantePdf {
  /**
   * `saldo_pendiente`: cómo queda la deuda del cliente con este recibo aplicado. `null` = no se
   * conoce, y se imprime "-".
   */
  saldoPendiente: number | null
  /** `dias_promedio` (sólo el cobro contra facturas). `null` = no se imprime el renglón. */
  diasPromedio?: DiasPromedio | null
}

export type DatosOrdenPagoPdf = BaseComprobantePdf

/**
 * Las variables del template del RECIBO que cambian según el recorrido. Son las que el escenario de
 * Make le pasaba al HTML, con los textos que llevaban sus PDF.
 */
export interface VariablesRecibo {
  doc_tipo: string
  mostrar_recibimos: boolean
  /** Título arriba de la primera tabla. `null` = sin título. */
  subtitulo_sup: string | null
  col_sup: string
  tot_sup: string
  subtitulo_inf: string
  col_inf: string
  tot_inf: string
}

export function variablesRecibo(variante: VarianteComprobante): VariablesRecibo {
  if (variante === 'aplicacion') {
    return {
      doc_tipo: 'Aplicación de Cuenta Corriente',
      mostrar_recibimos: false,
      subtitulo_sup: 'Anticipo Aplicado (Origen)',
      col_sup: 'Comprobante',
      tot_sup: 'TOTAL APLICADO:',
      subtitulo_inf: 'Facturas Canceladas (Destino)',
      col_inf: 'Comprobante',
      tot_inf: 'TOTAL CANCELADO:',
    }
  }
  const base = { mostrar_recibimos: true, subtitulo_sup: null, col_sup: 'Forma de Pago / Caja', tot_sup: 'TOTAL ENTREGADO:' }
  if (variante === 'anticipo') {
    return {
      ...base,
      doc_tipo: 'Generación de Anticipo',
      subtitulo_inf: 'Detalle de Anticipo generado',
      col_inf: 'Comprobante',
      tot_inf: 'TOTAL ANTICIPO:',
    }
  }
  return {
    ...base,
    doc_tipo: 'Documento de cobro',
    subtitulo_inf: 'Comprobantes aplicados',
    col_inf: 'Comprobante',
    tot_inf: 'TOTAL CANCELADO:',
  }
}

/** Una fila de `pagos` del template: `caja`, `nro_comprobante`, `importe`. */
export interface FilaPago {
  caja: string
  nro_comprobante: string
  importe: number
}

/** Una fila de `comprobantes` del template: `comprobante`, `fecha_emision_comp`, `fecha_vencimiento_comp`, `importe`. */
export interface FilaComprobante {
  comprobante: string
  fecha_emision_comp: string
  fecha_vencimiento_comp: string
  importe: number
}

const oGuion = (t: string | undefined | null): string => t?.trim() || '-'

/**
 * Las filas de `pagos` (lo recibido / entregado). En una APLICACIÓN cada fila es un anticipo
 * imputado: la primera columna dice qué es y la segunda cuál ("Anticipo - IDPAGO-019"), como en los
 * documentos de Make.
 */
export function filasPagos(d: BaseComprobantePdf): FilaPago[] {
  return d.documento.pagos.map((p) =>
    d.variante === 'aplicacion'
      ? { caja: 'Anticipo', nro_comprobante: oGuion(p.descripcion), importe: p.entregado }
      : { caja: p.descripcion, nro_comprobante: oGuion(p.comprobante), importe: p.entregado },
  )
}

/** Las filas de `comprobantes` (lo cancelado). En un ANTICIPO, la única es la del anticipo. */
export function filasComprobantes(d: BaseComprobantePdf): FilaComprobante[] {
  if (d.variante === 'anticipo' && d.anticipo) {
    return [
      {
        comprobante: d.anticipo.nombre?.trim() || 'Anticipo',
        fecha_emision_comp: oGuion(d.anticipo.emision),
        fecha_vencimiento_comp: oGuion(d.anticipo.vencimiento),
        importe: d.anticipo.importe,
      },
    ]
  }
  return d.documento.comprobantes.map((c) => ({
    comprobante: c.esAnticipo ? 'Anticipo' : c.nro,
    fecha_emision_comp: oGuion(c.emision),
    fecha_vencimiento_comp: oGuion(c.vencimiento),
    importe: c.cancelado,
  }))
}

/** `total_comprobantes`: lo que cierra la segunda tabla. */
export const totalComprobantes = (d: BaseComprobantePdf): number =>
  d.variante === 'anticipo' && d.anticipo ? d.anticipo.importe : d.documento.totalCancelado

/** `es_mixto` de la orden de pago: paga facturas Y deja un anticipo por el sobrante. */
export const esMixto = (d: BaseComprobantePdf): boolean => d.documento.comprobantes.some((c) => c.esAnticipo)

/**
 * Cómo queda la cuenta corriente del cliente con el recibo aplicado: la deuda que tenía menos lo que
 * el recibo recibió. Es el MISMO cálculo que "🤖Saldo Cta Cte con Cobro Aplicado" de la cabecera del
 * recibo en Monday (ver `crearRecibo`), así el documento y el tablero dicen el mismo número.
 */
export const saldoConRecibo = (saldoCtaCte: number | undefined, totalRecibido: number): number | null =>
  Number.isFinite(saldoCtaCte) ? round2((saldoCtaCte as number) - totalRecibido) : null

/** "10-09-2026 (15 dias)": los días promedio tal como los imprimía el recibo de Make. */
export const diasPromedioDelPdf = (d: DiasPromedio | null | undefined): string | null =>
  d && d.ok ? `${d.fecha.split('/').join('-')} (${d.dias} ${Math.abs(d.dias) === 1 ? 'dia' : 'dias'})` : null

/* ===== Constancia de retención de Ganancias ===== */

/** Una fila de `retenciones` del template de la constancia. */
export interface FilaRetencion {
  regimen: string
  comprobante_origen: string
  /** `null` = no se conoce la base (la retención se cargó a mano): se imprime "-". */
  monto_base: number | null
  /** En %. `null` = no se conoce. */
  alicuota: number | null
  monto_retenido: number
}

export interface DatosConstanciaRetencionPdf {
  /** `certificado_numero`: el "🤖ID Retencion" con el que nace la retención ("RETENC-006"). */
  certificado: string
  /** Nombre del archivo, sin extensión. */
  nombre: string
  /** `fecha_retencion`, dd/MM/yyyy: la del pago. */
  fechaRetencion: string
  /** `ref_orden_pago`: el número de la orden que la practicó. */
  refOrdenPago: string
  /** El proveedor retenido. */
  retenido: TitularPdf
  retenciones: FilaRetencion[]
  logoSrc?: string
}

/** `total_retenido`: la suma de todas las filas. */
export const totalRetenido = (filas: readonly FilaRetencion[]): number =>
  round2(filas.reduce((acc, f) => acc + f.monto_retenido, 0))
