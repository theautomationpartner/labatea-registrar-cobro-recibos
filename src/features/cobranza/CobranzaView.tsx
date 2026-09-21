import { useState } from 'react'
import { PasoHeader } from '@/features/shared/PasoHeader'
import {
  CUENTAS_POR_PAGINA,
  DESCENDENTE_POR_DEFECTO,
  filasDeCobranza,
  filtrarCuentas,
  ORDEN_INICIAL,
  ordenarFilas,
  resumenCobranza,
  type FilaCobranza,
  type OrdenCobranza,
} from '@/lib/cobranza'
import { BateriaVencimientos } from './BateriaVencimientos'
import { CriteriosCobranza } from './CriteriosCobranza'
import { KpisCobranza } from './KpisCobranza'
import { RankingDeudores } from './RankingDeudores'
import { TablaCuentas } from './TablaCuentas'
import { useCobranza } from './useCobranza'
import { useFilaDesplegada } from './useFilaDesplegada'

/**
 * GESTIÓN DE COBRANZA: el tablero con el que se decide a quién reclamarle.
 *
 * Es el único módulo SIN etapas —y por eso se rutea aparte, como PAGOS (ver `App`)—: no hay un
 * recorrido que completar ni un documento que emitir, hay una pregunta que se configura arriba y una
 * respuesta que se lee abajo. El encabezado se monta igual que en el resto de la app pero con la
 * barra de etapas en FANTASMA: anunciar un recorrido que no existe sería mentir, y quitarla del todo
 * movería de lugar el logo y los selectores respecto de las demás pantallas.
 *
 * El orden de la pantalla es el orden de las preguntas:
 *
 *   1. LA BÚSQUEDA · de qué cuentas se parte y qué facturas se listan (dos selects y "Buscar").
 *   2. LOS NÚMEROS · cuánto hay para cobrar y cómo se reparte (widget "Numbers").
 *   3. LOS GRÁFICOS · desde cuándo se debe y quién debe más (widgets "Battery" y "Chart").
 *   4. LAS CUENTAS · el listado alcanzado, con las facturas de cada una a un click.
 *
 * De lo general a lo particular: primero cuánto es el problema, después de qué está hecho y recién
 * al final cuenta por cuenta, que es donde se va a trabajar.
 *
 * TODO eso está montado desde el primer render: la tabla con su encabezado y el renglón que dice que
 * no hay cuentas, y los widgets con sus datos en gris (ver `Esqueleto`). La pantalla no crece ni se
 * reordena cuando llega la respuesta.
 *
 * Entrar al módulo NO consulta nada: el tablero abre en blanco y la única cosa que sale a la red es
 * el botón "Buscar". Todos los números salen de UNA sola lectura del resultado (`filasDeCobranza` +
 * `resumenCobranza`): ningún widget vuelve a sumar nada por su cuenta, así que no pueden
 * contradecirse entre sí.
 */
