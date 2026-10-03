-- Pruebas pgTAP de cancelar la monitoría individual confirmada hasta 12 h antes (HU-024, RN-60, RN-43, P-07, P-40, D-26 a D-29).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.
--
-- Qué cubre la migración 20261002173529_cancelar_cita.sql:
--   * public.solicitud_llave (el token de la página de la llave de HU-025) y public.cancelacion_cita (la bandeja de salida
--     del correo de cancelación): RLS sin políticas y permisos mínimos. Nadie con sesión las toca; service_role lee ambas y
--     solo marca `procesado_en` e `intentos` en la segunda.
--   * reembolso.id_admin opcional (D-28) y el trigger reembolso_anota_solicitud_llave: cada reembolso tiene su token.
--   * privado.cancelar_cita(id, ahora): los seis resultados (no_existe, no_individual, ya_cancelada, no_cancelable,
--     fuera_de_plazo, cancelada), los bordes de las 12 h con p_ahora (con 12 h exactas todavía se cancela, P-40), la cita
--     agendada con menos de 12 h, el estado y el motivo tras cancelar, la fecha que queda libre, el aviso al monitor de
--     HU-051, un reembolso por pago aprobado (monto completo, motivo exacto D-26, esperando_llave, primer admin activo), ninguno
--     por pagos en revisión ni rechazados, el reembolso sin admin cuando no hay ninguno activo (D-28), la marca
--     en_correo_de_cancelacion según el contacto del pago (D-27) y la foto de cancelacion_cita.
--   * El trigger pago_reembolsa_cancelacion (P-07): aprobar un pago después de cancelar crea su reembolso; rechazarlo, no; ni
--     en una cita cancelada por otro motivo, ni en una confirmada, ni en una grupal.
--   * privado.asignar_reembolsos_sin_admin (D-28) y su trabajo de pg_cron.
--   * Las dos puertas: public.cancelar_cita_por_token (service_role) y public.cancelar_mi_cita (la sesión del Lead, por
--     privado.es_mi_lead), con sus permisos por rol.
--   * public.datos_de_cancelacion_cita y public.llaves_de_cancelacion: lo que la app necesita para escribir el correo.
--   * privado.disparar_cancelaciones_cita y su trabajo de pg_cron: sin Vault no pide nada y nunca tumba la cancelación.
--
-- Todas las fechas son lunes de 2030 (en el futuro: ningún trabajo de pg_cron las toca) y todas las pruebas con la hora
-- fija usan privado.cancelar_cita(id, p_ahora); las puertas usan now(), que dentro de la transacción no cambia. La cita 19
-- es de AYER (en Bogotá), para probar que las puertas responden fuera_de_plazo.
--
-- El turno de admins recorre a TODOS los admins de la base (la semilla, los de desarrollo y los que creen otras pruebas a la
-- vez). Como en registrar_pago.test.sql: los que ya existían se banean dentro de la transacción y los de esta prueba llevan
-- un orden_revision negativo, por delante de cualquier otro (A antes que B).
--
-- Elenco (ids terminados en 24NN; la materia es 'PGTAP-24'):
--   Admins A (-2400) y B (-2399), monitor M (con contacto en monitor_privado). Sesiones: c1 (Lead 01, Lucía), c2 (Lead 02,
--   Mateo), c3 (Lead 03, Sofía, sin correo), c4 (anónima sin Lead), c5 (confirmó el correo del Lead 01, HU-068).
--   Monitorías (cada una con su franja de los lunes a las 9:30, virtual de 60 min):
--     01 confirmada, sin pagos: los bordes de las 12 h, el aviso, la fecha libre   02 confirmada agendada con menos de 12 h
--     03 por pagar   04 realizada   05 cancelada por monitor_no_asistio (reembolsos sin admin, para asignar)
--     06 cancelada por pago_rechazado (con un pago en revisión)   07 cancelada por el estudiante   08 grupal confirmada
--     10 confirmada: pagos aprobados a tres contactos, uno rechazado y uno en revisión   11 confirmada: un pago aprobado
--     12 confirmada: dos pagos en revisión (P-07)   13 confirmada: un pago en revisión   14 confirmada del Lead 03 (sin
--     correo): dos pagos aprobados   15 confirmada del Lead 02, para cancelar sin admin activo   16 y 17 confirmadas del
--     Lead 02 (la puerta de sesión)   18 y 20 confirmadas con token (la puerta por token)   19 confirmada con token y de
--     ayer   21 y 22 confirmadas, sin pagos (el pedido a la app que falla, y el borrado en cascada).
--     25 confirmada: un pago aprobado que ya tiene su reembolso (cancelar no lo duplica)

begin;
create extension if not exists pgtap with schema extensions;

select plan(183);

-- ---------------------------------------------------------------------------
-- Las tablas: RLS sin políticas y permisos mínimos
-- ---------------------------------------------------------------------------
select has_table('public', 'solicitud_llave', 'Existe public.solicitud_llave, el token de la página de la llave');
select columns_are('public', 'solicitud_llave', array['id_reembolso', 'token', 'creada_en', 'en_correo_de_cancelacion'],
  'Sus columnas son el reembolso, el token, cuándo se creó y si el correo de cancelación ya pidió esa llave');
select ok((select relrowsecurity from pg_class where oid = 'public.solicitud_llave'::regclass),
  'RLS está activo en solicitud_llave');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'solicitud_llave'), 0,
  'Sin políticas: RLS le niega todo a anon y authenticated (el trigger inserta como security definer y la app usa la llave secreta)');
select ok(
  not exists (
    select 1
    from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where c.oid = 'public.solicitud_llave'::regclass and a.grantee = 0),
  'Nadie la hereda de PUBLIC');
select ok(
  not has_any_column_privilege('anon', 'public.solicitud_llave', 'select')
  and not has_any_column_privilege('anon', 'public.solicitud_llave', 'insert')
  and not has_any_column_privilege('anon', 'public.solicitud_llave', 'update')
  and not has_any_column_privilege('anon', 'public.solicitud_llave', 'references')
  and not has_table_privilege('anon', 'public.solicitud_llave', 'delete')
  and not has_table_privilege('anon', 'public.solicitud_llave', 'truncate')
  and not has_table_privilege('anon', 'public.solicitud_llave', 'trigger'),
  'anon no tiene ningún permiso sobre solicitud_llave');
select ok(
  not has_any_column_privilege('authenticated', 'public.solicitud_llave', 'select')
  and not has_any_column_privilege('authenticated', 'public.solicitud_llave', 'insert')
  and not has_any_column_privilege('authenticated', 'public.solicitud_llave', 'update')
  and not has_any_column_privilege('authenticated', 'public.solicitud_llave', 'references')
  and not has_table_privilege('authenticated', 'public.solicitud_llave', 'delete')
  and not has_table_privilege('authenticated', 'public.solicitud_llave', 'truncate')
  and not has_table_privilege('authenticated', 'public.solicitud_llave', 'trigger'),
  'authenticated tampoco: ni el Lead ni el monitor ni un admin leen los tokens');
select ok(
  has_table_privilege('service_role', 'public.solicitud_llave', 'select')
  and not has_any_column_privilege('service_role', 'public.solicitud_llave', 'insert')
  and not has_any_column_privilege('service_role', 'public.solicitud_llave', 'update')
  and not has_table_privilege('service_role', 'public.solicitud_llave', 'delete')
  and not has_table_privilege('service_role', 'public.solicitud_llave', 'truncate')
  and not has_any_column_privilege('service_role', 'public.solicitud_llave', 'references')
  and not has_table_privilege('service_role', 'public.solicitud_llave', 'trigger'),
  'service_role solo la lee: las solicitudes las anota el trigger de reembolso');

select has_table('public', 'cancelacion_cita', 'Existe public.cancelacion_cita, la bandeja de salida de los correos de cancelación');
select columns_are('public', 'cancelacion_cita',
  array['id', 'id_monitoria', 'creada_en', 'correo_destino', 'con_pago_en_revision', 'reembolso_a_otro_contacto', 'procesado_en',
        'intentos'],
  'Sus columnas son el id, la monitoría, cuándo se anotó, la foto (destino y banderas) y lo que lleva la app (procesado e intentos)');
select ok((select relrowsecurity from pg_class where oid = 'public.cancelacion_cita'::regclass),
  'RLS está activo en cancelacion_cita');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'cancelacion_cita'), 0,
  'Sin políticas: RLS le niega todo a anon y authenticated');
select ok(
  not exists (
    select 1
    from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where c.oid = 'public.cancelacion_cita'::regclass and a.grantee = 0),
  'Nadie la hereda de PUBLIC');
select ok(
  not has_any_column_privilege('anon', 'public.cancelacion_cita', 'select')
  and not has_any_column_privilege('anon', 'public.cancelacion_cita', 'insert')
  and not has_any_column_privilege('anon', 'public.cancelacion_cita', 'update')
  and not has_any_column_privilege('anon', 'public.cancelacion_cita', 'references')
  and not has_table_privilege('anon', 'public.cancelacion_cita', 'delete')
  and not has_table_privilege('anon', 'public.cancelacion_cita', 'truncate')
  and not has_table_privilege('anon', 'public.cancelacion_cita', 'trigger'),
  'anon no tiene ningún permiso sobre cancelacion_cita');
select ok(
  not has_any_column_privilege('authenticated', 'public.cancelacion_cita', 'select')
  and not has_any_column_privilege('authenticated', 'public.cancelacion_cita', 'insert')
  and not has_any_column_privilege('authenticated', 'public.cancelacion_cita', 'update')
  and not has_any_column_privilege('authenticated', 'public.cancelacion_cita', 'references')
  and not has_table_privilege('authenticated', 'public.cancelacion_cita', 'delete')
  and not has_table_privilege('authenticated', 'public.cancelacion_cita', 'truncate')
  and not has_table_privilege('authenticated', 'public.cancelacion_cita', 'trigger'),
  'authenticated tampoco');
select ok(has_table_privilege('service_role', 'public.cancelacion_cita', 'select'),
  'service_role lee cancelacion_cita (la app busca las pendientes)');
select ok(has_column_privilege('service_role', 'public.cancelacion_cita', 'procesado_en', 'update')
  and has_column_privilege('service_role', 'public.cancelacion_cita', 'intentos', 'update'),
  'service_role actualiza procesado_en e intentos (marca la cancelación como procesada o cuenta una corrida fallida)');
