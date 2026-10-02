-- Pruebas pgTAP del tope de correos por sesión al dejar el contacto (HU-075, D-34, D-36).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos. El proceso real de pg_cron no ve estas filas.
--
-- El tope y la purga se prueban con las versiones que reciben la hora (privado.anotar_correo_de_contacto y
-- privado.purgar_correos_de_contacto) y un `ahora` fijo, A = martes 10 de marzo de 2020 a las 12:00 en Bogotá. Está en
-- el pasado a propósito, como en expirar_reservas.test.sql: ningún correo que ya esté anotado en la base local (de una
-- prueba de integración) es de antes de A, así que lo que devuelve la purga es exacto. La puerta pública usa now(), que
-- dentro de la transacción no cambia, y se prueba al final con su propia sesión.
-- Dos envíos a la vez de la misma sesión no caben en una transacción: los cubre integracion/leads.test.ts. Aquí se
-- prueba que anotar toma el candado de la sesión.
--
-- Elenco (ids terminados en 75NN): sesiones anónimas 01 (llena el tope), 02 (otra sesión), 03 (la purga) y 04 (la
-- puerta pública). Correos tope75-1 a tope75-7@calibra.test.

begin;
create extension if not exists pgtap with schema extensions;

select plan(57);

-- ---------------------------------------------------------------------------
-- Estructura y permisos
-- ---------------------------------------------------------------------------
select has_table('privado', 'correo_de_contacto', 'Existe privado.correo_de_contacto, los correos que escribió cada sesión');
select columns_are('privado', 'correo_de_contacto', array['id_sesion', 'correo_hash', 'escrito_en'],
  'Guarda la sesión, el hash del correo y cuándo lo escribió: ninguna columna para el correo (supuesto 3)');
select col_is_pk('privado', 'correo_de_contacto', array['id_sesion', 'correo_hash'],
  'Una fila por sesión y correo distinto');
select is(
  (select confrelid::regclass::text || ' ' || confdeltype::text from pg_constraint
   where conrelid = 'privado.correo_de_contacto'::regclass and contype = 'f'),
  'auth.users c',
  'id_sesion es una sesión de auth.users y sus correos se borran con ella (on delete cascade)');
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'privado' and tablename = 'correo_de_contacto' and indexname = 'correo_de_contacto_escrito_en_idx'
      and indexdef like '%(escrito_en)'),
  'Existe correo_de_contacto_escrito_en_idx: lo recorre la purga');
select ok(
  (select relrowsecurity from pg_class where oid = 'privado.correo_de_contacto'::regclass),
  'La tabla tiene RLS');
select ok(
  not has_table_privilege('anon', 'privado.correo_de_contacto', 'select, insert, update, delete, truncate, references, trigger')
  and not has_table_privilege('authenticated', 'privado.correo_de_contacto', 'select, insert, update, delete, truncate, references, trigger')
  and not has_table_privilege('service_role', 'privado.correo_de_contacto', 'select, insert, update, delete, truncate, references, trigger'),
  'Ni el visitante, ni una sesión, ni el servidor la leen o la escriben: solo las funciones de la base');

select has_function('privado', 'anotar_correo_de_contacto', array['uuid', 'text', 'timestamp with time zone'],
  'Existe privado.anotar_correo_de_contacto, la que anota y cuenta, con la hora como parámetro (para probar los bordes)');
select has_function('privado', 'anotar_correo_de_contacto_del_servidor', array['uuid', 'text'],
  'Existe privado.anotar_correo_de_contacto_del_servidor, la que ejecuta el servidor con la hora de la base');
select has_function('public', 'anotar_correo_de_contacto', array['uuid', 'text'],
  'Existe su puerta en la Data API');
select has_function('privado', 'purgar_correos_de_contacto', array['timestamp with time zone'],
  'Existe privado.purgar_correos_de_contacto, la purga de cada hora');
