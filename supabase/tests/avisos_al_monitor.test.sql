-- Pruebas pgTAP de los avisos por correo al monitor (HU-051, D-16).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.
--
-- Qué cubre la migración 20261001071311_avisos_al_monitor.sql:
--   * public.aviso_monitor, la bandeja de salida de los avisos: RLS sin políticas y permisos mínimos. Nadie con sesión
--     (anon, authenticated) la toca; service_role (la llave secreta de la app) solo lee y marca `procesado_en` e `intentos`.
--   * El trigger monitoria_anota_aviso_monitor (privado.anotar_aviso_monitor): anota el aviso en la misma transacción
--     del cambio de estado, solo para las individuales y solo en cuatro transiciones:
--       pendiente_pago -> confirmada                           aviso 'confirmada'
--       confirmada -> cancelada con motivo `estudiante`        aviso 'cancelada'
--       confirmada -> cancelada con motivo `pago_rechazado`    aviso 'pago_rechazado' (D-38, HU-076)
--       confirmada o realizada -> cancelada con motivo `monitor_no_asistio`   aviso 'inasistencia_aceptada' (D-37, HU-030)
--     Nada para las grupales, para las otras transiciones, para otros motivos ni cuando el estado no cambia. Un
--     mismo aviso no se anota dos veces (on conflict do nothing sobre id_monitoria + evento).
--   * privado.disparar_avisos_monitor: le pide a la app que procese los avisos solo si hay pendientes y Vault trae
--     `calibra_sitio_url` y `calibra_cron_secreto`; si no, devuelve null y no falla (así en local). Con la
--     configuración dentro de la transacción de la prueba, pg_net solo encola la petición y el rollback la descarta.
--   * public.datos_de_aviso_monitor: lo que la app necesita para escribir el correo (security invoker, solo
--     service_role). Trae el correo del monitor y, del estudiante, solo el nombre (P-37).
--   * El trabajo de pg_cron calibra-avisar-monitores, cada 5 minutos.
-- Las monitorías se insertan como postgres: el trigger completa id_monitor desde la franja y exige que la fecha caiga en
-- el día de la franja (todas son el lunes 1-mar-2027, muy en el futuro: ningún trabajo de pg_cron las toca). Una
-- cancelada exige motivo y una realizada, fecha_finalizacion.
--
-- Elenco (todos los ids terminan en 51NN; las materias son 'PGTAP-51-A' y 'PGTAP-51-B'):
--   Monitores: A (dicta la materia A) y B (la materia B), cada uno con su correo en monitor_privado. Admin 01.
--   Leads: 01 (Lucía) y 02 (Mateo), cada uno con su sesión anónima y datos de contacto que el aviso no debe traer.
--   Monitorías (cada una con su franja; las insertadas como confirmada no disparan nada: el trigger es de UPDATE):
--     01 por pagar: se confirma y luego la cancela el estudiante   02 confirmada: la cancela el estudiante
--     03, 04 y 05 confirmadas: se cancelan por pago_rechazado (avisa), monitor_no_asistio (avisa, HU-030) y
--     diferencia_no_cubierta
--     06, 07 y 08 por pagar: se cancelan por reserva_expirada, pago_rechazado y estudiante
--     09 confirmada: se realiza y después se cancela por monitor_no_asistio (avisa, HU-030)   10 grupal por pagar: se confirma   11 grupal confirmada: la cancela el estudiante
--     12 confirmada: updates que no cambian el estado   13 por pagar: se confirma, vuelve atrás y se confirma otra vez
--     14 confirmada presencial (75 min, monitor A) y 15 confirmada virtual (45 min, monitor B, materia B), para los datos

begin;
create extension if not exists pgtap with schema extensions;

select plan(92);

-- ---------------------------------------------------------------------------
-- La tabla: RLS sin políticas y permisos mínimos
-- ---------------------------------------------------------------------------
select has_table('public', 'aviso_monitor', 'Existe public.aviso_monitor, la bandeja de salida de los avisos al monitor');
select columns_are('public', 'aviso_monitor', array['id', 'id_monitoria', 'evento', 'creado_en', 'procesado_en', 'intentos'],
  'Sus columnas son el id, la monitoría, el evento, cuándo se anotó, cuándo la app lo procesó y cuántas corridas fallaron');
select ok((select relrowsecurity from pg_class where oid = 'public.aviso_monitor'::regclass),
  'RLS está activo en aviso_monitor');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'aviso_monitor'), 0,
  'Sin políticas: RLS le niega todo a anon y authenticated (el trigger inserta como security definer y la app usa la llave secreta)');
select ok(
  not exists (
    select 1
    from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where c.oid = 'public.aviso_monitor'::regclass and a.grantee = 0),
  'Nadie la hereda de PUBLIC');

-- anon y authenticated: ningún permiso, ni de tabla ni de columna.
select ok(
  not has_any_column_privilege('anon', 'public.aviso_monitor', 'select')
  and not has_any_column_privilege('anon', 'public.aviso_monitor', 'insert')
  and not has_any_column_privilege('anon', 'public.aviso_monitor', 'update')
  and not has_any_column_privilege('anon', 'public.aviso_monitor', 'references')
  and not has_table_privilege('anon', 'public.aviso_monitor', 'delete')
  and not has_table_privilege('anon', 'public.aviso_monitor', 'truncate')
  and not has_table_privilege('anon', 'public.aviso_monitor', 'trigger'),
  'anon no tiene ningún permiso sobre aviso_monitor');