select ok(
  not has_column_privilege('service_role', 'public.cancelacion_cita', 'id', 'update')
  and not has_column_privilege('service_role', 'public.cancelacion_cita', 'id_monitoria', 'update')
  and not has_column_privilege('service_role', 'public.cancelacion_cita', 'creada_en', 'update')
  and not has_column_privilege('service_role', 'public.cancelacion_cita', 'correo_destino', 'update')
  and not has_column_privilege('service_role', 'public.cancelacion_cita', 'con_pago_en_revision', 'update')
  and not has_column_privilege('service_role', 'public.cancelacion_cita', 'reembolso_a_otro_contacto', 'update')
  and not has_table_privilege('service_role', 'public.cancelacion_cita', 'update'),
  'Pero ninguna otra columna: la foto de la cancelación no se reescribe');
select ok(
  not has_any_column_privilege('service_role', 'public.cancelacion_cita', 'insert')
  and not has_table_privilege('service_role', 'public.cancelacion_cita', 'delete')
  and not has_table_privilege('service_role', 'public.cancelacion_cita', 'truncate')
  and not has_any_column_privilege('service_role', 'public.cancelacion_cita', 'references')
  and not has_table_privilege('service_role', 'public.cancelacion_cita', 'trigger'),
  'service_role no inserta, no borra, no trunca: las cancelaciones las anota solo privado.cancelar_cita');

-- Y la prueba de que se aplica de verdad (el permiso se revisa antes que RLS).
set local role anon;
select throws_ok($$select * from public.solicitud_llave$$, '42501', null, 'anon no puede leer solicitud_llave: permiso denegado');
select throws_ok($$select * from public.cancelacion_cita$$, '42501', null, 'anon no puede leer cancelacion_cita: permiso denegado');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000002401","role":"authenticated"}';
select throws_ok($$select token from public.solicitud_llave$$, '42501', null,
  'Una sesión (aunque sea la del Lead de la cita) no puede leer los tokens de las llaves: permiso denegado');
select throws_ok($$update public.cancelacion_cita set procesado_en = now()$$, '42501', null,
  'Una sesión no puede marcar cancelaciones como procesadas');
select throws_ok($$delete from public.cancelacion_cita$$, '42501', null, 'Una sesión no puede borrar cancelaciones');
reset role;

-- D-28: el reembolso puede quedar sin admin.
select col_is_null('public', 'reembolso', 'id_admin', 'D-28: reembolso.id_admin es opcional (sin admin activo el reembolso espera uno)');

-- ---------------------------------------------------------------------------
-- Las funciones y los triggers: definición y permisos
-- ---------------------------------------------------------------------------
select ok(
  to_regprocedure('privado.anotar_solicitud_llave()') is not null
  and to_regprocedure('privado.disparar_cancelaciones_cita()') is not null
  and to_regprocedure('privado.cancelar_cita(uuid, timestamptz)') is not null
  and to_regprocedure('privado.cancelar_cita_por_token(text)') is not null
  and to_regprocedure('privado.cancelar_mi_cita(uuid)') is not null
  and to_regprocedure('privado.reembolsar_pago_aprobado_tarde()') is not null
  and to_regprocedure('privado.asignar_reembolsos_sin_admin()') is not null,
  'Existen las siete de privado: dos triggers, el pedido a la app, el corazón, sus dos puertas y la asignación sin admin');
select ok(
  to_regprocedure('public.cancelar_cita_por_token(text)') is not null
  and to_regprocedure('public.cancelar_mi_cita(uuid)') is not null
  and to_regprocedure('public.datos_de_cancelacion_cita(uuid)') is not null
  and to_regprocedure('public.llaves_de_cancelacion(uuid)') is not null,
  'Existen las cuatro de public: las dos puertas, los datos del correo y las llaves');
select ok(
  (select bool_and(prosecdef) from pg_proc
   where oid in ('privado.anotar_solicitud_llave()'::regprocedure, 'privado.disparar_cancelaciones_cita()'::regprocedure,
                 'privado.cancelar_cita(uuid, timestamptz)'::regprocedure, 'privado.cancelar_cita_por_token(text)'::regprocedure,
                 'privado.cancelar_mi_cita(uuid)'::regprocedure, 'privado.reembolsar_pago_aprobado_tarde()'::regprocedure,
                 'privado.asignar_reembolsos_sin_admin()'::regprocedure))
  and not (select bool_or(prosecdef) from pg_proc
   where oid in ('public.cancelar_cita_por_token(text)'::regprocedure, 'public.cancelar_mi_cita(uuid)'::regprocedure,
                 'public.datos_de_cancelacion_cita(uuid)'::regprocedure, 'public.llaves_de_cancelacion(uuid)'::regprocedure)),
  'Las de privado son security definer; las cuatro de public corren con los permisos de quien llama (security invoker)');
select ok(
  (select bool_and('search_path=""' = any(proconfig)) from pg_proc
   where oid in ('privado.anotar_solicitud_llave()'::regprocedure, 'privado.disparar_cancelaciones_cita()'::regprocedure,
                 'privado.cancelar_cita(uuid, timestamptz)'::regprocedure, 'privado.cancelar_cita_por_token(text)'::regprocedure,
                 'privado.cancelar_mi_cita(uuid)'::regprocedure, 'privado.reembolsar_pago_aprobado_tarde()'::regprocedure,
                 'privado.asignar_reembolsos_sin_admin()'::regprocedure, 'public.cancelar_cita_por_token(text)'::regprocedure,
                 'public.cancelar_mi_cita(uuid)'::regprocedure, 'public.datos_de_cancelacion_cita(uuid)'::regprocedure,
                 'public.llaves_de_cancelacion(uuid)'::regprocedure)),
  'Las once fijan un search_path vacío');
select is(
  array[pg_get_function_result('privado.anotar_solicitud_llave()'::regprocedure),
        pg_get_function_result('privado.reembolsar_pago_aprobado_tarde()'::regprocedure),
        pg_get_function_result('privado.disparar_cancelaciones_cita()'::regprocedure),
        pg_get_function_result('privado.asignar_reembolsos_sin_admin()'::regprocedure),
        pg_get_function_result('privado.cancelar_cita(uuid, timestamptz)'::regprocedure),
        pg_get_function_result('privado.cancelar_cita_por_token(text)'::regprocedure),
        pg_get_function_result('privado.cancelar_mi_cita(uuid)'::regprocedure),
        pg_get_function_result('public.cancelar_cita_por_token(text)'::regprocedure),
        pg_get_function_result('public.cancelar_mi_cita(uuid)'::regprocedure)],
  array['trigger', 'trigger', 'bigint', 'integer', 'text', 'text', 'text', 'text', 'text'],
  'Los triggers devuelven trigger; el pedido a la app, el id de la petición de pg_net; la asignación, cuántos reembolsos asignó; y el corazón y las puertas, el resultado en texto');

-- Columnas de salida: fijas, porque cambiarlas exige drop function y una entrada en PREAMBULOS de scripts/verificar-bd.mjs.
select is(
  (select array_agg(a.n order by a.o)
   from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as a(n, m, o)
   where p.oid = 'public.datos_de_cancelacion_cita(uuid)'::regprocedure and a.m = 't'),
  array['creada_en', 'correo_destino', 'con_pago_en_revision', 'reembolso_a_otro_contacto', 'estado', 'motivo_cancelacion',
        'grupal', 'nombre_lead', 'nombre_materia', 'inicio', 'token_cita'],
  'datos_de_cancelacion_cita devuelve la foto de la cancelación, el estado y el motivo, si es grupal, el Lead, la materia, el inicio y el token de la cita');
select is(
  (select array_agg(a.n order by a.o)
   from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as a(n, m, o)
   where p.oid = 'public.llaves_de_cancelacion(uuid)'::regprocedure and a.m = 't'),
  array['id_reembolso', 'monto', 'token'],
  'llaves_de_cancelacion devuelve el reembolso, su monto y el token de su llave');

select has_trigger('public', 'reembolso', 'reembolso_anota_solicitud_llave', 'reembolso tiene el trigger reembolso_anota_solicitud_llave');
select trigger_is('public', 'reembolso', 'reembolso_anota_solicitud_llave', 'privado', 'anotar_solicitud_llave',
  'El trigger llama a privado.anotar_solicitud_llave');
select matches(
  (select pg_get_triggerdef(t.oid) from pg_trigger t
   where t.tgrelid = 'public.reembolso'::regclass and t.tgname = 'reembolso_anota_solicitud_llave'),
  'AFTER INSERT ON public\.reembolso FOR EACH ROW',
  'Corre después de insertar, por fila: cada reembolso nace con su solicitud de llave');
select has_trigger('public', 'pago', 'pago_reembolsa_cancelacion', 'pago tiene el trigger pago_reembolsa_cancelacion');
select trigger_is('public', 'pago', 'pago_reembolsa_cancelacion', 'privado', 'reembolsar_pago_aprobado_tarde',
  'El trigger llama a privado.reembolsar_pago_aprobado_tarde');
select matches(
  (select pg_get_triggerdef(t.oid) from pg_trigger t
   where t.tgrelid = 'public.pago'::regclass and t.tgname = 'pago_reembolsa_cancelacion'),
  'AFTER UPDATE OF estado ON public\.pago FOR EACH ROW WHEN .*en_revision.*aprobado',
  'Corre después de cambiar el estado, por fila, solo al pasar de en_revision a aprobado (un rechazo nunca se reembolsa, RN-43)');

-- Permisos de las funciones: nadie las hereda de PUBLIC y cada una solo la ejecuta quien debe.
select ok(
  not exists (
    select 1
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid in ('privado.anotar_solicitud_llave()'::regprocedure, 'privado.disparar_cancelaciones_cita()'::regprocedure,
                    'privado.cancelar_cita(uuid, timestamptz)'::regprocedure, 'privado.cancelar_cita_por_token(text)'::regprocedure,
                    'privado.cancelar_mi_cita(uuid)'::regprocedure, 'privado.reembolsar_pago_aprobado_tarde()'::regprocedure,
                    'privado.asignar_reembolsos_sin_admin()'::regprocedure, 'public.cancelar_cita_por_token(text)'::regprocedure,
                    'public.cancelar_mi_cita(uuid)'::regprocedure, 'public.datos_de_cancelacion_cita(uuid)'::regprocedure,
                    'public.llaves_de_cancelacion(uuid)'::regprocedure)
      and a.grantee = 0),
  'Nadie las hereda de PUBLIC');
