/**
 * Métrica destacada del cobro: icono en pastilla, rótulo y cifra. Es el bloque con el que la
 * cabecera muestra TOTAL A CANCELAR, TOTAL RECIBIDO y DIFERENCIA.
 */
export function MetricaCobro({
  icono,
  tono,
  rotulo,
  valor,
  nota,
}: {
  icono: string
  tono: 'azul' | 'verde' | 'rojo'
  rotulo: string
  valor: string
  /** Aclaración al pie de la cifra, cuando el número solo no explica la cuenta. */
  nota?: string
}) {
  return (
    <div className="cobro-cab-met">
      <span className={`cobro-cab-ic cobro-cab-ic--${tono}`}>
        <i className={`fas ${icono}`} />
      </span>
      <div className="cobro-cab-campo">
        <span className="cobro-cab-lbl cobro-cab-lbl--met">{rotulo}</span>
        <span className={`cobro-cab-num cobro-cab-num--${tono}`}>{valor}</span>
        {nota && <span className="cobro-cab-nota">{nota}</span>}
      </div>
    </div>
  )
}
