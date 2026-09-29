-- Pruebas pgTAP del almacenamiento privado de comprobantes (HU-007).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.
-- Las pruebas de la API real (413, 415, enlaces firmados) están en integracion/comprobantes.test.ts.

begin;
create extension if not exists pgtap with schema extensions;

select plan(35);

-- ---------------------------------------------------------------------------
-- Fixtures (como postgres). Rutas: <id del usuario>/<uuid>.<extensión>
--   admin          a0000000-...-01
--   monitor        b0000000-...-01
--   pagador A      c0000000-...-0a  (sesión anónima)
--   pagador B      c0000000-...-0b  (sesión anónima)
--   admin retirado a0000000-...-02  (baneado en Auth: RN-23)
-- ---------------------------------------------------------------------------
insert into auth.users (id, is_anonymous, banned_until) values
  ('a0000000-0000-0000-0000-000000000001', false, null),
  ('a0000000-0000-0000-0000-000000000002', false, now() + interval '100 years'),
  ('b0000000-0000-0000-0000-000000000001', false, null),
  ('c0000000-0000-0000-0000-00000000000a', true, null),
  ('c0000000-0000-0000-0000-00000000000b', true, null);

insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-000000000001', 'Admin activo', 'activo@example.com', 1),
  ('a0000000-0000-0000-0000-000000000002', 'Admin retirado', 'retirado@example.com', 2);
insert into public.monitor (id, nombre) values ('b0000000-0000-0000-0000-000000000001', 'Monitor Uno');

insert into storage.buckets (id, name, public) values ('otro-bucket', 'otro-bucket', false);

insert into storage.objects (bucket_id, name) values
  ('comprobantes', 'c0000000-0000-0000-0000-00000000000a/11111111-1111-4111-8111-111111111111.png'),
  ('comprobantes', 'c0000000-0000-0000-0000-00000000000b/22222222-2222-4222-8222-222222222222.pdf'),
  ('otro-bucket', 'c0000000-0000-0000-0000-00000000000a/33333333-3333-4333-8333-333333333333.png');

-- ---------------------------------------------------------------------------
-- 1. El bucket: privado, con el límite y los tipos de la HU
-- ---------------------------------------------------------------------------
select results_eq(
  $$select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'comprobantes'$$,
  $$values (false, 5242880::bigint, array['image/jpeg', 'image/png', 'application/pdf']::text[])$$,
  'El bucket comprobantes es privado, de 5 MiB y solo admite JPG, PNG y PDF');

select ok(
  (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass),
  'RLS activa en storage.objects');

select results_eq(
  $$select cmd::text from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname like 'comprobantes:%'
    order by cmd$$,
  $$values ('INSERT'), ('SELECT')$$,
  'Una política de INSERT y una de SELECT; ninguna de UPDATE ni DELETE');

select is(
  (select count(*)::int from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and policyname like 'comprobantes:%'
     and 'anon' = any (roles)),
  0,
  'Ninguna política de comprobantes abre nada al rol anon');

-- ---------------------------------------------------------------------------
-- 2. Pagador A (sesión anónima, rol authenticated)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-00000000000a","role":"authenticated","is_anonymous":true}';

select is(
  (select count(*)::int from storage.objects where bucket_id = 'comprobantes'),
  1,
  'El pagador ve solo su comprobante, no el de B');

select is(
  (select count(*)::int from storage.objects
   where name = 'c0000000-0000-0000-0000-00000000000b/22222222-2222-4222-8222-222222222222.pdf'),
  0,
  'El pagador no ve el comprobante de otro aunque conozca la ruta exacta');

select lives_ok(
  $$insert into storage.objects (bucket_id, name) values
    ('comprobantes', 'c0000000-0000-0000-0000-00000000000a/44444444-4444-4444-8444-444444444444.jpg')$$,
  'El pagador sube un JPG a su carpeta con nombre <uuid>.jpg');

