-- Pruebas pgTAP de los desembolsos: se crean al pasar a realizada y un admin los ejecuta (HU-028).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos. Los procesos de pg_cron (cierre automático y
-- expiración de reservas) no ven estas filas.
--
-- Tres grupos de monitorías:
--   * El trigger, por los dos caminos reales: el monitor finaliza con public.finalizar_monitoria (usa now(); esas
--     monitorías empiezan 2 h antes de now()) y el cierre automático con privado.cerrar_monitorias_sin_finalizar y un
--     ahora fijo en junio de 2019: así ninguna otra monitoría de la base local queda alcanzada y el conteo es exacto.
--   * estado_para_ejecutar y ejecutar_desembolso con su p_ahora, como postgres y con el token del admin puesto
--     (auth.uid() lo lee sin importar el rol). Son de lunes de 2031 y se insertan ya realizadas, con su desembolso a
--     mano (el trigger es solo de UPDATE): cada caso tiene la foto de montos que necesita. ahora = miércoles
--     31-dic-2031 12:00 en Bogotá, salvo en el borde de N-6.
--   * Las puertas públicas, con now(), sobre una monitoría de 2020 y otra que terminó hace una hora: ninguna prueba
--     compara now() con una fecha fija que algún día quede atrás.
-- Dos admins que ejecutan a la vez no caben en una transacción: los cubre la prueba de integración.
--
-- Elenco (ids terminados en 28NN; la materia es 'PGTAP-28'):
--   Admins: A (ejecuta), B (otro admin activo) y C (desactivado). Monitor M, con su llave 'llave-m-28', y monitor N, sin
--   monitor_privado. Lead 01 con su sesión anónima. Los pagos los revisó A.
--   El trigger (de M salvo la 06):
--     01 confirmada que empezó hace 2 h: un pago aprobado de 25.000, uno rechazado y uno en revisión
--     02 grupal confirmada que empezó hace 2 h, con un pago aprobado
--     03 insertada ya realizada, con un pago aprobado
--     04 confirmada del lunes 10-jun-2019 (cierre automático), con un pago aprobado de 200.000 (comisión en el tope)
--     05 confirmada que empezó hace 2 h, sin pagos          06 de N, confirmada, que empezó hace 2 h
--   Ejecutar (de M, franja de los lunes de 10:00 a 11:00; el desembolso 70000000-...-0000000028NN es el de la monitoría
--   NN y su foto dice neto 22.500 salvo que se diga otra cosa):
--     21 con su único pago en revisión (la foto dice 0); el pago se aprueba a mitad de la prueba
--     22 con un reporte en revisión    23 con un reporte aceptado    24 con un reporte rechazado
--     25 un pago aprobado y otro en revisión      26 con el único pago rechazado (P-24), el caso abierto (HU-078)
--     27 anulado: monitoría cancelada por monitor_no_asistio y reporte aceptado (D-37)
--     28 ya desembolsado por B (con una foto de neto 18.000)
--     29 pendiente, pero la monitoría está cancelada y sin reporte (defensa)
--     30 la del lunes 29-dic-2031: su fin + 24 h es el martes 30 a las 11:00 (borde de N-6)
--     31 un pago aprobado de 30.000 (neto 27.000) y la foto de 22.500, para monto_cambio
--     32 la del lunes 1-jun-2020, para las puertas públicas con now()
--     33 realizada, que empezó 2 h antes de now() y terminó hace una hora (su propia franja), con un pago aprobado y un
--        reporte en revisión: con now(), su fin + 24 h siempre queda 23 h adelante (la puerta dice antes_de_plazo)
--     34 realizada y sin ningún pago (la foto dice 0), para sin_pagos_aprobados (HU-078)

begin;
create extension if not exists pgtap with schema extensions;

select plan(90);

-- ---------------------------------------------------------------------------
-- Estructura y permisos
-- ---------------------------------------------------------------------------
select has_function('privado', 'calcular_desembolso', array['uuid'],
  'Existe privado.calcular_desembolso, la única fuente de bruto, comisión y neto');
select has_function('privado', 'crear_desembolso_al_realizar', '{}'::name[],
  'Existe privado.crear_desembolso_al_realizar, la función del trigger');
select has_function('privado', 'estado_para_ejecutar', array['uuid', 'timestamp with time zone'],
  'Existe privado.estado_para_ejecutar, con la hora como parámetro (para probar el borde de N-6)');
select has_function('privado', 'estado_para_ejecutar_de_la_sesion', array['uuid'],
  'Existe privado.estado_para_ejecutar_de_la_sesion, la que consulta la sesión con la hora de la base');
select has_function('public', 'estado_para_ejecutar', array['uuid'],
  'Existe su puerta en la Data API');
select has_function('privado', 'ejecutar_desembolso', array['uuid', 'text', 'date', 'integer', 'timestamp with time zone'],
  'Existe privado.ejecutar_desembolso, la que escribe en desembolso');
select has_function('privado', 'ejecutar_desembolso_de_la_sesion', array['uuid', 'text', 'date', 'integer'],
  'Existe privado.ejecutar_desembolso_de_la_sesion, la que ejecuta la sesión con la hora de la base');
select has_function('public', 'ejecutar_desembolso', array['uuid', 'text', 'date', 'integer'],
  'Existe su puerta en la Data API');
select has_function('privado', 'bloqueo_del_desembolso', array['uuid'],
  'Existe privado.bloqueo_del_desembolso, lo que bloquea por la monitoría: la usan estado_para_ejecutar y la vista de la bandeja');
select ok(
  (select bool_and(prosecdef) from pg_proc
   where oid in ('privado.calcular_desembolso(uuid)'::regprocedure,
                 'privado.crear_desembolso_al_realizar()'::regprocedure,
                 'privado.estado_para_ejecutar(uuid, timestamptz)'::regprocedure,
                 'privado.estado_para_ejecutar_de_la_sesion(uuid)'::regprocedure,
                 'privado.ejecutar_desembolso(uuid, text, date, integer, timestamptz)'::regprocedure,
                 'privado.ejecutar_desembolso_de_la_sesion(uuid, text, date, integer)'::regprocedure))
  and not (select bool_or(prosecdef) from pg_proc
           where oid in ('public.estado_para_ejecutar(uuid)'::regprocedure,
                         'public.ejecutar_desembolso(uuid, text, date, integer)'::regprocedure)),
  'Las de privado son security definer (calculan la comisión y escriben en desembolso); las puertas corren con los permisos de quien llama');
select ok(
  (select bool_and('search_path=""' = any(proconfig)) from pg_proc
   where oid in ('privado.calcular_desembolso(uuid)'::regprocedure,
                 'privado.crear_desembolso_al_realizar()'::regprocedure,
                 'privado.estado_para_ejecutar(uuid, timestamptz)'::regprocedure,
                 'privado.estado_para_ejecutar_de_la_sesion(uuid)'::regprocedure,
                 'public.estado_para_ejecutar(uuid)'::regprocedure,
                 'privado.ejecutar_desembolso(uuid, text, date, integer, timestamptz)'::regprocedure,
                 'privado.ejecutar_desembolso_de_la_sesion(uuid, text, date, integer)'::regprocedure,
                 'public.ejecutar_desembolso(uuid, text, date, integer)'::regprocedure)),
  'Todas fijan un search_path vacío');
