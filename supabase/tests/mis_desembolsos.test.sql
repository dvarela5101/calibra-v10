-- Pruebas pgTAP de mis desembolsos: el monitor ve los suyos con tres cifras y una situación cerrada (HU-050, D-59).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.
--
-- La lectura con la hora como parámetro (privado.desembolsos_del_monitor) se prueba como postgres, con el token del
-- monitor puesto (auth.uid() lo lee sin importar el rol), y un `ahora` fijo: el miércoles 31-dic-2031 a las 12:00 en
-- Bogotá, salvo en los bordes de N-6. Las sesiones del elenco son lunes de 2031 o anteriores y se insertan ya
-- realizadas (el trigger de HU-028 es solo de UPDATE), cada una con la foto de montos que el caso necesita. Las puertas
-- de la sesión usan now(): se prueban con monitorías de 2020 y una que terminó hace una hora, para que ninguna prueba
-- compare now() con una fecha fija que algún día quede atrás.
-- Las dos pruebas que redefinen funciones (la del `greatest` y la de «sin fila no hay listo») cierran el archivo, en ese
-- orden: la redefinición sigue vigente hasta el rollback, y no se usa `rollback to savepoint` porque pgTAP lleva sus
-- resultados en tablas temporales de la misma transacción.
--
-- Elenco (ids terminados en 50NN; la materia es 'PGTAP-50'):
--   Admin A. Monitores M (con su llave 'llave-m-50'), N (otro) y O (sin desembolsos). Lead 01 con su sesión anónima y
--   otra sesión anónima sin Lead. Franjas de M: lunes 10:00 (60 min) y lunes 12:00 (60 min).
--   De M, a las 10:00 salvo la 16 (el desembolso 7000...50NN es el de la monitoría NN):
--     01 lun 1-dic: un pago aprobado de 37.000 y la foto en 25.000 (la lectura dice lo de hoy, no la foto)
--     02 lun 29-dic: un pago aprobado de 25.000; su fin + 24 h es el martes 30 a las 11:00 (borde de N-6)
--     03 lun 8-dic: un pago aprobado de 20.000 y otro en revisión de 10.000
--     04 lun 15-dic: su único pago, rechazado, con el caso P-24 abierto
--     05 lun 22-dic: un pago aprobado de 20.000 y uno rechazado de 10.000 con el caso cerrado como asumido
--     06 lun 24-nov: un pago aprobado y un reporte en revisión    07 lun 17-nov: un pago aprobado y un reporte rechazado
--     08 lun 10-nov: cancelada por monitor_no_asistio, reporte aceptado y desembolso anulado (con foto, llave y hasta una
--        referencia y un día de transferencia sobrantes, que la lectura no debe mostrar)
--     09 lun 3-nov: transferido (18.000 guardados, llave anterior, transferido a las 22:00 de Bogotá, que en UTC ya es el
--        día siguiente); los pagos de hoy sumarían 25.000
--     10 lun 27-oct: sin pagos, la foto en 0 y una referencia sobrante (un pendiente no muestra referencia)
--     11 lun 20-oct: desembolso pendiente de una monitoría cancelada sin reporte
--     12 lun 13-oct: la foto en 0 y un pago aprobado    13 lun 6-oct: un pago aprobado de 200.000 (la comisión en su tope)
--     15 lun 22-sep: un reporte en revisión y un pago en revisión a la vez
--     16 lun 29-dic a las 12:00: un pago aprobado y un reporte en revisión
--     17 lun 15-sep: cancelada con un reporte aceptado, pero su desembolso ya estaba transferido
--   De N: la 14 (lun 29-sep, un pago aprobado).
--   Para las puertas con now() y la bandeja (de M, de 2020, y una reciente): 41 con un pago aprobado, 42 con un pago en
--   revisión, 43 con un caso P-24 abierto, 44 con un reporte en revisión, 45 sin pagos y 46 que terminó hace una hora.

begin;
create extension if not exists pgtap with schema extensions;

select plan(56);

-- ---------------------------------------------------------------------------
-- Estructura y permisos
-- ---------------------------------------------------------------------------
select has_function('privado', 'desembolsos_del_monitor', array['timestamp with time zone'],
  'Existe privado.desembolsos_del_monitor, la lectura con la hora como parámetro (para probar los plazos)');
select has_function('privado', 'mis_desembolsos_de_la_sesion', '{}'::name[],
  'Existe privado.mis_desembolsos_de_la_sesion, la entrada de la sesión con la hora de la base');
select has_function('public', 'mis_desembolsos', '{}'::name[],
  'Existe su puerta en la Data API: public.mis_desembolsos()');
select ok(
  (select bool_and(prosecdef) from pg_proc
   where oid in ('privado.desembolsos_del_monitor(timestamptz)'::regprocedure,
                 'privado.mis_desembolsos_de_la_sesion()'::regprocedure))
  and not (select prosecdef from pg_proc where oid = 'public.mis_desembolsos()'::regprocedure),
  'Las dos de privado son security definer (el monitor no lee desembolso, pago ni reporte); la puerta corre con los permisos de quien llama');
select ok(
  (select bool_and(coalesce('search_path=""' = any(proconfig), false)) from pg_proc
   where oid in ('privado.desembolsos_del_monitor(timestamptz)'::regprocedure,
                 'privado.mis_desembolsos_de_la_sesion()'::regprocedure,
                 'public.mis_desembolsos()'::regprocedure)),
  'Las tres fijan un search_path vacío');
select ok(
  (select bool_and(provolatile = 's') from pg_proc
   where oid in ('privado.desembolsos_del_monitor(timestamptz)'::regprocedure,
                 'privado.mis_desembolsos_de_la_sesion()'::regprocedure,
                 'public.mis_desembolsos()'::regprocedure)),
  'Las tres son stable: una sola sentencia, un solo snapshot, nada que escriba ni tome candados');
