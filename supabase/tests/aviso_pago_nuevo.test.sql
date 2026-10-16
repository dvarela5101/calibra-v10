-- Pruebas pgTAP del aviso de pago nuevo a todos los admins activos (HU-034; D-56, D-70).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.
--
-- Qué cubre la migración 20261014160000_bandeja_comun_de_pagos.sql (la parte del aviso):
--   * public.aviso_pago_nuevo, la bandeja de salida de los avisos a los admins: columnas, la única (id_pago, id_admin), el
--     índice parcial de los pendientes, RLS sin políticas y permisos mínimos, como aviso_rechazo_pago (HU-076).
--   * privado.anotar_aviso_pago_nuevo y el trigger pago_anota_aviso_nuevo (after insert, solo si el pago nace en_revision):
--     una fila por cada admin activo en ese momento, el responsable incluido, en la misma transacción del pago; las
--     grupales no se avisan (HU-038). Cada fila guarda como id_responsable el id_admin del pago al llegar.
--   * privado.disparar_avisos_pago_nuevo y el trabajo de pg_cron calibra-avisar-pagos-nuevos.
--   * Que no existe ningún trabajo de pg_cron (ni función) que escale por hora: D-56 no tiene escalamiento.
-- La parte de privado.revisar_pago (cualquier admin activo revisa) la cubren revisar_pago.test.sql y
-- revisar_pago_vencido.test.sql.
--
-- La base local puede traer otros admins (la semilla, o datos de desarrollo) y el trigger avisa a TODOS los admins activos.
-- Para que la prueba no dependa de ellos: (1) se banean dentro de la transacción, así quedan inactivos; (2) pg_temp.aislar()
-- los vuelve a desactivar antes de cada insert de pagos, por si otra prueba que corre a la vez crea admins confirmados;
-- (3) los admins de la prueba llevan un orden_revision negativo (-3405 a -3401), por delante de cualquier otro.
--
-- Admins de la prueba, en su orden inicial:
--   A (-3405) activo · B (-3404) activo · C (-3403) activo · D (-3402) desactivado (baneo vigente)
--   E (-3401) con un baneo ya vencido (activo). En total cuatro activos: A, B, C y E.
-- Monitor M, con una franja de los lunes 10:00. Lead 01. Cada monitoría es de un lunes distinto de 2030 y tiene un pago del
-- mismo número (pago NN de la monitoría NN):
--     01 individual, pago en revisión de A       02 grupal, pago en revisión de A       03 individual, pago ya aprobado
--     04 individual, pago en revisión de B (el insert se repite con un segundo trigger de prueba)
--     05 individual, pago en revisión de A (dentro de un savepoint)
--     06 individual, pago en revisión de C (se reasigna a E con un update)
--     07 individual, pago en revisión de B (si el pedido a la app falla)

begin;
create extension if not exists pgtap with schema extensions;

select plan(74);

-- ---------------------------------------------------------------------------
-- Ayudante (vive solo en esta sesión): va ANTES de cualquier set role
-- ---------------------------------------------------------------------------
-- aislar(): vuelve a desactivar a cualquier admin que no sea de la prueba. La base local la pueden estar usando otras
-- pruebas a la vez (integración, e2e) y crear admins confirmados mientras esta corre; el trigger los vería.
create procedure pg_temp.aislar()
language sql security definer set search_path = ''
as $$
  update auth.users set banned_until = 'infinity'
  where id in (select id from public.admin
               where id not in ('a0000000-0000-0000-0000-0000000034a0', 'a0000000-0000-0000-0000-0000000034b0',
                                'a0000000-0000-0000-0000-0000000034c0', 'a0000000-0000-0000-0000-0000000034d0',
                                'a0000000-0000-0000-0000-0000000034e0'))
    and (banned_until is null or banned_until <= now());
$$;

-- ---------------------------------------------------------------------------
-- La tabla: columnas, única, índice, RLS sin políticas y permisos mínimos
-- ---------------------------------------------------------------------------
select has_table('public', 'aviso_pago_nuevo', 'Existe public.aviso_pago_nuevo, la bandeja de salida de los avisos a los admins');
select columns_are('public', 'aviso_pago_nuevo',
  array['id', 'id_pago', 'id_admin', 'id_responsable', 'creado_en', 'procesado_en', 'intentos'],
  'Sus columnas son el id, el pago, el admin que avisa, el responsable al llegar el pago, cuándo se anotó, cuándo la app lo procesó y cuántas corridas fallaron');
select col_type_is('public', 'aviso_pago_nuevo', 'id_responsable', 'uuid',
  'id_responsable es la foto del id_admin del pago al llegar: un uuid de admin');
