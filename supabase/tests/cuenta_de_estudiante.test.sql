-- Pruebas pgTAP de la cuenta de Estudiante (HU-032, D-55 b).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos. El proceso real de pg_cron no ve estas filas.
--
-- Los topes se prueban con la versión que recibe la hora (privado.anotar_envio_de_cuenta) y un `ahora` fijo en el pasado,
-- como tope_de_correos.test.sql: ningún pedido anotado en la base local (de una prueba de integración) es de 2020, así que
-- los conteos y lo que devuelve la purga son exactos. Cada grupo de pruebas usa su propia fecha para no verse entre sí:
--   Q = 1 de febrero de 2020 (la purga), A = 10 de marzo de 2020 (el tope por sesión), G = 1 de mayo de 2020 (el tope total).
-- La puerta pública usa now(), que dentro de la transacción no cambia, y se prueba al final con sus propias sesiones.
-- Dos operaciones a la vez no caben en una transacción: la espera del for update de crear_estudiante y el candado global de
-- los topes los cubren integracion/cuenta-estudiante.test.ts (casos G y H). Aquí se prueba que las funciones toman los
-- candados que dicen tomar.
--
-- Elenco (ids terminados en 3200NN, 3201NN, 3202NN y 3203NN). Usuarios de Auth 3200NN y sus Leads 40000000-…-3200NN:
--   01 Estudiante que se crea (el Lead lo creó su sesión; el correo de Auth con mayúsculas y espacios)
--   02 Estudiante que se crea por lead_sesion (su sesión confirmó el correo de un Lead que ya existía, P-23)
--   03 anónimo con el correo confirmado (solo le falta dejar de ser anónimo)
--   04 con correo sin confirmar
--   05 sin correo   15 con el correo en blanco
--   06 sin Lead
--   07 segundo usuario del Lead 01 (lead_sesion), con otro correo
--   08 con un correo distinto del Lead   09 con un Lead sin correo
--   10 y 11 para simular una violación de llave única   12 para la puerta del servidor
--   14 anónimo sin correo
-- Sesiones de los topes: 3201NN (Q y A), 3202NN (G, 30 sesiones) y 3203NN (la puerta pública).

begin;
create extension if not exists pgtap with schema extensions;

select plan(124);

-- ---------------------------------------------------------------------------
-- Estructura y permisos
-- ---------------------------------------------------------------------------
select has_table('privado', 'envio_de_cuenta', 'Existe privado.envio_de_cuenta, los pedidos de cuenta de cada sesión');
select columns_are('privado', 'envio_de_cuenta', array['id', 'id_sesion', 'enviado_en'],
  'Guarda la sesión y la hora de cada pedido: ninguna columna para el correo');
select col_is_pk('privado', 'envio_de_cuenta', array['id'], 'Una fila por pedido');
select is(
  (select confrelid::regclass::text || ' ' || confdeltype::text from pg_constraint
   where conrelid = 'privado.envio_de_cuenta'::regclass and contype = 'f'),
  'auth.users c',
  'id_sesion es una sesión de auth.users y sus pedidos se borran con ella (on delete cascade)');
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'privado' and tablename = 'envio_de_cuenta' and indexname = 'envio_de_cuenta_enviado_en_idx'
      and indexdef like '%(enviado_en)'),
  'Existe envio_de_cuenta_enviado_en_idx: lo recorren el conteo total y la purga');
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'privado' and tablename = 'envio_de_cuenta' and indexname = 'envio_de_cuenta_sesion_idx'
      and indexdef like '%(id_sesion, enviado_en)'),
  'Existe envio_de_cuenta_sesion_idx: lo recorre el conteo de una sesión');
select ok(
  (select relrowsecurity from pg_class where oid = 'privado.envio_de_cuenta'::regclass),
  'La tabla tiene RLS');
select ok(
  not has_table_privilege('anon', 'privado.envio_de_cuenta', 'select, insert, update, delete, truncate, references, trigger')
  and not has_table_privilege('authenticated', 'privado.envio_de_cuenta', 'select, insert, update, delete, truncate, references, trigger')
  and not has_table_privilege('service_role', 'privado.envio_de_cuenta', 'select, insert, update, delete, truncate, references, trigger'),
  'Ni el visitante, ni una sesión, ni el servidor la leen o la escriben: solo las funciones de la base');

select has_function('privado', 'crear_estudiante', array['uuid'], 'Existe privado.crear_estudiante, la que hace el trabajo');
select has_function('public', 'crear_estudiante', array['uuid'], 'Existe su puerta en la Data API');
select has_function('privado', 'anotar_envio_de_cuenta', array['uuid', 'timestamp with time zone'],
  'Existe privado.anotar_envio_de_cuenta, con la hora como parámetro (para probar los bordes)');
select has_function('privado', 'anotar_envio_de_cuenta_del_servidor', array['uuid'],
  'Existe privado.anotar_envio_de_cuenta_del_servidor, la que ejecuta el servidor con la hora de la base');
select has_function('public', 'anotar_envio_de_cuenta', array['uuid'], 'Existe la puerta de los topes');
select has_function('public', 'parametros_cuenta', 'Existe parametros_cuenta()');
select has_function('privado', 'purgar_envios_de_cuenta', array['timestamp with time zone'],
  'Existe privado.purgar_envios_de_cuenta, la purga de cada hora');
