/**
 * Registro de un RECHAZO DE CHEQUE en Monday.
 *
 * El banco devolvió un cheque que un cliente había entregado y que YA se había usado —endosado a un
 * proveedor—, así que la plata vuelve a deberse por los DOS lados del mostrador a la vez:
 *
 *   · el CLIENTE vuelve a deber lo que ese cheque había cancelado, y
 *   · al PROVEEDOR se le vuelve a deber lo que ese cheque le había pagado.
 *
 * Por eso se escribe UN movimiento en cada cuenta corriente, y las dos cuentas viven en tableros
 * distintos: "💵Cta Cte Cliente" (18421858736) y "💵Cta Cte Proveedores" (18428672366). Son
 * espejos —mismos ids de columna en sus subelementos, misma fórmula de saldo— y lo único que no
 * coincide entre ellos viaja en un descriptor (`CTA_CTE_DE_ROL`), así que el procedimiento se
 * escribe UNA vez: duplicarlo habría dejado dos registros que se corrigen por separado.
 *
 * El movimiento se escribe como SUBELEMENTO de la cuenta, y arrastra el saldo: su "🤖Saldo Inicial"
 * es el "🤖Saldo Final" del último movimiento que la cuenta ya tenía. Esa fórmula
 * (`saldoInicial + suma - resta`) es la que encadena la cuenta corriente, así que un movimiento que
 * naciera en cero cortaría la cadena y dejaría todos los saldos posteriores mal.
 *
 * Son DOS solicitudes:
 *
 *   1) LECTURA — las dos cuentas y sus movimientos, en un solo documento con alias. De acá salen
 *      los ítems padre y los dos saldos de arranque.
 *   2) ESCRITURA — los dos subelementos y la marca del cheque, también en un solo documento. Los
 *      campos raíz de una mutación se ejecutan en serie, así que las tres patas viajan juntas:
 *      escribirlas por separado admitía el estado peor posible —la deuda vuelta a cargar de un
 *      solo lado—.
 *
 * Y en ESE orden: primero los movimientos y al final el cheque. Marcarlo "Rechazado" es lo que deja
 * constancia de que el papel volvió, así que hacerlo primero podría dejar un cheque marcado sin la
 * contabilidad que lo explica; al revés, unos movimientos escritos con el cheque todavía en
 * "100% Usado" se ven en el tablero y se corrigen.
 *
 * El cheque vive en "🧾Cheques/eCheq en Cartera USADOS" (18426604104) y NO en el de cartera: el
 * papel que el banco devuelve es uno que ya se usó (ver `getChequesDeCliente`).
 *
 * Sin token (modo local) no se escribe nada y se devuelven ids simulados, igual que el resto de la
 * capa de servicio.
 */
import { round2 } from '@/lib/format'
import type { RolPersona } from '@/lib/personas'
import {
  BOARDS,
  CHEQUE_CARTERA_ESTADO_INDEX,
  COL_CHEQUE_USADO,
  COL,
  MOVIMIENTO_CTA_CTE_INDEX,
} from './columns'
import { byId, num, valor, type CV } from './parse'
import { mondayApi, mondayHabilitado } from './sdk'

/** Dónde y con qué etiquetas se escribe el rechazo de CADA lado del mostrador. */
interface CuentaCorrienteDeRol {
  /** Board de la CUENTA. Sus movimientos son subelementos suyos. */
  board: number
  /** Relación a Personas: es por donde se busca la cuenta de la persona. */
  persona: string
  /** Índice de "Rechazo de Cheque" en "🤖Movimiento". NO es el mismo en los dos tableros. */
  movimientoIndex: number
  /** "🤖Origen" del subelemento: el cheque que se rechazó. Cada tablero tiene el suyo. */
  origen: string
}

const CTA_CTE_DE_ROL: Record<RolPersona, CuentaCorrienteDeRol> = {
  cliente: {
    board: BOARDS.ctaCte,
    persona: COL.ctaCte.cliente,
    movimientoIndex: MOVIMIENTO_CTA_CTE_INDEX.rechazoChequeCliente,
    /* "🤖Origen" (board_relation_mm5z1sce): acepta, entre otros, el tablero de cheques en cartera. */
    origen: 'board_relation_mm5z1sce',
  },
  proveedor: {
    board: BOARDS.ctaCteProveedores,
    /* La relación a Personas tiene el MISMO id en los dos tableros: son espejos. */
    persona: COL.ctaCte.cliente,
    movimientoIndex: MOVIMIENTO_CTA_CTE_INDEX.rechazoChequeProveedor,
    /* Su "🤖Origen" es OTRA columna (board_relation_mm6ney1g), aunque se llame igual. */
    origen: 'board_relation_mm6ney1g',
  },
}

