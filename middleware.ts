/**
 * Edge Middleware (Vercel) — Capa 1 de seguridad: "el portero".
 *
 * Corre ANTES que las Serverless Functions y decide quién pasa. Protege las rutas que hablan con
 * Monday usando el token del servidor (`MONDAY_TOKEN`) y la que dispara el escenario de Make, que
 * es lo único que un atacante querría usar: con esas rutas abiertas, cualquiera escribe en los
 * tableros —o quema las operaciones de la cuenta de Make— sin tener credenciales propias.
 *
 * La regla es de PROCEDENCIA, no de identidad: se mira el `Referer` de la petición y se exige que
 * sea la app corriendo dentro del iframe de Monday. No reemplaza a la autenticación real (Capa 2:
 * verificación del `sessionToken` de Monday; Capa 3: el código de 6 dígitos); un cliente que no sea
 * un navegador puede inventar el `Referer`. Sirve contra el acceso casual desde el navegador,
 * contra páginas ajenas que embeban la app y contra scripts que peguen a la ruta desde otro sitio.
 *
 * Comparación de dominios: se usa `new URL(referer).hostname` y se compara por SUFIJO exacto. Un
 * `.includes('monday.com')` dejaría pasar `monday.com.sitio-malicioso.net`, que es justamente el
 * engaño que hay que evitar.
 *
 * Nota sobre el mismo origen: el bundle se sirve desde el dominio de Vercel dentro del iframe, así
 * que sus `fetch` a `/api/monday` son del MISMO origen y el `Referer` es la URL de la propia app,
 * no `monday.com`. Por eso el host propio también está permitido; quien encuadra ese host dentro de
 * Monday y no en otro lado es la CSP `frame-ancestors` de `vercel.json`.
 */

export const config = {
  /* Sólo las rutas que gastan un recurso del servidor. El resto del sitio (index.html, assets) no
     necesita portero: ahí el control es la CSP. */
  matcher: [
    '/api/monday',
    '/api/monday-upload',
    '/api/make-comprobantes',
    '/api/usuario',
    '/api/mfa/:path*',
  ],
}

/* Sufijos con punto inicial a propósito: `.monday.com` sólo matchea subdominios reales. El dominio
   pelado se contempla aparte, en `hostPermitido`. */
const SUFIJOS_PERMITIDOS = ['.monday.com', '.monday.app']

function hostPermitido(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return SUFIJOS_PERMITIDOS.some((sufijo) => host === sufijo.slice(1) || host.endsWith(sufijo))
}

export default function middleware(request: Request): Response | undefined {
  const referer = request.headers.get('referer')
  if (!referer) return prohibido('sin-referer')

  let procedencia: URL
  try {
    procedencia = new URL(referer)
  } catch {
    return prohibido('referer-ilegible')
  }

  /* Host propio del deploy. Se toma del `Host` de la petición (el dominio por el que entró, sea el
     de producción o el de un preview) y se le saca el puerto. */
  const hostPropio = (request.headers.get('host') ?? new URL(request.url).host)
    .toLowerCase()
    .split(':')[0]

  const origen = procedencia.hostname.toLowerCase()

  // La app pegándose a sí misma desde el iframe: mismo origen, es el caso normal.
  if (origen === hostPropio) return undefined

  // Navegación o petición que viene directo de Monday. Sólo por https: un `Referer` en claro
  // significa que la app no se cargó desde donde dice.
  if (procedencia.protocol === 'https:' && hostPermitido(origen)) return undefined

  return prohibido('origen-no-permitido')
}

/**
 * 403 en el formato de error que ya entiende el cliente (`{ errors: [{ message }] }`), para que la
 * app muestre el aviso de siempre y no un error de parseo. El motivo va en una cabecera: sirve para
 * mirar los logs sin darle pistas al que golpea la puerta.
 */
function prohibido(motivo: string): Response {
  return new Response(
    JSON.stringify({
      errors: [{ message: 'Acceso denegado: esta app sólo funciona dentro de monday.com.' }],
    }),
    {
      status: 403,
      headers: {
        'content-type': 'application/json',
        'x-portero': motivo,
        'cache-control': 'no-store',
      },
    },
  )
}
