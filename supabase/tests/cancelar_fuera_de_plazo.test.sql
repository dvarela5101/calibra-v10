-- Pruebas pgTAP de autorizar una cancelación fuera de plazo (HU-052, RN-60, RN-43, RN-33, RN-35, RN-64, P-07, P-40, D-16, D-19,
-- D-26, D-27, D-28, D-60).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.
--
-- Qué cubre la migración 20261011173441_cancelacion_fuera_de_plazo.sql:
--   * Estructura y permisos de lo nuevo: public.cancelacion_excepcional (RLS con una sola política «admin lee», sin escritura
--     para nadie con sesión, checks de categoría y nota), la vista public.citas_sin_plazo_para_cancelar, el núcleo
--     privado.cancelar_cita_con_permiso, el texto del motivo privado.motivo_de_cancelacion_del_estudiante y la puerta de tres
--     capas (la versión con p_ahora, la de la sesión y la pública). privado.cancelar_cita conserva su firma, su definer, su
--     search_path y sus permisos: ahora es una envoltura (cancelar_cita.test.sql lo comprueba sin editarse).
--   * Cada resultado de la puerta y su orden (quién puede, antes que el texto), con una foto de todo lo que cuelga de la
--     monitoría antes y después: ninguno de los que no autorizan toca nada.
--   * Los bordes del plazo y del inicio (P-40, RN-64) con p_ahora fijo, la defensa del reporte de inasistencia ya creado, y que
--     la rama sin admin (el Lead, HU-024) sigue igual.
--   * Autorizar: la monitoría cancelada por `estudiante`, la fila de registro (quién, cuándo, categoría y nota recortada), un
--     reembolso por pago aprobado al primer admin activo con el motivo de la autorización, su solicitud y su pedido de llave,
--     la cancelación para el correo del Lead, el aviso al monitor, y nada de eso por los pagos rechazados o en revisión.
--   * La fecha que queda libre (RN-33) y la antelación para agendarla otra vez (RN-35).
--   * P-07: el pago en revisión que se aprueba después recibe su reembolso con el mismo motivo; el que se rechaza, no (y el
--     aviso al pagador dice que la cita ya estaba cancelada). La cancelación a tiempo, la inasistencia y las grupales siguen igual.
--   * La vista: los bordes de las 12 h y del inicio con la hora de la base, y quién la ve.
-- Lo que necesita dos conexiones (los candados, el doble clic de verdad, el admin desactivado mientras espera) lo cubre la
-- prueba de integración.
--
-- Las monitorías del núcleo caen en lunes de 2031 (en el futuro: ningún trabajo de pg_cron las toca); las autorizaciones se llaman
-- con p_ahora fijo (la noche anterior a cada cita, a las 22:00 en Bogotá: pasado el plazo de 12 h y antes del inicio), salvo las
-- puertas y la vista, que usan la hora de la base y monitorías relativas a ella.
--
-- El turno de admins recorre a TODOS los admins de la base: los que ya existían se banean dentro de la transacción y los de esta
-- prueba llevan un orden_revision negativo, por delante de cualquier otro (A antes que B).
--
-- Elenco (ids terminados en 52NN; la materia es 'PGTAP-52'; los pagos son 6000...52NNpp):
--   Admins A (el primero del turno), B (activo) y C (desactivado). Monitor M con su llave. Leads L1 (Lucía, con correo), L2
--   (Mateo, con correo) y L3 (Sofía, sin correo, D-19), cada uno con su sesión anónima S1, S2 y S3.
--   Monitorías (la cita de los lunes de 2031 es a las 9:30 en Bogotá; el plazo de la del 10-mar termina el domingo 9 a las 21:30):
--     01 confirmada del 10-mar: los resultados que no escriben y los bordes   02 grupal confirmada   03 por pagar
--     04 realizada   05 cancelada por monitor_no_asistio   06 cancelada por pago_rechazado   07 cancelada por el estudiante
--     08 y 09 confirmadas sin pagos: los checks de la tabla y la cascada   10 borde 21:30:01   11 borde 09:29:59
--     12 con un reporte de inasistencia   20 B autoriza «otro» (cuatro pagos, dos contactos)   21 B autoriza fuerza mayor (Lead
--     sin correo)   22 A autoriza una falla de Calibra   23 «otro» con 500 caracteres, sin pagos   25 P-07 (tres pagos)
--     26 el Lead cancela a tiempo (regresión)   27 grupal cancelada por el estudiante   30 la puerta con now()
--     40 a 49 la vista (relativas a now())

begin;
create extension if not exists pgtap with schema extensions;

select plan(150);

-- ---------------------------------------------------------------------------
-- Existencia, permisos y forma de lo nuevo
-- ---------------------------------------------------------------------------
select has_table('public', 'cancelacion_excepcional', 'Existe public.cancelacion_excepcional, el registro de las autorizaciones');
select has_view('public', 'citas_sin_plazo_para_cancelar', 'Existe la vista public.citas_sin_plazo_para_cancelar');
select has_function('privado', 'cancelar_cita_con_permiso', array['uuid', 'timestamp with time zone', 'uuid', 'text', 'text'],
  'Existe privado.cancelar_cita_con_permiso, el núcleo de la cancelación (con o sin admin)');
select has_function('privado', 'cancelar_cita', array['uuid', 'timestamp with time zone'],
  'privado.cancelar_cita conserva su firma (id, ahora): las pruebas y las puertas de HU-024 la siguen llamando');
select has_function('privado', 'motivo_de_cancelacion_del_estudiante', array['uuid'],
  'Existe privado.motivo_de_cancelacion_del_estudiante, el único texto del motivo del reembolso');
select has_function('privado', 'autorizar_cancelacion_fuera_de_plazo', array['uuid', 'text', 'text', 'timestamp with time zone'],
  'Existe privado.autorizar_cancelacion_fuera_de_plazo, la que escribe, con la hora como parámetro (para probar los bordes)');
select has_function('privado', 'autorizar_cancelacion_fuera_de_plazo_de_la_sesion', array['uuid', 'text', 'text'],
  'Existe su envoltorio de la sesión, con now()');
select has_function('public', 'autorizar_cancelacion_fuera_de_plazo', array['uuid', 'text', 'text'],
  'Existe su puerta en la Data API');
select ok(
  (select bool_and(prosecdef) from pg_proc
   where oid in ('privado.cancelar_cita_con_permiso(uuid, timestamptz, uuid, text, text)'::regprocedure,
                 'privado.cancelar_cita(uuid, timestamptz)'::regprocedure,
                 'privado.autorizar_cancelacion_fuera_de_plazo(uuid, text, text, timestamptz)'::regprocedure,
                 'privado.autorizar_cancelacion_fuera_de_plazo_de_la_sesion(uuid, text, text)'::regprocedure))
  and not (select bool_or(prosecdef) from pg_proc
           where oid in ('public.autorizar_cancelacion_fuera_de_plazo(uuid, text, text)'::regprocedure,
                         'privado.motivo_de_cancelacion_del_estudiante(uuid)'::regprocedure)),
  'El núcleo, la envoltura y las dos de la sesión (en privado) son security definer; la de public corre con los permisos de quien llama y el motivo es una función de lectura');
select ok(
  (select bool_and('search_path=""' = any(proconfig)) from pg_proc
   where oid in ('privado.cancelar_cita_con_permiso(uuid, timestamptz, uuid, text, text)'::regprocedure,
                 'privado.cancelar_cita(uuid, timestamptz)'::regprocedure,
                 'privado.motivo_de_cancelacion_del_estudiante(uuid)'::regprocedure,
                 'privado.autorizar_cancelacion_fuera_de_plazo(uuid, text, text, timestamptz)'::regprocedure,
                 'privado.autorizar_cancelacion_fuera_de_plazo_de_la_sesion(uuid, text, text)'::regprocedure,
                 'public.autorizar_cancelacion_fuera_de_plazo(uuid, text, text)'::regprocedure)),
  'Las seis fijan un search_path vacío');
select is(
  array[pg_get_function_identity_arguments('public.autorizar_cancelacion_fuera_de_plazo(uuid, text, text)'::regprocedure),
        pg_get_function_identity_arguments('privado.autorizar_cancelacion_fuera_de_plazo_de_la_sesion(uuid, text, text)'::regprocedure)],
  array['p_id_monitoria uuid, p_categoria text, p_nota text', 'p_id_monitoria uuid, p_categoria text, p_nota text'],
  'Las que llama la sesión no reciben el admin ni la hora: nadie autoriza a nombre de otro ni elige la fecha de la autorización');
select is(
  array[pg_get_function_identity_arguments('privado.cancelar_cita(uuid, timestamptz)'::regprocedure),
        pg_get_function_identity_arguments('privado.cancelar_cita_con_permiso(uuid, timestamptz, uuid, text, text)'::regprocedure)],
  array['p_id_monitoria uuid, p_ahora timestamp with time zone',
        'p_id_monitoria uuid, p_ahora timestamp with time zone, p_id_admin uuid, p_categoria text, p_nota text'],
  'La envoltura conserva los nombres de sus parámetros (Postgres no deja cambiarlos) y el núcleo recibe además el admin, la categoría y la nota');
select is(
  array[pg_get_function_result('public.autorizar_cancelacion_fuera_de_plazo(uuid, text, text)'::regprocedure),
        pg_get_function_result('privado.cancelar_cita_con_permiso(uuid, timestamptz, uuid, text, text)'::regprocedure),
        pg_get_function_result('privado.cancelar_cita(uuid, timestamptz)'::regprocedure),
        pg_get_function_result('privado.motivo_de_cancelacion_del_estudiante(uuid)'::regprocedure)],
  array['text', 'text', 'text', 'text'],
  'Todas devuelven el resultado o el motivo en texto');
select is(
  (select array_agg(l.lanname::text order by p.proname)
   from pg_proc p join pg_language l on l.oid = p.prolang
   where p.oid in ('privado.cancelar_cita(uuid, timestamptz)'::regprocedure,
                   'privado.cancelar_cita_con_permiso(uuid, timestamptz, uuid, text, text)'::regprocedure)),
  array['sql', 'plpgsql'],
  'La envoltura es una función sql que solo llama al núcleo (no hay una segunda copia del cuerpo de la cancelación) y el núcleo es plpgsql');
