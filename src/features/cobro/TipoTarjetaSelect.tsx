import { SelectConAlta } from './SelectConAlta'
import { STORAGE_TIPOS_TARJETA, TIPOS_TARJETA_BASE } from './useOpcionesRecordadas'

interface TipoTarjetaSelectProps {
  /** id del control, para enganchar el <label htmlFor>. */
  id: string
  /** Tipo elegido (VISA, MASTERCARD o uno cargado a mano). Vacío = sin elegir. */
  value: string
  /** Se dispara con el tipo elegido (o el recién creado). */
  onChange: (value: string) => void
  /** Marca el control en error (mismo criterio que los demás campos del cobro). */
  error?: boolean
  /** Texto del mensaje de error debajo del control. */
  errorMsg?: string
}

/**
 * Select de "Tipo Tarjeta" del cobro: VISA y MASTERCARD —los dos que el board trae cargados— más
 * los que el usuario agregue con "➕ Otro tipo…" (AMEX, Cabal, Naranja…), que quedan recordados
 * para los próximos cobros.
 *
 * El tipo cargado a mano llega al board sin trabajo extra: el subelemento del recibo se crea con
 * `create_labels_if_missing`, así que la etiqueta nueva se da de alta sola en "🤖Tipo Tarjeta".
 */
export function TipoTarjetaSelect({
  id,
  value,
  onChange,
  error = false,
  errorMsg = 'Elegí el tipo de tarjeta',
}: TipoTarjetaSelectProps) {
  return (
    <SelectConAlta
      id={id}
      value={value}
      onChange={onChange}
      base={TIPOS_TARJETA_BASE}
      storageKey={STORAGE_TIPOS_TARJETA}
      textoAlta="➕ Otro tipo…"
      placeholderAlta="Tipo de tarjeta"
      accionAlta="Agregar tipo de tarjeta"
      error={error}
      errorMsg={errorMsg}
    />
  )
}
