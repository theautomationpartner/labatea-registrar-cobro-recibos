import { hoy } from '@/lib/dates'
import { totalACancelar, totalAplicado } from '@/lib/cobros'
import { round2 } from '@/lib/format'
import { indiceDePaso } from '@/lib/pasos'
import type {
  AnticipoPendiente,
  Cliente,
  OperacionApp,
  CobroState,
  Contacto,
  EmisionRecibo,
  FacturaPendiente,
  LogEntry,
  MedioEnvio,
  MovimientoPago,
  Paso,
  SaldosCliente,
  TipoOperacion,
  Usuario,
  UsuarioActual,
} from '@/types'

export interface AppState {
  /**
   * Módulo elegido en el encabezado. "Pagos" sólo lo puede elegir un administrador (ver
   * `puedeOperarPagos`), y hoy no tiene circuito propio: la app opera "Cobros".
   */
  operacionApp: OperacionApp
  /** Etapa en pantalla. La app arranca en la selección de cliente: no hay paso previo. */
  paso: Paso
  /**
   * Qué se está registrando (cobro, anticipo o aplicación de anticipo). Es lo que RAMIFICA el
   * recorrido —ver `lib/pasos`— y el tipo con el que nace el recibo en Monday. null = el usuario
   * todavía no lo eligió, y por eso no se lo deja salir del paso 1.
   */
  tipoOperacion: TipoOperacion | null
  /**
   * Sólo ANTICIPO: el importe que el cliente entrega a cuenta. Ocupa el lugar que en el cobro tiene
   * la suma de lo imputado a las facturas: es el TOTAL A CANCELAR que las formas de pago tienen que
   * igualar, y el que va al subelemento "Anticipo" del recibo.
   */
  importeAnticipo: number
  /** Anticipo: por qué se registra. Lo escribe el usuario y viaja al recibo. */
  detalleAnticipo: string
  /** Anticipo: fecha de vencimiento, en dd/MM/yyyy (el formato del ERP). */
  vencimientoAnticipo: string
  /**
   * Índice del paso MÁS AVANZADO alcanzado en la operación en curso: hasta ahí se puede navegar
   * con el stepper (los pasos futuros quedan bloqueados). Se reinicia al empezar una operación nueva.
   */
  pasoMaxIdx: number
  /** Usuario responsable del cobro. Por defecto, el logueado en Monday. */
  usuario: Usuario | null
  /** Cliente al que se le registra el cobro. null = todavía no se buscó/confirmó ninguno. */
  cliente: Cliente | null
  /**
   * Saldos de la cuenta corriente del cliente (pendiente de cancelar y anticipos), que muestra la
   * ficha del paso 1. `null` = todavía no se leyeron: la ficha deja esas dos cajas en skeleton.
   */
  saldos: SaldosCliente | null
  /** De QUÉ cliente son los saldos. Misma clave de caché que `facturasClienteId`. */
  saldosClienteId: string | null
  /** Facturas pendientes del cliente, leídas al entrar al paso 2. */
  facturas: FacturaPendiente[]
  /**
   * De QUÉ cliente son las facturas que están en `facturas`. Es la clave de caché del paso 2: si
   * coincide con el cliente en curso, la lista ya se leyó y no se vuelve a consultar a Monday por
   * navegar entre etapas. `null` = no hay nada leído todavía (o la última lectura falló, así que
   * hay que reintentarla).
   */
  facturasClienteId: string | null
  /** Sólo APLICACIÓN: anticipos con saldo a favor del cliente, leídos al entrar al paso 3. */
  anticipos: AnticipoPendiente[]
  /** De QUÉ cliente son los anticipos de `anticipos`. Misma clave de caché que `facturasClienteId`. */
  anticiposClienteId: string | null
  /**
   * Sólo PASES DE SALDO: `id de anticipo del ORIGEN → importe que se pasa de él`. Un pase puede
   * juntar el saldo de VARIOS anticipos, y su suma es lo que se debita de la cuenta origen.
   *
   * Misma forma que `aplicaciones`: que la CLAVE exista es lo que marca el anticipo como elegido,
   * así no hay dos fuentes de verdad —una lista de elegidos y un mapa de importes— que puedan
   * quedar desincronizadas. Vacío = todavía no se eligió ninguno, y por eso no se sale del paso 2.
   */
  pasesDeAnticipo: Record<string, number>
  /**
   * Sólo PASES DE SALDO: cuánto de ese anticipo se mueve. Nace en su saldo COMPLETO —el caso
   * habitual— y queda editable para pasar menos. Nunca supera el pendiente del anticipo: el tope lo
   * impone el reducer, así que tipear de más devuelve el máximo en vez de aceptarlo.
   */

