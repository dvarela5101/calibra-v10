-- Pruebas pgTAP de HU-005: banco de preguntas por habilidades.
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.

begin;
create extension if not exists pgtap with schema extensions;

select plan(66);

-- ---------------------------------------------------------------------------
-- 1. Estructura
-- ---------------------------------------------------------------------------
select has_table('public', t, 'Existe la tabla ' || t)
from unnest(array[
  'tema', 'habilidad', 'habilidad_prerrequisito', 'misconcepcion',
  'pregunta', 'pregunta_habilidad', 'opcion', 'evaluacion_tema'
]) as t;

select has_column('public', 'evaluacion', 'clave', 'evaluacion tiene la columna clave');
select has_column('public', 'evaluacion', 'activa', 'evaluacion tiene la columna activa');

select results_eq(
  $$select unnest(enum_range(null::public.estado_pregunta))::text$$,
  $$values ('borrador'), ('revisada'), ('retirada')$$,
  'Los estados de una pregunta: borrador, revisada y retirada');

select is(
  (select count(*)::int
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and c.relrowsecurity
     and c.relname = any (array[
       'tema', 'habilidad', 'habilidad_prerrequisito', 'misconcepcion',
       'pregunta', 'pregunta_habilidad', 'opcion', 'evaluacion_tema'
     ])),
  8,
  'RLS activa en las 8 tablas del banco');

-- ---------------------------------------------------------------------------
-- 2. Permisos: solo el servidor
-- ---------------------------------------------------------------------------
-- Ni por tabla ni por columna: así nadie con sesión alcanza la correcta, la misconcepción ni la solución.
select ok(
  not has_table_privilege('anon', 'public.' || t, 'select, insert, update, delete, truncate, references, trigger')
  and not has_any_column_privilege('anon', 'public.' || t, 'select, insert, update, references')
  and not has_table_privilege('authenticated', 'public.' || t, 'select, insert, update, delete, truncate, references, trigger')
  and not has_any_column_privilege('authenticated', 'public.' || t, 'select, insert, update, references'),
  'anon y authenticated no tienen ningún permiso sobre ' || t)
from unnest(array[
  'tema', 'habilidad', 'habilidad_prerrequisito', 'misconcepcion',
  'pregunta', 'pregunta_habilidad', 'opcion', 'evaluacion_tema'
]) as t;

select ok(
  has_table_privilege('service_role', 'public.' || t, 'select')
  and has_table_privilege('service_role', 'public.' || t, 'insert')
  and has_table_privilege('service_role', 'public.' || t, 'update')
  and has_table_privilege('service_role', 'public.' || t, 'delete'),
  'service_role lee y escribe ' || t)
from unnest(array[
  'tema', 'habilidad', 'habilidad_prerrequisito', 'misconcepcion',
  'pregunta', 'pregunta_habilidad', 'opcion', 'evaluacion_tema'
]) as t;

-- ---------------------------------------------------------------------------
-- 3. Datos de prueba (como postgres)
--   materias        10000000-...-051 (A) y -052 (B)
--   evaluación      20000000-...-051 (de A)
--   temas           50000000-...-051 (A) y -052 (B)
--   habilidades     60000000-...-051 (A) y -052 (B)
--   misconcepciones 70000000-...-051 (A) y -052 (B)
--   pregunta        80000000-...-051 (de A, revisada)
--   opciones        f0000000-...-051 a -054 (A a D de la pregunta; A es la correcta)
-- ---------------------------------------------------------------------------
insert into public.materia (id, nombre, codigo) values
  ('10000000-0000-0000-0000-000000000051', 'Cálculo HU-005', 'HU005-1'),
  ('10000000-0000-0000-0000-000000000052', 'Vectores HU-005', 'HU005-2');

-- Como la insertan hoy las pruebas y la integración: sin clave ni activa.
insert into public.evaluacion (id, id_materia, semana, nombre) values
  ('20000000-0000-0000-0000-000000000051', '10000000-0000-0000-0000-000000000051', 6, 'Parcial 1');
update public.evaluacion set clave = 'parcial-1' where id = '20000000-0000-0000-0000-000000000051';

