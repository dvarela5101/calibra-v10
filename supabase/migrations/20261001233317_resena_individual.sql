-- Reseña de una monitoría individual desde el correo. HU-035.
--
-- RN-70: la reseña cuelga del pago (una por pago), solo si el pago no fue rechazado y la monitoría está `realizada`.
-- RN-72: en una individual el enlace de reseña le llega por correo al Lead cuando la monitoría pasa a `realizada`,
-- y no vence. D-17 (1-oct-2026, resuelve P-03): la calificación va de 1 a 5 y el comentario es opcional.
--
-- Una individual llega a `realizada` por dos caminos (HU-023): el monitor la finaliza (`finalizar_monitoria`) o se
-- cierra sola (`cerrar_monitorias_sin_finalizar`). Para no depender de cuál, un trigger anota la invitación en
-- `invitacion_resena` en la misma transacción del cambio de estado (si el cambio se deshace, la invitación también),
-- igual que `aviso_monitor` en HU-051. Después la app manda el correo:
--
--   * El mismo trigger le pide a la app con pg_net que procese las invitaciones (`/api/procesos/invitar-resenas`).
--     pg_net envía la petición solo si la transacción se confirma, así que el correo sale en segundos.
--   * pg_cron repite el pedido cada 5 minutos si quedan invitaciones sin procesar: cubre una petición perdida.
--   * Un correo que falla queda `fallido` en `correo_envio` y lo reintenta el proceso de HU-065, que lo reconstruye a
--     partir del pago. La clave del correo (`resena_individual:<id_pago>`) impide mandarlo dos veces.
--
-- Decisiones de diseño:
--   * El token del enlace se guarda en claro, no como hash (a diferencia de HU-068). El enlace no vence (RN-72) y el
--     reintento de HU-065 tiene que volver a mandar el mismo enlace: con un hash habría que rotar el token en cada envío,
--     y dos corridas a la vez invalidarían el enlace ya enviado. El modelo ya guarda tokens así
--     (`diagnostico.token_recuperacion`, `monitoria_grupal.token_enlace`). La tabla solo la lee `service_role` y el token
--     solo sirve para dejar una reseña (nunca para leer datos de contacto ni de pagos).
--   * El destinatario es el Lead de la monitoría (`lead.correo`; el correo es obligatorio por P-22).
--   * Reciben invitación los pagos de la monitoría con `estado <> 'rechazado'` y sin reseña (RN-70, literal). Las
--     grupales quedan fuera: su reseña es otra regla (RN-71) y otra HU.
--   * "Disponible" = monitoría `realizada`, individual (sin fila en `monitoria_grupal`), pago `estado <> 'rechazado'` y
--     sin reseña. `registrar_resena` lo vuelve a comprobar con el pago bloqueado, de modo que un rechazo o una reseña
--     que llegan al mismo tiempo no se cuelan.
--   * El comentario es opcional: se recorta y, si queda vacío, se guarda nulo. Máximo 1000 caracteres.
--   * Permisos: `service_role` ya tiene select, insert, update y delete sobre `resena`, `pago`, `monitoria`, `lead`,
--     `monitor`, `materia`, `franja` y `monitoria_grupal` (migración de roles y cuentas), así que las funciones de
--     lectura y escritura que corren con sus permisos no necesitan permisos nuevos. Solo se le da lo mínimo sobre la
--     tabla nueva.
--
-- La dirección de la app y el secreto viven en Vault (`calibra_sitio_url` y `calibra_cron_secreto`, como en HU-065 y
-- HU-051). Sin ellos el pedido no hace nada: así en local, y en la nube hasta el corte (HU-057).
-- Idempotente.

-- ---------------------------------------------------------------------------
-- La reseña: escala de D-17
-- ---------------------------------------------------------------------------
alter table public.resena drop constraint if exists resena_calificacion_de_1_a_5;
alter table public.resena
  add constraint resena_calificacion_de_1_a_5 check (calificacion between 1 and 5);

alter table public.resena drop constraint if exists resena_comentario_largo;
alter table public.resena
  add constraint resena_comentario_largo check (comentario is null or char_length(comentario) between 1 and 1000);

comment on column public.resena.calificacion is 'De 1 a 5 (D-17).';
comment on column public.resena.comentario is 'Opcional (D-17): nulo, o de 1 a 1000 caracteres.';

-- ---------------------------------------------------------------------------
-- Las invitaciones por mandar
-- ---------------------------------------------------------------------------
create table if not exists public.invitacion_resena (
  id uuid primary key default gen_random_uuid(),
  id_pago uuid not null references public.pago (id) on delete cascade,
  -- El secreto del enlace (64 caracteres hexadecimales, 256 bits). En claro a propósito: ver la cabecera.
  token text not null default encode(extensions.gen_random_bytes(32), 'hex'),
  creada_en timestamptz not null default now(),
  -- La app ya la tomó y dejó el correo en `correo_envio` (enviado, fallido para reintentar o descartado), o la abandonó.
  procesado_en timestamptz,
  -- Corridas en las que no se pudo procesar (error de la base o de los datos). La app la abandona a las 5, para que
  -- una invitación que siempre falla no tape a las demás.
  intentos integer not null default 0,
  constraint invitacion_resena_id_pago_key unique (id_pago),
  constraint invitacion_resena_token_key unique (token),
  constraint invitacion_resena_token_hex check (token ~ '^[0-9a-f]{64}$'),
  constraint invitacion_resena_intentos_no_negativos check (intentos >= 0)
);

