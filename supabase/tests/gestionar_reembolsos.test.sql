-- Pruebas pgTAP de registrar la transferencia de un reembolso (HU-026).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.
--
-- Qué cubre la migración 20261004055644_gestionar_reembolsos.sql:
--   * El check de la referencia (reembolso_referencia_con_texto).
--   * privado.ejecutar_reembolso: cada resultado y su orden (quién puede antes que el texto; el texto antes que el
--     estado), los bordes de la fecha en Bogotá con p_ahora, y que el éxito no cambia el admin, la llave, el monto ni el
--     motivo. Sus envoltorios con now() y los permisos de las cuatro funciones.
--   * public.estado_de_reembolso: el estado de la página (cerrado aunque el cierre de pg_cron no haya corrido, con el
--     borde de P-40) y que solo un admin activo recibe filas.
--   * Lo que ya existía sigue igual con un reembolsado: la pantalla del equipo, entregar la llave, la página de la llave,
--     reabrir, reenviar y reasignar al desactivar (HU-025, HU-074).
-- Lo que necesita dos conexiones (un doble clic, entregar la llave o reasignar mientras se registra) lo cubre la prueba de
-- integración.
--
-- No depende del reloj: los reembolsos de privado.ejecutar_reembolso son de diciembre de 2031 y se llaman con p_ahora =
-- miércoles 31-dic-2031 12:00 en Bogotá, salvo en los bordes. Las puertas y estado_de_reembolso, que usan now() (fijo
-- dentro de la transacción), se prueban con un reembolso creado en 2020 y con plazos relativos a now(): ningún caso que
-- espera la llave con un plazo fijo de 2031 pasa por estado_de_reembolso (el 04 vencería el 4-ene-2032).
--
-- El turno de admins recorre a TODOS los admins de la base: los que ya existían se banean dentro de la transacción y los de
-- esta prueba llevan un orden_revision negativo, por delante de cualquier otro (A antes que B y C).
--
-- Elenco (ids terminados en 26NN; la materia es 'PGTAP-26'):
--   Admins A (-2600, el asignado), B (-2599, activo) y C (-2598, desactivado). Monitor M. Lead 01 con su sesión anónima.
--   Una monitoría cancelada por el estudiante y un pago aprobado por reembolso (pago 26NN, reembolso 26NN, motivo
--   'Prueba NN', 20.000; los de 2031 se crearon el 1-dic-2031 a las 10:00 en Bogotá salvo que se diga otra cosa):
--     01 pendiente de A (el éxito; después, lo que ya existía)     02 pendiente de B     03 pendiente sin admin (D-28)
--     04 esperando de A, abierto (desde el 28-dic)     05 esperando de A, cerrado     06 reembolsado por A
--     07 pendiente de A creado el 20-dic-2031 a las 21:00 en Bogotá (en UTC ya es el 21): el borde inferior de la fecha
--     08 pendiente de A (la fecha de hoy)     09 pendiente de A (hoy desde las 00:00 en Bogotá)     10 pendiente de A (la
--     referencia de 100 caracteres de dos bytes)     11 pendiente de A creado en 2020 (las puertas con now())
--     12 esperando de A desde hace 7 días exactos y 13 desde hace 7 días y un microsegundo (el borde de P-40 con now())
--     14 pendiente de C, el desactivado (RN-23 aunque sea suyo)     15 esperando de B desde hace un día (abierto con now())

begin;
create extension if not exists pgtap with schema extensions;

select plan(62);

-- ---------------------------------------------------------------------------
-- Estructura y permisos
-- ---------------------------------------------------------------------------
select has_function('privado', 'ejecutar_reembolso', array['uuid', 'text', 'date', 'timestamp with time zone'],
  'Existe privado.ejecutar_reembolso, la que escribe en reembolso, con la hora como parámetro (para probar los bordes)');
select has_function('privado', 'ejecutar_reembolso_de_la_sesion', array['uuid', 'text', 'date'],
  'Existe privado.ejecutar_reembolso_de_la_sesion, la que ejecuta la sesión con la hora de la base');
select has_function('public', 'ejecutar_reembolso', array['uuid', 'text', 'date'],
  'Existe su puerta en la Data API');
select has_function('public', 'estado_de_reembolso', array['uuid'],
  'Existe public.estado_de_reembolso, lo que necesita la página para decidir qué ofrecer');
select ok(
  (select bool_and(prosecdef) from pg_proc
   where oid in ('privado.ejecutar_reembolso(uuid, text, date, timestamptz)'::regprocedure,
                 'privado.ejecutar_reembolso_de_la_sesion(uuid, text, date)'::regprocedure))
  and not (select bool_or(prosecdef) from pg_proc
           where oid in ('public.ejecutar_reembolso(uuid, text, date)'::regprocedure,
                         'public.estado_de_reembolso(uuid)'::regprocedure)),
  'Las de privado son security definer (escriben en reembolso); las de public corren con los permisos de quien llama (estado_de_reembolso lee con la política «admin lee»)');
