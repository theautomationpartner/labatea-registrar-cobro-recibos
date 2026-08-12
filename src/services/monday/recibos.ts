/**
 * Emisión del recibo: lo ÚNICO que esta app escribe en Monday.
 *
 * Son DOS solicitudes, no más:
 *
 *   1) CABECERA — `create_item` en "➡️Recibos y Cobros" (18421035524) con el tipo de cobro, el
 *      vendedor, el cliente y los tres totales (cancelado, recibido y su diferencia). Su `id` es el
 *      `parent_item_id` de todo lo que sigue: sin él no hay dónde colgar nada.
 *   2) SUBELEMENTOS — TODOS en una sola mutación, en ESTE orden:
 *        1. lo que el recibo CANCELA: las facturas imputadas (alias `f0`, `f1`…) o, en un
 *           ANTICIPO, su única línea (`a0`);
 *        2. los MEDIOS con los que entró la plata: efectivo, transferencia, cheque y tarjetas
 *           (`p0`, `p1`…), en el orden en que se cargaron —entre ellos da igual—;
 *        3. las RETENCIONES, siempre después de los medios: no son caja, son impuesto ya
 *           ingresado;
 *        4. el ajuste por DIFERENCIA DE CAJA (`d0`), ÚLTIMO sin excepción y sólo si lo hubo: el
 *           descuadre se declara recién cuando ya está escrito todo lo que lo produjo.
 *
 *      La APLICACIÓN DE ANTICIPOS invierte los dos primeros bloques a propósito: primero los
 *      anticipos que se imputan (`an0`, `an1`…) y después las facturas que cancelan. No tiene ni
 *      retenciones ni ajuste: ahí no entra plata nueva.
 *
 * Los dos lotes van JUNTOS y en ESE orden. Que estén en un solo documento no los desordena: el
 * spec de GraphQL obliga a ejecutar los campos raíz de una `mutation` EN SERIE y en el orden en que
 * aparecen escritos (a diferencia de una query, donde pueden resolverse en paralelo). Así que las
 * facturas se crean antes que los pagos por definición del lenguaje, no por suerte de tiempos.
 *
 * Unificarlos es lo que reduce los modos de falla: una sola solicitud en vez de dos significa una
 * sola oportunidad de cortarse por red, y —sobre todo— desaparece el estado intermedio en el que la
 * primera entraba y la segunda no, que dejaba un recibo con sus facturas y sin sus pagos.
 *
 * Después de eso quedan los comprobantes adjuntos, que no son una mutación más: las columnas `file`
 * necesitan el id del subelemento ya creado y viajan por multipart.
 *
 * Si la escritura falla, la excepción se propaga y corta acá: un recibo al que le faltan líneas no
 * tiene que llegar a pedir su emisión (ver `marcarAEmitir`).
 *
 * Sin token (modo local) no se escribe nada y se devuelven ids simulados, igual que el resto de la
 * capa de servicio: el prototipo se puede recorrer entero sin cuenta de Monday.
 */
import { round2 } from '@/lib/format'
import { aIso } from '@/lib/dates'
import { cuitCompleto, esRetencion, esPagoConTarjeta } from '@/lib/pagos'
import type { MovimientoPago } from '@/types'
import {
  BANCO_EMISOR_LABEL,
  BOARDS,
  CAJA_ANTICIPO_INDEX,
  CAJA_DIF_INDEX,
  CAJA_FACT_CANCELADA_INDEX,
  CAJA_INDEX,
  CHEQUE_ORIGEN_LABEL,
  COL,
  ESTADO_EMISION_INDEX,
  personCol,
  TIPO_COBRO_INDEX,
} from './columns'
import { byId, type MondayItem } from './parse'
import { mondayApi, mondayHabilitado, mondaySubirArchivo } from './sdk'

/**
 * Subelementos por solicitud. Monday cobra complejidad por mutación, así que una tanda muy larga
 * puede rebotar entera; partirla acota el daño y mantiene el lote en pocas solicitudes.
 */
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

/** Dropdown por etiqueta. Las que no están en el board se crean (`create_labels_if_missing`). */
const dropdown = (label: string | null | undefined): { labels: string[] } | null =>
  label?.trim() ? { labels: [label.trim()] } : null

/**
 * Banco emisor tal como lo nombra el TABLERO. Los bancos fijos del selector se traducen; el que el
 * usuario haya agregado a mano viaja como lo escribió y su etiqueta se crea al vuelo.
 */
const bancoDelTablero = (banco: string | undefined): string | null => {
  const nombre = banco?.trim()
  if (!nombre) return null
  return BANCO_EMISOR_LABEL[nombre] ?? nombre
}

/**
 * Columna `file` donde va el comprobante de un movimiento, o `null` si ese medio no adjunta nada.
 * El EFECTIVO no adjunta: es la excepción que no agrega ninguna columna a las dos de base.
 *
 * Estas columnas NO se completan en el `create_subitem`: se llenan después, subiendo el binario.
 */
