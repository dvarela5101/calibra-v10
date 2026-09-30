-- Pruebas pgTAP del contacto al agendar (HU-068, D-3, P-23).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.

begin;
create extension if not exists pgtap with schema extensions;

select plan(30);

-- ---------------------------------------------------------------------------
-- Estructura y permisos: todo lo escribe el servidor
-- ---------------------------------------------------------------------------
select has_table('public', 'lead_sesion', 'Existe lead_sesion (otras sesiones de un Lead, P-23)');
select has_table('public', 'verificacion_lead', 'Existe verificacion_lead (enlace para confirmar el correo, P-23)');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.lead_sesion'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.verificacion_lead'::regclass),
  'Las dos tablas tienen RLS');
select ok(
  not has_table_privilege('anon', 'public.lead_sesion', 'select')
  and not has_table_privilege('authenticated', 'public.lead_sesion', 'select')
  and not has_table_privilege('anon', 'public.verificacion_lead', 'select')
  and not has_table_privilege('authenticated', 'public.verificacion_lead', 'select')
  and not has_table_privilege('authenticated', 'public.verificacion_lead', 'insert'),
  'Ninguna sesión lee ni escribe las sesiones de un Lead ni sus enlaces de verificación');
select ok(
  has_table_privilege('service_role', 'public.verificacion_lead', 'insert')
  and has_table_privilege('service_role', 'public.lead_sesion', 'insert'),
  'El servidor (service_role) sí');
select ok(
  has_function_privilege('service_role', 'public.registrar_lead(uuid, text, text, text, boolean, timestamptz, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.registrar_lead(uuid, text, text, text, boolean, timestamptz, text)', 'execute')
  and not has_function_privilege('anon', 'public.registrar_lead(uuid, text, text, text, boolean, timestamptz, text)', 'execute'),
  'registrar_lead solo la llama el servidor');
select ok(
  has_function_privilege('service_role', 'public.confirmar_correo_de_lead(text, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.confirmar_correo_de_lead(text, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.confirmar_correo_de_lead(text, uuid)', 'execute'),
  'confirmar_correo_de_lead solo la llama el servidor');

-- ---------------------------------------------------------------------------
-- Fixtures (como postgres): tres sesiones anónimas, una materia y su evaluación.
-- ---------------------------------------------------------------------------
insert into auth.users (id, is_anonymous) values
  ('c0000000-0000-0000-0000-0000000068a1', true),
  ('c0000000-0000-0000-0000-0000000068a2', true),
  ('c0000000-0000-0000-0000-0000000068a3', true),
  ('c0000000-0000-0000-0000-0000000068a4', true);
insert into public.materia (id, nombre, codigo) values ('10000000-0000-0000-0000-000000006801', 'Materia', 'PRB-68');
insert into public.evaluacion (id, id_materia, semana, nombre) values
  ('20000000-0000-0000-0000-000000006801', '10000000-0000-0000-0000-000000006801', 1, 'Parcial 1');
-- Un diagnóstico anónimo de la sesión 1 y otro de la sesión 2.
insert into public.diagnostico (id, id_sesion_anonima, id_evaluacion, id_materia, respuestas, puntaje, resultado_por_tema) values
  ('60000000-0000-0000-0000-000000006801', 'c0000000-0000-0000-0000-0000000068a1', '20000000-0000-0000-0000-000000006801',
   '10000000-0000-0000-0000-000000006801', '[]', 50, '{}'),
  ('60000000-0000-0000-0000-000000006802', 'c0000000-0000-0000-0000-0000000068a2', '20000000-0000-0000-0000-000000006801',
   '10000000-0000-0000-0000-000000006801', '[]', 70, '{}');

-- ---------------------------------------------------------------------------
-- Crear el Lead de una sesión (criterios 1 y 7)
-- ---------------------------------------------------------------------------
create temporary table creado as
select public.registrar_lead('c0000000-0000-0000-0000-0000000068a1', '  Ana Pérez ', ' Ana@Example.com ', '', true, now(), 'feria-2026') as id;
grant select on creado to authenticated;

select results_eq(
  $$select l.id_sesion_anonima::text, l.nombre, l.correo, l.numero_telefono, l.acepta_tratamiento_datos, l.acepta_contacto, l.estado::text, l.origen
    from public.lead l join creado c on c.id = l.id$$,
  $$values ('c0000000-0000-0000-0000-0000000068a1'::text, 'Ana Pérez'::text, 'ana@example.com'::text, null::text, true, true, 'nuevo'::text, 'feria-2026'::text)$$,
  'Crea el Lead nuevo con la sesión, el correo normalizado, la autorización y el origen');
select is(
  (select d.id_lead from public.diagnostico d where d.id = '60000000-0000-0000-0000-000000006801'),
  (select id from creado),
  'Los diagnósticos que la sesión hizo antes quedan ligados al Lead');
select is(
  (select d.id_lead from public.diagnostico d where d.id = '60000000-0000-0000-0000-000000006802'),
  null::uuid,
  'Los de otra sesión no');

-- P-23: un Lead por correo.
select throws_ok(
  $$select public.registrar_lead('c0000000-0000-0000-0000-0000000068a2', 'Otra persona', 'ana@example.com', '', false, now(), '')$$,
  '23505', null, 'Otro Lead con el mismo correo no se crea (P-23)');
select is(
  (select count(*)::int from public.lead where id_sesion_anonima = 'c0000000-0000-0000-0000-0000000068a2'),
  0, 'Y a esa sesión no le queda ningún Lead');
