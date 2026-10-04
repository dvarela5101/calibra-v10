-- Pruebas pgTAP de entregar la llave del reembolso desde el enlace (HU-025, P-10, P-22, P-40, D-27).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.
--
-- Qué cubre la migración 20261003211456_llave_reembolso.sql:
--   * reembolso.plazo_llave_desde y reembolso.cerrado_en, con sus restricciones (cerrado solo esperando la llave; la
--     llave de 1 a 200 caracteres).
--   * public.parametros_reembolso() (7 días y recordatorio a los 3) y los dos instantes del plazo.
--   * public.pedido_llave (la bandeja de salida): RLS sin políticas, permisos mínimos, tipos y unicidad por ciclo.
--   * Los triggers de reembolso: un pedido por reembolso que nace esperando la llave (venga de HU-024, de P-07 o de un
--     INSERT directo) y una sola petición a la app por sentencia. El pedido de un reembolso cuya llave ya pidió el correo
--     de cancelación se anota igual, con la marca a la vista para que la app lo descarte (supuesto 2).
--   * privado.entregar_llave: sus seis resultados, los bordes de los 7 días con p_ahora (con 7 días exactos todavía se
--     entrega, P-40), la llave normalizada y que el enlace no deja cambiarla: la misma llave otra vez es ya_entregada y
--     otra distinta, ya_entregada_otra. La puerta del servidor (service_role).
--   * public.datos_de_llave y public.datos_de_pedido_llave: lo que ven la página y el correo, nunca la llave.
--   * Criterio 3: nadie salvo un admin activo lee la llave guardada.
--   * privado.vencer_pedidos_de_llave: el recordatorio a los 3 días y el cierre a los 7, con sus bordes.
--   * privado.reabrir_reembolso y privado.reenviar_pedido_llave (con sesión de admin activo), con sus puertas.
--   * Los cerrados no cuentan como casos abiertos ni impiden desactivar al último admin (equipo_de_admins y
--     reasignar_casos_de_admin, HU-074).
--   * privado.disparar_pedidos_llave y los trabajos de pg_cron; el recordatorio, reabrir y reenviar le piden a la app
--     que mande el correo (una petición a pg_net cada uno); si el pedido a la app falla, nada se cae.
--
-- No depende del reloj: los plazos de las pruebas de entrega viven en 2005 y los del cierre en 2001, y cada función se
-- llama con p_ahora. Así ningún reembolso de la base (de otras pruebas o de desarrollo, todos de ahora) entra en los
-- cierres de la prueba. Solo las puertas, que usan now() (fijo dentro de la transacción), se prueban con plazos relativos
-- a now().
--
-- El turno de admins recorre a TODOS los admins de la base: los que ya existían se banean dentro de la transacción y los de
-- esta prueba llevan un orden_revision negativo, por delante de cualquier otro (A antes que B, C y D).
--
-- Elenco (ids terminados en 25NN; la materia es 'PGTAP-25'):
--   Admins A (-2500), B (-2499), C (-2498) activos y D (-2497) desactivado. Monitor M. Sesión c1 (Lead 01, Lucía).
--   Monitorías: 01 cancelada por el estudiante (los pagos de los reembolsos de la prueba y el pago tarde de P-07), 02
--   confirmada (se cancela con HU-024: un pago con el correo del Lead y otro con otro correo), 03 cancelada por
--   inasistencia del monitor (el pedido de D-37).
--   Reembolsos (pago 25NN, reembolso 25NN; T0 = 3-ene-2005 10:00 y V0 = 1-ene-2001 10:00 en Bogotá):
--     01 y 02 esperando desde T0 (entregar en los bordes)   03 esperando desde T0, ya cerrado   04 pendiente   05 reembolsado
--     06 esperando desde T0 (la llave de 200)   07 esperando desde ayer (la puerta del servidor)   08 esperando desde hace
--     7 días exactos y 09 desde hace 7 días y un microsegundo (la página)   10 esperando desde T0 (reenviar)
--     11 esperando desde V0 (admin B)   12 esperando desde V0 (admin D, desactivado; su llave la pidió el correo de
--     cancelación)   13 esperando desde V0 - 5 días   14 pendiente desde V0   15 esperando, cerrado en 2000
--     16 reembolsado desde V0   17 esperando desde V0, cerrado a mano al día siguiente (se reabre con Vault configurado)
--     20 esperando desde T0 y 21 cerrado (admin C, casos abiertos)   40 esperando de la 03 (se le reenvía el enlace con
--     Vault configurado)
--     50, 51 y 52: los que se insertan con Vault configurado (una petición por sentencia)   53: el que se crea con el pedido
--     a la app fallando.

begin;
create extension if not exists pgtap with schema extensions;

select plan(176);

-- ---------------------------------------------------------------------------
-- El reembolso: columnas nuevas y restricciones
-- ---------------------------------------------------------------------------
select has_column('public', 'reembolso', 'plazo_llave_desde', 'reembolso tiene plazo_llave_desde: desde cuándo corren los 7 días');
select col_type_is('public', 'reembolso', 'plazo_llave_desde', 'timestamp with time zone', 'plazo_llave_desde es un instante');
select col_not_null('public', 'reembolso', 'plazo_llave_desde', 'plazo_llave_desde es obligatorio');
select col_default_is('public', 'reembolso', 'plazo_llave_desde', 'now()', 'Por defecto, el plazo empieza al crear el reembolso');
select has_column('public', 'reembolso', 'cerrado_en', 'reembolso tiene cerrado_en: el cierre de P-10 es una columna');
select col_type_is('public', 'reembolso', 'cerrado_en', 'timestamp with time zone', 'cerrado_en es un instante');
select col_is_null('public', 'reembolso', 'cerrado_en', 'cerrado_en es opcional: nula mientras el caso está abierto');
select enum_has_labels('public', 'estado_reembolso', array['esperando_llave', 'pendiente', 'reembolsado'],
  'El enum estado_reembolso no cambia: el cierre no es un estado');

-- ---------------------------------------------------------------------------
-- Parámetros de P-10
-- ---------------------------------------------------------------------------
select results_eq(
  $$select plazo_llave_min, recordatorio_llave_min from public.parametros_reembolso()$$,
  $$values (10080, 4320)$$,
  'parametros_reembolso(): 7 días para entregar la llave y el recordatorio a los 3 (P-10), en minutos');
select is(
  array[public.entrega_de_llave_hasta(timestamptz '2005-01-03 10:00-05'),
        public.recordatorio_de_llave_desde(timestamptz '2005-01-03 10:00-05')],
  array[timestamptz '2005-01-10 10:00-05', timestamptz '2005-01-06 10:00-05'],
  'Los dos instantes: la entrega vence 7 días después y el recordatorio sale 3 días después');
select ok(
  public.entrega_de_llave_hasta(null) is null and public.recordatorio_de_llave_desde(null) is null,
  'Nulo entra, nulo sale');
select is(
  (select array_agg(proname::text order by proname) from pg_proc
   where pronamespace = 'public'::regnamespace
     and proname in ('parametros_reembolso', 'entrega_de_llave_hasta', 'recordatorio_de_llave_desde')
     and provolatile = 's'),
  array['entrega_de_llave_hasta', 'parametros_reembolso', 'recordatorio_de_llave_desde'],
  'Los parámetros y los instantes son stable: cambian con una migración, nunca immutable');

-- ---------------------------------------------------------------------------
-- La bandeja de salida: RLS sin políticas y permisos mínimos
-- ---------------------------------------------------------------------------
select has_table('public', 'pedido_llave', 'Existe public.pedido_llave, la bandeja de salida de los correos de la llave');
select columns_are('public', 'pedido_llave',
  array['id', 'id_reembolso', 'tipo', 'plazo_desde', 'creada_en', 'procesado_en', 'intentos'],
  'Sus columnas son el id, el reembolso, el tipo, la foto del ciclo, cuándo se anotó y lo que lleva la app');
select ok((select relrowsecurity from pg_class where oid = 'public.pedido_llave'::regclass), 'RLS está activo en pedido_llave');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'pedido_llave'), 0,
  'Sin políticas: RLS le niega todo a anon y authenticated');
select ok(
  not exists (
    select 1
    from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where c.oid = 'public.pedido_llave'::regclass and a.grantee = 0),
  'Nadie la hereda de PUBLIC');
select ok(
  not has_any_column_privilege('anon', 'public.pedido_llave', 'select')
  and not has_any_column_privilege('anon', 'public.pedido_llave', 'insert')
  and not has_any_column_privilege('anon', 'public.pedido_llave', 'update')
  and not has_any_column_privilege('anon', 'public.pedido_llave', 'references')
  and not has_table_privilege('anon', 'public.pedido_llave', 'delete')
  and not has_table_privilege('anon', 'public.pedido_llave', 'truncate')
  and not has_table_privilege('anon', 'public.pedido_llave', 'trigger'),
  'anon no tiene ningún permiso sobre pedido_llave');
select ok(
  not has_any_column_privilege('authenticated', 'public.pedido_llave', 'select')
  and not has_any_column_privilege('authenticated', 'public.pedido_llave', 'insert')
  and not has_any_column_privilege('authenticated', 'public.pedido_llave', 'update')
  and not has_any_column_privilege('authenticated', 'public.pedido_llave', 'references')
  and not has_table_privilege('authenticated', 'public.pedido_llave', 'delete')
  and not has_table_privilege('authenticated', 'public.pedido_llave', 'truncate')
  and not has_table_privilege('authenticated', 'public.pedido_llave', 'trigger'),
  'authenticated tampoco: ni quien pagó ni un admin la tocan');
