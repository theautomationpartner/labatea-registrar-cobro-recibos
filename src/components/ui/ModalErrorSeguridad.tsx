import { Modal } from './Modal'
import { cerrarAvisoSeguridad, type ErrorSeguridad } from '@/lib/errorSeguridad'

/**
 * ÚNICA forma en que la app comunica que el borde rechazó el pedido.
 *
 * Es distinta de `ModalErrorMonday` a propósito. Ese avisa que Monday no contestó: se espera y se
 * reintenta. Esto no se arregla reintentando —el dominio no está autorizado, el usuario no está
 * habilitado, falta el segundo factor— y decir "probá de nuevo" mandaría a la persona a golpear una
 * puerta que no se va a abrir.
 *
 * Por eso cada caso ofrece SÓLO lo que sirve. El rechazo por dominio no lleva "Recargar": recargar
 * desde afuera de Monday da exactamente el mismo rechazo, y ese botón sería una invitación a
 * insistir con algo que no depende de quien lo aprieta.
 */
export function ModalErrorSeguridad({ error }: { error: ErrorSeguridad }) {
  const { titulo, cuerpo, recargar, mostrarCodigo } = TEXTOS[error.clase]

  return (
    <Modal
      title={titulo}
      icon={<i className="fas fa-shield-halved modal-icon--warn" />}
      onClose={cerrarAvisoSeguridad}
      actions={
        <>
          {recargar && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => window.location.reload()}
            >
              Recargar
            </button>
          )}
          <button
            type="button"
            className={recargar ? 'btn btn-secundario' : 'btn btn-primary'}
            onClick={cerrarAvisoSeguridad}
          >
            Entendido
          </button>
        </>
      }
    >
      {cuerpo}
      {mostrarCodigo && (
        <p className="modal-detalle">
          Código {error.status}. Si tenés que reportarlo, mencioná este número.
        </p>
      )}
    </Modal>
  )
}

const TEXTOS: Record<
  ErrorSeguridad['clase'],
  { titulo: string; cuerpo: JSX.Element; recargar: boolean; mostrarCodigo: boolean }
> = {
  /* Alguien consiguió el enlace y lo abre fuera de Monday. Lo sabe el propio navegador, sin
     preguntarle a nadie: el código va en el título y el mensaje es una sola línea. No hay nada que
     explicar ni ninguna acción que ofrecer. */
  fueraDeMonday: {
    titulo: 'ERROR 401 NO Autorizado',
    recargar: false,
    mostrarCodigo: false,
    cuerpo: <p>Su dominio no está autorizado a utilizar la aplicación.</p>,
  },

  /* Estamos dentro de Monday pero el contenedor no entregó ninguna sesión. No es que la sesión no
     valga: no llegó ninguna. Casi siempre es la instalación de la app en la cuenta, así que lo
     único útil para quien lo ve es saber a quién avisarle. */
  sinSesionDeMonday: {
    titulo: 'No se pudo obtener tu sesión de Monday',
    recargar: true,
    mostrarCodigo: false,
    cuerpo: (
      <>
        <p>
          Monday <strong>no entregó una sesión</strong> para esta app. Tu usuario y tus permisos no
          tienen nada que ver.
        </p>
        <p>
          Probá recargar. Si sigue igual, comunicate con el soporte de TAP: hay que revisar cómo
          está instalada la app en la cuenta.
        </p>
      </>
    ),
  },

  /* Está DENTRO de Monday, pero el servidor no pudo verificar la credencial. Es distinto del
     anterior y decirle "su dominio no está autorizado" sería falso: el dominio está bien, lo que
     falló es la sesión. */
  sesion: {
    titulo: 'ERROR 401 · No se pudo validar tu sesión',
    recargar: true,
    mostrarCodigo: true,
    cuerpo: (
      <>
        <p>El servidor no pudo verificar la sesión de Monday.com cargada.</p>
        <p>
          Recargá para que Monday emita una sesión nueva. Si el error persiste, comunicate con el
          <strong> soporte de TAP</strong> para buscar una solución.
        </p>
      </>
    ),
  },

  /* Al servidor le falta una variable de entorno. No es culpa de quien está usando la app y no lo
     puede arreglar; lo único útil es que sepa a quién avisarle. */
  configuracion: {
    titulo: 'El servicio no está configurado',
    recargar: false,
    mostrarCodigo: true,
    cuerpo: (
      <>
        <p>
          Falta configuración <strong>del lado del servidor</strong>. No es un problema de tu
          usuario ni de tu sesión, y no se arregla reintentando.
        </p>
        <p>Avisale al soporte de TAP con el código de abajo.</p>
      </>
    ),
  },

  /* El 403 ya dice todo lo que hay que saber: el usuario no está dado de alta y la salida es
     avisarle al soporte. El código NO se repite abajo —está en el título— y agregar "mencioná este
     número" invitaría a reportar algo que no es un incidente a diagnosticar, sino un alta pendiente. */
  sinPermiso: {
    titulo: 'ERROR 403 · Usuario sin permisos',
    recargar: false,
    mostrarCodigo: false,
    cuerpo: (
      <>
        <p>
          Tu usuario de Monday <strong>no tiene permisos para utilizar la aplicación</strong>.
        </p>
        <p>Comunicate con el soporte de TAP para que den de alta tu usuario.</p>
      </>
    ),
  },
  segundoFactor: {
    titulo: 'Falta verificar el segundo factor',
    recargar: true,
    mostrarCodigo: true,
    cuerpo: (
      <>
        <p>
          Para seguir hace falta <strong>verificar el código de tu app de autenticación</strong>. O
          nunca lo configuraste, o la confianza de este dispositivo venció.
        </p>
        <p>Recargá la app para hacer la verificación.</p>
      </>
    ),
  },
  demasiadosIntentos: {
    titulo: 'Demasiados intentos',
    recargar: false,
    mostrarCodigo: true,
    cuerpo: (
      <p>
        Se superó el límite de intentos fallidos. Por seguridad, la verificación queda bloqueada{' '}
        <strong>durante 15 minutos</strong>. Esperá y volvé a probar: insistir ahora no cambia nada.
      </p>
    ),
  },
  servidor: {
    titulo: 'El servicio no está respondiendo',
    recargar: true,
    mostrarCodigo: true,
    cuerpo: (
      <>
        <p>
          El servidor de la app <strong>falló al procesar el pedido</strong>. No es un problema de
          tus datos ni de tu conexión.
        </p>
        <p>
          Suele ser una configuración faltante del lado del servidor. Reportalo a soporte de TAP:
          hasta que se corrija, la app no va a poder leer ni escribir en Monday.
        </p>
      </>
    ),
  },
}
