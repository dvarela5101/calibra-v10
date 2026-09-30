-- Pruebas pgTAP de la cuenta de monitor por invitación (HU-013).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.

begin;
create extension if not exists pgtap with schema extensions;

select plan(31);

-- ---------------------------------------------------------------------------
-- Estructura y permisos
-- ---------------------------------------------------------------------------
select has_table('public', 'invitacion_monitor', 'Existe la tabla de invitaciones');
select ok((select relrowsecurity from pg_class where oid = 'public.invitacion_monitor'::regclass),
  'RLS activa en invitacion_monitor');
select ok(not has_table_privilege('anon', 'public.invitacion_monitor', 'select'), 'anon no lee invitaciones');
select ok(not has_table_privilege('authenticated', 'public.invitacion_monitor', 'insert'),
  'Nadie con sesión crea invitaciones: solo el servidor');
select ok(has_function_privilege('service_role', 'public.registrar_monitor(text, uuid, text, text, text, text)', 'execute'),
  'service_role puede registrar monitores');
select ok(not has_function_privilege('authenticated', 'public.registrar_monitor(text, uuid, text, text, text, text)', 'execute'),
  'Un usuario con sesión no puede registrarse como monitor por su cuenta');
select ok(not has_function_privilege('anon', 'public.registrar_monitor(text, uuid, text, text, text, text)', 'execute'),
  'Sin sesión no hay autorregistro de monitores');
select ok(not has_column_privilege('authenticated', 'public.monitor_privado', 'correo', 'update'),
  'El monitor no cambia su correo desde aquí');
select ok(has_column_privilege('authenticated', 'public.monitor_privado', 'llave', 'update'),
  'El monitor puede cambiar su llave');

-- ---------------------------------------------------------------------------
-- Fixtures (como postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, is_anonymous) values
  ('a0000000-0000-0000-0000-000000000001', false),
  ('b0000000-0000-0000-0000-000000000001', false),
  ('b0000000-0000-0000-0000-000000000002', false),
  ('b0000000-0000-0000-0000-000000000003', false),
  ('b0000000-0000-0000-0000-000000000009', false),
  ('c0000000-0000-0000-0000-00000000000a', true);

insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-000000000001', 'Admin Prueba', 'admin@calibra.test', 9000001);

-- Hash = 64 caracteres hex. Vigente, vencida y otra vigente para probar el correo.
insert into public.invitacion_monitor (id, correo, token_hash, id_admin, creada_en, vence_en) values
  ('e0000000-0000-0000-0000-000000000001', 'nuevo@calibra.test', repeat('a', 64),
   'a0000000-0000-0000-0000-000000000001', now(), now() + interval '7 days'),
  ('e0000000-0000-0000-0000-000000000002', 'tarde@calibra.test', repeat('b', 64),
   'a0000000-0000-0000-0000-000000000001', now() - interval '8 days', now() - interval '1 day'),
  ('e0000000-0000-0000-0000-000000000003', 'otro@calibra.test', repeat('c', 64),
   'a0000000-0000-0000-0000-000000000001', now(), now() + interval '7 days');

-- ---------------------------------------------------------------------------
-- La invitación por defecto vence a los 7 días y se guarda normalizada
-- ---------------------------------------------------------------------------
insert into public.invitacion_monitor (id, correo, token_hash, id_admin) values
  ('e0000000-0000-0000-0000-000000000004', 'defecto@calibra.test', repeat('d', 64), 'a0000000-0000-0000-0000-000000000001');
select is((select vence_en - creada_en from public.invitacion_monitor where id = 'e0000000-0000-0000-0000-000000000004'),
  interval '7 days', 'La invitación vence a los 7 días');
select throws_ok(
  $$insert into public.invitacion_monitor (correo, token_hash, id_admin)
    values ('Mayus@Calibra.test', repeat('e', 64), 'a0000000-0000-0000-0000-000000000001')$$,
  '23514', null, 'El correo de la invitación llega normalizado');
select throws_ok(
  $$insert into public.invitacion_monitor (correo, token_hash, id_admin)
    values ('x@calibra.test', 'token-en-claro', 'a0000000-0000-0000-0000-000000000001')$$,
  '23514', null, 'Solo se guarda el hash del token, nunca el token');

-- ---------------------------------------------------------------------------
-- registrar_monitor: un solo uso, vencimiento y correo
-- ---------------------------------------------------------------------------
set local role service_role;

select is(public.registrar_monitor(repeat('a', 64), 'b0000000-0000-0000-0000-000000000001',
  ' Nuevo@Calibra.test ', ' Monitor Nuevo ', '+57 300 000 0001', 'llave-vieja'), true,
  'Con una invitación vigente se registra el monitor');
select is((select nombre from public.monitor where id = 'b0000000-0000-0000-0000-000000000001'), 'Monitor Nuevo',
  'Se crea el Monitor');