select is(
  array[(select p.provolatile::text from pg_proc p where p.oid = 'privado.cancelar_cita(uuid, timestamptz)'::regprocedure),
        (select p.provolatile::text from pg_proc p where p.oid = 'privado.cancelar_cita_con_permiso(uuid, timestamptz, uuid, text, text)'::regprocedure),
        (select p.provolatile::text from pg_proc p where p.oid = 'privado.motivo_de_cancelacion_del_estudiante(uuid)'::regprocedure)],
  array['v', 'v', 's'],
  'La envoltura y el núcleo escriben (volatile); el motivo solo lee (stable)');
select ok(
  not exists (
    select 1
    from unnest(array['privado.cancelar_cita_con_permiso(uuid, timestamptz, uuid, text, text)',
                      'privado.cancelar_cita(uuid, timestamptz)',
                      'privado.motivo_de_cancelacion_del_estudiante(uuid)',
                      'privado.autorizar_cancelacion_fuera_de_plazo(uuid, text, text, timestamptz)',
                      'privado.autorizar_cancelacion_fuera_de_plazo_de_la_sesion(uuid, text, text)',
                      'public.autorizar_cancelacion_fuera_de_plazo(uuid, text, text)']) f
    where has_function_privilege('anon', f, 'execute') or has_function_privilege('service_role', f, 'execute')),
  'Ni anon ni service_role ejecutan ninguna: sin sesión no hay admin');
select ok(
  has_function_privilege('authenticated', 'public.autorizar_cancelacion_fuera_de_plazo(uuid, text, text)', 'execute')
  and has_function_privilege('authenticated', 'privado.autorizar_cancelacion_fuera_de_plazo_de_la_sesion(uuid, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'privado.autorizar_cancelacion_fuera_de_plazo(uuid, text, text, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'privado.cancelar_cita_con_permiso(uuid, timestamptz, uuid, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'privado.cancelar_cita(uuid, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'privado.motivo_de_cancelacion_del_estudiante(uuid)', 'execute'),
  'Con sesión solo la puerta y su envoltorio con now(): la versión con la hora, el núcleo, la envoltura y el motivo son internos');
select ok(
  not exists (
    select 1
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid in ('privado.cancelar_cita_con_permiso(uuid, timestamptz, uuid, text, text)'::regprocedure,
                    'privado.cancelar_cita(uuid, timestamptz)'::regprocedure,
                    'privado.motivo_de_cancelacion_del_estudiante(uuid)'::regprocedure,
                    'privado.autorizar_cancelacion_fuera_de_plazo(uuid, text, text, timestamptz)'::regprocedure,
                    'privado.autorizar_cancelacion_fuera_de_plazo_de_la_sesion(uuid, text, text)'::regprocedure,
                    'public.autorizar_cancelacion_fuera_de_plazo(uuid, text, text)'::regprocedure)
      and a.grantee = 0),
  'Nadie las hereda de PUBLIC');
select ok(
  obj_description('public.autorizar_cancelacion_fuera_de_plazo(uuid, text, text)'::regprocedure, 'pg_proc') is not null
  and obj_description('privado.autorizar_cancelacion_fuera_de_plazo(uuid, text, text, timestamptz)'::regprocedure, 'pg_proc') is not null
  and obj_description('privado.autorizar_cancelacion_fuera_de_plazo_de_la_sesion(uuid, text, text)'::regprocedure, 'pg_proc') is not null
  and obj_description('privado.cancelar_cita_con_permiso(uuid, timestamptz, uuid, text, text)'::regprocedure, 'pg_proc') is not null
  and obj_description('privado.cancelar_cita(uuid, timestamptz)'::regprocedure, 'pg_proc') is not null
  and obj_description('privado.motivo_de_cancelacion_del_estudiante(uuid)'::regprocedure, 'pg_proc') is not null
  and obj_description('public.cancelacion_excepcional'::regclass, 'pg_class') is not null
  and obj_description('public.citas_sin_plazo_para_cancelar'::regclass, 'pg_class') is not null,
  'Las seis funciones, la tabla y la vista tienen comentario');

-- Sin permiso ni se ejecutan.
set local role anon;
select throws_ok(
  $$select public.autorizar_cancelacion_fuera_de_plazo('50000000-0000-0000-0000-000000005201', 'fuerza_mayor', null)$$,
  '42501', null, 'anon no puede autorizar: permiso denegado');
select throws_ok(
  $$select privado.autorizar_cancelacion_fuera_de_plazo('50000000-0000-0000-0000-000000005201', 'fuerza_mayor', null, now())$$,
  '42501', null, 'Ni llamar la versión que recibe la hora');
select throws_ok(
  $$select privado.cancelar_cita_con_permiso('50000000-0000-0000-0000-000000005201', now(), 'a0000000-0000-0000-0000-0000000052a0', 'fuerza_mayor', null)$$,
  '42501', null, 'Ni el núcleo, diciendo que es un admin');
select throws_ok($$select privado.cancelar_cita('50000000-0000-0000-0000-000000005201', now())$$, '42501', null,
  'Ni la envoltura de la cancelación');
select throws_ok($$select privado.motivo_de_cancelacion_del_estudiante('50000000-0000-0000-0000-000000005201')$$, '42501', null,
  'Ni el motivo');
reset role;
set local role service_role;
select throws_ok(
  $$select public.autorizar_cancelacion_fuera_de_plazo('50000000-0000-0000-0000-000000005201', 'fuerza_mayor', null)$$,
  '42501', null, 'service_role tampoco: no es un admin con sesión');
select throws_ok(
  $$select privado.autorizar_cancelacion_fuera_de_plazo('50000000-0000-0000-0000-000000005201', 'fuerza_mayor', null, now())$$,
  '42501', null, 'Ni la versión que recibe la hora');
select throws_ok(
  $$select privado.cancelar_cita_con_permiso('50000000-0000-0000-0000-000000005201', now(), 'a0000000-0000-0000-0000-0000000052a0', 'fuerza_mayor', null)$$,
  '42501', null, 'Ni el núcleo');
select throws_ok($$select privado.cancelar_cita('50000000-0000-0000-0000-000000005201', now())$$, '42501', null,
  'Ni la envoltura de la cancelación');
select throws_ok($$select privado.motivo_de_cancelacion_del_estudiante('50000000-0000-0000-0000-000000005201')$$, '42501', null,
  'Ni el motivo');
reset role;
set local role authenticated;
select throws_ok(
  $$select privado.autorizar_cancelacion_fuera_de_plazo('50000000-0000-0000-0000-000000005201', 'fuerza_mayor', null, now())$$,
  '42501', null, 'Una sesión no llama a la versión que recibe la hora: permiso denegado');
select throws_ok(
  $$select privado.cancelar_cita_con_permiso('50000000-0000-0000-0000-000000005201', now(), 'a0000000-0000-0000-0000-0000000052a0', 'fuerza_mayor', null)$$,
  '42501', null, 'Ni al núcleo con el admin que ella quiera');
select throws_ok($$select privado.cancelar_cita('50000000-0000-0000-0000-000000005201', now())$$, '42501', null,
  'Ni a la envoltura con la hora que quiera');
select throws_ok($$select privado.motivo_de_cancelacion_del_estudiante('50000000-0000-0000-0000-000000005201')$$, '42501', null,
  'Ni al motivo');
reset role;

-- La tabla: forma y permisos.
select columns_are('public', 'cancelacion_excepcional', array['id_monitoria', 'id_admin', 'categoria', 'nota', 'autorizada_en'],
  'Sus columnas son la monitoría, el admin, la categoría, la nota y cuándo se autorizó');
select col_is_pk('public', 'cancelacion_excepcional', 'id_monitoria',
  'Una fila por monitoría: la llave primaria es otra defensa contra una segunda autorización');
select is(
  array[(select confdeltype::text from pg_constraint
         where conrelid = 'public.cancelacion_excepcional'::regclass and contype = 'f' and confrelid = 'public.monitoria'::regclass),
        (select confdeltype::text from pg_constraint
         where conrelid = 'public.cancelacion_excepcional'::regclass and contype = 'f' and confrelid = 'public.admin'::regclass)],
  array['c', 'a'],
  'Se borra con su monitoría (cascada, como cancelacion_cita) pero un admin con autorizaciones no se puede borrar (sin cascada, RN-23)');
select ok((select relrowsecurity from pg_class where oid = 'public.cancelacion_excepcional'::regclass),
  'RLS está activo en cancelacion_excepcional');
select is(
  (select string_agg(policyname::text || '|' || cmd::text || '|' || array_to_string(roles, ','), ';') from pg_policies
   where schemaname = 'public' and tablename = 'cancelacion_excepcional'),
  'admin lee|SELECT|authenticated',
  'Una sola política: «admin lee», de lectura, para authenticated (la condición dice quién)');
select ok(
  not exists (
    select 1
    from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where c.oid in ('public.cancelacion_excepcional'::regclass, 'public.citas_sin_plazo_para_cancelar'::regclass) and a.grantee = 0),
  'Ni la tabla ni la vista se heredan de PUBLIC');
select ok(
  not has_any_column_privilege('anon', 'public.cancelacion_excepcional', 'select')
  and not has_any_column_privilege('anon', 'public.cancelacion_excepcional', 'insert')
  and not has_any_column_privilege('anon', 'public.cancelacion_excepcional', 'update')
  and not has_any_column_privilege('anon', 'public.cancelacion_excepcional', 'references')
  and not has_table_privilege('anon', 'public.cancelacion_excepcional', 'delete')
  and not has_table_privilege('anon', 'public.cancelacion_excepcional', 'truncate')
  and not has_table_privilege('anon', 'public.cancelacion_excepcional', 'trigger'),
  'anon no tiene ningún permiso sobre la tabla');
select ok(
  has_table_privilege('authenticated', 'public.cancelacion_excepcional', 'select')
  and not has_any_column_privilege('authenticated', 'public.cancelacion_excepcional', 'insert')
  and not has_any_column_privilege('authenticated', 'public.cancelacion_excepcional', 'update')
  and not has_any_column_privilege('authenticated', 'public.cancelacion_excepcional', 'references')
  and not has_table_privilege('authenticated', 'public.cancelacion_excepcional', 'delete')
  and not has_table_privilege('authenticated', 'public.cancelacion_excepcional', 'truncate')
  and not has_table_privilege('authenticated', 'public.cancelacion_excepcional', 'trigger'),
  'authenticated solo la lee (la política dice quién): nadie con sesión escribe, ni un admin');
select ok(
  has_table_privilege('service_role', 'public.cancelacion_excepcional', 'select')
  and not has_any_column_privilege('service_role', 'public.cancelacion_excepcional', 'insert')
  and not has_any_column_privilege('service_role', 'public.cancelacion_excepcional', 'update')
  and not has_any_column_privilege('service_role', 'public.cancelacion_excepcional', 'references')
  and not has_table_privilege('service_role', 'public.cancelacion_excepcional', 'delete')
  and not has_table_privilege('service_role', 'public.cancelacion_excepcional', 'truncate')
  and not has_table_privilege('service_role', 'public.cancelacion_excepcional', 'trigger'),
  'service_role solo la lee (las pruebas con la llave secreta); la escribe únicamente el núcleo');
select ok(
  exists (select 1 from pg_class c, unnest(c.reloptions) o
          where c.oid = 'public.citas_sin_plazo_para_cancelar'::regclass and o = 'security_invoker=true')
  and has_table_privilege('authenticated', 'public.citas_sin_plazo_para_cancelar', 'select')
  and not has_any_column_privilege('authenticated', 'public.citas_sin_plazo_para_cancelar', 'insert')
  and not has_any_column_privilege('authenticated', 'public.citas_sin_plazo_para_cancelar', 'update')
  and not has_table_privilege('authenticated', 'public.citas_sin_plazo_para_cancelar', 'delete')
  and not has_any_column_privilege('anon', 'public.citas_sin_plazo_para_cancelar', 'select')
  and not has_any_column_privilege('service_role', 'public.citas_sin_plazo_para_cancelar', 'select'),
  'La vista corre con los permisos de quien la lee y solo la lee authenticated: ni anon ni service_role (es_admin() no se ejecuta con la llave secreta)');
select is(
  (select array_agg(a.attname::text order by a.attnum) from pg_attribute a
   where a.attrelid = 'public.citas_sin_plazo_para_cancelar'::regclass and a.attnum > 0 and not a.attisdropped),
  array['id_monitoria', 'inicio', 'cancelable_hasta'],
  'La vista devuelve solo la monitoría, su inicio y el fin de su plazo: lo demás se lee con los permisos de cada tabla');

-- ---------------------------------------------------------------------------
-- Fixtures (como postgres)
-- ---------------------------------------------------------------------------
-- La prueba no depende de lo que haya en Vault: sin los secretos de la app, ningún trigger le pide nada a pg_net.
delete from vault.secrets where name in ('calibra_sitio_url', 'calibra_cron_secreto');

-- Cualquier admin que ya existiera queda inactivo durante la prueba.
update auth.users set banned_until = 'infinity' where id in (select id from public.admin);

insert into auth.users (id, is_anonymous, banned_until) values
  ('a0000000-0000-0000-0000-0000000052a0', false, null),
  ('a0000000-0000-0000-0000-0000000052b0', false, null),
  ('a0000000-0000-0000-0000-0000000052c0', false, 'infinity'),
  ('b0000000-0000-0000-0000-000000005201', false, null),
  ('c0000000-0000-0000-0000-000000005201', true, null),
  ('c0000000-0000-0000-0000-000000005202', true, null),
  ('c0000000-0000-0000-0000-000000005203', true, null);

insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-0000000052a0', 'Admin A', 'admin-a-hu052@calibra.test', -5200),
  ('a0000000-0000-0000-0000-0000000052b0', 'Admin B', 'admin-b-hu052@calibra.test', -5199),
  ('a0000000-0000-0000-0000-0000000052c0', 'Admin C', 'admin-c-hu052@calibra.test', -5198);
insert into public.monitor (id, nombre) values ('b0000000-0000-0000-0000-000000005201', 'Ana 52');
insert into public.monitor_privado (id_monitor, numero_telefono, correo, llave) values
  ('b0000000-0000-0000-0000-000000005201', '3005200001', 'ana.monitora52@calibra.test', 'llave-ana-52');
insert into public.materia (id, nombre, codigo) values ('10000000-0000-0000-0000-000000005201', 'Materia 52', 'PGTAP-52');
insert into public.certificado (id_monitor, id_materia, id_admin) values
  ('b0000000-0000-0000-0000-000000005201', '10000000-0000-0000-0000-000000005201', 'a0000000-0000-0000-0000-0000000052a0');
insert into public.lead (id, id_sesion_anonima, nombre, numero_telefono, correo, acepta_tratamiento_datos, fecha_consentimiento) values
  ('40000000-0000-0000-0000-000000005201', 'c0000000-0000-0000-0000-000000005201', 'Lucía Prueba 52', '3005211111',
   'lucia52@calibra.test', true, now()),
  ('40000000-0000-0000-0000-000000005202', 'c0000000-0000-0000-0000-000000005202', 'Mateo Prueba 52', '3005222222',
   'mateo52@calibra.test', true, now()),
  ('40000000-0000-0000-0000-000000005203', 'c0000000-0000-0000-0000-000000005203', 'Sofía Prueba 52', '3005233333',
   null, true, now());

-- aislar(): vuelve a desactivar a cualquier admin que no sea de la prueba (otras pruebas pueden crear admins mientras corre).
create procedure pg_temp.aislar()
language sql security definer set search_path = ''
as $$
  update auth.users set banned_until = 'infinity'
  where id in (select id from public.admin
               where id not in ('a0000000-0000-0000-0000-0000000052a0', 'a0000000-0000-0000-0000-0000000052b0',
                                'a0000000-0000-0000-0000-0000000052c0'))
    and (banned_until is null or banned_until <= now());
$$;
call pg_temp.aislar();

-- Franjas fijas: todas los lunes a las 9:30 en Bogotá, virtuales de 60 min.
insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min, lugar, enlace, abierta_desde)
select ('30000000-0000-0000-0000-0000000052' || nn)::uuid, 'b0000000-0000-0000-0000-000000005201'::uuid, smallint '1',
       time '09:30', false, 20000, 60, null, 'https://meet.example/52-' || nn, date '2019-01-01'
from unnest(array['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '20', '21', '22', '23', '25', '26',
                  '27']) as nn;

-- Franjas relativas a now() (la hora de la base no cambia dentro de la transacción): la de la puerta (empieza dentro de
-- 2 h 30 min) y las de la vista (sus bordes). El día de la semana y la hora son los que le tocan en Bogotá, con segundos y
-- microsegundos.
create temporary table inicio_52 (nn text primary key, inicio timestamptz not null);
insert into inicio_52 (nn, inicio) values
  ('30', date_trunc('minute', now() + interval '2 hours 30 minutes')),
  ('40', now() + interval '11 hours 59 minutes 59 seconds'),
  ('41', now() + interval '12 hours'),
  ('42', now() + interval '12 hours 1 second'),
  ('43', now() + interval '1 second'),
  ('44', now()),
  ('45', now() - interval '1 second'),
  ('46', now() + interval '1 hour'),
  ('47', now() + interval '1 hour'),
  ('48', now() + interval '1 hour'),
  ('49', now() + interval '1 hour');
insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min, lugar, enlace, abierta_desde)
select ('30000000-0000-0000-0000-0000000052' || nn)::uuid, 'b0000000-0000-0000-0000-000000005201'::uuid,
       extract(isodow from (inicio at time zone 'America/Bogota')::date)::smallint,
       (inicio at time zone 'America/Bogota')::time, false, 20000, 60, null, 'https://meet.example/52-' || nn, date '2019-01-01'
