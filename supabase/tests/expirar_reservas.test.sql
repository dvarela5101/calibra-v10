-- Pruebas pgTAP de expirar las reservas sin comprobante a los 10 minutos (HU-027).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos. El proceso real de pg_cron no ve estas filas.
--
-- Dos grupos de monitorías:
--   * El proceso (criterios 1 a 3), fecha_libre y registrar_pago se prueban con privado.expirar_reservas y un `ahora`
--     fijo, el martes 10 de marzo de 2020 a las 12:00 en Bogotá. Está en el pasado a propósito, como en
--     finalizar_monitoria.test.sql: ninguna reserva que ya exista en la base local (de otra sesión o de otra prueba)
--     está vencida frente a él, así que el conteo que devuelve es exacto. Cada fecha_creacion se fija frente a ese
--     ahora. Las monitorías son de la franja de los lunes 10:00 de M, cada una en un lunes distinto de 2020.
--   * Agendar (nota técnica) usa la hora real: public.agendar_monitoria toma now(), que dentro de la transacción no
--     cambia. Esas reservas se crean a 10 minutos (y 10 minutos y un microsegundo) de now(), en franjas "de calendario"
--     que abren en el día de la semana de hoy + 10, 11 y 12 días, como en agendar.test.sql.
-- La concurrencia real (dos conexiones a la vez, criterio 2) no cabe en una transacción: la prueba
-- integracion/expirar.test.ts la cubre. Aquí se prueba el orden: pagar y luego correr el proceso, y al revés.
--
-- Elenco (ids terminados en 27NN; la materia es 'PGTAP-27'):
--   Admin 01 (activo, para el turno de registrar_pago). Monitor M. Leads 01 a 07, cada uno con su sesión anónima.
--   Con ahora = A = 10-mar-2020 12:00 Bogotá, en la franja a1 (lunes 10:00), del Lead 01 salvo que se diga otro:
--     01 por pagar de A - 10 min - 1 µs (vencida)     02 por pagar de A - 10 min (el borde, P-40)
--     03 por pagar de hace 1 h con un pago rechazado   04 por pagar de hace 1 h con un pago en revisión
--     05 confirmada   06 realizada   07 cancelada por el estudiante   08 por pagar de A - 1 min (vigente)
--     09 grupal por pagar de A - 11 min (vencida)      11 y 12 por pagar de A - 10 min (el borde), para pagar
--     10 la que se agenda en la fecha de la 01 después del proceso (Lead 07)
--   Con la hora real, en las franjas 20, 21 y 22:
--     20 por pagar del Lead 03 de now() - 10 min - 1 µs (vencida): la pide el Lead 02
--     21 por pagar del Lead 04 de now() - 10 min (vigente, el borde): la pide el Lead 05
--     22 por pagar del Lead 06 de now() - 11 min (vencida): la vuelve a pedir el mismo Lead 06

begin;
create extension if not exists pgtap with schema extensions;

select plan(59);

-- ---------------------------------------------------------------------------
-- Estructura y permisos
-- ---------------------------------------------------------------------------
select has_function('privado', 'expirar_reservas', array['timestamp with time zone'],
  'Existe privado.expirar_reservas, el proceso con la hora como parámetro (para probar los bordes)');
select ok(
  to_regprocedure('privado.reserva_vencida(uuid, public.estado_monitoria, timestamptz, timestamptz)') is not null,
  'Existe privado.reserva_vencida, el predicado de D-12 que comparten el proceso, fecha_libre y agendar');
select ok(
  (select prosecdef from pg_proc where oid = 'privado.expirar_reservas(timestamptz)'::regprocedure)
  and not (select prosecdef from pg_proc
           where oid = 'privado.reserva_vencida(uuid, public.estado_monitoria, timestamptz, timestamptz)'::regprocedure)
  and (select bool_and(prosecdef) from pg_proc
       where oid in ('privado.fecha_libre(uuid, date, timestamptz)'::regprocedure,
                     'privado.agendar_monitoria(uuid, date, text, boolean)'::regprocedure,
                     'privado.registrar_pago(uuid, text, text, text, timestamptz)'::regprocedure)),
  'El proceso es security definer (escribe en monitoria); reserva_vencida corre con los permisos de quien la llama (todas definer); fecha_libre, agendar y registrar_pago siguen definer');
select ok(
  (select bool_and('search_path=""' = any(proconfig)) from pg_proc
   where oid in ('privado.expirar_reservas(timestamptz)'::regprocedure,
                 'privado.reserva_vencida(uuid, public.estado_monitoria, timestamptz, timestamptz)'::regprocedure,
                 'privado.fecha_libre(uuid, date, timestamptz)'::regprocedure,
                 'privado.agendar_monitoria(uuid, date, text, boolean)'::regprocedure,
                 'privado.registrar_pago(uuid, text, text, text, timestamptz)'::regprocedure)),
  'Todas fijan un search_path vacío');
