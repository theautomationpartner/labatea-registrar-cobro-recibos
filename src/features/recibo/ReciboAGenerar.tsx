import type { ReactNode } from 'react'
import { money } from '@/lib/format'
import { usePlegable } from './usePlegable'
import { SIN_DATO, type Recibo } from '@/lib/recibo'
import type { FaseEmision } from '@/types'

/**
 * Los textos que cambian entre el RECIBO y la ORDEN DE PAGO. La card es la misma —cabecera con sus
 * tres métricas y el detalle desplegable con las dos tablas—, y lo único que se diferencia es cómo
 * se nombra el documento y su leyenda.
 *
 * Las TRES métricas de la cabecera y los dos totales del pie no están acá: son los mismos números
 * dichos igual en los dos documentos.
 */
export interface RotulosDocumento {
  /** Nombre del documento en la cabecera de la card. */
  titulo: string
  /** Pastilla que lo clasifica ("Documento de cobro" / "Documento de pago"). */
  badge: string
  /** Rótulo de la métrica del importe total. */
  importe: string
  /** Título de la tabla de lo que el documento cancela. */
  tablaCancelado: string
  /**
   * Leyenda legal arriba de la tabla de pagos. `null` = no se dibuja: una orden de pago no recibe
   * nada, así que "RECIBIMOS CONFORME…" sería falso.
   */
  leyenda: string | null
  /**
   * Cómo se muestra la línea del ANTICIPO, que ocupa el lugar de los comprobantes cuando el
   * documento no cancela facturas. Los dos circuitos la publican distinto en el PDF que emite el
   * tablero, y la card tiene que decir lo MISMO que el documento que se va a generar.
   */
  tablaAnticipo: {
    /** Título de la tabla. */
    titulo: string
    /** Encabezado de la columna que nombra la línea. */
    columna: string
    /** Encabezado de la columna del importe. */
    importe: string
    /**
     * Con las dos fechas del anticipo —emisión y vencimiento—, como las lleva la orden de pago
     * emitida. El recibo no las publica, así que allá la tabla se queda en dos columnas.
     */
    conFechas: boolean
  }
}

/** Los rótulos del RECIBO. Rigen si no se pasa ninguno: es el circuito original. */
export const ROTULOS_DOC_RECIBO: RotulosDocumento = {
  titulo: 'Recibo',
  badge: 'Documento de cobro',
  importe: 'Importe del recibo',
  tablaCancelado: 'Comprobantes',
  leyenda: 'RECIBIMOS CONFORME EL IMPORTE DETALLADO.',
  tablaAnticipo: {
    titulo: 'Anticipo',
    columna: 'Concepto',
    importe: 'Importe',
    conFechas: false,
  },
}

/** Los rótulos de la ORDEN DE PAGO: la misma card con el vocabulario del egreso. */
export const ROTULOS_DOC_OP: RotulosDocumento = {
  titulo: 'Orden de Pago',
  badge: 'Documento de pago',
  importe: 'Importe de la orden',
  tablaCancelado: 'Facturas Canceladas',
  /* SIN leyenda: la orden no declara haber recibido nada, declara lo que se entrega. */
  leyenda: null,
  /* El MISMO vocabulario que el PDF de la orden: "Entrega de Anticipos", las dos fechas y el
     importe cancelado. */
  tablaAnticipo: {
    titulo: 'Entrega de Anticipos',
    columna: 'Anticipos',
    importe: 'Importe Cancelado',
    conFechas: true,
  },
}

/**
 * La línea del ANTICIPO tal como la publica el documento. El importe es lo único que el recibo
 * necesita; la orden de pago declara además con qué NOMBRE se escribe la línea en el tablero y sus
 * dos fechas, que es lo que sale impreso.
 */
