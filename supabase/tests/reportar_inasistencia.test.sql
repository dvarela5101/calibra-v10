-- Pruebas pgTAP de reportar que el monitor no asistió y de las observaciones del reporte en la cita (HU-029, RN-62 a RN-65,
-- RN-83, P-04, P-40, D-37).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.
--
-- Qué cubre la migración 20261003202252_reportar_inasistencia.sql:
--   * privado.reportar_inasistencia(id, ahora): los ocho resultados (no_existe, no_individual, ya_reportada, no_reportable,
--     aun_no_empieza, fuera_de_ventana, sin_admin, reportada), el orden de las comprobaciones, los bordes de la ventana con
--     p_ahora (con el inicio exacto y con fin + 24 h exactas todavía se puede, P-40), la fila creada (en_revision, asignada
--     al primer admin activo, con la hora que se le pasó) y todo lo que NO toca: la monitoría, el pago, el reembolso y el
--     desembolso. Con el pago rechazado o en revisión también se puede reportar (RN-62 no mira el pago).
--   * Las dos puertas: public.reportar_inasistencia_por_token (service_role) y public.reportar_inasistencia_de_mi_cita (la
--     sesión del Lead, por privado.es_mi_lead), con sus permisos por rol. Las puertas usan now(): sus monitorías empiezan
--     hace 2 horas en Bogotá.
--   * RN-83: public.desembolsos_ejecutables excluye el desembolso de una monitoría con un reporte en revisión o aceptado y
--     lo vuelve a listar si el reporte se rechaza; privado.estado_para_ejecutar (HU-028) responde con_reporte. Las
--     monitorías de RN-83 tienen un pago aprobado, que la vista de HU-028 exige para listar un desembolso.
--   * D-37: la columna observaciones_reporte en cita_por_token, mi_cita y mis_citas (y en privado.datos_de_cita).
--   * La restricción reporte_observaciones_con_texto.
-- Las monitorías se insertan como postgres. Las del núcleo caen en lunes de 2030 (en el futuro: ningún trabajo de pg_cron las
-- toca; las pruebas con hora fija usan p_ahora). Las de RN-83 son de enero de 2020 (la ventana ya venció).
--
-- El turno de admins recorre a TODOS los admins de la base: los que ya existían se banean dentro de la transacción y los de esta
-- prueba llevan un orden_revision negativo, por delante de cualquier otro (A antes que B), como en cancelar_cita.test.sql.
--
-- Elenco (ids terminados en 29NN; la materia es 'PGTAP-29'):
--   Admins A y B, monitor M (con contacto en monitor_privado). Sesiones: c1 (Lead 01, Lucía), c2 (Lead 02, Mateo), c3
--   (anónima sin Lead), c4 (confirmó el correo del Lead 01, HU-068), c5 (cuenta de Estudiante del Lead 01).
--   Núcleo (franja de los lunes a las 9:30, virtual de 60 min):
--     01 aun_no_empieza con el inicio menos 1 s y reportada con el inicio exacto   02 reportada en curso   03 por pagar
--     04 realizada, reportada   05 cancelada por monitor_no_asistio con el reporte aceptado   06 reportada ya terminada
--     07 cancelada por el estudiante   08 grupal   09 reportada con fin + 24 h exactas   10 fuera de la ventana por 1 s
--     11 a 13 con reporte en revisión, rechazado y aceptado   14 sin admin activo   15 con el pago rechazado   16 con el pago en
--     revisión   17 dos llamadas seguidas   18 con pago, reembolso y desembolso (nada de eso cambia)   19 con p_ahora nulo
--     20 con el admin A desactivado.
--   Puertas (empiezan hace 2 h, salvo 28 y 29): 21 y 22 con token (Lead 01 y Lead 02)   23 la reporta su dueño   24 las que
--   no pueden   25 la sesión de lead_sesion   26 la cuenta de Estudiante   27 ya reportada   28 todavía no empieza   29 de
--   hace 30 h (ventana vencida).
--   RN-83: 30 (el desembolso existe antes del reporte) y 31 (el reporte existe antes del desembolso), de 2020, cada una con
--   un pago aprobado.
--   D-37 (Lead 02, con token): 40 sin reporte, 41 en revisión con texto, 42 rechazado con texto, 43 aceptado con texto, 44
--   rechazado sin texto.

begin;
create extension if not exists pgtap with schema extensions;

select plan(114);

-- ---------------------------------------------------------------------------
-- Existencia, permisos y forma de las seis funciones nuevas
-- ---------------------------------------------------------------------------
select ok(
  to_regprocedure('privado.reportar_inasistencia(uuid,timestamptz)') is not null
  and to_regprocedure('privado.reportar_inasistencia_por_token(text)') is not null
  and to_regprocedure('privado.reportar_inasistencia_de_mi_cita(uuid)') is not null
  and to_regprocedure('public.reportar_inasistencia_por_token(text)') is not null
  and to_regprocedure('public.reportar_inasistencia_de_mi_cita(uuid)') is not null,
  'Existen el corazón y las dos puertas, cada una en privado y en public (el corazón solo en privado)');
select ok(
  not exists (
    select 1
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid in ('privado.reportar_inasistencia(uuid,timestamptz)'::regprocedure,
                    'privado.reportar_inasistencia_por_token(text)'::regprocedure,
                    'privado.reportar_inasistencia_de_mi_cita(uuid)'::regprocedure,
                    'public.reportar_inasistencia_por_token(text)'::regprocedure,
                    'public.reportar_inasistencia_de_mi_cita(uuid)'::regprocedure)
      and a.grantee = 0),
  'Nadie las hereda de PUBLIC');