from inicio_52;

-- Monitorías fijas. Las de 2031 son lunes desde el 10 de marzo.
insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado, motivo_cancelacion, fecha_finalizacion)
select ('50000000-0000-0000-0000-0000000052' || v.nn)::uuid, ('30000000-0000-0000-0000-0000000052' || v.nn)::uuid,
       '10000000-0000-0000-0000-000000005201'::uuid,
       case v.nn when '20' then '40000000-0000-0000-0000-000000005202'::uuid
                 when '21' then '40000000-0000-0000-0000-000000005203'::uuid
                 else '40000000-0000-0000-0000-000000005201'::uuid end,
       v.fecha, 20000, v.estado, v.motivo, v.finalizada
from (values
  ('01', date '2031-03-10', 'confirmada'::public.estado_monitoria, null::public.motivo_cancelacion, null::timestamptz),
  ('02', date '2031-03-17', 'confirmada', null, null),
  ('03', date '2031-03-24', 'pendiente_pago', null, null),
  ('04', date '2031-03-31', 'realizada', null, timestamptz '2031-03-31 11:00-05'),
  ('05', date '2031-04-07', 'cancelada', 'monitor_no_asistio', null),
  ('06', date '2031-04-14', 'cancelada', 'pago_rechazado', null),
  ('07', date '2031-04-21', 'cancelada', 'estudiante', null),
  ('08', date '2031-04-28', 'confirmada', null, null),
  ('09', date '2031-05-05', 'confirmada', null, null),
  ('10', date '2031-03-10', 'confirmada', null, null),
  ('11', date '2031-03-10', 'confirmada', null, null),
  ('12', date '2031-03-10', 'confirmada', null, null),
  ('20', date '2031-05-12', 'confirmada', null, null),
  ('21', date '2031-05-19', 'confirmada', null, null),
  ('22', date '2031-05-26', 'confirmada', null, null),
  ('23', date '2031-06-02', 'confirmada', null, null),
  ('25', date '2031-06-09', 'confirmada', null, null),
  ('26', date '2031-06-16', 'confirmada', null, null),
  ('27', date '2031-06-23', 'cancelada', 'estudiante', null)) as v(nn, fecha, estado, motivo, finalizada);
-- Las relativas a now(): confirmadas, salvo la de la vista que está por pagar (46), cancelada (47) y realizada (48).
insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado, motivo_cancelacion, fecha_finalizacion)
select ('50000000-0000-0000-0000-0000000052' || i.nn)::uuid, ('30000000-0000-0000-0000-0000000052' || i.nn)::uuid,
       '10000000-0000-0000-0000-000000005201'::uuid, '40000000-0000-0000-0000-000000005201'::uuid,
       (i.inicio at time zone 'America/Bogota')::date, 20000,
       case i.nn when '46' then 'pendiente_pago' when '47' then 'cancelada' when '48' then 'realizada'
                 else 'confirmada' end::public.estado_monitoria,
       case i.nn when '47' then 'estudiante' end::public.motivo_cancelacion,
       case i.nn when '48' then now() end
from inicio_52 i;

-- Las grupales: la 02, la 27 y la 49.
insert into public.monitoria_grupal (id_monitoria, cupos, modalidad_pago, precio_por_persona) values
  ('50000000-0000-0000-0000-000000005202', 3, 'dividido', 15000),
  ('50000000-0000-0000-0000-000000005227', 3, 'dividido', 15000),
  ('50000000-0000-0000-0000-000000005249', 3, 'dividido', 15000);

