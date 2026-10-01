-- Pruebas pgTAP de los monitores de una materia y sus fechas libres (HU-016).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.
--
-- Casi todo se prueba con privado.fechas_libres_de_materia y un `ahora` fijo, el lunes 5 de octubre de
-- 2026 a las 12:00 en Bogotá, para que los bordes no dependan del día en que corre la prueba. La puerta
-- pública usa now(): al final se comprueba que cada rol recibe lo mismo.

begin;
create extension if not exists pgtap with schema extensions;

select plan(39);

-- ---------------------------------------------------------------------------
-- Estructura y permisos
-- ---------------------------------------------------------------------------
select has_function('privado', 'fecha_libre', array['uuid', 'date', 'timestamp with time zone'],
  'Existe privado.fecha_libre, la regla única de "esta fecha se puede agendar"');
select has_function('privado', 'fechas_libres_de_materia', array['text', 'integer', 'timestamp with time zone'],
  'Existe privado.fechas_libres_de_materia');
select has_function('public', 'fechas_libres_de_materia', array['text', 'integer'],
  'Existe su puerta en la Data API');
select ok(
  (select prosecdef from pg_proc where oid = 'privado.fecha_libre(uuid, date, timestamptz)'::regprocedure)
  and (select prosecdef from pg_proc where oid = 'privado.fechas_libres_de_materia(text, integer, timestamptz)'::regprocedure)
  and not (select prosecdef from pg_proc where oid = 'public.fechas_libres_de_materia(text, integer)'::regprocedure),
  'Las de privado son security definer; la puerta corre con los permisos de quien llama');
select ok(
  (select bool_and('search_path=""' = any(proconfig)) from pg_proc
   where oid in ('privado.fecha_libre(uuid, date, timestamptz)'::regprocedure,
                 'privado.fechas_libres_de_materia(text, integer, timestamptz)'::regprocedure,
                 'public.fechas_libres_de_materia(text, integer)'::regprocedure)),
  'Las tres fijan un search_path vacío');
select ok(
  has_function_privilege('anon', 'public.fechas_libres_de_materia(text, integer)', 'execute')
  and has_function_privilege('authenticated', 'public.fechas_libres_de_materia(text, integer)', 'execute'),
  'Se consulta sin sesión (la primera página del visitante) y con sesión');
