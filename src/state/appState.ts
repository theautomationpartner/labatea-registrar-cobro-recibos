import { indiceDePaso } from '@/lib/pasos'
import type { Paso, Usuario, UsuarioActual } from '@/types'

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

export const initialState: AppState = {
  paso: 'cliente',
  pasoMaxIdx: 0,
  usuario: null,
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

    /* Llegaron los usuarios: se guardan y el selector deja de estar "Cargando…". Si todavía no hay
       responsable elegido, queda el que corresponde a la sesión. */
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
        usuarios: state.usuarios,
        usuariosCargando: state.usuariosCargando,
        usuarioActual: state.usuarioActual,
        usuario: usuarioPorDefecto(state.usuarios, state.usuarioActual),
      }

    default:
      return state
  }
}