-- Los pagos (todos de A, del contacto 'pagador.secreto52' salvo que se diga otro). Los montos de las citas con reembolsos son
-- distintos entre sí para que cada reembolso se reconozca por su monto.
create temporary table pago_52 (
  id text primary key,
  estado public.estado_pago not null,
  monto integer not null default 20000,
  contacto text not null default 'pagador.secreto52@example.com'
);
insert into pago_52 (id, estado, monto, contacto) values
  ('0101', 'aprobado', default, default), ('0401', 'aprobado', default, default), ('0501', 'en_revision', default, default),
  ('0701', 'aprobado', default, default),
  ('1001', 'aprobado', default, default), ('1101', 'aprobado', default, default), ('1201', 'aprobado', default, default),
  ('2001', 'aprobado', 31000, 'mateo52@calibra.test'), ('2002', 'aprobado', 42000, 'otro.pagador52@example.com'),
  ('2003', 'rechazado', 17000, default), ('2004', 'en_revision', 18000, default),
  ('2101', 'aprobado', 25000, 'sofia52@example.com'),
  ('2201', 'aprobado', 26000, default),
  ('2501', 'aprobado', 27000, default), ('2502', 'en_revision', 28000, default), ('2503', 'en_revision', 29000, default),
  ('2601', 'aprobado', 33000, default), ('2602', 'en_revision', 34000, default),
  ('2701', 'en_revision', default, default),
  ('3001', 'aprobado', 35000, default);
insert into public.comprobante_revisado (ruta, tipo)
select 'c0000000-0000-0000-0000-000000005201/60000000-0000-0000-0000-00000052' || id || '.pdf', 'application/pdf' from pago_52;
insert into public.pago (id, id_monitoria, monto, nombre_pagador, contacto, estado, id_admin, fecha_pago, fecha_revision, comprobante)
select ('60000000-0000-0000-0000-00000052' || id)::uuid, ('50000000-0000-0000-0000-0000000052' || left(id, 2))::uuid, monto,
       'Pagador Secreto 52', contacto, estado, 'a0000000-0000-0000-0000-0000000052a0',
       timestamptz '2020-01-01 10:00-05', case when estado = 'en_revision' then null else now() end,
       'c0000000-0000-0000-0000-000000005201/60000000-0000-0000-0000-00000052' || id || '.pdf'
from pago_52;

-- Ayudas de la prueba (solo como postgres).
-- autorizar_id(admin, id, categoría, nota[, ahora]): llama a la autorización con la identidad de ese usuario (nulo, una sesión sin
-- sub) y la hora fija; devuelve el resultado. autorizar(admin, nn, ...) lo hace sobre la monitoría 52nn.
create function pg_temp.autorizar_id(p_uid text, p_id uuid, p_categoria text, p_nota text,
                                     p_ahora timestamptz default timestamptz '2031-03-09 22:00-05') returns text
language plpgsql volatile as $$
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null then '{"role":"authenticated"}'
         else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
  return privado.autorizar_cancelacion_fuera_de_plazo(p_id, p_categoria, p_nota, p_ahora);
end;
$$;
create function pg_temp.autorizar(p_uid text, p_nn text, p_categoria text, p_nota text,
                                  p_ahora timestamptz default null) returns text
language sql volatile as $$
  -- Sin hora, la noche anterior a la cita a las 22:00 en Bogotá: pasadas las 12 h de plazo y antes del inicio.
  select pg_temp.autorizar_id(p_uid, m.id, p_categoria, p_nota,
                              coalesce(p_ahora, ((m.fecha - 1) + time '22:00') at time zone 'America/Bogota'))
  from public.monitoria m where m.id = ('50000000-0000-0000-0000-0000000052' || p_nn)::uuid;
$$;
-- como(usuario): deja la sesión simulada como ese usuario, para las funciones que leen auth.uid().
create function pg_temp.como(p_uid text) returns void
language sql volatile as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
-- foto(nn): todo lo que cuelga de la monitoría (la monitoría, su reporte, sus pagos, reembolsos, desembolso, avisos al monitor,
-- cancelaciones y la autorización) en un texto, para ver que un resultado que falla no cambió nada.
create function pg_temp.foto(p_nn text) returns text
language sql stable as $$
  select concat_ws('#',
    (select string_agg(m::text, '|') from public.monitoria m where m.id = ('50000000-0000-0000-0000-0000000052' || p_nn)::uuid),
    (select string_agg(r::text, '|' order by r.id) from public.reporte_inasistencia r
     where r.id_monitoria = ('50000000-0000-0000-0000-0000000052' || p_nn)::uuid),
    (select string_agg(p::text, '|' order by p.id) from public.pago p
     where p.id_monitoria = ('50000000-0000-0000-0000-0000000052' || p_nn)::uuid),
    (select string_agg(x::text, '|' order by x.id) from public.reembolso x join public.pago p on p.id = x.id_pago
     where p.id_monitoria = ('50000000-0000-0000-0000-0000000052' || p_nn)::uuid),
    (select string_agg(d::text, '|' order by d.id) from public.desembolso d
     where d.id_monitoria = ('50000000-0000-0000-0000-0000000052' || p_nn)::uuid),
    (select string_agg(a::text, '|' order by a.id) from public.aviso_monitor a
     where a.id_monitoria = ('50000000-0000-0000-0000-0000000052' || p_nn)::uuid),
    (select string_agg(c::text, '|' order by c.id) from public.cancelacion_cita c
     where c.id_monitoria = ('50000000-0000-0000-0000-0000000052' || p_nn)::uuid),
    (select string_agg(e::text, '|') from public.cancelacion_excepcional e
     where e.id_monitoria = ('50000000-0000-0000-0000-0000000052' || p_nn)::uuid))
$$;
-- reembolsos_de(nn): cuántos reembolsos tienen los pagos de la monitoría.
create function pg_temp.reembolsos_de(p_nn text) returns integer
language sql stable as $$
  select count(*)::int from public.reembolso x join public.pago p on p.id = x.id_pago
  where p.id_monitoria = ('50000000-0000-0000-0000-0000000052' || p_nn)::uuid
$$;
-- avisos_de(nn): los eventos del aviso al monitor de la monitoría, ordenados.
create function pg_temp.avisos_de(p_nn text) returns text
language sql stable as $$
  select coalesce(string_agg(a.evento, ',' order by a.evento), '-') from public.aviso_monitor a
  where a.id_monitoria = ('50000000-0000-0000-0000-0000000052' || p_nn)::uuid
$$;
-- Las fotos de partida de lo que debe quedar igual.
create temporary table foto_52 (clave text primary key, antes text not null);
insert into foto_52 select 'e' || nn, pg_temp.foto(nn) from unnest(array['01', '02', '03', '04', '05', '06', '07']) nn;

select ok(
  privado.siguiente_admin_activo() = 'a0000000-0000-0000-0000-0000000052a0'
  and not privado.admin_activo('a0000000-0000-0000-0000-0000000052c0')
  and privado.admin_activo('a0000000-0000-0000-0000-0000000052b0')
  and length((select antes from foto_52 where clave = 'e01')) > 100
  and (select count(*) = 3 from public.monitoria_grupal where id_monitoria::text like '50000000-0000-0000-0000-0000000052%')
  and not exists (select 1 from public.cancelacion_excepcional where id_monitoria::text like '50000000-0000-0000-0000-0000000052%')
  and not exists (select 1 from public.aviso_monitor where id_monitoria::text like '50000000-0000-0000-0000-0000000052%'),
  'Control: el primer admin activo es A, B está activo y C desactivado, hay tres grupales, ninguna autorización y ningún aviso al monitor todavía');

-- ---------------------------------------------------------------------------
-- Los checks de la tabla y su cascada (con las monitorías 08 y 09, que no tienen pagos)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$insert into public.cancelacion_excepcional (id_monitoria, id_admin, categoria, nota)
    values ('50000000-0000-0000-0000-000000005208', 'a0000000-0000-0000-0000-0000000052a0', 'inventada', 'x')$$,
  '23514', null, 'Una categoría fuera de la lista no entra');
select throws_ok(
  $$insert into public.cancelacion_excepcional (id_monitoria, id_admin, categoria, nota)
    values ('50000000-0000-0000-0000-000000005208', 'a0000000-0000-0000-0000-0000000052a0', 'otro', null)$$,
  '23514', null, '«otro» sin nota no entra');
select throws_ok(
  $$insert into public.cancelacion_excepcional (id_monitoria, id_admin, categoria, nota)
    values ('50000000-0000-0000-0000-000000005208', 'a0000000-0000-0000-0000-0000000052a0', 'fuerza_mayor', repeat('x', 501))$$,
  '23514', null, 'Una nota de 501 caracteres no entra');
select throws_ok(
  $$insert into public.cancelacion_excepcional (id_monitoria, id_admin, categoria, nota)
    values ('50000000-0000-0000-0000-000000005208', 'a0000000-0000-0000-0000-0000000052a0', 'fuerza_mayor', ' con espacio al inicio')$$,
  '23514', null, 'Una nota con un espacio al inicio no entra: se guarda recortada');
select throws_ok(
  $$insert into public.cancelacion_excepcional (id_monitoria, id_admin, categoria, nota)
    values ('50000000-0000-0000-0000-000000005208', 'a0000000-0000-0000-0000-0000000052a0', 'fuerza_mayor', E'con salto al final\n')$$,
  '23514', null, 'Ni con un salto de línea al final');
select throws_ok(
  $$insert into public.cancelacion_excepcional (id_monitoria, id_admin, categoria, nota)
    values ('50000000-0000-0000-0000-000000005208', 'a0000000-0000-0000-0000-0000000052a0', 'fuerza_mayor', '   ')$$,
  '23514', null, 'Ni una nota de puros espacios: vacía es nula');
select throws_ok(
  $$insert into public.cancelacion_excepcional (id_monitoria, id_admin, categoria, nota)
    values ('50000000-0000-0000-0000-000000005208', 'a0000000-0000-0000-0000-0000000052ff', 'fuerza_mayor', null)$$,
  '23503', null, 'Un admin que no existe no entra (llave foránea)');
select throws_ok(
  $$insert into public.cancelacion_excepcional (id_monitoria, id_admin, categoria, nota)
    values ('50000000-0000-0000-0000-0000000052ff', 'a0000000-0000-0000-0000-0000000052a0', 'fuerza_mayor', null)$$,
  '23503', null, 'Ni una monitoría que no existe');
