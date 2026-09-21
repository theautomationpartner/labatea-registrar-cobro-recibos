/** Modelo de dominio. La capa de servicio (Monday) debe devolver exactamente estas formas. */

/**
 * Módulo de la app, elegido en el ENCABEZADO. Son dos operaciones INDEPENDIENTES entre sí: no
 * comparten etapas, ni pantallas, ni estado de trabajo.
 *
 *   · COBROS · se le cobra a un cliente y se le emite el recibo. Es el módulo por defecto, y el
 *              único que además pregunta QUÉ se cobra (ver `TipoOperacion`).
 *   · PASES  · el saldo a favor de un cliente se mueve a la cuenta de otro. Circuito propio de
 *              tres etapas: no emite recibo ni pregunta qué se cobra.
 *   · PAGOS  · se le paga a un proveedor lo que se le debe. Circuito propio de tres etapas —el
 *              proveedor, sus facturas de compra pendientes y las cajas con las que se paga—, con
 *              sus propias claves de navegación (ver `PasoPago`). Sólo lo puede elegir un
 *              administrador (ver `lib/permisos`).
 *   · RECHAZOS · el banco rechazó un cheque que un cliente había entregado y que ya se le había
 *              endosado a un proveedor. Circuito propio de tres etapas —el cliente deudor, el
 *              cheque rechazado de su cartera y el proveedor acreedor—, y toca los DOS lados del
 *              mostrador: es la única operación de la app que lo hace.
 *   · RESUMEN · se le emite y envía a un cliente el RESUMEN DE SU CUENTA CORRIENTE de un período.
 *              Circuito propio de cuatro etapas —el cliente, el rango de fechas, el estado de la
 *              cuenta y la emisión con su envío—. Es la única operación que NO mueve saldo: lee la
 *              cuenta y la documenta.
 *
 *   · COBRANZA · TABLERO DE GESTIÓN DE COBRANZA: se consultan las cuentas corrientes de los
 *              clientes por el estado de su saldo y las facturas de venta que deben por su
 *              vencimiento, para decidir a quién reclamarle. NO tiene etapas: es UNA pantalla de
 *              análisis, y es la única operación que no escribe NADA en Monday —ni un ítem, ni una
 *              columna—. Desde ahí se salta a la operación que sí actúa (ver `CobranzaView`).
 *
 * Elegir uno cambia la app entera, no una parte: por eso el ruteo de más alto nivel mira ESTE valor
 * antes que el paso (ver `App`), y cambiarlo descarta lo que se venía cargando en el anterior.
 */
export type OperacionApp = 'COBROS' | 'PASES' | 'PAGOS' | 'RECHAZOS' | 'RESUMEN' | 'COBRANZA'

/**
 * Etapas del módulo de COBROS. Son suyas y de nadie más: PAGOS es una operación independiente y
 * tiene su propio recorrido (ver `PasoPago`), sin reusar una sola de estas claves.
 */
export type Paso =
  | 'cliente'
  | 'ventas'
  | 'cobro'
  | 'recibo'
  /* Sólo PASES DE SALDO: elegir el anticipo del cliente ORIGEN y después la cuenta DESTINO, que es
     donde además se cierra la operación. Son etapas propias de ese recorrido —no las comparte
     ningún otro—, y por eso tienen su clave en vez de reusar la de otro paso con otro significado. */
  | 'anticipoOrigen'
  | 'destino'
  /* Sólo RECHAZO DE CHEQUE: elegir el cheque de la cartera del cliente que el banco rechazó y
     después el proveedor al que ese cheque se le había endosado, que es donde además se cierra la
     operación. Mismo criterio que las dos de arriba: son etapas de UN recorrido y por eso tienen
     clave propia. */
  | 'chequeRechazado'
  | 'proveedorAcreedor'
  /* Sólo RESUMEN DE CTA CTE: cómo se obtienen los movimientos de la cuenta —el período y si el
     documento lleva el estado de la cuenta— y la emisión del resumen con su envío. */
  | 'configResumen'
  | 'resumenCtaCte'

/**
 * Qué se está registrando DENTRO del módulo de COBROS. Es lo primero que se elige —antes incluso
 * que el cliente— porque decide el recorrido de ese módulo (ver `lib/pasos`) y el "🤖Tipo de Cobro"
 * con el que nace el recibo en Monday:
 *
 *   · cobro      · se cancelan facturas que ya están pendientes en el tablero. Recorrido completo.
 *   · anticipo   · el cliente entrega dinero A CUENTA, sin facturas que imputar: el paso de ventas
 *                  pendientes no existe y lo que se cancela es el importe del propio anticipo.
 *   · aplicacion · se aplica el saldo a favor de anticipos ya registrados contra facturas
 *                  pendientes. Recorre las mismas cuatro etapas que el cobro; lo que cambia es el
 *                  paso 3, donde el dinero sale de los anticipos y no de una forma de pago.
 */
export type TipoOperacion = 'cobro' | 'anticipo' | 'aplicacion' | 'pases' | 'rechazos' | 'resumen'

/*
 * `pases`, `rechazos` y `resumen` NO se eligen en ese selector: son los recorridos de los MÓDULOS
 * "Pases de Saldo", "Rechazo de Cheque" y "Resumen de Cta Cte", y los pone el propio cambio de módulo
 * (ver `setOperacionApp`).
 * Viven en esta unión porque el recorrido, las etiquetas y el stepper se resuelven todos por
 * `TipoOperacion`: darles una vía aparte habría significado dos formas distintas de contestar
 * "¿en qué etapa estoy?".
 */


/**
 * Usuario que puede quedar como responsable de la operación: sale de los equipos "Vendedores" y
 * "Administradores" de Monday y puebla el selector del encabezado.
 */
export interface Usuario {
  /** ID numérico del usuario de Monday. Se guarda para asignar el cobro/recibo en las mutaciones. */
  id: string
  name: string
  /** Iniciales para el avatar (dos letras). */
  ini: string
  /** Color del avatar. Estable por usuario: sale de su id, no de su posición en la lista. */
  color: string
}

/** Usuario logueado en Monday: define el responsable por defecto y los permisos de la UI (RBAC). */
export interface UsuarioActual {
  /** ID numérico del usuario de Monday (query `me`). */
  id: string
  name: string
  /** Admin de la CUENTA de Monday (`is_admin`), distinto del equipo "Administradores". */
  isAdmin: boolean
  /** Nombres de los equipos a los que pertenece. De acá sale el rol: ver `lib/permisos`. */
  equipos: string[]
  /**
   * IDs de esos mismos equipos. Son los que deciden qué MÓDULOS ve (ver `esDelEquipoProveedores`):
   * un nombre se puede repetir o cambiar en Monday, un id no.
   */
  equipoIds: string[]
}

