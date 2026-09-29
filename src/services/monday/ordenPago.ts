/**
 * Registro de la ORDEN DE PAGO: lo ÚNICO que el módulo de Pagos escribe en Monday, y lo hace
 * "Registrar Pago" DESPUÉS de que la app emitió el PDF (ver `features/documentos`). El envío al
 * proveedor ya no pasa por el tablero: lo despacha el escenario de Make con el PDF de la app.
 *
 * Es el espejo de `./recibos` del otro lado del mostrador, y repite su forma porque el trabajo es el
 * mismo:
 *
 *   1) CABECERA — `create_item` en "⬅️ Pagos - PENDIENTES" (18421035536) con el vendedor, el
 *      proveedor y los tres totales (cancelado, entregado y su diferencia). Su `id` es el
 *      `parent_item_id` de todo lo que sigue.
 *   2) SUBELEMENTOS — TODOS en una sola mutación: primero las FACTURAS DE COMPRA que la orden
 *      cancela y después las CAJAS con las que se pagó. El spec de GraphQL obliga a ejecutar los
 *      campos raíz de una `mutation` en serie y en el orden escrito, así que el orden del lote se
 *      cumple por definición del lenguaje.
 *   3) PDF — el que generó la app, a "🤖OP PDF", con "🤖Estado de Emision y Envio" en "Emitido".
 *   4) REGISTRO — "🤖Estado Registro de Pago" → "Registrar" (ver `pedirRegistroOP`).
 *
 * Sin token (modo local) no se escribe nada y se devuelven ids simulados, igual que el resto de la
 * capa de servicio: el prototipo se puede recorrer entero sin cuenta de Monday.
 */
import { aIso } from '@/lib/dates'
import { round2 } from '@/lib/format'
import {
  esAnticipoDePago,
  esCajaCheque,
  esCajaTransferencia,
  esRetencionGAN,
  vencimientoDeCajaCheque,
} from '@/lib/pagosProveedor'
import type { MovimientoCaja } from '@/types'
import {
  BANCO_EMISOR_LABEL,
  BOARDS,
  CAJA_PAGO_ANTICIPO_INDEX,
  CAJA_PAGO_FACT_INDEX,
  cajaDePago,
  CHEQUE_ORIGEN_LABEL,
  COL,
  OP_EMISION_INDEX,
  personCol,
  TIPO_PAGO_INDEX,
} from './columns'
import { escribirColumnas, getProximoNroDocumento, leerNroDocumento, subirArchivoAColumna } from './documentos'
import { pedirRegistro, REGISTRO_PAGOS } from './registro'
import { getProximoNroRetencion } from './retencionGanancias'
import { mondayApi, mondayHabilitado } from './sdk'

/** Tope de subelementos por mutación. Mismo criterio que el recibo: es un seguro por complejidad. */
const SUBITEMS_POR_TANDA = 25

/* ===== Helpers de valores de columna ===== */

/** Relación a un ítem de otro board, o `null` si el id no sirve (para poder OMITIR la columna). */
const relacion = (id: string | null | undefined): { item_ids: number[] } | null => {
  const n = Number(id)
  return Number.isFinite(n) && n > 0 ? { item_ids: [n] } : null
}

/** Fecha dd/MM/yyyy → el `{ date: 'yyyy-MM-dd' }` que piden las columnas date, o null si no hay. */
const fechaCol = (valor: string | undefined): { date: string } | null => {
  const iso = aIso(valor ?? '')
  return iso ? { date: iso } : null
}

/** Valor de una columna dropdown de una sola etiqueta, o `null` para poder OMITIR la columna. */
const dropdown = (label: string | null | undefined): { labels: string[] } | null =>
  label?.trim() ? { labels: [label.trim()] } : null

/**
 * Banco emisor tal como lo nombra el TABLERO. Es el MISMO mapa que usa el recibo
 * (`BANCO_EMISOR_LABEL`): el catálogo de la app dice "Banco HSBC" y los dos tableros dicen "HSBC",
 * así que sin traducir se daría de alta una etiqueta nueva al lado de la que ya existe —la mutación
 * crea las que faltan—.
 *
 * Un cheque de CARTERA ya viene con el vocabulario del tablero y pasa de largo; uno NUEVO viene del
 * selector de la app y sí se traduce.
 */
const bancoDelTablero = (banco: string | undefined): string | null => {
  const nombre = banco?.trim()
  if (!nombre) return null
  return BANCO_EMISOR_LABEL[nombre] ?? nombre
}

/**
 * Columnas del subelemento de una FACTURA DE COMPRA cancelada por esta orden.
 *
 * Es el espejo de `columnasFactura` del recibo: la caja rotula la línea como parte de lo CANCELADO
 * —no de lo entregado, que vive en el otro tipo de subítem— y va por ÍNDICE, igual que allá. Sin la
 * etiqueta la fila quedaría sin caja en el tablero, indistinguible de una carga a medio hacer.
 *
 * Se exporta para poder verificar el payload contra el esquema del tablero sin salir a la red.
 */
export function columnasFacturaCompra(facturaId: string, importe: number): Record<string, unknown> {
  const columnas: Record<string, unknown> = {
    [COL.ordenPagoSub.caja]: { index: CAJA_PAGO_FACT_INDEX },
    [COL.ordenPagoSub.importeCancelado]: round2(importe),
  }
  const factura = relacion(facturaId)
  if (factura) columnas[COL.ordenPagoSub.factura] = factura
  return columnas
}

