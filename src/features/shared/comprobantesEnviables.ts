/**
 * Catálogo de comprobantes ENVIABLES. Es el punto de extensión del envío: cada comprobante describe,
 * en un objeto, todo lo que lo distingue de los demás. Es el mismo catálogo que el de la app de
 * operaciones de venta.
 *
 * Los tres documentos de esta app —el recibo, la orden de pago y el resumen de cta cte— se envían
 * IGUAL que el presupuesto y el remito de la app de ventas: el PDF lo genera la app al emitir y se lo
 * manda, junto con los datos del envío, al escenario de Make (`MAKE_WEBHOOK_ENVIOS_URL`), ANTES de
 * que el documento exista en el tablero. El escenario contesta contacto por contacto qué salió.
 *
 * El componente no sabe qué comprobante está enviando: le pregunta al adaptador si ya se emitió, qué
 * se manda y a quién.
 */
import {
  armarEnvioDocumento,
  canalesPedidos,
  detalleFallas,
  evaluarEnvio,
  fallidosDe,
  mensajeParcial,
  tituloError,
  type EnviadosPorContacto,
  type ResultadoEntrega,
  type TipoDocumentoMake,
} from '@/lib/envioDocumento'
import { desdeIso } from '@/lib/dates'
import { enviarDocumentoMake, nuevoJobId } from '@/services/make'
import { mondayHabilitado } from '@/services/monday'
import { confirmarWhatsapp } from '@/services/whatsapp/estadoMensaje'
import type { AppState } from '@/state/appState'
import type { Cliente, MedioEnvio } from '@/types'

/** Cómo terminó el intento de envío. Cada motivo lo comunica el componente a su manera. */
export type ResultadoEnvio =
  /** Salió: el escenario confirmó cada envío. `enviados`: qué le llegó a cada contacto. */
  | { estado: 'ok'; enviados?: EnviadosPorContacto }
  /**
   * Algo salió y algo no: un canal entero, o un canal para algunos contactos. El botón queda en
   * amarillo y habilitado: reintentar pide sólo lo que faltó.
   */
  | {
      estado: 'parcial'
      enviados: EnviadosPorContacto
      mensaje: string
      /** Contactos a los que no les llegó (pulseId → motivo): la cruz roja de su fila. */
      fallidos: Record<string, string>
    }
  /** El documento todavía no se emitió. No es un fallo: hay que emitirlo y reintentar. */
  | { estado: 'sin-documento' }
  /**
   * El envío falló. Con `mensaje`, el motivo ya viene redactado para el usuario —lo manda el escenario
   * de Make o lo arma la app— y se muestra tal cual al lado del botón.
   */
  | {
      estado: 'error-envio'
      mensaje?: string
      titulo?: string
      /** Contactos a los que no les llegó. */
      fallidos?: Record<string, string>
    }

/** Lo que se le manda al escenario: qué documento es, con qué número y fecha, y sus archivos. */
export interface DocumentoAEnviar {
  tipo: TipoDocumentoMake
  numero: string
  /** dd/MM/yyyy. */
  fechaEmision: string
  /** En orden: el primero es el principal. */
  archivos: File[]
  /** Sólo el resumen de cta cte: su período, en dd/MM/yyyy (lo nombra el mensaje). */
  periodo?: { desde: string; hasta: string }
}

