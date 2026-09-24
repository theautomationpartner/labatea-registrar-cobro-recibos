import { money, pct } from '@/lib/format'
import { proporcion, TRAMOS_VENCIMIENTO, type FilaCobranza } from '@/lib/cobranza'
import { MOVIMIENTOS_POR_PAGINA } from '@/lib/resumenCtaCte'
import { semaforoDeCredito } from '@/lib/selectors'
import { TablaFacturasAdeudadas } from '@/features/resumen/TablaFacturasAdeudadas'

/**
 * Una de las cuatro cifras de la línea de crédito. Todas se leen igual —rótulo chico arriba, importe
 * abajo—; la del uso lleva además su barra con el semáforo.
 */
function Cifra({
  rotulo,
  valor,
  tono,
  children,
}: {
  rotulo: string
  valor: string
  /** Clase de color del importe (`v-green`, `v-red`…). Sin ella va en el negro de la app. */
  tono?: string
  children?: React.ReactNode
}) {
  return (
    <div className="cbz-credito">
      <span className="cbz-credito-lbl">{rotulo}</span>
      <span className={`cbz-credito-val ${tono ?? ''}`}>{valor}</span>
      {children}
    </div>
  )
}

/**
 * Lo que se abre al desplegar una cuenta de la tabla, en tres bloques y en este orden:
 *
 *   1. SUS FACTURAS pendientes, que es a lo que se vino;
 *   2. cómo se reparte esa deuda entre los tramos de vencimiento;
 *   3. la LÍNEA DE CRÉDITO de la cuenta: límite, utilizada, disponible y qué porcentaje tiene tomado.
 *
 * Las facturas se listan con la MISMA tabla que las muestra el RESUMEN DE CTA CTE
 * (`TablaFacturasAdeudadas`): son las mismas facturas del mismo tablero, así que no hay motivo para
 * que se vean distinto en las dos pantallas —ni para tener dos tablas que mantener—.
 *
 * El crédito va al final y no arriba a propósito: es el contexto con el que se decide QUÉ hacer con
 * la deuda que se acaba de leer, no el dato con el que se entra.
 */
export function DetalleCuenta({ fila }: { fila: FilaCobranza }) {
  const { cuenta } = fila
  const conTramos = TRAMOS_VENCIMIENTO.filter((t) => fila.porTramo[t.valor] > 0)
  const semaforo = fila.usoLinea !== null ? semaforoDeCredito(fila.usoLinea) : null

  return (
    <div className="cbz-detalle">
      {fila.facturas.length === 0 ? (
        <p className="cobro-vacio cbz-detalle-vacio">
          <i className="fas fa-circle-info" /> Esta cuenta no tiene facturas pendientes en el estado
          de vencimiento buscado. Su saldo puede venir de comprobantes en otro estado o de
          movimientos que no son facturas.
        </p>
      ) : (
        /* La `key` es la cuenta: otra lista arranca en la primera página. */
        <TablaFacturasAdeudadas
          key={cuenta.id}
          facturas={fila.facturas}
          porPagina={MOVIMIENTOS_POR_PAGINA}
        />
      )}

      {conTramos.length > 0 && (
        <div className="cbz-detalle-tramos">
          {conTramos.map((t) => (
            <span key={t.valor} className="cbz-tramo-pill">
              <span className="cbz-leyenda-punto" style={{ background: t.color }} />
              {t.corto}
              <strong>{money(fila.porTramo[t.valor])}</strong>
              <span className="cbz-tramo-pct">
                {proporcion(fila.porTramo[t.valor], fila.pendiente)}%
              </span>
            </span>
          ))}
        </div>
      )}

      <div className="cbz-creditos">
        <Cifra
          rotulo="Límite de crédito"
          valor={cuenta.limite > 0 ? money(cuenta.limite) : 'sin límite asignado'}
        />
        <Cifra rotulo="Línea utilizada" valor={money(cuenta.lineaUtilizada)} />
        <Cifra
          rotulo="Línea de crédito disponible"
          valor={money(fila.creditoDisponible)}
          /* Pasado de límite el disponible es negativo: en rojo, que es lo que hay que ver. */
          tono={fila.creditoDisponible < 0 ? 'v-red' : 'v-green'}
        />
        <Cifra
          rotulo="Uso de línea"
          valor={fila.usoLinea === null ? '—' : pct(fila.usoLinea)}
          tono={semaforo?.clase}
        >
          {semaforo && fila.usoLinea !== null && (
            <span className="cbz-uso-track">
              <span
                className="cbz-uso-fill"
                style={{
                  width: `${Math.min(Math.max(fila.usoLinea, 0), 100)}%`,
                  background: semaforo.color,
                }}
              />
            </span>
          )}
        </Cifra>
      </div>
    </div>
  )
}