/* ===== Facturas pendientes de cobro ===== */

/**
 * Una venta que quedó debiendo, leída de "💰Fact Vtas Pends de Cobro" (18421035508). Es la unidad
 * que se elige en el paso 2 y sobre la que se imputa el cobro.
 */
export interface FacturaPendiente {
  /** ID del ítem en Monday: es la clave de la imputación y lo que se linkea al recibo. */
  id: string
  /** Número del comprobante que ve el usuario ("FPENCOB-042"). */
  nro: string
  /**
   * "🤖ID Venta" de la venta vinculada ("VTA-094"): es el nombre con el que se identifica la
   * factura. Vacío cuando la factura no tiene su venta conectada en el tablero.
   */
  idVenta: string
  /**
   * "🤖Fecha Emision" (`date_mm648d33`) de la propia factura, en ISO (yyyy-MM-dd). Vacío si el
   * tablero todavía no la cargó. Es la fecha que el recibo declara para cada comprobante cancelado
   * y la que la tabla del paso 2 muestra al lado del vencimiento.
   */
  emision: string
  /**
   * "🤖Fecha Venc Fact" de la venta vinculada, en ISO (yyyy-MM-dd). Vacío si no hay venta
   * conectada o si el tablero todavía no cargó la fecha.
   */
  vencimiento: string
  /** "🤖Vta $": importe original de la venta. */
  total: number
  /** "🤖Cobrado $": lo ya cancelado históricamente. */
  cobrado: number
  /** "🤖Cobrado %": porcentaje histórico ya cancelado (0-100). */
  cobradoPct: number
  /** "🤖Pend de Cobrar $": el saldo que queda por cancelar. Es el TOPE de lo que se puede imputar. */
  pendiente: number
  /** Etiqueta de "🤖Estado" tal como figura en el tablero. */
  estado: string
  /** La factura ya tiene cobros parciales (estado "Cancelada Parcialmente"). */
  parcial: boolean
}

/**
 * Los dos saldos que la ficha del cliente lee de su CUENTA CORRIENTE, sumando los subelementos de
 * esa cuenta por tipo de movimiento. Son importes, nunca `null`: una cuenta sin movimientos da cero
 * en los dos, que es un dato y no un faltante.
 */
export interface SaldosCliente {
  /** VENTAS PENDS DE CANCELAR: lo que el cliente todavía debe, según su cuenta corriente. */
  pendienteDeCancelar: number
  /** ANTICIPOS PENDS DE APLICAR: el saldo a favor del cliente que todavía no se imputó. */
  anticipos: number
}

/* ===== Cliente ===== */

export type ActividadCliente = 'Activo' | 'Inactivo'
export type SituacionCliente = 'Liberado con crédito' | 'Liberado sin crédito' | 'Bloqueado'

/** Labels de "✋️Cond Pago Habilitadas" (dropdown_mm54yq06) en el board de Personas. */
export type CondicionPago =
  | 'CONTADO'
  | 'CUENTA CORRIENTE'
  | 'PROVEED 45 DIAS'
  | 'PROVEED 90 DIAS'
  | 'PROVEED CONTADO'

export type ListaPrecio = 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6' | 'L7' | 'L8'

/**
 * Cliente al que se le registra el cobro, leído del board de Personas de Monday.
 *
 * Es el MISMO modelo que usa la app de operaciones de venta, campo por campo: las dos leen el
 * mismo tablero, así que cualquier código que se mueva de una a la otra —ficha, buscador,
 * validaciones— calza sin adaptaciones.
 */
export interface Cliente {
  /** ID del ítem en Monday: se usa para linkear y consultar, no se muestra. */
  id: string
  /** Código del cliente en el sistema (columna text_mm542r9d). Es el que se muestra. */
  codigo: string
  name: string
  cuit: string
  /** Persona Física / Persona Jurídica */
  ptype: string
  /** Condición frente al IVA */
  status: string
  /** Lista de precios asignada. null = el cliente no tiene lista definida en el sistema. */
  list: ListaPrecio | null
  /** Retenciones aplicables */
  ret: string
  /** Si es agente, las retenciones se calculan antes de emitir el comprobante. */
  agenteRetencion: boolean
  /**
   * Etiquetas de "✋Categoria" (dropdown_mm54e5ag) de la persona, tal como figuran en el tablero.
   *
   * Es lo que decide para qué operación sirve: Cobros y Pases exigen "Clientes", Pagos exige
   * "Proveedores" (ver `lib/personas`). La columna es MULTI-VALOR, así que viaja la lista entera y
   * no un booleano: una misma persona puede ser "Clientes, Proveedores" y operar por los dos lados.
   */
  categorias: string[]
  /** Condición de pago pactada. null = el cliente no la tiene asignada en el board. */
  condicionPago: CondicionPago | null
  /**
   * "Recibimos CHEQUE" del CRM (color_mm5yb27h). En `false` el cliente NO acepta cheques y el
   * medio queda inhabilitado en el cobro. Sin la columna cargada se asume `true`: la restricción
   * la marca un "NO" explícito, no la ausencia del dato.
   */
  aceptaCheques: boolean
  /** Límite de crédito asignado. */
  limit: number
  /** "🤖Saldo Cta Cte": la deuda real del cliente (ventas − cobros). Es lo que hay para cobrar. */
  saldoCtaCte: number
  /** "Linea Utilizada" de la Cta Cte: saldo + remitos pendientes de facturar. */
  lineaUtilizada: number
  /** "🤖Remito Pends de Facturar": entregado y todavía sin facturar. */
  remitosPendFacturar: number
  /** Crédito disponible: límite − línea utilizada. */
  disponible: number
  /** Dirección fiscal. */
  addr: string
  activity: ActividadCliente
  situation: SituacionCliente
}

/* ===== Registro del cobro ===== */

/**
 * Medios con los que el cliente puede cancelar sus facturas. Es el catálogo del selector del paso 3
 * y la clave de qué datos extra pide cada movimiento. Las retenciones NO se enumeran una por una en
 * la lógica: se reconocen por el prefijo "Retencion" (ver `esRetencion` en `lib/pagos`), así sumar
 * "Retencion SUSS" al catálogo alcanza para que herede su ramal de carga.
 */
