/**
 * Búsqueda de clientes y proveedores SOBRE EL PADRÓN YA CACHEADO, en el navegador y mientras se
 * escribe.
 *
 * Es el mismo algoritmo que `lib/busquedaClientes.ts` de la app de operaciones de venta —las dos
 * apps buscan sobre el mismo padrón y tienen que ordenar igual—, con una sola diferencia: allá sólo
 * existen clientes, y acá el mismo buscador sirve a los DOS lados del mostrador (COBROS busca
 * clientes, PAGOS proveedores, y el PASE DE SALDO el lado que declaró el usuario). Por eso el índice
 * se arma para un ROL.
 *
 * Todo es puro y sin red: recorrer unos miles de personas cuesta ~1 ms, así que la lista se rearma
 * en cada tecla sin debounce.
 *
 * ── El orden es el producto ──
 * Lo que el usuario necesita no es "los que contienen lo que escribí" sino "el que busco, primero".
 * El puntaje va por capas, de la coincidencia más fuerte a la más débil: quien escribe un código
 * quiere ESE código arriba, no la persona cuyo CUIT termina en esos dígitos.
 */
import type { Cliente } from '@/types'
import { cumpleRol, type RolPersona } from './personas'
import { compactar, normBusqueda, similitud, UMBRAL_SIMILITUD } from './similitud'

/** Cuántos resultados se ofrecen. Más que esto no se lee: se afina la búsqueda. */
export const TOPE_RESULTADOS_LOCALES = 30

/**
 * Puntajes por capa. Separados por huecos grandes para que ninguna combinación de capas baratas
 * pueda trepar por encima de una coincidencia exacta de identificador.
 */
const PUNTOS = {
  codigoExacto: 1000,
  cuitExacto: 900,
  codigoEmpieza: 800,
  nombreEmpieza: 700,
  palabraEmpieza: 600,
  nombreContiene: 500,
  /** La difusa aporta 0..100: siempre por debajo de cualquier coincidencia literal. */
  difusaMax: 100,
} as const

/**
 * El nombre sin el código que lo encabeza. En el tablero las personas se llaman "2 - ZUBIAURRE
 * S.A.": sin sacar el código, "empieza con" no serviría para nada —ningún nombre empezaría con la
 * razón social—.
 */
export const nombreSinCodigo = (name: string): string => name.replace(/^\s*\d+\s*-\s*/, '')

/** Sólo dígitos: es como se comparan los CUIT, que conviven con y sin guiones. */
const digitos = (s: string): string => s.replace(/\D/g, '')

/** Una entrada del padrón, con lo que hace falta para buscarla ya normalizado. */
export interface EntradaPadron {
  persona: Cliente
  nombre: string
  /**
   * El nombre sin espacios ni puntuación. Contra esto se comparan las capas de "empieza con" y
   * "contiene", para que el espacio deje de ser un carácter que el usuario tenga que adivinar:
   * "theautomationpartner" encuentra a "The Automation Partner S.A TEST".
   */
  compacto: string
  palabras: string[]
  codigo: string
  cuit: string
}

/**
 * ¿Esta persona se puede ofrecer en el buscador de ese rol?
 *
 * Es el SEGUNDO cerrojo. El primero lo pone el servidor, que ya entrega sólo la categoría pedida
 * (`/api/personas` con `categoria: 'cliente' | 'proveedor'`). Éste está puesto a propósito: ofrecer
 * un proveedor en un COBRO es cobrarle a quien nos vende, y esa clase de error no se arregla
 * después. Un cerrojo de más cuesta una comparación por persona al indexar, no por tecla.
 *
 * Usa `cumpleRol`, la MISMA regla con la que las pantallas validan a la persona al elegirla (ver
 * `lib/personas`): el buscador no puede ofrecer a alguien que la pantalla después rechazaría. Y
 * exige ACTIVA: el padrón del servidor ya sólo guarda activas, pero el mock no.
 */
const ofrecible = (persona: Cliente, rol: RolPersona): boolean =>
  persona.activity === 'Activo' && cumpleRol(persona, rol)

/**
 * Prepara el padrón para buscar: normaliza una sola vez lo que si no habría que normalizar en cada
 * tecla y por cada persona.
 */
