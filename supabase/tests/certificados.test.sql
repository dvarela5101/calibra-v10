-- Pruebas pgTAP de los certificados que emite el admin (HU-014).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.

begin;
create extension if not exists pgtap with schema extensions;

select plan(24);

-- ---------------------------------------------------------------------------
-- Estructura y permisos
-- ---------------------------------------------------------------------------
select has_column('public', 'certificado', 'fecha_evaluacion', 'El certificado guarda la fecha de la evaluación presencial (P-19)');
select col_not_null('public', 'certificado', 'fecha_evaluacion', 'La fecha de la evaluación es obligatoria');
select ok(
  has_column_privilege('authenticated', 'public.certificado', 'fecha_evaluacion', 'insert')
  and has_column_privilege('authenticated', 'public.certificado', 'id_monitor', 'insert')
  and has_column_privilege('authenticated', 'public.certificado', 'id_materia', 'insert'),
  'Con sesión se puede pedir insertar un certificado (la política dice quién)');
select ok(not has_column_privilege('authenticated', 'public.certificado', 'fecha_emision', 'insert'),
  'La fecha de emisión la pone la base');
select ok(
  not has_table_privilege('authenticated', 'public.certificado', 'update')
  and not has_table_privilege('authenticated', 'public.certificado', 'delete'),
  'Nadie con sesión cambia ni borra certificados (revocar está fuera de alcance)');
select ok(not has_table_privilege('anon', 'public.certificado', 'insert'), 'Sin sesión no se certifica');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'certificado' and cmd = 'INSERT'),
  1, 'Una sola política de inserción');

-- ---------------------------------------------------------------------------
-- Fixtures (como postgres): admin A y admin B, monitor M, materias 1 y 2.
-- ---------------------------------------------------------------------------
insert into auth.users (id, is_anonymous) values
  ('a0000000-0000-0000-0000-00000000140a', false),
  ('a0000000-0000-0000-0000-00000000140b', false),
  ('b0000000-0000-0000-0000-00000000140a', false);
insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-00000000140a', 'Admin A', 'admin-a@calibra.test', 9001401),
  ('a0000000-0000-0000-0000-00000000140b', 'Admin B', 'admin-b@calibra.test', 9001402);
insert into public.monitor (id, nombre) values ('b0000000-0000-0000-0000-00000000140a', 'Monitor M');
insert into public.materia (id, nombre, codigo) values
  ('10000000-0000-0000-0000-000000001401', 'Materia 1', 'PRB-1401'),
  ('10000000-0000-0000-0000-000000001402', 'Materia 2', 'PRB-1402');

create temporary table hoy as select (now() at time zone 'America/Bogota')::date as d;
grant select on hoy to authenticated, anon;

-- ---------------------------------------------------------------------------
-- El admin certifica (criterio 1)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-00000000140a","role":"authenticated"}';

select lives_ok(
  $$insert into public.certificado (id_monitor, id_materia, id_admin, fecha_evaluacion)
    select 'b0000000-0000-0000-0000-00000000140a', '10000000-0000-0000-0000-000000001401',
           'a0000000-0000-0000-0000-00000000140a', d - 3 from hoy$$,
  'Un admin certifica a un monitor en una materia');
select results_eq(
  $$select id_admin::text, fecha_emision, fecha_evaluacion from public.certificado
    where id_monitor = 'b0000000-0000-0000-0000-00000000140a' and id_materia = '10000000-0000-0000-0000-000000001401'$$,
  $$select 'a0000000-0000-0000-0000-00000000140a'::text, d, d - 3 from hoy$$,
  'Queda con el admin, la fecha de emisión (hoy en Bogotá) y la de la evaluación');
select ok(
  not exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'certificado' and column_name ~ 'venc'),
  'El certificado no tiene vencimiento (RN-21)');

-- Criterio 2: una sola vez por monitor y materia.
select throws_ok(
  $$insert into public.certificado (id_monitor, id_materia, id_admin, fecha_evaluacion)
    select 'b0000000-0000-0000-0000-00000000140a', '10000000-0000-0000-0000-000000001401',
           'a0000000-0000-0000-0000-00000000140a', d from hoy$$,
  '23505', null, 'No se certifica dos veces al mismo monitor en la misma materia (RN-21)');

select throws_ok(
  $$insert into public.certificado (id_monitor, id_materia, id_admin, fecha_evaluacion)
    select 'b0000000-0000-0000-0000-00000000140a', '10000000-0000-0000-0000-000000001402',
           'a0000000-0000-0000-0000-00000000140a', d + 1 from hoy$$,
  '23514', null, 'La evaluación no puede ser posterior a la emisión');
