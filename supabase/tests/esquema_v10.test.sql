-- Pruebas pgTAP del esquema v10 y sus políticas de acceso (HU-002).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.

begin;
create extension if not exists pgtap with schema extensions;

select plan(97);

-- ---------------------------------------------------------------------------
-- 1. Estructura: tablas y enums (criterio 1)
-- ---------------------------------------------------------------------------
select has_table('public', t, 'Existe la tabla ' || t)
from unnest(array[
  'lead', 'estudiante', 'monitor', 'monitor_privado', 'perfil_monitor', 'admin',
  'materia', 'evaluacion', 'diagnostico', 'certificado', 'franja', 'monitoria',
  'monitoria_grupal', 'pago', 'desembolso', 'reembolso', 'reporte_inasistencia', 'resena'
]) as t;

select enum_has_labels('public', 'estado_monitoria',
  array['pendiente_pago', 'confirmada', 'realizada', 'cancelada'],
  'Enum estado_monitoria con sus valores exactos');
select enum_has_labels('public', 'estado_pago',
  array['en_revision', 'aprobado', 'rechazado'],
  'Enum estado_pago con sus valores exactos');
select enum_has_labels('public', 'estado_reembolso',
  array['esperando_llave', 'pendiente', 'reembolsado'],
  'Enum estado_reembolso con sus valores exactos');
select enum_has_labels('public', 'estado_desembolso',
  array['pendiente', 'desembolsado', 'anulado'],
  'Enum estado_desembolso con sus valores exactos');
select enum_has_labels('public', 'estado_reporte',
  array['en_revision', 'aceptado', 'rechazado'],
  'Enum estado_reporte con sus valores exactos');
select enum_has_labels('public', 'estado_lead',
  array['nuevo', 'contactado', 'descartado'],
  'Enum estado_lead con sus valores exactos');
select enum_has_labels('public', 'motivo_cancelacion',
  array['reserva_expirada', 'pago_rechazado', 'estudiante', 'monitor_no_asistio', 'diferencia_no_cubierta'],
  'Enum motivo_cancelacion con sus valores exactos');
select enum_has_labels('public', 'modalidad_pago',
  array['unico', 'dividido'],
  'Enum modalidad_pago con sus valores exactos');

select is(
  (select count(*)::int
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and not c.relrowsecurity
     and c.relname = any (array[
       'lead', 'estudiante', 'monitor', 'monitor_privado', 'perfil_monitor', 'admin',
       'materia', 'evaluacion', 'diagnostico', 'certificado', 'franja', 'monitoria',
       'monitoria_grupal', 'pago', 'desembolso', 'reembolso', 'reporte_inasistencia', 'resena'
     ])),
  0,
  'RLS activa en las 18 tablas del modelo');

-- ---------------------------------------------------------------------------
-- Fixtures (como postgres, antes de cambiar de rol)
--   admin           a0000000-...-01
--   monitores       b0000000-...-01 y -02
--   sesiones anon.  c0000000-...-0a (A) y -0b (B)
--   estudiante      d0000000-...-01 (id -02 queda libre para pruebas)
-- ---------------------------------------------------------------------------
insert into auth.users (id, is_anonymous) values
  ('a0000000-0000-0000-0000-000000000001', false),
  ('b0000000-0000-0000-0000-000000000001', false),
  ('b0000000-0000-0000-0000-000000000002', false),
  ('c0000000-0000-0000-0000-00000000000a', true),
  ('c0000000-0000-0000-0000-00000000000b', true),
  ('d0000000-0000-0000-0000-000000000001', false),
  ('d0000000-0000-0000-0000-000000000002', false);

insert into public.materia (id, nombre, codigo) values
  ('10000000-0000-0000-0000-000000000001', 'Materia uno', 'PRB-1'),
  ('10000000-0000-0000-0000-000000000002', 'Materia dos', 'PRB-2');

insert into public.evaluacion (id, id_materia, semana, nombre) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 3, 'Parcial uno'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 3, 'Parcial dos');

-- orden_revision es único y la semilla (supabase/seed.sql) usa 1 y 2: aquí, números altos.
insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-000000000001', 'Admin Prueba', 'admin@example.com', 9000001);

insert into public.monitor (id, nombre) values
  ('b0000000-0000-0000-0000-000000000001', 'Monitor Uno'),
  ('b0000000-0000-0000-0000-000000000002', 'Monitor Dos');

