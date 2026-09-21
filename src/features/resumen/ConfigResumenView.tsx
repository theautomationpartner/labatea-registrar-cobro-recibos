import { useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import {
  descripcionDePaso,
  etiquetaDePaso,
  numeroDePaso,
  pasoAnterior,
  siguientePaso,
} from '@/lib/pasos'
import { MSG_PERIODO, MSG_SIN_ESTADO_CTA_CTE, periodoDelCriterio } from '@/lib/resumenCtaCte'
import { claveMovimientosCtaCte, criterioResumen } from '@/state/appState'
import { useApp, useDispatch } from '@/state/hooks'
import { ConfigResumenCtaCte, type BusquedaResumen } from './ConfigResumenCtaCte'
import { useFacturasAdeudadas } from './useFacturasAdeudadas'
import { useMovimientosCtaCte } from './useMovimientosCtaCte'

/**
 * RESUMEN DE CTA CTE · paso 2: cómo se arma el resumen del cliente que se eligió en el paso 1.
 *
 * Es una etapa propia y no un bloque del buscador porque es una DECISIÓN de la operación, del mismo
 * rango que elegir las facturas de un cobro: define qué va a decir el documento.
 *
 * Y es acá donde se CONSULTA la cuenta, con el botón "Confirmar": salen las dos lecturas
 * que arman los documentos —los movimientos del período y, si el resumen lleva el estado de la
 * cuenta, las facturas que el cliente debe—. No se avanza hasta que contestaron: la etapa siguiente
 * muestra ESE resultado, así que entrar antes sería entrar a un documento en blanco.
 */
export function ConfigResumenView() {
  const state = useApp()
  const {
    cliente,
    tipoOperacion,
    resumenEstadoCtaCte,
    resumenBusquedaPedida,
    movimientosCtaCte,
    facturasAdeudadas,
    ctaCteId,
  } = state
  const dispatch = useDispatch()

  const { periodo, problema } = periodoDelCriterio(criterioResumen(state))
  const incluyeEstado = resumenEstadoCtaCte === 'INCLUIR'
  /* La clave de ESTA búsqueda: cliente + las dos puntas del período. Es la que pide el botón y la
     que después identifica a la lista en la caché. */
  const clave = cliente && periodo ? claveMovimientosCtaCte(cliente.id, periodo) : null
  const pedida = clave !== null && resumenBusquedaPedida === clave

  /* Las dos lecturas. La de facturas SÓLO si el resumen las va a mostrar: sin el estado de la cuenta
     no hay documento que las liste, y no se le pide al tablero una lista que nadie va a ver. */
  const lecturaMovimientos = useMovimientosCtaCte()
  const lecturaFacturas = useFacturasAdeudadas(pedida && incluyeEstado)

  const [marcarPeriodo, setMarcarPeriodo] = useState(false)
  const [marcarEstado, setMarcarEstado] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  const destino = siguientePaso('configResumen', tipoOperacion)
  const anterior = pasoAnterior('configResumen', tipoOperacion)
  const SIGUIENTE_PASO = destino ? etiquetaDePaso(destino, tipoOperacion) : ''

  /* En qué anda la búsqueda, mirando las DOS lecturas como una sola: es una sola acción del usuario
     y por eso se reporta como un solo estado. */
  const buscando = lecturaMovimientos.cargando || (incluyeEstado && lecturaFacturas.cargando)
  const fallo = lecturaMovimientos.fallo || (incluyeEstado && lecturaFacturas.fallo)
  const listo = lecturaMovimientos.listo && (!incluyeEstado || lecturaFacturas.listo)
  const sinCuenta = lecturaMovimientos.listo && ctaCteId === null

  /* Qué falta ANTES de poder buscar: el período y la respuesta sobre el estado de la cuenta. Es la
     misma exigencia que tiene el avance, así que la regla se escribe una sola vez. */
  const faltaParaBuscar = (): string | null => {
    if (problema) {
      setMarcarPeriodo(true)
      return MSG_PERIODO[problema]
    }
    if (!resumenEstadoCtaCte) {
      setMarcarEstado(true)
      return MSG_SIN_ESTADO_CTA_CTE
    }
    return null
  }

  const buscar = () => {
    const falta = faltaParaBuscar()
    if (falta) {
      setAviso(falta)
      return
    }
    if (clave) dispatch({ type: 'pedirBusquedaResumen', clave })
  }

  const busqueda: BusquedaResumen = {
    estado: fallo ? 'fallo' : buscando ? 'buscando' : listo ? 'listo' : 'idle',
    movimientos: movimientosCtaCte.length,
    comprobantes: incluyeEstado ? facturasAdeudadas.length : null,
    sinCuenta,
    onBuscar: buscar,
    onReintentar: () => {
      lecturaMovimientos.reintentar()
      lecturaFacturas.reintentar()
    },
  }

  const continuar = () => {
    const falta = faltaParaBuscar()
    if (falta) {
      setAviso(falta)
      return
    }
    /* Y recién con la búsqueda contestada: la etapa siguiente muestra ESE resultado. */
    if (!pedida) {
      setAviso(
        'Todavía no se buscaron los movimientos de la cuenta corriente. Confirmá el formulario y, cuando la búsqueda termine, continuá.',
      )
      return
    }
    if (buscando) {
      setAviso(
        'La búsqueda de los movimientos todavía está en curso. Esperá a que termine y volvé a intentar.',
      )
      return
    }
    if (fallo) {
      setAviso(
        'No se pudo leer la cuenta corriente del cliente. Usá Reintentar y, cuando la búsqueda termine, continuá.',
      )
      return
    }
    if (sinCuenta) {
      setAviso(
        'El cliente no tiene una cuenta corriente asignada en el tablero de Personas, así que no hay movimientos con los que armar el resumen. Asignásela y volvé a reintentar.',
      )
      return
    }
    if (destino) dispatch({ type: 'goto', paso: destino })
  }

  /* Por qué todavía no se puede avanzar. Se muestra en el pie, al lado del botón. */
  const motivoBloqueo = !cliente
    ? 'Volvé al paso 1 para elegir el cliente'
    : problema
      ? 'Indicá qué movimientos de la cuenta corriente entran en el resumen'
      : !resumenEstadoCtaCte
        ? 'Indicá si el resumen incluye el estado de la cuenta corriente para continuar'
        : !pedida
          ? 'Buscá los movimientos de la cuenta corriente para continuar'
          : buscando
            ? 'Esperá a que termine la búsqueda de los movimientos'
            : fallo
              ? 'No se pudo leer la cuenta corriente: reintentá la búsqueda'
              : sinCuenta
                ? 'El cliente no tiene una cuenta corriente asignada'
                : undefined

  return (
    /* `cobro-v2` es el marco de las etapas intermedias: de ahí salen el pie con sus botones y el
       aviso de lo que falta. `resumen-v2` es lo propio de esta operación. */
    <section className="view cobro-v2 resumen-v2 paso-layout">
      <PasoHeader />

      <div className="paso-body">
        <PasoTitulo
          numero={numeroDePaso('configResumen', tipoOperacion)}
          titulo={etiquetaDePaso('configResumen', tipoOperacion)}
          descripcion={descripcionDePaso('configResumen', tipoOperacion)}
        />

        {!cliente ? (
          <div className="card rec-vacio">
            <i className="fas fa-user-slash" /> Todavía no hay un cliente seleccionado. Volvé al paso
            1 para elegirlo.
          </div>
        ) : (
          <ConfigResumenCtaCte
            marcarPeriodo={marcarPeriodo}
            marcarEstado={marcarEstado}
            busqueda={busqueda}
          />
        )}

        <div className="actions-footer">
          <button
            type="button"
            className="btn btn-out"
            onClick={() => anterior && dispatch({ type: 'goto', paso: anterior })}
          >
            <i className="fas fa-arrow-left" /> Volver
          </button>

          <div className="actions-footer-fin">
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
            {/* El botón NO se apaga: si falta algo, la ventana lo explica al hacer click. */}
            <button type="button" className="btn btn-primary" onClick={continuar}>
              Continuar a {SIGUIENTE_PASO} <i className="fas fa-arrow-right" />
            </button>
          </div>
        </div>
      </div>

      {aviso && (
        <AvisoModal titulo="Falta completar el formulario" onClose={() => setAviso(null)}>
          {aviso}
        </AvisoModal>
      )}
    </section>
  )
}
