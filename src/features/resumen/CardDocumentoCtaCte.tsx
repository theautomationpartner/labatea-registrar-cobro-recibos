import type { ReactNode } from 'react'
import { Dato } from '@/features/recibo/ReciboAGenerar'
import { usePlegable } from '@/features/recibo/usePlegable'
import type { FaseEmision } from '@/types'

interface CardDocumentoCtaCteProps {
  titulo: string
  /** Pastillas al lado del título. La primera es siempre "Documento Cta Cte". */
  badges: readonly string[]
  /** Las métricas de la cabecera, siempre visibles aunque la card esté cerrada. */
  datos: readonly { rotulo: string; valor: ReactNode; fuerte?: boolean }[]
  fase: FaseEmision
  /** Etiqueta del estado que publica el tablero, para el `title` del semáforo. */
  estado: string
  /** El documento: se muestra al desplegar la card. */
  children: ReactNode
}

/**
 * Una card de "Comprobante a generar" del RESUMEN DE CTA CTE. Es la MISMA card plegable que la del
 * recibo (`ReciboAGenerar`): cabecera con título, pastillas, métricas y el semáforo de la emisión, y
 * el documento desplegable debajo. Nace CERRADA.
 *
 * La usan los dos documentos de la etapa —el resumen y, si se incluye, el estado de cuenta—, que se
 * generan en la MISMA emisión: por eso los dos semáforos siguen la misma fase.
 */
export function CardDocumentoCtaCte({
  titulo,
  badges,
  datos,
  fase,
  estado,
  children,
}: CardDocumentoCtaCteProps) {
  const { abierta, abriendo, cerrando, visible, alternar } = usePlegable(false)
  const enCurso = fase === 'creando' || fase === 'emitiendo'
  const emitido = fase === 'emitido'

  return (
    <div className="comp-card">
      <div className="comp-head">
        <button type="button" className="comp-toggle" aria-expanded={abierta} onClick={alternar}>
          <i className={`fas fa-chevron-down comp-chev ${abierta ? 'open' : ''}`} />
          <span className="comp-tit">
            {titulo}
            {badges.map((b) => (
              <span key={b} className="pbadge">
                {b}
              </span>
            ))}
          </span>
        </button>

        <div className="comp-head-datos">
          {datos.map((d) => (
            <Dato key={d.rotulo} rotulo={d.rotulo} fuerte={d.fuerte}>
              {d.valor}
            </Dato>
          ))}
        </div>

        <span className="comp-estado">
          <span
            className={`comp-ok ${emitido ? 'on' : ''} ${fase === 'error' ? 'comp-ok--err' : ''}`}
            title={
              fase === 'error'
                ? `Error al generar · ${titulo}${estado ? ` · ${estado}` : ''}`
                : enCurso
                  ? `Generando · ${titulo}${estado ? ` · ${estado}` : ''}`
                  : emitido
                    ? `${titulo} generado${estado ? ` · ${estado}` : ''}`
                    : 'Pendiente de emisión'
            }
          >
            <i
              className={`fas ${
                fase === 'error'
                  ? 'fa-triangle-exclamation'
                  : enCurso
                    ? 'fa-circle-notch fa-spin'
                    : 'fa-check'
              }`}
            />
          </span>
        </span>
      </div>

      {visible && (
        <div
          className={`rec-exp-wrap ${
            cerrando ? 'rec-exp-wrap--cerrando' : abriendo ? 'rec-exp-wrap--abriendo' : ''
          }`}
        >
          <div className="rec-exp-in">
            <div className="comp-body">{children}</div>
          </div>
        </div>
      )}
    </div>
  )
}
