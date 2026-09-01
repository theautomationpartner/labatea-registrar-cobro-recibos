import { useEffect, useMemo, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { FiltroFacturas } from '@/features/facturas/FiltroFacturas'
import { TablaFacturas } from '@/features/facturas/TablaFacturas'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { bloqueoDeImputacion, ROTULOS_PAGO, totalACancelar, type BloqueoImputacion } from '@/lib/cobros'
import { money } from '@/lib/format'
import { descripcionDePasoPago, etiquetaDePasoPago, numeroDePasoPago } from '@/lib/pasosPago'
import { getFacturasCompraPendientes } from '@/services/monday'
import { useApp, useDispatch } from '@/state/hooks'
import type { FacturaCompraPendiente, FacturaPendiente } from '@/types'

/**
 * Una factura de compra, con la forma que consumen la tabla y el panel del paso 2.
 *
 * Los dos componentes se reusan TAL CUAL —con sus animaciones, su plegado y su contabilidad—, y
 * hablan el modelo de una factura de venta pendiente. Traducir acá es lo que permite no tocarlos:
 * la alternativa era hacerlos genéricos sobre dos modelos que dicen exactamente lo mismo con otros
 * nombres, y eso complica el componente sin agregar nada.
 *
 * Los dos campos sin equivalente se declaran vacíos a propósito: una factura de compra no tiene
 * venta vinculada —por eso `ROTULOS_PAGO` apaga ese renglón— ni fecha de emisión en este tablero.
 */
const aFilaDeTabla = (f: FacturaCompraPendiente): FacturaPendiente => ({
  id: f.id,
  nro: f.nro,
  idVenta: '',
  emision: '',
  vencimiento: f.vencimiento,
  total: f.total,
  cobrado: f.pagado,
  cobradoPct: f.pagadoPct,
  pendiente: f.pendiente,
  estado: f.estado,
  parcial: f.parcial,
})

/**
 * Por qué una factura de compra NO se puede imputar, o `null` si se puede.
 *
 * Las dos razones son distintas y se dicen distinto, porque se arreglan en lugares distintos del
 * tablero:
 *
 *   · SIN TOTAL · a la factura nunca le cargaron su "🤖$ Total a pagar", así que su "Pend de Pagar"
 *     da cero por falta de dato y no porque esté saldada. Es el caso que antes hacía desaparecer la
 *     fila entera y dejaba la pantalla diciendo que el proveedor no debía nada.
 *   · SIN SALDO · el total está, lo pagado lo cubre entero, pero el estado del tablero todavía no
 *     se movió a "Pagada 100%". No hay nada que imputarle.
 *
 * En los dos casos la fila SE MUESTRA: un dato que falta tiene que poder verse para poder
 * corregirse. Lo que no se puede es elegirla.
 */
const motivoNoImputable = (f: FacturaCompraPendiente): string | null => {
  if (f.total <= 0) return 'Sin "$ Total a pagar" cargado en el tablero'
  if (f.pendiente <= 0) return 'Sin saldo pendiente, aunque su estado no lo refleje'
  return null
}

/** Filtra por número de factura de compra. Mismo criterio parcial y sin mayúsculas que en Cobros. */
const filtrar = (
  facturas: readonly FacturaCompraPendiente[],
  termino: string,
): FacturaCompraPendiente[] => {
  const t = termino.trim().toLowerCase()
  if (!t) return [...facturas]
  return facturas.filter((f) => f.nro.toLowerCase().includes(t))
}

/**
 * Etapa 2 de PAGOS: qué facturas de compra del proveedor se cancelan y por cuánto.
 *
 * Es el paso 2 de Cobros con los rótulos del egreso: la barra de filtrado, el botón de
 * "Seleccionar todos", el de "Ver todas", la tabla y el panel que se despliega bajo cada fila son
 * LOS MISMOS componentes, con sus mismas animaciones. Lo único que cambia son los textos (ver
 * `ROTULOS_PAGO`) y los datos que se les inyectan.
 *
 * DEPENDENCIA ESTRICTA: sin un proveedor validado en la etapa 1 no se consulta nada. La lista se
 * lee UNA sola vez por proveedor y queda cacheada (`facturasCompraProveedorId`): ir y volver entre
 * etapas —cosa que el stepper invita a hacer— no vuelve a consultar a Monday.
 */
export function FacturasCompraView() {
  const { proveedor, facturasCompra, imputacionesPago, facturasCompraProveedorId, tipoOperacionPago } =
    useApp()
  /* Esta etapa sólo existe en el recorrido de FACTURAS —el anticipo se la saltea—, así que el tipo
     acá es siempre ése. Se lo consulta igual, en vez de darlo por sentado: es lo que mantiene la
     numeración y los rótulos saliendo de un solo lugar. */
  const SIGUIENTE = etiquetaDePasoPago('pago', tipoOperacionPago)
  const dispatch = useDispatch()
  /* Con la lista ya leída para este proveedor no hay espera que mostrar: el paso arranca con los
     datos puestos, sin el parpadeo del esqueleto de carga. */
  const enCache = !!proveedor && facturasCompraProveedorId === proveedor.id
  const [cargando, setCargando] = useState(!enCache)
  // Motivo por el que no se puede avanzar, mostrado al intentarlo.
  const [aviso, setAviso] = useState<BloqueoImputacion | null>(null)
  /* Filtro por número de factura. Es sólo una VISTA sobre la lista: no toca las imputaciones, así
     que filtrar nunca descarta lo que ya se había cargado. */
  const [filtro, setFiltro] = useState('')

  useEffect(() => {
    /* Sin proveedor validado el listado NO se dispara: es la dependencia estricta de la etapa 1. */
    if (!proveedor) {
      setCargando(false)
      return
    }
    // Ya están leídas para ESTE proveedor: se reusa lo que hay en el estado.
    if (facturasCompraProveedorId === proveedor.id) {
      setCargando(false)
      return
    }
    let vivo = true
    setCargando(true)
    getFacturasCompraPendientes(proveedor.id)
      .then((fs) => {
        if (!vivo) return
        // El id queda como clave de caché: a partir de acá el paso no vuelve a consultar.
        dispatch({ type: 'setFacturasCompra', facturas: fs, proveedorId: proveedor.id })
        setCargando(false)
      })
      .catch(() => {
        if (!vivo) return
        /* El fallo lo comunica la ventana global; la lista queda vacía para no mostrar facturas
           viejas como si fueran el estado actual de la deuda. Sin clave de caché (`null`): un
           error NO se cachea, así volver a entrar al paso reintenta la lectura. */
        dispatch({ type: 'setFacturasCompra', facturas: [], proveedorId: null })
        dispatch({
          type: 'errorMonday',
          accion: 'obtener las facturas de compra pendientes del proveedor',
        })
        setCargando(false)
      })
    return () => {
      vivo = false
    }
  }, [proveedor, facturasCompraProveedorId, dispatch])

  const visibles = useMemo(() => filtrar(facturasCompra, filtro), [facturasCompra, filtro])
  const filas = useMemo(() => visibles.map(aFilaDeTabla), [visibles])
  /* Para VALIDAR se mira la lista completa, no la filtrada: una factura elegida que el filtro dejó
     fuera de pantalla sigue sumando al total, así que su importe tiene que revisarse igual. Con la
     lista visible, poner un filtro habría hecho desaparecer el bloqueo junto con la fila. */
  const todas = useMemo(() => facturasCompra.map(aFilaDeTabla), [facturasCompra])
  const total = totalACancelar(imputacionesPago)
  const elegidas = Object.keys(imputacionesPago).length
  /* Las que no se pueden imputar quedan fuera de la cuenta de "todas": están a la vista para que se
     vea qué les falta, pero no participan de la selección. */
  const imputables = visibles.filter((f) => !motivoNoImputable(f))
  // Facturas ya imputadas que el filtro dejó fuera de pantalla, pero siguen sumando al total.
  const visiblesElegidas = imputables.filter((f) => f.id in imputacionesPago)
  const ocultasElegidas = elegidas - visiblesElegidas.length
  const todasElegidas = imputables.length > 0 && visiblesElegidas.length === imputables.length

  /** Marca todas las facturas imputables a la vista, o las libera si ya estaban todas marcadas. */
  const alternarTodas = () => {
    for (const f of imputables) {
      const elegida = f.id in imputacionesPago
      if (todasElegidas === elegida) dispatch({ type: 'toggleFacturaCompra', factura: f })
    }
  }

  /* Las reglas de la imputación son las MISMAS que en Cobros —al menos una elegida, todas con
     importe mayor a 0 y ninguna por encima de su saldo—, así que se validan con la misma función:
     "cuánto de este comprobante se cancela" es la misma pregunta se cobre o se pague. */
  const bloqueo = bloqueoDeImputacion(todas, imputacionesPago)

  const continuar = () => {
    /* El botón NUNCA se apaga: si falta algo, la ventana dice exactamente qué. */
    if (bloqueo) {
      setAviso(bloqueo)
      return
    }
    dispatch({ type: 'gotoPago', paso: 'pago' })
  }

  return (
    <section className="view facturas-v2 paso-layout">
      <PasoHeader />

      <div className="paso-body">
        <PasoTitulo
          numero={numeroDePasoPago('facturasCompra', tipoOperacionPago)}
          titulo={etiquetaDePasoPago('facturasCompra', tipoOperacionPago)}
          descripcion={descripcionDePasoPago('facturasCompra', tipoOperacionPago)}
        />

        <div className="card fact-card">
          <div className="fact-card-head">
            <h2 className="fact-card-titulo">FACTURAS DE COMPRA PENDIENTES DE PAGAR</h2>
            <p className="fact-card-bajada">
              Seleccioná las facturas que deseás incluir en este pago.
            </p>
          </div>

          {/* La barra de filtrado es parte del encabezado del bloque, no del resultado: se monta
              SIEMPRE —también mientras se consulta a Monday— para que su lugar no aparezca y
              desaparezca. */}
          <FiltroFacturas
            valor={filtro}
            onValor={setFiltro}
            onVerTodas={() => setFiltro('')}
            hayFiltro={filtro.trim() !== ''}
            onAlternarTodas={alternarTodas}
            todasElegidas={todasElegidas}
            sinFacturas={imputables.length === 0}
            deshabilitado={cargando || !proveedor}
            placeholder="Filtrar por número de factura de compra..."
            aria="Filtrar facturas de compra por número"
          />

          {cargando ? (
            <p className="fact-vacio">
              <i className="fas fa-spinner fa-spin" /> Buscando las facturas de compra pendientes
              del proveedor...
            </p>
          ) : !proveedor ? (
            <p className="fact-vacio">
              <i className="fas fa-user-slash" /> Todavía no hay un proveedor seleccionado. Volvé al
              paso 1 para elegirlo.
            </p>
          ) : facturasCompra.length === 0 ? (
            <p className="fact-vacio">
              <i className="fas fa-circle-check t-green" /> <strong>{proveedor.name}</strong> no
              tiene facturas de compra pendientes de pago.
            </p>
          ) : visibles.length === 0 ? (
            <p className="fact-vacio">
              <i className="fas fa-filter-circle-xmark" /> Ninguna factura coincide con{' '}
              <strong>«{filtro.trim()}»</strong>. Probá con otro número o volvé a la lista completa
              con "Ver todas".
            </p>
          ) : (
            <TablaFacturas
              facturas={filas}
              imputaciones={imputacionesPago}
              rotulos={ROTULOS_PAGO}
              /* Las acciones son las de PAGOS: los dos circuitos tienen estado propio. La factura
                 vuelve a buscarse en la lista original porque el reducer necesita su `pendiente`
                 para proponer el importe, y la fila de la tabla es sólo su traducción. */
              onToggle={(fila) => {
                const factura = facturasCompra.find((f) => f.id === fila.id)
                if (factura) dispatch({ type: 'toggleFacturaCompra', factura })
              }}
              onImporte={(id, importe) =>
                dispatch({ type: 'setImporteFacturaCompra', id, importe })
              }
              /* La tabla trabaja sobre filas traducidas, así que el motivo se resuelve volviendo a
                 la factura original: es la que tiene los importes con sus nombres de pago. */
              bloqueada={(fila) => {
                const factura = facturasCompra.find((f) => f.id === fila.id)
                return factura ? motivoNoImputable(factura) : null
              }}
            />
          )}
        </div>

        {/* TOTAL A PAGAR: la suma de lo imputado, que es el importe del pago a registrar. */}
        <div className={`fact-total ${total > 0 ? 'fact-total--on' : ''}`}>
          <div className="fact-total-txt">
            <span className="fact-total-lbl">{ROTULOS_PAGO.totalPie}</span>
            <span className="fact-total-det">
              {elegidas === 0
                ? 'Sin facturas seleccionadas'
                : `${elegidas} ${elegidas === 1 ? 'factura seleccionada' : 'facturas seleccionadas'}`}
              {/* El total suma TODO lo imputado, esté o no a la vista: sin esta aclaración, con un
                  filtro puesto el importe parecería no corresponderse con la tabla. */}
              {ocultasElegidas > 0 && ` · ${ocultasElegidas} fuera del filtro`}
            </span>
          </div>
          <span className="fact-total-val">{money(total)}</span>
        </div>

        <div className="actions-footer">
          {/* Volver al paso anterior. No pide confirmación ni descarta nada: las facturas elegidas
              y sus importes viven en el estado. */}
          <button
            type="button"
            className="btn btn-out"
            onClick={() => dispatch({ type: 'gotoPago', paso: 'proveedor' })}
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
