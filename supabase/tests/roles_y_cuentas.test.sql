-- Pruebas pgTAP de roles y cuentas (HU-004).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.

begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

-- Fixtures: admin activo, admin desactivado (baneado en Auth), monitor,
-- estudiante (con su lead) y una sesión anónima.
insert into auth.users (id, is_anonymous, banned_until) values
  ('a0000000-0000-0000-0000-000000000001', false, null),
  ('a0000000-0000-0000-0000-000000000002', false, now() + interval '100 years'),
  ('b0000000-0000-0000-0000-000000000001', false, null),
  ('c0000000-0000-0000-0000-00000000000a', true, null),
  ('d0000000-0000-0000-0000-000000000001', false, null);

insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-000000000001', 'Admin activo', 'activo@calibra.test', 1),
  ('a0000000-0000-0000-0000-000000000002', 'Admin retirado', 'retirado@calibra.test', 2);

insert into public.monitor (id, nombre) values ('b0000000-0000-0000-0000-000000000001', 'Monitor uno');
insert into public.materia (id, nombre, codigo) values ('10000000-0000-0000-0000-000000000001', 'Materia', 'PRB-1');
-- El certificado lo emitió el admin que luego se retiró (RN-23).
insert into public.certificado (id_monitor, id_materia, id_admin) values
  ('b0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002');

insert into public.lead (id, nombre, correo, acepta_tratamiento_datos, fecha_consentimiento) values
  ('40000000-0000-0000-0000-000000000001', 'Estudiante', 'estudiante@calibra.test', true, now());
insert into public.estudiante (id, id_lead) values
  ('d0000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001');

-- ---------------------------------------------------------------------------
-- mi_rol() según quién llama
-- ---------------------------------------------------------------------------
set local role authenticated;

set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.mi_rol(), 'admin', 'mi_rol: admin activo es admin');
select is((select count(*)::int from public.lead), 1, 'Admin activo lee los leads');

set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is(public.mi_rol(), null, 'RN-23: admin desactivado ya no es admin aunque su token siga vigente');
select is((select count(*)::int from public.lead), 0, 'RN-23: admin desactivado no lee leads');

set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.mi_rol(), 'monitor', 'mi_rol: monitor');
select is((select count(*)::int from public.lead), 0, 'El monitor no lee leads');

set local request.jwt.claims to '{"sub":"d0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.mi_rol(), 'estudiante', 'mi_rol: estudiante');

set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-00000000000a","role":"authenticated","is_anonymous":true}';
select is(public.mi_rol(), 'anonimo', 'mi_rol: sesión anónima');

reset role;

-- El rol anon (sin sesión) no puede ni preguntar su rol.
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';
select throws_ok('select public.mi_rol()', '42501', null, 'mi_rol no se expone a anon');
reset role;

-- ---------------------------------------------------------------------------
-- RN-23: desactivar no borra
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from public.admin where id = 'a0000000-0000-0000-0000-000000000002'),
  1, 'RN-23: la fila del admin desactivado se conserva');
select is(
  (select count(*)::int from public.certificado where id_admin = 'a0000000-0000-0000-0000-000000000002'),
  1, 'RN-23: sus certificados se conservan');
select throws_ok(
  $$delete from auth.users where id = 'a0000000-0000-0000-0000-000000000002'$$,
  '23503', null,
  'RN-23: borrar la cuenta de un admin con certificados está bloqueado; se desactiva');

-- ---------------------------------------------------------------------------
-- Borrar una sesión anónima borra sus diagnósticos (antes el borrado fallaba)
-- ---------------------------------------------------------------------------
insert into public.evaluacion (id, id_materia, semana, nombre) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 1, 'Semana 1');
insert into public.diagnostico (id_sesion_anonima, id_evaluacion, respuestas, puntaje, resultado_por_tema) values
  ('c0000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000001', '{}', 50, '{}');
select lives_ok(
  $$delete from auth.users where id = 'c0000000-0000-0000-0000-00000000000a'$$,
  'Se puede borrar una sesión anónima con diagnósticos');
select is(
  (select count(*)::int from public.diagnostico where id_sesion_anonima = 'c0000000-0000-0000-0000-00000000000a'),
  0, 'Sus diagnósticos se borran con ella');

select * from finish();
rollback;