export type FormaPago =
  | 'Efectivo'
  /**
   * CHEQUE de papel y CHEQUE ELECTRÓNICO. Son dos medios separados del catálogo —no un cheque con
   * un campo "tipo" al lado— porque el tablero también los separa: cada uno tiene su etiqueta en
   * "✋Caja" y su valor en "🤖Origen Cheque". Elegirlo en el selector deja registrado QUÉ documento
   * es sin un campo extra que pueda quedar en desacuerdo con el medio.
   *
   * Piden EXACTAMENTE los mismos datos y comparten el mismo ramal de carga (ver `esChequeDeCobro`):
   * lo único que cambia entre uno y otro es a qué caja del tablero va el movimiento.
   */
  | 'Cheque'
  | 'Echeq'
  | 'Transferencia'
  | 'Retencion IVA'
  | 'Retencion IIBB'
  | 'Retencion GAN'
  | 'Retencion CCSS'
  | 'Retencion SUSS'
  | 'Tarjeta de débito'
  | 'Tarjeta de crédito'
  /**
   * ANTICIPO. Es el único medio que NO es dinero que entra: absorbe lo que se recibió de más
   * —típicamente un cheque más grande que la deuda— y lo deja como saldo a favor del cliente. Por
   * eso suma del lado de lo CANCELADO y no de lo recibido (ver `resumenCobro`).
   */
  | 'Anticipo'

/** Formato del cheque: papel o electrónico (eCheq). */
export type FormatoCheque = 'FISICO' | 'eCheq'

/**
 * Etiqueta de "🤖Tipo Tarjeta" del recibo. La etiqueta dice marca Y medio —"Visa-Debito",
 * "Master-Credito"—, así que el catálogo que se ofrece depende de la forma de pago (ver
 * `TIPOS_TARJETA_DEBITO` / `TIPOS_TARJETA_CREDITO`).
 *
 * Es `string` y no una unión cerrada porque el catálogo se amplía desde la UI: la etiqueta nueva se
 * crea sola al escribir el subelemento (`create_labels_if_missing`).
 */
export type TarjetaTipo = string

/** Cuenta bancaria PROPIA de La Batea (board de configuración): destino del dinero cobrado. */
export interface CuentaPropia {
  id: string
  name: string
}

/** Un pago concreto del cobro. La forma de pago define qué datos extra pide y cómo se valida. */
export interface MovimientoPago {
  id: string
  formaPago: FormaPago
  importe: number
  /**
   * Cheque y eCheq · FECHA DE PAGO: el día a partir del cual el banco paga el cheque. No puede ser
   * ANTERIOR a hoy (ver `chequeInvalido`); hacia adelante no hay tope, que una fecha de pago lejana
   * es un cheque diferido y no un error.
   *
   * El VENCIMIENTO —treinta días después— no se guarda: se deriva de ésta con `vencimientoDeCheque`
   * cada vez que hace falta. Guardarlo abriría la posibilidad de que las dos fechas dejen de
   * corresponderse, que es exactamente lo que no puede pasar con un dato calculado.
   */
  fechaPagoCheque: string
  /** Cheque: número, fecha de emisión (dd/mm/aaaa) y banco emisor. */
  numeroCheque?: string
  fechaEmisionCheque?: string
  bancoEmisor?: string
  /**
   * Cheque: CUIT del emisor, guardado como los tres tramos separados por guiones ("XX-XXXXXXXX-X").
   * Mientras se carga puede estar incompleto ("20-1234-"): los guiones son fijos, así que el valor
   * siempre se parte en exactamente tres tramos (ver `partesCuit`).
   */
  cuitEmisor?: string
  /**
   * Retenciones (IVA, IIBB, GAN…): año fiscal al que corresponde el certificado, con sus cuatro
   * dígitos, y número del comprobante que lo respalda. Los pide cualquier medio cuyo nombre empiece
   * con "Retencion" (ver `esRetencion`).
   */
  anioRetencion?: string
  nroComprobanteRetencion?: string
  /**
   * Transferencia: número de la operación que figura en el comprobante bancario. Es la referencia
   * con la que se concilia el movimiento contra el extracto, y viaja a la misma columna
   * "🤖Nro Comprobante" que el número del cheque, el del cupón y el del certificado.
   */
  nroComprobanteTransferencia?: string
  /**
   * Cuenta bancaria PROPIA sobre la que impacta el pago, elegida del tablero de configuración: en la
   * transferencia es la cuenta de destino; en la tarjeta, el "Banco de Acreditación".
   */
  cuentaPropia?: string | null
  /**
   * ID del ítem de esa cuenta propia en el tablero de configuración. Es lo que necesitan las
   * columnas de relación del recibo; el nombre sólo sirve para mostrar.
   */
  cuentaPropiaId?: string | null
  /** Nombre del archivo de comprobante adjunto. Obligatorio en transferencia, retenciones y tarjeta. */
  comprobanteNombre?: string
  /**
   * El archivo en sí. Se conserva porque las columnas `file` de Monday sólo se completan subiendo
   * el binario (`add_file_to_column`), no por `column_values`. Vive únicamente en memoria: no se
   * persiste ni viaja en ningún payload JSON.
   */
  comprobanteArchivo?: File | null
  /** Tarjeta (débito/crédito): banco emisor y tipo de tarjeta. */
  bancoTarjeta?: string
  tipoTarjeta?: TarjetaTipo | null
  /** Tarjeta: vencimiento del plástico (dd/mm/aaaa). */
  vencimientoTarjeta?: string
  /** Tarjeta: número de cupón que imprime el posnet. Es la referencia de la acreditación. */
  numeroCupon?: string
}

/**
 * Lo que se cobró y con qué. A diferencia de la app de operaciones de venta, acá NO hay tipo de
 * cobro (simultáneo/posterior) ni deuda a generar: el cobro siempre se registra en el acto contra
 * facturas que ya existen, así que el estado se reduce a la fecha, los movimientos y si quedó
 * confirmado.
 */
export interface CobroState {
  /** Fecha del cobro (dd/MM/yyyy). No se edita: es el día en que se opera. */
  fecha: string
  movimientos: MovimientoPago[]
  /** Se confirma al avanzar de etapa; cualquier cambio en los movimientos lo vuelve a abrir. */
  confirmado: boolean
}

/* ===== Emisión del recibo ===== */

