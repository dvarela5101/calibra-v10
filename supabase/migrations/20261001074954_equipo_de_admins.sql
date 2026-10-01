-- Equipo de admins: orden de revisión, desactivar y reasignar. HU-054.
--
-- RN-07: los admins revisan por turnos según `orden_revision`. RN-23: a un admin se le desactiva, nunca se le
-- borra; sus certificados y revisiones se conservan. Desactivar es banear su cuenta en Auth
-- (`desactivarCuenta()`, HU-004): `privado.es_admin()` deja de reconocerla al instante.
--
-- P-44 (29-sep-2026): al desactivar a un admin, sus reembolsos y reportes de inasistencia abiertos pasan al
-- siguiente admin activo según `orden_revision`, y ese los ve en su bandeja (HU-012 filtra por `id_admin`).
--
-- Aquí:
--   * `privado.siguiente_admin_activo(id)`: el turno. El admin activo que sigue a uno dado en el orden (vuelve al
--     primero al pasar el último), saltándose a los inactivos. Sin id, el primero activo. Lo usan la reasignación
--     y, más adelante, la asignación y el escalamiento de pagos (HU-018, HU-020).
--   * `public.reasignar_casos_de_admin(id)`: solo la llave secreta. La llama `desactivarCuenta()` antes de banear.
--   * `public.equipo_de_admins()` y `public.mover_admin(id, direccion)`: la pantalla del admin, con su sesión.
-- Idempotente.

-- ---------------------------------------------------------------------------
-- ¿Está activo? (lo mismo que mira es_admin, para cualquier admin)
-- ---------------------------------------------------------------------------
create or replace function privado.admin_activo(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin a
    join auth.users u on u.id = a.id
    where a.id = p_id
      and (u.banned_until is null or u.banned_until <= now())
  );
$$;

