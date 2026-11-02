-- Franja de prueba: el admin marca una franja y quien la agende recibe la monitoría confirmada y gratis. HU-119.
--
-- D-85 (dvarela5101, 2-nov-2026): (a) el admin marca la franja de prueba antes de que se reserve; (b) el estudiante la ve desde el
-- listado como una oferta (precio normal tachado y «Gratis»); (c) agendar una fecha de esa franja crea la monitoría ya
-- confirmada y gratis, sin pago; (d) como D-84: el precio no cambia (`> 0`), sin desembolso, reembolso ni ingreso.
-- Supuestos (HU-119 e–g): la marca vale para las fechas nuevas mientras esté puesta; una gratis por Lead (prueba_ya_usada); queda
-- registro de quién marcó y desmarcó.
--
-- La marca vive en una tabla aparte (`franja_de_prueba`) y no en una columna de `franja`: el trigger de franja
-- (privado.validar_franja_del_monitor) solo deja que el monitor toque sus propias franjas, y un admin que cambiara la fila
-- chocaría con él. Una fila = marcada; sin fila = normal.
-- Idempotente: db:verificar reaplica cada migración sobre la base final.

-- ---------------------------------------------------------------------------
-- La marca y su registro
-- ---------------------------------------------------------------------------
create table if not exists public.franja_de_prueba (
  id_franja uuid primary key references public.franja (id) on delete cascade,
  id_admin uuid not null references public.admin (id),
  marcada_en timestamptz not null default now()
);
create index if not exists franja_de_prueba_id_admin_idx on public.franja_de_prueba (id_admin);

comment on table public.franja_de_prueba is
  'Franjas que un admin marcó de prueba (D-85): agendar una de sus fechas crea la monitoría confirmada y gratis. Una fila = marcada. La leen todos (el agendador la muestra como oferta) y solo la escribe privado.marcar_franja_de_prueba. HU-119.';

create table if not exists public.marca_franja_prueba (
  id uuid primary key default gen_random_uuid(),
  id_franja uuid not null references public.franja (id) on delete cascade,
  id_admin uuid not null references public.admin (id),
  de_prueba boolean not null,
  hecha_en timestamptz not null default now()
);
create index if not exists marca_franja_prueba_id_franja_idx on public.marca_franja_prueba (id_franja, hecha_en desc);
create index if not exists marca_franja_prueba_id_admin_idx on public.marca_franja_prueba (id_admin);

comment on table public.marca_franja_prueba is
  'Cada vez que un admin marcó una franja de prueba o le quitó la marca (D-85): quién y cuándo. Solo la leen los admins. La escribe privado.marcar_franja_de_prueba. HU-119.';
comment on column public.marca_franja_prueba.de_prueba is 'true: la marcó de prueba; false: le quitó la marca.';

alter table public.franja_de_prueba enable row level security;
alter table public.marca_franja_prueba enable row level security;
revoke all on table public.franja_de_prueba from public, anon, authenticated, service_role;
revoke all on table public.marca_franja_prueba from public, anon, authenticated, service_role;
grant select on table public.franja_de_prueba to authenticated, service_role;
grant select on table public.marca_franja_prueba to authenticated, service_role;

drop policy if exists "todos leen" on public.franja_de_prueba;
create policy "todos leen" on public.franja_de_prueba for select to authenticated using (true);
drop policy if exists "admin lee" on public.marca_franja_prueba;
create policy "admin lee" on public.marca_franja_prueba
  for select to authenticated
  using ((select privado.es_admin()));

-- ---------------------------------------------------------------------------
-- Marcar y desmarcar (dos capas)
-- ---------------------------------------------------------------------------
-- Resultado: marcada, desmarcada, sin_sesion, sin_permiso (no es un admin activo), pedido_invalido (algún dato nulo),
-- no_existe (no hay franja), ya_marcada, no_marcada. Solo `marcada` y `desmarcada` escriben. El admin del registro es auth.uid().
create or replace function privado.marcar_franja_de_prueba(p_id_franja uuid, p_de_prueba boolean)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_marcada boolean;
begin
  if v_uid is null then
    return 'sin_sesion';
  end if;
  if not (select privado.es_admin()) then
    return 'sin_permiso';
  end if;
  if p_id_franja is null or p_de_prueba is null then
    return 'pedido_invalido';
  end if;

  -- Bloqueada la franja, como agendar_monitoria: una marca y una reserva a la vez quedan en fila.
  perform 1 from public.franja f where f.id = p_id_franja for update;
  if not found then
    return 'no_existe';
  end if;
  if not privado.admin_activo(v_uid) then
    return 'sin_permiso';
  end if;

  v_marcada := exists (select 1 from public.franja_de_prueba p where p.id_franja = p_id_franja);
  if p_de_prueba and v_marcada then
    return 'ya_marcada';
  end if;
  if not p_de_prueba and not v_marcada then
    return 'no_marcada';
  end if;

  if p_de_prueba then
    insert into public.franja_de_prueba (id_franja, id_admin) values (p_id_franja, v_uid);
  else
    delete from public.franja_de_prueba where id_franja = p_id_franja;
  end if;
  insert into public.marca_franja_prueba (id_franja, id_admin, de_prueba) values (p_id_franja, v_uid, p_de_prueba);
  return case when p_de_prueba then 'marcada' else 'desmarcada' end;
