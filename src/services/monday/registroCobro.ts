/**
 * "Registrar Cobro" desde la app: lo que antes hacía el escenario de Make "[TAP] Se Registra Cobro
 * VTA POSTERIOR -> Hacer movimientos en Cta Cte Correspondiente", disparado por "🤖Estado Registro
 * de Cobro" en "Registrar".
 *
 * Corre DESPUÉS de `crearRecibo`: el recibo y sus subelementos ya existen, y `crearRecibo` devuelve
 * cada subelemento con su id y de qué salió (`LineaReciboCreada`). Con eso, en vez de volver a leer
 * el recibo y recorrerlo como Make, se impacta cada tablero:
 *
 *   · CAJAS          · un movimiento por efectivo o transferencia, en la caja que corresponde, con
 *                      el saldo encadenado desde el último movimiento de esa caja.
 *   · CHEQUES        · un ítem en "🧾Cheques/eCheq en Cartera" por cheque o eCheq.
 *   · TARJETAS       · un ítem en "💳Tarjetas Pend de Acreditar" por cupón, con su archivo.
 *   · RETENCIONES    · un ítem en "🔃Retenciones" por retención, con su certificado.
 *   · FACTURAS       · un subelemento en la factura cancelada, con lo que este recibo le cobra.
 *   · ANTICIPOS      · el anticipo (o el crédito del pase) que queda a favor del cliente, y la
 *                      aplicación del saldo a favor que se usa.
 *   · CUENTA CORRIENTE · el movimiento del recibo en la cuenta del cliente —y, en un pase, el
 *                      débito en la cuenta de origen— y su "🤖Anticipo pend de Aplicar".
 *
 * Cada tablero es un FLUJO independiente y todos corren EN PARALELO. Dentro de un flujo, lo que
 * encadena saldo (los movimientos de una misma caja o cuenta) viaja en UNA mutación, en orden: los
 * campos raíz de una mutación se ejecutan en serie, así que el saldo de cada línea es el final de
 * la anterior por construcción.
 *
 * NO se escribe ningún estado ni ningún update: si algo no entra, se informa en la app
 * (`ErrorRegistroCobro`) y nada más. Y es RETOMABLE: cada cosa creada queda anotada en el avance
 * (`hechos`) y un reintento crea sólo lo que faltó. Los saldos se vuelven a leer en cada intento,
 * así que lo que ya entró cuenta para lo que falta.
 *
 * Sin token (modo local) no se escribe nada, igual que el resto de la capa de servicio.
 */
import { round2 } from '@/lib/format'
import { hoyIso } from '@/lib/dates'
import {
  cuitCompleto,
  esChequeDeCobro,
  esPagoConTarjeta,
  esRetencion,
  formatoDeCheque,
  vencimientoDeCheque,
} from '@/lib/pagos'
import type { MovimientoPago } from '@/types'
import {
  BOARDS,
  CAJA_EFECTIVO_ID,
  CAJA_SUB_COBRADO_INDEX,
  CHEQUE_ORIGEN_LABEL,
  CHEQUE_PENDIENTE_INDEX,
  COL,
  COL_REGISTRO,
  ANTICIPO_ESTADO_INDEX,
  MOVIMIENTO_CTA_CTE_CLIENTE_INDEX,
  RETENCION_SUFRIDA_ID,
  RETENCION_TIPO_INDEX,
  TARJETA_PEND_ACREDITACION_INDEX,
} from './columns'
import { num, type CV } from './parse'
import { bancoDelTablero, type AnticipoAAplicar, type FacturaACancelar } from './recibos'
import {
  columnas,
  conexionReal,
  encadenar,
  ejecutar,
  erroresATexto,
  etiqueta,
  fecha,
  idsDe,
  importeDe,
  lista,
  nombre,
  relacion,
  relaciones,
  saldoDelUltimo,
  suma,
  type ConexionRegistro,
  type CuentaLeida,
  type Ejecucion,
  type Hecho,
  type SubitemLeido,
  type Unidad,
} from './registroComun'
import { mondayHabilitado } from './sdk'

export type { ConexionRegistro, Escritura, Hecho, Unidad } from './registroComun'

/* ===== Lo que llega de la creación del recibo ===== */