insert into public.tema (id, id_materia, clave, nombre, orden) values
  ('50000000-0000-0000-0000-000000000051', '10000000-0000-0000-0000-000000000051', 'partes', 'Integración por partes', 1),
  ('50000000-0000-0000-0000-000000000052', '10000000-0000-0000-0000-000000000052', 'vectores', 'Vectores', 1);

insert into public.evaluacion_tema (id_evaluacion, id_tema, id_materia) values
  ('20000000-0000-0000-0000-000000000051', '50000000-0000-0000-0000-000000000051', '10000000-0000-0000-0000-000000000051');

insert into public.habilidad (id, id_materia, id_tema, clave, descripcion) values
  ('60000000-0000-0000-0000-000000000051', '10000000-0000-0000-0000-000000000051',
   '50000000-0000-0000-0000-000000000051', 'partes-formula', 'Aplicar uv − ∫v du'),
  ('60000000-0000-0000-0000-000000000052', '10000000-0000-0000-0000-000000000052',
   '50000000-0000-0000-0000-000000000052', 'producto-punto', 'Calcular un producto punto');

insert into public.misconcepcion (id, id_materia, id_habilidad, clave, descripcion) values
  ('70000000-0000-0000-0000-000000000051', '10000000-0000-0000-0000-000000000051',
   '60000000-0000-0000-0000-000000000051', 'signo-partes', 'te equivocas en el signo de uv − ∫v du'),
  ('70000000-0000-0000-0000-000000000052', '10000000-0000-0000-0000-000000000052',
   '60000000-0000-0000-0000-000000000052', 'suma-componentes', 'sumas las componentes en vez de multiplicarlas');

insert into public.pregunta (id, id_materia, id_tema, clave, enunciado, dificultad, estado, origen, revisor, solucion) values
  ('80000000-0000-0000-0000-000000000051', '10000000-0000-0000-0000-000000000051',
   '50000000-0000-0000-0000-000000000051', 'P1', 'En ∫ x·eˣ dx, el resultado es:', 2, 'revisada', 'humano',
   'prototipo', 'con u = x y dv = eˣ dx');

insert into public.pregunta_habilidad (id_pregunta, id_habilidad, id_materia) values
  ('80000000-0000-0000-0000-000000000051', '60000000-0000-0000-0000-000000000051', '10000000-0000-0000-0000-000000000051');

insert into public.opcion (id, id_pregunta, id_materia, letra, texto, correcta, id_misconcepcion, error) values
  ('f0000000-0000-0000-0000-000000000051', '80000000-0000-0000-0000-000000000051', '10000000-0000-0000-0000-000000000051',
   'A', 'x·eˣ − eˣ + C', true, null, null),
  ('f0000000-0000-0000-0000-000000000052', '80000000-0000-0000-0000-000000000051', '10000000-0000-0000-0000-000000000051',
   'B', 'x·eˣ + eˣ + C', false, '70000000-0000-0000-0000-000000000051', null),
  ('f0000000-0000-0000-0000-000000000053', '80000000-0000-0000-0000-000000000051', '10000000-0000-0000-0000-000000000051',
   'C', 'eˣ + C', false, '70000000-0000-0000-0000-000000000051', 'olvidas el término uv'),
  ('f0000000-0000-0000-0000-000000000054', '80000000-0000-0000-0000-000000000051', '10000000-0000-0000-0000-000000000051',
   'D', 'x²·eˣ/2 + C', false, '70000000-0000-0000-0000-000000000051', null);

-- ---------------------------------------------------------------------------
-- 4. Restricciones
-- ---------------------------------------------------------------------------
-- La B pasa a correcta (sin misconcepción ni error, así que solo choca con la regla de una correcta).
select throws_ok(
  $$update public.opcion set correcta = true, id_misconcepcion = null, error = null
    where id = 'f0000000-0000-0000-0000-000000000052'$$,
  '23505', 'duplicate key value violates unique constraint "opcion_una_correcta_key"',
  'Una pregunta no puede tener dos opciones correctas');
