-- Pruebas pgTAP de pagar por Llave y adjuntar el comprobante (HU-018).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.
--
-- La puerta pública (public.registrar_pago) usa now(), que dentro de la transacción no cambia: una reserva creada
-- exactamente 10 minutos y un microsegundo antes de now() ya venció. Los bordes con la hora fija (y que el pago
-- guarde esa hora) se prueban con privado.registrar_pago y su p_ahora.
--
-- El turno de admins recorre a TODOS los admins de la base (la semilla, los de desarrollo y los que creen otras
-- pruebas a la vez). Como en equipo_de_admins.test.sql: los que ya existían se banean dentro de la transacción y los
-- de esta prueba llevan un orden_revision negativo, por delante de cualquier otro.
--
-- Elenco (ids terminados en 18NN; la materia es 'PGTAP-18'):
--   Admins: A (-1800, desactivado), B (-1799) y C (-1798). El turno debe dar B.
--   Monitor: M, con una franja de los lunes a $25.000. Sesiones anónimas 01 y 02, cada una con su Lead.
--   Monitorías del Lead 01 (todas de la franja de M, en lunes de 2030, con valor_total 23.000 para distinguirlo del
--   precio actual de la franja):
--     01 por pagar, de hace 1 min (el flujo principal)   02 confirmada   03 realizada   04 cancelada
--     05 por pagar, de hace 10 min y 1 µs (vencida)       06 por pagar, creada a una hora fija (los bordes)
--     07 grupal por pagar                                 08 por pagar, de ahora (los rechazos)
--   Comprobantes (ruta <sesión>/<uuid>.png):
--     K1, K6 y K8 de la sesión 01, en el bucket y revisados   KS de la 01, en el bucket sin revisar
--     KN de la 01, revisado pero sin archivo                  KA de la sesión 02, en el bucket y revisado

begin;
create extension if not exists pgtap with schema extensions;

select plan(46);

-- ---------------------------------------------------------------------------
-- Estructura y permisos
-- ---------------------------------------------------------------------------
select has_function('privado', 'registrar_pago', array['uuid', 'text', 'text', 'text', 'timestamp with time zone'],
  'Existe privado.registrar_pago, la que crea el pago y confirma la monitoría');
select has_function('public', 'registrar_pago', array['uuid', 'text', 'text', 'text'],
  'Existe su puerta en la Data API');
select ok(
  (select prosecdef from pg_proc where oid = 'privado.registrar_pago(uuid, text, text, text, timestamptz)'::regprocedure)
  and not (select prosecdef from pg_proc where oid = 'public.registrar_pago(uuid, text, text, text)'::regprocedure),
  'La de privado es security definer (escribe en pago y monitoria); la puerta corre con los permisos de quien llama');
select ok(
  (select bool_and('search_path=""' = any(proconfig)) from pg_proc
   where oid in ('privado.registrar_pago(uuid, text, text, text, timestamptz)'::regprocedure,
                 'public.registrar_pago(uuid, text, text, text)'::regprocedure)),
  'Las dos fijan un search_path vacío');
select is(
  pg_get_function_identity_arguments('public.registrar_pago(uuid, text, text, text)'::regprocedure),
  'p_id_monitoria uuid, p_comprobante text, p_nombre text, p_contacto text',
  'La puerta no recibe el monto (P-36), ni la sesión, ni la hora: nadie paga a nombre de otro ni estira la reserva');
select ok(
  not has_function_privilege('anon', 'public.registrar_pago(uuid, text, text, text)', 'execute')
  and not has_function_privilege('anon', 'privado.registrar_pago(uuid, text, text, text, timestamptz)', 'execute'),
  'Sin sesión (anon) no se paga: ni la puerta pública ni la de privado');
select ok(
  has_function_privilege('authenticated', 'public.registrar_pago(uuid, text, text, text)', 'execute')
  and has_function_privilege('authenticated', 'privado.registrar_pago(uuid, text, text, text, timestamptz)', 'execute'),
  'Con sesión sí (también la anónima del Lead, que es authenticated): la puerta llega a la de privado');
select ok(
  not has_function_privilege('service_role', 'public.registrar_pago(uuid, text, text, text)', 'execute')
  and not has_function_privilege('service_role', 'privado.registrar_pago(uuid, text, text, text, timestamptz)', 'execute'),
  'service_role no la necesita: sin sesión no hay Lead');
