-- Pruebas pgTAP de la repetición de franjas al abrirlas (HU-140, D-94).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.

begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------
select ok(has_column_privilege('authenticated', 'public.franja', 'abierta_desde', 'insert'), 'El monitor puede fijar el inicio al abrir');
select ok(has_column_privilege('authenticated', 'public.franja', 'cerrada_desde', 'insert'), 'El monitor puede fijar el cierre al abrir');

-- ---------------------------------------------------------------------------
-- Fixtures (como postgres): un admin, un monitor certificado y una materia.
-- ---------------------------------------------------------------------------
insert into auth.users (id, is_anonymous) values
  ('a0000000-0000-0000-0000-000000000140', false),
  ('b0000000-0000-0000-0000-000000000140', false);
insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-000000000140', 'Admin', 'admin140@calibra.test', 9000140);
insert into public.monitor (id, nombre) values ('b0000000-0000-0000-0000-000000000140', 'Monitor 140');
insert into public.materia (id, nombre, codigo) values ('10000000-0000-0000-0000-000000000140', 'Materia', 'PRB-140');
insert into public.certificado (id_monitor, id_materia, id_admin) values
  ('b0000000-0000-0000-0000-000000000140', '10000000-0000-0000-0000-000000000140', 'a0000000-0000-0000-0000-000000000140');

-- Hoy en la zona del negocio y el próximo lunes y jueves (de 7 a 13 días: siempre después de hoy y en su día de la semana).
create temporary table fechas as
with hoy as (select (now() at time zone 'America/Bogota')::date as d)
select d as hoy,
       d + ((1 - extract(isodow from d)::int + 7) % 7 + 7) as lunes,
       d + ((4 - extract(isodow from d)::int + 7) % 7 + 7) as jueves
from hoy;
grant select on fechas to authenticated;

set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-000000000140","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- Inicio y cierre al abrir
-- ---------------------------------------------------------------------------
-- «Solo ese lunes»: abierta el lunes y cerrada el martes.
select lives_ok(
  $$insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min, abierta_desde, cerrada_desde)
    values ('30000000-0000-0000-0000-000000000141', 'b0000000-0000-0000-0000-000000000140', 1, '10:00', false, 25000, 60,
            (select lunes from fechas), (select lunes + 1 from fechas))$$,
  'Abre una franja para un lunes futuro, solo ese día');
select results_eq(
  $$select abierta_desde, cerrada_desde from public.franja where id = '30000000-0000-0000-0000-000000000141'$$,
  $$select lunes, lunes + 1 from fechas$$,
  'La franja queda con las fechas que eligió el monitor');

select throws_ok(
  $$insert into public.franja (id_monitor, dia, hora, presencial, precio, duracion_min, abierta_desde)
    values ('b0000000-0000-0000-0000-000000000140', 2, '10:00', false, 25000, 60, (select hoy - 7 from fechas))$$,
  'P0001', 'Una franja no puede empezar en una fecha que ya pasó.', 'No empieza en una fecha pasada');
-- El próximo lunes no es martes.
select throws_ok(
  $$insert into public.franja (id_monitor, dia, hora, presencial, precio, duracion_min, abierta_desde)
    values ('b0000000-0000-0000-0000-000000000140', 2, '10:00', false, 25000, 60, (select lunes from fechas))$$,
  'P0001', 'La fecha de inicio no coincide con el día de la franja.', 'El inicio cae en el día de la semana de la franja');
select throws_ok(
  $$insert into public.franja (id_monitor, dia, hora, presencial, precio, duracion_min, abierta_desde, cerrada_desde)
    values ('b0000000-0000-0000-0000-000000000140', 3, '10:00', false, 25000, 60, (select lunes + 2 from fechas), (select lunes + 2 from fechas))$$,
  'P0001', 'La franja tiene que durar al menos un día.', 'El cierre es posterior al inicio');