select throws_ok(
  $$update public.opcion set id_misconcepcion = '70000000-0000-0000-0000-000000000051'
    where id = 'f0000000-0000-0000-0000-000000000051'$$,
  '23514', 'new row for relation "opcion" violates check constraint "opcion_misconcepcion_segun_correcta"',
  'La opción correcta no lleva misconcepción');
select throws_ok(
  $$update public.opcion set id_misconcepcion = null where id = 'f0000000-0000-0000-0000-000000000052'$$,
  '23514', 'new row for relation "opcion" violates check constraint "opcion_misconcepcion_segun_correcta"',
  'Una opción incorrecta siempre lleva su misconcepción');
select throws_ok(
  $$update public.opcion set id_misconcepcion = '70000000-0000-0000-0000-000000000052'
    where id = 'f0000000-0000-0000-0000-000000000052'$$,
  '23503', 'insert or update on table "opcion" violates foreign key constraint "opcion_misconcepcion_fk"',
  'Una opción no puede ofrecer una misconcepción de otra materia');

select throws_ok(
  $$insert into public.pregunta (id_materia, id_tema, clave, enunciado, dificultad, estado, origen, revisor)
    values ('10000000-0000-0000-0000-000000000051', '50000000-0000-0000-0000-000000000051', 'P9', 'Enunciado', 4,
            'revisada', 'humano', 'prototipo')$$,
  '23514', 'new row for relation "pregunta" violates check constraint "pregunta_dificultad_rango"',
  'La dificultad va de 1 a 3');
select throws_ok(
  $$insert into public.pregunta (id_materia, id_tema, clave, enunciado, dificultad, estado, origen)
    values ('10000000-0000-0000-0000-000000000051', '50000000-0000-0000-0000-000000000051', 'P9', 'Enunciado', 2,
            'revisada', 'humano')$$,
  '23514', 'new row for relation "pregunta" violates check constraint "pregunta_revisada_con_revisor"',
  'Una pregunta revisada dice quién la revisó');
select throws_ok(
  $$insert into public.pregunta (id_materia, id_tema, clave, enunciado, dificultad, estado, origen)
    values ('10000000-0000-0000-0000-000000000051', '50000000-0000-0000-0000-000000000051', 'P9', 'Enunciado', 2,
            'borrador', 'ia')$$,
  '23514', 'new row for relation "pregunta" violates check constraint "pregunta_origen_formato"',
  'El origen es "humano" o "ia (<modelo>)"');
select lives_ok(
  $$insert into public.pregunta (id_materia, id_tema, clave, enunciado, dificultad, estado, origen)
    values ('10000000-0000-0000-0000-000000000051', '50000000-0000-0000-0000-000000000051', 'P9', 'Enunciado', 2,
            'borrador', 'ia (sonnet-5.5)')$$,
  'Un borrador de IA se guarda sin revisor ni solución');

select throws_ok(
  $$insert into public.evaluacion_tema (id_evaluacion, id_tema, id_materia)
    values ('20000000-0000-0000-0000-000000000051', '50000000-0000-0000-0000-000000000052', '10000000-0000-0000-0000-000000000051')$$,
  '23503', 'insert or update on table "evaluacion_tema" violates foreign key constraint "evaluacion_tema_tema_fk"',
  'P-18: una evaluación no incluye temas de otra materia');
select throws_ok(
  $$insert into public.pregunta_habilidad (id_pregunta, id_habilidad, id_materia)
    values ('80000000-0000-0000-0000-000000000051', '60000000-0000-0000-0000-000000000052', '10000000-0000-0000-0000-000000000051')$$,
  '23503', 'insert or update on table "pregunta_habilidad" violates foreign key constraint "pregunta_habilidad_habilidad_fk"',
  'Una pregunta no mide habilidades de otra materia');

-- Claves únicas dentro de la materia.
select throws_ok(
  $$insert into public.tema (id_materia, clave, nombre, orden)
    values ('10000000-0000-0000-0000-000000000051', 'partes', 'Otro', 2)$$,
  '23505', 'duplicate key value violates unique constraint "tema_id_materia_clave_key"',
  'La clave de un tema no se repite en la materia');
