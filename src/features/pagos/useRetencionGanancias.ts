import { useCallback, useEffect, useRef, useState } from 'react'
import { aIso, hoy } from '@/lib/dates'
import type { ParametrosRetencion } from '@/services/monday'
import { baseNoImponibleYaAplicada, getParametrosRetencion } from '@/services/monday'
import { useDispatch } from '@/state/hooks'

/** En qué anda la lectura de los datos de la retención. */
export type EstadoRetencion = 'idle' | 'cargando' | 'listo' | 'error'

/**
 * Lo que la RETENCIÓN de Ganancias necesita de Monday y no está en la operación: sus dos parámetros
 * de configuración y si al proveedor ya se le descontó la base no imponible este mes.
 *
 * Se consulta recién cuando la caja entra en pantalla (`activo`): antes no hay nada que calcular y
 * la llamada sería trabajo tirado. Mismo esquema que `useCuentasPropias` y `useChequesCartera`.
 *
 * La clave de la caché es el PROVEEDOR: los parámetros son globales, pero "¿ya se usó este mes?" no,
 * así que cambiar de proveedor tiene que volver a preguntar.
 */
export function useRetencionGanancias(
  activo: boolean,
  proveedorId: string | null,
): {
  parametros: ParametrosRetencion | null
  /** La base no imponible TODAVÍA no se usó este mes con este proveedor. */
  baseNoImponibleDisponible: boolean
  estado: EstadoRetencion
  /**
   * Vuelve a preguntarle a Monday, salteando la caché. Es lo que permite corregir un dato que
   * faltaba —la alícuota, el importe neto de una factura— y reintentar sin rehacer el paso.
   */
  reintentar: () => void
} {
  const dispatch = useDispatch()
  const [parametros, setParametros] = useState<ParametrosRetencion | null>(null)
  const [disponible, setDisponible] = useState(false)
  const [estado, setEstado] = useState<EstadoRetencion>('idle')
  /* De qué proveedor son los datos que hay cargados. Es la clave de caché: sin ella se
     re-consultaría en cada render. */
  const cargadoPara = useRef<string | null>(null)
  const avisado = useRef(false)

  /* Cuántas veces se pidió reintentar. Es lo que vuelve a disparar el efecto: subir el contador lo
     re-ejecuta, y el `cargadoPara` ya quedó en `null`, así que la consulta sale de nuevo. */
  const [intentos, setIntentos] = useState(0)

  const reintentar = useCallback(() => {
    cargadoPara.current = null
    avisado.current = false
    setIntentos((n) => n + 1)
  }, [])

  useEffect(() => {
    if (!activo || !proveedorId || cargadoPara.current === proveedorId) return
    let vivo = true
    setEstado('cargando')
    /* Las dos consultas salen JUNTAS: son independientes entre sí y esperar una para largar la otra
       sólo duplicaría la espera del usuario delante de un campo que todavía no puede usar. */
    Promise.all([getParametrosRetencion(), baseNoImponibleYaAplicada(proveedorId, aIso(hoy()))])
      .then(([params, yaAplicada]) => {
        if (!vivo) return
        cargadoPara.current = proveedorId
        setParametros(params)
        setDisponible(!yaAplicada)
        setEstado('listo')
      })
      .catch(() => {
        if (!vivo) return
        setEstado('error')
        if (avisado.current) return
        avisado.current = true
        dispatch({ type: 'errorMonday', accion: 'obtener los datos de la retención de Ganancias' })
      })
    return () => {
      vivo = false
    }
    /* `intentos` está en las deps a propósito: no se usa adentro, pero cambiarlo es lo que hace
       que el efecto vuelva a correr cuando el usuario pide reintentar. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activo, proveedorId, intentos, dispatch])

  return { parametros, baseNoImponibleDisponible: disponible, estado, reintentar }
}