export function indexarPadron(personas: readonly Cliente[], rol: RolPersona): EntradaPadron[] {
  return personas
    .filter((p) => ofrecible(p, rol))
    .map((persona) => {
      const nombre = normBusqueda(nombreSinCodigo(persona.name))
      return {
        persona,
        nombre,
        compacto: compactar(nombre),
        palabras: nombre.split(/[^a-z0-9]+/).filter(Boolean),
        codigo: normBusqueda(persona.codigo),
        cuit: digitos(persona.cuit),
      }
    })
}

/**
 * Cuánto matchea esta entrada con lo buscado. `0` = no matchea y no se muestra.
 *
 * Exportada para poder testear el orden capa por capa sin armar un padrón entero.
 */
export function puntuar(entrada: EntradaPadron, termino: string): number {
  const t = normBusqueda(termino)
  if (!t) return 0
  const tDigitos = digitos(t)
  /* Lo escrito, también compactado: es con lo que se comparan las capas de nombre. */
  const tCompacto = compactar(t)
  /* Sólo espacios o puntuación: no hay nada que buscar. Sin este corte, el compacto vacío
     "empezaría" a todos los nombres y se listaría el padrón entero. */
  if (!tCompacto) return 0
  /* Lo escrito sin espacios, para los identificadores: "40 77" es el código 4077 tipeado con un
     espacio de más, no otra búsqueda. */
  const tSinEspacios = t.replace(/\s+/g, '')

  /* Identificadores primero, y EXACTOS. Un código o un CUIT o es el que se buscó o no lo es:
     ofrecer parecidos ahí invita a elegir a la persona que no era. */
  if (entrada.codigo === tSinEspacios) return PUNTOS.codigoExacto
  if (tDigitos.length > 0 && entrada.cuit === tDigitos) return PUNTOS.cuitExacto

  /* El código SÍ admite prefijo: escribir "40" mientras se busca el 4077 es tipear, no confundirse.
     Sólo si lo escrito es numérico, para que buscar "SA" no liste códigos. */
  if (tDigitos === tSinEspacios && entrada.codigo.startsWith(tSinEspacios)) {
    return PUNTOS.codigoEmpieza
  }

  /* Las dos capas de nombre van contra la forma COMPACTA, en las dos puntas: "the autom",
     "theautom" y "The  Autom" son la misma búsqueda. */
  if (entrada.compacto.startsWith(tCompacto)) return PUNTOS.nombreEmpieza
  /* Ésta SÍ necesita las palabras sueltas: encuentra "MARTINEZ" dentro de "693 - LOPEZ MARTINEZ"
     por el comienzo de una palabra del medio. */
  if (entrada.palabras.some((p) => p.startsWith(t))) return PUNTOS.palabraEmpieza
  if (entrada.compacto.includes(tCompacto)) return PUNTOS.nombreContiene

  /* Último recurso: el error de tipeo. Con menos de cuatro letras no se aplica —la distancia de
     edición empareja a media base y el resultado es ruido—. También compactada: si no, cada espacio
     del nombre contaría como una edición. */
  if (t.length >= 4) {
    const s = similitud(tCompacto, entrada.compacto)
    if (s >= UMBRAL_SIMILITUD) return Math.round(s * PUNTOS.difusaMax)
  }
  return 0
}

export interface ResultadoLocal {
  personas: Cliente[]
  /** Se cortó por el tope y quedaron coincidencias afuera. La vista lo AVISA. */
  truncado: boolean
}

/**
 * Las personas que coinciden, la que más matchea primero. Los empates se rompen por nombre, que es
 * estable: sin eso la lista podría "saltar" al tipear.
 */
export function buscarEnPadron(
  padron: readonly EntradaPadron[],
  termino: string,
  tope: number = TOPE_RESULTADOS_LOCALES,
): ResultadoLocal {
  const t = termino.trim()
  if (!t) return { personas: [], truncado: false }

  const conPuntaje: { entrada: EntradaPadron; puntaje: number }[] = []
  for (const entrada of padron) {
    const puntaje = puntuar(entrada, t)
    if (puntaje > 0) conPuntaje.push({ entrada, puntaje })
  }

  conPuntaje.sort(
    (a, b) => b.puntaje - a.puntaje || a.entrada.nombre.localeCompare(b.entrada.nombre),
  )
  return {
    personas: conPuntaje.slice(0, tope).map((x) => x.entrada.persona),
    truncado: conPuntaje.length > tope,
  }
}