select is(
  array[pg_get_function_identity_arguments('privado.expirar_reservas(timestamptz)'::regprocedure),
        array_to_string((select proargnames from pg_proc
                         where oid = 'privado.reserva_vencida(uuid, public.estado_monitoria, timestamptz, timestamptz)'::regprocedure), ', ')],
  array['p_ahora timestamp with time zone', 'p_id_monitoria, p_estado, p_fecha_creacion, p_ahora'],
  'El proceso recibe solo la hora; reserva_vencida, la fila (id, estado, fecha_creacion) y la hora');
select is(
  array[pg_get_function_result('privado.expirar_reservas(timestamptz)'::regprocedure),
        pg_get_function_result('privado.reserva_vencida(uuid, public.estado_monitoria, timestamptz, timestamptz)'::regprocedure)],
  array['integer', 'boolean'],
  'El proceso devuelve cuántas canceló; reserva_vencida, verdadero o falso');
select ok(
  not has_function_privilege('anon', 'privado.expirar_reservas(timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'privado.expirar_reservas(timestamptz)', 'execute')
  and not has_function_privilege('service_role', 'privado.expirar_reservas(timestamptz)', 'execute'),
  'El proceso no se expone: ni el visitante, ni una sesión, ni el servidor lo ejecutan; solo pg_cron');
select ok(
  not has_function_privilege('anon', 'privado.reserva_vencida(uuid, public.estado_monitoria, timestamptz, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'privado.reserva_vencida(uuid, public.estado_monitoria, timestamptz, timestamptz)', 'execute')
  and not has_function_privilege('service_role', 'privado.reserva_vencida(uuid, public.estado_monitoria, timestamptz, timestamptz)', 'execute'),
  'reserva_vencida solo se llama desde otras funciones de la base');
select ok(
  not exists (
    select 1
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid in ('privado.expirar_reservas(timestamptz)'::regprocedure,
                    'privado.reserva_vencida(uuid, public.estado_monitoria, timestamptz, timestamptz)'::regprocedure,
                    'privado.fecha_libre(uuid, date, timestamptz)'::regprocedure,
                    'privado.agendar_monitoria(uuid, date, text, boolean)'::regprocedure,
                    'privado.registrar_pago(uuid, text, text, text, timestamptz)'::regprocedure)
      and a.grantee = 0),
  'Nadie las hereda de PUBLIC');
select ok(
  has_function_privilege('authenticated', 'privado.agendar_monitoria(uuid, date, text, boolean)', 'execute')
  and has_function_privilege('authenticated', 'privado.registrar_pago_de_la_sesion(uuid, text, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'privado.registrar_pago(uuid, text, text, text, timestamptz)', 'execute')
  and not has_function_privilege('anon', 'privado.agendar_monitoria(uuid, date, text, boolean)', 'execute')
  and not has_function_privilege('service_role', 'privado.registrar_pago(uuid, text, text, text, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'privado.fecha_libre(uuid, date, timestamptz)', 'execute')
  and not has_function_privilege('service_role', 'privado.fecha_libre(uuid, date, timestamptz)', 'execute'),
  'Permisos de las redefinidas: agendar y pagar con sesión (pagar, solo con la hora de la base: la versión con p_ahora es interna, revisión de HU-018), fecha_libre solo desde la base');
select is(
  (select count(*)::int from cron.job
   where jobname = 'calibra-expirar-reservas' and schedule = '* * * * *' and active),
  1, 'Sección 6.3: existe un solo trabajo calibra-expirar-reservas en pg_cron, activo y cada minuto');
select matches(
  (select command from cron.job where jobname = 'calibra-expirar-reservas'),
  '^select privado\.expirar_reservas\(now\(\)\)$',
  'El trabajo llama a privado.expirar_reservas con now()');
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'monitoria' and indexname = 'monitoria_pendientes_idx'
      and indexdef like '%(fecha_creacion) WHERE (estado = ''pendiente_pago''::%'),
  'Existe monitoria_pendientes_idx: el proceso recorre solo las monitorías por pagar');

-- Sin permiso ni se ejecutan.
set local role authenticated;
select throws_ok($$select privado.expirar_reservas(now())$$, '42501', null,
  'Una sesión no puede correr el proceso: permiso denegado');
reset role;
set local role service_role;
select throws_ok($$select privado.expirar_reservas(now())$$, '42501', null,
  'service_role tampoco');
reset role;
set local role anon;
select throws_ok($$select privado.expirar_reservas(now())$$, '42501', null,
  'Ni el visitante sin sesión');
reset role;
set local role authenticated;
select throws_ok(
  $$select privado.reserva_vencida('50000000-0000-0000-0000-000000002701', 'pendiente_pago', now(), now())$$, '42501', null,
  'Una sesión no puede preguntar por reserva_vencida (mira los pagos, que no lee): permiso denegado');
reset role;

-- ---------------------------------------------------------------------------
-- Fixtures (como postgres, antes de fijar ninguna sesión: la cuota de comprobantes cuenta por carpeta)
-- ---------------------------------------------------------------------------
create temporary table ref as
select (now() at time zone 'America/Bogota')::date as hoy;
grant select on ref to authenticated;

-- Lo que devuelve cada llamada que importa, para comparar después.
create temporary table r (k text primary key, resultado text, id uuid);
grant select, insert on r to authenticated;

insert into auth.users (id, is_anonymous) values
  ('a0000000-0000-0000-0000-000000002701', false),
  ('b0000000-0000-0000-0000-0000000027a0', false);
insert into auth.users (id, is_anonymous)
select ('c0000000-0000-0000-0000-0000000027' || n)::uuid, true
from unnest(array['01', '02', '03', '04', '05', '06', '07']) n;

insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-000000002701', 'Admin', 'admin27@calibra.test', 9002701);
insert into public.monitor (id, nombre) values ('b0000000-0000-0000-0000-0000000027a0', 'Monitor 27');
insert into public.materia (id, nombre, codigo) values ('10000000-0000-0000-0000-0000000027a1', 'Materia 27', 'PGTAP-27');
insert into public.certificado (id_monitor, id_materia, id_admin) values
  ('b0000000-0000-0000-0000-0000000027a0', '10000000-0000-0000-0000-0000000027a1', 'a0000000-0000-0000-0000-000000002701');
insert into public.lead (id, id_sesion_anonima, nombre, correo, acepta_tratamiento_datos, fecha_consentimiento)
select ('40000000-0000-0000-0000-0000000027' || n)::uuid, ('c0000000-0000-0000-0000-0000000027' || n)::uuid,
       'Lead ' || n, 'expirar27-' || n || '@calibra.test', true, now()
from unnest(array['01', '02', '03', '04', '05', '06', '07']) n;

-- La franja de los lunes 10:00, abierta desde enero de 2020; y las de calendario, abiertas desde hace 60 días.
insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min, lugar, abierta_desde) values
  ('30000000-0000-0000-0000-0000000027a1', 'b0000000-0000-0000-0000-0000000027a0', 1, '10:00', true, 20000, 60,
   'Salón 127', '2020-01-01');
insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min, lugar, abierta_desde)
select v.id, 'b0000000-0000-0000-0000-0000000027a0', extract(isodow from r.hoy + v.desp)::smallint, '10:00', true,
       21000, 60, 'Salón 227', r.hoy - 60