select is(
  array[pg_get_function_identity_arguments('privado.desembolsos_del_monitor(timestamptz)'::regprocedure),
        pg_get_function_identity_arguments('privado.mis_desembolsos_de_la_sesion()'::regprocedure),
        pg_get_function_identity_arguments('public.mis_desembolsos()'::regprocedure)],
  array['p_ahora timestamp with time zone', '', ''],
  'La entrada de la sesión y la puerta no reciben nada, ni el monitor ni la hora: nadie pide los desembolsos de otro ni cambia el reloj (HU-050)');
select ok(
  has_function_privilege('authenticated', 'public.mis_desembolsos()', 'execute')
  and has_function_privilege('authenticated', 'privado.mis_desembolsos_de_la_sesion()', 'execute')
  and not has_function_privilege('authenticated', 'privado.desembolsos_del_monitor(timestamptz)', 'execute'),
  'Con sesión se ejecutan la puerta y la entrada de la sesión; la versión con p_ahora es interna, sin grant (patrón de HU-028 y HU-030)');
select ok(
  not has_function_privilege('anon', 'public.mis_desembolsos()', 'execute')
  and not has_function_privilege('anon', 'privado.mis_desembolsos_de_la_sesion()', 'execute')
  and not has_function_privilege('anon', 'privado.desembolsos_del_monitor(timestamptz)', 'execute'),
  'Sin sesión (anon) no hay desembolsos: ninguna de las tres');
select ok(
  not has_function_privilege('service_role', 'public.mis_desembolsos()', 'execute')
  and not has_function_privilege('service_role', 'privado.mis_desembolsos_de_la_sesion()', 'execute')
  and not has_function_privilege('service_role', 'privado.desembolsos_del_monitor(timestamptz)', 'execute'),
  'service_role no ejecuta ninguna: sin sesión no hay auth.uid() ni monitor');
select ok(
  not exists (
    select 1
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid in ('privado.desembolsos_del_monitor(timestamptz)'::regprocedure,
                    'privado.mis_desembolsos_de_la_sesion()'::regprocedure,
                    'public.mis_desembolsos()'::regprocedure)
      and a.grantee = 0),
  'Nadie las hereda de PUBLIC');
select ok(
  obj_description('privado.desembolsos_del_monitor(timestamptz)'::regprocedure, 'pg_proc') is not null
  and obj_description('privado.mis_desembolsos_de_la_sesion()'::regprocedure, 'pg_proc') is not null
  and obj_description('public.mis_desembolsos()'::regprocedure, 'pg_proc') is not null,
  'Las tres tienen comentario');

-- Lo que devuelve: las 13 columnas de la pantalla. P-37 (nada del estudiante ni de quien pagó), D-59 (tres cifras) y la
-- situación cerrada (nunca el motivo interno).
select is(
  (select array_agg(a.n order by a.o)
   from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as a(n, m, o)
   where p.oid = 'privado.desembolsos_del_monitor(timestamptz)'::regprocedure and a.m = 't'),
  array['id_desembolso', 'fecha', 'hora', 'duracion_min', 'nombre_materia', 'situacion', 'desembolsable_desde',
        'monto_bruto', 'comision', 'monto_neto', 'llave_destino', 'referencia_transferencia', 'fecha_desembolso'],
  'La lectura devuelve exactamente esas 13 columnas, en ese orden');
select is(
  (select array_agg(a.n order by a.o)
   from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as a(n, m, o)
   where p.oid = 'privado.mis_desembolsos_de_la_sesion()'::regprocedure and a.m = 't'),
  (select array_agg(a.n order by a.o)
   from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as a(n, m, o)
   where p.oid = 'privado.desembolsos_del_monitor(timestamptz)'::regprocedure and a.m = 't'),
  'La entrada de la sesión devuelve las mismas columnas, en el mismo orden');
select is(
  (select array_agg(a.n order by a.o)
   from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as a(n, m, o)
   where p.oid = 'public.mis_desembolsos()'::regprocedure and a.m = 't'),
  (select array_agg(a.n order by a.o)
   from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as a(n, m, o)
   where p.oid = 'privado.desembolsos_del_monitor(timestamptz)'::regprocedure and a.m = 't'),
  'La puerta devuelve exactamente las mismas columnas, en el mismo orden');
select ok(
  not exists (
    select 1
    from pg_proc p, unnest(p.proargnames, p.proargmodes) as a(n, m)
    where p.oid in ('privado.desembolsos_del_monitor(timestamptz)'::regprocedure,
                    'privado.mis_desembolsos_de_la_sesion()'::regprocedure,
                    'public.mis_desembolsos()'::regprocedure)
      and a.m = 't'
      and a.n ~* '(id_admin|nombre_estudiante|nombre_pagador|contacto|correo|telefono|motivo|con_reporte|caso_abierto|pagos_en_revision|sin_pagos_aprobados|no_realizada)'),
  'Ninguna columna de salida es del admin, del estudiante, de quien pagó, de contacto ni un motivo interno');
select is(
  (select count(*)::int
   from pg_proc p, unnest(p.proargnames, p.proargmodes) as a(n, m)
   where p.oid in ('privado.desembolsos_del_monitor(timestamptz)'::regprocedure,
                   'privado.mis_desembolsos_de_la_sesion()'::regprocedure,
                   'public.mis_desembolsos()'::regprocedure)
     and a.m = 't' and a.n in ('monto_bruto', 'comision', 'monto_neto')),
  9, 'Las tres cifras de D-59 (total, comisión y neto) están en las tres funciones: las únicas cifras de dinero');

-- Sin sesión de monitor, ni se ejecutan.
set local role anon;
select throws_ok($$select * from public.mis_desembolsos()$$, '42501', null,
  'anon no puede llamar a mis_desembolsos: permiso denegado');
