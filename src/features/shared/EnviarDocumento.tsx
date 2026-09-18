import { useEffect, useRef, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { ContactosPicker } from '@/features/shared/ContactosPicker'
import { useBloqueoCredito } from '@/features/shared/useBloqueoCredito'
import { comprobanteEnviable } from '@/features/shared/comprobantesEnviables'
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
   * Clave del comprobante en `comprobantesEnviables` ('recibo'). De ahí sale TODO lo que distingue
   * a un comprobante de otro: de qué ítem se despacha, si ya se emitió, si el crédito lo frena y
   * cómo se envía.
   */
  documento: string
  numero: string
  /** Se dispara cuando el envío se completó bien: habilita "Finalizar Operación" en la vista. */
  onEnviado?: () => void
}

/** Estado del envío, que se muestra como una sola línea dentro de la card. */
type EstadoEnvio = 'idle' | 'enviando' | 'enviado' | 'error'

/**
 * El registro del envío es una sola entrada: interesa si salió y a cuántos, no el detalle
 * contacto por contacto.
 */
function construirLog(contactos: Contacto[], documento: string, numero: string): LogEntry[] {
  const aceptan = contactos.filter((c) => c.ok).length
  return [
    {
      id: 'envio',
      tipo: 'ok',
      titulo: 'Documento enviado correctamente',
      detalle: `${numero} enviado a ${aceptan} de ${contactos.length} contactos por ${documento}.`,
    },
  ]
}

