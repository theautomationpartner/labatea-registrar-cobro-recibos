import { money } from '@/lib/format'
import { detalleDeMovimientos, estadoDeCuenta, periodoDeRango, rotuloRango } from '@/lib/resumenCtaCte'
import { hoyIso } from '@/lib/dates'
import type {
  Cliente,
  FacturaAdeudada,
  FaseEmision,
  FormatoResumen,
  MovimientoCtaCte,
  RangoResumen,
} from '@/types'
import { CardDocumentoCtaCte } from './CardDocumentoCtaCte'
import { ComprobantesPendientes } from './ComprobantesPendientes'
import { DetalleMovimientos } from './DetalleMovimientos'

/** La pastilla que identifica a los documentos de la cuenta corriente, en las dos cards. */
const BADGE_DOCUMENTO = 'Documento Cta Cte'

interface ResumenCtaCteAGenerarProps {
  cliente: Cliente
  movimientos: readonly MovimientoCtaCte[]
  rango: RangoResumen | null
  formato: FormatoResumen | null
  mercaderiaPendFacturar: number
  /** El usuario declaró en el paso 1 que el resumen va CON el estado de la cuenta corriente. */
  incluyeEstado: boolean
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
  cliente,
  movimientos,
  rango,
  formato,
  mercaderiaPendFacturar,
  incluyeEstado,
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
          { rotulo: 'Movimientos', valor: movimientos.length },
          { rotulo: 'Período', valor: rango ? rotuloRango(rango) : '--' },
          { rotulo: 'Saldo final', valor: money(detalle.saldo), fuerte: true },
        ]}
        fase={fase}
        estado={estado}
      >
        <DetalleMovimientos
          movimientos={movimientos}
          desde={rango ? periodoDeRango(rango).desde : ''}
          cliente={cliente}
          mercaderiaPendFacturar={mercaderiaPendFacturar}
        />
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
