-- Pruebas pgTAP de "no invitar a reseñar a quien reportó que el monitor no llegó" (HU-080, D-40).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.
--
-- Qué cubre la migración 20261004192526_resena_y_reporte.sql (sobre HU-035 y HU-029):
--   * privado.monitoria_con_reporte_abierto, public.invitaciones_resena_por_procesar y public.invitacion_resena_en_espera:
--     definición y permisos (invoker, solo service_role). privado.reanudar_invitaciones_resena y su trigger sobre
--     reporte_inasistencia (definer, nadie la ejecuta).
--   * (a) Con un reporte en revisión o aceptado la invitación se anota igual, pero no se lista para procesar, `disponible` es
--     falso, la invitación está en espera y privado.disparar_invitaciones_resena no pide nada (aun con Vault configurado).
--     Vale para el reporte creado antes de `realizada` y para el creado entre anotar y procesar.
--   * (b) Al pasar el reporte a `rechazado` (aquí con un update directo, como lo hará HU-030) la invitación vuelve a listarse,
--     queda disponible y disparar pide el procesamiento. El trigger nunca tumba el cambio (sin Vault ni con un pedido que falla).
--   * (c) resena_por_token y registrar_resena: `con_reporte` con el reporte en revisión, o aceptado con la monitoría ya
--     cancelada; `disponible` / `registrada` tras el rechazo; `ya_resenada` gana sobre `con_reporte`.
--   * (d) Quien ya reseñó puede reportar (privado.reportar_inasistencia y reportar_inasistencia_por_token) y su reseña sigue igual.
--   * Sin reporte, o con uno rechazado desde antes, todo funciona como en HU-035.
--
-- Elenco (todos los ids terminan en 80NN; las materias son 'PGTAP-80-A' y 'PGTAP-80-B'; cada monitoría tiene un pago aprobado
-- con el mismo número). Monitor A (materia A) y monitor B (materia B), admin 01, Lead 01. Monitorías individuales:
--     01 reporte en revisión antes de realizada; luego se rechaza   02 reporte aceptado antes de realizada; luego cancelada
--     03 reporte creado después de anotar (privado.reportar_inasistencia)   04 sin reporte   05 con un reporte rechazado de antes
--     06 con reseña y luego reporte   07 con reseña y luego reporte por el enlace del correo (usa now())
--     08 y 09 confirmadas con un reporte en revisión que luego se rechaza (el trigger sin Vault y con el pedido fallando)

begin;
create extension if not exists pgtap with schema extensions;

select plan(93);

-- ---------------------------------------------------------------------------
-- Las funciones y el trigger: definición y permisos
-- ---------------------------------------------------------------------------
select has_function('privado', 'monitoria_con_reporte_abierto', array['uuid'],
  'Existe privado.monitoria_con_reporte_abierto(uuid), la regla de D-40 en un solo lugar');
select has_function('public', 'invitaciones_resena_por_procesar', array['integer'],
  'Existe public.invitaciones_resena_por_procesar(integer), lo que la app procesa');
select has_function('public', 'invitacion_resena_en_espera', array['uuid'],
  'Existe public.invitacion_resena_en_espera(uuid), para no descartar una invitación que solo espera');
select has_function('privado', 'reanudar_invitaciones_resena', '{}'::name[],
  'Existe privado.reanudar_invitaciones_resena, la del trigger del rechazo');
select ok(
  not (select prosecdef from pg_proc where oid = 'privado.monitoria_con_reporte_abierto(uuid)'::regprocedure)
  and not (select prosecdef from pg_proc where oid = 'public.invitaciones_resena_por_procesar(integer)'::regprocedure)
  and not (select prosecdef from pg_proc where oid = 'public.invitacion_resena_en_espera(uuid)'::regprocedure)
  and (select prosecdef from pg_proc where oid = 'privado.reanudar_invitaciones_resena()'::regprocedure),
  'Las tres de lectura corren con los permisos de quien llama; la del trigger es security definer');
select ok(
  (select bool_and('search_path=""' = any(proconfig)) from pg_proc
   where oid in ('privado.monitoria_con_reporte_abierto(uuid)'::regprocedure,
                 'public.invitaciones_resena_por_procesar(integer)'::regprocedure,
                 'public.invitacion_resena_en_espera(uuid)'::regprocedure,
                 'privado.reanudar_invitaciones_resena()'::regprocedure,
                 'privado.disparar_invitaciones_resena()'::regprocedure,
                 'public.datos_de_invitacion_resena(uuid)'::regprocedure,
                 'public.resena_por_token(text)'::regprocedure,
                 'public.registrar_resena(text, integer, text)'::regprocedure)),
  'Las funciones nuevas y las redefinidas fijan un search_path vacío');
