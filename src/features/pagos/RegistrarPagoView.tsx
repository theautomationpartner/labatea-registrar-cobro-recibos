import { useMemo, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import {
  CabeceraCobro,
  ROTULOS_CABECERA_PAGO,
} from '@/features/cobro/CabeceraCobro'
import {
  ROTULOS_MOVIMIENTOS_PAGO,
  TablaMovimientos,
  type Dato,
} from '@/features/cobro/TablaMovimientos'
import { DatosAnticipo } from '@/features/cobro/DatosAnticipo'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { totalACancelar } from '@/lib/cobros'
import { money } from '@/lib/format'
import {
  bloqueoAnticipoPago,
  bloqueoPago,
  diferenciaSaldadaPago,
  esCajaCheque,
  esCajaTransferencia,
  ANTICIPO_PAGO_EXIGE_DETALLE_Y_VENC,
  esRetencionGAN,
  vencimientoDeCajaCheque,
  MSG_EXCESO_PAGO,
  MSG_PAGO_CUBIERTO,
  pagoCubierto,
  resumenPago,
  type BloqueoPago,
} from '@/lib/pagosProveedor'
import { faltantesDeAnticipo } from '@/lib/pagos'
import {
  descripcionDePasoPago,
  etiquetaDePasoPago,
  numeroDePasoPago,
  pasoAnteriorPago,
  siguientePasoPago,
} from '@/lib/pasosPago'
import { useApp, useDispatch } from '@/state/hooks'
import type { MovimientoCaja } from '@/types'
import { FormularioPago } from './FormularioPago'

/**
 * Detalle adicional de una caja, según cuál sea: es lo que se capturó en el formulario. El efectivo
 * y las tarjetas no agregan nada a lo que ya muestra la fila, así que no despliegan; el cheque y la
 * transferencia sí, para poder revisar los datos antes de confirmar.
 *
 * Es el equivalente del `detalleDe` del cobro, con las cajas de este circuito.
 */
function detalleDeCaja(m: MovimientoCaja): Dato[] {
  if (esCajaCheque(m.formaPago)) {
    return [
      {
        label: 'Modalidad',
        valor: m.modalidadCheque === 'nuevo' ? 'Nuevo' : 'En Cartera',
      },
      { label: 'Número de cheque', valor: m.numeroCheque?.trim() || '—' },
      { label: 'Fecha de emisión', valor: m.fechaEmisionCheque || '—' },
      { label: 'Fecha de pago', valor: m.fechaPagoCheque || '—' },
      /* El vencimiento se DERIVA de la de pago (+30 días) en el cheque nuevo, y sale del tablero en
         el de cartera. Las dos ramas viven en `vencimientoDeCajaCheque`: acá no se recalcula. */
      { label: 'Fecha de venc.', valor: vencimientoDeCajaCheque(m) || '—' },
      { label: 'Banco emisor', valor: m.bancoEmisor || '—' },
      { label: 'CUIT del emisor', valor: m.cuitEmisor || '—' },
    ]
  }
  if (esCajaTransferencia(m.formaPago)) {
    return [{ label: 'Banco de Origen', valor: m.bancoOrigen || '—' }]
  }
  /* La RETENCIÓN muestra de dónde salió su importe. Es el único movimiento cuyo monto el usuario no
     escribió, así que sin el desglose no habría forma de controlarlo contra el papel. */
  if (esRetencionGAN(m.formaPago)) {
    return [
      { label: 'Base imponible', valor: m.baseImponible !== undefined ? money(m.baseImponible) : '—' },
      { label: 'Alícuota', valor: m.alicuota !== undefined ? `${m.alicuota}%` : '—' },
      {
        label: 'Base no imponible descontada',
        valor: m.baseNoImponibleAplicada ? money(m.baseNoImponibleAplicada) : 'No (ya se usó este mes)',
      },
    ]
  }
  return []
}

/**
 * Por qué el importe de una caja YA registrada no se puede editar, o `null` si se puede.
 *
 * El del CHEQUE nunca se toca: es el importe del documento que se entrega, no una cifra a ajustar.
 * En cartera sale del tablero y en un cheque nuevo lo declara el formulario al librarlo; en los dos
 * casos, dejarlo editable acá invitaría a registrar un importe distinto del que dice el papel, y el
 * pago cerraría en pantalla con plata que el proveedor nunca va a recibir.
 *
 * Para cambiarlo hay una salida y es la correcta: quitar la caja y cargar el cheque que corresponde.
 * El resto de las cajas —efectivo, transferencia, tarjetas— sí se ajustan en la tabla, que es como
 * se lleva la diferencia a cero sin rehacer la carga.
 */
const importeFijoDeCaja = (m: MovimientoCaja): string | null => {
  if (esCajaCheque(m.formaPago)) {
    return 'El importe de un cheque es el del documento: para cambiarlo, quitá la caja y cargá el cheque que corresponde.'
  }
  /* La RETENCIÓN tampoco: su importe sale de una fórmula fiscal, no de una decisión. Editarlo acá
     declararía una retención distinta de la que corresponde practicar —y encima dejaría descuadrado
     el descuento que ya se repartió entre las demás cajas—. */
  if (esRetencionGAN(m.formaPago)) {
    return 'El importe de una retención lo calcula el sistema: para cambiarlo, quitá la caja y volvé a agregarla.'
  }
  return null
}

/**
 * Etapa 3 de PAGOS: con qué cajas se paga lo que se imputó en la etapa anterior.
 *
 * Es el "Registrar cobro" del otro circuito —la misma cabecera, el mismo formulario de carga fila
 * por fila, la misma tabla de movimientos— con tres diferencias:
 *
 *   · el vocabulario del EGRESO en cada rótulo (ver `ROTULOS_CABECERA_PAGO`);
 *   · SIN lectura de comprobantes: acá el usuario indica a mano cómo paga (ver `FormularioPago`);
 *   · la diferencia tiene que llegar a CERO EXACTO, no "salvo centavos" como en la cobranza (ver
 *     `diferenciaSaldadaPago`). Es lo que bloquea el botón de confirmar.
 */
export function RegistrarPagoView() {
  const {
    proveedor,
    imputacionesPago,
    pago,
    tipoOperacionPago,
    importeAnticipo,
    detalleAnticipo,
    vencimientoAnticipo,
  } = useApp()
  const dispatch = useDispatch()
  // Motivo por el que no se puede confirmar, mostrado al intentarlo.
  const [aviso, setAviso] = useState<BloqueoPago | null>(null)

  const esAnticipo = tipoOperacionPago === 'anticipo'
  /* De dónde sale el TOTAL A PAGAR, que es lo único que cambia entre los dos recorridos:
       · FACTURAS · de la imputación de la etapa anterior. Acá no se calcula nada.
       · ANTICIPO · no hay facturas: el importe lo declara el usuario en el campo de arriba, porque
                    el anticipo es dinero a cuenta y su monto es la decisión de quien paga. */
  const total = esAnticipo ? importeAnticipo : totalACancelar(imputacionesPago)
  const facturasElegidas = Object.keys(imputacionesPago).length
  const resumen = useMemo(() => resumenPago(pago.movimientos, total), [pago.movimientos, total])
  const datosAnticipo = {
    importe: importeAnticipo,
    detalle: detalleAnticipo,
    vencimiento: vencimientoAnticipo,
  }
  /* El recorrido ofrece la caja "Anticipo" para absorber lo que se entregó de más, así que el
     mensaje del exceso puede nombrar esa salida. En el recorrido del ANTICIPO no: ahí todo ya es un
     anticipo, y el selector no ofrece ese medio. */
  const ofreceAnticipo = tipoOperacionPago === 'facturasCompra'
  const bloqueo = esAnticipo
    ? bloqueoAnticipoPago(datosAnticipo, pago.movimientos, resumen)
    : bloqueoPago(pago.movimientos, resumen, ofreceAnticipo)

  /* Sin el IMPORTE del anticipo no se puede cargar cómo se lo entrega: es el total que esas cajas
     tienen que igualar, así que registrarlas antes sería cargar contra un total que todavía no
     existe. El detalle y el vencimiento no frenan nada: son opcionales (ver
     `ANTICIPO_PAGO_EXIGE_DETALLE_Y_VENC`). */
  const faltaAnticipo = esAnticipo
    ? faltantesDeAnticipo(datosAnticipo, ANTICIPO_PAGO_EXIGE_DETALLE_Y_VENC)
    : []

  /* El pago ya cierra. NO cierra el formulario: con el total cubierto todavía queda una caja que
     tiene sentido cargar —la RETENCIÓN, que no suma dinero sino que se descuenta de lo ya
     registrado—, y bloquearlo obligaba a deshacer el pago para poder retener. Sólo se avisa. */
  const cubierto = pagoCubierto(resumen)

  /* Adónde se va y de dónde se vuelve, según el recorrido: el anticipo no pasa por las facturas
     pendientes, así que su "Volver" lleva a la selección de proveedor. */
  const destino = siguientePasoPago('pago', tipoOperacionPago)
  const anterior = pasoAnteriorPago('pago', tipoOperacionPago)
  const SIGUIENTE = destino ? etiquetaDePasoPago(destino, tipoOperacionPago) : ''

  const confirmar = () => {
    /* BLOQUEO CRÍTICO: mientras la diferencia no sea exactamente 0 el pago no se confirma. El botón
       NUNCA se apaga —si algo falta, la ventana dice exactamente qué—, pero la acción sí está
       bloqueada: `bloqueoPago` es la única puerta, y no deja pasar con un peso descolocado. */
    if (bloqueo) {
      setAviso(bloqueo)
      return
    }
    dispatch({ type: 'confirmarPago' })
    /* Confirmado el pago se avanza a la ORDEN: es lo que sigue del circuito, y quedarse acá dejaba
       la operación cerrada en pantalla pero sin documento. */
    if (destino) dispatch({ type: 'gotoPago', paso: destino })
  }

  /* Aviso en vivo del pago, en UN solo lugar: cuánto falta cargar o cuánto se pasó. Los dos casos
     comparten renglón —el mismo, debajo de la tabla— porque son la misma pregunta contestada de dos
     maneras, y así alternar entre ellos no mueve nada de lugar. */
  const avisoDiferencia =
    faltaAnticipo.length > 0
      ? {
          /* El bloqueo del anticipo tiene PRIORIDAD sobre la diferencia: mientras falten sus datos
             no se puede cargar nada, así que decir cuánto falta para cubrir un total que todavía no
             está definido sólo confundiría. */
          tono: 'info' as const,
          icono: 'fa-circle-info',
          texto: `Para cargar cómo se entrega el anticipo, completá arriba: ${faltaAnticipo.join(', ')}.`,
        }
      : cubierto
    ? /* Cubierto: el formulario está cerrado y hay que decir POR QUÉ. Va en verde: no es un
         problema a corregir, es el trabajo terminado. */
      { tono: 'ok' as const, icono: 'fa-circle-check', texto: MSG_PAGO_CUBIERTO }
    : diferenciaSaldadaPago(resumen)
      ? null
      : resumen.diferencia > 0
        ? {
            tono: 'info' as const,
            icono: 'fa-circle-info',
            texto: `Faltan ${money(resumen.diferencia)} para cubrir el total a pagar.`,
          }
        : {
            /* El MISMO texto que la ventana de bloqueo: es el mismo problema, y decirlo distinto en
               cada lugar haría dudar de si son dos. */
            tono: 'err' as const,
            icono: 'fa-circle-exclamation',
            texto: MSG_EXCESO_PAGO(-resumen.diferencia, ofreceAnticipo),
          }

  return (
    /* `anticipos-v2` se suma a propósito: es el scope de los estilos de la tabla de anticipos, y la
       cartera de cheques usa ESA tabla. Es el mismo mecanismo con el que `PaseAnticipoView` reusa
       esos estilos —todas las reglas de `anticipos.css` son `.anticipos-v2 .ant-*`, así que la
       clase no arrastra nada más—. */
    <section className="view cobro-v2 anticipos-v2 paso-layout">
      <PasoHeader />

      <div className="paso-body">
        <PasoTitulo
          numero={numeroDePasoPago('pago', tipoOperacionPago)}
          titulo={etiquetaDePasoPago('pago', tipoOperacionPago)}
          descripcion={descripcionDePasoPago('pago', tipoOperacionPago)}
        />

        {!proveedor ? (
          <div className="cobro-static">
            <div className="cobro-card">
              <p className="cobro-vacio">
                <i className="fas fa-user-slash" /> Todavía no hay un proveedor seleccionado. Volvé
                al paso 1 para elegirlo.
              </p>
            </div>
          </div>
        ) : (
          <div className="cobro-static">
            {/* Los datos del anticipo ABREN el panel: son la premisa de todo lo que sigue —de su
                importe sale el total a pagar—, así que se declaran antes de que las métricas
                muestren contra qué se está comparando lo entregado.

                Es el MISMO componente que usa el registro del anticipo en Cobros: los tres campos
                son los mismos y el estado sobre el que escriben también, porque un anticipo se
                declara igual se cobre o se pague. */}
            {esAnticipo && (
              <DatosAnticipo
                rotuloImporte="Importe del anticipo que se le entrega al proveedor"
                /* La MISMA constante que usa la validación: el asterisco y el bloqueo no pueden
                   discrepar sobre qué es obligatorio. */
                exigeDetalleYVencimiento={ANTICIPO_PAGO_EXIGE_DETALLE_Y_VENC}
                /* SIN Fecha Vto: el anticipo que se le entrega a un proveedor no vence. Queda como
                   saldo a favor nuestro hasta que se aplique contra una factura de compra, así que
                   pedir una fecha ahí era ofrecer un dato que después nadie mira. */
                sinVencimiento
              />
            )}

            {/* Panel superior: de quién es el pago, cuántas facturas cubre y los tres números que
                lo resumen —TOTAL A PAGAR, TOTAL PAGADO y TOTAL DIFERENCIA—. Es la MISMA cabecera
                del registro del cobro, con los rótulos del egreso.

                El color de la diferencia lo decide la regla de ESTE circuito: verde sólo en cero
                exacto, rojo con cualquier resto. */}
            <CabeceraCobro
              cliente={proveedor}
              resumen={{
                totalACancelar: resumen.totalAPagar,
                totalRecibido: resumen.totalPagado,
                diferencia: resumen.diferencia,
              }}
              /* En el anticipo no hay facturas que contar: el dato no se muestra en vez de
                 mostrarse en cero, que sería decir que se eligieron cero facturas. */
              facturas={esAnticipo ? null : facturasElegidas}
              rotulos={ROTULOS_CABECERA_PAGO}
              saldada={diferenciaSaldadaPago(resumen)}
            />

            <div className="cobro-card">
              <h3 className="cobro-card-title">
                {esAnticipo ? 'Registrar anticipo' : 'Registrar pago'}
              </h3>
              <p className="cobro-card-desc">
                {esAnticipo
                  ? 'Especificar con qué cajas se le entrega el anticipo al proveedor'
                  : 'Especificar con qué cajas se le paga al proveedor'}
              </p>

              {/* La diferencia precarga el importe de cada caja nueva con lo que falta para cerrar. */}
              <FormularioPago
                bloqueado={faltaAnticipo.length > 0}
                diferencia={resumen.diferencia}
              />

              <h4 className="cobro-card-sub">Cajas registradas</h4>
              <TablaMovimientos
                movimientos={pago.movimientos}
                rotulos={ROTULOS_MOVIMIENTOS_PAGO}
                detalle={detalleDeCaja}
                onQuitar={(id) => dispatch({ type: 'removeMovimientoCaja', id })}
                onImporte={(id, importe) =>
                  dispatch({ type: 'setMovimientoCajaImporte', id, importe })
                }
                importeFijo={importeFijoDeCaja}
              />

              {/* La franja del aviso se monta SIEMPRE, con o sin mensaje: es lo que reserva su
                  lugar. Lo que aparece y desaparece es el texto de adentro, así el alto de la card
                  no cambia y nada salta cuando el pago pasa a cerrar. */}
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
          {/* Volver no descarta nada: las cajas viven en el estado y siguen cargadas al volver a
              entrar. Lo único que se reabre es la confirmación, si cambia la imputación. */}
          <button
            type="button"
            className="btn btn-out"
            onClick={() => anterior && dispatch({ type: 'gotoPago', paso: anterior })}
          >
            <i className="fas fa-arrow-left" /> Volver
          </button>

          <div className="actions-footer-fin">
            <span className={`paso-siguiente ${bloqueo ? 'paso-siguiente--bloqueo' : ''}`}>
              {bloqueo ? (
                <>
                  <i className="fas fa-circle-exclamation" /> {bloqueo.titulo}
                </>
              ) : pago.confirmado ? (
                <>
                  <i className="fas fa-circle-check" />{' '}
                  {esAnticipo ? 'Anticipo registrado' : 'Pago registrado'}
                </>
              ) : (
                <>
                  <i className="fas fa-arrow-turn-up paso-siguiente-ic" /> La diferencia está en $
                  0,00: ya se puede confirmar
                </>
              )}
            </span>
            <button
              type="button"
              className="btn btn-primary"
              /* NUNCA se apaga: el bloqueo por diferencia lo frena `confirmar`, que abre la ventana
                 con el motivo, con el mismo criterio que el resto de la app. Con el pago ya
                 confirmado el botón sigue vivo y lleva a la orden: es cómo se vuelve adelante
                 después de retroceder con el stepper. */
              onClick={confirmar}
            >
              {pago.confirmado ? (
                <>
                  Continuar a {SIGUIENTE} <i className="fas fa-arrow-right" />
                </>
              ) : (
                <>
                  {esAnticipo ? 'Confirmar anticipo' : 'Confirmar pago'}{' '}
                  <i className="fas fa-arrow-right" />
                </>
              )}
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
