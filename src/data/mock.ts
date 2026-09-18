/**
 * Datos de prueba para trabajar sin token de Monday (desarrollo local). Los servicios devuelven
 * esto cuando `mondayHabilitado()` es falso, así la app se puede recorrer entera sin cuenta.
 */
import { EQUIPO_PAGO_PROVEEDORES_ID } from '@/lib/permisos'
import type { ClaseMovimiento } from '@/lib/resumenCtaCte'
import type {
  AnticipoPendiente,
  ChequeEnCartera,
  Cliente,
  Contacto,
  CuentaPropia,
  EstadoSaldo,
  FacturaCompraPendiente,
  FacturaPendiente,
  Proveedor,
  SaldosCliente,
  TramoVencimiento,
  Usuario,
  UsuarioActual,
} from '@/types'

/**
 * Quién es el usuario en el MODO LOCAL, sin token. Es uno de `USUARIOS` —así el selector de vendedor
 * lo encuentra— y está en el equipo "Pago a Proveedores" para que el prototipo se pueda recorrer
 * entero. Nunca se usa en producción (ver `getUsuarioActual`).
 */
export const USUARIO_LOCAL: UsuarioActual = {
  id: '1001',
  name: 'Luciano Torres',
  isAdmin: true,
  equipos: ['Administradores', 'Pago a Proveedores'],
  equipoIds: [EQUIPO_PAGO_PROVEEDORES_ID],
}

export const USUARIOS: Usuario[] = [
  { id: '1001', ini: 'LT', name: 'Luciano Torres', color: 'var(--avatar-orange)' },
  { id: '1002', ini: 'MS', name: 'María Silva', color: 'var(--red)' },
  { id: '1003', ini: 'JG', name: 'Javier Gómez', color: 'var(--green)' },
  { id: '1004', ini: 'PR', name: 'Paula Ríos', color: '#575ce5' },
  { id: '1005', ini: 'DC', name: 'Diego Cabrera', color: 'var(--primary-blue)' },
]

/**
 * Clientes de prueba. Cubren los casos que el paso 1 tiene que saber resolver: cuenta corriente con
 * deuda (el crédito rige), contado (el límite no rige y la ficha lo aclara), cliente al que le
 * faltan datos en el board y cliente bloqueado.
 */
