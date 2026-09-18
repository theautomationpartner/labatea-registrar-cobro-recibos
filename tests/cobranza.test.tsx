/**
 * Humo del módulo de GESTIÓN DE COBRANZA: corre los dos criterios de búsqueda contra el tablero de
 * prueba, fija el reparto de la deuda por tramo y renderiza el tablero contra el estado real (el
 * reducer, no un mock). Mismo criterio que `resumen.test.tsx`: no reemplaza probar la app en Monday.
 *
 * Lo que se protege acá es lo que el módulo no puede perder:
 *   · los dos filtros —el de la cuenta y el de la factura— tienen que cambiar lo que se lista;
 *   · los números de los widgets tienen que salir de UNA sola lectura y cerrar con la tabla;
 *   · el resultado en pantalla tiene que saber de qué criterio es (la clave de caché);
 *   · el módulo no escribe NADA en Monday.
 */
import { renderToString } from 'react-dom/server'
import { createElement, type ComponentType } from 'react'
import { DispatchContext, StateContext } from '@/state/context'
import {
  hayOperacionEnCurso,
  initialState,
  reducer,
  type Action,
  type AppState,
} from '@/state/appState'
import { CobranzaView } from '@/features/cobranza/CobranzaView'
import { CUENTAS_COBRANZA_MOCK } from '@/data/mock'
import {
  claveCobranza,
  CRITERIO_INICIAL,
  CUENTAS_POR_PAGINA,
  criterioCompleto,
  DESCENDENTE_POR_DEFECTO,
  ESTADO_SALDO_LABEL,
  ESTADOS_SALDO,
  ESTADOS_SALDO_BUSCABLES,
  estadoSaldoDeLabel,
  OPCIONES_ESTADO_SALDO,
  filasDeCobranza,
  ordenarFilas,
  proporcion,
  resumenCobranza,
  topDeudores,
  TRAMOS_VENCIMIENTO,
} from '@/lib/cobranza'
import { MS_DESPLIEGUE, MS_PLEGADO } from '@/features/recibo/usePlegable'
import { operacionesPermitidas } from '@/lib/permisos'
import { ROTULO_OPERACION } from '@/lib/personas'
import { semaforoDeCredito, usoDeLinea } from '@/lib/selectors'
import * as servicioCobranza from '@/services/monday/cobranza'
import { buscarCobranza } from '@/services/monday/cobranza'
import { COL } from '@/services/monday/columns'
import type { TramoVencimiento } from '@/types'

const aplicar = (estado: AppState, acciones: Action[]): AppState =>
  acciones.reduce((acc, a) => reducer(acc, a), estado)

const pintar = (estado: AppState, Vista: ComponentType) =>
  renderToString(
    createElement(
      StateContext.Provider,
      { value: estado },
      createElement(DispatchContext.Provider, { value: () => undefined }, createElement(Vista)),
    ),
  )

let fallas = 0
const chequear = (grupo: string, nombre: string, ok: boolean) => {
  if (!ok) fallas++
  console.log(`${ok ? 'OK    ' : 'FALLA '} ${grupo} · ${nombre}`)
}

/* Un usuario AJENO al equipo de proveedores: la cobranza es para todos, como COBROS. */
const AJENO = { id: '5', name: 'Vendedor', isAdmin: false, equipos: ['Vendedores'], equipoIds: ['1'] }

const enCobranza = aplicar(initialState, [
  { type: 'setUsuarioActual', usuario: AJENO },
  { type: 'setOperacionApp', operacion: 'COBRANZA' },
  { type: 'confirmarOperacionApp' },
])

/* ===== El módulo existe y es para todos ===== */

chequear(
  'módulo',
  'un vendedor ajeno al equipo de proveedores puede operar la cobranza',
  operacionesPermitidas(AJENO).includes('COBRANZA'),
)
chequear('módulo', 'el rótulo del módulo es "GESTIÓN DE COBRANZA"', ROTULO_OPERACION.COBRANZA === 'GESTIÓN DE COBRANZA')
chequear(
  'módulo',
  'no tiene recorrido: es UNA pantalla y se rutea por el módulo',
  enCobranza.tipoOperacion === null,
)
chequear(
  'módulo',
  'el tablero no es trabajo a medio hacer: cambiar de operación no advierte nada',
  !hayOperacionEnCurso(enCobranza),
)
chequear(
  'módulo',
  'entrar al módulo NO consulta nada: no hay búsqueda pedida',
  enCobranza.cobranzaPedida === null &&
    enCobranza.cobranzaClave === null &&
    enCobranza.cobranzaResultado === null,
)
chequear(
  'módulo',
  'el criterio nace puesto —saldo a cobrar y todos los tramos—, listo para buscar',
  JSON.stringify(CRITERIO_INICIAL.estados) === '["aCobrar"]' &&
    CRITERIO_INICIAL.tramos.length === TRAMOS_VENCIMIENTO.length,
)