select ok(
  not has_function_privilege('anon', 'privado.reportar_inasistencia(uuid,timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'privado.reportar_inasistencia(uuid,timestamptz)', 'execute')
  and not has_function_privilege('service_role', 'privado.reportar_inasistencia(uuid,timestamptz)', 'execute'),
  'El corazón no lo ejecuta ningún rol: solo las puertas (el mismo dueño), con la hora de la base');
select ok(
  has_function_privilege('service_role', 'public.reportar_inasistencia_por_token(text)', 'execute')
  and has_function_privilege('service_role', 'privado.reportar_inasistencia_por_token(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.reportar_inasistencia_por_token(text)', 'execute')
  and not has_function_privilege('authenticated', 'privado.reportar_inasistencia_por_token(text)', 'execute')
  and not has_function_privilege('anon', 'public.reportar_inasistencia_por_token(text)', 'execute')
  and not has_function_privilege('anon', 'privado.reportar_inasistencia_por_token(text)', 'execute'),
  'La puerta por token (y su de privado) solo la ejecuta service_role: ni anon ni una sesión (si no, adivinar tokens sería cosa de cualquiera)');
select ok(
  has_function_privilege('authenticated', 'public.reportar_inasistencia_de_mi_cita(uuid)', 'execute')
  and has_function_privilege('authenticated', 'privado.reportar_inasistencia_de_mi_cita(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.reportar_inasistencia_de_mi_cita(uuid)', 'execute')
  and not has_function_privilege('anon', 'privado.reportar_inasistencia_de_mi_cita(uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.reportar_inasistencia_de_mi_cita(uuid)', 'execute')
  and not has_function_privilege('service_role', 'privado.reportar_inasistencia_de_mi_cita(uuid)', 'execute'),
  'La puerta de sesión (y su de privado) solo la ejecuta authenticated (la anónima del Lead lo es): ni anon ni service_role, que no tiene sesión');
select ok(
  (select bool_and(p.prosecdef) from pg_proc p
   where p.oid in ('privado.reportar_inasistencia(uuid,timestamptz)'::regprocedure,
                   'privado.reportar_inasistencia_por_token(text)'::regprocedure,
                   'privado.reportar_inasistencia_de_mi_cita(uuid)'::regprocedure))
  and not (select bool_or(p.prosecdef) from pg_proc p
           where p.oid in ('public.reportar_inasistencia_por_token(text)'::regprocedure,
                           'public.reportar_inasistencia_de_mi_cita(uuid)'::regprocedure)),
  'Las tres de privado son security definer y las dos de public, security invoker');
select ok(
  (select bool_and(coalesce(p.proconfig, array[]::text[]) @> array['search_path=""'])
   from pg_proc p
   where p.oid in ('privado.reportar_inasistencia(uuid,timestamptz)'::regprocedure,
                   'privado.reportar_inasistencia_por_token(text)'::regprocedure,
                   'privado.reportar_inasistencia_de_mi_cita(uuid)'::regprocedure,
                   'public.reportar_inasistencia_por_token(text)'::regprocedure,
                   'public.reportar_inasistencia_de_mi_cita(uuid)'::regprocedure)),
  'Las cinco fijan un search_path vacío');
select is(
  (select array_agg(pg_get_function_result(p.oid) || ':' || p.provolatile::text order by p.oid::regprocedure::text)
   from pg_proc p
   where p.oid in ('privado.reportar_inasistencia(uuid,timestamptz)'::regprocedure,
                   'privado.reportar_inasistencia_por_token(text)'::regprocedure,
                   'privado.reportar_inasistencia_de_mi_cita(uuid)'::regprocedure,
                   'public.reportar_inasistencia_por_token(text)'::regprocedure,
                   'public.reportar_inasistencia_de_mi_cita(uuid)'::regprocedure)),
  array['text:v', 'text:v', 'text:v', 'text:v', 'text:v'],
  'Las cinco devuelven text y son volátiles (escriben)');
select ok(
  obj_description('public.reportar_inasistencia_por_token(text)'::regprocedure, 'pg_proc') is not null
  and obj_description('public.reportar_inasistencia_de_mi_cita(uuid)'::regprocedure, 'pg_proc') is not null,
  'Las dos puertas de public tienen comentario');

-- Columnas de salida de las seis funciones de la cita (D-37): la nueva va al final.
select is(
  (select array_agg(a.n order by a.o)
   from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as a(n, m, o)
   where p.oid = 'public.cita_por_token(text)'::regprocedure and a.m = 't'),
  array['id_monitoria', 'estado', 'motivo_cancelacion', 'nombre_monitor', 'nombre_materia', 'codigo_materia', 'fecha', 'hora',
        'duracion_min', 'presencial', 'valor_total', 'lugar', 'enlace', 'inicio', 'fin_programado', 'cancelable_hasta',
        'reporte_hasta', 'estado_pago', 'estado_reembolso', 'estado_reporte', 'observaciones_reporte'],
  'cita_por_token termina en estado_reporte y observaciones_reporte (21 columnas)');
select is(
  (select count(*)::int from pg_proc p, unnest(p.proargnames, p.proargmodes) as a(n, m)
   where p.oid = 'privado.datos_de_cita(uuid)'::regprocedure and a.m = 't'),
  22, 'privado.datos_de_cita devuelve 22 columnas: el id del Lead y las 21 de la cita');
select ok(
  (select array_agg(a.n order by a.o)
   from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as a(n, m, o)
   where p.oid = 'public.mi_cita(uuid)'::regprocedure and a.m = 't')
  = (select array_agg(a.n order by a.o)
     from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as a(n, m, o)
     where p.oid = 'public.cita_por_token(text)'::regprocedure and a.m = 't')
  and (select array_agg(a.n order by a.o)
       from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as a(n, m, o)
       where p.oid = 'public.mis_citas()'::regprocedure and a.m = 't')
  = (select array_agg(a.n order by a.o)
     from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as a(n, m, o)
     where p.oid = 'public.cita_por_token(text)'::regprocedure and a.m = 't'),
  'mi_cita y mis_citas devuelven exactamente las mismas columnas que cita_por_token');
-- Después de recrearlas, los permisos son los de HU-019 (borrar una función borra sus permisos).
select ok(
  has_function_privilege('service_role', 'public.cita_por_token(text)', 'execute')
  and has_function_privilege('service_role', 'privado.datos_de_cita(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.cita_por_token(text)', 'execute')
  and not has_function_privilege('authenticated', 'privado.datos_de_cita(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.cita_por_token(text)', 'execute')
  and not has_function_privilege('anon', 'privado.datos_de_cita(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.mi_cita(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.mis_citas()', 'execute')
  and has_function_privilege('authenticated', 'privado.mi_cita(uuid)', 'execute')
  and has_function_privilege('authenticated', 'privado.mis_citas()', 'execute')
  and not has_function_privilege('anon', 'public.mi_cita(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.mis_citas()', 'execute')
  and not has_function_privilege('service_role', 'public.mi_cita(uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.mis_citas()', 'execute')
  and not has_function_privilege('service_role', 'privado.mi_cita(uuid)', 'execute')
  and not has_function_privilege('service_role', 'privado.mis_citas()', 'execute'),
  'Las seis recreadas conservan sus permisos: cita_por_token y datos_de_cita solo service_role; mi_cita y mis_citas solo authenticated');
select ok(
  not exists (
    select 1
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid in ('privado.datos_de_cita(uuid)'::regprocedure, 'privado.mi_cita(uuid)'::regprocedure,
                    'privado.mis_citas()'::regprocedure, 'public.cita_por_token(text)'::regprocedure,
                    'public.mi_cita(uuid)'::regprocedure, 'public.mis_citas()'::regprocedure)
      and a.grantee = 0),
  'Y ninguna de las seis la hereda de PUBLIC');
select ok(
  obj_description('public.cita_por_token(text)'::regprocedure, 'pg_proc') is not null
  and obj_description('public.mi_cita(uuid)'::regprocedure, 'pg_proc') is not null
  and obj_description('public.mis_citas()'::regprocedure, 'pg_proc') is not null
  and obj_description('privado.datos_de_cita(uuid)'::regprocedure, 'pg_proc') is not null,
  'Los comentarios de la cita sobreviven a recrearla');
select ok(
  (select bool_and(coalesce(p.proconfig, array[]::text[]) @> array['search_path=""'])
   from pg_proc p
   where p.oid in ('privado.datos_de_cita(uuid)'::regprocedure, 'privado.mi_cita(uuid)'::regprocedure,
                   'privado.mis_citas()'::regprocedure, 'public.cita_por_token(text)'::regprocedure,
                   'public.mi_cita(uuid)'::regprocedure, 'public.mis_citas()'::regprocedure)),
  'Las seis fijan un search_path vacío');

-- La restricción de las observaciones existe.
select ok(
  exists (select 1 from pg_constraint
          where conrelid = 'public.reporte_inasistencia'::regclass and conname = 'reporte_observaciones_con_texto' and contype = 'c'),
  'Existe la restricción reporte_observaciones_con_texto en reporte_inasistencia');

-- ---------------------------------------------------------------------------
-- Fixtures (como postgres)
-- ---------------------------------------------------------------------------
-- La prueba no depende de lo que haya en Vault: sin los secretos de la app, confirmar una cita no pide nada a pg_net.
delete from vault.secrets where name in ('calibra_sitio_url', 'calibra_cron_secreto');

-- Cualquier admin que ya existiera queda inactivo durante la prueba.
update auth.users set banned_until = 'infinity' where id in (select id from public.admin);

insert into auth.users (id, is_anonymous) values
  ('a0000000-0000-0000-0000-0000000029a0', false),
  ('a0000000-0000-0000-0000-0000000029b0', false),
  ('b0000000-0000-0000-0000-000000002901', false),
  ('c0000000-0000-0000-0000-000000002901', true),
  ('c0000000-0000-0000-0000-000000002902', true),
  ('c0000000-0000-0000-0000-000000002903', true),
  ('c0000000-0000-0000-0000-000000002904', true),
  ('c0000000-0000-0000-0000-000000002905', false);

insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-0000000029a0', 'Admin A', 'admin-a-hu029@calibra.test', -2900),
  ('a0000000-0000-0000-0000-0000000029b0', 'Admin B', 'admin-b-hu029@calibra.test', -2899);
insert into public.monitor (id, nombre) values ('b0000000-0000-0000-0000-000000002901', 'Ana 29');
insert into public.monitor_privado (id_monitor, numero_telefono, correo, llave) values
  ('b0000000-0000-0000-0000-000000002901', '3002900001', 'ana.monitora29@calibra.test', 'llave-ana-29');
insert into public.materia (id, nombre, codigo) values ('10000000-0000-0000-0000-000000002901', 'Materia 29', 'PGTAP-29');
insert into public.certificado (id_monitor, id_materia, id_admin) values
  ('b0000000-0000-0000-0000-000000002901', '10000000-0000-0000-0000-000000002901', 'a0000000-0000-0000-0000-0000000029a0');
insert into public.lead (id, id_sesion_anonima, nombre, numero_telefono, correo, acepta_tratamiento_datos, fecha_consentimiento) values
  ('40000000-0000-0000-0000-000000002901', 'c0000000-0000-0000-0000-000000002901', 'Lucía Prueba 29', '3002911111',
   'lucia.secreta29@calibra.test', true, now()),
  ('40000000-0000-0000-0000-000000002902', 'c0000000-0000-0000-0000-000000002902', 'Mateo Prueba 29', '3002922222',
   'mateo.secreto29@calibra.test', true, now());
-- La sesión 4 confirmó el correo del Lead 01 desde otro dispositivo (HU-068); la 5 es la cuenta de Estudiante del Lead 01.
insert into public.lead_sesion (id_sesion, id_lead) values
  ('c0000000-0000-0000-0000-000000002904', '40000000-0000-0000-0000-000000002901');
insert into public.estudiante (id, id_lead) values
  ('c0000000-0000-0000-0000-000000002905', '40000000-0000-0000-0000-000000002901');

-- aislar(): vuelve a desactivar a cualquier admin que no sea de la prueba (otras pruebas pueden crear admins mientras corre).
create procedure pg_temp.aislar()
language sql security definer set search_path = ''
as $$
  update auth.users set banned_until = 'infinity'
  where id in (select id from public.admin
               where id not in ('a0000000-0000-0000-0000-0000000029a0', 'a0000000-0000-0000-0000-0000000029b0'))
    and (banned_until is null or banned_until <= now());
$$;
call pg_temp.aislar();

-- Franjas: las del núcleo, de RN-83 y de D-37, todas los lunes a las 9:30 en Bogotá, virtuales de 60 min.
insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min, lugar, enlace, abierta_desde)
select ('30000000-0000-0000-0000-0000000029' || nn)::uuid, 'b0000000-0000-0000-0000-000000002901'::uuid, smallint '1',
       time '09:30', false, 20000, 60, null, 'https://meet.example/29-' || nn, date '2019-01-01'
