/**
 * El live search de clientes y proveedores sobre el padrón cacheado (`lib/busquedaPersonas`) y el
 * puente entre el registro que guarda el cron de la app de ventas y el `Cliente` de esta app
 * (`deRegistro`).
 *
 * Lo que se protege:
 *   · los CERROJOS: un proveedor nunca aparece buscando clientes, ni al revés; quien es las dos
 *     cosas aparece en los dos; una persona inactiva no aparece nunca;
 *   · los espacios que escribe el usuario no cuentan, ni en el nombre ni en el código;
 *   · el orden: el identificador exacto arriba de cualquier coincidencia por nombre;
 *   · el registro del cron se traduce al vocabulario de esta app —si no, `cumpleRol` no
 *     reconocería a nadie y el buscador quedaría vacío en silencio—.
 */
import { buscarEnPadron, indexarPadron, puntuar, TOPE_RESULTADOS_LOCALES } from '@/lib/busquedaPersonas'
import { CATEGORIA_CLIENTE, CATEGORIA_PROVEEDOR, cumpleRol } from '@/lib/personas'
import { deRegistro } from '@/services/monday/padronPersonas'
import type { Cliente } from '@/types'

let fallas = 0
const chequear = (grupo: string, nombre: string, ok: boolean) => {
  if (!ok) fallas++
  console.log(`${ok ? 'OK    ' : 'FALLA '} ${grupo} · ${nombre}`)
}

const persona = (p: Partial<Cliente> & Pick<Cliente, 'id' | 'name' | 'codigo'>): Cliente => ({
  cuit: '',
  ptype: '',
  status: 'Responsable Inscripto',
  list: null,
  ret: 'Ninguna',
  agenteRetencion: false,
  categorias: [CATEGORIA_CLIENTE],
  condicionPago: null,
  aceptaCheques: true,
  limit: 0,
  saldoCtaCte: 0,
  lineaUtilizada: 0,
  remitosPendFacturar: 0,
  disponible: 0,
  addr: '',
  activity: 'Activo',
  situation: 'Liberado sin crédito',
  ...p,
})

const PADRON: Cliente[] = [
  persona({ id: '1', codigo: '4077', name: '4077 - RAYCLE S.A. (LA GLICINA)', cuit: '30-70906788-1' }),
  persona({ id: '2', codigo: '7001', name: '7001 - The Automation Partner S.A TEST' }),
  persona({ id: '3', codigo: '12', name: '12 - Martínez Hnos', cuit: '20-12345678-9' }),
  persona({ id: '4', codigo: '900', name: '900 - Proveedora del Sur', categorias: [CATEGORIA_PROVEEDOR] }),
  persona({
    id: '5',
    codigo: '901',
    name: '901 - Ambos Lados SRL',
    categorias: [CATEGORIA_CLIENTE, CATEGORIA_PROVEEDOR],
  }),
  persona({ id: '6', codigo: '40', name: '40 - Cliente Dado de Baja', activity: 'Inactivo' }),
  persona({ id: '7', codigo: '777', name: '777 - Sin Categoría', categorias: [] }),
]

const clientes = indexarPadron(PADRON, 'cliente')
const proveedores = indexarPadron(PADRON, 'proveedor')
const ids = (xs: readonly { persona: Cliente }[]) => xs.map((x) => x.persona.id).sort().join(',')
const buscar = (padron: typeof clientes, t: string) => buscarEnPadron(padron, t).personas.map((p) => p.id)

/* ── Cerrojos ── */
chequear('cerrojo', 'el padrón de clientes no tiene proveedores ni inactivos ni sin categoría', ids(clientes) === '1,2,3,5')
chequear('cerrojo', 'el padrón de proveedores sólo tiene proveedores activos', ids(proveedores) === '4,5')
chequear('cerrojo', 'quien es cliente Y proveedor aparece en los dos', buscar(clientes, 'ambos')[0] === '5' && buscar(proveedores, 'ambos')[0] === '5')
chequear('cerrojo', 'buscar un proveedor por nombre en el padrón de clientes no lo trae', buscar(clientes, 'proveedora').length === 0)
chequear('cerrojo', 'buscar por código a un proveedor en clientes no lo trae', !buscar(clientes, '900').includes('4'))
chequear('cerrojo', 'el cliente inactivo no aparece ni por su código exacto', !buscar(clientes, '40').includes('6'))
chequear(
  'cerrojo',
  'el índice usa la MISMA regla que valida la pantalla (cumpleRol)',
  clientes.every((e) => cumpleRol(e.persona, 'cliente')) && proveedores.every((e) => cumpleRol(e.persona, 'proveedor')),
)