/* ===== Las etiquetas con las que se filtra el tablero ===== */

chequear(
  'columnas',
  'el estado del saldo es la fórmula formula_mm6sr4rn de la cuenta corriente',
  COL.ctaCte.estadoSaldo === 'formula_mm6sr4rn',
)
chequear(
  'columnas',
  'el estado de vencimiento es la status color_mm6symyx de la factura',
  COL.factPendiente.estadoVencimiento === 'color_mm6symyx',
)
chequear(
  'columnas',
  'los tres estados de saldo son los del tablero',
  ESTADO_SALDO_LABEL.aCobrar === 'Saldo a Cobrar' &&
    ESTADO_SALDO_LABEL.cero === 'Saldo Cero' &&
    ESTADO_SALDO_LABEL.aFavor === 'Saldo a Favor',
)
chequear(
  'columnas',
  'los cinco tramos son las cinco etiquetas del tablero, en orden de gravedad',
  TRAMOS_VENCIMIENTO.map((t) => t.label).join(' | ') ===
    'No vencido | Vencido 0 a 15 Dias | Vencido 15 a 30 dias | Vencido + 30 - 60  Dias | Vencido + 60',
)
chequear(
  'columnas',
  'la etiqueta del tablero se reconoce con otra capitalización y con espacios de más',
  estadoSaldoDeLabel('  SALDO   A  COBRAR ') === 'aCobrar' &&
    estadoSaldoDeLabel('Saldo a favor') === 'aFavor' &&
    estadoSaldoDeLabel('Saldo pendiente') === null,
)

/* ===== El criterio ===== */

chequear(
  'criterio',
  'un criterio sin estados o sin tramos no se puede consultar',
  !criterioCompleto({ estados: [], tramos: ['noVencido'] }) &&
    !criterioCompleto({ estados: ['aCobrar'], tramos: [] }) &&
    criterioCompleto(CRITERIO_INICIAL),
)
chequear(
  'criterio',
  'el estado del saldo se busca de a UNO: o las que deben, o las que tienen saldo a favor',
  ESTADOS_SALDO_BUSCABLES.join() === 'aCobrar,aFavor' &&
    OPCIONES_ESTADO_SALDO.length === 2 &&
    aplicar(enCobranza, [{ type: 'setCobranzaEstados', estados: ['aFavor'] }]).cobranzaCriterio
      .estados.join() === 'aFavor',
)
chequear(
  'criterio',
  'el saldo CERO sigue existiendo como estado del tablero, pero no se ofrece buscarlo',
  ESTADO_SALDO_LABEL.cero === 'Saldo Cero' &&
    estadoSaldoDeLabel('Saldo Cero') === 'cero' &&
    ESTADOS_SALDO.length === 3 &&
    !ESTADOS_SALDO_BUSCABLES.includes('cero'),
)
chequear(
  'criterio',
  'la clave no depende del orden en que se eligieron las opciones',
  claveCobranza({ estados: ['cero', 'aCobrar'], tramos: ['vencidoMas60', 'noVencido'] }) ===
    claveCobranza({ estados: ['aCobrar', 'cero'], tramos: ['noVencido', 'vencidoMas60'] }),
)

/* ===== La búsqueda contra el tablero de prueba ===== */

const deudores = await buscarCobranza(CRITERIO_INICIAL)
const filas = filasDeCobranza(deudores)
const resumen = resumenCobranza(filas)

const mockACobrarConCliente = CUENTAS_COBRANZA_MOCK.filter(
  (c) => c.estado === 'aCobrar' && c.clienteId !== '',
)

