-- Pruebas pgTAP de los pagos por cobrar o asumir: cerrar los casos P-24 y su efecto en el desembolso (HU-078, D-39).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos. pgrowlocks (para ver los candados de fila que
-- toma cerrar_caso_p24) también se crea dentro de ella.
--
-- cerrar_caso_p24, estado_para_ejecutar y ejecutar_desembolso se prueban con su p_ahora, como postgres y con el token
-- del admin puesto (auth.uid() lo lee sin importar el rol): ahora = jueves 31-dic-2020 12:00 en Bogotá. Las puertas
-- públicas y la vista desembolsos_ejecutables usan now(): todas las monitorías son de 2020 (o de enero de 2021, la que
-- todavía no empieza para el ahora fijo), así que su fin + 24 h ya pasó y ninguna prueba compara now() con una fecha que
-- algún día quede atrás.
-- Lo que no cabe en una transacción lo cubre la prueba de integración: dos admins que cierran el mismo caso a la vez.
--
-- Elenco (ids terminados en 78NN; la materia es 'PGTAP-78'):
--   Admins: A (cierra), B (otro admin activo) y C (desactivado). Monitor M, con su llave 'llave-m-78', y una franja de
--   los lunes de 10:00 a 11:00. Lead 01 con su sesión anónima. Los pagos están asignados a A, que revisó los revisados.
--   Pago NNk (k = a, b) de la monitoría NN, de 25.000 salvo que se diga otra cosa:
--   Cerrar:
--     01 realizada, 01a rechazado (P-24)               02 realizada, 02a rechazado (P-24)
--     03 cancelada por pago_rechazado, 03a rechazado   04 cancelada por el estudiante, 04a rechazado (P-07)
--     05 realizada, 05a aprobado y 05b en revisión     06 confirmada que ya empezó, 06a rechazado (P-24)
--     07 realizada, 07a en revisión (A lo rechaza)     08 confirmada del lunes 4-ene-2021, 08a en revisión (A lo rechaza
--                                                        antes de que empiece: se cancela, RN-43)
--   Desembolso (el desembolso 70000000-...-0000000078NN es el de la monitoría NN; su foto, entre paréntesis):
--     21 21a aprobado y 21b rechazado de 10.000, caso abierto (neto 22.500)
--     22 22a rechazado, caso abierto, su único pago (0)
--     23 23a en revisión y 23b rechazado de 5.000, caso abierto (0)
--     24 24a aprobado, 24b rechazado de 5.000, caso abierto, y un reporte en revisión (22.500)
--     25 sin pagos (0)
--     26 26a aprobado y 26b rechazado de 7.000 con el caso ya cerrado como asumido por B (22.500)

begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists pgrowlocks with schema extensions;

select plan(71);

-- ---------------------------------------------------------------------------
-- Estructura y permisos
-- ---------------------------------------------------------------------------
select col_type_is('public', 'pago', 'cierre_rechazo', 'text',
  'Criterio 2: pago.cierre_rechazo dice cómo se cerró el caso (cobrado o asumido)');
select col_type_is('public', 'pago', 'nota_cierre', 'text', 'pago.nota_cierre guarda la nota opcional del cierre');
select col_type_is('public', 'pago', 'id_admin_cierre', 'uuid', 'pago.id_admin_cierre guarda quién lo cerró');
select col_type_is('public', 'pago', 'fecha_cierre', 'timestamp with time zone', 'pago.fecha_cierre guarda cuándo');
select fk_ok('public', 'pago', 'id_admin_cierre', 'public', 'admin', 'id',
  'id_admin_cierre apunta a un admin (la tercera llave de pago a admin)');
select has_index('public', 'pago', 'pago_id_admin_cierre_idx', 'id_admin_cierre',
  'Tiene su índice, como cada llave foránea del esquema');
select ok(
  (select bool_and(has_column_privilege('authenticated', 'public.pago', c, 'select')
                   and not has_column_privilege('authenticated', 'public.pago', c, 'insert')
                   and not has_column_privilege('authenticated', 'public.pago', c, 'update')
                   and not has_column_privilege('anon', 'public.pago', c, 'select'))
   from unnest(array['cierre_rechazo', 'nota_cierre', 'id_admin_cierre', 'fecha_cierre']) as c),
  'La sesión las lee (la RLS de pago deja solo a los admins) y no las escribe: las escribe la función');
select ok(
  to_regprocedure('privado.estado_caso_p24(public.estado_pago, public.estado_monitoria, text)') is not null
  and to_regprocedure('privado.cerrar_caso_p24(uuid, text, text, timestamptz)') is not null
  and to_regprocedure('privado.cerrar_caso_p24_de_la_sesion(uuid, text, text)') is not null
  and to_regprocedure('public.cerrar_caso_p24(uuid, text, text)') is not null,
  'Existen estado_caso_p24 (qué es un caso), cerrar_caso_p24 con la hora, la de la sesión y la puerta en la Data API');
select ok(
  (select bool_and(prosecdef) from pg_proc
   where oid in ('privado.cerrar_caso_p24(uuid, text, text, timestamptz)'::regprocedure,
                 'privado.cerrar_caso_p24_de_la_sesion(uuid, text, text)'::regprocedure))
  and not (select bool_or(prosecdef) from pg_proc
           where oid in ('public.cerrar_caso_p24(uuid, text, text)'::regprocedure,
                         'privado.estado_caso_p24(public.estado_pago, public.estado_monitoria, text)'::regprocedure))
  and (select bool_and('search_path=""' = any(proconfig)) from pg_proc
       where oid in ('privado.cerrar_caso_p24(uuid, text, text, timestamptz)'::regprocedure,
                     'privado.cerrar_caso_p24_de_la_sesion(uuid, text, text)'::regprocedure,
                     'public.cerrar_caso_p24(uuid, text, text)'::regprocedure,
                     'privado.estado_caso_p24(public.estado_pago, public.estado_monitoria, text)'::regprocedure))
  and (select provolatile = 'i' from pg_proc
       where oid = 'privado.estado_caso_p24(public.estado_pago, public.estado_monitoria, text)'::regprocedure),
  'Las de privado que escriben son security definer; la puerta y estado_caso_p24 (inmutable, no lee tablas) corren con los permisos de quien llama; todas con search_path vacío');