insert into public.monitor_privado (id_monitor, numero_telefono, correo, llave) values
  ('b0000000-0000-0000-0000-000000000001', '3000000001', 'm1@example.com', 'llave-m1'),
  ('b0000000-0000-0000-0000-000000000002', '3000000002', 'm2@example.com', 'llave-m2');

insert into public.perfil_monitor (id_monitor) values
  ('b0000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-000000000002');

-- Certificado del monitor 1 en la materia 1.
insert into public.certificado (id, id_monitor, id_materia, id_admin) values
  ('90000000-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000001');

-- Franja del monitor 1: lunes (ISO 1) a las 10:00.
insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min) values
  ('30000000-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-000000000001', 1, '10:00', true, 25000, 60);

insert into public.lead (id, id_sesion_anonima, nombre, correo, acepta_tratamiento_datos, fecha_consentimiento) values
  ('40000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000a',
   'Lead A', 'a@example.com', true, now()),
  ('40000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-00000000000b',
   'Lead B', 'b@example.com', true, now());

-- El estudiante es el Lead A que creó cuenta (RN-02).
insert into public.estudiante (id, id_lead) values
  ('d0000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-00000000000a');

-- Monitoría del Lead A el lunes 2026-10-05. id_monitor lo llena el trigger.
insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total) values
  ('50000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001',
   '40000000-0000-0000-0000-00000000000a',
   '2026-10-05', 25000);

insert into public.pago (id, id_monitoria, monto, nombre_pagador, contacto, id_admin, comprobante) values
  ('60000000-0000-0000-0000-000000000001',
   '50000000-0000-0000-0000-000000000001', 25000, 'Pagador Prueba', 'pagador@example.com',
   'a0000000-0000-0000-0000-000000000001', 'comprobante.png');

insert into public.desembolso (id_monitoria, monto_bruto, comision, monto_neto, llave_destino) values
  ('50000000-0000-0000-0000-000000000001', 25000, 2500, 22500, 'llave-m1');

insert into public.reembolso (id_pago, id_admin, monto, motivo) values
  ('60000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 25000, 'Prueba');

insert into public.reporte_inasistencia (id_monitoria, id_admin) values
  ('50000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001');

insert into public.resena (id_pago, calificacion) values
  ('60000000-0000-0000-0000-000000000001', 5);

-- Diagnóstico de A (ligado a la monitoría) y de B (solo sesión, sin Lead).
-- id_materia lo llena el trigger desde la evaluación.
insert into public.diagnostico
  (id, id_lead, id_sesion_anonima, id_evaluacion, id_monitoria, respuestas, puntaje, resultado_por_tema) values
  ('80000000-0000-0000-0000-00000000000a',
   '40000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000a',
   '20000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001',
   '{}', 50.00, '{}'),
  ('80000000-0000-0000-0000-00000000000b',
   null, 'c0000000-0000-0000-0000-00000000000b',
   '20000000-0000-0000-0000-000000000001', null,
   '{}', 70.00, '{}');

-- ---------------------------------------------------------------------------
-- 2. Triggers que completan las copias (id_monitor, id_materia)
-- ---------------------------------------------------------------------------
select is(
  (select id_monitor from public.monitoria where id = '50000000-0000-0000-0000-000000000001'),
  'b0000000-0000-0000-0000-000000000001'::uuid,
  'El trigger llena monitoria.id_monitor desde la franja');

select is(
  (select id_materia from public.diagnostico where id = '80000000-0000-0000-0000-00000000000a'),
  '10000000-0000-0000-0000-000000000001'::uuid,
  'El trigger llena diagnostico.id_materia desde la evaluación');

-- ---------------------------------------------------------------------------
-- 3. Unicidades y llaves compuestas
-- ---------------------------------------------------------------------------
select throws_ok(
  $$insert into public.certificado (id_monitor, id_materia, id_admin) values
    ('b0000000-0000-0000-0000-000000000001',
     '10000000-0000-0000-0000-000000000001',
     'a0000000-0000-0000-0000-000000000001')$$,
  '23505', null,
  'RN-21: segundo certificado del mismo monitor y materia se rechaza');

-- RN-33: la franja ya tiene una monitoría activa ese lunes.
select throws_ok(
  $$insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total) values
    ('50000000-0000-0000-0000-000000000002',
     '30000000-0000-0000-0000-000000000001',
     '10000000-0000-0000-0000-000000000001',
     '40000000-0000-0000-0000-00000000000b',
     '2026-10-05', 25000)$$,
  '23505', null,
  'RN-33: otra monitoría activa en la misma franja y fecha se rechaza');