from unnest(array['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18',
                  '19', '20', '30', '31', '40', '41', '42', '43', '44']) as nn;

-- Franjas de las puertas, que usan now(): la hora de inicio es la de hace 2 horas en Bogotá (28: dentro de 2 horas; 29: hace
-- 30 horas), con el día de la semana y la hora que le corresponden.
create temporary table inicio_29 (nn text primary key, inicio timestamptz not null);
insert into inicio_29 (nn, inicio) values
  ('21', date_trunc('minute', now() - interval '2 hours')), ('22', date_trunc('minute', now() - interval '2 hours')),
  ('23', date_trunc('minute', now() - interval '2 hours')), ('24', date_trunc('minute', now() - interval '2 hours')),
  ('25', date_trunc('minute', now() - interval '2 hours')), ('26', date_trunc('minute', now() - interval '2 hours')),
  ('27', date_trunc('minute', now() - interval '2 hours')),
  ('28', date_trunc('minute', now() + interval '2 hours')), ('29', date_trunc('minute', now() - interval '30 hours'));
insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min, lugar, enlace, abierta_desde)
select ('30000000-0000-0000-0000-0000000029' || nn)::uuid, 'b0000000-0000-0000-0000-000000002901'::uuid,
       extract(isodow from (inicio at time zone 'America/Bogota')::date)::smallint,
       (inicio at time zone 'America/Bogota')::time, false, 20000, 60, null, 'https://meet.example/29-' || nn, date '2019-01-01'
from inicio_29;

-- Monitorías. Las del núcleo, de D-37 y de RN-83: lunes (2030 y 2020). Las que llevan token (21, 22 y 40 a 44) se crean por pagar
-- y se confirman con un UPDATE: el trigger de HU-019 anota el token.
insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado, motivo_cancelacion, fecha_finalizacion)
select ('50000000-0000-0000-0000-0000000029' || v.nn)::uuid, ('30000000-0000-0000-0000-0000000029' || v.nn)::uuid,
       '10000000-0000-0000-0000-000000002901'::uuid, ('40000000-0000-0000-0000-0000000029' || v.lead)::uuid,
       case when v.nn in ('30', '31') then date '2020-01-06' + 7 * (v.nn::int - 30)
            else date '2030-03-04' + 7 * (v.nn::int - 1) end,
       20000, v.estado, v.motivo, v.finalizada
from (values
  ('01', '01', 'confirmada'::public.estado_monitoria, null::public.motivo_cancelacion, null::timestamptz),
  ('02', '01', 'confirmada', null, null),
  ('03', '01', 'pendiente_pago', null, null),
  ('04', '01', 'realizada', null, timestamptz '2030-03-25 11:00-05'),
  ('05', '01', 'cancelada', 'monitor_no_asistio', null),
  ('06', '01', 'confirmada', null, null),
  ('07', '01', 'cancelada', 'estudiante', null),
  ('08', '01', 'confirmada', null, null),
  ('09', '01', 'confirmada', null, null),
  ('10', '01', 'confirmada', null, null),
  ('11', '01', 'confirmada', null, null),
  ('12', '01', 'confirmada', null, null),
  ('13', '01', 'confirmada', null, null),
  ('14', '01', 'confirmada', null, null),
  ('15', '01', 'confirmada', null, null),
  ('16', '01', 'confirmada', null, null),
  ('17', '01', 'confirmada', null, null),
  ('18', '01', 'confirmada', null, null),
  ('19', '01', 'confirmada', null, null),
  ('20', '01', 'confirmada', null, null),
  ('30', '01', 'realizada', null, timestamptz '2020-01-06 11:00-05'),
  ('31', '01', 'realizada', null, timestamptz '2020-01-13 11:00-05'),
  ('40', '02', 'pendiente_pago', null, null),
  ('41', '02', 'pendiente_pago', null, null),
  ('42', '02', 'pendiente_pago', null, null),
  ('43', '02', 'pendiente_pago', null, null),
  ('44', '02', 'pendiente_pago', null, null)) as v(nn, lead, estado, motivo, finalizada);