select ok(
  (select bool_and(attnotnull) from pg_attribute
   where attrelid = 'public.aviso_pago_nuevo'::regclass
     and attname in ('id_pago', 'id_admin', 'id_responsable', 'creado_en', 'intentos'))
  and (select not attnotnull from pg_attribute
       where attrelid = 'public.aviso_pago_nuevo'::regclass and attname = 'procesado_en'),
  'Todo es obligatorio salvo procesado_en, que es nulo mientras el aviso está pendiente');
select is(
  (select pg_get_constraintdef(oid) from pg_constraint
   where conrelid = 'public.aviso_pago_nuevo'::regclass and conname = 'aviso_pago_nuevo_pago_admin_key' and contype = 'u'),
  'UNIQUE (id_pago, id_admin)',
  'Un admin tiene un solo aviso por pago: única (id_pago, id_admin)');
select ok(
  (select count(*) = 1
          and bool_and(c.confrelid = 'public.pago'::regclass and c.confdeltype = 'c'
                       and c.conkey = array[(select attnum from pg_attribute where attrelid = c.conrelid and attname = 'id_pago')])
   from pg_constraint c
   where c.conrelid = 'public.aviso_pago_nuevo'::regclass and c.contype = 'f'),
  'Su única llave foránea es id_pago hacia pago, con on delete cascade: id_admin e id_responsable no llevan llave (evita cruzarse con mover_admin)');
select has_index('public', 'aviso_pago_nuevo', 'aviso_pago_nuevo_pendientes_idx', 'creado_en',
  'Tiene el índice de los pendientes por creado_en');
select matches(
  pg_get_indexdef('public.aviso_pago_nuevo_pendientes_idx'::regclass),
  'WHERE \(procesado_en IS NULL\)',
  'Es parcial: solo indexa los avisos sin procesar');
select ok((select relrowsecurity from pg_class where oid = 'public.aviso_pago_nuevo'::regclass),
  'RLS está activo en aviso_pago_nuevo');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'aviso_pago_nuevo'), 0,
  'Sin políticas: RLS le niega todo a anon y authenticated (el trigger inserta como security definer y la app usa la llave secreta)');
select ok(
  not exists (
    select 1
    from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where c.oid = 'public.aviso_pago_nuevo'::regclass and a.grantee = 0),
  'Nadie la hereda de PUBLIC');
select ok(
  not has_any_column_privilege('anon', 'public.aviso_pago_nuevo', 'select')
  and not has_any_column_privilege('anon', 'public.aviso_pago_nuevo', 'insert')
  and not has_any_column_privilege('anon', 'public.aviso_pago_nuevo', 'update')
  and not has_any_column_privilege('anon', 'public.aviso_pago_nuevo', 'references')
  and not has_table_privilege('anon', 'public.aviso_pago_nuevo', 'delete')
  and not has_table_privilege('anon', 'public.aviso_pago_nuevo', 'truncate')
  and not has_table_privilege('anon', 'public.aviso_pago_nuevo', 'trigger'),
  'anon no tiene ningún permiso sobre aviso_pago_nuevo');
select ok(
  not has_any_column_privilege('authenticated', 'public.aviso_pago_nuevo', 'select')
  and not has_any_column_privilege('authenticated', 'public.aviso_pago_nuevo', 'insert')
  and not has_any_column_privilege('authenticated', 'public.aviso_pago_nuevo', 'update')
  and not has_any_column_privilege('authenticated', 'public.aviso_pago_nuevo', 'references')
  and not has_table_privilege('authenticated', 'public.aviso_pago_nuevo', 'delete')
  and not has_table_privilege('authenticated', 'public.aviso_pago_nuevo', 'truncate')
  and not has_table_privilege('authenticated', 'public.aviso_pago_nuevo', 'trigger'),
  'authenticated tampoco tiene ninguno: ningún admin lee ni escribe los avisos de los demás');
select ok(has_table_privilege('service_role', 'public.aviso_pago_nuevo', 'select'),
  'service_role lee aviso_pago_nuevo (la app busca los pendientes)');
select ok(has_column_privilege('service_role', 'public.aviso_pago_nuevo', 'procesado_en', 'update')
  and has_column_privilege('service_role', 'public.aviso_pago_nuevo', 'intentos', 'update'),
  'service_role actualiza procesado_en e intentos');
select ok(
  not has_column_privilege('service_role', 'public.aviso_pago_nuevo', 'id', 'update')
  and not has_column_privilege('service_role', 'public.aviso_pago_nuevo', 'id_pago', 'update')
  and not has_column_privilege('service_role', 'public.aviso_pago_nuevo', 'id_admin', 'update')
  and not has_column_privilege('service_role', 'public.aviso_pago_nuevo', 'id_responsable', 'update')
  and not has_column_privilege('service_role', 'public.aviso_pago_nuevo', 'creado_en', 'update')
  and not has_table_privilege('service_role', 'public.aviso_pago_nuevo', 'update'),
  'Pero ninguna otra columna: el pago, el admin, el responsable y creado_en no se reescriben (el correo reintentado es igual al primero)');
