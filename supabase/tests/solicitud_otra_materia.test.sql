-- Pruebas pgTAP de HU-111 (D-80): la materia «Otra» de la solicitud del aspirante a monitor.
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.

begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

-- ---------------------------------------------------------------------------
-- 1. Estructura y permisos
-- ---------------------------------------------------------------------------
select has_column('public', 'solicitud_monitor', 'otra_materia', 'La solicitud tiene la columna otra_materia');

select ok(
  has_column_privilege('authenticated', 'public.solicitud_monitor', 'otra_materia', 'select')
  and not has_column_privilege('authenticated', 'public.solicitud_monitor', 'otra_materia', 'update')
  and not has_column_privilege('anon', 'public.solicitud_monitor', 'otra_materia', 'select'),
  'Con su sesión se lee (lo que deje la política «admin lee») pero no se cambia; sin sesión, nada');

select ok(
  has_function_privilege('service_role', 'public.crear_solicitud_monitor(text, text, text, uuid[], timestamptz, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.crear_solicitud_monitor(text, text, text, uuid[], timestamptz, text)', 'execute')
  and not has_function_privilege('anon', 'public.crear_solicitud_monitor(text, text, text, uuid[], timestamptz, text)', 'execute'),
  'crear_solicitud_monitor() con la otra materia: solo el servidor (service_role)');

select hasnt_function(
  'public', 'crear_solicitud_monitor', array['text', 'text', 'text', 'uuid[]', 'timestamp with time zone'],
  'La versión de cinco argumentos ya no existe');

-- ---------------------------------------------------------------------------
-- 2. Datos de prueba
-- ---------------------------------------------------------------------------
insert into public.materia (id, nombre, codigo) values
  ('10000000-0000-0000-0000-000000001111', 'Cálculo HU-111', 'HU111-1');

-- ---------------------------------------------------------------------------
-- 3. Restricciones de la columna (D-80 a)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$insert into public.solicitud_monitor (nombre, correo, numero_telefono, acepta_tratamiento_datos, fecha_consentimiento, otra_materia)
    values ('Ana', 'ana-1111@example.com', '+571111000010', true, now(), '')$$,
  '23514', null, 'La otra materia no puede ir vacía (sin otra, es nula)');
select throws_ok(
  $$insert into public.solicitud_monitor (nombre, correo, numero_telefono, acepta_tratamiento_datos, fecha_consentimiento, otra_materia)
    values ('Ana', 'ana-1111@example.com', '+571111000010', true, now(), ' Química ')$$,
  '23514', null, 'Ni con espacios al borde');
select throws_ok(
  $$insert into public.solicitud_monitor (nombre, correo, numero_telefono, acepta_tratamiento_datos, fecha_consentimiento, otra_materia)
    values ('Ana', 'ana-1111@example.com', '+571111000010', true, now(), repeat('a', 121))$$,
  '23514', null, 'Ni de más de 120 caracteres');
select throws_ok(
  $$insert into public.solicitud_monitor (nombre, correo, numero_telefono, acepta_tratamiento_datos, fecha_consentimiento, otra_materia)
    values ('Ana', 'ana-1111@example.com', '+571111000010', true, now(), E'Química\nOrgánica')$$,
  '23514', null, 'Ni con saltos de línea');

-- ---------------------------------------------------------------------------
-- 4. Crear una solicitud con la otra materia
-- ---------------------------------------------------------------------------
-- D-80 c: la otra puede ser la única elección.
create temp table solo_otra on commit drop as
select public.crear_solicitud_monitor(
  'Ana Aspirante', 'ana-1111@example.com', '+571111000001', '{}'::uuid[], now(), 'Química orgánica') as id;

select results_eq(
  $$select s.otra_materia, (select count(*)::int from public.solicitud_monitor_materia m where m.id_solicitud = s.id)
    from public.solicitud_monitor s where s.id = (select id from solo_otra)$$,
  $$values ('Química orgánica'::text, 0)$$,
  'Con solo la otra materia se guarda, con el texto tal cual y sin materias de la lista');

create temp table con_las_dos on commit drop as
select public.crear_solicitud_monitor(
  'Beto Aspirante', 'beto-1111@example.com', '+571111000002',
  array['10000000-0000-0000-0000-000000001111']::uuid[], now(), 'Estadística, Álgebra lineal') as id;

select results_eq(
  $$select s.otra_materia, (select count(*)::int from public.solicitud_monitor_materia m where m.id_solicitud = s.id)
    from public.solicitud_monitor s where s.id = (select id from con_las_dos)$$,
  $$values ('Estadística, Álgebra lineal'::text, 1)$$,
  'Con materias de la lista y la otra, se guardan las dos');

select is(
  (select otra_materia from public.solicitud_monitor where id = public.crear_solicitud_monitor(
    'Carla', 'carla-1111@example.com', '+571111000003', array['10000000-0000-0000-0000-000000001111']::uuid[], now())),
  null,
  'Sin la otra materia (el parámetro por omisión), queda nula como antes');

select throws_ok(
  $$select public.crear_solicitud_monitor('Dora', 'dora-1111@example.com', '+571111000004', '{}'::uuid[], now(), ' ')$$,
  '23514', null, 'Una otra materia que no cumple la regla no guarda nada');

-- D-80 e: con una solicitud abierta se devuelve esa, sin cambiarla.
select results_eq(
  $$select public.crear_solicitud_monitor('Ana otra vez', 'ana-1111@example.com', '+571111000001', '{}'::uuid[], now(), 'Biología'),
           (select otra_materia from public.solicitud_monitor where id = (select id from solo_otra))$$,
  $$select (select id from solo_otra), 'Química orgánica'::text$$,
  'Con una solicitud abierta se devuelve esa y su otra materia no cambia');

select * from finish();
rollback;