/**
 * Columnas del subelemento del ANTICIPO: la línea que declara cuánto se entregó de más y queda a
 * favor nuestro con el proveedor.
 *
 * Ocupa el lugar que ocupan los subítems de factura —dice QUÉ cancela la orden, no CON QUÉ se
 * paga—, y por eso reusa su misma columna de importe ("🤖Importe Cancelado $") y NO la de entregado.
 * Lo que lo distingue es la caja, escrita por ÍNDICE.
 *
 * El detalle y el vencimiento sólo los lleva el anticipo declarado como OPERACIÓN: son datos que el
 * usuario carga en esa etapa. Cuando la línea es el SOBRANTE de un pago contra facturas no hay nada
 * que declarar, así que las dos columnas se omiten en vez de escribirse en blanco.
 */
export function columnasAnticipoPago(
  importe: number,
  vencimiento?: string,
  detalle?: string,
): Record<string, unknown> {
  const columnas: Record<string, unknown> = {
    [COL.ordenPagoSub.caja]: { index: CAJA_PAGO_ANTICIPO_INDEX },
    [COL.ordenPagoSub.importeCancelado]: round2(importe),
  }
  /* "🤖Fecha Venc" es la MISMA columna que usa el vencimiento del cheque; acá es el del anticipo.
     Nunca conviven en un mismo subítem, con el mismo criterio que en el recibo. Sólo la lleva el
     anticipo declarado como OPERACIÓN —el sobrante de un pago contra facturas no tiene fecha—. */
  const vence = fechaCol(vencimiento)
  if (vence) columnas[COL.ordenPagoSub.vencimiento] = vence
  /* El detalle que escribió el usuario, tal cual. Es el MISMO texto que la card muestra en la línea
     y que el nombre del subelemento lleva después del "Anticipo ·", pero acá va sin ese prefijo: la
     columna es el dato, no cómo se lo titula. */
  const texto = detalle?.trim()
  if (texto) columnas[COL.ordenPagoSub.detalleAnticipo] = texto
  return columnas
}

/**
 * Columnas del subelemento de un ANTICIPO APLICADO: cuánto de ese saldo se usa. Es la línea de lo
 * ENTREGADO en una aplicación —el lugar que en un pago ocupan las cajas—, porque acá el dinero no
 * sale en el acto: ya estaba entregado y lo que se hace es imputarlo.
 *
 * Se rotula con la caja "Anticipo" y usa la columna de lo ENTREGADO, a diferencia de la línea del
 * anticipo declarado como operación —que usa la de lo cancelado—. Son dos cosas distintas con el
 * mismo rótulo: una declara plata que se entrega, la otra plata que ya se había entregado.
 *
 * El VÍNCULO al anticipo NO se escribe acá: el board de subelementos de la orden no tiene una
 * columna de relación hacia el de anticipos de proveedores (a diferencia del recibo, que sí la
 * tiene). Se escribe desde el otro lado, con `vincularAnticipoAplicado`.
 */
export function columnasAnticipoAplicado(importe: number): Record<string, unknown> {
  return {
    [COL.ordenPagoSub.caja]: { index: CAJA_PAGO_ANTICIPO_INDEX },
    [COL.ordenPagoSub.importeEntregado]: round2(importe),
  }
}

/**
 * Cómo se describe el anticipo EN PANTALLA: "Anticipo · <detalle>".
 *
 * Ya NO nombra la línea del tablero —ahí dice "Anticipo" a secas, como la del recibo—: el detalle
 * tiene su propia columna desde que el board sumó "🤖Detalle Anticipo" (`text_mm6naqq7`), que es
 * donde se lo busca y donde se lo puede filtrar. Lo que queda acá es el renglón de la card, donde
 * el detalle sí aporta: es la única línea del documento y hay lugar para decir por qué se entregó
 * la plata.
 */
export const nombreAnticipoPago = (detalle?: string): string => {
  const texto = detalle?.trim()
  return texto ? `Anticipo · ${texto}` : 'Anticipo'
}

/**
 * Columnas del subelemento de una CAJA. Es el espejo de `columnasPago` del recibo, con las cajas
 * de este circuito:
 *
 *   · Cheque/Echeq        → número, CUIT del emisor, sus dos fechas, origen, banco y —si sale de
 *                           cartera— la relación al cheque que se endosa.
 *   · Transferencia       → la cuenta PROPIA desde la que sale el dinero.
 *   · Efectivo y TARJETAS → NADA: se quedan con la caja y el importe. El formulario de pagos no
 *                           pide más que eso (no hay lectura de comprobantes en este circuito), así
 *                           que las columnas de tarjeta del tablero —titular, tipo y cupón— quedan
 *                           sin escribir en vez de llenarse con algo que nadie declaró.
 *
 * La caja va por ÍNDICE —es su identidad en el board, así que un cambio de rótulo no puede desviar
 * el pago a otra caja— y cada campo se escribe sólo si tiene valor: vacío se OMITE en lugar de
 * mandarse en blanco, con el mismo criterio que el recibo.
 *
 * Se exporta para poder verificar el payload contra el esquema del tablero sin salir a la red.
 */
