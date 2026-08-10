/**
 * Emisión del recibo: lo ÚNICO que esta app escribe en Monday.
 *
 * Son DOS solicitudes, no más:
 *
 *   1) CABECERA — `create_item` en "➡️Recibos y Cobros" (18421035524) con el vendedor, el cliente y
 *      los tres totales (cancelado, recibido y su diferencia). Su `id` es el `parent_item_id` de
 *      todo lo que sigue: sin él no hay dónde colgar nada.
 *   2) SUBELEMENTOS — TODOS en una sola mutación: primero las facturas canceladas (alias `f0`,
 *      `f1`…) y a continuación las formas de pago (`p0`, `p1`…).
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
import { cuitCompleto, esRetencion, esPagoConTarjeta, valorPorCuota } from '@/lib/pagos'
import type { MovimientoPago } from '@/types'
import {
  BANCO_EMISOR_LABEL,
  BOARDS,
  CAJA_INDEX,
  CHEQUE_ORIGEN_LABEL,
  COL,
  ESTADO_EMISION_INDEX,
  personCol,
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
 * Subelemento de una FACTURA CANCELADA: qué factura se cancela y por cuánto. Son las dos únicas
 * columnas que lleva —no hay medio de pago acá: eso vive en el otro tipo de subítem—.
 */
function columnasFactura(facturaId: string, importe: number): Record<string, unknown> {
  const cv: Record<string, unknown> = {
    [COL.cobroSub.importeCancelado]: String(round2(importe)),
  }
  const factura = relacion(facturaId)
  if (factura) cv[COL.cobroSub.factura] = factura
  return cv
}

/**
 * Columnas del subelemento de una FORMA DE PAGO. Las dos primeras —caja e importe— las lleva TODO
 * movimiento; a partir de ahí, cada medio completa lo suyo y nada más:
 *
 *   · Transferencia → la cuenta propia que recibió el dinero.
 *   · Cheque        → número, CUIT del emisor, emisión, vencimiento, origen y banco.
 *   · Tarjeta       → banco emisor, plástico, titular, tipo, cupón, vencimiento, acreditación y
 *                     —sólo en el crédito— el plan de cuotas.
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
    [COL.cobroSub.importeCobrado]: String(round2(m.importe)),
  }

  if (m.formaPago === 'Efectivo') return cv

  if (m.formaPago === 'Transferencia') {
    // Cuenta PROPIA de La Batea donde entró el dinero.
    const banco = relacion(m.cuentaPropiaId)
    if (banco) cv[COL.cobroSub.bancoAcreditacion] = banco
    return cv
  }

  if (m.formaPago === 'Cheque') {
    // El número de cheque va a una columna numérica: sólo los dígitos.
    const nro = (m.numeroCheque ?? '').replace(/\D/g, '')
    if (nro) cv[COL.cobroSub.nroCheque] = nro
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
    if (m.numeroTarjeta) cv[COL.cobroSub.nroTarjeta] = m.numeroTarjeta
    if (m.titularTarjeta?.trim()) cv[COL.cobroSub.titularTarjeta] = m.titularTarjeta.trim()
    // Número de cupón del posnet: es la referencia con la que se concilia la acreditación.
    if (m.numeroCupon?.trim()) cv[COL.cobroSub.nroCupon] = m.numeroCupon.trim()
    const tipo = dropdown(m.tipoTarjeta)
    if (tipo) cv[COL.cobroSub.tipoTarjeta] = tipo
    // "🤖Fecha Venc" es la MISMA columna que usa el vencimiento del cheque.
    const vencimiento = fechaCol(m.vencimientoTarjeta)
    if (vencimiento) cv[COL.cobroSub.vencimiento] = vencimiento
    // Banco de ACREDITACIÓN: la cuenta propia de La Batea donde impacta el cobro.
    const acreditacion = relacion(m.cuentaPropiaId)
    if (acreditacion) cv[COL.cobroSub.bancoAcreditacion] = acreditacion
    // Sólo el crédito tiene plan de cuotas; el débito se acredita en un pago.
    if (m.formaPago === 'Tarjeta de crédito' && m.cuotas && m.cuotas > 0) {
      cv[COL.cobroSub.cuotas] = String(m.cuotas)
      cv[COL.cobroSub.valorCuota] = String(valorPorCuota(m.importe, m.cuotas) ?? 0)
    }
    return cv
  }

  /* Retenciones: no agregan ninguna columna de VALOR. Lo único que suman es el comprobante que las
     respalda, y eso es un archivo que se sube después. */
  return cv
}

/* ===== Tipos de entrada y salida ===== */