select is(
  (select id_lead from public.diagnostico where id = '60000000-0000-0000-0000-000000006802'),
  null::uuid, 'Ni se le ligan diagnósticos');
select throws_ok(
  $$select public.registrar_lead('c0000000-0000-0000-0000-0000000068a1', 'Ana otra vez', 'ana2@example.com', '', false, now(), '')$$,
  '23505', null, 'Una sesión no crea dos Leads (dos pestañas a la vez)');
select throws_ok(
  $$insert into public.lead (nombre, correo, acepta_tratamiento_datos, fecha_consentimiento)
    values ('Mayúsculas', 'ANA@Example.com', true, now())$$,
  '23514', null, 'El correo se guarda normalizado');
select throws_ok(
  $$select public.registrar_lead('c0000000-0000-0000-0000-0000000068a3', 'Sin permiso', 'nuevo@example.com', '', false, null, '')$$,
  '23502', null, 'Sin fecha de autorización no hay Lead (RN-13)');

-- ---------------------------------------------------------------------------
-- Confirmar el correo desde el enlace (P-23)
-- ---------------------------------------------------------------------------
insert into public.verificacion_lead (id, id_lead, token_hash, siguiente) values
  ('70000000-0000-0000-0000-000000006801', (select id from creado), encode(extensions.digest('vigente', 'sha256'), 'hex'), '/agendar/x');
insert into public.verificacion_lead (id, id_lead, token_hash, creada_en, vence_en) values
  ('70000000-0000-0000-0000-000000006802', (select id from creado), encode(extensions.digest('vencido', 'sha256'), 'hex'),
   now() - interval '2 days', now() - interval '1 day');
insert into public.verificacion_lead (id, id_lead, token_hash) values
  ('70000000-0000-0000-0000-000000006803', (select id from creado), encode(extensions.digest('otra-sesion', 'sha256'), 'hex'));

select throws_ok(
  $$insert into public.verificacion_lead (id_lead, token_hash, siguiente)
    select id, encode(extensions.digest('x1', 'sha256'), 'hex'), '//otro.sitio/x' from creado$$,
  '23514', null, 'siguiente no puede apuntar a otro sitio (//)');
select throws_ok(
  $$insert into public.verificacion_lead (id_lead, token_hash, siguiente)
    select id, encode(extensions.digest('x2', 'sha256'), 'hex'), 'https://otro.sitio/x' from creado$$,
  '23514', null, 'Ni a una URL completa');
select throws_ok(
  $$insert into public.verificacion_lead (id_lead, token_hash) select id, 'no-es-un-hash' from creado$$,
  '23514', null, 'Se guarda el SHA-256 del token, no el token');

select results_eq(
  $$select id_lead::text, siguiente from public.confirmar_correo_de_lead(
      encode(extensions.digest('vigente', 'sha256'), 'hex'), 'c0000000-0000-0000-0000-0000000068a2')$$,
  $$select id::text, '/agendar/x'::text from creado$$,
  'Con el enlace vigente, confirma y dice a dónde volver');
select is(
  (select id_lead from public.lead_sesion where id_sesion = 'c0000000-0000-0000-0000-0000000068a2'),
  (select id from creado), 'La sesión que abrió el enlace queda ligada al Lead');
select is(
  (select id_lead from public.diagnostico where id = '60000000-0000-0000-0000-000000006802'),
  (select id from creado), 'Con sus diagnósticos');
select isnt(
  (select usada_en from public.verificacion_lead where id = '70000000-0000-0000-0000-000000006801'),
  null::timestamptz, 'El enlace queda gastado');
select is(
  (select count(*)::int from public.confirmar_correo_de_lead(
      encode(extensions.digest('vigente', 'sha256'), 'hex'), 'c0000000-0000-0000-0000-0000000068a3')),
  0, 'Un enlace gastado no sirve dos veces');
select is(
  (select count(*)::int from public.confirmar_correo_de_lead(
      encode(extensions.digest('vencido', 'sha256'), 'hex'), 'c0000000-0000-0000-0000-0000000068a3')),
  0, 'Ni uno vencido');

-- Una sesión que ya es de otro Lead no se cambia de Lead con un enlace.
insert into public.lead (id, id_sesion_anonima, nombre, correo, acepta_tratamiento_datos, fecha_consentimiento) values
  ('40000000-0000-0000-0000-0000000068a4', 'c0000000-0000-0000-0000-0000000068a4', 'Beto', 'beto@example.com', true, now());
select is(
  (select count(*)::int from public.confirmar_correo_de_lead(
      encode(extensions.digest('otra-sesion', 'sha256'), 'hex'), 'c0000000-0000-0000-0000-0000000068a4')),
  0, 'Una sesión que ya tiene su Lead no se liga a otro');
select is(
  (select usada_en from public.verificacion_lead where id = '70000000-0000-0000-0000-000000006803'),
  null::timestamptz, 'Y el enlace no se gasta');

-- ---------------------------------------------------------------------------
-- Quién ve el Lead (privado.es_mi_lead con lead_sesion)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-0000000068a2","role":"authenticated","is_anonymous":true}';
select is((select count(*)::int from public.lead where correo = 'ana@example.com'), 1,
  'La sesión que confirmó el correo ve el Lead');
select is((select count(*)::int from public.diagnostico where id_lead = (select id from creado)), 2,
  'Y los diagnósticos del Lead, también los que hizo en el otro navegador');

set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-0000000068a3","role":"authenticated","is_anonymous":true}';
select is((select count(*)::int from public.lead where correo = 'ana@example.com'), 0,
  'Una sesión que no confirmó no lo ve');
reset role;

select * from finish();
rollback;