/**
 * En qué anda la emisión, desde el punto de vista de la PANTALLA:
 *
 *   idle      · todavía no se pidió nada.
 *   creando   · se está escribiendo el recibo y sus subelementos en Monday.
 *   emitiendo · el recibo ya está escrito y se le pidió la emisión al tablero; se espera su PDF.
 *   emitido   · el tablero cerró la emisión con éxito.
 *   error     · falló algo (la escritura, la lectura del estado, o el propio tablero).
 *
 * `creando` y `emitiendo` se ven casi igual en pantalla, pero NO son lo mismo: en la primera la
 * app está escribiendo y en la segunda está esperando a Monday. Separarlas es lo que permite decir
 * con precisión qué pasó cuando algo falla.
 */
export type FaseEmision = 'idle' | 'creando' | 'emitiendo' | 'emitido' | 'error'

/** Qué falló en la emisión, cuando falló. */
export interface ErrorEmision {
  /** Estado que se muestra al lado del mensaje: la etiqueta del tablero o el origen del fallo. */
  estado: string
  /** El detalle. Cuando el fallo es una excepción, es el mensaje capturado en el `catch`. */
  mensaje: string
}

/**
 * Estado de la emisión del recibo. Vive en el estado GLOBAL —y no en el hook que la conduce— por la
 * misma razón que `documentoEnviado`: el recibo se emite UNA vez, y esa marca tiene que sobrevivir
 * a la navegación del stepper. Con la fase adentro del componente, volver un paso y regresar la
 * devolvía a `idle` y la pantalla volvía a ofrecer emitir un recibo que ya estaba en Monday.
 */
export interface EmisionRecibo {
  fase: FaseEmision
  /** Etiqueta del estado de emisión que publica el tablero, tal cual: la pantalla no inventa estados. */
  estado: string
  error: ErrorEmision | null
}

/* ===== Envío del recibo ===== */

/** Canal por el que sale el documento. "Ambos" manda por los dos. */
export type MedioEnvio = 'Email' | 'WhatsApp' | 'Ambos'

/** Contacto del cliente, del board de Contactos, al que se le puede enviar el recibo. */
export interface Contacto {
  /** Código del board ("CONTACT-009"): es el que se muestra. */
  id: string
  /** ID del ítem en Monday: el que se linkea como destinatario. */
  itemId?: string
  name: string
  phone: string
  email: string
  ini: string
  color: string
  /** Rótulo del badge: si acepta o no recibir este comprobante. */
  status: string
  /** Declaró en su "Para Enviar" que acepta este comprobante. */
  ok: boolean
}

export type LogTipo = 'ok' | 'err' | 'info'

/** Registro de lo que pasó con el envío. Se muestra como una entrada por resultado. */
export interface LogEntry {
  id: string
  tipo: LogTipo
  titulo: string
  detalle: string
}

/* ===== Anticipos pendientes de aplicar ===== */

/**
 * Un anticipo del cliente que todavía tiene saldo a favor, leído de "Anticipos Pends de Aplicar"
 * (18426066447). Es la unidad que se elige en el paso 3 del recorrido "Aplicar Anticipo contra
 * Facturas": su saldo se imputa a las facturas seleccionadas en el paso 2.
 */
export interface AnticipoPendiente {
  /** ID del ítem en Monday: es la clave de la aplicación y lo que se linkea al recibo. */
  id: string
  /**
   * Nombre del ítem ("Anticipo - RECIBO-043"). Es lo que IDENTIFICA al anticipo en pantalla: los
   * tableros no publican el número del comprobante con el que entró en ninguna columna de texto, y
   * su "🤖ID Anticipo" es un `item_id` cuyo valor por API es el id crudo, no el código con prefijo
   * que se ve en Monday.
   */
  nombre: string
  /** "Fecha de Anticipo" (date_mm64k479), en ISO (yyyy-MM-dd). */
  fecha: string
  /** "Importe $" (numeric_mm64h18): con cuánto nació el anticipo. */
  importe: number
  /**
   * "Pend de Aplicar" (formula_mm641qex): el saldo que todavía tiene a favor. Es el TOPE de lo que
   * se le puede imputar a las facturas.
   */
  pendiente: number
  /** "🤖Detalle" (long_text_mm659q6c): por qué se registró. */
  comentario: string
}

/* ===== MÓDULO DE PAGOS ===== */

/**
 * Etapas del módulo de PAGOS. Son suyas y de nadie más: Cobros tiene su propio `Paso` y los dos
 * recorridos no comparten ni pantallas ni estado de trabajo.
 *
 *   · proveedor      · qué se paga y a quién. Es donde se valida la condición de pago.
 *   · facturasCompra · qué facturas de compra se cancelan y por cuánto.
 *   · pago           · con qué cajas se paga. Cierra cuando la diferencia llega a 0.
 *   · orden          · se emite la ORDEN DE PAGO y se la envía al proveedor. Cierra la operación.
 */
export type PasoPago = 'proveedor' | 'facturasCompra' | 'pago' | 'orden'

/**
 * Qué se está pagando. Es lo primero que se elige —antes incluso que el proveedor— porque decide el
 * recorrido del módulo (ver `lib/pasosPago`):
 *
 *   · facturasCompra · se cancelan facturas de compra que ya están pendientes en el tablero.
 *                      Recorrido completo, de cuatro etapas.
 *   · anticipo       · se le entrega dinero A CUENTA al proveedor, sin facturas que imputar: la
 *                      etapa de facturas pendientes no existe y lo que se cancela es el importe del
 *                      propio anticipo.
 *   · aplicacion     · se aplica el saldo a favor de anticipos YA entregados contra facturas de
 *                      compra pendientes. Recorre las mismas cuatro etapas que el pago; lo que
 *                      cambia es la etapa 3, donde el dinero sale de los anticipos y no de una caja.
 *
 * Es el espejo de `TipoOperacion` del lado de los cobros, con sus mismos tres recorridos.
 */
export type TipoOperacionPago = 'facturasCompra' | 'anticipo' | 'aplicacion'

/**
 * Proveedor al que se le registra el pago. Es EXACTAMENTE el mismo modelo que el cliente —las dos
 * salen del board de Personas (18420688238), campo por campo—, con un solo dato de más: si tiene
 * cuenta corriente asignada, que es lo que decide si se le puede cancelar una factura en cuenta
 * corriente (ver `proveedorSinCtaCte`).
 *
 * Lo que los distingue en el tablero es su "✋Categoria": "Clientes" para uno, "Proveedores" para
 * el otro. Por eso la ficha, el buscador y las validaciones se reusan tal cual.
 */
