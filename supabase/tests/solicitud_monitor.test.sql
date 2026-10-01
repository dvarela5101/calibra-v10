-- Pruebas pgTAP de HU-062: solicitudes de certificación de aspirantes a monitor.
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.

begin;
create extension if not exists pgtap with schema extensions;

select plan(49);

-- ---------------------------------------------------------------------------
-- 1. Estructura y permisos
-- ---------------------------------------------------------------------------
select has_table('public', 'solicitud_monitor', 'Existe la tabla solicitud_monitor');
select has_table('public', 'solicitud_monitor_materia', 'Existe la tabla solicitud_monitor_materia');

select results_eq(
  $$select unnest(enum_range(null::public.estado_solicitud_monitor))::text$$,
  $$values ('nueva'), ('contactada'), ('evaluada'), ('descartada')$$,
  'Los estados de una solicitud: nueva, contactada, evaluada y descartada');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.solicitud_monitor'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.solicitud_monitor_materia'::regclass),
  'Las dos tablas tienen RLS');

select ok(
  not has_table_privilege('anon', 'public.solicitud_monitor', 'select')
  and not has_table_privilege('anon', 'public.solicitud_monitor', 'insert')
  and not has_table_privilege('anon', 'public.solicitud_monitor_materia', 'select'),
  'Sin sesión (anon) no hay ningún permiso');

select ok(
  has_table_privilege('authenticated', 'public.solicitud_monitor', 'select')
  and not has_table_privilege('authenticated', 'public.solicitud_monitor', 'insert')
  and not has_table_privilege('authenticated', 'public.solicitud_monitor', 'delete')
  and not has_table_privilege('authenticated', 'public.solicitud_monitor_materia', 'insert'),
  'Una sesión solo puede leer (lo que le deje la política); nadie inserta ni borra con su sesión');

select ok(
  has_column_privilege('authenticated', 'public.solicitud_monitor', 'estado', 'update')
  and has_column_privilege('authenticated', 'public.solicitud_monitor', 'id_admin_actualizo', 'update')
  and not has_column_privilege('authenticated', 'public.solicitud_monitor', 'nombre', 'update')
  and not has_column_privilege('authenticated', 'public.solicitud_monitor', 'correo', 'update')
  and not has_column_privilege('authenticated', 'public.solicitud_monitor', 'actualizada_en', 'update'),
  'Con su sesión solo se cambia el estado y quién lo cambió');

