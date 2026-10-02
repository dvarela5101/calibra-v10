-- Pruebas pgTAP de la reseña de una monitoría individual desde el correo (HU-035, RN-70, RN-72, D-17).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.
--
-- Qué cubre la migración 20261001233317_resena_individual.sql:
--   * Las restricciones de public.resena (D-17): calificación de 1 a 5; comentario nulo o de 1 a 1000 caracteres.
--   * public.invitacion_resena, la bandeja de salida de los enlaces: RLS sin políticas y permisos mínimos. Nadie con sesión
--     (anon, authenticated) la toca; service_role solo lee y marca `procesado_en` e `intentos`.
--   * El trigger monitoria_anota_invitacion_resena (privado.anotar_invitacion_resena): anota la invitación en la misma
--     transacción en que una individual pasa a `realizada`, sea porque la finaliza el monitor (public.finalizar_monitoria)
--     o por el cierre automático (privado.cerrar_monitorias_sin_finalizar). Una por cada pago que no esté rechazado y no
--     tenga reseña. Nada para las grupales, para pagos rechazados o con reseña, ni para otras transiciones. No se duplica.
--   * privado.disparar_invitaciones_resena: le pide a la app que procese las invitaciones solo si hay pendientes y Vault
--     trae `calibra_sitio_url` y `calibra_cron_secreto`; si no, devuelve null y no falla (así en local).
--   * public.datos_de_invitacion_resena, public.resena_por_token y public.registrar_resena: solo las ejecuta service_role.
--   * El trabajo de pg_cron calibra-invitar-resenas, cada 5 minutos.
-- Las monitorías se insertan como postgres: el trigger completa id_monitor desde la franja y exige que la fecha caiga en
-- el día de la franja (todas son miércoles de marzo de 2020, en el pasado: así el monitor ya puede finalizarlas, y el
-- cierre automático con ahora = 10-mar-2020 12:00 en Bogotá solo alcanza a la que cae el 4-mar). Una realizada exige
-- fecha_finalizacion y una cancelada, motivo.
--
-- Elenco (todos los ids terminan en 35NN; las materias son 'PGTAP-35-A' y 'PGTAP-35-B'):
--   Monitores: A (materia A) y B (materia B). Admin 01. Leads 01 y 02, cada uno con su correo y su teléfono.
--   Monitorías individuales (cada una con su franja; el pago NN lleva el mismo número):
--     01 confirmada con un pago aprobado: la finaliza el monitor, y la reseña sale bien
--     02 confirmada con un pago en revisión, del 4-mar: la cierra el cierre automático
--     03 del monitor B y el lead 02, con un pago aprobado y otro rechazado (93): la finaliza el monitor
--     04 con un solo pago rechazado    05 con un pago que ya tiene reseña    06 grupal con un pago aprobado
--     07 confirmada con un pago aprobado: la cancela el estudiante    08 por pagar: se confirma
--     09 con un pago aprobado: pasa a realizada, vuelve atrás y pasa otra vez (no duplica)
--     10 con un pago aprobado: finalizada y luego devuelta a confirmada    11 con un pago aprobado que luego se rechaza
--     12 sin pagos    13 con un pago aprobado, para calificaciones y comentarios que la base rechaza
--     14 con un pago aprobado, para cuando el pedido a la app falla

begin;
create extension if not exists pgtap with schema extensions;

select plan(150);

-- ---------------------------------------------------------------------------
-- La tabla: RLS sin políticas y permisos mínimos
-- ---------------------------------------------------------------------------
select has_table('public', 'invitacion_resena', 'Existe public.invitacion_resena, la bandeja de salida de los enlaces de reseña');
select columns_are('public', 'invitacion_resena', array['id', 'id_pago', 'token', 'creada_en', 'procesado_en', 'intentos'],
  'Sus columnas son el id, el pago, el token, cuándo se anotó, cuándo la app la procesó y cuántas corridas fallaron');
select ok((select relrowsecurity from pg_class where oid = 'public.invitacion_resena'::regclass),
  'RLS está activo en invitacion_resena');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'invitacion_resena'), 0,
  'Sin políticas: RLS le niega todo a anon y authenticated (el trigger inserta como security definer y la app usa la llave secreta)');
select ok(
  not exists (
    select 1
    from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where c.oid = 'public.invitacion_resena'::regclass and a.grantee = 0),
  'Nadie la hereda de PUBLIC');

select ok(
  not has_any_column_privilege('anon', 'public.invitacion_resena', 'select')
  and not has_any_column_privilege('anon', 'public.invitacion_resena', 'insert')
  and not has_any_column_privilege('anon', 'public.invitacion_resena', 'update')
  and not has_any_column_privilege('anon', 'public.invitacion_resena', 'references')
  and not has_table_privilege('anon', 'public.invitacion_resena', 'delete')
  and not has_table_privilege('anon', 'public.invitacion_resena', 'truncate')
  and not has_table_privilege('anon', 'public.invitacion_resena', 'trigger'),
  'anon no tiene ningún permiso sobre invitacion_resena');
select ok(
  not has_any_column_privilege('authenticated', 'public.invitacion_resena', 'select')
  and not has_any_column_privilege('authenticated', 'public.invitacion_resena', 'insert')
  and not has_any_column_privilege('authenticated', 'public.invitacion_resena', 'update')
  and not has_any_column_privilege('authenticated', 'public.invitacion_resena', 'references')
  and not has_table_privilege('authenticated', 'public.invitacion_resena', 'delete')
  and not has_table_privilege('authenticated', 'public.invitacion_resena', 'truncate')
  and not has_table_privilege('authenticated', 'public.invitacion_resena', 'trigger'),
  'authenticated tampoco tiene ninguno: ni el monitor ni el estudiante ni un admin leen los tokens');

select ok(has_table_privilege('service_role', 'public.invitacion_resena', 'select'),
  'service_role lee invitacion_resena (la app busca las pendientes y el token)');
select ok(has_column_privilege('service_role', 'public.invitacion_resena', 'procesado_en', 'update')
  and has_column_privilege('service_role', 'public.invitacion_resena', 'intentos', 'update'),
  'service_role actualiza procesado_en e intentos (marca la invitación como procesada o cuenta una corrida fallida)');
select ok(
  not has_column_privilege('service_role', 'public.invitacion_resena', 'id', 'update')
  and not has_column_privilege('service_role', 'public.invitacion_resena', 'id_pago', 'update')
  and not has_column_privilege('service_role', 'public.invitacion_resena', 'token', 'update')
  and not has_column_privilege('service_role', 'public.invitacion_resena', 'creada_en', 'update')
  and not has_table_privilege('service_role', 'public.invitacion_resena', 'update'),
  'Pero ninguna otra columna: el id, el pago, el token y creada_en no se reescriben');
