/**
 * El MOTOR de los dos registros que la app hace por su cuenta —"Registrar Cobro" (`registroCobro`)
 * y "Registrar Pago" (`registroPago`)—, lo que antes hacían los escenarios de Make.
 *
 * Los dos registros son la misma mecánica con otros tableros: se arma un PLAN de escrituras
 * (`Unidad`), se ejecuta por lotes en UNA mutación cada uno (`ejecutar`) y lo que entra queda anotado
 * en `hechos` para que un reintento no lo repita. Lo que encadena saldo —los movimientos de una misma
 * caja o cuenta corriente— se completa con `encadenar` antes de mandarse.
 *
 * Vive aparte para que las dos puntas del mostrador no tengan su propia copia: una corrección al
 * motor tiene que valer para los dos registros a la vez.
 */
import { round2 } from '@/lib/format'
import { aIso } from '@/lib/dates'
import { num, type CV } from './parse'
import { mondayApiParcial, mondaySubirArchivo, type ErrorParcial } from './sdk'

/** Algo que el registro ya creó: su id y, si el tablero le da uno, su código ("ANT-012"). */
export interface Hecho {
  id: string
  codigo?: string
}

/** Con qué habla el registro con Monday. Se inyecta en las pruebas. */
export interface ConexionRegistro {
  api: typeof mondayApiParcial
  subir: typeof mondaySubirArchivo
}

export const conexionReal = (): ConexionRegistro => ({ api: mondayApiParcial, subir: mondaySubirArchivo })

/* ===== Helpers de valores ===== */

export const relaciones = (ids: readonly (string | null | undefined)[]): { item_ids: number[] } | null => {
  const numeros = [...new Set(ids.map(Number).filter((n) => Number.isFinite(n) && n > 0))]
  return numeros.length ? { item_ids: numeros } : null
}
export const relacion = (id: string | null | undefined) => relaciones([id])
export const fecha = (ddmmyyyy: string | undefined): { date: string } | null => {
  const iso = aIso(ddmmyyyy ?? '')
  return iso ? { date: iso } : null
}
export const etiqueta = (texto: string | null | undefined): { labels: string[] } | null =>
  texto?.trim() ? { labels: [texto.trim()] } : null

/** Arma un objeto de columnas sin las que no tienen valor: vacío se OMITE, no se manda en blanco. */
export const columnas = (entradas: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(entradas).filter(([, v]) => v !== null && v !== undefined && v !== ''))

/** Los nombres se arman con lo que haya: una parte vacía no deja un " -  - " colgando. */
export const nombre = (...partes: (string | null | undefined)[]): string =>
  partes.map((p) => p?.trim()).filter(Boolean).join(' - ')

export const suma = (xs: readonly number[]) => round2(xs.reduce((acc, x) => acc + x, 0))

export const lista = (ids: readonly string[]) =>
  ids.map(Number).filter((n) => Number.isFinite(n) && n > 0).join(', ')

/* ===== Lo que se lee antes de escribir ===== */

export interface SubitemLeido {
  id: string
  created_at: string
  column_values: CV[]
}

/**
 * El saldo con el que quedó el último movimiento, como lo calculaba Make: inicial + entradas −
 * salidas. El "último" es el de creación más reciente (y, a igual fecha, el de id más alto): el
 * orden en que Monday devuelve los subelementos no se puede garantizar.
 */
export function saldoDelUltimo(subitems: readonly SubitemLeido[], ini: string, mas: string, menos: string): number {
  if (subitems.length === 0) return 0
  const ultimo = [...subitems].sort((a, b) => {
    const orden = String(a.created_at).localeCompare(String(b.created_at))
    return orden !== 0 ? orden : Number(a.id) - Number(b.id)
  })[subitems.length - 1]
  const cv = Object.fromEntries(ultimo.column_values.map((c) => [c.id, c.text]))
  return round2(num(cv[ini]) + num(cv[mas]) - num(cv[menos]))
}

export const idsDe = (cv: CV | undefined): string[] =>
  ((cv as { linked_item_ids?: (string | number)[] } | undefined)?.linked_item_ids ?? []).map(String)

export const erroresATexto = (errores: readonly ErrorParcial[]): string =>
  errores.map((e) => e.message).join(' · ') || 'Monday no respondió'

/**
 * La cuenta corriente de una persona, tal como la necesita el registro: su ítem, el saldo con el que
 * quedó su último movimiento y su "🤖Anticipo pend de Aplicar". Los dos tableros de cuenta corriente
 * —clientes y proveedores— tienen los mismos ids de columna, así que la consulta es una sola.
 */
export interface CuentaLeida {
  id: string
  /** Saldo final del último movimiento: el "🤖Saldo Inicial" del próximo. */
  saldo: number
  anticipoPend: number
}

/* ===== Las escrituras ===== */

/** Una escritura: crea un subelemento, crea un ítem o cambia columnas de un ítem existente. */
export type Escritura =
  | { tipo: 'subitem'; padre: string; nombre: string; columnas: Record<string, unknown>; etiquetas?: boolean }
  | { tipo: 'item'; board: number; nombre: string; columnas: Record<string, unknown>; etiquetas?: boolean; codigo?: string }
  | { tipo: 'columnas'; board: number; itemId: string; columnas: Record<string, unknown> }

export interface Unidad {
  /** Identidad estable de la escritura: es lo que se anota en `hechos` para no repetirla. */
  clave: string
  /** Cómo se la nombra si falla. */
  descripcion: string
  escritura: Escritura
  /** Archivo a subir al ítem creado, cuando entró. */
  archivo?: { archivo: File; columna: string }
}