select lives_ok(
  $$insert into public.cancelacion_excepcional (id_monitoria, id_admin, categoria, nota)
    values ('50000000-0000-0000-0000-000000005208', 'a0000000-0000-0000-0000-0000000052b0', 'otro', repeat('é', 500))$$,
  'Quinientos caracteres (1000 bytes) con «otro» entran: se cuentan caracteres, no bytes');
select throws_ok(
  $$insert into public.cancelacion_excepcional (id_monitoria, id_admin, categoria, nota)
    values ('50000000-0000-0000-0000-000000005208', 'a0000000-0000-0000-0000-0000000052a0', 'fuerza_mayor', null)$$,
  '23505', null, 'Una segunda autorización de la misma monitoría no entra (llave primaria)');
select throws_ok($$delete from public.admin where id = 'a0000000-0000-0000-0000-0000000052b0'$$, '23503', null,
  'Un admin con una autorización no se puede borrar (RN-23: se desactiva, y su rastro se conserva)');
delete from public.cancelacion_excepcional where id_monitoria = '50000000-0000-0000-0000-000000005208';
select lives_ok(
  $$insert into public.cancelacion_excepcional (id_monitoria, id_admin, categoria, nota) values
    ('50000000-0000-0000-0000-000000005208', 'a0000000-0000-0000-0000-0000000052a0', 'fuerza_mayor', null)$$,
  'Fuerza mayor sin nota entra');
delete from public.cancelacion_excepcional where id_monitoria = '50000000-0000-0000-0000-000000005208';
select lives_ok(
  $$insert into public.cancelacion_excepcional (id_monitoria, id_admin, categoria, nota) values
    ('50000000-0000-0000-0000-000000005208', 'a0000000-0000-0000-0000-0000000052a0', 'falla_de_calibra', E'Línea uno\nlínea dos')$$,
  'Una falla de Calibra con una nota de dos líneas entra: los saltos de adentro se conservan');
delete from public.cancelacion_excepcional where id_monitoria = '50000000-0000-0000-0000-000000005208';
insert into public.cancelacion_excepcional (id_monitoria, id_admin, categoria, nota) values
  ('50000000-0000-0000-0000-000000005209', 'a0000000-0000-0000-0000-0000000052a0', 'fuerza_mayor', null);
delete from public.monitoria where id = '50000000-0000-0000-0000-000000005209';
select is((select count(*)::int from public.cancelacion_excepcional where id_monitoria = '50000000-0000-0000-0000-000000005209'), 0,
  'Al borrar la monitoría se borra su autorización (cascada)');

-- ---------------------------------------------------------------------------
-- Los resultados que no escriben nada (la 01: confirmada del 10-mar, con un pago aprobado)
-- ---------------------------------------------------------------------------
select is(pg_temp.autorizar(null, '01', 'fuerza_mayor', null), 'sin_sesion', 'Sin sesión (sin sub): sin_sesion');
select is(pg_temp.autorizar(null, '01', 'x', repeat('x', 501)), 'sin_sesion',
  'Y se dice antes que cualquier otra cosa: aunque la categoría y la nota estén mal, sin_sesion');
select results_eq(
  $$select o, pg_temp.autorizar(u, '01', 'fuerza_mayor', null)
    from unnest(array['b0000000-0000-0000-0000-000000005201', 'c0000000-0000-0000-0000-000000005201',
                      'a0000000-0000-0000-0000-0000000052c0']) with ordinality as t(u, o) order by o$$,
  $$values (1::bigint, 'sin_permiso'::text), (2, 'sin_permiso'), (3, 'sin_permiso')$$,
  'El monitor, el Lead (una sesión anónima) y un admin desactivado (C, con banned_until): sin_permiso');
select results_eq(
  $$select o, pg_temp.autorizar(u, '01', c, repeat('x', 501))
    from (values (1, 'b0000000-0000-0000-0000-000000005201', 'x'), (2, 'b0000000-0000-0000-0000-000000005201', 'falla_de_calibra'),
                 (3, 'a0000000-0000-0000-0000-0000000052b0', 'x'), (4, 'a0000000-0000-0000-0000-0000000052b0', null)) as t(o, u, c)
    order by o$$,
  $$values (1, 'sin_permiso'::text), (2, 'sin_permiso'), (3, 'categoria_invalida'), (4, 'categoria_invalida')$$,
  'El orden: quién puede va antes que el texto (M con una nota de 501 recibe sin_permiso) y la categoría, antes que la nota (B con una categoría inválida y una nota de 501 recibe categoria_invalida)');
select results_eq(
  $$select o, pg_temp.autorizar('a0000000-0000-0000-0000-0000000052b0', '01', c, null)
    from unnest(array[null, 'x', 'FUERZA_MAYOR', '', 'fuerza_mayor ']::text[]) with ordinality as t(c, o) order by o$$,
  $$values (1::bigint, 'categoria_invalida'::text), (2, 'categoria_invalida'), (3, 'categoria_invalida'),
           (4, 'categoria_invalida'), (5, 'categoria_invalida')$$,
  'Una categoría nula, desconocida, en mayúsculas, vacía o con un espacio: categoria_invalida (se compara tal cual)');
select results_eq(
  $$select o, pg_temp.autorizar('a0000000-0000-0000-0000-0000000052b0', '01', c, n)
    from (values (1, 'falla_de_calibra', repeat('x', 501)), (2, 'otro', null), (3, 'otro', E' \n\t \r\n '), (4, 'otro', ''),
                 (5, 'fuerza_mayor', repeat('é', 501))) as t(o, c, n) order by o$$,
  $$values (1, 'nota_invalida'::text), (2, 'nota_invalida'), (3, 'nota_invalida'), (4, 'nota_invalida'), (5, 'nota_invalida')$$,
  'Una nota de 501 caracteres (también 501 «é»: se cuentan caracteres), «otro» sin nota, con puros espacios y saltos de línea, o vacía: nota_invalida');
select results_eq(
  $$select o, pg_temp.autorizar_id('a0000000-0000-0000-0000-0000000052b0', i, 'fuerza_mayor', null)
    from unnest(array[gen_random_uuid(), null]::uuid[]) with ordinality as t(i, o) order by o$$,
  $$values (1::bigint, 'no_existe'::text), (2, 'no_existe')$$,
  'Una monitoría que no existe, o un id nulo: no_existe');

-- Los bordes que no autorizan, sobre la 01 (inicio: lunes 10-mar-2031 09:30 Bogotá; el plazo termina el domingo 9 a las 21:30).
select results_eq(
  $$select o, pg_temp.autorizar('a0000000-0000-0000-0000-0000000052b0', '01', 'fuerza_mayor', null, a)
    from unnest(array[timestamptz '2031-03-09 21:30:00-05', timestamptz '2031-03-09 21:29:59-05', timestamptz '2031-03-09 12:00:00-05',
                      timestamptz '2020-01-01 00:00:00-05']) with ordinality as t(a, o) order by o$$,
  $$values (1::bigint, 'dentro_de_plazo'::text), (2, 'dentro_de_plazo'), (3, 'dentro_de_plazo'), (4, 'dentro_de_plazo')$$,
  'Con las 12 h exactas (21:30:00) todavía hay plazo (P-40), y antes también: dentro_de_plazo');
select results_eq(
  $$select o, pg_temp.autorizar('a0000000-0000-0000-0000-0000000052b0', '01', 'fuerza_mayor', null, a)
    from unnest(array[timestamptz '2031-03-10 09:30:00-05', timestamptz '2031-03-10 09:30:01-05', timestamptz '2031-03-11 09:30:00-05',
                      timestamptz '2040-01-01 00:00:00-05']) with ordinality as t(a, o) order by o$$,
  $$values (1::bigint, 'ya_empezo'::text), (2, 'ya_empezo'), (3, 'ya_empezo'), (4, 'ya_empezo')$$,
  'En el instante exacto del inicio (09:30:00) ya no se autoriza (RN-64), ni después: ya_empezo');
select is(pg_temp.autorizar_id('a0000000-0000-0000-0000-0000000052b0', '50000000-0000-0000-0000-000000005201', 'fuerza_mayor', null, null),
  'dentro_de_plazo', 'Con p_ahora nulo la puerta toma now() (hoy, mucho antes de 2031): dentro_de_plazo');
select is(privado.cancelar_cita_con_permiso('50000000-0000-0000-0000-000000005201', null,
                                            'a0000000-0000-0000-0000-0000000052b0', 'fuerza_mayor', null), 'ya_empezo',
  'El núcleo con admin y p_ahora nulo falla cerrado: ya_empezo, y no se cancela nada');
select results_eq(
  $$select o, privado.cancelar_cita('50000000-0000-0000-0000-000000005201', a)
    from unnest(array[null, timestamptz '2031-03-09 21:30:01-05', timestamptz '2031-03-10 09:30:00-05']::timestamptz[])
      with ordinality as t(a, o) order by o$$,
  $$values (1::bigint, 'fuera_de_plazo'::text), (2, 'fuera_de_plazo'), (3, 'fuera_de_plazo')$$,
  'Sin admin (la cancelación del Lead, HU-024) nada cambia: con p_ahora nulo, un segundo después del plazo o en el inicio, fuera_de_plazo');
select is(privado.cancelar_cita_con_permiso('50000000-0000-0000-0000-000000005201', timestamptz '2031-03-09 22:00-05', null, null, null),
  'fuera_de_plazo', 'El núcleo sin admin es lo mismo que la envoltura');

-- sin_permiso bajo el candado: el núcleo vuelve a mirar al admin (la carrera real está en la prueba de integración).
select results_eq(
  $$select o, privado.cancelar_cita_con_permiso(i, timestamptz '2031-03-09 22:00-05', a, 'fuerza_mayor', null)
    from (values (1, '50000000-0000-0000-0000-000000005201'::uuid, 'a0000000-0000-0000-0000-0000000052c0'::uuid),
                 (2, '50000000-0000-0000-0000-000000005201', 'b0000000-0000-0000-0000-000000005201'),
                 (3, '50000000-0000-0000-0000-000000005201', gen_random_uuid()),
                 (4, '50000000-0000-0000-0000-000000005202', 'a0000000-0000-0000-0000-0000000052c0'),
                 (5, '50000000-0000-0000-0000-000000005207', 'a0000000-0000-0000-0000-0000000052c0')) as t(o, i, a)
    order by o$$,
  $$values (1, 'sin_permiso'::text), (2, 'sin_permiso'), (3, 'sin_permiso'), (4, 'sin_permiso'), (5, 'sin_permiso')$$,
  'El núcleo con un admin desactivado (C), con el monitor o con un id desconocido: sin_permiso, y se dice antes que no_individual o ya_cancelada');
