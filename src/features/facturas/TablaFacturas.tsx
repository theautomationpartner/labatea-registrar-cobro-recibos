import { useEffect, useRef } from 'react'
import { Donut } from '@/components/ui/Donut'
import { colorCancelacion, type Imputaciones } from '@/lib/cobros'
import { desdeIso, diasDeMora } from '@/lib/dates'
import { money } from '@/lib/format'
import { useDispatch } from '@/state/hooks'
import type { FacturaPendiente } from '@/types'
import { PanelImputacion } from './PanelImputacion'

interface TablaFacturasProps {
  facturas: readonly FacturaPendiente[]
  imputaciones: Imputaciones
}

/**
 * A partir de acá la tabla scrollea en su propia caja en vez de estirar la página. Con más de ocho
 * comprobantes, el total a cancelar y el botón de avance quedaban fuera de pantalla justo cuando
 * más se los necesita: mientras se decide cuánto se cobra de cada factura.
 */
const MAX_FILAS_SIN_SCROLL = 8

/** Días de mora de la fila: en rojo si la factura ya venció, neutro si todavía no. */
function Mora({ vencimiento }: { vencimiento: string }) {
  const dias = diasDeMora(vencimiento)
  // Sin fecha de vencimiento no se sabe si hay mora: no es lo mismo que no deber días.
  if (dias === null) return <span className="fact-mora-sd">—</span>
  return (
    <span className={dias > 0 ? 'fact-mora' : ''}>
      {dias} {dias === 1 ? 'día' : 'días'}
    </span>
  )
}

/**
 * Facturas pendientes del cliente. Cada fila es seleccionable y, al marcarla, se despliega debajo
 * su panel de pago: la configuración vive PEGADA a la factura que configura, en vez de en un
 * formulario aparte donde habría que volver a decir de qué comprobante se está hablando.
 *
 * Sin columnas "Fecha" ni "Acciones": la primera no aporta al cobro y la segunda no tiene ninguna
 * acción que ofrecer en este paso.
 */
export function TablaFacturas({ facturas, imputaciones }: TablaFacturasProps) {
  const dispatch = useDispatch()
  const elegidas = facturas.filter((f) => f.id in imputaciones).length
  const todas = facturas.length > 0 && elegidas === facturas.length
  const algunas = elegidas > 0 && !todas
  const refTodas = useRef<HTMLInputElement>(null)

  /* El estado "algunas seleccionadas" no se puede expresar en el atributo `checked`: es una
     propiedad del nodo. Sin esto, con selección parcial la casilla se vería vacía. */
  useEffect(() => {
    if (refTodas.current) refTodas.current.indeterminate = algunas
  }, [algunas])

  /** Marca o desmarca TODAS: si ya estaban todas, la casilla del encabezado las libera. */
  const alternarTodas = () => {
    for (const f of facturas) {
      const elegida = f.id in imputaciones
      if (todas === elegida) dispatch({ type: 'toggleFactura', factura: f })
    }
  }

  const conScroll = facturas.length > MAX_FILAS_SIN_SCROLL

  return (
    <div className={`fact-tabla-wrap ${conScroll ? 'fact-tabla-wrap--scroll' : ''}`}>
      <table className="fact-tabla">
        <thead>
          <tr>
            <th className="fact-col-check">
              <input
                ref={refTodas}
                type="checkbox"
                className="fact-check"
                checked={todas}
                onChange={alternarTodas}
                aria-label="Seleccionar todas las facturas"
              />
            </th>
            <th>N° Factura</th>
            <th className="fact-col-cen">Vencimiento</th>
            <th className="fact-col-cen">Días de Mora</th>
            <th className="fact-col-cen">Importe Original</th>
            <th className="fact-col-cen">Saldo Pendiente</th>
            <th className="fact-col-cen">Pagado / Pendiente</th>
            <th className="fact-col-cen">Pagado</th>
            <th className="fact-col-cen">Falta</th>
            <th>Estado</th>
          </tr>
        </thead>

        {facturas.map((f) => {
          const importe = imputaciones[f.id]
          const elegida = importe !== undefined
          const vence = desdeIso(f.vencimiento)
          const vencida = (diasDeMora(f.vencimiento) ?? 0) > 0
          return (
            /* Un `tbody` por factura mantiene la fila y su panel como una sola unidad. */
            <tbody key={f.id} className={elegida ? 'fact-grupo fact-grupo--on' : 'fact-grupo'}>
              <tr className="fact-row">
                <td className="fact-col-check">
                  <input
                    type="checkbox"
                    className="fact-check"
                    checked={elegida}
                    onChange={() => dispatch({ type: 'toggleFactura', factura: f })}
                    aria-label={`Incluir la factura ${f.nro} en este cobro`}
                  />
                </td>
                <td>
                  <span className="fact-nro">{f.nro}</span>
                  {/* Nombre del ítem: el ID de la venta que dejó esta deuda. */}
                  <span className="fact-venta">
                    {f.idVenta || <span className="fact-mora-sd">Sin venta vinculada</span>}
                  </span>
                </td>
                <td className={`fact-col-cen ${vencida ? 'fact-mora' : ''}`}>
                  {vence || <span className="fact-mora-sd">—</span>}
                </td>
                <td className="fact-col-cen">
                  <Mora vencimiento={f.vencimiento} />
                </td>
                <td className="fact-col-cen fact-num">{money(f.total)}</td>
                <td className="fact-col-cen fact-num fact-pend">{money(f.pendiente)}</td>
                <td className="fact-col-cen">
                  <div className="fact-pagado">
                    <Donut
                      percent={f.cobradoPct}
                      color={colorCancelacion(f.cobradoPct)}
                      size="sm"
                    />
                  </div>
                </td>
                <td className="fact-col-cen fact-num">{money(f.cobrado)}</td>
                <td className="fact-col-cen fact-num">{money(f.pendiente)}</td>
                <td>
                  <span className={`fact-estado ${f.parcial ? 'is-parcial' : 'is-pendiente'}`}>
                    <span className="fact-estado-dot" />
                    {f.estado}
                  </span>
                </td>
              </tr>

              {elegida && (
                <tr className="fact-exp">
                  <td colSpan={10}>
                    <PanelImputacion
                      factura={f}
                      importe={importe}
                      onImporte={(valor) =>
                        dispatch({ type: 'setImporteFactura', id: f.id, importe: valor })
                      }
                    />
                  </td>
                </tr>
              )}
            </tbody>
          )
        })}
      </table>
    </div>
  )
}
