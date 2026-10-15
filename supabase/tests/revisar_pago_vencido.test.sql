-- Pruebas pgTAP de revisar un pago que no es del admin que llama: cualquier admin activo lo revisa (HU-077, D-38; HU-034, D-56).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.
--
-- HU-034 (D-56) saca la hora del asignado: el responsable de un pago sigue siendo pago.id_admin, pero cualquier admin activo
-- lo aprueba o lo rechaza desde el primer segundo, y la base nunca responde no_asignado. Lo que queda de HU-077 es quién
-- revisó: pago.id_admin_revisor.
--
-- Se prueba con privado.revisar_pago y su p_ahora, como postgres y con el token del admin puesto (auth.uid() lo lee sin
-- importar el rol), como en revisar_pago.test.sql. El mismo resultado a los 0 segundos, a los 59 minutos y a 1 hora más
-- 1 microsegundo de la asignación dice que la hora no cuenta. La puerta pública usa now(), que dentro de la transacción no
-- cambia: sus pagos se insertan asignados ahora mismo o hace dos horas.
-- Lo que no cabe en una sola transacción lo cubre la prueba de integración: dos admins que revisan a la vez
-- (criterio 4) y la segunda mirada de quién puede revisar, con la fila ya bloqueada, cuando una reasignación o una
-- desactivación llega en medio.
--
-- Elenco (ids terminados en 77NN; la materia es 'PGTAP-77'):
--   Admins: A (el responsable), B (otro admin activo) y C (desactivado). Monitor M, con una franja de los lunes 10:00.
--   Lead 01 con su sesión anónima.
--   Monitorías del Lead 01, de la franja de M en lunes de 2030, todas confirmadas, y un pago en revisión de cada una
--   (pago NN de la monitoría NN), todos con A como responsable y asignados el 1-ene-2030 a las 08:00 en Bogotá, salvo que
--   se diga otra cosa:
--     01 B aprueba a los 0 segundos            02 B rechaza a los 0 segundos
--     03 B aprueba a los 59 minutos            04 B rechaza a los 59 minutos
--     05 B aprueba a 1 hora y 1 microsegundo   06 B rechaza a 1 hora y 1 microsegundo
--     07 nadie lo revisa (quien no puede, y el texto)
--     08 asignado ahora mismo (puerta, B aprueba)   09 asignado hace dos horas (puerta, B rechaza)

begin;
create extension if not exists pgtap with schema extensions;

select plan(27);

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
select ok(
  pg_get_functiondef('privado.revisar_pago(uuid, text, text, timestamptz)'::regprocedure)
    !~ 'no_asignado|fecha_asignacion|revision_hasta|dentro_de_plazo',
  'Criterio 1: privado.revisar_pago ya no responde no_asignado ni mira la asignación ni la hora de nadie');

-- ---------------------------------------------------------------------------
-- Fixtures (como postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, is_anonymous, banned_until) values
  ('a0000000-0000-0000-0000-0000000077a0', false, null),
  ('a0000000-0000-0000-0000-0000000077b0', false, null),
  ('a0000000-0000-0000-0000-0000000077c0', false, now() + interval '100 years'),
  ('b0000000-0000-0000-0000-000000007701', false, null),
  ('c0000000-0000-0000-0000-000000007701', true, null);

insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-0000000077a0', 'Admin A', 'admin-a-hu077@calibra.test', 9007701),
  ('a0000000-0000-0000-0000-0000000077b0', 'Admin B', 'admin-b-hu077@calibra.test', 9007702),
  ('a0000000-0000-0000-0000-0000000077c0', 'Admin C', 'admin-c-hu077@calibra.test', 9007703);
insert into public.monitor (id, nombre) values ('b0000000-0000-0000-0000-000000007701', 'Monitor M');
insert into public.materia (id, nombre, codigo) values ('10000000-0000-0000-0000-000000007701', 'Materia HU-077', 'PGTAP-77');
insert into public.certificado (id_monitor, id_materia, id_admin) values
  ('b0000000-0000-0000-0000-000000007701', '10000000-0000-0000-0000-000000007701', 'a0000000-0000-0000-0000-0000000077a0');
insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min) values
  ('30000000-0000-0000-0000-000000007701', 'b0000000-0000-0000-0000-000000007701', 1, '10:00', true, 25000, 60);
insert into public.lead (id, id_sesion_anonima, nombre, correo, acepta_tratamiento_datos, fecha_consentimiento) values
  ('40000000-0000-0000-0000-000000007701', 'c0000000-0000-0000-0000-000000007701', 'Lead Uno', 'lead-01-hu077@calibra.test', true, now());

insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado)
select ('50000000-0000-0000-0000-0000000077' || v.nn)::uuid, '30000000-0000-0000-0000-000000007701',
       '10000000-0000-0000-0000-000000007701', '40000000-0000-0000-0000-000000007701',
       date '2030-01-07' + (v.nn::int - 1) * 7, 25000, 'confirmada'
from (values ('01'), ('02'), ('03'), ('04'), ('05'), ('06'), ('07'), ('08'), ('09')) as v(nn);

-- Un pago solo puede apuntar a un comprobante que el servidor revisó (HU-059). No hace falta el archivo.
insert into public.comprobante_revisado (ruta, tipo)
select 'c0000000-0000-0000-0000-000000007701/e7700000-0000-0000-0000-0000000000' || n || '.png', 'image/png'
from (values ('01'), ('02'), ('03'), ('04'), ('05'), ('06'), ('07'), ('08'), ('09')) as v(n);

insert into public.pago (id, id_monitoria, monto, nombre_pagador, contacto, id_admin, fecha_asignacion, comprobante)
select ('60000000-0000-0000-0000-0000000077' || v.nn)::uuid, ('50000000-0000-0000-0000-0000000077' || v.nn)::uuid,
       25000, 'Pagador ' || v.nn, 'pagador-' || v.nn || '-hu077@calibra.test',
       'a0000000-0000-0000-0000-0000000077a0', v.asignado,
       'c0000000-0000-0000-0000-000000007701/e7700000-0000-0000-0000-0000000000' || v.nn || '.png'
from (values
  ('01', timestamptz '2030-01-01 08:00-05'), ('02', timestamptz '2030-01-01 08:00-05'),
  ('03', timestamptz '2030-01-01 08:00-05'), ('04', timestamptz '2030-01-01 08:00-05'),
  ('05', timestamptz '2030-01-01 08:00-05'), ('06', timestamptz '2030-01-01 08:00-05'),
  ('07', timestamptz '2030-01-01 08:00-05'),
  ('08', now()), ('09', now() - interval '2 hours')
) as v(nn, asignado);

select ok(
  (select count(*) = 9 and bool_and(estado = 'en_revision' and id_admin_revisor is null
                                    and id_admin = 'a0000000-0000-0000-0000-0000000077a0')
   from public.pago where id::text like '60000000-0000-0000-0000-0000000077%')
  and (select bool_and(fecha_asignacion = timestamptz '2030-01-01 08:00-05')
       from public.pago where id::text between '60000000-0000-0000-0000-000000007701' and '60000000-0000-0000-0000-000000007707')
  and (select banned_until > now() from auth.users where id = 'a0000000-0000-0000-0000-0000000077c0'),
  'Control: los 9 pagos están en revisión, sin revisor y con A como responsable; del 01 al 07 se asignaron a las 08:00 y C está desactivado');

-- ---------------------------------------------------------------------------
-- B, que no es el responsable, revisa a cualquier hora con el mismo resultado (criterio 1)
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000077b0","role":"authenticated"}';
select results_eq(
  $$select resultado, cancelo_monitoria from privado.revisar_pago('60000000-0000-0000-0000-000000007701', 'aprobar',
      null, timestamptz '2030-01-01 08:00-05')
    union all
    select resultado, cancelo_monitoria from privado.revisar_pago('60000000-0000-0000-0000-000000007702', 'rechazar',
      null, timestamptz '2030-01-01 08:00-05')$$,
  $$values ('aprobado'::text, false), ('rechazado', true)$$,
  'Criterio 1: a los 0 segundos de la asignación, B aprueba un pago y rechaza otro (cancela la cita futura)');
select results_eq(
  $$select resultado, cancelo_monitoria from privado.revisar_pago('60000000-0000-0000-0000-000000007703', 'aprobar',
      null, timestamptz '2030-01-01 08:59-05')
    union all
    select resultado, cancelo_monitoria from privado.revisar_pago('60000000-0000-0000-0000-000000007704', 'rechazar',
      null, timestamptz '2030-01-01 08:59-05')$$,
  $$values ('aprobado'::text, false), ('rechazado', true)$$,
  'A los 59 minutos, el mismo resultado: aprobado y rechazado');
select results_eq(
  $$select resultado, cancelo_monitoria from privado.revisar_pago('60000000-0000-0000-0000-000000007705', 'aprobar',
      null, timestamptz '2030-01-01 09:00:00.000001-05')
    union all
    select resultado, cancelo_monitoria from privado.revisar_pago('60000000-0000-0000-0000-000000007706', 'rechazar',
      null, timestamptz '2030-01-01 09:00:00.000001-05')$$,
  $$values ('aprobado'::text, false), ('rechazado', true)$$,
  'A 1 hora más 1 microsegundo, también el mismo resultado: la hora no cuenta');
