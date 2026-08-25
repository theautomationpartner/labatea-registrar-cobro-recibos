import { useEffect, useRef, useState } from 'react'
import { getUsuarioActual, getUsuarios } from '@/services/monday'
import { Cargando } from '@/components/ui/Cargando'
import { MfaGuard } from '@/components/ui/MfaGuard'
import { ModalErrorMonday } from '@/components/ui/ModalErrorMonday'
import { ModalErrorSeguridad } from '@/components/ui/ModalErrorSeguridad'
import { useErrorSeguridad } from '@/hooks/useErrorSeguridad'
import { bloqueaLaApp, notificarErrorSeguridad } from '@/lib/errorSeguridad'
import { enMonday, getSessionToken, resumenSessionToken } from '@/lib/mondayAuth'
import { estadoSegundoFactor } from '@/services/mfa'
import { ClienteView } from '@/features/cliente/ClienteView'
import { CobroView } from '@/features/cobro/CobroView'
import { AnticiposView } from '@/features/anticipos/AnticiposView'
import { FacturasView } from '@/features/facturas/FacturasView'
import { PagosView } from '@/features/pagos/PagosView'
import { PaseAnticipoView } from '@/features/pases/PaseAnticipoView'
import { PaseDestinoView } from '@/features/pases/PaseDestinoView'
import { ReciboView } from '@/features/recibo/ReciboView'
import { useApp, useDispatch } from '@/state/hooks'
import type { Paso } from '@/types'

/**
 * Vista de cada etapa del módulo de COBROS. El estado dice en qué paso está y acá se resuelve qué
 * se dibuja. PAGOS no entra en esta tabla: es una operación independiente, con su propio ruteo.
 */
const VISTAS: Record<Paso, () => JSX.Element | null> = {
  cliente: ClienteView,
  ventas: FacturasView,
  cobro: CobroView,
  recibo: ReciboView,
  /* Etapas propias del PASE DE SALDO. Sólo aparecen en ese recorrido, así que ningún otro las
     alcanza: el stepper navega por `pasosDe(tipo)` y ahí no figuran. */
  anticipoOrigen: PaseAnticipoView,
  destino: PaseDestinoView,
}

