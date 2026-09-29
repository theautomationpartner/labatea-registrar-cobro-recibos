/**
 * "Registrar Cobro" desde la app (`registrarCobro`): lo que antes hacía el escenario de Make. Se
 * prueba contra una conexión FALSA a Monday que anota cada escritura, así se ve exactamente qué se
 * crea en cada tablero, con qué columnas y en qué orden —sin tocar el Monday real—.
 */
import {
  CAJA_EFECTIVO_ID,
  COL,
  COL_REGISTRO,
  BOARDS,
  MOVIMIENTO_CTA_CTE_CLIENTE_INDEX,
} from '@/services/monday/columns'
import {
  ErrorRegistroCobro,
  registrarCobro,
  type ConexionRegistro,
  type DatosRegistroCobro,
  type Hecho,
  type LineaReciboCreada,
} from '@/services/monday/registroCobro'
import type { MovimientoPago } from '@/types'

let fallas = 0
const chequear = (grupo: string, nombre: string, ok: boolean) => {
  if (!ok) fallas++
  console.log(`${ok ? 'OK    ' : 'FALLA '} ${grupo} · ${nombre}`)
}

/* ===== La conexión falsa ===== */

interface Escrita {
  llamada: number
  alias: string
  tipo: 'subitem' | 'item' | 'columnas'
  board?: number
  padre?: string
  itemId?: string
  nombre?: string
  cols: Record<string, unknown>
}

interface Falsa {
  cx: ConexionRegistro
  escritas: Escrita[]
  subidas: { itemId: number; columna: string; archivo: string }[]
  queries: string[]
}

const archivo = (nombre: string) => new File(['x'], nombre)

