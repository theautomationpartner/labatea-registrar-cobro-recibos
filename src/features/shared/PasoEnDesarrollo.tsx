import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { DESCRIPCION, ETAPA, numeroDePaso } from '@/lib/pasos'
import { useApp } from '@/state/hooks'

/**
 * Cuerpo provisorio de una etapa todavía sin implementar. Existe para que el paso se pueda ver y
 * recorrer con su encabezado real mientras se construye, y para que sea EVIDENTE que lo que falta
 * es el contenido —no el paso—. Se borra en cuanto la etapa tiene su vista.
 */
export function EnDesarrollo({ detalle }: { detalle?: string }) {
  return (
    <div className="card card--config en-desarrollo">
      <i className="fas fa-screwdriver-wrench" />
      <div>
        <strong>Etapa en construcción</strong>
        <p className="muted">{detalle ?? 'La funcionalidad de este paso se implementa a continuación.'}</p>
      </div>
    </div>
  )
}

/**
 * Vista genérica de una etapa sin implementar: misma barra de contexto y mismo encabezado que
 * tendrá cuando esté terminada, con el título y la bajada que declara `lib/pasos`. Así el recorrido
 * completo se puede navegar desde el primer día.
 */
export function PasoEnDesarrollo() {
  const { paso } = useApp()
  return (
    <section className="view paso-layout">
      <PasoHeader />
      <div className="paso-body">
        <PasoTitulo
          numero={numeroDePaso(paso)}
          titulo={ETAPA[paso]}
          descripcion={DESCRIPCION[paso]}
        />
        <EnDesarrollo />
      </div>
    </section>
  )
}
