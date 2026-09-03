/**
 * Humo del módulo de PAGOS: renderiza las tres etapas contra el estado real (el reducer, no un
 * mock) y avisa si alguna revienta. No reemplaza probar la app en Monday; sirve para lo que un
 * typecheck no ve: un import roto, un hook mal usado o un acceso a un campo que no existe.
 *
 * Cubre además la regla de CATEGORÍA de los TRES módulos —Cobros y Pases exigen "Clientes", Pagos
 * exige "Proveedores"—, y a propósito en un solo archivo: es la misma función mirada desde cada
 * lado del mostrador, así que una asimetría entre las dos es justamente lo que hay que atajar.
 */
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { DispatchContext, StateContext } from '@/state/context'
import { initialState, reducer, type Action, type AppState } from '@/state/appState'
import { PagosView } from '@/features/pagos/PagosView'
import { ROTULOS_DOC_OP, ROTULOS_DOC_RECIBO } from '@/features/recibo/ReciboAGenerar'
import { nombreAnticipoPago } from '@/services/monday/ordenPago'
import {
  PROVEEDORES,
  FACTURAS_COMPRA_PENDIENTES,
  ANTICIPOS_PENDIENTES_PROVEEDOR,
} from '@/data/mock'
import { ROTULOS_COBRO, ROTULOS_PAGO } from '@/lib/cobros'

const aplicar = (estado: AppState, acciones: Action[]): AppState =>
  acciones.reduce((acc, a) => reducer(acc, a), estado)

const pintar = (estado: AppState) =>
  renderToString(
    createElement(
      StateContext.Provider,
      { value: estado },
      createElement(
        DispatchContext.Provider,
        { value: () => undefined },
        createElement(PagosView),
      ),
    ),
  )

/* Fallas de los bloques que corren ANTES del render (el reducer se puede probar directo). Se
   suman al contador general cuando éste nace, más abajo. */
let fallasAplicacion = 0

const casos: {
  nombre: string
  estado: AppState
  contiene: string[]
  /** Lo que NO tiene que estar. Sirve para probar que algo se apagó, no sólo que algo aparece. */
  noContiene?: string[]
}[] = []

// ETAPA 1 · sin nada elegido
const etapa1 = aplicar({ ...initialState, operacionApp: 'PAGOS' }, [])
casos.push({
  nombre: 'etapa 1 · vacía',
  estado: etapa1,
  contiene: ['Que vas a Pagar?', 'Facts de Compra Pendientes de Pago', 'Seleccionar Proveedor'],
})

// ETAPA 1 · proveedor SIN cuenta corriente (el bloqueo del Módulo 3)
const sinCta = aplicar(etapa1, [
  { type: 'setTipoOperacionPago', tipo: 'facturasCompra' },
  { type: 'setProveedor', proveedor: PROVEEDORES[1] },
])
casos.push({
  nombre: 'etapa 1 · proveedor sin cta cte',
  estado: sinCta,
  contiene: ['El proveedor no tiene cuenta corriente asignada'],
})

// ETAPA 2 · proveedor válido con sus facturas
const etapa2 = aplicar(etapa1, [
  { type: 'setTipoOperacionPago', tipo: 'facturasCompra' },
  { type: 'setProveedor', proveedor: PROVEEDORES[0] },
  { type: 'gotoPago', paso: 'facturasCompra' },
  {
    type: 'setFacturasCompra',
    facturas: FACTURAS_COMPRA_PENDIENTES,
    proveedorId: PROVEEDORES[0].id,
  },
])
casos.push({
  nombre: 'etapa 2 · listado',
  estado: etapa2,
  contiene: ['TOTAL A PAGAR', 'FC-A-0001-00004521', 'Seleccionar todos', 'Ver todas'],
})

/* ETAPA 2 · la factura SIN "$ Total a pagar" cargado en el tablero. Es el caso del ítem 12740955471
   de "❓ Facturas Compra Pend de Pago": estado "Pend de Pagar 100%" pero su total vacío, así que la
   fórmula "Pend de Pagar $" da 0. Antes desaparecía del listado y la pantalla afirmaba que el
   proveedor no debía nada; ahora se muestra, con el motivo por el que no se puede imputar. */
const sinTotal = aplicar(etapa2, [
  {
    type: 'setFacturasCompra',
    facturas: [
      {
        id: 'fc-sin-total',
        nro: 'PROVEEDOR TEST - №0002-00003313',
        vencimiento: '2026-08-30',
        total: 0,
        pagado: 0,
        pagadoPct: 0,
        pendiente: 0,
        estado: 'Pend de Pagar 100%',
        parcial: false,
      },
    ],
    proveedorId: PROVEEDORES[0].id,
  },
])
casos.push({
  nombre: 'etapa 2 · factura sin total cargado: se ve y explica por qué no se puede imputar',
  estado: sinTotal,
  contiene: ['PROVEEDOR TEST - №0002-00003313', 'Sin &quot;$ Total a pagar&quot; cargado en el tablero'],
})

/* La FECHA DE EMISIÓN es de Cobros: la factura de compra no publica ese dato, así que su tabla no
   dibuja la columna en vez de llenarla de guiones. Los dos rótulos se comparan juntos porque es una
   sola tabla parametrizada, y lo que hay que atajar es que se filtre de un circuito al otro. */
const columnaEmision: { nombre: string; ok: boolean }[] = [
  { nombre: 'COBROS la muestra', ok: ROTULOS_COBRO.mostrarEmision === true },
  { nombre: 'PAGOS no', ok: ROTULOS_PAGO.mostrarEmision === false },
]

for (const c of columnaEmision) {
  if (!c.ok) {
    fallasAplicacion++
    console.log(`FALLA  emisión · ${c.nombre}`)
  } else {
    console.log(`OK     emisión · ${c.nombre}`)
  }
}

casos.push({
  nombre: 'etapa 2 · la tabla de PAGOS no trae la columna de emisión',
  estado: etapa2,
  contiene: ['>Vencimiento<'],
  noContiene: ['>Emisión<'],
})

casos.push({
  nombre: 'etapa 2 · los dos importes se leen igual, sin rojo en el pendiente',
  estado: etapa2,
  contiene: ['Total Factura', 'Saldo Pendiente'],
  noContiene: [
    // El rojo queda para la mora, no para un saldo que todavía no es un problema.
    'fact-pend',
    // El rótulo viejo de la columna.
    'Importe Original',
  ],
})

// ETAPA 2 · con una factura elegida: se despliega el panel con sus rótulos
const conFactura = aplicar(etapa2, [
  { type: 'toggleFacturaCompra', factura: FACTURAS_COMPRA_PENDIENTES[0] },
])
casos.push({
  nombre: 'etapa 2 · panel de imputación',
  estado: conFactura,
  contiene: ['Importe a Pagar $', 'Se paga', 'Monto a pagar', 'Pend de pagar resultante'],
})

// ETAPA 3 · registro
const etapa3 = aplicar(conFactura, [{ type: 'gotoPago', paso: 'pago' }])
casos.push({
  nombre: 'etapa 3 · registro',
  estado: etapa3,
  contiene: [
    'Seleccionar Caja',
    'Cheque',
    // Las tarjetas se fueron del catálogo: no se usan para pagar.
    'Retencion GAN',
    'Cajas registradas',
    'Cajas',
    'TOTAL A PAGAR',
    'TOTAL PAGADO',
    'TOTAL DIFERENCIA',
    // Modalidad: arranca SIN elegir, con sus dos opciones.
    'Modalidad',
    'Seleccionar…',
    'En Cartera',
    'Nuevo',
    'Anbinder Aldo N.',
  ],
  noContiene: ['Tarjeta de Debito', 'Tarjeta de Credito'],
})

/* El importe de un CHEQUE ya registrado no se puede tocar: es el del documento que se entrega. La
   fila CONSERVA el campo —la columna se lee igual en todas— pero lo muestra bloqueado. */
const ETIQUETA_EDITABLE = 'Importe del pago (editable'
const ETIQUETA_FIJA = 'Importe del pago (lo fija el sistema'
const conCheque = aplicar(etapa3, [
  {
    type: 'agregarMovimientoCaja',
    movimiento: {
      formaPago: 'Cheque',
      importe: 350_000,
      modalidadCheque: 'cartera',
      chequeId: 'ch-1',
      numeroCheque: '00123456',
      bancoEmisor: 'Banco Galicia',
    },
  },
])
casos.push({
  nombre: 'etapa 3 · el importe de un cheque registrado NO es editable',
  estado: conCheque,
  contiene: [
    // El valor sigue a la vista...
    '350.000',
    // ...dentro del MISMO campo que el resto de las filas, pero apagado y de sólo lectura.
    'cobro-imp-edit--fijo',
    'readonly=""',
    ETIQUETA_FIJA,
    // Y con el motivo a mano, en el título del campo.
    'quitá la caja y cargá el cheque que corresponde',
  ],
  noContiene: [ETIQUETA_EDITABLE],
})

/* La RETENCIÓN se bloquea por el mismo motivo y de la misma forma: su importe sale de una fórmula
   fiscal, no de una decisión. */
const conRetencion = aplicar(etapa3, [
  {
    type: 'agregarMovimientoCaja',
    movimiento: { formaPago: 'Efectivo', importe: 300_000 },
  },
  {
    type: 'agregarMovimientoCaja',
    movimiento: { formaPago: 'Retencion GAN', importe: 14_000, baseImponible: 700_000 },
  },
])
casos.push({
  nombre: 'etapa 3 · el importe de una retención tampoco se edita',
  estado: conRetencion,
  contiene: [
    'cobro-imp-edit--fijo',
    ETIQUETA_FIJA,
    'El importe de una retención lo calcula el sistema',
    // La otra caja de la misma tabla sí conserva su campo editable: el bloqueo es por fila.
    ETIQUETA_EDITABLE,
  ],
})

/* Las demás cajas SÍ se ajustan en la tabla: es como se lleva la diferencia a cero sin rehacer la
   carga. Sin este caso, el anterior pasaría igual si el campo editable hubiera desaparecido para
   todos. */
const conEfectivo = aplicar(etapa3, [
  { type: 'agregarMovimientoCaja', movimiento: { formaPago: 'Efectivo', importe: 1_000 } },
])
casos.push({
  nombre: 'etapa 3 · el importe de una caja que no es cheque SÍ es editable',
  estado: conEfectivo,
  contiene: [ETIQUETA_EDITABLE],
  // Sin el bloqueo: es lo que separa "se muestra apagado" de "se muestra".
  noContiene: ['cobro-imp-edit--fijo'],
})

// ETAPA 3 · con la diferencia en CERO: el pago queda listo para confirmar
const cubierto = aplicar(etapa3, [
  {
    type: 'agregarMovimientoCaja',
    movimiento: { formaPago: 'Efectivo', importe: FACTURAS_COMPRA_PENDIENTES[0].pendiente },
  },
])
casos.push({
  nombre: 'etapa 3 · diferencia en 0',
  estado: cubierto,
  contiene: ['ya se puede confirmar', 'Confirmar pago'],
})

/* ===== ETAPA 4 · la orden de pago ===== */

/* Confirmar el pago AVANZA a la etapa 4: quedarse en la 3 dejaba la operación cerrada en pantalla
   pero sin documento. */
const enOrden = aplicar(cubierto, [{ type: 'confirmarPago' }, { type: 'gotoPago', paso: 'orden' }])
casos.push({
  nombre: 'etapa 4 · resumen de la orden con sus rótulos',
  estado: enOrden,
  contiene: [
    'Resumen de Orden de Pago',
    'Vendedor Pagador',
    'Proveedor razón social',
    'CUIT del Proveedor',
    'Fecha de PAGO',
    'Total Entregado',
    // "Total cancelado" es intocable: mismo rótulo que en el recibo.
    'Total cancelado',
    'EMITIR ORDEN DE PAGO',
    // El botón de cierre de la operación.
    'Finalizar Operación',
  ],
  noContiene: [
    'Resumen del recibo',
    'Vendedor cobrante',
    'Cliente razón social',
    'CUIT del Cliente',
    'Total recibido',
    'Emitir el recibo',
  ],
})

casos.push({
  nombre: 'etapa 4 · card del documento: sin leyenda y con "Facturas Canceladas"',
  estado: enOrden,
  contiene: [
    'Orden de Pago',
    'Documento de pago',
    'Facturas Canceladas',
    // Las tres métricas y los dos totales quedan intactos.
    'Comprobantes',
    'Formas de pago',
    'TOTAL ENTREGADO:',
    'TOTAL CANCELADO:',
  ],
  noContiene: ['RECIBIMOS CONFORME EL IMPORTE DETALLADO.'],
})

/* ===== La CONSTANCIA de retención =====
   Cuando el pago practicó una retención, la etapa 4 dibuja una segunda card —la constancia— debajo
   de la del documento. Sale con la orden, así que vive bajo el mismo "Comprobante a generar". */

const conRetencionEnOrden = aplicar(etapa3, [
  {
    type: 'agregarMovimientoCaja',
    movimiento: { formaPago: 'Efectivo', importe: FACTURAS_COMPRA_PENDIENTES[0].pendiente },
  },
  {
    type: 'agregarMovimientoCaja',
    movimiento: {
      formaPago: 'Retencion GAN',
      importe: 2_194.73,
      baseImponible: 109_736.25,
      alicuota: 2,
    },
  },
  { type: 'confirmarPago' },
  { type: 'gotoPago', paso: 'orden' },
])

casos.push({
  nombre: 'etapa 4 · la retención practicada trae su constancia',
  estado: conRetencionEnOrden,
  contiene: [
    // Cabecera de la card: título, etiqueta y el monto como valor.
    'Retencion GAN',
    'CONSTANCIA DE RETENCION',
    // El detalle, con las cinco columnas del documento.
    'Detalle de la Retención Practicada',
    'Régimen',
    'Comprobante Origen',
    'Base Imponible',
    'Alícuota',
    'Monto Retenido',
    // Los valores de la línea: comprobante de origen, base, alícuota y lo retenido.
    'Factura N° FC-A-0001-00004521',
    '109.736,25',
    '2.00%',
    '2.194,73',
    'TOTAL RETENIDO:',
    // Y la leyenda al pie.
    'Documento emitido según normativas vigentes de A.F.I.P',
  ],
})