export function columnasCaja(m: MovimientoCaja, nroRetencion?: string | null): Record<string, unknown> {
  const columnas: Record<string, unknown> = {
    /* Siempre por ÍNDICE: es la identidad de la opción en el board. El FORMATO viaja con la caja
       porque el tablero parte el cheque en dos etiquetas —"Cheque" y "Echeq"— donde la app tiene una
       sola: para nosotros el formato es un dato del cheque, no otra forma de pagar. */
    [COL.ordenPagoSub.caja]: cajaDePago(m.formaPago, m.formatoCheque),
    [COL.ordenPagoSub.importeEntregado]: round2(m.importe),
  }

  if (esCajaCheque(m.formaPago)) {
    const nro = m.numeroCheque?.trim()
    if (nro) columnas[COL.ordenPagoSub.nroComprobante] = nro
    const emision = fechaCol(m.fechaEmisionCheque)
    if (emision) columnas[COL.ordenPagoSub.fechaEmision] = emision
    /* Las dos fechas del cheque van a DOS columnas distintas: la de PAGO tal como se cargó y el
       VENCIMIENTO derivado de ella (+30 días). Un cheque de cartera no declara fecha de pago —viene
       del tablero con su vencimiento ya puesto—, así que ahí la primera se omite y la segunda lleva
       la del ítem. Las dos ramas viven en `vencimientoDeCajaCheque`. */
    const pago = fechaCol(m.fechaPagoCheque)
    if (pago) columnas[COL.ordenPagoSub.fechaPago] = pago
    const venc = fechaCol(vencimientoDeCajaCheque(m))
    if (venc) columnas[COL.ordenPagoSub.vencimiento] = venc
    /* De qué banco sale el cheque, y son DOS columnas distintas según de dónde venga:
         · CARTERA · lo libró un TERCERO contra su propio banco. Ese nombre es texto y va al
           dropdown "🤖Banco Emisor".
         · NUEVO   · lo libramos NOSOTROS contra una cuenta de La Batea, elegida del tablero de
           configuración. Eso es una RELACIÓN, no un nombre suelto, y va a la columna que apunta a
           ese tablero —la misma que usa la transferencia para su banco de origen: en los dos casos
           lo que se declara es la cuenta propia involucrada—. */
    const cuentaPropia = relacion(m.bancoEmisorId)
    if (cuentaPropia) {
      columnas[COL.ordenPagoSub.bancoOrigen] = cuentaPropia
    } else {
      const banco = dropdown(bancoDelTablero(m.bancoEmisor))
      if (banco) columnas[COL.ordenPagoSub.bancoEmisor] = banco
    }
    /* Papel o electrónico. Comparte el mapa del recibo porque los dos tableros usan las MISMAS dos
       etiquetas ("Cheque" y "eCheq"). Sin formato definido —un cheque nuevo, que el formulario
       todavía no lo pregunta— la columna se omite en vez de inventar uno. */
    const origen = dropdown(m.formatoCheque ? CHEQUE_ORIGEN_LABEL[m.formatoCheque] : null)
    if (origen) columnas[COL.ordenPagoSub.origenCheque] = origen
    const cuit = m.cuitEmisor?.trim()
    if (cuit) columnas[COL.ordenPagoSub.cuitEmisor] = cuit
    /* El cheque de CARTERA se linkea a su ítem: es el mismo papel, y dejarlo suelto obligaría a
       reconciliarlo por número. El cheque NUEVO todavía no existe en ningún tablero. */
    const cheque = m.modalidadCheque === 'cartera' ? relacion(m.chequeId) : null
    if (cheque) columnas[COL.ordenPagoSub.chequeUtilizado] = cheque
    /* Y por eso mismo hay que CREARLO: el cheque nuevo lo libramos nosotros y no existe en ningún
       lado, así que la línea se lo pide al tablero. El de cartera ya existe —se endosa—, y ahí la
       casilla se OMITE en vez de mandarse en falso, con el mismo criterio que el resto del payload:
       lo que no se declara no se escribe. */
    if (m.modalidadCheque === 'nuevo') {
      columnas[COL.ordenPagoSub.crearCheque] = { checked: 'true' }
      /* Con qué fecha nace. Es la MISMA que ya viaja como fecha del comprobante, escrita también en
         la columna que alimenta el alta: si falta —el formulario la pide, pero la columna se omite
         cuando no hay valor— se omite acá igual, con el mismo criterio. */
      if (emision) columnas[COL.ordenPagoSub.emisionChequeNuevo] = emision
    }
    return columnas
  }

  if (esCajaTransferencia(m.formaPago)) {
    const origen = relacion(m.bancoOrigenId)
    if (origen) columnas[COL.ordenPagoSub.bancoOrigen] = origen
    /* El número de la operación bancaria va a la MISMA columna que el número del cheque: es el
       "Nro Comprobante" de la línea, y las dos cajas nunca conviven en un mismo subelemento. */
    const nro = m.nroComprobanteTransferencia?.trim()
    if (nro) columnas[COL.ordenPagoSub.nroComprobante] = nro
    return columnas
  }

  /* RETENCIÓN · su importe no se explica solo. Se escriben los dos datos que permiten reconstruir
     el cálculo desde el tablero: la BASE sobre la que se aplicó la alícuota, y la FILA de
     configuración de la que salieron los parámetros —así una retención ya practicada sigue
     apuntando a los valores con los que se hizo, aunque después los cambien—. */
  if (esRetencionGAN(m.formaPago)) {
    if (Number.isFinite(m.baseImponible)) {
      columnas[COL.ordenPagoSub.baseImponible] = round2(m.baseImponible as number)
    }
    const config = relacion(m.configRetencionId)
    if (config) columnas[COL.ordenPagoSub.configRetencion] = config
    /* Con qué número va a nacer la retención en "🔃Retenciones". Se omite si no se pudo averiguar:
       ver `getProximoNroRetencion`. */
    const nro = nroRetencion?.trim()
    if (nro) columnas[COL.ordenPagoSub.nroRetencion] = nro
  }
  return columnas
}

