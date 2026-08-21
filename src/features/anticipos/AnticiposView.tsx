import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
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
  // Motivo por el que no se puede avanzar, mostrado al intentarlo.
  const [aviso, setAviso] = useState<ReturnType<typeof bloqueoAplicacion>>(null)

  /* El paso sigue montado. Lo miran las respuestas que llegan tarde: si el usuario ya se fue, no
     tienen a quién escribirle. Es una ref y no la bandera local que había antes porque la consulta
     ahora también se dispara desde el botón de reintentar, o sea fuera de todo efecto y sin
     limpieza que la apague. */
  const montado = useRef(true)
  useEffect(() => {
    montado.current = true
    return () => {
      montado.current = false
    }
  }, [])

  /**
   * Consulta los anticipos del cliente y los deja en el estado global. Es la ÚNICA lectura del
   * paso: la usan igual la carga inicial y el reintento manual, así que las dos guardan el mismo
   * resultado, cachean con la misma clave y tratan el error de la misma manera.
   */
  const consultar = useCallback(
    (clienteId: string) => {
      setCargando(true)
      getAnticiposPendientes(clienteId)
        .then((as) => {
          if (!montado.current) return
          // El id queda como clave de caché: a partir de acá el paso no vuelve a consultar solo.
          dispatch({ type: 'setAnticipos', anticipos: as, clienteId })
          setCargando(false)
        })
        .catch(() => {
          if (!montado.current) return
          /* Sin clave de caché (`null`): un error NO se cachea, así volver a entrar al paso
             reintenta la lectura en vez de dejar al cliente sin anticipos para siempre. */
          dispatch({ type: 'setAnticipos', anticipos: [], clienteId: null })
          dispatch({ type: 'errorMonday', accion: 'obtener los anticipos del cliente' })
          setCargando(false)
        })
    },
    [dispatch],
  )

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
    consultar(cliente.id)
  }, [cliente, anticiposClienteId, consultar])

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

  /**
   * Vuelve a preguntarle a Monday, salteando la caché del paso. Se llama a `consultar` directo y no
   * se invalida `anticiposClienteId`: invalidar la clave dispararía el efecto, y el efecto y el
   * click terminarían pidiendo lo mismo dos veces.
   */
  const reintentar = () => {
    if (cargando || !cliente) return
    consultar(cliente.id)
  }

  const bloqueo = bloqueoAplicacion(anticipos, aplicaciones, aCancelar)
  const destino = siguientePaso('cobro', tipoOperacion)
  const anterior = pasoAnterior('cobro', tipoOperacion)
  const SIGUIENTE_PASO = destino ? etiquetaDePaso(destino, tipoOperacion) : ''

  /**
   * Avanza, o EXPLICA por qué no se puede. Mismo criterio que el paso de anticipos de un pase: el
   * botón no se apaga, y al intentarlo se abre la ventana con lo que falta —y con QUÉ anticipo—.
   * Un control muerto no dice nada; acá hay hasta cuatro motivos distintos por los que el paso no
   * cierra, y el usuario tiene que saber cuál le tocó.
   */
  const continuar = () => {
    if (bloqueo) {
      setAviso(bloqueo)
      return
    }
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
                /* SIN resultados. El reintento vive acá y en ningún otro lado: con anticipos en
                   pantalla no hay nada que volver a buscar, y ofrecerlo invitaría a descartar lo
                   que el usuario ya viene cargando.

                   Existe porque el anticipo puede tardar en aparecer: el ítem del tablero lo crea
                   una automatización DESPUÉS de que se registra el cobro o el pase, así que una
                   lista vacía no siempre significa "no tiene" —a veces significa "todavía no"—.
                   Sin esto, el único camino era rehacer el paso para saltear la caché. */
                <p className="cobro-vacio">
                  <i className="fas fa-circle-info" /> <strong>{cliente.name}</strong> no tiene
                  anticipos pendientes de aplicar.
                  <button type="button" className="cobro-reintentar" onClick={reintentar}>
                    Volver a intentar
                  </button>
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
                {/* Siempre en ROJO, falte o sobre: acá la diferencia distinta de cero no es "el
                    próximo paso" como en un cobro, es lo único que impide emitir el recibo.

                    Se muestra el MENSAJE, no el título, igual que en el paso de un pase: el título es
                    el rótulo corto de la ventana y acá no alcanza —"El importe supera el saldo del
                    anticipo" nombra el problema pero no contra qué límite se choca ni cuánto falta—. */}
                {bloqueo && (
                  <span className="cobro-bloqueo-inline">
                    <i className="fas fa-circle-exclamation" /> {bloqueo.mensaje}
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
                da feedback en línea es la franja que cierra la card, arriba.

                El botón NO se apaga: si algo falta, la ventana dice exactamente qué —y con cuál
                anticipo—, en vez de dejar un control muerto que no explica nada. Es el mismo
                comportamiento que el paso de anticipos de un pase. */}
            <button type="button" className="btn btn-primary" onClick={continuar}>
              Continuar a {SIGUIENTE_PASO} <i className="fas fa-arrow-right" />
            </button>
          </div>
        </div>
      </div>

      {/* Lo que falta para poder emitir, con los anticipos involucrados nombrados uno por uno. */}
      {aviso && (
        <AvisoModal titulo={aviso.titulo} faltantes={aviso.faltantes} onClose={() => setAviso(null)}>
          {aviso.mensaje}
        </AvisoModal>
      )}
    </section>
  )
}