select is(
  array[pg_get_function_identity_arguments('public.estado_para_ejecutar(uuid)'::regprocedure),
        pg_get_function_identity_arguments('public.ejecutar_desembolso(uuid, text, date, integer)'::regprocedure)],
  array['p_id_desembolso uuid', 'p_id_desembolso uuid, p_referencia text, p_fecha date, p_neto_esperado integer'],
  'Las puertas no reciben el admin ni la hora: nadie ejecuta a nombre de otro ni mueve el borde de N-6');
select is(
  array[pg_get_function_result('public.estado_para_ejecutar(uuid)'::regprocedure),
        pg_get_function_result('public.ejecutar_desembolso(uuid, text, date, integer)'::regprocedure),
        pg_get_function_result('privado.calcular_desembolso(uuid)'::regprocedure)],
  array['TABLE(motivo text, monto_neto integer)', 'text',
        'TABLE(monto_bruto integer, comision integer, monto_neto integer)'],
  'Supuesto 4: la sesión recibe el motivo y el neto, nunca el bruto ni la comisión (esos solo salen de calcular_desembolso, sin grant)');
select ok(
  not has_function_privilege('anon', 'public.estado_para_ejecutar(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.ejecutar_desembolso(uuid, text, date, integer)', 'execute')
  and not has_function_privilege('anon', 'privado.estado_para_ejecutar_de_la_sesion(uuid)', 'execute')
  and not has_function_privilege('anon', 'privado.ejecutar_desembolso_de_la_sesion(uuid, text, date, integer)', 'execute')
  and not has_function_privilege('anon', 'privado.estado_para_ejecutar(uuid, timestamptz)', 'execute')
  and not has_function_privilege('anon', 'privado.ejecutar_desembolso(uuid, text, date, integer, timestamptz)', 'execute')
  and not has_function_privilege('anon', 'privado.calcular_desembolso(uuid)', 'execute')
  and not has_function_privilege('anon', 'privado.crear_desembolso_al_realizar()', 'execute'),
  'Sin sesión (anon) no se consulta ni se ejecuta nada');
select ok(
  has_function_privilege('authenticated', 'public.estado_para_ejecutar(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.ejecutar_desembolso(uuid, text, date, integer)', 'execute')
  and has_function_privilege('authenticated', 'privado.estado_para_ejecutar_de_la_sesion(uuid)', 'execute')
  and has_function_privilege('authenticated', 'privado.ejecutar_desembolso_de_la_sesion(uuid, text, date, integer)', 'execute'),
  'Con sesión sí, por las que usan now()');
