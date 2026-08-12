import { useCallback, useRef, useState, type ReactNode } from 'react'
import { useClickOutside } from '@/hooks/useClickOutside'

interface DropdownProps<T> {
  /** Contenido del botón cerrado. */
  label: ReactNode
  items: readonly T[]
  itemKey: (item: T) => string
  renderItem: (item: T) => ReactNode
  onSelect: (item: T) => void
  /** Clase extra para cada opción (p. ej. `dditem--strong`). */
  itemClassName?: string
  /** Deshabilita el control: no abre el menú (p. ej. mientras se cargan sus opciones). */
  disabled?: boolean
  /**
   * Opción que se VE pero no se puede elegir (p. ej. un módulo reservado a administradores). Se
   * muestra apagada en vez de esconderse: que exista es parte de lo que el usuario tiene que saber,
   * y el motivo aparece al pasarle el mouse (`itemTitle`).
   */
  itemDisabled?: (item: T) => boolean
  /** Por qué esa opción no se puede elegir. Se muestra como tooltip. */
  itemTitle?: (item: T) => string | undefined
}

/** Selector con menú desplegable. Lo usa el selector de usuario del encabezado. */
export function Dropdown<T>({
  label,
  items,
  itemKey,
  renderItem,
  onSelect,
  itemClassName = '',
  disabled = false,
  itemDisabled,
  itemTitle,
}: DropdownProps<T>) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useClickOutside(ref, close, open)

  return (
    <div className="dd dd--bare selbox--fix" ref={ref}>
      <button
        type="button"
        className="selbox selbox--fix selbox--btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        <i className="fas fa-chevron-down" />
      </button>

      {open && !disabled && (
        <div className="ddmenu" role="listbox">
          {items.map((item) => {
            const vedada = itemDisabled?.(item) ?? false
            return (
              <div
                key={itemKey(item)}
                role="option"
                aria-selected={false}
                aria-disabled={vedada || undefined}
                title={vedada ? itemTitle?.(item) : undefined}
                className={`dditem ${itemClassName} ${vedada ? 'dditem--vedada' : ''}`}
                onClick={() => {
                  if (vedada) return
                  onSelect(item)
                  setOpen(false)
                }}
              >
                {renderItem(item)}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