select ok(
  not has_function_privilege('anon', 'privado.cancelar_cita(uuid, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'privado.cancelar_cita(uuid, timestamptz)', 'execute')
  and not has_function_privilege('service_role', 'privado.cancelar_cita(uuid, timestamptz)', 'execute'),
  'El corazón no lo ejecuta ningún rol: solo las dos puertas (que son del mismo dueño), con la hora de la base');
select ok(
  not has_function_privilege('anon', 'privado.anotar_solicitud_llave()', 'execute')
  and not has_function_privilege('authenticated', 'privado.anotar_solicitud_llave()', 'execute')
  and not has_function_privilege('service_role', 'privado.anotar_solicitud_llave()', 'execute')
  and not has_function_privilege('anon', 'privado.reembolsar_pago_aprobado_tarde()', 'execute')
  and not has_function_privilege('authenticated', 'privado.reembolsar_pago_aprobado_tarde()', 'execute')
  and not has_function_privilege('service_role', 'privado.reembolsar_pago_aprobado_tarde()', 'execute')
  and not has_function_privilege('anon', 'privado.disparar_cancelaciones_cita()', 'execute')
  and not has_function_privilege('authenticated', 'privado.disparar_cancelaciones_cita()', 'execute')
  and not has_function_privilege('service_role', 'privado.disparar_cancelaciones_cita()', 'execute')
  and not has_function_privilege('anon', 'privado.asignar_reembolsos_sin_admin()', 'execute')
  and not has_function_privilege('authenticated', 'privado.asignar_reembolsos_sin_admin()', 'execute')
  and not has_function_privilege('service_role', 'privado.asignar_reembolsos_sin_admin()', 'execute'),
  'Los dos triggers, el pedido a la app y la asignación sin admin no los ejecuta ningún rol: solo los triggers y pg_cron');
select ok(
  has_function_privilege('service_role', 'public.cancelar_cita_por_token(text)', 'execute')
  and has_function_privilege('service_role', 'privado.cancelar_cita_por_token(text)', 'execute')
  and has_function_privilege('service_role', 'public.datos_de_cancelacion_cita(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.llaves_de_cancelacion(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.cancelar_cita_por_token(text)', 'execute')
  and not has_function_privilege('authenticated', 'privado.cancelar_cita_por_token(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.datos_de_cancelacion_cita(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.llaves_de_cancelacion(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.cancelar_cita_por_token(text)', 'execute')
  and not has_function_privilege('anon', 'privado.cancelar_cita_por_token(text)', 'execute')
  and not has_function_privilege('anon', 'public.datos_de_cancelacion_cita(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.llaves_de_cancelacion(uuid)', 'execute'),
  'La puerta por token, los datos del correo y las llaves solo las ejecuta service_role: ni anon ni una sesión (adivinar tokens no es cosa de cualquiera)');
select ok(
  has_function_privilege('authenticated', 'public.cancelar_mi_cita(uuid)', 'execute')
  and has_function_privilege('authenticated', 'privado.cancelar_mi_cita(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.cancelar_mi_cita(uuid)', 'execute')
  and not has_function_privilege('anon', 'privado.cancelar_mi_cita(uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.cancelar_mi_cita(uuid)', 'execute')
  and not has_function_privilege('service_role', 'privado.cancelar_mi_cita(uuid)', 'execute'),
  'La puerta de sesión (y su de privado) solo la ejecuta authenticated (la anónima del Lead lo es): ni anon ni service_role, que no tiene sesión');

set local role anon;
select throws_ok($$select public.cancelar_mi_cita('50000000-0000-0000-0000-000000002401')$$, '42501', null,
  'anon no puede cancelar con la puerta de sesión: permiso denegado');
select throws_ok($$select public.cancelar_cita_por_token('abc')$$, '42501', null,
  'anon no puede cancelar con un token: permiso denegado');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000002401","role":"authenticated"}';
select throws_ok($$select public.cancelar_cita_por_token('abc')$$, '42501', null,
  'Una sesión no puede usar la puerta por token: solo el servidor con la llave secreta');
select throws_ok($$select privado.cancelar_cita_por_token('abc')$$, '42501', null,
  'Ni llamar la de privado');
select throws_ok($$select privado.cancelar_cita('50000000-0000-0000-0000-000000002401', now())$$, '42501', null,
  'Una sesión no puede llamar el corazón con la hora que quiera: permiso denegado');
select throws_ok($$select * from public.datos_de_cancelacion_cita('50000000-0000-0000-0000-000000002401')$$, '42501', null,
  'Una sesión no puede pedir los datos del correo de cancelación: permiso denegado');
select throws_ok($$select * from public.llaves_de_cancelacion('50000000-0000-0000-0000-000000002401')$$, '42501', null,
  'Una sesión no puede pedir los tokens de las llaves: permiso denegado');
select throws_ok($$select privado.disparar_cancelaciones_cita()$$, '42501', null,
  'Una sesión no puede pedir el procesamiento de cancelaciones: permiso denegado');
select throws_ok($$select privado.asignar_reembolsos_sin_admin()$$, '42501', null,
  'Una sesión no puede asignar reembolsos: permiso denegado');
reset role;
set local role service_role;
select throws_ok($$select public.cancelar_mi_cita('50000000-0000-0000-0000-000000002401')$$, '42501', null,
  'service_role no puede llamar cancelar_mi_cita: no tiene sesión de Lead (usa la puerta por token)');
select throws_ok($$select privado.cancelar_cita('50000000-0000-0000-0000-000000002401', now())$$, '42501', null,
  'service_role tampoco puede llamar el corazón: solo las puertas, con la hora de la base');
select throws_ok($$select privado.disparar_cancelaciones_cita()$$, '42501', null,
  'service_role no puede pedir el procesamiento: lo pide cancelar_cita o pg_cron, no la app');
select throws_ok($$select privado.asignar_reembolsos_sin_admin()$$, '42501', null,
  'service_role no puede asignar reembolsos: lo hace pg_cron');
reset role;

-- Los trabajos de pg_cron.
select results_eq(
  $$select jobname, schedule, command, active from cron.job
    where jobname in ('calibra-avisar-cancelaciones', 'calibra-asignar-reembolsos') order by jobname$$,
  $$values ('calibra-asignar-reembolsos'::text, '*/5 * * * *'::text, 'select privado.asignar_reembolsos_sin_admin()'::text, true),
           ('calibra-avisar-cancelaciones', '*/5 * * * *', 'select privado.disparar_cancelaciones_cita()', true)$$,
  'Existen, una sola vez cada uno (reaplicar la migración no los duplica), activos y cada 5 minutos: avisar las cancelaciones (D-27) y asignar los reembolsos sin admin (D-28)');

-- ---------------------------------------------------------------------------
-- Fixtures (como postgres)
-- ---------------------------------------------------------------------------
-- La prueba no depende de lo que haya en Vault: se quitan (dentro de la transacción) los dos secretos de la app. Así las
-- cancelaciones de abajo no piden nada a pg_net y la cola de pg_net solo trae lo que pida esta prueba.
delete from vault.secrets where name in ('calibra_sitio_url', 'calibra_cron_secreto');

-- Cualquier admin que ya existiera queda inactivo durante la prueba.
update auth.users set banned_until = 'infinity' where id in (select id from public.admin);

insert into auth.users (id, is_anonymous) values
  ('a0000000-0000-0000-0000-0000000024a0', false),
  ('a0000000-0000-0000-0000-0000000024b0', false),
  ('b0000000-0000-0000-0000-000000002401', false),
  ('c0000000-0000-0000-0000-000000002401', true),
  ('c0000000-0000-0000-0000-000000002402', true),
  ('c0000000-0000-0000-0000-000000002403', true),
  ('c0000000-0000-0000-0000-000000002404', true),
  ('c0000000-0000-0000-0000-000000002405', true);

insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-0000000024a0', 'Admin A', 'admin-a-hu024@calibra.test', -2400),
  ('a0000000-0000-0000-0000-0000000024b0', 'Admin B', 'admin-b-hu024@calibra.test', -2399);
insert into public.monitor (id, nombre) values ('b0000000-0000-0000-0000-000000002401', 'Ana 24');
insert into public.monitor_privado (id_monitor, numero_telefono, correo, llave) values
  ('b0000000-0000-0000-0000-000000002401', '3002400001', 'ana.monitora24@calibra.test', 'llave-ana-24');
insert into public.materia (id, nombre, codigo) values ('10000000-0000-0000-0000-000000002401', 'Materia 24', 'PGTAP-24');
insert into public.certificado (id_monitor, id_materia, id_admin) values
  ('b0000000-0000-0000-0000-000000002401', '10000000-0000-0000-0000-000000002401', 'a0000000-0000-0000-0000-0000000024a0');
insert into public.lead (id, id_sesion_anonima, nombre, numero_telefono, correo, acepta_tratamiento_datos, fecha_consentimiento) values
  ('40000000-0000-0000-0000-000000002401', 'c0000000-0000-0000-0000-000000002401', 'Lucía Prueba 24', '3002411111',
   'lucia24@calibra.test', true, now()),
  ('40000000-0000-0000-0000-000000002402', 'c0000000-0000-0000-0000-000000002402', 'Mateo Prueba 24', '3002422222',
   'mateo24@calibra.test', true, now()),
  ('40000000-0000-0000-0000-000000002403', 'c0000000-0000-0000-0000-000000002403', 'Sofía Prueba 24', '3002433333',
   null, true, now());
-- La sesión 5 confirmó el correo del Lead 01 desde otro dispositivo (HU-068).
insert into public.lead_sesion (id_sesion, id_lead) values
  ('c0000000-0000-0000-0000-000000002405', '40000000-0000-0000-0000-000000002401');

-- aislar(): vuelve a desactivar a cualquier admin que no sea de la prueba. La base local la pueden estar usando otras
-- pruebas a la vez (integración, e2e) y crear admins mientras esta corre; el turno los vería.
create procedure pg_temp.aislar()
language sql security definer set search_path = ''
as $$
  update auth.users set banned_until = 'infinity'
  where id in (select id from public.admin
               where id not in ('a0000000-0000-0000-0000-0000000024a0', 'a0000000-0000-0000-0000-0000000024b0'))
    and (banned_until is null or banned_until <= now());
$$;
call pg_temp.aislar();

-- Una franja por monitoría, todas los lunes a las 9:30 en Bogotá, virtuales de 60 min. La 19 es la de ayer: su día es el
-- de la semana de ayer.
insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min, lugar, enlace, abierta_desde)
select ('30000000-0000-0000-0000-0000000024' || nn)::uuid,
       'b0000000-0000-0000-0000-000000002401'::uuid,
       case when nn = '19'
            then extract(isodow from (now() at time zone 'America/Bogota')::date - 1)::smallint
            else smallint '1' end,
       time '09:30', false, 20000, 60, null, 'https://meet.example/24-' || nn, date '2026-01-01'
from unnest(array['01', '02', '03', '04', '05', '06', '07', '08', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19',
                  '20', '21', '22', '25']) as nn;

-- Monitorías de los lunes de 2030 (la nn - 1 semanas después del 4 de marzo), salvo la 19 (ayer). Las que llevan token de
-- confirmación (18, 19 y 20) se crean por pagar y se confirman con un UPDATE: el trigger de HU-019 anota el token.
insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado, motivo_cancelacion,
                              fecha_finalizacion, fecha_creacion)
