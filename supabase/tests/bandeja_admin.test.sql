-- Pruebas pgTAP de la bandeja del admin (HU-012): vista desembolsos_ejecutables (RN-83) y semilla.
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.

begin;
create extension if not exists pgtap with schema extensions;

select plan(17);

-- ---------------------------------------------------------------------------
-- 1. Estructura y permisos
-- ---------------------------------------------------------------------------
select has_view('public', 'desembolsos_ejecutables', 'Existe la vista desembolsos_ejecutables');

select is(
  (select reloptions from pg_class where oid = 'public.desembolsos_ejecutables'::regclass),
  array['security_invoker=true'],
  'La vista corre con los permisos de quien consulta');

select is(
  (select array_agg(attname::text order by attnum) from pg_attribute
   where attrelid = 'public.desembolsos_ejecutables'::regclass and attnum > 0 and not attisdropped),
  array['id', 'id_monitoria', 'monto_neto', 'fecha_generacion', 'desembolsable_desde', 'fecha_sesion'],
  'Solo expone lo que la bandeja necesita: nada de bruto, comisión ni llave del monitor');

select ok(
  not has_table_privilege('anon', 'public.desembolsos_ejecutables', 'select')
  and has_table_privilege('authenticated', 'public.desembolsos_ejecutables', 'select')
  and has_table_privilege('service_role', 'public.desembolsos_ejecutables', 'select')
  and not has_table_privilege('authenticated', 'public.desembolsos_ejecutables', 'insert'),
  'Solo lectura y sin acceso para anon');

-- ---------------------------------------------------------------------------
-- 2. Semilla (criterio 3): existen los admins iniciales con su orden de revisión
--    Corre tras `supabase db reset` o sobre una base nueva.
-- ---------------------------------------------------------------------------
select results_eq(
  $$select correo, orden_revision from public.admin
    where correo in ('admin1@calibra.test', 'admin2@calibra.test') order by orden_revision$$,
  $$values ('admin1@calibra.test'::text, 1), ('admin2@calibra.test'::text, 2)$$,
  'La semilla crea los admins iniciales con su ordenRevision (1 y 2)');

select is(
  (select count(*)::int
   from public.admin a
   join auth.users u on u.id = a.id
   join auth.identities i on i.user_id = u.id and i.provider = 'email'
   where a.correo in ('admin1@calibra.test', 'admin2@calibra.test')
     and u.email_confirmed_at is not null
     and u.encrypted_password is not null),
  2,
  'Cada admin de la semilla es una cuenta de Auth confirmada, con identidad de correo y contraseña');

-- ---------------------------------------------------------------------------
-- 3. Fixtures (como postgres)
--    admin a0..01, monitor b0..01, sesión anónima c0..0a. Franja: lunes 10:00, 60 min.
--    Monitorías todas en lunes. Las pasadas (2020) ya cumplieron la ventana de 24 h; la de 2030 no.
-- ---------------------------------------------------------------------------
insert into auth.users (id, is_anonymous) values
  ('a0000000-0000-0000-0000-000000000001', false),
  ('b0000000-0000-0000-0000-000000000001', false),
  ('c0000000-0000-0000-0000-00000000000a', true);

insert into public.materia (id, nombre, codigo) values ('10000000-0000-0000-0000-000000000001', 'Materia', 'PRB-1');
-- orden_revision es único y la semilla usa 1 y 2: aquí, números altos.
insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-000000000001', 'Admin Prueba', 'admin@example.com', 9000001);
insert into public.monitor (id, nombre) values ('b0000000-0000-0000-0000-000000000001', 'Monitor Uno');
insert into public.monitor_privado (id_monitor, numero_telefono, correo, llave) values
  ('b0000000-0000-0000-0000-000000000001', '3000000001', 'm1@example.com', 'llave-m1');
insert into public.certificado (id_monitor, id_materia, id_admin) values
  ('b0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001');
insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min) values
  ('30000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 1, '10:00', true, 25000, 60);
insert into public.lead (id, id_sesion_anonima, nombre, correo, acepta_tratamiento_datos, fecha_consentimiento) values
  ('40000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000a', 'Lead A', 'a@example.com', true, now());

-- M1 pasada, sin reporte: ejecutable.            M2 futura (2030): no.
-- M3 pasada con reporte en revisión: no.          M4 pasada con reporte aceptado: no.
-- M5 pasada con reporte rechazado: ejecutable.    M6 desembolso ya desembolsado: no.
-- M7 desembolso anulado: no.
insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado, fecha_finalizacion) values
  ('50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-00000000000a', '2020-01-06', 25000, 'realizada', '2020-01-06 16:30:00+00'),
  ('50000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-00000000000a', '2020-01-20', 25000, 'realizada', '2020-01-20 16:30:00+00'),
  ('50000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-00000000000a', '2020-01-27', 25000, 'realizada', '2020-01-27 16:30:00+00'),
  ('50000000-0000-0000-0000-000000000005', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-00000000000a', '2020-02-03', 25000, 'realizada', '2020-02-03 16:30:00+00'),
  ('50000000-0000-0000-0000-000000000006', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-00000000000a', '2020-02-10', 25000, 'realizada', '2020-02-10 16:30:00+00'),
  ('50000000-0000-0000-0000-000000000007', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-00000000000a', '2020-02-17', 25000, 'realizada', '2020-02-17 16:30:00+00');
insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total) values
  ('50000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-00000000000a', '2030-01-07', 25000);

insert into public.desembolso (id_monitoria, monto_bruto, comision, monto_neto, llave_destino, estado, id_admin, fecha_desembolso, referencia_transferencia) values
  ('50000000-0000-0000-0000-000000000001', 25000, 2500, 22500, 'llave-m1', 'pendiente', null, null, null),
  ('50000000-0000-0000-0000-000000000002', 25000, 2500, 22500, 'llave-m1', 'pendiente', null, null, null),
  ('50000000-0000-0000-0000-000000000003', 25000, 2500, 22500, 'llave-m1', 'pendiente', null, null, null),
  ('50000000-0000-0000-0000-000000000004', 25000, 2500, 22500, 'llave-m1', 'pendiente', null, null, null),
  ('50000000-0000-0000-0000-000000000005', 25000, 2500, 22500, 'llave-m1', 'pendiente', null, null, null),
  ('50000000-0000-0000-0000-000000000006', 25000, 2500, 22500, 'llave-m1', 'desembolsado', 'a0000000-0000-0000-0000-000000000001', now(), 'REF-1'),
  ('50000000-0000-0000-0000-000000000007', 25000, 2500, 22500, 'llave-m1', 'anulado', null, null, null);

insert into public.reporte_inasistencia (id_monitoria, id_admin, estado, fecha_decision) values
  ('50000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'en_revision', null),
  ('50000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'aceptado', now()),
  ('50000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'rechazado', now());

-- ---------------------------------------------------------------------------
-- 4. Qué desembolsos son ejecutables (RN-83)
-- ---------------------------------------------------------------------------
select results_eq(
  $$select id_monitoria::text from public.desembolsos_ejecutables
    where id_monitoria::text like '50000000-%' order by fecha_sesion$$,
  $$values ('50000000-0000-0000-0000-000000000001'), ('50000000-0000-0000-0000-000000000005')$$,
  'Son ejecutables el pendiente ya pasado sin reporte y el de un reporte rechazado, y ningún otro');

select is(
  (select count(*)::int from public.desembolsos_ejecutables where id_monitoria = '50000000-0000-0000-0000-000000000002'),
  0,
  'Un desembolso cuya ventana de 24 h no ha vencido no es ejecutable');

select is(
  (select count(*)::int from public.desembolsos_ejecutables where id_monitoria = '50000000-0000-0000-0000-000000000003'),
  0,
  'Con un reporte en revisión no es ejecutable');

select is(
  (select count(*)::int from public.desembolsos_ejecutables where id_monitoria = '50000000-0000-0000-0000-000000000004'),
  0,
  'Con un reporte aceptado no es ejecutable');

select is(
  (select count(*)::int from public.desembolsos_ejecutables where id_monitoria = '50000000-0000-0000-0000-000000000005'),
  1,
  'Con un reporte rechazado vuelve a ser ejecutable (HU-030)');

select is(
  (select count(*)::int from public.desembolsos_ejecutables where id_monitoria in
    ('50000000-0000-0000-0000-000000000006', '50000000-0000-0000-0000-000000000007')),
  0,
  'Un desembolso ya desembolsado o anulado no es ejecutable');

select results_eq(
  $$select monto_neto, fecha_sesion, desembolsable_desde from public.desembolsos_ejecutables
    where id_monitoria = '50000000-0000-0000-0000-000000000001'$$,
  $$values (22500, '2020-01-06'::date, '2020-01-07 16:00:00+00'::timestamptz)$$,
  'Trae el neto, la fecha de la sesión y desde cuándo es ejecutable (fin 11:00 Bogotá = 16:00 UTC, más 24 h)');

-- ---------------------------------------------------------------------------
-- 5. Quién la ve (RLS de desembolso y monitoria)
-- ---------------------------------------------------------------------------
set local role authenticated;

set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.desembolsos_ejecutables where id_monitoria::text like '50000000-%'), 2, 'Un admin ve los ejecutables');

set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.desembolsos_ejecutables), 0,
  'El monitor no los ve: los desembolsos son de los admins (P-32 sin decidir)');

set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-00000000000a","role":"authenticated","is_anonymous":true}';
select is((select count(*)::int from public.desembolsos_ejecutables), 0, 'Quien agendó tampoco los ve');

reset role;
set local role anon;
select throws_ok($$select * from public.desembolsos_ejecutables$$, '42501', null, 'Sin sesión (anon) no hay acceso');
reset role;

select * from finish();
rollback;
