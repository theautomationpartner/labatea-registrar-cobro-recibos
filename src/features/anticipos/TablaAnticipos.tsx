import { useEffect, useState } from 'react'
import { excedeAnticipo, type Aplicaciones } from '@/lib/cobros'
import { desdeIso } from '@/lib/dates'
import { formatearImporteAR, importeATexto, money, round2 } from '@/lib/format'
import { useDispatch } from '@/state/hooks'
import type { AnticipoPendiente } from '@/types'

interface TablaAnticiposProps {
  anticipos: readonly AnticipoPendiente[]
  aplicaciones: Aplicaciones
  /**
   * Lo aplicado YA cubre el total de las facturas. Con esto en `true` no se puede sumar otro
   * anticipo —sólo editar o quitar los elegidos—, porque cualquier importe extra dejaría la
   * diferencia en negativo y el recibo no se emitiría.
   */
  cubierto: boolean
}

/** Importe a aplicar de UN anticipo: texto propio con formato AR, número en el estado global. */
function ImporteAplicado({
  anticipo,
  importe,
}: {
  anticipo: AnticipoPendiente
  importe: number
}) {
  const dispatch = useDispatch()
  const [texto, setTexto] = useState<string>(() => (importe > 0 ? importeATexto(importe) : ''))

  /* Resincroniza cuando el importe cambia desde AFUERA: al marcar el anticipo se propone lo que
     falta cubrir. Lo que se tipea NO se toca —ni siquiera pasarse del saldo del anticipo—: eso se
     señala en rojo y frena el avance, en vez de corregirse solo. */
  useEffect(() => {
    setTexto((actual) =>
      formatearImporteAR(actual).valor === importe
        ? actual
        : importe > 0
          ? importeATexto(importe)
          : '',
    )
  }, [importe])

  /* Se pasó del saldo del anticipo. El estado lo DEJA cargar a propósito —no le cambia el número
     al usuario—, así que el borde rojo es lo único que lo señala acá; el motivo completo, con el
     máximo, lo dice el renglón de aviso del paso. */
  const excede = excedeAnticipo(anticipo, importe)

  return (
    <div className="ant-aplicar">
      <span className="ant-aplicar-signo">$</span>
      <input
        type="text"
        inputMode="decimal"
        className={`ant-aplicar-in ${excede ? 'ant-aplicar-in--error' : ''}`}
        autoComplete="off"
        placeholder="0,00"
        aria-label={`Importe a aplicar del anticipo ${anticipo.nombre}`}
        aria-invalid={excede || undefined}
        value={texto}
        onChange={(e) => {
          const { texto: fmt, valor } = formatearImporteAR(e.target.value)
          setTexto(fmt)
          dispatch({ type: 'setImporteAnticipoAplicado', id: anticipo.id, importe: valor })
        }}
      />
    </div>
  )
}

/**
 * Anticipos del cliente con saldo a favor. Cada fila se marca para aplicarla y, al marcarla, su
 * importe nace en el SALDO COMPLETO —el caso habitual— y queda editable para aplicar menos.
 *
 * El importe no puede superar el pendiente del anticipo: el tope se impone en el estado (ver
 * `setImporteAnticipoAplicado`), así que tipear de más devuelve el máximo en vez de aceptarlo.
 */
export function TablaAnticipos({ anticipos, aplicaciones, cubierto }: TablaAnticiposProps) {
  const dispatch = useDispatch()

  return (
    <div className="ant-tabla-wrap">
      <table className="ant-tabla">
        <thead>
          <tr>
            <th className="ant-col-check" />
            <th>Anticipo</th>
            <th className="ant-col-cen">Fecha de vencimiento</th>
            <th className="ant-col-cen">Importe original</th>
            <th className="ant-col-cen">Pendiente de aplicar</th>
            <th className="ant-col-cen">Importe a aplicar</th>
            <th className="ant-col-cen">Restante Pends de Aplicar</th>
          </tr>
        </thead>
        <tbody>
          {anticipos.map((a) => {
            const importe = aplicaciones[a.id]
            const elegido = importe !== undefined
            /* Con cuánto saldo queda el anticipo si se aplica lo cargado. Se recalcula en vivo con
               cada tecla: es el efecto de la operación sobre el saldo a favor del cliente. */
            const restante = round2(Math.max(a.pendiente - (elegido ? importe : 0), 0))
            /* Con el total cubierto, los anticipos que NO se están usando quedan fuera de juego:
               siguen a la vista —el usuario tiene que poder ver todo su saldo a favor— pero
               apagados y sin casilla, con el motivo en el tooltip. */
            const vedado = cubierto && !elegido
            return (
              <tr
                key={a.id}
                className={`ant-row ${elegido ? 'ant-row--on' : ''} ${vedado ? 'ant-row--off' : ''}`}
                title={
                  vedado
                    ? 'El total de las facturas ya está cubierto. Ajustá o quitá un anticipo aplicado para poder usar este.'
                    : undefined
                }
              >
                <td className="ant-col-check">
                  <input
                    type="checkbox"
                    className="ant-check"
                    checked={elegido}
                    disabled={vedado}
                    onChange={() => dispatch({ type: 'toggleAnticipo', anticipo: a })}
                    aria-label={`Aplicar el anticipo ${a.nombre}`}
                  />
                </td>
                <td>
                  <span className="ant-nro">{a.nombre}</span>
                  {a.comentario && <span className="ant-detalle">{a.comentario}</span>}
                </td>
                <td className="ant-col-cen">
                  {desdeIso(a.fecha) || <span className="ant-sd">—</span>}
                </td>
                <td className="ant-col-cen ant-num">{money(a.importe)}</td>
                <td className="ant-col-cen ant-num ant-pend">{money(a.pendiente)}</td>
                <td className="ant-col-cen">
                  {elegido ? (
                    <ImporteAplicado anticipo={a} importe={importe} />
                  ) : (
                    /* El hueco mide lo MISMO que el input al que reemplaza: la fila tiene que medir
                       igual esté marcada o no, y sin reservar ese alto tildar el anticipo la
                       empujaba unos pixeles. */
                    <span className="ant-aplicar-hueco ant-sd">—</span>
                  )}
                </td>
                <td className="ant-col-cen ant-num">
                  <span className={restante === 0 ? 'ant-restante--cero' : 'ant-restante'}>
                    {money(restante)}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
