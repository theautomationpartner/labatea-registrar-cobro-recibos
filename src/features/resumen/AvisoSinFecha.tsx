/**
 * Movimientos de la cuenta que quedaron FUERA del resumen por no tener su "🤖Fecha Emision" cargada.
 * No hay forma de saber en qué período caen, así que no se incluyen; lo que no puede pasar es que
 * falten sin que nadie se entere. Sin ninguno en esa situación, no se dibuja.
 */
export function AvisoSinFecha({ cantidad }: { cantidad: number }) {
  if (cantidad <= 0) return null
  return (
    <p className="res-sin-fecha" role="note">
      <i className="fas fa-triangle-exclamation" />
      <span>
        {cantidad === 1
          ? '1 movimiento de la cuenta no tiene fecha de emisión cargada'
          : `${cantidad} movimientos de la cuenta no tienen fecha de emisión cargada`}{' '}
        en Monday, así que no se incluye{cantidad === 1 ? '' : 'n'} en ningún período.
      </span>
    </p>
  )
}
