-- Pruebas pgTAP de la franja de prueba (HU-119, D-85).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.
--
-- Qué cubre la migración 20261102015206_franja_de_prueba.sql:
--   * Estructura y permisos: public.franja_de_prueba (la marca) y public.marca_franja_prueba (el registro), con RLS; nadie con
--     sesión las escribe; solo el admin lee el registro; las funciones de marcar y de listar tienen su puerta de dos capas.
--   * Cada resultado de marcar y desmarcar, con su registro: quién y cuándo. Los que no escriben no cambian nada.
--   * La lista de fechas libres dice si la franja es de prueba.
--   * Agendar en una franja de prueba: la monitoría nace confirmada y gratis, con el precio normal, sin pago, con la
--     confirmación y el aviso al monitor anotados. Una gratis por Lead (prueba_ya_usada). Una franja sin marcar sigue igual.
--   * El mínimo de precio no se relaja.
--
-- Elenco (ids terminados en 119NN; la materia es 'PGTAP-119'): admins A (activo) y C (desactivado), monitor M, Leads L1 y L2
-- con sus sesiones S1 y S2. Franjas A (lunes) y B (martes) marcadas; C (miércoles) normal, todas de 09:30 y $20.000.

begin;
create extension if not exists pgtap with schema extensions;

select plan(51);

-- ---------------------------------------------------------------------------
-- Existencia, permisos y forma de lo nuevo
-- ---------------------------------------------------------------------------
select has_table('public', 'franja_de_prueba', 'Existe public.franja_de_prueba, la marca');
select has_table('public', 'marca_franja_prueba', 'Existe public.marca_franja_prueba, el registro');
select columns_are('public', 'franja_de_prueba', array['id_franja', 'id_admin', 'marcada_en'], 'La marca: la franja, el admin y cuándo');
select columns_are('public', 'marca_franja_prueba', array['id', 'id_franja', 'id_admin', 'de_prueba', 'hecha_en'],
  'El registro: la franja, el admin, si marcó o desmarcó y cuándo');
select ok(
  (select bool_and(relrowsecurity) from pg_class where oid in ('public.franja_de_prueba'::regclass, 'public.marca_franja_prueba'::regclass)),
  'RLS está activo en las dos tablas');
select is(
  (select string_agg(tablename::text || ':' || policyname::text || '|' || cmd::text || '|' || array_to_string(roles, ','), ';' order by tablename)
   from pg_policies where schemaname = 'public' and tablename in ('franja_de_prueba', 'marca_franja_prueba')),
  'franja_de_prueba:todos leen|SELECT|authenticated;marca_franja_prueba:admin lee|SELECT|authenticated',
  'Una sola política de lectura por tabla: la marca la leen todos con sesión y el registro solo el admin');
select ok(
  not has_any_column_privilege('anon', 'public.franja_de_prueba', 'select')
  and not has_any_column_privilege('anon', 'public.marca_franja_prueba', 'select')
  and has_table_privilege('authenticated', 'public.franja_de_prueba', 'select')
  and not has_any_column_privilege('authenticated', 'public.franja_de_prueba', 'insert')
  and not has_any_column_privilege('authenticated', 'public.franja_de_prueba', 'update')
  and not has_table_privilege('authenticated', 'public.franja_de_prueba', 'delete')
  and not has_any_column_privilege('authenticated', 'public.marca_franja_prueba', 'insert')
  and not has_any_column_privilege('service_role', 'public.marca_franja_prueba', 'insert')
  and not has_table_privilege('service_role', 'public.franja_de_prueba', 'delete'),
  'anon no las toca; con sesión solo se leen; nadie las escribe directamente');
select ok(
  (select bool_and(prosecdef) from pg_proc
   where oid in ('privado.marcar_franja_de_prueba(uuid, boolean)'::regprocedure, 'privado.franjas_para_admin()'::regprocedure))
  and not (select bool_or(prosecdef) from pg_proc
           where oid in ('public.marcar_franja_de_prueba(uuid, boolean)'::regprocedure, 'public.franjas_para_admin()'::regprocedure)),
  'Las de privado son security definer; las de public corren con quien llama');
select ok(
  has_function_privilege('authenticated', 'public.marcar_franja_de_prueba(uuid, boolean)', 'execute')
  and has_function_privilege('authenticated', 'public.franjas_para_admin()', 'execute')
  and not has_function_privilege('anon', 'public.marcar_franja_de_prueba(uuid, boolean)', 'execute')
  and not has_function_privilege('anon', 'public.franjas_para_admin()', 'execute')
  and not has_function_privilege('service_role', 'public.marcar_franja_de_prueba(uuid, boolean)', 'execute'),
  'Solo con sesión: ni anon ni service_role marcan ni listan');
