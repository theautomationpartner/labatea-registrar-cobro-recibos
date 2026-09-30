import { useEffect, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { Modal } from '@/components/ui/Modal'
import { useApp } from '@/state/hooks'
import type { FaseEmision } from '@/types'

interface OpcionesReemision {
  /** Cómo se nombra el documento, con su artículo: "el recibo", "la orden de pago". */
  nombre: string
  /** Ya hay documento emitido (PDF en la app). */
  emitido: boolean
  /** La firma con la que se emitió el documento. `null` sin documento. */
  firmaEmitida: string | null
  /** La firma de los datos que hay HOY en pantalla (ver `firmaDe`). */
  firmaActual: string
  /**
   * El documento ya empezó a registrarse en Monday (su ítem existe). Ahí NO se reemite ni se descarta:
   * emitir de nuevo terminaría creando otro ítem. Mientras tanto la vista avisa que hay cambios.
   */
  creado: boolean
  /** Descarta el documento emitido (y su envío). */
  descartar: () => void
  /** La emisión de la vista. */
  emitir: () => void
}

/**
 * Reemisión de los documentos que genera la app (recibo, orden de pago, resumen de cta cte):
 *
 *   · Emitir se puede REPETIR —para corregir un error—, pero SIEMPRE con confirmación: el documento
 *     emitido se pierde (y con él su envío), esté enviado o no. "Aceptar" emite de nuevo —con la
 *     animación de "Emitiendo"— y "Cancelar" no hace nada.
 *   · Mientras se está ENVIANDO el documento no se puede reemitir: se estaría reemplazando el PDF que
 *     está saliendo en ese momento.
 *   · Si hay PDF y su firma no coincide con la de los datos actuales —se volvió a un paso anterior y
 *     se cambió algo—, el PDF se descarta solo (con su envío) y la etapa vuelve a "Emitir": no se envía
 *     ni se registra un documento que dice otra cosa.
 */
export function useReemision({ nombre, emitido, firmaEmitida, firmaActual, creado, descartar, emitir }: OpcionesReemision) {
  const { envioEnCurso } = useApp()

  useEffect(() => {
    if (emitido && !creado && firmaEmitida != null && firmaEmitida !== firmaActual) descartar()
  }, [emitido, creado, firmaEmitida, firmaActual, descartar])

  const [ventana, setVentana] = useState<'confirmar' | 'enviando' | null>(null)
  const cerrar = () => setVentana(null)

  const pedirEmision = () => {
    if (creado) return
    if (envioEnCurso) setVentana('enviando')
    else if (emitido) setVentana('confirmar')
    else emitir()
  }

  const modal =
    ventana === 'confirmar' ? (
      <Modal
        title={`¿Volver a emitir ${nombre}?`}
        icon={<i className="fas fa-triangle-exclamation modal-icon--warn" />}
        onClose={cerrar}
        actions={
          <>
            <button type="button" className="btn btn-out" onClick={cerrar}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                cerrar()
                emitir()
              }}
            >
              Aceptar
            </button>
          </>
        }
      >
        Se emitirá un documento nuevo y el actual emitido se perderá. ¿Desea continuar?
      </Modal>
    ) : ventana === 'enviando' ? (
      <AvisoModal titulo={`No se puede volver a emitir ${nombre}`} onClose={cerrar}>
        {`Se está enviando ${nombre}. Esperá a que termine el envío para volver a emitirlo.`}
      </AvisoModal>
    ) : null

  return { pedirEmision, modal }
}

/**
 * Guarda de "Registrar": no se registra en Monday un documento que se está EMITIENDO o ENVIANDO —lo
 * que quedaría en el tablero sería un PDF a punto de cambiar, o uno que todavía no le llegó a nadie—.
 * El "no emitido" lo sigue avisando cada vista, con su propio texto.
 *
 * `frenar()` devuelve `true` (y abre la ventana que explica por qué) cuando no se puede registrar.
 */
export function useGuardaRegistro(nombre: string, fase: FaseEmision) {
  const { envioEnCurso } = useApp()
  const [motivo, setMotivo] = useState<'emitiendo' | 'enviando' | null>(null)

  const frenar = (): boolean => {
    const enCurso = fase === 'creando' ? 'emitiendo' : envioEnCurso ? 'enviando' : null
    if (enCurso) setMotivo(enCurso)
    return enCurso !== null
  }

  const modal = motivo ? (
    <AvisoModal titulo={`Todavía no se puede registrar ${nombre}`} onClose={() => setMotivo(null)}>
      {motivo === 'emitiendo'
        ? `Se está emitiendo ${nombre}. Esperá a que termine la emisión para registrarlo.`
        : `Se está enviando ${nombre}. Esperá a que termine el envío para registrarlo.`}
    </AvisoModal>
  ) : null

  return { frenar, modal }
}