select ('50000000-0000-0000-0000-0000000024' || v.nn)::uuid, ('30000000-0000-0000-0000-0000000024' || v.nn)::uuid,
       '10000000-0000-0000-0000-000000002401'::uuid, ('40000000-0000-0000-0000-0000000024' || v.lead)::uuid,
       case when v.nn = '19' then (now() at time zone 'America/Bogota')::date - 1
            else date '2030-03-04' + 7 * (v.nn::int - 1) end,
       20000, v.estado, v.motivo, v.finalizada, coalesce(v.creada, now())
from (values
  ('01', '01', 'confirmada'::public.estado_monitoria, null::public.motivo_cancelacion, null::timestamptz, null::timestamptz),
  -- La 02 se agendó a las 2:00 del día de la sesión: con menos de 12 h de antelación (RN-37).
  ('02', '01', 'confirmada', null, null, timestamptz '2030-03-11 02:00-05'),
  ('03', '01', 'pendiente_pago', null, null, null),
  ('04', '01', 'realizada', null, timestamptz '2030-03-25 11:00-05', null),
  ('05', '01', 'cancelada', 'monitor_no_asistio', null, null),
  ('06', '01', 'cancelada', 'pago_rechazado', null, null),
  ('07', '01', 'cancelada', 'estudiante', null, null),
  ('08', '01', 'confirmada', null, null, null),
  ('10', '01', 'confirmada', null, null, null),
  ('11', '01', 'confirmada', null, null, null),
  ('12', '01', 'confirmada', null, null, null),
  ('13', '01', 'confirmada', null, null, null),
  ('14', '03', 'confirmada', null, null, null),
  ('15', '02', 'confirmada', null, null, null),
  ('16', '02', 'confirmada', null, null, null),
  ('17', '02', 'confirmada', null, null, null),
  ('18', '01', 'pendiente_pago', null, null, null),
  ('19', '01', 'pendiente_pago', null, null, null),
  ('20', '02', 'pendiente_pago', null, null, null),
  ('21', '01', 'confirmada', null, null, null),
  ('22', '01', 'confirmada', null, null, null),
  ('25', '01', 'confirmada', null, null, null)) as v(nn, lead, estado, motivo, finalizada, creada);
update public.monitoria set estado = 'confirmada'
where id in ('50000000-0000-0000-0000-000000002418', '50000000-0000-0000-0000-000000002419', '50000000-0000-0000-0000-000000002420');

-- La grupal: la 08.
insert into public.monitoria_grupal (id_monitoria, cupos, modalidad_pago, precio_por_persona) values
  ('50000000-0000-0000-0000-000000002408', 3, 'dividido', 15000);

-- Los pagos. Un pago en revisión no tiene fecha de revisión y uno aprobado o rechazado, sí.
create temporary table pago_24 (id text primary key, nn text not null, estado public.estado_pago not null,
  contacto text not null, monto integer not null, fecha_pago timestamptz not null);
insert into pago_24 (id, nn, estado, contacto, monto, fecha_pago) values
  ('0501', '05', 'aprobado', 'mateo24@calibra.test', 20000, timestamptz '2030-02-01 10:00-05'),
  ('0502', '05', 'aprobado', 'mateo24@calibra.test', 20000, timestamptz '2030-02-01 11:00-05'),
  ('0503', '05', 'aprobado', 'mateo24@calibra.test', 20000, timestamptz '2030-02-01 12:00-05'),
  ('0601', '06', 'en_revision', 'lucia24@calibra.test', 20000, timestamptz '2030-02-01 10:00-05'),
  ('0801', '08', 'en_revision', 'lucia24@calibra.test', 20000, timestamptz '2030-02-01 10:00-05'),
  -- La 10: tres contactos. El del Lead tal cual, el mismo con mayúsculas y espacios, y otro.
  ('1001', '10', 'aprobado', 'lucia24@calibra.test', 10000, timestamptz '2030-02-02 10:00-05'),
  ('1002', '10', 'aprobado', ' LUCIA24@Calibra.test ', 6000, timestamptz '2030-02-02 11:00-05'),
  ('1003', '10', 'aprobado', 'otro24@example.com', 4000, timestamptz '2030-02-02 12:00-05'),
  ('1004', '10', 'rechazado', 'lucia24@calibra.test', 20000, timestamptz '2030-02-02 13:00-05'),
  ('1005', '10', 'en_revision', 'lucia24@calibra.test', 3000, timestamptz '2030-02-02 14:00-05'),
  ('1101', '11', 'aprobado', 'lucia24@calibra.test', 20000, timestamptz '2030-02-02 10:00-05'),
  ('1201', '12', 'en_revision', 'lucia24@calibra.test', 12000, timestamptz '2030-02-02 10:00-05'),
  ('1202', '12', 'en_revision', 'lucia24@calibra.test', 8000, timestamptz '2030-02-02 11:00-05'),
  ('1301', '13', 'en_revision', 'lucia24@calibra.test', 20000, timestamptz '2030-02-02 10:00-05'),
  -- La 14 es de un Lead sin correo: el correo va al contacto de su primer pago por fecha, el 1401 (se inserta de segundo).
  ('1402', '14', 'aprobado', 'segundo24@example.com', 8000, timestamptz '2030-02-02 11:00-05'),
  ('1401', '14', 'aprobado', 'pagador24@example.com', 12000, timestamptz '2030-02-02 10:00-05'),
  ('1501', '15', 'aprobado', 'mateo24@calibra.test', 20000, timestamptz '2030-02-02 10:00-05'),
  ('1601', '16', 'aprobado', 'mateo24@calibra.test', 20000, timestamptz '2030-02-02 10:00-05'),
  ('1801', '18', 'aprobado', 'lucia24@calibra.test', 20000, timestamptz '2030-02-02 10:00-05'),
  -- La 25: un pago aprobado que ya tiene su reembolso (por ejemplo, de un camino anterior): cancelar no lo duplica.
  ('2501', '25', 'aprobado', 'lucia24@calibra.test', 20000, timestamptz '2030-02-02 10:00-05');
insert into public.comprobante_revisado (ruta, tipo)
select 'c0000000-0000-0000-0000-000000002401/60000000-0000-0000-0000-00000000' || id || '.pdf', 'application/pdf'
from pago_24;
insert into public.pago (id, id_monitoria, monto, nombre_pagador, contacto, estado, id_admin, fecha_pago, fecha_revision, comprobante)
select ('60000000-0000-0000-0000-00000000' || id)::uuid, ('50000000-0000-0000-0000-0000000024' || nn)::uuid, monto,
       'Pagador Secreto 24', contacto, estado, 'a0000000-0000-0000-0000-0000000024a0', fecha_pago,
       case when estado = 'en_revision' then null else now() end,
       'c0000000-0000-0000-0000-000000002401/60000000-0000-0000-0000-00000000' || id || '.pdf'
from pago_24;

-- Reembolsos que ya existen sin admin (de la 05, cancelada por inasistencia): para probar la asignación (D-28). Pendiente
-- (con llave), reembolsado (con fecha y referencia) y esperando la llave.
insert into public.reembolso (id_pago, id_admin, monto, motivo, llave_destino, estado, fecha_reembolso, referencia_transferencia) values
  ('60000000-0000-0000-0000-000000000501', null, 20000, 'Prueba', 'llave-reembolso-24', 'pendiente', null, null),
  ('60000000-0000-0000-0000-000000000502', null, 20000, 'Prueba', 'llave-reembolso-24', 'reembolsado', now(), 'ref-24-1'),
  ('60000000-0000-0000-0000-000000000503', null, 20000, 'Prueba', null, 'esperando_llave', null, null);
-- El reembolso previo del pago 2501 (de la 25), con su admin y un motivo propio para ver que nadie lo pisa.
insert into public.reembolso (id_pago, id_admin, monto, motivo) values
  ('60000000-0000-0000-0000-000000002501', 'a0000000-0000-0000-0000-0000000024a0', 20000, 'Reembolso previo');

-- Control: las monitorías, los pagos y la grupal existen; hay tres confirmadas con token; el turno de admins da A; y ninguna
-- cancelación está anotada todavía.
select ok(
  (select count(*) = 22 from public.monitoria where id::text like '50000000-0000-0000-0000-0000000024%')
  and (select count(*) = 20 from public.pago where id::text like '60000000-0000-0000-0000-00000000%'
         and id_monitoria::text like '50000000-0000-0000-0000-0000000024%')
  and exists (select 1 from public.monitoria_grupal where id_monitoria = '50000000-0000-0000-0000-000000002408')
  and (select count(*) = 3 from public.confirmacion_cita where id_monitoria::text like '50000000-0000-0000-0000-0000000024%')
  and privado.siguiente_admin_activo() = 'a0000000-0000-0000-0000-0000000024a0'
  and not exists (select 1 from public.cancelacion_cita where id_monitoria::text like '50000000-0000-0000-0000-0000000024%'),
  'Control: las 22 monitorías, los 20 pagos, la grupal, los 3 tokens existen, el primer admin activo es A y no hay cancelaciones anotadas');
select is(
  (select count(*)::int from public.solicitud_llave s join public.reembolso r on r.id = s.id_reembolso
   where r.id_pago::text like '60000000-0000-0000-0000-00000000050_'),
  3, 'El trigger de reembolso anotó la solicitud de llave de los tres reembolsos insertados a mano, sin pedirla en el correo');

-- ---------------------------------------------------------------------------
-- privado.cancelar_cita: los resultados que no cancelan
-- ---------------------------------------------------------------------------
select is(privado.cancelar_cita(gen_random_uuid(), timestamptz '2030-01-01 00:00-05'), 'no_existe',
  'Un id que no existe: no_existe');
select is(privado.cancelar_cita(null, timestamptz '2030-01-01 00:00-05'), 'no_existe', 'Un id nulo: no_existe');
select is(privado.cancelar_cita('50000000-0000-0000-0000-000000002408', timestamptz '2030-01-01 00:00-05'), 'no_individual',
  'Una grupal (la 08, confirmada): no_individual, aunque esté en plazo');
select results_eq(
  $$select right(m.id::text, 2), privado.cancelar_cita(m.id, timestamptz '2030-01-01 00:00-05')
    from public.monitoria m where m.id::text like '50000000-0000-0000-0000-0000000024%' and right(m.id::text, 2) in ('03', '04', '05', '06')
    order by 1$$,
  $$values ('03'::text, 'no_cancelable'::text), ('04', 'no_cancelable'), ('05', 'no_cancelable'), ('06', 'no_cancelable')$$,
  'D-29: solo se cancelan las confirmadas: por pagar (03), realizada (04), cancelada por inasistencia (05) o por pago rechazado (06) son no_cancelable');