end;
$$;

comment on function privado.marcar_franja_de_prueba(uuid, boolean) is
  'Un admin activo marca una franja de prueba o le quita la marca, con su registro (D-85). La sesión entra por public.marcar_franja_de_prueba. HU-119.';

revoke all on function privado.marcar_franja_de_prueba(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function privado.marcar_franja_de_prueba(uuid, boolean) to authenticated;

create or replace function public.marcar_franja_de_prueba(p_id_franja uuid, p_de_prueba boolean)
returns text
language sql
volatile
security invoker
set search_path = ''
as $$
  select privado.marcar_franja_de_prueba(p_id_franja, p_de_prueba);
$$;

comment on function public.marcar_franja_de_prueba(uuid, boolean) is
  'Un admin activo marca una franja de prueba (agendarla crea la monitoría confirmada y gratis) o le quita la marca (D-85). HU-119.';

revoke all on function public.marcar_franja_de_prueba(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.marcar_franja_de_prueba(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Las franjas abiertas para la pantalla del admin
-- ---------------------------------------------------------------------------
-- Solo un admin activo recibe filas. Sin precio de comisión: solo lo que ya es público de la franja.
create or replace function privado.franjas_para_admin()
returns table (
  id_franja uuid, nombre_monitor text, dia smallint, hora time, duracion_min integer,
  presencial boolean, precio integer, de_prueba boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id, mo.nombre, f.dia, f.hora, f.duracion_min, f.presencial, f.precio,
         exists (select 1 from public.franja_de_prueba p where p.id_franja = f.id)
  from public.franja f
  join public.monitor mo on mo.id = f.id_monitor
  where (select privado.es_admin())
    and (f.cerrada_desde is null or f.cerrada_desde > (now() at time zone 'America/Bogota')::date)
  order by mo.nombre, f.dia, f.hora, f.id;
$$;

revoke all on function privado.franjas_para_admin() from public, anon, authenticated, service_role;
grant execute on function privado.franjas_para_admin() to authenticated;

create or replace function public.franjas_para_admin()
returns table (
  id_franja uuid, nombre_monitor text, dia smallint, hora time, duracion_min integer,
  presencial boolean, precio integer, de_prueba boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from privado.franjas_para_admin();
$$;

comment on function public.franjas_para_admin() is
  'Las franjas abiertas con su monitor y si están marcadas de prueba, para el admin (D-85). Sin filas para quien no es un admin activo. HU-119.';

revoke all on function public.franjas_para_admin() from public, anon, authenticated, service_role;
grant execute on function public.franjas_para_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- La lista de fechas libres dice si la franja es de prueba (D-85 b)
-- ---------------------------------------------------------------------------
-- `create or replace` no deja cambiar las columnas de salida: se borran las dos y se recrean con sus permisos. El cuerpo es el
-- de 20261001034154_fechas_libres_de_materia.sql con `de_prueba` al final.
drop function if exists public.fechas_libres_de_materia(text, integer);
drop function if exists privado.fechas_libres_de_materia(text, integer, timestamptz);

create function privado.fechas_libres_de_materia(p_codigo_materia text, p_semanas integer, p_ahora timestamptz)
returns table (
  id_monitor uuid, nombre_monitor text, id_franja uuid, fecha date,
  hora time, duracion_min integer, presencial boolean, precio integer, de_prueba boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with hoy as (select (p_ahora at time zone 'America/Bogota')::date as dia)
  select mo.id, mo.nombre, f.id, c.fecha, f.hora, f.duracion_min, f.presencial, f.precio,
         exists (select 1 from public.franja_de_prueba p where p.id_franja = f.id)
  from public.materia ma
  join public.certificado ce on ce.id_materia = ma.id
  join public.monitor mo on mo.id = ce.id_monitor
  join public.franja f on f.id_monitor = mo.id
  cross join hoy
  cross join lateral (
    select hoy.dia + (f.dia - extract(isodow from hoy.dia)::integer + 7) % 7 + 7 * n as fecha
    from generate_series(0, least(greatest(coalesce(p_semanas, 1), 1), 12) - 1) as n
  ) c
  where lower(ma.codigo) = lower(btrim(p_codigo_materia))
    and privado.fecha_libre(f.id, c.fecha, p_ahora)
  order by c.fecha, f.hora, mo.nombre, f.id;
$$;

revoke all on function privado.fechas_libres_de_materia(text, integer, timestamptz) from public, anon, authenticated, service_role;
grant execute on function privado.fechas_libres_de_materia(text, integer, timestamptz) to anon, authenticated;

create function public.fechas_libres_de_materia(p_codigo_materia text, p_semanas integer)
returns table (
  id_monitor uuid, nombre_monitor text, id_franja uuid, fecha date,
  hora time, duracion_min integer, presencial boolean, precio integer, de_prueba boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select l.id_monitor, l.nombre_monitor, l.id_franja, l.fecha, l.hora, l.duracion_min, l.presencial, l.precio, l.de_prueba
  from privado.fechas_libres_de_materia(p_codigo_materia, p_semanas, now()) l;
$$;

comment on function public.fechas_libres_de_materia(text, integer) is
  'Monitores certificados en la materia (por código) y sus fechas libres de las próximas semanas, solo con lo público, y si la franja es de prueba. HU-016, HU-119.';

revoke all on function public.fechas_libres_de_materia(text, integer) from public, anon, authenticated, service_role;
grant execute on function public.fechas_libres_de_materia(text, integer) to anon, authenticated;

-- La lectura de `franja_de_prueba` la hace el rol que llama a las funciones de arriba solo por ellas (security definer); la tabla
-- queda legible para authenticated por su política. anon no la lee directo.

-- ---------------------------------------------------------------------------
-- Agendar en una franja de prueba (D-85 c)
-- ---------------------------------------------------------------------------
-- privado.agendar_monitoria de 20261002063603_expirar_reservas.sql (HU-119 suma lo marcado así; lo demás es igual a HU-027 y HU-017). HU-027:
-- el UPDATE marcado con HU-027,
-- después de bloquear la franja y antes de revisar la fecha libre. Sin él, fecha_libre daría la fecha por libre y el
-- insert chocaría con el índice único (ocupada). También deja al mismo Lead volver a pedir la fecha de su reserva
-- vencida. Los resultados y la firma no cambian.
create or replace function privado.agendar_monitoria(
  p_id_franja uuid,
  p_fecha date,
  p_codigo_materia text,
  p_acepta_sin_cancelacion boolean
)
returns table (resultado text, id_monitoria uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_ahora timestamptz := now();
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_id_lead uuid;
  v_pendiente_id uuid;
  v_pendiente_franja uuid;
  v_pendiente_fecha date;
  v_id_materia uuid;
  v_id_monitor uuid;
  v_dia smallint;
  v_hora time;
  v_precio integer;
  v_inicio timestamptz;
  v_id_diagnostico uuid;
  v_id uuid;
  v_de_prueba boolean;
begin
  if v_uid is null then
    resultado := 'sin_sesion';
    return next;
    return;
  end if;

  -- El Lead de la sesión, como privado.es_mi_lead: la sesión que lo creó, una que confirmó su correo o la
  -- cuenta de Estudiante que salió de él. Las cuentas del equipo nunca son Lead (HU-068).
  select x.id into v_id_lead
  from (
    select l.id from public.lead l where l.id_sesion_anonima = v_uid
    union all
    select s.id_lead from public.lead_sesion s where s.id_sesion = v_uid
    union all
    select e.id_lead from public.estudiante e where e.id = v_uid
  ) x
  limit 1;
  if v_id_lead is null then
    resultado := 'no_es_lead';
    return next;
    return;
  end if;

  -- D-8: en fila las reservas del mismo Lead, para que dos pestañas no aparten dos fechas a la vez.
  perform 1 from public.lead l where l.id = v_id_lead for update;

  select m.id, m.id_franja, m.fecha into v_pendiente_id, v_pendiente_franja, v_pendiente_fecha
  from public.monitoria m
  where m.id_lead = v_id_lead
    and m.estado = 'pendiente_pago'
    and public.dentro_de_plazo(public.reserva_hasta(m.fecha_creacion), v_ahora)
  order by m.fecha_creacion desc
  limit 1;
  if v_pendiente_id is not null then
    resultado := case
      when v_pendiente_franja = p_id_franja and v_pendiente_fecha = p_fecha then 'ya_agendada'
      else 'reserva_pendiente'
    end;
    id_monitoria := v_pendiente_id;
    return next;
    return;
  end if;

  -- La materia por su código, como la lista de HU-016 (sin distinguir mayúsculas; la exacta primero).
  select ma.id into v_id_materia
  from public.materia ma
  where lower(ma.codigo) = lower(btrim(p_codigo_materia))
  order by (ma.codigo = btrim(p_codigo_materia)) desc, ma.id
  limit 1;

  -- `for update` pone en fila a quienes agendan esta franja y al monitor que la cambia o la cierra (HU-015):
  -- cada uno lee lo que dejó el anterior.
  select f.id_monitor, f.dia, f.hora, f.precio into v_id_monitor, v_dia, v_hora, v_precio
  from public.franja f
  where f.id = p_id_franja
  for update;

  if v_id_monitor is null
     or v_id_materia is null
     or p_fecha is null
     or not exists (
       select 1 from public.certificado c where c.id_monitor = v_id_monitor and c.id_materia = v_id_materia
     )
     or p_fecha < v_hoy
     or p_fecha >= v_hoy + 7 * privado.semanas_para_agendar() then
    resultado := 'no_disponible';
    return next;
    return;
  end if;

  -- HU-027: la reserva vencida de esta franja y fecha se cancela aquí, sin esperar al proceso de cada minuto. Con la
  -- franja bloqueada nadie más agenda esta fecha a la vez. Si su Lead la está pagando, este UPDATE espera el bloqueo
  -- de la fila y, si quedó confirmada, la salta, como el proceso (privado.expirar_reservas).
  update public.monitoria m
  set estado = 'cancelada', motivo_cancelacion = 'reserva_expirada'
  where m.id_franja = p_id_franja
    and m.fecha = p_fecha
    and m.estado = 'pendiente_pago'
    and privado.reserva_vencida(m.id, m.estado, m.fecha_creacion, v_ahora);

  if not privado.fecha_libre(p_id_franja, p_fecha, v_ahora) then
    resultado := case
      when exists (
        select 1 from public.monitoria m
        where m.id_franja = p_id_franja and m.fecha = p_fecha and m.estado <> 'cancelada'
      ) then 'ocupada'
      when extract(isodow from p_fecha) = v_dia
        and not public.cumple_antelacion(public.inicio_sesion(p_fecha, v_hora), v_ahora, false) then 'sin_antelacion'
      else 'no_disponible'
    end;
    return next;
    return;
  end if;

  -- HU-119 (D-85): ¿la franja está marcada de prueba? Si sí, quien ya tuvo una monitoría gratis no la repite; el Lead ya está
  -- bloqueado arriba (D-8), así que dos pedidos a la vez del mismo Lead se ponen en fila.
  select exists (select 1 from public.franja_de_prueba p where p.id_franja = p_id_franja) into v_de_prueba;
  if v_de_prueba and exists (
    select 1 from public.monitoria m where m.id_lead = v_id_lead and m.gratis and m.estado <> 'cancelada'
  ) then
    resultado := 'prueba_ya_usada';
    return next;
    return;
  end if;

  -- RN-37 y D-10: con menos de 12 h (pasado cancelable_hasta) hace falta la casilla.
  v_inicio := public.inicio_sesion(p_fecha, v_hora);
  if not public.dentro_de_plazo(public.cancelable_hasta(v_inicio, false), v_ahora)
     and not coalesce(p_acepta_sin_cancelacion, false) then
    resultado := 'confirmar_sin_cancelacion';
    return next;
    return;
  end if;

  -- P-35 y D-7: el diagnóstico más reciente de la materia, de este Lead o de esta sesión, esté o no ligado
  -- a otra cita.
  select d.id into v_id_diagnostico
  from public.diagnostico d
  where d.id_materia = v_id_materia
    and (d.id_lead = v_id_lead or d.id_sesion_anonima = v_uid)
  order by d.fecha_realizacion desc, d.id desc
  limit 1;

  begin
    insert into public.monitoria (
      id_franja, id_monitor, id_materia, id_lead, fecha, estado, valor_total, id_diagnostico
    ) values (
      p_id_franja, v_id_monitor, v_id_materia, v_id_lead, p_fecha, 'pendiente_pago', v_precio, v_id_diagnostico
    )
    returning id into v_id;
  exception when unique_violation then
    -- RN-33: la otra persona confirmó primero.
    resultado := 'ocupada';
    return next;
    return;
  end;

  -- HU-119 (D-85 c): en una franja de prueba la monitoría nace por pagar y pasa de una vez a confirmada y gratis, como la
  -- marca de HU-116: los triggers de siempre anotan la confirmación al estudiante y el aviso al monitor. Sin pago ni
  -- desembolso, y valor_total conserva el precio normal.
  if v_de_prueba then
    update public.monitoria set gratis = true, estado = 'confirmada' where id = v_id;
  end if;

  resultado := 'agendada';
  id_monitoria := v_id;
  return next;
end;
$$;

revoke all on function privado.agendar_monitoria(uuid, date, text, boolean) from public, anon, authenticated, service_role;
grant execute on function privado.agendar_monitoria(uuid, date, text, boolean) to authenticated;

