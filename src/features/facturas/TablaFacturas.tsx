import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Donut } from '@/components/ui/Donut'
import {
  colorCancelacion,
  ROTULOS_COBRO,
  type Imputaciones,
  type RotulosImputacion,
} from '@/lib/cobros'
import { desdeIso, diasDeMora } from '@/lib/dates'
import { money } from '@/lib/format'
import { useDispatch } from '@/state/hooks'
import type { FacturaPendiente } from '@/types'
import { PanelImputacion } from './PanelImputacion'

interface TablaFacturasProps {
  facturas: readonly FacturaPendiente[]
  imputaciones: Imputaciones
  /**
   * Cómo se nombra la operación. Por defecto la COBRANZA; el módulo de PAGOS pasa los suyos. Sólo
   * cambian TEXTOS: el DOM, las animaciones y su contabilidad son exactamente los mismos.
   */
  rotulos?: RotulosImputacion
  /**
   * Qué hacer al marcar/desmarcar una fila y al editar su importe. Por defecto, las acciones del
   * COBRO. El módulo de PAGOS pasa las suyas, que operan sobre su propio estado: los dos circuitos
   * no comparten una sola clave, así que tampoco pueden compartir el dispatch.
   */
  onToggle?: (factura: FacturaPendiente) => void
  onImporte?: (id: string, importe: number) => void
  /**
   * Por qué esta fila NO se puede elegir, o `null` si se puede. Sin la prop, todas se pueden: es el
   * caso de COBROS, donde la consulta ya garantiza que todo lo que llega es imputable.
   *
   * Existe para lo que un filtro escondía: un comprobante al que el tablero no le cargó su importe
   * llega con saldo cero y no se le puede imputar nada, pero SÍ tiene que verse —si no, la pantalla
   * afirma que no existe—. El texto que devuelve se muestra en la fila y explica qué le falta.
   */
  bloqueada?: (factura: FacturaPendiente) => string | null
}

/**
 * A partir de acá la tabla scrollea en su propia caja en vez de estirar la página. Con más de ocho
 * comprobantes, el total a cancelar y el botón de avance quedaban fuera de pantalla justo cuando
 * más se los necesita: mientras se decide cuánto se cobra de cada factura.
 */
const MAX_FILAS_SIN_SCROLL = 8

/**
 * Cuánto dura el PLEGADO del panel, en ms. Tiene que coincidir con la animación `fact-plegar` de
 * `facturas.css`: es el tiempo que la fila sigue montada después de desmarcarse, para que la
 * salida se vea en vez de desaparecer de un corte.
 */
const MS_PLEGADO = 200

/**
 * Cuánto dura el DESPLIEGUE, en ms. Tiene que coincidir con la animación `fact-desplegar` de
 * `facturas.css`: es el tiempo que la fila queda marcada como "recién abierta" para animarse.
 */
const MS_DESPLIEGUE = 240

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
 * acción que ofrecer en este paso. Tampoco "Pagado" ni "Falta": lo cobrado ya se lee en el anillo
 * de "Pagado %" y lo que falta ES el saldo pendiente, que tiene su propia columna —eran
 * las dos el mismo dato dicho por segunda vez—.
 *
 * Las filas llegan ordenadas por vencimiento, de la más vieja a la más nueva (ver el servicio de
 * facturas): la tabla las dibuja en el orden en que las recibe.
 */
