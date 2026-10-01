-- Pruebas pgTAP del equipo de admins (HU-054): turno de revisión (RN-07), desactivar sin borrar (RN-23) y
-- reasignación de los casos abiertos al siguiente admin activo (P-44).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.
--
-- La base local puede traer otros admins (la semilla, o datos de desarrollo) y el turno recorre a TODOS los admins.
-- Para que la prueba no dependa de ellos: (1) se banean dentro de la transacción, así quedan inactivos; (2) los admins
-- de la prueba llevan un orden_revision negativo (-1000 a -996), por delante de cualquier otro.
--
-- Admins de la prueba, en su orden inicial:
--   A (-1000) activo · B (-999) activo · C (-998) activo · D (-997) desactivado · E (-996) con un baneo ya vencido (activo)

begin;
create extension if not exists pgtap with schema extensions;

select plan(133);

-- ---------------------------------------------------------------------------
-- 1. Fixtures (como postgres)
-- ---------------------------------------------------------------------------
-- Cualquier admin que ya existiera queda inactivo durante la prueba.
update auth.users set banned_until = 'infinity' where id in (select id from public.admin);

insert into auth.users (id, is_anonymous, banned_until) values
  ('a0000000-0000-0000-0000-00000000540a', false, null),
  ('a0000000-0000-0000-0000-00000000540b', false, null),
  ('a0000000-0000-0000-0000-00000000540c', false, null),
  ('a0000000-0000-0000-0000-00000000540d', false, now() + interval '100 years'),
  ('a0000000-0000-0000-0000-00000000540e', false, '2020-01-01'),
  ('b0000000-0000-0000-0000-000000005401', false, null),
  ('c0000000-0000-0000-0000-000000005401', true, null);

insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-00000000540a', 'Admin A', 'admin-a-hu054@calibra.test', -1000),
  ('a0000000-0000-0000-0000-00000000540b', 'Admin B', 'admin-b-hu054@calibra.test', -999),
  ('a0000000-0000-0000-0000-00000000540c', 'Admin C', 'admin-c-hu054@calibra.test', -998),
  ('a0000000-0000-0000-0000-00000000540d', 'Admin D', 'admin-d-hu054@calibra.test', -997),
  ('a0000000-0000-0000-0000-00000000540e', 'Admin E', 'admin-e-hu054@calibra.test', -996);

insert into public.materia (id, nombre, codigo) values ('10000000-0000-0000-0000-000000005401', 'Materia', 'PRB-5401');
insert into public.monitor (id, nombre) values ('b0000000-0000-0000-0000-000000005401', 'Monitor Uno');
insert into public.monitor_privado (id_monitor, numero_telefono, correo, llave) values
  ('b0000000-0000-0000-0000-000000005401', '3000005401', 'm-hu054@example.com', 'llave-m1');
-- El certificado lo emite el admin B: es el que se desactiva más abajo.
insert into public.certificado (id_monitor, id_materia, id_admin) values
  ('b0000000-0000-0000-0000-000000005401', '10000000-0000-0000-0000-000000005401', 'a0000000-0000-0000-0000-00000000540b');
insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min) values
  ('30000000-0000-0000-0000-000000005401', 'b0000000-0000-0000-0000-000000005401', 1, '10:00', true, 25000, 60);
insert into public.lead (id, id_sesion_anonima, nombre, correo, acepta_tratamiento_datos, fecha_consentimiento) values
  ('40000000-0000-0000-0000-000000005401', 'c0000000-0000-0000-0000-000000005401', 'Lead Uno', 'lead-hu054@example.com', true, now());

-- Cuatro sesiones ya realizadas (lunes de 2020), una por reporte de inasistencia.
insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado, fecha_finalizacion) values
  ('50000000-0000-0000-0000-000000005401', '30000000-0000-0000-0000-000000005401', '10000000-0000-0000-0000-000000005401', '40000000-0000-0000-0000-000000005401', '2020-01-06', 25000, 'realizada', '2020-01-06 16:30:00+00'),
  ('50000000-0000-0000-0000-000000005402', '30000000-0000-0000-0000-000000005401', '10000000-0000-0000-0000-000000005401', '40000000-0000-0000-0000-000000005401', '2020-01-13', 25000, 'realizada', '2020-01-13 16:30:00+00'),
  ('50000000-0000-0000-0000-000000005403', '30000000-0000-0000-0000-000000005401', '10000000-0000-0000-0000-000000005401', '40000000-0000-0000-0000-000000005401', '2020-01-20', 25000, 'realizada', '2020-01-20 16:30:00+00'),
  ('50000000-0000-0000-0000-000000005404', '30000000-0000-0000-0000-000000005401', '10000000-0000-0000-0000-000000005401', '40000000-0000-0000-0000-000000005401', '2020-01-27', 25000, 'realizada', '2020-01-27 16:30:00+00');

-- Un pago solo puede apuntar a un comprobante que el servidor revisó (HU-059).
insert into public.comprobante_revisado (ruta, tipo) values
  ('c0000000-0000-0000-0000-000000005401/60000000-0000-0000-0000-000000005401.png', 'image/png'),
  ('c0000000-0000-0000-0000-000000005401/60000000-0000-0000-0000-000000005402.png', 'image/png'),
  ('c0000000-0000-0000-0000-000000005401/60000000-0000-0000-0000-000000005403.png', 'image/png'),
  ('c0000000-0000-0000-0000-000000005401/60000000-0000-0000-0000-000000005404.png', 'image/png'),
  ('c0000000-0000-0000-0000-000000005401/60000000-0000-0000-0000-000000005405.png', 'image/png');

