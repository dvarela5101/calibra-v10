-- El enlace o el lugar de cada monitoría. HU-107.
--
-- D-76 (27-oct-2026, dvarela5101): la franja ya no pide lugar ni enlace (cambia lo que P-31 le pedía al monitor al crearla).
-- El monitor pone el enlace de la videollamada (virtual) o el lugar (presencial) de cada monitoría desde su agenda, y lo
-- cambia las veces que quiera hasta que termine. La página de la cita lo lee cada vez que se abre. Siguen D-5 y D-21 (el
-- estudiante lo ve solo con la cita confirmada) y D-23 (cambiarlo no manda correo). La modalidad sigue en la franja.
--
-- Por qué una tabla aparte y no dos columnas en `monitoria`: `authenticated` lee `monitoria` entera (con RLS), así que el
-- Lead leería el dato por la Data API antes de la cita confirmada. Como con el permiso por columna de `franja` (P-31), la
-- tabla nueva no tiene grants a `anon` ni `authenticated`: se lee y se escribe solo por funciones.
--
-- Las columnas `franja.lugar` y `franja.enlace` se quedan, sin uso desde la app: una monitoría nueva en una franja que aún
-- las tiene empieza con ese dato, y la migración copia el de las monitorías que ya existen. Quitarlas es otra HU.
-- Idempotente.

-- ---------------------------------------------------------------------------
-- La tabla
-- ---------------------------------------------------------------------------
create table if not exists public.lugar_de_monitoria (
  id_monitoria uuid primary key references public.monitoria (id) on delete cascade,
  lugar text,
  enlace text,
  actualizado_en timestamptz not null default now(),
  constraint lugar_de_monitoria_lugar_largo check (lugar is null or char_length(lugar) between 1 and 200),
  constraint lugar_de_monitoria_enlace_https check (enlace is null or (enlace ~ '^https://[^\s]+$' and char_length(enlace) <= 500)),
  -- Uno de los dos, nunca los dos: cuál depende de la modalidad de la franja, que revisa quien escribe.
  constraint lugar_de_monitoria_uno_solo check (num_nonnulls(lugar, enlace) = 1)
);

comment on table public.lugar_de_monitoria is
  'El lugar (presencial) o el enlace de la videollamada (virtual) de cada monitoría, que pone el monitor (D-76, HU-107).';

alter table public.lugar_de_monitoria enable row level security;
revoke all on table public.lugar_de_monitoria from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.lugar_de_monitoria to service_role;

-- ---------------------------------------------------------------------------
-- Una monitoría nueva empieza con el dato de su franja, si la franja aún lo tiene
-- ---------------------------------------------------------------------------
create or replace function privado.lugar_inicial_de_monitoria()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.lugar_de_monitoria (id_monitoria, lugar, enlace)
  select new.id,
         case when f.presencial then nullif(btrim(f.lugar), '') end,
         case when not f.presencial then nullif(btrim(f.enlace), '') end
  from public.franja f
  where f.id = new.id_franja
    and ((f.presencial and nullif(btrim(f.lugar), '') is not null)
         or (not f.presencial and nullif(btrim(f.enlace), '') is not null))
  on conflict (id_monitoria) do nothing;
  return new;
end;
$$;

revoke all on function privado.lugar_inicial_de_monitoria() from public, anon, authenticated, service_role;

drop trigger if exists monitoria_lugar_inicial on public.monitoria;
create trigger monitoria_lugar_inicial
  after insert on public.monitoria
  for each row execute function privado.lugar_inicial_de_monitoria();

-- Las monitorías que ya existían conservan el dato de su franja.
insert into public.lugar_de_monitoria (id_monitoria, lugar, enlace)
select m.id,
       case when f.presencial then nullif(btrim(f.lugar), '') end,
       case when not f.presencial then nullif(btrim(f.enlace), '') end
from public.monitoria m
join public.franja f on f.id = m.id_franja
where (f.presencial and nullif(btrim(f.lugar), '') is not null)
   or (not f.presencial and nullif(btrim(f.enlace), '') is not null)
on conflict (id_monitoria) do nothing;

