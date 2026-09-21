/**
 * Humo del módulo de RESUMEN DE CTA CTE: renderiza las dos etapas contra el estado real (el reducer,
 * no un mock) y fija las reglas que la operación no puede perder —el criterio con el que se eligen
 * los movimientos, la limpieza del nombre de un movimiento, la caché de la lista y qué invalida un
 * resumen ya emitido—. Mismo criterio que `rechazos.test.tsx`: no reemplaza probar la app en Monday.
 */
import { renderToString } from 'react-dom/server'
import { createElement, type ComponentType } from 'react'
import { DispatchContext, StateContext } from '@/state/context'
import {
  claveMovimientosCtaCte,
  criterioResumen,
  hayOperacionEnCurso,
  initialState,
  periodoResumen,
  reducer,
  type Action,
  type AppState,
} from '@/state/appState'
import { ClienteView } from '@/features/cliente/ClienteView'
import { ConfigResumenCtaCte } from '@/features/resumen/ConfigResumenCtaCte'
import { ConfigResumenView } from '@/features/resumen/ConfigResumenView'
import { ComprobantesPendientes } from '@/features/resumen/ComprobantesPendientes'
import { DetalleMovimientos } from '@/features/resumen/DetalleMovimientos'
import { ResumenCtaCteView } from '@/features/resumen/ResumenCtaCteView'
import { comprobanteEnviable } from '@/features/shared/comprobantesEnviables'
import { RESUMEN_CTA_CTE_EMISIBLE } from '@/features/shared/emisiones'
import { CLIENTES } from '@/data/mock'
import { etiquetaDePaso, etiquetasDe, numeroDePaso, pasoAnterior, siguientePaso } from '@/lib/pasos'
import { operacionesPermitidas } from '@/lib/permisos'
import {
  comprobanteDeMovimiento,
  dentroDelPeriodo,
  detalleDeMovimientos,
  estadoDeCuenta,
  INICIO_DE_LA_CUENTA,
  nombreSinCliente,
  nroDeFactura,
  paginar,
  paginasVisibles,
  periodoDeRango,
  periodoDelCriterio,
  rotuloCriterio,
  totalesDeFacturas,
  totalesDelPeriodo,
} from '@/lib/resumenCtaCte'
import { money } from '@/lib/format'
import { usoDeLinea } from '@/lib/selectors'
import {
  columnasDatosResumen,
  getFacturasAdeudadas,
  getMovimientosCtaCte,
} from '@/services/monday/resumenCtaCte'
import { sumaMirror } from '@/services/monday/parse'
import {
  COL,
  ESTADO_ENVIO_RESUMEN_INDEX,
  ESTADO_RESUMEN_INDEX,
  FACT_PENDIENTE_ESTADO_INDEX,
  FORMATO_RESUMEN_IDS,
  MEDIO_ENVIO_RESUMEN_IDS,
} from '@/services/monday/columns'
import type { CriterioResumen, MovimientosDelPeriodo } from '@/types'

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

/* Un usuario AJENO al equipo de proveedores: el resumen es para todos, como Cobros. */
const AJENO = { id: '5', name: 'Vendedor', isAdmin: false, equipos: ['Vendedores'], equipoIds: ['1'] }
const enResumen = aplicar(
  { ...initialState, usuarioActual: AJENO },
  [{ type: 'setOperacionApp', operacion: 'RESUMEN' }],
)
const cliente = CLIENTES[0]

/* ===== El módulo y su recorrido ===== */

chequear('módulo', 'lo ve cualquier usuario', operacionesPermitidas(AJENO).includes('RESUMEN'))
chequear('módulo', 'abre con su recorrido', enResumen.operacionApp === 'RESUMEN' && enResumen.tipoOperacion === 'resumen')
chequear(
  'recorrido',
  'TRES etapas: el cliente, la configuración del resumen y la emisión',
  etiquetasDe('resumen').length === 3 &&
    etiquetaDePaso('configResumen', 'resumen') === 'Configurar Emisión de Resumen de Cuenta',
)
/* En el stepper va abreviada: el nombre completo ocuparía cuatro renglones del encabezado. */
chequear(
  'recorrido',
  'el stepper la nombra corta, sin tocar el título de la etapa',
  etiquetasDe('resumen').join('|') === 'Seleccionar Cliente|Configurar Emisión|Emitir y Enviar',
)
chequear(
  'recorrido',
  'del cliente se va a configurar, y de ahí a emitir',
  siguientePaso('cliente', 'resumen') === 'configResumen' &&
    siguientePaso('configResumen', 'resumen') === 'resumenCtaCte' &&
    pasoAnterior('resumenCtaCte', 'resumen') === 'configResumen' &&
    numeroDePaso('resumenCtaCte', 'resumen') === 3,
)
/* El estado de cuenta ya no ramifica el recorrido: es un dato del documento, no una etapa. */
chequear(
  'recorrido',
  'pedir el estado de cuenta NO agrega etapas',
  aplicar(enResumen, [{ type: 'setResumenEstadoCtaCte', estado: 'INCLUIR' }]).paso === 'cliente' &&
    etiquetasDe('resumen').length === 3,
)

/* ===== Paso 1 · sólo el cliente ===== */

const paso1 = pintar(enResumen, ClienteView)
chequear('paso 1', 'la bajada manda a buscar el cliente', paso1.includes('Buscá el cliente al cual se le va a generar el resumen de cuenta.'))
chequear('paso 1', 'el formulario NO vive acá', !paso1.includes('res-form'))
chequear('paso 1', 'sin cliente, el pie reclama el cliente', paso1.includes('Buscá y confirmá un cliente para continuar'))
chequear('paso 1', 'NO muestra "¿Qué vas a cobrar?"', !paso1.includes('¿Qué vas a cobrar?'))

