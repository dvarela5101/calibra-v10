-- Pruebas pgTAP de mi último diagnóstico (HU-011): public.mi_ultimo_diagnostico() y privado.mi_ultimo_diagnostico().
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.
--
-- Lo que se prueba: que elige el diagnóstico más reciente de la propia sesión (la fecha y, en empate, el id; de cualquier materia),
-- y no el de otra sesión, ni el de otra sesión del mismo Lead, ni el primero insertado, ni el de la materia de nombre menor, ni el
-- de id mayor; que lo devuelve tal cual lo devuelve privado.mi_diagnostico (8 columnas, ni repetido, ni semilla, ni token, ni las
-- copias de las preguntas, ni falta de material); que quien no hizo el diagnóstico no recibe nada (D-53 e: la sesión ligada por
-- lead_sesion, la que creó el Lead, la cuenta de Estudiante que es otro usuario, el monitor de la cita, el admin y el monitor o el
-- admin que además son la sesión dueña); que la cuenta de Estudiante que nació de convertir la propia sesión (HU-032 conserva el
-- id) sí es la dueña y recibe el suyo, no el de otra sesión de su Lead; que un diagnóstico a medias no cuenta; que el hecho en una
-- grupal sí; que la Evaluación apagada no cambia nada; y que el visitante sin sesión y la llave secreta no la ejecutan.
--
-- Elenco (ids terminados en 0011NN; las fechas son fijas):
--   sesiones c0000000-...-0011NN: 01 dueña (ligada al Lead 1 por lead_sesion; tres diagnósticos), 02 otra sin relación, 03 ligada al
--     Lead 1 por lead_sesion con su propio diagnóstico, 04 la que creó el Lead 1 (sin diagnósticos), 05 monitor con una cita que
--     apunta al diagnóstico ganador de la 01, 06 admin que además es la sesión dueña de un diagnóstico, 07 monitor que además es la
--     sesión dueña de un diagnóstico, 08 cuenta de Estudiante del Lead 1, 09 solo con un diagnóstico en curso, 10 sin nada, 11 dos
--     diagnósticos de la misma fecha exacta, 12 con su diagnóstico más reciente hecho dentro de una grupal, 13 una cuenta de
--     Estudiante que nació de convertir su sesión (mismo id; creó el Lead 3 y hizo f3), 14 otra sesión del Lead 3 (lead_sesion) con
--     un diagnóstico más reciente (f4).
--   Materias 10000000-...-0011NN: 01 (Alfa) y 02 (Beta), con códigos, nombres y nombres de Evaluación distintos entre sí y el
--     nombre de la 02 ordenado después del de la 01. Evaluaciones 20000000-...-0011NN: 01 de la materia 01 y 02 de la materia 02,
--     las dos activas al empezar. Leads 40000000-...-0011NN: 01 (lo creó la sesión 04), 02 (el de las citas) y 03 (lo creó la 13).
--   Diagnósticos 60000000-...-0011XX (XX en hexadecimal): la 01 tiene b3 (materia 01, 2-oct), b1 (materia 02, 5-oct: el ganador y
--     el id más chico, insertado en medio) y b2 (materia 01, 3-oct), en ese orden de inserción; c2 es de la 02 (6-oct 15:30, el más
--     reciente de todos), c3 de la 03 (6-oct 03:30), 0a y ff de la 11 (4-oct 12:00; el menor se inserta primero), e6 del admin
--     06, e7 del monitor 07, d1 y d2 de la 12 (d2 es de la grupal), f3 de la 13 (3-oct) y f4 de la 14 (7-oct), los dos del Lead 3.

begin;
create extension if not exists pgtap with schema extensions;

select plan(72);

-- Lo que el diagnóstico b1 guarda como resultado por habilidad, para compararlo con lo que devuelve la función.
create temporary table esperado as select
  '{"habilidades":[{"habilidad":"regla-cadena","descripcion":"Derivar una función compuesta","nivel":"en_proceso","respuestas":3,"aciertos":2},{"habilidad":"potencia","descripcion":"Derivar una potencia","nivel":"sin_medir","respuestas":0,"aciertos":0}],"errores":[{"misconcepcion":"olvida-cadena","habilidad":"regla-cadena","descripcionHabilidad":"Derivar una función compuesta","texto":"Olvidas multiplicar por la derivada de adentro","estado":"confirmada","veces":2,"detalles":["error propio de la opción"]}],"prerrequisitos":[{"materia":null,"habilidad":"potencia","descripcion":"Derivar una potencia"}]}'::jsonb as resultado;
grant select on esperado to authenticated;

-- ---------------------------------------------------------------------------
-- Fixtures (como postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, is_anonymous)
select ('c0000000-0000-0000-0000-0000000011' || lpad(n::text, 2, '0'))::uuid, n in (1, 2, 3, 4, 9, 10, 11, 12, 14)
from generate_series(1, 14) n;

insert into public.admin (id, nombre, correo, orden_revision) values
  ('c0000000-0000-0000-0000-000000001106', 'Admin dueño HU-011', 'admin11@example.com', 11000061);
insert into public.monitor (id, nombre) values
  ('c0000000-0000-0000-0000-000000001105', 'Monitor con cita HU-011'),
  ('c0000000-0000-0000-0000-000000001107', 'Monitor dueño HU-011');