/** De qué salió un subelemento del recibo. */
export type OrigenLinea =
  /** Una factura cancelada ("Fact Cancelada"). */
  | { clase: 'factura'; factura: FacturaACancelar }
  /** La línea del anticipo: el entregado a cuenta o el sobrante de un cobro. */
  | { clase: 'anticipo'; importe: number; detalle?: string }
  /** Una forma de pago: efectivo, transferencia, cheque, tarjeta o retención. */
  | { clase: 'pago'; movimiento: MovimientoPago }
  /** Un anticipo que se imputa en una aplicación de cuenta corriente. */
  | { clase: 'anticipoAplicado'; anticipo: AnticipoAAplicar }
  /** El ajuste por diferencia de caja: no impacta ningún tablero. */
  | { clase: 'difCaja'; importe: number }
  /** Pase de saldo: lo que se consume de un anticipo de la cuenta ORIGEN. */
  | { clase: 'debitoPase'; anticipoId: string; personaOrigenId: string; importe: number }
  /** Pase de saldo: lo que se le acredita a la cuenta DESTINO. */
  | { clase: 'creditoPase'; importe: number }

/** Un subelemento del recibo ya creado. `id` vacío = no entró. */
export type LineaReciboCreada = OrigenLinea & { id: string }

export type TipoRegistro = 'cobro' | 'anticipo' | 'aplicacion' | 'pase'

export interface DatosRegistroCobro {
  /** El ítem en "➡️Recibos y Cobros". */
  reciboId: string
  tipo: TipoRegistro
  /** La persona del recibo: el cliente del cobro, o la cuenta DESTINO de un pase. */
  clienteId: string
  /** Fecha del recibo (dd/MM/yyyy): la de emisión del cupón y de la retención. */
  fechaRecibo: string
  lineas: readonly LineaReciboCreada[]
}

/** El avance de un registro, para retomarlo. Lo guarda la vista con el recibo emitido. */
export interface AvanceRegistroCobro {
  lineas: LineaReciboCreada[]
  hechos: Record<string, Hecho>
}

/** Lo que no se pudo registrar, contado en términos del usuario. Nada de esto se escribe en Monday. */
export class ErrorRegistroCobro extends Error {
  constructor(public readonly fallas: string[]) {
    super(`No se pudo registrar todo el cobro: ${fallas.join(' · ')}`)
    this.name = 'ErrorRegistroCobro'
  }
}

/* ===== Lo que se lee antes de escribir ===== */

interface VentasDeFactura {
  codigos: string[]
  ventaIds: string[]
  facturacionIds: string[]
}

export interface ContextoRegistro {
  nroRecibo: string
  /** "🤖ID Mov Recibo" de cada subelemento, por id. */
  idMov: Record<string, string>
  ctaCliente: CuentaLeida | null
  ctaOrigen: CuentaLeida | null
  ventas: Record<string, VentasDeFactura>
  /** Caja de cada cuenta bancaria propia (ítem de Configuración → ítem de Cajas). */
  cajaDeCuenta: Record<string, string | null>
  saldoCaja: Record<string, number>
}

