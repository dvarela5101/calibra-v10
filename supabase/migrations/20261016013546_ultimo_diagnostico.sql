-- Mi último diagnóstico: lo que la portada muestra al volver. HU-011.
--
-- D-53 (10-oct-2026): d) al volver se ve solo el diagnóstico más reciente, de cualquier materia; e) una sesión ligada a un Lead
-- por el enlace de P-23 ve solo los diagnósticos de su propia sesión.
--
-- Reutiliza `privado.mi_diagnostico(uuid)` de HU-009 (20261011223500_leer_mi_diagnostico.sql): esta función solo elige el id y
-- delega en aquella, así que la salida de 8 columnas (nunca el repetido, la semilla, el token, las copias de las preguntas ni la
-- marca de falta de material; D-53 b) y la guarda de monitor y admin viven en un solo sitio. Las columnas se listan una por una
-- (no `r.*`): si una HU agrega una columna a `mi_diagnostico`, esta función no la deja pasar por accidente.
--
-- El orden de "último" es el de `agendar_monitoria` y el de `expirar_reservas`: la fecha y, en empate, el id, de mayor a menor.
-- Sin filtrar por materia, por Evaluación activa ni por `id_monitoria`: el que se hizo dentro de una grupal también cuenta, y una
-- Evaluación apagada o sin preguntas no cambia el resultado (sale de lo guardado).
--
-- Quién es el dueño: la sesión que hizo el diagnóstico (`id_sesion_anonima = auth.uid()`). A propósito NO `privado.es_mi_lead`
-- (D-53 e): esa función también deja pasar al Lead creado desde otra sesión y a las sesiones ligadas por `lead_sesion`, y con ella
-- la portada de quien escribió primero el correo de otra persona mostraría los diagnósticos de esa persona. Tampoco una cuenta de
-- Estudiante que sea otro usuario que la sesión que lo hizo, como sí hace `mi_diagnostico` por el Lead (D-55 c): esa cuenta tiene
-- su historial en HU-033, y en la portada ve lo que hizo su propia sesión. Una cuenta que nació de convertir esa misma sesión
-- (HU-032, `convertirAnonimoEnCuenta`: el id no cambia) sí es la dueña, porque `id_sesion_anonima = auth.uid()` se sigue
-- cumpliendo: lo recibe en cualquier navegador donde inicie sesión.
--
-- Sin diagnósticos terminados, `limit 1` no devuelve fila, la subconsulta da null y `mi_diagnostico(null)` no devuelve filas. Un
-- diagnóstico a medias vive en `diagnostico_en_curso` y esta función nunca lo lee.
--
-- Una función `security definer` en `privado` con un envoltorio `security invoker` en `public`: el patrón de `mis_citas`
-- (20261002064121_confirmacion_cita.sql). `auth.uid()` y `public.mi_rol()` (dentro de `mi_diagnostico`) leen el JWT de la
-- petición también dentro de dos funciones `security definer` anidadas. Solo lee: sin candados ni escrituras.
--
-- Solo agrega dos funciones: no redefine ninguna ni cambia la firma de ninguna.
-- Idempotente.

-- ---------------------------------------------------------------------------
-- La lectura del dueño (esquema privado)
-- ---------------------------------------------------------------------------
create or replace function privado.mi_ultimo_diagnostico()
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
  select r.id_diagnostico, r.codigo_materia, r.nombre_materia, r.nombre_evaluacion, r.fecha_realizacion, r.respondidas,
         r.aciertos, r.resultado
  from privado.mi_diagnostico((
    -- El más reciente de la propia sesión: la fecha y, en empate, el id (el orden de agendar_monitoria).
    select d.id
    from public.diagnostico d
    where d.id_sesion_anonima = (select auth.uid())
    order by d.fecha_realizacion desc, d.id desc
    limit 1
  )) r;
$$;

comment on function privado.mi_ultimo_diagnostico() is
  'El diagnóstico terminado más reciente de la sesión de quien llama (la fecha y, en empate, el id), de cualquier materia, con las 8 columnas de mi_diagnostico y su guarda de monitor y admin. Dueño: la sesión que lo hizo (también si ya se convirtió en cuenta de Estudiante con el mismo id), no las demás sesiones de su Lead ni una cuenta de Estudiante que sea otro usuario (D-53 d y e). HU-011.';

revoke all on function privado.mi_ultimo_diagnostico() from public, anon, authenticated, service_role;
grant execute on function privado.mi_ultimo_diagnostico() to authenticated;

-- ---------------------------------------------------------------------------
-- La puerta en la Data API
-- ---------------------------------------------------------------------------
create or replace function public.mi_ultimo_diagnostico()
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
  select u.id_diagnostico, u.codigo_materia, u.nombre_materia, u.nombre_evaluacion, u.fecha_realizacion, u.respondidas,
         u.aciertos, u.resultado
  from privado.mi_ultimo_diagnostico() u;
$$;

comment on function public.mi_ultimo_diagnostico() is
  'Mi último diagnóstico terminado (para la portada): materia, Evaluación, fecha, respondidas, aciertos y el resultado por habilidad. Solo de la sesión que lo hizo; sin fila si no tiene ninguno, y también para monitores y admins. Sin sesión, permiso denegado. HU-011.';

revoke all on function public.mi_ultimo_diagnostico() from public, anon, authenticated, service_role;
grant execute on function public.mi_ultimo_diagnostico() to authenticated;