select ok(
  not has_any_column_privilege('service_role', 'public.invitacion_resena', 'insert')
  and not has_table_privilege('service_role', 'public.invitacion_resena', 'delete')
  and not has_table_privilege('service_role', 'public.invitacion_resena', 'truncate')
  and not has_any_column_privilege('service_role', 'public.invitacion_resena', 'references')
  and not has_table_privilege('service_role', 'public.invitacion_resena', 'trigger'),
  'service_role no inserta, no borra, no trunca: las invitaciones las anota solo el trigger');

-- Y la prueba de que se aplica de verdad (sin filas todavía: el permiso se revisa antes que RLS).
set local role anon;
select throws_ok($$select * from public.invitacion_resena$$, '42501', null, 'anon no puede leer invitacion_resena: permiso denegado');
select throws_ok($$select token from public.invitacion_resena$$, '42501', null, 'anon no puede leer los tokens');
select throws_ok($$insert into public.invitacion_resena (id_pago) values ('60000000-0000-0000-0000-000000003599')$$,
  '42501', null, 'anon no puede insertar una invitación');
select throws_ok($$update public.invitacion_resena set procesado_en = now()$$, '42501', null,
  'anon no puede actualizar invitaciones');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000035a0","role":"authenticated"}';
select throws_ok($$select * from public.invitacion_resena$$, '42501', null,
  'Una sesión (aunque sea la de un monitor) no puede leer invitacion_resena: permiso denegado');
select throws_ok($$insert into public.invitacion_resena (id_pago) values ('60000000-0000-0000-0000-000000003599')$$,
  '42501', null, 'Una sesión no puede insertar una invitación');
select throws_ok($$update public.invitacion_resena set procesado_en = now()$$, '42501', null,
  'Una sesión no puede marcar invitaciones como procesadas');
select throws_ok($$delete from public.invitacion_resena$$, '42501', null,
  'Una sesión no puede borrar invitaciones');
reset role;

-- ---------------------------------------------------------------------------
-- Las funciones y el trigger: definición y permisos
-- ---------------------------------------------------------------------------
select has_function('privado', 'anotar_invitacion_resena', '{}'::name[],
  'Existe privado.anotar_invitacion_resena, la del trigger');
select has_function('privado', 'disparar_invitaciones_resena', '{}'::name[],
  'Existe privado.disparar_invitaciones_resena, la que le pide a la app procesar las invitaciones');
select has_function('public', 'datos_de_invitacion_resena', array['uuid'],
  'Existe public.datos_de_invitacion_resena(uuid), lo que la app necesita para escribir el correo');
select has_function('public', 'resena_por_token', array['text'],
  'Existe public.resena_por_token(text), lo que la app necesita para pintar la página del enlace');
select has_function('public', 'registrar_resena', array['text', 'integer', 'text'],
  'Existe public.registrar_resena(text, integer, text), la que guarda la reseña');
select ok(
  (select prosecdef from pg_proc where oid = 'privado.anotar_invitacion_resena()'::regprocedure)
  and (select prosecdef from pg_proc where oid = 'privado.disparar_invitaciones_resena()'::regprocedure)
  and not (select prosecdef from pg_proc where oid = 'public.datos_de_invitacion_resena(uuid)'::regprocedure)
  and not (select prosecdef from pg_proc where oid = 'public.resena_por_token(text)'::regprocedure)
  and not (select prosecdef from pg_proc where oid = 'public.registrar_resena(text, integer, text)'::regprocedure),
  'Las de privado son security definer (escriben invitacion_resena y leen Vault); las tres públicas corren con los permisos de quien llama');
select ok(
  (select bool_and('search_path=""' = any(proconfig)) from pg_proc
   where oid in ('privado.anotar_invitacion_resena()'::regprocedure,
                 'privado.disparar_invitaciones_resena()'::regprocedure,
                 'public.datos_de_invitacion_resena(uuid)'::regprocedure,
                 'public.resena_por_token(text)'::regprocedure,
                 'public.registrar_resena(text, integer, text)'::regprocedure)),
  'Las cinco fijan un search_path vacío');
select is(
  array[pg_get_function_result('privado.anotar_invitacion_resena()'::regprocedure),
        pg_get_function_result('privado.disparar_invitaciones_resena()'::regprocedure),
        pg_get_function_result('public.registrar_resena(text, integer, text)'::regprocedure)],
  array['trigger', 'bigint', 'text'],
  'La del trigger devuelve trigger, la que pide el procesamiento el id de la petición de pg_net (bigint) y registrar_resena un texto');
select is(
  (select array_agg(a.n order by a.o)
   from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as a(n, m, o)
   where p.oid = 'public.datos_de_invitacion_resena(uuid)'::regprocedure and a.m = 't'),
  array['token', 'disponible', 'correo_lead', 'nombre_lead', 'nombre_monitor'],
  'datos_de_invitacion_resena devuelve el token, si sigue disponible, el correo y el nombre del Lead y el nombre del monitor');
select is(
  (select array_agg(a.n order by a.o)
   from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as a(n, m, o)
   where p.oid = 'public.resena_por_token(text)'::regprocedure and a.m = 't'),
  array['estado', 'nombre_monitor', 'nombre_materia', 'inicio'],
  'resena_por_token devuelve el estado del enlace, el nombre del monitor, el de la materia y el inicio');

select has_trigger('public', 'monitoria', 'monitoria_anota_invitacion_resena',
  'monitoria tiene el trigger monitoria_anota_invitacion_resena');
select trigger_is('public', 'monitoria', 'monitoria_anota_invitacion_resena', 'privado', 'anotar_invitacion_resena',
  'El trigger llama a privado.anotar_invitacion_resena');
select matches(
  (select pg_get_triggerdef(t.oid) from pg_trigger t
   where t.tgrelid = 'public.monitoria'::regclass and t.tgname = 'monitoria_anota_invitacion_resena'),
  'AFTER UPDATE OF estado ON public\.monitoria FOR EACH ROW',
  'Corre después de cambiar el estado, por fila (la invitación sale de la misma transacción del cambio)');

-- Nadie ejecuta las de privado: ni anon, ni una sesión, ni la llave secreta.
select ok(
  not has_function_privilege('anon', 'privado.anotar_invitacion_resena()', 'execute')
  and not has_function_privilege('authenticated', 'privado.anotar_invitacion_resena()', 'execute')
  and not has_function_privilege('service_role', 'privado.anotar_invitacion_resena()', 'execute'),
  'Ni anon, ni authenticated, ni service_role ejecutan privado.anotar_invitacion_resena: solo la dispara el trigger');
