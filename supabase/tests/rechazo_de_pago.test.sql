-- Pruebas pgTAP de los correos del rechazo de un pago (HU-076; D-16, D-38, D-39 d y e).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.
--
-- Qué cubre la migración 20261004181723_rechazo_de_pago_correos.sql:
--   * public.aviso_rechazo_pago, la bandeja de salida de los avisos al pagador: RLS sin políticas y permisos mínimos,
--     como aviso_monitor (HU-051).
--   * privado.anotar_aviso_rechazo_pago, el trigger pago_anota_aviso_rechazo y privado.disparar_avisos_rechazo_pago,
--     y el trabajo de pg_cron calibra-avisar-rechazos.
--   * El evento `pago_rechazado` de aviso_monitor: confirmada -> cancelada con ese motivo, solo individuales.
--   * privado.revisar_pago (D1): cancela la monitoría antes de marcar el pago, para que el trigger del pago la lea
--     cancelada. Se prueba rechazando por public.revisar_pago, no con un update directo.
-- Los tres casos de un rechazo: (A) cita futura, (B) cita ya cancelada por el estudiante, (C) P-24.
--
-- Elenco (ids terminados en 76NN; la materia es 'PGTAP-76'). Admin A, el monitor M con una franja de los lunes 10:00 y el
-- Lead 01. Cada monitoría es de un lunes distinto de 2030 y tiene un pago en revisión del mismo número, asignado a A:
--     01 confirmada (A: rechazar, y rechazar otra vez)   02 por pagar (A')   03 cancelada por el estudiante (B)
--     04 confirmada que ya empezó (C)   05 realizada (C)   06 cancelada por monitor_no_asistio
--     07 confirmada con dos pagos (07 y 17)   08 grupal   09 confirmada (aprobar)   10 confirmada (savepoint)
--     11 a 15: cambios de estado directos de la monitoría (avisos al monitor)   16 confirmada (si el pedido a la app falla)

begin;
create extension if not exists pgtap with schema extensions;

select plan(88);

-- ---------------------------------------------------------------------------
-- La tabla: columnas, RLS sin políticas y permisos mínimos
-- ---------------------------------------------------------------------------
select has_table('public', 'aviso_rechazo_pago', 'Existe public.aviso_rechazo_pago, la bandeja de salida de los avisos al pagador');
select columns_are('public', 'aviso_rechazo_pago', array['id', 'id_pago', 'caso', 'creado_en', 'procesado_en', 'intentos'],
  'Sus columnas son el id, el pago, el caso, cuándo se anotó, cuándo la app lo procesó y cuántas corridas fallaron');
select ok((select relrowsecurity from pg_class where oid = 'public.aviso_rechazo_pago'::regclass),
  'RLS está activo en aviso_rechazo_pago');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'aviso_rechazo_pago'), 0,
  'Sin políticas: RLS le niega todo a anon y authenticated (el trigger inserta como security definer y la app usa la llave secreta)');
select ok(
  not exists (
    select 1
    from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where c.oid = 'public.aviso_rechazo_pago'::regclass and a.grantee = 0),
  'Nadie la hereda de PUBLIC');
select ok(
  not has_any_column_privilege('anon', 'public.aviso_rechazo_pago', 'select')
  and not has_any_column_privilege('anon', 'public.aviso_rechazo_pago', 'insert')
  and not has_any_column_privilege('anon', 'public.aviso_rechazo_pago', 'update')
  and not has_any_column_privilege('anon', 'public.aviso_rechazo_pago', 'references')
  and not has_table_privilege('anon', 'public.aviso_rechazo_pago', 'delete')
  and not has_table_privilege('anon', 'public.aviso_rechazo_pago', 'truncate')
  and not has_table_privilege('anon', 'public.aviso_rechazo_pago', 'trigger'),
  'anon no tiene ningún permiso sobre aviso_rechazo_pago');
select ok(
  not has_any_column_privilege('authenticated', 'public.aviso_rechazo_pago', 'select')
  and not has_any_column_privilege('authenticated', 'public.aviso_rechazo_pago', 'insert')
  and not has_any_column_privilege('authenticated', 'public.aviso_rechazo_pago', 'update')
  and not has_any_column_privilege('authenticated', 'public.aviso_rechazo_pago', 'references')
  and not has_table_privilege('authenticated', 'public.aviso_rechazo_pago', 'delete')
  and not has_table_privilege('authenticated', 'public.aviso_rechazo_pago', 'truncate')
  and not has_table_privilege('authenticated', 'public.aviso_rechazo_pago', 'trigger'),
  'authenticated tampoco tiene ninguno: ni un admin ni el pagador leen ni escriben los avisos');
select ok(has_table_privilege('service_role', 'public.aviso_rechazo_pago', 'select'),
  'service_role lee aviso_rechazo_pago (la app busca los pendientes)');