select is(
  array[pg_get_function_identity_arguments('public.cerrar_caso_p24(uuid, text, text)'::regprocedure),
        pg_get_function_result('public.cerrar_caso_p24(uuid, text, text)'::regprocedure)],
  array['p_id_pago uuid, p_cierre text, p_nota text', 'text'],
  'La puerta no recibe el admin ni la hora: nadie cierra a nombre de otro ni elige cuándo');
select ok(
  not has_function_privilege('anon', 'public.cerrar_caso_p24(uuid, text, text)', 'execute')
  and not has_function_privilege('anon', 'privado.cerrar_caso_p24_de_la_sesion(uuid, text, text)', 'execute')
  and not has_function_privilege('anon', 'privado.cerrar_caso_p24(uuid, text, text, timestamptz)', 'execute')
  and not has_function_privilege('anon', 'privado.estado_caso_p24(public.estado_pago, public.estado_monitoria, text)', 'execute'),
  'Sin sesión (anon) no se ejecuta ninguna');
select ok(
  has_function_privilege('authenticated', 'public.cerrar_caso_p24(uuid, text, text)', 'execute')
  and has_function_privilege('authenticated', 'privado.cerrar_caso_p24_de_la_sesion(uuid, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'privado.cerrar_caso_p24(uuid, text, text, timestamptz)', 'execute')
  and has_function_privilege('authenticated', 'privado.estado_caso_p24(public.estado_pago, public.estado_monitoria, text)', 'execute')
  and has_function_privilege('service_role', 'privado.estado_caso_p24(public.estado_pago, public.estado_monitoria, text)', 'execute'),
  'Con sesión se cierra por la que usa now(), no por la que recibe la hora; estado_caso_p24 la ejecutan authenticated y service_role porque la vista desembolsos_ejecutables la llama con sus permisos');
select ok(
  not has_function_privilege('service_role', 'public.cerrar_caso_p24(uuid, text, text)', 'execute')
  and not has_function_privilege('service_role', 'privado.cerrar_caso_p24_de_la_sesion(uuid, text, text)', 'execute')
  and not has_function_privilege('service_role', 'privado.cerrar_caso_p24(uuid, text, text, timestamptz)', 'execute')
  and not exists (
    select 1
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid in ('privado.estado_caso_p24(public.estado_pago, public.estado_monitoria, text)'::regprocedure,
                    'privado.cerrar_caso_p24(uuid, text, text, timestamptz)'::regprocedure,
                    'privado.cerrar_caso_p24_de_la_sesion(uuid, text, text)'::regprocedure,
                    'public.cerrar_caso_p24(uuid, text, text)'::regprocedure)
      and a.grantee = 0),
  'service_role no cierra (sin sesión no hay admin) y nadie las hereda de PUBLIC');
select ok(
  (select prosecdef and 'search_path=""' = any(proconfig) from pg_proc
   where oid = 'privado.calcular_desembolso(uuid)'::regprocedure)
  and not has_function_privilege('authenticated', 'privado.calcular_desembolso(uuid)', 'execute')
  and not has_function_privilege('service_role', 'privado.calcular_desembolso(uuid)', 'execute')
  and not has_function_privilege('anon', 'privado.calcular_desembolso(uuid)', 'execute')
  and pg_get_function_result('privado.calcular_desembolso(uuid)'::regprocedure)
      = 'TABLE(monto_bruto integer, comision integer, monto_neto integer)'
  and (select not prosecdef and 'search_path=""' = any(proconfig) from pg_proc
       where oid = 'privado.bloqueo_del_desembolso(uuid)'::regprocedure)
  and has_function_privilege('authenticated', 'privado.bloqueo_del_desembolso(uuid)', 'execute')
  and has_function_privilege('service_role', 'privado.bloqueo_del_desembolso(uuid)', 'execute')
  and not has_function_privilege('anon', 'privado.bloqueo_del_desembolso(uuid)', 'execute'),
  'Redefinidas, calcular_desembolso y bloqueo_del_desembolso siguen igual por fuera: la primera definer y sin grant (la comisión solo la calcula el servidor), la segunda invoker para authenticated y service_role');

-- Sin permiso ni se ejecuta.
set local role anon;
select throws_ok($$select public.cerrar_caso_p24('60000000-0000-0000-0000-00000007801a', 'cobrado', null)$$,
  '42501', null, 'anon no puede llamar a cerrar_caso_p24: permiso denegado');
reset role;
set local role service_role;
select throws_ok($$select public.cerrar_caso_p24('60000000-0000-0000-0000-00000007801a', 'cobrado', null)$$,
  '42501', null, 'service_role tampoco: no es un admin con sesión');
reset role;
set local role authenticated;
select throws_ok($$select privado.cerrar_caso_p24('60000000-0000-0000-0000-00000007801a', 'cobrado', null, now())$$,
  '42501', null, 'Una sesión no llama a la versión que recibe la hora: permiso denegado');
reset role;

-- ---------------------------------------------------------------------------
-- Fixtures (como postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, is_anonymous, banned_until) values
  ('a0000000-0000-0000-0000-0000000078a0', false, null),
  ('a0000000-0000-0000-0000-0000000078b0', false, null),
  ('a0000000-0000-0000-0000-0000000078c0', false, now() + interval '100 years'),
  ('b0000000-0000-0000-0000-0000000078a0', false, null),
  ('c0000000-0000-0000-0000-000000007801', true, null);

insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-0000000078a0', 'Admin A', 'admin-a-hu078@calibra.test', 9007801),
  ('a0000000-0000-0000-0000-0000000078b0', 'Admin B', 'admin-b-hu078@calibra.test', 9007802),
  ('a0000000-0000-0000-0000-0000000078c0', 'Admin C', 'admin-c-hu078@calibra.test', 9007803);
insert into public.monitor (id, nombre) values ('b0000000-0000-0000-0000-0000000078a0', 'Monitor M');
insert into public.monitor_privado (id_monitor, numero_telefono, correo, llave) values
  ('b0000000-0000-0000-0000-0000000078a0', '3000007801', 'monitor-m-hu078@calibra.test', 'llave-m-78');
insert into public.materia (id, nombre, codigo) values ('10000000-0000-0000-0000-000000007801', 'Materia HU-078', 'PGTAP-78');
insert into public.certificado (id_monitor, id_materia, id_admin) values
  ('b0000000-0000-0000-0000-0000000078a0', '10000000-0000-0000-0000-000000007801', 'a0000000-0000-0000-0000-0000000078a0');
insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min) values
  ('30000000-0000-0000-0000-000000007801', 'b0000000-0000-0000-0000-0000000078a0', 1, '10:00', true, 25000, 60);
