import { useState, type ReactNode } from 'react'
import { paginar } from '@/lib/resumenCtaCte'
import { PaginadorMovimientos } from './PaginadorMovimientos'

export interface ColumnaTabla {
  titulo: string
  /** Centrada bajo su encabezado (`ant-col-cen`). La primera columna, la que identifica la fila, no. */
  centrada?: boolean
}

interface TablaPaginadaProps<T> {
  filas: readonly T[]
  columnas: readonly ColumnaTabla[]
  claveDe: (fila: T) => string
  /**
   * Las celdas (`<td>`) de UNA fila, en el orden de `columnas`. La primera debería envolver su
   * contenido en `mov-comp`: es la caja que le da a cada fila el alto de las de la tabla de anticipos.
   */
  celdas: (fila: T) => ReactNode
  /**
   * Cuántas filas por página. Sin valor, se muestran todas. Con valor, el paginador aparece sólo
   * cuando hay MÁS filas que esa cantidad, y mientras pagina la tabla reserva SIEMPRE el alto de una
   * página completa.
   *
   * La página arranca en la primera cada vez que la tabla se monta: quien la usa le cambia la `key`
   * cuando cambia la lista, así una lista nueva no se abre a mitad de camino.
   */
  porPagina?: number
  /** Cómo se nombran las filas en "Mostrando 1–10 de 23 …" ("movimientos", "facturas"). */
  sustantivo: string
}

/**
 * La tabla de SÓLO LECTURA del RESUMEN DE CTA CTE, con su paginado. La usan las dos etapas que listan
 * datos de la cuenta —los movimientos del período y las facturas que debe—, así las dos se ven y se
 * comportan igual sin repetir el mecanismo.
 *
 *   · ESTILO · el de la tabla de anticipos de COBROS · Aplicación (`TablaAnticipos`), con sus mismas
 *              clases (`ant-tabla`, `ant-row`, `ant-col-cen`…), sin el resaltado al pasar el mouse.
 *   · PAGINADO · de a `porPagina`, con el paginador debajo de la tabla.
 *   · ALTO FIJO · la página incompleta se completa con filas en blanco del mismo alto: la tabla no se
 *                encoge al llegar a la última página, y lo que está debajo no salta de lugar.
 *
 * Las filas no tienen nada que accionar: los únicos controles son los botones del paginador.
 */
export function TablaPaginada<T>({
  filas,
  columnas,
  claveDe,
  celdas,
  porPagina,
  sustantivo,
}: TablaPaginadaProps<T>) {
  const [paginaPedida, setPaginaPedida] = useState(1)
  const paginada = porPagina !== undefined && filas.length > porPagina
  const pagina = paginar(filas, paginaPedida, paginada ? porPagina : Math.max(filas.length, 1))

  return (
    /* `anticipos-v2` es el ámbito de los estilos de `ant-tabla`; `mov-ctacte` pone las variables de
       color cuando la tabla vive fuera de `.cobro-v2` (el comprobante a generar del paso 4). */
    <div className="anticipos-v2 mov-ctacte">
      <div className="ant-tabla-wrap">
        <table className="ant-tabla">
          <thead>
            <tr>
              {columnas.map((c) => (
                <th key={c.titulo} className={c.centrada ? 'ant-col-cen' : undefined}>
                  {c.titulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pagina.items.map((fila) => (
              <tr key={claveDe(fila)} className="ant-row mov-fila">
                {celdas(fila)}
              </tr>
            ))}
            {paginada &&
              Array.from({ length: pagina.vacias }, (_, i) => (
                <tr key={`relleno-${i}`} className="mov-relleno" aria-hidden="true">
                  <td colSpan={columnas.length}>
                    <div className="mov-comp" />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {paginada && (
        <PaginadorMovimientos
          pagina={pagina.pagina}
          totalPaginas={pagina.totalPaginas}
          desde={pagina.desde}
          hasta={pagina.hasta}
          total={pagina.total}
          sustantivo={sustantivo}
          onCambiar={setPaginaPedida}
        />
      )}
    </div>
  )
}
