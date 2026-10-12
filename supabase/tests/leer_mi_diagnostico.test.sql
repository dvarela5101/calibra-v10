-- Pruebas pgTAP de leer mi diagnóstico (HU-009): public.mi_diagnostico(id) y privado.mi_diagnostico(id).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.
--
-- Lo que se prueba: quién recibe fila (la sesión que hizo el diagnóstico y la cuenta de Estudiante de su Lead, D-53 e y D-55 c) y
-- quién no (otra sesión, una sesión ligada por lead_sesion, la que creó el Lead sin hacer el diagnóstico, la cuenta de Estudiante de
-- otro Lead, un monitor con cita, un admin, un monitor o un admin que además es la sesión dueña, el visitante sin sesión), qué
-- columnas salen (ni repetido, ni semilla, ni token, ni las copias de las preguntas) y que la Evaluación apagada no cambia nada.
--
-- Elenco (ids terminados en 0009NN):
--   sesiones c0000000-...-0009NN: 01 dueña (hizo los diagnósticos 01 y 02), 02 otra sin relación, 03 ligada al Lead 1 por lead_sesion
--     (enlace de P-23), 04 monitor con una cita que apunta al diagnóstico 01, 05 admin, 06 monitor que es la sesión dueña del
--     diagnóstico 03, 07 cuenta de Estudiante del Lead 1, 08 sesión que creó el Lead 1 y no hizo ningún diagnóstico, 09 cuenta de
--     Estudiante del Lead 2, 10 admin que es la sesión dueña del diagnóstico 04.
--   Leads 40000000-...-0009NN: 01 (creado por la sesión 08; sesión 03 por lead_sesion; Estudiante 07) y 02 (Estudiante 09; es el Lead
--     de la cita). Materias 10000000-...-0009NN: 01 y 02 con nombres distintos entre sí, del nombre de la Evaluación y de los códigos.
--     Evaluaciones 20000000-...-0009NN: 01 de la materia 01 y 02 de la materia 02.
--   Diagnósticos 60000000-...-0009NN: 01 sesión 01 sin Lead (8 respondidas, 5 aciertos, repetido, con falta de material);
--     02 sesión 01 ya ligado al Lead 1 (materia 02); 03 sesión 06; 04 sesión 10.

begin;
create extension if not exists pgtap with schema extensions;

select plan(50);

-- Lo que el diagnóstico 01 guarda como resultado por habilidad, para compararlo con lo que devuelve la función.
create temporary table esperado as select
  '{"habilidades":[{"habilidad":"regla-cadena","descripcion":"Derivar una función compuesta","nivel":"en_proceso","respuestas":3,"aciertos":2},{"habilidad":"potencia","descripcion":"Derivar una potencia","nivel":"sin_medir","respuestas":0,"aciertos":0}],"errores":[{"misconcepcion":"olvida-cadena","habilidad":"regla-cadena","descripcionHabilidad":"Derivar una función compuesta","texto":"Olvidas multiplicar por la derivada de adentro","estado":"confirmada","veces":2,"detalles":["error propio de la opción"]}],"prerrequisitos":[{"materia":null,"habilidad":"potencia","descripcion":"Derivar una potencia"}]}'::jsonb as resultado;
grant select on esperado to authenticated;

-- ---------------------------------------------------------------------------
-- Fixtures (como postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, is_anonymous)
select ('c0000000-0000-0000-0000-0000000009' || lpad(n::text, 2, '0'))::uuid, n in (1, 2, 3, 8)
from generate_series(1, 10) n;

insert into public.admin (id, nombre, correo, orden_revision) values
  ('c0000000-0000-0000-0000-000000000905', 'Admin HU-009', 'admin9@example.com', 9000091),
  ('c0000000-0000-0000-0000-000000000910', 'Admin dueño HU-009', 'admin9b@example.com', 9000092);
insert into public.monitor (id, nombre) values
  ('c0000000-0000-0000-0000-000000000904', 'Monitor con cita HU-009'),
  ('c0000000-0000-0000-0000-000000000906', 'Monitor dueño HU-009');

insert into public.materia (id, nombre, codigo) values
  ('10000000-0000-0000-0000-000000000901', 'Materia Nueve Uno', 'PGTAP-09-A'),
  ('10000000-0000-0000-0000-000000000902', 'Materia Nueve Dos', 'PGTAP-09-B');
