-- Pruebas pgTAP de recuperar los resultados con el enlace del correo (HU-031): public.resultado_por_token(p_token).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.
--
-- Lo que se prueba: que el token de un diagnóstico con Lead devuelve una sola fila con las 8 columnas de la lectura del dueño y
-- nada más (ni token, ni semilla, ni repetido, ni falta de material, ni puntaje, ni datos del Lead); que un token de un diagnóstico
-- sin Lead, uno inventado, uno vacío o nulo, el id del diagnóstico y el token en mayúsculas no devuelven nada; que desactivar la
-- Evaluación no cambia el resultado (criterio 9); que si el Lead se borra el enlace deja de servir (RN-12, D-20); y que solo
-- service_role la ejecuta, igual que cita_por_token, y que el token sigue sin grant de lectura para anon y authenticated.
--
-- La función se llama como service_role, que es quien la usa en producción: así también se prueba que tiene los permisos de tabla
-- que necesita (security invoker).
--
-- Elenco (ids terminados en 0031NN):
--   sesión c0000000-...-000031: dueña de los tres diagnósticos (auth.users).
--   Leads 40000000-...-0031NN: 01 y 02. Materias 10000000-...-0031NN: 01 y 02, con nombres y códigos distintos entre sí.
--   Evaluaciones 20000000-...-0031NN: 01 de la materia 01 y 02 de la materia 02.
--   Diagnósticos 60000000-...-0031NN: 01 del Lead 1 (8 respondidas, 5 aciertos, repetido, con falta de material; token 9a...),
--     02 del Lead 2 en la materia 02 (3 respondidas, 1 acierto; token 9c...) y 03 sin Lead (token 9b...).

begin;
create extension if not exists pgtap with schema extensions;

select plan(25);

-- ---------------------------------------------------------------------------
-- Fixtures (como postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, is_anonymous) values ('c0000000-0000-0000-0000-000000000031', true);

insert into public.materia (id, nombre, codigo) values
  ('10000000-0000-0000-0000-000000000031', 'Materia Treinta y Uno A', 'PGTAP-31-A'),
  ('10000000-0000-0000-0000-000000000032', 'Materia Treinta y Uno B', 'PGTAP-31-B');
insert into public.evaluacion (id, id_materia, semana, nombre) values
  ('20000000-0000-0000-0000-000000000031', '10000000-0000-0000-0000-000000000031', 5, 'Parcial Treinta y Uno Alfa'),
  ('20000000-0000-0000-0000-000000000032', '10000000-0000-0000-0000-000000000032', 7, 'Parcial Treinta y Uno Beta');
update public.evaluacion set activa = true
where id in ('20000000-0000-0000-0000-000000000031', '20000000-0000-0000-0000-000000000032');

insert into public.lead (id, id_sesion_anonima, nombre, correo, acepta_tratamiento_datos, fecha_consentimiento) values
  ('40000000-0000-0000-0000-000000000031', null, 'Lead Uno HU-031', 'lead31-1@example.com', true, now()),
  ('40000000-0000-0000-0000-000000000032', null, 'Lead Dos HU-031', 'lead31-2@example.com', true, now());

-- Tokens fijos de 64 hexadecimales en minúscula, para poder pedirlos, pasarlos a mayúsculas e inventar otros.
insert into public.diagnostico (id, id_lead, id_sesion_anonima, id_evaluacion, id_materia, respuestas, fecha_realizacion, puntaje,
                                resultado_por_habilidad, semilla, aciertos, repetido, falta_material, token_recuperacion)
values
  ('60000000-0000-0000-0000-000000000031', '40000000-0000-0000-0000-000000000031', 'c0000000-0000-0000-0000-000000000031',
   '20000000-0000-0000-0000-000000000031', '10000000-0000-0000-0000-000000000031',
   (select jsonb_agg(jsonb_build_object('clave', 'P' || n)) from generate_series(1, 8) n),
   timestamptz '2026-10-05 08:30:00+00', 62.5,
   '{"habilidades":[{"habilidad":"regla-cadena","descripcion":"Derivar una función compuesta","nivel":"en_proceso","respuestas":3,"aciertos":2}],"errores":[],"prerrequisitos":[]}'::jsonb,
   123456, 5, true, '[{"habilidad":"potencia","motivos":["tope_una_respuesta"]}]'::jsonb, repeat('9a', 32));
