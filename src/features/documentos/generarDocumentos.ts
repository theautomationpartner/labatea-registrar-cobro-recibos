import { createElement, type ReactElement } from 'react'
import { nombreSinCodigo } from '@/lib/busquedaPersonas'
import { desdeIso } from '@/lib/dates'
import type {
  DatosConstanciaRetencionPdf,
  DatosOrdenPagoPdf,
  DatosReciboPdf,
} from '@/lib/documentoComprobante'
import type { ArchivoCtaCte, FormatoResumen } from '@/types'
import type { DatosEstadoCtaCtePdf } from './pdf/EstadoCtaCtePdf'
import type { DatosResumenCtaCtePdf } from './pdf/ResumenCtaCtePdf'
import { limpiarNombre, logoComoDataUrl } from './pdf/comun'

/**
 * Generación de los documentos EN EL NAVEGADOR: el recibo, la orden de pago y los del resumen de cta
 * cte. Es el mismo esquema que el presupuesto de la app de operaciones de venta: la app arma el PDF
 * con la plantilla que usaba Make.com, lo deja en memoria para verlo, enviarlo y, al registrar, subirlo
 * a la columna file del ítem.
 *
 * react-pdf (y exceljs) entran por `import()`: son librerías pesadas que sólo hacen falta al emitir,
 * así que Vite las deja en un chunk aparte y no engordan la carga inicial de la app.
 */

/** Renderiza un <Document> de react-pdf a un archivo PDF. */
async function aPdf(documento: ReactElement, nombre: string): Promise<File> {
  const { pdf } = await import('@react-pdf/renderer')
  // `pdf()` pide un <Document>; los componentes lo son, pero su tipo no lo dice.
  const blob = await pdf(documento as unknown as Parameters<typeof pdf>[0]).toBlob()
  return new File([blob], `${nombre}.pdf`, { type: 'application/pdf' })
}

/* ===== Recibo y orden de pago ===== */

/**
 * Nombre del archivo, sin extensión: "Razón social-Nro del documento" ("The Automation Partner S.A
 * TEST-RECIBO-125"). Es el nombre con el que queda en Monday, el título de la pestaña y el que recibe
 * el cliente, así que va sin el código interno de la persona. Mismo criterio que el presupuesto.
 */
export function nombreComprobantePdf(razonSocial: string, numero: string): string {
  return `${limpiarNombre(nombreSinCodigo(razonSocial))}-${limpiarNombre(numero)}`
}

/** Genera el PDF del RECIBO (template del recibo). */
export async function generarReciboPdf(datos: Omit<DatosReciboPdf, 'nombre'>): Promise<File> {
  const nombre = nombreComprobantePdf(datos.titular.name, datos.numero)
  const [{ ReciboPdf }, logoSrc] = await Promise.all([
    import('./pdf/ReciboPdf'),
    datos.logoSrc ? logoComoDataUrl(datos.logoSrc) : Promise.resolve(undefined),
  ])
  return aPdf(createElement(ReciboPdf, { ...datos, nombre, logoSrc }), nombre)
}

/** Genera el PDF de la ORDEN DE PAGO, con el template de su recorrido (normal, anticipo, aplicación). */
export async function generarOrdenPagoPdf(datos: Omit<DatosOrdenPagoPdf, 'nombre'>): Promise<File> {
  const nombre = nombreComprobantePdf(datos.titular.name, datos.numero)
  const [{ TEMPLATE_ORDEN_PAGO }, logoSrc] = await Promise.all([
    import('./pdf/OrdenPagoPdf'),
    datos.logoSrc ? logoComoDataUrl(datos.logoSrc) : Promise.resolve(undefined),
  ])
  return aPdf(createElement(TEMPLATE_ORDEN_PAGO[datos.variante], { ...datos, nombre, logoSrc }), nombre)
}

/**
 * Nombre del archivo de la constancia, sin extensión: "Razón social-Retencion-RETENC-006". Empieza por
 * el sujeto retenido, igual que los de la orden y el recibo.
 */
export const nombreConstanciaPdf = (razonSocial: string, certificado: string): string =>
  `${limpiarNombre(nombreSinCodigo(razonSocial))}-Retencion-${limpiarNombre(certificado)}`

