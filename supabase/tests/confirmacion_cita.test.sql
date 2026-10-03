-- Pruebas pgTAP de la confirmación de la cita y su enlace de gestión (HU-019, P-04, P-22, RN-12, D-19, D-20, D-21).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.
--
-- Qué cubre la migración 20261002064121_confirmacion_cita.sql:
--   * public.confirmacion_cita, la bandeja de salida de las confirmaciones y dueña del token: RLS sin políticas y permisos
--     mínimos. Nadie con sesión (anon, authenticated) la toca; service_role solo lee y marca `procesado_en` e `intentos`.
--   * El trigger monitoria_anota_confirmacion_cita (privado.anotar_confirmacion_cita): anota la confirmación, con su token de
--     256 bits, en la misma transacción en que una individual pasa de `pendiente_pago` a `confirmada`. Nada para las
--     grupales, para otras transiciones, para un UPDATE que no cambia el estado ni para una inserción directa ya confirmada
--     (el trigger es de UPDATE: por eso las pruebas crean la monitoría por pagar y la confirman con un UPDATE). Una sola por
--     monitoría y con un solo token (D-20).
--   * privado.disparar_confirmaciones_cita: le pide a la app que procese las confirmaciones solo si hay pendientes y Vault trae
--     `calibra_sitio_url` y `calibra_cron_secreto`; si no, devuelve null y no falla (así en local). Un pedido que falla nunca
--     tumba la confirmación de la monitoría.
--   * public.datos_de_confirmacion_cita: lo que la app necesita para escribir el correo (security invoker, solo service_role):
--     el correo del Lead o, si no tiene, el del primer pago (D-19); lugar y enlace tal cual (D-21); sin contacto del monitor.
--   * public.cita_por_token (service_role), public.mi_cita y public.mis_citas (la sesión del Lead, por privado.es_mi_lead),
--     todas sobre privado.datos_de_cita: la misma forma de salida, solo individuales, lugar y enlace solo con la cita
--     confirmada (D-21), plazos del motor de plazos, estado del pago (D-11), del reembolso y del reporte. Token inventado o
--     mal formado: ninguna fila. Sin id del Lead, sin contacto, sin cifras de comisión.
--   * El trabajo de pg_cron calibra-confirmar-citas, cada 5 minutos.
-- Las monitorías se insertan como postgres: el trigger completa id_monitor desde la franja y exige que la fecha caiga en el
-- día de la franja (todas son lunes de 2027, en el futuro: ningún trabajo de pg_cron las toca). Una cancelada exige motivo y
-- una realizada, fecha_finalizacion.
--
-- Elenco (todos los ids terminan en 19NN; la materia es 'PGTAP-19'):
--   Monitor A (con contacto en monitor_privado) y admin 01. Una sesión por Lead:
--     Lead 01 (Lucía, sesión c1) y Lead 02 (Mateo, sesión c2), con correo y teléfono que nada de esto debe traer;
--     Lead 03 (Sofía, sesión c3), sin correo: solo teléfono. Sesión c4: anónima sin Lead. Sesión c5: confirmó el correo del
--     Lead 01 desde otro dispositivo (lead_sesion, HU-068). Sesión c6: cuenta de Estudiante del Lead 02. Lead 04 (sesión c7)
--     tiene 52 citas confirmadas, para el tope de 50.
--   Monitorías (cada una con su franja de los lunes a las 9:30: virtual de 60 min salvo la 02 y la 12, presenciales; la 02
--   de 75 min). Las cuatro primeras filas se confirman con un UPDATE; la 04, 06, 12 y 15 se insertan ya confirmadas:
--     01 por pagar (L1): se confirma, vuelve atrás y se confirma otra vez   02 por pagar (L2, presencial): se confirma y
--     luego se cancela por pago rechazado   03 por pagar (L3, sin correo): se confirma; sus dos pagos dan el correo de respaldo
--     04 confirmada (L1): inserción directa, sin confirmación; dos pagos, uno rechazado   05 grupal por pagar: se confirma
--     06 grupal confirmada   07 por pagar: vence (reserva_expirada)   08 por pagar: sigue así   09 por pagar (L1): se confirma
--     y se realiza   10 cancelada por monitor_no_asistio (L2): reembolso pendiente y reporte aceptado   11 cancelada por
--     pago_rechazado (L1)   12 confirmada (L1, presencial): pagos aprobado y en revisión, reembolsos esperando llave y
--     pendiente   13 cancelada por el estudiante (L1): reembolsos pendiente y reembolsado   14 cancelada por el estudiante
--     (L1): reembolsado   15 confirmada (L2): pago aprobado y reporte en revisión.

begin;
create extension if not exists pgtap with schema extensions;

select plan(128);

-- ---------------------------------------------------------------------------
-- La tabla: RLS sin políticas y permisos mínimos
-- ---------------------------------------------------------------------------
select has_table('public', 'confirmacion_cita', 'Existe public.confirmacion_cita, la bandeja de salida de las confirmaciones');
select columns_are('public', 'confirmacion_cita', array['id', 'id_monitoria', 'token', 'creada_en', 'procesado_en', 'intentos'],
  'Sus columnas son el id, la monitoría, el token, cuándo se anotó, cuándo la app la procesó y cuántas corridas fallaron');
select ok((select relrowsecurity from pg_class where oid = 'public.confirmacion_cita'::regclass),
  'RLS está activo en confirmacion_cita');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'confirmacion_cita'), 0,
  'Sin políticas: RLS le niega todo a anon y authenticated (el trigger inserta como security definer y la app usa la llave secreta)');
select ok(
  not exists (
    select 1
    from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where c.oid = 'public.confirmacion_cita'::regclass and a.grantee = 0),
  'Nadie la hereda de PUBLIC');

select ok(
  not has_any_column_privilege('anon', 'public.confirmacion_cita', 'select')
  and not has_any_column_privilege('anon', 'public.confirmacion_cita', 'insert')
  and not has_any_column_privilege('anon', 'public.confirmacion_cita', 'update')
  and not has_any_column_privilege('anon', 'public.confirmacion_cita', 'references')
  and not has_table_privilege('anon', 'public.confirmacion_cita', 'delete')
  and not has_table_privilege('anon', 'public.confirmacion_cita', 'truncate')
  and not has_table_privilege('anon', 'public.confirmacion_cita', 'trigger'),
  'anon no tiene ningún permiso sobre confirmacion_cita');
select ok(
  not has_any_column_privilege('authenticated', 'public.confirmacion_cita', 'select')
  and not has_any_column_privilege('authenticated', 'public.confirmacion_cita', 'insert')
  and not has_any_column_privilege('authenticated', 'public.confirmacion_cita', 'update')
  and not has_any_column_privilege('authenticated', 'public.confirmacion_cita', 'references')
  and not has_table_privilege('authenticated', 'public.confirmacion_cita', 'delete')
  and not has_table_privilege('authenticated', 'public.confirmacion_cita', 'truncate')
  and not has_table_privilege('authenticated', 'public.confirmacion_cita', 'trigger'),
  'authenticated tampoco tiene ninguno: ni el Lead ni el monitor ni un admin leen los tokens');

select ok(has_table_privilege('service_role', 'public.confirmacion_cita', 'select'),
  'service_role lee confirmacion_cita (la app busca las pendientes)');
select ok(has_column_privilege('service_role', 'public.confirmacion_cita', 'procesado_en', 'update')
  and has_column_privilege('service_role', 'public.confirmacion_cita', 'intentos', 'update'),
  'service_role actualiza procesado_en e intentos (marca la confirmación como procesada o cuenta una corrida fallida)');
select ok(
  not has_column_privilege('service_role', 'public.confirmacion_cita', 'id', 'update')
  and not has_column_privilege('service_role', 'public.confirmacion_cita', 'id_monitoria', 'update')
  and not has_column_privilege('service_role', 'public.confirmacion_cita', 'token', 'update')
  and not has_column_privilege('service_role', 'public.confirmacion_cita', 'creada_en', 'update')
  and not has_table_privilege('service_role', 'public.confirmacion_cita', 'update'),
  'Pero ninguna otra columna: el id, la monitoría, el token y creada_en no se reescriben');