select ok(
  not has_function_privilege('authenticated', 'privado.estado_para_ejecutar(uuid, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'privado.ejecutar_desembolso(uuid, text, date, integer, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'privado.calcular_desembolso(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'privado.crear_desembolso_al_realizar()', 'execute'),
  'Las que reciben la hora, la que calcula la comisión y la del trigger son internas');
select ok(
  not has_function_privilege('service_role', 'public.estado_para_ejecutar(uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.ejecutar_desembolso(uuid, text, date, integer)', 'execute')
  and not has_function_privilege('service_role', 'privado.estado_para_ejecutar_de_la_sesion(uuid)', 'execute')
  and not has_function_privilege('service_role', 'privado.ejecutar_desembolso_de_la_sesion(uuid, text, date, integer)', 'execute')
  and not has_function_privilege('service_role', 'privado.estado_para_ejecutar(uuid, timestamptz)', 'execute')
  and not has_function_privilege('service_role', 'privado.ejecutar_desembolso(uuid, text, date, integer, timestamptz)', 'execute')
  and not has_function_privilege('service_role', 'privado.calcular_desembolso(uuid)', 'execute')
  and not has_function_privilege('service_role', 'privado.crear_desembolso_al_realizar()', 'execute'),
  'service_role no ejecuta ninguna: sin sesión no hay admin');
select ok(
  not exists (
    select 1
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid in ('privado.calcular_desembolso(uuid)'::regprocedure,
                    'privado.crear_desembolso_al_realizar()'::regprocedure,
                    'privado.estado_para_ejecutar(uuid, timestamptz)'::regprocedure,
                    'privado.estado_para_ejecutar_de_la_sesion(uuid)'::regprocedure,
                    'public.estado_para_ejecutar(uuid)'::regprocedure,
                    'privado.ejecutar_desembolso(uuid, text, date, integer, timestamptz)'::regprocedure,
                    'privado.ejecutar_desembolso_de_la_sesion(uuid, text, date, integer)'::regprocedure,
                    'public.ejecutar_desembolso(uuid, text, date, integer)'::regprocedure)
      and a.grantee = 0),
  'Nadie las hereda de PUBLIC');
-- La vista desembolsos_ejecutables es security_invoker: quien la consulta ejecuta la función, que lee con sus permisos.
select ok(
  not (select prosecdef from pg_proc where oid = 'privado.bloqueo_del_desembolso(uuid)'::regprocedure)
  and (select 'search_path=""' = any(proconfig) from pg_proc where oid = 'privado.bloqueo_del_desembolso(uuid)'::regprocedure)
  and has_function_privilege('authenticated', 'privado.bloqueo_del_desembolso(uuid)', 'execute')
  and has_function_privilege('service_role', 'privado.bloqueo_del_desembolso(uuid)', 'execute')
  and not has_function_privilege('anon', 'privado.bloqueo_del_desembolso(uuid)', 'execute')
  and not exists (
    select 1
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = 'privado.bloqueo_del_desembolso(uuid)'::regprocedure and a.grantee = 0),
  'bloqueo_del_desembolso corre con los permisos de quien llama (security invoker, search_path vacío): la ejecutan authenticated y service_role, que consultan la vista; anon y PUBLIC no');
select has_trigger('public', 'monitoria', 'monitoria_crea_desembolso',
  'Existe el trigger monitoria_crea_desembolso en monitoria');
select matches(
  (select pg_get_triggerdef(t.oid) from pg_trigger t
   where t.tgrelid = 'public.monitoria'::regclass and t.tgname = 'monitoria_crea_desembolso'),
  'AFTER UPDATE OF estado ON public\.monitoria FOR EACH ROW WHEN .*realizada.* EXECUTE FUNCTION privado\.crear_desembolso_al_realizar\(\)',
  'Es after update of estado (no de INSERT), por fila y solo cuando pasa a realizada');
select ok(
  not has_any_column_privilege('authenticated', 'public.desembolso', 'insert')
  and not has_any_column_privilege('authenticated', 'public.desembolso', 'update')
  and not has_table_privilege('authenticated', 'public.desembolso', 'delete'),
  'Sigue igual: nadie con sesión escribe en desembolso; solo el trigger y la función');

-- Sin permiso ni se ejecutan.
set local role anon;
select throws_ok(
  $$select public.ejecutar_desembolso('70000000-0000-0000-0000-000000002832', 'TRF-1', date '2031-12-31', null)$$,
  '42501', null, 'anon no puede llamar a ejecutar_desembolso: permiso denegado');
select throws_ok($$select * from public.estado_para_ejecutar('70000000-0000-0000-0000-000000002832')$$,
  '42501', null, 'Ni a estado_para_ejecutar');
reset role;
set local role service_role;
select throws_ok(
  $$select public.ejecutar_desembolso('70000000-0000-0000-0000-000000002832', 'TRF-1', date '2031-12-31', null)$$,
  '42501', null, 'service_role tampoco: no es un admin con sesión');
reset role;
set local role authenticated;
select throws_ok(
  $$select privado.ejecutar_desembolso('70000000-0000-0000-0000-000000002832', 'TRF-1', date '2031-12-31', null, now())$$,
  '42501', null, 'Una sesión no llama a la versión que recibe la hora: permiso denegado');
select throws_ok($$select * from privado.estado_para_ejecutar('70000000-0000-0000-0000-000000002832', now())$$,
  '42501', null, 'Ni a la de estado_para_ejecutar que recibe la hora');
select throws_ok($$select * from privado.calcular_desembolso('50000000-0000-0000-0000-000000002832')$$,
  '42501', null, 'Ni a calcular_desembolso: la comisión solo la calcula el servidor (N-2)');
reset role;

-- ---------------------------------------------------------------------------
-- Fixtures (como postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, is_anonymous, banned_until) values
  ('a0000000-0000-0000-0000-0000000028a0', false, null),
  ('a0000000-0000-0000-0000-0000000028b0', false, null),
  ('a0000000-0000-0000-0000-0000000028c0', false, now() + interval '100 years'),
  ('b0000000-0000-0000-0000-0000000028a0', false, null),
  ('b0000000-0000-0000-0000-0000000028b0', false, null),
  ('c0000000-0000-0000-0000-000000002801', true, null);

insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-0000000028a0', 'Admin A', 'admin-a-hu028@calibra.test', 9002801),
  ('a0000000-0000-0000-0000-0000000028b0', 'Admin B', 'admin-b-hu028@calibra.test', 9002802),
  ('a0000000-0000-0000-0000-0000000028c0', 'Admin C', 'admin-c-hu028@calibra.test', 9002803);
insert into public.monitor (id, nombre) values
  ('b0000000-0000-0000-0000-0000000028a0', 'Monitor M'),
  ('b0000000-0000-0000-0000-0000000028b0', 'Monitor N');
insert into public.monitor_privado (id_monitor, numero_telefono, correo, llave) values
  ('b0000000-0000-0000-0000-0000000028a0', '3000002801', 'monitor-m-hu028@calibra.test', 'llave-m-28');
insert into public.materia (id, nombre, codigo) values ('10000000-0000-0000-0000-000000002801', 'Materia HU-028', 'PGTAP-28');
insert into public.certificado (id_monitor, id_materia, id_admin) values
  ('b0000000-0000-0000-0000-0000000028a0', '10000000-0000-0000-0000-000000002801', 'a0000000-0000-0000-0000-0000000028a0'),
  ('b0000000-0000-0000-0000-0000000028b0', '10000000-0000-0000-0000-000000002801', 'a0000000-0000-0000-0000-0000000028a0');
insert into public.lead (id, id_sesion_anonima, nombre, correo, acepta_tratamiento_datos, fecha_consentimiento) values
  ('40000000-0000-0000-0000-000000002801', 'c0000000-0000-0000-0000-000000002801', 'Lead Uno', 'lead-01-hu028@calibra.test', true, now());

-- El trigger: cada caso con su propia franja, construida desde su inicio en la zona de Bogotá (como en
-- finalizar_monitoria.test.sql), para que la monitoría empiece exactamente en ese instante.
create temporary table caso (
  nn text primary key,
  id_monitor uuid not null,
  inicio timestamptz not null,
  estado public.estado_monitoria not null,
  finalizada timestamptz,
  grupal boolean not null default false
);
insert into caso (nn, id_monitor, inicio, estado, finalizada, grupal) values
  ('01', 'b0000000-0000-0000-0000-0000000028a0', now() - interval '2 hours', 'confirmada', null, false),
  ('02', 'b0000000-0000-0000-0000-0000000028a0', now() - interval '2 hours', 'confirmada', null, true),
  ('03', 'b0000000-0000-0000-0000-0000000028a0', now() - interval '3 hours', 'realizada', now() - interval '90 minutes', false),
  ('04', 'b0000000-0000-0000-0000-0000000028a0', timestamptz '2019-06-10 10:00-05', 'confirmada', null, false),
  ('05', 'b0000000-0000-0000-0000-0000000028a0', now() - interval '2 hours', 'confirmada', null, false),
  ('06', 'b0000000-0000-0000-0000-0000000028b0', now() - interval '2 hours', 'confirmada', null, false);

insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min)
select ('30000000-0000-0000-0000-0000000028' || c.nn)::uuid, c.id_monitor,
       extract(isodow from c.inicio at time zone 'America/Bogota')::smallint,
       (c.inicio at time zone 'America/Bogota')::time, true, 25000, 60
from caso c;

insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado, fecha_finalizacion)
select ('50000000-0000-0000-0000-0000000028' || c.nn)::uuid, ('30000000-0000-0000-0000-0000000028' || c.nn)::uuid,
       '10000000-0000-0000-0000-000000002801', '40000000-0000-0000-0000-000000002801',
       (c.inicio at time zone 'America/Bogota')::date, 25000, c.estado, c.finalizada
from caso c;

insert into public.monitoria_grupal (id_monitoria, cupos, modalidad_pago, precio_por_persona) values
  ('50000000-0000-0000-0000-000000002802', 3, 'dividido', 15000);

-- Ejecutar: todas en la franja de los lunes de 10:00 a 11:00 de M.
insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min) values
  ('30000000-0000-0000-0000-000000002820', 'b0000000-0000-0000-0000-0000000028a0', 1, '10:00', true, 25000, 60);

insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado, motivo_cancelacion, fecha_finalizacion)
select ('50000000-0000-0000-0000-0000000028' || v.nn)::uuid, '30000000-0000-0000-0000-000000002820',
       '10000000-0000-0000-0000-000000002801', '40000000-0000-0000-0000-000000002801', v.fecha, 25000,
       v.estado, v.motivo, (v.fecha + time '11:00') at time zone 'America/Bogota'
from (values
  ('21', date '2031-01-06', 'realizada'::public.estado_monitoria, null::public.motivo_cancelacion),
  ('22', date '2031-01-13', 'realizada', null),
  ('23', date '2031-01-20', 'realizada', null),
  ('24', date '2031-01-27', 'realizada', null),
  ('25', date '2031-02-03', 'realizada', null),
  ('26', date '2031-02-10', 'realizada', null),
  ('27', date '2031-02-17', 'cancelada', 'monitor_no_asistio'),
  ('28', date '2031-02-24', 'realizada', null),
  ('29', date '2031-03-03', 'cancelada', 'monitor_no_asistio'),
  ('30', date '2031-12-29', 'realizada', null),
  ('31', date '2031-03-10', 'realizada', null),
  ('32', date '2020-06-01', 'realizada', null),
  ('34', date '2031-03-17', 'realizada', null)
) as v(nn, fecha, estado, motivo);