select ok(
  not has_function_privilege('anon', 'privado.fecha_libre(uuid, date, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'privado.fecha_libre(uuid, date, timestamptz)', 'execute'),
  'fecha_libre no se llama desde afuera, solo desde otras funciones de la base');
select ok(
  not exists (
    select 1
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid in ('privado.fecha_libre(uuid, date, timestamptz)'::regprocedure,
                    'privado.fechas_libres_de_materia(text, integer, timestamptz)'::regprocedure,
                    'public.fechas_libres_de_materia(text, integer)'::regprocedure)
      and a.grantee = 0),
  'Nadie las hereda de PUBLIC');

-- ---------------------------------------------------------------------------
-- Fixtures (como postgres)
--   Materias X y Y; Z sin certificados.
--   A: certificado en X y Y. Franjas: lunes 10:00 presencial, lunes 23:00 virtual, miércoles 18:00 virtual.
--   B: solo en Y (martes 09:00). C: en X, con su franja ya cerrada. D: con franja y sin certificado.
--   E: en X, con la cuenta suspendida. F: en X, con una franja que abre el 20 de octubre (jueves 10:00).
-- ---------------------------------------------------------------------------
insert into auth.users (id, is_anonymous) values
  ('a0000000-0000-0000-0000-000000001601', false),
  ('b0000000-0000-0000-0000-0000000016a0', false),
  ('b0000000-0000-0000-0000-0000000016b0', false),
  ('b0000000-0000-0000-0000-0000000016c0', false),
  ('b0000000-0000-0000-0000-0000000016d0', false),
  ('b0000000-0000-0000-0000-0000000016e0', false),
  ('b0000000-0000-0000-0000-0000000016f0', false),
  ('c0000000-0000-0000-0000-000000001601', true);
update auth.users set banned_until = '2099-01-01' where id = 'b0000000-0000-0000-0000-0000000016e0';

insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-000000001601', 'Admin', 'admin16@calibra.test', 9001601);
insert into public.monitor (id, nombre) values
  ('b0000000-0000-0000-0000-0000000016a0', 'Ana'),
  ('b0000000-0000-0000-0000-0000000016b0', 'Beto'),
  ('b0000000-0000-0000-0000-0000000016c0', 'Caro'),
  ('b0000000-0000-0000-0000-0000000016d0', 'Dani'),
  ('b0000000-0000-0000-0000-0000000016e0', 'Eva'),
  ('b0000000-0000-0000-0000-0000000016f0', 'Fer');
insert into public.monitor_privado (id_monitor, numero_telefono, correo, llave) values
  ('b0000000-0000-0000-0000-0000000016a0', '3001601601', 'ana.secreta@example.com', 'llave-secreta-ana');
insert into public.materia (id, nombre, codigo) values
  ('10000000-0000-0000-0000-0000000016a1', 'Materia X', 'PRB-16X'),
  ('10000000-0000-0000-0000-0000000016b1', 'Materia Y', 'PRB-16Y'),
  ('10000000-0000-0000-0000-0000000016c1', 'Materia Z', 'PRB-16Z');
insert into public.certificado (id_monitor, id_materia, id_admin) values
  ('b0000000-0000-0000-0000-0000000016a0', '10000000-0000-0000-0000-0000000016a1', 'a0000000-0000-0000-0000-000000001601'),
  ('b0000000-0000-0000-0000-0000000016a0', '10000000-0000-0000-0000-0000000016b1', 'a0000000-0000-0000-0000-000000001601'),
  ('b0000000-0000-0000-0000-0000000016b0', '10000000-0000-0000-0000-0000000016b1', 'a0000000-0000-0000-0000-000000001601'),
  ('b0000000-0000-0000-0000-0000000016c0', '10000000-0000-0000-0000-0000000016a1', 'a0000000-0000-0000-0000-000000001601'),
  ('b0000000-0000-0000-0000-0000000016e0', '10000000-0000-0000-0000-0000000016a1', 'a0000000-0000-0000-0000-000000001601'),
  ('b0000000-0000-0000-0000-0000000016f0', '10000000-0000-0000-0000-0000000016a1', 'a0000000-0000-0000-0000-000000001601');
insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min, lugar, enlace, abierta_desde, cerrada_desde) values
  ('30000000-0000-0000-0000-0000000016a1', 'b0000000-0000-0000-0000-0000000016a0', 1, '10:00', true, 25000, 60,
   'Salón secreto 101', null, '2026-01-01', null),
  ('30000000-0000-0000-0000-0000000016a2', 'b0000000-0000-0000-0000-0000000016a0', 1, '23:00', false, 20000, 45,
   null, 'https://meet.example/sala-secreta', '2026-01-01', null),
  ('30000000-0000-0000-0000-0000000016a3', 'b0000000-0000-0000-0000-0000000016a0', 3, '18:00', false, 30000, 90,
   null, 'https://meet.example/sala-secreta', '2026-01-01', null),
  ('30000000-0000-0000-0000-0000000016b1', 'b0000000-0000-0000-0000-0000000016b0', 2, '09:00', true, 20000, 60,
   'Salón 202', null, '2026-01-01', null),
  ('30000000-0000-0000-0000-0000000016c1', 'b0000000-0000-0000-0000-0000000016c0', 1, '10:00', true, 25000, 60,
   'Salón 303', null, '2026-01-01', '2026-09-01'),
  ('30000000-0000-0000-0000-0000000016d1', 'b0000000-0000-0000-0000-0000000016d0', 1, '10:00', true, 25000, 60,
   'Salón 404', null, '2026-01-01', null),
  ('30000000-0000-0000-0000-0000000016e1', 'b0000000-0000-0000-0000-0000000016e0', 1, '10:00', true, 25000, 60,
   'Salón 505', null, '2026-01-01', null),
  ('30000000-0000-0000-0000-0000000016f1', 'b0000000-0000-0000-0000-0000000016f0', 4, '10:00', true, 25000, 60,
   'Salón 606', null, '2026-10-20', null);
insert into public.lead (id, nombre, correo, acepta_tratamiento_datos, fecha_consentimiento) values
  ('40000000-0000-0000-0000-000000001601', 'Lead', 'lead16@calibra.test', true, now());