select ok(
  not has_any_column_privilege('service_role', 'public.aviso_pago_nuevo', 'insert')
  and not has_table_privilege('service_role', 'public.aviso_pago_nuevo', 'delete')
  and not has_table_privilege('service_role', 'public.aviso_pago_nuevo', 'truncate')
  and not has_any_column_privilege('service_role', 'public.aviso_pago_nuevo', 'references')
  and not has_table_privilege('service_role', 'public.aviso_pago_nuevo', 'trigger'),
  'service_role no inserta, no borra, no trunca: los avisos los anota solo el trigger');

set local role anon;
select throws_ok($$select * from public.aviso_pago_nuevo$$, '42501', null, 'anon no puede leer aviso_pago_nuevo: permiso denegado');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000034a0","role":"authenticated"}';
select throws_ok($$select * from public.aviso_pago_nuevo$$, '42501', null,
  'Ni siquiera la sesión de un admin lee aviso_pago_nuevo: permiso denegado');
select throws_ok($$delete from public.aviso_pago_nuevo$$, '42501', null, 'Ni la borra');
reset role;

-- ---------------------------------------------------------------------------
-- Funciones, trigger y trabajo de pg_cron
-- ---------------------------------------------------------------------------
select has_function('privado', 'anotar_aviso_pago_nuevo', '{}'::name[], 'Existe privado.anotar_aviso_pago_nuevo, la del trigger');
select has_function('privado', 'disparar_avisos_pago_nuevo', '{}'::name[],
  'Existe privado.disparar_avisos_pago_nuevo, la que le pide a la app procesar los avisos');
select ok(
  (select prosecdef from pg_proc where oid = 'privado.anotar_aviso_pago_nuevo()'::regprocedure)
  and (select prosecdef from pg_proc where oid = 'privado.disparar_avisos_pago_nuevo()'::regprocedure),
  'Las dos son security definer (escriben aviso_pago_nuevo y leen Vault)');
select ok(
  (select bool_and('search_path=""' = any(proconfig)) from pg_proc
   where oid in ('privado.anotar_aviso_pago_nuevo()'::regprocedure, 'privado.disparar_avisos_pago_nuevo()'::regprocedure)),
  'Las dos fijan un search_path vacío');
select is(
  array[pg_get_function_result('privado.anotar_aviso_pago_nuevo()'::regprocedure),
        pg_get_function_result('privado.disparar_avisos_pago_nuevo()'::regprocedure)],
  array['trigger', 'bigint'],
  'La del trigger devuelve trigger y la que pide el procesamiento, el id de la petición de pg_net (bigint)');
select ok(
  not has_function_privilege('anon', 'privado.anotar_aviso_pago_nuevo()', 'execute')
  and not has_function_privilege('authenticated', 'privado.anotar_aviso_pago_nuevo()', 'execute')
  and not has_function_privilege('service_role', 'privado.anotar_aviso_pago_nuevo()', 'execute')
  and not has_function_privilege('anon', 'privado.disparar_avisos_pago_nuevo()', 'execute')
  and not has_function_privilege('authenticated', 'privado.disparar_avisos_pago_nuevo()', 'execute')
  and not has_function_privilege('service_role', 'privado.disparar_avisos_pago_nuevo()', 'execute'),
  'Ni anon, ni authenticated, ni service_role ejecutan ninguna de las dos: solo el trigger y pg_cron');
select ok(
  not exists (
    select 1
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid in ('privado.anotar_aviso_pago_nuevo()'::regprocedure, 'privado.disparar_avisos_pago_nuevo()'::regprocedure)
      and a.grantee = 0),
  'Nadie las hereda de PUBLIC');
set local role anon;
select throws_ok($$select privado.disparar_avisos_pago_nuevo()$$, '42501', null, 'anon no puede pedir el procesamiento: permiso denegado');
reset role;
set local role authenticated;
select throws_ok($$select privado.disparar_avisos_pago_nuevo()$$, '42501', null, 'Una sesión tampoco: permiso denegado');
reset role;
set local role service_role;
select throws_ok($$select privado.disparar_avisos_pago_nuevo()$$, '42501', null, 'service_role tampoco: lo pide el trigger o pg_cron');
reset role;

select has_trigger('public', 'pago', 'pago_anota_aviso_nuevo', 'pago tiene el trigger pago_anota_aviso_nuevo');
select trigger_is('public', 'pago', 'pago_anota_aviso_nuevo', 'privado', 'anotar_aviso_pago_nuevo',
  'El trigger llama a privado.anotar_aviso_pago_nuevo');
