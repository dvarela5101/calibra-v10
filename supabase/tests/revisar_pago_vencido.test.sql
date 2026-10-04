-- Pruebas pgTAP de revisar un pago que el admin asignado no revisó a tiempo (HU-077, D-38, D-39).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.
--
-- La hora del asignado se prueba con privado.revisar_pago y su p_ahora, como postgres y con el token del admin puesto
-- (auth.uid() lo lee sin importar el rol), como en revisar_pago.test.sql. La puerta pública usa now(), que dentro de la
-- transacción no cambia: sus pagos se insertan asignados ahora mismo o hace dos horas.
-- Lo que no cabe en una sola transacción lo cubre la prueba de integración: dos admins que revisan a la vez
-- (criterio 4) y la segunda mirada de quién puede revisar, con la fila ya bloqueada, cuando una reasignación llega en
-- medio.
--
-- Elenco (ids terminados en 77NN; la materia es 'PGTAP-77'):
--   Admins: A (el asignado), B (otro admin activo), C (desactivado) y D (activo, recibe una reasignación).
--   Monitor M, con una franja de los lunes 10:00. Lead 01 con su sesión anónima.
--   Monitorías del Lead 01, de la franja de M en lunes de 2030, y un pago en revisión de cada una (pago NN de la
--   monitoría NN), todos asignados a A el 1-ene-2030 a las 08:00 en Bogotá (su hora vence a las 09:00), salvo que se
--   diga otra cosa:
--     01 confirmada (B aprueba)                    02 confirmada (B rechaza: se cancela la cita)
--     03 realizada (B rechaza, P-24)               04 confirmada; asignado el 28-ene a las 09:30, la cita empieza a
--                                                     las 10:00 y la hora de A vence a las 10:30 (B rechaza, P-24)
--     05 confirmada (A aprueba después de su hora)  06 confirmada (A rechaza dentro de su hora)
--     07 confirmada (nadie puede: C, y el texto)   08 grupal confirmada
--     09 confirmada, asignado ahora mismo (puerta)  10 confirmada, asignado hace dos horas (puerta)
--     11 confirmada, reasignado a D a las 12:00

begin;
create extension if not exists pgtap with schema extensions;

select plan(42);

-- ---------------------------------------------------------------------------
-- Estructura y permisos
-- ---------------------------------------------------------------------------
select col_type_is('public', 'pago', 'id_admin_revisor', 'uuid',
  'Criterio 3: pago.id_admin_revisor guarda qué admin revisó el pago');
select col_is_null('public', 'pago', 'id_admin_revisor',
  'Puede ser nula: el pago en revisión todavía no tiene revisor');
select fk_ok('public', 'pago', 'id_admin_revisor', 'public', 'admin', 'id',
  'Apunta a un admin');
select has_index('public', 'pago', 'pago_id_admin_revisor_idx', 'id_admin_revisor',
  'Tiene su índice, como cada llave foránea del esquema');
select ok(
  has_column_privilege('authenticated', 'public.pago', 'id_admin_revisor', 'select')
  and not has_column_privilege('authenticated', 'public.pago', 'id_admin_revisor', 'insert')
  and not has_column_privilege('authenticated', 'public.pago', 'id_admin_revisor', 'update')
  and not has_column_privilege('anon', 'public.pago', 'id_admin_revisor', 'select'),
  'La sesión la lee (la RLS de pago deja solo a los admins) y no la escribe: la escribe la función');