-- Miércoles de A (18:00): una confirmada, una por pagar, una cancelada y una ya dictada.
insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado, motivo_cancelacion, fecha_finalizacion) values
  ('50000000-0000-0000-0000-000000001601', '30000000-0000-0000-0000-0000000016a3', '10000000-0000-0000-0000-0000000016a1',
   '40000000-0000-0000-0000-000000001601', '2026-10-14', 30000, 'confirmada', null, null),
  ('50000000-0000-0000-0000-000000001602', '30000000-0000-0000-0000-0000000016a3', '10000000-0000-0000-0000-0000000016a1',
   '40000000-0000-0000-0000-000000001601', '2026-10-21', 30000, 'pendiente_pago', null, null),
  ('50000000-0000-0000-0000-000000001603', '30000000-0000-0000-0000-0000000016a3', '10000000-0000-0000-0000-0000000016a1',
   '40000000-0000-0000-0000-000000001601', '2026-10-07', 30000, 'cancelada', 'estudiante', null),
  ('50000000-0000-0000-0000-000000001604', '30000000-0000-0000-0000-0000000016a3', '10000000-0000-0000-0000-0000000016a1',
   '40000000-0000-0000-0000-000000001601', '2026-09-30', 30000, 'realizada', null, '2026-09-30 19:30-05');

-- ---------------------------------------------------------------------------
-- RN-22: solo los certificados en la materia
-- ---------------------------------------------------------------------------
select results_eq(
  $$select distinct nombre_monitor from privado.fechas_libres_de_materia('PRB-16X', 4, '2026-10-05 12:00-05') order by 1$$,
  $$values ('Ana'::text), ('Fer'::text)$$,
  'RN-22: en X salen A y F; ni B (certificado en otra materia) ni D (sin certificado)');
select results_eq(
  $$select distinct nombre_monitor from privado.fechas_libres_de_materia('PRB-16Y', 4, '2026-10-05 12:00-05') order by 1$$,
  $$values ('Ana'::text), ('Beto'::text)$$,
  'En Y salen A y B');
select results_eq(
  $$select id_franja, fecha from privado.fechas_libres_de_materia('  prb-16x ', 4, '2026-10-05 12:00-05')$$,
  $$select id_franja, fecha from privado.fechas_libres_de_materia('PRB-16X', 4, '2026-10-05 12:00-05')$$,
  'El código no distingue mayúsculas ni espacios alrededor');
select is(
  (select count(*)::int from privado.fechas_libres_de_materia('NO-EXISTE', 4, '2026-10-05 12:00-05'))
  + (select count(*)::int from privado.fechas_libres_de_materia('PRB-16%', 4, '2026-10-05 12:00-05'))
  + (select count(*)::int from privado.fechas_libres_de_materia(null, 4, '2026-10-05 12:00-05'))
  + (select count(*)::int from privado.fechas_libres_de_materia('PRB-16Z', 4, '2026-10-05 12:00-05')),
  0, 'Una materia que no existe (el código se compara exacto, sin comodines) o sin certificados no da fechas');

-- ---------------------------------------------------------------------------
-- Las fechas: 4 semanas desde hoy en Bogotá, con los datos de su franja, sin ocupadas ni fuera de plazo
-- ---------------------------------------------------------------------------
select results_eq(
  $$select id_franja::text, fecha, hora, duracion_min, presencial, precio
    from privado.fechas_libres_de_materia('PRB-16X', 4, '2026-10-05 12:00-05')$$,
  $$values
    ('30000000-0000-0000-0000-0000000016a2', '2026-10-05'::date, '23:00'::time, 45, false, 20000),
    ('30000000-0000-0000-0000-0000000016a3', '2026-10-07'::date, '18:00'::time, 90, false, 30000),
    ('30000000-0000-0000-0000-0000000016a1', '2026-10-12'::date, '10:00'::time, 60, true, 25000),
    ('30000000-0000-0000-0000-0000000016a2', '2026-10-12'::date, '23:00'::time, 45, false, 20000),
    ('30000000-0000-0000-0000-0000000016a1', '2026-10-19'::date, '10:00'::time, 60, true, 25000),
    ('30000000-0000-0000-0000-0000000016a2', '2026-10-19'::date, '23:00'::time, 45, false, 20000),
    ('30000000-0000-0000-0000-0000000016f1', '2026-10-22'::date, '10:00'::time, 60, true, 25000),
    ('30000000-0000-0000-0000-0000000016a1', '2026-10-26'::date, '10:00'::time, 60, true, 25000),
    ('30000000-0000-0000-0000-0000000016a2', '2026-10-26'::date, '23:00'::time, 45, false, 20000),
    ('30000000-0000-0000-0000-0000000016a3', '2026-10-28'::date, '18:00'::time, 90, false, 30000),
    ('30000000-0000-0000-0000-0000000016f1', '2026-10-29'::date, '10:00'::time, 60, true, 25000)$$,
  'Las fechas de X del 5 de octubre al 1 de noviembre, en orden, con hora, duración, modalidad y precio');

