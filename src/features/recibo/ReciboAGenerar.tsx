import { useEffect, useRef, useState, type ReactNode } from 'react'
import { money } from '@/lib/format'
import { SIN_DATO, type Recibo } from '@/lib/recibo'
import type { FaseEmision } from '@/types'

interface ReciboAGenerarProps {
  /** Las dos tablas del documento y sus totales, ya armadas por `lib/recibo`. */
  recibo: Recibo
  /** En qué anda la emisión: gobierna el tilde y el rótulo de estado de la cabecera. */
  fase: FaseEmision
  /** Etiqueta del estado que publica el tablero. Es la que se muestra mientras se emite. */
  estado: string
  /**
   * Importe del ANTICIPO cuando el recibo es de ese tipo; `null` en un cobro. Ocupa el lugar de la
   * tabla de comprobantes: un anticipo no cancela facturas, declara dinero a cuenta.
   */
  anticipo?: number | null
}

/**
 * Cuánto dura el PLEGADO, en ms. Tiene que coincidir con la animación `rec-plegar` de `recibo.css`:
 * es el tiempo que el cuerpo sigue montado después de cerrarse, para que la salida se vea en vez de
 * desaparecer de un corte.
 *
 * Son los MISMOS tiempos que el despliegue de las facturas pendientes (ver `TablaFacturas`): abrir y
 * cerrar algo tiene que sentirse igual en toda la app.
 */
const MS_PLEGADO = 200

/** Cuánto dura el DESPLIEGUE. Coincide con `rec-desplegar`. */
const MS_DESPLIEGUE = 240

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
export function ReciboAGenerar({ recibo, fase, estado, anticipo = null }: ReciboAGenerarProps) {
  const [abierta, setAbierta] = useState(true)
  /* Cuerpo que se está PLEGANDO: ya está cerrado, pero sigue montado hasta que termina la animación
     de salida. Sin esto, cerrar lo desmonta en el acto y desaparece de un corte. */
  const [cerrando, setCerrando] = useState(false)
  /* Cuerpo recién abierto: es el único que se anima. La marca dura lo que dura la animación y se
     borra sola, así la card no se despliega de nuevo en la cara del usuario cuando el componente se
     re-renderiza por otro motivo —el estado de la emisión cambia varias veces—.

     Arranca APAGADA aunque la card nazca abierta: al montarse no hay nada que animar. */
  const [abriendo, setAbriendo] = useState(false)
  const reloj = useRef<ReturnType<typeof setTimeout>>()

  // Al desmontar (cambio de paso, fin de la operación) no puede quedar un temporizador buscándolo.
  useEffect(() => () => clearTimeout(reloj.current), [])

  /** Abre o cierra el cuerpo, dejándolo montado el tiempo que dura la animación de salida. */
  const alternar = () => {
    // Abrir y cerrar rápido no puede dejar dos animaciones peleándose por el mismo cuerpo.
    clearTimeout(reloj.current)
    if (abierta) {
      setAbierta(false)
      setAbriendo(false)
      setCerrando(true)
      reloj.current = setTimeout(() => setCerrando(false), MS_PLEGADO)
      return
    }
    setCerrando(false)
    setAbierta(true)
    setAbriendo(true)
    reloj.current = setTimeout(() => setAbriendo(false), MS_DESPLIEGUE)
  }

  /* El cuerpo está en pantalla mientras se lo lee Y mientras se pliega: hasta que la salida termina,
     la card sigue siendo una card abierta. */
  const visible = abierta || cerrando
  const { comprobantes, pagos, totalEntregado } = recibo
  const enCurso = fase === 'creando' || fase === 'emitiendo'
  const emitido = fase === 'emitido'
  /* Un anticipo no tiene comprobantes que cancelar: lo que el recibo declara es su importe, y ése
     es su total cancelado. Es la misma línea que se escribe como subelemento en Monday. */
  const esAnticipo = anticipo !== null
  const totalCancelado = esAnticipo ? anticipo : recibo.totalCancelado

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
              Recibo
              <span className="pbadge">{esAnticipo ? 'Anticipo' : 'Documento de cobro'}</span>
            </span>
          </button>

          <div className="comp-head-datos">
            <Dato rotulo={esAnticipo ? 'Concepto' : 'Comprobantes'}>
              {esAnticipo ? 'Anticipo' : comprobantes.length}
            </Dato>
            <Dato rotulo="Formas de pago">{pagos.length}</Dato>
            <Dato rotulo="Importe del recibo" fuerte>
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
                  ? `Error al emitir el recibo${estado ? ` · ${estado}` : ''}`
                  : enCurso
                    ? `Emitiendo el recibo${estado ? ` · ${estado}` : ''}`
                    : emitido
                      ? `Recibo emitido${estado ? ` · ${estado}` : ''}`
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
            <p className="rec-leyenda">RECIBIMOS CONFORME EL IMPORTE DETALLADO.</p>

            {/* --- Tabla 1 · las formas de pago con las que el cliente entregó el dinero --- */}
            <table className="comp-table rec-tabla">
              <thead>
                <tr>
                  <th>Forma de pago / Caja</th>
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
            <h4 className="rec-sub">{esAnticipo ? 'Anticipo' : 'Comprobantes'}</h4>
            {esAnticipo ? (
              <table className="comp-table rec-tabla">
                <thead>
                  <tr>
                    <th>Concepto</th>
                    <th className="ta-r">Importe</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <span className="rec-comp">Anticipo</span>
                    </td>
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
    </div>
  )
}