insert into public.materia (id, nombre, codigo) values
  ('10000000-0000-0000-0000-000000001101', 'Materia Once Alfa', 'PGTAP-11-A'),
  ('10000000-0000-0000-0000-000000001102', 'Materia Once Beta', 'PGTAP-11-B');
-- Activas: una Evaluación vigente (nada la ata a las preguntas). Más abajo se apagan para probar que el resultado sale igual.
insert into public.evaluacion (id, id_materia, semana, nombre, activa) values
  ('20000000-0000-0000-0000-000000001101', '10000000-0000-0000-0000-000000001101', 5, 'Parcial Once Uno', true),
  ('20000000-0000-0000-0000-000000001102', '10000000-0000-0000-0000-000000001102', 7, 'Parcial Once Dos', true);

-- Lead 1: lo creó la sesión 04; la 01 y la 03 confirmaron su correo (lead_sesion); la 08 es su cuenta de Estudiante.
insert into public.lead (id, id_sesion_anonima, nombre, correo, acepta_tratamiento_datos, fecha_consentimiento) values
  ('40000000-0000-0000-0000-000000001101', 'c0000000-0000-0000-0000-000000001104', 'Lead Uno HU-011', 'lead11-1@example.com', true, now()),
  ('40000000-0000-0000-0000-000000001102', null, 'Lead Dos HU-011', 'lead11-2@example.com', true, now());
insert into public.lead_sesion (id_sesion, id_lead) values
  ('c0000000-0000-0000-0000-000000001101', '40000000-0000-0000-0000-000000001101'),
  ('c0000000-0000-0000-0000-000000001103', '40000000-0000-0000-0000-000000001101');
insert into public.estudiante (id, id_lead) values
  ('c0000000-0000-0000-0000-000000001108', '40000000-0000-0000-0000-000000001101');

-- Lead 3: lo creó la sesión 13, que después se convirtió en cuenta de Estudiante CONSERVANDO su id (HU-032, convertirAnonimoEnCuenta:
-- el usuario de Auth es el mismo y ya no es anónimo); la 14 confirmó su correo por el enlace de P-23 (lead_sesion).
insert into public.lead (id, id_sesion_anonima, nombre, correo, acepta_tratamiento_datos, fecha_consentimiento) values
  ('40000000-0000-0000-0000-000000001103', 'c0000000-0000-0000-0000-000000001113', 'Lead Tres HU-011', 'lead11-3@example.com', true, now());
insert into public.lead_sesion (id_sesion, id_lead) values
  ('c0000000-0000-0000-0000-000000001114', '40000000-0000-0000-0000-000000001103');
insert into public.estudiante (id, id_lead) values
  ('c0000000-0000-0000-0000-000000001113', '40000000-0000-0000-0000-000000001103');

-- La grupal de la sesión 12 (la materia 01) y la cita del monitor 05 (la materia 02, con el diagnóstico ganador de la 01 más abajo).
insert into public.certificado (id_monitor, id_materia, id_admin) values
  ('c0000000-0000-0000-0000-000000001105', '10000000-0000-0000-0000-000000001101', 'c0000000-0000-0000-0000-000000001106'),
  ('c0000000-0000-0000-0000-000000001105', '10000000-0000-0000-0000-000000001102', 'c0000000-0000-0000-0000-000000001106');
insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min, lugar, abierta_desde) values
  ('30000000-0000-0000-0000-000000001101', 'c0000000-0000-0000-0000-000000001105', extract(isodow from current_date + 21)::smallint,
   time '10:00', true, 20000, 60, 'Salón 1100', current_date - 60),
  ('30000000-0000-0000-0000-000000001102', 'c0000000-0000-0000-0000-000000001105', extract(isodow from current_date + 22)::smallint,
   time '14:00', true, 15000, 60, 'Salón 1101', current_date - 60);
insert into public.monitoria (id, id_franja, id_monitor, id_materia, id_lead, fecha, estado, valor_total) values
  ('50000000-0000-0000-0000-000000001102', '30000000-0000-0000-0000-000000001102', 'c0000000-0000-0000-0000-000000001105',
   '10000000-0000-0000-0000-000000001101', '40000000-0000-0000-0000-000000001102', current_date + 22, 'pendiente_pago', 30000);
insert into public.monitoria_grupal (id_monitoria, cupos, modalidad_pago, precio_por_persona) values
  ('50000000-0000-0000-0000-000000001102', 2, 'dividido', 15000);

-- Diagnósticos terminados, completos (un paso o más, semilla, aciertos y resultado), insertados en este orden y uno por uno: el
-- orden físico no puede delatar a un `limit 1` sin `order by`. Los de la sesión 01 traen lo que nadie con sesión debe leer: el
-- repetido, una marca de falta de material, la semilla y el token de recuperación.
-- 01: b3 (materia 01, sin Lead, 2-oct), b1 (materia 02, del Lead, 5-oct 03:30: el ganador y el id más chico) y b2 (materia 01, del
-- Lead, 3-oct).
insert into public.diagnostico (id, id_lead, id_sesion_anonima, id_evaluacion, id_materia, respuestas, fecha_realizacion, puntaje,
                                resultado_por_habilidad, semilla, aciertos, repetido, falta_material)
