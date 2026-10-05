-- Pruebas pgTAP de resolver un reporte de inasistencia: aceptarlo o rechazarlo (HU-030, RN-62 a RN-65, RN-60, RN-61, RN-83,
-- P-07, P-28, P-37, P-44, D-26, D-27, D-28, D-37, D-39, D-40, D-48).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.
--
-- Qué cubre la migración 20261005134333_resolver_reportes.sql:
--   * Estructura y permisos de las cuatro funciones nuevas: privado.resolver_reporte_inasistencia (con p_ahora, interna),
--     su envoltorio privado.resolver_reporte_inasistencia_de_la_sesion (now()), la puerta public.resolver_reporte_inasistencia
--     y privado.motivo_de_inasistencia (el único texto del motivo de D-37). Nadie con sesión escribe en reporte_inasistencia,
--     monitoria, desembolso ni reembolso.
--   * El check aviso_monitor_evento_valido con inasistencia_aceptada (y los tres de antes).
--   * privado.motivo_de_inasistencia: sin observaciones, con espacios y saltos de línea de los bordes, y con 500 caracteres.
--   * Cada resultado de la decisión y su orden (quién puede antes que el texto), con una foto de lo que cuelga de la monitoría
--     antes y después: ninguno de los que fallan toca nada.
--   * Aceptar desde confirmada y desde realizada: la monitoría cancelada por monitor_no_asistio (fecha_finalizacion intacta), el
--     reporte con fecha y observaciones, el desembolso pendiente anulado (el transferido no), un reembolso por pago aprobado
--     con el primer admin activo y el motivo de D-37, el pedido y la solicitud de llave, el aviso al monitor, y que nada de
--     eso pasa con los pagos en revisión o rechazados.
--   * Rechazar: solo el reporte; la monitoría, los pagos y el desembolso no cambian, el desembolso vuelve a ser ejecutable
--     pasada la ventana (RN-83) y la invitación a reseñar vuelve a la cola (HU-080).
--   * P-07 ampliado (privado.reembolsar_pago_aprobado_tarde): el pago aprobado después de aceptar recibe su reembolso con el
--     mismo motivo; la rama del estudiante sigue igual; una grupal o un pago rechazado no generan nada.
--   * La rama nueva de privado.anotar_aviso_monitor (confirmada o realizada -> cancelada por monitor_no_asistio), sin las
--     grupales.
--   * Los efectos sobre lo que ya existía: equipo_de_admins, el caso P-24, reasignar_casos_de_admin y reportar_inasistencia.
-- Lo que necesita dos conexiones (los candados, el doble clic de verdad, el admin desactivado mientras espera) lo cubre la
-- prueba de integración.
--
-- Las monitorías del núcleo caen en lunes de 2030 (en el futuro: ningún trabajo de pg_cron las toca) y las que ya están
-- realizadas, en enero de 2020 (la ventana de RN-83 ya venció); las decisiones se llaman con p_ahora fijo (31-dic-2031) salvo
-- la puerta, que usa now() y una monitoría que empezó hace 2 horas.
--
-- El turno de admins recorre a TODOS los admins de la base: los que ya existían se banean dentro de la transacción y los de
-- esta prueba llevan un orden_revision negativo, por delante de cualquier otro (A antes que B).
--
-- Elenco (ids terminados en 30NN; la materia es 'PGTAP-30'; el reporte de cada monitoría es 7000...30NN y sus pagos, NNpp):
--   Admins A (el primero del turno), B (activo) y C (desactivado). Monitor M con su llave. Lead 01 con su sesión anónima.
--   Monitorías (todas con un reporte en revisión asignado a A, salvo que se diga otra cosa):
--     01 confirmada: los resultados que no escriben   02 con el reporte ya aceptado   03 con el reporte ya rechazado
--     04 grupal   05 cancelada por el estudiante   06 aceptar desde confirmada (con tres pagos)   07 P-07 (dos pagos en
--     revisión y uno aprobado)   08 aceptar sin observaciones, con el reporte de B   09 tres pagos aprobados   10 realizada con
--     desembolso pendiente: aceptar   11 realizada con desembolso transferido: aceptar   12 rechazar con 500 caracteres
--     13 rechazar con observaciones en blanco   14 realizada de 2020: rechazar   15 lo mismo con un pago en revisión
--     16 realizada de 2030: rechazar   17 cancelada por monitor_no_asistio sin reporte   18 cancelada por el estudiante
--     19 grupal cancelada por monitor_no_asistio   20 grupal confirmada   21 la puerta (empezó hace 2 horas)
--     90 por pagar, para el check del aviso.

begin;
create extension if not exists pgtap with schema extensions;

select plan(126);

-- ---------------------------------------------------------------------------
-- Existencia, permisos y forma de las cuatro funciones nuevas
-- ---------------------------------------------------------------------------
select has_function('privado', 'resolver_reporte_inasistencia', array['uuid', 'text', 'text', 'timestamp with time zone'],
  'Existe privado.resolver_reporte_inasistencia, la que escribe, con la hora como parámetro (para probar los bordes)');
select has_function('privado', 'resolver_reporte_inasistencia_de_la_sesion', array['uuid', 'text', 'text'],
  'Existe privado.resolver_reporte_inasistencia_de_la_sesion, la que ejecuta la sesión con la hora de la base');
select has_function('public', 'resolver_reporte_inasistencia', array['uuid', 'text', 'text'],
  'Existe su puerta en la Data API');
select has_function('privado', 'motivo_de_inasistencia', array['text'],
  'Existe privado.motivo_de_inasistencia, el único texto del motivo de D-37');
select ok(
  (select bool_and(prosecdef) from pg_proc
   where oid in ('privado.resolver_reporte_inasistencia(uuid, text, text, timestamptz)'::regprocedure,
                 'privado.resolver_reporte_inasistencia_de_la_sesion(uuid, text, text)'::regprocedure))
  and not (select bool_or(prosecdef) from pg_proc
           where oid in ('public.resolver_reporte_inasistencia(uuid, text, text)'::regprocedure,
                         'privado.motivo_de_inasistencia(text)'::regprocedure)),
  'Las dos que escriben (en privado) son security definer; la de public corre con los permisos de quien llama y el motivo es una función pura');
select ok(
  (select bool_and('search_path=""' = any(proconfig)) from pg_proc
   where oid in ('privado.resolver_reporte_inasistencia(uuid, text, text, timestamptz)'::regprocedure,
                 'privado.resolver_reporte_inasistencia_de_la_sesion(uuid, text, text)'::regprocedure,
                 'public.resolver_reporte_inasistencia(uuid, text, text)'::regprocedure,
                 'privado.motivo_de_inasistencia(text)'::regprocedure)),
  'Las cuatro fijan un search_path vacío');
select is(
  array[pg_get_function_identity_arguments('public.resolver_reporte_inasistencia(uuid, text, text)'::regprocedure),
        pg_get_function_identity_arguments('privado.resolver_reporte_inasistencia_de_la_sesion(uuid, text, text)'::regprocedure)],
  array['p_id_reporte uuid, p_decision text, p_observaciones text', 'p_id_reporte uuid, p_decision text, p_observaciones text'],
  'Las que llama la sesión no reciben el admin ni la hora: nadie decide a nombre de otro ni elige la fecha de la decisión');
select is(
  array[pg_get_function_result('public.resolver_reporte_inasistencia(uuid, text, text)'::regprocedure),
        pg_get_function_result('privado.motivo_de_inasistencia(text)'::regprocedure)],
  array['text', 'text'],
  'La decisión devuelve el resultado en texto y el motivo, un texto');
select is(
  (select p.provolatile::text from pg_proc p where p.oid = 'privado.motivo_de_inasistencia(text)'::regprocedure), 'i',
  'El motivo es inmutable: depende solo de las observaciones');
select ok(
  not exists (
    select 1
    from unnest(array['privado.resolver_reporte_inasistencia(uuid, text, text, timestamptz)',
                      'privado.resolver_reporte_inasistencia_de_la_sesion(uuid, text, text)',
                      'public.resolver_reporte_inasistencia(uuid, text, text)', 'privado.motivo_de_inasistencia(text)']) f
    where has_function_privilege('anon', f, 'execute') or has_function_privilege('service_role', f, 'execute')),
  'Ni anon ni service_role ejecutan ninguna: sin sesión no hay admin');