select ok(
  (select bool_and('search_path=""' = any(proconfig)) from pg_proc
   where oid in ('privado.ejecutar_reembolso(uuid, text, date, timestamptz)'::regprocedure,
                 'privado.ejecutar_reembolso_de_la_sesion(uuid, text, date)'::regprocedure,
                 'public.ejecutar_reembolso(uuid, text, date)'::regprocedure,
                 'public.estado_de_reembolso(uuid)'::regprocedure)),
  'Las cuatro fijan un search_path vacío');
select is(
  array[pg_get_function_identity_arguments('public.ejecutar_reembolso(uuid, text, date)'::regprocedure),
        pg_get_function_identity_arguments('privado.ejecutar_reembolso_de_la_sesion(uuid, text, date)'::regprocedure),
        pg_get_function_identity_arguments('public.estado_de_reembolso(uuid)'::regprocedure)],
  array['p_id_reembolso uuid, p_referencia text, p_fecha date', 'p_id_reembolso uuid, p_referencia text, p_fecha date',
        'p_id_reembolso uuid'],
  'Las que llama la sesión no reciben el admin ni la hora: nadie registra a nombre de otro ni mueve el día de hoy');
select is(
  array[pg_get_function_result('public.ejecutar_reembolso(uuid, text, date)'::regprocedure),
        pg_get_function_result('public.estado_de_reembolso(uuid)'::regprocedure)],
  array['text', 'TABLE(estado text, vence_en timestamp with time zone)'],
  'Registrar devuelve el resultado en texto y estado_de_reembolso el estado y el vencimiento: nunca la llave');
select ok(
  not exists (
    select 1
    from unnest(array['privado.ejecutar_reembolso(uuid, text, date, timestamptz)',
                      'privado.ejecutar_reembolso_de_la_sesion(uuid, text, date)',
                      'public.ejecutar_reembolso(uuid, text, date)', 'public.estado_de_reembolso(uuid)']) f
    where has_function_privilege('anon', f, 'execute')),
  'Sin sesión (anon) no se consulta ni se registra nada');
select ok(
  has_function_privilege('authenticated', 'public.ejecutar_reembolso(uuid, text, date)', 'execute')
  and has_function_privilege('authenticated', 'privado.ejecutar_reembolso_de_la_sesion(uuid, text, date)', 'execute')
  and has_function_privilege('authenticated', 'public.estado_de_reembolso(uuid)', 'execute'),
  'Con sesión sí: la puerta, su envoltorio con now() y estado_de_reembolso');
select ok(
  not has_function_privilege('authenticated', 'privado.ejecutar_reembolso(uuid, text, date, timestamptz)', 'execute'),
  'La que recibe la hora es interna: ninguna sesión elige el día de hoy');
select ok(
  not exists (
    select 1
    from unnest(array['privado.ejecutar_reembolso(uuid, text, date, timestamptz)',
                      'privado.ejecutar_reembolso_de_la_sesion(uuid, text, date)',
                      'public.ejecutar_reembolso(uuid, text, date)', 'public.estado_de_reembolso(uuid)']) f
    where has_function_privilege('service_role', f, 'execute')),
  'service_role no ejecuta ninguna: sin sesión no hay admin');
select ok(
  not exists (
    select 1
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid in ('privado.ejecutar_reembolso(uuid, text, date, timestamptz)'::regprocedure,
                    'privado.ejecutar_reembolso_de_la_sesion(uuid, text, date)'::regprocedure,
                    'public.ejecutar_reembolso(uuid, text, date)'::regprocedure,
                    'public.estado_de_reembolso(uuid)'::regprocedure)
      and a.grantee = 0),
  'Nadie las hereda de PUBLIC');
select ok(
  not has_any_column_privilege('authenticated', 'public.reembolso', 'insert')
  and not has_any_column_privilege('authenticated', 'public.reembolso', 'update')
  and not has_table_privilege('authenticated', 'public.reembolso', 'delete'),
  'Sigue igual: nadie con sesión escribe en reembolso; solo las funciones');

-- Sin permiso ni se ejecutan.
set local role anon;
select throws_ok(
  $$select public.ejecutar_reembolso('70000000-0000-0000-0000-000000002611', 'REF-1', date '2031-12-31')$$,
  '42501', null, 'anon no puede llamar a ejecutar_reembolso: permiso denegado');
select throws_ok($$select * from public.estado_de_reembolso('70000000-0000-0000-0000-000000002611')$$,
  '42501', null, 'Ni a estado_de_reembolso');
select throws_ok(
  $$select privado.ejecutar_reembolso('70000000-0000-0000-0000-000000002611', 'REF-1', date '2031-12-31', now())$$,
  '42501', null, 'Ni a la versión que recibe la hora');
