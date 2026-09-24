import { money } from '@/lib/format'
import { detalleDeMovimientos, estadoDeCuenta } from '@/lib/resumenCtaCte'
import { hoyIso } from '@/lib/dates'
import type {
  FacturaAdeudada,
  FaseEmision,
  FormatoResumen,
  MovimientoCtaCte,
} from '@/types'
import { CardDocumentoCtaCte } from './CardDocumentoCtaCte'
import { ComprobantesPendientes } from './ComprobantesPendientes'
import { DetalleMovimientos } from './DetalleMovimientos'

/** La pastilla que identifica a los documentos de la cuenta corriente, en las dos cards. */
const BADGE_DOCUMENTO = 'Documento Cta Cte'

interface ResumenCtaCteAGenerarProps {
  movimientos: readonly MovimientoCtaCte[]
  /** Cómo se nombra el período elegido en el paso 1 ("Últimos 30 días · 01/01/2025 al 01/07/2025"). */
  rotuloPeriodo: string
  /** Primer día del período, en ISO: es la fecha de la fila de SALDO INICIAL del documento. */
  desde: string
  formato: FormatoResumen | null
  /** El usuario declaró en el paso 1 que el resumen va CON el estado de la cuenta corriente. */
  incluyeEstado: boolean
  /** La lectura de la cuenta todavía está en vuelo: el documento se muestra en blanco, no en cero. */
  cargandoMovimientos: boolean
  facturas: readonly FacturaAdeudada[]
  cargandoFacturas: boolean
  fase: FaseEmision
  /** Etiqueta del estado que publica el tablero. */
  estado: string
}

/**
 * "Comprobante a generar" del RESUMEN DE CTA CTE: los documentos que salen de esta emisión, cada uno
 * en su card plegable (`CardDocumentoCtaCte`), cerradas al entrar.
 *
 *   · RESUMEN DE CTA CTE · siempre. El detalle de movimientos del período y la situación de crédito.
 *   · ESTADO DE CTA CTE  · sólo si en el paso 1 se eligió INCLUIR. Los comprobantes pendientes de
 *                          pago y cómo se reparte la deuda entre lo que está al día y lo vencido.
 *
 * Las dos llevan la pastilla "Documento Cta Cte" y, si ya se eligió, la del formato.
 */
export function ResumenCtaCteAGenerar({
  movimientos,
  rotuloPeriodo,
  desde,
  formato,
  incluyeEstado,
  cargandoMovimientos,
  facturas,
  cargandoFacturas,
  fase,
  estado,
}: ResumenCtaCteAGenerarProps) {
  const badges = formato ? [BADGE_DOCUMENTO, formato] : [BADGE_DOCUMENTO]
  const detalle = detalleDeMovimientos(movimientos)
  const deuda = estadoDeCuenta(facturas, hoyIso())

  return (
    <div className="comprobantes">
      <div className="comprobantes-head">
        <h3 className="resumen-title">Comprobante a generar</h3>
      </div>

      <CardDocumentoCtaCte
        titulo="Resumen de Cta Cte"
        badges={badges}
        datos={[
          { rotulo: 'Movimientos', valor: cargandoMovimientos ? '--' : movimientos.length },
          { rotulo: 'Período', valor: rotuloPeriodo || '--' },
          {
            rotulo: 'Saldo final',
            valor: cargandoMovimientos ? '--' : money(detalle.saldo),
            fuerte: true,
          },
        ]}
        fase={fase}
        estado={estado}
      >
        <DetalleMovimientos movimientos={movimientos} desde={desde} cargando={cargandoMovimientos} />
      </CardDocumentoCtaCte>

      {incluyeEstado && (
        <CardDocumentoCtaCte
          titulo="Estado de Cta Cte"
          badges={badges}
          datos={[
            { rotulo: 'Comprobantes', valor: cargandoFacturas ? '--' : facturas.length },
            { rotulo: 'Total vencido', valor: cargandoFacturas ? '--' : money(deuda.vencido) },
            {
              rotulo: 'Deuda pendiente',
              valor: cargandoFacturas ? '--' : money(deuda.pendiente),
              fuerte: true,
            },
          ]}
          fase={fase}
          estado={estado}
        >
          <ComprobantesPendientes facturas={facturas} cargando={cargandoFacturas} />
        </CardDocumentoCtaCte>
      )}
    </div>
  )
}
