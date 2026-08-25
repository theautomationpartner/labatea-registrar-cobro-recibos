/**
 * Capa 3 · persistencia del segundo factor.
 *
 * La lógica de `_mfa.ts` no habla SQL: habla con esta interfaz. Dos razones concretas, ninguna
 * decorativa:
 *  · los tests corren la lógica de verdad —reutilización, límite de velocidad, códigos de
 *    recuperación— contra un almacén en memoria, sin levantar una base;
 *  · si mañana la base cambia (de Neon a Supabase, o a otra cosa), lo que se reescribe es este
 *    archivo y nada más.
 */
import { consultar } from './_db.js'

/** Un usuario es SIEMPRE el par cuenta + usuario: dos cuentas pueden repetir el id de usuario. */
export interface Usuario {
  accountId: string
  userId: string
}

export interface RegistroMfa {
  /** El secreto TOTP tal como está guardado: cifrado. Descifrarlo es tarea de `_mfa.ts`. */
  secreto: string
  confirmado: boolean
  /** Último time step aceptado, o `null` si todavía no se usó ningún código. */
  ultimoPaso: number | null
}

export interface AlmacenMfa {
  leerRegistro(u: Usuario): Promise<RegistroMfa | null>
  /** Alta o reemplazo del secreto en estado pendiente. Un re-enrolamiento pisa lo anterior. */
  guardarPendiente(u: Usuario, secretoCifrado: string): Promise<void>
  confirmar(u: Usuario, paso: number): Promise<void>
  registrarPaso(u: Usuario, paso: number): Promise<void>

  guardarCodigos(u: Usuario, hashes: string[]): Promise<void>
  /** Marca el código como usado y dice si lo logró. `false` = no existía o ya estaba usado. */
  consumirCodigo(u: Usuario, hash: string): Promise<boolean>
  cuantosCodigosQuedan(u: Usuario): Promise<number>

  contarFallos(u: Usuario, desde: Date): Promise<number>
  anotarIntento(u: Usuario, exito: boolean): Promise<void>

  guardarDispositivo(u: Usuario, hash: string, expiraEn: Date): Promise<void>
  /** `true` si el hash corresponde a un dispositivo de ESE usuario y todavía no venció. */
  dispositivoVigente(u: Usuario, hash: string): Promise<boolean>
  olvidarDispositivos(u: Usuario): Promise<void>
}

/** Filas tal como las devuelve `pg`: los `bigint` vuelven como texto para no perder precisión. */
interface FilaRegistro {
  secreto: string
  confirmado: boolean
  ultimo_paso: string | null
}

const postgres: AlmacenMfa = {
  async leerRegistro(u) {
    const filas = await consultar<FilaRegistro>(
      'select secreto, confirmado, ultimo_paso from mfa_usuarios where account_id = $1 and user_id = $2',
      [u.accountId, u.userId],
    )
    const fila = filas[0]
    if (!fila) return null
    return {
      secreto: fila.secreto,
      confirmado: fila.confirmado,
      ultimoPaso: fila.ultimo_paso === null ? null : Number(fila.ultimo_paso),
    }
  },

  async guardarPendiente(u, secretoCifrado) {
    /* Un re-enrolamiento arranca de cero: secreto nuevo, sin confirmar y sin historia de pasos.
       Si no se limpiara `ultimo_paso`, el primer código del secreto nuevo podría caer en un paso
       ya "gastado" por el secreto viejo y ser rechazado sin motivo visible. */
    await consultar(
      `insert into mfa_usuarios (account_id, user_id, secreto, confirmado, ultimo_paso)
       values ($1, $2, $3, false, null)
       on conflict (account_id, user_id)
       do update set secreto = excluded.secreto, confirmado = false, ultimo_paso = null,
                     creado_en = now(), confirmado_en = null`,
      [u.accountId, u.userId, secretoCifrado],
    )
  },

  async confirmar(u, paso) {
    await consultar(
      `update mfa_usuarios set confirmado = true, confirmado_en = now(), ultimo_paso = $3
       where account_id = $1 and user_id = $2`,
      [u.accountId, u.userId, paso],
    )
  },

  async registrarPaso(u, paso) {
    await consultar(
      'update mfa_usuarios set ultimo_paso = $3 where account_id = $1 and user_id = $2',
      [u.accountId, u.userId, paso],
    )
  },

  async guardarCodigos(u, hashes) {
    // Los códigos viejos se van: si se generan diez nuevos, los anteriores dejan de valer.
    await consultar('delete from mfa_recuperacion where account_id = $1 and user_id = $2', [
      u.accountId,
      u.userId,
    ])
    await consultar(
      `insert into mfa_recuperacion (account_id, user_id, hash)
       select $1, $2, unnest($3::text[])`,
      [u.accountId, u.userId, hashes],
    )
  },

  async consumirCodigo(u, hash) {
    /* El "marcar usado" y el "estaba libre" pasan en la MISMA sentencia: dos pedidos simultáneos
       con el mismo código no pueden entrar los dos, porque sólo uno actualiza la fila. */
    const filas = await consultar<{ id: string }>(
      `update mfa_recuperacion set usado_en = now()
       where account_id = $1 and user_id = $2 and hash = $3 and usado_en is null
       returning id`,
      [u.accountId, u.userId, hash],
    )
    return filas.length > 0
  },

  async cuantosCodigosQuedan(u) {
    const filas = await consultar<{ n: string }>(
      `select count(*)::text as n from mfa_recuperacion
       where account_id = $1 and user_id = $2 and usado_en is null`,
      [u.accountId, u.userId],
    )
    return Number(filas[0]?.n ?? 0)
  },

  async contarFallos(u, desde) {
    const filas = await consultar<{ n: string }>(
      `select count(*)::text as n from mfa_intentos
       where account_id = $1 and user_id = $2 and exito = false and creado_en >= $3`,
      [u.accountId, u.userId, desde.toISOString()],
    )
    return Number(filas[0]?.n ?? 0)
  },

  async anotarIntento(u, exito) {
    await consultar(
      'insert into mfa_intentos (account_id, user_id, exito) values ($1, $2, $3)',
      [u.accountId, u.userId, exito],
    )
  },

  async guardarDispositivo(u, hash, expiraEn) {
    await consultar(
      `insert into mfa_dispositivos (account_id, user_id, hash, expira_en)
       values ($1, $2, $3, $4)
       on conflict (hash) do update set expira_en = excluded.expira_en`,
      [u.accountId, u.userId, hash, expiraEn.toISOString()],
    )
  },

  async dispositivoVigente(u, hash) {
    /* El `account_id`/`user_id` van en el WHERE a propósito: un token robado de otra persona no
       sirve ni aunque siga vigente, porque no es de ESTE usuario. */
    const filas = await consultar<{ id: string }>(
      `update mfa_dispositivos set ultimo_uso = now()
       where account_id = $1 and user_id = $2 and hash = $3 and expira_en > now()
       returning id`,
      [u.accountId, u.userId, hash],
    )
    return filas.length > 0
  },

  async olvidarDispositivos(u) {
    await consultar('delete from mfa_dispositivos where account_id = $1 and user_id = $2', [
      u.accountId,
      u.userId,
    ])
  },
}

let almacen: AlmacenMfa = postgres

/** El almacén en uso. La lógica lo pide por función para que los tests puedan cambiarlo. */
export function mfaStore(): AlmacenMfa {
  return almacen
}

/** Cambia el almacén. Sólo para los tests; en producción nadie llama a esto. */
export function usarAlmacenMfa(otro: AlmacenMfa): void {
  almacen = otro
}