/* ===== Paso 2 · Configurar Emisión de Resumen de Cuenta ===== */

const conClienteSolo = aplicar(enResumen, [{ type: 'setCliente', cliente }])
const config = pintar(conClienteSolo, ConfigResumenView)
chequear('paso 2', 'se llama "Configurar Emisión de Resumen de Cuenta"', config.includes('Configurar Emisión de Resumen de Cuenta'))
chequear('paso 2', 'y su bajada dice para qué es', config.includes('Indicá cómo se van a obtener los movimientos de la cuenta del cliente para generar el resumen.'))
chequear(
  'paso 2',
  'sus tres preguntas: período, rango de fechas y estado de cuenta',
  config.includes('Buscar movimientos en la cuenta corriente') &&
    config.includes('Seleccionar rango de fechas') &&
    config.includes('¿Desea incluir el estado de cuenta corriente?'),
)
chequear('paso 2', 'ofrece las ventanas de días y poder no elegir ninguna', config.includes('>Seleccionar...<') && config.includes('>Últimos 15 días<') && config.includes('>Último año<'))
chequear('paso 2', 'el estado de cuenta son dos cajas, no un selector', (config.match(/res-opcion /g) ?? []).length === 2 && config.includes('type="radio"'))
chequear('paso 2', 'las fechas son dos campos de fecha', (config.match(/type="date"/g) ?? []).length === 2)
chequear('paso 2', 'ofrece INCLUIR y NO INCLUIR', config.includes('>INCLUIR<') && config.includes('>NO INCLUIR<'))
chequear('paso 2', 'el rango de fechas va DEBAJO del período', config.indexOf('Buscar movimientos en la cuenta corriente') < config.indexOf('Seleccionar rango de fechas'))
chequear('paso 2', 'el pie reclama qué movimientos entran', config.includes('Indicá qué movimientos de la cuenta corriente entran en el resumen'))

/* La consulta la dispara el BOTÓN, y hasta que contesta no se avanza. */
chequear(
  'paso 2',
  'el botón "Confirmar" cierra el formulario, después de la última pregunta',
  config.includes('Confirmar') &&
    config.indexOf('¿Desea incluir el estado de cuenta corriente?') < config.indexOf('res-buscar'),
)
const completo = aplicar(conClienteSolo, [
  { type: 'setResumenRango', rango: 'ultimos60' },
  { type: 'setResumenEstadoCtaCte', estado: 'INCLUIR' },
])
chequear(
  'paso 2',
  'con el formulario completo pero sin buscar, no hay consulta en curso',
  !pintar(completo, ConfigResumenView).includes('Buscando movimientos'),
)
/* El renglón de la búsqueda está desde el principio: reserva su alto para que la card no crezca
   —y el pie no salte— al apretar Confirmar. */
chequear(
  'paso 2',
  'el lugar de la animación se reserva antes de buscar',
  pintar(completo, ConfigResumenView).includes('res-busqueda res-busqueda--idle'),
)
chequear('paso 2', 'y el pie manda a buscar', pintar(completo, ConfigResumenView).includes('Buscá los movimientos de la cuenta corriente para continuar'))

const pedida = aplicar(completo, [
  { type: 'pedirBusquedaResumen', clave: claveMovimientosCtaCte(cliente.id, periodoDeRango('ultimos60')) },
])
const buscando = pintar(pedida, ConfigResumenView)
chequear('paso 2', 'pedida la búsqueda, se ve la animación', buscando.includes('Buscando movimientos en la cuenta') && buscando.includes('fa-spin'))
chequear('paso 2', 'y el pie dice que hay que esperarla', buscando.includes('Esperá a que termine la búsqueda de los movimientos'))
chequear(
  'paso 2',
  'cambiar el criterio descarta el pedido: vuelve a hacer falta el botón',
  aplicar(pedida, [{ type: 'setResumenRango', rango: 'ultimos30' }]).resumenBusquedaPedida === null,
)
chequear(
  'paso 2',
  'y con el período elegido, el estado de cuenta',
  pintar(
    aplicar(conClienteSolo, [{ type: 'setResumenRango', rango: 'ultimos30' }]),
    ConfigResumenView,
  ).includes('Indicá si el resumen incluye el estado de la cuenta corriente'),
)

/* La búsqueda se prueba desde la etapa (arriba); acá se la deja sin disparar para mirar sólo los
   campos del formulario. */
const SIN_BUSCAR = {
  estado: 'idle' as const,
  movimientos: 0,
  comprobantes: null,
  sinCuenta: false,
  onBuscar: () => undefined,
  onReintentar: () => undefined,
}
const pintarForm = (estado: AppState, marcarPeriodo: boolean, marcarEstado: boolean) =>
  pintar(estado, () =>
    createElement(ConfigResumenCtaCte, { marcarPeriodo, marcarEstado, busqueda: SIN_BUSCAR }),
  )
