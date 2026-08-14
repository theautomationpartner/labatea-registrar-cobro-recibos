import type { ReactNode } from 'react'
import { aplicaCredito, motivoCreditoIgnorado, tieneValoresCredito } from '@/lib/credito'
import { money } from '@/lib/format'
import { creditoCliente } from '@/lib/selectors'
import type { Cliente, SaldosCliente } from '@/types'

const colorActividad = (c: Cliente) => (c.activity === 'Activo' ? 'var(--green)' : 'var(--red)')

const colorSituacion = (c: Cliente) => {
  switch (c.situation) {
    case 'Liberado con crédito':
      return 'var(--yellow)'
    case 'Liberado sin crédito':
      return 'var(--green)'
    default:
      return 'var(--red)'
  }
}

/** Muestra el valor o «Sin especificar» si viene vacío. */
const oSinEsp = (v: string | null | undefined) => (v && v.trim() ? v : 'Sin especificar')

interface ClienteFichaProps {
  /** null mientras no se buscó/eligió un cliente: la ficha se muestra igual, en skeleton. */
  cliente: Cliente | null
  /** La consulta a Monday está en curso: se mantiene el skeleton. */
  cargando?: boolean
  /**
   * Saldos de la cuenta corriente. Viajan APARTE del cliente porque salen de otro tablero y de otra
   * consulta: llegan después, así que sus dos cajas se resuelven solas —siguen en skeleton mientras
   * el resto de la ficha ya se ve—. `null` = todavía no llegaron.
   */
  saldos?: SaldosCliente | null
  /** Contenido opcional debajo del separador. */
  children?: ReactNode
}

/**
 * Ficha del cliente. La ESTRUCTURA se muestra SIEMPRE: sin cliente —o mientras se consulta— cada
 * caja queda en skeleton, y al resolverse la búsqueda se rellena con los datos reales. Así el paso
 * no salta de alto ni aparece y desaparece contenido.
 *
 * El bloque financiero encabeza con el SALDO DE CUENTA CORRIENTE: en esta app es el dato que se
 * viene a buscar —lo que el cliente debe y se va a cobrar—, mientras que el límite y la línea son
 * contexto. Cuando el límite no rige la operación, el grupo se apaga: los datos siguen a la vista,
 * pero se lee de un golpe que no van a usarse, y debajo se aclara por qué.
 */
