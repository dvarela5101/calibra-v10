-- Pruebas pgTAP de la gestión de leads (HU-053, RN-09, D-61).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.
--
-- Elenco (ids terminados en 53NN): admin activo a..5301, admin desactivado a..5302, monitor b..5301, sesión anónima
-- c..5301 (dueña del Lead 01), materias X (..5301) e Y (..5302).
-- Leads: 01 acepta contacto, con dos diagnósticos de X y una monitoría cancelada de Y; 02 no acepta contacto; 03
-- descartado y acepta contacto; 04 sin diagnósticos ni monitorías.

begin;
create extension if not exists pgtap with schema extensions;

select plan(35);

-- Cuántas filas tocó una sentencia, con los permisos de quien llama (security invoker): sirve para ver que la política
-- no deja tocar ninguna. Un WITH que modifica no puede ir dentro de otra consulta.
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
select has_table('public', 'lead_gestion', 'Existe public.lead_gestion: quién marcó cada Lead y cuándo');
select ok((select relrowsecurity from pg_class where oid = 'public.lead_gestion'::regclass), 'lead_gestion tiene RLS');
select has_view('public', 'lead_para_gestion', 'Existe la vista de la lista del admin');
select has_view('public', 'lead_para_contactar', 'Existe la vista de la descarga');
select has_function('public', 'origenes_de_leads', '{}'::name[], 'Existe la lectura de los orígenes del filtro');

select ok(
  has_column_privilege('authenticated', 'public.lead', 'estado', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.lead', 'nombre', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.lead', 'correo', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.lead', 'numero_telefono', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.lead', 'origen', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.lead', 'acepta_contacto', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.lead', 'fecha_consentimiento', 'UPDATE'),
  'Con una sesión solo se puede escribir el estado del Lead');
select ok(
  not has_table_privilege('authenticated', 'public.lead_gestion', 'insert, update, delete')
  and not has_table_privilege('anon', 'public.lead_gestion', 'select, insert, update, delete'),
  'Nadie con sesión escribe lead_gestion, y anon ni la lee: solo el trigger');
select ok(
  not has_table_privilege('anon', 'public.lead_para_gestion', 'select')
  and not has_table_privilege('anon', 'public.lead_para_contactar', 'select')
  and not has_function_privilege('anon', 'public.origenes_de_leads()', 'execute'),
  'anon no tiene permiso sobre las vistas ni los orígenes');

-- ---------------------------------------------------------------------------
-- Elenco
-- ---------------------------------------------------------------------------
insert into auth.users (id, is_anonymous, email, banned_until) values
  ('a0000000-0000-0000-0000-000000005301', false, 'admin5301@calibra.test', null),
  ('a0000000-0000-0000-0000-000000005302', false, 'admin5302@calibra.test', now() + interval '100 years'),
  ('b0000000-0000-0000-0000-000000005301', false, 'monitor5301@calibra.test', null),
  ('c0000000-0000-0000-0000-000000005301', true, null, null);
insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-000000005301', 'Admin Activa 53', 'admin5301@calibra.test', 9005301),
  ('a0000000-0000-0000-0000-000000005302', 'Admin Desactivada 53', 'admin5302@calibra.test', 9005302);
insert into public.monitor (id, nombre) values ('b0000000-0000-0000-0000-000000005301', 'Monitor 53');
insert into public.materia (id, nombre, codigo) values
  ('10000000-0000-0000-0000-000000005301', 'Materia X 53', 'PGTAP-53-X'),
  ('10000000-0000-0000-0000-000000005302', 'Materia Y 53', 'PGTAP-53-Y');
insert into public.evaluacion (id, id_materia, semana, nombre) values
  ('20000000-0000-0000-0000-000000005301', '10000000-0000-0000-0000-000000005301', 1, 'Parcial X 53');
insert into public.certificado (id_monitor, id_materia, id_admin) values
  ('b0000000-0000-0000-0000-000000005301', '10000000-0000-0000-0000-000000005302', 'a0000000-0000-0000-0000-000000005301');
insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min, lugar, enlace, abierta_desde, cerrada_desde) values
  ('30000000-0000-0000-0000-000000005301', 'b0000000-0000-0000-0000-000000005301', 1, '10:00', true, 30000, 60,
   'Salón 53', null, '2026-01-01', null);

