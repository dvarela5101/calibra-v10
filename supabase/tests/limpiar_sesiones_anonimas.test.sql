-- Pruebas pgTAP de la limpieza de sesiones anónimas antiguas (HU-056, P-13, P-40, D-63 b).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos. El trabajo real de pg_cron no ve estas filas.
--
-- La limpieza se prueba con un `ahora` fijo, A = martes 10 de marzo de 2020 a las 12:00 en Bogotá (17:00 UTC). Está
-- en el pasado a propósito, como en tope_de_correos.test.sql: toda sesión que ya esté en la base local (de una prueba
-- de integración o de la semilla) tuvo actividad después de A, así que lo que borra la limpieza es exacto.
-- Dos conexiones que se disputan el candado de una sesión no caben en una transacción: lo cubre
-- integracion/limpiar-sesiones.test.ts.
--
-- Elenco (ids terminados en 56NN), todas creadas mucho antes de A salvo que se diga otra cosa:
--   01 sin dueño, 100 días sin actividad, con un diagnóstico viejo: se borra, y su diagnóstico con ella.
--   02 sin dueño, exactamente 90 días: no se borra (P-40).
--   03 sin dueño, 90 días y un segundo: se borra.
--   04 sin dueño, su sesión de Auth se renovó hace 10 días: no se borra.
--   05 sin dueño, hizo un diagnóstico hace 5 días: no se borra.
--   06 sin dueño, inició sesión hace 20 días: no se borra.
--   07 creó un Lead (lead.id_sesion_anonima), con un diagnóstico de antes y uno de después del Lead: no se borra.
--   08 confirmó el correo de ese Lead con el enlace de P-23 (lead_sesion): no se borra.
--   09 es la cuenta de Estudiante de ese Lead: no se borra.
--   10 es un monitor y 11 un admin: no se borran.
--   12 no es anónima ni tiene dueño: no se borra.
--   13 sin dueño y vencida, pero una tabla la referencia sin cascada: se salta y las demás sí se borran.
--   14 sin dueño y vencida; consigue un Lead después de armar la lista: borrar_sesion_vencida no la borra.
--   15 sin dueño y con actividad reciente: borrar_sesion_vencida, llamada directo, no la borra.

begin;
create extension if not exists pgtap with schema extensions;

select plan(43);

-- ---------------------------------------------------------------------------
-- Estructura y permisos
-- ---------------------------------------------------------------------------
select has_function('public', 'parametros_retencion', '{}'::name[], 'Existe public.parametros_retencion, el lugar del plazo');
select is((select p.sesion_anonima_dias from public.parametros_retencion() p), 90,
  'P-13: las sesiones sin contacto se borran a los 90 días sin actividad');
select has_function('privado', 'sesiones_anonimas_vencidas', array['timestamp with time zone'],
  'Existe privado.sesiones_anonimas_vencidas, las que vencen a una fecha');
select has_function('privado', 'borrar_sesion_vencida', array['uuid', 'timestamp with time zone'],
  'Existe privado.borrar_sesion_vencida, que borra una con el candado tomado');
select has_function('privado', 'limpiar_sesiones_anonimas', array['timestamp with time zone'],
  'Existe privado.limpiar_sesiones_anonimas, la limpieza diaria');

select ok(
  (select bool_and(not has_function_privilege(r, f, 'execute'))
   from unnest(array['anon', 'authenticated', 'service_role']) r,
        unnest(array[
          'privado.sesiones_anonimas_vencidas(timestamptz)',
          'privado.borrar_sesion_vencida(uuid, timestamptz)',
          'privado.limpiar_sesiones_anonimas(timestamptz)',
          'privado.ultima_actividad_de_sesion(uuid)',
          'privado.sesion_tiene_dueno(uuid)']) f),
  'Ni el visitante, ni una sesión, ni el servidor corren la limpieza ni consultan qué sesiones vencerían');