export interface Proveedor extends Cliente {
  /**
   * El proveedor tiene su cuenta corriente conectada en "💵Cta Cte" (board_relation_mm5ep5qd), que
   * es la misma columna que el tablero de facturas de compra espeja como "🤖Cta Cte Prov".
   */
  tieneCtaCte: boolean
}

/**
 * Una factura de compra que quedó debiendo, leída de "❓ Facturas Compra Pend de Pago"
 * (18425512701). Es la unidad que se elige en la etapa 2 y sobre la que se imputa el pago.
 *
 * Es el espejo de `FacturaPendiente`: lo que allá se cobra, acá se paga. Los nombres siguen esa
 * lectura —`pagado` en vez de `cobrado`— y la etapa 2 la adapta a la forma que consumen la tabla y
 * el panel de imputación, que son los MISMOS componentes del paso 2 de Cobros.
 */
export interface FacturaCompraPendiente {
  /** ID del ítem en Monday: es la clave de la imputación. */
  id: string
  /**
   * Cómo se identifica la fila: el ID de la factura de compra vinculada por "🗒️ Facturas Compras"
   * (board_relation_mm5zr9h1). Vacío cuando el ítem no la tiene conectada, y ahí queda el nombre
   * del propio ítem: siempre hay algo que mostrar.
   */
  nro: string
  /** "🤖Fecha Venc" (date_mm6khfkk), en ISO (yyyy-MM-dd). De acá salen los días de mora. */
  vencimiento: string
  /** "🤖$ Total a pagar" (numeric_mm5zv7w0): el importe original de la factura. */
  total: number
  /** "🤖Pagado $" (lookup_mm60vp5b): lo ya pagado históricamente. */
  pagado: number
  /** Qué proporción de la factura ya está pagada (0-100). Se calcula: no hay columna que lo diga. */
  pagadoPct: number
  /** "🤖Pend de Pagar $" (formula_mm60t0z9): el saldo que queda. Es el TOPE de lo que se imputa. */
  pendiente: number
  /**
   * "🤖Importe Neto" (numeric_mm6mc30f) de la factura de compra VINCULADA por
   * `board_relation_mm5zr9h1`. Es la base con la que se calcula la retención de Ganancias, y por eso
   * viaja con la factura aunque NO se muestre en ninguna pantalla.
   *
   * `null` = no se pudo leer: la factura no tiene su comprobante conectado, el ítem conectado no es
   * del tablero de facturas de compra, o la columna está vacía. En los tres casos la retención no se
   * puede calcular y hay que decirlo (ver `MSG_SIN_IMPORTE_NETO`), en vez de tomar un cero que daría
   * una base imponible falsa.
   */
  importeNeto: number | null
  /**
   * TOTAL de la factura de compra VINCULADA, leído de su propio tablero. Tiene que coincidir con
   * `total`: son el mismo importe visto desde dos lados, y una diferencia significa que uno de los
   * dos está mal cargado —lo que haría que el prorrateo de la retención se calcule sobre una
   * proporción falsa—.
   *
   * `null` = no se pudo leer, y entonces NO se compara: hoy es el caso normal, porque falta
   * configurar el id de esa columna (ver `COL.factCompraDoc.total`).
   */
  totalFactura: number | null
  /** Etiqueta de "🤖Estado de Facturacion" (color_mm5z52bk), tal como figura en el tablero. */
  estado: string
  /** La factura ya tiene pagos parciales. */
  parcial: boolean
}

/**
 * Cajas con las que se le paga a un proveedor: es el catálogo del selector "Seleccionar Caja" de la
 * etapa 3 y la clave de qué datos extra pide cada movimiento.
 *
 * NO son las `FormaPago` del cobro: acá el dinero SALE, así que no hay retenciones que recibir ni
 * anticipos que dejar a favor. Los rótulos son los del tablero de cajas, tal cual.
 */
export type CajaPago =
  | 'Cheque'
  | 'Transferencia'
  | 'Efectivo'
  /**
   * RETENCIÓN DEL IMPUESTO A LAS GANANCIAS. No es dinero que sale de una caja: es impuesto que se
   * le retiene al proveedor y que después se ingresa al fisco. Cuenta igual que las demás del lado
   * de lo ENTREGADO —cancela deuda con el proveedor—, y su importe NO lo escribe el usuario: se
   * calcula solo (ver `calcularRetencionGAN`).
   */
  | 'Retencion GAN'
  /**
   * ANTICIPO. Es el único que NO es dinero que sale: absorbe lo que se entregó DE MÁS —típicamente
   * un cheque más grande que la deuda, que no se puede partir— y lo deja como saldo a favor NUESTRO
   * con el proveedor.
   *
   * Por eso suma del lado de lo CANCELADO y no de lo entregado (ver `resumenPago`), exactamente
   * como el anticipo del cobro: el dinero ya está contado en el cheque que lo produjo, y contarlo
   * dos veces duplicaría el pago.
   */
  | 'Anticipo'

/**
 * Con qué cheque se paga. Son dos caminos distintos y excluyentes:
 *
 *   · cartera · se endosan cheques que YA están en cartera ("🧾Cheques/eCheq en Cartera",
 *               18425237398), de los que quedan en estado "Pendiente". Se pueden elegir VARIOS, y
 *               cada uno entra como una caja registrada con SU importe.
 *   · nuevo   · se libra un cheque PROPIO, que todavía no existe en ningún tablero y por eso se
 *               carga a mano.
 *
 * Nace SIN elegir: es una decisión del usuario y ninguna de las dos es más probable que la otra, así
 * que preseleccionar una sería decidir por él. Por eso el campo es opcional en el movimiento.
 */
export type ModalidadCheque = 'cartera' | 'nuevo'

/**
 * Un cheque de terceros disponible en cartera, leído de "🧾Cheques/eCheq en Cartera" (18425237398).
 * Sólo llegan los que están en estado "Pendiente": el resto ya se usó.
 */