async function leerContexto(datos: DatosRegistroCobro, cx: ConexionRegistro): Promise<ContextoRegistro> {
  const { reciboId, clienteId, lineas } = datos
  const facturaIds = lineas.flatMap((l) => (l.clase === 'factura' ? [l.factura.id] : []))
  const cuentaIds = [
    ...new Set(
      lineas.flatMap((l) =>
        l.clase === 'pago' && l.movimiento.formaPago === 'Transferencia' && l.movimiento.cuentaPropiaId
          ? [l.movimiento.cuentaPropiaId]
          : [],
      ),
    ),
  ]
  const origenId = lineas.find((l) => l.clase === 'debitoPase')?.personaOrigenId ?? null
  const hayEfectivo = lineas.some((l) => l.clase === 'pago' && l.movimiento.formaPago === 'Efectivo')

  const cuenta = (alias: string, personaId: string) => `${alias}: boards(ids: [${BOARDS.ctaCte}]) {
      items_page(limit: 1, query_params: {rules: [
        {column_id: "${COL.ctaCte.cliente}", compare_value: [${Number(personaId)}], operator: any_of}
      ]}) {
        items {
          id
          column_values(ids: ["${COL.ctaCte.anticiposPendAplicar}"]) { id text }
          subitems {
            id created_at
            column_values(ids: ["${COL.ctaCteSub.saldoInicial}", "${COL.ctaCteSub.suma}", "${COL.ctaCteSub.resta}"]) { id text }
          }
        }
      }
    }`

  const partes = [
    `recibo: items(ids: [${Number(reciboId)}]) {
      id
      column_values(ids: ["${COL.cobro.nro}"]) { id text }
      subitems { id column_values(ids: ["pulse_id_mkwbrvf5"]) { id text } }
    }`,
    cuenta('cta', clienteId),
    origenId ? cuenta('ctaOrigen', origenId) : '',
    facturaIds.length
      ? `facturas: items(ids: [${lista(facturaIds)}]) {
          id
          column_values(ids: ["${COL.factPendiente.venta}"]) {
            id
            ... on BoardRelationValue {
              linked_items {
                id
                column_values(ids: ["${COL.venta.idVenta}", "${COL.venta.facturacion}"]) {
                  id text
                  ... on BoardRelationValue { linked_item_ids }
                }
              }
            }
          }
        }`
      : '',
    cuentaIds.length
      ? `config: items(ids: [${lista(cuentaIds)}]) {
          id
          column_values(ids: ["${COL_REGISTRO.config.caja}"]) { id ... on BoardRelationValue { linked_item_ids } }
        }`
      : '',
  ].filter(Boolean)

  type ItemCrudo = { id: string; column_values: CV[]; subitems?: SubitemLeido[] | null }
  type Cuentas = { items_page: { items: ItemCrudo[] } }[]
  const { data, errores } = await cx.api<{
    recibo: (ItemCrudo & { subitems: { id: string; column_values: CV[] }[] })[]
    cta: Cuentas
    ctaOrigen: Cuentas
    facturas: (ItemCrudo & {
      column_values: (CV & { linked_items?: { id: string; column_values: CV[] }[] })[]
    })[]
    config: ItemCrudo[]
  }>(`query { ${partes.join('\n')} }`)
  if (errores.length) throw new ErrorRegistroCobro([`No se pudieron leer los datos para registrar: ${erroresATexto(errores)}`])

  const recibo = data.recibo?.[0]
  const nroRecibo = recibo?.column_values.find((c) => c.id === COL.cobro.nro)?.text?.trim() ?? ''
  const idMov = Object.fromEntries(
    (recibo?.subitems ?? []).map((s) => [s.id, s.column_values[0]?.text?.trim() ?? '']),
  )

  const cuentaLeida = (cuentas: Cuentas | undefined): CuentaLeida | null => {
    const item = cuentas?.[0]?.items_page.items?.[0]
    if (!item) return null
    return {
      id: item.id,
      saldo: saldoDelUltimo(item.subitems ?? [], COL.ctaCteSub.saldoInicial, COL.ctaCteSub.suma, COL.ctaCteSub.resta),
      anticipoPend: num(item.column_values.find((c) => c.id === COL.ctaCte.anticiposPendAplicar)?.text),
    }
  }

  const ventas: Record<string, VentasDeFactura> = {}
  for (const f of data.facturas ?? []) {
    const vinculadas = f.column_values.find((c) => c.id === COL.factPendiente.venta)?.linked_items ?? []
    ventas[f.id] = {
      ventaIds: vinculadas.map((v) => v.id),
      codigos: vinculadas.map((v) => v.column_values.find((c) => c.id === COL.venta.idVenta)?.text?.trim() ?? '').filter(Boolean),
      facturacionIds: vinculadas.flatMap((v) => idsDe(v.column_values.find((c) => c.id === COL.venta.facturacion))),
    }
  }

  const cajaDeCuenta: Record<string, string | null> = {}
  for (const c of data.config ?? []) cajaDeCuenta[c.id] = idsDe(c.column_values[0])[0] ?? null

  /* Segunda lectura: el último movimiento de cada caja involucrada. Depende de la primera —la caja
     de una transferencia sale de la cuenta propia—, por eso no viaja en el mismo documento. */
  const cajaIds = [
    ...new Set([...(hayEfectivo ? [CAJA_EFECTIVO_ID] : []), ...Object.values(cajaDeCuenta).filter((x): x is string => !!x)]),
  ]
  const saldoCaja: Record<string, number> = {}
  if (cajaIds.length) {
    const s = COL_REGISTRO.cajaSub
    const leido = await cx.api<{ cajas: ItemCrudo[] }>(
      `query { cajas: items(ids: [${lista(cajaIds)}]) {
        id
        subitems { id created_at column_values(ids: ["${s.saldoInicial}", "${s.ingresos}", "${s.egresos}"]) { id text } }
      } }`,
    )
    if (leido.errores.length) {
      throw new ErrorRegistroCobro([`No se pudieron leer los saldos de las cajas: ${erroresATexto(leido.errores)}`])
    }
    for (const caja of leido.data.cajas ?? []) {
      saldoCaja[caja.id] = saldoDelUltimo(caja.subitems ?? [], s.saldoInicial, s.ingresos, s.egresos)
    }
  }

  return {
    nroRecibo,
    idMov,
    ctaCliente: cuentaLeida(data.cta),
    ctaOrigen: cuentaLeida(data.ctaOrigen),
    ventas,
    cajaDeCuenta,
    saldoCaja,
  }
}

