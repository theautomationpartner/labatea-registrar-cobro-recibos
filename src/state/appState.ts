import { claveCobranza, CRITERIO_INICIAL, criterioCompleto } from '@/lib/cobranza'
import { ladoInicialDePase, puedeOperar, puedePasarEntre } from '@/lib/permisos'
import { hoy } from '@/lib/dates'
import { totalACancelar, totalAplicado } from '@/lib/cobros'
import { round2 } from '@/lib/format'
import { indiceDePaso, pasosDe } from '@/lib/pasos'
import { descontarRetencion, esCajaCheque, esRetencionGAN } from '@/lib/pagosProveedor'
import type { RolPersona } from '@/lib/personas'
import { indiceDePasoPago } from '@/lib/pasosPago'
import type {
  AnticipoPendiente,
  ChequeEnCartera,
  Cliente,
  CriterioCobranza,
  OperacionApp,
  CobroState,
  Contacto,
  EmisionRecibo,
  EstadoCtaCteResumen,
  EstadoSaldo,
  FacturaAdeudada,
  FacturaCompraPendiente,
  FacturaPendiente,
  FormatoResumen,
  LogEntry,
  MedioEnvio,
  MovimientoCaja,
  MovimientoCtaCte,
  MovimientoPago,
  MovimientosDelPeriodo,
  PagoState,
  Paso,
  PasoPago,
  Proveedor,
  RangoResumen,
  ResultadoCobranza,
  SaldosCliente,
  TipoOperacion,
  TipoOperacionPago,
  TramoVencimiento,
  Usuario,
  UsuarioActual,
} from '@/types'

export interface AppState {
  /**
   * Módulo elegido en el encabezado. "Pagos" sólo lo puede elegir un administrador (ver
   * `puedeOperarPagos`) y tiene circuito propio: su etapa vive en `pasoPago`, no acá.
   */
  /**
   * Módulo en curso, o `null` mientras no se eligió ninguno. Arranca SIN elegir: la app abre en su
   * paso inicial y no dentro de Cobros, así que el selector nace vacío y el usuario declara qué va
   * a hacer antes de que se dibuje una sola etapa.
   */
  operacionApp: OperacionApp | null
  /**
   * La operación quedó CONFIRMADA y el circuito está abierto. En `false` se dibuja el paso inicial
   * —los dos selectores y el botón "Confirmar"— y nada más.
   *
   * Es un dato aparte del módulo, y no `operacionApp !== null`, porque en el paso inicial el módulo
   * ya está elegido mientras se mira el botón: lo que falta es el clic que abre el circuito.
   */
  operacionConfirmada: boolean
  /** Etapa en pantalla. La app arranca en la selección de cliente: no hay paso previo. */
  paso: Paso
  /**
   * Qué se está registrando (cobro, anticipo o aplicación de anticipo). Es lo que RAMIFICA el
   * recorrido —ver `lib/pasos`— y el tipo con el que nace el recibo en Monday. null = el usuario
   * todavía no lo eligió, y por eso no se lo deja salir del paso 1.
   */
  tipoOperacion: TipoOperacion | null
  /**
   * Sólo ANTICIPO: el importe que se entrega a cuenta. Ocupa el lugar que en un cobro o un pago
   * contra facturas tiene la suma de lo imputado: es el TOTAL A CANCELAR que las formas de pago —o
   * las cajas— tienen que igualar, y el que va al subelemento "Anticipo" del documento.
   *
   * Los TRES campos los comparten los dos módulos: el anticipo se declara igual se cobre o se
   * pague, y sólo cambia de qué lado del mostrador está. Nunca conviven, porque cambiar de módulo
   * vuelve el estado a foja cero (ver `setOperacionApp`).
   */
  importeAnticipo: number
  /** Anticipo: por qué se registra. Lo escribe el usuario y viaja al documento. */
  detalleAnticipo: string
  /** Anticipo: fecha de vencimiento, en dd/MM/yyyy (el formato del ERP). */
  vencimientoAnticipo: string
  /**
   * Índice del paso MÁS AVANZADO alcanzado en la operación en curso: hasta ahí se puede navegar
   * con el stepper (los pasos futuros quedan bloqueados). Se reinicia al empezar una operación nueva.
   */
  pasoMaxIdx: number
  /** Usuario responsable del cobro. Por defecto, el logueado en Monday. */
  usuario: Usuario | null
  /** Cliente al que se le registra el cobro. null = todavía no se buscó/confirmó ninguno. */
  cliente: Cliente | null
  /**
   * Saldos de la cuenta corriente del cliente (pendiente de cancelar y anticipos), que muestra la
   * ficha del paso 1. `null` = todavía no se leyeron: la ficha deja esas dos cajas en skeleton.
   */
  saldos: SaldosCliente | null
  /** De QUÉ cliente son los saldos. Misma clave de caché que `facturasClienteId`. */
  saldosClienteId: string | null
  /** Facturas pendientes del cliente, leídas al entrar al paso 2. */
  facturas: FacturaPendiente[]
  /**
   * De QUÉ cliente son las facturas que están en `facturas`. Es la clave de caché del paso 2: si
   * coincide con el cliente en curso, la lista ya se leyó y no se vuelve a consultar a Monday por
   * navegar entre etapas. `null` = no hay nada leído todavía (o la última lectura falló, así que
   * hay que reintentarla).
   */
  facturasClienteId: string | null
  /**
   * Sólo PASES DE SALDO: DE QUIÉN son las dos cuentas del pase —las dos, no una: un pase mueve
   * saldo entre cuentas del mismo lado del mostrador—.
   *
   * Es lo PRIMERO que se decide en el paso 1, antes de buscar a nadie, y ocupa en este recorrido el
   * lugar que en Cobros ocupa "¿Qué vas a cobrar?": es lo que define contra qué categoría del
   * board de Personas se busca (`Clientes` o `Proveedores`), de qué tablero salen los anticipos del
   * origen y en qué tablero se registra el pase al cerrar.
   *
   * `null` = todavía no se eligió, y por eso no se deja avanzar ni cargar una persona: sin saberlo
   * no hay contra qué validar la categoría de quien traiga la búsqueda.
   */
  paseCuentasDe: RolPersona | null
  /** Sólo APLICACIÓN: anticipos con saldo a favor del cliente, leídos al entrar al paso 3. */
  anticipos: AnticipoPendiente[]
  /** De QUÉ cliente son los anticipos de `anticipos`. Misma clave de caché que `facturasClienteId`. */
  anticiposClienteId: string | null
  /**
   * Sólo PASES DE SALDO: `id de anticipo del ORIGEN → importe que se pasa de él`. Un pase puede
   * juntar el saldo de VARIOS anticipos, y su suma es lo que se debita de la cuenta origen.
   *
   * Misma forma que `aplicaciones`: que la CLAVE exista es lo que marca el anticipo como elegido,
   * así no hay dos fuentes de verdad —una lista de elegidos y un mapa de importes— que puedan
   * quedar desincronizadas. Vacío = todavía no se eligió ninguno, y por eso no se sale del paso 2.
   */
  pasesDeAnticipo: Record<string, number>
  /**
   * Sólo PASES DE SALDO: cuánto de ese anticipo se mueve. Nace en su saldo COMPLETO —el caso
   * habitual— y queda editable para pasar menos. Nunca supera el pendiente del anticipo: el tope lo
   * impone el reducer, así que tipear de más devuelve el máximo en vez de aceptarlo.
   */

  /**
   * Sólo PASES DE SALDO: el cliente que RECIBE el saldo. Es un `Cliente` del tablero de Personas y
   * no una cuenta corriente, igual que el origen del paso 1: se busca con el mismo buscador y se
   * muestra con la misma ficha, así que las dos puntas del pase se eligen de la misma manera.
   *
   * `null` = todavía no se buscó.
   */
  clienteDestino: Cliente | null
  /**
   * Saldos de cuenta corriente del cliente destino, leídos de su ítem de Cta Cte. Viven aparte del
   * cliente porque salen de OTRO tablero y llegan después: la ficha se dibuja con el cliente y
   * completa sus cajas cuando la consulta resuelve.
   */
  saldosDestino: SaldosCliente | null
  /** De qué cliente son esos saldos. Es la clave de caché: sin ella se re-consultaría en cada render. */
  saldosDestinoId: string | null
  /**
   * Sólo APLICACIÓN: `id de anticipo → importe aplicado`. Misma forma que `imputaciones`: que la
   * CLAVE exista es lo que marca el anticipo como elegido, así no hay dos fuentes de verdad.
   */
  aplicaciones: Record<string, number>
  /**
   * Importe a cancelar por factura: `id de factura → importe`. Que la CLAVE exista es lo que
   * marca la factura como seleccionada, así no hay dos fuentes de verdad (una lista de elegidas
   * y un mapa de importes) que puedan quedar desincronizadas.
   */
  imputaciones: Record<string, number>
  /** Movimientos con los que el cliente paga lo imputado. Es lo que se registra en el paso 3. */
  cobro: CobroState
  /** ID del recibo ya emitido en "➡️Recibos y Cobros". null = todavía no se emitió. */
  reciboId: string | null
  /**
   * En qué anda la emisión de ESE recibo. Es una bandera global —y no el estado local del hook que
   * la conduce— por el mismo motivo que `documentoEnviado`: tiene que sobrevivir a la navegación.
   * Al volver a la etapa el botón sigue en "Emitido correctamente" en vez de reofrecer una emisión
   * que duplicaría el ítem del tablero.
   */
  emision: EmisionRecibo
  /** Canal por el que se envía el recibo al cliente. */
  medioEnvio: MedioEnvio
  /** Destinatarios elegidos. Vive en el estado global para sobrevivir a la navegación del stepper. */
  contactos: Contacto[]
  /**
   * El recibo YA se envió. Es una bandera global —y no un estado local del componente— porque tiene
   * que sobrevivir a la navegación: al volver a la etapa, el botón sigue bloqueado y en verde, y no
   * se puede disparar un segundo envío.
   */
  documentoEnviado: boolean
  /** Resultado del último envío, para mostrarlo como registro. */
  log: LogEntry[]
  /** Usuarios de los equipos "Vendedores" y "Administradores", leídos al iniciar la app. */
  usuarios: Usuario[]
  /** La consulta de usuarios está en curso: el selector se muestra deshabilitado. */
  usuariosCargando: boolean
  /** Usuario logueado en Monday: responsable por defecto y permisos del selector. null = sin sesión. */
  usuarioActual: UsuarioActual | null
  /**
   * Fallo de la API de Monday: qué se estaba intentando hacer ("obtener los usuarios"). Lo despacha
   * el `catch` de cualquier consulta o mutación y lo consume `ModalErrorMonday`, la ÚNICA forma en
   * que la app comunica estos errores. null = sin error pendiente.
   */
  errorMonday: string | null