select has_function('privado', 'fijar_correo_con_cuenta', 'Existe privado.fijar_correo_con_cuenta, la del trigger de lead');
select ok(
  (select prosecdef from pg_proc where oid = 'privado.crear_estudiante(uuid)'::regprocedure)
  and (select prosecdef from pg_proc where oid = 'privado.anotar_envio_de_cuenta(uuid, timestamptz)'::regprocedure)
  and (select prosecdef from pg_proc where oid = 'privado.anotar_envio_de_cuenta_del_servidor(uuid)'::regprocedure)
  and (select prosecdef from pg_proc where oid = 'privado.purgar_envios_de_cuenta(timestamptz)'::regprocedure)
  and (select prosecdef from pg_proc where oid = 'privado.fijar_correo_con_cuenta()'::regprocedure)
  and not (select prosecdef from pg_proc where oid = 'public.crear_estudiante(uuid)'::regprocedure)
  and not (select prosecdef from pg_proc where oid = 'public.anotar_envio_de_cuenta(uuid)'::regprocedure)
  and not (select prosecdef from pg_proc where oid = 'public.parametros_cuenta()'::regprocedure),
  'Las de privado son security definer (leen auth.users y escriben tablas cerradas); las puertas corren con los permisos de quien llama');
select ok(
  (select count(*) = 8 and bool_and(coalesce('search_path=""' = any(proconfig), false)) from pg_proc
   where oid in ('privado.crear_estudiante(uuid)'::regprocedure,
                 'public.crear_estudiante(uuid)'::regprocedure,
                 'privado.anotar_envio_de_cuenta(uuid, timestamptz)'::regprocedure,
                 'privado.anotar_envio_de_cuenta_del_servidor(uuid)'::regprocedure,
                 'public.anotar_envio_de_cuenta(uuid)'::regprocedure,
                 'public.parametros_cuenta()'::regprocedure,
                 'privado.purgar_envios_de_cuenta(timestamptz)'::regprocedure,
                 'privado.fijar_correo_con_cuenta()'::regprocedure)),
  'Todas fijan un search_path vacío');
select is(
  array[pg_get_function_identity_arguments('public.crear_estudiante(uuid)'::regprocedure),
        pg_get_function_result('public.crear_estudiante(uuid)'::regprocedure),
        pg_get_function_identity_arguments('public.anotar_envio_de_cuenta(uuid)'::regprocedure),
        pg_get_function_result('public.anotar_envio_de_cuenta(uuid)'::regprocedure),
        pg_get_function_result('privado.anotar_envio_de_cuenta(uuid, timestamptz)'::regprocedure),
        pg_get_function_result('privado.purgar_envios_de_cuenta(timestamptz)'::regprocedure)],
  array['p_id_usuario uuid', 'text', 'p_id_sesion uuid', 'text', 'text', 'integer'],
  'crear_estudiante recibe solo el id (el correo lo lee de Auth); la puerta de los topes no recibe la hora; la purga dice cuántos borró');
select ok(
  has_function_privilege('service_role', 'public.crear_estudiante(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.crear_estudiante(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.crear_estudiante(uuid)', 'execute')
  and has_function_privilege('service_role', 'privado.crear_estudiante(uuid)', 'execute')
  and has_schema_privilege('service_role', 'privado', 'usage')
  and not has_function_privilege('authenticated', 'privado.crear_estudiante(uuid)', 'execute')
  and not has_function_privilege('anon', 'privado.crear_estudiante(uuid)', 'execute'),
  'crear_estudiante, en sus dos capas, solo la llama el servidor (service_role)');
