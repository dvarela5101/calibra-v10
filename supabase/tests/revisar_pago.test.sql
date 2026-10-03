-- Pruebas pgTAP de revisar pagos: aprobar o rechazar (HU-020).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos. Los procesos de pg_cron (cierre automático y
-- expiración de reservas) no ven estas filas.
--
-- La puerta pública (public.revisar_pago) usa now(), que dentro de la transacción no cambia. El borde de P-24 (la
-- sesión ya empezó, P-40) y que una segunda revisión no mueva fecha_revision se prueban con privado.revisar_pago y su
-- p_ahora, como postgres y con el token del admin puesto (auth.uid() lo lee sin importar el rol).
-- La revisión no usa el turno de admins (los pagos se insertan ya asignados), así que no hace falta desactivar a los
-- admins que ya existían, como en registrar_pago.test.sql. Dos revisiones a la vez no caben en una transacción: las
-- cubre la prueba de integración.
--
-- Elenco (ids terminados en 20NN; la materia es 'PGTAP-20'):
--   Admins: A (el asignado), B (otro admin activo) y C (desactivado). Monitor M, con una franja de los lunes 10:00.
--   Lead 01 con su sesión anónima.
--   Monitorías del Lead 01, todas de la franja de M en lunes de 2030, y un pago en revisión de cada una (pago NN de la
--   monitoría NN, asignado a A salvo que se diga otro):
--     01 confirmada (aprobar)                      02 confirmada (rechazar: se cancela y libera la fecha)
--     03 realizada (P-24)                          04 confirmada, rechazada justo en su inicio (P-24, P-40)
--     05 confirmada, rechazada 1 µs antes de su inicio      06 cancelada por el estudiante (rechazar)
--     07 cancelada por el estudiante (aprobar)     08 grupal confirmada
--     09 confirmada, pago de B                     10 confirmada, pago de C (desactivado)
--     11 por pagar con un pago (no debería existir; el rechazo la cancela)

begin;
create extension if not exists pgtap with schema extensions;

select plan(65);

-- ---------------------------------------------------------------------------
-- Estructura y permisos
-- ---------------------------------------------------------------------------
select has_function('privado', 'revisar_pago', array['uuid', 'text', 'text', 'timestamp with time zone'],
  'Existe privado.revisar_pago, la que escribe en pago y monitoria');
select has_function('privado', 'revisar_pago_de_la_sesion', array['uuid', 'text', 'text'],
  'Existe privado.revisar_pago_de_la_sesion, la que ejecuta la sesión con la hora de la base');
select has_function('public', 'revisar_pago', array['uuid', 'text', 'text'],
  'Existe su puerta en la Data API');
select ok(
  (select prosecdef from pg_proc where oid = 'privado.revisar_pago(uuid, text, text, timestamptz)'::regprocedure)
  and (select prosecdef from pg_proc where oid = 'privado.revisar_pago_de_la_sesion(uuid, text, text)'::regprocedure)
  and not (select prosecdef from pg_proc where oid = 'public.revisar_pago(uuid, text, text)'::regprocedure),
  'Las de privado son security definer (escriben en pago y monitoria); la puerta corre con los permisos de quien llama');
select ok(
  (select bool_and('search_path=""' = any(proconfig)) from pg_proc
   where oid in ('privado.revisar_pago(uuid, text, text, timestamptz)'::regprocedure,
                 'privado.revisar_pago_de_la_sesion(uuid, text, text)'::regprocedure,
                 'public.revisar_pago(uuid, text, text)'::regprocedure)),
  'Las tres fijan un search_path vacío');
select is(
  pg_get_function_identity_arguments('public.revisar_pago(uuid, text, text)'::regprocedure),
  'p_id_pago uuid, p_decision text, p_observaciones text',
  'La puerta no recibe el admin ni la hora: nadie revisa a nombre de otro ni mueve el borde de P-24');
