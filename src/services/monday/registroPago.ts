/**
 * "Registrar Pago" desde la app: lo que antes hacía el escenario de Make "[TAP] Cuando se registra
 * Orden de Pago -> Impactar en Caja y Cta Cte Proveedor", disparado por "🤖Estado Registro de Pago"
 * en "Registrar".
 *
 * Es el espejo de `registroCobro` del otro lado del mostrador: el dinero SALE. Corre DESPUÉS de
 * `crearOrdenDePago`, que devuelve cada subelemento con su id y de qué salió (`LineaOrdenCreada`), y
 * con eso impacta cada tablero:
 *
 *   · CAJAS            · un EGRESO por efectivo o transferencia, en la caja que corresponde, con el
 *                        saldo encadenado desde el último movimiento de esa caja.
 *   · CHEQUES          · el de CARTERA que se endosa queda vinculado al pago y en "100% Usado"; el
 *                        NUEVO que libramos se da de alta y queda igual.
 *   · RETENCIONES      · un ítem "Aplicada" en "🔃Retenciones" por la retención practicada, con la
 *                        constancia que emitió la app.
 *   · FACTURAS         · un subelemento en la factura de compra cancelada, con lo que se le paga.
 *   · ANTICIPOS        · el anticipo (o el crédito del pase) que queda a favor NUESTRO, y la
 *                        aplicación del saldo que se usa.
 *   · CUENTA CORRIENTE · el movimiento de la orden en la cuenta del proveedor —y, en un pase, el
 *                        débito en la cuenta de origen— y su "🤖Anticipo pend de Aplicar".
 *
 * Mismas reglas que el cobro: cada tablero es un FLUJO independiente y todos corren EN PARALELO; lo
 * que encadena saldo viaja en una mutación y en orden; NO se escribe el estado de registro de la
 * orden ni ningún update —si algo no entra se informa en la app (`ErrorRegistroPago`)—; y es
 * RETOMABLE: lo creado queda en `hechos` y un reintento crea sólo lo que faltó.
 *
 * Sin token (modo local) no se escribe nada, igual que el resto de la capa de servicio.
 */
import { round2 } from '@/lib/format'
import { hoyIso } from '@/lib/dates'
import { cuitCompleto } from '@/lib/pagos'
import { esCajaCheque, esCajaTransferencia, esRetencionGAN, vencimientoDeCajaCheque } from '@/lib/pagosProveedor'
import type { MovimientoCaja } from '@/types'
import {
  ANTICIPO_ESTADO_INDEX,
  BANCO_EMISOR_LABEL,
  BOARDS,
  CAJA_EFECTIVO_ID,
  CAJA_SUB_PAGO_PROVEEDOR_INDEX,
  CHEQUE_CARTERA_ESTADO_INDEX,
  CHEQUE_ORIGEN_LABEL,
  COL,
  COL_REGISTRO,
  COL_REGISTRO_PAGO,
  MOVIMIENTO_CTA_CTE_PROVEEDOR_INDEX,
  RETENCION_APLICADA_ID,
  RETENCION_TIPO_INDEX,
} from './columns'
import type { AnticipoAAplicarPago, FacturaCompraACancelar } from './ordenPago'
import { num, type CV } from './parse'
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
  subirA,
  suma,
  type ConexionRegistro,
  type CuentaLeida,
  type Ejecucion,
  type Hecho,
  type SubitemLeido,
  type Unidad,
} from './registroComun'
import { mondayHabilitado } from './sdk'

/* ===== Lo que llega de la creación de la orden ===== */

/** De qué salió un subelemento de la orden. */
export type OrigenLineaPago =
  /** Una factura de compra cancelada ("Fact Cancelada"). */
  | { clase: 'factura'; factura: FacturaCompraACancelar }
  /** La línea del anticipo: el entregado a cuenta o el sobrante de un pago. */
  | { clase: 'anticipo'; importe: number; detalle?: string }
  /** Una caja: efectivo, transferencia, cheque o retención. */
  | { clase: 'pago'; movimiento: MovimientoCaja }
  /** Un anticipo que se imputa en una aplicación de cuenta corriente. */
  | { clase: 'anticipoAplicado'; anticipo: AnticipoAAplicarPago }
  /** Pase de saldo: lo que se consume de un anticipo de la cuenta ORIGEN. */
  | { clase: 'debitoPase'; anticipoId: string; personaOrigenId: string; importe: number }
  /** Pase de saldo: lo que se le acredita a la cuenta DESTINO. */
  | { clase: 'creditoPase'; importe: number }