-- Se cancela la primera y ya no bloquea la franja.
update public.monitoria
set estado = 'cancelada', motivo_cancelacion = 'estudiante'
where id = '50000000-0000-0000-0000-000000000001';

select lives_ok(
  $$insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total) values
    ('50000000-0000-0000-0000-000000000002',
     '30000000-0000-0000-0000-000000000001',
     '10000000-0000-0000-0000-000000000001',
     '40000000-0000-0000-0000-00000000000b',
     '2026-10-05', 25000)$$,
  'RN-33: si la anterior está cancelada, la misma franja y fecha se acepta');

-- Se restauran los fixtures para las pruebas siguientes.
delete from public.monitoria where id = '50000000-0000-0000-0000-000000000002';
update public.monitoria
set estado = 'pendiente_pago', motivo_cancelacion = null
where id = '50000000-0000-0000-0000-000000000001';

-- Sección 14: un solo registro hijo por padre.
select throws_ok(
  $$insert into public.resena (id_pago, calificacion) values
    ('60000000-0000-0000-0000-000000000001', 4)$$,
  '23505', null,
  'Sección 14: segunda reseña del mismo pago se rechaza');

select throws_ok(
  $$insert into public.reembolso (id_pago, id_admin, monto, motivo) values
    ('60000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 1000, 'Otro')$$,
  '23505', null,
  'Sección 14: segundo reembolso del mismo pago se rechaza');

select throws_ok(
  $$insert into public.desembolso (id_monitoria, monto_bruto, comision, monto_neto, llave_destino) values
    ('50000000-0000-0000-0000-000000000001', 100, 10, 90, 'otra-llave')$$,
  '23505', null,
  'Sección 14: segundo desembolso de la misma monitoría se rechaza');

select throws_ok(
  $$insert into public.reporte_inasistencia (id_monitoria, id_admin) values
    ('50000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001')$$,
  '23505', null,
  'Sección 14: segundo reporte de inasistencia de la misma monitoría se rechaza');

select throws_ok(
  $$insert into public.estudiante (id, id_lead) values
    ('d0000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-00000000000a')$$,
  '23505', null,
  'Sección 14: segundo estudiante del mismo lead se rechaza');

-- RN-22: el monitor 1 no tiene certificado en la materia 2.
select throws_ok(
  $$insert into public.monitoria (id_franja, id_materia, id_lead, fecha, valor_total) values
    ('30000000-0000-0000-0000-000000000001',
     '10000000-0000-0000-0000-000000000002',
     '40000000-0000-0000-0000-00000000000b',
     '2026-10-12', 25000)$$,
  '23503', null,
  'RN-22: monitoría en una materia sin certificado del monitor se rechaza');

-- RN-15: la evaluación del diagnóstico debe ser de la materia de la monitoría.
select throws_ok(
  $$insert into public.diagnostico (id_lead, id_evaluacion, id_monitoria, respuestas, puntaje, resultado_por_tema) values
    ('40000000-0000-0000-0000-00000000000a',
     '20000000-0000-0000-0000-000000000002',
     '50000000-0000-0000-0000-000000000001',
     '{}', 10.00, '{}')$$,
  '23503', null,
  'RN-15: diagnóstico ligado a una monitoría con evaluación de otra materia se rechaza');

select lives_ok(
  $$insert into public.diagnostico (id, id_lead, id_evaluacion, id_monitoria, respuestas, puntaje, resultado_por_tema) values
    ('80000000-0000-0000-0000-00000000000c',
     '40000000-0000-0000-0000-00000000000a',
     '20000000-0000-0000-0000-000000000001',
     '50000000-0000-0000-0000-000000000001',
     '{}', 10.00, '{}')$$,
  'RN-15: diagnóstico ligado a una monitoría con evaluación de la misma materia se acepta');

delete from public.diagnostico where id = '80000000-0000-0000-0000-00000000000c';

-- ---------------------------------------------------------------------------
-- 4. Restricciones de integridad (check)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$insert into public.lead (nombre, correo, acepta_tratamiento_datos, fecha_consentimiento) values
    ('Sin autorización', 'x@example.com', false, now())$$,
  '23514', null,
  'RN-13: lead sin autorización de tratamiento de datos se rechaza');