select results_eq(
  $$select right(m.id::text, 2), m.estado::text, m.motivo_cancelacion::text
    from public.monitoria m where right(m.id::text, 2) in ('03', '04', '05', '06', '08') and m.id::text like '50000000-0000-0000-0000-0000000024%'
    order by 1$$,
  $$values ('03'::text, 'pendiente_pago'::text, null::text), ('04', 'realizada', null), ('05', 'cancelada', 'monitor_no_asistio'),
           ('06', 'cancelada', 'pago_rechazado'), ('08', 'confirmada', null)$$,
  'Y ninguna cambió de estado ni de motivo');
select is(privado.cancelar_cita('50000000-0000-0000-0000-000000002407', timestamptz '2030-01-01 00:00-05'), 'ya_cancelada',
  'La que el estudiante ya canceló (la 07): ya_cancelada');

-- RN-37: la 02 se agendó a las 2:00 del día de la sesión, con la sesión a las 9:30: nace con el plazo vencido (el plazo
-- terminó 12 h antes del inicio, el día anterior a las 21:30).
select results_eq(
  $$select a.h, privado.cancelar_cita('50000000-0000-0000-0000-000000002402', a.h)
    from unnest(array[timestamptz '2030-03-11 02:00-05', timestamptz '2030-03-11 09:30-05', timestamptz '2030-03-11 10:00-05']) as a(h)
    order by a.h$$,
  $$values (timestamptz '2030-03-11 02:00-05', 'fuera_de_plazo'::text), (timestamptz '2030-03-11 09:30-05', 'fuera_de_plazo'),
           (timestamptz '2030-03-11 10:00-05', 'fuera_de_plazo')$$,
  'Una cita agendada con menos de 12 h: fuera_de_plazo desde el mismo instante en que se agenda (y también en el inicio y después)');
select is(privado.cancelar_cita('50000000-0000-0000-0000-000000002402', null), 'fuera_de_plazo',
  'Sin hora (nunca debería) no se cancela nada: fuera_de_plazo');
select results_eq(
  $$select m.estado::text, m.motivo_cancelacion::text,
           (select count(*)::int from public.cancelacion_cita c where c.id_monitoria = m.id),
           (select count(*)::int from public.aviso_monitor a where a.id_monitoria = m.id)
    from public.monitoria m where m.id = '50000000-0000-0000-0000-000000002402'$$,
  $$values ('confirmada'::text, null::text, 0, 0)$$,
  'La 02 sigue confirmada, sin cancelación anotada ni aviso al monitor');

-- ---------------------------------------------------------------------------
-- Los bordes de las 12 h (P-40) y la fecha que queda libre
-- ---------------------------------------------------------------------------
-- La 01 es el lunes 4 de marzo de 2030 a las 9:30 (Bogotá): el plazo termina el domingo 3 a las 21:30.
select throws_ok(
  $$insert into public.monitoria (id_franja, id_materia, id_lead, fecha, valor_total)
    values ('30000000-0000-0000-0000-000000002401', '10000000-0000-0000-0000-000000002401',
            '40000000-0000-0000-0000-000000002402', date '2030-03-04', 20000)$$,
  '23505', null, 'Control: mientras la 01 está confirmada, nadie más agenda su franja ese día (RN-33)');
select is(privado.cancelar_cita('50000000-0000-0000-0000-000000002401', timestamptz '2030-03-03 21:30:01-05'), 'fuera_de_plazo',
  'Un segundo después de las 12 h antes del inicio: fuera_de_plazo');
select results_eq(
  $$select m.estado::text, m.motivo_cancelacion::text,
           (select count(*)::int from public.cancelacion_cita c where c.id_monitoria = m.id),
           (select count(*)::int from public.aviso_monitor a where a.id_monitoria = m.id)
    from public.monitoria m where m.id = '50000000-0000-0000-0000-000000002401'$$,
  $$values ('confirmada'::text, null::text, 0, 0)$$,
  'Y no se hizo nada: sigue confirmada, sin cancelación anotada ni aviso al monitor');
select is(privado.cancelar_cita('50000000-0000-0000-0000-000000002401', timestamptz '2030-03-03 21:30:00-05'), 'cancelada',
  'Con las 12 h exactas todavía se cancela (borde inclusivo, P-40): cancelada');
select results_eq(
  $$select estado::text, motivo_cancelacion::text from public.monitoria where id = '50000000-0000-0000-0000-000000002401'$$,
  $$values ('cancelada'::text, 'estudiante'::text)$$,
  'La monitoría quedó cancelada con motivo estudiante');
select lives_ok(
  $$insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total)
    values ('50000000-0000-0000-0000-000000002423', '30000000-0000-0000-0000-000000002401',
            '10000000-0000-0000-0000-000000002401', '40000000-0000-0000-0000-000000002402', date '2030-03-04', 20000)$$,
  'La fecha quedó libre: otra persona puede agendar esa misma franja ese mismo día (RN-33)');
select results_eq(
  $$select evento, procesado_en is null from public.aviso_monitor where id_monitoria = '50000000-0000-0000-0000-000000002401'$$,
  $$values ('cancelada'::text, true)$$,
  'HU-051: el trigger anotó el aviso «cancelada» para el monitor, sin procesar');
select results_eq(
  $$select correo_destino, con_pago_en_revision, reembolso_a_otro_contacto, procesado_en is null, intentos
    from public.cancelacion_cita where id_monitoria = '50000000-0000-0000-0000-000000002401'$$,
  $$values ('lucia24@calibra.test'::text, false, false, true, 0)$$,
  'Anotó el correo de cancelación al correo del Lead, sin pago en revisión ni reembolso a otro contacto, pendiente y sin intentos');
select is(
  (select count(*)::int from public.reembolso r join public.pago p on p.id = r.id_pago
   where p.id_monitoria = '50000000-0000-0000-0000-000000002401'),
  0, 'La 01 no tenía pagos: no hay reembolsos');
select is(privado.cancelar_cita('50000000-0000-0000-0000-000000002401', timestamptz '2030-03-03 21:30:00-05'), 'ya_cancelada',
  'Cancelarla otra vez (un doble clic): ya_cancelada');
select results_eq(
  $$select (select count(*)::int from public.cancelacion_cita where id_monitoria = '50000000-0000-0000-0000-000000002401'),
           (select count(*)::int from public.aviso_monitor where id_monitoria = '50000000-0000-0000-0000-000000002401')$$,
  $$values (1, 1)$$,
  'Y no duplicó nada: una sola cancelación y un solo aviso');

-- ---------------------------------------------------------------------------
-- Con pagos aprobados: un reembolso por pago (RN-43, D-26, D-27)
-- ---------------------------------------------------------------------------
-- La 10 tiene tres pagos aprobados (10000, 6000 y 4000, a tres contactos), uno rechazado y uno en revisión.
select is(privado.cancelar_cita('50000000-0000-0000-0000-000000002410', timestamptz '2030-01-01 00:00-05'), 'cancelada',
  'La 10, confirmada y en plazo: cancelada');
select results_eq(
  $$select right(r.id_pago::text, 4), r.monto, r.motivo, r.estado::text, r.id_admin = 'a0000000-0000-0000-0000-0000000024a0', r.llave_destino is null
    from public.reembolso r join public.pago p on p.id = r.id_pago
    where p.id_monitoria = '50000000-0000-0000-0000-000000002410' order by 1$$,
  $$values ('1001'::text, 10000, 'Cancelaste la monitoría dentro del plazo.'::text, 'esperando_llave'::text, true, true),
           ('1002', 6000, 'Cancelaste la monitoría dentro del plazo.', 'esperando_llave', true, true),
           ('1003', 4000, 'Cancelaste la monitoría dentro del plazo.', 'esperando_llave', true, true)$$,
  'Un reembolso por cada pago aprobado, por su monto completo, con el motivo exacto (D-26), esperando la llave y asignado al primer admin activo (A)');
select is(
  (select count(*)::int from public.reembolso where id_pago in
    ('60000000-0000-0000-0000-000000001004', '60000000-0000-0000-0000-000000001005')),
  0, 'Ninguno por el pago rechazado (RN-43) ni por el que sigue en revisión (P-07)');
select results_eq(
  $$select right(p.id::text, 4), p.estado::text from public.pago p where p.id_monitoria = '50000000-0000-0000-0000-000000002410' order by 1$$,
  $$values ('1001'::text, 'aprobado'::text), ('1002', 'aprobado'), ('1003', 'aprobado'), ('1004', 'rechazado'), ('1005', 'en_revision')$$,
  'Los pagos no cambian de estado');
select results_eq(
  $$select right(r.id_pago::text, 4), s.token ~ '^[0-9a-f]{64}$', s.en_correo_de_cancelacion
    from public.reembolso r join public.pago p on p.id = r.id_pago join public.solicitud_llave s on s.id_reembolso = r.id
    where p.id_monitoria = '50000000-0000-0000-0000-000000002410' order by 1$$,
  $$values ('1001'::text, true, true), ('1002', true, true), ('1003', true, false)$$,
  'Cada reembolso tiene su solicitud de llave con un token de 256 bits; el correo pide la de los pagos hechos desde el correo del Lead (igual, o igual con mayúsculas y espacios) y no la del otro contacto (D-27)');
select is(
  (select count(distinct s.token)::int from public.solicitud_llave s join public.reembolso r on r.id = s.id_reembolso
   join public.pago p on p.id = r.id_pago where p.id_monitoria = '50000000-0000-0000-0000-000000002410'),
  3, 'Los tres tokens son distintos');
select results_eq(
  $$select correo_destino, con_pago_en_revision, reembolso_a_otro_contacto, procesado_en is null, intentos
    from public.cancelacion_cita where id_monitoria = '50000000-0000-0000-0000-000000002410'$$,
  $$values ('lucia24@calibra.test'::text, true, true, true, 0)$$,
  'La foto: correo del Lead, con un pago en revisión (P-07), con un reembolso a otro contacto, pendiente y sin intentos');

-- La 12: dos pagos en revisión (P-07). Cancelar no crea reembolsos; aprobar el 1201 después sí, y rechazar el 1202, no.
select is(privado.cancelar_cita('50000000-0000-0000-0000-000000002412', timestamptz '2030-01-01 00:00-05'), 'cancelada',
  'La 12, con dos pagos en revisión: cancelada');
select is(
  (select count(*)::int from public.reembolso r join public.pago p on p.id = r.id_pago
   where p.id_monitoria = '50000000-0000-0000-0000-000000002412'),
  0, 'Sin pagos aprobados, no hay reembolsos todavía');
select results_eq(
  $$select correo_destino, con_pago_en_revision, reembolso_a_otro_contacto
    from public.cancelacion_cita where id_monitoria = '50000000-0000-0000-0000-000000002412'$$,
  $$values ('lucia24@calibra.test'::text, true, false)$$,
  'La foto dice que había pagos en revisión (el correo explica que la llave se pide solo si se aprueban) y que no hay reembolso a otro contacto');