from ref r cross join (values
  ('30000000-0000-0000-0000-000000002720'::uuid, 10),
  ('30000000-0000-0000-0000-000000002721'::uuid, 11),
  ('30000000-0000-0000-0000-000000002722'::uuid, 12)
) v(id, desp);

insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado, motivo_cancelacion, fecha_finalizacion, fecha_creacion)
select ('50000000-0000-0000-0000-0000000027' || v.nn)::uuid, '30000000-0000-0000-0000-0000000027a1',
       '10000000-0000-0000-0000-0000000027a1', '40000000-0000-0000-0000-000000002701', v.fecha, 20000,
       v.estado, v.motivo, v.finalizada, v.creada
from (values
  ('01', date '2020-03-16', 'pendiente_pago'::public.estado_monitoria, null::public.motivo_cancelacion, null::timestamptz,
   timestamptz '2020-03-10 12:00-05' - interval '10 minutes' - interval '1 microsecond'),
  ('02', date '2020-03-23', 'pendiente_pago', null, null, timestamptz '2020-03-10 12:00-05' - interval '10 minutes'),
  ('03', date '2020-03-30', 'pendiente_pago', null, null, timestamptz '2020-03-10 12:00-05' - interval '1 hour'),
  ('04', date '2020-04-06', 'pendiente_pago', null, null, timestamptz '2020-03-10 12:00-05' - interval '1 hour'),
  ('05', date '2020-04-13', 'confirmada', null, null, timestamptz '2020-03-10 12:00-05' - interval '1 hour'),
  ('06', date '2020-03-09', 'realizada', null, timestamptz '2020-03-09 11:00-05', timestamptz '2020-03-10 12:00-05' - interval '3 days'),
  ('07', date '2020-04-20', 'cancelada', 'estudiante', null, timestamptz '2020-03-10 12:00-05' - interval '1 hour'),
  ('08', date '2020-04-27', 'pendiente_pago', null, null, timestamptz '2020-03-10 12:00-05' - interval '1 minute'),
  ('09', date '2020-05-04', 'pendiente_pago', null, null, timestamptz '2020-03-10 12:00-05' - interval '11 minutes'),
  ('11', date '2020-05-11', 'pendiente_pago', null, null, timestamptz '2020-03-10 12:00-05' - interval '10 minutes'),
  ('12', date '2020-05-18', 'pendiente_pago', null, null, timestamptz '2020-03-10 12:00-05' - interval '10 minutes')
) as v(nn, fecha, estado, motivo, finalizada, creada);
insert into public.monitoria_grupal (id_monitoria, cupos, modalidad_pago, precio_por_persona) values
  ('50000000-0000-0000-0000-000000002709', 3, 'dividido', 15000);

insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado, fecha_creacion)
select v.id, v.id_franja, '10000000-0000-0000-0000-0000000027a1', v.id_lead, r.hoy + v.desp, 21000,
       'pendiente_pago'::public.estado_monitoria, v.creada
from ref r cross join (values
  ('50000000-0000-0000-0000-000000002720'::uuid, '30000000-0000-0000-0000-000000002720'::uuid,
   '40000000-0000-0000-0000-000000002703'::uuid, 10, now() - interval '10 minutes' - interval '1 microsecond'),
  ('50000000-0000-0000-0000-000000002721'::uuid, '30000000-0000-0000-0000-000000002721'::uuid,
   '40000000-0000-0000-0000-000000002704'::uuid, 11, now() - interval '10 minutes'),
  ('50000000-0000-0000-0000-000000002722'::uuid, '30000000-0000-0000-0000-000000002722'::uuid,
   '40000000-0000-0000-0000-000000002706'::uuid, 12, now() - interval '11 minutes')
) v(id, id_franja, id_lead, desp, creada);

-- Comprobantes de la sesión 01: K03 y K04 respaldan los pagos de la 03 (rechazado) y la 04 (en revisión); K11 y K12,
-- en el bucket y revisados, son los que el Lead adjunta a la 11 y la 12.
insert into storage.objects (bucket_id, name) values
  ('comprobantes', 'c0000000-0000-0000-0000-000000002701/e2700000-0000-0000-0000-000000000011.png'),
  ('comprobantes', 'c0000000-0000-0000-0000-000000002701/e2700000-0000-0000-0000-000000000012.png');
insert into public.comprobante_revisado (ruta, tipo)
select 'c0000000-0000-0000-0000-000000002701/e2700000-0000-0000-0000-0000000000' || n || '.png', 'image/png'
from unnest(array['03', '04', '11', '12']) n;
insert into public.pago (id_monitoria, monto, nombre_pagador, contacto, estado, fecha_pago, id_admin, fecha_asignacion, fecha_revision, comprobante) values
  ('50000000-0000-0000-0000-000000002703', 20000, 'Ana', 'ana@calibra.test', 'rechazado',
   timestamptz '2020-03-10 12:00-05' - interval '55 minutes', 'a0000000-0000-0000-0000-000000002701',
   timestamptz '2020-03-10 12:00-05' - interval '55 minutes', timestamptz '2020-03-10 12:00-05' - interval '30 minutes',
   'c0000000-0000-0000-0000-000000002701/e2700000-0000-0000-0000-000000000003.png'),
  ('50000000-0000-0000-0000-000000002704', 20000, 'Ana', 'ana@calibra.test', 'en_revision',
   timestamptz '2020-03-10 12:00-05' - interval '55 minutes', 'a0000000-0000-0000-0000-000000002701',
   timestamptz '2020-03-10 12:00-05' - interval '55 minutes', null,
   'c0000000-0000-0000-0000-000000002701/e2700000-0000-0000-0000-000000000004.png');

select ok(
  (select count(*) = 14 from public.monitoria where id::text like '50000000-0000-0000-0000-0000000027%')
  and exists (select 1 from public.monitoria_grupal where id_monitoria = '50000000-0000-0000-0000-000000002709')
  and (select count(*) = 2 from public.pago where id_monitoria::text like '50000000-0000-0000-0000-0000000027%'),
  'Control: las 14 monitorías existen, la 09 es grupal y solo la 03 y la 04 tienen pago');

-- ---------------------------------------------------------------------------
-- El predicado (RN-34, D-12, P-40), con ahora = A
-- ---------------------------------------------------------------------------
select ok(
  privado.reserva_vencida('50000000-0000-0000-0000-000000002701', 'pendiente_pago',
    timestamptz '2020-03-10 12:00-05' - interval '10 minutes' - interval '1 microsecond', '2020-03-10 12:00-05'),
  'RN-34: una por pagar sin pagos de hace 10 minutos y un microsegundo está vencida');