const columnaComprobante = (m: MovimientoPago): string | null => {
  if (m.formaPago === 'Transferencia') return COL.cobroSub.compTransferencia
  if (esPagoConTarjeta(m.formaPago)) return COL.cobroSub.cupon
  // Todas las retenciones (IVA, IIBB, GAN y las que se sumen) comparten la misma columna.
  if (esRetencion(m.formaPago)) return COL.cobroSub.compRetencion
  return null
}

/* ===== Columnas de cada tipo de subelemento ===== */

/**
 * Subelemento de una FACTURA CANCELADA: qué factura se cancela y por cuánto.
 *
 * La caja va en "Fact Cancelada", que es lo que rotula al subítem como una línea de lo CANCELADO y
 * no de lo cobrado: acá no hay medio de pago —eso vive en el otro tipo de subítem—, y sin la
 * etiqueta la fila quedaría sin caja en el tablero, indistinguible de una carga a medio hacer. Va
 * por ÍNDICE, igual que el resto de esta columna.
 */
function columnasFactura(facturaId: string, importe: number): Record<string, unknown> {
  const cv: Record<string, unknown> = {
    [COL.cobroSub.caja]: { index: CAJA_FACT_CANCELADA_INDEX },
    [COL.cobroSub.importeCancelado]: round2(importe),
  }
  const factura = relacion(facturaId)
  if (factura) cv[COL.cobroSub.factura] = factura
  return cv
}

/**
 * Subelemento de un ANTICIPO APLICADO: qué anticipo se está usando y por cuánto. Es la línea de lo
 * RECIBIDO en una aplicación —el lugar que en un cobro ocupan las formas de pago—, porque acá el
 * dinero no entra en el acto: ya estaba entregado y lo que se hace es imputarlo.
 *
 * Va por la MISMA relación que las facturas ("💰Fact Cancelada", board_relation_mm63pczd): la
 * columna conecta con tres tableros —entre ellos "Anticipos Pends de Aplicar"—, así que un anticipo
 * y una factura se linkean por ahí sin necesidad de una columna aparte. Lo que distingue a la línea
 * es su caja: "Anticipo".
 */
function columnasAnticipoAplicado(anticipoId: string, importe: number): Record<string, unknown> {
  const cv: Record<string, unknown> = {
    [COL.cobroSub.caja]: { index: CAJA_ANTICIPO_INDEX },
    [COL.cobroSub.importeCobrado]: round2(importe),
  }
  const anticipo = relacion(anticipoId)
  if (anticipo) cv[COL.cobroSub.factura] = anticipo
  return cv
}

/**
 * Subelemento del ANTICIPO: la línea que declara cuánto entregó el cliente a cuenta. Ocupa el lugar
 * que en un cobro ocupan los subítems de factura —dice QUÉ se cancela, no CON QUÉ se paga—, y por
 * eso reusa su misma columna de importe ("🤖Importe Cancelado $").
 *
 * Lo que lo distingue es la caja: se escribe con la etiqueta "Anticipo" del board, por ÍNDICE
 * (igual que las formas de pago), así el subítem queda identificado como anticipo en el tablero.
 *
 * Lleva además los otros dos datos que el usuario declaró junto al importe: el DETALLE —por qué se
 * registra— y la FECHA de vencimiento. Los tres viajan juntos porque describen al mismo anticipo:
 * el importe sin su motivo deja una línea que nadie puede explicar tres meses después.
 */
function columnasAnticipo(
  importe: number,
  detalle: string | undefined,
  vencimiento: string | undefined,
): Record<string, unknown> {
  const cv: Record<string, unknown> = {
    [COL.cobroSub.caja]: { index: CAJA_ANTICIPO_INDEX },
    [COL.cobroSub.importeCancelado]: round2(importe),
  }
  /* Cada campo se escribe sólo si tiene valor: vacío se OMITE en lugar de mandarse en blanco, igual
     que en el resto del archivo. La columna de texto largo pide su valor envuelto en `text`. */
  const texto = detalle?.trim()
  if (texto) cv[COL.cobroSub.detalle] = { text: texto }
  /* "🤖Fecha Venc" es la MISMA columna que usan el cheque y la tarjeta; acá es el vencimiento del
     anticipo. Nunca conviven en un mismo subítem. */
  const vence = fechaCol(vencimiento)
  if (vence) cv[COL.cobroSub.vencimiento] = vence
  return cv
}