/** Genera el PDF de la CONSTANCIA DE RETENCIÓN de Ganancias. */
export async function generarConstanciaRetencionPdf(
  datos: Omit<DatosConstanciaRetencionPdf, 'nombre'>,
): Promise<File> {
  const nombre = nombreConstanciaPdf(datos.retenido.name, datos.certificado)
  const [{ ConstanciaRetencionPdf }, logoSrc] = await Promise.all([
    import('./pdf/ConstanciaRetencionPdf'),
    datos.logoSrc ? logoComoDataUrl(datos.logoSrc) : Promise.resolve(undefined),
  ])
  return aPdf(createElement(ConstanciaRetencionPdf, { ...datos, nombre, logoSrc }), nombre)
}

/* ===== Resumen de cta cte ===== */

/** dd/MM/yyyy → DD-MM-YYYY: las fechas de los nombres de archivo. */
const fechaNombre = (iso: string): string => desdeIso(iso).split('/').join('-')

/**
 * Nombres de los archivos, sin extensión, con la forma que les daba el escenario de Make:
 *   Resumen_Cta_Cte-Periodo-24-09-2025-24-09-2026
 *   Estado_Cta_Cte-Fecha-24-09-2026
 * Empiezan como antes a propósito: el tablero y la gestión de cobranza reconocen cada documento por
 * cómo empieza su nombre.
 */
export const nombreResumenCtaCte = (periodo: { desde: string; hasta: string }): string =>
  `Resumen_Cta_Cte-Periodo-${fechaNombre(periodo.desde)}-${fechaNombre(periodo.hasta)}`
export const nombreEstadoCtaCte = (hoy: string): string => `Estado_Cta_Cte-Fecha-${fechaNombre(hoy)}`

/** Qué pide la emisión del resumen: sus datos, el formato y si lleva el estado de cuenta. */
export interface PedidoDocumentosCtaCte {
  formato: FormatoResumen
  incluyeEstado: boolean
  resumen: Omit<DatosResumenCtaCtePdf, 'nombre'>
  /** Sólo con `incluyeEstado`. */
  estado?: Omit<DatosEstadoCtaCtePdf, 'nombre'>
}

/**
 * Genera los archivos del resumen según lo pedido: el resumen siempre y, si se eligió INCLUIR, el
 * estado de cuenta; cada uno en PDF, en Excel o en los dos (`formato`).
 *
 * El orden de la lista es el orden en que se abren con "Ver / Imprimir": primero los PDF —resumen y
 * estado— y después los Excel, que no se imprimen desde el navegador.
 */
export async function generarDocumentosCtaCte({
  formato,
  incluyeEstado,
  resumen,
  estado,
}: PedidoDocumentosCtaCte): Promise<ArchivoCtaCte[]> {
  const conPdf = formato === 'PDF' || formato === 'Ambos'
  const conExcel = formato === 'Excel' || formato === 'Ambos'
  const logoSrc = conPdf && resumen.logoSrc ? await logoComoDataUrl(resumen.logoSrc) : undefined

  const datosResumen: DatosResumenCtaCtePdf = { ...resumen, nombre: nombreResumenCtaCte(resumen.periodo), logoSrc }
  const datosEstado: DatosEstadoCtaCtePdf | null =
    incluyeEstado && estado ? { ...estado, nombre: nombreEstadoCtaCte(estado.hoy), logoSrc } : null

  const pedidos: Promise<ArchivoCtaCte>[] = []
  if (conPdf) {
    const [{ ResumenCtaCtePdf }, { EstadoCtaCtePdf }] = await Promise.all([
      import('./pdf/ResumenCtaCtePdf'),
      import('./pdf/EstadoCtaCtePdf'),
    ])
    pedidos.push(
      aPdf(createElement(ResumenCtaCtePdf, datosResumen), datosResumen.nombre).then((archivo) => ({
        documento: 'resumen' as const,
        formato: 'pdf' as const,
        archivo,
      })),
    )
    if (datosEstado) {
      pedidos.push(
        aPdf(createElement(EstadoCtaCtePdf, datosEstado), datosEstado.nombre).then((archivo) => ({
          documento: 'estado' as const,
          formato: 'pdf' as const,
          archivo,
        })),
      )
    }
  }
  if (conExcel) {
    const { generarEstadoCtaCteExcel, generarResumenCtaCteExcel } = await import('./excel/excelCtaCte')
    pedidos.push(
      generarResumenCtaCteExcel(datosResumen).then((archivo) => ({
        documento: 'resumen' as const,
        formato: 'xlsx' as const,
        archivo,
      })),
    )
    if (datosEstado) {
      pedidos.push(
        generarEstadoCtaCteExcel(datosEstado).then((archivo) => ({
          documento: 'estado' as const,
          formato: 'xlsx' as const,
          archivo,
        })),
      )
    }
  }
  return Promise.all(pedidos)
}
