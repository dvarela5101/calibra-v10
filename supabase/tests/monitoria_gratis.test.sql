-- Pruebas pgTAP de la monitoría de prueba gratis (HU-116, D-84).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.
--
-- Qué cubre la migración 20261101231721_monitoria_gratis.sql:
--   * Estructura y permisos: la columna monitoria.gratis y su check, public.marca_gratis (RLS con una sola política «admin
--     lee», sin escritura para nadie con sesión) y la puerta de tres capas (la versión con p_ahora, la de la sesión y la
--     pública). Nadie con sesión escribe `monitoria`, así que nadie se marca solo.
--   * Cada resultado de marcar y desmarcar, con una foto de la monitoría: ninguno de los que no escriben cambia nada.
--   * Marcar: confirmada sin pago, valor_total intacto, el registro (quién y cuándo), la confirmación al estudiante y el aviso
--     al monitor anotados por los triggers de siempre.
--   * Desmarcar: por pagar otra vez, la reserva desde ese momento (supuesto h), el registro.
--   * Sin dinero: una gratis realizada no crea desembolso ni invitación a reseñar; cancelada no abre reembolso. Una normal
--     realizada sigue creando su desembolso (regresión).
--   * El mínimo de precio no se relaja: la base sigue rechazando 0 en franja y monitoría.
--   * Las lecturas de la cita (mi_cita, cita_por_token, datos_de_confirmacion_cita) dicen si es gratis.
-- Lo que necesita dos conexiones (una marca y un comprobante a la vez) lo deciden los candados que ya prueban HU-018 y HU-052.
--
-- Las monitorías caen en lunes de 2031 a las 9:30 en Bogotá (en el futuro: ningún trabajo de pg_cron las toca). Las marcas se
-- llaman con p_ahora = now() salvo los bordes del inicio, que usan la hora exacta.
--
-- Elenco (ids terminados en 116NN; la materia es 'PGTAP-116'):
--   Admins A (activo) y C (desactivado). Monitor M con su llave. Lead L con su sesión anónima S.
--   Monitorías: 01 por pagar (marcar, doble marca, desmarcar, volver a marcar)   02 reserva vencida   03 con un pago rechazado
--   04 confirmada normal con pago aprobado (y su desembolso al realizarse)   05 grupal por pagar   06 gratis que se realiza
--   07 gratis que el Lead cancela   08 desmarcar en el borde del inicio   09 marcar en el inicio   10 la puerta con sesión

begin;
create extension if not exists pgtap with schema extensions;

select plan(77);

-- ---------------------------------------------------------------------------
-- Existencia, permisos y forma de lo nuevo
-- ---------------------------------------------------------------------------
select has_column('public', 'monitoria', 'gratis', 'monitoria tiene la columna gratis');
select col_not_null('public', 'monitoria', 'gratis', 'gratis no es nula');
select col_default_is('public', 'monitoria', 'gratis', 'false', 'Por defecto una monitoría no es gratis');
select ok(
  exists (select 1 from pg_constraint where conrelid = 'public.monitoria'::regclass and conname = 'monitoria_gratis_no_por_pagar' and contype = 'c'),
  'Existe el check monitoria_gratis_no_por_pagar');
select ok(
  exists (select 1 from pg_constraint where conrelid = 'public.monitoria'::regclass and conname = 'monitoria_valor_positivo' and contype = 'c')
  and exists (select 1 from pg_constraint where conrelid = 'public.franja'::regclass and conname = 'franja_precio_positivo' and contype = 'c'),
  'Los checks del mínimo de precio siguen en su lugar (D-84 a)');
select has_table('public', 'marca_gratis', 'Existe public.marca_gratis, el registro de quién marcó y cuándo');
select columns_are('public', 'marca_gratis', array['id', 'id_monitoria', 'id_admin', 'gratis', 'hecha_en'],
  'Sus columnas son el id, la monitoría, el admin, si la marcó o desmarcó y cuándo');
select is(
  array[(select confdeltype::text from pg_constraint
         where conrelid = 'public.marca_gratis'::regclass and contype = 'f' and confrelid = 'public.monitoria'::regclass),
        (select confdeltype::text from pg_constraint
         where conrelid = 'public.marca_gratis'::regclass and contype = 'f' and confrelid = 'public.admin'::regclass)],
  array['c', 'a'],
  'Se borra con su monitoría (cascada) pero un admin con marcas no se puede borrar (RN-23)');