chequear(
  'búsqueda',
  'el filtro de saldo deja SÓLO las cuentas pedidas',
  deudores.cuentas.length === mockACobrarConCliente.length &&
    deudores.cuentas.every((c) => c.estadoSaldo === 'aCobrar'),
)
chequear(
  'búsqueda',
  'la cuenta sin cliente conectado queda afuera del listado y se CUENTA',
  deudores.sinCliente === 1 && deudores.cuentas.every((c) => c.clienteId !== ''),
)
chequear(
  'búsqueda',
  'se informa cuántas cuentas leyó el tablero, no sólo las que pasaron el filtro',
  deudores.totalLeidas === CUENTAS_COBRANZA_MOCK.length &&
    deudores.totalLeidas > deudores.cuentas.length,
)

const soloAFavor = await buscarCobranza({ estados: ['aFavor'], tramos: CRITERIO_INICIAL.tramos })
chequear(
  'búsqueda',
  'el otro estado buscable trae otras cuentas',
  soloAFavor.cuentas.length === 1 && soloAFavor.cuentas[0].estadoSaldo === 'aFavor',
)
chequear(
  'búsqueda',
  'una cuenta con saldo a favor no tiene facturas pendientes que listar',
  soloAFavor.facturas.length === 0,
)

const soloMas60 = await buscarCobranza({ estados: ['aCobrar'], tramos: ['vencidoMas60'] })
chequear(
  'búsqueda',
  'el filtro de vencimiento deja SÓLO las facturas de ese tramo',
  soloMas60.facturas.length > 0 && soloMas60.facturas.every((f) => f.tramo === 'vencidoMas60'),
)
chequear(
  'búsqueda',
  'las cuentas del criterio de saldo se listan igual, aunque no tengan facturas en ese tramo',
  soloMas60.cuentas.length === deudores.cuentas.length,
)
chequear(
  'búsqueda',
  'con los CINCO tramos pedidos también entra la factura sin estado de vencimiento cargado',
  deudores.facturas.some((f) => f.tramo === null) && !soloMas60.facturas.some((f) => f.tramo === null),
)
chequear(
  'búsqueda',
  'un criterio incompleto no sale a la red: devuelve vacío',
  (await buscarCobranza({ estados: [], tramos: [] })).cuentas.length === 0,
)

/* ===== El reparto de la deuda ===== */

const laBatea = filas.find((f) => f.cuenta.clienteId === '4192')
chequear('reparto', 'cada cuenta recibe SUS facturas', laBatea?.cantidad === 4)
chequear(
  'reparto',
  'lo pendiente es importe − cobrado, sumado sobre sus facturas',
  laBatea?.pendiente === 4_270_255.33 && laBatea?.total === 4_570_255.33 && laBatea?.cobrado === 300_000,
)
chequear(
  'reparto',
  'vencido + a vencer = pendiente',
  !!laBatea && laBatea.vencido + laBatea.aVencer === laBatea.pendiente,
)
chequear(
  'reparto',
  'lo NO vencido no cuenta como vencido',
  laBatea?.aVencer === 861_368.09 && laBatea?.porTramo.noVencido === 861_368.09,
)
chequear(
  'reparto',
  'la mora sale del vencimiento MÁS ANTIGUO de sus facturas vencidas',
  laBatea?.diasMora === 90,
)
chequear(
  'reparto',
  'el uso de línea se calcula contra el límite de la cuenta',
  laBatea?.usoLinea === usoDeLinea(4_500_000, 4_200_000) && laBatea?.usoLinea === 93.33,
)
chequear(
  'reparto',
  'sin límite asignado el uso de línea no se puede calcular',
  filas.find((f) => f.cuenta.clienteId === '3948')?.usoLinea === null,
)
chequear(
  'reparto',
  'una factura sin tramo no se cuenta como vencida (el tablero no lo afirmó)',
  filas.find((f) => f.cuenta.clienteId === '5510')?.vencido === 520_000,
)
chequear(
  'reparto',
  'una cuenta con saldo declarado y sin facturas en el tramo se lista igual, en cero',
  filas.find((f) => f.cuenta.clienteId === '9134')?.cantidad === 0 &&
    filas.find((f) => f.cuenta.clienteId === '9134')?.pendiente === 0,
)

/* ===== Los totales de los widgets ===== */