export const CLIENTES: Cliente[] = [
  {
    id: '4192',
    codigo: '4192',
    name: 'La Batea S.A.',
    cuit: '30-71234567-8',
    ptype: 'Persona Jurídica',
    status: 'Responsable Inscripto',
    list: 'L1',
    ret: 'IVA',
    agenteRetencion: false,
    categorias: ['Clientes'],
    condicionPago: 'CUENTA CORRIENTE',
    aceptaCheques: true,
    limit: 4_500_000,
    saldoCtaCte: 4_200_000,
    lineaUtilizada: 4_200_000,
    remitosPendFacturar: 0,
    disponible: 300_000,
    addr: 'Av. Siempre Viva 1234, CABA',
    activity: 'Activo',
    situation: 'Liberado con crédito',
  },
  {
    id: '8271',
    codigo: '8271',
    name: 'Global Tech LLC',
    cuit: '30-55554444-1',
    ptype: 'Persona Jurídica',
    status: 'Responsable Inscripto',
    list: 'L2',
    ret: 'IIBB',
    agenteRetencion: true,
    categorias: ['Clientes'],
    condicionPago: 'CONTADO',
    // No recibimos cheques de este cliente: el medio queda inhabilitado en el cobro.
    aceptaCheques: false,
    limit: 2_000_000,
    saldoCtaCte: 1_500_000,
    lineaUtilizada: 1_500_000,
    remitosPendFacturar: 0,
    disponible: 500_000,
    addr: 'Calle Falsa 123, CABA',
    activity: 'Activo',
    situation: 'Liberado sin crédito',
  },
  {
    id: '3948',
    codigo: '3948',
    name: 'Distribuidora Sur',
    cuit: '33-11223344-9',
    ptype: 'Persona Física',
    status: 'Monotributo',
    list: 'L3',
    ret: 'Ninguna',
    agenteRetencion: false,
    categorias: ['Clientes'],
    condicionPago: 'CUENTA CORRIENTE',
    aceptaCheques: true,
    limit: 500_000,
    saldoCtaCte: 50_000,
    lineaUtilizada: 50_000,
    remitosPendFacturar: 120_000,
    disponible: 330_000,
    addr: 'Ruta 3 km 42, Bahía Blanca',
    activity: 'Activo',
    situation: 'Liberado con crédito',
  },
  {
    id: '5510',
    codigo: '5510',
    name: 'Agro Norte S.R.L.',
    cuit: '30-99887766-2',
    ptype: 'Persona Jurídica',
    status: 'Responsable Inscripto',
    // Sin lista de precio ni condición de pago: el paso 1 lo frena y nombra los datos que faltan.
    list: null,
    ret: 'Ninguna',
    agenteRetencion: false,
    categorias: ['Clientes'],
    condicionPago: null,
    aceptaCheques: true,
    limit: 900_000,
    saldoCtaCte: 780_000,
    lineaUtilizada: 780_000,
    remitosPendFacturar: 0,
    disponible: 120_000,
    addr: 'Parque Industrial, Salta',
    activity: 'Activo',
    situation: 'Liberado sin crédito',
  },
  {
    id: '6720',
    codigo: '6720',
    name: 'Cerealera del Este',
    cuit: '30-44556677-3',
    ptype: 'Persona Jurídica',
    status: 'Responsable Inscripto',
    list: 'L4',
    ret: 'Ninguna',
    agenteRetencion: false,
    categorias: ['Clientes'],
    condicionPago: 'CUENTA CORRIENTE',
    aceptaCheques: true,
    limit: 1_000_000,
    saldoCtaCte: 1_250_000,
    lineaUtilizada: 1_250_000,
    remitosPendFacturar: 0,
    disponible: 0,
    addr: 'Av. Costanera 900, Rosario',
    activity: 'Activo',
    // Bloqueado en el board: el paso 1 lo deja buscar, pero no avanzar.
    situation: 'Bloqueado',
  },
]

/**
 * Facturas pendientes de cobro de prueba. Cubren los dos estados cobrables: pendiente al 100% y
 * cancelada parcialmente (con su porcentaje histórico ya cobrado).
 */
export const FACTURAS_PENDIENTES: FacturaPendiente[] = [
  {
    id: 'f-1',
    nro: 'FPENCOB-042',
    idVenta: 'VTA-087',
    emision: '2026-06-15',
    vencimiento: '2026-07-15',
    total: 519_675.16,
    cobrado: 100_000,
    cobradoPct: 19,
    pendiente: 419_675.16,
    estado: 'Cancelada Parcialmente',
    parcial: true,
  },
  {
    id: 'f-2',
    nro: 'FPENCOB-043',
    idVenta: 'VTA-088',
    emision: '2026-06-19',
    vencimiento: '2026-07-19',
    total: 196_571.76,
    cobrado: 0,
    cobradoPct: 0,
    pendiente: 196_571.76,
    estado: 'Pend de Cobrar 100%',
    parcial: false,
  },
  {
    id: 'f-3',
    nro: 'FPENCOB-044',
    idVenta: 'VTA-091',
    emision: '2026-07-11',
    vencimiento: '2026-08-10',
    total: 192_640.32,
    cobrado: 0,
    cobradoPct: 0,
    pendiente: 192_640.32,
    estado: 'Pend de Cobrar 100%',
    parcial: false,
  },
  {
    id: 'f-4',
    nro: 'FPENCOB-045',
    idVenta: 'VTA-094',
    emision: '2026-07-25',
    vencimiento: '2026-08-24',
    total: 261_368.09,
    cobrado: 130_684.05,
    cobradoPct: 50,
    pendiente: 130_684.04,
    estado: 'Cancelada Parcialmente',
    parcial: true,
  },
  {
    id: 'f-5',
    nro: 'FPENCOB-046',
    idVenta: '',
    /* Sin venta vinculada: ni emisión ni vencimiento. El recibo muestra "—" en esas dos columnas. */
    emision: '',
    vencimiento: '',
    total: 165_086.23,
    cobrado: 0,
    cobradoPct: 0,
    pendiente: 165_086.23,
    estado: 'Pend de Cobrar 100%',
    parcial: false,
  },
]