select ok((select relrowsecurity from pg_class where oid = 'public.marca_gratis'::regclass), 'RLS está activo en marca_gratis');
select is(
  (select string_agg(policyname::text || '|' || cmd::text || '|' || array_to_string(roles, ','), ';') from pg_policies
   where schemaname = 'public' and tablename = 'marca_gratis'),
  'admin lee|SELECT|authenticated',
  'Una sola política: «admin lee», de lectura, para authenticated');
select ok(
  not has_any_column_privilege('anon', 'public.marca_gratis', 'select')
  and has_table_privilege('authenticated', 'public.marca_gratis', 'select')
  and not has_any_column_privilege('authenticated', 'public.marca_gratis', 'insert')
  and not has_any_column_privilege('authenticated', 'public.marca_gratis', 'update')
  and not has_table_privilege('authenticated', 'public.marca_gratis', 'delete')
  and has_table_privilege('service_role', 'public.marca_gratis', 'select')
  and not has_any_column_privilege('service_role', 'public.marca_gratis', 'insert')
  and not has_any_column_privilege('service_role', 'public.marca_gratis', 'update')
  and not has_table_privilege('service_role', 'public.marca_gratis', 'delete')
  and not exists (select 1 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                  where c.oid = 'public.marca_gratis'::regclass and a.grantee = 0),
  'anon no la toca; authenticated y service_role solo la leen; nadie la hereda de PUBLIC');
select ok(
  not has_any_column_privilege('authenticated', 'public.monitoria', 'update')
  and not has_any_column_privilege('anon', 'public.monitoria', 'update'),
  'Nadie con sesión escribe monitoria: la marca solo cambia por la función');

select has_function('privado', 'marcar_monitoria_gratis', array['uuid', 'boolean', 'timestamp with time zone'],
  'Existe privado.marcar_monitoria_gratis, con la hora como parámetro (para probar los bordes)');
select has_function('privado', 'marcar_monitoria_gratis_de_la_sesion', array['uuid', 'boolean'], 'Existe su envoltorio de la sesión, con now()');
select has_function('public', 'marcar_monitoria_gratis', array['uuid', 'boolean'], 'Existe su puerta en la Data API');
select ok(
  (select bool_and(prosecdef) from pg_proc
   where oid in ('privado.marcar_monitoria_gratis(uuid, boolean, timestamptz)'::regprocedure,
                 'privado.marcar_monitoria_gratis_de_la_sesion(uuid, boolean)'::regprocedure,
                 'privado.crear_desembolso_al_realizar()'::regprocedure))
  and not (select prosecdef from pg_proc where oid = 'public.marcar_monitoria_gratis(uuid, boolean)'::regprocedure)
  and (select bool_and('search_path=""' = any(proconfig)) from pg_proc
       where oid in ('privado.marcar_monitoria_gratis(uuid, boolean, timestamptz)'::regprocedure,
                     'privado.marcar_monitoria_gratis_de_la_sesion(uuid, boolean)'::regprocedure,
                     'public.marcar_monitoria_gratis(uuid, boolean)'::regprocedure,
                     'privado.crear_desembolso_al_realizar()'::regprocedure)),
  'Las de privado (y el trigger del desembolso) son security definer, la de public corre con quien llama; todas con search_path vacío');
select ok(
  has_function_privilege('authenticated', 'public.marcar_monitoria_gratis(uuid, boolean)', 'execute')
  and has_function_privilege('authenticated', 'privado.marcar_monitoria_gratis_de_la_sesion(uuid, boolean)', 'execute')
  and not has_function_privilege('authenticated', 'privado.marcar_monitoria_gratis(uuid, boolean, timestamptz)', 'execute')
  and not exists (
    select 1 from unnest(array['privado.marcar_monitoria_gratis(uuid, boolean, timestamptz)',
                               'privado.marcar_monitoria_gratis_de_la_sesion(uuid, boolean)',
                               'public.marcar_monitoria_gratis(uuid, boolean)']) f
    where has_function_privilege('anon', f, 'execute') or has_function_privilege('service_role', f, 'execute'))
  and not exists (
    select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid in ('privado.marcar_monitoria_gratis(uuid, boolean, timestamptz)'::regprocedure,
                    'privado.marcar_monitoria_gratis_de_la_sesion(uuid, boolean)'::regprocedure,
                    'public.marcar_monitoria_gratis(uuid, boolean)'::regprocedure)
      and a.grantee = 0),
  'Con sesión solo la puerta y su envoltorio con now(); ni anon ni service_role ejecutan ninguna; nadie la hereda de PUBLIC');
