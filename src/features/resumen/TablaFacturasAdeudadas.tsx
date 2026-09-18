import { desdeIso } from '@/lib/dates'
import { money } from '@/lib/format'
import type { FacturaAdeudada } from '@/types'
import { TablaPaginada, type ColumnaTabla } from './TablaPaginada'

const guion = <span className="ant-sd">—</span>

const COLUMNAS: readonly ColumnaTabla[] = [
  { titulo: 'Nro Comprobante' },
  { titulo: 'Fecha de Emisión', centrada: true },
  { titulo: 'Importe', centrada: true },
  { titulo: 'Total Pagado', centrada: true },
  { titulo: 'Pend de Pagar', centrada: true },
  { titulo: 'Fecha de Vencimiento', centrada: true },
  { titulo: 'Estado de Vencimiento', centrada: true },
]

/** Tono de la pastilla de vencimiento → clase de `fact-estado` (la de la tabla de facturas de COBROS). */
const CLASE_TONO: Record<NonNullable<FacturaAdeudada['tonoVencimiento']>, string> = {
  ok: 'is-ok',
  alerta: 'is-parcial',
  vencida: 'is-pendiente',
}

/**
 * Las facturas que el cliente todavía debe. EXACTAMENTE la misma tabla que la de los movimientos del
 * rango de fechas —`TablaPaginada`: mismas clases, mismo paginado de a diez y mismo alto fijo—; acá
 * sólo vive qué muestra cada fila.
 *
 * Debajo del número va el estado de cobro ("Cancelada Parcialmente"), en el lugar donde la otra tabla
 * muestra el tipo de movimiento. El estado de vencimiento va en la misma pastilla con punto que la
 * tabla de facturas de COBROS usa para su estado, coloreada según qué tan vencida está.
 */
export function TablaFacturasAdeudadas({
  facturas,
  porPagina,
}: {
  facturas: readonly FacturaAdeudada[]
  porPagina?: number
}) {
  return (
    <TablaPaginada
      filas={facturas}
      columnas={COLUMNAS}
      claveDe={(f) => f.id}
      porPagina={porPagina}
      sustantivo="facturas"
      celdas={(f) => (
        <>
          <td>
            <div className="mov-comp">
              <span className="ant-nro">{f.comprobante}</span>
              {f.estadoCobro && <span className="ant-detalle">{f.estadoCobro}</span>}
            </div>
          </td>
          <td className="ant-col-cen">{desdeIso(f.emision) || guion}</td>
          <td className="ant-col-cen ant-num">{money(f.importe)}</td>
          <td className="ant-col-cen ant-num">{f.cobrado === 0 ? guion : money(f.cobrado)}</td>
          <td className="ant-col-cen ant-num">{money(f.pendiente)}</td>
          <td className="ant-col-cen">{desdeIso(f.vencimiento) || guion}</td>
          <td className="ant-col-cen">
            {f.estadoVencimiento ? (
              <span className={`fact-estado ${f.tonoVencimiento ? CLASE_TONO[f.tonoVencimiento] : ''}`}>
                <span className="fact-estado-dot" />
                {f.estadoVencimiento}
              </span>
            ) : (
              guion
            )}
          </td>
        </>
      )}
    />
  )
}