values ('60000000-0000-0000-0000-0000000011b3', null, 'c0000000-0000-0000-0000-000000001101',
  '20000000-0000-0000-0000-000000001101', '10000000-0000-0000-0000-000000001101',
  '[{"clave":"P1"},{"clave":"P2"},{"clave":"P3"}]'::jsonb, timestamptz '2026-10-02 03:30:00+00', 33.33,
  '{"habilidades":[],"errores":[],"prerrequisitos":[]}'::jsonb, 3003, 1, true,
  '[{"habilidad":"potencia","motivos":["tope_una_respuesta"]}]'::jsonb);
insert into public.diagnostico (id, id_lead, id_sesion_anonima, id_evaluacion, id_materia, respuestas, fecha_realizacion, puntaje,
                                resultado_por_habilidad, semilla, aciertos, repetido, falta_material)
select '60000000-0000-0000-0000-0000000011b1', '40000000-0000-0000-0000-000000001101', 'c0000000-0000-0000-0000-000000001101',
  '20000000-0000-0000-0000-000000001102', '10000000-0000-0000-0000-000000001102',
  (select jsonb_agg(jsonb_build_object('clave', 'P' || n)) from generate_series(1, 8) n),
  timestamptz '2026-10-05 03:30:00+00', 62.5, e.resultado, 123456, 5, true,
  '[{"habilidad":"potencia","motivos":["tope_una_respuesta"]}]'::jsonb
from esperado e;
insert into public.diagnostico (id, id_lead, id_sesion_anonima, id_evaluacion, id_materia, respuestas, fecha_realizacion, puntaje,
                                resultado_por_habilidad, semilla, aciertos)
values ('60000000-0000-0000-0000-0000000011b2', '40000000-0000-0000-0000-000000001101', 'c0000000-0000-0000-0000-000000001101',
  '20000000-0000-0000-0000-000000001101', '10000000-0000-0000-0000-000000001101',
  '[{"clave":"P1"},{"clave":"P2"},{"clave":"P3"},{"clave":"P4"}]'::jsonb, timestamptz '2026-10-03 03:30:00+00', 50,
  '{"habilidades":[],"errores":[],"prerrequisitos":[]}'::jsonb, 3002, 2);
-- 02: otra sesión, materia 02, el más reciente de todos (6-oct 15:30). 03: ligada al Lead 1, materia 01, del Lead (6-oct 03:30).
insert into public.diagnostico (id, id_lead, id_sesion_anonima, id_evaluacion, id_materia, respuestas, fecha_realizacion, puntaje,
                                resultado_por_habilidad, semilla, aciertos)
values
  ('60000000-0000-0000-0000-0000000011c2', null, 'c0000000-0000-0000-0000-000000001102',
   '20000000-0000-0000-0000-000000001102', '10000000-0000-0000-0000-000000001102',
   '[{"clave":"P1"},{"clave":"P2"},{"clave":"P3"},{"clave":"P4"},{"clave":"P5"},{"clave":"P6"}]'::jsonb,
   timestamptz '2026-10-06 15:30:00+00', 50, '{"habilidades":[],"errores":[],"prerrequisitos":[]}'::jsonb, 3012, 3),
  ('60000000-0000-0000-0000-0000000011c3', '40000000-0000-0000-0000-000000001101', 'c0000000-0000-0000-0000-000000001103',
   '20000000-0000-0000-0000-000000001101', '10000000-0000-0000-0000-000000001101',
   '[{"clave":"P1"},{"clave":"P2"},{"clave":"P3"},{"clave":"P4"},{"clave":"P5"}]'::jsonb,
   timestamptz '2026-10-06 03:30:00+00', 80, '{"habilidades":[],"errores":[],"prerrequisitos":[]}'::jsonb, 3013, 4);
-- 11: la misma fecha exacta, materias distintas; el id menor (0a) se inserta primero y el mayor (ff) después.
insert into public.diagnostico (id, id_lead, id_sesion_anonima, id_evaluacion, id_materia, respuestas, fecha_realizacion, puntaje,
                                resultado_por_habilidad, semilla, aciertos)
values ('60000000-0000-0000-0000-00000000110a', null, 'c0000000-0000-0000-0000-000000001111',
  '20000000-0000-0000-0000-000000001101', '10000000-0000-0000-0000-000000001101',
  '[{"clave":"P1"},{"clave":"P2"},{"clave":"P3"}]'::jsonb, timestamptz '2026-10-04 12:00:00+00', 66.67,
  '{"habilidades":[],"errores":[],"prerrequisitos":[]}'::jsonb, 3110, 2);
insert into public.diagnostico (id, id_lead, id_sesion_anonima, id_evaluacion, id_materia, respuestas, fecha_realizacion, puntaje,
                                resultado_por_habilidad, semilla, aciertos)
values ('60000000-0000-0000-0000-0000000011ff', null, 'c0000000-0000-0000-0000-000000001111',
  '20000000-0000-0000-0000-000000001102', '10000000-0000-0000-0000-000000001102',
  '[{"clave":"P1"},{"clave":"P2"},{"clave":"P3"},{"clave":"P4"},{"clave":"P5"},{"clave":"P6"},{"clave":"P7"}]'::jsonb,
  timestamptz '2026-10-04 12:00:00+00', 85.71, '{"habilidades":[],"errores":[],"prerrequisitos":[]}'::jsonb, 3111, 6);