select ok(
  has_function_privilege('service_role', 'public.anotar_envio_de_cuenta(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.anotar_envio_de_cuenta(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.anotar_envio_de_cuenta(uuid)', 'execute')
  and has_function_privilege('service_role', 'privado.anotar_envio_de_cuenta_del_servidor(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'privado.anotar_envio_de_cuenta_del_servidor(uuid)', 'execute')
  and not has_function_privilege('anon', 'privado.anotar_envio_de_cuenta_del_servidor(uuid)', 'execute'),
  'anotar_envio_de_cuenta, en sus dos capas, solo la llama el servidor (service_role)');
select ok(
  has_function_privilege('authenticated', 'public.parametros_cuenta()', 'execute')
  and has_function_privilege('service_role', 'public.parametros_cuenta()', 'execute')
  and not has_function_privilege('anon', 'public.parametros_cuenta()', 'execute'),
  'parametros_cuenta(): authenticated y service_role, anon no (como parametros_contacto)');
select ok(
  not has_function_privilege('anon', 'privado.anotar_envio_de_cuenta(uuid, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'privado.anotar_envio_de_cuenta(uuid, timestamptz)', 'execute')
  and not has_function_privilege('service_role', 'privado.anotar_envio_de_cuenta(uuid, timestamptz)', 'execute')
  and not has_function_privilege('anon', 'privado.purgar_envios_de_cuenta(timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'privado.purgar_envios_de_cuenta(timestamptz)', 'execute')
  and not has_function_privilege('service_role', 'privado.purgar_envios_de_cuenta(timestamptz)', 'execute')
  and not has_function_privilege('anon', 'privado.fijar_correo_con_cuenta()', 'execute')
  and not has_function_privilege('authenticated', 'privado.fijar_correo_con_cuenta()', 'execute')
  and not has_function_privilege('service_role', 'privado.fijar_correo_con_cuenta()', 'execute'),
  'La versión con p_ahora, la purga y la del trigger no tienen grants: nadie elige la hora; la purga solo la corre pg_cron');
select ok(
  not exists (
    select 1
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid in ('privado.crear_estudiante(uuid)'::regprocedure,
                    'public.crear_estudiante(uuid)'::regprocedure,
                    'privado.anotar_envio_de_cuenta(uuid, timestamptz)'::regprocedure,
                    'privado.anotar_envio_de_cuenta_del_servidor(uuid)'::regprocedure,
                    'public.anotar_envio_de_cuenta(uuid)'::regprocedure,
                    'public.parametros_cuenta()'::regprocedure,
                    'privado.purgar_envios_de_cuenta(timestamptz)'::regprocedure,
                    'privado.fijar_correo_con_cuenta()'::regprocedure)
      and a.grantee = 0),
  'Nadie las hereda de PUBLIC');
select results_eq(
  $$select tope_envios_sesion, tope_envios_total, ventana_min from public.parametros_cuenta()$$,
  $$values (3, 20, 60)$$,
  'Criterio 13: 3 pedidos por sesión y 20 en total en una hora (los topes viven en la base)');
select is(
  (select count(*)::int from cron.job
   where jobname = 'calibra-purgar-envios-de-cuenta' and schedule = '53 * * * *' and active),
  1, 'Existe un solo trabajo calibra-purgar-envios-de-cuenta en pg_cron, activo y cada hora');
select matches(
  (select command from cron.job where jobname = 'calibra-purgar-envios-de-cuenta'),
  '^select privado\.purgar_envios_de_cuenta\(now\(\)\)$',
  'El trabajo llama a privado.purgar_envios_de_cuenta con now()');

-- El trigger del correo fijo: antes de la actualización, por fila, solo si cambia el correo a otro valor no nulo.
select has_trigger('public', 'lead', 'lead_correo_fijo_con_cuenta', 'Existe el trigger lead_correo_fijo_con_cuenta en lead');
select trigger_is('public', 'lead', 'lead_correo_fijo_con_cuenta', 'privado', 'fijar_correo_con_cuenta',
  'Llama a privado.fijar_correo_con_cuenta');
select matches(
  (select pg_get_triggerdef(t.oid) from pg_trigger t
   where t.tgrelid = 'public.lead'::regclass and t.tgname = 'lead_correo_fijo_con_cuenta'),
  '^CREATE TRIGGER lead_correo_fijo_con_cuenta BEFORE UPDATE OF correo ON public\.lead FOR EACH ROW WHEN \(\(\(new\.correo IS NOT NULL\) AND \(new\.correo IS DISTINCT FROM old\.correo\)\)\) EXECUTE FUNCTION privado\.fijar_correo_con_cuenta\(\)$',
  'Es BEFORE UPDATE OF correo, por fila, con su when: correo nuevo no nulo y distinto del anterior');

-- Ninguna sesión escribe estudiante: el rol nace solo por crear_estudiante (con la llave secreta).
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'estudiante' and cmd in ('INSERT', 'ALL')),
  0, 'estudiante no tiene política de inserción');
select ok(
  not has_table_privilege('anon', 'public.estudiante', 'insert, update, delete')
  and not has_table_privilege('authenticated', 'public.estudiante', 'insert, update, delete'),
  'Ni el visitante ni una sesión escriben estudiante');

-- Sin permiso ni se ejecutan.
set local role authenticated;
select throws_ok(
  $$select public.crear_estudiante('c0000000-0000-0000-0000-000000320001')$$, '42501', null,
  'Una sesión no puede crear Estudiantes: permiso denegado');
select throws_ok(
  $$select privado.crear_estudiante('c0000000-0000-0000-0000-000000320001')$$, '42501', null,
  'Ni llamando a la función interna');
select throws_ok(
  $$select public.anotar_envio_de_cuenta('c0000000-0000-0000-0000-000000320101')$$, '42501', null,
  'Una sesión no anota pedidos de cuenta (ni gasta el cupo de otra)');
select throws_ok(
  $$insert into public.estudiante (id, id_lead) values ('c0000000-0000-0000-0000-000000320001', '40000000-0000-0000-0000-000000320001')$$,
  '42501', null, 'Una sesión no inserta en estudiante');
select throws_ok(
  $$select count(*) from privado.envio_de_cuenta$$, '42501', null, 'Una sesión no lee los pedidos de cuenta de las demás');
reset role;
set local role anon;
select throws_ok(
  $$select public.crear_estudiante('c0000000-0000-0000-0000-000000320001')$$, '42501', null,
  'Ni el visitante sin sesión crea Estudiantes');
select throws_ok(
  $$select public.anotar_envio_de_cuenta('c0000000-0000-0000-0000-000000320101')$$, '42501', null,
  'Ni anota pedidos de cuenta');
select throws_ok(
  $$insert into public.estudiante (id, id_lead) values ('c0000000-0000-0000-0000-000000320001', '40000000-0000-0000-0000-000000320001')$$,
  '42501', null, 'Ni inserta en estudiante');
reset role;
set local role service_role;
select throws_ok(
  $$select privado.anotar_envio_de_cuenta('c0000000-0000-0000-0000-000000320101', now() + interval '2 hours')$$, '42501', null,
  'El servidor no puede llamar a la versión con p_ahora: no elige la hora');
select throws_ok(
  $$select count(*) from privado.envio_de_cuenta$$, '42501', null,
  'Ni el servidor lee la tabla de pedidos: solo las funciones');
reset role;

-- ---------------------------------------------------------------------------
-- Fixtures (como postgres)
-- ---------------------------------------------------------------------------
-- El correo de Auth del 01 con mayúsculas y espacios: Auth lo guarda en minúsculas, pero la función no debe fiarse de eso.
insert into auth.users (id, email, email_confirmed_at, is_anonymous) values
  ('c0000000-0000-0000-0000-000000320001', '  Cuenta32.Uno@Calibra.Test ', now(), false),
  ('c0000000-0000-0000-0000-000000320002', 'cuenta32.dos@calibra.test', now(), false),
  ('c0000000-0000-0000-0000-000000320003', 'cuenta32.tres@calibra.test', now(), true),
  ('c0000000-0000-0000-0000-000000320004', 'cuenta32.cuatro@calibra.test', null, false),
  ('c0000000-0000-0000-0000-000000320005', null, now(), false),
  ('c0000000-0000-0000-0000-000000320006', 'cuenta32.seis@calibra.test', now(), false),
  ('c0000000-0000-0000-0000-000000320007', 'cuenta32.siete@calibra.test', now(), false),
  ('c0000000-0000-0000-0000-000000320008', 'cuenta32.ocho@calibra.test', now(), false),
  ('c0000000-0000-0000-0000-000000320009', 'cuenta32.nueve@calibra.test', now(), false),
  ('c0000000-0000-0000-0000-000000320010', 'cuenta32.diez@calibra.test', now(), false),
  ('c0000000-0000-0000-0000-000000320011', 'cuenta32.once@calibra.test', now(), false),
  ('c0000000-0000-0000-0000-000000320012', 'cuenta32.doce@calibra.test', now(), false),
  ('c0000000-0000-0000-0000-000000320014', null, null, true),
  ('c0000000-0000-0000-0000-000000320015', '   ', now(), false);

-- Los Leads: 01 lo creó su sesión; 02 existe sin sesión y el 02 la ligó por lead_sesion; el 06 no tiene.
insert into public.lead (id, id_sesion_anonima, nombre, numero_telefono, correo, acepta_tratamiento_datos, fecha_consentimiento) values
  ('40000000-0000-0000-0000-000000320001', 'c0000000-0000-0000-0000-000000320001', 'Lead uno', '3000000001', 'cuenta32.uno@calibra.test', true, now()),
  ('40000000-0000-0000-0000-000000320002', null, 'Lead dos', '3000000002', 'cuenta32.dos@calibra.test', true, now()),
  ('40000000-0000-0000-0000-000000320003', 'c0000000-0000-0000-0000-000000320003', 'Lead tres', null, 'cuenta32.tres@calibra.test', true, now()),
  ('40000000-0000-0000-0000-000000320004', 'c0000000-0000-0000-0000-000000320004', 'Lead cuatro', null, 'cuenta32.cuatro@calibra.test', true, now()),
  ('40000000-0000-0000-0000-000000320005', 'c0000000-0000-0000-0000-000000320005', 'Lead cinco', null, 'cuenta32.cinco@calibra.test', true, now()),
  ('40000000-0000-0000-0000-000000320008', 'c0000000-0000-0000-0000-000000320008', 'Lead ocho', null, 'otro.ocho32@calibra.test', true, now()),
  ('40000000-0000-0000-0000-000000320009', 'c0000000-0000-0000-0000-000000320009', 'Lead nueve', '3000000009', null, true, now()),
  ('40000000-0000-0000-0000-000000320010', 'c0000000-0000-0000-0000-000000320010', 'Lead diez', null, 'cuenta32.diez@calibra.test', true, now()),
  ('40000000-0000-0000-0000-000000320011', 'c0000000-0000-0000-0000-000000320011', 'Lead once', null, 'cuenta32.once@calibra.test', true, now()),
  ('40000000-0000-0000-0000-000000320012', 'c0000000-0000-0000-0000-000000320012', 'Lead doce', null, 'cuenta32.doce@calibra.test', true, now()),
  ('40000000-0000-0000-0000-000000320014', 'c0000000-0000-0000-0000-000000320014', 'Lead catorce', null, 'cuenta32.catorce@calibra.test', true, now()),
  ('40000000-0000-0000-0000-000000320015', 'c0000000-0000-0000-0000-000000320015', 'Lead quince', null, 'cuenta32.quince@calibra.test', true, now());
insert into public.lead_sesion (id_sesion, id_lead) values
  ('c0000000-0000-0000-0000-000000320002', '40000000-0000-0000-0000-000000320002'),
  ('c0000000-0000-0000-0000-000000320007', '40000000-0000-0000-0000-000000320001');

-- Cómo estaban los Leads antes de crear ninguna cuenta (criterio 18: crear la cuenta no escribe lead).
create temporary table lead_antes as
select l.id, to_jsonb(l) as fila from public.lead l where l.id::text like '40000000-0000-0000-0000-0000003200%';

-- Resultado de crear_estudiante y cuántos Estudiantes nacieron con esa llamada (de los de esta prueba).
create function pg_temp.probar(p_id uuid) returns text[]
language plpgsql
as $$
declare
  v_antes integer;
  v_resultado text;
  v_despues integer;
begin
  select count(*) into v_antes from public.estudiante e where e.id::text like 'c0000000-0000-0000-0000-0000003200%';
  v_resultado := privado.crear_estudiante(p_id);
  select count(*) into v_despues from public.estudiante e where e.id::text like 'c0000000-0000-0000-0000-0000003200%';
  return array[v_resultado, (v_despues - v_antes)::text];
end;
$$;

-- ---------------------------------------------------------------------------
-- crear_estudiante: la cuenta que sí se crea (criterios 4, 12 y 18)
-- ---------------------------------------------------------------------------
-- Antes de crearla, la sesión sigue siendo anónima aunque el token traiga el correo de Auth ya confirmado.
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000320001","role":"authenticated","is_anonymous":true}';
select is(public.mi_rol(), 'anonimo', 'Antes de crear el Estudiante, mi_rol() sigue en anonimo');
reset role;

select is(
  pg_temp.probar('c0000000-0000-0000-0000-000000320001'), array['creada', '1'],
  'Criterio 4: con el correo confirmado, no anónimo, y el del Lead (aunque Auth lo traiga con mayúsculas y espacios), se crea');
select results_eq(
  $$select id_lead from public.estudiante where id = 'c0000000-0000-0000-0000-000000320001'$$,
  $$values ('40000000-0000-0000-0000-000000320001'::uuid)$$,
  'El Estudiante queda ligado al Lead de la sesión, con el mismo id del usuario');
select ok(
  exists (
    select 1 from pg_locks l
    where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.granted
      and l.classid = 6801 and l.objid = hashtext('c0000000-0000-0000-0000-000000320001')::oid and l.objsubid = 2),
  'Crear toma el candado 6801 de la sesión, el mismo de registrar_lead: dos clics, o crear la cuenta y editar el contacto, van en fila');
select matches(
  pg_get_functiondef('privado.crear_estudiante(uuid)'::regprocedure),
  'from public\.lead l where l\.id = v_id_lead\s+for update',
  'La fuente toma la fila del Lead con for update (la espera de verdad la prueba la integración, caso H)');
select is(
  pg_temp.probar('c0000000-0000-0000-0000-000000320001'), array['creada', '0'],
  'Criterio 14: repetirla no falla, responde creada y no crea otra fila');
select is(
  (select count(*)::int from public.estudiante where id = 'c0000000-0000-0000-0000-000000320001'),
  1, 'Y queda una sola fila');

set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000320001","role":"authenticated","is_anonymous":true}';
select is(public.mi_rol(), 'estudiante', 'Después, mi_rol() devuelve estudiante (mira la tabla antes que el token)');
select is(
  (select count(*)::int from public.lead where id = '40000000-0000-0000-0000-000000320001'),
  1, 'Y la sesión sigue viendo su Lead: es el mismo id');
reset role;

-- La vía lead_sesion (P-23): la sesión confirmó el correo de un Lead que ya existía.
select is(
  pg_temp.probar('c0000000-0000-0000-0000-000000320002'), array['creada', '1'],
  'También con el Lead ligado por lead_sesion (resuelto con privado.lead_de_la_sesion)');
select results_eq(
  $$select id_lead from public.estudiante where id = 'c0000000-0000-0000-0000-000000320002'$$,
  $$values ('40000000-0000-0000-0000-000000320002'::uuid)$$,
  'Queda ligado a ese Lead');

-- ---------------------------------------------------------------------------
-- crear_estudiante: lo que no se crea (criterios 10, 12 y 14). Tras cada resultado, estudiante no cambia.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.probar('c0000000-0000-0000-0000-000000320003'), array['no_confirmada', '0'],
  'no_confirmada con el usuario anónimo, aunque su correo figure confirmado y sea el del Lead');