select ok(
  has_function_privilege('anon', 'public.fechas_libres_de_materia(text, integer)', 'execute')
  and has_function_privilege('authenticated', 'public.fechas_libres_de_materia(text, integer)', 'execute')
  and pg_get_function_result('public.fechas_libres_de_materia(text, integer)'::regprocedure) like '%de_prueba boolean%',
  'La lista de fechas libres sigue pública y ahora trae de_prueba');
select ok(
  obj_description('public.franja_de_prueba'::regclass, 'pg_class') is not null
  and obj_description('public.marca_franja_prueba'::regclass, 'pg_class') is not null
  and obj_description('public.marcar_franja_de_prueba(uuid, boolean)'::regprocedure, 'pg_proc') is not null
  and obj_description('public.franjas_para_admin()'::regprocedure, 'pg_proc') is not null
  and obj_description('public.fechas_libres_de_materia(text, integer)'::regprocedure, 'pg_proc') is not null,
  'Las tablas y las funciones tienen comentario');
select ok(
  exists (select 1 from pg_constraint where conrelid = 'public.monitoria'::regclass and conname = 'monitoria_valor_positivo' and contype = 'c')
  and exists (select 1 from pg_constraint where conrelid = 'public.franja'::regclass and conname = 'franja_precio_positivo' and contype = 'c'),
  'Los checks del mínimo de precio siguen en su lugar (D-85 d)');

set local role anon;
select throws_ok($$select public.marcar_franja_de_prueba('30000000-0000-0000-0000-000000011901', true)$$, '42501', null,
  'anon no puede marcar: permiso denegado');
reset role;

-- ---------------------------------------------------------------------------
-- Fixtures (como postgres)
-- ---------------------------------------------------------------------------
-- Sin los secretos de la app, ningún trigger le pide nada a pg_net.
delete from vault.secrets where name in ('calibra_sitio_url', 'calibra_cron_secreto');

insert into auth.users (id, is_anonymous, banned_until) values
  ('a0000000-0000-0000-0000-0000000119a0', false, null),
  ('a0000000-0000-0000-0000-0000000119c0', false, 'infinity'),
  ('b0000000-0000-0000-0000-000000011901', false, null),
  ('c0000000-0000-0000-0000-000000011901', true, null),
  ('c0000000-0000-0000-0000-000000011902', true, null);
insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-0000000119a0', 'Admin A 119', 'admin-a-hu119@calibra.test', -11900),
  ('a0000000-0000-0000-0000-0000000119c0', 'Admin C 119', 'admin-c-hu119@calibra.test', -11899);
insert into public.monitor (id, nombre) values ('b0000000-0000-0000-0000-000000011901', 'Ana 119');
insert into public.monitor_privado (id_monitor, numero_telefono, correo, llave) values
  ('b0000000-0000-0000-0000-000000011901', '3001190001', 'ana.monitora119@calibra.test', 'llave-ana-119');
insert into public.materia (id, nombre, codigo) values ('10000000-0000-0000-0000-000000011901', 'Materia 119', 'PGTAP-119');
insert into public.certificado (id_monitor, id_materia, id_admin) values
  ('b0000000-0000-0000-0000-000000011901', '10000000-0000-0000-0000-000000011901', 'a0000000-0000-0000-0000-0000000119a0');
insert into public.lead (id, id_sesion_anonima, nombre, numero_telefono, correo, acepta_tratamiento_datos, fecha_consentimiento) values
  ('40000000-0000-0000-0000-000000011901', 'c0000000-0000-0000-0000-000000011901', 'Lucía Uno 119', '3001191111', 'lucia119@calibra.test', true, now()),
  ('40000000-0000-0000-0000-000000011902', 'c0000000-0000-0000-0000-000000011902', 'Pedro Dos 119', '3001192222', 'pedro119@calibra.test', true, now());

insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min, lugar, enlace, abierta_desde) values
  ('30000000-0000-0000-0000-000000011901', 'b0000000-0000-0000-0000-000000011901', 1, '09:30', false, 20000, 60, null, 'https://meet.example/119-a', date '2019-01-01'),
  ('30000000-0000-0000-0000-000000011902', 'b0000000-0000-0000-0000-000000011901', 2, '09:30', false, 20000, 60, null, 'https://meet.example/119-b', date '2019-01-01'),
  ('30000000-0000-0000-0000-000000011903', 'b0000000-0000-0000-0000-000000011901', 3, '09:30', false, 20000, 60, null, 'https://meet.example/119-c', date '2019-01-01');

-- marcar(usuario, franja, de_prueba): llama a la puerta con la identidad de ese usuario (nulo: una sesión sin sub).
create function pg_temp.marcar(p_uid text, p_franja text, p_marcar boolean) returns text
language plpgsql volatile as $$
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null then '{"role":"authenticated"}'
         else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
  return public.marcar_franja_de_prueba(('30000000-0000-0000-0000-0000000119' || p_franja)::uuid, p_marcar);