select matches(
  (select pg_get_triggerdef(t.oid) from pg_trigger t
   where t.tgrelid = 'public.pago'::regclass and t.tgname = 'pago_anota_aviso_nuevo'),
  'AFTER INSERT ON public\.pago FOR EACH ROW WHEN',
  'Corre después de insertar, por fila y con condición (la misma transacción que registra el pago)');
select matches(
  (select pg_get_triggerdef(t.oid) from pg_trigger t
   where t.tgrelid = 'public.pago'::regclass and t.tgname = 'pago_anota_aviso_nuevo'),
  'new\.estado = ''en_revision''',
  'Solo cuando el pago nace en revisión: uno insertado ya revisado no llega a la función');

select is((select count(*)::int from cron.job where jobname = 'calibra-avisar-pagos-nuevos'), 1,
  'Existe un solo trabajo calibra-avisar-pagos-nuevos en pg_cron (reaplicar la migración no lo duplica)');
select results_eq(
  $$select schedule, command, active from cron.job where jobname = 'calibra-avisar-pagos-nuevos'$$,
  $$values ('*/5 * * * *'::text, 'select privado.disparar_avisos_pago_nuevo()'::text, true)$$,
  'Corre cada 5 minutos, activo, y llama a privado.disparar_avisos_pago_nuevo()');
select is(
  (select count(*)::int from cron.job where jobname ilike '%escal%' or command ilike '%escal%'), 0,
  'D-56: ningún trabajo de pg_cron escala por hora (ni «escal» en su nombre ni en su comando)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'privado') and p.proname ilike '%escal%'), 0,
  'Y no existe ninguna función de public ni privado que escale o reasigne pagos por hora');

-- ---------------------------------------------------------------------------
-- Fixtures (como postgres)
-- ---------------------------------------------------------------------------
-- Cualquier admin que ya existiera queda inactivo durante la prueba.
update auth.users set banned_until = 'infinity' where id in (select id from public.admin);

insert into auth.users (id, is_anonymous, banned_until) values
  ('a0000000-0000-0000-0000-0000000034a0', false, null),
  ('a0000000-0000-0000-0000-0000000034b0', false, null),
  ('a0000000-0000-0000-0000-0000000034c0', false, null),
  ('a0000000-0000-0000-0000-0000000034d0', false, now() + interval '100 years'),
  ('a0000000-0000-0000-0000-0000000034e0', false, '2020-01-01'),
  ('b0000000-0000-0000-0000-000000003401', false, null),
  ('c0000000-0000-0000-0000-000000003401', true, null);

insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-0000000034a0', 'Admin A', 'admin-a-hu034@calibra.test', -3405),
  ('a0000000-0000-0000-0000-0000000034b0', 'Admin B', 'admin-b-hu034@calibra.test', -3404),
  ('a0000000-0000-0000-0000-0000000034c0', 'Admin C', 'admin-c-hu034@calibra.test', -3403),
  ('a0000000-0000-0000-0000-0000000034d0', 'Admin D', 'admin-d-hu034@calibra.test', -3402),
  ('a0000000-0000-0000-0000-0000000034e0', 'Admin E', 'admin-e-hu034@calibra.test', -3401);
insert into public.monitor (id, nombre) values ('b0000000-0000-0000-0000-000000003401', 'Monitor M');
insert into public.materia (id, nombre, codigo) values ('10000000-0000-0000-0000-000000003401', 'Materia HU-034', 'PGTAP-34');
insert into public.certificado (id_monitor, id_materia, id_admin) values
  ('b0000000-0000-0000-0000-000000003401', '10000000-0000-0000-0000-000000003401', 'a0000000-0000-0000-0000-0000000034a0');
insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min) values
  ('30000000-0000-0000-0000-000000003401', 'b0000000-0000-0000-0000-000000003401', 1, '10:00', true, 25000, 60);
insert into public.lead (id, id_sesion_anonima, nombre, correo, acepta_tratamiento_datos, fecha_consentimiento) values
  ('40000000-0000-0000-0000-000000003401', 'c0000000-0000-0000-0000-000000003401', 'Lead Uno', 'lead-01-hu034@calibra.test', true, now());

insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado)
select ('50000000-0000-0000-0000-0000000034' || v.nn)::uuid, '30000000-0000-0000-0000-000000003401',
       '10000000-0000-0000-0000-000000003401', '40000000-0000-0000-0000-000000003401',
       date '2030-01-07' + (v.nn::int - 1) * 7, 25000, 'confirmada'
