import { useEffect, useRef, useState } from 'react'
import {
  ACEPTA_ARCHIVO,
  archivoNoSoportado,
  ErrorFatalMake,
  procesarComprobante,
  type DatosComprobante,
} from '@/services/make'
import type { FormaPago } from '@/types'

/**
 * En qué anda la lectura del documento. Es lo único que decide qué muestra el recuadro: la consigna
 * de arrastre, la animación de la espera o el resultado, siempre en el MISMO lugar —el recuadro
 * tiene medidas fijas, así que ningún cambio de estado mueve los campos que están abajo—.
 *
 * `sin-datos` es la advertencia: el escenario contestó, pero de ahí no salió ningún campo. No es un
 * éxito —no hay nada cargado— ni una falla de la llamada, y se muestra distinto de los dos: en
 * verde diría que el trabajo está hecho cuando el formulario sigue vacío.
 */
type Estado = 'vacio' | 'procesando' | 'listo' | 'sin-datos' | 'error'

interface LectorComprobanteProps {
  /** id del `input[type=file]` oculto, para enganchar el `<label htmlFor>` del campo. */
  id: string
  /** Medio que se está cargando. Viaja al escenario: es el contexto con el que lee el documento. */
  formaPago: FormaPago
  /** Documento cargado, que vive en el borrador del movimiento. `null` = todavía no hay nada. */
  archivo: File | null
  /**
   * Entrega el documento para que quede en el borrador. Sólo entrega ARCHIVOS: el recuadro no
   * quita el comprobante —se reemplaza subiendo otro encima—, así que nunca manda `null`.
   */
  onArchivo: (archivo: File) => void
  /**
   * Vuelca sobre el formulario los datos que devolvió el escenario, ya normalizados, y responde
   * CUÁNTOS entraron. El número lo pone quien los recibe y no quien los lee, porque cuáles
   * corresponden depende del medio de cobro: un dato que este medio no muestra no se cargó en
   * ningún lado, y contarlo sería anunciar un campo completo que el usuario no va a encontrar.
   */
  onDatos: (datos: DatosComprobante) => number
  /**
   * Campos obligatorios del medio que la lectura NO pudo completar, por su nombre visible. Vacío
   * mientras no haya corrido una lectura, o cuando el documento los trajo a todos.
   *
   * Los calcula el formulario, que es el único que sabe qué pide cada medio y qué quedó cargado.
   * Acá sirven para decir QUÉ falta: "procesado correctamente" con dos campos en rojo más abajo
   * manda a buscar el problema en vez de nombrarlo.
   */
  faltantes?: readonly string[]
  /**
   * Reclamo del formulario cuando el comprobante es OBLIGATORIO y todavía no se cargó ninguno.
   *
   * Se muestra adentro del recuadro y no debajo: el recuadro tiene alto fijo, así que el mensaje
   * aparece y desaparece sin mover ni un pixel de lo que hay alrededor. Afuera, cada vez que se
   * intentaba agregar el movimiento, el bloque entero cambiaba de alto.
   */
  error?: string
  /** El formulario está cerrado: no se carga ni se procesa nada. */
  deshabilitado?: boolean
}

/**
 * CARGA AUTOMÁTICA del comprobante: el usuario suelta el documento (PDF o imagen) y los campos del
 * medio de cobro se completan solos con lo que lee un escenario de Make.com.
 *
 * Son dos piezas, una al lado de la otra:
 *
 *   · el RECUADRO donde se suelta el archivo, con la consigna adentro; cargado, muestra el ícono
 *     del formato y confirma que el documento entró, y clickearlo lo reemplaza;
 *   · la ZONA DE ESTADO a su derecha, con el lugar YA reservado para el spinner del procesamiento y
 *     el resultado: el visto verde de "Procesado correctamente" o la advertencia de que la lectura
 *     no trajo ningún dato.
 *
 * Los campos del medio de cobro quedan DEBAJO: lo que llega de Make se vuelca ahí, a la vista y
 * editable. Nada se registra en Monday sin pasar por esos campos, así que un OCR que se equivoca se
 * corrige antes de agregar el movimiento.
 */