select ok(
  not exists (
    select 1
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid in ('privado.registrar_pago(uuid, text, text, text, timestamptz)'::regprocedure,
                    'public.registrar_pago(uuid, text, text, text)'::regprocedure)
      and a.grantee = 0),
  'Nadie las hereda de PUBLIC');
select ok(
  not has_any_column_privilege('authenticated', 'public.pago', 'insert')
  and not has_any_column_privilege('authenticated', 'public.pago', 'update')
  and not has_table_privilege('authenticated', 'public.pago', 'delete')
  and not has_any_column_privilege('authenticated', 'public.monitoria', 'update'),
  'Nadie con sesión escribe en pago ni cambia el estado de una monitoría: solo la función, con la identidad de la sesión');
select index_is_unique('public', 'pago', 'pago_comprobante_key',
  'Un comprobante respalda un solo pago (supuesto 4): índice único pago_comprobante_key');

-- ---------------------------------------------------------------------------
-- Fixtures (como postgres)
-- ---------------------------------------------------------------------------
-- Lo que devuelve cada llamada que importa, para comparar después.
create temporary table r (k text primary key, resultado text, id_pago uuid);
grant select, insert on r to authenticated;

-- Cualquier admin que ya existiera queda inactivo durante la prueba.
update auth.users set banned_until = 'infinity' where id in (select id from public.admin);

insert into auth.users (id, is_anonymous, banned_until) values
  ('a0000000-0000-0000-0000-0000000018a0', false, now() + interval '100 years'),
  ('a0000000-0000-0000-0000-0000000018b0', false, null),
  ('a0000000-0000-0000-0000-0000000018c0', false, null),
  ('b0000000-0000-0000-0000-000000001801', false, null),
  ('c0000000-0000-0000-0000-000000001801', true, null),
  ('c0000000-0000-0000-0000-000000001802', true, null);

insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-0000000018a0', 'Admin A', 'admin-a-hu018@calibra.test', -1800),
  ('a0000000-0000-0000-0000-0000000018b0', 'Admin B', 'admin-b-hu018@calibra.test', -1799),
  ('a0000000-0000-0000-0000-0000000018c0', 'Admin C', 'admin-c-hu018@calibra.test', -1798);
insert into public.monitor (id, nombre) values ('b0000000-0000-0000-0000-000000001801', 'Monitor M');
insert into public.materia (id, nombre, codigo) values ('10000000-0000-0000-0000-000000001801', 'Materia HU-018', 'PGTAP-18');
insert into public.certificado (id_monitor, id_materia, id_admin) values
  ('b0000000-0000-0000-0000-000000001801', '10000000-0000-0000-0000-000000001801', 'a0000000-0000-0000-0000-0000000018b0');
insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min) values
  ('30000000-0000-0000-0000-000000001801', 'b0000000-0000-0000-0000-000000001801', 1, '10:00', true, 25000, 60);
insert into public.lead (id, id_sesion_anonima, nombre, correo, acepta_tratamiento_datos, fecha_consentimiento) values
  ('40000000-0000-0000-0000-000000001801', 'c0000000-0000-0000-0000-000000001801', 'Lead Uno', 'lead-01-hu018@calibra.test', true, now()),
  ('40000000-0000-0000-0000-000000001802', 'c0000000-0000-0000-0000-000000001802', 'Lead Dos', 'lead-02-hu018@calibra.test', true, now());

insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado, motivo_cancelacion, fecha_finalizacion, fecha_creacion)
select ('50000000-0000-0000-0000-0000000018' || v.nn)::uuid, '30000000-0000-0000-0000-000000001801',
       '10000000-0000-0000-0000-000000001801', '40000000-0000-0000-0000-000000001801', v.fecha, 23000,
       v.estado, v.motivo, v.finalizada, v.creada