comment on table public.invitacion_resena is
  'Invitaciones por correo a reseñar una individual realizada (RN-72): las anota un trigger de monitoria y las manda la app. HU-035.';
comment on column public.invitacion_resena.token is
  'Secreto del enlace de reseña, en claro porque el enlace no vence y el reintento reenvía el mismo.';

-- Lo que busca el proceso: las que faltan, de la más antigua a la más reciente.
create index if not exists invitacion_resena_pendientes_idx on public.invitacion_resena (creada_en) where procesado_en is null;

-- Nadie con sesión la lee ni la escribe: el trigger inserta (security definer) y la app trabaja con la llave secreta, que
-- lee y solo marca `procesado_en` e `intentos`. Sin políticas, RLS niega todo a anon y authenticated.
alter table public.invitacion_resena enable row level security;
revoke all on table public.invitacion_resena from public, anon, authenticated, service_role;
grant select, update (procesado_en, intentos) on table public.invitacion_resena to service_role;

-- ---------------------------------------------------------------------------
-- Pedirle a la app que procese las invitaciones
-- ---------------------------------------------------------------------------
-- Solo si hay invitaciones sin procesar y la configuración está en Vault. Devuelve el id de la petición de pg_net, o null
-- si no pidió nada. security definer: lee Vault y usa pg_net, que no son de nadie más.
create or replace function privado.disparar_invitaciones_resena()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sitio text;
  v_secreto text;
begin
  if not exists (select 1 from public.invitacion_resena where procesado_en is null) then
    return null;
  end if;

  select decrypted_secret into v_sitio from vault.decrypted_secrets where name = 'calibra_sitio_url';
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'calibra_cron_secreto';
  if coalesce(btrim(v_sitio), '') = '' or coalesce(btrim(v_secreto), '') = '' then
    return null;
  end if;

  return net.http_post(
    url := rtrim(btrim(v_sitio), '/') || '/api/procesos/invitar-resenas',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Authorization', 'Bearer ' || btrim(v_secreto), 'Content-Type', 'application/json'),
    timeout_milliseconds := 60000
  );
end;
$$;

revoke all on function privado.disparar_invitaciones_resena() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- El trigger: anota la invitación al pasar a realizada
-- ---------------------------------------------------------------------------
-- Solo individuales y solo el paso a `realizada` desde otro estado. Una invitación por cada pago no rechazado que aún
-- no tenga reseña (RN-70).
create or replace function privado.anotar_invitacion_resena()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (old.estado <> 'realizada' and new.estado = 'realizada') then
    return null;
  end if;

  if exists (select 1 from public.monitoria_grupal g where g.id_monitoria = new.id) then
    return null;
  end if;

  insert into public.invitacion_resena (id_pago)
  select p.id
  from public.pago p
  where p.id_monitoria = new.id
    and p.estado <> 'rechazado'
    and not exists (select 1 from public.resena r where r.id_pago = p.id)
  on conflict on constraint invitacion_resena_id_pago_key do nothing;

  -- El pedido a la app nunca tumba el cambio de estado: si Vault o pg_net fallan (por ejemplo, una dirección mal
  -- escrita), la invitación queda anotada y pg_cron la vuelve a pedir.
  begin
    perform privado.disparar_invitaciones_resena();
  exception when others then
    raise warning 'calibra: no se pudo pedir la invitación a reseñar (%): %', sqlstate, sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function privado.anotar_invitacion_resena() from public, anon, authenticated, service_role;

drop trigger if exists monitoria_anota_invitacion_resena on public.monitoria;
create trigger monitoria_anota_invitacion_resena
  after update of estado on public.monitoria
  for each row
  when (old.estado is distinct from new.estado)
  execute function privado.anotar_invitacion_resena();