insert into public.lead (id, id_sesion_anonima, nombre, correo, acepta_tratamiento_datos, fecha_consentimiento) values
  ('40000000-0000-0000-0000-000000007801', 'c0000000-0000-0000-0000-000000007801', 'Lead Uno', 'lead-01-hu078@calibra.test', true, now());

insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado, motivo_cancelacion, fecha_finalizacion)
select ('50000000-0000-0000-0000-0000000078' || v.nn)::uuid, '30000000-0000-0000-0000-000000007801',
       '10000000-0000-0000-0000-000000007801', '40000000-0000-0000-0000-000000007801', v.fecha, 25000, v.estado, v.motivo,
       case when v.estado = 'realizada' then (v.fecha + time '11:00') at time zone 'America/Bogota' end
from (values
  ('01', date '2020-01-06', 'realizada'::public.estado_monitoria, null::public.motivo_cancelacion),
  ('02', date '2020-01-13', 'realizada', null),
  ('03', date '2020-01-20', 'cancelada', 'pago_rechazado'),
  ('04', date '2020-01-27', 'cancelada', 'estudiante'),
  ('05', date '2020-02-03', 'realizada', null),
  ('06', date '2020-02-10', 'confirmada', null),
  ('07', date '2020-02-17', 'realizada', null),
  ('08', date '2021-01-04', 'confirmada', null),
  ('21', date '2020-03-02', 'realizada', null),
  ('22', date '2020-03-09', 'realizada', null),
  ('23', date '2020-03-16', 'realizada', null),
  ('24', date '2020-03-23', 'realizada', null),
  ('25', date '2020-03-30', 'realizada', null),
  ('26', date '2020-04-06', 'realizada', null)
) as v(nn, fecha, estado, motivo);

-- Los pagos: el id es 60000000-...-000000078NNk y cada uno apunta a su propio comprobante revisado (HU-059). No hace
-- falta el archivo.
create temporary table pago_caso (nn text, k text, monto integer, estado public.estado_pago, observaciones text);
insert into pago_caso values
  ('01', 'a', 25000, 'rechazado', 'Se cobra por fuera (P-24).'), ('02', 'a', 25000, 'rechazado', 'Calibra lo asume (P-24).'),
  ('03', 'a', 25000, 'rechazado', null), ('04', 'a', 25000, 'rechazado', null),
  ('05', 'a', 25000, 'aprobado', null), ('05', 'b', 4000, 'en_revision', null),
  ('06', 'a', 25000, 'rechazado', 'Se cobra por fuera (P-24).'),
  ('07', 'a', 25000, 'en_revision', null), ('08', 'a', 25000, 'en_revision', null),
  ('21', 'a', 25000, 'aprobado', null), ('21', 'b', 10000, 'rechazado', 'Se cobra por fuera (P-24).'),
  ('22', 'a', 25000, 'rechazado', 'Calibra lo asume (P-24).'),
  ('23', 'a', 25000, 'en_revision', null), ('23', 'b', 5000, 'rechazado', 'Se cobra por fuera (P-24).'),
  ('24', 'a', 25000, 'aprobado', null), ('24', 'b', 5000, 'rechazado', 'Se cobra por fuera (P-24).'),
  ('26', 'a', 25000, 'aprobado', null), ('26', 'b', 7000, 'rechazado', 'Calibra lo asume (P-24).');

insert into public.comprobante_revisado (ruta, tipo)
select 'c0000000-0000-0000-0000-000000007801/60000000-0000-0000-0000-000000078' || nn || k || '.png', 'image/png'
from pago_caso;

insert into public.pago (id, id_monitoria, monto, nombre_pagador, contacto, estado, fecha_revision, observaciones, id_admin,
                         id_admin_revisor, comprobante)
select ('60000000-0000-0000-0000-000000078' || nn || k)::uuid, ('50000000-0000-0000-0000-0000000078' || nn)::uuid,
       monto, 'Pagador ' || nn || k, 'pagador-' || nn || k || '-hu078@calibra.test', estado,
       case when estado <> 'en_revision' then now() end, observaciones, 'a0000000-0000-0000-0000-0000000078a0',
       case when estado <> 'en_revision' then 'a0000000-0000-0000-0000-0000000078a0'::uuid end,
       'c0000000-0000-0000-0000-000000007801/60000000-0000-0000-0000-000000078' || nn || k || '.png'
