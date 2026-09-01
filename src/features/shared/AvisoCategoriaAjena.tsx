import { AvisoModal } from '@/components/ui/AvisoModal'
import {
  cumpleRol,
  ROTULO_ROL,
  rolOpuesto,
  type RolPersona,
} from '@/lib/personas'
import type { Cliente } from '@/types'

interface AvisoCategoriaAjenaProps {
  /** El rol que la operación exige. De acá salen todos los textos. */
  rol: RolPersona
  /** Cómo se nombra la operación en el mensaje ("COBROS", "PASE DE SALDO", "PAGOS"). */
  operacion: string
  /** A quién trajo la búsqueda. Lo único que se muestra de él es su nombre y su categoría. */
  persona: Pick<Cliente, 'name' | 'categorias'>
  onClose: () => void
}

/**
 * La búsqueda trajo a alguien que no sirve para esta operación.
 *
 * Es UN solo componente para los tres módulos —Cobros y Pases exigen un cliente, Pagos un
 * proveedor— porque el rechazo es exactamente simétrico: cambia de qué lado del mostrador está la
 * persona, no qué hay que decirle. Escrito dos veces, las dos redacciones se habrían separado a la
 * primera corrección.
 *
 * El título NOMBRA lo que se encontró, y sólo cuando el tablero lo respalda: si la persona tiene la
 * categoría contraria se la llama por su nombre ("Se encontró un proveedor"), y si no tiene
 * ninguna de las dos —Transporte, Comisionistas, o sin clasificar— se dice que no es lo que se
 * busca, sin inventarle un rol. Sus categorías reales van listadas debajo, que es el dato con el
 * que se corrige el tablero.
 *
 * De la persona rechazada NO se muestra nada más: ése es el punto de validar al seleccionar y no al
 * avanzar. Su ficha no llega a dibujarse.
 */
export function AvisoCategoriaAjena({
  rol,
  operacion,
  persona,
  onClose,
}: AvisoCategoriaAjenaProps) {
  const opuesto = rolOpuesto(rol)
  /* ¿El tablero dice que es lo contrario? Recién ahí se lo puede nombrar así. */
  const esElOpuesto = cumpleRol(persona, opuesto)
  const buscado = ROTULO_ROL[rol]
  const encontrado = ROTULO_ROL[opuesto]

  return (
    <AvisoModal
      titulo={
        esElOpuesto
          ? `Se encontró un ${encontrado.singular}`
          : `La persona no es un ${buscado.singular}`
      }
      /* Las categorías que la persona SÍ tiene: es lo que hay que mirar —o corregir— en Monday
         para entender por qué no se la pudo cargar. Sin ninguna, se dice eso mismo. */
      faltantes={[
        `${persona.name} · categoría: ${
          persona.categorias.length > 0 ? persona.categorias.join(', ') : 'sin asignar'
        }`,
      ]}
      onClose={onClose}
    >
      {esElOpuesto
        ? `Se encontró un ${encontrado.singular} y la operación de ${operacion} es solo para ${buscado.plural}.`
        : `La operación de ${operacion} es solo para ${buscado.plural}, y esta persona no está categorizada como tal.`}{' '}
      Buscá y seleccioná un {buscado.singular} para continuar.
    </AvisoModal>
  )
}
