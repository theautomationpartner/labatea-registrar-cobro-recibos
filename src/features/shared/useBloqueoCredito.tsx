import { useState, type ReactNode } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import {
  clienteBloqueado,
  limiteCreditoAlcanzado,
  mensajeLimiteCredito,
  MENSAJE_CLIENTE_BLOQUEADO,
} from '@/lib/credito'
import { useApp } from '@/state/hooks'

interface BloqueoCredito {
  /**
   * Chequeo previo a emitir o enviar. Devuelve `true` si frenó la acción (y ya dejó la ventana
   * emergente en pantalla); `false` si se puede seguir. Se usa como guarda: `if (frenar()) return`.
   */
  frenar: () => boolean
  /** La ventana de aviso. Hay que montarla en la vista para que se vea. */
  modal: ReactNode
}

interface OpcionesBloqueo {
  /**
   * Estrategia frente al límite alcanzado. `true`: frena la acción. `false`: la deja pasar (un
   * comprobante que no compromete crédito). Un cliente BLOQUEADO frena siempre, sea cual sea el
   * comprobante: no puede usarse en el sistema.
   */
  bloqueante?: boolean
}

/**
 * Bloqueo de una acción por crédito. Dos motivos lo disparan: un cliente bloqueado en el board, o
 * una línea de crédito ya agotada. Las reglas viven centralizadas en `@/lib/credito` —las mismas
 * que frenan el paso 2—; acá sólo se orquestan el aviso y el freno.
 */
export function useBloqueoCredito({ bloqueante = true }: OpcionesBloqueo = {}): BloqueoCredito {
  const { cliente } = useApp()
  const [aviso, setAviso] = useState<{ titulo: string; texto: string } | null>(null)

  const frenar = (): boolean => {
    if (!cliente) return false
    if (clienteBloqueado(cliente)) {
      setAviso({ titulo: 'Cliente bloqueado', texto: MENSAJE_CLIENTE_BLOQUEADO })
      return true
    }
    if (limiteCreditoAlcanzado(cliente)) {
      // Se avisa sólo si además frena: un aviso que no impide nada es ruido.
      if (bloqueante) {
        setAviso({
          titulo: 'Límite de crédito alcanzado',
          texto: mensajeLimiteCredito(cliente),
        })
      }
      return bloqueante
    }
    return false
  }

  const modal = aviso ? (
    <AvisoModal titulo={aviso.titulo} onClose={() => setAviso(null)}>
      {aviso.texto}
    </AvisoModal>
  ) : null

  return { frenar, modal }
}