select ok(
  not has_function_privilege('anon', 'public.revisar_pago(uuid, text, text)', 'execute')
  and not has_function_privilege('anon', 'privado.revisar_pago_de_la_sesion(uuid, text, text)', 'execute')
  and not has_function_privilege('anon', 'privado.revisar_pago(uuid, text, text, timestamptz)', 'execute'),
  'Sin sesión (anon) no se revisa: ninguna de las tres');
select ok(
  has_function_privilege('authenticated', 'public.revisar_pago(uuid, text, text)', 'execute')
  and has_function_privilege('authenticated', 'privado.revisar_pago_de_la_sesion(uuid, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'privado.revisar_pago(uuid, text, text, timestamptz)', 'execute'),
  'Con sesión sí, por la que usa now(); la que recibe la hora es interna');
select ok(
  not has_function_privilege('service_role', 'public.revisar_pago(uuid, text, text)', 'execute')
  and not has_function_privilege('service_role', 'privado.revisar_pago_de_la_sesion(uuid, text, text)', 'execute')
  and not has_function_privilege('service_role', 'privado.revisar_pago(uuid, text, text, timestamptz)', 'execute'),
  'service_role no la necesita: sin sesión no hay admin');
select ok(
  not exists (
    select 1
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid in ('privado.revisar_pago(uuid, text, text, timestamptz)'::regprocedure,
                    'privado.revisar_pago_de_la_sesion(uuid, text, text)'::regprocedure,
                    'public.revisar_pago(uuid, text, text)'::regprocedure)
      and a.grantee = 0),
  'Nadie las hereda de PUBLIC');
select ok(
  not has_any_column_privilege('authenticated', 'public.pago', 'insert')
  and not has_any_column_privilege('authenticated', 'public.pago', 'update')
  and not has_table_privilege('authenticated', 'public.pago', 'delete')
  and not has_any_column_privilege('authenticated', 'public.monitoria', 'update')
  and not has_any_column_privilege('authenticated', 'public.reembolso', 'insert'),
  'Sigue igual: nadie con sesión escribe en pago, cambia una monitoría ni crea reembolsos; solo la función');
select col_type_is('public', 'pago', 'observaciones', 'text',
  'Supuesto 3: pago.observaciones guarda el caso de P-24');

-- Sin permiso ni se ejecutan.
set local role anon;
select throws_ok($$select * from public.revisar_pago('60000000-0000-0000-0000-000000002001', 'aprobar', null)$$,
  '42501', null, 'anon no puede llamar a revisar_pago: permiso denegado');
reset role;
set local role service_role;
select throws_ok($$select * from public.revisar_pago('60000000-0000-0000-0000-000000002001', 'aprobar', null)$$,
  '42501', null, 'service_role tampoco: no es un admin con sesión');
reset role;
set local role authenticated;
select throws_ok(
  $$select * from privado.revisar_pago('60000000-0000-0000-0000-000000002001', 'aprobar', null, now())$$,
  '42501', null, 'Una sesión no llama a la versión que recibe la hora: permiso denegado');
reset role;

-- ---------------------------------------------------------------------------
-- Fixtures (como postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, is_anonymous, banned_until) values
  ('a0000000-0000-0000-0000-0000000020a0', false, null),
  ('a0000000-0000-0000-0000-0000000020b0', false, null),
  ('a0000000-0000-0000-0000-0000000020c0', false, now() + interval '100 years'),
  ('b0000000-0000-0000-0000-000000002001', false, null),
  ('c0000000-0000-0000-0000-000000002001', true, null);

insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-0000000020a0', 'Admin A', 'admin-a-hu020@calibra.test', 9002001),
  ('a0000000-0000-0000-0000-0000000020b0', 'Admin B', 'admin-b-hu020@calibra.test', 9002002),
  ('a0000000-0000-0000-0000-0000000020c0', 'Admin C', 'admin-c-hu020@calibra.test', 9002003);
insert into public.monitor (id, nombre) values ('b0000000-0000-0000-0000-000000002001', 'Monitor M');
insert into public.materia (id, nombre, codigo) values ('10000000-0000-0000-0000-000000002001', 'Materia HU-020', 'PGTAP-20');
insert into public.certificado (id_monitor, id_materia, id_admin) values
  ('b0000000-0000-0000-0000-000000002001', '10000000-0000-0000-0000-000000002001', 'a0000000-0000-0000-0000-0000000020a0');
insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min) values
  ('30000000-0000-0000-0000-000000002001', 'b0000000-0000-0000-0000-000000002001', 1, '10:00', true, 25000, 60);
