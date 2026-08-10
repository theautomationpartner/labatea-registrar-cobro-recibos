import { AvisoModal } from './AvisoModal'
import { useApp, useDispatch } from '@/state/hooks'

/**
 * ÚNICA forma en que la app comunica un fallo de la API de Monday. Se monta una sola vez, arriba
 * de todo, y aparece cuando cualquier consulta o mutación cae en su `catch` y despacha
 * `errorMonday` con lo que se estaba intentando hacer.
 *
 * Un fallo de la API no es un estado de la pantalla: interrumpe la operación y hay que decirlo de
 * frente, igual en todos los pasos, en vez de dejar un cartel distinto embebido en cada vista.
 */
export function ModalErrorMonday() {
  const { errorMonday } = useApp()
  const dispatch = useDispatch()
  if (!errorMonday) return null

  return (
    <AvisoModal
      titulo="No se pudo conectar con Monday"
      onClose={() => dispatch({ type: 'limpiarErrorMonday' })}
    >
      <p>
        No se pudo <strong>{errorMonday}</strong>. La conexión con Monday fue rechazada o no
        respondió a tiempo, así que la operación no llegó a completarse.
      </p>
      <p>
        Esperá unos segundos y volvé a intentarlo. Si el error se repite, comunicate con el soporte
        de TAP.
      </p>
    </AvisoModal>
  )
}