select is(
  array[pg_get_function_result('privado.monitoria_con_reporte_abierto(uuid)'::regprocedure),
        pg_get_function_result('public.invitacion_resena_en_espera(uuid)'::regprocedure),
        pg_get_function_result('privado.reanudar_invitaciones_resena()'::regprocedure),
        pg_get_function_result('privado.disparar_invitaciones_resena()'::regprocedure),
        pg_get_function_result('public.registrar_resena(text, integer, text)'::regprocedure)],
  array['boolean', 'boolean', 'trigger', 'bigint', 'text'],
  'Los tipos de salida son los esperados (disparar y registrar_resena conservan los suyos)');
select is(
  (select array_agg(a.n order by a.o)
   from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as a(n, m, o)
   where p.oid = 'public.invitaciones_resena_por_procesar(integer)'::regprocedure and a.m = 't'),
  array['id', 'id_pago', 'intentos'],
  'invitaciones_resena_por_procesar devuelve el id, el pago y los intentos');
select is(
  (select array_agg(a.n order by a.o)
   from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as a(n, m, o)
   where p.oid = 'public.datos_de_invitacion_resena(uuid)'::regprocedure and a.m = 't'),
  array['token', 'disponible', 'correo_lead', 'nombre_lead', 'nombre_monitor'],
  'datos_de_invitacion_resena conserva sus columnas');
select is(
  (select array_agg(a.n order by a.o)
   from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as a(n, m, o)
   where p.oid = 'public.resena_por_token(text)'::regprocedure and a.m = 't'),
  array['estado', 'nombre_monitor', 'nombre_materia', 'inicio'],
  'resena_por_token conserva sus columnas');

select has_trigger('public', 'reporte_inasistencia', 'reporte_reanuda_invitaciones_resena',
  'reporte_inasistencia tiene el trigger reporte_reanuda_invitaciones_resena');
select trigger_is('public', 'reporte_inasistencia', 'reporte_reanuda_invitaciones_resena', 'privado', 'reanudar_invitaciones_resena',
  'El trigger llama a privado.reanudar_invitaciones_resena');
select matches(
  (select pg_get_triggerdef(t.oid) from pg_trigger t
   where t.tgrelid = 'public.reporte_inasistencia'::regclass and t.tgname = 'reporte_reanuda_invitaciones_resena'),
  'AFTER UPDATE OF estado ON public\.reporte_inasistencia FOR EACH ROW',
  'Corre después de cambiar el estado, por fila');
select matches(
  (select pg_get_triggerdef(t.oid) from pg_trigger t
   where t.tgrelid = 'public.reporte_inasistencia'::regclass and t.tgname = 'reporte_reanuda_invitaciones_resena'),
  'rechazado',
  'Y solo cuando el nuevo estado es rechazado');