insert into public.lead (id, id_sesion_anonima, nombre, correo, acepta_tratamiento_datos, fecha_consentimiento) values
  ('40000000-0000-0000-0000-000000002001', 'c0000000-0000-0000-0000-000000002001', 'Lead Uno', 'lead-01-hu020@calibra.test', true, now());

insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado, motivo_cancelacion, fecha_finalizacion)
select ('50000000-0000-0000-0000-0000000020' || v.nn)::uuid, '30000000-0000-0000-0000-000000002001',
       '10000000-0000-0000-0000-000000002001', '40000000-0000-0000-0000-000000002001', v.fecha, 25000,
       v.estado, v.motivo, v.finalizada
from (values
  ('01', date '2030-01-07', 'confirmada'::public.estado_monitoria, null::public.motivo_cancelacion, null::timestamptz),
  ('02', date '2030-01-14', 'confirmada', null, null),
  ('03', date '2030-01-21', 'realizada', null, timestamptz '2030-01-21 11:00-05'),
  ('04', date '2030-01-28', 'confirmada', null, null),
  ('05', date '2030-02-04', 'confirmada', null, null),
  ('06', date '2030-02-11', 'cancelada', 'estudiante', null),
  ('07', date '2030-02-18', 'cancelada', 'estudiante', null),
  ('08', date '2030-02-25', 'confirmada', null, null),
  ('09', date '2030-03-04', 'confirmada', null, null),
  ('10', date '2030-03-11', 'confirmada', null, null),
  ('11', date '2030-03-18', 'pendiente_pago', null, null)
) as v(nn, fecha, estado, motivo, finalizada);
insert into public.monitoria_grupal (id_monitoria, cupos, modalidad_pago, precio_por_persona) values
  ('50000000-0000-0000-0000-000000002008', 3, 'dividido', 15000);

-- Un pago solo puede apuntar a un comprobante que el servidor revisó (HU-059). No hace falta el archivo.
insert into public.comprobante_revisado (ruta, tipo)
select 'c0000000-0000-0000-0000-000000002001/e2000000-0000-0000-0000-0000000000' || n || '.png', 'image/png'
from (values ('01'), ('02'), ('03'), ('04'), ('05'), ('06'), ('07'), ('08'), ('09'), ('10'), ('11')) as v(n);

insert into public.pago (id, id_monitoria, monto, nombre_pagador, contacto, id_admin, comprobante)
select ('60000000-0000-0000-0000-0000000020' || v.nn)::uuid, ('50000000-0000-0000-0000-0000000020' || v.nn)::uuid,
       25000, 'Pagador ' || v.nn, 'pagador-' || v.nn || '-hu020@calibra.test', v.id_admin::uuid,
       'c0000000-0000-0000-0000-000000002001/e2000000-0000-0000-0000-0000000000' || v.nn || '.png'
from (values
  ('01', 'a0000000-0000-0000-0000-0000000020a0'), ('02', 'a0000000-0000-0000-0000-0000000020a0'),
  ('03', 'a0000000-0000-0000-0000-0000000020a0'), ('04', 'a0000000-0000-0000-0000-0000000020a0'),
  ('05', 'a0000000-0000-0000-0000-0000000020a0'), ('06', 'a0000000-0000-0000-0000-0000000020a0'),
  ('07', 'a0000000-0000-0000-0000-0000000020a0'), ('08', 'a0000000-0000-0000-0000-0000000020a0'),
  ('09', 'a0000000-0000-0000-0000-0000000020b0'), ('10', 'a0000000-0000-0000-0000-0000000020c0'),
  ('11', 'a0000000-0000-0000-0000-0000000020a0')
) as v(nn, id_admin);