select ok(
  not has_any_column_privilege('authenticated', 'public.aviso_monitor', 'select')
  and not has_any_column_privilege('authenticated', 'public.aviso_monitor', 'insert')
  and not has_any_column_privilege('authenticated', 'public.aviso_monitor', 'update')
  and not has_any_column_privilege('authenticated', 'public.aviso_monitor', 'references')
  and not has_table_privilege('authenticated', 'public.aviso_monitor', 'delete')
  and not has_table_privilege('authenticated', 'public.aviso_monitor', 'truncate')
  and not has_table_privilege('authenticated', 'public.aviso_monitor', 'trigger'),
  'authenticated tampoco tiene ninguno: ni el monitor ni el estudiante ni un admin leen ni escriben los avisos');

-- service_role: leer, y de columnas solo marcar procesado_en e intentos.
select ok(has_table_privilege('service_role', 'public.aviso_monitor', 'select'),
  'service_role lee aviso_monitor (la app busca los pendientes)');
select ok(has_column_privilege('service_role', 'public.aviso_monitor', 'procesado_en', 'update')
  and has_column_privilege('service_role', 'public.aviso_monitor', 'intentos', 'update'),
  'service_role actualiza procesado_en e intentos (marca el aviso como procesado o cuenta una corrida fallida)');
select ok(
  not has_column_privilege('service_role', 'public.aviso_monitor', 'id', 'update')
  and not has_column_privilege('service_role', 'public.aviso_monitor', 'id_monitoria', 'update')
  and not has_column_privilege('service_role', 'public.aviso_monitor', 'evento', 'update')
  and not has_column_privilege('service_role', 'public.aviso_monitor', 'creado_en', 'update')
  and not has_table_privilege('service_role', 'public.aviso_monitor', 'update'),
  'Pero ninguna otra columna: el id, la monitoría, el evento y creado_en no se reescriben');
select ok(
  not has_any_column_privilege('service_role', 'public.aviso_monitor', 'insert')
  and not has_table_privilege('service_role', 'public.aviso_monitor', 'delete')
  and not has_table_privilege('service_role', 'public.aviso_monitor', 'truncate')
  and not has_any_column_privilege('service_role', 'public.aviso_monitor', 'references')
  and not has_table_privilege('service_role', 'public.aviso_monitor', 'trigger'),
  'service_role no inserta, no borra, no trunca: los avisos los anota solo el trigger');

-- Y la prueba de que se aplica de verdad (sin filas todavía: el permiso se revisa antes que RLS).
set local role anon;
select throws_ok($$select * from public.aviso_monitor$$, '42501', null, 'anon no puede leer aviso_monitor: permiso denegado');
select throws_ok($$insert into public.aviso_monitor (id_monitoria, evento) values ('50000000-0000-0000-0000-000000005199', 'confirmada')$$,
  '42501', null, 'anon no puede insertar un aviso');
select throws_ok($$update public.aviso_monitor set procesado_en = now()$$, '42501', null,
  'anon no puede actualizar avisos');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000051a0","role":"authenticated"}';
select throws_ok($$select * from public.aviso_monitor$$, '42501', null,
  'Una sesión (aunque sea la de un monitor) no puede leer aviso_monitor: permiso denegado');
select throws_ok($$insert into public.aviso_monitor (id_monitoria, evento) values ('50000000-0000-0000-0000-000000005199', 'confirmada')$$,
  '42501', null, 'Una sesión no puede insertar un aviso');
select throws_ok($$update public.aviso_monitor set procesado_en = now()$$, '42501', null,
  'Una sesión no puede marcar avisos como procesados');
select throws_ok($$delete from public.aviso_monitor$$, '42501', null,
  'Una sesión no puede borrar avisos');
reset role;

-- ---------------------------------------------------------------------------
-- Las funciones y el trigger: definición y permisos
-- ---------------------------------------------------------------------------
select has_function('privado', 'anotar_aviso_monitor', '{}'::name[],
  'Existe privado.anotar_aviso_monitor, la del trigger');
select has_function('privado', 'disparar_avisos_monitor', '{}'::name[],
  'Existe privado.disparar_avisos_monitor, la que le pide a la app procesar los avisos');
select has_function('public', 'datos_de_aviso_monitor', array['uuid'],
  'Existe public.datos_de_aviso_monitor(uuid), lo que la app necesita para escribir el correo');
select ok(
  (select prosecdef from pg_proc where oid = 'privado.anotar_aviso_monitor()'::regprocedure)
  and (select prosecdef from pg_proc where oid = 'privado.disparar_avisos_monitor()'::regprocedure)
  and not (select prosecdef from pg_proc where oid = 'public.datos_de_aviso_monitor(uuid)'::regprocedure),
  'Las de privado son security definer (escriben aviso_monitor y leen Vault); datos_de_aviso_monitor corre con los permisos de quien llama');
select ok(
  (select bool_and('search_path=""' = any(proconfig)) from pg_proc
   where oid in ('privado.anotar_aviso_monitor()'::regprocedure,
                 'privado.disparar_avisos_monitor()'::regprocedure,
                 'public.datos_de_aviso_monitor(uuid)'::regprocedure)),
  'Las tres fijan un search_path vacío');
