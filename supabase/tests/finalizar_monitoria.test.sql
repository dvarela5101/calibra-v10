-- Pruebas pgTAP de finalizar una sesión y del cierre automático (HU-023).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.
--
-- Dos grupos de monitorías, uno por regla:
--   * El monitor finaliza (D-13) con la hora real: public.finalizar_monitoria usa now(), que dentro de una
--     transacción no cambia. Cada caso lleva su propia franja, construida desde now() en la zona de Bogotá: empieza
--     exactamente a esa distancia de now() (y a un microsegundo más para el lado de afuera).
--   * El cierre automático (D-14) se prueba con privado.cerrar_monitorias_sin_finalizar y un `ahora` fijo, el martes
--     10 de marzo de 2020 a las 12:00 en Bogotá. Está en el pasado a propósito: así ninguna monitoría confirmada que
--     ya exista en la base local (de otra sesión o de otra prueba) queda alcanzada y el conteo que devuelve es exacto.
-- Las monitorías se insertan como postgres: el trigger completa id_monitor desde la franja y exige que la fecha
-- caiga en el día de la franja (por eso franja, hora y fecha salen del mismo instante); una realizada exige
-- fecha_finalizacion y una cancelada, motivo.
--
-- Elenco (todos los ids terminan en 23NN; la materia es 'PGTAP-23-A'):
--   Monitores: A (dicta todas las monitorías) y B (otro monitor, sin monitorías). Admin 01. Lead 01 con su sesión anónima.
--   Finalizar (monitor A), con la hora real:
--     01 confirmada que empezó hace 2 h      02 confirmada que empieza justo ahora (P-40)
--     03 confirmada que empieza en 1 microsegundo   04 realizada (con su fecha_finalizacion)
--     05 por pagar que ya empezó    06 cancelada que ya empezó    07 grupal confirmada que ya empezó
--     08 confirmada que ya empezó, para quien no es su monitor    09 por pagar que empieza en 2 h
--   Cierre automático (monitor A, con ahora = 10-mar-2020 12:00 Bogotá). El fin + 24 h de cada una:
--     21 confirmada (90 min), fin + 24 h = ahora exacto    22 confirmada (90 min), fin + 24 h = ahora + 1 microsegundo
--     23 confirmada de hace 4 días    24 confirmada, fin + 24 h = ahora - 1 microsegundo
--     25 por pagar, 26 cancelada y 27 realizada, las tres de hace 4 días    28 grupal confirmada de hace 4 días
--     29 confirmada que terminó hace 2 h

begin;
create extension if not exists pgtap with schema extensions;

select plan(72);

-- ---------------------------------------------------------------------------
-- Estructura y permisos
-- ---------------------------------------------------------------------------
select has_function('privado', 'finalizar_monitoria', array['uuid'],
  'Existe privado.finalizar_monitoria, la que escribe en monitoria con la identidad de la sesión');
select has_function('privado', 'cerrar_monitorias_sin_finalizar', array['timestamp with time zone'],
  'Existe privado.cerrar_monitorias_sin_finalizar, el cierre automático con la hora como parámetro (para probar los plazos)');
select has_function('public', 'finalizar_monitoria', array['uuid'],
  'Existe su puerta en la Data API: public.finalizar_monitoria(uuid)');
select has_function('public', 'cierre_automatico_desde', array['timestamp with time zone'],
  'Existe public.cierre_automatico_desde, el plazo del cierre automático (D-14)');
select ok(
  (select prosecdef from pg_proc where oid = 'privado.finalizar_monitoria(uuid)'::regprocedure)
  and (select prosecdef from pg_proc where oid = 'privado.cerrar_monitorias_sin_finalizar(timestamptz)'::regprocedure)
  and not (select prosecdef from pg_proc where oid = 'public.finalizar_monitoria(uuid)'::regprocedure),
  'Las de privado son security definer (son las que escriben en monitoria); la puerta corre con los permisos de quien llama');
select ok(
  (select bool_and('search_path=""' = any(proconfig)) from pg_proc
   where oid in ('privado.finalizar_monitoria(uuid)'::regprocedure,
                 'privado.cerrar_monitorias_sin_finalizar(timestamptz)'::regprocedure,
                 'public.finalizar_monitoria(uuid)'::regprocedure,
                 'public.cierre_automatico_desde(timestamptz)'::regprocedure,
                 'public.parametros_negocio()'::regprocedure)),
  'Todas fijan un search_path vacío');