select ok(
  (select count(*) = 11 and bool_and(estado = 'en_revision' and fecha_revision is null and observaciones is null)
   from public.pago where id::text like '60000000-0000-0000-0000-0000000020%')
  and exists (select 1 from public.monitoria_grupal where id_monitoria = '50000000-0000-0000-0000-000000002008')
  and (select public.inicio_sesion(m.fecha, f.hora) = timestamptz '2030-01-28 10:00-05'
       from public.monitoria m join public.franja f on f.id = m.id_franja
       where m.id = '50000000-0000-0000-0000-000000002004')
  and (select banned_until > now() from auth.users where id = 'a0000000-0000-0000-0000-0000000020c0'),
  'Control: los 11 pagos están en revisión, la 08 es grupal, la 04 empieza el 28-ene-2030 a las 10:00 en Bogotá y C está desactivado');

-- La restricción de la columna, por fuera de la función (como postgres).
select throws_ok(
  $$update public.pago set observaciones = '   ' where id = '60000000-0000-0000-0000-000000002001'$$,
  '23514', null,
  'Las observaciones no pueden quedar en blanco (pago_observaciones_con_texto)');
select throws_ok(
  $$update public.pago set observaciones = E'\n\t\r\n' where id = '60000000-0000-0000-0000-000000002001'$$,
  '23514', null,
  'Ni ser puros saltos de línea y tabuladores');
select throws_ok(
  $$update public.pago set observaciones = repeat('a', 501) where id = '60000000-0000-0000-0000-000000002001'$$,
  '23514', null,
  'Ni pasar de 500 caracteres');

-- ---------------------------------------------------------------------------
-- Sin sesión, y quien no es un admin activo
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"role":"authenticated"}';
select results_eq(
  $$select resultado, cancelo_monitoria from public.revisar_pago('60000000-0000-0000-0000-000000002001', 'aprobar', null)$$,
  $$values ('sin_sesion'::text, false)$$,
  'Sin sesión (el token no trae sub): sin_sesion');

set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000002001","role":"authenticated","is_anonymous":true}';
select is(
  (select resultado from public.revisar_pago('60000000-0000-0000-0000-000000002001', 'rechazar', null)),
  'sin_permiso', 'El Lead que pagó no revisa su pago: sin_permiso');

set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-000000002001","role":"authenticated"}';
select is(
  (select resultado from public.revisar_pago('60000000-0000-0000-0000-000000002001', 'aprobar', null)),
  'sin_permiso', 'El monitor de la monitoría tampoco: sin_permiso');

set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000020c0","role":"authenticated"}';
select is(
  (select resultado from public.revisar_pago('60000000-0000-0000-0000-000000002010', 'aprobar', null)),
  'sin_permiso', 'RN-23: un admin desactivado no revisa ni el pago que tiene asignado: sin_permiso');

reset role;
select results_eq(
  $$select p.estado::text, p.fecha_revision, m.estado::text
    from public.pago p join public.monitoria m on m.id = p.id_monitoria
    where p.id in ('60000000-0000-0000-0000-000000002001', '60000000-0000-0000-0000-000000002010') order by p.id$$,
  $$values ('en_revision'::text, null::timestamptz, 'confirmada'::text), ('en_revision', null, 'confirmada')$$,
  'Ninguno de esos intentos tocó el pago ni la monitoría');

-- ---------------------------------------------------------------------------
-- Lo que A no puede revisar (A es el admin de la sesión desde aquí)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000020a0","role":"authenticated"}';
select is(
  array[
    (select resultado from public.revisar_pago('60000000-0000-0000-0000-000000002002', 'APROBAR', null)),
    (select resultado from public.revisar_pago('60000000-0000-0000-0000-000000002002', 'aprobado', null)),
    (select resultado from public.revisar_pago('60000000-0000-0000-0000-000000002002', ' rechazar', null)),
    (select resultado from public.revisar_pago('60000000-0000-0000-0000-000000002002', 'cancelar', null)),
    (select resultado from public.revisar_pago('60000000-0000-0000-0000-000000002002', '', null)),
    (select resultado from public.revisar_pago('60000000-0000-0000-0000-000000002002', null, null))],
  array_fill('decision_invalida'::text, array[6]),
  'Una decisión que no es exactamente aprobar ni rechazar (mayúsculas, espacios, otra palabra, vacía, nula): decision_invalida');