reset role;
set local role service_role;
select throws_ok(
  $$select public.ejecutar_reembolso('70000000-0000-0000-0000-000000002611', 'REF-1', date '2031-12-31')$$,
  '42501', null, 'service_role tampoco: no es un admin con sesión');
select throws_ok(
  $$select privado.ejecutar_reembolso('70000000-0000-0000-0000-000000002611', 'REF-1', date '2031-12-31', now())$$,
  '42501', null, 'Ni a la versión que recibe la hora');
reset role;
set local role authenticated;
select throws_ok(
  $$select privado.ejecutar_reembolso('70000000-0000-0000-0000-000000002611', 'REF-1', date '2031-12-31', now())$$,
  '42501', null, 'Una sesión no llama a la versión que recibe la hora: permiso denegado');
reset role;

-- ---------------------------------------------------------------------------
-- Fixtures (como postgres)
-- ---------------------------------------------------------------------------
-- Cualquier admin que ya existiera queda inactivo durante la prueba.
update auth.users set banned_until = 'infinity' where id in (select id from public.admin);

insert into auth.users (id, is_anonymous, banned_until) values
  ('a0000000-0000-0000-0000-0000000026a0', false, null),
  ('a0000000-0000-0000-0000-0000000026b0', false, null),
  ('a0000000-0000-0000-0000-0000000026c0', false, now() + interval '100 years'),
  ('b0000000-0000-0000-0000-000000002601', false, null),
  ('c0000000-0000-0000-0000-000000002601', true, null);

insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-0000000026a0', 'Admin A', 'admin-a-hu026@calibra.test', -2600),
  ('a0000000-0000-0000-0000-0000000026b0', 'Admin B', 'admin-b-hu026@calibra.test', -2599),
  ('a0000000-0000-0000-0000-0000000026c0', 'Admin C', 'admin-c-hu026@calibra.test', -2598);
insert into public.monitor (id, nombre) values ('b0000000-0000-0000-0000-000000002601', 'Monitor 26');
insert into public.monitor_privado (id_monitor, numero_telefono, correo, llave) values
  ('b0000000-0000-0000-0000-000000002601', '3002600001', 'monitor26@calibra.test', 'llave-monitor-26');
insert into public.materia (id, nombre, codigo) values ('10000000-0000-0000-0000-000000002601', 'Materia 26', 'PGTAP-26');
insert into public.certificado (id_monitor, id_materia, id_admin) values
  ('b0000000-0000-0000-0000-000000002601', '10000000-0000-0000-0000-000000002601', 'a0000000-0000-0000-0000-0000000026a0');
insert into public.lead (id, id_sesion_anonima, nombre, numero_telefono, correo, acepta_tratamiento_datos, fecha_consentimiento) values
  ('40000000-0000-0000-0000-000000002601', 'c0000000-0000-0000-0000-000000002601', 'Lead Prueba 26', '3002611111',
   'lead26@calibra.test', true, now());

-- r(nn): el reembolso 26NN. t(nn): el token que se le pone a su solicitud de llave.
create function pg_temp.r(nn text) returns uuid language sql immutable
as $$ select ('70000000-0000-0000-0000-0000000026' || nn)::uuid $$;
create function pg_temp.t(nn text) returns text language sql immutable
as $$ select '26' || nn || repeat('a', 60) $$;

-- La monitoría de todos los pagos: un lunes a las 9:30 en Bogotá, virtual, cancelada por el estudiante.
insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min, lugar, enlace, abierta_desde) values
  ('30000000-0000-0000-0000-000000002601', 'b0000000-0000-0000-0000-000000002601', 1, '09:30', false, 20000, 60, null,
   'https://meet.example/26-01', date '2026-01-01');
insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado, motivo_cancelacion) values
  ('50000000-0000-0000-0000-000000002601', '30000000-0000-0000-0000-000000002601', '10000000-0000-0000-0000-000000002601',
   '40000000-0000-0000-0000-000000002601', date '2031-11-03', 20000, 'cancelada', 'estudiante');

-- Un pago aprobado por reembolso, cada uno con su comprobante revisado (HU-059). No hace falta el archivo.
insert into public.comprobante_revisado (ruta, tipo)
select 'c0000000-0000-0000-0000-000000002601/60000000-0000-0000-0000-0000000026' || nn || '.pdf', 'application/pdf'
from unnest(array['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15']) as nn;
insert into public.pago (id, id_monitoria, monto, nombre_pagador, contacto, estado, id_admin, fecha_pago, fecha_revision, comprobante)
select ('60000000-0000-0000-0000-0000000026' || nn)::uuid, '50000000-0000-0000-0000-000000002601', 20000, 'Pagador ' || nn,
       'pagador26-' || nn || '@example.com', 'aprobado', 'a0000000-0000-0000-0000-0000000026a0',
       timestamptz '2020-01-06 09:00-05', now(),
       'c0000000-0000-0000-0000-000000002601/60000000-0000-0000-0000-0000000026' || nn || '.pdf'