select ok(
  obj_description('public.marcar_monitoria_gratis(uuid, boolean)'::regprocedure, 'pg_proc') is not null
  and obj_description('privado.marcar_monitoria_gratis(uuid, boolean, timestamptz)'::regprocedure, 'pg_proc') is not null
  and obj_description('privado.marcar_monitoria_gratis_de_la_sesion(uuid, boolean)'::regprocedure, 'pg_proc') is not null
  and obj_description('public.marca_gratis'::regclass, 'pg_class') is not null
  and col_description('public.monitoria'::regclass,
                      (select attnum from pg_attribute where attrelid = 'public.monitoria'::regclass and attname = 'gratis')) is not null
  and obj_description('public.datos_de_confirmacion_cita(uuid)'::regprocedure, 'pg_proc') is not null
  and obj_description('privado.datos_de_cita(uuid)'::regprocedure, 'pg_proc') is not null,
  'Las funciones, la tabla, la columna y las lecturas recreadas tienen comentario');
select ok(
  has_function_privilege('service_role', 'public.datos_de_confirmacion_cita(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.datos_de_confirmacion_cita(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.datos_de_confirmacion_cita(uuid)', 'execute'),
  'datos_de_confirmacion_cita recreada conserva sus permisos: solo service_role');

-- Sin permiso ni se ejecutan.
set local role anon;
select throws_ok($$select public.marcar_monitoria_gratis('50000000-0000-0000-0000-000000011601', true)$$, '42501', null,
  'anon no puede marcar: permiso denegado');
reset role;
set local role service_role;
select throws_ok($$select public.marcar_monitoria_gratis('50000000-0000-0000-0000-000000011601', true)$$, '42501', null,
  'service_role tampoco: no es un admin con sesión');
reset role;
set local role authenticated;
select throws_ok($$select privado.marcar_monitoria_gratis('50000000-0000-0000-0000-000000011601', true, now())$$, '42501', null,
  'Una sesión no llama a la versión que recibe la hora');
reset role;

-- ---------------------------------------------------------------------------
-- Fixtures (como postgres)
-- ---------------------------------------------------------------------------
-- Sin los secretos de la app, ningún trigger le pide nada a pg_net.
delete from vault.secrets where name in ('calibra_sitio_url', 'calibra_cron_secreto');

insert into auth.users (id, is_anonymous, banned_until) values
  ('a0000000-0000-0000-0000-0000000116a0', false, null),
  ('a0000000-0000-0000-0000-0000000116c0', false, 'infinity'),
  ('b0000000-0000-0000-0000-000000011601', false, null),
  ('c0000000-0000-0000-0000-000000011601', true, null);
insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-0000000116a0', 'Admin A 116', 'admin-a-hu116@calibra.test', -11600),
  ('a0000000-0000-0000-0000-0000000116c0', 'Admin C 116', 'admin-c-hu116@calibra.test', -11599);
insert into public.monitor (id, nombre) values ('b0000000-0000-0000-0000-000000011601', 'Ana 116');
insert into public.monitor_privado (id_monitor, numero_telefono, correo, llave) values
  ('b0000000-0000-0000-0000-000000011601', '3001160001', 'ana.monitora116@calibra.test', 'llave-ana-116');
insert into public.materia (id, nombre, codigo) values ('10000000-0000-0000-0000-000000011601', 'Materia 116', 'PGTAP-116');
insert into public.certificado (id_monitor, id_materia, id_admin) values
  ('b0000000-0000-0000-0000-000000011601', '10000000-0000-0000-0000-000000011601', 'a0000000-0000-0000-0000-0000000116a0');
insert into public.lead (id, id_sesion_anonima, nombre, numero_telefono, correo, acepta_tratamiento_datos, fecha_consentimiento) values
  ('40000000-0000-0000-0000-000000011601', 'c0000000-0000-0000-0000-000000011601', 'Lucía Prueba 116', '3001161111',
   'lucia116@calibra.test', true, now());

insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min, lugar, enlace, abierta_desde)
select ('30000000-0000-0000-0000-0000000116' || nn)::uuid, 'b0000000-0000-0000-0000-000000011601'::uuid, smallint '1',
       time '09:30', false, 20000, 60, null, 'https://meet.example/116-' || nn, date '2019-01-01'
from unnest(array['01', '02', '03', '04', '05', '06', '07', '08', '09', '10']) as nn;

insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado, fecha_creacion)
select ('50000000-0000-0000-0000-0000000116' || v.nn)::uuid, ('30000000-0000-0000-0000-0000000116' || v.nn)::uuid,
       '10000000-0000-0000-0000-000000011601'::uuid, '40000000-0000-0000-0000-000000011601'::uuid,
       v.fecha, 20000, v.estado, v.creada
from (values
  ('01', date '2031-03-10', 'pendiente_pago'::public.estado_monitoria, now()),
  ('02', date '2031-03-17', 'pendiente_pago', now() - interval '11 minutes'),
  ('03', date '2031-03-24', 'pendiente_pago', now()),
  ('04', date '2031-03-31', 'confirmada', now()),
  ('05', date '2031-04-07', 'pendiente_pago', now()),
  ('06', date '2031-04-14', 'pendiente_pago', now()),
  ('07', date '2031-04-21', 'pendiente_pago', now()),
  ('08', date '2031-04-28', 'pendiente_pago', now()),
  ('09', date '2031-05-05', 'pendiente_pago', timestamptz '2031-05-05 09:29-05'),
  ('10', date '2031-05-12', 'pendiente_pago', now())) as v(nn, fecha, estado, creada);
insert into public.monitoria_grupal (id_monitoria, cupos, modalidad_pago, precio_por_persona) values
  ('50000000-0000-0000-0000-000000011605', 3, 'dividido', 15000);

-- Un pago rechazado en la 03 y uno aprobado en la 04.
insert into public.comprobante_revisado (ruta, tipo) values
  ('c0000000-0000-0000-0000-000000011601/60000000-0000-0000-0000-000000011603.pdf', 'application/pdf'),
  ('c0000000-0000-0000-0000-000000011601/60000000-0000-0000-0000-000000011604.pdf', 'application/pdf');
insert into public.pago (id, id_monitoria, monto, nombre_pagador, contacto, estado, id_admin, fecha_pago, fecha_revision, comprobante) values
  ('60000000-0000-0000-0000-000000011603', '50000000-0000-0000-0000-000000011603', 20000, 'Lucía', 'lucia116@calibra.test',
   'rechazado', 'a0000000-0000-0000-0000-0000000116a0', now(), now(),
   'c0000000-0000-0000-0000-000000011601/60000000-0000-0000-0000-000000011603.pdf'),
  ('60000000-0000-0000-0000-000000011604', '50000000-0000-0000-0000-000000011604', 20000, 'Lucía', 'lucia116@calibra.test',
   'aprobado', 'a0000000-0000-0000-0000-0000000116a0', now(), now(),
   'c0000000-0000-0000-0000-000000011601/60000000-0000-0000-0000-000000011604.pdf');

-- marcar(usuario, nn, gratis[, ahora]): llama a la versión con la hora con la identidad de ese usuario (nulo: una sesión sin sub).
create function pg_temp.marcar(p_uid text, p_nn text, p_gratis boolean, p_ahora timestamptz default now()) returns text
language plpgsql volatile as $$
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null then '{"role":"authenticated"}'
         else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
  return privado.marcar_monitoria_gratis(('50000000-0000-0000-0000-0000000116' || p_nn)::uuid, p_gratis, p_ahora);
end;
$$;
-- foto(nn): la monitoría y lo que cuelga de ella, para ver que un resultado que no escribe no cambió nada.
create function pg_temp.foto(p_nn text) returns text
language sql stable as $$
  select concat_ws('#',
    (select m::text from public.monitoria m where m.id = ('50000000-0000-0000-0000-0000000116' || p_nn)::uuid),
    (select count(*)::text from public.marca_gratis g where g.id_monitoria = ('50000000-0000-0000-0000-0000000116' || p_nn)::uuid),
    (select count(*)::text from public.confirmacion_cita c where c.id_monitoria = ('50000000-0000-0000-0000-0000000116' || p_nn)::uuid),
    (select count(*)::text from public.aviso_monitor a where a.id_monitoria = ('50000000-0000-0000-0000-0000000116' || p_nn)::uuid));