select results_eq(
  $$select p.estado::text, p.fecha_revision, p.id_admin, p.id_admin_revisor, m.estado::text, m.motivo_cancelacion::text
    from public.pago p join public.monitoria m on m.id = p.id_monitoria
    where p.id between '60000000-0000-0000-0000-000000007701' and '60000000-0000-0000-0000-000000007706'
    order by p.id$$,
  $$values
    ('aprobado'::text, timestamptz '2030-01-01 08:00-05', 'a0000000-0000-0000-0000-0000000077a0'::uuid,
     'a0000000-0000-0000-0000-0000000077b0'::uuid, 'confirmada'::text, null::text),
    ('rechazado', timestamptz '2030-01-01 08:00-05', 'a0000000-0000-0000-0000-0000000077a0',
     'a0000000-0000-0000-0000-0000000077b0', 'cancelada', 'pago_rechazado'),
    ('aprobado', timestamptz '2030-01-01 08:59-05', 'a0000000-0000-0000-0000-0000000077a0',
     'a0000000-0000-0000-0000-0000000077b0', 'confirmada', null),
    ('rechazado', timestamptz '2030-01-01 08:59-05', 'a0000000-0000-0000-0000-0000000077a0',
     'a0000000-0000-0000-0000-0000000077b0', 'cancelada', 'pago_rechazado'),
    ('aprobado', timestamptz '2030-01-01 09:00:00.000001-05', 'a0000000-0000-0000-0000-0000000077a0',
     'a0000000-0000-0000-0000-0000000077b0', 'confirmada', null),
    ('rechazado', timestamptz '2030-01-01 09:00:00.000001-05', 'a0000000-0000-0000-0000-0000000077a0',
     'a0000000-0000-0000-0000-0000000077b0', 'cancelada', 'pago_rechazado')$$,
  'Criterio 3: en los seis queda B como revisor y A como responsable (revisarlo no lo reasigna); RN-43: la cita del rechazado queda cancelada por pago_rechazado');

-- ---------------------------------------------------------------------------
-- Lo que revisó B ya no lo revisa nadie más (§5.2)
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000077a0","role":"authenticated"}';
select is(
  array[
    (select resultado from privado.revisar_pago('60000000-0000-0000-0000-000000007701', 'aprobar', null,
       timestamptz '2030-01-01 09:30-05')),
    (select resultado from privado.revisar_pago('60000000-0000-0000-0000-000000007701', 'rechazar', 'Era falso',
       timestamptz '2030-01-01 09:30-05'))],
  array['ya_revisado', 'ya_revisado'],
  '§5.2: lo que revisó B ya no lo revisa ni el responsable: ya_revisado');
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000077b0","role":"authenticated"}';
select is(
  (select resultado from privado.revisar_pago('60000000-0000-0000-0000-000000007701', 'rechazar', 'Era falso',
     timestamptz '2030-01-01 10:00-05')),
  'ya_revisado', 'Ni B otra vez: ya_revisado');
select results_eq(
  $$select estado::text, fecha_revision, id_admin_revisor from public.pago where id = '60000000-0000-0000-0000-000000007701'$$,
  $$values ('aprobado'::text, timestamptz '2030-01-01 08:00-05', 'a0000000-0000-0000-0000-0000000077b0'::uuid)$$,
  'Y la fecha de revisión y el revisor siguen siendo los de la primera revisión');

-- ---------------------------------------------------------------------------
-- Quién no puede, y las observaciones de más de 500 caracteres (D-39, que HU-034 simplifica)
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-000000007701","role":"authenticated"}';
select is(
  array[
    (select resultado from privado.revisar_pago('60000000-0000-0000-0000-000000007707', 'aprobar', null,
       timestamptz '2030-01-01 09:00:00.000001-05')),
    (select resultado from privado.revisar_pago('60000000-0000-0000-0000-000000007707', 'rechazar', 'Nota',
       timestamptz '2030-01-01 09:00:00.000001-05'))],
  array['sin_permiso', 'sin_permiso'],
  'Criterio 1: el monitor no revisa un pago: sin_permiso');
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000077c0","role":"authenticated"}';
select is(
  array[
    (select resultado from privado.revisar_pago('60000000-0000-0000-0000-000000007707', 'aprobar', null,
       timestamptz '2030-01-01 11:00-05')),
    (select resultado from privado.revisar_pago('60000000-0000-0000-0000-000000007707', 'rechazar', 'Nota',
       timestamptz '2030-01-01 11:00-05'))],
  array['sin_permiso', 'sin_permiso'],
  'RN-23: un admin desactivado no revisa: sin_permiso');

