import { useApp, useDispatch } from '@/state/hooks'
import type { TipoOperacion } from '@/types'

/**
 * Las tres cosas que se pueden cobrar, con el rótulo que ve el usuario. El orden es el del
 * selector; la clave es la que ramifica el recorrido (`lib/pasos`) y el tipo de cobro del recibo.
 *
 * Los rótulos nombran QUÉ se cobra —no qué hace la app—, que es la pregunta que encabeza la caja.
 */
const OPCIONES: readonly { valor: TipoOperacion; label: string }[] = [
  { valor: 'cobro', label: 'Cancelación de Vtas Pends de Cobro' },
  { valor: 'anticipo', label: 'Anticipo' },
  { valor: 'aplicacion', label: 'Aplicación Anticipo contra Facturas' },
]

/**
 * Lo PRIMERO que se define en la operación: qué se va a cobrar. Está antes del buscador de
 * cliente a propósito —decide cuántas etapas tiene el recorrido y qué se hace en cada una—, así que
 * elegirlo después de haber cargado datos obligaría a descartarlos (que es justamente lo que hace
 * el reducer si se cambia).
 *
 * Es la misma caja de configuración que la app de operaciones de venta usa para el tipo de venta:
 * ícono en pastilla violeta, la pregunta arriba y el selector debajo. Nada viene preseleccionado: el
 * placeholder "Seleccionar..." es lo que hace evidente que falta decidirlo.
 */
export function OperacionConfig() {
  const { tipoOperacion } = useApp()
  const dispatch = useDispatch()

  return (
    <div className="operacion-cfg">
      <div className="cfgbox">
        <div className="cfg-ic">
          {/* La caja registradora: lo que se está por hacer es registrar una cobranza. */}
          <i className="fas fa-cash-register" />
        </div>
        <div className="cfg-c">
          <div className="cfg-l">¿Qué vas a cobrar?</div>
          <select
            className={`cfg-sel ${tipoOperacion ? '' : 'cfg-sel--ph'}`}
            aria-label="¿Qué vas a cobrar?"
            value={tipoOperacion ?? ''}
            onChange={(e) =>
              dispatch({ type: 'setTipoOperacion', tipo: e.target.value as TipoOperacion })
            }
          >
            <option value="" disabled>
              Seleccionar...
            </option>
            {OPCIONES.map((o) => (
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