select ok(
  not has_any_column_privilege('service_role', 'public.confirmacion_cita', 'insert')
  and not has_table_privilege('service_role', 'public.confirmacion_cita', 'delete')
  and not has_table_privilege('service_role', 'public.confirmacion_cita', 'truncate')
  and not has_any_column_privilege('service_role', 'public.confirmacion_cita', 'references')
  and not has_table_privilege('service_role', 'public.confirmacion_cita', 'trigger'),
  'service_role no inserta, no borra, no trunca: las confirmaciones las anota solo el trigger');

-- Y la prueba de que se aplica de verdad (el permiso se revisa antes que RLS).
set local role anon;
select throws_ok($$select * from public.confirmacion_cita$$, '42501', null, 'anon no puede leer confirmacion_cita: permiso denegado');
select throws_ok($$insert into public.confirmacion_cita (id_monitoria) values ('50000000-0000-0000-0000-000000001999')$$,
  '42501', null, 'anon no puede insertar una confirmación');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001901","role":"authenticated"}';
select throws_ok($$select token from public.confirmacion_cita$$, '42501', null,
  'Una sesión (aunque sea la del Lead de la cita) no puede leer los tokens: permiso denegado');
select throws_ok($$update public.confirmacion_cita set procesado_en = now()$$, '42501', null,
  'Una sesión no puede marcar confirmaciones como procesadas');
select throws_ok($$delete from public.confirmacion_cita$$, '42501', null,
  'Una sesión no puede borrar confirmaciones');
reset role;

-- ---------------------------------------------------------------------------
-- Las funciones y el trigger: definición y permisos
-- ---------------------------------------------------------------------------
select ok(
  to_regprocedure('privado.anotar_confirmacion_cita()') is not null
  and to_regprocedure('privado.disparar_confirmaciones_cita()') is not null
  and to_regprocedure('privado.datos_de_cita(uuid)') is not null
  and to_regprocedure('privado.mi_cita(uuid)') is not null
  and to_regprocedure('privado.mis_citas()') is not null,
  'Existen las cinco de privado: el trigger, el pedido a la app, la cita, y las dos de la sesión');
select ok(
  to_regprocedure('public.datos_de_confirmacion_cita(uuid)') is not null
  and to_regprocedure('public.cita_por_token(text)') is not null
  and to_regprocedure('public.mi_cita(uuid)') is not null
  and to_regprocedure('public.mis_citas()') is not null,
  'Existen las cuatro de public: datos_de_confirmacion_cita, cita_por_token, mi_cita y mis_citas');
select ok(
  (select bool_and(prosecdef) from pg_proc
   where oid in ('privado.anotar_confirmacion_cita()'::regprocedure, 'privado.disparar_confirmaciones_cita()'::regprocedure,
                 'privado.datos_de_cita(uuid)'::regprocedure, 'privado.mi_cita(uuid)'::regprocedure,
                 'privado.mis_citas()'::regprocedure))
  and not (select bool_or(prosecdef) from pg_proc
   where oid in ('public.datos_de_confirmacion_cita(uuid)'::regprocedure, 'public.cita_por_token(text)'::regprocedure,
                 'public.mi_cita(uuid)'::regprocedure, 'public.mis_citas()'::regprocedure)),
  'Las de privado son security definer (leen pago, reembolso, franja y Vault); las cuatro de public corren con los permisos de quien llama');
select ok(
  (select bool_and('search_path=""' = any(proconfig)) from pg_proc
   where oid in ('privado.anotar_confirmacion_cita()'::regprocedure, 'privado.disparar_confirmaciones_cita()'::regprocedure,
                 'privado.datos_de_cita(uuid)'::regprocedure, 'privado.mi_cita(uuid)'::regprocedure,
                 'privado.mis_citas()'::regprocedure, 'public.datos_de_confirmacion_cita(uuid)'::regprocedure,
                 'public.cita_por_token(text)'::regprocedure, 'public.mi_cita(uuid)'::regprocedure,
                 'public.mis_citas()'::regprocedure)),
  'Las nueve fijan un search_path vacío');
select is(
  array[pg_get_function_result('privado.anotar_confirmacion_cita()'::regprocedure),
        pg_get_function_result('privado.disparar_confirmaciones_cita()'::regprocedure)],
  array['trigger', 'bigint'],
  'La del trigger devuelve trigger y la que pide el procesamiento, el id de la petición de pg_net (bigint)');

-- Columnas de salida: fijas, porque cambiarlas exige drop function y una entrada en PREAMBULOS.
select is(
  (select array_agg(a.n order by a.o)
   from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as a(n, m, o)
   where p.oid = 'public.datos_de_confirmacion_cita(uuid)'::regprocedure and a.m = 't'),
  array['token', 'creada_en', 'estado', 'grupal', 'correo_destino', 'nombre_lead', 'nombre_monitor', 'nombre_materia', 'inicio',
        'duracion_min', 'presencial', 'lugar', 'enlace', 'valor_total', 'cancelable_hasta'],
  'datos_de_confirmacion_cita devuelve token, creada_en, estado, grupal, correo_destino, nombre_lead, monitor, materia, inicio, duración, modalidad, lugar, enlace, valor y plazo');
select is(
  (select array_agg(a.n order by a.o)
   from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as a(n, m, o)
   where p.oid = 'privado.datos_de_cita(uuid)'::regprocedure and a.m = 't'),
  array['id_lead', 'id_monitoria', 'estado', 'motivo_cancelacion', 'nombre_monitor', 'nombre_materia', 'codigo_materia', 'fecha',
        'hora', 'duracion_min', 'presencial', 'valor_total', 'lugar', 'enlace', 'inicio', 'fin_programado', 'cancelable_hasta',
        'reporte_hasta', 'estado_pago', 'estado_reembolso', 'estado_reporte', 'observaciones_reporte'],
  'privado.datos_de_cita devuelve el id del Lead (para las puertas con sesión) y la cita con sus plazos, los estados del pago, el reembolso y el reporte, y las observaciones del reporte (D-37)');
select is(
  (select array_agg(a.n order by a.o)
   from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as a(n, m, o)
   where p.oid = 'public.cita_por_token(text)'::regprocedure and a.m = 't'),
  array['id_monitoria', 'estado', 'motivo_cancelacion', 'nombre_monitor', 'nombre_materia', 'codigo_materia', 'fecha', 'hora',
        'duracion_min', 'presencial', 'valor_total', 'lugar', 'enlace', 'inicio', 'fin_programado', 'cancelable_hasta',
        'reporte_hasta', 'estado_pago', 'estado_reembolso', 'estado_reporte', 'observaciones_reporte'],
  'cita_por_token devuelve la cita sin el id del Lead, con las observaciones del reporte (D-37)');
select is(
  (select array_agg(a.n order by a.o)
   from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as a(n, m, o)
   where p.oid = 'public.mi_cita(uuid)'::regprocedure and a.m = 't'),
  (select array_agg(a.n order by a.o)
   from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as a(n, m, o)
   where p.oid = 'public.cita_por_token(text)'::regprocedure and a.m = 't'),
  'mi_cita devuelve exactamente las mismas columnas que cita_por_token');
select is(
  (select array_agg(a.n order by a.o)
   from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as a(n, m, o)
   where p.oid = 'public.mis_citas()'::regprocedure and a.m = 't'),
  (select array_agg(a.n order by a.o)
   from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as a(n, m, o)
   where p.oid = 'public.cita_por_token(text)'::regprocedure and a.m = 't'),
  'mis_citas, también');

select has_trigger('public', 'monitoria', 'monitoria_anota_confirmacion_cita',
  'monitoria tiene el trigger monitoria_anota_confirmacion_cita');
select trigger_is('public', 'monitoria', 'monitoria_anota_confirmacion_cita', 'privado', 'anotar_confirmacion_cita',
  'El trigger llama a privado.anotar_confirmacion_cita');
select matches(
  (select pg_get_triggerdef(t.oid) from pg_trigger t
   where t.tgrelid = 'public.monitoria'::regclass and t.tgname = 'monitoria_anota_confirmacion_cita'),
  'AFTER UPDATE OF estado ON public\.monitoria FOR EACH ROW',
  'Corre después de cambiar el estado, por fila (la confirmación sale de la misma transacción del cambio)');

