import { diferenciaSaldada, type ResumenCobro } from '@/lib/pagos'
import { money } from '@/lib/format'
import type { Cliente } from '@/types'
import { MetricaCobro } from './MetricaCobro'

interface CabeceraCobroProps {
  cliente: Cliente
  resumen: ResumenCobro
  /**
   * Cuántas facturas se están cancelando con este cobro: es de dónde sale el total a cancelar.
   * `null` en el ANTICIPO, que no cancela facturas: ahí el dato no se muestra.
   */
  facturas: number | null
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
        {facturas !== null && (
          <div className="cobro-cab-campo">
            <span className="cobro-cab-lbl">Facturas a cancelar</span>
            {/* Mismo tratamiento que la condición de pago en la ficha: es el dato que manda acá. */}
            <span className="cobro-cab-cond">{facturas}</span>
          </div>
        )}
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
        {/* Sin recortar en cero: si lo cargado se pasa del total, el número tiene que decirlo. No
            lleva aclaración al pie: el exceso ya se explica con su mensaje de error, y repetirlo
            acá era decir dos veces lo mismo en la misma pantalla.

            El número se muestra SIEMPRE tal cual, pero el color dice si esa diferencia frena o no:
            verde mientras sean centavos —el cobro ya se da por cancelado— y rojo en cuanto queda
            un peso pendiente, que es lo que sí deja la cobranza sin cerrar. */}
        <MetricaCobro
          icono="fa-receipt"
          tono={diferenciaSaldada(resumen) ? 'verde' : 'rojo'}
          rotulo="DIFERENCIA"
          valor={diferencia < 0 ? `- ${money(-diferencia)}` : money(diferencia)}
        />
      </div>
    </div>
  )
}
