-- Pruebas pgTAP de las franjas semanales del monitor (HU-015).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.

begin;
create extension if not exists pgtap with schema extensions;

select plan(52);

-- ---------------------------------------------------------------------------
-- Estructura y permisos
-- ---------------------------------------------------------------------------
select has_column('public', 'franja', 'lugar', 'La franja guarda el lugar (P-31)');
select has_column('public', 'franja', 'enlace', 'La franja guarda el enlace de la videollamada (P-31)');
select has_column('public', 'franja', 'abierta_desde', 'La franja sabe desde cuándo está abierta');
select has_column('public', 'franja', 'cerrada_desde', 'La franja se cierra desde una fecha (P-30)');
select ok(has_column_privilege('authenticated', 'public.franja', 'precio', 'update'), 'El monitor puede cambiar el precio');
select ok(not has_column_privilege('authenticated', 'public.franja', 'abierta_desde', 'update'), 'abierta_desde no se edita');
select ok(not has_column_privilege('authenticated', 'public.franja', 'id_monitor', 'update'), 'La franja no cambia de dueño');
select ok(not has_table_privilege('authenticated', 'public.franja', 'delete'), 'Las franjas no se borran: se cierran');
select ok(not has_table_privilege('anon', 'public.franja', 'insert'), 'Sin sesión no se abren franjas');
select ok(
  has_column_privilege('anon', 'public.franja', 'precio', 'select')
  and has_column_privilege('anon', 'public.franja', 'dia', 'select')
  and has_column_privilege('authenticated', 'public.franja', 'cerrada_desde', 'select'),
  'El resto de la franja se lee en público, para agendar');
select ok(
  not has_column_privilege('anon', 'public.franja', 'enlace', 'select')
  and not has_column_privilege('anon', 'public.franja', 'lugar', 'select'),
  'P-31: sin sesión no se leen el lugar ni el enlace de la videollamada');
select ok(
  not has_column_privilege('authenticated', 'public.franja', 'enlace', 'select')
  and not has_column_privilege('authenticated', 'public.franja', 'lugar', 'select'),
  'P-31: con sesión tampoco se leen de la tabla (el monitor usa acceso_a_mis_franjas)');

-- ---------------------------------------------------------------------------
-- Fixtures (como postgres): A certificado, B sin certificado.
-- ---------------------------------------------------------------------------
insert into auth.users (id, is_anonymous) values
  ('a0000000-0000-0000-0000-000000000001', false),
  ('b0000000-0000-0000-0000-00000000000a', false),
  ('b0000000-0000-0000-0000-00000000000b', false);
insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-000000000001', 'Admin', 'admin@calibra.test', 9000001);
insert into public.monitor (id, nombre) values
  ('b0000000-0000-0000-0000-00000000000a', 'Monitor A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Monitor B');
insert into public.materia (id, nombre, codigo) values ('10000000-0000-0000-0000-000000000001', 'Materia', 'PRB-15');
insert into public.certificado (id_monitor, id_materia, id_admin) values
  ('b0000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001');
insert into public.lead (id, nombre, correo, acepta_tratamiento_datos, fecha_consentimiento) values
  ('40000000-0000-0000-0000-000000000001', 'Lead', 'lead@calibra.test', true, now());

-- Fechas del lunes siguiente (7 a 13 días) y del anterior (7 a 13 días), en la zona del negocio.
create temporary table fechas as
with hoy as (select (now() at time zone 'America/Bogota')::date as d)
select d as hoy,
       d + ((1 - extract(isodow from d)::int + 7) % 7 + 7) as lunes_futuro,
       d - ((extract(isodow from d)::int - 1 + 7) % 7 + 7) as lunes_pasado
from hoy;
grant select on fechas to authenticated;

-- ---------------------------------------------------------------------------
-- Abrir franjas (monitor A)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select lives_ok(
  $$insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min, lugar)
    values ('30000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 1, '10:00', true, 25000, 60, 'Edificio ML, salón 101')$$,
  'Abre una franja presencial con lugar');
select is((select abierta_desde from public.franja where id = '30000000-0000-0000-0000-000000000001'),
  (select hoy from fechas), 'Queda abierta desde hoy, en la zona del negocio');

select throws_ok(
  $$insert into public.franja (id_monitor, dia, hora, presencial, precio, duracion_min)
    values ('b0000000-0000-0000-0000-00000000000a', 2, '10:00', true, 25000, 60)$$,
  'P0001', 'Una franja presencial necesita el lugar de la sesión.', 'Presencial sin lugar: no');
select throws_ok(
  $$insert into public.franja (id_monitor, dia, hora, presencial, precio, duracion_min)
    values ('b0000000-0000-0000-0000-00000000000a', 2, '10:00', false, 25000, 60)$$,
  'P0001', 'Una franja virtual necesita el enlace de la videollamada.', 'Virtual sin enlace: no');
select throws_ok(
  $$insert into public.franja (id_monitor, dia, hora, presencial, precio, duracion_min, enlace)
    values ('b0000000-0000-0000-0000-00000000000a', 2, '10:00', false, 25000, 60, 'http://meet.example.com/abc')$$,
  '23514', null, 'El enlace va por https');
