/**
 * "Registrar Pago" desde la app (`registrarPago`): lo que antes hacía el escenario de Make de la
 * orden de pago. Se prueba contra una conexión FALSA a Monday que anota cada escritura, así se ve
 * qué se crea en cada tablero, con qué columnas y en qué orden —sin tocar el Monday real—.
 */
import {
  BOARDS,
  CAJA_EFECTIVO_ID,
  CAJA_SUB_PAGO_PROVEEDOR_INDEX,
  CHEQUE_CARTERA_ESTADO_INDEX,
  COL,
  COL_REGISTRO,
  COL_REGISTRO_PAGO,
  MOVIMIENTO_CTA_CTE_PROVEEDOR_INDEX,
  RETENCION_APLICADA_ID,
} from '@/services/monday/columns'
import type { ConexionRegistro, Hecho } from '@/services/monday/registroComun'
import {
  ErrorRegistroPago,
  registrarPago,
  type DatosRegistroPago,
  type LineaOrdenCreada,
} from '@/services/monday/registroPago'
import type { MovimientoCaja } from '@/types'

let fallas = 0
const chequear = (grupo: string, nombre: string, ok: boolean) => {
  if (!ok) fallas++
  console.log(`${ok ? 'OK    ' : 'FALLA '} ${grupo} · ${nombre}`)
}

/* ===== La conexión falsa ===== */

interface Escrita {
  alias: string
  tipo: 'subitem' | 'item' | 'columnas'
  board?: number
  padre?: string
  itemId?: string
  nombre?: string
  cols: Record<string, unknown>
  /** El id que le dio la conexión falsa (los creados). */
  id: string
}

const s = COL.ctaCteSub
const sub = (id: string, created: string, cols: Record<string, number>) => ({
  id,
  created_at: created,
  column_values: Object.entries(cols).map(([id, v]) => ({ id, text: String(v) })),
})

function contextoBase(opciones: { sinCaja?: boolean } = {}) {
  return {
    orden: [
      {
        id: '100',
        column_values: [{ id: COL.ordenPago.nro, text: 'IDPAGO-9' }],
        subitems: ['102', '103', '104'].map((id) => ({
          id,
          column_values: [{ id: COL_REGISTRO_PAGO.ordenPagoSub.idMov, text: `MOV-${id}` }],
        })),
      },
    ],
    cta: [
      {
        items_page: {
          items: [
            {
              id: '700',
              column_values: [{ id: COL.ctaCte.anticiposPendAplicar, text: '20' }],
              subitems: [
                sub('2', '2026-02-01T10:00:00Z', { [s.saldoInicial]: 4000, [s.suma]: 0, [s.resta]: 500 }),
                sub('1', '2026-01-01T10:00:00Z', { [s.saldoInicial]: 0, [s.suma]: 5000, [s.resta]: 1000 }),
              ],
            },
          ],
        },
      },
    ],
    ctaOrigen: [
      {
        items_page: {
          items: [
            {
              id: '710',
              column_values: [{ id: COL.ctaCte.anticiposPendAplicar, text: '400' }],
              subitems: [sub('9', '2026-03-01T10:00:00Z', { [s.saldoInicial]: -400, [s.suma]: 0, [s.resta]: 0 })],
            },
          ],
        },
      },
    ],
    facturas: [{ id: '900', column_values: [{ id: COL.factCompra.factura, text: '', linked_item_ids: ['850'] }] }],
    config: opciones.sinCaja
      ? [{ id: '500', column_values: [{ id: COL_REGISTRO.config.caja, linked_item_ids: [] }] }]
      : [{ id: '500', column_values: [{ id: COL_REGISTRO.config.caja, linked_item_ids: ['600'] }] }],
  }
}