-- Pagos 1, 2, 3 y 5 son de B y ya los revisó (aprobados); el 4 es de A y sigue en revisión.
insert into public.pago (id, id_monitoria, monto, nombre_pagador, contacto, estado, fecha_revision, id_admin, comprobante) values
  ('60000000-0000-0000-0000-000000005401', '50000000-0000-0000-0000-000000005401', 25000, 'Pagador Uno', 'p1@example.com', 'aprobado', now(),
   'a0000000-0000-0000-0000-00000000540b', 'c0000000-0000-0000-0000-000000005401/60000000-0000-0000-0000-000000005401.png'),
  ('60000000-0000-0000-0000-000000005402', '50000000-0000-0000-0000-000000005401', 25000, 'Pagador Dos', 'p2@example.com', 'aprobado', now(),
   'a0000000-0000-0000-0000-00000000540b', 'c0000000-0000-0000-0000-000000005401/60000000-0000-0000-0000-000000005402.png'),
  ('60000000-0000-0000-0000-000000005403', '50000000-0000-0000-0000-000000005401', 25000, 'Pagador Tres', 'p3@example.com', 'aprobado', now(),
   'a0000000-0000-0000-0000-00000000540b', 'c0000000-0000-0000-0000-000000005401/60000000-0000-0000-0000-000000005403.png'),
  ('60000000-0000-0000-0000-000000005404', '50000000-0000-0000-0000-000000005401', 25000, 'Pagador Cuatro', 'p4@example.com', 'en_revision', null,
   'a0000000-0000-0000-0000-00000000540a', 'c0000000-0000-0000-0000-000000005401/60000000-0000-0000-0000-000000005404.png'),
  ('60000000-0000-0000-0000-000000005405', '50000000-0000-0000-0000-000000005401', 25000, 'Pagador Cinco', 'p5@example.com', 'aprobado', now(),
   'a0000000-0000-0000-0000-00000000540b', 'c0000000-0000-0000-0000-000000005401/60000000-0000-0000-0000-000000005405.png');

-- Reembolsos de B: 1 esperando la llave (abierto), 2 pendiente (abierto), 3 ya reembolsado (cerrado).
-- Reembolso de A: 4 pendiente (abierto).
insert into public.reembolso (id, id_pago, id_admin, monto, motivo, llave_destino, estado, fecha_reembolso, referencia_transferencia) values
  ('70000000-0000-0000-0000-000000005401', '60000000-0000-0000-0000-000000005401', 'a0000000-0000-0000-0000-00000000540b', 25000, 'Prueba 1', null, 'esperando_llave', null, null),
  ('70000000-0000-0000-0000-000000005402', '60000000-0000-0000-0000-000000005402', 'a0000000-0000-0000-0000-00000000540b', 25000, 'Prueba 2', 'llave-p2', 'pendiente', null, null),
  ('70000000-0000-0000-0000-000000005403', '60000000-0000-0000-0000-000000005403', 'a0000000-0000-0000-0000-00000000540b', 25000, 'Prueba 3', 'llave-p3', 'reembolsado', now(), 'REF-R3'),
  ('70000000-0000-0000-0000-000000005404', '60000000-0000-0000-0000-000000005404', 'a0000000-0000-0000-0000-00000000540a', 25000, 'Prueba 4', 'llave-p4', 'pendiente', null, null);

-- Reportes de B: 1 en revisión (abierto), 2 aceptado y 3 rechazado (cerrados). Reporte de A: 4 en revisión (abierto).
insert into public.reporte_inasistencia (id, id_monitoria, id_admin, estado, fecha_decision) values
  ('80000000-0000-0000-0000-000000005401', '50000000-0000-0000-0000-000000005401', 'a0000000-0000-0000-0000-00000000540b', 'en_revision', null),
  ('80000000-0000-0000-0000-000000005402', '50000000-0000-0000-0000-000000005402', 'a0000000-0000-0000-0000-00000000540b', 'aceptado', now()),
  ('80000000-0000-0000-0000-000000005403', '50000000-0000-0000-0000-000000005403', 'a0000000-0000-0000-0000-00000000540b', 'rechazado', now()),
  ('80000000-0000-0000-0000-000000005404', '50000000-0000-0000-0000-000000005404', 'a0000000-0000-0000-0000-00000000540a', 'en_revision', null);

-- Ayudantes (viven solo en esta sesión). Los dos leen todo con los permisos del dueño, para poder llamarlos con
-- cualquier rol activo.
-- orden(): los admins de la prueba, de primero a último en el orden de revisión.
create function pg_temp.orden() returns uuid[]
language sql stable security definer set search_path = ''
as $$
  select array_agg(id order by orden_revision) from public.admin
  where id in ('a0000000-0000-0000-0000-00000000540a', 'a0000000-0000-0000-0000-00000000540b', 'a0000000-0000-0000-0000-00000000540c',
               'a0000000-0000-0000-0000-00000000540d', 'a0000000-0000-0000-0000-00000000540e');
$$;
-- puestos(): sus números de orden, en el mismo orden. Un intercambio nunca los cambia, solo los reparte.
create function pg_temp.puestos() returns integer[]
language sql stable security definer set search_path = ''
as $$
  select array_agg(orden_revision order by orden_revision) from public.admin
  where id in ('a0000000-0000-0000-0000-00000000540a', 'a0000000-0000-0000-0000-00000000540b', 'a0000000-0000-0000-0000-00000000540c',
               'a0000000-0000-0000-0000-00000000540d', 'a0000000-0000-0000-0000-00000000540e');
$$;
-- abiertos(id): casos abiertos de un admin (reembolsos activos + reportes en revisión).
create function pg_temp.abiertos(p_id uuid) returns integer
language sql stable security definer set search_path = ''
as $$
  select ((select count(*) from public.reembolso where id_admin = p_id and estado in ('esperando_llave', 'pendiente'))
        + (select count(*) from public.reporte_inasistencia where id_admin = p_id and estado = 'en_revision'))::integer;
$$;
-- aislar(): vuelve a desactivar a cualquier admin que no sea de la prueba. La base local la pueden estar usando otras
-- pruebas a la vez (integración, e2e) y crear admins confirmados mientras esta corre; el turno los vería. Se llama
-- antes de cada grupo de comprobaciones que depende de quién está activo.
create procedure pg_temp.aislar()
language sql security definer set search_path = ''
as $$
  update auth.users set banned_until = 'infinity'
  where id in (select id from public.admin
               where id not in ('a0000000-0000-0000-0000-00000000540a', 'a0000000-0000-0000-0000-00000000540b', 'a0000000-0000-0000-0000-00000000540c',
                                'a0000000-0000-0000-0000-00000000540d', 'a0000000-0000-0000-0000-00000000540e'))
    and (banned_until is null or banned_until <= now());
$$;
-- turno(id): privado.siguiente_admin_activo, para llamarlo mientras la sesión de la prueba es la de un admin.
create function pg_temp.turno(p_despues_de uuid default null) returns uuid
language sql stable security definer set search_path = ''
as $$
  select privado.siguiente_admin_activo(p_despues_de);