-- 06 (admin) y 07 (monitor): cada uno es la sesión dueña de una fila.
insert into public.diagnostico (id, id_lead, id_sesion_anonima, id_evaluacion, id_materia, respuestas, fecha_realizacion, puntaje,
                                resultado_por_habilidad, semilla, aciertos)
values
  ('60000000-0000-0000-0000-0000000011e6', null, 'c0000000-0000-0000-0000-000000001106',
   '20000000-0000-0000-0000-000000001101', '10000000-0000-0000-0000-000000001101',
   '[{"clave":"P1"},{"clave":"P2"}]'::jsonb, timestamptz '2026-10-03 10:00:00+00', 50,
   '{"habilidades":[],"errores":[],"prerrequisitos":[]}'::jsonb, 3106, 1),
  ('60000000-0000-0000-0000-0000000011e7', null, 'c0000000-0000-0000-0000-000000001107',
   '20000000-0000-0000-0000-000000001102', '10000000-0000-0000-0000-000000001102',
   '[{"clave":"P1"},{"clave":"P2"}]'::jsonb, timestamptz '2026-10-03 11:00:00+00', 50,
   '{"habilidades":[],"errores":[],"prerrequisitos":[]}'::jsonb, 3107, 1);
-- 12: uno anterior sin grupal (d1) y el más reciente hecho dentro de la grupal (d2).
insert into public.diagnostico (id, id_lead, id_sesion_anonima, id_evaluacion, id_materia, id_monitoria, respuestas, fecha_realizacion,
                                puntaje, resultado_por_habilidad, semilla, aciertos)
values
  ('60000000-0000-0000-0000-0000000011d1', null, 'c0000000-0000-0000-0000-000000001112',
   '20000000-0000-0000-0000-000000001101', '10000000-0000-0000-0000-000000001101', null,
   '[{"clave":"P1"},{"clave":"P2"},{"clave":"P3"}]'::jsonb, timestamptz '2026-10-01 09:00:00+00', 33.33,
   '{"habilidades":[],"errores":[],"prerrequisitos":[]}'::jsonb, 3121, 1),
  ('60000000-0000-0000-0000-0000000011d2', null, 'c0000000-0000-0000-0000-000000001112',
   '20000000-0000-0000-0000-000000001101', '10000000-0000-0000-0000-000000001101', '50000000-0000-0000-0000-000000001102',
   (select jsonb_agg(jsonb_build_object('clave', 'P' || n)) from generate_series(1, 9) n), timestamptz '2026-10-02 09:00:00+00', 77.78,
   '{"habilidades":[],"errores":[],"prerrequisitos":[]}'::jsonb, 3122, 7);
-- 13 y 14 (Lead 3): la cuenta convertida hizo f3 (3-oct) y la otra sesión del Lead hizo f4 (7-oct, el más reciente del Lead).
insert into public.diagnostico (id, id_lead, id_sesion_anonima, id_evaluacion, id_materia, respuestas, fecha_realizacion, puntaje,
                                resultado_por_habilidad, semilla, aciertos)
values
  ('60000000-0000-0000-0000-0000000011f3', '40000000-0000-0000-0000-000000001103', 'c0000000-0000-0000-0000-000000001113',
   '20000000-0000-0000-0000-000000001101', '10000000-0000-0000-0000-000000001101',
   '[{"clave":"P1"},{"clave":"P2"},{"clave":"P3"}]'::jsonb, timestamptz '2026-10-03 08:00:00+00', 66.67,
   '{"habilidades":[],"errores":[],"prerrequisitos":[]}'::jsonb, 3133, 2),
  ('60000000-0000-0000-0000-0000000011f4', '40000000-0000-0000-0000-000000001103', 'c0000000-0000-0000-0000-000000001114',
   '20000000-0000-0000-0000-000000001102', '10000000-0000-0000-0000-000000001102',
   '[{"clave":"P1"},{"clave":"P2"},{"clave":"P3"},{"clave":"P4"}]'::jsonb, timestamptz '2026-10-07 08:00:00+00', 75,
   '{"habilidades":[],"errores":[],"prerrequisitos":[]}'::jsonb, 3144, 3);
-- 09: solo un diagnóstico en curso (una fila por sesión; sin grants, solo se siembra como postgres).
insert into public.diagnostico_en_curso (id_sesion, id_evaluacion, id_materia, semilla, candidatas, contexto) values
  ('c0000000-0000-0000-0000-000000001109', '20000000-0000-0000-0000-000000001101', '10000000-0000-0000-0000-000000001101',
   3109, '[]'::jsonb, '{}'::jsonb);

-- Una cita del monitor 05 que apunta al diagnóstico ganador de la 01 (RN-13, D-7). Desde HU-022 la política de la tabla ya no le
-- deja leerlo: lo lee con public.diagnostico_de_mi_monitoria.
insert into public.monitoria (id, id_franja, id_monitor, id_materia, id_lead, fecha, estado, valor_total, id_diagnostico) values
  ('50000000-0000-0000-0000-000000001101', '30000000-0000-0000-0000-000000001101', 'c0000000-0000-0000-0000-000000001105',
   '10000000-0000-0000-0000-000000001102', '40000000-0000-0000-0000-000000001102', current_date + 21, 'pendiente_pago', 20000,
   '60000000-0000-0000-0000-0000000011b1');