function conexionFalsa(opciones: { contexto?: Record<string, unknown> } = {}) {
  const escritas: Escrita[] = []
  const subidas: { itemId: number; columna: string; archivo: string }[] = []
  let proximoId = 5000
  const c = COL_REGISTRO.cajaSub
  const api = (async (query: string, variables: Record<string, unknown> = {}) => {
    if (query.trim().startsWith('query')) {
      if (query.includes('cajas: items')) {
        const mov = (ini: number, ing: number, egr: number) => ({
          id: '1',
          created_at: '2026-01-01',
          column_values: [
            { id: c.saldoInicial, text: String(ini) },
            { id: c.ingresos, text: String(ing) },
            { id: c.egresos, text: String(egr) },
          ],
        })
        return {
          data: {
            cajas: [
              { id: CAJA_EFECTIVO_ID, column_values: [], subitems: [mov(100, 50, 0)] },
              { id: '600', column_values: [], subitems: [mov(1000, 0, 0)] },
            ],
          },
          errores: [],
        }
      }
      return { data: opciones.contexto ?? contextoBase(), errores: [] }
    }
    const data: Record<string, unknown> = {}
    for (const m of query.matchAll(/(u\d+): (create_subitem|create_item|change_multiple_column_values)\(([^)]*)\)/g)) {
      const [, alias, op, args] = m
      const i = alias.slice(1)
      const board = /board_id: (\d+)/.exec(args)?.[1]
      const id = String(proximoId++)
      escritas.push({
        alias,
        tipo: op === 'create_subitem' ? 'subitem' : op === 'create_item' ? 'item' : 'columnas',
        board: board ? Number(board) : undefined,
        padre: variables[`p${i}`] as string | undefined,
        itemId: variables[`i${i}`] as string | undefined,
        nombre: variables[`n${i}`] as string | undefined,
        cols: JSON.parse(String(variables[`c${i}`])) as Record<string, unknown>,
        id,
      })
      data[alias] = { id, column_values: [{ id: 'codigo', text: `COD-${id}` }] }
    }
    return { data, errores: [] }
  }) as unknown as ConexionRegistro['api']
  const subir = (async (query: string, file: File) => {
    const itemId = Number(/item_id: (\d+)/.exec(query)?.[1])
    const columna = /column_id: "([^"]+)"/.exec(query)?.[1] ?? ''
    subidas.push({ itemId, columna, archivo: file.name })
    return {}
  }) as unknown as ConexionRegistro['subir']
  return { cx: { api, subir } as ConexionRegistro, escritas, subidas }
}

const mov = (m: Partial<MovimientoCaja> & Pick<MovimientoCaja, 'formaPago' | 'importe'>): MovimientoCaja => ({
  id: `m-${Math.random()}`,
  ...m,
})
const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const archivo = (nombre: string) => new File(['x'], nombre)

async function correr(datos: DatosRegistroPago, hechos: Record<string, Hecho> = {}, contexto?: Record<string, unknown>) {
  const f = conexionFalsa({ contexto })
  const avance = { hechos: { ...hechos } }
  let error: unknown = null
  try {
    await registrarPago(datos, avance, () => {}, f.cx)
  } catch (e) {
    error = e
  }
  return { ...f, avance, error }
}

/* ===== Caso 1 · Pago de facturas con todas las cajas ===== */

const factura = { id: '900', nro: '0002-00003314', importe: 1000 }
const lineasPago: LineaOrdenCreada[] = [
  { clase: 'factura', id: '101', factura },
  { clase: 'anticipo', id: '108', importe: 300 },
  { clase: 'pago', id: '102', movimiento: mov({ formaPago: 'Efectivo', importe: 300 }) },
  { clase: 'pago', id: '103', movimiento: mov({ formaPago: 'Efectivo', importe: 200 }) },
  {
    clase: 'pago',
    id: '104',
    movimiento: mov({ formaPago: 'Transferencia', importe: 400, bancoOrigenId: '500', bancoOrigen: 'Banco Provincia' }),
  },
  {
    clase: 'pago',
    id: '105',
    movimiento: mov({ formaPago: 'Cheque', importe: 100, modalidadCheque: 'cartera', chequeId: '777', numeroCheque: '111' }),
  },
  {
    clase: 'pago',
    id: '106',
    movimiento: mov({
      formaPago: 'Cheque',
      importe: 250,
      modalidadCheque: 'nuevo',
      numeroCheque: '222',
      fechaEmisionCheque: '01/09/2026',
      fechaPagoCheque: '10/10/2026',
      bancoEmisor: 'Banco Galicia',
      bancoEmisorId: '501',
    }),
  },
  { clase: 'pago', id: '107', movimiento: mov({ formaPago: 'Retencion GAN', importe: 50 }) },
]