select ok(has_column_privilege('service_role', 'public.aviso_rechazo_pago', 'procesado_en', 'update')
  and has_column_privilege('service_role', 'public.aviso_rechazo_pago', 'intentos', 'update'),
  'service_role actualiza procesado_en e intentos');
select ok(
  not has_column_privilege('service_role', 'public.aviso_rechazo_pago', 'id', 'update')
  and not has_column_privilege('service_role', 'public.aviso_rechazo_pago', 'id_pago', 'update')
  and not has_column_privilege('service_role', 'public.aviso_rechazo_pago', 'caso', 'update')
  and not has_column_privilege('service_role', 'public.aviso_rechazo_pago', 'creado_en', 'update')
  and not has_table_privilege('service_role', 'public.aviso_rechazo_pago', 'update'),
  'Pero ninguna otra columna: el id, el pago, el caso y creado_en no se reescriben');
select ok(
  not has_any_column_privilege('service_role', 'public.aviso_rechazo_pago', 'insert')
  and not has_table_privilege('service_role', 'public.aviso_rechazo_pago', 'delete')
  and not has_table_privilege('service_role', 'public.aviso_rechazo_pago', 'truncate')
  and not has_any_column_privilege('service_role', 'public.aviso_rechazo_pago', 'references')
  and not has_table_privilege('service_role', 'public.aviso_rechazo_pago', 'trigger'),
  'service_role no inserta, no borra, no trunca: los avisos los anota solo el trigger');

set local role anon;
select throws_ok($$select * from public.aviso_rechazo_pago$$, '42501', null, 'anon no puede leer aviso_rechazo_pago: permiso denegado');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000076a0","role":"authenticated"}';
select throws_ok($$select * from public.aviso_rechazo_pago$$, '42501', null,
  'Ni siquiera la sesión de un admin lee aviso_rechazo_pago: permiso denegado');
select throws_ok($$delete from public.aviso_rechazo_pago$$, '42501', null, 'Ni la borra');
reset role;

-- ---------------------------------------------------------------------------
-- Funciones, trigger y trabajo de pg_cron
-- ---------------------------------------------------------------------------
select has_function('privado', 'anotar_aviso_rechazo_pago', '{}'::name[], 'Existe privado.anotar_aviso_rechazo_pago, la del trigger');
select has_function('privado', 'disparar_avisos_rechazo_pago', '{}'::name[],
  'Existe privado.disparar_avisos_rechazo_pago, la que le pide a la app procesar los avisos');
select ok(
  (select prosecdef from pg_proc where oid = 'privado.anotar_aviso_rechazo_pago()'::regprocedure)
  and (select prosecdef from pg_proc where oid = 'privado.disparar_avisos_rechazo_pago()'::regprocedure),
  'Las dos son security definer (escriben aviso_rechazo_pago y leen Vault)');
select ok(
  (select bool_and('search_path=""' = any(proconfig)) from pg_proc
   where oid in ('privado.anotar_aviso_rechazo_pago()'::regprocedure, 'privado.disparar_avisos_rechazo_pago()'::regprocedure)),
  'Las dos fijan un search_path vacío');
select is(
  array[pg_get_function_result('privado.anotar_aviso_rechazo_pago()'::regprocedure),
        pg_get_function_result('privado.disparar_avisos_rechazo_pago()'::regprocedure)],
  array['trigger', 'bigint'],
  'La del trigger devuelve trigger y la que pide el procesamiento, el id de la petición de pg_net (bigint)');
select ok(
  not has_function_privilege('anon', 'privado.anotar_aviso_rechazo_pago()', 'execute')
  and not has_function_privilege('authenticated', 'privado.anotar_aviso_rechazo_pago()', 'execute')
  and not has_function_privilege('service_role', 'privado.anotar_aviso_rechazo_pago()', 'execute')
  and not has_function_privilege('anon', 'privado.disparar_avisos_rechazo_pago()', 'execute')
  and not has_function_privilege('authenticated', 'privado.disparar_avisos_rechazo_pago()', 'execute')
  and not has_function_privilege('service_role', 'privado.disparar_avisos_rechazo_pago()', 'execute'),
  'Ni anon, ni authenticated, ni service_role ejecutan ninguna de las dos: solo el trigger y pg_cron');
select ok(
  not exists (
    select 1
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid in ('privado.anotar_aviso_rechazo_pago()'::regprocedure, 'privado.disparar_avisos_rechazo_pago()'::regprocedure)
      and a.grantee = 0),
  'Nadie las hereda de PUBLIC');
set local role anon;
select throws_ok($$select privado.disparar_avisos_rechazo_pago()$$, '42501', null, 'anon no puede pedir el procesamiento: permiso denegado');
reset role;
set local role authenticated;
select throws_ok($$select privado.disparar_avisos_rechazo_pago()$$, '42501', null, 'Una sesión tampoco: permiso denegado');
reset role;
set local role service_role;
select throws_ok($$select privado.disparar_avisos_rechazo_pago()$$, '42501', null, 'service_role tampoco: lo pide el trigger o pg_cron');
reset role;