from (values ('01'), ('02'), ('03'), ('04'), ('05'), ('06'), ('07')) as v(nn);
insert into public.monitoria_grupal (id_monitoria, cupos, modalidad_pago, precio_por_persona) values
  ('50000000-0000-0000-0000-000000003402', 3, 'dividido', 15000);

-- Un pago solo puede apuntar a un comprobante que el servidor revisó (HU-059). No hace falta el archivo.
insert into public.comprobante_revisado (ruta, tipo)
select 'c0000000-0000-0000-0000-000000003401/e3400000-0000-0000-0000-0000000000' || n || '.png', 'image/png'
from (values ('01'), ('02'), ('03'), ('04'), ('05'), ('06'), ('07')) as v(n);

call pg_temp.aislar();
select is(
  (select array_agg(right(id::text, 2) order by orden_revision) from public.admin where privado.admin_activo(id)),
  array['a0', 'b0', 'c0', 'e0'],
  'Control: los activos son A, B, C y E (D tiene el baneo vigente y el de E ya venció), y nadie más');

-- ---------------------------------------------------------------------------
-- Un pago en revisión avisa a cada admin activo, el responsable incluido
-- ---------------------------------------------------------------------------
call pg_temp.aislar();
insert into public.pago (id, id_monitoria, monto, nombre_pagador, contacto, id_admin, comprobante) values
  ('60000000-0000-0000-0000-000000003401', '50000000-0000-0000-0000-000000003401', 25000, 'Pagador 01',
   'pagador-01-hu034@calibra.test', 'a0000000-0000-0000-0000-0000000034a0',
   'c0000000-0000-0000-0000-000000003401/e3400000-0000-0000-0000-000000000001.png');
select results_eq(
  $$select right(id_admin::text, 2) from public.aviso_pago_nuevo
    where id_pago = '60000000-0000-0000-0000-000000003401' order by id_admin$$,
  $$values ('a0'::text), ('b0'), ('c0'), ('e0')$$,
  'Criterio 4: el pago 01 deja una fila por cada admin activo: A (el responsable), B, C y E');
select ok(
  exists (select 1 from public.aviso_pago_nuevo
          where id_pago = '60000000-0000-0000-0000-000000003401' and id_admin = 'a0000000-0000-0000-0000-0000000034a0')
  and exists (select 1 from public.aviso_pago_nuevo
              where id_pago = '60000000-0000-0000-0000-000000003401' and id_admin = 'a0000000-0000-0000-0000-0000000034e0'),
  'El responsable también tiene su aviso, y E, con el baneo vencido, cuenta como activo');
select is(
  (select count(*)::int from public.aviso_pago_nuevo
   where id_pago = '60000000-0000-0000-0000-000000003401' and id_admin = 'a0000000-0000-0000-0000-0000000034d0'),
  0, 'El desactivado (baneo vigente) no tiene aviso');
select results_eq(
  $$select count(*)::int, count(*) filter (where id_responsable = 'a0000000-0000-0000-0000-0000000034a0'),
           count(*) filter (where procesado_en is null and intentos = 0 and creado_en = now())
    from public.aviso_pago_nuevo where id_pago = '60000000-0000-0000-0000-000000003401'$$,
  $$values (4, 4::bigint, 4::bigint)$$,
  'Cada fila nace sin procesar, con cero intentos, anotada en la misma transacción y con A como responsable');

-- ---------------------------------------------------------------------------
-- Una grupal y un pago que nace revisado no avisan
-- ---------------------------------------------------------------------------
call pg_temp.aislar();
insert into public.pago (id, id_monitoria, monto, nombre_pagador, contacto, id_admin, comprobante) values
  ('60000000-0000-0000-0000-000000003402', '50000000-0000-0000-0000-000000003402', 15000, 'Pagador 02',
   'pagador-02-hu034@calibra.test', 'a0000000-0000-0000-0000-0000000034a0',
   'c0000000-0000-0000-0000-000000003401/e3400000-0000-0000-0000-000000000002.png');
insert into public.pago (id, id_monitoria, monto, nombre_pagador, contacto, estado, fecha_revision, id_admin, comprobante) values
  ('60000000-0000-0000-0000-000000003403', '50000000-0000-0000-0000-000000003403', 25000, 'Pagador 03',
   'pagador-03-hu034@calibra.test', 'aprobado', now(), 'a0000000-0000-0000-0000-0000000034a0',
   'c0000000-0000-0000-0000-000000003401/e3400000-0000-0000-0000-000000000003.png');
select results_eq(
  $$select p.estado::text, exists (select 1 from public.monitoria_grupal g where g.id_monitoria = p.id_monitoria)
    from public.pago p where p.id in ('60000000-0000-0000-0000-000000003402', '60000000-0000-0000-0000-000000003403')
    order by p.id$$,
  $$values ('en_revision'::text, true), ('aprobado', false)$$,
  'Control: el pago 02 es de una grupal y llegó en revisión; el 03 es de una individual y llegó aprobado');
