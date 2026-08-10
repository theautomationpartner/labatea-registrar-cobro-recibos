/**
 * Datos de prueba para trabajar sin token de Monday (desarrollo local). Los servicios devuelven
 * esto cuando `mondayHabilitado()` es falso, así la app se puede recorrer entera sin cuenta.
 */
import type { Usuario } from '@/types'

export const USUARIOS: Usuario[] = [
  { id: '1001', ini: 'LT', name: 'Luciano Torres', color: 'var(--avatar-orange)' },
  { id: '1002', ini: 'MS', name: 'María Silva', color: 'var(--red)' },
  { id: '1003', ini: 'JG', name: 'Javier Gómez', color: 'var(--green)' },
  { id: '1004', ini: 'PR', name: 'Paula Ríos', color: '#575ce5' },
  { id: '1005', ini: 'DC', name: 'Diego Cabrera', color: 'var(--primary-blue)' },
]
