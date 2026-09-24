import { useState } from 'react'
import { pdfDeResumen } from '@/services/monday/resumenCtaCte'
import type { FormatoResumen } from '@/types'
import type { DocumentoArchivo } from '../../../api/_archivoResumen'

const ROTULO: Record<DocumentoArchivo, string> = {
  resumen: 'Ver / Imprimir Resumen',
  estado: 'Ver / Imprimir Estado',
}

/* Cuánto vive el enlace local al PDF. La pestaña ya lo cargó entero mucho antes; se suelta para no
   dejar el archivo retenido en memoria mientras la app siga abierta. */
const VIDA_ENLACE_MS = 5 * 60_000

interface VerPdfResumenProps {
  ctaCteId: string | null
  formato: FormatoResumen | null
  /** El estado de cuenta se pidió junto con el resumen: también se ofrece su PDF. */
  incluyeEstado: boolean
}

/**
 * Los botones para ABRIR EN UNA PESTAÑA el PDF de cada documento recién generado, y desde ahí
 * imprimirlo con el visor del navegador. Sólo con el resumen emitido, y sólo si se pidió en PDF: un
 * Excel no se imprime desde el navegador.
 *
 * La pestaña se abre EN EL CLIC, en blanco, y se le carga el PDF cuando llega: abrirla recién después
 * de bajarlo haría que el navegador la tome por una ventana emergente y la bloquee.
 */
export function VerPdfResumen({ ctaCteId, formato, incluyeEstado }: VerPdfResumenProps) {
  const [abriendo, setAbriendo] = useState<DocumentoArchivo | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!ctaCteId || (formato !== 'PDF' && formato !== 'Ambos')) return null
  const disponibles: DocumentoArchivo[] = incluyeEstado ? ['resumen', 'estado'] : ['resumen']

  const abrir = async (documento: DocumentoArchivo) => {
    setError(null)
    setAbriendo(documento)
    const pestana = window.open('', '_blank')
    if (pestana) {
      pestana.document.title = 'Abriendo PDF…'
      pestana.document.body.textContent = 'Abriendo PDF…'
    }
    try {
      const url = URL.createObjectURL(await pdfDeResumen(ctaCteId, documento))
      setTimeout(() => URL.revokeObjectURL(url), VIDA_ENLACE_MS)
      if (pestana && !pestana.closed) pestana.location.href = url
      else if (!window.open(url, '_blank')) {
        setError('El navegador bloqueó la pestaña del PDF. Permití las ventanas emergentes y volvé a probar.')
      }
    } catch (e) {
      pestana?.close()
      setError((e as Error).message)
    } finally {
      setAbriendo(null)
    }
  }

  return (
    <div className="res-pdf">
      <div className="res-pdf-btns">
        {disponibles.map((d) => (
          <button
            key={d}
            type="button"
            className="btn btn-out btn--h38 res-pdf-btn"
            disabled={abriendo !== null}
            aria-busy={abriendo === d}
            onClick={() => void abrir(d)}
          >
            <i className={abriendo === d ? 'fas fa-circle-notch fa-spin' : 'fas fa-print'} /> {ROTULO[d]}
          </button>
        ))}
      </div>
      {error && (
        <div className="rec-aviso" role="alert">
          <i className="fas fa-triangle-exclamation" /> {error}
        </div>
      )}
    </div>
  )
}