select throws_ok(
  $$insert into public.lead (nombre, acepta_tratamiento_datos, fecha_consentimiento) values
    ('Sin contacto', true, now())$$,
  '23514', null,
  'RN-11: lead sin correo ni teléfono se rechaza');

select throws_ok(
  $$insert into public.diagnostico (id_evaluacion, respuestas, puntaje, resultado_por_tema) values
    ('20000000-0000-0000-0000-000000000001', '{}', 10.00, '{}')$$,
  '23514', null,
  'P-33: diagnóstico sin lead ni sesión anónima se rechaza');

select throws_ok(
  $$insert into public.monitoria (id_franja, id_materia, id_lead, fecha, estado, valor_total) values
    ('30000000-0000-0000-0000-000000000001',
     '10000000-0000-0000-0000-000000000001',
     '40000000-0000-0000-0000-00000000000b',
     '2026-10-12', 'cancelada', 25000)$$,
  '23514', null,
  'Monitoría cancelada sin motivo de cancelación se rechaza');

-- 2026-10-06 es martes; la franja es de los lunes.
select throws_ok(
  $$insert into public.monitoria (id_franja, id_materia, id_lead, fecha, valor_total) values
    ('30000000-0000-0000-0000-000000000001',
     '10000000-0000-0000-0000-000000000001',
     '40000000-0000-0000-0000-00000000000b',
     '2026-10-06', 25000)$$,
  '23514', null,
  'RN-36: monitoría en una fecha que no cae en el día de la franja se rechaza');

-- ---------------------------------------------------------------------------
-- 5. RLS: rol anon
-- ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';

select throws_ok(
  'select 1 from public.' || t,
  '42501', null,
  'RLS: anon no tiene permiso para leer ' || t)
from unnest(array[
  'lead', 'pago', 'diagnostico', 'reembolso', 'desembolso', 'reporte_inasistencia',
  'monitor_privado', 'estudiante', 'monitoria', 'monitoria_grupal', 'resena', 'admin'
]) as t;

select is(
  (select count(*)::int from public.materia
   where id in ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002')),
  2, 'RLS: anon lee las materias');
select is(
  (select count(*)::int from public.evaluacion
   where id in ('20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002')),
  2, 'RLS: anon lee las evaluaciones');
select is(
  (select count(*)::int from public.franja where id = '30000000-0000-0000-0000-000000000001'),
  1, 'RLS: anon lee las franjas');
select is(
  (select count(*)::int from public.monitor
   where id in ('b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002')),
  2, 'RLS: anon lee los datos públicos del monitor');
select is(
  (select count(*)::int from public.perfil_monitor
   where id_monitor in ('b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002')),
  2, 'RLS: anon lee el perfil del monitor');
select is(
  (select count(*)::int from public.certificado where id = '90000000-0000-0000-0000-000000000001'),
  1, 'RLS: anon lee los certificados');

reset role;

-- ---------------------------------------------------------------------------
-- 6. RLS: sesión anónima B (authenticated con is_anonymous)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-00000000000b","role":"authenticated","is_anonymous":true}';

select is(
  (select count(*)::int from public.lead where id = '40000000-0000-0000-0000-00000000000a'),
  0, 'RLS: la sesión B no ve el lead de A');
select is(
  (select count(*)::int from public.lead),
  1, 'RLS: la sesión B solo ve su propio lead');
select is((select count(*)::int from public.pago), 0, 'RLS: la sesión B no ve pagos');
select is((select count(*)::int from public.desembolso), 0, 'RLS: la sesión B no ve desembolsos');
select is((select count(*)::int from public.reembolso), 0, 'RLS: la sesión B no ve reembolsos');
select is((select count(*)::int from public.reporte_inasistencia), 0, 'RLS: la sesión B no ve reportes de inasistencia');
select is((select count(*)::int from public.monitor_privado), 0, 'RLS: la sesión B no ve monitor_privado');
select is((select count(*)::int from public.monitoria), 0, 'RLS: la sesión B no ve monitorías ajenas');
select is((select count(*)::int from public.diagnostico), 1, 'RLS: la sesión B ve un solo diagnóstico');
select is(
  (select id from public.diagnostico),
  '80000000-0000-0000-0000-00000000000b'::uuid,
  'RLS: el único diagnóstico que ve la sesión B es el suyo');

reset role;

-- ---------------------------------------------------------------------------
-- 7. RLS: sesión anónima A
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-00000000000a","role":"authenticated","is_anonymous":true}';

select is(
  (select count(*)::int from public.lead where id = '40000000-0000-0000-0000-00000000000a'),
  1, 'RLS: la sesión A ve su lead');
select is(
  (select count(*)::int from public.lead),
  1, 'RLS: la sesión A no ve el lead de B');
select is(
  (select count(*)::int from public.monitoria where id = '50000000-0000-0000-0000-000000000001'),
  1, 'RLS: la sesión A ve su monitoría');
select is(
  (select id from public.diagnostico),
  '80000000-0000-0000-0000-00000000000a'::uuid,
  'RLS: la sesión A ve su diagnóstico y no el de B');
select is((select count(*)::int from public.pago), 0, 'RLS: la sesión A no ve pagos');

reset role;

-- ---------------------------------------------------------------------------
-- 8. RLS: estudiante (cuenta ligada al lead A)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"d0000000-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (select id from public.lead),
  '40000000-0000-0000-0000-00000000000a'::uuid,
  'RLS: el estudiante ve el lead del que salió y ningún otro');
