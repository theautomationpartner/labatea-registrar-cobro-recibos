/** Modelo de dominio. La capa de servicio (Monday) debe devolver exactamente estas formas. */

/**
 * Módulo de la app, elegido en el ENCABEZADO. Son dos operaciones INDEPENDIENTES entre sí: no
 * comparten etapas, ni pantallas, ni estado de trabajo.
 *
 *   · COBROS · se le cobra a un cliente y se le emite el recibo. Es el módulo por defecto, y el
 *              único que además pregunta QUÉ se cobra (ver `TipoOperacion`).
 *   · PASES  · el saldo a favor de un cliente se mueve a la cuenta de otro. Circuito propio de
 *              tres etapas: no emite recibo ni pregunta qué se cobra.
 *   · PAGOS  · circuito propio, TODAVÍA SIN DEFINIR: sus etapas y sus pantallas no son las de
 *              cobros y se especificarán aparte. Sólo lo puede elegir un administrador (ver
 *              `lib/permisos`).
 *
 * Elegir uno cambia la app entera, no una parte: por eso el ruteo de más alto nivel mira ESTE valor
 * antes que el paso (ver `App`), y cambiarlo descarta lo que se venía cargando en el anterior.
 */
export type OperacionApp = 'COBROS' | 'PASES' | 'PAGOS'

/**
 * Etapas del módulo de COBROS. Son suyas y de nadie más: PAGOS es una operación independiente y
 * definirá su propio recorrido cuando se especifique, sin reusar estas claves.
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
export type TipoOperacion = 'cobro' | 'anticipo' | 'aplicacion' | 'pases'

/*
 * `pases` NO se elige en ese selector: es el recorrido del MÓDULO "Pases de Saldo", y lo pone el
 * propio cambio de módulo (ver `setOperacionApp`). Vive en esta unión porque el recorrido, las
 * etiquetas y el stepper se resuelven todos por `TipoOperacion`: darle una vía aparte habría
 * significado dos formas distintas de contestar "¿en qué etapa estoy?".
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
   * "🤖Fecha Emision Fact" de la venta vinculada, en ISO (yyyy-MM-dd). Vacío si no hay venta
   * conectada o si el tablero todavía no cargó la fecha. Es la fecha de emisión que el recibo
   * declara para cada comprobante cancelado.
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
  | 'Cheque'
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
  /** Sólo cheque: no puede vencer después del día de hoy (ver `chequeInvalido`). */
  chequeVencimiento: string
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
  /** Cheque: formato del documento, físico o electrónico (eCheq). */
  formatoCheque?: FormatoCheque
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
  /** Nombre del ítem ("Anticipo - REC1001"). */
  nombre: string
  /** "Recibo y Cobro" (text_mm64bf3r): el comprobante con el que entró el anticipo. */
  recibo: string
  /** "Fecha de Anticipo" (date_mm64k479), en ISO (yyyy-MM-dd). */
  fecha: string
  /** "Importe $" (numeric_mm64h18): con cuánto nació el anticipo. */
  importe: number
  /**
   * "Pend de Aplicar" (formula_mm641qex): el saldo que todavía tiene a favor. Es el TOPE de lo que
   * se le puede imputar a las facturas.
   */
  pendiente: number
  /** "Comentarios" (text_mm64a1zb): por qué se registró. */
  comentario: string
}
