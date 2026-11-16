-- Pruebas pgTAP de las cifras del banco que cita la portada (HU-134): qué cuenta cada conteo y que un visitante anónimo solo
-- recibe los tres números.
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.
--
-- La base local puede traer un banco real (HU-005), así que no se comparan totales: se toman los conteos «antes» y se comprueba la
-- diferencia que dejan las fixtures.
--
-- Elenco (ids terminados en 81NN o 8134/8135):
--   materia A 10000000-...-8134 y materia B -8135 (solo una Evaluación inactiva: no cuenta).
--   evaluaciones 20000000-...-81NN: 01 activa de la materia A (tema 1), 02 inactiva de la materia A (tema 2), 03 inactiva de B (tema 3).
--   temas 50000000-...-81NN: 01 y 02 (materia A), 03 (materia B). Habilidades 60000000-...-81NN: 01, 02 y 03 (una por tema).
--   misconcepciones 70000000-...-81NN: 01 y 02 (habilidad 1, las delatan P1 y P5), 03 (habilidad 1, solo P5), 04 (habilidad 2, solo P3),
--     05 (habilidad 1, solo P2: un borrador).
--   preguntas 80000000-...-81NN: P1 y P5 revisadas de la Evaluación activa (cuentan), P2 borrador, P3 revisada pero solo de la
--     Evaluación inactiva, P4 revisada sin ninguna habilidad, P6 retirada.

begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

-- ---------------------------------------------------------------------------
-- Estructura y permisos
-- ---------------------------------------------------------------------------
select has_function('privado', 'cifras_del_banco', array[]::text[], 'Existe privado.cifras_del_banco');
select has_function('public', 'cifras_del_banco', array[]::text[], 'Existe su puerta en la Data API');

select ok(
  (select prosecdef from pg_proc where oid = 'privado.cifras_del_banco()'::regprocedure)
  and not (select prosecdef from pg_proc where oid = 'public.cifras_del_banco()'::regprocedure),
  'La de privado es security definer; la puerta corre con los permisos de quien llama');

select ok(
  (select bool_and('search_path=""' = any(proconfig)) from pg_proc
   where oid in ('privado.cifras_del_banco()'::regprocedure, 'public.cifras_del_banco()'::regprocedure)),
  'Las dos fijan search_path vacío');

select is(
  pg_get_function_result('public.cifras_del_banco()'::regprocedure),
  'TABLE(materias integer, preguntas integer, errores integer)',
  'Devuelve solo los tres conteos');

select ok(
  has_function_privilege('anon', 'public.cifras_del_banco()', 'execute')
  and has_function_privilege('authenticated', 'public.cifras_del_banco()', 'execute')
  and has_function_privilege('service_role', 'public.cifras_del_banco()', 'execute')
  and has_function_privilege('anon', 'privado.cifras_del_banco()', 'execute')
  and has_function_privilege('service_role', 'privado.cifras_del_banco()', 'execute'),
  'Anon, authenticated y service_role pueden llamarla');

-- ---------------------------------------------------------------------------
-- Fixtures (como postgres)
-- ---------------------------------------------------------------------------
create temporary table antes as select materias, preguntas, errores from public.cifras_del_banco();
grant select on antes to anon, authenticated, service_role;

insert into public.materia (id, nombre, codigo) values
  ('10000000-0000-0000-0000-000000008134', 'Materia A HU-134', 'PGTAP-134A'),
  ('10000000-0000-0000-0000-000000008135', 'Materia B HU-134', 'PGTAP-134B');

insert into public.evaluacion (id, id_materia, semana, nombre) values
  ('20000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008134', 6, 'Parcial activo'),
  ('20000000-0000-0000-0000-000000008102', '10000000-0000-0000-0000-000000008134', 7, 'Parcial inactivo'),
  ('20000000-0000-0000-0000-000000008103', '10000000-0000-0000-0000-000000008135', 6, 'Parcial B inactivo');
update public.evaluacion set clave = 'activo', activa = true where id = '20000000-0000-0000-0000-000000008101';
update public.evaluacion set clave = 'inactivo' where id = '20000000-0000-0000-0000-000000008102';
update public.evaluacion set clave = 'inactivo-b' where id = '20000000-0000-0000-0000-000000008103';

insert into public.tema (id, id_materia, clave, nombre, orden) values
  ('50000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008134', 'uno', 'Uno', 1),
  ('50000000-0000-0000-0000-000000008102', '10000000-0000-0000-0000-000000008134', 'dos', 'Dos', 2),
  ('50000000-0000-0000-0000-000000008103', '10000000-0000-0000-0000-000000008135', 'tres', 'Tres', 1);