casos.push({
  nombre: 'etapa 4 · sin retención NO hay constancia',
  estado: enOrden,
  noContiene: [
    'CONSTANCIA DE RETENCION',
    'Detalle de la Retención Practicada',
    'Documento emitido según normativas vigentes de A.F.I.P',
  ],
  contiene: ['Resumen de Orden de Pago'],
})

/* El estado, recorriendo el modo de punta a punta. */
const anticipoBase = aplicar({ ...initialState, operacionApp: 'PAGOS' }, [
  { type: 'setTipoOperacionPago', tipo: 'anticipo' },
  { type: 'setProveedor', proveedor: PROVEEDORES[0] },
  { type: 'gotoPago', paso: 'pago' },
  { type: 'setImporteAnticipo', importe: 250_000 },
  { type: 'setDetalleAnticipo', detalle: 'Adelanto campaña gruesa' },
  { type: 'setVencimientoAnticipo', vencimiento: '30/09/2026' },
])

casos.push({
  nombre: 'modo anticipo · sin Fecha Vto: el anticipo al proveedor no vence',
  estado: anticipoBase,
  contiene: ['Detalle'],
  noContiene: ['Fecha Vto', 'anticipo-venc'],
})

casos.push({
  nombre: 'modo anticipo · etapa 3 declara el importe y cierra la caja',
  estado: anticipoBase,
  contiene: [
    'Registrar Anticipo',
    'Importe del anticipo que se le entrega al proveedor',
    'Registrar anticipo',
    'Especificar con qué cajas se le entrega el anticipo al proveedor',
    'Confirmar anticipo',
  ],
  noContiene: [
    // Sin facturas: la cabecera no muestra el contador.
    'Facturas a pagar',
    'Importe del anticipo que entrega el cliente',
  ],
})

const anticipoCubierto = aplicar(anticipoBase, [
  { type: 'agregarMovimientoCaja', movimiento: { formaPago: 'Transferencia', importe: 250_000, bancoOrigenId: '7777', bancoOrigen: 'Credicoop' } },
  { type: 'confirmarPago' },
  { type: 'gotoPago', paso: 'orden' },
])

casos.push({
  nombre: 'modo anticipo · la orden lo ilustra como un anticipo',
  estado: anticipoCubierto,
  contiene: [
    'Resumen de Orden de Pago',
    // La card se dibuja en modo anticipo: pastilla y métrica propias.
    'Anticipo',
    'Concepto',
    '$ 250.000,00',
  ],
  noContiene: ['Facturas Canceladas'],
})

/* La tabla de lo cancelado dice lo MISMO que el PDF que emite el tablero: mismo título, mismas
   columnas y la línea con el nombre con el que se va a escribir el subelemento. */
casos.push({
  nombre: 'modo anticipo · la tabla habla como el documento emitido',
  estado: anticipoCubierto,
  contiene: [
    'Entrega de Anticipos',
    '>Anticipos<',
    'Fecha Emisión',
    'Fecha Venc.',
    'Importe Cancelado',
    // El nombre del subelemento, no una etiqueta parecida.
    'Anticipo · Adelanto campaña gruesa',
    // El vencimiento cargado en la etapa 3.
    '30/09/2026',
  ],
  noContiene: [
    // Los rótulos viejos de la tabla, que eran los del recibo.
    '<th>Concepto</th>',
    '<th class="ta-r">Importe</th>',
  ],
})

/* El RECIBO no se movió: su tabla del anticipo sigue en dos columnas. Es la mitad que la
   parametrización podría haber arrastrado, y este archivo no renderiza Cobros, así que se
   comprueba sobre los rótulos. */
const rotulosAnticipo: { nombre: string; ok: boolean }[] = [
  {
    nombre: 'el recibo conserva "Anticipo · Concepto · Importe", sin fechas',
    ok:
      ROTULOS_DOC_RECIBO.tablaAnticipo.titulo === 'Anticipo' &&
      ROTULOS_DOC_RECIBO.tablaAnticipo.columna === 'Concepto' &&
      ROTULOS_DOC_RECIBO.tablaAnticipo.importe === 'Importe' &&
      ROTULOS_DOC_RECIBO.tablaAnticipo.conFechas === false,
  },
  {
    nombre: 'la orden usa el vocabulario del PDF de pagos',
    ok:
      ROTULOS_DOC_OP.tablaAnticipo.titulo === 'Entrega de Anticipos' &&
      ROTULOS_DOC_OP.tablaAnticipo.columna === 'Anticipos' &&
      ROTULOS_DOC_OP.tablaAnticipo.importe === 'Importe Cancelado' &&
      ROTULOS_DOC_OP.tablaAnticipo.conFechas === true,
  },
  {
    nombre: 'la línea se nombra igual que el subelemento del tablero',
    ok: nombreAnticipoPago('Adelanto campaña gruesa') === 'Anticipo · Adelanto campaña gruesa',
  },
  {
    nombre: 'sin detalle cargado, la línea es "Anticipo" a secas',
    ok: nombreAnticipoPago('') === 'Anticipo' && nombreAnticipoPago(undefined) === 'Anticipo',
  },
]

for (const r of rotulosAnticipo) {
  if (!r.ok) {
    fallasAplicacion++
    console.log(`FALLA  anticipo · ${r.nombre}`)
  } else {
    console.log(`OK     anticipo · ${r.nombre}`)
  }
}

/* ===== MODO "Aplicación Anticipo contra Facturas de Compra" =====
   El saldo a favor que ya teníamos con el proveedor cancelando sus facturas de compra. Recorre las
   MISMAS cuatro etapas que un pago con dinero y reutiliza las tres primeras piezas tal cual; lo
   único propio es la etapa 3, donde no hay cajas. */

const aplicacionEnFacturas = aplicar({ ...initialState, operacionApp: 'PAGOS' }, [
  { type: 'setTipoOperacionPago', tipo: 'aplicacion' },
  { type: 'setProveedor', proveedor: PROVEEDORES[0] },
  { type: 'gotoPago', paso: 'facturasCompra' },
  {
    type: 'setFacturasCompra',
    facturas: FACTURAS_COMPRA_PENDIENTES,
    proveedorId: PROVEEDORES[0].id,
  },
  { type: 'toggleFacturaCompra', factura: FACTURAS_COMPRA_PENDIENTES[0] },
  { type: 'gotoPago', paso: 'pago' },
  {
    type: 'setAnticipos',
    anticipos: ANTICIPOS_PENDIENTES_PROVEEDOR,
    clienteId: PROVEEDORES[0].id,
  },
])

/* Marcar el anticipo. ACÁ estaba el nudo: el reducer proponía el importe contra las imputaciones de
   COBROS, que en este recorrido están vacías, así que daba "no falta nada por cubrir" y descartaba
   el click. La casilla no se marcaba nunca, la etapa 3 no cerraba y la 4 —que ya estaba escrita—
   era inalcanzable. */
const aplicacionElegida = aplicar(aplicacionEnFacturas, [
  { type: 'toggleAnticipo', anticipo: ANTICIPOS_PENDIENTES_PROVEEDOR[0] },
])

const faltaEnFacturas = FACTURAS_COMPRA_PENDIENTES[0].pendiente

const eleccion: { nombre: string; ok: boolean }[] = [
  {
    nombre: 'marcar el anticipo lo ELIGE (antes el click se perdía)',
    ok: ANTICIPOS_PENDIENTES_PROVEEDOR[0].id in aplicacionElegida.aplicaciones,
  },
  {
    nombre: 'propone lo que falta de las facturas de COMPRA',
    ok:
      aplicacionElegida.aplicaciones[ANTICIPOS_PENDIENTES_PROVEEDOR[0].id] ===
      Math.min(ANTICIPOS_PENDIENTES_PROVEEDOR[0].pendiente, faltaEnFacturas),
  },
  {
    nombre: 'desmarcar sigue siendo la salida para corregir',
    ok:
      Object.keys(
        aplicar(aplicacionElegida, [
          { type: 'toggleAnticipo', anticipo: ANTICIPOS_PENDIENTES_PROVEEDOR[0] },
        ]).aplicaciones,
      ).length === 0,
  },
  {
    /* El otro lado del mostrador no se movió: en Cobros el tope lo siguen dando las facturas de
       VENTA. Es la mitad que la rama nueva podría haber roto. */
    nombre: 'en COBROS el tope lo siguen poniendo las facturas de venta',
    ok:
      aplicar({ ...initialState, operacionApp: 'COBROS', imputaciones: { 'f-1': 50_000 } }, [
        { type: 'setAnticipos', anticipos: ANTICIPOS_PENDIENTES_PROVEEDOR, clienteId: 'c-1' },
        { type: 'toggleAnticipo', anticipo: ANTICIPOS_PENDIENTES_PROVEEDOR[0] },
      ]).aplicaciones[ANTICIPOS_PENDIENTES_PROVEEDOR[0].id] === 50_000,
  },
  {
    /* Con las imputaciones del OTRO módulo, el anticipo no se elige: es la prueba de que la rama
       mira el módulo activo y no simplemente "el mapa que tenga algo". */
    nombre: 'un pago NO se cubre con las imputaciones de un cobro',
    ok:
      Object.keys(
        aplicar({ ...initialState, operacionApp: 'PAGOS', imputaciones: { 'f-1': 50_000 } }, [
          { type: 'setAnticipos', anticipos: ANTICIPOS_PENDIENTES_PROVEEDOR, clienteId: 'p-1' },
          { type: 'toggleAnticipo', anticipo: ANTICIPOS_PENDIENTES_PROVEEDOR[0] },
        ]).aplicaciones,
      ).length === 0,
  },
]

for (const e of eleccion) {
  if (!e.ok) {
    fallasAplicacion++
    console.log(`FALLA  aplicación · ${e.nombre}`)
  } else {
    console.log(`OK     aplicación · ${e.nombre}`)
  }
}

casos.push({
  nombre: 'modo aplicación · etapa 3 lista los anticipos del PROVEEDOR',
  estado: aplicacionEnFacturas,
  contiene: [
    'Aplicar Anticipo',
    'Anticipos disponibles',
    'Saldos a favor con el proveedor pendientes de aplicar',
    // La MISMA tabla que en Cobros, con sus mismas columnas.
    'ant-tabla',
    'Pendiente de aplicar',
    'Importe a aplicar',
    'Restante Pends de Aplicar',
    // Los datos que se leen del tablero de proveedores.
    'Anticipo - ANTICIPO-04',
    'Adelanto por compra de insumos',
    // Los rótulos del egreso en la cabecera.
    'TOTAL A PAGAR',
  ],
  noContiene: [
    'Saldos a favor del cliente',
    // No hay cajas en este modo: el dinero ya estaba entregado.
    'Seleccionar Caja',
  ],
})

casos.push({
  nombre: 'modo aplicación · con el anticipo elegido la etapa 3 cierra',
  estado: aplicacionElegida,
  contiene: ['ant-row--on'],
})

/* Y la CUARTA etapa, que es a la que no se llegaba. */
const aplicacionEnOrden = aplicar(aplicacionElegida, [
  { type: 'confirmarPago' },
  { type: 'gotoPago', paso: 'orden' },
])

casos.push({
  nombre: 'modo aplicación · etapa 4 emite y envía la orden de pago',
  estado: aplicacionEnOrden,
  contiene: [
    'Resumen de Orden de Pago',
    'EMITIR ORDEN DE PAGO',
    'Finalizar Operación',
    // Lo entregado son los anticipos aplicados, no cajas.
    'Anticipo - ANTICIPO-04',
    'Facturas Canceladas',
    'Total cancelado',
  ],
  noContiene: ['Resumen del recibo', 'Emitir el recibo'],
})

casos.push({
  nombre: 'modo aplicación · la tabla de lo entregado se llama por lo que lista',
  estado: aplicacionEnOrden,
  contiene: ['>Anticipos<'],
  noContiene: [
    // La columna no nombra cajas: en este modo no salió plata por ninguna.
    'Forma de pago / Caja',
    // Y el nombre del anticipo no se repite: el ítem ya se llama "Anticipo - ...".
    'Anticipo Anticipo',
  ],
})

let fallas = fallasAplicacion
for (const c of casos) {
  try {
    const html = pintar(c.estado)
    const faltan = c.contiene.filter((t) => !html.includes(t))
    const sobran = (c.noContiene ?? []).filter((t) => html.includes(t))
    if (faltan.length > 0 || sobran.length > 0) {
      fallas++
      const partes = [
        faltan.length > 0 && `no encontró: ${faltan.join(' | ')}`,
        sobran.length > 0 && `no debería estar: ${sobran.join(' | ')}`,
      ].filter(Boolean)
      console.log(`FALLA  ${c.nombre} · ${partes.join(' · ')}`)
    } else {
      console.log(`OK     ${c.nombre}`)
    }
  } catch (e) {
    fallas++
    console.log(`ERROR  ${c.nombre} · ${(e as Error).message}`)
  }
}

/* Las reglas que deciden si una persona ENTRA a la operación se prueban sobre la función y no
   sobre el HTML: son el filtro previo a la pantalla, así que a esa altura no hay nada que
   renderizar. Es justamente lo que se quiere garantizar —que nada de un rechazado se muestre—. */
import { bloqueoPago, resumenPago, diferenciaSaldadaPago, rechazoAlSeleccionar } from '@/lib/pagosProveedor'
import { cumpleRol, esCliente, esProveedor, rolDeOperacion, type RolPersona } from '@/lib/personas'
import type { FacturaCompraPendiente, OperacionApp, Proveedor } from '@/types'

const persona = (parche: Partial<Proveedor>): Proveedor => ({ ...PROVEEDORES[0], ...parche })

