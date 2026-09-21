import { desdeIso, desdeIsoCorta, desdeIsoDiaMes } from '@/lib/dates'
import { money } from '@/lib/format'
import { detalleDeMovimientos } from '@/lib/resumenCtaCte'
import type { MovimientoCtaCte } from '@/types'

interface DetalleMovimientosProps {
  movimientos: readonly MovimientoCtaCte[]
  /** Primer día del período, en ISO: es la fecha de la fila de SALDO INICIAL. */
  desde: string
  /** La lectura de la cuenta está en vuelo: se avisa en vez de mostrar un documento vacío. */
  cargando?: boolean
}

/** Un importe que la fila no mueve se deja vacío, como en el documento. */
const importeOVacio = (n: number) => (n === 0 ? '' : money(n))

/**
 * El cuerpo del documento RESUMEN DE CTA CTE: el "Detalle de Movimientos" del período.
 *
 *   · FECHA · COMPROBANTE · VENCIMIENTO · SALDO INICIAL $ · DEBE $ · HABER $ · SALDO $
 *   · el SALDO INICIAL de cada fila ("🤖Saldo Inicial", numeric_mm58aacc) es con cuánto venía la
 *     cuenta ANTES de ese movimiento: el valor sobre el que después opera su debe o su haber.
 *   · abre con la fila de SALDO INICIAL (con la fecha en que empieza el período) y cierra con la de
 *     TOTAL: lo que sumó el debe, lo que sumó el haber y el saldo con el que termina.
 *
 * El DEBE es lo que el movimiento suma a la cuenta (sus ventas) y el HABER lo que resta (sus cobros).
 * El vencimiento sólo lo tienen las ventas pendientes de cobro.
 *
 * La situación de CRÉDITO de la cuenta —límite, línea utilizada, disponible— no va en el documento:
 * el resumen dice qué se movió en el período, y el crédito es una foto de hoy que el cliente ya ve
 * en su ficha.
 */
export function DetalleMovimientos({
  movimientos,
  desde,
  cargando = false,
}: DetalleMovimientosProps) {
  const detalle = detalleDeMovimientos(movimientos)

  return (
    <>
      <h4 className="rec-sub doc-sub">Detalle de Movimientos</h4>
      <table className="comp-table rec-tabla doc-tabla">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Comprobante</th>
            <th className="ta-c">Vencimiento</th>
            <th className="ta-r">Saldo Inicial $</th>
            <th className="ta-r">Debe $</th>
            <th className="ta-r">Haber $</th>
            <th className="ta-r">Saldo $</th>
          </tr>
        </thead>
        <tbody>
          {!cargando && (
            <tr className="doc-fila-inicial">
              <td>{desdeIso(desde)}</td>
              <td>Saldo Inicial</td>
              <td />
              <td />
              <td />
              <td />
              <td className="ta-r">{money(detalle.saldoInicial)}</td>
            </tr>
          )}
          {cargando ? (
            <tr className="rec-vacia">
              <td colSpan={7}>Buscando los movimientos de la cuenta corriente...</td>
            </tr>
          ) : movimientos.length === 0 ? (
            <tr className="rec-vacia">
              <td colSpan={7}>La cuenta corriente no tiene movimientos en este período.</td>
            </tr>
          ) : (
            movimientos.map((m) => (
              <tr key={m.id}>
                <td>{desdeIsoCorta(m.emision)}</td>
                <td>{m.comprobante}</td>
                <td className="ta-c">
                  {m.esVentaPendiente && m.vencimiento ? desdeIsoDiaMes(m.vencimiento) : ''}
                </td>
                <td className="ta-r">{money(m.saldoInicial)}</td>
                <td className="ta-r">{importeOVacio(m.ventas)}</td>
                <td className="ta-r">{importeOVacio(m.cobros)}</td>
                <td className="ta-r">{money(m.saldoFinal)}</td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr>
            {/* El saldo inicial no se totaliza: cada fila trae el suyo, el de ANTES de moverse. */}
            <td colSpan={4}>TOTAL</td>
            <td className="ta-r">{cargando ? '--' : money(detalle.debe)}</td>
            <td className="ta-r">{cargando ? '--' : money(detalle.haber)}</td>
            <td className="ta-r">{cargando ? '--' : money(detalle.saldo)}</td>
          </tr>
        </tfoot>
      </table>
    </>
  )
}
