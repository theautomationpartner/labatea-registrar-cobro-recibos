import { useEffect, useState, type ReactNode } from 'react'
import { pdfDeResumen, pdfsDeLaEmision } from '@/services/monday/resumenCtaCte'
import { useApp, useDispatch } from '@/state/hooks'
import type { DocumentoResumen, FaseEmision, FormatoResumen } from '@/types'
import { NOMBRE_DOCUMENTO } from '../../../api/_archivoResumen'

/* Cuánto vive el enlace local al PDF. La pestaña ya lo cargó entero mucho antes; se suelta para no
   dejar el archivo retenido en memoria mientras la app siga abierta. */
const VIDA_ENLACE_MS = 5 * 60_000
/* Cada cuánto se mira la columna mientras la emisión corre: el mismo ritmo que el seguimiento del
   tablero (ver `useEmision`). */
const INTERVALO_MS = 3000

interface VerPdfResumenProps {
  ctaCteId: string | null
  formato: FormatoResumen | null
  /** El estado de cuenta se pidió junto con el resumen: también se busca su PDF. */
  incluyeEstado: boolean
  fase: FaseEmision
  /**
   * Los mensajes de la EMISIÓN (su error). Van debajo de este botón y no entre los dos: el botón de
   * emitir y el de ver quedan siempre juntos.
   */
  children?: ReactNode
}

/**
 * Los documentos emitidos que todavía no se abrieron, en el orden en que se abren: primero el
 * resumen, después el estado.
 */
export const pendientesDeAbrir = (
  emitidos: readonly DocumentoResumen[],
  abiertos: readonly DocumentoResumen[],
): DocumentoResumen[] => emitidos.filter((d) => !abiertos.includes(d))

/**
 * El botón "Ver / Imprimir (n)": cada clic abre en una pestaña el PDF del siguiente documento emitido
 * —primero el resumen, después el estado— y desde ahí se imprime con el visor del navegador.
 *
 * El número es cuántos documentos emitidos quedan por abrir. Arranca en 0, suma uno por cada PDF que
 * la emisión deja en la cuenta y resta uno por cada documento que se abre. Una sola pestaña por clic:
 * es lo que el navegador siempre deja abrir sin tomarla por ventana emergente.
 *
 * Está SIEMPRE, pero se habilita sólo con la emisión TERMINADA —bien o con error— y algún documento
 * por abrir: mientras la emisión corre el número ya cuenta, pero no se imprime un documento a mitad de
 * camino. Qué salió se sabe por los PDFs NUEVOS de la columna (ver `pdfsDeLaEmision`): el tablero da
 * un solo estado para los dos documentos.
 *
 * El contador vive en el estado de la app (`resumenPdfs`) y no acá: ir a otra etapa y volver no lo
 * pierde. La emisión que arranca lo pone en cero.
 *
 * La pestaña se abre EN EL CLIC, en blanco, y se le carga el PDF cuando llega: abrirla recién después
 * de bajarlo haría que el navegador la bloquee.
 */
export function VerPdfResumen({ ctaCteId, formato, incluyeEstado, fase, children }: VerPdfResumenProps) {
  const { emitidos, abiertos, listo } = useApp().resumenPdfs
  const dispatch = useDispatch()
  const [abriendo, setAbriendo] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const enCurso = fase === 'creando' || fase === 'emitiendo'
  const terminada = fase === 'emitido' || fase === 'error'
  const conPdf = formato === 'PDF' || formato === 'Ambos'

  /* Qué PDFs dejó la emisión: mientras corre, cada pocos segundos, para que el número vaya subiendo;
     al terminar, una última vez, que es la que habilita el botón. Si ese conteo final ya se hizo
     —se volvió a la etapa con la emisión terminada—, no se repite. */
  useEffect(() => {
    if (!ctaCteId || !conPdf || (fase !== 'emitiendo' && !terminada) || (terminada && listo)) return
    let vigente = true
    let timer: number | undefined
    const pedidos: DocumentoResumen[] = incluyeEstado ? ['resumen', 'estado'] : ['resumen']
    const mirar = () =>
      pdfsDeLaEmision(ctaCteId, pedidos, { conFoto: !terminada })
        .then((docs) => {
          if (vigente) dispatch({ type: 'setResumenPdfs', pdfs: { emitidos: docs, listo: terminada } })
        })
        .catch(() => {
          if (vigente && terminada) {
            setError('No pudimos ver qué PDFs dejó la emisión. Recargá la app para volver a intentarlo.')
          }
        })
        .finally(() => {
          if (vigente && !terminada) timer = window.setTimeout(mirar, INTERVALO_MS)
        })
    void mirar()
    return () => {
      vigente = false
      window.clearTimeout(timer)
    }
  }, [ctaCteId, conPdf, incluyeEstado, fase, terminada, listo, dispatch])

  const pendientes = pendientesDeAbrir(emitidos, abiertos)
  const habilitado = terminada && pendientes.length > 0 && !abriendo

  /** Abre el siguiente documento. Sólo si se abrió, deja de contar como pendiente. */
  const abrir = async () => {
    const documento = pendientes[0]
    if (!ctaCteId || !documento) return
    setError(null)
    const pestana = window.open('', '_blank')
    if (!pestana) {
      setError('El navegador bloqueó la pestaña del PDF. Permití las ventanas emergentes de este sitio y volvé a hacer clic.')
      return
    }
    setAbriendo(true)
    pestana.document.title = 'Abriendo PDF…'
    pestana.document.body.textContent = `Abriendo el PDF del ${NOMBRE_DOCUMENTO[documento]}…`
    try {
      const url = URL.createObjectURL(await pdfDeResumen(ctaCteId, documento))
      setTimeout(() => URL.revokeObjectURL(url), VIDA_ENLACE_MS)
      if (!pestana.closed) pestana.location.href = url
      dispatch({ type: 'setResumenPdfs', pdfs: { abiertos: [...abiertos, documento] } })
    } catch (e) {
      pestana.close()
      setError((e as Error).message)
    } finally {
      setAbriendo(false)
    }
  }

  return (
    <div className="res-pdf">
      <button
        type="button"
        className="btn btn-out btn--h38 res-pdf-btn"
        disabled={!habilitado}
        aria-busy={abriendo}
        title={
          habilitado
            ? `Abrir el ${NOMBRE_DOCUMENTO[pendientes[0]]}`
            : enCurso
              ? 'Se habilita cuando termina la emisión'
              : undefined
        }
        onClick={() => void abrir()}
      >
        <i className={abriendo ? 'fas fa-circle-notch fa-spin' : 'fas fa-print'} />{' '}
        {`Ver / Imprimir (${pendientes.length})`}
      </button>

      {children}

      {error && (
        <div className="rec-aviso" role="alert">
          <i className="fas fa-triangle-exclamation" /> {error}
        </div>
      )}
    </div>
  )
}
