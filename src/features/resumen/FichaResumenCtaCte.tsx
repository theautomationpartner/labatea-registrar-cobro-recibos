import { Avatar } from '@/components/ui/Avatar'
import { Fila } from '@/features/recibo/ResumenRecibo'
import { money } from '@/lib/format'
import { FORMATOS_RESUMEN, OPCIONES_ESTADO_CTA_CTE } from '@/lib/resumenCtaCte'
import { useApp, useDispatch } from '@/state/hooks'
import type { ReactNode } from 'react'
import type { Cliente, ErrorEmision, FaseEmision, FormatoResumen } from '@/types'

interface FichaResumenCtaCteProps {
  cliente: Pick<Cliente, 'name' | 'cuit'>
  /** El período elegido en el paso 1, ya nombrado (ver `rotuloCriterio`). Vacío = sin período. */
  rotuloPeriodo: string
  /** Con qué saldo termina la cuenta en el período: el del último movimiento. */
  saldoFinal: number
  /** "🤖Remito Pends de Facturar" de la cuenta corriente (numeric_mm5f2npa). */
  mercaderiaPendFacturar: number
  /** En qué anda la emisión —la generación de los archivos en la app—. */
  fase: FaseEmision
  error: ErrorEmision | null
  /** Se intentó emitir sin formato: el selector queda en rojo hasta que se elija uno. */
  marcarFormato: boolean
  onEmitir: () => void
  /** Lo que va pegado debajo del botón de emisión: "Ver / Imprimir" y la descarga del Excel. */
  children?: ReactNode
}

/**
 * Resumen de la operación antes de emitir: quién la emite, de qué cliente, qué período abarca y en
 * qué formato sale el archivo. Es la MISMA ficha que la del recibo y la orden de pago —mismos grupos,
 * mismos renglones, mismo botón al pie—, con el campo "Formato" justo antes del botón: es lo último
 * que se decide, y es obligatorio.
 */
export function FichaResumenCtaCte({
  cliente,
  rotuloPeriodo,
  saldoFinal,
  mercaderiaPendFacturar,
  fase,
  error,
  marcarFormato,
  onEmitir,
  children,
}: FichaResumenCtaCteProps) {
  const { usuario, resumenEstadoCtaCte, resumenFormato } = useApp()
  const dispatch = useDispatch()
  const enCurso = fase === 'creando'
  const formatoEnFalta = marcarFormato && !resumenFormato

  return (
    <div className="card resumen-recibo">
      <h3 className="resumen-title">Resumen de Cta Cte</h3>

      <div className="rgroup">
        <Fila label="Vendedor">
          {usuario ? (
            <>
              <Avatar ini={usuario.ini} color={usuario.color} size="sm" /> {usuario.name}
            </>
          ) : (
            '--'
          )}
        </Fila>
        <Fila label="Cliente razón social">{cliente.name}</Fila>
        <Fila label="CUIT del Cliente">{cliente.cuit || '--'}</Fila>
      </div>

      <hr className="rsep" />

      <div className="rgroup">
        <Fila label="Período">{rotuloPeriodo || '--'}</Fila>
        <Fila label="Estado de Cta Cte">
          {OPCIONES_ESTADO_CTA_CTE.find((o) => o.valor === resumenEstadoCtaCte)?.label ?? '--'}
        </Fila>
        <Fila label="Saldo final del período" requerido={false} tono="total">
          {money(saldoFinal)}
        </Fila>
        {/* "🤖Remito Pends de Facturar" de la cuenta: entregado y todavía sin facturar. En negro, el
            tono normal de la ficha: acompaña al saldo, no lo destaca. */}
        <Fila label="Mercaderia Pend de Facturar" requerido={false}>
          {money(mercaderiaPendFacturar)}
        </Fila>
      </div>

      <hr className="rsep" />

      {/* FORMATO del archivo: obligatorio y antes del botón. Con la generación en curso queda fijo;
          cambiarlo con el resumen ya emitido descarta sus archivos y vuelve a "Emitir". */}
      <div className="res-formato">
        <label htmlFor="res-formato" className="rlabel">
          Formato<span className="rreq">*</span>
        </label>
        <select
          id="res-formato"
          className={`full res-formato-sel ${formatoEnFalta ? 'res-sel--error' : ''} ${
            resumenFormato ? '' : 'res-sel--ph'
          }`}
          aria-invalid={formatoEnFalta || undefined}
          // Se puede cambiar con el resumen emitido: sus archivos se descartan y se vuelve a emitir.
          disabled={enCurso}
          value={resumenFormato ?? ''}
          onChange={(e) =>
            dispatch({ type: 'setResumenFormato', formato: e.target.value as FormatoResumen })
          }
        >
          <option value="" disabled>
            Seleccionar...
          </option>
          {FORMATOS_RESUMEN.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>

      {/* El botón ES el estado de la generación, igual que en el recibo. Emitir no escribe en Monday
          —eso es "Registrar Resumen"—, así que un error siempre se puede reintentar. */}
      <button
        type="button"
        className={`btn-generar btn-mayus ${enCurso ? 'btn-generar--curso' : ''} ${
          fase === 'emitido' ? 'btn-generar--ok' : ''
        } ${fase === 'error' ? 'btn-generar--err' : ''}`}
        // Emitido sigue habilitado: se puede volver a emitir para corregir un error.
        disabled={enCurso}
        aria-busy={enCurso}
        title={
          enCurso
            ? undefined
            : fase === 'emitido'
              ? 'Tocá para volver a emitir con los datos actuales'
              : fase === 'error'
                ? 'Tocá para reintentar la emisión'
                : undefined
        }
        onClick={onEmitir}
      >
        {enCurso ? (
          <>
            <i className="fas fa-circle-notch fa-spin" /> Generando archivos...
          </>
        ) : fase === 'emitido' ? (
          <>
            <i className="fas fa-check" /> Resumen emitido
          </>
        ) : fase === 'error' ? (
          <>
            <i className="fas fa-xmark" /> Error de emisión
          </>
        ) : (
          <>
            <i className="far fa-file-lines" /> Emitir Resumen Cta Cte
          </>
        )}
      </button>

      {/* "Ver / Imprimir" y la descarga del Excel, siempre debajo de emitir. Los mensajes van DEBAJO
          de los botones, nunca entre ellos. */}
      {children}

      {fase === 'error' && error && (
        <div className="rec-error" role="alert">
          <p className="rec-error-estado">
            <i className="fas fa-circle-exclamation" /> {error.estado}
          </p>
          <p className="rec-error-msg">{error.mensaje}</p>
        </div>
      )}
    </div>
  )
}
