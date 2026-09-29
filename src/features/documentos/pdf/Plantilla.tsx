import { Font, Image, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { Style } from '@react-pdf/types'
import type { ReactNode } from 'react'
import { alto, importeTotal, px } from './comun'

/*
 * Las piezas que comparten los templates HTML de los documentos —recibo, orden de pago, resumen y
 * estado de cta cte, constancia de retención—. Los cinco HTML declaran el MISMO CSS para estas
 * piezas (`.header`, `.titulo-seccion`, `.cliente-box`, `.subtitulo-tabla`, `table.productos`,
 * `.totales-container`, `.footer`), así que viven una sola vez acá; cada documento arma su página con
 * ellas en su propio componente (`ReciboPdf`, `OrdenPagoPdf`, `ResumenCtaCtePdf`, `EstadoCtaCtePdf`,
 * `ConstanciaRetencionPdf`).
 *
 * El HTML mide en px CSS y react-pdf en puntos: `px()` hace la misma conversión que el navegador al
 * imprimir (96 px = 72 pt).
 *
 * Diferencias forzadas por react-pdf:
 *   · Helvetica es la fuente estándar del PDF (la que el HTML usa de respaldo) y no tiene peso 500:
 *     los importes (`td.num { font-weight: 500 }`) van en peso normal.
 *   · Las tablas son filas de `View`: react-pdf no tiene <table>, así que cada columna declara su
 *     ancho (en el HTML la tabla es automática).
 */

/* Sin separación silábica: react-pdf parte las palabras largas con guiones ("RECI-BO-061"), y en un
   documento un número de comprobante cortado es un número que no se puede leer. */
Font.registerHyphenationCallback((palabra) => [palabra])

export const VIOLETA = '#5c4b8e'
export const VERDE = '#00a859'

export const estilos = StyleSheet.create({
  // @page { size: A4; margin: 10mm 15mm 15mm 15mm } · body { font-size: 11px; color: #333 }
  page: {
    paddingTop: '10mm',
    paddingRight: '15mm',
    paddingBottom: '15mm',
    paddingLeft: '15mm',
    fontFamily: 'Helvetica',
    fontSize: px(11),
    color: '#333',
    backgroundColor: '#fff',
  },
  bold: { fontFamily: 'Helvetica-Bold' },

  // .header { border-bottom: 2px solid #5c4b8e; padding-bottom: 10px; margin-bottom: 15px }
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: px(2),
    borderBottomColor: VIOLETA,
    paddingBottom: px(10),
    marginBottom: px(15),
  },
  celda: { flex: 1 },
  // .empresa-info { text-align: right; font-size: 10px; line-height: 1.4; color: #555 }
  empresaInfo: { flex: 1, textAlign: 'right', fontSize: px(10), lineHeight: alto(10, 1.4), color: '#555' },
  // .empresa-info h2 { color: #333; font-size: 13px; margin-bottom: 3px }
  empresaNombre: { fontFamily: 'Helvetica-Bold', color: '#333', fontSize: px(13), marginBottom: px(3) },

  // .titulo-seccion { margin-bottom: 15px } · vertical-align: bottom
  tituloSeccion: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: px(15) },
  // .titulo-seccion h1 { font-size: 24px; color: #222; letter-spacing: 1px }
  h1: { fontFamily: 'Helvetica-Bold', fontSize: px(24), color: '#222', letterSpacing: px(1) },
  // <span style="font-size: 9px; color: #888;">
  bajada: { fontSize: px(9), color: '#888' },
  // .fechas-box { text-align: right; font-size: 11px } · .fechas-box strong { color: #000 }
  datosDoc: { flex: 1, textAlign: 'right', fontSize: px(11) },
  strong: { fontFamily: 'Helvetica-Bold', color: '#000' },

  // .cliente-box { background: #f8f9fa; border-left: 4px solid #00a859; padding: 10px 15px }
  titularBox: {
    flexDirection: 'row',
    backgroundColor: '#f8f9fa',
    borderLeftWidth: px(4),
    borderLeftColor: VERDE,
    paddingVertical: px(10),
    paddingHorizontal: px(15),
  },
  // .cliente-col { width: 50%; line-height: 1.5 }
  titularCol: { width: '50%', paddingRight: px(10) },
  titularLinea: { lineHeight: alto(11, 1.5) },
  titularRotulo: { fontFamily: 'Helvetica-Bold' },

  // .subtitulo-tabla { font-size: 14px; color: #222; margin-bottom: 8px; font-weight: bold; padding-bottom: 4px; margin-top: 10px }
  subtituloTabla: {
    fontFamily: 'Helvetica-Bold',
    fontSize: px(14),
    color: '#222',
    marginTop: px(10),
    marginBottom: px(8),
    paddingBottom: px(4),
  },

  // .footer { text-align: left; color: #555; line-height: 1.6; margin-bottom: 5px }
  footer: { color: '#555', lineHeight: alto(11, 1.6), marginBottom: px(5) },
  // .footer .importante { display: block; font-size: 10px; font-weight: bold; color: #333; margin-bottom: 5px }
  importante: { fontFamily: 'Helvetica-Bold', fontSize: px(10), color: '#333', marginBottom: px(5) },

  // thead th { background: #f1f1f1; color: #333; font-size: 10px; uppercase; padding: 8px 5px; border-bottom: 2px solid #ccc }
  thFila: { flexDirection: 'row', backgroundColor: '#f1f1f1', borderBottomWidth: px(2), borderBottomColor: '#ccc' },
  th: {
    fontFamily: 'Helvetica-Bold',
    fontSize: px(10),
    color: '#333',
    textTransform: 'uppercase',
    paddingVertical: px(8),
    paddingHorizontal: px(5),
  },
  // tbody td { padding: 6px 5px; border-bottom: 1px solid #eee; color: #444 }
  tdFila: { flexDirection: 'row', borderBottomWidth: px(1), borderBottomColor: '#eee' },
  td: { paddingVertical: px(6), paddingHorizontal: px(5), color: '#444', lineHeight: alto(11, 1.3) },

  // .totales-container { text-align: right; margin-bottom: 25px } · .totales-box { width: 280px }
  totalesContainer: { alignItems: 'flex-end', marginBottom: px(25) },
  totalesBox: { width: px(280) },
  // .totales-fila { padding: 5px 0; font-size: 13px } + .total-pesos { border-top: 2px solid #5c4b8e; bold; #000; padding-top: 8px; margin-top: 4px; font-size: 15px }
  totalPesos: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: px(2),
    borderTopColor: VIOLETA,
    fontFamily: 'Helvetica-Bold',
    color: '#000',
    paddingTop: px(8),
    paddingBottom: px(5),
    marginTop: px(4),
    fontSize: px(15),
  },
})

