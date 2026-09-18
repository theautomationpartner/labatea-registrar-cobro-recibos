/**
 * Humo del módulo de RESUMEN DE CTA CTE: renderiza las cuatro etapas contra el estado real (el
 * reducer, no un mock) y fija las reglas que la operación no puede perder —el período, la limpieza
 * del nombre de un movimiento, la caché de la lista y qué invalida un resumen ya emitido—. Mismo
 * criterio que `rechazos.test.tsx`: no reemplaza probar la app en Monday.
 */
import { renderToString } from 'react-dom/server'
import { createElement, type ComponentType } from 'react'
import { DispatchContext, StateContext } from '@/state/context'
import {
  claveMovimientosCtaCte,
  hayOperacionEnCurso,
  initialState,
  reducer,
  type Action,
  type AppState,
} from '@/state/appState'
import { ClienteView } from '@/features/cliente/ClienteView'
import { EstadoCtaCteConfig } from '@/features/resumen/EstadoCtaCteConfig'
import { ComprobantesPendientes } from '@/features/resumen/ComprobantesPendientes'
import { DetalleMovimientos } from '@/features/resumen/DetalleMovimientos'
import { EstadoCtaCteView } from '@/features/resumen/EstadoCtaCteView'
import { RangoFechasView } from '@/features/resumen/RangoFechasView'
import { ResumenCtaCteView } from '@/features/resumen/ResumenCtaCteView'
import { comprobanteEnviable } from '@/features/shared/comprobantesEnviables'
import { RESUMEN_CTA_CTE_EMISIBLE } from '@/features/shared/emisiones'
import { CLIENTES } from '@/data/mock'
import { etiquetasDe, numeroDePaso, pasoAnterior, siguientePaso } from '@/lib/pasos'
import { operacionesPermitidas } from '@/lib/permisos'
import {
  comprobanteDeMovimiento,
  dentroDelPeriodo,
  detalleDeMovimientos,
  estadoDeCuenta,
  nombreSinCliente,
  nroDeFactura,
  paginar,
  paginasVisibles,
  periodoDeRango,
  totalesDeFacturas,
  totalesDelPeriodo,
} from '@/lib/resumenCtaCte'
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
import type { MovimientosDelPeriodo } from '@/types'

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
  'CON estado: cuatro etapas, con "Facturas que debe" antes de emitir',
  etiquetasDe('resumen', true).join('|') ===
    'Seleccionar Cliente|Seleccionar Rango de Fechas|Facturas que debe|Emitir y Enviar',
)
/* "Facturas que debe" es una etapa opcional: sin el estado de cuenta no hay facturas que listar,
   así que del período se va derecho a la emisión. */
chequear(
  'recorrido',
  'SIN estado: tres etapas, del período a la emisión',
  etiquetasDe('resumen').join('|') ===
    'Seleccionar Cliente|Seleccionar Rango de Fechas|Emitir y Enviar',
)
chequear(
  'recorrido',
  'SIN estado: el paso que sigue al período es la emisión',
  siguientePaso('rangoFechas', 'resumen') === 'resumenCtaCte' &&
    siguientePaso('rangoFechas', 'resumen', true) === 'estadoCtaCte',
)
chequear(
  'recorrido',
  'SIN estado: volver desde la emisión lleva al período',
  pasoAnterior('resumenCtaCte', 'resumen') === 'rangoFechas' &&
    pasoAnterior('resumenCtaCte', 'resumen', true) === 'estadoCtaCte',
)
chequear(
  'recorrido',
  'SIN estado: la emisión es el paso 3',
  numeroDePaso('resumenCtaCte', 'resumen') === 3 &&
    numeroDePaso('resumenCtaCte', 'resumen', true) === 4,
)
/* Pasar de INCLUIR a NO INCLUIR estando parado en "Facturas que debe" no puede dejar la
   navegación en una etapa que ya no existe. */
{
  const conEstado = reducer(
    reducer(enResumen, { type: 'setResumenEstadoCtaCte', estado: 'INCLUIR' }),
    { type: 'goto', paso: 'estadoCtaCte' },
  )
  const sinEstado = reducer(conEstado, { type: 'setResumenEstadoCtaCte', estado: 'NO_INCLUIR' })
  chequear(
    'recorrido',
    'sacar el estado saca la etapa y trae el avance al período',
    conEstado.paso === 'estadoCtaCte' && sinEstado.paso === 'rangoFechas' && sinEstado.pasoMaxIdx <= 2,
  )
}

