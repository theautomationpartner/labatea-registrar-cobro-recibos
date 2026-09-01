import { money } from '@/lib/format'
import { usePlegable } from '@/features/recibo/usePlegable'

/**
 * Una retención practicada, tal como la publica la constancia. Es una línea del detalle: el régimen
 * bajo el que se retuvo, sobre qué comprobante, la base, la alícuota y cuánto se retuvo.
 */
export interface LineaRetencion {
  id: string
  /** El régimen: "Retencion GAN". */
  regimen: string
  /** Los comprobantes que formaron la base ("Factura N° 0002-00003314"). */
  comprobante: string
  /** Sobre cuánto se aplicó la alícuota. */
  baseImponible: number | null
  /** El porcentaje aplicado. */
  alicuota: number | null
  /** Lo retenido. */
  retenido: number
}

/** La alícuota como la muestra la constancia: dos decimales y el signo. */
const porcentaje = (valor: number | null): string =>
  valor === null ? '—' : `${valor.toFixed(2)}%`

/**
 * La CONSTANCIA DE RETENCIÓN que se emite junto con la orden de pago.
 *
 * Es la misma card plegable que la del documento —cabecera siempre visible con lo que hace falta
 * para decidir, y el detalle desplegable debajo—, con el contenido de la constancia: el detalle de
 * lo retenido y su total. Comparte el mecanismo del plegado (ver `usePlegable`) y las clases de la
 * card, así que las dos se ven y se comportan igual; lo único propio es QUÉ muestra.
 *
 * No lleva semáforo de emisión: la constancia no se emite por su cuenta, sale con la orden. Su
 * estado es el de la orden, que ya se muestra en la card de arriba.
 */
export function RetencionAGenerar({ lineas }: { lineas: readonly LineaRetencion[] }) {
  const { abierta, abriendo, cerrando, visible, alternar } = usePlegable()
  const total = lineas.reduce((acc, l) => acc + l.retenido, 0)

  return (
    <div className="comp-card">
      <div className="comp-head">
        <button type="button" className="comp-toggle" aria-expanded={abierta} onClick={alternar}>
          <i className={`fas fa-chevron-down comp-chev ${abierta ? 'open' : ''}`} />
          <span className="comp-tit">
            Retencion GAN
            <span className="pbadge">CONSTANCIA DE RETENCION</span>
          </span>
        </button>

        <div className="comp-head-datos">
          <div className="comp-head-dato">
            <span className="comp-head-lbl">Monto retenido</span>
            <span className="comp-head-val comp-head-val--imp">{money(total)}</span>
          </div>
        </div>
      </div>

      {visible && (
        /* Los mismos dos envoltorios que la card del documento: el de afuera anima su alto y el de
           adentro recorta lo que todavía no entra. */
        <div
          className={`rec-exp-wrap ${
            cerrando ? 'rec-exp-wrap--cerrando' : abriendo ? 'rec-exp-wrap--abriendo' : ''
          }`}
        >
          <div className="rec-exp-in">
            <div className="comp-body">
              <h4 className="rec-sub">Detalle de la Retención Practicada</h4>
              <table className="comp-table rec-tabla">
                <thead>
                  <tr>
                    <th>Régimen</th>
                    <th>Comprobante Origen</th>
                    <th className="ta-r">Base Imponible</th>
                    <th className="ta-r">Alícuota</th>
                    <th className="ta-r">Monto Retenido</th>
                  </tr>
                </thead>
                <tbody>
                  {lineas.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <span className="rec-comp">{l.regimen}</span>
                      </td>
                      <td>
                        <span className="rec-comp">{l.comprobante}</span>
                      </td>
                      <td className="ta-r rec-imp">
                        {l.baseImponible === null ? (
                          <span className="rec-sd">—</span>
                        ) : (
                          money(l.baseImponible)
                        )}
                      </td>
                      <td className="ta-r rec-imp">{porcentaje(l.alicuota)}</td>
                      <td className="ta-r rec-imp">{money(l.retenido)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="rec-total rec-total--ret">
                <span className="rec-total-lbl">TOTAL RETENIDO:</span>
                <span className="rec-total-val">{money(total)}</span>
              </div>

              {/* La constancia es un documento fiscal: lo dice, como lo dice el PDF que se emite. */}
              <p className="rec-afip">Documento emitido según normativas vigentes de A.F.I.P</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