/** Lo que el envío necesita saber para despachar UN comprobante. */
export interface ComprobanteEnviable {
  /** Clave del catálogo. Es lo que la vista pasa por prop. */
  id: string
  /** Cómo se lo nombra en los textos ("el recibo", "la orden de pago"). */
  articulo: 'el' | 'la'
  /** Nombre en minúscula, tal como aparece en los mensajes. */
  nombre: string
  /** El nombre en plural, para decir que un contacto no acepta recibirlos ("órdenes de pago"). */
  nombrePlural: string
  /**
   * Texto con el que el contacto declara que acepta este comprobante, en su columna "Para Enviar"
   * del tablero de Contactos. Se compara normalizado (sin tildes ni mayúsculas) y por inclusión.
   * Sin valor se usa `nombre`.
   */
  etiquetaContacto?: string
  /** El comprobante ya se emitió en la app y por lo tanto se puede enviar. */
  emitido: (state: AppState) => boolean
  /** Qué se manda. `null` = todavía no se emitió. */
  documento: (state: AppState) => DocumentoAEnviar | null
  /** El envío se frena si el cliente está bloqueado o con su línea de crédito agotada. */
  frenaPorCredito: boolean
  /**
   * De QUIÉN son los contactos a los que se le manda. En un recibo es el CLIENTE de la operación;
   * en una orden de pago, el PROVEEDOR. Los dos salen del mismo board de Personas y cuelgan de la
   * misma columna conectada, así que la consulta es una sola: lo único que cambia es de qué ítem.
   *
   * `null` = todavía no hay con quién operar, y por lo tanto no hay contactos que traer.
   */
  titular: (state: AppState) => Cliente | null
  /**
   * El envío exige AL MENOS UN contacto que acepte este comprobante, y no sólo que el titular tenga
   * contactos cargados. Sin uno que la admita, la función de envío queda inhabilitada por completo.
   */
  exigeContactoQueAcepta?: boolean
  /**
   * Cómo se elige el medio:
   *
   *   · `selector`         · el desplegable Email / WhatsApp / Ambos. Es el de siempre.
   *   · `emailConWhatsapp` · el de la FACTURA en la app de operaciones de venta: el Email va SIEMPRE
   *                          y WhatsApp se suma con un check. Tildarlo es "Ambos".
   *
   * Sin valor, `selector`.
   */
  modoEnvio?: 'selector' | 'emailConWhatsapp'
  /** Qué se dice cuando NO hay a quién enviarle. Recibe el nombre del titular. */
  sinContactos: {
    titulo: string
    mensaje: (titular: string) => string
  }
  /** Ventana que se muestra al querer enviar sin haber emitido. */
  avisoNoEmitido: { titulo: string; texto: string }
}

/* ===== Los comprobantes que hoy se envían ===== */

const RECIBO: ComprobanteEnviable = {
  id: 'recibo',
  articulo: 'el',
  nombre: 'recibo',
  nombrePlural: 'recibos',
  // Emitido = el PDF ya se generó en la app.
  /* Mientras se está (re)emitiendo, el documento todavía no existe: el que hay está por perderse. */
  emitido: (s) => s.reciboDoc !== null && s.emision.fase !== 'creando',
  documento: (s) =>
    s.reciboDoc && {
      tipo: 'RECIBO',
      numero: s.reciboDoc.numero,
      fechaEmision: s.reciboDoc.fechaEmision,
      archivos: [s.reciboDoc.pdf],
    },
  // El recibo es una salida del sistema: no sale nada de un cliente bloqueado o excedido.
  frenaPorCredito: true,
  titular: (s) => s.cliente,
  sinContactos: {
    titulo: 'No tiene contactos asignados',
    mensaje: (titular) =>
      `${titular} no tiene contactos cargados en el tablero de Contactos, así que no es posible realizar el envío. Asignale al menos un contacto y volvé a reintentar.`,
  },
  avisoNoEmitido: {
    titulo: 'Primero generá el recibo PDF',
    texto:
      'Todavía no se generó el PDF del recibo, así que no hay nada que enviar. Tocá "Emitir el recibo" y, cuando esté listo, volvé a enviar.',
  },
}

/**
 * ORDEN DE PAGO. Dos diferencias de fondo con el recibo:
 *
 *   · NO frena por crédito. El límite de crédito es lo que NOSOTROS le damos a un cliente; a un
 *     proveedor no se le asigna ninguno, y mirarlo acá frenaría pagos por una línea que no existe.
 *   · EXIGE un contacto que acepte la orden. Sin ninguno, el envío queda inhabilitado por completo.
 */