-- P-07: el admin aprueba el 1201 después de la cancelación.
update public.pago set estado = 'aprobado', fecha_revision = now() where id = '60000000-0000-0000-0000-000000001201';
select results_eq(
  $$select r.monto, r.motivo, r.estado::text, r.id_admin = 'a0000000-0000-0000-0000-0000000024a0', r.llave_destino is null,
           s.token ~ '^[0-9a-f]{64}$', s.en_correo_de_cancelacion
    from public.reembolso r join public.solicitud_llave s on s.id_reembolso = r.id
    where r.id_pago = '60000000-0000-0000-0000-000000001201'$$,
  $$values (12000, 'Cancelaste la monitoría dentro del plazo.'::text, 'esperando_llave'::text, true, true, true, false)$$,
  'P-07: aprobar el pago después de cancelar crea su reembolso (monto completo, motivo exacto, esperando la llave, primer admin activo) y su solicitud de llave sin pedirla en el correo de cancelación (la pide HU-025)');
update public.pago set estado = 'rechazado', fecha_revision = now() where id = '60000000-0000-0000-0000-000000001202';
select is(
  (select count(*)::int from public.reembolso where id_pago = '60000000-0000-0000-0000-000000001202'),
  0, 'RN-43: rechazar el otro pago no crea reembolso');
-- Aprobarlo otra vez (se devuelve a revisión a mano) no duplica el reembolso.
update public.pago set estado = 'en_revision', fecha_revision = null where id = '60000000-0000-0000-0000-000000001201';
update public.pago set estado = 'aprobado', fecha_revision = now() where id = '60000000-0000-0000-0000-000000001201';
select is(
  (select count(*)::int from public.reembolso where id_pago = '60000000-0000-0000-0000-000000001201'),
  1, 'Aprobar el mismo pago otra vez no duplica el reembolso (on conflict do nothing)');
select is(
  (select count(*)::int from public.cancelacion_cita where id_monitoria = '50000000-0000-0000-0000-000000002412'),
  1, 'Y no anota otro correo de cancelación: el de HU-024 ya salió con la cancelación');

-- Lo que no se reembolsa al aprobar: cancelada por otro motivo (06), confirmada (13) y grupal cancelada por el estudiante (08).
update public.pago set estado = 'aprobado', fecha_revision = now() where id = '60000000-0000-0000-0000-000000000601';
select is(
  (select count(*)::int from public.reembolso where id_pago = '60000000-0000-0000-0000-000000000601'),
  0, 'Aprobar un pago de una cita cancelada por otro motivo (la 06, pago_rechazado) no crea reembolso');
update public.pago set estado = 'aprobado', fecha_revision = now() where id = '60000000-0000-0000-0000-000000001301';
select is(
  (select count(*)::int from public.reembolso where id_pago = '60000000-0000-0000-0000-000000001301'),
  0, 'Aprobar un pago de una cita que sigue confirmada (la 13) tampoco: el dinero es de la sesión');
update public.monitoria set estado = 'cancelada', motivo_cancelacion = 'estudiante' where id = '50000000-0000-0000-0000-000000002408';
update public.pago set estado = 'aprobado', fecha_revision = now() where id = '60000000-0000-0000-0000-000000000801';
select is(
  (select count(*)::int from public.reembolso where id_pago = '60000000-0000-0000-0000-000000000801'),
  0, 'Ni en una grupal (la 08): sus cancelaciones y reembolsos tienen otras reglas');
update public.monitoria set estado = 'confirmada', motivo_cancelacion = null where id = '50000000-0000-0000-0000-000000002408';

-- La 14 es de un Lead sin correo: el correo va al contacto de su primer pago por fecha (D-19).
select is(privado.cancelar_cita('50000000-0000-0000-0000-000000002414', timestamptz '2030-01-01 00:00-05'), 'cancelada',
  'La 14, del Lead sin correo (solo teléfono): cancelada');
select results_eq(
  $$select correo_destino, con_pago_en_revision, reembolso_a_otro_contacto
    from public.cancelacion_cita where id_monitoria = '50000000-0000-0000-0000-000000002414'$$,
  $$values ('pagador24@example.com'::text, false, true)$$,
  'D-19: el correo va al contacto del primer pago por fecha (1401), no al segundo; y hay un reembolso a otro contacto');
select results_eq(
  $$select right(r.id_pago::text, 4), r.monto, s.en_correo_de_cancelacion
    from public.reembolso r join public.pago p on p.id = r.id_pago join public.solicitud_llave s on s.id_reembolso = r.id
    where p.id_monitoria = '50000000-0000-0000-0000-000000002414' order by 1$$,
  $$values ('1401'::text, 12000, true), ('1402', 8000, false)$$,
  'El correo pide la llave del primer pago; la del segundo (otro correo) la pide HU-025');

-- La 25: el pago aprobado ya tiene su reembolso (on conflict del paso 8). Cancelar no duplica ni falla, y no lo toca.
select is(privado.cancelar_cita('50000000-0000-0000-0000-000000002425', timestamptz '2030-01-01 00:00-05'), 'cancelada',
  'La 25, con un pago aprobado que ya tiene reembolso: se cancela sin fallar (el on conflict no duplica)');
select results_eq(
  $$select r.monto, r.motivo, r.estado::text from public.reembolso r where r.id_pago = '60000000-0000-0000-0000-000000002501'$$,
  $$values (20000, 'Reembolso previo'::text, 'esperando_llave'::text)$$,
  'Sigue habiendo un solo reembolso por ese pago y es el de antes: su motivo no se pisa');
select results_eq(
  $$select s.en_correo_de_cancelacion from public.solicitud_llave s
    join public.reembolso r on r.id = s.id_reembolso where r.id_pago = '60000000-0000-0000-0000-000000002501'$$,
  $$values (false)$$,
  'Su solicitud de llave es la de siempre (una sola) y el correo de cancelación no la da por pedida: no la creó esta cancelación');
select results_eq(
  $$select correo_destino, con_pago_en_revision, reembolso_a_otro_contacto
    from public.cancelacion_cita where id_monitoria = '50000000-0000-0000-0000-000000002425'$$,
  $$values ('lucia24@calibra.test'::text, false, false)$$,
  'La cancelación quedó anotada para el correo, sin reembolsos nuevos que pedir');

-- ---------------------------------------------------------------------------
-- Sin admin activo (D-28) y la asignación
-- ---------------------------------------------------------------------------
update auth.users set banned_until = 'infinity'
where id in ('a0000000-0000-0000-0000-0000000024a0', 'a0000000-0000-0000-0000-0000000024b0');
call pg_temp.aislar();
select is(privado.siguiente_admin_activo(), null::uuid, 'Control: ningún admin activo');
select is(privado.cancelar_cita('50000000-0000-0000-0000-000000002415', timestamptz '2030-01-01 00:00-05'), 'cancelada',
  'D-28: sin admin activo el Lead igual cancela (ya no existe sin_admin)');
select results_eq(
  $$select r.monto, r.estado::text, r.id_admin is null, s.en_correo_de_cancelacion
    from public.reembolso r join public.solicitud_llave s on s.id_reembolso = r.id
    where r.id_pago = '60000000-0000-0000-0000-000000001501'$$,
  $$values (20000, 'esperando_llave'::text, true, true)$$,
  'Su reembolso nace esperando la llave, sin admin, con su solicitud de llave pedida en el correo');
select is(privado.asignar_reembolsos_sin_admin(), 0,
  'Sin ningún admin activo, la asignación no hace nada: devuelve 0');
select is(
  (select count(*)::int from public.reembolso where id_admin is null and estado in ('esperando_llave', 'pendiente')), 3,
  'Y los tres reembolsos abiertos (el de la 15 y el pendiente y el que espera llave de la 05) siguen sin admin');

-- Vuelve un admin: el B, que tiene el turno porque A sigue desactivado.
update auth.users set banned_until = null where id = 'a0000000-0000-0000-0000-0000000024b0';
call pg_temp.aislar();
select is(privado.asignar_reembolsos_sin_admin(), 3, 'Con un admin activo (B) asigna los tres reembolsos abiertos y devuelve 3');
select results_eq(
  $$select right(id_pago::text, 4), id_admin = 'a0000000-0000-0000-0000-0000000024b0', estado::text
    from public.reembolso where id_pago::text like '60000000-0000-0000-0000-00000000050_' or id_pago = '60000000-0000-0000-0000-000000001501'
    order by 1$$,
  $$values ('0501'::text, true, 'pendiente'::text), ('0502', null::boolean, 'reembolsado'), ('0503', true, 'esperando_llave'),
           ('1501', true, 'esperando_llave')$$,
  'Quedaron con B (el primer admin activo): el pendiente y el que espera llave; el ya reembolsado no se toca (sigue sin admin)');
select is(privado.asignar_reembolsos_sin_admin(), 0, 'Correrla otra vez no hace nada: 0');

-- Vuelve A, que va primero en el orden.
update auth.users set banned_until = null where id = 'a0000000-0000-0000-0000-0000000024a0';
call pg_temp.aislar();
select is(privado.siguiente_admin_activo(), 'a0000000-0000-0000-0000-0000000024a0'::uuid, 'Control: con A y B activos, el turno es de A');

-- ---------------------------------------------------------------------------
-- Puerta 1: el enlace del correo de confirmación (service_role)
-- ---------------------------------------------------------------------------
-- La 18 y la 20 llevan el token de su confirmación; la 19 también, y es de ayer.
set local role service_role;
select is(public.cancelar_cita_por_token((select token from public.confirmacion_cita where id_monitoria = '50000000-0000-0000-0000-000000002418')),
  'cancelada', 'Con el token de la 18 (confirmada y en plazo): cancelada');
select is(public.cancelar_cita_por_token((select token from public.confirmacion_cita where id_monitoria = '50000000-0000-0000-0000-000000002418')),
  'ya_cancelada', 'Con el mismo token otra vez: ya_cancelada');
select is(public.cancelar_cita_por_token((select token from public.confirmacion_cita where id_monitoria = '50000000-0000-0000-0000-000000002419')),
  'fuera_de_plazo', 'Con el token de la 19, que es de ayer: fuera_de_plazo (la base responde aunque la página no ofrezca el botón)');
select is(public.cancelar_cita_por_token(encode(extensions.gen_random_bytes(32), 'hex')), 'no_existe',
  'Un token inventado (64 hexadecimales al azar): no_existe');