select throws_ok(
  $$insert into public.certificado (id_monitor, id_materia, id_admin, fecha_evaluacion)
    select 'b0000000-0000-0000-0000-00000000140a', '10000000-0000-0000-0000-000000001402',
           'a0000000-0000-0000-0000-00000000140b', d from hoy$$,
  '42501', null, 'Un admin no certifica a nombre de otro');
select throws_ok(
  $$insert into public.certificado (id_monitor, id_materia, id_admin, fecha_emision)
    values ('b0000000-0000-0000-0000-00000000140a', '10000000-0000-0000-0000-000000001402',
            'a0000000-0000-0000-0000-00000000140a', '2020-01-01')$$,
  '42501', null, 'La fecha de emisión no la escribe el admin');
select throws_ok(
  $$update public.certificado set fecha_evaluacion = fecha_evaluacion - 1
    where id_monitor = 'b0000000-0000-0000-0000-00000000140a'$$,
  '42501', null, 'El admin no cambia un certificado emitido');
select throws_ok(
  $$delete from public.certificado where id_monitor = 'b0000000-0000-0000-0000-00000000140a'$$,
  '42501', null, 'Ni lo borra');

-- El monitor no se certifica a sí mismo.
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-00000000140a","role":"authenticated"}';
select throws_ok(
  $$insert into public.certificado (id_monitor, id_materia, id_admin, fecha_evaluacion)
    select 'b0000000-0000-0000-0000-00000000140a', '10000000-0000-0000-0000-000000001402',
           'b0000000-0000-0000-0000-00000000140a', d from hoy$$,
  '42501', null, 'Un monitor no se certifica a sí mismo');

-- Criterio 3: el monitor ve sus materias certificadas.
select results_eq(
  $$select m.codigo from public.certificado c join public.materia m on m.id = c.id_materia
    where c.id_monitor = 'b0000000-0000-0000-0000-00000000140a'$$,
  $$values ('PRB-1401'::text)$$,
  'El monitor lee sus certificados con su materia');

reset role;
set local role anon;
select throws_ok(
  $$insert into public.certificado (id_monitor, id_materia, id_admin)
    values ('b0000000-0000-0000-0000-00000000140a', '10000000-0000-0000-0000-000000001402', 'a0000000-0000-0000-0000-00000000140a')$$,
  '42501', null, 'Sin sesión no se certifica');
reset role;

-- ---------------------------------------------------------------------------
-- Admin desactivado (RN-23)
-- ---------------------------------------------------------------------------
update auth.users set banned_until = now() + interval '100 years' where id = 'a0000000-0000-0000-0000-00000000140a';

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-00000000140a","role":"authenticated"}';
select throws_ok(
  $$insert into public.certificado (id_monitor, id_materia, id_admin, fecha_evaluacion)
    select 'b0000000-0000-0000-0000-00000000140a', '10000000-0000-0000-0000-000000001402',
           'a0000000-0000-0000-0000-00000000140a', d from hoy$$,
  '42501', null, 'Un admin desactivado ya no certifica');

-- Criterio 4: lo que emitió sigue vigente.
reset role;
set local role anon;
select is(
  (select count(*)::int from public.certificado where id_admin = 'a0000000-0000-0000-0000-00000000140a'),
  1, 'Los certificados de un admin desactivado siguen a la vista (RN-23)');
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-00000000140a","role":"authenticated"}';
select lives_ok(
  $$insert into public.franja (id_monitor, dia, hora, presencial, precio, duracion_min, lugar)
    values ('b0000000-0000-0000-0000-00000000140a', 2, '10:00', true, 25000, 60, 'Salón')$$,
  'Y el monitor sigue abriendo franjas con ese certificado');

-- Otro admin activo sí certifica en la otra materia.
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-00000000140b","role":"authenticated"}';
select lives_ok(
  $$insert into public.certificado (id_monitor, id_materia, id_admin, fecha_evaluacion)
    select 'b0000000-0000-0000-0000-00000000140a', '10000000-0000-0000-0000-000000001402',
           'a0000000-0000-0000-0000-00000000140b', d from hoy$$,
  'Otro admin activo certifica al mismo monitor en otra materia (varias materias por monitor)');
reset role;

-- ---------------------------------------------------------------------------
-- Semilla local (D-2): materias de prueba para certificar
-- ---------------------------------------------------------------------------
select ok(
  (select count(*) from public.materia where codigo in ('MATE-1214', 'MATE-1207', 'FISI-1018')) = 3,
  'La semilla local trae materias de prueba (corre tras supabase db reset)');

select * from finish();
rollback;