select is(
  array[pg_get_function_identity_arguments('privado.finalizar_monitoria(uuid)'::regprocedure),
        pg_get_function_identity_arguments('public.finalizar_monitoria(uuid)'::regprocedure),
        pg_get_function_identity_arguments('privado.cerrar_monitorias_sin_finalizar(timestamptz)'::regprocedure)],
  array['p_id_monitoria uuid', 'p_id_monitoria uuid', 'p_ahora timestamp with time zone'],
  'Finalizar recibe solo la monitoría: ni el monitor ni la hora (nadie finaliza a nombre de otro ni adelanta el reloj, D-13)');
select is(
  array[pg_get_function_result('privado.finalizar_monitoria(uuid)'::regprocedure),
        pg_get_function_result('public.finalizar_monitoria(uuid)'::regprocedure),
        pg_get_function_result('privado.cerrar_monitorias_sin_finalizar(timestamptz)'::regprocedure)],
  array['text', 'text', 'integer'],
  'Finalizar devuelve un resultado en texto y el cierre automático, cuántas monitorías cerró');
select ok(
  not has_function_privilege('anon', 'public.finalizar_monitoria(uuid)', 'execute')
  and not has_function_privilege('anon', 'privado.finalizar_monitoria(uuid)', 'execute')
  and not has_function_privilege('anon', 'privado.cerrar_monitorias_sin_finalizar(timestamptz)', 'execute'),
  'Sin sesión (anon) no se finaliza ni se cierra nada: ninguna de las tres la ejecuta');
select ok(
  has_function_privilege('authenticated', 'public.finalizar_monitoria(uuid)', 'execute')
  and has_function_privilege('authenticated', 'privado.finalizar_monitoria(uuid)', 'execute'),
  'Con sesión sí se puede finalizar: la puerta (invoker) llega a la de privado con el permiso de quien llama');
select ok(
  not has_function_privilege('authenticated', 'privado.cerrar_monitorias_sin_finalizar(timestamptz)', 'execute'),
  'El cierre automático no se expone: ninguna sesión lo ejecuta, solo pg_cron');
select ok(
  not has_function_privilege('service_role', 'privado.cerrar_monitorias_sin_finalizar(timestamptz)', 'execute'),
  'Tampoco service_role ejecuta el cierre automático');
select ok(
  not has_function_privilege('service_role', 'public.finalizar_monitoria(uuid)', 'execute')
  and not has_function_privilege('service_role', 'privado.finalizar_monitoria(uuid)', 'execute'),
  'service_role no finaliza: sin sesión no hay auth.uid() ni monitor');
select ok(
  not exists (
    select 1
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid in ('privado.finalizar_monitoria(uuid)'::regprocedure,
                    'privado.cerrar_monitorias_sin_finalizar(timestamptz)'::regprocedure,
                    'public.finalizar_monitoria(uuid)'::regprocedure,
                    'public.cierre_automatico_desde(timestamptz)'::regprocedure,
                    'public.parametros_negocio()'::regprocedure)
      and a.grantee = 0),
  'Nadie las hereda de PUBLIC');
select ok(
  has_function_privilege('authenticated', 'public.cierre_automatico_desde(timestamptz)', 'execute')
  and has_function_privilege('service_role', 'public.cierre_automatico_desde(timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.cierre_automatico_desde(timestamptz)', 'execute'),
  'cierre_automatico_desde la ejecutan quien tiene sesión y el servidor, y no el visitante sin ella');
select is((select cierre_automatico_min from public.parametros_negocio()), 1440,
  'D-14: parametros_negocio() trae cierre_automatico_min = 1440 (24 h)');
select ok(
  not has_any_column_privilege('anon', 'public.monitoria', 'update')
  and not has_any_column_privilege('authenticated', 'public.monitoria', 'update'),
  'Nadie con sesión actualiza monitoria: el monitor finaliza solo por la función security definer');
select is(
  (select count(*)::int from cron.job where jobname = 'calibra-cerrar-monitorias' and schedule = '*/15 * * * *'),
  1, 'D-14: existe un solo trabajo calibra-cerrar-monitorias en pg_cron, cada 15 minutos');
select matches(
  (select command from cron.job where jobname = 'calibra-cerrar-monitorias'),
  'privado\.cerrar_monitorias_sin_finalizar\(now\(\)\)',
  'El trabajo llama a privado.cerrar_monitorias_sin_finalizar con now()');