/* ── Espacios ── */
chequear('espacios', '"theautomationpartner" encuentra "The Automation Partner S.A TEST"', buscar(clientes, 'theautomationpartner')[0] === '2')
chequear('espacios', '"the  autom" (dos espacios) es la misma búsqueda', buscar(clientes, 'the  autom')[0] === '2')
chequear('espacios', '"theauto mationpartner" (espacio en otro lugar) también', buscar(clientes, 'theauto mationpartner')[0] === '2')
chequear('espacios', '"40 77" es el código 4077', buscar(clientes, '40 77')[0] === '1')
chequear('espacios', 'sólo espacios no lista el padrón entero', buscar(clientes, '   ').length === 0)
chequear('espacios', 'sólo puntuación tampoco', buscar(clientes, ' . - ').length === 0)
chequear('espacios', 'acentos no cuentan: "martinez" encuentra "Martínez"', buscar(clientes, 'martinez')[0] === '3')

/* ── Orden ── */
const raycle = clientes.find((e) => e.persona.id === '1')!
chequear('orden', 'código exacto gana a CUIT, que gana a prefijo de código', puntuar(raycle, '4077') > puntuar(raycle, '30709067881') && puntuar(raycle, '30709067881') > puntuar(raycle, '40'))
chequear('orden', 'el CUIT se encuentra con o sin guiones', buscar(clientes, '30-70906788-1')[0] === '1' && buscar(clientes, '30709067881')[0] === '1')
/* La difusa compara contra el nombre ENTERO compactado (igual que en la app de ventas): sirve para
   un nombre completo mal tipeado, no para un fragmento con error. */
chequear('orden', 'un nombre completo con un error de tipeo encuentra igual ("martinezz hnos")', buscar(clientes, 'martinezz hnos')[0] === '3')
chequear('orden', 'con menos de 4 letras no hay difusa ("xyz" no trae nada)', buscar(clientes, 'xyz').length === 0)

const muchos = indexarPadron(
  Array.from({ length: TOPE_RESULTADOS_LOCALES + 5 }, (_, i) =>
    persona({ id: `m${i}`, codigo: `${1000 + i}`, name: `${1000 + i} - Maria ${i}` }),
  ),
  'cliente',
)
const r = buscarEnPadron(muchos, 'maria')
chequear('orden', 'se corta en el tope y lo AVISA', r.personas.length === TOPE_RESULTADOS_LOCALES && r.truncado)

/* ── El registro del cron → el modelo de esta app ── */
const registro = {
  ...persona({ id: '99', codigo: '99', name: '99 - Del Cron' }),
  cuit: '30709067881',
  categorias: ['cliente', 'proveedor'],
}
const mapeado = deRegistro(registro)
chequear('registro', 'las categorías del cron se traducen a las etiquetas del tablero', mapeado.categorias.join(',') === `${CATEGORIA_CLIENTE},${CATEGORIA_PROVEEDOR}`)
chequear('registro', 'el CUIT se formatea como en mapPersona', mapeado.cuit === '30-70906788-1')
chequear('registro', 'con eso, el cerrojo lo reconoce de los dos lados', cumpleRol(mapeado, 'cliente') && cumpleRol(mapeado, 'proveedor'))
chequear('registro', 'un registro sin categorías queda afuera de los dos', !cumpleRol(deRegistro({ ...registro, categorias: undefined }), 'cliente'))

if (fallas > 0) {
  console.error(`\n${fallas} chequeo(s) fallaron`)
  process.exit(1)
}
console.log('\nTodo OK')