select is((select correo from public.monitor_privado where id_monitor = 'b0000000-0000-0000-0000-000000000001'),
  'nuevo@calibra.test', 'Se crea su parte privada con el correo normalizado');
select is((select count(*)::int from public.perfil_monitor where id_monitor = 'b0000000-0000-0000-0000-000000000001'), 1,
  'Se crea su PerfilMonitor vacío');
select ok((select usada_en is not null and id_monitor = 'b0000000-0000-0000-0000-000000000001'
  from public.invitacion_monitor where id = 'e0000000-0000-0000-0000-000000000001'),
  'La invitación queda gastada y ligada al monitor');

select is(public.registrar_monitor(repeat('a', 64), 'b0000000-0000-0000-0000-000000000002',
  'nuevo@calibra.test', 'Otra persona', '3000000002', 'llave-2'), false,
  'Una invitación ya usada no sirve otra vez');
select is(public.registrar_monitor(repeat('b', 64), 'b0000000-0000-0000-0000-000000000002',
  'tarde@calibra.test', 'Tarde', '3000000002', 'llave-2'), false,
  'Una invitación vencida no sirve');
select is(public.registrar_monitor(repeat('c', 64), 'b0000000-0000-0000-0000-000000000002',
  'nuevo@calibra.test', 'Colado', '3000000002', 'llave-2'), false,
  'La invitación solo sirve para el correo invitado');
select is(public.registrar_monitor(repeat('f', 64), 'b0000000-0000-0000-0000-000000000002',
  'otro@calibra.test', 'Inventado', '3000000002', 'llave-2'), false,
  'Un token que no existe no sirve');
select is((select count(*)::int from public.monitor where id = 'b0000000-0000-0000-0000-000000000002'), 0,
  'Una invitación que no sirve no crea nada');

reset role;

-- ---------------------------------------------------------------------------
-- RN-80: cambiar la llave no toca los desembolsos ya creados
-- ---------------------------------------------------------------------------
insert into public.monitor (id, nombre) values ('b0000000-0000-0000-0000-000000000003', 'Monitor Otro');
insert into public.monitor_privado (id_monitor, numero_telefono, correo, llave) values
  ('b0000000-0000-0000-0000-000000000003', '3000000003', 'm3@calibra.test', 'llave-del-otro');
insert into public.materia (id, nombre, codigo) values ('10000000-0000-0000-0000-000000000001', 'Materia', 'PRB-13');
insert into public.certificado (id_monitor, id_materia, id_admin) values
  ('b0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001');
insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min) values
  ('30000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 1, '10:00', true, 25000, 60);
insert into public.lead (id, nombre, correo, acepta_tratamiento_datos, fecha_consentimiento) values
  ('40000000-0000-0000-0000-000000000001', 'Lead', 'lead@calibra.test', true, now());
insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total) values
  ('50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '2026-10-05', 25000);
insert into public.desembolso (id, id_monitoria, monto_bruto, comision, monto_neto, llave_destino) values
  ('70000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 25000, 2500, 22500, 'llave-vieja');

set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-000000000001","role":"authenticated"}';

update public.monitor_privado set llave = 'llave-nueva' where id_monitor = 'b0000000-0000-0000-0000-000000000001';
select is((select llave from public.monitor_privado where id_monitor = 'b0000000-0000-0000-0000-000000000001'),
  'llave-nueva', 'El monitor cambia su llave');
update public.monitor_privado set llave = 'robada' where id_monitor = 'b0000000-0000-0000-0000-000000000003';
select throws_ok(
  $$update public.monitor_privado set correo = 'x@calibra.test' where id_monitor = 'b0000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'El monitor no cambia su correo');
select is((select count(*)::int from public.invitacion_monitor), 0, 'El monitor no lee invitaciones');

reset role;
select is((select llave_destino from public.desembolso where id = '70000000-0000-0000-0000-000000000001'),
  'llave-vieja', 'RN-80: el desembolso ya creado conserva la llave anterior');
select is((select llave from public.monitor_privado where id_monitor = 'b0000000-0000-0000-0000-000000000003'),
  'llave-del-otro', 'Un monitor no cambia la llave de otro');

-- ---------------------------------------------------------------------------
-- Lectura: el admin ve las invitaciones; un visitante no ve datos privados del monitor
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.invitacion_monitor), 4, 'El admin lee las invitaciones');

set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-00000000000a","role":"authenticated","is_anonymous":true}';
select is((select count(*)::int from public.monitor_privado), 0,
  'Una sesión anónima no lee teléfono, correo ni llave de los monitores');

reset role;
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';
select throws_ok($$select * from public.monitor_privado$$, '42501', null,
  'Un visitante sin sesión no lee teléfono, correo ni llave de los monitores');
select is((select count(*)::int from public.monitor where id = 'b0000000-0000-0000-0000-000000000001'), 1,
  'El nombre del monitor sí es público');

reset role;
select * from finish();
rollback;