-- Las de las puertas: la fecha es la del inicio en Bogotá.
insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado)
select ('50000000-0000-0000-0000-0000000029' || i.nn)::uuid, ('30000000-0000-0000-0000-0000000029' || i.nn)::uuid,
       '10000000-0000-0000-0000-000000002901'::uuid,
       ('40000000-0000-0000-0000-0000000029' || case when i.nn = '22' then '02' else '01' end)::uuid,
       (i.inicio at time zone 'America/Bogota')::date, 20000,
       case when i.nn in ('21', '22') then 'pendiente_pago'::public.estado_monitoria else 'confirmada' end
from inicio_29 i;
update public.monitoria set estado = 'confirmada'
where id in ('50000000-0000-0000-0000-000000002921', '50000000-0000-0000-0000-000000002922',
             '50000000-0000-0000-0000-000000002940', '50000000-0000-0000-0000-000000002941',
             '50000000-0000-0000-0000-000000002942', '50000000-0000-0000-0000-000000002943',
             '50000000-0000-0000-0000-000000002944');

-- La grupal: la 08.
insert into public.monitoria_grupal (id_monitoria, cupos, modalidad_pago, precio_por_persona) values
  ('50000000-0000-0000-0000-000000002908', 3, 'dividido', 15000);

-- Los pagos de la 15 (rechazado), la 16 (en revisión) y la 18 (aprobado, con su reembolso). Los de la 30 y la 31
-- (aprobados, de 2020): sin un pago aprobado la vista de HU-028 nunca lista el desembolso (sin_pagos_aprobados), y las
-- pruebas de RN-83 pasarían sin que el reporte tuviera nada que ver.
create temporary table pago_29 (id text primary key, nn text not null, estado public.estado_pago not null);
insert into pago_29 (id, nn, estado) values ('1501', '15', 'rechazado'), ('1601', '16', 'en_revision'), ('1801', '18', 'aprobado'),
  ('3001', '30', 'aprobado'), ('3101', '31', 'aprobado');
insert into public.comprobante_revisado (ruta, tipo)
select 'c0000000-0000-0000-0000-000000002901/60000000-0000-0000-0000-00000000' || id || '.pdf', 'application/pdf' from pago_29;
insert into public.pago (id, id_monitoria, monto, nombre_pagador, contacto, estado, id_admin, fecha_pago, fecha_revision, comprobante)
select ('60000000-0000-0000-0000-00000000' || id)::uuid, ('50000000-0000-0000-0000-0000000029' || nn)::uuid, 20000,
       'Pagador Secreto 29', 'pagador.secreto29@example.com', estado, 'a0000000-0000-0000-0000-0000000029a0',
       case when nn in ('30', '31') then timestamptz '2020-01-01 10:00-05' else timestamptz '2030-02-01 10:00-05' end,
       case when estado = 'en_revision' then null else now() end,
       'c0000000-0000-0000-0000-000000002901/60000000-0000-0000-0000-00000000' || id || '.pdf'
from pago_29;
insert into public.reembolso (id_pago, id_admin, monto, motivo, llave_destino, estado) values
  ('60000000-0000-0000-0000-000000001801', 'a0000000-0000-0000-0000-0000000029a0', 20000, 'Prueba', 'llave-reembolso-29', 'pendiente');
-- Un desembolso pendiente de la 18: el reporte no lo toca.
insert into public.desembolso (id_monitoria, monto_bruto, comision, monto_neto, llave_destino, estado) values
  ('50000000-0000-0000-0000-000000002918', 20000, 2000, 18000, 'llave-ana-29', 'pendiente');

-- Los reportes que ya existen: de la 05 (aceptado), la 11 (en revisión), la 12 (rechazado), la 13 (aceptado), la 27 (en
-- revisión) y los de D-37 (41 a 44), con su texto.
insert into public.reporte_inasistencia (id_monitoria, id_admin, estado, fecha_decision, observaciones) values
  ('50000000-0000-0000-0000-000000002905', 'a0000000-0000-0000-0000-0000000029a0', 'aceptado', now(), null),
  ('50000000-0000-0000-0000-000000002911', 'a0000000-0000-0000-0000-0000000029a0', 'en_revision', null, null),
  ('50000000-0000-0000-0000-000000002912', 'a0000000-0000-0000-0000-0000000029a0', 'rechazado', now(), null),
  ('50000000-0000-0000-0000-000000002913', 'a0000000-0000-0000-0000-0000000029a0', 'aceptado', now(), null),
  ('50000000-0000-0000-0000-000000002927', 'a0000000-0000-0000-0000-0000000029a0', 'en_revision', null, null),
  ('50000000-0000-0000-0000-000000002941', 'a0000000-0000-0000-0000-0000000029a0', 'en_revision', null, 'Texto que aún no se debe ver'),
  ('50000000-0000-0000-0000-000000002942', 'a0000000-0000-0000-0000-0000000029a0', 'rechazado', now(), '  No pudimos comprobar la inasistencia.  '),
  ('50000000-0000-0000-0000-000000002943', 'a0000000-0000-0000-0000-0000000029a0', 'aceptado', now(), E'  Lo confirmó el monitor.\n'),
  ('50000000-0000-0000-0000-000000002944', 'a0000000-0000-0000-0000-0000000029a0', 'rechazado', now(), null);

-- Ayudas de la prueba (solo como postgres): el inicio y el fin de cada monitoría y el corazón con su hora.
create function pg_temp.inicio_de(p_nn text) returns timestamptz
language sql stable as $$
  select public.inicio_sesion(m.fecha, f.hora)
  from public.monitoria m join public.franja f on f.id = m.id_franja
  where m.id = ('50000000-0000-0000-0000-0000000029' || p_nn)::uuid
$$;
create function pg_temp.reportar(p_nn text, p_ahora timestamptz) returns text
language sql volatile as $$
  select privado.reportar_inasistencia(('50000000-0000-0000-0000-0000000029' || p_nn)::uuid, p_ahora)
$$;
create function pg_temp.reportes_de(p_nn text) returns integer
language sql stable as $$
  select count(*)::int from public.reporte_inasistencia where id_monitoria = ('50000000-0000-0000-0000-0000000029' || p_nn)::uuid