chequear(
  'totales',
  'los totales suman lo mismo que las filas de la tabla',
  resumen.pendiente === filas.reduce((a, f) => a + f.pendiente, 0) &&
    resumen.facturas === deudores.facturas.length,
)
chequear(
  'totales',
  'vencido + a vencer = pendiente, también en el total',
  resumen.vencido + resumen.aVencer === resumen.pendiente,
)
chequear(
  'totales',
  'el reparto por tramo no puede pasarse de lo pendiente',
  TRAMOS_VENCIMIENTO.reduce((a, t) => a + resumen.porTramo[t.valor], 0) <= resumen.pendiente,
)
chequear(
  'totales',
  'se distingue cuántas cuentas hay de cuántas tienen facturas',
  resumen.cuentas === filas.length && resumen.cuentasConFacturas < resumen.cuentas,
)
chequear('totales', 'la mora máxima es la más vieja del conjunto', resumen.moraMaxima === 180)
chequear(
  'totales',
  'una proporción sobre cero es 0 y no NaN: la franja no puede quedar sin ancho',
  proporcion(100, 0) === 0 && proporcion(25, 200) === 12.5,
)

/* ===== Orden y ranking ===== */

const porPendiente = ordenarFilas(filas, 'pendiente', true)
chequear(
  'orden',
  'por defecto la tabla ordena por lo pendiente, de mayor a menor',
  DESCENDENTE_POR_DEFECTO.pendiente && porPendiente[0].cuenta.clienteId === '4192',
)
chequear(
  'orden',
  'el nombre del cliente ordena de la A a la Z',
  !DESCENDENTE_POR_DEFECTO.cliente &&
    ordenarFilas(filas, 'cliente', false)[0].cuenta.cliente === 'Agro Norte S.R.L.',
)
chequear(
  'orden',
  'el saldo a favor de la cuenta también ordena la tabla',
  ordenarFilas(filas, 'anticipos', true)[0].cuenta.anticipos >=
    ordenarFilas(filas, 'anticipos', true)[filas.length - 1].cuenta.anticipos,
)
chequear(
  'orden',
  'ordenar no toca la lista original',
  filas[0].cuenta.clienteId === filasDeCobranza(deudores)[0].cuenta.clienteId,
)
chequear(
  'ranking',
  'el ranking deja afuera las cuentas que no deben nada',
  topDeudores(filas, 8).every((f) => f.pendiente > 0) &&
    topDeudores(filas, 8).length === resumen.cuentasConFacturas,
)
chequear(
  'ranking',
  'el semáforo del uso de línea del detalle es el MISMO de la ficha del cliente',
  semaforoDeCredito(93.33).clase === 'v-red' &&
    semaforoDeCredito(60).clase === 'v-orange' &&
    semaforoDeCredito(10).clase === 'v-green',
)

/* ===== El estado: qué pasa al tocar un filtro y al buscar ===== */

const conResultado = aplicar(enCobranza, [
  { type: 'setCobranzaResultado', resultado: deudores, clave: claveCobranza(CRITERIO_INICIAL) },
])
chequear(
  'estado',
  'el resultado se guarda con la clave del criterio que lo trajo',
  conResultado.cobranzaClave === claveCobranza(conResultado.cobranzaCriterio),
)

const filtroTocado = aplicar(conResultado, [
  { type: 'setCobranzaTramos', tramos: ['vencidoMas60'] },
])
chequear(
  'estado',
  'cambiar un criterio NO borra lo que hay en pantalla ni consulta: lo deja desactualizado',
  filtroTocado.cobranzaResultado !== null &&
    filtroTocado.cobranzaClave !== claveCobranza(filtroTocado.cobranzaCriterio) &&
    filtroTocado.cobranzaPedida === conResultado.cobranzaPedida,
)

const buscado = aplicar(filtroTocado, [{ type: 'pedirCobranza' }])
chequear(
  'estado',
  '"Buscar" descarta el resultado viejo y pide el del criterio elegido',
  buscado.cobranzaResultado === null &&
    buscado.cobranzaPedida === claveCobranza(buscado.cobranzaCriterio),
)

const sinTramos = aplicar(conResultado, [
  { type: 'setCobranzaTramos', tramos: [] },
  { type: 'pedirCobranza' },
])
chequear(
  'estado',
  'un criterio incompleto no dispara consulta: el reducer no lo pide',
  sinTramos.cobranzaResultado !== null && sinTramos.cobranzaPedida === conResultado.cobranzaPedida,
)