from unnest(array['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15']) as nn;

-- Los reembolsos, en una sola sentencia. El plazo de la llave corre desde que se crearon.
insert into public.reembolso (id, id_pago, id_admin, monto, motivo, llave_destino, estado, fecha_generacion,
                              plazo_llave_desde, cerrado_en, fecha_reembolso, referencia_transferencia)
select pg_temp.r(v.nn), ('60000000-0000-0000-0000-0000000026' || v.nn)::uuid,
       ('a0000000-0000-0000-0000-0000000026' || v.admin || '0')::uuid, 20000, 'Prueba ' || v.nn, v.llave,
       v.estado::public.estado_reembolso, v.creado, v.creado, v.cerrado,
       case when v.estado = 'reembolsado' then timestamptz '2031-12-15 12:00-05' end,
       case when v.estado = 'reembolsado' then 'REF-26-' || v.nn end
from (values
  ('01', 'a', 'llave-26-01', 'pendiente', timestamptz '2031-12-01 10:00-05', null::timestamptz),
  ('02', 'b', 'llave-26-02', 'pendiente', timestamptz '2031-12-01 10:00-05', null),
  ('03', null, 'llave-26-03', 'pendiente', timestamptz '2031-12-01 10:00-05', null),
  ('04', 'a', null, 'esperando_llave', timestamptz '2031-12-28 10:00-05', null),
  ('05', 'a', null, 'esperando_llave', timestamptz '2031-12-01 10:00-05', timestamptz '2031-12-08 10:15-05'),
  ('06', 'a', 'llave-26-06', 'reembolsado', timestamptz '2031-12-01 10:00-05', null),
  ('07', 'a', 'llave-26-07', 'pendiente', timestamptz '2031-12-20 21:00-05', null),
  ('08', 'a', 'llave-26-08', 'pendiente', timestamptz '2031-12-01 10:00-05', null),
  ('09', 'a', 'llave-26-09', 'pendiente', timestamptz '2031-12-01 10:00-05', null),
  ('10', 'a', 'llave-26-10', 'pendiente', timestamptz '2031-12-01 10:00-05', null),
  ('11', 'a', 'llave-26-11', 'pendiente', timestamptz '2020-01-06 10:00-05', null),
  ('12', 'a', null, 'esperando_llave', now() - interval '168 hours', null),
  ('13', 'a', null, 'esperando_llave', now() - interval '168 hours' - interval '1 microsecond', null),
  ('14', 'c', 'llave-26-14', 'pendiente', timestamptz '2031-12-01 10:00-05', null),
  ('15', 'b', null, 'esperando_llave', now() - interval '24 hours', null)
) as v(nn, admin, llave, estado, creado, cerrado);

-- Tokens conocidos para los reembolsos de la prueba.
update public.solicitud_llave set token = pg_temp.t(right(id_reembolso::text, 2))
where id_reembolso::text like '70000000-0000-0000-0000-0000000026%';

select ok(
  (select count(*) = 15 from public.reembolso where id::text like '70000000-0000-0000-0000-0000000026%')
  and (select id_admin is null from public.reembolso where id = pg_temp.r('03'))
  and (select (fecha_generacion at time zone 'America/Bogota')::date = date '2031-12-20'
              and (fecha_generacion at time zone 'UTC')::date = date '2031-12-21'
       from public.reembolso where id = pg_temp.r('07'))
  and (select banned_until > now() from auth.users where id = 'a0000000-0000-0000-0000-0000000026c0')
  and (select estado = 'pendiente' and id_admin = 'a0000000-0000-0000-0000-0000000026c0'
       from public.reembolso where id = pg_temp.r('14')),
  'Control: están los 15 reembolsos, el 03 no tiene admin, el 07 se creó el 20-dic en Bogotá (en UTC ya es el 21), C está desactivado y tiene el 14 pendiente');

-- ---------------------------------------------------------------------------
-- La referencia, por fuera de la función (supuesto 2)
-- ---------------------------------------------------------------------------
select throws_ok($$update public.reembolso set referencia_transferencia = ' REF-1' where id = pg_temp.r('02')$$,
  '23514', null, 'La referencia no empieza con espacios (reembolso_referencia_con_texto)');
select throws_ok($$update public.reembolso set referencia_transferencia = 'REF-1 ' where id = pg_temp.r('02')$$,
  '23514', null, 'Ni termina con espacios');
select throws_ok($$update public.reembolso set referencia_transferencia = E'REF-1\n' where id = pg_temp.r('02')$$,
  '23514', null, 'Ni con un salto de línea');
select throws_ok($$update public.reembolso set referencia_transferencia = '' where id = pg_temp.r('02')$$,
  '23514', null, 'Ni queda vacía');