export function App() {
  const { operacionApp, paso, tipoOperacion } = useApp()
  const dispatch = useDispatch()
  const scrollRef = useRef<HTMLDivElement>(null)
  const { error: errorSeguridad, visible: avisoVisible } = useErrorSeguridad()
  /* Tapada mientras el rechazo siga en pie, aunque se cierre el aviso: el "Entendido" baja el
     cartel, no abre la puerta. De un rechazo del borde se sale recargando, no insistiendo. */
  const bloqueada = errorSeguridad !== null && bloqueaLaApp(errorSeguridad.clase)

  /*
   * ── La secuencia de tres pasos ──
   *
   * Nada de la operación se dibuja hasta superarlos, y en este orden:
   *
   *   1. LISTA BLANCA. Se pide el `sessionToken` a Monday y se consulta `/api/usuario`, que
   *      verifica la firma y busca al usuario en el tablero privado (Capas 1 y 2).
   *   2. CACHÉ DEL USUARIO. El habilitado queda en el estado global con sus equipos de Monday, de
   *      los que sale el rol —Administrador o Vendedor, ver `lib/permisos`—. Tiene que pasar antes
   *      de dibujar: media app pregunta si puede editar tal cosa. Todavía NO se muestra nada.
   *   3. MURO DEL SEGUNDO FACTOR. Se renderiza únicamente `MfaGuard`. La app se libera sólo cuando
   *      el backend confirma el código de seis dígitos o valida el `X-Device-Token` vigente.
   *
   * El estado arranca resuelto —no en un `useEffect`— para que el primer pintado ya sepa la
   * respuesta. Con un efecto habría un cuadro con la app a la vista antes de que el rechazo
   * llegue, y ese destello es justamente lo que no puede pasar: a alguien que abrió el enlace
   * fuera de Monday no se le muestra ni por un instante lo que hay del otro lado.
   *
   * Estar fuera del iframe se sabe en el acto y sin preguntarle a nadie; lo demás —firma, lista
   * blanca y segundo factor— sólo lo puede contestar el servidor.
   */
  const [acceso, setAcceso] = useState<'verificando' | 'mfa' | 'permitido' | 'rechazado'>(() =>
    import.meta.env.DEV || enMonday() ? 'verificando' : 'rechazado',
  )

  /* Fuera del iframe no hay a quién preguntarle: el rechazo ya es la respuesta. Se avisa una sola
     vez, al montar, y no dentro del efecto de abajo: ahí se volvería a disparar cada vez que el
     acceso cambie, y el aviso terminaría dependiendo de en qué orden llegan las cosas. */
  useEffect(() => {
    if (!import.meta.env.DEV && !enMonday()) notificarErrorSeguridad('fueraDeMonday', 401)
  }, [])

  useEffect(() => {
    if (acceso !== 'verificando') return

    let vivo = true
    /* Antes de salir a la red: ¿Monday entregó una sesión? Si no, no hay nada que el servidor
       pueda verificar, y el problema es la instalación de la app y no el usuario. Distinguirlo acá
       evita mandar a pedir un alta que no va a resolver nada. */
    void (async () => {
      const sesion = await getSessionToken()
      if (!vivo) return
      if (!sesion && !import.meta.env.DEV) {
        notificarErrorSeguridad('sinSesionDeMonday', 401)
        setAcceso('rechazado')
        return
      }
      verificarConElServidor(sesion)
    })()

    function verificarConElServidor(sesion: string | null) {
      /* PASO 1 · una sola consulta contesta las dos preguntas: si el borde deja pasar y quién es
         el usuario. Ese endpoint NO exige el segundo factor, y es a propósito: es el paso 1, y
         exigir el paso 3 acá haría imposible llegar al muro. */
      getUsuarioActual()
        .then(async (usuario) => {
          if (!vivo) return
          /* PASO 2 · el usuario habilitado queda cacheado en el estado global. De sus equipos de
             Monday sale el rol (ver `lib/permisos`), así que esto tiene que pasar ANTES de dibujar
             nada: media app pregunta si puede editar tal cosa. */
          dispatch({ type: 'setUsuarioActual', usuario })

          /* PASO 3 · el segundo factor. Con un dispositivo confiable vigente no se le pregunta
             nada; si el backend no lo exige todavía, la capa está apagada y se pasa de largo. */
          const mfa = await estadoSegundoFactor().catch(() => null)
          if (!vivo) return
          /* Si el estado no se pudo leer se muestra el muro igual: ante la duda, se pregunta.
             El propio muro avisa si tampoco él puede hablar con el servidor. */
          const haceFalta = mfa === null || (mfa.exigido && !mfa.dispositivoConfiable)
          setAcceso(haceFalta ? 'mfa' : 'permitido')
        })
        .catch(() => {
          if (!vivo) return
          /* La sesión llegó y el servidor la rechazó igual. Sin acceso a los logs del servidor,
             esto es lo único que permite distinguir un secreto que no corresponde de un token con
             otra forma. No se imprime el token ni su firma: sólo su forma. */
          if (sesion) {
            /* Se imprime como TEXTO y no como objeto: en la consola un objeto sale colapsado, y
               una captura de pantalla no muestra lo que hace falta leer. */
            console.warn(
              '[seguridad] el servidor rechazó la sesión · ' +
                JSON.stringify(resumenSessionToken(sesion)),
            )
          }
          /* En desarrollo no hay borde que consultar —ni funciones serverless ni iframe—, así que
             un fallo acá no significa "no autorizado": significa que ese control no existe en
             localhost. */
          setAcceso(import.meta.env.DEV ? 'permitido' : 'rechazado')
        })
    }

    return () => {
      vivo = false
    }
  }, [acceso, dispatch])

  /* Ruteo en DOS niveles, y en este orden:

       1. el MÓDULO. Cobros y Pagos son operaciones independientes —etapas propias, pantallas
          propias—, así que lo primero que se decide es cuál se está operando. Pagos todavía no
          tiene circuito definido y por eso resuelve en una sola vista.
       2. dentro de Cobros, la ETAPA. El paso 3 tiene DOS vistas según lo que se registre: con
          dinero (formas de pago) o aplicando el saldo a favor del cliente. Es la única etapa que
          cambia de pantalla según la operación; el resto del recorrido es el mismo. */
  const Vista =
    operacionApp === 'PAGOS'
      ? PagosView
      : /* El paso 3 tiene DOS vistas según el recorrido: con dinero (formas de pago) o aplicando el
           saldo a favor del cliente. Es la única etapa que cambia de pantalla; el resto del
           recorrido comparte las mismas. */
        paso === 'cobro' && tipoOperacion === 'aplicacion'
        ? AnticiposView
        : VISTAS[paso]

  /* Cada paso arranca desde arriba, como en una navegación real. Cambiar de MÓDULO también: es la
     navegación más grande que hace la app, así que con más razón no puede aterrizar a media
     pantalla. */
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [paso, operacionApp])

  /* Datos de sesión: se leen UNA sola vez, con el acceso YA confirmado. No dependen del cliente ni
     del cobro, así que no hay motivo para volver a pedirlos al avanzar de paso.

     `vivo` corta el dispatch si el componente se desmontó antes de que respondiera la API (y evita
     el doble efecto del StrictMode en desarrollo). */
  useEffect(() => {
    /* Nada de esto sale a la red antes de saber si el pedido tiene derecho a estar acá: con el
       muro en pantalla los pedidos darían 403 y llenarían la consola de rechazos que no significan
       nada. El usuario de la sesión ya lo trajo el paso 1; acá falta sólo la lista del selector. */
    if (acceso !== 'permitido') return
    let vivo = true

    /* Usuarios de los equipos "Vendedores" y "Administradores": pueblan el selector del encabezado.
       Ante un error se deja la lista vacía —el selector deja de estar "Cargando…"— y se avisa por
       el modal: sin usuarios no hay a nombre de quién registrar el cobro, así que el problema no
       puede quedar mudo. */
    getUsuarios()
      .then((us) => vivo && dispatch({ type: 'setUsuarios', usuarios: us }))
      .catch(() => {
        if (!vivo) return
        dispatch({ type: 'setUsuarios', usuarios: [] })
        dispatch({ type: 'errorMonday', accion: 'obtener los usuarios de Monday' })
      })

    return () => {
      vivo = false
    }
  }, [acceso, dispatch])

  return (
    <div className="scroll" ref={scrollRef}>
      {/* La operación se dibuja SÓLO con los tres pasos superados. Ver el estado `acceso` y
          `bloqueaLaApp`. */}
      {acceso === 'permitido' && !bloqueada && <Vista />}
      {acceso === 'verificando' && <Cargando mensaje="Verificando acceso" />}
      {/* PASO 3 · hasta que el backend confirme el código y emita el token del dispositivo, esto
          es lo único que se dibuja. */}
      {acceso === 'mfa' && <MfaGuard onListo={() => setAcceso('permitido')} />}
      {/* Un solo aviso a la vez, y el de seguridad manda: el otro invita a reintentar, y un
          rechazo del borde no se arregla reintentando. */}
      {errorSeguridad && avisoVisible ? (
        <ModalErrorSeguridad error={errorSeguridad} />
      ) : (
        <ModalErrorMonday />
      )}
    </div>
  )
}