export interface LineaAnticipo {
  /** Lo entregado a cuenta. Es el total cancelado del documento. */
  importe: number
  /** Cómo se nombra la línea. Por defecto, "Anticipo" a secas. */
  nombre?: string
  /** Fecha de emisión, si el documento la declara. */
  emision?: string
  /** Vencimiento del anticipo, en dd/mm/aaaa. */
  vencimiento?: string
}

interface ReciboAGenerarProps {
  /** Las dos tablas del documento y sus totales, ya armadas por `lib/recibo`. */
  recibo: Recibo
  /** En qué anda la emisión: gobierna el tilde y el rótulo de estado de la cabecera. */
  fase: FaseEmision
  /** Etiqueta del estado que publica el tablero. Es la que se muestra mientras se emite. */
  estado: string
  /**
   * La línea del ANTICIPO cuando el documento es de ese tipo; `null` en un cobro o en un pago
   * contra facturas. Ocupa el lugar de la tabla de comprobantes: un anticipo no cancela facturas,
   * declara dinero a cuenta.
   */
  anticipo?: LineaAnticipo | null
  /** Cómo se nombra el documento. Por defecto, el RECIBO. */
  rotulos?: RotulosDocumento
  /**
   * Encabezado de la primera columna de la tabla de lo ENTREGADO. Por defecto nombra las cajas, que
   * es lo que esa tabla lista casi siempre.
   *
   * Lo pisa la APLICACIÓN de anticipos: ahí no entró plata por ninguna caja —lo que cubre las
   * facturas es el saldo a favor que ya estaba—, así que la columna lista anticipos y llamarla
   * "Forma de pago / Caja" nombraba algo que no está en la tabla.
   */
  columnaEntregado?: string
  /** Cards que se emiten junto con el documento y se dibujan debajo de la suya. */
  children?: ReactNode
}

/** Métrica de la cabecera: rótulo chico arriba y el dato debajo. */
function Dato({ rotulo, children, fuerte }: { rotulo: string; children: ReactNode; fuerte?: boolean }) {
  return (
    <div className="comp-head-dato">
      <span className="comp-head-lbl">{rotulo}</span>
      <span className={`comp-head-val ${fuerte ? 'comp-head-val--imp' : ''}`}>{children}</span>
    </div>
  )
}

/** Dato del documento que el tablero no tiene cargado: se marca, no se deja en blanco. */
const oDato = (valor: string) => valor || <span className="rec-sd">{SIN_DATO}</span>

/**
 * El recibo que se va a emitir: las FORMAS DE PAGO recibidas con su total entregado y los
 * COMPROBANTES que se cancelan con su total cancelado.
 *
 * NO repite la cabecera del documento (título, número y fecha) ni los datos fiscales del cliente:
 * de eso ya se ocupa el resumen de la izquierda, y acá sólo agregaba una segunda copia de lo mismo
 * en la misma pantalla. Esos datos van igual en el PDF que emite el tablero.
 *
 * Es la misma card plegable que la de un comprobante en la emisión de la factura —cabecera siempre
 * visible con lo que hace falta para decidir, y el detalle desplegable debajo—: el documento cambia,
 * la gramática de la pantalla no.
 *
 * Los dos totales se muestran al pie de SU tabla, cada uno cerrando lo suyo: es lo que hace evidente
 * que lo entregado por el cliente y lo cancelado de sus facturas son el mismo importe.
 */