select is(
  pg_temp.probar('c0000000-0000-0000-0000-000000320014'), array['no_confirmada', '0'],
  'no_confirmada con un anónimo sin correo');
select is(
  pg_temp.probar('c0000000-0000-0000-0000-000000320004'), array['no_confirmada', '0'],
  'no_confirmada con el correo del Lead sin confirmar (email_confirmed_at nulo)');
select is(
  pg_temp.probar('c0000000-0000-0000-0000-000000320005'), array['no_confirmada', '0'],
  'no_confirmada con un usuario sin correo (la comparación con el del Lead no se evalúa con nulos)');
select is(
  pg_temp.probar('c0000000-0000-0000-0000-000000320015'), array['no_confirmada', '0'],
  'no_confirmada con el correo en blanco');
select is(
  pg_temp.probar('c0000000-0000-0000-0000-000000329999'), array['no_confirmada', '0'],
  'no_confirmada con un id que no existe en Auth');
select is(
  pg_temp.probar('c0000000-0000-0000-0000-000000320006'), array['sin_lead', '0'],
  'sin_lead con un usuario confirmado que no es de ningún Lead');
select is(
  pg_temp.probar('c0000000-0000-0000-0000-000000320007'), array['ya_tiene_cuenta', '0'],
  'Criterio 10: ya_tiene_cuenta con un segundo usuario del mismo Lead...');