select ok(
  has_table_privilege('service_role', 'public.pedido_llave', 'select')
  and has_column_privilege('service_role', 'public.pedido_llave', 'procesado_en', 'update')
  and has_column_privilege('service_role', 'public.pedido_llave', 'intentos', 'update'),
  'service_role la lee y marca procesado_en e intentos (la app procesa los pedidos)');
select ok(
  not has_column_privilege('service_role', 'public.pedido_llave', 'id', 'update')
  and not has_column_privilege('service_role', 'public.pedido_llave', 'id_reembolso', 'update')
  and not has_column_privilege('service_role', 'public.pedido_llave', 'tipo', 'update')
  and not has_column_privilege('service_role', 'public.pedido_llave', 'plazo_desde', 'update')
  and not has_column_privilege('service_role', 'public.pedido_llave', 'creada_en', 'update')
  and not has_table_privilege('service_role', 'public.pedido_llave', 'update')
  and not has_any_column_privilege('service_role', 'public.pedido_llave', 'insert')
  and not has_table_privilege('service_role', 'public.pedido_llave', 'delete')
  and not has_table_privilege('service_role', 'public.pedido_llave', 'truncate')
  and not has_any_column_privilege('service_role', 'public.pedido_llave', 'references')
  and not has_table_privilege('service_role', 'public.pedido_llave', 'trigger'),
  'Pero nada más: ni otra columna, ni insertar, ni borrar (los pedidos los anota la base)');

set local role anon;
select throws_ok($$select * from public.pedido_llave$$, '42501', null, 'anon no puede leer pedido_llave: permiso denegado');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000025a0","role":"authenticated"}';
select throws_ok($$select * from public.pedido_llave$$, '42501', null,
  'Una sesión (aunque sea la de un admin) no puede leer pedido_llave: permiso denegado');
select throws_ok($$update public.pedido_llave set procesado_en = now()$$, '42501', null,
  'Una sesión no puede marcar pedidos como procesados');
reset role;

-- ---------------------------------------------------------------------------
-- Las funciones y los triggers: definición y permisos
-- ---------------------------------------------------------------------------
select ok(
  to_regprocedure('privado.disparar_pedidos_llave()') is not null
  and to_regprocedure('privado.anotar_pedido_llave()') is not null
  and to_regprocedure('privado.pedir_llaves_a_la_app()') is not null
  and to_regprocedure('privado.vencer_pedidos_de_llave(timestamptz)') is not null
  and to_regprocedure('privado.entregar_llave(text, text, timestamptz)') is not null
  and to_regprocedure('privado.entregar_llave_del_servidor(text, text)') is not null
  and to_regprocedure('privado.reabrir_reembolso(uuid, timestamptz)') is not null
  and to_regprocedure('privado.reabrir_reembolso_de_la_sesion(uuid)') is not null
  and to_regprocedure('privado.reenviar_pedido_llave(uuid, timestamptz)') is not null
  and to_regprocedure('privado.reenviar_pedido_llave_de_la_sesion(uuid)') is not null,
  'Existen las diez de privado: el pedido a la app, los dos triggers, el cierre, entregar, reabrir y reenviar con sus envoltorios');
select ok(
  to_regprocedure('public.parametros_reembolso()') is not null
  and to_regprocedure('public.entrega_de_llave_hasta(timestamptz)') is not null
  and to_regprocedure('public.recordatorio_de_llave_desde(timestamptz)') is not null
  and to_regprocedure('public.entregar_llave(text, text)') is not null
  and to_regprocedure('public.datos_de_llave(text)') is not null
  and to_regprocedure('public.datos_de_pedido_llave(uuid)') is not null
  and to_regprocedure('public.reabrir_reembolso(uuid)') is not null
  and to_regprocedure('public.reenviar_pedido_llave(uuid)') is not null,
  'Existen las ocho de public: los parámetros, los dos instantes, las tres puertas y los datos de la página y del correo');
select ok(
  (select bool_and(prosecdef) from pg_proc
   where oid in ('privado.disparar_pedidos_llave()'::regprocedure, 'privado.anotar_pedido_llave()'::regprocedure,
                 'privado.pedir_llaves_a_la_app()'::regprocedure, 'privado.vencer_pedidos_de_llave(timestamptz)'::regprocedure,
                 'privado.entregar_llave(text, text, timestamptz)'::regprocedure,
                 'privado.entregar_llave_del_servidor(text, text)'::regprocedure,
                 'privado.reabrir_reembolso(uuid, timestamptz)'::regprocedure,
                 'privado.reabrir_reembolso_de_la_sesion(uuid)'::regprocedure,
                 'privado.reenviar_pedido_llave(uuid, timestamptz)'::regprocedure,
                 'privado.reenviar_pedido_llave_de_la_sesion(uuid)'::regprocedure))
  and not (select bool_or(prosecdef) from pg_proc
   where oid in ('public.parametros_reembolso()'::regprocedure, 'public.entrega_de_llave_hasta(timestamptz)'::regprocedure,
                 'public.recordatorio_de_llave_desde(timestamptz)'::regprocedure, 'public.entregar_llave(text, text)'::regprocedure,
                 'public.datos_de_llave(text)'::regprocedure, 'public.datos_de_pedido_llave(uuid)'::regprocedure,
                 'public.reabrir_reembolso(uuid)'::regprocedure, 'public.reenviar_pedido_llave(uuid)'::regprocedure)),
  'Las de privado son security definer; las de public corren con los permisos de quien llama');
select ok(
  (select bool_and('search_path=""' = any(proconfig)) from pg_proc
   where oid in ('privado.disparar_pedidos_llave()'::regprocedure, 'privado.anotar_pedido_llave()'::regprocedure,
                 'privado.pedir_llaves_a_la_app()'::regprocedure, 'privado.vencer_pedidos_de_llave(timestamptz)'::regprocedure,
                 'privado.entregar_llave(text, text, timestamptz)'::regprocedure,
                 'privado.entregar_llave_del_servidor(text, text)'::regprocedure,
                 'privado.reabrir_reembolso(uuid, timestamptz)'::regprocedure,
                 'privado.reabrir_reembolso_de_la_sesion(uuid)'::regprocedure,
                 'privado.reenviar_pedido_llave(uuid, timestamptz)'::regprocedure,
                 'privado.reenviar_pedido_llave_de_la_sesion(uuid)'::regprocedure,
                 'public.parametros_reembolso()'::regprocedure, 'public.entrega_de_llave_hasta(timestamptz)'::regprocedure,
                 'public.recordatorio_de_llave_desde(timestamptz)'::regprocedure, 'public.entregar_llave(text, text)'::regprocedure,
                 'public.datos_de_llave(text)'::regprocedure, 'public.datos_de_pedido_llave(uuid)'::regprocedure,
                 'public.reabrir_reembolso(uuid)'::regprocedure, 'public.reenviar_pedido_llave(uuid)'::regprocedure)),
  'Las dieciocho fijan un search_path vacío');
select is(
  array[pg_get_function_result('privado.anotar_pedido_llave()'::regprocedure),
        pg_get_function_result('privado.pedir_llaves_a_la_app()'::regprocedure),
        pg_get_function_result('privado.disparar_pedidos_llave()'::regprocedure),
        pg_get_function_result('privado.vencer_pedidos_de_llave(timestamptz)'::regprocedure),
        pg_get_function_result('privado.entregar_llave(text, text, timestamptz)'::regprocedure),
        pg_get_function_result('public.entregar_llave(text, text)'::regprocedure),
        pg_get_function_result('public.reabrir_reembolso(uuid)'::regprocedure),
        pg_get_function_result('public.reenviar_pedido_llave(uuid)'::regprocedure)],
  array['trigger', 'trigger', 'bigint', 'TABLE(cerrados integer, recordatorios integer)', 'text', 'text', 'text', 'text'],
  'Los triggers devuelven trigger; el pedido a la app, el id de pg_net; el cierre, cuántos cerró y recordó; y las demás, el resultado en texto');

-- Criterio 3: las columnas de salida de lo que lee el servidor son fijas y ninguna es la llave.
select is(
  (select array_agg(a.n order by a.o)
   from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as a(n, m, o)
   where p.oid = 'public.datos_de_llave(text)'::regprocedure and a.m = 't'),
  array['estado', 'monto', 'motivo', 'vence_en'],
  'datos_de_llave devuelve el estado para la página, el monto, el motivo y el vencimiento: ni la llave ni el contacto');
select is(
  (select array_agg(a.n order by a.o)
   from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as a(n, m, o)
   where p.oid = 'public.datos_de_pedido_llave(uuid)'::regprocedure and a.m = 't'),
  array['tipo', 'plazo_desde', 'vence_en', 'plazo_llave_desde', 'estado', 'cerrado_en', 'en_correo_de_cancelacion', 'contacto',
        'nombre_pagador', 'monto', 'motivo', 'token', 'motivo_cancelacion'],
  'datos_de_pedido_llave devuelve lo que necesita el correo y su vigencia: nunca la llave');

select has_trigger('public', 'reembolso', 'reembolso_anota_pedido_llave', 'reembolso tiene el trigger reembolso_anota_pedido_llave');
select trigger_is('public', 'reembolso', 'reembolso_anota_pedido_llave', 'privado', 'anotar_pedido_llave',
  'El trigger llama a privado.anotar_pedido_llave');
select matches(
  (select pg_get_triggerdef(t.oid) from pg_trigger t
   where t.tgrelid = 'public.reembolso'::regclass and t.tgname = 'reembolso_anota_pedido_llave'),
  'AFTER INSERT ON public\.reembolso FOR EACH ROW WHEN .*esperando_llave',
  'Corre después de insertar, por fila, solo si el reembolso nace esperando la llave');