export function ReciboAGenerar({
  recibo,
  fase,
  estado,
  anticipo = null,
  rotulos = ROTULOS_DOC_RECIBO,
  columnaEntregado = 'Forma de pago / Caja',
  children,
}: ReciboAGenerarProps) {
  const { abierta, abriendo, cerrando, visible, alternar } = usePlegable()
  const { comprobantes, pagos, totalEntregado } = recibo
  const enCurso = fase === 'creando' || fase === 'emitiendo'
  const emitido = fase === 'emitido'
  /* Un anticipo no tiene comprobantes que cancelar: lo que el recibo declara es su importe, y ése
     es su total cancelado. Es la misma línea que se escribe como subelemento en Monday. */
  const esAnticipo = anticipo !== null
  const totalCancelado = esAnticipo ? anticipo.importe : recibo.totalCancelado

  return (
    <div className="comprobantes">
      <div className="comprobantes-head">
        <h3 className="resumen-title">Comprobante a generar</h3>
      </div>

      <div className="comp-card">
        <div className="comp-head">
          <button
            type="button"
            className="comp-toggle"
            aria-expanded={abierta}
            onClick={alternar}
          >
            <i className={`fas fa-chevron-down comp-chev ${abierta ? 'open' : ''}`} />
            <span className="comp-tit">
              {rotulos.titulo}
              <span className="pbadge">{esAnticipo ? 'Anticipo' : rotulos.badge}</span>
            </span>
          </button>

          <div className="comp-head-datos">
            <Dato rotulo={esAnticipo ? 'Concepto' : 'Comprobantes'}>
              {esAnticipo ? 'Anticipo' : comprobantes.length}
            </Dato>
            <Dato rotulo="Formas de pago">{pagos.length}</Dato>
            <Dato rotulo={rotulos.importe} fuerte>
              {money(totalCancelado)}
            </Dato>
          </div>

          {/* Semáforo de la emisión, SÓLO ícono: gira mientras se emite, queda tildado en verde al
              cerrar bien y en rojo si el tablero devolvió un error.

              El texto que lo acompañaba se fue: decía lo mismo que el color y cambiaba de ancho en
              cada fase, corriendo las tres métricas de al lado cada vez que el estado avanzaba. Lo
              que el ícono no puede decir viaja en su `title`, que ahora cubre las CUATRO fases y no
              sólo dos. */}
          <span className="comp-estado">
            <span
              className={`comp-ok ${emitido ? 'on' : ''} ${fase === 'error' ? 'comp-ok--err' : ''}`}
              title={
                fase === 'error'
                  ? `Error al emitir · ${rotulos.titulo}${estado ? ` · ${estado}` : ''}`
                  : enCurso
                    ? `Emitiendo · ${rotulos.titulo}${estado ? ` · ${estado}` : ''}`
                    : emitido
                      ? `${rotulos.titulo} emitido${estado ? ` · ${estado}` : ''}`
                      : 'Pendiente de emisión'
              }
            >
              <i
                className={`fas ${
                  fase === 'error'
                    ? 'fa-triangle-exclamation'
                    : enCurso
                      ? 'fa-circle-notch fa-spin'
                      : 'fa-check'
                }`}
              />
            </span>
          </span>
        </div>

        {visible && (
          /* Dos envoltorios para poder animar el DESPLIEGUE: el de afuera anima su alto (de 0fr a
             1fr) y el de adentro recorta lo que todavía no entra. Es el MISMO mecanismo del panel de
             las facturas pendientes.

             El relleno se queda en `comp-body`, o sea DENTRO del área recortada: el padding no se
             encoge con la grilla —a 0fr el contenido mide 0 pero el relleno sigue ocupando su
             lugar—, así que afuera dejaría un salto de 18px al empezar y al terminar. */
          <div
            className={`rec-exp-wrap ${
              cerrando ? 'rec-exp-wrap--cerrando' : abriendo ? 'rec-exp-wrap--abriendo' : ''
            }`}
          >
            <div className="rec-exp-in">
              <div className="comp-body">
            {/* Leyenda legal. En una ORDEN DE PAGO no se dibuja: el documento no declara haber
                recibido nada (ver `ROTULOS_DOC_OP`). */}
            {rotulos.leyenda && <p className="rec-leyenda">{rotulos.leyenda}</p>}

            {/* --- Tabla 1 · las formas de pago con las que el cliente entregó el dinero --- */}
            <table className="comp-table rec-tabla">
              <thead>
                <tr>
                  <th>{columnaEntregado}</th>
                  <th>Nro de Comprobante</th>
                  <th className="ta-r">Importe Entregado</th>
                </tr>
              </thead>
              <tbody>
                {pagos.length === 0 ? (
                  <tr className="rec-vacia">
                    <td colSpan={3}>El cobro no tiene formas de pago registradas.</td>
                  </tr>
                ) : (
                  pagos.map((p) => (
                    <tr key={p.id}>
                      <td className="rec-pago">{p.descripcion}</td>
                      <td>{oDato(p.comprobante)}</td>
                      <td className="ta-r rec-imp">{money(p.entregado)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            <div className="rec-total">
              <span className="rec-total-lbl">TOTAL ENTREGADO:</span>
              <span className="rec-total-val">{money(totalEntregado)}</span>
            </div>

            {/* --- Tabla 2 · qué cancela este recibo ---
                En un cobro son las facturas imputadas; en un anticipo, una sola línea con el
                importe entregado a cuenta —exactamente el subelemento "Anticipo" que se escribe en
                el tablero—. */}
            <h4 className="rec-sub">
              {esAnticipo ? rotulos.tablaAnticipo.titulo : rotulos.tablaCancelado}
            </h4>
            {esAnticipo ? (
              <table className="comp-table rec-tabla">
                <thead>
                  <tr>
                    <th>{rotulos.tablaAnticipo.columna}</th>
                    {/* Las fechas sólo donde el documento las publica: en el recibo la tabla se
                        queda en dos columnas, como estaba. */}
                    {rotulos.tablaAnticipo.conFechas && (
                      <>
                        <th>Fecha Emisión</th>
                        <th>Fecha Venc.</th>
                      </>
                    )}
                    <th className="ta-r">{rotulos.tablaAnticipo.importe}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      {/* El MISMO nombre que lleva el subelemento en el tablero: la card muestra
                          la línea que se va a escribir, no una etiqueta parecida. */}
                      <span className="rec-comp">{anticipo.nombre ?? 'Anticipo'}</span>
                    </td>
                    {rotulos.tablaAnticipo.conFechas && (
                      <>
                        <td className="rec-fecha">{oDato(anticipo.emision ?? '')}</td>
                        <td className="rec-fecha">{oDato(anticipo.vencimiento ?? '')}</td>
                      </>
                    )}
                    <td className="ta-r rec-imp">{money(totalCancelado)}</td>
                  </tr>
                </tbody>
              </table>
            ) : (
            <table className="comp-table rec-tabla">
              <thead>
                <tr>
                  <th>Comprobante</th>
                  <th>Fecha Emisión</th>
                  <th>Fecha Venc.</th>
                  <th className="ta-r">Importe Cancelado</th>
                </tr>
              </thead>
              <tbody>
                {comprobantes.length === 0 ? (
                  <tr className="rec-vacia">
                    <td colSpan={4}>El cobro no tiene facturas imputadas.</td>
                  </tr>
                ) : (
                  comprobantes.map((c) => (
                    <tr key={c.id}>
                      <td>
                        {/* El anticipo no es una factura: se nombra por su concepto, sin el
                            prefijo que llevan los comprobantes del tablero. */}
                        <span className="rec-comp">
                          {c.esAnticipo ? c.nro : `Factura ${c.nro}`}
                        </span>
                      </td>
                      <td className="rec-fecha">{oDato(c.emision)}</td>
                      <td className="rec-fecha">{oDato(c.vencimiento)}</td>
                      <td className="ta-r rec-imp">{money(c.cancelado)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            )}

                <div className="rec-total">
                  <span className="rec-total-lbl">TOTAL CANCELADO:</span>
                  <span className="rec-total-val">{money(totalCancelado)}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Otras cards que se generan JUNTO con este documento —hoy, la constancia de retención de la
          orden de pago—. Van acá adentro para quedar bajo el mismo "Comprobante a generar": son
          parte de la misma emisión, no una sección aparte. */}
      {children}
    </div>
  )
}