chequear(
  'paso 2',
  'la elegida se marca por el borde, sin tilde',
  !config.includes('res-opcion-caja') &&
    pintarForm(aplicar(enResumen, [{ type: 'setResumenEstadoCtaCte', estado: 'INCLUIR' }]), false, false).includes('res-opcion--incluir') &&
    pintarForm(aplicar(enResumen, [{ type: 'setResumenEstadoCtaCte', estado: 'NO_INCLUIR' }]), false, false).includes('res-opcion--no_incluir'),
)
chequear(
  'paso 2',
  'sin intentar avanzar, nada está en rojo',
  !pintarForm(enResumen, false, false).includes('--error'),
)
chequear(
  'paso 2',
  'intentar avanzar sin contestar deja el período y el estado en rojo',
  pintarForm(enResumen, true, true).includes('res-campo-in--error') &&
    pintarForm(enResumen, true, true).includes('res-opcion--error'),
)
const conCriterio = aplicar(enResumen, [
  { type: 'setResumenRango', rango: 'ultimos30' },
  { type: 'setResumenEstadoCtaCte', estado: 'INCLUIR' },
])
chequear('paso 2', 'con el formulario completo el rojo se va solo', !pintarForm(conCriterio, true, true).includes('--error'))
/* Fechas al revés: es un dato mal cargado, así que se marca en cuanto pasa. */
const fechasAlReves = aplicar(enResumen, [
  { type: 'setResumenDesde', fecha: '2026-07-01' },
  { type: 'setResumenHasta', fecha: '2026-01-01' },
])
chequear('paso 2', 'fechas al revés: rojo sin esperar a que se intente avanzar', pintarForm(fechasAlReves, false, false).includes('res-campo-in--error'))
chequear('paso 2', 'el formulario NO narra el período que quedó', !pintarForm(conCriterio, false, false).includes('Entran los movimientos'))

/* ===== El criterio: la ventana, las fechas, o las dos ===== */

const HOY = new Date(2026, 8, 14)
const criterio = (c: Partial<CriterioResumen>): CriterioResumen => ({
  rango: null,
  desde: '',
  hasta: '',
  ...c,
})
chequear('período', 'últimos 15 días', JSON.stringify(periodoDeRango('ultimos15', HOY)) === '{"desde":"2026-08-30","hasta":"2026-09-14"}')
chequear('período', 'último año es desde la misma fecha del año pasado', periodoDeRango('ultimoAnio', HOY).desde === '2025-09-14')
const p = periodoDeRango('ultimos30', HOY)
chequear('período', 'las dos puntas entran', dentroDelPeriodo(p.desde, p) && dentroDelPeriodo(p.hasta, p))
chequear('período', 'un día antes no entra', !dentroDelPeriodo('2026-08-14', p))
chequear('período', 'sin fecha no entra en ninguno', !dentroDelPeriodo('', p))

chequear('criterio', 'sin nada elegido, no hay período', periodoDelCriterio(criterio({}), HOY).problema === 'sin-criterio')
chequear(
  'criterio',
  'sólo la ventana: el período es el de la ventana',
  JSON.stringify(periodoDelCriterio(criterio({ rango: 'ultimos15' }), HOY).periodo) ===
    JSON.stringify(periodoDeRango('ultimos15', HOY)),
)
chequear(
  'criterio',
  'sólo fechas: las fechas mandan',
  JSON.stringify(periodoDelCriterio(criterio({ desde: '2025-01-01', hasta: '2025-07-01' }), HOY).periodo) ===
    '{"desde":"2025-01-01","hasta":"2025-07-01"}',
)
/* El caso que pidió el usuario: "el último año, pero del 01/01/2025 al 01/07/2025". La FECHA manda
   sobre la ventana, punta por punta, así que el período es el de las fechas. */
chequear(
  'criterio',
  'ventana + fechas: la fecha manda (último año, del 01/01/2025 al 01/07/2025)',
  JSON.stringify(
    periodoDelCriterio(criterio({ rango: 'ultimoAnio', desde: '2025-01-01', hasta: '2025-07-01' }), HOY).periodo,
  ) === '{"desde":"2025-01-01","hasta":"2025-07-01"}',
)
chequear(
  'criterio',
  'ventana + UNA fecha: la otra punta la pone la ventana',
  JSON.stringify(periodoDelCriterio(criterio({ rango: 'ultimos30', hasta: '2026-09-05' }), HOY).periodo) ===
    `{"desde":"${periodoDeRango('ultimos30', HOY).desde}","hasta":"2026-09-05"}`,
)
chequear(
  'criterio',
  'sólo la fecha desde: el período llega hasta hoy',
  JSON.stringify(periodoDelCriterio(criterio({ desde: '2026-09-01' }), HOY).periodo) ===
    '{"desde":"2026-09-01","hasta":"2026-09-14"}',
)
chequear(
  'criterio',
  'sólo la fecha hasta: arranca en el principio de la cuenta',
  periodoDelCriterio(criterio({ hasta: '2026-09-01' }), HOY).periodo?.desde === INICIO_DE_LA_CUENTA,
)
chequear('criterio', 'fechas al revés: no hay período', periodoDelCriterio(criterio({ desde: '2026-09-10', hasta: '2026-09-01' }), HOY).problema === 'fechas-invertidas')
chequear(
  'criterio',
  'una ventana que arranca después de la fecha hasta: tampoco',
  periodoDelCriterio(criterio({ rango: 'ultimos15', hasta: '2020-02-01' }), HOY).problema === 'sin-cruce',
)
chequear(
  'criterio',
  'se nombra con la ventana y las fechas',
  rotuloCriterio(criterio({ rango: 'ultimos30', desde: '2025-01-01', hasta: '2025-07-01' })) ===
    'Últimos 30 días · 01/01/2025 al 01/07/2025' &&
    rotuloCriterio(criterio({ hasta: '2025-07-01' })) === 'hasta el 01/07/2025' &&
    rotuloCriterio(criterio({})) === '',
)

