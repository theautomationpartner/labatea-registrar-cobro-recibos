import { useContext, type Dispatch } from 'react'
import type { Action, AppState } from './appState'
import { DispatchContext, StateContext } from './context'

export function useApp(): AppState {
  const state = useContext(StateContext)
  if (!state) throw new Error('useApp debe usarse dentro de <AppProvider>')
  return state
}

export function useDispatch(): Dispatch<Action> {
  const dispatch = useContext(DispatchContext)
  if (!dispatch) throw new Error('useDispatch debe usarse dentro de <AppProvider>')
  return dispatch
}