-- ---------------------------------------------------------------------------
-- Lo que la app necesita para escribir el correo
-- ---------------------------------------------------------------------------
-- Con los permisos de quien llama: solo la llave secreta (service_role), que lee esas tablas. Sin filas si el pago no
-- tiene invitación. `disponible` dice si el enlace todavía permite reseñar (la app no manda el correo si ya no).
create or replace function public.datos_de_invitacion_resena(p_id_pago uuid)
returns table (
  token text,
  disponible boolean,
  correo_lead text,
  nombre_lead text,
  nombre_monitor text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    i.token,
    m.estado = 'realizada'
      and p.estado <> 'rechazado'
      and not exists (select 1 from public.monitoria_grupal g where g.id_monitoria = m.id)
      and not exists (select 1 from public.resena r where r.id_pago = p.id),
    l.correo,
    l.nombre,
    mo.nombre
  from public.invitacion_resena i
  join public.pago p on p.id = i.id_pago
  join public.monitoria m on m.id = p.id_monitoria
  join public.lead l on l.id = m.id_lead
  join public.monitor mo on mo.id = m.id_monitor
  where i.id_pago = p_id_pago;
$$;

comment on function public.datos_de_invitacion_resena(uuid) is
  'Datos del correo con el enlace de reseña de un pago (RN-72). Solo para el servidor (service_role). HU-035.';

revoke all on function public.datos_de_invitacion_resena(uuid) from public, anon, authenticated, service_role;
grant execute on function public.datos_de_invitacion_resena(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Lo que la app necesita para pintar la página del enlace
-- ---------------------------------------------------------------------------
-- estado: 'disponible' | 'ya_resenada' | 'no_disponible'. 'ya_resenada' gana sobre 'no_disponible'. Sin filas si el
-- token no existe. No trae datos de contacto ni del pago: solo lo que la página muestra.
create or replace function public.resena_por_token(p_token text)
returns table (
  estado text,
  nombre_monitor text,
  nombre_materia text,
  inicio timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    case
      when exists (select 1 from public.resena r where r.id_pago = p.id) then 'ya_resenada'
      when m.estado = 'realizada'
        and p.estado <> 'rechazado'
        and not exists (select 1 from public.monitoria_grupal g where g.id_monitoria = m.id) then 'disponible'
      else 'no_disponible'
    end,
    mo.nombre,
    ma.nombre,
    public.inicio_sesion(m.fecha, f.hora)
  from public.invitacion_resena i
  join public.pago p on p.id = i.id_pago
  join public.monitoria m on m.id = p.id_monitoria
  join public.franja f on f.id = m.id_franja
  join public.materia ma on ma.id = m.id_materia
  join public.monitor mo on mo.id = m.id_monitor
  where i.token = p_token;
$$;

comment on function public.resena_por_token(text) is
  'Estado del enlace de reseña y datos para pintar su página (RN-70, RN-72). Solo para el servidor (service_role). HU-035.';

revoke all on function public.resena_por_token(text) from public, anon, authenticated, service_role;
grant execute on function public.resena_por_token(text) to service_role;

-- ---------------------------------------------------------------------------
-- Guardar la reseña
-- ---------------------------------------------------------------------------
-- Resultado:
--   registrada     se guardó la reseña.
--   ya_resenada    el pago ya tiene reseña (RN-70: una por pago).
--   no_disponible  la monitoría no está realizada, es grupal o el pago fue rechazado.
--   no_existe      el token no corresponde a ninguna invitación.
-- Bloquea el pago (`for update`), así un rechazo o una segunda reseña simultáneos esperan y se evalúan de nuevo. La
-- calificación fuera de 1 a 5 o un comentario de más de 1000 caracteres los rechaza la restricción de `resena`
-- (check_violation); la app los valida antes. El comentario se recorta y, si queda vacío, se guarda nulo.
create or replace function public.registrar_resena(p_token text, p_calificacion integer, p_comentario text)
returns text
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_id_pago uuid;
  v_estado_pago public.estado_pago;
  v_estado_monitoria public.estado_monitoria;
  v_id_monitoria uuid;
begin
  select i.id_pago into v_id_pago
  from public.invitacion_resena i
  where i.token = p_token;
  if not found then
    return 'no_existe';
  end if;

  select p.estado, m.estado, m.id into v_estado_pago, v_estado_monitoria, v_id_monitoria
  from public.pago p
  join public.monitoria m on m.id = p.id_monitoria
  where p.id = v_id_pago
  for update of p;

  if exists (select 1 from public.resena r where r.id_pago = v_id_pago) then
    return 'ya_resenada';
  end if;
  if v_estado_monitoria <> 'realizada'
     or v_estado_pago = 'rechazado'
     or exists (select 1 from public.monitoria_grupal g where g.id_monitoria = v_id_monitoria) then
    return 'no_disponible';
  end if;

  begin
    insert into public.resena (id_pago, calificacion, comentario)
    values (v_id_pago, p_calificacion, nullif(btrim(p_comentario), ''));
  exception when unique_violation then
    return 'ya_resenada';
  end;
  return 'registrada';
end;
$$;

comment on function public.registrar_resena(text, integer, text) is
  'Guarda la reseña de un pago a partir del token del enlace (RN-70, RN-72, D-17). Solo para el servidor (service_role). HU-035.';

revoke all on function public.registrar_resena(text, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.registrar_resena(text, integer, text) to service_role;

-- cron.schedule con el mismo nombre reemplaza el trabajo: reaplicar la migración no lo duplica.
select cron.schedule('calibra-invitar-resenas', '*/5 * * * *', 'select privado.disparar_invitaciones_resena()');