insert into public.evaluacion (id, id_materia, semana, nombre) values
  ('20000000-0000-0000-0000-000000000901', '10000000-0000-0000-0000-000000000901', 5, 'Parcial Nueve Alfa'),
  ('20000000-0000-0000-0000-000000000902', '10000000-0000-0000-0000-000000000902', 7, 'Parcial Nueve Beta');
update public.evaluacion set activa = true where id in ('20000000-0000-0000-0000-000000000901', '20000000-0000-0000-0000-000000000902');

-- Lead 1: lo creó la sesión 08, la 03 confirmó su correo (lead_sesion) y la 07 es su cuenta de Estudiante. Lead 2: la cuenta 09.
insert into public.lead (id, id_sesion_anonima, nombre, correo, acepta_tratamiento_datos, fecha_consentimiento) values
  ('40000000-0000-0000-0000-000000000901', 'c0000000-0000-0000-0000-000000000908', 'Lead Uno HU-009', 'lead9-1@example.com', true, now()),
  ('40000000-0000-0000-0000-000000000902', null, 'Lead Dos HU-009', 'lead9-2@example.com', true, now());
insert into public.lead_sesion (id_sesion, id_lead) values
  ('c0000000-0000-0000-0000-000000000903', '40000000-0000-0000-0000-000000000901');
insert into public.estudiante (id, id_lead) values
  ('c0000000-0000-0000-0000-000000000907', '40000000-0000-0000-0000-000000000901'),
  ('c0000000-0000-0000-0000-000000000909', '40000000-0000-0000-0000-000000000902');

-- Diagnósticos terminados, completos (un paso o más, semilla, aciertos y resultado). El 01 trae lo que nadie con sesión debe leer: el
-- repetido, una marca de falta de material, la semilla y el token de recuperación.
insert into public.diagnostico (id, id_lead, id_sesion_anonima, id_evaluacion, id_materia, respuestas, fecha_realizacion, puntaje,
                                resultado_por_habilidad, semilla, aciertos, repetido, falta_material)
select '60000000-0000-0000-0000-000000000901', null, 'c0000000-0000-0000-0000-000000000901',
  '20000000-0000-0000-0000-000000000901', '10000000-0000-0000-0000-000000000901',
  (select jsonb_agg(jsonb_build_object('clave', 'P' || n)) from generate_series(1, 8) n),
  timestamptz '2026-10-05 08:30:00+00', 62.5, e.resultado, 123456, 5, true,
  '[{"habilidad":"potencia","motivos":["tope_una_respuesta"]}]'::jsonb
from esperado e;
insert into public.diagnostico (id, id_lead, id_sesion_anonima, id_evaluacion, id_materia, respuestas, fecha_realizacion, puntaje,
                                resultado_por_habilidad, semilla, aciertos)
select v.id::uuid, v.id_lead::uuid, v.sesion::uuid, v.evaluacion::uuid, v.materia::uuid,
  '[{"clave":"P1"},{"clave":"P2"},{"clave":"P3"}]'::jsonb, timestamptz '2026-10-06 15:00:00+00', 33.33,
  '{"habilidades":[],"errores":[],"prerrequisitos":[]}'::jsonb, 7, 1
from (values
  ('60000000-0000-0000-0000-000000000902', '40000000-0000-0000-0000-000000000901', 'c0000000-0000-0000-0000-000000000901',
   '20000000-0000-0000-0000-000000000902', '10000000-0000-0000-0000-000000000902'),
  ('60000000-0000-0000-0000-000000000903', null, 'c0000000-0000-0000-0000-000000000906',
   '20000000-0000-0000-0000-000000000901', '10000000-0000-0000-0000-000000000901'),
  ('60000000-0000-0000-0000-000000000904', null, 'c0000000-0000-0000-0000-000000000910',
   '20000000-0000-0000-0000-000000000901', '10000000-0000-0000-0000-000000000901')
) as v(id, id_lead, sesion, evaluacion, materia);

-- Una cita del monitor 04 que apunta al diagnóstico 01 (RN-13, D-7): la política de la tabla le deja leerlo.
insert into public.certificado (id_monitor, id_materia, id_admin) values
  ('c0000000-0000-0000-0000-000000000904', '10000000-0000-0000-0000-000000000901', 'c0000000-0000-0000-0000-000000000905');
insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min, lugar, abierta_desde)
select '30000000-0000-0000-0000-000000000901', 'c0000000-0000-0000-0000-000000000904',
  extract(isodow from current_date + 21)::smallint, time '10:00', true, 20000, 60, 'Salón 900', current_date - 60;