  /**
   * Sólo PASES DE SALDO: el cliente que RECIBE el saldo. Es un `Cliente` del tablero de Personas y
   * no una cuenta corriente, igual que el origen del paso 1: se busca con el mismo buscador y se
   * muestra con la misma ficha, así que las dos puntas del pase se eligen de la misma manera.
   *
   * `null` = todavía no se buscó.
   */
  clienteDestino: Cliente | null
  /**
   * Saldos de cuenta corriente del cliente destino, leídos de su ítem de Cta Cte. Viven aparte del
   * cliente porque salen de OTRO tablero y llegan después: la ficha se dibuja con el cliente y
   * completa sus cajas cuando la consulta resuelve.
   */
  saldosDestino: SaldosCliente | null
  /** De qué cliente son esos saldos. Es la clave de caché: sin ella se re-consultaría en cada render. */
  saldosDestinoId: string | null
  /**
   * Sólo APLICACIÓN: `id de anticipo → importe aplicado`. Misma forma que `imputaciones`: que la
   * CLAVE exista es lo que marca el anticipo como elegido, así no hay dos fuentes de verdad.
   */
  aplicaciones: Record<string, number>
  /**
   * Importe a cancelar por factura: `id de factura → importe`. Que la CLAVE exista es lo que
   * marca la factura como seleccionada, así no hay dos fuentes de verdad (una lista de elegidas
   * y un mapa de importes) que puedan quedar desincronizadas.
   */
  imputaciones: Record<string, number>
  /** Movimientos con los que el cliente paga lo imputado. Es lo que se registra en el paso 3. */
  cobro: CobroState
  /** ID del recibo ya emitido en "➡️Recibos y Cobros". null = todavía no se emitió. */
  reciboId: string | null
  /**
   * En qué anda la emisión de ESE recibo. Es una bandera global —y no el estado local del hook que
   * la conduce— por el mismo motivo que `documentoEnviado`: tiene que sobrevivir a la navegación.
   * Al volver a la etapa el botón sigue en "Emitido correctamente" en vez de reofrecer una emisión
   * que duplicaría el ítem del tablero.
   */
  emision: EmisionRecibo
  /** Canal por el que se envía el recibo al cliente. */
  medioEnvio: MedioEnvio
  /** Destinatarios elegidos. Vive en el estado global para sobrevivir a la navegación del stepper. */
  contactos: Contacto[]
  /**
   * El recibo YA se envió. Es una bandera global —y no un estado local del componente— porque tiene
   * que sobrevivir a la navegación: al volver a la etapa, el botón sigue bloqueado y en verde, y no
   * se puede disparar un segundo envío.
   */
  documentoEnviado: boolean
  /** Resultado del último envío, para mostrarlo como registro. */
  log: LogEntry[]
  /** Usuarios de los equipos "Vendedores" y "Administradores", leídos al iniciar la app. */
  usuarios: Usuario[]
  /** La consulta de usuarios está en curso: el selector se muestra deshabilitado. */
  usuariosCargando: boolean
  /** Usuario logueado en Monday: responsable por defecto y permisos del selector. null = sin sesión. */
  usuarioActual: UsuarioActual | null
  /**
   * Fallo de la API de Monday: qué se estaba intentando hacer ("obtener los usuarios"). Lo despacha
   * el `catch` de cualquier consulta o mutación y lo consume `ModalErrorMonday`, la ÚNICA forma en
   * que la app comunica estos errores. null = sin error pendiente.
   */
  errorMonday: string | null
}

/** Emisión sin empezar: es el punto de partida y el estado al que vuelve cada reinicio. */
const EMISION_INICIAL: EmisionRecibo = { fase: 'idle', estado: '', error: null }

/** Cobro en blanco: sin movimientos y fechado en el día en que se opera. */
const cobroVacio = (): CobroState => ({ fecha: hoy(), movimientos: [], confirmado: false })