/** Un subelemento de la orden ya creado. `id` vacío = no entró. */
export type LineaOrdenCreada = OrigenLineaPago & { id: string }

export type TipoRegistroPago = 'pago' | 'anticipo' | 'aplicacion' | 'pase'

/**
 * La CONSTANCIA de retención que emitió la app, para subirla a la fila que crea el registro. Su
 * número de certificado y el de la orden eran predicciones: si Monday les dio otros, se regenera.
 */
export interface ConstanciaARegistrar {
  pdf: File
  /** Certificado con el que se emitió ("RETENC-006"). */
  numero: string
  /** Número de orden con el que se emitió ("IDPAGO-020"). */
  nroOrden: string
  regenerar: (certificado: string, nroOrden: string) => Promise<File>
}

export interface DatosRegistroPago {
  /** El ítem en "⬅️ Pagos - PENDIENTES". */
  ordenId: string
  tipo: TipoRegistroPago
  /** El proveedor de la orden, o la cuenta DESTINO de un pase. */
  proveedorId: string
  /** Fecha del pago (dd/MM/yyyy): la de la factura pagada, la retención y el movimiento de caja. */
  fechaPago: string
  lineas: readonly LineaOrdenCreada[]
  /** El certificado con el que se escribió la línea de la retención ("🤖Nro Retencion"). */
  nroRetencion?: string | null
  constancia?: ConstanciaARegistrar | null
}

/** El avance de un registro, para retomarlo. Lo guarda la vista con la orden emitida. */
export interface AvanceRegistroPago {
  lineas: LineaOrdenCreada[]
  hechos: Record<string, Hecho>
}

/** Lo que no se pudo registrar, contado en términos del usuario. Nada de esto se escribe en Monday. */
export class ErrorRegistroPago extends Error {
  constructor(public readonly fallas: string[]) {
    super(`No se pudo registrar todo el pago: ${fallas.join(' · ')}`)
    this.name = 'ErrorRegistroPago'
  }
}

/** Banco tal como lo nombra el tablero ("Banco HSBC" → "HSBC"): mismo mapa que el cobro. */
const bancoDelTablero = (banco: string | null | undefined): string | null => {
  const n = banco?.trim()
  return n ? (BANCO_EMISOR_LABEL[n] ?? n) : null
}

/* ===== Lo que se lee antes de escribir ===== */

export interface ContextoRegistroPago {
  nroOrden: string
  /** "🤖ID Mov Pago" de cada subelemento, por id. */
  idMov: Record<string, string>
  ctaProveedor: CuentaLeida | null
  ctaOrigen: CuentaLeida | null
  /** Por factura PENDIENTE: el comprobante de "🗒️ Facturas Compras" que tiene vinculado. */
  comprobantes: Record<string, string[]>
  /** Caja de cada cuenta bancaria propia (ítem de Configuración → ítem de Cajas). */
  cajaDeCuenta: Record<string, string | null>
  saldoCaja: Record<string, number>
}