-- Sin permiso ni se ejecutan.
set local role anon;
select throws_ok($$select public.finalizar_monitoria('50000000-0000-0000-0000-000000002301')$$, '42501', null,
  'anon no puede llamar a finalizar_monitoria: permiso denegado');
reset role;
set local role service_role;
select throws_ok($$select public.finalizar_monitoria('50000000-0000-0000-0000-000000002301')$$, '42501', null,
  'service_role tampoco: no es un monitor');
reset role;
set local role authenticated;
select throws_ok($$select privado.cerrar_monitorias_sin_finalizar(now())$$, '42501', null,
  'Una sesión no puede correr el cierre automático: permiso denegado');
reset role;
set local role service_role;
select throws_ok($$select privado.cerrar_monitorias_sin_finalizar(now())$$, '42501', null,
  'service_role tampoco puede correr el cierre automático');
reset role;

-- ---------------------------------------------------------------------------
-- Fixtures (como postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, is_anonymous) values
  ('a0000000-0000-0000-0000-000000002301', false),
  ('b0000000-0000-0000-0000-0000000023a0', false),
  ('b0000000-0000-0000-0000-0000000023b0', false),
  ('c0000000-0000-0000-0000-000000002301', true);

insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-000000002301', 'Admin', 'admin23@calibra.test', 9002301);
insert into public.monitor (id, nombre) values
  ('b0000000-0000-0000-0000-0000000023a0', 'Ana 23'),
  ('b0000000-0000-0000-0000-0000000023b0', 'Beto 23');
insert into public.materia (id, nombre, codigo) values
  ('10000000-0000-0000-0000-0000000023a1', 'Materia 23 A', 'PGTAP-23-A');
insert into public.certificado (id_monitor, id_materia, id_admin) values
  ('b0000000-0000-0000-0000-0000000023a0', '10000000-0000-0000-0000-0000000023a1', 'a0000000-0000-0000-0000-000000002301'),
  ('b0000000-0000-0000-0000-0000000023b0', '10000000-0000-0000-0000-0000000023a1', 'a0000000-0000-0000-0000-000000002301');
insert into public.lead (id, id_sesion_anonima, nombre, correo, acepta_tratamiento_datos, fecha_consentimiento) values
  ('40000000-0000-0000-0000-000000002301', 'c0000000-0000-0000-0000-000000002301', 'Lead 23', 'lead23@calibra.test', true, now());

-- Cada caso: su inicio exacto, su duración y su estado. De ahí salen la franja (día, hora y duración), la fecha
-- de la monitoría y, si es grupal, su fila en monitoria_grupal.
create temporary table caso (
  nn text primary key,
  inicio timestamptz not null,
  duracion_min integer not null,
  estado public.estado_monitoria not null,
  motivo public.motivo_cancelacion,
  finalizada timestamptz,
  grupal boolean not null default false
);
insert into caso (nn, inicio, duracion_min, estado, motivo, finalizada, grupal) values
  -- Finalizar, con la hora real.
  ('01', now() - interval '2 hours', 60, 'confirmada', null, null, false),
  ('02', now(), 60, 'confirmada', null, null, false),
  ('03', now() + interval '1 microsecond', 60, 'confirmada', null, null, false),
  ('04', now() - interval '3 hours', 60, 'realizada', null, now() - interval '90 minutes', false),
  ('05', now() - interval '2 hours', 60, 'pendiente_pago', null, null, false),
  ('06', now() - interval '2 hours', 60, 'cancelada', 'estudiante', null, false),
  ('07', now() - interval '2 hours', 60, 'confirmada', null, null, true),
  ('08', now() - interval '2 hours', 60, 'confirmada', null, null, false),
  ('09', now() + interval '2 hours', 60, 'pendiente_pago', null, null, false),
  -- Cierre automático, con ahora = 10-mar-2020 12:00 en Bogotá.
  ('21', timestamptz '2020-03-10 12:00-05' - interval '24 hours' - interval '90 minutes', 90, 'confirmada', null, null, false),
  ('22', timestamptz '2020-03-10 12:00-05' - interval '24 hours' - interval '90 minutes' + interval '1 microsecond',
        90, 'confirmada', null, null, false),
  ('23', timestamptz '2020-03-10 12:00-05' - interval '4 days', 60, 'confirmada', null, null, false),
  ('24', timestamptz '2020-03-10 12:00-05' - interval '24 hours' - interval '60 minutes' - interval '1 microsecond',
        60, 'confirmada', null, null, false),
  ('25', timestamptz '2020-03-10 12:00-05' - interval '4 days', 60, 'pendiente_pago', null, null, false),
  ('26', timestamptz '2020-03-10 12:00-05' - interval '4 days', 60, 'cancelada', 'estudiante', null, false),
  ('27', timestamptz '2020-03-10 12:00-05' - interval '4 days', 60, 'realizada', null, timestamptz '2020-03-06 09:30-05', false),
  ('28', timestamptz '2020-03-10 12:00-05' - interval '4 days', 60, 'confirmada', null, null, true),
  ('29', timestamptz '2020-03-10 12:00-05' - interval '3 hours', 60, 'confirmada', null, null, false);

insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min, lugar, enlace, abierta_desde)
select ('30000000-0000-0000-0000-0000000023' || c.nn)::uuid, 'b0000000-0000-0000-0000-0000000023a0',
       extract(isodow from c.inicio at time zone 'America/Bogota')::smallint,
       (c.inicio at time zone 'America/Bogota')::time, false, 20000, c.duracion_min,
       null, 'https://meet.example/23-' || c.nn, (c.inicio at time zone 'America/Bogota')::date - 30
from caso c;

insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado, motivo_cancelacion, fecha_finalizacion)
select ('50000000-0000-0000-0000-0000000023' || c.nn)::uuid, ('30000000-0000-0000-0000-0000000023' || c.nn)::uuid,
       '10000000-0000-0000-0000-0000000023a1', '40000000-0000-0000-0000-000000002301',
       (c.inicio at time zone 'America/Bogota')::date, 20000, c.estado, c.motivo, c.finalizada
from caso c;

insert into public.monitoria_grupal (id_monitoria, cupos, modalidad_pago, precio_por_persona)
select ('50000000-0000-0000-0000-0000000023' || c.nn)::uuid, 3, 'dividido'::public.modalidad_pago, 15000
from caso c where c.grupal;

-- Control: cada monitoría empieza exactamente en el instante del caso (el de la base y el de la prueba coinciden),
-- las 18 existen y las dos grupales tienen su fila.
select ok(
  (select count(*) = 18 and bool_and(public.inicio_sesion(m.fecha, f.hora) = c.inicio)
   from caso c
   join public.monitoria m on m.id = ('50000000-0000-0000-0000-0000000023' || c.nn)::uuid
   join public.franja f on f.id = m.id_franja)
  and (select count(*) = 2 from public.monitoria_grupal where id_monitoria::text like '50000000-0000-0000-0000-0000000023%'),
  'Control: las 18 monitorías empiezan exactamente en su instante (a 2 h, justo ahora, a 1 microsegundo...) y hay dos grupales');

-- ---------------------------------------------------------------------------
-- D-13: solo el monitor de la monitoría la finaliza. Quien no lo es no puede, y no se dice por qué.
-- ---------------------------------------------------------------------------
-- La 08 es una confirmada que ya empezó, de A.
set local role authenticated;
set local request.jwt.claims to '{"role":"authenticated"}';
select is(
  (select public.finalizar_monitoria('50000000-0000-0000-0000-000000002308')),
  'sin_sesion', 'Sin sesión (el token no trae sub): sin_sesion');
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000002301","role":"authenticated","is_anonymous":true}';
select is(
  (select public.finalizar_monitoria('50000000-0000-0000-0000-000000002308')),
  'no_encontrada', 'Un Lead (aunque sea el de la monitoría) no la finaliza: no_encontrada');
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-000000002301","role":"authenticated"}';
select is(
  (select public.finalizar_monitoria('50000000-0000-0000-0000-000000002308')),
  'no_encontrada', 'Un admin tampoco: no_encontrada');
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000023b0","role":"authenticated"}';
select is(
  (select public.finalizar_monitoria('50000000-0000-0000-0000-000000002308')),
  'no_encontrada', 'Otro monitor (B) no finaliza la monitoría de A: no_encontrada');
select is(
  (select public.finalizar_monitoria('50000000-0000-0000-0000-000000002304')),
  'no_encontrada', 'Tampoco una ya realizada de A: B recibe no_encontrada y no ya_finalizada, para no revelar de quién es');
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000023a0","role":"authenticated"}';
select is(
  (select public.finalizar_monitoria('50000000-0000-0000-0000-000000002399')),
  'no_encontrada', 'Un id que no existe: no_encontrada');