export interface ChequeEnCartera {
  /** ID del ítem en Monday: es lo que se linkea al pago. */
  id: string
  /** "🤖ID Cheque" (pulse_id_mm67jmq2): el código que ve el usuario ("CHEQUE-07"). */
  codigo: string
  /** "🤖Número de Cheque" (text_mm5y2nqc). */
  numero: string
  /** "🤖Monto" (numeric_mm5yxq0): con cuánto se puede pagar. */
  importe: number
  /** "🤖Fecha de Vencimiento" y "🤖Fecha de Emisión" (date), en ISO (yyyy-MM-dd). */
  vencimiento: string
  emision: string
  /** "🤖Fecha de Pago" (date_mm6vr6g5), en ISO: desde cuándo el banco lo paga. */
  fechaPago: string
  /** "🤖Banco Emisor" (dropdown_mm5zgtbe). */
  banco: string
  /** "🤖CUIT Emisor" (text_mm5ye31b), con sus guiones. */
  cuitEmisor: string
  /** "🤖Tipo de Cheque" (dropdown_mm5ye3k3): papel o electrónico. */
  tipo: string
  /**
   * Etiqueta de "🤖Estado del Cheque" (color_mm5y74q2). Qué valor trae depende de qué lista lo
   * cargó: "Pendiente" en la cartera del formulario de pago, "100% Usado" en la del rechazo.
   */
  estado: string
  /**
   * "🤖ID Recibo" del recibo con el que el cheque ENTRÓ ("RECIBO-078"), y "🤖ID Orden de Pago" de
   * la orden con la que SALIÓ ("IDPAGO-012").
   *
   * Ninguno de los dos está en el ítem del cheque: el cheque conoce los SUBELEMENTOS —una línea del
   * recibo y una de la orden— y el código vive en el ítem PADRE de cada uno (ver
   * `getChequesDeCliente`). Se traen resueltos para que la tabla no tenga que saber nada de esa
   * cadena.
   *
   * Vacío cuando el cheque todavía no pasó por ese lado, o cuando la consulta no los pidió: la
   * cartera del formulario de pago no los usa, así que ahí llegan en `''` y no se muestran.
   */
  idRecibo: string
  idPago: string
}

/**
 * Un pago concreto de la operación: con qué caja sale el dinero y por cuánto. La caja define qué
 * datos extra pide (ver `FormularioPago`).
 */
export interface MovimientoCaja {
  id: string
  /** La caja elegida. Se llama `formaPago` para que la tabla de movimientos se reuse tal cual. */
  formaPago: CajaPago
  importe: number
  /* --- Cheque --- */
  /** De dónde sale el cheque: de la cartera o de un cheque propio que se libra ahora. */
  modalidadCheque?: ModalidadCheque
  /**
   * Cartera: el ítem del tablero de cheques que se endosa. Un movimiento = UN cheque, aunque se
   * elijan varios de una vez: cada uno tiene su importe y su vencimiento, así que juntarlos en una
   * sola línea perdería de qué papel salió cada peso.
   */
  chequeId?: string
  /**
   * Cheque NUEVO: la cuenta PROPIA contra la que se libra, del tablero de configuración. Se guardan
   * el id —que es lo que necesita la relación del subelemento— y el nombre, que es lo que se
   * muestra.
   *
   * Un cheque de CARTERA no la lleva: lo libró un tercero contra SU banco, y ese nombre viaja en
   * `bancoEmisor` como texto.
   */
  bancoEmisorId?: string | null
  /** Cheque (de cartera o emitido): los datos que identifican al documento. */
  numeroCheque?: string
  chequeVencimiento?: string
  fechaEmisionCheque?: string
  bancoEmisor?: string
  cuitEmisor?: string
  /**
   * Papel o electrónico. Alimenta "🤖Origen Cheque" del subelemento de la orden, que es la misma
   * distinción que el recibo escribe en SU columna homónima. Acá es un CAMPO del movimiento porque
   * el pago tiene una sola caja "Cheque"; en el cobro son dos medios separados del catálogo
   * ("Cheque" y "Echeq") y el formato se deriva de cuál se eligió (ver `formatoDeCheque`).
   *
   * En un cheque de CARTERA sale del tablero ("🤖Tipo de Cheque"); en uno NUEVO queda sin definir,
   * porque el formulario todavía no lo pregunta, y entonces la columna se OMITE en vez de asumir
   * un formato que nadie declaró.
   */
  formatoCheque?: FormatoCheque
  /**
   * "Fecha de Pago" del cheque: el día a partir del cual el banco lo paga. Es la que el usuario
   * carga —en un diferido, la del diferimiento—, y de ella se DERIVA el vencimiento sumándole 30
   * días (ver `vencimientoDeCajaCheque`).
   *
   * Sólo la lleva el cheque NUEVO, que es el único que se declara con el formulario. El de CARTERA
   * viene del tablero con su vencimiento ya cargado (`chequeVencimiento`).
   */
  fechaPagoCheque?: string
  /* --- Transferencia --- */
  /**
   * "Nro de Transferencia": el identificador que da el banco. Es lo que distingue una transferencia
   * de otra, y por eso es también con lo que se detecta que la misma se cargó dos veces.
   */
  nroComprobanteTransferencia?: string
  /** Banco de ORIGEN: la cuenta propia desde la que sale la transferencia. Obligatorio. */
  bancoOrigen?: string | null
  /** ID del ítem de esa cuenta en el tablero de configuración, que es lo que linkea el pago. */
  bancoOrigenId?: string | null
  /* --- Retención de Ganancias ---
     Los dos números con los que se llegó al importe. NO se escriben en el tablero —el subelemento
     de la orden no tiene columnas para ellos— pero se guardan igual: son la única forma de explicar
     de dónde salió el monto retenido cuando alguien lo revise en la tabla de cajas registradas. */
  /** Base imponible sobre la que se aplicó la alícuota. */
  baseImponible?: number
  /** Alícuota aplicada, en porcentaje (35 = 35%). */
  alicuota?: number
  /** La base NO imponible se descontó en este cálculo (es el primer pago del mes al proveedor). */
  baseNoImponibleAplicada?: number
  /**
   * Id de la fila de "⚙️Configuracion - Sistema" con la que se calculó. A diferencia de los otros
   * tres, éste SÍ se escribe en el tablero: la línea de la retención lo linkea, y así queda
   * asentado con qué parámetros se practicó.
   */
  configRetencionId?: string | null
}

/**
 * Lo que se pagó y con qué. Espejo de `CobroState`: la fecha es la del día en que se opera, los
 * movimientos son las cajas cargadas y `confirmado` se cierra al terminar la operación.
 */
export interface PagoState {
  /** Fecha del pago (dd/MM/yyyy). No se edita: es el día en que se opera. */
  fecha: string
  movimientos: MovimientoCaja[]
  /** Se confirma al cerrar la operación; cualquier cambio en los movimientos lo vuelve a abrir. */
  confirmado: boolean
}

