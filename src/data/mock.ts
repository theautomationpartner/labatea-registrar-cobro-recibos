/**
 * Datos de prueba para trabajar sin token de Monday (desarrollo local). Los servicios devuelven
 * esto cuando `mondayHabilitado()` es falso, así la app se puede recorrer entera sin cuenta.
 */
import type {
  AnticipoPendiente,
  ChequeEnCartera,
  Cliente,
  Contacto,
  CuentaPropia,
  FacturaCompraPendiente,
  FacturaPendiente,
  Proveedor,
  SaldosCliente,
  Usuario,
} from '@/types'

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
    emision: '2026-07-05',
    banco: 'Banco Galicia',
    cuitEmisor: '30-70011122-3',
    tipo: 'Cheque',
    estado: 'Pendiente',
  },
  {
    id: 'ch-2',
    codigo: 'CHEQUE-11',
    numero: '00987654',
    importe: 543_200.5,
    vencimiento: '2026-09-28',
    emision: '2026-07-28',
    banco: 'Banco Credicoop',
    cuitEmisor: '27-25488991-0',
    tipo: 'eCheq',
    estado: 'Pendiente',
  },
  {
    id: 'ch-3',
    codigo: 'CHEQUE-14',
    numero: '00456789',
    importe: 120_000,
    vencimiento: '2026-10-15',
    emision: '2026-08-15',
    banco: 'Banco Nación',
    cuitEmisor: '30-58884422-7',
    tipo: 'Cheque',
    estado: 'Pendiente',
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
