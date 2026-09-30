-- Reintentar los correos que fallaron. HU-065.
--
-- `enviarCorreo()` (HU-006) reintenta unos segundos dentro de la misma llamada. Si el proveedor cae
-- más tiempo, la fila de `correo_envio` queda `fallido`. Ahora:
--
--   * `reintentable` dice si la última falla fue temporal (red, 4xx de SMTP, 5xx o límite de ritmo de
--     Resend, proveedor sin configurar) o definitiva (autenticación, remitente, límite diario de Gmail).
--   * Cada 10 minutos, pg_cron llama a `privado.disparar_reintento_correos()`, que hace un POST con
--     pg_net a la ruta de la app `/api/procesos/reintentar-correos`. La app reconstruye cada correo a
--     partir de su entidad (el registro no guarda el cuerpo) y lo reintenta sobre la misma fila y la
--     misma clave. Solo reintenta lo `reintentable` de las últimas 24 horas; lo demás lo ve el admin.
--   * La dirección de la app y el secreto viven en Vault (`calibra_sitio_url` y
--     `calibra_cron_secreto`). Sin ellos, el disparo no hace nada: así en local, donde no hay app
--     escuchando para la base, y en la nube hasta que se configuren en el corte (HU-057).
-- Idempotente.

alter table public.correo_envio add column if not exists reintentable boolean not null default false;
comment on column public.correo_envio.reintentable is
  'La última falla fue temporal: el proceso programado la reintenta dentro de las 24 horas. HU-065.';

-- Lo que busca el proceso: fallidos reintentables recientes.
create index if not exists correo_envio_reintentables_idx on public.correo_envio (creado_en)
  where estado = 'fallido' and reintentable;

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- Dispara el reintento en la app. security definer: lee Vault y usa pg_net, que no son de nadie más.
-- Devuelve el id de la petición de pg_net, o null si falta la configuración.
create or replace function privado.disparar_reintento_correos()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sitio text;
  v_secreto text;
begin
  select decrypted_secret into v_sitio from vault.decrypted_secrets where name = 'calibra_sitio_url';
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'calibra_cron_secreto';
  if coalesce(btrim(v_sitio), '') = '' or coalesce(btrim(v_secreto), '') = '' then
    return null;
  end if;

  return net.http_post(
    url := rtrim(btrim(v_sitio), '/') || '/api/procesos/reintentar-correos',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Authorization', 'Bearer ' || btrim(v_secreto), 'Content-Type', 'application/json'),
    timeout_milliseconds := 60000
  );
end;
$$;

revoke all on function privado.disparar_reintento_correos() from public, anon, authenticated, service_role;

-- cron.schedule con el mismo nombre reemplaza el trabajo: reaplicar la migración no lo duplica.
select cron.schedule('calibra-reintentar-correos', '*/10 * * * *', 'select privado.disparar_reintento_correos()');
