import { money } from '@/lib/format'

export interface MetricaPanel {
  rotulo: string
  importe: number
}

interface PanelTresMetricasProps {
  titulo: string
  /** Lo que suma (gris), lo que ya se pagó (verde) y en cuánto queda (azul, destacado). */
  primera: MetricaPanel
  segunda: MetricaPanel
  tercera: MetricaPanel
}

/** Importe con su signo delante: un saldo a favor del cliente se lee "- $ …". */
const conSigno = (n: number) => (n < 0 ? `- ${money(-n)}` : money(n))

/**
 * Tres totales en el MISMO panel que "Resumen de la cuenta por pase de saldo" del PASE DE SALDO (ver
 * `ImpactoAnticipos`): la banda que cierra la card, su cabecera con filete, las tres métricas en
 * partes iguales con sus separadores, los mismos íconos en pastilla y el mismo peso para el número
 * que concluye. Se usan sus mismas clases —la vista se monta bajo `pases-v2`— en vez de copiar los
 * estilos.
 *
 * No se reusa `ImpactoAnticipos` porque aquél CALCULA una proyección (actual + recibido =
 * resultante); los totales del resumen llegan ya calculados y no se derivan unos de otros.
 *
 * Lo usan las dos etapas del RESUMEN DE CTA CTE que listan datos: los movimientos del período (TOTAL
 * VENTAS · TOTAL COBRADO · SALDO FINAL) y las facturas que debe (TOTAL DEUDA · TOTAL COBRADO · DEUDA
 * PENDIENTE). Es la misma lectura de izquierda a derecha en las dos: lo que se generó, lo que ya se
 * cobró y lo que queda.
 */
export function PanelTresMetricas({ titulo, primera, segunda, tercera }: PanelTresMetricasProps) {
  return (
    <div className="entrega-panel cobro-imp-panel">
      <div className="entrega-panel-head">
        <h3 className="font-b cobro-imp-title">{titulo}</h3>
      </div>

      <div className="entrega-panel-body">
        <div className="cobro-imp-row">
          <div className="cobro-imp-met">
            <span className="cobro-cab-ic cobro-cab-ic--gris">
              <i className="fas fa-file-invoice-dollar" />
            </span>
            <div className="cobro-cab-campo">
              <span className="cobro-cab-lbl">{primera.rotulo}</span>
              <span className="cobro-imp-num">{conSigno(primera.importe)}</span>
            </div>
          </div>

          <span className="cobro-cab-sep" />

          {/* Lo cobrado, en verde como lo que entra en el pase: es lo que baja la deuda. */}
          <div className="cobro-imp-met">
            <span className="cobro-cab-ic cobro-cab-ic--verde">
              <i className="fas fa-hand-holding-dollar" />
            </span>
            <div className="cobro-cab-campo">
              <span className="cobro-cab-lbl cobro-cab-lbl--verde">{segunda.rotulo}</span>
              <span className="cobro-imp-num cobro-imp-num--verde">{conSigno(segunda.importe)}</span>
            </div>
          </div>

          <span className="cobro-cab-sep" />

          <div className="cobro-imp-met">
            <span className="cobro-cab-ic cobro-cab-ic--azul">
              <i className="fas fa-scale-balanced" />
            </span>
            <div className="cobro-cab-campo">
              <span className="cobro-cab-lbl">{tercera.rotulo}</span>
              <span className="cobro-imp-num cobro-imp-num--total">{conSigno(tercera.importe)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