select ok(
  has_function_privilege('authenticated', 'public.revisar_pago(uuid, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'privado.revisar_pago(uuid, text, text, timestamptz)', 'execute')
  and not has_function_privilege('anon', 'privado.revisar_pago(uuid, text, text, timestamptz)', 'execute')
  and not has_function_privilege('service_role', 'privado.revisar_pago(uuid, text, text, timestamptz)', 'execute')
  and (select prosecdef and 'search_path=""' = any(proconfig) from pg_proc
       where oid = 'privado.revisar_pago(uuid, text, text, timestamptz)'::regprocedure),
  'Redefinida, sigue igual: security definer con search_path vacío, y la versión que recibe la hora sigue interna');

-- ---------------------------------------------------------------------------
-- Fixtures (como postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, is_anonymous, banned_until) values
  ('a0000000-0000-0000-0000-0000000077a0', false, null),
  ('a0000000-0000-0000-0000-0000000077b0', false, null),
  ('a0000000-0000-0000-0000-0000000077c0', false, now() + interval '100 years'),
  ('a0000000-0000-0000-0000-0000000077d0', false, null),
  ('b0000000-0000-0000-0000-000000007701', false, null),
  ('c0000000-0000-0000-0000-000000007701', true, null);

insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-0000000077a0', 'Admin A', 'admin-a-hu077@calibra.test', 9007701),
  ('a0000000-0000-0000-0000-0000000077b0', 'Admin B', 'admin-b-hu077@calibra.test', 9007702),
  ('a0000000-0000-0000-0000-0000000077c0', 'Admin C', 'admin-c-hu077@calibra.test', 9007703),
  ('a0000000-0000-0000-0000-0000000077d0', 'Admin D', 'admin-d-hu077@calibra.test', 9007704);
insert into public.monitor (id, nombre) values ('b0000000-0000-0000-0000-000000007701', 'Monitor M');
insert into public.materia (id, nombre, codigo) values ('10000000-0000-0000-0000-000000007701', 'Materia HU-077', 'PGTAP-77');
insert into public.certificado (id_monitor, id_materia, id_admin) values
  ('b0000000-0000-0000-0000-000000007701', '10000000-0000-0000-0000-000000007701', 'a0000000-0000-0000-0000-0000000077a0');
insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min) values
  ('30000000-0000-0000-0000-000000007701', 'b0000000-0000-0000-0000-000000007701', 1, '10:00', true, 25000, 60);
insert into public.lead (id, id_sesion_anonima, nombre, correo, acepta_tratamiento_datos, fecha_consentimiento) values
  ('40000000-0000-0000-0000-000000007701', 'c0000000-0000-0000-0000-000000007701', 'Lead Uno', 'lead-01-hu077@calibra.test', true, now());

insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado, fecha_finalizacion)
select ('50000000-0000-0000-0000-0000000077' || v.nn)::uuid, '30000000-0000-0000-0000-000000007701',
       '10000000-0000-0000-0000-000000007701', '40000000-0000-0000-0000-000000007701', v.fecha, 25000,
       v.estado, v.finalizada
from (values
  ('01', date '2030-01-07', 'confirmada'::public.estado_monitoria, null::timestamptz),
  ('02', date '2030-01-14', 'confirmada', null),
  ('03', date '2030-01-21', 'realizada', timestamptz '2030-01-21 11:00-05'),
  ('04', date '2030-01-28', 'confirmada', null),
  ('05', date '2030-02-04', 'confirmada', null),
  ('06', date '2030-02-11', 'confirmada', null),
  ('07', date '2030-02-18', 'confirmada', null),
  ('08', date '2030-02-25', 'confirmada', null),
  ('09', date '2030-03-04', 'confirmada', null),
  ('10', date '2030-03-11', 'confirmada', null),
  ('11', date '2030-03-18', 'confirmada', null)
) as v(nn, fecha, estado, finalizada);
insert into public.monitoria_grupal (id_monitoria, cupos, modalidad_pago, precio_por_persona) values
  ('50000000-0000-0000-0000-000000007708', 3, 'dividido', 15000);

-- Un pago solo puede apuntar a un comprobante que el servidor revisó (HU-059). No hace falta el archivo.
insert into public.comprobante_revisado (ruta, tipo)
select 'c0000000-0000-0000-0000-000000007701/e7700000-0000-0000-0000-0000000000' || n || '.png', 'image/png'
from (values ('01'), ('02'), ('03'), ('04'), ('05'), ('06'), ('07'), ('08'), ('09'), ('10'), ('11')) as v(n);