-- ---------------------------------------------------------------------------
-- Estructura y permisos
-- ---------------------------------------------------------------------------
select has_function('privado', 'mi_ultimo_diagnostico', array[]::text[], 'Existe privado.mi_ultimo_diagnostico, la lectura del dueño');
select has_function('public', 'mi_ultimo_diagnostico', array[]::text[], 'Existe su puerta en la Data API');
select ok(
  (select prosecdef from pg_proc where oid = 'privado.mi_ultimo_diagnostico()'::regprocedure)
  and not (select prosecdef from pg_proc where oid = 'public.mi_ultimo_diagnostico()'::regprocedure),
  'La de privado es security definer (lee el diagnóstico sin dar la tabla); la puerta corre con los permisos de quien llama');
-- Con coalesce y contando las dos: sin search_path, proconfig es nulo y el bool_and solo ignoraría esa función.
select ok(
  (select count(*) = 2 and bool_and(coalesce('search_path=""' = any(proconfig), false)) from pg_proc
   where oid in ('privado.mi_ultimo_diagnostico()'::regprocedure, 'public.mi_ultimo_diagnostico()'::regprocedure)),
  'Las dos fijan un search_path vacío');
select is(
  pg_get_function_result('privado.mi_ultimo_diagnostico()'::regprocedure),
  'TABLE(id_diagnostico uuid, codigo_materia text, nombre_materia text, nombre_evaluacion text, fecha_realizacion timestamp with time zone, respondidas integer, aciertos integer, resultado jsonb)',
  'La de privado devuelve exactamente esas 8 columnas: ni repetido, puntaje, semilla, token, respuestas ni falta de material (D-53 b)');
select is(
  pg_get_function_result('public.mi_ultimo_diagnostico()'::regprocedure),
  'TABLE(id_diagnostico uuid, codigo_materia text, nombre_materia text, nombre_evaluacion text, fecha_realizacion timestamp with time zone, respondidas integer, aciertos integer, resultado jsonb)',
  'La puerta devuelve las mismas 8 columnas, en el mismo orden');
select is(
  pg_get_function_result('privado.mi_ultimo_diagnostico()'::regprocedure),
  pg_get_function_result('privado.mi_diagnostico(uuid)'::regprocedure),
  'Las columnas de la de privado son las de privado.mi_diagnostico de HU-009');
select is(
  pg_get_function_result('public.mi_ultimo_diagnostico()'::regprocedure),
  pg_get_function_result('public.mi_diagnostico(uuid)'::regprocedure),
  'Y las de la puerta son las de public.mi_diagnostico');
select is(
  pg_get_function_identity_arguments('privado.mi_ultimo_diagnostico()'::regprocedure) || '|' ||
  pg_get_function_identity_arguments('public.mi_ultimo_diagnostico()'::regprocedure),
  '|',
  'No reciben nada: el dueño sale del JWT en la base, nunca de un parámetro');
select is(
  (select array_agg(a.grantee::regrole::text order by a.grantee::regrole::text)
   from pg_proc p cross join lateral aclexplode(p.proacl) a where p.oid = 'privado.mi_ultimo_diagnostico()'::regprocedure),
  array['authenticated', 'postgres'],
  'La de privado la ejecutan solo su dueño y las sesiones (ni PUBLIC, ni anon, ni la llave secreta)');
select is(
  (select array_agg(a.grantee::regrole::text order by a.grantee::regrole::text)
   from pg_proc p cross join lateral aclexplode(p.proacl) a where p.oid = 'public.mi_ultimo_diagnostico()'::regprocedure),
  array['authenticated', 'postgres'],
  'La puerta, igual');
select ok(
  not has_function_privilege('anon', 'public.mi_ultimo_diagnostico()', 'execute')
  and not has_function_privilege('anon', 'privado.mi_ultimo_diagnostico()', 'execute'),
  'El visitante sin sesión no ejecuta ninguna de las dos');
select ok(
  not has_function_privilege('service_role', 'public.mi_ultimo_diagnostico()', 'execute')
  and not has_function_privilege('service_role', 'privado.mi_ultimo_diagnostico()', 'execute'),
  'Ni la llave secreta: el servidor la llama con la sesión de la persona');
select ok(
  has_function_privilege('authenticated', 'public.mi_ultimo_diagnostico()', 'execute')
  and has_function_privilege('authenticated', 'privado.mi_ultimo_diagnostico()', 'execute'),
  'Las sesiones (anónimas incluidas) sí ejecutan las dos');

-- ---------------------------------------------------------------------------
-- Precondiciones del elenco (como postgres): sin ellas, las pruebas de orden pasarían por azar
-- ---------------------------------------------------------------------------
select is(
  (select array_agg(right(id::text, 2) order by ctid) from public.diagnostico where id_sesion_anonima = 'c0000000-0000-0000-0000-000000001101'),
  array['b3', 'b1', 'b2'],
  'Elenco: los de la sesión 01 se insertaron en el orden b3, b1, b2 (el ganador no es el primero ni el último)');
