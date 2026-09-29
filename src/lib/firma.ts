/**
 * Huella de un valor: la misma entrada da siempre el mismo texto, y cualquier cambio da otro.
 *
 * Existe para saber si lo que hay en pantalla sigue siendo lo que se EMITIÓ. El documento es una foto
 * de los datos al emitir, y lo que se registra en Monday tiene que ser esa misma foto: si el usuario
 * vuelve a una etapa anterior y cambia una factura o un importe, las firmas dejan de coincidir y la
 * etapa pide volver a emitir antes de registrar.
 *
 * Los archivos adjuntos (el comprobante de una transferencia) no se serializan: se los identifica por
 * nombre, tamaño y fecha, que es lo que cambia si se sube otro.
 */
export const firmaDe = (valor: unknown): string =>
  JSON.stringify(valor, (_clave, v: unknown) =>
    typeof File !== 'undefined' && v instanceof File ? `archivo:${v.name}:${v.size}:${v.lastModified}` : v,
  )
