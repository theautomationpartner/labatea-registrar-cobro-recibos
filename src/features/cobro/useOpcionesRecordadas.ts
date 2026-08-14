import { useCallback, useEffect, useMemo, useState } from 'react'

/** Clave de localStorage donde vive cada catálogo ampliable del cobro. */
export const STORAGE_BANCOS = 'labatea:bancosEmisores'
/* Los tipos de tarjeta se recuerdan por MEDIO, en dos claves separadas: el catálogo de débito y el
   de crédito no se mezclan, así que un tipo agregado a mano en uno no aparece en el otro. */
export const STORAGE_TIPOS_TARJETA_DEBITO = 'labatea:tiposTarjeta:debito'
export const STORAGE_TIPOS_TARJETA_CREDITO = 'labatea:tiposTarjeta:credito'

/**
 * Bancos emisores fijos que ofrece el select de cobro (cheques y tarjetas), en el orden pedido.
 *
 * Todos empiezan con "Banco": es el nombre con el que se los reconoce en un cheque —"Banco Nación",
 * no "Nación"— y el estándar del catálogo. Que la lista sea pareja es lo que permite reconocer lo
 * que devuelve la IA sin dudar: un "Banco Nacion" leído del papel cae en la opción que ya existe en
 * vez de dar de alta una etiqueta nueva (ver `opcionCanonica`).
 *
 * Están escritos como los tiene el tablero de Monday, con tilde incluida. Los dos que allá figuran
 * sin la palabra —"HSBC" y "BBVA"— se traducen al escribir el subelemento (ver `BANCO_EMISOR_LABEL`
 * en `services/monday/columns`), así el estándar de la app no ensucia el board con duplicados.
 */
export const BANCOS_EMISORES_BASE = [
  'Banco Galicia',
  'Banco Provincia',
  'Banco Nación',
  'Banco HSBC',
  'Banco Credicoop',
  'Banco Santander',
  'Banco BBVA',
  'Banco Hipotecario',
  'Banco Patagonia',
  'Banco Supervielle',
] as const

/**
 * Tipos de tarjeta fijos, SEPARADOS por medio de cobro. El tipo no es sólo la marca: la etiqueta
 * dice marca Y medio, así que un plástico de débito nunca puede quedar registrado como de crédito.
 *
 * Los cuatro valores están escritos tal cual figuran en "🤖Tipo Tarjeta" (dropdown_mm5rx800) del
 * subelemento del recibo, con esa ortografía exacta y sin tildes: lo que se elige acá es literalmente
 * lo que se escribe en el tablero, así que cualquier diferencia daría de alta una etiqueta nueva
 * —la mutación va con `create_labels_if_missing`— en lugar de usar la que ya existe.
 */
export const TIPOS_TARJETA_DEBITO = ['Visa-Debito', 'Master-Debito'] as const
export const TIPOS_TARJETA_CREDITO = ['Visa-Credito', 'Master-Credito'] as const

/** Evento propio para sincronizar dos formularios abiertos en la misma pestaña (storage no dispara ahí). */
const eventoDe = (storageKey: string) => `${storageKey}:sync`

/**
 * Palabras que no distinguen una opción de otra: el genérico del rubro. "Banco Nación", "Nación" y
 * "Bco. Nación" son el mismo banco, y "Visa Crédito" el mismo tipo que "Visa-Credito".
 */
const GENERICAS = ['banco', 'bco', 'tarjeta']

/**
 * Forma comparable de una opción: sin tildes, sin mayúsculas, sin separadores y sin la palabra
 * genérica del rubro. Es lo que hace que dos formas de escribir lo mismo se reconozcan como una.
 */
const comparable = (valor: string): string => {
  let s = valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
  for (const generica of GENERICAS) {
    if (s.startsWith(generica)) s = s.slice(generica.length)
  }
  return s
}

/**
 * La opción del catálogo que corresponde a un texto suelto —lo que devolvió la IA, o lo que el
 * usuario tipeó en el alta—, o `undefined` si no hay ninguna.
 *
 * Primero busca la coincidencia exacta y después la parcial, que es la que hace calzar un "Banco
 * Santander Río" leído de un cheque con el "Banco Santander" del catálogo. La parcial pide al menos
 * cuatro caracteres: con dos o tres, cualquier opción "coincide" con cualquier cosa.
 *
 * Es la pieza que evita duplicar etiquetas: sin ella, cada variante de escritura entraría como una
 * opción nueva en la app y como una etiqueta nueva en el tablero de Monday, que las crea al vuelo.
 */
export function opcionCanonica(valor: string, opciones: readonly string[]): string | undefined {
  const buscado = comparable(valor ?? '')
  if (!buscado) return undefined
  return (
    opciones.find((o) => comparable(o) === buscado) ??
    (buscado.length >= 4
      ? opciones.find((o) => {
          const opcion = comparable(o)
          return opcion.length >= 4 && (opcion.includes(buscado) || buscado.includes(opcion))
        })
      : undefined)
  )
}

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
