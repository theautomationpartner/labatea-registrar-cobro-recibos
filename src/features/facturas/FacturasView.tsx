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
 * Las facturas se leen UNA sola vez por cliente y quedan cacheadas en el estado global
 * (`facturasClienteId`): ir y volver entre etapas —cosa que el stepper invita a hacer— no vuelve a
 * consultar a Monday. La lectura se rehace sólo cuando cambia el cliente, cuando cambia qué se está
 * cobrando o al empezar una operación nueva, que son los tres momentos en que la lista deja de
 * corresponder. Las imputaciones ya cargadas se conservan si su factura sigue pendiente.
 */
export function FacturasView() {
  const { cliente, facturas, imputaciones, facturasClienteId } = useApp()
  const dispatch = useDispatch()
  /* Con la lista ya leída para este cliente no hay espera que mostrar: el paso arranca con los
     datos puestos, sin el parpadeo del esqueleto de carga. */
  const enCache = !!cliente && facturasClienteId === cliente.id
  const [cargando, setCargando] = useState(!enCache)
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
    /* Ya están leídas para ESTE cliente: se reusa lo que hay en el estado. Es el corte que evita
       una consulta por cada vez que se pasa por el paso. */
    if (facturasClienteId === cliente.id) {
      setCargando(false)
      return
    }
    let vivo = true
    setCargando(true)
    getFacturasPendientes(cliente.id)
      .then((fs) => {
        if (!vivo) return
        // El id queda como clave de caché: a partir de acá el paso no vuelve a consultar.
        dispatch({ type: 'setFacturas', facturas: fs, clienteId: cliente.id })
        setCargando(false)
      })
      .catch(() => {
        if (!vivo) return
        /* El fallo lo comunica la ventana global; la lista queda vacía para no mostrar facturas
           viejas como si fueran el estado actual de la deuda. Sin clave de caché (`null`): un
           error NO se cachea, así volver a entrar al paso reintenta la lectura. */
        dispatch({ type: 'setFacturas', facturas: [], clienteId: null })
        dispatch({ type: 'errorMonday', accion: 'obtener las facturas pendientes del cliente' })
        setCargando(false)
      })
    return () => {
      vivo = false
    }
  }, [cliente, facturasClienteId, dispatch])

  const visibles = useMemo(() => filtrarFacturas(facturas, filtro), [facturas, filtro])
  const total = totalACancelar(imputaciones)
  const elegidas = Object.keys(imputaciones).length
  // Facturas ya imputadas que el filtro dejó fuera de pantalla, pero siguen sumando al total.
  const visiblesElegidas = visibles.filter((f) => f.id in imputaciones)
  const ocultasElegidas = elegidas - visiblesElegidas.length
  const todasElegidas = visibles.length > 0 && visiblesElegidas.length === visibles.length

  /** Marca todas las facturas a la vista, o las libera si ya estaban todas marcadas. */
  const alternarTodas = () => {
    for (const f of visibles) {
      const elegida = f.id in imputaciones
      if (todasElegidas === elegida) dispatch({ type: 'toggleFactura', factura: f })
    }
  }

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

          {/* La barra de filtrado es parte del encabezado del bloque, no del resultado: se monta
              SIEMPRE —también mientras se consulta a Monday— para que su lugar no aparezca y
              desaparezca. Lo único que cambia debajo es el contenido. */}
          <FiltroFacturas
            valor={filtro}
            onValor={setFiltro}
            onVerTodas={() => setFiltro('')}
            hayFiltro={filtro.trim() !== ''}
            onAlternarTodas={alternarTodas}
            todasElegidas={todasElegidas}
            sinFacturas={visibles.length === 0}
            deshabilitado={cargando || !cliente}
          />

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
          ) : visibles.length === 0 ? (
            <p className="fact-vacio">
              <i className="fas fa-filter-circle-xmark" /> Ninguna factura coincide con{' '}
              <strong>«{filtro.trim()}»</strong>. Probá con otro número o volvé a la lista completa
              con "Ver todas".
            </p>
          ) : (
            <TablaFacturas facturas={visibles} imputaciones={imputaciones} />
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