const regeneradas: string[][] = []
const datosPago: DatosRegistroPago = {
  ordenId: '100',
  tipo: 'pago',
  proveedorId: '300',
  fechaPago: '28/09/2026',
  lineas: lineasPago,
  nroRetencion: 'RETENC-1',
  constancia: {
    pdf: archivo('constancia.pdf'),
    numero: 'RETENC-1',
    nroOrden: 'IDPAGO-8',
    regenerar: async (cert, nro) => {
      regeneradas.push([cert, nro])
      return archivo('constancia-real.pdf')
    },
  },
}

{
  const G = 'Pago'
  const r = await correr(datosPago)
  const { escritas } = r
  chequear(G, 'no falla', r.error === null)

  const cta = escritas.find((e) => e.tipo === 'subitem' && e.padre === '700')
  const anticipo = escritas.find((e) => e.tipo === 'item' && e.board === BOARDS.anticiposProveedor)
  chequear(G, 'movimiento de cuenta: "Pago - IDPAGO-9", tipo Pago', cta?.nombre === 'Pago - IDPAGO-9' &&
    igual(cta?.cols[s.movimiento], { index: MOVIMIENTO_CTA_CTE_PROVEEDOR_INDEX.pago }))
  chequear(G, 'movimiento de cuenta: saldo 3500 y resta lo entregado (1300)', cta?.cols[s.saldoInicial] === 3500 && cta?.cols[s.resta] === 1300)
  chequear(G, 'movimiento de cuenta: el origen es la factura y el anticipo del sobrante',
    igual(cta?.cols[COL_REGISTRO_PAGO.ctaCteSub.origen], { item_ids: [900, Number(anticipo?.id)] }))
  chequear(G, 'el movimiento de cuenta lleva la fecha del pago en SU columna (no la de clientes)',
    igual(cta?.cols[COL_REGISTRO_PAGO.ctaCteSub.fecha], { date: '2026-09-28' }) && !(s.fechaEmision in (cta?.cols ?? {})))

  const a = COL.anticipoProveedor
  chequear(G, 'anticipo del sobrante: 300, pendiente, del proveedor y con su línea',
    anticipo?.cols[a.importe] === 300 && igual(anticipo?.cols[a.estado], { index: 17 }) &&
      igual(anticipo?.cols[a.proveedor], { item_ids: [300] }) && igual(anticipo?.cols[a.subOrdenPago], { item_ids: [108] }))
  const pend = escritas.find((e) => e.tipo === 'columnas' && e.itemId === '700')
  chequear(G, 'anticipo pendiente de la cuenta: 20 + 300', pend?.board === BOARDS.ctaCteProveedores &&
    pend?.cols[COL.ctaCte.anticiposPendAplicar] === 320)

  const c = COL_REGISTRO.cajaSub
  const efectivo = escritas.filter((e) => e.tipo === 'subitem' && e.padre === CAJA_EFECTIVO_ID)
  chequear(G, 'efectivo: dos EGRESOS encadenados (150 → -150)', efectivo.length === 2 &&
    efectivo[0].cols[c.saldoInicial] === 150 && efectivo[0].cols[c.egresos] === 300 &&
    efectivo[1].cols[c.saldoInicial] === -150 && efectivo[1].cols[c.egresos] === 200)
  chequear(G, 'efectivo: "Pago Proveedor", nombre con el ID Mov y el comprobante de la factura',
    igual(efectivo[0].cols[c.cobrado], { index: CAJA_SUB_PAGO_PROVEEDOR_INDEX }) &&
      efectivo[0].nombre === 'Efectivo - IDPAGO-9 - MOV-102' && igual(efectivo[0].cols[c.comprobanteOrigen], { item_ids: [850] }) &&
      !(c.ingresos in efectivo[0].cols))
  const transf = escritas.find((e) => e.tipo === 'subitem' && e.padre === '600')
  chequear(G, 'transferencia: egreso en la caja de la cuenta de origen', transf?.cols[c.saldoInicial] === 1000 && transf?.cols[c.egresos] === 400)

  const q = COL.chequeCartera
  const x = COL_REGISTRO_PAGO.cheque
  const usoCartera = escritas.find((e) => e.tipo === 'columnas' && e.itemId === '777')
  chequear(G, 'cheque de cartera: 100% Usado, con la línea y la factura', usoCartera?.board === BOARDS.chequesCartera &&
    igual(usoCartera?.cols[q.estado], { index: CHEQUE_CARTERA_ESTADO_INDEX.usado }) &&
    igual(usoCartera?.cols[x.subPago], { item_ids: [105] }) && igual(usoCartera?.cols[x.facturasCompra], { item_ids: [850] }))
  const alta = escritas.find((e) => e.tipo === 'item' && e.board === BOARDS.chequesCartera)
  chequear(G, 'cheque nuevo: se da de alta PENDIENTE con sus datos', igual(alta?.cols[q.estado], { index: CHEQUE_CARTERA_ESTADO_INDEX.pendiente }) &&
    alta?.cols[q.numero] === '222' && igual(alta?.cols[q.vencimiento], { date: '2026-11-09' }) && igual(alta?.cols[q.banco], { labels: ['Banco Galicia'] }) &&
    igual(alta?.cols[q.tipo], { labels: ['Cheque'] }) && alta?.cols[q.importe] === 250)
  const usoNuevo = escritas.find((e) => e.tipo === 'columnas' && e.itemId === alta?.id)
  chequear(G, 'cheque nuevo: DESPUÉS pasa a 100% Usado', igual(usoNuevo?.cols[q.estado], { index: CHEQUE_CARTERA_ESTADO_INDEX.usado }) &&
    escritas.indexOf(usoNuevo as Escrita) > escritas.indexOf(alta as Escrita))

  const ret = escritas.find((e) => e.tipo === 'item' && e.board === BOARDS.retenciones)
  const rr = COL_REGISTRO.retencion
  chequear(G, 'retención: GAN, APLICADA, 50, del proveedor y con su línea', igual(ret?.cols[rr.tipo], { index: 1 }) &&
    igual(ret?.cols[rr.sufridaAplicada], { ids: [RETENCION_APLICADA_ID] }) && ret?.cols[rr.monto] === 50 &&
    igual(ret?.cols[rr.sujeto], { item_ids: [300] }) && igual(ret?.cols[COL_REGISTRO_PAGO.retencion.subOrdenPago], { item_ids: [107] }) &&
    igual(ret?.cols[rr.fecha], { date: '2026-09-28' }))
  chequear(G, 'retención: la constancia se regenera con el certificado y la orden REALES',
    igual(regeneradas, [[`COD-${ret?.id}`, 'IDPAGO-9']]) &&
      r.subidas.some((u) => u.itemId === Number(ret?.id) && u.columna === COL.retencion.pdf && u.archivo === 'constancia-real.pdf'))
  const nroLinea = escritas.find((e) => e.tipo === 'columnas' && e.itemId === '107')
  chequear(G, 'retención: la línea de la orden queda con el certificado real', nroLinea?.board === BOARDS.ordenesPagoSub &&
    nroLinea?.cols[COL.ordenPagoSub.nroRetencion] === `COD-${ret?.id}`)

  const f = COL_REGISTRO_PAGO.factCompraSub
  const fac = escritas.find((e) => e.tipo === 'subitem' && e.padre === '900')
  chequear(G, 'factura: "Orden de Pago - IDPAGO-9", 1000, fecha y la orden', fac?.nombre === 'Orden de Pago - IDPAGO-9' &&
    fac?.cols[f.importePagado] === 1000 && igual(fac?.cols[f.fechaPago], { date: '2026-09-28' }) && igual(fac?.cols[f.orden], { item_ids: [100] }))

  /* ===== Reintento: con todo hecho no se escribe nada ===== */
  const otra = await correr(datosPago, r.avance.hechos)
  chequear('Reintento', 'con todo hecho no se vuelve a escribir ni a subir', otra.error === null && otra.escritas.length === 0 && otra.subidas.length === 0)
}

