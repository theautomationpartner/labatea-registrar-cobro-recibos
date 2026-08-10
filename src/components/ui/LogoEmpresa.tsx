import { useState } from 'react'

/**
 * Archivo del logo, servido desde `public/`. Vite copia esa carpeta tal cual a la raíz del sitio,
 * así que la ruta es absoluta y no pasa por el bundler: para cambiar el logo alcanza con
 * reemplazar el archivo, sin tocar código ni recompilar.
 */
const LOGO_SRC = '/logo-la-batea.png'

/**
 * Logo de la empresa en la barra superior. Se muestra ENTERO (`object-fit: contain`): la caja fija
 * el alto y el ancho lo pone la imagen, así nunca se recorta ni se deforma, sea cual sea su
 * proporción original.
 *
 * Si el archivo todavía no está, el `onError` lo saca de la barra en vez de dejar el ícono de
 * imagen rota: la app sigue viéndose bien mientras el logo no esté cargado.
 */
export function LogoEmpresa() {
  const [sinArchivo, setSinArchivo] = useState(false)
  if (sinArchivo) return null

  return (
    <img
      className="topsel-logo"
      src={LOGO_SRC}
      alt="La Batea"
      decoding="async"
      draggable={false}
      onError={() => setSinArchivo(true)}
    />
  )
}
