import { useEffect, useRef, useState } from 'react'
import {
  ACEPTA_ARCHIVO,
  archivoNoSoportado,
  DocumentoRechazado,
  ErrorFatalMake,
  procesarComprobante,
  type DatosComprobante,
} from '@/services/make'

/**
 * En qué anda la lectura del documento. Es lo único que decide qué muestra el recuadro: la consigna
 * de arrastre, la animación de la espera o el resultado, siempre en el MISMO lugar —el recuadro
 * tiene medidas fijas, así que ningún cambio de estado mueve los campos que están abajo—.
 *
 * `sin-datos` es la advertencia: el escenario contestó, pero de ahí no salió ningún campo. No es un
 * éxito —no hay nada cargado— ni una falla de la llamada, y se muestra distinto de los dos: en
 * verde diría que el trabajo está hecho cuando el formulario sigue vacío.
 */
type Estado = 'vacio' | 'en-espera' | 'procesando' | 'listo' | 'con-aviso' | 'sin-datos' | 'error'

/**
 * Qué pasó al volcar los datos leídos sobre el formulario.
 *
 * El RECHAZO es la respuesta a una lectura que salió bien pero cuyo contenido no corresponde a esta
 * operación —un certificado emitido por otro cliente, por ejemplo—. No es un fallo del documento ni
 * de la lectura: es un dato que no se puede usar, y por eso no entra ningún campo y se advierte con
 * el motivo, que sólo el formulario conoce.
 */
export interface VolcadoDatos {
  /** Cuántos campos entraron. Cero cuando hubo rechazo. */
  cargados: number
  /** Por qué no se cargó nada, si es que el contenido no corresponde. Es el TÍTULO del aviso. */
  rechazo?: string
  /** Qué hacer al respecto: la bajada que va debajo del motivo. */
  ayuda?: string
  /**
   * El rechazo es BLOQUEANTE: el documento no es de esta operación y con él no se puede seguir.
   *
   * NO cambia cómo se ve —los dos casos son advertencias sobre el documento, no fallas del
   * servicio—: lo que cambia es que mientras siga adjunto el movimiento no se registra, y que no se
   * ofrece reintentar, porque insistir con el mismo archivo daría idéntico.
   */
  bloqueante?: boolean
}