/* ===== El nombre de un movimiento, sin el cliente ===== */

const titular = { codigo: '7001', name: 'La Batea S.A TEST' }
chequear('nombre', 'quita código y razón social', nombreSinCliente('Movimiento - VTA-108 - 7001 - La Batea S.A', titular) === 'Movimiento - VTA-108')
chequear('nombre', 'deja intacto un nombre sin el cliente', nombreSinCliente('Anticipo - RECIBO-074', titular) === 'Anticipo - RECIBO-074')
chequear('nombre', 'nunca queda vacío', nombreSinCliente('7001 - La Batea S.A TEST', titular) === '7001 - La Batea S.A TEST')

/* ===== El "Nro de Comprobante" de cada clase de movimiento ===== */

const nombrar = (d: Partial<Parameters<typeof comprobanteDeMovimiento>[0]>) =>
  comprobanteDeMovimiento({ clase: 'otro', etiqueta: '', nombre: '', cliente: titular, ...d })
chequear('comprobante', 'cobro: sólo RECIBO-XXX, sin "Recibo -"', nombrar({ clase: 'cobro', nombre: 'Mov - Recibo - RECIBO-072 - 7001 - La Batea S.A TEST' }) === 'RECIBO-072')
chequear('comprobante', 'cobro con el nombre corto también', nombrar({ clase: 'cobro', nombre: 'Recibo - RECIBO-073' }) === 'RECIBO-073')
chequear('comprobante', 'cobro sin recibo en el nombre: lo busca en el origen', nombrar({ clase: 'cobro', nombre: 'Mov - Registro de Cobro', nombresOrigen: ['7001 - La Batea S.A TEST - RECIBO-078'] }) === 'RECIBO-078')
chequear('comprobante', 'saldo inicial', nombrar({ clase: 'saldoInicial', nombre: 'Movimiento - Saldo Inicial - 7001 - La Batea' }) === 'Saldo Inicial')
chequear('comprobante', 'anticipo con su ID', nombrar({ clase: 'anticipo', nombre: 'Anticipo - RECIBO-074', idAnticipo: 'ANTICIPO-020' }) === 'Pago por Anticipo - ANTICIPO-020')
chequear('comprobante', 'anticipo sin ID no inventa número', nombrar({ clase: 'anticipo', nombre: 'Anticipo - RECIBO-074' }) === 'Pago por Anticipo')
chequear('comprobante', 'crédito por pase: el nombre del movimiento', nombrar({ clase: 'creditoPase', etiqueta: 'Credito x Pase de Saldo', nombre: 'Mov - Credito x Pase de Saldo - RECIBO-063 - X' }) === 'Credito x Pase de Saldo')
chequear('comprobante', 'débito por pase: el nombre del movimiento', nombrar({ clase: 'debitoPase', etiqueta: 'Debito x Pase de Saldo' }) === 'Debito x Pase de Saldo')
chequear('comprobante', 'venta: el número de la factura', nombrar({ clase: 'venta', nombre: 'Movimiento - VTA-111 - 7001 - La Batea S.A TEST', nroFactura: 'VTA-111' }) === 'VTA-111')

/* ===== La lectura (modo local) ===== */

/* La consulta ya no recibe una ventana sino el PERÍODO: es lo que sale del criterio del paso 1. */
const periodo60 = periodoDeRango('ultimos60')
const sesenta = await getMovimientosCtaCte(cliente, periodo60)
chequear('lectura', 'filtra por período', sesenta.movimientos.map((m) => m.id).join() === 'm-2,m-3,m-4,m-5,m-6,m-7')
chequear('lectura', 'cuenta los que no tienen fecha', sesenta.sinFecha === 1)
const venta = sesenta.movimientos.find((m) => m.id === 'm-3')
chequear('lectura', 'la venta pendiente se identifica por su factura, con vencimiento', venta?.comprobante === 'VTA-104' && venta.vencimiento !== '')
const cobro = sesenta.movimientos.find((m) => m.id === 'm-2')
chequear('lectura', 'el cobro, por su recibo y sin vencimiento', cobro?.comprobante === 'RECIBO-061' && cobro.vencimiento === '' && cobro.tipo === 'Cobro')
chequear('lectura', 'el anticipo, con su ID', sesenta.movimientos.find((m) => m.id === 'm-4')?.comprobante === 'Pago por Anticipo - ANTICIPO-015')
const anio = await getMovimientosCtaCte(cliente, periodoDeRango('ultimoAnio'))
chequear('lectura', 'el último año incluye el movimiento viejo', anio.movimientos.some((m) => m.id === 'm-1'))
chequear('lectura', 'y el saldo inicial', anio.movimientos.find((m) => m.id === 'm-0')?.comprobante === 'Saldo Inicial')
/* Un tramo de fechas recorta lo mismo que la ventana: el filtro es UNO, el del período. */
const recortado = await getMovimientosCtaCte(cliente, { desde: periodo60.desde, hasta: periodo60.desde })
chequear('lectura', 'un período de un solo día trae, como mucho, los de ese día', recortado.movimientos.length <= sesenta.movimientos.length)

/* ===== Caché y qué invalida un resumen emitido ===== */

const conCliente = aplicar(enResumen, [
  { type: 'setResumenEstadoCtaCte', estado: 'NO_INCLUIR' },
  { type: 'setCliente', cliente },
  { type: 'setResumenRango', rango: 'ultimos60' },
])
chequear('criterio', 'el estado arma el criterio del paso 1', JSON.stringify(criterioResumen(conCliente)) === '{"rango":"ultimos60","desde":"","hasta":""}')
chequear('criterio', 'y de ahí sale el período que se consulta', JSON.stringify(periodoResumen(conCliente)) === JSON.stringify(periodo60))

