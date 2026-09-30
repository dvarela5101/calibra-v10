-- Endurecer los comprobantes. HU-059.
--
-- HU-007 dejó el bucket privado `comprobantes`; HU-063 subió el límite a 10 MiB. Faltaban tres cosas
-- (decisión N-4 del 29-sep-2026):
--
--   * Contenido real. El Storage solo mira el tipo que declara quien sube. El servidor revisa los
--     primeros bytes de cada comprobante (`src/lib/comprobantes/revision.ts`) antes de que un pago lo
--     use: si coinciden con el tipo declarado y con la extensión, lo anota con
--     `anotar_comprobante_revisado()`; si no, lo descarta (lo borra, salvo que un pago ya lo use).
--     `pago.comprobante` es una llave foránea a `comprobante_revisado`, así que ningún pago apunta a un
--     archivo que el servidor no revisó o que descartó. La revisión la llama quien cree el pago (HU-018).
--   * Huérfanos. Un comprobante que lleva más de 24 horas sin que ningún pago lo use se borra.
--     `tomar_comprobantes_huerfanos()` los toma y la app los borra con la API de Storage y la llave
--     secreta (borrar por SQL lo bloquea `storage.protect_delete`). La limpieza corre cada hora: pg_cron
--     llama a la ruta `/api/procesos/limpiar-comprobantes` con el mismo secreto de HU-065.
--     La anotación y la limpieza usan el mismo borde con el reloj de la base: solo se anota un
--     comprobante de 24 horas o menos, y solo se toma uno de más de 24 horas. Así la revisión nunca
--     vuelve a anotar algo que la limpieza está por borrar.
--   * Cuota. Cada sesión (su carpeta en el bucket) sube máximo 5 comprobantes cada 24 horas. Cuenta
--     subidas, no archivos: un comprobante descartado o borrado sigue contando hasta que pasan las 24
--     horas. Lo hace cumplir un trigger sobre `storage.objects` y no una política, porque la subida con
--     una URL firmada no pasa por las políticas de quien sube y el trigger corre siempre. La app
--     pregunta antes (`mi_cuota_de_comprobantes()`) para dar el mensaje claro sin intentar la subida.
--     El protocolo S3 del Storage, que la app no usa y cuyas subidas multiparte no completadas no pasan
--     por aquí, queda apagado en supabase/config.toml (en la nube, en el corte, HU-057).
--
-- Los números viven solo en `parametros_comprobantes()`; `src/lib/comprobantes/reglas.ts` los repite
-- para los mensajes e `integracion/comprobantes-endurecidos.test.ts` comprueba que coincidan.
-- Idempotente.

-- ---------------------------------------------------------------------------
-- Parámetros (N-4)
-- ---------------------------------------------------------------------------
create or replace function public.parametros_comprobantes()
returns table (
  cuota_subidas integer,
  cuota_ventana_min integer,
  huerfano_tras_min integer
)
language sql
stable
parallel safe
set search_path = ''
as $$
  select
    5,      -- cuota_subidas: comprobantes que una sesión puede subir en la ventana
    1440,   -- cuota_ventana_min: la ventana de la cuota, 24 h
    1440    -- huerfano_tras_min: un comprobante sin pago se borra después de 24 h
$$;

-- ---------------------------------------------------------------------------
-- Comprobantes revisados: los únicos a los que un pago puede apuntar
-- ---------------------------------------------------------------------------
create table if not exists public.comprobante_revisado (
  ruta text primary key,
  tipo text not null,
  revisado_en timestamptz not null default now(),
  constraint comprobante_revisado_tipo check (tipo in ('image/jpeg', 'image/png', 'application/pdf')),
  constraint comprobante_revisado_ruta check (
    ruta ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|pdf)$'
  )
);

comment on table public.comprobante_revisado is
  'Comprobantes cuyo contenido revisó el servidor (primeros bytes = tipo declarado = extensión). pago.comprobante apunta aquí. HU-059.';

-- Solo el servidor, con la llave secreta, la lee y la escribe.
alter table public.comprobante_revisado enable row level security;
revoke all on table public.comprobante_revisado from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.comprobante_revisado to service_role;

-- Con datos existentes (el corte de HU-057), cada pago tiene que tener antes su fila de revisado.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'pago_comprobante_revisado_fk' and conrelid = 'public.pago'::regclass
  ) then
    alter table public.pago
      add constraint pago_comprobante_revisado_fk
      foreign key (comprobante) references public.comprobante_revisado (ruta);
  end if;
end $$;

-- Anota un comprobante revisado. Solo si existe en el bucket y tiene 24 horas o menos (con 24 h
-- exactas todavía se anota: borde inclusivo de P-40, el mismo que usa la limpieza para no tomarlo).
-- Devuelve 'anotado', 'no_existe' o 'vencido'.
create or replace function public.anotar_comprobante_revisado(p_ruta text, p_tipo text)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_creado timestamptz;
  v_huerfano_tras integer;