-- Permisos: las tres de lectura solo para service_role; la del trigger para nadie.
select ok(
  has_function_privilege('service_role', 'privado.monitoria_con_reporte_abierto(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'privado.monitoria_con_reporte_abierto(uuid)', 'execute')
  and not has_function_privilege('anon', 'privado.monitoria_con_reporte_abierto(uuid)', 'execute'),
  'monitoria_con_reporte_abierto solo la ejecuta service_role');
select ok(
  has_function_privilege('service_role', 'public.invitaciones_resena_por_procesar(integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.invitaciones_resena_por_procesar(integer)', 'execute')
  and not has_function_privilege('anon', 'public.invitaciones_resena_por_procesar(integer)', 'execute'),
  'invitaciones_resena_por_procesar solo la ejecuta service_role');
select ok(
  has_function_privilege('service_role', 'public.invitacion_resena_en_espera(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.invitacion_resena_en_espera(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.invitacion_resena_en_espera(uuid)', 'execute'),
  'invitacion_resena_en_espera solo la ejecuta service_role');
select ok(
  not has_function_privilege('anon', 'privado.reanudar_invitaciones_resena()', 'execute')
  and not has_function_privilege('authenticated', 'privado.reanudar_invitaciones_resena()', 'execute')
  and not has_function_privilege('service_role', 'privado.reanudar_invitaciones_resena()', 'execute'),
  'Nadie ejecuta privado.reanudar_invitaciones_resena: solo la dispara el trigger');
select ok(
  not exists (
    select 1
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid in ('privado.monitoria_con_reporte_abierto(uuid)'::regprocedure,
                    'public.invitaciones_resena_por_procesar(integer)'::regprocedure,
                    'public.invitacion_resena_en_espera(uuid)'::regprocedure,
                    'privado.reanudar_invitaciones_resena()'::regprocedure,
                    'privado.disparar_invitaciones_resena()'::regprocedure,
                    'public.datos_de_invitacion_resena(uuid)'::regprocedure,
                    'public.resena_por_token(text)'::regprocedure,
                    'public.registrar_resena(text, integer, text)'::regprocedure)
      and a.grantee = 0),
  'Nadie las hereda de PUBLIC');
select ok(
  has_function_privilege('service_role', 'public.datos_de_invitacion_resena(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.resena_por_token(text)', 'execute')
  and has_function_privilege('service_role', 'public.registrar_resena(text, integer, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.registrar_resena(text, integer, text)', 'execute')
  and not has_function_privilege('anon', 'public.registrar_resena(text, integer, text)', 'execute'),
  'Las tres redefinidas conservan sus permisos: solo service_role');

set local role anon;
select throws_ok($$select privado.monitoria_con_reporte_abierto('60000000-0000-0000-0000-000000008001')$$, '42501', null,
  'anon no puede consultar la regla: permiso denegado');
select throws_ok($$select * from public.invitaciones_resena_por_procesar(10)$$, '42501', null,
  'anon no puede listar las invitaciones por procesar: permiso denegado');
select throws_ok($$select public.invitacion_resena_en_espera('60000000-0000-0000-0000-000000008001')$$, '42501', null,
  'anon no puede preguntar si una invitación está en espera: permiso denegado');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000080a0","role":"authenticated"}';
select throws_ok($$select privado.monitoria_con_reporte_abierto('60000000-0000-0000-0000-000000008001')$$, '42501', null,
  'Una sesión no puede consultar la regla: permiso denegado');
select throws_ok($$select * from public.invitaciones_resena_por_procesar(10)$$, '42501', null,
  'Una sesión no puede listar las invitaciones por procesar: permiso denegado');
select throws_ok($$select public.invitacion_resena_en_espera('60000000-0000-0000-0000-000000008001')$$, '42501', null,
  'Una sesión no puede preguntar si una invitación está en espera: permiso denegado');
reset role;
set local role service_role;
select throws_ok($$select privado.reanudar_invitaciones_resena()$$, '42501', null,
  'service_role tampoco ejecuta la función del trigger: permiso denegado');
reset role;

-- ---------------------------------------------------------------------------
-- Fixtures (como postgres)
-- ---------------------------------------------------------------------------
-- La prueba no depende de lo que haya en Vault.
delete from vault.secrets where name in ('calibra_sitio_url', 'calibra_cron_secreto');

-- Cualquier admin que ya existiera queda inactivo durante la prueba: el reporte se asigna al admin 01.
update auth.users set banned_until = 'infinity' where id in (select id from public.admin);

insert into auth.users (id, is_anonymous) values
  ('a0000000-0000-0000-0000-000000008001', false),
  ('b0000000-0000-0000-0000-0000000080a0', false),
  ('b0000000-0000-0000-0000-0000000080b0', false),
  ('c0000000-0000-0000-0000-000000008001', true);

insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-000000008001', 'Admin 80', 'admin80@calibra.test', -8000);
insert into public.monitor (id, nombre) values
  ('b0000000-0000-0000-0000-0000000080a0', 'Ana 80'),
  ('b0000000-0000-0000-0000-0000000080b0', 'Beto 80');
insert into public.monitor_privado (id_monitor, numero_telefono, correo, llave) values
  ('b0000000-0000-0000-0000-0000000080a0', '3008000001', 'ana.monitora80@calibra.test', 'llave-ana-80'),
  ('b0000000-0000-0000-0000-0000000080b0', '3008000002', 'beto.monitor80@calibra.test', 'llave-beto-80');
insert into public.materia (id, nombre, codigo) values
  ('10000000-0000-0000-0000-0000000080a1', 'Materia 80 A', 'PGTAP-80-A'),
  ('10000000-0000-0000-0000-0000000080b1', 'Materia 80 B', 'PGTAP-80-B');
insert into public.certificado (id_monitor, id_materia, id_admin) values
  ('b0000000-0000-0000-0000-0000000080a0', '10000000-0000-0000-0000-0000000080a1', 'a0000000-0000-0000-0000-000000008001'),
  ('b0000000-0000-0000-0000-0000000080b0', '10000000-0000-0000-0000-0000000080b1', 'a0000000-0000-0000-0000-000000008001');
insert into public.lead (id, id_sesion_anonima, nombre, numero_telefono, correo, acepta_tratamiento_datos, fecha_consentimiento) values
  ('40000000-0000-0000-0000-000000008001', 'c0000000-0000-0000-0000-000000008001', 'Lucía Prueba 80', '3008001111',
   'lucia.lead80@calibra.test', true, now());

-- Franjas: las del 01 al 09 caen los miércoles a las 9:00 en Bogotá (monitorías del 11-mar-2020, en el pasado); la 05 es del
-- monitor B. La 07 usa now(): su hora de inicio es la de hace 2 horas en Bogotá, con el día de la semana que le corresponde.
create temporary table inicio_80 (nn text primary key, inicio timestamptz not null);
insert into inicio_80 (nn, inicio) values ('07', date_trunc('minute', now() - interval '2 hours'));
insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min, lugar, enlace, abierta_desde)
select ('30000000-0000-0000-0000-0000000080' || nn)::uuid,
       case when nn = '05' then 'b0000000-0000-0000-0000-0000000080b0'::uuid else 'b0000000-0000-0000-0000-0000000080a0'::uuid end,
       smallint '3', time '09:00', false, 20000, 60, null, 'https://meet.example/80-' || nn, date '2019-01-01'