select ok(
  not has_function_privilege('anon', 'privado.disparar_invitaciones_resena()', 'execute')
  and not has_function_privilege('authenticated', 'privado.disparar_invitaciones_resena()', 'execute')
  and not has_function_privilege('service_role', 'privado.disparar_invitaciones_resena()', 'execute'),
  'Ni anon, ni authenticated, ni service_role ejecutan privado.disparar_invitaciones_resena: solo el trigger y pg_cron');
-- Las tres públicas: solo service_role.
select ok(
  has_function_privilege('service_role', 'public.datos_de_invitacion_resena(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.datos_de_invitacion_resena(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.datos_de_invitacion_resena(uuid)', 'execute'),
  'datos_de_invitacion_resena solo la ejecuta service_role: ni anon ni una sesión (trae el correo del Lead)');
select ok(
  has_function_privilege('service_role', 'public.resena_por_token(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.resena_por_token(text)', 'execute')
  and not has_function_privilege('anon', 'public.resena_por_token(text)', 'execute'),
  'resena_por_token solo la ejecuta service_role: el token se valida en el servidor, no desde el navegador');
select ok(
  has_function_privilege('service_role', 'public.registrar_resena(text, integer, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.registrar_resena(text, integer, text)', 'execute')
  and not has_function_privilege('anon', 'public.registrar_resena(text, integer, text)', 'execute'),
  'registrar_resena solo la ejecuta service_role');
select ok(
  not exists (
    select 1
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid in ('privado.anotar_invitacion_resena()'::regprocedure,
                    'privado.disparar_invitaciones_resena()'::regprocedure,
                    'public.datos_de_invitacion_resena(uuid)'::regprocedure,
                    'public.resena_por_token(text)'::regprocedure,
                    'public.registrar_resena(text, integer, text)'::regprocedure)
      and a.grantee = 0),
  'Nadie las hereda de PUBLIC');

set local role anon;
select throws_ok($$select privado.disparar_invitaciones_resena()$$, '42501', null,
  'anon no puede pedir el procesamiento de invitaciones: permiso denegado');
select throws_ok($$select * from public.datos_de_invitacion_resena('60000000-0000-0000-0000-000000003501')$$, '42501', null,
  'anon no puede pedir los datos de una invitación: permiso denegado');
select throws_ok($$select * from public.resena_por_token('abc')$$, '42501', null,
  'anon no puede consultar un token: permiso denegado');
select throws_ok($$select public.registrar_resena('abc', 5, null)$$, '42501', null,
  'anon no puede registrar una reseña: permiso denegado');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000035a0","role":"authenticated"}';
select throws_ok($$select privado.disparar_invitaciones_resena()$$, '42501', null,
  'Una sesión tampoco puede pedir el procesamiento: permiso denegado');
select throws_ok($$select * from public.datos_de_invitacion_resena('60000000-0000-0000-0000-000000003501')$$, '42501', null,
  'Una sesión (aunque sea la del monitor) no puede pedir los datos de una invitación: permiso denegado');
select throws_ok($$select * from public.resena_por_token('abc')$$, '42501', null,
  'Una sesión no puede consultar un token: permiso denegado');
select throws_ok($$select public.registrar_resena('abc', 5, null)$$, '42501', null,
  'Una sesión no puede registrar una reseña: permiso denegado');
reset role;
set local role service_role;
select throws_ok($$select privado.disparar_invitaciones_resena()$$, '42501', null,
  'service_role tampoco puede pedir el procesamiento: lo pide el trigger o pg_cron, no la app');
reset role;

-- El trabajo de pg_cron: repite el pedido cada 5 minutos por si una petición se perdió.
select is(
  (select count(*)::int from cron.job where jobname = 'calibra-invitar-resenas'), 1,
  'Existe un solo trabajo calibra-invitar-resenas en pg_cron (reaplicar la migración no lo duplica)');
select results_eq(
  $$select schedule, command, active from cron.job where jobname = 'calibra-invitar-resenas'$$,
  $$values ('*/5 * * * *'::text, 'select privado.disparar_invitaciones_resena()'::text, true)$$,
  'Corre cada 5 minutos, activo, y llama a privado.disparar_invitaciones_resena()');

-- ---------------------------------------------------------------------------
-- Fixtures (como postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, is_anonymous) values
  ('a0000000-0000-0000-0000-000000003501', false),
  ('b0000000-0000-0000-0000-0000000035a0', false),
  ('b0000000-0000-0000-0000-0000000035b0', false),
  ('c0000000-0000-0000-0000-000000003501', true),
  ('c0000000-0000-0000-0000-000000003502', true);

insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-000000003501', 'Admin', 'admin35@calibra.test', 9003501);
insert into public.monitor (id, nombre) values
  ('b0000000-0000-0000-0000-0000000035a0', 'Ana 35'),
  ('b0000000-0000-0000-0000-0000000035b0', 'Beto 35');
insert into public.monitor_privado (id_monitor, numero_telefono, correo, llave) values
  ('b0000000-0000-0000-0000-0000000035a0', '3005100035', 'ana.monitora35@calibra.test', 'llave-ana-35'),
  ('b0000000-0000-0000-0000-0000000035b0', '3005100036', 'beto.monitor35@calibra.test', 'llave-beto-35');
insert into public.materia (id, nombre, codigo) values
  ('10000000-0000-0000-0000-0000000035a1', 'Materia 35 A', 'PGTAP-35-A'),
  ('10000000-0000-0000-0000-0000000035b1', 'Materia 35 B', 'PGTAP-35-B');
insert into public.certificado (id_monitor, id_materia, id_admin) values
  ('b0000000-0000-0000-0000-0000000035a0', '10000000-0000-0000-0000-0000000035a1', 'a0000000-0000-0000-0000-000000003501'),
  ('b0000000-0000-0000-0000-0000000035b0', '10000000-0000-0000-0000-0000000035b1', 'a0000000-0000-0000-0000-000000003501');
insert into public.lead (id, id_sesion_anonima, nombre, numero_telefono, correo, acepta_tratamiento_datos, fecha_consentimiento) values
  ('40000000-0000-0000-0000-000000003501', 'c0000000-0000-0000-0000-000000003501', 'Lucía Prueba 35', '3005351111',
   'lucia.lead35@calibra.test', true, now()),
  ('40000000-0000-0000-0000-000000003502', 'c0000000-0000-0000-0000-000000003502', 'Mateo Prueba 35', '3005352222',
   'mateo.lead35@calibra.test', true, now());

