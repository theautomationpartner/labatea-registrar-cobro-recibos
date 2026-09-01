import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { TablaAnticipos } from '@/features/anticipos/TablaAnticipos'
import { CabeceraCobro, ROTULOS_CABECERA_PAGO } from '@/features/cobro/CabeceraCobro'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { bloqueoAplicacion, totalACancelar, totalAplicado } from '@/lib/cobros'
import { round2 } from '@/lib/format'
import {
  descripcionDePasoPago,
  etiquetaDePasoPago,
  numeroDePasoPago,
  pasoAnteriorPago,
  siguientePasoPago,
} from '@/lib/pasosPago'
import { getAnticiposProveedor } from '@/services/monday'
import { useApp, useDispatch } from '@/state/hooks'

/**
 * Etapa 3 del recorrido "Aplicación Anticipo contra Facturas de Compra": con qué saldo a favor se
 * cancelan las facturas elegidas en la etapa 2.
 *
 * Ocupa el mismo lugar que "Registrar Pagos" y comparte su gramática —la cabecera con las tres
 * métricas y el bloque de registro debajo—, pero el dinero no sale por una caja: sale de los
 * anticipos que ya le habíamos entregado al proveedor. Por eso el TOTAL PAGADO es lo aplicado, y la
 * DIFERENCIA tiene que quedar en CERO ABSOLUTO para poder emitir la orden.
 *
 * Es el espejo de `AnticiposView` del lado de los cobros, y reutiliza sus dos piezas: la tabla de
 * anticipos —tal cual, sin un solo cambio, porque escribe sobre el mismo estado— y la cabecera de
 * totales con los rótulos del egreso.
 */