/**
 * Subelemento de AJUSTE por diferencia de caja. Cierra el recibo cuando lo que entró a caja no
 * coincide exactamente con lo que se cancela: el paso de registro deja pasar los descuadres de
 * CENTAVOS (ver `TOLERANCIA_DIFERENCIA` en `lib/pagos`), y esta línea es la que los documenta en el
 * tablero en vez de dejarlos como un hueco silencioso entre los dos totales.
 *
 * El signo se conserva: positivo cuando faltó plata en caja (se canceló más de lo que entró) y
 * negativo cuando sobró. Un ajuste sin signo no se podría conciliar.
 *
 * El importe va como NÚMERO, igual que en todas las columnas `numeric_` de este archivo: así un
 * separador decimal mal formado no puede viajar disfrazado de texto.
 */
function columnasDifCaja(diferencia: number): Record<string, unknown> {
  return {
    [COL.cobroSub.caja]: { index: CAJA_DIF_INDEX },
    [COL.cobroSub.importeCobrado]: round2(diferencia),
  }
}

/**
 * Columnas del subelemento de una FORMA DE PAGO. Las dos primeras —caja e importe— las lleva TODO
 * movimiento; a partir de ahí, cada medio completa lo suyo y nada más:
 *
 *   · Transferencia → la cuenta propia que recibió el dinero.
 *   · Cheque        → número, CUIT del emisor, emisión, vencimiento, origen y banco.
 *   · Tarjeta       → banco emisor, tipo, cupón, vencimiento y cuenta de acreditación.
 *   · Retención     → nada extra acá: lo único que agrega es su comprobante, que es un archivo.
 *   · EFECTIVO      → NADA: se queda con la caja y el importe, por definición del requerimiento.
 *
 * Cada campo se escribe sólo si tiene valor: una columna vacía se OMITE en lugar de mandarse en
 * blanco, así un dato que el usuario no cargó no pisa nada en el tablero.
 */
function columnasPago(m: MovimientoPago): Record<string, unknown> {
  const cv: Record<string, unknown> = {
    // Por índice, no por etiqueta: es la identidad de la caja en el board (ver `CAJA_INDEX`).
    [COL.cobroSub.caja]: { index: CAJA_INDEX[m.formaPago] },
    [COL.cobroSub.importeCobrado]: round2(m.importe),
  }

  if (m.formaPago === 'Efectivo') return cv

  if (m.formaPago === 'Transferencia') {
    // Cuenta PROPIA de La Batea donde entró el dinero.
    const banco = relacion(m.cuentaPropiaId)
    if (banco) cv[COL.cobroSub.bancoAcreditacion] = banco
    return cv
  }

  if (m.formaPago === 'Cheque') {
    /* El número del cheque va a "🤖Nro Comprobante", que es de TEXTO: se escribe tal como se cargó,
       sin recortarle nada. Un cheque puede llevar ceros a la izquierda o un prefijo, y filtrarle los
       no-dígitos —como hacía falta cuando la columna era numérica— le cambiaba el número. */
    const nro = m.numeroCheque?.trim()
    if (nro) cv[COL.cobroSub.nroComprobante] = nro
    /* El CUIT va a una columna de TEXTO, así que se escribe tal como se cargó, con los guiones del
       formato ("20-45037195-6"). Sólo se manda completo: un CUIT a medio cargar no es un dato. */
    if (cuitCompleto(m.cuitEmisor)) cv[COL.cobroSub.cuit] = m.cuitEmisor
    const emision = fechaCol(m.fechaEmisionCheque)
    if (emision) cv[COL.cobroSub.fechaEmision] = emision
    // "🤖Fecha Venc" es la MISMA columna que usa el vencimiento de la tarjeta.
    const vencimiento = fechaCol(m.chequeVencimiento)
    if (vencimiento) cv[COL.cobroSub.vencimiento] = vencimiento
    const origen = dropdown(m.formatoCheque ? CHEQUE_ORIGEN_LABEL[m.formatoCheque] : null)
    if (origen) cv[COL.cobroSub.origenCheque] = origen
    const banco = dropdown(bancoDelTablero(m.bancoEmisor))
    if (banco) cv[COL.cobroSub.bancoEmisor] = banco
    return cv
  }

  if (esPagoConTarjeta(m.formaPago)) {
    // Banco EMISOR del plástico, distinto del banco de acreditación de más abajo.
    const bancoEmisor = dropdown(bancoDelTablero(m.bancoTarjeta))
    if (bancoEmisor) cv[COL.cobroSub.bancoEmisor] = bancoEmisor
    /* Número de cupón del posnet: es la referencia con la que se concilia la acreditación, así que
       va a "🤖Nro Comprobante" —la misma columna que el cheque y la retención—, tal como se cargó. */
    const cupon = m.numeroCupon?.trim()
    if (cupon) cv[COL.cobroSub.nroComprobante] = cupon
    const tipo = dropdown(m.tipoTarjeta)
    if (tipo) cv[COL.cobroSub.tipoTarjeta] = tipo
    // "🤖Fecha Venc" es la MISMA columna que usa el vencimiento del cheque.
    const vencimiento = fechaCol(m.vencimientoTarjeta)
    if (vencimiento) cv[COL.cobroSub.vencimiento] = vencimiento
    // Banco de ACREDITACIÓN: la cuenta propia de La Batea donde impacta el cobro.
    const acreditacion = relacion(m.cuentaPropiaId)
    if (acreditacion) cv[COL.cobroSub.bancoAcreditacion] = acreditacion
    return cv
  }

  /* Retenciones: el certificado se identifica con su AÑO y su NÚMERO, y cada uno va a una columna
     de distinto tipo. El NÚMERO comparte "🤖Nro Comprobante" con el cheque —es de texto, así que se
     escribe tal cual—; el AÑO va a una columna numérica, y ahí sí viaja sólo con dígitos: Monday
     rechaza el ítem entero si a una `numbers` le llega texto (lo que el usuario tipeó ya viene
     filtrado, y esto es el resguardo del lado del servicio).

     Vacías se OMITEN, nunca se mandan en cero: un cero sería un número de comprobante que no
     existe. El archivo que las respalda se sube aparte. */
  if (esRetencion(m.formaPago)) {
    const nro = m.nroComprobanteRetencion?.trim()
    if (nro) cv[COL.cobroSub.nroComprobante] = nro
    const anio = soloNumeros(m.anioRetencion)
    if (anio) cv[COL.cobroSub.anioRetencion] = anio
  }
  return cv
}