select is(privado.cancelar_cita_con_permiso(gen_random_uuid(), timestamptz '2031-03-09 22:00-05',
                                            'a0000000-0000-0000-0000-0000000052c0', 'fuerza_mayor', null), 'no_existe',
  'Pero no_existe se dice antes: sin monitoría no hay nada que proteger');

-- Los demás resultados del estado de la monitoría (con B y una hora en que se podría autorizar).
select results_eq(
  $$select nn, pg_temp.autorizar('a0000000-0000-0000-0000-0000000052b0', nn, 'fuerza_mayor', null)
    from unnest(array['02', '03', '04', '05', '06', '07']) nn order by nn$$,
  $$values ('02'::text, 'no_individual'::text), ('03', 'no_cancelable'), ('04', 'no_cancelable'), ('05', 'no_cancelable'),
           ('06', 'no_cancelable'), ('07', 'ya_cancelada')$$,
  'Una grupal: no_individual. Por pagar, realizada, cancelada por inasistencia o por pago rechazado: no_cancelable. Cancelada por el estudiante: ya_cancelada');
select ok(
  pg_temp.foto('01') = (select antes from foto_52 where clave = 'e01')
  and pg_temp.foto('02') = (select antes from foto_52 where clave = 'e02')
  and pg_temp.foto('03') = (select antes from foto_52 where clave = 'e03')
  and pg_temp.foto('04') = (select antes from foto_52 where clave = 'e04')
  and pg_temp.foto('05') = (select antes from foto_52 where clave = 'e05')
  and pg_temp.foto('06') = (select antes from foto_52 where clave = 'e06')
  and pg_temp.foto('07') = (select antes from foto_52 where clave = 'e07'),
  'Ninguno de esos intentos tocó nada: ni la monitoría, ni el reporte, ni los pagos, reembolsos, desembolso, avisos, cancelaciones o autorizaciones');
select is((select count(*)::int from public.cancelacion_excepcional where id_monitoria::text like '50000000-0000-0000-0000-0000000052%'), 0,
  'Y no quedó ninguna fila de autorización');

-- ---------------------------------------------------------------------------
-- Los bordes que sí autorizan, y la defensa del reporte de inasistencia
-- ---------------------------------------------------------------------------
select is(pg_temp.autorizar('a0000000-0000-0000-0000-0000000052b0', '10', 'fuerza_mayor', null, timestamptz '2031-03-09 21:30:01-05'),
  'autorizada', 'Un segundo después de las 12 h antes del inicio (21:30:01): autorizada');
select results_eq(
  $$select m.estado::text, m.motivo_cancelacion::text, e.autorizada_en
    from public.monitoria m join public.cancelacion_excepcional e on e.id_monitoria = m.id
    where m.id = '50000000-0000-0000-0000-000000005210'$$,
  $$values ('cancelada'::text, 'estudiante'::text, timestamptz '2031-03-09 21:30:01-05')$$,
  'Quedó cancelada por estudiante y la autorización guarda la hora que recibió el núcleo, no la de la base (p_ahora)');
select is(pg_temp.autorizar('a0000000-0000-0000-0000-0000000052b0', '11', 'fuerza_mayor', null, timestamptz '2031-03-10 09:29:59-05'),
  'autorizada', 'Un segundo antes del inicio (09:29:59): autorizada');
select is((select estado::text from public.monitoria where id = '50000000-0000-0000-0000-000000005211'), 'cancelada',
  'Y la 11 quedó cancelada');
-- La 12 ya tiene un reporte de inasistencia en revisión (la sesión empezó aunque p_ahora sea anterior: la transacción de la
-- autorización pudo empezar antes de que el reporte se confirmara).
insert into public.reporte_inasistencia (id, id_monitoria, id_admin)
values ('70000000-0000-0000-0000-000000005212', '50000000-0000-0000-0000-000000005212', 'a0000000-0000-0000-0000-0000000052a0');
insert into foto_52 values ('r12', pg_temp.foto('12'));
select is(pg_temp.autorizar('a0000000-0000-0000-0000-0000000052b0', '12', 'fuerza_mayor', null, timestamptz '2031-03-10 09:29:59-05'),
  'ya_empezo', 'Con un reporte de inasistencia ya creado, aunque p_ahora sea un segundo antes del inicio: ya_empezo');
select ok(
  pg_temp.foto('12') = (select antes from foto_52 where clave = 'r12')
  and (select estado::text from public.reporte_inasistencia where id = '70000000-0000-0000-0000-000000005212') = 'en_revision',
  'Y no se cancela nada ni se toca el reporte: sigue en revisión');
delete from public.reporte_inasistencia where id = '70000000-0000-0000-0000-000000005212';
select is(pg_temp.autorizar('a0000000-0000-0000-0000-0000000052b0', '12', 'fuerza_mayor', null, timestamptz '2031-03-10 09:29:59-05'),
  'autorizada', 'La misma cita sin el reporte, a la misma hora: autorizada (así se distingue la defensa del reporte de los bordes del plazo)');

-- ---------------------------------------------------------------------------
-- Autorizar con B, que no es el primero del turno (la 20: cuatro pagos, dos contactos)
-- ---------------------------------------------------------------------------
call pg_temp.aislar();
select is(pg_temp.autorizar('a0000000-0000-0000-0000-0000000052b0', '20', 'otro', E'  Nota de prueba 52.\n'), 'autorizada',
  'B autoriza la 20 con «otro» y una nota con espacios y un salto de línea a los lados: autorizada');
select results_eq(
  $$select estado::text, motivo_cancelacion::text, fecha_finalizacion is null
    from public.monitoria where id = '50000000-0000-0000-0000-000000005220'$$,
  $$values ('cancelada'::text, 'estudiante'::text, true)$$,
  'La monitoría queda cancelada por estudiante, sin fecha de finalización');
select results_eq(
  $$select id_admin, categoria, nota, autorizada_en from public.cancelacion_excepcional
    where id_monitoria = '50000000-0000-0000-0000-000000005220'$$,
  $$values ('a0000000-0000-0000-0000-0000000052b0'::uuid, 'otro'::text, 'Nota de prueba 52.'::text, timestamptz '2031-05-11 22:00-05')$$,
  'El registro dice quién (B, no el primero del turno), la categoría, la nota sin los espacios ni el salto de línea de los lados y cuándo (p_ahora)');
select results_eq(
  $$select right(r.id_pago::text, 4), r.estado::text, r.monto, r.id_admin, r.motivo, r.llave_destino is null
    from public.reembolso r join public.pago p on p.id = r.id_pago
    where p.id_monitoria = '50000000-0000-0000-0000-000000005220' order by r.id_pago$$,
  $$values ('2001'::text, 'esperando_llave'::text, 31000, 'a0000000-0000-0000-0000-0000000052a0'::uuid,
            'Cancelaste la monitoría y un admin autorizó hacerlo fuera del plazo.'::text, true),
           ('2002', 'esperando_llave', 42000, 'a0000000-0000-0000-0000-0000000052a0',
            'Cancelaste la monitoría y un admin autorizó hacerlo fuera del plazo.', true)$$,
  'Un reembolso por cada pago aprobado (no por el rechazado ni por el que está en revisión): por su monto completo, esperando la llave, del primer admin activo (A, no B, D-26) y con el motivo de la autorización');
select results_eq(
  $$select right(r.id_pago::text, 4), s.en_correo_de_cancelacion, pl.tipo
    from public.reembolso r join public.pago p on p.id = r.id_pago
    join public.solicitud_llave s on s.id_reembolso = r.id join public.pedido_llave pl on pl.id_reembolso = r.id
    where p.id_monitoria = '50000000-0000-0000-0000-000000005220' order by r.id_pago$$,
  $$values ('2001'::text, true, 'pedido'::text), ('2002', false, 'pedido')$$,
  'Cada reembolso tiene su solicitud de llave y su pedido; el correo de cancelación ya pide la del pago hecho con el correo del Lead (2001) y el otro lo pide HU-025');
select results_eq(
  $$select right(p.id::text, 4), p.estado::text from public.pago p
    where p.id_monitoria = '50000000-0000-0000-0000-000000005220' order by p.id$$,
  $$values ('2001'::text, 'aprobado'::text), ('2002', 'aprobado'), ('2003', 'rechazado'), ('2004', 'en_revision')$$,
  'Los pagos no cambian de estado');
select results_eq(
  $$select correo_destino, con_pago_en_revision, reembolso_a_otro_contacto, procesado_en is null, intentos
    from public.cancelacion_cita where id_monitoria = '50000000-0000-0000-0000-000000005220'$$,
  $$values ('mateo52@calibra.test'::text, true, true, true, 0)$$,
  'Anotó el correo de cancelación al correo del Lead (D-27), con un pago en revisión (P-07) y un reembolso a otro contacto, pendiente y sin intentos');
select results_eq(
  $$select evento, procesado_en is null, intentos from public.aviso_monitor where id_monitoria = '50000000-0000-0000-0000-000000005220'$$,
  $$values ('cancelada'::text, true, 0)$$,
  'El trigger de la monitoría anotó el aviso «cancelada» para el monitor (D-16), sin procesar: el de siempre');
select is((select count(*)::int from public.desembolso where id_monitoria = '50000000-0000-0000-0000-000000005220'), 0,
  'No nace ningún desembolso: el monitor no cobra esta sesión (D-60 c)');
select results_eq(
  $$select d.motivo, d.motivo_cancelacion::text, d.monto
    from public.reembolso r join public.pago p on p.id = r.id_pago join public.pedido_llave pl on pl.id_reembolso = r.id
    cross join lateral public.datos_de_pedido_llave(pl.id) d
    where p.id = '60000000-0000-0000-0000-000000522001'$$,
  $$values ('Cancelaste la monitoría y un admin autorizó hacerlo fuera del plazo.'::text, 'estudiante'::text, 31000)$$,
  'El pedido de llave que lee la app dice el motivo de la cancelación (no el de inasistencia) y el monto completo, sin la categoría ni la nota');
insert into foto_52 values ('d20', pg_temp.foto('20'));
select is(pg_temp.autorizar('a0000000-0000-0000-0000-0000000052a0', '20', 'falla_de_calibra', 'Otra nota.'), 'ya_cancelada',
  'Una segunda llamada (otro admin, otra categoría, otra nota), como un doble clic: ya_cancelada');
select is(privado.cancelar_cita('50000000-0000-0000-0000-000000005220', timestamptz '2031-03-09 20:00-05'), 'ya_cancelada',
  'Y también para la cancelación del Lead');