/* ===== Las escrituras ===== */

/* ===== El plan: qué se escribe en cada tablero ===== */

/** Lo que el plan necesita saber del recibo, ya leído. */
interface Entorno {
  datos: DatosRegistroCobro
  ctx: ContextoRegistro
  hechos: Record<string, Hecho>
  /** Número del recibo para nombrar ("RECIBO-124"). */
  nro: string
  hoy: { date: string }
  ventaIds: string[]
  facturacionIds: string[]
  ventasTexto: string
}

const pagos = (lineas: readonly LineaReciboCreada[]) =>
  lineas.flatMap((l) => (l.clase === 'pago' && l.id ? [{ id: l.id, m: l.movimiento }] : []))

/** CAJAS: un movimiento por efectivo o transferencia, agrupados por caja para encadenar el saldo. */
function planCajas(en: Entorno): { porCaja: Map<string, Unidad[]>; fallas: string[] } {
  const porCaja = new Map<string, Unidad[]>()
  const fallas: string[] = []
  const s = COL_REGISTRO.cajaSub
  for (const { id, m } of pagos(en.datos.lineas)) {
    if (m.formaPago !== 'Efectivo' && m.formaPago !== 'Transferencia') continue
    const clave = `caja:${id}`
    const descripcion = `Movimiento de caja (${m.formaPago})`
    let cajaId: string | null = CAJA_EFECTIVO_ID
    if (m.formaPago === 'Transferencia') {
      cajaId = m.cuentaPropiaId ? (en.ctx.cajaDeCuenta[m.cuentaPropiaId] ?? null) : null
      if (!cajaId && !en.hechos[clave]) {
        fallas.push(
          m.cuentaPropiaId
            ? `${descripcion}: la cuenta "${m.cuentaPropia ?? m.cuentaPropiaId}" no tiene una caja conectada en Configuración`
            : `${descripcion}: la transferencia no tiene la cuenta propia donde se acreditó`,
        )
        continue
      }
    }
    if (!cajaId) continue
    const lista = porCaja.get(cajaId) ?? []
    lista.push({
      clave,
      descripcion,
      escritura: {
        tipo: 'subitem',
        padre: cajaId,
        nombre: nombre(m.formaPago, en.nro, en.ctx.idMov[id]),
        // El saldo inicial se completa al encadenar (ver `encadenar`).
        columnas: columnas({
          [s.fecha]: en.hoy,
          [s.ingresos]: round2(m.importe),
          [s.cobrado]: { index: CAJA_SUB_COBRADO_INDEX },
          [s.bancoEmisor]: etiqueta(bancoDelTablero(m.bancoEmisor)),
          [s.ventas]: relaciones(en.ventaIds),
          [s.comprobanteOrigen]: relaciones(en.facturacionIds),
        }),
        etiquetas: Boolean(m.bancoEmisor),
      },
      archivo:
        m.formaPago === 'Transferencia' && m.comprobanteArchivo
          ? { archivo: m.comprobanteArchivo, columna: s.comprobante }
          : undefined,
    })
    porCaja.set(cajaId, lista)
  }
  return { porCaja, fallas }
}