/* ===== Tipos de entrada y salida ===== */

/**
 * Sólo los dígitos de lo cargado, para las columnas NUMÉRICAS del tablero: Monday rechaza el ítem
 * entero si a una columna `numbers` le llega texto. Devuelve '' cuando no queda ningún dígito, que
 * es la señal para omitir la columna en vez de mandarla vacía.
 */
const soloNumeros = (valor: string | undefined): string => (valor ?? '').replace(/\D/g, '')

/** Una factura imputada: qué ítem se cancela, con qué número se lo muestra y por cuánto. */
export interface FacturaACancelar {
  /** Id del ítem en "💰Fact Vtas Pends de Cobro". Es lo que va a la relación del subítem. */
  id: string
  /** Número del comprobante ("FPENCOB-042"): nombra el subelemento. */
  nro: string
  /** Importe que este recibo le cancela. */
  importe: number
}

/** Un anticipo que se aplica: qué ítem se usa, con qué nombre se lo muestra y por cuánto. */
export interface AnticipoAAplicar {
  /** Id del ítem en "Anticipos Pends de Aplicar" (18426066447). Va a la relación del subítem. */
  id: string
  /** Cómo se lo nombra en el subelemento. Sin dato, la línea se llama sólo "Anticipo". */
  nro?: string
  /** Importe de ese anticipo que se imputa en esta aplicación. */
  importe: number
}

/**
 * Qué recibo se está emitiendo. Es lo que ramifica toda la escritura: la etiqueta de "🤖Tipo de
 * Cobro" de la cabecera, qué subelementos se arman y en qué ORDEN se crean.
 *
 *   · cobro      · facturas canceladas + formas de pago.
 *   · anticipo   · la línea del anticipo entregado + formas de pago.
 *   · aplicacion · anticipos aplicados PRIMERO y facturas canceladas DESPUÉS. Sin formas de pago:
 *                  el dinero ya había entrado, esto sólo lo imputa.
 */
export type TipoRecibo = 'cobro' | 'anticipo' | 'aplicacion'

export interface DatosRecibo {
  /** Cliente al que se le cobró: va a la relación "🤖Persona" de la cabecera. */
  clienteId: string
  /** Nombre del cliente: es el nombre del ítem hasta que lo renombra la customKey del board. */
  nombreCliente: string
  /** Vendedor cobrante (usuario de Monday), para la columna Person "🤖Vendedor". */
  vendedorId?: string | null
  /** Ver `TipoRecibo`. Ausente = cobro, que es el recorrido histórico. */
  tipo?: TipoRecibo
  /** Facturas imputadas: un subelemento cada una. Vacío en un anticipo. */
  facturas: FacturaACancelar[]
  /** Movimientos cargados en el paso de registro: un subelemento cada uno. Vacío en una aplicación. */
  movimientos: readonly MovimientoPago[]
  /** Sólo ANTICIPO: importe entregado a cuenta. Es lo que declara la línea "Anticipo" del recibo. */
  anticipo?: number
  /** Sólo ANTICIPO: el motivo que escribió el usuario. Va al "🤖Detalle" de esa misma línea. */
  detalleAnticipo?: string
  /** Sólo ANTICIPO: vencimiento en dd/MM/yyyy. Va al "🤖Fecha Venc" de esa misma línea. */
  vencimientoAnticipo?: string
  /** Sólo APLICACIÓN: los anticipos que se imputan contra las facturas de `facturas`. */
  anticiposAplicados?: readonly AnticipoAAplicar[]
}