revoke all on function privado.admin_activo(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- El turno (RN-07)
-- ---------------------------------------------------------------------------
create or replace function privado.siguiente_admin_activo(p_despues_de uuid default null)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  with activos as (
    select a.id, a.orden_revision
    from public.admin a
    where privado.admin_activo(a.id)
      and a.id is distinct from p_despues_de
  ),
  desde as (
    select orden_revision from public.admin where id = p_despues_de
  )
  select coalesce(
    -- El primero activo después del dado...
    (select id from activos where activos.orden_revision > (select orden_revision from desde) order by orden_revision limit 1),
    -- ...o, al pasar el último (o sin id), el primero de la lista.
    (select id from activos order by orden_revision limit 1)
  );
$$;

revoke all on function privado.siguiente_admin_activo(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Reasignar los casos abiertos de un admin (P-44)
-- ---------------------------------------------------------------------------
-- Pasa sus reembolsos activos (esperando la llave o pendientes) y sus reportes en revisión al siguiente admin
-- activo. Devuelve cuántos casos movió. Si no tiene casos abiertos, no hace nada (0). Si los tiene y no hay otro
-- admin activo que los reciba, falla: mejor no desactivar que dejar casos sin dueño.
create or replace function privado.reasignar_casos_de_admin(p_id_admin uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_destino uuid;
  v_reembolsos integer;
  v_reportes integer;
begin
  if not exists (
    select 1 from public.reembolso where id_admin = p_id_admin and estado in ('esperando_llave', 'pendiente')
    union all
    select 1 from public.reporte_inasistencia where id_admin = p_id_admin and estado = 'en_revision'
  ) then
    return 0;
  end if;

  v_destino := privado.siguiente_admin_activo(p_id_admin);
  if v_destino is null then
    raise exception 'No hay otro admin activo que reciba los casos abiertos.' using errcode = 'P0001', hint = 'sin_otro_admin';
  end if;

  update public.reembolso set id_admin = v_destino
  where id_admin = p_id_admin and estado in ('esperando_llave', 'pendiente');
  get diagnostics v_reembolsos = row_count;

  update public.reporte_inasistencia set id_admin = v_destino
  where id_admin = p_id_admin and estado = 'en_revision';
  get diagnostics v_reportes = row_count;

  return v_reembolsos + v_reportes;
end;
$$;

revoke all on function privado.reasignar_casos_de_admin(uuid) from public, anon, authenticated, service_role;
grant execute on function privado.reasignar_casos_de_admin(uuid) to service_role;

-- La puerta de abajo corre con los permisos de service_role, que hasta ahora no entraba al esquema privado. Entrar
-- no le da nada más: cada función de privado está revocada para service_role salvo las que se le conceden, como esta.
grant usage on schema privado to service_role;

-- La puerta para el servidor: solo la llave secreta (desactivarCuenta).
create or replace function public.reasignar_casos_de_admin(p_id_admin uuid)
returns integer
language sql
volatile
security invoker
set search_path = ''
as $$
  select privado.reasignar_casos_de_admin(p_id_admin);
$$;

comment on function public.reasignar_casos_de_admin(uuid) is
  'P-44: pasa los reembolsos y reportes abiertos de un admin al siguiente activo. Solo service_role, antes de desactivarlo. HU-054.';

revoke all on function public.reasignar_casos_de_admin(uuid) from public, anon, authenticated, service_role;
grant execute on function public.reasignar_casos_de_admin(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- La pantalla del equipo: verlo y ordenarlo (solo admins activos)
-- ---------------------------------------------------------------------------
create or replace function privado.equipo_de_admins()
returns table (id uuid, nombre text, correo text, orden_revision integer, activo boolean, casos_abiertos integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    a.id,
    a.nombre,
    a.correo,
    a.orden_revision,
    privado.admin_activo(a.id),
    (
      (select count(*) from public.reembolso r where r.id_admin = a.id and r.estado in ('esperando_llave', 'pendiente'))
      + (select count(*) from public.reporte_inasistencia ri where ri.id_admin = a.id and ri.estado = 'en_revision')
    )::integer
  from public.admin a
  where (select privado.es_admin())
  order by a.orden_revision;
$$;

revoke all on function privado.equipo_de_admins() from public, anon, authenticated, service_role;
grant execute on function privado.equipo_de_admins() to authenticated;

create or replace function public.equipo_de_admins()
returns table (id uuid, nombre text, correo text, orden_revision integer, activo boolean, casos_abiertos integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from privado.equipo_de_admins();
$$;

comment on function public.equipo_de_admins() is
  'El equipo de admins en su orden de revisión, con quién está activo. Solo para un admin activo; a los demás, vacío. HU-054.';

revoke all on function public.equipo_de_admins() from public, anon, authenticated, service_role;
grant execute on function public.equipo_de_admins() to authenticated;

-- Sube o baja a un admin un puesto en el orden de revisión, intercambiándolo con su vecino (activo o no).
-- Resultado: movido, en_el_borde (ya es el primero o el último), no_encontrado, sin_permiso.
create or replace function privado.mover_admin(p_id uuid, p_direccion text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_orden integer;
  v_vecino uuid;
  v_orden_vecino integer;
begin
  if not (select privado.es_admin()) then
    return 'sin_permiso';
  end if;
  if p_direccion is null or p_direccion not in ('arriba', 'abajo') then
    raise exception 'Dirección inválida: %', p_direccion using errcode = '22023';
  end if;

  -- Toda la lista bloqueada: dos admins que mueven a la vez no se pisan.
  perform 1 from public.admin for update;

  select orden_revision into v_orden from public.admin where id = p_id;
  if not found then
    return 'no_encontrado';
  end if;

  if p_direccion = 'arriba' then
    select id, orden_revision into v_vecino, v_orden_vecino from public.admin
    where orden_revision < v_orden order by orden_revision desc limit 1;
  else
    select id, orden_revision into v_vecino, v_orden_vecino from public.admin
    where orden_revision > v_orden order by orden_revision limit 1;
  end if;
  if v_vecino is null then
    return 'en_el_borde';
  end if;

  -- Un solo UPDATE: la llave única es diferible, así que se comprueba al final de la sentencia.
  update public.admin
  set orden_revision = case when id = p_id then v_orden_vecino else v_orden end
  where id in (p_id, v_vecino);
  return 'movido';
end;
$$;

revoke all on function privado.mover_admin(uuid, text) from public, anon, authenticated, service_role;
grant execute on function privado.mover_admin(uuid, text) to authenticated;

create or replace function public.mover_admin(p_id uuid, p_direccion text)
returns text
language sql
volatile
security invoker
set search_path = ''
as $$
  select privado.mover_admin(p_id, p_direccion);
$$;

comment on function public.mover_admin(uuid, text) is
  'Un admin activo sube o baja a otro admin un puesto en el orden de revisión (RN-07). HU-054.';

revoke all on function public.mover_admin(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.mover_admin(uuid, text) to authenticated;
