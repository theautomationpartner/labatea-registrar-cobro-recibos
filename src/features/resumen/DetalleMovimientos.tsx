import { creditoCliente, usoDeLinea } from '@/lib/selectors'
import { desdeIso, desdeIsoCorta, desdeIsoDiaMes } from '@/lib/dates'
import { money } from '@/lib/format'
import { detalleDeMovimientos } from '@/lib/resumenCtaCte'
import type { Cliente, MovimientoCtaCte } from '@/types'
import { MetricasDocumento, type MetricaDocumento } from './MetricasDocumento'

interface DetalleMovimientosProps {
  movimientos: readonly MovimientoCtaCte[]
  /** Primer día del período, en ISO: es la fecha de la fila de SALDO INICIAL. */
  desde: string
  /** De acá salen el límite, la línea utilizada y el disponible: los mismos que muestra su ficha. */
  cliente: Cliente
  /** "🤖Remito Pends de Facturar" de la cuenta. */
  mercaderiaPendFacturar: number
}

/** Un importe que la fila no mueve se deja vacío, como en el documento. */
const importeOVacio = (n: number) => (n === 0 ? '' : money(n))

/** Color de "Uso de línea": el mismo semáforo que la ficha del cliente usa para el crédito. */
const TONO_CREDITO: Record<ReturnType<typeof creditoCliente>['clase'], MetricaDocumento['tono']> = {
  'v-green': 'verde',
  'v-orange': 'naranja',
  'v-red': 'rojo',
}

/**
 * El cuerpo del documento RESUMEN DE CTA CTE: el "Detalle de Movimientos" del período y, al pie, la
 * situación de crédito de la cuenta.
 *
 *   · FECHA · COMPROBANTE · VENCIMIENTO · DEBE $ · HABER $ · SALDO $
 *   · abre con la fila de SALDO INICIAL (con la fecha en que empieza el período) y cierra con la de
 *     TOTAL: lo que sumó el debe, lo que sumó el haber y el saldo con el que termina.
 *   · al pie: LÍMITE DE CRÉDITO, LÍNEA UTILIZADA, CRÉDITO DISPONIBLE, USO DE LÍNEA y MERCADERÍA PEND.
 *     FACTURAR.
 *
 * El DEBE es lo que el movimiento suma a la cuenta (sus ventas) y el HABER lo que resta (sus cobros).
 * El vencimiento sólo lo tienen las ventas pendientes de cobro.
 */
export function DetalleMovimientos({
  movimientos,
  desde,
  cliente,
  mercaderiaPendFacturar,
}: DetalleMovimientosProps) {
  const detalle = detalleDeMovimientos(movimientos)
  const uso = usoDeLinea(cliente.limit, cliente.lineaUtilizada)

  return (
    <>
      <h4 className="rec-sub doc-sub">Detalle de Movimientos</h4>
      <table className="comp-table rec-tabla doc-tabla">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Comprobante</th>
            <th className="ta-c">Vencimiento</th>
            <th className="ta-r">Debe $</th>
            <th className="ta-r">Haber $</th>
            <th className="ta-r">Saldo $</th>
          </tr>
        </thead>
        <tbody>
          <tr className="doc-fila-inicial">
            <td>{desdeIso(desde)}</td>
            <td>Saldo Inicial</td>
            <td />
            <td />
            <td />
            <td className="ta-r">{money(detalle.saldoInicial)}</td>
          </tr>
          {movimientos.length === 0 ? (
            <tr className="rec-vacia">
              <td colSpan={6}>La cuenta corriente no tiene movimientos en este período.</td>
            </tr>
          ) : (
            movimientos.map((m) => (
              <tr key={m.id}>
                <td>{desdeIsoCorta(m.emision)}</td>
                <td>{m.comprobante}</td>
                <td className="ta-c">
                  {m.esVentaPendiente && m.vencimiento ? desdeIsoDiaMes(m.vencimiento) : ''}
                </td>
                <td className="ta-r">{importeOVacio(m.ventas)}</td>
                <td className="ta-r">{importeOVacio(m.cobros)}</td>
                <td className="ta-r">{money(m.saldoFinal)}</td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3}>TOTAL</td>
            <td className="ta-r">{money(detalle.debe)}</td>
            <td className="ta-r">{money(detalle.haber)}</td>
            <td className="ta-r">{money(detalle.saldo)}</td>
          </tr>
        </tfoot>
      </table>

      <MetricasDocumento
        metricas={[
          { rotulo: 'Límite de crédito', valor: money(cliente.limit) },
          { rotulo: 'Línea utilizada', valor: money(cliente.lineaUtilizada) },
          { rotulo: 'Crédito disponible', valor: money(cliente.disponible) },
          {
            rotulo: 'Uso de línea',
            valor: uso === null ? '—' : `${uso.toFixed(2).replace('.', ',')}%`,
            tono: uso === null ? undefined : TONO_CREDITO[creditoCliente(cliente).clase],
          },
          { rotulo: 'Mercadería pend. facturar', valor: money(mercaderiaPendFacturar) },
        ]}
      />
    </>
  )
}