$$;
-- Una foto de la monitoría 18 y de todo lo que cuelga de ella (pago, reembolso, desembolso), para ver que no cambia.
create function pg_temp.foto_18() returns text
language sql stable as $$
  select concat_ws('#',
    (select string_agg(m::text, '|') from public.monitoria m where m.id = '50000000-0000-0000-0000-000000002918'),
    (select string_agg(p::text, '|' order by p.id) from public.pago p where p.id_monitoria = '50000000-0000-0000-0000-000000002918'),
    (select string_agg(r::text, '|' order by r.id) from public.reembolso r join public.pago p on p.id = r.id_pago
      where p.id_monitoria = '50000000-0000-0000-0000-000000002918'),
    (select string_agg(d::text, '|' order by d.id) from public.desembolso d where d.id_monitoria = '50000000-0000-0000-0000-000000002918'))
$$;
create temporary table foto_29 as select pg_temp.foto_18() as antes;

-- Control: las monitorías existen, el turno de admins da A, los cinco tokens existen y los reportes de partida son los 9.
select ok(
  (select count(*) = 36 from public.monitoria where id::text like '50000000-0000-0000-0000-0000000029%')
  and exists (select 1 from public.monitoria_grupal where id_monitoria = '50000000-0000-0000-0000-000000002908')
  and (select count(*) = 7 from public.confirmacion_cita where id_monitoria::text like '50000000-0000-0000-0000-0000000029%')
  and privado.siguiente_admin_activo() = 'a0000000-0000-0000-0000-0000000029a0'
  and (select count(*) = 9 from public.reporte_inasistencia where id_monitoria::text like '50000000-0000-0000-0000-0000000029%')
  and length((select antes from foto_29)) > 100,
  'Control: las 36 monitorías, la grupal, los 7 tokens y los 9 reportes de partida existen, y el primer admin activo es A');

-- ---------------------------------------------------------------------------
-- privado.reportar_inasistencia: los resultados que no crean nada
-- ---------------------------------------------------------------------------
select is(privado.reportar_inasistencia(gen_random_uuid(), timestamptz '2030-04-01 00:00-05'), 'no_existe',
  'Un id que no existe: no_existe');
select is(privado.reportar_inasistencia(null, timestamptz '2030-04-01 00:00-05'), 'no_existe', 'Un id nulo: no_existe');
select is(pg_temp.reportar('08', pg_temp.inicio_de('08') + interval '2 hours'), 'no_individual',
  'Una grupal confirmada (la 08), aunque ya empezó y esté en ventana: no_individual (su reporte es de HU-045)');
select is(pg_temp.reportar('03', pg_temp.inicio_de('03') + interval '2 hours'), 'no_reportable',
  'Una por pagar (la 03), con el inicio ya pasado: no_reportable');
select is(pg_temp.reportar('07', pg_temp.inicio_de('07') + interval '2 hours'), 'no_reportable',
  'Una cancelada por el estudiante (la 07): no_reportable');
select results_eq(
  $$select nn, pg_temp.reportar(nn, pg_temp.inicio_de(nn) + interval '2 hours')
    from unnest(array['05', '11', '12', '13']) as nn order by 1$$,
  $$values ('05'::text, 'ya_reportada'::text), ('11', 'ya_reportada'), ('12', 'ya_reportada'), ('13', 'ya_reportada')$$,
  'Con un reporte en cualquier estado: ya_reportada (11 en revisión, 12 rechazado, 13 aceptado; y la 05, ya cancelada por monitor_no_asistio, también)');
select is(pg_temp.reportar('11', timestamptz '2040-01-01 00:00-05'), 'ya_reportada',
  'ya_reportada va antes que la ventana: con un reporte hecho, aunque la ventana ya haya vencido, dice "ya hay reporte"');
select is(pg_temp.reportar('01', pg_temp.inicio_de('01') - interval '1 second'), 'aun_no_empieza',
  'Un segundo antes del inicio: aun_no_empieza (RN-64)');
select is(pg_temp.reportar('19', null), 'aun_no_empieza', 'Sin hora (p_ahora nulo) falla cerrado: nada se reporta');
select is(pg_temp.reportar('10', pg_temp.inicio_de('10') + interval '25 hours 1 second'), 'fuera_de_ventana',
  'Un segundo después de fin + 24 h (la sesión dura 1 h): fuera_de_ventana (RN-62)');
select is(pg_temp.reportes_de('01') + pg_temp.reportes_de('19') + pg_temp.reportes_de('10') + pg_temp.reportes_de('03')
          + pg_temp.reportes_de('07') + pg_temp.reportes_de('08'), 0,
  'Ninguno de esos intentos creó un reporte (la 01, 19, 10, 03, 07 y 08 siguen sin reporte)');

-- ---------------------------------------------------------------------------
-- privado.reportar_inasistencia: los que sí reportan, con sus bordes
-- ---------------------------------------------------------------------------
select is(pg_temp.reportar('01', pg_temp.inicio_de('01')), 'reportada',
  'Con la hora exacta del inicio ya se puede (P-40, RN-64): reportada');
select is(pg_temp.reportar('02', pg_temp.inicio_de('02') + interval '30 minutes'), 'reportada',
  'En curso (30 min después del inicio): reportada');
select is(pg_temp.reportar('06', pg_temp.inicio_de('06') + interval '65 minutes'), 'reportada',
  'Ya terminada (5 min después del fin): reportada');
select is(pg_temp.reportar('04', pg_temp.inicio_de('04') + interval '2 hours'), 'reportada',
  'Sobre una realizada (la 04): reportada (RN-65, el monitor la finalizó igual)');
select is(pg_temp.reportar('09', pg_temp.inicio_de('09') + interval '25 hours'), 'reportada',
  'Con fin + 24 h exactas todavía se puede (P-40, RN-62): reportada');
select is((select estado::text from public.monitoria where id = '50000000-0000-0000-0000-000000002904'), 'realizada',
  'La realizada sigue realizada tras el reporte (decidirlo es de HU-030)');

-- La fila creada.
select results_eq(
  $$select r.estado::text, r.id_admin = 'a0000000-0000-0000-0000-0000000029a0', r.fecha_reporte, r.fecha_decision is null,
           r.observaciones is null
    from public.reporte_inasistencia r where r.id_monitoria = '50000000-0000-0000-0000-000000002902'$$,
  $$values ('en_revision'::text, true, pg_temp.inicio_de('02') + interval '30 minutes', true, true)$$,
  'El reporte nace en_revision, asignado al primer admin activo (A), con la hora que se le pasó y sin decisión ni observaciones');
select is(
  (select count(*)::int from public.reporte_inasistencia r
   where r.id_monitoria in (select ('50000000-0000-0000-0000-0000000029' || nn)::uuid from unnest(array['01', '02', '04', '06', '09']) nn)
     and r.estado = 'en_revision' and r.id_admin = privado.siguiente_admin_activo() and r.fecha_decision is null),
  5, 'Los cinco reportes son en_revision, del primer admin activo y sin decisión: uno por monitoría');
select results_eq(
  $$select right(id::text, 2), estado::text, motivo_cancelacion::text, fecha_finalizacion is not null
    from public.monitoria where right(id::text, 2) in ('01', '02', '06', '09') and id::text like '50000000-0000-0000-0000-0000000029%' order by 1$$,
  $$values ('01'::text, 'confirmada'::text, null::text, false), ('02', 'confirmada', null, false), ('06', 'confirmada', null, false),
           ('09', 'confirmada', null, false)$$,
  'Las monitorías reportadas siguen confirmadas, sin motivo ni fecha de finalización: reportar no cambia la monitoría');