select is(
  (select public.finalizar_monitoria(null)),
  'no_encontrada', 'Un id nulo: no_encontrada');
reset role;
select results_eq(
  $$select estado::text, fecha_finalizacion from public.monitoria where id = '50000000-0000-0000-0000-000000002308'$$,
  $$values ('confirmada'::text, null::timestamptz)$$,
  'Ninguna de esas llamadas cambió la monitoría: sigue confirmada y sin fecha_finalizacion');

-- ---------------------------------------------------------------------------
-- D-13 y P-40: el monitor finaliza una confirmada desde su inicio (con la hora exacta ya se puede)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000023a0","role":"authenticated"}';
select is(
  (select public.finalizar_monitoria('50000000-0000-0000-0000-000000002301')),
  'finalizada', 'D-13: el monitor finaliza su confirmada que empezó hace 2 h: finalizada');
reset role;
select results_eq(
  $$select estado::text, fecha_finalizacion = now() from public.monitoria where id = '50000000-0000-0000-0000-000000002301'$$,
  $$values ('realizada'::text, true)$$,
  'Quedó realizada y con fecha_finalizacion = now()');
set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000023a0","role":"authenticated"}';
select is(
  (select public.finalizar_monitoria('50000000-0000-0000-0000-000000002301')),
  'ya_finalizada', 'Un doble clic: la segunda vez ya_finalizada');

select is(
  (select public.finalizar_monitoria('50000000-0000-0000-0000-000000002302')),
  'finalizada', 'P-40: con el inicio exacto (inicio = now()) ya se puede finalizar');
reset role;
select results_eq(
  $$select estado::text, fecha_finalizacion = now() from public.monitoria where id = '50000000-0000-0000-0000-000000002302'$$,
  $$values ('realizada'::text, true)$$,
  'La del inicio exacto quedó realizada, con fecha_finalizacion = now()');

set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000023a0","role":"authenticated"}';
select is(
  (select public.finalizar_monitoria('50000000-0000-0000-0000-000000002303')),
  'no_empezo', 'P-40: un microsegundo antes del inicio todavía no se puede: no_empezo');
reset role;
select results_eq(
  $$select estado::text, fecha_finalizacion from public.monitoria where id = '50000000-0000-0000-0000-000000002303'$$,
  $$values ('confirmada'::text, null::timestamptz)$$,
  'La que no ha empezado no cambió: sigue confirmada y sin fecha_finalizacion');

-- Una grupal confirmada que ya empezó la finaliza su monitor, como una individual.
set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000023a0","role":"authenticated"}';
select is(
  (select public.finalizar_monitoria('50000000-0000-0000-0000-000000002307')),
  'finalizada', 'Una grupal confirmada que ya empezó también la finaliza su monitor');
reset role;
select results_eq(
  $$select estado::text, fecha_finalizacion = now() from public.monitoria where id = '50000000-0000-0000-0000-000000002307'$$,
  $$values ('realizada'::text, true)$$,
  'La grupal quedó realizada, con fecha_finalizacion = now()');

-- Después de que los intrusos probaron, el monitor de la 08 sí la finaliza.
set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000023a0","role":"authenticated"}';
select is(
  (select public.finalizar_monitoria('50000000-0000-0000-0000-000000002308')),
  'finalizada', 'Y su monitor sí finaliza la que los demás no pudieron');
reset role;
select results_eq(
  $$select estado::text, fecha_finalizacion = now() from public.monitoria where id = '50000000-0000-0000-0000-000000002308'$$,
  $$values ('realizada'::text, true)$$,
  'Quedó realizada, con fecha_finalizacion = now()');

-- ---------------------------------------------------------------------------
-- Lo que no hay que finalizar: ya realizada, por pagar, cancelada
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000023a0","role":"authenticated"}';
select is(
  (select public.finalizar_monitoria('50000000-0000-0000-0000-000000002304')),
  'ya_finalizada', 'Una ya realizada (otra vez sobre la misma): ya_finalizada');
select is(
  (select public.finalizar_monitoria('50000000-0000-0000-0000-000000002305')),
  'no_confirmada', 'Una por pagar cuyo inicio ya pasó: no_confirmada (todavía no hay sesión que finalizar)');