-- Una franja por monitoría, todas los miércoles a las 9:00 en Bogotá, de 60 min y virtuales.
insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min, lugar, enlace, abierta_desde)
select ('30000000-0000-0000-0000-0000000035' || nn)::uuid,
       case when nn = '03' then 'b0000000-0000-0000-0000-0000000035b0'::uuid else 'b0000000-0000-0000-0000-0000000035a0'::uuid end,
       smallint '3', time '09:00', false, 20000, 60, null, 'https://meet.example/35-' || nn, date '2020-01-01'
from unnest(array['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14']) as nn;

-- Monitorías: la 02 el miércoles 4-mar-2020 y las demás el 11-mar-2020. Las insertadas como confirmada o por pagar no
-- anotan nada: el trigger es de UPDATE.
insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado)
select ('50000000-0000-0000-0000-0000000035' || v.nn)::uuid, ('30000000-0000-0000-0000-0000000035' || v.nn)::uuid,
       case when v.nn = '03' then '10000000-0000-0000-0000-0000000035b1'::uuid else '10000000-0000-0000-0000-0000000035a1'::uuid end,
       case when v.nn = '03' then '40000000-0000-0000-0000-000000003502'::uuid else '40000000-0000-0000-0000-000000003501'::uuid end,
       case when v.nn = '02' then date '2020-03-04' else date '2020-03-11' end,
       20000, v.estado
from (values
  ('01', 'confirmada'::public.estado_monitoria), ('02', 'confirmada'), ('03', 'confirmada'), ('04', 'confirmada'),
  ('05', 'confirmada'), ('06', 'confirmada'), ('07', 'confirmada'), ('08', 'pendiente_pago'),
  ('09', 'confirmada'), ('10', 'confirmada'), ('11', 'confirmada'), ('12', 'confirmada'),
  ('13', 'confirmada'), ('14', 'confirmada')) as v(nn, estado);

-- La 06 es grupal.
insert into public.monitoria_grupal (id_monitoria, cupos, modalidad_pago, precio_por_persona) values
  ('50000000-0000-0000-0000-000000003506', 3, 'dividido', 15000);

-- Los pagos: uno por monitoría (menos la 12), el 93 es el segundo de la 03. Un pago en revisión no tiene fecha de revisión
-- y uno aprobado o rechazado, sí.
create temporary table pago_35 (nn text primary key, id_monitoria text not null, estado public.estado_pago not null);
insert into pago_35 (nn, id_monitoria, estado) values
  ('01', '01', 'aprobado'), ('02', '02', 'en_revision'), ('03', '03', 'aprobado'), ('93', '03', 'rechazado'),
  ('04', '04', 'rechazado'), ('05', '05', 'aprobado'), ('06', '06', 'aprobado'), ('07', '07', 'aprobado'),
  ('08', '08', 'en_revision'), ('09', '09', 'aprobado'), ('10', '10', 'aprobado'), ('11', '11', 'aprobado'),
  ('13', '13', 'aprobado'), ('14', '14', 'aprobado');
insert into public.comprobante_revisado (ruta, tipo)
select 'c0000000-0000-0000-0000-000000003501/60000000-0000-0000-0000-0000000035' || nn || '.pdf', 'application/pdf'
from pago_35;
insert into public.pago (id, id_monitoria, monto, nombre_pagador, contacto, estado, id_admin, fecha_revision, comprobante)
select ('60000000-0000-0000-0000-0000000035' || nn)::uuid, ('50000000-0000-0000-0000-0000000035' || id_monitoria)::uuid,
       20000, 'Pagador Secreto 35', 'pagador.secreto35@example.com', estado, 'a0000000-0000-0000-0000-000000003501',
       case when estado = 'en_revision' then null else now() end,
       'c0000000-0000-0000-0000-000000003501/60000000-0000-0000-0000-0000000035' || nn || '.pdf'
from pago_35;

-- La 05 ya tiene su reseña (por ejemplo, la dejó por otro medio antes de cerrarse).
insert into public.resena (id_pago, calificacion, comentario) values
  ('60000000-0000-0000-0000-000000003505', 4, 'Ya reseñada');

-- Control: las 14 monitorías existen (la 03 con otro monitor, la 06 grupal), hay 14 pagos y, como solo se insertaron,
-- ninguna anotó una invitación (el trigger es de UPDATE OF estado).
select ok(
  (select count(*) = 14 from public.monitoria where id::text like '50000000-0000-0000-0000-0000000035%')
  and (select count(*) = 14 from public.pago where id::text like '60000000-0000-0000-0000-0000000035%')
  and (select count(*) = 1 from public.monitoria_grupal where id_monitoria::text like '50000000-0000-0000-0000-0000000035%')
  and (select id_monitor = 'b0000000-0000-0000-0000-0000000035b0' from public.monitoria
       where id = '50000000-0000-0000-0000-000000003503'),
  'Control: las 14 monitorías y sus 14 pagos existen (la 03 es del monitor B) y hay una grupal');
select is(
  (select count(*)::int from public.invitacion_resena where id_pago::text like '60000000-0000-0000-0000-0000000035%'),
  0, 'Insertar monitorías y pagos no anota ninguna invitación: el trigger es solo de UPDATE OF estado');

-- ---------------------------------------------------------------------------
-- El monitor finaliza: la individual pasa a realizada y se anota la invitación
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000035a0","role":"authenticated"}';
select is((select public.finalizar_monitoria('50000000-0000-0000-0000-000000003501')), 'finalizada',
  'El monitor A finaliza la monitoría 01');
select is((select public.finalizar_monitoria('50000000-0000-0000-0000-000000003504')), 'finalizada', 'Y la 04');
select is((select public.finalizar_monitoria('50000000-0000-0000-0000-000000003505')), 'finalizada', 'Y la 05');
select is((select public.finalizar_monitoria('50000000-0000-0000-0000-000000003509')), 'finalizada', 'Y la 09');
select is((select public.finalizar_monitoria('50000000-0000-0000-0000-000000003510')), 'finalizada', 'Y la 10');
select is((select public.finalizar_monitoria('50000000-0000-0000-0000-000000003511')), 'finalizada', 'Y la 11');
select is((select public.finalizar_monitoria('50000000-0000-0000-0000-000000003512')), 'finalizada', 'Y la 12, que no tiene pagos');
select is((select public.finalizar_monitoria('50000000-0000-0000-0000-000000003513')), 'finalizada', 'Y la 13');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000035b0","role":"authenticated"}';
select is((select public.finalizar_monitoria('50000000-0000-0000-0000-000000003503')), 'finalizada',
  'El monitor B finaliza la monitoría 03');
