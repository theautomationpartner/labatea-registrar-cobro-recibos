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
  /** "Anticipos Pends de Aplicar": el saldo a favor del cliente, listo para imputarse a facturas. */
  anticipos: 18426066447,
  /**
   * Cuenta corriente del cliente: un ítem por cliente y, colgando de él, un SUBÍTEM por movimiento.
   * De ahí salen los dos saldos que muestra la ficha (pendiente de cancelar y anticipos).
   */
  ctaCte: 18421858736,
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

/**
 * Índices de "Estado" (color_mm64qza0) en "Anticipos y Credito x pase de Saldo - Pends de Aplicar".
 * Leídos del tablero: {"0":"100% Aplicado","1":"Aplicado Parcialmente","17":"Pend de Aplicar"}.
 *
 * NO son correlativos, así que el filtro va por ÍNDICE y nunca por el texto de la etiqueta —que ya
 * cambió una vez: el 0 se llamaba "Cancelado" y el 13, "Nada", una etiqueta que hoy no existe—.
 */
export const ANTICIPO_ESTADO_INDEX = {
  aplicado: 0,
  aplicadoParcialmente: 1,
  pendienteDeAplicar: 17,
} as const

/**
 * Anticipos con saldo a favor DISPONIBLE: los que todavía no se aplicaron y los que se aplicaron en
 * parte. Los dos tienen algo que dar, y CUÁNTO lo dice su "Pend de Aplicar", no su etiqueta.
 *
 * Queda afuera el 100% aplicado, que es el único sin nada que ofrecer. Los dos índices viajan como
 * regla de la consulta, con el mismo criterio que los estados cobrables de una factura.
 */