select is(
  (select public.finalizar_monitoria('50000000-0000-0000-0000-000000002306')),
  'no_confirmada', 'Una cancelada cuyo inicio ya pasó: no_confirmada');
select is(
  (select public.finalizar_monitoria('50000000-0000-0000-0000-000000002309')),
  'no_confirmada', 'Una por pagar que ni empezó: no_confirmada (el estado se revisa antes que la hora)');
reset role;
select results_eq(
  $$select estado::text, fecha_finalizacion = now() - interval '90 minutes'
    from public.monitoria where id = '50000000-0000-0000-0000-000000002304'$$,
  $$values ('realizada'::text, true)$$,
  'Volver a finalizar una realizada no le cambia su fecha_finalizacion (la de hace 90 minutos, no now())');
select results_eq(
  $$select right(id::text, 2), estado::text, fecha_finalizacion
    from public.monitoria where id in ('50000000-0000-0000-0000-000000002305', '50000000-0000-0000-0000-000000002306',
                                       '50000000-0000-0000-0000-000000002309')
    order by id$$,
  $$values ('05'::text, 'pendiente_pago'::text, null::timestamptz), ('06', 'cancelada', null), ('09', 'pendiente_pago', null)$$,
  'La por pagar y la cancelada no cambiaron: siguen en su estado y sin fecha_finalizacion');

-- ---------------------------------------------------------------------------
-- D-14: public.cierre_automatico_desde(fin) = fin + 24 h
-- ---------------------------------------------------------------------------
select is(
  public.cierre_automatico_desde('2020-03-10 10:30-05'), '2020-03-11 10:30-05'::timestamptz,
  'D-14: el cierre automático empieza 24 h después del fin programado');
select is(
  public.cierre_automatico_desde(timestamptz '2020-03-10 10:30-05' + interval '1 microsecond'),
  timestamptz '2020-03-11 10:30-05' + interval '1 microsecond',
  'Sin redondear: conserva el microsegundo');
select is(
  public.cierre_automatico_desde('2020-03-10 10:30-05'),
  timestamptz '2020-03-10 10:30-05' + (select make_interval(mins => p.cierre_automatico_min) from public.parametros_negocio() p),
  'Es el fin más cierre_automatico_min de parametros_negocio(): el plazo no está escrito dos veces');
select is(public.cierre_automatico_desde(null), null::timestamptz,
  'Sin fin programado no hay cierre (la función es estricta)');
set local role authenticated;
select is(public.cierre_automatico_desde('2020-03-10 10:30-05'), '2020-03-11 10:30-05'::timestamptz,
  'Una sesión la puede llamar (el panel del monitor muestra desde cuándo se cierra sola)');
reset role;
set local role service_role;
select is(public.cierre_automatico_desde('2020-03-10 10:30-05'), '2020-03-11 10:30-05'::timestamptz,
  'El servidor también');
reset role;
set local role anon;
select throws_ok($$select public.cierre_automatico_desde('2020-03-10 10:30-05')$$, '42501', null,
  'anon no puede llamarla: permiso denegado');
reset role;

-- ---------------------------------------------------------------------------
-- D-14: el cierre automático, con ahora = martes 10-mar-2020 12:00 en Bogotá
-- ---------------------------------------------------------------------------
select is(
  (select privado.cerrar_monitorias_sin_finalizar('2020-03-10 12:00-05')),
  3, 'D-14: devuelve cuántas cerró: tres (la del borde exacto, la de hace 4 días y la de un microsegundo antes)');
select results_eq(
  $$select estado::text, fecha_finalizacion = timestamptz '2020-03-10 12:00-05'
    from public.monitoria where id = '50000000-0000-0000-0000-000000002321'$$,
  $$values ('realizada'::text, true)$$,
  'P-40: con fin + 24 h exactamente igual a ahora, la individual confirmada se cierra (borde inclusivo), con fecha_finalizacion = ahora');
select results_eq(
  $$select estado::text, fecha_finalizacion from public.monitoria where id = '50000000-0000-0000-0000-000000002322'$$,
  $$values ('confirmada'::text, null::timestamptz)$$,
  'Con fin + 24 h un microsegundo después de ahora todavía no se cierra (y cuenta desde el fin, no desde el inicio)');
