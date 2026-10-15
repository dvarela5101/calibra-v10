-- Pruebas pgTAP de la invitación de admin (HU-072): la tabla cerrada a la Data API, crear la invitación, registrar al
-- admin, la lista y la cancelación.
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.
--
-- La base local puede traer otros admins (la semilla, o datos de desarrollo). Para que la prueba no dependa de ellos:
-- (1) los de antes se banean dentro de la transacción; (2) los admins de la prueba llevan un orden_revision negativo
-- (-1000 a -997); (3) las comprobaciones de orden comparan con el máximo que había justo antes, no con un número fijo;
-- (4) las listas se filtran por los correos de la prueba.
--
-- Admins de la prueba, en su orden inicial:
--   A (-1000) activo · B (-999) activo, con el correo en mayúsculas · E (-998) activo · D (-997) desactivado
-- Los admins que se dan de alta con registrar_admin usan las cuentas de Auth ...72c1 a ...72c8.

begin;
create extension if not exists pgtap with schema extensions;

select plan(151);

-- ---------------------------------------------------------------------------
-- 0. Fixtures (como postgres)
-- ---------------------------------------------------------------------------
-- Cualquier admin que ya existiera queda inactivo durante la prueba.
update auth.users set banned_until = 'infinity' where id in (select id from public.admin);

insert into auth.users (id, is_anonymous, banned_until) values
  ('a0000000-0000-0000-0000-00000000720a', false, null),
  ('a0000000-0000-0000-0000-00000000720b', false, null),
  ('a0000000-0000-0000-0000-00000000720d', false, now() + interval '100 years'),
  ('a0000000-0000-0000-0000-00000000720e', false, null),
  ('a0000000-0000-0000-0000-00000000720f', false, null),
  ('a0000000-0000-0000-0000-0000000072c1', false, null),
  ('a0000000-0000-0000-0000-0000000072c2', false, null),
  ('a0000000-0000-0000-0000-0000000072c3', false, null),
  ('a0000000-0000-0000-0000-0000000072c4', false, null),
  ('a0000000-0000-0000-0000-0000000072c5', false, null),
  ('a0000000-0000-0000-0000-0000000072c6', false, null),
  ('a0000000-0000-0000-0000-0000000072c7', false, null),
  ('a0000000-0000-0000-0000-0000000072c8', false, null),
  ('b0000000-0000-0000-0000-000000007201', false, null),
  ('c0000000-0000-0000-0000-000000007201', true, null),
  ('d0000000-0000-0000-0000-000000007201', false, null);

insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-00000000720a', 'Admin A HU072', 'admin-a-hu072@calibra.test', -1000),
  ('a0000000-0000-0000-0000-00000000720b', 'Admin B HU072', 'Admin-B-HU072@Calibra.Test', -999),
  ('a0000000-0000-0000-0000-00000000720e', 'Admin E HU072', 'admin-e-hu072@calibra.test', -998),
  ('a0000000-0000-0000-0000-00000000720d', 'Admin D HU072', 'admin-d-hu072@calibra.test', -997);

insert into public.monitor (id, nombre) values ('b0000000-0000-0000-0000-000000007201', 'Monitor HU072');
insert into public.monitor_privado (id_monitor, numero_telefono, correo, llave) values
  ('b0000000-0000-0000-0000-000000007201', '3000007201', 'Monitor-HU072@Example.COM', 'llave-m');

insert into public.lead (id, id_sesion_anonima, nombre, correo, acepta_tratamiento_datos, fecha_consentimiento) values
  ('40000000-0000-0000-0000-000000007201', 'c0000000-0000-0000-0000-000000007201', 'Lead HU072', 'lead-hu072@example.com', true, now());
insert into public.estudiante (id, id_lead) values ('d0000000-0000-0000-0000-000000007201', '40000000-0000-0000-0000-000000007201');

-- Ayudantes (viven solo en esta sesión). Las funciones leen todo con los permisos del dueño, para poder llamarlas con
-- cualquier rol activo.
create temporary table res (clave text primary key, resultado text, id_invitacion uuid, vencimiento timestamptz);
create temporary table memo (clave text primary key, valor text);
grant all on res, memo to public;

-- h(n): un hash SHA-256 de mentira (64 dígitos hex) distinto para cada n.
create function pg_temp.h(p_n integer) returns text
language sql immutable
as $$
  select lpad(to_hex(p_n), 64, '0');
$$;
-- inv(n): el id de la invitación con el hash h(n).
create function pg_temp.inv(p_n integer) returns uuid
language sql stable security definer set search_path = ''
as $$
  select i.id from public.invitacion_admin i where i.token_hash = pg_temp.h(p_n);
$$;
-- estado(n): abierta, usada o cancelada.
create function pg_temp.estado(p_n integer) returns text
language sql stable security definer set search_path = ''
as $$
  select case when i.usada_en is not null then 'usada' when i.cancelada_en is not null then 'cancelada' else 'abierta' end
  from public.invitacion_admin i where i.token_hash = pg_temp.h(p_n);
$$;
-- abiertas(correo): cuántas invitaciones abiertas (sin usar ni cancelar, vencidas o no) tiene ese correo.
create function pg_temp.abiertas(p_correo text) returns integer
language sql stable security definer set search_path = ''
as $$
  select count(*)::integer from public.invitacion_admin i
  where i.correo = p_correo and i.usada_en is null and i.cancelada_en is null;
$$;
-- n_abiertas(): las invitaciones abiertas de los admins de la prueba.
create function pg_temp.n_abiertas() returns integer
language sql stable security definer set search_path = ''
as $$
  select count(*)::integer from public.invitacion_admin i
  where i.usada_en is null and i.cancelada_en is null and i.id_admin::text like 'a0000000-0000-0000-0000-0000000072%';
$$;
-- maximo(): el mayor orden_revision de todos los admins, de la prueba o no.
create function pg_temp.maximo() returns integer
language sql stable security definer set search_path = ''
as $$
  select max(a.orden_revision) from public.admin a;
$$;
-- ordenes_sin(id): una firma de los órdenes de todos los admins menos uno. Con null, de todos.
create function pg_temp.ordenes_sin(p_id uuid) returns text
language sql stable security definer set search_path = ''
as $$
  select md5(coalesce(string_agg(a.id::text || ':' || a.orden_revision::text, ',' order by a.id), ''))
  from public.admin a where a.id is distinct from p_id;
$$;
-- huella(): una firma de todos los admins y de todas las invitaciones. Si una llamada que "no hace nada" la cambia,
-- algo se tocó.
create function pg_temp.huella() returns text
language sql stable security definer set search_path = ''
as $$
  select md5(
    coalesce((select string_agg(a.id::text || ':' || a.nombre || ':' || a.correo || ':' || a.orden_revision::text, ',' order by a.id)
              from public.admin a), '')
    || '|' ||
    coalesce((select string_agg(i.id::text || ':' || i.correo || ':' || i.token_hash || ':' || coalesce(i.usada_en::text, '') || ':'
                                || coalesce(i.cancelada_en::text, '') || ':' || coalesce(i.id_admin_nuevo::text, ''), ',' order by i.id)
              from public.invitacion_admin i), '')
  );
$$;
-- registro_sin_cambios(...): llama a registrar_admin y dice 'false' si respondió false y no cambió nada, 'false con
-- cambios' si respondió false pero tocó algo, y 'true' si registró.
create function pg_temp.registro_sin_cambios(p_hash text, p_id uuid, p_correo text, p_nombre text) returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_antes text := pg_temp.huella();
  v_respuesta boolean;