-- Permisos de las funciones: nadie las hereda de PUBLIC y cada una solo la ejecuta quien debe.
select ok(
  not exists (
    select 1
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid in ('privado.anotar_confirmacion_cita()'::regprocedure, 'privado.disparar_confirmaciones_cita()'::regprocedure,
                    'privado.datos_de_cita(uuid)'::regprocedure, 'privado.mi_cita(uuid)'::regprocedure,
                    'privado.mis_citas()'::regprocedure, 'public.datos_de_confirmacion_cita(uuid)'::regprocedure,
                    'public.cita_por_token(text)'::regprocedure, 'public.mi_cita(uuid)'::regprocedure,
                    'public.mis_citas()'::regprocedure)
      and a.grantee = 0),
  'Nadie las hereda de PUBLIC');
select ok(
  not has_function_privilege('anon', 'privado.anotar_confirmacion_cita()', 'execute')
  and not has_function_privilege('authenticated', 'privado.anotar_confirmacion_cita()', 'execute')
  and not has_function_privilege('service_role', 'privado.anotar_confirmacion_cita()', 'execute')
  and not has_function_privilege('anon', 'privado.disparar_confirmaciones_cita()', 'execute')
  and not has_function_privilege('authenticated', 'privado.disparar_confirmaciones_cita()', 'execute')
  and not has_function_privilege('service_role', 'privado.disparar_confirmaciones_cita()', 'execute'),
  'Ni anon, ni authenticated, ni service_role ejecutan la del trigger ni la del pedido a la app: solo el trigger y pg_cron');
select ok(
  has_function_privilege('service_role', 'public.datos_de_confirmacion_cita(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.cita_por_token(text)', 'execute')
  and has_function_privilege('service_role', 'privado.datos_de_cita(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.datos_de_confirmacion_cita(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.cita_por_token(text)', 'execute')
  and not has_function_privilege('authenticated', 'privado.datos_de_cita(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.datos_de_confirmacion_cita(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.cita_por_token(text)', 'execute')
  and not has_function_privilege('anon', 'privado.datos_de_cita(uuid)', 'execute'),
  'datos_de_confirmacion_cita, cita_por_token y privado.datos_de_cita solo las ejecuta service_role: ni anon ni una sesión (no controlan de quién es la cita)');
select ok(
  has_function_privilege('authenticated', 'public.mi_cita(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.mis_citas()', 'execute')
  and has_function_privilege('authenticated', 'privado.mi_cita(uuid)', 'execute')
  and has_function_privilege('authenticated', 'privado.mis_citas()', 'execute')
  and not has_function_privilege('anon', 'public.mi_cita(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.mis_citas()', 'execute')
  and not has_function_privilege('anon', 'privado.mi_cita(uuid)', 'execute')
  and not has_function_privilege('anon', 'privado.mis_citas()', 'execute')
  and not has_function_privilege('service_role', 'public.mi_cita(uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.mis_citas()', 'execute')
  and not has_function_privilege('service_role', 'privado.mi_cita(uuid)', 'execute')
  and not has_function_privilege('service_role', 'privado.mis_citas()', 'execute'),
  'mi_cita y mis_citas (y sus de privado) solo las ejecuta authenticated (la anónima del Lead lo es): ni anon ni service_role, que no tiene sesión');

set local role anon;
select throws_ok($$select * from public.cita_por_token('abc')$$, '42501', null, 'anon no puede pedir una cita por token: permiso denegado');
select throws_ok($$select * from public.mi_cita('50000000-0000-0000-0000-000000001901')$$, '42501', null,
  'anon no puede pedir mi_cita: permiso denegado');
select throws_ok($$select * from public.mis_citas()$$, '42501', null, 'anon no puede pedir mis_citas: permiso denegado');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001901","role":"authenticated"}';
select throws_ok($$select * from public.cita_por_token('abc')$$, '42501', null,
  'Una sesión no puede pedir una cita por token: solo el servidor con la llave secreta (si no, adivinar tokens sería cosa de cualquiera)');
select throws_ok($$select * from public.datos_de_confirmacion_cita('50000000-0000-0000-0000-000000001901')$$, '42501', null,
  'Una sesión no puede pedir los datos del correo de confirmación: permiso denegado');
select throws_ok($$select * from privado.datos_de_cita('50000000-0000-0000-0000-000000001901')$$, '42501', null,
  'Una sesión no puede llamar privado.datos_de_cita, que no controla de quién es la cita');
select throws_ok($$select privado.disparar_confirmaciones_cita()$$, '42501', null,
  'Una sesión no puede pedir el procesamiento de confirmaciones: permiso denegado');
reset role;
set local role service_role;
select throws_ok($$select * from public.mi_cita('50000000-0000-0000-0000-000000001901')$$, '42501', null,
  'service_role no puede llamar mi_cita: no tiene sesión de Lead (usa cita_por_token)');
select throws_ok($$select privado.disparar_confirmaciones_cita()$$, '42501', null,
  'service_role tampoco puede pedir el procesamiento: lo pide el trigger o pg_cron, no la app');
reset role;

-- El trabajo de pg_cron: repite el pedido cada 5 minutos por si una petición se perdió.
select is(
  (select count(*)::int from cron.job where jobname = 'calibra-confirmar-citas'), 1,
  'Existe un solo trabajo calibra-confirmar-citas en pg_cron (reaplicar la migración no lo duplica)');
select results_eq(
  $$select schedule, command, active from cron.job where jobname = 'calibra-confirmar-citas'$$,
  $$values ('*/5 * * * *'::text, 'select privado.disparar_confirmaciones_cita()'::text, true)$$,
  'Corre cada 5 minutos, activo, y llama a privado.disparar_confirmaciones_cita()');

-- ---------------------------------------------------------------------------
-- Fixtures (como postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, is_anonymous) values
  ('a0000000-0000-0000-0000-000000001901', false),
  ('b0000000-0000-0000-0000-0000000019a0', false),
  ('c0000000-0000-0000-0000-000000001901', true),
  ('c0000000-0000-0000-0000-000000001902', true),
  ('c0000000-0000-0000-0000-000000001903', true),
  ('c0000000-0000-0000-0000-000000001904', true),
  ('c0000000-0000-0000-0000-000000001905', true),
  ('c0000000-0000-0000-0000-000000001906', false),
  ('c0000000-0000-0000-0000-000000001907', true);

insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-000000001901', 'Admin', 'admin19@calibra.test', 9001901);
insert into public.monitor (id, nombre) values
  ('b0000000-0000-0000-0000-0000000019a0', 'Ana 19');
insert into public.monitor_privado (id_monitor, numero_telefono, correo, llave) values
  ('b0000000-0000-0000-0000-0000000019a0', '3001900001', 'ana.monitora19@calibra.test', 'llave-ana-19');
insert into public.materia (id, nombre, codigo) values
  ('10000000-0000-0000-0000-0000000019a1', 'Materia 19', 'PGTAP-19');
insert into public.certificado (id_monitor, id_materia, id_admin) values
  ('b0000000-0000-0000-0000-0000000019a0', '10000000-0000-0000-0000-0000000019a1', 'a0000000-0000-0000-0000-000000001901');
insert into public.lead (id, id_sesion_anonima, nombre, numero_telefono, correo, acepta_tratamiento_datos, fecha_consentimiento) values
  ('40000000-0000-0000-0000-000000001901', 'c0000000-0000-0000-0000-000000001901', 'Lucía Prueba 19', '3001901111',
   'lucia.secreta19@calibra.test', true, now()),
  ('40000000-0000-0000-0000-000000001902', 'c0000000-0000-0000-0000-000000001902', 'Mateo Prueba 19', '3001902222',
   'mateo.secreto19@calibra.test', true, now()),
  ('40000000-0000-0000-0000-000000001903', 'c0000000-0000-0000-0000-000000001903', 'Sofía Prueba 19', '3001903333',
   null, true, now()),
  ('40000000-0000-0000-0000-000000001904', 'c0000000-0000-0000-0000-000000001907', 'Dario Prueba 19', '3001904444',
   'dario.secreto19@calibra.test', true, now());
-- La sesión 5 confirmó el correo del Lead 01 desde otro dispositivo (HU-068); la 6 es la cuenta de Estudiante del Lead 02.
insert into public.lead_sesion (id_sesion, id_lead) values
  ('c0000000-0000-0000-0000-000000001905', '40000000-0000-0000-0000-000000001901');
insert into public.estudiante (id, id_lead) values
  ('c0000000-0000-0000-0000-000000001906', '40000000-0000-0000-0000-000000001902');