select ok(
  not has_function_privilege('anon', 'public.parametros_retencion()', 'execute')
  and has_function_privilege('authenticated', 'public.parametros_retencion()', 'execute')
  and has_function_privilege('service_role', 'public.parametros_retencion()', 'execute'),
  'El plazo lo leen una sesión y el servidor, como parametros_contacto');

set local role authenticated;
set local request.jwt.claims to '{"role":"authenticated","sub":"c0000000-0000-0000-0000-000000005601"}';
select throws_ok('select privado.limpiar_sesiones_anonimas(now())', '42501', null,
  'Una sesión no puede correr la limpieza');
reset role;
set local role service_role;
select throws_ok($$select * from privado.sesiones_anonimas_vencidas(now())$$, '42501', null,
  'El servidor no puede consultar qué sesiones vencerían');
reset role;

select is(
  (select schedule from cron.job where jobname = 'calibra-limpiar-sesiones-anonimas'),
  '23 8 * * *',
  'El trabajo de pg_cron corre a las 08:23 UTC (03:23 en Bogotá)');
select is(
  (select count(*)::int from cron.job where jobname = 'calibra-limpiar-sesiones-anonimas'),
  1,
  'Hay un solo trabajo con ese nombre: reaplicar la migración no lo duplica');
select is(
  (select command from cron.job where jobname = 'calibra-limpiar-sesiones-anonimas'),
  'select privado.limpiar_sesiones_anonimas(now())',
  'El trabajo llama a la limpieza con la hora de la base');

-- Contrato: toda llave hacia auth.users en public y privado borra en cascada o pone nulo. Una HU que agregue otra que
-- impida borrar un usuario hace fallar esta prueba.
select is(
  (select coalesce(string_agg(c.conrelid::regclass::text || ' (' || c.conname || ')', ', '), '')
   from pg_constraint c
   where c.contype = 'f'
     and c.confrelid = 'auth.users'::regclass
     and c.connamespace in ('public'::regnamespace, 'privado'::regnamespace)
     and c.confdeltype not in ('c', 'n')),
  '',
  'Todas las llaves hacia auth.users en public y privado borran en cascada o ponen nulo');