from pago_caso;

-- El caso de la 26 ya lo cerró B, antes de que empezara la prueba.
update public.pago
set cierre_rechazo = 'asumido', nota_cierre = 'Lo asume Calibra.', id_admin_cierre = 'a0000000-0000-0000-0000-0000000078b0',
    fecha_cierre = timestamptz '2020-04-10 09:00-05'
where id = '60000000-0000-0000-0000-00000007826b';

insert into public.desembolso (id, id_monitoria, monto_bruto, comision, monto_neto, llave_destino)
select ('70000000-0000-0000-0000-0000000078' || v.nn)::uuid, ('50000000-0000-0000-0000-0000000078' || v.nn)::uuid,
       v.bruto, v.comision, v.bruto - v.comision, 'llave-m-78'
from (values ('21', 25000, 2500), ('22', 0, 0), ('23', 0, 0), ('24', 25000, 2500), ('25', 0, 0), ('26', 25000, 2500))
  as v(nn, bruto, comision);

insert into public.reporte_inasistencia (id_monitoria, id_admin, estado, fecha_decision) values
  ('50000000-0000-0000-0000-000000007824', 'a0000000-0000-0000-0000-0000000078a0', 'en_revision', null);

select ok(
  (select count(*) = 14 from public.monitoria where id::text like '50000000-0000-0000-0000-0000000078%')
  and (select count(*) = 18 from public.pago where id::text like '60000000-0000-0000-0000-000000078%')
  and (select count(*) = 1 from public.pago where id::text like '60000000-0000-0000-0000-000000078%' and cierre_rechazo is not null)
  and (select count(*) = 6 from public.desembolso where id::text like '70000000-0000-0000-0000-0000000078%')
  and (select banned_until > now() from auth.users where id = 'a0000000-0000-0000-0000-0000000078c0')
  -- Antes de llamar a cerrar_caso_p24 nada tiene la fila de la 05 `for update` (sí el candado de la llave foránea que
  -- tomaron sus pagos al insertarse), ni la del pago 05a.
  and not exists (
    select 1 from extensions.pgrowlocks('public.monitoria') l
    where l.locked_row = (select ctid from public.monitoria where id = '50000000-0000-0000-0000-000000007805')
      and 'For Update' = any(l.modes))
  and not exists (
    select 1 from extensions.pgrowlocks('public.pago') l
    where l.locked_row = (select ctid from public.pago where id = '60000000-0000-0000-0000-00000007805a')),
  'Control: las 14 monitorías, los 18 pagos (solo el de la 26 con su caso cerrado) y los 6 desembolsos existen, C está desactivado y nada tiene todavía la fila de la 05 ni la del pago 05a for update');

-- ---------------------------------------------------------------------------
-- Las restricciones del cierre, por fuera de la función (como postgres)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$update public.pago set cierre_rechazo = 'perdonado', id_admin_cierre = 'a0000000-0000-0000-0000-0000000078a0',
      fecha_cierre = now() where id = '60000000-0000-0000-0000-00000007802a'$$,
  '23514', null, 'Solo se cierra como cobrado o asumido (pago_cierre_rechazo_valido)');
select throws_ok(
  $$update public.pago set cierre_rechazo = 'cobrado', id_admin_cierre = 'a0000000-0000-0000-0000-0000000078a0',
      fecha_cierre = now() where id = '60000000-0000-0000-0000-00000007805a'$$,
  '23514', null, 'Un pago aprobado no tiene cierre: solo un rechazado (pago_cierre_coherente)');
select throws_ok(
  $$update public.pago set cierre_rechazo = 'cobrado', fecha_cierre = now() where id = '60000000-0000-0000-0000-00000007802a'$$,
  '23514', null, 'Ni se cierra sin decir quién');
select throws_ok(
  $$update public.pago set cierre_rechazo = 'cobrado', id_admin_cierre = 'a0000000-0000-0000-0000-0000000078a0'
    where id = '60000000-0000-0000-0000-00000007802a'$$,
  '23514', null, 'Ni sin decir cuándo');
select throws_ok(
  $$update public.pago set nota_cierre = 'Una nota' where id = '60000000-0000-0000-0000-00000007802a'$$,
  '23514', null, 'Ni hay nota sin cierre');
select throws_ok(
  $$update public.pago set cierre_rechazo = 'cobrado', id_admin_cierre = 'a0000000-0000-0000-0000-0000000078a0',
      fecha_cierre = now(), nota_cierre = E' Nota\n' where id = '60000000-0000-0000-0000-00000007802a'$$,
  '23514', null, 'La nota no tiene espacios ni saltos de línea en los bordes (pago_nota_cierre_con_texto)');
select throws_ok(
  $$update public.pago set cierre_rechazo = 'cobrado', id_admin_cierre = 'a0000000-0000-0000-0000-0000000078a0',
      fecha_cierre = now(), nota_cierre = repeat('a', 501) where id = '60000000-0000-0000-0000-00000007802a'$$,
  '23514', null, 'Ni pasa de 500 caracteres');
select lives_ok(
  $$update public.pago set cierre_rechazo = 'cobrado', id_admin_cierre = 'a0000000-0000-0000-0000-0000000078a0',
      fecha_cierre = now(), nota_cierre = repeat('é', 500) where id = '60000000-0000-0000-0000-00000007802a'$$,
  'Con 500 caracteres sí, aunque cada uno ocupe dos bytes: se cuentan caracteres');
update public.pago set cierre_rechazo = null, id_admin_cierre = null, fecha_cierre = null, nota_cierre = null
where id = '60000000-0000-0000-0000-00000007802a';