end;
$$;
-- agendar(usuario, franja, fecha): el Lead de esa sesión aparta la fecha.
create function pg_temp.agendar(p_uid text, p_franja text, p_fecha date) returns text
language plpgsql volatile as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  return (select a.resultado from privado.agendar_monitoria(('30000000-0000-0000-0000-0000000119' || p_franja)::uuid, p_fecha, 'PGTAP-119', true) a);
end;
$$;
create function pg_temp.foto() returns text
language sql stable as $$
  select concat_ws('#', (select count(*)::text from public.franja_de_prueba), (select count(*)::text from public.marca_franja_prueba));
$$;
-- La monitoría de una franja y fecha.
create function pg_temp.m(p_franja text, p_fecha date) returns public.monitoria
language sql stable as $$
  select m from public.monitoria m where m.id_franja = ('30000000-0000-0000-0000-0000000119' || p_franja)::uuid and m.fecha = p_fecha;
$$;

-- ---------------------------------------------------------------------------
-- Quién puede marcar: solo un admin activo
-- ---------------------------------------------------------------------------
create temporary table antes as select pg_temp.foto() as foto;
select is(pg_temp.marcar(null, '01', true), 'sin_sesion', 'Sin sesión (sin sub) no marca');
select is(pg_temp.marcar('c0000000-0000-0000-0000-000000011901', '01', true), 'sin_permiso', 'Un estudiante no marca');
select is(pg_temp.marcar('b0000000-0000-0000-0000-000000011901', '01', true), 'sin_permiso', 'El monitor dueño de la franja tampoco');
select is(pg_temp.marcar('a0000000-0000-0000-0000-0000000119c0', '01', true), 'sin_permiso', 'Ni un admin desactivado');
select is(pg_temp.marcar('a0000000-0000-0000-0000-0000000119a0', '01', null), 'pedido_invalido', 'Un pedido sin decir marcar o quitar no hace nada');
select is(pg_temp.marcar('a0000000-0000-0000-0000-0000000119a0', '99', true), 'no_existe', 'Una franja que no existe');
select is(pg_temp.marcar('a0000000-0000-0000-0000-0000000119a0', '03', false), 'no_marcada', 'Quitar la marca de una franja sin marcar');
select is(pg_temp.foto(), (select foto from antes), 'Ninguno de esos cambió nada ni dejó registro');

-- ---------------------------------------------------------------------------
-- Marcar y desmarcar, con su registro
-- ---------------------------------------------------------------------------
select is(pg_temp.marcar('a0000000-0000-0000-0000-0000000119a0', '01', true), 'marcada', 'Un admin activo marca la franja A');
select is(pg_temp.marcar('a0000000-0000-0000-0000-0000000119a0', '01', true), 'ya_marcada', 'Marcarla otra vez no hace nada nuevo');
select is(pg_temp.marcar('a0000000-0000-0000-0000-0000000119a0', '02', true), 'marcada', 'Marca también la franja B');
select is(pg_temp.marcar('a0000000-0000-0000-0000-0000000119a0', '03', true), 'marcada', 'Marca la C para probar desmarcar');
select is(pg_temp.marcar('a0000000-0000-0000-0000-0000000119a0', '03', false), 'desmarcada', 'Le quita la marca a la C');
select is(
  (select count(*)::int from public.franja_de_prueba where id_franja in
     ('30000000-0000-0000-0000-000000011901', '30000000-0000-0000-0000-000000011902')),
  2, 'A y B quedan marcadas');
select is(
  (select count(*)::int from public.franja_de_prueba where id_franja = '30000000-0000-0000-0000-000000011903'),
  0, 'La C ya no tiene marca');
select is(
  (select string_agg(de_prueba::text, ',' order by hecha_en, de_prueba::text) from public.marca_franja_prueba
   where id_franja = '30000000-0000-0000-0000-000000011903'),
  'false,true', 'El registro de la C guarda las dos veces: marcó y desmarcó');
select is(
  (select count(*)::int from public.marca_franja_prueba where id_admin = 'a0000000-0000-0000-0000-0000000119a0'),
  4, 'Cuatro cambios, todos del admin de la sesión');

-- ---------------------------------------------------------------------------
-- La lista del admin y la de fechas libres
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', 'a0000000-0000-0000-0000-0000000119a0', 'role', 'authenticated')::text, true);
select is(
  (select string_agg(de_prueba::text, ',' order by dia) from public.franjas_para_admin() where nombre_monitor = 'Ana 119'),
  'true,true,false', 'El admin ve las tres franjas con su marca (A y B de prueba, C normal)');