/**
 * Cuentas bancarias propias de prueba: el destino de una transferencia y el banco de acreditación
 * de una tarjeta. Sin ellas, en modo local esos dos medios de cobro no se podrían cargar.
 */
export const CUENTAS_PROPIAS: CuentaPropia[] = [
  { id: 'cp-1', name: 'Galicia · Cta Cte $ 4000-1 220-7' },
  { id: 'cp-2', name: 'Santander · Cta Cte $ 191-000123/4' },
  { id: 'cp-3', name: 'Nación · Caja de Ahorro $ 0290-33445' },
]

/**
 * Contactos de prueba del cliente. Cubren los casos que el envío tiene que saber resolver: quien
 * acepta el recibo, quien no, y quien no tiene alguno de los dos datos de contacto.
 */
export const CONTACTOS_INICIALES: Contacto[] = [
  {
    id: 'CONTACT-001',
    itemId: '9001',
    name: 'María Fernanda Gómez',
    phone: '+54 9 11 2345 6789',
    email: 'maria.gomez@labatea.com.ar',
    ini: 'MG',
    color: '#0073ea',
    status: 'ACEPTA RECIBO',
    ok: true,
  },
  {
    id: 'CONTACT-002',
    itemId: '9002',
    name: 'Juan Pablo López',
    phone: '+54 9 11 9876 5432',
    email: '',
    ini: 'JL',
    color: '#0073ea',
    status: 'ACEPTA RECIBO',
    ok: true,
  },
  {
    id: 'CONTACT-003',
    itemId: '9003',
    name: 'Carla Beatriz Ruiz',
    phone: '',
    email: 'carla.ruiz@labatea.com.ar',
    ini: 'CR',
    color: '#0073ea',
    status: 'NO ACEPTA RECIBO',
    ok: false,
  },
]

/**
 * Anticipos de prueba con saldo a favor. Cubren los casos del paso: saldo entero sin usar, saldo
 * parcialmente aplicado y un importe chico que obliga a combinar dos anticipos para cubrir una
 * factura.
 */
export const ANTICIPOS_PENDIENTES: AnticipoPendiente[] = [
  {
    id: 'a-1',
    nombre: 'Anticipo - REC1001',
    fecha: '2026-09-01',
    importe: 2500,
    pendiente: 2500,
    comentario: 'Pago inicial recibido',
  },
  {
    id: 'a-2',
    nombre: 'Anticipo - REC1002',
    fecha: '2026-09-05',
    importe: 1800,
    pendiente: 1800,
    comentario: 'Monto parcial pendiente',
  },
  {
    id: 'a-3',
    nombre: 'Anticipo - REC1004',
    fecha: '2026-08-20',
    importe: 5000,
    // Ya se aplicaron $ 1.800: lo que queda es lo único imputable.
    pendiente: 3200,
    comentario: 'Saldo a favor por devolución',
  },
]

/**
 * Saldos de cuenta corriente del cliente. Los dos son consistentes con el resto del mock: el
 * pendiente de cancelar acompaña a las facturas de `FACTURAS_PENDIENTES` y los anticipos, al saldo
 * a favor de `ANTICIPOS_PENDIENTES`.
 */
export const SALDOS_CLIENTE: SaldosCliente = {
  pendienteDeCancelar: 272513.05,
  anticipos: 8000,
}


/* ===== MÓDULO DE PAGOS ===== */

/**
 * Proveedores de prueba. Cubren los DOS casos que la etapa 1 tiene que saber resolver: el que opera
 * en cuenta corriente CON su cuenta asignada —el único con el que se puede cancelar una factura de
 * compra— y el que opera en cuenta corriente SIN ella, que es el que dispara el bloqueo.
 *
 * El tercero opera al contado: sirve para ver que la restricción de negocio lo deja afuera igual,
 * aunque tenga cuenta.
 */