/** Envío del PDF al cliente. Hoy lo usa la emisión del recibo. */
export function EnviarDocumento({ documento, numero, onEnviado }: EnviarDocumentoProps) {
  const state = useApp()
  const { medioEnvio, contactos, documentoEnviado, log } = state
  const dispatch = useDispatch()
  /* El comprobante a enviar. Es lo ÚNICO que sabe de las diferencias entre uno y otro: el
     componente sólo le pregunta. */
  const comprobante = comprobanteEnviable(documento)
  const articulo = comprobante.articulo
  /* EMAIL CON WHATSAPP OPCIONAL (el envío de la factura en la app de operaciones de venta): el Email
     va siempre y WhatsApp se suma con un check, que en el tablero es "Ambos". El medio vive en el
     estado GLOBAL, así que se normaliza: cualquier valor que no sea "Ambos" sale como Email, y un
     "WhatsApp" suelto no tiene cómo colarse. */
  const emailConWhatsapp = comprobante.modoEnvio === 'emailConWhatsapp'
  const conWhatsapp = medioEnvio === 'Ambos'
  const medioEfectivo: MedioEnvio = emailConWhatsapp
    ? conWhatsapp
      ? 'Ambos'
      : 'Email'
    : medioEnvio
  /* De quién son los contactos: el cliente de la cobranza o el proveedor del pago. Lo dice el
     comprobante, no el componente: es la misma consulta sobre el mismo board, con otro ítem. */
  const titular = comprobante.titular(state)
  // ¿Ya fue emitido? De eso depende poder enviarlo.
  const emitido = comprobante.emitido(state)
  // Aviso al intentar enviar sin haber emitido el comprobante todavía.
  const [avisoNoEmitido, setAvisoNoEmitido] = useState(false)
  /* El envío no consume línea nueva: el bloqueo sólo mira el estado del cliente. Cada comprobante
     decide si el crédito lo frena. */
  const bloqueo = useBloqueoCredito({ bloqueante: comprobante.frenaPorCredito })
  /* Con qué texto el contacto declara que acepta este comprobante en su "Para Enviar". */
  const etiquetaContacto = comprobante.etiquetaContacto ?? comprobante.nombre
  // Estado del envío: gobierna íntegramente el botón (idle / loading / success / error).
  const [estadoEnvio, setEstadoEnvio] = useState<EstadoEnvio>('idle')
  // Progreso que reporta la columna de estado en Monday: es el callback de `seguirEnvioRecibo`.
  const [, setEstadoMonday] = useState('')
  const enviando = estadoEnvio === 'enviando'
  /* Éxito PERSISTENTE: el envío ya se completó (bandera global) o se acaba de completar (estado
     local). Sobrevive a la navegación con el stepper, así el botón NO vuelve a habilitarse ni pierde
     su color de éxito al volver a esta etapa. */
  const enviadoOk = documentoEnviado || estadoEnvio === 'enviado'
  /* Deja el botón en rojo para poder reintentar. Es lo único que hace: el detalle del problema va
     al registro, y si el problema fue la API de Monday, a su ventana global. */
  const marcarError = () => setEstadoEnvio('error')

  /**
   * Vuelve a foja cero tras un intento fallido. Se llama cuando el usuario TOCA algo que puede haber
   * resuelto el problema —quitar un contacto, sumar o sacar WhatsApp—: dejar el botón en rojo y el
   * motivo viejo a la vista haría dudar de si el aviso es de antes o de ahora.
   *
   * No toca un envío YA hecho: ahí no hay nada que reintentar y el verde tiene que quedarse.
   */
  const limpiarIntento = () => {
    if (documentoEnviado || estadoEnvio !== 'error') return
    setEstadoEnvio('idle')
    dispatch({ type: 'setLog', entries: [] })
  }

  /* Fallo de la API de Monday: además del botón en rojo, dispara la ventana global. `accion`
     completa la frase "No se pudo …". */
  const fallar = (accion: string) => {
    marcarError()
    dispatch({ type: 'errorMonday', accion })
  }

  /**
   * Los contactos del cliente se traen al entrar al paso, así ya están listos cuando el
   * usuario elige enviar. Se reparten según su clasificación: los que aceptan el documento
   * quedan seleccionados de entrada, y los que no, disponibles en el buscador por si igual
   * se los quiere sumar.
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
    /* La consulta está CACHEADA por cliente y documento: al volver a esta etapa con el stepper
       resuelve al instante y no se le pega de nuevo a Monday. */
    getContactosCliente(titular.id, etiquetaContacto)
      .then((cs) => {
        if (!vivo) return
        /* BLOQUEO DE NEGOCIO: con `exigeContactoQueAcepta`, que el titular tenga contactos no
           alcanza —tiene que haber al menos uno que declare que acepta ESTE comprobante—. Es lo
           que inhabilita por completo el envío de una orden de pago a un proveedor sin
           destinatarios válidos. */
        const aceptan = cs.filter((c) => c.ok)
        setSinContactos(
          comprobante.exigeContactoQueAcepta ? aceptan.length === 0 : cs.length === 0,
        )
        /* El buscador conserva a todos: el picker ya descarta los que están seleccionados,
           así que arranca mostrando sólo los que no aceptan, y un contacto quitado a mano
           vuelve a quedar disponible. */
        setDisponibles(cs)
        /* La selección se siembra UNA sola vez: si ya hay contactos elegidos —porque el usuario
           los ajustó y navegó con el stepper— no se los pisa con la lista por defecto. */
        if (contactosRef.current.length === 0) {
          dispatch({ type: 'setContactos', contactos: cs.filter((c) => c.ok) })
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
   * Contactos que el buscador puede OFRECER.
   *
   * Con `exigeContactoQueAcepta` sólo se ofrecen los que aceptan el comprobante: si el picker
   * dejara sumar a uno que no lo declaró, el usuario podría habilitar el botón agregándolo, y el
   * bloqueo de negocio dejaría de serlo. Para el recibo se siguen ofreciendo todos —ahí sumar a
   * alguien que no lo declaró es una decisión válida del usuario—.
   */
  const ofrecibles = comprobante.exigeContactoQueAcepta
    ? disponibles.filter((c) => c.ok)
    : disponibles

  /**
   * No hay a quién enviarle. El bloque de envío se muestra IGUAL —el medio, el buscador vacío y la
   * lista— y lo que ocupa el lugar de los contactos es el aviso: así se ve QUÉ falta en el lugar
   * donde iría, en vez de reemplazar la pantalla entera por un cartel.
   *
   * Con el envío ya hecho no se muestra: ahí el "Enviado exitosamente" tiene que seguir a la vista.
   */
  const sinDestinatarios = sinContactos && !enviadoOk

  /** Contactos elegidos como ids numéricos de Monday. */
  const contactoItemIds = () =>
    contactos.map((c) => c.itemId).filter((id): id is string => Boolean(id))

  /** Aviso de que el documento todavía no existe en su columna: no se envía sin él. */
  const avisarSinDocumento = () => {
    dispatch({
      type: 'setLog',
      entries: [
        {
          id: 'err-doc',
          tipo: 'err',
          titulo: `Todavía no hay ${comprobante.nombre} generado${articulo === 'la' ? 'a' : ''}`,
          detalle: `El PDF ${articulo === 'la' ? 'de la' : 'del'} ${comprobante.nombre} aún no figura en Monday. Esperá a que termine de generarse y reintentá.`,
        },
      ],
    })
    /* No es un fallo de la API: el documento todavía no se generó. El registro ya lo explica. */
    marcarError()
  }

  /**
   * Con el Email obligatorio, frena el envío si algún contacto elegido no tiene email, y dice cuál.
   * UNA entrada por contacto: con dos o tres en falta, un solo mensaje que los enumere obliga a leerlo
   * entero para saber a quién quitar. Con WhatsApp sumado ("Ambos") nunca frena: a cada uno se le
   * envía por el canal que tenga.
   *
   * Sólo en `emailConWhatsapp`: con el selector, el usuario elige el medio y la lista ya marca en rojo
   * a quien no puede recibirlo, como hasta ahora.
   */
  const frenarPorContactoSinVia = (): boolean => {
    if (!emailConWhatsapp) return false
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
    // acción se anula internamente y NO se vuelve a disparar la mutación de envío.
    if (enviando || enviadoOk) return
    /* Sin el comprobante emitido NO se envía: early return sin tocar la API de Monday, y se avisa
       por modal que primero hay que emitirlo. */
    if (!emitido) {
      setAvisoNoEmitido(true)
      return
    }
    /* Antes de tocar la API: si alguno de los elegidos no tiene por dónde recibirlo, no se manda
       nada. Que parte de la lista quede afuera en silencio es peor que frenar y decir quién falta. */
    if (frenarPorContactoSinVia()) return
    // El envío es una salida del sistema: no sale nada de un cliente bloqueado o excedido.
    if (bloqueo.frenar()) return
    setEstadoEnvio('enviando')
    setEstadoMonday('')
    const itemId = comprobante.itemId(state)
    /* Sin ítem en el tablero no hay de dónde despachar. `emitido` ya lo cubre en el caso normal;
       esto es el resguardo por si las dos señales se desincronizan. */
    if (!itemId) {
      avisarSinDocumento()
      return
    }
    try {
      const resultado = await comprobante.enviar({
        state,
        itemId,
        contactoIds: contactoItemIds(),
        medio: medioEfectivo,
        onProgreso: setEstadoMonday,
      })
      // El PDF todavía no se generó: no es un fallo, hay que esperar y reintentar.
      if (resultado.estado === 'sin-documento') {
        avisarSinDocumento()
        return
      }
      // El tablero reportó error en el envío (destinatarios, medio, la automatización).
      if (resultado.estado === 'error-envio') {
        fallar(`enviar ${articulo} ${comprobante.nombre}`)
        return
      }
      dispatch({ type: 'setLog', entries: construirLog(contactos, comprobante.nombre, numero) })
      // Bandera GLOBAL de éxito: persiste el envío para que el botón quede bloqueado y en verde
      // aunque el usuario navegue con el stepper y vuelva a esta etapa.
      dispatch({ type: 'setDocumentoEnviado', value: true })
      setEstadoEnvio('enviado')
      onEnviado?.()
    } catch {
      dispatch({
        type: 'setLog',
        entries: [
          {
            id: 'err-envio',
            tipo: 'err',
            titulo: 'No se pudo enviar',
            detalle: `Falló el envío ${articulo === 'la' ? 'de la' : 'del'} ${comprobante.nombre} en Monday. Reintentá.`,
          },
        ],
      })
      fallar(`enviar ${articulo} ${comprobante.nombre}`)
    }
  }

  return (
    <div className="card card--neutral card--flush">
      {/* El envío es obligatorio post-emisión: la card queda SIEMPRE abierta y fija (sin pregunta
          "¿Desea enviar?" ni toggle SI/NO). Se muestra directo el bloque de envío.
          Con el envío YA hecho nunca se tapa el bloque: el "Enviado exitosamente" tiene que seguir
          a la vista aunque se vuelva a entrar a la etapa. */}
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
              <label
                className={`dpago-check envio-wsp-check ${enviadoOk ? 'dpago-check--off' : ''}`}
              >
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
                <span
                  className={`dpago-check-box ${conWhatsapp ? 'dpago-check-box--on' : ''}`}
                  aria-hidden="true"
                >
                  <i className="fas fa-check" />
                </span>
                <span className="dpago-check-txt">
                  ¿Desea realizar también un envío por WhatsApp?
                </span>
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
                onChange={(e) =>
                  dispatch({ type: 'setMedioEnvio', value: e.target.value as MedioEnvio })
                }
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
                está donde iría. La lista queda vacía por construcción —el picker no tiene nada que
                ofrecer—, así que no hay dos estados que puedan contradecirse. */}
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
              /* Sólo se marca al contacto que NO tiene por dónde recibirlo. Con "Ambos", que le
                 falte uno de los dos datos no es un problema: se envía por el que tenga. */
              const incompleto = sinViaDeEnvio(c, medioEfectivo)
              /* Rojo únicamente cuando el envío no puede llegarle. Si sigue siendo alcanzable por
                 el otro canal, el dato ausente se informa en gris oscuro: no es un error. */
              const claseFalta = incompleto ? 'citem-sub--falta' : 'citem-sub--aviso'
              return (
                <div className={`citem ${incompleto ? 'citem--sin-dato' : ''}`} key={c.id}>
                  <div className="cinfo">
                    <div className="cava" style={{ background: c.color }}>
                      {c.ini}
                    </div>
                    <div>
                      <div className="citem-name">{c.name}</div>
                      {/* Falta el dato del medio elegido: se avisa acá, en rojo o en gris oscuro
                          según si el contacto queda o no sin vía de envío. */}
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
                      onClick={() => {
                        // Quitar al contacto en falta es justamente cómo se destraba el envío.
                        limpiarIntento()
                        dispatch({ type: 'removeContacto', id: c.id })
                      }}
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Todo el feedback vive DENTRO del botón (idle / loading / success / error). Sin líneas
              de texto sueltas debajo. */}
          <div className="enviar-row">
            <button
              type="button"
              className={`btn-block btn-block--enviar ${enviadoOk ? 'btn-block--ok' : ''}`}
              /* El fondo verde de éxito depende de la bandera GLOBAL (`enviadoOk`): se conserva al
                 volver a esta etapa con el stepper. */
              /* El fondo dice en qué estado está: verde el envío hecho, rojo el fallido, GRIS el
                 que no se puede disparar —sin destinatarios— y azul el que espera el click. El gris
                 es lo que lo distingue de un botón vivo: con el azul al 50% que deja `:disabled`,
                 un control bloqueado se sigue leyendo como accionable. */
              style={{
                background: enviadoOk
                  ? 'var(--green)'
                  : estadoEnvio === 'error'
                    ? 'var(--red)'
                    : contactos.length === 0
                      ? 'var(--c-text-secondary, #6b7280)'
                      : 'var(--primary-blue)',
              }}
              disabled={contactos.length === 0 || enviando || enviadoOk}
              aria-busy={enviando}
              onClick={confirmar}
            >
              {enviando ? (
                <>
                  <i className="fas fa-circle-notch spin" /> Enviando...
                </>
              ) : enviadoOk ? (
                <>
                  <i className="fas fa-check" /> Enviado exitosamente
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

            {/* Qué salió mal y qué hacer, a la derecha del botón. Sólo los ERRORES: el éxito ya lo
                dice el propio botón en verde, y repetirlo al lado es ruido. `role="status"` y no
                `alert`: acompaña a una acción que el usuario acaba de hacer, no interrumpe. */}
            {estadoEnvio === 'error' && log.some((e) => e.tipo === 'err') && (
              <div className="enviar-avisos" role="status" aria-live="polite">
                {log
                  .filter((e) => e.tipo === 'err')
                  .map((e) => (
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
        <AvisoModal titulo="Falta emitir el comprobante" onClose={() => setAvisoNoEmitido(false)}>
          No es posible realizar el envío. Primero debe emitir el comprobante para poder enviarlo.
        </AvisoModal>
      )}
    </div>
  )
}