/* ===== MÓDULO DE RESUMEN DE CTA CTE ===== */

/**
 * Si el resumen va acompañado del ESTADO de la cuenta corriente. Se declara en el paso 1, en el
 * mismo formulario en el que se elige qué movimientos entran, y es obligatorio: sin él no se avanza.
 */
export type EstadoCtaCteResumen = 'INCLUIR' | 'NO_INCLUIR'

/**
 * El período que abarca el resumen, contado hacia atrás desde HOY. La clave es la que viaja por el
 * estado; los días y el rótulo salen de `lib/resumenCtaCte`.
 */
export type RangoResumen = 'ultimos15' | 'ultimos30' | 'ultimos45' | 'ultimos60' | 'ultimoAnio'

/** Las dos puntas de un período, en ISO (yyyy-MM-dd) y AMBAS inclusive. */
export interface PeriodoResumen {
  desde: string
  hasta: string
}

/**
 * Con qué se eligen los movimientos que entran en el resumen. Son DOS filtros independientes que se
 * pueden usar sueltos o juntos, y cuando van juntos se CRUZAN (ver `periodoDelCriterio`):
 *
 *   · `rango` · una ventana contada hacia atrás desde hoy ("Últimos 30 días").
 *   · `desde` / `hasta` · fechas concretas, en ISO. Vacías = esa punta no acota nada.
 *
 * Así se puede pedir "el último año, pero del 01/01/2025 al 01/07/2025": el rango pone el techo de
 * antigüedad y las fechas recortan dentro de él.
 */
export interface CriterioResumen {
  rango: RangoResumen | null
  desde: string
  hasta: string
}

/**
 * En qué formato se genera el archivo del resumen. Obligatorio antes de emitir. "Ambos" genera los
 * dos archivos: en el tablero son las dos etiquetas a la vez.
 */
export type FormatoResumen = 'Excel' | 'PDF' | 'Ambos'

/**
 * Un movimiento de la cuenta corriente del cliente: un SUBELEMENTO de su ítem en "💵Cta Cte Cliente"
 * (18421858736). Es SÓLO lectura: la app no escribe ni edita ninguno.
 */
export interface MovimientoCtaCte {
  /** ID del subelemento en Monday. Sólo sirve de clave de la fila: no se muestra ni se linkea. */
  id: string
  /**
   * Cómo se identifica el comprobante en el resumen. Depende de la clase de movimiento (ver
   * `comprobanteDeMovimiento`): "VTA-111" en una venta, "RECIBO-072" en un cobro, "Pago por
   * Anticipo - ANTICIPO-020" en un anticipo, "Saldo Inicial"…
   */
  comprobante: string
  /** Etiqueta de "🤖Movimiento" tal como figura en el tablero ("Cobro", "Vta Pend de Cobro"…). */
  tipo: string
  /** "🤖Fecha Emision" (date_mm76y2xw) del movimiento, en ISO. Vacío si el tablero no la tiene. */
  emision: string
  /**
   * "🤖Fecha Vto" (date_mm647vwr) de la factura conectada, en ISO. SÓLO lo lleva la venta pendiente
   * de cobro: los demás movimientos no vencen, así que para ellos queda vacío.
   */
  vencimiento: string
  /** "🤖Saldo Inicial": con cuánto venía la cuenta antes de este movimiento. */
  saldoInicial: number
  /** "🤖Ventas": lo que el movimiento suma a la cuenta. */
  ventas: number
  /** "🤖Cobros": lo que el movimiento resta de la cuenta. */
  cobros: number
  /** "🤖Saldo Final": cómo queda la cuenta después del movimiento. */
  saldoFinal: number
  /** El movimiento es una venta pendiente de cobro, con su factura conectada. */
  esVentaPendiente: boolean
}

/**
 * Una factura que el cliente todavía debe: lo que lista el documento "Estado de Cta Cte" del RESUMEN.
 * Sale de "💰Fact Vtas Pends de Cobro" (18421035508): las del cliente que NO están "Cancelada 100%".
 * Es SÓLO lectura.
 */
export interface FacturaAdeudada {
  /** ID del ítem en Monday. Sólo es la clave de la fila. */
  id: string
  /** Número del comprobante: hoy el "VTA-XXX" del nombre del ítem. */
  comprobante: string
  /** Etiqueta de "🤖Estado de Cobro" (color_mkwb727e), tal cual: "Pend de Cancelar 100%"… */
  estadoCobro: string
  /** "🤖Fecha Emision" (date_mm648d33), ISO. Vacío si no está cargada. */
  emision: string
  /** "🤖Fecha Vto" (date_mm647vwr), ISO. Vacío si no está cargada. */
  vencimiento: string
  /** "🤖Vta $" (numeric_mkwbck5d): el importe de la factura. */
  importe: number
  /** "🤖Cobrado $" (lookup_mm4c3vc8): la SUMA de lo cobrado en sus subelementos. */
  cobrado: number
  /** "🤖Pend de Cobrar $" (formula_mkwbrnk1): lo que queda por pagar. */
  pendiente: number
  /** Etiqueta de "🤖Estado de Vencimiento" (color_mm6symyx), tal cual. Vacío si no tiene. */
  estadoVencimiento: string
  /**
   * Qué tan grave es ese estado, para colorearlo: `ok` no vencida, `alerta` vencida hace menos de 30
   * días, `vencida` 30 días o más. `null` sin estado.
   */
  tonoVencimiento: 'ok' | 'alerta' | 'vencida' | null
  /**
   * En cuál de los CINCO tramos de vencimiento cae, resuelto por el ÍNDICE de la columna y no por su
   * texto (ver `ESTADO_VENCIMIENTO_INDEX`). `null` = el tablero todavía no le puso el estado.
   *
   * Es más fino que `tonoVencimiento` —que agrupa de a dos— y es con lo que el documento "Estado de
   * Cta Cte" pinta cada fila con el color de su etiqueta.
   */
  tramo: TramoVencimiento | null
}