select ok(
  has_function_privilege('authenticated', 'public.resolver_reporte_inasistencia(uuid, text, text)', 'execute')
  and has_function_privilege('authenticated', 'privado.resolver_reporte_inasistencia_de_la_sesion(uuid, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'privado.resolver_reporte_inasistencia(uuid, text, text, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'privado.motivo_de_inasistencia(text)', 'execute'),
  'Con sesión solo la puerta y su envoltorio con now(): la versión con la hora y el motivo son internas');
select ok(
  not exists (
    select 1
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid in ('privado.resolver_reporte_inasistencia(uuid, text, text, timestamptz)'::regprocedure,
                    'privado.resolver_reporte_inasistencia_de_la_sesion(uuid, text, text)'::regprocedure,
                    'public.resolver_reporte_inasistencia(uuid, text, text)'::regprocedure,
                    'privado.motivo_de_inasistencia(text)'::regprocedure)
      and a.grantee = 0),
  'Nadie las hereda de PUBLIC');
select ok(
  obj_description('public.resolver_reporte_inasistencia(uuid, text, text)'::regprocedure, 'pg_proc') is not null
  and obj_description('privado.resolver_reporte_inasistencia(uuid, text, text, timestamptz)'::regprocedure, 'pg_proc') is not null
  and obj_description('privado.motivo_de_inasistencia(text)'::regprocedure, 'pg_proc') is not null,
  'La puerta, el corazón y el motivo tienen comentario');
select ok(
  not has_any_column_privilege('authenticated', 'public.reporte_inasistencia', 'insert')
  and not has_any_column_privilege('authenticated', 'public.reporte_inasistencia', 'update')
  and not has_table_privilege('authenticated', 'public.reporte_inasistencia', 'delete')
  and not has_any_column_privilege('authenticated', 'public.monitoria', 'update')
  and not has_any_column_privilege('authenticated', 'public.desembolso', 'update')
  and not has_any_column_privilege('authenticated', 'public.reembolso', 'insert')
  and not has_any_column_privilege('authenticated', 'public.reembolso', 'update'),
  'Nadie con sesión escribe en reporte_inasistencia, monitoria, desembolso ni reembolso: solo la función');

-- Sin permiso ni se ejecutan.
set local role anon;
select throws_ok(
  $$select public.resolver_reporte_inasistencia('70000000-0000-0000-0000-000000003001', 'rechazar', null)$$,
  '42501', null, 'anon no puede resolver un reporte: permiso denegado');
select throws_ok(
  $$select privado.resolver_reporte_inasistencia('70000000-0000-0000-0000-000000003001', 'rechazar', null, now())$$,
  '42501', null, 'Ni llamar la versión que recibe la hora');
reset role;
set local role service_role;
select throws_ok(
  $$select public.resolver_reporte_inasistencia('70000000-0000-0000-0000-000000003001', 'rechazar', null)$$,
  '42501', null, 'service_role tampoco: no es un admin con sesión');
select throws_ok(
  $$select privado.resolver_reporte_inasistencia('70000000-0000-0000-0000-000000003001', 'rechazar', null, now())$$,
  '42501', null, 'Ni la versión que recibe la hora');
reset role;
set local role authenticated;
select throws_ok(
  $$select privado.resolver_reporte_inasistencia('70000000-0000-0000-0000-000000003001', 'rechazar', null, now())$$,
  '42501', null, 'Una sesión no llama a la versión que recibe la hora: permiso denegado');
select throws_ok($$select privado.motivo_de_inasistencia('texto')$$, '42501', null,
  'Ni al motivo: lo usan las funciones security definer, no una sesión');
reset role;

-- ---------------------------------------------------------------------------
-- Fixtures (como postgres)
-- ---------------------------------------------------------------------------
-- La prueba no depende de lo que haya en Vault: sin los secretos de la app, ningún trigger le pide nada a pg_net.
delete from vault.secrets where name in ('calibra_sitio_url', 'calibra_cron_secreto');

-- Cualquier admin que ya existiera queda inactivo durante la prueba.
update auth.users set banned_until = 'infinity' where id in (select id from public.admin);

insert into auth.users (id, is_anonymous, banned_until) values
  ('a0000000-0000-0000-0000-0000000030a0', false, null),
  ('a0000000-0000-0000-0000-0000000030b0', false, null),
  ('a0000000-0000-0000-0000-0000000030c0', false, 'infinity'),
  ('b0000000-0000-0000-0000-000000003001', false, null),
  ('c0000000-0000-0000-0000-000000003001', true, null);

insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-0000000030a0', 'Admin A', 'admin-a-hu030@calibra.test', -3000),
  ('a0000000-0000-0000-0000-0000000030b0', 'Admin B', 'admin-b-hu030@calibra.test', -2999),
  ('a0000000-0000-0000-0000-0000000030c0', 'Admin C', 'admin-c-hu030@calibra.test', -2998);
insert into public.monitor (id, nombre) values ('b0000000-0000-0000-0000-000000003001', 'Ana 30');
insert into public.monitor_privado (id_monitor, numero_telefono, correo, llave) values
  ('b0000000-0000-0000-0000-000000003001', '3003000001', 'ana.monitora30@calibra.test', 'llave-ana-30');
insert into public.materia (id, nombre, codigo) values ('10000000-0000-0000-0000-000000003001', 'Materia 30', 'PGTAP-30');
insert into public.certificado (id_monitor, id_materia, id_admin) values
  ('b0000000-0000-0000-0000-000000003001', '10000000-0000-0000-0000-000000003001', 'a0000000-0000-0000-0000-0000000030a0');
insert into public.lead (id, id_sesion_anonima, nombre, numero_telefono, correo, acepta_tratamiento_datos, fecha_consentimiento) values
  ('40000000-0000-0000-0000-000000003001', 'c0000000-0000-0000-0000-000000003001', 'Lucía Prueba 30', '3003011111',
   'lucia.secreta30@calibra.test', true, now());

-- aislar(): vuelve a desactivar a cualquier admin que no sea de la prueba (otras pruebas pueden crear admins mientras corre).
create procedure pg_temp.aislar()
language sql security definer set search_path = ''
as $$
  update auth.users set banned_until = 'infinity'
  where id in (select id from public.admin
               where id not in ('a0000000-0000-0000-0000-0000000030a0', 'a0000000-0000-0000-0000-0000000030b0',
                                'a0000000-0000-0000-0000-0000000030c0'))
    and (banned_until is null or banned_until <= now());
$$;
call pg_temp.aislar();

-- Franjas: las del núcleo, todas los lunes a las 9:30 en Bogotá, virtuales de 60 min.
insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min, lugar, enlace, abierta_desde)
select ('30000000-0000-0000-0000-0000000030' || nn)::uuid, 'b0000000-0000-0000-0000-000000003001'::uuid, smallint '1',
       time '09:30', false, 20000, 60, null, 'https://meet.example/30-' || nn, date '2019-01-01'
from unnest(array['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18',
                  '19', '20', '90']) as nn;

-- La franja de la puerta, que usa now(): la hora de inicio es la de hace 2 horas en Bogotá, con el día de la semana que le toca.
create temporary table inicio_30 (nn text primary key, inicio timestamptz not null);
insert into inicio_30 (nn, inicio) values ('21', date_trunc('minute', now() - interval '2 hours'));
insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min, lugar, enlace, abierta_desde)
select ('30000000-0000-0000-0000-0000000030' || nn)::uuid, 'b0000000-0000-0000-0000-000000003001'::uuid,
       extract(isodow from (inicio at time zone 'America/Bogota')::date)::smallint,
       (inicio at time zone 'America/Bogota')::time, false, 20000, 60, null, 'https://meet.example/30-' || nn, date '2019-01-01'
from inicio_30;

-- Monitorías. Las de 2030 son lunes desde el 4 de marzo; las de 2020, lunes de enero. Las que quedan realizadas con
-- desembolso (10, 14, 15 y 16) entran confirmadas y se realizan más abajo, con un UPDATE, para que los triggers creen su
-- desembolso y su invitación a reseñar.
insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado, motivo_cancelacion, fecha_finalizacion)
select ('50000000-0000-0000-0000-0000000030' || v.nn)::uuid, ('30000000-0000-0000-0000-0000000030' || v.nn)::uuid,
       '10000000-0000-0000-0000-000000003001'::uuid, '40000000-0000-0000-0000-000000003001'::uuid,
       v.fecha, 20000, v.estado, v.motivo, v.finalizada