function planCheques(en: Entorno): { unidades: Unidad[]; fallas: string[] } {
  const c = COL.chequeCartera
  const fallas: string[] = []
  const unidades: Unidad[] = []
  for (const { id, m } of pagos(en.datos.lineas)) {
    if (!esChequeDeCobro(m.formaPago)) continue
    const clave = `cheque:${id}`
    const descripcion = `Cheque ${m.numeroCheque?.trim() || ''}`.trim()
    const banco = bancoDelTablero(m.bancoEmisor)
    const vencimiento = vencimientoDeCheque(m.fechaPagoCheque)
    /* Lo mismo que exigía el escenario: sin emisión, vencimiento o banco, el cheque no se puede
       dar de alta en la cartera. Se informa en vez de saltearlo en silencio. */
    const faltan = [!fecha(m.fechaEmisionCheque) && 'fecha de emisión', !fecha(vencimiento) && 'fecha de pago', !banco && 'banco'].filter(Boolean)
    if (faltan.length && !en.hechos[clave]) {
      fallas.push(`${descripcion}: faltan datos (${faltan.join(', ')})`)
      continue
    }
    const origen = CHEQUE_ORIGEN_LABEL[formatoDeCheque(m.formaPago)]
    unidades.push({
      clave,
      descripcion,
      escritura: {
        tipo: 'item',
        board: BOARDS.chequesCartera,
        nombre: nombre(origen, banco, vencimiento, en.ventasTexto),
        columnas: columnas({
          [c.numero]: m.numeroCheque?.trim(),
          [c.cuitEmisor]: cuitCompleto(m.cuitEmisor) ? m.cuitEmisor : null,
          [c.estado]: { index: CHEQUE_PENDIENTE_INDEX },
          [c.emision]: fecha(m.fechaEmisionCheque),
          [c.vencimiento]: fecha(vencimiento),
          [c.fechaPago]: fecha(m.fechaPagoCheque),
          [c.importe]: round2(m.importe),
          [c.tipo]: { labels: [origen] },
          [c.banco]: etiqueta(banco),
          [c.persona]: relacion(en.datos.clienteId),
          [COL_REGISTRO.cheque.ventas]: relaciones(en.ventaIds),
          [COL_REGISTRO.cheque.subRecibo]: relacion(id),
        }),
        etiquetas: true,
      },
    })
  }
  return { unidades, fallas }
}

function planTarjetas(en: Entorno): Unidad[] {
  const t = COL_REGISTRO.tarjeta
  return pagos(en.datos.lineas).flatMap(({ id, m }) => {
    if (!esPagoConTarjeta(m.formaPago)) return []
    const debito = m.formaPago === 'Tarjeta de débito'
    const banco = bancoDelTablero(m.bancoTarjeta)
    return [
      {
        clave: `tarjeta:${id}`,
        descripcion: `Cupón de ${m.formaPago.toLowerCase()} ${m.numeroCupon?.trim() || ''}`.trim(),
        escritura: {
          tipo: 'item' as const,
          board: BOARDS.tarjetas,
          nombre: nombre(debito ? 'Tarjeta de Debito' : 'Tarjeta de Crédito', m.numeroCupon, banco, en.ventasTexto),
          columnas: columnas({
            [t.fechaEmision]: fecha(en.datos.fechaRecibo) ?? en.hoy,
            [t.nroCupon]: m.numeroCupon?.trim(),
            [t.titular]: m.titularTarjeta?.trim(),
            [t.estado]: { index: TARJETA_PEND_ACREDITACION_INDEX },
            [t.monto]: round2(m.importe),
            [t.tipo]: { labels: [debito ? 'DEBITO' : 'CRÉDITO'] },
            [t.bancoEmisor]: etiqueta(banco),
            [t.tipoTarjeta]: etiqueta(m.tipoTarjeta),
            [t.subRecibo]: relacion(id),
            [t.ventas]: relaciones(en.ventaIds),
            [t.persona]: relacion(en.datos.clienteId),
          }),
          etiquetas: true,
        },
        archivo: m.comprobanteArchivo ? { archivo: m.comprobanteArchivo, columna: t.cupon } : undefined,
      },
    ]
  })
}

