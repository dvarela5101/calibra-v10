-- Pruebas pgTAP del reintento programado de correos (HU-065).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos ni secretos.

begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

select has_column('public', 'correo_envio', 'reintentable', 'correo_envio sabe si la falla fue temporal');
select col_default_is('public', 'correo_envio', 'reintentable', 'false', 'Por defecto una falla no se reintenta');

select is(
  (select count(*)::int from cron.job where jobname = 'calibra-reintentar-correos'
     and schedule = '*/10 * * * *' and command = 'select privado.disparar_reintento_correos()'),
  1, 'pg_cron dispara el reintento cada 10 minutos');

select ok(not has_function_privilege('anon', 'privado.disparar_reintento_correos()', 'execute'),
  'anon no puede disparar el reintento');
select ok(not has_function_privilege('authenticated', 'privado.disparar_reintento_correos()', 'execute'),
  'Una sesión no puede disparar el reintento');
select ok(not has_function_privilege('service_role', 'privado.disparar_reintento_correos()', 'execute'),
  'Ni la llave secreta: solo pg_cron (postgres)');
select is((select prosecdef from pg_proc where oid = 'privado.disparar_reintento_correos()'::regprocedure), true,
  'Es security definer (lee Vault y usa pg_net)');
select ok((select proconfig @> array['search_path=""'] from pg_proc where oid = 'privado.disparar_reintento_correos()'::regprocedure),
  'Con search_path vacío');

-- Sin la dirección del sitio ni el secreto en Vault, no hace nada.
select is(privado.disparar_reintento_correos(), null, 'Sin configuración en Vault no dispara nada');

-- Con los dos secretos, encola un POST a la ruta de la app con el secreto en Authorization.
select vault.create_secret('https://calibra.test/', 'calibra_sitio_url');
select vault.create_secret('secreto-de-prueba-con-al-menos-treinta-y-dos-caracteres', 'calibra_cron_secreto');

select isnt(privado.disparar_reintento_correos(), null, 'Con la configuración dispara una petición');
select is(
  (select count(*)::int from net.http_request_queue
    where url = 'https://calibra.test/api/procesos/reintentar-correos'
      and method = 'POST'
      and headers ->> 'Authorization' = 'Bearer secreto-de-prueba-con-al-menos-treinta-y-dos-caracteres'),
  1, 'El POST va a la ruta de reintentos, sin barra doble y con el secreto');

select * from finish();
rollback;