from (values
  ('01', date '2030-01-07', 'pendiente_pago'::public.estado_monitoria, null::public.motivo_cancelacion, null::timestamptz,
   now() - interval '1 minute'),
  ('02', date '2030-01-14', 'confirmada', null, null, now() - interval '1 day'),
  ('03', date '2030-01-21', 'realizada', null, timestamptz '2030-01-21 11:00-05', now() - interval '1 day'),
  ('04', date '2030-01-28', 'cancelada', 'estudiante', null, now() - interval '1 day'),
  ('05', date '2030-02-04', 'pendiente_pago', null, null, now() - interval '10 minutes' - interval '1 microsecond'),
  ('06', date '2030-02-11', 'pendiente_pago', null, null, timestamptz '2026-09-01 12:00-05'),
  ('07', date '2030-02-18', 'pendiente_pago', null, null, now()),
  ('08', date '2030-02-25', 'pendiente_pago', null, null, now())
) as v(nn, fecha, estado, motivo, finalizada, creada);
insert into public.monitoria_grupal (id_monitoria, cupos, modalidad_pago, precio_por_persona) values
  ('50000000-0000-0000-0000-000000001807', 3, 'dividido', 15000);

-- Los archivos del bucket (antes de fijar una sesión: la cuota de 5 por carpeta los cuenta, y son 4 y 1).
insert into storage.objects (bucket_id, name) values
  ('comprobantes', 'c0000000-0000-0000-0000-000000001801/e1800000-0000-0000-0000-000000000001.png'),
  ('comprobantes', 'c0000000-0000-0000-0000-000000001801/e1800000-0000-0000-0000-000000000006.png'),
  ('comprobantes', 'c0000000-0000-0000-0000-000000001801/e1800000-0000-0000-0000-000000000008.png'),
  ('comprobantes', 'c0000000-0000-0000-0000-000000001801/e1800000-0000-0000-0000-0000000000a1.png'),
  ('comprobantes', 'c0000000-0000-0000-0000-000000001802/e1800000-0000-0000-0000-0000000000a3.png');
-- Los que el servidor revisó (HU-059). KS (…a1) no; KN (…a2) sí, pero no tiene archivo.
insert into public.comprobante_revisado (ruta, tipo) values
  ('c0000000-0000-0000-0000-000000001801/e1800000-0000-0000-0000-000000000001.png', 'image/png'),
  ('c0000000-0000-0000-0000-000000001801/e1800000-0000-0000-0000-000000000006.png', 'image/png'),
  ('c0000000-0000-0000-0000-000000001801/e1800000-0000-0000-0000-000000000008.png', 'image/png'),
  ('c0000000-0000-0000-0000-000000001801/e1800000-0000-0000-0000-0000000000a2.png', 'image/png'),
  ('c0000000-0000-0000-0000-000000001802/e1800000-0000-0000-0000-0000000000a3.png', 'image/png');

-- aislar(): vuelve a desactivar a cualquier admin que no sea de la prueba. La base local la pueden estar usando otras
-- pruebas a la vez (integración, e2e) y crear admins mientras esta corre; el turno los vería.
create procedure pg_temp.aislar()
language sql security definer set search_path = ''
as $$
  update auth.users set banned_until = 'infinity'
  where id in (select id from public.admin
               where id not in ('a0000000-0000-0000-0000-0000000018a0', 'a0000000-0000-0000-0000-0000000018b0',
                                'a0000000-0000-0000-0000-0000000018c0'))
    and (banned_until is null or banned_until <= now());
$$;

select ok(
  (select count(*) = 8 from public.monitoria where id::text like '50000000-0000-0000-0000-0000000018%')
  and exists (select 1 from public.monitoria_grupal where id_monitoria = '50000000-0000-0000-0000-000000001807')
  and (select orden_revision from public.admin where id = 'a0000000-0000-0000-0000-0000000018a0')
      < (select orden_revision from public.admin where id = 'a0000000-0000-0000-0000-0000000018b0')
  and (select banned_until > now() from auth.users where id = 'a0000000-0000-0000-0000-0000000018a0'),
  'Control: las 8 monitorías existen (la 07 es grupal) y A va antes que B en el orden, pero está desactivado');

-- ---------------------------------------------------------------------------
-- Sin sesión, y quien no es el Lead de la monitoría
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"role":"authenticated"}';
select results_eq(
  $$select resultado, id_pago from public.registrar_pago('50000000-0000-0000-0000-000000001801',
      'c0000000-0000-0000-0000-000000001801/e1800000-0000-0000-0000-000000000001.png', 'Ana', 'ana@calibra.test')$$,
  $$values ('sin_sesion'::text, null::uuid)$$,
  'Sin sesión (el token no trae sub) no se paga: sin_sesion y ningún id');

