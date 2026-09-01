/**
 * Registro de un PASE DE SALDO en Monday: el saldo a favor de una persona se mueve a la cuenta de
 * otra.
 *
 * El pase se hace entre cuentas de CLIENTES o entre cuentas de PROVEEDORES —lo declara el usuario en
 * el paso 1—, y cada lado del mostrador tiene su tablero: "➡️Recibos y Cobros" (18421035524) para
 * los clientes y "⬅️ Pagos - PENDIENTES" (18421035536) para los proveedores. La ESCRITURA es la
 * misma en los dos —una cabecera, sus débitos, su crédito y el pedido de registro—, así que lo único
 * que cambia viaja en un descriptor (`TABLERO_DE_PASE`) y el procedimiento se escribe una sola vez:
 * duplicarlo habría dejado dos registros que se corrigen por separado, con la mitad de las
 * correcciones aplicadas a uno solo.
 *
 * Son DOS solicitudes, con la misma forma que la emisión del recibo (ver `recibos.ts`):
 *
 *   1) CABECERA — `create_item` en el tablero del lado que corresponda, con el tipo "Pase de Saldo",
 *      el vendedor, la persona DESTINO y los tres totales. Su `id` es el padre de lo que sigue.
 *   2) SUBELEMENTOS — TODOS en una sola mutación y en ESTE orden: primero los DÉBITOS al origen
 *      —uno por anticipo del que sale saldo, con su importe y linkeado a ese anticipo— y después el
 *      CRÉDITO al destino, que es UNO solo por el total.
 *
 * Con las dos escrituras confirmadas se le pide al tablero que PROCESE el ítem —su columna de
 * registro en "Registrar"—, y esa tercera solicitud SÍ se espera: es el disparador de la
 * automatización, y una operación que nunca llegó a pedirse no se puede dar por registrada. Lo que
 * viene después —esperar a que el tablero la confirme— es del llamador (ver `esperarRegistro`), que
 * es quien tiene la pantalla tapada mientras tanto.
 *
 * El orden no es cosmético: el saldo sale de una cuenta antes de entrar en otra, y los campos raíz
 * de una `mutation` se ejecutan en serie y en el orden en que están escritos. Que todas las patas
 * viajen en un solo documento es lo que evita el estado intermedio peor posible: débitos
 * registrados sin su crédito, o sea plata descontada de una cuenta y acreditada a nadie.
 *
 * La DIFERENCIA de la cabecera es siempre 0: un pase no crea ni destruye saldo, sólo lo mueve, así
 * que lo debitado y lo acreditado son el mismo importe por definición de la operación.
 *
 * Sin token (modo local) no se escribe nada y se devuelve un id simulado, igual que el resto de la
 * capa de servicio.
 */
import { round2 } from '@/lib/format'
import { diferenciaPase, MSG_PASE_DESCUADRADO, paseCuadra } from '@/lib/pases'
import type { RolPersona } from '@/lib/personas'
import {
  BOARDS,
  CAJA_CREDITO_PASE_INDEX,
  CAJA_DEBITO_PASE_INDEX,
  CAJA_PAGO_CREDITO_PASE_INDEX,
  CAJA_PAGO_DEBITO_PASE_INDEX,
  COL,
  personCol,
  TIPO_COBRO_INDEX,
  TIPO_PAGO_INDEX,
} from './columns'
import { pedirRegistro, REGISTRO_COBROS, REGISTRO_PAGOS, type TableroDeRegistro } from './registro'
import { mondayApi, mondayHabilitado } from './sdk'

/** Relación a un ítem de otro board, o `null` si el id no sirve (para poder OMITIR la columna). */
const relacion = (id: string | null | undefined): { item_ids: number[] } | null => {
  const n = Number(id)
  return Number.isFinite(n) && n > 0 ? { item_ids: [n] } : null
}

/**
 * Dónde y con qué nombres se escribe un pase de CADA lado del mostrador.
 *
 * Los dos tableros son espejos, pero NINGÚN id ni índice se repite entre ellos: el tipo de
 * operación, la caja de cada pata, la columna del importe y hasta el "Registrar" tienen valores
 * propios en cada uno. Tenerlos acá, uno al lado del otro, es lo que permite que el procedimiento de
 * abajo no sepa de qué lado está escribiendo.
 */