const ORDEN_PAGO: ComprobanteEnviable = {
  id: 'ordenPago',
  articulo: 'la',
  nombre: 'orden de pago',
  nombrePlural: 'órdenes de pago',
  /* Con este texto el contacto declara, en su "✋Para Enviar", que acepta recibir órdenes de pago. */
  etiquetaContacto: 'Orden de Pago',
  emitido: (s) => s.ordenPagoDoc !== null && s.emisionOP.fase !== 'creando',
  documento: (s) =>
    s.ordenPagoDoc && {
      tipo: 'ORDEN DE PAGO',
      numero: s.ordenPagoDoc.numero,
      fechaEmision: s.ordenPagoDoc.fechaEmision,
      // La constancia de retención, si la orden practicó una, viaja con ella.
      archivos: s.ordenPagoDoc.constancia
        ? [s.ordenPagoDoc.pdf, s.ordenPagoDoc.constancia.pdf]
        : [s.ordenPagoDoc.pdf],
    },
  frenaPorCredito: false,
  titular: (s) => s.proveedor,
  exigeContactoQueAcepta: true,
  sinContactos: {
    titulo: 'No hay contactos que acepten recibir la orden de pago',
    mensaje: (titular) =>
      `${titular} NO tiene ningun contacto asignado al cual se le pueda enviar orden de pago o retencion, por ende NO es posible realizar el envio. Para la proxima revisa y asigna contactos al proveedor.`,
  },
  avisoNoEmitido: {
    titulo: 'Primero generá la orden de pago PDF',
    texto:
      'Todavía no se generó el PDF de la orden de pago, así que no hay nada que enviar. Tocá "Emitir orden de pago" y, cuando esté lista, volvé a enviar.',
  },
}

/**
 * RESUMEN DE CTA CTE. Se envía como la FACTURA de la app de operaciones de venta: Email siempre y
 * WhatsApp opcional (ver `modoEnvio`). Viajan TODOS sus archivos: el resumen y, si se incluyó, el
 * estado de cuenta, en PDF y/o Excel.
 *
 * Sólo se ofrecen los contactos que declaran "Resumen Cta Cte" en su "✋Para Enviar": un resumen de
 * cuenta es información sensible, y sumar a mano a alguien que no lo declaró no es una decisión que
 * corresponda tomar desde acá.
 *
 * NO frena por crédito: a un cliente bloqueado o excedido es justamente a quien más sentido tiene
 * mandarle el estado de su cuenta.
 */
const RESUMEN_CTA_CTE: ComprobanteEnviable = {
  id: 'resumenCtaCte',
  articulo: 'el',
  nombre: 'resumen de cuenta corriente',
  nombrePlural: 'resúmenes de cuenta corriente',
  etiquetaContacto: 'Resumen Cta Cte',
  emitido: (s) => s.resumenDoc !== null && s.emisionResumen.fase !== 'creando',
  documento: (s) =>
    s.resumenDoc && {
      tipo: 'RESUMEN CTA CTE',
      numero: s.resumenDoc.numero,
      fechaEmision: s.resumenDoc.fechaEmision,
      archivos: s.resumenDoc.archivos.map((a) => a.archivo),
      periodo: {
        desde: desdeIso(s.resumenDoc.datos.periodo.desde),
        hasta: desdeIso(s.resumenDoc.datos.periodo.hasta),
      },
    },
  frenaPorCredito: false,
  titular: (s) => s.cliente,
  exigeContactoQueAcepta: true,
  modoEnvio: 'emailConWhatsapp',
  sinContactos: {
    titulo: 'No hay contactos que acepten recibir el resumen de cuenta corriente',
    mensaje: (titular) =>
      `${titular} NO tiene ningún contacto con "Resumen Cta Cte" asignado en "Para Enviar", así que no es posible realizar el envío. Asignáselo a al menos un contacto en el tablero de Contactos y volvé a reintentar.`,
  },
  avisoNoEmitido: {
    titulo: 'Primero generá el resumen de cuenta corriente',
    texto:
      'Todavía no se generaron los archivos del resumen, así que no hay nada que enviar. Tocá "Emitir Resumen Cta Cte" y, cuando esté listo, volvé a enviar.',
  },
}

const CATALOGO: Record<string, ComprobanteEnviable> = {
  [RECIBO.id]: RECIBO,
  [ORDEN_PAGO.id]: ORDEN_PAGO,
  [RESUMEN_CTA_CTE.id]: RESUMEN_CTA_CTE,
}

/**
 * Comprobante del catálogo. Una clave desconocida es un error de programación —la vista pasó algo
 * que no existe—, así que se corta ahí en vez de enviar cualquier cosa.
 */
export function comprobanteEnviable(id: string): ComprobanteEnviable {
  const comprobante = CATALOGO[id]
  if (!comprobante) throw new Error(`No hay un comprobante enviable con la clave "${id}"`)
  return comprobante
}