/* ===== Caso 2 · Aplicación de anticipos ===== */
{
  const G = 'Aplicación'
  const r = await correr({
    ordenId: '100',
    tipo: 'aplicacion',
    proveedorId: '300',
    fechaPago: '28/09/2026',
    lineas: [
      { clase: 'factura', id: '101', factura: { ...factura, importe: 200 } },
      { clase: 'anticipoAplicado', id: '102', anticipo: { id: '880', importe: 200 } },
    ],
  })
  const ap = r.escritas.find((e) => e.tipo === 'subitem' && e.padre === '880')
  const sx = COL_REGISTRO_PAGO.anticipoProveedorSub
  chequear(G, 'aplicación: 200 en el anticipo, contra la factura', ap?.cols[sx.importeAplicado] === 200 && igual(ap?.cols[sx.facturas], { item_ids: [900] }))
  chequear(G, 'sin movimiento en la cuenta corriente', !r.escritas.some((e) => e.tipo === 'subitem' && e.padre === '700'))
  const pend = r.escritas.find((e) => e.tipo === 'columnas' && e.itemId === '700')
  chequear(G, 'anticipo pendiente: 20 − 200', pend?.cols[COL.ctaCte.anticiposPendAplicar] === -180)
  const fac = r.escritas.find((e) => e.tipo === 'subitem' && e.padre === '900')
  chequear(G, 'factura: "Anticipo - IDPAGO-9"', fac?.nombre === 'Anticipo - IDPAGO-9')
}