insert into public.pago (id, id_monitoria, monto, nombre_pagador, contacto, id_admin, fecha_asignacion, comprobante)
select ('60000000-0000-0000-0000-0000000077' || v.nn)::uuid, ('50000000-0000-0000-0000-0000000077' || v.nn)::uuid,
       25000, 'Pagador ' || v.nn, 'pagador-' || v.nn || '-hu077@calibra.test',
       'a0000000-0000-0000-0000-0000000077a0', v.asignado,
       'c0000000-0000-0000-0000-000000007701/e7700000-0000-0000-0000-0000000000' || v.nn || '.png'
from (values
  ('01', timestamptz '2030-01-01 08:00-05'), ('02', timestamptz '2030-01-01 08:00-05'),
  ('03', timestamptz '2030-01-01 08:00-05'), ('04', timestamptz '2030-01-28 09:30-05'),
  ('05', timestamptz '2030-01-01 08:00-05'), ('06', timestamptz '2030-01-01 08:00-05'),
  ('07', timestamptz '2030-01-01 08:00-05'), ('08', timestamptz '2030-01-01 08:00-05'),
  ('09', now()), ('10', now() - interval '2 hours'),
  ('11', timestamptz '2030-01-01 08:00-05')
) as v(nn, asignado);

select ok(
  (select count(*) = 11 and bool_and(estado = 'en_revision' and id_admin_revisor is null)
   from public.pago where id::text like '60000000-0000-0000-0000-0000000077%')
  and public.revision_hasta(timestamptz '2030-01-01 08:00-05') = timestamptz '2030-01-01 09:00-05'
  and (select public.inicio_sesion(m.fecha, f.hora) = timestamptz '2030-01-28 10:00-05'
       from public.monitoria m join public.franja f on f.id = m.id_franja
       where m.id = '50000000-0000-0000-0000-000000007704')
  and (select banned_until > now() from auth.users where id = 'a0000000-0000-0000-0000-0000000077c0'),
  'Control: los 11 pagos están en revisión y sin revisor, la hora de A vence a las 09:00, la 04 empieza a las 10:00 y C está desactivado');

-- ---------------------------------------------------------------------------
-- Dentro de la hora de A, el pago es solo suyo (criterio 2, supuesto 1)
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000077b0","role":"authenticated"}';
select is(
  array[
    (select resultado from privado.revisar_pago('60000000-0000-0000-0000-000000007701', 'aprobar', null,
       timestamptz '2030-01-01 08:30-05')),
    (select resultado from privado.revisar_pago('60000000-0000-0000-0000-000000007701', 'rechazar', 'Nota',
       timestamptz '2030-01-01 08:30-05'))],
  array['no_asignado', 'no_asignado'],
  'Criterio 2: a mitad de la hora de A, B no lo aprueba ni lo rechaza: no_asignado');
select is(
  array[
    (select resultado from privado.revisar_pago('60000000-0000-0000-0000-000000007701', 'aprobar', null,
       timestamptz '2030-01-01 09:00-05')),
    (select resultado from privado.revisar_pago('60000000-0000-0000-0000-000000007701', 'rechazar', 'Nota',
       timestamptz '2030-01-01 09:00-05'))],
  array['no_asignado', 'no_asignado'],
  'Supuesto 1, P-40: justo en revision_hasta (09:00) todavía es solo de A: no_asignado');
select is(
  (select resultado from privado.revisar_pago('60000000-0000-0000-0000-000000007701', 'aprobar', null, null)),
  'no_asignado', 'Sin hora (p_ahora nulo) la de A no se da por pasada: no_asignado');
select results_eq(
  $$select p.estado::text, p.fecha_revision, p.id_admin, p.id_admin_revisor, m.estado::text
    from public.pago p join public.monitoria m on m.id = p.id_monitoria
    where p.id = '60000000-0000-0000-0000-000000007701'$$,
  $$values ('en_revision'::text, null::timestamptz, 'a0000000-0000-0000-0000-0000000077a0'::uuid, null::uuid,
            'confirmada'::text)$$,
  'Ninguno de esos intentos tocó el pago ni la monitoría');

