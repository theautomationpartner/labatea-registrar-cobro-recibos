import { money } from '@/lib/format'
import {
  CUENTAS_POR_PAGINA,
  ESTADOS_SALDO,
  type FilaCobranza,
  type OrdenCobranza,
} from '@/lib/cobranza'
import { paginar } from '@/lib/resumenCtaCte'
import { PaginadorMovimientos } from '@/features/resumen/PaginadorMovimientos'
import { DetalleCuenta } from './DetalleCuenta'
import type { FilaDesplegada } from './useFilaDesplegada'

const guion = <span className="ant-sd">—</span>

/** Las columnas de la tabla. Las que tienen `orden` se pueden ordenar clickeando su encabezado. */
const COLUMNAS: readonly {
  titulo: string
  orden?: OrdenCobranza
  centrada?: boolean
  /** Sólo para el ancho de la columna del desplegable, que no tiene rótulo. */
  estrecha?: boolean
}[] = [
  { titulo: '', estrecha: true },
  { titulo: 'Cuenta / Cliente', orden: 'cliente' },
  { titulo: 'Estado del saldo', centrada: true },
  { titulo: 'Saldo de la cuenta', orden: 'saldo', centrada: true },
  { titulo: 'Anticipos a favor', orden: 'anticipos', centrada: true },
  { titulo: 'Facturas', orden: 'facturas', centrada: true },
  { titulo: 'Pend de Cobrar', orden: 'pendiente', centrada: true },
  { titulo: 'Vencido', orden: 'vencido', centrada: true },
]

/** El tono de la pastilla del estado del saldo, por su clave. */
const TONO_SALDO = Object.fromEntries(ESTADOS_SALDO.map((e) => [e.valor, e.tono])) as Record<
  string,
  string
>

interface TablaCuentasProps {
  /** Las filas YA ordenadas: el orden lo decide la vista, que es la que lo tiene en su estado. */
  filas: readonly FilaCobranza[]
  orden: OrdenCobranza
  descendente: boolean
  onOrdenar: (orden: OrdenCobranza) => void
  /** Qué fila está desplegada y cuál se está animando (ver `useFilaDesplegada`). */
  plegado: FilaDesplegada
  pagina: number
  onPagina: (pagina: number) => void
  /** Hay una consulta en vuelo: la tabla lo dice en su renglón, sin cambiar de alto. */
  cargando: boolean
}

/**
 * La tabla de cuentas del tablero, con la forma del widget "Table" de Monday: encabezados que
 * ordenan, una fila por cuenta y el detalle que se despliega abajo de la fila.
 *
 * Usa las clases de la tabla de anticipos (`ant-tabla`, ver `anticipos.css`) como el resto de las
 * tablas de sólo lectura de la app, así que no introduce otra tipografía ni otros filetes.
 *
 * SIN CUENTAS —todavía no se buscó, o la búsqueda no trajo ninguna— la tabla se dibuja igual, con su
 * encabezado y UN renglón que lo dice. Mide exactamente lo que mediría con una cuenta: el alto sólo
 * cambia cuando hay más de una, así que la pantalla no salta al aparecer el resultado.
 *
 * Se despliega UNA cuenta a la vez: el detalle es alto —trae la tabla de facturas del cliente— y con
 * varias abiertas la lista deja de poder recorrerse. Clickear la abierta la cierra.
 *
 * De a diez por página. El paginador aparece sólo con más de diez cuentas, y mientras pagina la
 * tabla reserva SIEMPRE el alto de una página completa: pasar a la última no encoge la pantalla.
 */