$$;
create function pg_temp.m(p_nn text) returns public.monitoria
language sql stable as $$
  select m from public.monitoria m where m.id = ('50000000-0000-0000-0000-0000000116' || p_nn)::uuid;
$$;

-- ---------------------------------------------------------------------------
-- Quién puede: solo un admin activo
-- ---------------------------------------------------------------------------
create temporary table antes as select pg_temp.foto('10') as foto;
select is(pg_temp.marcar(null, '10', true), 'sin_sesion', 'Sin sesión (sin sub) no marca');
select is(pg_temp.marcar('c0000000-0000-0000-0000-000000011601', '10', true), 'sin_permiso', 'El estudiante dueño de la cita no la marca');
select is(pg_temp.marcar('b0000000-0000-0000-0000-000000011601', '10', true), 'sin_permiso', 'El monitor que la dicta tampoco');
select is(pg_temp.marcar('a0000000-0000-0000-0000-0000000116c0', '10', true), 'sin_permiso', 'Ni un admin desactivado');
select is(pg_temp.marcar('c0000000-0000-0000-0000-000000011601', '10', false), 'sin_permiso', 'Ni desmarcar sin ser admin');
select is(pg_temp.marcar('a0000000-0000-0000-0000-0000000116a0', '10', null), 'pedido_invalido', 'Un pedido sin decir marcar o desmarcar no hace nada');
select is(pg_temp.foto('10'), (select foto from antes), 'Ninguno de esos cambió la monitoría ni dejó registro');

-- Ni el estudiante ni el monitor escriben la monitoría ni el registro por la Data API.
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000011601","role":"authenticated"}';
set local role authenticated;
select throws_ok($$update public.monitoria set gratis = true where id = '50000000-0000-0000-0000-000000011610'$$, '42501', null,
  'El estudiante no se marca solo su monitoría: no tiene update en monitoria');
select throws_ok(
  $$insert into public.marca_gratis (id_monitoria, id_admin, gratis) values ('50000000-0000-0000-0000-000000011610', 'a0000000-0000-0000-0000-0000000116a0', true)$$,
  '42501', null, 'Ni escribe un registro a nombre de un admin');
reset role;

-- ---------------------------------------------------------------------------
-- Marcar (01): confirmada sin pago, con su registro, su confirmación y el aviso al monitor
-- ---------------------------------------------------------------------------
select is(pg_temp.marcar('a0000000-0000-0000-0000-0000000116a0', '01', true), 'marcada', 'Un admin activo marca una individual por pagar');
select is(((pg_temp.m('01')).estado, (pg_temp.m('01')).gratis, (pg_temp.m('01')).valor_total)::text, '(confirmada,t,20000)',
  'Queda confirmada, gratis y con su precio normal (D-84 a)');
select is((select count(*)::int from public.pago where id_monitoria = '50000000-0000-0000-0000-000000011601'), 0, 'No se crea ningún pago');
select is(
  (select (id_admin, gratis)::text from public.marca_gratis where id_monitoria = '50000000-0000-0000-0000-000000011601'),
  '(a0000000-0000-0000-0000-0000000116a0,t)', 'Queda registrado quién la marcó');
select ok(
  (select hecha_en = now() from public.marca_gratis where id_monitoria = '50000000-0000-0000-0000-000000011601'),
  'Y cuándo, con la hora de la base');
select is((select count(*)::int from public.confirmacion_cita where id_monitoria = '50000000-0000-0000-0000-000000011601'), 1,
  'El trigger de siempre anota la confirmación al estudiante');
select is((select string_agg(evento, ',') from public.aviso_monitor where id_monitoria = '50000000-0000-0000-0000-000000011601'),
  'confirmada', 'Y el aviso al monitor de una cita confirmada');
select is(pg_temp.marcar('a0000000-0000-0000-0000-0000000116a0', '01', true), 'ya_marcada', 'Un doble clic responde ya_marcada');

-- Lo que leen el estudiante y el correo.
select is((select gratis from public.datos_de_confirmacion_cita('50000000-0000-0000-0000-000000011601')), true,
  'datos_de_confirmacion_cita dice que es gratis (el correo dice «Gratis», D-84 c)');