from unnest(array['01', '02', '03', '04', '05', '06', '08', '09']) as nn;
insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min, lugar, enlace, abierta_desde)
select ('30000000-0000-0000-0000-0000000080' || nn)::uuid, 'b0000000-0000-0000-0000-0000000080a0'::uuid,
       extract(isodow from (inicio at time zone 'America/Bogota')::date)::smallint,
       (inicio at time zone 'America/Bogota')::time, false, 20000, 60, null, 'https://meet.example/80-' || nn, date '2019-01-01'
from inicio_80;

-- La 07 se crea por pagar y se confirma más abajo con un UPDATE: el trigger de HU-019 anota el token del enlace del correo.
insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado)
select ('50000000-0000-0000-0000-0000000080' || v.nn)::uuid, ('30000000-0000-0000-0000-0000000080' || v.nn)::uuid,
       case when v.nn = '05' then '10000000-0000-0000-0000-0000000080b1'::uuid else '10000000-0000-0000-0000-0000000080a1'::uuid end,
       '40000000-0000-0000-0000-000000008001'::uuid, date '2020-03-11', 20000, v.estado
from (values
  ('01', 'confirmada'::public.estado_monitoria), ('02', 'confirmada'), ('03', 'confirmada'), ('04', 'confirmada'),
  ('05', 'confirmada'), ('06', 'confirmada'), ('08', 'confirmada'), ('09', 'confirmada')) as v(nn, estado);
insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado)
select '50000000-0000-0000-0000-000000008007', '30000000-0000-0000-0000-000000008007',
       '10000000-0000-0000-0000-0000000080a1', '40000000-0000-0000-0000-000000008001',
       (inicio at time zone 'America/Bogota')::date, 20000, 'pendiente_pago'
from inicio_80;

-- Un pago aprobado por monitoría (menos la 08 y la 09, que no llegan a realizada).
create temporary table pago_80 (nn text primary key);
insert into pago_80 (nn) values ('01'), ('02'), ('03'), ('04'), ('05'), ('06'), ('07');
insert into public.comprobante_revisado (ruta, tipo)
select 'c0000000-0000-0000-0000-000000008001/60000000-0000-0000-0000-0000000080' || nn || '.pdf', 'application/pdf'
from pago_80;
insert into public.pago (id, id_monitoria, monto, nombre_pagador, contacto, estado, id_admin, fecha_revision, comprobante)
select ('60000000-0000-0000-0000-0000000080' || nn)::uuid, ('50000000-0000-0000-0000-0000000080' || nn)::uuid,
       20000, 'Pagador Secreto 80', 'pagador.secreto80@example.com', 'aprobado', 'a0000000-0000-0000-0000-000000008001', now(),
       'c0000000-0000-0000-0000-000000008001/60000000-0000-0000-0000-0000000080' || nn || '.pdf'
from pago_80;

-- Reportes de partida, antes de que la monitoría llegue a realizada: 01 en revisión, 02 aceptado, 05 rechazado, 08 y 09 en revisión.
insert into public.reporte_inasistencia (id_monitoria, id_admin, estado, fecha_decision) values
  ('50000000-0000-0000-0000-000000008001', 'a0000000-0000-0000-0000-000000008001', 'en_revision', null),
  ('50000000-0000-0000-0000-000000008002', 'a0000000-0000-0000-0000-000000008001', 'aceptado', now()),
  ('50000000-0000-0000-0000-000000008005', 'a0000000-0000-0000-0000-000000008001', 'rechazado', now()),
  ('50000000-0000-0000-0000-000000008008', 'a0000000-0000-0000-0000-000000008001', 'en_revision', null),
  ('50000000-0000-0000-0000-000000008009', 'a0000000-0000-0000-0000-000000008001', 'en_revision', null);

