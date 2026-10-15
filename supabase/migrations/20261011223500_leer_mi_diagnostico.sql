-- Leer mi diagnóstico: lo que la persona ve de un diagnóstico terminado. HU-009.
--
-- D-53 (10-oct-2026): b) el diagnóstico repetido no se le muestra a la persona; c) sí ve el puntaje global (los aciertos sobre
-- lo respondido); e) una sesión ligada a un Lead por el enlace de P-23 ve solo los diagnósticos de su propia sesión. D-55 c: la
-- cuenta de Estudiante ve los diagnósticos que otra sesión de su Lead dejó ligados al Lead.
--
-- Por qué una función y no un `select` con RLS: la política de lectura de `diagnostico` (20261001040929_agendar_monitoria.sql,
-- HU-017) deja leer a un admin, al monitor de la monitoría y al monitor de una cita que apunta al diagnóstico. Si la pantalla del
-- resultado leyera la tabla, el resultado de un estudiante se le mostraría como "Tu resultado" a un monitor o a un admin que abra
-- la dirección. Esta función es la lectura del dueño: filtra al dueño, descarta monitor y admin y devuelve solo lo que la persona
-- ve. Nunca devuelve `repetido`, la semilla, el token de recuperación, las copias de las preguntas ni la marca de falta de
-- material (D-53 b; las columnas sin grant de 20261005213333_servidor_diagnostico.sql).
--
-- Quién es el dueño: la sesión que hizo el diagnóstico (`id_sesion_anonima`) o la cuenta de Estudiante de su Lead
-- (`estudiante.id_lead`, la vía que HU-033 y D-55 c necesitan). A propósito NO `privado.es_mi_lead`: esa función también deja
-- pasar al Lead creado desde otra sesión y a las sesiones ligadas por el enlace de P-23 (`lead_sesion`), y D-53 e las deja fuera
-- (con ella, quien escribió primero el correo de otra persona vería sus diagnósticos). Esa regla vale igual para la dirección del
-- resultado y para el "último resultado" del mensaje de D-51. Si el último diagnóstico de la sesión o de su Lead lo hizo otra
-- sesión del Lead, esta función no devuelve fila y el mensaje de D-51 sale sin resultado, como prevé el criterio 16 de HU-009.
--
-- Una función `security definer` en `privado` con un envoltorio `security invoker` en `public`: el patrón de `mis_citas`
-- (20261002064121_confirmacion_cita.sql). La de `privado` lee `public.mi_rol()` por primera vez desde una función `security
-- definer`: `mi_rol()` es `security invoker` y dentro corre con el dueño de la función, pero `auth.uid()` y el JWT los sigue
-- tomando de la petición, así que devuelve lo mismo que para quien llama (lo prueban supabase/tests/leer_mi_diagnostico.test.sql).
--
-- Solo agrega dos funciones: no redefine ninguna ni cambia la firma de ninguna.
-- Idempotente.

-- ---------------------------------------------------------------------------
-- La lectura del dueño (esquema privado)
-- ---------------------------------------------------------------------------
create or replace function privado.mi_diagnostico(p_id uuid)
returns table (
  id_diagnostico uuid,
  codigo_materia text,
  nombre_materia text,
  nombre_evaluacion text,
  fecha_realizacion timestamptz,
  respondidas integer,
  aciertos integer,
  resultado jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, m.codigo, m.nombre, e.nombre, d.fecha_realizacion, d.respondidas, d.aciertos::integer, d.resultado_por_habilidad
  from public.diagnostico d
  join public.materia m on m.id = d.id_materia
  join public.evaluacion e on e.id = d.id_evaluacion and e.id_materia = d.id_materia
  where d.id = p_id
    -- Un monitor o un admin nunca ve el resultado como si fuera suyo, aunque la política de la tabla lo deje leer.
    and coalesce(public.mi_rol(), '') not in ('admin', 'monitor')
    and (
      -- D-53 e: la sesión que hizo el diagnóstico...
      d.id_sesion_anonima = (select auth.uid())
      -- ...o la cuenta de Estudiante de su Lead (D-55 c, HU-033). A propósito NO privado.es_mi_lead: incluiría al Lead creado
      -- desde otra sesión y a las sesiones ligadas por el enlace de P-23, que D-53 e deja fuera.
      or (d.id_lead is not null and exists (
        select 1 from public.estudiante est
        where est.id = (select auth.uid()) and est.id_lead = d.id_lead
      ))
    );
$$;

comment on function privado.mi_diagnostico(uuid) is
  'El diagnóstico terminado que la sesión de quien llama puede ver como suyo (la que lo hizo o la cuenta de Estudiante de su Lead; D-53 e, D-55 c), sin monitores ni admins. Solo lo que la persona ve: nunca repetido, semilla, token de recuperación, copias de las preguntas ni falta de material (D-53 b). HU-009.';

revoke all on function privado.mi_diagnostico(uuid) from public, anon, authenticated, service_role;
grant execute on function privado.mi_diagnostico(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- La puerta en la Data API
-- ---------------------------------------------------------------------------
create or replace function public.mi_diagnostico(p_id uuid)
returns table (
  id_diagnostico uuid,
  codigo_materia text,
  nombre_materia text,
  nombre_evaluacion text,
  fecha_realizacion timestamptz,
  respondidas integer,
  aciertos integer,
  resultado jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.id_diagnostico, r.codigo_materia, r.nombre_materia, r.nombre_evaluacion, r.fecha_realizacion, r.respondidas,
         r.aciertos, r.resultado
  from privado.mi_diagnostico(p_id) r;
$$;

comment on function public.mi_diagnostico(uuid) is
  'Mi diagnóstico terminado por id: materia, Evaluación, fecha, respondidas, aciertos y el resultado por habilidad. Solo el dueño (la sesión que lo hizo o la cuenta de Estudiante de su Lead); sin fila para cualquier otro, también monitores y admins. Sin sesión, permiso denegado. HU-009.';

revoke all on function public.mi_diagnostico(uuid) from public, anon, authenticated, service_role;
grant execute on function public.mi_diagnostico(uuid) to authenticated;