insert into public.lead (id, id_sesion_anonima, nombre, correo, acepta_tratamiento_datos, fecha_consentimiento, acepta_contacto, estado, origen) values
  ('40000000-0000-0000-0000-000000005301', 'c0000000-0000-0000-0000-000000005301', 'Lead 53 Uno', 'lead5301@calibra.test', true, now(), true, 'nuevo', 'feria-53'),
  ('40000000-0000-0000-0000-000000005302', null, 'Lead 53 Dos', 'lead5302@calibra.test', true, now(), false, 'nuevo', null),
  ('40000000-0000-0000-0000-000000005303', null, 'Lead 53 Tres', 'lead5303@calibra.test', true, now(), true, 'descartado', null),
  ('40000000-0000-0000-0000-000000005304', null, 'Lead 53 Cuatro', 'lead5304@calibra.test', true, now(), true, 'nuevo', null);

insert into public.diagnostico (id_sesion_anonima, id_lead, id_evaluacion, respuestas, puntaje, resultado_por_habilidad, semilla, aciertos) values
  ('c0000000-0000-0000-0000-000000005301', '40000000-0000-0000-0000-000000005301', '20000000-0000-0000-0000-000000005301', '[{"clave":"P1"}]', 50, '{"habilidades":[],"errores":[],"prerrequisitos":[]}', 1, 0),
  ('c0000000-0000-0000-0000-000000005301', '40000000-0000-0000-0000-000000005301', '20000000-0000-0000-0000-000000005301', '[{"clave":"P1"}]', 70, '{"habilidades":[],"errores":[],"prerrequisitos":[]}', 1, 0);
insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado, motivo_cancelacion, fecha_finalizacion) values
  ('50000000-0000-0000-0000-000000005301', '30000000-0000-0000-0000-000000005301', '10000000-0000-0000-0000-000000005302',
   '40000000-0000-0000-0000-000000005301', '2026-10-12', 30000, 'cancelada', 'pago_rechazado', null);

-- ---------------------------------------------------------------------------
-- Lo que lee el admin (D-61 a y c)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"role":"authenticated","sub":"a0000000-0000-0000-0000-000000005301"}';

select is(
  (select ids_materia from public.lead_para_gestion where id = '40000000-0000-0000-0000-000000005301'),
  array['10000000-0000-0000-0000-000000005301', '10000000-0000-0000-0000-000000005302']::uuid[],
  'La materia de un Lead sale de sus diagnósticos y de sus monitorías, también canceladas, sin repetidos (D-61 a)');
select is(
  (select ids_materia from public.lead_para_gestion where id = '40000000-0000-0000-0000-000000005304'),
  '{}'::uuid[],
  'Un Lead sin diagnósticos ni monitorías no tiene materias');
select is(
  (select count(*)::int from public.lead_para_gestion where id::text like '40000000-0000-0000-0000-0000000053%'),
  4,
  'El admin ve los cuatro Leads en la lista');
select set_eq(
  $$select id from public.lead_para_contactar where id::text like '40000000-0000-0000-0000-0000000053%'$$,
  $$values ('40000000-0000-0000-0000-000000005301'::uuid), ('40000000-0000-0000-0000-000000005304')$$,
  'La descarga trae solo a quienes aceptaron contacto y no están descartados (D-61 c)');
select ok(
  'feria-53' = any(array(select public.origenes_de_leads())),
  'Los orígenes del filtro traen las campañas de los Leads');
select is(
  (select estado_cambiado_en from public.lead_para_gestion where id = '40000000-0000-0000-0000-000000005301'),
  null,
  'Un Lead que nadie ha gestionado no dice quién lo marcó');

-- ---------------------------------------------------------------------------
-- El admin cambia el estado (D-61 d)
-- ---------------------------------------------------------------------------
select is(
  pg_temp.filas($$update public.lead set estado = 'contactado' where id = '40000000-0000-0000-0000-000000005301'$$),
  1,
  'El admin activo marca un Lead como contactado');
select is(
  (select id_admin from public.lead_gestion where id_lead = '40000000-0000-0000-0000-000000005301'),
  'a0000000-0000-0000-0000-000000005301'::uuid,
  'lead_gestion anota qué admin lo marcó, sin que nadie lo mande');