/** Los datos que "lee" el registro. */
function contextoBase() {
  const sub = (id: string, created: string, cols: Record<string, number>) => ({
    id,
    created_at: created,
    column_values: Object.entries(cols).map(([id, v]) => ({ id, text: String(v) })),
  })
  const s = COL.ctaCteSub
  return {
    recibo: [
      {
        id: '100',
        column_values: [{ id: COL.cobro.nro, text: 'RECIBO-50' }],
        subitems: ['102', '103', '104'].map((id) => ({ id, column_values: [{ id: 'pulse_id_mkwbrvf5', text: `MOV-${id}` }] })),
      },
    ],
    cta: [
      {
        items_page: {
          items: [
            {
              id: '700',
              column_values: [{ id: COL.ctaCte.anticiposPendAplicar, text: '20' }],
              /* Llegan DESORDENADOS a propósito: el último es el de creación más reciente. */
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
    facturas: [
      {
        id: '900',
        column_values: [
          {
            id: COL.factPendiente.venta,
            linked_items: [
              {
                id: '800',
                column_values: [
                  { id: COL.venta.idVenta, text: 'VTA-9' },
                  { id: COL.venta.facturacion, text: '', linked_item_ids: ['850'] },
                ],
              },
            ],
          },
        ],
      },
    ],
    config: [{ id: '500', column_values: [{ id: COL_REGISTRO.config.caja, linked_item_ids: ['600'] }] }],
  }
}

function conexionFalsa(opciones: { falla?: (e: Escrita) => boolean; contexto?: Record<string, unknown> } = {}): Falsa {
  const escritas: Escrita[] = []
  const subidas: Falsa['subidas'] = []
  const queries: string[] = []
  let proximoId = 5000
  let llamada = 0
  const c = COL_REGISTRO.cajaSub
  const api = (async (query: string, variables: Record<string, unknown> = {}) => {
    queries.push(query)
    llamada++
    if (query.trim().startsWith('query')) {
      if (query.includes('cajas: items')) {
        const sub = (ini: number, ing: number, egr: number) => ({
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
              { id: CAJA_EFECTIVO_ID, column_values: [], subitems: [sub(100, 50, 0)] },
              { id: '600', column_values: [], subitems: [sub(1000, 0, 0)] },
            ],
          },
          errores: [],
        }
      }
      return { data: opciones.contexto ?? contextoBase(), errores: [] }
    }
    const data: Record<string, unknown> = {}
    const errores: { message: string; path: string[] }[] = []
    for (const m of query.matchAll(/(u\d+): (create_subitem|create_item|change_multiple_column_values)\(([^)]*)\)/g)) {
      const [, alias, op, args] = m
      const i = alias.slice(1)
      const board = /board_id: (\d+)/.exec(args)?.[1]
      const e: Escrita = {
        llamada,
        alias,
        tipo: op === 'create_subitem' ? 'subitem' : op === 'create_item' ? 'item' : 'columnas',
        board: board ? Number(board) : undefined,
        padre: variables[`p${i}`] as string | undefined,
        itemId: variables[`i${i}`] as string | undefined,
        nombre: variables[`n${i}`] as string | undefined,
        cols: JSON.parse(String(variables[`c${i}`])) as Record<string, unknown>,
      }
      if (opciones.falla?.(e)) {
        data[alias] = null
        errores.push({ message: 'rechazado', path: [alias] })
        continue
      }
      escritas.push(e)
      data[alias] = { id: String(proximoId++), column_values: [{ id: COL.anticipo.idAnticipo, text: 'ANT-7' }] }
    }
    return { data, errores }
  }) as unknown as ConexionRegistro['api']
  const subir = (async (query: string, file: File) => {
    const itemId = Number(/item_id: (\d+)/.exec(query)?.[1])
    const columna = /column_id: "([^"]+)"/.exec(query)?.[1] ?? ''
    subidas.push({ itemId, columna, archivo: file.name })
    return {}
  }) as unknown as ConexionRegistro['subir']
  return { cx: { api, subir }, escritas, subidas, queries }
}

const mov = (m: Partial<MovimientoPago> & Pick<MovimientoPago, 'formaPago' | 'importe'>): MovimientoPago => ({
  id: `m-${Math.random()}`,
  fechaPagoCheque: '',
  ...m,
})

const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const donde = (escritas: Escrita[], filtro: (e: Escrita) => boolean) => escritas.filter(filtro)

/* ===== Caso 1 · Cobro de facturas con todos los medios ===== */

const lineasCobro: LineaReciboCreada[] = [
  { clase: 'pago', id: '102', movimiento: mov({ formaPago: 'Efectivo', importe: 300 }) },
  { clase: 'pago', id: '103', movimiento: mov({ formaPago: 'Efectivo', importe: 200 }) },
  {
    clase: 'pago',
    id: '104',
    movimiento: mov({
      formaPago: 'Transferencia',
      importe: 400,
      cuentaPropiaId: '500',
      cuentaPropia: 'Banco Provincia',
      comprobanteArchivo: archivo('transf.pdf'),
    }),
  },
  {
    clase: 'pago',
    id: '105',
    movimiento: mov({
      formaPago: 'Cheque',
      importe: 100,
      numeroCheque: '0001234',
      cuitEmisor: '20-12345678-9',
      fechaEmisionCheque: '01/09/2026',
      fechaPagoCheque: '10/10/2026',
      bancoEmisor: 'Banco Galicia',
    }),
  },
  {
    clase: 'pago',
    id: '106',
    movimiento: mov({
      formaPago: 'Retencion GAN',
      importe: 50,
      fechaRetencion: '15/09/2026',
      nroComprobanteRetencion: 'R-1',
      comprobanteArchivo: archivo('ret.pdf'),
    }),
  },
  {
    clase: 'pago',
    id: '107',
    movimiento: mov({
      formaPago: 'Tarjeta de débito',
      importe: 80,
      numeroCupon: '555',
      titularTarjeta: 'JUAN PEREZ',
      bancoTarjeta: 'Banco Nación',
      tipoTarjeta: 'Visa-Debito',
      comprobanteArchivo: archivo('cupon.jpg'),
    }),
  },
  { clase: 'factura', id: '101', factura: { id: '900', nro: 'FPENCOB-1', importe: 1000 } },
  { clase: 'anticipo', id: '108', importe: 130 },
  { clase: 'difCaja', id: '109', importe: 0.5 },
]

const datosCobro: DatosRegistroCobro = {
  reciboId: '100',
  tipo: 'cobro',
  clienteId: '42',
  fechaRecibo: '28/09/2026',
  lineas: lineasCobro,
}

{
  const f = conexionFalsa()
  const avance = { hechos: {} as Record<string, Hecho> }
  let error: unknown = null
  await registrarCobro(datosCobro, avance, undefined, f.cx).catch((e) => (error = e))
  const G = 'Cobro'
  chequear(G, 'termina sin fallas', error === null)
  chequear(G, 'nunca escribe estados ni updates', f.queries.every((q) => !q.includes('create_update') && !q.includes(COL.cobro.estadoRegistro)))

  const efectivo = donde(f.escritas, (e) => e.padre === CAJA_EFECTIVO_ID)
  const s = COL_REGISTRO.cajaSub
  chequear(G, 'efectivo: los dos movimientos en la caja Efectivo, en UNA mutación', efectivo.length === 2 && efectivo[0].llamada === efectivo[1].llamada)
  chequear(G, 'efectivo: saldo encadenado (150 → 450)', efectivo[0]?.cols[s.saldoInicial] === 150 && efectivo[1]?.cols[s.saldoInicial] === 450)
  chequear(G, 'efectivo: nombre con recibo y movimiento', efectivo[0]?.nombre === 'Efectivo - RECIBO-50 - MOV-102')
  chequear(G, 'efectivo: ingreso, ✋Cobrado, venta y factura de origen', efectivo[0]?.cols[s.ingresos] === 300 &&
    igual(efectivo[0]?.cols[s.cobrado], { index: 1 }) &&
    igual(efectivo[0]?.cols[s.ventas], { item_ids: [800] }) &&
    igual(efectivo[0]?.cols[s.comprobanteOrigen], { item_ids: [850] }))

  const transf = donde(f.escritas, (e) => e.padre === '600')
  chequear(G, 'transferencia: en la caja de la cuenta propia, con su saldo', transf.length === 1 && transf[0].cols[s.saldoInicial] === 1000)
  const idTransf = Number(avance.hechos['caja:104']?.id)
  chequear(G, 'transferencia: el comprobante va al movimiento de caja', f.subidas.some((u) => u.itemId === idTransf && u.columna === s.comprobante))

  const cheque = donde(f.escritas, (e) => e.board === BOARDS.chequesCartera)[0]
  const c = COL.chequeCartera
  chequear(G, 'cheque: un ítem en cartera', !!cheque)
  chequear(G, 'cheque: con la PERSONA (Make no la mapeaba)', igual(cheque?.cols[c.persona], { item_ids: [42] }))
  chequear(G, 'cheque: fechas, número, CUIT, tipo y estado', cheque?.cols[c.numero] === '0001234' &&
    cheque?.cols[c.cuitEmisor] === '20-12345678-9' &&
    igual(cheque?.cols[c.emision], { date: '2026-09-01' }) &&
    igual(cheque?.cols[c.fechaPago], { date: '2026-10-10' }) &&
    igual(cheque?.cols[c.vencimiento], { date: '2026-11-09' }) &&
    igual(cheque?.cols[c.tipo], { labels: ['Cheque'] }) &&
    igual(cheque?.cols[c.estado], { index: 17 }))
  chequear(G, 'cheque: vinculado a la venta y al subelemento del recibo', igual(cheque?.cols[COL_REGISTRO.cheque.ventas], { item_ids: [800] }) &&
    igual(cheque?.cols[COL_REGISTRO.cheque.subRecibo], { item_ids: [105] }))

  const ret = donde(f.escritas, (e) => e.board === BOARDS.retenciones)[0]
  const r = COL_REGISTRO.retencion
  chequear(G, 'retención: sufrida, tipo GAN, fecha y número', igual(ret?.cols[r.sufridaAplicada], { ids: [1] }) &&
    igual(ret?.cols[r.tipo], { index: 1 }) &&
    ret?.cols[r.nro] === 'R-1' &&
    igual(ret?.cols[r.fecha], { date: '2026-09-15' }))
  chequear(G, 'retención: sujeto, venta y subelemento', igual(ret?.cols[r.sujeto], { item_ids: [42] }) && igual(ret?.cols[r.subRecibo], { item_ids: [106] }))
  chequear(G, 'retención: el certificado va a "🤖Retencion PDF"', f.subidas.some((u) => u.itemId === Number(avance.hechos['retencion:106']?.id) && u.columna === r.pdf))

  const tar = donde(f.escritas, (e) => e.board === BOARDS.tarjetas)[0]
  const t = COL_REGISTRO.tarjeta
  chequear(G, 'tarjeta: débito, cupón, titular, banco y persona', igual(tar?.cols[t.tipo], { labels: ['DEBITO'] }) &&
    tar?.cols[t.titular] === 'JUAN PEREZ' &&
    tar?.cols[t.nroCupon] === '555' &&
    igual(tar?.cols[t.bancoEmisor], { labels: ['Banco Nación'] }) &&
    igual(tar?.cols[t.persona], { item_ids: [42] }) &&
    igual(tar?.cols[t.estado], { index: 0 }))
  chequear(G, 'tarjeta: el cupón se sube', f.subidas.some((u) => u.columna === t.cupon))

  const fac = donde(f.escritas, (e) => e.padre === '900')[0]
  chequear(G, 'factura: subelemento con lo cobrado y el recibo', fac?.nombre === 'Recibo - RECIBO-50' &&
    fac?.cols[COL_REGISTRO.factPendienteSub.importeCobrado] === 1000 &&
    igual(fac?.cols[COL_REGISTRO.factPendienteSub.recibo], { item_ids: [100] }))

  const anticipo = donde(f.escritas, (e) => e.board === BOARDS.anticipos)[0]
  chequear(G, 'anticipo del sobrante: a nombre del cliente, pendiente de aplicar', anticipo?.nombre === 'Anticipo - RECIBO-50' &&
    anticipo?.cols[COL.anticipo.importe] === 130 &&
    igual(anticipo?.cols[COL.anticipo.estado], { index: 17 }) &&
    igual(anticipo?.cols[COL.anticipo.cliente], { item_ids: [42] }))

  const movCta = donde(f.escritas, (e) => e.padre === '700')[0]
  const cs = COL.ctaCteSub
  chequear(G, 'cuenta corriente: el cobro, con el saldo del ÚLTIMO movimiento (3500)', movCta?.nombre === 'RECIBO-50' &&
    igual(movCta?.cols[cs.movimiento], { index: MOVIMIENTO_CTA_CTE_CLIENTE_INDEX.cobro }) &&
    movCta?.cols[cs.saldoInicial] === 3500)
  chequear(G, 'cuenta corriente: resta lo recibido (sin anticipo ni dif. de caja) y linkea el recibo', movCta?.cols[cs.resta] === 1130 &&
    igual(movCta?.cols[cs.origen], { item_ids: [100] }))
  chequear(G, 'cuenta corriente: después del anticipo', (movCta?.llamada ?? 0) > (anticipo?.llamada ?? 99))

  const pend = donde(f.escritas, (e) => e.tipo === 'columnas')[0]
  chequear(G, 'anticipo pend de aplicar: 20 + 130, una sola escritura', donde(f.escritas, (e) => e.tipo === 'columnas').length === 1 &&
    pend?.itemId === '700' && pend?.cols[COL.ctaCte.anticiposPendAplicar] === 150)
  chequear(G, 'la dif. de caja no impacta ningún tablero', !f.escritas.some((e) => JSON.stringify(e.cols).includes('0.5')))
}

/* ===== Caso 2 · Falla parcial y reintento ===== */
{
  const G = 'Reintento'
  const f = conexionFalsa({
    falla: (e) => e.board === BOARDS.chequesCartera || (e.padre === CAJA_EFECTIVO_ID && e.cols[COL_REGISTRO.cajaSub.ingresos] === 200),
  })
  const avance = { hechos: {} as Record<string, Hecho> }
  let error: unknown = null
  const avisos: Record<string, Hecho>[] = []
  await registrarCobro(datosCobro, avance, (h) => avisos.push({ ...h }), f.cx).catch((e) => (error = e))
  chequear(G, 'informa en la app qué no entró (2 fallas)', error instanceof ErrorRegistroCobro && error.fallas.length === 2)
  chequear(G, 'lo que sí entró queda anotado', !!avance.hechos['caja:102'] && !!avance.hechos['cuenta:cliente'] && !avance.hechos['caja:103'] && !avance.hechos['cheque:105'])
  chequear(G, 'avisa el avance a medida que escribe', avisos.length > 0)

  const g = conexionFalsa()
  let error2: unknown = null
  await registrarCobro(datosCobro, avance, undefined, g.cx).catch((e) => (error2 = e))
  chequear(G, 'el reintento termina bien', error2 === null)
  chequear(G, 'y crea SÓLO lo que faltó (el cheque y el segundo efectivo)', g.escritas.length === 2 &&
    g.escritas.some((e) => e.board === BOARDS.chequesCartera) &&
    g.escritas.some((e) => e.padre === CAJA_EFECTIVO_ID && e.cols[COL_REGISTRO.cajaSub.saldoInicial] === 150))
  chequear(G, 'no vuelve a subir archivos ya subidos', g.subidas.length === 0)
}

/* ===== Caso 3 · Aplicación de cuenta corriente ===== */
{
  const G = 'Aplicación'
  const f = conexionFalsa()
  await registrarCobro(
    {
      ...datosCobro,
      tipo: 'aplicacion',
      lineas: [
        { clase: 'factura', id: '101', factura: { id: '900', nro: 'FPENCOB-1', importe: 300 } },
        { clase: 'anticipoAplicado', id: '110', anticipo: { id: '950', nro: 'ANT-1', importe: 300 } },
      ],
    },
    { hechos: {} },
    undefined,
    f.cx,
  )
  chequear(G, 'la factura se cobra "Anticipo - …"', donde(f.escritas, (e) => e.padre === '900')[0]?.nombre === 'Anticipo - RECIBO-50')
  const apl = donde(f.escritas, (e) => e.padre === '950')[0]
  chequear(G, 'el anticipo aplicado lleva el importe de SU línea', apl?.cols[COL_REGISTRO.anticipoSub.importeAplicado] === 300)
  chequear(G, 'no hay movimiento en la cuenta (no entró dinero)', !f.escritas.some((e) => e.padre === '700'))
  chequear(G, 'anticipo pend de aplicar: 20 − 300', donde(f.escritas, (e) => e.tipo === 'columnas')[0]?.cols[COL.ctaCte.anticiposPendAplicar] === -280)
}

/* ===== Caso 4 · Anticipo ===== */
{
  const G = 'Anticipo'
  const f = conexionFalsa()
  await registrarCobro(
    {
      ...datosCobro,
      tipo: 'anticipo',
      lineas: [
        { clase: 'anticipo', id: '120', importe: 500, detalle: 'Seña pedido' },
        { clase: 'pago', id: '102', movimiento: mov({ formaPago: 'Efectivo', importe: 500 }) },
      ],
    },
    { hechos: {} },
    undefined,
    f.cx,
  )
  const ant = donde(f.escritas, (e) => e.board === BOARDS.anticipos)[0]
  chequear(G, 'anticipo con su detalle', ant?.cols[COL.anticipo.detalle] === 'Seña pedido')
  const m = donde(f.escritas, (e) => e.padre === '700')[0]
  chequear(G, 'movimiento "Entrega de Anticipo - ANT-7", tipo Anticipo', m?.nombre === 'Entrega de Anticipo - ANT-7' &&
    igual(m?.cols[COL.ctaCteSub.movimiento], { index: MOVIMIENTO_CTA_CTE_CLIENTE_INDEX.anticipo }) &&
    m?.cols[COL.ctaCteSub.resta] === 500)
  chequear(G, 'el efectivo entra a caja', donde(f.escritas, (e) => e.padre === CAJA_EFECTIVO_ID).length === 1)
  chequear(G, 'anticipo pend de aplicar: 20 + 500', donde(f.escritas, (e) => e.tipo === 'columnas')[0]?.cols[COL.ctaCte.anticiposPendAplicar] === 520)
}

/* ===== Caso 5 · Pase de saldo entre clientes ===== */
{
  const G = 'Pase'
  const f = conexionFalsa()
  await registrarCobro(
    {
      ...datosCobro,
      tipo: 'pase',
      lineas: [
        { clase: 'debitoPase', id: '131', anticipoId: '961', personaOrigenId: '333', importe: 100 },
        { clase: 'debitoPase', id: '132', anticipoId: '962', personaOrigenId: '333', importe: 50 },
        { clase: 'creditoPase', id: '133', importe: 150 },
      ],
    },
    { hechos: {} },
    undefined,
    f.cx,
  )
  chequear(G, 'un débito en cada anticipo de origen', donde(f.escritas, (e) => e.padre === '961')[0]?.cols[COL_REGISTRO.anticipoSub.importeAplicado] === 100 &&
    donde(f.escritas, (e) => e.padre === '962')[0]?.cols[COL_REGISTRO.anticipoSub.importeAplicado] === 50)
  const origen = donde(f.escritas, (e) => e.padre === '710')
  chequear(G, 'dos débitos en la cuenta de origen con el saldo encadenado (−400 → −300)', origen.length === 2 &&
    origen[0].cols[COL.ctaCteSub.saldoInicial] === -400 && origen[1].cols[COL.ctaCteSub.saldoInicial] === -300 &&
    igual(origen[0].cols[COL.ctaCteSub.movimiento], { index: MOVIMIENTO_CTA_CTE_CLIENTE_INDEX.debitoPase }))
  const credito = donde(f.escritas, (e) => e.board === BOARDS.anticipos)[0]
  chequear(G, 'el crédito nace como saldo a favor del destino', credito?.nombre === 'Credito x Pase de Saldo - RECIBO-50' && credito?.cols[COL.anticipo.importe] === 150)
  const pendOrigen = donde(f.escritas, (e) => e.tipo === 'columnas' && e.itemId === '710')[0]
  chequear(G, 'anticipo pend de aplicar del ORIGEN: 400 − 150', pendOrigen?.cols[COL.ctaCte.anticiposPendAplicar] === 250)
  chequear(G, 'y después de los débitos en la cuenta de origen', (pendOrigen?.llamada ?? 0) > (origen[1]?.llamada ?? 99))
  const pendDestino = donde(f.escritas, (e) => e.tipo === 'columnas' && e.itemId === '700')[0]
  chequear(G, 'anticipo pend de aplicar del DESTINO: 20 + 150', pendDestino?.cols[COL.ctaCte.anticiposPendAplicar] === 170)
  const destino = donde(f.escritas, (e) => e.padre === '700')[0]
  chequear(G, 'movimiento de crédito en la cuenta destino', destino?.nombre === 'Credito x Pase de Saldo - RECIBO-50' &&
    igual(destino?.cols[COL.ctaCteSub.movimiento], { index: MOVIMIENTO_CTA_CTE_CLIENTE_INDEX.creditoPase }) &&
    destino?.cols[COL.ctaCteSub.resta] === 150)
}

/* ===== Caso 6 · Datos que faltan ===== */
{
  const G = 'Faltantes'
  const f = conexionFalsa({ contexto: { ...contextoBase(), config: [{ id: '500', column_values: [{ id: COL_REGISTRO.config.caja, linked_item_ids: [] }] }] } })
  let error: unknown = null
  await registrarCobro(
    {
      ...datosCobro,
      lineas: [
        { clase: 'pago', id: '104', movimiento: mov({ formaPago: 'Transferencia', importe: 400, cuentaPropiaId: '500', cuentaPropia: 'Banco Provincia' }) },
        { clase: 'pago', id: '105', movimiento: mov({ formaPago: 'Echeq', importe: 100, fechaPagoCheque: '10/10/2026' }) },
      ],
    },
    { hechos: {} },
    undefined,
    f.cx,
  ).catch((e) => (error = e))
  const textos = error instanceof ErrorRegistroCobro ? error.fallas.join(' | ') : ''
  chequear(G, 'una cuenta propia sin caja se informa', textos.includes('no tiene una caja conectada'))
  chequear(G, 'un cheque sin emisión ni banco se informa', textos.includes('faltan datos'))
  chequear(G, 'y no se escribe nada en esos tableros', !f.escritas.some((e) => e.board === BOARDS.chequesCartera || e.padre === '600'))
}

console.log(fallas ? `\n${fallas} FALLA(S)` : '\nTodo OK')
if (fallas) process.exit(1)