select is(
  (select count(*)::int from public.estudiante where id_lead = '40000000-0000-0000-0000-000000320001'),
  1, '...y el Lead sigue con un solo Estudiante');
select isnt(
  (select u.email::text from auth.users u where u.id = 'c0000000-0000-0000-0000-000000320007'),
  (select l.correo from public.lead l where l.id = '40000000-0000-0000-0000-000000320001'),
  'Ese segundo usuario tiene otro correo: ya_tiene_cuenta se comprueba antes que correo_distinto');
select is(
  pg_temp.probar('c0000000-0000-0000-0000-000000320008'), array['correo_distinto', '0'],
  'Criterio 12: correo_distinto si el correo confirmado no es el del Lead');
select is(
  pg_temp.probar('c0000000-0000-0000-0000-000000320009'), array['correo_distinto', '0'],
  'correo_distinto con un Lead sin correo (solo teléfono)');
select is(
  pg_temp.probar('c0000000-0000-0000-0000-000000320003'), array['no_confirmada', '0'],
  'Y el anónimo sigue en no_confirmada cuando ya hay Estudiantes: la comprobación de «ya es Estudiante» mira a ese usuario');

-- Guardas contra una consulta sin where: dos Leads y dos usuarios confirmados son independientes.
select is(
  (select count(*)::int from public.estudiante
   where id in ('c0000000-0000-0000-0000-000000320001', 'c0000000-0000-0000-0000-000000320002')),
  2, 'Crear la cuenta de uno no crea ni bloquea la del otro: cada Lead mira solo su Estudiante');
select is(
  (select count(*)::int from public.estudiante where id::text like 'c0000000-0000-0000-0000-0000003200%'),
  2, 'En total solo nacieron los dos de arriba');

-- Criterio 18: el estado del Lead no cambia.
select is(
  (select count(*)::int from lead_antes a join public.lead l on l.id = a.id where to_jsonb(l) is distinct from a.fila),
  0, 'Criterio 18 (RN-09): crear los Estudiantes no escribió ningún Lead (todas las columnas, incluido el estado)');
select is(
  (select estado::text from public.lead where id = '40000000-0000-0000-0000-000000320001'),
  'nuevo', 'El Lead sigue en nuevo');

-- ---------------------------------------------------------------------------
-- crear_estudiante: la violación de la llave única se atrapa solo si es la del Lead
-- ---------------------------------------------------------------------------
-- Con el Lead bloqueado no debería saltar; se simula con un trigger que lanza unique_violation con el nombre de la llave.
create function public.zz_simular_unique_32() returns trigger language plpgsql as $$
begin
  raise exception 'simulada' using errcode = 'unique_violation', constraint = tg_argv[0];
end;
$$;
create trigger zz_simular_unique_32 before insert on public.estudiante
  for each row execute function public.zz_simular_unique_32('estudiante_id_lead_key');
