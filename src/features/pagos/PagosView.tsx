import { PasoHeader } from '@/features/shared/PasoHeader'

/**
 * Módulo de PAGOS. Es una operación INDEPENDIENTE de Cobros: no comparte etapas, ni pantallas, ni
 * el estado de trabajo —cambiar de módulo descarta lo que se venía cargando en el otro (ver
 * `setOperacionApp`)—.
 *
 * Su circuito todavía no está definido, así que esta vista es lo único que el módulo dibuja: la
 * barra de contexto —que es lo que permite volver a Cobros— y el aviso de que las etapas se
 * especifican aparte.
 *
 * El encabezado va SIN barra de etapas a propósito. Mostrar acá el stepper de Cobros sería afirmar
 * un recorrido que este módulo no tiene, y dejaría al usuario navegando pasos ajenos.
 *
 * Cuando Pagos tenga sus etapas, se reemplaza el cuerpo de esta vista por su propio recorrido: el
 * ruteo de `App` ya lo trata como un circuito aparte, así que no hay que tocar el de Cobros.
 */
export function PagosView() {
  return (
    <section className="view paso-layout">
      <PasoHeader pasos={false} />

      <div className="paso-body">
        <header className="header-section">
          <div className="step-indicator-main">
            <div className="step-badge-main">
              <i className="fas fa-money-bill-transfer" />
            </div>
            <div className="step-details-main">
              <h1 className="step-title-main">Pagos</h1>
              <p className="step-desc-main">
                Registro de pagos a proveedores. Es un circuito propio, independiente del de cobros.
              </p>
            </div>
          </div>
        </header>

        <div className="card card--config en-desarrollo">
          <i className="fas fa-screwdriver-wrench" />
          <div>
            <strong>Módulo en construcción</strong>
            <p className="muted">
              Las etapas y las pantallas de Pagos todavía no están definidas. Mientras tanto, volvé
              a <strong>Cobros</strong> desde el selector del encabezado para operar.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