export const PROVEEDORES: Proveedor[] = [
  {
    id: 'p-1',
    codigo: '1098',
    name: 'Anbinder Aldo N.',
    cuit: '20-12345678-9',
    ptype: 'Persona Física',
    status: 'Responsable Inscripto',
    list: null,
    ret: 'Ninguna',
    agenteRetencion: false,
    categorias: ['Proveedores'],
    condicionPago: 'CUENTA CORRIENTE',
    aceptaCheques: true,
    limit: 0,
    saldoCtaCte: 1_480_000,
    lineaUtilizada: 1_480_000,
    remitosPendFacturar: 0,
    disponible: 0,
    addr: 'Ruta 8 km 122, Pergamino',
    activity: 'Activo',
    situation: 'Liberado sin crédito',
    tieneCtaCte: true,
  },
  {
    id: 'p-2',
    codigo: '1491',
    name: 'Domingo Gonzalez y Cia S.A.',
    cuit: '30-58884422-7',
    ptype: 'Persona Jurídica',
    status: 'Responsable Inscripto',
    list: null,
    ret: 'Ninguna',
    agenteRetencion: false,
    categorias: ['Proveedores'],
    condicionPago: 'CUENTA CORRIENTE',
    aceptaCheques: true,
    limit: 0,
    saldoCtaCte: 0,
    lineaUtilizada: 0,
    remitosPendFacturar: 0,
    disponible: 0,
    addr: 'Av. Mitre 2200, Rosario',
    activity: 'Activo',
    situation: 'Liberado sin crédito',
    /* Sin cuenta corriente conectada: opera en cuenta corriente pero el sistema no tiene dónde
       imputarle el movimiento, así que la etapa 1 lo frena. */
    tieneCtaCte: false,
  },
  {
    id: 'p-3',
    codigo: '1492',
    name: 'Saplda S.R.L.',
    cuit: '30-71119988-4',
    ptype: 'Persona Jurídica',
    status: 'Responsable Inscripto',
    list: null,
    ret: 'Ninguna',
    agenteRetencion: false,
    categorias: ['Proveedores'],
    condicionPago: 'PROVEED CONTADO',
    aceptaCheques: true,
    limit: 0,
    saldoCtaCte: 0,
    lineaUtilizada: 0,
    remitosPendFacturar: 0,
    disponible: 0,
    addr: 'Colectora Oeste 4500, San Nicolás',
    activity: 'Activo',
    situation: 'Liberado sin crédito',
    tieneCtaCte: true,
  },
]

/**
 * Facturas de compra pendientes de prueba. Espejo de `FACTURAS_PENDIENTES`: una pagada en parte,
 * varias enteras por pagar y una sin vencimiento cargado, que es la que muestra "—" en su columna
 * y en sus días de mora.
 */
export const FACTURAS_COMPRA_PENDIENTES: FacturaCompraPendiente[] = [
  {
    id: 'fc-1',
    nro: 'FC-A-0001-00004521',
    vencimiento: '2026-07-20',
    total: 843_200.5,
    totalFactura: 843_200.5,
    importeNeto: 696_860,
    pagado: 300_000,
    pagadoPct: 36,
    pendiente: 543_200.5,
    estado: 'Cancelada Parcialmente',
    parcial: true,
  },
  {
    id: 'fc-2',
    nro: 'FC-A-0003-00000188',
    vencimiento: '2026-08-05',
    total: 291_450,
    totalFactura: 291_450,
    importeNeto: 240_868,
    pagado: 0,
    pagadoPct: 0,
    pendiente: 291_450,
    estado: 'Pend de Pagar 100%',
    parcial: false,
  },
  {
    id: 'fc-3',
    nro: 'FC-B-0002-00009017',
    vencimiento: '2026-09-12',
    total: 158_900.75,
    totalFactura: 158_900.75,
    importeNeto: 131_322,
    pagado: 0,
    pagadoPct: 0,
    pendiente: 158_900.75,
    estado: 'Pend de Pagar 100%',
    parcial: false,
  },
  {
    id: 'fc-4',
    nro: 'FC-A-0001-00004610',
    vencimiento: '',
    total: 76_300,
    totalFactura: 76_300,
    importeNeto: null,
    pagado: 0,
    pagadoPct: 0,
    pendiente: 76_300,
    estado: 'Pend de Pagar 100%',
    parcial: false,
  },
]