select throws_ok($$select * from privado.mis_desembolsos_de_la_sesion()$$, '42501', null,
  'Ni a la entrada de la sesión');
reset role;
set local role service_role;
select throws_ok($$select * from public.mis_desembolsos()$$, '42501', null,
  'service_role tampoco: no es un monitor con sesión');
reset role;
set local role authenticated;
select throws_ok($$select * from privado.desembolsos_del_monitor(now())$$, '42501', null,
  'Una sesión no llama a la versión que recibe la hora: permiso denegado');
reset role;

-- ---------------------------------------------------------------------------
-- Fixtures (como postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, is_anonymous) values
  ('a0000000-0000-0000-0000-0000000050a0', false),
  ('b0000000-0000-0000-0000-0000000050a0', false),
  ('b0000000-0000-0000-0000-0000000050b0', false),
  ('b0000000-0000-0000-0000-0000000050c0', false),
  ('c0000000-0000-0000-0000-000000005001', true),
  ('c0000000-0000-0000-0000-000000005002', true);

insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-0000000050a0', 'Admin A', 'admin-a-hu050@calibra.test', 9005001);
insert into public.monitor (id, nombre) values
  ('b0000000-0000-0000-0000-0000000050a0', 'Monitor M'),
  ('b0000000-0000-0000-0000-0000000050b0', 'Monitor N'),
  ('b0000000-0000-0000-0000-0000000050c0', 'Monitor O');
insert into public.monitor_privado (id_monitor, numero_telefono, correo, llave) values
  ('b0000000-0000-0000-0000-0000000050a0', '3000005001', 'monitor-m-hu050@calibra.test', 'llave-m-50'),
  ('b0000000-0000-0000-0000-0000000050b0', '3000005002', 'monitor-n-hu050@calibra.test', 'llave-n-50');
insert into public.materia (id, nombre, codigo) values ('10000000-0000-0000-0000-000000005001', 'Materia HU-050', 'PGTAP-50');
insert into public.certificado (id_monitor, id_materia, id_admin) values
  ('b0000000-0000-0000-0000-0000000050a0', '10000000-0000-0000-0000-000000005001', 'a0000000-0000-0000-0000-0000000050a0'),
  ('b0000000-0000-0000-0000-0000000050b0', '10000000-0000-0000-0000-000000005001', 'a0000000-0000-0000-0000-0000000050a0');
insert into public.lead (id, id_sesion_anonima, nombre, correo, acepta_tratamiento_datos, fecha_consentimiento) values
  ('40000000-0000-0000-0000-000000005001', 'c0000000-0000-0000-0000-000000005001', 'Lead Uno', 'lead-01-hu050@calibra.test', true, now());

-- Franjas: de M, los lunes a las 10:00 (…5020) y a las 12:00 (…5021), 60 min cada una; de N, los lunes a las 10:00.
insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min) values
  ('30000000-0000-0000-0000-000000005020', 'b0000000-0000-0000-0000-0000000050a0', 1, '10:00', true, 25000, 60),
  ('30000000-0000-0000-0000-000000005021', 'b0000000-0000-0000-0000-0000000050a0', 1, '12:00', true, 25000, 60),
  ('30000000-0000-0000-0000-000000005030', 'b0000000-0000-0000-0000-0000000050b0', 1, '10:00', true, 25000, 60);

-- La 46, para las puertas con now(): empezó 2 h antes de now() y dura 60 min, en su propia franja construida desde su
-- inicio en Bogotá, porque el trigger de monitoria exige que la fecha caiga en el día de la franja (y la prueba puede
-- correr pasada la medianoche). Su fin + 24 h siempre queda 23 h adelante de now().
insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min)
select '30000000-0000-0000-0000-000000005046', 'b0000000-0000-0000-0000-0000000050a0',
       extract(isodow from t.inicio at time zone 'America/Bogota')::smallint, (t.inicio at time zone 'America/Bogota')::time,
       true, 25000, 60
from (select now() - interval '2 hours' as inicio) t;

-- Monitorías: la franja y la hora de fin de la sesión por caso. valor_total (25.000) no coincide con ninguna cifra.
insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado, motivo_cancelacion, fecha_finalizacion)
select ('50000000-0000-0000-0000-0000000050' || v.nn)::uuid, v.franja::uuid,
       '10000000-0000-0000-0000-000000005001', '40000000-0000-0000-0000-000000005001', v.fecha, 25000,
       v.estado, v.motivo, (v.fecha + v.fin) at time zone 'America/Bogota'