-- La 33, para la puerta con now(): empezó 2 h antes de now() y dura 60 min, en su propia franja construida desde su
-- inicio en Bogotá (como las del trigger).
insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min)
select '30000000-0000-0000-0000-000000002833', 'b0000000-0000-0000-0000-0000000028a0',
       extract(isodow from t.inicio at time zone 'America/Bogota')::smallint, (t.inicio at time zone 'America/Bogota')::time,
       true, 25000, 60
from (select now() - interval '2 hours' as inicio) t;
insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado, fecha_finalizacion)
select '50000000-0000-0000-0000-000000002833', '30000000-0000-0000-0000-000000002833',
       '10000000-0000-0000-0000-000000002801', '40000000-0000-0000-0000-000000002801',
       (t.inicio at time zone 'America/Bogota')::date, 25000, 'realizada', now() - interval '1 hour'
from (select now() - interval '2 hours' as inicio) t;

-- Los pagos: el id es 60000000-...-000000028NNk (k = a, b, c) y cada uno apunta a su propio comprobante revisado
-- (HU-059). No hace falta el archivo.
create temporary table pago_caso (nn text, k text, monto integer, estado public.estado_pago, observaciones text);
insert into pago_caso values
  ('01', 'a', 25000, 'aprobado', null), ('01', 'b', 9000, 'rechazado', null), ('01', 'c', 4000, 'en_revision', null),
  ('02', 'a', 30000, 'aprobado', null), ('03', 'a', 25000, 'aprobado', null), ('04', 'a', 200000, 'aprobado', null),
  ('21', 'a', 25000, 'en_revision', null), ('22', 'a', 25000, 'aprobado', null), ('23', 'a', 25000, 'aprobado', null),
  ('24', 'a', 25000, 'aprobado', null), ('25', 'a', 25000, 'aprobado', null), ('25', 'b', 5000, 'en_revision', null),
  ('26', 'a', 25000, 'rechazado', 'Se cobra por fuera (P-24).'), ('27', 'a', 25000, 'aprobado', null),
  ('28', 'a', 25000, 'aprobado', null), ('29', 'a', 25000, 'aprobado', null), ('30', 'a', 25000, 'aprobado', null),
  ('31', 'a', 30000, 'aprobado', null), ('32', 'a', 25000, 'aprobado', null), ('33', 'a', 25000, 'aprobado', null);

insert into public.comprobante_revisado (ruta, tipo)
select 'c0000000-0000-0000-0000-000000002801/60000000-0000-0000-0000-000000028' || nn || k || '.png', 'image/png'
from pago_caso;

insert into public.pago (id, id_monitoria, monto, nombre_pagador, contacto, estado, fecha_revision, observaciones, id_admin, comprobante)
select ('60000000-0000-0000-0000-000000028' || nn || k)::uuid, ('50000000-0000-0000-0000-0000000028' || nn)::uuid,
       monto, 'Pagador ' || nn || k, 'pagador-' || nn || k || '-hu028@calibra.test', estado,
       case when estado <> 'en_revision' then now() end, observaciones, 'a0000000-0000-0000-0000-0000000028a0',
       'c0000000-0000-0000-0000-000000002801/60000000-0000-0000-0000-000000028' || nn || k || '.png'
from pago_caso;

insert into public.desembolso (id, id_monitoria, monto_bruto, comision, monto_neto, llave_destino, estado, id_admin,
                               fecha_desembolso, referencia_transferencia)
select ('70000000-0000-0000-0000-0000000028' || v.nn)::uuid, ('50000000-0000-0000-0000-0000000028' || v.nn)::uuid,
       v.bruto, v.comision, v.bruto - v.comision, 'llave-m-28', v.estado, v.id_admin::uuid, v.fecha, v.referencia
from (values
  ('21', 0, 0, 'pendiente'::public.estado_desembolso, null, null::timestamptz, null),
  ('22', 25000, 2500, 'pendiente', null, null, null),
  ('23', 25000, 2500, 'pendiente', null, null, null),
  ('24', 25000, 2500, 'pendiente', null, null, null),
  ('25', 25000, 2500, 'pendiente', null, null, null),
  ('26', 25000, 2500, 'pendiente', null, null, null),
  ('27', 25000, 2500, 'anulado', null, null, null),
  ('28', 20000, 2000, 'desembolsado', 'a0000000-0000-0000-0000-0000000028b0', timestamptz '2031-03-01 12:00-05', 'TRF-B-2828'),
  ('29', 25000, 2500, 'pendiente', null, null, null),
  ('30', 25000, 2500, 'pendiente', null, null, null),
  ('31', 25000, 2500, 'pendiente', null, null, null),
  ('32', 25000, 2500, 'pendiente', null, null, null),
  ('33', 25000, 2500, 'pendiente', null, null, null),
  ('34', 0, 0, 'pendiente', null, null, null)
) as v(nn, bruto, comision, estado, id_admin, fecha, referencia);

insert into public.reporte_inasistencia (id_monitoria, id_admin, estado, fecha_decision) values
  ('50000000-0000-0000-0000-000000002822', 'a0000000-0000-0000-0000-0000000028a0', 'en_revision', null),
  ('50000000-0000-0000-0000-000000002823', 'a0000000-0000-0000-0000-0000000028a0', 'aceptado', now()),
  ('50000000-0000-0000-0000-000000002824', 'a0000000-0000-0000-0000-0000000028a0', 'rechazado', now()),
  ('50000000-0000-0000-0000-000000002827', 'a0000000-0000-0000-0000-0000000028a0', 'aceptado', now()),
  ('50000000-0000-0000-0000-000000002833', 'a0000000-0000-0000-0000-0000000028a0', 'en_revision', null);

select ok(
  (select count(*) = 20 from public.monitoria where id::text like '50000000-0000-0000-0000-0000000028%')
  and (select count(*) = 0 from public.desembolso where id_monitoria::text like '50000000-0000-0000-0000-00000000280%')
  and (select count(*) = 14 from public.desembolso where id::text like '70000000-0000-0000-0000-0000000028%')
  and (select count(*) = 20 from public.pago where id::text like '60000000-0000-0000-0000-000000028%')
  and (select public.inicio_sesion(m.fecha, f.hora) = timestamptz '2031-12-29 10:00-05'
       from public.monitoria m join public.franja f on f.id = m.id_franja
       where m.id = '50000000-0000-0000-0000-000000002830')
  and (select desembolsable_desde - now() = interval '23 hours'
       from public.monitoria_plazos where id_monitoria = '50000000-0000-0000-0000-000000002833')
  and (select banned_until > now() from auth.users where id = 'a0000000-0000-0000-0000-0000000028c0'),
  'Control: las 20 monitorías y los 20 pagos existen, las del trigger aún no tienen desembolso y las de ejecutar sí (14), la 30 empieza el 29-dic-2031 a las 10:00 en Bogotá, el fin + 24 h de la 33 queda 23 h después de now() y C está desactivado');

