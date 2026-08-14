import type { FormaPago } from '@/types'
import { SelectConAlta } from './SelectConAlta'
import {
  STORAGE_TIPOS_TARJETA_CREDITO,
  STORAGE_TIPOS_TARJETA_DEBITO,
  TIPOS_TARJETA_CREDITO,
  TIPOS_TARJETA_DEBITO,
} from './useOpcionesRecordadas'

interface TipoTarjetaSelectProps {
  /** id del control, para enganchar el <label htmlFor>. */
  id: string
  /**
   * Medio de cobro que se está cargando. Decide QUÉ tipos se ofrecen: los de débito o los de
   * crédito. Es el medio y no un booleano para que la relación se lea en el llamador.
   */
  formaPago: FormaPago
  /** Tipo elegido ("Visa-Debito", "Master-Credito" o uno cargado a mano). Vacío = sin elegir. */
  value: string
  /** Se dispara con el tipo elegido (o el recién creado). */
  onChange: (value: string) => void
  /** Marca el control en error (mismo criterio que los demás campos del cobro). */
  error?: boolean
  /** Texto del mensaje de error debajo del control. */
  errorMsg?: string
}

/**
 * Select de "Tipo Tarjeta" del cobro. Las opciones dependen del MEDIO: con débito ofrece
 * "Visa-Debito" y "Master-Debito"; con crédito, "Visa-Credito" y "Master-Credito". Son los cuatro
 * valores que el board tiene cargados en "🤖Tipo Tarjeta", y el elegido se escribe tal cual.
 *
 * Cada medio tiene su propio catálogo y su propia memoria: un tipo agregado con "➕ Otro tipo…"
 * (AMEX, Cabal, Naranja…) queda recordado sólo para el medio en el que se lo cargó, porque un tipo
 * de débito no es una opción válida cobrando con crédito. El agregado a mano llega al board sin
 * trabajo extra: el subelemento se crea con `create_labels_if_missing`, así que la etiqueta nueva
 * se da de alta sola.
 */
export function TipoTarjetaSelect({
  id,
  formaPago,
  value,
  onChange,
  error = false,
  errorMsg = 'Elegí el tipo de tarjeta',
}: TipoTarjetaSelectProps) {
  const esCredito = formaPago === 'Tarjeta de crédito'

  return (
    <SelectConAlta
      id={id}
      value={value}
      onChange={onChange}
      base={esCredito ? TIPOS_TARJETA_CREDITO : TIPOS_TARJETA_DEBITO}
      storageKey={esCredito ? STORAGE_TIPOS_TARJETA_CREDITO : STORAGE_TIPOS_TARJETA_DEBITO}
      textoAlta="➕ Otro tipo…"
      placeholderAlta="Tipo de tarjeta"
      accionAlta="Agregar tipo de tarjeta"
      error={error}
      errorMsg={errorMsg}
    />
  )
}