$$;
-- duenos(): la última letra del id del admin dueño de cada caso, para ver adónde fue cada uno.
-- Orden: r1, r2, r3, r4, ri1, ri2, ri3, ri4.
create function pg_temp.duenos() returns text[]
language sql stable security definer set search_path = ''
as $$
  select array[
    (select right(id_admin::text, 1) from public.reembolso where id = '70000000-0000-0000-0000-000000005401'),
    (select right(id_admin::text, 1) from public.reembolso where id = '70000000-0000-0000-0000-000000005402'),
    (select right(id_admin::text, 1) from public.reembolso where id = '70000000-0000-0000-0000-000000005403'),
    (select right(id_admin::text, 1) from public.reembolso where id = '70000000-0000-0000-0000-000000005404'),
    (select right(id_admin::text, 1) from public.reporte_inasistencia where id = '80000000-0000-0000-0000-000000005401'),
    (select right(id_admin::text, 1) from public.reporte_inasistencia where id = '80000000-0000-0000-0000-000000005402'),
    (select right(id_admin::text, 1) from public.reporte_inasistencia where id = '80000000-0000-0000-0000-000000005403'),
    (select right(id_admin::text, 1) from public.reporte_inasistencia where id = '80000000-0000-0000-0000-000000005404')
  ];
$$;

select is(pg_temp.orden(),
  array['a0000000-0000-0000-0000-00000000540a', 'a0000000-0000-0000-0000-00000000540b', 'a0000000-0000-0000-0000-00000000540c',
        'a0000000-0000-0000-0000-00000000540d', 'a0000000-0000-0000-0000-00000000540e']::uuid[],
  'Punto de partida: el orden de revisión es A, B, C, D, E');
select is(pg_temp.duenos(), array['b', 'b', 'b', 'a', 'b', 'b', 'b', 'a'],
  'Punto de partida: B tiene tres casos abiertos y tres cerrados; A tiene dos abiertos');

-- Estructura de las funciones.
select has_function('privado', 'admin_activo', array['uuid'], 'Existe privado.admin_activo(uuid)');
select has_function('privado', 'siguiente_admin_activo', array['uuid'], 'Existe privado.siguiente_admin_activo(uuid)');
select has_function('public', 'reasignar_casos_de_admin', array['uuid'], 'Existe public.reasignar_casos_de_admin(uuid)');
select has_function('public', 'equipo_de_admins', array[]::text[], 'Existe public.equipo_de_admins()');
select has_function('public', 'mover_admin', array['uuid', 'text'], 'Existe public.mover_admin(uuid, text)');

-- ---------------------------------------------------------------------------
-- 2. privado.admin_activo: el mismo criterio de privado.es_admin(), para cualquier admin
-- ---------------------------------------------------------------------------
call pg_temp.aislar();
select is(privado.admin_activo('a0000000-0000-0000-0000-00000000540a'), true, 'Un admin sin baneo está activo');
select is(privado.admin_activo('a0000000-0000-0000-0000-00000000540d'), false, 'Un admin baneado (desactivado) no está activo');
select is(privado.admin_activo('a0000000-0000-0000-0000-00000000540e'), true, 'Con el baneo ya vencido vuelve a estar activo');

-- El borde: banned_until igual a now() ya no cuenta como baneo (now() no cambia dentro de la transacción).
update auth.users set banned_until = now() where id = 'a0000000-0000-0000-0000-00000000540a';
select is(privado.admin_activo('a0000000-0000-0000-0000-00000000540a'), true, 'Un baneo que vence exactamente ahora ya no desactiva');
update auth.users set banned_until = now() + interval '1 microsecond' where id = 'a0000000-0000-0000-0000-00000000540a';
select is(privado.admin_activo('a0000000-0000-0000-0000-00000000540a'), false, 'Un baneo que vence un microsegundo después todavía desactiva');
update auth.users set banned_until = null where id = 'a0000000-0000-0000-0000-00000000540a';

select is(privado.admin_activo('b0000000-0000-0000-0000-000000005401'), false, 'Un monitor (cuenta sin fila de admin) no es un admin activo');
select is(privado.admin_activo('c0000000-0000-0000-0000-000000005401'), false, 'Una sesión anónima tampoco');
select is(privado.admin_activo('a0000000-0000-0000-0000-00000000540f'), false, 'Un id que no existe no es un admin activo');
select is(privado.admin_activo(null), false, 'Sin id, falso');
select is(
  (select coalesce(bool_and(not privado.admin_activo(id)), true) from public.admin
   where id not in (select unnest(pg_temp.orden()))),
  true, 'Los admins que ya existían quedaron inactivos para esta prueba');

-- ---------------------------------------------------------------------------
-- 3. privado.siguiente_admin_activo: el turno (RN-07)
-- ---------------------------------------------------------------------------
call pg_temp.aislar();
select is(privado.siguiente_admin_activo(null), 'a0000000-0000-0000-0000-00000000540a'::uuid,
  'Sin id, el turno es del primer admin activo');
select is(privado.siguiente_admin_activo(), 'a0000000-0000-0000-0000-00000000540a'::uuid,
  'Sin argumento es lo mismo que null');
select is(privado.siguiente_admin_activo('a0000000-0000-0000-0000-00000000540a'), 'a0000000-0000-0000-0000-00000000540b'::uuid,
  'Después de A sigue B');
select is(privado.siguiente_admin_activo('a0000000-0000-0000-0000-00000000540b'), 'a0000000-0000-0000-0000-00000000540c'::uuid,
  'Después de B sigue C');
select is(privado.siguiente_admin_activo('a0000000-0000-0000-0000-00000000540c'), 'a0000000-0000-0000-0000-00000000540e'::uuid,
  'Después de C sigue E: se salta a D, que está desactivado');
call pg_temp.aislar();
select is(privado.siguiente_admin_activo('a0000000-0000-0000-0000-00000000540e'), 'a0000000-0000-0000-0000-00000000540a'::uuid,
  'Después del último activo vuelve al primero (los admins anteriores, inactivos, no estorban)');
select is(privado.siguiente_admin_activo('a0000000-0000-0000-0000-00000000540d'), 'a0000000-0000-0000-0000-00000000540e'::uuid,
  'Si el admin dado está desactivado, sigue el activo que le toca después de él');