const admision: { nombre: string; persona: Proveedor; espera: string | null }[] = [
  {
    nombre: 'un cliente puro se rechaza',
    persona: persona({ categorias: ['Clientes'] }),
    espera: 'no-es-proveedor',
  },
  {
    nombre: 'cliente Y proveedor a la vez se acepta',
    persona: persona({ categorias: ['Clientes', 'Proveedores'] }),
    espera: null,
  },
  {
    nombre: 'sin categoría cargada se rechaza',
    persona: persona({ categorias: [] }),
    espera: 'no-es-proveedor',
  },
  {
    nombre: 'proveedor de CONTADO se rechaza por condición de pago',
    persona: PROVEEDORES[2],
    espera: 'condicion-de-pago',
  },
  {
    nombre: 'proveedor sin condición de pago asignada se rechaza',
    persona: persona({ condicionPago: null }),
    espera: 'condicion-de-pago',
  },
  {
    nombre: 'proveedor en cuenta corriente se acepta',
    persona: PROVEEDORES[0],
    espera: null,
  },
  {
    nombre: 'un cliente de CONTADO se rechaza por NO ser proveedor, no por su condición',
    persona: persona({ categorias: ['Clientes'], condicionPago: 'CONTADO' }),
    espera: 'no-es-proveedor',
  },
]

for (const c of admision) {
  const obtenido = rechazoAlSeleccionar(c.persona)
  if (obtenido !== c.espera) {
    fallas++
    console.log(`FALLA  admisión · ${c.nombre} · esperaba ${c.espera} y dio ${obtenido}`)
  } else {
    console.log(`OK     admisión · ${c.nombre}`)
  }
}

/* La regla de categoría, en los DOS sentidos. Es la misma función mirada desde cada lado del
   mostrador —Cobros y Pases exigen "Clientes", Pagos exige "Proveedores"—, así que se prueba junta:
   una asimetría entre las dos sería exactamente el bug que este bloque existe para atajar. */
const categorias: {
  nombre: string
  categorias: string[]
  cliente: boolean
  proveedor: boolean
}[] = [
  { nombre: 'sólo Clientes', categorias: ['Clientes'], cliente: true, proveedor: false },
  { nombre: 'sólo Proveedores', categorias: ['Proveedores'], cliente: false, proveedor: true },
  {
    nombre: 'Clientes y Proveedores',
    categorias: ['Clientes', 'Proveedores'],
    cliente: true,
    proveedor: true,
  },
  { nombre: 'otra categoría', categorias: ['Transporte'], cliente: false, proveedor: false },
  { nombre: 'sin categoría', categorias: [], cliente: false, proveedor: false },
  /* El tablero guarda etiquetas escritas a mano: un espacio o una mayúscula de más no puede dejar
     a una persona afuera de su propia operación. */
  { nombre: 'con espacios y mayúsculas', categorias: ['  CLIENTES '], cliente: true, proveedor: false },
]

for (const c of categorias) {
  const p = { categorias: c.categorias }
  const okCliente = esCliente(p) === c.cliente
  const okProveedor = esProveedor(p) === c.proveedor
  if (!okCliente || !okProveedor) {
    fallas++
    console.log(
      `FALLA  categoría · ${c.nombre} · cliente=${esCliente(p)} (esperaba ${c.cliente}), proveedor=${esProveedor(p)} (esperaba ${c.proveedor})`,
    )
  } else {
    console.log(`OK     categoría · ${c.nombre}`)
  }
}

/* Cada módulo exige el rol que le corresponde, y quien tiene las DOS categorías sirve para los
   tres: es la consecuencia directa de la regla elegida.

   COBROS y PAGOS lo tienen fijo; el PASE DE SALDO lo toma de lo que el usuario declaró en el paso 1
   ("Las cuentas son de:"), así que se prueba de los dos lados: con "De Proveedores" un cliente se
   rechaza, que es exactamente lo que la validación tiene que garantizar. */
const porModulo: [OperacionApp, RolPersona | null, string[], boolean][] = [
  ['COBROS', null, ['Clientes'], true],
  ['COBROS', null, ['Proveedores'], false],
  ['PASES', 'cliente', ['Clientes'], true],
  ['PASES', 'cliente', ['Proveedores'], false],
  ['PASES', 'proveedor', ['Proveedores'], true],
  ['PASES', 'proveedor', ['Clientes'], false],
  ['PAGOS', null, ['Proveedores'], true],
  ['PAGOS', null, ['Clientes'], false],
  ['COBROS', null, ['Clientes', 'Proveedores'], true],
  ['PASES', 'cliente', ['Clientes', 'Proveedores'], true],
  ['PASES', 'proveedor', ['Clientes', 'Proveedores'], true],
  ['PAGOS', null, ['Clientes', 'Proveedores'], true],
]

for (const [operacion, cuentasDe, cats, espera] of porModulo) {
  const rol = rolDeOperacion(operacion, cuentasDe)
  const obtenido = rol !== null && cumpleRol({ categorias: cats }, rol)
  const rotulo = `${operacion}${cuentasDe ? ` (${cuentasDe})` : ''}`
  if (obtenido !== espera) {
    fallas++
    console.log(`FALLA  módulo · ${rotulo} con [${cats}] · esperaba ${espera} y dio ${obtenido}`)
  } else {
    console.log(`OK     módulo · ${rotulo} con [${cats.join(', ') || 'sin categoría'}]`)
  }
}

/* Y mientras el pase no declaró de quiénes son las cuentas NO hay rol que exigir: es `null`, que es
   lo que hace que el paso 1 reclame la decisión en vez de asumir un lado del mostrador y dejar
   entrar a quien no corresponde. */
if (rolDeOperacion('PASES', null) !== null) {
  fallas++
  console.log('FALLA  módulo · PASES sin declarar debería no exigir ningún rol todavía')
} else {
  console.log('OK     módulo · PASES sin declarar no exige ningún rol todavía')
}

// El bloqueo por diferencia distinta de cero, comprobado sobre la regla y no sobre el HTML.
const total = FACTURAS_COMPRA_PENDIENTES[0].pendiente
const casi = resumenPago([{ id: 'x', formaPago: 'Efectivo', importe: total - 0.5 }], total)
const justo = resumenPago([{ id: 'x', formaPago: 'Efectivo', importe: total }], total)
if (diferenciaSaldadaPago(casi) || bloqueoPago([{ id: 'x', formaPago: 'Efectivo', importe: total - 0.5 }], casi) === null) {
  fallas++
  console.log('FALLA  50 centavos de diferencia deberían bloquear el pago')
} else {
  console.log('OK     50 centavos de diferencia bloquean el pago (cero exacto)')
}
if (!diferenciaSaldadaPago(justo) || bloqueoPago([{ id: 'x', formaPago: 'Efectivo', importe: total }], justo) !== null) {
  fallas++
  console.log('FALLA  la diferencia en cero exacto debería habilitar el pago')
} else {
  console.log('OK     la diferencia en cero exacto habilita el pago')
}


/* El binding lee al PROVEEDOR y no a un cliente: es la integridad de datos que pide el módulo 1. */
const conCuit = aplicar(enOrden, [])
if (!pintar(conCuit).includes(PROVEEDORES[0].cuit)) {
  fallas++
  console.log('FALLA  etapa 4 · el resumen no muestra el CUIT del proveedor')
} else {
  console.log('OK     etapa 4 · el resumen muestra el CUIT del proveedor')
}

/* El reducer tampoco lo deja: la regla no puede depender de que la tabla no ofrezca el campo. */
const idCheque = conCheque.pago.movimientos[0].id
const trasEditarCheque = reducer(conCheque, {
  type: 'setMovimientoCajaImporte',
  id: idCheque,
  importe: 1,
})
if (trasEditarCheque.pago.movimientos[0].importe !== 350_000) {
  fallas++
  console.log('FALLA  importe · el reducer dejó cambiar el importe de un cheque')
} else {
  console.log('OK     importe · el reducer no deja cambiar el importe de un cheque')
}

const idEfectivo = conEfectivo.pago.movimientos[0].id
const trasEditarEfectivo = reducer(conEfectivo, {
  type: 'setMovimientoCajaImporte',
  id: idEfectivo,
  importe: 2_500,
})
if (trasEditarEfectivo.pago.movimientos[0].importe !== 2_500) {
  fallas++
  console.log('FALLA  importe · el reducer no dejó cambiar el importe de una caja que sí se ajusta')
} else {
  console.log('OK     importe · el reducer sí deja cambiar el importe de una caja que no es cheque')
}

/* El envío de la orden EXIGE un contacto que la acepte; el del recibo no. Es el bloqueo de negocio
   del módulo 3, comprobado sobre el catálogo —que es donde vive la regla— y no sobre la pantalla. */
import { comprobanteEnviable } from '@/features/shared/comprobantesEnviables'

const op = comprobanteEnviable('ordenPago')
const rec = comprobanteEnviable('recibo')
const reglasEnvio: { nombre: string; ok: boolean }[] = [
  { nombre: 'la orden exige un contacto que la acepte', ok: op.exigeContactoQueAcepta === true },
  { nombre: 'el recibo no lo exige', ok: !rec.exigeContactoQueAcepta },
  {
    nombre: 'la orden pide el contacto que acepta "Orden de Pago"',
    ok: op.etiquetaContacto === 'Orden de Pago',
  },
  {
    nombre: 'los contactos de la orden son los del PROVEEDOR',
    ok: op.titular(enOrden)?.id === PROVEEDORES[0].id,
  },
  {
    nombre: 'los contactos del recibo son los del CLIENTE',
    ok: rec.titular(enOrden) === null,
  },
  {
    nombre: 'la orden no frena por límite de crédito',
    ok: op.frenaPorCredito === false,
  },
]

for (const r of reglasEnvio) {
  if (!r.ok) {
    fallas++
    console.log(`FALLA  envío OP · ${r.nombre}`)
  } else {
    console.log(`OK     envío OP · ${r.nombre}`)
  }
}

/* ===== Cartera de cheques (etapa 3, modalidad "En Cartera") ===== */

import { DIAS_VENC_PROXIMO, vencimientoProximo } from '@/lib/pagosProveedor'
import { TablaChequesCartera } from '@/features/pagos/TablaChequesCartera'
import type { ChequeEnCartera } from '@/types'