-- Dos llamadas seguidas: una sola fila.
select is(pg_temp.reportar('17', pg_temp.inicio_de('17') + interval '1 hour'), 'reportada', 'Primera llamada sobre la 17: reportada');
select is(pg_temp.reportar('17', pg_temp.inicio_de('17') + interval '1 hour'), 'ya_reportada',
  'La segunda (un doble clic o una página vieja): ya_reportada');
select is(pg_temp.reportes_de('17'), 1, 'Y una sola fila de reporte para la monitoría');

-- Reportar no toca el pago, el reembolso ni el desembolso (ni la monitoría) de la 18.
select is(pg_temp.reportar('18', pg_temp.inicio_de('18') + interval '1 hour'), 'reportada', 'La 18 (con pago, reembolso y desembolso): reportada');
select is(pg_temp.foto_18(), (select antes from foto_29),
  'La monitoría, el pago, el reembolso y el desembolso de la 18 quedaron exactamente igual: reportar solo escribe el reporte');

-- RN-62 no mira el pago (Pregunta 2): rechazado o en revisión, igual se puede.
select is(pg_temp.reportar('15', pg_temp.inicio_de('15') + interval '1 hour'), 'reportada',
  'Con el pago rechazado (la 15, P-24): reportada, el reporte no mira el pago');
select is(pg_temp.reportar('16', pg_temp.inicio_de('16') + interval '1 hour'), 'reportada',
  'Con el pago en revisión (la 16): reportada');

-- El turno: con el primer admin desactivado, lo salta.
update auth.users set banned_until = 'infinity' where id = 'a0000000-0000-0000-0000-0000000029a0';
select is(privado.siguiente_admin_activo(), 'a0000000-0000-0000-0000-0000000029b0'::uuid, 'Control: con A desactivado, el turno es de B');
select is(pg_temp.reportar('20', pg_temp.inicio_de('20') + interval '1 hour'), 'reportada', 'Con A desactivado: reportada');
select is(
  (select r.id_admin from public.reporte_inasistencia r where r.id_monitoria = '50000000-0000-0000-0000-000000002920'),
  'a0000000-0000-0000-0000-0000000029b0'::uuid, 'El reporte quedó con B, el primer admin activo (A está desactivado)');

-- Sin ningún admin activo: sin_admin y nada se crea.
update auth.users set banned_until = 'infinity' where id = 'a0000000-0000-0000-0000-0000000029b0';
select is(privado.siguiente_admin_activo(), null::uuid, 'Control: con A y B desactivados, ningún admin activo');
select is(pg_temp.reportar('14', pg_temp.inicio_de('14') + interval '1 hour'), 'sin_admin',
  'Sin ningún admin activo: sin_admin (Pregunta 1)');
select is(pg_temp.reportes_de('14'), 0, 'Y no se creó ninguna fila: el Lead puede volver a intentarlo');
update auth.users set banned_until = null
where id in ('a0000000-0000-0000-0000-0000000029a0', 'a0000000-0000-0000-0000-0000000029b0');
call pg_temp.aislar();
select is(pg_temp.reportar('14', pg_temp.inicio_de('14') + interval '1 hour'), 'reportada',
  'Al volver un admin, el mismo reporte sí se crea');

-- ---------------------------------------------------------------------------
-- Las puertas: permisos por rol
-- ---------------------------------------------------------------------------
set local role anon;
select throws_ok($$select public.reportar_inasistencia_por_token('abc')$$, '42501', null,
  'anon no puede reportar con un token: permiso denegado');
select throws_ok($$select public.reportar_inasistencia_de_mi_cita('50000000-0000-0000-0000-000000002923')$$, '42501', null,
  'anon no puede reportar con la puerta de sesión: permiso denegado');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000002901","role":"authenticated"}';
select throws_ok($$select public.reportar_inasistencia_por_token('abc')$$, '42501', null,
  'Una sesión no puede usar la puerta por token: solo el servidor con la llave secreta');
select throws_ok($$select privado.reportar_inasistencia_por_token('abc')$$, '42501', null, 'Ni llamar la de privado');
select throws_ok($$select privado.reportar_inasistencia('50000000-0000-0000-0000-000000002923', now())$$, '42501', null,
  'Una sesión no puede llamar el corazón con la hora que quiera: permiso denegado');
reset role;
set local role service_role;
select throws_ok($$select public.reportar_inasistencia_de_mi_cita('50000000-0000-0000-0000-000000002923')$$, '42501', null,
  'service_role no puede usar la puerta de sesión: no tiene sesión de Lead (usa la puerta por token)');
select throws_ok($$select privado.reportar_inasistencia_de_mi_cita('50000000-0000-0000-0000-000000002923')$$, '42501', null,
  'Ni llamar la de privado');
select throws_ok($$select privado.reportar_inasistencia('50000000-0000-0000-0000-000000002923', now())$$, '42501', null,
  'service_role tampoco puede llamar el corazón: solo las puertas, con la hora de la base');
reset role;

-- ---------------------------------------------------------------------------
-- Puerta 1: el enlace del correo (service_role)
-- ---------------------------------------------------------------------------
set local role service_role;
select is(public.reportar_inasistencia_por_token(encode(extensions.gen_random_bytes(32), 'hex')), 'no_existe',
  'Un token inventado (64 hexadecimales al azar): no_existe');
select is(public.reportar_inasistencia_por_token('abc'), 'no_existe', 'Un token corto: no_existe');
select is(public.reportar_inasistencia_por_token(''), 'no_existe', 'Un token vacío: no_existe');
select is(public.reportar_inasistencia_por_token(null), 'no_existe', 'Un token nulo: no_existe');
select is(
  public.reportar_inasistencia_por_token((select substr(token, 1, 63) from public.confirmacion_cita
                                          where id_monitoria = '50000000-0000-0000-0000-000000002921')),
  'no_existe', 'El token real sin su último carácter (63): no_existe');
select is(
  public.reportar_inasistencia_por_token((select token || '0' from public.confirmacion_cita
                                          where id_monitoria = '50000000-0000-0000-0000-000000002921')),
  'no_existe', 'El token real con un carácter de más (65): no_existe');
select is(
  public.reportar_inasistencia_por_token((select upper(token) from public.confirmacion_cita
                                          where id_monitoria = '50000000-0000-0000-0000-000000002921')),
  'no_existe', 'El token real en mayúsculas tampoco: se compara tal cual');
reset role;
select is(pg_temp.reportes_de('21'), 0, 'Ninguno de esos tokens creó un reporte para la 21');
set local role service_role;
select is(
  public.reportar_inasistencia_por_token((select token from public.confirmacion_cita where id_monitoria = '50000000-0000-0000-0000-000000002921')),
  'reportada', 'Con el token de la 21 (empezó hace 2 h): reportada');
select is(
  public.reportar_inasistencia_por_token((select token from public.confirmacion_cita where id_monitoria = '50000000-0000-0000-0000-000000002921')),
  'ya_reportada', 'Con el mismo token otra vez: ya_reportada');
reset role;
select results_eq(
  $$select r.estado::text, r.id_admin = 'a0000000-0000-0000-0000-0000000029a0', r.fecha_reporte = now(), r.fecha_decision is null
    from public.reporte_inasistencia r where r.id_monitoria = '50000000-0000-0000-0000-000000002921'$$,
  $$values ('en_revision'::text, true, true, true)$$,
  'El reporte de la 21: en_revision, con el primer admin activo y la hora de la base (now()), no la que mande el navegador');