from (values
  ('01', '30000000-0000-0000-0000-000000005020', date '2031-12-01', 'realizada'::public.estado_monitoria, null::public.motivo_cancelacion, time '11:00'),
  ('02', '30000000-0000-0000-0000-000000005020', date '2031-12-29', 'realizada', null, time '11:00'),
  ('03', '30000000-0000-0000-0000-000000005020', date '2031-12-08', 'realizada', null, time '11:00'),
  ('04', '30000000-0000-0000-0000-000000005020', date '2031-12-15', 'realizada', null, time '11:00'),
  ('05', '30000000-0000-0000-0000-000000005020', date '2031-12-22', 'realizada', null, time '11:00'),
  ('06', '30000000-0000-0000-0000-000000005020', date '2031-11-24', 'realizada', null, time '11:00'),
  ('07', '30000000-0000-0000-0000-000000005020', date '2031-11-17', 'realizada', null, time '11:00'),
  ('08', '30000000-0000-0000-0000-000000005020', date '2031-11-10', 'cancelada', 'monitor_no_asistio', time '11:00'),
  ('09', '30000000-0000-0000-0000-000000005020', date '2031-11-03', 'realizada', null, time '11:00'),
  ('10', '30000000-0000-0000-0000-000000005020', date '2031-10-27', 'realizada', null, time '11:00'),
  ('11', '30000000-0000-0000-0000-000000005020', date '2031-10-20', 'cancelada', 'monitor_no_asistio', time '11:00'),
  ('12', '30000000-0000-0000-0000-000000005020', date '2031-10-13', 'realizada', null, time '11:00'),
  ('13', '30000000-0000-0000-0000-000000005020', date '2031-10-06', 'realizada', null, time '11:00'),
  ('14', '30000000-0000-0000-0000-000000005030', date '2031-09-29', 'realizada', null, time '11:00'),
  ('15', '30000000-0000-0000-0000-000000005020', date '2031-09-22', 'realizada', null, time '11:00'),
  ('16', '30000000-0000-0000-0000-000000005021', date '2031-12-29', 'realizada', null, time '13:00'),
  ('17', '30000000-0000-0000-0000-000000005020', date '2031-09-15', 'cancelada', 'monitor_no_asistio', time '11:00'),
  ('41', '30000000-0000-0000-0000-000000005020', date '2020-06-01', 'realizada', null, time '11:00'),
  ('42', '30000000-0000-0000-0000-000000005020', date '2020-06-08', 'realizada', null, time '11:00'),
  ('43', '30000000-0000-0000-0000-000000005020', date '2020-06-15', 'realizada', null, time '11:00'),
  ('44', '30000000-0000-0000-0000-000000005020', date '2020-06-22', 'realizada', null, time '11:00'),
  ('45', '30000000-0000-0000-0000-000000005020', date '2020-06-29', 'realizada', null, time '11:00')
) as v(nn, franja, fecha, estado, motivo, fin);

insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado, fecha_finalizacion)
select '50000000-0000-0000-0000-000000005046', '30000000-0000-0000-0000-000000005046',
       '10000000-0000-0000-0000-000000005001', '40000000-0000-0000-0000-000000005001',
       (t.inicio at time zone 'America/Bogota')::date, 25000, 'realizada', now() - interval '1 hour'
from (select now() - interval '2 hours' as inicio) t;

-- Los pagos: el id es 60000000-...-000000050NNk (k = a, b) y cada uno apunta a su propio comprobante revisado (HU-059).
-- No hace falta el archivo.
create temporary table pago_caso (nn text, k text, monto integer, estado public.estado_pago, observaciones text);
insert into pago_caso values
  ('01', 'a', 37000, 'aprobado', null),
  ('02', 'a', 25000, 'aprobado', null),
  ('03', 'a', 20000, 'aprobado', null), ('03', 'b', 10000, 'en_revision', null),
  ('04', 'a', 25000, 'rechazado', 'Se cobra por fuera (P-24).'),
  ('05', 'a', 20000, 'aprobado', null), ('05', 'b', 10000, 'rechazado', 'Calibra lo asume (P-24).'),
  ('06', 'a', 25000, 'aprobado', null),
  ('07', 'a', 25000, 'aprobado', null),
  ('08', 'a', 25000, 'aprobado', null),
  ('09', 'a', 25000, 'aprobado', null),
  ('11', 'a', 25000, 'aprobado', null),
  ('12', 'a', 25000, 'aprobado', null),
  ('13', 'a', 200000, 'aprobado', null),
  ('14', 'a', 25000, 'aprobado', null),
  ('15', 'a', 25000, 'en_revision', null),
  ('16', 'a', 25000, 'aprobado', null),
  ('17', 'a', 25000, 'aprobado', null),
  ('41', 'a', 25000, 'aprobado', null),
  ('42', 'a', 25000, 'aprobado', null), ('42', 'b', 5000, 'en_revision', null),
  ('43', 'a', 25000, 'rechazado', 'Se cobra por fuera (P-24).'),
  ('44', 'a', 25000, 'aprobado', null),
  ('46', 'a', 25000, 'aprobado', null);

insert into public.comprobante_revisado (ruta, tipo)
select 'c0000000-0000-0000-0000-000000005001/60000000-0000-0000-0000-000000050' || nn || k || '.png', 'image/png'
from pago_caso;

insert into public.pago (id, id_monitoria, monto, nombre_pagador, contacto, estado, fecha_revision, observaciones, id_admin,
                         id_admin_revisor, comprobante)
select ('60000000-0000-0000-0000-000000050' || nn || k)::uuid, ('50000000-0000-0000-0000-0000000050' || nn)::uuid,
       monto, 'Pagador ' || nn || k, 'pagador-' || nn || k || '-hu050@calibra.test', estado,
       case when estado <> 'en_revision' then now() end, observaciones, 'a0000000-0000-0000-0000-0000000050a0',
       case when estado <> 'en_revision' then 'a0000000-0000-0000-0000-0000000050a0'::uuid end,
       'c0000000-0000-0000-0000-000000005001/60000000-0000-0000-0000-000000050' || nn || k || '.png'
from pago_caso;

-- El caso P-24 de la 05 ya lo cerró A como asumido: ese monto cuenta en el bruto (D-39 b). El de la 04 y el de la 43
-- siguen abiertos.
update public.pago
set cierre_rechazo = 'asumido', nota_cierre = 'Lo asume Calibra.', id_admin_cierre = 'a0000000-0000-0000-0000-0000000050a0',
    fecha_cierre = timestamptz '2031-12-23 09:00-05'
where id = '60000000-0000-0000-0000-00000005005b';

-- Los desembolsos: la foto que cada caso necesita. La 09 y la 17 ya se transfirieron (A); la 08 está anulada.
insert into public.desembolso (id, id_monitoria, monto_bruto, comision, monto_neto, llave_destino, estado, id_admin,
                               fecha_desembolso, referencia_transferencia)
select ('70000000-0000-0000-0000-0000000050' || v.nn)::uuid, ('50000000-0000-0000-0000-0000000050' || v.nn)::uuid,
       v.bruto, v.comision, v.bruto - v.comision, v.llave, v.estado, v.id_admin::uuid, v.fecha, v.referencia