select is(
  array[
    (select resultado from public.revisar_pago('60000000-0000-0000-0000-000000002002', 'rechazar', repeat('a', 501))),
    (select resultado from public.revisar_pago('60000000-0000-0000-0000-000000002002', 'aprobar', ' ' || repeat('a', 501) || ' '))],
  array['observaciones_invalidas', 'observaciones_invalidas'],
  'Observaciones de más de 500 caracteres (recortadas), al rechazar o al aprobar: observaciones_invalidas');
select is(
  array[
    (select resultado from public.revisar_pago('60000000-0000-0000-0000-0000000020ff', 'aprobar', null)),
    (select resultado from public.revisar_pago(null, 'aprobar', null))],
  array['no_encontrado', 'no_encontrado'],
  'Un pago que no existe, o ninguno: no_encontrado');
select is(
  array[
    (select resultado from public.revisar_pago('60000000-0000-0000-0000-000000002009', 'aprobar', null)),
    (select resultado from public.revisar_pago('60000000-0000-0000-0000-000000002009', 'rechazar', 'Nota'))],
  array['no_asignado', 'no_asignado'],
  'Supuesto 1: el pago asignado a B no lo revisa A, aunque A sea un admin activo: no_asignado');
select is(
  array[
    (select resultado from public.revisar_pago('60000000-0000-0000-0000-000000002008', 'rechazar', null)),
    (select resultado from public.revisar_pago('60000000-0000-0000-0000-000000002008', 'aprobar', null))],
  array['no_individual', 'no_individual'],
  'Supuesto 8: el pago de una grupal no se revisa por aquí (HU-038): no_individual');

-- ---------------------------------------------------------------------------
-- Aprobar (criterio 2)
-- ---------------------------------------------------------------------------
select results_eq(
  $$select resultado, cancelo_monitoria from public.revisar_pago('60000000-0000-0000-0000-000000002001', 'aprobar', null)$$,
  $$values ('aprobado'::text, false)$$,
  'El admin asignado aprueba el pago en revisión: aprobado, sin cancelar nada');
reset role;
select results_eq(
  $$select estado::text, fecha_revision, observaciones from public.pago where id = '60000000-0000-0000-0000-000000002001'$$,
  $$values ('aprobado'::text, now(), null::text)$$,
  'Criterio 2: queda aprobado con fecha de revisión (la hora de la base) y sin observaciones');
select results_eq(
  $$select estado::text, motivo_cancelacion::text from public.monitoria where id = '50000000-0000-0000-0000-000000002001'$$,
  $$values ('confirmada'::text, null::text)$$,
  'F3: si aprueba, todo sigue; la monitoría sigue confirmada');

set local role authenticated;
select is(
  array[
    (select resultado from public.revisar_pago('60000000-0000-0000-0000-000000002001', 'aprobar', null)),
    (select resultado from public.revisar_pago('60000000-0000-0000-0000-000000002001', 'rechazar', 'Era falso'))],
  array['ya_revisado', 'ya_revisado'],
  '§5.2: un pago aprobado no se vuelve a aprobar ni pasa a rechazado: ya_revisado');
reset role;
select is(
  (select resultado from privado.revisar_pago('60000000-0000-0000-0000-000000002001', 'aprobar', null,
     now() + interval '1 day')),
  'ya_revisado', 'Aprobar otra vez, un día después: ya_revisado');
select results_eq(
  $$select estado::text, fecha_revision from public.pago where id = '60000000-0000-0000-0000-000000002001'$$,
  $$values ('aprobado'::text, now())$$,
  'Y la fecha de revisión sigue siendo la de la primera aprobación');

