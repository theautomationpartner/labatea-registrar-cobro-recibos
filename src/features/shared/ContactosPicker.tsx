import { useCallback, useMemo, useRef, useState } from 'react'
import { useClickOutside } from '@/hooks/useClickOutside'
import { useApp, useDispatch } from '@/state/hooks'
import type { Contacto } from '@/types'

/** Buscador sobre los contactos del cliente traídos de Monday; los ya agregados no se reofrecen. */
export function ContactosPicker({ disponibles }: { disponibles: Contacto[] }) {
  const { contactos } = useApp()
  const dispatch = useDispatch()
  const [termino, setTermino] = useState('')
  const [abierto, setAbierto] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const cerrar = useCallback(() => setAbierto(false), [])
  useClickOutside(ref, cerrar, abierto)

  const opciones = useMemo(() => {
    const yaElegidos = new Set(contactos.map((c) => c.id))
    const t = termino.trim().toUpperCase()
    return disponibles.filter(
      (c) =>
        !yaElegidos.has(c.id) &&
        (t === '' || c.name.toUpperCase().includes(t) || c.id.toUpperCase().includes(t)),
    )
  }, [contactos, disponibles, termino])

  return (
    <div className="igp" ref={ref}>
      <label htmlFor="csearch">Seleccionar contactos *</label>
      <div className="sc w-contactos">
        <input
          id="csearch"
          type="text"
          className="full"
          placeholder="Buscar y seleccionar contactos..."
          autoComplete="off"
          value={termino}
          onClick={() => setAbierto(true)}
          onChange={(e) => {
            setTermino(e.target.value)
            setAbierto(true)
          }}
        />
        <span className="sc-caret">▼</span>

        {abierto && (
          <div className="ddc">
            <div className="dda">
              <button type="button" className="btxt" onClick={() => setTermino('')}>
                Mostrar todos los contactos
              </button>
            </div>
            <ul className="cddlist">
              {opciones.map((c) => (
                <li
                  key={c.id}
                  onClick={() => {
                    dispatch({ type: 'addContacto', contacto: c })
                    setTermino('')
                    setAbierto(false)
                  }}
                >
                  <span className="ccode">{c.id}</span> {c.name}
                </li>
              ))}
            </ul>
            {opciones.length === 0 && <div className="nores">No se encontraron contactos.</div>}
          </div>
        )}
      </div>
    </div>
  )
}