from (values
  ('01', 25000, 2500, 'llave-m-50', 'pendiente'::public.estado_desembolso, null, null::timestamptz, null),
  ('02', 25000, 2500, 'llave-m-50', 'pendiente', null, null, null),
  ('03', 25000, 2500, 'llave-m-50', 'pendiente', null, null, null),
  ('04', 25000, 2500, 'llave-m-50', 'pendiente', null, null, null),
  ('05', 25000, 2500, 'llave-m-50', 'pendiente', null, null, null),
  ('06', 25000, 2500, 'llave-m-50', 'pendiente', null, null, null),
  ('07', 25000, 2500, 'llave-m-50', 'pendiente', null, null, null),
  ('08', 25000, 2500, 'llave-m-50', 'anulado', null, timestamptz '2031-11-11 12:00-05', 'REF-OBSOLETA-50-08'),
  ('09', 18000, 1800, 'llave-m-50-anterior', 'desembolsado', 'a0000000-0000-0000-0000-0000000050a0',
   timestamptz '2031-12-30 22:00-05', 'REF-50-09'),
  ('10', 0, 0, 'llave-m-50', 'pendiente', null, null, 'REF-OBSOLETA-50-10'),
  ('11', 25000, 2500, 'llave-m-50', 'pendiente', null, null, null),
  ('12', 0, 0, 'llave-m-50', 'pendiente', null, null, null),
  ('13', 200000, 15000, 'llave-m-50', 'pendiente', null, null, null),
  ('14', 25000, 2500, 'llave-n-50', 'pendiente', null, null, null),
  ('15', 0, 0, 'llave-m-50', 'pendiente', null, null, null),
  ('16', 25000, 2500, 'llave-m-50', 'pendiente', null, null, null),
  ('17', 25000, 2500, 'llave-m-50', 'desembolsado', 'a0000000-0000-0000-0000-0000000050a0',
   timestamptz '2031-09-16 12:00-05', 'REF-50-17'),
  ('41', 25000, 2500, 'llave-m-50', 'pendiente', null, null, null),
  ('42', 25000, 2500, 'llave-m-50', 'pendiente', null, null, null),
  ('43', 25000, 2500, 'llave-m-50', 'pendiente', null, null, null),
  ('44', 25000, 2500, 'llave-m-50', 'pendiente', null, null, null),
  ('45', 0, 0, 'llave-m-50', 'pendiente', null, null, null),
  ('46', 25000, 2500, 'llave-m-50', 'pendiente', null, null, null)
) as v(nn, bruto, comision, llave, estado, id_admin, fecha, referencia);

insert into public.reporte_inasistencia (id_monitoria, id_admin, estado, fecha_decision) values
  ('50000000-0000-0000-0000-000000005006', 'a0000000-0000-0000-0000-0000000050a0', 'en_revision', null),
  ('50000000-0000-0000-0000-000000005007', 'a0000000-0000-0000-0000-0000000050a0', 'rechazado', now()),
  ('50000000-0000-0000-0000-000000005008', 'a0000000-0000-0000-0000-0000000050a0', 'aceptado', now()),
  ('50000000-0000-0000-0000-000000005015', 'a0000000-0000-0000-0000-0000000050a0', 'en_revision', null),
  ('50000000-0000-0000-0000-000000005016', 'a0000000-0000-0000-0000-0000000050a0', 'en_revision', null),
  ('50000000-0000-0000-0000-000000005017', 'a0000000-0000-0000-0000-0000000050a0', 'aceptado', now()),
  ('50000000-0000-0000-0000-000000005044', 'a0000000-0000-0000-0000-0000000050a0', 'en_revision', null);

select is(
  array[(select count(*) from public.monitoria where id::text like '50000000-0000-0000-0000-0000000050%'),
        (select count(*) from public.desembolso where id::text like '70000000-0000-0000-0000-0000000050%'),
        (select count(*) from public.pago where id::text like '60000000-0000-0000-0000-000000050%'),
        (select count(*) from public.reporte_inasistencia where id_monitoria::text like '50000000-0000-0000-0000-0000000050%')],
  array[23::bigint, 23, 24, 7],
  'Control: las 23 monitorías, los 23 desembolsos, los 24 pagos y los 7 reportes existen');
select ok(
  (select desembolsable_desde = timestamptz '2031-12-30 11:00-05'
   from public.monitoria_plazos where id_monitoria = '50000000-0000-0000-0000-000000005002')
  and (select desembolsable_desde = timestamptz '2031-12-30 13:00-05'
       from public.monitoria_plazos where id_monitoria = '50000000-0000-0000-0000-000000005016')
  and (select (fecha_desembolso at time zone 'UTC')::date = date '2031-12-31'
         and (fecha_desembolso at time zone 'America/Bogota')::date = date '2031-12-30'
       from public.desembolso where id = '70000000-0000-0000-0000-000000005009')
  and (select desembolsable_desde - now() = interval '23 hours'
       from public.monitoria_plazos where id_monitoria = '50000000-0000-0000-0000-000000005046'),
  'Control: la 02 se puede transferir después del 30-dic a las 11:00; la 16, a las 13:00; la 09 se transfirió el 31-dic en UTC pero el 30 en Bogotá; el fin + 24 h de la 46 queda 23 h después de now()');