/**
 * Columnas de la CABECERA de la orden: a quién se le paga, quién pagó y los tres totales.
 *
 * Es el espejo de la cabecera del recibo, con dos ausencias que son propias de este tablero y no
 * olvidos:
 *
 *   · NO hay "tipo de operación". El recibo escribe "🤖Tipo de Cobro" porque el mismo board recibe
 *     cobros, anticipos y aplicaciones; el de pagos recibe una sola cosa, así que no hay nada que
 *     ramificar.
 *   · NO hay saldo de cuenta corriente proyectado. El recibo declara cómo queda la cuenta del
 *     cliente con el cobro aplicado; este tablero no tiene esa columna.
 *
 * Los tres totales se calculan sobre las MISMAS listas con las que se arman los subelementos, así
 * que el importe que declara la cabecera es —por construcción— la suma exacta de lo que cuelga de
 * ella. La diferencia se deriva por el mismo motivo: es cancelado − entregado, no un tercer dato
 * que alguien pueda mandar desalineado. En una orden que cierra vale CERO EXACTO, así que cualquier
 * otra cosa en esa columna es, en sí misma, una alarma.
 *
 * El "🤖Estado Registro de Pago" NO se escribe acá, igual que el recibo no escribe el suyo al crear
 * la cabecera: pedir el registro es un acto aparte y posterior (ver `pedirRegistroOP`), porque
 * dispara la automatización que impacta la cuenta corriente. Ponerlo en el `create_item` la
 * largaría sobre un ítem que todavía no tiene un solo subelemento colgado.
 *
 * Se exporta para poder verificar el payload contra el esquema del tablero sin salir a la red.
 */
export function columnasOrdenPago(datos: DatosOrdenPago): Record<string, unknown> {
  /* El sobrante SUMA al total cancelado: no queda flotando como diferencia, porque la orden lo
     aplica —a las facturas lo que les toca, y el resto al anticipo con el proveedor—. Así la
     DIFERENCIA cierra en cero, que es la única forma en que la etapa 3 deja llegar hasta acá. */
  const esAnticipo = datos.tipo === 'anticipo'
  const esAplicacion = datos.tipo === 'aplicacion'
  const aplicados = esAplicacion ? (datos.anticiposAplicados ?? []) : []
  const anticipos = datos.movimientos.filter((m) => esAnticipoDePago(m.formaPago))
  const entregadas = datos.movimientos.filter((m) => !esAnticipoDePago(m.formaPago))
  /* En un ANTICIPO lo cancelado ES el importe declarado: no hay facturas de las que derivarlo. En
     un pago contra facturas es lo imputado más el sobrante que quedó a favor nuestro, y en una
     aplicación es sólo lo imputado. */
  const totalCancelado = esAnticipo
    ? round2(datos.anticipo ?? 0)
    : round2(
        datos.facturas.reduce((acc, f) => acc + f.importe, 0) +
          anticipos.reduce((acc, m) => acc + m.importe, 0),
      )
  /* Lo ENTREGADO sale de donde salió el dinero: de las cajas en un pago o un anticipo, y de los
     anticipos imputados en una aplicación —ahí no salió plata nueva, se usa la que ya estaba—. */
  const totalEntregado = esAplicacion
    ? round2(aplicados.reduce((acc, a) => acc + a.importe, 0))
    : round2(entregadas.reduce((acc, m) => acc + m.importe, 0))
  const columnas: Record<string, unknown> = {
    /* Qué clase de pago es, por ÍNDICE y no por etiqueta: el índice es la identidad de la opción en
       el board, así que ni un cambio de rótulo ni un `create_labels_if_missing` pueden desviar la
       orden a un tipo nuevo. Ver `TIPO_PAGO_INDEX`. */
    [COL.ordenPago.tipoPago]: {
      index: esAnticipo
        ? TIPO_PAGO_INDEX.anticipado
        : esAplicacion
          ? TIPO_PAGO_INDEX.aplicacionCtaCte
          : TIPO_PAGO_INDEX.posterior,
    },
    [COL.ordenPago.totalCancelado]: totalCancelado,
    [COL.ordenPago.totalEntregado]: totalEntregado,
    [COL.ordenPago.diferencia]: round2(totalCancelado - totalEntregado),
  }
  const proveedor = relacion(datos.proveedorId)
  if (proveedor) columnas[COL.ordenPago.proveedor] = proveedor
  const vendedor = personCol(datos.vendedorId)
  if (vendedor) columnas[COL.ordenPago.vendedor] = vendedor
  return columnas
}

/* ===== La orquestación ===== */

/** Una factura de compra imputada: qué ítem se cancela, cómo se lo nombra y por cuánto. */
export interface FacturaCompraACancelar {
  /** Id del ítem en "❓ Facturas Compra Pend de Pago". Va a la relación del subelemento. */
  id: string
  /** Cómo se nombra la línea en el tablero. */
  nro: string
  /** Importe que esta orden le cancela. */
  importe: number
}