function planRetenciones(en: Entorno): Unidad[] {
  const r = COL_REGISTRO.retencion
  return pagos(en.datos.lineas).flatMap(({ id, m }) => {
    if (!esRetencion(m.formaPago)) return []
    const tipo = RETENCION_TIPO_INDEX[m.formaPago]
    return [
      {
        clave: `retencion:${id}`,
        descripcion: `${m.formaPago} ${m.nroComprobanteRetencion?.trim() || ''}`.trim(),
        escritura: {
          tipo: 'item' as const,
          board: BOARDS.retenciones,
          nombre: nombre(m.formaPago, en.nro, m.fechaRetencion || en.datos.fechaRecibo, en.ventasTexto),
          columnas: columnas({
            [r.nro]: m.nroComprobanteRetencion?.trim(),
            [r.tipo]: tipo === undefined ? null : { index: tipo },
            [r.sufridaAplicada]: { ids: [RETENCION_SUFRIDA_ID] },
            [r.monto]: round2(m.importe),
            [r.fecha]: fecha(m.fechaRetencion),
            [r.subRecibo]: relacion(id),
            [r.sujeto]: relacion(en.datos.clienteId),
            [r.ventas]: relaciones(en.ventaIds),
          }),
        },
        archivo: m.comprobanteArchivo ? { archivo: m.comprobanteArchivo, columna: r.pdf } : undefined,
      },
    ]
  })
}

/** FACTURAS: lo que este recibo le cobra a cada factura, colgado de la factura. */
function planFacturas(en: Entorno): Unidad[] {
  const f = COL_REGISTRO.factPendienteSub
  return en.datos.lineas.flatMap((l) =>
    l.clase === 'factura' && l.id
      ? [
          {
            clave: `factura:${l.id}`,
            descripcion: `Cobro en la factura ${l.factura.nro}`,
            escritura: {
              tipo: 'subitem' as const,
              padre: l.factura.id,
              nombre: nombre(en.datos.tipo === 'aplicacion' ? 'Anticipo' : 'Recibo', en.nro),
              columnas: columnas({
                [f.importeCobrado]: round2(l.factura.importe),
                [f.recibo]: relacion(en.datos.reciboId),
              }),
            },
          },
        ]
      : [],
  )
}

/** ANTICIPOS que nacen con el recibo: el entregado, el sobrante de un cobro o el crédito del pase. */
function planAnticiposNuevos(en: Entorno): Unidad[] {
  const a = COL.anticipo
  const pase = en.datos.tipo === 'pase'
  return en.datos.lineas.flatMap((l) => {
    if (!l.id || (l.clase !== 'anticipo' && l.clase !== 'creditoPase')) return []
    const detalle = l.clase === 'anticipo' ? l.detalle : undefined
    return [
      {
        clave: `anticipo:${l.id}`,
        descripcion: pase ? 'Crédito del pase de saldo' : 'Anticipo a favor del cliente',
        escritura: {
          tipo: 'item' as const,
          board: BOARDS.anticipos,
          nombre: nombre(pase ? 'Credito x Pase de Saldo' : 'Anticipo', en.nro),
          columnas: columnas({
            [a.cliente]: relacion(en.datos.clienteId),
            [a.estado]: { index: ANTICIPO_ESTADO_INDEX.pendienteDeAplicar },
            [a.importe]: round2(l.importe),
            [a.detalle]: detalle,
            [a.fecha]: en.hoy,
            [COL_REGISTRO.anticipo.subRecibo]: relacion(l.id),
          }),
          codigo: a.idAnticipo,
        },
      },
    ]
  })
}

/** Lo que se consume de un anticipo: en una aplicación, o el débito de un pase. */
function planAplicaciones(en: Entorno, clase: 'anticipoAplicado' | 'debitoPase'): Unidad[] {
  return en.datos.lineas.flatMap((l) => {
    if (!l.id || l.clase !== clase) return []
    const anticipoId = l.clase === 'anticipoAplicado' ? l.anticipo.id : l.anticipoId
    const importe = l.clase === 'anticipoAplicado' ? l.anticipo.importe : l.importe
    return [
      {
        clave: `aplicacion:${l.id}`,
        descripcion: clase === 'debitoPase' ? 'Débito en el anticipo de origen' : 'Aplicación del anticipo',
        escritura: {
          tipo: 'subitem' as const,
          padre: anticipoId,
          nombre: nombre(clase === 'debitoPase' ? 'Debito x Pase de Saldo Aplicado' : 'Anticipo Aplicado', en.nro),
          columnas: { [COL_REGISTRO.anticipoSub.importeAplicado]: round2(importe) },
        },
      },
    ]
  })
}

/** Lo que el recibo declara como RECIBIDO: lo que sale de la cuenta del cliente en su movimiento. */
function totalRecibido(datos: DatosRegistroCobro): number {
  return suma(
    datos.lineas.flatMap((l) =>
      l.clase === 'pago' ? [l.movimiento.importe] : l.clase === 'creditoPase' ? [l.importe] : [],
    ),
  )
}

