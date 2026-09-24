/**
 * El ARCHIVO del resumen de cta cte que quedó guardado en la cuenta, para verlo e imprimirlo desde la
 * app sin ir a buscarlo a Drive.
 *
 * El escenario de Make deja TODO lo que genera en una sola columna de la cuenta, "🤖Resumen Cta Cte"
 * (file_mm76gr2x): el resumen y el estado de cuenta, en PDF y/o en Excel, hasta que se emite otro
 * resumen. Lo único que los distingue es el NOMBRE, que el escenario arma así:
 *
 *   Resumen_Cta_Cte-Periodo-25_07_2026-23-09-2026.pdf
 *   Resumen Cta Cte-Periodo-25-07-2026-23-09-2026.xlsx
 *   Estado_Cta_Cte-Fecha-23-09-2026.xlsx
 *
 * —a veces con guiones bajos, a veces con espacios—. Por eso el nombre se compara normalizado.
 *
 * El módulo es PURO, como `_eventoResumen.ts`: lo usa la función de Vercel en producción y el
 * navegador en desarrollo.
 */

/** "💵Cta Cte Cliente". Sólo de ítems de este tablero se entrega el PDF. */
export const BOARD_CTA_CTE = '18421858736'
/** "🤖Resumen Cta Cte" (file) de la cuenta corriente. */
export const COL_ARCHIVO_RESUMEN = 'file_mm76gr2x'

export type DocumentoArchivo = 'resumen' | 'estado'

/** Cómo empieza el nombre normalizado de cada documento. */
const PREFIJO: Record<DocumentoArchivo, string> = {
  resumen: 'resumen cta cte',
  estado: 'estado cta cte',
}

/** Lo que hace falta de cada archivo de la columna. */
export interface ArchivoCtaCte {
  /** El id del archivo en Monday: cada subida es uno nuevo, aunque el nombre se repita. */
  id: string
  name: string
  file_extension: string | null
  public_url: string
  created_at: string | null
}

export const CONSULTA_ARCHIVOS = `query ($ids: [ID!], $col: [String!]) {
  items(ids: $ids) {
    board { id }
    assets(column_ids: $col) { id name file_extension public_url created_at }
  }
}`

/** "Resumen_Cta_Cte-Periodo-…" → "resumen cta cte periodo …". */
const normalizar = (nombre: string): string =>
  nombre
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
    .trim()

const esPdf = (a: ArchivoCtaCte): boolean =>
  /^\.?pdf$/i.test(a.file_extension ?? '') || /\.pdf$/i.test(a.name)

/**
 * El PDF de ese documento, o `null` si en la columna no hay ninguno. Si quedara más de uno —un
 * resumen viejo que no se borró—, el más nuevo: es el de la última emisión.
 */
export function pdfDelDocumento(
  archivos: readonly ArchivoCtaCte[],
  documento: DocumentoArchivo,
): ArchivoCtaCte | null {
  const candidatos = archivos.filter(
    (a) => esPdf(a) && normalizar(a.name).startsWith(PREFIJO[documento]),
  )
  candidatos.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
  return candidatos[0] ?? null
}

/**
 * Qué documentos tienen un PDF NUEVO en la columna: uno que no estaba cuando se pidió la emisión.
 *
 * Es la única forma de saber qué salió en cada emisión: el tablero informa un solo estado para las
 * dos ("Generado" o "Error - Ver Update"), y la columna guarda los archivos de la emisión anterior
 * hasta que otra los reemplaza. Un PDF que ya estaba es de antes, y ofrecerlo mostraría un documento
 * que esta emisión no generó.
 *
 * Sin la foto de antes (`previos` en `null`: no se pudo leer la columna al pedir la emisión) no hay
 * con qué comparar, y cuenta cualquier PDF que esté.
 */
export function pdfsNuevos(
  archivos: readonly ArchivoCtaCte[],
  previos: ReadonlySet<string> | null,
  documentos: readonly DocumentoArchivo[],
): DocumentoArchivo[] {
  return documentos.filter((d) => {
    const pdf = pdfDelDocumento(archivos, d)
    return pdf !== null && !previos?.has(pdf.id)
  })
}

export const NOMBRE_DOCUMENTO: Record<DocumentoArchivo, string> = {
  resumen: 'Resumen de Cta Cte',
  estado: 'Estado de Cta Cte',
}

/** El aviso cuando la columna no tiene el PDF pedido. */
export const sinPdf = (documento: DocumentoArchivo): string =>
  `No encontramos el PDF del ${NOMBRE_DOCUMENTO[documento]} en la cuenta corriente.`