begin
  select o.created_at into v_creado
  from storage.objects o
  where o.bucket_id = 'comprobantes' and o.name = p_ruta
  for share;
  if not found then
    return 'no_existe';
  end if;

  select p.huerfano_tras_min into v_huerfano_tras from public.parametros_comprobantes() p;
  if not public.dentro_de_plazo(v_creado + make_interval(mins => v_huerfano_tras), now()) then
    return 'vencido';
  end if;

  insert into public.comprobante_revisado (ruta, tipo) values (p_ruta, p_tipo)
  on conflict (ruta) do update set tipo = excluded.tipo, revisado_en = now();
  return 'anotado';
end;
$$;

-- ---------------------------------------------------------------------------
-- Cuota por sesión: un registro de subidas que no se borra con el archivo
-- ---------------------------------------------------------------------------
create table if not exists privado.subida_comprobante (
  id bigint generated always as identity primary key,
  carpeta text not null,
  subido_en timestamptz not null default now()
);
create index if not exists subida_comprobante_carpeta_idx on privado.subida_comprobante (carpeta, subido_en);
create index if not exists subida_comprobante_subido_en_idx on privado.subida_comprobante (subido_en);

comment on table privado.subida_comprobante is
  'Una fila por subida al bucket comprobantes, para la cuota de N-4. Se purga pasadas 24 horas. HU-059.';

alter table privado.subida_comprobante enable row level security;
revoke all on table privado.subida_comprobante from public, anon, authenticated, service_role;