select is(
  pg_temp.probar('c0000000-0000-0000-0000-000000320010'), array['ya_tiene_cuenta', '0'],
  'Si salta estudiante_id_lead_key (otro Estudiante ligó el Lead en el medio), responde ya_tiene_cuenta');
drop trigger zz_simular_unique_32 on public.estudiante;
create trigger zz_simular_unique_32 before insert on public.estudiante
  for each row execute function public.zz_simular_unique_32('estudiante_pkey');
select throws_ok(
  $$select privado.crear_estudiante('c0000000-0000-0000-0000-000000320011')$$, '23505', 'simulada',
  'Si salta cualquier otra llave única, el error se propaga: no se disfraza de ya_tiene_cuenta');
select is(
  (select count(*)::int from public.estudiante where id in ('c0000000-0000-0000-0000-000000320010', 'c0000000-0000-0000-0000-000000320011')),
  0, 'Y en los dos casos no queda ninguna fila');
drop trigger zz_simular_unique_32 on public.estudiante;
drop function public.zz_simular_unique_32();

-- ---------------------------------------------------------------------------
-- La puerta del servidor
-- ---------------------------------------------------------------------------
set local role service_role;
select is(
  public.crear_estudiante('c0000000-0000-0000-0000-000000320012'), 'creada',
  'El servidor (service_role) crea el Estudiante por la puerta pública');
select is(
  public.crear_estudiante('c0000000-0000-0000-0000-000000320006'), 'sin_lead',
  'Y recibe los mismos resultados');
reset role;

-- ---------------------------------------------------------------------------
-- El trigger: el correo de un Lead con cuenta queda fijo (D-55 b)
-- ---------------------------------------------------------------------------
-- El 01 y el 02 ya son Estudiantes.
select throws_ok(
  $$update public.lead set correo = 'otro32@calibra.test' where id = '40000000-0000-0000-0000-000000320001'$$,
  '23514', 'lead_correo_fijo_con_cuenta: el correo de un contacto con cuenta no se cambia',
  'D-55 b: cambiar el correo de un Lead con cuenta da check_violation con lead_correo_fijo_con_cuenta en el mensaje');
select is(
  (select correo from public.lead where id = '40000000-0000-0000-0000-000000320001'),
  'cuenta32.uno@calibra.test', 'Y la fila no cambió');
select throws_ok(
  $$update public.lead set correo = 'CUENTA32.UNO@CALIBRA.TEST' where id = '40000000-0000-0000-0000-000000320001'$$,
  '23514', 'lead_correo_fijo_con_cuenta: el correo de un contacto con cuenta no se cambia',
  'Una escritura distinta del mismo correo (mayúsculas) tampoco pasa: el trigger corre antes que el CHECK de normalización');
select lives_ok(
  $$update public.lead set correo = 'cuenta32.uno@calibra.test' where id = '40000000-0000-0000-0000-000000320001'$$,
  'Escribir el mismo correo no hace nada y se permite');
select lives_ok(
  $$update public.lead set nombre = 'Lead uno cambiado', numero_telefono = '3111111111', acepta_contacto = true
    where id = '40000000-0000-0000-0000-000000320001'$$,
  'El nombre, el teléfono y la autorización de contacto se siguen actualizando');
select results_eq(
  $$select nombre, numero_telefono, acepta_contacto from public.lead where id = '40000000-0000-0000-0000-000000320001'$$,
  $$values ('Lead uno cambiado'::text, '3111111111'::text, true)$$,
  'Y los cambios quedaron');
select lives_ok(
  $$update public.lead set correo = null where id = '40000000-0000-0000-0000-000000320002'$$,
  'Pasar el correo a nulo queda libre (supresión de datos): el Lead conserva el teléfono');
select is(
  (select correo from public.lead where id = '40000000-0000-0000-0000-000000320002'),
  null::text, 'Y quedó en nulo');
select throws_ok(
  $$update public.lead set correo = 'cuenta32.dos@calibra.test' where id = '40000000-0000-0000-0000-000000320002'$$,
  '23514', 'lead_correo_fijo_con_cuenta: el correo de un contacto con cuenta no se cambia',
  'Pasar de nulo a un correo también se rechaza si el Lead tiene cuenta (la condición compara con is distinct from)');
select lives_ok(
  $$update public.lead set correo = 'nuevo.ocho32@calibra.test' where id = '40000000-0000-0000-0000-000000320008'$$,
  'Un Lead sin cuenta cambia de correo con normalidad');
select is(
  (select correo from public.lead where id = '40000000-0000-0000-0000-000000320008'),
  'nuevo.ocho32@calibra.test', 'Y el cambio quedó');

-- Otro Lead con cuenta no se ve afectado por el trigger de este, y el de este sí se libera si se borra su cuenta.
delete from public.estudiante where id = 'c0000000-0000-0000-0000-000000320001';
select lives_ok(
  $$update public.lead set correo = 'otro32@calibra.test' where id = '40000000-0000-0000-0000-000000320001'$$,
  'Sin la fila de estudiante, el correo se cambia: el trigger mira la tabla en cada cambio');

-- Con el correo cambiado después de pedir la cuenta, la creación no pasa (correo_distinto): la mitad de «ya no coincide».
select is(
  pg_temp.probar('c0000000-0000-0000-0000-000000320001'), array['correo_distinto', '0'],
  'Y si el Lead cambió de correo después de pedir la cuenta (antes de que existiera el Estudiante), correo_distinto');

