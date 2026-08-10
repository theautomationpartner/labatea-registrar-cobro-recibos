import { useRef, useState } from 'react'

/**
 * Adjunto de un comprobante: `input[type=file]` real (oculto) con una zona de arrastrar y soltar
 * encima. Lo comparten la transferencia, las retenciones y el cobro con tarjeta, que exigen el
 * archivo para poder cargar el movimiento.
 *
 * Devuelve el `File`, no sólo su nombre: las columnas `file` del recibo se completan subiendo el
 * binario (`add_file_to_column`), nunca por `column_values`.
 */
export function AdjuntoComprobante({
  id,
  nombre,
  onArchivo,
}: {
  id: string
  nombre: string
  onArchivo: (f: File | null) => void
}) {
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  return (
    <div
      className={`cobro-drop ${dragOver ? 'is-over' : ''} ${nombre ? 'has-file' : ''}`}
      onClick={() => fileRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        onArchivo(e.dataTransfer.files?.[0] ?? null)
      }}
    >
      <input
        ref={fileRef}
        id={id}
        type="file"
        hidden
        onChange={(e) => onArchivo(e.target.files?.[0] ?? null)}
      />
      {nombre ? (
        <span className="cobro-drop-file">
          <i className="fas fa-file-lines" /> {nombre}
          <button
            type="button"
            className="cobro-drop-x"
            aria-label="Quitar el comprobante"
            onClick={(e) => {
              e.stopPropagation()
              onArchivo(null)
            }}
          >
            <i className="fas fa-xmark" />
          </button>
        </span>
      ) : (
        <span className="cobro-drop-hint">
          <i className="fas fa-cloud-arrow-up" /> Arrastrá y soltá el comprobante, o hacé click para
          elegirlo
        </span>
      )}
    </div>
  )
}