select has_trigger('public', 'reembolso', 'reembolso_pide_llaves_a_la_app', 'reembolso tiene el trigger reembolso_pide_llaves_a_la_app');
select trigger_is('public', 'reembolso', 'reembolso_pide_llaves_a_la_app', 'privado', 'pedir_llaves_a_la_app',
  'El trigger llama a privado.pedir_llaves_a_la_app');
select matches(
  (select pg_get_triggerdef(t.oid) from pg_trigger t
   where t.tgrelid = 'public.reembolso'::regclass and t.tgname = 'reembolso_pide_llaves_a_la_app'),
  'AFTER INSERT ON public\.reembolso REFERENCING NEW TABLE AS nuevos FOR EACH STATEMENT',
  'Corre una vez por sentencia, con los reembolsos nuevos a la vista: una cancelación con varios pagos hace una sola petición');

-- Permisos de las funciones: nadie las hereda de PUBLIC y cada una solo la ejecuta quien debe.
select ok(
  not exists (
    select 1
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid in ('privado.disparar_pedidos_llave()'::regprocedure, 'privado.anotar_pedido_llave()'::regprocedure,
                    'privado.pedir_llaves_a_la_app()'::regprocedure, 'privado.vencer_pedidos_de_llave(timestamptz)'::regprocedure,
                    'privado.entregar_llave(text, text, timestamptz)'::regprocedure,
                    'privado.entregar_llave_del_servidor(text, text)'::regprocedure,
                    'privado.reabrir_reembolso(uuid, timestamptz)'::regprocedure,
                    'privado.reabrir_reembolso_de_la_sesion(uuid)'::regprocedure,
                    'privado.reenviar_pedido_llave(uuid, timestamptz)'::regprocedure,
                    'privado.reenviar_pedido_llave_de_la_sesion(uuid)'::regprocedure,
                    'public.parametros_reembolso()'::regprocedure, 'public.entrega_de_llave_hasta(timestamptz)'::regprocedure,
                    'public.recordatorio_de_llave_desde(timestamptz)'::regprocedure, 'public.entregar_llave(text, text)'::regprocedure,
                    'public.datos_de_llave(text)'::regprocedure, 'public.datos_de_pedido_llave(uuid)'::regprocedure,
                    'public.reabrir_reembolso(uuid)'::regprocedure, 'public.reenviar_pedido_llave(uuid)'::regprocedure)
      and a.grantee = 0),
  'Nadie las hereda de PUBLIC');
select ok(
  not exists (
    select 1
    from unnest(array['privado.disparar_pedidos_llave()', 'privado.anotar_pedido_llave()', 'privado.pedir_llaves_a_la_app()',
                      'privado.vencer_pedidos_de_llave(timestamptz)', 'privado.entregar_llave(text, text, timestamptz)',
                      'privado.reabrir_reembolso(uuid, timestamptz)', 'privado.reenviar_pedido_llave(uuid, timestamptz)']) f,
         unnest(array['anon', 'authenticated', 'service_role']) r
    where has_function_privilege(r, f, 'execute')),
  'El pedido a la app, los triggers, el cierre y las versiones con p_ahora no los ejecuta ningún rol: nadie elige la hora');
select ok(
  has_function_privilege('service_role', 'public.entregar_llave(text, text)', 'execute')
  and has_function_privilege('service_role', 'privado.entregar_llave_del_servidor(text, text)', 'execute')
  and has_function_privilege('service_role', 'public.datos_de_llave(text)', 'execute')
  and has_function_privilege('service_role', 'public.datos_de_pedido_llave(uuid)', 'execute')
  and not exists (
    select 1
    from unnest(array['public.entregar_llave(text, text)', 'privado.entregar_llave_del_servidor(text, text)',
                      'public.datos_de_llave(text)', 'public.datos_de_pedido_llave(uuid)']) f,
         unnest(array['anon', 'authenticated']) r
    where has_function_privilege(r, f, 'execute')),
  'Entregar la llave y los datos de la página y del correo solo los ejecuta service_role: adivinar tokens no es cosa de cualquiera');
select ok(
  has_function_privilege('authenticated', 'public.reabrir_reembolso(uuid)', 'execute')
  and has_function_privilege('authenticated', 'privado.reabrir_reembolso_de_la_sesion(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.reenviar_pedido_llave(uuid)', 'execute')
  and has_function_privilege('authenticated', 'privado.reenviar_pedido_llave_de_la_sesion(uuid)', 'execute')
  and not exists (
    select 1
    from unnest(array['public.reabrir_reembolso(uuid)', 'privado.reabrir_reembolso_de_la_sesion(uuid)',
                      'public.reenviar_pedido_llave(uuid)', 'privado.reenviar_pedido_llave_de_la_sesion(uuid)']) f,
         unnest(array['anon', 'service_role']) r
    where has_function_privilege(r, f, 'execute')),
  'Reabrir y reenviar solo con sesión (authenticated): ni anon ni service_role, que no tiene sesión de admin');
select ok(
  not exists (
    select 1
    from unnest(array['public.parametros_reembolso()', 'public.entrega_de_llave_hasta(timestamptz)',
                      'public.recordatorio_de_llave_desde(timestamptz)']) f
    where not has_function_privilege('authenticated', f, 'execute')
       or not has_function_privilege('service_role', f, 'execute')
       or has_function_privilege('anon', f, 'execute')),
  'Los parámetros y los instantes, como el motor de plazos: authenticated y service_role, no anon');

set local role anon;
select throws_ok($$select public.entregar_llave('abc', 'mi-llave')$$, '42501', null,
  'anon no puede entregar una llave: permiso denegado');
select throws_ok($$select * from public.datos_de_llave('abc')$$, '42501', null,
  'anon no puede leer los datos de la página: permiso denegado');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000025a0","role":"authenticated"}';
select throws_ok($$select public.entregar_llave('abc', 'mi-llave')$$, '42501', null,
  'Una sesión no puede usar la puerta de la llave: solo el servidor con la llave secreta');
select throws_ok($$select privado.entregar_llave('abc', 'mi-llave', now())$$, '42501', null,
  'Ni la versión con p_ahora');
select throws_ok($$select * from public.datos_de_pedido_llave('70000000-0000-0000-0000-000000002501')$$, '42501', null,
  'Una sesión no puede pedir los datos del correo: permiso denegado');
select throws_ok($$select privado.reabrir_reembolso('70000000-0000-0000-0000-000000002501', now())$$, '42501', null,
  'Una sesión no puede reabrir con la hora que quiera: solo por la puerta, con la hora de la base');
select throws_ok($$select * from privado.vencer_pedidos_de_llave(now())$$, '42501', null,
  'Una sesión no puede cerrar casos ni anotar recordatorios: lo hace pg_cron');
reset role;
set local role service_role;
select throws_ok($$select public.reabrir_reembolso('70000000-0000-0000-0000-000000002501')$$, '42501', null,
  'service_role no puede reabrir: no tiene sesión de admin');
select throws_ok($$select privado.disparar_pedidos_llave()$$, '42501', null,
  'service_role no puede pedir el procesamiento: lo piden la base y pg_cron');
select throws_ok($$select * from privado.vencer_pedidos_de_llave(now())$$, '42501', null,
  'service_role no puede cerrar casos: lo hace pg_cron');
reset role;

-- Los trabajos de pg_cron.
select results_eq(
  $$select jobname, schedule, command, active from cron.job
    where jobname in ('calibra-pedir-llaves', 'calibra-vencer-llaves') order by jobname$$,
  $$values ('calibra-pedir-llaves'::text, '*/5 * * * *'::text, 'select privado.disparar_pedidos_llave()'::text, true),
           ('calibra-vencer-llaves', '*/15 * * * *', 'select privado.vencer_pedidos_de_llave(now())', true)$$,
  'Existen, una sola vez cada uno y activos: pedir las llaves cada 5 minutos y cerrar o recordar cada 15');

-- ---------------------------------------------------------------------------
-- Fixtures (como postgres)
-- ---------------------------------------------------------------------------
-- La prueba no depende de lo que haya en Vault: se quitan (dentro de la transacción) los dos secretos de la app.
delete from vault.secrets where name in ('calibra_sitio_url', 'calibra_cron_secreto');

-- Cualquier admin que ya existiera queda inactivo durante la prueba.
update auth.users set banned_until = 'infinity' where id in (select id from public.admin);

insert into auth.users (id, is_anonymous, banned_until) values
  ('a0000000-0000-0000-0000-0000000025a0', false, null),
  ('a0000000-0000-0000-0000-0000000025b0', false, null),
  ('a0000000-0000-0000-0000-0000000025c0', false, null),
  ('a0000000-0000-0000-0000-0000000025d0', false, now() + interval '100 years'),
  ('b0000000-0000-0000-0000-000000002501', false, null),
  ('c0000000-0000-0000-0000-000000002501', true, null);

insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-0000000025a0', 'Admin A', 'admin-a-hu025@calibra.test', -2500),
  ('a0000000-0000-0000-0000-0000000025b0', 'Admin B', 'admin-b-hu025@calibra.test', -2499),
  ('a0000000-0000-0000-0000-0000000025c0', 'Admin C', 'admin-c-hu025@calibra.test', -2498),
  ('a0000000-0000-0000-0000-0000000025d0', 'Admin D', 'admin-d-hu025@calibra.test', -2497);
insert into public.monitor (id, nombre) values ('b0000000-0000-0000-0000-000000002501', 'Monitor 25');
insert into public.monitor_privado (id_monitor, numero_telefono, correo, llave) values
  ('b0000000-0000-0000-0000-000000002501', '3002500001', 'monitor25@calibra.test', 'llave-monitor-25');
