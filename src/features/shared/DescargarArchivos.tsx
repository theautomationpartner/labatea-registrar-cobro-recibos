import { useApp, useDispatch } from '@/state/hooks'
import { pendientesDeAbrir } from './VerImprimirPdf'

/* Cuánto vive el enlace local al archivo: la descarga ya arrancó mucho antes. */
const VIDA_ENLACE_MS = 60_000

interface DescargarExcelProps {
  /**
   * Los Excel emitidos, en el orden en que se bajan: el resumen y, si se incluyó, el estado de
   * cuenta. `null` = todavía no se emitió.
   */
  archivos: readonly File[] | null
}

/**
 * El botón "Descargar Excel (n)": el hermano de "Ver / Imprimir" para los archivos que el navegador no
 * muestra. Cada clic baja el SIGUIENTE Excel emitido —primero el resumen, después el estado de cuenta—
 * y el número es cuántos quedan por bajar.
 *
 * Misma lógica que "Ver / Imprimir": se habilita sólo con la emisión terminada y algún Excel por
 * bajar, y la cuenta vive en el estado de la app (`excelsDescargados`), así que ir a otra etapa y
 * volver no la pierde y una emisión nueva la pone en cero. Los archivos los generó la app y están en
 * memoria: se bajan directo, sin pedírselos a Monday.
 */
export function DescargarExcel({ archivos }: DescargarExcelProps) {
  const { excelsDescargados } = useApp()
  const dispatch = useDispatch()

  const pendientes = pendientesDeAbrir(archivos, excelsDescargados)
  const habilitado = pendientes.length > 0

  const bajar = () => {
    const archivo = pendientes[0]
    if (!archivo) return
    const url = URL.createObjectURL(archivo)
    const enlace = document.createElement('a')
    enlace.href = url
    enlace.download = archivo.name
    enlace.click()
    setTimeout(() => URL.revokeObjectURL(url), VIDA_ENLACE_MS)
    dispatch({ type: 'setExcelsDescargados', value: excelsDescargados + 1 })
  }

  return (
    <div className="ver-pdf">
      <button
        type="button"
        className="btn btn-out btn--h38 ver-pdf-btn"
        disabled={!habilitado}
        title={
          habilitado
            ? `Descargar ${pendientes[0].name}`
            : archivos
              ? 'Ya se descargaron todos los Excel emitidos'
              : 'Se habilita cuando termina la emisión'
        }
        onClick={bajar}
      >
        <i className="far fa-file-excel" /> {`Descargar Excel (${pendientes.length})`}
      </button>
    </div>
  )
}
