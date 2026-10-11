-- Pruebas pgTAP de registrar que un Lead pidió no recibir más mensajes (HU-089, D-61 f).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.
--
-- Elenco (ids terminados en 89NN): admin activo a..8901, admin desactivado a..8902, monitor b..8901, estudiante
-- e..8901 (con el Lead 03), sesión anónima c..8901 (dueña del Lead 01).
-- Leads: 01 acepta contacto (contactado); 02 no acepta contacto; 03 acepta contacto, del estudiante.

begin;
create extension if not exists pgtap with schema extensions;

select plan(30);

-- Cuántas filas tocó una sentencia, con los permisos de quien llama. Un WITH que modifica no puede ir dentro de otra
-- consulta.
create function pg_temp.filas(p_sql text) returns integer language plpgsql as $f$
declare v integer;
begin
  execute p_sql;
  get diagnostics v = row_count;
  return v;
end;
$f$;

-- ---------------------------------------------------------------------------
-- Estructura y permisos
-- ---------------------------------------------------------------------------
select has_table('public', 'lead_sin_contacto', 'Existe public.lead_sin_contacto: quién registró el pedido y cuándo');
select ok((select relrowsecurity from pg_class where oid = 'public.lead_sin_contacto'::regclass), 'lead_sin_contacto tiene RLS');
select has_function('public', 'registrar_sin_contacto', array['uuid'], 'Existe la puerta en la Data API');
select ok(
  (select not p.prosecdef from pg_proc p where p.oid = 'public.registrar_sin_contacto(uuid)'::regprocedure)
  and (select p.prosecdef from pg_proc p where p.oid = 'privado.registrar_sin_contacto(uuid)'::regprocedure),
  'La puerta pública es security invoker; la que escribe, security definer en privado');
select ok(
  has_function_privilege('authenticated', 'public.registrar_sin_contacto(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.registrar_sin_contacto(uuid)', 'execute')
  and not has_function_privilege('anon', 'privado.registrar_sin_contacto(uuid)', 'execute'),
  'Solo authenticated ejecuta el registro; anon no');
select ok(
  not has_table_privilege('authenticated', 'public.lead_sin_contacto', 'insert, update, delete')
  and not has_table_privilege('anon', 'public.lead_sin_contacto', 'select, insert, update, delete')
  and not has_column_privilege('authenticated', 'public.lead', 'acepta_contacto', 'UPDATE'),
  'Nadie con sesión escribe lead_sin_contacto ni acepta_contacto, y anon ni lee el registro');
select hasnt_column('public', 'lead_para_gestion', 'sin_contacto_en', 'La vista de HU-053 no cambia: se puede reaplicar su migración');

-- ---------------------------------------------------------------------------
-- Elenco
-- ---------------------------------------------------------------------------
insert into auth.users (id, is_anonymous, email, banned_until) values
  ('a0000000-0000-0000-0000-000000008901', false, 'admin8901@calibra.test', null),
  ('a0000000-0000-0000-0000-000000008902', false, 'admin8902@calibra.test', now() + interval '100 years'),
  ('b0000000-0000-0000-0000-000000008901', false, 'monitor8901@calibra.test', null),
  ('e0000000-0000-0000-0000-000000008901', false, 'estudiante8901@calibra.test', null),
  ('c0000000-0000-0000-0000-000000008901', true, null, null);
insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-000000008901', 'Admin Activa 89', 'admin8901@calibra.test', 9008901),
  ('a0000000-0000-0000-0000-000000008902', 'Admin Desactivada 89', 'admin8902@calibra.test', 9008902);
insert into public.monitor (id, nombre) values ('b0000000-0000-0000-0000-000000008901', 'Monitor 89');

insert into public.lead (id, id_sesion_anonima, nombre, correo, acepta_tratamiento_datos, fecha_consentimiento, acepta_contacto, estado, origen) values
  ('40000000-0000-0000-0000-000000008901', 'c0000000-0000-0000-0000-000000008901', 'Lead 89 Uno', 'lead8901@calibra.test', true, now(), true, 'contactado', 'campana-89'),
  ('40000000-0000-0000-0000-000000008902', null, 'Lead 89 Dos', 'lead8902@calibra.test', true, now(), false, 'nuevo', null),
  ('40000000-0000-0000-0000-000000008903', null, 'Lead 89 Tres', 'lead8903@calibra.test', true, now(), true, 'nuevo', null);
insert into public.estudiante (id, id_lead) values ('e0000000-0000-0000-0000-000000008901', '40000000-0000-0000-0000-000000008903');

-- ---------------------------------------------------------------------------
-- Nadie que no sea admin activo registra
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"role":"authenticated","sub":"b0000000-0000-0000-0000-000000008901"}';
select is(public.registrar_sin_contacto('40000000-0000-0000-0000-000000008901'), 'no_autorizado', 'Un monitor recibe no_autorizado');
set local request.jwt.claims to '{"role":"authenticated","sub":"e0000000-0000-0000-0000-000000008901"}';
select is(public.registrar_sin_contacto('40000000-0000-0000-0000-000000008903'), 'no_autorizado', 'Un estudiante, aunque sea su Lead, recibe no_autorizado');
set local request.jwt.claims to '{"role":"authenticated","sub":"c0000000-0000-0000-0000-000000008901","is_anonymous":true}';
select is(public.registrar_sin_contacto('40000000-0000-0000-0000-000000008901'), 'no_autorizado', 'La sesión anónima dueña del Lead recibe no_autorizado');
set local request.jwt.claims to '{"role":"authenticated","sub":"a0000000-0000-0000-0000-000000008902"}';
select is(public.registrar_sin_contacto('40000000-0000-0000-0000-000000008901'), 'no_autorizado', 'Un admin desactivado recibe no_autorizado');
-- Ni un admin activo escribe directo: acepta_contacto no es escribible con sesión y la tabla no tiene permiso de escritura.
set local request.jwt.claims to '{"role":"authenticated","sub":"a0000000-0000-0000-0000-000000008901"}';
select throws_ok(
  $$update public.lead set acepta_contacto = false where id = '40000000-0000-0000-0000-000000008901'$$,
  '42501', null, 'Un admin activo no apaga acepta_contacto directo');
