-- Capa 3 · esquema del segundo factor (TOTP) y de los dispositivos confiables.
--
-- Base: Neon, creada desde Vercel -> Storage. Nombre: "La Batea Authenticated Users".
-- La integración deja la cadena de conexión en DATABASE_URL / POSTGRES_URL del proyecto.
--
-- Aplicarlo, desde el SQL Editor de Neon (pegar este archivo) o por consola:
--   psql "$DATABASE_URL" -f db/mfa.sql
--
-- Es idempotente (todo va con IF NOT EXISTS): correrlo de nuevo no rompe ni borra nada.
--
-- Un usuario se identifica SIEMPRE por el par (account_id, user_id): dos cuentas de Monday pueden
-- tener ids de usuario iguales, y ninguna hereda el segundo factor de la otra.

-- ── Enrolamiento ────────────────────────────────────────────────────────────────────────────────
create table if not exists mfa_usuarios (
  account_id    text        not null,
  user_id       text        not null,
  -- Secreto TOTP CIFRADO con AES-256-GCM (nunca en claro): quien lea la base sin la clave de la
  -- aplicación no puede generar códigos válidos.
  secreto       text        not null,
  -- `false` mientras el usuario no haya probado que su app lee bien el código.
  confirmado    boolean     not null default false,
  -- Último time step aceptado (RFC 6238). Es la defensa anti-reutilización: un código de este paso
  -- o anterior ya no entra, aunque le queden segundos de vida.
  ultimo_paso   bigint,
  creado_en     timestamptz not null default now(),
  confirmado_en timestamptz,
  primary key (account_id, user_id)
);

-- ── Códigos de recuperación ─────────────────────────────────────────────────────────────────────
-- Se guardan HASHEADOS. El texto plano se muestra una sola vez, cuando se generan.
create table if not exists mfa_recuperacion (
  id         bigserial   primary key,
  account_id text        not null,
  user_id    text        not null,
  hash       text        not null,
  usado_en   timestamptz,
  creado_en  timestamptz not null default now()
);

-- Un código no se puede usar dos veces ni existir repetido.
create unique index if not exists mfa_recuperacion_hash on mfa_recuperacion (hash);
create index if not exists mfa_recuperacion_pendientes
  on mfa_recuperacion (account_id, user_id) where usado_en is null;

-- ── Dispositivos de la jornada (sin cookies) ────────────────────────────────────────────────────
-- Del token sólo se guarda el hash: si la base se filtra, no sirve para entrar.
create table if not exists mfa_dispositivos (
  id         bigserial   primary key,
  account_id text        not null,
  user_id    text        not null,
  hash       text        not null,
  expira_en  timestamptz not null,
  creado_en  timestamptz not null default now(),
  ultimo_uso timestamptz
);

create unique index if not exists mfa_dispositivos_hash on mfa_dispositivos (hash);
create index if not exists mfa_dispositivos_usuario on mfa_dispositivos (account_id, user_id);

-- ── Intentos (límite de velocidad) ──────────────────────────────────────────────────────────────
-- Cada verificación deja rastro. El límite se cuenta sobre esta tabla y no en memoria: en
-- serverless cada instancia tiene su propia memoria, así que un contador local no limita nada.
create table if not exists mfa_intentos (
  id         bigserial   primary key,
  account_id text        not null,
  user_id    text        not null,
  exito      boolean     not null,
  creado_en  timestamptz not null default now()
);

create index if not exists mfa_intentos_ventana
  on mfa_intentos (account_id, user_id, creado_en desc);

-- ── Limpieza ────────────────────────────────────────────────────────────────────────────────────
-- Nada de esto es urgente, pero sin barrer, las dos tablas de abajo crecen para siempre.
-- Se puede correr desde un cron de Vercel o a mano:
--   delete from mfa_intentos     where creado_en < now() - interval '7 days';
--   delete from mfa_dispositivos where expira_en < now() - interval '7 days';