-- ---------------------------------------------------------------------------
-- Qué es un caso P-24 (supuesto 1)
-- ---------------------------------------------------------------------------
select results_eq(
  $$select privado.estado_caso_p24(v.pago, v.monitoria, v.cierre)
    from (values (1, 'rechazado'::public.estado_pago, 'realizada'::public.estado_monitoria, null::text),
                 (2, 'rechazado', 'confirmada', null),
                 (3, 'rechazado', 'realizada', 'cobrado'),
                 (4, 'rechazado', 'confirmada', 'asumido'),
                 (5, 'rechazado', 'cancelada', null),
                 (6, 'rechazado', 'cancelada', 'asumido'),
                 (7, 'aprobado', 'realizada', null),
                 (8, 'en_revision', 'realizada', null)) as v(n, pago, monitoria, cierre)
    order by v.n$$,
  $$values ('abierto'::text), ('abierto'), ('cerrado'), ('cerrado'), (null), (null), (null), (null)$$,
  'Supuesto 1: un pago rechazado de una monitoría realizada o confirmada (ya empezó) es un caso, abierto sin cierre y cerrado con él; si la monitoría está cancelada, o el pago no está rechazado, no es un caso');

-- ---------------------------------------------------------------------------
-- cerrar_caso_p24 con ahora = 31-dic-2020 12:00 en Bogotá: lo que no se cierra
-- ---------------------------------------------------------------------------
create temporary table antes as
select p.id, p.estado::text as estado, p.observaciones, p.fecha_revision, p.id_admin_revisor, p.cierre_rechazo,
       p.nota_cierre, p.id_admin_cierre, p.fecha_cierre, m.estado::text as estado_monitoria
from public.pago p join public.monitoria m on m.id = p.id_monitoria
where p.id::text like '60000000-0000-0000-0000-000000078%';

set local request.jwt.claims to '{"role":"authenticated"}';
select is(privado.cerrar_caso_p24('60000000-0000-0000-0000-00000007801a', 'cobrado', null, '2020-12-31 12:00-05'),
  'sin_sesion', 'Sin sesión (el token no trae sub): sin_sesion');
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000078a0","role":"authenticated"}';
select is(privado.cerrar_caso_p24('60000000-0000-0000-0000-00000007801a', 'cobrado', null, '2020-12-31 12:00-05'),
  'sin_permiso', 'Supuesto 2: el monitor no cierra el caso de su monitoría: sin_permiso');
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000007801","role":"authenticated","is_anonymous":true}';
select is(privado.cerrar_caso_p24('60000000-0000-0000-0000-00000007801a', 'cobrado', null, '2020-12-31 12:00-05'),
  'sin_permiso', 'Un Lead tampoco');
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000078c0","role":"authenticated"}';
select is(privado.cerrar_caso_p24('60000000-0000-0000-0000-00000007801a', 'cobrado', null, '2020-12-31 12:00-05'),
  'sin_permiso', 'RN-23: ni un admin desactivado');

-- Desde aquí el admin de la sesión es A.
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000078a0","role":"authenticated"}';
select is(
  array[
    privado.cerrar_caso_p24('60000000-0000-0000-0000-00000007801a', null, null, '2020-12-31 12:00-05'),
    privado.cerrar_caso_p24('60000000-0000-0000-0000-00000007801a', '', null, '2020-12-31 12:00-05'),
    privado.cerrar_caso_p24('60000000-0000-0000-0000-00000007801a', 'COBRADO', null, '2020-12-31 12:00-05'),
    privado.cerrar_caso_p24('60000000-0000-0000-0000-00000007801a', ' asumido', null, '2020-12-31 12:00-05'),
    privado.cerrar_caso_p24('60000000-0000-0000-0000-00000007801a', 'perdonado', null, '2020-12-31 12:00-05'),
    privado.cerrar_caso_p24('60000000-0000-0000-0000-0000000078ff', 'perdonado', repeat('a', 501), '2020-12-31 12:00-05')
  ],
  array['cierre_invalido', 'cierre_invalido', 'cierre_invalido', 'cierre_invalido', 'cierre_invalido', 'cierre_invalido'],
  'Sin cierre, vacío, en mayúsculas, con espacios u otro: cierre_invalido (antes que la nota y que buscar el pago)');
select is(
  array[
    privado.cerrar_caso_p24('60000000-0000-0000-0000-00000007801a', 'cobrado', repeat('a', 501), '2020-12-31 12:00-05'),
    privado.cerrar_caso_p24('60000000-0000-0000-0000-00000007801a', 'cobrado', E'  ' || repeat('é', 501) || E'\n', '2020-12-31 12:00-05'),
    privado.cerrar_caso_p24('60000000-0000-0000-0000-0000000078ff', 'cobrado', repeat('a', 501), '2020-12-31 12:00-05')
  ],
  array['nota_invalida', 'nota_invalida', 'nota_invalida'],
  'Supuesto 3: una nota de más de 500 caracteres, sin contar los espacios de los bordes: nota_invalida (antes de buscar el pago)');
select is(
  array[
    privado.cerrar_caso_p24('60000000-0000-0000-0000-0000000078ff', 'cobrado', null, '2020-12-31 12:00-05'),
    privado.cerrar_caso_p24(null, 'cobrado', null, '2020-12-31 12:00-05')
  ],
  array['no_encontrado', 'no_encontrado'],
  'Un pago que no existe o un id nulo: no_encontrado');