/** Una fecha ISO a N días de hoy. Los tests no pueden depender del día en que se corren. */
const enDias = (dias: number): string => {
  const f = new Date()
  f.setHours(0, 0, 0, 0)
  f.setDate(f.getDate() + dias)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${f.getFullYear()}-${pad(f.getMonth() + 1)}-${pad(f.getDate())}`
}

const proximidad: { nombre: string; iso: string; espera: boolean }[] = [
  { nombre: 'vence dentro de la ventana', iso: enDias(5), espera: true },
  { nombre: 'vence justo en el límite', iso: enDias(DIAS_VENC_PROXIMO), espera: true },
  { nombre: 'vence un día después del límite', iso: enDias(DIAS_VENC_PROXIMO + 1), espera: false },
  { nombre: 'ya venció', iso: enDias(-3), espera: true },
  { nombre: 'vence hoy', iso: enDias(0), espera: true },
  { nombre: 'sin fecha cargada no se alarma', iso: '', espera: false },
]

for (const c of proximidad) {
  const obtenido = vencimientoProximo(c.iso)
  if (obtenido !== c.espera) {
    fallas++
    console.log(`FALLA  vencimiento · ${c.nombre} · esperaba ${c.espera} y dio ${obtenido}`)
  } else {
    console.log(`OK     vencimiento · ${c.nombre}`)
  }
}

const cheque = (parche: Partial<ChequeEnCartera>): ChequeEnCartera => ({
  id: 'x',
  codigo: 'CHEQUE-01',
  numero: '00123456',
  importe: 100_000,
  vencimiento: enDias(60),
  emision: enDias(-30),
  /* 30 días antes del vencimiento: es la relación entre las dos fechas del papel. */
  fechaPago: enDias(30),
  banco: 'Banco Galicia',
  cuitEmisor: '30-70011122-3',
  tipo: 'Cheque',
  estado: 'Pendiente',
  ...parche,
})

const carteraHtml = (error: boolean, elegidos: string[] = []) =>
  renderToString(
    createElement(TablaChequesCartera, {
      cheques: [
        cheque({ id: 'a', numero: '00123456', tipo: 'Cheque', vencimiento: enDias(3) }),
        cheque({ id: 'b', numero: '00987654', tipo: 'eCheq', vencimiento: enDias(60) }),
      ],
      elegidos,
      onAlternar: () => undefined,
      error,
    }),
  )

const tabla = carteraHtml(false)
const revisiones: { nombre: string; ok: boolean }[] = [
  { nombre: 'usa la MISMA tabla que los anticipos', ok: tabla.includes('ant-tabla') && tabla.includes('ant-row') },
  {
    /* Las TRES fechas del cheque, en el orden en que se lee el papel: cuándo se libró, desde cuándo
       se cobra y hasta cuándo. */
    nombre: 'columnas Cheques · Banco · las tres fechas · Importe',
    ok: ['>Cheques<', '>Banco<', '>Fecha Emisión<', '>Fecha Pago<', '>Fecha Vencimiento<', '>Importe<'].every((t) => tabla.includes(t)),
  },
  {
    nombre: 'la emisión y el pago se muestran con sus valores',
    ok: (() => {
      const html = renderToString(
        createElement(TablaChequesCartera, {
          cheques: [
            cheque({ id: 'f', emision: '2026-07-05', fechaPago: '2026-08-29', vencimiento: '2026-09-28' }),
          ],
          elegidos: [],
          onAlternar: () => undefined,
          error: false,
        }),
      )
      return html.includes('05/07/2026') && html.includes('29/08/2026') && html.includes('28/09/2026')
    })(),
  },
  {
    /* Un cheque sin esas fechas cargadas las marca, no las deja en blanco. */
    nombre: 'sin fechas cargadas, se marcan como ausentes',
    ok: (() => {
      const html = renderToString(
        createElement(TablaChequesCartera, {
          cheques: [cheque({ id: 'g', emision: '', fechaPago: '' })],
          elegidos: [],
          onAlternar: () => undefined,
          error: false,
        }),
      )
      return (html.match(/ant-sd/g) ?? []).length >= 2
    })(),
  },
  {
    /* La que puede alarmar es la de VENCIMIENTO: es la que decide hasta cuándo sirve el papel. */
    nombre: 'sólo el vencimiento se pinta por proximidad',
    ok: (carteraHtml(false).match(/pago-venc--proximo/g) ?? []).length === 1,
  },
  { nombre: 'el número va con su tipo, separados por guion', ok: tabla.includes('00123456 - Cheque') && tabla.includes('00987654 - Echeq') },
  { nombre: 'el vencimiento próximo se marca', ok: tabla.includes('pago-venc--proximo') },
  { nombre: 'el importe va en negro (ant-num) y NO en verde (ant-pend)', ok: tabla.includes('ant-num') && !tabla.includes('ant-pend') },
  { nombre: 'sin error, las filas no se pintan', ok: !tabla.includes('pago-fila--error') },
  { nombre: 'con error, TODAS las filas se pintan', ok: (carteraHtml(true).match(/pago-fila--error/g) ?? []).length === 2 },
  { nombre: 'se pueden marcar varios cheques a la vez', ok: (carteraHtml(false, ['a', 'b']).match(/ant-row--on/g) ?? []).length === 2 },
]

for (const r of revisiones) {
  if (!r.ok) {
    fallas++
    console.log(`FALLA  cartera · ${r.nombre}`)
  } else {
    console.log(`OK     cartera · ${r.nombre}`)
  }
}


/* ===== Las QUERIES de la orden de pago =====
   Los dos payloads que la app escribe en "⬅️ Pagos - PENDIENTES" (18421035536) y en sus
   subelementos (18421035618), comprobados columna por columna contra el esquema del tablero. Es lo
   que un typecheck no puede ver: que el id sea el correcto, que el valor tenga la forma que pide su
   TIPO de columna, y que lo que no se declaró se OMITA en vez de viajar en blanco. */

import { columnasCaja, columnasFacturaCompra, columnasOrdenPago } from '@/services/monday/ordenPago'
import { BOARDS, COL, OP_REGISTRO_INDEX } from '@/services/monday/columns'
import { REGISTRO_COBROS, REGISTRO_PAGOS } from '@/services/monday/registro'
import { vencimientoDeCajaCheque } from '@/lib/pagosProveedor'
import { chequeVencido, fechaPagoChequeInvalida } from '@/lib/pagos'
import { siguienteNroSerie } from '@/services/monday/retencionGanancias'
import { descripcionAnticipo } from '@/lib/recibo'

const DATOS_OP = {
  proveedorId: '12904387847',
  nombreProveedor: 'PROVEEDOR TEST',
  vendedorId: '1001',
  facturas: [{ id: '12740955471', nro: 'FC-A-0001-00004521', importe: 543_200.5 }],
  movimientos: [] as MovimientoCaja[],
}

const cabeceraOP = columnasOrdenPago({ ...DATOS_OP, movimientos: [
  { id: 'm1', formaPago: 'Efectivo' as const, importe: 543_200.5 },
] })

const filaFactura = columnasFacturaCompra('12740955471', 543_200.5)

const filaCheque = columnasCaja({
  id: 'm2',
  formaPago: 'Cheque',
  importe: 350_000,
  modalidadCheque: 'cartera',
  chequeId: '9001',
  numeroCheque: '00123456',
  chequeVencimiento: '05/09/2026',
  fechaEmisionCheque: '05/07/2026',
  bancoEmisor: 'Banco HSBC',
  cuitEmisor: '30-70011122-3',
  formatoCheque: 'eCheq',
})

const filaTransferencia = columnasCaja({
  id: 'm3',
  formaPago: 'Transferencia',
  importe: 100_000,
  bancoOrigenId: '7777',
  bancoOrigen: 'Banco Credicoop',
})

const filaEfectivo = columnasCaja({ id: 'm4', formaPago: 'Efectivo', importe: 5_000 })

const queries: { nombre: string; ok: boolean }[] = [
  /* --- Nivel ITEM --- */
  { nombre: 'item · proveedor va como relación', ok: JSON.stringify(cabeceraOP['board_relation_mm6kddv1']) === '{"item_ids":[12904387847]}' },
  { nombre: 'item · vendedor va como people', ok: JSON.stringify(cabeceraOP['multiple_person_mm6kkggd']) === '{"personsAndTeams":[{"id":1001,"kind":"person"}]}' },
  { nombre: 'item · total cancelado', ok: cabeceraOP['numeric_mm6ke0xk'] === 543_200.5 },
  { nombre: 'item · total entregado', ok: cabeceraOP['numeric_mm6k3n9y'] === 543_200.5 },
  { nombre: 'item · diferencia derivada, en cero', ok: cabeceraOP['numeric_mm6k29gj'] === 0 },
  {
    nombre: 'item · NO escribe el estado de registro (como el recibo)',
    ok: !('color_mm6ka1xz' in cabeceraOP),
  },
  {
    nombre: 'item · NO escribe el estado de emisión al crear',
    ok: !('color_mm6kxyqy' in cabeceraOP),
  },
  { nombre: 'item · sin vendedor, la columna se omite', ok: !('multiple_person_mm6kkggd' in columnasOrdenPago({ ...DATOS_OP, vendedorId: null })) },

  /* --- Nivel SUBITEM · factura cancelada --- */
  { nombre: 'subitem factura · caja "Fact Cancelada" por índice', ok: JSON.stringify(filaFactura['status']) === '{"index":6}' },
  { nombre: 'subitem factura · importe cancelado', ok: filaFactura['numeric_mm4ey6h9'] === 543_200.5 },
  { nombre: 'subitem factura · relación a la factura de compra', ok: JSON.stringify(filaFactura['board_relation_mm6k9b0b']) === '{"item_ids":[12740955471]}' },
  { nombre: 'subitem factura · NO usa la columna de entregado', ok: !('numeric_mm4e8pa3' in filaFactura) },

  /* --- Nivel SUBITEM · cheque --- */
  /* El tablero parte el cheque en DOS etiquetas y la app tiene una sola caja: la que decide es el
     FORMATO del cheque, no otra forma de pagar. */
  {
    /* La fila de arriba es un eCHEQ, así que va a la etiqueta del electrónico. */
    nombre: 'subitem cheque · un eCHEQ va a la etiqueta "Echeq" (9)',
    ok: JSON.stringify(filaCheque['status']) === '{"index":9}',
  },
  {
    nombre: 'subitem cheque · el PAPEL va a la suya (3)',
    ok:
      JSON.stringify(
        columnasCaja({ id: 'e1', formaPago: 'Cheque', importe: 1, formatoCheque: 'FISICO' })['status'],
      ) === '{"index":3}',
  },
  {
    /* Sin formato declarado se cae al papel: es el caso por defecto del formulario. */
    nombre: 'subitem cheque · sin formato, va al papel',
    ok: JSON.stringify(columnasCaja({ id: 'e2', formaPago: 'Cheque', importe: 1 })['status']) === '{"index":3}',
  },
  {
    /* El cheque NUEVO lo libramos nosotros y no existe en ningún tablero: hay que darlo de alta. */
    nombre: 'subitem cheque · el NUEVO pide que se lo cree',
    ok:
      JSON.stringify(
        columnasCaja({ id: 'n1', formaPago: 'Cheque', importe: 1, modalidadCheque: 'nuevo' })[
          'boolean_mm6r67dv'
        ],
      ) === '{"checked":"true"}',
  },
  {
    /* El alta necesita la fecha con la que nace el cheque, en su propia columna: la otra describe
       el comprobante de la línea. Llevan la misma fecha por motivos distintos. */
    nombre: 'subitem cheque · el NUEVO lleva su fecha de emisión para el alta',
    ok:
      JSON.stringify(
        columnasCaja({
          id: 'n2',
          formaPago: 'Cheque',
          importe: 1,
          modalidadCheque: 'nuevo',
          fechaEmisionCheque: '05/07/2026',
        })['date_mm6ry6ma'],
      ) === '{"date":"2026-07-05"}',
  },
  {
    nombre: 'subitem cheque · sin fecha cargada, esa columna se omite',
    ok: !(
      'date_mm6ry6ma' in
      columnasCaja({ id: 'n3', formaPago: 'Cheque', importe: 1, modalidadCheque: 'nuevo' })
    ),
  },
  {
    /* El de CARTERA ya existe —se endosa—, así que la casilla se omite en vez de ir en falso. */
    nombre: 'subitem cheque · el de CARTERA no se crea',
    ok: (() => {
      const f = columnasCaja({ id: 'c9', formaPago: 'Cheque', importe: 1, modalidadCheque: 'cartera', chequeId: '1', fechaEmisionCheque: '05/07/2026' })
      /* Ni la casilla ni la fecha del alta: las dos son del cheque que se CREA. La fecha del
         comprobante sí va, porque describe la línea. */
      return !('boolean_mm6r67dv' in f) && !('date_mm6ry6ma' in f) && 'date_mm6kkqn0' in f
    })(),
  },
  {
    nombre: 'subitem cheque · ninguna otra caja pide crear un cheque',
    ok: !('boolean_mm6r67dv' in columnasCaja({ id: 't9', formaPago: 'Transferencia', importe: 1 })),
  },
  { nombre: 'subitem cheque · importe entregado', ok: filaCheque['numeric_mm4e8pa3'] === 350_000 },
  { nombre: 'subitem cheque · nro va tal cual, con sus ceros', ok: filaCheque['text_mm6kvwmn'] === '00123456' },
  { nombre: 'subitem cheque · fechas en ISO', ok: JSON.stringify(filaCheque['date_mm6kkqn0']) === '{"date":"2026-07-05"}' && JSON.stringify(filaCheque['date_mm6kv044']) === '{"date":"2026-09-05"}' },
  { nombre: 'subitem cheque · banco traducido al vocabulario del tablero', ok: JSON.stringify(filaCheque['dropdown_mm6krnt8']) === '{"labels":["HSBC"]}' },
  { nombre: 'subitem cheque · origen eCheq', ok: JSON.stringify(filaCheque['dropdown_mm6kb6yv']) === '{"labels":["eCheq"]}' },
  { nombre: 'subitem cheque · CUIT con guiones', ok: filaCheque['text_mm6kx58v'] === '30-70011122-3' },
  { nombre: 'subitem cheque · el de cartera se linkea a su ítem', ok: JSON.stringify(filaCheque['board_relation_mm6kpcpz']) === '{"item_ids":[9001]}' },
  {
    nombre: 'subitem cheque · el NUEVO no se linkea a ninguno',
    ok: !('board_relation_mm6kpcpz' in columnasCaja({ id: 'm5', formaPago: 'Cheque', importe: 1, modalidadCheque: 'nuevo', chequeId: '9001', numeroCheque: '1' })),
  },

  /* --- Nivel SUBITEM · transferencia y efectivo --- */
  { nombre: 'subitem transferencia · caja por índice', ok: JSON.stringify(filaTransferencia['status']) === '{"index":0}' },
  { nombre: 'subitem transferencia · banco de ORIGEN como relación', ok: JSON.stringify(filaTransferencia['board_relation_mm6kj05n']) === '{"item_ids":[7777]}' },
  { nombre: 'subitem efectivo · sólo caja e importe', ok: Object.keys(filaEfectivo).length === 2 && JSON.stringify(filaEfectivo['status']) === '{"index":2}' },
]

for (const q of queries) {
  if (!q.ok) {
    fallas++
    console.log(`FALLA  query · ${q.nombre}`)
  } else {
    console.log(`OK     query · ${q.nombre}`)
  }
}


/* ===== El ANTICIPO como caja =====
   Es el espejo del anticipo del cobro: absorbe lo que se entregó DE MÁS y suma del lado de lo
   CANCELADO, no de lo entregado. Se prueba contra `resumenCobro`, que es la cuenta que replica: si
   las dos se separan, una de las dos está mal. */

import { resumenCobro } from '@/lib/pagos'
import { columnasAnticipoPago } from '@/services/monday/ordenPago'
import { armarOrdenDePago, CAJAS_PAGO, esAnticipoDePago, MSG_EXCESO_PAGO } from '@/lib/pagosProveedor'

/** Un cheque de 600.000 contra facturas por 500.000: sobran 100.000. */
const CAJAS_CON_SOBRANTE: MovimientoCaja[] = [
  { id: 'c1', formaPago: 'Cheque', importe: 600_000, modalidadCheque: 'cartera', chequeId: '1' },
]
const TOTAL_FACTURAS = 500_000

const sinAnticipo = resumenPago(CAJAS_CON_SOBRANTE, TOTAL_FACTURAS)
const conAnticipo = resumenPago(
  [...CAJAS_CON_SOBRANTE, { id: 'a1', formaPago: 'Anticipo', importe: 100_000 }],
  TOTAL_FACTURAS,
)
/* La MISMA operación del lado del cobro, para contrastar número por número. */
const cobroEquivalente = resumenCobro(
  [
    { id: 'c1', formaPago: 'Cheque', importe: 600_000, fechaPagoCheque: '' },
    { id: 'a1', formaPago: 'Anticipo', importe: 100_000, fechaPagoCheque: '' },
  ],
  TOTAL_FACTURAS,
)

const documento = armarOrdenDePago(
  [FACTURAS_COMPRA_PENDIENTES[0]],
  { [FACTURAS_COMPRA_PENDIENTES[0].id]: TOTAL_FACTURAS },
  [...CAJAS_CON_SOBRANTE, { id: 'a1', formaPago: 'Anticipo', importe: 100_000 }],
)
const filaAnticipo = columnasAnticipoPago(100_000)

const anticipos: { nombre: string; ok: boolean }[] = [
  { nombre: 'la caja se reconoce', ok: esAnticipoDePago('Anticipo') && !esAnticipoDePago('Efectivo') },
  { nombre: 'sin él, el excedente deja la diferencia en negativo', ok: sinAnticipo.diferencia === -100_000 },
  { nombre: 'con él, la diferencia llega a cero exacto', ok: conAnticipo.diferencia === 0 },
  { nombre: 'suma al TOTAL A PAGAR y no al TOTAL PAGADO', ok: conAnticipo.totalAPagar === 600_000 && conAnticipo.totalPagado === 600_000 },
  {
    nombre: 'da los MISMOS números que el anticipo del cobro',
    ok:
      conAnticipo.totalAPagar === cobroEquivalente.totalACancelar &&
      conAnticipo.totalPagado === cobroEquivalente.totalRecibido &&
      conAnticipo.diferencia === cobroEquivalente.diferencia,
  },
  { nombre: 'el mensaje del exceso ofrece registrarlo', ok: MSG_EXCESO_PAGO(100_000).includes('anticipo') },
  { nombre: 'sin esa salida, el mensaje no la nombra', ok: !MSG_EXCESO_PAGO(100_000, false).includes('anticipo') },

  /* --- En el documento --- */
  { nombre: 'va entre lo CANCELADO, después de las facturas', ok: documento.comprobantes.length === 2 && documento.comprobantes[1].esAnticipo === true },
  { nombre: 'NO va entre las cajas entregadas', ok: documento.pagos.length === 1 },
  { nombre: 'se nombra por su concepto, sin fechas', ok: documento.comprobantes[1].nro === 'Anticipo' && documento.comprobantes[1].vencimiento === '' },
  { nombre: 'los dos totales del documento cierran iguales', ok: documento.totalCancelado === 600_000 && documento.totalEntregado === 600_000 },

  /* --- En la query --- */
  { nombre: 'subitem anticipo · caja "Anticipo" por índice', ok: JSON.stringify(filaAnticipo['status']) === '{"index":7}' },
  { nombre: 'subitem anticipo · usa la columna de CANCELADO', ok: filaAnticipo['numeric_mm4ey6h9'] === 100_000 },
  { nombre: 'subitem anticipo · NO usa la de entregado', ok: !('numeric_mm4e8pa3' in filaAnticipo) },
  {
    nombre: 'la cabecera cuenta el anticipo del lado cancelado',
    ok:
      columnasOrdenPago({
        ...DATOS_OP,
        facturas: [{ id: '1', nro: 'F', importe: TOTAL_FACTURAS }],
        movimientos: [...CAJAS_CON_SOBRANTE, { id: 'a1', formaPago: 'Anticipo', importe: 100_000 }],
      })['numeric_mm6ke0xk'] === 600_000,
  },
]

for (const a of anticipos) {
  if (!a.ok) {
    fallas++
    console.log(`FALLA  anticipo · ${a.nombre}`)
  } else {
    console.log(`OK     anticipo · ${a.nombre}`)
  }
}


/* ===== MODO "Entrega de un Anticipo" =====
   Es el espejo del modo anticipo de Cobros: se saltea la etapa de facturas, el importe lo declara
   el usuario y la orden lo ilustra como una sola línea. Se prueba el recorrido entero. */

import {
  ANTICIPO_PAGO_EXIGE_DETALLE_Y_VENC,
  bloqueoAnticipoPago,
  bloqueoPago,
  resumenPago as resumenPagoFn,
} from '@/lib/pagosProveedor'
import { ANTICIPO_COBRO_EXIGE_DETALLE_Y_VENC, faltantesDeAnticipo } from '@/lib/pagos'
import { pasosDePago, etiquetaDePasoPago, numeroDePasoPago } from '@/lib/pasosPago'
import { nombreAnticipoPago } from '@/services/monday/ordenPago'

const recorridos: { nombre: string; ok: boolean }[] = [
  {
    nombre: 'el anticipo se saltea la etapa de facturas',
    ok: JSON.stringify(pasosDePago('anticipo')) === JSON.stringify(['proveedor', 'pago', 'orden']),
  },
  {
    nombre: 'el de facturas conserva sus cuatro etapas',
    ok: pasosDePago('facturasCompra').length === 4,
  },
  {
    nombre: 'sin elegir, se anticipa el recorrido completo',
    ok: pasosDePago(null).length === 4,
  },
  {
    nombre: 'la etapa 3 se llama "Registrar Anticipo"',
    ok: etiquetaDePasoPago('pago', 'anticipo') === 'Registrar Anticipo',
  },
  {
    nombre: 'y sigue siendo "Registrar Pagos" en el otro recorrido',
    ok: etiquetaDePasoPago('pago', 'facturasCompra') === 'Registrar Pagos',
  },
  {
    nombre: 'la orden es el paso 3 del anticipo y el 4 del otro',
    ok: numeroDePasoPago('orden', 'anticipo') === 3 && numeroDePasoPago('orden', 'facturasCompra') === 4,
  },
]

for (const r of recorridos) {
  if (!r.ok) {
    fallas++
    console.log(`FALLA  modo anticipo · ${r.nombre}`)
  } else {
    console.log(`OK     modo anticipo · ${r.nombre}`)
  }
}

const sinDatos = { importe: 0, detalle: '', vencimiento: '' }
const completos = { importe: 250_000, detalle: 'Adelanto', vencimiento: '30/09/2026' }
const resumenOk = resumenPagoFn(
  [{ id: 'x', formaPago: 'Transferencia', importe: 250_000, bancoOrigenId: '1' }],
  250_000,
)

const reglasAnticipo: { nombre: string; ok: boolean }[] = [
  {
    nombre: 'sin importe, el paso se frena antes de mirar las cajas',
    ok: bloqueoAnticipoPago(sinDatos, [], resumenOk)?.titulo === 'Falta el importe del anticipo',
  },
  {
    /* El detalle y el vencimiento son OPCIONALES en este circuito: con el importe cargado el paso
       avanza igual. Es lo que lo separa del anticipo de un cobro, donde los tres son obligatorios. */
    nombre: 'sin detalle ni vencimiento, con importe, NO frena',
    ok:
      bloqueoAnticipoPago(
        { importe: 250_000, detalle: '', vencimiento: '' },
        [{ id: 'x', formaPago: 'Transferencia', importe: 250_000, bancoOrigenId: '1' }],
        resumenOk,
      ) === null,
  },
  {
    nombre: 'y el formulario de cajas se abre con el importe solo',
    ok:
      faltantesDeAnticipo(
        { importe: 250_000, detalle: '', vencimiento: '' },
        ANTICIPO_PAGO_EXIGE_DETALLE_Y_VENC,
      ).length === 0 &&
      faltantesDeAnticipo(
        { importe: 0, detalle: 'x', vencimiento: '30/09/2026' },
        ANTICIPO_PAGO_EXIGE_DETALLE_Y_VENC,
      ).length === 1,
  },
  {
    /* Las dos constantes son decisiones SEPARADAS de dos circuitos, aunque hoy coincidan. Lo que
       este caso ata es que el parámetro siga sabiendo exigir: si alguien cambiara el default o la
       rama del `if`, el asterisco de la pantalla quedaría mintiendo. */
    nombre: 'el parámetro sigue pudiendo exigir los tres',
    ok:
      faltantesDeAnticipo({ importe: 250_000, detalle: '', vencimiento: '' }, true).length === 2 &&
      ANTICIPO_PAGO_EXIGE_DETALLE_Y_VENC === false &&
      ANTICIPO_COBRO_EXIGE_DETALLE_Y_VENC === false,
  },
  {
    nombre: 'con los tres y la diferencia en cero, no frena nada',
    ok: bloqueoAnticipoPago(completos, [{ id: 'x', formaPago: 'Transferencia', importe: 250_000, bancoOrigenId: '1' }], resumenOk) === null,
  },
  {
    nombre: 'el exceso NO ofrece registrar otro anticipo en este recorrido',
    ok: !(
      bloqueoAnticipoPago(
        completos,
        [{ id: 'x', formaPago: 'Efectivo', importe: 300_000 }],
        resumenPagoFn([{ id: 'x', formaPago: 'Efectivo', importe: 300_000 }], 250_000),
      )?.mensaje ?? ''
    ).includes('anticipo por esa diferencia'),
  },
  {
    nombre: 'el detalle se conserva en el nombre de la línea',
    ok: nombreAnticipoPago('Adelanto campaña') === 'Anticipo · Adelanto campaña',
  },
  { nombre: 'sin detalle, la línea se llama sólo "Anticipo"', ok: nombreAnticipoPago('') === 'Anticipo' },
  {
    nombre: 'la cabecera declara el importe del anticipo como total cancelado',
    ok:
      columnasOrdenPago({
        ...DATOS_OP,
        facturas: [],
        movimientos: [{ id: 'x', formaPago: 'Transferencia', importe: 250_000 }],
        tipo: 'anticipo',
        anticipo: 250_000,
      })['numeric_mm6ke0xk'] === 250_000,
  },
  {
    nombre: 'la línea del anticipo lleva su vencimiento',
    ok: JSON.stringify(columnasAnticipoPago(250_000, '30/09/2026')['date_mm6kv044']) === '{"date":"2026-09-30"}',
  },
  {
    nombre: 'y el DETALLE que escribió el usuario, sin el prefijo del nombre',
    ok:
      columnasAnticipoPago(250_000, '30/09/2026', 'Adelanto campaña gruesa')['text_mm6naqq7'] ===
      'Adelanto campaña gruesa',
  },
  {
    /* El sobrante de un pago contra facturas no tiene detalle: la columna se OMITE en vez de irse
       en blanco, con el mismo criterio que el resto del payload. */
    nombre: 'sin detalle, la columna no se manda',
    ok:
      !('text_mm6naqq7' in columnasAnticipoPago(100_000)) &&
      !('text_mm6naqq7' in columnasAnticipoPago(100_000, '', '   ')),
  },
]

for (const r of reglasAnticipo) {
  if (!r.ok) {
    fallas++
    console.log(`FALLA  modo anticipo · ${r.nombre}`)
  } else {
    console.log(`OK     modo anticipo · ${r.nombre}`)
  }
}


/* ===== MODO "Aplicación Anticipo contra Facturas de Compra" =====
   Espejo del modo aplicación de Cobros: cuatro etapas, el dinero sale del saldo a favor que ya
   teníamos con el proveedor, y la diferencia tiene que cerrar en CERO ABSOLUTO. */

import { ANTICIPOS_PENDIENTES_PROVEEDOR } from '@/data/mock'
import { bloqueoAplicacion } from '@/lib/cobros'
import { pagosDeAnticipos } from '@/lib/recibo'
import { columnasAnticipoAplicado } from '@/services/monday/ordenPago'

/* El saldo de `apr-1` es de 400.000: las pruebas del bloqueo se hacen contra ESE tope, para que lo
   que frene sea la regla que se quiere probar y no un exceso sobre el anticipo. */
const SALDO_APR1 = ANTICIPOS_PENDIENTES_PROVEEDOR[0].pendiente
const APLICADOS = [{ id: 'apr-1', nro: 'ANTICIPO-04', importe: SALDO_APR1 }]

const docAplicacion = armarOrdenDePago(
  [FACTURAS_COMPRA_PENDIENTES[0]],
  { [FACTURAS_COMPRA_PENDIENTES[0].id]: SALDO_APR1 },
  [],
  pagosDeAnticipos(APLICADOS),
)

const filaAplicado = columnasAnticipoAplicado(SALDO_APR1)

/** La cabecera de cada uno de los tres modos, para leer su "🤖Tipo de Pago" de un vistazo. */
const cabeceraDe = (tipo: 'facturas' | 'anticipo' | 'aplicacion') =>
  columnasOrdenPago({
    ...DATOS_OP,
    facturas: tipo === 'anticipo' ? [] : [{ id: '1', nro: 'F', importe: SALDO_APR1 }],
    movimientos: tipo === 'facturas' ? [{ id: 'm', formaPago: 'Efectivo', importe: SALDO_APR1 }] : [],
    tipo,
    anticipo: tipo === 'anticipo' ? SALDO_APR1 : undefined,
    anticiposAplicados: tipo === 'aplicacion' ? APLICADOS : undefined,
  })

const aplicacion: { nombre: string; ok: boolean }[] = [
  /* --- Recorrido --- */
  {
    nombre: 'recorre las mismas cuatro etapas que el pago',
    ok:
      JSON.stringify(pasosDePago('aplicacion')) ===
      JSON.stringify(['proveedor', 'facturasCompra', 'pago', 'orden']),
  },
  {
    nombre: 'la etapa 3 se llama "Aplicar Anticipo"',
    ok: etiquetaDePasoPago('pago', 'aplicacion') === 'Aplicar Anticipo',
  },

  /* --- El documento --- */
  {
    /* El código ya dice que es un anticipo, así que se muestra tal cual: anteponerle la palabra
       daba "Anticipo ANTICIPO-04". */
    nombre: 'los anticipos ocupan el lugar de las cajas, sin repetir la palabra',
    ok: docAplicacion.pagos.length === 1 && docAplicacion.pagos[0].descripcion === 'ANTICIPO-04',
  },
  {
    nombre: 'los dos totales cierran iguales',
    ok:
      docAplicacion.totalCancelado === SALDO_APR1 &&
      docAplicacion.totalEntregado === SALDO_APR1,
  },
  {
    nombre: 'las facturas siguen entre lo cancelado',
    ok: docAplicacion.comprobantes.length === 1 && !docAplicacion.comprobantes[0].esAnticipo,
  },

  /* --- Las reglas, que son las MISMAS que en cobros --- */
  {
    nombre: 'sin anticipos elegidos, el paso se frena',
    ok: bloqueoAplicacion(ANTICIPOS_PENDIENTES_PROVEEDOR, {}, SALDO_APR1)?.titulo ===
      'No seleccionaste ningún anticipo',
  },
  {
    nombre: 'una diferencia de un peso frena (cero absoluto)',
    ok:
      bloqueoAplicacion(ANTICIPOS_PENDIENTES_PROVEEDOR, { 'apr-1': SALDO_APR1 - 1 }, SALDO_APR1)
        ?.titulo === 'La diferencia tiene que ser $ 0,00',
  },
  {
    nombre: 'con la diferencia en cero, no frena nada',
    ok: bloqueoAplicacion(ANTICIPOS_PENDIENTES_PROVEEDOR, { 'apr-1': SALDO_APR1 }, SALDO_APR1) === null,
  },
  {
    nombre: 'no se puede aplicar más que el saldo del anticipo',
    ok: bloqueoAplicacion(ANTICIPOS_PENDIENTES_PROVEEDOR, { 'apr-2': 200_000 }, 200_000)?.titulo ===
      'El importe supera el saldo del anticipo',
  },

  /* --- La query --- */
  {
    nombre: 'subitem aplicado · caja "Anticipo" por índice',
    ok: JSON.stringify(filaAplicado['status']) === '{"index":7}',
  },
  {
    nombre: 'subitem aplicado · usa la columna de ENTREGADO, no la de cancelado',
    ok: filaAplicado['numeric_mm4e8pa3'] === SALDO_APR1 && !('numeric_mm4ey6h9' in filaAplicado),
  },
  {
    nombre: 'la cabecera declara lo aplicado como total entregado',
    ok: cabeceraDe('aplicacion')['numeric_mm6k3n9y'] === SALDO_APR1,
  },

  /* --- "🤖Tipo de Pago", los tres modos --- */
  {
    nombre: 'tipo de pago · facturas → Posterior (0)',
    ok: JSON.stringify(cabeceraDe('facturas')['color_mm6k7dh5']) === '{"index":0}',
  },
  {
    nombre: 'tipo de pago · anticipo → Anticipado (2)',
    ok: JSON.stringify(cabeceraDe('anticipo')['color_mm6k7dh5']) === '{"index":2}',
  },
  {
    nombre: 'tipo de pago · aplicación → Aplicacion Cta Cte (3)',
    ok: JSON.stringify(cabeceraDe('aplicacion')['color_mm6k7dh5']) === '{"index":3}',
  },
]

for (const a of aplicacion) {
  if (!a.ok) {
    fallas++
    console.log(`FALLA  aplicación · ${a.nombre}`)
  } else {
    console.log(`OK     aplicación · ${a.nombre}`)
  }
}


/* ===== El bloque de ENVÍO sin destinatarios =====
   El envío ya no se esconde: se muestra entero —medio, buscador vacío y lista— con el aviso en el
   lugar de los contactos y el botón apagado. Se renderiza el componente directo, porque su estado
   depende de una consulta que el render de servidor no espera. */

import { EnviarDocumento } from '@/features/shared/EnviarDocumento'

/** El bloque de envío de la orden, con el proveedor ya cargado y sin contactos que la acepten. */
const envioHtml = renderToString(
  createElement(
    StateContext.Provider,
    { value: enOrden },
    createElement(
      DispatchContext.Provider,
      { value: () => undefined },
      createElement(EnviarDocumento, { documento: 'ordenPago', numero: 'IDPAGO-00001' }),
    ),
  ),
)

const envio: { nombre: string; ok: boolean }[] = [
  { nombre: 'se muestra el selector de medio de envío', ok: envioHtml.includes('Medio de envío') },
  { nombre: 'se muestra el buscador de contactos', ok: envioHtml.includes('Buscar y seleccionar contactos') },
  /* El contador va interpolado, así que el render de servidor lo parte con sus marcas: se busca el
     rótulo y el número por separado en vez de la frase entera. */
  {
    nombre: 'se muestra la lista de seleccionados, vacía',
    ok: envioHtml.includes('Contactos seleccionados') && !envioHtml.includes('citem-name'),
  },
  /* El aviso sólo aparece con la consulta de contactos YA resuelta, y el render de servidor no
     espera promesas: su TEXTO se comprueba sobre el catálogo, que es donde vive. */
  {
    nombre: 'el aviso de la orden dice el texto pedido',
    ok:
      op.sinContactos.mensaje('PROVEEDOR TEST') ===
      'PROVEEDOR TEST NO tiene ningun contacto asignado al cual se le pueda enviar orden de pago o retencion, por ende NO es posible realizar el envio. Para la proxima revisa y asigna contactos al proveedor.',
  },
  {
    nombre: 'y el del recibo sigue siendo el suyo',
    ok: rec.sinContactos.mensaje('X').includes('no tiene contactos cargados en el tablero'),
  },
  { nombre: 'y el botón de confirmar', ok: envioHtml.includes('Confirmar y Enviar') },
  {
    nombre: 'el botón está deshabilitado',
    ok: /Confirmar y Enviar/.test(envioHtml) && envioHtml.includes('disabled'),
  },
]

for (const e of envio) {
  if (!e.ok) {
    fallas++
    console.log(`FALLA  envío · ${e.nombre}`)
  } else {
    console.log(`OK     envío · ${e.nombre}`)
  }
}


/* ===== RETENCIÓN de Ganancias =====
   Es el único importe que el usuario no escribe: sale de una fórmula fiscal de tres tramos. Se
   prueba el número, el orden de los tramos y cada uno de los cinco motivos por los que no se puede
   calcular —los tres primeros son datos que faltan en un tablero—. */

import {
  calcularRetencionGAN,
  esFaltaDeDatos,
  esRetencionGAN,
  mensajeSinRetencion,
  MSG_RETENCION_MINIMO,
  MSG_RETENCION_MINIMO_CORTO,
  RETENCION_GAN_MINIMO,
} from '@/lib/pagosProveedor'
import { PARAMETROS_RETENCION_MOCK } from '@/data/mock'

/**
 * Una factura de compra a medida, para aislar cada tramo del cálculo.
 *
 * Los dos totales quedan SINCRONIZADOS salvo que el caso los desalinee a propósito: es el estado
 * normal de una factura, y sin esto cualquier prueba que cambiara el total chocaría con el control
 * de coincidencia en vez de con lo que quiere medir.
 */
const fact = (parche: Partial<FacturaCompraPendiente>): FacturaCompraPendiente => {
  const base: FacturaCompraPendiente = {
    id: 'f',
    nro: 'FC-0001',
    vencimiento: '',
    total: 1_000_000,
    totalFactura: 1_000_000,
    pagado: 0,
    pagadoPct: 0,
    pendiente: 1_000_000,
    importeNeto: 800_000,
    estado: 'Pend de Pagar 100%',
    parcial: false,
    ...parche,
  }
  return 'totalFactura' in parche ? base : { ...base, totalFactura: base.total }
}

const PARAMS = { baseNoImponible: 100_000, alicuota: 10 }

/** El cálculo con una factura entera: 800.000 de base bruta − 100.000 exentos = 700.000 × 10%. */
const entera = calcularRetencionGAN({
  facturas: [fact({})],
  imputaciones: { f: 1_000_000 },
  parametros: PARAMS,
  baseNoImponibleDisponible: true,
})

/** La MISMA factura pagada a la mitad: la base se prorratea (400.000 − 100.000) × 10%. */
const mitad = calcularRetencionGAN({
  facturas: [fact({})],
  imputaciones: { f: 500_000 },
  parametros: PARAMS,
  baseNoImponibleDisponible: true,
})

/** Ya se usó la base no imponible este mes: no se vuelve a descontar. */
const sinDescuento = calcularRetencionGAN({
  facturas: [fact({})],
  imputaciones: { f: 1_000_000 },
  parametros: PARAMS,
  baseNoImponibleDisponible: false,
})

/** DOS facturas: cada una aporta su base y el tramo exento se resta UNA vez al total. */
const dos = calcularRetencionGAN({
  facturas: [fact({ id: 'a', nro: 'A' }), fact({ id: 'b', nro: 'B', total: 500_000, importeNeto: 400_000 })],
  imputaciones: { a: 1_000_000, b: 500_000 },
  parametros: PARAMS,
  baseNoImponibleDisponible: true,
})

const noOk = (r: ReturnType<typeof calcularRetencionGAN>) => (r.ok ? null : r.motivo)

const retencion: { nombre: string; ok: boolean }[] = [
  { nombre: 'la caja se reconoce', ok: esRetencionGAN('Retencion GAN') && !esRetencionGAN('Efectivo') },

  /* --- El número --- */
  {
    nombre: 'factura entera · (800.000 − 100.000) × 10% = 70.000',
    ok: entera.ok && entera.monto === 70_000 && entera.baseImponible === 700_000,
  },
  {
    nombre: 'pago parcial · la base se prorratea por lo que se paga',
    ok: mitad.ok && mitad.baseImponible === 300_000 && mitad.monto === 30_000,
  },
  {
    nombre: 'sin descuento mensual · la base es la bruta entera',
    ok: sinDescuento.ok && sinDescuento.baseImponible === 800_000 && sinDescuento.monto === 80_000,
  },
  {
    nombre: 'dos facturas · las bases se suman y el tramo exento se resta UNA vez',
    ok: dos.ok && dos.baseImponible === 1_100_000 && dos.monto === 110_000,
  },
  {
    nombre: 'el descuento aplicado se informa',
    ok: entera.ok && entera.baseNoImponibleAplicada === 100_000 &&
      sinDescuento.ok && sinDescuento.baseNoImponibleAplicada === 0,
  },
  {
    nombre: 'la base nunca queda negativa',
    ok: (() => {
      const r = calcularRetencionGAN({
        facturas: [fact({ total: 1_000, importeNeto: 800 })],
        imputaciones: { f: 1_000 },
        parametros: PARAMS,
        baseNoImponibleDisponible: true,
      })
      /* 800 − 100.000 daría negativo: se recorta en cero, así que el monto es cero y no un importe
         a favor del proveedor. El cálculo SALE igual; lo que no alcanza es el mínimo. */
      return r.ok && r.baseImponible === 0 && r.monto === 0 && !r.alcanzaElMinimo
    })(),
  },

  /* --- Los cinco motivos por los que NO se puede --- */
  {
    nombre: 'sin facturas elegidas',
    ok: noOk(calcularRetencionGAN({ facturas: [], imputaciones: {}, parametros: PARAMS, baseNoImponibleDisponible: true })) === 'sin-facturas',
  },
  {
    nombre: 'factura sin importe neto',
    ok:
      noOk(
        calcularRetencionGAN({
          facturas: [fact({ importeNeto: null })],
          imputaciones: { f: 1_000_000 },
          parametros: PARAMS,
          baseNoImponibleDisponible: true,
        }),
      ) === 'sin-importe-neto',
  },
  {
    nombre: 'base no imponible vacía',
    ok:
      noOk(
        calcularRetencionGAN({
          facturas: [fact({})],
          imputaciones: { f: 1_000_000 },
          parametros: { baseNoImponible: null, alicuota: 10 },
          baseNoImponibleDisponible: true,
        }),
      ) === 'base-no-imponible-invalida',
  },
  {
    nombre: 'base no imponible negativa',
    ok:
      noOk(
        calcularRetencionGAN({
          facturas: [fact({})],
          imputaciones: { f: 1_000_000 },
          parametros: { baseNoImponible: -1, alicuota: 10 },
          baseNoImponibleDisponible: true,
        }),
      ) === 'base-no-imponible-invalida',
  },
  {
    nombre: 'la base no imponible se valida aunque este mes no se descuente',
    ok:
      noOk(
        calcularRetencionGAN({
          facturas: [fact({})],
          imputaciones: { f: 1_000_000 },
          parametros: { baseNoImponible: null, alicuota: 10 },
          baseNoImponibleDisponible: false,
        }),
      ) === 'base-no-imponible-invalida',
  },
  {
    nombre: 'alícuota vacía o en cero',
    ok:
      noOk(
        calcularRetencionGAN({
          facturas: [fact({})],
          imputaciones: { f: 1_000_000 },
          parametros: { baseNoImponible: 0, alicuota: 0 },
          baseNoImponibleDisponible: true,
        }),
      ) === 'alicuota-invalida',
  },
  {
    nombre: `por debajo de ${RETENCION_GAN_MINIMO} el cálculo sale igual, pero no se puede practicar`,
    ok: (() => {
      const r = calcularRetencionGAN({
        facturas: [fact({ total: 10_000, importeNeto: 2_000 })],
        imputaciones: { f: 10_000 },
        parametros: { baseNoImponible: 0, alicuota: 10 },
        baseNoImponibleDisponible: true,
      })
      /* El VALOR REAL se devuelve —200— para que la pantalla lo muestre: esconderlo dejaba el campo
         mostrando otra cifra en su lugar. Lo que dice que no se puede agregar es `alcanzaElMinimo`. */
      return r.ok && r.monto === 200 && !r.alcanzaElMinimo
    })(),
  },
  {
    nombre: 'un monto por debajo del mínimo NO es una falta de datos',
    ok: (() => {
      const r = calcularRetencionGAN({
        facturas: [fact({ total: 10_000, importeNeto: 2_000 })],
        imputaciones: { f: 10_000 },
        parametros: { baseNoImponible: 0, alicuota: 10 },
        baseNoImponibleDisponible: true,
      })
      /* Por eso no abre ninguna ventana: se avisa en el campo, como cualquier otra validación. */
      return !esFaltaDeDatos(r)
    })(),
  },
  {
    nombre: 'justo en el mínimo SÍ se retiene',
    ok: (() => {
      /* 2.400 de base al 10% da exactamente 240. */
      const r = calcularRetencionGAN({
        facturas: [fact({ total: 10_000, importeNeto: 2_400 })],
        imputaciones: { f: 10_000 },
        parametros: { baseNoImponible: 0, alicuota: 10 },
        baseNoImponibleDisponible: true,
      })
      return r.ok && r.monto === RETENCION_GAN_MINIMO && r.alcanzaElMinimo
    })(),
  },

  /* --- El total de la pendiente contra el de la factura vinculada --- */
  {
    nombre: 'si los dos totales difieren, no se calcula',
    ok: (() => {
      const r = calcularRetencionGAN({
        facturas: [fact({ nro: 'FC-0009', totalFactura: 900_000 })],
        imputaciones: { f: 1_000_000 },
        parametros: PARAMS,
        baseNoImponibleDisponible: true,
      })
      return !r.ok && r.motivo === 'total-no-coincide'
    })(),
  },
  {
    nombre: 'y se nombran el comprobante y los DOS importes',
    ok: (() => {
      const r = calcularRetencionGAN({
        facturas: [fact({ nro: 'FC-0009', totalFactura: 900_000 })],
        imputaciones: { f: 1_000_000 },
        parametros: PARAMS,
        baseNoImponibleDisponible: true,
      })
      return (
        !r.ok &&
        r.faltantes.length === 1 &&
        r.faltantes[0].includes('FC-0009') &&
        r.faltantes[0].includes('1.000.000') &&
        r.faltantes[0].includes('900.000')
      )
    })(),
  },
  {
    nombre: 'la discrepancia abre la misma ventana que un dato faltante',
    ok: (() => {
      const r = calcularRetencionGAN({
        facturas: [fact({ totalFactura: 900_000 })],
        imputaciones: { f: 1_000_000 },
        parametros: PARAMS,
        baseNoImponibleDisponible: true,
      })
      return esFaltaDeDatos(r)
    })(),
  },
  {
    nombre: 'sin el total de la vinculada (columna sin configurar) NO se compara',
    ok: (() => {
      const r = calcularRetencionGAN({
        facturas: [fact({ totalFactura: null })],
        imputaciones: { f: 1_000_000 },
        parametros: PARAMS,
        baseNoImponibleDisponible: true,
      })
      /* El control queda apagado hasta que la columna tenga su id: apagarlo es lo único seguro,
         porque leer vacío daría cero y marcaría TODA factura como discrepante. */
      return r.ok && r.monto === 70_000
    })(),
  },
  {
    nombre: 'una diferencia de centavos también salta',
    ok: (() => {
      const r = calcularRetencionGAN({
        facturas: [fact({ totalFactura: 1_000_000.01 })],
        imputaciones: { f: 1_000_000 },
        parametros: PARAMS,
        baseNoImponibleDisponible: true,
      })
      return !r.ok && r.motivo === 'total-no-coincide'
    })(),
  },
  {
    nombre: 'el importe neto se revisa ANTES que la coincidencia de totales',
    ok: (() => {
      /* Sin neto no hay nada que prorratear, así que ése es el dato que hay que cargar primero. */
      const r = calcularRetencionGAN({
        facturas: [fact({ importeNeto: null, totalFactura: 900_000 })],
        imputaciones: { f: 1_000_000 },
        parametros: PARAMS,
        baseNoImponibleDisponible: true,
      })
      return !r.ok && r.motivo === 'sin-importe-neto'
    })(),
  },

  /* --- Los mensajes nombran el valor leído, que es lo que hace falta para depurar --- */
  {
    nombre: 'el mensaje de la alícuota muestra su valor',
    ok: mensajeSinRetencion({ ok: false, motivo: 'alicuota-invalida', detalle: '0', faltantes: [] }).mensaje.includes('0'),
  },
  /* El comprobante NO va en el cuerpo del mensaje: va en la lista de faltantes, que es lo que la
     ventana enumera debajo. */
  {
    nombre: 'la falta de datos nombra el comprobante Y el dato que le falta',
    ok: (() => {
      const r = calcularRetencionGAN({
        facturas: [fact({ id: 'x', nro: 'FC-0007', importeNeto: null })],
        imputaciones: { x: 1_000_000 },
        parametros: PARAMS,
        baseNoImponibleDisponible: true,
      })
      return (
        !r.ok &&
        r.faltantes.length === 1 &&
        r.faltantes[0].includes('FC-0007') &&
        r.faltantes[0].includes('Importe Neto')
      )
    })(),
  },
  {
    nombre: 'con varias facturas incompletas, las lista a TODAS',
    ok: (() => {
      const r = calcularRetencionGAN({
        facturas: [
          fact({ id: 'a', nro: 'A', importeNeto: null }),
          fact({ id: 'b', nro: 'B', importeNeto: null }),
          fact({ id: 'c', nro: 'C' }),
        ],
        imputaciones: { a: 1, b: 1, c: 1 },
        parametros: PARAMS,
        baseNoImponibleDisponible: true,
      })
      return !r.ok && r.faltantes.length === 2
    })(),
  },
  {
    nombre: 'la falta de datos se avisa por VENTANA, no en el renglón',
    ok: (() => {
      const sinNeto = calcularRetencionGAN({
        facturas: [fact({ importeNeto: null })],
        imputaciones: { f: 1_000_000 },
        parametros: PARAMS,
        baseNoImponibleDisponible: true,
      })
      const bajoMinimo = calcularRetencionGAN({
        facturas: [fact({ total: 10_000, importeNeto: 2_000 })],
        imputaciones: { f: 10_000 },
        parametros: { baseNoImponible: 0, alicuota: 10 },
        baseNoImponibleDisponible: true,
      })
      /* Los datos que faltan en un tablero interrumpen; el mínimo no retenible, no: describe el
         estado de lo que el usuario está armando. */
      return esFaltaDeDatos(sinNeto) && !esFaltaDeDatos(bajoMinimo)
    })(),
  },
  {
    nombre: 'la configuración inválida también interrumpe',
    ok: (() => {
      const r = calcularRetencionGAN({
        facturas: [fact({})],
        imputaciones: { f: 1_000_000 },
        parametros: { baseNoImponible: 0, alicuota: null },
        baseNoImponibleDisponible: true,
      })
      return esFaltaDeDatos(r)
    })(),
  },
  {
    nombre: 'el texto largo del mínimo documenta que es para responsables inscriptos',
    ok: MSG_RETENCION_MINIMO.includes('responsables inscriptos'),
  },
  {
    nombre: 'el corto entra debajo de un campo y nombra el mínimo',
    ok: MSG_RETENCION_MINIMO_CORTO.includes('240') && MSG_RETENCION_MINIMO_CORTO.length < 40,
  },

  /* --- El catálogo de cajas --- */
  {
    nombre: 'las tarjetas ya no son cajas de pago',
    ok: !CAJAS_PAGO.includes('Tarjeta de Debito' as never) && !CAJAS_PAGO.includes('Tarjeta de Credito' as never),
  },
  { nombre: 'la retención sí está en el catálogo', ok: CAJAS_PAGO.includes('Retencion GAN') },
  {
    nombre: 'los parámetros del mock alcanzan el mínimo',
    ok: PARAMETROS_RETENCION_MOCK.alicuota > 0 && PARAMETROS_RETENCION_MOCK.baseNoImponible >= 0,
  },
]

for (const r of retencion) {
  if (!r.ok) {
    fallas++
    console.log(`FALLA  retención · ${r.nombre}`)
  } else {
    console.log(`OK     retención · ${r.nombre}`)
  }
}


/* ===== Reparto de la RETENCIÓN sobre lo ya cargado =====
   Una retención no suma dinero: se descuenta de las cajas ya registradas, en partes iguales. Lo que
   se prueba es que el TOTAL PAGADO no se mueva —el pago sólo cierra en cero exacto— y que los
   centavos de la división no se pierdan. */

import { descontarRetencion } from '@/lib/pagosProveedor'

const caja = (id: string, importe: number): MovimientoCaja => ({ id, formaPago: 'Efectivo', importe })
const suma = (ms: readonly MovimientoCaja[]) => Math.round(ms.reduce((a, m) => a + m.importe, 0) * 100) / 100

const unaCaja = descontarRetencion([caja('a', 500_000)], 70_000)
const dosCajas = descontarRetencion([caja('a', 300_000), caja('b', 200_000)], 70_000)
/* 100 entre 3 no divide exacto: 33,33 + 33,33 + 33,34. */
const tresCajas = descontarRetencion([caja('a', 1_000), caja('b', 1_000), caja('c', 1_000)], 100)

const reparto: { nombre: string; ok: boolean }[] = [
  {
    nombre: 'con UNA caja, se le descuenta todo el monto',
    ok: !!unaCaja && unaCaja[0].importe === 430_000,
  },
  {
    nombre: 'con DOS, se reparte en partes iguales',
    ok: !!dosCajas && dosCajas[0].importe === 265_000 && dosCajas[1].importe === 165_000,
  },
  {
    nombre: 'el TOTAL PAGADO no se mueve · una caja',
    ok: !!unaCaja && suma(unaCaja) + 70_000 === 500_000,
  },
  {
    nombre: 'el TOTAL PAGADO no se mueve · dos cajas',
    ok: !!dosCajas && suma(dosCajas) + 70_000 === 500_000,
  },
  {
    nombre: 'los centavos de la división no se pierden',
    ok: !!tresCajas && suma(tresCajas) + 100 === 3_000,
  },
  {
    nombre: 'el resto de la división lo carga la ÚLTIMA',
    ok: !!tresCajas && tresCajas[0].importe === 966.67 && tresCajas[2].importe === 966.66,
  },
  {
    nombre: 'sin cajas previas no hay nada que repartir',
    ok: JSON.stringify(descontarRetencion([], 70_000)) === '[]',
  },
  {
    nombre: 'una retención anterior NO absorbe a otra',
    ok: (() => {
      const previos: MovimientoCaja[] = [
        caja('a', 300_000),
        { id: 'r', formaPago: 'Retencion GAN', importe: 50_000 },
      ]
      const r = descontarRetencion(previos, 60_000)
      /* Todo el descuento cae en la caja de efectivo: en la retención anterior no hay plata de la
         cual descontar. */
      return !!r && r[0].importe === 240_000 && r[1].importe === 50_000
    })(),
  },
  {
    nombre: 'si el reparto dejaría una caja sin importe, no se hace',
    ok: descontarRetencion([caja('a', 300_000), caja('b', 10_000)], 70_000) === null,
  },
  {
    nombre: 'una caja que quedaría exactamente en cero tampoco vale',
    ok: descontarRetencion([caja('a', 70_000)], 70_000) === null,
  },
  {
    nombre: 'el reducer aplica el reparto al agregar',
    ok: (() => {
      const conCaja = aplicar(etapa3, [
        { type: 'agregarMovimientoCaja', movimiento: { formaPago: 'Transferencia', importe: 500_000, bancoOrigenId: '1' } },
        { type: 'agregarMovimientoCaja', movimiento: { formaPago: 'Retencion GAN', importe: 70_000 } },
      ])
      const ms = conCaja.pago.movimientos
      return ms.length === 2 && ms[0].importe === 430_000 && ms[1].importe === 70_000
    })(),
  },
  {
    nombre: 'y lo RECHAZA si no entra, en vez de dejar un importe negativo',
    ok: (() => {
      const conCaja = aplicar(etapa3, [
        { type: 'agregarMovimientoCaja', movimiento: { formaPago: 'Efectivo', importe: 10_000 } },
        { type: 'agregarMovimientoCaja', movimiento: { formaPago: 'Retencion GAN', importe: 70_000 } },
      ])
      return conCaja.pago.movimientos.length === 1
    })(),
  },
  {
    nombre: 'el orden inverso también cierra: primero la retención y después la caja',
    ok: (() => {
      const st = aplicar(etapa3, [
        { type: 'agregarMovimientoCaja', movimiento: { formaPago: 'Retencion GAN', importe: 70_000 } },
        { type: 'agregarMovimientoCaja', movimiento: { formaPago: 'Transferencia', importe: 430_000, bancoOrigenId: '1' } },
      ])
      return suma(st.pago.movimientos) === 500_000
    })(),
  },
]

for (const r of reparto) {
  if (!r.ok) {
    fallas++
    console.log(`FALLA  reparto · ${r.nombre}`)
  } else {
    console.log(`OK     reparto · ${r.nombre}`)
  }
}


/* ===== Importes que NO se editan en la tabla de cajas registradas =====
   El del cheque es el del documento y el de la retención sale de una fórmula: ninguno es una cifra
   a ajustar. Se comprueba en el REDUCER, que es donde vive la regla —la tabla ya no ofrece el campo,
   pero eso es la pantalla y esto es el cerrojo—. */

const conTresCajas = aplicar(etapa3, [
  { type: 'agregarMovimientoCaja', movimiento: { formaPago: 'Efectivo', importe: 400_000 } },
  { type: 'agregarMovimientoCaja', movimiento: { formaPago: 'Cheque', importe: 100_000, modalidadCheque: 'cartera', chequeId: '9' } },
  { type: 'agregarMovimientoCaja', movimiento: { formaPago: 'Retencion GAN', importe: 50_000 } },
])

/** El importe de un movimiento después de intentar cambiarlo a 1 peso. */
const trasEditar = (formaPago: string) => {
  const objetivo = conTresCajas.pago.movimientos.find((m) => m.formaPago === formaPago)
  if (!objetivo) return null
  const st = reducer(conTresCajas, { type: 'setMovimientoCajaImporte', id: objetivo.id, importe: 1 })
  return st.pago.movimientos.find((m) => m.id === objetivo.id)?.importe ?? null
}

const noEditables: { nombre: string; ok: boolean }[] = [
  {
    nombre: 'el importe de una RETENCIÓN no se puede cambiar',
    ok: trasEditar('Retencion GAN') === 50_000,
  },
  { nombre: 'el de un CHEQUE tampoco', ok: trasEditar('Cheque') === 75_000 },
  {
    nombre: 'el de una caja común SÍ se puede ajustar',
    ok: trasEditar('Efectivo') === 1,
  },
]

for (const n of noEditables) {
  if (!n.ok) {
    fallas++
    console.log(`FALLA  no editable · ${n.nombre}`)
  } else {
    console.log(`OK     no editable · ${n.nombre}`)
  }
}


/* ===== Banco de Origen de una transferencia =====
   Es obligatorio: sin él el movimiento no dice de dónde salió el dinero. La regla vive en el bloqueo
   del paso; el aviso bajo el campo es la otra mitad —y es la que estaba rota, porque su clave no
   coincidía con la del campo—. */

const conTransferencia = (bancoOrigenId: string | null): MovimientoCaja[] => [
  { id: 't', formaPago: 'Transferencia', importe: 500_000, bancoOrigenId },
]

const bancoOrigen: { nombre: string; ok: boolean }[] = [
  {
    nombre: 'sin banco de origen, el paso se frena',
    ok:
      bloqueoPago(
        conTransferencia(null),
        resumenPagoFn(conTransferencia(null), 500_000),
      )?.titulo === 'Falta el banco de origen',
  },
  {
    nombre: 'y se nombra la caja que hay que corregir',
    ok: (bloqueoPago(conTransferencia(null), resumenPagoFn(conTransferencia(null), 500_000))
      ?.faltantes ?? []).some((f) => f.includes('Transferencia')),
  },
  {
    nombre: 'con el banco elegido, no frena nada',
    ok:
      bloqueoPago(
        conTransferencia('7777'),
        resumenPagoFn(conTransferencia('7777'), 500_000),
      ) === null,
  },
]

for (const b of bancoOrigen) {
  if (!b.ok) {
    fallas++
    console.log(`FALLA  banco origen · ${b.nombre}`)
  } else {
    console.log(`OK     banco origen · ${b.nombre}`)
  }
}


/* ===== La línea de la RETENCIÓN en el tablero =====
   Su importe no se explica solo, así que la línea lleva además la BASE sobre la que se aplicó la
   alícuota y la FILA de configuración de la que salieron los parámetros. */

const filaRetencion = columnasCaja({
  id: 'r',
  formaPago: 'Retencion GAN',
  importe: 70_000,
  baseImponible: 3_500_000,
  alicuota: 2,
  configRetencionId: '12912259087',
})

const lineaRet: { nombre: string; ok: boolean }[] = [
  {
    /* Ya tiene su etiqueta en el tablero, así que va por ÍNDICE como todas: escribirla por rótulo
       creaba una etiqueta nueva si alguien la renombraba. */
    nombre: 'la caja va por ÍNDICE, como el resto',
    ok: JSON.stringify(filaRetencion['status']) === '{"index":8}',
  },
  { nombre: 'el monto retenido va en la columna de entregado', ok: filaRetencion['numeric_mm4e8pa3'] === 70_000 },
  { nombre: 'la base imponible tiene su propia columna', ok: filaRetencion['numeric_mm6mrs9'] === 3_500_000 },
  {
    nombre: 'y se linkea la fila de configuración usada',
    ok: JSON.stringify(filaRetencion['board_relation_mm6my17v']) === '{"item_ids":[12912259087]}',
  },
  {
    nombre: 'sin esos datos las columnas se OMITEN, no van en cero',
    ok: (() => {
      const f = columnasCaja({ id: 'r', formaPago: 'Retencion GAN', importe: 70_000 })
      return !('numeric_mm6mrs9' in f) && !('board_relation_mm6my17v' in f)
    })(),
  },
  {
    nombre: 'una base imponible en CERO sí se escribe: es un valor real',
    ok: columnasCaja({ id: 'r', formaPago: 'Retencion GAN', importe: 1, baseImponible: 0 })['numeric_mm6mrs9'] === 0,
  },
  {
    nombre: 'el control de totales quedó ACTIVADO',
    ok: COL.factCompraDoc.total === 'numeric_mm6m1e3c',
  },
  {
    /* El número con el que la retención va a nacer en "🔃Retenciones". */
    nombre: 'lleva el número de la retención a crear',
    ok:
      columnasCaja(
        { id: 'r', formaPago: 'Retencion GAN', importe: 70_000 },
        'RETENC-005',
      )['text_mm6rr4f2'] === 'RETENC-005',
  },
  {
    /* Sin número no se estampa nada: uno inventado chocaría con el que asigne el tablero. */
    nombre: 'sin número averiguado, la columna se omite',
    ok:
      !('text_mm6rr4f2' in columnasCaja({ id: 'r', formaPago: 'Retencion GAN', importe: 70_000 })) &&
      !(
        'text_mm6rr4f2' in
        columnasCaja({ id: 'r', formaPago: 'Retencion GAN', importe: 70_000 }, '  ')
      ),
  },
  {
    /* Y sólo la lleva la RETENCIÓN: una transferencia con el mismo número al alcance no lo escribe. */
    nombre: 'ninguna otra caja lo escribe',
    ok: !(
      'text_mm6rr4f2' in
      columnasCaja({ id: 't', formaPago: 'Transferencia', importe: 70_000 }, 'RETENC-005')
    ),
  },
]

/* ===== El CONTADOR de la serie de retenciones =====
   Se lee el código de la última fila del tablero y se le suma uno. La forma la dicta la serie que
   se leyó, no una configuración: el board muestra tres dígitos aunque su ajuste diga dos. */
const serie: { nombre: string; ok: boolean }[] = [
  { nombre: 'suma uno conservando el ancho', ok: siguienteNroSerie('RETENC-004') === 'RETENC-005' },
  { nombre: 'cruza la decena sin perder dígitos', ok: siguienteNroSerie('RETENC-009') === 'RETENC-010' },
  { nombre: 'y la centena', ok: siguienteNroSerie('RETENC-099') === 'RETENC-100' },
  {
    /* Desbordar el ancho lo AGRANDA: recortarlo daría un número que ya se usó. */
    nombre: 'al desbordar, el número crece en vez de recortarse',
    ok: siguienteNroSerie('RETENC-999') === 'RETENC-1000',
  },
  { nombre: 'tolera espacios alrededor', ok: siguienteNroSerie('  RETENC-004  ') === 'RETENC-005' },
  { nombre: 'sirve con cualquier prefijo', ok: siguienteNroSerie('X-7') === 'X-8' },
  {
    /* Sin dígitos que continuar no se inventa una serie: la línea se escribe sin número. */
    nombre: 'sin dígitos al final, devuelve null',
    ok: siguienteNroSerie('RETENC') === null && siguienteNroSerie('') === null,
  },
]

for (const c of serie) {
  if (!c.ok) {
    fallas++
    console.log(`FALLA  serie retención · ${c.nombre}`)
  } else {
    console.log(`OK     serie retención · ${c.nombre}`)
  }
}

for (const l of lineaRet) {
  if (!l.ok) {
    fallas++
    console.log(`FALLA  línea retención · ${l.nombre}`)
  } else {
    console.log(`OK     línea retención · ${l.nombre}`)
  }
}

/* ===== Las DOS fechas del CHEQUE =====
   El cheque nuevo declara su FECHA DE PAGO —el día desde el que el banco lo paga— y de ahí sale el
   vencimiento: 30 días después. El de cartera no declara pago: ya viene del tablero con su
   vencimiento cargado. */

const enDiasAR = (dias: number): string => {
  const f = new Date()
  f.setHours(0, 0, 0, 0)
  f.setDate(f.getDate() + dias)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(f.getDate())}/${pad(f.getMonth() + 1)}/${f.getFullYear()}`
}