/* ===== Los flujos ===== */

/**
 * CUENTA CORRIENTE del cliente, en tres tiempos que dependen uno del otro:
 *   1. los anticipos que nacen y las aplicaciones de los que se usan;
 *   2. el movimiento del recibo en la cuenta (en una aplicación no hay: no entró dinero);
 *   3. "🤖Anticipo pend de Aplicar", con lo que el recibo deja o consume de saldo a favor.
 * Un tiempo que no entra entero corta los siguientes: el reintento retoma desde ahí.
 */
async function flujoCuentaCliente(en: Entorno, ej: Ejecucion): Promise<void> {
  const { datos, ctx } = en
  const anticipos = planAnticiposNuevos(en)
  const aplicaciones = planAplicaciones(en, 'anticipoAplicado')
  if (!(await ejecutar([...anticipos, ...aplicaciones], ej))) return

  const cta = ctx.ctaCliente
  const necesitaCuenta = datos.tipo !== 'aplicacion' || aplicaciones.length > 0 || anticipos.length > 0
  if (!cta) {
    if (necesitaCuenta) ej.fallas.push('Cuenta corriente: el cliente no tiene una cuenta corriente conectada en Monday')
    return
  }

  if (datos.tipo !== 'aplicacion') {
    const s = COL.ctaCteSub
    const codigoAnticipo = anticipos[0] ? ej.hechos[anticipos[0].clave]?.codigo : undefined
    const titulo =
      datos.tipo === 'pase'
        ? nombre('Credito x Pase de Saldo', en.nro)
        : datos.tipo === 'anticipo'
          ? codigoAnticipo
            ? nombre('Entrega de Anticipo', codigoAnticipo)
            : nombre('Anticipo', en.nro)
          : en.nro
    const movimiento: Unidad = {
      clave: 'cuenta:cliente',
      descripcion: 'Movimiento en la cuenta corriente',
      escritura: {
        tipo: 'subitem',
        padre: cta.id,
        nombre: titulo || 'Recibo',
        columnas: columnas({
          [s.movimiento]: {
            index:
              datos.tipo === 'pase'
                ? MOVIMIENTO_CTA_CTE_CLIENTE_INDEX.creditoPase
                : datos.tipo === 'anticipo'
                  ? MOVIMIENTO_CTA_CTE_CLIENTE_INDEX.anticipo
                  : MOVIMIENTO_CTA_CTE_CLIENTE_INDEX.cobro,
          },
          [s.saldoInicial]: cta.saldo,
          [s.resta]: totalRecibido(datos),
          [s.fechaEmision]: en.hoy,
          [s.origen]: relacion(datos.reciboId),
        }),
      },
    }
    if (!(await ejecutar([movimiento], ej))) return
  }

  /* El saldo a favor pendiente se escribe UNA vez, con el total del recibo: Make lo sumaba por cada
     línea sobre el valor leído al principio, y con dos anticipos en el mismo recibo el segundo
     pisaba al primero. */
  const delta = round2(
    suma(datos.lineas.flatMap((l) => (l.id && (l.clase === 'anticipo' || l.clase === 'creditoPase') ? [l.importe] : []))) -
      suma(datos.lineas.flatMap((l) => (l.id && l.clase === 'anticipoAplicado' ? [l.anticipo.importe] : []))),
  )
  if (delta !== 0) {
    await ejecutar(
      [
        {
          clave: 'cuenta:anticipoPend',
          descripcion: 'Anticipo pendiente de aplicar de la cuenta corriente',
          escritura: {
            tipo: 'columnas',
            board: BOARDS.ctaCte,
            itemId: cta.id,
            columnas: { [COL.ctaCte.anticiposPendAplicar]: round2(cta.anticipoPend + delta) },
          },
        },
      ],
      ej,
    )
  }
}

/**
 * PASE DE SALDO: el débito en los anticipos de origen, en la cuenta corriente de origen y en su
 * "🤖Anticipo pend de Aplicar" —el saldo a favor que se le pasa a otro deja de estar pendiente—.
 * Make no hacía este último descuento.
 */
