import { useEffect, useState } from 'react'
import { Donut } from '@/components/ui/Donut'
import { colorCancelacion, excedeSaldo, impactoImputacion, MENSAJE_EXCESO } from '@/lib/cobros'
import { formatearImporteAR, importeATexto, money } from '@/lib/format'
import type { FacturaPendiente } from '@/types'

interface PanelImputacionProps {
  factura: FacturaPendiente
  /** Importe a cancelar ya guardado en el estado. 0 = todavía sin cargar. */
  importe: number
  onImporte: (importe: number) => void
}

/** Texto del input para un importe: vacío mientras no se cargó nada, para no arrancar con un "0". */
const aTexto = (importe: number): string => (importe > 0 ? importeATexto(importe) : '')

/**
 * Panel de pago que se despliega bajo la factura seleccionada: cuánto se le cancela y, al lado, el
 * impacto de ese importe sobre su saldo, recalculado en vivo mientras se tipea.
 *
 * El porcentaje del anillo se mide contra el SALDO PENDIENTE de la factura, no contra su total: lo
 * que se está decidiendo es qué parte de la deuda se cancela con este cobro.
 */
export function PanelImputacion({ factura, importe, onImporte }: PanelImputacionProps) {
  /* El input muestra el importe con formato argentino, así que su texto es estado propio: el
     estado global sólo guarda el número. */
  const [texto, setTexto] = useState(() => aTexto(importe))

  /* Resincroniza cuando el importe cambia desde AFUERA (por ejemplo con "Cancelar el total"). Si
     el número ya coincide con lo tipeado no se toca el texto, así el formateo no pelea con el
     cursor mientras se escribe. */
  useEffect(() => {
    setTexto((actual) => (formatearImporteAR(actual).valor === importe ? actual : aTexto(importe)))
  }, [importe])

  const excede = excedeSaldo(factura, importe)
  const { pct, aCobrar, pendienteResultante } = impactoImputacion(factura, importe)
  const cancelaTodo = !excede && aCobrar > 0 && pendienteResultante === 0
  const color = colorCancelacion(pct)

  return (
    <div className="fact-panel">
      <div className="fact-panel-pago">
        <label className="fact-panel-lbl" htmlFor={`imp-${factura.id}`}>
          Importe a cancelar $
        </label>
        <div className={`fact-input-wrap ${excede ? 'fact-input-wrap--error' : ''}`}>
          <span className="fact-input-signo">$</span>
          <input
            id={`imp-${factura.id}`}
            type="text"
            inputMode="decimal"
            className="fact-input"
            autoComplete="off"
            placeholder="0,00"
            value={texto}
            aria-invalid={excede || undefined}
            aria-describedby={excede ? `err-${factura.id}` : undefined}
            onChange={(e) => {
              const { texto: fmt, valor } = formatearImporteAR(e.target.value)
              setTexto(fmt)
              onImporte(valor)
            }}
          />
        </div>

        {/* El exceso se avisa acá mismo, donde se produce; al continuar se repite en la ventana. */}
        {excede ? (
          <p className="fact-input-error" id={`err-${factura.id}`} role="alert">
            <i className="fas fa-circle-exclamation" /> {MENSAJE_EXCESO}
          </p>
        ) : (
          <div className="fact-panel-acciones">
            <span className="fact-panel-tope">Máximo: {money(factura.pendiente)}</span>
            {/* Atajo del caso más común de una cobranza: cancelar la factura entera. */}
            <button
              type="button"
              className="fact-panel-todo"
              disabled={cancelaTodo}
              onClick={() => onImporte(factura.pendiente)}
            >
              Cancelar el total
            </button>
          </div>
        )}
      </div>

      <div className="fact-panel-graf">
        <span className="fact-panel-lbl">Pagado / Pendiente</span>
        <div className="fact-panel-graf-in">
          <Donut percent={pct} color={color} />
          <dl className="fact-panel-metricas">
            <div>
              <dt>Se cancela</dt>
              <dd style={{ color }}>{pct}%</dd>
            </div>
            <div>
              <dt>Monto a cobrar</dt>
              <dd>{money(aCobrar)}</dd>
            </div>
            <div>
              <dt>Pendiente resultante</dt>
              <dd className={cancelaTodo ? 't-green' : 't-red'}>{money(pendienteResultante)}</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  )
}