export interface ResultadoRecibo {
  /** Id del ítem creado en "➡️Recibos y Cobros". */
  id: string
  /**
   * Subelementos de lo CANCELADO efectivamente creados, contra los que se esperaban: uno por
   * factura en un cobro, y la única línea del anticipo en un anticipo.
   */
  facturasCreadas: number
  facturasEsperadas: number
  /**
   * Subelementos de lo RECIBIDO efectivamente creados, contra los que se esperaban: uno por forma
   * de pago más, si el cobro no cuadró al centavo, la línea del ajuste "Dif de Caja".
   */
  pagosCreados: number
  pagosEsperados: number
}

/** El recibo quedó completo: entraron TODOS sus subelementos, de los dos tipos. */
export const reciboCompleto = (r: ResultadoRecibo): boolean =>
  r.facturasCreadas === r.facturasEsperadas && r.pagosCreados === r.pagosEsperados

/* ===== La orquestación ===== */

/**
 * Emite el recibo: crea la cabecera y, con su id, las dos tandas de subelementos.
 *
 * Devuelve cuántos subítems entraron de cada tipo. Un faltante NO se convierte en excepción: el
 * recibo ya existe en el tablero y hay que poder decirlo con precisión —"entraron 3 de 4 facturas"—
 * en vez de dejar al usuario con un error genérico y un recibo a medias que no sabe que se creó.
 */