set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001801","role":"authenticated","is_anonymous":true}';
select is(
  (select resultado from public.registrar_pago('50000000-0000-0000-0000-0000000018ff',
     'c0000000-0000-0000-0000-000000001801/e1800000-0000-0000-0000-000000000001.png', 'Ana', 'ana@calibra.test')),
  'no_es_tuya', 'Una monitoría que no existe: no_es_tuya (no se dice si existe)');

set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001802","role":"authenticated","is_anonymous":true}';
select is(
  (select resultado from public.registrar_pago('50000000-0000-0000-0000-000000001801',
     'c0000000-0000-0000-0000-000000001802/e1800000-0000-0000-0000-0000000000a3.png', 'Otra', 'otra@calibra.test')),
  'no_es_tuya', 'La sesión de otro Lead no paga la monitoría ajena, ni con un comprobante suyo: no_es_tuya');

set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-000000001801","role":"authenticated"}';
select is(
  (select resultado from public.registrar_pago('50000000-0000-0000-0000-000000001801',
     'b0000000-0000-0000-0000-000000001801/e1800000-0000-0000-0000-000000000001.png', 'Monitor', 'monitor@calibra.test')),
  'no_es_tuya', 'El monitor de la monitoría la ve, pero no la paga: no_es_tuya');

set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000018b0","role":"authenticated"}';
select is(
  (select resultado from public.registrar_pago('50000000-0000-0000-0000-000000001801',
     'a0000000-0000-0000-0000-0000000018b0/e1800000-0000-0000-0000-000000000001.png', 'Admin', 'admin@calibra.test')),
  'no_es_tuya', 'Un admin activo tampoco la paga: solo el Lead (supuesto 3)');

-- ---------------------------------------------------------------------------
-- El estado de la monitoría y la reserva de 10 minutos
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001801","role":"authenticated","is_anonymous":true}';
select is(
  (select resultado from public.registrar_pago('50000000-0000-0000-0000-000000001807',
     'c0000000-0000-0000-0000-000000001801/e1800000-0000-0000-0000-000000000008.png', 'Ana', 'ana@calibra.test')),
  'no_individual', 'Una grupal no se paga por aquí (HU-036, HU-038): no_individual');
select is(
  (select resultado from public.registrar_pago('50000000-0000-0000-0000-000000001802',
     'c0000000-0000-0000-0000-000000001801/e1800000-0000-0000-0000-000000000008.png', 'Ana', 'ana@calibra.test')),
  'ya_pagada', 'Una confirmada ya está pagada: ya_pagada');
select is(
  (select resultado from public.registrar_pago('50000000-0000-0000-0000-000000001803',
     'c0000000-0000-0000-0000-000000001801/e1800000-0000-0000-0000-000000000008.png', 'Ana', 'ana@calibra.test')),
  'ya_pagada', 'Una realizada también: ya_pagada');
select is(
  (select resultado from public.registrar_pago('50000000-0000-0000-0000-000000001804',
     'c0000000-0000-0000-0000-000000001801/e1800000-0000-0000-0000-000000000008.png', 'Ana', 'ana@calibra.test')),
  'cancelada', 'Una cancelada no recibe pagos: cancelada');
select is(
  (select resultado from public.registrar_pago('50000000-0000-0000-0000-000000001805',
     'c0000000-0000-0000-0000-000000001801/e1800000-0000-0000-0000-000000000008.png', 'Ana', 'ana@calibra.test')),
  'vencida', 'Criterio 4 y P-40: una reserva de hace 10 minutos y un microsegundo ya venció: vencida (con el reloj de la base)');