-- RN-33
select ok(not privado.fecha_libre('30000000-0000-0000-0000-0000000016a3', '2026-10-14', '2026-10-05 12:00-05'),
  'RN-33: una monitoría confirmada ocupa su fecha');
select ok(not privado.fecha_libre('30000000-0000-0000-0000-0000000016a3', '2026-10-21', '2026-10-05 12:00-05'),
  'Una por pagar también');
select ok(privado.fecha_libre('30000000-0000-0000-0000-0000000016a3', '2026-10-07', '2026-10-05 12:00-05'),
  'Una cancelada la deja libre');
select is(
  (select count(*)::int from privado.fechas_libres_de_materia('PRB-16Y', 4, '2026-10-05 12:00-05')
   where id_franja = '30000000-0000-0000-0000-0000000016a3' and fecha in ('2026-10-14', '2026-10-21')),
  0, 'Ocupada en una materia es ocupada en todas: la franja es el tiempo del monitor');

-- Día, apertura y cierre de la franja (HU-015)
select ok(
  not privado.fecha_libre('30000000-0000-0000-0000-0000000016a1', '2026-10-13', '2026-10-05 12:00-05')
  and not privado.fecha_libre('30000000-0000-0000-0000-000000000000', '2026-10-12', '2026-10-05 12:00-05'),
  'Una fecha que no cae en el día de la franja, o una franja que no existe, no está libre');
select ok(
  not privado.fecha_libre('30000000-0000-0000-0000-0000000016f1', '2026-10-15', '2026-10-05 12:00-05')
  and privado.fecha_libre('30000000-0000-0000-0000-0000000016f1', '2026-10-22', '2026-10-05 12:00-05'),
  'Antes de abierta_desde no; desde ese día, sí');
select ok(not privado.fecha_libre('30000000-0000-0000-0000-0000000016c1', '2026-10-12', '2026-10-05 12:00-05'),
  'Una franja ya cerrada no da fechas');

-- RN-35 y P-40: 3 h de antelación, con el borde inclusivo. La franja del lunes a las 23:00, el 5 de octubre.
select ok(privado.fecha_libre('30000000-0000-0000-0000-0000000016a2', '2026-10-05', '2026-10-05 19:59:59-05'),
  'Con más de 3 h de antelación, la fecha está libre');
select ok(privado.fecha_libre('30000000-0000-0000-0000-0000000016a2', '2026-10-05', '2026-10-05 20:00:00-05'),
  'P-40: con las 3 h exactas todavía se agenda');
select ok(not privado.fecha_libre('30000000-0000-0000-0000-0000000016a2', '2026-10-05', '2026-10-05 20:00:01-05'),
  'Un segundo después, ya no');
select is(
  (select count(*)::int from privado.fechas_libres_de_materia('PRB-16X', 4, '2026-10-05 20:00:01-05') where fecha = '2026-10-05'),
  0, 'Y la lista la quita en ese mismo segundo');
select is(
  (select min(fecha) from privado.fechas_libres_de_materia('PRB-16X', 4, '2026-10-06 00:30+00')),
  '2026-10-05'::date,
  'A las 19:30 del lunes en Bogotá (ya martes en UTC), hoy es el lunes: la franja de las 23:00 sale ese día');

-- La vuelta de la semana: la franja del lunes vista desde un jueves y desde un domingo a las 22:00 en Bogotá
-- (ya lunes 03:00 en UTC) cae el lunes siguiente.
select is(
  (select min(fecha) from privado.fechas_libres_de_materia('PRB-16X', 4, '2026-10-08 12:00-05')
   where id_franja = '30000000-0000-0000-0000-0000000016a1'),
  '2026-10-12'::date, 'Desde el jueves 8, la franja del lunes cae el 12');
select is(
  (select min(fecha) from privado.fechas_libres_de_materia('PRB-16X', 4, '2026-10-12 03:00+00')
   where id_franja = '30000000-0000-0000-0000-0000000016a1'),
  '2026-10-12'::date, 'Desde el domingo 11 a las 22:00 en Bogotá, también el 12');

-- Horizonte
select is((select count(*)::int from privado.fechas_libres_de_materia('PRB-16X', 1, '2026-10-05 12:00-05')), 2,
  'Con 1 semana, solo las fechas del 5 al 11 de octubre');
