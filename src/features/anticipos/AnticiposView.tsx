import { useEffect, useMemo, useState } from 'react'
import { CabeceraCobro } from '@/features/cobro/CabeceraCobro'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { bloqueoAplicacion, totalACancelar, totalAplicado } from '@/lib/cobros'
import { round2 } from '@/lib/format'
import {
  descripcionDePaso,
  etiquetaDePaso,
  numeroDePaso,
  pasoAnterior,
  siguientePaso,
} from '@/lib/pasos'
import { getAnticiposPendientes } from '@/services/monday'
import { useApp, useDispatch } from '@/state/hooks'
import { TablaAnticipos } from './TablaAnticipos'

/**
 * Paso 3 del recorrido "Aplicar Anticipo contra Facturas": con qué saldo a favor se cancelan las
 * facturas elegidas en el paso 2.
 *
 * Ocupa el mismo lugar que "Registrar Cobro" y comparte su gramática —la cabecera con las tres
 * métricas y el bloque de registro debajo—, pero el dinero no entra por una forma de pago: sale de
 * los anticipos que el cliente ya tiene registrados. Por eso el TOTAL RECIBIDO es lo aplicado, y la
 * DIFERENCIA tiene que quedar en CERO ABSOLUTO para poder emitir el recibo.
 */
