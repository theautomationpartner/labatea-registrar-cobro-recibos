import { money } from '@/lib/format'
import { proporcion, textoClaroSobre, TRAMOS_VENCIMIENTO, type PorTramo } from '@/lib/cobranza'
import { Esqueleto } from './Esqueleto'

/**
 * Cómo se reparte la deuda pendiente entre los cinco tramos de vencimiento, con la forma del widget
 * "Battery" de Monday: UNA barra apilada con una franja por tramo y, debajo, la leyenda con el
 * importe y el porcentaje de cada uno.
 *
 * La barra contesta la pregunta de un vistazo —¿esto es deuda fresca o vieja?— y la leyenda da el
 * número exacto. Los colores son los de `TRAMOS_VENCIMIENTO`, los mismos del select del criterio y de
 * la pastilla de la tabla: una vez que el usuario aprende que el rojo profundo es "+ 60", lo lee
 * igual en las tres partes de la pantalla.
 *
 * Los tramos en cero NO se dibujan en la barra pero SÍ se listan en la leyenda, en gris: que un tramo
 * no tenga deuda es un dato tan útil como que la tenga, y esconderlo haría que la leyenda cambiara de
 * alto con cada búsqueda.
 *
 * La leyenda tiene CINCO renglones y ninguno más: lo que el tablero no clasificó no se lista. Cuando
 * hay facturas sin estado de vencimiento cargado, las franjas no llegan a cubrir la barra entera y el
 * hueco que queda lo dice sin necesidad de un renglón que casi siempre marcaba cero.
 */
export function BateriaVencimientos({
  porTramo,
  pendiente,
  /** Todavía no hay datos: la barra y las cifras van en gris, con la leyenda entera montada. */
  listo,
  cargando,
}: {
  porTramo: PorTramo
  /** El total pendiente: el 100% de la barra. */
  pendiente: number
  listo: boolean
  cargando: boolean
}) {
  const franjas = TRAMOS_VENCIMIENTO.map((t) => ({
    ...t,
    importe: porTramo[t.valor],
    pct: proporcion(porTramo[t.valor], pendiente),
  }))

  return (
    <div className="cbz-widget cbz-widget--bateria">
      <div className="cbz-widget-head">
        <h3 className="cbz-widget-title">
          <i className="fas fa-layer-group" /> Deuda por estado de vencimiento
        </h3>
        {listo ? (
          <span className="cbz-widget-total">{money(pendiente)}</span>
        ) : (
          <Esqueleto ancho="110px" alto={15} pulso={cargando} />
        )}
      </div>

      <div
        className="cbz-bateria"
        role="img"
        aria-label={
          listo
            ? `Reparto de ${money(pendiente)} pendientes por estado de vencimiento`
            : 'Reparto de la deuda por estado de vencimiento, todavía sin datos'
        }
      >
        {listo &&
          franjas
            .filter((f) => f.importe > 0)
            .map((f) => (
              <span
                key={f.valor}
                className="cbz-bateria-franja"
                style={{ width: `${f.pct}%`, background: f.color }}
                title={`${f.label}: ${money(f.importe)} (${f.pct}%)`}
              >
                {/* El porcentaje se escribe DENTRO de la franja sólo si entra: en una franja angosta
                    el texto se saldría y taparía a la de al lado. */}
                {f.pct >= 8 && (
                  <span
                    className={`cbz-bateria-pct ${
                      textoClaroSobre(f.color) ? 'cbz-bateria-pct--claro' : ''
                    }`}
                  >
                    {Math.round(f.pct)}%
                  </span>
                )}
              </span>
            ))}
      </div>

      <ul className="cbz-leyenda">
        {franjas.map((f) => (
          <li
            key={f.valor}
            className={`cbz-leyenda-item ${listo && f.importe === 0 ? 'cbz-leyenda-item--off' : ''}`}
          >
            <span className="cbz-leyenda-punto" style={{ background: f.color }} />
            <span className="cbz-leyenda-lbl">{f.corto}</span>
            {listo ? (
              <>
                <span className="cbz-leyenda-num">{money(f.importe)}</span>
                <span className="cbz-leyenda-pct">{f.pct}%</span>
              </>
            ) : (
              <>
                <Esqueleto ancho="86px" pulso={cargando} />
                <Esqueleto ancho="34px" pulso={cargando} />
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