async function flujoCuentaOrigen(en: Entorno, ej: Ejecucion): Promise<void> {
  const debitos = en.datos.lineas.filter((l) => l.clase === 'debitoPase' && l.id)
  if (!debitos.length) return
  if (!(await ejecutar(planAplicaciones(en, 'debitoPase'), ej))) return
  const cta = en.ctx.ctaOrigen
  if (!cta) {
    ej.fallas.push('Cuenta corriente de origen: la persona de origen no tiene una cuenta corriente conectada en Monday')
    return
  }
  const s = COL.ctaCteSub
  const movimientos: Unidad[] = debitos.map((l) => ({
    clave: `cuenta:origen:${l.id}`,
    descripcion: 'Débito en la cuenta corriente de origen',
    escritura: {
      tipo: 'subitem',
      padre: cta.id,
      nombre: nombre('Debito x Pase de Saldo', en.nro),
      columnas: columnas({
        [s.movimiento]: { index: MOVIMIENTO_CTA_CTE_CLIENTE_INDEX.debitoPase },
        [s.suma]: l.clase === 'debitoPase' ? round2(l.importe) : 0,
        [s.fechaEmision]: en.hoy,
        [s.origen]: relacion(en.datos.reciboId),
      }),
    },
  }))
  const movidos = await ejecutar(
    encadenar(movimientos, ej.hechos, cta.saldo, s.saldoInicial, (u) => importeDe(u, s.suma)),
    ej,
  )
  if (!movidos) return
  const debitado = suma(debitos.map((l) => (l.clase === 'debitoPase' ? l.importe : 0)))
  await ejecutar(
    [
      {
        clave: 'cuenta:origen:anticipoPend',
        descripcion: 'Anticipo pendiente de aplicar de la cuenta de origen',
        escritura: {
          tipo: 'columnas',
          board: BOARDS.ctaCte,
          itemId: cta.id,
          columnas: { [COL.ctaCte.anticiposPendAplicar]: round2(cta.anticipoPend - debitado) },
        },
      },
    ],
    ej,
  )
}

/**
 * Registra el cobro en todos los tableros que impacta. Lanza `ErrorRegistroCobro` con lo que no
 * entró; lo que sí entró queda anotado en `avance.hechos` (y se avisa por `alAvanzar`) para que el
 * reintento no lo repita.
 */
export async function registrarCobro(
  datos: DatosRegistroCobro,
  avance: Pick<AvanceRegistroCobro, 'hechos'>,
  alAvanzar: (hechos: Record<string, Hecho>) => void = () => {},
  conexion?: ConexionRegistro,
): Promise<void> {
  if (!conexion && !mondayHabilitado()) return
  const cx = conexion ?? conexionReal()

  const ctx = await leerContexto(datos, cx)
  const ventas = datos.lineas.flatMap((l) => (l.clase === 'factura' ? [ctx.ventas[l.factura.id]] : [])).filter(Boolean)
  const en: Entorno = {
    datos,
    ctx,
    hechos: avance.hechos,
    nro: ctx.nroRecibo,
    hoy: { date: hoyIso() },
    ventaIds: [...new Set(ventas.flatMap((v) => v.ventaIds))],
    facturacionIds: [...new Set(ventas.flatMap((v) => v.facturacionIds))],
    ventasTexto: [...new Set(ventas.flatMap((v) => v.codigos))].join(', '),
  }
  const ej: Ejecucion = { hechos: { ...avance.hechos }, fallas: [], alAvanzar, cx }

  const cajas = planCajas(en)
  const cheques = planCheques(en)
  ej.fallas.push(...cajas.fallas, ...cheques.fallas)

  /* Todos los tableros a la vez: ninguno depende de otro. */
  await Promise.all([
    flujoCuentaCliente(en, ej),
    flujoCuentaOrigen(en, ej),
    ...[...cajas.porCaja].map(([cajaId, unidades]) =>
      ejecutar(
        encadenar(unidades, ej.hechos, ctx.saldoCaja[cajaId] ?? 0, COL_REGISTRO.cajaSub.saldoInicial, (u) =>
          importeDe(u, COL_REGISTRO.cajaSub.ingresos),
        ),
        ej,
      ),
    ),
    ejecutar(cheques.unidades, ej),
    ejecutar(planTarjetas(en), ej),
    ejecutar(planRetenciones(en), ej),
    ejecutar(planFacturas(en), ej),
  ])

  avance.hechos = ej.hechos
  if (ej.fallas.length) throw new ErrorRegistroCobro(ej.fallas)
}