-- Una franja por monitoría, todas los lunes a las 9:30 en Bogotá: virtuales de 60 min con enlace, salvo la 02 (presencial de
-- 75 min) y la 12 (presencial de 60 min), con lugar.
insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min, lugar, enlace, abierta_desde)
select ('30000000-0000-0000-0000-0000000019' || nn)::uuid,
       'b0000000-0000-0000-0000-0000000019a0'::uuid,
       smallint '1', time '09:30', nn in ('02', '12'), 20000,
       case nn when '02' then 75 else 60 end,
       case when nn in ('02', '12') then 'Salón 19-' || nn end,
       case when nn not in ('02', '12') then 'https://meet.example/19-' || nn end,
       date '2026-01-01'
from unnest(array['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15']) as nn;

-- Monitorías de los lunes de febrero y marzo de 2027. Las insertadas como confirmada no anotan nada: el trigger es de UPDATE.
insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado, motivo_cancelacion, fecha_finalizacion)
select ('50000000-0000-0000-0000-0000000019' || v.nn)::uuid, ('30000000-0000-0000-0000-0000000019' || v.nn)::uuid,
       '10000000-0000-0000-0000-0000000019a1'::uuid, ('40000000-0000-0000-0000-0000000019' || v.lead)::uuid,
       v.fecha, 20000, v.estado, v.motivo, null::timestamptz
from (values
  ('01', '01', date '2027-03-01', 'pendiente_pago'::public.estado_monitoria, null::public.motivo_cancelacion),
  ('02', '02', date '2027-03-01', 'pendiente_pago', null),
  ('03', '03', date '2027-03-01', 'pendiente_pago', null),
  ('04', '01', date '2027-03-08', 'confirmada', null),
  ('05', '01', date '2027-03-01', 'pendiente_pago', null),
  ('06', '01', date '2027-03-01', 'confirmada', null),
  ('07', '01', date '2027-03-01', 'pendiente_pago', null),
  ('08', '01', date '2027-03-01', 'pendiente_pago', null),
  ('09', '01', date '2027-03-15', 'pendiente_pago', null),
  ('10', '02', date '2027-02-22', 'cancelada', 'monitor_no_asistio'),
  ('11', '01', date '2027-02-22', 'cancelada', 'pago_rechazado'),
  ('12', '01', date '2027-03-22', 'confirmada', null),
  ('13', '01', date '2027-02-15', 'cancelada', 'estudiante'),
  ('14', '01', date '2027-02-08', 'cancelada', 'estudiante'),
  ('15', '02', date '2027-03-08', 'confirmada', null)) as v(nn, lead, fecha, estado, motivo);

-- Las grupales: la 05 (por pagar) y la 06 (confirmada).
insert into public.monitoria_grupal (id_monitoria, cupos, modalidad_pago, precio_por_persona) values
  ('50000000-0000-0000-0000-000000001905', 3, 'dividido', 15000),
  ('50000000-0000-0000-0000-000000001906', 3, 'dividido', 15000);

-- Los pagos. Un pago en revisión no tiene fecha de revisión y uno aprobado o rechazado, sí. Los dos de la 03 son de
-- Lead sin correo: su contacto es el correo de respaldo, y el primero por fecha es 'primer.pago19' (se inserta de segundo).
create temporary table pago_19 (id text primary key, nn text not null, estado public.estado_pago not null,
  contacto text not null, fecha_pago timestamptz not null);
insert into pago_19 (id, nn, estado, contacto, fecha_pago) values
  ('0302', '03', 'en_revision', 'segundo.pago19@example.com', timestamptz '2027-02-01 11:00-05'),
  ('0301', '03', 'en_revision', 'primer.pago19@example.com', timestamptz '2027-02-01 10:00-05'),
  ('0401', '04', 'aprobado', 'pagador.secreto19@example.com', timestamptz '2027-02-02 10:00-05'),
  ('0402', '04', 'rechazado', 'pagador.secreto19@example.com', timestamptz '2027-02-02 11:00-05'),
  ('1001', '10', 'aprobado', 'pagador.secreto19@example.com', timestamptz '2027-02-02 10:00-05'),
  ('1101', '11', 'rechazado', 'pagador.secreto19@example.com', timestamptz '2027-02-02 10:00-05'),
  ('1201', '12', 'aprobado', 'pagador.secreto19@example.com', timestamptz '2027-02-02 10:00-05'),
  ('1202', '12', 'en_revision', 'pagador.secreto19@example.com', timestamptz '2027-02-02 11:00-05'),
  ('1301', '13', 'aprobado', 'pagador.secreto19@example.com', timestamptz '2027-02-02 10:00-05'),
  ('1302', '13', 'aprobado', 'pagador.secreto19@example.com', timestamptz '2027-02-02 11:00-05'),
  ('1401', '14', 'aprobado', 'pagador.secreto19@example.com', timestamptz '2027-02-02 10:00-05'),
  ('1501', '15', 'aprobado', 'pagador.secreto19@example.com', timestamptz '2027-02-02 10:00-05');
insert into public.comprobante_revisado (ruta, tipo)
select 'c0000000-0000-0000-0000-000000001901/60000000-0000-0000-0000-00000000' || id || '.pdf', 'application/pdf'
from pago_19;
insert into public.pago (id, id_monitoria, monto, nombre_pagador, contacto, estado, id_admin, fecha_pago, fecha_revision, comprobante)
select ('60000000-0000-0000-0000-00000000' || id)::uuid, ('50000000-0000-0000-0000-0000000019' || nn)::uuid, 20000,
       'Pagador Secreto 19', contacto, estado, 'a0000000-0000-0000-0000-000000001901', fecha_pago,
       case when estado = 'en_revision' then null else now() end,
       'c0000000-0000-0000-0000-000000001901/60000000-0000-0000-0000-00000000' || id || '.pdf'
from pago_19;

-- Los reembolsos: esperando la llave (sin llave), pendiente (con llave) y reembolsado (con fecha y referencia).
insert into public.reembolso (id_pago, id_admin, monto, motivo, llave_destino, estado, fecha_reembolso, referencia_transferencia) values
  ('60000000-0000-0000-0000-000000001001', 'a0000000-0000-0000-0000-000000001901', 20000, 'Prueba', 'llave-reembolso-19', 'pendiente', null, null),
  ('60000000-0000-0000-0000-000000001201', 'a0000000-0000-0000-0000-000000001901', 20000, 'Prueba', null, 'esperando_llave', null, null),
  ('60000000-0000-0000-0000-000000001202', 'a0000000-0000-0000-0000-000000001901', 20000, 'Prueba', 'llave-reembolso-19', 'pendiente', null, null),
  ('60000000-0000-0000-0000-000000001301', 'a0000000-0000-0000-0000-000000001901', 20000, 'Prueba', 'llave-reembolso-19', 'pendiente', null, null),
  ('60000000-0000-0000-0000-000000001302', 'a0000000-0000-0000-0000-000000001901', 20000, 'Prueba', 'llave-reembolso-19', 'reembolsado', now(), 'ref-19-1'),
  ('60000000-0000-0000-0000-000000001401', 'a0000000-0000-0000-0000-000000001901', 20000, 'Prueba', 'llave-reembolso-19', 'reembolsado', now(), 'ref-19-2');

-- Los reportes de inasistencia: uno decidido (la 10) y uno en revisión (la 15).
insert into public.reporte_inasistencia (id_monitoria, id_admin, estado, fecha_decision) values
  ('50000000-0000-0000-0000-000000001910', 'a0000000-0000-0000-0000-000000001901', 'aceptado', now()),
  ('50000000-0000-0000-0000-000000001915', 'a0000000-0000-0000-0000-000000001901', 'en_revision', null);

-- El Lead 04 (sesión 7): 52 citas confirmadas en una sola franja, un lunes tras otro, para el tope de 50.
insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min, lugar, enlace, abierta_desde) values
  ('30000000-0000-0000-0000-000000001970', 'b0000000-0000-0000-0000-0000000019a0', 1, time '09:30', false, 20000, 60, null,
   'https://meet.example/19-70', date '2026-01-01');
insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado)
select ('51000000-0000-0000-0000-0000000019' || lpad(i::text, 2, '0'))::uuid, '30000000-0000-0000-0000-000000001970',
       '10000000-0000-0000-0000-0000000019a1', '40000000-0000-0000-0000-000000001904', date '2027-04-05' + 7 * i, 20000, 'confirmada'
