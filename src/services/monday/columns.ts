/**
 * IDs de tableros y columnas de Monday (cuenta de La Batea). Son los MISMOS que usa la app de
 * operaciones de venta: los tableros son compartidos, así que un id acá tiene que coincidir con
 * el de allá. Todo lo que la app lee o escribe pasa por este archivo; ningún id se escribe suelto
 * en un servicio.
 */

import type { FormaPago, FormatoCheque } from '@/types'

/**
 * Valor de una columna `people` de Monday. Se arma con el id numérico del usuario; con un id que no
 * sirve devuelve `null`, para poder OMITIR la columna en vez de mandarla vacía.
 */
export const personCol = (
  id: string | number | null | undefined,
): { personsAndTeams: { id: number; kind: 'person' }[] } | null => {
  const n = Number(id)
  return Number.isFinite(n) && n > 0 ? { personsAndTeams: [{ id: n, kind: 'person' }] } : null
}

export const BOARDS = {
  /** "Personas": clientes, con su Cta Cte conectada. */
  personas: 18420688238,
  /** "➡️Recibos y Cobros": cabecera del cobro/recibo. */
  cobros: 18421035524,
  /** Subelementos del recibo: un movimiento de pago cada uno. */
  cobrosSub: 18421035599,
  /** "💰Fact Vtas Pends de Cobro": las ventas pendientes de cobro del cliente. */
  factPendientes: 18421035508,
  /** "💳Ctas Bancarias Personas": las cuentas desde las que el cliente transfiere. */
  ctasBancarias: 18421723667,
  /** "📈Ventas": la venta cerrada. */
  ventas: 18421035510,
  config: 18421035530,
} as const

export const SITUACION_CLIENTE_INDEX = {
  liberadoConCredito: 0,
  liberadoSinCredito: 1,
  bloqueado: 2,
} as const

/**
 * Índice de "Activo" en "✋️Estado de Persona" (color_mm588vd6). Se compara contra ESTE índice, no
 * contra el texto: una persona sólo es operable si está explícitamente activa, así una etiqueta
 * nueva del board ("Suspendido", "Dado de baja") no entra como activa sin que nadie lo decida.
 */
export const CLIENTE_ACTIVO_INDEX = 1

/** Índice de "Clientes" en "✋Categoria" (dropdown_mm54e5ag). La columna es multi-valor. */
export const CATEGORIA_CLIENTE_INDEX = 1

/**
 * Índices de "🤖Estado" (color_mkwb727e) en "💰Fact Vtas Pends de Cobro". NO siguen el orden en
 * que se ven en el board: "Pend de Cobrar 100%" figura primera pero es el índice 2. Leídos del
 * tablero: {"0":"Cancelada Parcialmente","1":"Cancelada 100%","2":"Pend de Cobrar 100%"}.
 */
export const FACT_PENDIENTE_ESTADO_INDEX = {
  canceladaParcialmente: 0,
  cancelada: 1,
  pendienteDeCobro: 2,
} as const

/**
 * Facturas que se pueden cobrar: las que todavía deben algo. Son los dos estados que NO están
 * cancelados al 100%, y viajan como regla de la consulta —por índice, no por texto—.
 */
export const FACT_PENDIENTE_ESTADOS_COBRABLES: readonly number[] = [
  FACT_PENDIENTE_ESTADO_INDEX.pendienteDeCobro,
  FACT_PENDIENTE_ESTADO_INDEX.canceladaParcialmente,
]