select ok(
  (select count(*) from privado.fechas_libres_de_materia('PRB-16X', 0, '2026-10-05 12:00-05')) = 2
  and (select count(*) from privado.fechas_libres_de_materia('PRB-16X', -5, '2026-10-05 12:00-05')) = 2
  and (select count(*) from privado.fechas_libres_de_materia('PRB-16X', null, '2026-10-05 12:00-05')) = 2,
  'Cero, negativo o nulo cuentan como 1 semana');
select is(
  (select max(fecha) from privado.fechas_libres_de_materia('PRB-16X', 100, '2026-10-05 12:00-05')),
  '2026-12-24'::date, 'El horizonte no pasa de 12 semanas (hasta el 27 de diciembre), aunque se pida más');

-- ---------------------------------------------------------------------------
-- Qué sale y qué no
-- ---------------------------------------------------------------------------
select is(
  (select array_agg(k order by k) from (
     select jsonb_object_keys(to_jsonb(f)) as k
     from (select * from privado.fechas_libres_de_materia('PRB-16X', 4, '2026-10-05 12:00-05') limit 1) f) claves),
  array['duracion_min', 'fecha', 'hora', 'id_franja', 'id_monitor', 'nombre_monitor', 'precio', 'presencial'],
  'Cada fila trae solo lo público: monitor, franja, fecha, hora, duración, modalidad y precio');
select ok(
  not exists (
    select 1 from privado.fechas_libres_de_materia('PRB-16X', 12, '2026-10-05 12:00-05') f
    where to_jsonb(f)::text ilike any (array['%3001601601%', '%ana.secreta%', '%llave-secreta%', '%salón secreto%', '%sala-secreta%'])),
  'Ni el teléfono, el correo o la llave del monitor, ni el lugar o el enlace de la franja');

-- ---------------------------------------------------------------------------
-- Cambios: cierre de una franja y monitor desactivado
-- ---------------------------------------------------------------------------
update public.franja set cerrada_desde = '2026-10-19' where id = '30000000-0000-0000-0000-0000000016a1';
select results_eq(
  $$select fecha from privado.fechas_libres_de_materia('PRB-16X', 4, '2026-10-05 12:00-05')
    where id_franja = '30000000-0000-0000-0000-0000000016a1'$$,
  $$values ('2026-10-12'::date)$$,
  'Cerrada desde el 19 de octubre, la franja da el 12 y ya no el 19 ni después');

select is(
  (select count(*)::int from privado.fechas_libres_de_materia('PRB-16X', 4, '2026-10-05 12:00-05')
   where id_monitor = 'b0000000-0000-0000-0000-0000000016e0'),
  0, 'Un monitor con la cuenta suspendida no aparece');
update auth.users set banned_until = '2026-01-01' where id = 'b0000000-0000-0000-0000-0000000016e0';
select is(
  (select count(*)::int from privado.fechas_libres_de_materia('PRB-16X', 4, '2026-10-05 12:00-05')
   where id_monitor = 'b0000000-0000-0000-0000-0000000016e0'),
  3, 'Con la suspensión ya vencida, vuelve con sus fechas');

-- ---------------------------------------------------------------------------
-- La puerta pública, con la hora real: todos los roles ven lo mismo
-- ---------------------------------------------------------------------------
create temporary table esperado as
select id_franja, fecha from privado.fechas_libres_de_materia('PRB-16X', 4, now());
grant select on esperado to anon, authenticated;
select ok((select count(*) from esperado) > 0, 'Con la hora real también hay fechas libres para comparar');

set local role anon;
select set_eq(
  $$select id_franja, fecha from public.fechas_libres_de_materia('PRB-16X', 4)$$,
  $$select id_franja, fecha from esperado$$,
  'Sin sesión (la primera página del visitante) se ven las fechas libres');

set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001601","role":"authenticated","is_anonymous":true}';
select set_eq(
  $$select id_franja, fecha from public.fechas_libres_de_materia('PRB-16X', 4)$$,
  $$select id_franja, fecha from esperado$$,
  'Con la sesión anónima, lo mismo');
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000016b0","role":"authenticated"}';
select set_eq(
  $$select id_franja, fecha from public.fechas_libres_de_materia('PRB-16X', 4)$$,
  $$select id_franja, fecha from esperado$$,
  'Un monitor ve lo mismo');
reset role;

select * from finish();
rollback;