export const ANTICIPO_ESTADOS_APLICABLES: readonly number[] = [
  ANTICIPO_ESTADO_INDEX.pendienteDeAplicar,
  ANTICIPO_ESTADO_INDEX.aplicadoParcialmente,
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
    /**
     * "🤖Fecha Emision" (date, ISO). Es la fecha que el RECIBO declara para el comprobante que
     * cancela. Vive en la propia factura: antes se leía de la venta vinculada, que muchas facturas
     * del tablero no tienen conectada y las dejaba sin fecha.
     */
    fechaEmision: 'date_mm648d33',
    /** "🤖Fecha Vto" (date, ISO): de acá salen el vencimiento de la fila y sus días de mora. */
    fechaVencimiento: 'date_mm647vwr',
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
  /* "📈Ventas" (18421035510). Lo ÚNICO que la factura pendiente busca acá es el NOMBRE de la venta
     que dejó la deuda, a través de la relación `factPendiente.venta`. Las fechas ya no: viven en la
     propia factura (`factPendiente.fechaEmision` / `fechaVencimiento`), que las tiene siempre,
     tenga o no su venta conectada. */
  venta: {
    /** "🤖ID Venta": el identificador que ve el usuario ("VTA-094"). */
    idVenta: 'pulse_id_mkw8wzn1',
  },
  /* "Anticipos Pends de Aplicar" (18426066447): un ítem por anticipo con saldo a favor. De acá salen
     los anticipos que se eligen para cancelar facturas. Los ids se verificaron contra el tablero. */
  anticipo: {
    /** "Cliente" (board_relation → Personas): de quién es el anticipo. Es por donde se filtra. */
    cliente: 'board_relation_mm64zh21',
    /** "Fecha de Anticipo" (date, ISO). */
    fecha: 'date_mm64k479',
    /** "Comentarios" (text): por qué se registró. */
    comentario: 'text_mm64a1zb',
    /** "Importe $" (numbers): con cuánto nació el anticipo. */
    importe: 'numeric_mm64h18',
    /** "Total Aplicado $" (mirror): cuánto ya se imputó a facturas. */
    aplicado: 'lookup_mm643zg',
    /** "Pend de Aplicar" (fórmula): el saldo a favor que queda. Es el TOPE de lo que se puede imputar. */
    pendiente: 'formula_mm641qex',
    /** "Status": ver `ANTICIPO_ESTADO_INDEX`. */
    estado: 'color_mm64qza0',
    /** "Recibo y Cobro" (text): el comprobante con el que entró el anticipo. */
    recibo: 'text_mm64bf3r',
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
    /** "🤖Tipo de Cobro" (status): siempre "Posterior". Ver `TIPO_COBRO_INDEX`. */
    tipoCobro: 'color_mm5yh0gs',
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
    /**
     * "🤖Estado Registro de Cobro" (status): el semáforo con el que el TABLERO procesa el ítem.
     * La app lo pone en "Registrar" y de ahí en más lo mueve la automatización (ver
     * `ESTADO_REGISTRO_INDEX`).
     */
    estadoRegistro: 'color_mm5zkr61',
    /** "✋Enviar por:" (dropdown multi-valor): Email y/o WhatsApp. Ver `MEDIO_ENVIO_IDS`. */
    enviarPor: 'dropdown_mm5z5n2d',
    /**
     * "🤖Contactos" (board_relation → Contactos): A QUIÉNES se les manda el documento. Se escribe
     * junto con el medio, antes de disparar el envío: la automatización del tablero lee el ítem
     * para saber a dónde despachar, así que los destinatarios tienen que estar puestos antes.
     */
    contactos: 'board_relation_mm65gakb',
    /**
     * "🤖Saldo Cta Cte con Cobro Aplicado" (numbers): cómo queda la deuda de la cuenta DESPUÉS de
     * este recibo — el saldo que tenía menos lo recibido—. Lo calcula la app al emitir y no se
     * muestra en pantalla: es un dato del documento, no de la operación en curso.
     */
    saldoConCobro: 'numeric_mm6e1hz3',
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
  /* Subelementos del recibo (18421035599). El MISMO board recibe todos los tipos de subítem que
     crea la emisión, y cada uno completa su propio juego de columnas —siempre con "✋Caja" como
     rótulo de qué es la línea—:
       · FACTURA CANCELADA → "✋Caja" + la relación a la factura + "🤖Importe Cancelado $".
       · ANTICIPO          → "✋Caja" + "🤖Importe Cancelado $" (no cancela facturas: es a cuenta).
       · FORMA DE PAGO     → "✋Caja" + "🤖Importe Recibido $" + lo propio de su medio.
       · DIF DE CAJA       → "✋Caja" + "🤖Importe Recibido $" con el descuadre, sólo si lo hubo.
     Los ids se verificaron contra el esquema del tablero. */
  cobroSub: {
    /**
     * "✋Caja" (status): qué declara el subelemento. Se escribe SIEMPRE por ÍNDICE y cubre los tres
     * tipos de línea del recibo: el medio con el que entró la plata (`CAJA_INDEX`), la factura que
     * se cancela (`CAJA_FACT_CANCELADA_INDEX`), el anticipo entregado (`CAJA_ANTICIPO_INDEX`) y su
     * eventual ajuste de caja (`CAJA_DIF_INDEX`).
     */
    caja: 'status',
    /**
     * "🤖Nro Comprobante" (TEXT): el número del documento que respalda el movimiento. Es UNA sola
     * columna para los TRES medios que traen uno —el certificado de la retención, el cheque y el
     * cupón de la tarjeta—, que nunca conviven en el mismo subítem, así que no se pisan.
     *
     * Es de TEXTO, no numérica: el número viaja tal como se cargó, sin recortarle nada.
     */
    nroComprobante: 'text_mm654900',
    /**
     * "🤖Detalle" (long_text): el texto libre del movimiento. Hoy lo usa el ANTICIPO —el motivo que
     * escribe el usuario al declarar el importe—, y queda disponible para cualquier otra línea que
     * necesite explicarse.
     */
    detalle: 'long_text_mm65mm0k',
    /* --- Retenciones --- */
    /** "🤖Año" (numbers): el ejercicio al que corresponde la retención. */
    anioRetencion: 'numeric_mm64dwpx',
    /** "💰Fact Cancelada" (board_relation → 18421035508): la factura que este subítem cancela. */
    factura: 'board_relation_mm63pczd',
    /**
     * "Anticipos Pends de Aplicar" (board_relation → 18426066447): el anticipo cuyo saldo se usa.
     *
     * Es una columna PROPIA y no la de facturas: "💰Fact Cancelada" sólo conecta con los tableros de
     * facturas (18421035508 / 18422405731), así que un id de anticipo escrito ahí no linkea nada.
     */
    anticipoAplicado: 'board_relation_mm659pd1',
    /**
     * "🤖Persona Origen" (board_relation → Personas): de quién SALE el saldo en un pase. Es una
     * columna aparte de la "🤖Persona" de la cabecera, que apunta a quién lo RECIBE: en un pase las
     * dos personas son distintas, y esa diferencia ES la operación.
     */
    personaOrigen: 'board_relation_mm6b2p4y',
    /** "🤖Importe Cancelado $": cuánto se le imputa a esa factura. */
    importeCancelado: 'numeric_mm4e61yk',
    /** "🤖Importe Cobrado $": cuánto entregó el cliente con esa forma de pago. */
    importeCobrado: 'numeric_mm63j1mv',
    /** "🤖Banco de Acreditacion" (board_relation → Configuración): la cuenta propia que recibe. */
    bancoAcreditacion: 'board_relation_mm5y22zv',
    /* --- Cheque ---
       El número del cheque NO tiene columna propia: va a "🤖Nro Comprobante" (`nroComprobante`),
       la misma que usa el certificado de retención. */
    /** "🤖CUIT Emisor" (text): va con los guiones, tal como se cargó. */
    cuit: 'text_mm5ydwp2',
    /** "🤖Origen Cheque" (dropdown): papel o electrónico (ver `CHEQUE_ORIGEN_LABEL`). */
    origenCheque: 'dropdown_mm5yveka',
    /** "🤖Fecha de Emision" (date): la del cheque. */
    fechaEmision: 'date_mm5rxdpk',
    /** "🤖Banco Emisor" (dropdown): lo comparten el cheque y la tarjeta. */
    bancoEmisor: 'dropdown_mm5yfd8n',
    /* --- Tarjeta ---
       El número del cupón tampoco tiene columna propia: va a "🤖Nro Comprobante"
       (`nroComprobante`). La columna "🤖Numero Cupon" (text_mm5zs69e) del tablero queda sin usar. */
    tipoTarjeta: 'dropdown_mm5rx800',
    /**
     * "🤖Fecha Venc" (date). Es UNA sola columna para tres líneas distintas: el vencimiento del
     * cheque, el del plástico y el del anticipo. Nunca conviven en el mismo subítem, así que no se
     * pisan.
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
    /** Relación al cliente (board de Personas). Es por donde se busca SU cuenta corriente. */
    cliente: 'board_relation_mm58dyn',
    /**
     * "Fact Vent pend de Aplciar" (numbers): VENTAS PENDS DE CANCELAR, el total que el cliente
     * todavía debe. Es un total YA calculado por el tablero sobre el ítem de la cuenta: la app lo
     * lee, no lo suma.
     */
    ventasPendCancelar: 'numeric_mm677127',
    /** "Anticipo pend de Aplicar" (numbers): ANTICIPOS PENDS DE APLICAR, el saldo a favor sin usar. */
    anticiposPendAplicar: 'numeric_mm67j0rv',
  },
} as const

/* ===== Etiquetas del recibo =====
   Los tres mapas de acá abajo traducen el vocabulario de la APP al del TABLERO. Existen porque no
   coinciden: la app dice "Retencion GAN" y el board "Retencion IG", la app "Banco BBVA" y el board
   "BBVA". Sin la traducción, cada cobro ensuciaría el tablero con etiquetas duplicadas. */

/**
 * Formas de pago que TODAVÍA no tienen su etiqueta en "✋Caja" y por eso se escriben por texto en
 * vez de por índice (ver `CAJA_LABEL`). Es una lista de excepciones, no la regla: en cuanto el
 * tablero tenga la etiqueta y se sepa su índice, la forma se mueve a `CAJA_INDEX` y sale de acá.
 */
export type FormaPagoSinIndice = 'Retencion SUSS'

/**
 * Índice de "Anticipo" en "✋Caja" (columna `status` del subelemento). No entra en `CAJA_INDEX`
 * porque NO es una forma de pago: es la línea que declara QUÉ se está cancelando —el anticipo
 * entregado—, el lugar que en un cobro ocupan los subítems de factura.
 */
export const CAJA_ANTICIPO_INDEX = 11

/**
 * Forma de pago de la app → ÍNDICE de "✋Caja" (columna `status`) del subelemento. Se escribe por
 * índice y no por etiqueta a propósito: el índice es la identidad de la opción en el board, así que
 * ni un cambio de rótulo ni un `create_labels_if_missing` pueden desviar un cobro a una caja nueva.
 *
 * Los índices salen del propio tablero: {"0":"Transferencia","1":"Cheque","2":"Efectivo",
 * "3":"Tarjeta de Debito","4":"Tarjeta de Crédito","6":"Retencion IIBB","7":"Retencion IG",
 * "8":"Retencion IVA","9":"Dif de Caja","10":"Fact Cancelada","11":"Anticipo",
 * "12":"Retencion IIBB","13":"Retencion CCSS"} — OJO, no siguen el orden en que se ven, falta el 5,
 * y el 12 es un DUPLICADO de "Retencion IIBB": las retenciones de IIBB se escriben en el 6, que es
 * donde están las que ya se registraron.
 *
 * El tipo excluye SÓLO a las formas de `FORMAS_PAGO_SIN_INDICE`: sumar un medio de cobro al
 * catálogo sin darle su caja no compila, así que ninguna forma de pago puede llegar al tablero sin
 * una caja resuelta —por índice acá, o por etiqueta en `CAJA_LABEL`—.
 */
export const CAJA_INDEX: Record<Exclude<FormaPago, FormaPagoSinIndice>, number> = {
  Transferencia: 0,
  Cheque: 1,
  Efectivo: 2,
  'Tarjeta de débito': 3,
  'Tarjeta de crédito': 4,
  'Retencion IIBB': 6,
  // "Retencion GAN" en la app es "Retencion IG" (Impuesto a las Ganancias) en el tablero.
  'Retencion GAN': 7,
  'Retencion IVA': 8,
  /* Contribuciones de Seguridad Social. Es la única caja que NO comparte el bloque 6-8: se sumó al
     tablero después, así que quedó al final de la lista de etiquetas. */
  'Retencion CCSS': 13,
  /* El ANTICIPO no es una caja de dinero: es el sobrante del cobro que queda a favor del cliente.
     Comparte la etiqueta con la línea del anticipo de los otros recorridos —en el tablero es lo
     mismo: saldo a favor—, así que reusa su índice. */
  Anticipo: CAJA_ANTICIPO_INDEX,
}

/**
 * Formas de pago que se escriben por ETIQUETA en "✋Caja". Es la excepción al criterio del índice y
 * existe por un motivo concreto: la etiqueta todavía no está en el tablero, así que no hay índice
 * que usar. La crea el propio alta del subelemento (`create_labels_if_missing: true`).
 *
 * Tiene la contra que el índice evita: si en el board le cambian el rótulo a esa caja, el próximo
 * cobro crearía una etiqueta nueva en vez de caer en la existente. Por eso conviene pasarla a
 * `CAJA_INDEX` en cuanto se sepa qué índice le tocó.
 */
export const CAJA_LABEL: Record<FormaPagoSinIndice, string> = {
  'Retencion SUSS': 'Retencion SUSS',
}

/**
 * Valor de "✋Caja" para una forma de pago: por índice cuando lo tiene y por etiqueta cuando no.
 * Es el ÚNICO lugar donde se decide entre las dos formas, así que quien escribe el subelemento no
 * tiene que saber cuál le toca a cada medio.
 */
export function cajaDeFormaPago(forma: FormaPago): { index: number } | { label: string } {
  const label = (CAJA_LABEL as Partial<Record<FormaPago, string>>)[forma]
  if (label) return { label }
  return { index: (CAJA_INDEX as Record<FormaPago, number>)[forma] }
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
/**
 * Índices de "🤖Tipo de Cobro" (color_mm5yh0gs) del recibo. Leídos del tablero:
 * {"0":"Posterior","1":"Simultaneo","2":"Anticipo","3":"Aplicacion Cta Cte"}.
 *
 * De los cuatro, esta app escribe dos:
 *
 *   · POSTERIOR · el cobro de facturas que ya estaban emitidas y esperando en "💰Fact Vtas Pends de
 *                 Cobro": el cobro llega después de la venta por definición del recorrido.
 *   · ANTICIPO  · el cliente entrega dinero a cuenta, sin facturas que cancelar.
 *
 * El "Simultaneo" es del otro flujo —la app de operaciones de venta, que cobra en el mismo acto en
 * que factura— y comparte este tablero. "Aplicacion Cta Cte" queda declarado para el recorrido de
 * aplicación de anticipos, todavía sin implementar.
 */
export const TIPO_COBRO_INDEX = {
  posterior: 0,
  simultaneo: 1,
  anticipo: 2,
  aplicacionCtaCte: 3,
  /** PASE DE SALDO: el saldo a favor de un cliente se mueve a la cuenta de otro. */
  paseDeSaldo: 4,
} as const


/**
 * Índice de "Dif de Caja" en "✋Caja". Tampoco es una forma de pago: es la línea de AJUSTE con la
 * que el recibo documenta el descuadre por centavos entre lo que se cancela y lo que entró a caja
 * (ver `TOLERANCIA_DIFERENCIA` en `lib/pagos`). Sólo se escribe cuando ese descuadre existe.
 */
export const CAJA_DIF_INDEX = 9

/**
 * Índice de "Fact Cancelada" en "✋Caja". Es el rótulo de los subelementos de FACTURA: dicen qué
 * comprobante cancela el recibo, no con qué medio se pagó. Con él, las tres cosas que puede
 * declarar un subítem —una factura cancelada, un anticipo o una forma de pago— quedan distinguidas
 * por la misma columna en el tablero.
 */
export const CAJA_FACT_CANCELADA_INDEX = 10

/**
 * Índices de "✋Caja" para las DOS patas de un PASE DE SALDO. Tampoco son formas de pago: son el
 * movimiento contable del saldo, que sale de una cuenta y entra en otra. Van siempre de a par —un
 * débito sin su crédito dejaría plata en el aire—, y en ese orden.
 */
export const CAJA_DEBITO_PASE_INDEX = 14
export const CAJA_CREDITO_PASE_INDEX = 15

/**
 * Índices de "🤖Estado Registro de Cobro" (color_mm5zkr61). Leídos del tablero:
 * {"0":"Registrando","1":"Registrado","2":"Error - Ver Update","3":"Reintentar","4":"Registrar"}.
 *
 * La app escribe UNO solo —"Registrar"—, que es lo que le pide al tablero que procese el ítem. El
 * resto los mueve la automatización, así que acá sólo se declaran para que se lea de dónde sale el
 * 4 y qué significan los otros.
 */
export const ESTADO_REGISTRO_INDEX = {
  /** Lo ÚNICO que escribe la app: pide que el tablero registre el ítem. */
  registrar: 4,
  registrando: 0,
  registrado: 1,
  error: 2,
  reintentar: 3,
} as const

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
 * Banco del selector de la app → etiqueta de "🤖Banco Emisor" (dropdown_mm5yfd8n).
 *
 * El catálogo de la app nombra a TODOS los bancos con la palabra adelante ("Banco HSBC"), que es el
 * estándar del selector (ver `BANCOS_EMISORES_BASE`). El tablero coincide en casi todos; las dos
 * excepciones son las que están acá, y se traducen para no dar de alta una etiqueta nueva al lado
 * de la que ya existe —la mutación crea las que faltan (`create_labels_if_missing`), así que una
 * diferencia de una palabra terminaría duplicando el banco en el board—.
 *
 * Lo que NO está en este mapa viaja tal cual: los demás fijos ya calzan letra por letra, y los que
 * el usuario agrega desde el formulario ("➕ Otro banco…") son bancos nuevos de verdad.
 */
export const BANCO_EMISOR_LABEL: Record<string, string> = {
  'Banco HSBC': 'HSBC',
  'Banco BBVA': 'BBVA',
}