/** "El recibo", "La orden de pago": cómo abre una oración que nombra al comprobante. */
const conArticulo = (c: ComprobanteEnviable): string =>
  `${c.articulo === 'la' ? 'La' : 'El'} ${c.nombre}`

/**
 * Envía un comprobante emitido por el escenario de Make: arma el pedido (sólo lo que le falta a cada
 * contacto), lo manda, confirma cada WhatsApp contra 360Messenger y evalúa contacto por contacto. Es
 * el `enviarPorMake` de la app de operaciones de venta.
 *
 * Un `throw` acá es un rechazo de seguridad o un fallo inesperado: lo comunica el componente.
 */
export async function enviarComprobante(
  comprobante: ComprobanteEnviable,
  state: AppState,
  medio: MedioEnvio,
): Promise<ResultadoEnvio> {
  const doc = comprobante.documento(state)
  const titular = comprobante.titular(state)
  if (!doc || !titular) return { estado: 'sin-documento' }

  const datos = armarEnvioDocumento({
    jobId: nuevoJobId(),
    tipo: doc.tipo,
    numero: doc.numero,
    fechaEmision: doc.fechaEmision,
    // Ninguno de los tres documentos vence.
    fechaVencimiento: null,
    archivos: doc.archivos.map((a) => a.name),
    periodo: doc.periodo ?? null,
    cliente: titular,
    vendedor: state.usuario,
    medio,
    contactos: state.contactos,
    // Tras un envío parcial, lo que ya le llegó a cada contacto no se vuelve a pedir.
    yaEnviados: state.enviadosPorContacto,
  })
  // Ya le llegó a cada uno todo lo que pide el medio actual: no hay nada que mandar.
  if (canalesPedidos(datos).length === 0) return { estado: 'ok', enviados: state.enviadosPorContacto }

  /* Modo local (sin cuenta de Monday): no hay escenario al que mandarle nada. Se simula que salió
     todo lo pedido, igual que el resto de la capa de servicio: el prototipo se recorre entero. */
  if (!mondayHabilitado()) {
    await new Promise((r) => setTimeout(r, 800))
    const enviados: EnviadosPorContacto = { ...state.enviadosPorContacto }
    for (const d of datos.destinatarios) enviados[d.pulseId] = [...new Set([...(enviados[d.pulseId] ?? []), ...d.canales])]
    return { estado: 'ok', enviados }
  }

  const respuesta = await enviarDocumentoMake(datos, doc.archivos)
  /* No se sabe qué pasó del otro lado: a nadie de este pedido se lo da por enviado, y todos llevan
     la cruz con el motivo. */
  if (respuesta.tipo === 'fallo') {
    return {
      estado: 'error-envio',
      mensaje: respuesta.mensaje,
      fallidos: Object.fromEntries(datos.destinatarios.map((d) => [d.pulseId, respuesta.mensaje])),
    }
  }

  /* El escenario corrió pero su respuesta no dice qué salió: no se lo da por enviado ni por fallado.
     Se dice eso, para que se revise antes de reintentar (reintentar podría mandarlo dos veces). */
  if (respuesta.ilegible) {
    return {
      estado: 'error-envio',
      titulo: 'No se pudo confirmar el envío',
      mensaje:
        'El servicio de envío respondió, pero sin decir qué salió. Revisá si el documento les llegó a los contactos antes de reintentar: reintentar podría enviarlo dos veces.',
    }
  }

  /* Un 200 no alcanza: cuenta cada ítem de `enviosEmail` / `enviosWhatsapp`. Y que Make diga que
     mandó un WhatsApp tampoco: cada uno se confirma contra 360Messenger. */
  const resultados = {
    email: respuesta.resultados.email,
    whatsapp: await verificarWhatsapps(respuesta.resultados.whatsapp),
  }
  const evaluacion = evaluarEnvio(datos, resultados, state.enviadosPorContacto)
  if (evaluacion.estado === 'ok') return { estado: 'ok', enviados: evaluacion.enviados }
  if (evaluacion.estado === 'parcial') {
    return {
      estado: 'parcial',
      enviados: evaluacion.enviados,
      mensaje: mensajeParcial(evaluacion.fallas, evaluacion.enviados, respuesta.mensaje, conArticulo(comprobante)),
      fallidos: fallidosDe(evaluacion.fallas),
    }
  }
  return {
    estado: 'error-envio',
    titulo: tituloError(evaluacion.fallas),
    fallidos: fallidosDe(evaluacion.fallas),
    mensaje:
      respuesta.mensaje ||
      (evaluacion.fallas.some((f) => f.motivo)
        ? `No llegó: ${detalleFallas(evaluacion.fallas)}.`
        : 'El servicio no confirmó el envío. Probá de nuevo en unos minutos.'),
  }
}

