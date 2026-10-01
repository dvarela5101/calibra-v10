-- Avisos al monitor por correo. HU-051.
--
-- D-16 (1-oct-2026, resuelve P-11): el monitor recibe un correo cuando una monitoría individual suya queda
-- `confirmada` y cuando el estudiante cancela una confirmada. Las reservas por pagar no se avisan (pueden
-- vencer en 10 minutos), ni las que vencen sin pago. El correo lleva fecha, hora, duración, materia,
-- modalidad y el nombre del estudiante, nunca su contacto (P-37).
--
-- La monitoría pasa a confirmada en HU-018 y a cancelada por el estudiante en HU-024. Para no depender de
-- quién cambie el estado, un trigger anota el aviso en `aviso_monitor` en la misma transacción del cambio:
-- si el cambio se deshace, el aviso también. Después la app lo manda:
--
--   * El mismo trigger le pide a la app con pg_net que procese los avisos (`/api/procesos/avisar-monitores`).
--     pg_net envía la petición solo si la transacción se confirma, así que el correo sale en segundos.
--   * pg_cron repite el pedido cada 5 minutos si quedan avisos sin procesar: cubre una petición perdida.
--   * Un correo que falla queda `fallido` en `correo_envio` y lo reintenta el proceso de HU-065, que lo
--     reconstruye a partir de la monitoría. La clave del correo (`plantilla:id_monitoria`) impide mandarlo
--     dos veces aunque dos corridas tomen el mismo aviso.
--
-- La dirección de la app y el secreto viven en Vault (`calibra_sitio_url` y `calibra_cron_secreto`, como en
-- HU-065). Sin ellos el pedido no hace nada: así en local, y en la nube hasta el corte (HU-057).
-- Idempotente.

-- ---------------------------------------------------------------------------
-- Los avisos por mandar
-- ---------------------------------------------------------------------------
create table if not exists public.aviso_monitor (
  id uuid primary key default gen_random_uuid(),
  id_monitoria uuid not null references public.monitoria (id) on delete cascade,
  evento text not null,
  creado_en timestamptz not null default now(),
  -- La app ya lo tomó y lo dejó en `correo_envio` (enviado, fallido para reintentar o descartado), o lo abandonó.
  procesado_en timestamptz,
  -- Corridas en las que no se pudo procesar (error de la base o de los datos). La app lo abandona a las 5, para
  -- que un aviso que siempre falla no tape a los demás.
  intentos integer not null default 0,
  constraint aviso_monitor_evento_valido check (evento in ('confirmada', 'cancelada')),
  constraint aviso_monitor_intentos_no_negativos check (intentos >= 0),
  -- Un mismo aviso no se anota dos veces: los estados de una monitoría no vuelven atrás.
  constraint aviso_monitor_monitoria_evento_key unique (id_monitoria, evento)
);

comment on table public.aviso_monitor is
  'Avisos por correo al monitor (D-16): los anota un trigger de monitoria y los manda la app. HU-051.';

-- Lo que busca el proceso: los que faltan, del más antiguo al más reciente.
create index if not exists aviso_monitor_pendientes_idx on public.aviso_monitor (creado_en) where procesado_en is null;

-- Nadie con sesión la lee ni la escribe: el trigger inserta (security definer) y la app procesa con la
-- llave secreta, que solo marca `procesado_en` e `intentos`. Sin políticas, RLS niega todo a anon y authenticated.
alter table public.aviso_monitor enable row level security;
revoke all on table public.aviso_monitor from public, anon, authenticated, service_role;
grant select, update (procesado_en, intentos) on table public.aviso_monitor to service_role;

-- ---------------------------------------------------------------------------
-- Pedirle a la app que procese los avisos
-- ---------------------------------------------------------------------------
-- Solo si hay avisos sin procesar y la configuración está en Vault. Devuelve el id de la petición de pg_net,
-- o null si no pidió nada. security definer: lee Vault y usa pg_net, que no son de nadie más.
create or replace function privado.disparar_avisos_monitor()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sitio text;
  v_secreto text;