async function leerContexto(datos: DatosRegistroPago, cx: ConexionRegistro): Promise<ContextoRegistroPago> {
  const { ordenId, proveedorId, lineas } = datos
  const facturaIds = lineas.flatMap((l) => (l.clase === 'factura' ? [l.factura.id] : []))
  const cuentaIds = [
    ...new Set(
      lineas.flatMap((l) =>
        l.clase === 'pago' && esCajaTransferencia(l.movimiento.formaPago) && l.movimiento.bancoOrigenId
          ? [l.movimiento.bancoOrigenId]
          : [],
      ),
    ),
  ]
  const origenId = lineas.find((l) => l.clase === 'debitoPase')?.personaOrigenId ?? null
  const hayEfectivo = lineas.some((l) => l.clase === 'pago' && l.movimiento.formaPago === 'Efectivo')

  const cuenta = (alias: string, personaId: string) => `${alias}: boards(ids: [${BOARDS.ctaCteProveedores}]) {
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
    `orden: items(ids: [${Number(ordenId)}]) {
      id
      column_values(ids: ["${COL.ordenPago.nro}"]) { id text }
      subitems { id column_values(ids: ["${COL_REGISTRO_PAGO.ordenPagoSub.idMov}"]) { id text } }
    }`,
    cuenta('cta', proveedorId),
    origenId ? cuenta('ctaOrigen', origenId) : '',
    facturaIds.length
      ? `facturas: items(ids: [${lista(facturaIds)}]) {
          id
          column_values(ids: ["${COL.factCompra.factura}"]) { id ... on BoardRelationValue { linked_item_ids } }
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
    orden: (ItemCrudo & { subitems: { id: string; column_values: CV[] }[] })[]
    cta: Cuentas
    ctaOrigen: Cuentas
    facturas: ItemCrudo[]
    config: ItemCrudo[]
  }>(`query { ${partes.join('\n')} }`)
  if (errores.length) throw new ErrorRegistroPago([`No se pudieron leer los datos para registrar: ${erroresATexto(errores)}`])

  const orden = data.orden?.[0]
  const nroOrden = orden?.column_values.find((c) => c.id === COL.ordenPago.nro)?.text?.trim() ?? ''
  const idMov = Object.fromEntries((orden?.subitems ?? []).map((s) => [s.id, s.column_values[0]?.text?.trim() ?? '']))

  const cuentaLeida = (cuentas: Cuentas | undefined): CuentaLeida | null => {
    const item = cuentas?.[0]?.items_page.items?.[0]
    if (!item) return null
    return {
      id: item.id,
      saldo: saldoDelUltimo(item.subitems ?? [], COL.ctaCteSub.saldoInicial, COL.ctaCteSub.suma, COL.ctaCteSub.resta),
      anticipoPend: num(item.column_values.find((c) => c.id === COL.ctaCte.anticiposPendAplicar)?.text),
    }
  }

  const comprobantes: Record<string, string[]> = {}
  for (const f of data.facturas ?? []) comprobantes[f.id] = idsDe(f.column_values[0])

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
      throw new ErrorRegistroPago([`No se pudieron leer los saldos de las cajas: ${erroresATexto(leido.errores)}`])
    }
    for (const caja of leido.data.cajas ?? []) {
      saldoCaja[caja.id] = saldoDelUltimo(caja.subitems ?? [], s.saldoInicial, s.ingresos, s.egresos)
    }
  }

  return {
    nroOrden,
    idMov,
    ctaProveedor: cuentaLeida(data.cta),
    ctaOrigen: cuentaLeida(data.ctaOrigen),
    comprobantes,
    cajaDeCuenta,
    saldoCaja,
  }
}

/* ===== El plan: qué se escribe en cada tablero ===== */

interface Entorno {
  datos: DatosRegistroPago
  ctx: ContextoRegistroPago
  hechos: Record<string, Hecho>
  /** Número de la orden para nombrar ("IDPAGO-021"). */
  nro: string
  hoy: { date: string }
  /** Fecha del pago, o la de hoy si no vino. */
  fechaPago: { date: string }
  /** Las facturas PENDIENTES canceladas (❓ Facturas Compra Pend de Pago). */
  facturaIds: string[]
  /** Sus comprobantes en "🗒️ Facturas Compras": lo que linkean caja, cheque y retención. */
  comprobanteIds: string[]
  /** Los números de las facturas canceladas, para nombrar ("0002-00003314, 0002-00003315"). */
  facturasTexto: string
}

const pagos = (lineas: readonly LineaOrdenCreada[]) =>
  lineas.flatMap((l) => (l.clase === 'pago' && l.id ? [{ id: l.id, m: l.movimiento }] : []))