/**
 * Cheques de terceros en cartera, de prueba. Todos en estado "Pendiente": el servicio no trae otros,
 * así que el mock no puede tenerlos sin mentir sobre lo que la pantalla recibe.
 */
export const CHEQUES_EN_CARTERA: ChequeEnCartera[] = [
  {
    id: 'ch-1',
    codigo: 'CHEQUE-07',
    numero: '00123456',
    importe: 350_000,
    vencimiento: '2026-09-05',
    /* 30 días antes del vencimiento, que es la relación entre las dos fechas. */
    fechaPago: '2026-08-06',
    emision: '2026-07-05',
    banco: 'Banco Galicia',
    cuitEmisor: '30-70011122-3',
    tipo: 'Cheque',
    estado: 'Pendiente',
    idRecibo: 'RECIBO-078',
    idPago: 'IDPAGO-012',
  },
  {
    id: 'ch-2',
    codigo: 'CHEQUE-11',
    numero: '00987654',
    importe: 543_200.5,
    vencimiento: '2026-09-28',
    /* 30 días antes del vencimiento, que es la relación entre las dos fechas. */
    fechaPago: '2026-08-29',
    emision: '2026-07-28',
    banco: 'Banco Credicoop',
    cuitEmisor: '27-25488991-0',
    tipo: 'eCheq',
    estado: 'Pendiente',
    idRecibo: 'RECIBO-081',
    idPago: 'IDPAGO-014',
  },
  {
    id: 'ch-3',
    codigo: 'CHEQUE-14',
    numero: '00456789',
    importe: 120_000,
    vencimiento: '2026-10-15',
    /* 30 días antes del vencimiento, que es la relación entre las dos fechas. */
    fechaPago: '2026-09-15',
    emision: '2026-08-15',
    banco: 'Banco Nación',
    cuitEmisor: '30-58884422-7',
    tipo: 'Cheque',
    estado: 'Pendiente',
    idRecibo: 'RECIBO-090',
    idPago: '',
  },
]

/**
 * Anticipos de prueba con saldo a favor NUESTRO con el proveedor. Cubren los dos casos que la etapa
 * de aplicación tiene que saber resolver: uno entero sin usar y otro ya aplicado en parte, que es el
 * que llega con menos saldo del que nació.
 */
export const ANTICIPOS_PENDIENTES_PROVEEDOR: AnticipoPendiente[] = [
  {
    id: 'apr-1',
    nombre: 'Anticipo - ANTICIPO-04',
    fecha: '2026-07-02',
    importe: 400_000,
    pendiente: 400_000,
    comentario: 'Adelanto por compra de insumos',
  },
  {
    id: 'apr-2',
    nombre: 'Anticipo - ANTICIPO-09',
    fecha: '2026-08-11',
    importe: 250_000,
    pendiente: 150_000,
    comentario: 'Saldo de una entrega anterior',
  },
]

/**
 * Parámetros de prueba de la retención de Ganancias, los mismos que en producción salen del board
 * "⚙️Configuracion - Sistema". Con estos números una factura de 843.200 con neto de 696.860 retiene
 * bastante más que el mínimo, así que el prototipo se puede recorrer entero sin cuenta de Monday.
 */
/**
 * Con qué número nace la retención en el modo local. Es el que sigue al último del tablero real, así
 * el prototipo escribe una línea con la misma forma que la de producción.
 */
export const NRO_RETENCION_MOCK = 'RETENC-005'

export const PARAMETROS_RETENCION_MOCK = {
  baseNoImponible: 67_170,
  alicuota: 2,
  /* El id real de la fila "Config calculo de Retencion a Imp Ganancias" del tablero: así el modo
     local arma exactamente el mismo subelemento que el modo con token. */
  itemId: '12912259087',
}

/* ===== MÓDULO DE RESUMEN DE CTA CTE ===== */

