import { desdeIso } from '@/lib/dates'
import { money } from '@/lib/format'
import type { MovimientoCtaCte } from '@/types'
import { TablaPaginada, type ColumnaTabla } from './TablaPaginada'

/** Un dato que el movimiento no tiene se deja en guion, con el mismo gris de la tabla de anticipos. */
const guion = <span className="ant-sd">—</span>

/** Un importe que el movimiento no mueve también va en guion: un "$ 0,00" en cada fila es ruido. */
const importeOGuion = (n: number) => (n === 0 ? guion : money(n))

const COLUMNAS: readonly ColumnaTabla[] = [
  { titulo: 'Nro de Comprobante' },
  { titulo: 'Fecha de Emisión', centrada: true },
  { titulo: 'Fecha de Vencimiento', centrada: true },
  { titulo: 'Saldo Inicial', centrada: true },
  { titulo: 'Ventas', centrada: true },
  { titulo: 'Cobros', centrada: true },
  { titulo: 'Saldo Final', centrada: true },
]

/**
 * Los movimientos de la cuenta corriente del período, tal como salen del tablero. El estilo, el
 * paginado y el alto fijo son los de `TablaPaginada`; acá sólo vive qué muestra cada fila.
 *
 * Debajo del comprobante va la etiqueta del movimiento, en el lugar donde la tabla de anticipos
 * muestra el detalle del anticipo.
 */
export function TablaMovimientosCtaCte({
  movimientos,
  porPagina,
}: {
  movimientos: readonly MovimientoCtaCte[]
  /** Ver `TablaPaginada`. Sin valor, sin paginado (el comprobante a generar del paso 4). */
  porPagina?: number
}) {
  return (
    <TablaPaginada
      filas={movimientos}
      columnas={COLUMNAS}
      claveDe={(m) => m.id}
      porPagina={porPagina}
      sustantivo="movimientos"
      celdas={(m) => (
        <>
          <td>
            <div className="mov-comp">
              <span className="ant-nro">{m.comprobante}</span>
              {/* La etiqueta del movimiento, salvo que diga lo mismo que el comprobante. */}
              {m.tipo && m.tipo !== m.comprobante && <span className="ant-detalle">{m.tipo}</span>}
            </div>
          </td>
          <td className="ant-col-cen">{desdeIso(m.emision) || guion}</td>
          {/* El vencimiento es sólo de las ventas pendientes de cobro: el resto no vence. */}
          <td className="ant-col-cen">
            {m.esVentaPendiente && m.vencimiento ? desdeIso(m.vencimiento) : guion}
          </td>
          <td className="ant-col-cen ant-num">{money(m.saldoInicial)}</td>
          <td className="ant-col-cen ant-num">{importeOGuion(m.ventas)}</td>
          <td className="ant-col-cen ant-num">{importeOGuion(m.cobros)}</td>
          <td className="ant-col-cen ant-num">{money(m.saldoFinal)}</td>
        </>
      )}
    />
  )
}
