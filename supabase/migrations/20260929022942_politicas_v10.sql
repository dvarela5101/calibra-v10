-- Políticas de acceso del modelo v10. HU-002.
--
-- Principios:
--   * RLS en todas las tablas. Sin política, no hay acceso.
--   * Permisos explícitos: no se depende de los privilegios por defecto del proyecto.
--   * Esta migración solo abre LECTURAS. Cada HU de flujo agrega sus escrituras
--     (políticas o funciones), con los permisos que necesite.
--   * Una sola política de lectura por tabla (las permisivas múltiples se evalúan
--     todas en cada consulta). Los admins leen todo.
--   * Lectura pública (anon y authenticated): materia, evaluacion, franja, monitor,
--     perfil_monitor y certificado (con qué materias está certificado cada monitor).
--   * Las sesiones anónimas de Supabase Auth usan el rol authenticated, así que
--     "anónimo" se distingue por el dueño de la fila, no por el rol.
-- Idempotente: se puede volver a aplicar.

grant usage on schema privado to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Funciones auxiliares (security definer, en un esquema no expuesto)
-- ---------------------------------------------------------------------------
create or replace function privado.es_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admin a where a.id = (select auth.uid()));
$$;

-- El lead es de quien lo creó desde su sesión anónima o del estudiante que salió de él.
create or replace function privado.es_mi_lead(p_id_lead uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.lead l
    where l.id = p_id_lead
      and (
        l.id_sesion_anonima = (select auth.uid())
        or exists (
          select 1 from public.estudiante e
          where e.id = (select auth.uid()) and e.id_lead = l.id
        )
      )
  );
$$;

-- Quien agendó la monitoría (su lead) o el monitor que la dicta.
create or replace function privado.participa_en_monitoria(p_id_monitoria uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.monitoria m
    where m.id = p_id_monitoria
      and (m.id_monitor = (select auth.uid()) or privado.es_mi_lead(m.id_lead))
  );
$$;

create or replace function privado.dicta_monitoria(p_id_monitoria uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.monitoria m
    where m.id = p_id_monitoria and m.id_monitor = (select auth.uid())
  );
$$;

revoke all on function privado.es_admin() from public;
revoke all on function privado.es_mi_lead(uuid) from public;
revoke all on function privado.participa_en_monitoria(uuid) from public;
revoke all on function privado.dicta_monitoria(uuid) from public;
grant execute on function privado.es_admin() to anon, authenticated;
grant execute on function privado.es_mi_lead(uuid) to anon, authenticated;
grant execute on function privado.participa_en_monitoria(uuid) to anon, authenticated;
grant execute on function privado.dicta_monitoria(uuid) to anon, authenticated;

revoke all on function privado.completar_monitoria() from public, anon, authenticated;
revoke all on function privado.completar_diagnostico() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS y permisos por tabla
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  p record;
begin
  foreach t in array array[
    'admin', 'lead', 'estudiante', 'monitor', 'monitor_privado', 'perfil_monitor',
    'materia', 'evaluacion', 'certificado', 'franja', 'monitoria', 'monitoria_grupal',
    'diagnostico', 'pago', 'desembolso', 'reembolso', 'reporte_inasistencia', 'resena'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    -- Parte de cero en cada aplicación: esta migración es la dueña de las lecturas.
    for p in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = t and cmd = 'SELECT'
    loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
  end loop;

  -- Lectura pública.
  foreach t in array array['materia', 'evaluacion', 'franja', 'monitor', 'perfil_monitor', 'certificado'] loop
    execute format('grant select on table public.%I to anon, authenticated', t);
    execute format('create policy "lectura publica" on public.%I for select to anon, authenticated using (true)', t);
  end loop;

  -- El resto solo lo lee authenticated; la política dice qué filas.
  foreach t in array array[
    'admin', 'lead', 'estudiante', 'monitor_privado', 'monitoria', 'monitoria_grupal',
    'diagnostico', 'pago', 'desembolso', 'reembolso', 'reporte_inasistencia', 'resena'
  ] loop
    execute format('grant select on table public.%I to authenticated', t);
  end loop;

  -- Solo admins. Los pagos tienen el contacto de cada pagador (RN-52: el organizador
  -- ve nombres, no contactos) y los desembolsos la comisión (P-32 sin decidir), así
  -- que las vistas para estudiantes y monitores llegan con sus HUs.
  foreach t in array array['admin', 'pago', 'desembolso', 'reembolso', 'reporte_inasistencia', 'resena'] loop
    execute format(
      'create policy "admin lee" on public.%I for select to authenticated using ((select privado.es_admin()))',
      t
    );
  end loop;
end $$;

-- Dueños de sus propios datos (y admins) -----------------------------------------

create policy "dueno o admin lee" on public.lead
  for select to authenticated
  using ((select privado.es_admin()) or privado.es_mi_lead(id));

create policy "dueno o admin lee" on public.estudiante
  for select to authenticated
  using ((select privado.es_admin()) or id = (select auth.uid()));

create policy "dueno o admin lee" on public.monitor_privado
  for select to authenticated
  using ((select privado.es_admin()) or id_monitor = (select auth.uid()));

-- Quien agendó y el monitor que la dicta ven la monitoría.
create policy "participantes o admin leen" on public.monitoria
  for select to authenticated
  using (
    (select privado.es_admin())
    or id_monitor = (select auth.uid())
    or privado.es_mi_lead(id_lead)
  );

create policy "participantes o admin leen" on public.monitoria_grupal
  for select to authenticated
  using ((select privado.es_admin()) or privado.participa_en_monitoria(id_monitoria));

-- El diagnóstico lo ve quien lo hizo (sesión o lead) y el monitor de la monitoría
-- que orienta: RN-13 autoriza compartirlo con él.
create policy "dueno, monitor o admin leen" on public.diagnostico
  for select to authenticated
  using (
    (select privado.es_admin())
    or id_sesion_anonima = (select auth.uid())
    or (id_lead is not null and privado.es_mi_lead(id_lead))
    or (id_monitoria is not null and privado.dicta_monitoria(id_monitoria))
  );