-- ---------------------------------------------------------------------------
-- Criterio 1 (RN-80): al pasar a realizada nace el desembolso pendiente
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000028a0","role":"authenticated"}';
select is((select public.finalizar_monitoria('50000000-0000-0000-0000-000000002801')), 'finalizada',
  'El monitor finaliza la 01 por la ruta real (public.finalizar_monitoria)');
reset role;
select results_eq(
  $$select estado::text, monto_bruto, comision, monto_neto, llave_destino, id_admin, referencia_transferencia,
           fecha_desembolso, fecha_generacion = now()
    from public.desembolso where id_monitoria = '50000000-0000-0000-0000-000000002801'$$,
  $$values ('pendiente'::text, 25000, 2500, 22500, 'llave-m-28'::text, null::uuid, null::text, null::timestamptz, true)$$,
  'Criterio 1: nace pendiente, con la foto de los pagos aprobados (25.000: ni el rechazado ni el que está en revisión), la comisión de RN-81, el neto y la llave del monitor; sin admin, referencia ni fecha');

set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000028a0","role":"authenticated"}';
select is((select public.finalizar_monitoria('50000000-0000-0000-0000-000000002802')), 'finalizada',
  'El monitor también finaliza la grupal 02');
reset role;
select is(
  (select count(*)::int from public.desembolso where id_monitoria = '50000000-0000-0000-0000-000000002802'),
  0, 'Supuesto 6: la grupal no genera desembolso (llega con HU-036, HU-038 y HU-046)');
select is(
  (select count(*)::int from public.desembolso where id_monitoria = '50000000-0000-0000-0000-000000002803'),
  0, 'Una monitoría que se insertó ya realizada no tiene desembolso: el trigger es solo de UPDATE');
update public.monitoria set estado = 'realizada', fecha_finalizacion = now() where id = '50000000-0000-0000-0000-000000002803';
select is(
  (select count(*)::int from public.desembolso where id_monitoria = '50000000-0000-0000-0000-000000002803'),
  0, 'Ni lo crea un UPDATE que no cambia el estado (realizada sobre realizada)');

-- El otro camino: el cierre automático, con ahora = miércoles 12-jun-2019 12:00 en Bogotá.
select is(privado.cerrar_monitorias_sin_finalizar(timestamptz '2019-06-12 12:00-05'), 1,
  'El cierre automático pasa a realizada la 04 y ninguna otra');
select results_eq(
  $$select estado::text, monto_bruto, comision, monto_neto, llave_destino
    from public.desembolso where id_monitoria = '50000000-0000-0000-0000-000000002804'$$,
  $$values ('pendiente'::text, 200000, 15000, 185000, 'llave-m-28'::text)$$,
  'Criterio 1 por el cierre automático: también nace el desembolso, con la comisión en su tope de 15.000 (RN-81)');

-- El monitor cambia su llave por la Data API (HU-013) y después finaliza la 05.
set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000028a0","role":"authenticated"}';
update public.monitor_privado set llave = 'llave-m-28-nueva' where id_monitor = 'b0000000-0000-0000-0000-0000000028a0';
select is((select public.finalizar_monitoria('50000000-0000-0000-0000-000000002805')), 'finalizada',
  'Con la llave ya cambiada, el monitor finaliza la 05, que no tiene pagos');
reset role;
select results_eq(
  $$select (select llave from public.monitor_privado where id_monitor = 'b0000000-0000-0000-0000-0000000028a0'),
           (select llave_destino from public.desembolso where id_monitoria = '50000000-0000-0000-0000-000000002801'),
           (select llave_destino from public.desembolso where id_monitoria = '50000000-0000-0000-0000-000000002804')$$,
  $$values ('llave-m-28-nueva'::text, 'llave-m-28'::text, 'llave-m-28'::text)$$,
  'RN-80: los desembolsos ya creados conservan la llave copiada aunque el monitor cambie la suya');
select results_eq(
  $$select estado::text, monto_bruto, comision, monto_neto, llave_destino
    from public.desembolso where id_monitoria = '50000000-0000-0000-0000-000000002805'$$,
  $$values ('pendiente'::text, 0, 0, 0, 'llave-m-28-nueva'::text)$$,
  'El de la 05 nace con la llave nueva y, sin pagos aprobados, con la foto en 0');

-- La 01 vuelve a pasar a realizada después de aprobarse su pago en revisión.
update public.pago set estado = 'aprobado', fecha_revision = now() where id = '60000000-0000-0000-0000-00000002801c';
update public.monitoria set estado = 'cancelada', motivo_cancelacion = 'monitor_no_asistio'
where id = '50000000-0000-0000-0000-000000002801';
update public.monitoria set estado = 'realizada', motivo_cancelacion = null where id = '50000000-0000-0000-0000-000000002801';
select results_eq(
  $$select count(*)::int, min(monto_bruto), min(monto_neto), min(llave_destino)
    from public.desembolso where id_monitoria = '50000000-0000-0000-0000-000000002801'$$,
  $$values (1, 25000, 22500, 'llave-m-28'::text)$$,
  'Un desembolso por monitoría: si vuelve a pasar a realizada no nace otro ni se rehacen la foto ni la llave');

-- Un monitor sin monitor_privado (no pasa en producción: registrar_monitor lo crea).
set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000028b0","role":"authenticated"}';
select throws_ok(
  $$select public.finalizar_monitoria('50000000-0000-0000-0000-000000002806')$$,
  'P0001',
  'La monitoría 50000000-0000-0000-0000-000000002806 no puede quedar realizada: su monitor no tiene llave de desembolso (monitor_privado).',
  'Sin la llave del monitor no hay desembolso: finalizar falla con un error que lo dice');
reset role;
select results_eq(
  $$select m.estado::text, (select count(*)::int from public.desembolso d where d.id_monitoria = m.id)
    from public.monitoria m where m.id = '50000000-0000-0000-0000-000000002806'$$,
  $$values ('confirmada'::text, 0)$$,
  'Y la monitoría sigue confirmada y sin desembolso: el cambio de estado se deshizo');

-- ---------------------------------------------------------------------------
-- La referencia, por fuera de la función (supuesto 3)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$update public.desembolso set referencia_transferencia = ' TRF-1' where id = '70000000-0000-0000-0000-000000002829'$$,
  '23514', null, 'La referencia no empieza con espacios (desembolso_referencia_con_texto)');
select throws_ok(
  $$update public.desembolso set referencia_transferencia = E'TRF-1\n' where id = '70000000-0000-0000-0000-000000002829'$$,
  '23514', null, 'Ni termina con un salto de línea');
select throws_ok(
  $$update public.desembolso set referencia_transferencia = '' where id = '70000000-0000-0000-0000-000000002829'$$,
  '23514', null, 'Ni queda vacía');
select throws_ok(
  $$update public.desembolso set referencia_transferencia = repeat('a', 101) where id = '70000000-0000-0000-0000-000000002829'$$,
  '23514', null, 'Ni pasa de 100 caracteres');