export async function emitirRecibo(datos: DatosRecibo): Promise<ResultadoRecibo> {
  const { clienteId, nombreCliente, vendedorId, facturas, movimientos } = datos

  /* Un ANTICIPO no cancela facturas: en el lugar de sus subítems va UNA sola línea, la del importe
     entregado a cuenta. Ese "1" es lo que se espera crear, igual que en un cobro se espera una
     línea por factura imputada. */
  const esAnticipo = datos.tipo === 'anticipo'
  /* Una APLICACIÓN tampoco recibe plata: lo que ocupa el lugar de las formas de pago son los
     anticipos que ya estaban entregados y ahora se imputan. */
  const esAplicacion = datos.tipo === 'aplicacion'
  const anticiposAplicados = esAplicacion ? (datos.anticiposAplicados ?? []) : []
  const importeAnticipo = round2(datos.anticipo ?? 0)
  const canceladasEsperadas = esAnticipo ? 1 : facturas.length
  // Lo RECIBIDO: los anticipos imputados en una aplicación, las formas de pago en el resto.
  const recibidasEsperadas = esAplicacion ? anticiposAplicados.length : movimientos.length

  if (!mondayHabilitado()) {
    return {
      id: `mock-recibo-${Date.now()}`,
      facturasCreadas: canceladasEsperadas,
      facturasEsperadas: canceladasEsperadas,
      pagosCreados: recibidasEsperadas,
      pagosEsperados: recibidasEsperadas,
    }
  }

  /* --- MÓDULO 1 · la cabecera. Se espera: su id es el padre de todo lo que sigue. --- */
  /* Los tres totales de la cobranza. Se calculan ACÁ, sobre las mismas listas con las que se arman
     los subelementos, y no llegan por parámetro: así el importe que declara la cabecera es —por
     construcción— la suma exacta de lo que cuelga de ella, y no hay forma de que el ítem diga una
     cosa y sus subítems otra.
     La DIFERENCIA se deriva por el mismo motivo: es cancelado − recibido, no un tercer dato que
     alguien pueda mandar desalineado. En un cobro que cerró queda por debajo del peso —el paso de
     registro no deja avanzar de otra forma, ver `TOLERANCIA_DIFERENCIA`—, así que un peso entero
     en esa columna del tablero es, en sí mismo, una alarma. */
  const totalCancelado = esAnticipo
    ? importeAnticipo
    : round2(facturas.reduce((acc, f) => acc + f.importe, 0))
  /* Lo RECIBIDO sale de donde vino el dinero: de las formas de pago en un cobro o un anticipo, y de
     los anticipos imputados en una aplicación —ahí no entró plata nueva, se usa la que ya estaba—. */
  const totalRecibido = esAplicacion
    ? round2(anticiposAplicados.reduce((acc, a) => acc + a.importe, 0))
    : round2(movimientos.reduce((acc, m) => acc + m.importe, 0))
  /* El descuadre entre lo que el recibo cancela y lo que entró a caja. Se calcula UNA vez y de acá
     salen los dos lugares donde figura: la columna "🤖TOTAL $ Diferencia" de la cabecera y —si no
     es cero— el subelemento de ajuste "Dif de Caja".

     `Number.isFinite` es el cerrojo: si por lo que fuera llegara un importe que no es un número
     (un texto con coma decimal, un NaN), la diferencia NO se escribe como ajuste en vez de mandar
     basura a una columna numérica. */
  const diferenciaCaja = round2(totalCancelado - totalRecibido)
  const hayDifCaja = Number.isFinite(diferenciaCaja) && diferenciaCaja !== 0

  const cabecera: Record<string, unknown> = {
    /* Qué clase de cobro es, por ÍNDICE y no por etiqueta:
         · POSTERIOR         · se cancelan facturas ya emitidas, así que el cobro llega después de
                               la venta. Es el caso del recorrido de cobro.
         · ANTICIPO          · no hay venta previa que cobrar: es dinero a cuenta.
         · APLICACION CTA CTE· tampoco entra plata: se imputa el saldo a favor que el cliente ya
                               tenía contra sus facturas pendientes. */
    [COL.cobro.tipoCobro]: {
      index: esAnticipo
        ? TIPO_COBRO_INDEX.anticipo
        : esAplicacion
          ? TIPO_COBRO_INDEX.aplicacionCtaCte
          : TIPO_COBRO_INDEX.posterior,
    },
    [COL.cobro.totalCancelado]: totalCancelado,
    [COL.cobro.totalRecibido]: totalRecibido,
    [COL.cobro.diferencia]: diferenciaCaja,
  }
  const persona = relacion(clienteId)
  if (persona) cabecera[COL.cobro.cliente] = persona
  const vendedor = personCol(vendedorId)
  if (vendedor) cabecera[COL.cobro.vendedor] = vendedor

  const creado = await mondayApi<{ create_item: { id: string } }>(
    `mutation ($boardId: ID!, $name: String!, $cv: JSON!) {
      create_item(board_id: $boardId, item_name: $name, column_values: $cv) { id }
    }`,
    { boardId: BOARDS.cobros, name: nombreCliente, cv: JSON.stringify(cabecera) },
  )
  const itemId = creado.create_item.id

  /* --- TODOS los subelementos, en UNA sola mutación ---
     El recibo se arma con DOS bloques: lo que CANCELA y con qué se lo cubre (lo RECIBIDO). El orden
     de la lista es el orden en que se crean —los campos raíz de una mutación se ejecutan en serie y
     en el orden del documento—, así que armarla es lo que decide la jerarquía en el tablero. */

  /* Bloque de lo CANCELADO. En un cobro y en una aplicación, una línea por factura imputada; en un
     anticipo, la única línea del importe entregado a cuenta. */
  const canceladas: SubitemACrear[] = esAnticipo
    ? [
        {
          alias: 'a0',
          nombre: 'Anticipo',
          columnas: columnasAnticipo(
            importeAnticipo,
            datos.detalleAnticipo,
            datos.vencimientoAnticipo,
          ),
        },
      ]
    : facturas.map((f, i) => ({
        alias: `f${i}`,
        nombre: `Factura ${f.nro}`,
        columnas: columnasFactura(f.id, f.importe),
      }))

  /* Los movimientos, REORDENADOS: primero los medios con los que entró plata (efectivo,
     transferencia, cheque, tarjetas) y después TODAS las retenciones. No es cosmético: una
     retención no es dinero que entró, es impuesto que el cliente ya ingresó por su cuenta, así que
     el tablero las quiere leídas al final del bloque, después de la caja real.

     Se reordena la LISTA de movimientos y no sólo sus líneas: los comprobantes se suben después
     emparejando por POSICIÓN contra los ids devueltos, así que si las líneas se reordenaran solas,
     cada archivo terminaría colgado del subítem equivocado. Una sola lista, un solo orden. */
  const movimientosOrdenados = esAplicacion
    ? []
    : [
        ...movimientos.filter((m) => !esRetencion(m.formaPago)),
        ...movimientos.filter((m) => esRetencion(m.formaPago)),
      ]

  /* Bloque de lo RECIBIDO. En una APLICACIÓN son los anticipos que se imputan —no hay formas de
     pago ni ajuste de caja: no entró plata nueva, se usa la que ya estaba—. En el resto, una línea
     por movimiento (medios primero, retenciones después) y, AL FINAL DE TODO, el ajuste por
     diferencia si lo hubo: el descuadre se declara recién cuando ya está escrito todo lo que lo
     produjo, así que ninguna línea puede quedar por debajo suyo.

     Ese ajuste va en esta misma lista y no en una solicitud aparte: es parte del mismo lote y del
     mismo documento GraphQL, así que o entra todo o no entra nada. Cuadrando perfecto, la línea ni
     se arma: un ajuste en cero no es información, es ruido en el tablero. */
  const recibido: SubitemACrear[] = esAplicacion
    ? anticiposAplicados.map((a, i) => ({
        alias: `an${i}`,
        nombre: a.nro?.trim() ? `Anticipo ${a.nro.trim()}` : 'Anticipo',
        columnas: columnasAnticipoAplicado(a.id, a.importe),
      }))
    : [
        ...movimientosOrdenados.map((m, i) => ({
          alias: `p${i}`,
          nombre: m.formaPago,
          columnas: columnasPago(m),
        })),
        ...(hayDifCaja
          ? [{ alias: 'd0', nombre: 'Dif de Caja', columnas: columnasDifCaja(diferenciaCaja) }]
          : []),
      ]

  /* El ORDEN de los dos bloques depende de la operación:
       · APLICACIÓN · los ANTICIPOS primero y las facturas después. Es el requerimiento del
                      tablero: primero se declara el saldo que se usa y recién después contra qué
                      se aplica.
       · resto      · primero lo que el recibo cancela y después con qué se pagó, para que los
                      pagos no se adelanten a las facturas que cubren. */
  const lineas: SubitemACrear[] = esAplicacion
    ? [...recibido, ...canceladas]
    : [...canceladas, ...recibido]

  const ids = await crearSubitems(itemId, lineas)
  /* Los ids vuelven en el MISMO orden en que se pidieron, así que la lista se parte por donde
     termina el primer bloque —y cuál es el primero lo decide `lineas`, no el nombre de la
     variable—. Cada bloque recupera exactamente sus ids. */
  const idsRecibido = esAplicacion
    ? ids.slice(0, recibido.length)
    : ids.slice(canceladas.length)
  const idsCanceladas = esAplicacion
    ? ids.slice(recibido.length)
    : ids.slice(0, canceladas.length)

  /* --- Los comprobantes adjuntos, que necesitan el id de su subelemento ya creado ---
     Son best-effort: que falle una subida no invalida el recibo, que ya quedó escrito con todos
     sus datos. Van igual ANTES de devolver, para que la emisión encuentre el ítem completo.

     La correspondencia es por POSICIÓN, y se sostiene por dos cosas: se pasa la lista REORDENADA
     —la misma con la que se armaron las líneas, no la original— y el ajuste va ÚLTIMO, así que
     cada índice cae sobre su propio subítem y la línea de más queda fuera del recorrido. */
  await subirComprobantes(idsRecibido, movimientosOrdenados)

  return {
    id: itemId,
    facturasCreadas: idsCanceladas.filter(Boolean).length,
    facturasEsperadas: canceladasEsperadas,
    /* El ajuste de caja cuenta como una línea más de lo recibido: si se pidió y no entró, el recibo
       está incompleto igual que si faltara una forma de pago —el descuadre quedaría sin documentar
       y el PDF saldría sin esa línea—. En una aplicación, lo que se cuenta acá son los anticipos. */
    pagosCreados: idsRecibido.filter(Boolean).length,
    pagosEsperados: recibido.length,
  }
}