select has_trigger('public', 'pago', 'pago_anota_aviso_rechazo', 'pago tiene el trigger pago_anota_aviso_rechazo');
select trigger_is('public', 'pago', 'pago_anota_aviso_rechazo', 'privado', 'anotar_aviso_rechazo_pago',
  'El trigger llama a privado.anotar_aviso_rechazo_pago');
select matches(
  (select pg_get_triggerdef(t.oid) from pg_trigger t
   where t.tgrelid = 'public.pago'::regclass and t.tgname = 'pago_anota_aviso_rechazo'),
  'AFTER UPDATE OF estado ON public\.pago FOR EACH ROW WHEN',
  'Corre después de cambiar el estado, por fila y con condición (la misma transacción del rechazo)');
select matches(
  (select pg_get_triggerdef(t.oid) from pg_trigger t
   where t.tgrelid = 'public.pago'::regclass and t.tgname = 'pago_anota_aviso_rechazo'),
  'en_revision.*rechazado',
  'Solo cuando el pago pasa de en_revision a rechazado');

select is((select count(*)::int from cron.job where jobname = 'calibra-avisar-rechazos'), 1,
  'Existe un solo trabajo calibra-avisar-rechazos en pg_cron (reaplicar la migración no lo duplica)');
select results_eq(
  $$select schedule, command, active from cron.job where jobname = 'calibra-avisar-rechazos'$$,
  $$values ('*/5 * * * *'::text, 'select privado.disparar_avisos_rechazo_pago()'::text, true)$$,
  'Corre cada 5 minutos, activo, y llama a privado.disparar_avisos_rechazo_pago()');

-- ---------------------------------------------------------------------------
-- Fixtures (como postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, is_anonymous) values
  ('a0000000-0000-0000-0000-0000000076a0', false),
  ('b0000000-0000-0000-0000-000000007601', false),
  ('c0000000-0000-0000-0000-000000007601', true);

insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-0000000076a0', 'Admin A', 'admin-a-hu076@calibra.test', 9007601);
insert into public.monitor (id, nombre) values ('b0000000-0000-0000-0000-000000007601', 'Monitor M');
insert into public.monitor_privado (id_monitor, numero_telefono, correo, llave) values
  ('b0000000-0000-0000-0000-000000007601', '3007600001', 'monitor-m-hu076@calibra.test', 'llave-m-76');
insert into public.materia (id, nombre, codigo) values ('10000000-0000-0000-0000-000000007601', 'Materia HU-076', 'PGTAP-76');
insert into public.certificado (id_monitor, id_materia, id_admin) values
  ('b0000000-0000-0000-0000-000000007601', '10000000-0000-0000-0000-000000007601', 'a0000000-0000-0000-0000-0000000076a0');
insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min) values
  ('30000000-0000-0000-0000-000000007601', 'b0000000-0000-0000-0000-000000007601', 1, '10:00', true, 25000, 60);
insert into public.lead (id, id_sesion_anonima, nombre, correo, acepta_tratamiento_datos, fecha_consentimiento) values
  ('40000000-0000-0000-0000-000000007601', 'c0000000-0000-0000-0000-000000007601', 'Lead Uno', 'lead-01-hu076@calibra.test', true, now());

insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado, motivo_cancelacion, fecha_finalizacion)
select ('50000000-0000-0000-0000-0000000076' || v.nn)::uuid, '30000000-0000-0000-0000-000000007601',
       '10000000-0000-0000-0000-000000007601', '40000000-0000-0000-0000-000000007601',
       date '2030-01-07' + (v.nn::int - 1) * 7, 25000, v.estado, v.motivo, v.finalizada
from (values
  ('01', 'confirmada'::public.estado_monitoria, null::public.motivo_cancelacion, null::timestamptz),
  ('02', 'pendiente_pago', null, null),
  ('03', 'cancelada', 'estudiante', null),
  ('04', 'confirmada', null, null),
  ('05', 'realizada', null, timestamptz '2030-02-04 11:00-05'),
  ('06', 'cancelada', 'monitor_no_asistio', null),
  ('07', 'confirmada', null, null),
  ('08', 'confirmada', null, null),
  ('09', 'confirmada', null, null),
  ('10', 'confirmada', null, null),
  ('11', 'confirmada', null, null),
  ('12', 'pendiente_pago', null, null),
  ('13', 'confirmada', null, null),
  ('14', 'confirmada', null, null),
  ('15', 'confirmada', null, null),
  ('16', 'confirmada', null, null)
) as v(nn, estado, motivo, finalizada);
insert into public.monitoria_grupal (id_monitoria, cupos, modalidad_pago, precio_por_persona) values
  ('50000000-0000-0000-0000-000000007608', 3, 'dividido', 15000),
  ('50000000-0000-0000-0000-000000007613', 3, 'dividido', 15000);