insert into public.materia (id, nombre, codigo) values ('10000000-0000-0000-0000-000000002501', 'Materia 25', 'PGTAP-25');
insert into public.certificado (id_monitor, id_materia, id_admin) values
  ('b0000000-0000-0000-0000-000000002501', '10000000-0000-0000-0000-000000002501', 'a0000000-0000-0000-0000-0000000025a0');
insert into public.lead (id, id_sesion_anonima, nombre, numero_telefono, correo, acepta_tratamiento_datos, fecha_consentimiento) values
  ('40000000-0000-0000-0000-000000002501', 'c0000000-0000-0000-0000-000000002501', 'Lucía Prueba 25', '3002511111',
   'lucia25@calibra.test', true, now());

-- aislar(): vuelve a desactivar a cualquier admin que no sea de la prueba (otras pruebas pueden crear admins a la vez).
create procedure pg_temp.aislar()
language sql security definer set search_path = ''
as $$
  update auth.users set banned_until = 'infinity'
  where id in (select id from public.admin
               where id not in ('a0000000-0000-0000-0000-0000000025a0', 'a0000000-0000-0000-0000-0000000025b0',
                                'a0000000-0000-0000-0000-0000000025c0', 'a0000000-0000-0000-0000-0000000025d0'))
    and (banned_until is null or banned_until <= now());
$$;
call pg_temp.aislar();

-- r(nn): el reembolso 25NN. t(nn): el token que se le pone a su solicitud de llave.
create function pg_temp.r(nn text) returns uuid language sql immutable
as $$ select ('70000000-0000-0000-0000-0000000025' || nn)::uuid $$;
create function pg_temp.t(nn text) returns text language sql immutable
as $$ select '25' || nn || repeat('a', 60) $$;

-- Una franja por monitoría, los lunes a las 9:30 en Bogotá, virtuales de 60 min.
insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min, lugar, enlace, abierta_desde)
select ('30000000-0000-0000-0000-0000000025' || nn)::uuid, 'b0000000-0000-0000-0000-000000002501'::uuid, smallint '1',
       time '09:30', false, 20000, 60, null, 'https://meet.example/25-' || nn, date '2026-01-01'
from unnest(array['01', '02', '03']) as nn;

insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado, motivo_cancelacion)
values
  ('50000000-0000-0000-0000-000000002501', '30000000-0000-0000-0000-000000002501', '10000000-0000-0000-0000-000000002501',
   '40000000-0000-0000-0000-000000002501', date '2030-03-04', 20000, 'cancelada', 'estudiante'),
  ('50000000-0000-0000-0000-000000002502', '30000000-0000-0000-0000-000000002502', '10000000-0000-0000-0000-000000002501',
   '40000000-0000-0000-0000-000000002501', date '2030-03-11', 20000, 'confirmada', null),
  ('50000000-0000-0000-0000-000000002503', '30000000-0000-0000-0000-000000002503', '10000000-0000-0000-0000-000000002501',
   '40000000-0000-0000-0000-000000002501', date '2030-03-18', 20000, 'cancelada', 'monitor_no_asistio');

-- Los pagos: uno por reembolso de la prueba (de la 01, salvo el 40 de la 03), los dos de la 02 que se cancela con HU-024 y
-- el 60 de la 01, que sigue en revisión (P-07).
create temporary table pago_25 (nn text primary key, monitoria text not null, estado public.estado_pago not null,
  contacto text not null, monto integer not null);
insert into pago_25 (nn, monitoria, estado, contacto, monto)
select nn, case when nn = '40' then '03' else '01' end, 'aprobado', 'pagador25-' || nn || '@example.com', 20000
from unnest(array['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '20', '21',
                  '40', '50', '51', '52', '53']) as nn;
insert into pago_25 (nn, monitoria, estado, contacto, monto) values
  ('31', '02', 'aprobado', 'lucia25@calibra.test', 12000),
  ('32', '02', 'aprobado', 'otra25@example.com', 8000),
  ('60', '01', 'en_revision', 'tarde25@example.com', 20000);
insert into public.comprobante_revisado (ruta, tipo)
select 'c0000000-0000-0000-0000-000000002501/60000000-0000-0000-0000-0000000025' || nn || '.pdf', 'application/pdf'
from pago_25;
insert into public.pago (id, id_monitoria, monto, nombre_pagador, contacto, estado, id_admin, fecha_pago, fecha_revision, comprobante)
select ('60000000-0000-0000-0000-0000000025' || nn)::uuid, ('50000000-0000-0000-0000-0000000025' || monitoria)::uuid, monto,
       'Pagador ' || nn, contacto, estado, 'a0000000-0000-0000-0000-0000000025a0', timestamptz '2030-02-01 10:00-05',
       case when estado = 'en_revision' then null else now() end,
       'c0000000-0000-0000-0000-000000002501/60000000-0000-0000-0000-0000000025' || nn || '.pdf'
from pago_25;

-- Los reembolsos de la prueba, en una sola sentencia (Vault está vacío: no se pide nada).
insert into public.reembolso (id, id_pago, id_admin, monto, motivo, llave_destino, estado, fecha_reembolso,
                              referencia_transferencia, plazo_llave_desde, cerrado_en)
select pg_temp.r(v.nn), ('60000000-0000-0000-0000-0000000025' || v.nn)::uuid,
       ('a0000000-0000-0000-0000-0000000025' || v.admin || '0')::uuid, 20000, v.motivo, v.llave,
       v.estado::public.estado_reembolso, case when v.estado = 'reembolsado' then now() end,
       case when v.estado = 'reembolsado' then 'REF-25-' || v.nn end, v.desde, v.cerrado
from (values
  ('01', 'a', 'Prueba 01', null, 'esperando_llave', timestamptz '2005-01-03 10:00-05', null::timestamptz),
  ('02', 'a', 'Prueba 02', null, 'esperando_llave', timestamptz '2005-01-03 10:00-05', null),
  ('03', 'a', 'Prueba 03', null, 'esperando_llave', timestamptz '2005-01-03 10:00-05', timestamptz '2005-01-10 10:00:01-05'),
  ('04', 'a', 'Prueba 04', 'llave-04', 'pendiente', timestamptz '2005-01-03 10:00-05', null),
  ('05', 'a', 'Prueba 05', 'llave-05', 'reembolsado', timestamptz '2005-01-03 10:00-05', null),
  ('06', 'a', 'Prueba 06', null, 'esperando_llave', timestamptz '2005-01-03 10:00-05', null),
  ('07', 'a', 'Prueba 07', null, 'esperando_llave', now() - interval '24 hours', null),
  ('08', 'a', 'Prueba 08', null, 'esperando_llave', now() - interval '168 hours', null),
  ('09', 'a', 'Prueba 09', null, 'esperando_llave', now() - interval '168 hours' - interval '1 microsecond', null),
  ('10', 'a', 'Prueba 10', null, 'esperando_llave', timestamptz '2005-01-03 10:00-05', null),
  ('11', 'b', 'Prueba 11', null, 'esperando_llave', timestamptz '2001-01-01 10:00-05', null),
  ('12', 'd', 'Prueba 12', null, 'esperando_llave', timestamptz '2001-01-01 10:00-05', null),
  ('13', 'b', 'Prueba 13', null, 'esperando_llave', timestamptz '2000-12-27 10:00-05', null),
  ('14', 'b', 'Prueba 14', 'llave-14', 'pendiente', timestamptz '2001-01-01 10:00-05', null),
  ('15', 'b', 'Prueba 15', null, 'esperando_llave', timestamptz '2000-12-02 10:00-05', timestamptz '2000-12-09 10:00:01-05'),
  ('16', 'b', 'Prueba 16', 'llave-16', 'reembolsado', timestamptz '2001-01-01 10:00-05', null),
  ('17', 'b', 'Prueba 17', null, 'esperando_llave', timestamptz '2001-01-01 10:00-05', timestamptz '2001-01-02 10:00-05'),
  ('20', 'c', 'Prueba 20', null, 'esperando_llave', timestamptz '2005-01-03 10:00-05', null),
  ('21', 'c', 'Prueba 21', null, 'esperando_llave', timestamptz '2005-01-03 10:00-05', timestamptz '2005-01-11 10:00-05'),
  ('40', 'a', 'Aceptamos tu reporte: el monitor no asistió.', null, 'esperando_llave', timestamptz '2005-01-03 10:00-05', null)
) as v(nn, admin, motivo, llave, estado, desde, cerrado);

-- Tokens conocidos para los reembolsos de la prueba. La llave del 12 ya la pidió el correo de cancelación (D-27).
update public.solicitud_llave set token = pg_temp.t(right(id_reembolso::text, 2))
where id_reembolso::text like '70000000-0000-0000-0000-0000000025%';
update public.solicitud_llave set en_correo_de_cancelacion = true where id_reembolso = pg_temp.r('12');

select is(
  (select count(*)::int from public.reembolso where id::text like '70000000-0000-0000-0000-0000000025%'), 20,
  'Control: están los 20 reembolsos de la prueba');

-- ---------------------------------------------------------------------------
-- Las restricciones del reembolso
-- ---------------------------------------------------------------------------
select throws_ok($$update public.reembolso set cerrado_en = now() where id = pg_temp.r('04')$$, '23514', null,
  'Un reembolso pendiente (con llave) no se puede cerrar: solo se cierra lo que espera la llave');
select throws_ok($$update public.reembolso set cerrado_en = now() where id = pg_temp.r('05')$$, '23514', null,
  'Ni uno reembolsado');
select throws_ok($$update public.reembolso set llave_destino = E' \t\n ' where id = pg_temp.r('04')$$, '23514', null,
  'Supuesto 3: una llave de solo espacios no se guarda');
select throws_ok($$update public.reembolso set llave_destino = repeat('x', 201) where id = pg_temp.r('04')$$, '23514', null,
  'Supuesto 3: ni una de 201 caracteres');