/* ===== Caso 3 · Anticipo ===== */
{
  const G = 'Anticipo'
  const r = await correr({
    ordenId: '100',
    tipo: 'anticipo',
    proveedorId: '300',
    fechaPago: '28/09/2026',
    lineas: [
      { clase: 'anticipo', id: '101', importe: 500, detalle: 'Compra de insumos' },
      { clase: 'pago', id: '102', movimiento: mov({ formaPago: 'Efectivo', importe: 500 }) },
    ],
  })
  const ant = r.escritas.find((e) => e.tipo === 'item' && e.board === BOARDS.anticiposProveedor)
  chequear(G, 'anticipo con su detalle (texto largo)', igual(ant?.cols[COL.anticipoProveedor.detalle], { text: 'Compra de insumos' }))
  const cta = r.escritas.find((e) => e.tipo === 'subitem' && e.padre === '700')
  chequear(G, 'movimiento "Entrega de Anticipo - <código>", tipo Anticipo, origen el anticipo',
    cta?.nombre === `Entrega de Anticipo - COD-${ant?.id}` && igual(cta?.cols[s.movimiento], { index: 0 }) &&
      cta?.cols[s.resta] === 500 && igual(cta?.cols[COL_REGISTRO_PAGO.ctaCteSub.origen], { item_ids: [Number(ant?.id)] }))
}