  /* ===== MÓDULO DE RECHAZO DE CHEQUE =====
     Igual que los demás circuitos: claves propias, sin compartir una sola con Cobros ni con Pagos.
     Cambiar de módulo vuelve todo a `initialState` (ver `setOperacionApp`), así que no se pisan. */

  /** Cheques en cartera del cliente deudor, leídos al entrar a la etapa 2. */
  chequesRechazo: ChequeEnCartera[]
  /**
   * De QUÉ cliente son esos cheques. Misma clave de caché que `facturasClienteId`, con el mismo
   * `null` ante un fallo: un error NO se cachea, así el próximo ingreso reintenta en vez de mostrar
   * una cartera vacía para siempre.
   */
  chequesRechazoClienteId: string | null
  /**
   * El cheque que el banco rechazó. Es UNO solo —un rechazo es de un papel— y por eso se guarda su
   * id y no un mapa como en las otras tablas de selección múltiple. null = todavía no se eligió.
   */
  chequeRechazadoId: string | null
  /**
   * Proveedor al que ese cheque se le había endosado: es quien vuelve a ser acreedor cuando el
   * papel rebota. Va en su PROPIA clave y no en `clienteDestino` —la segunda persona del pase—
   * porque no es el mismo dato: aquella es una cuenta del mismo lado del mostrador que el origen, y
   * ésta es siempre del OTRO lado. Compartir la clave habría hecho que `setClienteDestino`, que
   * descarta las facturas del pase, se llevara puesto algo que no le pertenece.
   */
  proveedorAcreedor: Cliente | null
  /** Saldos de Cta Cte del acreedor, para su ficha. Misma forma y misma caché que los del cliente. */
  saldosAcreedor: SaldosCliente | null
  saldosAcreedorId: string | null

  /* ===== MÓDULO DE RESUMEN DE CTA CTE =====
     Mismo criterio que los demás circuitos: claves propias. El cliente es el mismo `cliente` de
     Cobros —se elige con el mismo buscador y la misma ficha—, y lo demás es de este recorrido. */

  /**
   * Si el resumen va con el estado de la cuenta corriente. Se declara en el paso 1, ANTES del
   * buscador, y `null` = todavía no se eligió: es lo que ese paso reclama para dejar avanzar.
   */
  resumenEstadoCtaCte: EstadoCtaCteResumen | null
  /** El período del resumen. `null` = todavía no se eligió, y por eso no se consulta nada. */
  resumenRango: RangoResumen | null
  /** Los movimientos del período, leídos de la cuenta corriente del cliente. */
  movimientosCtaCte: MovimientoCtaCte[]
  /** Movimientos de la cuenta que no entraron en la lista por no tener fecha de emisión. */
  movimientosSinFecha: number
  /** Mercadería entregada y sin facturar de la cuenta, leída junto con los movimientos. */
  mercaderiaPendFacturar: number
  /** Etapa "Facturas que debe": las facturas del cliente que no están canceladas al 100%. */
  facturasAdeudadas: FacturaAdeudada[]
  /**
   * De QUÉ cliente son esas facturas: clave de caché, con el mismo criterio que `facturasClienteId`.
   * No depende del período —la deuda es la de hoy—, así que cambiar el rango no las vuelve a leer.
   */
  facturasAdeudadasClienteId: string | null
  /**
   * Clave de caché de esa lectura: de QUÉ cliente y de QUÉ período son los movimientos. Si coincide
   * con los del estado, la lista ya está leída y navegar entre etapas no vuelve a consultar. Va en
   * `null` cuando la lectura falló, así el próximo ingreso reintenta.
   */
  movimientosCtaCteClave: string | null
  /**
   * El ítem de la cuenta corriente del cliente, donde se pide la generación del resumen. `null` = no
   * se leyó todavía o el cliente no tiene cuenta asignada.
   */
  ctaCteId: string | null
  /** Formato del archivo. Obligatorio antes de emitir: `null` = todavía no se eligió. */
  resumenFormato: FormatoResumen | null
  /**
   * El ítem sobre el que YA se pidió la generación. `null` = todavía no se emitió. Es de donde se
   * despacha el envío, igual que `reciboId`.
   */
  resumenCtaCteId: string | null
  /** En qué anda la generación del resumen. Global por el mismo motivo que la del recibo. */
  emisionResumen: EmisionRecibo

  /* ===== MÓDULO DE GESTIÓN DE COBRANZA =====
     El tablero de análisis. No tiene etapas ni documento: tiene un CRITERIO de búsqueda y el
     RESULTADO de haberlo consultado, y nada más. Las tres claves son las que hacen que la pantalla
     sepa, en cualquier momento, si lo que se está mirando contesta lo que se está preguntando. */

  /** Los dos criterios elegidos: estados de saldo y tramos de vencimiento (ver `lib/cobranza`). */
  cobranzaCriterio: CriterioCobranza
  /** Lo que devolvió la última búsqueda. `null` = todavía no se buscó, o se pidió volver a buscar. */
  cobranzaResultado: ResultadoCobranza | null
  /**
   * De QUÉ criterio es ese resultado (ver `claveCobranza`). Si NO coincide con el criterio elegido,
   * los filtros se movieron después de buscar: lo que hay en pantalla contesta otra pregunta, y el
   * tablero lo dice en vez de hacerlo pasar por actual.
   */
  cobranzaClave: string | null
  /**
   * El criterio cuya búsqueda está PEDIDA. Mientras no coincida con `cobranzaClave` hay una consulta
   * por hacer, y es lo único que la dispara (ver `useCobranza`): el tablero nunca sale a la red por
   * su cuenta, lo hace porque alguien lo pidió.
   *
   * Arranca en `null` y sólo lo llena el botón "Buscar": entrar al módulo no consulta nada, y
   * cambiar un criterio tampoco. Una consulta de este tablero recorre el board de cuentas entero,
   * así que no puede salir sin que alguien la haya pedido.
   */
  cobranzaPedida: string | null

  /* ===== MÓDULO DE PAGOS =====
     Estado propio del otro circuito. Vive en el MISMO objeto que el de Cobros pero sin compartir
     un solo campo con él: los dos módulos son operaciones independientes, y cambiar de módulo
     vuelve todo a `initialState` (ver `setOperacionApp`), así que no pueden pisarse. Tener claves
     separadas es lo que permite leer de un vistazo qué pertenece a cuál. */

  /** Etapa en pantalla DENTRO de Pagos. Arranca en la selección de proveedor: no hay paso previo. */
  pasoPago: PasoPago
  /** Índice del paso más avanzado alcanzado en Pagos: hasta ahí navega su stepper. */
  pasoPagoMaxIdx: number
  /**
   * Qué se va a pagar. `null` = todavía no se eligió, y por eso no se sale de la etapa 1: es la
   * misma regla con la que Cobros reclama su "¿Qué vas a cobrar?".
   */
  tipoOperacionPago: TipoOperacionPago | null
  /** Proveedor al que se le paga. null = todavía no se buscó/confirmó ninguno. */
  proveedor: Proveedor | null
  /** Facturas de compra pendientes del proveedor, leídas al entrar a la etapa 2. */
  facturasCompra: FacturaCompraPendiente[]
  /**
   * De QUÉ proveedor son esas facturas. Misma clave de caché que `facturasClienteId`, con el mismo
   * `null` ante un fallo: un error NO se cachea, así el próximo ingreso reintenta.
   */
  facturasCompraProveedorId: string | null
  /**
   * Importe a pagar por factura: `id de factura de compra → importe`. Que la CLAVE exista es lo que
   * marca la factura como seleccionada, misma forma que `imputaciones`.
   */
  imputacionesPago: Record<string, number>
  /** Cajas con las que se paga lo imputado. Es lo que se registra en la etapa 3. */
  pago: PagoState
  /** ID de la ORDEN DE PAGO ya creada en "⬅️ Pagos - PENDIENTES". null = todavía no se emitió. */
  ordenPagoId: string | null
  /**
   * En qué anda la emisión de ESA orden. Misma forma —y mismo motivo para vivir en el estado
   * global— que la del recibo: la orden se emite UNA vez, y esa marca tiene que sobrevivir a la
   * navegación del stepper.
   */
  emisionOP: EmisionRecibo
}

/** Emisión sin empezar: es el punto de partida y el estado al que vuelve cada reinicio. */
const EMISION_INICIAL: EmisionRecibo = { fase: 'idle', estado: '', error: null }

