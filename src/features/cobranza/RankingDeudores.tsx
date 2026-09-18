import { money } from '@/lib/format'
import { proporcion, topDeudores, TOP_DEUDORES, type FilaCobranza } from '@/lib/cobranza'
import { Esqueleto } from './Esqueleto'

/**
 * Las cuentas que más deben, con la forma del widget "Chart" de Monday en barras horizontales: una
 * barra por cuenta, de la que más debe a la que menos.
 *
 * El ancho de cada barra es relativo a la PRIMERA y no al total del conjunto: con veinte deudores
 * parejos, medir contra el total daría veinte barras de 5% —todas iguales y sin información—. Medido
 * contra el mayor, la barra dice de una cuánto más grande es un deudor que el siguiente, que es la
 * pregunta que este widget contesta. El porcentaje escrito al lado sí es sobre el total, que es el
 * número que hace falta para decidir a quién llamar primero.
 *
 * La barra está partida en dos: lo VENCIDO en rojo y lo que todavía no venció en azul. Dos cuentas
 * con la misma deuda no son el mismo problema si una la tiene toda vencida.
 */
export function RankingDeudores({
  filas,
  pendienteTotal,
  /** Se llama al clickear una barra: la tabla salta a esa cuenta y la abre. */
  onElegir,
  listo,
  cargando,
}: {
  filas: readonly FilaCobranza[]
  pendienteTotal: number
  onElegir: (fila: FilaCobranza) => void
  listo: boolean
  cargando: boolean
}) {
  const top = topDeudores(filas, TOP_DEUDORES)
  const mayor = top[0]?.pendiente ?? 0

  return (
    <div className="cbz-widget">
      <div className="cbz-widget-head">
        <h3 className="cbz-widget-title">
          <i className="fas fa-ranking-star" /> Cuentas que más deben
        </h3>
        {listo ? (
          <span className="cbz-widget-total">{top.length > 0 ? `top ${top.length}` : ''}</span>
        ) : (
          <Esqueleto ancho="48px" alto={15} pulso={cargando} />
        )}
      </div>

      {!listo ? (
        /* UNA sola barra en gris: el widget vacío mide lo mismo que con una cuenta cargada, y sólo
           crece a partir de la segunda. Lleva sus TRES renglones —nombre, barra y pie— porque es el
           alto de esos tres lo que tiene que quedar reservado. */
        <ol className="cbz-ranking">
          <li className="cbz-rank-item cbz-rank-item--gris">
            <span className="cbz-rank-cab">
              <Esqueleto ancho="180px" pulso={cargando} />
              <Esqueleto ancho="90px" pulso={cargando} />
            </span>
            <span className="cbz-rank-barra" />
            <span className="cbz-rank-pie">
              <Esqueleto ancho="150px" alto={10} pulso={cargando} />
            </span>
          </li>
        </ol>
      ) : top.length === 0 ? (
        /* Mismo alto que una barra: que la búsqueda no traiga deudores no puede encoger el widget. */
        <p className="cobro-vacio cbz-widget-vacio cbz-rank-vacio">
          <i className="fas fa-circle-check" /> Ninguna de las cuentas alcanzadas tiene deuda
          pendiente con este criterio.
        </p>
      ) : (
        <ol className="cbz-ranking">
          {top.map((fila) => {
            const ancho = proporcion(fila.pendiente, mayor)
            const anchoVencido = proporcion(fila.vencido, fila.pendiente)
            return (
              <li key={fila.cuenta.id} className="cbz-rank-item">
                <button
                  type="button"
                  className="cbz-rank-btn"
                  onClick={() => onElegir(fila)}
                  title={`Ver las facturas de ${fila.cuenta.cliente}`}
                >
                  <span className="cbz-rank-cab">
                    <span className="cbz-rank-cli">{fila.cuenta.cliente}</span>
                    <span className="cbz-rank-num">{money(fila.pendiente)}</span>
                  </span>

                  <span className="cbz-rank-barra">
                    <span className="cbz-rank-relleno" style={{ width: `${ancho}%` }}>
                      {/* El tramo vencido se pinta ADENTRO de la barra de la cuenta: así el rojo se
                          lee como "de lo que debe, esto ya venció" y no como otra magnitud. */}
                      <span className="cbz-rank-vencido" style={{ width: `${anchoVencido}%` }} />
                    </span>
                  </span>

                  <span className="cbz-rank-pie">
                    <span>
                      {fila.cantidad} {fila.cantidad === 1 ? 'factura' : 'facturas'}
                    </span>
                    {fila.vencido > 0 && (
                      <span className="cbz-rank-alerta">
                        <i className="fas fa-triangle-exclamation" /> {money(fila.vencido)} vencidos
                        {fila.diasMora !== null && ` · ${fila.diasMora} días`}
                      </span>
                    )}
                    <span className="cbz-rank-share">
                      {proporcion(fila.pendiente, pendienteTotal)}% del total
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
