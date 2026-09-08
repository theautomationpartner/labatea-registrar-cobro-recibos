/**
 * Humo del módulo de RECHAZO DE CHEQUE: renderiza las tres etapas contra el estado real (el
 * reducer, no un mock) y avisa si alguna revienta. Mismo criterio que `pagos.test.tsx`: no
 * reemplaza probar la app en Monday, sirve para lo que un typecheck no ve.
 *
 * Y fija la regla que la operación no puede perder: se elige UN cheque. La exclusión la resuelve el
 * reducer, así que se prueba ahí —donde vive— y no simulando clicks en la tabla.
 */
import { renderToString } from 'react-dom/server'
import { createElement, type ComponentType } from 'react'
import { DispatchContext, StateContext } from '@/state/context'
import { initialState, reducer, type Action, type AppState } from '@/state/appState'
import { ClienteView } from '@/features/cliente/ClienteView'
import { etiquetaCheque } from '@/features/pagos/TablaChequesCartera'
import { ChequeRechazadoView } from '@/features/rechazos/ChequeRechazadoView'
import { ProveedorAcreedorView } from '@/features/rechazos/ProveedorAcreedorView'
import { CHEQUES_EN_CARTERA, CLIENTES, PROVEEDORES } from '@/data/mock'
import {
  BOARDS,
  CHEQUE_CARTERA_ESTADO_INDEX,
  COL,
  COL_CHEQUE_USADO,
} from '@/services/monday/columns'
import { nombreMovimientoRechazo } from '@/services/monday/rechazoCheque'

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

/* El módulo entero arranca con el cambio de operación: es lo que fija el recorrido de tres etapas
   (ver `recorridoDe`). Sin eso, el estado seguiría siendo el de Cobros. */
const enRechazos = aplicar(initialState, [{ type: 'setOperacionApp', operacion: 'RECHAZOS' }])
const [ch1, ch2] = CHEQUES_EN_CARTERA
const cliente = CLIENTES[0]
const proveedor = PROVEEDORES[0]

/* ===== El recorrido ===== */

chequear('recorrido', 'el módulo fija las tres etapas', enRechazos.tipoOperacion === 'rechazos')
/* ===== La regla: UN cheque =====
   No es una validación que se pueda saltear desde la UI: el estado guarda un id y no un mapa, así
   que dos cheques marcados a la vez no tienen dónde existir. Estos casos lo dejan escrito. */

const conCheque = aplicar(enRechazos, [
  { type: 'setCliente', cliente },
  { type: 'toggleChequeRechazado', cheque: ch1 },
])
chequear('un solo cheque', 'marcar uno lo deja elegido', conCheque.chequeRechazadoId === ch1.id)

const conOtro = aplicar(conCheque, [{ type: 'toggleChequeRechazado', cheque: ch2 }])
chequear(
  'un solo cheque',
  'marcar otro REEMPLAZA al anterior, no se suman',
  conOtro.chequeRechazadoId === ch2.id,
)

const sinNinguno = aplicar(conOtro, [{ type: 'toggleChequeRechazado', cheque: ch2 }])
chequear('un solo cheque', 'volver a marcarlo lo desmarca', sinNinguno.chequeRechazadoId === null)

/* Cambiar de deudor invalida el cheque: la cartera es de ESE cliente. */
const otroCliente = aplicar(conCheque, [{ type: 'setCliente', cliente: CLIENTES[1] }])
chequear(
  'un solo cheque',
  'cambiar el cliente descarta el cheque marcado',
  otroCliente.chequeRechazadoId === null && otroCliente.chequesRechazoClienteId === null,
)

/* Al releer la lista se conserva el marcado SÓLO si sigue estando. */
const releidaSinEl = aplicar(conCheque, [
  { type: 'setChequesRechazo', cheques: [ch2], clienteId: cliente.id },
])
chequear(
  'un solo cheque',
  'si el cheque marcado ya no está en la lista, se desmarca',
  releidaSinEl.chequeRechazadoId === null,
)

/* ===== Lo que se escribe en Monday ===== */