select ok(
  not privado.reserva_vencida('50000000-0000-0000-0000-000000002702', 'pendiente_pago',
    timestamptz '2020-03-10 12:00-05' - interval '10 minutes', '2020-03-10 12:00-05'),
  'P-40: con exactamente 10 minutos todavía no (vence cuando ahora > reserva_hasta)');
select ok(
  (select bool_and(not privado.reserva_vencida(m.id, m.estado, m.fecha_creacion, '2020-03-10 12:00-05'))
   from public.monitoria m
   where m.id in ('50000000-0000-0000-0000-000000002703', '50000000-0000-0000-0000-000000002704')),
  'D-12: con un pago no está vencida, aunque ese pago se haya rechazado');
select ok(
  (select bool_and(not privado.reserva_vencida(m.id, m.estado, m.fecha_creacion, '2020-03-10 12:00-05'))
   from public.monitoria m
   where m.id in ('50000000-0000-0000-0000-000000002705', '50000000-0000-0000-0000-000000002706',
                  '50000000-0000-0000-0000-000000002707')),
  'Una confirmada, una realizada o una cancelada nunca es una reserva vencida, por viejas que sean');
select is(
  privado.reserva_vencida('50000000-0000-0000-0000-000000002701', 'pendiente_pago',
    timestamptz '2020-03-10 12:00-05' - interval '1 day', null),
  false, 'Sin hora no hay vencimiento: falso, nunca nulo');

-- D-12: la agenda del monitor marca como vencidas exactamente las que el predicado da por vencidas.
create temporary table agenda (id_monitoria uuid, reserva_vencida boolean);
grant insert on agenda to authenticated;
set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000027a0","role":"authenticated"}';
insert into agenda select a.id_monitoria, a.reserva_vencida from privado.agenda_del_monitor('2020-03-10 12:00-05') a;
reset role;
select results_eq(
  $$select right(id_monitoria::text, 2) from agenda where reserva_vencida order by 1$$,
  $$values ('01'::text), ('09'::text)$$,
  'D-12: con ahora = A, la agenda del monitor muestra como vencidas la 01 y la grupal 09');
select set_eq(
  $$select id_monitoria from agenda where reserva_vencida$$,
  $$select m.id from public.monitoria m
    where m.id_monitor = 'b0000000-0000-0000-0000-0000000027a0'
      and privado.reserva_vencida(m.id, m.estado, m.fecha_creacion, '2020-03-10 12:00-05')$$,
  'D-12: son las mismas que da privado.reserva_vencida: la agenda y el proceso usan el mismo predicado');

-- ---------------------------------------------------------------------------
-- Nota técnica: la fecha libre no espera al proceso (todavía no ha corrido)
-- ---------------------------------------------------------------------------
select ok(
  privado.fecha_libre('30000000-0000-0000-0000-0000000027a1', '2020-03-16', '2020-03-10 12:00-05'),
  'Nota técnica: la fecha cuya única reserva está vencida ya está libre, aunque el proceso no haya corrido');
select is(
  (select estado::text from public.monitoria where id = '50000000-0000-0000-0000-000000002701'),
  'pendiente_pago', 'Control: esa reserva sigue en pendiente_pago (nadie la ha cancelado)');
select ok(
  not privado.fecha_libre('30000000-0000-0000-0000-0000000027a1', '2020-03-23', '2020-03-10 12:00-05')
  and privado.fecha_libre('30000000-0000-0000-0000-0000000027a1', '2020-03-23',
                          timestamptz '2020-03-10 12:00-05' + interval '1 microsecond'),
  'P-40: la del borde ocupa su fecha con ahora = reserva_hasta y la libera un microsegundo después');
select ok(
  not privado.fecha_libre('30000000-0000-0000-0000-0000000027a1', '2020-03-30', '2020-03-10 12:00-05')
  and not privado.fecha_libre('30000000-0000-0000-0000-0000000027a1', '2020-04-06', '2020-03-10 12:00-05'),
  'D-12: una por pagar con un pago (rechazado o en revisión) sigue ocupando su fecha');
select ok(
  not privado.fecha_libre('30000000-0000-0000-0000-0000000027a1', '2020-04-27', '2020-03-10 12:00-05')
  and not privado.fecha_libre('30000000-0000-0000-0000-0000000027a1', '2020-04-13', '2020-03-10 12:00-05'),
  'Una por pagar vigente y una confirmada siguen ocupando su fecha (RN-33)');