-- ---------------------------------------------------------------------------
-- El monitor pone o cambia el dato de una monitoría suya
-- ---------------------------------------------------------------------------
-- security definer: escribe una tabla sin grants a `authenticated`. Solo el monitor que la dicta (auth.uid()), solo mientras
-- esté pendiente de pago o confirmada y no haya terminado, y con el dato que pide su modalidad. Los mensajes (P0001) son para
-- la persona: la app los muestra tal cual. `p_ahora` existe para las pruebas: la puerta pública siempre pasa now().
create or replace function privado.poner_lugar_de_monitoria(p_id_monitoria uuid, p_valor text, p_ahora timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_valor text := btrim(coalesce(p_valor, ''));
  v_monitor uuid;
  v_estado public.estado_monitoria;
  v_presencial boolean;
  v_fin timestamptz;
begin
  select m.id_monitor, m.estado, f.presencial,
         public.fin_programado(public.inicio_sesion(m.fecha, f.hora), f.duracion_min)
    into v_monitor, v_estado, v_presencial, v_fin
  from public.monitoria m
  join public.franja f on f.id = m.id_franja
  where m.id = p_id_monitoria
  for update of m;

  -- Una que no existe y una de otro monitor responden igual: nadie averigua qué monitorías hay.
  if v_monitor is null or v_monitor is distinct from (select auth.uid()) then
    raise exception 'No encontramos esa monitoría en tu agenda.' using errcode = 'P0001';
  end if;
  if v_estado not in ('pendiente_pago', 'confirmada') or p_ahora >= v_fin then
    raise exception 'Esa monitoría ya no está vigente: no se le puede cambiar el lugar ni el enlace.' using errcode = 'P0001';
  end if;

  if v_presencial then
    if v_valor = '' then
      raise exception 'Escribe el lugar de la sesión, por ejemplo el salón o el edificio.' using errcode = 'P0001';
    end if;
    if char_length(v_valor) > 200 then
      raise exception 'El lugar es demasiado largo: usa hasta 200 caracteres.' using errcode = 'P0001';
    end if;
  else
    if v_valor !~ '^https://[^\s]+$' or char_length(v_valor) > 500 then
      raise exception 'Escribe el enlace de la videollamada completo, que empiece por https://.' using errcode = 'P0001';
    end if;
  end if;

  insert into public.lugar_de_monitoria (id_monitoria, lugar, enlace, actualizado_en)
  values (
    p_id_monitoria,
    case when v_presencial then v_valor end,
    case when not v_presencial then v_valor end,
    p_ahora
  )
  on conflict (id_monitoria) do update
    set lugar = excluded.lugar, enlace = excluded.enlace, actualizado_en = excluded.actualizado_en;
end;
$$;

revoke all on function privado.poner_lugar_de_monitoria(uuid, text, timestamptz) from public, anon, authenticated, service_role;
grant execute on function privado.poner_lugar_de_monitoria(uuid, text, timestamptz) to authenticated;

-- La puerta en la Data API, con los permisos de quien llama y la hora real.
create or replace function public.poner_lugar_de_mi_monitoria(p_id_monitoria uuid, p_valor text)
returns void
language sql
security invoker
set search_path = ''
as $$
  select privado.poner_lugar_de_monitoria(p_id_monitoria, p_valor, now());
$$;

comment on function public.poner_lugar_de_mi_monitoria(uuid, text) is
  'El monitor de la sesión pone o cambia el lugar o el enlace de una monitoría suya vigente (D-76, HU-107).';

revoke all on function public.poner_lugar_de_mi_monitoria(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.poner_lugar_de_mi_monitoria(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- El monitor lee el dato de sus monitorías (para la agenda)
-- ---------------------------------------------------------------------------
-- Aparte de `mi_agenda()` para no cambiar su firma (HU-021): la agenda los junta por id.
create or replace function privado.lugares_de_mi_agenda()
returns table (id_monitoria uuid, lugar text, enlace text)
language sql
stable
security definer
set search_path = ''
as $$
  select lm.id_monitoria, lm.lugar, lm.enlace
  from public.lugar_de_monitoria lm
  join public.monitoria m on m.id = lm.id_monitoria
  where m.id_monitor = (select auth.uid());
$$;

revoke all on function privado.lugares_de_mi_agenda() from public, anon, authenticated, service_role;
grant execute on function privado.lugares_de_mi_agenda() to authenticated;

create or replace function public.lugares_de_mi_agenda()
returns table (id_monitoria uuid, lugar text, enlace text)
language sql
stable
security invoker
set search_path = ''
as $$
  select l.id_monitoria, l.lugar, l.enlace from privado.lugares_de_mi_agenda() l;
$$;

comment on function public.lugares_de_mi_agenda() is
  'El lugar o el enlace de las monitorías del monitor de la sesión que ya lo tienen (D-76, HU-107).';

revoke all on function public.lugares_de_mi_agenda() from public, anon, authenticated, service_role;
grant execute on function public.lugares_de_mi_agenda() to authenticated;

-- ---------------------------------------------------------------------------
-- La franja ya no exige lugar ni enlace (D-76 a)
-- ---------------------------------------------------------------------------
-- El mismo cuerpo de HU-015 sin las dos reglas que los pedían.
create or replace function privado.validar_franja_del_monitor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_inicio int := extract(epoch from new.hora)::int / 60;
  v_fin int := extract(epoch from new.hora)::int / 60 + new.duracion_min;
  v_cambia_horario boolean;
begin
  -- Las escrituras de confianza no pasan por las reglas del monitor: postgres (sin `set role` el valor es
  -- 'none') y service_role. Cualquier otro rol sí, así que un rol nuevo con permisos queda cubierto.
  -- PostgREST escribe como el monitor con `set role authenticated`. Se mira el rol de la base y no el del
  -- JWT: los claims pueden seguir puestos en una conexión que ya no escribe como la persona.
  if coalesce(current_setting('role', true), 'none') in ('none', 'postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;

  if new.id_monitor is distinct from (select auth.uid()) then
    raise exception 'Solo puedes manejar tus propias franjas.' using errcode = '42501';
  end if;

  -- Dos escrituras simultáneas del mismo monitor se revisan en fila: si no, las dos pasarían el
  -- chequeo de solapes antes de ver a la otra.
  perform pg_advisory_xact_lock(hashtextextended('franja:' || new.id_monitor::text, 0));

  if extract(second from new.hora) <> 0 then
    raise exception 'Escribe la hora en horas y minutos, por ejemplo 14:00.' using errcode = 'P0001';
  end if;
  if new.duracion_min <= 0 or v_fin > 24 * 60 then
    raise exception 'La franja debe terminar el mismo día: revisa la hora y la duración.' using errcode = 'P0001';
  end if;

  if tg_op = 'INSERT' then
    if not exists (select 1 from public.certificado c where c.id_monitor = new.id_monitor) then
      raise exception 'Para abrir franjas necesitas al menos un certificado. Un admin te certifica después de tu evaluación presencial.'
        using errcode = 'P0001';
    end if;
    new.abierta_desde := v_hoy;
    new.cerrada_desde := null;
  else
    if new.id_monitor is distinct from old.id_monitor or new.abierta_desde is distinct from old.abierta_desde then
      raise exception 'Esa parte de la franja no se puede cambiar.' using errcode = '42501';
    end if;

    if old.cerrada_desde is not null and old.cerrada_desde <= v_hoy then
      raise exception 'Esta franja ya está cerrada. Para volver a ofrecer ese horario, abre otra.' using errcode = 'P0001';
    end if;

    v_cambia_horario := new.dia is distinct from old.dia or new.hora is distinct from old.hora
      or new.duracion_min is distinct from old.duracion_min;
    if v_cambia_horario and exists (
      select 1 from public.monitoria m where m.id_franja = old.id and m.estado <> 'cancelada'
    ) then
      raise exception 'No puedes cambiar el día, la hora ni la duración de una franja que ya tiene monitorías: sus horarios dependen de ella. Ciérrala y abre otra con el horario nuevo; si se cruza con esta, podrás abrirla cuando esta ya esté cerrada.'
        using errcode = 'P0001';
    end if;

    if new.presencial is distinct from old.presencial and exists (
      select 1 from public.monitoria m where m.id_franja = old.id and m.estado <> 'cancelada' and m.fecha >= v_hoy
    ) then
      raise exception 'No puedes cambiar entre presencial y virtual mientras la franja tenga monitorías agendadas.'
        using errcode = 'P0001';
    end if;

    if new.cerrada_desde is distinct from old.cerrada_desde and new.cerrada_desde is not null then
      if new.cerrada_desde < v_hoy then
        raise exception 'La franja se cierra desde hoy o desde una fecha futura.' using errcode = 'P0001';
      end if;
      if exists (
        select 1 from public.monitoria m
        where m.id_franja = old.id and m.estado <> 'cancelada' and m.fecha >= new.cerrada_desde
      ) then
        raise exception 'No puedes cerrarla desde esa fecha: tiene monitorías agendadas ese día o después. Ciérrala desde el día siguiente a la última.'
          using errcode = 'P0001';
      end if;
    end if;
  end if;

  -- Sin solapes con otra franja del mismo monitor que siga abierta (P-30).
  if (new.cerrada_desde is null or new.cerrada_desde > v_hoy) and exists (
    select 1 from public.franja f
    where f.id_monitor = new.id_monitor
      and f.id <> new.id
      and f.dia = new.dia
      and (f.cerrada_desde is null or f.cerrada_desde > v_hoy)
      and int4range(extract(epoch from f.hora)::int / 60, extract(epoch from f.hora)::int / 60 + f.duracion_min)
          && int4range(v_inicio, v_fin)
  ) then
    raise exception 'Se cruza con otra de tus franjas abiertas el mismo día.' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- El correo de confirmación y la página de la cita leen el dato de la monitoría
-- ---------------------------------------------------------------------------
-- Los mismos cuerpos de HU-019 y HU-029, con el lugar y el enlace de `lugar_de_monitoria` en vez de los de la franja. Mismas
-- firmas: `create or replace` conserva los permisos. Sin dato salen nulos, y la app dice que el monitor aún no lo ha puesto.
create or replace function public.datos_de_confirmacion_cita(p_id_monitoria uuid)
returns table (
  token text,
  creada_en timestamptz,
  estado public.estado_monitoria,
  grupal boolean,
  correo_destino text,
  nombre_lead text,
  nombre_monitor text,
  nombre_materia text,
  inicio timestamptz,
  duracion_min integer,
  presencial boolean,
  lugar text,
  enlace text,
  valor_total integer,
  cancelable_hasta timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    c.token,
    c.creada_en,
    m.estado,
    g.id_monitoria is not null,
    coalesce(
      l.correo,
      (select p.contacto from public.pago p where p.id_monitoria = m.id order by p.fecha_pago, p.id limit 1)
    ),
    l.nombre,
    mo.nombre,
    ma.nombre,
    t.inicio,
    f.duracion_min,
    f.presencial,
    lm.lugar,
    lm.enlace,
    m.valor_total,
    public.cancelable_hasta(t.inicio, g.id_monitoria is not null)
  from public.confirmacion_cita c
  join public.monitoria m on m.id = c.id_monitoria
  join public.franja f on f.id = m.id_franja
  left join public.lugar_de_monitoria lm on lm.id_monitoria = m.id
  join public.materia ma on ma.id = m.id_materia
  join public.monitor mo on mo.id = m.id_monitor
  join public.lead l on l.id = m.id_lead
  left join public.monitoria_grupal g on g.id_monitoria = m.id
  cross join lateral (select public.inicio_sesion(m.fecha, f.hora) as inicio) t
  where c.id_monitoria = p_id_monitoria;
$$;

create or replace function privado.datos_de_cita(p_id_monitoria uuid)
returns table (
  id_lead uuid,
  id_monitoria uuid,
  estado public.estado_monitoria,
  motivo_cancelacion public.motivo_cancelacion,
  nombre_monitor text,
  nombre_materia text,
  codigo_materia text,
  fecha date,
  hora time,
  duracion_min integer,
  presencial boolean,
  valor_total integer,
  lugar text,
  enlace text,
  inicio timestamptz,
  fin_programado timestamptz,
  cancelable_hasta timestamptz,
  reporte_hasta timestamptz,
  estado_pago text,
  estado_reembolso text,
  estado_reporte text,
  observaciones_reporte text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.id_lead,
    m.id,
    m.estado,
    m.motivo_cancelacion,
    mo.nombre,
    ma.nombre,
    ma.codigo,
    m.fecha,
    f.hora,
    f.duracion_min,
    f.presencial,
    m.valor_total,
    case when m.estado = 'confirmada' then lm.lugar end,
    case when m.estado = 'confirmada' then lm.enlace end,
    t.inicio,
    t.fin,
    public.cancelable_hasta(t.inicio, false),
    public.reporte_inasistencia_hasta(t.fin),
    pa.estado_pago,
    re.estado_reembolso,
    rp.estado_reporte,
    rp.observaciones_reporte
  from public.monitoria m
  join public.franja f on f.id = m.id_franja
  left join public.lugar_de_monitoria lm on lm.id_monitoria = m.id
  join public.materia ma on ma.id = m.id_materia
  join public.monitor mo on mo.id = m.id_monitor
  cross join lateral (
    select public.inicio_sesion(m.fecha, f.hora) as inicio,
           public.fin_programado(public.inicio_sesion(m.fecha, f.hora), f.duracion_min) as fin
  ) t
  cross join lateral (
    select case
      when bool_or(p.estado = 'rechazado') then 'rechazado'
      when bool_or(p.estado = 'en_revision') then 'en_revision'
      when bool_or(p.estado = 'aprobado') then 'aprobado'
      else 'sin_pagar'
    end as estado_pago
    from public.pago p
    where p.id_monitoria = m.id
  ) pa
  cross join lateral (
    select case
      when bool_or(r.estado = 'esperando_llave') then 'esperando_llave'
      when bool_or(r.estado = 'pendiente') then 'pendiente'
      when bool_or(r.estado = 'reembolsado') then 'reembolsado'
    end as estado_reembolso
    from public.reembolso r
    join public.pago p on p.id = r.id_pago
    where p.id_monitoria = m.id
  ) re
  left join lateral (
    select r.estado::text as estado_reporte,
           case when r.estado <> 'en_revision' then nullif(btrim(r.observaciones, E' \t\r\n'), '') end as observaciones_reporte
    from public.reporte_inasistencia r
    where r.id_monitoria = m.id
  ) rp on true
  where m.id = p_id_monitoria
    and not exists (select 1 from public.monitoria_grupal g where g.id_monitoria = m.id);
$$;
