/**
 * El portero (Capa 1) sólo deja pasar procedencias reales de Monday.
 *
 * Lo que se fija acá es la comparación por SUFIJO. Un `referer.includes('monday.com')` —el atajo
 * obvio— deja entrar `https://monday.com.sitio-malicioso.net`, y con eso alcanza para gastar el
 * token del servidor contra los tableros. La regla es `new URL(referer).hostname` terminando en
 * `.monday.com` / `.monday.app`, o el dominio pelado, o el host propio del deploy (la app pegándose
 * a sí misma desde adentro del iframe, que es el tráfico normal).
 *
 * Se corre con esbuild + node (`npm run test:portero`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import middleware from '../middleware'

const APP = 'https://registrar-cobros-recibos.vercel.app'

/** Arma la petición como llega a la Edge Function: mismo origen, con su `Referer`. */
function pedir(referer: string | null): Response | undefined {
  const headers = new Headers()
  if (referer !== null) headers.set('referer', referer)
  return middleware(new Request(`${APP}/api/monday`, { method: 'POST', headers }))
}

const pasa = (referer: string | null) => pedir(referer) === undefined
const bloquea = (referer: string | null) => pedir(referer)?.status === 403

// --- Procedencias legítimas ---------------------------------------------------------------------
assert.ok(pasa(`${APP}/?boardId=123`), 'la app pegándose a sí misma desde el iframe')
assert.ok(pasa('https://labatea.monday.com/boards/123'), 'cuenta de Monday')
assert.ok(pasa('https://view.monday.app/apps/456'), 'host de apps de Monday')
assert.ok(pasa('https://monday.com/'), 'dominio pelado')

// --- El engaño que motiva el test ----------------------------------------------------------------
assert.ok(bloquea('https://monday.com.sitio-malicioso.net/'), 'dominio que ARRANCA con monday.com')
assert.ok(bloquea('https://falsomonday.com/'), 'sufijo sin el punto separador')
assert.ok(bloquea('https://evilmonday.app/'), 'sufijo sin el punto separador (.app)')
assert.ok(bloquea('https://monday.com.ar/'), 'otro TLD')
assert.ok(bloquea('https://sitio.net/?u=https://x.monday.com'), 'monday.com sólo en el query')

// --- Lo que falta o no cierra ---------------------------------------------------------------------
assert.ok(bloquea(null), 'sin referer')
assert.ok(bloquea('no-es-una-url'), 'referer ilegible')
assert.ok(bloquea('http://labatea.monday.com/'), 'Monday pero sin https')

// El 403 habla en el formato de error que ya entiende el cliente.
const rechazo = pedir(null)!
assert.equal(rechazo.headers.get('content-type'), 'application/json')
assert.equal(rechazo.headers.get('x-portero'), 'sin-referer')

console.log('portero-referer: OK')
