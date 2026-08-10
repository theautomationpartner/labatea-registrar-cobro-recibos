import { type ReactNode } from 'react'
import { Stepper } from '@/components/ui/Stepper'
import { SelectoresContexto } from '@/features/shared/TopSelectors'
import { PASOS, PASOS_KEYS, indiceDePaso } from '@/lib/pasos'
import { useApp, useDispatch } from '@/state/hooks'

interface PasoHeaderProps {
  /**
   * Índice del paso en curso (0-based). Por defecto, el del paso del estado: cada vista ya sabe
   * cuál es, así que no tiene que repetirlo. Se puede pisar para casos puntuales.
   */
  actual?: number
  /** Se monta dentro de la barra de selectores, a la derecha (acciones del paso). */
  children?: ReactNode
}

/**
 * Barra de contexto del flujo: a la izquierda la marca y el usuario responsable (que valen para
 * toda la transacción) y a la derecha el avance por pasos. La usa TODA la app, en los cuatro pasos,
 * así el encabezado no se mueve de lugar al avanzar.
 *
 * El recorrido es único (registrar cobro → emitir recibo), así que la barra de etapas SIEMPRE está
 * presente: no hace falta reservar su espacio con una versión fantasma, como sí ocurría en la app
 * de operaciones de venta, donde el paso inicial se dibujaba antes de confirmar la operación.
 *
 * Los círculos del stepper navegan entre etapas YA alcanzadas (índice ≤ `pasoMaxIdx`): permiten
 * volver atrás a revisar y saltar de nuevo hacia adelante sin perder los datos. Los pasos futuros
 * quedan bloqueados. El destino de cada índice sale de `PASOS_KEYS` (mismo orden que las etiquetas).
 */
export function PasoHeader({ actual, children }: PasoHeaderProps) {
  const { paso, pasoMaxIdx } = useApp()
  const dispatch = useDispatch()
  const indice = actual ?? indiceDePaso(paso)

  const irAPaso = (i: number) => {
    const destino = PASOS_KEYS[i]
    if (destino) dispatch({ type: 'goto', paso: destino })
  }

  return (
    <header className="paso-header">
      <div className="paso-header-in">
        <div className="paso-header-sel">
          <SelectoresContexto>{children}</SelectoresContexto>
        </div>

        <div className="paso-header-steps">
          <Stepper
            steps={PASOS}
            current={indice}
            className="stepper--tight"
            maxReached={pasoMaxIdx}
            onStep={irAPaso}
          />
        </div>
      </div>
    </header>
  )
}

interface PasoTituloProps {
  /** Número del paso, el mismo que marca el stepper. */
  numero: number
  titulo: string
  descripcion: ReactNode
}

/**
 * Encabezado del paso: número, título y bajada. Va dentro del cuerpo del paso, debajo de la barra
 * de contexto.
 */
export function PasoTitulo({ numero, titulo, descripcion }: PasoTituloProps) {
  return (
    <header className="header-section">
      <div className="step-indicator-main">
        <div className="step-badge-main">{numero}</div>
        <div className="step-details-main">
          <h1 className="step-title-main">{titulo}</h1>
          <p className="step-desc-main">{descripcion}</p>
        </div>
      </div>
    </header>
  )
}
