import type { ReactNode } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { money } from '@/lib/format'
import { useApp } from '@/state/hooks'
import type { Cliente, ErrorEmision, FaseEmision } from '@/types'

/**
 * Los textos que cambian entre el RECIBO de una cobranza y la ORDEN DE PAGO a un proveedor. El
 * resumen es la misma ficha en los dos —quién opera, con quién, y los dos totales que tienen que
 * coincidir—, y lo único que se diferencia es cómo se nombra cada cosa.
 *
 * "Total cancelado" NO está acá: es el número que cierra el documento en los dos circuitos y se
 * llama igual en ambos, así que no es un rótulo variable.
 */
export interface RotulosResumen {
  titulo: string
  /** Quién ejecuta la operación ("Vendedor cobrante" / "Vendedor Pagador"). */
  operador: string
  /** Con quién se opera ("Cliente razón social" / "Proveedor razón social"). */
  titular: string
  cuit: string
  fecha: string
  /** Lo que se movió de dinero ("Total recibido" / "Total Entregado"). */
  entregado: string
  /** Rótulo del botón en su estado inicial. */
  botón: string
}

/** Los rótulos del RECIBO. Rigen si no se pasa ninguno: es el circuito original. */
export const ROTULOS_RESUMEN_RECIBO: RotulosResumen = {
  titulo: 'Resumen del recibo',
  operador: 'Vendedor cobrante',
  titular: 'Cliente razón social',
  cuit: 'CUIT del Cliente',
  fecha: 'Fecha de Emisión',
  entregado: 'Total recibido',
  botón: 'Emitir el recibo',
}

/** Los rótulos de la ORDEN DE PAGO: la misma ficha con el vocabulario del egreso. */
export const ROTULOS_RESUMEN_OP: RotulosResumen = {
  titulo: 'Resumen de Orden de Pago',
  operador: 'Vendedor Pagador',
  titular: 'Proveedor razón social',
  cuit: 'CUIT del Proveedor',
  fecha: 'Fecha de PAGO',
  entregado: 'Total Entregado',
  botón: 'EMITIR ORDEN DE PAGO',
}

interface ResumenReciboProps {
  /**
   * De quién es el documento. En un recibo es el CLIENTE al que se le cobró; en una orden de pago,
   * el PROVEEDOR al que se le paga. De acá salen la razón social y el CUIT que la ficha muestra.
   */
  cliente: Pick<Cliente, 'name' | 'cuit'>
  /** Fecha del cobro, en dd/MM/yyyy: es la que lleva el recibo. */
  fechaEmision: string
  /** TOTAL RECIBIDO: lo que suman las formas de pago del recibo. */
  totalRecibido: number
  /** TOTAL CANCELADO: lo que suman las facturas que el recibo cancela. */
  totalCancelado: number
  /**
   * En qué anda la emisión. Gobierna el botón: es su ÚNICA fuente de verdad, y el botón es el
   * único lugar donde esta ficha muestra el progreso —girando con "Emitiendo…"—. El seguimiento
   * detallado del tablero se ve en la card del documento, no acá.
   */
  fase: FaseEmision
  /** Qué falló, cuando falló. */
  error: ErrorEmision | null
  /** El intento se puede repetir sin duplicar nada (no llegó a crearse el recibo). */
  puedeReintentar: boolean
  onEmitir: () => void
  /** Cómo se nombra la operación. Por defecto, la del RECIBO. */
  rotulos?: RotulosResumen
}

interface FilaProps {
  label: string
  /** Campo que viaja al recibo: se marca con asterisco. */
  requerido?: boolean
  tono?: 'verde' | 'total'
  children: ReactNode
}

function Fila({ label, requerido = true, tono, children }: FilaProps) {
  const clase = tono === 'total' ? 'rvalue--total' : tono === 'verde' ? 'rvalue--green' : ''
  return (
    <div className="rrow">
      <span className="rlabel">
        {label}
        {requerido && <span className="rreq">*</span>}
      </span>
      <span className={`rvalue ${clase}`}>{children}</span>
    </div>
  )
}

/**
 * Resumen de la cobranza antes de emitir su recibo. Es la MISMA ficha que el resumen de la venta
 * en la app de operaciones —mismos grupos, mismos rótulos, mismo botón al pie—, con los datos que
 * el recibo declara: de quién se cobró, quién cobró y los dos totales que tienen que coincidir.
 *
 * Los dos totales se muestran uno al lado del otro a propósito: el recibo sólo es válido si lo
 * entregado por el cliente iguala lo que se cancela de sus facturas, y esta ficha es el último
 * lugar donde eso se puede controlar de un vistazo.
 */
export function ResumenRecibo({
  cliente,
  fechaEmision,
  totalRecibido,
  totalCancelado,
  fase,
  error,
  puedeReintentar,
  onEmitir,
  rotulos = ROTULOS_RESUMEN_RECIBO,
}: ResumenReciboProps) {
  const { usuario } = useApp()
  /* "creando" (se escribe el recibo) y "emitiendo" (lo genera el tablero) se muestran igual: para
     el usuario es un solo momento de espera. La diferencia importa cuando algo falla, y ahí la
     dice el mensaje de error, no el botón. */
  const enCurso = fase === 'creando' || fase === 'emitiendo'

  return (
    <div className="card resumen-recibo">
      <h3 className="resumen-title">{rotulos.titulo}</h3>

      <div className="rgroup">
        <Fila label={rotulos.operador}>
          {usuario ? (
            <>
              <Avatar ini={usuario.ini} color={usuario.color} size="sm" /> {usuario.name}
            </>
          ) : (
            '--'
          )}
        </Fila>
        <Fila label={rotulos.titular}>{cliente.name}</Fila>
        <Fila label={rotulos.cuit}>{cliente.cuit || '--'}</Fila>
      </div>

      <hr className="rsep" />

      <div className="rgroup">
        <Fila label={rotulos.fecha} requerido={false}>
          {fechaEmision}
        </Fila>
        {/* Lo que se movió de dinero, sumando todas sus líneas. */}
        <Fila label={rotulos.entregado} requerido={false} tono="verde">
          {money(totalRecibido)}
        </Fila>
        {/* Lo que el recibo cancela de las facturas imputadas: el número que cierra el documento. */}
        <Fila label="Total cancelado" requerido={false} tono="total">
          {money(totalCancelado)}
        </Fila>
      </div>

      {/* El botón ES el estado de la emisión: en curso gira, emitido pasa a verde con el tilde y
          fallado pasa a rojo. Con el recibo ya creado no se vuelve a emitir —se duplicaría—, así
          que sólo se rehabilita cuando el intento no llegó a escribir nada. */}
      <button
        type="button"
        className={`btn-generar ${enCurso ? 'btn-generar--curso' : ''} ${
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
            <i className="fas fa-check" /> Emitido correctamente
          </>
        ) : fase === 'error' ? (
          <>
            <i className="fas fa-triangle-exclamation" />{' '}
            {puedeReintentar ? 'Reintentar la emisión' : 'No se pudo emitir'}
          </>
        ) : (
          <>
            <i className="far fa-file-lines" /> {rotulos.botón}
          </>
        )}
      </button>

      {/* Falló: el ESTADO arriba (la etiqueta del tablero o el momento en que se cortó) y debajo el
          mensaje concreto, que en las excepciones es el que se capturó en el `catch`. */}
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
