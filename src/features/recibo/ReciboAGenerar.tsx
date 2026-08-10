import { useState, type ReactNode } from 'react'
import { money } from '@/lib/format'
import { SIN_DATO, type Recibo } from '@/lib/recibo'
import type { FaseEmision } from './useEmisionRecibo'

interface ReciboAGenerarProps {
  /** Las dos tablas del documento y sus totales, ya armadas por `lib/recibo`. */
  recibo: Recibo
  /** En qué anda la emisión: gobierna el tilde y el rótulo de estado de la cabecera. */
  fase: FaseEmision
  /** Etiqueta del estado que publica el tablero. Es la que se muestra mientras se emite. */
  estado: string
}

/** Métrica de la cabecera: rótulo chico arriba y el dato debajo. */
function Dato({ rotulo, children, fuerte }: { rotulo: string; children: ReactNode; fuerte?: boolean }) {
  return (
    <div className="comp-head-dato">
      <span className="comp-head-lbl">{rotulo}</span>
      <span className={`comp-head-val ${fuerte ? 'comp-head-val--imp' : ''}`}>{children}</span>
    </div>
  )
}

/** Dato del documento que el tablero no tiene cargado: se marca, no se deja en blanco. */
const oDato = (valor: string) => valor || <span className="rec-sd">{SIN_DATO}</span>

/**
 * El recibo que se va a emitir: las FORMAS DE PAGO recibidas con su total entregado y los
 * COMPROBANTES que se cancelan con su total cancelado.
 *
 * NO repite la cabecera del documento (título, número y fecha) ni los datos fiscales del cliente:
 * de eso ya se ocupa el resumen de la izquierda, y acá sólo agregaba una segunda copia de lo mismo
 * en la misma pantalla. Esos datos van igual en el PDF que emite el tablero.
 *
 * Es la misma card plegable que la de un comprobante en la emisión de la factura —cabecera siempre
 * visible con lo que hace falta para decidir, y el detalle desplegable debajo—: el documento cambia,
 * la gramática de la pantalla no.
 *
 * Los dos totales se muestran al pie de SU tabla, cada uno cerrando lo suyo: es lo que hace evidente
 * que lo entregado por el cliente y lo cancelado de sus facturas son el mismo importe.
 */
export function ReciboAGenerar({ recibo, fase, estado }: ReciboAGenerarProps) {
  const [abierta, setAbierta] = useState(true)
  const { comprobantes, pagos, totalCancelado, totalEntregado } = recibo
  const enCurso = fase === 'creando' || fase === 'emitiendo'
  const emitido = fase === 'emitido'

  return (
    <div className="comprobantes">
      <div className="comprobantes-head">
        <h3 className="resumen-title">Comprobante a generar</h3>
      </div>

      <div className="comp-card">
        <div className="comp-head">
          <button
            type="button"
            className="comp-toggle"
            aria-expanded={abierta}
            onClick={() => setAbierta((v) => !v)}
          >
            <i className={`fas fa-chevron-down comp-chev ${abierta ? 'open' : ''}`} />
            <span className="comp-tit">
              Recibo
              <span className="pbadge">Documento de cobro</span>
            </span>
          </button>

          <div className="comp-head-datos">
            <Dato rotulo="Comprobantes">{comprobantes.length}</Dato>
            <Dato rotulo="Formas de pago">{pagos.length}</Dato>
            <Dato rotulo="Importe del recibo" fuerte>
              {money(totalCancelado)}
            </Dato>
          </div>

          {/* El mismo semáforo que el botón, sobre la card: girando mientras se emite, tildado en
              verde al cerrar bien y en rojo si el tablero devolvió un error. */}
          <span className="comp-estado">
            {enCurso && (
              <span className="comp-estado-txt">
                <i className="fas fa-circle-notch fa-spin" /> Emitiendo…
              </span>
            )}
            {fase === 'error' && (
              <span className="comp-estado-txt comp-estado-txt--err">{estado || 'Error'}</span>
            )}
            <span
              className={`comp-ok ${emitido ? 'on' : ''} ${fase === 'error' ? 'comp-ok--err' : ''}`}
              title={emitido ? `Recibo emitido${estado ? ` · ${estado}` : ''}` : 'Pendiente de emisión'}
            >
              <i className={`fas ${fase === 'error' ? 'fa-triangle-exclamation' : 'fa-check'}`} />
            </span>
          </span>
        </div>

        {abierta && (
          <div className="comp-body">
            <p className="rec-leyenda">RECIBIMOS CONFORME EL IMPORTE DETALLADO.</p>

            {/* --- Tabla 1 · las formas de pago con las que el cliente entregó el dinero --- */}
            <table className="comp-table rec-tabla">
              <thead>
                <tr>
                  <th>Forma de pago / Caja</th>
                  <th>Nro de Comprobante</th>
                  <th className="ta-r">Importe Entregado</th>
                </tr>
              </thead>
              <tbody>
                {pagos.length === 0 ? (
                  <tr className="rec-vacia">
                    <td colSpan={3}>El cobro no tiene formas de pago registradas.</td>
                  </tr>
                ) : (
                  pagos.map((p) => (
                    <tr key={p.id}>
                      <td className="rec-pago">{p.descripcion}</td>
                      <td>{oDato(p.comprobante)}</td>
                      <td className="ta-r rec-imp">{money(p.entregado)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            <div className="rec-total">
              <span className="rec-total-lbl">TOTAL ENTREGADO:</span>
              <span className="rec-total-val">{money(totalEntregado)}</span>
            </div>

            {/* --- Tabla 2 · las facturas que este recibo cancela --- */}
            <h4 className="rec-sub">Comprobantes</h4>
            <table className="comp-table rec-tabla">
              <thead>
                <tr>
                  <th>Comprobante</th>
                  <th>Fecha Emisión</th>
                  <th>Fecha Venc.</th>
                  <th className="ta-r">Importe Cancelado</th>
                </tr>
              </thead>
              <tbody>
                {comprobantes.length === 0 ? (
                  <tr className="rec-vacia">
                    <td colSpan={4}>El cobro no tiene facturas imputadas.</td>
                  </tr>
                ) : (
                  comprobantes.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <span className="rec-comp">Factura {c.nro}</span>
                        {/* Nombre del ítem en el tablero: la venta que dejó la deuda. */}
                        {c.idVenta && <span className="rec-comp-vta">{c.idVenta}</span>}
                      </td>
                      <td className="rec-fecha">{oDato(c.emision)}</td>
                      <td className="rec-fecha">{oDato(c.vencimiento)}</td>
                      <td className="ta-r rec-imp">{money(c.cancelado)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            <div className="rec-total">
              <span className="rec-total-lbl">TOTAL CANCELADO:</span>
              <span className="rec-total-val">{money(totalCancelado)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
