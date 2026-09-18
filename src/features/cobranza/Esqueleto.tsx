/**
 * Un bloque gris en el lugar donde va a ir un dato.
 *
 * Todos los widgets del tablero se montan DESDE EL PRINCIPIO, con su layout completo y sus datos en
 * gris: así la pantalla no crece ni se reordena cuando llega la respuesta, y antes de buscar ya se
 * ve qué va a contestar cada cosa. Es lo contrario de esconder los widgets hasta que haya datos, que
 * hace saltar todo de lugar y no dice nada mientras tanto.
 *
 * Con una consulta en vuelo late (`pulso`); antes de la primera búsqueda queda quieto, porque
 * entonces no hay nada cargando: simplemente todavía no se preguntó.
 */
export function Esqueleto({
  ancho,
  alto = 13,
  pulso = false,
}: {
  /** Ancho del bloque, con su unidad ("70%", "120px"). */
  ancho: string
  alto?: number
  pulso?: boolean
}) {
  return (
    <span
      className={`cbz-skel ${pulso ? 'cbz-skel--pulso' : ''}`}
      style={{ width: ancho, height: alto }}
      aria-hidden="true"
    />
  )
}