select is(
  (select count(*)::int from public.aviso_pago_nuevo where id_pago = '60000000-0000-0000-0000-000000003402'), 0,
  'Un pago de una grupal en revisión no deja ningún aviso (HU-038, D-47)');
select is(
  (select count(*)::int from public.aviso_pago_nuevo where id_pago = '60000000-0000-0000-0000-000000003403'), 0,
  'Un pago que se inserta ya aprobado no deja ningún aviso');

-- ---------------------------------------------------------------------------
-- Repetir el insert no duplica (on conflict do nothing)
-- ---------------------------------------------------------------------------
-- Un pago solo se inserta una vez, así que para que la función corra dos veces con la misma fila se le pone al pago de
-- esta prueba un segundo trigger idéntico. La segunda corrida choca con la única (id_pago, id_admin) y no suma nada.
-- El trigger se deshace con el rollback.
create trigger zz_prueba_repetir_aviso
  after insert on public.pago
  for each row
  when (new.estado = 'en_revision' and new.nombre_pagador = 'Pagador Repite')
  execute function privado.anotar_aviso_pago_nuevo();
select is(
  (select count(*)::int from pg_trigger
   where tgrelid = 'public.pago'::regclass and tgfoid = 'privado.anotar_aviso_pago_nuevo()'::regprocedure and not tgisinternal),
  2, 'Control: pago tiene dos triggers que llaman a anotar_aviso_pago_nuevo, así que correrá dos veces con el mismo pago');
call pg_temp.aislar();
select lives_ok(
  $$insert into public.pago (id, id_monitoria, monto, nombre_pagador, contacto, id_admin, comprobante) values
    ('60000000-0000-0000-0000-000000003404', '50000000-0000-0000-0000-000000003404', 25000, 'Pagador Repite',
     'pagador-04-hu034@calibra.test', 'a0000000-0000-0000-0000-0000000034b0',
     'c0000000-0000-0000-0000-000000003401/e3400000-0000-0000-0000-000000000004.png')$$,
  'El insert con la función corriendo dos veces no falla (on conflict do nothing)');
select results_eq(
  $$select count(*)::int, count(distinct id_admin)::int from public.aviso_pago_nuevo
    where id_pago = '60000000-0000-0000-0000-000000003404'$$,
  $$values (4, 4)$$,
  'Repetir la anotación no duplica: sigue una fila por cada admin activo');
drop trigger zz_prueba_repetir_aviso on public.pago;

-- ---------------------------------------------------------------------------
-- Misma transacción: deshacer el pago deshace los avisos
-- ---------------------------------------------------------------------------
call pg_temp.aislar();
savepoint antes_del_pago;
insert into public.pago (id, id_monitoria, monto, nombre_pagador, contacto, id_admin, comprobante) values
  ('60000000-0000-0000-0000-000000003405', '50000000-0000-0000-0000-000000003405', 25000, 'Pagador 05',
   'pagador-05-hu034@calibra.test', 'a0000000-0000-0000-0000-0000000034a0',
   'c0000000-0000-0000-0000-000000003401/e3400000-0000-0000-0000-000000000005.png');
select is(
  (select count(*)::int from public.aviso_pago_nuevo where id_pago = '60000000-0000-0000-0000-000000003405'), 4,
  'Dentro de un savepoint: el pago 05 ya tiene sus cuatro avisos');
rollback to savepoint antes_del_pago;
select results_eq(
  $$select (select count(*)::int from public.aviso_pago_nuevo where id_pago = '60000000-0000-0000-0000-000000003405'),
           (select count(*)::int from public.pago where id = '60000000-0000-0000-0000-000000003405')$$,
  $$values (0, 0)$$,
  'Al deshacer el pago (rollback to savepoint) no queda ningún aviso: se anotan en la misma transacción');

-- ---------------------------------------------------------------------------
-- id_responsable es la foto del responsable al llegar el pago
-- ---------------------------------------------------------------------------
call pg_temp.aislar();
insert into public.pago (id, id_monitoria, monto, nombre_pagador, contacto, id_admin, comprobante) values
  ('60000000-0000-0000-0000-000000003406', '50000000-0000-0000-0000-000000003406', 25000, 'Pagador 06',
   'pagador-06-hu034@calibra.test', 'a0000000-0000-0000-0000-0000000034c0',
   'c0000000-0000-0000-0000-000000003401/e3400000-0000-0000-0000-000000000006.png');