export const initialState: AppState = {
  operacionApp: 'COBROS',
  paso: 'cliente',
  /* Nada viene preseleccionado: qué se registra lo decide el usuario en el paso 1. */
  tipoOperacion: null,
  importeAnticipo: 0,
  detalleAnticipo: '',
  vencimientoAnticipo: '',
  pasoMaxIdx: 0,
  usuario: null,
  cliente: null,
  saldos: null,
  saldosClienteId: null,
  facturas: [],
  facturasClienteId: null,
  imputaciones: {},
  anticipos: [],
  anticiposClienteId: null,
  pasesDeAnticipo: {},
  clienteDestino: null,
  saldosDestino: null,
  saldosDestinoId: null,
  aplicaciones: {},
  cobro: cobroVacio(),
  reciboId: null,
  emision: EMISION_INICIAL,
  medioEnvio: 'Email',
  contactos: [],
  documentoEnviado: false,
  log: [],
  usuarios: [],
  /* Arranca en `true`: la consulta sale al montar la app, así el selector nace "Cargando…" en vez
     de mostrarse vacío por un instante y recién después llenarse. */
  usuariosCargando: true,
  usuarioActual: null,
  errorMonday: null,
}

/**
 * ¿Hay una operación EN CURSO cuyo trabajo se perdería al cambiar de módulo?
 *
 * Se mira el CLIENTE y no los datos de cada circuito a propósito: es lo primero que se carga en
 * todos los módulos —los de hoy y los que se sumen— y desde ahí en adelante todo lo cargado
 * cuelga de él. Una regla escrita sobre él no se queda corta cuando aparezca un circuito nuevo con
 * campos propios; enumerar los datos de cada módulo obligaría a acordarse de volver acá a sumarlos,
 * y la vez que alguien se olvide el usuario pierde su carga sin aviso.
 *
 * Con la operación YA terminada no hay nada que proteger: lo que queda en pantalla es el comprobante
 * de algo que ya se escribió en Monday, no trabajo a medio hacer.
 */
export const hayOperacionEnCurso = (state: AppState): boolean =>
  state.cliente !== null && state.reciboId === null

export type Action =
  | { type: 'setOperacionApp'; operacion: OperacionApp }
  | { type: 'goto'; paso: Paso }
  | { type: 'setTipoOperacion'; tipo: TipoOperacion }
  | { type: 'setImporteAnticipo'; importe: number }
  | { type: 'setDetalleAnticipo'; detalle: string }
  | { type: 'setVencimientoAnticipo'; vencimiento: string }
  | { type: 'setUsuario'; usuario: Usuario }
  | { type: 'setCliente'; cliente: Cliente }
  /** `clienteId`: misma clave de caché que en `setFacturas`, con el mismo `null` ante un fallo. */
  | { type: 'setSaldos'; saldos: SaldosCliente | null; clienteId: string | null }
  /**
   * `clienteId` es de QUIÉN son las facturas que llegaron: queda como clave de caché para no
   * volver a pedirlas al navegar. Va en `null` cuando la lectura FALLÓ —la lista se vacía pero sin
   * darla por leída—, así el próximo ingreso al paso reintenta en vez de mostrar cero facturas
   * para siempre.
   */
  | { type: 'setFacturas'; facturas: FacturaPendiente[]; clienteId: string | null }
  | { type: 'toggleFactura'; factura: FacturaPendiente }
  | { type: 'setImporteFactura'; id: string; importe: number }
  /** `clienteId`: misma clave de caché que en `setFacturas`, con el mismo `null` ante un fallo. */
  | { type: 'setAnticipos'; anticipos: AnticipoPendiente[]; clienteId: string | null }
  | { type: 'toggleAnticipo'; anticipo: AnticipoPendiente }
  /* PASES DE SALDO. Elegir el anticipo de origen, la cuenta destino y qué se hace con el saldo. */
  | { type: 'toggleAnticipoPase'; anticipo: AnticipoPendiente }
  | { type: 'setImportePase'; id: string; importe: number }
  | { type: 'setClienteDestino'; cliente: Cliente | null }
  | { type: 'setSaldosDestino'; saldos: SaldosCliente | null; clienteId: string | null }
  | { type: 'setImporteAnticipoAplicado'; id: string; importe: number }
  | { type: 'agregarMovimientoPago'; movimiento: Omit<MovimientoPago, 'id'> }
  | { type: 'removeMovimientoPago'; id: string }
  | { type: 'setMovimientoImporte'; id: string; importe: number }
  | { type: 'confirmarCobro' }
  | { type: 'setReciboId'; id: string }
  /**
   * Avance de la emisión. Llega como PARCHE porque cada transición mueve sólo lo que cambió —la
   * fase, la etiqueta del tablero o el error—, y pisar el resto con `undefined` borraría lo que la
   * pantalla todavía tiene que mostrar.
   */
  | { type: 'setEmision'; emision: Partial<EmisionRecibo> }
  | { type: 'setMedioEnvio'; value: MedioEnvio }
  | { type: 'setContactos'; contactos: Contacto[] }
  | { type: 'addContacto'; contacto: Contacto }
  | { type: 'removeContacto'; id: string }
  | { type: 'setDocumentoEnviado'; value: boolean }
  | { type: 'setLog'; entries: LogEntry[] }
  | { type: 'setUsuarios'; usuarios: Usuario[] }
  | { type: 'setUsuarioActual'; usuario: UsuarioActual | null }
  | { type: 'errorMonday'; accion: string }
  | { type: 'limpiarErrorMonday' }
  | { type: 'reset' }