select is(
  (select array_agg(right(id::text, 2) order by ctid) from public.diagnostico where id_sesion_anonima = 'c0000000-0000-0000-0000-000000001111'),
  array['0a', 'ff'],
  'Elenco: los de la sesión 11 se insertaron en el orden 0a, ff (el id menor primero)');
select is(
  (select array_agg(id::text order by fecha_realizacion desc, id desc) from public.diagnostico where id_sesion_anonima = 'c0000000-0000-0000-0000-000000001101'),
  array['60000000-0000-0000-0000-0000000011b1', '60000000-0000-0000-0000-0000000011b2', '60000000-0000-0000-0000-0000000011b3'],
  'Elenco: por fecha ganan b1, b2, b3, y por id ganarían b3, b2, b1: el más reciente es el de id menor');
select ok(
  (select count(*) = 2 and bool_and(activa) from public.evaluacion
   where id in ('20000000-0000-0000-0000-000000001101', '20000000-0000-0000-0000-000000001102')),
  'Elenco: las dos Evaluaciones nacen activas');
select is(
  (select count(*)::int from public.diagnostico_en_curso where id_sesion = 'c0000000-0000-0000-0000-000000001109')
  + (select count(*)::int from public.diagnostico where id_sesion_anonima = 'c0000000-0000-0000-0000-000000001109'),
  1,
  'Elenco: la sesión 09 tiene un diagnóstico en curso y ninguno terminado');
select ok(
  (select id_monitoria is not null from public.diagnostico where id = '60000000-0000-0000-0000-0000000011d2')
  and (select id_monitoria is null from public.diagnostico where id = '60000000-0000-0000-0000-0000000011d1')
  and (select id_diagnostico = '60000000-0000-0000-0000-0000000011b1' from public.monitoria where id = '50000000-0000-0000-0000-000000001101'),
  'Elenco: d2 se hizo dentro de una grupal, d1 no, y la cita del monitor 05 apunta a b1');
select ok(
  (select not u.is_anonymous from auth.users u where u.id = 'c0000000-0000-0000-0000-000000001113')
  and (select e.id = d.id_sesion_anonima and e.id_lead = d.id_lead from public.estudiante e, public.diagnostico d
       where e.id = 'c0000000-0000-0000-0000-000000001113' and d.id = '60000000-0000-0000-0000-0000000011f3')
  and (select d.id_sesion_anonima <> 'c0000000-0000-0000-0000-000000001113' and d.fecha_realizacion > f.fecha_realizacion
       from public.diagnostico d, public.diagnostico f
       where d.id = '60000000-0000-0000-0000-0000000011f4' and f.id = '60000000-0000-0000-0000-0000000011f3'),
  'Elenco: la cuenta de Estudiante 13 no es anónima y tiene el mismo id que la sesión que hizo f3; f4, más reciente, es de otra sesión del Lead');

-- ---------------------------------------------------------------------------
-- La sesión dueña (01): el más reciente de los suyos, no el de otras sesiones del Lead
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001101","role":"authenticated","is_anonymous":true}';
select lives_ok($$select * from public.mi_ultimo_diagnostico()$$,
  'La lectura de una sesión con tres diagnósticos no falla (una subconsulta sin limit 1 devolvería más de una fila)');
select is((select count(*)::int from public.mi_ultimo_diagnostico()), 1,
  'La sesión con tres diagnósticos recibe una sola fila');
select is((select id_diagnostico from public.mi_ultimo_diagnostico()), '60000000-0000-0000-0000-0000000011b1'::uuid,
  'Y es el más reciente de los suyos (materia Beta, 5-oct): no el primero insertado, ni el de la materia de nombre menor, ni el de id mayor, aunque otra sesión y otra del Lead tengan uno más nuevo');
select is((select codigo_materia from public.mi_ultimo_diagnostico()), 'PGTAP-11-B', 'codigo_materia es el código de la materia');
select is((select nombre_materia from public.mi_ultimo_diagnostico()), 'Materia Once Beta', 'nombre_materia es el nombre de la materia');
select is((select nombre_evaluacion from public.mi_ultimo_diagnostico()), 'Parcial Once Dos', 'nombre_evaluacion es el nombre de la Evaluación');
select is((select fecha_realizacion from public.mi_ultimo_diagnostico()), timestamptz '2026-10-05 03:30:00+00',
  'fecha_realizacion es el instante guardado (la zona la pone la app)');
select is((select respondidas from public.mi_ultimo_diagnostico()), 8, 'respondidas es el largo de respuestas');
select is((select aciertos from public.mi_ultimo_diagnostico()), 5, 'aciertos son las preguntas acertadas');
select is((select resultado from public.mi_ultimo_diagnostico()), (select resultado from esperado), 'resultado es lo guardado, sin tocar');
select is(
  (select array_agg(k order by k) from public.mi_ultimo_diagnostico() r, lateral jsonb_object_keys(to_jsonb(r)) k),
  array['aciertos', 'codigo_materia', 'fecha_realizacion', 'id_diagnostico', 'nombre_evaluacion', 'nombre_materia', 'respondidas', 'resultado'],
  'La fila que llega tiene solo esas claves, aunque el diagnóstico guarde repetido, semilla, token y falta de material');