select ok(
  (select count(*) = 12 and bool_and(a.id_responsable = p.id_admin)
   from public.aviso_pago_nuevo a join public.pago p on p.id = a.id_pago
   where p.id in ('60000000-0000-0000-0000-000000003401', '60000000-0000-0000-0000-000000003404',
                  '60000000-0000-0000-0000-000000003406')),
  'Criterio 4: cada fila guarda como id_responsable el id_admin de su pago al insertar (A, B y C en los pagos 01, 04 y 06)');

-- Un update directo de pago.id_admin no cambia la foto.
update public.pago set id_admin = 'a0000000-0000-0000-0000-0000000034e0' where id = '60000000-0000-0000-0000-000000003406';
select results_eq(
  $$select (select id_admin from public.pago where id = '60000000-0000-0000-0000-000000003406'),
           (select count(*)::int from public.aviso_pago_nuevo
            where id_pago = '60000000-0000-0000-0000-000000003406'
              and id_responsable = 'a0000000-0000-0000-0000-0000000034c0'),
           (select count(*)::int from public.aviso_pago_nuevo where id_pago = '60000000-0000-0000-0000-000000003406')$$,
  $$values ('a0000000-0000-0000-0000-0000000034e0'::uuid, 4, 4)$$,
  'Reasignado el pago 06 a E con un update, sus cuatro avisos siguen diciendo que el responsable era C');

-- Lo que hace HU-074 al desactivar a A: banearlo y reasignar sus pagos en revisión (el 01 y el 02; el 03 está aprobado).
update auth.users set banned_until = now() + interval '100 years' where id = 'a0000000-0000-0000-0000-0000000034a0';
call pg_temp.aislar();
select is(privado.reasignar_casos_de_admin('a0000000-0000-0000-0000-0000000034a0'), 2,
  'privado.reasignar_casos_de_admin mueve los dos pagos en revisión de A (el aprobado se queda con él) y devuelve 2');
select results_eq(
  $$select p.id_admin,
           (select count(*)::int from public.aviso_pago_nuevo a
            where a.id_pago = p.id and a.id_responsable = 'a0000000-0000-0000-0000-0000000034a0'),
           (select count(*)::int from public.aviso_pago_nuevo a where a.id_pago = p.id)
    from public.pago p where p.id = '60000000-0000-0000-0000-000000003401'$$,
  $$values ('a0000000-0000-0000-0000-0000000034b0'::uuid, 4, 4)$$,
  'Criterio 4: el pago 01 pasa a B, y sus cuatro avisos siguen diciendo que el responsable era A; la reasignación no anota avisos nuevos');
select is(
  (select count(*)::int from public.aviso_pago_nuevo where id_pago = '60000000-0000-0000-0000-000000003402'), 0,
  'Y reasignar el pago de la grupal tampoco anota nada');

-- El resumen: solo quedaron los avisos esperados.
select results_eq(
  $$select right(id_pago::text, 2), count(*)::int from public.aviso_pago_nuevo
    where id_pago::text like '60000000-0000-0000-0000-0000000034%' group by id_pago order by id_pago$$,
  $$values ('01'::text, 4), ('04', 4), ('06', 4)$$,
  'En total hay doce avisos: cuatro para cada uno de los pagos 01, 04 y 06, y ninguno para el 02, el 03 ni el 05');

-- ---------------------------------------------------------------------------
-- service_role: lee los avisos y los marca, nada más
-- ---------------------------------------------------------------------------
set local role service_role;
select is(
  (select count(*)::int from public.aviso_pago_nuevo where id_pago::text like '60000000-0000-0000-0000-0000000034%'), 12,
  'service_role lee los avisos (RLS sin políticas no le estorba)');
select lives_ok(
  $$update public.aviso_pago_nuevo set procesado_en = now(), intentos = 1
    where id_pago = '60000000-0000-0000-0000-000000003404' and id_admin = 'a0000000-0000-0000-0000-0000000034b0'$$,
  'service_role marca un aviso como procesado y cuenta un intento');
select throws_ok(
  $$update public.aviso_pago_nuevo set id_responsable = 'a0000000-0000-0000-0000-0000000034b0'
    where id_pago = '60000000-0000-0000-0000-000000003404'$$,
  '42501', null, 'service_role no puede cambiar el responsable');
select throws_ok(
  $$insert into public.aviso_pago_nuevo (id_pago, id_admin, id_responsable) values
    ('60000000-0000-0000-0000-000000003401', 'a0000000-0000-0000-0000-0000000034d0', 'a0000000-0000-0000-0000-0000000034a0')$$,
  '42501', null, 'service_role no puede insertar avisos');
select throws_ok(
  $$delete from public.aviso_pago_nuevo where id_pago = '60000000-0000-0000-0000-000000003404'$$,
  '42501', null, 'service_role no puede borrar avisos');