select throws_ok(
  $$insert into public.lead_sin_contacto (id_lead, id_admin, registrado_en) values ('40000000-0000-0000-0000-000000008901', null, now())$$,
  '42501', null, 'Un admin activo no escribe lead_sin_contacto directo');
reset role;

select is((select acepta_contacto from public.lead where id = '40000000-0000-0000-0000-000000008901'), true,
  'Tras los intentos sin permiso, el Lead sigue aceptando contacto');
select is((select count(*)::int from public.lead_sin_contacto), 0, 'Tras los intentos sin permiso, no hay ningún registro');

-- ---------------------------------------------------------------------------
-- Un admin activo registra (D-61 f)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"role":"authenticated","sub":"a0000000-0000-0000-0000-000000008901"}';
select is((select count(*)::int from public.lead_para_contactar where id = '40000000-0000-0000-0000-000000008901'), 1,
  'Antes de registrar, el Lead sale en la descarga');
select is(public.registrar_sin_contacto('40000000-0000-0000-0000-000000008901'), 'registrado', 'Un admin activo registra el pedido');
select is((select count(*)::int from public.lead_para_contactar where id = '40000000-0000-0000-0000-000000008901'), 0,
  'Después, ya no sale en la descarga');
select is(
  (select row(g.acepta_contacto, g.estado, s.id_admin, s.registrado_en is not null)::text
   from public.lead_para_gestion g join public.lead_sin_contacto s on s.id_lead = g.id
   where g.id = '40000000-0000-0000-0000-000000008901'),
  row(false, 'contactado', 'a0000000-0000-0000-0000-000000008901'::uuid, true)::text,
  'El admin lo ve sin contacto, con el mismo estado, con su id y la hora');
select is(public.registrar_sin_contacto('40000000-0000-0000-0000-000000008902'), 'ya_no_acepta', 'Un Lead que ya no aceptaba: ya_no_acepta');
select is(public.registrar_sin_contacto('00000000-0000-0000-0000-000000008999'), 'no_existe', 'Un id que no existe: no_existe');
reset role;

select is(
  (select row(nombre, correo, origen, acepta_tratamiento_datos)::text from public.lead where id = '40000000-0000-0000-0000-000000008901'),
  row('Lead 89 Uno', 'lead8901@calibra.test', 'campana-89', true)::text,
  'Registrar no cambia nombre, correo, origen ni el consentimiento de datos');
select is((select count(*)::int from public.lead_gestion where id_lead = '40000000-0000-0000-0000-000000008901'), 0,
  'Registrar no toca el estado: lead_gestion no anota nada');

-- Otra vez, desde una página vieja: no cambia quién ni cuándo.
update public.lead_sin_contacto set registrado_en = '2020-01-01T00:00:00Z' where id_lead = '40000000-0000-0000-0000-000000008901';
set local role authenticated;
set local request.jwt.claims to '{"role":"authenticated","sub":"a0000000-0000-0000-0000-000000008901"}';
select is(public.registrar_sin_contacto('40000000-0000-0000-0000-000000008901'), 'ya_no_acepta', 'Registrarlo de nuevo: ya_no_acepta');
reset role;
select is((select registrado_en from public.lead_sin_contacto where id_lead = '40000000-0000-0000-0000-000000008901'),
  '2020-01-01T00:00:00Z'::timestamptz, 'y el registro anterior no cambia');

-- ---------------------------------------------------------------------------
-- Quién lo ve
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"role":"authenticated","sub":"c0000000-0000-0000-0000-000000008901","is_anonymous":true}';
select is((select count(*)::int from public.lead_sin_contacto), 0, 'El dueño del Lead no ve quién ni cuándo lo registró');
select is((select acepta_contacto from public.lead where id = '40000000-0000-0000-0000-000000008901'), false,
  'pero sigue leyendo su propia fila de lead, con acepta_contacto');
set local request.jwt.claims to '{"role":"authenticated","sub":"b0000000-0000-0000-0000-000000008901"}';
select is((select count(*)::int from public.lead_sin_contacto), 0, 'Un monitor no lee ningún registro');
reset role;

-- ---------------------------------------------------------------------------
-- Si la persona vuelve a aceptar, el registro se borra (HU-068)
-- ---------------------------------------------------------------------------
-- Apagar sin registro (la persona edita su contacto sin la casilla) no crea registro.
update public.lead set acepta_contacto = false where id = '40000000-0000-0000-0000-000000008903';
select is((select count(*)::int from public.lead_sin_contacto where id_lead = '40000000-0000-0000-0000-000000008903'), 0,
  'Apagar acepta_contacto sin registrar no crea registro: no lo pidió');
update public.lead set acepta_contacto = true where id = '40000000-0000-0000-0000-000000008901';
select is((select count(*)::int from public.lead_sin_contacto where id_lead = '40000000-0000-0000-0000-000000008901'), 0,
  'Volver a aceptar contacto borra el registro');

select * from finish();
rollback;