select results_eq(
  $$select fecha from privado.fechas_libres_de_materia('PGTAP-27', 2, '2020-03-10 12:00-05')
    where id_franja = '30000000-0000-0000-0000-0000000027a1'$$,
  $$values ('2020-03-16'::date)$$,
  'La lista de la materia (HU-016) ya muestra la fecha de la vencida (el 16) y todavía no la del borde (el 23)');
select results_eq(
  $$select fecha from privado.fechas_libres_de_materia('PGTAP-27', 2, timestamptz '2020-03-10 12:00-05' + interval '1 microsecond')
    where id_franja = '30000000-0000-0000-0000-0000000027a1'$$,
  $$values ('2020-03-16'::date), ('2020-03-23'::date)$$,
  'Un microsegundo después muestra las dos');

-- ---------------------------------------------------------------------------
-- Criterio 1: el proceso, con ahora = A
-- ---------------------------------------------------------------------------
select is(
  (select privado.expirar_reservas('2020-03-10 12:00-05')),
  2, 'Criterio 1: devuelve cuántas canceló: dos (la 01 y la grupal 09)');
select results_eq(
  $$select estado::text, motivo_cancelacion::text from public.monitoria where id = '50000000-0000-0000-0000-000000002701'$$,
  $$values ('cancelada'::text, 'reserva_expirada'::text)$$,
  'Criterio 1 y RN-34: la por pagar de hace 10 minutos y un microsegundo pasa a cancelada con reserva_expirada');
select results_eq(
  $$select estado::text, motivo_cancelacion::text from public.monitoria where id = '50000000-0000-0000-0000-000000002702'$$,
  $$values ('pendiente_pago'::text, null::text)$$,
  'P-40: la de exactamente 10 minutos sigue en pendiente_pago');
select results_eq(
  $$select right(id::text, 2), estado::text, motivo_cancelacion::text from public.monitoria
    where id in ('50000000-0000-0000-0000-000000002703', '50000000-0000-0000-0000-000000002704') order by id$$,
  $$values ('03'::text, 'pendiente_pago'::text, null::text), ('04', 'pendiente_pago', null)$$,
  'Las que tienen un pago (rechazado o en revisión) no se cancelan');
select results_eq(
  $$select right(id::text, 2), estado::text, motivo_cancelacion::text, fecha_finalizacion from public.monitoria
    where id in ('50000000-0000-0000-0000-000000002705', '50000000-0000-0000-0000-000000002706',
                 '50000000-0000-0000-0000-000000002707') order by id$$,
  $$values ('05'::text, 'confirmada'::text, null::text, null::timestamptz),
           ('06', 'realizada', null, timestamptz '2020-03-09 11:00-05'),
           ('07', 'cancelada', 'estudiante', null)$$,
  'La confirmada, la realizada y la cancelada no cambian (la cancelada conserva su motivo)');
select results_eq(
  $$select estado::text, motivo_cancelacion::text from public.monitoria where id = '50000000-0000-0000-0000-000000002708'$$,
  $$values ('pendiente_pago'::text, null::text)$$,
  'La por pagar de hace 1 minuto, todavía vigente, no se toca');
select results_eq(
  $$select estado::text, motivo_cancelacion::text from public.monitoria where id = '50000000-0000-0000-0000-000000002709'$$,
  $$values ('cancelada'::text, 'reserva_expirada'::text)$$,
  'RN-34 vale también para una grupal por pagar vencida');
select ok(
  privado.fecha_libre('30000000-0000-0000-0000-0000000027a1', '2020-03-16', '2020-03-10 12:00-05'),
  'Criterio 1: la fecha queda libre');
select lives_ok(
  $$insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total)
    values ('50000000-0000-0000-0000-000000002710', '30000000-0000-0000-0000-0000000027a1',
            '10000000-0000-0000-0000-0000000027a1', '40000000-0000-0000-0000-000000002707', '2020-03-16', 20000)$$,
  'Y otra monitoría entra en esa fecha: el índice único (estado <> cancelada) ya no choca');

-- ---------------------------------------------------------------------------
-- Criterio 3: dos corridas seguidas
-- ---------------------------------------------------------------------------
create temporary table despues_1 as
select id, estado::text as estado, motivo_cancelacion::text as motivo
from public.monitoria where id::text like '50000000-0000-0000-0000-0000000027%';
select is(
  (select privado.expirar_reservas('2020-03-10 12:00-05')),
  0, 'Criterio 3: correrlo otra vez con el mismo ahora devuelve 0');
select results_eq(
  $$select id, estado::text, motivo_cancelacion::text from public.monitoria
    where id::text like '50000000-0000-0000-0000-0000000027%' order by id$$,
  $$select id, estado, motivo from despues_1 order by id$$,
  'Y la segunda corrida no cambia ninguna monitoría');

