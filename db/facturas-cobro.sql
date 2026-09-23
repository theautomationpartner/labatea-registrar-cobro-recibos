-- Facturas de venta PENDIENTES DE COBRO cacheadas en el servidor: lo que escribe el Cron Job
-- (`api/cron/facturas-cobro.ts`) y lee `/api/facturas-cobranza`.
--
-- Misma base que el segundo factor y que el padrón de personas (Neon, `DATABASE_URL` con pooler;
-- ver `db/mfa.sql`).
--
-- Aplicarlo, desde el SQL Editor de Neon (pegar este archivo) o por consola:
--   psql "$DATABASE_URL" -f db/facturas-cobro.sql
--
-- Es idempotente (todo va con IF NOT EXISTS): correrlo de nuevo no rompe ni borra nada.
--
-- ── Por qué existe ──
-- La GESTIÓN DE COBRANZA cruza dos tableros: las cuentas corrientes que cumplen el criterio de
-- saldo y, de esas cuentas, las facturas en los tramos de vencimiento pedidos. Las facturas eran la
-- mitad lenta: una consulta por cada lote de 100 clientes, con su paginación. Acá viven TODAS las
-- facturas no canceladas al 100% del tablero "💰Fact Vtas Pends de Cobro" (18421035508), y la
-- búsqueda sólo sale a Monday por las cuentas.
--
-- ── Por qué no es incremental (a diferencia del padrón de personas) ──
-- Lo que importa de una factura —"🤖Cobrado $" y "🤖Pend de Cobrar $"— son una MIRROR y una
-- FÓRMULA. Monday no mueve el `updated_at` de un ítem cuando cambia una mirror o una fórmula, así
-- que una corrida "sólo lo modificado" no se enteraría nunca de un cobro. Cada corrida barre las
-- no canceladas enteras, que es la única forma de que el pendiente cacheado sea el del tablero.

-- ── Las facturas ────────────────────────────────────────────────────────────────────────────────
create table if not exists facturas_cobro_cache (
  item_id        text        primary key,
  -- El ítem de "🤖Personas" al que está conectada. Es por lo que se cruza con las cuentas
  -- corrientes, así que va como columna indexada y no adentro del JSON.
  cliente_id     text        not null default '',
  -- Índice de "🤖Estado de Vencimiento" (color_mm6symyx). NULL = el tablero todavía no le puso
  -- tramo: esa factura sigue siendo deuda y entra cuando se piden los cinco tramos.
  tramo_indice   int,
  -- "🤖Fecha Vto" en ISO (o NULL). Sólo para devolverlas ordenadas como las devolvía Monday.
  vencimiento    date,
  -- El ítem de Monday tal cual llegó (`id`, `name`, `column_values`, `personas`). Se guarda CRUDO y
  -- no mapeado a propósito: el mapeo ya existe en el navegador (`mapFacturaAdeudada`) y lo comparte
  -- el RESUMEN DE CTA CTE; un segundo mapeo acá podría empezar a mostrar otro importe.
  datos          jsonb       not null,
  -- Sólo se mueve si los datos CAMBIARON de verdad. Es diagnóstico: dice cuándo cambió por última
  -- vez una factura, sin que el barrido de cada 5 minutos lo pise.
  actualizado_en timestamptz not null default now(),
  -- Lo pisa cada corrida. La fila que no se vio en la vuelta se canceló al 100% o se borró.
  visto_en       timestamptz not null default now()
);

create index if not exists facturas_cobro_cache_cliente on facturas_cobro_cache (cliente_id);

-- ── Estado de la sincronización ─────────────────────────────────────────────────────────────────
-- Una sola fila. Guarda cómo terminó la última corrida y hace de lock entre corridas.
create table if not exists facturas_cobro_sync (
  id              int         primary key default 1 check (id = 1),
  ultimo_ok       timestamptz,
  facturas        int         not null default 0,
  duracion_ms     int,
  -- El último fallo, en texto: el endpoint de lectura lo devuelve y el navegador, con esto y
  -- `ultimo_ok`, decide si confía en el caché o sale a Monday directo.
  error           text,
  -- Lock de corrida. Vercel puede disparar una invocación con la anterior viva, y a veces repite
  -- una: dos barridos simultáneos se pisarían el `visto_en` y el del final borraría filas vigentes.
  corriendo_desde timestamptz
);

insert into facturas_cobro_sync (id) values (1) on conflict do nothing;