export interface DatosOrdenPago {
  /** Proveedor al que se le paga: va a la relación "🤖Proveedor" de la cabecera. */
  proveedorId: string
  /** Nombre del proveedor: es el nombre del ítem hasta que lo renombra la customKey del board. */
  nombreProveedor: string
  /** Vendedor pagador (usuario de Monday), para la columna people "🤖Vendedor". */
  vendedorId?: string | null
  /** Facturas de compra imputadas: un subelemento cada una. */
  facturas: FacturaCompraACancelar[]
  /** Cajas cargadas en la etapa 3: un subelemento cada una. */
  movimientos: readonly MovimientoCaja[]
  /**
   * Qué orden se está emitiendo. Es lo que ramifica la escritura, igual que `TipoRecibo` del lado
   * del recibo:
   *
   *   · facturas   · una línea por factura de compra cancelada, más el anticipo si sobró plata.
   *   · anticipo   · no hay facturas: en su lugar va UNA sola línea, la del importe entregado a
   *                  cuenta.
   *   · aplicacion · facturas canceladas PRIMERO y anticipos aplicados DESPUÉS. Sin cajas: el
   *                  dinero ya había salido, esto sólo lo imputa.
   *
   * Ausente = facturas, que es el recorrido completo.
   */
  tipo?: 'facturas' | 'anticipo' | 'aplicacion'
  /** Sólo ANTICIPO: importe entregado a cuenta. Es lo que declara la línea "Anticipo" de la orden. */
  anticipo?: number
  /** Sólo ANTICIPO: el motivo que escribió el usuario. Va al NOMBRE de esa misma línea. */
  detalleAnticipo?: string
  /** Sólo ANTICIPO: vencimiento en dd/MM/yyyy. Va al "🤖Fecha Venc" de esa misma línea. */
  vencimientoAnticipo?: string
  /** Sólo APLICACIÓN: los anticipos que se imputan contra las facturas de `facturas`. */
  anticiposAplicados?: readonly AnticipoAAplicarPago[]
  /**
   * El número de certificado con el que salió la CONSTANCIA de retención emitida junto con la orden
   * ("RETENC-006"). Va a la línea de la retención ("🤖Nro Retencion"), así la línea y el PDF dicen lo
   * mismo. Ausente = se predice al crear la orden (ver `getProximoNroRetencion`).
   */
  nroRetencion?: string | null
}

/** Un anticipo que se aplica: qué ítem se usa, con qué nombre se lo muestra y por cuánto. */
export interface AnticipoAAplicarPago {
  /** Id del ítem en el board de anticipos de proveedores (18428353259). */
  id: string
  /** Cómo se lo nombra en el subelemento. Sin dato, la línea se llama sólo "Anticipo". */
  nro?: string
  /** Importe de ese anticipo que se imputa en esta aplicación. */
  importe: number
}

export interface ResultadoOrdenPago {
  /** Id del ítem creado en "⬅️ Pagos - PENDIENTES". */
  id: string
  facturasCreadas: number
  facturasEsperadas: number
  pagosCreados: number
  pagosEsperados: number
}

/** La orden quedó completa: entraron TODOS sus subelementos, de los dos tipos. */
export const ordenPagoCompleta = (r: ResultadoOrdenPago): boolean =>
  r.facturasCreadas === r.facturasEsperadas && r.pagosCreados === r.pagosEsperados

/**
 * Crea la orden de pago: la cabecera y, con su id, todos sus subelementos.
 *
 * Devuelve cuántos subítems entraron de cada tipo. Un faltante NO se convierte en excepción: la
 * orden ya existe en el tablero y hay que poder decirlo con precisión —"entraron 3 de 4 facturas"—
 * en vez de dejar al usuario con un error genérico y una orden a medias que no sabe que se creó.
 */