const clave = claveMovimientosCtaCte(cliente.id, periodo60)
const conLista = aplicar(conCliente, [{ type: 'setMovimientosCtaCte', resultado: sesenta, clave }])
chequear('caché', 'la lista vigente se guarda con su clave', conLista.movimientosCtaCteClave === clave && conLista.ctaCteId === 'ctacte-mock')
chequear('caché', 'la clave son las dos puntas del período, no el criterio', clave === `${cliente.id}·${periodo60.desde}·${periodo60.hasta}`)

const tardia: MovimientosDelPeriodo = { ctaCteId: 'x', movimientos: [], sinFecha: 0, mercaderiaPendFacturar: 0 }
const conTardia = aplicar(conLista, [
  { type: 'setMovimientosCtaCte', resultado: tardia, clave: claveMovimientosCtaCte(cliente.id, periodoDeRango('ultimos15')) },
])
chequear('caché', 'una respuesta de OTRO período que llega tarde se descarta', conTardia.movimientosCtaCte.length === sesenta.movimientos.length)

const emitido = aplicar(conLista, [
  { type: 'setResumenFormato', formato: 'PDF' },
  { type: 'setResumenCtaCteId', id: 'ctacte-mock' },
  { type: 'setEmisionResumen', emision: { fase: 'emitido' } },
  { type: 'setDocumentoEnviado', value: true },
])
chequear('emisión', 'con el resumen emitido la operación ya no está en curso', !hayOperacionEnCurso(emitido))
chequear('emisión', 'sin emitir, sí', hayOperacionEnCurso(conLista))
chequear('emisión', 'emitido, el formato no se cambia', aplicar(emitido, [{ type: 'setResumenFormato', formato: 'Excel' }]).resumenFormato === 'PDF')

const otroPeriodo = aplicar(emitido, [{ type: 'setResumenRango', rango: 'ultimos30' }])
chequear(
  'emisión',
  'cambiar la ventana deja el resumen sin emitir y el envío por hacer',
  otroPeriodo.emisionResumen.fase === 'idle' && otroPeriodo.resumenCtaCteId === null && !otroPeriodo.documentoEnviado,
)
const otrasFechas = aplicar(emitido, [{ type: 'setResumenDesde', fecha: '2026-01-01' }])
chequear('emisión', 'y cambiar una fecha, también', otrasFechas.emisionResumen.fase === 'idle' && otrasFechas.resumenCtaCteId === null)
chequear('emisión', 'sacar la ventana deja el criterio sólo con fechas', aplicar(conLista, [{ type: 'setResumenRango', rango: null }]).resumenRango === null)

const generando = aplicar(conLista, [{ type: 'setEmisionResumen', emision: { fase: 'emitiendo' } }])
chequear('emisión', 'generándose, no se cambia el período', aplicar(generando, [{ type: 'setResumenRango', rango: 'ultimos15' }]).resumenRango === 'ultimos60')
chequear('emisión', 'ni las fechas', aplicar(generando, [{ type: 'setResumenHasta', fecha: '2026-01-01' }]).resumenHasta === '')
chequear('emisión', 'ni se cambia de cliente', aplicar(generando, [{ type: 'setCliente', cliente: CLIENTES[1] }]).cliente?.id === cliente.id)

const otroCliente = aplicar(conLista, [{ type: 'setCliente', cliente: CLIENTES[1] }])
chequear(
  'cliente',
  'cambiar de cliente descarta la lista pero conserva el criterio',
  otroCliente.movimientosCtaCteClave === null && otroCliente.resumenRango === 'ultimos60' && otroCliente.resumenEstadoCtaCte === 'NO_INCLUIR',
)

/* ===== Catálogos ===== */

const envio = comprobanteEnviable('resumenCtaCte')
chequear('envío', 'sólo contactos con "Resumen Cta Cte"', envio.etiquetaContacto === 'Resumen Cta Cte' && envio.exigeContactoQueAcepta === true)
chequear('envío', 'Email siempre y WhatsApp opcional, como en VENTAS', envio.modoEnvio === 'emailConWhatsapp')
chequear('envío', 'no se envía hasta que el tablero termina de generarlo', !envio.emitido(generando) && envio.emitido(emitido))
chequear('emisión', 'un error del tablero se puede reintentar', RESUMEN_CTA_CTE_EMISIBLE.reemitibleTrasError === true)
chequear(
  'tablero',
  'ids de formato (Ambos = PDF y Excel) y estado',
  JSON.stringify(FORMATO_RESUMEN_IDS) === '{"PDF":[1],"Excel":[2],"Ambos":[1,2]}' && ESTADO_RESUMEN_INDEX.generar === 3,
)

/* ===== Paginado y totales (los usan las tablas de cobranza y del estado de cuenta) ===== */