/** CAJAS: un EGRESO por efectivo o transferencia, agrupados por caja para encadenar el saldo. */
function planCajas(en: Entorno): { porCaja: Map<string, Unidad[]>; fallas: string[] } {
  const porCaja = new Map<string, Unidad[]>()
  const fallas: string[] = []
  const s = COL_REGISTRO.cajaSub
  for (const { id, m } of pagos(en.datos.lineas)) {
    if (m.formaPago !== 'Efectivo' && !esCajaTransferencia(m.formaPago)) continue
    const clave = `caja:${id}`
    const descripcion = `Egreso de caja (${m.formaPago})`
    let cajaId: string | null = CAJA_EFECTIVO_ID
    if (esCajaTransferencia(m.formaPago)) {
      cajaId = m.bancoOrigenId ? (en.ctx.cajaDeCuenta[m.bancoOrigenId] ?? null) : null
      if (!cajaId && !en.hechos[clave]) {
        fallas.push(
          m.bancoOrigenId
            ? `${descripcion}: la cuenta "${m.bancoOrigen ?? m.bancoOrigenId}" no tiene una caja conectada en Configuración`
            : `${descripcion}: la transferencia no tiene la cuenta propia de la que salió`,
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
        // El saldo inicial se completa al encadenar.
        columnas: columnas({
          [s.fecha]: en.fechaPago,
          [s.egresos]: round2(m.importe),
          [s.cobrado]: { index: CAJA_SUB_PAGO_PROVEEDOR_INDEX },
          [s.comprobanteOrigen]: relaciones(en.comprobanteIds),
        }),
      },
    })
    porCaja.set(cajaId, lista)
  }
  return { porCaja, fallas }
}

/**
 * CHEQUES. Los dos van a "🧾Cheques/eCheq en Cartera" y terminan igual —vinculados a las facturas
 * que pagaron y a la línea de la orden, en "100% Usado"— pero por caminos distintos:
 *   · CARTERA · el cheque ya existe: se le escriben los vínculos y el estado.
 *   · NUEVO   · lo libramos nosotros: se lo da de alta en "Pendiente" y DESPUÉS pasa a "100% Usado",
 *               igual que el de cartera. Son dos escrituras a propósito: el cambio de estado es lo
 *               que dispara las automatizaciones del tablero (el pase a USADOS), y un ítem que ya
 *               nace en "100% Usado" no cambia de estado.
 * Lo devuelve en dos tiempos: lo que se escribe primero y lo que depende del alta.
 */
function planCheques(en: Entorno): { altas: Unidad[]; usos: (hechos: Record<string, Hecho>) => Unidad[]; fallas: string[] } {
  const c = COL.chequeCartera
  const x = COL_REGISTRO_PAGO.cheque
  const fallas: string[] = []
  const altas: Unidad[] = []
  /* De cada cheque, su línea y de dónde sale el ítem: el de cartera ya lo tiene; el nuevo, cuando
     entre su alta (`alta`). */
  const usos: { subId: string; descripcion: string; chequeId?: string; alta?: string }[] = []

  for (const { id, m } of pagos(en.datos.lineas)) {
    if (!esCajaCheque(m.formaPago)) continue
    const descripcion = `Cheque ${m.numeroCheque?.trim() || ''}`.trim()
    if (m.modalidadCheque === 'cartera') {
      if (!m.chequeId) {
        fallas.push(`${descripcion}: no tiene el cheque de cartera que se endosa`)
        continue
      }
      usos.push({ subId: id, descripcion, chequeId: m.chequeId })
      continue
    }
    const clave = `cheque:alta:${id}`
    const vencimiento = vencimientoDeCajaCheque(m)
    const banco = bancoDelTablero(m.bancoEmisor)
    /* Lo mismo que exigía el escenario para dar de alta el cheque: sin sus fechas, su número o su
       banco no se puede. Se informa en vez de saltearlo en silencio. */
    const faltan = [
      !m.numeroCheque?.trim() && 'número',
      !fecha(m.fechaEmisionCheque) && 'fecha de emisión',
      !fecha(vencimiento) && 'fecha de pago',
      !banco && 'banco',
    ].filter(Boolean)
    if (faltan.length && !en.hechos[clave]) {
      fallas.push(`${descripcion}: faltan datos para darlo de alta (${faltan.join(', ')})`)
      continue
    }
    const origen = CHEQUE_ORIGEN_LABEL[m.formatoCheque ?? 'FISICO']
    altas.push({
      clave,
      descripcion: `Alta del ${descripcion.toLowerCase()}`,
      escritura: {
        tipo: 'item',
        board: BOARDS.chequesCartera,
        nombre: nombre(origen, banco, vencimiento, en.facturasTexto),
        columnas: columnas({
          [c.numero]: m.numeroCheque?.trim(),
          [c.cuitEmisor]: cuitCompleto(m.cuitEmisor) ? m.cuitEmisor : null,
          [c.estado]: { index: CHEQUE_CARTERA_ESTADO_INDEX.pendiente },
          [c.emision]: fecha(m.fechaEmisionCheque),
          [c.vencimiento]: fecha(vencimiento),
          [c.fechaPago]: fecha(m.fechaPagoCheque),
          [c.importe]: round2(m.importe),
          [c.tipo]: { labels: [origen] },
          [c.banco]: etiqueta(banco),
          [x.facturasCompra]: relaciones(en.comprobanteIds),
          [x.subPago]: relacion(id),
        }),
        etiquetas: true,
      },
    })
    usos.push({ subId: id, descripcion, alta: clave })
  }

  return {
    altas,
    fallas,
    usos: (hechos) =>
      usos.flatMap((u) => {
        // Un cheque nuevo cuya alta no entró todavía no tiene uso que escribir.
        const chequeId = u.chequeId ?? (u.alta ? hechos[u.alta]?.id : undefined)
        if (!chequeId) return []
        return [
          {
            clave: `cheque:uso:${u.subId}`,
            descripcion: `Uso del ${u.descripcion.toLowerCase()}`,
            escritura: {
              tipo: 'columnas' as const,
              board: BOARDS.chequesCartera,
              itemId: chequeId,
              columnas: columnas({
                [x.facturasCompra]: relaciones(en.comprobanteIds),
                [x.subPago]: relacion(u.subId),
                [c.estado]: { index: CHEQUE_CARTERA_ESTADO_INDEX.usado },
              }),
            },
          },
        ]
      }),
  }
}