select ok(
  (select count(*) = 9 from public.monitoria where id::text like '50000000-0000-0000-0000-0000000080%')
  and (select count(*) = 7 from public.pago where id::text like '60000000-0000-0000-0000-0000000080%')
  and (select count(*) = 5 from public.reporte_inasistencia where id_monitoria::text like '50000000-0000-0000-0000-0000000080%')
  and privado.siguiente_admin_activo() = 'a0000000-0000-0000-0000-000000008001',
  'Control: las 9 monitorías, los 7 pagos y los 5 reportes de partida existen, y el primer admin activo es el 01');

-- ---------------------------------------------------------------------------
-- Las reglas de la función, en frío
-- ---------------------------------------------------------------------------
select results_eq(
  $$select right(m.id::text, 2), privado.monitoria_con_reporte_abierto(m.id)
    from public.monitoria m where m.id::text like '50000000-0000-0000-0000-0000000080%' order by 1$$,
  $$values ('01'::text, true), ('02', true), ('03', false), ('04', false), ('05', false), ('06', false), ('07', false),
           ('08', true), ('09', true)$$,
  'Reporte abierto = en revisión o aceptado; rechazado o sin reporte, no');
select is(privado.monitoria_con_reporte_abierto(gen_random_uuid()), false, 'Una monitoría que no existe: no hay reporte abierto');
select is(privado.monitoria_con_reporte_abierto(null), false, 'Una monitoría nula: tampoco');

-- ---------------------------------------------------------------------------
-- (a) Reporte antes de realizada: la invitación se anota pero no sale
-- ---------------------------------------------------------------------------
update public.monitoria set estado = 'realizada', fecha_finalizacion = timestamptz '2020-03-11 10:30-05'
where id in ('50000000-0000-0000-0000-000000008001', '50000000-0000-0000-0000-000000008002');

select set_eq(
  $$select right(id_pago::text, 2) from public.invitacion_resena where id_pago::text like '60000000-0000-0000-0000-0000000080%'$$,
  $$values ('01'::text), ('02')$$,
  'Las invitaciones de la 01 (reporte en revisión) y la 02 (aceptado) se anotan igual: la espera se decide al procesar');

create temporary table tok (nn text primary key, token text not null);
insert into tok (nn, token)
select right(id_pago::text, 2), token from public.invitacion_resena where id_pago::text like '60000000-0000-0000-0000-0000000080%';
grant select on tok to service_role;

-- Con Vault configurado, para que el único motivo de no pedir nada sea la espera.
select vault.create_secret('https://calibra.test/', 'calibra_sitio_url');
select vault.create_secret('secreto-de-prueba-con-al-menos-treinta-y-dos-caracteres', 'calibra_cron_secreto');
select is(privado.disparar_invitaciones_resena(), null::bigint,
  'Con Vault configurado y solo invitaciones en espera (reporte en revisión y aceptado), disparar no pide nada');

set local role service_role;
select is((select count(*)::int from public.invitaciones_resena_por_procesar(10)
           where id_pago::text like '60000000-0000-0000-0000-0000000080%'), 0,
  'Ninguna de las dos se lista para procesar');
select is((select disponible from public.datos_de_invitacion_resena('60000000-0000-0000-0000-000000008001')), false,
  'La 01 (reporte en revisión): datos_de_invitacion_resena.disponible es falso');
select is((select disponible from public.datos_de_invitacion_resena('60000000-0000-0000-0000-000000008002')), false,
  'La 02 (reporte aceptado): también');
select is(public.invitacion_resena_en_espera('60000000-0000-0000-0000-000000008001'), true, 'La 01 está en espera');
select is(public.invitacion_resena_en_espera('60000000-0000-0000-0000-000000008002'), true, 'La 02 también');
select is(public.invitacion_resena_en_espera('60000000-0000-0000-0000-000000008099'), false, 'Un pago sin invitación no está en espera');
select is(public.invitacion_resena_en_espera(null), false, 'Un pago nulo tampoco');
reset role;

-- ---------------------------------------------------------------------------
-- Sin reporte, o con uno rechazado de antes: como en HU-035
-- ---------------------------------------------------------------------------
update public.monitoria set estado = 'realizada', fecha_finalizacion = timestamptz '2020-03-11 10:30-05'
where id in ('50000000-0000-0000-0000-000000008003', '50000000-0000-0000-0000-000000008004', '50000000-0000-0000-0000-000000008005');
insert into tok (nn, token)
select right(id_pago::text, 2), token from public.invitacion_resena
where id_pago::text like '60000000-0000-0000-0000-0000000080%' and right(id_pago::text, 2) in ('03', '04', '05');

set local role service_role;
select set_eq(
  $$select right(id_pago::text, 2) from public.invitaciones_resena_por_procesar(10)
    where id_pago::text like '60000000-0000-0000-0000-0000000080%'$$,
  $$values ('03'::text), ('04'), ('05')$$,
  'Se listan la 03 (todavía sin reporte), la 04 (sin reporte) y la 05 (reporte rechazado de antes), no la 01 ni la 02');
