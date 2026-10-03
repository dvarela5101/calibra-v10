-- Pruebas pgTAP de la bandeja del admin (HU-012 y HU-064): vista desembolsos_ejecutables (RN-83; pagos en revisión y sin pagos aprobados, HU-028; casos P-24 abiertos, HU-078), semilla y admin desactivado (RN-23).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.

begin;
create extension if not exists pgtap with schema extensions;

select plan(34);

-- ---------------------------------------------------------------------------
-- 1. Estructura y permisos
-- ---------------------------------------------------------------------------
select has_view('public', 'desembolsos_ejecutables', 'Existe la vista desembolsos_ejecutables');

select is(
  (select reloptions from pg_class where oid = 'public.desembolsos_ejecutables'::regclass),
  array['security_invoker=true'],
  'La vista corre con los permisos de quien consulta');

select is(
  (select array_agg(attname::text order by attnum) from pg_attribute
   where attrelid = 'public.desembolsos_ejecutables'::regclass and attnum > 0 and not attisdropped),
  array['id', 'id_monitoria', 'monto_neto', 'fecha_generacion', 'desembolsable_desde', 'fecha_sesion'],
  'Solo expone lo que la bandeja necesita: nada de bruto, comisión ni llave del monitor');

select ok(
  not has_table_privilege('anon', 'public.desembolsos_ejecutables', 'select')
  and has_table_privilege('authenticated', 'public.desembolsos_ejecutables', 'select')
  and has_table_privilege('service_role', 'public.desembolsos_ejecutables', 'select')
  and not has_table_privilege('authenticated', 'public.desembolsos_ejecutables', 'insert'),
  'Solo lectura y sin acceso para anon');

-- ---------------------------------------------------------------------------
-- 2. Semilla (criterio 3): existen los admins iniciales con su orden de revisión
--    Corre tras `supabase db reset` o sobre una base nueva.
-- ---------------------------------------------------------------------------
select results_eq(
  $$select correo, orden_revision from public.admin
    where correo in ('admin1@calibra.test', 'admin2@calibra.test') order by orden_revision$$,
  $$values ('admin1@calibra.test'::text, 1), ('admin2@calibra.test'::text, 2)$$,
  'La semilla crea los admins iniciales con su ordenRevision (1 y 2)');

select is(
  (select count(*)::int
   from public.admin a
   join auth.users u on u.id = a.id
   join auth.identities i on i.user_id = u.id and i.provider = 'email'
   where a.correo in ('admin1@calibra.test', 'admin2@calibra.test')
     and u.email_confirmed_at is not null
     and u.encrypted_password is not null),
  2,
  'Cada admin de la semilla es una cuenta de Auth confirmada, con identidad de correo y contraseña');

-- ---------------------------------------------------------------------------
-- 3. Fixtures (como postgres)
--    admin a0..01 (y a0..03, otro admin activo), monitor b0..01, sesión anónima c0..0a. Franja: lunes 10:00, 60 min.
--    Monitorías todas en lunes. Las pasadas (2020) ya cumplieron la ventana de 24 h; la de 2030 no.
-- ---------------------------------------------------------------------------
insert into auth.users (id, is_anonymous) values
  ('a0000000-0000-0000-0000-000000000001', false),
  ('a0000000-0000-0000-0000-000000000003', false),
  ('b0000000-0000-0000-0000-000000000001', false),
  ('c0000000-0000-0000-0000-00000000000a', true);

insert into public.materia (id, nombre, codigo) values ('10000000-0000-0000-0000-000000000001', 'Materia', 'PRB-1');
-- orden_revision es único y la semilla usa 1 y 2: aquí, números altos.
insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-000000000001', 'Admin Prueba', 'admin@example.com', 9000001),
  ('a0000000-0000-0000-0000-000000000003', 'Otro Admin', 'otro-admin@example.com', 9000003);
insert into public.monitor (id, nombre) values ('b0000000-0000-0000-0000-000000000001', 'Monitor Uno');
insert into public.monitor_privado (id_monitor, numero_telefono, correo, llave) values
  ('b0000000-0000-0000-0000-000000000001', '3000000001', 'm1@example.com', 'llave-m1');