from (values
  ('01', date '2030-03-04', 'confirmada'::public.estado_monitoria, null::public.motivo_cancelacion, null::timestamptz),
  ('02', date '2030-03-11', 'cancelada', 'monitor_no_asistio', null),
  ('03', date '2030-03-18', 'confirmada', null, null),
  ('04', date '2030-03-25', 'confirmada', null, null),
  ('05', date '2030-04-01', 'cancelada', 'estudiante', null),
  ('06', date '2030-04-08', 'confirmada', null, null),
  ('07', date '2030-04-15', 'confirmada', null, null),
  ('08', date '2030-04-22', 'confirmada', null, null),
  ('09', date '2030-04-29', 'confirmada', null, null),
  ('10', date '2020-01-06', 'confirmada', null, null),
  ('11', date '2020-01-13', 'realizada', null, timestamptz '2020-01-13 11:00-05'),
  ('12', date '2030-05-06', 'confirmada', null, null),
  ('13', date '2030-05-13', 'confirmada', null, null),
  ('14', date '2020-01-20', 'confirmada', null, null),
  ('15', date '2020-01-27', 'confirmada', null, null),
  ('16', date '2030-05-20', 'confirmada', null, null),
  ('17', date '2030-05-27', 'cancelada', 'monitor_no_asistio', null),
  ('18', date '2030-06-03', 'cancelada', 'estudiante', null),
  ('19', date '2030-06-10', 'cancelada', 'monitor_no_asistio', null),
  ('20', date '2030-06-17', 'confirmada', null, null),
  ('90', date '2030-07-01', 'pendiente_pago', null, null)) as v(nn, fecha, estado, motivo, finalizada);
insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado)
select ('50000000-0000-0000-0000-0000000030' || i.nn)::uuid, ('30000000-0000-0000-0000-0000000030' || i.nn)::uuid,
       '10000000-0000-0000-0000-000000003001'::uuid, '40000000-0000-0000-0000-000000003001'::uuid,
       (i.inicio at time zone 'America/Bogota')::date, 20000, 'confirmada'
from inicio_30 i;

-- Las grupales: la 04, la 19 y la 20.
insert into public.monitoria_grupal (id_monitoria, cupos, modalidad_pago, precio_por_persona) values
  ('50000000-0000-0000-0000-000000003004', 3, 'dividido', 15000),
  ('50000000-0000-0000-0000-000000003019', 3, 'dividido', 15000),
  ('50000000-0000-0000-0000-000000003020', 3, 'dividido', 15000);

-- Los pagos (todos de A, 20.000, del contacto 'pagador.secreto30'; los de la 09 tienen dos contactos distintos).
create temporary table pago_30 (id text primary key, estado public.estado_pago not null, contacto text not null default 'pagador.secreto30@example.com');
insert into pago_30 (id, estado, contacto) values
  ('0101', 'aprobado', default), ('0201', 'aprobado', default), ('0301', 'aprobado', default), ('0401', 'aprobado', default),
  ('0501', 'aprobado', default),
  ('0601', 'aprobado', default), ('0602', 'en_revision', default), ('0603', 'rechazado', default),
  ('0701', 'en_revision', default), ('0702', 'en_revision', default), ('0703', 'aprobado', default),
  ('0801', 'aprobado', default),
  ('0901', 'aprobado', 'pagador.uno30@example.com'), ('0902', 'aprobado', 'pagador.uno30@example.com'),
  ('0903', 'aprobado', 'pagador.dos30@example.com'),
  ('1001', 'aprobado', default), ('1101', 'aprobado', default), ('1201', 'aprobado', default), ('1301', 'aprobado', default),
  ('1401', 'aprobado', default), ('1501', 'aprobado', default), ('1502', 'en_revision', default), ('1601', 'aprobado', default),
  ('1701', 'en_revision', default), ('1801', 'en_revision', default), ('1901', 'en_revision', default),
  ('2101', 'aprobado', default);
insert into public.comprobante_revisado (ruta, tipo)
select 'c0000000-0000-0000-0000-000000003001/60000000-0000-0000-0000-00000030' || id || '.pdf', 'application/pdf' from pago_30;
insert into public.pago (id, id_monitoria, monto, nombre_pagador, contacto, estado, id_admin, fecha_pago, fecha_revision, comprobante)
select ('60000000-0000-0000-0000-00000030' || id)::uuid, ('50000000-0000-0000-0000-0000000030' || left(id, 2))::uuid, 20000,
       'Pagador Secreto 30', contacto, estado, 'a0000000-0000-0000-0000-0000000030a0',
       timestamptz '2020-01-01 10:00-05', case when estado = 'en_revision' then null else now() end,
       'c0000000-0000-0000-0000-000000003001/60000000-0000-0000-0000-00000030' || id || '.pdf'
from pago_30;

-- Las realizadas con desembolso: el UPDATE dispara el desembolso pendiente y la invitación a reseñar de cada pago.
update public.monitoria set estado = 'realizada', fecha_finalizacion = timestamptz '2020-01-06 11:00-05'
where id = '50000000-0000-0000-0000-000000003010';
update public.monitoria set estado = 'realizada', fecha_finalizacion = timestamptz '2020-01-20 11:00-05'
where id = '50000000-0000-0000-0000-000000003014';
update public.monitoria set estado = 'realizada', fecha_finalizacion = timestamptz '2020-01-27 11:00-05'
where id = '50000000-0000-0000-0000-000000003015';
update public.monitoria set estado = 'realizada', fecha_finalizacion = timestamptz '2030-05-20 11:00-05'
where id = '50000000-0000-0000-0000-000000003016';
-- La 11 entró realizada (sin triggers) y su desembolso ya salió: se inserta ya transferido.
insert into public.desembolso (id_monitoria, id_admin, monto_bruto, comision, monto_neto, llave_destino, estado, fecha_desembolso,
                               referencia_transferencia) values
  ('50000000-0000-0000-0000-000000003011', 'a0000000-0000-0000-0000-0000000030a0', 20000, 2000, 18000, 'llave-ana-30', 'desembolsado',
   timestamptz '2020-01-20 12:00-05', 'REF-30-11');

-- Los reportes (ids 7000...30NN). Todos en revisión y de A, salvo el de la 08 (de B), el de la 02 (aceptado) y el de la 03
-- (rechazado). La 17, la 18, la 19 y la 20 no tienen reporte.
insert into public.reporte_inasistencia (id, id_monitoria, id_admin, estado, fecha_decision, observaciones)
select ('70000000-0000-0000-0000-0000000030' || v.nn)::uuid, ('50000000-0000-0000-0000-0000000030' || v.nn)::uuid,
       case when v.nn = '08' then 'a0000000-0000-0000-0000-0000000030b0'::uuid else 'a0000000-0000-0000-0000-0000000030a0'::uuid end,
       v.estado, v.decidido, v.texto
from (values
  ('01', 'en_revision'::public.estado_reporte, null::timestamptz, null::text),
  ('02', 'aceptado', timestamptz '2031-01-01 09:00-05', 'Texto original de la 02.'),
  ('03', 'rechazado', timestamptz '2031-01-02 09:00-05', 'Texto original de la 03.'),
  ('04', 'en_revision', null, null), ('05', 'en_revision', null, null), ('06', 'en_revision', null, null),
  ('07', 'en_revision', null, null), ('08', 'en_revision', null, null), ('09', 'en_revision', null, null),
  ('10', 'en_revision', null, null), ('11', 'en_revision', null, null), ('12', 'en_revision', null, null),
  ('13', 'en_revision', null, null), ('14', 'en_revision', null, null), ('15', 'en_revision', null, null),
  ('16', 'en_revision', null, null)) as v(nn, estado, decidido, texto);
insert into public.reporte_inasistencia (id, id_monitoria, id_admin, fecha_reporte)
select '70000000-0000-0000-0000-000000003021'::uuid, '50000000-0000-0000-0000-000000003021'::uuid,
       'a0000000-0000-0000-0000-0000000030a0'::uuid, inicio + interval '30 minutes'
from inicio_30;

-- Ayudas de la prueba (solo como postgres).
-- resolver(admin, nn, decisión, observaciones[, ahora]): llama a la decisión con la identidad de ese admin (nulo, una sesión sin
-- sub) y la hora fija; devuelve el resultado.
create function pg_temp.resolver(p_uid text, p_nn text, p_decision text, p_obs text,
                                 p_ahora timestamptz default timestamptz '2031-12-31 12:00-05') returns text
language plpgsql volatile as $$
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null then '{"role":"authenticated"}'
         else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
  return privado.resolver_reporte_inasistencia(('70000000-0000-0000-0000-0000000030' || p_nn)::uuid, p_decision, p_obs, p_ahora);