select is(
  (select to_jsonb(u) from public.mi_ultimo_diagnostico() u),
  (select to_jsonb(m) from public.mi_diagnostico('60000000-0000-0000-0000-0000000011b1') m),
  'Es exactamente lo que devuelve mi_diagnostico de HU-009 para ese id: no altera nada');
select is((select count(*)::int from public.diagnostico where id_lead = '40000000-0000-0000-0000-000000001101'), 2,
  'Con select, la sesión 01 lee solo los dos del Lead que hizo ella, no el de la 03: la misma regla del dueño (HU-095, D-53 e)');
reset role;

-- ---------------------------------------------------------------------------
-- Otra sesión sin relación (02): el suyo, aunque sea el más reciente de todos
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001102","role":"authenticated","is_anonymous":true}';
select is((select count(*)::int from public.mi_ultimo_diagnostico()), 1, 'Otra sesión recibe una fila');
select is((select id_diagnostico from public.mi_ultimo_diagnostico()), '60000000-0000-0000-0000-0000000011c2'::uuid,
  'Y es el suyo, no los de la sesión 01');
reset role;

-- ---------------------------------------------------------------------------
-- La sesión ligada al Lead por lead_sesion (03), la que creó el Lead (04) y la cuenta de Estudiante que es otro usuario (08): D-53 e
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001103","role":"authenticated","is_anonymous":true}';
select is((select id_diagnostico from public.mi_ultimo_diagnostico()), '60000000-0000-0000-0000-0000000011c3'::uuid,
  'La sesión ligada al Lead recibe el diagnóstico de su propia sesión');
select is((select count(*)::int from public.mi_ultimo_diagnostico()), 1, 'Y solo ese');
select is((select count(*)::int from public.diagnostico where id_lead = '40000000-0000-0000-0000-000000001101'), 1,
  'Y la tabla tampoco le deja leer los del Lead que hizo otra sesión: solo el suyo (HU-095)');

set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001104","role":"authenticated","is_anonymous":true}';
select is((select count(*)::int from public.diagnostico where id_lead = '40000000-0000-0000-0000-000000001101'), 0,
  'La sesión que creó el Lead no lee con select ninguno de los diagnósticos del Lead (HU-095)');
select is((select count(*)::int from public.mi_ultimo_diagnostico()), 0,
  'Y la portada tampoco le muestra ninguno: quien escribió primero el correo de otra persona no ve sus diagnósticos');

set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001108","role":"authenticated","is_anonymous":false}';
select is((select count(*)::int from public.diagnostico where id_lead = '40000000-0000-0000-0000-000000001101'), 3,
  'La cuenta de Estudiante del Lead (otro usuario que las sesiones) lee con select los tres diagnósticos del Lead');
select is((select count(*)::int from public.mi_ultimo_diagnostico()), 0,
  'Pero la portada no le muestra ninguno: esa cuenta tiene su historial aparte, y en la portada ve lo que hizo su propia sesión');
select is((select count(*)::int from public.mi_diagnostico('60000000-0000-0000-0000-0000000011b1')), 1,
  'Sí recibe ese diagnóstico con mi_diagnostico por id (HU-009, D-55 c): la diferencia entre las dos funciones queda escrita');
reset role;

-- ---------------------------------------------------------------------------
-- La cuenta de Estudiante que nació de convertir la sesión dueña (13): el mismo id, así que sí es la dueña
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001113","role":"authenticated","is_anonymous":false}';
select is(public.mi_rol(), 'estudiante', 'Es una cuenta de Estudiante de verdad: el rol que la portada deja pasar a la base');
select is((select count(*)::int from public.mi_ultimo_diagnostico()), 1,
  'Recibe una fila: su id es el de la sesión que hizo el diagnóstico (HU-032 conserva el id al convertir)');
select is((select id_diagnostico from public.mi_ultimo_diagnostico()), '60000000-0000-0000-0000-0000000011f3'::uuid,
  'Y es el que hizo su sesión (3-oct), no el más reciente de su Lead (7-oct), que hizo otra sesión');
select is(
  (select to_jsonb(u) from public.mi_ultimo_diagnostico() u),
  (select to_jsonb(m) from public.mi_diagnostico('60000000-0000-0000-0000-0000000011f3') m),
  'Es exactamente lo que devuelve mi_diagnostico para ese id');
select is((select count(*)::int from public.diagnostico where id_lead = '40000000-0000-0000-0000-000000001103'), 2,
  'Aunque la tabla le deja leer los dos del Lead: el motivo de elegir por sesión y no por Lead');
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001114","role":"authenticated","is_anonymous":true}';
select is((select id_diagnostico from public.mi_ultimo_diagnostico()), '60000000-0000-0000-0000-0000000011f4'::uuid,
  'La otra sesión del Lead recibe el suyo (7-oct), no el de la cuenta convertida');
reset role;

-- ---------------------------------------------------------------------------
-- Sin diagnósticos terminados: sin fila
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001109","role":"authenticated","is_anonymous":true}';
select is((select count(*)::int from public.mi_ultimo_diagnostico()), 0,
  'Una sesión con solo un diagnóstico en curso no recibe fila: el a medias no cuenta');
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001110","role":"authenticated","is_anonymous":true}';
select is((select count(*)::int from public.mi_ultimo_diagnostico()), 0, 'Una sesión sin nada no recibe fila');
reset role;