/** Cobro en blanco: sin movimientos y fechado en el día en que se opera. */
const cobroVacio = (): CobroState => ({ fecha: hoy(), movimientos: [], confirmado: false })

/** Pago en blanco. Mismo criterio que `cobroVacio`: la fecha es la del día en que se opera. */
const pagoVacio = (): PagoState => ({ fecha: hoy(), movimientos: [], confirmado: false })

export const initialState: AppState = {
  operacionApp: null,
  operacionConfirmada: false,
  paso: 'cliente',
  /* Nada viene preseleccionado: qué se registra lo decide el usuario en el paso 1. */
  tipoOperacion: null,
  importeAnticipo: 0,
  detalleAnticipo: '',
  vencimientoAnticipo: '',
  pasoMaxIdx: 0,
  usuario: null,
  cliente: null,
  saldos: null,
  saldosClienteId: null,
  facturas: [],
  facturasClienteId: null,
  imputaciones: {},
  /* Nada viene preseleccionado: de quiénes son las cuentas del pase lo decide el usuario en el
     paso 1, igual que en Cobros se decide qué se cobra. */
  paseCuentasDe: null,
  anticipos: [],
  anticiposClienteId: null,
  pasesDeAnticipo: {},
  clienteDestino: null,
  saldosDestino: null,
  saldosDestinoId: null,
  aplicaciones: {},
  cobro: cobroVacio(),
  reciboId: null,
  emision: EMISION_INICIAL,
  medioEnvio: 'Email',
  contactos: [],
  documentoEnviado: false,
  log: [],
  usuarios: [],
  /* Arranca en `true`: la consulta sale al montar la app, así el selector nace "Cargando…" en vez
     de mostrarse vacío por un instante y recién después llenarse. */
  usuariosCargando: true,
  usuarioActual: null,
  errorMonday: null,
  /* RECHAZO DE CHEQUE. La cartera se lee recién en la etapa 2, con el deudor ya elegido. */
  chequesRechazo: [],
  chequesRechazoClienteId: null,
  chequeRechazadoId: null,
  proveedorAcreedor: null,
  saldosAcreedor: null,
  saldosAcreedorId: null,
  /* RESUMEN DE CTA CTE. Nada viene preseleccionado: el estado de la cuenta, el período y el formato
     los decide el usuario, y cada etapa reclama el suyo. */
  resumenEstadoCtaCte: null,
  resumenRango: null,
  movimientosCtaCte: [],
  movimientosSinFecha: 0,
  mercaderiaPendFacturar: 0,
  facturasAdeudadas: [],
  facturasAdeudadasClienteId: null,
  movimientosCtaCteClave: null,
  ctaCteId: null,
  resumenFormato: null,
  resumenCtaCteId: null,
  emisionResumen: EMISION_INICIAL,
  /* GESTIÓN DE COBRANZA. El criterio arranca puesto —es la pregunta con la que se entra a cobrar,
     ver `CRITERIO_INICIAL`— pero SIN pedir: el tablero abre en blanco y no consulta hasta que se
     aprieta "Buscar". */
  cobranzaCriterio: CRITERIO_INICIAL,
  cobranzaResultado: null,
  cobranzaClave: null,
  cobranzaPedida: null,
  /* PAGOS. Igual que Cobros: nada viene preseleccionado, y la etapa 1 es la que lo reclama. */
  pasoPago: 'proveedor',
  pasoPagoMaxIdx: 0,
  tipoOperacionPago: null,
  proveedor: null,
  facturasCompra: [],
  facturasCompraProveedorId: null,
  imputacionesPago: {},
  pago: pagoVacio(),
  ordenPagoId: null,
  emisionOP: EMISION_INICIAL,
}

/**
 * ¿Hay una operación EN CURSO cuyo trabajo se perdería al cambiar de módulo?
 *
 * Se mira el CLIENTE y no los datos de cada circuito a propósito: es lo primero que se carga en
 * todos los módulos —los de hoy y los que se sumen— y desde ahí en adelante todo lo cargado
 * cuelga de él. Una regla escrita sobre él no se queda corta cuando aparezca un circuito nuevo con
 * campos propios; enumerar los datos de cada módulo obligaría a acordarse de volver acá a sumarlos,
 * y la vez que alguien se olvide el usuario pierde su carga sin aviso.
 *
 * Con la operación YA terminada no hay nada que proteger: lo que queda en pantalla es el comprobante
 * de algo que ya se escribió en Monday, no trabajo a medio hacer.
 */
export const hayOperacionEnCurso = (state: AppState): boolean =>
  /* El PROVEEDOR cuenta igual que el cliente: es lo primero que se carga en el módulo de Pagos y
     desde ahí en adelante todo lo cargado cuelga de él. Sin esto, irse de Pagos a mitad de una
     operación no advertía nada y el trabajo se perdía en silencio.

     Y cada circuito mira SU documento para saber si ya terminó: con la orden de pago emitida lo
     que queda en pantalla es el comprobante de algo que ya se escribió en Monday, no trabajo a
     medio hacer. */
  /* El RESUMEN no deja recibo: su documento es la generación sobre la cuenta, así que lo que dice
     que terminó es esa emisión. */
  (state.cliente !== null &&
    (state.operacionApp === 'RESUMEN'
      ? state.emisionResumen.fase !== 'emitido'
      : state.reciboId === null)) ||
  (state.proveedor !== null && state.ordenPagoId === null)

/** Clave de caché de los movimientos del resumen: son de UN cliente y de UN período. */
export const claveMovimientosCtaCte = (clienteId: string, rango: RangoResumen): string =>
  `${clienteId}·${rango}`

export type Action =
  | { type: 'setOperacionApp'; operacion: OperacionApp }
  | { type: 'confirmarOperacionApp' }
  | { type: 'goto'; paso: Paso }
  | { type: 'setTipoOperacion'; tipo: TipoOperacion }
  | { type: 'setPaseCuentasDe'; rol: RolPersona }
  | { type: 'setImporteAnticipo'; importe: number }
  | { type: 'setDetalleAnticipo'; detalle: string }
  | { type: 'setVencimientoAnticipo'; vencimiento: string }
  | { type: 'setUsuario'; usuario: Usuario }
  | { type: 'setCliente'; cliente: Cliente }
  /** `clienteId`: misma clave de caché que en `setFacturas`, con el mismo `null` ante un fallo. */
  | { type: 'setSaldos'; saldos: SaldosCliente | null; clienteId: string | null }
  /**
   * `clienteId` es de QUIÉN son las facturas que llegaron: queda como clave de caché para no
   * volver a pedirlas al navegar. Va en `null` cuando la lectura FALLÓ —la lista se vacía pero sin
   * darla por leída—, así el próximo ingreso al paso reintenta en vez de mostrar cero facturas
   * para siempre.
   */
  | { type: 'setFacturas'; facturas: FacturaPendiente[]; clienteId: string | null }
  | { type: 'toggleFactura'; factura: FacturaPendiente }
  | { type: 'setImporteFactura'; id: string; importe: number }
  /** `clienteId`: misma clave de caché que en `setFacturas`, con el mismo `null` ante un fallo. */
  | { type: 'setAnticipos'; anticipos: AnticipoPendiente[]; clienteId: string | null }
  | { type: 'toggleAnticipo'; anticipo: AnticipoPendiente }
  /* PASES DE SALDO. Elegir el anticipo de origen, la cuenta destino y qué se hace con el saldo. */
  | { type: 'toggleAnticipoPase'; anticipo: AnticipoPendiente }
  | { type: 'setImportePase'; id: string; importe: number }
  | { type: 'setClienteDestino'; cliente: Cliente | null }
  /* RECHAZO DE CHEQUE. Traer la cartera del deudor y marcar cuál de sus cheques rebotó. */
  | { type: 'setChequesRechazo'; cheques: ChequeEnCartera[]; clienteId: string | null }
  | { type: 'toggleChequeRechazado'; cheque: ChequeEnCartera }
  | { type: 'setProveedorAcreedor'; proveedor: Cliente | null }
  /** `clienteId`: misma clave de caché que en `setSaldos`, con el mismo `null` ante un fallo. */
  | { type: 'setSaldosAcreedor'; saldos: SaldosCliente | null; clienteId: string | null }
  | { type: 'setSaldosDestino'; saldos: SaldosCliente | null; clienteId: string | null }
  /* RESUMEN DE CTA CTE. El estado de la cuenta, el período con sus movimientos y la emisión. */
  | { type: 'setResumenEstadoCtaCte'; estado: EstadoCtaCteResumen }
  | { type: 'setResumenRango'; rango: RangoResumen }
  /**
   * Llegaron los movimientos. `clave` es de QUÉ cliente y período son (ver
   * `claveMovimientosCtaCte`), y va en `null` cuando la lectura FALLÓ: la lista se vacía sin darla
   * por leída, así el próximo ingreso reintenta.
   */
  | { type: 'setMovimientosCtaCte'; resultado: MovimientosDelPeriodo; clave: string | null }
  /** `clienteId`: de quién son las facturas. Un fallo no se despacha: lo retiene el hook. */
  | { type: 'setFacturasAdeudadas'; facturas: FacturaAdeudada[]; clienteId: string }
  | { type: 'setResumenFormato'; formato: FormatoResumen }
  | { type: 'setResumenCtaCteId'; id: string }
  /** Mismo criterio que `setEmision`: llega como PARCHE. */
  | { type: 'setEmisionResumen'; emision: Partial<EmisionRecibo> }
  | { type: 'setCobranzaEstados'; estados: readonly EstadoSaldo[] }
  | { type: 'setCobranzaTramos'; tramos: readonly TramoVencimiento[] }
  | { type: 'pedirCobranza' }
  | { type: 'setCobranzaResultado'; resultado: ResultadoCobranza; clave: string }
  | { type: 'setImporteAnticipoAplicado'; id: string; importe: number }
  | { type: 'agregarMovimientoPago'; movimiento: Omit<MovimientoPago, 'id'> }
  | { type: 'removeMovimientoPago'; id: string }
  | { type: 'setMovimientoImporte'; id: string; importe: number }
  | { type: 'confirmarCobro' }
  | { type: 'setReciboId'; id: string }
  /**
   * Avance de la emisión. Llega como PARCHE porque cada transición mueve sólo lo que cambió —la
   * fase, la etiqueta del tablero o el error—, y pisar el resto con `undefined` borraría lo que la
   * pantalla todavía tiene que mostrar.
   */
  | { type: 'setEmision'; emision: Partial<EmisionRecibo> }
  | { type: 'setMedioEnvio'; value: MedioEnvio }
  | { type: 'setContactos'; contactos: Contacto[] }
  | { type: 'addContacto'; contacto: Contacto }
  | { type: 'removeContacto'; id: string }
  | { type: 'setDocumentoEnviado'; value: boolean }
  | { type: 'setLog'; entries: LogEntry[] }
  | { type: 'setUsuarios'; usuarios: Usuario[] }
  | { type: 'setUsuarioActual'; usuario: UsuarioActual | null }
  | { type: 'errorMonday'; accion: string }
  | { type: 'limpiarErrorMonday' }
  | { type: 'reset' }
  /* ===== MÓDULO DE PAGOS ===== */
  | { type: 'gotoPago'; paso: PasoPago }
  | { type: 'setTipoOperacionPago'; tipo: TipoOperacionPago }
  | { type: 'setProveedor'; proveedor: Proveedor }
  /**
   * `proveedorId` es de QUIÉN son las facturas que llegaron: queda como clave de caché para no
   * volver a pedirlas al navegar. Va en `null` cuando la lectura FALLÓ, así el próximo ingreso al
   * paso reintenta en vez de mostrar cero facturas para siempre.
   */
  | { type: 'setFacturasCompra'; facturas: FacturaCompraPendiente[]; proveedorId: string | null }
  | { type: 'toggleFacturaCompra'; factura: FacturaCompraPendiente }
  | { type: 'setImporteFacturaCompra'; id: string; importe: number }
  | { type: 'agregarMovimientoCaja'; movimiento: Omit<MovimientoCaja, 'id'> }
  | { type: 'removeMovimientoCaja'; id: string }
  | { type: 'setMovimientoCajaImporte'; id: string; importe: number }
  | { type: 'confirmarPago' }
  | { type: 'setOrdenPagoId'; id: string }
  /** Mismo criterio que `setEmision`: llega como PARCHE, porque cada transición mueve sólo lo suyo. */
  | { type: 'setEmisionOP'; emision: Partial<EmisionRecibo> }