export function TablaFacturas({
  facturas,
  imputaciones,
  rotulos = ROTULOS_COBRO,
  onToggle,
  onImporte,
  bloqueada,
}: TablaFacturasProps) {
  const dispatch = useDispatch()
  /* Las acciones del COBRO son el caso por defecto: es el circuito para el que se escribió la
     tabla, y dejarlas acá evita que sus tres usos tengan que pasarlas una por una. */
  const alternar = onToggle ?? ((f: FacturaPendiente) => dispatch({ type: 'toggleFactura', factura: f }))
  const cambiarImporte =
    onImporte ??
    ((id: string, importe: number) => dispatch({ type: 'setImporteFactura', id, importe }))
  /* Facturas que se están PLEGANDO: ya no están imputadas, pero su panel sigue montado —con el
     último importe que tuvieron— hasta que termina la animación de salida. Sin esto, desmarcar
     desmonta la fila en el acto y el panel desaparece de un corte. */
  const [plegando, setPlegando] = useState<Record<string, number>>({})
  /* Facturas que se ACABAN de marcar en esta pantalla: son las únicas que se despliegan animadas.
     La marca dura lo que dura la animación y se borra sola. Sin esto, la animación también corría
     al MONTAR la tabla —al volver al paso con el stepper—, y las facturas ya elegidas se abrían de
     nuevo delante del usuario como si las acabara de tildar. */
  const [abriendo, setAbriendo] = useState<Set<string>>(() => new Set())
  /* Imputaciones del render anterior. Arranca con las actuales a propósito: en el primer render
     "no cambió nada", así que lo que ya venía elegido no se anima ni al abrir ni al cerrar. */
  const previas = useRef<Imputaciones>(imputaciones)

  /* ANTES de pintar, no despues. Es un `useLayoutEffect` a proposito y no un `useEffect`: la
     contabilidad de la animacion tiene que quedar lista en el MISMO cuadro en que cambia la
     imputacion.

     Con `useEffect` el navegador alcanzaba a pintar un cuadro intermedio, y ese cuadro era el
     parpadeo: al DESMARCAR, el render que quita la imputacion deja la fila sin `fact-grupo--on`
     —se apagan de golpe su fondo, su barra azul y su borde inferior transparente— y desmonta el
     panel entero; recien el efecto posterior la marcaba como "plegandose" y volvia a montarlo para
     animar la salida. Todo eso se veia: apagon, reaparicion y recien ahi el cierre.
     Al MARCAR pasaba lo simetrico: el panel se montaba abierto del todo por un cuadro y despues
     saltaba a cero para desplegarse.

     `useLayoutEffect` corre despues de tocar el DOM pero antes del pintado, asi que ese estado
     intermedio nunca llega a la pantalla. */
  useLayoutEffect(() => {
    const antes = previas.current
    previas.current = imputaciones
    const nuevas = Object.keys(imputaciones).filter((id) => !(id in antes))
    const quitadas = Object.keys(antes).filter((id) => !(id in imputaciones))
    if (nuevas.length === 0 && quitadas.length === 0) return

    setAbriendo((actual) => {
      const proximo = new Set(actual)
      for (const id of nuevas) proximo.add(id)
      // Una factura que se cierra deja de estar "recién abierta".
      for (const id of quitadas) proximo.delete(id)
      return proximo
    })
    if (quitadas.length > 0) {
      setPlegando((actual) => ({
        ...actual,
        ...Object.fromEntries(quitadas.map((id) => [id, antes[id]])),
      }))
    }

    const timers = [
      // Terminada la animación de salida, la fila se desmonta de verdad.
      quitadas.length > 0 &&
        setTimeout(() => {
          setPlegando((actual) => {
            const resto = { ...actual }
            for (const id of quitadas) delete resto[id]
            return resto
          })
        }, MS_PLEGADO),
      /* Terminado el despliegue se quita la marca: si la fila se vuelve a montar por otro motivo
         —un filtro que la saca y la trae— ya no tiene por qué animarse. */
      nuevas.length > 0 &&
        setTimeout(() => {
          setAbriendo((actual) => {
            const proximo = new Set(actual)
            for (const id of nuevas) proximo.delete(id)
            return proximo
          })
        }, MS_DESPLIEGUE),
    ].filter((t): t is ReturnType<typeof setTimeout> => t !== false)

    return () => timers.forEach(clearTimeout)
  }, [imputaciones])
  /* Las bloqueadas no cuentan para "todas seleccionadas": no se pueden elegir, así que exigirlas
     dejaría la casilla del encabezado apagada para siempre. */
  const seleccionables = bloqueada ? facturas.filter((f) => !bloqueada(f)) : facturas
  const elegidas = seleccionables.filter((f) => f.id in imputaciones).length
  const todas = seleccionables.length > 0 && elegidas === seleccionables.length
  const algunas = elegidas > 0 && !todas
  const refTodas = useRef<HTMLInputElement>(null)

  /* El estado "algunas seleccionadas" no se puede expresar en el atributo `checked`: es una
     propiedad del nodo. Sin esto, con selección parcial la casilla se vería vacía. */
  useEffect(() => {
    if (refTodas.current) refTodas.current.indeterminate = algunas
  }, [algunas])

  /** Marca o desmarca TODAS: si ya estaban todas, la casilla del encabezado las libera. */
  const alternarTodas = () => {
    for (const f of seleccionables) {
      const elegida = f.id in imputaciones
      if (todas === elegida) alternar(f)
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
                disabled={seleccionables.length === 0}
                onChange={alternarTodas}
                aria-label={rotulos.ariaTodas}
              />
            </th>
            <th>{rotulos.colNro}</th>
            <th className="fact-col-cen">Vencimiento</th>
            <th className="fact-col-cen">Días de Mora</th>
            <th className="fact-col-cen">{rotulos.colTotal}</th>
            <th className="fact-col-cen">{rotulos.colPendiente}</th>
            <th className="fact-col-cen">{rotulos.colPagado}</th>
            <th>Estado</th>
          </tr>
        </thead>

        {facturas.map((f) => {
          /* Por qué esta fila no se puede tocar. Se resuelve una vez y lo miran los tres lugares
             que dependen de ella: la casilla, el renglón de aviso y el panel desplegable. */
          const motivoBloqueo = bloqueada?.(f) ?? null
          const elegida = f.id in imputaciones
          /* Mientras se pliega, el panel sigue mostrando el último importe: animar un campo que se
             vacía justo al cerrarse se vería como un parpadeo. */
          const seCierra = !elegida && f.id in plegando
          const importe = elegida ? imputaciones[f.id] : plegando[f.id]
          const vence = desdeIso(f.vencimiento)
          const vencida = (diasDeMora(f.vencimiento) ?? 0) > 0
          return (
            /* Un `tbody` por factura mantiene la fila y su panel como una sola unidad. */
            /* La fila conserva su fondo de elegida mientras se pliega: si lo perdiera de golpe, el
               color saltaría antes de que el panel termine de cerrarse. */
            <tbody
              key={f.id}
              className={`fact-grupo ${elegida || seCierra ? 'fact-grupo--on' : ''}`}
            >
              <tr className="fact-row">
                <td className="fact-col-check">
                  <input
                    type="checkbox"
                    className="fact-check"
                    checked={elegida}
                    disabled={!!motivoBloqueo}
                    title={motivoBloqueo ?? undefined}
                    onChange={() => alternar(f)}
                    aria-label={rotulos.ariaIncluir(f.nro)}
                  />
                </td>
                <td>
                  <span className="fact-nro">{f.nro}</span>
                  {/* Nombre del ítem: el ID de la venta que dejó esta deuda. En PAGOS no hay
                      tal cosa —la fila se identifica con un solo dato—, así que el renglón no se
                      monta en vez de mostrarse vacío. */}
                  {rotulos.mostrarVinculo && (
                    <span className="fact-venta">
                      {f.idVenta || <span className="fact-mora-sd">Sin venta vinculada</span>}
                    </span>
                  )}
                  {/* Qué le falta a la fila para poder usarse. Va en el renglón de abajo del
                      comprobante —no en un tooltip— porque es el motivo por el que su casilla está
                      apagada, y un motivo que hay que descubrir pasando el mouse no es un motivo. */}
                  {motivoBloqueo && (
                    <span className="fact-venta fact-fila-aviso">
                      <i className="fas fa-triangle-exclamation" /> {motivoBloqueo}
                    </span>
                  )}
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
                <td>
                  <span className={`fact-estado ${f.parcial ? 'is-parcial' : 'is-pendiente'}`}>
                    <span className="fact-estado-dot" />
                    {f.estado}
                  </span>
                </td>
              </tr>

              {(elegida || seCierra) && (
                <tr className="fact-exp">
                  <td colSpan={8}>
                    {/* Dos envoltorios para poder animar el DESPLIEGUE: el de afuera anima su alto
                        (de 0fr a 1fr) y el de adentro recorta lo que todavía no entra. Sin esto el
                        panel aparecía de golpe y empujaba la tabla de un salto. */}
                    <div
                      className={`fact-exp-wrap ${
                        seCierra
                          ? 'fact-exp-wrap--cerrando'
                          : abriendo.has(f.id)
                            ? 'fact-exp-wrap--abriendo'
                            : ''
                      }`}
                    >
                      <div className="fact-exp-in">
                        <PanelImputacion
                          factura={f}
                          importe={importe}
                          rotulos={rotulos}
                          onImporte={(valor) => cambiarImporte(f.id, valor)}
                        />
                      </div>
                    </div>
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
