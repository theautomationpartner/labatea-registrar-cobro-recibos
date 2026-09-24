/**
 * Catálogo de documentos EMISIBLES. Es el punto de extensión de la emisión, con la misma forma que
 * `comprobantesEnviables` tiene para el envío: cada documento describe, en un objeto, todo lo que lo
 * distingue de los demás.
 *
 * Existe porque emitir un RECIBO y emitir una ORDEN DE PAGO son el mismo trabajo con otros datos:
 * escribir el ítem con sus subelementos, pedirle la emisión al tablero y sondear la misma columna
 * hasta que la automatización la cierre. Lo delicado de ese ciclo —el cerrojo contra el doble
 * click, el sondeo con su límite y sus reintentos, la fase persistida que sobrevive a la
 * navegación— vive UNA sola vez, en `useEmision`; acá viven las diferencias.
 *
 * Sin esto, la segunda emisión habría sido una copia de doscientas líneas del hook, y el día que se
 * corrija un caso de borde en una, la otra queda atrás.
 */
import {
  crearOrdenDePago,
  emitirRecibo,
  escribirDatosResumen,
  getEstadoEmision,
  getEstadoEmisionOP,
  emitirResumenPorApp,
  getEstadoResumenCtaCte,
  ordenPagoCompleta,
  pedirEmision,
  pedirEmisionOP,
  reciboCompleto,
  type DatosOrdenPago,
  type DatosRecibo,
} from '@/services/monday'
import type { Action, AppState } from '@/state/appState'
import type { DocumentosEmision, EmisionRecibo, FormatoResumen } from '@/types'

/**
 * Cuántos subelementos entraron de cada tipo, contra los que se esperaban. Los dos documentos lo
 * reportan igual —lo que CANCELAN y con qué se lo CUBRE—, así que el hook cuenta una sola vez.
 */
export interface ResultadoEmision {
  id: string
  facturasCreadas: number
  facturasEsperadas: number
  pagosCreados: number
  pagosEsperados: number
}

/** En qué anda la emisión según el tablero, ya traducido a lo que le importa a quien espera. */
export interface EstadoDeTablero {
  fase: 'en-curso' | 'emitido' | 'error'
  /** Etiqueta tal cual la muestra el tablero: la pantalla dice exactamente lo mismo que el board. */
  label: string
  /** Cómo salió cada documento, cuando la emisión los informa por separado (el resumen). */
  documentos?: DocumentosEmision
  /** Qué decirle al usuario si cerró en error, cuando quien emite lo dijo. */
  mensaje?: string
  /** Un detalle técnico, informativo, que acompaña al mensaje. */
  detalle?: string
}

/** Todo lo que la emisión necesita saber para escribir y seguir UN documento. */
export interface Emisible<D> {
  /** Cómo se lo nombra en los mensajes de error ("el recibo", "la orden de pago"). */
  nombre: string
  /** Id del ítem ya creado en el tablero, o `null` si todavía no se emitió. */
  itemId: (state: AppState) => string | null
  /** Acción que guarda ese id apenas existe. De ahí lo saca el envío. */
  guardarId: (id: string) => Action
  /** Dónde vive el estado de ESTA emisión dentro del estado global. */
  emision: (state: AppState) => EmisionRecibo
  /** Acción que lo parchea. Llega como parche porque cada transición mueve sólo lo que cambió. */
  parchear: (emision: Partial<EmisionRecibo>) => Action
  /** Escribe el documento y sus subelementos. Un `throw` acá corta la emisión. */
  crear: (datos: D) => Promise<ResultadoEmision>
  /**
   * Le pide al tablero que lo emita. Es el disparador de la automatización. Si quien emite contesta
   * recién al terminar —el escenario de Make del resumen—, devuelve ese cierre y no hay sondeo.
   */
  pedirEmision: (itemId: string, datos: D) => Promise<EstadoDeTablero | null | void>
  /** Lee la columna de estado. Es la consulta que se repite mientras se espera. */
  getEstado: (itemId: string) => Promise<EstadoDeTablero>
  /** El documento quedó completo: entraron TODOS sus subelementos. */
  completo: (resultado: ResultadoEmision) => boolean
  /**
   * Qué líneas faltaron, nombradas como las nombra ESTE documento. Es lo que se le muestra al
   * usuario cuando la escritura entró a medias y por eso NO se pide la emisión.
   */
  faltantes: (datos: D, resultado: ResultadoEmision) => string[]
  /** Qué se dice cuando el documento quedó incompleto. Nombra el documento y qué hacer. */
  mensajeIncompleto: string
  /**
   * Se puede volver a pedir la emisión aunque el tablero la haya cerrado en ERROR. Sólo lo declara un
   * documento cuya escritura NO crea un ítem —el resumen escribe sobre la cuenta que ya existe—, así
   * que reintentar no duplica nada. Un recibo o una orden NO: su ítem ya está creado.
   */
  reemitibleTrasError?: boolean
  /**
   * Qué se dice cuando la espera vence sin que el tablero cierre. Por defecto nombra el ítem ya
   * creado, que es el caso del recibo y la orden.
   */
  avisoSinTerminar?: string
}