const otroModulo = aplicar(conResultado, [{ type: 'setOperacionApp', operacion: 'COBROS' }])
chequear(
  'estado',
  'salir del módulo descarta la consulta: volver a él la vuelve a pedir',
  otroModulo.cobranzaResultado === null && otroModulo.cobranzaClave === null,
)


/* ===== El tablero en pantalla ===== */

const tablero = pintar(conResultado, CobranzaView)
/* Antes de buscar: el tablero tiene que estar ENTERO, con los datos en gris. */
const enBlanco = pintar(enCobranza, CobranzaView)

chequear('pantalla', 'se titula GESTIÓN DE COBRANZA', tablero.includes('Gestión de Cobranza'))
chequear(
  'pantalla',
  'la búsqueda son dos selects y un botón, no controles propios',
  tablero.includes('<select id="cbz-estado"') &&
    tablero.includes('<select id="cbz-tramo"') &&
    tablero.includes('Obtener cuentas corrientes por') &&
    tablero.includes('Buscar facturas por'),
)
chequear(
  'pantalla',
  'el saldo ofrece SÓLO a cobrar y a favor: ni saldo cero ni un "todos"',
  OPCIONES_ESTADO_SALDO.every((e) => tablero.includes(e.label)) &&
    !tablero.includes('Saldo Cero') &&
    !tablero.includes('Todos los estados de saldo'),
)
chequear(
  'pantalla',
  'el vencimiento sí ofrece sus cinco tramos y la opción "todos"',
  TRAMOS_VENCIMIENTO.every((t) => tablero.includes(t.label)) &&
    tablero.includes('Todos los estados de vencimiento'),
)
chequear(
  'pantalla',
  'el criterio en curso llega elegido en el select',
  tablero.includes('<option value="TODOS" selected="">Todos los estados de vencimiento</option>'),
)

/* Orden de la pantalla: la tabla va pegada a la búsqueda, y los widgets DEBAJO de la tabla. */
const ordenEnPantalla = [
  'Obtener cuentas corrientes por',
  'Cuentas corrientes alcanzadas',
  'Deuda pendiente',
  'Deuda por estado de vencimiento',
  'Cuentas que más deben',
].map((t) => tablero.indexOf(t))
chequear(
  'pantalla',
  'primero la búsqueda, después el listado de cuentas y recién debajo los widgets',
  ordenEnPantalla.every((i, n) => i >= 0 && (n === 0 || i > ordenEnPantalla[n - 1])),
)
chequear(
  'pantalla',
  'los tres indicadores son A vencer, Vencido y Deuda pendiente',
  tablero.includes('A vencer (al día)') &&
    tablero.includes('Deuda pendiente') &&
    !tablero.includes('Cuentas alcanzadas') &&
    !tablero.includes('FACTURAS PENDIENTES'),
)
chequear(
  'pantalla',
  'lista las cuentas con su cliente y su cuenta corriente',
  tablero.includes('La Batea S.A.') && tablero.includes('CTACTE-018'),
)
chequear(
  'pantalla',
  'la tabla muestra el saldo a favor y ya no la mora ni el uso de línea',
  tablero.includes('Anticipos a favor') &&
    !tablero.includes('Ordenar por Mora') &&
    !tablero.includes('Ordenar por Uso de línea'),
)
chequear(
  'pantalla',
  'los encabezados de la tabla se pueden ordenar',
  tablero.includes('Ordenar por Pend de Cobrar') &&
    tablero.includes('Ordenar por Anticipos a favor'),
)
chequear(
  'pantalla',
  'cada fila ofrece desplegar las facturas de esa cuenta',
  tablero.includes('las facturas de La Batea S.A.'),
)
chequear(
  'pantalla',
  'avisa de la cuenta que quedó afuera por no tener cliente conectado',
  tablero.includes('no tiene cliente conectado'),
)
chequear(
  'pantalla',
  'dice que es sólo lectura: el módulo no modifica Monday',
  tablero.includes('nada de lo que') && tablero.includes('modifica Monday'),
)
chequear(
  'pantalla',
  'ya no ofrece registrar un cobro ni enviar un resumen desde el tablero',
  !tablero.includes('Registrar cobro') && !tablero.includes('Enviar resumen'),
)