select is(privado.siguiente_admin_activo('a0000000-0000-0000-0000-00000000540f'), 'a0000000-0000-0000-0000-00000000540a'::uuid,
  'Con un id que no es de un admin se comporta como sin id: el primero activo');

call pg_temp.aislar();
-- Un admin intermedio desactivado se salta.
update auth.users set banned_until = now() + interval '100 years' where id = 'a0000000-0000-0000-0000-00000000540b';
select is(privado.siguiente_admin_activo('a0000000-0000-0000-0000-00000000540a'), 'a0000000-0000-0000-0000-00000000540c'::uuid,
  'Con B desactivado, después de A sigue C');
update auth.users set banned_until = null where id = 'a0000000-0000-0000-0000-00000000540b';

call pg_temp.aislar();
-- Nunca devuelve al mismo admin.
update auth.users set banned_until = now() + interval '100 years'
  where id in ('a0000000-0000-0000-0000-00000000540b', 'a0000000-0000-0000-0000-00000000540c', 'a0000000-0000-0000-0000-00000000540e');
select is(privado.siguiente_admin_activo('a0000000-0000-0000-0000-00000000540a'), null,
  'Si A es el único activo, después de A no hay nadie (nunca se devuelve a sí mismo)');
select is(privado.siguiente_admin_activo(null), 'a0000000-0000-0000-0000-00000000540a'::uuid,
  'Y sin id, el único activo es A');
select is(privado.siguiente_admin_activo('a0000000-0000-0000-0000-00000000540b'), 'a0000000-0000-0000-0000-00000000540a'::uuid,
  'Un admin inactivo tiene como siguiente al único activo');

call pg_temp.aislar();
update auth.users set banned_until = now() + interval '100 years' where id = 'a0000000-0000-0000-0000-00000000540a';
select is(privado.siguiente_admin_activo(null), null, 'Sin ningún admin activo, el turno es nulo');
select is(privado.siguiente_admin_activo('a0000000-0000-0000-0000-00000000540c'), null, 'Y también con un id dado');

-- Se restaura el estado de partida: A, B, C activos; D desactivado; E con baneo vencido.
update auth.users set banned_until = null
  where id in ('a0000000-0000-0000-0000-00000000540a', 'a0000000-0000-0000-0000-00000000540b', 'a0000000-0000-0000-0000-00000000540c');
update auth.users set banned_until = '2020-01-01' where id = 'a0000000-0000-0000-0000-00000000540e';
select is(privado.siguiente_admin_activo('a0000000-0000-0000-0000-00000000540c'), 'a0000000-0000-0000-0000-00000000540e'::uuid,
  'Restaurado el estado de partida, el turno vuelve a ser el de antes');

-- ---------------------------------------------------------------------------
-- 4. public.equipo_de_admins: solo para un admin activo
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-00000000540a","role":"authenticated"}';

select results_eq(
  $$select id::text, nombre, correo, orden_revision, activo, casos_abiertos
    from public.equipo_de_admins()
    where id in ('a0000000-0000-0000-0000-00000000540a', 'a0000000-0000-0000-0000-00000000540b', 'a0000000-0000-0000-0000-00000000540c',
                 'a0000000-0000-0000-0000-00000000540d', 'a0000000-0000-0000-0000-00000000540e')$$,
  $$values
    ('a0000000-0000-0000-0000-00000000540a', 'Admin A', 'admin-a-hu054@calibra.test', -1000, true, 2),
    ('a0000000-0000-0000-0000-00000000540b', 'Admin B', 'admin-b-hu054@calibra.test', -999, true, 3),
    ('a0000000-0000-0000-0000-00000000540c', 'Admin C', 'admin-c-hu054@calibra.test', -998, true, 0),
    ('a0000000-0000-0000-0000-00000000540d', 'Admin D', 'admin-d-hu054@calibra.test', -997, false, 0),
    ('a0000000-0000-0000-0000-00000000540e', 'Admin E', 'admin-e-hu054@calibra.test', -996, true, 0)$$,
  'Un admin activo ve al equipo en su orden: quién está activo y cuántos casos abiertos tiene cada uno');

select is(
  (select array_agg(orden_revision) from public.equipo_de_admins()),
  (select array_agg(orden_revision order by orden_revision) from public.equipo_de_admins()),
  'La lista completa viene ordenada por orden_revision');

select is(
  (select count(*)::int from public.equipo_de_admins()
   where id in ('a0000000-0000-0000-0000-00000000540a', 'a0000000-0000-0000-0000-00000000540b', 'a0000000-0000-0000-0000-00000000540c',
                'a0000000-0000-0000-0000-00000000540d', 'a0000000-0000-0000-0000-00000000540e')),
  5, 'Aparecen también los desactivados: a un admin se le desactiva, no se le borra');

-- Un admin con el baneo ya vencido sigue siendo un admin activo.
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-00000000540e","role":"authenticated"}';
select cmp_ok((select count(*)::int from public.equipo_de_admins()), '>=', 5,
  'Un admin con el baneo vencido también ve al equipo');

-- Un admin desactivado no.
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-00000000540d","role":"authenticated"}';
select is((select count(*)::int from public.equipo_de_admins()), 0, 'Un admin desactivado no ve nada: ni quién está en el equipo');

-- Un monitor no.
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-000000005401","role":"authenticated"}';
select is((select count(*)::int from public.equipo_de_admins()), 0, 'Un monitor no ve al equipo');

-- Una sesión anónima no.
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000005401","role":"authenticated","is_anonymous":true}';
select is((select count(*)::int from public.equipo_de_admins()), 0, 'Quien agendó (sesión anónima) no ve al equipo');

-- Sin sesión (anon), la puerta ni se abre.
reset role;
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';
select throws_ok($$select * from public.equipo_de_admins()$$, '42501', null, 'Sin sesión (anon) no hay acceso a equipo_de_admins');
reset role;

-- ---------------------------------------------------------------------------
-- 5. public.mover_admin: subir y bajar en el orden de revisión (RN-07)
--    Siempre lo pide A, un admin activo.
-- ---------------------------------------------------------------------------
-- El primero y el último de todos los admins (incluidos los que ya existían), para probar los bordes.
create temporary table extremos on commit drop as
select
  (select id from public.admin order by orden_revision limit 1) as primero,
  (select id from public.admin order by orden_revision desc limit 1) as ultimo;
