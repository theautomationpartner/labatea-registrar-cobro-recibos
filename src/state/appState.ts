import { hoy } from '@/lib/dates'
import { round2 } from '@/lib/format'
import { indiceDePaso } from '@/lib/pasos'
import type {
  Cliente,
  CobroState,
  Contacto,
  FacturaPendiente,
  LogEntry,
  MedioEnvio,
  MovimientoPago,
  Paso,
  Usuario,
  UsuarioActual,
} from '@/types'

export interface AppState {
  /** Etapa en pantalla. La app arranca en la selección de cliente: no hay paso previo. */
  paso: Paso
  /**
   * Índice del paso MÁS AVANZADO alcanzado en la operación en curso: hasta ahí se puede navegar
   * con el stepper (los pasos futuros quedan bloqueados). Se reinicia al empezar una operación nueva.
   */
  pasoMaxIdx: number
  /** Usuario responsable del cobro. Por defecto, el logueado en Monday. */
  usuario: Usuario | null
  /** Cliente al que se le registra el cobro. null = todavía no se buscó/confirmó ninguno. */
  cliente: Cliente | null
  /** Facturas pendientes del cliente, leídas al entrar al paso 2. */
  facturas: FacturaPendiente[]
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

/** Cobro en blanco: sin movimientos y fechado en el día en que se opera. */
const cobroVacio = (): CobroState => ({ fecha: hoy(), movimientos: [], confirmado: false })

export const initialState: AppState = {
  paso: 'cliente',
  pasoMaxIdx: 0,
  usuario: null,
  cliente: null,
  facturas: [],
  imputaciones: {},
  cobro: cobroVacio(),
  reciboId: null,
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

export type Action =
  | { type: 'goto'; paso: Paso }
  | { type: 'setUsuario'; usuario: Usuario }
  | { type: 'setCliente'; cliente: Cliente }
  | { type: 'setFacturas'; facturas: FacturaPendiente[] }
  | { type: 'toggleFactura'; factura: FacturaPendiente }
  | { type: 'setImporteFactura'; id: string; importe: number }
  | { type: 'agregarMovimientoPago'; movimiento: Omit<MovimientoPago, 'id'> }
  | { type: 'removeMovimientoPago'; id: string }
  | { type: 'setMovimientoImporte'; id: string; importe: number }
  | { type: 'confirmarCobro' }
  | { type: 'setReciboId'; id: string }
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
         el stepper deja volver a saltar hacia adelante a las etapas ya completadas. */
      const idx = indiceDePaso(action.paso)
      return { ...state, paso: action.paso, pasoMaxIdx: Math.max(state.pasoMaxIdx, idx) }
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
        facturas: [],
        imputaciones: {},
        /* El cobro es de ESE cliente: sus cheques, sus retenciones y sus tarjetas no tienen
           sentido para otro, así que se descarta entero junto con la imputación. */
        cobro: cobroVacio(),
        /* El recibo y su envío también: el documento emitido era del cliente anterior, y sus
           destinatarios son los contactos de ESE cliente. */
        reciboId: null,
        contactos: [],
        documentoEnviado: false,
        log: [],
      }

    /* Llegaron las facturas del cliente. Las imputaciones ya hechas se conservan SÓLO si su factura
       sigue estando: al recargar puede haberse cobrado alguna desde otro lado, y un importe
       imputado a una factura que ya no figura no tendría dónde impactar. */
    case 'setFacturas': {
      const vigentes = new Set(action.facturas.map((f) => f.id))
      const imputaciones = Object.fromEntries(
        Object.entries(state.imputaciones).filter(([id]) => vigentes.has(id)),
      )
      return { ...state, facturas: action.facturas, imputaciones }
    }

    /* Marcar/desmarcar una factura. Al marcarla el importe nace en 0: NO se propone ningún valor
       por defecto —cuánto se cancela de cada factura es una decisión del usuario, no algo que la
       app deba suponer—. Al desmarcarla se borra la clave: la selección y el importe son el mismo
       dato. */
    case 'toggleFactura': {
      const { [action.factura.id]: actual, ...resto } = state.imputaciones
      const cobro = reabrirCobro(state.cobro)
      if (actual !== undefined) return { ...state, imputaciones: resto, cobro }
      return { ...state, imputaciones: { ...state.imputaciones, [action.factura.id]: 0 }, cobro }
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

    /* Un pago cargado en el formulario del paso 3. Llega ya validado —el formulario no deja
       agregar un movimiento incompleto—, así que acá sólo se le pone el id y se reabre el cobro. */
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