select is(
  array[pg_get_function_result('privado.anotar_aviso_monitor()'::regprocedure),
        pg_get_function_result('privado.disparar_avisos_monitor()'::regprocedure)],
  array['trigger', 'bigint'],
  'La del trigger devuelve trigger y la que pide el procesamiento, el id de la petición de pg_net (bigint)');
select is(
  (select array_agg(a.n order by a.o)
   from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as a(n, m, o)
   where p.oid = 'public.datos_de_aviso_monitor(uuid)'::regprocedure and a.m = 't'),
  array['estado', 'motivo_cancelacion', 'grupal', 'correo_monitor', 'nombre_monitor', 'nombre_estudiante', 'nombre_materia',
        'inicio', 'duracion_min', 'presencial'],
  'datos_de_aviso_monitor devuelve estado, motivo, si es grupal, correo y nombre del monitor, nombre del estudiante, materia, inicio, duración y modalidad');

select has_trigger('public', 'monitoria', 'monitoria_anota_aviso_monitor',
  'monitoria tiene el trigger monitoria_anota_aviso_monitor');
select trigger_is('public', 'monitoria', 'monitoria_anota_aviso_monitor', 'privado', 'anotar_aviso_monitor',
  'El trigger llama a privado.anotar_aviso_monitor');
select matches(
  (select pg_get_triggerdef(t.oid) from pg_trigger t
   where t.tgrelid = 'public.monitoria'::regclass and t.tgname = 'monitoria_anota_aviso_monitor'),
  'AFTER UPDATE OF estado ON public\.monitoria FOR EACH ROW',
  'Corre después de cambiar el estado, por fila (el aviso sale de la misma transacción del cambio)');

-- Nadie ejecuta las de privado: ni anon, ni una sesión, ni la llave secreta.
select ok(
  not has_function_privilege('anon', 'privado.anotar_aviso_monitor()', 'execute')
  and not has_function_privilege('authenticated', 'privado.anotar_aviso_monitor()', 'execute')
  and not has_function_privilege('service_role', 'privado.anotar_aviso_monitor()', 'execute'),
  'Ni anon, ni authenticated, ni service_role ejecutan privado.anotar_aviso_monitor: solo la dispara el trigger');
select ok(
  not has_function_privilege('anon', 'privado.disparar_avisos_monitor()', 'execute')
  and not has_function_privilege('authenticated', 'privado.disparar_avisos_monitor()', 'execute')
  and not has_function_privilege('service_role', 'privado.disparar_avisos_monitor()', 'execute'),
  'Ni anon, ni authenticated, ni service_role ejecutan privado.disparar_avisos_monitor: solo el trigger y pg_cron');
select ok(
  not exists (
    select 1
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid in ('privado.anotar_aviso_monitor()'::regprocedure,
                    'privado.disparar_avisos_monitor()'::regprocedure,
                    'public.datos_de_aviso_monitor(uuid)'::regprocedure)
      and a.grantee = 0),
  'Nadie las hereda de PUBLIC');
select ok(
  has_function_privilege('service_role', 'public.datos_de_aviso_monitor(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.datos_de_aviso_monitor(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.datos_de_aviso_monitor(uuid)', 'execute'),
  'datos_de_aviso_monitor solo la ejecuta service_role: ni anon ni una sesión (trae el correo del monitor)');

set local role anon;
select throws_ok($$select privado.disparar_avisos_monitor()$$, '42501', null,
  'anon no puede pedir el procesamiento de avisos: permiso denegado');
reset role;
set local role authenticated;
select throws_ok($$select privado.disparar_avisos_monitor()$$, '42501', null,
  'Una sesión tampoco: permiso denegado');
reset role;
set local role service_role;
select throws_ok($$select privado.disparar_avisos_monitor()$$, '42501', null,
  'service_role tampoco: lo pide el trigger o pg_cron, no la app');
reset role;

-- El trabajo de pg_cron: repite el pedido cada 5 minutos por si una petición se perdió.
select is(
  (select count(*)::int from cron.job where jobname = 'calibra-avisar-monitores'), 1,
  'Existe un solo trabajo calibra-avisar-monitores en pg_cron (reaplicar la migración no lo duplica)');
select results_eq(
  $$select schedule, command, active from cron.job where jobname = 'calibra-avisar-monitores'$$,
  $$values ('*/5 * * * *'::text, 'select privado.disparar_avisos_monitor()'::text, true)$$,
  'Corre cada 5 minutos, activo, y llama a privado.disparar_avisos_monitor()');

-- ---------------------------------------------------------------------------
-- Fixtures (como postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, is_anonymous) values
  ('a0000000-0000-0000-0000-000000005101', false),
  ('b0000000-0000-0000-0000-0000000051a0', false),
  ('b0000000-0000-0000-0000-0000000051b0', false),
  ('c0000000-0000-0000-0000-000000005101', true),
  ('c0000000-0000-0000-0000-000000005102', true);

insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-000000005101', 'Admin', 'admin51@calibra.test', 9005101);
insert into public.monitor (id, nombre) values
  ('b0000000-0000-0000-0000-0000000051a0', 'Ana 51'),
  ('b0000000-0000-0000-0000-0000000051b0', 'Beto 51');
