import { money, round2 } from '@/lib/format'

interface ImpactoAnticiposProps {
  /**
   * Todavía no hay cuenta elegida (o se la está buscando): el panel se muestra igual, con sus tres
   * métricas en skeleton.
   *
   * Se dibuja SIEMPRE por la misma razón que la ficha del cliente de arriba: si apareciera recién
   * al resolverse la cuenta, la card cambiaría de alto en el momento en que el usuario está mirando
   * otra cosa, y hasta entonces no habría forma de saber que esta proyección existe.
   */
  vacio?: boolean
  /** El saldo que la cuenta YA tenía, antes de la operación. */
  actual: number
  /** Lo que le SUMA la operación en curso. */
  recibido: number
  /**
   * Cómo se nombra cada número. Por defecto, los del PASE DE SALDO —que es de donde salió el
   * panel—; el RECHAZO DE CHEQUE los pisa con los suyos.
   *
   * Se parametrizan los RÓTULOS y nada más: la caja, la cabecera con filete, las tres métricas, sus
   * íconos y sus colores son los mismos en las dos operaciones, porque es la misma proyección —de
   * cuánto parte una cuenta, cuánto le suma esta operación y en cuánto queda— y tiene que leerse
   * igual. Duplicar el componente para cambiar tres textos habría dejado dos paneles que se
   * corrigen por separado.
   */
  titulo?: string
  rotuloActual?: string
  rotuloRecibido?: string
  rotuloResultante?: string
  /**
   * Cómo queda la LÍNEA DE CRÉDITO con la operación ya hecha. Opcional: el pase de saldo no la
   * muestra —ahí lo que se mueve es un saldo a favor, que no consume línea— y el rechazo de cheque
   * sí, porque su importe se suma a la cuenta corriente y por lo tanto a lo que la línea tiene
   * tomado.
   *
   * Los dos números vienen YA proyectados por quien llama: son suyos, no del panel, y calcularlos
   * acá obligaría a pasarle el límite y las reglas de crédito para que las volviera a aplicar.
   *
   * `atenuado` los pinta en gris: es lo que dice, sin un cartel, que el límite NO rige esta
   * operación (ver `aplicaCredito`). Se muestran igual y no se esconden, con el mismo criterio que
   * la ficha de arriba: el dato existe, lo que no corre es su efecto.
   */
  credito?: { lineaUtilizada: number; disponible: number; atenuado: boolean }
}

/**
 * Cómo queda una cuenta DESPUÉS de la operación que se está por cerrar.
 *
 * Lo usan las dos operaciones que suman a una cuenta ajena y cierran en su último paso: el PASE DE
 * SALDO —de donde salió, y de ahí sus rótulos por defecto— y el RECHAZO DE CHEQUE, donde el importe
 * del cheque se suma al saldo de cuenta corriente del proveedor acreedor. Es la misma proyección
 * con otros nombres, así que es el MISMO panel y sólo cambian los rótulos.
 *
 * Se lee de corrido, de izquierda a derecha: de cuánto parte, cuánto le suma la operación y en
 * cuánto queda. Es la consecuencia de la decisión que se está tomando en el paso, así que va debajo
 * de la ficha del cliente y no en otra pantalla: el número que importa es el resultante, y verlo
 * recién después de confirmar sería enterarse tarde.
 *
 * Lo que entra va en VERDE porque es lo que se le suma. El resultante pesa más —cuerpo mayor, más
 * peso— por ser la conclusión: los otros números existen para explicarlo.
 *
 * Con `credito` se suman dos métricas más —la línea utilizada y el disponible, ya proyectados— que
 * se atenúan cuando el límite no rige la operación.
 *
 * La caja, la cabecera con filete y las cuatro métricas son las mismas de "Impacto en cuenta
 * corriente" de la app de operaciones de venta, con sus mismas clases: las dos apps muestran el
 * mismo tipo de proyección y tienen que verse igual.
 */
export function ImpactoAnticipos({
  actual,
  recibido,
  vacio = false,
  titulo = 'Resumen de la cuenta por pase de saldo',
  rotuloActual = 'Anticipos Pends de Aplicar actual',
  rotuloRecibido = 'Credito por pase de saldo recibido',
  rotuloResultante = 'ANTICIPOS PENDS DE APLICAR RESULTANTE',
  credito,
}: ImpactoAnticiposProps) {
  const resultante = round2(actual + recibido)
  /* Con la línea a la vista el renglón pasa de tres métricas a cinco: se les da un ancho mínimo
     para que se acomoden en dos filas en vez de aplastarse en una (ver `cobro-imp-row--ancha`). */
  const clase = `cobro-imp-row ${credito ? 'cobro-imp-row--ancha' : ''}`
  const off = credito?.atenuado ? 'cobro-imp-met--off' : ''

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
        <h3 className="font-b cobro-imp-title">{titulo}</h3>
      </div>

      <div className="entrega-panel-body">
        <div className={clase}>
          <div className="cobro-imp-met">
            <span className="cobro-cab-ic cobro-cab-ic--gris">
              <i className="fas fa-wallet" />
            </span>
            <div className="cobro-cab-campo">
              <span className="cobro-cab-lbl">{rotuloActual}</span>
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
              <span className="cobro-cab-lbl cobro-cab-lbl--verde">{rotuloRecibido}</span>
              {val(recibido, 'cobro-imp-num--verde')}
            </div>
          </div>

          <span className="cobro-cab-sep" />

          <div className="cobro-imp-met">
            <span className="cobro-cab-ic cobro-cab-ic--azul">
              <i className="fas fa-scale-balanced" />
            </span>
            <div className="cobro-cab-campo">
              <span className="cobro-cab-lbl">{rotuloResultante}</span>
              {val(resultante, 'cobro-imp-num--total')}
            </div>
          </div>

          {/* LA LÍNEA DE CRÉDITO, ya proyectada. Van después del resultante porque son su
              consecuencia: lo que la cuenta pasa a tener tomado, y lo que le queda. En gris cuando
              el límite no rige, con el mismo tono que la ficha de arriba usa para lo mismo. */}
          {credito && (
            <>
              <span className="cobro-cab-sep" />

              <div className={`cobro-imp-met ${off}`}>
                <span className="cobro-cab-ic cobro-cab-ic--gris">
                  <i className="fas fa-chart-line" />
                </span>
                <div className="cobro-cab-campo">
                  <span className="cobro-cab-lbl">Línea utilizada resultante</span>
                  {val(credito.lineaUtilizada)}
                </div>
              </div>

              <span className="cobro-cab-sep" />

              <div className={`cobro-imp-met ${off}`}>
                <span className="cobro-cab-ic cobro-cab-ic--gris">
                  <i className="fas fa-hand-holding-dollar" />
                </span>
                <div className="cobro-cab-campo">
                  <span className="cobro-cab-lbl">Crédito disponible resultante</span>
                  {val(credito.disponible)}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