grant select on extremos to authenticated, anon;

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-00000000540a","role":"authenticated"}';

call pg_temp.aislar();
select is(public.mover_admin('a0000000-0000-0000-0000-00000000540b', 'arriba'), 'movido', 'Subir a B un puesto: movido');
select is(pg_temp.orden(),
  array['a0000000-0000-0000-0000-00000000540b', 'a0000000-0000-0000-0000-00000000540a', 'a0000000-0000-0000-0000-00000000540c',
        'a0000000-0000-0000-0000-00000000540d', 'a0000000-0000-0000-0000-00000000540e']::uuid[],
  'B y A intercambiaron su lugar: B, A, C, D, E');
select is(pg_temp.puestos(), array[-1000, -999, -998, -997, -996],
  'Es un intercambio: los números de orden son los mismos, solo cambió quién tiene cuál');
select is(pg_temp.turno(null), 'a0000000-0000-0000-0000-00000000540b'::uuid,
  'Reordenar cambia el turno: ahora el primero activo es B');
select is(pg_temp.turno('a0000000-0000-0000-0000-00000000540b'), 'a0000000-0000-0000-0000-00000000540a'::uuid,
  'Y después de B sigue A');
select is(pg_temp.turno('a0000000-0000-0000-0000-00000000540a'), 'a0000000-0000-0000-0000-00000000540c'::uuid,
  'Y después de A sigue C');

select is(public.mover_admin('a0000000-0000-0000-0000-00000000540b', 'arriba'), 'en_el_borde',
  'B ya es el primero de todos: subirlo es en_el_borde');
select is(pg_temp.orden(),
  array['a0000000-0000-0000-0000-00000000540b', 'a0000000-0000-0000-0000-00000000540a', 'a0000000-0000-0000-0000-00000000540c',
        'a0000000-0000-0000-0000-00000000540d', 'a0000000-0000-0000-0000-00000000540e']::uuid[],
  'En el borde no cambia nada');

select is(public.mover_admin('a0000000-0000-0000-0000-00000000540b', 'abajo'), 'movido', 'Bajar a B un puesto: movido');
select is(pg_temp.orden(),
  array['a0000000-0000-0000-0000-00000000540a', 'a0000000-0000-0000-0000-00000000540b', 'a0000000-0000-0000-0000-00000000540c',
        'a0000000-0000-0000-0000-00000000540d', 'a0000000-0000-0000-0000-00000000540e']::uuid[],
  'Vuelve el orden de partida: A, B, C, D, E');
select is(pg_temp.turno(null), 'a0000000-0000-0000-0000-00000000540a'::uuid, 'Y el turno vuelve a empezar en A');

-- El vecino cuenta aunque esté desactivado: E sube un puesto y se cambia con D.
select is(public.mover_admin('a0000000-0000-0000-0000-00000000540e', 'arriba'), 'movido', 'Subir a E, cuyo vecino D está desactivado: movido');
select is(pg_temp.orden(),
  array['a0000000-0000-0000-0000-00000000540a', 'a0000000-0000-0000-0000-00000000540b', 'a0000000-0000-0000-0000-00000000540c',
        'a0000000-0000-0000-0000-00000000540e', 'a0000000-0000-0000-0000-00000000540d']::uuid[],
  'E y D intercambiaron su lugar: A, B, C, E, D');
select is(pg_temp.turno('a0000000-0000-0000-0000-00000000540c'), 'a0000000-0000-0000-0000-00000000540e'::uuid,
  'El turno después de C sigue siendo E');
select is(public.mover_admin('a0000000-0000-0000-0000-00000000540e', 'abajo'), 'movido', 'Bajar a E: movido');
select is(pg_temp.orden(),
  array['a0000000-0000-0000-0000-00000000540a', 'a0000000-0000-0000-0000-00000000540b', 'a0000000-0000-0000-0000-00000000540c',
        'a0000000-0000-0000-0000-00000000540d', 'a0000000-0000-0000-0000-00000000540e']::uuid[],
  'De vuelta: A, B, C, D, E');

-- Bajar al que tiene debajo a un desactivado.
select is(public.mover_admin('a0000000-0000-0000-0000-00000000540c', 'abajo'), 'movido', 'Bajar a C, cuyo vecino D está desactivado: movido');
select is(pg_temp.orden(),
  array['a0000000-0000-0000-0000-00000000540a', 'a0000000-0000-0000-0000-00000000540b', 'a0000000-0000-0000-0000-00000000540d',
        'a0000000-0000-0000-0000-00000000540c', 'a0000000-0000-0000-0000-00000000540e']::uuid[],
  'C y D intercambiaron su lugar: A, B, D, C, E');
select is(public.mover_admin('a0000000-0000-0000-0000-00000000540c', 'arriba'), 'movido', 'Subir a C: movido');
select is(pg_temp.orden(),
  array['a0000000-0000-0000-0000-00000000540a', 'a0000000-0000-0000-0000-00000000540b', 'a0000000-0000-0000-0000-00000000540c',
        'a0000000-0000-0000-0000-00000000540d', 'a0000000-0000-0000-0000-00000000540e']::uuid[],
  'De vuelta: A, B, C, D, E');

-- Los bordes de verdad: el primero y el último de todos los admins.
select is(public.mover_admin((select primero from extremos), 'arriba'), 'en_el_borde', 'El primero de todos no puede subir: en_el_borde');
select is(public.mover_admin((select ultimo from extremos), 'abajo'), 'en_el_borde', 'El último de todos no puede bajar: en_el_borde');

select is(public.mover_admin('a0000000-0000-0000-0000-00000000540f', 'arriba'), 'no_encontrado', 'Un id que no es de un admin: no_encontrado');
select is(public.mover_admin('b0000000-0000-0000-0000-000000005401', 'abajo'), 'no_encontrado', 'Un monitor no es un admin que se pueda mover: no_encontrado');

select throws_ok($$select public.mover_admin('a0000000-0000-0000-0000-00000000540b', 'izquierda')$$, '22023', null,
  'Una dirección que no es arriba ni abajo: error 22023');