select lives_ok(
  $$update public.reembolso set llave_destino = '  ' || repeat('x', 198) || '   y  ' where id = pg_temp.r('04')$$,
  'Una de 200 caracteres una vez normalizados los espacios sí');
update public.reembolso set llave_destino = 'llave-04' where id = pg_temp.r('04');

-- ---------------------------------------------------------------------------
-- El pedido de cada reembolso nuevo (criterio 1)
-- ---------------------------------------------------------------------------
select bag_eq(
  $$select right(id_reembolso::text, 2) from public.pedido_llave where id_reembolso::text like '70000000-0000-0000-0000-0000000025%'$$,
  $$values ('01'), ('02'), ('03'), ('06'), ('07'), ('08'), ('09'), ('10'), ('11'), ('12'), ('13'), ('15'), ('17'), ('20'), ('21'),
           ('40')$$,
  'Cada reembolso que nace esperando la llave tiene un pedido, uno solo; los que nacen con llave (04, 05, 14, 16) no tienen');
select is(
  (select count(*)::int from public.pedido_llave pl join public.reembolso r on r.id = pl.id_reembolso
   where r.id::text like '70000000-0000-0000-0000-0000000025%'
     and not (pl.tipo = 'pedido' and pl.plazo_desde = r.plazo_llave_desde and pl.procesado_en is null and pl.intentos = 0)),
  0, 'Todos son de tipo pedido, con la foto del plazo con que nació el reembolso, sin procesar y sin intentos');

-- HU-024: cancelar la 02 crea un reembolso por pago aprobado; los dos tienen su pedido, y la marca de D-27 dice cuál ya
-- pidió el correo de cancelación (el del correo del Lead) y cuál pide esta HU (el de otro correo).
select is(privado.cancelar_cita('50000000-0000-0000-0000-000000002502', timestamptz '2030-01-01 00:00-05'), 'cancelada',
  'Control: cancelar la 02 a tiempo (HU-024)');
select results_eq(
  $$select d.tipo, d.contacto, d.en_correo_de_cancelacion, d.monto, d.motivo, d.estado::text, d.cerrado_en is null,
           d.plazo_desde = now(), d.plazo_llave_desde = now(), d.vence_en = now() + interval '168 hours',
           d.token = s.token, d.motivo_cancelacion::text, d.nombre_pagador
    from public.reembolso r
    join public.solicitud_llave s on s.id_reembolso = r.id
    join public.pedido_llave pl on pl.id_reembolso = r.id
    cross join lateral public.datos_de_pedido_llave(pl.id) d
    where r.id_pago in ('60000000-0000-0000-0000-000000002531', '60000000-0000-0000-0000-000000002532')
    order by r.id_pago$$,
  $$values ('pedido'::text, 'lucia25@calibra.test'::text, true, 12000, 'Cancelaste la monitoría dentro del plazo.'::text,
            'esperando_llave'::text, true, true, true, true, true, 'estudiante'::text, 'Pagador 31'::text),
           ('pedido', 'otra25@example.com', false, 8000, 'Cancelaste la monitoría dentro del plazo.', 'esperando_llave', true,
            true, true, true, true, 'estudiante', 'Pagador 32')$$,
  'Supuesto 2: los dos reembolsos de la cancelación tienen su pedido; la marca dice que el del Lead ya lo pidió el correo de cancelación (la app lo descarta) y el de otro correo no');

-- P-07: el pago que se aprueba después de que el estudiante canceló también tiene su pedido, sin la marca.
update public.pago set estado = 'aprobado', fecha_revision = now() where id = '60000000-0000-0000-0000-000000002560';
select results_eq(
  $$select d.tipo, d.contacto, d.en_correo_de_cancelacion, d.estado::text
    from public.reembolso r
    join public.pedido_llave pl on pl.id_reembolso = r.id
    cross join lateral public.datos_de_pedido_llave(pl.id) d
    where r.id_pago = '60000000-0000-0000-0000-000000002560'$$,
  $$values ('pedido'::text, 'tarde25@example.com'::text, false, 'esperando_llave'::text)$$,
  'P-07: el reembolso del pago aprobado tarde tiene su pedido y su llave la pide esta HU');

-- D-37: el pedido de un reembolso por inasistencia del monitor trae el motivo de la cancelación.
select results_eq(
  $$select d.motivo_cancelacion::text, d.motivo, d.vence_en
    from public.pedido_llave pl cross join lateral public.datos_de_pedido_llave(pl.id) d
    where pl.id_reembolso = pg_temp.r('40')$$,
  $$values ('monitor_no_asistio'::text, 'Aceptamos tu reporte: el monitor no asistió.'::text, timestamptz '2005-01-10 10:00-05')$$,
  'El pedido de una inasistencia trae monitor_no_asistio, su motivo y el vencimiento a los 7 días');
select is((select count(*)::int from public.datos_de_pedido_llave('70000000-0000-0000-0000-0000000025ff')), 0,
  'Un pedido que no existe no trae filas');

-- ---------------------------------------------------------------------------
-- Entregar la llave (criterio 2): resultados y bordes
-- ---------------------------------------------------------------------------
-- T0 = 3-ene-2005 10:00 en Bogotá: la entrega vence el 10-ene-2005 a las 10:00.
select results_eq(
  $$select privado.entregar_llave(v.token, 'mi-llave', timestamptz '2005-01-04 10:00-05')
    from (values (1, repeat('0', 64)), (2, null::text), (3, ''), (4, upper(pg_temp.t('01')))) as v(n, token) order by v.n$$,
  $$values ('no_existe'::text), ('no_existe'), ('no_existe'), ('no_existe')$$,
  'no_existe: un token inventado, nulo, vacío o con otras letras');
select results_eq(
  $$select privado.entregar_llave(pg_temp.t('01'), v.llave, timestamptz '2005-01-04 10:00-05')
    from (values (1, null::text), (2, ''), (3, E'  \t\n  '), (4, repeat('x', 201)), (5, repeat('x', 100) || '   ' || repeat('y', 100)))
         as v(n, llave) order by v.n$$,
  $$values ('llave_invalida'::text), ('llave_invalida'), ('llave_invalida'), ('llave_invalida'), ('llave_invalida')$$,
  'llave_invalida: nula, vacía, de solo espacios o de más de 200 caracteres una vez normalizados los espacios');
select results_eq(
  $$select estado::text, llave_destino from public.reembolso where id = pg_temp.r('01')$$,
  $$values ('esperando_llave'::text, null::text)$$,
  'Una llave inválida no toca el reembolso');

select is(privado.entregar_llave(pg_temp.t('01'), E'  Mi\tllave   de\n prueba  ', timestamptz '2005-01-10 10:00-05'), 'entregada',
  'P-40: con 7 días exactos todavía se entrega: entregada');
select results_eq(
  $$select estado::text, llave_destino, cerrado_en, plazo_llave_desde from public.reembolso where id = pg_temp.r('01')$$,
  $$values ('pendiente'::text, 'Mi llave de prueba'::text, null::timestamptz, timestamptz '2005-01-03 10:00-05')$$,
  'Criterio 2: guarda la llave con los espacios normalizados y pasa a pendiente en el mismo cambio; el plazo no se toca');
select is(privado.entregar_llave(pg_temp.t('01'), E' Mi llave\tde  prueba\n', timestamptz '2005-01-04 10:00-05'), 'ya_entregada',
  'La misma llave otra vez (un doble clic, otra pestaña), con otros espacios: ya_entregada');
select is(privado.entregar_llave(pg_temp.t('01'), 'otra-llave', timestamptz '2005-01-04 10:00-05'), 'ya_entregada_otra',
  'Supuesto 3: una llave distinta no cambia la guardada y se dice: ya_entregada_otra, no ya_entregada');
select is(privado.entregar_llave(pg_temp.t('01'), 'mi llave de prueba', timestamptz '2005-01-04 10:00-05'), 'ya_entregada_otra',
  'La comparación es exacta: con otras mayúsculas es otra llave (ante la duda, se dice que no se cambió)');
select is(privado.entregar_llave(pg_temp.t('01'), '', timestamptz '2005-01-04 10:00-05'), 'ya_entregada_otra',
  'Aunque la llave nueva sea inválida, primero se dice que ya teníamos otra');
select is(privado.entregar_llave(pg_temp.t('01'), null, timestamptz '2005-01-04 10:00-05'), 'ya_entregada_otra',
  'Y una nula, también');
select is((select llave_destino from public.reembolso where id = pg_temp.r('01')), 'Mi llave de prueba',
  'La llave guardada no cambió');
select is(privado.entregar_llave(pg_temp.t('04'), 'otra-llave', timestamptz '2005-01-04 10:00-05'), 'ya_entregada_otra',
  'Un reembolso pendiente, con otra llave: ya_entregada_otra');
select is(privado.entregar_llave(pg_temp.t('04'), 'llave-04', timestamptz '2005-01-04 10:00-05'), 'ya_entregada',
  'Y con la suya: ya_entregada');
select is(privado.entregar_llave(pg_temp.t('05'), 'otra-llave', timestamptz '2005-01-04 10:00-05'), 'ya_entregada_otra',
  'Uno reembolsado, con otra llave: ya_entregada_otra');
select is(privado.entregar_llave(pg_temp.t('05'), 'llave-05', timestamptz '2005-01-04 10:00-05'), 'ya_entregada',
  'Y con la suya: ya_entregada');
select results_eq(
  $$select right(id::text, 2), estado::text, llave_destino from public.reembolso
    where id in (pg_temp.r('04'), pg_temp.r('05')) order by id$$,
  $$values ('04'::text, 'pendiente'::text, 'llave-04'::text), ('05', 'reembolsado', 'llave-05')$$,
  'Ninguno de esos envíos cambió el estado ni la llave');