insert into public.evaluacion_tema (id_evaluacion, id_tema, id_materia) values
  ('20000000-0000-0000-0000-000000008101', '50000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008134'),
  ('20000000-0000-0000-0000-000000008102', '50000000-0000-0000-0000-000000008102', '10000000-0000-0000-0000-000000008134'),
  ('20000000-0000-0000-0000-000000008103', '50000000-0000-0000-0000-000000008103', '10000000-0000-0000-0000-000000008135');

insert into public.habilidad (id, id_materia, id_tema, clave, descripcion) values
  ('60000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008134', '50000000-0000-0000-0000-000000008101', 'h1', 'Habilidad 1'),
  ('60000000-0000-0000-0000-000000008102', '10000000-0000-0000-0000-000000008134', '50000000-0000-0000-0000-000000008102', 'h2', 'Habilidad 2'),
  ('60000000-0000-0000-0000-000000008103', '10000000-0000-0000-0000-000000008135', '50000000-0000-0000-0000-000000008103', 'h3', 'Habilidad 3');

insert into public.misconcepcion (id, id_materia, id_habilidad, clave, descripcion) values
  ('70000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008134', '60000000-0000-0000-0000-000000008101', 'm1', 'Error 1'),
  ('70000000-0000-0000-0000-000000008102', '10000000-0000-0000-0000-000000008134', '60000000-0000-0000-0000-000000008101', 'm2', 'Error 2'),
  ('70000000-0000-0000-0000-000000008103', '10000000-0000-0000-0000-000000008134', '60000000-0000-0000-0000-000000008101', 'm3', 'Error 3'),
  ('70000000-0000-0000-0000-000000008104', '10000000-0000-0000-0000-000000008134', '60000000-0000-0000-0000-000000008102', 'm4', 'Error 4'),
  ('70000000-0000-0000-0000-000000008105', '10000000-0000-0000-0000-000000008134', '60000000-0000-0000-0000-000000008101', 'm5', 'Error 5');

insert into public.pregunta (id, id_materia, id_tema, clave, enunciado, dificultad, estado, origen, revisor) values
  ('80000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008134', '50000000-0000-0000-0000-000000008101', 'P1', 'Enunciado P1', 1, 'revisada', 'humano', 'prueba'),
  ('80000000-0000-0000-0000-000000008102', '10000000-0000-0000-0000-000000008134', '50000000-0000-0000-0000-000000008101', 'P2', 'Enunciado P2', 1, 'borrador', 'humano', null),
  ('80000000-0000-0000-0000-000000008103', '10000000-0000-0000-0000-000000008134', '50000000-0000-0000-0000-000000008102', 'P3', 'Enunciado P3', 1, 'revisada', 'humano', 'prueba'),
  ('80000000-0000-0000-0000-000000008104', '10000000-0000-0000-0000-000000008134', '50000000-0000-0000-0000-000000008101', 'P4', 'Enunciado P4', 1, 'revisada', 'humano', 'prueba'),
  ('80000000-0000-0000-0000-000000008105', '10000000-0000-0000-0000-000000008134', '50000000-0000-0000-0000-000000008101', 'P5', 'Enunciado P5', 2, 'revisada', 'humano', 'prueba'),
  ('80000000-0000-0000-0000-000000008106', '10000000-0000-0000-0000-000000008134', '50000000-0000-0000-0000-000000008101', 'P6', 'Enunciado P6', 2, 'retirada', 'humano', null);

-- P4 no mide ninguna habilidad. P3 mide la del tema 2, que solo cubre la Evaluación inactiva.
insert into public.pregunta_habilidad (id_pregunta, id_habilidad, id_materia) values
  ('80000000-0000-0000-0000-000000008101', '60000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008134'),
  ('80000000-0000-0000-0000-000000008102', '60000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008134'),
  ('80000000-0000-0000-0000-000000008103', '60000000-0000-0000-0000-000000008102', '10000000-0000-0000-0000-000000008134'),
  ('80000000-0000-0000-0000-000000008105', '60000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008134'),
  ('80000000-0000-0000-0000-000000008106', '60000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008134');

