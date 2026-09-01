import { useApp, useDispatch } from '@/state/hooks'
import type { TipoOperacionPago } from '@/types'

/**
 * Lo que se puede pagar, con el rótulo que ve el usuario. Hoy hay una sola opción; el orden es el
 * del selector y la clave es la que ramificará el recorrido cuando haya más de una.
 */
const OPCIONES: readonly { valor: TipoOperacionPago; label: string }[] = [
  { valor: 'facturasCompra', label: 'Facts de Compra Pendientes de Pago' },
  { valor: 'anticipo', label: 'Entrega de un Anticipo' },
  { valor: 'aplicacion', label: 'Aplicación Anticipo contra Facturas de Compra' },
]

/**
 * Lo PRIMERO que se define en la operación de pago: qué se va a pagar. Es una copia exacta de la
 * caja con la que Cobros pregunta "¿Qué vas a cobrar?" (`OperacionConfig`) —mismo ícono en pastilla
 * violeta, misma pregunta arriba, mismo selector debajo—, con la pregunta y el catálogo de este
 * módulo.
 *
 * Nada viene preseleccionado: el placeholder "Seleccionar..." es lo que hace evidente que falta
 * decidirlo, y así el paso 1 puede reclamarlo igual que en Cobros. Elegirlo es lo que habilita
 * buscar al proveedor —y lo que decide cuántas etapas tiene el recorrido, porque el anticipo se
 * saltea la de facturas pendientes—.
 */
export function OperacionPagoConfig() {
  const { tipoOperacionPago } = useApp()
  const dispatch = useDispatch()

  return (
    <div className="operacion-cfg">
      <div className="cfgbox">
        <div className="cfg-ic">
          {/* El dinero que sale: lo que se está por hacer es registrar un pago. */}
          <i className="fas fa-money-bill-transfer" />
        </div>
        <div className="cfg-c">
          <div className="cfg-l">Que vas a Pagar?</div>
          <select
            className={`cfg-sel ${tipoOperacionPago ? '' : 'cfg-sel--ph'}`}
            aria-label="Que vas a Pagar?"
            value={tipoOperacionPago ?? ''}
            onChange={(e) =>
              dispatch({
                type: 'setTipoOperacionPago',
                tipo: e.target.value as TipoOperacionPago,
              })
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