reset role;

select results_eq(
  $$select procesado_en is null, intentos, creada_en = now(), token ~ '^[0-9a-f]{64}$'
    from public.invitacion_resena where id_pago = '60000000-0000-0000-0000-000000003501'$$,
  $$values (true, 0, true, true)$$,
  'Al finalizar la 01 se anota exactamente una invitación, sin procesar, con 0 intentos, creada en esa transacción y con un token de 64 caracteres hexadecimales');
select is(
  (select count(*)::int from public.invitacion_resena where id_pago = '60000000-0000-0000-0000-000000003503'), 1,
  'Al finalizar la 03 (pago aprobado y otro rechazado) se anota la invitación del aprobado');
select is(
  (select count(*)::int from public.invitacion_resena where id_pago = '60000000-0000-0000-0000-000000003593'), 0,
  'Pero no la del pago rechazado de la misma monitoría (RN-70)');
select is(
  (select count(*)::int from public.invitacion_resena where id_pago = '60000000-0000-0000-0000-000000003504'), 0,
  'Una individual realizada cuyo único pago fue rechazado no anota nada');
select is(
  (select count(*)::int from public.invitacion_resena where id_pago = '60000000-0000-0000-0000-000000003505'), 0,
  'Un pago que ya tiene reseña no anota invitación');
select is(
  (select count(*)::int from public.invitacion_resena i join public.pago p on p.id = i.id_pago
   where p.id_monitoria = '50000000-0000-0000-0000-000000003512'), 0,
  'Una individual realizada sin pagos no anota nada');

-- ---------------------------------------------------------------------------
-- El cierre automático: la individual que nadie finalizó pasa a realizada y también anota la invitación
-- ---------------------------------------------------------------------------
select is(privado.cerrar_monitorias_sin_finalizar(timestamptz '2020-03-10 12:00-05'), 1,
  'El cierre automático con ahora = 10-mar-2020 12:00 cierra solo la 02 (la del 4-mar)');
select results_eq(
  $$select m.estado::text, i.procesado_en is null, i.token ~ '^[0-9a-f]{64}$'
    from public.monitoria m join public.pago p on p.id_monitoria = m.id join public.invitacion_resena i on i.id_pago = p.id
    where m.id = '50000000-0000-0000-0000-000000003502'$$,
  $$values ('realizada'::text, true, true)$$,
  'Cerrada sola, la 02 queda realizada y con su invitación (un pago en revisión también recibe enlace)');

-- ---------------------------------------------------------------------------
-- Lo que no anota: grupales, otras transiciones y otros estados
-- ---------------------------------------------------------------------------
update public.monitoria set estado = 'realizada', fecha_finalizacion = timestamptz '2020-03-11 10:30-05'
where id = '50000000-0000-0000-0000-000000003506';
select is(
  (select count(*)::int from public.invitacion_resena where id_pago = '60000000-0000-0000-0000-000000003506'), 0,
  'Una grupal que pasa a realizada no anota nada: su reseña es otra regla (RN-71)');

update public.monitoria set estado = 'cancelada', motivo_cancelacion = 'estudiante'
where id = '50000000-0000-0000-0000-000000003507';
select is(
  (select count(*)::int from public.invitacion_resena where id_pago = '60000000-0000-0000-0000-000000003507'), 0,
  'confirmada -> cancelada no anota nada');

update public.monitoria set estado = 'confirmada' where id = '50000000-0000-0000-0000-000000003508';
select is(
  (select count(*)::int from public.invitacion_resena where id_pago = '60000000-0000-0000-0000-000000003508'), 0,
  'pendiente_pago -> confirmada no anota nada');

update public.monitoria set valor_total = 25000 where id = '50000000-0000-0000-0000-000000003514';
select is(
  (select count(*)::int from public.invitacion_resena where id_pago = '60000000-0000-0000-0000-000000003514'), 0,
  'Un UPDATE que no cambia el estado no anota nada');

-- No se duplica: la 09 se finalizó, vuelve a confirmada y pasa otra vez a realizada.
create temporary table token_09 as
  select token, creada_en from public.invitacion_resena where id_pago = '60000000-0000-0000-0000-000000003509';
update public.invitacion_resena set procesado_en = timestamptz '2020-03-11 11:00-05'
where id_pago = '60000000-0000-0000-0000-000000003509';
update public.monitoria set estado = 'confirmada' where id = '50000000-0000-0000-0000-000000003509';
select is(
  (select count(*)::int from public.invitacion_resena where id_pago = '60000000-0000-0000-0000-000000003509'), 1,
  'Volver de realizada a confirmada no anota ni borra nada: sigue la única invitación');
update public.monitoria set estado = 'realizada' where id = '50000000-0000-0000-0000-000000003509';
select results_eq(
  $$select i.token = t.token, i.procesado_en, i.creada_en = t.creada_en
    from public.invitacion_resena i, token_09 t where i.id_pago = '60000000-0000-0000-0000-000000003509'$$,
  $$values (true, timestamptz '2020-03-11 11:00-05', true)$$,
  'Pasar otra vez a realizada no duplica la invitación (on conflict do nothing): conserva su token y su procesado_en');

-- Resumen: de todo lo anterior solo quedaron siete invitaciones.
select set_eq(
  $$select right(id_pago::text, 2) from public.invitacion_resena where id_pago::text like '60000000-0000-0000-0000-0000000035%'$$,
  $$values ('01'::text), ('02'), ('03'), ('09'), ('10'), ('11'), ('13')$$,
  'En total solo hay siete invitaciones: las de los pagos 01, 02, 03, 09, 10, 11 y 13');

-- Las restricciones de la tabla.
select throws_ok(
  $$insert into public.invitacion_resena (id_pago) values ('60000000-0000-0000-0000-000000003501')$$,
  '23505', null, 'Un pago no tiene dos invitaciones (unique id_pago)');
select throws_ok(
  $$insert into public.invitacion_resena (id_pago, token) values ('60000000-0000-0000-0000-000000003507', 'no-es-hexadecimal')$$,
  '23514', null, 'El token tiene que ser de 64 caracteres hexadecimales');
select throws_ok(
  $$insert into public.invitacion_resena (id_pago, token)
    select '60000000-0000-0000-0000-000000003507', token from public.invitacion_resena
    where id_pago = '60000000-0000-0000-0000-000000003501'$$,
  '23505', null, 'Dos invitaciones no comparten token (unique token)');
select throws_ok(
  $$insert into public.invitacion_resena (id_pago) values ('60000000-0000-0000-0000-000000003599')$$,
  '23503', null, 'La invitación apunta a un pago que existe');
