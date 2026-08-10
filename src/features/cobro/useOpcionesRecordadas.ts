import { useCallback, useEffect, useMemo, useState } from 'react'

/** Clave de localStorage donde vive cada catálogo ampliable del cobro. */
export const STORAGE_BANCOS = 'labatea:bancosEmisores'
export const STORAGE_TIPOS_TARJETA = 'labatea:tiposTarjeta'

/** Bancos emisores fijos que ofrece el select de cobro (cheques y tarjetas), en el orden pedido. */
export const BANCOS_EMISORES_BASE = [
  'Galicia',
  'Provincia',
  'Nacion',
  'HSBC',
  'Credicop',
  'Santander',
  'BBVA',
  'Hipotecario',
  'Patagonia',
  'Supervielle',
] as const

/**
 * Tipos de tarjeta fijos. Son los dos que el board tiene cargados en "🤖Tipo Tarjeta"; los que
 * agregue el usuario se crean como etiqueta al escribir el subelemento del recibo, porque la
 * mutación va con `create_labels_if_missing`.
 */
export const TIPOS_TARJETA_BASE = ['VISA', 'MASTERCARD'] as const

/** Evento propio para sincronizar dos formularios abiertos en la misma pestaña (storage no dispara ahí). */
const eventoDe = (storageKey: string) => `${storageKey}:sync`

function leerCustom(storageKey: string): string[] {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
  } catch {
    /* Sin storage disponible (o dato corrupto), se arranca sólo con las opciones fijas. */
    return []
  }
}

/**
 * Catálogo ampliable de un select del cobro: las opciones fijas MÁS las que el usuario haya
 * agregado, que quedan recordadas en localStorage entre sesiones. Lo comparten el "Banco Emisor" y
 * el "Tipo Tarjeta": misma mecánica, distinta clave y distinta lista base.
 *
 * `agregar` suma una opción nueva sin duplicar (ni contra las fijas ni contra las custom, sin
 * distinguir mayúsculas) y notifica a las demás instancias del hook.
 */
export function useOpcionesRecordadas(storageKey: string, base: readonly string[]) {
  const [custom, setCustom] = useState<string[]>(() => leerCustom(storageKey))

  useEffect(() => {
    const evento = eventoDe(storageKey)
    const releer = () => setCustom(leerCustom(storageKey))
    // Al cambiar de catálogo hay que releer: el estado todavía tiene el del anterior.
    releer()
    // `storage` cubre otras pestañas; el evento propio, otros formularios de esta misma pestaña.
    window.addEventListener('storage', releer)
    window.addEventListener(evento, releer)
    return () => {
      window.removeEventListener('storage', releer)
      window.removeEventListener(evento, releer)
    }
  }, [storageKey])

  const agregar = useCallback(
    (nombre: string) => {
      const limpio = nombre.trim()
      if (!limpio) return
      const actuales = leerCustom(storageKey)
      const yaExiste = [...base, ...actuales].some((o) => o.toLowerCase() === limpio.toLowerCase())
      if (yaExiste) return
      const siguiente = [...actuales, limpio]
      try {
        localStorage.setItem(storageKey, JSON.stringify(siguiente))
      } catch {
        /* Si el storage no está disponible, la opción vive sólo en memoria de esta sesión. */
      }
      setCustom(siguiente)
      window.dispatchEvent(new Event(eventoDe(storageKey)))
    },
    [storageKey, base],
  )

  const opciones = useMemo(() => [...base, ...custom], [base, custom])
  return { opciones, agregar }
}