export interface Ejecucion {
  hechos: Record<string, Hecho>
  fallas: string[]
  alAvanzar: (hechos: Record<string, Hecho>) => void
  cx: ConexionRegistro
}

/** Sube UN archivo a la columna `file` de un ítem ya creado. */
export const subirA = (cx: ConexionRegistro, itemId: string, columna: string, archivo: File) =>
  cx.subir(
    `mutation ($file: File!) { add_file_to_column(item_id: ${Number(itemId)}, column_id: "${columna}", file: $file) { id } }`,
    archivo,
  )

/**
 * Ejecuta un lote de escrituras en UNA mutación, en el orden dado, y después sube sus archivos.
 * Lo que ya estaba hecho se saltea. Devuelve `true` si TODAS las escrituras del lote quedaron
 * hechas (los archivos no cortan: se informan aparte).
 */
export async function ejecutar(unidades: readonly Unidad[], ej: Ejecucion): Promise<boolean> {
  const pendientes = unidades.filter((u) => !ej.hechos[u.clave])
  let todas = true

  if (pendientes.length) {
    const variables: Record<string, unknown> = {}
    const declaraciones: string[] = []
    const campos = pendientes.map((u, i) => {
      const e = u.escritura
      variables[`c${i}`] = JSON.stringify(e.columnas)
      declaraciones.push(`$c${i}: JSON!`)
      if (e.tipo === 'columnas') {
        variables[`i${i}`] = e.itemId
        declaraciones.push(`$i${i}: ID!`)
        return `u${i}: change_multiple_column_values(item_id: $i${i}, board_id: ${e.board}, column_values: $c${i}) { id }`
      }
      variables[`n${i}`] = e.nombre
      declaraciones.push(`$n${i}: String!`)
      const etiquetas = e.etiquetas ? 'true' : 'false'
      if (e.tipo === 'subitem') {
        variables[`p${i}`] = e.padre
        declaraciones.push(`$p${i}: ID!`)
        return `u${i}: create_subitem(parent_item_id: $p${i}, item_name: $n${i}, column_values: $c${i}, create_labels_if_missing: ${etiquetas}) { id }`
      }
      const codigo = e.codigo ? ` column_values(ids: ["${e.codigo}"]) { id text }` : ''
      return `u${i}: create_item(board_id: ${e.board}, item_name: $n${i}, column_values: $c${i}, create_labels_if_missing: ${etiquetas}) { id${codigo} }`
    })

    try {
      const { data, errores } = await ej.cx.api<Record<string, { id: string; column_values?: CV[] } | null>>(
        `mutation (${declaraciones.join(', ')}) { ${campos.join('\n')} }`,
        variables,
      )
      pendientes.forEach((u, i) => {
        const creado = data[`u${i}`]
        if (creado?.id) {
          ej.hechos[u.clave] = { id: String(creado.id), codigo: creado.column_values?.[0]?.text?.trim() || undefined }
          return
        }
        todas = false
        const propios = errores.filter((e) => e.path?.[0] === `u${i}`)
        ej.fallas.push(`${u.descripcion}: ${erroresATexto(propios.length ? propios : errores)}`)
      })
    } catch (e) {
      todas = false
      const motivo = e instanceof Error && e.message ? e.message : 'sin respuesta de Monday'
      pendientes.forEach((u) => ej.fallas.push(`${u.descripcion}: ${motivo}`))
    }
    ej.alAvanzar(ej.hechos)
  }

  /* Los archivos van al ítem ya creado —las columnas `file` no viajan en `column_values`—, en
     paralelo, y también se anotan: un reintento no los sube dos veces. */
  const subidas = unidades.flatMap((u) => {
    const hecho = ej.hechos[u.clave]
    const clave = `archivo:${u.clave}`
    if (!u.archivo || !hecho || ej.hechos[clave]) return []
    return [
      subirA(ej.cx, hecho.id, u.archivo.columna, u.archivo.archivo)
        .then(() => {
          ej.hechos[clave] = { id: hecho.id }
        })
        .catch((e: unknown) => {
          ej.fallas.push(`Comprobante de ${u.descripcion}: ${e instanceof Error ? e.message : 'no se pudo subir'}`)
        }),
    ]
  })
  if (subidas.length) {
    await Promise.all(subidas)
    ej.alAvanzar(ej.hechos)
  }
  return todas
}

/**
 * Encadena el saldo de una lista de movimientos que van al MISMO padre: el primero arranca del
 * saldo leído y cada uno del final del anterior. Los que ya estaban hechos no cuentan —su efecto
 * ya está en el saldo que se leyó—.
 */
export function encadenar(
  unidades: readonly Unidad[],
  hechos: Record<string, Hecho>,
  saldo: number,
  colSaldo: string,
  delta: (u: Unidad) => number,
): Unidad[] {
  let actual = saldo
  return unidades.map((u) => {
    if (hechos[u.clave] || u.escritura.tipo === 'columnas') return u
    const conSaldo = { ...u, escritura: { ...u.escritura, columnas: { ...u.escritura.columnas, [colSaldo]: actual } } }
    actual = round2(actual + delta(u))
    return conSaldo
  })
}

/** El importe numérico de una columna de una unidad ya armada (para el delta de `encadenar`). */
export const importeDe = (u: Unidad, col: string): number => num(String(u.escritura.columnas[col] ?? 0))