end;
$$;
-- como(admin): deja la sesión simulada como ese usuario, para las funciones que leen auth.uid().
create function pg_temp.como(p_uid text) returns void
language sql volatile as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
-- foto(nn, con_reporte): todo lo que cuelga de la monitoría (la monitoría, su reporte, sus pagos, reembolsos, desembolso, avisos
-- al monitor y cancelaciones) en un texto, para ver que un resultado que falla no cambió nada.
create function pg_temp.foto(p_nn text, p_con_reporte boolean default true) returns text
language sql stable as $$
  select concat_ws('#',
    (select string_agg(m::text, '|') from public.monitoria m where m.id = ('50000000-0000-0000-0000-0000000030' || p_nn)::uuid),
    case when p_con_reporte then
      (select string_agg(r::text, '|' order by r.id) from public.reporte_inasistencia r
       where r.id_monitoria = ('50000000-0000-0000-0000-0000000030' || p_nn)::uuid) end,
    (select string_agg(p::text, '|' order by p.id) from public.pago p
     where p.id_monitoria = ('50000000-0000-0000-0000-0000000030' || p_nn)::uuid),
    (select string_agg(x::text, '|' order by x.id) from public.reembolso x join public.pago p on p.id = x.id_pago
     where p.id_monitoria = ('50000000-0000-0000-0000-0000000030' || p_nn)::uuid),
    (select string_agg(d::text, '|' order by d.id) from public.desembolso d
     where d.id_monitoria = ('50000000-0000-0000-0000-0000000030' || p_nn)::uuid),
    (select string_agg(a::text, '|' order by a.id) from public.aviso_monitor a
     where a.id_monitoria = ('50000000-0000-0000-0000-0000000030' || p_nn)::uuid),
    (select string_agg(c::text, '|' order by c.id) from public.cancelacion_cita c
     where c.id_monitoria = ('50000000-0000-0000-0000-0000000030' || p_nn)::uuid))
$$;
-- reembolsos_de(nn): cuántos reembolsos tienen los pagos de la monitoría.
create function pg_temp.reembolsos_de(p_nn text) returns integer
language sql stable as $$
  select count(*)::int from public.reembolso x join public.pago p on p.id = x.id_pago
  where p.id_monitoria = ('50000000-0000-0000-0000-0000000030' || p_nn)::uuid
$$;
-- avisos_de(nn): los eventos del aviso al monitor de la monitoría, ordenados.
create function pg_temp.avisos_de(p_nn text) returns text
language sql stable as $$
  select coalesce(string_agg(a.evento, ',' order by a.evento), '-') from public.aviso_monitor a
  where a.id_monitoria = ('50000000-0000-0000-0000-0000000030' || p_nn)::uuid
$$;
-- La foto de partida de cada caso que debe quedar igual.
create temporary table foto_30 (clave text primary key, antes text not null);
insert into foto_30 select 'e' || nn, pg_temp.foto(nn) from unnest(array['01', '02', '03', '04', '05']) nn;

-- Control: las monitorías y los reportes existen, el turno da A y A, B y C son admins de la prueba.
select ok(
  (select count(*) = 22 from public.monitoria where id::text like '50000000-0000-0000-0000-0000000030%')
  and (select count(*) = 17 from public.reporte_inasistencia where id::text like '70000000-0000-0000-0000-0000000030%')
  and (select count(*) = 3 from public.monitoria_grupal where id_monitoria::text like '50000000-0000-0000-0000-0000000030%')
  and privado.siguiente_admin_activo() = 'a0000000-0000-0000-0000-0000000030a0'
  and not privado.admin_activo('a0000000-0000-0000-0000-0000000030c0')
  and length((select antes from foto_30 where clave = 'e01')) > 100,
  'Control: las 22 monitorías, los 17 reportes y las 3 grupales existen, el primer admin activo es A y C está desactivado');
select ok(
  (select count(*) = 4 from public.desembolso where id_monitoria::text like '50000000-0000-0000-0000-0000000030%'
     and estado = 'pendiente' and id_monitoria in ('50000000-0000-0000-0000-000000003010', '50000000-0000-0000-0000-000000003014',
                                                    '50000000-0000-0000-0000-000000003015', '50000000-0000-0000-0000-000000003016'))
  and (select count(*) = 5 from public.invitacion_resena where id_pago::text like '60000000-0000-0000-0000-00000030%')
  and not exists (select 1 from public.aviso_monitor where id_monitoria::text like '50000000-0000-0000-0000-0000000030%')
  and not exists (select 1 from public.reembolso where id_pago::text like '60000000-0000-0000-0000-00000030%'),
  'Control: pasar a realizada creó los 4 desembolsos pendientes y las 5 invitaciones a reseñar; ningún aviso ni reembolso todavía');

-- ---------------------------------------------------------------------------
-- El check de aviso_monitor: el evento inasistencia_aceptada y los tres de antes
-- ---------------------------------------------------------------------------
select lives_ok(
  $$insert into public.aviso_monitor (id_monitoria, evento) values ('50000000-0000-0000-0000-000000003090', 'inasistencia_aceptada')$$,
  'El check de aviso_monitor acepta el evento inasistencia_aceptada');
select lives_ok(
  $$insert into public.aviso_monitor (id_monitoria, evento) values
    ('50000000-0000-0000-0000-000000003090', 'confirmada'), ('50000000-0000-0000-0000-000000003090', 'cancelada'),
    ('50000000-0000-0000-0000-000000003090', 'pago_rechazado')$$,
  'Y siguen valiendo los tres de antes: confirmada, cancelada y pago_rechazado (HU-051 y HU-076)');
select throws_ok(
  $$insert into public.aviso_monitor (id_monitoria, evento) values ('50000000-0000-0000-0000-000000003090', 'realizada')$$,
  '23514', null, 'Un evento inventado sigue rechazado');
delete from public.aviso_monitor where id_monitoria = '50000000-0000-0000-0000-000000003090';

-- ---------------------------------------------------------------------------
-- privado.motivo_de_inasistencia
-- ---------------------------------------------------------------------------
select results_eq(
  $$select privado.motivo_de_inasistencia(t) from unnest(array[null, '', '  ', E'\n\t', E' \r\n ']::text[]) with ordinality as x(t, o) order by o$$,
  $$select 'El monitor no asistió a la monitoría.'::text from generate_series(1, 5)$$,
  'Sin observaciones (nulas, vacías, solo espacios o solo saltos de línea): el texto base, sin espacio final');
select results_eq(
  $$select privado.motivo_de_inasistencia(t) from unnest(array[' texto ', E'\ntexto\n', E'\t texto \r\n', 'texto']::text[]) with ordinality as x(t, o) order by o$$,
  $$select 'El monitor no asistió a la monitoría. texto'::text from generate_series(1, 4)$$,
  'Con observaciones: el texto base, un espacio y el texto sin los espacios ni saltos de línea de los bordes');
select is(privado.motivo_de_inasistencia('uno  dos' || E'\n' || 'tres'), 'El monitor no asistió a la monitoría. uno  dos' || E'\n' || 'tres',
  'Lo de adentro no se toca: solo se recortan los bordes');
select is(privado.motivo_de_inasistencia(repeat('é', 500)), 'El monitor no asistió a la monitoría. ' || repeat('é', 500),
  'Quinientos caracteres se conservan completos');

-- ---------------------------------------------------------------------------
-- Los resultados que no escriben nada (la 01: confirmada, con un pago aprobado y el reporte de A en revisión)
-- ---------------------------------------------------------------------------
select is(pg_temp.resolver(null, '01', 'aceptar', null), 'sin_sesion', 'Sin sesión (sin sub): sin_sesion');
select is(pg_temp.resolver('b0000000-0000-0000-0000-000000003001', '01', 'aceptar', null), 'sin_permiso',
  'El monitor de la monitoría no es admin: sin_permiso');
select is(pg_temp.resolver('c0000000-0000-0000-0000-000000003001', '01', 'rechazar', null), 'sin_permiso',
  'El Lead (una sesión anónima) tampoco: sin_permiso');
select is(pg_temp.resolver('a0000000-0000-0000-0000-0000000030c0', '01', 'aceptar', null), 'sin_permiso',
  'Un admin desactivado (C, con banned_until) tampoco: sin_permiso');
select results_eq(
  $$select o, pg_temp.resolver('a0000000-0000-0000-0000-0000000030a0', '01', d, null)
    from unnest(array[null, 'x', 'ACEPTAR', 'aceptar ', '']::text[]) with ordinality as t(d, o) order by o$$,
  $$values (1::bigint, 'decision_invalida'::text), (2, 'decision_invalida'), (3, 'decision_invalida'),
           (4, 'decision_invalida'), (5, 'decision_invalida')$$,
  'Una decisión nula, desconocida, en mayúsculas, con espacio o vacía: decision_invalida (se compara tal cual)');
select pg_temp.como('a0000000-0000-0000-0000-0000000030a0');
select is(privado.resolver_reporte_inasistencia(gen_random_uuid(), 'aceptar', null, timestamptz '2031-12-31 12:00-05'),
  'no_encontrado', 'Un reporte que no existe: no_encontrado');