-- ---------------------------------------------------------------------------
-- Criterio 2 en orden (la carrera real con dos conexiones está en integracion/expirar.test.ts)
-- ---------------------------------------------------------------------------
-- El pago llega primero: la 11 se paga con ahora = A, justo en el borde (P-40), y el proceso corre después.
-- Como postgres con el token del Lead: la versión con p_ahora es interna (revisión de HU-018, en esta HU).
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000002701","role":"authenticated","is_anonymous":true}';
insert into r select 'p_11', * from privado.registrar_pago('50000000-0000-0000-0000-000000002711',
  'c0000000-0000-0000-0000-000000002701/e2700000-0000-0000-0000-000000000011.png', 'Ana', 'ana@calibra.test',
  '2020-03-10 12:00-05');
select is((select resultado from r where k = 'p_11'), 'registrado',
  'P-40: en reserva_hasta exacto el pago todavía entra: registrado');
reset role;
select is(
  (select privado.expirar_reservas(timestamptz '2020-03-10 12:00-05' + interval '1 microsecond')),
  2, 'Un microsegundo después el proceso cancela dos: la 02 y la 12 (las del borde sin pago), no la 11');
select results_eq(
  $$select right(m.id::text, 2), m.estado::text, m.motivo_cancelacion::text,
           (select count(*)::int from public.pago p where p.id_monitoria = m.id)
    from public.monitoria m
    where m.id in ('50000000-0000-0000-0000-000000002702', '50000000-0000-0000-0000-000000002711',
                   '50000000-0000-0000-0000-000000002712') order by m.id$$,
  $$values ('02'::text, 'cancelada'::text, 'reserva_expirada'::text, 0),
           ('11', 'confirmada', null, 1),
           ('12', 'cancelada', 'reserva_expirada', 0)$$,
  'Criterio 2: la que se pagó quedó confirmada con su pago; las otras dos, canceladas sin pago');

-- El proceso llega primero: la 12 ya se canceló. Aunque la transacción del pago hubiera empezado en el borde (ahora =
-- A, todavía a tiempo), al leer la fila la encuentra cancelada por reserva_expirada.
-- Como postgres con el token del Lead, igual que arriba.
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000002701","role":"authenticated","is_anonymous":true}';
insert into r select 'p_12', * from privado.registrar_pago('50000000-0000-0000-0000-000000002712',
  'c0000000-0000-0000-0000-000000002701/e2700000-0000-0000-0000-000000000012.png', 'Ana', 'ana@calibra.test',
  '2020-03-10 12:00-05');
select results_eq(
  $$select resultado, id from r where k = 'p_12'$$,
  $$values ('vencida'::text, null::uuid)$$,
  'Criterio 2: si el proceso ganó, el pago recibe vencida (lo mismo que si hubiera llegado tarde) y no se crea');
reset role;
select results_eq(
  $$select m.estado::text, m.motivo_cancelacion::text, (select count(*)::int from public.pago p where p.id_monitoria = m.id)
    from public.monitoria m where m.id = '50000000-0000-0000-0000-000000002712'$$,
  $$values ('cancelada'::text, 'reserva_expirada'::text, 0)$$,
  'La 12 sigue cancelada, sin pago: el estado quedó consistente');

-- registrar_pago por la puerta pública (con now()): la cancelada por reserva_expirada responde vencida; la cancelada
-- por otro motivo, cancelada.
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000002701","role":"authenticated","is_anonymous":true}';
select is(
  array[
    (select resultado from public.registrar_pago('50000000-0000-0000-0000-000000002701',
       'c0000000-0000-0000-0000-000000002701/e2700000-0000-0000-0000-000000000012.png', 'Ana', 'ana@calibra.test')),
    (select resultado from public.registrar_pago('50000000-0000-0000-0000-000000002707',
       'c0000000-0000-0000-0000-000000002701/e2700000-0000-0000-0000-000000000012.png', 'Ana', 'ana@calibra.test'))],
  array['vencida', 'cancelada'],
  'registrar_pago: la cancelada por reserva_expirada responde vencida; la cancelada por el estudiante, cancelada');
reset role;

-- ---------------------------------------------------------------------------
-- Nota técnica: agendar cancela en el momento la vencida de esa fecha (hora real)
-- ---------------------------------------------------------------------------
select ok(
  privado.fecha_libre('30000000-0000-0000-0000-000000002720', (select hoy + 10 from ref), now())
  and (select estado = 'pendiente_pago' from public.monitoria where id = '50000000-0000-0000-0000-000000002720'),
  'Con la hora real, la fecha de la 20 (vencida hace un microsegundo, aún en pendiente_pago) ya está libre');