export function LectorComprobante({
  id,
  formaPago,
  archivo,
  faltantes = [],
  error,
  onArchivo,
  onDatos,
  deshabilitado = false,
}: LectorComprobanteProps) {
  const [estado, setEstado] = useState<Estado>('vacio')
  /** Detalle del estado: el motivo del error, o cuántos campos se completaron. */
  const [detalle, setDetalle] = useState('')
  const [campos, setCampos] = useState(0)
  /* El error es del ARCHIVO y no del momento: no se pudo convertir a PDF. Cambia lo que se ofrece
     —otro documento, no un reintento— y por eso se guarda aparte del texto del error. */
  const [fatal, setFatal] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  /* Llamada en curso. Se aborta al cargar otro documento: la respuesta de un archivo que ya no está
     no puede volcarse sobre los campos del que lo reemplazó. */
  const enVuelo = useRef<AbortController | null>(null)
  /** Último documento que se mandó a leer. Es lo que evita procesar dos veces el mismo archivo. */
  const procesado = useRef<File | null>(null)

  /**
   * El disparador de TODO el circuito: apenas hay un documento nuevo en el borrador, se manda a
   * leer. Cuelga del archivo y no del click para cubrir las dos puertas de entrada por igual —el
   * recuadro de acá arriba y el "Comprobante" de más abajo, que es el mismo campo del borrador—:
   * suba por donde suba, el documento se procesa una sola vez.
   *
   * Sin archivo el lector vuelve a cero: el estado es DEL DOCUMENTO, así que cuando el borrador se
   * limpia —movimiento agregado, cambio de medio, adjunto quitado— no queda un "procesado
   * correctamente" hablando de un archivo que ya no está.
   */
  useEffect(() => {
    if (!archivo) {
      enVuelo.current?.abort()
      procesado.current = null
      setEstado('vacio')
      setDetalle('')
      setCampos(0)
      setFatal(false)
      return
    }
    if (procesado.current === archivo) return
    procesado.current = archivo

    /* El archivo puede haber entrado por el adjunto de abajo, que no filtra formatos: lo que no se
       puede leer se dice acá, sin gastar la llamada al escenario. */
    const problema = archivoNoSoportado(archivo)
    if (problema) {
      setEstado('error')
      setDetalle(problema)
      setFatal(false)
      return
    }
    void leer(archivo)
    /* Depende del ARCHIVO y de nada más: `leer` se recrea en cada render y meterlo acá volvería a
       procesar el mismo documento con cada tecla que se toque en el formulario. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archivo])

  // Al desmontar (cambio de paso, cierre del formulario) no queda ninguna llamada colgada.
  useEffect(() => () => enVuelo.current?.abort(), [])

  /**
   * Manda el documento al escenario y vuelca lo que devuelva. La declaración va DESPUÉS del efecto
   * que la dispara —el efecto corre recién después del render, así que ya existe—, para que los
   * efectos queden juntos arriba y el circuito se lea de una.
   */
  const leer = async (f: File) => {
    enVuelo.current?.abort()
    const ctrl = new AbortController()
    enVuelo.current = ctrl

    setEstado('procesando')
    setDetalle('')
    setCampos(0)
    setFatal(false)
    try {
      /* Se espera al escenario ENTERO: la promesa recién se resuelve cuando Make devuelve lo que
         leyó la IA, no cuando acusa recibo del archivo. Si el escenario todavía no está en
         condiciones de atender, el servicio insiste solo y avisa por `onReintento`: la espera se
         cuenta en pantalla en lugar de fallar al primer intento. */
      const lectura = await procesarComprobante(f, formaPago, {
        signal: ctrl.signal,
        onReintento: (intento, total, esperaMs) => {
          if (ctrl.signal.aborted) return
          setDetalle(
            `El servidor no está respondiendo. Reintentamos en ${Math.round(esperaMs / 1000)} segundos (intento ${intento} de ${total - 1}).`,
          )
        },
      })
      // Abortada: llegó tarde y el formulario ya es de otro documento.
      if (ctrl.signal.aborted) return

      // Terminó la lectura: los datos se cargan en los campos del medio y se cuenta qué entró.
      const cargados = onDatos(lectura.datos)
      setCampos(cargados)

      /* Sin un solo campo cargado NO se canta victoria: se advierte, y se dice QUÉ mirar según
         dónde se cortó la cadena —el escenario que no responde, el que responde sin datos, o el
         que devolvió datos de otro medio de cobro—. */
      if (cargados === 0) {
        setEstado('sin-datos')
        setDetalle(
          !lectura.respondioJson
            ? 'El servidor recibió el documento pero no devolvió ningún dato. Cargá los campos a mano o volvé a intentar.'
            : lectura.campos === 0
              ? 'El documento se leyó, pero no se reconoció ningún dato. Cargá los campos a mano o volvé a intentar.'
              : `Los datos leídos no corresponden a ${formaPago}. Revisá que el documento sea el del medio de cobro elegido.`,
        )
        return
      }
      setEstado('listo')
    } catch (e) {
      if (ctrl.signal.aborted) return
      setEstado('error')
      setFatal(e instanceof ErrorFatalMake)
      setDetalle(e instanceof Error ? e.message : 'No se pudo procesar el documento.')
    } finally {
      if (enVuelo.current === ctrl) enVuelo.current = null
    }
  }

  /**
   * Toma el archivo elegido o soltado y lo deja en el borrador; procesarlo es cosa del efecto de
   * arriba. Lo que no se puede leer se rechaza ACÁ y NO se carga: un .zip que igual quedara
   * adjunto daría por cumplido el comprobante obligatorio del movimiento.
   */
  const tomar = (f: File | null | undefined) => {
    if (cerrado || !f) return
    const problema = archivoNoSoportado(f)
    if (problema) {
      setEstado('error')
      setDetalle(problema)
      return
    }
    onArchivo(f)
  }

  /* El recuadro hace SIEMPRE lo mismo, con o sin documento cargado: abrir el buscador de archivos.
     Cargado, eso es reemplazarlo, que es la única acción sobre un comprobante ya subido. */
  const abrirBuscador = () => inputRef.current?.click()

  /* Lectura a medias: el documento se procesó —eso es un éxito y así se muestra—, pero quedaron
     campos obligatorios que no salieron de él y hay que cargar a mano. Se reclama al pie, sin
     tocar el resultado de la lectura. */
  const incompleto = estado === 'listo' && faltantes.length > 0

  /**
   * El trabajo del recuadro está TERMINADO: el documento se procesó y de él salieron todos los
   * datos que este medio necesita. A partir de ahí la zona se cierra —no acepta clicks ni archivos
   * arrastrados—, porque cualquier documento nuevo borraría los campos ya completos para volver a
   * leerlos, y no hay nada que ganar volviendo a leer lo que ya está bien.
   *
   * Se reabre sola si alguno de esos campos queda vacío: ahí sí un comprobante nuevo tiene algo que
   * aportar.
   */
  /* El comprobante obligatorio se reclama sólo con el recuadro VACÍO: si hubo un problema con el
     archivo, el mensaje del error dice algo más útil que "cargá el comprobante". */
  const reclamo = estado === 'vacio' ? error : undefined
  const listoYCompleto = estado === 'listo' && faltantes.length === 0
  /**
   * El recuadro NO acepta nada. Son tres motivos distintos con el mismo efecto:
   *
   *   · el formulario está cerrado —el cobro ya se registró—;
   *   · hay una lectura EN CURSO: hasta que termine no entra otro documento. Aceptarlo abortaría la
   *     llamada a mitad de camino y dispararía una segunda, con el escenario procesando dos veces
   *     el mismo cobro y los campos completándose con lo que devuelva la que conteste última;
   *   · ya se procesó uno y de él salieron todos los datos que este medio necesita, así que un
   *     documento nuevo sólo borraría campos que están bien para volver a leerlos.
   *
   * Lo del medio se reabre solo al terminar la lectura; lo último, si alguno de esos campos queda
   * vacío: ahí sí un comprobante nuevo tiene algo que aportar.
   */
  const cerrado = deshabilitado || estado === 'procesando' || listoYCompleto

  return (
    /* El recuadro ENTERO es la zona de soltado, y adentro pasa todo: la consigna, el estado de la
       lectura y el documento cargado con sus acciones. */
    <div
      /* El realce del arrastre se apaga con la zona cerrada: si el último dato entra JUSTO mientras
         se arrastra un archivo encima, el `dragleave` ya no llega y el resalte quedaría prendido. */
      className={`cobro-lector cobro-lector--${estado} ${dragOver && !cerrado ? 'is-over' : ''} ${
        reclamo ? 'is-falta' : ''
      }`}
      onDragOver={(e) => {
        // Sin `preventDefault` el navegador no deja soltar acá: cerrado, se lo deja rechazar solo.
        if (cerrado) return
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        if (cerrado) return
        e.preventDefault()
        setDragOver(false)
        tomar(e.dataTransfer.files?.[0])
      }}
    >
      {/* Botón transparente que cubre el recuadro entero: es el que abre el buscador y el que
          recibe el foco del teclado. Va como HERMANO del contenido y no envolviéndolo, porque un
          botón no puede anidar los botones del documento cargado —"Reemplazar", "Quitar"—, que
          quedan por encima con su propio z-index. */}
      <button
        type="button"
        className="cobro-lector-hit"
        /* Cerrado, el botón se apaga de verdad: no se clickea, no recibe el foco del tabulador y
           no muestra el cursor de mano. La zona deja de ser un control. */
        disabled={cerrado}
        title={
          estado === 'procesando'
            ? 'Esperá a que termine de procesarse el documento'
            : listoYCompleto
              ? 'El comprobante ya se procesó y completó todos los datos'
              : archivo
                ? 'Reemplazar el comprobante cargado'
                : 'Arrastrá para subir · PDF o imagen, hasta 4 MB'
        }
        aria-label={
          estado === 'procesando'
            ? 'Procesando el documento: esperá a que termine para cargar otro'
            : listoYCompleto
              ? `Comprobante procesado: ${archivo?.name ?? ''}. Ya completó todos los datos`
              : archivo
                ? `Comprobante cargado: ${archivo.name}. Hacé click para reemplazarlo`
                : 'Subir el comprobante: arrastrá el archivo o hacé click para elegirlo'
        }
        onClick={abrirBuscador}
      />

      <input
        ref={inputRef}
        id={id}
        type="file"
        hidden
        accept={ACEPTA_ARCHIVO}
        onChange={(e) => {
          tomar(e.target.files?.[0])
          // Se limpia el valor para que volver a elegir EL MISMO archivo dispare el `change`.
          e.target.value = ''
        }}
      />

      {/* TODO el feedback pasa por acá adentro, en el mismo lugar donde se soltó el archivo: la
          animación de la espera y su resultado no obligan a buscarlos en otra parte de la
          pantalla. `aria-live` hace que se lea solo al cambiar, sin mover el foco. */}
      <span className={`cobro-lector-cara cobro-lector-cara--${estado}`} aria-live="polite">
        {estado === 'procesando' && (
          <>
            <span className="cobro-lector-spin" aria-hidden="true" />
            <span className="cobro-lector-titulo">Procesando el documento…</span>
            {/* Mientras se reintenta, el detalle cuenta lo que está pasando: la espera larga se
                entiende, una pantalla quieta sin explicación parece colgada. */}
            <span className="cobro-lector-consigna">
              {detalle || 'Estamos leyendo el comprobante para completar los campos'}
            </span>
          </>
        )}

        {/* El documento SE PROCESÓ: eso es lo que informa el visto verde, y vale igual aunque de
            adentro no haya salido todo. Lo que falte se reclama abajo, junto al archivo. */}
        {estado === 'listo' && (
          <>
            <i className="fas fa-circle-check" aria-hidden="true" />
            <span className="cobro-lector-titulo">Procesado correctamente</span>
            <span className="cobro-lector-consigna">
              Se {campos === 1 ? 'completó' : 'completaron'} {campos}{' '}
              {campos === 1 ? 'campo' : 'campos'}: revisalos antes de agregar el movimiento
            </span>
          </>
        )}

        {/* Advertencia: el documento viajó y volvió, pero no trajo nada. Ni verde ni rojo —el
            procesamiento no se completó, y tampoco hubo un error de comunicación—. */}
        {estado === 'sin-datos' && (
          <>
            <i className="fas fa-triangle-exclamation" aria-hidden="true" />
            <span className="cobro-lector-titulo">No se obtuvieron los datos</span>
            <span className="cobro-lector-consigna">{detalle}</span>
          </>
        )}

        {estado === 'error' && (
          <>
            {/* El error fatal se ve distinto desde el ícono: no es "falló, probá de nuevo" sino
                "con este archivo no se puede". */}
            <i
              className={fatal ? 'fas fa-file-circle-xmark' : 'fas fa-circle-exclamation'}
              aria-hidden="true"
            />
            <span className="cobro-lector-titulo">
              {fatal ? 'Error fatal: el documento no se pudo convertir' : 'No se pudo procesar'}
            </span>
            <span className="cobro-lector-consigna">{detalle}</span>
          </>
        )}

        {/* La consigna vive DENTRO del recuadro: es la instrucción de esta zona, y leerla afuera
            obligaría a atar con la vista un texto suelto al lugar donde hay que soltar el
            archivo. El ícono va al pie, después del texto que lo explica. */}
        {estado === 'vacio' && (
          <>
            <span className="cobro-lector-titulo">Arrastrá para subir</span>
            <span className="cobro-lector-consigna">
              Soltá en este área tu comprobante —PDF o imagen— y completamos los campos
              automáticamente
            </span>
            <i className="fas fa-cloud-arrow-up" />
            {/* La ranura del reclamo se monta SIEMPRE, con o sin mensaje: tiene su alto reservado,
                así que aparecer o desaparecer no mueve ni el título ni el ícono de arriba. Montarla
                sólo cuando hay algo que decir sumaba un cuarto hijo a una cara centrada, y todo lo
                anterior se corría unos pixeles para arriba. */}
            <span className="cobro-lector-reclamo" role="alert">
              {reclamo}
            </span>
          </>
        )}
      </span>

      {/* El documento cargado y sus acciones, DEBAJO del mensaje de estado y centrado con él: son
          del archivo que se está mirando, así que se leen a continuación de lo que pasó con él. */}
      {archivo && (
        <span className="cobro-lector-archivo">
          <i className="fas fa-paperclip" aria-hidden="true" />
          <span className="cobro-lector-nombre" title={archivo.name}>
            {archivo.name}
          </span>
          {/* Reintentar sirve para las DOS formas de quedarse sin datos: la llamada que falló y la
              que volvió vacía. En las dos el documento sigue cargado y el siguiente intento puede
              salir bien —un escenario recién activado, una IA que esta vez sí leyó—. */}
          {((estado === 'error' && !fatal) || estado === 'sin-datos') && (
            <button
              type="button"
              className="cobro-lector-accion"
              onClick={() => void leer(archivo)}
            >
              Reintentar
            </button>
          )}
          {/* "Reemplazar" es la única acción sobre el documento cargado: para los medios que lo
              exigen, quitarlo dejaba el movimiento sin su respaldo y sin forma de agregarse. El que
              se equivocó de archivo sube el correcto encima.

              Desaparece cuando la lectura ya completó todo: ahí no queda nada por leer, y ofrecer
              un reemplazo sólo invita a borrar campos que están bien para volver a llenarlos. */}
          {!cerrado && (
            <button type="button" className="cobro-lector-accion" onClick={abrirBuscador}>
              Reemplazar
            </button>
          )}
        </span>
      )}

      {/* Lo que la lectura NO trajo, en rojo y al pie: la lectura salió bien —arriba lo dice el
          visto verde—, pero el movimiento no se puede agregar hasta que alguien complete esto. Se
          NOMBRA cada campo, porque un "faltan datos" a secas manda a recorrer el formulario. */}
      {incompleto && (
        <span className="cobro-lector-falta" role="alert">
          <i className="fas fa-circle-exclamation" aria-hidden="true" />{' '}
          {faltantes.length === 1 ? 'No se pudo leer' : 'No se pudieron leer'}{' '}
          <strong>{faltantes.join(', ')}</strong>: completá{faltantes.length > 1 ? 'los' : 'lo'} a
          mano para poder agregar el movimiento
        </span>
      )}
    </div>
  )
}
