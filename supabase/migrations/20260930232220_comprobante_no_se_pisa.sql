-- Un comprobante subido no se reemplaza. HU-067.
--
-- HU-063 encontró el hueco: el dueño pide una URL de subida firmada con `upsert` para una ruta suya que
-- todavía no existe, sube un archivo y con el mismo token sube otro que pisa al primero. Las políticas
-- no lo frenan porque la subida con token no corre con la sesión de quien sube: en el Storage local se
-- ve como un INSERT ... ON CONFLICT DO UPDATE hecho por el rol `postgres`, sin usuario. Una subida con
-- `upsert` y la llave secreta hace la misma escritura (el Storage la prueba antes con el rol
-- `service_role`), así que el trigger no puede depender del rol.
--
-- Pisar un archivo es un UPDATE de su fila en `storage.objects` que cambia la versión y los metadatos
-- (eTag, tamaño). Descargar, firmar un enlace, listar o borrar no la actualizan. Este trigger rechaza
-- en el bucket `comprobantes` todo UPDATE que cambie el contenido (versión o eTag) o la ruta (nombre o
-- bucket), venga de quien venga, incluida la llave secreta: el servidor tampoco reemplaza comprobantes.
-- Para cambiar uno, se sube otro (con otra ruta) y el pago apunta al nuevo.
--
-- Borrar sigue igual: la limpieza de huérfanos (HU-059) borra con la API de Storage, que es un DELETE.
-- Idempotente.

create or replace function privado.impedir_pisar_comprobantes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.version is distinct from old.version
     or (new.metadata ->> 'eTag') is distinct from (old.metadata ->> 'eTag')
     or new.name is distinct from old.name
     or new.bucket_id is distinct from old.bucket_id then
    raise exception 'Un comprobante no se puede reemplazar ni mover: sube uno nuevo.'
      using errcode = 'insufficient_privilege', hint = 'comprobante_no_se_pisa';
  end if;
  return new;
end;
$$;

revoke all on function privado.impedir_pisar_comprobantes() from public, anon, authenticated, service_role;

drop trigger if exists comprobantes_no_se_pisan on storage.objects;
create trigger comprobantes_no_se_pisan
  before update on storage.objects
  for each row
  -- También lo que se intente mover desde otro bucket hacia este: entraría sin pasar por la cuota.
  when (old.bucket_id = 'comprobantes' or new.bucket_id = 'comprobantes')
  execute function privado.impedir_pisar_comprobantes();