-- ---------------------------------------------------------------------------
-- Rechazar una confirmada que aún no empezó (criterio 3)
-- ---------------------------------------------------------------------------
select is(privado.fecha_libre('30000000-0000-0000-0000-000000002001', '2030-01-14', now()), false,
  'Control: mientras la 02 está confirmada, su fecha está ocupada');
set local role authenticated;
select results_eq(
  $$select resultado, cancelo_monitoria from public.revisar_pago('60000000-0000-0000-0000-000000002002', 'rechazar', null)$$,
  $$values ('rechazado'::text, true)$$,
  'Rechaza el pago de una cita futura, sin observaciones (son opcionales aquí): rechazado y canceló la monitoría');
reset role;
select results_eq(
  $$select estado::text, fecha_revision, observaciones from public.pago where id = '60000000-0000-0000-0000-000000002002'$$,
  $$values ('rechazado'::text, now(), null::text)$$,
  'Criterio 3: el pago queda rechazado con fecha de revisión');
select results_eq(
  $$select estado::text, motivo_cancelacion::text from public.monitoria where id = '50000000-0000-0000-0000-000000002002'$$,
  $$values ('cancelada'::text, 'pago_rechazado'::text)$$,
  'RN-43: la monitoría pasa a cancelada por pago_rechazado');
select is(privado.fecha_libre('30000000-0000-0000-0000-000000002001', '2030-01-14', now()), true,
  'La fecha queda libre: privado.fecha_libre ya no cuenta la cancelada');
select lives_ok(
  $$insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total)
    values ('50000000-0000-0000-0000-000000002099', '30000000-0000-0000-0000-000000002001',
            '10000000-0000-0000-0000-000000002001', '40000000-0000-0000-0000-000000002001', '2030-01-14', 25000)$$,
  'Y otra monitoría se puede agendar en esa franja y fecha: el índice único tampoco la cuenta');
select is(
  (select count(*)::int from public.aviso_monitor where id_monitoria = '50000000-0000-0000-0000-000000002002'),
  0, 'Supuesto 5: al monitor no se le anota aviso por el rechazo (lo ve en su agenda, D-11)');
select is(
  (select resultado from privado.revisar_pago('60000000-0000-0000-0000-000000002002', 'aprobar', null, now())),
  'ya_revisado', '§5.2: el rechazado no se puede aprobar después: ya_revisado');

-- ---------------------------------------------------------------------------
-- Rechazar el pago de una monitoría realizada (criterio 7, P-24)
-- ---------------------------------------------------------------------------
set local role authenticated;
select is(
  array[
    (select resultado from public.revisar_pago('60000000-0000-0000-0000-000000002003', 'rechazar', null)),
    (select resultado from public.revisar_pago('60000000-0000-0000-0000-000000002003', 'rechazar', '   ')),
    (select resultado from public.revisar_pago('60000000-0000-0000-0000-000000002003', 'rechazar', E'\n\t\r\n '))],
  array_fill('observaciones_requeridas'::text, array[3]),
  'Supuesto 3: rechazar el pago de una realizada sin decir qué se hará con el cobro (nada, espacios o saltos de línea): observaciones_requeridas');
reset role;
select results_eq(
  $$select p.estado::text, p.fecha_revision, m.estado::text
    from public.pago p join public.monitoria m on m.id = p.id_monitoria
    where p.id = '60000000-0000-0000-0000-000000002003'$$,
  $$values ('en_revision'::text, null::timestamptz, 'realizada'::text)$$,
  'Sin observaciones no se tocó nada');
set local role authenticated;
select results_eq(
  $$select resultado, cancelo_monitoria
    from public.revisar_pago('60000000-0000-0000-0000-000000002003', 'rechazar', E'\n  Se cobra por fuera al pagador.  \r\n')$$,
  $$values ('rechazado'::text, false)$$,
  'Con observaciones: rechazado, sin cancelar la monitoría');
select is(
  (select observaciones from public.pago where id = '60000000-0000-0000-0000-000000002003'),
  'Se cobra por fuera al pagador.',
  'El admin lee el caso registrado con su sesión (la RLS de pago ya lo deja)');
