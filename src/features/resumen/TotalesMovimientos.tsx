import { totalesDelPeriodo } from '@/lib/resumenCtaCte'
import type { MovimientoCtaCte } from '@/types'
import { PanelTresMetricas } from './PanelTresMetricas'

/**
 * TOTAL VENTAS, TOTAL COBRADO y SALDO FINAL de los movimientos del período, en el panel del PASE DE
 * SALDO (ver `PanelTresMetricas`).
 *
 * Suman TODOS los movimientos del período, no sólo los de la página en pantalla: el paginado cambia
 * qué filas se ven, no lo que el resumen documenta.
 */
export function TotalesMovimientos({ movimientos }: { movimientos: readonly MovimientoCtaCte[] }) {
  const { ventas, cobros, saldoFinal } = totalesDelPeriodo(movimientos)
  return (
    <PanelTresMetricas
      titulo="Resumen de Cuenta Corriente"
      primera={{ rotulo: 'TOTAL VENTAS', importe: ventas }}
      segunda={{ rotulo: 'TOTAL COBRADO', importe: cobros }}
      tercera={{ rotulo: 'SALDO FINAL', importe: saldoFinal }}
    />
  )
}
