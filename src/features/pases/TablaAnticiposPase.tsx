import { useEffect, useState } from 'react'
import { excedeAnticipo } from '@/lib/cobros'
import { desdeIso } from '@/lib/dates'
import { formatearImporteAR, importeATexto, money, round2 } from '@/lib/format'
import { useApp, useDispatch } from '@/state/hooks'
import type { AnticipoPendiente } from '@/types'

/** Cuánto del anticipo se pasa: texto propio con formato AR, número en el estado global. */
function ImporteAPasar({ anticipo, importe }: { anticipo: AnticipoPendiente; importe: number }) {
  const dispatch = useDispatch()
  const [texto, setTexto] = useState<string>(() => (importe > 0 ? importeATexto(importe) : ''))

  /* Resincroniza cuando el importe cambia desde AFUERA: al marcar el anticipo se propone su saldo
     completo, y si se tipea de más el estado lo topea contra el pendiente. */
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
     al usuario—, así que el error es lo único que lo señala. */
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
        aria-label={`Importe a debitar del anticipo ${anticipo.recibo || anticipo.nombre}`}
        aria-invalid={excede || undefined}
        value={texto}
        onChange={(e) => {
          const { texto: fmt, valor } = formatearImporteAR(e.target.value)
          setTexto(fmt)
          dispatch({ type: 'setImportePase', id: anticipo.id, importe: valor })
        }}
      />
    </div>
  )
}

/**
 * Anticipos del cliente ORIGEN de un pase: cuál se mueve y por cuánto.
 *
 * Es la MISMA tabla que la de "Aplicar Anticipo contra Facturas" —mismas columnas, mismas clases,
 * mismo comportamiento de fila— porque es la misma pregunta hecha en otro recorrido: de qué saldo a
 * favor se dispone y cuánto de él se usa. Que las dos se vean igual es lo que hace que quien conoce
 * una no tenga que aprender la otra.
 *
 * Se pueden elegir VARIOS: un pase junta el saldo de todos los anticipos marcados, y su suma es lo
 * que se debita de la cuenta origen. Cada uno lleva su propio importe editable, así que se puede
 * pasar el saldo entero de uno y sólo una parte de otro.
 */
export function TablaAnticiposPase({ anticipos }: { anticipos: readonly AnticipoPendiente[] }) {
  const { pasesDeAnticipo } = useApp()
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
            <th className="ant-col-cen">Importe a Debitar</th>
            <th className="ant-col-cen">Restante Pends de Aplicar</th>
          </tr>
        </thead>
        <tbody>
          {anticipos.map((a) => {
            const importe = pasesDeAnticipo[a.id]
            const elegido = importe !== undefined
            /* Con cuánto saldo queda el anticipo si se pasa lo cargado. Se recalcula en vivo con
               cada tecla: es el efecto de la operación sobre el saldo a favor del cliente. */
            const restante = round2(Math.max(a.pendiente - (elegido ? importe : 0), 0))
            return (
              <tr
                key={a.id}
                className={`ant-row ${elegido ? 'ant-row--on' : ''}`}
              >
                <td className="ant-col-check">
                  <input
                    type="checkbox"
                    className="ant-check"
                    checked={elegido}
                    onChange={() => dispatch({ type: 'toggleAnticipoPase', anticipo: a })}
                    aria-label={`Pasar el saldo del anticipo ${a.recibo || a.nombre}`}
                  />
                </td>
                <td>
                  <span className="ant-nro">{a.recibo || a.nombre}</span>
                  {a.comentario && <span className="ant-detalle">{a.comentario}</span>}
                </td>
                <td className="ant-col-cen">
                  {desdeIso(a.fecha) || <span className="ant-sd">—</span>}
                </td>
                <td className="ant-col-cen ant-num">{money(a.importe)}</td>
                <td className="ant-col-cen ant-num ant-pend">{money(a.pendiente)}</td>
                <td className="ant-col-cen">
                  {elegido ? (
                    <ImporteAPasar anticipo={a} importe={importe} />
                  ) : (
                    /* El hueco mide lo MISMO que el input al que reemplaza: la fila tiene que medir
                       igual esté marcada o no, o tildar el anticipo la empujaría unos pixeles. */
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