select set_config('request.jwt.claims', json_build_object('sub', 'c0000000-0000-0000-0000-000000011901', 'role', 'authenticated')::text, true);
select is((select count(*)::int from public.franjas_para_admin() where nombre_monitor = 'Ana 119'), 0, 'Un estudiante no ve ninguna franja en la lista del admin');

create temporary table fechas as
  select distinct on (l.id_franja) l.id_franja, l.fecha, l.de_prueba
  from privado.fechas_libres_de_materia('PGTAP-119', 4, now()) l
  order by l.id_franja, l.fecha;
select is(
  (select string_agg(right(id_franja::text, 2) || ':' || de_prueba::text, ',' order by id_franja) from fechas),
  '01:true,02:true,03:false', 'La lista de fechas libres dice cuáles franjas son de prueba');

-- ---------------------------------------------------------------------------
-- Agendar
-- ---------------------------------------------------------------------------
-- L1 agenda una fecha de la franja A (de prueba).
select is(pg_temp.agendar('c0000000-0000-0000-0000-000000011901', '01', (select fecha from fechas where right(id_franja::text, 2) = '01')),
  'agendada', 'L1 agenda la franja de prueba A');
select is((select (pg_temp.m('01', (select fecha from fechas where right(id_franja::text, 2) = '01'))).estado::text), 'confirmada',
  'La monitoría nace confirmada, sin pasar por el pago');
select is((select (pg_temp.m('01', (select fecha from fechas where right(id_franja::text, 2) = '01'))).gratis), true, 'y gratis');
select is((select (pg_temp.m('01', (select fecha from fechas where right(id_franja::text, 2) = '01'))).valor_total), 20000,
  'con el precio normal, no con 0');
select is((select count(*)::int from public.pago p join public.monitoria m on m.id = p.id_monitoria
           where m.id_franja = '30000000-0000-0000-0000-000000011901'), 0, 'Sin ningún pago');
select is((select count(*)::int from public.confirmacion_cita c join public.monitoria m on m.id = c.id_monitoria
           where m.id_franja = '30000000-0000-0000-0000-000000011901'), 1, 'La confirmación al estudiante quedó anotada');
select ok((select count(*) from public.aviso_monitor a join public.monitoria m on m.id = a.id_monitoria
           where m.id_franja = '30000000-0000-0000-0000-000000011901') >= 1, 'El aviso al monitor quedó anotado');

-- Una gratis por Lead: L1 no repite en la franja B.
select is(pg_temp.agendar('c0000000-0000-0000-0000-000000011901', '02', (select fecha from fechas where right(id_franja::text, 2) = '02')),
  'prueba_ya_usada', 'L1 ya usó su oferta: la franja B de prueba le responde prueba_ya_usada');
select is((select count(*)::int from public.monitoria where id_franja = '30000000-0000-0000-0000-000000011902'), 0,
  'y no se creó ninguna monitoría en la B');

-- Una franja sin marcar sigue el flujo de siempre.
select is(pg_temp.agendar('c0000000-0000-0000-0000-000000011901', '03', (select fecha from fechas where right(id_franja::text, 2) = '03')),
  'agendada', 'L1 agenda la franja normal C');
select is((select (pg_temp.m('03', (select fecha from fechas where right(id_franja::text, 2) = '03'))).estado::text), 'pendiente_pago',
  'La normal nace por pagar, como antes');
select is((select (pg_temp.m('03', (select fecha from fechas where right(id_franja::text, 2) = '03'))).gratis), false, 'y no es gratis');

-- Otro Lead sí usa su oferta en la B.
select is(pg_temp.agendar('c0000000-0000-0000-0000-000000011902', '02', (select fecha from fechas where right(id_franja::text, 2) = '02')),
  'agendada', 'L2, que no ha usado ninguna, agenda la franja de prueba B');
select is((select (pg_temp.m('02', (select fecha from fechas where right(id_franja::text, 2) = '02'))).estado::text), 'confirmada',
  'y le queda confirmada');
select is((select (pg_temp.m('02', (select fecha from fechas where right(id_franja::text, 2) = '02'))).gratis), true, 'y gratis');

-- Quitar la marca: lo reservado no cambia y lo nuevo vuelve a cobrarse.
select is(pg_temp.marcar('a0000000-0000-0000-0000-0000000119a0', '02', false), 'desmarcada', 'El admin le quita la marca a la B');
select is((select (pg_temp.m('02', (select fecha from fechas where right(id_franja::text, 2) = '02'))).gratis), true,
  'La monitoría que L2 ya tenía sigue gratis');
select is(
  (select count(*)::int from privado.fechas_libres_de_materia('PGTAP-119', 4, now()) l
   where l.id_franja = '30000000-0000-0000-0000-000000011902' and l.de_prueba), 0,
  'La B ya no sale como de prueba en la lista');

select * from finish();
rollback;