-- ---------------------------------------------------------------------------
-- Pasada la hora de A, B lo aprueba (criterios 1 y 3, supuesto 4)
-- ---------------------------------------------------------------------------
select results_eq(
  $$select resultado, cancelo_monitoria from privado.revisar_pago('60000000-0000-0000-0000-000000007701', 'aprobar',
      null, timestamptz '2030-01-01 09:00:00.000001-05')$$,
  $$values ('aprobado'::text, false)$$,
  'Criterio 1: un microsegundo después de la hora de A, B lo aprueba: aprobado');
select results_eq(
  $$select p.estado::text, p.fecha_revision, p.id_admin, p.id_admin_revisor, m.estado::text
    from public.pago p join public.monitoria m on m.id = p.id_monitoria
    where p.id = '60000000-0000-0000-0000-000000007701'$$,
  $$values ('aprobado'::text, timestamptz '2030-01-01 09:00:00.000001-05', 'a0000000-0000-0000-0000-0000000077a0'::uuid,
            'a0000000-0000-0000-0000-0000000077b0'::uuid, 'confirmada'::text)$$,
  'Criterio 3: queda B como revisor y A como asignado (supuesto 4: revisarlo no lo reasigna); la cita sigue confirmada');

set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000077a0","role":"authenticated"}';
select is(
  array[
    (select resultado from privado.revisar_pago('60000000-0000-0000-0000-000000007701', 'aprobar', null,
       timestamptz '2030-01-01 09:30-05')),
    (select resultado from privado.revisar_pago('60000000-0000-0000-0000-000000007701', 'rechazar', 'Era falso',
       timestamptz '2030-01-01 09:30-05'))],
  array['ya_revisado', 'ya_revisado'],
  '§5.2: lo que revisó B ya no lo revisa ni el asignado: ya_revisado');
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000077b0","role":"authenticated"}';
select is(
  (select resultado from privado.revisar_pago('60000000-0000-0000-0000-000000007701', 'rechazar', 'Era falso',
     timestamptz '2030-01-01 10:00-05')),
  'ya_revisado', 'Ni B otra vez: ya_revisado');
select results_eq(
  $$select estado::text, fecha_revision, id_admin_revisor from public.pago where id = '60000000-0000-0000-0000-000000007701'$$,
  $$values ('aprobado'::text, timestamptz '2030-01-01 09:00:00.000001-05', 'a0000000-0000-0000-0000-0000000077b0'::uuid)$$,
  'Y la fecha de revisión y el revisor siguen siendo los de la primera revisión');

-- ---------------------------------------------------------------------------
-- B rechaza con las mismas reglas que el asignado (criterio 1)
-- ---------------------------------------------------------------------------
select results_eq(
  $$select resultado, cancelo_monitoria from privado.revisar_pago('60000000-0000-0000-0000-000000007702', 'rechazar',
      null, timestamptz '2030-01-01 09:00:00.000001-05')$$,
  $$values ('rechazado'::text, true)$$,
  'Pasada la hora de A, B rechaza el pago de una cita futura sin observaciones: rechazado y canceló la monitoría');
select results_eq(
  $$select p.estado::text, p.fecha_revision, p.observaciones, p.id_admin, p.id_admin_revisor, m.estado::text,
           m.motivo_cancelacion::text
    from public.pago p join public.monitoria m on m.id = p.id_monitoria
    where p.id = '60000000-0000-0000-0000-000000007702'$$,
  $$values ('rechazado'::text, timestamptz '2030-01-01 09:00:00.000001-05', null::text,
            'a0000000-0000-0000-0000-0000000077a0'::uuid, 'a0000000-0000-0000-0000-0000000077b0'::uuid,
            'cancelada'::text, 'pago_rechazado'::text)$$,
  'RN-43: la cita queda cancelada por pago_rechazado; el pago, rechazado por B y todavía asignado a A');