select is(pg_temp.foto('20'), (select antes from foto_52 where clave = 'd20'),
  'Sin pisar la autorización de B, sin segundo reembolso, sin segundo correo ni segundo aviso');

-- La 21: el Lead no tiene correo (D-19), fuerza mayor sin nota (con puros espacios), y los casos abiertos de A suben, no los de B.
select pg_temp.como('a0000000-0000-0000-0000-0000000052a0');
create temporary table casos_52 (k text primary key, v integer not null);
insert into casos_52 select 'a-antes', casos_abiertos from privado.equipo_de_admins() where id = 'a0000000-0000-0000-0000-0000000052a0';
insert into casos_52 select 'b-antes', casos_abiertos from privado.equipo_de_admins() where id = 'a0000000-0000-0000-0000-0000000052b0';
select is(pg_temp.autorizar('a0000000-0000-0000-0000-0000000052b0', '21', 'fuerza_mayor', E'  \n '), 'autorizada',
  'B autoriza la 21 (el Lead no tiene correo) con fuerza mayor y una nota de puros espacios: autorizada');
select results_eq(
  $$select id_admin, categoria, nota from public.cancelacion_excepcional where id_monitoria = '50000000-0000-0000-0000-000000005221'$$,
  $$values ('a0000000-0000-0000-0000-0000000052b0'::uuid, 'fuerza_mayor'::text, null::text)$$,
  'La nota de puros espacios se guarda como ninguna (nula)');
select results_eq(
  $$select correo_destino, con_pago_en_revision, reembolso_a_otro_contacto
    from public.cancelacion_cita where id_monitoria = '50000000-0000-0000-0000-000000005221'$$,
  $$values ('sofia52@example.com'::text, false, false)$$,
  'Sin correo del Lead, el correo de cancelación va al contacto del primer pago (D-19), que es el de quien pagó: sin reembolso a otro contacto');
select pg_temp.como('a0000000-0000-0000-0000-0000000052a0');
insert into casos_52 select 'a-despues', casos_abiertos from privado.equipo_de_admins() where id = 'a0000000-0000-0000-0000-0000000052a0';
insert into casos_52 select 'b-despues', casos_abiertos from privado.equipo_de_admins() where id = 'a0000000-0000-0000-0000-0000000052b0';
select is(
  array[(select v from casos_52 where k = 'a-despues') - (select v from casos_52 where k = 'a-antes'),
        (select v from casos_52 where k = 'b-despues') - (select v from casos_52 where k = 'b-antes')],
  array[1, 0],
  'El reembolso es un caso abierto de A (el primer admin activo): sube en uno; los de B, que autorizó, no cambian (equipo_de_admins)');

-- La 22: A autoriza, con una falla de Calibra.
select is(pg_temp.autorizar('a0000000-0000-0000-0000-0000000052a0', '22', 'falla_de_calibra', 'Falla del enlace de cancelación.'), 'autorizada',
  'A autoriza la 22 con una falla de Calibra y una nota: autorizada');
select results_eq(
  $$select e.id_admin, e.categoria, e.nota, r.id_admin, r.monto
    from public.cancelacion_excepcional e join public.pago p on p.id_monitoria = e.id_monitoria
    join public.reembolso r on r.id_pago = p.id
    where e.id_monitoria = '50000000-0000-0000-0000-000000005222'$$,
  $$values ('a0000000-0000-0000-0000-0000000052a0'::uuid, 'falla_de_calibra'::text, 'Falla del enlace de cancelación.'::text,
            'a0000000-0000-0000-0000-0000000052a0'::uuid, 26000)$$,
  'El registro es de A y el reembolso también (es el primero del turno)');

-- La 23: «otro» con 500 caracteres de dos bytes, sin pagos.
select is(pg_temp.autorizar('a0000000-0000-0000-0000-0000000052b0', '23', 'otro', repeat('é', 500)), 'autorizada',
  'B autoriza la 23 con «otro» y una nota de 500 «é» (1000 bytes): autorizada');
select results_eq(
  $$select char_length(e.nota), pg_temp.reembolsos_de('23'), c.correo_destino, c.con_pago_en_revision, c.reembolso_a_otro_contacto
    from public.cancelacion_excepcional e join public.cancelacion_cita c on c.id_monitoria = e.id_monitoria
    where e.id_monitoria = '50000000-0000-0000-0000-000000005223'$$,
  $$values (500, 0, 'lucia52@calibra.test'::text, false, false)$$,
  'La nota se guarda completa; sin pagos aprobados no hay reembolsos y el correo de cancelación va al Lead');

-- Fecha libre (RN-33): la franja de la 21 admite otra monitoría ese mismo día.
select lives_ok(
  $$insert into public.monitoria (id_franja, id_materia, id_lead, fecha, valor_total)
    values ('30000000-0000-0000-0000-000000005221', '10000000-0000-0000-0000-000000005201',
            '40000000-0000-0000-0000-000000005202', date '2031-05-19', 20000)$$,
  'La fecha quedó libre: otra persona puede agendar esa misma franja ese mismo día (RN-33)');

-- ---------------------------------------------------------------------------
-- Quién lee la autorización
-- ---------------------------------------------------------------------------
set local role anon;
select throws_ok($$select * from public.cancelacion_excepcional$$, '42501', null, 'anon no puede leer la tabla: permiso denegado');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000052a0","role":"authenticated"}';
select is((select count(*)::int from public.cancelacion_excepcional where id_monitoria::text like '50000000-0000-0000-0000-0000000052%'), 7,
  'Un admin activo (A) lee las siete autorizaciones de la prueba: 10, 11, 12, 20, 21, 22 y 23, también las que hizo B');
select results_eq(
  $$select nota from public.cancelacion_excepcional where id_monitoria = '50000000-0000-0000-0000-000000005220'$$,
  $$values ('Nota de prueba 52.'::text)$$, 'Y lee la nota');
select throws_ok(
  $$insert into public.cancelacion_excepcional (id_monitoria, id_admin, categoria, nota)
    values ('50000000-0000-0000-0000-000000005208', 'a0000000-0000-0000-0000-0000000052a0', 'fuerza_mayor', null)$$,
  '42501', null, 'Pero ni un admin la escribe: insertar da permiso denegado');
select throws_ok($$update public.cancelacion_excepcional set nota = 'cambiada'$$, '42501', null,
  'Ni la actualiza');
select throws_ok($$delete from public.cancelacion_excepcional$$, '42501', null, 'Ni la borra');
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-000000005201","role":"authenticated"}';
select is((select count(*)::int from public.cancelacion_excepcional), 0,
  'El monitor de esas citas no ve ninguna fila: ni la categoría ni la nota');
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000005202","role":"authenticated"}';
select is((select count(*)::int from public.cancelacion_excepcional), 0,
  'Ni el Lead de la 20 (ve su monitoría, no la autorización)');
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000052c0","role":"authenticated"}';
select is((select count(*)::int from public.cancelacion_excepcional), 0, 'Ni un admin desactivado');
reset role;

-- ---------------------------------------------------------------------------
-- El texto del motivo: un solo lugar
-- ---------------------------------------------------------------------------
select results_eq(
  $$select privado.motivo_de_cancelacion_del_estudiante(i) from unnest(array[
      '50000000-0000-0000-0000-000000005220'::uuid, '50000000-0000-0000-0000-000000005201',
      '50000000-0000-0000-0000-000000005207', gen_random_uuid(), null]) with ordinality as t(i, o) order by o$$,
  $$values ('Cancelaste la monitoría y un admin autorizó hacerlo fuera del plazo.'::text),
           ('Cancelaste la monitoría dentro del plazo.'), ('Cancelaste la monitoría dentro del plazo.'),
           ('Cancelaste la monitoría dentro del plazo.'), ('Cancelaste la monitoría dentro del plazo.')$$,
  'Con una autorización dice «…un admin autorizó hacerlo fuera del plazo.»; sin ella (una confirmada, una cancelada por el estudiante, una que no existe o un id nulo), «…dentro del plazo.»');

-- ---------------------------------------------------------------------------
-- P-07: el pago en revisión, antes y después de autorizar (la 25: uno aprobado y dos en revisión)
-- ---------------------------------------------------------------------------
call pg_temp.aislar();
select is(pg_temp.autorizar('a0000000-0000-0000-0000-0000000052b0', '25', 'fuerza_mayor', null), 'autorizada',
  'B autoriza la 25, que tiene un pago aprobado y dos en revisión: autorizada');
select results_eq(
  $$select right(r.id_pago::text, 4) from public.reembolso r join public.pago p on p.id = r.id_pago
    where p.id_monitoria = '50000000-0000-0000-0000-000000005225'$$,
  $$values ('2501'::text)$$,
  'Solo el pago aprobado tiene reembolso: los dos que están en revisión no generan nada todavía');
select results_eq(
  $$select con_pago_en_revision from public.cancelacion_cita where id_monitoria = '50000000-0000-0000-0000-000000005225'$$,
  $$values (true)$$, 'Y el correo de cancelación avisa del pago en revisión');
update public.pago set estado = 'aprobado', fecha_revision = now() where id = '60000000-0000-0000-0000-000000522502';
select results_eq(
  $$select r.estado::text, r.monto, r.id_admin, r.motivo, r.llave_destino is null, s.en_correo_de_cancelacion, pl.tipo
    from public.reembolso r join public.solicitud_llave s on s.id_reembolso = r.id join public.pedido_llave pl on pl.id_reembolso = r.id
    where r.id_pago = '60000000-0000-0000-0000-000000522502'$$,
  $$values ('esperando_llave'::text, 28000, 'a0000000-0000-0000-0000-0000000052a0'::uuid,
            'Cancelaste la monitoría y un admin autorizó hacerlo fuera del plazo.'::text, true, false, 'pedido'::text)$$,
  'P-07: al aprobarse el pago en revisión nace su reembolso, esperando la llave, del primer admin activo, con el motivo de la autorización y su solicitud y pedido de llave');
update public.pago set estado = 'rechazado', fecha_revision = now() where id = '60000000-0000-0000-0000-000000522503';
select is((select count(*)::int from public.reembolso where id_pago = '60000000-0000-0000-0000-000000522503'), 0,
  'El otro pago en revisión se rechaza y no tiene reembolso (RN-43)');
select results_eq(
  $$select caso from public.aviso_rechazo_pago where id_pago = '60000000-0000-0000-0000-000000522503'$$,
  $$values ('cita_ya_cancelada'::text)$$,
  'Y quien pagó recibe el correo de «no hay reembolso» de HU-076, con el caso de la cita ya cancelada');

