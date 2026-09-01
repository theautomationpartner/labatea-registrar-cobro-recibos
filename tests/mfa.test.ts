/**
 * Capa 3 · el segundo factor hace lo que dice, incluso cuando el que prueba es paciente.
 *
 * Lo que se fija acá no es el camino feliz —ese lo prueba cualquiera— sino los cuatro que
 * convierten un TOTP decorativo en uno real:
 *  · un código NO se puede usar dos veces, aunque le queden segundos de vida;
 *  · la tolerancia es de un período para cada lado y ni uno más;
 *  · el límite de intentos corta ANTES de mirar el código, así que ni siquiera uno correcto pasa;
 *  · el dispositivo confiable vale para un usuario y hasta su vencimiento, no más.
 *
 * Corre contra un almacén en memoria que imita al de Postgres, así que no hace falta base.
 *
 * Se corre con esbuild + node (`npm run test:mfa`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { generateSync } from 'otplib'
import { ErrorAuth } from '../api/_errores'
import {
  confirmarEnrolamiento,
  estadoMfa,
  exigirMfa,
  iniciarEnrolamiento,
  verificar,
} from '../api/_mfa'
import { usarAlmacenMfa, type AlmacenMfa, type RegistroMfa, type Usuario } from '../api/_mfaStore'

process.env.MFA_ENCRYPTION_KEY = randomBytes(32).toString('base64')
process.env.MFA_REQUERIDO = '1'

const usuario: Usuario = { accountId: '35883216', userId: '107870718' }
const otro: Usuario = { accountId: '35883216', userId: '999' }

const clave = (u: Usuario) => `${u.accountId}:${u.userId}`

/** Imita al almacén de Postgres con la misma semántica: un código se consume una sola vez. */
function almacenEnMemoria() {
  const registros = new Map<string, RegistroMfa>()
  const codigos: { usuario: string; hash: string; usado: boolean }[] = []
  const dispositivos: { usuario: string; hash: string; expira: number }[] = []
  const intentos: { usuario: string; exito: boolean; cuando: number }[] = []

  const almacen: AlmacenMfa = {
    async leerRegistro(u) {
      return registros.get(clave(u)) ?? null
    },
    async guardarPendiente(u, secreto) {
      registros.set(clave(u), { secreto, confirmado: false, ultimoPaso: null })
    },
    async confirmar(u, paso) {
      const r = registros.get(clave(u))
      if (r) registros.set(clave(u), { ...r, confirmado: true, ultimoPaso: paso })
    },
    async registrarPaso(u, paso) {
      const r = registros.get(clave(u))
      if (r) registros.set(clave(u), { ...r, ultimoPaso: paso })
    },
    async guardarCodigos(u, hashes) {
      for (let i = codigos.length - 1; i >= 0; i--) {
        if (codigos[i].usuario === clave(u)) codigos.splice(i, 1)
      }
      for (const hash of hashes) codigos.push({ usuario: clave(u), hash, usado: false })
    },
    async consumirCodigo(u, hash) {
      const fila = codigos.find((c) => c.usuario === clave(u) && c.hash === hash && !c.usado)
      if (!fila) return false
      fila.usado = true
      return true
    },
    async cuantosCodigosQuedan(u) {
      return codigos.filter((c) => c.usuario === clave(u) && !c.usado).length
    },
    async contarFallos(u, desde) {
      return intentos.filter(
        (i) => i.usuario === clave(u) && !i.exito && i.cuando >= desde.getTime(),
      ).length
    },
    async anotarIntento(u, exito) {
      intentos.push({ usuario: clave(u), exito, cuando: Date.now() })
    },
    async guardarDispositivo(u, hash, expiraEn) {
      dispositivos.push({ usuario: clave(u), hash, expira: expiraEn.getTime() })
    },
    async dispositivoVigente(u, hash) {
      return dispositivos.some(
        (d) => d.usuario === clave(u) && d.hash === hash && d.expira > Date.now(),
      )
    },
    async olvidarDispositivos(u) {
      for (let i = dispositivos.length - 1; i >= 0; i--) {
        if (dispositivos[i].usuario === clave(u)) dispositivos.splice(i, 1)
      }
    },
  }

  return { almacen, registros, codigos, dispositivos, intentos }
}

let memoria = almacenEnMemoria()