/**
 * Movimientos de prueba de la cuenta corriente del cliente, tal como los devuelve el tablero ANTES
 * de filtrarlos por período y de nombrarlos. La fecha va como DÍAS HACIA ATRÁS desde hoy —y no
 * fija— para que cada rango del selector muestre algo distinto el día que se abra el prototipo.
 *
 * Cubren cada regla de nombre (ver `comprobanteDeMovimiento`): saldo inicial, ventas con su factura,
 * cobros con el nombre interno del tablero, un anticipo con su ID, un crédito por pase de saldo,
 * un movimiento viejo que sólo entra en el último año y uno sin fecha de emisión.
 */
export const MOVIMIENTOS_CTA_CTE_MOCK: {
  id: string
  nombre: string
  clase: ClaseMovimiento
  /** Etiqueta de "🤖Movimiento", tal como la publica el tablero. */
  tipo: string
  diasAtras: number | null
  factura?: { nro: string; venceEnDias: number }
  idAnticipo?: string
  saldoInicial: number
  ventas: number
  cobros: number
}[] = [
  {
    id: 'm-0',
    nombre: 'Movimiento - Saldo Inicial - 4192 - La Batea S.A.',
    clase: 'saldoInicial',
    tipo: 'Saldo Inicial',
    diasAtras: 300,
    saldoInicial: 0,
    ventas: 150_000,
    cobros: 0,
  },
  {
    id: 'm-1',
    nombre: 'Movimiento - VTA-090 - 4192 - La Batea S.A.',
    clase: 'venta',
    tipo: 'Vta Pend de Cobro',
    diasAtras: 200,
    factura: { nro: 'VTA-090', venceEnDias: -170 },
    saldoInicial: 150_000,
    ventas: 1_100_000,
    cobros: 0,
  },
  {
    id: 'm-2',
    nombre: 'Mov - Recibo - RECIBO-061 - 4192 - La Batea S.A.',
    clase: 'cobro',
    tipo: 'Cobro',
    diasAtras: 52,
    saldoInicial: 1_250_000,
    ventas: 0,
    cobros: 850_000,
  },
  {
    id: 'm-3',
    nombre: 'Movimiento - VTA-104 - 4192 - La Batea S.A.',
    clase: 'venta',
    tipo: 'Vta Pend de Cobro',
    diasAtras: 38,
    factura: { nro: 'VTA-104', venceEnDias: -8 },
    saldoInicial: 400_000,
    ventas: 2_380_000,
    cobros: 0,
  },
  {
    id: 'm-4',
    nombre: 'Anticipo - RECIBO-066',
    clase: 'anticipo',
    tipo: 'Anticipo',
    diasAtras: 21,
    idAnticipo: 'ANTICIPO-015',
    saldoInicial: 2_780_000,
    ventas: 0,
    cobros: 180_000,
  },
  {
    id: 'm-5',
    nombre: 'Movimiento - VTA-111 - 4192 - La Batea S.A.',
    clase: 'venta',
    tipo: 'Vta Pend de Cobro',
    diasAtras: 9,
    factura: { nro: 'VTA-111', venceEnDias: 21 },
    saldoInicial: 2_600_000,
    ventas: 1_600_000,
    cobros: 0,
  },
  {
    id: 'm-6',
    nombre: 'Mov - Credito x Pase de Saldo - RECIBO-063 - 4192 - La Batea S.A.',
    clase: 'creditoPase',
    tipo: 'Credito x Pase de Saldo',
    diasAtras: 6,
    saldoInicial: 4_200_000,
    ventas: 0,
    cobros: 200_000,
  },
  {
    id: 'm-7',
    nombre: 'Recibo - RECIBO-072 - 4192 - La Batea S.A.',
    clase: 'cobro',
    tipo: 'Cobro',
    diasAtras: 3,
    saldoInicial: 4_000_000,
    ventas: 0,
    cobros: 500_000,
  },
  {
    id: 'm-8',
    nombre: 'Movimiento - VTA-075 - 4192 - La Batea S.A.',
    clase: 'venta',
    tipo: 'Vta Pend de Cobro',
    diasAtras: null,
    saldoInicial: 0,
    ventas: 0,
    cobros: 0,
  },
]