/* ===== La emisión del PDF: pedirla y seguirla ===== */

/**
 * Pide la emisión: pone "🤖Estado de Emision" en "A emitir", que es lo que dispara la
 * automatización del tablero que genera el PDF del recibo.
 *
 * Se escribe RECIÉN cuando el recibo está completo —cabecera y subelementos—, nunca antes: la
 * automatización lee el ítem para armar el documento, así que pedirle la emisión a un recibo a
 * medio escribir produciría un PDF sin sus facturas o sin sus formas de pago.
 *
 * A partir de acá la columna es del TABLERO: la app sólo la lee (ver `getEstadoEmision`).
 */
export async function marcarAEmitir(itemId: string): Promise<void> {
  if (!mondayHabilitado()) return
  await mondayApi(
    `mutation ($id: ID!, $board: ID!, $cv: JSON!) {
      change_multiple_column_values(item_id: $id, board_id: $board, column_values: $cv) { id }
    }`,
    {
      id: itemId,
      board: BOARDS.cobros,
      cv: JSON.stringify({
        [COL.cobro.estadoEmision]: { index: ESTADO_EMISION_INDEX.aEmitir },
      }),
    },
  )
}

/**
 * En qué anda la emisión del PDF, según el tablero. Los diez estados de la columna se reducen acá
 * a los TRES que le importan a quien espera: sigue en curso, cerró bien o cerró mal.
 *
 * La traducción se hace en el servicio —y no en la pantalla— para que los índices de Monday no se
 * filtren fuera de esta capa: quien consume esto no tiene por qué saber que "Emitido" es el 1.
 */
export type FaseEmisionBoard = 'en-curso' | 'emitido' | 'error'

export interface EstadoEmision {
  fase: FaseEmisionBoard
  /** Etiqueta tal cual la muestra el tablero ("Emitiendo", "Emitido", "Error - Emision"). */
  label: string
}

/**
 * Lee "🤖Estado de Emision" del recibo. Es la consulta que se repite mientras se espera al
 * tablero: devuelve en qué anda —con lo que se decide— y la etiqueta —que es lo que se le muestra
 * al usuario, para que la pantalla diga exactamente lo mismo que el board—.
 *
 * Una columna vacía o un ítem que no se pudo leer cuentan como "en curso", NO como error: recién
 * empezó y el tablero todavía no la movió. Lo que corta la espera es el estado terminal o el tope
 * de tiempo de quien sondea, nunca una lectura ambigua.
 *
 * En modo local no hay tablero que emita nada, así que se responde "Emitido" de una: el prototipo
 * tiene que poder recorrerse entero sin cuenta de Monday.
 */