/**
 * `.header`: el logo a la izquierda y los datos de La Batea a la derecha. `anchoLogo` es el
 * `max-width` del template (190 px; 120 en la constancia de retención).
 */
export function Encabezado({ logoSrc, anchoLogo = 190 }: { logoSrc?: string; anchoLogo?: number }) {
  return (
    <View style={estilos.header}>
      {/* El logo del documento mide 315 × 110. */}
      <View style={estilos.celda}>
        {logoSrc ? <Image style={{ width: px(anchoLogo), height: px((anchoLogo * 110) / 315) }} src={logoSrc} /> : null}
      </View>
      <View style={estilos.empresaInfo}>
        <Text style={estilos.empresaNombre}>La Batea S.A.</Text>
        <Text>Macaya 1273 - 7000 TANDIL</Text>
        <Text>Tel. 0249-4442646</Text>
        <Text>Email: info@labatea.biz</Text>
      </View>
    </View>
  )
}

/** Un dato en negrita con su valor: "<strong>Nº de Documento:</strong> RECIBO-124". */
export function Rotulado({ rotulo, children, estilo }: { rotulo: string; children: ReactNode; estilo?: Style }) {
  return (
    <Text style={estilo}>
      <Text style={estilos.strong}>{rotulo}</Text> {children}
    </Text>
  )
}

/**
 * `.titulo-seccion`: el h1 del documento con su bajada y, a la derecha, `.fechas-box` con los datos
 * que lo identifican.
 */
export function TituloDocumento({
  titulo,
  bajada,
  estiloBajada,
  datos,
}: {
  titulo: string
  bajada?: string
  /** El estilo en línea de la bajada, cuando el template le pone otro. */
  estiloBajada?: Style
  datos: readonly (readonly [string, string, Style?])[]
}) {
  return (
    <View style={estilos.tituloSeccion}>
      {/* Como las `display: table-cell` del HTML, el título se lleva el ancho que necesita. */}
      <View style={{ flexGrow: 1.7, flexBasis: 0 }}>
        <Text style={estilos.h1}>{titulo}</Text>
        {bajada ? <Text style={[estilos.bajada, estiloBajada ?? {}]}>{bajada}</Text> : null}
      </View>
      <View style={estilos.datosDoc}>
        {datos.map(([rotulo, valor, estilo]) => (
          <Rotulado key={rotulo} rotulo={rotulo} estilo={estilo}>
            {valor}
          </Rotulado>
        ))}
      </View>
    </View>
  )
}