select throws_ok(
  $$update public.invitacion_resena set intentos = -1 where id_pago = '60000000-0000-0000-0000-000000003501'$$,
  '23514', null, 'intentos no puede ser negativo');

-- La 06 es grupal: aun si alguien le crea una invitación a mano, el enlace no sirve (más abajo).
insert into public.invitacion_resena (id_pago) values ('60000000-0000-0000-0000-000000003506');

-- La 10 vuelve a confirmada y a la 11 se le rechaza el pago: sus enlaces dejan de servir.
update public.monitoria set estado = 'confirmada' where id = '50000000-0000-0000-0000-000000003510';
update public.pago set estado = 'rechazado', fecha_revision = now() where id = '60000000-0000-0000-0000-000000003511';

-- Los tokens, para que service_role los use en sus consultas (una fila por pago con invitación).
create temporary table tok (nn text primary key, token text not null);
insert into tok (nn, token)
select right(id_pago::text, 2), token from public.invitacion_resena where id_pago::text like '60000000-0000-0000-0000-0000000035%';
grant select on tok to service_role;

-- ---------------------------------------------------------------------------
-- service_role: lee las invitaciones y las marca como procesadas, nada más
-- ---------------------------------------------------------------------------
set local role service_role;
select is(
  (select count(*)::int from public.invitacion_resena where id_pago::text like '60000000-0000-0000-0000-0000000035%'),
  8, 'service_role lee las invitaciones (RLS sin políticas no le estorba)');
select lives_ok(
  $$update public.invitacion_resena set procesado_en = timestamptz '2020-03-11 12:00-05', intentos = 1
    where id_pago = '60000000-0000-0000-0000-000000003501'$$,
  'service_role marca una invitación como procesada y cuenta un intento');
select throws_ok(
  $$update public.invitacion_resena set token = repeat('a', 64) where id_pago = '60000000-0000-0000-0000-000000003501'$$,
  '42501', null, 'service_role no puede cambiar el token: solo procesado_en e intentos');
select throws_ok(
  $$update public.invitacion_resena set id_pago = '60000000-0000-0000-0000-000000003507'
    where id_pago = '60000000-0000-0000-0000-000000003501'$$,
  '42501', null, 'Ni reasignar la invitación a otro pago');
select throws_ok(
  $$insert into public.invitacion_resena (id_pago) values ('60000000-0000-0000-0000-000000003507')$$,
  '42501', null, 'service_role no puede insertar invitaciones');
select throws_ok(
  $$delete from public.invitacion_resena where id_pago = '60000000-0000-0000-0000-000000003501'$$,
  '42501', null, 'service_role no puede borrar invitaciones');
reset role;
select results_eq(
  $$select procesado_en, intentos from public.invitacion_resena where id_pago = '60000000-0000-0000-0000-000000003501'$$,
  $$values (timestamptz '2020-03-11 12:00-05', 1)$$,
  'Solo cambiaron procesado_en e intentos de la invitación que se marcó');

-- ---------------------------------------------------------------------------
-- privado.disparar_invitaciones_resena: sin Vault no pide nada y no falla
-- ---------------------------------------------------------------------------
-- La prueba no depende de lo que haya en Vault: se quitan (dentro de la transacción) los dos secretos de la app.
delete from vault.secrets where name in ('calibra_sitio_url', 'calibra_cron_secreto');
select ok(
  not exists (select 1 from vault.decrypted_secrets where name in ('calibra_sitio_url', 'calibra_cron_secreto')),
  'Control: Vault no trae calibra_sitio_url ni calibra_cron_secreto');
select ok(
  exists (select 1 from public.invitacion_resena where procesado_en is null
          and id_pago::text like '60000000-0000-0000-0000-0000000035%'),
  'Control: hay invitaciones pendientes (las de esta prueba)');
select is(privado.disparar_invitaciones_resena(), null::bigint,
  'Con invitaciones pendientes pero sin configuración en Vault devuelve null y no falla (así en local)');

select vault.create_secret('https://calibra.test/', 'calibra_sitio_url');
select is(privado.disparar_invitaciones_resena(), null::bigint,
  'Con la dirección de la app pero sin el secreto tampoco pide nada');
select vault.create_secret('secreto-de-prueba-con-al-menos-treinta-y-dos-caracteres', 'calibra_cron_secreto');
select isnt(privado.disparar_invitaciones_resena(), null::bigint,
  'Con los dos secretos en Vault e invitaciones pendientes sí pide el procesamiento: devuelve el id de la petición de pg_net');

delete from vault.secrets where name in ('calibra_sitio_url', 'calibra_cron_secreto');
update public.invitacion_resena set procesado_en = now()
where procesado_en is null and id_pago::text like '60000000-0000-0000-0000-0000000035%';
select is(privado.disparar_invitaciones_resena(), null::bigint,
  'Sin invitaciones pendientes de esta prueba y sin configuración en Vault también devuelve null');

-- ---------------------------------------------------------------------------
-- public.datos_de_invitacion_resena: lo que la app necesita para escribir el correo
-- ---------------------------------------------------------------------------
set local role service_role;
select results_eq(
  $$select d.token = (select token from tok where nn = '03'), d.disponible, d.correo_lead, d.nombre_lead, d.nombre_monitor
    from public.datos_de_invitacion_resena('60000000-0000-0000-0000-000000003503') d$$,
  $$values (true, true, 'mateo.lead35@calibra.test'::text, 'Mateo Prueba 35'::text, 'Beto 35'::text)$$,
  'La 03: su token, disponible, el correo y el nombre del Lead (Mateo) y el nombre del monitor (Beto)');
select results_eq(
  $$select d.token = (select token from tok where nn = '01'), d.disponible, d.correo_lead, d.nombre_lead, d.nombre_monitor
    from public.datos_de_invitacion_resena('60000000-0000-0000-0000-000000003501') d$$,
  $$values (true, true, 'lucia.lead35@calibra.test'::text, 'Lucía Prueba 35'::text, 'Ana 35'::text)$$,
  'La 01: otro Lead y otro monitor, nada se mezcla con la 03');
select is(
  (select disponible from public.datos_de_invitacion_resena('60000000-0000-0000-0000-000000003510')), false,
  'La 10, devuelta a confirmada: la invitación existe pero ya no está disponible');
select is(
  (select disponible from public.datos_de_invitacion_resena('60000000-0000-0000-0000-000000003511')), false,
  'La 11, con el pago ahora rechazado: no disponible');
select is(
  (select disponible from public.datos_de_invitacion_resena('60000000-0000-0000-0000-000000003506')), false,
  'La 06, grupal: no disponible');