/**
 * Recorrido que le corresponde a un MÓDULO. Es la unica fuente de esa relacion, y por eso existe
 * como funcion en vez de repetirse donde hace falta.
 *
 *   · PASES tiene un recorrido ÚNICO —no pregunta que se cobra—, asi que el modulo lo fija.
 *   · COBROS lo deja SIN elegir: es lo que hace que el paso 1 lo reclame.
 *
 * Lo consultan los dos lugares que dejan la app a foja cero: cambiar de modulo y cerrar una
 * operacion. Escrito dos veces, uno de los dos se olvidaba —y de hecho pasaba: al finalizar un pase
 * el modulo seguia siendo PASES pero el recorrido volvia a `null`, asi que la app mostraba las
 * etapas de Cobros dentro del modulo de Pases—.
 */
const recorridoDe = (operacion: OperacionApp): TipoOperacion | null =>
  operacion === 'PASES' ? 'pases' : null

/**
 * Responsable por defecto: el usuario de la lista que coincide con el logueado (mismo id de
 * Monday), si está. Puede llegar en cualquier orden —la lista y la sesión se piden en paralelo—,
 * así que lo resuelven las DOS acciones, y siempre sin pisar una elección ya hecha por el usuario.
 */
const usuarioPorDefecto = (usuarios: Usuario[], sesion: UsuarioActual | null): Usuario | null =>
  sesion ? usuarios.find((u) => u.id === sesion.id) ?? null : null

/** Id local de un movimiento de cobro. Sólo vive en el navegador: Monday asigna el suyo al escribir. */
const nuevoId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `mov-${Math.random().toString(36).slice(2)}`

/**
 * Reabre el cobro: cambió algo que mueve el total a cancelar o lo recibido, así que la confirmación
 * ya no vale. Los movimientos NO se tocan —el usuario los ajusta—, sólo se le vuelve a exigir que
 * la diferencia cierre antes de avanzar.
 */
