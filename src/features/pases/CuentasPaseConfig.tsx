import { ladoInicialDePase, ladosDePase } from '@/lib/permisos'
import type { RolPersona } from '@/lib/personas'
import { useApp, useDispatch } from '@/state/hooks'

/**
 * Los dos lados del mostrador, con el rótulo que ve el usuario. El orden es el del selector y la
 * clave es el ROL con el que se valida la categoría de la persona, se leen sus anticipos y se
 * registra el pase (ver `lib/personas`).
 */
const OPCIONES: readonly { valor: RolPersona; label: string }[] = [
  { valor: 'cliente', label: 'De Clientes' },
  { valor: 'proveedor', label: 'De Proveedores' },
]

/**
 * Lo PRIMERO que se define en un PASE DE SALDO: de quiénes son las dos cuentas que el saldo
 * atraviesa. Ocupa en este recorrido el lugar que "¿Qué vas a cobrar?" (`OperacionConfig`) ocupa en
 * Cobros y "Que vas a Pagar?" (`OperacionPagoConfig`) en Pagos, y es la MISMA caja pieza por pieza
 * —ícono en pastilla violeta, la pregunta arriba y el selector debajo—: es la misma clase de
 * decisión, así que se ve igual y se toma en el mismo lugar de la pantalla.
 *
 * Va ANTES del buscador porque lo GOBIERNA: en el board de Personas clientes y proveedores son la
 * misma clase de ítem y sólo los distingue su "✋Categoria" (ver `lib/personas`), así que sin esta
 * respuesta la búsqueda no sabe contra qué categoría consultar ni contra qué validar a quien traiga.
 * Elegirlo es lo que habilita cargar la cuenta origen.
 *
 * Qué lados se OFRECEN lo define el equipo del usuario (ver `ladosDePase`): quien está en "Pago a
 * Proveedores" elige entre clientes y proveedores; el resto sólo ve clientes —la otra opción no
 * aparece—. Con una sola opción ya viene puesta, porque no hay nada que decidir; con dos vuelve el
 * "Seleccionar...", y el paso 1 lo reclama igual que en los otros dos módulos. Cambiarlo descarta
 * lo cargado (ver `setPaseCuentasDe`): del otro lado del mostrador esa persona ni siquiera tiene la
 * categoría que la nueva elección exige.
 */
export function CuentasPaseConfig() {
  const { paseCuentasDe, usuarioActual } = useApp()
  const dispatch = useDispatch()
  /* Sólo los lados que este usuario puede usar. El reducer tampoco acepta otro: esto es lo que se
     ve, la regla vive allá. */
  const permitidos = ladosDePase(usuarioActual)
  const opciones = OPCIONES.filter((o) => permitidos.includes(o.valor))
  /* Lo elegido, o el único posible si el estado todavía no lo tiene: con una opción nunca se
     muestra vacío. Con dos, `null` hasta que el usuario elija. */
  const elegido = paseCuentasDe ?? ladoInicialDePase(usuarioActual)

  return (
    <div className="operacion-cfg">
      <div className="cfgbox">
        <div className="cfg-ic">
          {/* Las personas: lo que se está por decidir es de QUIÉNES son las cuentas del pase. */}
          <i className="fas fa-users" />
        </div>
        <div className="cfg-c">
          <div className="cfg-l">Las cuentas son de:</div>
          <select
            className={`cfg-sel ${elegido ? '' : 'cfg-sel--ph'}`}
            aria-label="Las cuentas son de:"
            value={elegido ?? ''}
            onChange={(e) =>
              dispatch({ type: 'setPaseCuentasDe', rol: e.target.value as RolPersona })
            }
          >
            {/* El placeholder sólo cuando hay algo que elegir: con una opción no hay decisión. */}
            {opciones.length > 1 && (
              <option value="" disabled>
                Seleccionar...
              </option>
            )}
            {opciones.map((o) => (
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

/**
 * Lo que se dice al intentar avanzar —o al elegir a alguien— sin haber declarado de quiénes son las
 * cuentas. Es UN solo texto para los dos lugares: es el mismo hueco, y decirlo distinto en cada uno
 * haría dudar de si son dos cosas.
 */
export const MSG_SIN_CUENTAS_DE =
  'Para continuar tenés que indicar en "Las cuentas son de:" si el pase se hace entre cuentas de clientes o entre cuentas de proveedores.'