begin
  v_respuesta := public.registrar_admin(p_hash, p_id, p_correo, p_nombre);
  if v_respuesta then
    return 'true';
  end if;
  return case when pg_temp.huella() = v_antes then 'false' else 'false con cambios' end;
end;
$$;
-- aislar(): vuelve a desactivar a cualquier admin que no sea de la prueba. La base local la pueden estar usando otras
-- pruebas a la vez y crear admins confirmados mientras esta corre; el turno los vería.
create procedure pg_temp.aislar()
language sql security definer set search_path = ''
as $$
  update auth.users set banned_until = 'infinity'
  where id in (select id from public.admin where id::text not like 'a0000000-0000-0000-0000-0000000072%')
    and (banned_until is null or banned_until <= now());
$$;
-- turno(id): privado.siguiente_admin_activo, para llamarlo mientras la sesión de la prueba es la de un admin.
create function pg_temp.turno(p_despues_de uuid default null) returns uuid
language sql stable security definer set search_path = ''
as $$
  select privado.siguiente_admin_activo(p_despues_de);
$$;

-- Invitaciones sembradas, con el estado que cada comprobación necesita. Quien invita es A salvo donde se indica.
insert into public.invitacion_admin (correo, token_hash, id_admin, creada_en, vence_en, usada_en, cancelada_en) values
  -- La lista y la cancelación. El orden de inserción, el del correo y el de quien invita no coinciden con el de la lista
  -- (de la más nueva a la más vieja), para que quitar su order by se note.
  ('ord-b@calibra.test',      pg_temp.h(32), 'a0000000-0000-0000-0000-00000000720d', now() - interval '5 hours', now() + interval '6 days',         null, null),
  ('limite-b@calibra.test',   pg_temp.h(17), 'a0000000-0000-0000-0000-00000000720a', now() - interval '1 day',   now() + interval '1 microsecond',  null, null),
  ('ord-c@calibra.test',      pg_temp.h(31), 'a0000000-0000-0000-0000-00000000720a', now() - interval '30 minutes', now() + interval '6 days',      null, null),
  ('abierta2@calibra.test',   pg_temp.h(11), 'a0000000-0000-0000-0000-00000000720d', now() - interval '2 hours', now() + interval '6 days',         null, null),
  ('ord-a@calibra.test',      pg_temp.h(33), 'a0000000-0000-0000-0000-00000000720b', now() - interval '90 minutes', now() + interval '6 days',       null, null),
  ('abierta@calibra.test',    pg_temp.h(10), 'a0000000-0000-0000-0000-00000000720a', now() - interval '1 hour',  now() + interval '6 days',         null, null),
  ('ord-d@calibra.test',      pg_temp.h(30), 'a0000000-0000-0000-0000-00000000720b', now() - interval '3 hours', now() + interval '6 days',         null, null),
  ('usada@calibra.test',      pg_temp.h(12), 'a0000000-0000-0000-0000-00000000720a', now() - interval '2 days',  now() + interval '5 days',         now() - interval '1 day', null),
  ('cancelada@calibra.test',  pg_temp.h(13), 'a0000000-0000-0000-0000-00000000720a', now() - interval '2 days',  now() + interval '5 days',         null, now() - interval '1 day'),
  ('vencida@calibra.test',    pg_temp.h(14), 'a0000000-0000-0000-0000-00000000720a', now() - interval '10 days', now() - interval '3 days',         null, null),
  ('vencida-b@calibra.test',  pg_temp.h(15), 'a0000000-0000-0000-0000-00000000720a', now() - interval '10 days', now() - interval '3 days',         null, null),
  -- El borde del vencimiento: vence exactamente ahora (ya no sirve); un microsegundo después (limite-b, arriba) todavía sirve.
  ('limite-a@calibra.test',   pg_temp.h(16), 'a0000000-0000-0000-0000-00000000720a', now() - interval '1 day',   now(),                             null, null),
  -- Para registrarse.
  ('reg1@calibra.test',       pg_temp.h(20), 'a0000000-0000-0000-0000-00000000720a', now(), now() + interval '7 days', null, null),
  ('reg2@calibra.test',       pg_temp.h(21), 'a0000000-0000-0000-0000-00000000720a', now(), now() + interval '7 days', null, null),
  ('reg3@calibra.test',       pg_temp.h(22), 'a0000000-0000-0000-0000-00000000720a', now(), now() + interval '7 days', null, null),
  ('admin-b-hu072@calibra.test',  pg_temp.h(23), 'a0000000-0000-0000-0000-00000000720a', now(), now() + interval '7 days', null, null),
  ('monitor-hu072@example.com',   pg_temp.h(24), 'a0000000-0000-0000-0000-00000000720a', now(), now() + interval '7 days', null, null),
  ('sinnombre@calibra.test',  pg_temp.h(25), 'a0000000-0000-0000-0000-00000000720a', now(), now() + interval '7 days', null, null),
  ('reemp@calibra.test',      pg_temp.h(26), 'a0000000-0000-0000-0000-00000000720a', now(), now() + interval '7 days', null, null),
  ('alto@calibra.test',       pg_temp.h(28), 'a0000000-0000-0000-0000-00000000720a', now(), now() + interval '7 days', null, null),
  ('bajo@calibra.test',       pg_temp.h(29), 'a0000000-0000-0000-0000-00000000720a', now(), now() + interval '7 days', null, null),
  -- Quien invita se desactiva (sección 11): una de E, que se desactivará, y una de A, que sigue activa.
  ('inv-off@calibra.test',    pg_temp.h(40), 'a0000000-0000-0000-0000-00000000720e', now(), now() + interval '7 days', null, null),
  ('inv-otro@calibra.test',   pg_temp.h(42), 'a0000000-0000-0000-0000-00000000720a', now(), now() + interval '7 days', null, null);

-- ---------------------------------------------------------------------------
-- 1. Estructura y permisos
-- ---------------------------------------------------------------------------
select has_table('public', 'invitacion_admin', 'Existe public.invitacion_admin');
select columns_are('public', 'invitacion_admin',
  array['id', 'correo', 'token_hash', 'id_admin', 'creada_en', 'vence_en', 'usada_en', 'cancelada_en', 'id_admin_nuevo'],
  'La tabla tiene sus nueve columnas y ninguna más');
select ok((select relrowsecurity from pg_class where oid = 'public.invitacion_admin'::regclass),
  'RLS activa en invitacion_admin');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'invitacion_admin'), 0,
  'Cero políticas: con RLS activa, ni un admin lee la tabla (el hash no llega a un navegador)');
select matches(pg_get_indexdef('public.invitacion_admin_correo_abierta_key'::regclass),
  '^CREATE UNIQUE INDEX invitacion_admin_correo_abierta_key ON public\.invitacion_admin USING btree \(correo\) WHERE \(\(usada_en IS NULL\) AND \(cancelada_en IS NULL\)\)$',
  'Un índice único parcial: una sola invitación abierta por correo');
select is(
  (select array_agg(c.conname::text order by c.conname::text collate "C") from pg_constraint c
   where c.conrelid = 'public.invitacion_admin'::regclass and c.contype in ('c', 'u')),
  array['invitacion_admin_correo_normalizado', 'invitacion_admin_correo_seguro', 'invitacion_admin_nuevo_gastada',
        'invitacion_admin_token_hash_key', 'invitacion_admin_token_hash_sha256', 'invitacion_admin_una_salida',
        'invitacion_admin_vence_despues'],
  'Seis checks y la llave única del hash, con su nombre');
