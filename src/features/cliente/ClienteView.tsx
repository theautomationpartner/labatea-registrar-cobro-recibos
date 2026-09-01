import { useEffect, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { AvisoCategoriaAjena } from '@/features/shared/AvisoCategoriaAjena'
import { CuentasPaseConfig, MSG_SIN_CUENTAS_DE } from '@/features/pases/CuentasPaseConfig'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { clienteBloqueado, MENSAJE_CLIENTE_BLOQUEADO } from '@/lib/credito'
import {
  descripcionDePaso,
  etiquetaDePaso,
  numeroDePaso,
  siguientePaso,
} from '@/lib/pasos'
import { buscarProveedores, getSaldosCliente } from '@/services/monday'
import { esContado, msgContadoOrigen } from '@/lib/pases'
import { cumpleRol, rolDeOperacion, ROTULO_OPERACION, ROTULO_ROL } from '@/lib/personas'
import { faltantesCliente } from '@/lib/validaciones'
import { useApp, useDispatch } from '@/state/hooks'
import type { Cliente } from '@/types'
import { BuscarCliente, type BusquedaEstado } from './BuscarCliente'
import { ClienteFicha } from './ClienteFicha'
import { OperacionConfig } from './OperacionConfig'

/**
 * Paso 1: qué se va a cobrar y a quién.
 *
 * En COBROS son DOS decisiones: el tipo de operación define el recorrido (un cobro contra facturas
 * pasa por las ventas pendientes; un anticipo no) y el cliente define sobre quién se opera. Ninguna
 * viene preseleccionada, y sin las dos no se avanza.
 *
 * En PASES DE SALDO el recorrido ya lo fijó el módulo, así que lo que se pregunta es otra cosa: DE
 * QUIÉNES son las dos cuentas del pase —de clientes o de proveedores (`CuentasPaseConfig`)— y quién
 * es la persona ORIGEN, de cuyo anticipo sale el saldo que se va a mover. Las dos decisiones van en
 * ese orden y no al revés: en el board de Personas los dos lados del mostrador son la misma clase de
 * ítem y sólo los distingue su "✋Categoria", así que hasta que no se declara el lado la búsqueda no
 * sabe contra qué categoría consultar ni contra qué validar a quien traiga.
 */
export function ClienteView() {
  const { cliente, operacionApp, paseCuentasDe, tipoOperacion, saldos, saldosClienteId } =
    useApp()
  const dispatch = useDispatch()
  // Estado de la búsqueda: gobierna qué se muestra en el lugar de la ficha del cliente.
  const [estadoBusqueda, setEstadoBusqueda] = useState<BusquedaEstado>('idle')
  // Aviso emergente al intentar operar con un cliente bloqueado.
  const [avisoBloqueado, setAvisoBloqueado] = useState(false)
  // Aviso emergente cuando al cliente le faltan datos en el board.
  const [avisoDatos, setAvisoDatos] = useState(false)
  // Aviso emergente al intentar avanzar sin un cliente cargado.
  const [avisoSinCliente, setAvisoSinCliente] = useState(false)
  // Aviso emergente al intentar avanzar sin haber elegido qué se registra.
  const [avisoSinOperacion, setAvisoSinOperacion] = useState(false)
  // Aviso emergente del PASE, al operar sin haber declarado de quiénes son las cuentas.
  const [avisoSinCuentasDe, setAvisoSinCuentasDe] = useState(false)
  // Aviso emergente al intentar pasar el saldo de un cliente que opera al contado.
  const [avisoContado, setAvisoContado] = useState(false)
  // Ventana emergente cuando la búsqueda no encuentra al cliente: es el ÚNICO aviso de ese caso.
  const [avisoNoEncontrado, setAvisoNoEncontrado] = useState(false)
  /**
   * La persona que la búsqueda trajo y NO se pudo cargar porque no es un cliente. Mientras esto
   * tenga valor hay una ventana abierta explicando por qué, y es lo único que se ve de ella: su
   * ficha no llega a dibujarse.
   */
  const [personaAjena, setPersonaAjena] = useState<Cliente | null>(null)

  // Cada vez que la búsqueda termina en "no encontrado", se abre la ventana emergente.
  useEffect(() => {
    if (estadoBusqueda === 'no-encontrado') setAvisoNoEncontrado(true)
  }, [estadoBusqueda])

  /* Saldos de la cuenta corriente del cliente. Van en su PROPIA consulta —salen de otro tablero, y
     sumando los subelementos de la cuenta— y por eso llegan después que la ficha: sus dos cajas se
     completan solas cuando resuelve, sin frenar al resto de la pantalla.

     Se leen UNA vez por cliente (`saldosClienteId`), con el mismo criterio de caché que las
     facturas y los anticipos: volver al paso 1 desde el stepper no vuelve a consultar. */
  useEffect(() => {
    if (!cliente || saldosClienteId === cliente.id) return
    let vivo = true
    getSaldosCliente(cliente.id)
      .then((s) => vivo && dispatch({ type: 'setSaldos', saldos: s, clienteId: cliente.id }))
      .catch(() => {
        if (!vivo) return
        /* El fallo lo comunica la ventana global. Sin clave de caché (`null`): un error NO se
           cachea, así el próximo intento vuelve a leer en vez de dejar las cajas cargando para
           siempre. */
        dispatch({ type: 'setSaldos', saldos: null, clienteId: null })
        dispatch({ type: 'errorMonday', accion: 'obtener los saldos del cliente' })
      })
    return () => {
      vivo = false
    }
  }, [cliente, saldosClienteId, dispatch])

  /**
   * El rol que ESTA pantalla exige. En COBROS es siempre un cliente —a un proveedor no se le cobra—;
   * en el PASE DE SALDO es el que el usuario declaró arriba, y mientras no lo haya declarado es
   * `null`: sin saber de qué lado del mostrador se opera no hay contra qué validar nada (ver
   * `rolDeOperacion`).
   */
  const rol = rolDeOperacion(operacionApp, paseCuentasDe)
  /* Cómo se lo nombra en pantalla. Sin rol elegido se usa el del cliente: es el texto que ya estaba,
     y con él sólo se rotula un buscador que todavía no puede cargar a nadie. */
  const rotulo = ROTULO_ROL[rol ?? 'cliente']
  const buscaProveedores = rol === 'proveedor'

  /**
   * Qué pasa cuando la búsqueda devuelve a alguien.
   *
   * COBROS opera siempre sobre CLIENTES: mueve la cuenta corriente de un cliente, y a un proveedor
   * no se le cobra. El PASE DE SALDO opera sobre el lado que el usuario declaró, y exige ESE: si
   * dijo "De Proveedores", un cliente no entra —y al revés—, que es justamente lo que hace que las
   * dos puntas del pase terminen siendo cuentas del mismo lado del mostrador.
   *
   * La regla se aplica al SELECCIONAR y no al avanzar, por el mismo motivo que en Pagos: a quien no
   * sirve para la operación no se le llega a mostrar ni un dato.
   *
   * Alcanza con que la persona TENGA la categoría que se exige: quien es "Clientes, Proveedores"
   * entra por los dos lados, porque el tablero afirma las dos cosas (ver `cumpleRol`).
   *
   * La consulta ya filtra por categoría en el servidor; esto es la segunda barrera, la que además
   * puede explicarse en pantalla.
   */
  const elegir = (persona: Cliente) => {
    /* Sin lado del mostrador declarado no se carga a nadie: dejarlo pasar sería elegir por el
       usuario contra qué categoría se lo iba a validar. */
    if (!rol) {
      setAvisoSinCuentasDe(true)
      return
    }
    if (!cumpleRol(persona, rol)) {
      setPersonaAjena(persona)
      return
    }
    dispatch({ type: 'setCliente', cliente: persona })
  }

  const bloqueado = clienteBloqueado(cliente)
  // Sin condición fiscal ni condición de pago no se puede emitir el recibo ni saber qué se cobra.
  const faltantes = cliente ? faltantesCliente(cliente) : []
  /* El cliente está confirmado: hay uno cargado y la búsqueda no está en curso ni terminó mal. */
  const clienteListo = estadoBusqueda === 'idle' && !!cliente

  /* La etapa que sigue en el recorrido ELEGIDO: en un cobro son las ventas pendientes y en un
     anticipo el registro del anticipo. Mientras no se eligió qué registrar se anticipa la del
     cobro, que es el recorrido completo. */
  /* Un cliente de CONTADO no tiene cuenta corriente de la que debitar: el pase se frena acá, antes
     de hacerle elegir un anticipo que no va a poder mover. */
  const origenContado = operacionApp === 'PASES' && clienteListo && esContado(cliente?.condicionPago)

  const destino = siguientePaso('cliente', tipoOperacion)
  const SIGUIENTE_PASO = destino ? etiquetaDePaso(destino, tipoOperacion) : ''

  const continuar = () => {
    /* Sin saber QUÉ se cobra no hay recorrido posible: es lo primero que se reclama. */
    if (!tipoOperacion) {
      setAvisoSinOperacion(true)
      return
    }
    /* Y en un pase, sin saber de QUIÉNES son las cuentas: es el equivalente exacto de lo anterior en
       este recorrido, así que se reclama en el mismo lugar y antes que todo lo demás. */
    if (operacionApp === 'PASES' && !paseCuentasDe) {
      setAvisoSinCuentasDe(true)
      return
    }
    /* Sin un cliente confirmado el botón sigue a la vista: se avisa que hace falta cargarlo. */
    if (!clienteListo) {
      setAvisoSinCliente(true)
      return
    }
    /* Con el cliente bloqueado el botón sigue activo a propósito: la ventana explica por qué no se
       puede seguir, en vez de dejar un botón muerto sin motivo. */
    if (bloqueado) {
      setAvisoBloqueado(true)
      return
    }
    if (faltantes.length > 0) {
      setAvisoDatos(true)
      return
    }
    /* Un cliente de contado no puede ser el origen de un pase. */
    if (origenContado) {
      setAvisoContado(true)
      return
    }
    /* Los tres recorridos tienen etapa siguiente desde acá, así que `destino` nunca es null a esta
       altura; el guard existe para que el tipo lo refleje sin recurrir a un `!`. */
    if (destino) dispatch({ type: 'goto', paso: destino })
  }

  /* Por qué todavía no se puede avanzar. Se muestra en el footer, al lado del botón. */
  const motivoBloqueo = !tipoOperacion
    ? 'Indicá qué vas a cobrar para continuar'
    : operacionApp === 'PASES' && !paseCuentasDe
      ? 'Indicá de quiénes son las cuentas para continuar'
      : origenContado
        ? `El ${rotulo.singular} opera al contado: no se le puede pasar saldo`
        : !clienteListo
          ? `Buscá y confirmá un ${rotulo.singular} para continuar`
          : bloqueado
            ? `${rotulo.titulo} bloqueado: no se puede operar`
            : faltantes.length > 0
              ? `Al ${rotulo.singular} le faltan datos en el sistema`
              : undefined

  return (
    <section className="view cliente-v2 paso-layout">
      {/* ZONA 1 · contexto de la operación y navegación, siempre a la vista. */}
      <PasoHeader />

      {/* ZONA 2 · el trabajo del paso: qué se registra y con qué cliente. */}
      <div className="paso-body">
        <PasoTitulo
          numero={numeroDePaso('cliente', tipoOperacion)}
          titulo={etiquetaDePaso('cliente', tipoOperacion)}
          descripcion={descripcionDePaso('cliente', tipoOperacion)}
        />

        {/* Qué se va a cobrar. Define el recorrido, así que va ANTES del buscador. SÓLO en Cobros:
            el PASE DE SALDO tiene un recorrido único —lo fija el propio módulo—, así que ahí no hay
            nada que preguntar sobre qué se registra. Lo que ese módulo sí pregunta —de quiénes son
            las cuentas— es la caja de abajo. */}
        {operacionApp === 'COBROS' && <OperacionConfig />}

        {/* De quiénes son las cuentas del PASE. Es la misma clase de decisión que la de arriba —lo
            primero que se define, y lo que gobierna todo lo que sigue—, así que ocupa su mismo
            lugar: entre el título de la etapa y el buscador. */}
        {operacionApp === 'PASES' && <CuentasPaseConfig />}

        {/* Buscador de la persona. El vendedor de la operación ya se ve —y se cambia— en el
            selector del encabezado, así que no se repite acá.

            Contra QUÉ categoría se busca lo decide el rol: en un pase entre proveedores es el mismo
            buscador apuntado a la otra categoría del board de Personas, exactamente como lo hace la
            etapa 1 de Pagos (ver `services/monday/proveedores`). Con el rol todavía sin declarar se
            consulta el catálogo de clientes, pero nadie se puede cargar igual: `elegir` lo frena y
            reclama la decisión que falta. */}
        <div className="toolbar-wrapper">
          <div className="card unified-toolbar">
            <BuscarCliente
              estado={estadoBusqueda}
              onEstado={setEstadoBusqueda}
              onElegir={elegir}
              rol={rol ?? 'cliente'}
              {...(buscaProveedores
                ? {
                    buscarPersonas: buscarProveedores,
                    placeholder: 'Buscar proveedor por código, nombre o CUIT...',
                    mensajeVacio: 'Ingresá un nombre, código de proveedor o CUIT.',
                    sujeto: 'el proveedor',
                  }
                : {})}
            />
          </div>
        </div>

        {/* Ni el cliente no encontrado ni el fallo de la API tienen cartel en línea: los dos se
            avisan por ventana emergente (el segundo, desde `ModalErrorMonday`).

            La ficha se muestra SIEMPRE: skeleton mientras no hay cliente o se consulta, y se
            rellena con los datos reales al resolver la búsqueda. */}
        <ClienteFicha
          cliente={estadoBusqueda === 'idle' ? cliente : null}
          cargando={estadoBusqueda === 'buscando'}
          saldos={saldos}
        />

        {/* El avance queda SIEMPRE a la vista, haya o no cliente. El botón NUNCA se apaga: si falta
            algo, la ventana lo explica al hacer click, en vez de dejar un botón muerto sin motivo. */}
        <div className="actions-footer">
          <span className={`paso-siguiente ${motivoBloqueo ? 'paso-siguiente--bloqueo' : ''}`}>
            {motivoBloqueo ? (
              <>
                <i className="fas fa-circle-exclamation" /> {motivoBloqueo}
              </>
            ) : (
              <>
                <i className="fas fa-arrow-turn-up paso-siguiente-ic" /> Siguiente: {SIGUIENTE_PASO}
              </>
            )}
          </span>
          <button type="button" className="btn btn-primary" onClick={continuar}>
            Continuar a {SIGUIENTE_PASO}{' '}
            <i className="fas fa-arrow-right" />
          </button>
        </div>
      </div>

      {/* Sin elegir qué se cobra no hay recorrido: es lo primero que se reclama al avanzar. */}
      {avisoSinOperacion && (
        <AvisoModal
          titulo="Falta indicar qué vas a cobrar"
          onClose={() => setAvisoSinOperacion(false)}
        >
          Para continuar tenés que seleccionar en <strong>¿Qué vas a cobrar?</strong> qué cobro vas
          a realizar en el sistema: la cancelación de ventas pendientes de cobro, un anticipo o la
          aplicación de un anticipo contra facturas.
        </AvisoModal>
      )}

      {/* Sin declarar de quiénes son las cuentas no se puede ni buscar ni avanzar: es lo primero
          que el pase reclama, igual que Cobros reclama qué se va a cobrar. */}
      {avisoSinCuentasDe && (
        <AvisoModal
          titulo="Falta indicar de quiénes son las cuentas"
          onClose={() => setAvisoSinCuentasDe(false)}
        >
          {MSG_SIN_CUENTAS_DE}
        </AvisoModal>
      )}

      {/* Quien opera al contado no tiene cuenta corriente de la que debitar el saldo. */}
      {avisoContado && (
        <AvisoModal
          titulo={`El ${rotulo.singular} opera al contado`}
          onClose={() => setAvisoContado(false)}
        >
          {msgContadoOrigen(rol ?? 'cliente')}.
        </AvisoModal>
      )}

      {/* Sin persona cargada no se puede avanzar: se explica al intentarlo. */}
      {avisoSinCliente && (
        <AvisoModal
          titulo={`Falta cargar un ${rotulo.singular}`}
          onClose={() => setAvisoSinCliente(false)}
        >
          Para continuar tenés que buscar y cargar un {rotulo.singular}. Usá el buscador de arriba
          para seleccionarlo y volvé a intentar.
        </AvisoModal>
      )}

      {/* La búsqueda trajo a alguien que NO tiene la categoría que la operación exige. Es el MISMO
          aviso que usan Pagos y el destino del pase, con el rol que corresponda: en un pase "De
          Proveedores", un cliente se rechaza acá y su ficha no llega a dibujarse. */}
      {personaAjena && rol && (
        <AvisoCategoriaAjena
          rol={rol}
          operacion={ROTULO_OPERACION[operacionApp]}
          persona={personaAjena}
          onClose={() => setPersonaAjena(null)}
        />
      )}

      {/* No encontrado: la ventana es el único aviso, no hay cartel en línea. */}
      {avisoNoEncontrado && (
        <AvisoModal
          titulo={`${rotulo.titulo} no encontrado`}
          onClose={() => setAvisoNoEncontrado(false)}
        >
          El {rotulo.singular} que buscó no existe o está inactivo en el sistema.
        </AvisoModal>
      )}

      {/* Bloqueado en el board: no puede usarse en el sistema. */}
      {avisoBloqueado && (
        <AvisoModal
          titulo={`${rotulo.titulo} bloqueado`}
          onClose={() => setAvisoBloqueado(false)}
        >
          {MENSAJE_CLIENTE_BLOQUEADO}
        </AvisoModal>
      )}

      {/* Datos de la persona sin los que no se puede registrar la operación. */}
      {avisoDatos && cliente && (
        <AvisoModal
          titulo={`Faltan datos del ${rotulo.singular}`}
          faltantes={faltantes}
          onClose={() => setAvisoDatos(false)}
        >
          No se puede continuar porque a <strong>{cliente.name}</strong> le faltan datos en el
          sistema. Completalos en el tablero de Personas y volvé a reintentar.
        </AvisoModal>
      )}
    </section>
  )
}