select throws_ok($$select public.mover_admin('a0000000-0000-0000-0000-00000000540b', '')$$, '22023', null,
  'Una dirección vacía: error 22023');

select is(pg_temp.orden(),
  array['a0000000-0000-0000-0000-00000000540a', 'a0000000-0000-0000-0000-00000000540b', 'a0000000-0000-0000-0000-00000000540c',
        'a0000000-0000-0000-0000-00000000540d', 'a0000000-0000-0000-0000-00000000540e']::uuid[],
  'Los bordes, los no encontrados y los errores no cambian el orden');

-- Quien no es un admin activo no mueve a nadie.
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-000000005401","role":"authenticated"}';
select is(public.mover_admin('a0000000-0000-0000-0000-00000000540b', 'arriba'), 'sin_permiso', 'Un monitor no mueve admins: sin_permiso');
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000005401","role":"authenticated","is_anonymous":true}';
select is(public.mover_admin('a0000000-0000-0000-0000-00000000540b', 'arriba'), 'sin_permiso', 'Una sesión anónima no mueve admins: sin_permiso');
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-00000000540d","role":"authenticated"}';
select is(public.mover_admin('a0000000-0000-0000-0000-00000000540b', 'arriba'), 'sin_permiso', 'Un admin desactivado no mueve admins: sin_permiso');
select is(public.mover_admin('a0000000-0000-0000-0000-00000000540d', 'arriba'), 'sin_permiso', 'Ni siquiera se mueve a sí mismo: sin_permiso');
select is(pg_temp.orden(),
  array['a0000000-0000-0000-0000-00000000540a', 'a0000000-0000-0000-0000-00000000540b', 'a0000000-0000-0000-0000-00000000540c',
        'a0000000-0000-0000-0000-00000000540d', 'a0000000-0000-0000-0000-00000000540e']::uuid[],
  'Sin permiso no cambió el orden');

-- Un admin con el baneo vencido sí puede.
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-00000000540e","role":"authenticated"}';
select is(public.mover_admin('a0000000-0000-0000-0000-00000000540e', 'arriba'), 'movido', 'Un admin con el baneo vencido sí mueve: movido');
select is(public.mover_admin('a0000000-0000-0000-0000-00000000540e', 'abajo'), 'movido', 'Y lo devuelve a su lugar: movido');
select is(pg_temp.orden(),
  array['a0000000-0000-0000-0000-00000000540a', 'a0000000-0000-0000-0000-00000000540b', 'a0000000-0000-0000-0000-00000000540c',
        'a0000000-0000-0000-0000-00000000540d', 'a0000000-0000-0000-0000-00000000540e']::uuid[],
  'El orden de partida está intacto: A, B, C, D, E');

-- Sin sesión (anon): ni se abre la puerta.
reset role;
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';
select throws_ok($$select public.mover_admin('a0000000-0000-0000-0000-00000000540b', 'arriba')$$, '42501', null,
  'Sin sesión (anon) no hay acceso a mover_admin');
reset role;

-- ---------------------------------------------------------------------------
-- 6. Reasignar los casos abiertos de un admin (P-44)
--    La lógica se prueba llamando a privado.reasignar_casos_de_admin (como postgres). La puerta pública, solo para
--    service_role, se prueba en la sección 7.
-- ---------------------------------------------------------------------------
call pg_temp.aislar();
-- Un admin sin casos abiertos: no hay nada que mover.
select is(privado.reasignar_casos_de_admin('a0000000-0000-0000-0000-00000000540c'), 0, 'C no tiene casos abiertos: devuelve 0');
select is(pg_temp.duenos(), array['b', 'b', 'b', 'a', 'b', 'b', 'b', 'a'], 'Y no mueve nada');

call pg_temp.aislar();
-- B tiene 3 abiertos (2 reembolsos y 1 reporte) y 3 cerrados. El siguiente activo después de B es C.
select is(pg_temp.abiertos('a0000000-0000-0000-0000-00000000540b'), 3, 'B tiene tres casos abiertos');
select is(privado.reasignar_casos_de_admin('a0000000-0000-0000-0000-00000000540b'), 3,
  'Reasignar a B mueve sus tres casos abiertos y devuelve 3');
select is(pg_temp.duenos(), array['c', 'c', 'b', 'a', 'c', 'b', 'b', 'a'],
  'Los reembolsos esperando_llave y pendiente y el reporte en revisión pasan a C; los cerrados (reembolsado, aceptado, rechazado) se quedan con B; lo de A no se toca');
select is(pg_temp.abiertos('a0000000-0000-0000-0000-00000000540b'), 0, 'B ya no tiene casos abiertos');
select is(privado.reasignar_casos_de_admin('a0000000-0000-0000-0000-00000000540b'), 0, 'Repetirlo no mueve nada más: devuelve 0');
select is(pg_temp.duenos(), array['c', 'c', 'b', 'a', 'c', 'b', 'b', 'a'], 'Y todo sigue donde estaba');

-- Se desactiva a B (como hace desactivarCuenta tras reasignar): su fila, certificados y pagos revisados se conservan (RN-23).
update auth.users set banned_until = now() + interval '100 years' where id = 'a0000000-0000-0000-0000-00000000540b';
select is(privado.admin_activo('a0000000-0000-0000-0000-00000000540b'), false, 'B quedó desactivado');
select is((select count(*)::int from public.admin where id = 'a0000000-0000-0000-0000-00000000540b'), 1,
  'La fila de B sigue en public.admin (se desactiva, nunca se borra)');
select is((select count(*)::int from public.certificado where id_admin = 'a0000000-0000-0000-0000-00000000540b'), 1,
  'El certificado que emitió B se conserva con su id_admin');
select is(
  (select count(*)::int from public.pago where id_admin = 'a0000000-0000-0000-0000-00000000540b' and estado = 'aprobado' and fecha_revision is not null),
  4, 'Los cuatro pagos que B ya revisó se conservan a su nombre');
select is(
  (select count(*)::int from public.certificado where id_monitor = 'b0000000-0000-0000-0000-000000005401'),
  1, 'La certificación del monitor sigue vigente');