insert into public.monitor_privado (id_monitor, numero_telefono, correo, llave) values
  ('b0000000-0000-0000-0000-0000000051a0', '3005100001', 'ana.monitora51@calibra.test', 'llave-ana-51'),
  ('b0000000-0000-0000-0000-0000000051b0', '3005100002', 'beto.monitor51@calibra.test', 'llave-beto-51');
insert into public.materia (id, nombre, codigo) values
  ('10000000-0000-0000-0000-0000000051a1', 'Materia 51 A', 'PGTAP-51-A'),
  ('10000000-0000-0000-0000-0000000051b1', 'Materia 51 B', 'PGTAP-51-B');
insert into public.certificado (id_monitor, id_materia, id_admin) values
  ('b0000000-0000-0000-0000-0000000051a0', '10000000-0000-0000-0000-0000000051a1', 'a0000000-0000-0000-0000-000000005101'),
  ('b0000000-0000-0000-0000-0000000051b0', '10000000-0000-0000-0000-0000000051b1', 'a0000000-0000-0000-0000-000000005101');
insert into public.lead (id, id_sesion_anonima, nombre, numero_telefono, correo, acepta_tratamiento_datos, fecha_consentimiento) values
  ('40000000-0000-0000-0000-000000005101', 'c0000000-0000-0000-0000-000000005101', 'Lucía Prueba 51', '3005101111',
   'lucia.secreta51@calibra.test', true, now()),
  ('40000000-0000-0000-0000-000000005102', 'c0000000-0000-0000-0000-000000005102', 'Mateo Prueba 51', '3005102222',
   'mateo.secreto51@calibra.test', true, now());

-- Una franja por monitoría, todas los lunes a las 9:30 en Bogotá. La 14 es presencial (75 min); la 15, de B (45 min);
-- las demás, virtuales de 60 min.
insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min, lugar, enlace, abierta_desde)
select ('30000000-0000-0000-0000-0000000051' || nn)::uuid,
       case when nn = '15' then 'b0000000-0000-0000-0000-0000000051b0'::uuid else 'b0000000-0000-0000-0000-0000000051a0'::uuid end,
       smallint '1', time '09:30', nn = '14', 20000,
       case nn when '14' then 75 when '15' then 45 else 60 end,
       case when nn = '14' then 'Salón 51' end,
       case when nn <> '14' then 'https://meet.example/51-' || nn end,
       date '2026-01-01'
from unnest(array['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15']) as nn;

-- Monitorías del lunes 1-mar-2027. Las insertadas como confirmada no anotan aviso: el trigger es de UPDATE.
insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado)
select ('50000000-0000-0000-0000-0000000051' || v.nn)::uuid, ('30000000-0000-0000-0000-0000000051' || v.nn)::uuid,
       case when v.nn = '15' then '10000000-0000-0000-0000-0000000051b1'::uuid else '10000000-0000-0000-0000-0000000051a1'::uuid end,
       case when v.nn in ('02', '15') then '40000000-0000-0000-0000-000000005102'::uuid
            else '40000000-0000-0000-0000-000000005101'::uuid end,
       date '2027-03-01', 20000, v.estado
from (values
  ('01', 'pendiente_pago'::public.estado_monitoria), ('02', 'confirmada'), ('03', 'confirmada'), ('04', 'confirmada'),
  ('05', 'confirmada'), ('06', 'pendiente_pago'), ('07', 'pendiente_pago'), ('08', 'pendiente_pago'),
  ('09', 'confirmada'), ('10', 'pendiente_pago'), ('11', 'confirmada'), ('12', 'confirmada'),
  ('13', 'pendiente_pago'), ('14', 'confirmada'), ('15', 'confirmada')) as v(nn, estado);

-- Las grupales: la 10 (por pagar) y la 11 (confirmada).
insert into public.monitoria_grupal (id_monitoria, cupos, modalidad_pago, precio_por_persona) values
  ('50000000-0000-0000-0000-000000005110', 3, 'dividido', 15000),
  ('50000000-0000-0000-0000-000000005111', 3, 'dividido', 15000);

-- Control: las 15 monitorías existen (una de ellas con otro monitor), las dos grupales tienen su fila y, como solo
-- se insertaron, ninguna anotó un aviso (el trigger es de UPDATE OF estado).
select ok(
  (select count(*) = 15 from public.monitoria where id::text like '50000000-0000-0000-0000-0000000051%')
  and (select count(*) = 2 from public.monitoria_grupal where id_monitoria::text like '50000000-0000-0000-0000-0000000051%')
  and (select id_monitor = 'b0000000-0000-0000-0000-0000000051b0' from public.monitoria
       where id = '50000000-0000-0000-0000-000000005115'),
  'Control: las 15 monitorías existen (la 15 es del monitor B) y hay dos grupales');
select is(
  (select count(*)::int from public.aviso_monitor where id_monitoria::text like '50000000-0000-0000-0000-0000000051%'),
  0, 'Insertar monitorías (aunque entren confirmadas) no anota ningún aviso: el trigger es solo de UPDATE OF estado');

-- ---------------------------------------------------------------------------
-- El trigger: pendiente_pago -> confirmada anota un aviso 'confirmada'
-- ---------------------------------------------------------------------------
update public.monitoria set estado = 'confirmada' where id = '50000000-0000-0000-0000-000000005101';
select results_eq(
  $$select evento, procesado_en is null, creado_en = now()
    from public.aviso_monitor where id_monitoria = '50000000-0000-0000-0000-000000005101'$$,
  $$values ('confirmada'::text, true, true)$$,
  'pendiente_pago -> confirmada anota exactamente un aviso confirmada, sin procesar (procesado_en null) y creado en esa transacción');