-- ---------------------------------------------------------------------------
-- Elenco
-- ---------------------------------------------------------------------------
-- A = 2020-03-10 17:00:00+00.
insert into auth.users (id, is_anonymous, created_at, last_sign_in_at)
select ('c0000000-0000-0000-0000-0000000056' || n)::uuid, true, '2019-01-01 00:00:00+00', null
from unnest(array['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '13', '14', '15']) n;
insert into auth.users (id, is_anonymous, created_at, email)
values ('c0000000-0000-0000-0000-000000005612', false, '2019-01-01 00:00:00+00', 'cuenta5612@calibra.test');

-- 01: su última actividad fue un diagnóstico hace 100 días.
-- 02: alta hace exactamente 90 días. 03: alta hace 90 días y un segundo.
update auth.users set created_at = timestamptz '2020-03-10 17:00:00+00' - interval '90 days'
where id = 'c0000000-0000-0000-0000-000000005602';
update auth.users set created_at = timestamptz '2020-03-10 17:00:00+00' - interval '90 days 1 second'
where id = 'c0000000-0000-0000-0000-000000005603';
-- 06: inició sesión hace 20 días.
update auth.users set last_sign_in_at = timestamptz '2020-03-10 17:00:00+00' - interval '20 days'
where id = 'c0000000-0000-0000-0000-000000005606';
-- 04: su sesión de Auth se renovó hace 10 días (refreshed_at es un timestamp sin zona, en UTC).
insert into auth.sessions (id, user_id, created_at, updated_at, refreshed_at) values (
  'e0000000-0000-0000-0000-000000005604', 'c0000000-0000-0000-0000-000000005604',
  '2019-01-01 00:00:00+00', '2019-01-01 00:00:00+00',
  (timestamptz '2020-03-10 17:00:00+00' - interval '10 days') at time zone 'utc');
-- 15: activa hace un día.
update auth.users set created_at = timestamptz '2020-03-10 17:00:00+00' - interval '1 day'
where id = 'c0000000-0000-0000-0000-000000005615';

insert into public.materia (id, nombre, codigo) values
  ('10000000-0000-0000-0000-000000005601', 'Materia 56', 'PGTAP-56');
insert into public.evaluacion (id, id_materia, semana, nombre) values
  ('20000000-0000-0000-0000-000000005601', '10000000-0000-0000-0000-000000005601', 1, 'Parcial 56');

-- 07, 08, 09: el Lead y sus sesiones.
insert into public.lead (id, id_sesion_anonima, nombre, correo, acepta_tratamiento_datos, fecha_consentimiento) values
  ('40000000-0000-0000-0000-000000005607', 'c0000000-0000-0000-0000-000000005607', 'Lead 56',
   'lead56@calibra.test', true, '2019-01-02 00:00:00+00');
insert into public.lead_sesion (id_sesion, id_lead) values
  ('c0000000-0000-0000-0000-000000005608', '40000000-0000-0000-0000-000000005607');
insert into public.estudiante (id, id_lead) values
  ('c0000000-0000-0000-0000-000000005609', '40000000-0000-0000-0000-000000005607');
-- 10 y 11: un monitor y un admin.
insert into public.monitor (id, nombre) values ('c0000000-0000-0000-0000-000000005610', 'Monitor 56');
insert into public.admin (id, nombre, correo, orden_revision) values
  ('c0000000-0000-0000-0000-000000005611', 'Admin 56', 'admin56@calibra.test', 9005611);

insert into public.diagnostico (id, id_sesion_anonima, id_lead, id_evaluacion, respuestas, puntaje, resultado_por_habilidad, semilla, aciertos, fecha_realizacion) values
  -- 01: viejo, hace 100 días.
  ('50000000-0000-0000-0000-000000005601', 'c0000000-0000-0000-0000-000000005601', null,
   '20000000-0000-0000-0000-000000005601', '[{"clave":"P1"}]', 50, '{"habilidades":[],"errores":[],"prerrequisitos":[]}', 1, 0, timestamptz '2020-03-10 17:00:00+00' - interval '100 days'),
  -- 05: hace 5 días.
  ('50000000-0000-0000-0000-000000005605', 'c0000000-0000-0000-0000-000000005605', null,
   '20000000-0000-0000-0000-000000005601', '[{"clave":"P1"}]', 50, '{"habilidades":[],"errores":[],"prerrequisitos":[]}', 1, 0, timestamptz '2020-03-10 17:00:00+00' - interval '5 days'),
  -- 07: uno de antes del Lead (ya ligado) y uno de después.
  ('50000000-0000-0000-0000-000000005671', 'c0000000-0000-0000-0000-000000005607', '40000000-0000-0000-0000-000000005607',
   '20000000-0000-0000-0000-000000005601', '[{"clave":"P1"}]', 50, '{"habilidades":[],"errores":[],"prerrequisitos":[]}', 1, 0, '2019-01-01 12:00:00+00'),
  ('50000000-0000-0000-0000-000000005672', 'c0000000-0000-0000-0000-000000005607', '40000000-0000-0000-0000-000000005607',
   '20000000-0000-0000-0000-000000005601', '[{"clave":"P1"}]', 50, '{"habilidades":[],"errores":[],"prerrequisitos":[]}', 1, 0, '2019-01-03 12:00:00+00');

-- 13: una tabla la referencia sin cascada. No puede ser temporal (Postgres no deja que una temporal apunte a auth.users):
-- es una tabla normal que el rollback del final se lleva. Se crea después de la prueba de contrato de arriba.
create table public.bloqueo_56 (id_sesion uuid references auth.users (id));
insert into public.bloqueo_56 values ('c0000000-0000-0000-0000-000000005613');

-- ---------------------------------------------------------------------------
-- Qué cuenta como actividad (D-63 b) y el borde de los 90 días (P-40)
-- ---------------------------------------------------------------------------
select is(
  privado.ultima_actividad_de_sesion('c0000000-0000-0000-0000-000000005601'),
  timestamptz '2020-03-10 17:00:00+00' - interval '100 days',
  'Un diagnóstico terminado cuenta como actividad');
select is(
  privado.ultima_actividad_de_sesion('c0000000-0000-0000-0000-000000005604'),
  timestamptz '2020-03-10 17:00:00+00' - interval '10 days',
  'La renovación de la sesión de Auth (cualquier visita) cuenta como actividad, leída en UTC');
select is(
  privado.ultima_actividad_de_sesion('c0000000-0000-0000-0000-000000005606'),
  timestamptz '2020-03-10 17:00:00+00' - interval '20 days',
  'Un inicio de sesión cuenta como actividad');
select is(
  privado.ultima_actividad_de_sesion('c0000000-0000-0000-0000-000000005602'),
  timestamptz '2020-03-10 17:00:00+00' - interval '90 days',
  'Sin nada más, la última actividad es el alta');

select set_eq(
  $$select id from privado.sesiones_anonimas_vencidas('2020-03-10 17:00:00+00')
    where id::text like 'c0000000-0000-0000-0000-0000000056%'$$,
  $$values ('c0000000-0000-0000-0000-000000005601'::uuid), ('c0000000-0000-0000-0000-000000005603'),
           ('c0000000-0000-0000-0000-000000005613'), ('c0000000-0000-0000-0000-000000005614')$$,
  'Vencen solo las anónimas sin dueño con más de 90 días sin actividad: no la de 90 justos (P-40), ni las activas, ni las de un Lead, monitor o admin, ni la que no es anónima');
select is(
  (select count(*)::int from privado.sesiones_anonimas_vencidas('2020-03-10 17:00:00+00')),
  4,
  'Ninguna otra sesión de la base vence a A');

-- ---------------------------------------------------------------------------
-- borrar_sesion_vencida vuelve a comprobar
-- ---------------------------------------------------------------------------
select is(
  privado.borrar_sesion_vencida('c0000000-0000-0000-0000-000000005615', '2020-03-10 17:00:00+00'),
  false,
  'Una sesión con actividad reciente no se borra aunque la llamen directo');
select is(
  privado.borrar_sesion_vencida('c0000000-0000-0000-0000-000000005607', '2020-03-10 17:00:00+00'),
  false,
  'La sesión de un Lead no se borra aunque la llamen directo');

-- 14 estaba en la lista de vencidas; antes de que la limpieza llegue a ella, deja su contacto.
insert into public.lead (id, id_sesion_anonima, nombre, correo, acepta_tratamiento_datos, fecha_consentimiento) values
  ('40000000-0000-0000-0000-000000005614', 'c0000000-0000-0000-0000-000000005614', 'Lead 56 bis',
   'lead56bis@calibra.test', true, '2020-03-10 16:59:00+00');
select is(
  privado.borrar_sesion_vencida('c0000000-0000-0000-0000-000000005614', '2020-03-10 17:00:00+00'),
  false,
  'Una sesión que consiguió un Lead después de armar la lista no se borra: se comprueba otra vez con el candado tomado');
select is(
  (select count(*)::int from auth.users where id = 'c0000000-0000-0000-0000-000000005614'),
  1,
  'Y sigue en Auth');

-- ---------------------------------------------------------------------------
-- La limpieza
-- ---------------------------------------------------------------------------
select is(
  privado.limpiar_sesiones_anonimas('2020-03-10 17:00:00+00'),
  2,
  'La limpieza borra las dos vencidas que puede (01 y 03) y salta la que una tabla referencia sin cascada (13)');

select is((select count(*)::int from auth.users where id = 'c0000000-0000-0000-0000-000000005601'), 0,
  'La sesión de 100 días sin actividad se borró de Auth');
select is((select count(*)::int from public.diagnostico where id = '50000000-0000-0000-0000-000000005601'), 0,
  'Y su diagnóstico se borró con ella');
select is((select count(*)::int from auth.users where id = 'c0000000-0000-0000-0000-000000005603'), 0,
  'La de 90 días y un segundo se borró (P-40)');
select is((select count(*)::int from auth.users where id = 'c0000000-0000-0000-0000-000000005602'), 1,
  'La de exactamente 90 días sigue (P-40)');
select is((select count(*)::int from auth.users where id = 'c0000000-0000-0000-0000-000000005613'), 1,
  'La que referencia otra tabla sin cascada sigue: se saltó sin detener la limpieza');
select is(
  (select count(*)::int from auth.users
   where id in ('c0000000-0000-0000-0000-000000005604', 'c0000000-0000-0000-0000-000000005605',
                'c0000000-0000-0000-0000-000000005606', 'c0000000-0000-0000-0000-000000005615')),
  4,
  'Las que tuvieron actividad en los últimos 90 días siguen, aunque nunca hayan hecho un diagnóstico');
select is(
  (select count(*)::int from auth.users
   where id in ('c0000000-0000-0000-0000-000000005607', 'c0000000-0000-0000-0000-000000005608',
                'c0000000-0000-0000-0000-000000005609', 'c0000000-0000-0000-0000-000000005610',
                'c0000000-0000-0000-0000-000000005611', 'c0000000-0000-0000-0000-000000005612')),
  6,
  'Las sesiones de un Lead (creador, P-23 y Estudiante), de un monitor, de un admin y la que no es anónima siguen');
select is(
  (select count(*)::int from public.diagnostico
   where id in ('50000000-0000-0000-0000-000000005671', '50000000-0000-0000-0000-000000005672')),
  2,
  'Los diagnósticos del Lead, de antes y de después de ser Lead, siguen (P-13)');
select is(
  (select count(*)::int from public.diagnostico where id = '50000000-0000-0000-0000-000000005605'),
  1,
  'El diagnóstico de una sesión activa sigue');
select is((select count(*)::int from public.lead where id in (
  '40000000-0000-0000-0000-000000005607', '40000000-0000-0000-0000-000000005614')), 2,
  'Ningún Lead cambia');
select is((select count(*)::int from public.lead_sesion where id_lead = '40000000-0000-0000-0000-000000005607'), 1,
  'La sesión que confirmó el correo sigue ligada al Lead');
select is((select count(*)::int from public.estudiante where id = 'c0000000-0000-0000-0000-000000005609'), 1,
  'La cuenta de Estudiante sigue');
select is((select count(*)::int from public.monitor where id = 'c0000000-0000-0000-0000-000000005610'), 1,
  'El monitor sigue');
select is((select count(*)::int from public.admin where id = 'c0000000-0000-0000-0000-000000005611'), 1,
  'El admin sigue');

select is(
  privado.limpiar_sesiones_anonimas('2020-03-10 17:00:00+00'),
  0,
  'Correrla otra vez seguida no borra nada');

-- Sin la tabla que bloqueaba, la sesión 13 se borra en la corrida siguiente.
delete from public.bloqueo_56;
select is(
  privado.limpiar_sesiones_anonimas('2020-03-10 17:00:00+00'),
  1,
  'La sesión que se saltó se borra en una corrida siguiente');
select is(
  privado.limpiar_sesiones_anonimas('2020-03-10 17:00:00+00'),
  0,
  'Sin sesiones vencidas, la limpieza termina sin error y devuelve 0');

-- Un día después, la de 90 días justos ya venció.
select is(
  privado.limpiar_sesiones_anonimas('2020-03-11 17:00:00+00'),
  1,
  'Al día siguiente la que tenía 90 días justos ya pasó el plazo y se borra');

select is(
  (select count(*)::int from auth.users where id::text like 'c0000000-0000-0000-0000-0000000056%'),
  11,
  'Quedan las 11 que no vencieron');

select * from finish();
rollback;