export function CobranzaView() {
  const { cargando, fallo, resultado, buscar: consultar } = useCobranza()

  /* Orden, página y fila desplegada son de la PANTALLA y no de la operación: no cambian lo que se
     consultó, sólo cómo se lo está mirando. Por eso viven acá y no en el estado global. */
  const [orden, setOrden] = useState<OrdenCobranza>(ORDEN_INICIAL)
  const [descendente, setDescendente] = useState(DESCENDENTE_POR_DEFECTO[ORDEN_INICIAL])
  const [pagina, setPagina] = useState(1)
  /* Lo tecleado en el buscador del listado. Filtra en memoria lo que ya se trajo: no sale a la red
     ni cambia el criterio de la búsqueda, que es otra cosa y vive arriba. */
  const [termino, setTermino] = useState('')
  const plegado = useFilaDesplegada()

  const listo = resultado !== null
  const filas = resultado ? filasDeCobranza(resultado) : []
  const ordenadas = ordenarFilas(filas, orden, descendente)
  const filtradas = filtrarCuentas(ordenadas, termino)
  const resumen = resumenCobranza(filas)
  const filtrando = termino.trim() !== ''

  /* Clickear la columna ya activa invierte el orden; otra columna arranca con el sentido que le
     corresponde —los importes de mayor a menor, el nombre de la A a la Z—. */
  const ordenar = (columna: OrdenCobranza) => {
    if (columna === orden) {
      setDescendente((d) => !d)
      return
    }
    setOrden(columna)
    setDescendente(DESCENDENTE_POR_DEFECTO[columna])
  }

  const buscar = () => {
    /* La lista se reemplaza entera: la fila desplegada se cierra SIN animar —lo que se estaba
       mirando ya no va a estar—, el buscador del listado se vacía y se vuelve a la primera
       página. Dejar el término puesto escondería el resultado nuevo detrás de un filtro viejo. */
    plegado.cerrarYa()
    setTermino('')
    setPagina(1)
    consultar()
  }

  /* Desde el ranking: la tabla salta a la página donde está esa cuenta y la despliega. Sin esto, el
     gráfico señalaría un deudor que hay que ir a buscar a mano tres páginas más abajo. */
  const irACuenta = (fila: FilaCobranza) => {
    /* Con un filtro puesto la cuenta señalada puede no estar en la lista, así que el buscador se
       limpia: lo que el gráfico marca tiene que poder verse. */
    const enLista = filtrarCuentas(ordenadas, termino).some((f) => f.cuenta.id === fila.cuenta.id)
    if (!enLista) setTermino('')
    const i = ordenadas.findIndex((f) => f.cuenta.id === fila.cuenta.id)
    if (i < 0) return
    setPagina(Math.floor(i / CUENTAS_POR_PAGINA) + 1)
    plegado.abrir(fila.cuenta.id)
  }

  return (
    <section className="view cobro-v2 pases-v2 cobranza-v2 paso-layout">
      {/* Sin etapas: el tablero no es un paso de ningún recorrido. */}
      <PasoHeader pasos={false} />

      <div className="paso-body">
        {/* El encabezado del módulo va SIN la pastilla que en los demás pasos lleva el número: acá no
            hay paso que numerar, así que el título arranca contra el margen, en el lugar donde en el
            resto de la app empieza esa pastilla. */}
        <header className="header-section">
          <div className="step-indicator-main">
            <div className="step-details-main">
              <h1 className="step-title-main">Gestión de Cobranza</h1>
              <p className="step-desc-main">
                Consultá las cuentas corrientes de tus clientes por el estado de su saldo y las
                facturas pends de cancelar por vencimiento
              </p>
            </div>
          </div>
        </header>

        <div className="cobro-static">
          <div className="cobro-card cbz-card">
            <CriteriosCobranza cargando={cargando} onBuscar={buscar} />
          </div>
        </div>

        <KpisCobranza resumen={resumen} listo={listo} cargando={cargando} />

        <div className="cbz-widgets">
          <BateriaVencimientos
            porTramo={resumen.porTramo}
            pendiente={resumen.pendiente}
            listo={listo}
            cargando={cargando}
          />
          <RankingDeudores
            filas={filas}
            pendienteTotal={resumen.pendiente}
            onElegir={irACuenta}
            listo={listo}
            cargando={cargando}
          />
        </div>

        <div className="cobro-static">
          <div className="cobro-card cbz-card">
            <div className="cbz-tabla-head">
              <h3 className="cobro-card-title">Cuentas corrientes alcanzadas</h3>
              <span className="cbz-tabla-sub">
                {!listo
                  ? 'Elegí los criterios y usá Buscar'
                  : resumen.cuentas === 0
                    ? `Ninguna de las ${resultado.totalLeidas} cuentas del tablero cumple el criterio`
                    : filtrando
                      ? `${filtradas.length} de ${resumen.cuentas} cuentas coinciden con "${termino.trim()}"`
                      : `${resumen.cuentas} de ${resultado.totalLeidas} cuentas del tablero · ${resumen.facturas} ${resumen.facturas === 1 ? 'factura pendiente' : 'facturas pendientes'}`}
              </span>
            </div>

            {/* Buscador del listado: filtra lo que YA se trajo, mientras se teclea. No vuelve a
                consultar —el criterio de la búsqueda está arriba—: acá se trata de encontrar una
                cuenta entre las que el criterio alcanzó, que con doscientas es lo que uno viene a
                hacer. */}
            <div className="cbz-buscador">
              <i className="fas fa-magnifying-glass cbz-buscador-ic" aria-hidden="true" />
              <input
                type="search"
                className="cbz-buscador-in"
                placeholder="Buscar por cliente, cuenta corriente o código..."
                aria-label="Buscar una cuenta entre las alcanzadas"
                disabled={!listo || resumen.cuentas === 0}
                value={termino}
                onChange={(e) => {
                  setTermino(e.target.value)
                  /* Lo que se está mirando puede no estar en la lista filtrada, y la página 3 de
                     veintitrés cuentas no existe cuando quedan dos. */
                  plegado.cerrarYa()
                  setPagina(1)
                }}
              />
              {filtrando && (
                <button
                  type="button"
                  className="cbz-buscador-x"
                  aria-label="Limpiar la búsqueda"
                  onClick={() => {
                    setTermino('')
                    setPagina(1)
                  }}
                >
                  <i className="fas fa-xmark" />
                </button>
              )}
            </div>

            {fallo && (
              <p className="cobro-vacio">
                <i className="fas fa-triangle-exclamation" /> No se pudieron leer las cuentas
                corrientes del tablero.{' '}
                <button type="button" className="cobro-reintentar" onClick={buscar}>
                  Reintentar
                </button>
              </p>
            )}

            {listo && resultado.sinCliente > 0 && (
              <p className="cbz-aviso">
                <i className="fas fa-triangle-exclamation" />
                {resultado.sinCliente === 1
                  ? ' 1 cuenta corriente alcanzada por el filtro no tiene cliente conectado en el tablero, así que quedó afuera del listado: sin cliente no hay facturas que buscarle.'
                  : ` ${resultado.sinCliente} cuentas corrientes alcanzadas por el filtro no tienen cliente conectado en el tablero, así que quedaron afuera del listado: sin cliente no hay facturas que buscarles.`}
              </p>
            )}

            <TablaCuentas
              filas={filtradas}
              orden={orden}
              descendente={descendente}
              onOrdenar={ordenar}
              plegado={plegado}
              pagina={pagina}
              onPagina={setPagina}
              cargando={cargando}
            />
          </div>
        </div>

      </div>
    </section>
  )
}