select lives_ok(
  $$insert into storage.objects (bucket_id, name) values
    ('comprobantes', 'c0000000-0000-0000-0000-00000000000a/55555555-5555-4555-8555-555555555555.pdf')$$,
  'El pagador sube un PDF a su carpeta');

select throws_ok(
  $$insert into storage.objects (bucket_id, name) values
    ('comprobantes', 'c0000000-0000-0000-0000-00000000000b/66666666-6666-4666-8666-666666666666.png')$$,
  '42501', null,
  'El pagador no puede subir a la carpeta de otro');

select throws_ok(
  $$insert into storage.objects (bucket_id, name) values
    ('comprobantes', '66666666-6666-4666-8666-666666666666.png')$$,
  '42501', null,
  'No se sube fuera de una carpeta de usuario');

select throws_ok(
  $$insert into storage.objects (bucket_id, name) values
    ('comprobantes', 'c0000000-0000-0000-0000-00000000000a/sub/77777777-7777-4777-8777-777777777777.png')$$,
  '42501', null,
  'No se sube a una subcarpeta');

select throws_ok(
  $$insert into storage.objects (bucket_id, name) values
    ('comprobantes', 'c0000000-0000-0000-0000-00000000000a/88888888-8888-4888-8888-888888888888.exe')$$,
  '42501', null,
  'No se sube con una extensión que no es JPG, PNG ni PDF');

select throws_ok(
  $$insert into storage.objects (bucket_id, name) values
    ('comprobantes', 'c0000000-0000-0000-0000-00000000000a/comprobante.png')$$,
  '42501', null,
  'El nombre debe ser un uuid');

select throws_ok(
  $$insert into storage.objects (bucket_id, name) values
    ('comprobantes', 'c0000000-0000-0000-0000-00000000000a/../c0000000-0000-0000-0000-00000000000b/99999999-9999-4999-8999-999999999999.png')$$,
  '42501', null,
  'No se sube con .. para salir de la carpeta');

select throws_ok(
  $$insert into storage.objects (bucket_id, name) values
    ('comprobantes', 'c0000000-0000-0000-0000-00000000000b/c0000000-0000-0000-0000-00000000000a/99999999-9999-4999-8999-999999999999.png')$$,
  '42501', null,
  'La ruta debe empezar por el id del pagador: no se sube dentro de la carpeta de otro');

select throws_ok(
  $$insert into storage.objects (bucket_id, name) values
    ('comprobantes', 'c0000000-0000-0000-0000-00000000000a/99999999-9999-4999-8999-999999999999.png.exe')$$,
  '42501', null,
  'La ruta debe terminar en la extensión: no vale una doble extensión');

select throws_ok(
  $$insert into storage.objects (bucket_id, name) values
    ('comprobantes', 'c0000000-0000-0000-0000-00000000000a/99999999-9999-4999-8999-999999999999.png/x')$$,
  '42501', null,
  'La ruta debe terminar en la extensión: no vale seguir con otra carpeta');

select throws_ok(
  $$insert into storage.objects (bucket_id, name) values
    ('comprobantes', 'c0000000-0000-0000-0000-00000000000a/99999999-9999-4999-8999-999999999999.PNG')$$,
  '42501', null,
  'La extensión va en minúsculas');

select throws_ok(
  $$insert into storage.objects (bucket_id, name) values
    ('comprobantes', 'c0000000-0000-0000-0000-00000000000a/99999999-9999-4999-8999-999999999999.gif')$$,
  '42501', null,
  'Solo se admite JPG, PNG y PDF: un GIF no');

select throws_ok(
  $$insert into storage.objects (bucket_id, name) values
    ('otro-bucket', 'c0000000-0000-0000-0000-00000000000a/99999999-9999-4999-8999-999999999999.png')$$,
  '42501', null,
  'La política de subida no abre otros buckets');

select is(
  (select count(*)::int from storage.objects where bucket_id = 'comprobantes'),
  3,
  'Tras sus dos subidas válidas, el pagador ve sus tres comprobantes');