-- ---------------------------------------------------------------------------
-- Criterios 1 y 3 a 10, con ahora = miércoles 31-dic-2031 12:00 en Bogotá: las dieciséis de M, una por una
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000050a0","role":"authenticated"}';
select results_eq(
  $$select right(id_desembolso::text, 2), situacion, desembolsable_desde, monto_bruto, comision, monto_neto, llave_destino,
           referencia_transferencia, fecha_desembolso
    from privado.desembolsos_del_monitor('2031-12-31 12:00-05')
    where right(id_desembolso::text, 2) <= '17'
    order by id_desembolso$$,
  $$values
    ('01'::text, 'listo'::text, null::timestamptz, 37000, 3700, 33300, 'llave-m-50'::text, null::text, null::date),
    ('02', 'listo', null, 25000, 2500, 22500, 'llave-m-50', null, null),
    ('03', 'pago_en_revision', null, 20000, 2000, 18000, 'llave-m-50', null, null),
    ('04', 'pago_rechazado', null, 0, 0, 0, 'llave-m-50', null, null),
    ('05', 'listo', null, 30000, 3000, 27000, 'llave-m-50', null, null),
    ('06', 'en_espera', null, 25000, 2500, 22500, 'llave-m-50', null, null),
    ('07', 'listo', null, 25000, 2500, 22500, 'llave-m-50', null, null),
    ('08', 'anulado', null, null, null, null, null, null, null),
    ('09', 'transferido', null, 18000, 1800, 16200, 'llave-m-50-anterior', 'REF-50-09', date '2031-12-30'),
    ('10', 'en_espera', null, 0, 0, 0, 'llave-m-50', null, null),
    ('11', 'en_espera', null, 25000, 2500, 22500, 'llave-m-50', null, null),
    ('12', 'listo', null, 25000, 2500, 22500, 'llave-m-50', null, null),
    ('13', 'listo', null, 200000, 15000, 185000, 'llave-m-50', null, null),
    ('15', 'en_espera', null, 0, 0, 0, 'llave-m-50', null, null),
    ('16', 'en_espera', null, 25000, 2500, 22500, 'llave-m-50', null, null),
    ('17', 'transferido', null, 25000, 2500, 22500, 'llave-m-50', 'REF-50-17', date '2031-09-16')$$,
  'Las dieciséis de M: 01 y 12 con los montos de hoy y no la foto (P-29); 03 con su pago en revisión sin sumarlo; 04 con el caso P-24 abierto y 05 con el cerrado sumado (D-39); 06, 10, 11 y 15 en_espera sin decir por qué (D-59 b), 08 anulado sin ninguna cifra (P-28), 09 y 17 transferidos con lo guardado, la llave y el día de Bogotá, y la 13 con la comisión en su tope');

-- ---------------------------------------------------------------------------
-- El borde de N-6 y la ventana de reporte (criterio 3)
-- ---------------------------------------------------------------------------
select results_eq(
  $$select v.n, f.situacion, f.desembolsable_desde
    from (values (1, timestamptz '2031-12-30 11:00-05' - interval '1 microsecond'),
                 (2, timestamptz '2031-12-30 11:00-05'),
                 (3, timestamptz '2031-12-30 11:00-05' + interval '1 second')) as v(n, ahora)
    cross join lateral privado.desembolsos_del_monitor(v.ahora) f
    where right(f.id_desembolso::text, 2) = '02'
    order by v.n$$,
  $$values (1, 'en_plazo'::text, timestamptz '2031-12-30 11:00-05'),
           (2, 'en_plazo', timestamptz '2031-12-30 11:00-05'),
           (3, 'listo', null::timestamptz)$$,
  'Criterio 3 (N-6): un microsegundo antes y en el instante exacto de fin + 24 h la 02 sigue en_plazo, con la fecha desde la que se puede transferir; un segundo después, listo y sin fecha');
select results_eq(
  $$select v.n, f.situacion, f.desembolsable_desde
    from (values (1, timestamptz '2031-12-30 12:00-05'), (2, timestamptz '2031-12-31 12:00-05')) as v(n, ahora)
    cross join lateral privado.desembolsos_del_monitor(v.ahora) f
    where right(f.id_desembolso::text, 2) = '16'
    order by v.n$$,
  $$values (1, 'en_plazo'::text, timestamptz '2031-12-30 13:00-05'),
           (2, 'en_espera', null::timestamptz)$$,
  'D-59 b: la 16 tiene un reporte en revisión; dentro de la ventana de reporte dice en_plazo, con la misma frase y la misma fecha que sin reporte, y no revela nada; pasada la ventana, en_espera');
select is(
  (select count(*)::int
   from (values (timestamptz '2031-12-30 11:00-05' - interval '1 microsecond'), (timestamptz '2031-12-30 11:00-05'),
                (timestamptz '2031-12-30 11:00-05' + interval '1 second'), (timestamptz '2031-12-30 12:00-05'),
                (timestamptz '2031-12-31 12:00-05')) as v(ahora)
   cross join lateral privado.desembolsos_del_monitor(v.ahora) f
   where (f.situacion = 'en_plazo') is distinct from (f.desembolsable_desde is not null)),
  0, 'desembolsable_desde viaja en en_plazo y solo en en_plazo; es nulo en toda otra situación');
select is(
  (select count(*)::int
   from (values (timestamptz '2031-12-30 11:00-05' - interval '1 microsecond'), (timestamptz '2031-12-30 11:00-05'),
                (timestamptz '2031-12-30 11:00-05' + interval '1 second'), (timestamptz '2031-12-30 12:00-05'),
                (timestamptz '2031-12-31 12:00-05')) as v(ahora)
   cross join lateral privado.desembolsos_del_monitor(v.ahora) f
   where f.situacion <> all (array['en_plazo', 'listo', 'pago_en_revision', 'pago_rechazado', 'en_espera', 'transferido', 'anulado'])),
  0, 'La situación es un conjunto cerrado de siete valores, con todos los ahora usados en la prueba');
select is(
  (select count(distinct f.situacion)::int
   from (values (timestamptz '2031-12-30 12:00-05'), (timestamptz '2031-12-31 12:00-05')) as v(ahora)
   cross join lateral privado.desembolsos_del_monitor(v.ahora) f),
  7, 'Y los siete valores salen en el elenco');

