import { useState } from 'react'
import { formatearImporteAR, importeATexto } from '@/lib/format'

/**
 * Importe de un pago ya cargado. Normalmente se EDITA —bajar o subir el monto ajusta la DIFERENCIA a
 * 0 sin tener que quitar el movimiento—: se ingresa como número con separador de miles (formato AR:
 * "30409" → "30.409"; la coma agrega centavos), avisa al padre con el número en cada cambio y, si el
 * importe cambia desde afuera (p. ej. se quitó otro pago), el campo lo sigue.
 *
 * Con `bloqueado` el campo sigue siendo un campo pero no se toca. Son las cajas cuyo importe no es
 * una decisión del usuario —el cheque, que vale lo que dice el papel, y la retención, que sale de
 * una fórmula fiscal—: mostrarlas como texto suelto rompía la lectura de la columna, que en el resto
 * de las filas es una caja con su "$". El valor se ve y se puede copiar, que es lo que hace falta
 * para controlarlo; lo que no se puede es cambiarlo.
 */
export function ImporteEditable({
  valor,
  onCambio,
  bloqueado = false,
  motivo,
}: {
  valor: number
  onCambio: (n: number) => void
  /** El importe lo fija el sistema: se muestra, no se edita. */
  bloqueado?: boolean
  /** Por qué no se edita. Va en el `title` del campo, donde se lo busca. */
  motivo?: string
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
    <span
      className={`cobro-imp-edit ${bloqueado ? 'cobro-imp-edit--fijo' : ''}`}
      title={bloqueado ? motivo : undefined}
    >
      <span className="cobro-imp-pre">$</span>
      <input
        type="text"
        inputMode="decimal"
        aria-label={
          bloqueado
            ? 'Importe del pago (lo fija el sistema y no se edita)'
            : 'Importe del pago (editable para ajustar la diferencia)'
        }
        /* `readOnly` y no `disabled`, con el mismo criterio que el campo de importe del formulario:
           el valor tiene que seguir siendo legible, seleccionable y anunciable por un lector de
           pantalla. Deshabilitarlo lo sacaría del alcance del teclado justo cuando lo que hace
           falta es leerlo con atención. */
        readOnly={bloqueado}
        value={texto}
        onChange={(e) => {
          if (bloqueado) return
          cambiar(e.target.value)
        }}
      />
    </span>
  )
}