const fechasCheque: { nombre: string; ok: boolean }[] = [
  {
    nombre: 'el vencimiento es la fecha de pago + 30 días',
    ok: vencimientoDeCajaCheque({ fechaPagoCheque: '01/10/2026' }) === '31/10/2026',
  },
  {
    /* El de CARTERA no declara fecha de pago: su vencimiento es el que ya trae el ítem. */
    nombre: 'sin fecha de pago, vale la del tablero',
    ok: vencimientoDeCajaCheque({ chequeVencimiento: '05/09/2026' }) === '05/09/2026',
  },
  {
    nombre: 'la de pago GANA sobre la del tablero',
    ok:
      vencimientoDeCajaCheque({ fechaPagoCheque: '01/10/2026', chequeVencimiento: '05/09/2026' }) ===
      '31/10/2026',
  },
  { nombre: 'sin ninguna de las dos, vacío', ok: vencimientoDeCajaCheque({}) === '' },
  /* --- Las dos reglas de fecha, las mismas que en un cobro --- */
  { nombre: 'una fecha de pago de ayer no sirve', ok: fechaPagoChequeInvalida(enDiasAR(-1)) },
  { nombre: 'la de HOY sí: un cheque al día se paga hoy', ok: !fechaPagoChequeInvalida(enDiasAR(0)) },
  { nombre: 'y una diferida también', ok: !fechaPagoChequeInvalida(enDiasAR(60)) },
  { nombre: 'sin fecha cargada, tampoco sirve', ok: fechaPagoChequeInvalida('') },
  {
    /* Más de 30 días atrás: el vencimiento derivado ya pasó y el banco no lo paga. */
    nombre: 'a más de 30 días atrás, el cheque está VENCIDO',
    ok: chequeVencido(enDiasAR(-31)),
  },
  {
    /* Justo 30 días atrás vence HOY, y vencer hoy es estar al día: todavía se puede depositar. */
    nombre: 'a 30 días exactos vence hoy, y hoy todavía sirve',
    ok: !chequeVencido(enDiasAR(-30)),
  },
  {
    /* Sin fecha de pago no es "vencido": es un campo vacío, y eso lo reclama la otra regla. */
    nombre: 'sin fecha de pago no se lo declara vencido',
    ok: !chequeVencido(''),
  },
  /* --- El subelemento escribe las DOS --- */
  {
    nombre: 'el subelemento lleva la fecha de pago y el vencimiento derivado',
    ok: (() => {
      const f = columnasCaja({
        id: 'n9',
        formaPago: 'Cheque',
        importe: 1,
        modalidadCheque: 'nuevo',
        fechaPagoCheque: '01/10/2026',
      })
      return (
        JSON.stringify(f['date_mm6v39m2']) === '{"date":"2026-10-01"}' &&
        JSON.stringify(f['date_mm6kv044']) === '{"date":"2026-10-31"}'
      )
    })(),
  },
  {
    /* El de cartera no tiene fecha de pago que escribir: esa columna se omite. */
    nombre: 'el de cartera omite la fecha de pago y conserva su vencimiento',
    ok: (() => {
      const f = columnasCaja({
        id: 'c8',
        formaPago: 'Cheque',
        importe: 1,
        modalidadCheque: 'cartera',
        chequeId: '1',
        chequeVencimiento: '05/09/2026',
      })
      return (
        !('date_mm6v39m2' in f) && JSON.stringify(f['date_mm6kv044']) === '{"date":"2026-09-05"}'
      )
    })(),
  },
  {
    nombre: 'ninguna otra caja escribe la fecha de pago',
    ok: !('date_mm6v39m2' in columnasCaja({ id: 't8', formaPago: 'Transferencia', importe: 1 })),
  },
]