select is(
  array[
    privado.cerrar_caso_p24('60000000-0000-0000-0000-00000007803a', 'cobrado', null, '2020-12-31 12:00-05'),
    privado.cerrar_caso_p24('60000000-0000-0000-0000-00000007804a', 'asumido', null, '2020-12-31 12:00-05'),
    privado.cerrar_caso_p24('60000000-0000-0000-0000-00000007805a', 'cobrado', null, '2020-12-31 12:00-05'),
    privado.cerrar_caso_p24('60000000-0000-0000-0000-00000007805b', 'cobrado', null, '2020-12-31 12:00-05')
  ],
  array['no_es_caso', 'no_es_caso', 'no_es_caso', 'no_es_caso'],
  'Supuesto 1: el rechazado de una cita que el rechazo canceló o que el estudiante ya había cancelado no es un caso; un pago aprobado o en revisión tampoco: no_es_caso');
select ok(
  exists (
    select 1 from extensions.pgrowlocks('public.monitoria') l
    where l.locked_row = (select ctid from public.monitoria where id = '50000000-0000-0000-0000-000000007805')
      and 'For Update' = any(l.modes))
  and exists (
    select 1 from extensions.pgrowlocks('public.pago') l
    where l.locked_row = (select ctid from public.pago where id = '60000000-0000-0000-0000-00000007805a')
      and 'For Update' = any(l.modes)),
  'Aunque no sea un caso, decidió con la monitoría y el pago bloqueados for update: dos cierres, o un cierre y la ejecución del desembolso, quedan en fila');
select results_eq(
  $$select p.id, p.estado::text, p.observaciones, p.fecha_revision, p.id_admin_revisor, p.cierre_rechazo, p.nota_cierre,
           p.id_admin_cierre, p.fecha_cierre, m.estado::text
    from public.pago p join public.monitoria m on m.id = p.id_monitoria
    where p.id::text like '60000000-0000-0000-0000-000000078%' order by p.id$$,
  $$select * from antes order by id$$,
  'Ninguno de esos intentos tocó un pago ni una monitoría');

-- ---------------------------------------------------------------------------
-- Criterio 2: el admin cierra el caso; queda quién, cuándo y cómo
-- ---------------------------------------------------------------------------
select is(
  privado.cerrar_caso_p24('60000000-0000-0000-0000-00000007801a', 'cobrado', E'  Pagó por Nequi el 7-ene.\n ', '2020-12-31 12:00-05'),
  'cerrado', 'Criterio 2: A cierra el caso de la 01 como cobrado: cerrado');
select results_eq(
  $$select cierre_rechazo, nota_cierre, id_admin_cierre, fecha_cierre, estado::text, observaciones, id_admin_revisor
    from public.pago where id = '60000000-0000-0000-0000-00000007801a'$$,
  $$values ('cobrado'::text, 'Pagó por Nequi el 7-ene.'::text, 'a0000000-0000-0000-0000-0000000078a0'::uuid,
            timestamptz '2020-12-31 12:00-05', 'rechazado'::text, 'Se cobra por fuera (P-24).'::text,
            'a0000000-0000-0000-0000-0000000078a0'::uuid)$$,
  'Queda cómo (cobrado), la nota sin los espacios ni saltos de línea de los bordes, quién (A) y cuándo; el pago sigue rechazado (RN-43) con sus observaciones y su revisor');
select ok(
  exists (
    select 1 from extensions.pgrowlocks('public.monitoria') l
    where l.locked_row = (select ctid from public.monitoria where id = '50000000-0000-0000-0000-000000007801')
      and 'For Update' = any(l.modes)),
  'Cerró con la monitoría bloqueada for update, el orden de revisar_pago y ejecutar_desembolso');

set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000078b0","role":"authenticated"}';
select is(privado.cerrar_caso_p24('60000000-0000-0000-0000-00000007801a', 'asumido', 'Otra nota', '2020-12-31 13:00-05'),
  'ya_cerrado', 'D-38: B llega después y recibe ya_cerrado: un caso no se cierra dos veces');
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000078a0","role":"authenticated"}';
select is(privado.cerrar_caso_p24('60000000-0000-0000-0000-00000007801a', 'cobrado', null, '2020-12-31 13:00-05'),
  'ya_cerrado', 'Ni A lo vuelve a cerrar (un doble clic)');
select results_eq(
  $$select cierre_rechazo, nota_cierre, id_admin_cierre, fecha_cierre
    from public.pago where id = '60000000-0000-0000-0000-00000007801a'$$,
  $$values ('cobrado'::text, 'Pagó por Nequi el 7-ene.'::text, 'a0000000-0000-0000-0000-0000000078a0'::uuid,
            timestamptz '2020-12-31 12:00-05')$$,
  'Y no cambia cómo, la nota, quién ni cuándo');

set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000078b0","role":"authenticated"}';
select is(privado.cerrar_caso_p24('60000000-0000-0000-0000-00000007802a', 'asumido', E' \n\t ', '2020-12-31 15:30-05'),
  'cerrado', 'Supuesto 2: B, otro admin activo, cierra el de la 02 como asumido, con una nota en blanco');
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000078a0","role":"authenticated"}';
select is(
  privado.cerrar_caso_p24('60000000-0000-0000-0000-00000007806a', 'asumido', E'  ' || repeat('é', 500) || E'\n', '2020-12-31 12:00-05'),
  'cerrado', 'A cierra el de la 06, que sigue confirmada pero ya empezó (P-24), con una nota de 500 caracteres y espacios en los bordes');
select results_eq(
  $$select right(p.id::text, 3), p.cierre_rechazo, p.nota_cierre is null, char_length(p.nota_cierre), p.id_admin_cierre,
           p.fecha_cierre, m.estado::text
    from public.pago p join public.monitoria m on m.id = p.id_monitoria
    where p.id in ('60000000-0000-0000-0000-00000007802a', '60000000-0000-0000-0000-00000007806a') order by p.id$$,
  $$values ('02a'::text, 'asumido'::text, true, null::integer, 'a0000000-0000-0000-0000-0000000078b0'::uuid,
            timestamptz '2020-12-31 15:30-05', 'realizada'::text),
           ('06a', 'asumido', false, 500, 'a0000000-0000-0000-0000-0000000078a0', timestamptz '2020-12-31 12:00-05',
            'confirmada')$$,
  'La nota en blanco queda nula (es opcional), la de 500 queda completa, cada uno con su admin y su hora; cerrar no cambia la monitoría');