export async function crearOrdenDePago(datos: DatosOrdenPago): Promise<ResultadoOrdenPago> {
  const { nombreProveedor, facturas, movimientos } = datos
  /* Las cajas se parten en DOS: lo que salió de caja y los ANTICIPOS. El anticipo lo carga el
     usuario como una caja más cuando lo entregado supera lo que se cancela —un cheque no se puede
     partir—, pero no es plata que sale: es el sobrante que queda a favor nuestro. Por eso cuenta
     del lado de lo CANCELADO, igual que en `resumenPago`. */
  /* Un ANTICIPO no cancela facturas: en el lugar de sus subítems va UNA sola línea, la del importe
     entregado a cuenta. Ese "1" es lo que se espera crear, igual que en un pago contra facturas se
     espera una línea por factura imputada. Es la misma ramificación que hace `emitirRecibo`. */
  const esAnticipo = datos.tipo === 'anticipo'
  /* Una APLICACIÓN tampoco entrega plata: lo que ocupa el lugar de las cajas son los anticipos que
     ya estaban entregados y ahora se imputan. */
  const esAplicacion = datos.tipo === 'aplicacion'
  const aplicados = esAplicacion ? (datos.anticiposAplicados ?? []) : []
  const anticipos = movimientos.filter((m) => esAnticipoDePago(m.formaPago))
  const entregadas = esAplicacion ? [] : movimientos.filter((m) => !esAnticipoDePago(m.formaPago))
  /* Lo CANCELADO: la línea del anticipo, o una por factura más una por sobrante cargado. */
  const facturasEsperadas = esAnticipo ? 1 : facturas.length + anticipos.length
  // Lo ENTREGADO: los anticipos imputados en una aplicación, las cajas en el resto.
  const pagosEsperados = esAplicacion ? aplicados.length : entregadas.length

  if (!mondayHabilitado()) {
    return {
      id: `mock-op-${Date.now()}`,
      facturasCreadas: facturasEsperadas,
      facturasEsperadas,
      pagosCreados: pagosEsperados,
      pagosEsperados,
    }
  }

  /* El número con el que va a nacer la retención, leído UNA vez y sólo si la orden lleva una. Es
     best-effort: si la consulta falla, la línea se escribe sin el número —que es lo mismo que pasa
     cuando el tablero no tiene de dónde sacarlo— en lugar de tumbar una orden que por lo demás está
     completa. */
  /* Si la orden se emitió con su constancia, el número ya viene decidido (`datos.nroRetencion`): es
     el que dice el PDF, y la línea tiene que decir lo mismo. */
  const nroRetencion = !entregadas.some((m) => esRetencionGAN(m.formaPago))
    ? null
    : datos.nroRetencion !== undefined
      ? datos.nroRetencion
      : await getProximoNroRetencion().catch(() => null)

  const cabecera = columnasOrdenPago(datos)

  const creado = await mondayApi<{ create_item: { id: string } }>(
    `mutation ($boardId: ID!, $name: String!, $cv: JSON!) {
      create_item(board_id: $boardId, item_name: $name, column_values: $cv) { id }
    }`,
    { boardId: BOARDS.ordenesPago, name: nombreProveedor, cv: JSON.stringify(cabecera) },
  )
  const itemId = creado.create_item.id

  /* Primero lo que la orden CANCELA y después con qué se lo cubrió. Es el orden en que se lee el
     documento, y el mismo que usan el anticipo y la aplicación del recibo. */
  const lineas: SubitemACrear[] = [
    ...(esAnticipo
      ? [
          {
            alias: 'a0',
            /* "Anticipo", a secas. El DETALLE ya no vive en el nombre: desde que el board tiene su
               "🤖Detalle Anticipo" (`text_mm6naqq7`) el dato está en su columna, que es donde se lo
               busca y donde se lo puede filtrar. Meterlo además en el nombre daba una línea distinta
               por operación para algo que siempre es lo mismo. */
            nombre: 'Anticipo',
            columnas: columnasAnticipoPago(
              round2(datos.anticipo ?? 0),
              datos.vencimientoAnticipo,
              datos.detalleAnticipo,
            ),
          },
        ]
      : [
          ...facturas.map((f, i) => ({
            alias: `f${i}`,
            /* "Factura N° 0002-00003314": el ordinal va en el nombre del subelemento porque es
               como se lee la línea en el tablero, donde no hay una columna que lo aclare. */
            nombre: `Factura N° ${f.nro}`,
            columnas: columnasFacturaCompra(f.id, f.importe),
          })),
          /* El ANTICIPO por SOBRANTE, después de las facturas canceladas y antes de las cajas: es
             lo último que la orden aplica, con lo que quedó cuando las facturas ya se cubrieron. Es
             la misma posición relativa que tiene en el recibo. */
          ...anticipos.map((m, i) => ({
            alias: `x${i}`,
            nombre: 'Anticipo',
            columnas: columnasAnticipoPago(m.importe),
          })),
        ]),
    /* Lo ENTREGADO. En una aplicación son los anticipos que se imputan; en el resto, las cajas. */
    ...(esAplicacion
      ? aplicados.map((a, i) => ({
          alias: `an${i}`,
          /* También "Anticipo" a secas. CUÁL se aplicó no se pierde: la relación al ítem del
             anticipo se escribe desde el lado del anticipo (ver `vincularAnticiposAplicados`), que
             es el único lado que tiene esa columna. El nombre no es la trazabilidad. */
          nombre: 'Anticipo',
          columnas: columnasAnticipoAplicado(a.importe),
        }))
      : entregadas.map((m, i) => ({
          alias: `p${i}`,
          nombre: m.formaPago,
          columnas: columnasCaja(m, nroRetencion),
        }))),
  ]

  const ids = await crearSubitems(itemId, lineas)
  const creados = ids.map((id) => id !== '')

  /* El vínculo de cada anticipo aplicado con SU línea, escrito desde el lado del anticipo: es el
     único lado que tiene la columna (ver `COL.anticipoProveedor.subOrdenPago`). Va después de crear
     los subelementos porque necesita sus ids.

     Es BEST-EFFORT y no puede tumbar la orden, que ya quedó escrita con todos sus datos: mismo
     criterio que los comprobantes adjuntos del recibo. Lo que se pierde si falla es la trazabilidad
     desde el anticipo, no la imputación. */
  if (esAplicacion && aplicados.length > 0) {
    await vincularAnticiposAplicados(aplicados, ids.slice(facturasEsperadas))
  }
  return {
    id: itemId,
    facturasCreadas: creados.slice(0, facturasEsperadas).filter(Boolean).length,
    facturasEsperadas,
    pagosCreados: creados.slice(facturasEsperadas).filter(Boolean).length,
    pagosEsperados,
  }
}