select is(pg_temp.reportes_de('22'), 0, 'Un token solo reporta su propia cita: la 22 sigue sin reporte');
select is((select estado::text from public.monitoria where id = '50000000-0000-0000-0000-000000002921'), 'confirmada',
  'La monitoría de la 21 sigue confirmada');

-- ---------------------------------------------------------------------------
-- Puerta 2: la sesión del Lead (authenticated)
-- ---------------------------------------------------------------------------
-- Los que no son el Lead de la 24 (del Lead 01): otra sesión con Lead propio (c2), una anónima sin Lead (c3), el monitor, un
-- admin y una sesión sin sub.
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000002902","role":"authenticated"}';
select is(public.reportar_inasistencia_de_mi_cita('50000000-0000-0000-0000-000000002924'), 'no_existe',
  'Otra sesión con Lead propio (Lead 02) no reporta la cita del Lead 01: no_existe');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000002903","role":"authenticated"}';
select is(public.reportar_inasistencia_de_mi_cita('50000000-0000-0000-0000-000000002924'), 'no_existe',
  'Una sesión anónima sin Lead: no_existe');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-000000002901","role":"authenticated"}';
select is(public.reportar_inasistencia_de_mi_cita('50000000-0000-0000-0000-000000002924'), 'no_existe',
  'El monitor de la cita tampoco: no es el Lead');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000029a0","role":"authenticated"}';
select is(public.reportar_inasistencia_de_mi_cita('50000000-0000-0000-0000-000000002924'), 'no_existe',
  'Un admin tampoco: no es el Lead');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"role":"authenticated"}';
select is(public.reportar_inasistencia_de_mi_cita('50000000-0000-0000-0000-000000002924'), 'no_existe',
  'Sin identidad en la sesión (sin sub) no hay Lead: no_existe');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000002901","role":"authenticated"}';
select is(public.reportar_inasistencia_de_mi_cita(gen_random_uuid()), 'no_existe', 'Un id que no existe: no_existe');
select is(public.reportar_inasistencia_de_mi_cita(null), 'no_existe', 'Un id nulo: no_existe');
select is(public.reportar_inasistencia_de_mi_cita('50000000-0000-0000-0000-000000002922'), 'no_existe',
  'La cita de otro Lead (la 22 es del Lead 02): no_existe, igual que si no existiera');
reset role;
select is(pg_temp.reportes_de('24') + pg_temp.reportes_de('22'), 0, 'Ninguno de esos intentos creó un reporte (la 24 y la 22 siguen sin reporte)');

-- El Lead de la sesión (c1): su cita, la ya reportada, la que no empieza y la de hace 30 h.
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000002901","role":"authenticated"}';
select is(public.reportar_inasistencia_de_mi_cita('50000000-0000-0000-0000-000000002923'), 'reportada',
  'El Lead que agendó reporta su cita que empezó hace 2 h (la 23): reportada');
select is(public.reportar_inasistencia_de_mi_cita('50000000-0000-0000-0000-000000002923'), 'ya_reportada',
  'Un doble clic: ya_reportada');
select is(public.reportar_inasistencia_de_mi_cita('50000000-0000-0000-0000-000000002927'), 'ya_reportada',
  'Una que ya tenía reporte (la 27): ya_reportada');
select is(public.reportar_inasistencia_de_mi_cita('50000000-0000-0000-0000-000000002928'), 'aun_no_empieza',
  'Una que empieza dentro de 2 h (la 28): aun_no_empieza; la base lo responde aunque la página no ofrezca el botón');
select is(public.reportar_inasistencia_de_mi_cita('50000000-0000-0000-0000-000000002929'), 'fuera_de_ventana',
  'Una de hace 30 h (la 29): fuera_de_ventana');
reset role;
select is(pg_temp.reportes_de('28') + pg_temp.reportes_de('29'), 0, 'Ni la 28 ni la 29 crearon un reporte');
-- Sesión 4: otro dispositivo que confirmó el correo del Lead 01 (lead_sesion, HU-068).
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000002904","role":"authenticated"}';
select is(public.reportar_inasistencia_de_mi_cita('50000000-0000-0000-0000-000000002925'), 'reportada',
  'La sesión que confirmó el correo del Lead (HU-068) reporta su cita (la 25)');
reset role;
-- Sesión 5: la cuenta de Estudiante del Lead 01.
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000002905","role":"authenticated"}';
select is(public.reportar_inasistencia_de_mi_cita('50000000-0000-0000-0000-000000002926'), 'reportada',
  'La cuenta de Estudiante del Lead reporta su cita (la 26)');
reset role;
select results_eq(
  $$select right(id_monitoria::text, 2), estado::text, id_admin = 'a0000000-0000-0000-0000-0000000029a0', fecha_reporte = now()
    from public.reporte_inasistencia where id_monitoria::text like '50000000-0000-0000-0000-00000000292_'
      and right(id_monitoria::text, 2) in ('23', '25', '26') order by 1$$,
  $$values ('23'::text, 'en_revision'::text, true, true), ('25', 'en_revision', true, true), ('26', 'en_revision', true, true)$$,
  'Los reportes de la puerta de sesión: en_revision, del primer admin activo y con la hora de la base');

-- ---------------------------------------------------------------------------
-- RN-83: el desembolso queda suspendido por existir el reporte (public.desembolsos_ejecutables)
-- ---------------------------------------------------------------------------
-- La 30 es de enero de 2020 (la ventana de 24 h ya venció), con un pago aprobado y su desembolso pendiente. La 31 igual,
-- pero su reporte se crea antes de que exista el desembolso. Además de la bandeja (la vista), se mira lo que responde
-- privado.estado_para_ejecutar de HU-028, que es lo que ve la página del desembolso y lo que vuelve a validar la ejecución.
create function pg_temp.motivo_para_ejecutar(p_nn text) returns text
language sql stable as $$
  select e.motivo
  from public.desembolso d, privado.estado_para_ejecutar(d.id, now()) e
  where d.id_monitoria = ('50000000-0000-0000-0000-0000000029' || p_nn)::uuid
$$;
insert into public.desembolso (id_monitoria, monto_bruto, comision, monto_neto, llave_destino, estado) values
  ('50000000-0000-0000-0000-000000002930', 20000, 2000, 18000, 'llave-ana-29', 'pendiente');
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000029a0","role":"authenticated"}';
select is((select count(*)::int from public.desembolsos_ejecutables where id_monitoria = '50000000-0000-0000-0000-000000002930'), 1,
  'Sin reporte, el desembolso pendiente de una sesión ya vencida es ejecutable');
reset role;
select is(pg_temp.motivo_para_ejecutar('30'), null::text,
  'Control: sin reporte, la página del desembolso (HU-028) tampoco ve nada que lo bloquee');
select is(pg_temp.reportar('30', timestamptz '2020-01-06 12:00-05'), 'reportada',
  'Reportada la 30 dentro de su ventana (con p_ahora de 2020): reportada');
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000029a0","role":"authenticated"}';
select is((select count(*)::int from public.desembolsos_ejecutables where id_monitoria = '50000000-0000-0000-0000-000000002930'), 0,
  'Con el reporte en revisión el desembolso ya no es ejecutable (RN-83), aunque la ventana de hoy ya haya vencido');