select is(
  (select resultado from privado.revisar_pago('60000000-0000-0000-0000-000000007703', 'rechazar', '  ',
     timestamptz '2030-01-01 10:00-05')),
  'observaciones_requeridas', 'P-24: B rechaza el pago de una realizada sin decir qué se hará con el cobro: observaciones_requeridas');
select results_eq(
  $$select resultado, cancelo_monitoria from privado.revisar_pago('60000000-0000-0000-0000-000000007703', 'rechazar',
      ' Se cobra por fuera. ', timestamptz '2030-01-01 10:00-05')$$,
  $$values ('rechazado'::text, false)$$,
  'Con observaciones: rechazado, sin cancelar la monitoría');
select results_eq(
  $$select p.estado::text, p.observaciones, p.id_admin, p.id_admin_revisor, m.estado::text
    from public.pago p join public.monitoria m on m.id = p.id_monitoria
    where p.id = '60000000-0000-0000-0000-000000007703'$$,
  $$values ('rechazado'::text, 'Se cobra por fuera.'::text, 'a0000000-0000-0000-0000-0000000077a0'::uuid,
            'a0000000-0000-0000-0000-0000000077b0'::uuid, 'realizada'::text)$$,
  'El caso queda registrado y recortado, con B como revisor, y la monitoría sigue realizada');

-- La 04: la cita empieza a las 10:00 y la hora de A vence a las 10:30.
select is(
  array[
    (select resultado from privado.revisar_pago('60000000-0000-0000-0000-000000007704', 'rechazar', 'Lo asume Calibra.',
       timestamptz '2030-01-28 10:30-05')),
    (select resultado from privado.revisar_pago('60000000-0000-0000-0000-000000007704', 'rechazar', null,
       timestamptz '2030-01-28 10:30:00.000001-05'))],
  array['no_asignado', 'observaciones_requeridas'],
  'P-24 con la hora: en el borde de A, B no puede; un microsegundo después sí, y como la sesión ya empezó pide observaciones');
select results_eq(
  $$select resultado, cancelo_monitoria from privado.revisar_pago('60000000-0000-0000-0000-000000007704', 'rechazar',
      'Lo asume Calibra.', timestamptz '2030-01-28 10:30:00.000001-05')$$,
  $$values ('rechazado'::text, false)$$,
  'Con observaciones: rechazado, sin cancelar la cita que ya empezó');
select results_eq(
  $$select p.estado::text, p.id_admin, p.id_admin_revisor, m.estado::text, m.motivo_cancelacion::text
    from public.pago p join public.monitoria m on m.id = p.id_monitoria
    where p.id = '60000000-0000-0000-0000-000000007704'$$,
  $$values ('rechazado'::text, 'a0000000-0000-0000-0000-0000000077a0'::uuid, 'a0000000-0000-0000-0000-0000000077b0'::uuid,
            'confirmada'::text, null::text)$$,
  'El pago queda rechazado por B y la monitoría sigue confirmada');

-- ---------------------------------------------------------------------------
-- El asignado revisa dentro y fuera de su hora (supuesto 5)
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000077a0","role":"authenticated"}';
select results_eq(
  $$select resultado, cancelo_monitoria from privado.revisar_pago('60000000-0000-0000-0000-000000007705', 'aprobar',
      null, timestamptz '2030-01-01 11:00-05')$$,
  $$values ('aprobado'::text, false)$$,
  'Supuesto 5: dos horas después de vencer la suya, A todavía aprueba su pago: aprobado');
select results_eq(
  $$select resultado, cancelo_monitoria from privado.revisar_pago('60000000-0000-0000-0000-000000007706', 'rechazar',
      null, timestamptz '2030-01-01 08:10-05')$$,
  $$values ('rechazado'::text, true)$$,
  'Dentro de su hora, A rechaza el suyo: rechazado y canceló la monitoría');
