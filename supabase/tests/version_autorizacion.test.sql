-- Pruebas pgTAP de la versión de la autorización de datos (HU-087, D-54 c, D-67).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.
--
-- Elenco (ids terminados en 87NN): sesiones anónimas 01 (Lead con el texto nuevo), 02 (Lead sin pasar la versión),
-- 03 (Lead insertado directo, como uno de antes del cambio) y 04 (versión inválida).

begin;
create extension if not exists pgtap with schema extensions;

select plan(19);

-- ---------------------------------------------------------------------------
-- Estructura
-- ---------------------------------------------------------------------------
select has_column('public', 'lead', 'version_autorizacion', 'El Lead guarda con qué versión del texto autorizó');
select col_not_null('public', 'lead', 'version_autorizacion', 'Siempre hay una versión');
select col_default_is('public', 'lead', 'version_autorizacion', 'v1',
  'Un Lead de antes del cambio queda con la versión anterior (v1)');
select has_function('public', 'registrar_lead',
  array['uuid', 'text', 'text', 'text', 'boolean', 'timestamp with time zone', 'text', 'text'],
  'registrar_lead recibe la versión');
select hasnt_function('public', 'registrar_lead',
  array['uuid', 'text', 'text', 'text', 'boolean', 'timestamp with time zone', 'text'],
  'Ya no existe la registrar_lead de 7 parámetros: no quedan dos versiones que se confundan');
select has_function('privado', 'autorizo_respuestas', array['uuid'], 'Existe privado.autorizo_respuestas');
select hasnt_column('public', 'solicitud_monitor', 'version_autorizacion',
  'La solicitud de monitor no cambia: su autorización es otra (HU-062)');

select ok(
  not has_function_privilege('anon', 'public.registrar_lead(uuid, text, text, text, boolean, timestamptz, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.registrar_lead(uuid, text, text, text, boolean, timestamptz, text, text)', 'execute')
  and has_function_privilege('service_role', 'public.registrar_lead(uuid, text, text, text, boolean, timestamptz, text, text)', 'execute'),
  'Solo el servidor registra Leads, como antes');
select ok(
  not has_function_privilege('anon', 'privado.autorizo_respuestas(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'privado.autorizo_respuestas(uuid)', 'execute')
  and not has_function_privilege('service_role', 'privado.autorizo_respuestas(uuid)', 'execute'),
  'autorizo_respuestas no se expone: solo la llaman otras funciones de privado (HU-022)');

-- ---------------------------------------------------------------------------
-- Guardar la versión
-- ---------------------------------------------------------------------------
insert into auth.users (id, is_anonymous)
select ('c0000000-0000-0000-0000-0000000087' || n)::uuid, true
from unnest(array['01', '02', '03', '04']) n;

-- registrar_lead va en su propia sentencia: una consulta que la llama no ve la fila que inserta.
select lives_ok(
  $$select public.registrar_lead('c0000000-0000-0000-0000-000000008701', 'Ana 87', 'ana87@calibra.test', '', false, now(), '', 'v2')$$,
  'Se registra un Lead con el texto nuevo');
select is(
  (select version_autorizacion from public.lead where correo = 'ana87@calibra.test'),
  'v2',
  'Con el texto nuevo, el Lead queda en v2');
select lives_ok(
  $$select public.registrar_lead('c0000000-0000-0000-0000-000000008702', 'Beto 87', 'beto87@calibra.test', '', false, now(), '')$$,
  'Se registra un Lead sin pasar la versión');
select is(
  (select version_autorizacion from public.lead where correo = 'beto87@calibra.test'),
  'v1',
  'Sin pasar la versión queda en v1: el lado seguro (el monitor no ve las respuestas)');

insert into public.lead (id, id_sesion_anonima, nombre, correo, acepta_tratamiento_datos, fecha_consentimiento) values
  ('40000000-0000-0000-0000-000000008703', 'c0000000-0000-0000-0000-000000008703', 'Caro 87',
   'caro87@calibra.test', true, '2026-10-01 12:00:00+00');
select is(
  (select version_autorizacion from public.lead where id = '40000000-0000-0000-0000-000000008703'),
  'v1',
  'Un Lead creado sin versión (como los de antes del cambio) queda en v1');

select throws_ok(
  $$select public.registrar_lead('c0000000-0000-0000-0000-000000008704', 'Dani 87', 'dani87@calibra.test', '', false, now(), '', 'v9')$$,
  '23514', null,
  'Una versión que no existe se rechaza');

-- ---------------------------------------------------------------------------
-- ¿Autorizó las respuestas? (D-67)
-- ---------------------------------------------------------------------------
select is(
  privado.autorizo_respuestas((select id from public.lead where correo = 'ana87@calibra.test')),
  true,
  'Con v2 el monitor puede ver las respuestas');
select is(
  privado.autorizo_respuestas((select id from public.lead where correo = 'beto87@calibra.test')),
  false,
  'Con v1 no: ve el resultado y no las respuestas (D-67)');
select is(
  privado.autorizo_respuestas('40000000-0000-0000-0000-0000000087ff'),
  false,
  'Un Lead que no existe da false');

-- El predicado sigue a la columna: un Lead que pasa a v2 (editar el contacto, que prueba integracion/leads.test.ts)
-- ya autoriza las respuestas.
update public.lead set version_autorizacion = 'v2' where id = '40000000-0000-0000-0000-000000008703';
select is(
  privado.autorizo_respuestas('40000000-0000-0000-0000-000000008703'),
  true,
  'Con la versión cambiada a v2, el predicado da true');

select * from finish();
rollback;