select ok(
  (select prosecdef from pg_proc where oid = 'privado.anotar_correo_de_contacto(uuid, text, timestamptz)'::regprocedure)
  and (select prosecdef from pg_proc where oid = 'privado.anotar_correo_de_contacto_del_servidor(uuid, text)'::regprocedure)
  and (select prosecdef from pg_proc where oid = 'privado.purgar_correos_de_contacto(timestamptz)'::regprocedure)
  and not (select prosecdef from pg_proc where oid = 'public.anotar_correo_de_contacto(uuid, text)'::regprocedure),
  'Las de privado son security definer (escriben en la tabla privada); la puerta corre con los permisos de quien llama');
select ok(
  (select bool_and('search_path=""' = any(proconfig)) from pg_proc
   where oid in ('privado.anotar_correo_de_contacto(uuid, text, timestamptz)'::regprocedure,
                 'privado.anotar_correo_de_contacto_del_servidor(uuid, text)'::regprocedure,
                 'public.anotar_correo_de_contacto(uuid, text)'::regprocedure,
                 'privado.purgar_correos_de_contacto(timestamptz)'::regprocedure,
                 'public.parametros_contacto()'::regprocedure)),
  'Todas fijan un search_path vacío');
select is(
  array[pg_get_function_identity_arguments('public.anotar_correo_de_contacto(uuid, text)'::regprocedure),
        pg_get_function_result('public.anotar_correo_de_contacto(uuid, text)'::regprocedure),
        pg_get_function_result('privado.anotar_correo_de_contacto(uuid, text, timestamptz)'::regprocedure),
        pg_get_function_result('privado.purgar_correos_de_contacto(timestamptz)'::regprocedure)],
  array['p_id_sesion uuid, p_correo text', 'boolean', 'boolean', 'integer'],
  'La puerta no recibe la hora (nadie mueve la ventana) y dice si la sesión puede seguir; la purga, cuántos borró');
select ok(
  has_function_privilege('service_role', 'public.anotar_correo_de_contacto(uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.anotar_correo_de_contacto(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.anotar_correo_de_contacto(uuid, text)', 'execute'),
  'La puerta solo la llama el servidor (service_role)');
