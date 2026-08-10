/** Modelo de dominio. La capa de servicio (Monday) debe devolver exactamente estas formas. */

/**
 * Etapas de la app. A diferencia de "Operaciones de venta", acá hay UN SOLO recorrido —registrar
 * un cobro y emitir su recibo—, así que no existe un paso previo de elección de operación: la app
 * arranca directamente en la selección de cliente.
 */
export type Paso = 'cliente' | 'ventas' | 'cobro' | 'recibo'

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
  | 'Tarjeta de débito'
  | 'Tarjeta de crédito'

/** Formato del cheque: papel o electrónico (eCheq). */
export type FormatoCheque = 'FISICO' | 'eCheq'

/**
 * Etiqueta de "🤖Tipo Tarjeta" del recibo (VISA, MASTERCARD…). Es `string` y no una unión cerrada
 * porque el catálogo se amplía desde la UI: la etiqueta nueva se crea sola al escribir el
 * subelemento (`create_labels_if_missing`).
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
  /** Tarjeta (débito/crédito): banco emisor y tipo de tarjeta; las cuotas sólo aplican al crédito. */
  bancoTarjeta?: string
  tipoTarjeta?: TarjetaTipo | null
  cuotas?: number
  /** Tarjeta: los 16 dígitos del número, SIN los espacios del agrupado visual. */
  numeroTarjeta?: string
  /** Tarjeta: nombre del titular y vencimiento del plástico (dd/mm/aaaa). */
  titularTarjeta?: string
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