/* ===== Paso 1 · "Estado de Cta Cte" ===== */

const paso1 = pintar(enResumen, ClienteView)
chequear('paso 1', 'muestra "Estado de Cta Cte" arriba del buscador', paso1.indexOf('Estado de Cta Cte') > -1 && paso1.indexOf('Estado de Cta Cte') < paso1.indexOf('unified-toolbar'))
chequear('paso 1', 'sin elegir, el pie reclama el estado de cuenta', paso1.includes('Indicá si el resumen incluye el estado de la cuenta corriente'))
chequear('paso 1', 'NO muestra "¿Qué vas a cobrar?"', !paso1.includes('¿Qué vas a cobrar?'))

const pintarConfig = (estado: AppState, marcar: boolean) =>
  pintar(estado, () => createElement(EstadoCtaCteConfig, { marcarFaltante: marcar }))
chequear('paso 1', 'intentar avanzar sin elegir deja la caja en rojo', pintarConfig(enResumen, true).includes('cfgbox--error'))
chequear(
  'paso 1',
  'con una opción elegida el rojo se va solo',
  !pintarConfig(aplicar(enResumen, [{ type: 'setResumenEstadoCtaCte', estado: 'INCLUIR' }]), true).includes('cfgbox--error'),
)

/* ===== El período ===== */

const HOY = new Date(2026, 8, 14)
chequear('período', 'últimos 15 días', JSON.stringify(periodoDeRango('ultimos15', HOY)) === '{"desde":"2026-08-30","hasta":"2026-09-14"}')
chequear('período', 'último año es desde la misma fecha del año pasado', periodoDeRango('ultimoAnio', HOY).desde === '2025-09-14')
const p = periodoDeRango('ultimos30', HOY)
chequear('período', 'las dos puntas entran', dentroDelPeriodo(p.desde, p) && dentroDelPeriodo(p.hasta, p))
chequear('período', 'un día antes no entra', !dentroDelPeriodo('2026-08-14', p))
chequear('período', 'sin fecha no entra en ninguno', !dentroDelPeriodo('', p))

/* ===== El nombre de un movimiento, sin el cliente ===== */

const titular = { codigo: '7001', name: 'La Batea S.A TEST' }
chequear('nombre', 'quita código y razón social', nombreSinCliente('Movimiento - VTA-108 - 7001 - La Batea S.A', titular) === 'Movimiento - VTA-108')
chequear('nombre', 'deja intacto un nombre sin el cliente', nombreSinCliente('Anticipo - RECIBO-074', titular) === 'Anticipo - RECIBO-074')
chequear('nombre', 'nunca queda vacío', nombreSinCliente('7001 - La Batea S.A TEST', titular) === '7001 - La Batea S.A TEST')

/* ===== La lectura (modo local) ===== */

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

const sesenta = await getMovimientosCtaCte(cliente, 'ultimos60')
chequear('lectura', 'filtra por período', sesenta.movimientos.map((m) => m.id).join() === 'm-2,m-3,m-4,m-5,m-6,m-7')
chequear('lectura', 'cuenta los que no tienen fecha', sesenta.sinFecha === 1)
const venta = sesenta.movimientos.find((m) => m.id === 'm-3')
chequear('lectura', 'la venta pendiente se identifica por su factura, con vencimiento', venta?.comprobante === 'VTA-104' && venta.vencimiento !== '')
const cobro = sesenta.movimientos.find((m) => m.id === 'm-2')
chequear('lectura', 'el cobro, por su recibo y sin vencimiento', cobro?.comprobante === 'RECIBO-061' && cobro.vencimiento === '' && cobro.tipo === 'Cobro')
chequear('lectura', 'el anticipo, con su ID', sesenta.movimientos.find((m) => m.id === 'm-4')?.comprobante === 'Pago por Anticipo - ANTICIPO-015')
const anio = await getMovimientosCtaCte(cliente, 'ultimoAnio')
chequear('lectura', 'el último año incluye el movimiento viejo', anio.movimientos.some((m) => m.id === 'm-1'))
chequear('lectura', 'y el saldo inicial', anio.movimientos.find((m) => m.id === 'm-0')?.comprobante === 'Saldo Inicial')