chequear(
  'registro',
  'el movimiento se llama "Rechazo Cheque - №<nro>"',
  nombreMovimientoRechazo('00123456') === 'Rechazo Cheque - №00123456',
)
chequear(
  /* El mismo "№" con el que se nombra el movimiento en la cuenta corriente: la fila y el asiento
     tienen que llamar igual al mismo papel. */
  'registro',
  'la fila de la tabla nombra el cheque como "№<nro> - <tipo>"',
  etiquetaCheque({ ...ch1, numero: '15935562', tipo: 'Cheque' }) === '№15935562 - Cheque' &&
    etiquetaCheque({ ...ch1, numero: '15935562', tipo: 'eCheq' }) === '№15935562 - Echeq',
)
chequear(
  /* Sin número el "№" NO va: lo que queda es el código del ítem, que no es el número del cheque. */
  'registro',
  'sin número cargado cae al código del ítem, y sin "№"',
  etiquetaCheque({ ...ch1, numero: '  ', codigo: 'CHEQUE-07' }) === 'CHEQUE-07 - Cheque',
)
chequear(
  'registro',
  'la lista sale del tablero de USADOS (18426604104), no del de cartera',
  BOARDS.chequesUsados === 18426604104 && BOARDS.chequesUsados !== BOARDS.chequesCartera,
)
chequear(
  'registro',
  'se filtra por "100% Usado" (1), que NO es el "Pendiente" con el que se lista la cartera',
  CHEQUE_CARTERA_ESTADO_INDEX.usado === 1 &&
    CHEQUE_CARTERA_ESTADO_INDEX.usado !== CHEQUE_CARTERA_ESTADO_INDEX.pendiente,
)
chequear(
  'registro',
  'el cheque queda "Rechazado" (índice 0), que NO es el "100% Usado" con el que se lista',
  CHEQUE_CARTERA_ESTADO_INDEX.rechazado === 0 &&
    CHEQUE_CARTERA_ESTADO_INDEX.rechazado !== CHEQUE_CARTERA_ESTADO_INDEX.usado,
)
chequear(
  /* Las dos columnas se llaman "🤖Fecha de Pago" y guardan lo mismo, pero son columnas distintas de
     tableros distintos: pedirle a usados el id de cartera devuelve la fila sin la fecha, en
     silencio. Es la única diferencia entre los dos descriptores. */
  'registro',
  'la fecha de pago de usados NO es la misma columna que la de cartera',
  COL_CHEQUE_USADO.fechaPago === 'date_mm702xrb' &&
    COL_CHEQUE_USADO.fechaPago !== COL.chequeCartera.fechaPago,
)
chequear(
  'registro',
  'y el resto de las columnas sí coincide con las de cartera',
  COL_CHEQUE_USADO.persona === COL.chequeCartera.persona &&
    COL_CHEQUE_USADO.estado === COL.chequeCartera.estado &&
    COL_CHEQUE_USADO.numero === COL.chequeCartera.numero,
)

/* ===== Las tres etapas se dibujan ===== */

const etapas: {
  nombre: string
  estado: AppState
  Vista: ComponentType
  contiene: string[]
  /** Lo que NO tiene que estar. Prueba que algo se apagó, no sólo que algo aparece. */
  noContiene?: string[]
}[] = [
  {
    nombre: '1 · cliente deudor',
    estado: enRechazos,
    Vista: ClienteView,
    contiene: ['Seleccionar Cliente Deudor', 'RECHAZO DE CHEQUE'],
  },
  {
    nombre: '2 · cheque rechazado',
    estado: aplicar(enRechazos, [
      { type: 'setCliente', cliente },
      { type: 'setChequesRechazo', cheques: CHEQUES_EN_CARTERA, clienteId: cliente.id },
    ]),
    Vista: ChequeRechazadoView,
    contiene: [
      'Seleccionar Cheque Rechazado',
      'Solo se puede seleccionar uno por',
      /* Las columnas son las mismas de la tabla de Pagos: si alguna se cae, esto lo delata. */
      'Fecha Vencimiento',
      'Banco',
      'Fecha Pago',
      /* Las dos columnas de origen, con sus códigos ya resueltos desde el ítem PADRE de cada
         subelemento: el cheque sólo conoce las líneas, no los documentos. */
      'ID Recibo',
      'ID Pago',
      'RECIBO-078',
      'IDPAGO-012',
    ],
  },
  {
    nombre: '3 · proveedor acreedor',
    estado: aplicar(enRechazos, [
      { type: 'setCliente', cliente },
      { type: 'setChequesRechazo', cheques: CHEQUES_EN_CARTERA, clienteId: cliente.id },
      { type: 'toggleChequeRechazado', cheque: ch1 },
      { type: 'setProveedorAcreedor', proveedor },
    ]),
    Vista: ProveedorAcreedorView,
    contiene: ['Seleccionar Proveedor Acreedor', 'Finalizar Operación', 'Proveedor acreedor'],
    noContiene: [
      /* El acreedor lo resuelve el sistema a partir del cheque: acá ya no hay buscador. */
      'Buscar proveedor por código',
    ],
  },
  {
    nombre: '3b · acreedor resolviéndose',
    /* Sin proveedor cargado la vista arranca consultando: la ficha va en skeleton QUIETO y lo que
       avisa que hay una consulta en curso es el texto, no una animación. */
    estado: aplicar(enRechazos, [
      { type: 'setCliente', cliente },
      { type: 'setChequesRechazo', cheques: CHEQUES_EN_CARTERA, clienteId: cliente.id },
      { type: 'toggleChequeRechazado', cheque: ch1 },
    ]),
    Vista: ProveedorAcreedorView,
    contiene: ['cliente-ficha--vacio', 'Buscando al proveedor'],
    noContiene: ['cliente-ficha--cargando', 'fa-spin'],
  },
]

for (const etapa of etapas) {
  let html = ''
  try {
    html = pintar(etapa.estado, etapa.Vista)
  } catch (e) {
    chequear('etapa', `${etapa.nombre} · se dibuja (${(e as Error).message})`, false)
    continue
  }
  chequear('etapa', `${etapa.nombre} · se dibuja`, true)
  for (const texto of etapa.contiene) {
    chequear('etapa', `${etapa.nombre} · dice "${texto}"`, html.includes(texto))
  }
  for (const texto of etapa.noContiene ?? []) {
    chequear('etapa', `${etapa.nombre} · NO dice "${texto}"`, !html.includes(texto))
  }
}

console.log(fallas === 0 ? '\nrechazos: OK' : `\nrechazos: ${fallas} falla(s)`)
process.exit(fallas === 0 ? 0 : 1)