interface TableroDePase {
  /** Board de la CABECERA. Sus subelementos cuelgan de él. */
  board: number
  /** "Tipo de Cobro" / "Tipo de Pago" y el índice de su etiqueta "Pase de Saldo". */
  tipo: string
  tipoIndex: number
  /** La persona que RECIBE el saldo, en la cabecera. */
  personaDestino: string
  /** Los tres totales de la cabecera: lo debitado, lo acreditado y su diferencia. */
  totalDebitado: string
  totalAcreditado: string
  diferencia: string
  /** El responsable de la operación (columna `people`). */
  vendedor: string
  /** Columna que rotula qué declara cada subelemento, y los índices de las dos patas del pase. */
  caja: string
  debitoIndex: number
  creditoIndex: number
  /** Dónde va el importe de cada pata: lo que SALE de una cuenta y lo que ENTRA en la otra. */
  importeDebito: string
  importeCredito: string
  /** De quién sale el saldo, en el subelemento del débito. */
  personaOrigen: string
  /** El anticipo del que sale ESE débito. */
  anticipo: string
  /** Su semáforo de registro: el que se pone en "Registrar" y el que después se espera. */
  registro: TableroDeRegistro
}

const TABLERO_DE_PASE: Record<RolPersona, TableroDePase> = {
  /* CLIENTES · "➡️Recibos y Cobros". El pase nace como un movimiento de cobranza: el débito
     consume saldo ("Importe Cancelado") y el crédito entra en la cuenta destino ("Importe
     Recibido"). */
  cliente: {
    board: BOARDS.cobros,
    tipo: COL.cobro.tipoCobro,
    tipoIndex: TIPO_COBRO_INDEX.paseDeSaldo,
    personaDestino: COL.cobro.cliente,
    totalDebitado: COL.cobro.totalCancelado,
    totalAcreditado: COL.cobro.totalRecibido,
    diferencia: COL.cobro.diferencia,
    vendedor: COL.cobro.vendedor,
    caja: COL.cobroSub.caja,
    debitoIndex: CAJA_DEBITO_PASE_INDEX,
    creditoIndex: CAJA_CREDITO_PASE_INDEX,
    importeDebito: COL.cobroSub.importeCancelado,
    importeCredito: COL.cobroSub.importeCobrado,
    personaOrigen: COL.cobroSub.personaOrigen,
    anticipo: COL.cobroSub.anticipoAplicado,
    registro: REGISTRO_COBROS,
  },
  /* PROVEEDORES · "⬅️ Pagos - PENDIENTES". Mismo movimiento del otro lado: el débito consume el
     saldo a favor NUESTRO con un proveedor ("Importe Cancelado") y el crédito lo deja a favor en la
     cuenta del otro ("Importe Entregado"). El anticipo linkeado sale del tablero de anticipos de
     proveedores, que es el único que esa columna acepta. */
  proveedor: {
    board: BOARDS.ordenesPago,
    tipo: COL.ordenPago.tipoPago,
    tipoIndex: TIPO_PAGO_INDEX.paseDeSaldo,
    personaDestino: COL.ordenPago.proveedor,
    totalDebitado: COL.ordenPago.totalCancelado,
    totalAcreditado: COL.ordenPago.totalEntregado,
    diferencia: COL.ordenPago.diferencia,
    vendedor: COL.ordenPago.vendedor,
    caja: COL.ordenPagoSub.caja,
    debitoIndex: CAJA_PAGO_DEBITO_PASE_INDEX,
    creditoIndex: CAJA_PAGO_CREDITO_PASE_INDEX,
    importeDebito: COL.ordenPagoSub.importeCancelado,
    importeCredito: COL.ordenPagoSub.importeEntregado,
    personaOrigen: COL.ordenPagoSub.personaOrigen,
    anticipo: COL.ordenPagoSub.anticipoAplicado,
    registro: REGISTRO_PAGOS,
  },
}

/**
 * En qué tablero hay que esperar la confirmación de un pase. Lo consulta la pantalla que cierra la
 * operación: pide el registro este módulo, pero el que espera —con la pantalla tapada— es ella, así
 * que necesita saber a qué columna mirar sin tener que conocer los tableros.
 */
export const tableroDeRegistroDelPase = (rol: RolPersona): TableroDeRegistro =>
  TABLERO_DE_PASE[rol].registro

