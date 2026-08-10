import { useState } from 'react'
import { formatearImporteAR, importeATexto } from '@/lib/format'

/**
 * Importe editable de un pago ya cargado. Permite bajar (o subir) el monto para ajustar la
 * DIFERENCIA a 0 sin tener que quitar el movimiento. Se ingresa como número con separador de miles
 * (formato AR: "30409" → "30.409"; la coma agrega centavos). Avisa al padre con el número en cada
 * cambio; si el importe cambia desde afuera (p. ej. se quitó otro pago), el campo lo sigue.
 */
export function ImporteEditable({
  valor,
  onCambio,
}: {
  valor: number
  onCambio: (n: number) => void
}) {
  const [texto, setTexto] = useState<string>(() => importeATexto(valor))
  const [ultimo, setUltimo] = useState(valor)
  if (ultimo !== valor) {
    setUltimo(valor)
    setTexto(importeATexto(valor))
  }
  const cambiar = (entrada: string) => {
    const { texto: t, valor: v } = formatearImporteAR(entrada)
    setTexto(t)
    setUltimo(v)
    onCambio(v)
  }
  return (
    <span className="cobro-imp-edit">
      <span className="cobro-imp-pre">$</span>
      <input
        type="text"
        inputMode="decimal"
        aria-label="Importe del pago (editable para ajustar la diferencia)"
        value={texto}
        onChange={(e) => cambiar(e.target.value)}
      />
    </span>
  )
}