select ok(
  has_function_privilege('service_role', 'public.crear_solicitud_monitor(text, text, text, uuid[], timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'public.crear_solicitud_monitor(text, text, text, uuid[], timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.crear_solicitud_monitor(text, text, text, uuid[], timestamptz)', 'execute'),
  'crear_solicitud_monitor(): solo el servidor (service_role)');

-- ---------------------------------------------------------------------------
-- 2. Datos de prueba
-- ---------------------------------------------------------------------------
insert into auth.users (id, is_anonymous, banned_until) values
  ('a0000000-0000-0000-0000-000000000621', false, null),
  ('a0000000-0000-0000-0000-000000000622', false, null),
  ('a0000000-0000-0000-0000-000000000623', false, now() + interval '100 years'),
  ('b0000000-0000-0000-0000-000000000621', false, null),
  ('c0000000-0000-0000-0000-000000000621', true, null);
insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-000000000621', 'Admin Uno', 'admin-0621@example.com', 9000621),
  ('a0000000-0000-0000-0000-000000000622', 'Admin Dos', 'admin-0622@example.com', 9000622),
  ('a0000000-0000-0000-0000-000000000623', 'Admin Desactivado', 'admin-0623@example.com', 9000623);
insert into public.monitor (id, nombre) values ('b0000000-0000-0000-0000-000000000621', 'Monitor HU-062');
insert into public.materia (id, nombre, codigo) values
  ('10000000-0000-0000-0000-000000000621', 'Cálculo HU-062', 'HU062-1'),
  ('10000000-0000-0000-0000-000000000622', 'Física HU-062', 'HU062-2');

-- ---------------------------------------------------------------------------
-- 3. Restricciones
-- ---------------------------------------------------------------------------
select throws_ok(
  $$insert into public.solicitud_monitor (nombre, correo, numero_telefono, acepta_tratamiento_datos, fecha_consentimiento)
    values ('  ', 'ana@example.com', '+570621000010', true, now())$$,
  '23514', null, 'El nombre no puede estar vacío');
select throws_ok(
  $$insert into public.solicitud_monitor (nombre, correo, numero_telefono, acepta_tratamiento_datos, fecha_consentimiento)
    values ('Ana', 'Ana@Example.com', '+570621000010', true, now())$$,
  '23514', null, 'El correo llega normalizado (en minúsculas)');
-- Con una sola arroba, para que no los frene la regla de una arroba sino la de los caracteres.
select throws_ok(
  $$insert into public.solicitud_monitor (nombre, correo, numero_telefono, acepta_tratamiento_datos, fecha_consentimiento)
    values ('Ana', 'ana@example.com?body=hola', '+570621000010', true, now())$$,
  '23514', null, 'El dominio no lleva ? ni = (en el mailto: del admin serían parámetros)');
select throws_ok(
  $$insert into public.solicitud_monitor (nombre, correo, numero_telefono, acepta_tratamiento_datos, fecha_consentimiento)
    values ('Ana', 'ana&cc=x@example.com', '+570621000010', true, now())$$,
  '23514', null, 'Antes de la arroba tampoco van & ni =');
select throws_ok(
  $$insert into public.solicitud_monitor (nombre, correo, numero_telefono, acepta_tratamiento_datos, fecha_consentimiento)
    values ('Ana', 'ana@example.com', '3001234567', true, now())$$,
  '23514', null, 'El teléfono va con indicativo');
select throws_ok(
  $$insert into public.solicitud_monitor (nombre, correo, numero_telefono, acepta_tratamiento_datos, fecha_consentimiento)
    values ('Ana', 'ana@example.com', '+570621000010', false, now())$$,
  '23514', null, 'Sin autorización de datos no se guarda');

-- ---------------------------------------------------------------------------
-- 4. Crear una solicitud: todo o nada
-- ---------------------------------------------------------------------------
create temp table creada on commit drop as
select public.crear_solicitud_monitor(
  'Ana Aspirante', 'ana-0621@example.com', '+570621000001',
  array['10000000-0000-0000-0000-000000000621', '10000000-0000-0000-0000-000000000621', '10000000-0000-0000-0000-000000000622']::uuid[],
  '2026-09-30 15:00:00+00') as id;

select results_eq(
  $$select s.estado::text, s.fecha_consentimiento, s.acepta_tratamiento_datos, s.id_admin_actualizo
    from public.solicitud_monitor s where s.id = (select id from creada)$$,
  $$values ('nueva'::text, '2026-09-30 15:00:00+00'::timestamptz, true, null::uuid)$$,
  'Queda nueva, con su autorización y la fecha que dio el servidor');

select is(
  (select count(*)::int from public.solicitud_monitor_materia where id_solicitud = (select id from creada)),
  2,
  'Las materias repetidas cuentan una vez');

select throws_ok(
  $$select public.crear_solicitud_monitor('Beto', 'beto-0621@example.com', '+570621000009', '{}'::uuid[], now())$$,
  '23514', 'Elige al menos una materia.', 'Sin materias no se guarda');
select throws_ok(
  $$select public.crear_solicitud_monitor('Beto', 'beto-0621@example.com', '+570621000009',
      array['10000000-0000-0000-0000-000000000621', '99999999-9999-9999-9999-999999999999']::uuid[], now())$$,
  '23503', null, 'Con una materia que no existe no se guarda');
select throws_ok(
  $$select public.crear_solicitud_monitor('Beto', 'beto-0621@example.com', '+570621000009',
      (select array_agg(gen_random_uuid()) from generate_series(1, 21)), now())$$,
  '23514', 'Elige como máximo 20 materias.', 'Con más de 20 materias no se guarda');
select throws_ok(
  $$select public.crear_solicitud_monitor('Beto', 'BETO@example.com', '+570621000009',
      array['10000000-0000-0000-0000-000000000621']::uuid[], now())$$,
  '23514', null, 'Con un dato inválido tampoco');

-- Una persona con una solicitud abierta no crea otra: se devuelve la que ya tiene.
select is(
  public.crear_solicitud_monitor('Ana otra vez', 'ana-0621@example.com', '+570621000003',
    array['10000000-0000-0000-0000-000000000622']::uuid[], now()),
  (select id from creada),
  'Con una solicitud abierta y el mismo correo, devuelve esa');
select is(
  public.crear_solicitud_monitor('Ana con otro correo', 'ana-otro-0621@example.com', '+570621000001',
    array['10000000-0000-0000-0000-000000000622']::uuid[], now()),
  (select id from creada),
  'Con el mismo teléfono, también');
select is(
  (select count(*)::int from public.solicitud_monitor
    where correo in ('ana-0621@example.com', 'ana-otro-0621@example.com') or numero_telefono in ('+570621000001', '+570621000003')),
  1,
  'Y no se creó ninguna otra');
select is(
  (select count(*)::int from public.solicitud_monitor_materia where id_solicitud = (select id from creada)),
  2,
  'Ni cambiaron las materias de la que ya tenía');

-- Cerrada (evaluada o descartada), ya no cuenta: puede volver a pedir.
create temp table dora on commit drop as
select public.crear_solicitud_monitor('Dora', 'dora-0621@example.com', '+570621000004',
  array['10000000-0000-0000-0000-000000000621']::uuid[], now()) as id;
create temp table eli on commit drop as
select public.crear_solicitud_monitor('Eli', 'eli-0621@example.com', '+570621000005',
  array['10000000-0000-0000-0000-000000000621']::uuid[], now()) as id;
update public.solicitud_monitor set estado = 'evaluada' where id = (select id from dora);
update public.solicitud_monitor set estado = 'descartada' where id = (select id from eli);
select isnt(
  public.crear_solicitud_monitor('Dora', 'dora-0621@example.com', '+570621000004',
    array['10000000-0000-0000-0000-000000000621']::uuid[], now()),
  (select id from dora),
  'Con su solicitud anterior evaluada, se crea una nueva');
select isnt(
  public.crear_solicitud_monitor('Eli', 'eli-0621@example.com', '+570621000005',
    array['10000000-0000-0000-0000-000000000621']::uuid[], now()),
  (select id from eli),
  'Con su solicitud anterior descartada, también');

select results_eq(
  $$select estado::text, abierta from public.solicitud_monitor
    where id in ((select id from creada), (select id from dora), (select id from eli)) order by nombre$$,
  $$values ('nueva'::text, true), ('evaluada', false), ('descartada', false)$$,
  'Abierta mientras esté nueva o contactada; evaluada o descartada, cerrada');

-- Una segunda solicitud, más nueva, para el orden.
create temp table segunda on commit drop as
select public.crear_solicitud_monitor('Carla', 'carla-0621@example.com', '+570621000002',
  array['10000000-0000-0000-0000-000000000622']::uuid[], now()) as id;
update public.solicitud_monitor set creada_en = '2026-09-29 10:00:00+00' where id = (select id from creada);
update public.solicitud_monitor set creada_en = '2026-09-30 10:00:00+00' where id = (select id from segunda);

-- Una con la fecha del último cambio en el 2000, para ver que la base la mueve al cambiarla.
insert into public.solicitud_monitor (nombre, correo, numero_telefono, acepta_tratamiento_datos, fecha_consentimiento, actualizada_en)
values ('Fede', 'fede-0621@example.com', '+570621000006', true, now(), '2000-01-01 00:00:00+00');
create temp table marcada on commit drop as select id from public.solicitud_monitor where correo = 'fede-0621@example.com';

grant select on creada, segunda, marcada to authenticated, anon;

-- ---------------------------------------------------------------------------
-- 5. Quién la lee
-- ---------------------------------------------------------------------------
set local role authenticated;

set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-000000000621","role":"authenticated"}';
select set_eq(
  $$select nombre from public.solicitud_monitor where id in ((select id from creada), (select id from segunda))$$,
  $$values ('Ana Aspirante'), ('Carla')$$,
  'Un admin ve las dos');
select is(
  (select count(*)::int from public.solicitud_monitor_materia where id_solicitud = (select id from creada)),
  2,
  'Un admin ve sus materias');

set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-000000000621","role":"authenticated"}';
select is(
  (select count(*)::int from public.solicitud_monitor where id in ((select id from creada), (select id from segunda))),
  0,
  'Un monitor no ve ninguna');
select is((select count(*)::int from public.solicitud_monitor_materia), 0, 'Un monitor no ve las materias de ninguna');

set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000000621","role":"authenticated","is_anonymous":true}';
select is(
  (select count(*)::int from public.solicitud_monitor where id in ((select id from creada), (select id from segunda))),
  0,
  'Un visitante con sesión anónima no ve ninguna, ni la que pudo haber enviado');

set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-000000000623","role":"authenticated"}';
select is(
  (select count(*)::int from public.solicitud_monitor where id in ((select id from creada), (select id from segunda))),
  0,
  'Un admin desactivado (RN-23) no ve ninguna');
reset role;

set local role anon;
select throws_ok($$select * from public.solicitud_monitor$$, '42501', null, 'Sin sesión (anon) no hay acceso');
reset role;

-- ---------------------------------------------------------------------------
-- 6. Quién la cambia
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-000000000621","role":"authenticated"}';

select lives_ok(
  $$update public.solicitud_monitor set estado = 'contactada', id_admin_actualizo = 'a0000000-0000-0000-0000-000000000621'
    where id = (select id from creada)$$,
  'Un admin la marca contactada a su nombre');

select results_eq(
  $$select estado::text, id_admin_actualizo from public.solicitud_monitor where id = (select id from creada)$$,
  $$values ('contactada'::text, 'a0000000-0000-0000-0000-000000000621'::uuid)$$,
  'Queda contactada y a nombre de ese admin');

select throws_ok(
  $$update public.solicitud_monitor set estado = 'evaluada', id_admin_actualizo = 'a0000000-0000-0000-0000-000000000622'
    where id = (select id from creada)$$,
  '42501', null,
  'No puede dejarla a nombre de otro admin');

select throws_ok(
  $$update public.solicitud_monitor set estado = 'nueva', id_admin_actualizo = 'a0000000-0000-0000-0000-000000000621'
    where id = (select id from creada)$$,
  '42501', null,
  'No puede volverla a nueva');

select throws_ok(
  $$update public.solicitud_monitor set nombre = 'Otro nombre' where id = (select id from creada)$$,
  '42501', null,
  'No puede cambiar los datos del aspirante');

select throws_ok(
  $$delete from public.solicitud_monitor where id = (select id from creada)$$,
  '42501', null,
  'No puede borrarla');

select lives_ok(
  $$update public.solicitud_monitor set estado = 'evaluada', id_admin_actualizo = 'a0000000-0000-0000-0000-000000000621'
    where id = (select id from marcada)$$,
  'Un admin marca evaluada otra');

set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-000000000621","role":"authenticated"}';
select lives_ok(
  $$update public.solicitud_monitor set estado = 'descartada', id_admin_actualizo = 'b0000000-0000-0000-0000-000000000621'
    where id = (select id from segunda)$$,
  'Un monitor que intenta cambiar una no recibe error: la política no le deja ver la fila');
reset role;

select is(
  (select actualizada_en from public.solicitud_monitor where id = (select id from marcada)),
  now(),
  'La fecha del último cambio la pone la base: pasó del 2000 a la del cambio');

-- Contactada sigue abierta: la persona no crea otra.
select is(
  public.crear_solicitud_monitor('Ana', 'ana-0621@example.com', '+570621000001',
    array['10000000-0000-0000-0000-000000000621']::uuid[], now()),
  (select id from creada),
  'Con su solicitud contactada, se devuelve esa');

select is(
  (select estado::text from public.solicitud_monitor where id = (select id from segunda)),
  'nueva',
  'Y la fila no cambió: la solicitud que intentó tocar el monitor sigue nueva');

-- ---------------------------------------------------------------------------
-- 7. Tope de solicitudes por hora
-- ---------------------------------------------------------------------------
-- Lo de la última hora se corre a un minuto antes de ella (el rollback lo devuelve) y quedan 29 dentro.
update public.solicitud_monitor set creada_en = now() - interval '61 minutes' where creada_en > now() - interval '1 hour';
insert into public.solicitud_monitor (nombre, correo, numero_telefono, acepta_tratamiento_datos, fecha_consentimiento, creada_en)
select 'Tope ' || n, 'tope-' || n || '-0621@example.com', '+57062177' || lpad(n::text, 4, '0'), true, now(), now() - interval '59 minutes'
from generate_series(1, 29) as n;

select lives_ok(
  $$select public.crear_solicitud_monitor('Gabi', 'gabi-0621@example.com', '+570621000007',
      array['10000000-0000-0000-0000-000000000621']::uuid[], now())$$,
  'Con 29 en la última hora (y otras de antes), todavía se crea una');
select throws_ok(
  $$select public.crear_solicitud_monitor('Hugo', 'hugo-0621@example.com', '+570621000008',
      array['10000000-0000-0000-0000-000000000621']::uuid[], now())$$,
  '54000', 'Recibimos muchas solicitudes en la última hora.', 'Con 30 en la última hora, no se crea otra');
select is(
  public.crear_solicitud_monitor('Gabi', 'gabi-0621@example.com', '+570621000007',
    array['10000000-0000-0000-0000-000000000621']::uuid[], now()),
  (select id from public.solicitud_monitor where correo = 'gabi-0621@example.com'),
  'Quien ya tiene una abierta no ve el tope: se le devuelve la suya');

-- Borrar una solicitud (el servidor, por retención) se lleva sus materias.
delete from public.solicitud_monitor where id = (select id from creada);
select is(
  (select count(*)::int from public.solicitud_monitor_materia where id_solicitud = (select id from creada)),
  0,
  'Al borrar una solicitud se borran sus materias');

select * from finish();
rollback;
