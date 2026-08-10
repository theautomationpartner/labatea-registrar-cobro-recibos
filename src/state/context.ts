import { createContext, type Dispatch } from 'react'
import type { Action, AppState } from './appState'

/**
 * Contextos separados: quien sólo despacha no se re-renderiza al cambiar el estado.
 * Viven en su propio módulo (sin componentes) para no romper el límite de React Fast
 * Refresh: un módulo que exporta componentes no puede exportar además otros valores.
 */
export const StateContext = createContext<AppState | null>(null)
export const DispatchContext = createContext<Dispatch<Action> | null>(null)