select is(
  (select id_admin_estado from public.lead_para_gestion where id = '40000000-0000-0000-0000-000000005301'),
  'a0000000-0000-0000-0000-000000005301'::uuid,
  'La lista muestra quién lo marcó');

-- Marcar el mismo estado no cambia quién ni cuándo.
reset role;
update public.lead_gestion set estado_cambiado_en = '2020-01-01 00:00:00+00' where id_lead = '40000000-0000-0000-0000-000000005301';
set local role authenticated;
set local request.jwt.claims to '{"role":"authenticated","sub":"a0000000-0000-0000-0000-000000005301"}';
update public.lead set estado = 'contactado' where id = '40000000-0000-0000-0000-000000005301';
select is(
  (select estado_cambiado_en from public.lead_gestion where id_lead = '40000000-0000-0000-0000-000000005301'),
  '2020-01-01 00:00:00+00'::timestamptz,
  'Marcar el estado que ya tiene no cambia quién lo marcó ni cuándo');

select is(
  pg_temp.filas($$update public.lead set estado = 'nuevo' where id = '40000000-0000-0000-0000-000000005301'$$),
  1,
  'Entre nuevo y contactado el estado es libre');
select is(
  pg_temp.filas($$update public.lead set estado = 'nuevo' where id = '40000000-0000-0000-0000-000000005303'$$),
  0,
  'Un descartado no se saca de descartado: el update no toca ninguna fila (D-61 d)');
select throws_ok(
  $$update public.lead set nombre = 'Otro nombre' where id = '40000000-0000-0000-0000-000000005301'$$,
  '42501', null,
  'El admin no puede cambiar otras columnas del Lead por la Data API');
select throws_ok(
  $$update public.lead set acepta_contacto = true where id = '40000000-0000-0000-0000-000000005302'$$,
  '42501', null,
  'Ni encender acepta_contacto: solo lo marca la persona');
select throws_ok(
  $$insert into public.lead_gestion (id_lead, id_admin, estado_cambiado_en) values ('40000000-0000-0000-0000-000000005304', 'a0000000-0000-0000-0000-000000005301', now())$$,
  '42501', null,
  'El admin no escribe lead_gestion directamente');

-- ---------------------------------------------------------------------------
-- Quien no es admin activo no ve ni cambia nada
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"role":"authenticated","sub":"a0000000-0000-0000-0000-000000005302"}';
select is(
  pg_temp.filas($$update public.lead set estado = 'contactado' where id = '40000000-0000-0000-0000-000000005304'$$),
  0,
  'Un admin desactivado no cambia el estado');
select is((select count(*)::int from public.lead_para_gestion), 0, 'Un admin desactivado no ve la lista');

set local request.jwt.claims to '{"role":"authenticated","sub":"b0000000-0000-0000-0000-000000005301"}';
select is(
  pg_temp.filas($$update public.lead set estado = 'contactado' where id = '40000000-0000-0000-0000-000000005304'$$),
  0,
  'Un monitor no cambia el estado');
select is((select count(*)::int from public.lead_para_contactar), 0, 'Un monitor no ve la descarga');

set local request.jwt.claims to '{"role":"authenticated","sub":"c0000000-0000-0000-0000-000000005301"}';
select is(
  (select count(*)::int from public.lead where id = '40000000-0000-0000-0000-000000005301'),
  1,
  'El dueño de un Lead sigue leyendo su propia fila');
select is(
  pg_temp.filas($$update public.lead set estado = 'contactado' where id = '40000000-0000-0000-0000-000000005301'$$),
  0,
  'El dueño de un Lead no cambia su estado');
select is((select count(*)::int from public.lead_gestion), 0, 'El dueño de un Lead no ve quién lo marcó ni cuándo');
select is((select count(*)::int from public.lead_para_gestion), 0, 'El dueño de un Lead no ve la lista');
select is((select count(*)::int from public.origenes_de_leads()), 0, 'Ni los orígenes');

reset role;
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';
select throws_ok('select count(*) from public.lead_para_gestion', '42501', null, 'anon no lee la lista');
select throws_ok('select count(*) from public.lead_gestion', '42501', null, 'anon no lee lead_gestion');
reset role;

select is(
  (select estado::text from public.lead where id = '40000000-0000-0000-0000-000000005304'),
  'nuevo',
  'Al final, el Lead que intentaron cambiar sin permiso sigue en nuevo');

select * from finish();
rollback;
