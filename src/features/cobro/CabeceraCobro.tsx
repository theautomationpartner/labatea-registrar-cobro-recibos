import { diferenciaSaldada, type ResumenCobro } from '@/lib/pagos'
import { money } from '@/lib/format'
import type { Cliente } from '@/types'
import { MetricaCobro } from './MetricaCobro'

/**
 * Los textos que cambian entre COBROS y PAGOS. La cabecera es la misma pieza en los dos —quién es
 * la contraparte, cuántos comprobantes se están cancelando y los tres números que resumen la
 * operación—, y lo único que se diferencia es cómo se nombra cada cosa.
 */
export interface RotulosCabecera {
  /** Rótulo de la contraparte ("Cliente" / "Proveedor"). */
  titular: string
  /** Rótulo del contador de comprobantes. */
  comprobantes: string
  /** Los tres rótulos de las métricas, en el orden en que se muestran. */
  total: string
  cargado: string
  diferencia: string
  /** Icono de la primera métrica, que es la única que cambia de significado (ingreso / egreso). */
  iconoCargado: string
}

/** Los rótulos de una COBRANZA. Rigen si no se pasa ninguno: es el circuito original. */
export const ROTULOS_CABECERA_COBRO: RotulosCabecera = {
  titular: 'Cliente',
  comprobantes: 'Facturas a cancelar',
  total: 'TOTAL A CANCELAR',
  cargado: 'TOTAL RECIBIDO',
  diferencia: 'DIFERENCIA',
  iconoCargado: 'fa-hand-holding-dollar',
}

/** Los rótulos de un PAGO a proveedor: los mismos números, con el vocabulario del egreso. */
export const ROTULOS_CABECERA_PAGO: RotulosCabecera = {
  titular: 'Proveedor',
  comprobantes: 'Facturas a pagar',
  total: 'TOTAL A PAGAR',
  cargado: 'TOTAL PAGADO',
  diferencia: 'TOTAL DIFERENCIA',
  /* La mano que ENTREGA el dinero, no la que lo recibe: es la única diferencia visual entre las
     dos cabeceras, y dice de un vistazo para qué lado se mueve la plata. */
  iconoCargado: 'fa-money-bill-transfer',
}

interface CabeceraCobroProps {
  cliente: Pick<Cliente, 'name'>
  resumen: ResumenCobro
  /**
   * Cuántas facturas se están cancelando con este cobro: es de dónde sale el total a cancelar.
   * `null` en el ANTICIPO, que no cancela facturas: ahí el dato no se muestra.
   */
  facturas: number | null
  /** Cómo se nombra la operación. Por defecto, la COBRANZA. */
  rotulos?: RotulosCabecera
  /**
   * La diferencia está saldada: es lo que decide el color de la tercera métrica. Por defecto se
   * resuelve con la regla del COBRO —que perdona los centavos—; PAGOS pasa la suya, que exige el
   * cero exacto (ver `diferenciaSaldadaPago`).
   */
  saldada?: boolean
}

/**
 * Cabecera del registro del cobro: de quién es la cobranza y los tres números que la resumen.
 * Vive arriba del formulario para que, al cargar cada pago, se vea al instante cuánto falta.
 *
 * Los rótulos son los de una COBRANZA, no los de una venta: lo que hay que cubrir es el total
 * imputado a las facturas del paso anterior (TOTAL A CANCELAR) y lo que se lleva cargado es lo que
 * el cliente entrega (TOTAL RECIBIDO). La DIFERENCIA entre ambos es lo único que habilita avanzar.
 */
export function CabeceraCobro({
  cliente,
  resumen,
  facturas,
  rotulos = ROTULOS_CABECERA_COBRO,
  saldada,
}: CabeceraCobroProps) {
  const { diferencia } = resumen
  const cierra = saldada ?? diferenciaSaldada(resumen)

  return (
    <div className="cobro-cab">
      <div className="cobro-cab-cli">
        <span className="cobro-cab-av">
          <i className="fas fa-user" />
        </span>
        <div className="cobro-cab-campo">
          <span className="cobro-cab-lbl">{rotulos.titular}</span>
          <span className="cobro-cab-val">{cliente.name}</span>
        </div>
        {facturas !== null && (
          <div className="cobro-cab-campo">
            <span className="cobro-cab-lbl">{rotulos.comprobantes}</span>
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
          rotulo={rotulos.total}
          valor={money(resumen.totalACancelar)}
        />
        <MetricaCobro
          icono={rotulos.iconoCargado}
          tono="verde"
          rotulo={rotulos.cargado}
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
          tono={cierra ? 'verde' : 'rojo'}
          rotulo={rotulos.diferencia}
          valor={diferencia < 0 ? `- ${money(-diferencia)}` : money(diferencia)}
        />
      </div>
    </div>
  )
}