export function TablaCuentas({
  filas,
  orden,
  descendente,
  onOrdenar,
  plegado,
  pagina,
  onPagina,
  cargando,
}: TablaCuentasProps) {
  const paginada = filas.length > CUENTAS_POR_PAGINA
  const hoja = paginar(filas, pagina, paginada ? CUENTAS_POR_PAGINA : Math.max(filas.length, 1))
  const vacia = filas.length === 0

  return (
    <div className="anticipos-v2 mov-ctacte cbz-tabla">
      <div className="ant-tabla-wrap">
        <table className="ant-tabla">
          <thead>
            <tr>
              {COLUMNAS.map((c) => {
                const activa = c.orden === orden
                return (
                  <th
                    key={c.titulo || 'desplegar'}
                    className={`${c.centrada ? 'ant-col-cen' : ''} ${c.estrecha ? 'cbz-col-chevron' : ''}`}
                    aria-sort={activa ? (descendente ? 'descending' : 'ascending') : undefined}
                  >
                    {c.orden ? (
                      <button
                        type="button"
                        className={`cbz-th-orden ${activa ? 'cbz-th-orden--on' : ''}`}
                        disabled={vacia}
                        onClick={() => onOrdenar(c.orden as OrdenCobranza)}
                        title={`Ordenar por ${c.titulo}`}
                      >
                        {c.titulo}
                        <i
                          className={`fas ${
                            activa
                              ? descendente
                                ? 'fa-arrow-down-long'
                                : 'fa-arrow-up-long'
                              : 'fa-sort'
                          }`}
                        />
                      </button>
                    ) : (
                      c.titulo
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>

          <tbody>
            {/* Sin cuentas: UN renglón con el motivo, del alto de una fila con datos. */}
            {vacia && (
              <tr className="cbz-fila-vacia">
                <td colSpan={COLUMNAS.length}>
                  <div className="mov-comp cbz-vacia">
                    {cargando ? (
                      <>
                        <i className="fas fa-spinner fa-spin" /> Buscando las cuentas corrientes...
                      </>
                    ) : (
                      'No se encontraron cuentas corrientes'
                    )}
                  </div>
                </td>
              </tr>
            )}

            {hoja.items.map((fila) => {
              const { cuenta } = fila
              const desplegada = plegado.abierta === cuenta.id

              return [
                <tr
                  key={cuenta.id}
                  className={`ant-row cbz-fila ${desplegada ? 'cbz-fila--on' : ''}`}
                  onClick={() => plegado.alternar(cuenta.id)}
                >
                  <td className="cbz-col-chevron">
                    {/* El botón repite lo que hace la fila entera: la fila es el blanco cómodo y el
                        botón es el que el teclado y el lector de pantalla pueden alcanzar. */}
                    <button
                      type="button"
                      className={`cbz-chevron ${desplegada ? 'cbz-chevron--on' : ''}`}
                      aria-expanded={desplegada}
                      aria-label={`${desplegada ? 'Cerrar' : 'Ver'} las facturas de ${cuenta.cliente}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        plegado.alternar(cuenta.id)
                      }}
                    >
                      <i className="fas fa-chevron-right" />
                    </button>
                  </td>

                  <td>
                    <div className="mov-comp">
                      <span className="ant-nro">{cuenta.cliente}</span>
                      <span className="ant-detalle">
                        {cuenta.nro}
                        {cuenta.codigo && ` · cliente ${cuenta.codigo}`}
                      </span>
                    </div>
                  </td>

                  <td className="ant-col-cen">
                    <span
                      className={`cbz-saldo cbz-saldo--${
                        cuenta.estadoSaldo ? TONO_SALDO[cuenta.estadoSaldo] : 'cero'
                      }`}
                    >
                      <span className="fact-estado-dot" />
                      {cuenta.estadoSaldoLabel || 'sin estado'}
                    </span>
                  </td>

                  <td className="ant-col-cen ant-num">{money(cuenta.ventasPendCancelar)}</td>
                  {/* El saldo a FAVOR del cliente: en verde, como todo lo que juega a su favor. */}
                  <td className="ant-col-cen ant-num">
                    {cuenta.anticipos === 0 ? (
                      guion
                    ) : (
                      <span className="cbz-num-favor">{money(cuenta.anticipos)}</span>
                    )}
                  </td>
                  <td className="ant-col-cen">{fila.cantidad === 0 ? guion : fila.cantidad}</td>
                  <td className="ant-col-cen ant-num">
                    {fila.pendiente === 0 ? guion : money(fila.pendiente)}
                  </td>
                  <td className="ant-col-cen ant-num">
                    {fila.vencido === 0 ? (
                      guion
                    ) : (
                      <span className="cbz-num-vencido">{money(fila.vencido)}</span>
                    )}
                  </td>
                </tr>,

                /* El detalle sigue montado mientras se pliega: es lo que permite verlo cerrarse en
                   vez de desaparecer de un corte (ver `useFilaDesplegada`). */
                plegado.montada(cuenta.id) && (
                  <tr key={`${cuenta.id}-detalle`} className="cbz-detalle-fila">
                    <td colSpan={COLUMNAS.length}>
                      <div
                        className={`cbz-exp-wrap ${
                          plegado.plegando === cuenta.id
                            ? 'cbz-exp-wrap--cerrando'
                            : plegado.abriendo === cuenta.id
                              ? 'cbz-exp-wrap--abriendo'
                              : ''
                        }`}
                      >
                        <div className="cbz-exp-in">
                          <DetalleCuenta fila={fila} />
                        </div>
                      </div>
                    </td>
                  </tr>
                ),
              ]
            })}

            {/* La página incompleta se completa con filas en blanco: la tabla no se encoge al llegar
                a la última y lo que está debajo no salta de lugar. Con una cuenta desplegada NO se
                rellena: el detalle ya hizo crecer la tabla, y sumar huecos la estiraría al doble. */}
            {paginada &&
              plegado.abierta === null &&
              Array.from({ length: hoja.vacias }, (_, i) => (
                <tr key={`relleno-${i}`} className="mov-relleno" aria-hidden="true">
                  <td colSpan={COLUMNAS.length}>
                    <div className="mov-comp" />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {paginada && (
        <PaginadorMovimientos
          pagina={hoja.pagina}
          totalPaginas={hoja.totalPaginas}
          desde={hoja.desde}
          hasta={hoja.hasta}
          total={hoja.total}
          sustantivo="cuentas"
          onCambiar={onPagina}
        />
      )}
    </div>
  )
}