insert into public.certificado (id_monitor, id_materia, id_admin) values
  ('b0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001');
insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min) values
  ('30000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 1, '10:00', true, 25000, 60);
insert into public.lead (id, id_sesion_anonima, nombre, correo, acepta_tratamiento_datos, fecha_consentimiento) values
  ('40000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000a', 'Lead A', 'a@example.com', true, now());

-- M1 pasada, sin reporte: ejecutable.            M2 futura (2030): no.
-- M3 pasada con reporte en revisión: no.          M4 pasada con reporte aceptado: no.
-- M5 pasada con reporte rechazado: ejecutable.    M6 desembolso ya desembolsado: no.
-- M7 desembolso anulado: no.
-- HU-028: M9 pasada con un pago aprobado y otro en revisión: no (D-39).
--         M10 pasada con su único pago rechazado, un caso P-24 abierto: no (HU-078).    M11 pasada sin pagos: no.
insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado, fecha_finalizacion) values
  ('50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-00000000000a', '2020-01-06', 25000, 'realizada', '2020-01-06 16:30:00+00'),
  ('50000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-00000000000a', '2020-01-20', 25000, 'realizada', '2020-01-20 16:30:00+00'),
  ('50000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-00000000000a', '2020-01-27', 25000, 'realizada', '2020-01-27 16:30:00+00'),
  ('50000000-0000-0000-0000-000000000005', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-00000000000a', '2020-02-03', 25000, 'realizada', '2020-02-03 16:30:00+00'),
  ('50000000-0000-0000-0000-000000000006', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-00000000000a', '2020-02-10', 25000, 'realizada', '2020-02-10 16:30:00+00'),
  ('50000000-0000-0000-0000-000000000007', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-00000000000a', '2020-02-17', 25000, 'realizada', '2020-02-17 16:30:00+00'),
  ('50000000-0000-0000-0000-000000000009', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-00000000000a', '2020-03-02', 25000, 'realizada', '2020-03-02 16:30:00+00'),
  ('50000000-0000-0000-0000-000000000010', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-00000000000a', '2020-03-09', 25000, 'realizada', '2020-03-09 16:30:00+00'),
  ('50000000-0000-0000-0000-000000000011', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-00000000000a', '2020-03-16', 25000, 'realizada', '2020-03-16 16:30:00+00');
insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total) values
  ('50000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-00000000000a', '2030-01-07', 25000);

insert into public.desembolso (id_monitoria, monto_bruto, comision, monto_neto, llave_destino, estado, id_admin, fecha_desembolso, referencia_transferencia) values
  ('50000000-0000-0000-0000-000000000001', 25000, 2500, 22500, 'llave-m1', 'pendiente', null, null, null),
  ('50000000-0000-0000-0000-000000000002', 25000, 2500, 22500, 'llave-m1', 'pendiente', null, null, null),
  ('50000000-0000-0000-0000-000000000003', 25000, 2500, 22500, 'llave-m1', 'pendiente', null, null, null),
  ('50000000-0000-0000-0000-000000000004', 25000, 2500, 22500, 'llave-m1', 'pendiente', null, null, null),
  ('50000000-0000-0000-0000-000000000005', 25000, 2500, 22500, 'llave-m1', 'pendiente', null, null, null),
  ('50000000-0000-0000-0000-000000000006', 25000, 2500, 22500, 'llave-m1', 'desembolsado', 'a0000000-0000-0000-0000-000000000001', now(), 'REF-1'),
  ('50000000-0000-0000-0000-000000000007', 25000, 2500, 22500, 'llave-m1', 'anulado', null, null, null),
  ('50000000-0000-0000-0000-000000000009', 25000, 2500, 22500, 'llave-m1', 'pendiente', null, null, null),
  -- La foto de la M10 y la M11 dice 22.500: la vista mira los pagos de ahora, no la foto.
  ('50000000-0000-0000-0000-000000000010', 25000, 2500, 22500, 'llave-m1', 'pendiente', null, null, null),
  ('50000000-0000-0000-0000-000000000011', 25000, 2500, 22500, 'llave-m1', 'pendiente', null, null, null);

insert into public.reporte_inasistencia (id_monitoria, id_admin, estado, fecha_decision) values
  ('50000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'en_revision', null),
  ('50000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'aceptado', now()),
  ('50000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'rechazado', now());

-- Los pagos (HU-028): sin uno aprobado no hay nada que transferir, así que cada monitoría con desembolso, salvo la M10
-- y la M11, tiene un pago aprobado de 25.000 y solo la excluye lo que dice su caso. La M1 tiene además uno rechazado
-- con su caso P-24 ya cerrado (HU-078), que no bloquea: abierto bloquearía, como el de la M10. El pago en revisión de
-- la M9 es del otro admin: la vista lo ve igual, porque todo admin activo lee
-- todos los pagos. El id es 61000000-...-000000000NNk (NN = la monitoría, k = a, b) y cada pago apunta a su propio
-- comprobante revisado (HU-059).
create temp table pago_prueba on commit drop as
select ('61000000-0000-0000-0000-000000000' || v.nn || v.k)::uuid as id,
       ('50000000-0000-0000-0000-0000000000' || v.nn)::uuid as id_monitoria,
       v.estado::public.estado_pago as estado, v.id_admin::uuid as id_admin,
       'c0000000-0000-0000-0000-00000000000a/61000000-0000-0000-0000-000000000' || v.nn || v.k || '.png' as comprobante
from (values
  ('01', 'a', 'aprobado', 'a0000000-0000-0000-0000-000000000001'), ('01', 'b', 'rechazado', 'a0000000-0000-0000-0000-000000000001'),
  ('02', 'a', 'aprobado', 'a0000000-0000-0000-0000-000000000001'), ('03', 'a', 'aprobado', 'a0000000-0000-0000-0000-000000000001'),
  ('04', 'a', 'aprobado', 'a0000000-0000-0000-0000-000000000001'), ('05', 'a', 'aprobado', 'a0000000-0000-0000-0000-000000000001'),
  ('06', 'a', 'aprobado', 'a0000000-0000-0000-0000-000000000001'), ('07', 'a', 'aprobado', 'a0000000-0000-0000-0000-000000000001'),
  ('09', 'a', 'aprobado', 'a0000000-0000-0000-0000-000000000001'), ('09', 'b', 'en_revision', 'a0000000-0000-0000-0000-000000000003'),
  ('10', 'a', 'rechazado', 'a0000000-0000-0000-0000-000000000001')
) as v(nn, k, estado, id_admin);

insert into public.comprobante_revisado (ruta, tipo) select comprobante, 'image/png' from pago_prueba;
insert into public.pago (id, id_monitoria, monto, nombre_pagador, contacto, estado, fecha_revision, id_admin, comprobante)
select id, id_monitoria, 25000, 'Pagador Prueba', 'pagador@example.com', estado,
       case when estado <> 'en_revision' then now() end, id_admin, comprobante
from pago_prueba;
update public.pago
set cierre_rechazo = 'asumido', id_admin_cierre = 'a0000000-0000-0000-0000-000000000001', fecha_cierre = now()
where id = '61000000-0000-0000-0000-00000000001b';

-- ---------------------------------------------------------------------------
-- 4. Qué desembolsos son ejecutables (RN-83)
-- ---------------------------------------------------------------------------
select results_eq(
  $$select id_monitoria::text from public.desembolsos_ejecutables
    where id_monitoria::text like '50000000-%' order by fecha_sesion$$,
  $$values ('50000000-0000-0000-0000-000000000001'), ('50000000-0000-0000-0000-000000000005')$$,
  'Son ejecutables el pendiente ya pasado sin reporte y el de un reporte rechazado, y ningún otro');

select is(
  (select count(*)::int from public.desembolsos_ejecutables where id_monitoria = '50000000-0000-0000-0000-000000000002'),
  0,
  'Un desembolso cuya ventana de 24 h no ha vencido no es ejecutable');

select is(
  (select count(*)::int from public.desembolsos_ejecutables where id_monitoria = '50000000-0000-0000-0000-000000000003'),
  0,
  'Con un reporte en revisión no es ejecutable');

select is(
  (select count(*)::int from public.desembolsos_ejecutables where id_monitoria = '50000000-0000-0000-0000-000000000004'),
  0,
  'Con un reporte aceptado no es ejecutable');

select is(
  (select count(*)::int from public.desembolsos_ejecutables where id_monitoria = '50000000-0000-0000-0000-000000000005'),
  1,
  'Con un reporte rechazado vuelve a ser ejecutable (HU-030)');

select is(
  (select count(*)::int from public.desembolsos_ejecutables where id_monitoria in
    ('50000000-0000-0000-0000-000000000006', '50000000-0000-0000-0000-000000000007')),
  0,
  'Un desembolso ya desembolsado o anulado no es ejecutable');

select is(
  (select count(*)::int from public.desembolsos_ejecutables where id_monitoria = '50000000-0000-0000-0000-000000000009'),
  0,
  'HU-028 (D-39): con un pago en revisión no es ejecutable, aunque otro ya esté aprobado y ese pago sea de otro admin');

select is(
  (select count(*)::int from public.desembolsos_ejecutables where id_monitoria = '50000000-0000-0000-0000-000000000010'),
  0,
  'HU-078 (D-39): con su único pago rechazado y el caso P-24 abierto no es ejecutable (caso_abierto), aunque la foto diga 22.500');

select is(
  (select count(*)::int from public.desembolsos_ejecutables where id_monitoria = '50000000-0000-0000-0000-000000000011'),
  0,
  'HU-028 (supuesto 2): sin ningún pago tampoco');

-- Lo que bloqueaba a la M9 era ese pago: aprobado, ya es ejecutable. Vuelve a revisión para lo que sigue.
update public.pago set estado = 'aprobado', fecha_revision = now() where id = '61000000-0000-0000-0000-00000000009b';
select is(
  (select count(*)::int from public.desembolsos_ejecutables where id_monitoria = '50000000-0000-0000-0000-000000000009'),
  1,
  'HU-028 (D-39): aprobado ese pago, la M9 ya es ejecutable');
update public.pago set estado = 'en_revision', fecha_revision = null where id = '61000000-0000-0000-0000-00000000009b';

select results_eq(
  $$select monto_neto, fecha_sesion, desembolsable_desde from public.desembolsos_ejecutables
    where id_monitoria = '50000000-0000-0000-0000-000000000001'$$,
  $$values (22500, '2020-01-06'::date, '2020-01-07 16:00:00+00'::timestamptz)$$,
  'Trae el neto, la fecha de la sesión y desde cuándo es ejecutable (fin 11:00 Bogotá = 16:00 UTC, más 24 h)');

-- ---------------------------------------------------------------------------
-- 4b. El borde exacto (N-6): la ventana de reporte vence justo ahora
--     now() no cambia dentro de la transacción, así que se arman tres sesiones de 60 minutos cuyo
--     límite (fin + 24 h) cae en now() - 1 microsegundo, en now() y en now() + 1 microsegundo. La
--     hora de la franja acepta microsegundos, y Bogotá no tiene horario de verano.
-- ---------------------------------------------------------------------------
create temp table borde on commit drop as
select n, (now() - interval '25 hours' + n * interval '1 microsecond') at time zone 'America/Bogota' as inicio_local
from (values (-1), (0), (1)) as t(n);

insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min)
select format('30000000-0000-0000-0000-0000000001%s', lpad((n + 2)::text, 2, '0'))::uuid,
       'b0000000-0000-0000-0000-000000000001',
       extract(isodow from inicio_local::date)::int, inicio_local::time, true, 25000, 60
from borde;

insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado, fecha_finalizacion)
select format('51000000-0000-0000-0000-0000000000%s', lpad((n + 2)::text, 2, '0'))::uuid,
       format('30000000-0000-0000-0000-0000000001%s', lpad((n + 2)::text, 2, '0'))::uuid,
       '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-00000000000a',
       inicio_local::date, 25000, 'realizada', now()
from borde;

insert into public.desembolso (id_monitoria, monto_bruto, comision, monto_neto, llave_destino)
select format('51000000-0000-0000-0000-0000000000%s', lpad((n + 2)::text, 2, '0'))::uuid, 25000, 2500, 22500, 'llave-m1'
from borde;

-- Cada una con su pago aprobado (HU-028), para que solo decida el plazo.
insert into public.comprobante_revisado (ruta, tipo)
select format('c0000000-0000-0000-0000-00000000000a/62000000-0000-0000-0000-0000000000%s.png', lpad((n + 2)::text, 2, '0')), 'image/png'
from borde;
insert into public.pago (id, id_monitoria, monto, nombre_pagador, contacto, estado, fecha_revision, id_admin, comprobante)
select format('62000000-0000-0000-0000-0000000000%s', lpad((n + 2)::text, 2, '0'))::uuid,
       format('51000000-0000-0000-0000-0000000000%s', lpad((n + 2)::text, 2, '0'))::uuid,
       25000, 'Pagador Prueba', 'pagador@example.com', 'aprobado', now(), 'a0000000-0000-0000-0000-000000000001',
       format('c0000000-0000-0000-0000-00000000000a/62000000-0000-0000-0000-0000000000%s.png', lpad((n + 2)::text, 2, '0'))
from borde;

select is(
  (select array_agg(desembolsable_desde - now() order by id_monitoria)
   from public.monitoria_plazos where id_monitoria::text like '51000000-%'),
  array[interval '-1 microsecond', interval '0', interval '1 microsecond'],
  'Las tres sesiones de prueba tienen su límite de desembolso en now() - 1 µs, now() y now() + 1 µs');

select is(
  (select count(*)::int from public.desembolsos_ejecutables where id_monitoria = '51000000-0000-0000-0000-000000000002'),
  0,
  'En el instante exacto fin + 24 h el reporte sigue abierto: el desembolso todavía no es ejecutable (N-6)');

select is(
  (select count(*)::int from public.desembolsos_ejecutables where id_monitoria = '51000000-0000-0000-0000-000000000001'),
  1,
  'Un microsegundo después del límite, el desembolso ya es ejecutable');

select is(
  (select count(*)::int from public.desembolsos_ejecutables where id_monitoria = '51000000-0000-0000-0000-000000000003'),
  0,
  'Un microsegundo antes del límite, todavía no');

select is(
  (select count(*)::int from public.desembolsos_ejecutables where id_monitoria::text like '51000000-%'),
  1,
  'De las tres sesiones alrededor del borde, solo la que ya pasó el límite es ejecutable');

-- ---------------------------------------------------------------------------
-- 4c. La bandeja y la página dicen lo mismo (HU-028): un desembolso de la prueba está en la vista si y solo si
--     privado.estado_para_ejecutar lo deja ejecutar con la misma hora (now() no cambia en la transacción).
-- ---------------------------------------------------------------------------
select results_eq(
  $$select id_monitoria::text from public.desembolsos_ejecutables
    where id_monitoria::text like '50000000-%' or id_monitoria::text like '51000000-%' order by 1$$,
  $$select d.id_monitoria::text
    from public.desembolso d
    cross join lateral privado.estado_para_ejecutar(d.id, now()) e
    where (d.id_monitoria::text like '50000000-%' or d.id_monitoria::text like '51000000-%') and e.motivo is null
    order by 1$$,
  'La vista lista exactamente los desembolsos que privado.estado_para_ejecutar deja ejecutar ahora');

-- ---------------------------------------------------------------------------
-- 5. Quién la ve (RLS de desembolso y monitoria)
-- ---------------------------------------------------------------------------
set local role authenticated;

set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.desembolsos_ejecutables where id_monitoria::text like '50000000-%'), 2, 'Un admin ve los ejecutables');

set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.desembolsos_ejecutables), 0,
  'El monitor no los ve: los desembolsos son de los admins (P-32 sin decidir)');

set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-00000000000a","role":"authenticated","is_anonymous":true}';
select is((select count(*)::int from public.desembolsos_ejecutables), 0, 'Quien agendó tampoco los ve');

reset role;
set local role anon;
select throws_ok($$select * from public.desembolsos_ejecutables$$, '42501', null, 'Sin sesión (anon) no hay acceso');
reset role;

-- ---------------------------------------------------------------------------
-- 6. Un admin desactivado (RN-23) no ve nada de la bandeja. HU-064.
--    Desactivar es banear la cuenta en Auth: la fila de admin y lo que tiene asignado se conservan,
--    pero privado.es_admin() ya no lo cuenta aunque su token siga vigente. Se le asignan un pago, un
--    reembolso y un reporte, y hay un correo sin enviar: todo lo que lee la bandeja.
-- ---------------------------------------------------------------------------
insert into auth.users (id, is_anonymous, banned_until) values
  ('a0000000-0000-0000-0000-000000000002', false, now() + interval '100 years');
insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-000000000002', 'Admin Desactivado', 'admin-desactivado@example.com', 9000002);
insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado, fecha_finalizacion) values
  ('50000000-0000-0000-0000-000000000008', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-00000000000a', '2020-02-24', 25000, 'realizada', '2020-02-24 16:30:00+00');
-- Un pago solo puede apuntar a un comprobante que el servidor revisó (HU-059).
insert into public.comprobante_revisado (ruta, tipo) values
  ('c0000000-0000-0000-0000-00000000000a/60000000-0000-0000-0000-000000000008.png', 'image/png');
insert into public.pago (id, id_monitoria, monto, nombre_pagador, contacto, id_admin, comprobante) values
  ('60000000-0000-0000-0000-000000000008', '50000000-0000-0000-0000-000000000008', 25000, 'Pagador Prueba', 'pagador@example.com',
   'a0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-00000000000a/60000000-0000-0000-0000-000000000008.png');
insert into public.reembolso (id_pago, id_admin, monto, motivo) values
  ('60000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000002', 25000, 'Prueba');
insert into public.reporte_inasistencia (id_monitoria, id_admin) values
  ('50000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000002');
insert into public.correo_envio (clave, plantilla, destinatario, estado, ultimo_error) values
  ('invitacion_monitor:prueba-hu-064', 'invitacion_monitor', 'desactivado@example.com', 'fallido', 'Prueba');

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}';

select is(public.mi_rol(), null, 'Con la cuenta desactivada ya no tiene rol de admin');
select is((select count(*)::int from public.desembolsos_ejecutables), 0, 'Un admin desactivado no ve desembolsos ejecutables');
select is((select count(*)::int from public.pago), 0, 'Ni los pagos, tampoco el que tiene asignado');
select is((select count(*)::int from public.reembolso), 0, 'Ni los reembolsos');
select is((select count(*)::int from public.reporte_inasistencia), 0, 'Ni los reportes de inasistencia');
select is((select count(*)::int from public.correo_envio), 0, 'Ni los correos que no salieron');

-- Control: con la misma sesión y la cuenta reactivada, ve todo lo anterior. Lo que lo ocultaba era la desactivación.
reset role;
update auth.users set banned_until = null where id = 'a0000000-0000-0000-0000-000000000002';
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}';

select is(
  array[
    (select count(*)::int from public.desembolsos_ejecutables where id_monitoria::text like '50000000-%'),
    (select count(*)::int from public.pago where id = '60000000-0000-0000-0000-000000000008'),
    (select count(*)::int from public.reembolso where id_pago = '60000000-0000-0000-0000-000000000008'),
    (select count(*)::int from public.reporte_inasistencia where id_monitoria = '50000000-0000-0000-0000-000000000008'),
    (select count(*)::int from public.correo_envio where clave = 'invitacion_monitor:prueba-hu-064')
  ],
  array[2, 1, 1, 1, 1],
  'Reactivado, el mismo admin vuelve a ver sus desembolsos, pago, reembolso, reporte y correo');
reset role;

select * from finish();
rollback;
