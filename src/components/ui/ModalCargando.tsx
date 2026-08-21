interface ModalCargandoProps {
  titulo: string
  detalle: string
}

/**
 * Tapa la pantalla mientras se escribe en Monday. Se usa en las secuencias que no conviene
 * interrumpir ni disparar dos veces —registrar un pase de saldo, por ejemplo—, y el texto dice en
 * qué paso va.
 *
 * Es BLOQUEANTE a propósito y no se cierra con un click: la escritura ya salió, así que ofrecer una
 * salida sólo dejaría al usuario operando sobre una pantalla cuyo resultado todavía no llegó.
 *
 * Vive en `components/ui` y sus estilos son globales, sin namespace de vista: así funciona igual en
 * cualquier paso. Es el mismo componente que usa la app de operaciones de venta.
 */
export function ModalCargando({ titulo, detalle }: ModalCargandoProps) {
  return (
    <div className="modal-cargando" role="status" aria-live="polite">
      <div className="modal-cargando-box">
        <i className="fas fa-circle-notch fa-spin" />
        <strong>{titulo}</strong>
        <span>{detalle}</span>
      </div>
    </div>
  )
}
