import { desdeIso } from '@/lib/dates'
import { money } from '@/lib/format'
import { vencimientoProximo } from '@/lib/pagosProveedor'
import type { ChequeEnCartera } from '@/types'

interface TablaChequesCarteraProps {
  cheques: readonly ChequeEnCartera[]
  /** IDs de los cheques marcados. Se pueden elegir VARIOS: cada uno entra como su propia caja. */
  elegidos: readonly string[]
  onAlternar: (cheque: ChequeEnCartera) => void
  /**
   * Se intentó agregar sin ningún cheque marcado. Las filas se pintan en rojo: el problema no es de
   * un campo sino de la decisión que falta, así que lo que se señala es la tabla entera.
   */
  error?: boolean
  /**
   * Suma las dos columnas de ORIGEN: con qué recibo entró el cheque y con qué orden de pago salió.
   *
   * Van detrás de una bandera y no siempre porque sólo tienen sentido sobre cheques YA USADOS —los
   * del rechazo—: en la cartera del formulario de pago el cheque todavía no salió, así que la
   * columna del pago estaría vacía en todas las filas, y una columna que nunca dice nada es ruido.
   * Los datos tampoco vienen: esa consulta no los pide (ver `getChequesEnCartera`).
   */
  conOrigen?: boolean
}

/**
 * Cómo se nombra el cheque en la primera columna: su número y qué clase de documento es.
 *
 * El tablero tiene tres etiquetas en "🤖Tipo de Cheque" —"Cheque", "eCheq" y "Papel"— que en los
 * hechos son DOS cosas: electrónico o no. Acá se reducen a esas dos, escritas siempre igual, para
 * que la columna no alterne entre "Papel" y "Cheque" según qué etiqueta le tocó a cada ítem.
 *
 * El número va precedido por "№", que es como se lo nombra en todo el sistema —los movimientos de
 * cuenta corriente del rechazo se llaman "Rechazo Cheque - №15935562"—: sin él, un número suelto al
 * principio de la fila se confunde con un código o un id.
 *
 * Sin número cargado queda el código del ítem ("CHEQUE-07"), y ahí el "№" NO se antepone: ese
 * código no es el número del cheque, y rotularlo como si lo fuera sería afirmar un dato que el
 * tablero no tiene.
 *
 * Se EXPORTA porque el rechazo de cheque nombra el papel elegido fuera de la tabla —en el resumen
 * del paso—: escrito dos veces, el resumen y la fila podrían terminar llamando distinto al mismo
 * cheque.
 */
export const etiquetaCheque = (c: ChequeEnCartera): string => {
  const tipo = /echeq/i.test(c.tipo) ? 'Echeq' : 'Cheque'
  const numero = c.numero.trim()
  return `${numero ? `№${numero}` : c.codigo} - ${tipo}`
}

/**
 * Cheques y eCheqs disponibles en cartera, para elegir con cuáles se paga.
 *
 * Es la MISMA tabla con la que se aplican los anticipos de un cliente (`TablaAnticipos`): mismas
 * clases, mismo encabezado, misma casilla, mismo resaltado de la fila elegida. Son el mismo gesto
 * —marcar de una lista de saldos disponibles con cuáles se cancela algo—, así que se ven igual; lo
 * único que cambia son las columnas, porque un cheque se identifica por otros datos que un anticipo.
 *
 * El IMPORTE va en negro y no en verde: en la tabla de anticipos el verde marca el saldo a favor
 * —el número que decide cuánto se puede aplicar—, y acá no hay nada que decidir. El importe del
 * cheque es el que es, y es exactamente lo que va a sumar al TOTAL PAGADO.
 */
export function TablaChequesCartera({
  cheques,
  elegidos,
  onAlternar,
  error = false,
  conOrigen = false,
}: TablaChequesCarteraProps) {
  return (
    <div className="ant-tabla-wrap">
      <table className="ant-tabla">
        <thead>
          <tr>
            <th className="ant-col-check" />
            <th>Cheques</th>
            <th className="ant-col-cen">Banco</th>
            {/* Las TRES fechas del cheque, en el orden en que se lee: cuándo se libró, desde
                cuándo se cobra y hasta cuándo. */}
            <th className="ant-col-cen">Fecha Emisión</th>
            <th className="ant-col-cen">Fecha Pago</th>
            <th className="ant-col-cen">Fecha Vencimiento</th>
            {/* De dónde viene y a dónde fue el cheque. Van entre las fechas y el importe: cierran
                la identificación del papel, y el importe es lo último que se lee de la fila. */}
            {conOrigen && (
              <>
                <th className="ant-col-cen">ID Recibo</th>
                <th className="ant-col-cen">ID Pago</th>
              </>
            )}
            <th className="ant-col-cen">Importe</th>
          </tr>
        </thead>
        <tbody>
          {cheques.map((c) => {
            const elegido = elegidos.includes(c.id)
            /* Vence pronto (o ya venció): se marca en rojo para que se vea ANTES de elegirlo, y no
               al revisar la tabla de cajas registradas. */
            const porVencer = vencimientoProximo(c.vencimiento)
            return (
              <tr
                key={c.id}
                className={`ant-row ${elegido ? 'ant-row--on' : ''} ${
                  error ? 'pago-fila--error' : ''
                }`}
              >
                <td className="ant-col-check">
                  <input
                    type="checkbox"
                    className="ant-check"
                    checked={elegido}
                    onChange={() => onAlternar(c)}
                    aria-label={`Pagar con el cheque ${etiquetaCheque(c)}`}
                  />
                </td>
                <td>
                  <span className="ant-nro">{etiquetaCheque(c)}</span>
                  {/* El código del ítem, debajo: es con lo que se lo busca en el tablero. Ocupa el
                      lugar que en la tabla de anticipos tiene el comentario. */}
                  <span className="ant-detalle">{c.codigo}</span>
                </td>
                <td className="ant-col-cen">{c.banco || <span className="ant-sd">—</span>}</td>
                {/* Emisión y pago van en negro: la que puede alarmar es la de vencimiento, que es
                    la que decide hasta cuándo sirve el papel. */}
                <td className="ant-col-cen">
                  {desdeIso(c.emision) || <span className="ant-sd">—</span>}
                </td>
                <td className="ant-col-cen">
                  {desdeIso(c.fechaPago) || <span className="ant-sd">—</span>}
                </td>
                <td className={`ant-col-cen ${porVencer ? 'pago-venc--proximo' : ''}`}>
                  {desdeIso(c.vencimiento) || <span className="ant-sd">—</span>}
                </td>
                {conOrigen && (
                  <>
                    {/* Los dos códigos con los que se encuentra la operación en Monday. Sin el dato
                        va el guion: un cheque puede no haber salido todavía, y eso es un dato. */}
                    <td className="ant-col-cen">{c.idRecibo || <span className="ant-sd">—</span>}</td>
                    <td className="ant-col-cen">{c.idPago || <span className="ant-sd">—</span>}</td>
                  </>
                )}
                {/* `ant-num` y NO `ant-pend`: el segundo es el que pinta de verde el saldo a favor
                    de un anticipo, y este importe no es un saldo a decidir. */}
                <td className="ant-col-cen ant-num">{money(c.importe)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
