export interface MetricaDocumento {
  rotulo: string
  valor: string
  /** Color de la cifra. Sin tono, el texto normal del documento. */
  tono?: 'verde' | 'naranja' | 'rojo'
}

/**
 * La franja de cifras al pie de un documento de Cta Cte: rótulo chico en mayúsculas arriba, cifra
 * grande abajo, y un separador vertical entre cada una. Es la misma franja en el resumen (crédito y
 * mercadería pendiente) y en el estado de cuenta (al día, vencido y deuda pendiente).
 */
export function MetricasDocumento({ metricas }: { metricas: readonly MetricaDocumento[] }) {
  return (
    <div className="doc-metricas">
      {metricas.map((m) => (
        <div key={m.rotulo} className="doc-metrica">
          <span className="doc-metrica-lbl">{m.rotulo}</span>
          <span className={`doc-metrica-val ${m.tono ? `doc-metrica-val--${m.tono}` : ''}`}>
            {m.valor}
          </span>
        </div>
      ))}
    </div>
  )
}
