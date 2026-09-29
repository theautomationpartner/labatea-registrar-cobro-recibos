/**
 * Los documentos que genera la app —recibo, orden de pago, resumen y estado de cta cte— y su envío por
 * el escenario de Make.
 *
 *   · Genera los PDF DE VERDAD, en Node con `renderToBuffer`, en cada variante (cobro, anticipo y
 *     aplicación; pago, anticipo y aplicación), y comprueba que son PDF válidos de una página.
 *   · Genera los Excel del resumen y del estado y los vuelve a leer para ver que dicen lo mismo.
 *   · Fija el contrato que recibe el escenario de Make: tipo, archivos, titular y un mensaje por
 *     contacto; y cómo se lee su respuesta.
 *   · Fija las reglas del estado: qué descarta una emisión y cómo se retoma un registro.
 *
 * Se corre con esbuild + node (`npm run test:documentos`); vive fuera de `src/`. Deja los PDF y los
 * Excel en `node_modules/.cache/documentos/` para mirarlos a ojo.
 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { renderToBuffer } from '@react-pdf/renderer'
import { createElement, type ReactElement } from 'react'
import { CLIENTES } from '@/data/mock'
import { ConstanciaRetencionPdf } from '@/features/documentos/pdf/ConstanciaRetencionPdf'
import { EstadoCtaCtePdf } from '@/features/documentos/pdf/EstadoCtaCtePdf'
import { TEMPLATE_ORDEN_PAGO } from '@/features/documentos/pdf/OrdenPagoPdf'
import { ReciboPdf } from '@/features/documentos/pdf/ReciboPdf'
import { ResumenCtaCtePdf } from '@/features/documentos/pdf/ResumenCtaCtePdf'
import { generarEstadoCtaCteExcel, generarResumenCtaCteExcel } from '@/features/documentos/excel/excelCtaCte'
import { nombreComprobantePdf } from '@/features/documentos/generarDocumentos'
import { comprobanteEnviable, enviarComprobante, verificarWhatsapps } from '@/features/shared/comprobantesEnviables'
import { contenidoActividadResumen, envioDelResumen, tituloActividadResumen } from '@/lib/actividadResumen'
import { diasPromedioCobro } from '@/lib/diasPromedio'
import {
  diasPromedioDelPdf,
  esMixto,
  filasPagos,
  saldoConRecibo,
  totalRetenido,
  variablesRecibo,
  type DatosOrdenPagoPdf,
  type DatosReciboPdf,
} from '@/lib/documentoComprobante'
import { mensajesDe } from '@/lib/mensajesEnvio'
import { nombraLaOrden } from '@/services/monday/ordenPago'
import { armarEnvioDocumento, evaluarEnvio, problemasDeContactos, tipoDeEnvioEmail } from '@/lib/envioDocumento'
import { firmaDe } from '@/lib/firma'
import { armarRecibo, pagosDeAnticipos, type Recibo } from '@/lib/recibo'
import { armarOrdenDePago } from '@/lib/pagosProveedor'
import { filasComprobantes } from '@/lib/documentoComprobante'
import { cuerpoEnvioDocumento, leerRespuesta, parsearRespuestaEscenario } from '@/services/make/envioDocumento'
import { getFacturasAdeudadas, getMovimientosCtaCte } from '@/services/monday/resumenCtaCte'
import { etapaDeEmisionCompleta, initialState, reducer, type Action, type AppState } from '@/state/appState'
import { renderToString } from 'react-dom/server'
import { Stepper } from '@/components/ui/Stepper'
import type { Contacto, FacturaPendiente, MovimientoPago } from '@/types'

let asserts = 0
const igual = (real: unknown, esperado: unknown, nombre: string) => {
  assert.deepEqual(real, esperado, nombre)
  asserts++
  console.log('  ✓', nombre)
}
const aplicar = (estado: AppState, acciones: Action[]): AppState => acciones.reduce((acc, a) => reducer(acc, a), estado)

const CARPETA = 'node_modules/.cache/documentos'
mkdirSync(CARPETA, { recursive: true })

/** Cuántas páginas tiene el PDF: se cuentan los objetos `/Type /Page` (sin el `/Pages` raíz). */
const paginas = (pdf: Buffer): number => (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length

async function pdfDe(elemento: ReactElement, archivo: string): Promise<Buffer> {
  const buffer = await renderToBuffer(elemento as Parameters<typeof renderToBuffer>[0])
  writeFileSync(`${CARPETA}/${archivo}.pdf`, buffer)
  return buffer
}

const cliente = CLIENTES[0]
const titular = { name: cliente.name, cuit: cliente.cuit, addr: cliente.addr }

const factura = (id: string, nro: string, emision: string, vencimiento: string): FacturaPendiente =>
  ({ id, nro, emision, vencimiento }) as unknown as FacturaPendiente
const movimiento = (id: string, formaPago: string, importe: number, extra: Partial<MovimientoPago> = {}): MovimientoPago =>
  ({ id, formaPago, importe, ...extra }) as unknown as MovimientoPago

const FACTURAS = [
  factura('f1', 'FPENCOB-071', '2026-09-04', '2026-10-04'),
  factura('f2', 'FPENCOB-085', '2026-09-18', '2026-10-18'),
]

const base = (documento: Recibo): Omit<DatosOrdenPagoPdf, 'variante' | 'numero' | 'nombre'> => ({
  fechaEmision: '28/09/2026',
  titular,
  documento,
  logoSrc: 'public/logo-la-batea-pdf.png',
})

async function main() {
  console.log('Caso 1 · Las variables del template del recibo son las de los PDF de Make:')
  igual(variablesRecibo('facturas').doc_tipo, 'Documento de cobro', 'recibo de cobro')
  igual(variablesRecibo('facturas').mostrar_recibimos, true, 'con "RECIBIMOS CONFORME…"')
  igual(variablesRecibo('anticipo').tot_inf, 'TOTAL ANTICIPO:', 'recibo de anticipo')
  igual(
    [variablesRecibo('aplicacion').subtitulo_sup, variablesRecibo('aplicacion').mostrar_recibimos],
    ['Anticipo Aplicado (Origen)', false],
    'recibo de aplicación: sin "RECIBIMOS" y con el título del origen',
  )

  console.log('\nCaso 2 · El recibo de un cobro: saldo de la cuenta y días promedio, como en Make:')
  const cobro = armarRecibo(FACTURAS, { f1: 90_000, f2: 8_285.88 }, [
    movimiento('m1', 'Echeq', 90_000, { numeroCheque: '12500658' }),
    movimiento('m2', 'Efectivo', 8_285.88),
  ])
  const dias = diasPromedioCobro(cobro.comprobantes, '28/09/2026')
  igual(saldoConRecibo(500_000, cobro.totalEntregado), 401_714.12, 'saldo pendiente = deuda − lo recibido')
  igual(saldoConRecibo(undefined, 1), null, 'sin deuda conocida no se imprime el saldo')
  igual(diasPromedioDelPdf({ ok: true, fecha: '10/09/2026', dias: 15 }), '10-09-2026 (15 dias)', 'días promedio con el formato del PDF')
  igual(diasPromedioDelPdf({ ok: false, motivo: 'x' }), null, 'sin días promedio calculables no se imprime el renglón')
  const numero = 'RECIBO-125'
  igual(nombreComprobantePdf(cliente.name, numero).endsWith('-RECIBO-125'), true, 'el archivo se llama "Razón social-Nro"')
  const pdfCobro = await pdfDe(
    createElement(ReciboPdf, {
      ...base(cobro),
      variante: 'facturas',
      numero,
      nombre: nombreComprobantePdf(cliente.name, numero),
      saldoPendiente: saldoConRecibo(500_000, cobro.totalEntregado),
      diasPromedio: dias,
    }),
    'recibo-cobro',
  )
  igual(pdfCobro.subarray(0, 5).toString(), '%PDF-', 'es un PDF')
  igual(paginas(pdfCobro), 1, 'de una página')

  console.log('\nCaso 3 · Las otras cinco variantes también salen:')
  const anticipo = armarRecibo([], {}, [movimiento('m1', 'Efectivo', 100_000)])
  const aplicacion = armarRecibo(FACTURAS, { f2: 100_000 }, [], pagosDeAnticipos([{ id: 'a1', nro: 'Anticipo - RECIBO-074', importe: 100_000 }]))
  const conSobrante = armarRecibo(FACTURAS, { f1: 266_423.04 }, [
    movimiento('m1', 'Cheque', 600_000, { numeroCheque: '15935562' }),
    movimiento('m2', 'Anticipo', 333_576.96),
  ])
  const recibos: [string, DatosReciboPdf][] = [
    ['recibo-anticipo', { ...base(anticipo), variante: 'anticipo', numero: 'RECIBO-126', nombre: 'a', anticipo: { importe: 100_000 }, saldoPendiente: 404_362.51 }],
    ['recibo-aplicacion', { ...base(aplicacion), variante: 'aplicacion', numero: 'RECIBO-127', nombre: 'b', saldoPendiente: 665_475.42 }],
  ]
  for (const [archivo, datos] of recibos) {
    const pdf = await pdfDe(createElement(ReciboPdf, datos), archivo)
    igual(pdf.subarray(0, 5).toString() === '%PDF-' && paginas(pdf) === 1, true, `${archivo}: PDF de una página`)
  }
  /* La orden de pago tiene un template por recorrido. */
  const ordenes: [string, DatosOrdenPagoPdf][] = [
    ['op-pago', { ...base(conSobrante), variante: 'facturas', numero: 'IDPAGO-021', nombre: 'c' }],
    ['op-anticipo', { ...base(anticipo), variante: 'anticipo', numero: 'IDPAGO-022', nombre: 'd', anticipo: { importe: 500_000, nombre: 'Anticipo · Semillas', vencimiento: '30/10/2026' } }],
    ['op-aplicacion', { ...base(aplicacion), variante: 'aplicacion', numero: 'IDPAGO-023', nombre: 'e' }],
  ]
  for (const [archivo, datos] of ordenes) {
    const pdf = await pdfDe(createElement(TEMPLATE_ORDEN_PAGO[datos.variante], datos), archivo)
    igual(pdf.subarray(0, 5).toString() === '%PDF-' && paginas(pdf) === 1, true, `${archivo}: PDF de una página`)
  }
  igual(esMixto(ordenes[0][1]), true, 'la orden que deja un anticipo por el sobrante es "mixta"')
  igual(filasPagos(ordenes[2][1])[0], { caja: 'Anticipo', nro_comprobante: 'Anticipo - RECIBO-074', importe: 100_000 }, 'en la aplicación, cada pago es un anticipo')

  const conTransferencia = armarOrdenDePago([], {}, [
    { id: 't1', formaPago: 'Transferencia', importe: 50_000, nroComprobanteTransferencia: 'TRF-778899' } as never,
  ])
  igual(filasPagos({ ...base(conTransferencia), variante: 'anticipo', numero: 'x', nombre: 'x' })[0].nro_comprobante, 'TRF-778899', 'la transferencia lleva su número de comprobante')
  igual(
    filasComprobantes({ ...base(conTransferencia), variante: 'anticipo', numero: 'x', nombre: 'x', anticipo: { importe: 50_000, emision: '29/09/2026' } })[0].fecha_emision_comp,
    '29/09/2026',
    'el anticipo de la orden sale con la fecha de emisión del pago',
  )

  console.log('\nCaso 3b · La constancia de retención de Ganancias:')
  const retenciones = [
    { regimen: 'Retencion GAN', comprobante_origen: 'Factura N° 0002-00003314', monto_base: 150_000, alicuota: 2, monto_retenido: 3_000 },
  ]
  igual(totalRetenido(retenciones), 3_000, 'el total retenido es la suma de las filas')
  const constancia = await pdfDe(
    createElement(ConstanciaRetencionPdf, {
      certificado: 'RETENC-006',
      nombre: 'constancia',
      fechaRetencion: '28/09/2026',
      refOrdenPago: 'IDPAGO-021',
      retenido: titular,
      retenciones,
      logoSrc: 'public/logo-la-batea-pdf.png',
    }),
    'constancia-retencion',
  )
  igual(constancia.subarray(0, 5).toString() === '%PDF-' && paginas(constancia) === 1, true, 'la constancia es un PDF de una página')
  igual(
    [nombraLaOrden('Retencion GAN - IDPAGO-010 - 1293 - x', 'IDPAGO-010'), nombraLaOrden('Retencion GAN - IDPAGO-010 - x', 'IDPAGO-01')],
    [true, false],
    'la fila de "Retenciones" se reconoce por el número ENTERO de la orden',
  )

  console.log('\nCaso 4 · El resumen y el estado de cuenta, en PDF y en Excel:')
  const periodo = { desde: '2026-06-30', hasta: '2026-09-28' }
  const { movimientos } = await getMovimientosCtaCte(cliente, periodo)
  const facturas = await getFacturasAdeudadas(cliente)
  const comun = { cliente: titular, cuentaNro: 'CTACTEC-001', hoy: '2026-09-28', logoSrc: 'public/logo-la-batea-pdf.png' }
  const resumen = await pdfDe(createElement(ResumenCtaCtePdf, { ...comun, nombre: 'Resumen', periodo, movimientos }), 'resumen-cta-cte')
  const estado = await pdfDe(createElement(EstadoCtaCtePdf, { ...comun, nombre: 'Estado', facturas }), 'estado-cta-cte')
  igual(resumen.subarray(0, 5).toString() === '%PDF-' && estado.subarray(0, 5).toString() === '%PDF-', true, 'los dos son PDF')
  igual(movimientos.length > 0 && facturas.length > 0, true, 'con los movimientos y las facturas de prueba')

  const { default: ExcelJS } = await import('exceljs')
  const excelResumen = await generarResumenCtaCteExcel({ ...comun, nombre: 'Resumen_Cta_Cte-Periodo-30-06-2026-28-09-2026', periodo, movimientos })
  const excelEstado = await generarEstadoCtaCteExcel({ ...comun, nombre: 'Estado_Cta_Cte-Fecha-28-09-2026', facturas })
  writeFileSync(`${CARPETA}/${excelResumen.name}`, Buffer.from(await excelResumen.arrayBuffer()))
  writeFileSync(`${CARPETA}/${excelEstado.name}`, Buffer.from(await excelEstado.arrayBuffer()))
  igual(excelResumen.name.endsWith('.xlsx') && excelEstado.name.endsWith('.xlsx'), true, 'los Excel se llaman como los de Make')
  const libro = new ExcelJS.Workbook()
  await libro.xlsx.load(await excelResumen.arrayBuffer())
  const hoja = libro.worksheets[0]
  igual(hoja.getCell('A4').value, 'RESUMEN DE CUENTA', 'el Excel del resumen abre con su título')
  igual(hoja.getCell('E7').value, 'CTACTEC-001', 'y el número de la cuenta')
  const filas: string[] = []
  hoja.eachRow((r) => filas.push(String(r.getCell(2).value ?? '')))
  igual(filas.includes('Saldo Inicial'), true, 'con la fila de saldo inicial')
  igual(
    movimientos.every((m) => filas.includes(m.comprobante)),
    true,
    'y una fila por movimiento, con el mismo comprobante que la card',
  )

  console.log('\nCaso 5a · Los mensajes son los de los módulos de Make:')
  const recibo = mensajesDe('RECIBO', { razonSocial: 'X', contacto: 'Ana Pérez', fechaEmision: '28/09/2026', fechaVencimiento: null, periodo: null })
  igual(
    recibo.whatsapp,
    '👋*¡Hola Ana Pérez!*\nTe adjuntamos el *RECIBO* con 📅*Fecha de emision: 28-09-2026*. \nCualquier consulta estamos a tu disposicion.\n\n*LA BATEA*',
    'recibo por WhatsApp',
  )
  igual(recibo.email.content.startsWith('👋 <b>¡Hola Ana Pérez!</b><br>') && recibo.email.content.includes('<b>recibo</b> emitido el 📅 <b>Fecha de Emisión:</b> 28-09-2026.'), true, 'recibo por email')
  const orden = mensajesDe('ORDEN DE PAGO', { razonSocial: 'X', contacto: 'Ana Pérez', fechaEmision: '28/09/2026', fechaVencimiento: null, periodo: null })
  igual(orden.whatsapp.includes('Te adjuntamos la *ORDEN DE PAGO* con *Fecha de emision: 28-09-2026*. '), true, 'orden de pago por WhatsApp')
  igual(orden.email.content.includes('<b>Orden de Pago</b> con <b>Fecha de Emisión:</b> 28-09-2026.'), true, 'orden de pago por email')
  igual(Object.keys(recibo.email), ['content', 'subject'], 'email es un objeto con content y subject')
  const resumenMsj = mensajesDe('RESUMEN CTA CTE', {
    razonSocial: 'X',
    contacto: 'Ana Pérez',
    fechaEmision: '28/09/2026',
    fechaVencimiento: null,
    periodo: { desde: '30/06/2026', hasta: '28/09/2026' },
  })
  igual(
    resumenMsj.whatsapp,
    '👋 ¡Hola *Ana Pérez*!\nTe adjuntamos el *RESUMEN DE CUENTA CORRIENTE* para el periodo 30/06/2026 a 28/09/2026. \nCualquier duda estamos a tu disposición.\n\n*LA BATEA*',
    'resumen por WhatsApp, con el período',
  )
  igual(resumenMsj.email.content.startsWith('<div style="font-family: Arial, Helvetica, sans-serif;') && resumenMsj.email.content.includes('para el periodo 30/06/2026 a 28/09/2026.</p>'), true, 'resumen por email, en su <div>')

  igual(
    [recibo.email.subject, orden.email.subject, resumenMsj.email.subject],
    ['LA BATEA - Recibo Emitido: 28-09-2026', 'LA BATEA - Orden de Pago Emitido: 28-09-2026', 'LA BATEA - Presupuesto Emitido: 28-09-2026'],
    'cada email con su asunto y la fecha de emisión en DD-MM-YYYY',
  )
  console.log('\nCaso 5 · El contrato que recibe el escenario de Make:')
  const contacto = (id: string, name: string, email: string, phone: string, ok = true): Contacto => ({
    id,
    itemId: `9${id}`,
    name,
    primerNombre: name.split(' ')[0],
    email,
    phone,
    ok,
    ini: 'XX',
    color: '#000',
    status: ok ? 'ACEPTA' : 'NO ACEPTA',
  })
  const ana = contacto('1', 'Ana Pérez', 'ana@campo.com', '+5492494000001')
  const beto = contacto('2', 'Beto Gómez', 'beto@campo.com', '')
  const datos = armarEnvioDocumento({
    jobId: 'job_1',
    tipo: 'ORDEN DE PAGO',
    numero: 'IDPAGO-021',
    fechaEmision: '28/09/2026',
    fechaVencimiento: null,
    archivos: ['PROVEEDOR TEST-IDPAGO-021.pdf'],
    cliente: { id: '111', name: '123 - PROVEEDOR TEST', cuit: '20-55555555-6' },
    vendedor: { id: '222', name: 'Dev TAP' },
    medio: 'Ambos',
    contactos: [ana, beto],
  })
  igual(
    datos.documento,
    {
      tipo: 'ORDEN DE PAGO',
      numero: 'IDPAGO-021',
      fechaEmision: '2026-09-28',
      fechaVencimiento: null,
      archivo: 'PROVEEDOR TEST-IDPAGO-021.pdf',
      archivos: ['PROVEEDOR TEST-IDPAGO-021.pdf'],
    },
    'documento: tipo, número, fecha ISO y archivos',
  )
  igual(
    Object.keys(datos).slice(Object.keys(datos).indexOf('medio'), Object.keys(datos).indexOf('medio') + 2),
    ['medio', 'tipo_de_envio_email'],
    'tipo_de_envio_email va justo debajo de medio',
  )
  igual(datos.tipo_de_envio_email, 'gmail', 'la orden de pago con email sale por gmail')
  igual(
    [
      tipoDeEnvioEmail('RECIBO', 'Email'),
      tipoDeEnvioEmail('RECIBO', 'Ambos'),
      tipoDeEnvioEmail('RECIBO', 'WhatsApp'),
      tipoDeEnvioEmail('ORDEN DE PAGO', 'WhatsApp'),
      tipoDeEnvioEmail('RESUMEN CTA CTE', 'Email'),
      tipoDeEnvioEmail('RESUMEN CTA CTE', 'Ambos'),
    ],
    ['gmail', 'gmail', null, null, 'labatea', 'labatea'],
    'recibo y orden por gmail, resumen/estado por labatea, sólo WhatsApp en null',
  )
  igual(datos.cliente, { pulseId: '111', razonSocial: 'PROVEEDOR TEST', cuit: '20-55555555-6' }, 'el titular sin su código interno')
  igual(datos.destinatarios.map((d) => d.canales), [['email', 'whatsapp'], ['email']], 'cada contacto por los canales que puede')
  igual(datos.destinatarios[0].mensaje.whatsapp.startsWith('👋*¡Hola Ana Pérez!*'), true, 'cada destinatario lleva su mensaje, con su nombre y apellido')
  igual(datos.destinatarios[1].mensaje.email.content.includes('Beto Gómez') && datos.destinatarios[1].mensaje.email.content.includes('<b>LA BATEA</b>'), true, 'el email en HTML, con la firma')
  igual(
    problemasDeContactos([contacto('3', 'Caro', 'c@x.com', '', false)], 'Email', 'órdenes de pago'),
    ['Caro: no acepta recibir órdenes de pago. Quitalo de la lista.'],
    'el que no acepta el documento frena el envío, dicho en plural',
  )

  const pdf = new File([Buffer.from('%PDF-1.4 prueba')], 'a.pdf', { type: 'application/pdf' })
  const xlsx = new File([Buffer.from('xlsx')], 'b.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const cuerpo = await cuerpoEnvioDocumento(datos, [pdf, xlsx])
  igual(cuerpo.pdf.name, 'a.pdf', 'el principal viaja en `pdf`, como en la app de ventas')
  igual(cuerpo.adjuntos.map((a) => a.name), ['a.pdf', 'b.xlsx'], 'y todos en `adjuntos`, en orden')
  igual(Buffer.from(cuerpo.pdf.data, 'base64').toString(), '%PDF-1.4 prueba', 'en base64')

  console.log('\nCaso 6 · Cómo se lee lo que contesta el escenario:')
  const respuesta = leerRespuesta({
    operacion: 'ENVIO ORDEN DE PAGO',
    mensajeError: null,
    enviosEmail: [{ envio_email: true }, { envio_email: 'true' }],
    enviosWhatsapp: '[{"envio_whatsapp": false, "mensajeError": "el número no tiene WhatsApp"}]',
  })
  assert(respuesta.tipo === 'respuesta')
  const evaluacion = evaluarEnvio(datos, respuesta.resultados)
  igual(evaluacion.estado, 'parcial', 'mail a los dos y el WhatsApp no: parcial')
  igual(evaluacion.estado === 'parcial' && evaluacion.enviados, { '91': ['email'], '92': ['email'] }, 'lo que salió queda anotado')

  console.log('\nCaso 6b · El JSON que arma a mano el escenario, aunque no sea JSON válido:')
  /* Tal cual lo devolvió el escenario real a un pedido sin destinatarios. */
  const vacia = leerRespuesta(parsearRespuestaEscenario(
    '{\n  "operacion": "ENVIO RECIBO",\n  "medio": "Email",\n  "mensajeError": "",\n  "enviosWhatsapp": ,\n  "enviosEmail": \n}',
  ))
  igual(vacia.tipo === 'respuesta' && [vacia.resultados.email.length, vacia.resultados.whatsapp.length, vacia.ilegible], [0, 0, undefined], 'arrays vacíos sin nada escrito: se lee, sin resultados')
  const pegados = leerRespuesta(parsearRespuestaEscenario(
    '{ "operacion": "ENVIO RECIBO", "mensajeError": "", "enviosWhatsapp": {"messageId": "m1", "envio_whatsapp": true}, "enviosEmail": {"envio_email": true},{"envio_email": true} }',
  ))
  igual(
    pegados.tipo === 'respuesta' && [pegados.resultados.email.map((e) => e.ok), pegados.resultados.whatsapp.map((w) => w.whatsapp?.texto)],
    [[true, true], ['m1']],
    'ítems pegados sin corchetes: se leen todos',
  )
  console.log('\nCaso 6c · WhatsApp: el texto y cada documento, confirmados en 360Messenger:')
  {
    /* Tal cual el bundle del escenario: un array con un objeto. */
    const nueva = leerRespuesta([
      {
        enviados_whatsapp: [
          {
            nombre: 'Luciano 1',
            pulseId: '12587733631',
            envio_mensaje_texto: { phonenumber: '5492494014611', id: 'txt-1' },
            envio_mensaje_documentos: [{ data: { phonenumber: '5492494014611', id: 'doc-1' } }],
          },
          { pulseId: '2', envio_mensaje_texto: { id: 'txt-2' }, envio_mensaje_documentos: [] },
        ],
      },
    ])
    assert(nueva.tipo === 'respuesta')
    igual(nueva.ilegible, undefined, 'la respuesta nueva se lee')
    igual(
      nueva.resultados.whatsapp.map((w) => [w.pulseId, w.ok, w.whatsapp?.texto, w.whatsapp?.documentos]),
      [
        ['12587733631', true, 'txt-1', ['doc-1']],
        ['2', false, 'txt-2', []],
      ],
      'ids del texto y de los documentos; sin documentos no cuenta como enviado',
    )
    igual(nueva.resultados.whatsapp[1].motivo, 'el mensaje de WhatsApp salió, pero no el documento', 'y dice qué parte faltó')

    /* 360Messenger simulado: cada id con su estado. */
    const estados: Record<string, unknown> = {
      'txt-1': { status: 'OK' },
      'doc-1': { status: 'OK' },
      'txt-3': { status: 'OK' },
      'doc-3': { status: 'ERROR', statusInfo: 'message sending failed' },
    }
    const fetchReal = globalThis.fetch
    const consultados: string[] = []
    globalThis.fetch = (async (url: string) => {
      const id = new URL(url, 'http://x').searchParams.get('id') ?? ''
      consultados.push(id)
      return new Response(JSON.stringify({ success: true, data: estados[id] }), { status: 200 })
    }) as typeof fetch
    try {
      const [ok] = await verificarWhatsapps([nueva.resultados.whatsapp[0]], { intentos: 1, intervalo: 0 })
      igual([ok.ok, [...consultados].sort()], [true, ['doc-1', 'txt-1']], 'se confirman el texto Y el documento')
      const [sinDoc] = await verificarWhatsapps(
        [{ ok: true, pulseId: '3', whatsapp: { texto: 'txt-3', documentos: ['doc-3'], exigeDocumentos: true } }],
        { intentos: 1, intervalo: 0 },
      )
      igual(
        [sinDoc.ok, sinDoc.motivo],
        [false, 'salió el mensaje, pero no el documento: WhatsApp no pudo entregar el mensaje; revisá que el número sea correcto'],
        'el texto salió y el documento falló: no enviado, y dice cuál',
      )
    } finally {
      globalThis.fetch = fetchReal
    }
  }

  const basura = leerRespuesta(parsearRespuestaEscenario('Accepted'))
  igual(basura.tipo === 'respuesta' && basura.ilegible, true, 'sin resultado legible: no se sabe qué salió (ni éxito ni falla)')
  const otroId = evaluarEnvio(datos, { email: [{ ok: true, pulseId: '999' }, { ok: true, pulseId: '999' }], whatsapp: [] })
  igual(otroId.estado, 'parcial', 'ids del escenario que no son los de los contactos: se empareja por orden')

  console.log('\nCaso 7 · El estado: emitir, descartar y retomar el registro:')
  const firma = firmaDe({ a: 1, archivo: pdf })
  igual(firma === firmaDe({ a: 1, archivo: pdf }), true, 'la firma es estable')
  igual(firma === firmaDe({ a: 2, archivo: pdf }), false, 'y cambia con los datos')
  const conCliente = aplicar(initialState, [{ type: 'setCliente', cliente }])
  const emitido = aplicar(conCliente, [
    { type: 'setEmision', emision: { fase: 'emitido' } },
    {
      type: 'setReciboDoc',
      doc: {
        numero: 'RECIBO-125',
        fechaEmision: '28/09/2026',
        pdf,
        datos: { clienteId: cliente.id, nombreCliente: cliente.name, facturas: [], movimientos: [] },
        firma,
        registro: { pdfSubido: false, incompleto: null },
      },
    },
    { type: 'setPdfsAbiertos', value: 1 },
    { type: 'setDocumentoEnviado', value: true },
  ])
  const reemitido = aplicar(emitido, [
    { type: 'setReciboDoc', doc: { ...(emitido.reciboDoc as NonNullable<AppState['reciboDoc']>), numero: 'RECIBO-126' } },
  ])
  igual(
    [reemitido.reciboDoc?.numero, reemitido.documentoEnviado, reemitido.pdfsAbiertos, reemitido.emisionNro > emitido.emisionNro],
    ['RECIBO-126', false, 0, true],
    'reemitir reemplaza el PDF y el envío vuelve a cero (el bloque de envío se remonta)',
  )
  igual(comprobanteEnviable('recibo').emitido(emitido), true, 'con el PDF generado, el recibo se puede enviar')
  igual(comprobanteEnviable('recibo').documento(emitido)?.archivos, [pdf], 'y se manda ESE PDF')
  const avanzado = aplicar(emitido, [{ type: 'avanceRegistro', documento: 'recibo', avance: { pdfSubido: true } }])
  igual(avanzado.reciboDoc?.registro, { pdfSubido: true, incompleto: null }, 'el registro recuerda que el PDF ya subió')
  const descartado = aplicar(avanzado, [{ type: 'descartarEmision', documento: 'recibo' }])
  igual(
    [descartado.reciboDoc, descartado.emision.fase, descartado.documentoEnviado, descartado.pdfsAbiertos],
    [null, 'idle', false, 0],
    'descartar la emisión vuelve a emitir y a enviar de cero',
  )
  igual(aplicar(emitido, [{ type: 'setCliente', cliente: CLIENTES[1] }]).reciboDoc, null, 'cambiar de cliente descarta el recibo emitido')
  igual(aplicar(emitido, [{ type: 'reset' }]).reciboDoc, null, 'y cerrar la operación también')

  console.log('\nCaso 7b · La etapa de emitir y enviar se tilda al enviar o registrar:')
  {
    const enRecibo = aplicar(emitido, [{ type: 'goto', paso: 'recibo' }, { type: 'setDocumentoEnviado', value: false }])
    igual(etapaDeEmisionCompleta(enRecibo), false, 'recibo emitido sin enviar ni registrar: no está completa')
    igual(etapaDeEmisionCompleta(aplicar(enRecibo, [{ type: 'setDocumentoEnviado', value: true }])), true, 'emitido y enviado: completa')
    igual(etapaDeEmisionCompleta(aplicar(enRecibo, [{ type: 'setReciboId', id: '123' }])), true, 'emitido y registrado en Monday: completa')
    /* El módulo se abre directo: `setOperacionApp` pide un usuario con permiso de Pagos. */
    const opEmitida = aplicar({ ...initialState, operacionApp: 'PAGOS' }, [
      { type: 'gotoPago', paso: 'orden' },
      {
        type: 'setOrdenPagoDoc',
        doc: {
          numero: 'IDPAGO-021',
          fechaEmision: '29/09/2026',
          pdf,
          datos: { proveedorId: '1', nombreProveedor: 'P', facturas: [], movimientos: [] },
          firma: 'f',
          registro: { pdfSubido: false, incompleto: null },
        },
      },
    ])
    igual(
      [etapaDeEmisionCompleta(opEmitida), etapaDeEmisionCompleta(aplicar(opEmitida, [{ type: 'setDocumentoEnviado', value: true }]))],
      [false, true],
      'la orden de pago: sólo emitida no, emitida y enviada sí',
    )
    const html = renderToString(createElement(Stepper, { steps: ['A', 'B'], current: 1, currentDone: true }))
    igual((html.match(/fa-check/g) ?? []).length, 2, 'el stepper tilda también la etapa actual cuando está completa')
  }

  console.log('\nCaso 8 · Sin cuenta de Monday el envío se simula entero:')
  const conContactos = aplicar(emitido, [
    { type: 'setDocumentoEnviado', value: false },
    { type: 'setContactos', contactos: [ana, beto] },
  ])
  const simulado = await enviarComprobante(comprobanteEnviable('recibo'), conContactos, 'Ambos')
  igual(simulado, { estado: 'ok', enviados: { '91': ['email', 'whatsapp'], '92': ['email'] } }, 'sale todo lo pedido')

  console.log('\nCaso 9 · La actividad del envío del resumen, como la armaba el escenario:')
  {
    const envio = envioDelResumen([ana, beto], 'Ambos', { '91': ['email', 'whatsapp'] })
    igual(envio.contactos.map((c) => c.itemId), ['91'], 'sólo cuentan los contactos a los que les llegó')
    igual(envioDelResumen([ana, beto], 'Email', { '91': ['email'], '92': ['whatsapp'] }).medio, 'Ambos', 'el medio sale de los canales que salieron')
    igual(envioDelResumen([ana, beto], 'Email', {}).contactos.length, 2, 'sin detalle por contacto, cuentan todos los elegidos')
    igual(
      tituloActividadResumen({ periodo: { desde: '2026-09-01', hasta: '2026-09-16' }, contactos: ['Luciano Gómez - 1111', 'Ana "Pérez"', 'luciano gómez'] }),
      "Envio de Resumen de cuenta corriente desde 01/09/2026 hasta 16/09/2026 para Luciano Gómez, Ana 'Pérez'",
      'título: período en dd/MM/yyyy y contactos sin código ni repetidos',
    )
    igual(tituloActividadResumen({ periodo: null, contactos: [] }), 'Envio de Resumen de cuenta corriente para Contacto no especificado', 'título sin datos')
    igual(tituloActividadResumen({ periodo: null, contactos: ['x'.repeat(300)] }).length, 255, 'el título se corta en 255')
    igual(
      contenidoActividadResumen({
        remitente: 'info@labatea',
        archivos: [
          { nombre: 'Resumen.pdf', url: 'https://labatea.monday.com/protected_static/1/a.pdf' },
          { nombre: 'Estado<1>.pdf', url: 'https://labatea.monday.com/protected_static/1/b.pdf' },
        ],
      }),
      '✉️ Enviado desde: <b>info@labatea</b><br>📄 Archivos adjuntos:<br>&nbsp;&nbsp;🔗 <a href="https://labatea.monday.com/protected_static/1/a.pdf" target="_blank" rel="noopener">Resumen.pdf</a><br>&nbsp;&nbsp;🔗 <a href="https://labatea.monday.com/protected_static/1/b.pdf" target="_blank" rel="noopener">Estado&lt;1&gt;.pdf</a>',
      'contenido: remitente y un link por archivo',
    )
    igual(
      contenidoActividadResumen({ remitente: '', archivos: [{ nombre: 'a', url: '' }] }),
      '⚠️ No se encontraron documentos adjuntos',
      'contenido sin links',
    )
  }

  console.log(`\nTodo OK (${asserts} chequeos). Los documentos quedaron en ${CARPETA}/`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