select is(
  privado.entregar_llave(pg_temp.t('02'), 'mi-llave', timestamptz '2005-01-10 10:00-05' + interval '1 microsecond'), 'cerrado',
  'P-10: un microsegundo después de los 7 días ya no se entrega, aunque el cierre todavía no haya corrido: cerrado');
select is(
  privado.entregar_llave(pg_temp.t('02'), '', timestamptz '2005-01-10 10:00-05' + interval '1 microsecond'), 'cerrado',
  'Con el caso vencido, cerrado se dice antes que llave_invalida');
select is(privado.entregar_llave(pg_temp.t('02'), 'mi-llave', null), 'cerrado',
  'Sin p_ahora falla cerrado: no se entrega');
select results_eq(
  $$select estado::text, llave_destino, cerrado_en from public.reembolso where id = pg_temp.r('02')$$,
  $$values ('esperando_llave'::text, null::text, null::timestamptz)$$,
  'Entregar tarde no cierra el caso ni guarda nada: el cierre es de pg_cron');
select is(privado.entregar_llave(pg_temp.t('03'), 'mi-llave', timestamptz '2005-01-04 10:00-05'), 'cerrado',
  'Un caso cerrado no recibe la llave aunque se mire con una hora dentro del plazo: cerrado');

select is(privado.entregar_llave(pg_temp.t('06'), repeat('x', 200), timestamptz '2005-01-04 10:00-05'), 'entregada',
  'Una llave de 200 caracteres justos: entregada');
select is((select char_length(llave_destino) from public.reembolso where id = pg_temp.r('06')), 200,
  'Y se guarda completa');

-- Por la puerta del servidor, con la hora real: el 07 espera desde ayer.
set local role service_role;
select is(public.entregar_llave('2507' || repeat('a', 60), '  llave   del servidor '), 'entregada',
  'Por la puerta (service_role), con la hora de la base: entregada');
select is(public.entregar_llave('2507' || repeat('a', 60), 'llave del servidor'), 'ya_entregada',
  'Un segundo envío con la misma llave (un doble clic, otra pestaña) responde ya_entregada');
select is(public.entregar_llave('2507' || repeat('a', 60), 'otra'), 'ya_entregada_otra',
  'Uno con otra llave responde ya_entregada_otra');
select is(public.entregar_llave(repeat('f', 64), 'mi-llave'), 'no_existe', 'Un token que no es de nadie: no_existe');
reset role;
select is((select llave_destino from public.reembolso where id = pg_temp.r('07')), 'llave del servidor',
  'La puerta guardó la llave normalizada');

-- ---------------------------------------------------------------------------
-- Lo que muestra la página (datos_de_llave, con la hora real)
-- ---------------------------------------------------------------------------
set local role service_role;
select results_eq(
  $$select v.nn, d.estado, d.monto, d.motivo, d.vence_en
    from (values ('01'), ('03'), ('05'), ('07'), ('08'), ('09'), ('10')) as v(nn)
    cross join lateral public.datos_de_llave('25' || v.nn || repeat('a', 60)) d
    order by v.nn$$,
  $$values ('01'::text, 'pendiente'::text, 20000, 'Prueba 01'::text, timestamptz '2005-01-10 10:00-05'),
           ('03', 'cerrado', 20000, 'Prueba 03', timestamptz '2005-01-10 10:00-05'),
           ('05', 'reembolsado', 20000, 'Prueba 05', timestamptz '2005-01-10 10:00-05'),
           ('07', 'pendiente', 20000, 'Prueba 07', now() + interval '144 hours'),
           ('08', 'esperando_llave', 20000, 'Prueba 08', now()),
           ('09', 'cerrado', 20000, 'Prueba 09', now() - interval '1 microsecond'),
           ('10', 'cerrado', 20000, 'Prueba 10', timestamptz '2005-01-10 10:00-05')$$,
  'La página ve pendiente, reembolsado, cerrado (cerrado o vencido sin cerrar: el 09 y el 10) y esperando_llave con 7 días exactos (el 08, P-40), con el monto, el motivo y el vencimiento');
select is((select count(*)::int from public.datos_de_llave(repeat('0', 64))), 0, 'Un token que no es de nadie no trae filas');
select is((select count(*)::int from public.datos_de_llave(null)), 0, 'Ni uno nulo');
reset role;

-- ---------------------------------------------------------------------------
-- Criterio 3: la llave solo la ve un admin
-- ---------------------------------------------------------------------------
set local role anon;
select throws_ok($$select llave_destino from public.reembolso$$, '42501', null,
  'anon no puede leer reembolsos: permiso denegado');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000002501","role":"authenticated","is_anonymous":true}';
select is((select count(*)::int from public.reembolso where id = pg_temp.r('01')), 0,
  'La sesión del Lead (que agendó y canceló) no ve el reembolso ni su llave');
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-000000002501","role":"authenticated"}';
select is((select count(*)::int from public.reembolso where id = pg_temp.r('01')), 0, 'El monitor tampoco');
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000025d0","role":"authenticated"}';
select is((select count(*)::int from public.reembolso where id = pg_temp.r('01')), 0, 'RN-23: ni un admin desactivado');
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000025b0","role":"authenticated"}';
select is((select llave_destino from public.reembolso where id = pg_temp.r('01')), 'Mi llave de prueba',
  'Un admin activo sí la ve (aunque el caso sea de otro admin)');
reset role;

-- ---------------------------------------------------------------------------
-- El recordatorio a los 3 días y el cierre a los 7 (criterios 4 y 5)
-- ---------------------------------------------------------------------------
-- V0 = 1-ene-2001 10:00 en Bogotá. 11 y 12 esperan desde V0: recordatorio desde el 4-ene 10:00, cierre después del
-- 8-ene 10:00. 13 espera desde el 27-dic-2000: ya venció el 3-ene. Los de 2005 y los de ahora no entran.
select results_eq($$select * from privado.vencer_pedidos_de_llave(null)$$, $$values (0, 0)$$,
  'Sin p_ahora no cierra ni recuerda nada');
select is((select cerrado_en from public.reembolso where id = pg_temp.r('13')), null::timestamptz, 'El 13 sigue abierto');

select results_eq(
  $$select * from privado.vencer_pedidos_de_llave(timestamptz '2001-01-04 10:00-05' - interval '1 microsecond')$$,
  $$values (1, 0)$$,
  'Un microsegundo antes de los 3 días: cierra el 13 (vencido) y no recuerda a nadie');
select results_eq(
  $$select right(id::text, 2), cerrado_en from public.reembolso where id in (pg_temp.r('11'), pg_temp.r('12'), pg_temp.r('13'))
    order by id$$,
  $$values ('11'::text, null::timestamptz), ('12', null),
           ('13', timestamptz '2001-01-04 10:00-05' - interval '1 microsecond')$$,
  'El 13 quedó cerrado con la hora del cierre; 11 y 12 siguen abiertos');
select is(
  (select count(*)::int from public.pedido_llave where id_reembolso = pg_temp.r('13') and tipo = 'recordatorio'), 0,
  'El 13 venció sin recordatorio y ya no lo recibe: los cerrados no se recuerdan');

select results_eq($$select * from privado.vencer_pedidos_de_llave(timestamptz '2001-01-04 10:00-05')$$, $$values (0, 2)$$,
  'P-40: a los 3 días exactos anota el recordatorio del 11 y del 12');
select results_eq(
  $$select right(id_reembolso::text, 2), plazo_desde, procesado_en is null from public.pedido_llave
    where tipo = 'recordatorio' and id_reembolso::text like '70000000-0000-0000-0000-0000000025%' order by id_reembolso$$,
  $$values ('11'::text, timestamptz '2001-01-01 10:00-05', true), ('12', timestamptz '2001-01-01 10:00-05', true)$$,
  'Supuesto 2: el recordatorio va también al 12, cuya llave pidió el correo de cancelación, con la foto de su ciclo');
select results_eq($$select * from privado.vencer_pedidos_de_llave(timestamptz '2001-01-04 11:00-05')$$, $$values (0, 0)$$,
  'Correrlo otra vez no duplica el recordatorio: uno por ciclo');
select results_eq($$select * from privado.vencer_pedidos_de_llave(timestamptz '2001-01-08 10:00-05')$$, $$values (0, 0)$$,
  'P-40: con 7 días exactos todavía no cierra');
select results_eq(
  $$select * from privado.vencer_pedidos_de_llave(timestamptz '2001-01-08 10:00-05' + interval '1 microsecond')$$,
  $$values (2, 0)$$,
  'Criterio 5: un microsegundo después de los 7 días cierra el 11 y el 12');
select results_eq(
  $$select right(id::text, 2), estado::text, cerrado_en from public.reembolso
    where id in (pg_temp.r('11'), pg_temp.r('12'), pg_temp.r('14'), pg_temp.r('15'), pg_temp.r('16')) order by id$$,
  $$values ('11'::text, 'esperando_llave'::text, timestamptz '2001-01-08 10:00-05' + interval '1 microsecond'),
           ('12', 'esperando_llave', timestamptz '2001-01-08 10:00-05' + interval '1 microsecond'),
           ('14', 'pendiente', null::timestamptz),
           ('15', 'esperando_llave', timestamptz '2000-12-09 10:00:01-05'),
           ('16', 'reembolsado', null)$$,
  'Quedan cerrados sin perder el estado; el pendiente y el reembolsado no se tocan, y un cerrado de antes conserva su hora');
select is(
  (select count(*)::int from public.pedido_llave
   where id_reembolso in (pg_temp.r('14'), pg_temp.r('15'), pg_temp.r('16'), pg_temp.r('17')) and tipo = 'recordatorio'), 0,
  'Ni el pendiente, ni el reembolsado, ni los cerrados de antes (el 17, aunque su plazo siga corriendo) reciben recordatorio');