select is((select gratis from public.cita_por_token(
            (select token from public.confirmacion_cita where id_monitoria = '50000000-0000-0000-0000-000000011601'))),
  true, 'cita_por_token dice que es gratis');
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000011601","role":"authenticated"}';
set local role authenticated;
select is((select (gratis, valor_total, estado_pago)::text from public.mi_cita('50000000-0000-0000-0000-000000011601')),
  '(t,20000,sin_pagar)', 'El estudiante ve su cita gratis, con el precio normal y sin pago');
select is((select count(*)::int from public.marca_gratis), 0, 'El estudiante no lee el registro de marcas');
select is((select gratis from public.monitoria where id = '50000000-0000-0000-0000-000000011601'), true,
  'Lee la marca de su propia monitoría (es participante)');
reset role;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-000000011601","role":"authenticated"}';
set local role authenticated;
select is((select count(*)::int from public.marca_gratis), 0, 'El monitor tampoco lee el registro de marcas');
reset role;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000116a0","role":"authenticated"}';
set local role authenticated;
select ok((select count(*) from public.marca_gratis where id_monitoria = '50000000-0000-0000-0000-000000011601') = 1,
  'Un admin activo sí lo lee');
reset role;

-- ---------------------------------------------------------------------------
-- Desmarcar (01): vuelve a por pagar con su precio y la reserva desde ahora (supuesto h)
-- ---------------------------------------------------------------------------
select is(pg_temp.marcar('a0000000-0000-0000-0000-0000000116a0', '01', false, now() + interval '1 day'), 'desmarcada',
  'Un admin le quita la marca a una gratis confirmada que no ha empezado');
select is(((pg_temp.m('01')).estado, (pg_temp.m('01')).gratis, (pg_temp.m('01')).valor_total)::text, '(pendiente_pago,f,20000)',
  'Vuelve a por pagar, sin la marca y con su precio normal');
select is((pg_temp.m('01')).fecha_creacion, now() + interval '1 day', 'La reserva de 10 minutos cuenta desde el desmarcado');
select is((select string_agg(gratis::text, ',' order by hecha_en) from public.marca_gratis
           where id_monitoria = '50000000-0000-0000-0000-000000011601'), 'true,false', 'El registro conserva la marca y la desmarca');
select is(pg_temp.marcar('a0000000-0000-0000-0000-0000000116a0', '01', false, now() + interval '1 day'), 'no_marcada',
  'Desmarcar otra vez responde no_marcada');
select is(pg_temp.marcar('a0000000-0000-0000-0000-0000000116a0', '01', true, now() + interval '1 day 5 minutes'), 'marcada',
  'Dentro de la reserva nueva se puede volver a marcar');

-- ---------------------------------------------------------------------------
-- Lo que no se marca (y no cambia nada)
-- ---------------------------------------------------------------------------
create temporary table fotos as select nn, pg_temp.foto(nn) as foto from unnest(array['02', '03', '04', '05', '09']) as nn;
select is(pg_temp.marcar('a0000000-0000-0000-0000-0000000116a0', '02', true), 'reserva_vencida', 'Con la reserva vencida no se marca (RN-34)');
select is(pg_temp.marcar('a0000000-0000-0000-0000-0000000116a0', '03', true), 'con_pagos', 'Con un pago (aunque esté rechazado) no se marca');
select is(pg_temp.marcar('a0000000-0000-0000-0000-0000000116a0', '04', true), 'no_por_pagar', 'Una confirmada normal no se marca');
select is(pg_temp.marcar('a0000000-0000-0000-0000-0000000116a0', '04', false), 'no_marcada', 'Ni se desmarca una que no es gratis');
select is(pg_temp.marcar('a0000000-0000-0000-0000-0000000116a0', '05', true), 'no_individual', 'Una grupal no se marca (fuera de alcance)');
select is(pg_temp.marcar('a0000000-0000-0000-0000-0000000116a0', '09', true, timestamptz '2031-05-05 09:30-05'), 'ya_empezo',
  'En el instante exacto del inicio ya no se marca, aunque la reserva siga vigente (RN-64)');
