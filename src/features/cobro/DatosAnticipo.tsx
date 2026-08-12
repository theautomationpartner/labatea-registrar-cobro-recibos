import { useState } from 'react'
import { aIso, desdeIso } from '@/lib/dates'
import { formatearImporteAR, importeATexto } from '@/lib/format'
import { useApp, useDispatch } from '@/state/hooks'

/** Asterisco rojo que marca un campo obligatorio, igual que en el formulario de cobro. */
const Req = () => <span className="cobro-req"> *</span>

/**
 * Datos del ANTICIPO: importe, detalle y vencimiento. Es lo único que este recorrido no puede sacar
 * de otro lado —no hay facturas imputadas de las que derivarlo—, así que lo declara el usuario acá.
 *
 * Vive FUERA de "Registrar anticipo" y encima suyo, porque es su premisa: el importe pasa a ser el
 * TOTAL A CANCELAR que las formas de pago de abajo tienen que igualar. Los tres campos son
 * obligatorios para avanzar (ver `bloqueoAnticipo`).
 *
 * Lee y escribe el estado global directo, como el formulario de cobro: son datos de la operación,
 * no de esta pantalla.
 */
export function DatosAnticipo() {
  const { importeAnticipo, detalleAnticipo, vencimientoAnticipo } = useApp()
  const dispatch = useDispatch()

  /* El importe se tipea con el formato AR del resto de la app ("30409" → "30.409"), así que su
     texto es estado propio: el estado global sólo guarda el número. */
  const [texto, setTexto] = useState<string>(() =>
    importeAnticipo > 0 ? importeATexto(importeAnticipo) : '',
  )
  const [ultimo, setUltimo] = useState(importeAnticipo)
  // El importe puede cambiar desde afuera (se reinició la operación): el campo lo sigue.
  if (ultimo !== importeAnticipo) {
    setUltimo(importeAnticipo)
    setTexto(importeAnticipo > 0 ? importeATexto(importeAnticipo) : '')
  }

  const cambiarImporte = (entrada: string) => {
    const { texto: t, valor } = formatearImporteAR(entrada)
    setTexto(t)
    setUltimo(valor)
    dispatch({ type: 'setImporteAnticipo', importe: valor })
  }

  return (
    <section className="cobro-anticipo">
      <div className="cobro-anticipo-ic">
        <i className="fas fa-sack-dollar" />
      </div>

      <div className="cobro-anticipo-campos">
        <div className="cobro-anticipo-campo cobro-anticipo-campo--importe">
          <label className="cobro-anticipo-lbl" htmlFor="anticipo-importe">
            Importe del anticipo que entrega el cliente
            <Req />
          </label>
          {/* Sin importe cargado la línea se pone en rojo: es el dato del que salen el total a
              cancelar y la habilitación del formulario de abajo, así que su falta se marca sola,
              sin esperar a que el usuario intente avanzar. */}
          <span
            className={`cobro-anticipo-monto ${
              importeAnticipo > 0 ? '' : 'cobro-anticipo-monto--falta'
            }`}
          >
            <span className="cobro-anticipo-pre">$</span>
            <input
              id="anticipo-importe"
              type="text"
              inputMode="decimal"
              placeholder="0,00"
              autoComplete="off"
              value={texto}
              onChange={(e) => cambiarImporte(e.target.value)}
            />
          </span>
        </div>

        <div className="cobro-anticipo-campo">
          <label className="cobro-anticipo-lbl" htmlFor="anticipo-detalle">
            Detalle
            <Req />
          </label>
          <input
            id="anticipo-detalle"
            type="text"
            className="cobro-in"
            autoComplete="off"
            placeholder="Por qué se registra el anticipo"
            value={detalleAnticipo}
            onChange={(e) => dispatch({ type: 'setDetalleAnticipo', detalle: e.target.value })}
          />
        </div>

        <div className="cobro-anticipo-campo cobro-anticipo-campo--fecha">
          <label className="cobro-anticipo-lbl" htmlFor="anticipo-venc">
            Fecha Vto
            <Req />
          </label>
          {/* El estado guarda la fecha en dd/MM/yyyy —el formato del ERP—; el input nativo pide
              ISO, así que se convierte en los dos sentidos. Mismo criterio que el cheque. */}
          <input
            id="anticipo-venc"
            type="date"
            className="cobro-in"
            value={aIso(vencimientoAnticipo)}
            onChange={(e) =>
              dispatch({ type: 'setVencimientoAnticipo', vencimiento: desdeIso(e.target.value) })
            }
          />
        </div>
      </div>

      {/* La misma regla que en el cobro: lo que el cliente entrega tiene que igualar este importe. */}
      <p className="cobro-anticipo-hint">
        <i className="fas fa-circle-info" /> Es el total a cancelar del recibo: las formas de pago
        que cargues abajo tienen que sumar exactamente este importe.
      </p>
    </section>
  )
}
