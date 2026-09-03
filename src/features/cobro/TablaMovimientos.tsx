import { useEffect, useRef, useState } from 'react'
import { esChequeDeCobro, esPagoConTarjeta, esRetencion, vencimientoDeCheque } from '@/lib/pagos'
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
export interface Dato {
  label: string
  valor: string
}

/**
 * Lo MÍNIMO que una fila de esta tabla necesita: con qué se movió el dinero y por cuánto.
 *
 * Está escrito así —y no como `MovimientoPago`— porque la tabla la comparten los dos módulos: en
 * COBROS cada fila es una forma de pago del cliente y en PAGOS es una caja de la que sale el
 * dinero. Los dos tienen exactamente estos tres datos en común, y todo lo demás —lo que se
 * despliega debajo— lo aporta quien la usa, con su propia función `detalle`.
 */
export interface FilaMovimiento {
  id: string
  formaPago: string
  importe: number
}

/**
 * Detalle adicional de un pago, según su forma: es lo que se capturó en el formulario para ese
 * medio de cobro. El efectivo no agrega nada a lo que ya muestra la fila, así que no despliega;
 * el resto sí, para poder revisar los datos antes de emitir el recibo.
 */
function detalleDe(m: MovimientoPago): Dato[] {
  /* Papel y electrónico despliegan lo MISMO: cuál de los dos es ya lo dice la columna del medio de
     la propia fila, así que repetirlo acá como un dato más sería decirlo dos veces en la misma
     pantalla. */
  if (esChequeDeCobro(m.formaPago)) {
    return [
      { label: 'Número de cheque', valor: m.numeroCheque || '—' },
      { label: 'Fecha de emisión', valor: m.fechaEmisionCheque || '—' },
      { label: 'Fecha de pago', valor: m.fechaPagoCheque || '—' },
      /* El vencimiento se DERIVA de la de pago (+30 días), igual que en el formulario: no se guarda
         en el movimiento, así que acá se vuelve a calcular en vez de arrastrar una copia. */
      { label: 'Fecha de venc.', valor: vencimientoDeCheque(m.fechaPagoCheque) || '—' },
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
  detalle,
  bloqueado,
  importeFijo,
  columnas,
  onQuitar,
  onImporte,
}: {
  movimiento: FilaMovimiento
  /** Lo que se despliega debajo. Vacío = la fila no despliega nada (es el caso del efectivo). */
  detalle: Dato[]
  bloqueado: boolean
  /** Por qué el importe de ESTA fila no se toca, o `null` si se puede editar. */
  importeFijo: string | null
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
            a 0 (bajarlo o subirlo) sin quitar el pago. Registrado, se muestra a secas.

            Las cajas de importe FIJO —el cheque, la retención— conservan el campo y lo muestran
            bloqueado: la columna se lee igual en todas las filas, y la que no se toca se distingue
            por cómo está pintada y por su motivo, no por dejar de ser un campo. */}
        <td>
          {bloqueado ? (
            money(m.importe)
          ) : (
            <ImporteEditable
              valor={m.importe}
              onCambio={onImporte}
              bloqueado={!!importeFijo}
              motivo={importeFijo ?? undefined}
            />
          )}
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

/**
 * Los textos que cambian entre COBROS y PAGOS. Lo único que se diferencia es cómo se nombra la
 * columna del medio: en una cobranza es el "Medio de Cobro" y en un pago, la "Cajas" de la que
 * sale el dinero.
 */
export interface RotulosMovimientos {
  medio: string
  importe: string
  acciones: string
  vacio: string
}

/** Los rótulos de una COBRANZA. Rigen si no se pasa ninguno: es el circuito original. */
export const ROTULOS_MOVIMIENTOS_COBRO: RotulosMovimientos = {
  medio: 'Medio de Cobro',
  importe: 'Importe',
  acciones: ROTULO_ACCIONES,
  vacio: 'Todavía no cargaste ningún pago.',
}

/** Los rótulos de un PAGO a proveedor: la misma tabla, con el vocabulario de las cajas. */
export const ROTULOS_MOVIMIENTOS_PAGO: RotulosMovimientos = {
  medio: 'Cajas',
  importe: 'Importe',
  acciones: ROTULO_ACCIONES,
  vacio: 'Todavía no cargaste ninguna caja.',
}

interface TablaMovimientosProps<T extends FilaMovimiento> {
  movimientos: readonly T[]
  /** Cobro ya registrado: el registro queda a la vista, pero no se toca. */
  bloqueado?: boolean
  /** Cómo se nombran las columnas. Por defecto, las de COBROS. */
  rotulos?: RotulosMovimientos
  /**
   * Qué se despliega debajo de cada fila. Por defecto, el detalle de una forma de pago del cobro;
   * el módulo de PAGOS pasa el suyo, que describe la caja. Devolver una lista vacía es lo que hace
   * que la fila no despliegue nada, como pasa con el efectivo.
   */
  detalle?: (movimiento: T) => Dato[]
  /**
   * Qué hacer al quitar una fila y al editar su importe. Por defecto, las acciones del COBRO: los
   * dos circuitos tienen estado propio, así que tampoco pueden compartir el dispatch.
   */
  onQuitar?: (id: string) => void
  onImporte?: (id: string, importe: number) => void
  /**
   * Por qué el importe de una fila NO se puede editar, o `null` si se puede. Sin la prop, todas se
   * editan: es el caso de COBROS, donde ajustar un importe en la tabla es justamente la forma de
   * llevar la diferencia a cero sin quitar el movimiento.
   *
   * Existe porque hay importes que NO son una decisión del usuario sino un dato del documento —el
   * de un cheque es el que dice el papel—, y dejarlos editables invitaría a registrar un importe
   * que no coincide con el cheque que se entrega. El texto que devuelve explica por qué, en el
   * tooltip de la celda.
   */
  importeFijo?: (movimiento: T) => string | null
}

/** Pagos ya cargados al cobro (o cajas cargadas al pago: es la misma tabla). */
export function TablaMovimientos<T extends FilaMovimiento>({
  movimientos,
  bloqueado = false,
  rotulos = ROTULOS_MOVIMIENTOS_COBRO,
  detalle,
  onQuitar,
  onImporte,
  importeFijo,
}: TablaMovimientosProps<T>) {
  const dispatch = useDispatch()
  // Sin acciones posibles, la columna deja de tener sentido y se va.
  const columnas = bloqueado ? 2 : 3
  /* El detalle y las acciones del COBRO son el caso por defecto: es el circuito para el que se
     escribió la tabla. El `as` es la contrapartida de haberla abierto a las dos formas de
     movimiento: acá dentro sólo llegan `MovimientoPago`, porque es quien no pasa `detalle`. */
  const detalleDeFila = detalle ?? ((m: T) => detalleDe(m as unknown as MovimientoPago))
  const quitar = onQuitar ?? ((id: string) => dispatch({ type: 'removeMovimientoPago', id }))
  const cambiarImporte =
    onImporte ??
    ((id: string, importe: number) => dispatch({ type: 'setMovimientoImporte', id, importe }))

  return (
    <table className="cobro-tabla">
      <thead>
        <tr>
          <th>{rotulos.medio}</th>
          <th>{rotulos.importe}</th>
          {!bloqueado && <th className="cobro-col-acc">{rotulos.acciones}</th>}
        </tr>
      </thead>
      <tbody>
        {movimientos.length === 0 ? (
          <tr className="cobro-tabla-vacia">
            <td colSpan={columnas}>{rotulos.vacio}</td>
          </tr>
        ) : (
          movimientos.map((m) => (
            <FilaPago
              key={m.id}
              movimiento={m}
              detalle={detalleDeFila(m)}
              bloqueado={bloqueado}
              importeFijo={importeFijo?.(m) ?? null}
              columnas={columnas}
              onQuitar={() => quitar(m.id)}
              onImporte={(importe) => cambiarImporte(m.id, importe)}
            />
          ))
        )}
      </tbody>
      {/* Sin fila de total: los totales viven en la cabecera, junto a la diferencia. */}
    </table>
  )
}