/** `.cliente-box`: el recuadro gris del titular, en dos `.cliente-col`. */
export function CajaTitular({
  izquierda,
  derecha,
  margenInferior = 20,
}: {
  izquierda: readonly (readonly [string, string])[]
  derecha: readonly (readonly [string, string])[]
  /** `margin-bottom` del template: 20 px en el recibo y la orden, 15 px en el resumen y el estado. */
  margenInferior?: number
}) {
  const columna = (lineas: readonly (readonly [string, string])[]) => (
    <View style={estilos.titularCol}>
      {lineas.map(([rotulo, valor]) => (
        <Text key={rotulo} style={estilos.titularLinea}>
          <Text style={estilos.titularRotulo}>{rotulo}</Text> {valor}
        </Text>
      ))}
    </View>
  )
  return (
    <View style={[estilos.titularBox, { marginBottom: px(margenInferior) }]}>
      {columna(izquierda)}
      {columna(derecha)}
    </View>
  )
}

/** `.subtitulo-tabla`. */
export function SubtituloTabla({ children }: { children: ReactNode }) {
  return <Text style={estilos.subtituloTabla}>{children}</Text>
}

/** `.footer` con su `.importante`: la leyenda en mayúsculas arriba de una tabla. */
export function Leyenda({ children }: { children: ReactNode }) {
  return (
    <View style={estilos.footer} wrap={false}>
      <Text style={estilos.importante}>{children}</Text>
    </View>
  )
}

/** Una columna de `table.productos`: su título, cuánto ocupa y cómo alinea. */
export interface ColumnaPdf {
  titulo: string
  /** Ancho fijo en px del HTML. Sin ancho, la columna se lleva el resto (`flex: 1`). */
  ancho?: number
  alinear?: 'left' | 'center' | 'right'
}

/** Una celda: el texto y, si hace falta, un estilo propio (el rojo de lo vencido, la negrita). */
export type CeldaPdf = string | { texto: string; estilo?: Style }

export const anchoDe = (c: ColumnaPdf): Style => (c.ancho ? { width: px(c.ancho) } : { flex: 1 })

/**
 * `table.productos`: cabecera gris que se repite en cada página y filas que no se parten entre dos
 * páginas (`tbody tr { page-break-inside: avoid }`). Las celdas centran salvo `txt-izq` y `num`.
 */
export function TablaPdf({
  columnas,
  filas,
  estiloFila,
  margenInferior = 10,
}: {
  columnas: readonly ColumnaPdf[]
  filas: readonly (readonly CeldaPdf[])[]
  /**
   * Estilo de toda una fila (el `tr.fila-saldo-inicial`, el `tr.fila-totales`): `fila` va al renglón
   * —sus bordes— y `celda` a cada `td` —fuente, color, relleno—.
   */
  estiloFila?: (indice: number) => { fila?: Style; celda?: Style } | undefined
  /** `margin-bottom` del template: 10 px en el recibo y la orden, 25 px en el resumen y el estado. */
  margenInferior?: number
}) {
  return (
    <View style={{ marginBottom: px(margenInferior) }}>
      <View style={estilos.thFila} fixed>
        {columnas.map((c) => (
          <Text key={c.titulo} style={[estilos.th, anchoDe(c), { textAlign: c.alinear ?? 'center' }]}>
            {c.titulo}
          </Text>
        ))}
      </View>
      {filas.map((fila, i) => {
        const deFila = estiloFila?.(i)
        return (
          <View key={i} style={[estilos.tdFila, deFila?.fila ?? {}]} wrap={false}>
            {fila.map((celda, j) => {
              const texto = typeof celda === 'string' ? celda : celda.texto
              const propio = typeof celda === 'string' ? undefined : celda.estilo
              return (
                <Text
                  key={j}
                  style={[
                    estilos.td,
                    anchoDe(columnas[j]),
                    { textAlign: columnas[j].alinear ?? 'center' },
                    deFila?.celda ?? {},
                    propio ?? {},
                  ]}
                >
                  {texto}
                </Text>
              )
            })}
          </View>
        )
      })}
    </View>
  )
}

/** `.totales-container` > `.totales-box` > `.totales-fila.total-pesos`: "TOTAL ENTREGADO: $ 1.000,00". */
export function TotalPdf({ rotulo, importe }: { rotulo: string; importe: number }) {
  return (
    <View style={estilos.totalesContainer} wrap={false}>
      <View style={estilos.totalesBox}>
        <View style={estilos.totalPesos}>
          <Text>{rotulo}</Text>
          <Text>{importeTotal(importe)}</Text>
        </View>
      </View>
    </View>
  )
}

/** `.footer` de los documentos de la cuenta corriente: los medios de pago vigentes de La Batea. */
export function MediosDePago() {
  return (
    <View
      style={[estilos.footer, { borderTopWidth: px(1), borderTopColor: '#eee', paddingTop: px(10) }]}
      wrap={false}
    >
      <Text style={[estilos.importante, { marginBottom: px(3) }]}>MEDIOS DE PAGO VIGENTES:</Text>
      <Text>Valores a nombre de La Batea S.A. - Trans. Bco. Credicoop-136-002902/1</Text>
      <Text>CBU 1910136355013600290214 - Visa Débito y Crédito Tarjetas Rurales.</Text>
    </View>
  )
}