select lives_ok(
  $$update public.desembolso set referencia_transferencia = repeat('é', 100) where id = '70000000-0000-0000-0000-000000002829'$$,
  'Con 100 caracteres sí, aunque cada uno ocupe dos bytes: se cuentan caracteres');
update public.desembolso set referencia_transferencia = null where id = '70000000-0000-0000-0000-000000002829';

-- ---------------------------------------------------------------------------
-- Criterios 2 y 3: estado_para_ejecutar, con ahora = miércoles 31-dic-2031 12:00 en Bogotá
-- ---------------------------------------------------------------------------
select results_eq(
  $$select motivo, monto_neto from privado.estado_para_ejecutar('70000000-0000-0000-0000-000000002824', '2031-12-31 12:00-05')$$,
  $$values (null::text, 22500)$$,
  'La 24 se puede ejecutar (motivo nulo), con su neto: un reporte rechazado no bloquea (RN-83)');
select results_eq(
  $$select motivo, monto_neto from privado.estado_para_ejecutar('70000000-0000-0000-0000-000000002822', '2031-12-31 12:00-05')$$,
  $$values ('con_reporte'::text, 22500)$$,
  'Criterio 2: con un reporte en revisión no se puede: con_reporte');
select results_eq(
  $$select motivo, monto_neto from privado.estado_para_ejecutar('70000000-0000-0000-0000-000000002823', '2031-12-31 12:00-05')$$,
  $$values ('con_reporte'::text, 22500)$$,
  'Ni con uno aceptado');
select results_eq(
  $$select motivo, monto_neto from privado.estado_para_ejecutar('70000000-0000-0000-0000-000000002825', '2031-12-31 12:00-05')$$,
  $$values ('pagos_en_revision'::text, 22500)$$,
  'Criterio 3 (D-39): con un pago en revisión no se puede, aunque otro ya esté aprobado: pagos_en_revision');
-- HU-078: el único pago de la 26 es un caso P-24 abierto. sin_pagos_aprobados queda para la 34, que no tiene ningún
-- pago.
select results_eq(
  $$select motivo, monto_neto from privado.estado_para_ejecutar('70000000-0000-0000-0000-000000002826', '2031-12-31 12:00-05')
    union all
    select motivo, monto_neto from privado.estado_para_ejecutar('70000000-0000-0000-0000-000000002834', '2031-12-31 12:00-05')$$,
  $$values ('caso_abierto'::text, 0), ('sin_pagos_aprobados', 0)$$,
  'HU-078 (D-39): con el único pago rechazado y su caso P-24 abierto, caso_abierto (ese monto todavía puede contar); supuesto 2: sin ningún pago (la 34) no hay nada que transferir, sin_pagos_aprobados. Neto 0 en las dos');
select results_eq(
  $$select motivo, monto_neto from privado.estado_para_ejecutar('70000000-0000-0000-0000-000000002827', '2031-12-31 12:00-05')$$,
  $$values ('anulado'::text, 22500)$$,
  'P-28: un anulado nunca: anulado (se dice antes que la monitoría cancelada o el reporte aceptado)');
select results_eq(
  $$select motivo, monto_neto from privado.estado_para_ejecutar('70000000-0000-0000-0000-000000002828', '2031-12-31 12:00-05')$$,
  $$values ('desembolsado'::text, 18000)$$,
  'Uno ya desembolsado: desembolsado, con el neto que se transfirió (18.000) y no uno recalculado');
select results_eq(
  $$select motivo, monto_neto from privado.estado_para_ejecutar('70000000-0000-0000-0000-000000002829', '2031-12-31 12:00-05')$$,
  $$values ('no_realizada'::text, 22500)$$,
  'Defensa: con la monitoría cancelada no se ejecuta, aunque el desembolso siga pendiente y no haya reporte');
select results_eq(
  $$select motivo, monto_neto from privado.estado_para_ejecutar('70000000-0000-0000-0000-000000002831', '2031-12-31 12:00-05')$$,
  $$values (null::text, 27000)$$,
  'P-29: el neto es el de los pagos aprobados de ahora (27.000), no el de la foto (22.500)');
select results_eq(
  $$select motivo, monto_neto from privado.estado_para_ejecutar('70000000-0000-0000-0000-000000002899', '2031-12-31 12:00-05')
    union all
    select motivo, monto_neto from privado.estado_para_ejecutar(null, '2031-12-31 12:00-05')$$,
  $$values ('no_encontrado'::text, null::integer), ('no_encontrado', null)$$,
  'Un id que no existe o nulo: no_encontrado, sin neto');

select results_eq(
  $$select motivo, monto_neto from privado.estado_para_ejecutar('70000000-0000-0000-0000-000000002821', '2031-12-31 12:00-05')$$,
  $$values ('pagos_en_revision'::text, 0)$$,
  'La 21, con su único pago en revisión: pagos_en_revision antes que sin_pagos_aprobados (ese pago todavía puede contar)');
update public.pago set estado = 'aprobado', fecha_revision = now() where id = '60000000-0000-0000-0000-00000002821a';
select results_eq(
  $$select motivo, monto_neto from privado.estado_para_ejecutar('70000000-0000-0000-0000-000000002821', '2031-12-31 12:00-05')$$,
  $$values (null::text, 22500)$$,
  'Aprobado el pago, la 21 se puede ejecutar con el neto de ahora (22.500), aunque la foto diga 0');

-- N-6: el fin de la 30 es el lunes 29-dic-2031 a las 11:00 en Bogotá.
select results_eq(
  $$select e.motivo
    from (values (1, timestamptz '2031-12-30 11:00-05' - interval '1 microsecond'),
                 (2, timestamptz '2031-12-30 11:00-05'),
                 (3, timestamptz '2031-12-30 11:00-05' + interval '1 microsecond')) as v(n, ahora)
    cross join lateral privado.estado_para_ejecutar('70000000-0000-0000-0000-000000002830', v.ahora) e
    order by v.n$$,
  $$values ('antes_de_plazo'::text), ('antes_de_plazo'), (null)$$,
  'N-6: un microsegundo antes y en el instante exacto de fin + 24 h todavía no (la ventana de reporte sigue abierta); un microsegundo después, sí');

-- Por la puerta, con la hora real.
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000028a0","role":"authenticated"}';
select results_eq(
  $$select motivo, monto_neto from public.estado_para_ejecutar('70000000-0000-0000-0000-000000002832')$$,
  $$values (null::text, 22500)$$,
  'Por la puerta, con la hora real: el admin ve que la de 2020 se puede ejecutar y su neto');
select results_eq(
  $$select motivo, monto_neto from public.estado_para_ejecutar('70000000-0000-0000-0000-000000002833')$$,
  $$values ('antes_de_plazo'::text, 22500)$$,
  'Y que la 33, que terminó hace una hora, todavía no: antes_de_plazo se dice antes que el reporte');
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000028a0","role":"authenticated"}';
select is((select count(*)::int from public.estado_para_ejecutar('70000000-0000-0000-0000-000000002832')), 0,
  'El monitor no recibe nada, ni el neto de su propio desembolso');
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000028c0","role":"authenticated"}';
select is((select count(*)::int from public.estado_para_ejecutar('70000000-0000-0000-0000-000000002832')), 0,
  'RN-23: un admin desactivado tampoco');
