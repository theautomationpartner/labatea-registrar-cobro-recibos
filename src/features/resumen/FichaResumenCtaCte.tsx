import { Avatar } from '@/components/ui/Avatar'
import { Fila } from '@/features/recibo/ResumenRecibo'
import { money } from '@/lib/format'
import { FORMATOS_RESUMEN, OPCIONES_ESTADO_CTA_CTE } from '@/lib/resumenCtaCte'
import { avisoDocumentosFallidos } from '@/services/monday/resumenCtaCte'
import { useApp, useDispatch } from '@/state/hooks'
import type { Cliente, DocumentosEmision, ErrorEmision, FaseEmision, FormatoResumen } from '@/types'
import { VerPdfResumen } from './VerPdfResumen'

interface FichaResumenCtaCteProps {
  cliente: Pick<Cliente, 'name' | 'cuit'>
  /** El ítem de la cuenta corriente: de ahí se baja el PDF emitido. */
  ctaCteId: string | null
  /** El período elegido en el paso 1, ya nombrado (ver `rotuloCriterio`). Vacío = sin período. */
  rotuloPeriodo: string
  /** Con qué saldo termina la cuenta en el período: el del último movimiento. */
  saldoFinal: number
  /** "🤖Remito Pends de Facturar" de la cuenta corriente (numeric_mm5f2npa). */
  mercaderiaPendFacturar: number
  fase: FaseEmision
  error: ErrorEmision | null
  /** Cómo salió cada documento, cuando el escenario lo informó. */
  documentos: DocumentosEmision | null
  puedeReintentar: boolean
  /** Se intentó emitir sin formato: el selector queda en rojo hasta que se elija uno. */
  marcarFormato: boolean
  onEmitir: () => void
}

/**
 * Resumen de la operación antes de emitir: quién la emite, de qué cliente, qué período abarca y en
 * qué formato sale el archivo. Es la MISMA ficha que la del recibo y la orden de pago —mismos grupos,
 * mismos renglones, mismo botón al pie—, con el campo "Formato" justo antes del botón: es lo último
 * que se decide, y es obligatorio.
 */
export function FichaResumenCtaCte({
  cliente,
  ctaCteId,
  rotuloPeriodo,
  saldoFinal,
  mercaderiaPendFacturar,
  fase,
  error,
  documentos,
  puedeReintentar,
  marcarFormato,
  onEmitir,
}: FichaResumenCtaCteProps) {
  const { usuario, resumenEstadoCtaCte, resumenFormato } = useApp()
  const dispatch = useDispatch()
  const enCurso = fase === 'creando' || fase === 'emitiendo'
  const formatoEnFalta = marcarFormato && !resumenFormato
  /* Emitido A MEDIAS: la emisión cerró bien —salió al menos un documento— pero otro no. El botón
     sigue verde, y lo que faltó se avisa debajo. */
  const fallidos =
    fase === 'emitido' && documentos
      ? (['resumen', 'estado'] as const).filter((d) => documentos[d] === 'error')
      : []
  const parcial = fallidos.length > 0

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

      {/* FORMATO del archivo: obligatorio y antes del botón. Con la generación en curso o ya emitida
          queda fijo: el archivo es del formato que se pidió. */}
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
          disabled={enCurso || fase === 'emitido'}
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

      {/* El botón ES el estado de la generación, igual que en el recibo. Un error se puede reintentar:
          pedir de nuevo el resumen no duplica nada en el tablero. */}
      <button
        type="button"
        className={`btn-generar btn-mayus ${enCurso ? 'btn-generar--curso' : ''} ${
          fase === 'emitido' ? 'btn-generar--ok' : ''
        } ${fase === 'error' ? 'btn-generar--err' : ''}`}
        disabled={enCurso || fase === 'emitido' || (fase === 'error' && !puedeReintentar)}
        aria-busy={enCurso}
        onClick={onEmitir}
      >
        {enCurso ? (
          <>
            <i className="fas fa-circle-notch fa-spin" /> Emitiendo...
          </>
        ) : fase === 'emitido' ? (
          <>
            <i className="fas fa-check" /> {parcial ? 'Parcialmente emitido' : 'Resumen emitido'}
          </>
        ) : fase === 'error' ? (
          /* Sigue siendo el botón de reintentar —pedir de nuevo no duplica nada—, pero lo que dice es
             lo que pasó. */
          <span title={puedeReintentar ? 'Volver a intentar la emisión' : undefined}>
            <i className="fas fa-triangle-exclamation" /> Error en emisión
          </span>
        ) : (
          <>
            <i className="far fa-file-lines" /> Emitir Resumen Cta Cte
          </>
        )}
      </button>

      {/* Sólo el mensaje: el botón ya dice "Error en emisión", y repetirlo como subtítulo no agrega
          nada. */}
      {fase === 'error' && error && (
        <div className="rec-error" role="alert">
          <p className="rec-error-msg">{error.mensaje}</p>
          {error.detalle && <p className="rec-error-detalle">{error.detalle}</p>}
        </div>
      )}

      {parcial && (
        <div className="rec-aviso" role="status">
          <i className="fas fa-triangle-exclamation" /> {avisoDocumentosFallidos(fallidos)}
        </div>
      )}

      {/* Con el resumen emitido, el PDF de cada documento que salió, para verlo e imprimirlo sin ir a
          buscarlo a Drive. */}
      {fase === 'emitido' && (
        <VerPdfResumen ctaCteId={ctaCteId} formato={resumenFormato} documentos={documentos} />
      )}
    </div>
  )
}