select throws_ok(
  $$insert into public.habilidad (id_materia, id_tema, clave, descripcion)
    values ('10000000-0000-0000-0000-000000000051', '50000000-0000-0000-0000-000000000051', 'partes-formula', 'Otra')$$,
  '23505', 'duplicate key value violates unique constraint "habilidad_id_materia_clave_key"',
  'La clave de una habilidad no se repite en la materia');
select throws_ok(
  $$insert into public.misconcepcion (id_materia, id_habilidad, clave, descripcion)
    values ('10000000-0000-0000-0000-000000000051', '60000000-0000-0000-0000-000000000051', 'signo-partes', 'Otra')$$,
  '23505', 'duplicate key value violates unique constraint "misconcepcion_id_materia_clave_key"',
  'La clave de una misconcepción no se repite en la materia');
select throws_ok(
  $$insert into public.pregunta (id_materia, id_tema, clave, enunciado, dificultad, estado, origen, revisor)
    values ('10000000-0000-0000-0000-000000000051', '50000000-0000-0000-0000-000000000051', 'P1', 'Otra', 1,
            'revisada', 'humano', 'prototipo')$$,
  '23505', 'duplicate key value violates unique constraint "pregunta_id_materia_clave_key"',
  'La clave de una pregunta no se repite en la materia');
select throws_ok(
  $$insert into public.evaluacion (id_materia, semana, nombre, clave)
    values ('10000000-0000-0000-0000-000000000051', 12, 'Otra', 'parcial-1')$$,
  '23505', 'duplicate key value violates unique constraint "evaluacion_id_materia_clave_key"',
  'La clave de una evaluación no se repite en la materia');
select lives_ok(
  $$insert into public.tema (id_materia, clave, nombre, orden)
    values ('10000000-0000-0000-0000-000000000052', 'partes', 'Partes en la otra materia', 2)$$,
  'La misma clave sí puede estar en otra materia');

select throws_ok(
  $$insert into public.habilidad (id_materia, id_tema, clave, descripcion)
    values ('10000000-0000-0000-0000-000000000051', '50000000-0000-0000-0000-000000000051', 'Partes Formula', 'Otra')$$,
  '23514', 'new row for relation "habilidad" violates check constraint "habilidad_clave_formato"',
  'La clave de una habilidad va en minúsculas, dígitos, - y _');
select throws_ok(
  $$update public.evaluacion set clave = 'Parcial 1' where id = '20000000-0000-0000-0000-000000000051'$$,
  '23514', 'new row for relation "evaluacion" violates check constraint "evaluacion_clave_formato"',
  'La clave de una evaluación tiene el mismo formato');

select throws_ok(
  $$insert into public.habilidad_prerrequisito (id_habilidad, id_prerrequisito)
    values ('60000000-0000-0000-0000-000000000051', '60000000-0000-0000-0000-000000000051')$$,
  '23514', 'new row for relation "habilidad_prerrequisito" violates check constraint "habilidad_prerrequisito_distintos"',
  'Una habilidad no es prerrequisito de sí misma');
select lives_ok(
  $$insert into public.habilidad_prerrequisito (id_habilidad, id_prerrequisito)
    values ('60000000-0000-0000-0000-000000000052', '60000000-0000-0000-0000-000000000051')$$,
  'Un prerrequisito puede ser de otra materia');

select is(
  (select activa from public.evaluacion where id = '20000000-0000-0000-0000-000000000051'),
  false,
  'Una evaluación nace inactiva: la activa el convertidor');
select lives_ok(
  $$insert into public.evaluacion (id_materia, semana, nombre) values
      ('10000000-0000-0000-0000-000000000051', 3, 'Quiz sin clave'),
      ('10000000-0000-0000-0000-000000000051', 9, 'Otro quiz sin clave')$$,
  'Dos evaluaciones sin clave en la misma materia no chocan');

select throws_ok(
  $$delete from public.misconcepcion where id = '70000000-0000-0000-0000-000000000051'$$,
  '23503', 'update or delete on table "misconcepcion" violates foreign key constraint "opcion_misconcepcion_fk" on table "opcion"',
  'No se borra una misconcepción que alguna opción ofrece');

-- ---------------------------------------------------------------------------
-- 5. Sin sesión (anon): no alcanza el banco, sí la materia y la evaluación
-- ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';