/** RETENCIONES practicadas: una fila "Aplicada" en "🔃Retenciones". */
function planRetenciones(en: Entorno): Unidad[] {
  const r = COL_REGISTRO.retencion
  const x = COL_REGISTRO_PAGO.retencion
  return pagos(en.datos.lineas).flatMap(({ id, m }) => {
    if (!esRetencionGAN(m.formaPago)) return []
    return [
      {
        clave: `retencion:${id}`,
        descripcion: 'Retención de Ganancias',
        escritura: {
          tipo: 'item' as const,
          board: BOARDS.retenciones,
          nombre: nombre(m.formaPago, en.nro, en.datos.fechaPago, en.facturasTexto),
          columnas: columnas({
            [r.tipo]: { index: RETENCION_TIPO_INDEX['Retencion GAN'] as number },
            [r.sufridaAplicada]: { ids: [RETENCION_APLICADA_ID] },
            [r.monto]: round2(m.importe),
            [r.fecha]: en.fechaPago,
            [r.sujeto]: relacion(en.datos.proveedorId),
            [x.subOrdenPago]: relacion(id),
            [x.facturasCompra]: relaciones(en.comprobanteIds),
          }),
          codigo: COL.retencion.nro,
        },
      },
    ]
  })
}

/** FACTURAS: lo que esta orden le paga a cada factura, colgado de la factura. */
function planFacturas(en: Entorno): Unidad[] {
  const f = COL_REGISTRO_PAGO.factCompraSub
  return en.datos.lineas.flatMap((l) =>
    l.clase === 'factura' && l.id
      ? [
          {
            clave: `factura:${l.id}`,
            descripcion: `Pago en la factura ${l.factura.nro}`,
            escritura: {
              tipo: 'subitem' as const,
              padre: l.factura.id,
              nombre: nombre(en.datos.tipo === 'aplicacion' ? 'Anticipo' : 'Orden de Pago', en.nro),
              columnas: columnas({
                [f.importePagado]: round2(l.factura.importe),
                [f.fechaPago]: en.fechaPago,
                [f.orden]: relacion(en.datos.ordenId),
              }),
            },
          },
        ]
      : [],
  )
}