-- Un pago por monitoría de la 01 a la 10 y la 16, y un segundo pago de la 07 (el 17).
insert into public.comprobante_revisado (ruta, tipo)
select 'c0000000-0000-0000-0000-000000007601/e7600000-0000-0000-0000-0000000000' || n || '.png', 'image/png'
from (values ('01'), ('02'), ('03'), ('04'), ('05'), ('06'), ('07'), ('08'), ('09'), ('10'), ('16'), ('17')) as v(n);

insert into public.pago (id, id_monitoria, monto, nombre_pagador, contacto, id_admin, comprobante)
select ('60000000-0000-0000-0000-0000000076' || v.np)::uuid, ('50000000-0000-0000-0000-0000000076' || v.nm)::uuid,
       25000, 'Pagador ' || v.np, 'pagador-' || v.np || '-hu076@calibra.test', 'a0000000-0000-0000-0000-0000000076a0',
       'c0000000-0000-0000-0000-000000007601/e7600000-0000-0000-0000-0000000000' || v.np || '.png'
from (values
  ('01', '01'), ('02', '02'), ('03', '03'), ('04', '04'), ('05', '05'), ('06', '06'), ('07', '07'), ('08', '08'),
  ('09', '09'), ('10', '10'), ('16', '16'), ('17', '07')
) as v(np, nm);

-- Sin avisos de partida: insertar monitorías y pagos no anota nada (los triggers son de UPDATE).
select ok(
  (select count(*) = 12 and bool_and(estado = 'en_revision') from public.pago where id::text like '60000000-0000-0000-0000-0000000076%')
  and (select count(*) = 16 from public.monitoria where id::text like '50000000-0000-0000-0000-0000000076%')
  and not exists (select 1 from public.aviso_rechazo_pago where id_pago::text like '60000000-0000-0000-0000-0000000076%')
  and not exists (select 1 from public.aviso_monitor where id_monitoria::text like '50000000-0000-0000-0000-0000000076%'),
  'Control: 12 pagos en revisión, 16 monitorías y ningún aviso todavía');

-- ---------------------------------------------------------------------------
-- El check de aviso_monitor y el evento pago_rechazado (trigger de monitoria)
-- ---------------------------------------------------------------------------
select lives_ok(
  $$insert into public.aviso_monitor (id_monitoria, evento) values ('50000000-0000-0000-0000-000000007614', 'pago_rechazado')$$,
  'El check de aviso_monitor acepta el evento pago_rechazado');
select throws_ok(
  $$insert into public.aviso_monitor (id_monitoria, evento) values ('50000000-0000-0000-0000-000000007615', 'realizada')$$,
  '23514', null, 'Y sigue rechazando un evento que no es confirmada, cancelada, pago_rechazado ni inasistencia_aceptada (HU-030)');
delete from public.aviso_monitor where id_monitoria = '50000000-0000-0000-0000-000000007614';

-- 11: confirmada -> cancelada por pago_rechazado anota el evento, una sola vez.
update public.monitoria set estado = 'cancelada', motivo_cancelacion = 'pago_rechazado'
where id = '50000000-0000-0000-0000-000000007611';
select results_eq(
  $$select evento, procesado_en is null, intentos from public.aviso_monitor where id_monitoria = '50000000-0000-0000-0000-000000007611'$$,
  $$values ('pago_rechazado'::text, true, 0)$$,
  'confirmada -> cancelada por pago_rechazado anota exactamente un aviso pago_rechazado, sin procesar');
update public.monitoria set estado = 'confirmada', motivo_cancelacion = null where id = '50000000-0000-0000-0000-000000007611';
update public.monitoria set estado = 'cancelada', motivo_cancelacion = 'pago_rechazado' where id = '50000000-0000-0000-0000-000000007611';
select is(
  (select count(*)::int from public.aviso_monitor where id_monitoria = '50000000-0000-0000-0000-000000007611'), 1,
  'Cancelarla otra vez por el mismo motivo no duplica el aviso (on conflict do nothing)');

-- 12: una reserva por pagar cancelada por el rechazo no avisa al monitor (supuesto 3).
update public.monitoria set estado = 'cancelada', motivo_cancelacion = 'pago_rechazado'
where id = '50000000-0000-0000-0000-000000007612';
select is(
  (select count(*)::int from public.aviso_monitor where id_monitoria = '50000000-0000-0000-0000-000000007612'), 0,
  'pendiente_pago -> cancelada por pago_rechazado no anota aviso al monitor');

-- 13: una grupal no se avisa (HU-038).
update public.monitoria set estado = 'cancelada', motivo_cancelacion = 'pago_rechazado'
where id = '50000000-0000-0000-0000-000000007613';
select is(
  (select count(*)::int from public.aviso_monitor where id_monitoria = '50000000-0000-0000-0000-000000007613'), 0,
  'Una grupal confirmada cancelada por pago_rechazado no anota aviso');