-- confirmada -> cancelada por el estudiante: avisa 'cancelada' (y el de 'confirmada' queda como estaba).
update public.monitoria set estado = 'cancelada', motivo_cancelacion = 'estudiante'
where id = '50000000-0000-0000-0000-000000005101';
select results_eq(
  $$select evento, procesado_en is null from public.aviso_monitor
    where id_monitoria = '50000000-0000-0000-0000-000000005101' order by evento$$,
  $$values ('cancelada'::text, true), ('confirmada', true)$$,
  'confirmada -> cancelada por el estudiante anota el aviso cancelada, además del confirmada que ya estaba');

update public.monitoria set estado = 'cancelada', motivo_cancelacion = 'estudiante'
where id = '50000000-0000-0000-0000-000000005102';
select results_eq(
  $$select evento, procesado_en is null from public.aviso_monitor where id_monitoria = '50000000-0000-0000-0000-000000005102'$$,
  $$values ('cancelada'::text, true)$$,
  'Una confirmada que cancela el estudiante anota solo cancelada (nunca hubo aviso de confirmada: se insertó confirmada)');

-- ---------------------------------------------------------------------------
-- El trigger: lo que no se avisa
-- ---------------------------------------------------------------------------
update public.monitoria set estado = 'cancelada', motivo_cancelacion = 'pago_rechazado'
where id = '50000000-0000-0000-0000-000000005103';
select results_eq(
  $$select evento, procesado_en is null from public.aviso_monitor where id_monitoria = '50000000-0000-0000-0000-000000005103'$$,
  $$values ('pago_rechazado'::text, true)$$,
  'confirmada -> cancelada por pago_rechazado anota el aviso pago_rechazado (HU-076, D-38); monitor_no_asistio también (abajo) y los demás motivos siguen sin avisar');
update public.monitoria set estado = 'cancelada', motivo_cancelacion = 'monitor_no_asistio'
where id = '50000000-0000-0000-0000-000000005104';
select results_eq(
  $$select evento, procesado_en is null from public.aviso_monitor where id_monitoria = '50000000-0000-0000-0000-000000005104'$$,
  $$values ('inasistencia_aceptada'::text, true)$$,
  'confirmada -> cancelada por monitor_no_asistio anota el aviso inasistencia_aceptada (D-37, HU-030)');
update public.monitoria set estado = 'cancelada', motivo_cancelacion = 'diferencia_no_cubierta'
where id = '50000000-0000-0000-0000-000000005105';
select is(
  (select count(*)::int from public.aviso_monitor where id_monitoria = '50000000-0000-0000-0000-000000005105'),
  0, 'confirmada -> cancelada por diferencia_no_cubierta no anota nada');

update public.monitoria set estado = 'cancelada', motivo_cancelacion = 'reserva_expirada'
where id = '50000000-0000-0000-0000-000000005106';
select is(
  (select count(*)::int from public.aviso_monitor where id_monitoria = '50000000-0000-0000-0000-000000005106'),
  0, 'pendiente_pago -> cancelada por reserva_expirada no anota nada: las reservas por pagar nunca se avisaron');
update public.monitoria set estado = 'cancelada', motivo_cancelacion = 'pago_rechazado'
where id = '50000000-0000-0000-0000-000000005107';
select is(
  (select count(*)::int from public.aviso_monitor where id_monitoria = '50000000-0000-0000-0000-000000005107'),
  0, 'pendiente_pago -> cancelada por pago_rechazado no anota nada');
update public.monitoria set estado = 'cancelada', motivo_cancelacion = 'estudiante'
where id = '50000000-0000-0000-0000-000000005108';
select is(
  (select count(*)::int from public.aviso_monitor where id_monitoria = '50000000-0000-0000-0000-000000005108'),
  0, 'pendiente_pago -> cancelada aunque sea por el estudiante no anota nada: el monitor nunca supo de esa reserva');

update public.monitoria set estado = 'realizada', fecha_finalizacion = timestamptz '2027-03-01 11:00-05'
where id = '50000000-0000-0000-0000-000000005109';
select is(
  (select count(*)::int from public.aviso_monitor where id_monitoria = '50000000-0000-0000-0000-000000005109'),
  0, 'confirmada -> realizada no anota nada');
-- HU-030 (RN-65): el reporte de inasistencia aceptado cancela también una monitoría ya realizada, y el monitor se entera.
update public.monitoria set estado = 'cancelada', motivo_cancelacion = 'monitor_no_asistio'
where id = '50000000-0000-0000-0000-000000005109';
select results_eq(
  $$select evento, procesado_en is null from public.aviso_monitor where id_monitoria = '50000000-0000-0000-0000-000000005109'$$,
  $$values ('inasistencia_aceptada'::text, true)$$,
  'realizada -> cancelada por monitor_no_asistio anota el aviso inasistencia_aceptada (RN-65, HU-030)');