const reabrirCobro = (cobro: CobroState): CobroState =>
  cobro.confirmado ? { ...cobro, confirmado: false } : cobro

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'goto': {
      /* Al ir a un paso se recuerda el índice MÁS AVANZADO alcanzado: volver atrás no lo baja, así
         el stepper deja volver a saltar hacia adelante a las etapas ya completadas. El índice es el
         de ESTE recorrido: el del anticipo tiene una etapa menos que el del cobro. */
      const idx = indiceDePaso(action.paso, state.tipoOperacion)
      return { ...state, paso: action.paso, pasoMaxIdx: Math.max(state.pasoMaxIdx, idx) }
    }

    /* Qué se registra. Cambiarlo cambia el RECORRIDO entero, así que se descarta todo lo que se
       hubiera armado con el anterior —facturas, imputación, cobro, recibo y su envío— y el avance
       vuelve al paso 1: lo cargado para un cobro contra facturas no tiene dónde impactar en un
       anticipo, y al revés. Reelegir lo MISMO no toca nada. */
    case 'setTipoOperacion':
      if (state.tipoOperacion === action.tipo) return state
      return {
        ...state,
        tipoOperacion: action.tipo,
        pasoMaxIdx: 0,
        importeAnticipo: 0,
        detalleAnticipo: '',
        vencimientoAnticipo: '',
        /* Las listas se descartan CON su clave de caché: dejarla puesta sobre una lista vacía haría
           que el paso la diera por leída y no volviera a consultar a Monday nunca. */
        saldos: null,
        saldosClienteId: null,
        facturas: [],
        facturasClienteId: null,
        imputaciones: {},
        anticipos: [],
        anticiposClienteId: null,
        aplicaciones: {},
        pasesDeAnticipo: {},
        clienteDestino: null,
        saldosDestino: null,
        saldosDestinoId: null,
              cobro: cobroVacio(),
        reciboId: null,
        emision: EMISION_INICIAL,
        contactos: [],
        documentoEnviado: false,
        log: [],
      }

    /* Importe del anticipo. Es el TOTAL A CANCELAR de ese recorrido, así que moverlo reabre el
       cobro igual que lo hace cambiar una imputación. No se topea contra nada: el anticipo es lo
       que el cliente decida entregar. */
    case 'setImporteAnticipo':
      return {
        ...state,
        importeAnticipo: round2(Math.max(action.importe, 0)),
        cobro: reabrirCobro(state.cobro),
      }

    /* Detalle y vencimiento NO reabren el cobro: no mueven el total a cancelar, así que no pueden
       desbalancear lo que ya se registró. Son datos del anticipo, no de su cuenta. */
    case 'setDetalleAnticipo':
      return { ...state, detalleAnticipo: action.detalle }

    case 'setVencimientoAnticipo':
      return { ...state, vencimientoAnticipo: action.vencimiento }

    /* Módulo del encabezado. No reinicia nada: hoy "Pagos" no tiene circuito, así que cambiarlo no
       descarta la cobranza en curso. */
    /* Cambio de MÓDULO. Cobros y Pagos son operaciones independientes: no comparten etapas ni
       pantallas, así que tampoco pueden compartir estado de trabajo. Se vuelve a foja cero —igual
       que en `reset`— y sólo sobreviven los datos de SESIÓN (los usuarios y el logueado), que son
       de la app y no del circuito.

       Sin esto, ir a Pagos y volver reencontraría al usuario con el cobro a medio cargar de antes,
       como si nunca hubiera cambiado de módulo. Reelegir el MISMO módulo no toca nada: no es un
       cambio, y descartar lo cargado sería destruir trabajo por un click sin consecuencias. */
    case 'setOperacionApp':
      if (state.operacionApp === action.operacion) return state
      return {
        ...initialState,
        operacionApp: action.operacion,
        tipoOperacion: recorridoDe(action.operacion),
        /* Cobro nuevo, no el que quedó armado al cargar el módulo: si la pestaña quedó abierta de
           un día para el otro, la fecha del cobro tiene que ser la de HOY. */
        cobro: cobroVacio(),
        usuarios: state.usuarios,
        usuariosCargando: state.usuariosCargando,
        usuarioActual: state.usuarioActual,
        usuario: usuarioPorDefecto(state.usuarios, state.usuarioActual),
      }

    case 'setUsuario':
      return { ...state, usuario: action.usuario }

    /* Cliente elegido en el paso 1. Cambiarlo invalida todo lo que se haya alcanzado después: las
       facturas y su imputación son de ESE cliente, así que se descartan junto con el avance
       navegable, en vez de dejar etapas accesibles armadas con los datos del cliente anterior. */
    case 'setCliente':
      if (state.cliente?.id === action.cliente.id) return { ...state, cliente: action.cliente }
      return {
        ...state,
        cliente: action.cliente,
        pasoMaxIdx: indiceDePaso('cliente'),
        /* Los saldos y las dos listas se descartan CON su clave de caché: son del cliente anterior,
           así que hay que volver a leerlos —no alcanza con vaciarlos, o el paso los daría por ya
           leídos—. */
        saldos: null,
        saldosClienteId: null,
        facturas: [],
        facturasClienteId: null,
        imputaciones: {},
        anticipos: [],
        anticiposClienteId: null,
        aplicaciones: {},
        /* El pase es del anticipo de ESE cliente: cambiarlo deja sin sentido las tres decisiones. */
        pasesDeAnticipo: {},
        clienteDestino: null,
        saldosDestino: null,
        saldosDestinoId: null,
              /* El cobro es de ESE cliente: sus cheques, sus retenciones y sus tarjetas no tienen
           sentido para otro, así que se descarta entero junto con la imputación. */
        cobro: cobroVacio(),
        /* El recibo y su envío también: el documento emitido era del cliente anterior, y sus
           destinatarios son los contactos de ESE cliente. */
        reciboId: null,
        emision: EMISION_INICIAL,
        contactos: [],
        documentoEnviado: false,
        log: [],
      }

    /* Llegaron los saldos de la cuenta corriente del cliente. Van al estado global —y no al estado
       local de la ficha— para que sobrevivan a la navegación del stepper: volver al paso 1 no tiene
       que disparar otra consulta. */
    case 'setSaldos':
      return { ...state, saldos: action.saldos, saldosClienteId: action.clienteId }

    /* Llegaron las facturas del cliente. Las imputaciones ya hechas se conservan SÓLO si su factura
       sigue estando: al recargar puede haberse cobrado alguna desde otro lado, y un importe
       imputado a una factura que ya no figura no tendría dónde impactar. */
    case 'setFacturas': {
      const vigentes = new Set(action.facturas.map((f) => f.id))
      const imputaciones = Object.fromEntries(
        Object.entries(state.imputaciones).filter(([id]) => vigentes.has(id)),
      )
      return {
        ...state,
        facturas: action.facturas,
        facturasClienteId: action.clienteId,
        imputaciones,
      }
    }

    /* Marcar/desmarcar una factura. Al marcarla se propone cancelarla ENTERA: el importe nace en su
       saldo pendiente, que es el caso habitual de una cobranza, y queda editable para imputar menos.
       Al desmarcarla se borra la clave: la selección y el importe son el mismo dato. */
    case 'toggleFactura': {
      const { [action.factura.id]: actual, ...resto } = state.imputaciones
      const cobro = reabrirCobro(state.cobro)
      if (actual !== undefined) return { ...state, imputaciones: resto, cobro }
      return {
        ...state,
        imputaciones: { ...state.imputaciones, [action.factura.id]: action.factura.pendiente },
        cobro,
      }
    }

    /* Importe a cancelar de una factura ya seleccionada. NO se topea contra el saldo: pasarse es un
       error que se le muestra al usuario (borde rojo en el input y bloqueo al continuar), no algo
       que la app corrija por su cuenta cambiándole el número que acaba de escribir. */
    case 'setImporteFactura': {
      if (!(action.id in state.imputaciones)) return state
      const importe = round2(Math.max(action.importe, 0))
      return {
        ...state,
        imputaciones: { ...state.imputaciones, [action.id]: importe },
        cobro: reabrirCobro(state.cobro),
      }
    }

    /* Llegaron los anticipos del cliente. Lo ya aplicado se conserva SÓLO si su anticipo sigue
       estando: al recargar puede haberse consumido desde otro lado, y un importe aplicado a un
       anticipo que ya no figura no tendría de dónde salir. */
    case 'setAnticipos': {
      const vigentes = new Set(action.anticipos.map((a) => a.id))
      const aplicaciones = Object.fromEntries(
        Object.entries(state.aplicaciones).filter(([id]) => vigentes.has(id)),
      )
      return {
        ...state,
        anticipos: action.anticipos,
        anticiposClienteId: action.clienteId,
        aplicaciones,
      }
    }

    /* Marcar/desmarcar un anticipo. Al marcarlo se propone aplicar TODO su saldo pendiente —el caso
       habitual— acotado a lo que todavía falta cubrir, y queda editable para aplicar menos.
       DESMARCAR siempre se puede: es la salida para corregir. */
    case 'toggleAnticipo': {
      const { [action.anticipo.id]: actual, ...resto } = state.aplicaciones
      if (actual !== undefined) return { ...state, aplicaciones: resto }

      /* Con el total ya cubierto no se suma otro anticipo: aplicarlo dejaría la diferencia en
         negativo, que es exactamente lo que este paso no permite emitir. El tope se impone acá
         además de en la casilla, para que la regla no dependa de la pantalla. */
      const falta = round2(totalACancelar(state.imputaciones) - totalAplicado(state.aplicaciones))
      if (falta <= 0) return state

      return {
        ...state,
        aplicaciones: {
          ...state.aplicaciones,
          /* Se propone lo que falta, no todo el saldo: con un anticipo más grande que la deuda,
             proponer su total dejaría la diferencia en negativo desde el primer click. */
          [action.anticipo.id]: Math.min(action.anticipo.pendiente, falta),
        },
      }
    }

    /* Importe aplicado de un anticipo ya elegido. NO se topea contra su pendiente, igual que en un
       pase (`setImportePase`): pasarse es un error que se le MUESTRA al usuario —borde rojo en el
       campo y bloqueo al avanzar, con el máximo nombrado—, no algo que la app corrija por su cuenta
       cambiándole el número que acaba de escribir.

       Recortarlo en silencio tenía dos costos: el usuario veía otro importe del que tipeó sin
       enterarse de por qué, y la validación "el importe supera el saldo del anticipo" quedaba muerta
       —nunca podía dispararse—. Sólo se sigue descartando el negativo: no es un importe. */
    case 'setImporteAnticipoAplicado': {
      if (!(action.id in state.aplicaciones)) return state
      const importe = round2(Math.max(action.importe, 0))
      return { ...state, aplicaciones: { ...state.aplicaciones, [action.id]: importe } }
    }

    /* Un pago cargado en el formulario del paso 3. Llega ya validado —el formulario no deja
       agregar un movimiento incompleto—, así que acá sólo se le pone el id y se reabre el cobro. */
    /* Marcar/desmarcar un anticipo del ORIGEN. Un pase puede juntar el saldo de VARIOS: la clave
       existe = el anticipo está elegido, y su valor es cuánto se pasa de él —misma forma que
       `aplicaciones`, así que no hay dos fuentes de verdad—. Al marcarlo se propone mover su saldo
       ENTERO, que es el caso habitual, y queda editable para pasar menos.

       El DESTINO no se toca: es una decisión propia —a qué cuenta va el saldo—, y ajustar cuánto se
       mueve no la invalida. Antes se borraba acá, así que volver un paso a corregir el importe
       obligaba a buscar de nuevo la cuenta que ya se había elegido. Se retiene igual que el cliente
       ORIGEN: lo único que lo descarta es elegir OTRA cuenta (`setClienteDestino`) o cambiar el
       cliente de la operación.

       Tampoco se baja `pasoMaxIdx`: era lo que impedía volver al destino con el stepper. Que la
       selección quede vacía lo frena el propio paso 3, que revisa el origen antes de dejar cerrar. */
    case 'toggleAnticipoPase': {
      const { [action.anticipo.id]: actual, ...resto } = state.pasesDeAnticipo
      const pasesDeAnticipo =
        actual !== undefined
          ? resto
          : { ...state.pasesDeAnticipo, [action.anticipo.id]: action.anticipo.pendiente }
      return { ...state, pasesDeAnticipo }
    }

    /* Cuánto se mueve de UN anticipo ya elegido. NO se topea contra su pendiente: pasarse es un
       error que se le MUESTRA al usuario —borde rojo y mensaje bajo el campo, y bloqueo al
       avanzar—, no algo que la app corrija por su cuenta cambiándole el número que acaba de
       escribir. Es el mismo criterio que el importe a cancelar de una factura.

       Lo único que sí se acota es el signo: un importe negativo no es un dato a validar, es un
       valor que no puede existir en esta columna. */
    case 'setImportePase': {
      if (!(action.id in state.pasesDeAnticipo)) return state
      return {
        ...state,
        pasesDeAnticipo: {
          ...state.pasesDeAnticipo,
          [action.id]: round2(Math.max(action.importe, 0)),
        },
      }
    }

    /* Cliente DESTINO. Cambiarlo descarta la acción, sus saldos y las facturas leídas: eran del
       cliente anterior, y aplicar un saldo contra la deuda de otro sería lo peor que podría pasar
       acá. Reelegir el mismo no toca nada. */
    case 'setClienteDestino':
      if (state.clienteDestino?.id === action.cliente?.id) return state
      return {
        ...state,
        clienteDestino: action.cliente,
        saldosDestino: null,
        saldosDestinoId: null,
              facturas: [],
        facturasClienteId: null,
        imputaciones: {},
      }

    /* Saldos de Cta Cte del destino. Llegan solos, después del cliente: sólo rellenan sus cajas. */
    case 'setSaldosDestino':
      return { ...state, saldosDestino: action.saldos, saldosDestinoId: action.clienteId }


    case 'agregarMovimientoPago':
      return {
        ...state,
        cobro: {
          ...state.cobro,
          confirmado: false,
          movimientos: [...state.cobro.movimientos, { ...action.movimiento, id: nuevoId() }],
        },
      }

    case 'removeMovimientoPago':
      return {
        ...state,
        cobro: {
          ...state.cobro,
          confirmado: false,
          movimientos: state.cobro.movimientos.filter((m) => m.id !== action.id),
        },
      }

    /* Editar el importe de un pago ya cargado: es la forma de llevar la DIFERENCIA a 0 sin quitar
       el movimiento. Igual que agregar o quitar, reabre la confirmación. El importe no se topea
       contra el total: pasarse es un error que se le muestra al usuario, no algo que la app
       corrija cambiándole el número que acaba de escribir. */
    case 'setMovimientoImporte':
      return {
        ...state,
        cobro: {
          ...state.cobro,
          confirmado: false,
          movimientos: state.cobro.movimientos.map((m) =>
            m.id === action.id ? { ...m, importe: round2(Math.max(action.importe, 0)) } : m,
          ),
        },
      }

    /* El cobro quedó registrado. Se despacha al avanzar de etapa, recién cuando la diferencia está
       en cero: no hay un botón aparte de "confirmar". */
    case 'confirmarCobro':
      return { ...state, cobro: { ...state.cobro, confirmado: true } }

    /* Llegaron los usuarios: se guardan y el selector deja de estar "Cargando…". Si todavía no hay
       responsable elegido, queda el que corresponde a la sesión. */
    /* El recibo quedó escrito en el tablero: su id es de donde se despacha el envío. */
    case 'setReciboId':
      return { ...state, reciboId: action.id }

    /* Avance de la emisión, tal como lo va reportando `useEmisionRecibo`. */
    case 'setEmision':
      return { ...state, emision: { ...state.emision, ...action.emision } }

    case 'setMedioEnvio':
      return { ...state, medioEnvio: action.value }

    case 'setContactos':
      return { ...state, contactos: action.contactos }

    /* Un contacto se agrega UNA sola vez: el picker ya no reofrece los elegidos, y esto cubre
       cualquier otra vía de agregado. */
    case 'addContacto':
      return state.contactos.some((c) => c.id === action.contacto.id)
        ? state
        : { ...state, contactos: [...state.contactos, action.contacto] }

    case 'removeContacto':
      return { ...state, contactos: state.contactos.filter((c) => c.id !== action.id) }

    case 'setDocumentoEnviado':
      return { ...state, documentoEnviado: action.value }

    case 'setLog':
      return { ...state, log: action.entries }

    case 'setUsuarios':
      return {
        ...state,
        usuarios: action.usuarios,
        usuariosCargando: false,
        usuario: state.usuario ?? usuarioPorDefecto(action.usuarios, state.usuarioActual),
      }

    case 'setUsuarioActual':
      return {
        ...state,
        usuarioActual: action.usuario,
        usuario: state.usuario ?? usuarioPorDefecto(state.usuarios, action.usuario),
      }

    case 'errorMonday':
      return { ...state, errorMonday: action.accion }

    case 'limpiarErrorMonday':
      return { ...state, errorMonday: null }

    /* Nueva operación desde cero. Los usuarios y la sesión NO se vuelven a pedir: se leen una sola
       vez al iniciar la app, así que se conservan y el responsable vuelve al de la sesión. */
    case 'reset':
      return {
        ...initialState,
        /* El módulo es del ENCABEZADO, no de la operación: cerrar una cobranza no cambia en qué
           circuito está parado el usuario. */
        operacionApp: state.operacionApp,
        /* Y con el módulo viaja SU recorrido. `initialState` trae el de Cobros, asi que sin esto
           cerrar un pase dejaba el encabezado en "Pases de Saldo" y el cuerpo con las etapas de
           Cobros: el stepper de cuatro pasos y el selector de "¿Qué vas a cobrar?" adentro de un
           modulo que no pregunta eso. */
        tipoOperacion: recorridoDe(state.operacionApp),
        /* Cobro nuevo, no el que quedó armado al cargar el módulo: si la pestaña quedó abierta de
           un día para el otro, la fecha del cobro tiene que ser la de HOY. */
        cobro: cobroVacio(),
        usuarios: state.usuarios,
        usuariosCargando: state.usuariosCargando,
        usuarioActual: state.usuarioActual,
        usuario: usuarioPorDefecto(state.usuarios, state.usuarioActual),
      }

    default:
      return state
  }
}