select is(
  (select count(*)::int from public.estudiante),
  1, 'RLS: el estudiante ve su propia fila de estudiante');
select is(
  (select count(*)::int from public.monitoria where id = '50000000-0000-0000-0000-000000000001'),
  1, 'RLS: el estudiante ve la monitoría que agendó su lead');
select is(
  (select id from public.diagnostico),
  '80000000-0000-0000-0000-00000000000a'::uuid,
  'RLS: el estudiante ve el diagnóstico de su lead');
select is((select count(*)::int from public.pago), 0, 'RLS: el estudiante no ve pagos');

reset role;

-- ---------------------------------------------------------------------------
-- 9. RLS: monitor 1 y monitor 2
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (select count(*)::int from public.monitor_privado where id_monitor = 'b0000000-0000-0000-0000-000000000001'),
  1, 'RLS: el monitor 1 ve su fila de monitor_privado');
select is(
  (select count(*)::int from public.monitor_privado where id_monitor = 'b0000000-0000-0000-0000-000000000002'),
  0, 'RLS: el monitor 1 no ve la fila de monitor_privado del monitor 2');
select is(
  (select count(*)::int from public.monitoria where id = '50000000-0000-0000-0000-000000000001'),
  1, 'RLS: el monitor 1 ve la monitoría que dicta');
select is(
  (select id from public.diagnostico where id_monitoria = '50000000-0000-0000-0000-000000000001'),
  '80000000-0000-0000-0000-00000000000a'::uuid,
  'RLS: el monitor 1 ve el diagnóstico ligado a su monitoría');
select is((select count(*)::int from public.pago), 0, 'RLS: el monitor 1 no ve pagos');

reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-000000000002","role":"authenticated"}';

select is((select count(*)::int from public.monitoria), 0, 'RLS: el monitor 2 no ve monitorías de otro monitor');
select is((select count(*)::int from public.diagnostico), 0, 'RLS: el monitor 2 no ve diagnósticos de otro monitor');

reset role;

-- ---------------------------------------------------------------------------
-- 10. RLS: admin
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (select count(*)::int from public.lead
   where id in ('40000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000b')),
  2, 'RLS: el admin ve todos los leads');
select is(
  (select count(*)::int from public.pago where id = '60000000-0000-0000-0000-000000000001'),
  1, 'RLS: el admin ve los pagos');
select is(
  (select count(*)::int from public.monitor_privado
   where id_monitor in ('b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002')),
  2, 'RLS: el admin ve monitor_privado de todos los monitores');
select is(
  (select count(*)::int from public.desembolso where id_monitoria = '50000000-0000-0000-0000-000000000001'),
  1, 'RLS: el admin ve los desembolsos');
select is(
  (select count(*)::int from public.reembolso where id_pago = '60000000-0000-0000-0000-000000000001'),
  1, 'RLS: el admin ve los reembolsos');
select is(
  (select count(*)::int from public.reporte_inasistencia where id_monitoria = '50000000-0000-0000-0000-000000000001'),
  1, 'RLS: el admin ve los reportes de inasistencia');
select is(
  (select count(*)::int from public.diagnostico
   where id in ('80000000-0000-0000-0000-00000000000a', '80000000-0000-0000-0000-00000000000b')),
  2, 'RLS: el admin ve todos los diagnósticos');

reset role;

select * from finish();
rollback;
