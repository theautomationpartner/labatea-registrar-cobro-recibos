import { useReducer, type ReactNode } from 'react'
import { initialState, reducer } from './appState'
import { DispatchContext, StateContext } from './context'

/** Único export del módulo: así React Fast Refresh puede recargarlo en caliente. */
export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  return (
    <StateContext.Provider value={state}>
      <DispatchContext.Provider value={dispatch}>{children}</DispatchContext.Provider>
    </StateContext.Provider>
  )
}
