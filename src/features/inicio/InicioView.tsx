import { PasoHeader } from '@/features/shared/PasoHeader'
import { useApp, useDispatch } from '@/state/hooks'

/**
 * Paso 0: qué operación se va a registrar y quién la registra, antes de entrar a cualquier
 * circuito.
 *
 * La app NO abre dentro de Cobros. Los cuatro módulos son operaciones independientes —cada uno con
 * sus etapas y su estado—, así que arrancar parado en uno de ellos era elegir por el usuario: quien
 * venía a registrar un pago encontraba media pantalla de Cobros y tenía que salir de ahí.
 *
 * Monta la MISMA barra que el resto de los pasos, sin stepper —todavía no hay recorrido que
 * mostrar—, y le cuelga el botón "Confirmar" a la derecha de los selectores. Que sea la misma barra
 * es lo que hace que el logo y los dos selectores queden exactamente donde van a estar después de
 * confirmar, en lugar de saltar de lugar al abrirse el circuito.
 */
export function InicioView() {
  const { operacionApp, usuario } = useApp()
  const dispatch = useDispatch()

  return (
    <section className="view paso-layout">
      <PasoHeader pasos={false}>
        {/* Sin los DOS datos no hay operación que abrir: el módulo decide qué etapas se dibujan y
            el vendedor es a nombre de quién se registra todo lo que venga después. */}
        <button
          type="button"
          className="btn btn-primary btn--h38"
          disabled={!operacionApp || !usuario}
          onClick={() => dispatch({ type: 'confirmarOperacionApp' })}
        >
          Confirmar <i className="fas fa-check" />
        </button>
      </PasoHeader>
    </section>
  )
}