select is(
  (select count(*)::int from storage.objects where bucket_id = 'otro-bucket'),
  0,
  'La política de lectura no abre otros buckets');

-- Sin política de UPDATE, RLS deja esas filas fuera de alcance: la sentencia no falla, pero no toca nada.
-- Borrar por SQL ni siquiera llega a RLS: el trigger storage.protect_delete lo prohíbe a todos y manda
-- a usar la API de Storage (la limpieza de huérfanos, cuando exista, va por ahí con service_role).
select lives_ok(
  $$update storage.objects
    set name = 'c0000000-0000-0000-0000-00000000000a/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png'
    where name = 'c0000000-0000-0000-0000-00000000000a/11111111-1111-4111-8111-111111111111.png'$$,
  'Intentar renombrar un comprobante no da error');

select is(
  (select count(*)::int from storage.objects
   where name = 'c0000000-0000-0000-0000-00000000000a/11111111-1111-4111-8111-111111111111.png'),
  1,
  'El pagador no puede renombrar ni pisar un comprobante (no hay política de UPDATE)');

select throws_ok(
  $$delete from storage.objects
    where name = 'c0000000-0000-0000-0000-00000000000a/11111111-1111-4111-8111-111111111111.png'$$,
  '42501', null,
  'Borrar un comprobante por SQL está bloqueado por Storage');

select is(
  (select count(*)::int from storage.objects
   where name = 'c0000000-0000-0000-0000-00000000000a/11111111-1111-4111-8111-111111111111.png'),
  1,
  'El pagador no puede borrar un comprobante (tampoco hay política de DELETE)');

-- ---------------------------------------------------------------------------
-- 3. Pagador B
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-00000000000b","role":"authenticated","is_anonymous":true}';

select is(
  (select count(*)::int from storage.objects where bucket_id = 'comprobantes'),
  1,
  'El pagador B ve solo el suyo: no ve los tres de A');

select is(
  (select name from storage.objects where bucket_id = 'comprobantes'),
  'c0000000-0000-0000-0000-00000000000b/22222222-2222-4222-8222-222222222222.pdf',
  'Y es el de su carpeta');

-- ---------------------------------------------------------------------------
-- 4. Admin, admin retirado y monitor
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- Se cuenta solo lo de estos pagadores: la base local puede tener otros comprobantes que un admin también ve.
select is(
  (select count(*)::int from storage.objects
   where bucket_id = 'comprobantes'
     and (storage.foldername(name))[1] in ('c0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000b')),
  4,
  'Un admin ve los comprobantes de todos los pagadores (los 3 de A y el de B)');

select is(
  (select count(*)::int from storage.objects where bucket_id = 'otro-bucket'),
  0,
  'Ser admin no abre los otros buckets');

select throws_ok(
  $$insert into storage.objects (bucket_id, name) values
    ('comprobantes', 'c0000000-0000-0000-0000-00000000000a/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png')$$,
  '42501', null,
  'Un admin lee todo, pero sube solo a su propia carpeta');

set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}';

select is(
  (select count(*)::int from storage.objects where bucket_id = 'comprobantes'),
  0,
  'RN-23: un admin desactivado ya no lee comprobantes aunque su token siga vigente');

set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (select count(*)::int from storage.objects where bucket_id = 'comprobantes'),
  0,
  'Un monitor no lee comprobantes: solo los admins y el pagador');

reset role;

-- ---------------------------------------------------------------------------
-- 5. Sin sesión (rol anon)
-- ---------------------------------------------------------------------------
set local role anon;

select is(
  (select count(*)::int from storage.objects where bucket_id = 'comprobantes'),
  0,
  'Sin sesión no se lee ningún comprobante');

select throws_ok(
  $$insert into storage.objects (bucket_id, name) values
    ('comprobantes', 'c0000000-0000-0000-0000-00000000000a/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png')$$,
  '42501', null,
  'Sin sesión no se sube nada');

reset role;

select * from finish();
rollback;