const lista23 = Array.from({ length: 23 }, (_, i) => i + 1)
const p1 = paginar(lista23, 1, 10)
chequear('paginado', 'primera página: 10 filas, 3 páginas', p1.items.join() === '1,2,3,4,5,6,7,8,9,10' && p1.totalPaginas === 3 && p1.desde === 1 && p1.hasta === 10)
const p3 = paginar(lista23, 3, 10)
chequear('paginado', 'última página: lo que queda', p3.items.join() === '21,22,23' && p3.desde === 21 && p3.hasta === 23)
chequear('paginado', 'una página que ya no existe se acota a la última', paginar(lista23, 9, 10).pagina === 3)
chequear('paginado', 'pocas páginas: todas como botón', paginasVisibles(2, 3).join() === '1,2,3')
chequear('paginado', 'muchas páginas: puntas, vecinas y saltos', paginasVisibles(6, 12).join() === '1,…,5,6,7,…,12')
chequear('alto fijo', 'la última página incompleta pide filas de relleno', p3.vacias === 7 && p1.vacias === 0)

const base23 = sesenta.movimientos[0]
const movimientos23 = Array.from({ length: 23 }, (_, i) => ({
  ...base23,
  id: `x-${i + 1}`,
  comprobante: `RECIBO-${String(i + 1).padStart(3, '0')}`,
  ventas: 100,
  cobros: 40,
  saldoFinal: 1000 + i,
}))
const tot = totalesDelPeriodo(movimientos23)
chequear('totales', 'suman TODO el período', tot.ventas === 2300 && tot.cobros === 920 && tot.saldoFinal === 1022)

/* ===== Las facturas que debe el cliente (documento "Estado de Cta Cte") ===== */

chequear('facturas', 'número desde el nombre del ítem', nroDeFactura('VTA-111 - 7001 - La Batea S.A TEST', titular) === 'VTA-111')
chequear('facturas', 'sin VTA en el nombre: el nombre sin el cliente', nroDeFactura('Factura manual - 7001 - La Batea S.A TEST', titular) === 'Factura manual')
const totF = totalesDeFacturas([
  { importe: 362_793.82, cobrado: 110_000, pendiente: 252_793.82 },
  { importe: 249_333.08, cobrado: 0, pendiente: 249_333.08 },
])
chequear('facturas', 'TOTAL DEUDA, TOTAL COBRADO y DEUDA PENDIENTE', totF.deuda === 612_126.9 && totF.cobrado === 110_000 && totF.pendiente === 502_126.9)
chequear(
  'facturas',
  'filtro: cliente + NO "Cancelada 100%" (índice 1), estado de vencimiento en su columna',
  FACT_PENDIENTE_ESTADO_INDEX.cancelada === 1 && COL.factPendiente.estadoVencimiento === 'color_mm6symyx' && COL.factPendiente.cobrado === 'lookup_mm4c3vc8',
)
chequear('facturas', 'el cobrado de varios subelementos se SUMA', sumaMirror({ id: 'x', text: '', display_value: '100000, 10000' }) === 110_000)

const adeudadas = await getFacturasAdeudadas(cliente)
chequear('facturas', 'lectura (modo local): ordenadas por vencimiento', adeudadas.length > 0 && adeudadas.every((f, i) => i === 0 || !f.vencimiento || (!!adeudadas[i - 1].vencimiento && f.vencimiento >= adeudadas[i - 1].vencimiento)))

const facturas13 = Array.from({ length: 13 }, (_, i) => ({
  ...adeudadas[0],
  id: `fa-${i}`,
  comprobante: `VTA-${200 + i}`,
  importe: 1000,
  cobrado: 100,
  pendiente: 900,
  estadoVencimiento: 'Vencido + 60',
  tonoVencimiento: 'vencida' as const,
}))
const conFacturas = aplicar(conLista, [{ type: 'setFacturasAdeudadas', facturas: facturas13, clienteId: cliente.id }])
chequear('facturas', 'otro cliente descarta las facturas', aplicar(conFacturas, [{ type: 'setCliente', cliente: CLIENTES[1] }]).facturasAdeudadasClienteId === null)
chequear('facturas', 'una respuesta de otro cliente se ignora', aplicar(conLista, [{ type: 'setFacturasAdeudadas', facturas: facturas13, clienteId: 'otro' }]).facturasAdeudadas.length === 0)

/* Con la lectura ya en el estado y la búsqueda pedida, la configuración deja avanzar y muestra el
   tilde con lo que trajo. */
const contestada = aplicar(conLista, [
  { type: 'pedirBusquedaResumen', clave },
  { type: 'goto', paso: 'configResumen' },
])
chequear(
  'paso 2',
  'con la búsqueda contestada, el pie anuncia la etapa siguiente',
  /* SSR mete un `<!-- -->` entre el texto y el valor interpolado: se acepta. */
  /Siguiente: (<!-- -->)?Emitir y Enviar/.test(pintar(contestada, ConfigResumenView)),
)
chequear(
  'paso 2',
  'y el spinner se vuelve tilde, con cuántos movimientos trajo',
  pintar(contestada, ConfigResumenView).includes('fa-circle-check') &&
    pintar(contestada, ConfigResumenView).includes(`${sesenta.movimientos.length}`),
)

/* ===== Paso 3 · emitir y enviar ===== */