/** Lo que devuelve la lectura de la cuenta para un cliente y un período. */
export interface MovimientosDelPeriodo {
  /**
   * ID del ítem de la cuenta corriente asignada al cliente. Es sobre ESE ítem que después se pide el
   * resumen. `null` = el cliente no tiene cuenta corriente asignada en el tablero de Personas.
   */
  ctaCteId: string | null
  /** Movimientos del período, en el orden de la cuenta. */
  movimientos: MovimientoCtaCte[]
  /**
   * Movimientos de la cuenta que NO se pudieron ubicar en ningún período porque no tienen su fecha de
   * emisión cargada. No entran en la lista —no hay cómo saber si caen dentro del rango—, y se cuentan
   * para poder decirlo en pantalla en vez de omitirlos en silencio.
   */
  sinFecha: number
  /**
   * "🤖Remito Pends de Facturar" (numeric_mm5f2npa) del ítem de la cuenta: la mercadería entregada
   * y todavía sin facturar. No depende del período: es lo que la cuenta tiene hoy. 0 sin cuenta.
   */
  mercaderiaPendFacturar: number
}

/* ===== MÓDULO DE GESTIÓN DE COBRANZA ===== */

/**
 * En qué estado está el saldo de una cuenta corriente, según "🤖 Estado del Saldo"
 * (`formula_mm6sr4rn`) de "💵Cta Cte Cliente" (18421858736). Es el PRIMER criterio de búsqueda del
 * tablero de cobranza:
 *
 *   · aCobrar · la cuenta tiene saldo deudor: el cliente nos debe. Es el caso que se reclama.
 *   · cero    · la cuenta está en cero: no debe ni tiene saldo a favor.
 *   · aFavor  · la cuenta tiene saldo a favor del cliente (anticipos sin aplicar).
 *
 * La clave es la que viaja por el estado; la ETIQUETA con la que se la compara contra el tablero
 * vive en `lib/cobranza`, junto con el resto de las reglas.
 */
export type EstadoSaldo = 'aCobrar' | 'cero' | 'aFavor'

/**
 * Qué tan vencida está una factura, según "🤖Estado de Vencimiento" (`color_mm6symyx`) de
 * "💰Fact Vtas Pends de Cobro" (18421035508). Es el SEGUNDO criterio de búsqueda: los tramos que
 * el usuario elige son los que la consulta le pide al tablero.
 *
 * Son las cinco etiquetas de esa columna y en ORDEN DE GRAVEDAD, que no es el de sus índices (ver
 * `ESTADO_VENCIMIENTO_INDEX`): acá el orden es el que se lee en pantalla, de lo que todavía no
 * venció a lo que lleva más de sesenta días.
 */
export type TramoVencimiento =
  | 'noVencido'
  | 'vencido0a15'
  | 'vencido15a30'
  | 'vencido30a60'
  | 'vencidoMas60'

/**
 * Los dos criterios con los que se busca. Viajan juntos porque juntos definen QUÉ hay en pantalla:
 * el resultado que se muestra es el de ESTE par y de ningún otro (ver `claveCobranza`).
 *
 * Las dos listas son MULTI-VALOR: el usuario puede pedir varias opciones a la vez, y ninguna de las
 * dos puede quedar vacía —sin un estado de saldo no hay cuentas que traer, y sin un tramo no hay
 * facturas que listar—.
 */
export interface CriterioCobranza {
  /** Estados de "🤖 Estado del Saldo" que se piden. */
  estados: readonly EstadoSaldo[]
  /** Tramos de "🤖Estado de Vencimiento" que se piden. */
  tramos: readonly TramoVencimiento[]
}

/**
 * Una cuenta corriente de cliente alcanzada por el primer criterio: un ítem de "💵Cta Cte Cliente"
 * (18421858736). Es SÓLO lectura, como todo el módulo.
 */
export interface CuentaCobranza {
  /** ID del ítem de la cuenta en Monday. Es la clave de la fila. */
  id: string
  /** "🤖ID Cta Cte" (`pulse_id_mm63y3d3`): el número con el que se nombra la cuenta. */
  nro: string
  /**
   * ID del cliente conectado en "🤖Personas" (`board_relation_mm58dyn`). Es con el que se piden sus
   * facturas. Vacío = la cuenta no tiene cliente conectado, así que no hay facturas que buscarle.
   */
  clienteId: string
  /** Razón social del cliente conectado, o el nombre del ítem de la cuenta si no hay ninguno. */
  cliente: string
  /** Código del cliente en el sistema (`text_mm542r9d`). Vacío si no está cargado. */
  codigo: string
  /** Etiqueta de "🤖 Estado del Saldo" tal como la publica el tablero. */
  estadoSaldoLabel: string
  /** A qué opción del filtro corresponde esa etiqueta. `null` = a ninguna de las tres. */
  estadoSaldo: EstadoSaldo | null
  /** "Fact Vent pend de Aplciar" (`numeric_mm677127`): lo que la cuenta declara como deuda. */
  ventasPendCancelar: number
  /** "Anticipo pend de Aplicar" (`numeric_mm67j0rv`): el saldo a favor sin aplicar. */
  anticipos: number
  /** "🤖Limite de credito" (`lookup_mm585jgv`) espejado en la cuenta. 0 = sin límite asignado. */
  limite: number
  /** "🤖Linea Utilizada" (`formula_mm5es5xz`): deuda + mercadería entregada y sin facturar. */
  lineaUtilizada: number
  /** "🤖Remito Pends de Facturar" (`numeric_mm5f2npa`): entregado y todavía sin facturar. */
  mercaderiaPendFacturar: number
}

/**
 * Una factura de venta pendiente traída por el segundo criterio. Es la MISMA forma que la factura
 * adeudada del RESUMEN DE CTA CTE —sale del mismo tablero y con las mismas columnas—, más el cliente
 * al que pertenece: acá las facturas de todas las cuentas llegan en una sola lista y hay que poder
 * repartirlas.
 */
export interface FacturaCobranza extends FacturaAdeudada {
  /** ID del cliente conectado en "🤖Personas" (`board_relation_mm5zaxck`). */
  clienteId: string
}

/** Lo que devuelve una búsqueda del tablero de cobranza. */
export interface ResultadoCobranza {
  /** Las cuentas que cumplen el criterio de saldo. */
  cuentas: CuentaCobranza[]
  /** Las facturas de esas cuentas que cumplen el criterio de vencimiento. */
  facturas: FacturaCobranza[]
  /**
   * Cuentas alcanzadas por el filtro que NO tienen cliente conectado. No entran en el listado —sin
   * cliente no hay facturas que pedirles— y se CUENTAN para poder decirlo en pantalla en vez de
   * omitirlas en silencio, con el mismo criterio que los movimientos sin fecha del resumen.
   */
  sinCliente: number
  /** Cuántas cuentas leyó el tablero antes de filtrar. Es el denominador de "N de M cuentas". */
  totalLeidas: number
}