from generate_series(0, 51) as i;

-- Control: las 15 monitorías y las 52 del Lead 04 existen, hay dos grupales y ninguna anotó una confirmación (todas se
-- insertaron: el trigger es de UPDATE OF estado, así que insertar una monitoría ya confirmada no dispara nada).
select ok(
  (select count(*) = 15 from public.monitoria where id::text like '50000000-0000-0000-0000-0000000019%')
  and (select count(*) = 52 from public.monitoria where id::text like '51000000-0000-0000-0000-0000000019%')
  and (select count(*) = 2 from public.monitoria_grupal where id_monitoria::text like '50000000-0000-0000-0000-0000000019%'),
  'Control: las 15 monitorías, las 52 del Lead 04 y las dos grupales existen');
select is(
  (select count(*)::int from public.confirmacion_cita
   where id_monitoria::text like '50000000-0000-0000-0000-0000000019%' or id_monitoria::text like '51000000-0000-0000-0000-0000000019%'),
  0, 'Insertar monitorías (aunque entren confirmadas, como la 04, 06, 12, 15 y las 52) no anota ninguna confirmación: el trigger es solo de UPDATE OF estado');

-- ---------------------------------------------------------------------------
-- El trigger: pendiente_pago -> confirmada anota la confirmación, con su token
-- ---------------------------------------------------------------------------
update public.monitoria set estado = 'confirmada' where id = '50000000-0000-0000-0000-000000001901';
select results_eq(
  $$select procesado_en is null, intentos, creada_en = now() from public.confirmacion_cita
    where id_monitoria = '50000000-0000-0000-0000-000000001901'$$,
  $$values (true, 0, true)$$,
  'pendiente_pago -> confirmada anota exactamente una confirmación, sin procesar, sin intentos y creada en esa transacción');
select ok(
  (select token ~ '^[0-9a-f]{64}$' from public.confirmacion_cita where id_monitoria = '50000000-0000-0000-0000-000000001901'),
  'Su token son 64 caracteres hexadecimales (256 bits)');

update public.monitoria set estado = 'confirmada' where id in
  ('50000000-0000-0000-0000-000000001902', '50000000-0000-0000-0000-000000001903', '50000000-0000-0000-0000-000000001909');
select is(
  (select count(distinct token)::int from public.confirmacion_cita where id_monitoria::text like '50000000-0000-0000-0000-0000000019%'),
  4, 'Cada cita confirmada tiene su propio token: cuatro citas, cuatro tokens distintos');

-- Lo que no se confirma: grupales, otras transiciones y updates que no cambian el estado.
update public.monitoria set estado = 'confirmada' where id = '50000000-0000-0000-0000-000000001905';
select is(
  (select count(*)::int from public.confirmacion_cita where id_monitoria = '50000000-0000-0000-0000-000000001905'),
  0, 'Una grupal que pasa de pendiente_pago a confirmada no anota nada: su confirmación llega con sus HUs');
update public.monitoria set estado = 'cancelada', motivo_cancelacion = 'reserva_expirada'
where id = '50000000-0000-0000-0000-000000001907';
select is(
  (select count(*)::int from public.confirmacion_cita where id_monitoria = '50000000-0000-0000-0000-000000001907'),
  0, 'pendiente_pago -> cancelada (reserva_expirada) no anota nada: la reserva nunca se confirmó');
update public.monitoria set estado = 'cancelada', motivo_cancelacion = 'estudiante'
where id = '50000000-0000-0000-0000-000000001904';
select is(
  (select count(*)::int from public.confirmacion_cita where id_monitoria = '50000000-0000-0000-0000-000000001904'),
  0, 'confirmada -> cancelada no anota nada: solo el paso a confirmada');
update public.monitoria set estado = 'confirmada', motivo_cancelacion = null where id = '50000000-0000-0000-0000-000000001904';
select is(
  (select count(*)::int from public.confirmacion_cita where id_monitoria = '50000000-0000-0000-0000-000000001904'),
  0, 'cancelada -> confirmada tampoco: solo pendiente_pago -> confirmada');
update public.monitoria set valor_total = 25000 where id = '50000000-0000-0000-0000-000000001912';
update public.monitoria set estado = 'confirmada' where id = '50000000-0000-0000-0000-000000001912';
select is(
  (select count(*)::int from public.confirmacion_cita where id_monitoria = '50000000-0000-0000-0000-000000001912'),
  0, 'Un UPDATE que no cambia el estado (otro campo, o el mismo estado) no anota nada');
update public.monitoria set valor_total = 20000 where id = '50000000-0000-0000-0000-000000001912';

-- Una sola confirmación por monitoría y con un solo token: volver atrás y confirmar otra vez no duplica ni cambia el token.
create temporary table token_01 as
  select token from public.confirmacion_cita where id_monitoria = '50000000-0000-0000-0000-000000001901';
update public.confirmacion_cita set procesado_en = timestamptz '2027-02-28 08:00-05' where id_monitoria = '50000000-0000-0000-0000-000000001901';
update public.monitoria set estado = 'pendiente_pago' where id = '50000000-0000-0000-0000-000000001901';
select is(
  (select count(*)::int from public.confirmacion_cita where id_monitoria = '50000000-0000-0000-0000-000000001901'),
  1, 'Volver de confirmada a pendiente_pago no anota ni borra nada: sigue la única confirmación');
update public.monitoria set estado = 'confirmada' where id = '50000000-0000-0000-0000-000000001901';
select results_eq(
  $$select c.token = t.token, c.procesado_en from public.confirmacion_cita c, token_01 t
    where c.id_monitoria = '50000000-0000-0000-0000-000000001901'$$,
  $$values (true, timestamptz '2027-02-28 08:00-05')$$,
  'Confirmarla otra vez no duplica la confirmación (on conflict do nothing), ni le cambia el token ni le borra su procesado_en');
update public.confirmacion_cita set procesado_en = null where id_monitoria = '50000000-0000-0000-0000-000000001901';

-- Las restricciones de la tabla.
select throws_ok(
  $$insert into public.confirmacion_cita (id_monitoria) values ('50000000-0000-0000-0000-000000001901')$$,
  '23505', null, 'Una monitoría no tiene dos confirmaciones (unique id_monitoria)');
select throws_ok(
  $$insert into public.confirmacion_cita (id_monitoria, token) values ('50000000-0000-0000-0000-000000001908', 'no-es-hexadecimal')$$,
  '23514', null, 'El token tiene que ser de 64 hexadecimales en minúscula');
select throws_ok(
  $$insert into public.confirmacion_cita (id_monitoria, token)
    values ('50000000-0000-0000-0000-000000001908', (select token from token_01))$$,
  '23505', null, 'Dos citas no comparten token (unique token)');
select throws_ok(
  $$insert into public.confirmacion_cita (id_monitoria) values ('50000000-0000-0000-0000-000000001999')$$,
  '23503', null, 'La confirmación apunta a una monitoría que existe');
select throws_ok(
  $$update public.confirmacion_cita set intentos = -1 where id_monitoria = '50000000-0000-0000-0000-000000001901'$$,
  '23514', null, 'intentos no puede ser negativo');

-- ---------------------------------------------------------------------------
-- service_role: lee las confirmaciones y las marca como procesadas, nada más
-- ---------------------------------------------------------------------------
set local role service_role;
select is(
  (select count(*)::int from public.confirmacion_cita where id_monitoria::text like '50000000-0000-0000-0000-0000000019%'),
  4, 'service_role lee las confirmaciones (RLS sin políticas no le estorba)');
select lives_ok(
  $$update public.confirmacion_cita set procesado_en = timestamptz '2027-02-28 09:00-05', intentos = 1
    where id_monitoria = '50000000-0000-0000-0000-000000001901'$$,
  'service_role marca una confirmación como procesada y cuenta un intento');
select throws_ok(
  $$update public.confirmacion_cita set token = repeat('a', 64) where id_monitoria = '50000000-0000-0000-0000-000000001902'$$,
  '42501', null, 'service_role no puede cambiar el token: solo procesado_en e intentos');
select throws_ok(
  $$insert into public.confirmacion_cita (id_monitoria) values ('50000000-0000-0000-0000-000000001908')$$,
  '42501', null, 'service_role no puede insertar confirmaciones');
