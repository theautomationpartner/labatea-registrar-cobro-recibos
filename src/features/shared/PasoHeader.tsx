import { type ReactNode } from 'react'
import { Stepper } from '@/components/ui/Stepper'
import { SelectoresContexto } from '@/features/shared/TopSelectors'
import { etiquetasDe, indiceDePaso, pasosDe } from '@/lib/pasos'
import { etiquetasPago, indiceDePasoPago, pasosDePago } from '@/lib/pasosPago'
import { useApp, useDispatch } from '@/state/hooks'

interface PasoHeaderProps {
  /**
   * Índice del paso en curso (0-based). Por defecto, el del paso del estado: cada vista ya sabe
   * cuál es, así que no tiene que repetirlo. Se puede pisar para casos puntuales.
   */
  actual?: number
  /**
   * Mostrar la barra de etapas. En `false` queda sólo la barra de contexto: es lo que necesita un
   * MÓDULO sin recorrido definido —Pagos—, donde un stepper con las etapas de Cobros estaría
   * afirmando un circuito que ahí no existe.
   */
  pasos?: boolean
  /** Se monta dentro de la barra de selectores, a la derecha (acciones del paso). */
  children?: ReactNode
}

/**
 * Barra de contexto del flujo: a la izquierda la marca y el usuario responsable (que valen para
 * toda la transacción) y a la derecha el avance por pasos. La usa TODA la app, en los cuatro pasos,
 * así el encabezado no se mueve de lugar al avanzar.
 *
 * La barra de etapas SIEMPRE está presente: no hace falta reservar su espacio con una versión
 * fantasma, como sí ocurría en la app de operaciones de venta, donde el paso inicial se dibujaba
 * antes de confirmar la operación.
 *
 * Las etapas que muestra son las de la operación ELEGIDA (`lib/pasos`): el anticipo no pasa por las
 * ventas pendientes de cobro, así que su stepper tiene tres círculos y no cuatro. Mientras no se
 * eligió qué registrar se muestra el recorrido del cobro, que es el completo.
 *
 * Los círculos navegan entre etapas YA alcanzadas (índice ≤ `pasoMaxIdx`): permiten volver atrás a
 * revisar y saltar de nuevo hacia adelante sin perder los datos. Los pasos futuros quedan
 * bloqueados. El destino de cada índice sale del recorrido (mismo orden que las etiquetas).
 */
export function PasoHeader({ actual, pasos = true, children }: PasoHeaderProps) {
  const {
    operacionApp,
    paso,
    pasoMaxIdx,
    pasoPago,
    pasoPagoMaxIdx,
    tipoOperacion,
    tipoOperacionPago,
  } = useApp()
  const dispatch = useDispatch()

  /* Qué recorrido dibuja el stepper. Se decide por el MÓDULO y no por el paso: Cobros y Pagos son
     operaciones independientes, con etapas propias y estado propio, así que cada una navega por su
     recorrido y por su índice de avance. Mezclarlos dejaría al usuario saltando a pasos ajenos. */
  const enPagos = operacionApp === 'PAGOS'
  const etiquetas = enPagos ? etiquetasPago(tipoOperacionPago) : etiquetasDe(tipoOperacion)
  const indice =
    actual ??
    (enPagos
      ? indiceDePasoPago(pasoPago, tipoOperacionPago)
      : indiceDePaso(paso, tipoOperacion))
  const maxAlcanzado = enPagos ? pasoPagoMaxIdx : pasoMaxIdx

  const irAPaso = (i: number) => {
    if (enPagos) {
      const destinoPago = pasosDePago(tipoOperacionPago)[i]
      if (destinoPago) dispatch({ type: 'gotoPago', paso: destinoPago })
      return
    }
    const destino = pasosDe(tipoOperacion)[i]
    if (destino) dispatch({ type: 'goto', paso: destino })
  }

  return (
    <header className="paso-header">
      <div className="paso-header-in">
        <div className="paso-header-sel">
          <SelectoresContexto>{children}</SelectoresContexto>
        </div>

        {pasos && (
          <div className="paso-header-steps">
            <Stepper
              steps={etiquetas}
              current={indice}
              className="stepper--tight"
              maxReached={maxAlcanzado}
              onStep={irAPaso}
            />
          </div>
        )}
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