insert into public.monitoria (id, id_franja, id_monitor, id_materia, id_lead, fecha, estado, valor_total, id_diagnostico) values
  ('50000000-0000-0000-0000-000000000901', '30000000-0000-0000-0000-000000000901', 'c0000000-0000-0000-0000-000000000904',
   '10000000-0000-0000-0000-000000000901', '40000000-0000-0000-0000-000000000902', current_date + 21, 'pendiente_pago', 20000,
   '60000000-0000-0000-0000-000000000901');

-- ---------------------------------------------------------------------------
-- Estructura y permisos
-- ---------------------------------------------------------------------------
select has_function('privado', 'mi_diagnostico', array['uuid'], 'Existe privado.mi_diagnostico, la lectura del dueño');
select has_function('public', 'mi_diagnostico', array['uuid'], 'Existe su puerta en la Data API');
select ok(
  (select prosecdef from pg_proc where oid = 'privado.mi_diagnostico(uuid)'::regprocedure)
  and not (select prosecdef from pg_proc where oid = 'public.mi_diagnostico(uuid)'::regprocedure),
  'La de privado es security definer (lee el diagnóstico sin dar la tabla); la puerta corre con los permisos de quien llama');
-- Con coalesce y contando las dos: sin search_path, proconfig es nulo y el bool_and solo ignoraría esa función.
select ok(
  (select count(*) = 2 and bool_and(coalesce('search_path=""' = any(proconfig), false)) from pg_proc
   where oid in ('privado.mi_diagnostico(uuid)'::regprocedure, 'public.mi_diagnostico(uuid)'::regprocedure)),
  'Las dos fijan un search_path vacío');
select is(
  pg_get_function_result('privado.mi_diagnostico(uuid)'::regprocedure),
  'TABLE(id_diagnostico uuid, codigo_materia text, nombre_materia text, nombre_evaluacion text, fecha_realizacion timestamp with time zone, respondidas integer, aciertos integer, resultado jsonb)',
  'La de privado devuelve exactamente esas 8 columnas: ni repetido, puntaje, semilla, token, respuestas ni falta de material (D-53 b)');
select is(
  pg_get_function_result('public.mi_diagnostico(uuid)'::regprocedure),
  pg_get_function_result('privado.mi_diagnostico(uuid)'::regprocedure),
  'La puerta devuelve las mismas 8 columnas, en el mismo orden');
select is(
  pg_get_function_identity_arguments('privado.mi_diagnostico(uuid)'::regprocedure) || ' | ' ||
  pg_get_function_identity_arguments('public.mi_diagnostico(uuid)'::regprocedure),
  'p_id uuid | p_id uuid',
  'Solo reciben el id del diagnóstico: el dueño sale del JWT en la base, nunca de un parámetro');
select ok(
  not has_function_privilege('anon', 'public.mi_diagnostico(uuid)', 'execute')
  and not has_function_privilege('anon', 'privado.mi_diagnostico(uuid)', 'execute'),
  'El visitante sin sesión no ejecuta ninguna de las dos');
select ok(
  not has_function_privilege('service_role', 'public.mi_diagnostico(uuid)', 'execute')
  and not has_function_privilege('service_role', 'privado.mi_diagnostico(uuid)', 'execute'),
  'Ni la llave secreta: el servidor la llama con la sesión de la persona');
select ok(
  has_function_privilege('authenticated', 'public.mi_diagnostico(uuid)', 'execute')
  and has_function_privilege('authenticated', 'privado.mi_diagnostico(uuid)', 'execute'),
  'Las sesiones (anónimas incluidas) sí ejecutan las dos');

-- ---------------------------------------------------------------------------
-- La sesión dueña (01)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000000901","role":"authenticated","is_anonymous":true}';
select is((select count(*)::int from public.mi_diagnostico('60000000-0000-0000-0000-000000000901')), 1,
  'La sesión que hizo el diagnóstico recibe una fila');
select is((select id_diagnostico from public.mi_diagnostico('60000000-0000-0000-0000-000000000901')),
  '60000000-0000-0000-0000-000000000901'::uuid, 'id_diagnostico es el que pidió');
select is((select codigo_materia from public.mi_diagnostico('60000000-0000-0000-0000-000000000901')),
  'PGTAP-09-A', 'codigo_materia es el código de la materia');
select is((select nombre_materia from public.mi_diagnostico('60000000-0000-0000-0000-000000000901')),
  'Materia Nueve Uno', 'nombre_materia es el nombre de la materia');