interface LectorComprobanteProps {
  /** id del `input[type=file]` oculto, para enganchar el `<label htmlFor>` del campo. */
  id: string
  /**
   * Medio que se está cargando. Viaja al escenario: es el contexto con el que lee el documento.
   *
   * Es TEXTO y no `FormaPago` porque puede ser el genérico "Retencion": mientras el usuario no
   * eligió el impuesto, eso —y no una retención inventada— es lo que se sabe del cobro.
   */
  formaPago: string
  /** Documento cargado, que vive en el borrador del movimiento. `null` = todavía no hay nada. */
  archivo: File | null
  /**
   * Entrega el documento para que quede en el borrador, o `null` para QUITARLO.
   *
   * El `null` llega desde "Eliminar", que es la salida del recuadro: descarta el comprobante y, con
   * él, los datos que esa lectura había volcado en el formulario. Quien lo recibe se ocupa de las
   * dos cosas —acá el recuadro sólo avisa que el documento se fue—.
   */
  onArchivo: (archivo: File | null) => void
  /**
   * Vuelca sobre el formulario los datos que devolvió el escenario, ya normalizados, y responde
   * CUÁNTOS entraron. El número lo pone quien los recibe y no quien los lee, porque cuáles
   * corresponden depende del medio de cobro: un dato que este medio no muestra no se cargó en
   * ningún lado, y contarlo sería anunciar un campo completo que el usuario no va a encontrar.
   */
  onDatos: (datos: DatosComprobante) => VolcadoDatos
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
   * Falta un dato del formulario SIN EL CUAL no tiene sentido leer el documento, y por eso la
   * lectura queda retenida: el texto dice cuál. `undefined` = se puede procesar.
   *
   * Hoy lo usa la retención: el impuesto es el contexto con el que el escenario lee el certificado,
   * así que mandarlo antes de elegirlo gastaría la llamada para que vuelva contra el tipo
   * equivocado. El documento se carga igual y la lectura arranca sola apenas el dato aparece.
   */
  esperandoPor?: string
  /**
   * Avisa que el documento cargado quedó RECHAZADO: se leyó bien y no corresponde a esta operación
   * —el cheque está a nombre de otro, la transferencia salió de otra cuenta—.
   *
   * Lo escucha el formulario para frenar el alta mientras ese archivo siga adjunto: sin eso, los
   * datos se podrían tipear a mano y el recibo terminaría llevando el comprobante de otra
   * operación, que es justamente lo que el rechazo quiere evitar.
   */
  onRechazo?: (rechazado: boolean) => void
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
  esperandoPor,
  onArchivo,
  onDatos,
  onRechazo,
  deshabilitado = false,
}: LectorComprobanteProps) {
  const [estado, setEstado] = useState<Estado>('vacio')
  /** Detalle del estado: el motivo del error, o cuántos campos se completaron. */
  const [detalle, setDetalle] = useState('')
  const [campos, setCampos] = useState(0)
  /* Reparos de la lectura que NO la invalidan. Se guardan todos —el título los cuenta— pero se
     muestra SÓLO EL PRIMERO: encadenar varios avisos en el recuadro convierte el resultado en un
     párrafo que nadie lee, y lo que falte ya está marcado en rojo en su propio campo. */
  const [avisos, setAvisos] = useState<string[]>([])
  /* Título del aviso cuando el caso tiene uno propio ("El documento ingresado NO es un Cheque").
     Vacío, cada estado usa el suyo por defecto. */
  const [titulo, setTitulo] = useState('')
  /* ¿Tiene sentido volver a mandar EL MISMO archivo? No lo tiene cuando el documento no es el que
     se esperaba: ahí lo que hay que cambiar es el archivo, no repetir la llamada. */
  const [reintentable, setReintentable] = useState(true)
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
      setAvisos([])
      setTitulo('')
      setReintentable(true)
      return
    }
    /* Falta un dato previo: el documento se queda cargado y la lectura NO sale. El archivo no se
       marca como procesado, así que apenas el dato aparece este mismo efecto lo manda a leer sin que
       el usuario tenga que volver a subirlo. */
    if (esperandoPor) {
      enVuelo.current?.abort()
      procesado.current = null
      setEstado('en-espera')
      setDetalle(esperandoPor)
      setCampos(0)
      setTitulo('')
      setReintentable(true)
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
      setTitulo('')
      setReintentable(true)
      return
    }
    void leer(archivo)
    /* Depende del ARCHIVO y de si ya se puede procesar, de nada más: `leer` se recrea en cada render
       y meterlo acá volvería a procesar el mismo documento con cada tecla que se toque. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archivo, esperandoPor])

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
    setAvisos([])
    setTitulo('')
    setReintentable(true)
    // Documento nuevo: lo que se haya rechazado antes dejó de estar en juego.
    onRechazo?.(false)
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
      const { cargados, rechazo, ayuda, bloqueante } = onDatos(lectura.datos)
      setCampos(cargados)

      /* El contenido no corresponde a esta operación: la lectura anduvo, pero lo que trajo no se
         puede usar. Es un problema del DOCUMENTO —no del servicio—, así que se muestra como
         ADVERTENCIA en los dos casos: el rojo queda reservado para cuando el escenario no responde.

         Lo que sí distingue al bloqueante es que con ese archivo adjunto el movimiento no se puede
         registrar, y que no se ofrece reintentar: mandar el mismo documento de nuevo daría igual. */
      if (rechazo) {
        setEstado('sin-datos')
        setTitulo(`Error: ${rechazo}`)
        setDetalle(ayuda ?? '')
        setReintentable(!bloqueante)
        if (bloqueante) onRechazo?.(true)
        return
      }

      /* Sin un solo campo cargado NO se canta victoria: se advierte, y se dice QUÉ mirar según
         dónde se cortó la cadena —el escenario que no responde, el que responde sin datos, o el
         que devolvió datos de otro medio de cobro—. */
      if (cargados === 0) {
        setEstado('sin-datos')
        if (!lectura.respondioJson) {
          setTitulo('Error: El servidor recibió el documento pero no devolvió ningún dato')
          setDetalle('Cargá los campos a mano o volvé a intentar.')
        } else if (lectura.campos === 0) {
          setTitulo('Error: No se pudo leer ningún dato del comprobante ingresado')
          setDetalle('Cargá los campos a mano o volvé a intentar.')
        } else {
          /* El escenario leyó algo, pero de OTRO documento: ninguno de sus campos pertenece a este
             medio. Se dice como lo que es —el archivo no es el que se pidió— y no como una lectura
             floja: reintentar con el mismo daría idéntico. */
          setTitulo(`Error: El documento ingresado NO es un comprobante ${formaPago}`)
          setDetalle('Cargá el comprobante que corresponde al medio de cobro elegido.')
          setReintentable(false)
        }
        return
      }
      /* Lectura completa PERO con un reparo del escenario: el certificado resultó ser de otro
         impuesto y se procesó por el que detectó. Los campos entraron —por eso se cuentan igual—,
         así que no es un fallo; se muestra en ámbar con el texto del escenario, que es el único que
         sabe qué leyó. */
      /* Los reparos llegan por dos vías —la lista del contrato nuevo y el aviso suelto del
         anterior— y se muestran igual: los datos ya entraron, esto es lo que hay que revisar. */
      const reparos = [
        ...lectura.incidencias.map((i) => i.mensaje),
        ...(lectura.advertencia ? [lectura.advertencia] : []),
      ]
      if (reparos.length > 0) {
        setAvisos(reparos)
        setEstado('con-aviso')
        return
      }
      setEstado('listo')
    } catch (e) {
      if (ctrl.signal.aborted) return
      /* DÓNDE está el problema decide cómo se ve. Un `ErrorFatalMake` —y su especialización
         `DocumentoRechazado`— habla del ARCHIVO: no es el que se pidió, no es de este cliente, o no
         se pudo convertir. Eso es una advertencia y lo que resuelve es cargar otro documento.
         El ROJO queda para lo único que no es del archivo: que el escenario no conteste. */
      const delDocumento = e instanceof ErrorFatalMake
      setEstado(delDocumento ? 'sin-datos' : 'error')
      setReintentable(!delDocumento)
      const mensaje = e instanceof Error ? e.message : 'No se pudo procesar el documento.'
      if (delDocumento) {
        setTitulo(`Error: ${mensaje}`)
        setDetalle('Cargá el comprobante que corresponde a esta operación.')
      } else {
        setDetalle(mensaje)
      }
      /* El documento es de otra operación: con él adjunto, el movimiento no se registra. Un fallo
         al LEERLO no cuenta —ahí el comprobante puede ser el correcto—, y por eso se distingue. */
      if (e instanceof DocumentoRechazado) onRechazo?.(true)
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
  const incompleto = (estado === 'listo' || estado === 'con-aviso') && faltantes.length > 0

  /**
   * El trabajo del recuadro está TERMINADO: el documento se procesó y de él salieron todos los
   * datos que este medio necesita. A partir de ahí la zona se cierra —no acepta clicks ni archivos
   * arrastrados—, porque cualquier documento nuevo borraría los campos ya completos para volver a
   * leerlos, y no hay nada que ganar volviendo a leer lo que ya está bien.
   *
   * Se reabre sola si alguno de esos campos queda vacío: ahí sí un comprobante nuevo tiene algo que
   * aportar.
   */
  /* La lectura CON AVISO no cierra el recuadro aunque haya completado todo: el reparo es justamente
     que el documento no era el que se declaró, así que subir el correcto es la acción esperable. */
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
      className={`cobro-lector cobro-lector--${estado} ${dragOver && !cerrado ? 'is-over' : ''}`}
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
          botón no puede anidar los botones del documento cargado —"Reintentar", "Eliminar"—, que
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
        {/* El documento está cargado pero la lectura NO salió: falta un dato del formulario que es
            el contexto con el que hay que leerlo. No es un error ni una espera del servidor, así
            que no lleva spinner: no hay nada en curso, hay algo por completar. */}
        {estado === 'en-espera' && (
          <>
            <i className="fas fa-circle-pause" aria-hidden="true" />
            <span className="cobro-lector-titulo">Listo para procesar</span>
            <span className="cobro-lector-consigna">{detalle}</span>
          </>
        )}

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

        {/* Los datos SÍ entraron, pero el escenario puso un reparo: el certificado era de otro
            impuesto y lo procesó por el que detectó. Se cuenta lo que se completó —el trabajo está
            hecho— y se reproduce el aviso tal como vino, sin reescribirlo. */}
        {estado === 'con-aviso' && (
          <>
            <i className="fas fa-triangle-exclamation" aria-hidden="true" />
            <span className="cobro-lector-titulo">
              {avisos.length === 1
                ? 'Procesado con una advertencia'
                : `Procesado con ${avisos.length} advertencias`}{' '}
              · {campos} {campos === 1 ? 'campo' : 'campos'}
            </span>
            {/* El PRIMER reparo, y nada más. El título dice cuántos hubo; sumar el resto acá sería
                pedirle al usuario que lea un párrafo para enterarse de algo que, campo por campo,
                ya está marcado en el formulario. */}
            <span className="cobro-lector-consigna">{avisos[0]}</span>
          </>
        )}

        {/* ADVERTENCIA. Cubre todo lo que es del DOCUMENTO: no trajo datos, no es el comprobante
            del medio elegido, o no es del cliente de la operación. Ni verde ni rojo —el
            procesamiento no se completó, y tampoco hubo un error de comunicación—.

            El título sale del caso cuando lo tiene; el genérico queda para cuando no. */}
        {estado === 'sin-datos' && (
          <>
            <i className="fas fa-triangle-exclamation" aria-hidden="true" />
            <span className="cobro-lector-titulo">{titulo || 'No se obtuvieron los datos'}</span>
            {detalle && <span className="cobro-lector-consigna">{detalle}</span>}
          </>
        )}

        {/* ERROR, en rojo. Queda para UNA sola cosa: que el escenario no conteste. Todo lo demás
            —el archivo que no se pudo convertir, el que no corresponde— es del documento y se
            advierte arriba, porque lo que resuelve es cargar otro y no volver a intentar. */}
        {estado === 'error' && (
          <>
            <i className="fas fa-circle-exclamation" aria-hidden="true" />
            <span className="cobro-lector-titulo">No se pudo procesar</span>
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
          {reintentable && (estado === 'error' || estado === 'sin-datos') && (
            <button
              type="button"
              className="cobro-lector-accion"
              onClick={() => void leer(archivo)}
            >
              Reintentar
            </button>
          )}
          {/* "Eliminar" está SIEMPRE que haya un documento, salga como salga la lectura: procesada
              sin problemas, con advertencias o con error. Es la única salida del recuadro y la que
              lo devuelve a cero —descarta el archivo y vacía los campos que esa lectura completó—,
              así que cargar otro comprobante empieza de nuevo en vez de mezclarse con lo anterior.

              Reemplaza al viejo "Reemplazar": subir un archivo encima de otro dejaba en pantalla el
              resultado de una lectura y los datos de la otra hasta que la segunda terminaba. */}
          {!deshabilitado && (
            <button
              type="button"
              className="cobro-lector-accion cobro-lector-accion--borrar"
              onClick={() => onArchivo(null)}
            >
              Eliminar
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