select matches(
  (select pg_get_constraintdef(c.oid) from pg_constraint c
   where c.conrelid = 'public.invitacion_admin'::regclass and c.conname = 'invitacion_admin_id_admin_fkey'),
  '^FOREIGN KEY \(id_admin\) REFERENCES (public\.)?admin\(id\)$',
  'Quien invita no cae en cascada: a un admin se le desactiva, no se le borra (RN-23)');
select matches(
  (select pg_get_constraintdef(c.oid) from pg_constraint c
   where c.conrelid = 'public.invitacion_admin'::regclass and c.conname = 'invitacion_admin_id_admin_nuevo_fkey'),
  '^FOREIGN KEY \(id_admin_nuevo\) REFERENCES (public\.)?admin\(id\) ON DELETE SET NULL$',
  'El admin nuevo queda en null si se borra, no se lleva la invitación');

select ok(
  not has_any_column_privilege('anon', 'public.invitacion_admin', 'select,insert,update,references')
  and not has_table_privilege('anon', 'public.invitacion_admin', 'delete')
  and not has_table_privilege('anon', 'public.invitacion_admin', 'truncate')
  and not has_table_privilege('anon', 'public.invitacion_admin', 'trigger'),
  'anon no tiene ningún permiso sobre invitacion_admin');
select ok(
  not has_any_column_privilege('authenticated', 'public.invitacion_admin', 'select,insert,update,references')
  and not has_table_privilege('authenticated', 'public.invitacion_admin', 'delete')
  and not has_table_privilege('authenticated', 'public.invitacion_admin', 'truncate')
  and not has_table_privilege('authenticated', 'public.invitacion_admin', 'trigger'),
  'authenticated tampoco: ni siquiera select');
select ok(
  has_table_privilege('service_role', 'public.invitacion_admin', 'select')
  and has_table_privilege('service_role', 'public.invitacion_admin', 'insert')
  and has_table_privilege('service_role', 'public.invitacion_admin', 'update')
  and has_table_privilege('service_role', 'public.invitacion_admin', 'delete'),
  'service_role (el servidor) lee, inserta, actualiza y borra');

select ok(
  not has_any_column_privilege('anon', 'public.admin', 'insert,update,references')
  and not has_any_column_privilege('authenticated', 'public.admin', 'insert,update,references')
  and not has_table_privilege('anon', 'public.admin', 'delete')
  and not has_table_privilege('authenticated', 'public.admin', 'delete'),
  'anon y authenticated no escriben en admin: las altas las hace solo el servidor');

-- Quién ejecuta qué.
select ok(
  has_function_privilege('service_role', 'public.crear_invitacion_admin(text, text, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.crear_invitacion_admin(text, text, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.crear_invitacion_admin(text, text, uuid)', 'execute'),
  'public.crear_invitacion_admin: solo service_role');