export function AplicarAnticipoView() {
  const { proveedor, imputacionesPago, anticipos, aplicaciones, tipoOperacionPago, anticiposClienteId } =
    useApp()
  const dispatch = useDispatch()
  /* Con la lista ya leída para este proveedor no hay espera que mostrar: el paso arranca con los
     datos puestos, sin el parpadeo del esqueleto de carga. */
  const enCache = !!proveedor && anticiposClienteId === proveedor.id
  const [cargando, setCargando] = useState(!enCache)
  // Motivo por el que no se puede avanzar, mostrado al intentarlo.
  const [aviso, setAviso] = useState<ReturnType<typeof bloqueoAplicacion>>(null)

  /* El paso sigue montado. Lo miran las respuestas que llegan tarde: si el usuario ya se fue, no
     tienen a quién escribirle. Es una ref y no una bandera local porque la consulta también se
     dispara desde el botón de reintentar, o sea fuera de todo efecto y sin limpieza que la apague. */
  const montado = useRef(true)
  useEffect(() => {
    montado.current = true
    return () => {
      montado.current = false
    }
  }, [])

  /**
   * Consulta los anticipos del proveedor y los deja en el estado global. Es la ÚNICA lectura del
   * paso: la usan igual la carga inicial y el reintento manual, así que las dos guardan el mismo
   * resultado, cachean con la misma clave y tratan el error de la misma manera.
   */
  const consultar = useCallback(
    (proveedorId: string) => {
      setCargando(true)
      getAnticiposProveedor(proveedorId)
        .then((as) => {
          if (!montado.current) return
          // El id queda como clave de caché: a partir de acá el paso no vuelve a consultar solo.
          dispatch({ type: 'setAnticipos', anticipos: as, clienteId: proveedorId })
          setCargando(false)
        })
        .catch(() => {
          if (!montado.current) return
          /* Sin clave de caché (`null`): un error NO se cachea, así volver a entrar al paso
             reintenta la lectura en vez de dejar al proveedor sin anticipos para siempre. */
          dispatch({ type: 'setAnticipos', anticipos: [], clienteId: null })
          dispatch({ type: 'errorMonday', accion: 'obtener los anticipos del proveedor' })
          setCargando(false)
        })
    },
    [dispatch],
  )

  /* Se leen UNA sola vez por proveedor y quedan cacheados en el estado global: volver al paso desde
     el stepper no vuelve a consultar a Monday. La lectura se rehace sólo cuando cambia el proveedor,
     cuando cambia qué se está pagando o al empezar una operación nueva. */
  useEffect(() => {
    if (!proveedor) {
      setCargando(false)
      return
    }
    // Ya están leídos para ESTE proveedor: se reusa lo que hay en el estado.
    if (anticiposClienteId === proveedor.id) {
      setCargando(false)
      return
    }
    consultar(proveedor.id)
  }, [proveedor, anticiposClienteId, consultar])

  // TOTAL A PAGAR: lo imputado a las facturas en la etapa 2. Acá no se recalcula nada.
  const aPagar = totalACancelar(imputacionesPago)
  // TOTAL PAGADO: lo que el usuario decide aplicar de los saldos a favor.
  const aplicado = totalAplicado(aplicaciones)
  const diferencia = round2(aPagar - aplicado)

  /* El resumen que consume la cabecera es el MISMO contrato que el del pago con dinero: lo aplicado
     ocupa el lugar de lo entregado. */
  const resumen = useMemo(
    () => ({ totalACancelar: aPagar, totalRecibido: aplicado, diferencia }),
    [aPagar, aplicado, diferencia],
  )

  /**
   * Vuelve a preguntarle a Monday, salteando la caché del paso. Se llama a `consultar` directo y no
   * se invalida la clave: invalidarla dispararía el efecto, y el efecto y el click terminarían
   * pidiendo lo mismo dos veces.
   */
  const reintentar = () => {
    if (cargando || !proveedor) return
    consultar(proveedor.id)
  }

  /* Las reglas de la aplicación son las MISMAS que en Cobros —al menos un anticipo elegido, todos
     con importe mayor a 0, ninguno por encima de su saldo y la diferencia en cero absoluto—, así
     que se validan con la misma función: "cuánto de este saldo se imputa" es la misma pregunta se
     cobre o se pague. */
  const bloqueo = bloqueoAplicacion(anticipos, aplicaciones, aPagar)
  const destino = siguientePasoPago('pago', tipoOperacionPago)
  const anterior = pasoAnteriorPago('pago', tipoOperacionPago)
  const SIGUIENTE = destino ? etiquetaDePasoPago(destino, tipoOperacionPago) : ''

  /**
   * Avanza, o EXPLICA por qué no se puede. El botón no se apaga, y al intentarlo se abre la ventana
   * con lo que falta —y con QUÉ anticipo—. Un control muerto no dice nada; acá hay hasta cuatro
   * motivos distintos por los que el paso no cierra, y el usuario tiene que saber cuál le tocó.
   */
  const continuar = () => {
    if (bloqueo) {
      setAviso(bloqueo)
      return
    }
    dispatch({ type: 'confirmarPago' })
    if (destino) dispatch({ type: 'gotoPago', paso: destino })
  }

  return (
    <section className="view cobro-v2 anticipos-v2 paso-layout">
      <PasoHeader />

      <div className="paso-body">
        <PasoTitulo
          numero={numeroDePasoPago('pago', tipoOperacionPago)}
          titulo={etiquetaDePasoPago('pago', tipoOperacionPago)}
          descripcion={descripcionDePasoPago('pago', tipoOperacionPago)}
        />

        {!proveedor ? (
          <div className="cobro-static">
            <div className="cobro-card">
              <p className="cobro-vacio">
                <i className="fas fa-user-slash" /> Todavía no hay un proveedor seleccionado. Volvé
                al paso 1 para elegirlo.
              </p>
            </div>
          </div>
        ) : (
          <div className="cobro-static">
            <CabeceraCobro
              cliente={proveedor}
              resumen={resumen}
              facturas={Object.keys(imputacionesPago).length}
              rotulos={ROTULOS_CABECERA_PAGO}
              /* La aplicación exige CERO ABSOLUTO, igual que del lado de los cobros: los dos lados
                 de la cuenta son saldos del sistema, así que si no cierran el que está mal es el
                 dato. */
              saldada={diferencia === 0}
            />

            <div className="cobro-card">
              <h3 className="cobro-card-title">Anticipos disponibles</h3>
              <p className="cobro-card-desc">
                Saldos a favor con el proveedor pendientes de aplicar. Elegí con cuáles se cancelan
                las facturas de compra seleccionadas.
              </p>

              {cargando ? (
                <p className="cobro-vacio">
                  <i className="fas fa-spinner fa-spin" /> Buscando los anticipos del proveedor...
                </p>
              ) : anticipos.length === 0 ? (
                /* SIN resultados. El reintento vive acá y en ningún otro lado: con anticipos en
                   pantalla no hay nada que volver a buscar. Existe porque el anticipo puede tardar
                   en aparecer —el ítem del tablero lo crea una automatización DESPUÉS de que se
                   registra la orden—, así que una lista vacía no siempre significa "no tiene": a
                   veces significa "todavía no". */
                <p className="cobro-vacio">
                  <i className="fas fa-circle-info" /> <strong>{proveedor.name}</strong> no tiene
                  anticipos pendientes de aplicar.
                  <button type="button" className="cobro-reintentar" onClick={reintentar}>
                    Volver a intentar
                  </button>
                </p>
              ) : (
                /* La MISMA tabla que aplica los anticipos de un cliente, sin un solo cambio: escribe
                   sobre las mismas claves del estado, y los dos circuitos nunca conviven. */
                <TablaAnticipos
                  anticipos={anticipos}
                  aplicaciones={aplicaciones}
                  /* Cubierto = ya no falta nada por aplicar. Con el paso recién abierto (nada
                     imputado y nada aplicado) NO se considera cubierto: ahí no hay nada que cubrir. */
                  cubierto={aplicado > 0 && diferencia <= 0}
                />
              )}

              {/* Mismo renglón de avisos que el paso de pago: reserva su lugar, aparezca o no. */}
              <div className="cobro-card-acts">
                {/* Siempre en ROJO, falte o sobre: acá la diferencia distinta de cero no es "el
                    próximo paso" como en un pago con dinero, es lo único que impide emitir la orden.
                    Se muestra el MENSAJE y no el título, que es el rótulo corto de la ventana. */}
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
            onClick={() => anterior && dispatch({ type: 'gotoPago', paso: anterior })}
          >
            <i className="fas fa-arrow-left" /> Volver
          </button>

          <div className="actions-footer-fin">
            <span className={`paso-siguiente ${bloqueo ? 'paso-siguiente--bloqueo' : ''}`}>
              {bloqueo ? (
                <>
                  <i className="fas fa-circle-exclamation" /> {bloqueo.titulo}
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
      </div>

      {aviso && (
        <AvisoModal titulo={aviso.titulo} faltantes={aviso.faltantes} onClose={() => setAviso(null)}>
          {aviso.mensaje}
        </AvisoModal>
      )}
    </section>
  )
}