select ok(
  exists (
    select 1 from privado.fechas_libres_de_materia('PGTAP-27', 4, now()) l, ref
    where l.id_franja = '30000000-0000-0000-0000-000000002720' and l.fecha = ref.hoy + 10),
  'Y la lista de la materia la muestra');

-- Otro Lead (02) la pide.
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000002702","role":"authenticated","is_anonymous":true}';
insert into r select 'a_20', * from public.agendar_monitoria(
  '30000000-0000-0000-0000-000000002720', (select hoy + 10 from ref), 'PGTAP-27');
select is((select resultado from r where k = 'a_20'), 'agendada',
  'Nota técnica: otro Lead agenda la fecha de una reserva vencida que el proceso todavía no canceló: agendada');
reset role;
select results_eq(
  $$select m.id = '50000000-0000-0000-0000-000000002720', m.id = (select id from r where k = 'a_20'),
           m.estado::text, m.motivo_cancelacion::text, m.id_lead
    from public.monitoria m
    where m.id_franja = '30000000-0000-0000-0000-000000002720' order by m.estado::text$$,
  $$values (true, false, 'cancelada'::text, 'reserva_expirada'::text, '40000000-0000-0000-0000-000000002703'::uuid),
           (false, true, 'pendiente_pago', null, '40000000-0000-0000-0000-000000002702'::uuid)$$,
  'Agendar canceló la vencida (20) con reserva_expirada y la nueva quedó pendiente_pago a nombre del Lead 02');

-- Una de exactamente 10 minutos sigue vigente: otro Lead (05) recibe ocupada y no se cancela.
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000002705","role":"authenticated","is_anonymous":true}';
select results_eq(
  $$select resultado, id_monitoria
    from public.agendar_monitoria('30000000-0000-0000-0000-000000002721', (select hoy + 11 from ref), 'PGTAP-27')$$,
  $$values ('ocupada'::text, null::uuid)$$,
  'P-40: una reserva de hace justo 10 minutos todavía ocupa la fecha: ocupada');
reset role;
select results_eq(
  $$select estado::text, motivo_cancelacion::text from public.monitoria where id = '50000000-0000-0000-0000-000000002721'$$,
  $$values ('pendiente_pago'::text, null::text)$$,
  'Y agendar no la canceló');

-- El mismo Lead (06) que dejó vencer su reserva vuelve a pedir esa fecha.
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000002706","role":"authenticated","is_anonymous":true}';
insert into r select 'a_22', * from public.agendar_monitoria(
  '30000000-0000-0000-0000-000000002722', (select hoy + 12 from ref), 'PGTAP-27');
reset role;
select results_eq(
  $$select resultado, id <> '50000000-0000-0000-0000-000000002722' from r where k = 'a_22'$$,
  $$values ('agendada'::text, true)$$,
  'El mismo Lead que dejó vencer su reserva vuelve a agendar esa fecha: agendada, con una monitoría nueva');
select results_eq(
  $$select m.id = '50000000-0000-0000-0000-000000002722', m.id = (select id from r where k = 'a_22'),
           m.estado::text, m.motivo_cancelacion::text, m.id_lead
    from public.monitoria m
    where m.id_franja = '30000000-0000-0000-0000-000000002722' order by m.estado::text$$,
  $$values (true, false, 'cancelada'::text, 'reserva_expirada'::text, '40000000-0000-0000-0000-000000002706'::uuid),
           (false, true, 'pendiente_pago', null, '40000000-0000-0000-0000-000000002706'::uuid)$$,
  'La vieja (22) quedó cancelada con reserva_expirada y la nueva, pendiente_pago del mismo Lead');

-- Si agendar ganó la carrera, el Lead que llega con su comprobante también recibe vencida.
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000002703","role":"authenticated","is_anonymous":true}';
select is(
  (select resultado from public.registrar_pago('50000000-0000-0000-0000-000000002720',
     'c0000000-0000-0000-0000-000000002703/e2700000-0000-0000-0000-000000000020.png', 'Ana', 'ana@calibra.test')),
  'vencida', 'registrar_pago sobre la que canceló agendar (reserva_expirada): vencida');
reset role;

-- ---------------------------------------------------------------------------
-- D-16: no se avisa a nadie
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from public.aviso_monitor
   where id_monitoria in ('50000000-0000-0000-0000-000000002701', '50000000-0000-0000-0000-000000002702',
                          '50000000-0000-0000-0000-000000002709', '50000000-0000-0000-0000-000000002712',
                          '50000000-0000-0000-0000-000000002720', '50000000-0000-0000-0000-000000002722')),
  0, 'D-16: ninguna cancelación por reserva_expirada (del proceso o de agendar) anota un aviso al monitor');

select * from finish();
rollback;