/**
 * Recorrido que le corresponde a un MÓDULO. Es la unica fuente de esa relacion, y por eso existe
 * como funcion en vez de repetirse donde hace falta.
 *
 *   · PASES tiene un recorrido ÚNICO —no pregunta que se cobra—, asi que el modulo lo fija.
 *   · RECHAZOS, lo mismo: sus tres etapas son siempre las mismas, asi que el modulo las fija.
 *   · COBROS lo deja SIN elegir: es lo que hace que el paso 1 lo reclame.
 *
 * Lo consultan los dos lugares que dejan la app a foja cero: cambiar de modulo y cerrar una
 * operacion. Escrito dos veces, uno de los dos se olvidaba —y de hecho pasaba: al finalizar un pase
 * el modulo seguia siendo PASES pero el recorrido volvia a `null`, asi que la app mostraba las
 * etapas de Cobros dentro del modulo de Pases—.
 */
const recorridoDe = (operacion: OperacionApp | null): TipoOperacion | null =>
  operacion === 'PASES'
    ? 'pases'
    : operacion === 'RECHAZOS'
      ? 'rechazos'
      : operacion === 'RESUMEN'
        ? 'resumen'
        : null

/**
 * El resumen vuelve a quedar SIN emitir. Lo usa todo cambio que altera lo que el documento diría —el
 * cliente, el período, el estado de la cuenta—: el archivo ya generado describe otra cosa, así que
 * se lo deja de dar por emitido y su envío también vuelve a empezar.
 *
 * Los destinatarios elegidos NO se tocan: son contactos del cliente, y el período no los cambia (al
 * cambiar de cliente los descarta `setCliente`).
 *
 * No borra nada en Monday: la generación escribe sobre la cuenta del cliente, no crea un ítem, así
 * que volver a pedirla no duplica nada.
 */
const resumenSinEmitir = (state: AppState): AppState => ({
  ...state,
  resumenCtaCteId: null,
  emisionResumen: EMISION_INICIAL,
  documentoEnviado: false,
  log: [],
})

/**
 * La generación está EN VUELO: se escribió o se está escribiendo sobre la cuenta y se espera al
 * tablero. Mientras tanto no se acepta ningún cambio que la invalide —el período, el estado de la
 * cuenta, el formato—: el archivo que salga tiene que describir lo que se pidió.
 */
export const generacionResumenEnVuelo = (state: AppState): boolean =>
  state.emisionResumen.fase === 'creando' || state.emisionResumen.fase === 'emitiendo'

/**
 * Responsable por defecto: el usuario de la lista que coincide con el logueado (mismo id de
 * Monday), si está. Puede llegar en cualquier orden —la lista y la sesión se piden en paralelo—,
 * así que lo resuelven las DOS acciones, y siempre sin pisar una elección ya hecha por el usuario.
 */
const usuarioPorDefecto = (usuarios: Usuario[], sesion: UsuarioActual | null): Usuario | null =>
  sesion ? usuarios.find((u) => u.id === sesion.id) ?? null : null

/** Id local de un movimiento de cobro. Sólo vive en el navegador: Monday asigna el suyo al escribir. */
const nuevoId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `mov-${Math.random().toString(36).slice(2)}`

/**
 * Reabre el cobro: cambió algo que mueve el total a cancelar o lo recibido, así que la confirmación
 * ya no vale. Los movimientos NO se tocan —el usuario los ajusta—, sólo se le vuelve a exigir que
 * la diferencia cierre antes de avanzar.
 */
const reabrirCobro = (cobro: CobroState): CobroState =>
  cobro.confirmado ? { ...cobro, confirmado: false } : cobro