select is(privado.resolver_reporte_inasistencia(null, 'rechazar', null, timestamptz '2031-12-31 12:00-05'),
  'no_encontrado', 'Un id nulo: no_encontrado');
select is(pg_temp.resolver('a0000000-0000-0000-0000-0000000030b0', '01', 'aceptar', 'Intento de B.'), 'no_asignado',
  'El reporte es de A y decide B: no_asignado');
select is(pg_temp.resolver('a0000000-0000-0000-0000-0000000030b0', '01', 'rechazar', repeat('x', 501)), 'no_asignado',
  'B con observaciones de 501 caracteres: no_asignado y no observaciones_invalidas (quién puede va antes que el texto)');
select is(pg_temp.resolver('a0000000-0000-0000-0000-0000000030a0', '01', 'aceptar', repeat('x', 501)), 'observaciones_invalidas',
  'A con 501 caracteres: observaciones_invalidas');
select is(pg_temp.resolver('a0000000-0000-0000-0000-0000000030a0', '01', 'rechazar', repeat('é', 501)), 'observaciones_invalidas',
  'Al rechazar también, y se cuentan caracteres: 501 «é» son 1002 bytes pero un solo carácter de más');
select is(pg_temp.foto('01'), (select antes from foto_30 where clave = 'e01'),
  'Ninguno de esos intentos tocó nada de la 01: ni la monitoría, ni el reporte, ni el pago, ni los reembolsos, avisos o desembolso');

-- ya_decidido: la 02 (aceptado) y la 03 (rechazado), con otra decisión y otro texto.
select results_eq(
  $$select nn, d, pg_temp.resolver('a0000000-0000-0000-0000-0000000030a0', nn, d, 'Otro texto.')
    from (values ('02', 'aceptar'), ('02', 'rechazar'), ('03', 'aceptar'), ('03', 'rechazar')) as v(nn, d) order by nn, d$$,
  $$values ('02'::text, 'aceptar'::text, 'ya_decidido'::text), ('02', 'rechazar', 'ya_decidido'),
           ('03', 'aceptar', 'ya_decidido'), ('03', 'rechazar', 'ya_decidido')$$,
  'Un reporte ya aceptado o ya rechazado: ya_decidido, con cualquier decisión (una decisión no se cambia)');
select ok(
  pg_temp.foto('02') = (select antes from foto_30 where clave = 'e02')
  and pg_temp.foto('03') = (select antes from foto_30 where clave = 'e03'),
  'Y no pisa nada: la fecha y las observaciones del primero siguen, y ni la monitoría ni los pagos cambiaron');
select results_eq(
  $$select right(id_monitoria::text, 2), estado::text, fecha_decision, observaciones from public.reporte_inasistencia
    where id in ('70000000-0000-0000-0000-000000003002', '70000000-0000-0000-0000-000000003003') order by id$$,
  $$values ('02'::text, 'aceptado'::text, timestamptz '2031-01-01 09:00-05', 'Texto original de la 02.'::text),
           ('03', 'rechazado', timestamptz '2031-01-02 09:00-05', 'Texto original de la 03.')$$,
  'Los dos reportes conservan su estado, su fecha y su texto');

-- no_individual: la 04 es grupal (su reporte, insertado directo, es de HU-045).
select results_eq(
  $$select d, pg_temp.resolver('a0000000-0000-0000-0000-0000000030a0', '04', d, null) from unnest(array['aceptar', 'rechazar']) d order by d$$,
  $$values ('aceptar'::text, 'no_individual'::text), ('rechazar', 'no_individual')$$,
  'Una grupal: no_individual con las dos decisiones (los reportes de las grupales llegan con HU-045)');
select is(pg_temp.foto('04'), (select antes from foto_30 where clave = 'e04'), 'Y no tocó nada de la 04');

-- no_aceptable: la 05 ya estaba cancelada por el estudiante.
select is(pg_temp.resolver('a0000000-0000-0000-0000-0000000030a0', '05', 'aceptar', null), 'no_aceptable',
  'Aceptar sobre una monitoría ya cancelada (por el estudiante): no_aceptable');
select is(pg_temp.foto('05'), (select antes from foto_30 where clave = 'e05'), 'Y no tocó nada de la 05');
select is(pg_temp.resolver('a0000000-0000-0000-0000-0000000030a0', '05', 'rechazar', 'No procede: ya la había cancelado.'), 'rechazado',
  'Rechazar sí se puede sobre una cancelada: rechazado');
select results_eq(
  $$select m.estado::text, m.motivo_cancelacion::text, r.estado::text, r.observaciones,
           pg_temp.reembolsos_de('05'), pg_temp.avisos_de('05')
    from public.monitoria m, public.reporte_inasistencia r
    where m.id = '50000000-0000-0000-0000-000000003005' and r.id_monitoria = m.id$$,
  $$values ('cancelada'::text, 'estudiante'::text, 'rechazado'::text, 'No procede: ya la había cancelado.'::text, 0, '-'::text)$$,
  'La 05 sigue cancelada por el estudiante, con su reporte rechazado, sin reembolsos y sin aviso al monitor');

-- ---------------------------------------------------------------------------
-- Aceptar desde confirmada (la 06: un pago aprobado, uno en revisión y uno rechazado con su caso P-24 abierto)
-- ---------------------------------------------------------------------------
select is(
  (select privado.estado_caso_p24(p.estado, m.estado, p.cierre_rechazo) from public.pago p
   join public.monitoria m on m.id = p.id_monitoria where p.id = '60000000-0000-0000-0000-000000300603'),
  'abierto', 'Control: el pago rechazado de la 06 es un caso P-24 abierto mientras la monitoría siga confirmada');
select is(pg_temp.resolver('a0000000-0000-0000-0000-0000000030a0', '06', 'aceptar', E'  Comentario del admin.\n'), 'aceptado',
  'A acepta el reporte de la 06 con un comentario con espacios y un salto de línea a los lados: aceptado');
select results_eq(
  $$select estado::text, motivo_cancelacion::text, fecha_finalizacion is null
    from public.monitoria where id = '50000000-0000-0000-0000-000000003006'$$,
  $$values ('cancelada'::text, 'monitor_no_asistio'::text, true)$$,
  'La monitoría queda cancelada por monitor_no_asistio (criterio 1)');
select results_eq(
  $$select estado::text, fecha_decision, observaciones, id_admin
    from public.reporte_inasistencia where id = '70000000-0000-0000-0000-000000003006'$$,
  $$values ('aceptado'::text, timestamptz '2031-12-31 12:00-05', 'Comentario del admin.'::text, 'a0000000-0000-0000-0000-0000000030a0'::uuid)$$,
  'El reporte queda aceptado con la fecha de la decisión y las observaciones sin los espacios ni el salto de línea de los lados (criterio 5)');
select is((select count(*)::int from public.desembolso where id_monitoria = '50000000-0000-0000-0000-000000003006'), 0,
  'No había desembolso (la monitoría aún no se había realizado) y no se crea ninguno');
select results_eq(
  $$select right(r.id_pago::text, 4), r.estado::text, r.monto, r.id_admin, r.motivo, r.llave_destino is null, r.cerrado_en is null
    from public.reembolso r join public.pago p on p.id = r.id_pago where p.id_monitoria = '50000000-0000-0000-0000-000000003006'$$,
  $$values ('0601'::text, 'esperando_llave'::text, 20000, 'a0000000-0000-0000-0000-0000000030a0'::uuid,
            'El monitor no asistió a la monitoría. Comentario del admin.'::text, true, true)$$,
  'Un solo reembolso, del pago aprobado: esperando la llave, por el monto completo, del primer admin activo y con el motivo de D-37 más el comentario (criterio 2)');
select results_eq(
  $$select s.en_correo_de_cancelacion, pl.tipo from public.reembolso r join public.pago p on p.id = r.id_pago
    join public.solicitud_llave s on s.id_reembolso = r.id join public.pedido_llave pl on pl.id_reembolso = r.id
    where p.id_monitoria = '50000000-0000-0000-0000-000000003006'$$,
  $$values (false, 'pedido'::text)$$,
  'Los triggers de reembolso anotaron su solicitud de llave y un pedido de tipo pedido (lo manda HU-025)');
select results_eq(
  $$select evento, procesado_en is null, intentos from public.aviso_monitor where id_monitoria = '50000000-0000-0000-0000-000000003006'$$,
  $$values ('inasistencia_aceptada'::text, true, 0)$$,
  'El trigger de la monitoría anotó el aviso al monitor inasistencia_aceptada, sin procesar (criterio 3)');