/* ===== Caché y qué invalida un resumen emitido ===== */

const conCliente = aplicar(enResumen, [
  { type: 'setResumenEstadoCtaCte', estado: 'NO_INCLUIR' },
  { type: 'setCliente', cliente },
  { type: 'setResumenRango', rango: 'ultimos60' },
])
const clave = claveMovimientosCtaCte(cliente.id, 'ultimos60')
const conLista = aplicar(conCliente, [{ type: 'setMovimientosCtaCte', resultado: sesenta, clave }])
chequear('caché', 'la lista vigente se guarda con su clave', conLista.movimientosCtaCteClave === clave && conLista.ctaCteId === 'ctacte-mock')

const tardia: MovimientosDelPeriodo = { ctaCteId: 'x', movimientos: [], sinFecha: 0, mercaderiaPendFacturar: 0 }
const conTardia = aplicar(conLista, [
  { type: 'setMovimientosCtaCte', resultado: tardia, clave: claveMovimientosCtaCte(cliente.id, 'ultimos15') },
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
  'cambiar el período deja el resumen sin emitir y el envío por hacer',
  otroPeriodo.emisionResumen.fase === 'idle' && otroPeriodo.resumenCtaCteId === null && !otroPeriodo.documentoEnviado,
)

const generando = aplicar(conLista, [{ type: 'setEmisionResumen', emision: { fase: 'emitiendo' } }])
chequear('emisión', 'generándose, no se cambia el período', aplicar(generando, [{ type: 'setResumenRango', rango: 'ultimos15' }]).resumenRango === 'ultimos60')
chequear('emisión', 'generándose, no se cambia de cliente', aplicar(generando, [{ type: 'setCliente', cliente: CLIENTES[1] }]).cliente?.id === cliente.id)

const otroCliente = aplicar(conLista, [{ type: 'setCliente', cliente: CLIENTES[1] }])
chequear(
  'cliente',
  'cambiar de cliente descarta la lista pero conserva estado de cuenta y período',
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

/* ===== Las vistas no revientan ===== */

const paso2 = pintar(conLista, RangoFechasView)
chequear('paso 2', 'muestra la tabla con sus columnas', ['Nro de Comprobante', 'Fecha de Emisión', 'Fecha de Vencimiento', 'Saldo Inicial', 'Ventas', 'Cobros', 'Saldo Final'].every((c) => paso2.includes(c)))
const tabla = paso2.slice(paso2.indexOf('anticipos-v2 mov-ctacte'), paso2.indexOf('</table>'))
chequear('paso 2', 'usa las clases de la tabla de anticipos', paso2.indexOf('mov-ctacte') > -1 && ['anticipos-v2', 'ant-tabla', 'ant-row', 'ant-nro', 'ant-detalle', 'ant-col-cen', 'ant-num'].every((c) => tabla.includes(c)))
chequear('paso 2', 'la tabla no tiene nada editable ni clickeable', !/<(input|a|button|select)\b/.test(tabla))
chequear('paso 2', 'avisa los movimientos sin fecha', paso2.includes('no tiene fecha de emisión cargada'))
chequear(
  'paso 2',
  'sin rango, pide elegirlo',
  pintar(aplicar(enResumen, [{ type: 'setCliente', cliente }]), RangoFechasView).includes('Elegí un rango de fechas'),
)

/* ===== Paginado y totales del paso 2 ===== */

const lista23 = Array.from({ length: 23 }, (_, i) => i + 1)
const p1 = paginar(lista23, 1, 10)
chequear('paginado', 'primera página: 10 filas, 3 páginas', p1.items.join() === '1,2,3,4,5,6,7,8,9,10' && p1.totalPaginas === 3 && p1.desde === 1 && p1.hasta === 10)
const p3 = paginar(lista23, 3, 10)
chequear('paginado', 'última página: lo que queda', p3.items.join() === '21,22,23' && p3.desde === 21 && p3.hasta === 23)
chequear('paginado', 'una página que ya no existe se acota a la última', paginar(lista23, 9, 10).pagina === 3)
chequear('paginado', 'pocas páginas: todas como botón', paginasVisibles(2, 3).join() === '1,2,3')
chequear('paginado', 'muchas páginas: puntas, vecinas y saltos', paginasVisibles(6, 12).join() === '1,…,5,6,7,…,12')

const base23 = sesenta.movimientos[0]
const movimientos23 = Array.from({ length: 23 }, (_, i) => ({
  ...base23,
  id: `x-${i + 1}`,
  comprobante: `RECIBO-${String(i + 1).padStart(3, '0')}`,
  ventas: 100,
  cobros: 40,
  saldoFinal: 1000 + i,
}))
const clave23 = claveMovimientosCtaCte(cliente.id, 'ultimos60')
const con23 = aplicar(conCliente, [
  { type: 'setMovimientosCtaCte', resultado: { ...sesenta, movimientos: movimientos23 }, clave: clave23 },
])
const paso2Largo = pintar(con23, RangoFechasView)
chequear('paso 2', 'más de 10 movimientos: muestra 10 filas', (paso2Largo.match(/mov-fila/g) ?? []).length === 10)
chequear('paso 2', 'y el paginador debajo de la tabla', paso2Largo.indexOf('mov-paginador') > paso2Largo.indexOf('</table>') && paso2Largo.includes('Página siguiente'))
chequear('paso 2', 'dice qué filas se ven', /Mostrando <strong>1<\/strong>–<strong>10<\/strong> de <strong>23<\/strong>/.test(paso2Largo))
chequear('paso 2', 'hasta 10 movimientos, sin paginador', !paso2.includes('mov-paginador'))

const tot = totalesDelPeriodo(movimientos23)
chequear('totales', 'suman TODO el período, no la página', tot.ventas === 2300 && tot.cobros === 920 && tot.saldoFinal === 1022)
chequear(
  'paso 2',
  'TOTAL VENTAS, TOTAL COBRADO y SALDO FINAL debajo de la tabla',
  ['TOTAL VENTAS', 'TOTAL COBRADO', 'SALDO FINAL'].every((r) => paso2Largo.indexOf(r) > paso2Largo.indexOf('mov-paginador')) &&
    paso2Largo.includes('$ 2.300,00') &&
    paso2Largo.includes('$ 920,00'),
)
chequear(
  'paso 2',
  'los totales son el panel del destino del pase, cerrando la card',
  paso2Largo.includes('pases-v2') &&
    paso2Largo.includes('cobro-card--cierre') &&
    ['entrega-panel cobro-imp-panel', 'entrega-panel-head', 'cobro-imp-row', 'cobro-imp-met', 'cobro-cab-sep', 'cobro-imp-num--total'].every((c) => paso2Largo.includes(c)) &&
    paso2Largo.lastIndexOf('cobro-imp-panel') > paso2Largo.lastIndexOf('mov-paginador'),
)
chequear('paso 2', 'sin tabla la card conserva su relleno', !pintar(aplicar(enResumen, [{ type: 'setCliente', cliente }]), RangoFechasView).includes('cobro-card--cierre'))

/* ===== Alto fijo de la tabla al paginar ===== */

chequear('alto fijo', 'la última página incompleta pide filas de relleno', p3.vacias === 7 && p1.vacias === 0)
chequear('alto fijo', 'la primera página, completa, no rellena', (paso2Largo.match(/mov-relleno/g) ?? []).length === 0)
const con13 = aplicar(conCliente, [
  { type: 'setMovimientosCtaCte', resultado: { ...sesenta, movimientos: movimientos23.slice(0, 13) }, clave: clave23 },
])
chequear('alto fijo', 'paginada, la tabla siempre reserva 10 filas', paginar(con13.movimientosCtaCte, 2, 10).items.length + paginar(con13.movimientosCtaCte, 2, 10).vacias === 10)
chequear('alto fijo', 'sin paginado no hay relleno', !paso2.includes('mov-relleno'))

/* ===== Paso 3 · Facturas que debe ===== */

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

const paso3SinLeer = pintar(conLista, EstadoCtaCteView)
chequear('paso 3', 'se llama "Facturas que debe"', paso3SinLeer.includes('Facturas que debe'))
chequear('paso 3', 'la bajada nombra al cliente', paso3SinLeer.includes(`A continuación se listarán las facturas que ${cliente.name} te debe y con qué vencimiento:`))
chequear('paso 3', 'mientras lee, lo dice', paso3SinLeer.includes('Buscando las facturas'))

const facturas23 = Array.from({ length: 13 }, (_, i) => ({
  ...adeudadas[0],
  id: `fa-${i}`,
  comprobante: `VTA-${200 + i}`,
  importe: 1000,
  cobrado: 100,
  pendiente: 900,
  estadoVencimiento: 'Vencido + 60',
  tonoVencimiento: 'vencida' as const,
}))
const conFacturas = aplicar(conLista, [{ type: 'setFacturasAdeudadas', facturas: facturas23, clienteId: cliente.id }])
const paso3 = pintar(conFacturas, EstadoCtaCteView)
chequear(
  'paso 3',
  'la tabla tiene sus 7 columnas',
  ['Nro Comprobante', 'Fecha de Emisión', 'Importe', 'Total Pagado', 'Pend de Pagar', 'Fecha de Vencimiento', 'Estado de Vencimiento'].every((c) => paso3.includes(`>${c}<`)),
)
const tabla3 = paso3.slice(paso3.indexOf('anticipos-v2 mov-ctacte'), paso3.indexOf('</table>'))
chequear('paso 3', 'misma tabla que el paso 2: mismas clases y nada clickeable', ['ant-tabla', 'ant-row', 'mov-fila', 'ant-nro', 'ant-col-cen'].every((c) => tabla3.includes(c)) && !/<(input|a|button|select)\b/.test(tabla3))
chequear('paso 3', 'mismo paginado de a 10', (paso3.match(/mov-fila/g) ?? []).length === 10 && /de <strong>13<\/strong> (<!-- -->)?facturas/.test(paso3))
chequear('paso 3', 'el estado de vencimiento va en su pastilla', paso3.includes('fact-estado is-pendiente'))
chequear(
  'paso 3',
  'TOTAL DEUDA, TOTAL COBRADO y DEUDA PENDIENTE en el panel del pase, de TODAS las facturas',
  ['TOTAL DEUDA', 'TOTAL COBRADO', 'DEUDA PENDIENTE'].every((r) => paso3.indexOf(r) > paso3.indexOf('mov-paginador')) &&
    paso3.includes('entrega-panel cobro-imp-panel') &&
    paso3.includes('cobro-card--cierre') &&
    paso3.includes('$ 13.000,00') &&
    paso3.includes('$ 11.700,00'),
)
chequear('paso 3', 'otro cliente descarta las facturas', aplicar(conFacturas, [{ type: 'setCliente', cliente: CLIENTES[1] }]).facturasAdeudadasClienteId === null)
chequear('paso 3', 'una respuesta de otro cliente se ignora', aplicar(conLista, [{ type: 'setFacturasAdeudadas', facturas: facturas23, clienteId: 'otro' }]).facturasAdeudadas.length === 0)

const paso4 = pintar(conLista, ResumenCtaCteView)
chequear('paso 4', 'el campo Formato va antes del botón de emitir', paso4.indexOf('Formato') > -1 && paso4.indexOf('Formato') < paso4.indexOf('Emitir Resumen Cta Cte'))
chequear('paso 4', 'ofrece Excel, PDF y Ambos', paso4.includes('>Excel<') && paso4.includes('>PDF<') && paso4.includes('>Ambos<'))
chequear('paso 4', 'muestra el comprobante a generar y el envío con WhatsApp opcional', paso4.includes('Comprobante a generar') && paso4.includes('envío por WhatsApp'))
chequear('paso 4', 'la card del comprobante nace cerrada', paso4.includes('aria-expanded="false"') && !paso4.includes('mov-ctacte'))

/* ===== Paso 4 · documentos a generar ===== */

const cuenta = (html: string, texto: string) => html.split(texto).length - 1
chequear('documentos', 'NO INCLUIR: sólo la card del resumen', cuenta(paso4, 'class="comp-card"') === 1 && !paso4.includes('class="comp-tit">Estado de Cta Cte'))
const paso4Incluye = pintar(
  aplicar(conLista, [
    { type: 'setResumenEstadoCtaCte', estado: 'INCLUIR' },
    { type: 'setFacturasAdeudadas', facturas: facturas23.slice(0, 3), clienteId: cliente.id },
  ]),
  ResumenCtaCteView,
)
chequear('documentos', 'INCLUIR: dos cards, resumen y estado de cuenta', cuenta(paso4Incluye, 'class="comp-card"') === 2 && paso4Incluye.includes('class="comp-tit">Estado de Cta Cte'))
chequear('documentos', 'las dos llevan "Documento Cta Cte"', cuenta(paso4Incluye, '>Documento Cta Cte<') === 2)
chequear('documentos', 'las dos nacen cerradas', cuenta(paso4Incluye, 'class="comp-toggle" aria-expanded="false"') === 2)

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
  createElement(DetalleMovimientos, {
    movimientos: sesenta.movimientos,
    desde: '2026-08-01',
    cliente: { ...cliente, limit: 15_000_000, lineaUtilizada: 6_649_589.56, disponible: 8_350_410.44 },
    mercaderiaPendFacturar: 1_430_000,
  }),
)
chequear(
  'documentos',
  'Detalle de Movimientos: mismas columnas, saldo inicial, TOTAL y franja de crédito',
  ['Fecha', 'Comprobante', 'Vencimiento', 'Debe $', 'Haber $', 'Saldo $'].every((c) => cuerpoResumen.includes(`>${c}<`)) &&
    cuerpoResumen.includes('>01/08/2026<') &&
    cuerpoResumen.includes('>Saldo Inicial<') &&
    cuerpoResumen.includes('>TOTAL<') &&
    ['Límite de crédito', 'Línea utilizada', 'Crédito disponible', 'Uso de línea', 'Mercadería pend. facturar'].every((c) => cuerpoResumen.includes(c)) &&
    cuerpoResumen.includes('44,33%') &&
    cuerpoResumen.includes('$ 1.430.000,00'),
)
const cuerpoEstado = renderToString(createElement(ComprobantesPendientes, { facturas: facturas23.slice(0, 3), cargando: false }))
chequear(
  'documentos',
  'Comprobantes Pendientes de Pago: mismas columnas, TOTALES y franja de deuda',
  ['Comprobante', 'Vencimiento', 'Importe $', 'Pagado $', 'Pendiente $', 'Estado de Vencimiento'].every((c) => cuerpoEstado.includes(`>${c}<`)) &&
    cuerpoEstado.includes('>TOTALES<') &&
    ['Total a vencer (al día)', 'Total vencido', 'Deuda total pendiente'].every((c) => cuerpoEstado.includes(c)),
)
chequear('paso 4', 'la bajada no nombra a Monday', paso4.includes('Emití el resumen de cuenta corriente y enviáselo al cliente.'))
chequear('paso 4', 'la ficha ya no muestra la fecha de emisión', !paso4.includes('Fecha de Emisión'))
chequear(
  'paso 4',
  '"Mercaderia Pend de Facturar" va debajo del saldo final, con el importe de la cuenta',
  paso4.indexOf('Mercaderia Pend de Facturar') > paso4.indexOf('Saldo final del período') &&
    conLista.mercaderiaPendFacturar === 286_621.81 &&
    paso4.includes('286.621,81'),
)
chequear('lectura', 'trae la mercadería pendiente de facturar de la cuenta', sesenta.mercaderiaPendFacturar === 286_621.81)

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

if (fallas > 0) {
  console.error(`\n${fallas} chequeo(s) fallaron`)
  process.exit(1)
}
console.log('\nTodo OK')
