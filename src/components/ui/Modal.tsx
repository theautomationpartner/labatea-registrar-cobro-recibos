import type { ReactNode } from 'react'

interface ModalProps {
  title: string
  icon?: ReactNode
  children: ReactNode
  actions?: ReactNode
  onClose: () => void
}

/** Ventana emergente centrada, con fondo oscurecido. Se cierra con la X o clickeando afuera. */
export function Modal({ title, icon, children, actions, onClose }: ModalProps) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" aria-label="Cerrar" onClick={onClose}>
          <i className="fas fa-times" />
        </button>
        {icon && <div className="modal-icon">{icon}</div>}
        <h3 className="modal-title">{title}</h3>
        <div className="modal-body">{children}</div>
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  )
}
