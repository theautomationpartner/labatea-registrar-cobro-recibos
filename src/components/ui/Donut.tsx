interface DonutProps {
  /** Porción coloreada del anillo, 0-100. */
  percent: number
  color: string
  /** Texto debajo del porcentaje, dentro del anillo. */
  label?: string
  /** Tamaño del anillo: `sm` para la celda de la tabla, `md` para el panel de pago. */
  size?: 'sm' | 'md'
}

/** Anillo de progreso resuelto con `conic-gradient` (sin librería de charts). */
export function Donut({ percent, color, label, size = 'md' }: DonutProps) {
  // El gradiente no clampea solo: un porcentaje fuera de rango dibujaría un anillo incoherente.
  const p = Math.min(Math.max(Number.isFinite(percent) ? percent : 0, 0), 100)
  return (
    <div
      className={`donut donut--${size}`}
      style={{ background: `conic-gradient(${color} ${p}%, var(--donut-track) 0)` }}
      role="img"
      aria-label={`${label ?? 'Cancelado'}: ${p}%`}
    >
      <div className="donut-in">
        <span className="donut-v" style={{ color }}>
          {p}%
        </span>
        {label && <span className="donut-l">{label}</span>}
      </div>
    </div>
  )
}