set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000077b0","role":"authenticated"}';
select is(
  array[
    (select resultado from privado.revisar_pago('60000000-0000-0000-0000-000000007707', 'rechazar', repeat('a', 501),
       timestamptz '2030-01-01 08:00-05')),
    (select resultado from privado.revisar_pago('60000000-0000-0000-0000-000000007707', 'aprobar',
       ' ' || repeat('a', 501) || ' ', timestamptz '2030-01-01 08:59-05')),
    (select resultado from privado.revisar_pago('60000000-0000-0000-0000-000000007707', 'rechazar', repeat('a', 501),
       timestamptz '2030-01-01 09:00:00.000001-05'))],
  array['observaciones_invalidas', 'observaciones_invalidas', 'observaciones_invalidas'],
  'Más de 500 caracteres (recortados), a cualquier hora, al aprobar o al rechazar: B recibe observaciones_invalidas');
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000077a0","role":"authenticated"}';
select is(
  array[
    (select resultado from privado.revisar_pago('60000000-0000-0000-0000-000000007707', 'rechazar', repeat('a', 501),
       timestamptz '2030-01-01 08:00-05')),
    (select resultado from privado.revisar_pago('60000000-0000-0000-0000-000000007707', 'aprobar',
       ' ' || repeat('a', 501) || ' ', timestamptz '2030-01-01 09:00:00.000001-05'))],
  array['observaciones_invalidas', 'observaciones_invalidas'],
  'Y el responsable recibe la misma respuesta: el texto se valida igual para todos');
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000077b0","role":"authenticated"}';
select is(
  (select array[
     (select resultado from privado.revisar_pago('60000000-0000-0000-0000-0000000077ff', 'rechazar', repeat('a', 501),
        timestamptz '2030-01-01 09:00:00.000001-05')),
     (select resultado from privado.revisar_pago('60000000-0000-0000-0000-0000000077ff', 'rechazar', 'Comprobante ilegible',
        timestamptz '2030-01-01 09:00:00.000001-05'))]),
  array['observaciones_invalidas', 'no_encontrado'],
  'El texto se valida antes de buscar el pago; con un texto válido, un pago que no existe responde no_encontrado');
select results_eq(
  $$select p.estado::text, p.fecha_revision, p.id_admin_revisor, m.estado::text
    from public.pago p join public.monitoria m on m.id = p.id_monitoria
    where p.id = '60000000-0000-0000-0000-000000007707'$$,
  $$values ('en_revision'::text, null::timestamptz, null::uuid, 'confirmada'::text)$$,
  'Ninguno de esos intentos tocó el pago ni la monitoría');

-- ---------------------------------------------------------------------------
-- Por la puerta pública, con la hora de la base
-- ---------------------------------------------------------------------------
set local role authenticated;
select results_eq(
  $$select resultado, cancelo_monitoria from public.revisar_pago('60000000-0000-0000-0000-000000007708', 'aprobar', null)$$,
  $$values ('aprobado'::text, false)$$,
  'Por la puerta: B aprueba el pago asignado a A ahora mismo: aprobado');
select results_eq(
  $$select resultado, cancelo_monitoria from public.revisar_pago('60000000-0000-0000-0000-000000007709', 'rechazar', null)$$,
  $$values ('rechazado'::text, true)$$,
  'Por la puerta: B rechaza el asignado a A hace dos horas: rechazado y canceló la cita');
select results_eq(
  $$select id, id_admin_revisor from public.pago
    where id in ('60000000-0000-0000-0000-000000007708', '60000000-0000-0000-0000-000000007709') order by id$$,
  $$values ('60000000-0000-0000-0000-000000007708'::uuid, 'a0000000-0000-0000-0000-0000000077b0'::uuid),
           ('60000000-0000-0000-0000-000000007709', 'a0000000-0000-0000-0000-0000000077b0')$$,
  'B lee con su sesión quién revisó los dos pagos');
reset role;
select results_eq(
  $$select id, estado::text, fecha_revision, id_admin, id_admin_revisor from public.pago
    where id in ('60000000-0000-0000-0000-000000007708', '60000000-0000-0000-0000-000000007709') order by id$$,
  $$values ('60000000-0000-0000-0000-000000007708'::uuid, 'aprobado'::text, now(), 'a0000000-0000-0000-0000-0000000077a0'::uuid,
            'a0000000-0000-0000-0000-0000000077b0'::uuid),
           ('60000000-0000-0000-0000-000000007709', 'rechazado', now(), 'a0000000-0000-0000-0000-0000000077a0',
            'a0000000-0000-0000-0000-0000000077b0')$$,
  'Los dos quedan revisados con la hora de la base, con A como responsable y B como revisor, sea cual sea su antigüedad');

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