select throws_ok(
  $$insert into public.franja (id_monitor, dia, hora, presencial, precio, duracion_min, cerrada_desde)
    values ('b0000000-0000-0000-0000-000000000140', 3, '10:00', false, 25000, 60, (select hoy from fechas))$$,
  'P0001', 'La franja tiene que durar al menos un día.', 'Sin inicio queda en hoy, y el cierre no puede ser hoy');

-- Como siempre: sin fechas queda abierta desde hoy y sin cierre.
select lives_ok(
  $$insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min)
    values ('30000000-0000-0000-0000-000000000142', 'b0000000-0000-0000-0000-000000000140', 4, '14:00', false, 25000, 60)$$,
  'Abre una franja sin fechas, como el formulario de siempre');
select results_eq(
  $$select abierta_desde, cerrada_desde from public.franja where id = '30000000-0000-0000-0000-000000000142'$$,
  $$select hoy, null::date from fechas$$,
  'Sin fechas queda abierta desde hoy y sin cierre');

-- ---------------------------------------------------------------------------
-- Solape con fechas
-- ---------------------------------------------------------------------------
-- Lunes 10:00 desde el lunes siguiente al primero, sin fecha final: no se cruza con la franja del primer lunes.
select lives_ok(
  $$insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min, abierta_desde)
    values ('30000000-0000-0000-0000-000000000143', 'b0000000-0000-0000-0000-000000000140', 1, '10:00', false, 25000, 60,
            (select lunes + 7 from fechas))$$,
  'Misma hora y día con rangos de fechas que no se cruzan: se abre');
-- Se cruzan en hora y comparten el primer lunes.
select throws_ok(
  $$insert into public.franja (id_monitor, dia, hora, presencial, precio, duracion_min, abierta_desde, cerrada_desde)
    values ('b0000000-0000-0000-0000-000000000140', 1, '10:30', false, 25000, 60, (select lunes from fechas), (select lunes + 1 from fechas))$$,
  'P0001', 'Se cruza con otra de tus franjas abiertas el mismo día.', 'Misma hora y rangos que se cruzan: no se abre');
-- Se cruza con la que no tiene fecha final (desde el lunes siguiente).
select throws_ok(
  $$insert into public.franja (id_monitor, dia, hora, presencial, precio, duracion_min, abierta_desde, cerrada_desde)
    values ('b0000000-0000-0000-0000-000000000140', 1, '10:30', false, 25000, 60, (select lunes + 14 from fechas), (select lunes + 15 from fechas))$$,
  'P0001', 'Se cruza con otra de tus franjas abiertas el mismo día.', 'Una franja sin fecha final cruza con las fechas posteriores a su inicio');
-- La del jueves abierta desde hoy no tiene fin: cruza con un jueves futuro a la misma hora.
select throws_ok(
  $$insert into public.franja (id_monitor, dia, hora, presencial, precio, duracion_min, abierta_desde, cerrada_desde)
    values ('b0000000-0000-0000-0000-000000000140', 4, '14:30', false, 25000, 60, (select jueves from fechas), (select jueves + 1 from fechas))$$,
  'P0001', 'Se cruza con otra de tus franjas abiertas el mismo día.', 'Una franja abierta desde hoy sin cierre cruza con un jueves futuro');

-- Inicio hoy con cierre lejano: queda con ambas fechas.
select lives_ok(
  $$insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min, cerrada_desde)
    values ('30000000-0000-0000-0000-000000000144', 'b0000000-0000-0000-0000-000000000140', 6, '09:00', false, 25000, 60,
            (select hoy + 30 from fechas))$$,
  'Sin inicio y con cierre: abre hoy y cierra en esa fecha');
select results_eq(
  $$select abierta_desde, cerrada_desde from public.franja where id = '30000000-0000-0000-0000-000000000144'$$,
  $$select hoy, hoy + 30 from fechas$$,
  'Queda abierta desde hoy y cerrada en la fecha elegida');

reset role;
select * from finish();
rollback;
