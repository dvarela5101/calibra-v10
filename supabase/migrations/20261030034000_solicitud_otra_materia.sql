-- La materia «Otra» de la solicitud del aspirante a monitor. HU-111 (D-80).
--
-- Quien pide la certificación puede escribir una materia que todavía no está en la lista, para que el equipo sepa
-- cuáles conviene agregar. El admin la lee en la tarjeta de la solicitud.
--
--   * Una sola columna de texto (D-80 b): si quiere varias, las escribe ahí separadas por comas. Nula si no escribió
--     ninguna. Una línea, sin espacios al borde, de 1 a 120 caracteres (D-80 a).
--   * «Otra» puede ser la única elección (D-80 c): la solicitud necesita al menos una materia de la lista o la otra.
--     Las 20 como máximo siguen contando solo las de la lista.
--   * Si la persona ya tiene una solicitud abierta, se devuelve esa sin cambiarla, como en HU-062 (D-80 e).
--   * La leen los admins con la política «admin lee» que ya existe; nadie la cambia con su sesión (el grant de update
--     de `authenticated` sigue siendo solo de estado e id_admin_actualizo).
-- Idempotente.

alter table public.solicitud_monitor add column if not exists otra_materia text;

alter table public.solicitud_monitor drop constraint if exists solicitud_monitor_otra_materia;
alter table public.solicitud_monitor add constraint solicitud_monitor_otra_materia check (
  otra_materia is null
  or (otra_materia = btrim(otra_materia) and char_length(otra_materia) between 1 and 120 and otra_materia !~ '[[:cntrl:]]')
);
comment on column public.solicitud_monitor.otra_materia is
  'Materia que el aspirante escribió porque no estaba en la lista (D-80), tal como la escribió. Nula si no escribió ninguna. HU-111.';

-- ---------------------------------------------------------------------------
-- Crear una solicitud (solo el servidor), ahora con la otra materia
-- ---------------------------------------------------------------------------
-- Parte de la versión de HU-062 (`20260930235808_solicitud_monitor.sql`). Lo único nuevo es `p_otra_materia`: se
-- guarda con la solicitud, y una solicitud sin materias de la lista sirve si trae la otra.
drop function if exists public.crear_solicitud_monitor(text, text, text, uuid[], timestamptz);

create or replace function public.crear_solicitud_monitor(
  p_nombre text,
  p_correo text,
  p_numero_telefono text,
  p_materias uuid[],
  p_fecha_consentimiento timestamptz,
  p_otra_materia text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_materias uuid[];
  v_id uuid;
begin
  -- Dos envíos a la vez de la misma persona se atienden uno detrás del otro, para no duplicarla.
  perform pg_advisory_xact_lock(hashtextextended('solicitud_monitor:' || coalesce(p_correo, ''), 0));
  perform pg_advisory_xact_lock(hashtextextended('solicitud_monitor:' || coalesce(p_numero_telefono, ''), 0));

  select coalesce(array_agg(distinct m), '{}') into v_materias from unnest(p_materias) as m where m is not null;
  if cardinality(v_materias) = 0 and p_otra_materia is null then
    raise exception 'Elige al menos una materia o escribe otra.' using errcode = 'check_violation';
  end if;
  if cardinality(v_materias) > 20 then
    raise exception 'Elige como máximo 20 materias.' using errcode = 'check_violation';
  end if;

  select s.id into v_id
  from public.solicitud_monitor s
  where (s.correo = p_correo or s.numero_telefono = p_numero_telefono)
    and s.abierta
  order by s.creada_en
  limit 1;
  if v_id is not null then
    return v_id;
  end if;

  -- El tope es de todos: las creaciones van de a una, para que dos envíos a la vez no lo pasen.
  perform pg_advisory_xact_lock(hashtextextended('solicitud_monitor:tope', 0));
  if (select count(*) from public.solicitud_monitor s where s.creada_en > now() - interval '1 hour') >= 30 then
    raise exception 'Recibimos muchas solicitudes en la última hora.' using errcode = 'program_limit_exceeded';
  end if;

  -- Una otra materia que no cumple `solicitud_monitor_otra_materia` hace fallar toda la solicitud.
  insert into public.solicitud_monitor (nombre, correo, numero_telefono, acepta_tratamiento_datos, fecha_consentimiento, otra_materia)
  values (p_nombre, p_correo, p_numero_telefono, true, p_fecha_consentimiento, p_otra_materia)
  returning id into v_id;

  -- Una materia que no existe hace fallar la llave foránea y, con ella, toda la solicitud.
  insert into public.solicitud_monitor_materia (id_solicitud, id_materia)
  select v_id, m from unnest(v_materias) as m;

  return v_id;
end;
$$;

revoke all on function public.crear_solicitud_monitor(text, text, text, uuid[], timestamptz, text) from public, anon, authenticated, service_role;
grant execute on function public.crear_solicitud_monitor(text, text, text, uuid[], timestamptz, text) to service_role;