/* ===== Caso 4 · Pase de saldo entre proveedores ===== */
{
  const G = 'Pase'
  const r = await correr({
    ordenId: '100',
    tipo: 'pase',
    proveedorId: '300',
    fechaPago: '28/09/2026',
    lineas: [
      { clase: 'debitoPase', id: '102', anticipoId: '880', personaOrigenId: '301', importe: 150 },
      { clase: 'creditoPase', id: '103', importe: 150 },
    ],
  })
  const deb = r.escritas.find((e) => e.tipo === 'subitem' && e.padre === '880')
  chequear(G, 'débito en el anticipo de origen', deb?.nombre === 'Debito x Pase de Saldo Aplicado - IDPAGO-9' &&
    deb?.cols[COL_REGISTRO_PAGO.anticipoProveedorSub.importeAplicado] === 150)
  const origen = r.escritas.find((e) => e.tipo === 'subitem' && e.padre === '710')
  chequear(G, 'débito en la cuenta de origen: suma 150, desde -400, linkeado al anticipo',
    origen?.cols[s.suma] === 150 && origen?.cols[s.saldoInicial] === -400 &&
      igual(origen?.cols[s.movimiento], { index: MOVIMIENTO_CTA_CTE_PROVEEDOR_INDEX.debitoPase }) &&
      igual(origen?.cols[COL_REGISTRO_PAGO.ctaCteSub.origen], { item_ids: [880] }) &&
      igual(origen?.cols[COL_REGISTRO_PAGO.ctaCteSub.fecha], { date: '2026-09-28' }))
  const pendOrigen = r.escritas.find((e) => e.tipo === 'columnas' && e.itemId === '710')
  chequear(G, 'anticipo pendiente de origen: 400 − 150', pendOrigen?.cols[COL.ctaCte.anticiposPendAplicar] === 250)
  const credito = r.escritas.find((e) => e.tipo === 'item' && e.board === BOARDS.anticiposProveedor)
  const destino = r.escritas.find((e) => e.tipo === 'subitem' && e.padre === '700')
  chequear(G, 'crédito en el destino: anticipo y movimiento "Credito x Pase de Saldo"',
    credito?.nombre === 'Credito x Pase de Saldo - IDPAGO-9' && destino?.nombre === 'Credito x Pase de Saldo - IDPAGO-9' &&
      igual(destino?.cols[s.movimiento], { index: MOVIMIENTO_CTA_CTE_PROVEEDOR_INDEX.creditoPase }) && destino?.cols[s.resta] === 150 &&
      igual(destino?.cols[COL_REGISTRO_PAGO.ctaCteSub.origen], { item_ids: [Number(credito?.id)] }))
  const pendDestino = r.escritas.find((e) => e.tipo === 'columnas' && e.itemId === '700')
  chequear(G, 'anticipo pendiente de destino: 20 + 150', pendDestino?.cols[COL.ctaCte.anticiposPendAplicar] === 170)
}

/* ===== Caso 5 · Faltantes ===== */
{
  const G = 'Faltantes'
  const r = await correr(
    {
      ordenId: '100',
      tipo: 'pago',
      proveedorId: '300',
      fechaPago: '28/09/2026',
      lineas: [
        { clase: 'factura', id: '101', factura },
        { clase: 'pago', id: '102', movimiento: mov({ formaPago: 'Transferencia', importe: 500, bancoOrigenId: '500', bancoOrigen: 'Banco Provincia' }) },
        { clase: 'pago', id: '103', movimiento: mov({ formaPago: 'Cheque', importe: 500, modalidadCheque: 'nuevo', numeroCheque: '9' }) },
      ],
    },
    {},
    contextoBase({ sinCaja: true }),
  )
  const fallasDe = r.error instanceof ErrorRegistroPago ? r.error.fallas : []
  chequear(G, 'una cuenta propia sin caja se informa', fallasDe.some((f) => f.includes('no tiene una caja conectada')))
  chequear(G, 'un cheque nuevo sin fechas ni banco se informa', fallasDe.some((f) => f.includes('faltan datos para darlo de alta')))
  chequear(G, 'y no se escribe nada en esos tableros', !r.escritas.some((e) => e.board === BOARDS.chequesCartera || e.padre === '600'))
  chequear(G, 'lo demás sí se registra', r.escritas.some((e) => e.padre === '900') && r.escritas.some((e) => e.padre === '700'))
}

console.log(fallas ? `\n${fallas} FALLAS` : '\nTodo OK')
if (fallas) process.exit(1)