-- La pantalla refleja el nuevo reparto.
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-00000000540a","role":"authenticated"}';
select results_eq(
  $$select id::text, activo, casos_abiertos from public.equipo_de_admins()
    where id in ('a0000000-0000-0000-0000-00000000540a', 'a0000000-0000-0000-0000-00000000540b', 'a0000000-0000-0000-0000-00000000540c')$$,
  $$values
    ('a0000000-0000-0000-0000-00000000540a', true, 2),
    ('a0000000-0000-0000-0000-00000000540b', false, 0),
    ('a0000000-0000-0000-0000-00000000540c', true, 3)$$,
  'La pantalla del equipo muestra a B inactivo y sin casos abiertos, y a C con los tres que recibió');
reset role;

call pg_temp.aislar();
-- C también se desactiva: sus casos saltan a E, porque B (desactivado) y D (desactivado) no cuentan.
update auth.users set banned_until = now() + interval '100 years' where id = 'a0000000-0000-0000-0000-00000000540c';
select is(privado.reasignar_casos_de_admin('a0000000-0000-0000-0000-00000000540c'), 3,
  'Reasignar a C mueve sus tres casos abiertos y devuelve 3');
select is(pg_temp.duenos(), array['e', 'e', 'b', 'a', 'e', 'b', 'b', 'a'],
  'Pasan a E (se salta a D, desactivado); los cerrados de B siguen con B');

call pg_temp.aislar();
-- E es el último: sus casos dan la vuelta y pasan al primer activo, A.
select is(privado.reasignar_casos_de_admin('a0000000-0000-0000-0000-00000000540e'), 3,
  'Reasignar a E, el último, mueve sus tres casos y devuelve 3');
select is(pg_temp.duenos(), array['a', 'a', 'b', 'a', 'a', 'b', 'b', 'a'],
  'Dan la vuelta y pasan a A; los cerrados de B siguen con B');
select is(pg_temp.abiertos('a0000000-0000-0000-0000-00000000540a'), 5, 'A acumula cinco casos abiertos (dos propios y tres recibidos)');

call pg_temp.aislar();
-- Con casos abiertos y ningún otro admin activo, falla y no deja nada a medias.
update auth.users set banned_until = now() + interval '100 years' where id = 'a0000000-0000-0000-0000-00000000540e';
select throws_ok(
  $$select privado.reasignar_casos_de_admin('a0000000-0000-0000-0000-00000000540a')$$,
  'P0001', 'No hay otro admin activo que reciba los casos abiertos.',
  'Si A tiene casos abiertos y es el único admin activo, no se puede reasignar: error P0001');
select is(pg_temp.duenos(), array['a', 'a', 'b', 'a', 'a', 'b', 'b', 'a'], 'Y los casos de A siguen siendo de A');
select is(pg_temp.abiertos('a0000000-0000-0000-0000-00000000540a'), 5, 'A conserva sus cinco casos abiertos');

-- Sin casos abiertos no hace falta nadie que los reciba: devuelve 0 aunque no haya ningún admin activo.
select is(privado.reasignar_casos_de_admin('a0000000-0000-0000-0000-00000000540b'), 0,
  'B solo tiene casos cerrados: devuelve 0 (hay otro admin activo)');
update auth.users set banned_until = now() + interval '100 years' where id = 'a0000000-0000-0000-0000-00000000540a';
call pg_temp.aislar();
select is(privado.siguiente_admin_activo(null), null, 'Ahora no hay ningún admin activo');
select is(privado.reasignar_casos_de_admin('a0000000-0000-0000-0000-00000000540b'), 0,
  'B solo tiene casos cerrados: devuelve 0 aunque no haya ningún admin activo');
select is(privado.reasignar_casos_de_admin('a0000000-0000-0000-0000-00000000540c'), 0,
  'C ya no tiene casos abiertos: devuelve 0 aunque no haya ningún admin activo');
select is(pg_temp.duenos(), array['a', 'a', 'b', 'a', 'a', 'b', 'b', 'a'], 'Y nada se movió');

-- Un admin con casos abiertos y sin ningún admin activo tampoco puede reasignar.
select throws_ok(
  $$select privado.reasignar_casos_de_admin('a0000000-0000-0000-0000-00000000540a')$$,
  'P0001', null,
  'A tiene casos abiertos y ya no queda ningún admin activo: error P0001');

-- Un id sin casos (ni admin): 0.
select is(privado.reasignar_casos_de_admin('a0000000-0000-0000-0000-00000000540f'), 0, 'Un id que no es de un admin no tiene casos: devuelve 0');

-- Se reactiva a A para lo que sigue.
update auth.users set banned_until = null where id = 'a0000000-0000-0000-0000-00000000540a';

call pg_temp.aislar();
-- Se le devuelven a C reembolsos y un reporte abiertos, para probar la suma de los dos tipos.
update public.reembolso set id_admin = 'a0000000-0000-0000-0000-00000000540c'
  where id in ('70000000-0000-0000-0000-000000005401', '70000000-0000-0000-0000-000000005402', '70000000-0000-0000-0000-000000005404');
update public.reporte_inasistencia set id_admin = 'a0000000-0000-0000-0000-00000000540c'
  where id = '80000000-0000-0000-0000-000000005401';
-- C (desactivado) queda con cuatro abiertos: tres reembolsos (esperando_llave y pendientes) y un reporte en revisión.
-- El reporte de A (ri4) sigue con A.
select is(privado.reasignar_casos_de_admin('a0000000-0000-0000-0000-00000000540c'), 4,
  'Cuenta reembolsos (esperando_llave y pendiente) y reportes en revisión: 4 casos y devuelve 4');
select is(pg_temp.duenos(), array['a', 'a', 'b', 'a', 'a', 'b', 'b', 'a'], 'Todos al único activo, A');

-- ---------------------------------------------------------------------------
-- 7. Permisos
-- ---------------------------------------------------------------------------
select ok(
  not has_function_privilege('anon', 'public.equipo_de_admins()', 'execute')
  and not has_function_privilege('anon', 'public.mover_admin(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.reasignar_casos_de_admin(uuid)', 'execute'),
  'anon no ejecuta ninguna de las tres funciones públicas');
select ok(
  has_function_privilege('authenticated', 'public.equipo_de_admins()', 'execute')
  and has_function_privilege('authenticated', 'public.mover_admin(uuid, text)', 'execute'),
  'Con sesión se piden el equipo y mover (la función decide quién es admin)');
