-- Limpieza de sesiones anónimas antiguas. HU-056.
--
-- P-13 (29-sep-2026): las sesiones anónimas sin contacto se borran, con sus diagnósticos, a los 90 días sin actividad.
-- P-40: los bordes de los plazos son inclusivos (con 90 días justos no se borra; con 90 días y un segundo, sí).
-- D-63 b (10-oct-2026): cuenta como actividad cualquier visita que renueve la sesión, más hacer un diagnóstico.
--
-- Diseño (registro de HU-056):
--   * La última actividad de una sesión es la más reciente entre su alta, su último inicio de sesión, la última
--     renovación de su sesión de Auth (el proxy la renueva en cada visita; el token dura una hora, así que la precisión
--     es de una hora) y su último diagnóstico terminado.
--   * Solo se borran sesiones anónimas que no son de nadie: ni de un Lead (la que lo creó, una que confirmó su correo
--     con el enlace de P-23 o la de su cuenta de Estudiante), ni de un monitor, ni de un admin. Borrar la sesión de un
--     Lead se llevaría, por la cascada de diagnostico.id_sesion_anonima, los diagnósticos ya ligados a él.
--   * El borrado de cada sesión toma el candado por sesión de registrar_lead (6801) sin esperar y, con el candado
--     tomado, vuelve a comprobar que sigue vencida y sin dueño. Una sesión que justo está dejando su contacto queda
--     para el día siguiente.
--   * El candado dura hasta el final de la corrida (pg_advisory_xact_lock). Para no llenar la tabla de candados, cada
--     corrida borra a lo sumo 1000 sesiones, las más viejas primero; las demás quedan para el día siguiente
--     (supuesto de la implementación).
--   * Si una sesión no se puede borrar (por ejemplo, una llave foránea sin cascada que agregue una HU futura), se salta,
--     se avisa en el log solo con su id y se sigue con las demás.
--   * Solo la corre pg_cron (como postgres): ninguna sesión ni el servidor la ejecutan ni consultan las vencidas.
-- No redefine ninguna función existente.
-- Idempotente.

-- ---------------------------------------------------------------------------
-- Parámetros de retención (P-13)
-- ---------------------------------------------------------------------------
create or replace function public.parametros_retencion()
returns table (
  sesion_anonima_dias integer
)
language sql
stable
parallel safe
set search_path = ''
as $$
  select
    90    -- sesion_anonima_dias: días sin actividad tras los que se borra una sesión sin contacto (P-13)
$$;

comment on function public.parametros_retencion() is
  'P-13: plazos de retención. sesion_anonima_dias es el único lugar del plazo de las sesiones sin contacto; el aviso de privacidad lo copia (DIAS_SESION_ANONIMA) y una prueba de integración compara los dos. HU-056.';

revoke all on function public.parametros_retencion() from public, anon, authenticated, service_role;
grant execute on function public.parametros_retencion() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- De quién es una sesión
-- ---------------------------------------------------------------------------
-- true si la sesión es de un Lead (lead.id_sesion_anonima, lead_sesion o estudiante, como privado.es_mi_lead), de un
-- monitor o de un admin.
create or replace function privado.sesion_tiene_dueno(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.lead l where l.id_sesion_anonima = p_id)
      or exists (select 1 from public.lead_sesion s where s.id_sesion = p_id)
      or exists (select 1 from public.estudiante e where e.id = p_id)
      or exists (select 1 from public.monitor m where m.id = p_id)
      or exists (select 1 from public.admin a where a.id = p_id);
$$;

revoke all on function privado.sesion_tiene_dueno(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- La última actividad de una sesión (D-63 b)
-- ---------------------------------------------------------------------------
-- auth.sessions.refreshed_at es un timestamp sin zona que Auth escribe en UTC; updated_at sí tiene zona.
create or replace function privado.ultima_actividad_de_sesion(p_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    u.created_at,
    u.last_sign_in_at,
    (select max(greatest(s.refreshed_at at time zone 'utc', s.updated_at)) from auth.sessions s where s.user_id = u.id),
    (select max(d.fecha_realizacion) from public.diagnostico d where d.id_sesion_anonima = u.id)
  )
  from auth.users u
  where u.id = p_id;
$$;

revoke all on function privado.ultima_actividad_de_sesion(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Las sesiones vencidas a una fecha
-- ---------------------------------------------------------------------------
-- Anónimas, sin dueño y con la última actividad antes de p_ahora - plazo (con el plazo justo no vence, P-40).
create or replace function privado.sesiones_anonimas_vencidas(p_ahora timestamptz)
returns table (
  id uuid,
  ultima_actividad timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select v.id, v.ultima_actividad
  from (
    select u.id, privado.ultima_actividad_de_sesion(u.id) as ultima_actividad
    from auth.users u
    where u.is_anonymous
      and not privado.sesion_tiene_dueno(u.id)
  ) v
  where v.ultima_actividad < p_ahora - make_interval(days => (select p.sesion_anonima_dias from public.parametros_retencion() p));
$$;

revoke all on function privado.sesiones_anonimas_vencidas(timestamptz) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Borrar una sesión vencida
-- ---------------------------------------------------------------------------
-- true si la borró. false si el candado de la sesión está tomado (alguien está dejando su contacto) o si, con el
-- candado tomado, ya no está vencida o ya tiene dueño. Borrarla de auth.users se lleva en cascada sus diagnósticos,
-- su fila de lead_sesion (no tiene, por ser sin dueño) y sus correos anotados de HU-075.
create or replace function privado.borrar_sesion_vencida(p_id uuid, p_ahora timestamptz)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not pg_try_advisory_xact_lock(6801, hashtext(p_id::text)) then
    return false;
  end if;

  if not exists (
    select 1
    from auth.users u
    where u.id = p_id
      and u.is_anonymous
      and not privado.sesion_tiene_dueno(u.id)
      and privado.ultima_actividad_de_sesion(u.id)
        < p_ahora - make_interval(days => (select p.sesion_anonima_dias from public.parametros_retencion() p))
  ) then
    return false;
  end if;

  delete from auth.users u where u.id = p_id;
  return found;
end;
$$;

revoke all on function privado.borrar_sesion_vencida(uuid, timestamptz) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- La limpieza diaria
-- ---------------------------------------------------------------------------
-- Devuelve cuántas sesiones borró. Correrla dos veces seguidas no borra nada la segunda.
create or replace function privado.limpiar_sesiones_anonimas(p_ahora timestamptz)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_borradas integer := 0;
begin
  for v_id in
    select v.id
    from privado.sesiones_anonimas_vencidas(p_ahora) v
    order by v.ultima_actividad, v.id
    limit 1000
  loop
    begin
      if privado.borrar_sesion_vencida(v_id, p_ahora) then
        v_borradas := v_borradas + 1;
      end if;
    exception when others then
      -- Solo el id y el código del error: ningún dato personal en el log.
      raise warning 'limpiar_sesiones_anonimas: se saltó la sesión % (SQLSTATE %)', v_id, sqlstate;
    end;
  end loop;

  return v_borradas;
end;
$$;

revoke all on function privado.limpiar_sesiones_anonimas(timestamptz) from public, anon, authenticated, service_role;

-- cron.schedule con el mismo nombre reemplaza el trabajo: reaplicar la migración no lo duplica. pg_cron usa UTC:
-- 08:23 son las 03:23 en Bogotá, lejos de los trabajos de los minutos 17 y 47 de cada hora.
select cron.schedule(
  'calibra-limpiar-sesiones-anonimas',
  '23 8 * * *',
  'select privado.limpiar_sesiones_anonimas(now())'
);
