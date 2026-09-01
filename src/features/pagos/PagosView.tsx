import { useApp } from '@/state/hooks'
import type { PasoPago } from '@/types'
import { AplicarAnticipoView } from './AplicarAnticipoView'
import { FacturasCompraView } from './FacturasCompraView'
import { OrdenPagoView } from './OrdenPagoView'
import { ProveedorView } from './ProveedorView'
import { RegistrarPagoView } from './RegistrarPagoView'

/**
 * Vista de cada etapa del módulo de PAGOS. El estado dice en qué paso está y acá se resuelve qué se
 * dibuja. Es la tabla equivalente a la de COBROS en `App`, y vive aparte por la misma razón por la
 * que el recorrido vive en `lib/pasosPago`: las dos operaciones son independientes y no comparten
 * ni una sola clave de navegación.
 */
const VISTAS: Record<PasoPago, () => JSX.Element | null> = {
  proveedor: ProveedorView,
  facturasCompra: FacturasCompraView,
  pago: RegistrarPagoView,
  orden: OrdenPagoView,
}

/**
 * Módulo de PAGOS. Es una operación INDEPENDIENTE de Cobros: no comparte etapas, ni estado de
 * trabajo —cambiar de módulo descarta lo que se venía cargando en el otro (ver `setOperacionApp`)—.
 *
 * Su recorrido son cuatro etapas: a quién se le paga, qué facturas de compra se cancelan, con qué
 * cajas se paga, y la emisión y el envío de la orden de pago.
 *
 * Lo que SÍ comparte con Cobros son las PIEZAS: el buscador de personas, la ficha, la tabla de
 * comprobantes pendientes con su panel desplegable, la cabecera de totales, la tabla de movimientos,
 * el resumen del documento, la card del comprobante y el bloque de envío son los MISMOS
 * componentes, parametrizados con los rótulos del egreso.
 *
 * Esta vista es sólo el ruteo. El encabezado —con su barra de etapas propia— lo pone cada etapa a
 * través de `PasoHeader`, que resuelve el stepper por módulo.
 */
export function PagosView() {
  const { pasoPago, tipoOperacionPago } = useApp()
  /* La etapa 3 tiene DOS vistas según lo que se registre: con dinero (cajas) o aplicando el saldo a
     favor que ya teníamos con el proveedor. Es la única etapa que cambia de pantalla según la
     operación; el resto del recorrido comparte las mismas. Es el mismo ruteo que hace `App` para el
     paso 3 de Cobros. */
  const Vista =
    pasoPago === 'pago' && tipoOperacionPago === 'aplicacion' ? AplicarAnticipoView : VISTAS[pasoPago]
  return <Vista />
}
