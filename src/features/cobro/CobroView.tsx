import { useMemo, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { totalACancelar } from '@/lib/cobros'
import { money } from '@/lib/format'
import {
  bloqueoCobro,
  chequeBloqueado,
  diferenciaEnCero,
  resumenCobro,
  type BloqueoCobro,
} from '@/lib/pagos'
import { DESCRIPCION, ETAPA, numeroDePaso } from '@/lib/pasos'
import { useApp, useDispatch } from '@/state/hooks'
import { CabeceraCobro } from './CabeceraCobro'
import { FormularioCobro } from './FormularioCobro'
import { TablaMovimientos } from './TablaMovimientos'

/** Qué viene después de registrar el cobro. Sale de `lib/pasos`, no de un texto suelto. */
const SIGUIENTE_PASO = ETAPA.recibo

/**
 * Paso 3: con qué medios paga el cliente lo que se imputó en el paso anterior.
 *
 * El total a cancelar NO se calcula acá: llega de la imputación (`totalACancelar`), el mismo
 * selector que muestra el pie del paso 2. Lo que esta etapa decide es una sola cosa —que lo
 * recibido lo iguale exactamente— y esa es la única condición para avanzar.
 */
export function CobroView() {
  const { cliente, imputaciones, cobro } = useApp()
  const dispatch = useDispatch()
  // Motivo por el que no se puede avanzar, mostrado al intentarlo.
  const [aviso, setAviso] = useState<BloqueoCobro | null>(null)

  const total = totalACancelar(imputaciones)
  const facturasElegidas = Object.keys(imputaciones).length
  const resumen = useMemo(
    () => resumenCobro(cobro.movimientos, total),
    [cobro.movimientos, total],
  )
  const bloqueo = bloqueoCobro(cobro.movimientos, resumen)

  const continuar = () => {
    /* El botón NUNCA se apaga: si algo falta, la ventana dice exactamente qué, en vez de dejar un
       botón muerto que el usuario no sabe por qué no responde. */
    if (bloqueo) {
      setAviso(bloqueo)
      return
    }
    dispatch({ type: 'confirmarCobro' })
    dispatch({ type: 'goto', paso: 'recibo' })
  }

  /* Aviso en vivo dentro de la card: por qué el cobro todavía no cierra. Con la carga vacía no se
     dice nada —el usuario recién empieza—; el pie del paso ya anticipa que falta registrarlo. */
  const hint =
    cobro.movimientos.length > 0 && !diferenciaEnCero(resumen)
      ? resumen.diferencia > 0
        ? `Todavía faltan ${money(resumen.diferencia)} para igualar el total a cancelar.`
        : `El total recibido supera el total a cancelar en ${money(-resumen.diferencia)}: ajustá los importes.`
      : null

  return (
    <section className="view cobro-v2 paso-layout">
      <PasoHeader />

      <div className="paso-body">
        <PasoTitulo
          numero={numeroDePaso('cobro')}
          titulo={ETAPA.cobro}
          descripcion={DESCRIPCION.cobro}
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
            <CabeceraCobro cliente={cliente} resumen={resumen} facturas={facturasElegidas} />

            <div className="cobro-card">
              <h3 className="cobro-card-title">Registrar cobro</h3>
              <p className="cobro-card-desc">Especificar cómo pagó el cliente</p>

              {/* El CRM del cliente puede vedar el cheque ("Recibimos CHEQUE" = NO). */}
              <FormularioCobro
                chequeBloqueado={chequeBloqueado(cliente)}
                diferencia={resumen.diferencia}
                bloqueado={false}
              />

              <h4 className="cobro-card-sub">Cobros registrados ({cobro.movimientos.length})</h4>
              <TablaMovimientos movimientos={cobro.movimientos} />

              {hint && (
                <div className="cobro-card-acts">
                  <span className="cobro-bloqueo-inline">
                    <i className="fas fa-circle-exclamation" /> {hint}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="actions-footer">
          {/* Volver no descarta nada: los movimientos viven en el estado y siguen cargados al
              volver a entrar. Lo único que se reabre es la confirmación, si cambia la imputación. */}
          <button
            type="button"
            className="btn btn-out"
            onClick={() => dispatch({ type: 'goto', paso: 'ventas' })}
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
                  <i className="fas fa-arrow-turn-up paso-siguiente-ic" /> Siguiente:{' '}
                  {SIGUIENTE_PASO}
                </>
              )}
            </span>
            <button type="button" className="btn btn-primary" onClick={continuar}>
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