/** Deja todo en cero y devuelve un usuario ya enrolado y confirmado, con su secreto. */
async function enrolar(u: Usuario = usuario): Promise<string> {
  const { secreto } = await iniciarEnrolamiento(u, 'test')
  await confirmarEnrolamiento(u, generateSync({ secret: secreto }))
  return secreto
}

function reiniciar(): void {
  memoria = almacenEnMemoria()
  usarAlmacenMfa(memoria.almacen)
}

/** Corre algo que debería ser rechazado y devuelve el status, o 'ok' si pasó. */
async function status(fn: () => Promise<unknown>): Promise<number | 'ok'> {
  try {
    await fn()
    return 'ok'
  } catch (e) {
    assert.ok(e instanceof ErrorAuth, `esperaba ErrorAuth y vino ${String(e)}`)
    return e.status
  }
}

// ── Enrolamiento ────────────────────────────────────────────────────────────────────────────────
reiniciar()
{
  const { uri, qr, secreto } = await iniciarEnrolamiento(usuario, 'usuario 107870718')

  assert.match(uri, /^otpauth:\/\/totp\//, 'la URI es la que entiende Google Authenticator')
  assert.match(qr, /^data:image\/png;base64,/, 'el QR viaja listo para un <img src>')
  assert.ok(secreto.length >= 16, 'el secreto se puede tipear a mano')

  const guardado = memoria.registros.get(clave(usuario))!
  assert.equal(guardado.confirmado, false, 'nace pendiente: escanear no es lo mismo que probar')
  assert.ok(!guardado.secreto.includes(secreto), 'el secreto NO se guarda en claro')
  assert.equal(guardado.secreto.split('.').length, 3, 'se guarda como iv.tag.datos')

  // Un código que no valida no confirma nada.
  assert.equal(await status(() => confirmarEnrolamiento(usuario, '000000')), 401)
  assert.equal(memoria.registros.get(clave(usuario))!.confirmado, false, 'sigue pendiente')

  // El código de verdad sí, y trae los diez códigos de recuperación.
  const { codigosRecuperacion: codigos } = await confirmarEnrolamiento(usuario, generateSync({ secret: secreto }))
  assert.equal(codigos.length, 10)
  assert.ok(
    codigos.every((c) => /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(c)),
    'con forma A3F2-9K7Q, sin caracteres que se confundan al dictarlos',
  )
  assert.equal(new Set(codigos).size, 10, 'los diez son distintos')
  assert.ok(
    memoria.codigos.every((fila) => !codigos.includes(fila.hash)),
    'en el almacén sólo queda el hash',
  )
  assert.equal(memoria.registros.get(clave(usuario))!.confirmado, true)
}

// ── Confirmar el enrolamiento YA deja entrar ────────────────────────────────────────────────────
reiniciar()
{
  const { secreto } = await iniciarEnrolamiento(usuario, 'test')
  const alta = await confirmarEnrolamiento(usuario, generateSync({ secret: secreto }))

  /* Sin esto, quien termina de enrolarse choca contra el muro un segundo después: el token del
     dispositivo es la ÚNICA prueba de que pasó el segundo factor, y acaba de probarlo. */
  assert.ok(alta.deviceToken, 'confirmar tiene que emitir el dispositivo de la jornada')
  assert.equal(await status(() => exigirMfa(usuario, alta.deviceToken)), 'ok', 'y con eso se entra')

  /* Dura la jornada. No hay forma de pedir más: la casilla de "confiar 30 días" se sacó a propósito
     para que el segundo factor se pida todos los días. */
  const horas = (memoria.dispositivos[0].expira - Date.now()) / (60 * 60_000)
  assert.ok(horas > 11 && horas < 13, `el dispositivo del alta dura la jornada, no ${horas} horas`)
}

// ── Anti-reutilización: el corazón de la capa ───────────────────────────────────────────────────
reiniciar()
{
  const secreto = await enrolar()
  const codigo = generateSync({ secret: secreto })

  // Ojo: `enrolar` ya consumió el paso actual al confirmar, así que ESE mismo código ya no entra.
  assert.equal(await status(() => verificar(usuario, codigo)), 401, 'el código de la confirmación no se recicla')

  // Uno del período siguiente sí, y una sola vez.
  const epoch = Math.floor(Date.now() / 1000) + 30
  const siguiente = generateSync({ secret: secreto, epoch })
  assert.equal(await status(() => verificar(usuario, siguiente)), 'ok', 'código nuevo entra')
  assert.equal(
    await status(() => verificar(usuario, siguiente)),
    401,
    'el MISMO código no entra dos veces, aunque le queden segundos de vida',
  )
}

// ── Tolerancia: un período para cada lado, ni uno más ───────────────────────────────────────────
reiniciar()
{
  const { secreto } = await iniciarEnrolamiento(usuario, 'test')
  const epoch = Math.floor(Date.now() / 1000)

  // Se confirma con el código de hace 60 s: fuera de tolerancia, no valida.
  assert.equal(
    await status(() => confirmarEnrolamiento(usuario, generateSync({ secret: secreto, epoch: epoch - 60 }))),
    401,
    'un código de dos períodos atrás está vencido',
  )

  // El de hace 30 s sí: es la tolerancia que se pidió (±30 s).
  const { codigosRecuperacion: codigos } = await confirmarEnrolamiento(usuario, generateSync({ secret: secreto, epoch: epoch - 30 }))
  assert.equal(codigos.length, 10, 'el código del período anterior entra')
}

// ── Límite de velocidad: 5 fallos cada 15 minutos ───────────────────────────────────────────────
reiniciar()
{
  const secreto = await enrolar()

  for (let i = 1; i <= 5; i++) {
    assert.equal(await status(() => verificar(usuario, '000000')), 401, `fallo ${i}`)
  }

  /* El sexto intento se corta ANTES de mirar el código. Se prueba con uno CORRECTO a propósito: si
     un código bueno pasara igual, el límite no estaría frenando la fuerza bruta sino apenas
     contándola, y además le diría al atacante cuándo acertó. */
  const bueno = generateSync({ secret: secreto, epoch: Math.floor(Date.now() / 1000) + 30 })
  assert.equal(await status(() => verificar(usuario, bueno)), 429, 'sexto intento: bloqueado')

  // El bloqueo es por usuario: otra persona no paga por los fallos ajenos.
  const secretoOtro = await enrolar(otro)
  const buenoOtro = generateSync({ secret: secretoOtro, epoch: Math.floor(Date.now() / 1000) + 30 })
  assert.equal(await status(() => verificar(otro, buenoOtro)), 'ok', 'el límite es por usuario')

  // Cuando la ventana pasa, la puerta se vuelve a abrir sola.
  for (const intento of memoria.intentos) intento.cuando -= 16 * 60_000
  /* +30 s y no más: la tolerancia es de UN período, así que un código de dos períodos adelante
     estaría fuera de rango y el test estaría probando otra cosa. Este nunca se consumió: el
     intento anterior murió en el límite, antes de mirar el código. */
  const otroBueno = generateSync({ secret: secreto, epoch: Math.floor(Date.now() / 1000) + 30 })
  assert.equal(await status(() => verificar(usuario, otroBueno)), 'ok', 'a los 15 min se libera')
}

// ── Códigos de recuperación ─────────────────────────────────────────────────────────────────────
reiniciar()
{
  const { secreto } = await iniciarEnrolamiento(usuario, 'test')
  const { codigosRecuperacion: codigos } = await confirmarEnrolamiento(usuario, generateSync({ secret: secreto }))

  const primero = codigos[0]
  const uso = await verificar(usuario, primero)
  assert.equal(uso.conRecuperacion, true, 'entró con un código de recuperación')
  assert.equal(uso.codigosRestantes, 9, 'queda uno menos')

  assert.equal(await status(() => verificar(usuario, primero)), 401, 'un código de recuperación es de UN solo uso')

  // Se aceptan escritos como los muestra la pantalla o pegados sin guion ni mayúsculas.
  assert.equal(
    await status(() => verificar(usuario, codigos[1].toLowerCase().replace('-', ' '), false)),
    'ok',
    'se normaliza lo que tipea la persona',
  )
}

// ── Dispositivo confiable ───────────────────────────────────────────────────────────────────────
reiniciar()
{
  const secreto = await enrolar()

  // Sin dispositivo, el guardián corta.
  assert.equal(await status(() => exigirMfa(usuario, undefined)), 403, 'sin dispositivo no se pasa')
  assert.equal(await status(() => exigirMfa(usuario, 'inventado')), 403, 'un token cualquiera no sirve')

  const codigo = generateSync({ secret: secreto, epoch: Math.floor(Date.now() / 1000) + 30 })
  const res = await verificar(usuario, codigo)
  const token = res.deviceToken!
  /* Se captura ACÁ, apenas se emite: más abajo se enrola a otro usuario y eso agrega otro
     dispositivo a la lista, con lo que "el último" dejaría de ser éste. */
  const emitido = memoria.dispositivos[memoria.dispositivos.length - 1]

  /* SIEMPRE la jornada, nunca más. Es la regla que reemplazó a la casilla de los 30 días: quien usa
     la app todos los días escribe el código todos los días. */
  const horasVerif = (new Date(res.expiraEn!).getTime() - Date.now()) / (60 * 60_000)
  assert.ok(horasVerif > 11 && horasVerif < 13, `verificar emite un dispositivo de jornada, no de ${horasVerif} horas`)

  assert.ok(token.length >= 40, 'el token es largo y aleatorio')
  assert.ok(
    memoria.dispositivos.every((d) => d.hash !== token),
    'en el almacén queda el hash, no el token',
  )
  assert.equal(await status(() => exigirMfa(usuario, token)), 'ok', 'con el dispositivo, pasa')

  // El token es de ESTE usuario: robárselo a otro no sirve.
  await enrolar(otro)
  assert.equal(await status(() => exigirMfa(otro, token)), 403, 'el token no es transferible')

  // Y vence.
  emitido.expira = Date.now() - 1
  assert.equal(await status(() => exigirMfa(usuario, token)), 403, 'vencido no sirve')
}

// ── Re-enrolarse invalida los dispositivos viejos ───────────────────────────────────────────────
reiniciar()
{
  const secreto = await enrolar()
  const codigo = generateSync({ secret: secreto, epoch: Math.floor(Date.now() / 1000) + 30 })
  const token = (await verificar(usuario, codigo)).deviceToken!
  assert.equal(await status(() => exigirMfa(usuario, token)), 'ok')

  /* Alguien perdió el teléfono y vuelve a enrolarse. Lo último que se quiere es que el equipo del
     que se lo encontró siga entrando sin que nadie le pregunte nada. */
  await enrolar()
  assert.equal(await status(() => exigirMfa(usuario, token)), 403, 're-enrolarse corta los dispositivos viejos')
}

// ── El interruptor ──────────────────────────────────────────────────────────────────────────────
reiniciar()
{
  assert.equal(await status(() => exigirMfa(usuario, undefined)), 403, 'con MFA_REQUERIDO=1 se exige')

  process.env.MFA_REQUERIDO = '0'
  assert.equal(await status(() => exigirMfa(usuario, undefined)), 'ok', 'apagado, la capa es inerte')

  const estado = await estadoMfa(usuario, undefined)
  assert.equal(estado.exigido, false, 'y la UI se entera por el estado')
  assert.equal(estado.enrolado, false)
  process.env.MFA_REQUERIDO = '1'
}

// ── La base caída no puede tumbar una capa apagada ──────────────────────────────────────────────
/* El caso real: se despliega la app sin haber conectado todavía la base. `estadoMfa` reventaba con
   un 500 y el frontend, que ante un estado ilegible muestra el muro —ante la duda se pregunta—,
   dejaba la app ENTERA inutilizable con la capa apagada. Lo que se fija acá es la asimetría:
   apagada degrada a inerte, encendida falla cerrada. */
{
  reiniciar()
  const almacenRoto: AlmacenMfa = {
    ...memoria.almacen,
    async leerRegistro() {
      throw new Error('falta DATABASE_URL (o POSTGRES_URL) en el servidor')
    },
  }
  usarAlmacenMfa(almacenRoto)

  process.env.MFA_REQUERIDO = '0'
  const estado = await estadoMfa(usuario, undefined)
  assert.equal(estado.exigido, false, 'apagada y sin base: se contesta igual')
  assert.equal(estado.enrolado, false, 'y el estado inerte no inventa un enrolamiento')

  process.env.MFA_REQUERIDO = '1'
  let fallo = false
  try {
    await estadoMfa(usuario, undefined)
  } catch {
    fallo = true
  }
  assert.ok(fallo, 'encendida, el fallo se propaga: nadie pasa por una base que no contesta')
}

console.log('mfa: OK')