select throws_ok($$update public.reembolso set referencia_transferencia = repeat('a', 101) where id = pg_temp.r('02')$$,
  '23514', null, 'Ni pasa de 100 caracteres');
select lives_ok($$update public.reembolso set referencia_transferencia = repeat('é', 100) where id = pg_temp.r('02')$$,
  'Con 100 caracteres sí, aunque cada uno ocupe dos bytes: se cuentan caracteres');
update public.reembolso set referencia_transferencia = null where id = pg_temp.r('02');

-- ---------------------------------------------------------------------------
-- ejecutar_reembolso con ahora = 31-dic-2031 12:00 en Bogotá: lo que no se registra
-- ---------------------------------------------------------------------------
create temporary table antes as
select id, estado::text as estado, id_admin, llave_destino, referencia_transferencia, fecha_reembolso, monto, motivo,
       cerrado_en, plazo_llave_desde
from public.reembolso where id::text like '70000000-0000-0000-0000-0000000026%';

set local request.jwt.claims to '{"role":"authenticated"}';
select is(privado.ejecutar_reembolso(pg_temp.r('01'), 'REF-1', date '2031-12-31', '2031-12-31 12:00-05'), 'sin_sesion',
  'Sin sesión (el token no trae sub): sin_sesion');
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-000000002601","role":"authenticated"}';
select is(privado.ejecutar_reembolso(pg_temp.r('01'), 'REF-1', date '2031-12-31', '2031-12-31 12:00-05'), 'sin_permiso',
  'El monitor no registra reembolsos: sin_permiso');
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000002601","role":"authenticated","is_anonymous":true}';
select is(privado.ejecutar_reembolso(pg_temp.r('01'), 'REF-1', date '2031-12-31', '2031-12-31 12:00-05'), 'sin_permiso',
  'Un Lead tampoco');
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000026c0","role":"authenticated"}';
select is(
  array[
    privado.ejecutar_reembolso(pg_temp.r('14'), 'REF-1', date '2031-12-31', '2031-12-31 12:00-05'),
    privado.ejecutar_reembolso(pg_temp.r('01'), 'REF-1', date '2031-12-31', '2031-12-31 12:00-05')
  ],
  array['sin_permiso', 'sin_permiso'],
  'RN-23: un admin desactivado no registra ni el suyo (el 14, pendiente de C, con referencia y fecha válidas) ni el de otro admin');

-- Desde aquí el admin de la sesión es A, salvo donde se diga.
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000026a0","role":"authenticated"}';
select is(
  array[
    privado.ejecutar_reembolso('70000000-0000-0000-0000-0000000026ff', 'REF-1', date '2031-12-31', '2031-12-31 12:00-05'),
    privado.ejecutar_reembolso(null, 'REF-1', date '2031-12-31', '2031-12-31 12:00-05')
  ],
  array['no_encontrado', 'no_encontrado'],
  'Un reembolso que no existe o un id nulo: no_encontrado');
select is(
  array[
    privado.ejecutar_reembolso(pg_temp.r('02'), 'REF-1', date '2031-12-31', '2031-12-31 12:00-05'),
    privado.ejecutar_reembolso(pg_temp.r('03'), 'REF-1', date '2031-12-31', '2031-12-31 12:00-05'),
    privado.ejecutar_reembolso(pg_temp.r('02'), repeat('a', 101), date '2031-12-31', '2031-12-31 12:00-05'),
    privado.ejecutar_reembolso(pg_temp.r('03'), null, null, '2031-12-31 12:00-05')
  ],
  array['no_asignado', 'no_asignado', 'no_asignado', 'no_asignado'],
  'Supuesto 1: el de otro admin (B) o uno sin admin (D-28): no_asignado, también con una referencia o una fecha inválidas (quién puede se mira antes que el texto)');
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000026b0","role":"authenticated"}';
select is(privado.ejecutar_reembolso(pg_temp.r('01'), 'REF-1', date '2031-12-31', '2031-12-31 12:00-05'), 'no_asignado',
  'B, activo, tampoco registra el de A: no_asignado');
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000026a0","role":"authenticated"}';
select is(
  array[
    privado.ejecutar_reembolso(pg_temp.r('08'), null, date '2031-12-31', '2031-12-31 12:00-05'),
    privado.ejecutar_reembolso(pg_temp.r('08'), '   ', date '2031-12-31', '2031-12-31 12:00-05'),
    privado.ejecutar_reembolso(pg_temp.r('08'), E'\n\t', date '2031-12-31', '2031-12-31 12:00-05'),
    privado.ejecutar_reembolso(pg_temp.r('08'), repeat('a', 101), date '2031-12-31', '2031-12-31 12:00-05'),
    privado.ejecutar_reembolso(pg_temp.r('04'), '', date '2031-12-31', '2031-12-31 12:00-05')
  ],
  array['referencia_invalida', 'referencia_invalida', 'referencia_invalida', 'referencia_invalida', 'referencia_invalida'],
  'Supuesto 2: sin referencia, en blanco, de puros saltos de línea o de más de 100 caracteres: referencia_invalida (también en uno que espera la llave: el texto se mira antes que el estado)');