-- Por la ruta real de HU-020: A rechaza el pago de la 07, que ya se realizó (P-24), y el de la 08, que todavía no
-- empieza (RN-43: se cancela).
select results_eq(
  $$select r.resultado, r.cancelo_monitoria
    from privado.revisar_pago('60000000-0000-0000-0000-00000007807a', 'rechazar', 'Se cobra por fuera (P-24).', '2020-12-31 12:00-05') r
    union all
    select r.resultado, r.cancelo_monitoria
    from privado.revisar_pago('60000000-0000-0000-0000-00000007808a', 'rechazar', null, '2020-12-31 12:00-05') r$$,
  $$values ('rechazado'::text, false), ('rechazado', true)$$,
  'Por revisar_pago: el rechazo de la 07 (realizada) no cancela nada; el de la 08 (sin empezar) cancela la cita');
select is(
  array[
    privado.cerrar_caso_p24('60000000-0000-0000-0000-00000007808a', 'cobrado', null, '2020-12-31 12:30-05'),
    privado.cerrar_caso_p24('60000000-0000-0000-0000-00000007807a', 'cobrado', null, '2020-12-31 12:30-05')
  ],
  array['no_es_caso', 'cerrado'],
  'Supuesto 1: el rechazo que canceló la cita no deja un caso (no_es_caso); el de P-24 sí, y se cierra');

-- ---------------------------------------------------------------------------
-- Criterios 3 y 4: el desembolso, con ahora = 31-dic-2020 12:00 en Bogotá
-- ---------------------------------------------------------------------------
select results_eq(
  $$select right(d.id::text, 2), e.motivo, e.monto_neto
    from public.desembolso d
    cross join lateral privado.estado_para_ejecutar(d.id, '2020-12-31 12:00-05') e
    where d.id::text like '70000000-0000-0000-0000-0000000078%' order by d.id$$,
  $$values ('21'::text, 'caso_abierto'::text, 22500), ('22', 'caso_abierto', 0), ('23', 'pagos_en_revision', 0),
           ('24', 'con_reporte', 22500), ('25', 'sin_pagos_aprobados', 0), ('26', null, 28800)$$,
  'Criterio 4 (D-39): con un caso abierto no se puede (caso_abierto, aunque haya otro aprobado o sea el único pago); un pago en revisión y un reporte se dicen antes; sin ningún pago, sin_pagos_aprobados (supuesto 5). Criterio 3: el caso cerrado de la 26 no bloquea y cuenta en el neto (32.000 menos 3.200)');
select results_eq(
  $$select privado.bloqueo_del_desembolso(id) from public.monitoria
    where id in ('50000000-0000-0000-0000-000000007803', '50000000-0000-0000-0000-000000007804',
                 '50000000-0000-0000-0000-000000007808')
    order by id$$,
  $$values ('sin_pagos_aprobados'::text), ('sin_pagos_aprobados'), ('sin_pagos_aprobados')$$,
  'Supuesto 1: el rechazado de una cita cancelada (por el rechazo, por el estudiante o por revisar_pago) no es un caso abierto: no bloquea por caso_abierto');
select results_eq(
  $$select * from privado.calcular_desembolso('50000000-0000-0000-0000-000000007821')$$,
  $$values (25000, 2500, 22500)$$,
  'Con el caso abierto, el bruto de la 21 es solo el pago aprobado');

set local role authenticated;
select results_eq(
  $$select id_monitoria::text from public.desembolsos_ejecutables
    where id_monitoria::text like '50000000-0000-0000-0000-0000000078%' order by id_monitoria$$,
  $$values ('50000000-0000-0000-0000-000000007826'::text)$$,
  'Criterio 4: la bandeja de A (la vista, con now()) no lista los desembolsos con un caso abierto; sí el de la 26, cuyo caso está cerrado');
reset role;

select is(
  array[
    privado.ejecutar_desembolso('70000000-0000-0000-0000-000000007821', 'TRF-1', date '2020-12-31', 22500, '2020-12-31 12:00-05'),
    privado.ejecutar_desembolso('70000000-0000-0000-0000-000000007822', 'TRF-1', date '2020-12-31', 0, '2020-12-31 12:00-05')
  ],
  array['caso_abierto', 'caso_abierto'],
  'Criterio 4: al ejecutar se vuelve a validar: caso_abierto');
select results_eq(
  $$select right(id::text, 2), estado::text, id_admin, monto_bruto, comision, monto_neto
    from public.desembolso where id in ('70000000-0000-0000-0000-000000007821', '70000000-0000-0000-0000-000000007822')
    order by id$$,
  $$values ('21'::text, 'pendiente'::text, null::uuid, 25000, 2500, 22500), ('22', 'pendiente', null, 0, 0, 0)$$,
  'Y no se tocó ninguno de los dos');

select is(privado.cerrar_caso_p24('60000000-0000-0000-0000-00000007821b', 'cobrado', null, '2020-12-31 12:00-05'),
  'cerrado', 'A cierra el caso de la 21 como cobrado, después de que la monitoría se realizó (supuesto 4)');
select results_eq(
  $$select * from privado.calcular_desembolso('50000000-0000-0000-0000-000000007821')$$,
  $$values (35000, 3500, 31500)$$,
  'Criterio 3 (D-39, P-14): cerrado, el bruto suma el aprobado y el cobrado (35.000), con la comisión de RN-81 sobre ese total');