for (const c of fechasCheque) {
  if (!c.ok) {
    fallas++
    console.log(`FALLA  fechas cheque · ${c.nombre}`)
  } else {
    console.log(`OK     fechas cheque · ${c.nombre}`)
  }
}

/* ===== El PEDIDO DE REGISTRO =====
   Lo último que la app escribe: al finalizar la operación pone "🤖Estado Registro de Pago" en
   "Registrar", que es lo que dispara la automatización que impacta la cuenta corriente del
   proveedor y marca las facturas como pagadas. */

const pedido: { nombre: string; ok: boolean }[] = [
  { nombre: 'va al tablero de PAGOS', ok: REGISTRO_PAGOS.board === BOARDS.ordenesPago },
  { nombre: 'sobre la columna del estado de registro', ok: REGISTRO_PAGOS.columna === 'color_mm6ka1xz' },
  {
    /* Por ÍNDICE, como toda columna status: un cambio de rótulo en el tablero no puede desviar el
       pedido a otro estado. */
    nombre: 'escribe "Registrar" por índice (el 3 de ESTE tablero)',
    ok: REGISTRO_PAGOS.registrar === OP_REGISTRO_INDEX.registrar && REGISTRO_PAGOS.registrar === 3,
  },
  {
    /* La confusión que este mapa existe para evitar: en el recibo "Registrar" es el 4. Son dos
       columnas de dos tableros distintos. */
    nombre: 'y NO el índice del recibo, que es otro',
    ok: REGISTRO_PAGOS.registrar !== REGISTRO_COBROS.registrar,
  },
  {
    nombre: 'los dos finales que cortan la espera son los del tablero',
    ok:
      REGISTRO_PAGOS.registrado === OP_REGISTRO_INDEX.registrado &&
      REGISTRO_PAGOS.error === OP_REGISTRO_INDEX.error,
  },
]