export function AnticiposView() {
  const { cliente, imputaciones, anticipos, aplicaciones, tipoOperacion, anticiposClienteId } =
    useApp()
  const dispatch = useDispatch()
  /* Con la lista ya leída para este cliente no hay espera que mostrar: el paso arranca con los
     datos puestos, sin el parpadeo del esqueleto de carga. */
  const enCache = !!cliente && anticiposClienteId === cliente.id
  const [cargando, setCargando] = useState(!enCache)

  /* Los anticipos se leen UNA sola vez por cliente y quedan cacheados en el estado global
     (`anticiposClienteId`): volver al paso desde el stepper no vuelve a consultar a Monday. La
     lectura se rehace sólo cuando cambia el cliente, cuando cambia qué se está cobrando o al
     empezar una operación nueva. Lo ya aplicado se conserva si el anticipo sigue estando (ver
     `setAnticipos`). */
  useEffect(() => {
    if (!cliente) {
      setCargando(false)
      return
    }
    // Ya están leídos para ESTE cliente: se reusa lo que hay en el estado.
    if (anticiposClienteId === cliente.id) {
      setCargando(false)
      return
    }
    let vivo = true
    setCargando(true)
    getAnticiposPendientes(cliente.id)
      .then((as) => {
        if (!vivo) return
        // El id queda como clave de caché: a partir de acá el paso no vuelve a consultar.
        dispatch({ type: 'setAnticipos', anticipos: as, clienteId: cliente.id })
        setCargando(false)
      })
      .catch(() => {
        if (!vivo) return
        /* Sin clave de caché (`null`): un error NO se cachea, así volver a entrar al paso
           reintenta la lectura en vez de dejar al cliente sin anticipos para siempre. */
        dispatch({ type: 'setAnticipos', anticipos: [], clienteId: null })
        dispatch({ type: 'errorMonday', accion: 'obtener los anticipos del cliente' })
        setCargando(false)
      })
    return () => {
      vivo = false
    }
  }, [cliente, anticiposClienteId, dispatch])

  // TOTAL A CANCELAR: lo imputado a las facturas en el paso 2. Acá no se recalcula nada.
  const aCancelar = totalACancelar(imputaciones)
  // TOTAL CANCELADO: lo que el usuario decide aplicar de los saldos a favor.
  const aplicado = totalAplicado(aplicaciones)
  const diferencia = round2(aCancelar - aplicado)

  /* El resumen que consume la cabecera es el MISMO contrato que el del cobro con dinero: lo
     aplicado ocupa el lugar de lo recibido. */
  const resumen = useMemo(
    () => ({ totalACancelar: aCancelar, totalRecibido: aplicado, diferencia }),
    [aCancelar, aplicado, diferencia],
  )

  const bloqueo = bloqueoAplicacion(anticipos, aplicaciones, aCancelar)
  const destino = siguientePaso('cobro', tipoOperacion)
  const anterior = pasoAnterior('cobro', tipoOperacion)
  const SIGUIENTE_PASO = destino ? etiquetaDePaso(destino, tipoOperacion) : ''

  const continuar = () => {
    // Resguardo: con bloqueo el botón está deshabilitado, así que acá no se llega.
    if (bloqueo) return
    dispatch({ type: 'confirmarCobro' })
    if (destino) dispatch({ type: 'goto', paso: destino })
  }

  return (
    <section className="view cobro-v2 anticipos-v2 paso-layout">
      <PasoHeader />

      <div className="paso-body">
        <PasoTitulo
          numero={numeroDePaso('cobro', tipoOperacion)}
          titulo={etiquetaDePaso('cobro', tipoOperacion)}
          descripcion={descripcionDePaso('cobro', tipoOperacion)}
        />

        {!cliente ? (
          <div className="cobro-static">
            <div className="cobro-card">
              <p className="cobro-vacio">
                <i className="fas fa-user-slash" /> Todavía no hay un cliente seleccionado. Volvé al
                paso 1 para elegirlo.
              </p>
            </div>
          </div>
        ) : (
          <div className="cobro-static">
            <CabeceraCobro cliente={cliente} resumen={resumen} facturas={null} />

            <div className="cobro-card">
              <h3 className="cobro-card-title">Anticipos disponibles</h3>
              <p className="cobro-card-desc">
                Saldos a favor del cliente pendientes de aplicar. Elegí con cuáles se cancelan las
                facturas seleccionadas.
              </p>

              {cargando ? (
                <p className="cobro-vacio">
                  <i className="fas fa-spinner fa-spin" /> Buscando los anticipos del cliente...
                </p>
              ) : anticipos.length === 0 ? (
                <p className="cobro-vacio">
                  <i className="fas fa-circle-info" /> <strong>{cliente.name}</strong> no tiene
                  anticipos pendientes de aplicar.
                </p>
              ) : (
                <TablaAnticipos
                  anticipos={anticipos}
                  aplicaciones={aplicaciones}
                  /* Cubierto = ya no falta nada por aplicar. Con el paso recién abierto (nada
                     imputado y nada aplicado) NO se considera cubierto: ahí no hay nada que cubrir. */
                  cubierto={aplicado > 0 && diferencia <= 0}
                />
              )}

              {/* Mismo renglón de avisos que el paso de cobro: reserva su lugar, aparezca o no. */}
              <div className="cobro-card-acts">
                {bloqueo && (
                  <span
                    className={`cobro-bloqueo-inline ${
                      diferencia > 0 ? 'cobro-bloqueo-inline--info' : ''
                    }`}
                  >
                    <i
                      className={`fas ${diferencia > 0 ? 'fa-circle-info' : 'fa-circle-exclamation'}`}
                    />{' '}
                    {bloqueo.titulo}
                  </span>
                )}
              </div>
            </div>
          </div>
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
            {/* Sin renglón de anticipo ni de motivo al lado del botón: el ÚNICO lugar donde el paso
                da feedback es la franja que cierra la card, arriba. Repetirlo acá era decir dos
                veces lo mismo, y en el pie quedaba lejos de lo que hay que corregir.

                El botón se deshabilita: el recibo de una aplicación no puede emitirse con la
                diferencia distinta de cero, así que no se ofrece una acción que nunca va a
                proceder. El motivo viaja en el `title`, para que el apagado no sea mudo. */}
            <button
              type="button"
              className="btn btn-primary"
              disabled={!!bloqueo}
              title={bloqueo?.mensaje}
              onClick={continuar}
            >
              Continuar a {SIGUIENTE_PASO} <i className="fas fa-arrow-right" />
            </button>
          </div>
        </div>
      </div>

    </section>
  )
}