select throws_ok(
  $$delete from public.confirmacion_cita where id_monitoria = '50000000-0000-0000-0000-000000001901'$$,
  '42501', null, 'service_role no puede borrar confirmaciones');
reset role;
update public.confirmacion_cita set procesado_en = null, intentos = 0 where id_monitoria = '50000000-0000-0000-0000-000000001901';

-- ---------------------------------------------------------------------------
-- privado.disparar_confirmaciones_cita: sin Vault no pide nada y no falla
-- ---------------------------------------------------------------------------
-- La prueba no depende de lo que haya en Vault: se quitan (dentro de la transacción) los dos secretos de la app.
delete from vault.secrets where name in ('calibra_sitio_url', 'calibra_cron_secreto');
select ok(
  exists (select 1 from public.confirmacion_cita where procesado_en is null
          and id_monitoria::text like '50000000-0000-0000-0000-0000000019%'),
  'Control: hay confirmaciones pendientes (las de esta prueba) y Vault no trae la configuración de la app');
select is(privado.disparar_confirmaciones_cita(), null::bigint,
  'Con confirmaciones pendientes pero sin configuración en Vault devuelve null y no falla (así en local)');
select vault.create_secret('https://calibra.test/', 'calibra_sitio_url');
select is(privado.disparar_confirmaciones_cita(), null::bigint,
  'Con la dirección de la app pero sin el secreto tampoco pide nada');
select vault.create_secret('secreto-de-prueba-con-al-menos-treinta-y-dos-caracteres', 'calibra_cron_secreto');
select isnt(privado.disparar_confirmaciones_cita(), null::bigint,
  'Con los dos secretos en Vault y confirmaciones pendientes sí pide el procesamiento: devuelve el id de la petición de pg_net');
select ok(
  (select count(*) = 1 from net.http_request_queue
   where url = 'https://calibra.test/api/procesos/confirmar-citas' and method = 'POST'),
  'La petición va a /api/procesos/confirmar-citas de la dirección de la app, sin la barra final de más');

delete from vault.secrets where name in ('calibra_sitio_url', 'calibra_cron_secreto');
update public.confirmacion_cita set procesado_en = now()
where procesado_en is null and id_monitoria::text like '50000000-0000-0000-0000-0000000019%';
select is(privado.disparar_confirmaciones_cita(), null::bigint,
  'Sin confirmaciones pendientes de esta prueba y sin configuración en Vault también devuelve null');
update public.confirmacion_cita set procesado_en = null where id_monitoria::text like '50000000-0000-0000-0000-0000000019%';

-- ---------------------------------------------------------------------------
-- public.datos_de_confirmacion_cita: lo que la app necesita para escribir el correo
-- ---------------------------------------------------------------------------
-- Control: lo que el correo no debe traer sí está en las tablas.
select ok(
  exists (select 1 from public.lead where numero_telefono = '3001901111')
  and exists (select 1 from public.monitor_privado where correo = 'ana.monitora19@calibra.test' and numero_telefono = '3001900001'),
  'Control: el teléfono del Lead y el correo y el teléfono del monitor existen en las tablas');

set local role service_role;
select is((select count(*)::int from public.datos_de_confirmacion_cita('50000000-0000-0000-0000-000000001901')), 1,
  'service_role recibe exactamente una fila de una cita con confirmación');
select results_eq(
  $$select estado::text, grupal, correo_destino, nombre_lead, nombre_monitor, nombre_materia, duracion_min, presencial,
           lugar, enlace, valor_total
    from public.datos_de_confirmacion_cita('50000000-0000-0000-0000-000000001901')$$,
  $$values ('confirmada'::text, false, 'lucia.secreta19@calibra.test'::text, 'Lucía Prueba 19'::text, 'Ana 19'::text,
            'Materia 19'::text, 60, false, null::text, 'https://meet.example/19-01'::text, 20000)$$,
  'La 01: confirmada, individual, al correo del Lead (D-19), con su nombre, el del monitor, la materia, 60 min, virtual con su enlace y 20000');
select results_eq(
  $$select presencial, lugar, enlace, duracion_min from public.datos_de_confirmacion_cita('50000000-0000-0000-0000-000000001902')$$,
  $$values (true, 'Salón 19-02'::text, null::text, 75)$$,
  'La 02, presencial: trae el lugar (D-21: el correo sale con la cita confirmada) y 75 min');
select is(
  (select token from public.datos_de_confirmacion_cita('50000000-0000-0000-0000-000000001901')),
  (select token from public.confirmacion_cita where id_monitoria = '50000000-0000-0000-0000-000000001901'),
  'El token es el de la confirmación anotada: el mismo en el correo y en cada reintento (D-20)');
select results_eq(
  $$select inicio, cancelable_hasta, creada_en = (select creada_en from public.confirmacion_cita
                                                  where id_monitoria = '50000000-0000-0000-0000-000000001901')
    from public.datos_de_confirmacion_cita('50000000-0000-0000-0000-000000001901')$$,
  $$values (timestamptz '2027-03-01 09:30-05', timestamptz '2027-02-28 21:30-05', true)$$,
  'El inicio es la fecha más la hora de la franja en Bogotá (9:30), el plazo para cancelar, 12 h antes (RN-60), y trae cuándo se confirmó');
select is(
  (select correo_destino from public.datos_de_confirmacion_cita('50000000-0000-0000-0000-000000001903')),
  'primer.pago19@example.com',
  'D-19: el Lead sin correo (solo teléfono) recibe en el contacto de su primer pago (el de fecha_pago más antigua), no en el segundo');
select is(
  (select count(*)::int from public.datos_de_confirmacion_cita('50000000-0000-0000-0000-000000001904')), 0,
  'Una monitoría sin confirmación anotada (la 04, insertada ya confirmada): cero filas');
select is((select count(*)::int from public.datos_de_confirmacion_cita(gen_random_uuid())), 0, 'Un id que no existe: cero filas');
select is((select count(*)::int from public.datos_de_confirmacion_cita(null)), 0, 'Un id nulo: cero filas');
select ok(
  not exists (
    select 1 from public.datos_de_confirmacion_cita('50000000-0000-0000-0000-000000001901') d
    where d::text ilike '%3001901111%' or d::text ilike '%3001900001%' or d::text ilike '%ana.monitora19%'
       or d::text ilike '%llave-ana-19%' or d::text ilike '%comision%'),
  'P-37: la fila no trae el teléfono del Lead ni el correo, el teléfono o la llave del monitor, ni nada de comisión');
reset role;

-- La app descarta lo que ya no vale: la fila trae el estado de la cita, para ver que sigue confirmada.
update public.monitoria set estado = 'cancelada', motivo_cancelacion = 'pago_rechazado' where id = '50000000-0000-0000-0000-000000001903';
set local role service_role;
select results_eq(
  $$select estado::text, grupal from public.datos_de_confirmacion_cita('50000000-0000-0000-0000-000000001903')$$,
  $$values ('cancelada'::text, false)$$,
  'Si la cita se canceló antes de procesar la confirmación, la fila lo dice (estado cancelada) y la app descarta el correo');
reset role;
-- Una grupal con confirmación (no la anota el trigger: se inserta a mano) sale con grupal = true.
insert into public.confirmacion_cita (id_monitoria) values ('50000000-0000-0000-0000-000000001906');
set local role service_role;
select is((select grupal from public.datos_de_confirmacion_cita('50000000-0000-0000-0000-000000001906')), true,
  'Una grupal sale con grupal = true (la app no le manda nada)');
reset role;
delete from public.confirmacion_cita where id_monitoria = '50000000-0000-0000-0000-000000001906';

-- ---------------------------------------------------------------------------
-- public.cita_por_token: la cita del enlace del correo
-- ---------------------------------------------------------------------------
set local role service_role;
select results_eq(
  $$select c.id_monitoria::text, c.estado::text, c.motivo_cancelacion::text, c.nombre_monitor, c.nombre_materia, c.codigo_materia,
           c.fecha, c.hora, c.duracion_min, c.presencial, c.valor_total, c.lugar, c.enlace, c.estado_pago, c.estado_reembolso,
           c.estado_reporte
    from public.confirmacion_cita t, public.cita_por_token(t.token) c
    where t.id_monitoria = '50000000-0000-0000-0000-000000001901'$$,
  $$values ('50000000-0000-0000-0000-000000001901'::text, 'confirmada'::text, null::text, 'Ana 19'::text, 'Materia 19'::text,
            'PGTAP-19'::text, date '2027-03-01', time '09:30', 60, false, 20000, null::text, 'https://meet.example/19-01'::text,
            'sin_pagar'::text, null::text, null::text)$$,
  'Con el token de la 01: su cita confirmada, con el enlace de la videollamada (D-21), sin pagos todavía (sin_pagar) y sin reembolso ni reporte');