select is((select nombre_evaluacion from public.mi_diagnostico('60000000-0000-0000-0000-000000000901')),
  'Parcial Nueve Alfa', 'nombre_evaluacion es el nombre de la Evaluación');
select is((select fecha_realizacion from public.mi_diagnostico('60000000-0000-0000-0000-000000000901')),
  timestamptz '2026-10-05 08:30:00+00', 'fecha_realizacion es la del diagnóstico');
select is((select respondidas from public.mi_diagnostico('60000000-0000-0000-0000-000000000901')),
  8, 'respondidas es el largo de respuestas');
select is((select aciertos from public.mi_diagnostico('60000000-0000-0000-0000-000000000901')),
  5, 'aciertos son las preguntas acertadas');
select is((select resultado from public.mi_diagnostico('60000000-0000-0000-0000-000000000901')),
  (select resultado from esperado), 'resultado es lo guardado, sin tocar');
select is(
  (select array_agg(k order by k) from public.mi_diagnostico('60000000-0000-0000-0000-000000000901') r,
     lateral jsonb_object_keys(to_jsonb(r)) k),
  array['aciertos', 'codigo_materia', 'fecha_realizacion', 'id_diagnostico', 'nombre_evaluacion', 'nombre_materia', 'respondidas', 'resultado'],
  'La fila que llega tiene solo esas claves, aunque el diagnóstico guarde repetido, semilla, token y falta de material');

-- Nadie recibe lo que no existe, ni siquiera la dueña.
select is((select count(*)::int from public.mi_diagnostico('60000000-0000-0000-0000-0000000009ff')), 0,
  'Un id que no existe: 0 filas');
select is((select count(*)::int from public.mi_diagnostico(null)), 0, 'Un id nulo: 0 filas');

-- ---------------------------------------------------------------------------
-- Otra sesión sin relación (02)
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000000902","role":"authenticated","is_anonymous":true}';
select is((select count(*)::int from public.mi_diagnostico('60000000-0000-0000-0000-000000000901')), 0,
  'Otra sesión anónima no recibe el diagnóstico ajeno');
select is((select count(*)::int from public.mi_diagnostico('60000000-0000-0000-0000-000000000902')), 0,
  'Ni el que ya está ligado a un Lead');

-- ---------------------------------------------------------------------------
-- Un diagnóstico con id_lead (D-53 e, D-55 c)
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000000901","role":"authenticated","is_anonymous":true}';
select is((select count(*)::int from public.mi_diagnostico('60000000-0000-0000-0000-000000000902')), 1,
  'La sesión dueña lo sigue recibiendo después de que el Lead existe');

-- La cuenta de Estudiante del Lead lo recibe aunque lo haya hecho otra sesión (HU-033, D-55 c).
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000000907","role":"authenticated","is_anonymous":false}';
select is((select count(*)::int from public.mi_diagnostico('60000000-0000-0000-0000-000000000902')), 1,
  'La cuenta de Estudiante del Lead recibe el diagnóstico que otra sesión del Lead dejó ligado');
select is((select nombre_materia from public.mi_diagnostico('60000000-0000-0000-0000-000000000902')),
  'Materia Nueve Dos', 'Y es el de su materia');
select is((select count(*)::int from public.mi_diagnostico('60000000-0000-0000-0000-000000000901')), 0,
  'Pero no un diagnóstico sin Lead, aunque sea de una sesión cualquiera');

-- La sesión ligada por el enlace de P-23 (lead_sesion): la tabla se lo deja leer por es_mi_lead, la función no.
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000000903","role":"authenticated","is_anonymous":true}';
select is((select count(*)::int from public.diagnostico where id = '60000000-0000-0000-0000-000000000902'), 1,
  'La sesión ligada por lead_sesion sí lo lee con select (es el motivo de la función)');
select is((select count(*)::int from public.mi_diagnostico('60000000-0000-0000-0000-000000000902')), 0,
  'Pero con mi_diagnostico no: D-53 e la deja con los diagnósticos de su propia sesión');

-- La sesión que creó el Lead sin haber hecho el diagnóstico: igual.
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000000908","role":"authenticated","is_anonymous":true}';
select is((select count(*)::int from public.diagnostico where id = '60000000-0000-0000-0000-000000000902'), 1,
  'La sesión que creó el Lead sí lo lee con select');
select is((select count(*)::int from public.mi_diagnostico('60000000-0000-0000-0000-000000000902')), 0,
  'Pero con mi_diagnostico no: quien escribió primero el correo de otra persona no ve sus diagnósticos');