/**
 * Pide el REGISTRO de la orden: pone "🤖Estado Registro de Pago" en "Registrar".
 *
 * Es un acto APARTE de la creación y posterior a ella —el mismo criterio que `pedirRegistro` en el
 * recibo—: dispara la automatización que impacta la cuenta corriente del proveedor y marca las
 * facturas como pagadas, así que no puede largarse sobre un ítem sin subelementos.
 *
 * OJO con el índice: acá "Registrar" es el 3 y en el recibo es el 4. Son dos columnas distintas de
 * dos tableros distintos, y por eso cada una tiene su propio mapa (ver `OP_REGISTRO_INDEX`).
 */
export async function pedirRegistroOP(itemId: string): Promise<void> {
  /* El pedido es UNO solo para los dos tableros —cambian el board, la columna y el índice, no el
     acto—, así que vive en `./registro` junto con la espera que lo sigue. Esta función queda como
     el nombre con el que el módulo de Pagos lo pide, sin repetir la mutación. */
  await pedirRegistro(itemId, REGISTRO_PAGOS)
}

/* ===== El número y el PDF de la orden ===== */

/** Número de la orden en modo local (sin Monday): el prototipo tiene que poder emitir un PDF igual. */
export const NRO_ORDEN_PAGO_MOCK = 'IDPAGO-001'

/**
 * El número con el que va a nacer la próxima orden ("🤖ID Orden de Pago": "IDPAGO-020" →
 * "IDPAGO-021"). Lo necesita el PDF, que se genera ANTES de crear el ítem. Es una predicción: ver
 * `getProximoNroDocumento`.
 */
export async function getProximoNroOP(): Promise<string | null> {
  if (!mondayHabilitado()) return NRO_ORDEN_PAGO_MOCK
  return getProximoNroDocumento(BOARDS.ordenesPago, COL.ordenPago.nro)
}

/** El "🤖ID Orden de Pago" que Monday le asignó a la orden ya creada. */
export const leerNroOP = (itemId: string): Promise<string> => leerNroDocumento(itemId, COL.ordenPago.nro)

/**
 * Sube el PDF que generó la app a "🤖OP PDF" y deja la orden EMITIDA: "🤖Estado de Emision y Envio"
 * en "Emitido" y su "🤖Fecha de Emision OP".
 *
 * NO se escribe "Emitir": ese era el disparador de la automatización que generaba el documento, y el
 * PDF ahora ya lo generó la app. Mismo criterio que `adjuntarPdfRecibo`.
 */
export async function adjuntarPdfOP(itemId: string, pdf: File, fechaEmision: string): Promise<void> {
  if (!mondayHabilitado()) return
  await subirArchivoAColumna(itemId, COL.ordenPago.pdf, pdf)
  const columnas: Record<string, unknown> = {
    [COL.ordenPago.estadoEmision]: { index: OP_EMISION_INDEX.emitido },
  }
  const iso = aIso(fechaEmision)
  if (iso) columnas[COL.ordenPago.fechaEmision] = { date: iso }
  await escribirColumnas(itemId, BOARDS.ordenesPago, columnas)
}

/* ===== La constancia de retención ===== */

const esperar = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms))

/**
 * El nombre de una fila de "🔃Retenciones" nombra ESA orden: el número entero, no como parte de otro
 * ("IDPAGO-01" también está adentro de "IDPAGO-010"). Se exporta para verificarlo sin red.
 */
export function nombraLaOrden(nombre: string, nroOrden: string): boolean {
  const nro = nroOrden.trim()
  if (!nro) return false
  let desde = 0
  for (;;) {
    const i = nombre.indexOf(nro, desde)
    if (i === -1) return false
    const antes = nombre[i - 1] ?? ' '
    const despues = nombre[i + nro.length] ?? ' '
    if (!/[\w-]/.test(antes) && !/[\w-]/.test(despues)) return true
    desde = i + 1
  }
}

/**
 * La fila de "🔃Retenciones" de una orden ya registrada: la crea la automatización de registro, y su
 * nombre lleva el número de la orden ("Retencion GAN - IDPAGO-010 - …"). La relación con la orden
 * viene vacía en el tablero (verificado), así que el nombre es el vínculo que hay.
 *
 * Se la busca unas veces: la automatización puede terminar de crearla un instante después de dejar
 * la orden en "Registrado". `null` = no apareció.
 */
export async function buscarRetencionDeOrden(
  nroOrden: string,
  { intentos = 5, intervalo = 2000 }: { intentos?: number; intervalo?: number } = {},
): Promise<{ id: string; nro: string } | null> {
  if (!mondayHabilitado() || !nroOrden.trim()) return null
  for (let i = 0; i < intentos; i++) {
    const data = await mondayApi<{ boards: { items_page: { items: { id: string; name: string; column_values: { id: string; text: string | null }[] }[] } }[] }>(
      `query ($nro: CompareValue!) {
        boards(ids: [${BOARDS.retenciones}]) {
          items_page(limit: 5, query_params: {
            rules: [{ column_id: "name", compare_value: $nro, operator: contains_text }],
            order_by: [{ column_id: "__creation_log__", direction: desc }]
          }) {
            items { id name column_values(ids: ["${COL.retencion.nro}"]) { id text } }
          }
        }
      }`,
      { nro: nroOrden.trim() },
    )
    /* `contains_text` es por inclusión: "IDPAGO-01" también está en "IDPAGO-010". Se exige el número
       entero, delimitado. */
    const fila = data.boards?.[0]?.items_page?.items?.find((it) => nombraLaOrden(it.name, nroOrden))
    if (fila) return { id: fila.id, nro: fila.column_values?.[0]?.text?.trim() ?? '' }
    if (i < intentos - 1) await esperar(intervalo)
  }
  return null
}

