import { useEffect, useRef, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { ContactosPicker } from '@/features/shared/ContactosPicker'
import { useBloqueoCredito } from '@/features/shared/useBloqueoCredito'
import { comprobanteEnviable, enviarComprobante } from '@/features/shared/comprobantesEnviables'
import { problemasDeContactos, pulseIdDe, recibioTodo } from '@/lib/envioDocumento'
import {
  contactosSinVia,
  faltaParaMedio,
  msgContactoSinVia,
  sinViaDeEnvio,
} from '@/lib/validaciones'
import { getContactosCliente } from '@/services/monday'
import { useApp, useDispatch } from '@/state/hooks'
import type { Contacto, LogEntry, MedioEnvio } from '@/types'

const MEDIOS: readonly MedioEnvio[] = ['Email', 'WhatsApp', 'Ambos']

/** Ícono de cada aviso del envío, al lado de su detalle. */
const ICONO_LOG: Record<LogEntry['tipo'], string> = {
  ok: 'fa-circle-check',
  err: 'fa-circle-exclamation',
  info: 'fa-circle-info',
  warn: 'fa-triangle-exclamation',
}

/**
 * Un <option> nativo sólo admite texto, así que el ícono va como emoji.
 * 'Ambos' no tiene app propia: lleva el sobre y el chat juntos.
 */
const ICONO_MEDIO: Record<MedioEnvio, string> = {
  Email: '📧',
  WhatsApp: '💬',
  Ambos: '📧💬',
}

interface EnviarDocumentoProps {
  /**
   * Clave del comprobante en `comprobantesEnviables` ('recibo', 'ordenPago', 'resumenCtaCte'). De ahí
   * sale TODO lo que distingue a un comprobante de otro: si ya se emitió, qué se manda, a quién y si
   * el crédito lo frena.
   */
  documento: string
  /** Se dispara cuando el envío se completó bien. */
  onEnviado?: () => void
}

/** Cómo le fue el envío a UN contacto: el ícono a la derecha de su fila. */
type EstadoFila = 'idle' | 'enviando' | 'ok' | 'error'

/**
 * El estado del envío de un contacto: gris mientras no se mandó, girando mientras se manda, verde con
 * tilde si le llegó y rojo con cruz si no. El motivo de la falla va en el tooltip.
 */
function EstadoEnvioContacto({ estado, motivo }: { estado: EstadoFila; motivo?: string }) {
  if (estado === 'enviando') {
    return (
      <span className="cobro-ok cobro-ok--cargando" role="status" aria-label="Enviando">
        <i className="fas fa-circle-notch fa-spin" />
      </span>
    )
  }
  const titulo =
    estado === 'ok'
      ? 'Enviado'
      : estado === 'error'
        ? `No se pudo enviar${motivo ? `: ${motivo}` : ''}`
        : 'Sin enviar'
  return (
    <span
      className={`cobro-ok ${estado === 'ok' ? 'on' : estado === 'error' ? 'err' : ''}`}
      title={titulo}
      aria-label={titulo}
    >
      <i className={`fas ${estado === 'error' ? 'fa-xmark' : 'fa-check'}`} />
    </span>
  )
}

/** Estado del envío: gobierna íntegramente el botón. */
type EstadoEnvio = 'idle' | 'enviando' | 'enviado' | 'error' | 'parcial'

/**
 * Envío del documento emitido a los contactos del titular, por el escenario de Make. Es el MISMO
 * bloque de envío que el del presupuesto y el remito de la app de operaciones de venta: el PDF que
 * generó la app viaja al escenario junto con los destinatarios, y el escenario contesta contacto por
 * contacto qué salió.
 */
export function EnviarDocumento({ documento, onEnviado }: EnviarDocumentoProps) {
  const state = useApp()
  const { medioEnvio, contactos, documentoEnviado, log } = state
  const dispatch = useDispatch()
  /* El comprobante a enviar. Es lo ÚNICO que sabe de las diferencias entre uno y otro: el
     componente sólo le pregunta. */
  const comprobante = comprobanteEnviable(documento)
  /* EMAIL CON WHATSAPP OPCIONAL (el envío de la factura en la app de operaciones de venta): el Email
     va siempre y WhatsApp se suma con un check, que es "Ambos". El medio vive en el estado GLOBAL,
     así que se normaliza: cualquier valor que no sea "Ambos" sale como Email, y un "WhatsApp" suelto
     no tiene cómo colarse. */
  const emailConWhatsapp = comprobante.modoEnvio === 'emailConWhatsapp'
  const conWhatsapp = medioEnvio === 'Ambos'
  const medioEfectivo: MedioEnvio = emailConWhatsapp ? (conWhatsapp ? 'Ambos' : 'Email') : medioEnvio
  /* De quién son los contactos: el cliente de la cobranza o el proveedor del pago. Lo dice el
     comprobante, no el componente: es la misma consulta sobre el mismo board, con otro ítem. */
  const titular = comprobante.titular(state)
  // ¿Ya fue emitido? De eso depende poder enviarlo.
  const emitido = comprobante.emitido(state)
  // Aviso al intentar enviar sin haber emitido el comprobante todavía.
  const [avisoNoEmitido, setAvisoNoEmitido] = useState(false)
  // Contactos elegidos que no pueden recibir el comprobante: qué cambiar, un renglón por problema.
  const [problemasContactos, setProblemasContactos] = useState<string[] | null>(null)
  /* El envío no consume línea nueva: el bloqueo sólo mira el estado del cliente. Cada comprobante
     decide si el crédito lo frena. */
  const bloqueo = useBloqueoCredito({ bloqueante: comprobante.frenaPorCredito })
  /* Con qué texto el contacto declara que acepta este comprobante en su "Para Enviar". */
  const etiquetaContacto = comprobante.etiquetaContacto ?? comprobante.nombre
  // Estado del envío: gobierna íntegramente el botón.
  const [estadoEnvio, setEstadoEnvio] = useState<EstadoEnvio>('idle')
  const enviando = estadoEnvio === 'enviando'
  /* Éxito PERSISTENTE: el envío ya se completó (bandera global) o se acaba de completar (estado
     local). Sobrevive a la navegación con el stepper, así el botón NO vuelve a habilitarse ni pierde
     su color de éxito al volver a esta etapa. */
  const enviadoOk = documentoEnviado || estadoEnvio === 'enviado'
  /* Envío PARCIAL: salió por un canal y no por el otro, o a unos contactos y a otros no. Se lee de la
     bandera global, así que también sobrevive al stepper. Mientras dure, el botón queda en amarillo y
     habilitado: reintentar pide sólo lo que falta. */
  const parcial =
    !enviadoOk && Object.values(state.enviadosPorContacto).some((canales) => canales.length > 0)

  /* Estado por contacto: de cada fila se sabe si le llegó, si falló o si se le está mandando ahora.
     Mientras se envía, gira sólo en los que se incluyen en este pedido —los que todavía no
     recibieron todo—; el que ya tiene su tilde lo conserva. */
  const estadoFila = (c: Contacto): EstadoFila => {
    if (recibioTodo(c, medioEfectivo, state.enviadosPorContacto)) return 'ok'
    if (enviando) return 'enviando'
    return state.contactosFallidos[pulseIdDe(c)] ? 'error' : 'idle'
  }
  /* Quitar contactos: nunca mientras se envía ni con el envío completo; y desde que se disparó el
     primer envío la lista queda fija: el tilde o la cruz de cada fila dicen a quién se le mandó y a
     quién no, y quitar a alguien lo borraría de esa cuenta. */
  const bloqueaQuitar = enviando || enviadoOk || state.envioIniciado
  /* Deja el botón en rojo para poder reintentar. El detalle del problema va a los avisos de al lado. */
  const marcarError = () => setEstadoEnvio('error')

  /**
   * Vuelve a foja cero tras un intento fallido. Se llama cuando el usuario TOCA algo que puede haber
   * resuelto el problema —quitar un contacto, cambiar el medio—: dejar el botón en rojo y el motivo
   * viejo a la vista haría dudar de si el aviso es de antes o de ahora.
   *
   * No toca un envío YA hecho ni uno parcial: el verde tiene que quedarse, y el aviso amarillo dice
   * qué falta, y eso sigue siendo cierto aunque se cambie la lista o el medio.
   */
  const limpiarIntento = () => {
    if (documentoEnviado || parcial || estadoEnvio !== 'error') return
    setEstadoEnvio('idle')
    dispatch({ type: 'setLog', entries: [] })
  }

  /**
   * Los contactos del titular se traen al entrar al paso, así ya están listos cuando el usuario elige
   * enviar. Se reparten según su clasificación: los que aceptan el documento quedan seleccionados de
   * entrada, y los que no, disponibles en el buscador por si igual se los quiere sumar.
   */
  const [disponibles, setDisponibles] = useState<Contacto[]>([])
  const [cargando, setCargando] = useState(false)
  /* No hay a quién enviarle, así que el envío no es posible y ni siquiera se ofrece. Qué cuenta
     como "no hay" depende del comprobante: para el recibo alcanza con que el titular tenga algún
     contacto cargado; para la orden de pago hace falta al menos uno que la ACEPTE. */
  const [sinContactos, setSinContactos] = useState(false)
  /* La selección elegida vive en el estado global y sobrevive a la navegación. Se lee por ref para
     no meterla en las deps del efecto (la pisaría en cada cambio). */
  const contactosRef = useRef(contactos)
  contactosRef.current = contactos
  useEffect(() => {
    if (!titular) {
      setDisponibles([])
      return
    }
    let vivo = true
    setCargando(true)
    /* La consulta está CACHEADA por titular y documento: al volver a esta etapa con el stepper
       resuelve al instante y no se le pega de nuevo a Monday. */
    getContactosCliente(titular.id, etiquetaContacto)
      .then((cs) => {
        if (!vivo) return
        /* BLOQUEO DE NEGOCIO: con `exigeContactoQueAcepta`, que el titular tenga contactos no
           alcanza —tiene que haber al menos uno que declare que acepta ESTE comprobante—. */
        const aceptan = cs.filter((c) => c.ok)
        setSinContactos(comprobante.exigeContactoQueAcepta ? aceptan.length === 0 : cs.length === 0)
        /* El buscador conserva a todos: el picker ya descarta los que están seleccionados, así que
           arranca mostrando sólo los que no aceptan, y un contacto quitado a mano vuelve a quedar
           disponible. */
        setDisponibles(cs)
        /* La selección se siembra UNA sola vez: si ya hay contactos elegidos —porque el usuario los
           ajustó y navegó con el stepper— no se los pisa con la lista por defecto. */
        if (contactosRef.current.length === 0) {
          dispatch({ type: 'setContactos', contactos: aceptan })
        }
      })
      .catch(() => {
        if (!vivo) return
        setDisponibles([])
        setSinContactos(true)
      })
      .finally(() => {
        if (vivo) setCargando(false)
      })
    return () => {
      vivo = false
    }
  }, [titular, etiquetaContacto, comprobante.exigeContactoQueAcepta, dispatch])

  /**
   * Contactos que el buscador puede OFRECER. Con `exigeContactoQueAcepta` sólo se ofrecen los que
   * aceptan el comprobante: si el picker dejara sumar a uno que no lo declaró, el bloqueo de negocio
   * dejaría de serlo.
   */
  const ofrecibles = comprobante.exigeContactoQueAcepta ? disponibles.filter((c) => c.ok) : disponibles

  /**
   * No hay a quién enviarle. El bloque de envío se muestra IGUAL —el medio, el buscador vacío y la
   * lista— y lo que ocupa el lugar de los contactos es el aviso. Con el envío ya hecho no se muestra:
   * ahí el "Enviado exitosamente" tiene que seguir a la vista.
   */
  const sinDestinatarios = sinContactos && !enviadoOk

  /**
   * Frena el envío cuando algún contacto elegido no tiene el dato que el medio necesita, y explica
   * cuál y por qué. UNA entrada por contacto: con dos o tres en falta, un solo mensaje que los enumere
   * obliga a leerlo entero para saber a quién quitar. Con "Ambos" NUNCA frena: ver `contactosSinVia`.
   */
  const frenarPorContactoSinVia = (): boolean => {
    const sinVia = contactosSinVia(contactos, medioEfectivo)
    if (sinVia.length === 0) return false
    dispatch({
      type: 'setLog',
      entries: sinVia.map((c) => ({
        id: `sin-via-${c.id}`,
        tipo: 'err' as const,
        titulo: `${c.name} no puede recibirlo por ${medioEfectivo.toLowerCase()}`,
        detalle: `${msgContactoSinVia(c.name, medioEfectivo)} Quitalo de la lista para enviarles al resto, o cargale el dato en Monday y reintentá.`,
      })),
    })
    marcarError()
    return true
  }

  const confirmar = async () => {
    // Anti-duplicado: si el envío ya se ejecutó con éxito (incluso tras navegar con el stepper), la
    // acción se anula internamente y NO se vuelve a disparar.
    if (enviando || enviadoOk) return
    /* Sin el comprobante emitido NO se envía: se avisa por modal que primero hay que emitirlo. */
    if (!emitido) {
      setAvisoNoEmitido(true)
      return
    }
    /* Validación estricta: todos los elegidos tienen que aceptar el comprobante y tener el dato del
       medio. Se frena con una ventana que lista qué cambiar, antes de llamar al escenario. */
    const problemas = problemasDeContactos(contactos, medioEfectivo, comprobante.nombrePlural)
    if (problemas.length > 0) {
      setProblemasContactos(problemas)
      return
    }
    /* Si alguno de los elegidos no tiene por dónde recibirlo con el medio actual, no se manda nada.
       Que parte de la lista quede afuera en silencio es peor que frenar y decir quién falta. */
    if (frenarPorContactoSinVia()) return
    // El envío es una salida del sistema: no sale nada de un cliente bloqueado o excedido.
    if (bloqueo.frenar()) return
    setEstadoEnvio('enviando')
    // Desde acá la lista queda fija: ya no se puede quitar a nadie (ver `bloqueaQuitar`).
    dispatch({ type: 'setEnvioIniciado' })
    try {
      const resultado = await enviarComprobante(comprobante, state, medioEfectivo)
      if (resultado.estado === 'sin-documento') {
        setEstadoEnvio('idle')
        setAvisoNoEmitido(true)
        return
      }
      // A quién no le llegó: la cruz roja de su fila, y a ellos va el reintento.
      if (resultado.estado === 'error-envio') {
        if (resultado.fallidos) dispatch({ type: 'setContactosFallidos', value: resultado.fallidos })
        dispatch({
          type: 'setLog',
          entries: [
            {
              id: 'err-envio',
              tipo: 'err',
              // Con el canal que falló, se sabe qué revisar: "No se pudo enviar por WhatsApp".
              titulo: resultado.titulo ?? 'No se pudo enviar',
              /* Tal cual llega: el mensaje ya dice qué pasó y qué hacer. El reintento lo indica el
                 tooltip del botón. */
              detalle:
                resultado.mensaje ??
                `Falló el envío ${comprobante.articulo === 'la' ? 'de la' : 'del'} ${comprobante.nombre}. Reintentá.`,
            },
          ],
        })
        marcarError()
        return
      }
      /* Salió por un canal y no por el otro: se guarda lo que salió —el reintento no lo vuelve a
         pedir— y se explica qué falta, en amarillo al lado del botón. */
      if (resultado.estado === 'parcial') {
        dispatch({ type: 'setEnviadosPorContacto', value: resultado.enviados })
        dispatch({ type: 'setContactosFallidos', value: resultado.fallidos })
        dispatch({
          type: 'setLog',
          entries: [{ id: 'parcial', tipo: 'warn', titulo: 'Envío incompleto', detalle: resultado.mensaje }],
        })
        setEstadoEnvio('parcial')
        return
      }
      /* El éxito NO deja mensaje: lo dice el propio botón, que pasa a verde con "Enviado
         exitosamente". Lo que sí hace falta es LIMPIAR el aviso de un intento fallido anterior. */
      dispatch({ type: 'setLog', entries: [] })
      if (resultado.enviados) dispatch({ type: 'setEnviadosPorContacto', value: resultado.enviados })
      dispatch({ type: 'setContactosFallidos', value: {} })
      // Bandera GLOBAL de éxito: persiste el envío para que el botón quede bloqueado y en verde
      // aunque el usuario navegue con el stepper y vuelva a esta etapa.
      dispatch({ type: 'setDocumentoEnviado', value: true })
      setEstadoEnvio('enviado')
      onEnviado?.()
    } catch {
      /* Un rechazo de seguridad ya levantó su propia ventana; acá sólo queda decir que no salió y
         dejar el botón listo para reintentar. */
      dispatch({
        type: 'setLog',
        entries: [
          {
            id: 'err-envio',
            tipo: 'err',
            titulo: 'No se pudo enviar',
            detalle: `Falló el envío ${comprobante.articulo === 'la' ? 'de la' : 'del'} ${comprobante.nombre}. Reintentá.`,
          },
        ],
      })
      marcarError()
    }
  }

  return (
    <div className="card card--neutral card--flush">
      {/* El envío es obligatorio post-emisión: la card queda SIEMPRE abierta y fija. Con el envío YA
          hecho nunca se tapa el bloque: el "Enviado exitosamente" tiene que seguir a la vista. */}
      {cargando && !enviadoOk ? (
        <div className="contactos-cargando">
          <i className="fas fa-spinner fa-spin" /> Cargando contactos…
        </div>
      ) : (
        <>
          {emailConWhatsapp ? (
            /* El Email no se elige: va siempre. Se muestra fijo para que se sepa por dónde sale, y la
               única decisión que queda es sumar WhatsApp. */
            <div className="igp">
              <div className="envio-medio-linea">
                <span className="envio-medio-lbl">Medio de Envío por defecto:</span>
                <div className="envio-medio-fijo">
                  <i className="fas fa-envelope" aria-hidden="true" /> Email
                </div>
              </div>
              <label className={`dpago-check envio-wsp-check ${enviadoOk ? 'dpago-check--off' : ''}`}>
                <input
                  type="checkbox"
                  className="dpago-check-input"
                  checked={conWhatsapp}
                  disabled={enviadoOk || enviando}
                  onChange={(e) => {
                    /* Sumar o sacar WhatsApp cambia qué dato se le exige a cada contacto: el aviso
                       anterior ya no aplica. */
                    limpiarIntento()
                    dispatch({ type: 'setMedioEnvio', value: e.target.checked ? 'Ambos' : 'Email' })
                  }}
                />
                <span className={`dpago-check-box ${conWhatsapp ? 'dpago-check-box--on' : ''}`} aria-hidden="true">
                  <i className="fas fa-check" />
                </span>
                <span className="dpago-check-txt">¿Desea realizar también un envío por WhatsApp?</span>
              </label>
            </div>
          ) : (
            <div className="igp">
              <label htmlFor="medio">Medio de envío *</label>
              <select
                id="medio"
                className="full w-medio"
                style={{ cursor: 'pointer' }}
                value={medioEnvio}
                disabled={enviadoOk || enviando}
                onChange={(e) => {
                  /* Cambiar el medio puede resolver el problema —o crear otro—: en los dos casos el
                     aviso anterior ya no aplica. */
                  limpiarIntento()
                  dispatch({ type: 'setMedioEnvio', value: e.target.value as MedioEnvio })
                }}
              >
                {/* El value queda limpio: el emoji es sólo la etiqueta. */}
                {MEDIOS.map((m) => (
                  <option key={m} value={m}>
                    {ICONO_MEDIO[m]} {m}
                  </option>
                ))}
              </select>
            </div>
          )}

          <ContactosPicker disponibles={ofrecibles} />

          <div className="font-b" style={{ fontSize: 14, marginTop: 24 }}>
            Contactos seleccionados ({contactos.length})
          </div>
          <div className="selc">
            {/* Sin destinatarios el aviso ocupa el lugar de la lista: es exactamente lo que falta y
                está donde iría. */}
            {sinDestinatarios && (
              <div className="envio-sin-contactos" role="alert">
                <i className="fas fa-triangle-exclamation" />
                <div>
                  <div className="envio-sin-contactos-t">{comprobante.sinContactos.titulo}</div>
                  <p>{comprobante.sinContactos.mensaje(titular?.name ?? 'Esta persona')}</p>
                </div>
              </div>
            )}
            {contactos.map((c) => {
              const falta = faltaParaMedio(c, medioEfectivo)
              /* Sólo se marca al contacto que NO tiene por dónde recibirlo. Con "Ambos", que le falte
                 uno de los dos datos no es un problema: se envía por el que tenga. */
              const incompleto = sinViaDeEnvio(c, medioEfectivo)
              /* Rojo únicamente cuando el envío no puede llegarle. Si sigue siendo alcanzable por el
                 otro canal, el dato ausente se informa en gris oscuro: no es un error. */
              const claseFalta = incompleto ? 'citem-sub--falta' : 'citem-sub--aviso'
              return (
                <div className={`citem ${incompleto ? 'citem--sin-dato' : ''}`} key={c.id}>
                  <div className="cinfo">
                    <div className="cava" style={{ background: c.color }}>
                      {c.ini}
                    </div>
                    <div>
                      <div className="citem-name">{c.name}</div>
                      <div className={`citem-sub ${falta.telefono ? claseFalta : ''}`}>
                        {falta.telefono ? 'SIN TELEFONO' : c.phone}
                      </div>
                      <div className={`citem-sub ${falta.email ? claseFalta : ''}`}>
                        {falta.email ? 'SIN EMAIL' : c.email}
                      </div>
                    </div>
                  </div>
                  <div className="citem-right">
                    {/* El color del badge ya dice si acepta o no: no hace falta rótulo ni ícono. */}
                    <span className={`cbadge ${c.ok ? 'ok' : 'no'}`}>{c.status}</span>
                    <button
                      type="button"
                      className="del"
                      aria-label={`Quitar ${c.name}`}
                      disabled={bloqueaQuitar}
                      title={
                        bloqueaQuitar
                          ? 'Ya se envió el documento: no se puede quitar contactos de la lista'
                          : undefined
                      }
                      onClick={() => {
                        if (bloqueaQuitar) return
                        // Quitar al contacto en falta es justamente cómo se destraba el envío.
                        limpiarIntento()
                        dispatch({ type: 'removeContacto', id: c.id })
                      }}
                    >
                      🗑️
                    </button>
                    {/* Cómo le fue el envío a este contacto, a la derecha del tacho. */}
                    <EstadoEnvioContacto estado={estadoFila(c)} motivo={state.contactosFallidos[pulseIdDe(c)]} />
                  </div>
                </div>
              )
            })}
          </div>

          {/* El botón dice EN QUÉ estado está y el detalle va a su derecha: qué salió mal y qué
              hacer. */}
          <div className="enviar-row">
            <button
              type="button"
              className={`btn-block btn-block--enviar ${enviadoOk ? 'btn-block--ok' : ''}`}
              /* El fondo dice en qué estado está: verde el envío hecho, amarillo el parcial, rojo el
                 fallido, GRIS el que no se puede disparar —sin destinatarios— y azul el que espera el
                 click. */
              style={{
                background: enviadoOk
                  ? 'var(--green)'
                  : parcial && !enviando
                    ? 'var(--orange)'
                    : estadoEnvio === 'error'
                      ? 'var(--red)'
                      : contactos.length === 0
                        ? 'var(--c-text-secondary, #6b7280)'
                        : 'var(--primary-blue)',
                ...(enviadoOk ? { opacity: 1 } : {}),
              }}
              disabled={contactos.length === 0 || enviando || enviadoOk}
              aria-busy={enviando}
              /* En error y en parcial sigue habilitado: el mismo botón reintenta, con las mismas
                 validaciones. */
              title={
                enviando || enviadoOk
                  ? undefined
                  : parcial
                    ? 'Tocá para completar el envío'
                    : estadoEnvio === 'error'
                      ? 'Tocá para reintentar el envío'
                      : undefined
              }
              onClick={() => void confirmar()}
            >
              {enviando ? (
                <>
                  <i className="fas fa-circle-notch fa-spin" /> Enviando...
                </>
              ) : enviadoOk ? (
                <>
                  <i className="fas fa-check" /> Enviado exitosamente
                </>
              ) : parcial ? (
                /* Amarillo y habilitado: se reintenta con el mismo botón. Va antes del error: si un
                   reintento falla, lo que ya salió sigue habiendo salido. */
                <>
                  <i className="fas fa-triangle-exclamation" /> Parcialmente enviado
                </>
              ) : estadoEnvio === 'error' ? (
                <>
                  <i className="fas fa-xmark" /> Error de Envío
                </>
              ) : (
                <>
                  <i className="fas fa-paper-plane" /> Confirmar y Enviar
                </>
              )}
            </button>

            {/* Detalle de lo último que pasó: sólo lo que salió mal o a medias. `role="status"` y no
                `alert`: acompaña a una acción que el usuario acaba de hacer, no interrumpe. */}
            {!enviadoOk && log.length > 0 && (
              <div className="enviar-avisos" role="status" aria-live="polite">
                {log.map((e) => (
                  <p key={e.id} className={`enviar-aviso enviar-aviso--${e.tipo}`}>
                    <i className={`fas ${ICONO_LOG[e.tipo]}`} aria-hidden="true" />
                    <span>
                      <strong>{e.titulo}.</strong> {e.detalle}
                    </span>
                  </p>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {bloqueo.modal}

      {/* Aviso al intentar enviar sin haber emitido el comprobante. */}
      {avisoNoEmitido && (
        <AvisoModal titulo={comprobante.avisoNoEmitido.titulo} onClose={() => setAvisoNoEmitido(false)}>
          {comprobante.avisoNoEmitido.texto}
        </AvisoModal>
      )}

      {/* Contactos que no pueden recibir el comprobante: se dice a quién y qué cambiar. */}
      {problemasContactos && (
        <AvisoModal
          titulo="Hay contactos que no pueden recibirlo"
          faltantes={problemasContactos}
          onClose={() => setProblemasContactos(null)}
        >
          No se envió nada. Corregí lo siguiente y volvé a tocar "Confirmar y Enviar":
        </AvisoModal>
      )}
    </div>
  )
}