/** Relación a un ítem de otro board, o `null` si el id no sirve (para poder OMITIR la columna). */
const relacion = (id: string | null | undefined): { item_ids: number[] } | null => {
  const n = Number(id)
  return Number.isFinite(n) && n > 0 ? { item_ids: [n] } : null
}

/**
 * Cómo se llama el movimiento en la cuenta. Es el MISMO nombre de los dos lados: el hecho es uno
 * solo —ese cheque rebotó—, y que las dos cuentas lo nombren igual es lo que permite cruzarlas.
 */
export const nombreMovimientoRechazo = (numeroCheque: string): string =>
  `Rechazo Cheque - №${numeroCheque}`

/** La cuenta de una persona y el saldo con el que viene. */
interface CuentaLeida {
  /** Ítem de la cuenta corriente: es el padre del movimiento que se va a escribir. */
  id: string
  /** "🤖Saldo Final" del ÚLTIMO movimiento. Es el "🤖Saldo Inicial" del que se está creando. */
  saldo: number
}

/** Movimientos tal como los devuelve la consulta: sólo el orden y el saldo final importan. */
interface SubitemLeido {
  id: string
  created_at: string
  column_values: CV[]
}

/**
 * El saldo con el que queda la cuenta después de su último movimiento.
 *
 * El "último" se resuelve por FECHA DE CREACIÓN y no por la posición en la respuesta: el orden en
 * que Monday devuelve los subelementos no es algo que la app pueda garantizar, y tomar el que viene
 * al final habría hecho que un reordenamiento del tablero encadenara mal la cuenta —sin fallar, y
 * sin que nadie se entere hasta auditar los saldos—. A igual fecha manda el id más alto, que es el
 * que se creó después.
 *
 * Una cuenta SIN movimientos devuelve 0: no es un faltante, es una cuenta que todavía no operó.
 */
const saldoDeCuenta = (subitems: readonly SubitemLeido[]): number => {
  if (subitems.length === 0) return 0
  const ultimo = [...subitems].sort((a, b) => {
    const orden = String(a.created_at).localeCompare(String(b.created_at))
    return orden !== 0 ? orden : Number(a.id) - Number(b.id)
  })[subitems.length - 1]
  return round2(num(valor(byId(ultimo)[COL.ctaCteSub.saldoFinal])))
}

export interface DatosRechazo {
  /** Persona que entregó el cheque: su cuenta vuelve a quedar en deuda. */
  clienteId: string
  /** Persona a la que el cheque se le había endosado: se le vuelve a deber. */
  proveedorId: string
  /** Ítem del cheque en "🧾Cheques/eCheq en Cartera USADOS". Va al "🤖Origen" de los dos movimientos. */
  chequeId: string
  /**
   * Número del cheque tal como se lo nombra en pantalla: es con lo que se nombran los movimientos.
   * Sin número cargado el llamador manda el código del ítem ("CHEQUE-07"), con el mismo criterio
   * que la tabla del paso 2: siempre hay algo con qué identificar el papel.
   */
  numeroCheque: string
  /** Importe del cheque: es lo que vuelve a deberse de los dos lados. */
  importe: number
}

/** Los dos movimientos escritos, uno por cuenta corriente. */
export interface RechazoRegistrado {
  movimientoClienteId: string
  movimientoProveedorId: string
}

/**
 * Escribe el rechazo en las dos cuentas corrientes y devuelve los ids de los dos movimientos.
 *
 * Un fallo se propaga y el llamador NO da la operación por cerrada. Que las tres escrituras viajen
 * en una sola mutación es lo que evita el desenlace peor: la deuda vuelta a cargar del lado del
 * cliente y no del proveedor, o al revés.
 */