select lives_ok(
  $$insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min, enlace)
    values ('30000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 2, '18:00', false, 30000, 90, 'https://meet.example.com/abc')$$,
  'Abre una franja virtual con enlace');
select throws_ok(
  $$insert into public.franja (id_monitor, dia, hora, presencial, precio, duracion_min, lugar)
    values ('b0000000-0000-0000-0000-00000000000a', 1, '10:30', true, 25000, 60, 'Otro salón')$$,
  'P0001', 'Se cruza con otra de tus franjas abiertas el mismo día.', 'Sin solapes con otra franja abierta el mismo día');
select lives_ok(
  $$insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min, lugar)
    values ('30000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 1, '11:00', true, 25000, 60, 'Edificio ML, salón 101')$$,
  'Una franja que empieza justo cuando termina otra sí se puede');
select throws_ok(
  $$insert into public.franja (id_monitor, dia, hora, presencial, precio, duracion_min, lugar)
    values ('b0000000-0000-0000-0000-00000000000a', 3, '10:00:30', true, 25000, 60, 'Salón')$$,
  'P0001', 'Escribe la hora en horas y minutos, por ejemplo 14:00.', 'La hora va sin segundos');
select lives_ok(
  $$insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min, lugar)
    values ('30000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 3, '23:00', true, 25000, 60, 'Salón')$$,
  'Una franja que termina justo a la medianoche sí se puede');
select results_eq(
  $$select id_franja::text, lugar, enlace from public.acceso_a_mis_franjas() order by id_franja$$,
  $$values ('30000000-0000-0000-0000-000000000001', 'Edificio ML, salón 101'::text, null::text),
           ('30000000-0000-0000-0000-000000000002', null, 'https://meet.example.com/abc'),
           ('30000000-0000-0000-0000-000000000003', 'Edificio ML, salón 101', null),
           ('30000000-0000-0000-0000-000000000004', 'Salón', null)$$,
  'El monitor lee el lugar y el enlace de sus franjas con acceso_a_mis_franjas()');
select throws_ok($$select enlace from public.franja$$, '42501', null, 'Ni el monitor lee el enlace directo de la tabla');
select throws_ok(
  $$insert into public.franja (id_monitor, dia, hora, presencial, precio, duracion_min, lugar)
    values ('b0000000-0000-0000-0000-00000000000a', 3, '23:30', true, 25000, 60, 'Salón')$$,
  'P0001', 'La franja debe terminar el mismo día: revisa la hora y la duración.', 'La franja termina el mismo día');
select throws_ok(
  $$insert into public.franja (id_monitor, dia, hora, presencial, precio, duracion_min, lugar)
    values ('b0000000-0000-0000-0000-00000000000a', 4, '10:00', true, 0, 60, 'Salón')$$,
  '23514', null, 'El precio es mayor que cero');
select throws_ok(
  $$insert into public.franja (id_monitor, dia, hora, presencial, precio, duracion_min, lugar)
    values ('b0000000-0000-0000-0000-00000000000b', 4, '10:00', true, 25000, 60, 'Salón')$$,
  '42501', null, 'No abre franjas a nombre de otro monitor');

-- Monitor B, sin certificado.
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-00000000000b","role":"authenticated"}';
select throws_ok(
  $$insert into public.franja (id_monitor, dia, hora, presencial, precio, duracion_min, lugar)
    values ('b0000000-0000-0000-0000-00000000000b', 4, '10:00', true, 25000, 60, 'Salón')$$,
  'P0001', null, 'Sin certificado no abre franjas (F2)');
select is((select count(*)::int from public.acceso_a_mis_franjas()), 0,
  'acceso_a_mis_franjas() no muestra el lugar ni el enlace de las franjas de otro monitor');
update public.franja set precio = 1 where id = '30000000-0000-0000-0000-000000000001';
reset role;
select is((select precio from public.franja where id = '30000000-0000-0000-0000-000000000001'), 25000,
  'Otro monitor no cambia una franja ajena');

-- ---------------------------------------------------------------------------
-- Cambios con monitorías (P-30, RN-32)
-- ---------------------------------------------------------------------------
-- Franja 1: una monitoría pasada y una futura. Franja 3: ninguna.
insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado, fecha_finalizacion)
select '50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
       '40000000-0000-0000-0000-000000000001', lunes_pasado, 25000, 'realizada', now()
from fechas;
insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total)
select '50000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
       '40000000-0000-0000-0000-000000000001', lunes_futuro, 25000
from fechas;

set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select lives_ok($$update public.franja set precio = 32000 where id = '30000000-0000-0000-0000-000000000001'$$,
  'El precio se cambia aunque haya monitorías');
select is((select array_agg(valor_total order by id) from public.monitoria where id_franja = '30000000-0000-0000-0000-000000000001'),
  array[25000, 25000], 'RN-32: las monitorías agendadas conservan su valor');
