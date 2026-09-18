import { OPCIONES_ESTADO_CTA_CTE } from '@/lib/resumenCtaCte'
import { useApp, useDispatch } from '@/state/hooks'
import type { EstadoCtaCteResumen } from '@/types'

interface EstadoCtaCteConfigProps {
  /**
   * Se intentó avanzar sin elegir: la caja se marca en rojo. El borde se va solo en cuanto hay una
   * opción elegida —no hace falta que la vista lo apague—, porque lo que marca es el HUECO, no el
   * intento.
   */
  marcarFaltante: boolean
}

/**
 * Lo PRIMERO que se define en un RESUMEN DE CTA CTE: si el documento va con el estado de la cuenta
 * corriente. Es la MISMA caja que "¿Qué vas a cobrar?" en Cobros y "Las cuentas son de:" en el pase
 * —ícono en pastilla violeta, la pregunta arriba y el selector debajo—, y ocupa su mismo lugar:
 * entre el título de la etapa y el buscador.
 *
 * Nada viene preseleccionado: es obligatorio, y el placeholder "Seleccionar..." es lo que hace
 * evidente que falta decidirlo.
 */
export function EstadoCtaCteConfig({ marcarFaltante }: EstadoCtaCteConfigProps) {
  const { resumenEstadoCtaCte } = useApp()
  const dispatch = useDispatch()
  const enFalta = marcarFaltante && !resumenEstadoCtaCte

  return (
    <div className="operacion-cfg">
      <div className={`cfgbox ${enFalta ? 'cfgbox--error' : ''}`}>
        <div className="cfg-ic">
          {/* La cuenta con su saldo: lo que se decide es si el resumen la muestra. */}
          <i className="fas fa-file-invoice-dollar" />
        </div>
        <div className="cfg-c">
          <div className="cfg-l">Estado de Cta Cte</div>
          <select
            className={`cfg-sel ${resumenEstadoCtaCte ? '' : 'cfg-sel--ph'}`}
            aria-label="Estado de Cta Cte"
            aria-invalid={enFalta || undefined}
            value={resumenEstadoCtaCte ?? ''}
            onChange={(e) =>
              dispatch({
                type: 'setResumenEstadoCtaCte',
                estado: e.target.value as EstadoCtaCteResumen,
              })
            }
          >
            <option value="" disabled>
              Seleccionar...
            </option>
            {OPCIONES_ESTADO_CTA_CTE.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}