set local request.jwt.claims to '{"role":"authenticated"}';
select is((select count(*)::int from public.estado_para_ejecutar('70000000-0000-0000-0000-000000002832')), 0,
  'Ni una llamada sin sesión');
reset role;

-- ---------------------------------------------------------------------------
-- ejecutar_desembolso con ahora = 31-dic-2031 12:00 en Bogotá: lo que no se ejecuta
-- ---------------------------------------------------------------------------
-- HU-078: por la monitoría, así entran también los que creó el trigger (01, 04 y 05), que ningún intento toca.
create temporary table antes as
select id, estado::text as estado, id_admin, referencia_transferencia, fecha_desembolso, monto_bruto, comision, monto_neto
from public.desembolso where id_monitoria::text like '50000000-0000-0000-0000-0000000028%';

set local request.jwt.claims to '{"role":"authenticated"}';
select is(
  privado.ejecutar_desembolso('70000000-0000-0000-0000-000000002824', 'TRF-1', date '2031-12-31', 22500, '2031-12-31 12:00-05'),
  'sin_sesion', 'Sin sesión (el token no trae sub): sin_sesion');
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000028a0","role":"authenticated"}';
select is(
  privado.ejecutar_desembolso('70000000-0000-0000-0000-000000002824', 'TRF-1', date '2031-12-31', 22500, '2031-12-31 12:00-05'),
  'sin_permiso', 'El monitor no ejecuta su propio desembolso: sin_permiso');
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000002801","role":"authenticated","is_anonymous":true}';
select is(
  privado.ejecutar_desembolso('70000000-0000-0000-0000-000000002824', 'TRF-1', date '2031-12-31', 22500, '2031-12-31 12:00-05'),
  'sin_permiso', 'Un Lead tampoco');
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000028c0","role":"authenticated"}';
select is(
  privado.ejecutar_desembolso('70000000-0000-0000-0000-000000002824', 'TRF-1', date '2031-12-31', 22500, '2031-12-31 12:00-05'),
  'sin_permiso', 'RN-23: ni un admin desactivado');

-- Desde aquí el admin de la sesión es A.
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000028a0","role":"authenticated"}';
select is(
  array[
    privado.ejecutar_desembolso('70000000-0000-0000-0000-000000002824', null, date '2031-12-31', 22500, '2031-12-31 12:00-05'),
    privado.ejecutar_desembolso('70000000-0000-0000-0000-000000002824', '   ', date '2031-12-31', 22500, '2031-12-31 12:00-05'),
    privado.ejecutar_desembolso('70000000-0000-0000-0000-000000002824', E'\n\t\r\n', date '2031-12-31', 22500, '2031-12-31 12:00-05'),
    privado.ejecutar_desembolso('70000000-0000-0000-0000-000000002824', repeat('a', 101), date '2031-12-31', 22500, '2031-12-31 12:00-05'),
    privado.ejecutar_desembolso('70000000-0000-0000-0000-000000002899', '', date '2031-12-31', 22500, '2031-12-31 12:00-05')
  ],
  array['referencia_invalida', 'referencia_invalida', 'referencia_invalida', 'referencia_invalida', 'referencia_invalida'],
  'Supuesto 3: sin referencia, en blanco, de puros saltos de línea o de más de 100 caracteres: referencia_invalida (antes de buscar el desembolso)');
select is(
  array[
    privado.ejecutar_desembolso('70000000-0000-0000-0000-000000002824', 'TRF-1', null, 22500, '2031-12-31 12:00-05'),
    privado.ejecutar_desembolso('70000000-0000-0000-0000-000000002824', 'TRF-1', date '2032-01-01', 22500, '2031-12-31 12:00-05'),
    privado.ejecutar_desembolso('70000000-0000-0000-0000-000000002824', 'TRF-1', date '2032-01-01', 22500, '2032-01-01 04:59:59+00'),
    privado.ejecutar_desembolso('70000000-0000-0000-0000-000000002824', 'TRF-1', date '2031-01-26', 22500, '2031-12-31 12:00-05')
  ],
  array['fecha_invalida', 'fecha_invalida', 'fecha_invalida', 'fecha_invalida'],
  'Supuesto 3: sin fecha, futura (también a las 23:59:59 del 31 en Bogotá, cuando en UTC ya es 1 de enero) o anterior a la sesión del 27-ene: fecha_invalida');
select is(
  array[
    privado.ejecutar_desembolso('70000000-0000-0000-0000-000000002899', 'TRF-1', date '2031-12-31', 22500, '2031-12-31 12:00-05'),
    privado.ejecutar_desembolso(null, 'TRF-1', date '2031-12-31', 22500, '2031-12-31 12:00-05')
  ],
  array['no_encontrado', 'no_encontrado'],
  'Un desembolso que no existe o un id nulo: no_encontrado');
select is(
  array[
    privado.ejecutar_desembolso('70000000-0000-0000-0000-000000002828', 'TRF-1', date '2031-12-31', 18000, '2031-12-31 12:00-05'),
    privado.ejecutar_desembolso('70000000-0000-0000-0000-000000002828', 'TRF-1', date '2031-02-23', 18000, '2031-12-31 12:00-05'),
    privado.ejecutar_desembolso('70000000-0000-0000-0000-000000002827', 'TRF-1', date '2031-12-31', 22500, '2031-12-31 12:00-05'),
    privado.ejecutar_desembolso('70000000-0000-0000-0000-000000002827', 'TRF-1', date '2031-02-16', 22500, '2031-12-31 12:00-05')
  ],
  array['ya_desembolsado', 'ya_desembolsado', 'anulado', 'anulado'],
  'Uno ya desembolsado: ya_desembolsado; uno anulado (P-28): anulado. Se dice antes que una fecha anterior a la sesión');
select is(
  array[
    privado.ejecutar_desembolso('70000000-0000-0000-0000-000000002829', 'TRF-1', date '2031-12-31', 22500, '2031-12-31 12:00-05'),
    privado.ejecutar_desembolso('70000000-0000-0000-0000-000000002830', 'TRF-1', date '2031-12-30', 22500, '2031-12-30 11:00-05'),
    privado.ejecutar_desembolso('70000000-0000-0000-0000-000000002822', 'TRF-1', date '2031-12-31', 22500, '2031-12-31 12:00-05'),
    privado.ejecutar_desembolso('70000000-0000-0000-0000-000000002823', 'TRF-1', date '2031-12-31', 22500, '2031-12-31 12:00-05'),
    privado.ejecutar_desembolso('70000000-0000-0000-0000-000000002825', 'TRF-1', date '2031-12-31', 22500, '2031-12-31 12:00-05'),
    privado.ejecutar_desembolso('70000000-0000-0000-0000-000000002826', 'TRF-1', date '2031-12-31', 0, '2031-12-31 12:00-05'),
    privado.ejecutar_desembolso('70000000-0000-0000-0000-000000002834', 'TRF-1', date '2031-12-31', 0, '2031-12-31 12:00-05')
  ],
  array['no_realizada', 'antes_de_plazo', 'con_reporte', 'con_reporte', 'pagos_en_revision', 'caso_abierto', 'sin_pagos_aprobados'],
  'Al ejecutar se vuelve a validar como en la pantalla: monitoría no realizada, el instante exacto de fin + 24 h (N-6), un reporte en revisión o aceptado, un pago en revisión (D-39), un caso P-24 abierto (HU-078) y sin pagos aprobados');
