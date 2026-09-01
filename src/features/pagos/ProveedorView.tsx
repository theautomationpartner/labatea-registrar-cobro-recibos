import { useEffect, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { BuscarCliente, type BusquedaEstado } from '@/features/cliente/BuscarCliente'
import { ClienteFicha } from '@/features/cliente/ClienteFicha'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { clienteBloqueado, MENSAJE_CLIENTE_BLOQUEADO } from '@/lib/credito'
import { AvisoCategoriaAjena } from '@/features/shared/AvisoCategoriaAjena'
import {
  MSG_SIN_CTA_CTE,
  MSG_SOLO_CTA_CTE,
  proveedorSinCtaCte,
  rechazoAlSeleccionar,
  type RechazoProveedor,
} from '@/lib/pagosProveedor'
import { ROTULO_OPERACION } from '@/lib/personas'
import {
  descripcionDePasoPago,
  etiquetaDePasoPago,
  numeroDePasoPago,
  siguientePasoPago,
} from '@/lib/pasosPago'
import { buscarProveedores, getSaldosCliente } from '@/services/monday'
import { useApp, useDispatch } from '@/state/hooks'
import type { Cliente, Proveedor, SaldosCliente } from '@/types'
import { OperacionPagoConfig } from './OperacionPagoConfig'

/**
 * Etapa 1 de PAGOS: qué se va a pagar y a quién.
 *
 * Es la misma pantalla que el paso 1 de Cobros, pieza por pieza —la caja de configuración, el
 * buscador y la ficha son LOS MISMOS componentes—, con dos diferencias que son propias de este
 * circuito:
 *
 *   · el buscador consulta la categoría "Proveedores" del board de Personas en vez de "Clientes"
 *     (ver `services/monday/proveedores`), y
 *   · antes de dejar avanzar se valida la CONDICIÓN DE PAGO: para cancelar una factura de compra
 *     pendiente el proveedor tiene que operar en CUENTA CORRIENTE, y tener efectivamente una
 *     asignada en el sistema.
 *
 * Las dos validaciones se resuelven con el botón siempre encendido, igual que en Cobros: si algo
 * falta, la ventana lo explica al hacer click, en vez de dejar un botón muerto sin motivo.
 */
export function ProveedorView() {
  const { proveedor, tipoOperacionPago } = useApp()
  const dispatch = useDispatch()
  // Estado de la búsqueda: gobierna qué se muestra en el lugar de la ficha.
  const [estadoBusqueda, setEstadoBusqueda] = useState<BusquedaEstado>('idle')
  /* Saldos de la cuenta corriente del proveedor. Salen del MISMO tablero y de la misma consulta que
     los del cliente —la cuenta corriente es una sola, y el board de facturas de compra la espeja
     como "🤖Cta Cte Prov"—, así que la ficha se completa igual que en Cobros en vez de quedarse con
     dos cajas cargando para siempre.

     Viven en el estado LOCAL y no en el global: son un dato de esta pantalla, y el proveedor ya se
     guarda arriba. `null` = todavía no llegaron. */
  const [saldos, setSaldos] = useState<SaldosCliente | null>(null)
  // Avisos emergentes: uno por cada motivo que frena el avance.
  const [avisoSinOperacion, setAvisoSinOperacion] = useState(false)
  const [avisoSinProveedor, setAvisoSinProveedor] = useState(false)
  const [avisoBloqueado, setAvisoBloqueado] = useState(false)
  const [avisoSinCtaCte, setAvisoSinCtaCte] = useState(false)
  /**
   * La persona que la búsqueda trajo y NO se pudo cargar, con el motivo. Mientras esto tenga valor
   * hay una ventana abierta explicando por qué: es lo único que el usuario ve de ella. Su ficha no
   * llega a dibujarse, que es el punto de validar al seleccionar y no al avanzar.
   */
  const [rechazo, setRechazo] = useState<{ motivo: RechazoProveedor; persona: Proveedor } | null>(
    null,
  )
  // Ventana emergente cuando la búsqueda no encuentra al proveedor: es el ÚNICO aviso de ese caso.
  const [avisoNoEncontrado, setAvisoNoEncontrado] = useState(false)

  // Cada vez que la búsqueda termina en "no encontrado", se abre la ventana emergente.
  useEffect(() => {
    if (estadoBusqueda === 'no-encontrado') setAvisoNoEncontrado(true)
  }, [estadoBusqueda])

  /* Los saldos llegan después que la ficha, en su propia consulta: sus cajas se completan solas
     cuando resuelve, sin frenar al resto de la pantalla. Ante un error quedan en `null` y lo
     comunica la ventana global. */
  useEffect(() => {
    if (!proveedor) {
      setSaldos(null)
      return
    }
    let vivo = true
    setSaldos(null)
    getSaldosCliente(proveedor.id)
      .then((s) => vivo && setSaldos(s))
      .catch(() => {
        if (!vivo) return
        dispatch({ type: 'errorMonday', accion: 'obtener los saldos del proveedor' })
      })
    return () => {
      vivo = false
    }
  }, [proveedor, dispatch])

  /**
   * Qué pasa cuando la búsqueda devuelve a alguien.
   *
   * Acá se decide si esa persona ENTRA o no al estado, y por eso las dos reglas que dependen de
   * QUIÉN es —que sea proveedor y que opere en cuenta corriente— se evalúan en este punto y no al
   * intentar avanzar: a quien no sirve para esta operación no se le llega a mostrar ni un dato. La
   * ventana es todo lo que el usuario ve de él.
   *
   * Un rechazo NO descarta lo que ya estaba cargado: si venía operando con un proveedor válido,
   * ese sigue en pantalla. Buscar a alguien que no sirve es un intento fallido, no una orden de
   * borrar el trabajo hecho.
   */
  const elegir = (persona: Proveedor) => {
    const motivo = rechazoAlSeleccionar(persona)
    if (motivo) {
      setRechazo({ motivo, persona })
      return
    }
    dispatch({ type: 'setProveedor', proveedor: persona })
  }

  /* Qué viene después de elegir el proveedor: en un pago contra facturas son las pendientes, y en
     un anticipo el registro del anticipo. Mientras no se eligió qué pagar se anticipa la del pago
     contra facturas, que es el recorrido completo. */
  const destino = siguientePasoPago('proveedor', tipoOperacionPago)
  const SIGUIENTE = destino ? etiquetaDePasoPago(destino, tipoOperacionPago) : ''

  /* El proveedor está confirmado: hay uno cargado y la búsqueda no está en curso ni terminó mal. */
  const proveedorListo = estadoBusqueda === 'idle' && !!proveedor
  const bloqueado = clienteBloqueado(proveedor)
  /* Lo ÚNICO que queda por validar al avanzar. La condición de pago ya no se mira acá: un
     proveedor que no opera en cuenta corriente nunca llegó al estado (ver `elegir`), así que
     revisarla de nuevo sería preguntar por algo que no puede pasar. Esta sí se queda: el proveedor
     es válido, y lo que falta es un dato del SISTEMA que puede cargarse en Monday sin cambiar de
     proveedor. */
  const sinCtaCte = proveedorListo && proveedorSinCtaCte(proveedor)

  const continuar = () => {
    /* Sin saber QUÉ se paga no hay operación posible: es lo primero que se reclama. */
    if (!tipoOperacionPago) {
      setAvisoSinOperacion(true)
      return
    }
    if (!proveedorListo) {
      setAvisoSinProveedor(true)
      return
    }
    if (bloqueado) {
      setAvisoBloqueado(true)
      return
    }
    if (sinCtaCte) {
      setAvisoSinCtaCte(true)
      return
    }
    /* Los dos recorridos tienen etapa siguiente desde acá, así que `destino` nunca es null a esta
       altura; el guard existe para que el tipo lo refleje sin recurrir a un `!`. */
    if (destino) dispatch({ type: 'gotoPago', paso: destino })
  }

  /* Por qué todavía no se puede avanzar. Se muestra en el footer, al lado del botón. */
  const motivoBloqueo = !tipoOperacionPago
    ? 'Indicá qué vas a pagar para continuar'
    : !proveedorListo
      ? 'Buscá y confirmá un proveedor para continuar'
      : bloqueado
        ? 'Proveedor bloqueado: no se puede operar'
        : sinCtaCte
          ? 'El proveedor no tiene cuenta corriente asignada'
          : undefined

  return (
    <section className="view cliente-v2 paso-layout">
      {/* ZONA 1 · contexto de la operación y navegación, siempre a la vista. */}
      <PasoHeader />

      {/* ZONA 2 · el trabajo del paso: qué se paga y a qué proveedor. */}
      <div className="paso-body">
        <PasoTitulo
          numero={numeroDePasoPago('proveedor', tipoOperacionPago)}
          titulo={etiquetaDePasoPago('proveedor', tipoOperacionPago)}
          descripcion={descripcionDePasoPago('proveedor', tipoOperacionPago)}
        />

        {/* Qué se va a pagar. Define el recorrido, así que va ANTES del buscador. */}
        <OperacionPagoConfig />

        {/* Buscador del proveedor: el MISMO componente del paso 1 de Cobros, apuntado a la otra
            categoría del board de Personas. El responsable de la operación ya se ve —y se cambia—
            en el selector del encabezado, así que no se repite acá. */}
        <div className="toolbar-wrapper">
          <div className="card unified-toolbar">
            <BuscarCliente
              estado={estadoBusqueda}
              onEstado={setEstadoBusqueda}
              placeholder="Buscar proveedor por código, nombre o CUIT..."
              mensajeVacio="Ingresá un nombre, código de proveedor o CUIT."
              sujeto="el proveedor"
              buscarPersonas={buscarProveedores}
              /* El proveedor NO es el cliente de la operación: va a su propia clave del estado,
                 así que se pasa el efecto en vez de dejar el `setCliente` por defecto. El casteo es
                 seguro por construcción —`buscarProveedores` sólo devuelve `Proveedor`—, y es el
                 precio de que el buscador hable el modelo común de las dos categorías. */
              onElegir={(p: Cliente) => elegir(p as Proveedor)}
            />
          </div>
        </div>

        {/* Ni el proveedor no encontrado ni el fallo de la API tienen cartel en línea: los dos se
            avisan por ventana emergente. La ficha se muestra SIEMPRE: skeleton mientras no hay
            proveedor o se consulta, y se rellena al resolver la búsqueda. */}
        <ClienteFicha
          cliente={estadoBusqueda === 'idle' ? proveedor : null}
          cargando={estadoBusqueda === 'buscando'}
          saldos={saldos}
        />

        {/* El avance queda SIEMPRE a la vista, haya o no proveedor. El botón NUNCA se apaga: si
            falta algo, la ventana lo explica al hacer click. */}
        <div className="actions-footer">
          <span className={`paso-siguiente ${motivoBloqueo ? 'paso-siguiente--bloqueo' : ''}`}>
            {motivoBloqueo ? (
              <>
                <i className="fas fa-circle-exclamation" /> {motivoBloqueo}
              </>
            ) : (
              <>
                <i className="fas fa-arrow-turn-up paso-siguiente-ic" /> Siguiente: {SIGUIENTE}
              </>
            )}
          </span>
          <button type="button" className="btn btn-primary" onClick={continuar}>
            Continuar a {SIGUIENTE} <i className="fas fa-arrow-right" />
          </button>
        </div>
      </div>

      {/* Sin elegir qué se paga no hay recorrido: es lo primero que se reclama al avanzar. */}
      {avisoSinOperacion && (
        <AvisoModal
          titulo="Falta indicar qué vas a pagar"
          onClose={() => setAvisoSinOperacion(false)}
        >
          Para continuar tenés que seleccionar en <strong>Que vas a Pagar?</strong> qué pago vas a
          registrar en el sistema.
        </AvisoModal>
      )}

      {/* Sin proveedor cargado no se puede avanzar: se explica al intentarlo. */}
      {avisoSinProveedor && (
        <AvisoModal titulo="Falta cargar un proveedor" onClose={() => setAvisoSinProveedor(false)}>
          Para continuar tenés que buscar y cargar un proveedor. Usá el buscador de arriba para
          seleccionarlo y volvé a intentar.
        </AvisoModal>
      )}

      {/* Proveedor no encontrado: la ventana es el único aviso, no hay cartel en línea. */}
      {avisoNoEncontrado && (
        <AvisoModal titulo="Proveedor no encontrado" onClose={() => setAvisoNoEncontrado(false)}>
          El proveedor que buscó no existe o está inactivo en el sistema.
        </AvisoModal>
      )}

      {/* Proveedor bloqueado en el board: no puede usarse en el sistema. */}
      {avisoBloqueado && (
        <AvisoModal titulo="Proveedor bloqueado" onClose={() => setAvisoBloqueado(false)}>
          {MENSAJE_CLIENTE_BLOQUEADO}
        </AvisoModal>
      )}

      {/* La búsqueda trajo a alguien que NO es proveedor. La operación de PAGOS es sólo para
          proveedores, así que no se carga: la ventana es lo único que se ve de esa persona. Es el
          MISMO aviso que usan Cobros y Pases, con el rol dado vuelta. */}
      {rechazo?.motivo === 'no-es-proveedor' && (
        <AvisoCategoriaAjena
          rol="proveedor"
          operacion={ROTULO_OPERACION.PAGOS}
          persona={rechazo.persona}
          onClose={() => setRechazo(null)}
        />
      )}

      {/* Es proveedor, pero su condición de pago no habilita cancelar facturas de compra. Tampoco
          se carga: por eso el nombre sale del rechazo y no del estado. */}
      {rechazo?.motivo === 'condicion-de-pago' && (
        <AvisoModal
          titulo="La condición de pago no habilita la operación"
          faltantes={[rechazo.persona.name]}
          onClose={() => setRechazo(null)}
        >
          {MSG_SOLO_CTA_CTE}
        </AvisoModal>
      )}

      {/* Opera en cuenta corriente, pero el sistema no le tiene ninguna asignada. */}
      {avisoSinCtaCte && (
        <AvisoModal
          titulo="Falta la cuenta corriente del proveedor"
          onClose={() => setAvisoSinCtaCte(false)}
        >
          {/* El texto va TEXTUAL, sin agregarle nada: es el mensaje que fija el requerimiento. */}
          {MSG_SIN_CTA_CTE}
        </AvisoModal>
      )}
    </section>
  )
}
