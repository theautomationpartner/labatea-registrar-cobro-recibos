interface AvatarProps {
  ini: string
  color: string
  /** `vava` (32px) para selectores, `mini-ava` (20px) para líneas de resumen. */
  size?: 'md' | 'sm'
}

export function Avatar({ ini, color, size = 'md' }: AvatarProps) {
  return (
    <div className={size === 'md' ? 'vava' : 'mini-ava'} style={{ background: color }}>
      {ini}
    </div>
  )
}