export const COL = {
  cliente: {
    categoria: 'dropdown_mm54e5ag', // multi-valor: se filtra por "contiene Cliente"
    codigo: 'text_mm542r9d',
    cuit: 'text_mm54btnd',
    dirFiscal: 'location_mm54jt1g',
    tipoPersona: 'color_mm54k8hr',
    condFiscal: 'color_mm54yakw',
    listaPrecio: 'dropdown_mm582vqy',
    agenteRet: 'dropdown_mm54fnwn',
    situacion: 'color_mm58nd7b',
    estado: 'color_mm588vd6',
    condPago: 'dropdown_mm54yq06',
    /** "Recibimos CHEQUE" (status): "SI" o "NO". Un "NO" impide cobrarle con cheque. */
    aceptaCheques: 'color_mm5yb27h',
    limite: 'numeric_mm57tw48',
    ctaCte: 'board_relation_mm5ep5qd',
    contactos: 'account_contact',
  },
  /* "💰Fact Vtas Pends de Cobro" (18421035508): una fila por venta que quedó debiendo. Es de donde
     salen las facturas que se eligen en el paso 2. Los ids se verificaron contra el tablero. */
  factPendiente: {
    /** "🤖Personas": el cliente que queda debiendo. Es por donde se filtra. */
    cliente: 'board_relation_mm5zaxck',
    /** "📈Ventas": la venta que dejó esta deuda. */
    venta: 'board_relation_mm4d3nn0',
    /** "🤖ID Fact Pend Cobro": el número del comprobante que ve el usuario (FPENCOB-042). */
    nro: 'pulse_id_mm5pxaym',
    /** "🤖Vta $": importe total de la venta. */
    total: 'numeric_mkwbck5d',
    /** "🤖Cobrado $" (mirror): lo que ya se cobró históricamente de esta factura. */
    cobrado: 'lookup_mm4c3vc8',
    /** "🤖Cobrado %" (fórmula): qué proporción de la factura ya está cancelada. */
    cobradoPct: 'formula_mm4e34xa',
    /** "🤖Pend de Cobrar $" (fórmula): el saldo que queda por cancelar. */
    pendiente: 'formula_mkwbrnk1',
    /** "🤖Estado": ver `FACT_PENDIENTE_ESTADO_INDEX`. */
    estado: 'color_mkwb727e',
  },
  /* "📈Ventas" (18421035510). La factura pendiente sólo guarda importes: el número de la venta y
     su vencimiento viven acá y se leen a través de la relación `factPendiente.venta`. */
  venta: {
    /** "🤖ID Venta": el identificador que ve el usuario ("VTA-094"). */
    idVenta: 'pulse_id_mkw8wzn1',
    /** "🤖Fecha Emision Fact" (date, ISO). */
    fechaEmision: 'date_mm5n6z7j',
    /** "🤖Fecha Venc Fact" (date, ISO): de acá salen el vencimiento y los días de mora. */
    fechaVencimiento: 'date_mm5nkdj0',
  },
  /* Board de Cta Cte. El crédito se arma con las columnas BASE, no con las fórmulas del tablero:
     así la app no depende de que el board las tenga al día. Las mirror se leen por `display_value`
     (con el fragmento `... on MirrorValue`); `text` viene siempre vacío. */
  /* "⚙️Configuracion - Sistema" (18421035530): un board de ítems heterogéneos donde la etiqueta de
     "Tipo de Config" dice qué es cada fila. De acá salen las cuentas bancarias propias. */
  config: {
    /** "Tipo de Config": clasifica el ítem ("Ctas Bancarias Propias", "Medios de Cobro"…). */
    tipo: 'color_mm4emv5g',
  },
  /* "➡️Recibos y Cobros" (18421035524): la CABECERA del recibo. La app escribe quién cobró, a quién
     se le cobró y los tres totales de la cobranza; el resto de las columnas "🤖" las completa el
     propio tablero. */
  cobro: {
    /** "🤖Vendedor" (people): quién cobró. */
    vendedor: 'multiple_person_mm5s28s6',
    /** "🤖Persona" (board_relation → Personas): a quién se le cobró. */
    cliente: 'board_relation_mkwb7fmp',
    /**
     * "🤖 TOTAL $ Vta" (numbers): el TOTAL CANCELADO, o sea la suma de lo imputado a las facturas.
     * El rótulo del tablero habla de "Vta" porque el mismo board recibe los recibos de la app de
     * ventas, donde ese importe es el total de la venta; en una cobranza, lo que ocupa ese lugar es
     * lo que el recibo cancela.
     */
    totalCancelado: 'numeric_mm5xbjkm',
    /** "🤖TOTAL $ Cobrado" (numbers): el TOTAL RECIBIDO, la suma de las formas de pago. */
    totalRecibido: 'numeric_mm5xbkj',
    /** "🤖TOTAL $ Diferencia" (numbers): cancelado − recibido. En un cobro que cierra, 0. */
    diferencia: 'numeric_mm5xfznj',
    /**
     * "🤖Estado de Emision" (status): el semáforo de la emisión del PDF y TAMBIÉN el del envío
     * (comparten columna). La app lo pone en "A emitir" y en "Enviar"; el resto lo mueve el
     * TABLERO (ver `ESTADO_EMISION_INDEX` y `ENVIO_RECIBO_INDEX`).
     */
    estadoEmision: 'color_mkwbzd3f',
    /** "✋Enviar por:" (dropdown multi-valor): Email y/o WhatsApp. Ver `MEDIO_ENVIO_IDS`. */
    enviarPor: 'dropdown_mm5z5n2d',
    /** "🤖 Recibo PDF" (file): el documento a enviar. Vacío = todavía no se generó. */
    pdf: 'file_mkwbkp1d',
    /** "🤖Fecha de Envio al Cliente" (date): la completa el tablero al despachar. */
    fechaEnvio: 'date_mkwbdyj6',
  },
  /* Board de Contactos (18420688239). Los contactos del cliente cuelgan de su columna conectada
     `cliente.contactos`; de acá sale a quién se le puede enviar el recibo. */
  contacto: {
    codigo: 'pulse_id_mm572ncq',
    /** El nombre se arma con estas dos columnas, no con el `name` del ítem. */
    nombre: 'text_mm5848zg',
    apellido: 'text_mm58q0bx',
    email: 'contact_email',
    /** La columna se llama "Whatsapp" en el board: es el teléfono del contacto. */
    telefono: 'contact_phone',
    /** "Para Enviar" (dropdown): qué comprobantes acepta recibir esta persona. */
    paraEnviar: 'dropdown_mm57p8ja',
    cliente: 'contact_account',
  },
  /* Subelementos del recibo (18421035599). El MISMO board recibe los dos tipos de subítem que crea
     la emisión, y cada uno completa su propio juego de columnas:
       · FACTURA CANCELADA → la relación a la factura + "🤖Importe Cancelado $".
       · FORMA DE PAGO     → "✋Caja" + "🤖Importe Cobrado $" + lo propio de su medio.
     Los ids se verificaron contra el esquema del tablero. */
  cobroSub: {
    /** "✋Caja" (status): con qué medio entró la plata. Se escribe por ÍNDICE (ver `CAJA_INDEX`). */
    caja: 'status',
    /** "💰Fact Vtas Pends de Cobro" (board_relation): la factura que este subítem cancela. */
    factura: 'board_relation_mm63pczd',
    /** "🤖Importe Cancelado $": cuánto se le imputa a esa factura. */
    importeCancelado: 'numeric_mm4e61yk',
    /** "🤖Importe Cobrado $": cuánto entregó el cliente con esa forma de pago. */
    importeCobrado: 'numeric_mm63j1mv',
    /** "🤖Banco de Acreditacion" (board_relation → Configuración): la cuenta propia que recibe. */
    bancoAcreditacion: 'board_relation_mm5y22zv',
    /* --- Cheque --- */
    nroCheque: 'numeric_mm5rrwjg',
    /** "🤖CUIT Emisor" (text): va con los guiones, tal como se cargó. */
    cuit: 'text_mm5ydwp2',
    /** "🤖Origen Cheque" (dropdown): papel o electrónico (ver `CHEQUE_ORIGEN_LABEL`). */
    origenCheque: 'dropdown_mm5yveka',
    /** "🤖Fecha de Emision" (date): la del cheque. */
    fechaEmision: 'date_mm5rxdpk',
    /** "🤖Banco Emisor" (dropdown): lo comparten el cheque y la tarjeta. */
    bancoEmisor: 'dropdown_mm5yfd8n',
    /* --- Tarjeta --- */
    nroTarjeta: 'text_mm5ybw7q',
    titularTarjeta: 'text_mm5yr164',
    tipoTarjeta: 'dropdown_mm5rx800',
    nroCupon: 'text_mm5zs69e',
    cuotas: 'numeric_mm5ydy8',
    valorCuota: 'numeric_mm5yx0ec',
    /**
     * "🤖Fecha Venc" (date). Es UNA sola columna para los dos medios: el vencimiento del cheque y
     * el del plástico. Nunca conviven en el mismo subítem, así que no se pisan.
     */
    vencimiento: 'date_mm5y4zxa',
    /* --- Comprobantes adjuntos (columnas `file`) ---
       NO se completan por `column_values`: ahí sólo viaja JSON. Se llenan después, subiendo el
       binario con `add_file_to_column` (ver `columnaComprobante` en `recibos.ts`). */
    compRetencion: 'file_mm5yzcnk',
    compTransferencia: 'file_mm5rtssw',
    cupon: 'file_mm5yy4je',
  },
  ctaCte: {
    /** "🤖Total Ventas": todo lo facturado a la cuenta. */
    totalVentas: 'lookup_mm5g2exg',
    /** "🤖Total Cobros": todo lo cobrado. Vacío = 0. */
    totalCobros: 'lookup_mm5gx0d5',
    /** "🤖Remito Pends de Facturar": entregado y todavía sin facturar. */
    remitosPendFacturar: 'numeric_mm5f2npa',
    /** "🤖Limite de credito": el límite del cliente, espejado en su cuenta. */
    limite: 'lookup_mm585jgv',
  },
} as const