/** Un débito del pase: de qué anticipo sale el saldo y por cuánto. */
export interface DebitoDePase {
  /** Id del ítem en el tablero de anticipos del lado que corresponda. Va a la relación del subelemento. */
  anticipoId: string
  /** Cuánto se debita de ESE anticipo. */
  importe: number
}

export interface DatosPase {
  /**
   * De quiénes son las dos cuentas: decide en qué tablero se escribe todo (ver `TABLERO_DE_PASE`).
   * Las dos puntas son del MISMO lado del mostrador —lo garantiza el paso 1, que valida la
   * categoría de las dos personas contra este mismo rol—, así que es uno solo y no dos.
   */
  rol: RolPersona
  /** Persona de cuyo anticipo SALE el saldo. Va a "🤖Persona Origen" del subítem de débito. */
  personaOrigenId: string
  /** Nombre de la persona origen: nombra el ítem hasta que lo renombra la customKey del board. */
  nombreOrigen: string
  /**
   * Persona que RECIBE el saldo: va a la relación de la cabecera. Es la PERSONA detrás de la cuenta
   * destino, no el ítem de esa cuenta: la columna conecta con el board de Personas.
   */
  personaDestinoId: string
  /**
   * Los DÉBITOS del pase: uno por anticipo del que sale saldo, con su importe. Cada uno se escribe
   * como su PROPIO subelemento y queda linkeado a SU anticipo, así el tablero muestra cuánto salió
   * de cada saldo sin tener que repartir un total entre varias relaciones.
   *
   * Lo debitado es su suma y se calcula acá: el total de la cabecera es —por construcción— lo que
   * suman las líneas que cuelgan de ella.
   */
  debitos: readonly DebitoDePase[]
  /**
   * Vendedor responsable (usuario de Monday), para la columna Person "🤖Vendedor". Es OBLIGATORIO:
   * un pase sin responsable no se registra. Antes era opcional y la columna se omitía en silencio
   * cuando el id no servía, así que un pase podía quedar en el tablero sin vendedor y nadie se
   * enteraba hasta mirarlo.
   */
  vendedorId: string
  /**
   * Lo que se ACREDITA en la cuenta destino. Va aparte de lo debitado aunque hoy sea el mismo
   * número: es lo que permite verificar que el pase cuadra en vez de asumirlo.
   */
  acreditado: number
}

/**
 * Registra el pase y devuelve el id del ítem creado.
 *
 * Un fallo en cualquiera de las dos solicitudes se propaga: el llamador lo comunica y NO da la
 * operación por cerrada. Con la cabecera escrita y los subítems no, queda un ítem sin sus dos patas
 * —visible en el tablero y corregible a mano—, que es preferible a un pase a medias que la app dé
 * por bueno.
 */
