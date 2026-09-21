import { desdeIso, hoyIso } from '@/lib/dates'
import { money } from '@/lib/format'
import { estadoDeCuenta } from '@/lib/resumenCtaCte'
import type { FacturaAdeudada } from '@/types'
import { MetricasDocumento } from './MetricasDocumento'

interface ComprobantesPendientesProps {
  facturas: readonly FacturaAdeudada[]
  /** Todavía se están leyendo las facturas del cliente. */
  cargando: boolean
}

/**
 * El cuerpo del documento ESTADO DE CTA CTE: los "Comprobantes Pendientes de Pago" del cliente —las
 * mismas facturas que lista la etapa "Facturas que debe"— y, al pie, cómo se reparte su deuda.
 *
 *   · COMPROBANTE · VENCIMIENTO · IMPORTE $ · PAGADO $ · PENDIENTE $ · ESTADO DE VENCIMIENTO
 *   · cierra con la fila de TOTALES de importe, pagado y pendiente.
 *   · al pie: TOTAL A VENCER (AL DÍA) en verde, TOTAL VENCIDO en rojo y DEUDA TOTAL PENDIENTE.
 */
export function ComprobantesPendientes({ facturas, cargando }: ComprobantesPendientesProps) {
  const estado = estadoDeCuenta(facturas, hoyIso())

  return (
    <>
      <h4 className="rec-sub doc-sub">Comprobantes Pendientes de Pago</h4>
      <table className="comp-table rec-tabla doc-tabla">
        <thead>
          <tr>
            <th>Comprobante</th>
            <th className="ta-c">Vencimiento</th>
            <th className="ta-r">Importe $</th>
            <th className="ta-r">Pagado $</th>
            <th className="ta-r">Pendiente $</th>
            <th className="ta-c">Estado de Vencimiento</th>
          </tr>
        </thead>
        <tbody>
          {cargando ? (
            <tr className="rec-vacia">
              <td colSpan={6}>Buscando los comprobantes pendientes del cliente...</td>
            </tr>
          ) : facturas.length === 0 ? (
            <tr className="rec-vacia">
              <td colSpan={6}>El cliente no tiene comprobantes pendientes de pago.</td>
            </tr>
          ) : (
            facturas.map((f) => (
              /* Las cuatro columnas que hablan del vencimiento —qué comprobante es, cuánto
                 queda, cuándo vence y en qué estado está— van en el MISMO color y el mismo grosor:
                 es una sola señal repartida en la fila, no cuatro énfasis distintos. El importe y
                 lo pagado quedan en negro: son lo que la factura dice, no su urgencia.

                 Lo que NO venció no se pinta: la fila en negro ya dice que está al día, y teñirla
                 de verde le daría un énfasis que no necesita. */
              <tr
                key={f.id}
                className={f.tramo && f.tramo !== 'noVencido' ? `doc-venc doc-venc--${f.tramo}` : ''}
              >
                <td className="doc-venc-txt">{f.comprobante}</td>
                <td className="ta-c doc-venc-txt">{desdeIso(f.vencimiento)}</td>
                <td className="ta-r">{money(f.importe)}</td>
                <td className="ta-r">{money(f.cobrado)}</td>
                <td className="ta-r doc-venc-txt">{money(f.pendiente)}</td>
                <td className="ta-c doc-venc-txt">{f.estadoVencimiento}</td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2}>TOTALES</td>
            <td className="ta-r">{money(estado.importe)}</td>
            <td className="ta-r">{money(estado.pagado)}</td>
            <td className="ta-r">{money(estado.pendiente)}</td>
            <td />
          </tr>
        </tfoot>
      </table>

      <MetricasDocumento
        metricas={[
          { rotulo: 'Total a vencer (al día)', valor: money(estado.aVencer), tono: 'verde' },
          { rotulo: 'Total vencido', valor: money(estado.vencido), tono: 'rojo' },
          { rotulo: 'Deuda total pendiente', valor: money(estado.pendiente) },
        ]}
      />
    </>
  )
}