const paso2 = pintar(conLista, ResumenCtaCteView)
chequear('paso 3', 'es la última etapa del recorrido', paso2.includes('>3<'))
chequear('paso 3', 'el campo Formato va antes del botón de emitir', paso2.indexOf('Formato') > -1 && paso2.indexOf('Formato') < paso2.indexOf('Emitir Resumen Cta Cte'))
chequear('paso 3', 'ofrece Excel, PDF y Ambos', paso2.includes('>Excel<') && paso2.includes('>PDF<') && paso2.includes('>Ambos<'))
chequear('paso 3', 'muestra el comprobante a generar y el envío con WhatsApp opcional', paso2.includes('Comprobante a generar') && paso2.includes('envío por WhatsApp'))
chequear('paso 3', 'la card del comprobante nace cerrada', paso2.includes('aria-expanded="false"'))
chequear('paso 3', 'la ficha nombra el período elegido', paso2.includes(rotuloCriterio(criterioResumen(conLista))))
chequear('paso 3', 'la bajada no nombra a Monday', paso2.includes('Emití el resumen de cuenta corriente y enviáselo al cliente.'))
chequear('paso 3', 'la ficha ya no muestra la fecha de emisión', !paso2.includes('Fecha de Emisión'))
chequear(
  'paso 3',
  '"Mercaderia Pend de Facturar" va debajo del saldo final, con el importe de la cuenta',
  paso2.indexOf('Mercaderia Pend de Facturar') > paso2.indexOf('Saldo final del período') &&
    conLista.mercaderiaPendFacturar === 286_621.81 &&
    paso2.includes('286.621,81'),
)
/* Sin la lista leída todavía, la card no inventa números: los muestra en "--". */
const leyendo = pintar(conCliente, ResumenCtaCteView)
chequear('paso 3', 'mientras la cuenta se lee, la card no muestra números', leyendo.includes('>--<'))
const detalleCargando = renderToString(
  createElement(DetalleMovimientos, {
    movimientos: [],
    desde: '',
    cliente,
    mercaderiaPendFacturar: 0,
    cargando: true,
  }),
)
chequear('paso 3', 'y el documento dice que está buscando los movimientos', detalleCargando.includes('Buscando los movimientos de la cuenta corriente'))

/* ===== Paso 3 · documentos a generar ===== */

const cuenta = (html: string, texto: string) => html.split(texto).length - 1
chequear('documentos', 'NO INCLUIR: sólo la card del resumen', cuenta(paso2, 'class="comp-card"') === 1 && !paso2.includes('class="comp-tit">Estado de Cta Cte'))
const paso2Incluye = pintar(
  aplicar(conLista, [
    { type: 'setResumenEstadoCtaCte', estado: 'INCLUIR' },
    { type: 'setFacturasAdeudadas', facturas: facturas13.slice(0, 3), clienteId: cliente.id },
  ]),
  ResumenCtaCteView,
)
chequear('documentos', 'INCLUIR: dos cards, resumen y estado de cuenta', cuenta(paso2Incluye, 'class="comp-card"') === 2 && paso2Incluye.includes('class="comp-tit">Estado de Cta Cte'))
chequear('documentos', 'las dos llevan "Documento Cta Cte"', cuenta(paso2Incluye, '>Documento Cta Cte<') === 2)
chequear('documentos', 'las dos nacen cerradas', cuenta(paso2Incluye, 'class="comp-toggle" aria-expanded="false"') === 2)

const detalle = detalleDeMovimientos(sesenta.movimientos)
chequear(
  'documentos',
  'detalle: saldo inicial del primer movimiento, debe/haber del período y saldo final',
  detalle.saldoInicial === sesenta.movimientos[0].saldoInicial &&
    detalle.debe === totalesDelPeriodo(sesenta.movimientos).ventas &&
    detalle.haber === totalesDelPeriodo(sesenta.movimientos).cobros &&
    detalle.saldo === sesenta.movimientos[sesenta.movimientos.length - 1].saldoFinal,
)
chequear('documentos', 'detalle sin movimientos: el saldo es el inicial', detalleDeMovimientos([]).saldo === 0)
const edo = estadoDeCuenta(
  [
    { importe: 1500, cobrado: 0, pendiente: 1500, vencimiento: '2026-09-28', tonoVencimiento: 'ok' },
    { importe: 3200.5, cobrado: 1200.5, pendiente: 2000, vencimiento: '2026-09-05', tonoVencimiento: 'alerta' },
    { importe: 850, cobrado: 0, pendiente: 850, vencimiento: '2026-07-10', tonoVencimiento: 'vencida' },
  ],
  '2026-09-14',
)
chequear(
  'documentos',
  'estado de cuenta: los números de la imagen (a vencer 1.500 · vencido 2.850 · pendiente 4.350)',
  edo.importe === 5550.5 && edo.pagado === 1200.5 && edo.pendiente === 4350 && edo.aVencer === 1500 && edo.vencido === 2850,
)
chequear(
  'documentos',
  'sin estado de vencimiento, decide la fecha',
  estadoDeCuenta([{ importe: 10, cobrado: 0, pendiente: 10, vencimiento: '2026-01-01', tonoVencimiento: null }], '2026-09-14').vencido === 10,
)
chequear('documentos', 'uso de línea con dos decimales; sin límite no hay porcentaje', usoDeLinea(15_000_000, 6_649_589.56) === 44.33 && usoDeLinea(0, 100) === null)

