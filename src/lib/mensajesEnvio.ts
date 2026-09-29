import type { TipoDocumentoMake } from './envioDocumento'

/**
 * Los mensajes que acompañan al documento en el envío, uno por canal. Los arma la app —igual que en
 * la app de operaciones de venta— y viajan en cada destinatario (`destinatarios[].mensaje`), porque
 * saludan a cada contacto por su nombre. Son los textos de los módulos de Make, tal cual, con los
 * datos ya puestos: WhatsApp con el formato de WhatsApp (*negrita*) y el email en HTML, con su asunto.
 *
 * El saludo es el nombre y el apellido del contacto (en Make, `text_mm5848zg` + `text_mm58q0bx` del
 * tablero de Contactos), que es como la app arma `Contacto.name`.
 */
export interface MensajesEnvio {
  whatsapp: string
  email: MensajeEmail
}

/** El email: el cuerpo en HTML (`content`) y el asunto (`subject`), el título del encabezado. */
export interface MensajeEmail {
  content: string
  subject: string
}

/** Lo que completa los mensajes. */
export interface DatosMensaje {
  /** Razón social del titular, sin su código interno. */
  razonSocial: string
  /** Nombre y apellido del contacto: el saludo. */
  contacto: string
  /** dd/MM/yyyy, como las guarda la app. */
  fechaEmision: string
  fechaVencimiento: string | null
  /** El período del resumen de cta cte, en dd/MM/yyyy. `null` en los otros documentos. */
  periodo: { desde: string; hasta: string } | null
}

/** dd/MM/yyyy → DD-MM-YYYY, el formato de los mensajes (`formatDate(…; "DD-MM-YYYY")` en Make). */
export const fechaMensaje = (ddmmyyyy: string | null): string => (ddmmyyyy ?? '').split('/').join('-')

const PLANTILLAS: Record<TipoDocumentoMake, (d: DatosMensaje) => MensajesEnvio> = {
  RECIBO: (d) => ({
    whatsapp: [
      `👋*¡Hola ${d.contacto}!*`,
      `Te adjuntamos el *RECIBO* con 📅*Fecha de emision: ${fechaMensaje(d.fechaEmision)}*. `,
      'Cualquier consulta estamos a tu disposicion.',
      '',
      '*LA BATEA*',
    ].join('\n'),
    email: {
      content: [
        `👋 <b>¡Hola ${d.contacto}!</b><br>`,
        `Te adjuntamos el <b>recibo</b> emitido el 📅 <b>Fecha de Emisión:</b> ${fechaMensaje(d.fechaEmision)}. Cualquier duda estamos a tu disposición.<br><br>`,
        '<b>LA BATEA</b>',
      ].join('\n'),
      // En Make: formatDate(<"Creation log" del recibo>; "DD-MM-YYYY"), el día en que se emitió.
      subject: `LA BATEA - Recibo Emitido: ${fechaMensaje(d.fechaEmision)}`,
    },
  }),
  'ORDEN DE PAGO': (d) => ({
    whatsapp: [
      `👋*¡Hola ${d.contacto}!*`,
      `Te adjuntamos la *ORDEN DE PAGO* con *Fecha de emision: ${fechaMensaje(d.fechaEmision)}*. `,
      'Cualquier consulta estamos a tu disposicion.',
      '',
      '*LA BATEA*',
    ].join('\n'),
    email: {
      content: [
        `👋 <b>¡Hola ${d.contacto}!</b><br>`,
        `Te adjuntamos la <b>Orden de Pago</b> con <b>Fecha de Emisión:</b> ${fechaMensaje(d.fechaEmision)}. Cualquier duda estamos a tu disposición.<br><br>`,
        '<b>LA BATEA</b>',
      ].join('\n'),
      // En Make: formatDate(<"Fecha de Emisión" de la orden, date_mm6kzpb1>; "DD-MM-YYYY").
      subject: `LA BATEA - Orden de Pago Emitido: ${fechaMensaje(d.fechaEmision)}`,
    },
  }),
  /* El estado de cta cte viaja en el MISMO envío que el resumen y lleva el mismo mensaje. Las fechas
     del período van con barras (`formatDate(…; "DD/MM/YYYY")` en Make). */
  'RESUMEN CTA CTE': (d) => {
    const desde = d.periodo?.desde ?? ''
    const hasta = d.periodo?.hasta ?? ''
    return {
      whatsapp: [
        `👋 ¡Hola *${d.contacto}*!`,
        `Te adjuntamos el *RESUMEN DE CUENTA CORRIENTE* para el periodo ${desde} a ${hasta}. `,
        'Cualquier duda estamos a tu disposición.',
        '',
        '*LA BATEA*',
      ].join('\n'),
      email: {
        content: [
          '<div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #333333; line-height: 1.6;">',
          `    <p>👋 ¡Hola <strong>${d.contacto}</strong>!</p>`,
          '    ',
          `    <p>Te adjuntamos el <strong>RESUMEN DE CUENTA CORRIENTE</strong> para el periodo ${desde} a ${hasta}.</p>`,
          '    ',
          '    <p>Cualquier duda estamos a tu disposición.</p>',
          '    ',
          '    <p><strong>LA BATEA</strong></p>',
          '</div>',
        ].join('\n'),
        // En Make: formatDate(documento.fechaEmision; "DD-MM-YYYY"). El texto es el pedido tal cual.
        subject: `LA BATEA - Presupuesto Emitido: ${fechaMensaje(d.fechaEmision)}`,
      },
    }
  },
}

/** Los dos mensajes de un documento para un contacto. */
export const mensajesDe = (tipo: TipoDocumentoMake, datos: DatosMensaje): MensajesEnvio =>
  PLANTILLAS[tipo](datos)