select results_eq(
  $$select c.inicio, c.fin_programado, c.cancelable_hasta, c.reporte_hasta
    from public.confirmacion_cita t, public.cita_por_token(t.token) c
    where t.id_monitoria = '50000000-0000-0000-0000-000000001901'$$,
  $$values (timestamptz '2027-03-01 09:30-05', timestamptz '2027-03-01 10:30-05', timestamptz '2027-02-28 21:30-05',
            timestamptz '2027-03-02 10:30-05')$$,
  'Los plazos salen del motor: inicio 9:30, fin 10:30, cancelable hasta 12 h antes del inicio (RN-60) y reporte hasta 24 h después del fin (RN-62)');
select is(
  (select c.lugar from public.confirmacion_cita t, public.cita_por_token(t.token) c
   where t.id_monitoria = '50000000-0000-0000-0000-000000001902'),
  'Salón 19-02', 'Una presencial confirmada muestra el lugar (D-21), aunque su pago esté en revisión');
select ok(
  not exists (
    select 1 from public.confirmacion_cita t, public.cita_por_token(t.token) c
    where t.id_monitoria = '50000000-0000-0000-0000-000000001903'
      and c::text ~* '(pago19|pagador|secreto19|3001903333|comision)'),
  'P-37: la cita no trae el contacto de quien pagó ni el teléfono del Lead ni cifras de comisión');

-- Token inventado, mal formado o vacío: nada de ninguna cita (RN-12).
select is((select count(*)::int from public.cita_por_token(encode(extensions.gen_random_bytes(32), 'hex'))), 0,
  'Un token inventado (64 hexadecimales al azar) no devuelve ninguna cita');
select is((select count(*)::int from public.cita_por_token('abc')), 0, 'Un token corto no devuelve ninguna cita');
select is((select count(*)::int from public.cita_por_token('')), 0, 'Un token vacío no devuelve ninguna cita');
select is((select count(*)::int from public.cita_por_token(null)), 0, 'Un token nulo no devuelve ninguna cita');
select is(
  (select count(*)::int from public.cita_por_token((select upper(token) from public.confirmacion_cita
                                                      where id_monitoria = '50000000-0000-0000-0000-000000001901'))),
  0, 'El token real en mayúsculas tampoco: se compara tal cual');
select is(
  (select count(*)::int from public.cita_por_token((select token || ' ' from public.confirmacion_cita
                                                      where id_monitoria = '50000000-0000-0000-0000-000000001901'))),
  0, 'Ni con un espacio de más: la app valida la forma antes de preguntar');
reset role;

-- Lugar y enlace solo con la cita confirmada (D-21): se ocultan si se rechaza el pago (cancelada) y al realizarse.
update public.monitoria set estado = 'cancelada', motivo_cancelacion = 'pago_rechazado' where id = '50000000-0000-0000-0000-000000001902';
update public.monitoria set estado = 'realizada', fecha_finalizacion = timestamptz '2027-03-15 11:00-05'
where id = '50000000-0000-0000-0000-000000001909';
set local role service_role;
select results_eq(
  $$select c.estado::text, c.motivo_cancelacion::text, c.lugar, c.enlace
    from public.confirmacion_cita t, public.cita_por_token(t.token) c
    where t.id_monitoria = '50000000-0000-0000-0000-000000001902'$$,
  $$values ('cancelada'::text, 'pago_rechazado'::text, null::text, null::text)$$,
  'D-21: si se rechaza el pago y la cita queda cancelada, el token sigue mostrando el estado y el motivo, pero ya no el lugar');
select results_eq(
  $$select c.estado::text, c.lugar, c.enlace
    from public.confirmacion_cita t, public.cita_por_token(t.token) c
    where t.id_monitoria = '50000000-0000-0000-0000-000000001909'$$,
  $$values ('realizada'::text, null::text, null::text)$$,
  'D-21: una cita realizada sigue abriéndose con el token (HU-029 reporta con él) pero sin lugar ni enlace');
reset role;

-- ---------------------------------------------------------------------------
-- privado.datos_de_cita: los estados del pago, del reembolso y del reporte, y el lugar y el enlace según el estado
-- ---------------------------------------------------------------------------
select results_eq(
  $$select right(d.id_monitoria::text, 2), d.estado_pago, d.estado_reembolso, d.estado_reporte
    from unnest(array['01', '03', '04', '10', '11', '12', '13', '14', '15']) as nn,
         privado.datos_de_cita(('50000000-0000-0000-0000-0000000019' || nn)::uuid) d
    order by 1$$,
  $$values ('01'::text, 'sin_pagar'::text, null::text, null::text),
           ('03', 'en_revision', null, null),
           ('04', 'rechazado', null, null),
           ('10', 'aprobado', 'pendiente', 'aceptado'),
           ('11', 'rechazado', null, null),
           ('12', 'en_revision', 'esperando_llave', null),
           ('13', 'aprobado', 'pendiente', null),
           ('14', 'aprobado', 'reembolsado', null),
           ('15', 'aprobado', null, 'en_revision')$$,
  'estado_pago: rechazado > en_revision > aprobado > sin_pagar (D-11); estado_reembolso: esperando_llave > pendiente > reembolsado; estado_reporte: el del reporte');
select results_eq(
  $$select right(d.id_monitoria::text, 2), d.estado::text, d.lugar, d.enlace
    from unnest(array['04', '08', '09', '10', '11', '12', '13']) as nn,
         privado.datos_de_cita(('50000000-0000-0000-0000-0000000019' || nn)::uuid) d
    order by 1$$,
  $$values ('04'::text, 'confirmada'::text, null::text, 'https://meet.example/19-04'::text),
           ('08', 'pendiente_pago', null, null),
           ('09', 'realizada', null, null),
           ('10', 'cancelada', null, null),
           ('11', 'cancelada', null, null),
           ('12', 'confirmada', 'Salón 19-12', null),
           ('13', 'cancelada', null, null)$$,
  'D-21: lugar (presencial) o enlace (virtual) solo si la cita está confirmada: ni por pagar, ni realizada, ni cancelada');
select is((select count(*)::int from privado.datos_de_cita('50000000-0000-0000-0000-000000001906')), 0,
  'Una grupal (la 06, confirmada) no es una cita de esta HU: cero filas');
select is((select count(*)::int from privado.datos_de_cita(gen_random_uuid())), 0, 'Un id que no existe: cero filas');

-- ---------------------------------------------------------------------------
-- public.mi_cita: la cita abierta con la sesión, sin el enlace (criterio 4)
-- ---------------------------------------------------------------------------
-- Sesión 1: la que agendó (Lead 01).
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001901","role":"authenticated"}';
select results_eq(
  $$select estado::text, nombre_monitor, nombre_materia, duracion_min, valor_total, lugar, enlace, estado_pago, cancelable_hasta
    from public.mi_cita('50000000-0000-0000-0000-000000001901')$$,
  $$values ('confirmada'::text, 'Ana 19'::text, 'Materia 19'::text, 60, 20000, null::text, 'https://meet.example/19-01'::text,
            'sin_pagar'::text, timestamptz '2027-02-28 21:30-05')$$,
  'El Lead que agendó abre su cita sin el enlace: estado, monitor, materia, valor, el enlace de la videollamada y hasta cuándo puede cancelar');
select ok(
  not exists (
    select 1 from public.mi_cita('50000000-0000-0000-0000-000000001901') c
    where c::text ~* '(lucia|3001901111|3001900001|ana\.monitora|llave-ana|comision)'),
  'P-37: no trae el correo ni el teléfono del Lead, ni el contacto o la llave del monitor, ni nada de comisión');
select is((select estado::text from public.mi_cita('50000000-0000-0000-0000-000000001908')), 'pendiente_pago',
  'Una cita por pagar de la sesión también se abre (la página la lleva a la reserva): estado pendiente_pago, sin lugar ni enlace');