begin
  if not exists (select 1 from public.aviso_monitor where procesado_en is null) then
    return null;
  end if;

  select decrypted_secret into v_sitio from vault.decrypted_secrets where name = 'calibra_sitio_url';
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'calibra_cron_secreto';
  if coalesce(btrim(v_sitio), '') = '' or coalesce(btrim(v_secreto), '') = '' then
    return null;
  end if;

  return net.http_post(
    url := rtrim(btrim(v_sitio), '/') || '/api/procesos/avisar-monitores',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Authorization', 'Bearer ' || btrim(v_secreto), 'Content-Type', 'application/json'),
    timeout_milliseconds := 60000
  );
end;
$$;

revoke all on function privado.disparar_avisos_monitor() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- El trigger: anota el aviso al cambiar el estado
-- ---------------------------------------------------------------------------
-- Solo individuales: los avisos de las grupales llegan con sus HUs. Solo dos transiciones:
--   pendiente_pago → confirmada                     aviso 'confirmada'
--   confirmada → cancelada con motivo `estudiante`  aviso 'cancelada'
create or replace function privado.anotar_aviso_monitor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evento text;
begin
  if old.estado = 'pendiente_pago' and new.estado = 'confirmada' then
    v_evento := 'confirmada';
  elsif old.estado = 'confirmada' and new.estado = 'cancelada' and new.motivo_cancelacion = 'estudiante' then
    v_evento := 'cancelada';
  else
    return null;
  end if;

  if exists (select 1 from public.monitoria_grupal g where g.id_monitoria = new.id) then
    return null;
  end if;

  insert into public.aviso_monitor (id_monitoria, evento)
  values (new.id, v_evento)
  on conflict on constraint aviso_monitor_monitoria_evento_key do nothing;

  -- El pedido a la app nunca tumba el cambio de estado: si Vault o pg_net fallan (por ejemplo, una dirección mal
  -- escrita), el aviso queda anotado y pg_cron lo vuelve a pedir.
  begin
    perform privado.disparar_avisos_monitor();
  exception when others then
    raise warning 'calibra: no se pudo pedir el aviso al monitor (%): %', sqlstate, sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function privado.anotar_aviso_monitor() from public, anon, authenticated, service_role;

drop trigger if exists monitoria_anota_aviso_monitor on public.monitoria;
create trigger monitoria_anota_aviso_monitor
  after update of estado on public.monitoria
  for each row
  when (old.estado is distinct from new.estado)
  execute function privado.anotar_aviso_monitor();

-- ---------------------------------------------------------------------------
-- Lo que la app necesita para escribir el correo
-- ---------------------------------------------------------------------------
-- Con los permisos de quien llama: solo la llave secreta (service_role), que lee esas tablas. Devuelve el
-- correo del monitor para mandarle el aviso; del estudiante, solo el nombre (P-37). Sin filas si la
-- monitoría no existe.
create or replace function public.datos_de_aviso_monitor(p_id_monitoria uuid)
returns table (
  estado public.estado_monitoria,
  motivo_cancelacion public.motivo_cancelacion,
  grupal boolean,
  correo_monitor text,
  nombre_monitor text,
  nombre_estudiante text,
  nombre_materia text,
  inicio timestamptz,
  duracion_min integer,
  presencial boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    m.estado,
    m.motivo_cancelacion,
    exists (select 1 from public.monitoria_grupal g where g.id_monitoria = m.id),
    mp.correo,
    mo.nombre,
    l.nombre,
    ma.nombre,
    public.inicio_sesion(m.fecha, f.hora),
    f.duracion_min,
    f.presencial
  from public.monitoria m
  join public.franja f on f.id = m.id_franja
  join public.materia ma on ma.id = m.id_materia
  join public.monitor mo on mo.id = m.id_monitor
  join public.monitor_privado mp on mp.id_monitor = m.id_monitor
  join public.lead l on l.id = m.id_lead
  where m.id = p_id_monitoria;
$$;

comment on function public.datos_de_aviso_monitor(uuid) is
  'Datos del correo al monitor de una monitoría (D-16). Solo para el servidor (service_role). HU-051.';

revoke all on function public.datos_de_aviso_monitor(uuid) from public, anon, authenticated, service_role;
grant execute on function public.datos_de_aviso_monitor(uuid) to service_role;

-- cron.schedule con el mismo nombre reemplaza el trabajo: reaplicar la migración no lo duplica.
select cron.schedule('calibra-avisar-monitores', '*/5 * * * *', 'select privado.disparar_avisos_monitor()');