-- Las grupales no se avisan en esta HU.
update public.monitoria set estado = 'confirmada' where id = '50000000-0000-0000-0000-000000005110';
select is(
  (select count(*)::int from public.aviso_monitor where id_monitoria = '50000000-0000-0000-0000-000000005110'),
  0, 'Una grupal que pasa de pendiente_pago a confirmada no anota nada: sus avisos llegan con sus HUs');
update public.monitoria set estado = 'cancelada', motivo_cancelacion = 'estudiante'
where id = '50000000-0000-0000-0000-000000005111';
select is(
  (select count(*)::int from public.aviso_monitor where id_monitoria = '50000000-0000-0000-0000-000000005111'),
  0, 'Una grupal confirmada que cancela el estudiante tampoco anota nada');

-- Un UPDATE que no cambia el estado no anota nada (el trigger lleva when old.estado is distinct from new.estado).
update public.monitoria set valor_total = 25000 where id = '50000000-0000-0000-0000-000000005112';
update public.monitoria set estado = 'confirmada' where id = '50000000-0000-0000-0000-000000005112';
select is(
  (select count(*)::int from public.aviso_monitor where id_monitoria = '50000000-0000-0000-0000-000000005112'),
  0, 'Un UPDATE que no cambia el estado (otro campo, o el mismo estado) no anota nada');

-- Un mismo aviso no se anota dos veces: la 13 se confirma, la app lo procesa, vuelve atrás y se confirma otra vez.
update public.monitoria set estado = 'confirmada' where id = '50000000-0000-0000-0000-000000005113';
update public.aviso_monitor set procesado_en = timestamptz '2027-03-01 08:00-05'
where id_monitoria = '50000000-0000-0000-0000-000000005113';
update public.monitoria set estado = 'pendiente_pago' where id = '50000000-0000-0000-0000-000000005113';
select is(
  (select count(*)::int from public.aviso_monitor where id_monitoria = '50000000-0000-0000-0000-000000005113'),
  1, 'Volver de confirmada a pendiente_pago no anota ni borra nada: sigue el único aviso');
update public.monitoria set estado = 'confirmada' where id = '50000000-0000-0000-0000-000000005113';
select results_eq(
  $$select evento, procesado_en from public.aviso_monitor where id_monitoria = '50000000-0000-0000-0000-000000005113'$$,
  $$values ('confirmada'::text, timestamptz '2027-03-01 08:00-05')$$,
  'Confirmarla otra vez no duplica el aviso (on conflict do nothing) ni le borra su procesado_en');

-- Resumen: de todo lo anterior solo quedaron siete avisos.
select set_eq(
  $$select right(id_monitoria::text, 2), evento from public.aviso_monitor
    where id_monitoria::text like '50000000-0000-0000-0000-0000000051%'$$,
  $$values ('01'::text, 'confirmada'::text), ('01', 'cancelada'), ('02', 'cancelada'), ('03', 'pago_rechazado'),
           ('04', 'inasistencia_aceptada'), ('09', 'inasistencia_aceptada'), ('13', 'confirmada')$$,
  'En total solo hay siete avisos: 01 confirmada y cancelada, 02 cancelada, 03 pago_rechazado, 04 y 09 inasistencia_aceptada y 13 confirmada');

-- Las restricciones de la tabla.
select throws_ok(
  $$insert into public.aviso_monitor (id_monitoria, evento) values ('50000000-0000-0000-0000-000000005101', 'confirmada')$$,
  '23505', null, 'Un mismo evento no se repite para la misma monitoría (unique id_monitoria + evento)');
select throws_ok(
  $$insert into public.aviso_monitor (id_monitoria, evento) values ('50000000-0000-0000-0000-000000005103', 'realizada')$$,
  '23514', null, 'El evento solo puede ser confirmada, cancelada, pago_rechazado o inasistencia_aceptada (realizada no)');
select throws_ok(
  $$insert into public.aviso_monitor (id_monitoria, evento) values ('50000000-0000-0000-0000-000000005199', 'confirmada')$$,
  '23503', null, 'El aviso apunta a una monitoría que existe');

-- ---------------------------------------------------------------------------
-- service_role: lee los avisos y los marca como procesados, nada más
-- ---------------------------------------------------------------------------
set local role service_role;
select is(
  (select count(*)::int from public.aviso_monitor where id_monitoria::text like '50000000-0000-0000-0000-0000000051%'),
  7, 'service_role lee los avisos (RLS sin políticas no le estorba)');
select is(
  (select count(*)::int from public.aviso_monitor
   where id_monitoria::text like '50000000-0000-0000-0000-0000000051%' and procesado_en is null),
  6, 'Y encuentra los pendientes: seis (el de la 13 ya estaba procesado)');
select lives_ok(
  $$update public.aviso_monitor set procesado_en = timestamptz '2027-03-01 09:00-05'
    where id_monitoria = '50000000-0000-0000-0000-000000005101' and evento = 'confirmada'$$,
  'service_role marca un aviso como procesado');
select throws_ok(
  $$update public.aviso_monitor set evento = 'cancelada' where id_monitoria = '50000000-0000-0000-0000-000000005102'$$,
  '42501', null, 'service_role no puede cambiar el evento: solo procesado_en');
select throws_ok(
  $$update public.aviso_monitor set id_monitoria = '50000000-0000-0000-0000-000000005102' where id_monitoria = '50000000-0000-0000-0000-000000005101'$$,
  '42501', null, 'Ni reasignar el aviso a otra monitoría');