select results_eq(
  $$select right(id::text, 4), estado::text from public.pago where id_monitoria = '50000000-0000-0000-0000-000000003006' order by id$$,
  $$values ('0601'::text, 'aprobado'::text), ('0602', 'en_revision'), ('0603', 'rechazado')$$,
  'Los pagos no cambian de estado: el aprobado sigue aprobado, el que estaba en revisión sigue en revisión y el rechazado, rechazado');
select is(
  (select count(*)::int from public.invitacion_resena where id_pago::text like '60000000-0000-0000-0000-00000030060%')
  + (select count(*)::int from public.cancelacion_cita where id_monitoria = '50000000-0000-0000-0000-000000003006'), 0,
  'Aceptar no anota ninguna invitación a reseñar ni cancelacion_cita (el correo de D-27 es del Lead que cancela)');
select is(
  (select privado.estado_caso_p24(p.estado, m.estado, p.cierre_rechazo) from public.pago p
   join public.monitoria m on m.id = p.id_monitoria where p.id = '60000000-0000-0000-0000-000000300603'),
  null::text, 'El pago rechazado de la 06 deja de ser un caso P-24: con la monitoría cancelada, estado_caso_p24 da nulo');
select pg_temp.como('a0000000-0000-0000-0000-0000000030a0');
select is(privado.cerrar_caso_p24('60000000-0000-0000-0000-000000300603', 'asumido', null, timestamptz '2031-12-31 12:00-05'),
  'no_es_caso', 'Y cerrar_caso_p24 responde no_es_caso: sale solo de «Pagos por cobrar o asumir»');

-- Segunda llamada: un doble clic o una página vieja.
insert into foto_30 values ('d06', pg_temp.foto('06'));
select results_eq(
  $$select d, pg_temp.resolver('a0000000-0000-0000-0000-0000000030a0', '06', d, 'Otro comentario.') from unnest(array['aceptar', 'rechazar']) d order by d$$,
  $$values ('aceptar'::text, 'ya_decidido'::text), ('rechazar', 'ya_decidido')$$,
  'Una segunda llamada, aceptando o rechazando: ya_decidido');
select is(pg_temp.foto('06'), (select antes from foto_30 where clave = 'd06'),
  'Sin segundo reembolso, sin segundo aviso y sin pisar nada: la fecha y las observaciones son las de la primera decisión');

-- Quién decide: la 08 es del reporte de B (que no es el primero del turno) y lo decide B, sin observaciones.
select is(pg_temp.resolver('a0000000-0000-0000-0000-0000000030b0', '08', 'aceptar', null), 'aceptado',
  'B acepta el reporte de la 08, que es suyo: aceptado');
select results_eq(
  $$select right(r.id_pago::text, 4), r.id_admin, r.monto, r.motivo
    from public.reembolso r join public.pago p on p.id = r.id_pago where p.id_monitoria = '50000000-0000-0000-0000-000000003008'$$,
  $$values ('0801'::text, 'a0000000-0000-0000-0000-0000000030a0'::uuid, 20000,
            'El monitor no asistió a la monitoría.'::text)$$,
  'El reembolso es del primer admin activo (A, D-26) y no de quien decide (B), y sin observaciones el motivo no lleva espacio final');
select results_eq(
  $$select estado::text, fecha_decision, observaciones, id_admin
    from public.reporte_inasistencia where id = '70000000-0000-0000-0000-000000003008'$$,
  $$values ('aceptado'::text, timestamptz '2031-12-31 12:00-05', null::text, 'a0000000-0000-0000-0000-0000000030b0'::uuid)$$,
  'El reporte queda aceptado, sin observaciones, y sigue siendo de B');

-- Tres pagos aprobados (dos contactos): tres reembolsos, un pedido por reembolso y un solo aviso. Y los casos abiertos de A.
select pg_temp.como('a0000000-0000-0000-0000-0000000030a0');
create temporary table casos_30 (k text primary key, v integer not null);
insert into casos_30 select 'antes', casos_abiertos from privado.equipo_de_admins() where id = 'a0000000-0000-0000-0000-0000000030a0';
select is(pg_temp.resolver('a0000000-0000-0000-0000-0000000030a0', '09', 'aceptar', 'Nunca apareció.'), 'aceptado',
  'A acepta el reporte de la 09, que tiene tres pagos aprobados de dos contactos: aceptado');
select results_eq(
  $$select right(r.id_pago::text, 4), r.estado::text, r.monto, r.id_admin, r.motivo
    from public.reembolso r join public.pago p on p.id = r.id_pago where p.id_monitoria = '50000000-0000-0000-0000-000000003009'
    order by r.id_pago$$,
  $$values ('0901'::text, 'esperando_llave'::text, 20000, 'a0000000-0000-0000-0000-0000000030a0'::uuid, 'El monitor no asistió a la monitoría. Nunca apareció.'::text),
           ('0902', 'esperando_llave', 20000, 'a0000000-0000-0000-0000-0000000030a0', 'El monitor no asistió a la monitoría. Nunca apareció.'),
           ('0903', 'esperando_llave', 20000, 'a0000000-0000-0000-0000-0000000030a0', 'El monitor no asistió a la monitoría. Nunca apareció.')$$,
  'Un reembolso por cada pago aprobado, con el mismo motivo, aunque dos pagos sean del mismo contacto');
select is(
  (select count(*)::int from public.pedido_llave pl join public.reembolso r on r.id = pl.id_reembolso
   join public.pago p on p.id = r.id_pago where p.id_monitoria = '50000000-0000-0000-0000-000000003009' and pl.tipo = 'pedido')
  + (select count(*)::int from public.solicitud_llave s join public.reembolso r on r.id = s.id_reembolso
     join public.pago p on p.id = r.id_pago where p.id_monitoria = '50000000-0000-0000-0000-000000003009'), 6,
  'Cada reembolso tiene su solicitud de llave y un solo pedido: tres y tres');
select is(pg_temp.avisos_de('09'), 'inasistencia_aceptada', 'Y el monitor recibe un solo aviso, no uno por pago');
select is((select count(*)::int from public.aviso_monitor where id_monitoria = '50000000-0000-0000-0000-000000003009'), 1,
  'Una sola fila de aviso para la 09');
select pg_temp.como('a0000000-0000-0000-0000-0000000030a0');
insert into casos_30 select 'despues', casos_abiertos from privado.equipo_de_admins() where id = 'a0000000-0000-0000-0000-0000000030a0';
select is((select v from casos_30 where k = 'despues') - (select v from casos_30 where k = 'antes'), 2,
  'Los casos abiertos de A bajan en uno (el reporte ya no está en revisión) y suben en tres (los reembolsos): +2 (equipo_de_admins)');

-- ---------------------------------------------------------------------------
-- P-07 por la puerta real (la 07: dos pagos en revisión y uno aprobado)
-- ---------------------------------------------------------------------------
select is(pg_temp.resolver('a0000000-0000-0000-0000-0000000030a0', '07', 'aceptar', 'Sin llegar.'), 'aceptado',
  'A acepta el reporte de la 07, que tiene un pago aprobado y dos en revisión: aceptado');
select results_eq(
  $$select right(r.id_pago::text, 4) from public.reembolso r join public.pago p on p.id = r.id_pago
    where p.id_monitoria = '50000000-0000-0000-0000-000000003007'$$,
  $$values ('0703'::text)$$,
  'Solo el pago aprobado tiene reembolso: los dos que están en revisión no generan nada todavía');
select pg_temp.como('a0000000-0000-0000-0000-0000000030a0');
select results_eq(
  $$select resultado, cancelo_monitoria from privado.revisar_pago('60000000-0000-0000-0000-000000300701', 'aprobar', null, timestamptz '2031-12-31 12:00-05')$$,
  $$values ('aprobado'::text, false)$$,
  'revisar_pago aprueba el pago en revisión de una monitoría cancelada por inasistencia: aprobado');
select results_eq(
  $$select r.estado::text, r.monto, r.id_admin, r.motivo, s.en_correo_de_cancelacion, pl.tipo
    from public.reembolso r join public.solicitud_llave s on s.id_reembolso = r.id join public.pedido_llave pl on pl.id_reembolso = r.id
    where r.id_pago = '60000000-0000-0000-0000-000000300701'$$,
  $$values ('esperando_llave'::text, 20000, 'a0000000-0000-0000-0000-0000000030a0'::uuid,
            'El monitor no asistió a la monitoría. Sin llegar.'::text, false, 'pedido'::text)$$,
  'P-07: al aprobarse nace su reembolso, esperando la llave, del primer admin activo y con el mismo motivo y el comentario del reporte, con su solicitud y su pedido');
