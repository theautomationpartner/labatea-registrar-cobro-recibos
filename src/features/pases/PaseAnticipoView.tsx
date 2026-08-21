import { useEffect, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { totalAplicado } from '@/lib/cobros'
import { bloqueoDePases } from '@/lib/pases'
import { money } from '@/lib/format'
import {
  descripcionDePaso,
  etiquetaDePaso,
  numeroDePaso,
  pasoAnterior,
  siguientePaso,
} from '@/lib/pasos'
import { getAnticiposPendientes } from '@/services/monday'
import { useApp, useDispatch } from '@/state/hooks'
import { TablaAnticiposPase } from './TablaAnticiposPase'

/**
 * PASES DE SALDO · paso 2: qué saldo se mueve.
 *
 * Lista los anticipos del cliente ORIGEN con la misma lectura cacheada que usa la aplicación de
 * anticipos, y con SU MISMA tabla (ver `TablaAnticiposPase`): es la misma pregunta —de qué saldo a
 * favor se dispone y cuánto se usa— hecha en otro recorrido.
 *
 * Lo único propio del pase es que se elige UN anticipo: mueve saldo de uno a una cuenta, no reparte
 * entre varios. El importe nace en el saldo completo y queda editable para pasar menos.
 */
export function PaseAnticipoView() {
  const { cliente, anticipos, anticiposClienteId, pasesDeAnticipo, tipoOperacion } = useApp()
  const dispatch = useDispatch()
  const enCache = !!cliente && anticiposClienteId === cliente.id
  const [cargando, setCargando] = useState(!enCache)
  // Motivo por el que no se puede avanzar, mostrado al intentarlo.
  const [aviso, setAviso] = useState<ReturnType<typeof bloqueoDePases>>(null)

  /* Misma caché por cliente que el resto de la app: volver con el stepper no vuelve a consultar. */
  useEffect(() => {
    if (!cliente) {
      setCargando(false)
      return
    }
    if (anticiposClienteId === cliente.id) {
      setCargando(false)
      return
    }
    let vivo = true
    setCargando(true)
    getAnticiposPendientes(cliente.id)
      .then((as) => {
        if (!vivo) return
        dispatch({ type: 'setAnticipos', anticipos: as, clienteId: cliente.id })
        setCargando(false)
      })
      .catch(() => {
        if (!vivo) return
        dispatch({ type: 'setAnticipos', anticipos: [], clienteId: null })
        dispatch({ type: 'errorMonday', accion: 'obtener los anticipos del cliente' })
        setCargando(false)
      })
    return () => {
      vivo = false
    }
  }, [cliente, anticiposClienteId, dispatch])

  const destino = siguientePaso('anticipoOrigen', tipoOperacion)
  const anterior = pasoAnterior('anticipoOrigen', tipoOperacion)
  const SIGUIENTE_PASO = destino ? etiquetaDePaso(destino, tipoOperacion) : ''
  /* Lo que suman los anticipos marcados: ESE total es lo que se debita de la cuenta origen. */
  const totalAPasar = totalAplicado(pasesDeAnticipo)
  /* Qué impide avanzar. La MISMA regla que pinta de rojo el campo de la tabla, así que el borde y
     la ventana no pueden decir cosas distintas. */
  const bloqueo = bloqueoDePases(anticipos, pasesDeAnticipo)

  return (
    <section className="view cobro-v2 anticipos-v2 pases-v2 paso-layout">
      <PasoHeader />

      <div className="paso-body">
        <PasoTitulo
          numero={numeroDePaso('anticipoOrigen', tipoOperacion)}
          titulo={etiquetaDePaso('anticipoOrigen', tipoOperacion)}
          descripcion={descripcionDePaso('anticipoOrigen', tipoOperacion)}
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
            <div className="cobro-card">
              <h3 className="cobro-card-title">Anticipos de {cliente.name}</h3>
              <p className="cobro-card-desc">
                Elegí los anticipos cuyo saldo se va a pasar a otra cuenta e indicá cuánto se pasa
                de cada uno. Lo que sumen es el total que se debita.
              </p>

              {cargando ? (
                <p className="cobro-vacio">
                  <i className="fas fa-spinner fa-spin" /> Buscando los anticipos del cliente...
                </p>
              ) : anticipos.length === 0 ? (
                <p className="cobro-vacio">
                  <i className="fas fa-circle-info" /> <strong>{cliente.name}</strong> no tiene
                  anticipos pendientes de aplicar, así que no hay saldo para pasar.
                </p>
              ) : (
                <TablaAnticiposPase anticipos={anticipos} />
              )}

              {/* Pie de la card: UN solo renglón para las dos cosas que el paso tiene para decir,
                  porque son excluyentes por definición —`bloqueo` es exactamente "todavía no hay un
                  pase armado"—. O falta algo, o el pase ya está resuelto y se resume.

                  Que compartan lugar es lo que mantiene quieta la pantalla: el renglón tiene su alto
                  reservado (`.cobro-card-acts`), así que pasar de un mensaje al otro no cambia el
                  alto de la card ni empuja los botones de abajo. Antes el resumen vivía suelto sobre
                  este renglón y aparecía y desaparecía moviendo todo lo que tenía debajo.

                  El resumen no repite el detalle —fecha, importe original, restante—: eso ya está en
                  la tabla, y decirlo dos veces en la misma pantalla no agrega nada. */}
              <div className="cobro-card-acts">
                {bloqueo ? (
                  /* El MENSAJE, no el título: es el que dice qué hay que corregir. El título es
                     el rótulo corto de la ventana, y acá no alcanzaba —"El importe supera el saldo
                     del anticipo" nombra el problema pero no el límite contra el que se choca—. */
                  <span className="cobro-bloqueo-inline">
                    <i className="fas fa-circle-exclamation" /> {bloqueo.mensaje}
                  </span>
                ) : (
                  <span className="pase-resumen-linea">
                    <i className="fas fa-arrow-right-arrow-left" /> Se debitarán{' '}
                    <strong>{money(totalAPasar)}</strong> pesos de la cuenta
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
            {/* El botón NO se apaga: si algo falta, la ventana dice exactamente qué —y con cuál
                anticipo—, en vez de dejar un control muerto que no explica nada. */}
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                if (bloqueo) {
                  setAviso(bloqueo)
                  return
                }
                if (destino) dispatch({ type: 'goto', paso: destino })
              }}
            >
              Continuar a {SIGUIENTE_PASO} <i className="fas fa-arrow-right" />
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