select results_eq(
  $$select v.nn, d.estado from (values ('11'), ('13')) as v(nn)
    cross join lateral public.datos_de_llave('25' || v.nn || repeat('a', 60)) d order by v.nn$$,
  $$values ('11'::text, 'cerrado'::text), ('13', 'cerrado')$$,
  'La página de un caso cerrado dice cerrado');

-- ---------------------------------------------------------------------------
-- Reenviar el enlace sin reabrir (supuesto 5)
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"role":"authenticated"}';
select is(privado.reenviar_pedido_llave(pg_temp.r('10'), timestamptz '2005-01-04 10:00-05'), 'sin_sesion',
  'Sin sesión (el token no trae sub): sin_sesion');
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000002501","role":"authenticated","is_anonymous":true}';
select is(privado.reenviar_pedido_llave(pg_temp.r('10'), timestamptz '2005-01-04 10:00-05'), 'sin_permiso',
  'El Lead no reenvía: sin_permiso');
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000025d0","role":"authenticated"}';
select is(privado.reenviar_pedido_llave(pg_temp.r('10'), timestamptz '2005-01-04 10:00-05'), 'sin_permiso',
  'RN-23: ni un admin desactivado');
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000025b0","role":"authenticated"}';
select is(privado.reenviar_pedido_llave('70000000-0000-0000-0000-0000000025ff', timestamptz '2005-01-04 10:00-05'),
  'no_encontrado', 'Un reembolso que no existe: no_encontrado');
select is(privado.reenviar_pedido_llave(pg_temp.r('04'), timestamptz '2005-01-04 10:00-05'), 'ya_entregada',
  'Uno que ya tiene llave: ya_entregada');
select is(privado.reenviar_pedido_llave(pg_temp.r('03'), timestamptz '2005-01-04 10:00-05'), 'cerrado',
  'Uno cerrado: cerrado (hay que reabrirlo)');
select is(privado.reenviar_pedido_llave(pg_temp.r('02'), timestamptz '2005-01-10 10:00-05' + interval '1 microsecond'), 'cerrado',
  'Uno vencido aunque el cierre no haya corrido: cerrado');
select is(privado.reenviar_pedido_llave(pg_temp.r('10'), timestamptz '2005-01-04 10:00-05'), 'reenviado',
  'Cualquier admin activo reenvía el enlace de uno que espera la llave: reenviado');
select is(privado.reenviar_pedido_llave(pg_temp.r('10'), timestamptz '2005-01-04 10:00-05'), 'reenviado',
  'Un doble clic también responde reenviado...');
select results_eq(
  $$select tipo, plazo_desde, procesado_en is null from public.pedido_llave
    where id_reembolso = pg_temp.r('10') and tipo = 'reenvio'$$,
  $$values ('reenvio'::text, timestamptz '2005-01-03 10:00-05', true)$$,
  '...pero hay un solo reenvío en cola, con el ciclo actual: sale un solo correo');
select results_eq(
  $$select plazo_llave_desde, cerrado_en from public.reembolso where id = pg_temp.r('10')$$,
  $$values (timestamptz '2005-01-03 10:00-05', null::timestamptz)$$,
  'Reenviar no cambia el plazo ni el cierre');
update public.pedido_llave set procesado_en = now() where id_reembolso = pg_temp.r('10') and tipo = 'reenvio';
select is(privado.reenviar_pedido_llave(pg_temp.r('10'), timestamptz '2005-01-05 10:00-05'), 'reenviado',
  'Ya procesado el primero, se puede reenviar otra vez');
select is((select count(*)::int from public.pedido_llave where id_reembolso = pg_temp.r('10') and tipo = 'reenvio'), 2,
  'Son dos reenvíos: el procesado y el nuevo');

-- ---------------------------------------------------------------------------
-- Reabrir un caso cerrado (criterio 5, supuesto 4)
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"role":"authenticated"}';
select is(privado.reabrir_reembolso(pg_temp.r('11'), timestamptz '2001-01-11 10:00-05'), 'sin_sesion',
  'Sin sesión: sin_sesion');
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000002501","role":"authenticated","is_anonymous":true}';
select is(privado.reabrir_reembolso(pg_temp.r('11'), timestamptz '2001-01-11 10:00-05'), 'sin_permiso',
  'El Lead no reabre: sin_permiso');
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-000000002501","role":"authenticated"}';
select is(privado.reabrir_reembolso(pg_temp.r('11'), timestamptz '2001-01-11 10:00-05'), 'sin_permiso',
  'El monitor tampoco');
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000025d0","role":"authenticated"}';
select is(privado.reabrir_reembolso(pg_temp.r('11'), timestamptz '2001-01-11 10:00-05'), 'sin_permiso',
  'RN-23: ni un admin desactivado');
select is((select cerrado_en from public.reembolso where id = pg_temp.r('11')),
  timestamptz '2001-01-08 10:00-05' + interval '1 microsecond', 'Nada de eso lo reabrió');

set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000025a0","role":"authenticated"}';
select is(privado.reabrir_reembolso('70000000-0000-0000-0000-0000000025ff', timestamptz '2001-01-11 10:00-05'), 'no_encontrado',
  'Un reembolso que no existe: no_encontrado');
select is(privado.reabrir_reembolso(pg_temp.r('10'), timestamptz '2005-01-04 10:00-05'), 'no_cerrado',
  'Uno que espera la llave dentro del plazo: no_cerrado');
select is(privado.reabrir_reembolso(pg_temp.r('04'), timestamptz '2005-01-04 10:00-05'), 'no_cerrado',
  'Uno que ya tiene llave: no_cerrado');

call pg_temp.aislar();
select is(privado.reabrir_reembolso(pg_temp.r('11'), timestamptz '2001-01-11 10:00-05'), 'reabierto',
  'Criterio 5: cualquier admin activo (A) reabre el caso cerrado de otro (B): reabierto');
select results_eq(
  $$select r.estado::text, r.cerrado_en, r.plazo_llave_desde, r.id_admin, s.token
    from public.reembolso r join public.solicitud_llave s on s.id_reembolso = r.id where r.id = pg_temp.r('11')$$,
  $$values ('esperando_llave'::text, null::timestamptz, timestamptz '2001-01-11 10:00-05',
            'a0000000-0000-0000-0000-0000000025b0'::uuid, pg_temp.t('11'))$$,
  'Supuesto 4: vuelve a esperar la llave, los 7 días cuentan desde que se reabrió, sigue con su admin (B está activo) y el token no cambia');
select results_eq(
  $$select tipo, plazo_desde, procesado_en is null from public.pedido_llave
    where id_reembolso = pg_temp.r('11') and tipo = 'reapertura'$$,
  $$values ('reapertura'::text, timestamptz '2001-01-11 10:00-05', true)$$,
  'Sale un pedido de tipo reapertura con el ciclo nuevo: el mismo enlace');
select is(privado.reabrir_reembolso(pg_temp.r('11'), timestamptz '2001-01-11 10:00-05'), 'no_cerrado',
  'Reabrirlo otra vez (otro admin, un doble clic) ya no hace nada: no_cerrado');
select is((select count(*)::int from public.pedido_llave where id_reembolso = pg_temp.r('11') and tipo = 'reapertura'), 1,
  'Y no sale otro correo');

select is(privado.reabrir_reembolso(pg_temp.r('12'), timestamptz '2001-01-11 10:00-05'), 'reabierto',
  'El 12, cuyo admin (D) está desactivado, también se reabre');
select is((select id_admin from public.reembolso where id = pg_temp.r('12')), 'a0000000-0000-0000-0000-0000000025a0'::uuid,
  'Y pasa al primer admin activo del turno (A, D-26): un caso reabierto no se queda con un admin desactivado');

select is(privado.reabrir_reembolso(pg_temp.r('02'), timestamptz '2005-01-11 10:00-05'), 'reabierto',
  'Uno vencido aunque el cierre no haya corrido también se reabre, como dice la página');

-- El ciclo nuevo: recordatorio a los 3 días de reabierto y la entrega hasta 7 días después.
select results_eq($$select * from privado.vencer_pedidos_de_llave(timestamptz '2001-01-14 10:00-05')$$, $$values (0, 2)$$,
  'A los 3 días de reabiertos, el 11 y el 12 reciben el recordatorio de su ciclo nuevo');
select results_eq(
  $$select plazo_desde from public.pedido_llave where id_reembolso = pg_temp.r('11') and tipo = 'recordatorio' order by plazo_desde$$,
  $$values (timestamptz '2001-01-01 10:00-05'), (timestamptz '2001-01-11 10:00-05')$$,
  'El 11 tiene dos recordatorios, uno por ciclo');
select is(privado.entregar_llave(pg_temp.t('11'), 'llave-11', timestamptz '2001-01-18 10:00-05'), 'entregada',
  'Con el mismo enlace y 7 días exactos desde que se reabrió: entregada');
select is(privado.entregar_llave(pg_temp.t('02'), 'llave-02', timestamptz '2005-01-18 10:00-05'), 'entregada',
  'El 02 también');

-- Por la puerta, con la sesión del admin y la hora real.
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000025b0","role":"authenticated"}';
select is(public.reabrir_reembolso(pg_temp.r('03')), 'reabierto', 'Por la puerta, B reabre el 03 con la hora de la base');
select is(public.reenviar_pedido_llave(pg_temp.r('03')), 'reenviado', 'Y, por la otra puerta, reenvía su enlace');
reset role;
select results_eq(
  $$select r.cerrado_en, r.plazo_llave_desde, d.estado, d.vence_en
    from public.reembolso r cross join lateral public.datos_de_llave(pg_temp.t('03')) d where r.id = pg_temp.r('03')$$,
  $$values (null::timestamptz, now(), 'esperando_llave'::text, now() + interval '168 hours')$$,
  'El 03 quedó abierto con el plazo desde ahora: la página vuelve a mostrar el formulario');
