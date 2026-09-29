-- Roles y cuentas. HU-004.
--
-- El rol sale de las tablas del modelo, no de claims editables:
--   admin      -> fila en public.admin y cuenta no desactivada
--   monitor    -> fila en public.monitor
--   estudiante -> fila en public.estudiante
--   anonimo    -> sesión anónima de Supabase Auth (is_anonymous en el JWT)
-- Desactivar una cuenta es banearla en Auth (RN-23): la fila y sus certificados,
-- pagos y revisiones se conservan, pero deja de contar como admin.
-- Idempotente.

-- Un admin desactivado deja de ser admin para las políticas aunque su token siga vigente.
create or replace function privado.es_admin()
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
    where a.id = (select auth.uid())
      and (u.banned_until is null or u.banned_until <= now())
  );
$$;

-- Rol de quien llama, para que la app decida rutas. Corre con los permisos de quien
-- llama (security invoker): cada tabla ya limita qué filas puede ver.
create or replace function public.mi_rol()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when (select auth.uid()) is null then null
    when (select privado.es_admin()) then 'admin'
    when exists (select 1 from public.monitor m where m.id = (select auth.uid())) then 'monitor'
    when exists (select 1 from public.estudiante e where e.id = (select auth.uid())) then 'estudiante'
    when coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) then 'anonimo'
    else null
  end;
$$;

-- Borrar una identidad (sesión anónima vieja, HU-056, o supresión de datos) borra sus
-- diagnósticos. Con "on delete set null" el borrado chocaba con diagnostico_tiene_dueno
-- y el usuario no se podía borrar. La limpieza solo borra sesiones sin lead.
alter table public.diagnostico drop constraint if exists diagnostico_id_sesion_anonima_fkey;
alter table public.diagnostico
  add constraint diagnostico_id_sesion_anonima_fkey
  foreign key (id_sesion_anonima) references auth.users (id) on delete cascade;

revoke all on function public.mi_rol() from public, anon;
grant execute on function public.mi_rol() to authenticated;

-- La llave secreta (rol service_role) solo la usa el servidor: alta y desactivación
-- de cuentas, procesos programados y pruebas. Desde el 30-oct-2026 la Data API no
-- expone nada sin GRANT explícito (auto_expose_new_tables = false), tampoco a service_role.
do $$
declare
  t text;
begin
  foreach t in array array[
    'admin', 'lead', 'estudiante', 'monitor', 'monitor_privado', 'perfil_monitor',
    'materia', 'evaluacion', 'certificado', 'franja', 'monitoria', 'monitoria_grupal',
    'diagnostico', 'pago', 'desembolso', 'reembolso', 'reporte_inasistencia', 'resena'
  ] loop
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end $$;
