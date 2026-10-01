-- Monitores certificados de una materia y sus fechas libres. HU-016.
--
-- RN-22: solo monitores con certificado en la materia. RN-30: las fechas salen de las franjas
-- semanales. RN-33: una fecha con una monitoría no cancelada está ocupada. RN-35 y P-40: se agenda con
-- al menos 3 h de antelación (con la exacta todavía se puede). HU-015: una franja recibe reservas desde
-- `abierta_desde` y hasta antes de `cerrada_desde`.
--
-- Por qué en la base: un visitante no lee `monitoria` (nadie ve las fechas ocupadas de otros) ni
-- ejecuta las funciones de plazos, y su primera página corre sin sesión (rol anon), porque la sesión
-- anónima nace después, en el navegador. La función security definer calcula lo libre y devuelve solo
-- lo público: monitor, franja, fecha, hora, duración, modalidad y precio. Nunca el teléfono, el correo
-- ni la llave del monitor (`monitor_privado`), ni el lugar ni el enlace de la franja (P-31).
--
-- `privado.fecha_libre` es la definición única de "esta fecha se puede agendar": la usa esta lista y
-- la usará la reserva (HU-017), para que lo que se muestra y lo que se acepta no discrepen.
-- Idempotente.

create or replace function privado.fecha_libre(p_id_franja uuid, p_fecha date, p_ahora timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.franja f
    where f.id = p_id_franja
      and extract(isodow from p_fecha) = f.dia
      and p_fecha >= f.abierta_desde
      and (f.cerrada_desde is null or p_fecha < f.cerrada_desde)
      and public.cumple_antelacion(public.inicio_sesion(p_fecha, f.hora), p_ahora, false)
      and not exists (
        select 1 from public.monitoria m
        where m.id_franja = f.id and m.fecha = p_fecha and m.estado <> 'cancelada'
      )
      -- Un monitor desactivado (cuenta suspendida en Auth) no recibe reservas.
      and not exists (
        select 1 from auth.users u
        where u.id = f.id_monitor and u.banned_until > p_ahora
      )
  );
$$;

revoke all on function privado.fecha_libre(uuid, date, timestamptz) from public, anon, authenticated, service_role;

-- Las fechas libres de las próximas `p_semanas` semanas (de 1 a 12), contando desde hoy en Bogotá.
-- Las candidatas se generan con enteros: generate_series sobre fechas da timestamptz y dependería de la
-- zona de la sesión.
create or replace function privado.fechas_libres_de_materia(p_codigo_materia text, p_semanas integer, p_ahora timestamptz)
returns table (
  id_monitor uuid, nombre_monitor text, id_franja uuid, fecha date,
  hora time, duracion_min integer, presencial boolean, precio integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with hoy as (select (p_ahora at time zone 'America/Bogota')::date as dia)
  select mo.id, mo.nombre, f.id, c.fecha, f.hora, f.duracion_min, f.presencial, f.precio
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

-- La puerta en la Data API: corre con los permisos de quien llama, como public.acceso_a_mis_franjas().
-- Siempre con la hora real: `p_ahora` solo existe en privado, para las pruebas. service_role no la
-- necesita (la página usa la sesión del visitante); si la reserva (HU-017) valida desde el servidor, que
-- llame a privado.fecha_libre desde su propia función definer.
create or replace function public.fechas_libres_de_materia(p_codigo_materia text, p_semanas integer)
returns table (
  id_monitor uuid, nombre_monitor text, id_franja uuid, fecha date,
  hora time, duracion_min integer, presencial boolean, precio integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select l.id_monitor, l.nombre_monitor, l.id_franja, l.fecha, l.hora, l.duracion_min, l.presencial, l.precio
  from privado.fechas_libres_de_materia(p_codigo_materia, p_semanas, now()) l;
$$;

comment on function public.fechas_libres_de_materia(text, integer) is
  'Monitores certificados en la materia (por código) y sus fechas libres de las próximas semanas, solo con lo público. HU-016.';

revoke all on function public.fechas_libres_de_materia(text, integer) from public, anon, authenticated, service_role;
grant execute on function public.fechas_libres_de_materia(text, integer) to anon, authenticated;