/** "🤖Remito Pends de Facturar" de prueba de la cuenta: la mercadería entregada y sin facturar. */
export const MERCADERIA_PEND_FACTURAR_MOCK = 286_621.81

/**
 * Cuentas corrientes de prueba de la GESTIÓN DE COBRANZA, tal como las devuelve el tablero ANTES de
 * filtrarlas por criterio. Cubren lo que el tablero tiene que saber mostrar:
 *
 *   · los TRES estados de saldo ("Saldo a Cobrar", "Saldo Cero" y "Saldo a Favor"), así los chips
 *     del primer criterio cambian de verdad lo que se lista;
 *   · los CINCO tramos de vencimiento repartidos entre las cuentas, para que la batería y el
 *     ranking tengan algo que repartir;
 *   · una cuenta con saldo declarado y SIN facturas en ningún tramo (la deuda vive en otra parte);
 *   · una cuenta SIN límite de crédito, donde el uso de la línea no se puede calcular;
 *   · una factura SIN vencimiento cargado, que no cae en ningún tramo.
 *
 * Las fechas van como DÍAS respecto de HOY —y no fijas— para que el prototipo muestre siempre una
 * mora coherente con el tramo de cada factura, el día que se abra.
 */
export const CUENTAS_COBRANZA_MOCK: {
  /** ID del ítem de la cuenta y su "🤖ID Cta Cte". */
  id: string
  nro: string
  /** El cliente conectado. Sin `clienteId` la cuenta cuenta como "sin cliente conectado". */
  clienteId: string
  cliente: string
  codigo: string
  estado: EstadoSaldo
  ventasPendCancelar: number
  anticipos: number
  limite: number
  mercaderiaPendFacturar: number
  facturas: {
    id: string
    nro: string
    tramo: TramoVencimiento | null
    /** Hace cuántos días se emitió y en cuántos vence (negativo = ya venció). */
    emitidaHaceDias: number
    venceEnDias: number | null
    importe: number
    cobrado: number
  }[]
}[] = [
  {
    id: 'cc-1',
    nro: 'CTACTE-018',
    clienteId: '4192',
    cliente: 'La Batea S.A.',
    codigo: '4192',
    estado: 'aCobrar',
    ventasPendCancelar: 4_200_000,
    anticipos: 0,
    limite: 4_500_000,
    mercaderiaPendFacturar: 0,
    facturas: [
      { id: 'cf-1', nro: 'VTA-087', tramo: 'vencidoMas60', emitidaHaceDias: 120, venceEnDias: -90, importe: 1_519_675.16, cobrado: 100_000 },
      { id: 'cf-2', nro: 'VTA-088', tramo: 'vencido30a60', emitidaHaceDias: 75, venceEnDias: -45, importe: 1_196_571.76, cobrado: 0 },
      { id: 'cf-3', nro: 'VTA-091', tramo: 'vencido0a15', emitidaHaceDias: 38, venceEnDias: -8, importe: 992_640.32, cobrado: 200_000 },
      { id: 'cf-4', nro: 'VTA-094', tramo: 'noVencido', emitidaHaceDias: 12, venceEnDias: 18, importe: 861_368.09, cobrado: 0 },
    ],
  },
  {
    id: 'cc-2',
    nro: 'CTACTE-024',
    clienteId: '8271',
    cliente: 'Global Tech LLC',
    codigo: '8271',
    estado: 'aCobrar',
    ventasPendCancelar: 1_500_000,
    anticipos: 0,
    limite: 2_000_000,
    mercaderiaPendFacturar: 0,
    facturas: [
      { id: 'cf-5', nro: 'VTA-101', tramo: 'vencido15a30', emitidaHaceDias: 50, venceEnDias: -20, importe: 780_411.4, cobrado: 0 },
      { id: 'cf-6', nro: 'VTA-104', tramo: 'noVencido', emitidaHaceDias: 6, venceEnDias: 24, importe: 719_588.6, cobrado: 0 },
    ],
  },
  {
    id: 'cc-3',
    nro: 'CTACTE-031',
    clienteId: '6720',
    cliente: 'Cerealera del Este',
    codigo: '6720',
    estado: 'aCobrar',
    ventasPendCancelar: 1_250_000,
    anticipos: 0,
    /* Por encima del límite: el uso de la línea pasa el 100% y el semáforo lo tiene que decir. */
    limite: 1_000_000,
    mercaderiaPendFacturar: 0,
    facturas: [
      { id: 'cf-7', nro: 'VTA-066', tramo: 'vencidoMas60', emitidaHaceDias: 210, venceEnDias: -180, importe: 640_000, cobrado: 90_000 },
      { id: 'cf-8', nro: 'VTA-072', tramo: 'vencido30a60', emitidaHaceDias: 80, venceEnDias: -50, importe: 700_000, cobrado: 0 },
    ],
  },
  {
    id: 'cc-4',
    nro: 'CTACTE-037',
    clienteId: '5510',
    cliente: 'Agro Norte S.R.L.',
    codigo: '5510',
    estado: 'aCobrar',
    ventasPendCancelar: 780_000,
    anticipos: 0,
    limite: 900_000,
    mercaderiaPendFacturar: 0,
    facturas: [
      { id: 'cf-9', nro: 'VTA-098', tramo: 'vencido0a15', emitidaHaceDias: 34, venceEnDias: -4, importe: 520_000, cobrado: 0 },
      /* Sin vencimiento cargado: el tablero no le puso tramo, así que no se cuenta como vencida. */
      { id: 'cf-10', nro: 'VTA-099', tramo: null, emitidaHaceDias: 20, venceEnDias: null, importe: 260_000, cobrado: 0 },
    ],
  },
  {
    id: 'cc-5',
    nro: 'CTACTE-042',
    clienteId: '3948',
    cliente: 'Distribuidora Sur',
    codigo: '3948',
    estado: 'aCobrar',
    ventasPendCancelar: 50_000,
    anticipos: 0,
    /* Sin límite asignado: el uso de la línea no se puede calcular y la columna muestra "—". */
    limite: 0,
    mercaderiaPendFacturar: 120_000,
    facturas: [
      { id: 'cf-11', nro: 'VTA-112', tramo: 'noVencido', emitidaHaceDias: 3, venceEnDias: 27, importe: 50_000, cobrado: 0 },
    ],
  },
  {
    id: 'cc-6',
    nro: 'CTACTE-050',
    clienteId: '9134',
    cliente: 'Molinos del Litoral S.A.',
    codigo: '9134',
    estado: 'aCobrar',
    /* Declara deuda pero no tiene facturas pendientes en el tablero: la fila aparece igual, en cero,
       y es justamente el caso que el tablero tiene que poder mostrar. */
    ventasPendCancelar: 310_000,
    anticipos: 0,
    limite: 600_000,
    mercaderiaPendFacturar: 0,
    facturas: [],
  },
  {
    id: 'cc-7',
    nro: 'CTACTE-055',
    clienteId: '7702',
    cliente: 'Semillera Pampeana',
    codigo: '7702',
    estado: 'cero',
    ventasPendCancelar: 0,
    anticipos: 0,
    limite: 400_000,
    mercaderiaPendFacturar: 0,
    facturas: [],
  },
  {
    id: 'cc-8',
    nro: 'CTACTE-061',
    clienteId: '6188',
    cliente: 'Forrajes del Oeste',
    codigo: '6188',
    estado: 'aFavor',
    ventasPendCancelar: 0,
    anticipos: 420_000,
    limite: 700_000,
    mercaderiaPendFacturar: 0,
    facturas: [],
  },
  {
    id: 'cc-9',
    nro: 'CTACTE-066',
    /* Sin cliente conectado: no hay a quién pedirle las facturas, así que la cuenta queda afuera del
       listado y se cuenta aparte (ver `ResultadoCobranza.sinCliente`). */
    clienteId: '',
    cliente: 'CTACTE-066 - sin cliente conectado',
    codigo: '',
    estado: 'aCobrar',
    ventasPendCancelar: 95_000,
    anticipos: 0,
    limite: 0,
    mercaderiaPendFacturar: 0,
    facturas: [],
  },
]
