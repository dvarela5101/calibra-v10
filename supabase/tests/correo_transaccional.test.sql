-- Pruebas pgTAP del registro de envíos de correo (HU-006).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.

begin;
create extension if not exists pgtap with schema extensions;

select plan(28);

-- ---------------------------------------------------------------------------
-- 1. Estructura: qué guarda y qué NO guarda
-- ---------------------------------------------------------------------------
select has_table('public', 'correo_envio', 'Existe la tabla correo_envio');

select enum_has_labels('public', 'estado_correo', array['pendiente', 'enviado', 'fallido'],
  'Enum estado_correo con sus valores exactos');

select is(
  (select array_agg(attname::text order by attnum) from pg_attribute
   where attrelid = 'public.correo_envio'::regclass and attnum > 0 and not attisdropped),
  array['id', 'clave', 'plantilla', 'destinatario', 'estado', 'intentos', 'ultimo_error', 'id_proveedor',
        'creado_en', 'actualizado_en', 'enviado_en',
        -- HU-065: si la última falla fue temporal (se reintenta). Tampoco es parte del correo.
        'reintentable'],
  'Guarda destinatario, plantilla, fecha y resultado, y ninguna columna para el cuerpo ni los datos del correo');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.correo_envio'::regclass),
  'RLS activa en correo_envio');

-- ---------------------------------------------------------------------------
-- 2. Fixtures (como postgres): admin, monitor, sesión anónima
-- ---------------------------------------------------------------------------
insert into auth.users (id, is_anonymous) values
  ('a0000000-0000-0000-0000-000000000001', false),
  ('b0000000-0000-0000-0000-000000000001', false),
  ('c0000000-0000-0000-0000-00000000000a', true);
-- orden_revision es único y la semilla (supabase/seed.sql) usa 1 y 2: aquí, números altos.
insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-000000000001', 'Admin Prueba', 'admin@example.com', 9000001);
insert into public.monitor (id, nombre) values ('b0000000-0000-0000-0000-000000000001', 'Monitor Uno');

insert into public.correo_envio (clave, plantilla, destinatario, estado, intentos, enviado_en, id_proveedor) values
  ('recuperacion_diagnostico:d1', 'recuperacion_diagnostico', 'lead@example.com', 'enviado', 1, now(), 'prov-1'),
  ('solicitud_llave_reembolso:r1', 'solicitud_llave_reembolso', 'pagador@example.com', 'fallido', 3, null, null);

-- ---------------------------------------------------------------------------
-- 3. Restricciones
-- ---------------------------------------------------------------------------
select throws_ok(
  $$insert into public.correo_envio (clave, plantilla, destinatario) values
    ('recuperacion_diagnostico:d1', 'recuperacion_diagnostico', 'otro@example.com')$$,
  '23505', null,
  'La clave es única: el mismo correo no se registra dos veces');

select throws_ok(
  $$insert into public.correo_envio (clave, plantilla, destinatario, estado) values
    ('c1', 'p', 'a@example.com', 'enviado')$$,
  '23514', null,
  'Un correo enviado sin fecha de envío se rechaza');

select throws_ok(
  $$insert into public.correo_envio (clave, plantilla, destinatario, estado, enviado_en) values
    ('c2', 'p', 'a@example.com', 'fallido', now())$$,
  '23514', null,
  'Un correo que no se envió no puede tener fecha de envío');

select throws_ok(
  $$insert into public.correo_envio (clave, plantilla, destinatario) values ('c3', 'p', '3001234567')$$,
  '23514', null,
  'El destinatario debe ser un correo: un teléfono se rechaza (WhatsApp y SMS son otro canal)');

select throws_ok(
  $$insert into public.correo_envio (clave, plantilla, destinatario) values ('', 'p', 'a@example.com')$$,
  '23514', null,
  'La clave no puede estar vacía');

select throws_ok(
  $$insert into public.correo_envio (clave, plantilla, destinatario) values (repeat('x', 257), 'p', 'a@example.com')$$,
  '23514', null,
  'La clave admite hasta 256 caracteres, el máximo de la Idempotency-Key de Resend');

select lives_ok(
  $$insert into public.correo_envio (clave, plantilla, destinatario) values (repeat('x', 256), 'p', 'a@example.com')$$,
  'Una clave de exactamente 256 caracteres sí entra');