reset role;
select is(pg_temp.motivo_para_ejecutar('30'), 'con_reporte',
  'Y al consultarlo, la página del desembolso y su ejecución (HU-028) responden con_reporte: queda suspendido (RN-83)');
update public.reporte_inasistencia set estado = 'rechazado', fecha_decision = now(), observaciones = 'No procede.'
where id_monitoria = '50000000-0000-0000-0000-000000002930';
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000029a0","role":"authenticated"}';
select is((select count(*)::int from public.desembolsos_ejecutables where id_monitoria = '50000000-0000-0000-0000-000000002930'), 1,
  'Con el reporte rechazado, el desembolso vuelve a ser ejecutable (HU-030)');
reset role;
update public.reporte_inasistencia set estado = 'aceptado'
where id_monitoria = '50000000-0000-0000-0000-000000002930';
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000029a0","role":"authenticated"}';
select is((select count(*)::int from public.desembolsos_ejecutables where id_monitoria = '50000000-0000-0000-0000-000000002930'), 0,
  'Con el reporte aceptado, no es ejecutable');
reset role;
-- El reporte llega antes que el desembolso.
select is(pg_temp.reportar('31', timestamptz '2020-01-13 12:00-05'), 'reportada', 'Reportada la 31, que todavía no tiene desembolso: reportada');
insert into public.desembolso (id_monitoria, monto_bruto, comision, monto_neto, llave_destino, estado) values
  ('50000000-0000-0000-0000-000000002931', 20000, 2000, 18000, 'llave-ana-29', 'pendiente');
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000029a0","role":"authenticated"}';
select is((select count(*)::int from public.desembolsos_ejecutables where id_monitoria = '50000000-0000-0000-0000-000000002931'), 0,
  'Un desembolso que nace después del reporte también queda excluido: la suspensión se evalúa en vivo');
reset role;
select is(pg_temp.motivo_para_ejecutar('31'), 'con_reporte',
  'Excluido por el reporte (con_reporte), no por otra causa: la 31 tiene su pago aprobado y la ventana vencida');
select is(
  (select d.estado::text from public.desembolso d where d.id_monitoria = '50000000-0000-0000-0000-000000002931'),
  'pendiente', 'Y el desembolso sigue pendiente: reportar no escribe en desembolso, solo lo suspende la vista');

-- ---------------------------------------------------------------------------
-- D-37: observaciones_reporte en la cita
-- ---------------------------------------------------------------------------
-- Con el token (service_role).
set local role service_role;
select results_eq(
  $$select right(c.id_monitoria::text, 2), c.estado_reporte, c.observaciones_reporte
    from public.confirmacion_cita t, public.cita_por_token(t.token) c
    where t.id_monitoria::text like '50000000-0000-0000-0000-00000000294_' order by 1$$,
  $$values ('40'::text, null::text, null::text), ('41', 'en_revision', null), ('42', 'rechazado', 'No pudimos comprobar la inasistencia.'),
           ('43', 'aceptado', 'Lo confirmó el monitor.'), ('44', 'rechazado', null)$$,
  'cita_por_token: sin reporte, nulas; en revisión, nulas aunque haya texto; decidido, el texto sin espacios de los lados; sin texto, nulas');
reset role;
-- Con la sesión del Lead 02 (c2): mi_cita (una por una) y mis_citas.
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000002902","role":"authenticated"}';
select results_eq(
  $$select right(id::text, 2), c.estado_reporte, c.observaciones_reporte
    from unnest(array['40', '41', '42', '43', '44']) as nn,
         lateral (select ('50000000-0000-0000-0000-0000000029' || nn)::uuid as id) i,
         public.mi_cita(i.id) c order by 1$$,
  $$values ('40'::text, null::text, null::text), ('41', 'en_revision', null), ('42', 'rechazado', 'No pudimos comprobar la inasistencia.'),
           ('43', 'aceptado', 'Lo confirmó el monitor.'), ('44', 'rechazado', null)$$,
  'mi_cita: las mismas observaciones que cita_por_token');
select results_eq(
  $$select right(id_monitoria::text, 2), estado_reporte, observaciones_reporte from public.mis_citas()
    where right(id_monitoria::text, 2) in ('40', '41', '42', '43', '44') order by 1$$,
  $$values ('40'::text, null::text, null::text), ('41', 'en_revision', null), ('42', 'rechazado', 'No pudimos comprobar la inasistencia.'),
           ('43', 'aceptado', 'Lo confirmó el monitor.'), ('44', 'rechazado', null)$$,
  'mis_citas: también');
select is((select count(*)::int from public.mi_cita('50000000-0000-0000-0000-000000002923')), 0,
  'Y la cita de otro Lead sigue sin salir por mi_cita (la 23 es del Lead 01)');
reset role;
-- Un reporte hecho por la puerta (la 21) sale con su estado y sin observaciones.
set local role service_role;
select results_eq(
  $$select c.estado_reporte, c.observaciones_reporte
    from public.confirmacion_cita t, public.cita_por_token(t.token) c where t.id_monitoria = '50000000-0000-0000-0000-000000002921'$$,
  $$values ('en_revision'::text, null::text)$$,
  'Un reporte recién hecho por la puerta sale en_revision y sin observaciones');
reset role;
-- La salida de privado.datos_de_cita sigue sin contacto ni comisión (P-37).
select ok(
  not exists (
    select 1 from unnest(array['18', '42', '43']) as nn, privado.datos_de_cita(('50000000-0000-0000-0000-0000000029' || nn)::uuid) d
    where d::text ~* '(secreto29|3002911111|3002922222|monitora29|llave-ana|llave-reembolso|comision)'),
  'P-37: la cita no trae el contacto del Lead, de quien pagó ni del monitor, ni la llave, ni cifras de comisión');

-- ---------------------------------------------------------------------------
-- La restricción reporte_observaciones_con_texto
-- ---------------------------------------------------------------------------
select throws_ok(
  $$update public.reporte_inasistencia set observaciones = '   ' where id_monitoria = '50000000-0000-0000-0000-000000002941'$$,
  '23514', null, 'Observaciones en blanco (solo espacios): rechazadas');
select throws_ok(
  $$update public.reporte_inasistencia set observaciones = '' where id_monitoria = '50000000-0000-0000-0000-000000002941'$$,
  '23514', null, 'Observaciones vacías: rechazadas');
select throws_ok(
  $$update public.reporte_inasistencia set observaciones = repeat('a', 501) where id_monitoria = '50000000-0000-0000-0000-000000002941'$$,
  '23514', null, 'Observaciones de 501 caracteres: rechazadas');
select lives_ok(
  $$update public.reporte_inasistencia set observaciones = repeat('a', 500) where id_monitoria = '50000000-0000-0000-0000-000000002941'$$,
  'Observaciones de 500 caracteres: pasan');
select lives_ok(
  $$update public.reporte_inasistencia set observaciones = null where id_monitoria = '50000000-0000-0000-0000-000000002941'$$,
  'Observaciones nulas: pasan');
select lives_ok(
  $$update public.reporte_inasistencia set observaciones = 'Con texto.' where id_monitoria = '50000000-0000-0000-0000-000000002941'$$,
  'Un texto normal: pasa');

select * from finish();
rollback;
