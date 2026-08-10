import { useState } from 'react'
import { useOpcionesRecordadas } from './useOpcionesRecordadas'

/** Valor centinela de la opción que abre el alta de una opción nueva. */
const OPCION_NUEVO = '__nuevo__'

interface SelectConAltaProps {
  /** id del control, para enganchar el <label htmlFor>. */
  id: string
  /** Opción elegida. Vacío = sin elegir. */
  value: string
  /** Se dispara con la opción elegida (o la recién creada). */
  onChange: (value: string) => void
  /** Opciones fijas del catálogo. */
  base: readonly string[]
  /** Clave de localStorage donde se recuerdan las opciones que agregó el usuario. */
  storageKey: string
  /** Texto de la última opción del select, la que abre el alta ("➕ Otro banco…"). */
  textoAlta: string
  /** Placeholder del input de alta ("Nombre del banco"). */
  placeholderAlta: string
  /** Rótulo accesible del botón que confirma el alta ("Agregar banco"). */
  accionAlta: string
  /** Marca el control en error (mismo criterio que los demás campos del cobro). */
  error?: boolean
  /** Texto del mensaje de error debajo del control. */
  errorMsg?: string
}

/**
 * Select de catálogo AMPLIABLE del cobro: ofrece las opciones fijas más las que el usuario haya
 * agregado —recordadas en localStorage vía `useOpcionesRecordadas`—. La última opción del
 * desplegable cambia el control por un input para cargar una nueva: al confirmarla queda
 * seleccionada y disponible para los próximos cobros.
 *
 * Un valor ya elegido que no esté en la lista (cargado en una sesión previa, o borrado del
 * storage) se agrega como opción para no perderlo.
 *
 * Lo usan "Banco Emisor" y "Tipo Tarjeta": misma mecánica, distinto catálogo.
 */
export function SelectConAlta({
  id,
  value,
  onChange,
  base,
  storageKey,
  textoAlta,
  placeholderAlta,
  accionAlta,
  error = false,
  errorMsg,
}: SelectConAltaProps) {
  const { opciones: guardadas, agregar } = useOpcionesRecordadas(storageKey, base)
  const [agregando, setAgregando] = useState(false)
  const [nuevo, setNuevo] = useState('')

  const opciones = value && !guardadas.includes(value) ? [...guardadas, value] : guardadas

  const confirmarNuevo = () => {
    const limpio = nuevo.trim()
    if (!limpio) return
    agregar(limpio)
    onChange(limpio)
    setNuevo('')
    setAgregando(false)
  }

  const cancelarNuevo = () => {
    setNuevo('')
    setAgregando(false)
  }

  if (agregando) {
    return (
      <div className="opcion-nueva">
        <input
          id={id}
          className="cobro-in"
          placeholder={placeholderAlta}
          autoFocus
          value={nuevo}
          onChange={(e) => setNuevo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              confirmarNuevo()
            }
            if (e.key === 'Escape') cancelarNuevo()
          }}
        />
        <button
          type="button"
          className="opcion-nueva-btn"
          title={accionAlta}
          aria-label={accionAlta}
          disabled={!nuevo.trim()}
          onClick={confirmarNuevo}
        >
          <i className="fas fa-check" />
        </button>
        <button
          type="button"
          className="opcion-nueva-btn opcion-nueva-btn--ghost"
          title="Cancelar"
          aria-label="Cancelar"
          onClick={cancelarNuevo}
        >
          <i className="fas fa-xmark" />
        </button>
      </div>
    )
  }

  return (
    <>
      <select
        id={id}
        className={`cobro-in ${error ? 'cobro-in--error' : ''}`}
        aria-invalid={error || undefined}
        value={value}
        onChange={(e) => {
          if (e.target.value === OPCION_NUEVO) {
            setAgregando(true)
            return
          }
          onChange(e.target.value)
        }}
      >
        <option value="" disabled>
          Seleccionar…
        </option>
        {opciones.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        <option value={OPCION_NUEVO}>{textoAlta}</option>
      </select>
      {error && errorMsg && (
        <span className="cobro-in-err" role="alert">
          {errorMsg}
        </span>
      )}
    </>
  )
}