-- ---------------------------------------------------------------------------
-- Criterio 10: el mismo neto que ve el admin
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int
   from privado.desembolsos_del_monitor('2031-12-31 12:00-05') f
   where right(f.id_desembolso::text, 2) in ('01', '03', '05', '12')
     and f.monto_neto = (select e.monto_neto from privado.estado_para_ejecutar(f.id_desembolso, '2031-12-31 12:00-05') e)),
  4, 'Para la 01, la 03, la 05 y la 12 el monto_neto de la lectura es el que entrega estado_para_ejecutar al admin (P-29)');

-- ---------------------------------------------------------------------------
-- Criterio 2: quién llama
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000050c0","role":"authenticated"}';
select is((select count(*)::int from privado.desembolsos_del_monitor('2031-12-31 12:00-05')), 0,
  'O, un monitor sin desembolsos, recibe una lista vacía');
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000050a0","role":"authenticated"}';
select is((select count(*)::int from privado.desembolsos_del_monitor('2031-12-31 12:00-05')), 0,
  'Un admin recibe una lista vacía: no es el monitor de ninguna monitoría');
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000005001","role":"authenticated","is_anonymous":true}';
select is((select count(*)::int from privado.desembolsos_del_monitor('2031-12-31 12:00-05')), 0,
  'Un Lead (sesión anónima) también');
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000005002","role":"authenticated","is_anonymous":true}';
select is((select count(*)::int from privado.desembolsos_del_monitor('2031-12-31 12:00-05')), 0,
  'Y una sesión anónima que ni siquiera es de un Lead');
set local request.jwt.claims to '{"role":"authenticated"}';
select is((select count(*)::int from privado.desembolsos_del_monitor('2031-12-31 12:00-05')), 0,
  'Un token sin sub: ninguna');
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000050d0","role":"authenticated"}';
select is((select count(*)::int from privado.desembolsos_del_monitor('2031-12-31 12:00-05')), 0,
  'Una sesión con otro sub que M no ve ninguno de los 16 de M (ni los de 2020)');
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000050b0","role":"authenticated"}';
select results_eq(
  $$select right(id_desembolso::text, 2), situacion, monto_neto, llave_destino
    from privado.desembolsos_del_monitor('2031-12-31 12:00-05')$$,
  $$values ('14'::text, 'listo'::text, 22500, 'llave-n-50'::text)$$,
  'N recibe solo el suyo, el 14');
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000050a0","role":"authenticated"}';
select is(
  (select count(*)::int from privado.desembolsos_del_monitor('2031-12-31 12:00-05') where right(id_desembolso::text, 2) = '14'),
  0, 'Y M no recibe el 14');

-- ---------------------------------------------------------------------------
-- Las puertas de la sesión, con la hora real (las de 2020 y la que terminó hace una hora)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000050a0","role":"authenticated"}';
select results_eq(
  $$select right(id_desembolso::text, 2), situacion, monto_neto, desembolsable_desde is not null
    from public.mis_desembolsos()
    where right(id_desembolso::text, 2) in ('41', '42', '43', '44', '45', '46') order by id_desembolso$$,
  $$values ('41'::text, 'listo'::text, 22500, false),
           ('42', 'pago_en_revision', 22500, false),
           ('43', 'pago_rechazado', 0, false),
           ('44', 'en_espera', 22500, false),
           ('45', 'en_espera', 0, false),
           ('46', 'en_plazo', 22500, true)$$,
  'Por la puerta, con now(): la de 2020 con un pago aprobado está lista; las otras de 2020, cada una con lo que la retiene; la 46, que terminó hace una hora, en_plazo y con su fecha');
select is(
  (select desembolsable_desde - now() from public.mis_desembolsos() where right(id_desembolso::text, 2) = '46'),
  interval '23 hours', 'La puerta pasa la hora real: la 46 se puede transferir 23 horas después de now() (fin + 24 h)');
select is(
  (select count(*)::int from privado.mis_desembolsos_de_la_sesion()), 22,
  'La entrada de la sesión también (la ejecuta authenticated): los 22 de M, ninguno de N');
create temporary table puerta_m as select * from public.mis_desembolsos();
reset role;
select is_empty(
  $$select * from puerta_m except select * from privado.desembolsos_del_monitor(now())$$,
  'Lo que entrega la puerta está en la lectura con now()');
select is_empty(
  $$select * from privado.desembolsos_del_monitor(now()) except select * from puerta_m$$,
  'Y la lectura con now() no trae nada más: la puerta pasa la hora real y no recorta ni agrega');

-- Criterio 4: los listo coinciden con la bandeja del admin. Los de 2020 y la reciente no se mezclan con los de 2031: la vista
-- usa now(), y las sesiones del elenco son de 2031.
select results_eq(
  $$select id_desembolso from privado.desembolsos_del_monitor(now())
    where id_desembolso::text like '70000000-0000-0000-0000-00000000504_' and situacion = 'listo'$$,
  $$values ('70000000-0000-0000-0000-000000005041'::uuid)$$,
  'Criterio 4: con now(), de las seis de la bandeja solo la 41 está lista; no lo están la del pago en revisión, la del caso P-24 abierto, la del reporte en revisión, la sin pagos ni la que terminó hace una hora');
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000050a0","role":"authenticated"}';
select results_eq(
  $$select id from public.desembolsos_ejecutables where id::text like '70000000-0000-0000-0000-00000000504_'$$,
  $$values ('70000000-0000-0000-0000-000000005041'::uuid)$$,
  'Y es la misma que lista la bandeja de desembolsos ejecutables del admin, con su token');
reset role;

