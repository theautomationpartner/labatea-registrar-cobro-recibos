import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { EnDesarrollo } from '@/features/shared/PasoEnDesarrollo'
import { DESCRIPCION, ETAPA, numeroDePaso } from '@/lib/pasos'

/**
 * Paso 1: selección del cliente al que se le registra el cobro. Es la puerta de entrada de la app
 * —no hay paso previo de configuración—, así que es la primera pantalla que se ve.
 *
 * Por ahora sólo monta el encabezado del flujo (barra de contexto + título del paso); la búsqueda
 * y la ficha del cliente llegan en el próximo paso de la implementación.
 */
export function ClienteView() {
  return (
    <section className="view paso-layout">
      <PasoHeader />
      <div className="paso-body">
        <PasoTitulo
          numero={numeroDePaso('cliente')}
          titulo={ETAPA.cliente}
          descripcion={DESCRIPCION.cliente}
        />
        <EnDesarrollo detalle="Acá van la búsqueda del cliente y su ficha (deuda, condición de pago y datos de contacto)." />
      </div>
    </section>
  )
}