-- ---------------------------------------------------------------------------
-- Nombre y contacto (RN-44, supuesto 3)
-- ---------------------------------------------------------------------------
select is(
  array[
    (select resultado from public.registrar_pago('50000000-0000-0000-0000-000000001808',
       'c0000000-0000-0000-0000-000000001801/e1800000-0000-0000-0000-000000000008.png', '   ', 'ana@calibra.test')),
    (select resultado from public.registrar_pago('50000000-0000-0000-0000-000000001808',
       'c0000000-0000-0000-0000-000000001801/e1800000-0000-0000-0000-000000000008.png', null, 'ana@calibra.test')),
    (select resultado from public.registrar_pago('50000000-0000-0000-0000-000000001808',
       'c0000000-0000-0000-0000-000000001801/e1800000-0000-0000-0000-000000000008.png', repeat('a', 121), 'ana@calibra.test')),
    (select resultado from public.registrar_pago('50000000-0000-0000-0000-000000001808',
       'c0000000-0000-0000-0000-000000001801/e1800000-0000-0000-0000-000000000008.png', 'Ana', 'ana')),
    (select resultado from public.registrar_pago('50000000-0000-0000-0000-000000001808',
       'c0000000-0000-0000-0000-000000001801/e1800000-0000-0000-0000-000000000008.png', 'Ana', 'ANA@CALIBRA.TEST')),
    (select resultado from public.registrar_pago('50000000-0000-0000-0000-000000001808',
       'c0000000-0000-0000-0000-000000001801/e1800000-0000-0000-0000-000000000008.png', 'Ana', ' ana@calibra.test')),
    (select resultado from public.registrar_pago('50000000-0000-0000-0000-000000001808',
       'c0000000-0000-0000-0000-000000001801/e1800000-0000-0000-0000-000000000008.png', 'Ana', 'ana?cc=x@calibra.test')),
    (select resultado from public.registrar_pago('50000000-0000-0000-0000-000000001808',
       'c0000000-0000-0000-0000-000000001801/e1800000-0000-0000-0000-000000000008.png', 'Ana', repeat('a', 243) || '@calibra.test')),
    (select resultado from public.registrar_pago('50000000-0000-0000-0000-000000001808',
       'c0000000-0000-0000-0000-000000001801/e1800000-0000-0000-0000-000000000008.png', 'Ana', null))],
  array_fill('datos_invalidos'::text, array[9]),
  'Nombre vacío, nulo o de más de 120 caracteres, y un contacto que no es un correo normalizado (mayúsculas, espacios, ?, más de 254, nulo): datos_invalidos');
-- 120 caracteres con espacios alrededor sí sirve: la llamada pasa a mirar el comprobante (KS, sin revisar).
select is(
  (select resultado from public.registrar_pago('50000000-0000-0000-0000-000000001808',
     'c0000000-0000-0000-0000-000000001801/e1800000-0000-0000-0000-0000000000a1.png',
     '  ' || repeat('a', 120) || '  ', 'ana.o''neil+pago@mail.calibra.test')),
  'comprobante_sin_revisar',
  'Un nombre de 120 caracteres (recortado) y un correo con apóstrofo y + sirven: la llamada sigue al comprobante');

-- ---------------------------------------------------------------------------
-- El comprobante (criterio 7)
-- ---------------------------------------------------------------------------
select is(
  array[
    (select resultado from public.registrar_pago('50000000-0000-0000-0000-000000001808',
       'c0000000-0000-0000-0000-000000001802/e1800000-0000-0000-0000-0000000000a3.png', 'Ana', 'ana@calibra.test')),
    (select resultado from public.registrar_pago('50000000-0000-0000-0000-000000001808',
       null, 'Ana', 'ana@calibra.test'))],
  array['comprobante_ajeno', 'comprobante_ajeno'],
  'Un comprobante en la carpeta de otra sesión (revisado y en el bucket), o ninguno: comprobante_ajeno');
select is(
  (select resultado from public.registrar_pago('50000000-0000-0000-0000-000000001808',
     'c0000000-0000-0000-0000-000000001801/e1800000-0000-0000-0000-0000000000a1.png', 'Ana', 'ana@calibra.test')),
  'comprobante_sin_revisar', 'En su carpeta y en el bucket, pero sin la revisión del servidor (HU-059): comprobante_sin_revisar');
select is(
  (select resultado from public.registrar_pago('50000000-0000-0000-0000-000000001808',
     'c0000000-0000-0000-0000-000000001801/e1800000-0000-0000-0000-0000000000a2.png', 'Ana', 'ana@calibra.test')),
  'comprobante_no_existe', 'Revisado, pero ya no está en el bucket: comprobante_no_existe');