export async function registrarRechazoDeCheque(datos: DatosRechazo): Promise<RechazoRegistrado> {
  const { clienteId, proveedorId, chequeId, numeroCheque, importe } = datos
  const monto = round2(importe)

  if (!mondayHabilitado()) {
    const marca = Date.now()
    return {
      movimientoClienteId: `mock-rechazo-cli-${marca}`,
      movimientoProveedorId: `mock-rechazo-prov-${marca}`,
    }
  }

  /* --- 1) Las dos cuentas y sus movimientos, en UN documento. ---
     El id de la persona va como NÚMERO en la regla del `board_relation`, igual que en el resto de
     la capa: entre comillas la consulta devuelve 0 ítems en vez de fallar, así que el error no se
     nota hasta que la cuenta "no existe". */
  const consulta = (alias: string, rol: RolPersona, personaId: string) => {
    const cta = CTA_CTE_DE_ROL[rol]
    return `${alias}: boards(ids: [${cta.board}]) {
      items_page(
        limit: 1,
        query_params: {rules: [
          {column_id: "${cta.persona}", compare_value: [${Number(personaId)}], operator: any_of}
        ]}
      ) {
        items {
          id
          subitems {
            id
            created_at
            column_values(ids: ["${COL.ctaCteSub.saldoFinal}"]) {
              id text
              ... on FormulaValue { display_value }
            }
          }
        }
      }
    }`
  }

  type CuentaCruda = { id: string; subitems: SubitemLeido[] | null }
  type Respuesta = Record<string, { items_page: { items: CuentaCruda[] } }[]>

  const leido = await mondayApi<Respuesta>(
    `query {
      ${consulta('cli', 'cliente', clienteId)}
      ${consulta('prov', 'proveedor', proveedorId)}
    }`,
  )

  /* Sin cuenta corriente no hay dónde escribir el movimiento, y crearla acá sería inventar una
     cuenta desde una pantalla que no es la que las administra. Se corta ANTES de escribir nada: con
     una sola de las dos cuentas se registraría media operación. */
  const cuentaDe = (alias: string, quien: string): CuentaLeida => {
    const item = leido[alias]?.[0]?.items_page.items?.[0]
    if (!item) {
      throw new Error(
        `No se encontró la cuenta corriente ${quien}. Conectala en Monday y volvé a intentar.`,
      )
    }
    return { id: item.id, saldo: saldoDeCuenta(item.subitems ?? []) }
  }

  const cuentaCliente = cuentaDe('cli', 'del cliente deudor')
  const cuentaProveedor = cuentaDe('prov', 'del proveedor acreedor')

  /* --- 2) Los dos movimientos, también en UN documento. --- */
  const nombre = nombreMovimientoRechazo(numeroCheque)
  const cheque = relacion(chequeId)

  const columnas = (rol: RolPersona, saldoInicial: number): string => {
    const cta = CTA_CTE_DE_ROL[rol]
    const cv: Record<string, unknown> = {
      [COL.ctaCteSub.movimiento]: { index: cta.movimientoIndex },
      [COL.ctaCteSub.saldoInicial]: saldoInicial,
      /* El importe va en la columna que SUMA al saldo, de los dos lados: para el cliente es deuda
         que revive y para el proveedor es saldo que se le vuelve a deber. Es el mismo signo porque
         cada cuenta mira su propio lado del mostrador. */
      [COL.ctaCteSub.suma]: monto,
    }
    if (cheque) cv[cta.origen] = cheque
    return JSON.stringify(cv)
  }

  /* `create_labels_if_missing` en false a propósito: la etiqueta "Rechazo de Cheque" YA existe en
     los dos tableros y su índice está verificado (ver `MOVIMIENTO_CTA_CTE_INDEX`). Con la creación
     habilitada, un índice equivocado se convertiría en una etiqueta nueva en vez de fallar, y el
     tablero terminaría con dos rótulos parecidos que nadie pidió.

     La tercera pata marca el CHEQUE como "Rechazado" en el tablero de USADOS. Va por ÍNDICE, como
     toda columna status de la app: un cambio de rótulo en Monday no puede desviar la escritura a
     otro estado. Y va ÚLTIMA, después de los dos movimientos: ver el encabezado del módulo. */
  const escrito = await mondayApi<{ cli: { id: string }; prov: { id: string } }>(
    `mutation ($padreCli: ID!, $padreProv: ID!, $nombre: String!, $cvCli: JSON!, $cvProv: JSON!, $cheque: ID!, $estado: JSON!) {
      cli: create_subitem(parent_item_id: $padreCli, item_name: $nombre, column_values: $cvCli, create_labels_if_missing: false) { id }
      prov: create_subitem(parent_item_id: $padreProv, item_name: $nombre, column_values: $cvProv, create_labels_if_missing: false) { id }
      marca: change_multiple_column_values(item_id: $cheque, board_id: ${BOARDS.chequesUsados}, column_values: $estado) { id }
    }`,
    {
      padreCli: cuentaCliente.id,
      padreProv: cuentaProveedor.id,
      nombre,
      cvCli: columnas('cliente', cuentaCliente.saldo),
      cvProv: columnas('proveedor', cuentaProveedor.saldo),
      cheque: chequeId,
      estado: JSON.stringify({
        [COL_CHEQUE_USADO.estado]: { index: CHEQUE_CARTERA_ESTADO_INDEX.rechazado },
      }),
    },
  )

  return { movimientoClienteId: escrito.cli.id, movimientoProveedorId: escrito.prov.id }
}