-- 14 y 15: monitor_no_asistio avisa desde HU-030 (D-37, evento inasistencia_aceptada); diferencia_no_cubierta sigue sin avisar.
update public.monitoria set estado = 'cancelada', motivo_cancelacion = 'monitor_no_asistio' where id = '50000000-0000-0000-0000-000000007614';
update public.monitoria set estado = 'cancelada', motivo_cancelacion = 'diferencia_no_cubierta' where id = '50000000-0000-0000-0000-000000007615';
select set_eq(
  $$select right(id_monitoria::text, 2), evento from public.aviso_monitor where id_monitoria in
    ('50000000-0000-0000-0000-000000007614', '50000000-0000-0000-0000-000000007615')$$,
  $$values ('14'::text, 'inasistencia_aceptada'::text)$$,
  'monitor_no_asistio anota inasistencia_aceptada (HU-030, D-37) y diferencia_no_cubierta sigue sin anotar aviso');

-- ---------------------------------------------------------------------------
-- (A) Rechazar una cita futura confirmada, por public.revisar_pago
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000076a0","role":"authenticated"}';
select results_eq(
  $$select resultado, cancelo_monitoria from public.revisar_pago('60000000-0000-0000-0000-000000007601', 'rechazar', null)$$,
  $$values ('rechazado'::text, true)$$,
  'A: rechazar el pago de una cita futura confirmada: rechazado y canceló la monitoría');
reset role;
select results_eq(
  $$select caso, procesado_en is null, intentos, creado_en = now() from public.aviso_rechazo_pago
    where id_pago = '60000000-0000-0000-0000-000000007601'$$,
  $$values ('cita_cancelada'::text, true, 0, true)$$,
  'A: una fila cita_cancelada para el pagador, sin procesar y anotada en la misma transacción (D1: la monitoría ya estaba cancelada)');
select results_eq(
  $$select evento, procesado_en is null from public.aviso_monitor where id_monitoria = '50000000-0000-0000-0000-000000007601'$$,
  $$values ('pago_rechazado'::text, true)$$,
  'A: y un aviso pago_rechazado para el monitor');
select results_eq(
  $$select p.estado::text, m.estado::text, m.motivo_cancelacion::text
    from public.pago p join public.monitoria m on m.id = p.id_monitoria where p.id = '60000000-0000-0000-0000-000000007601'$$,
  $$values ('rechazado'::text, 'cancelada'::text, 'pago_rechazado'::text)$$,
  'A: el pago queda rechazado y la monitoría, cancelada por pago_rechazado');
select is(
  (select count(*)::int from public.reembolso where id_pago = '60000000-0000-0000-0000-000000007601'), 0,
  'A: un pago rechazado no crea reembolso (RN-43)');

-- Revisar dos veces: ya_revisado y una sola fila.
set local role authenticated;
select results_eq(
  $$select resultado, cancelo_monitoria from public.revisar_pago('60000000-0000-0000-0000-000000007601', 'rechazar', null)$$,
  $$values ('ya_revisado'::text, false)$$,
  'Rechazar otra vez el mismo pago: ya_revisado');
reset role;
select is(
  (select count(*)::int from public.aviso_rechazo_pago where id_pago = '60000000-0000-0000-0000-000000007601')
  + (select count(*)::int from public.aviso_monitor where id_monitoria = '50000000-0000-0000-0000-000000007601'),
  2, 'Y no se anota nada más: sigue una fila del pagador y un aviso del monitor');

-- Un pago solo tiene un aviso (unique id_pago).
select throws_ok(
  $$insert into public.aviso_rechazo_pago (id_pago, caso) values ('60000000-0000-0000-0000-000000007601', 'cita_cancelada')$$,
  '23505', null, 'Un pago no tiene dos avisos (unique id_pago)');
select throws_ok(
  $$insert into public.aviso_rechazo_pago (id_pago, caso) values ('60000000-0000-0000-0000-000000007602', 'otro')$$,
  '23514', null, 'El caso solo puede ser cita_cancelada o cita_ya_cancelada');

