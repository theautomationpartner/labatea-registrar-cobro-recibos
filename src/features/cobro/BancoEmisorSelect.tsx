import { SelectConAlta } from './SelectConAlta'
import { BANCOS_EMISORES_BASE, STORAGE_BANCOS } from './useOpcionesRecordadas'

interface BancoEmisorSelectProps {
  /** id del control, para enganchar el <label htmlFor>. */
  id: string
  /** Banco elegido (nombre). Vacío = sin elegir. */
  value: string
  /** Se dispara con el banco elegido (o el recién creado). */
  onChange: (value: string) => void
  /** Marca el control en error (mismo criterio que los demás campos del cobro). */
  error?: boolean
  /** Texto del mensaje de error debajo del control. */
  errorMsg?: string
}

/**
 * Select de "Banco Emisor" del cobro (cheques y tarjetas): los bancos fijos más los que el usuario
 * haya agregado con "➕ Otro banco…". Toda la mecánica vive en `SelectConAlta`; acá sólo se elige
 * el catálogo y los textos.
 */
export function BancoEmisorSelect({
  id,
  value,
  onChange,
  error = false,
  errorMsg = 'Elegí el banco emisor',
}: BancoEmisorSelectProps) {
  return (
    <SelectConAlta
      id={id}
      value={value}
      onChange={onChange}
      base={BANCOS_EMISORES_BASE}
      storageKey={STORAGE_BANCOS}
      textoAlta="➕ Otro banco…"
      placeholderAlta="Nombre del banco"
      accionAlta="Agregar banco"
      error={error}
      errorMsg={errorMsg}
    />
  )
}