/** Una factura imputada: qué ítem se cancela, con qué número se lo muestra y por cuánto. */
export interface FacturaACancelar {
  /** Id del ítem en "💰Fact Vtas Pends de Cobro". Es lo que va a la relación del subítem. */
  id: string
  /** Número del comprobante ("FPENCOB-042"): nombra el subelemento. */
  nro: string
  /** Importe que este recibo le cancela. */
  importe: number
}

export interface DatosRecibo {
  /** Cliente al que se le cobró: va a la relación "🤖Persona" de la cabecera. */
  clienteId: string
  /** Nombre del cliente: es el nombre del ítem hasta que lo renombra la customKey del board. */
  nombreCliente: string
  /** Vendedor cobrante (usuario de Monday), para la columna Person "🤖Vendedor". */
  vendedorId?: string | null
  /** Facturas imputadas en el paso 2: un subelemento cada una. */
  facturas: FacturaACancelar[]
  /** Movimientos cargados en el paso 3: un subelemento cada uno. */
  movimientos: readonly MovimientoPago[]
}

export interface ResultadoRecibo {
  /** Id del ítem creado en "➡️Recibos y Cobros". */
  id: string
  /** Subelementos de factura efectivamente creados, contra los que se esperaban. */
  facturasCreadas: number
  facturasEsperadas: number
  /** Subelementos de forma de pago efectivamente creados, contra los que se esperaban. */
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

  if (!mondayHabilitado()) {
    return {
      id: `mock-recibo-${Date.now()}`,
      facturasCreadas: facturas.length,
      facturasEsperadas: facturas.length,
      pagosCreados: movimientos.length,
      pagosEsperados: movimientos.length,
    }
  }

  /* --- MÓDULO 1 · la cabecera. Se espera: su id es el padre de todo lo que sigue. --- */
  /* Los tres totales de la cobranza. Se calculan ACÁ, sobre las mismas listas con las que se arman
     los subelementos, y no llegan por parámetro: así el importe que declara la cabecera es —por
     construcción— la suma exacta de lo que cuelga de ella, y no hay forma de que el ítem diga una
     cosa y sus subítems otra.
     La DIFERENCIA se deriva por el mismo motivo: es cancelado − recibido, no un tercer dato que
     alguien pueda mandar desalineado. En un cobro que cerró da 0 —el paso 3 no deja avanzar de
     otra forma—, así que un número distinto de cero en el tablero es, en sí mismo, una alarma. */
  const totalCancelado = round2(facturas.reduce((acc, f) => acc + f.importe, 0))
  const totalRecibido = round2(movimientos.reduce((acc, m) => acc + m.importe, 0))

  const cabecera: Record<string, unknown> = {
    [COL.cobro.totalCancelado]: String(totalCancelado),
    [COL.cobro.totalRecibido]: String(totalRecibido),
    [COL.cobro.diferencia]: String(round2(totalCancelado - totalRecibido)),
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

  /* --- MÓDULOS 2 y 3 · TODOS los subelementos, en UNA sola mutación ---
     El orden de esta lista es el orden en que se crean: primero las facturas que el recibo cancela
     y después las formas de pago con las que se cobraron. Los campos raíz de una mutación se
     ejecutan en serie y en el orden del documento, así que armar la lista en este orden ES la
     garantía de que los pagos no se adelanten a las facturas. */
  const lineas: SubitemACrear[] = [
    ...facturas.map((f, i) => ({
      alias: `f${i}`,
      nombre: `Factura ${f.nro}`,
      columnas: columnasFactura(f.id, f.importe),
    })),
    ...movimientos.map((m, i) => ({
      alias: `p${i}`,
      nombre: m.formaPago,
      columnas: columnasPago(m),
    })),
  ]

  const ids = await crearSubitems(itemId, lineas)
  /* Los ids vuelven en el mismo orden en que se pidieron, así que la lista se parte por donde
     termina el bloque de facturas: lo de antes es de ellas, lo de después de los pagos. */
  const idsFacturas = ids.slice(0, facturas.length)
  const idsPagos = ids.slice(facturas.length)

  /* --- Los comprobantes adjuntos, que necesitan el id de su subelemento ya creado ---
     Son best-effort: que falle una subida no invalida el recibo, que ya quedó escrito con todos
     sus datos. Van igual ANTES de devolver, para que la emisión encuentre el ítem completo. */
  await subirComprobantes(idsPagos, movimientos)

  return {
    id: itemId,
    facturasCreadas: idsFacturas.filter(Boolean).length,
    facturasEsperadas: facturas.length,
    pagosCreados: idsPagos.filter(Boolean).length,
    pagosEsperados: movimientos.length,
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