select is(public.cancelar_cita_por_token('abc'), 'no_existe', 'Un token corto: no_existe');
select is(public.cancelar_cita_por_token(''), 'no_existe', 'Un token vacío: no_existe');
select is(public.cancelar_cita_por_token(null), 'no_existe', 'Un token nulo: no_existe');
select is(public.cancelar_cita_por_token((select upper(token) from public.confirmacion_cita where id_monitoria = '50000000-0000-0000-0000-000000002420')),
  'no_existe', 'El token real en mayúsculas tampoco: se compara tal cual');
reset role;
select results_eq(
  $$select right(id::text, 2), estado::text, motivo_cancelacion::text from public.monitoria
    where right(id::text, 2) in ('18', '19', '20') and id::text like '50000000-0000-0000-0000-0000000024%' order by 1$$,
  $$values ('18'::text, 'cancelada'::text, 'estudiante'::text), ('19', 'confirmada', null), ('20', 'confirmada', null)$$,
  'Solo se canceló la 18: la 19 (fuera de plazo) y la 20 (token alterado) siguen confirmadas');
select results_eq(
  $$select r.monto, r.id_admin = 'a0000000-0000-0000-0000-0000000024a0', s.en_correo_de_cancelacion
    from public.reembolso r join public.solicitud_llave s on s.id_reembolso = r.id
    where r.id_pago = '60000000-0000-0000-0000-000000001801'$$,
  $$values (20000, true, true)$$,
  'La puerta por token hizo el mismo trabajo: el reembolso de la 18 con el primer admin activo y su llave pedida en el correo');
set local role service_role;
select is(public.cancelar_cita_por_token((select token from public.confirmacion_cita where id_monitoria = '50000000-0000-0000-0000-000000002420')),
  'cancelada', 'Con el token de la 20: cancelada');
reset role;
select is((select estado::text from public.monitoria where id = '50000000-0000-0000-0000-000000002417'), 'confirmada',
  'Un token solo cancela su propia cita: la 17, de otro Lead, sigue confirmada');

-- ---------------------------------------------------------------------------
-- Puerta 2: la sesión del Lead (authenticated)
-- ---------------------------------------------------------------------------
-- Sesión 2: la que agendó el Lead 02 (dueño de la 16 y la 17).
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000002402","role":"authenticated"}';
select is(public.cancelar_mi_cita('50000000-0000-0000-0000-000000002416'), 'cancelada',
  'El Lead que agendó cancela su cita confirmada (la 16): cancelada');
select is(public.cancelar_mi_cita('50000000-0000-0000-0000-000000002416'), 'ya_cancelada',
  'Un doble clic: ya_cancelada');
select is(public.cancelar_mi_cita('50000000-0000-0000-0000-000000002421'), 'no_existe',
  'La cita de otro Lead (la 21 es del Lead 01): no_existe, igual que si no existiera');
select is(public.cancelar_mi_cita(gen_random_uuid()), 'no_existe', 'Un id que no existe: no_existe');
select is(public.cancelar_mi_cita(null), 'no_existe', 'Un id nulo: no_existe');
reset role;

-- Sesión 1: el Lead 01 intenta con la 17 (del Lead 02) y con la 19 (suya, pero de ayer).
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000002401","role":"authenticated"}';
select is(public.cancelar_mi_cita('50000000-0000-0000-0000-000000002417'), 'no_existe',
  'Otra sesión con Lead propio no cancela la cita del Lead 02 (la 17): no_existe');
select is(public.cancelar_mi_cita('50000000-0000-0000-0000-000000002419'), 'fuera_de_plazo',
  'Su cita de ayer (la 19): fuera_de_plazo; la base lo responde aunque la página no ofrezca el botón');
reset role;

-- Sesión 5: otro dispositivo que confirmó el correo del Lead 01 (lead_sesion, HU-068) cancela la 11.
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000002405","role":"authenticated"}';
select is(public.cancelar_mi_cita('50000000-0000-0000-0000-000000002411'), 'cancelada',
  'La sesión que confirmó el correo del Lead (HU-068) cancela su cita (la 11)');
reset role;

-- Sesión 4 (anónima sin Lead), el monitor, un admin y una sesión sin sub: ninguna cancela la 17.
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000002404","role":"authenticated"}';
select is(public.cancelar_mi_cita('50000000-0000-0000-0000-000000002417'), 'no_existe',
  'Una sesión anónima sin Lead no cancela nada: no_existe');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-000000002401","role":"authenticated"}';
select is(public.cancelar_mi_cita('50000000-0000-0000-0000-000000002417'), 'no_existe',
  'El monitor de la cita tampoco: no es el Lead');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000024a0","role":"authenticated"}';
select is(public.cancelar_mi_cita('50000000-0000-0000-0000-000000002417'), 'no_existe',
  'Un admin tampoco: no es el Lead');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"role":"authenticated"}';
select is(public.cancelar_mi_cita('50000000-0000-0000-0000-000000002417'), 'no_existe',
  'Sin identidad en la sesión (sin sub) no hay Lead: no_existe');
reset role;

select results_eq(
  $$select right(id::text, 2), estado::text, motivo_cancelacion::text from public.monitoria
    where right(id::text, 2) in ('11', '16', '17', '19', '21') and id::text like '50000000-0000-0000-0000-0000000024%' order by 1$$,
  $$values ('11'::text, 'cancelada'::text, 'estudiante'::text), ('16', 'cancelada', 'estudiante'), ('17', 'confirmada', null),
           ('19', 'confirmada', null), ('21', 'confirmada', null)$$,
  'Solo se canceló la 11 y la 16: la 17 (de otro), la 19 (de ayer) y la 21 siguen confirmadas');
select results_eq(
  $$select r.monto, r.id_admin = 'a0000000-0000-0000-0000-0000000024a0', s.en_correo_de_cancelacion
    from public.reembolso r join public.pago p on p.id = r.id_pago join public.solicitud_llave s on s.id_reembolso = r.id
    where p.id_monitoria in ('50000000-0000-0000-0000-000000002411', '50000000-0000-0000-0000-000000002416') order by r.id_pago$$,
  $$values (20000, true, true), (20000, true, true)$$,
  'La puerta de sesión hizo el mismo trabajo: reembolso completo por cada una, con el primer admin activo y la llave pedida en el correo');

-- ---------------------------------------------------------------------------
-- public.datos_de_cancelacion_cita: lo que la app necesita para escribir el correo
-- ---------------------------------------------------------------------------
-- Control: lo que el correo no debe traer sí está en las tablas.
select ok(
  exists (select 1 from public.lead where numero_telefono = '3002411111')
  and exists (select 1 from public.monitor_privado where correo = 'ana.monitora24@calibra.test' and numero_telefono = '3002400001'),
  'Control: el teléfono del Lead y el correo y el teléfono del monitor existen en las tablas');

set local role service_role;
select is((select count(*)::int from public.datos_de_cancelacion_cita('50000000-0000-0000-0000-000000002410')), 1,
  'service_role recibe exactamente una fila de una cita con cancelación anotada');
select results_eq(
  $$select estado::text, motivo_cancelacion::text, grupal, correo_destino, con_pago_en_revision, reembolso_a_otro_contacto,
           nombre_lead, nombre_materia, inicio, token_cita
    from public.datos_de_cancelacion_cita('50000000-0000-0000-0000-000000002410')$$,
  $$values ('cancelada'::text, 'estudiante'::text, false, 'lucia24@calibra.test'::text, true, true, 'Lucía Prueba 24'::text,
            'Materia 24'::text, timestamptz '2030-05-06 09:30-05', null::text)$$,
  'La 10: cancelada por el estudiante, individual, con la foto (correo del Lead, pago en revisión, reembolso a otro contacto), el nombre, la materia, el inicio en Bogotá y sin token de cita (se insertó confirmada)');
select is(
  (select creada_en from public.datos_de_cancelacion_cita('50000000-0000-0000-0000-000000002410')),
  (select creada_en from public.cancelacion_cita where id_monitoria = '50000000-0000-0000-0000-000000002410'),
  'Trae cuándo se anotó la cancelación');
select is(
  (select token_cita from public.datos_de_cancelacion_cita('50000000-0000-0000-0000-000000002418')),
  (select token from public.confirmacion_cita where id_monitoria = '50000000-0000-0000-0000-000000002418'),
  'Trae el token de la cita (el de la confirmación) para el botón «Ver mi cita»');
select is((select correo_destino from public.datos_de_cancelacion_cita('50000000-0000-0000-0000-000000002414')),
  'pagador24@example.com', 'D-19: la del Lead sin correo sale al contacto de su primer pago');
select is((select count(*)::int from public.datos_de_cancelacion_cita('50000000-0000-0000-0000-000000002403')), 0,
  'Una monitoría sin cancelación anotada (la 03, por pagar): cero filas');
select is((select count(*)::int from public.datos_de_cancelacion_cita(gen_random_uuid())), 0, 'Un id que no existe: cero filas');
select is((select count(*)::int from public.datos_de_cancelacion_cita(null)), 0, 'Un id nulo: cero filas');
select ok(
  not exists (
    select 1 from public.datos_de_cancelacion_cita('50000000-0000-0000-0000-000000002410') d
    where d::text ilike '%3002411111%' or d::text ilike '%3002400001%' or d::text ilike '%ana.monitora24%'
       or d::text ilike '%llave-ana-24%' or d::text ilike '%comision%' or d::text ilike '%otro24@example.com%'),
  'P-37: la fila no trae el teléfono del Lead ni el correo, el teléfono o la llave del monitor, ni el contacto de otro pagador, ni nada de comisión');
reset role;
-- La app descarta lo que ya no vale: la fila trae el estado y si es grupal. Una grupal con cancelación (no la anota
-- privado.cancelar_cita: se inserta a mano) sale con grupal = true.
insert into public.cancelacion_cita (id_monitoria, correo_destino, con_pago_en_revision, reembolso_a_otro_contacto)
values ('50000000-0000-0000-0000-000000002408', 'lucia24@calibra.test', false, false);
set local role service_role;
select results_eq(
  $$select estado::text, grupal from public.datos_de_cancelacion_cita('50000000-0000-0000-0000-000000002408')$$,
  $$values ('confirmada'::text, true)$$,
  'Una grupal sale con grupal = true (y su estado): la app no le manda nada');
reset role;
delete from public.cancelacion_cita where id_monitoria = '50000000-0000-0000-0000-000000002408';

-- ---------------------------------------------------------------------------
-- public.llaves_de_cancelacion: las llaves que pide el correo
-- ---------------------------------------------------------------------------
-- Se adelanta la fecha de generación del reembolso del 1002 para ver el orden (por fecha_generacion y después por id).
update public.reembolso set fecha_generacion = fecha_generacion - interval '1 minute'
where id_pago = '60000000-0000-0000-0000-000000001002';
set local role service_role;
select results_eq(
  $$select id_reembolso, monto, token from public.llaves_de_cancelacion('50000000-0000-0000-0000-000000002410')$$,
  $$select r.id, r.monto, s.token
    from public.reembolso r join public.solicitud_llave s on s.id_reembolso = r.id
    where r.id_pago in ('60000000-0000-0000-0000-000000001002', '60000000-0000-0000-0000-000000001001')
    order by r.fecha_generacion, r.id$$,
  'La 10: los dos reembolsos que el correo pide (el 1001 y el 1002, del correo del Lead), del más antiguo al más reciente, con su monto y su token');