-- ---------------------------------------------------------------------------
-- Los topes (criterio 13)
-- ---------------------------------------------------------------------------
insert into auth.users (id, is_anonymous)
select ('c0000000-0000-0000-0000-0000003201' || lpad(n::text, 2, '0'))::uuid, true from generate_series(1, 3) n;
insert into auth.users (id, is_anonymous)
select ('c0000000-0000-0000-0000-0000003202' || lpad(n::text, 2, '0'))::uuid, true from generate_series(1, 30) n;
insert into auth.users (id, is_anonymous)
select ('c0000000-0000-0000-0000-0000003203' || lpad(n::text, 2, '0'))::uuid, true from generate_series(1, 6) n;

-- Tope por sesión, con A = 10 de marzo de 2020, 12:00 en Bogotá.
select is(
  privado.anotar_envio_de_cuenta('c0000000-0000-0000-0000-000000320101', timestamptz '2020-03-10 12:00-05'),
  'ok', 'Primer pedido de la sesión: ok');
select ok(
  exists (
    select 1 from pg_locks l
    where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.granted
      and l.classid = 6801 and l.objid = hashtext('c0000000-0000-0000-0000-000000320101')::oid and l.objsubid = 2),
  'Anotar toma el candado 6801 de la sesión, el mismo de registrar_lead: dos pedidos de la sesión van en fila');
select ok(
  exists (
    select 1 from pg_locks l
    where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.granted and l.objsubid = 1
      and ((l.classid::bigint << 32) | l.objid::bigint) = hashtextextended('envio_de_cuenta:tope', 0)),
  'Y el candado global del techo (envio_de_cuenta:tope): dos sesiones a la vez no lo pasan');
select is(
  privado.anotar_envio_de_cuenta('c0000000-0000-0000-0000-000000320101', timestamptz '2020-03-10 12:00-05'),
  'ok', 'Segundo: ok');
select is(
  privado.anotar_envio_de_cuenta('c0000000-0000-0000-0000-000000320101', timestamptz '2020-03-10 12:00-05'),
  'ok', 'Tercero: ok');
select results_eq(
  $$select count(*)::int, min(enviado_en), max(enviado_en) from privado.envio_de_cuenta
    where id_sesion = 'c0000000-0000-0000-0000-000000320101'$$,
  $$values (3, timestamptz '2020-03-10 12:00-05', timestamptz '2020-03-10 12:00-05')$$,
  'Los tres quedan anotados con la hora en que se pidieron');
select is(
  privado.anotar_envio_de_cuenta('c0000000-0000-0000-0000-000000320101', timestamptz '2020-03-10 12:00-05'),
  'tope_de_sesion', 'Criterio 13: el cuarto en la hora no pasa');
select is(
  (select count(*)::int from privado.envio_de_cuenta where id_sesion = 'c0000000-0000-0000-0000-000000320101'),
  3, 'Y no se anota: un intento frenado no cuenta');
select is(
  privado.anotar_envio_de_cuenta('c0000000-0000-0000-0000-000000320101', timestamptz '2020-03-10 12:30-05'),
  'tope_de_sesion', 'Insistir media hora después sigue sin pasar');
select is(
  privado.anotar_envio_de_cuenta('c0000000-0000-0000-0000-000000320102', timestamptz '2020-03-10 12:00-05'),
  'ok', 'Otra sesión no se ve afectada por el tope de la 01');

-- La hora móvil, con el borde de HU-075: lo anotado justo en ahora - ventana ya no cuenta.
select is(
  privado.anotar_envio_de_cuenta('c0000000-0000-0000-0000-000000320101', timestamptz '2020-03-10 13:00-05' - interval '1 microsecond'),
  'tope_de_sesion', 'Un microsegundo antes de que pase la hora desde los primeros, todavía cuentan: frena');
select is(
  privado.anotar_envio_de_cuenta('c0000000-0000-0000-0000-000000320101', timestamptz '2020-03-10 13:00-05'),
  'ok', 'A la hora justa ya no cuentan (lo anotado en ahora - 60 min queda fuera) y el pedido pasa');
select results_eq(
  $$select enviado_en from privado.envio_de_cuenta where id_sesion = 'c0000000-0000-0000-0000-000000320101'$$,
  $$values (timestamptz '2020-03-10 13:00-05')$$,
  'Al anotar se borró lo viejo de la sesión: le queda solo el pedido nuevo');
select is(
  (select count(*)::int from privado.envio_de_cuenta where id_sesion = 'c0000000-0000-0000-0000-000000320102'),
  1, 'Y no lo de otras sesiones: eso lo borra el proceso de cada hora');

-- El límite superior: lo posterior a ahora no cuenta, ni por sesión ni en total.
insert into privado.envio_de_cuenta (id_sesion, enviado_en)
select 'c0000000-0000-0000-0000-000000320103', timestamptz '2020-03-10 12:00-05' + interval '1 day' from generate_series(1, 3);
select is(
  privado.anotar_envio_de_cuenta('c0000000-0000-0000-0000-000000320103', timestamptz '2020-03-10 12:00-05'),
  'ok', 'Tres pedidos de un día después de ahora no cuentan para un pedido en ahora (la prueba no ve el futuro)');

-- Una sesión que no existe no deja nada.
select throws_ok(
  $$select privado.anotar_envio_de_cuenta('c0000000-0000-0000-0000-000000329998', timestamptz '2020-03-10 12:00-05')$$,
  '23503', null, 'Una sesión que no existe en auth.users falla con 23503');
select is(
  (select count(*)::int from privado.envio_de_cuenta where id_sesion = 'c0000000-0000-0000-0000-000000329998'),
  0, 'Y no deja ninguna fila');

-- El tope total, con G = 1 de mayo de 2020, 12:00 en Bogotá. Hay un pedido justo en G - 60 min (no cuenta), 19 en G, 5 de
-- G + 1 día (no cuentan) y se completa el techo con el pedido 20.
select is(
  privado.anotar_envio_de_cuenta('c0000000-0000-0000-0000-000000320220', timestamptz '2020-05-01 12:00-05' - interval '60 minutes'),
  'ok', 'Un pedido de la sesión 20 justo una hora antes de G');