/* ===== Etiquetas del recibo =====
   Los tres mapas de acá abajo traducen el vocabulario de la APP al del TABLERO. Existen porque no
   coinciden: la app dice "Retencion GAN" y el board "Retencion IG", la app "Galicia" y el board
   "Banco Galicia". Sin la traducción, cada cobro ensuciaría el tablero con etiquetas duplicadas. */

/**
 * Forma de pago de la app → ÍNDICE de "✋Caja" (columna `status`) del subelemento. Se escribe por
 * índice y no por etiqueta a propósito: el índice es la identidad de la opción en el board, así que
 * ni un cambio de rótulo ni un `create_labels_if_missing` pueden desviar un cobro a una caja nueva.
 *
 * Los índices salen del propio tablero: {"0":"Transferencia","1":"Cheque","2":"Efectivo",
 * "3":"Tarjeta de Debito","4":"Tarjeta de Crédito","6":"Retencion IIBB","7":"Retencion IG",
 * "8":"Retencion IVA","9":"Dif de Caja"} — OJO, no siguen el orden en que se ven y falta el 5.
 */
export const CAJA_INDEX: Record<FormaPago, number> = {
  Transferencia: 0,
  Cheque: 1,
  Efectivo: 2,
  'Tarjeta de débito': 3,
  'Tarjeta de crédito': 4,
  'Retencion IIBB': 6,
  // "Retencion GAN" en la app es "Retencion IG" (Impuesto a las Ganancias) en el tablero.
  'Retencion GAN': 7,
  'Retencion IVA': 8,
}