select ok(
  has_function_privilege('service_role', 'privado.crear_invitacion_admin(text, text, uuid)', 'execute')
  and not has_function_privilege('anon', 'privado.crear_invitacion_admin(text, text, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'privado.crear_invitacion_admin(text, text, uuid)', 'execute'),
  'privado.crear_invitacion_admin: solo service_role');
select ok(
  has_function_privilege('service_role', 'public.registrar_admin(text, uuid, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.registrar_admin(text, uuid, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.registrar_admin(text, uuid, text, text)', 'execute'),
  'public.registrar_admin: solo service_role');
select ok(
  has_function_privilege('authenticated', 'public.invitaciones_de_admin()', 'execute')
  and not has_function_privilege('anon', 'public.invitaciones_de_admin()', 'execute')
  and not has_function_privilege('service_role', 'public.invitaciones_de_admin()', 'execute'),
  'public.invitaciones_de_admin: solo authenticated');
select ok(
  has_function_privilege('service_role', 'public.invitador_activo(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.invitador_activo(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.invitador_activo(uuid)', 'execute'),
  'public.invitador_activo: solo service_role');
select ok(
  has_function_privilege('service_role', 'privado.invitador_activo(uuid)', 'execute')
  and not has_function_privilege('anon', 'privado.invitador_activo(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'privado.invitador_activo(uuid)', 'execute'),
  'privado.invitador_activo: solo service_role');
select ok(
  (select not p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = 'public.invitador_activo(uuid)'::regprocedure)
  and (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = 'privado.invitador_activo(uuid)'::regprocedure),
  'invitador_activo: la puerta de public es invoker, la de privado es definer, las dos con search_path vacío');
select ok(
  has_function_privilege('authenticated', 'privado.invitaciones_de_admin()', 'execute')
  and not has_function_privilege('anon', 'privado.invitaciones_de_admin()', 'execute')
  and not has_function_privilege('service_role', 'privado.invitaciones_de_admin()', 'execute'),
  'privado.invitaciones_de_admin: solo authenticated');
select ok(
  has_function_privilege('authenticated', 'public.cancelar_invitacion_admin(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.cancelar_invitacion_admin(uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.cancelar_invitacion_admin(uuid)', 'execute'),
  'public.cancelar_invitacion_admin: solo authenticated');
select ok(
  has_function_privilege('authenticated', 'privado.cancelar_invitacion_admin(uuid)', 'execute')
  and not has_function_privilege('anon', 'privado.cancelar_invitacion_admin(uuid)', 'execute')
  and not has_function_privilege('service_role', 'privado.cancelar_invitacion_admin(uuid)', 'execute'),
  'privado.cancelar_invitacion_admin: solo authenticated');

select ok(
  (select count(*) = 4 and not bool_or(p.prosecdef) from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('crear_invitacion_admin', 'registrar_admin', 'invitaciones_de_admin', 'cancelar_invitacion_admin')),
  'Las cuatro funciones de public son security invoker');
select ok(
  (select count(*) = 3 and bool_and(p.prosecdef) from pg_proc p
   where p.pronamespace = 'privado'::regnamespace
     and p.proname in ('crear_invitacion_admin', 'invitaciones_de_admin', 'cancelar_invitacion_admin')),
  'Las tres de privado son security definer');
select ok(
  (select count(*) = 7 and bool_and(p.proconfig @> array['search_path=""']) from pg_proc p
   where p.oid in ('public.crear_invitacion_admin(text, text, uuid)'::regprocedure,
                   'privado.crear_invitacion_admin(text, text, uuid)'::regprocedure,
                   'public.registrar_admin(text, uuid, text, text)'::regprocedure,
                   'public.invitaciones_de_admin()'::regprocedure,
                   'privado.invitaciones_de_admin()'::regprocedure,
                   'public.cancelar_invitacion_admin(uuid)'::regprocedure,
                   'privado.cancelar_invitacion_admin(uuid)'::regprocedure)),
  'Las siete fijan search_path vacío');
select ok(
  position('token_hash' in pg_get_function_result('public.invitaciones_de_admin()'::regprocedure)) = 0
  and position('token_hash' in pg_get_function_result('privado.invitaciones_de_admin()'::regprocedure)) = 0,
  'La lista no devuelve el hash');

-- ---------------------------------------------------------------------------
-- 2. Con su sesión, ni un admin activo escribe: eso lo hace solo el servidor
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-00000000720a","role":"authenticated"}';

select throws_ok($$insert into public.admin (id, nombre, correo, orden_revision) values ('a0000000-0000-0000-0000-0000000072c6', 'X', 'x@calibra.test', 999999)$$,
  '42501', null, 'Un admin activo no inserta en admin');
select throws_ok($$update public.admin set nombre = 'X' where id = 'a0000000-0000-0000-0000-00000000720a'$$,
  '42501', null, 'Un admin activo no actualiza admin');
select throws_ok($$delete from public.admin where id = 'a0000000-0000-0000-0000-00000000720e'$$,
  '42501', null, 'Un admin activo no borra de admin');
select throws_ok($$select count(*) from public.invitacion_admin$$,
  '42501', null, 'Un admin activo no lee invitacion_admin: el hash no sale de la base');
select throws_ok($$insert into public.invitacion_admin (correo, token_hash, id_admin) values ('x@calibra.test', pg_temp.h(90), 'a0000000-0000-0000-0000-00000000720a')$$,
  '42501', null, 'Un admin activo no inserta en invitacion_admin');
select throws_ok($$update public.invitacion_admin set cancelada_en = now()$$,
  '42501', null, 'Un admin activo no actualiza invitacion_admin (cancela por la función)');
select throws_ok($$delete from public.invitacion_admin$$,
  '42501', null, 'Un admin activo no borra de invitacion_admin');
select throws_ok($$select * from public.crear_invitacion_admin(pg_temp.h(90), 'x@calibra.test', 'a0000000-0000-0000-0000-00000000720a')$$,
  '42501', null, 'Un admin activo no ejecuta crear_invitacion_admin');
select throws_ok($$select public.registrar_admin(pg_temp.h(20), 'a0000000-0000-0000-0000-0000000072c6', 'reg1@calibra.test', 'X')$$,
  '42501', null, 'Un admin activo no ejecuta registrar_admin');

reset role;
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';

select throws_ok($$select count(*) from public.invitacion_admin$$, '42501', null, 'anon no lee invitacion_admin');
select throws_ok($$insert into public.invitacion_admin (correo, token_hash, id_admin) values ('x@calibra.test', pg_temp.h(90), 'a0000000-0000-0000-0000-00000000720a')$$,
  '42501', null, 'anon no inserta en invitacion_admin');
select throws_ok($$select * from public.crear_invitacion_admin(pg_temp.h(90), 'x@calibra.test', 'a0000000-0000-0000-0000-00000000720a')$$,
  '42501', null, 'anon no ejecuta crear_invitacion_admin');
select throws_ok($$select public.registrar_admin(pg_temp.h(20), 'a0000000-0000-0000-0000-0000000072c6', 'reg1@calibra.test', 'X')$$,
  '42501', null, 'anon no ejecuta registrar_admin');
select throws_ok($$select * from public.invitaciones_de_admin()$$, '42501', null, 'anon no ejecuta invitaciones_de_admin');
select throws_ok($$select public.cancelar_invitacion_admin(pg_temp.inv(10))$$, '42501', null, 'anon no ejecuta cancelar_invitacion_admin');
reset role;

-- ---------------------------------------------------------------------------
-- 3. Las restricciones de la tabla (como postgres: ni el dueño las salta)
-- ---------------------------------------------------------------------------
select throws_ok($$insert into public.invitacion_admin (correo, token_hash, id_admin) values ('x1@calibra.test', 'token-en-claro', 'a0000000-0000-0000-0000-00000000720a')$$,
  '23514', 'new row for relation "invitacion_admin" violates check constraint "invitacion_admin_token_hash_sha256"',
  'Un token en claro no entra: el hash debe ser SHA-256 en hex');
select throws_ok($$insert into public.invitacion_admin (correo, token_hash, id_admin) values ('x1@calibra.test', upper(pg_temp.h(255)), 'a0000000-0000-0000-0000-00000000720a')$$,
  '23514', 'new row for relation "invitacion_admin" violates check constraint "invitacion_admin_token_hash_sha256"',
  'Un hash con mayúsculas tampoco');
select throws_ok($$insert into public.invitacion_admin (correo, token_hash, id_admin) values ('x1@calibra.test', pg_temp.h(1) || '0', 'a0000000-0000-0000-0000-00000000720a')$$,
  '23514', 'new row for relation "invitacion_admin" violates check constraint "invitacion_admin_token_hash_sha256"',
  'Ni uno de 65 caracteres');
select throws_ok($$insert into public.invitacion_admin (correo, token_hash, id_admin) values ('X1@Calibra.test', pg_temp.h(91), 'a0000000-0000-0000-0000-00000000720a')$$,
  '23514', 'new row for relation "invitacion_admin" violates check constraint "invitacion_admin_correo_normalizado"',
  'El correo se guarda en minúsculas');
select throws_ok($$insert into public.invitacion_admin (correo, token_hash, id_admin) values ('a@x.co?bcc=b@y.co', pg_temp.h(91), 'a0000000-0000-0000-0000-00000000720a')$$,
  '23514', 'new row for relation "invitacion_admin" violates check constraint "invitacion_admin_correo_seguro"',
  'Un correo con una copia oculta escondida (HU-070) no entra');
select throws_ok($$insert into public.invitacion_admin (correo, token_hash, id_admin) values ('a b@x.co', pg_temp.h(91), 'a0000000-0000-0000-0000-00000000720a')$$,
  '23514', 'new row for relation "invitacion_admin" violates check constraint "invitacion_admin_correo_seguro"',
  'Un correo con un espacio adentro tampoco');
select throws_ok($$insert into public.invitacion_admin (correo, token_hash, id_admin, creada_en, vence_en) values ('x1@calibra.test', pg_temp.h(91), 'a0000000-0000-0000-0000-00000000720a', now(), now())$$,
  '23514', 'new row for relation "invitacion_admin" violates check constraint "invitacion_admin_vence_despues"',
  'Vence después de crearse');
select throws_ok($$insert into public.invitacion_admin (correo, token_hash, id_admin, usada_en, cancelada_en) values ('x1@calibra.test', pg_temp.h(91), 'a0000000-0000-0000-0000-00000000720a', now(), now())$$,
  '23514', 'new row for relation "invitacion_admin" violates check constraint "invitacion_admin_una_salida"',
  'No puede estar usada y cancelada a la vez');
select throws_ok($$insert into public.invitacion_admin (correo, token_hash, id_admin, id_admin_nuevo) values ('x1@calibra.test', pg_temp.h(91), 'a0000000-0000-0000-0000-00000000720a', 'a0000000-0000-0000-0000-00000000720e')$$,
  '23514', 'new row for relation "invitacion_admin" violates check constraint "invitacion_admin_nuevo_gastada"',
  'Sin usar no puede tener admin nuevo');
select throws_ok($$insert into public.invitacion_admin (correo, token_hash, id_admin) values ('x1@calibra.test', pg_temp.h(91), 'a0000000-0000-0000-0000-0000000072ff')$$,
  '23503', null, 'Quien invita tiene que ser un admin que existe');
select throws_ok($$insert into public.invitacion_admin (correo, token_hash, id_admin) values ('t1@calibra.test', pg_temp.h(92), 'a0000000-0000-0000-0000-00000000720a'), ('t2@calibra.test', pg_temp.h(92), 'a0000000-0000-0000-0000-00000000720a')$$,
  '23505', 'duplicate key value violates unique constraint "invitacion_admin_token_hash_key"', 'Un token no se repite');
select throws_ok($$insert into public.invitacion_admin (correo, token_hash, id_admin) values ('dup@calibra.test', pg_temp.h(93), 'a0000000-0000-0000-0000-00000000720a'), ('dup@calibra.test', pg_temp.h(94), 'a0000000-0000-0000-0000-00000000720a')$$,
  '23505', 'duplicate key value violates unique constraint "invitacion_admin_correo_abierta_key"',
  'Dos abiertas del mismo correo no caben');
select lives_ok($$insert into public.invitacion_admin (correo, token_hash, id_admin, usada_en, cancelada_en) values
    ('mismo@calibra.test', pg_temp.h(95), 'a0000000-0000-0000-0000-00000000720a', now(), null),
    ('mismo@calibra.test', pg_temp.h(96), 'a0000000-0000-0000-0000-00000000720a', null, now()),
    ('mismo@calibra.test', pg_temp.h(97), 'a0000000-0000-0000-0000-00000000720a', null, null)$$,
  'Una abierta puede convivir con una usada y una cancelada del mismo correo');

-- ---------------------------------------------------------------------------
-- 4. crear_invitacion_admin (como service_role: es quien la llama)
-- ---------------------------------------------------------------------------
set local role service_role;

-- Una nueva: el correo se normaliza, el hash se guarda, son 7 días.
insert into res select 'c1', * from public.crear_invitacion_admin(pg_temp.h(1), ' Nuevo@Calibra.test ', 'a0000000-0000-0000-0000-00000000720a');
select is((select resultado from res where clave = 'c1'), 'creada', 'Un admin activo invita a un correo libre: creada');
select results_eq(
  $$select correo, token_hash, id_admin, usada_en, cancelada_en, id_admin_nuevo, vence_en = creada_en + interval '7 days'
    from public.invitacion_admin where token_hash = pg_temp.h(1)$$,
  $$values ('nuevo@calibra.test'::text, pg_temp.h(1), 'a0000000-0000-0000-0000-00000000720a'::uuid, null::timestamptz, null::timestamptz, null::uuid, true)$$,
  'La fila: correo en minúsculas y sin espacios, el hash, quién invita, sin usar ni cancelar y vence a los 7 días');
select ok(
  (select r.id_invitacion = i.id and r.vencimiento = i.vence_en
   from res r, public.invitacion_admin i where r.clave = 'c1' and i.token_hash = pg_temp.h(1)),
  'Devuelve el id y el vencimiento de la fila creada');

-- Reinvitar: la primera deja de servir, la nueva es de quien invita ahora.
insert into res select 'c2', * from public.crear_invitacion_admin(pg_temp.h(2), 'NUEVO@calibra.test', 'a0000000-0000-0000-0000-00000000720b');
select is((select resultado from res where clave = 'c2'), 'creada', 'Invitar otra vez el mismo correo (en mayúsculas) también da creada');
select ok((select cancelada_en is not null from public.invitacion_admin where token_hash = pg_temp.h(1)),
  'La primera quedó cancelada: su enlace ya no sirve');
select is(pg_temp.abiertas('nuevo@calibra.test'), 1, 'Queda una sola invitación abierta por correo');
select is((select count(*)::int from public.invitacion_admin where correo = 'nuevo@calibra.test'), 2,
  'La cancelada se conserva: son dos filas');
select is((select id_admin from public.invitacion_admin where token_hash = pg_temp.h(2)), 'a0000000-0000-0000-0000-00000000720b'::uuid,
  'La nueva queda a nombre de quien invita ahora');

-- Una abierta pero vencida también se reemplaza (el índice parcial no puede mirar now()).
insert into res select 'c3', * from public.crear_invitacion_admin(pg_temp.h(3), 'vencida@calibra.test', 'a0000000-0000-0000-0000-00000000720a');
select is((select resultado from res where clave = 'c3'), 'creada', 'Se puede invitar a quien tenía una invitación abierta ya vencida');
select ok((select cancelada_en is not null from public.invitacion_admin where token_hash = pg_temp.h(14)),
  'La vencida sin usar se canceló al reinvitar');
select is(pg_temp.abiertas('vencida@calibra.test'), 1, 'Y queda una sola abierta');

-- Los rechazos no cambian nada.
insert into memo values ('h', pg_temp.huella()) on conflict (clave) do update set valor = excluded.valor;

insert into res select 'c4', * from public.crear_invitacion_admin(pg_temp.h(4), ' ADMIN-B-HU072@calibra.test ', 'a0000000-0000-0000-0000-00000000720a');
select results_eq($$select resultado, id_invitacion, vencimiento from res where clave = 'c4'$$,
  $$values ('es_admin'::text, null::uuid, null::timestamptz)$$,
  'El correo de un admin activo (guardado en mayúsculas, escrito con espacios): es_admin');
insert into res select 'c5', * from public.crear_invitacion_admin(pg_temp.h(4), 'Admin-D-HU072@calibra.test', 'a0000000-0000-0000-0000-00000000720a');
select results_eq($$select resultado, id_invitacion, vencimiento from res where clave = 'c5'$$,
  $$values ('es_admin_desactivado'::text, null::uuid, null::timestamptz)$$,
  'El correo de un admin desactivado: es_admin_desactivado');
insert into res select 'c6', * from public.crear_invitacion_admin(pg_temp.h(4), ' monitor-hu072@EXAMPLE.com', 'a0000000-0000-0000-0000-00000000720a');
select results_eq($$select resultado, id_invitacion, vencimiento from res where clave = 'c6'$$,
  $$values ('es_monitor'::text, null::uuid, null::timestamptz)$$,
  'El correo de un monitor (guardado en mayúsculas): es_monitor');
insert into res select 'c7a', * from public.crear_invitacion_admin(pg_temp.h(4), 'libre@calibra.test', 'a0000000-0000-0000-0000-00000000720d');
select results_eq($$select resultado, id_invitacion, vencimiento from res where clave = 'c7a'$$,
  $$values ('sin_permiso'::text, null::uuid, null::timestamptz)$$,
  'Un admin desactivado no invita, aunque llegue con la llave secreta: sin_permiso');
insert into res select 'c7b', * from public.crear_invitacion_admin(pg_temp.h(4), 'libre@calibra.test', 'b0000000-0000-0000-0000-000000007201');
select results_eq($$select resultado, id_invitacion, vencimiento from res where clave = 'c7b'$$,
  $$values ('sin_permiso'::text, null::uuid, null::timestamptz)$$,
  'Un monitor tampoco: sin_permiso');
insert into res select 'c7c', * from public.crear_invitacion_admin(pg_temp.h(4), 'libre@calibra.test', null);
select results_eq($$select resultado, id_invitacion, vencimiento from res where clave = 'c7c'$$,
  $$values ('sin_permiso'::text, null::uuid, null::timestamptz)$$,
  'Sin quien invita: sin_permiso');
insert into res select 'c7d', * from public.crear_invitacion_admin(pg_temp.h(4), 'libre@calibra.test', 'a0000000-0000-0000-0000-0000000072ff');
select results_eq($$select resultado, id_invitacion, vencimiento from res where clave = 'c7d'$$,
  $$values ('sin_permiso'::text, null::uuid, null::timestamptz)$$,
  'Quien invita con un id que no es de ningún admin: sin_permiso');
select is(pg_temp.huella(), (select valor from memo where clave = 'h'),
  'Con cada rechazo, admin e invitacion_admin quedan exactamente igual');

-- Si el correo o el hash no cumplen, la llamada entera se revierte, también la cancelación de la abierta.
select throws_ok($$select * from public.crear_invitacion_admin(pg_temp.h(5), 'nuevo@calibra.test?bcc=b@y.co', 'a0000000-0000-0000-0000-00000000720a')$$,
  '23514', 'new row for relation "invitacion_admin" violates check constraint "invitacion_admin_correo_seguro"',
  'Un correo inseguro falla con 23514');
select throws_ok($$select * from public.crear_invitacion_admin('token-en-claro', 'nuevo@calibra.test', 'a0000000-0000-0000-0000-00000000720a')$$,
  '23514', 'new row for relation "invitacion_admin" violates check constraint "invitacion_admin_token_hash_sha256"',
  'Un hash mal formado falla con 23514');
select is(pg_temp.abiertas('nuevo@calibra.test'), 1, 'Tras el fallo, la invitación abierta de ese correo sigue abierta');
select is(pg_temp.huella(), (select valor from memo where clave = 'h'), 'Y no cambió nada más');

-- Dos filas de admin con el mismo correo (admin.correo no es único): si una está activa, gana la activa.
reset role;
update public.admin set correo = 'ADMIN-D-HU072@calibra.test' where id = 'a0000000-0000-0000-0000-00000000720e';
set local role service_role;
insert into res select 'c9', * from public.crear_invitacion_admin(pg_temp.h(6), 'admin-d-hu072@calibra.test', 'a0000000-0000-0000-0000-00000000720a');
select results_eq($$select resultado, id_invitacion, vencimiento from res where clave = 'c9'$$,
  $$values ('es_admin'::text, null::uuid, null::timestamptz)$$,
  'Con una fila activa y otra desactivada con el mismo correo, es_admin');
reset role;
update public.admin set correo = 'admin-e-hu072@calibra.test' where id = 'a0000000-0000-0000-0000-00000000720e';

-- ---------------------------------------------------------------------------
-- 5. registrar_admin (como service_role)
-- ---------------------------------------------------------------------------
-- Lo que devuelve false no cambia nada.
select is(pg_temp.registro_sin_cambios(pg_temp.h(12), 'a0000000-0000-0000-0000-0000000072c2', 'usada@calibra.test', 'X'), 'false', 'Una invitación ya usada: false, sin cambios');
select is(pg_temp.registro_sin_cambios(pg_temp.h(13), 'a0000000-0000-0000-0000-0000000072c2', 'cancelada@calibra.test', 'X'), 'false', 'Una cancelada: false, sin cambios');
select is(pg_temp.registro_sin_cambios(pg_temp.h(15), 'a0000000-0000-0000-0000-0000000072c2', 'vencida-b@calibra.test', 'X'), 'false', 'Una vencida: false, sin cambios');
select is(pg_temp.registro_sin_cambios(pg_temp.h(16), 'a0000000-0000-0000-0000-0000000072c2', 'limite-a@calibra.test', 'X'), 'false',
  'Una que vence exactamente ahora: false, sin cambios');
select is(pg_temp.registro_sin_cambios(pg_temp.h(21), 'a0000000-0000-0000-0000-0000000072c2', 'otro@calibra.test', 'X'), 'false',
  'Un token válido con el correo de otra persona: false, sin cambios');
select is(pg_temp.registro_sin_cambios(pg_temp.h(99), 'a0000000-0000-0000-0000-0000000072c2', 'reg2@calibra.test', 'X'), 'false', 'Un token inventado: false, sin cambios');
select is(pg_temp.registro_sin_cambios(null, 'a0000000-0000-0000-0000-0000000072c2', 'reg2@calibra.test', 'X'), 'false', 'Sin token: false, sin cambios');
select is(pg_temp.registro_sin_cambios(pg_temp.h(21), 'a0000000-0000-0000-0000-0000000072c2', null, 'X'), 'false', 'Sin correo: false, sin cambios');

-- Lo que no es una invitación mala sino un dato malo lanza, y la invitación NO se gasta.
set local role service_role;
select throws_ok($$select public.registrar_admin(pg_temp.h(25), 'a0000000-0000-0000-0000-0000000072c5', 'sinnombre@calibra.test', '   ')$$,
  '22023', 'El nombre no puede estar vacío', 'Un nombre de solo espacios lanza 22023');
select throws_ok($$select public.registrar_admin(pg_temp.h(25), 'a0000000-0000-0000-0000-0000000072c5', 'sinnombre@calibra.test', null)$$,
  '22023', 'El nombre no puede estar vacío', 'Un nombre nulo también');
select is(pg_temp.estado(25), 'abierta', 'Y la invitación sigue sin gastar');
select throws_ok($$select public.registrar_admin(pg_temp.h(23), 'a0000000-0000-0000-0000-0000000072c5', 'admin-b-hu072@calibra.test', 'Otro B')$$,
  'P0001', 'Ese correo ya es de un admin o de un monitor', 'Un correo que ya es de un admin (guardado en mayúsculas) lanza P0001');
select is(pg_temp.estado(23), 'abierta', 'Y la invitación queda sin gastar: no se pierde un token sin dar de alta a nadie');
select throws_ok($$select public.registrar_admin(pg_temp.h(24), 'a0000000-0000-0000-0000-0000000072c5', 'monitor-hu072@example.com', 'Otro M')$$,
  'P0001', 'Ese correo ya es de un admin o de un monitor', 'Un correo que ya es de un monitor (guardado en mayúsculas) también');
select is(pg_temp.estado(24), 'abierta', 'Y la invitación queda sin gastar');

-- El camino feliz.
reset role;
insert into memo values ('max', pg_temp.maximo()::text), ('ordenes', pg_temp.ordenes_sin(null)) on conflict (clave) do update set valor = excluded.valor;
set local role service_role;

select is(public.registrar_admin(pg_temp.h(20), 'a0000000-0000-0000-0000-0000000072c1', ' REG1@calibra.test ', '  Nuevo Uno  '), true,
  'Una invitación vigente da de alta al admin: true');
select results_eq(
  $$select nombre, correo, orden_revision from public.admin where id = 'a0000000-0000-0000-0000-0000000072c1'$$,
  $$select 'Nuevo Uno'::text, 'reg1@calibra.test'::text, (select valor::integer + 1 from memo where clave = 'max')$$,
  'El admin queda con el nombre recortado, el correo normalizado y el máximo orden de antes más uno');
select results_eq(
  $$select usada_en is not null, cancelada_en is null, id_admin_nuevo from public.invitacion_admin where token_hash = pg_temp.h(20)$$,
  $$values (true, true, 'a0000000-0000-0000-0000-0000000072c1'::uuid)$$,
  'La invitación queda gastada y ligada al admin nuevo');
select is(pg_temp.estado(21), 'abierta', 'Solo gastó la suya: la invitación de otra persona sigue abierta');
select is(pg_temp.ordenes_sin('a0000000-0000-0000-0000-0000000072c1'), (select valor from memo where clave = 'ordenes'), 'Ningún otro admin cambió de orden');

-- Un segundo uso del mismo token.
select is(pg_temp.registro_sin_cambios(pg_temp.h(20), 'a0000000-0000-0000-0000-0000000072c2', 'reg1@calibra.test', 'Otra vez'), 'false',
  'Volver a usar el mismo enlace: false, sin cambios');

-- Dos altas seguidas: órdenes consecutivos y distintos.
select is(public.registrar_admin(pg_temp.h(21), 'a0000000-0000-0000-0000-0000000072c2', 'reg2@calibra.test', 'Nuevo Dos'), true, 'Segunda alta: true');
select is(public.registrar_admin(pg_temp.h(22), 'a0000000-0000-0000-0000-0000000072c3', 'reg3@calibra.test', 'Nuevo Tres'), true, 'Tercera alta: true');
select results_eq(
  $$select a2.orden_revision, a3.orden_revision from public.admin a2, public.admin a3 where a2.id = 'a0000000-0000-0000-0000-0000000072c2' and a3.id = 'a0000000-0000-0000-0000-0000000072c3'$$,
  $$select (select valor::integer from memo where clave = 'max') + 2, (select valor::integer from memo where clave = 'max') + 3$$,
  'Los órdenes son consecutivos: cada uno el máximo anterior más uno');

-- Cancelada por otra invitación del mismo correo: la primera ya no sirve, la segunda sí.
insert into res select 'c10', * from public.crear_invitacion_admin(pg_temp.h(27), 'reemp@calibra.test', 'a0000000-0000-0000-0000-00000000720b');
select is((select resultado from res where clave = 'c10'), 'creada', 'Se reinvita a un correo con una abierta');
select is(pg_temp.registro_sin_cambios(pg_temp.h(26), 'a0000000-0000-0000-0000-0000000072c4', 'reemp@calibra.test', 'Reemplazado'), 'false',
  'El enlace anterior ya no sirve: false, sin cambios');
select is(public.registrar_admin(pg_temp.h(27), 'a0000000-0000-0000-0000-0000000072c4', 'reemp@calibra.test', 'Reemplazado'), true, 'El enlace nuevo sí sirve: true');
reset role;

-- ---------------------------------------------------------------------------
-- 6. El turno (RN-42): el admin nuevo está activo desde el primer momento, pero va al final
-- ---------------------------------------------------------------------------
call pg_temp.aislar();
select is(pg_temp.turno(null), 'a0000000-0000-0000-0000-00000000720a'::uuid, 'Los pagos nuevos siguen yendo al primer activo, no al admin nuevo');
update auth.users set banned_until = 'infinity' where id::text like 'a0000000-0000-0000-0000-0000000072%' and id <> 'a0000000-0000-0000-0000-0000000072c1';
select is(privado.admin_activo('a0000000-0000-0000-0000-0000000072c1'), true, 'El admin recién registrado cuenta como activo');
select is(pg_temp.turno(null), 'a0000000-0000-0000-0000-0000000072c1'::uuid, 'Si los anteriores están desactivados, el único activo es el nuevo');
update auth.users set banned_until = null where id in ('a0000000-0000-0000-0000-00000000720a', 'a0000000-0000-0000-0000-00000000720b', 'a0000000-0000-0000-0000-00000000720e', 'a0000000-0000-0000-0000-0000000072c1', 'a0000000-0000-0000-0000-0000000072c2', 'a0000000-0000-0000-0000-0000000072c3', 'a0000000-0000-0000-0000-0000000072c4');
call pg_temp.aislar();
select is(pg_temp.turno('a0000000-0000-0000-0000-0000000072c4'), 'a0000000-0000-0000-0000-00000000720a'::uuid, 'Después del último (el más nuevo) vuelve al primero');

-- ---------------------------------------------------------------------------
-- 7. El orden con números extremos
-- ---------------------------------------------------------------------------
-- Un admin de orden muy alto: el nuevo es el máximo más uno, no un conteo ni un número fijo.
insert into public.admin (id, nombre, correo, orden_revision) values ('a0000000-0000-0000-0000-00000000720f', 'Admin H HU072', 'admin-h-hu072@calibra.test', 2000000000);
insert into memo values ('max_alto', pg_temp.maximo()::text) on conflict (clave) do update set valor = excluded.valor;
set local role service_role;
select is(public.registrar_admin(pg_temp.h(28), 'a0000000-0000-0000-0000-0000000072c5', 'alto@calibra.test', 'Nuevo Alto'), true, 'Con un admin de orden 2000000000: true');
select results_eq($$select orden_revision from public.admin where id = 'a0000000-0000-0000-0000-0000000072c5'$$,
  $$select (select valor::integer + 1 from memo where clave = 'max_alto')$$,
  'El nuevo recibe exactamente el máximo más uno (por encima de 2000000000)');
reset role;

-- ---------------------------------------------------------------------------
-- 8. La lista (como un admin activo)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-00000000720a","role":"authenticated"}';

select results_eq(
  $$select correo, invitada_por, invito_activo from public.invitaciones_de_admin()
    where correo in ('abierta@calibra.test', 'abierta2@calibra.test', 'usada@calibra.test', 'cancelada@calibra.test',
                     'vencida-b@calibra.test', 'limite-a@calibra.test', 'limite-b@calibra.test',
                     'ord-a@calibra.test', 'ord-b@calibra.test', 'ord-c@calibra.test', 'ord-d@calibra.test')$$,
  $$values ('ord-c@calibra.test'::text, 'Admin A HU072'::text, true),
           ('abierta@calibra.test', 'Admin A HU072', true),
           ('ord-a@calibra.test', 'Admin B HU072', true),
           ('abierta2@calibra.test', 'Admin D HU072', false),
           ('ord-d@calibra.test', 'Admin B HU072', true),
           ('ord-b@calibra.test', 'Admin D HU072', false),
           ('limite-b@calibra.test', 'Admin A HU072', true)$$,
  'La lista trae solo las abiertas y vigentes, de la más nueva a la más vieja, con quién invitó y si sigue activo');
select is(
  (select count(*)::int from public.invitaciones_de_admin()
   where correo in ('usada@calibra.test', 'cancelada@calibra.test', 'vencida-b@calibra.test', 'limite-a@calibra.test')),
  0, 'La usada, la cancelada, la vencida y la que vence justo ahora no salen');
select is(
  (select count(*)::int from public.invitaciones_de_admin() where correo in ('nuevo@calibra.test', 'vencida@calibra.test', 'reemp@calibra.test')),
  2, 'Las creadas por la función salen una vez; la que se registró no sale');

-- Si quien invitó se desactiva después, la lista lo marca.
reset role;
update auth.users set banned_until = now() + interval '100 years' where id = 'a0000000-0000-0000-0000-00000000720a';
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-00000000720b","role":"authenticated"}';
select is((select invito_activo from public.invitaciones_de_admin() where correo = 'abierta@calibra.test'), false,
  'Tras desactivar a quien invitó, la lista dice que ya no está activo');
reset role;
update auth.users set banned_until = null where id = 'a0000000-0000-0000-0000-00000000720a';

-- Quien no es un admin activo ve la lista vacía.
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-00000000720d","role":"authenticated"}';
select is((select count(*)::int from public.invitaciones_de_admin()), 0, 'Un admin desactivado no ve ninguna invitación');
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-000000007201","role":"authenticated"}';
select is((select count(*)::int from public.invitaciones_de_admin()), 0, 'Un monitor no ve ninguna');
set local request.jwt.claims to '{"sub":"d0000000-0000-0000-0000-000000007201","role":"authenticated"}';
select is((select count(*)::int from public.invitaciones_de_admin()), 0, 'Un estudiante no ve ninguna');
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000007201","role":"authenticated","is_anonymous":true}';
select is((select count(*)::int from public.invitaciones_de_admin()), 0, 'Una sesión anónima no ve ninguna');
reset role;

-- ---------------------------------------------------------------------------
-- 9. Cancelar (como un admin activo)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-00000000720b","role":"authenticated"}';

select is(public.cancelar_invitacion_admin(pg_temp.inv(10)), 'cancelada', 'Cancelar una abierta: cancelada');
select is(pg_temp.estado(10), 'cancelada', 'Queda con cancelada_en');
select is((select count(*)::int from public.invitaciones_de_admin() where correo = 'abierta@calibra.test'), 0, 'Sale de la lista');
select is(pg_temp.registro_sin_cambios(pg_temp.h(10), 'a0000000-0000-0000-0000-0000000072c6', 'abierta@calibra.test', 'X'), 'false',
  'Y su enlace ya no sirve para registrarse');
select is(public.cancelar_invitacion_admin(pg_temp.inv(10)), 'no_abierta', 'Cancelar otra vez: no_abierta');
select is(public.cancelar_invitacion_admin(pg_temp.inv(12)), 'no_abierta', 'Cancelar una usada: no_abierta');
select is(pg_temp.estado(12), 'usada', 'Y sigue usada');
select is(public.cancelar_invitacion_admin(pg_temp.inv(15)), 'no_abierta', 'Cancelar una vencida: no_abierta');
select is(public.cancelar_invitacion_admin(pg_temp.inv(16)), 'no_abierta', 'Cancelar la que vence justo ahora: no_abierta');
select is(public.cancelar_invitacion_admin('a0000000-0000-0000-0000-0000000072ff'), 'no_encontrada', 'Un id que no existe: no_encontrada');
select is(public.cancelar_invitacion_admin(null), 'no_encontrada', 'Sin id: no_encontrada');

-- Quien no es un admin activo no cancela nada.
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-00000000720d","role":"authenticated"}';
select is(public.cancelar_invitacion_admin(pg_temp.inv(11)), 'sin_permiso', 'Un admin desactivado no cancela: sin_permiso');
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-000000007201","role":"authenticated"}';
select is(public.cancelar_invitacion_admin(pg_temp.inv(11)), 'sin_permiso', 'Un monitor no cancela: sin_permiso');
set local request.jwt.claims to '{"sub":"d0000000-0000-0000-0000-000000007201","role":"authenticated"}';
select is(public.cancelar_invitacion_admin(pg_temp.inv(11)), 'sin_permiso', 'Un estudiante no cancela: sin_permiso');
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000007201","role":"authenticated","is_anonymous":true}';
select is(public.cancelar_invitacion_admin(pg_temp.inv(11)), 'sin_permiso', 'Una sesión anónima no cancela: sin_permiso');
select is(pg_temp.estado(11), 'abierta', 'Y la invitación sigue abierta');

-- Cancelar una deja las demás abiertas.
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-00000000720a","role":"authenticated"}';
insert into memo values ('abiertas', pg_temp.n_abiertas()::text) on conflict (clave) do update set valor = excluded.valor;
select is(public.cancelar_invitacion_admin(pg_temp.inv(11)), 'cancelada', 'Un admin activo cancela la de otro admin (aunque ya esté desactivado): cancelada');
select is(pg_temp.n_abiertas(), (select valor::integer - 1 from memo where clave = 'abiertas'), 'Cancela solo esa: las demás siguen abiertas');
select is(pg_temp.estado(17), 'abierta', 'La que vence un microsegundo después sigue abierta');
reset role;

-- ---------------------------------------------------------------------------
-- 10. El orden cuando todos los órdenes son negativos
-- ---------------------------------------------------------------------------
-- Todos los órdenes bajan 2100000000: ahora ninguno es positivo. El nuevo es el máximo más uno (negativo), no un conteo.
update public.admin set orden_revision = orden_revision - 2100000000;
insert into memo values ('max_bajo', pg_temp.maximo()::text) on conflict (clave) do update set valor = excluded.valor;
select cmp_ok((select valor::integer from memo where clave = 'max_bajo'), '<', 0, 'Punto de partida: ningún orden es positivo');
set local role service_role;
select is(public.registrar_admin(pg_temp.h(29), 'a0000000-0000-0000-0000-0000000072c6', 'bajo@calibra.test', 'Nuevo Bajo'), true, 'Con todos los órdenes negativos: true');
select results_eq($$select orden_revision from public.admin where id = 'a0000000-0000-0000-0000-0000000072c6'$$,
  $$select (select valor::integer + 1 from memo where clave = 'max_bajo')$$,
  'El nuevo recibe exactamente el máximo más uno, también cuando es negativo');
reset role;

-- ---------------------------------------------------------------------------
-- 11. Quien invitó tiene que seguir activo: la invitación de un admin desactivado no sirve
-- ---------------------------------------------------------------------------
-- Si la cuenta de un admin se compromete y el equipo la desactiva, lo que esa cuenta invitó no puede convertir a otra
-- persona en admin. Se comprueba al gastar la invitación (registrar_admin), no al desactivar: así tampoco hay carrera con
-- una invitación que se inserta justo antes del baneo. Si lo reactivan, vuelve a servir.
set local role service_role;
select is(
  (select array_agg(public.invitador_activo(t.id) order by t.n)
   from (values (1, 'a0000000-0000-0000-0000-00000000720e'::uuid),   -- admin activo
                (2, 'a0000000-0000-0000-0000-00000000720d'::uuid),   -- admin desactivado
                (3, 'b0000000-0000-0000-0000-000000007201'::uuid),   -- un monitor
                (4, null::uuid),
                (5, 'a0000000-0000-0000-0000-0000000072ff'::uuid)) as t(n, id)),   -- nadie
  array[true, false, false, false, false],
  'service_role pregunta si quien invitó sigue activo: solo un admin activo da true');

-- Una invitación que E crea con la función, mientras es un admin activo (el caso de la carrera: se inserta antes del baneo).
insert into res select 'c40', * from public.crear_invitacion_admin(pg_temp.h(41), 'inv-carrera@calibra.test', 'a0000000-0000-0000-0000-00000000720e');
select is((select resultado from res where clave = 'c40'), 'creada', 'E, todavía activo, crea una invitación');
reset role;

-- Se desactiva a E (el baneo de Auth, como lo hace desactivarCuenta).
update auth.users set banned_until = now() + interval '100 years' where id = 'a0000000-0000-0000-0000-00000000720e';
select is(privado.admin_activo('a0000000-0000-0000-0000-00000000720e'), false, 'Punto de partida: E ya no está activo');

select is(pg_temp.registro_sin_cambios(pg_temp.h(40), 'a0000000-0000-0000-0000-0000000072c7', 'inv-off@calibra.test', 'Nuevo Siete'), 'false',
  'La invitación abierta de un admin desactivado no sirve: false, sin cambios');
select is(pg_temp.registro_sin_cambios(pg_temp.h(41), 'a0000000-0000-0000-0000-0000000072c7', 'inv-carrera@calibra.test', 'Nuevo Siete'), 'false',
  'Ni la que se insertó justo antes del baneo: no hay barrido que una carrera pueda saltarse');
select is(pg_temp.estado(40), 'abierta', 'Y no se gastó: sigue abierta (se puede cancelar, o servir de nuevo si reactivan a quien invitó)');

-- La lista la sigue mostrando, marcada: cualquier admin activo la ve y la puede cancelar.
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-00000000720a","role":"authenticated"}';
select is((select invito_activo from public.invitaciones_de_admin() where correo = 'inv-off@calibra.test'), false,
  'La lista sigue mostrando la invitación de E, con invito_activo en false');
reset role;

-- Solo cuenta quien invitó: la de A, que sigue activo, sirve aunque E esté desactivado.
select is(public.registrar_admin(pg_temp.h(42), 'a0000000-0000-0000-0000-0000000072c8', 'inv-otro@calibra.test', 'Nuevo Ocho'), true,
  'La invitación de un admin activo sirve aunque otro admin esté desactivado');

-- Se reactiva a E: sus invitaciones vuelven a servir hasta que venzan.
update auth.users set banned_until = null where id = 'a0000000-0000-0000-0000-00000000720e';
select is(public.registrar_admin(pg_temp.h(40), 'a0000000-0000-0000-0000-0000000072c7', 'inv-off@calibra.test', 'Nuevo Siete'), true,
  'Reactivado quien invitó, su invitación vuelve a servir');
select is(pg_temp.estado(40), 'usada', 'Y queda gastada');

select * from finish();
rollback;