-- ---------------------------------------------------------------------------
-- (A') Una por pagar con pago: avisa al pagador, no al monitor
-- ---------------------------------------------------------------------------
set local role authenticated;
select results_eq(
  $$select resultado, cancelo_monitoria from public.revisar_pago('60000000-0000-0000-0000-000000007602', 'rechazar', null)$$,
  $$values ('rechazado'::text, true)$$,
  'A prima: rechazar el pago de una monitoría por pagar: rechazado y canceló la monitoría');
reset role;
select results_eq(
  $$select caso from public.aviso_rechazo_pago where id_pago = '60000000-0000-0000-0000-000000007602'$$,
  $$values ('cita_cancelada'::text)$$,
  'A prima: el pagador tiene su fila cita_cancelada');
select is(
  (select count(*)::int from public.aviso_monitor where id_monitoria = '50000000-0000-0000-0000-000000007602'), 0,
  'A prima: el monitor no recibe aviso (D-16 no avisa las reservas por pagar)');

-- ---------------------------------------------------------------------------
-- (B) La cita ya estaba cancelada por el estudiante: solo cambia el pago
-- ---------------------------------------------------------------------------
set local role authenticated;
select results_eq(
  $$select resultado, cancelo_monitoria from public.revisar_pago('60000000-0000-0000-0000-000000007603', 'rechazar', null)$$,
  $$values ('rechazado'::text, false)$$,
  'B: rechazar el pago de una cita cancelada por el estudiante: rechazado, sin cancelar nada');
reset role;
select results_eq(
  $$select caso, procesado_en is null from public.aviso_rechazo_pago where id_pago = '60000000-0000-0000-0000-000000007603'$$,
  $$values ('cita_ya_cancelada'::text, true)$$,
  'B: el pagador tiene su fila cita_ya_cancelada (correo «no hay reembolso»)');
select is(
  (select count(*)::int from public.aviso_monitor where id_monitoria = '50000000-0000-0000-0000-000000007603'), 0,
  'B: el monitor no recibe aviso: ya lo avisó la cancelación del estudiante');
select is(
  (select count(*)::int from public.reembolso where id_pago = '60000000-0000-0000-0000-000000007603'), 0,
  'B: tampoco hay reembolso (RN-43)');
select results_eq(
  $$select estado::text, motivo_cancelacion::text from public.monitoria where id = '50000000-0000-0000-0000-000000007603'$$,
  $$values ('cancelada'::text, 'estudiante'::text)$$,
  'B: la monitoría sigue cancelada por el estudiante');

-- ---------------------------------------------------------------------------
-- (C) P-24: la sesión ya empezó o se realizó. Al pagador no se le escribe
-- ---------------------------------------------------------------------------
-- La 04 empieza el 28-ene-2030 a las 10:00 en Bogotá: justo en su inicio (P-40) ya empezó.
select results_eq(
  $$select resultado, cancelo_monitoria from privado.revisar_pago('60000000-0000-0000-0000-000000007604', 'rechazar',
      'Se cobra por fuera.', timestamptz '2030-01-28 10:00-05')$$,
  $$values ('rechazado'::text, false)$$,
  'C: rechazar el pago de una confirmada que ya empezó (con observaciones): rechazado, sin cancelar la monitoría');
set local role authenticated;
select results_eq(
  $$select resultado, cancelo_monitoria from public.revisar_pago('60000000-0000-0000-0000-000000007605', 'rechazar', 'Se cobra por fuera.')$$,
  $$values ('rechazado'::text, false)$$,
  'C: y el de una realizada: rechazado, sin cancelar la monitoría');
reset role;
select is(
  (select count(*)::int from public.aviso_rechazo_pago where id_pago in
    ('60000000-0000-0000-0000-000000007604', '60000000-0000-0000-0000-000000007605')), 0,
  'C: ninguna de las dos anota fila para el pagador (criterio 6)');
select is(
  (select count(*)::int from public.aviso_monitor where id_monitoria in
    ('50000000-0000-0000-0000-000000007604', '50000000-0000-0000-0000-000000007605')), 0,
  'C: ni aviso para el monitor');

-- Cancelada por otro motivo (monitor_no_asistio): nada.
set local role authenticated;
select results_eq(
  $$select resultado, cancelo_monitoria from public.revisar_pago('60000000-0000-0000-0000-000000007606', 'rechazar', null)$$,
  $$values ('rechazado'::text, false)$$,
  'Rechazar el pago de una cita cancelada por monitor_no_asistio: rechazado, sin cancelar nada');
reset role;
select is(
  (select count(*)::int from public.aviso_rechazo_pago where id_pago = '60000000-0000-0000-0000-000000007606'), 0,
  'Y al pagador no se le anota fila: el caso de otros motivos lo decide quien lo construya (supuesto 2)');

-- ---------------------------------------------------------------------------
-- Segundo pago de una cita que ya canceló el rechazo del primero
-- ---------------------------------------------------------------------------
set local role authenticated;
select results_eq(
  $$select resultado, cancelo_monitoria from public.revisar_pago('60000000-0000-0000-0000-000000007607', 'rechazar', null)$$,
  $$values ('rechazado'::text, true)$$,
  'El primer pago de la 07 rechazado cancela la cita');
select results_eq(
  $$select resultado, cancelo_monitoria from public.revisar_pago('60000000-0000-0000-0000-000000007617', 'rechazar', null)$$,
  $$values ('rechazado'::text, false)$$,
  'El segundo pago de la misma cita: rechazado, sin cancelar nada más');
reset role;
select results_eq(
  $$select right(id_pago::text, 2), caso from public.aviso_rechazo_pago
    where id_pago in ('60000000-0000-0000-0000-000000007607', '60000000-0000-0000-0000-000000007617') order by id_pago$$,
  $$values ('07'::text, 'cita_cancelada'::text), ('17', 'cita_cancelada')$$,
  'Los dos pagadores tienen su fila cita_cancelada (la cita sigue cancelada por pago_rechazado, supuesto 2)');
select is(
  (select count(*)::int from public.aviso_monitor where id_monitoria = '50000000-0000-0000-0000-000000007607'), 1,
  'Y el monitor recibe un solo aviso por esa cita');

-- ---------------------------------------------------------------------------
-- Grupal: el trigger del pago no anota nada
-- ---------------------------------------------------------------------------
-- revisar_pago responde no_individual, así que el cambio se hace directo, como postgres, sobre una grupal ya cancelada.
update public.monitoria set estado = 'cancelada', motivo_cancelacion = 'pago_rechazado'
where id = '50000000-0000-0000-0000-000000007608';
update public.pago set estado = 'rechazado', fecha_revision = now() where id = '60000000-0000-0000-0000-000000007608';
select is(
  (select count(*)::int from public.aviso_rechazo_pago where id_pago = '60000000-0000-0000-0000-000000007608'), 0,
  'Una grupal (aunque quede cancelada por pago_rechazado) no anota fila para el pagador: es de HU-038');

-- ---------------------------------------------------------------------------
-- Aprobar no anota nada
-- ---------------------------------------------------------------------------
set local role authenticated;
select results_eq(
  $$select resultado, cancelo_monitoria from public.revisar_pago('60000000-0000-0000-0000-000000007609', 'aprobar', null)$$,
  $$values ('aprobado'::text, false)$$,
  'Aprobar el pago de una cita confirmada: aprobado');
reset role;
select is(
  (select count(*)::int from public.aviso_rechazo_pago where id_pago = '60000000-0000-0000-0000-000000007609')
  + (select count(*)::int from public.aviso_monitor where id_monitoria = '50000000-0000-0000-0000-000000007609'),
  0, 'Aprobar no anota aviso al pagador ni al monitor');

-- ---------------------------------------------------------------------------
-- Misma transacción: deshacer el rechazo deshace los avisos
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000076a0","role":"authenticated"}';
savepoint antes_del_rechazo;
set local role authenticated;
select results_eq(
  $$select resultado from public.revisar_pago('60000000-0000-0000-0000-000000007610', 'rechazar', null)$$,
  $$values ('rechazado'::text)$$,
  'Dentro de un savepoint: se rechaza el pago de la 10');
reset role;
select is(
  (select count(*)::int from public.aviso_rechazo_pago where id_pago = '60000000-0000-0000-0000-000000007610')
  + (select count(*)::int from public.aviso_monitor where id_monitoria = '50000000-0000-0000-0000-000000007610'),
  2, 'Ahí mismo ya están anotados el aviso del pagador y el del monitor');
rollback to savepoint antes_del_rechazo;
select results_eq(
  $$select (select count(*)::int from public.aviso_rechazo_pago where id_pago = '60000000-0000-0000-0000-000000007610'),
           (select count(*)::int from public.aviso_monitor where id_monitoria = '50000000-0000-0000-0000-000000007610'),
           (select estado::text from public.pago where id = '60000000-0000-0000-0000-000000007610'),
           (select estado::text from public.monitoria where id = '50000000-0000-0000-0000-000000007610')$$,
  $$values (0, 0, 'en_revision'::text, 'confirmada'::text)$$,
  'Al deshacer el rechazo (rollback to savepoint) no queda ningún aviso: se anotan en la misma transacción');

-- ---------------------------------------------------------------------------
-- El resumen: solo quedaron los avisos esperados
-- ---------------------------------------------------------------------------
select set_eq(
  $$select right(id_pago::text, 2), caso from public.aviso_rechazo_pago where id_pago::text like '60000000-0000-0000-0000-0000000076%'$$,
  $$values ('01'::text, 'cita_cancelada'::text), ('02', 'cita_cancelada'), ('03', 'cita_ya_cancelada'),
           ('07', 'cita_cancelada'), ('17', 'cita_cancelada')$$,
  'En total hay cinco filas para pagadores: 01, 02, 07 y 17 cita_cancelada y 03 cita_ya_cancelada');
select set_eq(
  $$select right(id_monitoria::text, 2), evento from public.aviso_monitor where id_monitoria::text like '50000000-0000-0000-0000-0000000076%'$$,
  $$values ('01'::text, 'pago_rechazado'::text), ('07', 'pago_rechazado'), ('11', 'pago_rechazado'),
           ('14', 'inasistencia_aceptada')$$,
  'Y cuatro avisos para monitores: 01, 07 y 11 pago_rechazado, y 14 inasistencia_aceptada (HU-030)');

-- ---------------------------------------------------------------------------
-- service_role: lee los avisos y los marca, nada más
-- ---------------------------------------------------------------------------
set local role service_role;
select is(
  (select count(*)::int from public.aviso_rechazo_pago where id_pago::text like '60000000-0000-0000-0000-0000000076%'), 5,
  'service_role lee los avisos (RLS sin políticas no le estorba)');
select lives_ok(
  $$update public.aviso_rechazo_pago set procesado_en = now(), intentos = 1 where id_pago = '60000000-0000-0000-0000-000000007603'$$,
  'service_role marca un aviso como procesado y cuenta un intento');
select throws_ok(
  $$update public.aviso_rechazo_pago set caso = 'cita_cancelada' where id_pago = '60000000-0000-0000-0000-000000007603'$$,
  '42501', null, 'service_role no puede cambiar el caso');
select throws_ok(
  $$insert into public.aviso_rechazo_pago (id_pago, caso) values ('60000000-0000-0000-0000-000000007610', 'cita_cancelada')$$,
  '42501', null, 'service_role no puede insertar avisos');
select throws_ok(
  $$delete from public.aviso_rechazo_pago where id_pago = '60000000-0000-0000-0000-000000007603'$$,
  '42501', null, 'service_role no puede borrar avisos');
reset role;
select throws_ok(
  $$update public.aviso_rechazo_pago set intentos = -1 where id_pago = '60000000-0000-0000-0000-000000007603'$$,
  '23514', null, 'intentos no puede ser negativo');

-- Borrar el pago borra su aviso (on delete cascade).
delete from public.pago where id = '60000000-0000-0000-0000-000000007603';
select is((select count(*)::int from public.aviso_rechazo_pago where id_pago = '60000000-0000-0000-0000-000000007603'), 0,
  'Borrar el pago borra su aviso (on delete cascade)');

-- ---------------------------------------------------------------------------
-- privado.disparar_avisos_rechazo_pago: sin Vault no pide nada y no falla
-- ---------------------------------------------------------------------------
delete from vault.secrets where name in ('calibra_sitio_url', 'calibra_cron_secreto');
select ok(
  not exists (select 1 from vault.decrypted_secrets where name in ('calibra_sitio_url', 'calibra_cron_secreto')),
  'Control: Vault no trae calibra_sitio_url ni calibra_cron_secreto');
select ok(
  exists (select 1 from public.aviso_rechazo_pago where procesado_en is null and id_pago::text like '60000000-0000-0000-0000-0000000076%'),
  'Control: hay avisos pendientes (los de esta prueba)');
select is(privado.disparar_avisos_rechazo_pago(), null::bigint,
  'Con avisos pendientes pero sin configuración en Vault devuelve null y no falla (así en local)');
select vault.create_secret('https://calibra.test/', 'calibra_sitio_url');
select is(privado.disparar_avisos_rechazo_pago(), null::bigint,
  'Con la dirección de la app pero sin el secreto tampoco pide nada');
select vault.create_secret('secreto-de-prueba-con-al-menos-treinta-y-dos-caracteres', 'calibra_cron_secreto');
select isnt(privado.disparar_avisos_rechazo_pago(), null::bigint,
  'Con los dos secretos en Vault y avisos pendientes sí pide el procesamiento: devuelve el id de la petición de pg_net');
delete from vault.secrets where name in ('calibra_sitio_url', 'calibra_cron_secreto');
update public.aviso_rechazo_pago set procesado_en = now() where procesado_en is null;
select is(privado.disparar_avisos_rechazo_pago(), null::bigint,
  'Sin avisos pendientes devuelve null');

-- ---------------------------------------------------------------------------
-- Si el pedido a la app falla, el rechazo se guarda igual
-- ---------------------------------------------------------------------------
-- Se reemplaza disparar_avisos_rechazo_pago por una que falla; el reemplazo se deshace con el rollback. Va al final.
create or replace function privado.disparar_avisos_rechazo_pago()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'falla de prueba: pg_net no responde';
end;
$$;

set local role authenticated;
select lives_ok(
  $$select * from public.revisar_pago('60000000-0000-0000-0000-000000007616', 'rechazar', null)$$,
  'Con el pedido a la app fallando, rechazar el pago no falla');
reset role;
select results_eq(
  $$select p.estado::text, m.estado::text, a.caso, a.procesado_en is null
    from public.pago p
    join public.monitoria m on m.id = p.id_monitoria
    join public.aviso_rechazo_pago a on a.id_pago = p.id
    where p.id = '60000000-0000-0000-0000-000000007616'$$,
  $$values ('rechazado'::text, 'cancelada'::text, 'cita_cancelada'::text, true)$$,
  'El pago queda rechazado, la monitoría cancelada y el aviso anotado y pendiente: pg_cron lo vuelve a pedir');

select * from finish();
rollback;