select is(
  array[
    privado.ejecutar_reembolso(pg_temp.r('08'), 'REF-1', null, '2031-12-31 12:00-05'),
    privado.ejecutar_reembolso(pg_temp.r('08'), 'REF-1', date '2032-01-01', '2031-12-31 12:00-05'),
    privado.ejecutar_reembolso(pg_temp.r('08'), 'REF-1', date '2032-01-01', '2032-01-01 04:59:59+00'),
    privado.ejecutar_reembolso(pg_temp.r('07'), 'REF-1', date '2031-12-19', '2031-12-31 12:00-05'),
    privado.ejecutar_reembolso(pg_temp.r('08'), 'REF-1', date '2031-12-31', null)
  ],
  array['fecha_invalida', 'fecha_invalida', 'fecha_invalida', 'fecha_invalida', 'fecha_invalida'],
  'Supuesto 3: sin fecha, mañana (también a las 23:59:59 del 31 en Bogotá, cuando en UTC ya es 1 de enero), el día antes del día en Bogotá en que se creó (el 07) o sin hora (falla cerrado): fecha_invalida');
select is(
  array[
    privado.ejecutar_reembolso(pg_temp.r('04'), 'REF-1', date '2031-12-31', '2031-12-31 12:00-05'),
    privado.ejecutar_reembolso(pg_temp.r('05'), 'REF-1', date '2031-12-31', '2031-12-31 12:00-05')
  ],
  array['sin_llave', 'sin_llave'],
  'Uno que espera la llave, abierto o cerrado: sin_llave (no hay a dónde transferir)');
select is(privado.ejecutar_reembolso(pg_temp.r('06'), 'REF-1', date '2031-12-31', '2031-12-31 12:00-05'), 'ya_reembolsado',
  'Supuesto 4: uno ya registrado: ya_reembolsado');
select results_eq(
  $$select id, estado::text, id_admin, llave_destino, referencia_transferencia, fecha_reembolso, monto, motivo, cerrado_en,
           plazo_llave_desde
    from public.reembolso where id::text like '70000000-0000-0000-0000-0000000026%' order by id$$,
  $$select * from antes order by id$$,
  'Ninguno de esos intentos tocó un reembolso');

-- ---------------------------------------------------------------------------
-- Criterio 2: el admin asignado registra la transferencia
-- ---------------------------------------------------------------------------
-- Los casos abiertos de A antes de registrar (la pantalla del equipo, HU-054).
create temporary table casos_a as
select casos_abiertos from public.equipo_de_admins() where id = 'a0000000-0000-0000-0000-0000000026a0';

select is(privado.ejecutar_reembolso(pg_temp.r('01'), E'  REF-2601 \n', date '2031-12-31', '2031-12-31 12:00-05'),
  'reembolsado', 'Criterio 2: A registra la transferencia del 01: reembolsado');
select results_eq(
  $$select estado::text, referencia_transferencia, fecha_reembolso, id_admin, llave_destino, monto, motivo, cerrado_en
    from public.reembolso where id = pg_temp.r('01')$$,
  $$values ('reembolsado'::text, 'REF-2601'::text, timestamptz '2031-12-31 12:00-05',
            'a0000000-0000-0000-0000-0000000026a0'::uuid, 'llave-26-01'::text, 20000, 'Prueba 01'::text, null::timestamptz)$$,
  'Queda con la referencia sin los espacios de los bordes y la fecha a mediodía en Bogotá; el admin (quien lo registró), la llave, el monto y el motivo no cambian');
select is(
  (select casos_abiertos from public.equipo_de_admins() where id = 'a0000000-0000-0000-0000-0000000026a0'),
  (select casos_abiertos - 1 from casos_a),
  'Ya no es un caso abierto de A: la pantalla del equipo cuenta uno menos');
select is(
  array[
    privado.ejecutar_reembolso(pg_temp.r('01'), 'REF-2601', date '2031-12-31', '2031-12-31 12:00-05'),
    privado.ejecutar_reembolso(pg_temp.r('01'), 'OTRA-REF', date '2031-12-30', '2031-12-31 12:00-05')
  ],
  array['ya_reembolsado', 'ya_reembolsado'],
  'Supuesto 4: registrarlo otra vez (un doble clic, otra pestaña), con la misma referencia o con otra: ya_reembolsado');
select results_eq(
  $$select referencia_transferencia, fecha_reembolso from public.reembolso where id = pg_temp.r('01')$$,
  $$values ('REF-2601'::text, timestamptz '2031-12-31 12:00-05')$$,
  'Y no pisa la referencia ni la fecha');