/**
 * Sube la CONSTANCIA de retención a su fila de "🔃Retenciones" ("🤖Retencion PDF"). Si la fila no
 * aparece, va a la columna del PDF de la ORDEN, para que el documento no se pierda.
 *
 * `regenerar`: si la fila nació con otro número que el del PDF —el certificado era una predicción—,
 * se regenera la constancia con el REAL antes de subirla. Devuelve dónde quedó.
 */
export async function adjuntarConstanciaRetencion({
  ordenId,
  nroOrden,
  constancia,
  regenerar,
}: {
  ordenId: string
  nroOrden: string
  constancia: { pdf: File; numero: string }
  regenerar: (certificado: string) => Promise<File>
}): Promise<'retencion' | 'orden'> {
  if (!mondayHabilitado()) return 'retencion'
  const fila = await buscarRetencionDeOrden(nroOrden)
  if (!fila) {
    console.warn(`No apareció la fila de "Retenciones" de ${nroOrden}: la constancia se guarda en la orden.`)
    await subirArchivoAColumna(ordenId, COL.ordenPago.pdf, constancia.pdf)
    return 'orden'
  }
  const pdf = fila.nro && fila.nro !== constancia.numero ? await regenerar(fila.nro) : constancia.pdf
  await subirArchivoAColumna(fila.id, COL.retencion.pdf, pdf)
  return 'retencion'
}

/**
 * Escribe en cada ANTICIPO con qué línea de qué orden se aplicó su saldo.
 *
 * Va contra el board de anticipos de proveedores y no contra el de subelementos porque la relación
 * existe de UN solo lado: el subítem de la orden no tiene una columna hacia los anticipos —a
 * diferencia del recibo, que sí la tiene—, así que ésta es la única forma de dejar asentado el
 * vínculo.
 *
 * Cada escritura es INDEPENDIENTE y best-effort: que falle la de un anticipo no puede tumbar a las
 * demás ni a la orden, que ya quedó creada. Los ids llegan emparejados por POSICIÓN con las líneas
 * que se acaban de crear.
 */
async function vincularAnticiposAplicados(
  aplicados: readonly AnticipoAAplicarPago[],
  subitemIds: readonly string[],
): Promise<void> {
  const escrituras = aplicados.flatMap((a, i) => {
    const linea = relacion(subitemIds[i])
    const anticipoId = Number(a.id)
    if (!linea || !Number.isFinite(anticipoId) || anticipoId <= 0) return []
    return [
      mondayApi(
        `mutation ($id: ID!, $board: ID!, $cv: JSON!) {
          change_multiple_column_values(item_id: $id, board_id: $board, column_values: $cv) { id }
        }`,
        {
          id: a.id,
          board: BOARDS.anticiposProveedor,
          cv: JSON.stringify({ [COL.anticipoProveedor.subOrdenPago]: linea }),
        },
      ),
    ]
  })
  // `allSettled`: se intentan todas y ninguna cancela a las otras.
  await Promise.allSettled(escrituras)
}

/** Un subelemento a crear: con qué alias se lo pide, cómo se llama y qué columnas lleva. */
interface SubitemACrear {
  alias: string
  nombre: string
  columnas: Record<string, unknown>
}

/**
 * Crea TODOS los subelementos de la orden en una sola mutación, un alias por línea. Monday no tiene
 * un `create_subitem` plural: los alias son la forma de escribir en lote.
 *
 * Devuelve el id de cada subelemento en el MISMO orden de entrada, con `''` en los que no entraron:
 * eso es lo que permite contar los creados.
 *
 * `create_labels_if_missing`: el banco emisor de un cheque se puede ampliar desde el formulario, así
 * que una etiqueta nueva tiene que poder nacer al escribir la línea. La CAJA no corre ese riesgo:
 * se escribe por índice.
 */
async function crearSubitems(itemId: string, lineas: SubitemACrear[]): Promise<string[]> {
  const ids: string[] = []
  for (let desde = 0; desde < lineas.length; desde += SUBITEMS_POR_TANDA) {
    const tanda = lineas.slice(desde, desde + SUBITEMS_POR_TANDA)
    const variables: Record<string, unknown> = { parentId: itemId }
    const campos = tanda.map((linea, i) => {
      const n = desde + i
      variables[`n${n}`] = linea.nombre
      variables[`c${n}`] = JSON.stringify(linea.columnas)
      return `${linea.alias}: create_subitem(parent_item_id: $parentId, item_name: $n${n}, column_values: $c${n}, create_labels_if_missing: true) { id }`
    })
    const declaraciones = tanda
      .map((_, i) => `$n${desde + i}: String!, $c${desde + i}: JSON!`)
      .join(', ')
    const data = await mondayApi<Record<string, { id: string } | null>>(
      `mutation ($parentId: ID!, ${declaraciones}) { ${campos.join('\n')} }`,
      variables,
    )
    // Cada línea se lee por SU alias, así el resultado conserva el orden de la entrada.
    tanda.forEach((linea) => ids.push(data[linea.alias]?.id ?? ''))
  }
  return ids
}