select throws_ok($$select correcta from public.opcion$$, '42501', 'permission denied for table opcion',
  'anon no lee cuál opción es la correcta');
select throws_ok($$select id_misconcepcion from public.opcion$$, '42501', 'permission denied for table opcion',
  'anon no lee la misconcepción de una opción');
select throws_ok($$select error from public.opcion$$, '42501', 'permission denied for table opcion',
  'anon no lee el error de una opción');
select throws_ok($$select solucion from public.pregunta$$, '42501', 'permission denied for table pregunta',
  'anon no lee la solución de una pregunta');
select is(
  (select count(*)::int from public.materia
   where id in ('10000000-0000-0000-0000-000000000051', '10000000-0000-0000-0000-000000000052')),
  2, 'anon sigue leyendo las materias');
select is(
  (select activa from public.evaluacion where id = '20000000-0000-0000-0000-000000000051'),
  false, 'anon sigue leyendo las evaluaciones, con activa');

reset role;

-- ---------------------------------------------------------------------------
-- 6. Con sesión (authenticated): igual que anon
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"d0000000-0000-0000-0000-000000000051","role":"authenticated"}';

select throws_ok($$select correcta from public.opcion$$, '42501', 'permission denied for table opcion',
  'authenticated no lee cuál opción es la correcta');
select throws_ok($$select id_misconcepcion from public.opcion$$, '42501', 'permission denied for table opcion',
  'authenticated no lee la misconcepción de una opción');
select throws_ok($$select error from public.opcion$$, '42501', 'permission denied for table opcion',
  'authenticated no lee el error de una opción');
select throws_ok($$select solucion from public.pregunta$$, '42501', 'permission denied for table pregunta',
  'authenticated no lee la solución de una pregunta');
select is(
  (select count(*)::int from public.materia
   where id in ('10000000-0000-0000-0000-000000000051', '10000000-0000-0000-0000-000000000052')),
  2, 'authenticated sigue leyendo las materias');
select is(
  (select activa from public.evaluacion where id = '20000000-0000-0000-0000-000000000051'),
  false, 'authenticated sigue leyendo las evaluaciones, con activa');

reset role;

-- ---------------------------------------------------------------------------
-- 7. El servidor (service_role) lee el banco aunque no haya políticas
-- ---------------------------------------------------------------------------
set local role service_role;

select is(
  (select count(*)::int from public.opcion where id_pregunta = '80000000-0000-0000-0000-000000000051' and correcta),
  1, 'service_role lee las opciones, con la correcta');

reset role;

-- ---------------------------------------------------------------------------
-- 8. Borrar una materia se lleva su banco (así limpian las pruebas de integración)
-- ---------------------------------------------------------------------------
-- La evaluación no cae en cascada (puede tener diagnósticos): se borra antes.
delete from public.evaluacion where id_materia = '10000000-0000-0000-0000-000000000051';

select lives_ok(
  $$delete from public.materia where id = '10000000-0000-0000-0000-000000000051'$$,
  'Se borra la materia aunque sus opciones ofrezcan misconcepciones (la llave sin cascada no lo impide)');
select is(
  (select ((select count(*) from public.tema where id_materia = '10000000-0000-0000-0000-000000000051')
         + (select count(*) from public.habilidad where id_materia = '10000000-0000-0000-0000-000000000051')
         + (select count(*) from public.misconcepcion where id_materia = '10000000-0000-0000-0000-000000000051')
         + (select count(*) from public.pregunta where id_materia = '10000000-0000-0000-0000-000000000051')
         + (select count(*) from public.pregunta_habilidad where id_materia = '10000000-0000-0000-0000-000000000051')
         + (select count(*) from public.opcion where id_materia = '10000000-0000-0000-0000-000000000051')
         + (select count(*) from public.evaluacion_tema where id_materia = '10000000-0000-0000-0000-000000000051')
         + (select count(*) from public.habilidad_prerrequisito
            where id_prerrequisito = '60000000-0000-0000-0000-000000000051'))::int),
  0,
  'Con la materia se van sus temas, habilidades, prerrequisitos, misconcepciones, preguntas y opciones');

select * from finish();
rollback;