-- ---------------------------------------------------------------------------
-- Sin ningún admin activo (RN-42)
-- ---------------------------------------------------------------------------
reset role;
call pg_temp.aislar();
update auth.users set banned_until = 'infinity'
where id in ('a0000000-0000-0000-0000-0000000018b0', 'a0000000-0000-0000-0000-0000000018c0');
set local role authenticated;
select is(
  (select resultado from public.registrar_pago('50000000-0000-0000-0000-000000001808',
     'c0000000-0000-0000-0000-000000001801/e1800000-0000-0000-0000-000000000008.png', 'Ana', 'ana@calibra.test')),
  'sin_admin', 'Con todo en regla pero sin ningún admin activo no se crea el pago: sin_admin');
reset role;
select results_eq(
  $$select (select count(*)::int from public.pago where id_monitoria = '50000000-0000-0000-0000-000000001808'),
           (select estado::text from public.monitoria where id = '50000000-0000-0000-0000-000000001808')$$,
  $$values (0, 'pendiente_pago'::text)$$,
  'Ninguno de los rechazos dejó un pago y la monitoría sigue pendiente_pago');
update auth.users set banned_until = null
where id in ('a0000000-0000-0000-0000-0000000018b0', 'a0000000-0000-0000-0000-0000000018c0');

-- ---------------------------------------------------------------------------
-- Registrado: el pago nace en revisión, asignado y por el valor_total; la monitoría queda confirmada
-- ---------------------------------------------------------------------------
call pg_temp.aislar();
set local role authenticated;
insert into r select 'p_01', * from public.registrar_pago('50000000-0000-0000-0000-000000001801',
  'c0000000-0000-0000-0000-000000001801/e1800000-0000-0000-0000-000000000001.png', '  Ana Pagadora  ', 'ana.pagadora18@calibra.test');
select results_eq(
  $$select resultado, id_pago is not null from r where k = 'p_01'$$,
  $$values ('registrado'::text, true)$$,
  'El Lead de la sesión, con la reserva vigente y su comprobante revisado, paga: registrado con el id del pago');
select is(
  (select count(*)::int from public.pago where id_monitoria = '50000000-0000-0000-0000-000000001801'),
  0, 'El Lead sigue sin leer los pagos, ni el suyo (solo los admins los leen)');
reset role;
select results_eq(
  $$select p.id_monitoria, p.estado::text, p.fecha_revision, p.referencia_transferencia, p.comprobante
    from public.pago p join r on r.id_pago = p.id where r.k = 'p_01'$$,
  $$values ('50000000-0000-0000-0000-000000001801'::uuid, 'en_revision'::text, null::timestamptz, null::text,
            'c0000000-0000-0000-0000-000000001801/e1800000-0000-0000-0000-000000000001.png'::text)$$,
  'RN-41: el pago es de esa monitoría, nace en en_revision (sin revisión ni referencia) y guarda el comprobante');
select is(
  (select p.monto from public.pago p join r on r.id_pago = p.id where r.k = 'p_01'),
  23000, 'P-36: el monto es el valor_total de la monitoría (23.000), no el precio actual de la franja (25.000)');
select is(
  (select p.id_admin from public.pago p join r on r.id_pago = p.id where r.k = 'p_01'),
  'a0000000-0000-0000-0000-0000000018b0'::uuid,
  'RN-42: asignado al primer admin activo según orden_revision (B: salta a A, que está desactivado)');
select results_eq(
  $$select p.fecha_asignacion, p.fecha_pago from public.pago p join r on r.id_pago = p.id where r.k = 'p_01'$$,
  $$values (now(), now())$$,
  'La fecha de asignación y la del pago son la hora de la base al crearlo (la puerta pasa now())');
select results_eq(
  $$select p.nombre_pagador, p.contacto from public.pago p join r on r.id_pago = p.id where r.k = 'p_01'$$,
  $$values ('Ana Pagadora'::text, 'ana.pagadora18@calibra.test'::text)$$,
  'RN-44: guarda el nombre recortado y el correo de contacto');
select is(
  (select estado::text from public.monitoria where id = '50000000-0000-0000-0000-000000001801'),
  'confirmada', 'RN-38: el pago cubre el valor_total, así que la monitoría queda confirmada sin esperar al admin');