select results_eq(
  $$select resultado, cancelo_monitoria from privado.revisar_pago('60000000-0000-0000-0000-000000300702', 'rechazar', 'Comprobante ilegible.', timestamptz '2031-12-31 12:00-05')$$,
  $$values ('rechazado'::text, false)$$,
  'El otro pago en revisión se rechaza: rechazado (la monitoría ya estaba cancelada, no se cancela otra vez)');
select is(
  (select count(*)::int from public.reembolso where id_pago = '60000000-0000-0000-0000-000000300702')
  + (select count(*)::int from public.aviso_rechazo_pago where id_pago = '60000000-0000-0000-0000-000000300702'), 0,
  'El pago rechazado después de aceptar no deja reembolso ni aviso al pagador (RN-43; el correo es la pregunta 6)');
select ok(pg_temp.reembolsos_de('07') = 2 and pg_temp.avisos_de('07') = 'inasistencia_aceptada',
  'La 07 queda con dos reembolsos (el aprobado antes y el aprobado después) y un solo aviso al monitor');

-- Regresión y bordes de la función ampliada.
update public.pago set estado = 'aprobado', fecha_revision = now() where id = '60000000-0000-0000-0000-000000301701';
select results_eq(
  $$select estado::text, id_admin, monto, motivo from public.reembolso where id_pago = '60000000-0000-0000-0000-000000301701'$$,
  $$values ('esperando_llave'::text, 'a0000000-0000-0000-0000-0000000030a0'::uuid, 20000, 'El monitor no asistió a la monitoría.'::text)$$,
  'Una monitoría cancelada por monitor_no_asistio sin reporte (la 17): el pago aprobado después recibe el motivo base');
update public.pago set estado = 'aprobado', fecha_revision = now() where id = '60000000-0000-0000-0000-000000301801';
select results_eq(
  $$select estado::text, id_admin, monto, motivo from public.reembolso where id_pago = '60000000-0000-0000-0000-000000301801'$$,
  $$values ('esperando_llave'::text, 'a0000000-0000-0000-0000-0000000030a0'::uuid, 20000, 'Cancelaste la monitoría dentro del plazo.'::text)$$,
  'Regresión: con la monitoría cancelada por el estudiante (la 18) el motivo sigue siendo «Cancelaste la monitoría dentro del plazo.»');
update public.pago set estado = 'aprobado', fecha_revision = now() where id = '60000000-0000-0000-0000-000000301901';
select is((select count(*)::int from public.reembolso where id_pago = '60000000-0000-0000-0000-000000301901'), 0,
  'Una grupal cancelada por monitor_no_asistio (la 19) no crea ningún reembolso al aprobarse un pago');
update public.monitoria set estado = 'cancelada', motivo_cancelacion = 'monitor_no_asistio' where id = '50000000-0000-0000-0000-000000003020';
select is(pg_temp.avisos_de('20'), '-', 'Una grupal confirmada que se cancela por monitor_no_asistio tampoco anota aviso al monitor');

-- ---------------------------------------------------------------------------
-- Aceptar desde realizada
-- ---------------------------------------------------------------------------
-- La 10: realizada de 2020 con desembolso pendiente.
select is(pg_temp.resolver('a0000000-0000-0000-0000-0000000030a0', '10', 'aceptar', 'El monitor nunca se conectó.'), 'aceptado',
  'A acepta el reporte de la 10, que ya estaba realizada y con su desembolso pendiente: aceptado');
select results_eq(
  $$select estado::text, motivo_cancelacion::text, fecha_finalizacion from public.monitoria where id = '50000000-0000-0000-0000-000000003010'$$,
  $$values ('cancelada'::text, 'monitor_no_asistio'::text, timestamptz '2020-01-06 11:00-05')$$,
  'La realizada pasa a cancelada por monitor_no_asistio y conserva su fecha_finalizacion (RN-65)');
select results_eq(
  $$select d.estado::text, e.motivo from public.desembolso d, privado.estado_para_ejecutar(d.id, now()) e
    where d.id_monitoria = '50000000-0000-0000-0000-000000003010'$$,
  $$values ('anulado'::text, 'anulado'::text)$$,
  'El desembolso pendiente queda anulado (P-28) y la página del desembolso lo dice');
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000030a0","role":"authenticated"}';
select is((select count(*)::int from public.desembolsos_ejecutables where id_monitoria = '50000000-0000-0000-0000-000000003010'), 0,
  'Un anulado no sale en la bandeja de desembolsos ejecutables');
reset role;
select is(pg_temp.avisos_de('10'), 'inasistencia_aceptada', 'El aviso al monitor sale también de una realizada');
select results_eq(
  $$select right(r.id_pago::text, 4), r.estado::text, r.motivo from public.reembolso r join public.pago p on p.id = r.id_pago
    where p.id_monitoria = '50000000-0000-0000-0000-000000003010'$$,
  $$values ('1001'::text, 'esperando_llave'::text, 'El monitor no asistió a la monitoría. El monitor nunca se conectó.'::text)$$,
  'Y el pago aprobado recibe su reembolso con el comentario');
set local role service_role;
select is((select count(*)::int from public.invitaciones_resena_por_procesar(100) where id_pago = '60000000-0000-0000-0000-000000301001'), 0,
  'HU-080: tras aceptar, la invitación a reseñar de la 10 no vuelve a la cola (el reporte aceptado la bloquea)');
reset role;

-- La 11: realizada con el desembolso ya transferido (insertado directo): no se toca.
select is(pg_temp.resolver('a0000000-0000-0000-0000-0000000030a0', '11', 'aceptar', null), 'aceptado',
  'Con el desembolso ya transferido (la 11) la decisión se guarda igual: aceptado');
select results_eq(
  $$select estado::text, referencia_transferencia, fecha_desembolso, id_admin from public.desembolso
    where id_monitoria = '50000000-0000-0000-0000-000000003011'$$,
  $$values ('desembolsado'::text, 'REF-30-11'::text, timestamptz '2020-01-20 12:00-05', 'a0000000-0000-0000-0000-0000000030a0'::uuid)$$,
  'El desembolso transferido no se toca: el dinero ya salió (supuesto 9)');
select results_eq(
  $$select m.estado::text, m.motivo_cancelacion::text, m.fecha_finalizacion, pg_temp.reembolsos_de('11'), pg_temp.avisos_de('11')
    from public.monitoria m where m.id = '50000000-0000-0000-0000-000000003011'$$,
  $$values ('cancelada'::text, 'monitor_no_asistio'::text, timestamptz '2020-01-13 11:00-05', 1, 'inasistencia_aceptada'::text)$$,
  'La monitoría igual queda cancelada, con su fecha_finalizacion, un reembolso y el aviso al monitor');

-- ---------------------------------------------------------------------------
-- Rechazar
-- ---------------------------------------------------------------------------
insert into foto_30 select 'r' || nn, pg_temp.foto(nn, false) from unnest(array['12', '13', '14', '15', '16']) nn;

-- La 12: quinientos caracteres de dos bytes.
select is(pg_temp.resolver('a0000000-0000-0000-0000-0000000030a0', '12', 'rechazar', repeat('é', 500)), 'rechazado',
  'A rechaza el reporte de la 12 con 500 «é» (1000 bytes): rechazado; el largo cuenta caracteres');
select results_eq(
  $$select estado::text, fecha_decision, observaciones = repeat('é', 500), id_admin
    from public.reporte_inasistencia where id = '70000000-0000-0000-0000-000000003012'$$,
  $$values ('rechazado'::text, timestamptz '2031-12-31 12:00-05', true, 'a0000000-0000-0000-0000-0000000030a0'::uuid)$$,
  'El reporte queda rechazado con su fecha y sus observaciones completas (criterio 5)');
select is(pg_temp.foto('12', false), (select antes from foto_30 where clave = 'r12'),
  'Rechazar no cambia nada más: ni la monitoría, ni los pagos, ni el desembolso; sin reembolsos, sin aviso al monitor y sin cancelacion_cita');

-- La 13: observaciones en blanco son ninguna.
select is(pg_temp.resolver('a0000000-0000-0000-0000-0000000030a0', '13', 'rechazar', E' \n\t '), 'rechazado',
  'Rechazar con observaciones en blanco (espacios, saltos de línea y tabulaciones): rechazado');
select results_eq(
  $$select estado::text, fecha_decision, observaciones from public.reporte_inasistencia where id = '70000000-0000-0000-0000-000000003013'$$,
  $$values ('rechazado'::text, timestamptz '2031-12-31 12:00-05', null::text)$$,
  'Y quedan sin observaciones (nulas), sin chocar con reporte_observaciones_con_texto');
select is(pg_temp.foto('13', false), (select antes from foto_30 where clave = 'r13'), 'La 13 tampoco cambió en nada más');