/** ANTICIPOS que nacen con la orden: el entregado a cuenta, el sobrante o el crédito del pase. */
function planAnticiposNuevos(en: Entorno): Unidad[] {
  const a = COL.anticipoProveedor
  const pase = en.datos.tipo === 'pase'
  return en.datos.lineas.flatMap((l) => {
    if (!l.id || (l.clase !== 'anticipo' && l.clase !== 'creditoPase')) return []
    const detalle = l.clase === 'anticipo' ? l.detalle?.trim() : undefined
    return [
      {
        clave: `anticipo:${l.id}`,
        descripcion: pase ? 'Crédito del pase de saldo' : 'Anticipo a favor con el proveedor',
        escritura: {
          tipo: 'item' as const,
          board: BOARDS.anticiposProveedor,
          nombre: nombre(pase ? 'Credito x Pase de Saldo' : 'Anticipo', en.nro),
          columnas: columnas({
            [a.proveedor]: relacion(en.datos.proveedorId),
            [a.estado]: { index: ANTICIPO_ESTADO_INDEX.pendienteDeAplicar },
            [a.importe]: round2(l.importe),
            [a.detalle]: detalle ? { text: detalle } : null,
            [a.fecha]: en.hoy,
            [a.subOrdenPago]: relacion(l.id),
          }),
          codigo: COL_REGISTRO_PAGO.anticipoProveedor.codigo,
        },
      },
    ]
  })
}

/** Lo que se consume de un anticipo: en una aplicación, o el débito de un pase. */
function planAplicaciones(en: Entorno, clase: 'anticipoAplicado' | 'debitoPase'): Unidad[] {
  const s = COL_REGISTRO_PAGO.anticipoProveedorSub
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
          columnas: columnas({
            [s.importeAplicado]: round2(importe),
            // En una aplicación, contra qué facturas se usó el saldo.
            [s.facturas]: clase === 'anticipoAplicado' ? relaciones(en.facturaIds) : null,
          }),
        },
      },
    ]
  })
}

/** Lo que la orden declara como ENTREGADO: lo que resta de la deuda con el proveedor. */
function totalEntregado(datos: DatosRegistroPago): number {
  return suma(
    datos.lineas.flatMap((l) => (l.clase === 'pago' ? [l.movimiento.importe] : l.clase === 'creditoPase' ? [l.importe] : [])),
  )
}

/* ===== Los flujos ===== */

/**
 * CUENTA CORRIENTE del proveedor, en tres tiempos que dependen uno del otro:
 *   1. los anticipos que nacen y las aplicaciones de los que se usan;
 *   2. el movimiento de la orden en la cuenta (en una aplicación no hay: no salió dinero);
 *   3. "🤖Anticipo pend de Aplicar", con lo que la orden deja o consume de saldo a favor.
 */
