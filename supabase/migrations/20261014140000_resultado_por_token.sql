-- Leer un diagnóstico por su token de recuperación: el enlace del correo que le llega al Lead. HU-031.
--
-- RN-12, D-20: el enlace no vence mientras existan el diagnóstico y su Lead, y abrirlo no liga el navegador a nadie. Lo abre
-- el servidor con la llave secreta (la página `/resultados` no crea sesión), así que la función es `security invoker` y solo
-- `service_role` la ejecuta, como `cita_por_token` (20261002064121_confirmacion_cita.sql).
--
-- Devuelve lo mismo que `privado.mi_diagnostico` (20261011223500_leer_mi_diagnostico.sql), la lectura del dueño de HU-009, y
-- nada más: nunca el token, la semilla, `repetido`, las copias de las preguntas, la marca de falta de material ni datos del
-- Lead. Exige `id_lead`: el enlace solo sale para un diagnóstico de un Lead, y un token de un diagnóstico sin Lead no sirve.
-- Si el Lead se borra, sus diagnósticos caen con él (`on delete cascade`) y el enlace deja de servir solo.
--
-- No filtra por la Evaluación activa: la página se arma con lo guardado, aunque la Evaluación se haya desactivado (criterio 9).
-- Un token mal formado, vacío o inventado no coincide con ninguno: cero filas, sin distinguir los casos.
--
-- Solo agrega una función: no redefine ninguna. Idempotente.

create or replace function public.resultado_por_token(p_token text)
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
  select d.id, m.codigo, m.nombre, e.nombre, d.fecha_realizacion, d.respondidas, d.aciertos::integer, d.resultado_por_habilidad
  from public.diagnostico d
  join public.materia m on m.id = d.id_materia
  join public.evaluacion e on e.id = d.id_evaluacion and e.id_materia = d.id_materia
  where d.token_recuperacion = p_token
    and d.id_lead is not null;
$$;

comment on function public.resultado_por_token(text) is
  'El diagnóstico de un token de recuperación (RN-12, D-20), con la misma proyección que mi_diagnostico y sin datos del Lead. Sin filas si el token no existe o el diagnóstico no tiene Lead. Solo para el servidor (service_role). HU-031.';

revoke all on function public.resultado_por_token(text) from public, anon, authenticated, service_role;
grant execute on function public.resultado_por_token(text) to service_role;
