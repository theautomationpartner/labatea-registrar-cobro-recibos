import { useEffect, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { ModalCargando } from '@/components/ui/ModalCargando'
import { ClienteFicha } from '@/features/cliente/ClienteFicha'
import { ImpactoAnticipos } from '@/features/pases/ImpactoAnticipos'
import { AvisoCategoriaAjena } from '@/features/shared/AvisoCategoriaAjena'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { descripcionDePaso, etiquetaDePaso, numeroDePaso, pasoAnterior } from '@/lib/pasos'
import { aplicaCredito } from '@/lib/credito'
import { round2 } from '@/lib/format'
import { cumpleRol, ROTULO_OPERACION } from '@/lib/personas'
import {
  getProveedorDelCheque,
  getSaldosProveedor,
  registrarRechazoDeCheque,
} from '@/services/monday'
import { useApp, useDispatch } from '@/state/hooks'
import type { Cliente } from '@/types'

/** En qué anda la resolución automática del acreedor: gobierna qué muestra la card. */
type EstadoAcreedor = 'buscando' | 'listo' | 'sin-datos' | 'ajeno' | 'error'

/**
 * Por qué no hay acreedor, según cómo terminó la resolución automática. Los tres se dicen distinto
 * a propósito: dos son datos que faltan en el TABLERO —y lo que corresponde es ir a cargarlos— y el
 * tercero es un fallo de conexión, que se reintenta.
 */
const MOTIVO_SIN_ACREEDOR: Record<string, string> = {
  'sin-datos':
    'El cheque no tiene una factura de compra conectada, o esa factura no tiene proveedor: completalo en Monday y volvé a entrar al paso',
  ajeno: 'La persona conectada a la factura no está categorizada como proveedor',
  error: 'No se pudo obtener el proveedor: volvé a entrar al paso para reintentar',
}

/**
 * RECHAZO DE CHEQUE · paso 3: a quién se le había endosado el cheque, y el cierre de la operación.
 *
 * El proveedor NO se busca: se DEDUCE del cheque elegido en el paso 2. El cheque conoce las
 * facturas de compra que pagó, y la factura conoce a quién se le compró, así que el dato ya está en
 * el tablero y pedírselo al operador sería hacerle buscar algo que el sistema puede contestar solo
 * (ver `getProveedorDelCheque`). Por eso esta pantalla no tiene buscador: acá no hay nada que
 * decidir, sólo algo que verificar.
 *
 * Lo que sí se conserva es la FICHA, la misma del paso 1 y con las mismas cajas: el operador tiene
 * que poder confirmar de un vistazo que el proveedor que salió es el que esperaba. Mientras se lo
 * resuelve queda en su skeleton QUIETO —sin animación de ninguna clase—, y lo que dice que hay una
 * consulta en curso es el texto: la bajada de la card y el renglón del pie.
 *
 * La validación de categoría sigue corriendo. El dato viene del tablero y no del operador, pero un
 * ítem de Personas mal categorizado no puede entrar como acreedor sin que nadie se entere.
 *
 * Es el ÚLTIMO paso: acá se escribe el rechazo en las dos cuentas corrientes y, con las dos
 * escrituras confirmadas, la app se reinicia. No hay pantalla de resultado —el movimiento ya está
 * en Monday, y dejar esta pantalla con un cartel sólo invitaría a seguir tocando algo terminado—.
 */
export function ProveedorAcreedorView() {
  const {
    cliente,
    chequesRechazo,
    chequeRechazadoId,
    proveedorAcreedor,
    saldosAcreedor,
    saldosAcreedorId,
    tipoOperacion,
  } = useApp()
  const dispatch = useDispatch()
  /**
   * La persona que el tablero devolvió y NO se pudo cargar porque no es un proveedor. Mientras esto
   * tenga valor hay una ventana abierta explicando por qué, y es lo único que se ve de ella: su
   * ficha no llega a dibujarse.
   */
  const [personaAjena, setPersonaAjena] = useState<Cliente | null>(null)
  /* El registro está en curso: tapa la pantalla y apaga los dos botones. No hay estado "listo" —el
     final de la operación reinicia la app—, así que este componente nunca dibuja un resultado. */
  const [registrando, setRegistrando] = useState(false)
  // Motivo por el que no se puede cerrar, mostrado al intentarlo.
  const [aviso, setAviso] = useState<{ titulo: string; mensaje: string } | null>(null)
  /* Con el acreedor YA resuelto se arranca en "listo": volver al paso con el stepper no vuelve a
     consultar, con el mismo criterio de caché que el resto de la app. */
  const [estado, setEstado] = useState<EstadoAcreedor>(proveedorAcreedor ? 'listo' : 'buscando')

  const anterior = pasoAnterior('proveedorAcreedor', tipoOperacion)
  const cheque = chequesRechazo.find((c) => c.id === chequeRechazadoId) ?? null

  /**
   * Resuelve el acreedor a partir del cheque. Corre UNA vez: el efecto sale de entrada si ya hay
   * uno cargado, así que ir y volver con el stepper no vuelve a consultar.
   *
   * Los desenlaces que NO son un fallo de la app tienen su propio estado y su propio mensaje: un
   * cheque sin facturas conectadas, o una factura sin proveedor, son datos que faltan en el tablero
   * y hay que decir exactamente eso —no "no se pudo conectar"—, porque lo que corresponde hacer es
   * ir a completarlos.
   */
  useEffect(() => {
    if (!cheque || proveedorAcreedor) return
    let vivo = true
    setEstado('buscando')
    getProveedorDelCheque(cheque.id)
      .then((p) => {
        if (!vivo) return
        if (!p) {
          setEstado('sin-datos')
          return
        }
        /* Se valida igual que si lo hubiera buscado el operador: el origen del dato cambia, la
           regla no. */
        if (!cumpleRol(p, 'proveedor')) {
          setPersonaAjena(p)
          setEstado('ajeno')
          return
        }
        dispatch({ type: 'setProveedorAcreedor', proveedor: p })
        setEstado('listo')
      })
      .catch(() => {
        if (!vivo) return
        setEstado('error')
        dispatch({ type: 'errorMonday', accion: 'obtener el proveedor al que se endosó el cheque' })
      })
    return () => {
      vivo = false
    }
  }, [cheque, proveedorAcreedor, dispatch])

  /* Saldos de Cta Cte del acreedor, en su propia consulta y con la misma caché por persona que usa
     el paso 1: volver con el stepper no vuelve a consultar. Llegan después que la ficha, así que
     sus cajas se completan solas sin frenar al resto de la pantalla. */
  useEffect(() => {
    if (!proveedorAcreedor || saldosAcreedorId === proveedorAcreedor.id) return
    let vivo = true
    /* Su cuenta está en el tablero de PROVEEDORES, no en el de clientes: son dos cuentas distintas
       de la misma persona, y buscar la de un proveedor entre las de clientes devuelve ceros sin
       fallar (ver `getSaldosProveedor`). */
    getSaldosProveedor(proveedorAcreedor.id)
      .then(
        (s) =>
          vivo &&
          dispatch({ type: 'setSaldosAcreedor', saldos: s, clienteId: proveedorAcreedor.id }),
      )
      .catch(() => {
        if (!vivo) return
        /* Sin clave de caché: un error NO se cachea, así el próximo intento vuelve a leer en vez de
           dejar las cajas cargando para siempre. */
        dispatch({ type: 'setSaldosAcreedor', saldos: null, clienteId: null })
        dispatch({ type: 'errorMonday', accion: 'obtener los saldos del proveedor acreedor' })
      })
    return () => {
      vivo = false
    }
  }, [proveedorAcreedor, saldosAcreedorId, dispatch])

  const buscando = estado === 'buscando'
  /**
   * Cómo queda la LÍNEA DE CRÉDITO del acreedor con el rechazo ya registrado.
   *
   * El importe del cheque se suma a la cuenta corriente, y la línea utilizada es justamente la
   * deuda de esa cuenta más los remitos pendientes de facturar, así que lo que sube la una sube la
   * otra. El disponible se DERIVA del límite —no se toma el `disponible` que trae la persona, que
   * es el de antes de la operación— y se topea en cero con el mismo criterio que la fórmula del
   * tablero: un límite excedido no muestra un disponible negativo.
   *
   * `atenuado` sale de la MISMA regla que apaga el bloque de crédito en la ficha de arriba
   * (`aplicaCredito`): el proveedor "Liberado sin crédito" opera sin tope, y también el que compra
   * al contado o no tiene condición de pago cargada. Grisarlos en un lado y no en el otro dejaría
   * los mismos números diciendo dos cosas distintas en la misma pantalla.
   */
  const lineaResultante = round2((proveedorAcreedor?.lineaUtilizada ?? 0) + (cheque?.importe ?? 0))
  const creditoProyectado = {
    lineaUtilizada: lineaResultante,
    disponible: Math.max(round2((proveedorAcreedor?.limit ?? 0) - lineaResultante), 0),
    atenuado: !aplicaCredito(proveedorAcreedor),
  }
  /* Qué impide cerrar. Se revisan también las dos etapas anteriores —no sólo ésta—: al paso se
     puede volver con el stepper después de haber desmarcado el cheque, y sin este control el botón
     quedaría encendido sobre una operación incompleta. */
  const motivoBloqueo = !cliente
    ? 'Volvé al paso 1 y elegí el cliente deudor'
    : !cheque
      ? 'Volvé al paso 2 y elegí el cheque rechazado'
      : buscando
        ? 'Buscando al proveedor al que se le endosó el cheque...'
        : !proveedorAcreedor
          ? (MOTIVO_SIN_ACREEDOR[estado] ?? MOTIVO_SIN_ACREEDOR.error)
          : undefined

  /**
   * Cierra la operación: escribe el rechazo en las DOS cuentas corrientes —un movimiento en la del
   * cliente y otro en la del proveedor— y recién con las dos confirmadas reinicia la app.
   *
   * Las dos escrituras van en una sola mutación del servicio, así que no hay un estado intermedio
   * que distinguir acá: o quedaron las dos, o no quedó ninguna y se puede reintentar sin duplicar
   * nada (ver `registrarRechazoDeCheque`).
   */
  const finalizar = async () => {
    if (registrando) return
    /* Resguardo de tipos: el botón está apagado si falta alguno, pero sin el guard TypeScript no
       puede saberlo. */
    if (!cliente || !cheque || !proveedorAcreedor) return

    setRegistrando(true)
    try {
      await registrarRechazoDeCheque({
        clienteId: cliente.id,
        proveedorId: proveedorAcreedor.id,
        chequeId: cheque.id,
        /* Sin número cargado va el código del ítem, con el mismo criterio con el que la tabla del
           paso 2 nombra al papel: siempre hay algo con qué identificarlo en la cuenta. */
        numeroCheque: cheque.numero.trim() || cheque.codigo,
        importe: cheque.importe,
      })

      /* Escrito en las dos cuentas: ESO cierra la operación. La app vuelve a su estado inicial en
         vez de mostrar un cartel de éxito, con el mismo criterio que el cierre de un pase. */
      dispatch({ type: 'reset' })
    } catch (e) {
      setRegistrando(false)
      /* El servicio corta ANTES de escribir cuando falta una de las dos cuentas corrientes, y ese
         mensaje dice exactamente cuál: se muestra tal cual, porque es accionable. Cualquier otro
         fallo es de la conexión con Monday y lo comunica la ventana global. */
      const mensaje = e instanceof Error ? e.message.trim() : ''
      if (mensaje.startsWith('No se encontró la cuenta corriente')) {
        setAviso({ titulo: 'Falta una cuenta corriente', mensaje })
        return
      }
      dispatch({ type: 'errorMonday', accion: 'registrar el rechazo del cheque' })
    }
  }

  return (
    <section className="view cliente-v2 cobro-v2 pases-v2 paso-layout">
      <PasoHeader />

      <div className="paso-body">
        <PasoTitulo
          numero={numeroDePaso('proveedorAcreedor', tipoOperacion)}
          titulo={etiquetaDePaso('proveedorAcreedor', tipoOperacion)}
          descripcion={descripcionDePaso('proveedorAcreedor', tipoOperacion)}
        />

        <div className="cobro-static">
          <div className="cobro-card cobro-card--cierre">
            <h3 className="cobro-card-title">Proveedor acreedor</h3>
            <p className="cobro-card-desc">
              {buscando
                ? 'Buscando al proveedor al que se le había endosado el cheque...'
                : 'Sale de las facturas de compra que ese cheque había pagado. Revisá que sea el correcto antes de finalizar.'}
            </p>

            {/* La MISMA ficha del paso 1. Se muestra SIEMPRE: mientras se resuelve el proveedor va
                en skeleton —quieto, como el resto de la app— y se rellena sola con los datos
                reales, así el alto de la card no cambia cuando llega el resultado. */}
            <ClienteFicha cliente={proveedorAcreedor} cargando={buscando} saldos={saldosAcreedor} />

            {/* Pie de la card: sólo lo que FALTA para poder cerrar. Con todo listo queda vacío; el
                div se monta igual —tiene su alto reservado—, así que el mensaje aparece y
                desaparece sin mover los botones de abajo. */}
            <div className="cobro-card-acts">
              {motivoBloqueo && (
                <span className="cobro-bloqueo-inline">
                  <i className="fas fa-circle-exclamation" /> {motivoBloqueo}
                </span>
              )}
            </div>

            {/* CIERRA la card, en el mismo lugar y con el mismo panel que el destino de un PASE DE
                SALDO: cómo queda la cuenta del acreedor con el rechazo ya registrado. Lo que cambia
                son los rótulos —acá se suma al SALDO DE CUENTA CORRIENTE y lo que suma es el
                importe del cheque—, no la caja ni las métricas: es la misma proyección.

                Se monta SIEMPRE, como la ficha: mientras el proveedor se resuelve muestra su
                esqueleto en vez de desaparecer, así la card no cambia de alto justo cuando el
                usuario está mirando el resultado.

                El "actual" sale del MISMO número que la ficha muestra arriba (`saldoCtaCte`) y no
                de otra consulta: dos lecturas del mismo saldo podrían discrepar en pantalla, y el
                panel existe para explicar ese número, no para competir con él. */}
            <ImpactoAnticipos
              actual={proveedorAcreedor?.saldoCtaCte ?? 0}
              recibido={cheque?.importe ?? 0}
              vacio={!proveedorAcreedor}
              titulo="Resumen de la cuenta por rechazo de cheque"
              rotuloActual="Saldo Cta Cte actual"
              rotuloRecibido="Credito por cheque rechazado"
              rotuloResultante="SALDO CTA CTE RESULTANTE"
              credito={creditoProyectado}
            />
          </div>
        </div>

        <div className="actions-footer">
          <button
            type="button"
            className="btn btn-out"
            /* Con el rechazo ya escrito no se vuelve atrás: cambiar el cheque a esa altura no
               desharía los movimientos del tablero, sólo dejaría la pantalla diciendo otra cosa. */
            disabled={registrando}
            onClick={() => anterior && dispatch({ type: 'goto', paso: anterior })}
          >
            <i className="fas fa-arrow-left" /> Volver
          </button>

          <div className="actions-footer-fin">
            {/* Es el ÚLTIMO paso: el botón escribe el rechazo en las dos cuentas. Cuando las dos
                quedan escritas, la app se reinicia sola. */}
            <button
              type="button"
              className="btn btn-primary"
              disabled={registrando || !!motivoBloqueo}
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
          titulo="Registrando Cheque Rechazado"
          detalle="Registrando cheque rechazado en el sistema"
        />
      )}

      {aviso && (
        <AvisoModal titulo={aviso.titulo} onClose={() => setAviso(null)}>
          {aviso.mensaje}
        </AvisoModal>
      )}

      {/* El tablero devolvió a alguien que no está categorizado como proveedor. Su ficha no llega a
          dibujarse: la ventana es lo único que se ve de él. Mismo aviso —y misma regla— que en el
          paso 1, con el rol invertido. */}
      {personaAjena && (
        <AvisoCategoriaAjena
          rol="proveedor"
          operacion={ROTULO_OPERACION.RECHAZOS}
          persona={personaAjena}
          onClose={() => setPersonaAjena(null)}
        />
      )}
    </section>
  )
}
