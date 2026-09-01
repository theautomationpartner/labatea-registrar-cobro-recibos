/**
 * Qué ES una persona del board de Personas (18420688238), y para qué operación sirve.
 *
 * En el sistema no hay un tablero de clientes y otro de proveedores: hay UN tablero de personas, y
 * lo único que las distingue es la etiqueta de "✋Categoria" (dropdown_mm54e5ag). Esa columna es
 * MULTI-VALOR, así que una misma persona puede ser "Clientes, Proveedores" a la vez y operar por los
 * dos lados del mostrador.
 *
 * Las reglas viven acá —puras, sin React ni servicios— y no adentro de cada módulo porque son la
 * MISMA regla mirada desde los dos lados: Cobros exige "Clientes", Pagos exige "Proveedores" y el
 * PASE DE SALDO exige la que el usuario haya declarado en el paso 1 ("Las cuentas son de:").
 * Escritas por separado, cualquier ajuste a una dejaría a las otras atrás.
 *
 * Cada módulo aplica su regla DOS veces, y a propósito:
 *
 *   · en la CONSULTA, como regla de `items_page`, para que la búsqueda no traiga a quien no sirve;
 *   · al SELECCIONAR, con estas funciones, porque un rechazo tiene que poder explicarse en pantalla
 *     y porque una regla de negocio que sólo vive en un string de GraphQL se pierde de vista.
 */
import type { Cliente, OperacionApp } from '@/types'

/** Las dos etiquetas de "✋Categoria" que habilitan operar, una por cada lado del mostrador. */
export const CATEGORIA_CLIENTE = 'Clientes'
export const CATEGORIA_PROVEEDOR = 'Proveedores'

/**
 * El rol que una operación le exige a la persona con la que se opera. Es lo que se busca, no lo que
 * se rechaza: nombrarlo en positivo es lo que permite construir el mensaje del rechazo sin
 * enumerar todo lo que la persona podría haber sido.
 */
export type RolPersona = 'cliente' | 'proveedor'

/**
 * Cómo se nombra ese rol en pantalla: en singular, en plural y con inicial mayúscula.
 *
 * El `titulo` no es un capricho de formato: los rótulos van casi siempre en medio de una frase —y
 * ahí van en minúscula—, pero encabezan títulos de etapa y de ventana, donde van en mayúscula.
 * Tenerlos escritos evita que cada pantalla se invente su propia forma de capitalizarlos.
 */
export const ROTULO_ROL: Record<RolPersona, { singular: string; plural: string; titulo: string }> = {
  cliente: { singular: 'cliente', plural: 'clientes', titulo: 'Cliente' },
  proveedor: { singular: 'proveedor', plural: 'proveedores', titulo: 'Proveedor' },
}

/** La categoría del tablero que corresponde a cada rol. */
export const CATEGORIA_DE_ROL: Record<RolPersona, string> = {
  cliente: CATEGORIA_CLIENTE,
  proveedor: CATEGORIA_PROVEEDOR,
}

/**
 * El rol que exige el módulo en curso, o `null` si todavía no se sabe.
 *
 * COBROS y PAGOS lo tienen FIJO —a un cliente se le cobra, a un proveedor se le paga—, y el PASE DE
 * SALDO no: sus dos cuentas pueden ser de clientes o de proveedores, y eso lo declara el usuario en
 * el paso 1 antes de buscar a nadie (`paseCuentasDe` en el estado). Mientras no lo haya declarado
 * devuelve `null`, que es lo que hace que el paso lo reclame en vez de asumir un lado del mostrador.
 *
 * Es la ÚNICA fuente de esa relación: las tres pantallas del pase —origen, anticipos y destino— la
 * consultan acá, así que no pueden terminar validando contra categorías distintas entre sí.
 */
export const rolDeOperacion = (
  operacion: OperacionApp,
  paseCuentasDe: RolPersona | null,
): RolPersona | null =>
  operacion === 'PAGOS' ? 'proveedor' : operacion === 'PASES' ? paseCuentasDe : 'cliente'

/**
 * La persona tiene esa categoría. Se compara sin distinguir mayúsculas ni espacios: las etiquetas
 * del tablero se escriben a mano y un espacio de más no debería cambiar el veredicto.
 */
export const tieneCategoria = (
  persona: Pick<Cliente, 'categorias'> | null | undefined,
  categoria: string,
): boolean =>
  (persona?.categorias ?? []).some(
    (c) => c.trim().toLowerCase() === categoria.trim().toLowerCase(),
  )

/**
 * La persona sirve para operar en ese rol.
 *
 * Tener las DOS categorías alcanza: lo que habilita es tener la etiqueta, no tenerla en exclusiva.
 * Alguien que es "Clientes, Proveedores" se le puede cobrar Y se le puede pagar, porque el tablero
 * afirma las dos cosas. Lo que se rechaza es a quien no la tiene.
 *
 * Sin categoría cargada NO se asume nada: una persona sin clasificar no es un cliente ni un
 * proveedor, y dejarla pasar por omisión sería exactamente lo que estas reglas existen para evitar.
 */
export const cumpleRol = (
  persona: Pick<Cliente, 'categorias'> | null | undefined,
  rol: RolPersona,
): boolean => tieneCategoria(persona, CATEGORIA_DE_ROL[rol])

/** Atajos con nombre, que es como se lee en cada módulo. */
export const esCliente = (persona: Pick<Cliente, 'categorias'> | null | undefined): boolean =>
  cumpleRol(persona, 'cliente')

export const esProveedor = (persona: Pick<Cliente, 'categorias'> | null | undefined): boolean =>
  cumpleRol(persona, 'proveedor')

/** El otro lado del mostrador. Es lo que la persona rechazada suele ser. */
export const rolOpuesto = (rol: RolPersona): RolPersona =>
  rol === 'cliente' ? 'proveedor' : 'cliente'

/**
 * Cómo se nombra el módulo en el mensaje del rechazo. Es el rótulo que el usuario ve en el selector
 * del encabezado, para que la ventana hable de la misma operación que él eligió.
 */
export const ROTULO_OPERACION: Record<OperacionApp, string> = {
  COBROS: 'COBROS',
  PASES: 'PASE DE SALDO',
  PAGOS: 'PAGOS',
}