select is((select count(*)::int from public.datos_de_invitacion_resena('60000000-0000-0000-0000-000000003593')), 0,
  'Un pago sin invitación (el rechazado de la 03): cero filas');
select is((select count(*)::int from public.datos_de_invitacion_resena(gen_random_uuid())), 0,
  'Un id que no existe: cero filas');
select is((select count(*)::int from public.datos_de_invitacion_resena(null)), 0,
  'Un id nulo: cero filas');
select ok(
  not exists (
    select 1 from public.datos_de_invitacion_resena('60000000-0000-0000-0000-000000003501') d
    where d::text ilike '%3005351111%' or d::text ilike '%pagador.secreto35%' or d::text ilike '%3005100035%'
       or d::text ilike '%ana.monitora35%' or d::text ilike '%llave-ana-35%'),
  'La fila no trae el teléfono del Lead, los datos del pagador ni ningún dato de contacto o llave del monitor');
reset role;

-- ---------------------------------------------------------------------------
-- public.resena_por_token: el estado del enlace
-- ---------------------------------------------------------------------------
set local role service_role;
select results_eq(
  $$select estado, nombre_monitor, nombre_materia, inicio
    from public.resena_por_token((select token from tok where nn = '01'))$$,
  $$values ('disponible'::text, 'Ana 35'::text, 'Materia 35 A'::text, timestamptz '2020-03-11 09:00-05')$$,
  'La 01: disponible, con el nombre del monitor, el de la materia y el inicio (9:00 en Bogotá)');
select is(
  (select inicio from public.resena_por_token((select token from tok where nn = '01'))),
  public.inicio_sesion(date '2020-03-11', time '09:00'),
  'El inicio es el mismo que calcula public.inicio_sesion(fecha, hora)');
select results_eq(
  $$select estado, nombre_monitor, nombre_materia from public.resena_por_token((select token from tok where nn = '03'))$$,
  $$values ('disponible'::text, 'Beto 35'::text, 'Materia 35 B'::text)$$,
  'La 03: disponible, con su monitor y su materia');
select is((select estado from public.resena_por_token((select token from tok where nn = '02'))), 'disponible',
  'La 02, cerrada sola, con el pago en revisión: disponible (RN-70 solo excluye los rechazados)');
select is((select estado from public.resena_por_token((select token from tok where nn = '10'))), 'no_disponible',
  'La 10, devuelta a confirmada: no_disponible (la monitoría no está realizada)');
select is((select estado from public.resena_por_token((select token from tok where nn = '11'))), 'no_disponible',
  'La 11, con el pago rechazado: no_disponible');
select is((select estado from public.resena_por_token((select token from tok where nn = '06'))), 'no_disponible',
  'La 06, grupal: no_disponible');
select is((select count(*)::int from public.resena_por_token(repeat('a', 64))), 0,
  'Un token con forma válida pero que no existe: cero filas');
select is((select count(*)::int from public.resena_por_token('abc')), 0, 'Un token mal formado: cero filas');
select is((select count(*)::int from public.resena_por_token(null)), 0, 'Un token nulo: cero filas');
select is((select count(*)::int from public.resena_por_token('')), 0, 'Un token vacío: cero filas');
select ok(
  not exists (
    select 1 from public.resena_por_token((select token from tok where nn = '01')) r
    where r::text ilike '%3005351111%' or r::text ilike '%lucia.lead35%' or r::text ilike '%pagador.secreto35%'
       or r::text ilike '%ana.monitora35%'),
  'La fila no trae correo ni teléfono de nadie');
reset role;

-- La 05 ya tenía reseña: aunque se le cree una invitación, el enlace dice ya_resenada.
insert into public.invitacion_resena (id_pago) values ('60000000-0000-0000-0000-000000003505');
insert into tok (nn, token) select '05', token from public.invitacion_resena where id_pago = '60000000-0000-0000-0000-000000003505';
set local role service_role;
select is((select estado from public.resena_por_token((select token from tok where nn = '05'))), 'ya_resenada',
  'La 05, que ya tiene reseña: ya_resenada');
select is((select disponible from public.datos_de_invitacion_resena('60000000-0000-0000-0000-000000003505')), false,
  'Y su invitación ya no está disponible para el correo');
reset role;

-- ---------------------------------------------------------------------------
-- public.registrar_resena
-- ---------------------------------------------------------------------------
set local role service_role;
select is((select public.registrar_resena((select token from tok where nn = '01'), 5, '  Muy buena monitoría  ')), 'registrada',
  'Con el token de la 01 la reseña se registra');
reset role;
select results_eq(
  $$select calificacion, comentario, fecha = now(), id_pago from public.resena
    where id_pago = '60000000-0000-0000-0000-000000003501'$$,
  $$values (5, 'Muy buena monitoría'::text, true, '60000000-0000-0000-0000-000000003501'::uuid)$$,
  'Queda una reseña con la calificación, el comentario recortado, la fecha de ahora y ligada al pago');
set local role service_role;
select is((select estado from public.resena_por_token((select token from tok where nn = '01'))), 'ya_resenada',
  'Después de reseñar, el enlace de la 01 dice ya_resenada');
select is((select public.registrar_resena((select token from tok where nn = '01'), 1, 'Otro intento')), 'ya_resenada',
  'Un segundo intento con el mismo enlace: ya_resenada');
reset role;
select results_eq(
  $$select count(*)::int, min(calificacion), min(comentario) from public.resena
    where id_pago = '60000000-0000-0000-0000-000000003501'$$,
  $$values (1, 5, 'Muy buena monitoría'::text)$$,
  'El segundo intento no cambió ni duplicó la reseña');

-- Un comentario vacío o de solo espacios queda nulo (D-17: opcional).
set local role service_role;
select is((select public.registrar_resena((select token from tok where nn = '02'), 3, '   ')), 'registrada',
  'Con el token de la 02 y un comentario de solo espacios la reseña se registra');
reset role;
select results_eq(
  $$select calificacion, comentario from public.resena where id_pago = '60000000-0000-0000-0000-000000003502'$$,
  $$values (3, null::text)$$,
  'Y el comentario queda nulo, no una cadena vacía');
-- Aunque después la monitoría vuelva atrás, ya_resenada gana sobre no_disponible.
update public.monitoria set estado = 'confirmada' where id = '50000000-0000-0000-0000-000000003502';
set local role service_role;
select is((select estado from public.resena_por_token((select token from tok where nn = '02'))), 'ya_resenada',
  'ya_resenada gana sobre no_disponible aunque la monitoría ya no esté realizada');