-- Regresión: la cancelación a tiempo del Lead (la 26) sigue diciendo lo de siempre y no deja autorización.
select pg_temp.como('c0000000-0000-0000-0000-000000005201');
select is(privado.cancelar_cita('50000000-0000-0000-0000-000000005226', timestamptz '2031-06-15 20:00-05'), 'cancelada',
  'Regresión: el Lead cancela a tiempo la 26 (hasta las 21:30 del domingo): cancelada');
update public.pago set estado = 'aprobado', fecha_revision = now() where id = '60000000-0000-0000-0000-000000522602';
select results_eq(
  $$select right(r.id_pago::text, 4), r.monto, r.motivo, r.id_admin
    from public.reembolso r join public.pago p on p.id = r.id_pago where p.id_monitoria = '50000000-0000-0000-0000-000000005226'
    order by r.id_pago$$,
  $$values ('2601'::text, 33000, 'Cancelaste la monitoría dentro del plazo.'::text, 'a0000000-0000-0000-0000-0000000052a0'::uuid),
           ('2602', 34000, 'Cancelaste la monitoría dentro del plazo.', 'a0000000-0000-0000-0000-0000000052a0')$$,
  'Regresión: el pago aprobado al cancelar y el aprobado después dicen «Cancelaste la monitoría dentro del plazo.»');
select is((select count(*)::int from public.cancelacion_excepcional where id_monitoria = '50000000-0000-0000-0000-000000005226'), 0,
  'Regresión: la cancelación del Lead no deja ninguna autorización');
-- Regresión: la rama de la inasistencia (la 05, cancelada por monitor_no_asistio, sin reporte) y las grupales.
update public.pago set estado = 'aprobado', fecha_revision = now() where id = '60000000-0000-0000-0000-000000520501';
select results_eq(
  $$select estado::text, monto, id_admin, motivo from public.reembolso where id_pago = '60000000-0000-0000-0000-000000520501'$$,
  $$values ('esperando_llave'::text, 20000, 'a0000000-0000-0000-0000-0000000052a0'::uuid, 'El monitor no asistió a la monitoría.'::text)$$,
  'Regresión: una monitoría cancelada por monitor_no_asistio (la 05): el pago aprobado después recibe el motivo de la inasistencia');
update public.pago set estado = 'aprobado', fecha_revision = now() where id = '60000000-0000-0000-0000-000000522701';
select is((select count(*)::int from public.reembolso where id_pago = '60000000-0000-0000-0000-000000522701'), 0,
  'Regresión: una grupal cancelada por el estudiante (la 27) no crea ningún reembolso al aprobarse un pago');

-- ---------------------------------------------------------------------------
-- La lista: los bordes de las 12 h y del inicio con la hora de la base (40 a 49 y la 30, relativas a now())
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from inicio_52 i join public.monitoria m on m.id = ('50000000-0000-0000-0000-0000000052' || i.nn)::uuid
   where public.inicio_sesion(m.fecha, (select f.hora from public.franja f where f.id = m.id_franja)) = i.inicio),
  11, 'Control: el inicio de cada monitoría relativa es exactamente el instante buscado (con segundos y microsegundos)');
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000052a0","role":"authenticated"}';
select results_eq(
  $$select right(id_monitoria::text, 2) from public.citas_sin_plazo_para_cancelar
    where id_monitoria::text like '50000000-0000-0000-0000-0000000052%' order by inicio$$,
  $$values ('43'::text), ('30'), ('40')$$,
  'A ve, en orden de inicio, las que entran: dentro de 1 s (43), la de la puerta (30, dentro de 2 h 30 min) y la de 11 h 59 min 59 s (40)');
select results_eq(
  $$select right(id_monitoria::text, 2) from public.citas_sin_plazo_para_cancelar
    where id_monitoria::text like '50000000-0000-0000-0000-0000000052%' and right(id_monitoria::text, 2) in ('41', '42', '44', '45')$$,
  $$select 'nada'::text where false$$,
  'No entran la de 12 h exactas (41, el borde de P-40: todavía se cancela sola), la de 12 h 1 s (42), la que empieza ahora (44) ni la que empezó hace 1 s (45)');
select results_eq(
  $$select right(id_monitoria::text, 2) from public.citas_sin_plazo_para_cancelar
    where id_monitoria::text like '50000000-0000-0000-0000-0000000052%' and right(id_monitoria::text, 2) in ('46', '47', '48', '49', '01', '20')$$,
  $$select 'nada'::text where false$$,
  'Tampoco la que está por pagar (46), la cancelada (47), la realizada (48), la grupal (49), ni las de 2031 (01 y 20)');
select results_eq(
  $$select inicio, cancelable_hasta - inicio from public.citas_sin_plazo_para_cancelar
    where id_monitoria = '50000000-0000-0000-0000-000000005230'$$,
  $$values (date_trunc('minute', now() + interval '2 hours 30 minutes'), - interval '12 hours')$$,
  'Cada fila trae su inicio y el fin de su plazo (12 h antes)');
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000052b0","role":"authenticated"}';
select is((select count(*)::int from public.citas_sin_plazo_para_cancelar where id_monitoria::text like '50000000-0000-0000-0000-0000000052%'), 3,
  'B, otro admin activo, ve las mismas tres');
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-000000005201","role":"authenticated"}';
select is((select count(*)::int from public.citas_sin_plazo_para_cancelar), 0,
  'El monitor, que sí lee sus monitorías, recibe cero filas de la lista entera');
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000005201","role":"authenticated"}';
select is((select count(*)::int from public.monitoria where id = '50000000-0000-0000-0000-000000005243'), 1,
  'Control: el Lead L1 sí lee sus propias monitorías, entre ellas las de la lista');
select is((select count(*)::int from public.citas_sin_plazo_para_cancelar), 0,
  'Pero la lista entera le llega vacía: no es admin');
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000052c0","role":"authenticated"}';
select is((select count(*)::int from public.citas_sin_plazo_para_cancelar), 0, 'Un admin desactivado tampoco ve nada');
reset role;
set local role anon;
select throws_ok($$select * from public.citas_sin_plazo_para_cancelar$$, '42501', null, 'anon no puede leer la vista: permiso denegado');
reset role;
set local role service_role;
select throws_ok($$select * from public.citas_sin_plazo_para_cancelar$$, '42501', null,
  'service_role tampoco: es_admin() no se ejecuta con la llave secreta');
reset role;

-- ---------------------------------------------------------------------------
-- Las puertas con now(): la 30 empieza dentro de 2 h 30 min (el plazo ya venció y la sesión no empezó)
-- ---------------------------------------------------------------------------
call pg_temp.aislar();
set local role authenticated;
set local request.jwt.claims to '{"role":"authenticated"}';
select is(public.autorizar_cancelacion_fuera_de_plazo('50000000-0000-0000-0000-000000005230', 'fuerza_mayor', null), 'sin_sesion',
  'La puerta pública sin sesión (sin sub): sin_sesion');
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-000000005201","role":"authenticated"}';
select is(public.autorizar_cancelacion_fuera_de_plazo('50000000-0000-0000-0000-000000005230', 'fuerza_mayor', null), 'sin_permiso',
  'El monitor: sin_permiso');
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000005201","role":"authenticated"}';
select is(public.autorizar_cancelacion_fuera_de_plazo('50000000-0000-0000-0000-000000005230', 'fuerza_mayor', null), 'sin_permiso',
  'El Lead: sin_permiso');
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000052c0","role":"authenticated"}';
select is(public.autorizar_cancelacion_fuera_de_plazo('50000000-0000-0000-0000-000000005230', 'fuerza_mayor', null), 'sin_permiso',
  'Un admin desactivado: sin_permiso');
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-0000000052b0","role":"authenticated"}';
select is(public.autorizar_cancelacion_fuera_de_plazo('50000000-0000-0000-0000-000000005230', 'otro', null), 'nota_invalida',
  'B con «otro» y sin nota: nota_invalida, y no se cancela nada');
select is(public.autorizar_cancelacion_fuera_de_plazo('50000000-0000-0000-0000-000000005230', 'fuerza_mayor', E'Urgencia\ndel Lead'), 'autorizada',
  'B autoriza por la puerta pública, con la hora de la base: autorizada');
reset role;
select results_eq(
  $$select m.estado::text, m.motivo_cancelacion::text, e.id_admin, e.categoria, e.nota, e.autorizada_en = now()
    from public.monitoria m join public.cancelacion_excepcional e on e.id_monitoria = m.id
    where m.id = '50000000-0000-0000-0000-000000005230'$$,
  $$values ('cancelada'::text, 'estudiante'::text, 'a0000000-0000-0000-0000-0000000052b0'::uuid, 'fuerza_mayor'::text,
            E'Urgencia\ndel Lead'::text, true)$$,
  'Quedó cancelada por estudiante y la autorización guarda a B, la categoría, la nota y la hora de la base (now()), no la del navegador');
select results_eq(
  $$select r.monto, r.id_admin, r.motivo from public.reembolso r join public.pago p on p.id = r.id_pago
    where p.id_monitoria = '50000000-0000-0000-0000-000000005230'$$,
  $$values (35000, 'a0000000-0000-0000-0000-0000000052a0'::uuid,
            'Cancelaste la monitoría y un admin autorizó hacerlo fuera del plazo.'::text)$$,
  'Su pago aprobado tiene el reembolso completo, del primer admin activo y con el motivo de la autorización');
select is(pg_temp.autorizar('a0000000-0000-0000-0000-0000000052b0', '30', 'fuerza_mayor', null, now()), 'ya_cancelada',
  'Otra llamada con la hora de la base: ya_cancelada');
-- RN-35: la fecha quedó libre, pero agendarla otra vez pide 3 h de antelación (y a la 30 le faltan menos).
select pg_temp.como('c0000000-0000-0000-0000-000000005203');
select is(
  (select a.resultado from public.agendar_monitoria(
     '30000000-0000-0000-0000-000000005230',
     (select (i.inicio at time zone 'America/Bogota')::date from inicio_52 i where i.nn = '30'),
     'PGTAP-52', false) a),
  'sin_antelacion', 'RN-35: agendar de nuevo la franja de la 30 (a menos de 3 h) responde sin_antelacion: la fecha está libre pero ya no se alcanza');
select is(
  (select count(*)::int from public.monitoria m where m.id_franja = '30000000-0000-0000-0000-000000005230' and m.estado <> 'cancelada'),
  0, 'Y no hay otra monitoría activa en esa franja y fecha');

select * from finish();
rollback;