/**
 * Confirma contra 360Messenger cada WhatsApp que Make dio por enviado: el mensaje de TEXTO y cada
 * DOCUMENTO, que salen como mensajes separados y cada uno con su id. Se consultan todos a la vez, con
 * el mismo endpoint (`GET /v2/message/status?id=…`).
 *
 * Un WhatsApp cuenta como enviado SÓLO si 360Messenger confirma TODOS sus mensajes: que llegue el
 * texto sin el documento no es haber enviado el documento. Si alguno falló, o no se puede confirmar
 * (sin id, sin la key, 360Messenger caído, o sigue en cola al terminar la espera), ese envío queda
 * como no enviado —y el total, según el caso, en error o parcial— con un motivo que dice qué parte.
 */
export async function verificarWhatsapps(
  items: readonly ResultadoEntrega[],
  /** Cada cuánto y cuántas veces se pregunta mientras siga en cola (ver `confirmarWhatsapp`). */
  espera?: { intentos?: number; intervalo?: number },
): Promise<ResultadoEntrega[]> {
  return Promise.all(
    items.map(async (item): Promise<ResultadoEntrega> => {
      if (!item.ok) return item
      const w = item.whatsapp
      if (!w?.texto || (w.exigeDocumentos && w.documentos.length === 0)) {
        console.warn('Make confirmó un WhatsApp sin los ids de sus mensajes: no se puede verificar en 360Messenger.')
        return { ...item, ok: false, motivo: 'no se pudo confirmar el envío en 360Messenger' }
      }
      const mensajes = [
        { id: w.texto, que: 'el mensaje' },
        ...w.documentos.map((id, i) => ({
          id,
          que: w.documentos.length > 1 ? `el documento ${i + 1}` : 'el documento',
        })),
      ]
      const confirmaciones = await Promise.all(mensajes.map((m) => confirmarWhatsapp(m.id, espera)))
      const conEstado = mensajes.map((m, i) => ({ ...m, c: confirmaciones[i] }))
      if (conEstado.every((m) => m.c.estado === 'enviado')) return item

      /* Qué parte no salió, en el orden en que importa: lo que FALLÓ primero, después lo que no se
         pudo confirmar. Si el texto salió y el documento no, se dice así. */
      const textoSalio = conEstado[0].c.estado === 'enviado'
      const parte = (m: (typeof conEstado)[number]) => (textoSalio && m.que !== 'el mensaje' ? `salió el mensaje, pero no ${m.que}` : '')
      const fallido = conEstado.find((m) => m.c.estado === 'fallido')
      if (fallido && fallido.c.estado === 'fallido') {
        return { ...item, ok: false, motivo: [parte(fallido), fallido.c.motivo].filter(Boolean).join(': ') }
      }
      /* Sin confirmar no es lo mismo que fallido: el mensaje puede salir igual un rato después. El
         motivo lo dice, para que se revise antes de reintentar y no se mande dos veces. */
      const pendiente = conEstado.find((m) => m.c.estado !== 'enviado')!
      console.warn(
        `WhatsApp ${pendiente.id} (${pendiente.que}) sin confirmar en 360Messenger (${
          pendiente.c.estado === 'sin-verificar' ? pendiente.c.motivo : 'sigue en cola'
        }).`,
      )
      return {
        ...item,
        ok: false,
        motivo:
          pendiente.c.estado === 'pendiente'
            ? 'WhatsApp todavía no confirmó la entrega; revisá en unos minutos si llegó antes de reintentar'
            : 'no se pudo confirmar el envío en 360Messenger',
      }
    }),
  )
}