-- ---------------------------------------------------------------------------
-- El empate (11): la misma fecha exacta, gana el id mayor aunque el menor se insertó primero
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001111","role":"authenticated","is_anonymous":true}';
select is((select count(*)::int from public.mi_ultimo_diagnostico()), 1, 'Con dos diagnósticos de la misma fecha recibe una fila');
select is((select id_diagnostico from public.mi_ultimo_diagnostico()), '60000000-0000-0000-0000-0000000011ff'::uuid,
  'En empate de fecha gana el id mayor (el orden de agendar_monitoria), no el primero insertado');
select is((select codigo_materia from public.mi_ultimo_diagnostico()), 'PGTAP-11-B', 'Y es el de su materia');
reset role;

-- ---------------------------------------------------------------------------
-- Una grupal (12): el diagnóstico hecho dentro de una grupal cuenta
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001112","role":"authenticated","is_anonymous":true}';
select is((select id_diagnostico from public.mi_ultimo_diagnostico()), '60000000-0000-0000-0000-0000000011d2'::uuid,
  'El más reciente es el de la grupal, aunque tenga id_monitoria');
select is((select respondidas from public.mi_ultimo_diagnostico()), 9, 'Con sus propios valores');
reset role;

-- ---------------------------------------------------------------------------
-- Monitor y admin: la política de la tabla les deja leer, la función no
-- ---------------------------------------------------------------------------
set local role authenticated;
-- Desde HU-022 el monitor 05 ya no lee b1 con select por la cita que lo apunta (lo lee con diagnostico_de_mi_monitoria). Esta
-- prueba no depende de esa política: lo que importa es que la función no le devuelve nada.
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001105","role":"authenticated","is_anonymous":false}';
select is((select count(*)::int from public.mi_ultimo_diagnostico()), 0,
  'El monitor de una cita que apunta a un diagnóstico no recibe nada: el resultado de un estudiante no se le muestra como suyo');
-- Un admin y un monitor que además son la sesión dueña de una fila: sin la guarda de rol de mi_diagnostico recibirían su fila.
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001106","role":"authenticated","is_anonymous":false}';
select is((select count(*)::int from public.diagnostico where id = '60000000-0000-0000-0000-0000000011e6'), 1,
  'Un admin que es la sesión dueña de un diagnóstico lo lee con select (informativa: es la política del admin)');
select is((select count(*)::int from public.mi_ultimo_diagnostico()), 0,
  'Pero la función no se lo devuelve: la cuenta del equipo no tiene resultados de estudiante');
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001107","role":"authenticated","is_anonymous":false}';
select is((select count(*)::int from public.diagnostico where id = '60000000-0000-0000-0000-0000000011e7'), 1,
  'Un monitor que es la sesión dueña de un diagnóstico lo lee con select (informativa: es la política de dueño)');
select is((select count(*)::int from public.mi_ultimo_diagnostico()), 0,
  'Pero la función no se lo devuelve');
reset role;

-- ---------------------------------------------------------------------------
-- Sin sesión
-- ---------------------------------------------------------------------------
set local role anon;
select throws_ok($$select * from public.mi_ultimo_diagnostico()$$, '42501', null, 'El visitante sin sesión: permiso denegado');
select throws_ok($$select * from privado.mi_ultimo_diagnostico()$$, '42501', null, 'Ni la de privado');
reset role;
set local role service_role;
select throws_ok($$select * from public.mi_ultimo_diagnostico()$$, '42501', null, 'La llave secreta no la ejecuta');
select throws_ok($$select * from privado.mi_ultimo_diagnostico()$$, '42501', null, 'Ni la de privado');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"role":"authenticated"}';
select is((select count(*)::int from public.mi_ultimo_diagnostico()), 0, 'Un token sin sub (auth.uid() nulo) no recibe nada');
reset role;

-- ---------------------------------------------------------------------------
-- Una Evaluación desactivada no cambia el resultado
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001101","role":"authenticated","is_anonymous":true}';
select ok(coalesce(set_config('hu011.antes', (select to_jsonb(u)::text from public.mi_ultimo_diagnostico() u), true), '') like '{%',
  'Se guarda lo que recibe la sesión 01 con las Evaluaciones activas');
reset role;
update public.evaluacion set activa = false
where id in ('20000000-0000-0000-0000-000000001101', '20000000-0000-0000-0000-000000001102');
select ok(
  (select count(*) = 2 and not bool_or(activa) from public.evaluacion
   where id in ('20000000-0000-0000-0000-000000001101', '20000000-0000-0000-0000-000000001102')),
  'Las dos Evaluaciones quedan apagadas (antes estaban activas)');
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001101","role":"authenticated","is_anonymous":true}';
select is((select count(*)::int from public.mi_ultimo_diagnostico()), 1, 'Con las Evaluaciones apagadas el resultado sale igual');
select is((select to_jsonb(u) from public.mi_ultimo_diagnostico() u), nullif(current_setting('hu011.antes'), '')::jsonb,
  'Y es idéntico, columna por columna, a lo que salía con ellas activas: no depende del banco');
select is((select nombre_evaluacion from public.mi_ultimo_diagnostico()), 'Parcial Once Dos', 'Con su nombre');
reset role;

select * from finish();
rollback;
