import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Cargando } from './Cargando'
import {
  confirmarEnrolamiento,
  DemasiadosIntentos,
  estadoSegundoFactor,
  iniciarEnrolamiento,
  verificarCodigo,
  type Enrolamiento,
} from '@/services/mfa'

/**
 * El muro del segundo factor (Capa 3).
 *
 * Es lo ÚNICO que se dibuja entre la validación de la lista blanca y la app: hasta que el backend
 * confirme el código y emita el token del dispositivo, de la operación no se ve nada.
 *
 * Resuelve los dos escenarios con la misma pantalla base:
 *  · la primera vez, muestra el QR para escanear, pide el primer código y entrega los diez códigos
 *    de rescate —que se ven una sola vez, porque en la base sólo queda su hash—;
 *  · después, pide el código de seis dígitos, una vez por jornada.
 *
 * El campo acepta tanto un código de la app como uno de rescate: quien perdió el teléfono no tiene
 * por qué buscar otra pantalla, y el backend ya sabe distinguirlos por su forma.
 *
 * No hay casilla de "confiar en este dispositivo": la verificación se pide todos los días. Es una
 * decisión deliberada y no un olvido — el dispositivo dura una jornada y punto.
 */
export function MfaGuard({ onListo }: { onListo: () => void }) {
  const [paso, setPaso] = useState<'cargando' | 'enrolar' | 'rescate' | 'verificar'>('cargando')
  const [enrolamiento, setEnrolamiento] = useState<Enrolamiento | null>(null)
  const [codigosRescate, setCodigosRescate] = useState<string[]>([])
  const [guardados, setGuardados] = useState(false)
  const [codigo, setCodigo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [bloqueado, setBloqueado] = useState(false)
  /* La sacudida del campo ante un código incorrecto. Es feedback físico: se entiende antes de leer
     el mensaje, y es lo que el ojo espera de un campo que rechaza algo. */
  const [sacudir, setSacudir] = useState(false)
  const campo = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let vivo = true
    estadoSegundoFactor()
      .then(async (estado) => {
        if (!vivo) return
        if (estado.confirmado) {
          setPaso('verificar')
          return
        }
        // Todavía no lo configuró: se le arma el enrolamiento antes de mostrarle nada.
        const alta = await iniciarEnrolamiento()
        if (!vivo) return
        setEnrolamiento(alta)
        setPaso('enrolar')
      })
      .catch(() => vivo && setError('No se pudo preparar la verificación. Recargá la página.'))
    return () => {
      vivo = false
    }
  }, [])

  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (enviando || bloqueado) return
    setEnviando(true)
    setError(null)

    try {
      if (paso === 'enrolar') {
        setCodigosRescate(await confirmarEnrolamiento(codigo))
        setCodigo('')
        setPaso('rescate')
      } else {
        await verificarCodigo(codigo)
        onListo()
      }
    } catch (e) {
      /* El límite de intentos deja el formulario cerrado: reintentar antes de los 15 minutos da el
         mismo rechazo, y un botón habilitado invita a gastar intentos al pedo. */
      if (e instanceof DemasiadosIntentos) setBloqueado(true)
      setError((e as Error).message)
      setCodigo('')
      setSacudir(true)
      /* El foco vuelve al campo: quien se equivocó tipeando quiere reintentar ahí mismo, sin tener
         que ir a buscarlo con el mouse. */
      campo.current?.focus()
    } finally {
      setEnviando(false)
    }
  }

  /* Mientras se prepara, la animación va sola sobre la app: todavía no hay nada que mostrar dentro
     del panel, y dibujarlo vacío con un texto adentro es una caja por el gusto de la caja. */
  if (paso === 'cargando' && !error) return <Cargando mensaje="Preparando la verificación" />

  return (
    <div className="mfa-muro">
      <div className="mfa-panel">
        <i className="fas fa-shield-halved mfa-icono" />

        {paso === 'enrolar' && enrolamiento && (
          <>
            <h2 className="mfa-titulo">Configurá tu segundo factor</h2>
            <p className="mfa-texto">
              Escaneá este código con <strong>Google Authenticator</strong> (o la app de
              verificación que uses) y escribí los seis dígitos que te muestre.
            </p>
            <img
              className="mfa-qr"
              src={enrolamiento.qr}
              alt="Código QR para la app de verificación"
            />
            <p className="mfa-secreto">
              ¿No podés escanear? Cargalo a mano: <code>{enrolamiento.secreto}</code>
            </p>
          </>
        )}

        {paso === 'rescate' && (
          <>
            <h2 className="mfa-titulo">Guardá tus códigos de rescate</h2>
            <p className="mfa-texto">
              Son tu única forma de entrar si perdés el teléfono. Cada uno sirve{' '}
              <strong>una sola vez</strong> y <strong>no se pueden volver a mostrar</strong>.
            </p>
            <ul className="mfa-rescate">
              {codigosRescate.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <label className="mfa-confiar">
              <input
                type="checkbox"
                checked={guardados}
                onChange={(e) => setGuardados(e.target.checked)}
              />
              Ya los guardé en un lugar seguro
            </label>
            <button
              type="button"
              className="btn btn-primary mfa-boton"
              disabled={!guardados}
              onClick={onListo}
            >
              Entrar a la aplicación
            </button>
          </>
        )}

        {paso === 'verificar' && (
          <>
            <h2 className="mfa-titulo">Verificación en dos pasos</h2>
            <p className="mfa-texto">
              Escribí el código de seis dígitos de tu app de verificación
            </p>
          </>
        )}

        {(paso === 'enrolar' || paso === 'verificar') && (
          /* No se reemplaza por un loading: se OSCURECE y se bloquea. Cambiar el formulario por
             una animación borra lo que la persona acaba de escribir de su vista y la deja sin
             referencia de qué está pasando; atenuarlo dice "esto sigue acá, esperá". */
          <form
            onSubmit={enviar}
            className={`mfa-form${enviando ? ' mfa-form--enviando' : ''}`}
            aria-busy={enviando}
          >
            <input
              ref={campo}
              className={['mfa-input', error && 'mfa-input--error', sacudir && 'mfa-input--sacudir']
                .filter(Boolean)
                .join(' ')}
              onAnimationEnd={() => setSacudir(false)}
              value={codigo}
              onChange={(e) => {
                setCodigo(e.target.value)
                // Al volver a tipear, el error deja de tener sentido: molesta más de lo que informa.
                if (error) setError(null)
              }}
              aria-invalid={error !== null}
              placeholder="000000"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={9}
              autoFocus
              disabled={enviando || bloqueado}
            />

            <button
              type="submit"
              className="btn btn-primary mfa-boton"
              disabled={enviando || bloqueado || codigo.trim().length < 6}
            >
              {enviando && <i className="fas fa-circle-notch spin" />}
              {enviando ? 'Verificando…' : paso === 'enrolar' ? 'Confirmar' : 'Verificar'}
            </button>

            {/* El hueco del mensaje existe SIEMPRE, aunque esté vacío: si apareciera recién con el
                error, el panel crecería de golpe y todo lo de arriba saltaría justo cuando la
                persona está mirando el campo. Reservarlo deja el error entrando en su lugar.
                Además el `role="alert"` presente desde el principio hace que los lectores de
                pantalla anuncien el cambio de forma confiable. */}
            <p
              className={`mfa-error${error ? '' : ' mfa-error--vacio'}`}
              role="alert"
            >
              {error ?? ''}
            </p>
          </form>
        )}

        {error && paso !== 'enrolar' && paso !== 'verificar' && (
          <p className="mfa-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
