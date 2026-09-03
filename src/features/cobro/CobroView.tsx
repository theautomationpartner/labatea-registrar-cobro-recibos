import { useMemo, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { totalACancelar } from '@/lib/cobros'
import { money } from '@/lib/format'
import {
  ANTICIPO_COBRO_EXIGE_DETALLE_Y_VENC,
  bloqueoAnticipo,
  bloqueoCobro,
  faltantesDeAnticipo,
  cobroCubierto,
  diferenciaSaldada,
  MSG_COBRO_CUBIERTO,
  MSG_EXCESO,
  resumenCobro,
  type BloqueoCobro,
} from '@/lib/pagos'
import {
  descripcionDePaso,
  etiquetaDePaso,
  numeroDePaso,
  pasoAnterior,
  siguientePaso,
} from '@/lib/pasos'
import { useApp, useDispatch } from '@/state/hooks'
import { CabeceraCobro } from './CabeceraCobro'
import { FormularioCobro } from './FormularioCobro'
import { DatosAnticipo } from './DatosAnticipo'
import { TablaMovimientos } from './TablaMovimientos'

/**
 * Paso de registro: con qué medios entrega el dinero el cliente. Sirve a los DOS recorridos y la
 * única diferencia entre ellos es de dónde sale el TOTAL A CANCELAR:
 *
 *   · COBRO    · de la imputación a facturas del paso anterior (`totalACancelar`), el mismo
 *                selector que muestra el pie de ese paso. Acá no se calcula nada.
 *   · ANTICIPO · no hay facturas: el importe lo declara el usuario en el campo de arriba, porque
 *                el anticipo es dinero a cuenta y su monto es la decisión del cliente.
 *
 * De ahí en adelante la etapa decide una sola cosa —que lo recibido iguale ese total— y esa es la
 * única condición para avanzar, igual en los dos casos.
 */
export function CobroView() {
  const { cliente, imputaciones, cobro, tipoOperacion, importeAnticipo, detalleAnticipo, vencimientoAnticipo } =
    useApp()
  const dispatch = useDispatch()
  // Motivo por el que no se puede avanzar, mostrado al intentarlo.
  const [aviso, setAviso] = useState<BloqueoCobro | null>(null)

  const esAnticipo = tipoOperacion === 'anticipo'
  const total = esAnticipo ? importeAnticipo : totalACancelar(imputaciones)
  const facturasElegidas = Object.keys(imputaciones).length
  const resumen = useMemo(
    () => resumenCobro(cobro.movimientos, total),
    [cobro.movimientos, total],
  )
  const datosAnticipo = {
    importe: importeAnticipo,
    detalle: detalleAnticipo,
    vencimiento: vencimientoAnticipo,
  }
  const bloqueo = esAnticipo
    ? bloqueoAnticipo(datosAnticipo, cobro.movimientos, resumen)
    : bloqueoCobro(cobro.movimientos, resumen)

  /* Sin el IMPORTE del anticipo no se puede cargar cómo lo entrega el cliente: es el total que esos
     pagos tienen que igualar, así que registrarlos antes sería cargar contra un total que todavía
     no existe. El formulario queda cerrado hasta que esté.

     El detalle y el vencimiento NO cierran nada: describen al anticipo, no lo definen, y su falta
     no impide ni registrarlo ni emitir el recibo. */
  const faltaAnticipo = esAnticipo
    ? faltantesDeAnticipo(datosAnticipo, ANTICIPO_COBRO_EXIGE_DETALLE_Y_VENC)
    : []

  /* Con el cobro ya cubierto el formulario se cierra: otro movimiento sólo podría pasarse del total
     (ver `cobroCubierto`). La tabla NO se toca —sus importes siguen editables y sus filas se pueden
     quitar—, que es justamente por dónde se vuelve a abrir. */
  const cubierto = cobroCubierto(resumen)

  /* Adónde se va y de dónde se vuelve, según el recorrido: el anticipo no pasa por las ventas
     pendientes, así que su "Volver" lleva a la selección de cliente. */
  const destino = siguientePaso('cobro', tipoOperacion)
  const anterior = pasoAnterior('cobro', tipoOperacion)
  const SIGUIENTE_PASO = destino ? etiquetaDePaso(destino, tipoOperacion) : ''

  const continuar = () => {
    /* El botón NUNCA se apaga: si algo falta, la ventana dice exactamente qué, en vez de dejar un
       botón muerto que el usuario no sabe por qué no responde. */
    if (bloqueo) {
      setAviso(bloqueo)
      return
    }
    dispatch({ type: 'confirmarCobro' })
    if (destino) dispatch({ type: 'goto', paso: destino })
  }

  /* Aviso en vivo del cobro, en UN solo lugar: cuánto falta cargar o cuánto se pasó. Los dos casos
     comparten renglón —el mismo, debajo de la tabla— porque son la misma pregunta contestada de dos
     maneras, y así alternar entre ellos no mueve nada de lugar.

     Una diferencia de centavos NO aparece: el cobro ya se da por cancelado, así que señalarla sería
     pedir que se corrija algo que no frena nada. */
  const avisoDif = diferenciaSaldada(resumen)
    ? null
    : resumen.diferencia > 0
      ? {
          tono: 'info' as const,
          icono: 'fa-circle-info',
          texto: `Faltan ${money(resumen.diferencia)} para cubrir el total a cancelar.`,
        }
      : {
          /* El MISMO texto que la ventana de bloqueo: es el mismo problema, y decirlo distinto en
             cada lugar haría dudar de si son dos. */
          tono: 'err' as const,
          icono: 'fa-circle-exclamation',
          texto: MSG_EXCESO(-resumen.diferencia, !esAnticipo),
        }

  /* Un solo renglón de aviso para todo el paso. El bloqueo del anticipo tiene PRIORIDAD sobre la
     diferencia: mientras falten sus datos no se puede cargar nada, así que decir cuánto falta para
     cubrir un total que todavía no está definido sólo confundiría. */
  const avisoDiferencia =
    faltaAnticipo.length > 0
      ? {
          tono: 'info' as const,
          icono: 'fa-circle-info',
          texto: `Para cargar cómo entrega el anticipo el cliente, completá arriba: ${faltaAnticipo.join(', ')}.`,
        }
      : /* Cubierto: el formulario está cerrado y hay que decir POR QUÉ. Sin este renglón el paso
           quedaba gris y mudo justo cuando el cobro terminó bien, que se lee como una falla. Va en
           verde: no es un problema a corregir, es el trabajo terminado. */
        cubierto
        ? {
            tono: 'ok' as const,
            icono: 'fa-circle-check',
            texto: MSG_COBRO_CUBIERTO,
          }
        : avisoDif

  return (
    <section className="view cobro-v2 paso-layout">
      <PasoHeader />

      <div className="paso-body">
        <PasoTitulo
          numero={numeroDePaso('cobro', tipoOperacion)}
          titulo={etiquetaDePaso('cobro', tipoOperacion)}
          descripcion={descripcionDePaso('cobro', tipoOperacion)}
        />

        {!cliente ? (
          <div className="cobro-static">
            <div className="cobro-card">
              <p className="cobro-vacio">
                <i className="fas fa-user-slash" /> Todavía no hay un cliente seleccionado. Volvé al
                paso 1 para elegirlo.
              </p>
            </div>
          </div>
        ) : (
          <div className="cobro-static">
            {/* Los datos del anticipo ABREN el panel: son la premisa de todo lo que sigue —de su
                importe sale el total a cancelar—, así que se declaran antes de que las métricas
                muestren contra qué se está comparando lo recibido. */}
            {esAnticipo && (
              <DatosAnticipo
                exigeDetalleYVencimiento={ANTICIPO_COBRO_EXIGE_DETALLE_Y_VENC}
                /* El anticipo del CLIENTE no vence: queda a su favor hasta que se aplique contra
                   una factura, así que el campo no se muestra. */
                sinVencimiento
              />
            )}

            <CabeceraCobro
              cliente={cliente}
              resumen={resumen}
              /* En el anticipo no hay facturas que contar: el dato no se muestra en vez de
                 mostrarse en cero, que sería decir que se eligieron cero facturas. */
              facturas={esAnticipo ? null : facturasElegidas}
            />

            <div className="cobro-card">
              <h3 className="cobro-card-title">
                {esAnticipo ? 'Registrar anticipo' : 'Registrar cobro'}
              </h3>
              <p className="cobro-card-desc">
                {esAnticipo
                  ? 'Especificar cómo entregó el anticipo el cliente'
                  : 'Especificar cómo pagó el cliente'}
              </p>

              {/* La diferencia la usa la TARJETA para precargar su importe según en cuántos
                  plásticos se parta el cobro. Los demás medios no la miran. */}
              <FormularioCobro
                bloqueado={faltaAnticipo.length > 0 || cubierto}
                diferencia={resumen.diferencia}
              />

              <h4 className="cobro-card-sub">Cobros registrados ({cobro.movimientos.length})</h4>
              <TablaMovimientos movimientos={cobro.movimientos} />

              {/* La franja del aviso se monta SIEMPRE, con o sin mensaje: es lo que reserva su
                  lugar. Lo que aparece y desaparece es el texto de adentro, así el alto de la card
                  no cambia y nada salta cuando el cobro pasa a cerrar. */}
              <div className="cobro-card-acts">
                {avisoDiferencia && (
                  <span
                    className={`cobro-bloqueo-inline cobro-bloqueo-inline--${avisoDiferencia.tono}`}
                  >
                    <i className={`fas ${avisoDiferencia.icono}`} /> {avisoDiferencia.texto}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="actions-footer">
          {/* Volver no descarta nada: los movimientos viven en el estado y siguen cargados al
              volver a entrar. Lo único que se reabre es la confirmación, si cambia la imputación. */}
          <button
            type="button"
            className="btn btn-out"
            onClick={() => anterior && dispatch({ type: 'goto', paso: anterior })}
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
