-- Pruebas pgTAP de la vista monitores_por_certificar y de monitor_privado.registrado_en (HU-124, D-90).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.

begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

-- ---------------------------------------------------------------------------
-- 1. Estructura y permisos
-- ---------------------------------------------------------------------------
select has_view('public', 'monitores_por_certificar', 'Existe la vista monitores_por_certificar');

select is(
  (select reloptions from pg_class where oid = 'public.monitores_por_certificar'::regclass),
  array['security_invoker=true'],
  'La vista corre con los permisos de quien consulta');

select is(
  (select array_agg(attname::text order by attnum) from pg_attribute
   where attrelid = 'public.monitores_por_certificar'::regclass and attnum > 0 and not attisdropped),
  array['id', 'nombre', 'correo', 'numero_telefono', 'registrado_en'],
  'Solo expone lo que la bandeja necesita: nada de la llave');

select ok(
  not has_table_privilege('anon', 'public.monitores_por_certificar', 'select')
  and has_table_privilege('authenticated', 'public.monitores_por_certificar', 'select')
  and has_table_privilege('service_role', 'public.monitores_por_certificar', 'select')
  and not has_table_privilege('authenticated', 'public.monitores_por_certificar', 'insert'),
  'Solo lectura y sin acceso para anon');

select col_not_null('public', 'monitor_privado', 'registrado_en', 'Todo monitor tiene fecha de registro');

select ok(
  not has_column_privilege('authenticated', 'public.monitor_privado', 'registrado_en', 'update'),
  'El monitor no puede cambiar su fecha de registro');

-- ---------------------------------------------------------------------------
-- 2. Fixtures (como postgres): un admin, dos monitores sin certificado, uno con certificado y una sesión anónima
-- ---------------------------------------------------------------------------
insert into auth.users (id, is_anonymous) values
  ('a0000000-0000-0000-0000-000000000124', false),
  ('b0000000-0000-0000-0000-000000000124', false),
  ('b0000000-0000-0000-0000-000000000125', false),
  ('b0000000-0000-0000-0000-000000000126', false),
  ('c0000000-0000-0000-0000-000000000124', true);

insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-000000000124', 'Admin HU-124', 'admin-124@example.com', 9000124);
insert into public.materia (id, nombre, codigo) values ('10000000-0000-0000-0000-000000000124', 'Materia HU-124', 'HU-124');

insert into public.monitor (id, nombre) values
  ('b0000000-0000-0000-0000-000000000124', 'Reciente'),
  ('b0000000-0000-0000-0000-000000000125', 'Antiguo'),
  ('b0000000-0000-0000-0000-000000000126', 'Certificado');
insert into public.monitor_privado (id_monitor, numero_telefono, correo, llave) values
  ('b0000000-0000-0000-0000-000000000124', '3000000124', 'reciente-124@example.com', 'llave-124');
insert into public.monitor_privado (id_monitor, numero_telefono, correo, llave, registrado_en) values
  ('b0000000-0000-0000-0000-000000000125', '3000000125', 'antiguo-125@example.com', 'llave-125', '2020-01-01T00:00:00Z'),
  ('b0000000-0000-0000-0000-000000000126', '3000000126', 'certificado-126@example.com', 'llave-126', '2020-01-02T00:00:00Z');
insert into public.certificado (id_monitor, id_materia, id_admin) values
  ('b0000000-0000-0000-0000-000000000126', '10000000-0000-0000-0000-000000000124', 'a0000000-0000-0000-0000-000000000124');

select ok(
  (select registrado_en from public.monitor_privado where id_monitor = 'b0000000-0000-0000-0000-000000000124') is not null,
  'Sin decir la fecha, la base pone la del registro');

-- ---------------------------------------------------------------------------
-- 3. Quién ve qué
-- ---------------------------------------------------------------------------
set local role authenticated;

set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-000000000124","role":"authenticated"}';
select results_eq(
  $$select nombre from public.monitores_por_certificar
    where id in ('b0000000-0000-0000-0000-000000000124', 'b0000000-0000-0000-0000-000000000125', 'b0000000-0000-0000-0000-000000000126')
    order by registrado_en, id$$,
  $$values ('Antiguo'::text), ('Reciente'::text)$$,
  'El admin ve a los dos sin certificado, del más antiguo al más reciente, y no al certificado');

select is(
  (select correo from public.monitores_por_certificar where id = 'b0000000-0000-0000-0000-000000000125'),
  'antiguo-125@example.com',
  'El admin ve el correo para poder contactarlo');

select is(
  (select numero_telefono from public.monitores_por_certificar where id = 'b0000000-0000-0000-0000-000000000125'),
  '3000000125',
  'El admin ve el teléfono para poder contactarlo');

set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-000000000124","role":"authenticated"}';
select results_eq(
  $$select id from public.monitores_por_certificar$$,
  $$values ('b0000000-0000-0000-0000-000000000124'::uuid)$$,
  'Un monitor solo se ve a sí mismo: no lee el contacto de otros');

set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000000124","role":"authenticated","is_anonymous":true}';
select is((select count(*)::int from public.monitores_por_certificar), 0, 'Una sesión anónima no ve a nadie');

reset role;

-- El monitor intenta cambiar su fecha con su propia sesión: se le niega la columna.
set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-000000000125","role":"authenticated"}';
select throws_ok(
  $$update public.monitor_privado set registrado_en = now() where id_monitor = 'b0000000-0000-0000-0000-000000000125'$$,
  '42501',
  null,
  'Su sesión no puede cambiar la fecha');
reset role;

-- ---------------------------------------------------------------------------
-- 4. Sale con su primer certificado
-- ---------------------------------------------------------------------------
insert into public.certificado (id_monitor, id_materia, id_admin) values
  ('b0000000-0000-0000-0000-000000000125', '10000000-0000-0000-0000-000000000124', 'a0000000-0000-0000-0000-000000000124');

select is(
  (select count(*)::int from public.monitores_por_certificar where id = 'b0000000-0000-0000-0000-000000000125'),
  0,
  'Con su primer certificado sale de la lista');

select is(
  (select count(*)::int from public.monitores_por_certificar where id = 'b0000000-0000-0000-0000-000000000124'),
  1,
  'El que sigue sin certificado se queda');

-- Quitar el certificado lo devuelve: la lista siempre refleja lo que hay.
delete from public.certificado where id_monitor = 'b0000000-0000-0000-0000-000000000125';
select is(
  (select count(*)::int from public.monitores_por_certificar where id = 'b0000000-0000-0000-0000-000000000125'),
  1,
  'Sin certificado vuelve a la lista');

select * from finish();
rollback;
