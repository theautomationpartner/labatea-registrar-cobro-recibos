import { useEffect, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { ModalCargando } from '@/components/ui/ModalCargando'
import { BuscarCliente, type BusquedaEstado } from '@/features/cliente/BuscarCliente'
import { ClienteFicha } from '@/features/cliente/ClienteFicha'
import { ImpactoAnticipos } from './ImpactoAnticipos'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { anticiposElegidos, totalAplicado } from '@/lib/cobros'
import { money } from '@/lib/format'
import {
  descripcionDestino,
  etiquetaDePaso,
  numeroDePaso,
  pasoAnterior,
} from '@/lib/pasos'
import { bloqueoDePases, esContado, MSG_CONTADO_DESTINO } from '@/lib/pases'
import { esperarRegistro, getSaldosCliente, registrarPaseDeSaldo } from '@/services/monday'
import { useApp, useDispatch } from '@/state/hooks'

/**
 * PASES DE SALDO · paso 3: a quién va el saldo y qué se hace con él.
 *
 * Son dos decisiones en una pantalla porque son inseparables: la acción se elige SOBRE una cuenta
 * concreta —cancelar ventas pendientes sólo tiene sentido si esa cuenta las tiene—, así que
 * separarlas en dos etapas obligaría a decidir a ciegas.
 *
 * El destino se elige con el MISMO buscador y la MISMA ficha del paso 1, no con un control propio:
 * las dos puntas del pase son clientes del tablero de Personas, y buscarlos de dos maneras distintas
 * dentro de la misma app obligaría a aprender dos veces lo mismo. La ficha aporta además el contexto
 * que la decisión necesita —cuánto debe, cuánto tiene a favor, cuánto le queda por cancelar—, que es
 * justamente lo que hay que mirar antes de elegir qué se hace con el saldo.
 *
 * Buscador, ficha, pregunta y opciones viven en UNA sola card: es una decisión, no cuatro bloques.
 */
export function PaseDestinoView() {
  const {
    cliente,
    usuario,
    anticipos,
    pasesDeAnticipo,
    clienteDestino,
    saldosDestino,
    saldosDestinoId,
    tipoOperacion,
  } = useApp()
  const dispatch = useDispatch()
  const [estadoBusqueda, setEstadoBusqueda] = useState<BusquedaEstado>('idle')
  /* El registro está en curso: tapa la pantalla y apaga los dos botones. No hay un estado "listo"
     —la confirmación de Monday ES el final de la operación, y ahí la app se reinicia—, así que este
     componente nunca llega a dibujar un resultado. */
  const [registrando, setRegistrando] = useState(false)
  // Aviso al intentar cerrar contra un destino que opera al contado.
  const [avisoContado, setAvisoContado] = useState(false)
  /* El pase quedó escrito pero el tablero no confirmó su registro. Es un desenlace propio: no es la
     conexión rechazada de la ventana global de error —la operación SÍ salió—, y decirlo mal haría
     que se reintente algo que ya está en Monday. */
  const [avisoRegistro, setAvisoRegistro] = useState<string | null>(null)

  const anterior = pasoAnterior('destino', tipoOperacion)
  /* Los anticipos elegidos en el paso 2 y lo que suman: ese total es a la vez lo que se debita del
     origen y lo que se acredita al destino. */
  const origenes = anticiposElegidos(anticipos, pasesDeAnticipo)
  const importePase = totalAplicado(pasesDeAnticipo)

  /* Saldos de Cta Cte del destino, en su propia consulta y con la misma caché por cliente que usa
     el paso 1: volver con el stepper no vuelve a consultar. Llegan después que la ficha, así que
     sus cajas se completan solas sin frenar al resto de la pantalla. */
  useEffect(() => {
    if (!clienteDestino || saldosDestinoId === clienteDestino.id) return
    let vivo = true
    getSaldosCliente(clienteDestino.id)
      .then(
        (s) =>
          vivo && dispatch({ type: 'setSaldosDestino', saldos: s, clienteId: clienteDestino.id }),
      )
      .catch(() => {
        if (!vivo) return
        /* Sin clave de caché: un error NO se cachea, así el próximo intento vuelve a leer en vez de
           dejar las cajas cargando para siempre. */
        dispatch({ type: 'setSaldosDestino', saldos: null, clienteId: null })
        dispatch({ type: 'errorMonday', accion: 'obtener los saldos de la cuenta destino' })
      })
    return () => {
      vivo = false
    }
  }, [clienteDestino, saldosDestinoId, dispatch])

  /* Qué impide cerrar el pase. Un destino al CONTADO no tiene cuenta corriente donde acreditar el
     saldo, así que se frena acá igual que el origen se frena en el paso 1. */
  const faltaCuenta = !clienteDestino
  /* Y qué le pasa al ORIGEN, con la MISMA regla del paso 2 —no una copia—: como el destino elegido
     ya no se borra al retocar la selección de anticipos, a esta pantalla se puede volver con el
     stepper después de haberlos desmarcado. Sin este control el botón de cierre quedaría encendido
     sobre un pase de cero, y el guard de `finalizar` lo cortaría en silencio. */
  const bloqueoOrigen = bloqueoDePases(anticipos, pasesDeAnticipo)
  /* Los datos del destino ya están firmes: hay cuenta elegida y no hay una búsqueda en curso. El
     panel de cierre se dibuja SIEMPRE —igual que la ficha—, así que esto no decide si se muestra
     sino si muestra números o su esqueleto. */
  const destinoListo = !!clienteDestino && estadoBusqueda === 'idle'
  const destinoContado = esContado(clienteDestino?.condicionPago)
  /* Sin vendedor no se registra: es el responsable de la operación y va a la cabecera del ítem.
     Antes se omitía la columna cuando faltaba, así que el pase quedaba en el tablero sin dueño. */
  const faltaVendedor = !usuario
  const bloqueo = !!bloqueoOrigen || faltaCuenta || destinoContado || faltaVendedor

  /**
   * Cierra la operación en DOS tiempos, y los dos se esperan:
   *
   *   1. se escribe el pase en Monday y se le pide al tablero que lo registre;
   *   2. se espera a que el tablero lo confirme ("🤖Estado Registro de Cobro" → "Registrado").
   *
   * Los efectos del cierre —reiniciar la app— se aplican SÓLO después del paso 2. El ítem escrito
   * no alcanza: el registro lo hace la automatización, así que darlo por bueno al terminar la
   * escritura sería anunciar un final que el tablero todavía no produjo.
   *
   * Por eso los dos fallos se cuentan distinto: si no se pudo escribir, la operación no salió y se
   * reintenta; si salió y no se confirmó, el pase YA está en Monday y lo que corresponde es ir a
   * mirarlo, no volver a mandarlo.
   */
  const finalizar = async () => {
    if (registrando) return
    if (destinoContado) {
      setAvisoContado(true)
      return
    }
    /* Resguardo de tipos: el recorrido garantiza los tres a esta altura y el botón está apagado si
       falta alguno, pero sin el guard TypeScript no puede saberlo. */
    if (!cliente || origenes.length === 0 || !clienteDestino || !usuario) return

    setRegistrando(true)
    /* Marca el corte entre los dos tiempos: con el pase ya escrito, un fallo posterior NO se puede
       comunicar como "no se pudo registrar el pase". */
    let escrito = false
    try {
      const itemId = await registrarPaseDeSaldo({
        clienteOrigenId: cliente.id,
        nombreOrigen: cliente.name,
        clienteDestinoId: clienteDestino.id,
        /* Un débito POR anticipo, con lo que se carga de cada uno: el subelemento queda linkeado a
           su propio saldo y el tablero muestra de dónde salió cada peso. */
        debitos: origenes.map((a) => ({ anticipoId: a.id, importe: pasesDeAnticipo[a.id] })),
        vendedorId: usuario.id,
        /* Lo acreditado sale del mismo total que suman los débitos: el servicio verifica igual que
           la diferencia dé cero antes de escribir nada (ver `paseCuadra`). */
        acreditado: importePase,
      })
      escrito = true

      /* El tablero tiene que decir que lo registró. Hasta que esa columna llega a "Registrado" la
         pantalla sigue tapada: la automatización es la que mueve el saldo de verdad. */
      await esperarRegistro(itemId)

      /* Registro CONFIRMADO por Monday: ESO cierra la operación. La app vuelve a su estado inicial
         en vez de mostrar un cartel de éxito —el pase ya está en el tablero, y dejar la pantalla del
         destino con un mensaje sólo invitaría a seguir tocando algo que ya terminó—. */
      dispatch({ type: 'reset' })
    } catch (e) {
      setRegistrando(false)
      if (!escrito) {
        // No salió: se puede reintentar sin duplicar nada.
        dispatch({ type: 'errorMonday', accion: 'registrar el pase de saldo' })
        return
      }
      /* Salió pero no se confirmó. Se dice con el mensaje de lo que efectivamente pasó —el error del
         tablero o el tiempo vencido—, y no se reinicia la app: el pase está escrito y hay que
         mirarlo en Monday antes de tocar nada. */
      setAvisoRegistro(
        e instanceof Error && e.message.trim()
          ? e.message
          : 'El pase quedó escrito en Monday, pero el tablero no confirmó su registro.',
      )
    }
  }

  return (
    <section className="view cliente-v2 cobro-v2 pases-v2 paso-layout">
      <PasoHeader />

      <div className="paso-body">
        {/* La bajada NOMBRA el importe que se está moviendo: es el dato que vuelve entendible a
            quién hay que buscar. Por eso el texto que antes encabezaba la card se fue: decía lo
            mismo dos veces en la misma pantalla. */}
        <PasoTitulo
          numero={numeroDePaso('destino', tipoOperacion)}
          titulo={etiquetaDePaso('destino', tipoOperacion)}
          descripcion={descripcionDestino(money(importePase))}
        />

        <div className="cobro-static">
          <div className="cobro-card cobro-card--cierre">
            {/* Buscador del destino: el MISMO del paso 1, contra el tablero de Personas. Lo único
                que cambia es a dónde va el cliente elegido —acá es el destino, no el titular de la
                operación— y el texto del campo. */}
            <div className="unified-toolbar pase-buscador">
              <BuscarCliente
                estado={estadoBusqueda}
                onEstado={setEstadoBusqueda}
                placeholder="Buscar cuenta destino por código, nombre o CUIT..."
                onElegir={(cliente) => dispatch({ type: 'setClienteDestino', cliente })}
              />
            </div>

            {/* La MISMA ficha del paso 1, con sus mismas cajas. Se muestra SIEMPRE: en skeleton
                mientras no hay destino elegido y con los datos reales al resolver la búsqueda, así
                el alto de la card no cambia cuando aparece el resultado. */}
            <ClienteFicha
              cliente={estadoBusqueda === 'idle' ? clienteDestino : null}
              cargando={estadoBusqueda === 'buscando'}
              saldos={saldosDestino}
              /* El saldo a favor sale de la ficha: aca abajo se muestra con su proyeccion, y
                 repetirlo suelto dejaria dos numeros hablando de lo mismo. */
              sinAnticipos
            />

            <div className="cobro-card-acts">
              {bloqueo && (
                <span className="cobro-bloqueo-inline">
                  <i className="fas fa-circle-exclamation" />{' '}
                  {/* El origen primero: es lo que se decidió ANTES, y sin saldo que mover no
                      importa contra qué cuenta se lo quiera acreditar. */}
                  {bloqueoOrigen
                    ? bloqueoOrigen.mensaje
                    : faltaCuenta
                      ? 'Buscá y elegí la cuenta destino'
                      : faltaVendedor
                        ? 'Elegí el vendedor responsable en el encabezado'
                        : MSG_CONTADO_DESTINO}
                </span>
              )}
            </div>

            {/* CIERRA la card, pegado a su borde inferior: es la consecuencia de todo lo que se
                eligió arriba, así que se lee al final y nada lo sigue.

                Se monta SIEMPRE, como la ficha: sin destino elegido muestra su esqueleto en vez de
                desaparecer. Escondiéndolo, la card cambiaba de alto justo cuando el usuario está
                mirando el resultado de la búsqueda, y hasta ese momento nada dejaba ver que esta
                proyección iba a existir. En cero tampoco se muestran números: unos ceros se leerían
                como un resultado. */}
            <ImpactoAnticipos
              actual={saldosDestino?.anticipos ?? 0}
              recibido={importePase}
              vacio={!destinoListo}
            />
          </div>
        </div>

        <div className="actions-footer">
          <button
            type="button"
            className="btn btn-out"
            /* Con el pase ya escrito no se vuelve atrás: cambiar el destino a esa altura no
               desharía el ítem del tablero, sólo dejaría la pantalla diciendo otra cosa. */
            disabled={registrando}
            onClick={() => anterior && dispatch({ type: 'goto', paso: anterior })}
          >
            <i className="fas fa-arrow-left" /> Volver
          </button>

          <div className="actions-footer-fin">
            {/* Es el ÚLTIMO paso: el botón registra el pase y espera al tablero. Cuando Monday
                confirma, la app se reinicia sola —no hay estado posterior que dibujar acá—. */}
            <button
              type="button"
              className="btn btn-primary"
              disabled={registrando || bloqueo}
              aria-busy={registrando}
              onClick={() => void finalizar()}
            >
              <i className="fas fa-flag-checkered" /> Finalizar Operación
            </button>
          </div>
        </div>
      </div>

      {/* Mientras se escribe en Monday la pantalla queda tapada: la operación ya salió y no se
          puede tocar nada hasta saber cómo terminó. */}
      {registrando && (
        <ModalCargando
          titulo="Registrando Pase de Saldo"
          detalle="Estamos registrando el pase de saldo en el sistema"
        />
      )}

      {/* El pase salió pero el tablero no lo confirmó. Se nombra así, sin prometer nada: lo único
          seguro es que el ítem está escrito y que su registro no cerró. */}
      {avisoRegistro && (
        <AvisoModal titulo="El pase no se confirmó" onClose={() => setAvisoRegistro(null)}>
          {avisoRegistro}
        </AvisoModal>
      )}

      {avisoContado && (
        <AvisoModal
          titulo="La cuenta destino opera al contado"
          onClose={() => setAvisoContado(false)}
        >
          {MSG_CONTADO_DESTINO}.
        </AvisoModal>
      )}
    </section>
  )
}