-- La 14: realizada de 2020 con un pago aprobado: el desembolso vuelve a ser ejecutable (RN-83) y la invitación a reseñar vuelve a la cola (HU-080).
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000030a0","role":"authenticated"}';
select is((select count(*)::int from public.desembolsos_ejecutables where id_monitoria = '50000000-0000-0000-0000-000000003014'), 0,
  'Control: con el reporte en revisión el desembolso de la 14 no es ejecutable (RN-83)');
reset role;
set local role service_role;
select is((select count(*)::int from public.invitaciones_resena_por_procesar(100) where id_pago = '60000000-0000-0000-0000-000000301401'), 0,
  'Control: con el reporte en revisión la invitación a reseñar de la 14 no se procesa');
reset role;
select is(pg_temp.resolver('a0000000-0000-0000-0000-0000000030a0', '14', 'rechazar', 'No hay evidencia de la inasistencia.'), 'rechazado',
  'A rechaza el reporte de la 14: rechazado');
select is(pg_temp.foto('14', false), (select antes from foto_30 where clave = 'r14'),
  'La monitoría realizada, su pago y su desembolso pendiente quedan exactamente como estaban');
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000030a0","role":"authenticated"}';
select is((select count(*)::int from public.desembolsos_ejecutables where id_monitoria = '50000000-0000-0000-0000-000000003014'), 1,
  'El desembolso vuelve a ser ejecutable: la bandeja de desembolsos lo lista otra vez (criterio 4)');
reset role;
select is(
  (select e.motivo from public.desembolso d, privado.estado_para_ejecutar(d.id, now()) e where d.id_monitoria = '50000000-0000-0000-0000-000000003014'),
  null::text, 'Y la página del desembolso no ve nada que lo bloquee (estado_para_ejecutar da nulo)');
set local role service_role;
select is((select count(*)::int from public.invitaciones_resena_por_procesar(100) where id_pago = '60000000-0000-0000-0000-000000301401'), 1,
  'HU-080: la invitación a reseñar de la 14 vuelve a la cola al rechazar el reporte');
reset role;

-- La 15: igual, pero con un pago en revisión: sigue bloqueado por eso, no por el reporte.
select is(pg_temp.resolver('a0000000-0000-0000-0000-0000000030a0', '15', 'rechazar', null), 'rechazado',
  'A rechaza el reporte de la 15, que tiene un pago aprobado y uno en revisión: rechazado');
select is(
  (select e.motivo from public.desembolso d, privado.estado_para_ejecutar(d.id, now()) e where d.id_monitoria = '50000000-0000-0000-0000-000000003015'),
  'pagos_en_revision', 'El desembolso sigue bloqueado, pero por el pago en revisión y no por el reporte (HU-078)');
select is(pg_temp.foto('15', false), (select antes from foto_30 where clave = 'r15'), 'La 15 no cambió en nada más');

-- La 16: realizada de 2030, todavía dentro de la ventana de reporte.
select is(pg_temp.resolver('a0000000-0000-0000-0000-0000000030a0', '16', 'rechazar', 'Se conectó.'), 'rechazado',
  'A rechaza el reporte de la 16, cuya sesión es de 2030: rechazado');
select is(
  (select e.motivo from public.desembolso d, privado.estado_para_ejecutar(d.id, now()) e where d.id_monitoria = '50000000-0000-0000-0000-000000003016'),
  'antes_de_plazo', 'Su desembolso sigue sin ser ejecutable por el plazo (antes_de_plazo), no por el reporte');
select is(pg_temp.foto('16', false), (select antes from foto_30 where clave = 'r16'), 'La 16 no cambió en nada más');

-- ---------------------------------------------------------------------------
-- Puertas con now() (la 21: empezó hace 2 horas)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"role":"authenticated"}';
select is(public.resolver_reporte_inasistencia('70000000-0000-0000-0000-000000003021', 'aceptar', null), 'sin_sesion',
  'La puerta, sin sub en la sesión: sin_sesion');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-000000003001","role":"authenticated"}';
select is(public.resolver_reporte_inasistencia('70000000-0000-0000-0000-000000003021', 'aceptar', null), 'sin_permiso',
  'La puerta, con la sesión del monitor: sin_permiso');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000030a0","role":"authenticated"}';
select is(public.resolver_reporte_inasistencia('70000000-0000-0000-0000-000000003021', 'aceptar', 'No se conectó nadie.'), 'aceptado',
  'La puerta, con la sesión de A: aceptado');
select is(public.resolver_reporte_inasistencia('70000000-0000-0000-0000-000000003021', 'rechazar', null), 'ya_decidido',
  'Un doble clic por la puerta: ya_decidido');
reset role;
select results_eq(
  $$select r.estado::text, r.fecha_decision = now(), r.observaciones, pg_temp.reembolsos_de('21'), pg_temp.avisos_de('21')
    from public.reporte_inasistencia r where r.id = '70000000-0000-0000-0000-000000003021'$$,
  $$values ('aceptado'::text, true, 'No se conectó nadie.'::text, 1, 'inasistencia_aceptada'::text)$$,
  'Con now() la fecha de la decisión es la hora de la base; un reembolso y un aviso, a pesar del segundo intento');

-- ---------------------------------------------------------------------------
-- Un reporte no se repite
-- ---------------------------------------------------------------------------
select results_eq(
  $$select nn, privado.reportar_inasistencia(('50000000-0000-0000-0000-0000000030' || nn)::uuid, timestamptz '2031-12-31 12:00-05')
    from unnest(array['06', '12']) nn order by nn$$,
  $$values ('06'::text, 'ya_reportada'::text), ('12', 'ya_reportada')$$,
  'Tras aceptar (la 06) o rechazar (la 12), reportar otra vez da ya_reportada: hay un solo reporte por monitoría');

-- ---------------------------------------------------------------------------
-- Escrituras directas: nadie con sesión escribe fuera de la función
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000030a0","role":"authenticated"}';
select throws_ok(
  $$update public.reporte_inasistencia set estado = 'aceptado' where id = '70000000-0000-0000-0000-000000003001'$$,
  '42501', null, 'Un admin no actualiza reporte_inasistencia por la Data API: permiso denegado');
select throws_ok(
  $$update public.monitoria set estado = 'cancelada', motivo_cancelacion = 'monitor_no_asistio' where id = '50000000-0000-0000-0000-000000003001'$$,
  '42501', null, 'Ni monitoria');
select throws_ok(
  $$update public.desembolso set estado = 'anulado' where id_monitoria = '50000000-0000-0000-0000-000000003014'$$,
  '42501', null, 'Ni desembolso');
select throws_ok(
  $$update public.reembolso set motivo = 'otro' where id_pago = '60000000-0000-0000-0000-000000300601'$$,
  '42501', null, 'Ni reembolso');
reset role;

-- ---------------------------------------------------------------------------
-- reasignar_casos_de_admin (P-44): mueve los reportes en revisión y no toca los decididos
-- ---------------------------------------------------------------------------
-- Al final, porque mueve todo lo que A tiene abierto: quedan en revisión solo la 01 y la 04.
select ok(
  (select count(*) = 2 from public.reporte_inasistencia
   where id::text like '70000000-0000-0000-0000-0000000030%' and estado = 'en_revision'
     and id in ('70000000-0000-0000-0000-000000003001', '70000000-0000-0000-0000-000000003004')),
  'Control: solo la 01 y la 04 siguen en revisión');
select ok(privado.reasignar_casos_de_admin('a0000000-0000-0000-0000-0000000030a0') > 0,
  'reasignar_casos_de_admin(A) mueve los casos abiertos de A');
select results_eq(
  $$select right(id_monitoria::text, 2), id_admin from public.reporte_inasistencia
    where id in ('70000000-0000-0000-0000-000000003001', '70000000-0000-0000-0000-000000003004',
                 '70000000-0000-0000-0000-000000003002', '70000000-0000-0000-0000-000000003003',
                 '70000000-0000-0000-0000-000000003006', '70000000-0000-0000-0000-000000003012') order by 1$$,
  $$values ('01'::text, 'a0000000-0000-0000-0000-0000000030b0'::uuid), ('02', 'a0000000-0000-0000-0000-0000000030a0'),
           ('03', 'a0000000-0000-0000-0000-0000000030a0'), ('04', 'a0000000-0000-0000-0000-0000000030b0'),
           ('06', 'a0000000-0000-0000-0000-0000000030a0'), ('12', 'a0000000-0000-0000-0000-0000000030a0')$$,
  'Los reportes en revisión (01 y 04) pasan a B; los decididos (02 y 03 de antes, 06 aceptado y 12 rechazado) se quedan con A');

select * from finish();
rollback;