select results_eq(
  $$select motivo, monto_neto from privado.estado_para_ejecutar('70000000-0000-0000-0000-000000007821', '2020-12-31 12:00-05')$$,
  $$values (null::text, 31500)$$,
  'Ya se puede ejecutar, con el neto recalculado (P-29)');
set local role authenticated;
select results_eq(
  $$select id_monitoria::text, monto_neto from public.desembolsos_ejecutables
    where id_monitoria::text like '50000000-0000-0000-0000-0000000078%' order by id_monitoria$$,
  $$values ('50000000-0000-0000-0000-000000007821'::text, 22500), ('50000000-0000-0000-0000-000000007826', 22500)$$,
  'Y la bandeja ya lo lista (con el neto de la foto, como todos: el que se transfiere se recalcula al ejecutar)');
reset role;
select is(
  privado.ejecutar_desembolso('70000000-0000-0000-0000-000000007821', 'TRF-2178', date '2020-12-31', 22500, '2020-12-31 12:00-05'),
  'monto_cambio', 'P-29: si el admin vio el neto de antes del cierre (22.500), monto_cambio');
select is(
  privado.ejecutar_desembolso('70000000-0000-0000-0000-000000007821', 'TRF-2178', date '2020-12-31', 31500, '2020-12-31 12:00-05'),
  'desembolsado', 'Con el neto de ahora (31.500), A ejecuta el de la 21');
select results_eq(
  $$select estado::text, id_admin, referencia_transferencia, monto_bruto, comision, monto_neto
    from public.desembolso where id = '70000000-0000-0000-0000-000000007821'$$,
  $$values ('desembolsado'::text, 'a0000000-0000-0000-0000-0000000078a0'::uuid, 'TRF-2178'::text, 35000, 3500, 31500)$$,
  'Criterio 3: queda desembolsado con los montos que incluyen el pago cobrado por fuera');

-- ---------------------------------------------------------------------------
-- Las puertas públicas, con la hora real (las monitorías son de 2020)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000078b0","role":"authenticated"}';
select results_eq(
  $$select motivo, monto_neto from public.estado_para_ejecutar('70000000-0000-0000-0000-000000007822')$$,
  $$values ('caso_abierto'::text, 0)$$,
  'Criterio 4 por la puerta: B ve que el de la 22 espera a que se cierre el caso');
select throws_ok(
  $$update public.pago set cierre_rechazo = 'asumido', id_admin_cierre = 'a0000000-0000-0000-0000-0000000078b0',
      fecha_cierre = now() where id = '60000000-0000-0000-0000-00000007822a'$$,
  '42501', null, 'Ni el admin con sesión escribe el cierre directo en la Data API: permiso denegado');
select is(public.cerrar_caso_p24('60000000-0000-0000-0000-00000007822a', 'asumido', null), 'cerrado',
  'Criterio 2 por la puerta: B cierra el caso de la 22 como asumido, sin nota');
select results_eq(
  $$select cierre_rechazo, nota_cierre, id_admin_cierre, fecha_cierre = now()
    from public.pago where id = '60000000-0000-0000-0000-00000007822a'$$,
  $$values ('asumido'::text, null::text, 'a0000000-0000-0000-0000-0000000078b0'::uuid, true)$$,
  'Queda con el id de B (auth.uid()) y la hora de la base');
select results_eq(
  $$select motivo, monto_neto from public.estado_para_ejecutar('70000000-0000-0000-0000-000000007822')$$,
  $$values (null::text, 22500)$$,
  'Criterio 3: asumido también cuenta: el de la 22, que no tenía ningún pago aprobado, ya se ejecuta con 22.500');
select is(
  public.ejecutar_desembolso('70000000-0000-0000-0000-000000007822', 'TRF-2278', (now() at time zone 'America/Bogota')::date, 22500),
  'desembolsado', 'B lo ejecuta por la puerta');
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000078a0","role":"authenticated"}';
select is(public.cerrar_caso_p24('60000000-0000-0000-0000-00000007823b', 'cobrado', null), 'sin_permiso',
  'Por la puerta, el monitor: sin_permiso');
set local request.jwt.claims to '{"role":"authenticated"}';
select is(public.cerrar_caso_p24('60000000-0000-0000-0000-00000007823b', 'cobrado', null), 'sin_sesion',
  'Y sin sesión: sin_sesion');
reset role;
select results_eq(
  $$select d.estado::text, d.id_admin, d.monto_bruto, d.comision, d.monto_neto, p.cierre_rechazo
    from public.desembolso d, public.pago p
    where d.id = '70000000-0000-0000-0000-000000007822' and p.id = '60000000-0000-0000-0000-00000007823b'$$,
  $$values ('desembolsado'::text, 'a0000000-0000-0000-0000-0000000078b0'::uuid, 25000, 2500, 22500, null::text)$$,
  'El de la 22 quedó desembolsado por B con 25.000 de bruto; el monitor y la llamada sin sesión no cerraron el de la 23');

-- ---------------------------------------------------------------------------
-- La foto del trigger de HU-028 cuenta un caso ya cerrado
-- ---------------------------------------------------------------------------
update public.monitoria set estado = 'realizada', fecha_finalizacion = now()
where id = '50000000-0000-0000-0000-000000007806';
select results_eq(
  $$select estado::text, monto_bruto, comision, monto_neto, llave_destino
    from public.desembolso where id_monitoria = '50000000-0000-0000-0000-000000007806'$$,
  $$values ('pendiente'::text, 25000, 2500, 22500, 'llave-m-78'::text)$$,
  'Al pasar a realizada, la 06 nace con su desembolso y una foto que cuenta el caso que A ya cerró como asumido');

select * from finish();
rollback;