select throws_ok(
  $$insert into public.correo_envio (clave, plantilla, destinatario) values ('c4', '', 'a@example.com')$$,
  '23514', null,
  'La plantilla no puede estar vacía');

select throws_ok(
  $$insert into public.correo_envio (clave, plantilla, destinatario, intentos) values ('c5', 'p', 'a@example.com', -1)$$,
  '23514', null,
  'Los intentos no pueden ser negativos');

select throws_ok(
  $$insert into public.correo_envio (clave, plantilla, destinatario, ultimo_error) values
    ('c6', 'p', 'a@example.com', repeat('e', 501))$$,
  '23514', null,
  'El error es un mensaje corto: más de 500 caracteres se rechaza');

select lives_ok(
  $$insert into public.correo_envio (clave, plantilla, destinatario, estado, intentos, ultimo_error) values
    ('c7', 'p', 'a@example.com', 'fallido', 3, repeat('e', 500))$$,
  'Un error de exactamente 500 caracteres sí entra');

-- ---------------------------------------------------------------------------
-- 4. Permisos y quién lee el registro
-- ---------------------------------------------------------------------------
select ok(
  not has_table_privilege('anon', 'public.correo_envio', 'select')
  and has_table_privilege('authenticated', 'public.correo_envio', 'select')
  and not has_table_privilege('authenticated', 'public.correo_envio', 'insert')
  and not has_table_privilege('authenticated', 'public.correo_envio', 'update')
  and not has_table_privilege('authenticated', 'public.correo_envio', 'delete'),
  'authenticated solo lee (la política decide quién); anon no ve nada');

select ok(
  has_table_privilege('service_role', 'public.correo_envio', 'select')
  and has_table_privilege('service_role', 'public.correo_envio', 'insert')
  and has_table_privilege('service_role', 'public.correo_envio', 'update')
  and has_table_privilege('service_role', 'public.correo_envio', 'delete'),
  'service_role escribe: solo el servidor con la llave secreta manda correos');

set local role authenticated;

set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.correo_envio where clave in ('recuperacion_diagnostico:d1', 'solicitud_llave_reembolso:r1')),
  2, 'Un admin lee el registro');

select throws_ok(
  $$insert into public.correo_envio (clave, plantilla, destinatario) values ('adm', 'p', 'a@example.com')$$,
  '42501', null,
  'Ni un admin escribe el registro con su sesión: escribe el servidor');

select throws_ok(
  $$update public.correo_envio set estado = 'fallido' where clave = 'adm'$$,
  '42501', null,
  'Ni un admin actualiza el registro con su sesión');

set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.correo_envio), 0, 'Un monitor no lee el registro (trae correos de personas)');

set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-00000000000a","role":"authenticated","is_anonymous":true}';
select is((select count(*)::int from public.correo_envio), 0, 'Una sesión anónima tampoco');

reset role;
set local role anon;
select throws_ok($$select * from public.correo_envio$$, '42501', null, 'Sin sesión (anon) no hay acceso');
reset role;

-- Un admin desactivado deja de leer (RN-23)
update auth.users set banned_until = now() + interval '100 years' where id = 'a0000000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.correo_envio), 0, 'RN-23: un admin desactivado ya no lee el registro');
reset role;

-- ---------------------------------------------------------------------------
-- 5. El servidor (service_role) escribe y limpia
-- ---------------------------------------------------------------------------
set local role service_role;
select lives_ok(
  $$update public.correo_envio set estado = 'enviado', enviado_en = now(), intentos = 2, ultimo_error = null
    where clave = 'solicitud_llave_reembolso:r1'$$,
  'El servidor marca un correo fallido como enviado en el reintento');
select is(
  (select estado::text || ':' || intentos::text from public.correo_envio where clave = 'solicitud_llave_reembolso:r1'),
  'enviado:2',
  'La misma fila (misma clave) pasó de fallido a enviado, sin duplicarse');
select lives_ok($$delete from public.correo_envio where clave = 'c7'$$, 'El servidor puede limpiar filas');
reset role;

select is((select count(*)::int from public.correo_envio where clave = 'solicitud_llave_reembolso:r1'), 1,
  'Un solo registro por clave, siempre');

select * from finish();
rollback;