export async function registrarPaseDeSaldo(datos: DatosPase): Promise<string> {
  const { rol, personaOrigenId, nombreOrigen, personaDestinoId, debitos, vendedorId } = datos
  const tablero = TABLERO_DE_PASE[rol]
  const debitado = round2(debitos.reduce((acc, d) => acc + d.importe, 0))
  const acreditado = round2(datos.acreditado)

  /* El pase tiene que cuadrar. Es redundante —los dos importes salen del mismo lugar— y por eso
     mismo es barato: si algún día dejan de salir del mismo lugar, esto corta antes de escribir un
     movimiento descuadrado en el tablero, que después hay que encontrar y deshacer a mano. */
  if (!paseCuadra(debitado, acreditado)) throw new Error(MSG_PASE_DESCUADRADO)

  if (!mondayHabilitado()) return `mock-pase-${Date.now()}`

  /* --- La cabecera. Se espera: su id es el padre de los dos subelementos. --- */
  const cabecera: Record<string, unknown> = {
    [tablero.tipo]: { index: tablero.tipoIndex },
    /* Los tres totales. Debitado y acreditado son el MISMO número —el pase mueve saldo, no lo
       genera—, así que la diferencia es 0 por construcción y no un dato que alguien pueda mandar
       desalineado. */
    [tablero.totalDebitado]: debitado,
    [tablero.totalAcreditado]: acreditado,
    /* La diferencia se DERIVA, no se escribe en cero a mano: así el número del tablero es el
       resultado real de la cuenta y no una promesa. Con la validación de arriba, siempre es 0. */
    [tablero.diferencia]: diferenciaPase(debitado, acreditado),
  }
  /* La persona de la cabecera es la de DESTINO: el pase se registra a nombre de quien recibe el
     saldo. El origen queda en el subítem de débito, que es donde el movimiento le corresponde. */
  const destino = relacion(personaDestinoId)
  if (destino) cabecera[tablero.personaDestino] = destino
  /* El vendedor NO se omite: si el id no sirve, se corta acá. Omitirlo en silencio dejaba pases sin
     responsable en el tablero, que es justamente lo que había que poder auditar. */
  const vendedor = personCol(vendedorId)
  if (!vendedor) {
    throw new Error(
      `No se puede registrar el pase sin vendedor: el usuario responsable no tiene un id válido de Monday ("${vendedorId}")`,
    )
  }
  cabecera[tablero.vendedor] = vendedor

  const creado = await mondayApi<{ create_item: { id: string } }>(
    `mutation ($boardId: ID!, $name: String!, $cv: JSON!) {
      create_item(board_id: $boardId, item_name: $name, column_values: $cv) { id }
    }`,
    { boardId: tablero.board, name: nombreOrigen, cv: JSON.stringify(cabecera) },
  )
  const itemId = creado.create_item.id

  /* --- Las patas del pase, TODAS en una sola mutación: los débitos y después el crédito. ---
     Un subelemento por anticipo: cada uno lleva su propio importe y queda linkeado a SU anticipo.
     Agruparlos en una línea con la relación multi-valor mostraba el total pero perdía cuánto salió
     de cada saldo, que es justo lo que hay que poder auditar. */
  const origen = relacion(personaOrigenId)

  const lineas: { alias: string; nombre: string; columnas: Record<string, unknown> }[] = [
    ...debitos.map((d, i) => {
      const columnas: Record<string, unknown> = {
        [tablero.caja]: { index: tablero.debitoIndex },
        /* El débito va en la columna de lo CANCELADO: lo que sale de la cuenta origen es saldo que
           se consume, no dinero que entra. */
        [tablero.importeDebito]: round2(d.importe),
      }
      if (origen) columnas[tablero.personaOrigen] = origen
      const anticipo = relacion(d.anticipoId)
      if (anticipo) columnas[tablero.anticipo] = anticipo
      return { alias: `d${i}`, nombre: 'Debito x Pase de Saldo', columnas }
    }),
    {
      alias: 'c0',
      nombre: 'Credito x Pase de Saldo',
      /* El crédito es UNO solo, por el total: a quién se le acredita ya lo dice la cabecera, y
         repetir la persona en el subítem sería el mismo dato en dos lugares que pueden discrepar. */
      columnas: {
        [tablero.caja]: { index: tablero.creditoIndex },
        /* En la columna de lo RECIBIDO/ENTREGADO: para la cuenta destino ese saldo es algo que entra. */
        [tablero.importeCredito]: acreditado,
      },
    },
  ]

  /* La mutación se arma con un ALIAS por línea —Monday no tiene un `create_subitem` plural— y las
     variables se numeran por posición, así ningún nombre se repite dentro del documento. El orden
     en que se escriben ES el orden de creación: los campos raíz de una mutación se ejecutan en
     serie. */
  const variables: Record<string, unknown> = { parentId: itemId }
  const campos = lineas.map((linea, i) => {
    variables[`n${i}`] = linea.nombre
    variables[`c${i}`] = JSON.stringify(linea.columnas)
    return `${linea.alias}: create_subitem(parent_item_id: $parentId, item_name: $n${i}, column_values: $c${i}, create_labels_if_missing: true) { id }`
  })
  const declaraciones = lineas.map((_, i) => `$n${i}: String!, $c${i}: JSON!`).join(', ')

  await mondayApi(
    `mutation ($parentId: ID!, ${declaraciones}) { ${campos.join(' ')} }`,
    variables,
  )

  /* Con el ítem y todas sus patas ya escritas, se le pide al tablero que lo procese. Se ESPERA: si
     el pedido no entra, la automatización nunca arranca y el pase queda escrito pero sin registrar
     —y el llamador se quedaría esperando una confirmación que nadie va a dar—. */
  await pedirRegistro(itemId, tablero.registro)

  return itemId
}