export function ClienteFicha({
  cliente,
  cargando = false,
  saldos = null,
  children,
}: ClienteFichaProps) {
  const credito = cliente ? creditoCliente(cliente) : null
  const claseImporte = credito?.bloqueado ? 'v-gray' : ''
  const rigeCredito = cliente ? aplicaCredito(cliente) : false
  const muestraValores = cliente ? rigeCredito || tieneValoresCredito(cliente) : true
  const motivoIgnorado = cliente ? motivoCreditoIgnorado(cliente) : null
  const tieneRetenciones = !!cliente?.ret && cliente.ret.trim() !== '' && cliente.ret !== 'Ninguna'
  const faltaLista = cliente ? !cliente.list : false
  // Sin cliente (o mientras consulta): las cajas van vacías, con el layout preservado.
  const vacio = !cliente || cargando

  /** Valor de una métrica, o un skeleton si todavía no hay dato. */
  const val = (contenido: ReactNode, clase = '') =>
    vacio ? (
      <span className="skeleton skeleton--valor" />
    ) : (
      <span className={`kpi-value ${clase}`}>{contenido}</span>
    )

  /* Los saldos de cuenta corriente llegan de OTRA consulta que la ficha del cliente, así que tienen
     su propio skeleton: mientras el resto de la ficha ya se ve, estas dos cajas siguen cargando en
     vez de mostrar un cero que después cambia solo. */
  const valSaldo = (importe: number | undefined) =>
    vacio || !saldos ? (
      <span className="skeleton skeleton--valor" />
    ) : (
      <span className={`kpi-value ${claseImporte}`}>{money(importe ?? 0)}</span>
    )

  return (
    <div
      className={`card no-radius cliente-ficha ${vacio ? 'cliente-ficha--vacio' : ''} ${
        credito?.bloqueado ? 'card--bloqueado' : ''
      }`}
    >
      <div className="client-header">
        <div>
          {vacio ? (
            <>
              <span className="skeleton skeleton--linea skeleton--corto" />
              <span className="skeleton skeleton--linea skeleton--titulo" />
              <span className="skeleton skeleton--linea skeleton--medio" />
              <div className="badges">
                <span className="skeleton skeleton--badge" />
                <span className="skeleton skeleton--badge" />
                <span className="skeleton skeleton--badge" />
              </div>
            </>
          ) : (
            <>
              <span className="client-id">Código: {cliente.codigo}</span>
              <h2 className="client-name">{cliente.name}</h2>

              <span className="client-address">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--c-primary)"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                Dirección Fiscal: {oSinEsp(cliente.addr)}
              </span>

              <div className="badges">
                <span className="badge badge-gray">CUIT: {oSinEsp(cliente.cuit)}</span>
                <span className="badge badge-gray">{oSinEsp(cliente.ptype)}</span>
                <span className={`badge badge-green ${cliente.status ? '' : 'badge--falta'}`}>
                  {oSinEsp(cliente.status)}
                </span>
                <span className={`badge badge-blue ${faltaLista ? 'badge--falta' : ''}`}>
                  Lista: {cliente.list ?? 'Sin especificar'}
                </span>
                <span
                  className={`badge badge--cond ${cliente.condicionPago ? '' : 'badge--falta'}`}
                >
                  Condicion de Pago: <strong>{cliente.condicionPago ?? 'Sin asignar'}</strong>
                </span>
                {tieneRetenciones && (
                  <span className="badge badge-purple">Retenciones: {cliente.ret}</span>
                )}
                {/* El cliente no acepta cheques: se avisa acá porque condiciona los medios de pago
                    disponibles al registrar el cobro, dos pasos más adelante. */}
                {!cliente.aceptaCheques && (
                  <span className="badge badge--falta">No recibimos cheques</span>
                )}
              </div>
            </>
          )}
        </div>

        {/* Estado comercial, arriba a la derecha. */}
        <div className="status-indicators">
          {vacio ? (
            <>
              <span className="skeleton skeleton--estado" />
              <span className="skeleton skeleton--estado" />
            </>
          ) : (
            <>
              <div className="status-indicator">
                <span className="status-dot" style={{ background: colorActividad(cliente) }} />
                {cliente.activity}
              </div>
              <div className="status-indicator">
                <span className="status-dot" style={{ background: colorSituacion(cliente) }} />
                {cliente.situation}
              </div>
            </>
          )}
        </div>
      </div>

      <hr className="divider" />

      {/* Situación financiera: qué debe el cliente y cuánta línea tiene tomada. La estructura se
          muestra siempre; el gris avisa que en esta operación el límite no va a usarse. */}
      {muestraValores && (
        <>
        <section className={`credito-grupo ${!vacio && !rigeCredito ? 'credito-grupo--off' : ''}`}>
          {/* FILA 1: la deuda de cuenta corriente al frente y, a su derecha, cómo se compone —qué
              queda por cancelar y qué saldo a favor tiene el cliente—; después el contexto de
              crédito. Los dos saldos salen de los subelementos de la cuenta corriente, no del
              board de Personas. */}
          <div className="kpi-grid kpi-grid--5">
            <div className="kpi-card">
              <span className="kpi-label">Saldo Cta Cte (deuda)</span>
              {val(money(cliente?.saldoCtaCte ?? 0), claseImporte)}
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Saldo Pend de Cancelar</span>
              {valSaldo(saldos?.pendienteDeCancelar)}
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Saldo por Anticipos</span>
              {valSaldo(saldos?.anticipos)}
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Límite asignado</span>
              {val(money(cliente?.limit ?? 0), claseImporte)}
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Remito Pends de Facturar</span>
              {val(money(cliente?.remitosPendFacturar ?? 0), claseImporte)}
            </div>
          </div>

          {/* FILA 2: crédito disponible · línea utilizada · barra de uso. */}
          <div className="credito-fila-inferior">
            <div className="credito-metrica">
              <span className="kpi-label">Crédito disponible</span>
              {val(money(credito?.disponible ?? 0), claseImporte || 'v-green')}
            </div>
            <div className="credito-metrica">
              <span className="kpi-label">Línea utilizada</span>
              {val(money(cliente?.lineaUtilizada ?? 0), claseImporte || credito?.clase || '')}
            </div>

            <div className="credito-uso">
              <div className="progress-header">
                <span>Uso de límite de crédito</span>
                <strong>{vacio ? '—' : `${credito?.usadoPct ?? 0}% Utilizado`}</strong>
              </div>
              <div className="progress-track">
                {!vacio && (
                  <div
                    className="progress-fill"
                    style={{
                      width: `${Math.min(Math.max(credito?.usadoPct ?? 0, 0), 100)}%`,
                      background: credito?.color,
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Por qué el límite no va a pesar en esta operación. */}
        {motivoIgnorado && <p className="credito-nota-off">{motivoIgnorado}</p>}
        </>
      )}

      {/* Debajo del separador: contenido extra, si se pasa. */}
      {children && (
        <>
          <hr className="divider" />
          {children}
        </>
      )}
    </div>
  )
}
