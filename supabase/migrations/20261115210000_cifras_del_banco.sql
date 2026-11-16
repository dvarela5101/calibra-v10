-- HU-134: las cifras reales del banco para la portada (visitante).
-- La portada decía a mano «8 materias, más de 250 preguntas, más de 400 errores típicos». Ahora salen de la base, con las mismas
-- definiciones que usa el servidor del diagnóstico (`privado.foto_del_banco`, HU-081) y el selector de /diagnostico (HU-009):
--   * materias: las que tienen al menos una Evaluación activa (`evaluacion.activa`), contadas una vez cada una;
--   * preguntas: las que el diagnóstico puede servir, es decir `estado = 'revisada'` y que miden alguna habilidad de los temas de
--     una Evaluación activa de su materia (`evaluacion_tema` → `habilidad` → `pregunta_habilidad`), contadas una vez cada una;
--   * errores: las misconcepciones distintas que delatan las opciones incorrectas de esas preguntas.
-- Las tablas del banco son solo de service_role. Un visitante anónimo no las lee, y no debe: la función devuelve únicamente
-- estos tres números, nada de enunciados, opciones ni claves. Sigue el patrón de `fechas_libres_de_materia`: la función
-- `security definer` vive en `privado` y su puerta en la Data API corre con los permisos de quien llama.
-- Idempotente.

create or replace function privado.cifras_del_banco()
returns table (materias integer, preguntas integer, errores integer)
language sql
stable
security definer
set search_path = ''
as $$
  with activas as (
    select e.id, e.id_materia
    from public.evaluacion e
    where e.activa
  ),
  servibles as (
    select distinct p.id, p.id_materia
    from activas a
    join public.evaluacion_tema et on et.id_evaluacion = a.id and et.id_materia = a.id_materia
    join public.habilidad h on h.id_tema = et.id_tema and h.id_materia = et.id_materia
    join public.pregunta_habilidad ph on ph.id_habilidad = h.id and ph.id_materia = h.id_materia
    join public.pregunta p on p.id = ph.id_pregunta and p.id_materia = ph.id_materia and p.estado = 'revisada'
  )
  select
    (select count(distinct a.id_materia) from activas a)::integer,
    (select count(*) from servibles)::integer,
    (
      select count(distinct o.id_misconcepcion)
      from servibles s
      join public.opcion o on o.id_pregunta = s.id and o.id_materia = s.id_materia
      where not o.correcta and o.id_misconcepcion is not null
    )::integer;
$$;

comment on function privado.cifras_del_banco() is
  'Cuántas materias con Evaluación activa, preguntas revisadas que el diagnóstico puede servir y errores típicos en ellas hay. Solo los tres conteos. HU-134.';

revoke all on function privado.cifras_del_banco() from public, anon, authenticated, service_role;
grant execute on function privado.cifras_del_banco() to anon, authenticated, service_role;

create or replace function public.cifras_del_banco()
returns table (materias integer, preguntas integer, errores integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.materias, c.preguntas, c.errores from privado.cifras_del_banco() c;
$$;

comment on function public.cifras_del_banco() is
  'Los tres conteos del banco que cita la portada (materias, preguntas, errores típicos), abiertos al visitante. HU-134.';

revoke all on function public.cifras_del_banco() from public, anon, authenticated, service_role;
grant execute on function public.cifras_del_banco() to anon, authenticated, service_role;
