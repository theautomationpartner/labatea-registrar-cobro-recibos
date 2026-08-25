/**
 * Indicador de carga de las pantallas de autenticación.
 *
 * A diferencia de `ModalCargando`, esto NO es una ventana: no hay caja, ni sombra, ni fondo que
 * oscurezca. Es la animación y su texto, sobre la aplicación.
 *
 * La distinción no es estética. Una ventana modal dice "interrumpí lo que estabas haciendo y esperá";
 * acá todavía no había nada que interrumpir —la app ni siquiera se dibujó—, así que una caja flotando
 * sobre un vacío gris sólo agrega peso visual a una espera de medio segundo.
 */
export function Cargando({ mensaje }: { mensaje: string }) {
  return (
    <div className="cargando-pantalla" role="status" aria-live="polite">
      <i className="fas fa-circle-notch spin" />
      <span>{mensaje}</span>
    </div>
  )
}