-- Cuántas subidas tiene una carpeta dentro de la ventana, el máximo y desde cuándo se libera un cupo
-- (24 horas después de la subida más vieja de las que cuentan).
create or replace function privado.uso_de_cuota_de_comprobantes(p_carpeta text)
returns table (usados integer, maximo integer, libre_desde timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with p as (select * from public.parametros_comprobantes()),
  recientes as (
    select s.subido_en
    from privado.subida_comprobante s, p
    where s.carpeta = p_carpeta
      and s.subido_en > now() - make_interval(mins => p.cuota_ventana_min)
  )
  select
    (select count(*)::integer from recientes),
    p.cuota_subidas,
    (select min(r.subido_en) + make_interval(mins => p.cuota_ventana_min) from recientes r)
  from p;
$$;

-- El trigger. security definer: corre con el rol de quien sube (o con el del Storage, en la subida con
-- URL firmada) y tiene que contar y anotar en privado.
create or replace function privado.exigir_cuota_de_comprobantes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_carpeta text := split_part(new.name, '/', 1);
  v_usuario uuid := auth.uid();
  v_usados integer;
  v_maximo integer;
  v_ventana integer;
begin
  -- Una sesión que intenta escribir en la carpeta de otra: lo rechaza la política de INSERT. Aquí no se
  -- cuenta ni se toma el candado de esa carpeta, para no revelar si la otra sesión llegó al tope.
  if v_usuario is not null and v_carpeta <> v_usuario::text then
    return new;
  end if;

  -- Dos subidas a la vez de la misma sesión se cuentan una detrás de la otra.
  perform pg_advisory_xact_lock(hashtextextended('comprobantes:' || v_carpeta, 0));

  select p.cuota_ventana_min into v_ventana from public.parametros_comprobantes() p;
  delete from privado.subida_comprobante where subido_en <= now() - make_interval(mins => v_ventana);

  select c.usados, c.maximo into v_usados, v_maximo
  from privado.uso_de_cuota_de_comprobantes(v_carpeta) c;
  if v_usados >= v_maximo then
    raise exception 'Ya subiste % comprobantes en las últimas 24 horas, el máximo permitido.', v_maximo
      using errcode = 'check_violation', hint = 'cuota_de_comprobantes';
  end if;

  -- Si la subida falla después (política, tamaño), esta fila se deshace con ella.
  insert into privado.subida_comprobante (carpeta) values (v_carpeta);
  return new;
end;
$$;

drop trigger if exists comprobantes_cuota on storage.objects;
create trigger comprobantes_cuota
  before insert on storage.objects
  for each row
  when (new.bucket_id = 'comprobantes')
  execute function privado.exigir_cuota_de_comprobantes();

-- Lo que la app pregunta antes de subir: el uso de la cuota de la sesión que llama.
create or replace function public.mi_cuota_de_comprobantes()
returns table (usados integer, maximo integer, libre_desde timestamptz)
language sql
stable
set search_path = ''
as $$
  select c.usados, c.maximo, c.libre_desde
  from privado.uso_de_cuota_de_comprobantes((select auth.uid())::text) c
  where (select auth.uid()) is not null;
$$;

-- ---------------------------------------------------------------------------
-- Huérfanos: más de 24 horas sin que ningún pago los use
-- ---------------------------------------------------------------------------
-- Toma un lote de huérfanos para borrarlos: en la misma sentencia quita su fila de
-- `comprobante_revisado` y devuelve las rutas. Desde ahí ningún pago puede apuntarles, y como
-- `anotar_comprobante_revisado()` no anota nada de más de 24 horas, la fila tampoco vuelve. Si un pago
-- se crea justo a la vez con esa ruta, la llave foránea hace fallar una de las dos sentencias. Si el
-- borrado en el Storage falla, el archivo sigue huérfano y la siguiente pasada lo vuelve a tomar.
-- "Más de 24 horas" con el reloj de la base: con 24 h exactas todavía no se toma (P-40).
create or replace function public.tomar_comprobantes_huerfanos(p_limite integer default 500)
returns table (ruta text)
language sql
volatile
set search_path = ''
as $$
  with huerfanos as (
    select o.name as ruta
    from storage.objects o
    where o.bucket_id = 'comprobantes'
      and not public.dentro_de_plazo(
        o.created_at + make_interval(mins => (select p.huerfano_tras_min from public.parametros_comprobantes() p)),
        now()
      )
      and not exists (select 1 from public.pago g where g.comprobante = o.name)
    order by o.created_at, o.name
    limit greatest(coalesce(p_limite, 0), 0)
  ),
  -- Una sentencia de escritura dentro de un WITH se ejecuta siempre, aunque nadie la lea.
  sin_revision as (
    delete from public.comprobante_revisado r
    using huerfanos h
    where r.ruta = h.ruta
    returning r.ruta
  )
  select h.ruta from huerfanos h;
$$;

-- ---------------------------------------------------------------------------
-- La limpieza programada
-- ---------------------------------------------------------------------------
-- Dispara un proceso de la app con pg_net, con la dirección y el secreto que viven en Vault (los
-- mismos de HU-065). Sin ellos no hace nada: así en local y en la nube hasta el corte (HU-057).
create or replace function privado.disparar_proceso(p_ruta text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sitio text;
  v_secreto text;
begin
  if p_ruta is null or p_ruta !~ '^/api/procesos/[a-z0-9-]+$' then
    raise exception 'Ruta de proceso no válida: %', p_ruta using errcode = 'invalid_parameter_value';
  end if;

  select decrypted_secret into v_sitio from vault.decrypted_secrets where name = 'calibra_sitio_url';
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'calibra_cron_secreto';
  if coalesce(btrim(v_sitio), '') = '' or coalesce(btrim(v_secreto), '') = '' then
    return null;
  end if;

  return net.http_post(
    url := rtrim(btrim(v_sitio), '/') || p_ruta,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Authorization', 'Bearer ' || btrim(v_secreto), 'Content-Type', 'application/json'),
    timeout_milliseconds := 60000
  );
end;
$$;

-- cron.schedule con el mismo nombre reemplaza el trabajo: reaplicar la migración no lo duplica.
select cron.schedule(
  'calibra-limpiar-comprobantes',
  '17 * * * *',
  $$select privado.disparar_proceso('/api/procesos/limpiar-comprobantes')$$
);

-- ---------------------------------------------------------------------------
-- Permisos explícitos (auto_expose_new_tables = false)
-- ---------------------------------------------------------------------------
revoke all on function public.parametros_comprobantes() from public, anon, authenticated, service_role;
grant execute on function public.parametros_comprobantes() to authenticated, service_role;

revoke all on function public.mi_cuota_de_comprobantes() from public, anon, authenticated, service_role;
grant execute on function public.mi_cuota_de_comprobantes() to authenticated;

revoke all on function public.anotar_comprobante_revisado(text, text) from public, anon, authenticated, service_role;
grant execute on function public.anotar_comprobante_revisado(text, text) to service_role;

revoke all on function public.tomar_comprobantes_huerfanos(integer) from public, anon, authenticated, service_role;
grant execute on function public.tomar_comprobantes_huerfanos(integer) to service_role;

-- Las de privado no las ve la Data API. uso_de_cuota la llama mi_cuota_de_comprobantes con el rol de
-- la sesión; las otras dos solo el trigger y pg_cron.
revoke all on function privado.uso_de_cuota_de_comprobantes(text) from public, anon, authenticated, service_role;
grant execute on function privado.uso_de_cuota_de_comprobantes(text) to authenticated;
revoke all on function privado.exigir_cuota_de_comprobantes() from public, anon, authenticated, service_role;
revoke all on function privado.disparar_proceso(text) from public, anon, authenticated, service_role;