export async function getEstadoEmision(itemId: string): Promise<EstadoEmision> {
  if (!mondayHabilitado()) return { fase: 'emitido', label: 'Emitido' }

  const data = await mondayApi<{ items: MondayItem[] }>(
    `query ($id: [ID!]) {
      items(ids: $id) {
        id
        column_values(ids: ["${COL.cobro.estadoEmision}"]) {
          id text
          ... on StatusValue { index }
        }
      }
    }`,
    { id: [itemId] },
  )

  const item = data.items?.[0]
  const cv = item ? byId(item)[COL.cobro.estadoEmision] : undefined
  const index = cv?.index ?? null
  const fase: FaseEmisionBoard =
    index === ESTADO_EMISION_INDEX.emitido
      ? 'emitido'
      : index === ESTADO_EMISION_INDEX.error
        ? 'error'
        : 'en-curso'
  return { fase, label: cv?.text?.trim() ?? '' }
}

/** Un subelemento a crear: con qué alias se lo pide, cómo se llama y qué columnas lleva. */
interface SubitemACrear {
  /**
   * Alias del campo en la mutación (`f0`, `p3`…). Identifica la línea en la respuesta y, como el
   * prefijo distingue facturas de pagos, los dos tipos conviven en un mismo documento sin chocar.
   */
  alias: string
  nombre: string
  columnas: Record<string, unknown>
}

/**
 * Crea TODOS los subelementos del recibo en una sola mutación, un alias por línea. Monday no tiene
 * un `create_subitem` plural: los alias son la forma de escribir en lote.
 *
 * El orden de `lineas` es el orden de creación —los campos raíz de una mutación se ejecutan en
 * serie y en el orden del documento—, así que quien arma la lista decide qué se crea primero.
 *
 * Devuelve el id de cada subelemento en el MISMO orden de entrada, con `''` en los que no entraron:
 * eso es lo que permite contar los creados y colgarle a cada pago su comprobante.
 *
 * Sobre las tandas: la idea es que TODO viaje en una sola solicitud, y en una cobranza normal
 * —unas pocas facturas y unos pocos pagos— es exactamente lo que pasa. El corte por tandas es un
 * seguro para el caso extremo: una mutación con demasiados campos se rechaza entera por
 * complejidad, y perder todo el recibo por eso sería peor que partirlo. Como las tandas salen una
 * después de la otra, el orden global se mantiene igual.
 *
 * `create_labels_if_missing`: el banco emisor y el tipo de tarjeta se pueden ampliar desde el
 * formulario, así que una etiqueta nueva tiene que poder nacer al escribir el subelemento. La caja
 * NO corre ese riesgo: se escribe por índice.
 */
async function crearSubitems(itemId: string, lineas: SubitemACrear[]): Promise<string[]> {
  const ids: string[] = []
  for (let desde = 0; desde < lineas.length; desde += SUBITEMS_POR_TANDA) {
    const tanda = lineas.slice(desde, desde + SUBITEMS_POR_TANDA)
    const variables: Record<string, unknown> = { parentId: itemId }
    /* Las variables se numeran por POSICIÓN en la lista (`$n0`, `$c0`, `$n1`…) y el campo se
       nombra con el alias de la línea: así el nombre de la variable nunca se repite dentro del
       documento, sin importar cómo se hayan mezclado los dos tipos de subítem. */
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

/**
 * Sube el comprobante de cada pago a la columna `file` que le corresponde: comprobante de
 * transferencia, comprobante de retención o cupón de tarjeta. Es el único camino, porque
 * `column_values` sólo transporta JSON.
 *
 * Cada subida es INDEPENDIENTE y best-effort: que falle el comprobante de un movimiento no puede
 * tumbar a los demás ni al recibo, que ya quedó creado con todos sus datos.
 */
async function subirComprobantes(
  subitemIds: string[],
  movimientos: readonly MovimientoPago[],
): Promise<void> {
  const subidas = movimientos.flatMap((m, i) => {
    const archivo = m.comprobanteArchivo
    const columna = columnaComprobante(m)
    /* El id va INLINE en la mutación: en un multipart la única variable es el archivo. Por eso se
       exige que sea numérico, y no un texto cualquiera metido en la query. */
    const subitemId = Number(subitemIds[i])
    if (!archivo || !columna || !Number.isFinite(subitemId) || subitemId <= 0) return []
    return [
      mondaySubirArchivo(
        `mutation ($file: File!) {
          add_file_to_column(item_id: ${subitemId}, column_id: "${columna}", file: $file) { id }
        }`,
        archivo,
      ),
    ]
  })
  // `allSettled`: se intentan todas y ninguna cancela a las otras.
  await Promise.allSettled(subidas)
}