select throws_ok($$update public.franja set hora = '12:00' where id = '30000000-0000-0000-0000-000000000001'$$,
  'P0001', null, 'P-30: no cambia la hora de una franja con monitorías');
select throws_ok($$update public.franja set duracion_min = 90 where id = '30000000-0000-0000-0000-000000000001'$$,
  'P0001', null, 'P-30: no cambia la duración de una franja con monitorías');
select throws_ok($$update public.franja set presencial = false, lugar = null, enlace = 'https://meet.example.com/x' where id = '30000000-0000-0000-0000-000000000001'$$,
  'P0001', 'No puedes cambiar entre presencial y virtual mientras la franja tenga monitorías agendadas.',
  'No cambia de modalidad con monitorías futuras');
select lives_ok($$update public.franja set lugar = 'Edificio W, salón 202' where id = '30000000-0000-0000-0000-000000000001'$$,
  'El lugar sí se corrige');
select lives_ok($$update public.franja set hora = '14:00', duracion_min = 45 where id = '30000000-0000-0000-0000-000000000003'$$,
  'Sin monitorías, la hora y la duración sí se cambian');
select throws_ok($$update public.franja set id_monitor = 'b0000000-0000-0000-0000-00000000000b' where id = '30000000-0000-0000-0000-000000000003'$$,
  '42501', null, 'La franja no cambia de dueño');

-- Cierre (P-30)
select throws_ok($$update public.franja set cerrada_desde = (select hoy from fechas) where id = '30000000-0000-0000-0000-000000000001'$$,
  'P0001', null, 'No se cierra desde hoy si tiene una monitoría futura');
select throws_ok($$update public.franja set cerrada_desde = (select hoy - 1 from fechas) where id = '30000000-0000-0000-0000-000000000003'$$,
  'P0001', 'La franja se cierra desde hoy o desde una fecha futura.', 'No se cierra hacia atrás');
select lives_ok($$update public.franja set cerrada_desde = (select lunes_futuro + 1 from fechas) where id = '30000000-0000-0000-0000-000000000001'$$,
  'Se cierra desde el día siguiente a la última monitoría');
select throws_ok($$delete from public.franja where id = '30000000-0000-0000-0000-000000000003'$$,
  '42501', null, 'El monitor no borra franjas');

-- Franja 3 con una sola monitoría, ya pasada.
reset role;
insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado, fecha_finalizacion)
select '50000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001',
       '40000000-0000-0000-0000-000000000001', lunes_pasado, 25000, 'realizada', now()
from fechas;
set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select lives_ok($$update public.franja set presencial = false, lugar = null, enlace = 'https://meet.example.com/y' where id = '30000000-0000-0000-0000-000000000003'$$,
  'Con solo monitorías pasadas, la modalidad sí se cambia');
select lives_ok($$update public.franja set cerrada_desde = (select hoy from fechas) where id = '30000000-0000-0000-0000-000000000003'$$,
  'Sin monitorías de hoy en adelante, se cierra desde hoy');
select lives_ok(
  $$insert into public.franja (id_monitor, dia, hora, presencial, precio, duracion_min, lugar)
    values ('b0000000-0000-0000-0000-00000000000a', 1, '14:00', true, 25000, 60, 'Salón')$$,
  'Cerrada la franja, su horario se puede volver a abrir en otra');
select throws_ok($$update public.franja set precio = 40000 where id = '30000000-0000-0000-0000-000000000003'$$,
  'P0001', 'Esta franja ya está cerrada. Para volver a ofrecer ese horario, abre otra.', 'Una franja ya cerrada no se edita');
select throws_ok($$update public.franja set cerrada_desde = null where id = '30000000-0000-0000-0000-000000000003'$$,
  'P0001', 'Esta franja ya está cerrada. Para volver a ofrecer ese horario, abre otra.', 'Ni se reabre');
select lives_ok($$update public.franja set cerrada_desde = (select lunes_futuro + 2 from fechas) where id = '30000000-0000-0000-0000-000000000001'$$,
  'Un cierre programado para más adelante sí se mueve');

reset role;
select throws_ok(
  $$insert into public.monitoria (id_franja, id_materia, id_lead, fecha, valor_total)
    select '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001',
           lunes_futuro + 7, 25000 from fechas$$,
  'P0001', 'La franja está cerrada desde esa fecha.', 'Una franja cerrada no recibe monitorías desde su cierre');
select lives_ok(
  $$insert into public.franja (id_monitor, dia, hora, presencial, precio, duracion_min)
    values ('b0000000-0000-0000-0000-00000000000b', 1, '10:00', true, 25000, 60)$$,
  'Las escrituras de confianza (postgres, pruebas) no pasan por las reglas del monitor');

set local role anon;
select throws_ok($$select enlace from public.franja$$, '42501', null, 'P-31: sin sesión, el enlace no se lee');
select lives_ok($$select id, id_monitor, dia, hora, presencial, precio, duracion_min, cerrada_desde from public.franja$$,
  'Sin sesión se lee lo necesario para agendar');
reset role;

select * from finish();
rollback;