async function flujoCuentaProveedor(en: Entorno, ej: Ejecucion): Promise<void> {
  const { datos, ctx } = en
  const anticipos = planAnticiposNuevos(en)
  const aplicaciones = planAplicaciones(en, 'anticipoAplicado')
  if (!(await ejecutar([...anticipos, ...aplicaciones], ej))) return

  const cta = ctx.ctaProveedor
  if (!cta) {
    ej.fallas.push('Cuenta corriente: el proveedor no tiene una cuenta corriente conectada en Monday')
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
          : nombre('Pago', en.nro)
    /* "🤖Origen" de este tablero acepta facturas de compra pendientes, cheques y anticipos —NO la
       orden de pago—: en un pago se linkean las facturas canceladas (y el anticipo del sobrante),
       y en un anticipo o un pase, el anticipo que nació con él. */
    const origen = relaciones([
      ...(datos.tipo === 'pago' ? en.facturaIds : []),
      ...anticipos.map((u) => ej.hechos[u.clave]?.id),
    ])
    const movimiento: Unidad = {
      clave: 'cuenta:proveedor',
      descripcion: 'Movimiento en la cuenta corriente del proveedor',
      escritura: {
        tipo: 'subitem',
        padre: cta.id,
        nombre: titulo || 'Pago',
        columnas: columnas({
          [s.movimiento]: {
            index:
              datos.tipo === 'pase'
                ? MOVIMIENTO_CTA_CTE_PROVEEDOR_INDEX.creditoPase
                : datos.tipo === 'anticipo'
                  ? MOVIMIENTO_CTA_CTE_PROVEEDOR_INDEX.anticipo
                  : MOVIMIENTO_CTA_CTE_PROVEEDOR_INDEX.pago,
          },
          [s.saldoInicial]: cta.saldo,
          [s.resta]: totalEntregado(datos),
          [COL_REGISTRO_PAGO.ctaCteSub.fecha]: en.fechaPago,
          [COL_REGISTRO_PAGO.ctaCteSub.origen]: origen,
        }),
      },
    }
    if (!(await ejecutar([movimiento], ej))) return
  }

  /* El saldo a favor pendiente se escribe UNA vez, con el total de la orden: Make lo sumaba por
     cada línea sobre el valor leído al principio (y la resta de la aplicación la mandaba al
     tablero de CLIENTES). */
  const delta = round2(
    suma(datos.lineas.flatMap((l) => (l.id && (l.clase === 'anticipo' || l.clase === 'creditoPase') ? [l.importe] : []))) -
      suma(datos.lineas.flatMap((l) => (l.id && l.clase === 'anticipoAplicado' ? [l.anticipo.importe] : []))),
  )
  if (delta !== 0) {
    await ejecutar(
      [
        {
          clave: 'cuenta:anticipoPend',
          descripcion: 'Anticipo pendiente de aplicar de la cuenta del proveedor',
          escritura: {
            tipo: 'columnas',
            board: BOARDS.ctaCteProveedores,
            itemId: cta.id,
            columnas: { [COL.ctaCte.anticiposPendAplicar]: round2(cta.anticipoPend + delta) },
          },
        },
      ],
      ej,
    )
  }
}

/** PASE DE SALDO: el débito en los anticipos, la cuenta corriente y el pendiente del ORIGEN. */
async function flujoCuentaOrigen(en: Entorno, ej: Ejecucion): Promise<void> {
  const debitos = en.datos.lineas.filter((l) => l.clase === 'debitoPase' && l.id)
  if (!debitos.length) return
  if (!(await ejecutar(planAplicaciones(en, 'debitoPase'), ej))) return
  const cta = en.ctx.ctaOrigen
  if (!cta) {
    ej.fallas.push('Cuenta corriente de origen: el proveedor de origen no tiene una cuenta corriente conectada en Monday')
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
        [s.movimiento]: { index: MOVIMIENTO_CTA_CTE_PROVEEDOR_INDEX.debitoPase },
        [s.suma]: l.clase === 'debitoPase' ? round2(l.importe) : 0,
        [COL_REGISTRO_PAGO.ctaCteSub.fecha]: en.fechaPago,
        [COL_REGISTRO_PAGO.ctaCteSub.origen]: l.clase === 'debitoPase' ? relacion(l.anticipoId) : null,
      }),
    },
  }))
  const movidos = await ejecutar(encadenar(movimientos, ej.hechos, cta.saldo, s.saldoInicial, (u) => importeDe(u, s.suma)), ej)
  if (!movidos) return
  const debitado = suma(debitos.map((l) => (l.clase === 'debitoPase' ? l.importe : 0)))
  await ejecutar(
    [
      {
        clave: 'cuenta:origen:anticipoPend',
        descripcion: 'Anticipo pendiente de aplicar de la cuenta de origen',
        escritura: {
          tipo: 'columnas',
          board: BOARDS.ctaCteProveedores,
          itemId: cta.id,
          columnas: { [COL.ctaCte.anticiposPendAplicar]: round2(cta.anticipoPend - debitado) },
        },
      },
    ],
    ej,
  )
}

/** CHEQUES: primero las altas de los nuevos, después el uso de todos (vínculos y "100% Usado"). */
async function flujoCheques(ej: Ejecucion, plan: ReturnType<typeof planCheques>): Promise<void> {
  await ejecutar(plan.altas, ej)
  await ejecutar(plan.usos(ej.hechos), ej)
}

/**
 * RETENCIÓN: la fila practicada y, con su número REAL, la constancia de la app. Si Monday le dio al
 * certificado (o a la orden) otro número que el que dice el PDF, se regenera antes de subirla, y la
 * línea de la orden se corrige para que diga lo mismo.
 */