select is((select count(*)::int from public.invitaciones_resena_por_procesar(1)), 1, 'El límite se respeta');
select results_eq(
  $$select intentos from public.invitaciones_resena_por_procesar(10)
    where id_pago = '60000000-0000-0000-0000-000000008004'$$,
  $$values (0)$$,
  'Devuelve los intentos de la invitación');
select is((select disponible from public.datos_de_invitacion_resena('60000000-0000-0000-0000-000000008004')), true,
  'La 04 (sin reporte): disponible');
select is((select disponible from public.datos_de_invitacion_resena('60000000-0000-0000-0000-000000008005')), true,
  'La 05 (reporte rechazado de antes): disponible');
select is(public.invitacion_resena_en_espera('60000000-0000-0000-0000-000000008004'), false, 'La 04 no está en espera');
select is(public.invitacion_resena_en_espera('60000000-0000-0000-0000-000000008005'), false,
  'La 05 tampoco: un reporte rechazado nunca bloquea');
select is((select estado from public.resena_por_token((select token from tok where nn = '04'))), 'disponible',
  'resena_por_token de la 04: disponible (sin regresión)');
select is((select estado from public.resena_por_token((select token from tok where nn = '05'))), 'disponible',
  'resena_por_token de la 05 (reporte rechazado de antes): disponible');
reset role;
select is(privado.disparar_invitaciones_resena() is not null, true,
  'Con Vault y invitaciones que sí se pueden mandar, disparar pide el procesamiento (como en HU-035)');