/** Lo mismo del lado de PAGOS: cambió lo que hay que pagar, así que la confirmación ya no vale. */
const reabrirPago = (pago: PagoState): PagoState =>
  pago.confirmado ? { ...pago, confirmado: false } : pago

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'goto': {
      /* Al ir a un paso se recuerda el índice MÁS AVANZADO alcanzado: volver atrás no lo baja, así
         el stepper deja volver a saltar hacia adelante a las etapas ya completadas. El índice es el
         de ESTE recorrido: el del anticipo tiene una etapa menos que el del cobro. */
      const idx = indiceDePaso(
        action.paso,
        state.tipoOperacion,
        state.resumenEstadoCtaCte === 'INCLUIR',
      )
      return { ...state, paso: action.paso, pasoMaxIdx: Math.max(state.pasoMaxIdx, idx) }
    }

    /* Qué se registra. Cambiarlo cambia el RECORRIDO entero, así que se descarta todo lo que se
       hubiera armado con el anterior —facturas, imputación, cobro, recibo y su envío— y el avance
       vuelve al paso 1: lo cargado para un cobro contra facturas no tiene dónde impactar en un
       anticipo, y al revés. Reelegir lo MISMO no toca nada. */
    case 'setTipoOperacion':
      if (state.tipoOperacion === action.tipo) return state
      return {
        ...state,
        tipoOperacion: action.tipo,
        pasoMaxIdx: 0,
        importeAnticipo: 0,
        detalleAnticipo: '',
        vencimientoAnticipo: '',
        /* Las listas se descartan CON su clave de caché: dejarla puesta sobre una lista vacía haría
           que el paso la diera por leída y no volviera a consultar a Monday nunca. */
        saldos: null,
        saldosClienteId: null,
        facturas: [],
        facturasClienteId: null,
        imputaciones: {},
        anticipos: [],
        anticiposClienteId: null,
        aplicaciones: {},
        pasesDeAnticipo: {},
        clienteDestino: null,
        saldosDestino: null,
        saldosDestinoId: null,
        chequesRechazo: [],
        chequesRechazoClienteId: null,
        chequeRechazadoId: null,
        proveedorAcreedor: null,
        saldosAcreedor: null,
        saldosAcreedorId: null,
              cobro: cobroVacio(),
        reciboId: null,
        emision: EMISION_INICIAL,
        contactos: [],
        documentoEnviado: false,
        log: [],
      }

    /* PASE DE SALDO · de quiénes son las cuentas. Cambiarlo cambia el LADO DEL MOSTRADOR entero:
       contra qué categoría se busca, de qué tablero salen los anticipos del origen y en qué tablero
       se registra el pase. Nada de lo cargado sirve del otro lado —la persona ni siquiera tiene la
       categoría que la nueva elección exige—, así que se descarta todo y el avance vuelve al paso 1.

       Es el mismo criterio de `setTipoOperacion`, por el mismo motivo: reelegir lo MISMO no toca
       nada, porque no es un cambio y destruir trabajo por un click sin consecuencias sería peor. */
    case 'setPaseCuentasDe':
      /* Un lado que este usuario no puede usar no se elige, ni desde el selector —que no lo
         ofrece— ni desde ningún otro lugar (ver `ladosDePase`). */
      if (!puedePasarEntre(state.usuarioActual, action.rol)) return state
      if (state.paseCuentasDe === action.rol) return state
      return {
        ...state,
        paseCuentasDe: action.rol,
        pasoMaxIdx: 0,
        cliente: null,
        /* Las listas y los saldos se descartan CON su clave de caché: dejarla puesta sobre una
           lista vacía haría que el paso la diera por leída y no volviera a consultar nunca. */
        saldos: null,
        saldosClienteId: null,
        anticipos: [],
        anticiposClienteId: null,
        pasesDeAnticipo: {},
        clienteDestino: null,
        saldosDestino: null,
        saldosDestinoId: null,
      }

    /* Importe del anticipo. Es el TOTAL A CANCELAR de ese recorrido, así que moverlo reabre el
       cobro igual que lo hace cambiar una imputación. No se topea contra nada: el anticipo es lo
       que el cliente decida entregar. */
    case 'setImporteAnticipo':
      return {
        ...state,
        importeAnticipo: round2(Math.max(action.importe, 0)),
        cobro: reabrirCobro(state.cobro),
      }

    /* Detalle y vencimiento NO reabren el cobro: no mueven el total a cancelar, así que no pueden
       desbalancear lo que ya se registró. Son datos del anticipo, no de su cuenta. */
    case 'setDetalleAnticipo':
      return { ...state, detalleAnticipo: action.detalle }

    case 'setVencimientoAnticipo':
      return { ...state, vencimientoAnticipo: action.vencimiento }

    /* Cambio de MÓDULO. Cobros y Pagos son operaciones independientes: no comparten etapas ni
       pantallas, así que tampoco pueden compartir estado de trabajo. Se vuelve a foja cero —igual
       que en `reset`— y sólo sobreviven los datos de SESIÓN (los usuarios y el logueado), que son
       de la app y no del circuito.

       Sin esto, ir a Pagos y volver reencontraría al usuario con el cobro a medio cargar de antes,
       como si nunca hubiera cambiado de módulo. Reelegir el MISMO módulo no toca nada: no es un
       cambio, y descartar lo cargado sería destruir trabajo por un click sin consecuencias. */
    case 'setOperacionApp':
      if (state.operacionApp === action.operacion) return state
      /* Un módulo que este usuario no puede operar NO se abre, lo pida la pantalla o no. El
         selector ni siquiera lo ofrece, pero la regla vive acá: así un despacho que llegue por otro
         lado —o un selector que alguien cambie mañana— no puede saltearla. */
      if (!puedeOperar(state.usuarioActual, action.operacion)) return state
      return {
        ...initialState,
        operacionApp: action.operacion,
        /* Se conserva si el circuito ya estaba abierto: cambiar de módulo DESDE una operación en
           curso lleva directo a la primera etapa del nuevo, sin pasar de nuevo por "Confirmar".
           En el paso inicial sigue en `false`, así que elegir un módulo sólo llena el selector. */
        operacionConfirmada: state.operacionConfirmada,
        tipoOperacion: recorridoDe(action.operacion),
        /* El PASE nace con su lado puesto sólo si el usuario tiene UNO (ver `ladoInicialDePase`);
           con dos, lo elige él. Fuera del pase no hay lado que declarar. */
        paseCuentasDe: action.operacion === 'PASES' ? ladoInicialDePase(state.usuarioActual) : null,
        /* Cobro y pago NUEVOS, no los que quedaron armados al cargar el módulo: si la pestaña quedó
           abierta de un día para el otro, su fecha tiene que ser la de HOY. */
        cobro: cobroVacio(),
        pago: pagoVacio(),
        usuarios: state.usuarios,
        usuariosCargando: state.usuariosCargando,
        usuarioActual: state.usuarioActual,
        usuario: usuarioPorDefecto(state.usuarios, state.usuarioActual),
      }

    /* El botón "Confirmar" del paso inicial: con el módulo y el vendedor declarados, se abre el
       circuito. No toca nada más —el módulo ya dejó el estado a foja cero al elegirse—, así que lo
       único que cambia es que a partir de acá se dibujan las etapas. */
    case 'confirmarOperacionApp':
      /* Se vuelve a preguntar al CONFIRMAR, no sólo al elegir: entre las dos cosas pudo cambiar
         quién es el usuario de la sesión. */
      return puedeOperar(state.usuarioActual, state.operacionApp)
        ? { ...state, operacionConfirmada: true }
        : state

    case 'setUsuario':
      return { ...state, usuario: action.usuario }

    /* Cliente elegido en el paso 1. Cambiarlo invalida todo lo que se haya alcanzado después: las
       facturas y su imputación son de ESE cliente, así que se descartan junto con el avance
       navegable, en vez de dejar etapas accesibles armadas con los datos del cliente anterior. */
    case 'setCliente':
      if (state.cliente?.id === action.cliente.id) return { ...state, cliente: action.cliente }
      /* Con el resumen del cliente actual generándose no se cambia de cliente: el tablero está
         armando el archivo de ESA cuenta, y soltarlo a mitad dejaría la espera sin dueño. */
      if (generacionResumenEnVuelo(state)) return state
      return {
        ...state,
        cliente: action.cliente,
        pasoMaxIdx: indiceDePaso('cliente'),
        /* Los saldos y las dos listas se descartan CON su clave de caché: son del cliente anterior,
           así que hay que volver a leerlos —no alcanza con vaciarlos, o el paso los daría por ya
           leídos—. */
        saldos: null,
        saldosClienteId: null,
        facturas: [],
        facturasClienteId: null,
        imputaciones: {},
        anticipos: [],
        anticiposClienteId: null,
        aplicaciones: {},
        /* El pase es del anticipo de ESE cliente: cambiarlo deja sin sentido las tres decisiones. */
        pasesDeAnticipo: {},
        clienteDestino: null,
        saldosDestino: null,
        saldosDestinoId: null,
        /* La cartera es de ESE deudor y el cheque rechazado es uno de sus papeles: cambiarlo deja
           las dos cosas sin sentido. La lista se descarta CON su clave de caché, igual que el
           resto, o el paso 2 la daría por ya leída. */
        chequesRechazo: [],
        chequesRechazoClienteId: null,
        chequeRechazadoId: null,
        /* El acreedor NO se descarta acá: a quién se le endosó el cheque es una decisión propia del
           paso 3 y no depende de quién sea el deudor. Se descarta al elegir OTRO proveedor, al
           cambiar de operación o al cerrar la operación, igual que el destino del pase. */
              /* El cobro es de ESE cliente: sus cheques, sus retenciones y sus tarjetas no tienen
           sentido para otro, así que se descarta entero junto con la imputación. */
        cobro: cobroVacio(),
        /* El recibo y su envío también: el documento emitido era del cliente anterior, y sus
           destinatarios son los contactos de ESE cliente. */
        reciboId: null,
        emision: EMISION_INICIAL,
        contactos: [],
        documentoEnviado: false,
        log: [],
        /* RESUMEN DE CTA CTE: los movimientos, la cuenta y la generación son de ESE cliente. El
           estado de la cuenta y el período NO se descartan: son decisiones sobre el documento, no
           sobre la persona, y la lista se vuelve a leer sola para el cliente nuevo. */
        movimientosCtaCte: [],
        movimientosSinFecha: 0,
        mercaderiaPendFacturar: 0,
        facturasAdeudadas: [],
        facturasAdeudadasClienteId: null,
        movimientosCtaCteClave: null,
        ctaCteId: null,
        resumenCtaCteId: null,
        emisionResumen: EMISION_INICIAL,
      }

    /* Llegaron los saldos de la cuenta corriente del cliente. Van al estado global —y no al estado
       local de la ficha— para que sobrevivan a la navegación del stepper: volver al paso 1 no tiene
       que disparar otra consulta. */
    case 'setSaldos':
      return { ...state, saldos: action.saldos, saldosClienteId: action.clienteId }

    /* Llegaron las facturas del cliente. Las imputaciones ya hechas se conservan SÓLO si su factura
       sigue estando: al recargar puede haberse cobrado alguna desde otro lado, y un importe
       imputado a una factura que ya no figura no tendría dónde impactar. */
    case 'setFacturas': {
      const vigentes = new Set(action.facturas.map((f) => f.id))
      const imputaciones = Object.fromEntries(
        Object.entries(state.imputaciones).filter(([id]) => vigentes.has(id)),
      )
      return {
        ...state,
        facturas: action.facturas,
        facturasClienteId: action.clienteId,
        imputaciones,
      }
    }

    /* Marcar/desmarcar una factura. Al marcarla se propone cancelarla ENTERA: el importe nace en su
       saldo pendiente, que es el caso habitual de una cobranza, y queda editable para imputar menos.
       Al desmarcarla se borra la clave: la selección y el importe son el mismo dato. */
    case 'toggleFactura': {
      const { [action.factura.id]: actual, ...resto } = state.imputaciones
      const cobro = reabrirCobro(state.cobro)
      if (actual !== undefined) return { ...state, imputaciones: resto, cobro }
      return {
        ...state,
        imputaciones: { ...state.imputaciones, [action.factura.id]: action.factura.pendiente },
        cobro,
      }
    }

    /* Importe a cancelar de una factura ya seleccionada. NO se topea contra el saldo: pasarse es un
       error que se le muestra al usuario (borde rojo en el input y bloqueo al continuar), no algo
       que la app corrija por su cuenta cambiándole el número que acaba de escribir. */
    case 'setImporteFactura': {
      if (!(action.id in state.imputaciones)) return state
      const importe = round2(Math.max(action.importe, 0))
      return {
        ...state,
        imputaciones: { ...state.imputaciones, [action.id]: importe },
        cobro: reabrirCobro(state.cobro),
      }
    }

    /* Llegaron los anticipos del cliente. Lo ya aplicado se conserva SÓLO si su anticipo sigue
       estando: al recargar puede haberse consumido desde otro lado, y un importe aplicado a un
       anticipo que ya no figura no tendría de dónde salir. */
    case 'setAnticipos': {
      const vigentes = new Set(action.anticipos.map((a) => a.id))
      const aplicaciones = Object.fromEntries(
        Object.entries(state.aplicaciones).filter(([id]) => vigentes.has(id)),
      )
      return {
        ...state,
        anticipos: action.anticipos,
        anticiposClienteId: action.clienteId,
        aplicaciones,
      }
    }

    /* Marcar/desmarcar un anticipo. Al marcarlo se propone aplicar TODO su saldo pendiente —el caso
       habitual— acotado a lo que todavía falta cubrir, y queda editable para aplicar menos.
       DESMARCAR siempre se puede: es la salida para corregir. */
    case 'toggleAnticipo': {
      const { [action.anticipo.id]: actual, ...resto } = state.aplicaciones
      if (actual !== undefined) return { ...state, aplicaciones: resto }

      /* Contra QUE se aplica el saldo. Los anticipos son la misma pieza en los dos circuitos —el
         mismo tablero, la misma tabla, el mismo estado—, pero lo que se cancela con ellos no: en
         Cobros son las facturas de venta imputadas y en Pagos las facturas de COMPRA.

         Sin esta rama la aplicación de Pagos quedaba muerta: se miraban las imputaciones de Cobros,
         que en ese recorrido están vacías, así que `falta` daba 0, el `return state` de abajo se
         llevaba puesto cada click en la casilla y no había forma de elegir un anticipo —ni, por lo
         tanto, de llegar a emitir la orden—. */
      const aCancelar =
        state.operacionApp === 'PAGOS' ? state.imputacionesPago : state.imputaciones

      /* Con el total ya cubierto no se suma otro anticipo: aplicarlo dejaría la diferencia en
         negativo, que es exactamente lo que este paso no permite emitir. El tope se impone acá
         además de en la casilla, para que la regla no dependa de la pantalla. */
      const falta = round2(totalACancelar(aCancelar) - totalAplicado(state.aplicaciones))
      if (falta <= 0) return state

      return {
        ...state,
        aplicaciones: {
          ...state.aplicaciones,
          /* Se propone lo que falta, no todo el saldo: con un anticipo más grande que la deuda,
             proponer su total dejaría la diferencia en negativo desde el primer click. */
          [action.anticipo.id]: Math.min(action.anticipo.pendiente, falta),
        },
      }
    }

    /* Importe aplicado de un anticipo ya elegido. NO se topea contra su pendiente, igual que en un
       pase (`setImportePase`): pasarse es un error que se le MUESTRA al usuario —borde rojo en el
       campo y bloqueo al avanzar, con el máximo nombrado—, no algo que la app corrija por su cuenta
       cambiándole el número que acaba de escribir.

       Recortarlo en silencio tenía dos costos: el usuario veía otro importe del que tipeó sin
       enterarse de por qué, y la validación "el importe supera el saldo del anticipo" quedaba muerta
       —nunca podía dispararse—. Sólo se sigue descartando el negativo: no es un importe. */
    case 'setImporteAnticipoAplicado': {
      if (!(action.id in state.aplicaciones)) return state
      const importe = round2(Math.max(action.importe, 0))
      return { ...state, aplicaciones: { ...state.aplicaciones, [action.id]: importe } }
    }

    /* Un pago cargado en el formulario del paso 3. Llega ya validado —el formulario no deja
       agregar un movimiento incompleto—, así que acá sólo se le pone el id y se reabre el cobro. */
    /* Marcar/desmarcar un anticipo del ORIGEN. Un pase puede juntar el saldo de VARIOS: la clave
       existe = el anticipo está elegido, y su valor es cuánto se pasa de él —misma forma que
       `aplicaciones`, así que no hay dos fuentes de verdad—. Al marcarlo se propone mover su saldo
       ENTERO, que es el caso habitual, y queda editable para pasar menos.

       El DESTINO no se toca: es una decisión propia —a qué cuenta va el saldo—, y ajustar cuánto se
       mueve no la invalida. Antes se borraba acá, así que volver un paso a corregir el importe
       obligaba a buscar de nuevo la cuenta que ya se había elegido. Se retiene igual que el cliente
       ORIGEN: lo único que lo descarta es elegir OTRA cuenta (`setClienteDestino`) o cambiar el
       cliente de la operación.

       Tampoco se baja `pasoMaxIdx`: era lo que impedía volver al destino con el stepper. Que la
       selección quede vacía lo frena el propio paso 3, que revisa el origen antes de dejar cerrar. */
    case 'toggleAnticipoPase': {
      const { [action.anticipo.id]: actual, ...resto } = state.pasesDeAnticipo
      const pasesDeAnticipo =
        actual !== undefined
          ? resto
          : { ...state.pasesDeAnticipo, [action.anticipo.id]: action.anticipo.pendiente }
      return { ...state, pasesDeAnticipo }
    }

    /* Cuánto se mueve de UN anticipo ya elegido. NO se topea contra su pendiente: pasarse es un
       error que se le MUESTRA al usuario —borde rojo y mensaje bajo el campo, y bloqueo al
       avanzar—, no algo que la app corrija por su cuenta cambiándole el número que acaba de
       escribir. Es el mismo criterio que el importe a cancelar de una factura.

       Lo único que sí se acota es el signo: un importe negativo no es un dato a validar, es un
       valor que no puede existir en esta columna. */
    case 'setImportePase': {
      if (!(action.id in state.pasesDeAnticipo)) return state
      return {
        ...state,
        pasesDeAnticipo: {
          ...state.pasesDeAnticipo,
          [action.id]: round2(Math.max(action.importe, 0)),
        },
      }
    }

    /* Cliente DESTINO. Cambiarlo descarta la acción, sus saldos y las facturas leídas: eran del
       cliente anterior, y aplicar un saldo contra la deuda de otro sería lo peor que podría pasar
       acá. Reelegir el mismo no toca nada. */
    case 'setClienteDestino':
      if (state.clienteDestino?.id === action.cliente?.id) return state
      return {
        ...state,
        clienteDestino: action.cliente,
        saldosDestino: null,
        saldosDestinoId: null,
              facturas: [],
        facturasClienteId: null,
        imputaciones: {},
      }

    /* Saldos de Cta Cte del destino. Llegan solos, después del cliente: sólo rellenan sus cajas. */
    case 'setSaldosDestino':
      return { ...state, saldosDestino: action.saldos, saldosDestinoId: action.clienteId }

    /* ===== RECHAZO DE CHEQUE ===== */

    /* Llegó la cartera del deudor. El cheque ya marcado se conserva SÓLO si sigue estando —mismo
       criterio que las imputaciones en `setFacturas`—: entre una lectura y otra pudo haberse usado
       o rechazado desde otro lado, y dejar marcado un papel que ya no figura haría registrar un
       rechazo contra un ítem que la pantalla no muestra. */
    case 'setChequesRechazo': {
      const vigentes = new Set(action.cheques.map((c) => c.id))
      return {
        ...state,
        chequesRechazo: action.cheques,
        chequesRechazoClienteId: action.clienteId,
        chequeRechazadoId:
          state.chequeRechazadoId && vigentes.has(state.chequeRechazadoId)
            ? state.chequeRechazadoId
            : null,
      }
    }

    /* Marcar/desmarcar el cheque rechazado. Es EXCLUYENTE: un rechazo es de UN papel, así que
       marcar otro reemplaza al anterior en vez de sumarse. La tabla es la misma que la de Pagos
       —casillas y todo—, y es el estado el que decide que sólo una quede en pie: cambiar el
       control por radios habría significado una tabla distinta para el mismo dato. */
    case 'toggleChequeRechazado':
      return {
        ...state,
        chequeRechazadoId:
          state.chequeRechazadoId === action.cheque.id ? null : action.cheque.id,
      }

    /* El proveedor al que se le había endosado el cheque. Cambiarlo descarta SUS saldos con su
       clave de caché —son del proveedor anterior—, con el mismo criterio que el destino del pase. */
    case 'setProveedorAcreedor':
      if (state.proveedorAcreedor?.id === action.proveedor?.id) return state
      return {
        ...state,
        proveedorAcreedor: action.proveedor,
        saldosAcreedor: null,
        saldosAcreedorId: null,
      }

    /* Saldos de Cta Cte del acreedor. Llegan solos, después del proveedor: sólo rellenan sus cajas. */
    case 'setSaldosAcreedor':
      return { ...state, saldosAcreedor: action.saldos, saldosAcreedorId: action.clienteId }

    /* ===== RESUMEN DE CTA CTE ===== */

    /* Con o sin el estado de la cuenta. Cambia lo que el documento dice, así que un resumen ya
       emitido deja de valer. Reelegir lo MISMO no toca nada. */
    case 'setResumenEstadoCtaCte': {
      if (state.resumenEstadoCtaCte === action.estado) return state
      if (generacionResumenEnVuelo(state)) return state
      /* Elegir NO INCLUIR saca "Facturas que debe" del recorrido. Si el avance quedó apuntando a
         esa etapa —se venía de un resumen CON estado—, se lo trae al último paso que sí existe:
         quedarse parado en una etapa que ya no está deja la navegación sin destino. */
      const recorrido = pasosDe(state.tipoOperacion, action.estado === 'INCLUIR')
      const paso = recorrido.includes(state.paso) ? state.paso : 'rangoFechas'
      return {
        ...resumenSinEmitir(state),
        resumenEstadoCtaCte: action.estado,
        paso,
        pasoMaxIdx: Math.min(state.pasoMaxIdx, recorrido.length - 1),
      }
    }

    /* El período. La lista anterior NO se borra acá: la clave de caché deja de coincidir y el paso la
       vuelve a leer, así la tabla no parpadea vacía entre una consulta y otra. Lo que sí deja de
       valer es un resumen ya emitido: era de otro período. */
    case 'setResumenRango':
      if (state.resumenRango === action.rango) return state
      if (generacionResumenEnVuelo(state)) return state
      return { ...resumenSinEmitir(state), resumenRango: action.rango }

    /* Llegaron los movimientos. Se aceptan SÓLO si siguen siendo del cliente y el período en curso:
       con dos consultas en vuelo —el usuario cambió de rango antes de que la primera volviera—, la
       que llega tarde traería la lista de un período que ya no es el elegido. */
    case 'setMovimientosCtaCte': {
      const vigente =
        state.cliente && state.resumenRango
          ? claveMovimientosCtaCte(state.cliente.id, state.resumenRango)
          : null
      if (action.clave !== null && action.clave !== vigente) return state
      return {
        ...state,
        movimientosCtaCte: action.resultado.movimientos,
        movimientosSinFecha: action.resultado.sinFecha,
        mercaderiaPendFacturar: action.resultado.mercaderiaPendFacturar,
        movimientosCtaCteClave: action.clave,
        ctaCteId: action.resultado.ctaCteId,
      }
    }

    /* Llegaron las facturas que debe el cliente. Se aceptan SÓLO si siguen siendo del cliente en
       curso: una respuesta que llega después de cambiar de cliente es de otra cuenta. */
    case 'setFacturasAdeudadas':
      if (state.cliente?.id !== action.clienteId) return state
      return {
        ...state,
        facturasAdeudadas: action.facturas,
        facturasAdeudadasClienteId: action.clienteId,
      }

    /* El formato del archivo. Con la generación en vuelo o ya emitida no se cambia: el archivo que
       se está armando —o que ya se armó— es del formato que se pidió. */
    case 'setResumenFormato':
      if (generacionResumenEnVuelo(state) || state.emisionResumen.fase === 'emitido') return state
      return { ...state, resumenFormato: action.formato }

    /* Se pidió la generación sobre ESTA cuenta: es de donde se despacha el envío. */
    case 'setResumenCtaCteId':
      return { ...state, resumenCtaCteId: action.id }

    /* Avance de la generación, tal como lo va reportando `useEmision`. */
    case 'setEmisionResumen':
      return { ...state, emisionResumen: { ...state.emisionResumen, ...action.emision } }


    /* ===== GESTIÓN DE COBRANZA =====
       Cambiar un criterio NO descarta el resultado que hay en pantalla: sigue siendo una lectura
       válida del tablero, sólo que de otra pregunta. Queda marcada como desactualizada —su clave ya
       no coincide con el criterio— y es la propia pantalla la que lo dice y ofrece volver a buscar.
       Borrarla habría dejado el tablero en blanco por tildar un chip. */
    case 'setCobranzaEstados':
      return {
        ...state,
        cobranzaCriterio: { ...state.cobranzaCriterio, estados: action.estados },
      }

    case 'setCobranzaTramos':
      return {
        ...state,
        cobranzaCriterio: { ...state.cobranzaCriterio, tramos: action.tramos },
      }

    /* "Buscar": se pide la consulta del criterio elegido. El resultado anterior se descarta ACÁ y no
       al cambiar un filtro, así lo que se ve es siempre o la respuesta a la pregunta en pantalla o
       nada: nunca la respuesta a otra haciéndose pasar por ésta.

       Un criterio incompleto no se pide: sin estado de saldo no hay cuentas que traer y sin tramo no
       hay facturas que listar (ver `criterioCompleto`). La pantalla lo explica; el reducer se limita
       a no salir a la red por algo que no se puede consultar. */
    case 'pedirCobranza':
      if (!criterioCompleto(state.cobranzaCriterio)) return state
      return {
        ...state,
        cobranzaResultado: null,
        cobranzaClave: null,
        cobranzaPedida: claveCobranza(state.cobranzaCriterio),
      }

    /* La respuesta llegó, y se guarda CON la clave del criterio que la trajo: es lo que después
       permite saber si sigue contestando lo que se pregunta. */
    case 'setCobranzaResultado':
      return { ...state, cobranzaResultado: action.resultado, cobranzaClave: action.clave }

    case 'agregarMovimientoPago':
      return {
        ...state,
        cobro: {
          ...state.cobro,
          confirmado: false,
          movimientos: [...state.cobro.movimientos, { ...action.movimiento, id: nuevoId() }],
        },
      }

    case 'removeMovimientoPago':
      return {
        ...state,
        cobro: {
          ...state.cobro,
          confirmado: false,
          movimientos: state.cobro.movimientos.filter((m) => m.id !== action.id),
        },
      }

    /* Editar el importe de un pago ya cargado: es la forma de llevar la DIFERENCIA a 0 sin quitar
       el movimiento. Igual que agregar o quitar, reabre la confirmación. El importe no se topea
       contra el total: pasarse es un error que se le muestra al usuario, no algo que la app
       corrija cambiándole el número que acaba de escribir. */
    case 'setMovimientoImporte':
      return {
        ...state,
        cobro: {
          ...state.cobro,
          confirmado: false,
          movimientos: state.cobro.movimientos.map((m) =>
            m.id === action.id ? { ...m, importe: round2(Math.max(action.importe, 0)) } : m,
          ),
        },
      }

    /* El cobro quedó registrado. Se despacha al avanzar de etapa, recién cuando la diferencia está
       en cero: no hay un botón aparte de "confirmar". */
    case 'confirmarCobro':
      return { ...state, cobro: { ...state.cobro, confirmado: true } }

    /* Llegaron los usuarios: se guardan y el selector deja de estar "Cargando…". Si todavía no hay
       responsable elegido, queda el que corresponde a la sesión. */
    /* El recibo quedó escrito en el tablero: su id es de donde se despacha el envío. */
    case 'setReciboId':
      return { ...state, reciboId: action.id }

    /* Avance de la emisión, tal como lo va reportando `useEmisionRecibo`. */
    case 'setEmision':
      return { ...state, emision: { ...state.emision, ...action.emision } }

    case 'setMedioEnvio':
      return { ...state, medioEnvio: action.value }

    case 'setContactos':
      return { ...state, contactos: action.contactos }

    /* Un contacto se agrega UNA sola vez: el picker ya no reofrece los elegidos, y esto cubre
       cualquier otra vía de agregado. */
    case 'addContacto':
      return state.contactos.some((c) => c.id === action.contacto.id)
        ? state
        : { ...state, contactos: [...state.contactos, action.contacto] }

    case 'removeContacto':
      return { ...state, contactos: state.contactos.filter((c) => c.id !== action.id) }

    case 'setDocumentoEnviado':
      return { ...state, documentoEnviado: action.value }

    case 'setLog':
      return { ...state, log: action.entries }

    case 'setUsuarios':
      return {
        ...state,
        usuarios: action.usuarios,
        usuariosCargando: false,
        usuario: state.usuario ?? usuarioPorDefecto(action.usuarios, state.usuarioActual),
      }

    case 'setUsuarioActual': {
      const conSesion = {
        ...state,
        usuarioActual: action.usuario,
        usuario: state.usuario ?? usuarioPorDefecto(state.usuarios, action.usuario),
      }
      /* Si el módulo en curso NO es de este usuario, se cierra y la app vuelve al paso inicial. En
         la práctica la sesión se resuelve antes de dibujar nada (ver `App.tsx`), pero la regla no
         puede depender de ese orden: si alguna vez se invierte, no queda nadie operando un módulo
         que no le corresponde. */
      const aFojaCero: AppState = {
        ...initialState,
        cobro: cobroVacio(),
        pago: pagoVacio(),
        usuarios: state.usuarios,
        usuariosCargando: state.usuariosCargando,
        usuarioActual: action.usuario,
        usuario: usuarioPorDefecto(state.usuarios, action.usuario),
      }
      if (conSesion.operacionApp && !puedeOperar(action.usuario, conSesion.operacionApp)) {
        return aFojaCero
      }
      /* En un pase, el lado se revisa contra el usuario: uno que no puede usar se cambia por su
         lado inicial —y lo cargado del otro lado se descarta, que es lo que hace `setPaseCuentasDe`—;
         y si todavía no había ninguno y le queda uno solo, nace puesto. */
      if (conSesion.operacionApp === 'PASES') {
        const actual = conSesion.paseCuentasDe
        if (actual === null || !puedePasarEntre(action.usuario, actual)) {
          const inicial = ladoInicialDePase(action.usuario)
          if (inicial) return reducer(conSesion, { type: 'setPaseCuentasDe', rol: inicial })
          /* Un lado vedado sin reemplazo único: no hay cómo seguir con lo cargado, y el pase se
             cierra entero en vez de quedar armado sobre cuentas que no le corresponden. */
          if (actual !== null) return aFojaCero
        }
      }
      return conSesion
    }

    case 'errorMonday':
      return { ...state, errorMonday: action.accion }

    case 'limpiarErrorMonday':
      return { ...state, errorMonday: null }

    /* Nueva operación desde cero. Los usuarios y la sesión NO se vuelven a pedir: se leen una sola
       vez al iniciar la app, así que se conservan y el responsable vuelve al de la sesión. */
    case 'reset':
      return {
        ...initialState,
        /* Vuelve al PASO INICIAL, con los dos selectores vacíos: cerrar una operación no encadena
           otra del mismo módulo, devuelve la app al punto donde se declara qué se va a hacer. Antes
           el módulo sobrevivía al cierre —era del encabezado y no de la operación—, y eso dejaba al
           usuario dentro del circuito anterior sin haberlo pedido. */
        operacionApp: null,
        operacionConfirmada: false,
        tipoOperacion: null,
        /* Cobro y pago NUEVOS, no los que quedaron armados al cargar el módulo: si la pestaña quedó
           abierta de un día para el otro, su fecha tiene que ser la de HOY. */
        cobro: cobroVacio(),
        pago: pagoVacio(),
        usuarios: state.usuarios,
        usuariosCargando: state.usuariosCargando,
        usuarioActual: state.usuarioActual,
        usuario: usuarioPorDefecto(state.usuarios, state.usuarioActual),
      }

    /* ===== MODULO DE PAGOS =====
       Los casos de abajo son el espejo de los de Cobros, con la misma mecánica de caché, de
       descarte al cambiar de sujeto y de reapertura de la confirmación. Lo que cambia son las
       claves sobre las que operan: no comparten una sola con el otro circuito. */

    case 'gotoPago': {
      /* Al ir a un paso se recuerda el índice MÁS AVANZADO alcanzado: volver atrás no lo baja, así
         el stepper deja volver a saltar hacia adelante a las etapas ya completadas. */
      const idx = indiceDePasoPago(action.paso, state.tipoOperacionPago)
      return {
        ...state,
        pasoPago: action.paso,
        pasoPagoMaxIdx: Math.max(state.pasoPagoMaxIdx, idx),
      }
    }

    /* Qué se paga. Hoy hay una sola opción, así que reelegirla no toca nada; el día que haya otra,
       cambiarla descarta lo armado con la anterior, igual que en `setTipoOperacion`. */
    case 'setTipoOperacionPago':
      if (state.tipoOperacionPago === action.tipo) return state
      return {
        ...state,
        tipoOperacionPago: action.tipo,
        pasoPagoMaxIdx: 0,
        /* Los tres datos del anticipo se descartan junto con el resto: lo cargado para un pago
           contra facturas no tiene dónde impactar en un anticipo, y al revés. */
        importeAnticipo: 0,
        detalleAnticipo: '',
        vencimientoAnticipo: '',
        /* Los anticipos y lo aplicado son de la APLICACIÓN: en los otros dos recorridos no tienen
           dónde impactar. Se descartan CON su clave de caché, o el paso los daría por leídos. */
        anticipos: [],
        anticiposClienteId: null,
        aplicaciones: {},
        facturasCompra: [],
        facturasCompraProveedorId: null,
        imputacionesPago: {},
        pago: pagoVacio(),
        ordenPagoId: null,
        emisionOP: EMISION_INICIAL,
      }

    /* Proveedor elegido en la etapa 1. Cambiarlo invalida todo lo que se haya alcanzado despues:
       las facturas y su imputacion son de ESE proveedor, asi que se descartan junto con el avance
       navegable. Reelegir el MISMO refresca sus datos sin tirar nada: su cuenta corriente pudo
       cambiar en el tablero entre una busqueda y otra, y de ella depende que se pueda operar. */
    case 'setProveedor':
      if (state.proveedor?.id === action.proveedor.id) {
        return { ...state, proveedor: action.proveedor }
      }
      return {
        ...state,
        proveedor: action.proveedor,
        pasoPagoMaxIdx: indiceDePasoPago('proveedor', state.tipoOperacionPago),
        /* La lista se descarta CON su clave de cache: dejarla puesta sobre una lista vacia haria
           que el paso la diera por leida y no volviera a consultar a Monday nunca. */
        facturasCompra: [],
        facturasCompraProveedorId: null,
        imputacionesPago: {},
        /* Los anticipos son de ESE proveedor: su saldo a favor no se le puede aplicar a otro. */
        anticipos: [],
        anticiposClienteId: null,
        aplicaciones: {},
        /* El pago es de ESE proveedor: sus cheques y sus transferencias no tienen sentido para
           otro, asi que se descarta entero junto con la imputacion. */
        pago: pagoVacio(),
        /* La orden y su envío también: el documento emitido era del proveedor anterior, y sus
           destinatarios son los contactos de ESE proveedor. */
        ordenPagoId: null,
        emisionOP: EMISION_INICIAL,
        contactos: [],
        documentoEnviado: false,
        log: [],
      }

    /* Llegaron las facturas del proveedor. Las imputaciones ya hechas se conservan SOLO si su
       factura sigue estando: al recargar puede haberse pagado alguna desde otro lado, y un importe
       imputado a una factura que ya no figura no tendria donde impactar. */
    case 'setFacturasCompra': {
      const vigentes = new Set(action.facturas.map((f) => f.id))
      const imputacionesPago = Object.fromEntries(
        Object.entries(state.imputacionesPago).filter(([id]) => vigentes.has(id)),
      )
      return {
        ...state,
        facturasCompra: action.facturas,
        facturasCompraProveedorId: action.proveedorId,
        imputacionesPago,
      }
    }

    /* Marcar/desmarcar una factura de compra. Al marcarla se propone pagarla ENTERA: el importe
       nace en su saldo pendiente, que es el caso habitual, y queda editable para pagar menos. Al
       desmarcarla se borra la clave: la seleccion y el importe son el mismo dato. */
    case 'toggleFacturaCompra': {
      const { [action.factura.id]: actual, ...resto } = state.imputacionesPago
      const pago = reabrirPago(state.pago)
      if (actual !== undefined) return { ...state, imputacionesPago: resto, pago }
      return {
        ...state,
        imputacionesPago: {
          ...state.imputacionesPago,
          [action.factura.id]: action.factura.pendiente,
        },
        pago,
      }
    }

    /* Importe a pagar de una factura ya seleccionada. NO se topea contra el saldo: pasarse es un
       error que se le muestra al usuario (borde rojo en el input y bloqueo al continuar), no algo
       que la app corrija por su cuenta cambiandole el numero que acaba de escribir. */
    case 'setImporteFacturaCompra': {
      if (!(action.id in state.imputacionesPago)) return state
      return {
        ...state,
        imputacionesPago: {
          ...state.imputacionesPago,
          [action.id]: round2(Math.max(action.importe, 0)),
        },
        pago: reabrirPago(state.pago),
      }
    }

    /* Una caja cargada en el formulario de la etapa 3. Llega ya validada -el formulario no deja
       agregar un movimiento incompleto-, asi que aca solo se le pone el id y se reabre el pago. */
    case 'agregarMovimientoCaja': {
      const nuevo = { ...action.movimiento, id: nuevoId() }
      /* La RETENCIÓN no suma dinero: se DESCUENTA en partes iguales de las cajas ya registradas,
         porque es plata que en vez de entregarse se le ingresa al fisco (ver `descontarRetencion`).
         Así el total pagado no se mueve y el pago sigue cerrando en cero.

         El reparto se aplica ACÁ y no en el formulario para que la regla no dependa de la pantalla:
         si no entra —alguna caja quedaría sin importe— la acción no hace nada, con el mismo criterio
         con el que `setMovimientoCajaImporte` ignora un cheque. El formulario lo comprueba antes
         para poder explicarlo; esto es el cerrojo. */
      const previos = esRetencionGAN(nuevo.formaPago)
        ? descontarRetencion(state.pago.movimientos, nuevo.importe)
        : [...state.pago.movimientos]
      if (!previos) return state
      return {
        ...state,
        pago: { ...state.pago, confirmado: false, movimientos: [...previos, nuevo] },
      }
    }

    case 'removeMovimientoCaja':
      return {
        ...state,
        pago: {
          ...state.pago,
          confirmado: false,
          movimientos: state.pago.movimientos.filter((m) => m.id !== action.id),
        },
      }

    /* Editar el importe de una caja ya cargada: es la forma de llevar la DIFERENCIA a 0 sin quitar
       el movimiento. Igual que agregar o quitar, reabre la confirmacion.

       El CHEQUE y la RETENCIÓN quedan afuera: el importe de uno es el del documento que se entrega
       y el de la otra sale de una fórmula fiscal —ninguno es una cifra a ajustar—. La tabla ya no
       ofrece editarlos (ver `importeFijoDeCaja`), y acá se vuelve a impedir para que la regla no
       dependa de la pantalla: es la misma razón por la que el vencimiento de un cheque se revisa en
       el bloqueo del paso además de en el formulario. */
    case 'setMovimientoCajaImporte': {
      const objetivo = state.pago.movimientos.find((m) => m.id === action.id)
      if (!objetivo || esCajaCheque(objetivo.formaPago) || esRetencionGAN(objetivo.formaPago)) {
        return state
      }
      return {
        ...state,
        pago: {
          ...state.pago,
          confirmado: false,
          movimientos: state.pago.movimientos.map((m) =>
            m.id === action.id ? { ...m, importe: round2(Math.max(action.importe, 0)) } : m,
          ),
        },
      }
    }

    /* El pago quedo registrado. Se despacha al confirmar, recien cuando la diferencia esta en cero
       exacto: no hay un boton aparte que se pueda apretar antes. */
    case 'confirmarPago':
      return { ...state, pago: { ...state.pago, confirmado: true } }

    /* La orden quedó escrita en el tablero: su id es de donde se despacha el envío. */
    case 'setOrdenPagoId':
      return { ...state, ordenPagoId: action.id }

    /* Avance de la emisión de la orden, tal como lo va reportando el hook. */
    case 'setEmisionOP':
      return { ...state, emisionOP: { ...state.emisionOP, ...action.emision } }

    default:
      return state
  }
}