reset role;
select results_eq(
  $$select estado::text, fecha_revision, observaciones from public.pago where id = '60000000-0000-0000-0000-000000002003'$$,
  $$values ('rechazado'::text, now(), 'Se cobra por fuera al pagador.'::text)$$,
  'P-24: el pago queda rechazado (fuera del desembolso, RN-45) y el caso, registrado y recortado');
select results_eq(
  $$select estado::text, motivo_cancelacion::text, fecha_finalizacion
    from public.monitoria where id = '50000000-0000-0000-0000-000000002003'$$,
  $$values ('realizada'::text, null::text, timestamptz '2030-01-21 11:00-05')$$,
  'Criterio 7: la monitoría sigue realizada, con su fecha de finalización');

-- ---------------------------------------------------------------------------
-- Una confirmada que ya empezó también es P-24 (supuesto 2, P-40)
-- ---------------------------------------------------------------------------
-- La 04 empieza el 28-ene-2030 a las 10:00 en Bogotá; la 05, el 4-feb-2030 a las 10:00.
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000020a0","role":"authenticated"}';
select is(
  (select resultado from privado.revisar_pago('60000000-0000-0000-0000-000000002004', 'rechazar', null,
     timestamptz '2030-01-28 10:00-05')),
  'observaciones_requeridas', 'P-40: justo en su inicio la sesión ya empezó; sin observaciones: observaciones_requeridas');
select results_eq(
  $$select resultado, cancelo_monitoria from privado.revisar_pago('60000000-0000-0000-0000-000000002004', 'rechazar',
      'Lo asume Calibra.', timestamptz '2030-01-28 10:00-05')$$,
  $$values ('rechazado'::text, false)$$,
  'Con observaciones: rechazado, sin cancelar la monitoría');
select results_eq(
  $$select estado::text, fecha_revision, observaciones from public.pago where id = '60000000-0000-0000-0000-000000002004'$$,
  $$values ('rechazado'::text, timestamptz '2030-01-28 10:00-05', 'Lo asume Calibra.'::text)$$,
  'El pago queda rechazado con la hora de la revisión y el caso registrado');
select results_eq(
  $$select estado::text, motivo_cancelacion::text from public.monitoria where id = '50000000-0000-0000-0000-000000002004'$$,
  $$values ('confirmada'::text, null::text)$$,
  'La monitoría que ya empezó sigue confirmada: el monitor todavía la finaliza o se cierra sola');

select results_eq(
  $$select resultado, cancelo_monitoria from privado.revisar_pago('60000000-0000-0000-0000-000000002005', 'rechazar',
      null, timestamptz '2030-02-04 09:59:59.999999-05')$$,
  $$values ('rechazado'::text, true)$$,
  'Un microsegundo antes de su inicio todavía no empezó: sin observaciones, rechazado y canceló la monitoría');
select results_eq(
  $$select p.estado::text, p.fecha_revision, m.estado::text, m.motivo_cancelacion::text
    from public.pago p join public.monitoria m on m.id = p.id_monitoria
    where p.id = '60000000-0000-0000-0000-000000002005'$$,
  $$values ('rechazado'::text, timestamptz '2030-02-04 09:59:59.999999-05', 'cancelada'::text, 'pago_rechazado'::text)$$,
  'El pago queda rechazado y la monitoría, cancelada por pago_rechazado');

-- ---------------------------------------------------------------------------
-- Con la cita ya cancelada por el estudiante solo cambia el pago (docs/reparto.md, 2-oct-2026)
-- ---------------------------------------------------------------------------
set local role authenticated;
select results_eq(
  $$select resultado, cancelo_monitoria from public.revisar_pago('60000000-0000-0000-0000-000000002006', 'rechazar',
      '  ' || repeat('a', 500) || '  ')$$,
  $$values ('rechazado'::text, false)$$,
  'Rechazar sobre una cita cancelada por el estudiante (con 500 caracteres de observaciones): rechazado, sin cancelar nada');