select results_eq(
  $$select tipo, plazo_desde from public.pedido_llave
    where id_reembolso = pg_temp.r('03') and tipo in ('reapertura', 'reenvio') order by tipo$$,
  $$values ('reapertura'::text, now()), ('reenvio', now())$$,
  'Y tiene su reapertura y su reenvío, los dos del ciclo nuevo');

-- ---------------------------------------------------------------------------
-- La petición a la app (privado.disparar_pedidos_llave y el trigger de sentencia)
-- ---------------------------------------------------------------------------
select ok(exists (select 1 from public.pedido_llave where procesado_en is null),
  'Control: hay pedidos pendientes y Vault no trae la configuración de la app');
select is(privado.disparar_pedidos_llave(), null::bigint,
  'Con pedidos pendientes pero sin configuración en Vault devuelve null y no falla (así en local)');
select vault.create_secret('https://calibra.test/', 'calibra_sitio_url');
select vault.create_secret('secreto-de-prueba-con-al-menos-treinta-y-dos-caracteres', 'calibra_cron_secreto');
select isnt(privado.disparar_pedidos_llave(), null::bigint,
  'Con los dos secretos en Vault y pedidos pendientes sí pide el procesamiento: devuelve el id de la petición de pg_net');
select ok(
  (select count(*) = 1 from net.http_request_queue
   where url = 'https://calibra.test/api/procesos/pedir-llaves' and method = 'POST'
     and headers ->> 'Authorization' = 'Bearer secreto-de-prueba-con-al-menos-treinta-y-dos-caracteres'),
  'La petición va a /api/procesos/pedir-llaves de la dirección de la app, con el secreto');

-- Cada paso que anota un correo le pide a la app que lo mande (privado.disparar_pedidos_llave): el recordatorio del
-- trabajo de pg_cron, reabrir y reenviar. Cada uno suma una petición a la cola de pg_net, aunque anote varios correos.
-- `cola` guarda cuántas había antes de cada paso.
create temporary table cola (antes integer);
insert into cola select count(*) from net.http_request_queue where url = 'https://calibra.test/api/procesos/pedir-llaves';
select results_eq($$select * from privado.vencer_pedidos_de_llave(timestamptz '2005-01-06 10:00-05')$$, $$values (1, 3)$$,
  'Control: a los 3 días de T0 el trabajo anota el recordatorio del 10, del 20 y del 40 (y cierra el 12, reabierto en 2001)');
select is(
  (select count(*)::int from net.http_request_queue where url = 'https://calibra.test/api/procesos/pedir-llaves')
    - (select antes from cola),
  1, 'Criterio 4: el recordatorio le pide a la app que lo mande: una sola petición, aunque anote tres');

set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000025a0","role":"authenticated"}';
update cola set antes = (select count(*) from net.http_request_queue where url = 'https://calibra.test/api/procesos/pedir-llaves');
select is(privado.reabrir_reembolso(pg_temp.r('17'), timestamptz '2001-01-11 10:00-05'), 'reabierto',
  'Control: A reabre el 17, que se cerró en 2001');
select is(
  (select count(*)::int from net.http_request_queue where url = 'https://calibra.test/api/procesos/pedir-llaves')
    - (select antes from cola),
  1, 'Supuesto 4: reabrir le pide a la app que mande el enlace: una petición');

update cola set antes = (select count(*) from net.http_request_queue where url = 'https://calibra.test/api/procesos/pedir-llaves');
select is(privado.reenviar_pedido_llave(pg_temp.r('40'), timestamptz '2005-01-06 10:00-05'), 'reenviado',
  'Control: A reenvía el enlace del 40');
select is(
  (select count(*)::int from net.http_request_queue where url = 'https://calibra.test/api/procesos/pedir-llaves')
    - (select antes from cola),
  1, 'Supuesto 5: reenviar le pide a la app que mande el enlace: una petición');

update cola set antes = (select count(*) from net.http_request_queue where url = 'https://calibra.test/api/procesos/pedir-llaves');
insert into public.reembolso (id, id_pago, id_admin, monto, motivo) values
  (pg_temp.r('50'), '60000000-0000-0000-0000-000000002550', 'a0000000-0000-0000-0000-0000000025a0', 20000, 'Prueba 50'),
  (pg_temp.r('51'), '60000000-0000-0000-0000-000000002551', 'a0000000-0000-0000-0000-0000000025a0', 20000, 'Prueba 51');
select is(
  (select count(*)::int from net.http_request_queue where url = 'https://calibra.test/api/procesos/pedir-llaves')
    - (select antes from cola),
  1, 'Dos reembolsos en una sentencia: dos pedidos y una sola petición a la app');
update cola set antes = (select count(*) from net.http_request_queue where url = 'https://calibra.test/api/procesos/pedir-llaves');
insert into public.reembolso (id, id_pago, id_admin, monto, motivo, llave_destino, estado) values
  (pg_temp.r('52'), '60000000-0000-0000-0000-000000002552', 'a0000000-0000-0000-0000-0000000025a0', 20000, 'Prueba 52',
   'llave-52', 'pendiente');
select is(
  (select count(*)::int from net.http_request_queue where url = 'https://calibra.test/api/procesos/pedir-llaves')
    - (select antes from cola),
  0, 'Una sentencia que no crea ninguno esperando la llave no pide nada');

-- Sin pendientes no pide nada. Se marcan todos (también los de otras pruebas, si los hubiera): el rollback lo deshace.
update public.pedido_llave set procesado_en = now() where procesado_en is null;
select is(privado.disparar_pedidos_llave(), null::bigint,
  'Sin pedidos pendientes no pide nada, aunque Vault tenga la configuración');
delete from vault.secrets where name in ('calibra_sitio_url', 'calibra_cron_secreto');

-- ---------------------------------------------------------------------------
-- Si el pedido a la app falla, nada se cae
-- ---------------------------------------------------------------------------
-- Se reemplaza disparar_pedidos_llave por una que falla (como una dirección mal escrita en Vault). El reemplazo se deshace
-- con el rollback.
create or replace function privado.disparar_pedidos_llave()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'falla de prueba: pg_net no responde';
end;
$$;

select lives_ok(
  $$insert into public.reembolso (id, id_pago, id_admin, monto, motivo, plazo_llave_desde) values
      (pg_temp.r('53'), '60000000-0000-0000-0000-000000002553', 'a0000000-0000-0000-0000-0000000025a0', 20000, 'Prueba 53',
       timestamptz '2001-01-01 10:00-05')$$,
  'Con el pedido a la app fallando, crear un reembolso no falla');
select is((select count(*)::int from public.pedido_llave where id_reembolso = pg_temp.r('53') and tipo = 'pedido'),
  1, 'Su pedido queda anotado: pg_cron lo vuelve a pedir');
select results_eq($$select * from privado.vencer_pedidos_de_llave(timestamptz '2001-01-04 10:00-05')$$, $$values (0, 1)$$,
  'El cierre anota el recordatorio aunque el pedido a la app falle');
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000025a0","role":"authenticated"}';
select is(privado.reenviar_pedido_llave(pg_temp.r('10'), timestamptz '2005-01-04 10:00-05'), 'reenviado',
  'Reenviar tampoco falla');
select is(privado.reabrir_reembolso(pg_temp.r('13'), timestamptz '2001-01-11 10:00-05'), 'reabierto',
  'Ni reabrir');

-- ---------------------------------------------------------------------------
-- Un caso cerrado no es un caso abierto (HU-074)
-- ---------------------------------------------------------------------------
-- C tiene el 20 (abierto) y el 21 (cerrado).
call pg_temp.aislar();
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000025a0","role":"authenticated"}';
select is(
  (select casos_abiertos from public.equipo_de_admins() where id = 'a0000000-0000-0000-0000-0000000025c0'), 1,
  'La pantalla del equipo cuenta un caso abierto para C: el reembolso cerrado no cuenta');
select is(privado.reasignar_casos_de_admin('a0000000-0000-0000-0000-0000000025c0'), 1,
  'Al desactivar a C se mueve solo su caso abierto');
select results_eq(
  $$select right(id::text, 2), id_admin from public.reembolso where id in (pg_temp.r('20'), pg_temp.r('21')) order by id$$,
  $$values ('20'::text, 'a0000000-0000-0000-0000-0000000025a0'::uuid), ('21', 'a0000000-0000-0000-0000-0000000025c0'::uuid)$$,
  'El abierto pasa al siguiente activo (A, porque D está desactivado) y el cerrado se queda con C');

-- C es el único admin activo y solo tiene un caso cerrado: desactivarlo no falla.
update auth.users set banned_until = 'infinity'
where id in ('a0000000-0000-0000-0000-0000000025a0', 'a0000000-0000-0000-0000-0000000025b0');
select lives_ok($$select privado.reasignar_casos_de_admin('a0000000-0000-0000-0000-0000000025c0')$$,
  'Un caso cerrado no impide desactivar al último admin activo (no hay a quién dárselo y no hace falta)');
select is(privado.reasignar_casos_de_admin('a0000000-0000-0000-0000-0000000025c0'), 0, 'Y no mueve nada');
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000025c0","role":"authenticated"}';
select is(
  (select casos_abiertos from public.equipo_de_admins() where id = 'a0000000-0000-0000-0000-0000000025c0'), 0,
  'Para la pantalla del equipo, C no tiene casos abiertos');

select * from finish();
rollback;