async function flujoRetencion(en: Entorno, ej: Ejecucion): Promise<void> {
  const unidades = planRetenciones(en)
  if (!unidades.length) return
  await ejecutar(unidades, ej)
  const primera = unidades.find((u) => ej.hechos[u.clave])
  if (!primera) return
  const hecho = ej.hechos[primera.clave]
  const lineaId = primera.clave.slice('retencion:'.length)
  const certificado = hecho.codigo || en.datos.constancia?.numero || ''

  if (certificado && en.datos.nroRetencion && certificado !== en.datos.nroRetencion) {
    await ejecutar(
      [
        {
          clave: `retencion:nro:${lineaId}`,
          descripcion: 'Número de la retención en la línea de la orden',
          escritura: {
            tipo: 'columnas',
            board: BOARDS.ordenesPagoSub,
            itemId: lineaId,
            columnas: { [COL.ordenPagoSub.nroRetencion]: certificado },
          },
        },
      ],
      ej,
    )
  }

  const constancia = en.datos.constancia
  const clave = `archivo:${primera.clave}`
  if (!constancia || ej.hechos[clave]) return
  try {
    const nroOrden = en.nro || constancia.nroOrden
    const pdf =
      certificado !== constancia.numero || nroOrden !== constancia.nroOrden
        ? await constancia.regenerar(certificado, nroOrden)
        : constancia.pdf
    await subirA(ej.cx, hecho.id, COL.retencion.pdf, pdf)
    ej.hechos[clave] = { id: hecho.id }
    ej.alAvanzar(ej.hechos)
  } catch (e) {
    ej.fallas.push(`Constancia de retención: ${e instanceof Error ? e.message : 'no se pudo subir'}`)
  }
}

/**
 * Registra el pago en todos los tableros que impacta. Lanza `ErrorRegistroPago` con lo que no
 * entró; lo que sí entró queda anotado en `avance.hechos` (y se avisa por `alAvanzar`) para que el
 * reintento no lo repita.
 */
export async function registrarPago(
  datos: DatosRegistroPago,
  avance: Pick<AvanceRegistroPago, 'hechos'>,
  alAvanzar: (hechos: Record<string, Hecho>) => void = () => {},
  conexion?: ConexionRegistro,
): Promise<void> {
  if (!conexion && !mondayHabilitado()) return
  const cx = conexion ?? conexionReal()

  const ctx = await leerContexto(datos, cx)
  const facturas = datos.lineas.flatMap((l) => (l.clase === 'factura' ? [l.factura] : []))
  const en: Entorno = {
    datos,
    ctx,
    hechos: avance.hechos,
    nro: ctx.nroOrden,
    hoy: { date: hoyIso() },
    fechaPago: fecha(datos.fechaPago) ?? { date: hoyIso() },
    facturaIds: [...new Set(facturas.map((f) => f.id))],
    comprobanteIds: [...new Set(facturas.flatMap((f) => ctx.comprobantes[f.id] ?? []))],
    facturasTexto: [...new Set(facturas.map((f) => f.nro).filter(Boolean))].join(', '),
  }
  const ej: Ejecucion = { hechos: { ...avance.hechos }, fallas: [], alAvanzar, cx }

  const cajas = planCajas(en)
  const cheques = planCheques(en)
  ej.fallas.push(...cajas.fallas, ...cheques.fallas)

  /* Todos los tableros a la vez: ninguno depende de otro. */
  await Promise.all([
    flujoCuentaProveedor(en, ej),
    flujoCuentaOrigen(en, ej),
    ...[...cajas.porCaja].map(([cajaId, unidades]) =>
      ejecutar(
        /* Un EGRESO baja el saldo: el delta de cada movimiento es su egreso, con signo negativo. */
        encadenar(unidades, ej.hechos, ctx.saldoCaja[cajaId] ?? 0, COL_REGISTRO.cajaSub.saldoInicial, (u) =>
          -importeDe(u, COL_REGISTRO.cajaSub.egresos),
        ),
        ej,
      ),
    ),
    flujoCheques(ej, cheques),
    flujoRetencion(en, ej),
    ejecutar(planFacturas(en), ej),
  ])

  avance.hechos = ej.hechos
  if (ej.fallas.length) throw new ErrorRegistroPago(ej.fallas)
}