insert into public.diagnostico (id, id_lead, id_sesion_anonima, id_evaluacion, id_materia, respuestas, fecha_realizacion, puntaje,
                                resultado_por_habilidad, semilla, aciertos, token_recuperacion)
values
  ('60000000-0000-0000-0000-000000000032', '40000000-0000-0000-0000-000000000032', 'c0000000-0000-0000-0000-000000000031',
   '20000000-0000-0000-0000-000000000032', '10000000-0000-0000-0000-000000000032',
   '[{"clave":"P1"},{"clave":"P2"},{"clave":"P3"}]'::jsonb, timestamptz '2026-10-06 15:00:00+00', 33.33,
   '{"habilidades":[],"errores":[],"prerrequisitos":[]}'::jsonb, 7, 1, repeat('9c', 32)),
  ('60000000-0000-0000-0000-000000000033', null, 'c0000000-0000-0000-0000-000000000031',
   '20000000-0000-0000-0000-000000000031', '10000000-0000-0000-0000-000000000031',
   '[{"clave":"P1"},{"clave":"P2"}]'::jsonb, timestamptz '2026-10-07 09:00:00+00', 50,
   '{"habilidades":[],"errores":[],"prerrequisitos":[]}'::jsonb, 8, 1, repeat('9b', 32));

-- ---------------------------------------------------------------------------
-- Estructura y permisos
-- ---------------------------------------------------------------------------
select has_function('public', 'resultado_por_token', array['text'], 'Existe public.resultado_por_token(text)');
select ok(
  (select not prosecdef and provolatile = 's' and 'search_path=""' = any(coalesce(proconfig, '{}'))
   from pg_proc where oid = 'public.resultado_por_token(text)'::regprocedure),
  'Corre con los permisos de quien llama (security invoker), es stable y fija un search_path vacío');
select is(
  pg_get_function_result('public.resultado_por_token(text)'::regprocedure),
  'TABLE(id_diagnostico uuid, codigo_materia text, nombre_materia text, nombre_evaluacion text, fecha_realizacion timestamp with time zone, respondidas integer, aciertos integer, resultado jsonb)',
  'Devuelve exactamente esas 8 columnas: ni token, semilla, repetido, falta de material, puntaje ni datos del Lead');
select is(
  pg_get_function_identity_arguments('public.resultado_por_token(text)'::regprocedure),
  'p_token text',
  'Solo recibe el token');
select ok(
  not has_function_privilege('anon', 'public.resultado_por_token(text)', 'execute'),
  'El visitante sin sesión no la ejecuta');
select ok(
  not has_function_privilege('authenticated', 'public.resultado_por_token(text)', 'execute'),
  'Una sesión (anónima o de cuenta) tampoco: no controlan de quién es el token');
select ok(
  has_function_privilege('service_role', 'public.resultado_por_token(text)', 'execute'),
  'La llave secreta sí la ejecuta: la página /resultados corre en el servidor');
select ok(
  not has_column_privilege('anon', 'public.diagnostico', 'token_recuperacion', 'select')
  and not has_column_privilege('authenticated', 'public.diagnostico', 'token_recuperacion', 'select'),
  'El token de recuperación sigue sin grant de lectura para anon y authenticated (RN-12)');

-- ---------------------------------------------------------------------------
-- Un diagnóstico con Lead, pedido con su token (como service_role)
-- ---------------------------------------------------------------------------
set local role service_role;
select is((select count(*)::int from public.resultado_por_token(repeat('9a', 32))), 1,
  'El token de un diagnóstico con Lead devuelve exactamente una fila');
