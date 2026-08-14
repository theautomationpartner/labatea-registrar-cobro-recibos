import { useEffect, useRef, useState } from 'react'
import { esPagoConTarjeta, esRetencion } from '@/lib/pagos'
import { money } from '@/lib/format'
import { useDispatch } from '@/state/hooks'
import type { MovimientoPago } from '@/types'
import { ImporteEditable } from './ImporteEditable'

/**
 * Cuánto dura el PLEGADO del detalle, en ms. Tiene que coincidir con la animación `cobro-plegar`
 * de `cobro.css`: es el tiempo que la fila sigue montada después de cerrarse, para que la salida se
 * vea en vez de desaparecer de un corte.
 *
 * Son los mismos tiempos que el despliegue de las facturas pendientes (ver `TablaFacturas`): las
 * dos tablas abren un detalle debajo de una fila, y abrirlo tiene que sentirse igual en las dos.
 */
const MS_PLEGADO = 200

/**
 * Cuánto dura el DESPLIEGUE, en ms. Tiene que coincidir con la animación `cobro-desplegar` de
 * `cobro.css`: es el tiempo que la fila queda marcada como "recién abierta" para animarse.
 */
const MS_DESPLIEGUE = 240

/**
 * Rótulo de la columna de acciones. Es una constante porque lo usan DOS lugares: el encabezado y la
 * copia invisible que, en cada fila, reserva su mismo ancho para centrar la papelera debajo. Con un
 * solo origen no pueden desalinearse aunque el título cambie.
 */
const ROTULO_ACCIONES = 'Acciones'

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
      { label: 'Nro Comprobante', valor: m.nroComprobanteTransferencia?.trim() || '—' },
      { label: 'Cuenta de Acreditación', valor: m.cuentaPropia || '—' },
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
  /* Detalle que se está PLEGANDO: ya está cerrado, pero sigue montado hasta que termina la
     animación de salida. Sin esto, cerrar lo desmonta en el acto y desaparece de un corte. */
  const [cerrando, setCerrando] = useState(false)
  /* Detalle recién abierto: es el único que se anima. La marca dura lo que dura la animación y se
     borra sola, así el detalle no se vuelve a abrir en la cara del usuario si la fila se
     re-renderiza por otro motivo —un importe editado en otra fila, por ejemplo—. */
  const [abriendo, setAbriendo] = useState(false)
  const reloj = useRef<ReturnType<typeof setTimeout>>()

  // Quitado el pago, la fila se desmonta: no puede quedar un temporizador buscándola.
  useEffect(() => () => clearTimeout(reloj.current), [])

  /** Abre o cierra el detalle, dejándolo montado el tiempo que dura la animación de salida. */
  const alternar = () => {
    // Abrir y cerrar rápido no puede dejar dos animaciones peleándose por el mismo detalle.
    clearTimeout(reloj.current)
    if (abierto) {
      setAbierto(false)
      setAbriendo(false)
      setCerrando(true)
      reloj.current = setTimeout(() => setCerrando(false), MS_PLEGADO)
      return
    }
    setCerrando(false)
    setAbierto(true)
    setAbriendo(true)
    reloj.current = setTimeout(() => setAbriendo(false), MS_DESPLIEGUE)
  }

  const detalle = detalleDe(m)
  const desplegable = detalle.length > 0
  /* El detalle está en pantalla mientras se lo lee Y mientras se pliega: hasta que la salida
     termina, la fila sigue siendo una fila abierta. */
  const visible = desplegable && (abierto || cerrando)

  return (
    <>
      <tr className={visible ? 'cobro-fila--abierta' : ''}>
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
                onClick={alternar}
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
        {/* La papelera se centra DEBAJO DEL RÓTULO, no en el ancho de la columna: ésta mide un
            tercio de la tabla, así que centrarla ahí alejaba el ícono del importe que borra.
            El eje no se estima: la celda monta una copia invisible del mismo rótulo, que reserva
            exactamente su ancho, y el ícono se centra dentro de ese espacio. */}
        {!bloqueado && (
          <td className="cobro-col-acc">
            <span className="cobro-acc-caja">
              <span className="cobro-acc-fantasma" aria-hidden="true">
                {ROTULO_ACCIONES}
              </span>
              <button
                type="button"
                className="cobro-tabla-del"
                aria-label={`Quitar pago de ${m.formaPago}`}
                onClick={onQuitar}
              >
                <i className="far fa-trash-alt" />
              </button>
            </span>
          </td>
        )}
      </tr>

      {visible && (
        <tr className="cobro-fila-detalle">
          <td colSpan={columnas}>
            {/* Dos envoltorios para poder animar el DESPLIEGUE: el de afuera anima su alto (de 0fr
                a 1fr) y el de adentro recorta lo que todavía no entra. Es el mismo mecanismo del
                panel de las facturas pendientes. */}
            <div
              className={`cobro-exp-wrap ${
                cerrando ? 'cobro-exp-wrap--cerrando' : abriendo ? 'cobro-exp-wrap--abriendo' : ''
              }`}
            >
              <div className="cobro-exp-in">
                <dl className="cobro-detalle-grid">
                  {detalle.map((d) => (
                    <div key={d.label} className="cobro-detalle-item">
                      <dt>{d.label}</dt>
                      <dd>{d.valor}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
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
          {!bloqueado && <th className="cobro-col-acc">{ROTULO_ACCIONES}</th>}
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
