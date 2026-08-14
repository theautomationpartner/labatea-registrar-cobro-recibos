/**
 * Datos de prueba para trabajar sin token de Monday (desarrollo local). Los servicios devuelven
 * esto cuando `mondayHabilitado()` es falso, así la app se puede recorrer entera sin cuenta.
 */
import type {
  AnticipoPendiente,
  Cliente,
  Contacto,
  CuentaPropia,
  FacturaPendiente,
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
    recibo: 'REC1001',
    fecha: '2026-09-01',
    importe: 2500,
    pendiente: 2500,
    comentario: 'Pago inicial recibido',
  },
  {
    id: 'a-2',
    nombre: 'Anticipo - REC1002',
    recibo: 'REC1002',
    fecha: '2026-09-05',
    importe: 1800,
    pendiente: 1800,
    comentario: 'Monto parcial pendiente',
  },
  {
    id: 'a-3',
    nombre: 'Anticipo - REC1004',
    recibo: 'REC1004',
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