-- La A es la correcta. P1 delata m1 (B y D) y m2 (C); P5, m1 (B) y m3 (C y D); P2, m5; P3, m4; P6, m1.
insert into public.opcion (id_pregunta, id_materia, letra, texto, correcta, id_misconcepcion) values
  ('80000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008134', 'A', 'P1-A', true, null),
  ('80000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008134', 'B', 'P1-B', false, '70000000-0000-0000-0000-000000008101'),
  ('80000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008134', 'C', 'P1-C', false, '70000000-0000-0000-0000-000000008102'),
  ('80000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008134', 'D', 'P1-D', false, '70000000-0000-0000-0000-000000008101'),
  ('80000000-0000-0000-0000-000000008105', '10000000-0000-0000-0000-000000008134', 'A', 'P5-A', true, null),
  ('80000000-0000-0000-0000-000000008105', '10000000-0000-0000-0000-000000008134', 'B', 'P5-B', false, '70000000-0000-0000-0000-000000008101'),
  ('80000000-0000-0000-0000-000000008105', '10000000-0000-0000-0000-000000008134', 'C', 'P5-C', false, '70000000-0000-0000-0000-000000008103'),
  ('80000000-0000-0000-0000-000000008105', '10000000-0000-0000-0000-000000008134', 'D', 'P5-D', false, '70000000-0000-0000-0000-000000008103'),
  ('80000000-0000-0000-0000-000000008102', '10000000-0000-0000-0000-000000008134', 'A', 'P2-A', true, null),
  ('80000000-0000-0000-0000-000000008102', '10000000-0000-0000-0000-000000008134', 'B', 'P2-B', false, '70000000-0000-0000-0000-000000008105'),
  ('80000000-0000-0000-0000-000000008103', '10000000-0000-0000-0000-000000008134', 'A', 'P3-A', true, null),
  ('80000000-0000-0000-0000-000000008103', '10000000-0000-0000-0000-000000008134', 'B', 'P3-B', false, '70000000-0000-0000-0000-000000008104'),
  ('80000000-0000-0000-0000-000000008106', '10000000-0000-0000-0000-000000008134', 'A', 'P6-A', true, null),
  ('80000000-0000-0000-0000-000000008106', '10000000-0000-0000-0000-000000008134', 'B', 'P6-B', false, '70000000-0000-0000-0000-000000008101');

-- ---------------------------------------------------------------------------
-- Qué cuenta cada conteo
-- ---------------------------------------------------------------------------
select is((select materias from public.cifras_del_banco()) - (select materias from antes), 1,
  'Materias: solo la que tiene una Evaluación activa (la B, con una inactiva, no cuenta)');
select is((select preguntas from public.cifras_del_banco()) - (select preguntas from antes), 2,
  'Preguntas: solo P1 y P5 (revisadas, de una Evaluación activa); no el borrador, la retirada, la de una Evaluación inactiva ni la sin habilidad');
select is((select errores from public.cifras_del_banco()) - (select errores from antes), 3,
  'Errores: m1, m2 y m3, una vez cada uno aunque varias opciones los repitan; no los de preguntas que no cuentan');

-- ---------------------------------------------------------------------------
-- Quién lo lee
-- ---------------------------------------------------------------------------
set local role anon;
select is(
  (select array[materias - (select materias from antes), preguntas - (select preguntas from antes), errores - (select errores from antes)]
   from public.cifras_del_banco()),
  array[1, 2, 3],
  'Un visitante anónimo recibe los mismos tres conteos');
select throws_ok('select 1 from public.pregunta limit 1', '42501', null, 'El anónimo sigue sin leer las preguntas');
select throws_ok('select 1 from public.opcion limit 1', '42501', null, 'Ni las opciones');
select throws_ok('select 1 from public.misconcepcion limit 1', '42501', null, 'Ni las misconcepciones');
reset role;

-- ---------------------------------------------------------------------------
-- Los conteos siguen al banco
-- ---------------------------------------------------------------------------
update public.pregunta set estado = 'retirada' where id = '80000000-0000-0000-0000-000000008101';
select is(
  (select array[preguntas - (select preguntas from antes), errores - (select errores from antes)] from public.cifras_del_banco()),
  array[1, 2],
  'Retirar P1 baja una pregunta y quita m2, que solo ella delataba; m1 sigue por P5');

update public.evaluacion set activa = true where id = '20000000-0000-0000-0000-000000008102';
select is(
  (select array[materias - (select materias from antes), preguntas - (select preguntas from antes), errores - (select errores from antes)]
   from public.cifras_del_banco()),
  array[1, 2, 3],
  'Activar la Evaluación del tema 2 suma P3 y m4, pero la materia ya contaba');

update public.evaluacion set activa = true where id = '20000000-0000-0000-0000-000000008103';
select is((select materias from public.cifras_del_banco()) - (select materias from antes), 2,
  'Activar la Evaluación de la materia B suma una materia aunque no tenga preguntas');

select * from finish();
rollback;