select throws_ok(
  $$insert into public.aviso_monitor (id_monitoria, evento) values ('50000000-0000-0000-0000-000000005103', 'cancelada')$$,
  '42501', null, 'service_role no puede insertar avisos');
select throws_ok(
  $$delete from public.aviso_monitor where id_monitoria = '50000000-0000-0000-0000-000000005101'$$,
  '42501', null, 'service_role no puede borrar avisos');
reset role;
select results_eq(
  $$select evento, procesado_en from public.aviso_monitor
    where id_monitoria = '50000000-0000-0000-0000-000000005101' order by evento$$,
  $$values ('cancelada'::text, null::timestamptz), ('confirmada', timestamptz '2027-03-01 09:00-05')$$,
  'Solo cambió el procesado_en del aviso que se marcó; el otro de la misma monitoría sigue pendiente');

-- ---------------------------------------------------------------------------
-- privado.disparar_avisos_monitor: sin Vault no pide nada y no falla
-- ---------------------------------------------------------------------------
-- La prueba no depende de lo que haya en Vault: se quitan (dentro de la transacción) los dos secretos de la app.
delete from vault.secrets where name in ('calibra_sitio_url', 'calibra_cron_secreto');
select ok(
  not exists (select 1 from vault.decrypted_secrets where name in ('calibra_sitio_url', 'calibra_cron_secreto')),
  'Control: Vault no trae calibra_sitio_url ni calibra_cron_secreto');
select ok(
  exists (select 1 from public.aviso_monitor where procesado_en is null
          and id_monitoria::text like '50000000-0000-0000-0000-0000000051%'),
  'Control: hay avisos pendientes (los de esta prueba)');
select is(privado.disparar_avisos_monitor(), null::bigint,
  'Con avisos pendientes pero sin configuración en Vault devuelve null y no falla (así en local)');

-- Con solo la mitad de la configuración, tampoco.
select vault.create_secret('https://calibra.test/', 'calibra_sitio_url');
select is(privado.disparar_avisos_monitor(), null::bigint,
  'Con la dirección de la app pero sin el secreto tampoco pide nada');
select vault.create_secret('secreto-de-prueba-con-al-menos-treinta-y-dos-caracteres', 'calibra_cron_secreto');
select isnt(privado.disparar_avisos_monitor(), null::bigint,
  'Con los dos secretos en Vault y avisos pendientes sí pide el procesamiento: devuelve el id de la petición de pg_net');

-- Sin avisos pendientes de esta prueba y sin Vault: null (con o sin pendientes, sin configuración no sale nada).
delete from vault.secrets where name in ('calibra_sitio_url', 'calibra_cron_secreto');
update public.aviso_monitor set procesado_en = now()
where procesado_en is null and id_monitoria::text like '50000000-0000-0000-0000-0000000051%';
select is(
  (select count(*)::int from public.aviso_monitor
   where procesado_en is null and id_monitoria::text like '50000000-0000-0000-0000-0000000051%'),
  0, 'Control: ya no queda ningún aviso pendiente de esta prueba');
select is(privado.disparar_avisos_monitor(), null::bigint,
  'Sin avisos pendientes de esta prueba y sin configuración en Vault también devuelve null');

-- ---------------------------------------------------------------------------
-- public.datos_de_aviso_monitor: lo que la app necesita para escribir el correo
-- ---------------------------------------------------------------------------
-- Control: los datos de contacto del estudiante que el aviso no debe traer sí están en las tablas.
select ok(
  exists (select 1 from public.lead where correo = 'lucia.secreta51@calibra.test' and numero_telefono = '3005101111')
  and exists (select 1 from public.monitor_privado where correo = 'ana.monitora51@calibra.test'),
  'Control: el correo y el teléfono del estudiante y el correo del monitor existen en las tablas');

set local role service_role;
select is((select count(*)::int from public.datos_de_aviso_monitor('50000000-0000-0000-0000-000000005114')), 1,
  'service_role recibe exactamente una fila de una monitoría que existe');
select results_eq(
  $$select estado::text, motivo_cancelacion::text, grupal, correo_monitor, nombre_monitor, nombre_estudiante,
           nombre_materia, duracion_min, presencial
    from public.datos_de_aviso_monitor('50000000-0000-0000-0000-000000005114')$$,
  $$values ('confirmada'::text, null::text, false, 'ana.monitora51@calibra.test'::text, 'Ana 51'::text,
            'Lucía Prueba 51'::text, 'Materia 51 A'::text, 75, true)$$,
  'La 14: confirmada, individual, con el correo y el nombre de su monitor, el nombre del estudiante, la materia, 75 min y presencial');
select is(
  (select inicio from public.datos_de_aviso_monitor('50000000-0000-0000-0000-000000005114')),
  timestamptz '2027-03-01 09:30-05',
  'El inicio es la fecha más la hora de la franja en hora de Bogotá (9:30 en Bogotá, las 14:30 UTC)');
select is(
  (select inicio from public.datos_de_aviso_monitor('50000000-0000-0000-0000-000000005114')),
  public.inicio_sesion(date '2027-03-01', time '09:30'),
  'Y es el mismo que calcula public.inicio_sesion(fecha, hora)');