-- Los bordes que sí se aceptan, cada uno en su reembolso.
select is(
  array[
    privado.ejecutar_reembolso(pg_temp.r('08'), 'REF-2608', date '2031-12-31', '2031-12-31 12:00-05'),
    privado.ejecutar_reembolso(pg_temp.r('09'), 'REF-2609', date '2032-01-01', '2032-01-01 05:00+00'),
    privado.ejecutar_reembolso(pg_temp.r('07'), 'REF-2607', date '2031-12-20', '2031-12-31 12:00-05'),
    privado.ejecutar_reembolso(pg_temp.r('10'), repeat('é', 100), date '2031-12-31', '2031-12-31 12:00-05')
  ],
  array['reembolsado', 'reembolsado', 'reembolsado', 'reembolsado'],
  'Supuesto 3: la fecha de hoy (también desde las 00:00 del 1 de enero en Bogotá) y el día en Bogotá en que se creó (el 07, aunque en UTC ya fuera el 21) se aceptan; y una referencia de 100 caracteres de dos bytes');
select results_eq(
  $$select right(id::text, 2), estado::text, id_admin, char_length(referencia_transferencia), fecha_reembolso
    from public.reembolso where id in (pg_temp.r('07'), pg_temp.r('08'), pg_temp.r('09'), pg_temp.r('10')) order by id$$,
  $$values ('07'::text, 'reembolsado'::text, 'a0000000-0000-0000-0000-0000000026a0'::uuid, 8, timestamptz '2031-12-20 12:00-05'),
           ('08', 'reembolsado', 'a0000000-0000-0000-0000-0000000026a0', 8, timestamptz '2031-12-31 12:00-05'),
           ('09', 'reembolsado', 'a0000000-0000-0000-0000-0000000026a0', 8, timestamptz '2032-01-01 12:00-05'),
           ('10', 'reembolsado', 'a0000000-0000-0000-0000-0000000026a0', 100, timestamptz '2031-12-31 12:00-05')$$,
  'Quedan con su fecha a mediodía en Bogotá y la referencia completa (los 100 caracteres de dos bytes)');

-- ---------------------------------------------------------------------------
-- Las puertas, con la hora real (el 11 es de 2020)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"role":"authenticated"}';
select is(
  (select public.ejecutar_reembolso(pg_temp.r('11'), 'REF-2611', (now() at time zone 'America/Bogota')::date)),
  'sin_sesion', 'Por la puerta, sin sesión: sin_sesion');
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-000000002601","role":"authenticated"}';
select is(
  (select public.ejecutar_reembolso(pg_temp.r('11'), 'REF-2611', (now() at time zone 'America/Bogota')::date)),
  'sin_permiso', 'El monitor: sin_permiso');
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000026a0","role":"authenticated"}';
select throws_ok(
  $$update public.reembolso
    set estado = 'reembolsado', fecha_reembolso = now(), referencia_transferencia = 'REF-DIRECTA'
    where id = pg_temp.r('11')$$,
  '42501', null, 'Ni el admin asignado escribe en reembolso directo en la Data API: permiso denegado');
select is(
  (select public.ejecutar_reembolso(pg_temp.r('11'), 'REF-2611', (now() at time zone 'America/Bogota')::date)),
  'reembolsado', 'Criterio 2 por la puerta: A registra el 11 con la fecha de hoy en Bogotá');
reset role;
select results_eq(
  $$select estado::text, id_admin, referencia_transferencia,
           fecha_reembolso = ((now() at time zone 'America/Bogota')::date + time '12:00') at time zone 'America/Bogota'
    from public.reembolso where id = pg_temp.r('11')$$,
  $$values ('reembolsado'::text, 'a0000000-0000-0000-0000-0000000026a0'::uuid, 'REF-2611'::text, true)$$,
  'Queda reembolsado, con A como quien lo registró (auth.uid()), su referencia y la fecha de hoy a mediodía en Bogotá');