-- ---------------------------------------------------------------------------
-- G1 (D-59): ninguna otra función, vista ni tabla entrega la comisión a una sesión
-- ---------------------------------------------------------------------------
select set_eq(
  $$select ns.nspname || '.' || p.proname
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace and ns.nspname in ('public', 'privado'),
         unnest(p.proargnames, p.proargmodes) as a(n, m)
    where a.m in ('t', 'o', 'b') and a.n ~* '(comision|bruto)'
      and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))$$,
  $$values ('public.mis_desembolsos'), ('privado.mis_desembolsos_de_la_sesion')$$,
  'G1.1: las únicas funciones de public y privado con una columna de salida de comisión o bruto que una sesión puede ejecutar son la puerta y su entrada de sesión');
select set_eq(
  $$select ns.nspname || '.' || p.proname
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace and ns.nspname in ('public', 'privado')
    where (p.proname ~* '(comisi|bruto)' or p.prorettype = 'public.desembolso'::regtype)
      and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))$$,
  $$select null::text where false$$,
  'G1.2: ninguna función que una sesión pueda ejecutar se llama comisión o bruto ni devuelve el tipo de la tabla desembolso (que arrastraría todas sus columnas)');
select set_eq(
  $$select distinct ns.nspname || '.' || c.relname
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace and ns.nspname in ('public', 'privado')
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where c.relkind in ('r', 'v', 'm', 'p') and a.attname ~* '(comision|bruto)'
      and (has_column_privilege('authenticated', c.oid, a.attnum, 'select')
           or has_column_privilege('anon', c.oid, a.attnum, 'select'))$$,
  $$values ('public.desembolso')$$,
  'G1.3: la única tabla o vista con una columna de comisión o bruto que una sesión puede leer es desembolso, que por su política solo lee un admin y de la que anon no lee nada');
select ok(
  not has_function_privilege('authenticated', 'public.comision(integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.monto_neto(integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.parametros_comision()', 'execute')
  and not has_function_privilege('authenticated', 'privado.calcular_desembolso(uuid)', 'execute')
  and not has_function_privilege('anon', 'privado.calcular_desembolso(uuid)', 'execute'),
  'N-2: authenticated no ejecuta la comisión, el neto, sus parámetros ni privado.calcular_desembolso: la comisión solo la calcula el servidor');

-- G1.4: la tabla sigue cerrada. Una política le dejaría leer al monitor el bruto, la comisión, la llave y el admin de la fila.
set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000050a0","role":"authenticated"}';
select is((select count(*)::int from public.desembolso), 0,
  'G1.4: M, que tiene desembolsos, no lee ninguna fila de public.desembolso: la tabla sigue cerrada');
select is((select count(*)::int from public.estado_para_ejecutar('70000000-0000-0000-0000-000000005001')), 0,
  'Ni el neto de uno suyo por la puerta del admin');
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000050a0","role":"authenticated"}';
select ok((select count(*) >= 23 from public.desembolso), 'Un admin sí lee public.desembolso');
reset role;
select set_eq(
  $$select policyname || ':' || cmd from pg_policies where schemaname = 'public' and tablename = 'desembolso'$$,
  $$values ('admin lee:SELECT')$$,
  'G1.4: la única política de public.desembolso sigue siendo la de «admin lee»');
select ok(
  not has_table_privilege('anon', 'public.desembolso', 'select')
  and not has_any_column_privilege('authenticated', 'public.desembolso', 'insert')
  and not has_any_column_privilege('authenticated', 'public.desembolso', 'update')
  and not has_table_privilege('authenticated', 'public.desembolso', 'delete'),
  'Y anon no lee la tabla ni nadie con sesión la escribe');

-- ---------------------------------------------------------------------------
-- Lo último: las dos redefiniciones, que siguen vigentes hasta el rollback del archivo
-- ---------------------------------------------------------------------------
-- El greatest: public.reporte_inasistencia_hasta vale fin + 48 h (misma firma y opciones que en
-- 20260929054533_plazos_y_comision.sql). La 02, con ahora entre +24 h y +48 h, sigue en_plazo y desembolsable_desde es
-- fin + 48 h. Sin el greatest daría fin + 24 h (el martes 30 a las 11:00), una fecha que ya pasó.
create or replace function public.reporte_inasistencia_hasta(p_fin_programado timestamptz)
returns timestamptz
language sql
stable
strict
parallel safe
set search_path = ''
as $$
  select p_fin_programado + interval '48 hours';
$$;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000050a0","role":"authenticated"}';
select results_eq(
  $$select v.n, f.situacion, f.desembolsable_desde
    from (values (1, timestamptz '2031-12-30 12:00-05'), (2, timestamptz '2031-12-31 11:00-05'),
                 (3, timestamptz '2031-12-31 11:00-05' + interval '1 second')) as v(n, ahora)
    cross join lateral privado.desembolsos_del_monitor(v.ahora) f
    where right(f.id_desembolso::text, 2) = '02'
    order by v.n$$,
  $$values (1, 'en_plazo'::text, timestamptz '2031-12-31 11:00-05'),
           (2, 'en_plazo', timestamptz '2031-12-31 11:00-05'),
           (3, 'listo', null::timestamptz)$$,
  'Si la ventana de reporte durara 48 h, la 02 diría en_plazo con el fin + 48 h (la posterior de las dos fechas), aunque el fin + 24 h ya haya pasado');

-- Sin fila no hay listo: si estado_para_ejecutar no devolviera ninguna fila, la lectura no inventa un listo por cada
-- desembolso pendiente (con un left join, un motivo nulo por falta de fila se leería como «se puede ejecutar»).
create or replace function privado.estado_para_ejecutar(p_id_desembolso uuid, p_ahora timestamptz)
returns table (motivo text, monto_neto integer)
language sql
stable
security definer
set search_path = ''
as $$
  select null::text, null::integer where false;
$$;
select is((select count(*)::int from privado.desembolsos_del_monitor('2031-12-31 12:00-05')), 0,
  'Sin fila de estado_para_ejecutar no hay listo: la lectura no devuelve ningún desembolso, en vez de mentir');

select * from finish();
rollback;