select results_eq(
  $$select evento from public.aviso_monitor where id_monitoria = '50000000-0000-0000-0000-000000001801'$$,
  $$values ('confirmada'::text)$$,
  'El paso a confirmada anotó el aviso al monitor (trigger de HU-051)');

-- Un segundo envío sobre la misma monitoría (otra pestaña, un doble clic) no crea otro pago.
set local role authenticated;
select is(
  (select resultado from public.registrar_pago('50000000-0000-0000-0000-000000001801',
     'c0000000-0000-0000-0000-000000001801/e1800000-0000-0000-0000-000000000008.png', 'Ana', 'ana@calibra.test')),
  'ya_pagada', 'Un segundo intento sobre la misma monitoría: ya_pagada');
reset role;
select is((select count(*)::int from public.pago where id_monitoria = '50000000-0000-0000-0000-000000001801'), 1,
  'Y sigue habiendo un solo pago');

-- El mismo comprobante no respalda dos pagos.
set local role authenticated;
select is(
  (select resultado from public.registrar_pago('50000000-0000-0000-0000-000000001808',
     'c0000000-0000-0000-0000-000000001801/e1800000-0000-0000-0000-000000000001.png', 'Ana', 'ana@calibra.test')),
  'comprobante_usado', 'El comprobante que ya respalda el pago de otra monitoría: comprobante_usado');
reset role;
select throws_ok(
  $$insert into public.pago (id_monitoria, monto, nombre_pagador, contacto, id_admin, comprobante)
    values ('50000000-0000-0000-0000-000000001808', 23000, 'Ana', 'ana@calibra.test', 'a0000000-0000-0000-0000-0000000018b0',
            'c0000000-0000-0000-0000-000000001801/e1800000-0000-0000-0000-000000000001.png')$$,
  '23505', null,
  'Ni siquiera por fuera de la función: pago_comprobante_key cierra la carrera de dos pagos con el mismo archivo');

-- ---------------------------------------------------------------------------
-- El borde de los 10 minutos con la hora fija (P-40)
-- ---------------------------------------------------------------------------
-- La 06 se creó el 1-sep-2026 a las 12:00 en Bogotá: su reserva llega hasta las 12:10 exactas, inclusive.
set local role authenticated;
select is(
  (select resultado from privado.registrar_pago('50000000-0000-0000-0000-000000001806',
     'c0000000-0000-0000-0000-000000001801/e1800000-0000-0000-0000-000000000006.png', 'Ana', 'ana@calibra.test',
     timestamptz '2026-09-01 12:10:00.000001-05')),
  'vencida', 'Con 10 minutos y un microsegundo ya venció: vencida');
insert into r select 'p_06', * from privado.registrar_pago('50000000-0000-0000-0000-000000001806',
  'c0000000-0000-0000-0000-000000001801/e1800000-0000-0000-0000-000000000006.png', 'Ana', 'ana@calibra.test',
  timestamptz '2026-09-01 12:10-05');
select is((select resultado from r where k = 'p_06'), 'registrado',
  'P-40: con exactamente 10 minutos todavía se paga (borde inclusivo): registrado');
reset role;
select results_eq(
  $$select p.fecha_asignacion, p.fecha_pago, p.id_admin, m.estado::text
    from public.pago p join r on r.id_pago = p.id join public.monitoria m on m.id = p.id_monitoria
    where r.k = 'p_06'$$,
  $$values (timestamptz '2026-09-01 12:10-05', timestamptz '2026-09-01 12:10-05',
            'a0000000-0000-0000-0000-0000000018b0'::uuid, 'confirmada'::text)$$,
  'El pago guarda como fechas de pago y de asignación la hora con que se creó, va al turno y confirma la monitoría');

-- ---------------------------------------------------------------------------
-- Al final: solo las dos monitorías pagadas tienen pago
-- ---------------------------------------------------------------------------
select results_eq(
  $$select id_monitoria, count(*)::int from public.pago
    where id_monitoria::text like '50000000-0000-0000-0000-0000000018%' group by id_monitoria order by id_monitoria$$,
  $$values ('50000000-0000-0000-0000-000000001801'::uuid, 1), ('50000000-0000-0000-0000-000000001806'::uuid, 1)$$,
  'Solo la 01 y la 06 tienen pago, uno cada una: ningún rechazo creó nada');

select * from finish();
rollback;