-- ---------------------------------------------------------------------------
-- Lo que ve la página: estado_de_reembolso, con la hora real
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-000000002601","role":"authenticated"}';
select is((select count(*)::int from public.estado_de_reembolso(pg_temp.r('02'))), 0,
  'El monitor no recibe filas: la política «admin lee» de reembolso');
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000026c0","role":"authenticated"}';
select is((select count(*)::int from public.estado_de_reembolso(pg_temp.r('02'))), 0,
  'RN-23: un admin desactivado tampoco');
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000026b0","role":"authenticated"}';
select is((select count(*)::int from public.estado_de_reembolso(pg_temp.r('01'))), 1,
  'Cualquier admin activo sí la ve (B, con un reembolso de A): la página la abre cualquier admin');
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000026a0","role":"authenticated"}';
select results_eq(
  $$select v.nn, e.estado, e.vence_en
    from (values ('01'), ('02'), ('05'), ('06'), ('12'), ('13'), ('15')) as v(nn)
    cross join lateral public.estado_de_reembolso(pg_temp.r(v.nn)) e
    order by v.nn$$,
  $$values ('01'::text, 'reembolsado'::text, timestamptz '2031-12-08 10:00-05'),
           ('02', 'pendiente', timestamptz '2031-12-08 10:00-05'),
           ('05', 'cerrado', timestamptz '2031-12-08 10:00-05'),
           ('06', 'reembolsado', timestamptz '2031-12-08 10:00-05'),
           ('12', 'esperando_llave', now()),
           ('13', 'cerrado', now() - interval '1 microsecond'),
           ('15', 'esperando_llave', now() + interval '144 hours')$$,
  'A ve reembolsado, pendiente, cerrado (el 05 cerrado; el 13, vencido sin que el cierre haya corrido) y esperando_llave (el 15, de B, a mitad del plazo; el 12, con 7 días exactos, P-40), con el fin de los 7 días');
select is((select count(*)::int from public.estado_de_reembolso('70000000-0000-0000-0000-0000000026ff')), 0,
  'Un reembolso que no existe no trae filas');
reset role;

-- ---------------------------------------------------------------------------
-- Lo que ya existía, con el 01 reembolsado (HU-025)
-- ---------------------------------------------------------------------------
select is(
  array[privado.entregar_llave(pg_temp.t('01'), 'llave-26-01', '2031-12-31 12:00-05'),
        privado.entregar_llave(pg_temp.t('01'), 'otra-llave', '2031-12-31 12:00-05')],
  array['ya_entregada', 'ya_entregada_otra'],
  'Quien pagó vuelve al enlace después del registro: con la misma llave, ya_entregada; con otra, ya_entregada_otra');
select is((select estado from public.datos_de_llave(pg_temp.t('01'))), 'reembolsado',
  'Y la página de la llave le dice que ya le devolvimos el dinero (reembolsado)');
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000026a0","role":"authenticated"}';
select is(
  array[privado.reabrir_reembolso(pg_temp.r('01'), '2031-12-31 12:00-05'),
        privado.reenviar_pedido_llave(pg_temp.r('01'), '2031-12-31 12:00-05')],
  array['no_cerrado', 'ya_entregada'],
  'Reabrirlo responde no_cerrado y reenviar el enlace, ya_entregada');
select results_eq(
  $$select estado::text, llave_destino, referencia_transferencia, cerrado_en, plazo_llave_desde,
           (select count(*)::int from public.pedido_llave pl where pl.id_reembolso = r.id)
    from public.reembolso r where r.id = pg_temp.r('01')$$,
  $$values ('reembolsado'::text, 'llave-26-01'::text, 'REF-2601'::text, null::timestamptz, timestamptz '2031-12-01 10:00-05', 0)$$,
  'Nada de eso lo tocó: sigue reembolsado, con su llave, su referencia y su plazo, y sin correos en cola');

-- ---------------------------------------------------------------------------
-- Reasignar al desactivar (P-44, HU-074): al final, porque mueve a B los casos abiertos de A
-- ---------------------------------------------------------------------------
select is(privado.reasignar_casos_de_admin('a0000000-0000-0000-0000-0000000026a0'), 3,
  'Al desactivar a A se mueven solo sus tres casos abiertos (04, 12 y 13, que esperan la llave sin cerrar)');
select results_eq(
  $$select right(id::text, 2), id_admin from public.reembolso where id::text like '70000000-0000-0000-0000-0000000026%' order by id$$,
  $$values ('01'::text, 'a0000000-0000-0000-0000-0000000026a0'::uuid), ('02', 'a0000000-0000-0000-0000-0000000026b0'),
           ('03', null), ('04', 'a0000000-0000-0000-0000-0000000026b0'), ('05', 'a0000000-0000-0000-0000-0000000026a0'),
           ('06', 'a0000000-0000-0000-0000-0000000026a0'), ('07', 'a0000000-0000-0000-0000-0000000026a0'),
           ('08', 'a0000000-0000-0000-0000-0000000026a0'), ('09', 'a0000000-0000-0000-0000-0000000026a0'),
           ('10', 'a0000000-0000-0000-0000-0000000026a0'), ('11', 'a0000000-0000-0000-0000-0000000026a0'),
           ('12', 'a0000000-0000-0000-0000-0000000026b0'), ('13', 'a0000000-0000-0000-0000-0000000026b0'),
           ('14', 'a0000000-0000-0000-0000-0000000026c0'), ('15', 'a0000000-0000-0000-0000-0000000026b0')$$,
  'Los reembolsados (01, 06 a 11) se quedan con A, quien los registró; el cerrado (05) también; los abiertos pasan a B; los de C (14) y B (15) no se tocan');

select * from finish();
rollback;
