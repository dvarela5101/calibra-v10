-- Cerrar la lectura de diagnóstico al dueño (D-53 e, D-55 c). HU-095.
--
-- La política de lectura de `diagnostico` (HU-002, HU-017; versión vigente en 20261001040929_agendar_monitoria.sql) dejaba
-- leer a cualquier sesión de un Lead (`privado.es_mi_lead`): la que creó el Lead y las ligadas por el enlace de P-23
-- (`lead_sesion`) leían por la Data API el puntaje y el resultado de los diagnósticos que hizo otra sesión del Lead. D-53 e
-- (10-oct-2026) dice que una sesión ve solo los diagnósticos de su propia sesión, y D-55 c que la cuenta de Estudiante ve
-- los de su Lead. La pantalla ya lo cumplía con `privado.mi_diagnostico` (20261011223500_leer_mi_diagnostico.sql, cuya
-- cabecera describe la política anterior); esta migración hace que la tabla diga lo mismo.
--
-- Cambia una sola rama de la política: `privado.es_mi_lead(id_lead)` pasa a `privado.es_cuenta_de_lead(id_lead)`, la
-- cuenta de Estudiante cuyo `id_lead` es ese (la misma comprobación de `mi_diagnostico`). Quedan igual el admin, la sesión
-- que hizo el diagnóstico, el monitor de la grupal (`dicta_monitoria`) y el monitor de la cita (`dicta_cita_con_diagnostico`,
-- D-7; quitarla es de HU-022, que después parte de esta política). No cambian los grants por columna, `privado.es_mi_lead`
-- ni las demás políticas que la usan (Lead, citas, pagos), ni la firma de ninguna función.
--
-- Nadie más pasa por esta política: las pantallas leen el resultado con `mi_diagnostico` o `resultado_por_token`, y
-- `agendar_monitoria`, `vistas_de_la_sesion` y el servidor del diagnóstico leen como definer o con la llave secreta.
--
-- Idempotente.

-- ---------------------------------------------------------------------------
-- ¿La sesión es la cuenta de Estudiante de ese Lead? (D-55 c)
-- ---------------------------------------------------------------------------
-- Definer para que la política no dependa de la RLS de `estudiante`. Como privado.es_admin y privado.dicta_monitoria.
create or replace function privado.es_cuenta_de_lead(p_id_lead uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.estudiante e
    where e.id = (select auth.uid()) and e.id_lead = p_id_lead
  );
$$;

comment on function privado.es_cuenta_de_lead(uuid) is
  'true si la sesión de quien llama es la cuenta de Estudiante del Lead dado (D-55 c). La usa la política de lectura de diagnostico. HU-095.';

revoke all on function privado.es_cuenta_de_lead(uuid) from public, anon, authenticated, service_role;
grant execute on function privado.es_cuenta_de_lead(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- La política de lectura: el dueño, el monitor de la cita o de la grupal, el admin
-- ---------------------------------------------------------------------------
-- Una sola política de lectura en la tabla (agendar.test.sql lo comprueba), con el mismo nombre.
drop policy if exists "dueno, monitor o admin leen" on public.diagnostico;
create policy "dueno, monitor o admin leen" on public.diagnostico
  for select to authenticated
  using (
    (select privado.es_admin())
    -- D-53 e: la sesión que hizo el diagnóstico...
    or id_sesion_anonima = (select auth.uid())
    -- ...o la cuenta de Estudiante de su Lead (D-55 c). A propósito no privado.es_mi_lead: abriría a la sesión que creó
    -- el Lead y a las ligadas por P-23.
    or (id_lead is not null and privado.es_cuenta_de_lead(id_lead))
    or (id_monitoria is not null and privado.dicta_monitoria(id_monitoria))
    or privado.dicta_cita_con_diagnostico(id)
  );

comment on policy "dueno, monitor o admin leen" on public.diagnostico is
  'Leen el diagnóstico: la sesión que lo hizo, la cuenta de Estudiante de su Lead (D-53 e, D-55 c), el monitor de la grupal o de la cita que apunta a él (D-7) y el admin. Ni la sesión que creó el Lead ni las ligadas por P-23 leen los de otra sesión. HU-095.';
