import { useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { etiquetaCheque, TablaChequesCartera } from '@/features/pagos/TablaChequesCartera'
import { money } from '@/lib/format'
import {
  descripcionDePaso,
  etiquetaDePaso,
  numeroDePaso,
  pasoAnterior,
  siguientePaso,
} from '@/lib/pasos'
import { useApp, useDispatch } from '@/state/hooks'
import { useChequesDelDeudor } from './useChequesDelDeudor'

/**
 * RECHAZO DE CHEQUE · paso 2: cuál de los cheques USADOS del deudor rebotó.
 *
 * La tabla es la MISMA que la de "Cheques en Cartera" del formulario de pago —el componente
 * literal, no una copia (`TablaChequesCartera`)—: mismas columnas, mismas clases y mismo resaltado
 * de la fila elegida. Es el mismo gesto —marcar un papel de una lista de cheques—, así que quien
 * conoce una pantalla no tiene que aprender la otra. Y por eso la vista se monta con las mismas
 * clases que el paso de anticipos del PASE DE SALDO (`anticipos-v2`, `pases-v2`): de ahí salen los
 * estilos de `.ant-tabla`, así que las dos tablas se ven exactamente igual.
 *
 * Lo que cambia es de DÓNDE sale la lista: son los cheques "100% Usado" del tablero de USADOS
 * (18426604104), no los disponibles en cartera. Un cheque que el banco devuelve es uno que ya se
 * usó, así que el papel que rebota nunca está entre los que quedan para pagar.
 *
 * Y se elige UN cheque: el banco devolvió un papel, no varios. La exclusión la resuelve el estado
 * (`toggleChequeRechazado`), no un control distinto, para que la tabla siga siendo la misma.
 *
 * La lista es la del cliente elegido en el paso 1 y no la general: el rechazo es de un cheque que
 * ESE deudor entregó, y ofrecerle los de todos lo obligaría a encontrar el suyo entre los ajenos
 * (ver `getChequesDeCliente`).
 */
export function ChequeRechazadoView() {
  const { cliente, chequesRechazo, chequeRechazadoId, tipoOperacion } = useApp()
  const dispatch = useDispatch()
  const { cargando } = useChequesDelDeudor()
  // Motivo por el que no se puede avanzar, mostrado al intentarlo.
  const [avisoSinCheque, setAvisoSinCheque] = useState(false)

  const destino = siguientePaso('chequeRechazado', tipoOperacion)
  const anterior = pasoAnterior('chequeRechazado', tipoOperacion)
  const SIGUIENTE_PASO = destino ? etiquetaDePaso(destino, tipoOperacion) : ''
  /* El cheque marcado, resuelto contra la lista que está en pantalla: el estado guarda su id, y es
     la fila la que tiene los datos con los que se lo nombra en el resumen. */
  const elegido = chequesRechazo.find((c) => c.id === chequeRechazadoId) ?? null

  return (
    <section className="view cobro-v2 anticipos-v2 pases-v2 paso-layout">
      <PasoHeader />

      <div className="paso-body">
        <PasoTitulo
          numero={numeroDePaso('chequeRechazado', tipoOperacion)}
          titulo={etiquetaDePaso('chequeRechazado', tipoOperacion)}
          descripcion={descripcionDePaso('chequeRechazado', tipoOperacion)}
        />

        {!cliente ? (
          <div className="cobro-static">
            <div className="cobro-card">
              <p className="cobro-vacio">
                <i className="fas fa-user-slash" /> Todavía no hay un cliente deudor seleccionado.
                Volvé al paso 1 para elegirlo.
              </p>
            </div>
          </div>
        ) : (
          <div className="cobro-static">
            <div className="cobro-card">
              <h3 className="cobro-card-title">Cheques/Echeqs usados de {cliente.name}</h3>
              <p className="cobro-card-desc">
                Selecciona el cheque que el banco rechazó. Solo se puede seleccionar uno por
                operacion.
              </p>

              {cargando ? (
                <p className="cobro-vacio">
                  <i className="fas fa-spinner fa-spin" /> Buscando los cheques usados del
                  cliente...
                </p>
              ) : chequesRechazo.length === 0 ? (
                <p className="cobro-vacio">
                  <i className="fas fa-circle-info" /> <strong>{cliente.name}</strong> no tiene
                  cheques usados, así que no hay ninguno que se pueda rechazar.
                </p>
              ) : (
                <TablaChequesCartera
                  cheques={chequesRechazo}
                  /* El estado guarda UN id; la tabla espera la lista de marcados. Se adapta acá y
                     no cambiando el componente: la tabla es la misma que la de Pagos. */
                  elegidos={chequeRechazadoId ? [chequeRechazadoId] : []}
                  onAlternar={(cheque) => dispatch({ type: 'toggleChequeRechazado', cheque })}
                  /* Con qué recibo entró el cheque y con qué orden de pago salió: son los dos
                     códigos con los que se encuentra la operación en Monday, y acá tienen sentido
                     porque estos cheques YA se usaron. */
                  conOrigen
                />
              )}

              {/* Pie de la card: UN solo renglón para las dos cosas que el paso tiene para decir,
                  porque son excluyentes —o falta elegir el cheque, o ya está elegido y se resume—.
                  Mismo criterio que el paso de anticipos del pase: el renglón tiene su alto
                  reservado, así que pasar de un mensaje al otro no mueve la pantalla. */}
              <div className="cobro-card-acts">
                {elegido ? (
                  <span className="pase-resumen-linea">
                    <i className="fas fa-file-circle-xmark" /> Se rechazará el cheque{' '}
                    <strong>{etiquetaCheque(elegido)}</strong> por{' '}
                    <strong>{money(elegido.importe)}</strong> pesos
                  </span>
                ) : (
                  <span className="cobro-bloqueo-inline">
                    <i className="fas fa-circle-exclamation" /> Elegí el cheque que el banco rechazó
                    para continuar
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="actions-footer">
          <button
            type="button"
            className="btn btn-out"
            onClick={() => anterior && dispatch({ type: 'goto', paso: anterior })}
          >
            <i className="fas fa-arrow-left" /> Volver
          </button>

          <div className="actions-footer-fin">
            {/* El botón NO se apaga: si falta el cheque, la ventana lo dice, en vez de dejar un
                control muerto que no explica nada. */}
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                if (!elegido) {
                  setAvisoSinCheque(true)
                  return
                }
                if (destino) dispatch({ type: 'goto', paso: destino })
              }}
            >
              Continuar a {SIGUIENTE_PASO} <i className="fas fa-arrow-right" />
            </button>
          </div>
        </div>
      </div>

      {avisoSinCheque && (
        <AvisoModal titulo="No elegiste ningún cheque" onClose={() => setAvisoSinCheque(false)}>
          Para continuar tenés que marcar en la tabla el cheque que el banco rechazó. Se registra
          uno por operación.
        </AvisoModal>
      )}
    </section>
  )
}