select is((select public.registrar_resena((select token from tok where nn = '02'), 4, null)), 'ya_resenada',
  'Y registrar también responde ya_resenada');
reset role;

-- Un comentario nulo, y uno de exactamente 1000 caracteres.
update public.monitoria set estado = 'realizada' where id = '50000000-0000-0000-0000-000000003510';
set local role service_role;
select is((select public.registrar_resena((select token from tok where nn = '10'), 1, null)), 'registrada',
  'La 10, otra vez realizada, se reseña con calificación 1 y sin comentario');
reset role;
select results_eq(
  $$select calificacion, comentario from public.resena where id_pago = '60000000-0000-0000-0000-000000003510'$$,
  $$values (1, null::text)$$,
  'Calificación 1 y comentario nulo');

-- No disponible: monitoría no realizada, pago rechazado, grupal.
update public.monitoria set estado = 'confirmada' where id = '50000000-0000-0000-0000-000000003509';
set local role service_role;
select is((select public.registrar_resena((select token from tok where nn = '09'), 5, null)), 'no_disponible',
  'Si la monitoría no está realizada (la 09 volvió a confirmada): no_disponible');
select is((select public.registrar_resena((select token from tok where nn = '11'), 5, null)), 'no_disponible',
  'Si el pago fue rechazado (la 11): no_disponible');
select is((select public.registrar_resena((select token from tok where nn = '06'), 5, null)), 'no_disponible',
  'Si la monitoría es grupal (la 06): no_disponible');
reset role;
select is(
  (select count(*)::int from public.resena where id_pago in ('60000000-0000-0000-0000-000000003509',
    '60000000-0000-0000-0000-000000003511', '60000000-0000-0000-0000-000000003506')),
  0, 'Ninguno de los tres casos no disponibles dejó una reseña');

-- Token inexistente.
set local role service_role;
select is((select public.registrar_resena(repeat('b', 64), 5, null)), 'no_existe', 'Un token que no existe: no_existe');
select is((select public.registrar_resena('abc', 5, null)), 'no_existe', 'Un token mal formado: no_existe');
select is((select public.registrar_resena(null, 5, null)), 'no_existe', 'Un token nulo: no_existe');
reset role;

-- Calificación o comentario que la base rechaza (la app los valida antes; esta es la última defensa).
set local role service_role;
select throws_ok($$select public.registrar_resena((select token from tok where nn = '13'), 0, null)$$, '23514', null,
  'registrar_resena con calificación 0 la rechaza la restricción de resena');
select throws_ok($$select public.registrar_resena((select token from tok where nn = '13'), 6, null)$$, '23514', null,
  'Con calificación 6 también');
select throws_ok($$select public.registrar_resena((select token from tok where nn = '13'), 5, repeat('x', 1001))$$, '23514', null,
  'Con un comentario de 1001 caracteres también');
select is((select public.registrar_resena((select token from tok where nn = '13'), 4, repeat('é', 1000))), 'registrada',
  'Con un comentario de exactamente 1000 caracteres (con tildes) sí se registra: los intentos fallidos no gastaron la invitación');
reset role;
select results_eq(
  $$select calificacion, char_length(comentario) from public.resena where id_pago = '60000000-0000-0000-0000-000000003513'$$,
  $$values (4, 1000)$$,
  'Quedó una sola reseña, la de 1000 caracteres');

-- ---------------------------------------------------------------------------
-- public.resena: las restricciones de D-17 directamente sobre la tabla
-- ---------------------------------------------------------------------------
select throws_ok(
  $$insert into public.resena (id_pago, calificacion) values ('60000000-0000-0000-0000-000000003504', 0)$$,
  '23514', null, 'La calificación 0 no entra');
select throws_ok(
  $$insert into public.resena (id_pago, calificacion) values ('60000000-0000-0000-0000-000000003504', 6)$$,
  '23514', null, 'La calificación 6 no entra');
select throws_ok(
  $$insert into public.resena (id_pago, calificacion) values ('60000000-0000-0000-0000-000000003504', -1)$$,
  '23514', null, 'Una calificación negativa no entra');
select throws_ok(
  $$insert into public.resena (id_pago, calificacion) values ('60000000-0000-0000-0000-000000003504', null)$$,
  '23502', null, 'La calificación es obligatoria');
select throws_ok(
  $$insert into public.resena (id_pago, calificacion, comentario) values ('60000000-0000-0000-0000-000000003504', 3, '')$$,
  '23514', null, 'Un comentario vacío no entra (o es nulo, o tiene de 1 a 1000 caracteres)');
select throws_ok(
  $$insert into public.resena (id_pago, calificacion, comentario)
    values ('60000000-0000-0000-0000-000000003504', 3, repeat('a', 1001))$$,
  '23514', null, 'Un comentario de 1001 caracteres no entra');
select lives_ok(
  $$insert into public.resena (id_pago, calificacion, comentario)
    values ('60000000-0000-0000-0000-000000003507', 5, repeat('a', 1000))$$,
  'La calificación 5 con un comentario de 1000 caracteres sí entra');
select lives_ok(
  $$insert into public.resena (id_pago, calificacion) values ('60000000-0000-0000-0000-000000003508', 1)$$,
  'La calificación 1 sin comentario sí entra');
select throws_ok(
  $$insert into public.resena (id_pago, calificacion) values ('60000000-0000-0000-0000-000000003507', 3)$$,
  '23505', null, 'Un pago no tiene dos reseñas (RN-70)');

-- ---------------------------------------------------------------------------
-- Si el pedido a la app falla, el cambio de estado no se cae
-- ---------------------------------------------------------------------------
-- Se reemplaza disparar_invitaciones_resena por una que falla (como una dirección mal escrita en Vault). El reemplazo
-- se deshace con el rollback. Va al final porque las pruebas de arriba usan la función de verdad.
create or replace function privado.disparar_invitaciones_resena()
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
  $$update public.monitoria set estado = 'realizada', fecha_finalizacion = timestamptz '2020-03-11 10:30-05'
    where id = '50000000-0000-0000-0000-000000003514'$$,
  'Con el pedido a la app fallando, pasar la monitoría a realizada no falla');
select results_eq(
  $$select m.estado::text, i.procesado_en is null
    from public.monitoria m join public.pago p on p.id_monitoria = m.id join public.invitacion_resena i on i.id_pago = p.id
    where m.id = '50000000-0000-0000-0000-000000003514'$$,
  $$values ('realizada'::text, true)$$,
  'La monitoría queda realizada y su invitación anotada, pendiente: pg_cron la vuelve a pedir');

select * from finish();
rollback;