select results_eq(
  $$select right(id::text, 2), estado::text, fecha_finalizacion = timestamptz '2020-03-10 12:00-05'
    from public.monitoria where id in ('50000000-0000-0000-0000-000000002323', '50000000-0000-0000-0000-000000002324')
    order by id$$,
  $$values ('23'::text, 'realizada'::text, true), ('24', 'realizada', true)$$,
  'Las de días atrás y la de un microsegundo antes se cierran, con fecha_finalizacion = ahora (el momento del cierre, no el fin)');
select results_eq(
  $$select right(id::text, 2), estado::text, fecha_finalizacion
    from public.monitoria where id in ('50000000-0000-0000-0000-000000002325', '50000000-0000-0000-0000-000000002326')
    order by id$$,
  $$values ('25'::text, 'pendiente_pago'::text, null::timestamptz), ('26', 'cancelada', null)$$,
  'Las por pagar y las canceladas no se tocan, por vencidas que estén');
select results_eq(
  $$select estado::text, fecha_finalizacion from public.monitoria where id = '50000000-0000-0000-0000-000000002327'$$,
  $$values ('realizada'::text, timestamptz '2020-03-06 09:30-05')$$,
  'La ya realizada conserva su fecha_finalizacion: el cierre no la reescribe');
select results_eq(
  $$select estado::text, fecha_finalizacion from public.monitoria where id = '50000000-0000-0000-0000-000000002328'$$,
  $$values ('confirmada'::text, null::timestamptz)$$,
  'D-14: una grupal confirmada vencida NO se cierra sola: su monitor finaliza y entrega el enlace de reseña (RN-71)');
select results_eq(
  $$select estado::text, fecha_finalizacion from public.monitoria where id = '50000000-0000-0000-0000-000000002329'$$,
  $$values ('confirmada'::text, null::timestamptz)$$,
  'Una confirmada que terminó hace 2 h todavía está dentro de las 24 h: no se cierra');
select is(
  (select count(*)::int from public.monitoria
   where id::text like '50000000-0000-0000-0000-00000000230%' and id <> '50000000-0000-0000-0000-000000002304'
     and estado = 'realizada' and fecha_finalizacion <> now()),
  0, 'El cierre de la fecha de 2020 no tocó las monitorías de la parte de finalizar (las de now())');

-- Segunda corrida: nada cambia.
create temporary table despues_1 as
select id, estado::text as estado, fecha_finalizacion
from public.monitoria where id::text like '50000000-0000-0000-0000-0000000023%';
select is(
  (select privado.cerrar_monitorias_sin_finalizar('2020-03-10 12:00-05')),
  0, 'Correrla otra vez con el mismo ahora devuelve 0: no hay nada más que cerrar');
select results_eq(
  $$select id, estado::text, fecha_finalizacion from public.monitoria
    where id::text like '50000000-0000-0000-0000-0000000023%' order by id$$,
  $$select id, estado, fecha_finalizacion from despues_1 order by id$$,
  'Y la segunda corrida no cambia ninguna monitoría ni ninguna fecha_finalizacion');
select is(
  (select privado.cerrar_monitorias_sin_finalizar('2020-03-10 12:00-05'::timestamptz + interval '1 microsecond')),
  1, 'Un microsegundo después de ahora se cierra la 22 (la del borde de 1 microsegundo) y ninguna otra');
select results_eq(
  $$select estado::text, fecha_finalizacion = timestamptz '2020-03-10 12:00-05' + interval '1 microsecond'
    from public.monitoria where id = '50000000-0000-0000-0000-000000002322'$$,
  $$values ('realizada'::text, true)$$,
  'La 22 quedó realizada, con fecha_finalizacion = el ahora de esa corrida');

-- El monitor que llega tarde: el cierre se le adelantó.
set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000023a0","role":"authenticated"}';
select is(
  (select public.finalizar_monitoria('50000000-0000-0000-0000-000000002321')),
  'ya_finalizada', 'Si el cierre automático se adelantó, el monitor recibe ya_finalizada');
reset role;
select results_eq(
  $$select estado::text, fecha_finalizacion = timestamptz '2020-03-10 12:00-05'
    from public.monitoria where id = '50000000-0000-0000-0000-000000002321'$$,
  $$values ('realizada'::text, true)$$,
  'Y la fecha_finalizacion sigue siendo la del cierre automático');
set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000023a0","role":"authenticated"}';
select is(
  (select public.finalizar_monitoria('50000000-0000-0000-0000-000000002328')),
  'finalizada', 'La grupal que el cierre no tocó la finaliza su monitor cuando quiera (ya empezó)');
reset role;

select * from finish();
rollback;
