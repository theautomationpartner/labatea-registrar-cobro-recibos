import type { ResumenCobro } from '@/lib/pagos'
import { money } from '@/lib/format'
import type { Cliente } from '@/types'
import { MetricaCobro } from './MetricaCobro'

interface CabeceraCobroProps {
  cliente: Cliente
  resumen: ResumenCobro
  /** Cuántas facturas se están cancelando con este cobro: es de dónde sale el total a cancelar. */
  facturas: number
}

/**
 * Cabecera del registro del cobro: de quién es la cobranza y los tres números que la resumen.
 * Vive arriba del formulario para que, al cargar cada pago, se vea al instante cuánto falta.
 *
 * Los rótulos son los de una COBRANZA, no los de una venta: lo que hay que cubrir es el total
 * imputado a las facturas del paso anterior (TOTAL A CANCELAR) y lo que se lleva cargado es lo que
 * el cliente entrega (TOTAL RECIBIDO). La DIFERENCIA entre ambos es lo único que habilita avanzar.
 */
export function CabeceraCobro({ cliente, resumen, facturas }: CabeceraCobroProps) {
  const { diferencia } = resumen

  return (
    <div className="cobro-cab">
      <div className="cobro-cab-cli">
        <span className="cobro-cab-av">
          <i className="fas fa-user" />
        </span>
        <div className="cobro-cab-campo">
          <span className="cobro-cab-lbl">Cliente</span>
          <span className="cobro-cab-val">{cliente.name}</span>
        </div>
        <div className="cobro-cab-campo">
          <span className="cobro-cab-lbl">Facturas a cancelar</span>
          {/* Mismo tratamiento que la condición de pago en la ficha: es el dato que manda acá. */}
          <span className="cobro-cab-cond">{facturas}</span>
        </div>
      </div>

      <span className="cobro-cab-sep" />

      <div className="cobro-cab-mets">
        <MetricaCobro
          icono="fa-file-invoice-dollar"
          tono="azul"
          rotulo="TOTAL A CANCELAR"
          valor={money(resumen.totalACancelar)}
        />
        <MetricaCobro
          icono="fa-hand-holding-dollar"
          tono="verde"
          rotulo="TOTAL RECIBIDO"
          valor={money(resumen.totalRecibido)}
        />
        {/* Sin recortar en cero: si lo cargado se pasa del total, el número tiene que decirlo. */}
        <MetricaCobro
          icono="fa-receipt"
          tono="rojo"
          rotulo="DIFERENCIA"
          valor={diferencia < 0 ? `- ${money(-diferencia)}` : money(diferencia)}
          nota={diferencia < 0 ? 'Se pasa del total a cancelar' : undefined}
        />
      </div>
    </div>
  )
}