select results_eq(
  $$select id_diagnostico, codigo_materia, nombre_materia, nombre_evaluacion, fecha_realizacion, respondidas, aciertos, resultado
    from public.resultado_por_token(repeat('9a', 32))$$,
  $$values ('60000000-0000-0000-0000-000000000031'::uuid, 'PGTAP-31-A'::text, 'Materia Treinta y Uno A'::text,
            'Parcial Treinta y Uno Alfa'::text, timestamptz '2026-10-05 08:30:00+00', 8, 5,
            '{"habilidades":[{"habilidad":"regla-cadena","descripcion":"Derivar una función compuesta","nivel":"en_proceso","respuestas":3,"aciertos":2}],"errores":[],"prerrequisitos":[]}'::jsonb)$$,
  'Trae el id, el código y el nombre de la materia, el nombre de la Evaluación, la fecha, las respondidas, los aciertos y el resultado guardado');
select is(
  (select array_agg(k order by k) from public.resultado_por_token(repeat('9a', 32)) r, lateral jsonb_object_keys(to_jsonb(r)) k),
  array['aciertos', 'codigo_materia', 'fecha_realizacion', 'id_diagnostico', 'nombre_evaluacion', 'nombre_materia', 'respondidas', 'resultado'],
  'La fila tiene solo esas claves, aunque el diagnóstico guarde token, semilla, repetido, falta de material, puntaje y un Lead');

-- Cero filas, sin distinguir el motivo.
select is((select count(*)::int from public.resultado_por_token(repeat('9b', 32))), 0,
  'El token de un diagnóstico sin Lead: 0 filas');
select is((select count(*)::int from public.resultado_por_token(repeat('9d', 32))), 0,
  'Un token inexistente de 64 hexadecimales: 0 filas');
select is((select count(*)::int from public.resultado_por_token('')), 0, 'Una cadena vacía: 0 filas');
select is((select count(*)::int from public.resultado_por_token('60000000-0000-0000-0000-000000000031')), 0,
  'El id del diagnóstico en lugar del token: 0 filas');
select is((select count(*)::int from public.resultado_por_token(upper(repeat('9a', 32)))), 0,
  'El token en mayúsculas: 0 filas');
select is((select count(*)::int from public.resultado_por_token(null)), 0, 'Un token nulo: 0 filas');

-- Cada token trae su propio diagnóstico.
select is((select count(*)::int from public.resultado_por_token(repeat('9c', 32))), 1,
  'El token del diagnóstico de otro Lead devuelve una fila');
select is((select nombre_materia from public.resultado_por_token(repeat('9c', 32))), 'Materia Treinta y Uno B',
  'Y es el de su materia, no el del primer token');
reset role;

-- ---------------------------------------------------------------------------
-- La Evaluación desactivada no cambia el resultado (criterio 9)
-- ---------------------------------------------------------------------------
update public.evaluacion set activa = false where id = '20000000-0000-0000-0000-000000000031';
set local role service_role;
select is((select count(*)::int from public.resultado_por_token(repeat('9a', 32))), 1,
  'Con la Evaluación desactivada el token sigue devolviendo la fila');
select is((select nombre_evaluacion from public.resultado_por_token(repeat('9a', 32))), 'Parcial Treinta y Uno Alfa',
  'Con el nombre de la Evaluación');
reset role;

-- ---------------------------------------------------------------------------
-- Si el Lead se borra, sus diagnósticos caen con él y el enlace deja de servir (RN-12, D-20)
-- ---------------------------------------------------------------------------
delete from public.lead where id = '40000000-0000-0000-0000-000000000031';
set local role service_role;
select is((select count(*)::int from public.resultado_por_token(repeat('9a', 32))), 0,
  'Con el Lead borrado el token deja de devolver filas');
select is((select count(*)::int from public.resultado_por_token(repeat('9c', 32))), 1,
  'Y el de otro Lead sigue sirviendo');
reset role;

-- ---------------------------------------------------------------------------
-- Quien no es el servidor no la ejecuta
-- ---------------------------------------------------------------------------
set local role anon;
select throws_ok($$select * from public.resultado_por_token('abc')$$, '42501', null,
  'anon no puede pedir un resultado por token: permiso denegado');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000000031","role":"authenticated","is_anonymous":true}';
select throws_ok($$select * from public.resultado_por_token('abc')$$, '42501', null,
  'Una sesión autenticada tampoco: permiso denegado');
reset role;

select * from finish();
rollback;