select results_eq(
  $$select resultado, cancelo_monitoria from public.revisar_pago('60000000-0000-0000-0000-000000002007', 'aprobar', null)$$,
  $$values ('aprobado'::text, false)$$,
  'Aprobar sobre una cita cancelada por el estudiante: aprobado');
reset role;
select results_eq(
  $$select p.estado::text, char_length(p.observaciones), m.estado::text, m.motivo_cancelacion::text
    from public.pago p join public.monitoria m on m.id = p.id_monitoria
    where p.id = '60000000-0000-0000-0000-000000002006'$$,
  $$values ('rechazado'::text, 500, 'cancelada'::text, 'estudiante'::text)$$,
  'El pago rechazado guarda los 500 caracteres ya recortados y la monitoría sigue cancelada por el estudiante');
select results_eq(
  $$select p.estado::text, p.fecha_revision, m.estado::text, m.motivo_cancelacion::text
    from public.pago p join public.monitoria m on m.id = p.id_monitoria
    where p.id = '60000000-0000-0000-0000-000000002007'$$,
  $$values ('aprobado'::text, now(), 'cancelada'::text, 'estudiante'::text)$$,
  'El pago aprobado tampoco toca la monitoría (el reembolso de P-07 es del trigger de HU-024)');

-- ---------------------------------------------------------------------------
-- Defensivo: una por pagar con pago se cancela al rechazarlo
-- ---------------------------------------------------------------------------
set local role authenticated;
select results_eq(
  $$select resultado, cancelo_monitoria from public.revisar_pago('60000000-0000-0000-0000-000000002011', 'rechazar', null)$$,
  $$values ('rechazado'::text, true)$$,
  'Rechazar el pago de una monitoría que quedó por pagar: rechazado y canceló la monitoría');
reset role;
select results_eq(
  $$select estado::text, motivo_cancelacion::text from public.monitoria where id = '50000000-0000-0000-0000-000000002011'$$,
  $$values ('cancelada'::text, 'pago_rechazado'::text)$$,
  'Queda cancelada por pago_rechazado: si no, reserva_vencida nunca la vencería (tiene un pago) y ocuparía la fecha');

-- ---------------------------------------------------------------------------
-- Sin reembolsos ni desembolsos (criterio 5, RN-43, RN-45)
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from public.reembolso where id_pago::text like '60000000-0000-0000-0000-0000000020%'),
  0, 'Criterio 5: ningún pago revisado tiene reembolso (los rechazados nunca; el de P-07 es de HU-024)');
select is(
  (select count(*)::int from public.desembolso where id_monitoria::text like '50000000-0000-0000-0000-0000000020%'),
  0, 'La revisión no crea desembolsos (RN-45 la aplica HU-028)');

-- ---------------------------------------------------------------------------
-- El admin no escribe en pago por fuera de la función
-- ---------------------------------------------------------------------------
set local role authenticated;
select throws_ok(
  $$update public.pago set estado = 'aprobado', fecha_revision = now() where id = '60000000-0000-0000-0000-000000002009'$$,
  '42501', null,
  'Ni el admin con sesión actualiza pago directo en la Data API: permiso denegado');
reset role;

select results_eq(
  $$select p.id, p.estado::text, m.estado::text
    from public.pago p join public.monitoria m on m.id = p.id_monitoria
    where p.id in ('60000000-0000-0000-0000-000000002008', '60000000-0000-0000-0000-000000002009',
                   '60000000-0000-0000-0000-000000002010')
    order by p.id$$,
  $$values ('60000000-0000-0000-0000-000000002008'::uuid, 'en_revision'::text, 'confirmada'::text),
           ('60000000-0000-0000-0000-000000002009'::uuid, 'en_revision', 'confirmada'),
           ('60000000-0000-0000-0000-000000002010'::uuid, 'en_revision', 'confirmada')$$,
  'Al final, el de la grupal, el de B y el de C siguen en revisión y sus monitorías, confirmadas');

select * from finish();
rollback;