select is((select count(*)::int from public.llaves_de_cancelacion('50000000-0000-0000-0000-000000002410')), 2,
  'No trae la del tercer pago (de otro contacto): esa la pide HU-025');
select is((select count(*)::int from public.llaves_de_cancelacion('50000000-0000-0000-0000-000000002412')), 0,
  'La 12: su reembolso nació después (P-07) sin pedirse en el correo de cancelación: ninguna');
select results_eq(
  $$select monto from public.llaves_de_cancelacion('50000000-0000-0000-0000-000000002414')$$,
  $$values (12000)$$,
  'La 14: solo la del pago del destinatario (1401)');
select is((select count(*)::int from public.llaves_de_cancelacion('50000000-0000-0000-0000-000000002401')), 0,
  'La 01, sin pagos: ninguna');
select is((select count(*)::int from public.llaves_de_cancelacion(gen_random_uuid())), 0, 'Un id que no existe: ninguna');
select is((select count(*)::int from public.llaves_de_cancelacion(null)), 0, 'Un id nulo: ninguna');
reset role;

-- ---------------------------------------------------------------------------
-- Las restricciones de las tablas
-- ---------------------------------------------------------------------------
select throws_ok(
  $$update public.solicitud_llave set token = 'no-es-hexadecimal' where id_reembolso = (select id from public.reembolso where id_pago = '60000000-0000-0000-0000-000000001001')$$,
  '23514', null, 'El token de la llave tiene que ser de 64 hexadecimales en minúscula');
select throws_ok(
  $$update public.solicitud_llave set token = (select token from public.solicitud_llave s2 join public.reembolso r2 on r2.id = s2.id_reembolso where r2.id_pago = '60000000-0000-0000-0000-000000001002')
    where id_reembolso = (select id from public.reembolso where id_pago = '60000000-0000-0000-0000-000000001001')$$,
  '23505', null, 'Dos reembolsos no comparten token (unique token)');
select throws_ok(
  $$insert into public.solicitud_llave (id_reembolso) values (gen_random_uuid())$$,
  '23503', null, 'La solicitud apunta a un reembolso que existe');
select throws_ok(
  $$insert into public.solicitud_llave (id_reembolso) values ((select id from public.reembolso where id_pago = '60000000-0000-0000-0000-000000001001'))$$,
  '23505', null, 'Un reembolso tiene una sola solicitud de llave');
select throws_ok(
  $$insert into public.cancelacion_cita (id_monitoria, con_pago_en_revision, reembolso_a_otro_contacto)
    values ('50000000-0000-0000-0000-000000002410', false, false)$$,
  '23505', null, 'Una monitoría no tiene dos cancelaciones anotadas (unique id_monitoria)');
select throws_ok(
  $$insert into public.cancelacion_cita (id_monitoria, con_pago_en_revision, reembolso_a_otro_contacto)
    values ('50000000-0000-0000-0000-000000002499', false, false)$$,
  '23503', null, 'La cancelación apunta a una monitoría que existe');
select throws_ok(
  $$update public.cancelacion_cita set intentos = -1 where id_monitoria = '50000000-0000-0000-0000-000000002410'$$,
  '23514', null, 'intentos no puede ser negativo');

-- Un reembolso nuevo (de cualquier camino, como el de la inasistencia de HU-030) nace con su solicitud de llave, sin pedirla.
insert into public.reembolso (id, id_pago, id_admin, monto, motivo) values
  ('70000000-0000-0000-0000-000000002401', '60000000-0000-0000-0000-000000001301', null, 20000, 'Prueba');
select results_eq(
  $$select s.token ~ '^[0-9a-f]{64}$', s.en_correo_de_cancelacion, s.creada_en = now()
    from public.solicitud_llave s where s.id_reembolso = '70000000-0000-0000-0000-000000002401'$$,
  $$values (true, false, true)$$,
  'Un reembolso insertado por cualquier camino nace con su solicitud de llave (token de 64 hexadecimales, sin pedirla en el correo de cancelación)');
delete from public.reembolso where id = '70000000-0000-0000-0000-000000002401';
select is((select count(*)::int from public.solicitud_llave where id_reembolso = '70000000-0000-0000-0000-000000002401'), 0,
  'Borrar el reembolso borra su solicitud de llave (on delete cascade)');

-- ---------------------------------------------------------------------------
-- service_role: lee las cancelaciones y las marca como procesadas, nada más
-- ---------------------------------------------------------------------------
set local role service_role;
select is(
  (select count(*)::int from public.cancelacion_cita where id_monitoria::text like '50000000-0000-0000-0000-0000000024%'),
  10, 'service_role lee las diez cancelaciones anotadas (RLS sin políticas no le estorba)');
select lives_ok(
  $$update public.cancelacion_cita set procesado_en = timestamptz '2030-01-01 09:00-05', intentos = 1
    where id_monitoria = '50000000-0000-0000-0000-000000002401'$$,
  'service_role marca una cancelación como procesada y cuenta un intento');
select throws_ok(
  $$update public.cancelacion_cita set correo_destino = 'otro@example.com' where id_monitoria = '50000000-0000-0000-0000-000000002410'$$,
  '42501', null, 'service_role no puede cambiar el correo de destino: solo procesado_en e intentos');
select throws_ok(
  $$insert into public.cancelacion_cita (id_monitoria, con_pago_en_revision, reembolso_a_otro_contacto)
    values ('50000000-0000-0000-0000-000000002422', false, false)$$,
  '42501', null, 'service_role no puede insertar cancelaciones');
select throws_ok(
  $$delete from public.cancelacion_cita where id_monitoria = '50000000-0000-0000-0000-000000002401'$$,
  '42501', null, 'service_role no puede borrar cancelaciones');
select is(
  (select count(*)::int from public.solicitud_llave s join public.reembolso r on r.id = s.id_reembolso
   where r.id_pago = '60000000-0000-0000-0000-000000001001'),
  1, 'service_role lee las solicitudes de llave (la app arma el enlace)');
select throws_ok(
  $$update public.solicitud_llave set en_correo_de_cancelacion = false$$,
  '42501', null, 'Pero no las modifica');
reset role;
update public.cancelacion_cita set procesado_en = null, intentos = 0 where id_monitoria = '50000000-0000-0000-0000-000000002401';

-- Si se borra la monitoría, su cancelación se va con ella (on delete cascade). La 22 no tiene pagos ni reembolsos.
select is(privado.cancelar_cita('50000000-0000-0000-0000-000000002422', timestamptz '2030-01-01 00:00-05'), 'cancelada',
  'La 22, sin pagos: cancelada');
select is((select count(*)::int from public.cancelacion_cita where id_monitoria = '50000000-0000-0000-0000-000000002422'), 1,
  'Control: tiene su cancelación anotada');
delete from public.monitoria where id = '50000000-0000-0000-0000-000000002422';
select is((select count(*)::int from public.cancelacion_cita where id_monitoria = '50000000-0000-0000-0000-000000002422'), 0,
  'Borrar la monitoría borra su cancelación (on delete cascade)');

-- ---------------------------------------------------------------------------
-- privado.disparar_cancelaciones_cita: sin Vault no pide nada y no falla
-- ---------------------------------------------------------------------------
-- Vault ya está sin los dos secretos (se quitaron al principio de la prueba).
select ok(
  exists (select 1 from public.cancelacion_cita where procesado_en is null
          and id_monitoria::text like '50000000-0000-0000-0000-0000000024%'),
  'Control: hay cancelaciones pendientes (las de esta prueba) y Vault no trae la configuración de la app');
select is(privado.disparar_cancelaciones_cita(), null::bigint,
  'Con cancelaciones pendientes pero sin configuración en Vault devuelve null y no falla (así en local)');
select vault.create_secret('https://calibra.test/', 'calibra_sitio_url');
select is(privado.disparar_cancelaciones_cita(), null::bigint,
  'Con la dirección de la app pero sin el secreto tampoco pide nada');
select vault.create_secret('secreto-de-prueba-con-al-menos-treinta-y-dos-caracteres', 'calibra_cron_secreto');
select isnt(privado.disparar_cancelaciones_cita(), null::bigint,
  'Con los dos secretos en Vault y cancelaciones pendientes sí pide el procesamiento: devuelve el id de la petición de pg_net');
select ok(
  (select count(*) = 1 from net.http_request_queue
   where url = 'https://calibra.test/api/procesos/avisar-cancelaciones' and method = 'POST'),
  'La petición va a /api/procesos/avisar-cancelaciones de la dirección de la app, sin la barra final de más');
update public.cancelacion_cita set procesado_en = now()
where procesado_en is null and id_monitoria::text like '50000000-0000-0000-0000-0000000024%';
select is(privado.disparar_cancelaciones_cita(), null::bigint,
  'Sin cancelaciones pendientes (en esta prueba) no pide nada, aunque Vault tenga la configuración');
update public.cancelacion_cita set procesado_en = null where id_monitoria::text like '50000000-0000-0000-0000-0000000024%';
delete from vault.secrets where name in ('calibra_sitio_url', 'calibra_cron_secreto');

-- ---------------------------------------------------------------------------
-- Si el pedido a la app falla, la cancelación no se cae
-- ---------------------------------------------------------------------------
-- Se reemplaza disparar_cancelaciones_cita por una que falla (como una dirección mal escrita en Vault). El reemplazo se
-- deshace con el rollback. Va al final porque las pruebas de arriba usan la función de verdad.
create or replace function privado.disparar_cancelaciones_cita()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'falla de prueba: pg_net no responde';
end;
$$;

select is(privado.cancelar_cita('50000000-0000-0000-0000-000000002421', timestamptz '2030-01-01 00:00-05'), 'cancelada',
  'Con el pedido a la app fallando, cancelar la cita no falla: cancelada');
select results_eq(
  $$select m.estado::text, m.motivo_cancelacion::text, c.procesado_en is null, c.correo_destino
    from public.monitoria m join public.cancelacion_cita c on c.id_monitoria = m.id
    where m.id = '50000000-0000-0000-0000-000000002421'$$,
  $$values ('cancelada'::text, 'estudiante'::text, true, 'lucia24@calibra.test'::text)$$,
  'La monitoría queda cancelada y su cancelación anotada y pendiente: pg_cron la vuelve a pedir');

select * from finish();
rollback;
