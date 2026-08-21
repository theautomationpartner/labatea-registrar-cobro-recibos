import { money, round2 } from '@/lib/format'

interface ImpactoAnticiposProps {
  /**
   * Todavía no hay cuenta destino elegida (o se la está buscando): el panel se muestra igual, con
   * sus tres métricas en skeleton.
   *
   * Se dibuja SIEMPRE por la misma razón que la ficha del cliente de arriba: si apareciera recién
   * al elegir el destino, la card cambiaría de alto en el momento en que el usuario está mirando
   * otra cosa, y hasta entonces no habría forma de saber que esta proyección existe.
   */
  vacio?: boolean
  /** Saldo a favor que la cuenta destino YA tenía sin aplicar. */
  actual: number
  /** Lo que le entra con este pase: el importe tomado del anticipo de origen. */
  recibido: number
}

/**
 * Cómo queda el saldo a favor de la cuenta DESTINO con el pase ya hecho.
 *
 * Se lee de corrido, de izquierda a derecha: de cuánto parte, cuánto le suma este pase y en cuánto
 * queda. Es la consecuencia de la decisión que se está tomando en el paso, así que va debajo de la
 * ficha del cliente y no en otra pantalla: el número que importa es el resultante, y verlo recién
 * después de confirmar sería enterarse tarde.
 *
 * Lo que entra por el pase va en VERDE porque es lo que se le suma a favor. El resultante pesa más
 * —cuerpo mayor, más peso— por ser la conclusión: los otros dos números existen para explicarlo.
 *
 * La caja, la cabecera con filete y las cuatro métricas son las mismas de "Impacto en cuenta
 * corriente" de la app de operaciones de venta, con sus mismas clases: las dos apps muestran el
 * mismo tipo de proyección y tienen que verse igual.
 */
export function ImpactoAnticipos({ actual, recibido, vacio = false }: ImpactoAnticiposProps) {
  const resultante = round2(actual + recibido)

  /* Importe, o el mismo bloque gris que usan las cajas de la ficha mientras no hay dato. Es la
     MISMA clase, no una parecida: las dos zonas esperan lo mismo y tienen que esperarlo igual. */
  const val = (importe: number, clase = '') =>
    vacio ? (
      <span className="skeleton skeleton--valor" />
    ) : (
      <span className={`cobro-imp-num ${clase}`}>{money(importe)}</span>
    )

  return (
    <div className="entrega-panel cobro-imp-panel">
      <div className="entrega-panel-head">
        <h3 className="font-b cobro-imp-title">Resumen de la cuenta por pase de saldo</h3>
      </div>

      <div className="entrega-panel-body">
        <div className="cobro-imp-row">
          <div className="cobro-imp-met">
            <span className="cobro-cab-ic cobro-cab-ic--gris">
              <i className="fas fa-wallet" />
            </span>
            <div className="cobro-cab-campo">
              <span className="cobro-cab-lbl">Anticipos Pends de Aplicar actual</span>
              {val(actual)}
            </div>
          </div>

          <span className="cobro-cab-sep" />

          {/* Lo que entra con el pase: rótulo y valor en verde, igual que la deuda de la otra app.
              Es el único de los tres que representa un movimiento; los otros dos son estados. */}
          <div className="cobro-imp-met">
            <span className="cobro-cab-ic cobro-cab-ic--verde">
              <i className="fas fa-file-invoice-dollar" />
            </span>
            <div className="cobro-cab-campo">
              <span className="cobro-cab-lbl cobro-cab-lbl--verde">
                Credito por pase de saldo recibido
              </span>
              {val(recibido, 'cobro-imp-num--verde')}
            </div>
          </div>

          <span className="cobro-cab-sep" />

          <div className="cobro-imp-met">
            <span className="cobro-cab-ic cobro-cab-ic--azul">
              <i className="fas fa-scale-balanced" />
            </span>
            <div className="cobro-cab-campo">
              <span className="cobro-cab-lbl">ANTICIPOS PENDS DE APLICAR RESULTANTE</span>
              {val(resultante, 'cobro-imp-num--total')}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