const cuerpoResumen = renderToString(
  createElement(DetalleMovimientos, { movimientos: sesenta.movimientos, desde: '2026-08-01' }),
)
chequear(
  'documentos',
  'Detalle de Movimientos: mismas columnas, saldo inicial y TOTAL',
  ['Fecha', 'Comprobante', 'Vencimiento', 'Saldo Inicial $', 'Debe $', 'Haber $', 'Saldo $'].every((c) => cuerpoResumen.includes(`>${c}<`)) &&
    cuerpoResumen.includes('>01/08/2026<') &&
    cuerpoResumen.includes('>Saldo Inicial<') &&
    cuerpoResumen.includes('>TOTAL<'),
)
/* El saldo inicial de CADA fila es el de su movimiento: con cuánto venía la cuenta antes de moverse. */
chequear(
  'documentos',
  'cada fila muestra su propio saldo inicial',
  cuerpoResumen.includes(`>${money(sesenta.movimientos[1].saldoInicial)}<`),
)
/* El crédito de la cuenta NO es parte del resumen: es una foto de hoy, y ya está en la ficha. */
chequear(
  'documentos',
  'el resumen NO lleva la franja de crédito',
  ['Límite de crédito', 'Línea utilizada', 'Crédito disponible', 'Uso de línea'].every(
    (c) => !cuerpoResumen.includes(c),
  ),
)
const facturasPorTramo = [
  { ...facturas13[0], id: 'tr-1', tramo: 'noVencido' as const, estadoVencimiento: 'A Vencer' },
  { ...facturas13[1], id: 'tr-2', tramo: 'vencido0a15' as const },
  { ...facturas13[2], id: 'tr-3', tramo: 'vencidoMas60' as const },
]
const cuerpoEstado = renderToString(createElement(ComprobantesPendientes, { facturas: facturasPorTramo, cargando: false }))
chequear(
  'documentos',
  'cada fila VENCIDA lleva la clase de su tramo',
  cuerpoEstado.includes('doc-venc doc-venc--vencido0a15') &&
    cuerpoEstado.includes('doc-venc doc-venc--vencidoMas60'),
)
/* Lo que no venció no se pinta: es lo único que queda en el negro de la tabla. */
chequear(
  'documentos',
  'la factura NO vencida no lleva color',
  !cuerpoEstado.includes('doc-venc--noVencido'),
)
chequear(
  'documentos',
  'las columnas del vencimiento no se distinguen entre sí por el grosor',
  !cuerpoEstado.includes('doc-fuerte doc-venc-txt'),
)
chequear(
  'documentos',
  'y pinta las CUATRO columnas del vencimiento (no el importe ni lo pagado)',
  (cuerpoEstado.split('doc-venc-txt').length - 1) / facturasPorTramo.length === 4,
)
chequear(
  'documentos',
  'Comprobantes Pendientes de Pago: mismas columnas, TOTALES y franja de deuda',
  ['Comprobante', 'Vencimiento', 'Importe $', 'Pagado $', 'Pendiente $', 'Estado de Vencimiento'].every((c) => cuerpoEstado.includes(`>${c}<`)) &&
    cuerpoEstado.includes('>TOTALES<') &&
    ['Total a vencer (al día)', 'Total vencido', 'Deuda total pendiente'].every((c) => cuerpoEstado.includes(c)),
)

/* ===== Columnas del envío ===== */

chequear('envío', 'medio: Email siempre, Whatsapp sumado', JSON.stringify(MEDIO_ENVIO_RESUMEN_IDS) === '{"Email":[1],"WhatsApp":[2],"Ambos":[1,2]}')
chequear(
  'envío',
  'columnas de medio, contactos y estado',
  COL.ctaCte.medioEnvioResumen === 'dropdown_mm76hb6t' &&
    COL.ctaCte.contactosResumen === 'board_relation_mm767f4p' &&
    COL.ctaCte.estadoEnvioResumen === 'color_mm76ca15',
)
chequear('envío', 'la app pide "Enviar" y espera Enviado / Error de Envio', ESTADO_ENVIO_RESUMEN_INDEX.enviar === 3 && ESTADO_ENVIO_RESUMEN_INDEX.enviado === 1 && ESTADO_ENVIO_RESUMEN_INDEX.error === 2)
chequear('emisión', 'formato y "Generar" sobre la cuenta', COL.ctaCte.formatoResumen === 'dropdown_mm76p5gd' && COL.ctaCte.estadoResumen === 'color_mm76s2eq')
chequear(
  'emisión',
  'EMITIR escribe formato + Fecha Desde + Fecha Hasta + Incluye Estado (INCLUIR = tildado) en una sola mutación',
  JSON.stringify(columnasDatosResumen('Ambos', periodoDeRango('ultimos30', HOY), true)) ===
    '{"dropdown_mm76p5gd":{"ids":[1,2]},"date_mm7643hk":{"date":"2026-08-15"},"date_mm76jbba":{"date":"2026-09-14"},"boolean_mm767m9h":{"checked":"true"}}',
)
chequear(
  'emisión',
  'NO INCLUIR destilda boolean_mm767m9h (null), no lo omite',
  JSON.stringify(columnasDatosResumen('PDF', periodoDeRango('ultimos15', HOY), false)) ===
    '{"dropdown_mm76p5gd":{"ids":[1]},"date_mm7643hk":{"date":"2026-08-30"},"date_mm76jbba":{"date":"2026-09-14"},"boolean_mm767m9h":null}',
)
/* Las fechas que se escriben en la cuenta son las del período CRUZADO, no las del rango suelto. */
chequear(
  'emisión',
  'con ventana y fechas se escribe el período cruzado',
  JSON.stringify(
    columnasDatosResumen(
      'PDF',
      periodoDelCriterio(criterio({ rango: 'ultimoAnio', desde: '2026-01-01', hasta: '2026-03-01' }), HOY).periodo!,
      false,
    ),
  ) === '{"dropdown_mm76p5gd":{"ids":[1]},"date_mm7643hk":{"date":"2026-01-01"},"date_mm76jbba":{"date":"2026-03-01"},"boolean_mm767m9h":null}',
)

if (fallas > 0) {
  console.error(`\n${fallas} chequeo(s) fallaron`)
  process.exit(1)
}
console.log('\nTodo OK')