select ok(not has_function_privilege('authenticated', 'public.reasignar_casos_de_admin(uuid)', 'execute'),
  'Con sesión no se reasignan casos: solo lo hace el servidor');
select ok(has_function_privilege('service_role', 'public.reasignar_casos_de_admin(uuid)', 'execute'),
  'service_role ejecuta reasignar_casos_de_admin');
select ok(
  not has_function_privilege('service_role', 'public.equipo_de_admins()', 'execute')
  and not has_function_privilege('service_role', 'public.mover_admin(uuid, text)', 'execute'),
  'service_role no ejecuta el equipo ni mover: son de la sesión de un admin');
select ok(
  has_schema_privilege('service_role', 'privado', 'usage')
  and has_schema_privilege('authenticated', 'privado', 'usage')
  and has_schema_privilege('anon', 'privado', 'usage'),
  'service_role entra al esquema privado (la puerta pública corre con sus permisos), igual que anon y authenticated');
select ok(
  not has_function_privilege('anon', 'privado.admin_activo(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'privado.admin_activo(uuid)', 'execute')
  and not has_function_privilege('service_role', 'privado.admin_activo(uuid)', 'execute'),
  'Nadie (anon, authenticated, service_role) ejecuta privado.admin_activo directamente');
select ok(
  not has_function_privilege('anon', 'privado.siguiente_admin_activo(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'privado.siguiente_admin_activo(uuid)', 'execute')
  and not has_function_privilege('service_role', 'privado.siguiente_admin_activo(uuid)', 'execute'),
  'Nadie (anon, authenticated, service_role) ejecuta privado.siguiente_admin_activo directamente');
select ok(
  not has_function_privilege('anon', 'privado.reasignar_casos_de_admin(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'privado.reasignar_casos_de_admin(uuid)', 'execute'),
  'Con o sin sesión no se ejecuta privado.reasignar_casos_de_admin directamente');
select ok(
  not has_function_privilege('anon', 'privado.equipo_de_admins()', 'execute')
  and not has_function_privilege('anon', 'privado.mover_admin(uuid, text)', 'execute'),
  'anon tampoco ejecuta las funciones de privado detrás de la pantalla');

-- Llamadas de verdad, no solo la tabla de permisos.
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';
select throws_ok($$select public.reasignar_casos_de_admin('a0000000-0000-0000-0000-00000000540b')$$, '42501', null,
  'Sin sesión (anon) no reasigna casos');
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-00000000540a","role":"authenticated"}';
select throws_ok($$select public.reasignar_casos_de_admin('a0000000-0000-0000-0000-00000000540b')$$, '42501', null,
  'Ni un admin activo reasigna casos desde su sesión');
select throws_ok($$select privado.admin_activo('a0000000-0000-0000-0000-00000000540a')$$, '42501', null,
  'Un admin activo no llama a privado.admin_activo directamente');
select throws_ok($$select privado.siguiente_admin_activo(null)$$, '42501', null,
  'Un admin activo no llama a privado.siguiente_admin_activo directamente');
select throws_ok($$select privado.reasignar_casos_de_admin('a0000000-0000-0000-0000-00000000540b')$$, '42501', null,
  'Un admin activo no llama a privado.reasignar_casos_de_admin directamente');
reset role;

set local role service_role;
select throws_ok($$select privado.admin_activo('a0000000-0000-0000-0000-00000000540a')$$, '42501', null,
  'service_role entra al esquema privado, pero no llama a privado.admin_activo directamente');
select throws_ok($$select privado.siguiente_admin_activo(null)$$, '42501', null,
  'service_role no llama a privado.siguiente_admin_activo directamente');
select throws_ok($$select public.equipo_de_admins()$$, '42501', null, 'service_role no llama a public.equipo_de_admins');
select throws_ok($$select public.mover_admin('a0000000-0000-0000-0000-00000000540b', 'arriba')$$, '42501', null,
  'service_role no llama a public.mover_admin');
reset role;

call pg_temp.aislar();
-- La puerta pública con la llave secreta: lo que usa desactivarCuenta antes de banear.
-- C vuelve a tener tres casos abiertos (dos reembolsos y un reporte); A es el único admin activo.
update public.reembolso set id_admin = 'a0000000-0000-0000-0000-00000000540c'
  where id in ('70000000-0000-0000-0000-000000005401', '70000000-0000-0000-0000-000000005402');
update public.reporte_inasistencia set id_admin = 'a0000000-0000-0000-0000-00000000540c'
  where id = '80000000-0000-0000-0000-000000005401';
select is(pg_temp.abiertos('a0000000-0000-0000-0000-00000000540c'), 3, 'C tiene tres casos abiertos');

set local role service_role;
select is(public.reasignar_casos_de_admin('a0000000-0000-0000-0000-00000000540c'), 3,
  'service_role reasigna a C por la puerta pública: devuelve 3');
reset role;
select is(pg_temp.duenos(), array['a', 'a', 'b', 'a', 'a', 'b', 'b', 'a'], 'Los tres pasaron a A, el único activo; los cerrados siguen con B');

set local role service_role;
select is(public.reasignar_casos_de_admin('a0000000-0000-0000-0000-00000000540c'), 0, 'Por la puerta pública, sin casos abiertos devuelve 0');
select throws_ok(
  $$select public.reasignar_casos_de_admin('a0000000-0000-0000-0000-00000000540a')$$,
  'P0001', 'No hay otro admin activo que reciba los casos abiertos.',
  'Por la puerta pública, con casos abiertos y ningún otro admin activo, falla con P0001');
reset role;
select is(pg_temp.duenos(), array['a', 'a', 'b', 'a', 'a', 'b', 'b', 'a'], 'Y no deja nada a medias');

-- ---------------------------------------------------------------------------
-- 8. Una dirección nula se rechaza (hallazgo de esta prueba, corregido en la migración)
-- ---------------------------------------------------------------------------
-- Una dirección nula no es ni arriba ni abajo: `p_direccion not in (...)` solo daría nulo, así que la función la
--     comprueba aparte y lanza 22023. (Va al final: si fallara, movería un puesto a B dentro de la transacción.)
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-00000000540a","role":"authenticated"}';
select throws_ok($$select public.mover_admin('a0000000-0000-0000-0000-00000000540b', null)$$, '22023', null,
  'Una dirección nula es inválida: error 22023');
reset role;

select * from finish();
rollback;