-- La cuenta de Estudiante de otro Lead.
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000000909","role":"authenticated","is_anonymous":false}';
select is((select count(*)::int from public.diagnostico where id = '60000000-0000-0000-0000-000000000902'), 0,
  'La cuenta de Estudiante de otro Lead no lo lee ni con select');
select is((select count(*)::int from public.mi_diagnostico('60000000-0000-0000-0000-000000000902')), 0,
  'Ni con mi_diagnostico');
reset role;

-- ---------------------------------------------------------------------------
-- Un monitor con cita y un admin leen la tabla, no la función
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000000904","role":"authenticated","is_anonymous":false}';
select is((select count(*)::int from public.diagnostico where id = '60000000-0000-0000-0000-000000000901'), 1,
  'El monitor de una cita que apunta al diagnóstico lo lee con select (RN-13)');
select is((select count(*)::int from public.mi_diagnostico('60000000-0000-0000-0000-000000000901')), 0,
  'Pero con mi_diagnostico no: el resultado de un estudiante no se le muestra como suyo');
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000000905","role":"authenticated","is_anonymous":false}';
select is((select count(*)::int from public.diagnostico where id = '60000000-0000-0000-0000-000000000901'), 1,
  'Un admin lo lee con select');
select is((select count(*)::int from public.mi_diagnostico('60000000-0000-0000-0000-000000000901')), 0,
  'Pero con mi_diagnostico no');

-- Un monitor o un admin que además es la sesión dueña de una fila: la tabla se la deja leer, la función no.
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000000906","role":"authenticated","is_anonymous":false}';
select is((select count(*)::int from public.diagnostico where id = '60000000-0000-0000-0000-000000000903'), 1,
  'Un monitor que es la sesión dueña de un diagnóstico lo lee con select');
select is((select count(*)::int from public.mi_diagnostico('60000000-0000-0000-0000-000000000903')), 0,
  'Pero con mi_diagnostico no: la cuenta del equipo no tiene resultados de estudiante');
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000000910","role":"authenticated","is_anonymous":false}';
select is((select count(*)::int from public.diagnostico where id = '60000000-0000-0000-0000-000000000904'), 1,
  'Un admin que es la sesión dueña de un diagnóstico lo lee con select');
select is((select count(*)::int from public.mi_diagnostico('60000000-0000-0000-0000-000000000904')), 0,
  'Pero con mi_diagnostico no');
reset role;

-- ---------------------------------------------------------------------------
-- Sin sesión
-- ---------------------------------------------------------------------------
set local role anon;
select throws_ok(
  $$select * from public.mi_diagnostico('60000000-0000-0000-0000-000000000901')$$,
  '42501', null, 'El visitante sin sesión: permiso denegado');
select throws_ok(
  $$select * from privado.mi_diagnostico('60000000-0000-0000-0000-000000000901')$$,
  '42501', null, 'Ni la de privado');
reset role;
set local role service_role;
select throws_ok(
  $$select * from public.mi_diagnostico('60000000-0000-0000-0000-000000000901')$$,
  '42501', null, 'La llave secreta no la ejecuta');
select throws_ok(
  $$select * from privado.mi_diagnostico('60000000-0000-0000-0000-000000000901')$$,
  '42501', null, 'Ni la de privado');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"role":"authenticated"}';
select is((select count(*)::int from public.mi_diagnostico('60000000-0000-0000-0000-000000000901')), 0,
  'Un token sin sub (auth.uid() nulo) no recibe nada');
reset role;

-- ---------------------------------------------------------------------------
-- Una Evaluación desactivada no cambia el resultado (HU-011 lo necesita)
-- ---------------------------------------------------------------------------
update public.evaluacion set activa = false where id = '20000000-0000-0000-0000-000000000901';
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000000901","role":"authenticated","is_anonymous":true}';
select is((select count(*)::int from public.mi_diagnostico('60000000-0000-0000-0000-000000000901')), 1,
  'Con la Evaluación apagada el resultado sale igual');
select is((select nombre_evaluacion from public.mi_diagnostico('60000000-0000-0000-0000-000000000901')),
  'Parcial Nueve Alfa', 'Con su nombre');
select is((select resultado from public.mi_diagnostico('60000000-0000-0000-0000-000000000901')),
  (select resultado from esperado), 'Y el mismo resultado guardado');
reset role;

select * from finish();
rollback;
