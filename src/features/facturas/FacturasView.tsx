import { useEffect, useMemo, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import {
  bloqueoDeImputacion,
  filtrarFacturas,
  totalACancelar,
  type BloqueoImputacion,
} from '@/lib/cobros'
import { limiteCreditoAlcanzado, mensajeLimiteCredito } from '@/lib/credito'
import { money } from '@/lib/format'
import { DESCRIPCION, ETAPA, numeroDePaso } from '@/lib/pasos'
import { getFacturasPendientes } from '@/services/monday'
import { useApp, useDispatch } from '@/state/hooks'
import { FiltroFacturas } from './FiltroFacturas'
import { TablaFacturas } from './TablaFacturas'

/** Qué viene después de imputar el cobro. Sale de `lib/pasos`, no de un texto suelto. */
const SIGUIENTE_PASO = ETAPA.cobro

/**
 * Paso 2: qué facturas del cliente se cancelan con este cobro y por cuánto.
 *
 * Las facturas se releen del tablero CADA vez que se entra al paso: el saldo de una factura puede
 * haber cambiado desde otro lado (otra cobranza) y una imputación contra un saldo viejo terminaría
 * cobrando de más. Las imputaciones ya cargadas se conservan si su factura sigue pendiente.
 */
export function FacturasView() {
  const { cliente, facturas, imputaciones } = useApp()
  const dispatch = useDispatch()
  const [cargando, setCargando] = useState(true)
  // Motivo por el que no se puede avanzar, mostrado al intentarlo.
  const [aviso, setAviso] = useState<BloqueoImputacion | null>(null)
  /* Filtro por número de factura. Es sólo una VISTA sobre la lista: no toca las imputaciones, así
     que filtrar nunca descarta lo que ya se había cargado. */
  const [filtro, setFiltro] = useState('')

  useEffect(() => {
    if (!cliente) {
      setCargando(false)
      return
    }
    let vivo = true
    setCargando(true)
    getFacturasPendientes(cliente.id)
      .then((fs) => {
        if (!vivo) return
        dispatch({ type: 'setFacturas', facturas: fs })
        setCargando(false)
      })
      .catch(() => {
        if (!vivo) return
        /* El fallo lo comunica la ventana global; la lista queda vacía para no mostrar facturas
           viejas como si fueran el estado actual de la deuda. */
        dispatch({ type: 'setFacturas', facturas: [] })
        dispatch({ type: 'errorMonday', accion: 'obtener las facturas pendientes del cliente' })
        setCargando(false)
      })
    return () => {
      vivo = false
    }
  }, [cliente, dispatch])

  const visibles = useMemo(() => filtrarFacturas(facturas, filtro), [facturas, filtro])
  const total = totalACancelar(imputaciones)
  const elegidas = Object.keys(imputaciones).length
  // Facturas ya imputadas que el filtro dejó fuera de pantalla, pero siguen sumando al total.
  const ocultasElegidas = elegidas - visibles.filter((f) => f.id in imputaciones).length

  /* Línea de crédito agotada: frena el paso ANTES que cualquier problema de imputación. No depende
     de lo que se haya cargado —es una condición del cliente—, así que se avisa desde que se entra
     al paso y no recién al intentar avanzar, para no hacerle completar un formulario que no va a
     poder confirmar. */
  const bloqueoCredito: BloqueoImputacion | null =
    cliente && limiteCreditoAlcanzado(cliente)
      ? {
          titulo: 'Límite de crédito alcanzado',
          mensaje: mensajeLimiteCredito(cliente),
          faltantes: [],
        }
      : null
  const bloqueo = bloqueoCredito ?? bloqueoDeImputacion(facturas, imputaciones)

  const continuar = () => {
    /* El botón NUNCA se apaga: si falta algo, la ventana dice exactamente qué, en vez de dejar un
       botón muerto que el usuario no sabe por qué no responde. */
    if (bloqueo) {
      setAviso(bloqueo)
      return
    }
    dispatch({ type: 'goto', paso: 'cobro' })
  }

  return (
    <section className="view facturas-v2 paso-layout">
      <PasoHeader />

      <div className="paso-body">
        <PasoTitulo
          numero={numeroDePaso('ventas')}
          titulo={ETAPA.ventas}
          descripcion={DESCRIPCION.ventas}
        />

        {/* La línea agotada se avisa arriba de todo, apenas se entra al paso: es la primera cosa
            que hay que saber, no algo para descubrir al final. */}
        {bloqueoCredito && (
          <div className="fact-alerta" role="alert">
            <i className="fas fa-triangle-exclamation" />
            <div>
              <strong>{bloqueoCredito.titulo}</strong>
              <p>{bloqueoCredito.mensaje}</p>
            </div>
          </div>
        )}

        <div className="card fact-card">
          <div className="fact-card-head">
            <h2 className="fact-card-titulo">FACTURAS PENDIENTES DE CANCELAR</h2>
            <p className="fact-card-bajada">
              Seleccioná las facturas que deseás incluir en este cobro.
            </p>
          </div>

          {cargando ? (
            <p className="fact-vacio">
              <i className="fas fa-spinner fa-spin" /> Buscando las facturas pendientes del
              cliente...
            </p>
          ) : !cliente ? (
            <p className="fact-vacio">
              <i className="fas fa-user-slash" /> Todavía no hay un cliente seleccionado. Volvé al
              paso 1 para elegirlo.
            </p>
          ) : facturas.length === 0 ? (
            <p className="fact-vacio">
              <i className="fas fa-circle-check t-green" /> <strong>{cliente.name}</strong> no tiene
              facturas pendientes de cobro.
            </p>
          ) : (
            <>
              <FiltroFacturas
                valor={filtro}
                onValor={setFiltro}
                onVerTodas={() => setFiltro('')}
                hayFiltro={filtro.trim() !== ''}
              />
              {visibles.length === 0 ? (
                <p className="fact-vacio">
                  <i className="fas fa-filter-circle-xmark" /> Ninguna factura coincide con{' '}
                  <strong>«{filtro.trim()}»</strong>. Probá con otro número o volvé a la lista
                  completa con "Ver todas".
                </p>
              ) : (
                <TablaFacturas facturas={visibles} imputaciones={imputaciones} />
              )}
            </>
          )}
        </div>

        {/* TOTAL A CANCELAR: la suma de lo imputado, que es el importe del cobro a registrar. */}
        <div className={`fact-total ${total > 0 ? 'fact-total--on' : ''}`}>
          <div className="fact-total-txt">
            <span className="fact-total-lbl">TOTAL A CANCELAR</span>
            <span className="fact-total-det">
              {elegidas === 0
                ? 'Sin facturas seleccionadas'
                : `${elegidas} ${elegidas === 1 ? 'factura seleccionada' : 'facturas seleccionadas'}`}
              {/* El total suma TODO lo imputado, esté o no a la vista: sin esta aclaración, con un
                  filtro puesto el importe parecería no corresponderse con la tabla. */}
              {ocultasElegidas > 0 &&
                ` · ${ocultasElegidas} fuera del filtro`}
            </span>
          </div>
          <span className="fact-total-val">{money(total)}</span>
        </div>

        <div className="actions-footer">
          {/* Volver al paso anterior. No pide confirmación ni descarta nada: las facturas elegidas
              y sus importes viven en el estado, así que se vuelve a entrar y siguen cargados. */}
          <button
            type="button"
            className="btn btn-out"
            onClick={() => dispatch({ type: 'goto', paso: 'cliente' })}
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
