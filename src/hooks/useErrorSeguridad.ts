/**
 * El estado de seguridad vigente, para que React lo pueda mostrar.
 *
 * Se suscribe al canal de `lib/errorSeguridad`, donde el sdk publica cuando el borde rechaza.
 */
import { useSyncExternalStore } from 'react'
import {
  estadoSeguridadActual,
  suscribirErrorSeguridad,
  type EstadoSeguridad,
} from '@/lib/errorSeguridad'

const SIN_ERROR: EstadoSeguridad = { error: null, visible: false }

export function useErrorSeguridad(): EstadoSeguridad {
  return useSyncExternalStore(suscribirErrorSeguridad, estadoSeguridadActual, () => SIN_ERROR)
}