reset role;
select results_eq(
  $$select procesado_en = now(), intentos from public.aviso_pago_nuevo
    where id_pago = '60000000-0000-0000-0000-000000003404' and id_admin = 'a0000000-0000-0000-0000-0000000034b0'$$,
  $$values (true, 1)$$,
  'El aviso marcado quedó procesado, con un intento');
select throws_ok(
  $$update public.aviso_pago_nuevo set intentos = -1 where id_pago = '60000000-0000-0000-0000-000000003404'$$,
  '23514', null, 'intentos no puede ser negativo');
select throws_ok(
  $$insert into public.aviso_pago_nuevo (id_pago, id_admin, id_responsable) values
    ('60000000-0000-0000-0000-000000003401', 'a0000000-0000-0000-0000-0000000034b0', 'a0000000-0000-0000-0000-0000000034a0')$$,
  '23505', null, 'Un admin no tiene dos avisos del mismo pago (unique id_pago, id_admin)');

-- Borrar el pago borra sus avisos (on delete cascade).
delete from public.pago where id = '60000000-0000-0000-0000-000000003406';
select is((select count(*)::int from public.aviso_pago_nuevo where id_pago = '60000000-0000-0000-0000-000000003406'), 0,
  'Borrar el pago borra sus avisos (on delete cascade)');

-- ---------------------------------------------------------------------------
-- privado.disparar_avisos_pago_nuevo: sin Vault no pide nada y no falla
-- ---------------------------------------------------------------------------
delete from vault.secrets where name in ('calibra_sitio_url', 'calibra_cron_secreto');
select ok(
  not exists (select 1 from vault.decrypted_secrets where name in ('calibra_sitio_url', 'calibra_cron_secreto')),
  'Control: Vault no trae calibra_sitio_url ni calibra_cron_secreto');
select ok(
  exists (select 1 from public.aviso_pago_nuevo where procesado_en is null and id_pago::text like '60000000-0000-0000-0000-0000000034%'),
  'Control: hay avisos pendientes (los de esta prueba)');
select is(privado.disparar_avisos_pago_nuevo(), null::bigint,
  'Con avisos pendientes pero sin configuración en Vault devuelve null y no falla (así en local)');
select vault.create_secret('https://calibra.test/', 'calibra_sitio_url');
select is(privado.disparar_avisos_pago_nuevo(), null::bigint,
  'Con la dirección de la app pero sin el secreto tampoco pide nada');
select vault.create_secret('secreto-de-prueba-con-al-menos-treinta-y-dos-caracteres', 'calibra_cron_secreto');
select isnt(privado.disparar_avisos_pago_nuevo(), null::bigint,
  'Con los dos secretos en Vault y avisos pendientes sí pide el procesamiento: devuelve el id de la petición de pg_net');
delete from vault.secrets where name in ('calibra_sitio_url', 'calibra_cron_secreto');
update public.aviso_pago_nuevo set procesado_en = now() where procesado_en is null;
select is(privado.disparar_avisos_pago_nuevo(), null::bigint,
  'Sin avisos pendientes devuelve null');

-- ---------------------------------------------------------------------------
-- Si el pedido a la app falla, el pago se guarda igual
-- ---------------------------------------------------------------------------
-- Se reemplaza disparar_avisos_pago_nuevo por una que falla; el reemplazo se deshace con el rollback. Va al final.
create or replace function privado.disparar_avisos_pago_nuevo()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'falla de prueba: pg_net no responde';
end;
$$;

call pg_temp.aislar();
select lives_ok(
  $$insert into public.pago (id, id_monitoria, monto, nombre_pagador, contacto, id_admin, comprobante) values
    ('60000000-0000-0000-0000-000000003407', '50000000-0000-0000-0000-000000003407', 25000, 'Pagador 07',
     'pagador-07-hu034@calibra.test', 'a0000000-0000-0000-0000-0000000034b0',
     'c0000000-0000-0000-0000-000000003401/e3400000-0000-0000-0000-000000000007.png')$$,
  'Con el pedido a la app fallando, registrar el pago no falla');
select results_eq(
  $$select right(a.id_admin::text, 2), a.procesado_en is null, p.estado::text
    from public.aviso_pago_nuevo a join public.pago p on p.id = a.id_pago
    where a.id_pago = '60000000-0000-0000-0000-000000003407' order by a.id_admin$$,
  $$values ('b0'::text, true, 'en_revision'::text), ('c0', true, 'en_revision'), ('e0', true, 'en_revision')$$,
  'El pago queda en revisión y los avisos anotados y pendientes (B, C y E; A ya está desactivado): pg_cron los vuelve a pedir');

select * from finish();
rollback;
