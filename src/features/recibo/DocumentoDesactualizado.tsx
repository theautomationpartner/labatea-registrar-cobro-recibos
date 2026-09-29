/**
 * Aviso de que el documento emitido ya no coincide con lo que hay en pantalla y que, además, ya
 * EMPEZÓ a registrarse en Monday (su ítem existe).
 *
 * En cualquier otro caso un documento que quedó viejo se descarta solo y se vuelve a emitir (ver
 * `useReemision`). Acá no: el ítem ya está creado con los datos del PDF, y reemitir terminaría creando
 * otro. Lo que corresponde es deshacer los cambios para terminar de registrarlo, o revisarlo en el
 * tablero.
 */
export function DocumentoDesactualizado({ documento }: { documento: string }) {
  return (
    <div className="doc-desactualizado" role="alert">
      <i className="fas fa-triangle-exclamation" /> Cambiaste datos después de emitir {documento}, pero
      ya empezó a registrarse en Monday. Deshacé los cambios para terminar de registrarlo, o revisalo en
      el tablero.
    </div>
  )
}