select results_eq(
  $$select id, id_admin, id_admin_revisor from public.pago
    where id in ('60000000-0000-0000-0000-000000007705', '60000000-0000-0000-0000-000000007706') order by id$$,
  $$values ('60000000-0000-0000-0000-000000007705'::uuid, 'a0000000-0000-0000-0000-0000000077a0'::uuid,
            'a0000000-0000-0000-0000-0000000077a0'::uuid),
           ('60000000-0000-0000-0000-000000007706', 'a0000000-0000-0000-0000-0000000077a0',
            'a0000000-0000-0000-0000-0000000077a0')$$,
  'Criterio 3: cuando revisa el asignado, él mismo queda como revisor, al aprobar y al rechazar');

-- ---------------------------------------------------------------------------
-- Quién no puede, aunque la hora haya pasado, y la nota de D-39
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000077c0","role":"authenticated"}';
select is(
  array[
    (select resultado from privado.revisar_pago('60000000-0000-0000-0000-000000007707', 'aprobar', null,
       timestamptz '2030-01-01 11:00-05')),
    (select resultado from privado.revisar_pago('60000000-0000-0000-0000-000000007707', 'rechazar', 'Nota',
       timestamptz '2030-01-01 11:00-05'))],
  array['sin_permiso', 'sin_permiso'],
  'RN-23: un admin desactivado no revisa aunque la hora de A ya haya pasado: sin_permiso');

set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000077b0","role":"authenticated"}';
select is(
  array[
    (select resultado from privado.revisar_pago('60000000-0000-0000-0000-000000007707', 'rechazar', repeat('a', 501),
       timestamptz '2030-01-01 08:30-05')),
    (select resultado from privado.revisar_pago('60000000-0000-0000-0000-000000007707', 'aprobar',
       ' ' || repeat('a', 501) || ' ', timestamptz '2030-01-01 09:00-05'))],
  array['no_asignado', 'no_asignado'],
  'D-39: si B todavía no puede revisarlo, el texto de más de 500 caracteres no cambia la respuesta: no_asignado');
select is(
  (select resultado from privado.revisar_pago('60000000-0000-0000-0000-000000007707', 'rechazar', repeat('a', 501),
     timestamptz '2030-01-01 09:00:00.000001-05')),
  'observaciones_invalidas', 'Cuando ya puede, a B sí se le valida el texto: observaciones_invalidas');
select is(
  (select resultado from privado.revisar_pago('60000000-0000-0000-0000-0000000077ff', 'rechazar', repeat('a', 501),
     timestamptz '2030-01-01 09:00:00.000001-05')),
  'no_encontrado', 'Un pago que no existe responde no_encontrado aunque el texto pase de 500 caracteres');
select is(
  (select resultado from privado.revisar_pago('60000000-0000-0000-0000-000000007708', 'aprobar', null,
     timestamptz '2030-01-01 09:00:00.000001-05')),
  'no_individual', 'El pago de una grupal tampoco lo revisa B por aquí (HU-038): no_individual');
select results_eq(
  $$select p.id, p.estado::text, p.id_admin_revisor, m.estado::text
    from public.pago p join public.monitoria m on m.id = p.id_monitoria
    where p.id in ('60000000-0000-0000-0000-000000007707', '60000000-0000-0000-0000-000000007708') order by p.id$$,
  $$values ('60000000-0000-0000-0000-000000007707'::uuid, 'en_revision'::text, null::uuid, 'confirmada'::text),
           ('60000000-0000-0000-0000-000000007708', 'en_revision', null, 'confirmada')$$,
  'Ninguno de esos intentos tocó los pagos ni las monitorías');