select is(
  privado.ejecutar_desembolso('70000000-0000-0000-0000-000000002831', 'TRF-1', date '2031-12-31', 22500, '2031-12-31 12:00-05'),
  'monto_cambio', 'P-29: si el neto de ahora (27.000) no es el que vio el admin (22.500): monto_cambio');
select results_eq(
  $$select id, estado::text, id_admin, referencia_transferencia, fecha_desembolso, monto_bruto, comision, monto_neto
    from public.desembolso where id_monitoria::text like '50000000-0000-0000-0000-0000000028%' order by id$$,
  $$select * from antes order by id$$,
  'Ninguno de esos intentos tocó un desembolso');

-- ---------------------------------------------------------------------------
-- Criterio 4: el admin registra la transferencia
-- ---------------------------------------------------------------------------
select is(
  privado.ejecutar_desembolso('70000000-0000-0000-0000-000000002821', E'  TRF-2821 \n', date '2031-12-31', 22500, '2031-12-31 12:00-05'),
  'desembolsado', 'Criterio 4: A registra la transferencia de la 21: desembolsado');
select results_eq(
  $$select estado::text, id_admin, referencia_transferencia, fecha_desembolso, monto_bruto, comision, monto_neto, llave_destino
    from public.desembolso where id = '70000000-0000-0000-0000-000000002821'$$,
  $$values ('desembolsado'::text, 'a0000000-0000-0000-0000-0000000028a0'::uuid, 'TRF-2821'::text,
            timestamptz '2031-12-31 12:00-05', 25000, 2500, 22500, 'llave-m-28'::text)$$,
  'Queda con el id de A, la referencia sin los espacios de los bordes, la fecha a mediodía en Bogotá y los montos recalculados con el pago que se aprobó después de la foto (P-29)');

set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000028b0","role":"authenticated"}';
select is(
  privado.ejecutar_desembolso('70000000-0000-0000-0000-000000002821', 'TRF-OTRA', date '2031-12-31', 22500, '2031-12-31 12:00-05'),
  'ya_desembolsado', 'Supuesto 5: el admin que llega después recibe ya_desembolsado');
select results_eq(
  $$select id_admin, referencia_transferencia from public.desembolso where id = '70000000-0000-0000-0000-000000002821'$$,
  $$values ('a0000000-0000-0000-0000-0000000028a0'::uuid, 'TRF-2821'::text)$$,
  'Y no cambia quién lo ejecutó ni la referencia');
select is(
  privado.ejecutar_desembolso('70000000-0000-0000-0000-000000002824', 'TRF-2824', date '2031-06-15', 22500, '2031-12-31 12:00-05'),
  'desembolsado', 'B ejecuta la 24: un reporte rechazado no bloquea (RN-83)');
select is(
  privado.ejecutar_desembolso('70000000-0000-0000-0000-000000002830', repeat('é', 100), date '2031-12-29', null,
                              timestamptz '2031-12-30 11:00-05' + interval '1 microsecond'),
  'desembolsado', 'N-6: un microsegundo después de fin + 24 h ya se ejecuta (sin neto esperado no se compara; la fecha puede ser la de la sesión)');
select is(
  privado.ejecutar_desembolso('70000000-0000-0000-0000-000000002831', 'TRF-2831', date '2031-12-31', 27000, '2031-12-31 12:00-05'),
  'desembolsado', 'Con el neto que vio de nuevo (27.000), la 31 se ejecuta');
select results_eq(
  $$select right(id::text, 2), id_admin, char_length(referencia_transferencia), fecha_desembolso, monto_bruto, comision, monto_neto
    from public.desembolso
    where id in ('70000000-0000-0000-0000-000000002824', '70000000-0000-0000-0000-000000002830',
                 '70000000-0000-0000-0000-000000002831')
    order by id$$,
  $$values ('24'::text, 'a0000000-0000-0000-0000-0000000028b0'::uuid, 8, timestamptz '2031-06-15 12:00-05', 25000, 2500, 22500),
           ('30', 'a0000000-0000-0000-0000-0000000028b0', 100, timestamptz '2031-12-29 12:00-05', 25000, 2500, 22500),
           ('31', 'a0000000-0000-0000-0000-0000000028b0', 8, timestamptz '2031-12-31 12:00-05', 30000, 3000, 27000)$$,
  'Quedan con el id de B, la referencia completa (los 100 caracteres de dos bytes) y los montos de ahora: 30.000, 3.000 y 27.000 en la 31');

-- ---------------------------------------------------------------------------
-- Las puertas públicas, con la hora real (la 32 es de 2020)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"role":"authenticated"}';
select is(
  (select public.ejecutar_desembolso('70000000-0000-0000-0000-000000002832', 'TRF-2832', (now() at time zone 'America/Bogota')::date, 22500)),
  'sin_sesion', 'Por la puerta, sin sesión: sin_sesion');
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000028a0","role":"authenticated"}';
select is(
  (select public.ejecutar_desembolso('70000000-0000-0000-0000-000000002832', 'TRF-2832', (now() at time zone 'America/Bogota')::date, 22500)),
  'sin_permiso', 'El monitor: sin_permiso');
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000028a0","role":"authenticated"}';
select throws_ok(
  $$update public.desembolso
    set estado = 'desembolsado', id_admin = 'a0000000-0000-0000-0000-0000000028a0', fecha_desembolso = now(),
        referencia_transferencia = 'TRF-DIRECTO'
    where id = '70000000-0000-0000-0000-000000002832'$$,
  '42501', null, 'Ni el admin con sesión escribe en desembolso directo en la Data API: permiso denegado');
select is(
  (select public.ejecutar_desembolso('70000000-0000-0000-0000-000000002832', 'TRF-2832', (now() at time zone 'America/Bogota')::date, 22500)),
  'desembolsado', 'Criterio 4 por la puerta: el admin con sesión ejecuta la 32 con la fecha de hoy en Bogotá');
reset role;
select results_eq(
  $$select estado::text, id_admin, referencia_transferencia,
           fecha_desembolso = ((now() at time zone 'America/Bogota')::date + time '12:00') at time zone 'America/Bogota'
    from public.desembolso where id = '70000000-0000-0000-0000-000000002832'$$,
  $$values ('desembolsado'::text, 'a0000000-0000-0000-0000-0000000028a0'::uuid, 'TRF-2832'::text, true)$$,
  'Queda desembolsado con el id del admin de la sesión (auth.uid()), su referencia y la fecha de hoy a mediodía en Bogotá');

select * from finish();
rollback;
