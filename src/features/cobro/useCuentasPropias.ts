import { useEffect, useRef, useState } from 'react'
import { getCuentasBancariasPropias } from '@/services/monday'
import type { CuentaPropia } from '@/types'

/** Estado de la consulta de cuentas propias: gobierna el texto del selector y qué se puede elegir. */
export type EstadoCuentas = 'idle' | 'cargando' | 'listo' | 'error'

/**
 * Cuentas bancarias propias de La Batea. Se consultan UNA sola vez, recién cuando el medio de cobro
 * que las necesita entra en pantalla (`activo`): la transferencia, para la cuenta de destino, y la
 * tarjeta, para el banco de acreditación. El ref evita re-consultar al volver a entrar; `estado` NO
 * puede ir en las deps del efecto (su set lo re-ejecutaría y cancelaría la consulta recién lanzada).
 */
export function useCuentasPropias(activo: boolean): {
  cuentas: CuentaPropia[]
  estado: EstadoCuentas
} {
  const [cuentas, setCuentas] = useState<CuentaPropia[]>([])
  const [estado, setEstado] = useState<EstadoCuentas>('idle')
  const cargadas = useRef(false)

  useEffect(() => {
    if (!activo || cargadas.current) return
    let vivo = true
    setEstado('cargando')
    getCuentasBancariasPropias()
      .then((cs) => {
        if (!vivo) return
        cargadas.current = true
        setCuentas(cs)
        setEstado('listo')
      })
      .catch(() => vivo && setEstado('error'))
    return () => {
      vivo = false
    }
  }, [activo])

  return { cuentas, estado }
}

/** Texto de la opción vacía del selector, según cómo venga la consulta. */
export function textoCuentasVacio(estado: EstadoCuentas, cantidad: number): string {
  if (estado === 'cargando' || estado === 'idle') return 'Buscando cuentas…'
  if (estado === 'error') return 'No se pudieron traer las cuentas'
  return cantidad === 0 ? 'No hay cuentas propias cargadas' : 'Seleccionar cuenta…'
}
