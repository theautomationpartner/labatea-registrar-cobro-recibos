import { useState } from 'react'
import { esPagoConTarjeta, esRetencion } from '@/lib/pagos'
import { money } from '@/lib/format'
import { useDispatch } from '@/state/hooks'
import type { MovimientoPago } from '@/types'
import { ImporteEditable } from './ImporteEditable'

/** Campo del detalle de un pago: rótulo y valor. */
interface Dato {
  label: string
  valor: string
}

/**
 * Detalle adicional de un pago, según su forma: es lo que se capturó en el formulario para ese
 * medio de cobro. El efectivo no agrega nada a lo que ya muestra la fila, así que no despliega;
 * el resto sí, para poder revisar los datos antes de emitir el recibo.
 */
function detalleDe(m: MovimientoPago): Dato[] {
  if (m.formaPago === 'Cheque') {
    return [
      { label: 'Número de cheque', valor: m.numeroCheque || '—' },
      { label: 'Tipo', valor: m.formatoCheque === 'eCheq' ? 'eCheq' : 'Papel' },
      { label: 'Fecha de emisión', valor: m.fechaEmisionCheque || '—' },
      { label: 'Fecha de vencimiento', valor: m.chequeVencimiento || '—' },
      { label: 'Banco emisor', valor: m.bancoEmisor || '—' },
      { label: 'CUIT del emisor', valor: m.cuitEmisor || '—' },
    ]
  }
  if (m.formaPago === 'Transferencia') {
    return [
      { label: 'Cuenta bancaria', valor: m.cuentaPropia || '—' },
      { label: 'Comprobante', valor: m.comprobanteNombre || '—' },
    ]
  }
  // Retenciones: lo único que agregan al importe es el comprobante que las respalda.
  if (esRetencion(m.formaPago)) {
    return [
      { label: 'Año', valor: m.anioRetencion || '—' },
      { label: 'Nro Comprobante', valor: m.nroComprobanteRetencion?.trim() || '—' },
      { label: 'Comprobante', valor: m.comprobanteNombre || '—' },
    ]
  }
  if (esPagoConTarjeta(m.formaPago)) {
    const filas: Dato[] = [
      { label: 'Banco emisor', valor: m.bancoTarjeta || '—' },
      { label: 'Tipo', valor: m.tipoTarjeta || '—' },
      { label: 'Fecha de Venc.', valor: m.vencimientoTarjeta || '—' },
    ]
    filas.push({ label: 'Nro Cupon', valor: m.numeroCupon?.trim() || '—' })
    filas.push({ label: 'Comprobante', valor: m.comprobanteNombre || '—' })
    filas.push({ label: 'Banco de Acreditación', valor: m.cuentaPropia || '—' })
    return filas
  }
  return []
}

/** Fila de un pago, con su detalle plegable debajo cuando la forma lo amerita. */
function FilaPago({
  movimiento: m,
  bloqueado,
  columnas,
  onQuitar,
  onImporte,
}: {
  movimiento: MovimientoPago
  bloqueado: boolean
  columnas: number
  onQuitar: () => void
  onImporte: (importe: number) => void
}) {
  const [abierto, setAbierto] = useState(false)
  const detalle = detalleDe(m)
  const desplegable = detalle.length > 0

  return (
    <>
      <tr className={desplegable && abierto ? 'cobro-fila--abierta' : ''}>
        {/* Medio de Cobro: el chevron de detalle va pegado a la forma de pago. */}
        <td>
          <span className="cobro-fila-1a">
            {/* El efectivo no despliega nada: el hueco mantiene alineada la columna. */}
            {desplegable ? (
              <button
                type="button"
                className="cobro-fila-chev"
                aria-expanded={abierto}
                aria-label={`${abierto ? 'Ocultar' : 'Ver'} el detalle del pago por ${m.formaPago}`}
                onClick={() => setAbierto((v) => !v)}
              >
                <i className={`fas fa-chevron-right ${abierto ? 'open' : ''}`} />
              </button>
            ) : (
              <span className="cobro-fila-chev cobro-fila-chev--vacio" />
            )}
            {m.formaPago}
          </span>
        </td>
        {/* Importe: editable mientras el cobro no esté registrado, para poder llevar la DIFERENCIA
            a 0 (bajarlo o subirlo) sin quitar el pago. Registrado, se muestra a secas. */}
        <td>
          {bloqueado ? money(m.importe) : <ImporteEditable valor={m.importe} onCambio={onImporte} />}
        </td>
        {!bloqueado && (
          <td className="ta-r">
            <button
              type="button"
              className="cobro-tabla-del"
              aria-label={`Quitar pago de ${m.formaPago}`}
              onClick={onQuitar}
            >
              <i className="far fa-trash-alt" />
            </button>
          </td>
        )}
      </tr>

      {desplegable && abierto && (
        <tr className="cobro-fila-detalle">
          <td colSpan={columnas}>
            <dl className="cobro-detalle-grid">
              {detalle.map((d) => (
                <div key={d.label} className="cobro-detalle-item">
                  <dt>{d.label}</dt>
                  <dd>{d.valor}</dd>
                </div>
              ))}
            </dl>
          </td>
        </tr>
      )}
    </>
  )
}

interface TablaMovimientosProps {
  movimientos: readonly MovimientoPago[]
  /** Cobro ya registrado: el registro queda a la vista, pero no se toca. */
  bloqueado?: boolean
}

/** Pagos ya cargados al cobro. */
export function TablaMovimientos({ movimientos, bloqueado = false }: TablaMovimientosProps) {
  const dispatch = useDispatch()
  // Sin acciones posibles, la columna deja de tener sentido y se va.
  const columnas = bloqueado ? 2 : 3

  return (
    <table className="cobro-tabla">
      <thead>
        <tr>
          <th>Medio de Cobro</th>
          <th>Importe</th>
          {!bloqueado && <th className="ta-r">Acciones</th>}
        </tr>
      </thead>
      <tbody>
        {movimientos.length === 0 ? (
          <tr className="cobro-tabla-vacia">
            <td colSpan={columnas}>Todavía no cargaste ningún pago.</td>
          </tr>
        ) : (
          movimientos.map((m) => (
            <FilaPago
              key={m.id}
              movimiento={m}
              bloqueado={bloqueado}
              columnas={columnas}
              onQuitar={() => dispatch({ type: 'removeMovimientoPago', id: m.id })}
              onImporte={(importe) =>
                dispatch({ type: 'setMovimientoImporte', id: m.id, importe })
              }
            />
          ))
        )}
      </tbody>
      {/* Sin fila de total: los totales viven en la cabecera, junto a la diferencia. */}
    </table>
  )
}