select is((select count(*)::int from public.mi_cita('50000000-0000-0000-0000-000000001902')), 0,
  'La cita de otro Lead (la 02, del Lead 02): cero filas');
select is((select count(*)::int from public.mi_cita('50000000-0000-0000-0000-000000001906')), 0,
  'Una grupal, aunque sea del Lead: cero filas (es otra HU)');
select is((select count(*)::int from public.mi_cita(gen_random_uuid())), 0, 'Un id que no existe: cero filas, igual que una ajena');
select is((select count(*)::int from public.mi_cita(null)), 0, 'Un id nulo: cero filas');
reset role;

-- Sesión 5: otro dispositivo que confirmó el correo del Lead 01 (lead_sesion, HU-068) ve las mismas.
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001905","role":"authenticated"}';
select is((select estado::text from public.mi_cita('50000000-0000-0000-0000-000000001901')), 'confirmada',
  'La sesión que confirmó el correo del Lead (HU-068) abre su cita');
reset role;

-- Sesión 6: la cuenta de Estudiante del Lead 02.
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001906","role":"authenticated"}';
select is((select estado::text from public.mi_cita('50000000-0000-0000-0000-000000001915')), 'confirmada',
  'La cuenta de Estudiante del Lead abre las citas de su Lead');
select is((select count(*)::int from public.mi_cita('50000000-0000-0000-0000-000000001901')), 0,
  'Pero no las de otro Lead');
reset role;

-- Sesión 2 (otro Lead), sesión 4 (anónima sin Lead), monitor, admin y sesión sin sub: ninguna ve la 01.
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001902","role":"authenticated"}';
select is((select count(*)::int from public.mi_cita('50000000-0000-0000-0000-000000001901')), 0,
  'Otra sesión con Lead propio no abre la cita del Lead 01: cero filas');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001904","role":"authenticated"}';
select is((select count(*)::int from public.mi_cita('50000000-0000-0000-0000-000000001901')), 0,
  'Una sesión anónima sin Lead no abre ninguna cita: cero filas');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000019a0","role":"authenticated"}';
select is((select count(*)::int from public.mi_cita('50000000-0000-0000-0000-000000001901')), 0,
  'El monitor de la cita tampoco la abre por aquí (ve su agenda, no la cita del Lead)');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-000000001901","role":"authenticated"}';
select is((select count(*)::int from public.mi_cita('50000000-0000-0000-0000-000000001901')), 0,
  'Un admin tampoco: no es el Lead');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"role":"authenticated"}';
select is((select count(*)::int from public.mi_cita('50000000-0000-0000-0000-000000001901')), 0,
  'Sin identidad en la sesión (sin sub) no hay Lead: cero filas');
reset role;

-- ---------------------------------------------------------------------------
-- public.mis_citas: las citas de la sesión
-- ---------------------------------------------------------------------------
-- Lead 01: sin la 08 (por pagar), la 07 (reserva vencida) ni las grupales 05 y 06; de la más reciente a la más antigua.
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001901","role":"authenticated"}';
select results_eq(
  $$select right(id_monitoria::text, 2), estado::text from public.mis_citas()$$,
  $$values ('12'::text, 'confirmada'::text), ('09', 'realizada'), ('04', 'confirmada'), ('01', 'confirmada'),
           ('11', 'cancelada'), ('13', 'cancelada'), ('14', 'cancelada')$$,
  'Lead 01: sus siete citas por inicio descendente; sin la por pagar (08), la vencida (07) ni las grupales (05 y 06)');
select ok(
  not exists (select 1 from public.mis_citas() c where c::text ~* '(lucia|3001901111|pagador|3001900001|llave-|comision)'),
  'P-37: la lista no trae contacto del Lead, del pagador ni del monitor');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001905","role":"authenticated"}';
select is((select count(*)::int from public.mis_citas()), 7,
  'La sesión que confirmó el correo del Lead (HU-068) ve las mismas siete');
reset role;
-- Lead 02, por su sesión de Estudiante: la 15, la 02 (cancelada por pago rechazado) y la 10 (monitor_no_asistio).
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001906","role":"authenticated"}';
select results_eq(
  $$select right(id_monitoria::text, 2), estado::text, estado_reporte from public.mis_citas()$$,
  $$values ('15'::text, 'confirmada'::text, 'en_revision'::text), ('02', 'cancelada', null), ('10', 'cancelada', 'aceptado')$$,
  'Lead 02: solo las suyas, con el estado del reporte de inasistencia');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001904","role":"authenticated"}';
select is((select count(*)::int from public.mis_citas()), 0, 'Una sesión anónima sin Lead no tiene citas');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000019a0","role":"authenticated"}';
select is((select count(*)::int from public.mis_citas()), 0, 'El monitor no ve citas de Lead por aquí');
reset role;
-- Lead 03: la 03 ya se canceló (pago rechazado), siguió confirmada antes: sigue en su lista.
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001903","role":"authenticated"}';
select results_eq(
  $$select right(id_monitoria::text, 2), estado::text, motivo_cancelacion::text, estado_pago from public.mis_citas()$$,
  $$values ('03'::text, 'cancelada'::text, 'pago_rechazado'::text, 'en_revision'::text)$$,
  'Lead 03 (sin correo): su cita cancelada sigue en la lista, con su motivo');
reset role;
-- Lead 04: 52 citas, solo salen 50, las de fecha más lejana primero.
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001907","role":"authenticated"}';
select is((select count(*)::int from public.mis_citas()), 50, 'El tope de la lista es de 50 citas');
select results_eq(
  $$select (select max(fecha) from public.mis_citas()), (select min(fecha) from public.mis_citas()),
           (select (array_agg(fecha order by inicio desc))[1] from public.mis_citas())$$,
  $$values (date '2027-04-05' + 7 * 51, date '2027-04-05' + 7 * 2, date '2027-04-05' + 7 * 51)$$,
  'Quedan las 50 más recientes (de la fecha 51 a la 2) y la primera es la más lejana');
reset role;

-- ---------------------------------------------------------------------------
-- Si se borra la monitoría, su confirmación se va con ella (on delete cascade)
-- ---------------------------------------------------------------------------
-- (La 08 no tiene pagos, reembolsos ni reportes que lo impidan.)
insert into public.confirmacion_cita (id_monitoria) values ('50000000-0000-0000-0000-000000001908');
delete from public.monitoria where id = '50000000-0000-0000-0000-000000001908';
select is(
  (select count(*)::int from public.confirmacion_cita where id_monitoria = '50000000-0000-0000-0000-000000001908'),
  0, 'Borrar la monitoría borra su confirmación (on delete cascade)');

-- ---------------------------------------------------------------------------
-- Si el pedido a la app falla, el cambio de estado no se cae
-- ---------------------------------------------------------------------------
-- Se reemplaza disparar_confirmaciones_cita por una que falla (como una dirección mal escrita en Vault). El reemplazo se
-- deshace con el rollback. Va al final porque las pruebas de arriba usan la función de verdad.
create or replace function privado.disparar_confirmaciones_cita()
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
values ('30000000-0000-0000-0000-000000001999', 'b0000000-0000-0000-0000-0000000019a0', 1, time '09:30', false, 20000, 60,
        null, 'https://meet.example/19-99', date '2026-01-01');
insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado)
values ('50000000-0000-0000-0000-000000001999', '30000000-0000-0000-0000-000000001999', '10000000-0000-0000-0000-0000000019a1',
        '40000000-0000-0000-0000-000000001901', date '2027-03-01', 20000, 'pendiente_pago');

select lives_ok(
  $$update public.monitoria set estado = 'confirmada' where id = '50000000-0000-0000-0000-000000001999'$$,
  'Con el pedido a la app fallando, confirmar la monitoría no falla');
select results_eq(
  $$select m.estado::text, c.procesado_en is null, c.token ~ '^[0-9a-f]{64}$'
    from public.monitoria m join public.confirmacion_cita c on c.id_monitoria = m.id
    where m.id = '50000000-0000-0000-0000-000000001999'$$,
  $$values ('confirmada'::text, true, true)$$,
  'La monitoría queda confirmada y su confirmación anotada, con su token y pendiente: pg_cron la vuelve a pedir');

select * from finish();
rollback;