select results_eq(
  $$select estado::text, motivo_cancelacion::text, grupal, correo_monitor, nombre_monitor, nombre_estudiante,
           nombre_materia, duracion_min, presencial
    from public.datos_de_aviso_monitor('50000000-0000-0000-0000-000000005115')$$,
  $$values ('confirmada'::text, null::text, false, 'beto.monitor51@calibra.test'::text, 'Beto 51'::text,
            'Mateo Prueba 51'::text, 'Materia 51 B'::text, 45, false)$$,
  'La 15: del monitor B, con su correo, otro estudiante, otra materia, 45 min y virtual (nada se mezcla con la 14)');
select results_eq(
  $$select estado::text, motivo_cancelacion::text, nombre_estudiante, duracion_min, presencial
    from public.datos_de_aviso_monitor('50000000-0000-0000-0000-000000005102')$$,
  $$values ('cancelada'::text, 'estudiante'::text, 'Mateo Prueba 51'::text, 60, false)$$,
  'La 02, que canceló el estudiante: trae el estado cancelada y el motivo estudiante (con eso la app arma el correo)');
select is(
  (select grupal from public.datos_de_aviso_monitor('50000000-0000-0000-0000-000000005110')),
  true, 'Una grupal sale con grupal = true (la app no le manda nada al monitor)');
select is((select count(*)::int from public.datos_de_aviso_monitor(gen_random_uuid())), 0,
  'Un id que no existe: cero filas');
select is((select count(*)::int from public.datos_de_aviso_monitor(null)), 0,
  'Un id nulo: cero filas');
select ok(
  not exists (
    select 1 from public.datos_de_aviso_monitor('50000000-0000-0000-0000-000000005114') d
    where d::text ilike '%lucia.secreta51%' or d::text ilike '%3005101111%' or d::text ilike '%mateo.secreto51%'
       or d::text ilike '%3005100001%' or d::text ilike '%llave-ana-51%' or d::text ilike '%https://%'),
  'P-37: la fila no trae correo ni teléfono del estudiante, ni el teléfono ni la llave del monitor, ni enlaces');
reset role;

-- Ni anon ni una sesión (aunque sea la del monitor de la monitoría) la ejecutan.
set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000051a0","role":"authenticated"}';
select throws_ok($$select * from public.datos_de_aviso_monitor('50000000-0000-0000-0000-000000005114')$$, '42501', null,
  'Una sesión, ni siquiera la del monitor de esa monitoría, puede pedir los datos del aviso: permiso denegado');
reset role;
set local role anon;
select throws_ok($$select * from public.datos_de_aviso_monitor('50000000-0000-0000-0000-000000005114')$$, '42501', null,
  'anon tampoco: permiso denegado');
reset role;

-- ---------------------------------------------------------------------------
-- Si se borra la monitoría, sus avisos se van con ella (on delete cascade)
-- ---------------------------------------------------------------------------
delete from public.monitoria where id = '50000000-0000-0000-0000-000000005113';
select is(
  (select count(*)::int from public.aviso_monitor where id_monitoria = '50000000-0000-0000-0000-000000005113'),
  0, 'Borrar la monitoría borra sus avisos (on delete cascade)');

-- ---------------------------------------------------------------------------
-- intentos: empieza en 0 y no baja de 0
-- ---------------------------------------------------------------------------
select is(
  (select intentos from public.aviso_monitor where id_monitoria = '50000000-0000-0000-0000-000000005101' and evento = 'cancelada'),
  0, 'Un aviso nuevo empieza con 0 intentos');
select throws_ok(
  $$update public.aviso_monitor set intentos = -1 where id_monitoria = '50000000-0000-0000-0000-000000005101'$$,
  '23514', null, 'intentos no puede ser negativo');

-- ---------------------------------------------------------------------------
-- Si el pedido a la app falla, el cambio de estado no se cae
-- ---------------------------------------------------------------------------
-- Se reemplaza disparar_avisos_monitor por una que falla (como una dirección mal escrita en Vault). El reemplazo
-- se deshace con el rollback. Va al final porque las pruebas de arriba usan la función de verdad.
create or replace function privado.disparar_avisos_monitor()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'falla de prueba: pg_net no responde';
end;
$$;

insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min, lugar, enlace, abierta_desde)
values ('30000000-0000-0000-0000-000000005199', 'b0000000-0000-0000-0000-0000000051a0', 1, time '09:30', false, 20000, 60,
        null, 'https://meet.example/51-99', date '2026-01-01');
insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado)
values ('50000000-0000-0000-0000-000000005199', '30000000-0000-0000-0000-000000005199', '10000000-0000-0000-0000-0000000051a1',
        '40000000-0000-0000-0000-000000005101', date '2027-03-01', 20000, 'pendiente_pago');

select lives_ok(
  $$update public.monitoria set estado = 'confirmada' where id = '50000000-0000-0000-0000-000000005199'$$,
  'Con el pedido a la app fallando, confirmar la monitoría no falla');
select results_eq(
  $$select m.estado::text, a.evento, a.procesado_en is null
    from public.monitoria m join public.aviso_monitor a on a.id_monitoria = m.id
    where m.id = '50000000-0000-0000-0000-000000005199'$$,
  $$values ('confirmada'::text, 'confirmada'::text, true)$$,
  'La monitoría queda confirmada y su aviso anotado, pendiente: pg_cron lo vuelve a pedir');

select * from finish();
rollback;
