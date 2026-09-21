import { money } from '@/lib/format'
import { proporcion, type ResumenCobranza } from '@/lib/cobranza'
import { Esqueleto } from './Esqueleto'

/** Un indicador de la fila: rótulo, cifra y una línea de contexto debajo. */
interface Kpi {
  rotulo: string
  valor: string
  /** Contexto de la cifra ("29,39% de lo pendiente"). */
  pie: string
  icono: string
  tono: 'verde' | 'rojo' | 'azul'
  /** El indicador que ABRE la fila: la cifra va más grande y en el azul del total. */
  destacado?: boolean
}

/**
 * Los tres números de la cobranza, al estilo del widget "Numbers" de Monday: cuánto hay para cobrar
 * y cómo se reparte entre lo que todavía no venció y lo que ya venció.
 *
 * Se leen de izquierda a derecha del total a sus dos partes: primero cuánto es todo —que es la
 * pregunta con la que se entra— y después de qué está hecho. Son los de TODAS las cuentas del
 * resultado, no los de la página que se está viendo.
 *
 * Los colores salen de la app: el azul del total, el verde de lo que está bien y el rojo de lo que
 * hay que mirar.
 */
export function KpisCobranza({
  resumen,
  /** Todavía no hay datos: las cifras se dibujan en gris, sin mover el layout. */
  listo,
  cargando,
}: {
  resumen: ResumenCobranza
  listo: boolean
  cargando: boolean
}) {
  const pctVencido = proporcion(resumen.vencido, resumen.pendiente)

  const kpis: Kpi[] = [
    {
      rotulo: 'Total deuda pendiente',
      valor: money(resumen.pendiente),
      pie: `sobre ${money(resumen.total)} facturados`,
      icono: 'fa-hand-holding-dollar',
      tono: 'azul',
      destacado: true,
    },
    {
      rotulo: 'Total no vencido',
      valor: money(resumen.aVencer),
      pie: `${proporcion(resumen.aVencer, resumen.pendiente)}% de lo pendiente`,
      icono: 'fa-calendar-check',
      tono: 'verde',
    },
    {
      rotulo: 'Vencido',
      valor: money(resumen.vencido),
      pie:
        resumen.moraMaxima !== null
          ? `${pctVencido}% de lo pendiente · hasta ${resumen.moraMaxima} días de mora`
          : `${pctVencido}% de lo pendiente`,
      icono: 'fa-triangle-exclamation',
      tono: 'rojo',
    },
  ]

  return (
    <div className="cbz-kpis">
      {kpis.map((k) => (
        <div key={k.rotulo} className={`cbz-kpi ${k.destacado ? 'cbz-kpi--total' : ''}`}>
          <span className={`cobro-cab-ic cbz-kpi-ic cbz-kpi-ic--${k.tono}`}>
            <i className={`fas ${k.icono}`} />
          </span>
          {/* Los dos renglones del dato existen SIEMPRE, con o sin resultado: el bloque gris va
              ADENTRO del mismo elemento que después va a mostrar la cifra, así que el alto de la
              tarjeta lo fija su tipografía (ver `cbz-kpi-num` y `cbz-kpi-pie` en `cobranza.css`) y
              no lo que haya cargado. Sin esto la fila de indicadores crecía al llegar la respuesta. */}
          <div className="cbz-kpi-campo">
            <span className="cobro-cab-lbl cbz-kpi-lbl">{k.rotulo}</span>
            <span className={`cbz-kpi-num cbz-kpi-num--${k.tono}`}>
              {listo ? k.valor : <Esqueleto ancho="130px" alto={16} pulso={cargando} />}
            </span>
            <span className="cbz-kpi-pie">
              {listo ? k.pie : <Esqueleto ancho="90px" alto={9} pulso={cargando} />}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}