-- ---------------------------------------------------------------------------
-- Reasignado con una hora nueva (HU-074, HU-034)
-- ---------------------------------------------------------------------------
-- Como lo haría privado.reasignar_casos_de_admin, pero a una hora fija: pasa a D a las 12:00.
update public.pago set id_admin = 'a0000000-0000-0000-0000-0000000077d0', fecha_asignacion = timestamptz '2030-01-01 12:00-05'
where id = '60000000-0000-0000-0000-000000007711';
select is(
  array[
    (select resultado from privado.revisar_pago('60000000-0000-0000-0000-000000007711', 'aprobar', null,
       timestamptz '2030-01-01 12:30-05')),
    (select resultado from privado.revisar_pago('60000000-0000-0000-0000-000000007711', 'aprobar', null,
       timestamptz '2030-01-01 13:00-05'))],
  array['no_asignado', 'no_asignado'],
  'Cuenta la hora de la asignación vigente: aunque la de A venció a las 09:00, el pago es solo de D hasta las 13:00');
select results_eq(
  $$select resultado, cancelo_monitoria from privado.revisar_pago('60000000-0000-0000-0000-000000007711', 'aprobar',
      null, timestamptz '2030-01-01 13:00:00.000001-05')$$,
  $$values ('aprobado'::text, false)$$,
  'Un microsegundo después de la hora de D, B lo aprueba: aprobado');
select results_eq(
  $$select id_admin, id_admin_revisor from public.pago where id = '60000000-0000-0000-0000-000000007711'$$,
  $$values ('a0000000-0000-0000-0000-0000000077d0'::uuid, 'a0000000-0000-0000-0000-0000000077b0'::uuid)$$,
  'Queda D como asignado y B como revisor');

-- ---------------------------------------------------------------------------
-- Por la puerta pública, con la hora de la base
-- ---------------------------------------------------------------------------
set local role authenticated;
select is(
  array[
    (select resultado from public.revisar_pago('60000000-0000-0000-0000-000000007709', 'aprobar', null)),
    (select resultado from public.revisar_pago('60000000-0000-0000-0000-000000007709', 'rechazar', 'Nota'))],
  array['no_asignado', 'no_asignado'],
  'Por la puerta: el pago asignado a A ahora mismo no lo revisa B: no_asignado');
select results_eq(
  $$select resultado, cancelo_monitoria from public.revisar_pago('60000000-0000-0000-0000-000000007710', 'aprobar', null)$$,
  $$values ('aprobado'::text, false)$$,
  'Por la puerta: el asignado a A hace dos horas lo aprueba B: aprobado');
select is(
  (select id_admin_revisor from public.pago where id = '60000000-0000-0000-0000-000000007710'),
  'a0000000-0000-0000-0000-0000000077b0'::uuid,
  'B lee con su sesión quién revisó el pago');
reset role;
select results_eq(
  $$select id, estado::text, fecha_revision, id_admin, id_admin_revisor from public.pago
    where id in ('60000000-0000-0000-0000-000000007709', '60000000-0000-0000-0000-000000007710') order by id$$,
  $$values ('60000000-0000-0000-0000-000000007709'::uuid, 'en_revision'::text, null::timestamptz,
            'a0000000-0000-0000-0000-0000000077a0'::uuid, null::uuid),
           ('60000000-0000-0000-0000-000000007710', 'aprobado', now(), 'a0000000-0000-0000-0000-0000000077a0',
            'a0000000-0000-0000-0000-0000000077b0')$$,
  'El de ahora sigue en revisión y sin revisor; el vencido queda aprobado con la hora de la base, asignado a A y revisado por B');

-- ---------------------------------------------------------------------------
-- La sesión no se pone de revisora por fuera de la función
-- ---------------------------------------------------------------------------
set local role authenticated;
select throws_ok(
  $$update public.pago set id_admin_revisor = 'a0000000-0000-0000-0000-0000000077b0'
    where id = '60000000-0000-0000-0000-000000007707'$$,
  '42501', null,
  'Ni un admin con sesión escribe id_admin_revisor directo en la Data API: permiso denegado');
reset role;

select is(
  (select count(*)::int from public.reembolso where id_pago::text like '60000000-0000-0000-0000-0000000077%')
  + (select count(*)::int from public.desembolso where id_monitoria::text like '50000000-0000-0000-0000-0000000077%'),
  0, 'Revisar el pago de otro tampoco crea reembolsos ni desembolsos (RN-43, RN-45)');

select * from finish();
rollback;
