import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { useApp } from '@/state/hooks'

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
 * Reemisión de los documentos que genera la app (recibo, orden de pago, resumen de cta cte). Es el
 * `useReemision` de la app de operaciones de venta —presupuesto, remito y proforma—, así las dos apps
 * se comportan igual:
 *
 *   · Emitir se puede REPETIR —para corregir un error—: el botón queda habilitado con el documento ya
 *     emitido, y el PDF nuevo reemplaza al anterior (el envío vuelve a cero).
 *   · Si hay PDF y su firma no coincide con la de los datos actuales —se volvió a un paso anterior y
 *     se cambió algo—, el PDF se descarta solo (con su envío) y la etapa vuelve a "Emitir": no se envía
 *     ni se registra un documento que dice otra cosa.
 *   · `pedirEmision`: lo que hace el botón. Si el documento ya se había enviado a algún contacto,
 *     antes de reemitir se pide confirmación, porque el envío vuelve a cero; si no, emite directo.
 */
export function useReemision({ nombre, emitido, firmaEmitida, firmaActual, creado, descartar, emitir }: OpcionesReemision) {
  const { envioIniciado } = useApp()

  useEffect(() => {
    if (emitido && !creado && firmaEmitida != null && firmaEmitida !== firmaActual) descartar()
  }, [emitido, creado, firmaEmitida, firmaActual, descartar])

  const [confirmar, setConfirmar] = useState(false)

  const pedirEmision = () => {
    if (creado) return
    if (emitido && envioIniciado) setConfirmar(true)
    else emitir()
  }

  const modal = confirmar ? (
    <Modal
      title={`¿Volver a emitir ${nombre}?`}
      icon={<i className="fas fa-triangle-exclamation modal-icon--warn" />}
      onClose={() => setConfirmar(false)}
      actions={
        <>
          <button type="button" className="btn btn-out" onClick={() => setConfirmar(false)}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setConfirmar(false)
              emitir()
            }}
          >
            Volver a emitir
          </button>
        </>
      }
    >
      Se va a generar un PDF nuevo con los datos actuales. Ya lo enviaste a los contactos: el envío
      vuelve a empezar y vas a tener que enviarles el documento nuevo.
    </Modal>
  ) : null

  return { pedirEmision, modal }
}