/* ===== Los documentos que hoy se emiten ===== */

export const RECIBO_EMISIBLE: Emisible<DatosRecibo> = {
  nombre: 'el recibo',
  itemId: (s) => s.reciboId,
  guardarId: (id) => ({ type: 'setReciboId', id }),
  emision: (s) => s.emision,
  parchear: (emision) => ({ type: 'setEmision', emision }),
  crear: emitirRecibo,
  pedirEmision,
  getEstado: getEstadoEmision,
  completo: reciboCompleto,
  faltantes: (datos, r) =>
    [
      r.facturasCreadas < r.facturasEsperadas &&
        `${datos.tipo === 'anticipo' ? 'Línea del anticipo' : 'Facturas canceladas'}: entraron ${r.facturasCreadas} de ${r.facturasEsperadas}`,
      r.pagosCreados < r.pagosEsperados &&
        `Formas de pago y ajustes: entraron ${r.pagosCreados} de ${r.pagosEsperados}`,
    ].filter((x): x is string => typeof x === 'string'),
  mensajeIncompleto:
    'No se pidió la emisión: al recibo le faltan subelementos y el PDF saldría sin ellos. Completalo en Monday y emitilo desde el tablero.',
}

export const ORDEN_PAGO_EMISIBLE: Emisible<DatosOrdenPago> = {
  nombre: 'la orden de pago',
  itemId: (s) => s.ordenPagoId,
  guardarId: (id) => ({ type: 'setOrdenPagoId', id }),
  emision: (s) => s.emisionOP,
  parchear: (emision) => ({ type: 'setEmisionOP', emision }),
  crear: crearOrdenDePago,
  pedirEmision: pedirEmisionOP,
  getEstado: getEstadoEmisionOP,
  completo: ordenPagoCompleta,
  faltantes: (_datos, r) =>
    [
      r.facturasCreadas < r.facturasEsperadas &&
        `Facturas de compra canceladas: entraron ${r.facturasCreadas} de ${r.facturasEsperadas}`,
      r.pagosCreados < r.pagosEsperados &&
        `Cajas entregadas: entraron ${r.pagosCreados} de ${r.pagosEsperados}`,
    ].filter((x): x is string => typeof x === 'string'),
  mensajeIncompleto:
    'No se pidió la emisión: a la orden de pago le faltan subelementos y el documento saldría sin ellos. Completala en Monday y emitila desde el tablero.',
}

/** Lo que la generación del resumen necesita: sobre qué cuenta, en qué formato y de qué período. */
export interface DatosResumenCtaCte {
  ctaCteId: string
  formato: FormatoResumen
  /** Las dos puntas del período del resumen, en ISO (yyyy-MM-dd). */
  periodo: { desde: string; hasta: string }
  /** En el paso 1 se eligió INCLUIR el estado de la cuenta corriente. */
  incluyeEstado: boolean
}

/**
 * RESUMEN DE CTA CTE. A diferencia de los otros dos, NO crea un ítem: el resumen se pide sobre la
 * cuenta corriente del cliente, que ya existe. Por eso "crear" es sólo dejar escrito el formato, no
 * hay subelementos que puedan faltar, y un error del tablero se puede reintentar sin duplicar nada.
 *
 * Y es el único que se le pide DIRECTO al escenario de Make, sin pasar por la columna del tablero:
 * la app espera la respuesta del escenario, que dice qué documento salió y cuál no (ver
 * `interpretarRespuestaResumen`). Por eso cada card tiene su propio check o su cruz.
 */
export const RESUMEN_CTA_CTE_EMISIBLE: Emisible<DatosResumenCtaCte> = {
  nombre: 'el resumen de cuenta corriente',
  itemId: (s) => s.resumenCtaCteId,
  guardarId: (id) => ({ type: 'setResumenCtaCteId', id }),
  emision: (s) => s.emisionResumen,
  parchear: (emision) => ({ type: 'setEmisionResumen', emision }),
  /* "Crear" es dejar escritos el formato, el período (🤖Fecha Desde / 🤖Fecha Hasta) y si incluye el
     estado de la cuenta (🤖Incluye Estado Cta Cte). */
  crear: async ({ ctaCteId, formato, periodo, incluyeEstado }) => {
    await escribirDatosResumen(ctaCteId, formato, periodo, incluyeEstado)
    return { id: ctaCteId, facturasCreadas: 0, facturasEsperadas: 0, pagosCreados: 0, pagosEsperados: 0 }
  },
  pedirEmision: (ctaCteId, { formato, incluyeEstado }) =>
    emitirResumenPorApp(ctaCteId, formato, incluyeEstado),
  /* Sólo se sondea en desarrollo, donde no hay funciones serverless y el pedido va por la columna. */
  getEstado: getEstadoResumenCtaCte,
  completo: () => true,
  faltantes: () => [],
  mensajeIncompleto: '',
  reemitibleTrasError: true,
  avisoSinTerminar:
    'La generación del resumen no terminó dentro del tiempo de espera. Revisá el estado en la cuenta corriente del cliente en Monday antes de volver a intentarlo.',
}