const nombresAnticipo: { nombre: string; ok: boolean }[] = [
  {
    /* El ítem ya se llama "Anticipo - IDPAGO-009": anteponerle la palabra la duplicaba. */
    nombre: 'no repite la palabra si el nombre ya la trae',
    ok: descripcionAnticipo('Anticipo - IDPAGO-009') === 'Anticipo - IDPAGO-009',
  },
  { nombre: 'tampoco con otra capitalización', ok: descripcionAnticipo('anticipo - X') === 'anticipo - X' },
  {
    /* Pero un nombre cualquiera SÍ la necesita: sin ella el renglón no dice de qué se trata. */
    nombre: 'la agrega cuando el nombre no la tiene',
    ok: descripcionAnticipo('Saldo a favor 03') === 'Anticipo Saldo a favor 03',
  },
  {
    /* "Anticipos" no es "Anticipo": la palabra completa es la que cuenta. */
    nombre: 'no se confunde con una palabra que empieza igual',
    ok: descripcionAnticipo('Anticipado 7') === 'Anticipo Anticipado 7',
  },
  {
    nombre: 'sin nombre, la línea se llama "Anticipo" a secas',
    ok: descripcionAnticipo('') === 'Anticipo' && descripcionAnticipo(undefined) === 'Anticipo',
  },
]

for (const c of nombresAnticipo) {
  if (!c.ok) {
    fallas++
    console.log(`FALLA  nombre anticipo · ${c.nombre}`)
  } else {
    console.log(`OK     nombre anticipo · ${c.nombre}`)
  }
}

for (const c of pedido) {
  if (!c.ok) {
    fallas++
    console.log(`FALLA  registro · ${c.nombre}`)
  } else {
    console.log(`OK     registro · ${c.nombre}`)
  }
}

console.log(fallas === 0 ? '\npagos: OK' : `\npagos: ${fallas} falla(s)`)
process.exit(fallas === 0 ? 0 : 1)