select is(
  (select count(*)::int from generate_series(1, 19) n,
     lateral (select privado.anotar_envio_de_cuenta(('c0000000-0000-0000-0000-0000003202' || lpad(n::text, 2, '0'))::uuid,
                timestamptz '2020-05-01 12:00-05') as r) x
   where x.r = 'ok'),
  19, 'Diecinueve sesiones piden en G y todas pasan');
insert into privado.envio_de_cuenta (id_sesion, enviado_en)
select ('c0000000-0000-0000-0000-0000003202' || lpad(n::text, 2, '0'))::uuid, timestamptz '2020-05-01 12:00-05' + interval '1 day'
from generate_series(21, 25) n;
select is(
  privado.anotar_envio_de_cuenta('c0000000-0000-0000-0000-000000320226', timestamptz '2020-05-01 12:00-05'),
  'ok', 'El pedido 20 de la hora pasa: ni el de G - 60 min exactos ni los cinco de un día después cuentan');
select is(
  privado.anotar_envio_de_cuenta('c0000000-0000-0000-0000-000000320227', timestamptz '2020-05-01 12:00-05'),
  'tope_global', 'Criterio 13: el pedido 21 de la hora no pasa, aunque su sesión no haya pedido nada antes');
select is(
  (select count(*)::int from privado.envio_de_cuenta where id_sesion = 'c0000000-0000-0000-0000-000000320227'),
  0, 'Y el intento frenado por el total no deja fila');
select is(
  privado.anotar_envio_de_cuenta('c0000000-0000-0000-0000-000000320227', timestamptz '2020-05-01 12:00-05' + interval '59 minutes 59 seconds'),
  'tope_global', 'Casi una hora después, los 20 todavía cuentan');
select is(
  privado.anotar_envio_de_cuenta('c0000000-0000-0000-0000-000000320227', timestamptz '2020-05-01 13:00-05'),
  'ok', 'A la hora justa los 20 de G ya no cuentan y la sesión nueva pasa');

-- La purga, con Q = 1 de febrero de 2020, 12:00 en Bogotá (antes que todo lo anterior: no toca esos pedidos).
select is(
  privado.anotar_envio_de_cuenta('c0000000-0000-0000-0000-000000320301', timestamptz '2020-02-01 12:00-05'),
  'ok', 'Un pedido de la sesión 01 de la purga en Q');
select is(
  privado.anotar_envio_de_cuenta('c0000000-0000-0000-0000-000000320302', timestamptz '2020-02-01 12:00-05'),
  'ok', 'Otro de la 02, en Q');
select is(
  privado.anotar_envio_de_cuenta('c0000000-0000-0000-0000-000000320303', timestamptz '2020-02-01 12:00-05' + interval '1 microsecond'),
  'ok', 'Y uno de la 03 un microsegundo después de Q');
select is(
  privado.purgar_envios_de_cuenta(timestamptz '2020-02-01 13:00-05'), 2,
  'La purga de las 13:00 borra los 2 pedidos de Q, justo en ahora - 60 min');
select results_eq(
  $$select right(id_sesion::text, 2), enviado_en from privado.envio_de_cuenta
    where id_sesion::text like 'c0000000-0000-0000-0000-0000003203%' order by 1$$,
  $$values ('03'::text, timestamptz '2020-02-01 12:00-05' + interval '1 microsecond')$$,
  'Y deja lo que todavía cuenta');
select is(privado.purgar_envios_de_cuenta(timestamptz '2020-02-01 13:00-05'), 0, 'Correrla otra vez no borra nada');

-- La puerta del servidor, con la hora de la base.
set local role service_role;
select is(
  public.anotar_envio_de_cuenta('c0000000-0000-0000-0000-000000320304'), 'ok',
  'El servidor (service_role) anota por la puerta');
reset role;
select results_eq(
  $$select enviado_en from privado.envio_de_cuenta where id_sesion = 'c0000000-0000-0000-0000-000000320304'$$,
  $$values (now())$$,
  'Con la hora de la base');
delete from auth.users where id = 'c0000000-0000-0000-0000-000000320304';
select is(
  (select count(*)::int from privado.envio_de_cuenta where id_sesion = 'c0000000-0000-0000-0000-000000320304'),
  0, 'Si la sesión se borra, sus pedidos se van con ella');

-- Sin p_ahora (el servidor) no hay techo: now() es el inicio de la transacción, no el momento en que gana el candado, así que
-- quien esperó debe ver las filas de quien lo ganó aunque su transacción haya empezado un instante después. Un pedido «del
-- futuro» cuenta, por la puerta que usa el servidor. (Con un techo en ahora, 6 pedidos a la vez de una sesión dejaban 4 filas.)
insert into privado.envio_de_cuenta (id_sesion, enviado_en)
select 'c0000000-0000-0000-0000-000000320305', now() + interval '1 second' from generate_series(1, 3);
set local role service_role;
select is(
  public.anotar_envio_de_cuenta('c0000000-0000-0000-0000-000000320305'), 'tope_de_sesion',
  'Por la puerta del servidor, tres pedidos de la sesión con la hora un instante después de ahora todavía cuentan');
reset role;
insert into privado.envio_de_cuenta (id_sesion, enviado_en)
select ('c0000000-0000-0000-0000-0000003202' || lpad((21 + n % 10)::text, 2, '0'))::uuid, now() + interval '1 second'
from generate_series(1, 20) n;
set local role service_role;
select is(
  public.anotar_envio_de_cuenta('c0000000-0000-0000-0000-000000320306'), 'tope_global',
  'Y 20 pedidos de otras sesiones un instante después de ahora también: el techo no se pasa');
reset role;
select is(
  (select count(*)::int from privado.envio_de_cuenta where id_sesion = 'c0000000-0000-0000-0000-000000320306'),
  0, 'Sin dejar fila del intento frenado');

select * from finish();
rollback;