/**
 * Índices de "🤖Estado de Emision" (color_mkwbzd3f) del recibo. Es un semáforo COMPARTIDO: la app
 * escribe UNA sola vez —"A emitir", que dispara la automatización— y de ahí en más sólo lo LEE.
 * El tablero lo mueve a "Emitiendo" mientras genera el PDF y lo cierra en "Emitido" o en
 * "Error - Emision".
 *
 * Leídos del tablero: {"0":"Emitiendo","1":"Emitido","2":"Error - Emision","3":"A emitir",
 * "4":"Enviar","6":"Enviando","7":"Enviado","8":"Error - Enviar","9":"Emitio Cancelacion",
 * "10":"Cancelacion"}. Igual que en las demás columnas status, los índices NO siguen el orden en
 * que se ven en pantalla, así que se escriben y comparan por índice y nunca por el rótulo.
 */
export const ESTADO_EMISION_INDEX = {
  /** Lo ÚNICO que escribe la app: pide la emisión. */
  aEmitir: 3,
  emitiendo: 0,
  emitido: 1,
  error: 2,
} as const

/**
 * Índices de la MISMA columna "🤖Estado de Emision" para el tramo del ENVÍO. La app escribe
 * "Enviar" (4) —que es lo que dispara la automatización— y de ahí sólo lee: el tablero pasa por
 * "Enviando" (6) y cierra en "Enviado" (7) o "Error - Enviar" (8).
 */
export const ENVIO_RECIBO_INDEX = {
  /** Lo único que escribe la app en este tramo: pide el envío. */
  enviar: 4,
  enviando: 6,
  enviado: 7,
  error: 8,
} as const

/** Estados que CIERRAN el envío: al llegar a uno de ellos se deja de esperar al tablero. */
export const ENVIO_RECIBO_FINALES: readonly number[] = [
  ENVIO_RECIBO_INDEX.enviado,
  ENVIO_RECIBO_INDEX.error,
]

/**
 * Medio de envío de la app → ids de las etiquetas de "✋Enviar por:" (dropdown_mm5z5n2d).
 *
 * Se escribe por ID y no por texto, igual que el resto de las columnas de etiquetas: aguanta que
 * en el tablero le cambien el rótulo. "Ambos" no es una etiqueta del board —la columna es
 * multi-valor—, así que se resuelve mandando las dos.
 */
export const MEDIO_ENVIO_IDS: Record<'Email' | 'WhatsApp' | 'Ambos', number[]> = {
  Email: [2],
  WhatsApp: [6],
  Ambos: [2, 6],
}

/** Formato del cheque en la app → etiqueta de "🤖Origen Cheque" (dropdown_mm5yveka). */
export const CHEQUE_ORIGEN_LABEL: Record<FormatoCheque, string> = {
  FISICO: 'Cheque',
  eCheq: 'eCheq',
}

/**
 * Banco del selector de la app → etiqueta de "🤖Banco Emisor" (dropdown_mm5yfd8n). El selector
 * nombra los bancos cortos ("Galicia") y el tablero los tiene completos ("Banco Galicia").
 *
 * Lo que NO está en este mapa viaja tal cual: son los bancos que el usuario agrega desde el propio
 * formulario ("➕ Otro banco…"), y su etiqueta se crea sola al escribir el subelemento
 * (`create_labels_if_missing`). Por eso el mapa cubre los fijos y no pretende ser exhaustivo.
 */
export const BANCO_EMISOR_LABEL: Record<string, string> = {
  Galicia: 'Banco Galicia',
  Provincia: 'Banco Provincia',
  Nacion: 'Banco Nación',
  HSBC: 'HSBC',
  Credicop: 'Banco Credicoop',
  Santander: 'Banco Santander',
  BBVA: 'BBVA',
  Hipotecario: 'Banco Hipotecario',
  Patagonia: 'Banco Patagonia',
  Supervielle: 'Banco Supervielle',
}