select ok(
  has_function_privilege('service_role', 'privado.anotar_correo_de_contacto_del_servidor(uuid, text)', 'execute')
  and has_schema_privilege('service_role', 'privado', 'usage')
  and not has_function_privilege('authenticated', 'privado.anotar_correo_de_contacto_del_servidor(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'privado.anotar_correo_de_contacto_del_servidor(uuid, text)', 'execute'),
  'La que usa now() también, solo el servidor: la puerta corre con sus permisos');
select ok(
  not has_function_privilege('anon', 'privado.anotar_correo_de_contacto(uuid, text, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'privado.anotar_correo_de_contacto(uuid, text, timestamptz)', 'execute')
  and not has_function_privilege('service_role', 'privado.anotar_correo_de_contacto(uuid, text, timestamptz)', 'execute')
  and not has_function_privilege('anon', 'privado.purgar_correos_de_contacto(timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'privado.purgar_correos_de_contacto(timestamptz)', 'execute')
  and not has_function_privilege('service_role', 'privado.purgar_correos_de_contacto(timestamptz)', 'execute'),
  'La versión con p_ahora y la purga no tienen grants: nadie elige la hora; la purga solo la corre pg_cron');
select ok(
  not exists (
    select 1
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid in ('privado.anotar_correo_de_contacto(uuid, text, timestamptz)'::regprocedure,
                    'privado.anotar_correo_de_contacto_del_servidor(uuid, text)'::regprocedure,
                    'public.anotar_correo_de_contacto(uuid, text)'::regprocedure,
                    'privado.purgar_correos_de_contacto(timestamptz)'::regprocedure,
                    'public.parametros_contacto()'::regprocedure)
      and a.grantee = 0),
  'Nadie las hereda de PUBLIC');
select ok(
  has_function_privilege('authenticated', 'public.parametros_contacto()', 'execute')
  and has_function_privilege('service_role', 'public.parametros_contacto()', 'execute')
  and not has_function_privilege('anon', 'public.parametros_contacto()', 'execute'),
  'parametros_contacto(): authenticated y service_role, anon no (como parametros_comprobantes)');
select results_eq(
  $$select tope_correos, tope_ventana_min from public.parametros_contacto()$$,
  $$values (5, 60)$$,
  'D-36: 5 correos distintos por sesión en una hora (el tope vive en la base)');
select is(
  (select count(*)::int from cron.job
   where jobname = 'calibra-purgar-correos-de-contacto' and schedule = '47 * * * *' and active),
  1, 'Existe un solo trabajo calibra-purgar-correos-de-contacto en pg_cron, activo y cada hora');
select matches(
  (select command from cron.job where jobname = 'calibra-purgar-correos-de-contacto'),
  '^select privado\.purgar_correos_de_contacto\(now\(\)\)$',
  'El trabajo llama a privado.purgar_correos_de_contacto con now()');

-- Sin permiso ni se ejecutan.
set local role authenticated;
select throws_ok(
  $$select public.anotar_correo_de_contacto('c0000000-0000-0000-0000-000000007501', 'x@calibra.test')$$, '42501', null,
  'Una sesión no puede anotar correos (ni preguntar por el tope de otra): permiso denegado');
reset role;
set local role anon;
select throws_ok(
  $$select public.anotar_correo_de_contacto('c0000000-0000-0000-0000-000000007501', 'x@calibra.test')$$, '42501', null,
  'Ni el visitante sin sesión');
reset role;
set local role service_role;
select throws_ok(
  $$select privado.anotar_correo_de_contacto('c0000000-0000-0000-0000-000000007501', 'x@calibra.test', now() + interval '2 hours')$$,
  '42501', null,
  'El servidor no puede llamar a la versión con p_ahora: no elige la hora');
reset role;

-- ---------------------------------------------------------------------------
-- Fixtures (como postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, is_anonymous)
select ('c0000000-0000-0000-0000-0000000075' || n)::uuid, true
from unnest(array['01', '02', '03', '04']) n;

-- ---------------------------------------------------------------------------
-- El tope (criterios 1 y 2)
-- ---------------------------------------------------------------------------
select is(
  privado.anotar_correo_de_contacto('c0000000-0000-0000-0000-000000007501', 'tope75-1@calibra.test', timestamptz '2020-03-10 12:00-05'),
  true, 'Primer correo de la sesión: sigue');
select ok(
  exists (
    select 1 from pg_locks l
    where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.granted
      and l.classid = 6801 and l.objid = hashtext('c0000000-0000-0000-0000-000000007501')::oid and l.objsubid = 2),
  'Anotar toma el candado 6801 de la sesión, el mismo de registrar_lead: dos envíos de la sesión van en fila');
select is(
  privado.anotar_correo_de_contacto('c0000000-0000-0000-0000-000000007501', 'tope75-2@calibra.test', timestamptz '2020-03-10 12:00-05'),
  true, 'Segundo: sigue');
select is(
  privado.anotar_correo_de_contacto('c0000000-0000-0000-0000-000000007501', 'tope75-3@calibra.test', timestamptz '2020-03-10 12:00-05'),
  true, 'Tercero: sigue');
select is(
  privado.anotar_correo_de_contacto('c0000000-0000-0000-0000-000000007501', 'tope75-4@calibra.test', timestamptz '2020-03-10 12:00-05'),
  true, 'Cuarto: sigue');
select is(
  privado.anotar_correo_de_contacto('c0000000-0000-0000-0000-000000007501', 'tope75-5@calibra.test', timestamptz '2020-03-10 12:00-05'),
  true, 'Quinto: sigue');
select results_eq(
  $$select count(*)::int, min(escrito_en), max(escrito_en) from privado.correo_de_contacto
    where id_sesion = 'c0000000-0000-0000-0000-000000007501'$$,
  $$values (5, timestamptz '2020-03-10 12:00-05', timestamptz '2020-03-10 12:00-05')$$,
  'Los cinco quedan anotados con la hora en que se escribieron');
select set_eq(
  $$select correo_hash from privado.correo_de_contacto where id_sesion = 'c0000000-0000-0000-0000-000000007501'$$,
  $$select encode(extensions.digest('tope75-' || n || '@calibra.test', 'sha256'), 'hex') from generate_series(1, 5) n$$,
  'Supuesto 3: se guarda el SHA-256 de cada correo normalizado, no el correo');

select is(
  privado.anotar_correo_de_contacto('c0000000-0000-0000-0000-000000007501', 'tope75-6@calibra.test', timestamptz '2020-03-10 12:00-05'),
  false, 'Criterio 1: el sexto correo distinto en la hora no pasa');
select results_eq(
  $$select count(*)::int,
           count(*) filter (where correo_hash = encode(extensions.digest('tope75-6@calibra.test', 'sha256'), 'hex'))::int
    from privado.correo_de_contacto where id_sesion = 'c0000000-0000-0000-0000-000000007501'$$,
  $$values (5, 0)$$,
  'Y no se anota: un intento frenado no cuenta');
select is(
  privado.anotar_correo_de_contacto('c0000000-0000-0000-0000-000000007501', 'tope75-6@calibra.test', timestamptz '2020-03-10 12:10-05'),
  false, 'Insistir con el mismo correo frenado sigue sin pasar');

-- ---------------------------------------------------------------------------
-- Repetir un correo no suma (criterio 3)
-- ---------------------------------------------------------------------------
select is(
  privado.anotar_correo_de_contacto('c0000000-0000-0000-0000-000000007501', '  TOPE75-3@Calibra.Test ', timestamptz '2020-03-10 12:30-05'),
  true, 'Criterio 3: repetir uno ya escrito (con mayúsculas y espacios) sigue, aunque el tope esté lleno');
select results_eq(
  $$select count(*)::int, min(escrito_en), max(escrito_en) from privado.correo_de_contacto
    where id_sesion = 'c0000000-0000-0000-0000-000000007501'$$,
  $$values (5, timestamptz '2020-03-10 12:00-05', timestamptz '2020-03-10 12:00-05')$$,
  'Y no suma ni mueve la hora en que se escribió');

-- Otra sesión, con el tope lejos: repetir tampoco suma.
select is(
  privado.anotar_correo_de_contacto('c0000000-0000-0000-0000-000000007502', 'tope75-1@calibra.test', timestamptz '2020-03-10 12:00-05'),
  true, 'Otra sesión no se ve afectada por el tope de la 01: escribe uno de sus correos');
select is(
  privado.anotar_correo_de_contacto('c0000000-0000-0000-0000-000000007502', ' Tope75-1@calibra.test', timestamptz '2020-03-10 12:00-05'),
  true, 'Lo repite (con otra forma de escribirlo) y sigue');
select is(
  privado.anotar_correo_de_contacto('c0000000-0000-0000-0000-000000007502', 'tope75-6@calibra.test', timestamptz '2020-03-10 12:00-05'),
  true, 'Y escribe el que a la 01 se le frenó');
select is(
  (select count(*)::int from privado.correo_de_contacto where id_sesion = 'c0000000-0000-0000-0000-000000007502'),
  2, 'A la 02 le cuentan 2 correos: el repetido no sumó');

-- ---------------------------------------------------------------------------
-- La hora móvil (criterio 4), con el borde de crear_verificacion_lead
-- ---------------------------------------------------------------------------
select is(
  privado.anotar_correo_de_contacto('c0000000-0000-0000-0000-000000007501', 'tope75-7@calibra.test',
    timestamptz '2020-03-10 13:00-05' - interval '1 microsecond'),
  false, 'Un microsegundo antes de que pase la hora desde los primeros, todavía cuentan: frena');
select is(
  privado.anotar_correo_de_contacto('c0000000-0000-0000-0000-000000007501', 'tope75-7@calibra.test', timestamptz '2020-03-10 13:00-05'),
  true, 'Criterio 4: a la hora justa ya no cuentan (lo escrito en ahora - 60 min queda fuera) y sigue normalmente');
select results_eq(
  $$select correo_hash, escrito_en from privado.correo_de_contacto where id_sesion = 'c0000000-0000-0000-0000-000000007501'$$,
  $$values (encode(extensions.digest('tope75-7@calibra.test', 'sha256'), 'hex'), timestamptz '2020-03-10 13:00-05')$$,
  'Al anotar se borró lo viejo de la sesión: le queda solo el correo nuevo');
select is(
  (select count(*)::int from privado.correo_de_contacto where id_sesion = 'c0000000-0000-0000-0000-000000007502'),
  2, 'Y no lo de otras sesiones: eso lo borra el proceso de cada hora');

-- ---------------------------------------------------------------------------
-- La purga de cada hora
-- ---------------------------------------------------------------------------
-- La 03 escribe un microsegundo después de A: a las 13:00 todavía cuenta. La 02 escribió en A: a las 13:00 ya no.
select is(
  privado.anotar_correo_de_contacto('c0000000-0000-0000-0000-000000007503', 'tope75-1@calibra.test',
    timestamptz '2020-03-10 12:00-05' + interval '1 microsecond'),
  true, 'La 03 escribe un correo un microsegundo después de A');
select is(
  privado.purgar_correos_de_contacto(timestamptz '2020-03-10 13:00-05'),
  2, 'La purga de las 13:00 borra los 2 correos de la 02, escritos justo en ahora - 60 min');
select results_eq(
  $$select right(id_sesion::text, 2), escrito_en from privado.correo_de_contacto
    where id_sesion in ('c0000000-0000-0000-0000-000000007501', 'c0000000-0000-0000-0000-000000007502',
                        'c0000000-0000-0000-0000-000000007503')
    order by 1$$,
  $$values ('01'::text, timestamptz '2020-03-10 13:00-05'),
           ('03'::text, timestamptz '2020-03-10 12:00-05' + interval '1 microsecond')$$,
  'Y deja lo que todavía cuenta, de cualquier sesión');
select is(
  privado.purgar_correos_de_contacto(timestamptz '2020-03-10 13:00-05'),
  0, 'Correrla otra vez no borra nada');

-- ---------------------------------------------------------------------------
-- Lo que no se acepta
-- ---------------------------------------------------------------------------
select throws_ok(
  $$insert into privado.correo_de_contacto (id_sesion, correo_hash)
    values ('c0000000-0000-0000-0000-000000007504', 'tope75-1@calibra.test')$$,
  '23514', null, 'La tabla solo acepta un SHA-256 en hexadecimal, no el correo');
select throws_ok(
  $$select privado.anotar_correo_de_contacto('c0000000-0000-0000-0000-000000007504', null, timestamptz '2020-03-10 12:00-05')$$,
  '22023', null, 'Sin correo es un error: el servidor nunca lo manda');
select throws_ok(
  $$select privado.anotar_correo_de_contacto('c0000000-0000-0000-0000-000000007504', '   ', timestamptz '2020-03-10 12:00-05')$$,
  '22023', null, 'Ni en blanco');
select is(
  (select count(*)::int from privado.correo_de_contacto where id_sesion = 'c0000000-0000-0000-0000-000000007504'),
  0, 'Y no se anota nada');

-- ---------------------------------------------------------------------------
-- La puerta del servidor, con la hora de la base
-- ---------------------------------------------------------------------------
set local role service_role;
select is(
  public.anotar_correo_de_contacto('c0000000-0000-0000-0000-000000007504', ' Puerta75@Calibra.test '),
  true, 'El servidor (service_role) anota por la puerta');
reset role;
select results_eq(
  $$select correo_hash, escrito_en from privado.correo_de_contacto where id_sesion = 'c0000000-0000-0000-0000-000000007504'$$,
  $$values (encode(extensions.digest('puerta75@calibra.test', 'sha256'), 'hex'), now())$$,
  'Con el correo normalizado y la hora de la base');

delete from auth.users where id = 'c0000000-0000-0000-0000-000000007504';
select is(
  (select count(*)::int from privado.correo_de_contacto where id_sesion = 'c0000000-0000-0000-0000-000000007504'),
  0, 'Si la sesión se borra, sus correos anotados se van con ella');

select * from finish();
rollback;