/* Antes de la primera búsqueda: los widgets montados, y la tabla con su renglón. */
chequear(
  'sin buscar',
  'los widgets existen ANTES de buscar, con su layout completo',
  enBlanco.includes('Cuentas corrientes alcanzadas') &&
    enBlanco.includes('Deuda por estado de vencimiento') &&
    enBlanco.includes('Cuentas que más deben') &&
    enBlanco.includes('Deuda pendiente') &&
    enBlanco.includes('Anticipos a favor'),
)
chequear(
  'sin buscar',
  'los widgets llegan en gris, no en cero',
  enBlanco.includes('cbz-skel') && !enBlanco.includes('$ 0,00'),
)
chequear(
  'sin buscar',
  'la tabla NO lleva bloques grises: dice que no encontró cuentas',
  enBlanco.includes('No se encontraron cuentas corrientes') &&
    !enBlanco.slice(enBlanco.indexOf('cbz-tabla'), enBlanco.indexOf('cbz-kpis')).includes('cbz-skel'),
)
chequear(
  'sin buscar',
  'el renglón vacío mide lo que una fila con datos (misma caja `mov-comp`)',
  enBlanco.includes('class="mov-comp cbz-vacia"'),
)
chequear(
  'sin buscar',
  'una búsqueda sin resultados dice lo mismo que la tabla en blanco',
  pintar(
    aplicar(enCobranza, [
      {
        type: 'setCobranzaResultado',
        resultado: { cuentas: [], facturas: [], sinCliente: 0, totalLeidas: 3 },
        clave: claveCobranza(CRITERIO_INICIAL),
      },
    ]),
    CobranzaView,
  ).includes('No se encontraron cuentas corrientes'),
)
chequear(
  'con datos',
  'con el resultado a la vista ya no queda ningún bloque gris',
  !tablero.includes('cbz-skel'),
)

/* ===== Paginado del listado ===== */

/* Catorce cuentas: las del tablero de prueba repetidas con otro id y otro cliente. Lo que se fija
   es el paginado, no los importes. */
const catorce = {
  ...deudores,
  cuentas: Array.from({ length: 14 }, (_, i) => ({
    ...deudores.cuentas[i % deudores.cuentas.length],
    id: `cc-${i}`,
    clienteId: `cli-${i}`,
    cliente: `Cliente de prueba ${i + 1}`,
  })),
}
const conCatorce = pintar(
  aplicar(enCobranza, [
    { type: 'setCobranzaResultado', resultado: catorce, clave: claveCobranza(CRITERIO_INICIAL) },
  ]),
  CobranzaView,
)
chequear(
  'paginado',
  'con más de diez cuentas aparece el paginador y se muestran diez',
  (conCatorce.match(/cbz-chevron/g) ?? []).length === CUENTAS_POR_PAGINA &&
    conCatorce.includes('Mostrando <strong>1</strong>–<strong>10</strong> de <strong>14</strong>'),
)
chequear(
  'paginado',
  'con diez o menos NO se pagina: no hay nada que repartir',
  !tablero.includes('Página siguiente'),
)
chequear(
  'paginado',
  'y ofrece navegar a la página siguiente',
  conCatorce.includes('aria-label="Página 2"') && conCatorce.includes('aria-label="Página siguiente"'),
)

/* ===== El plegado de una fila ===== */

chequear(
  'plegado',
  'la fila nace cerrada y su detalle NO está montado',
  tablero.includes('aria-expanded="false"') && !tablero.includes('cbz-exp-wrap'),
)
chequear(
  'plegado',
  'abrir y cerrar usan los MISMOS tiempos que el resto de la app',
  MS_DESPLIEGUE === 240 && MS_PLEGADO === 200,
)
chequear(
  'plegado',
  'el tablero ya no ofrece salir: la operación se cambia desde el encabezado',
  !tablero.includes('Salir del tablero'),
)

/* ===== Ninguna escritura ===== */

/* El servicio del módulo expone SÓLO lecturas. Es la garantía de que la cobranza no impacta
   Monday, y se chequea sobre lo que el módulo publica y no sobre lo que uno recuerda haber escrito:
   el día que alguien agregue una mutación acá, este chequeo falla y hay que decidirlo a propósito. */
chequear(
  'sólo lectura',
  'el servicio expone únicamente las dos consultas: ninguna mutación',
  Object.keys(servicioCobranza).sort().join(',') === 'buscarCobranza',
)

if (fallas > 0) {
  console.error(`\n${fallas} chequeo(s) fallaron`)
  process.exit(1)
}
console.log('\nTodo OK')