-- ---------------------------------------------------------------------------
-- (a') El reporte llega después de anotar y antes de procesar
-- ---------------------------------------------------------------------------
select is(privado.reportar_inasistencia('50000000-0000-0000-0000-000000008003', timestamptz '2020-03-11 11:00-05'), 'reportada',
  'El Lead reporta la 03 cuando ya está realizada y con su invitación anotada');
set local role service_role;
select set_eq(
  $$select right(id_pago::text, 2) from public.invitaciones_resena_por_procesar(10)
    where id_pago::text like '60000000-0000-0000-0000-0000000080%'$$,
  $$values ('04'::text), ('05')$$,
  'La 03 deja de listarse apenas hay reporte');
select is((select disponible from public.datos_de_invitacion_resena('60000000-0000-0000-0000-000000008003')), false,
  'La 03: disponible pasa a falso');
select is(public.invitacion_resena_en_espera('60000000-0000-0000-0000-000000008003'), true, 'Y queda en espera');
reset role;

-- La 04 y la 05 salen de la cola: solo quedan invitaciones en espera (01, 02 y 03).
update public.invitacion_resena set procesado_en = now()
where id_pago in ('60000000-0000-0000-0000-000000008004', '60000000-0000-0000-0000-000000008005');
select is(privado.disparar_invitaciones_resena(), null::bigint,
  'Con Vault configurado y solo invitaciones en espera (01 y 03 en revisión, 02 aceptada), disparar no pide nada');
set local role service_role;
select is(public.invitacion_resena_en_espera('60000000-0000-0000-0000-000000008004'), false,
  'Una invitación ya procesada no está en espera aunque hubiera un reporte abierto');
reset role;

-- ---------------------------------------------------------------------------
-- (c) El enlace con reporte abierto: explica y no deja reseñar
-- ---------------------------------------------------------------------------
set local role service_role;
select is((select estado from public.resena_por_token((select token from tok where nn = '01'))), 'con_reporte',
  'La 01, con reporte en revisión: el enlace dice con_reporte');
select is((select estado from public.resena_por_token((select token from tok where nn = '03'))), 'con_reporte',
  'La 03, con el reporte hecho después de anotar la invitación: con_reporte');
select is((select estado from public.resena_por_token((select token from tok where nn = '02'))), 'con_reporte',
  'La 02, con reporte aceptado y la monitoría todavía realizada: con_reporte');
select results_eq(
  $$select nombre_monitor, nombre_materia from public.resena_por_token((select token from tok where nn = '01'))$$,
  $$values ('Ana 80'::text, 'Materia 80 A'::text)$$,
  'Con reporte, la página igual trae el monitor y la materia para explicarse');
select is(public.registrar_resena((select token from tok where nn = '01'), 5, 'Excelente'), 'con_reporte',
  'registrar_resena con el reporte en revisión: con_reporte');
select is(public.registrar_resena((select token from tok where nn = '03'), 5, null), 'con_reporte',
  'registrar_resena con el reporte hecho después: con_reporte');
reset role;

-- Un aceptado cancelará la monitoría (D-37): con_reporte gana sobre no_disponible.
update public.monitoria set estado = 'cancelada', motivo_cancelacion = 'monitor_no_asistio', fecha_finalizacion = null
where id = '50000000-0000-0000-0000-000000008002';
select is((select estado::text from public.monitoria where id = '50000000-0000-0000-0000-000000008002'), 'cancelada',
  'Control: la 02 quedó cancelada');
set local role service_role;
select is((select estado from public.resena_por_token((select token from tok where nn = '02'))), 'con_reporte',
  'La 02, aceptada y con la monitoría cancelada: con_reporte y no no_disponible');
select is(public.registrar_resena((select token from tok where nn = '02'), 5, null), 'con_reporte',
  'registrar_resena de la 02: con_reporte');
select is(public.invitacion_resena_en_espera('60000000-0000-0000-0000-000000008002'), true,
  'La invitación de la 02 sigue sin procesar y en espera, a propósito: no se borra ni se marca');
reset role;
select is((select count(*)::int from public.resena where id_pago::text like '60000000-0000-0000-0000-0000000080%'), 0,
  'Ninguna de esas llamadas guardó una reseña');
select is(privado.disparar_invitaciones_resena(), null::bigint,
  'Y la 02 no hace que disparar le pida nada a la app (si no, el cron la llamaría cada 5 minutos para siempre)');

-- ---------------------------------------------------------------------------
-- (b) El rechazo reactiva
-- ---------------------------------------------------------------------------
select lives_ok(
  $$update public.reporte_inasistencia set estado = 'rechazado', fecha_decision = now()
    where id_monitoria = '50000000-0000-0000-0000-000000008001'$$,
  'El admin rechaza el reporte de la 01 (update directo, como lo hará HU-030)');
set local role service_role;
select set_eq(
  $$select right(id_pago::text, 2) from public.invitaciones_resena_por_procesar(10)
    where id_pago::text like '60000000-0000-0000-0000-0000000080%'$$,
  $$values ('01'::text)$$,
  'La invitación de la 01 vuelve a listarse sola; la 02 y la 03 siguen esperando');
select is((select disponible from public.datos_de_invitacion_resena('60000000-0000-0000-0000-000000008001')), true,
  'La 01: disponible otra vez');
select is(public.invitacion_resena_en_espera('60000000-0000-0000-0000-000000008001'), false, 'Ya no está en espera');
select is((select procesado_en is null from public.invitacion_resena where id_pago = '60000000-0000-0000-0000-000000008001'), true,
  'No hubo que reactivar nada: la fila nunca se marcó');
select is((select estado from public.resena_por_token((select token from tok where nn = '01'))), 'disponible',
  'El mismo enlace de la 01 vuelve a ser disponible');
reset role;
select isnt(privado.disparar_invitaciones_resena(), null::bigint,
  'Con Vault configurado, disparar vuelve a pedir el procesamiento (devuelve el id de la petición de pg_net)');

-- Y la reseña de la 01 se guarda.
set local role service_role;
select is(public.registrar_resena((select token from tok where nn = '01'), 5, 'Excelente'), 'registrada',
  'Rechazado el reporte, registrar_resena guarda la reseña de la 01');
select is((select estado from public.resena_por_token((select token from tok where nn = '01'))), 'ya_resenada',
  'Y el enlace pasa a ya_resenada');
reset role;

-- ya_resenada gana sobre con_reporte: si el reporte se reabre, quien ya calificó sigue viendo "ya calificaste".
update public.reporte_inasistencia set estado = 'en_revision', fecha_decision = null
where id_monitoria = '50000000-0000-0000-0000-000000008001';
set local role service_role;
select is((select estado from public.resena_por_token((select token from tok where nn = '01'))), 'ya_resenada',
  'Con la reseña guardada y un reporte otra vez en revisión, ya_resenada gana sobre con_reporte');
select is(public.registrar_resena((select token from tok where nn = '01'), 1, 'Otra'), 'ya_resenada',
  'registrar_resena también: ya_resenada, y la reseña no se toca');
reset role;
select results_eq(
  $$select calificacion::int, comentario from public.resena where id_pago = '60000000-0000-0000-0000-000000008001'$$,
  $$values (5, 'Excelente'::text)$$,
  'La reseña de la 01 sigue igual');

-- La 03 también se rechaza: su enlace sirve y su reseña se guarda.
update public.reporte_inasistencia set estado = 'rechazado', fecha_decision = now()
where id_monitoria = '50000000-0000-0000-0000-000000008003';
set local role service_role;
select is((select estado from public.resena_por_token((select token from tok where nn = '03'))), 'disponible',
  'La 03, con el reporte rechazado: disponible');
select is(public.registrar_resena((select token from tok where nn = '03'), 4, null), 'registrada',
  'Y registrar_resena la guarda');
reset role;

-- ---------------------------------------------------------------------------
-- (d) Quien ya reseñó puede reportar, y su reseña se conserva
-- ---------------------------------------------------------------------------
update public.monitoria set estado = 'realizada', fecha_finalizacion = timestamptz '2020-03-11 10:30-05'
where id = '50000000-0000-0000-0000-000000008006';
insert into public.resena (id_pago, calificacion, comentario) values ('60000000-0000-0000-0000-000000008006', 4, 'Muy bien');
create temporary table resena_06 as
  select id, id_pago, calificacion, comentario, fecha from public.resena where id_pago = '60000000-0000-0000-0000-000000008006';
select is(privado.reportar_inasistencia('50000000-0000-0000-0000-000000008006', timestamptz '2020-03-11 11:00-05'), 'reportada',
  'Quien ya reseñó la 06 puede reportar la inasistencia: reportada');
select results_eq(
  $$select r.id = t.id, r.id_pago = t.id_pago, r.calificacion = t.calificacion, r.comentario is not distinct from t.comentario,
           r.fecha = t.fecha
    from public.resena r join resena_06 t on t.id = r.id$$,
  $$values (true, true, true, true, true)$$,
  'Y la reseña de la 06 sigue idéntica (id, calificación, comentario y fecha)');
select is((select count(*)::int from public.resena where id_pago = '60000000-0000-0000-0000-000000008006'), 1,
  'Sigue habiendo una sola reseña');
insert into tok (nn, token) select '06', token from public.invitacion_resena where id_pago = '60000000-0000-0000-0000-000000008006';
set local role service_role;
select is((select estado from public.resena_por_token((select token from tok where nn = '06'))), 'ya_resenada',
  'La página de la 06 dice ya_resenada aunque ahora haya un reporte en revisión');
reset role;

-- La puerta del correo (reportar_inasistencia_por_token) con la 07, que usa now(): se confirma, se realiza, se reseña y se reporta.
update public.monitoria set estado = 'confirmada' where id = '50000000-0000-0000-0000-000000008007';
update public.monitoria set estado = 'realizada', fecha_finalizacion = now() where id = '50000000-0000-0000-0000-000000008007';
insert into public.resena (id_pago, calificacion, comentario) values ('60000000-0000-0000-0000-000000008007', 3, 'Regular');
create temporary table resena_07 as
  select id, calificacion, comentario, fecha from public.resena where id_pago = '60000000-0000-0000-0000-000000008007';
set local role service_role;
select is(
  public.reportar_inasistencia_por_token((select token from public.confirmacion_cita where id_monitoria = '50000000-0000-0000-0000-000000008007')),
  'reportada',
  'Con el enlace del correo, quien ya reseñó la 07 también puede reportar: reportada');
reset role;
select results_eq(
  $$select r.calificacion = t.calificacion, r.comentario is not distinct from t.comentario, r.fecha = t.fecha
    from public.resena r join resena_07 t on t.id = r.id$$,
  $$values (true, true, true)$$,
  'Y la reseña de la 07 sigue idéntica');
select is((select estado::text from public.reporte_inasistencia where id_monitoria = '50000000-0000-0000-0000-000000008007'), 'en_revision',
  'El reporte de la 07 quedó en revisión');

-- ---------------------------------------------------------------------------
-- El trigger del rechazo nunca tumba el cambio
-- ---------------------------------------------------------------------------
delete from vault.secrets where name in ('calibra_sitio_url', 'calibra_cron_secreto');
select lives_ok(
  $$update public.reporte_inasistencia set estado = 'rechazado', fecha_decision = now()
    where id_monitoria = '50000000-0000-0000-0000-000000008008'$$,
  'Sin Vault, rechazar un reporte no falla (disparar devuelve null)');
select is((select estado::text from public.reporte_inasistencia where id_monitoria = '50000000-0000-0000-0000-000000008008'), 'rechazado',
  'Y el reporte quedó rechazado');

-- Se reemplaza disparar_invitaciones_resena por una que falla (como una dirección mal escrita en Vault). El reemplazo se
-- deshace con el rollback. Va al final porque las pruebas de arriba usan la función de verdad.
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
  $$update public.reporte_inasistencia set estado = 'rechazado', fecha_decision = now()
    where id_monitoria = '50000000-0000-0000-0000-000000008009'$$,
  'Con el pedido a la app fallando, rechazar un reporte tampoco falla (solo un warning)');
select is((select estado::text from public.reporte_inasistencia where id_monitoria = '50000000-0000-0000-0000-000000008009'), 'rechazado',
  'Y el reporte quedó rechazado');

select * from finish();
rollback;