select is(pg_temp.marcar('a0000000-0000-0000-0000-0000000116a0', '99', true), 'no_existe', 'Una monitoría que no existe');
select is((select count(*)::int from fotos f where f.foto is distinct from pg_temp.foto(f.nn)), 0, 'Ninguno de esos cambió nada');

-- ---------------------------------------------------------------------------
-- El borde del inicio al desmarcar (08)
-- ---------------------------------------------------------------------------
select is(pg_temp.marcar('a0000000-0000-0000-0000-0000000116a0', '08', true), 'marcada', 'La 08 queda gratis');
select is(pg_temp.marcar('a0000000-0000-0000-0000-0000000116a0', '08', false, timestamptz '2031-04-28 09:30-05'), 'ya_empezo',
  'En el instante exacto del inicio ya no se desmarca (RN-64)');
select is(pg_temp.marcar('a0000000-0000-0000-0000-0000000116a0', '08', false, timestamptz '2031-04-28 09:29:59.999999-05'), 'desmarcada',
  'Un microsegundo antes, sí');

-- ---------------------------------------------------------------------------
-- Sin dinero: realizada sin desembolso; cancelada sin reembolso (supuesto e)
-- ---------------------------------------------------------------------------
select is(pg_temp.marcar('a0000000-0000-0000-0000-0000000116a0', '06', true), 'marcada', 'La 06 queda gratis');
update public.monitoria set estado = 'realizada', fecha_finalizacion = now() where id = '50000000-0000-0000-0000-000000011606';
select is((select count(*)::int from public.desembolso where id_monitoria = '50000000-0000-0000-0000-000000011606'), 0,
  'Una gratis realizada no crea desembolso');
select is((select count(*)::int from public.invitacion_resena i join public.pago p on p.id = i.id_pago
           where p.id_monitoria = '50000000-0000-0000-0000-000000011606'), 0, 'Ni nada que cobre o pague');
select is(pg_temp.marcar('a0000000-0000-0000-0000-0000000116a0', '06', false), 'no_confirmada', 'Una realizada no se desmarca');
update public.monitoria set estado = 'realizada', fecha_finalizacion = now() where id = '50000000-0000-0000-0000-000000011604';
select is((select count(*)::int from public.desembolso where id_monitoria = '50000000-0000-0000-0000-000000011604'), 1,
  'Una normal realizada sigue creando su desembolso (regresión)');

select is(pg_temp.marcar('a0000000-0000-0000-0000-0000000116a0', '07', true), 'marcada', 'La 07 queda gratis');
select is(privado.cancelar_cita('50000000-0000-0000-0000-000000011607', now()), 'cancelada', 'El estudiante la cancela dentro del plazo');
select is((select count(*)::int from public.reembolso r join public.pago p on p.id = r.id_pago
           where p.id_monitoria = '50000000-0000-0000-0000-000000011607'), 0, 'Su cancelación no abre reembolso');
select is(pg_temp.marcar('a0000000-0000-0000-0000-0000000116a0', '07', false), 'no_confirmada', 'Una cancelada no se desmarca');

-- ---------------------------------------------------------------------------
-- La base sigue rechazando el precio 0 (D-84 a) y una gratis por pagar
-- ---------------------------------------------------------------------------
select throws_ok($$update public.monitoria set valor_total = 0 where id = '50000000-0000-0000-0000-000000011601'$$, '23514', null,
  'monitoria sigue rechazando valor_total 0, también en una gratis');
select throws_ok($$update public.franja set precio = 0 where id = '30000000-0000-0000-0000-000000011610'$$, '23514', null,
  'franja sigue rechazando precio 0');
select throws_ok($$update public.monitoria set gratis = true where id = '50000000-0000-0000-0000-000000011610'$$, '23514', null,
  'Una monitoría por pagar no puede quedar gratis: el check lo impide');

-- ---------------------------------------------------------------------------
-- La puerta con la sesión del admin (10): la hora de la base y su identidad
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000116a0","role":"authenticated"}';
set local role authenticated;
select is(public.marcar_monitoria_gratis('50000000-0000-0000-0000-000000011610', true), 'marcada', 'La puerta pública marca con la sesión del admin');
reset role;
select is((select id_admin::text from public.marca_gratis where id_monitoria = '50000000-0000-0000-0000-000000011610'),
  'a0000000-0000-0000-0000-0000000116a0', 'Y el registro queda a su nombre (auth.uid())');

select * from finish();
rollback;
