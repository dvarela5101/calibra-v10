-- Almacenamiento privado de comprobantes de pago. HU-007.
--
-- El comprobante es la captura o el PDF de la transferencia por Llave (RN-40, RN-41). Va en el
-- bucket privado `comprobantes` y `pago.comprobante` guarda la ruta del objeto dentro del bucket,
-- sin el nombre del bucket. Convención de la ruta:
--
--   <id del usuario de Auth>/<uuid>.<jpg|png|pdf>
--
-- Quien sube es el pagador con su sesión de Supabase Auth (la sesión anónima de un Lead o de un
-- integrante de grupal también es un usuario de Auth), y su carpeta lleva su id.
--
--   * Sube: solo dentro de su carpeta y solo con esa forma de nombre.
--   * Lee: el dueño de la carpeta y los admins. Nadie más, aunque conozca la ruta.
--   * No hay política de UPDATE ni de DELETE: un comprobante es evidencia y no se pisa ni se
--     borra desde la app. La limpieza de huérfanos, cuando exista, la hace el servidor
--     (service_role se salta las políticas).
--   * El tamaño y los tipos los hace cumplir el propio Storage (413 y 415), no la app: por eso
--     el bucket los declara. src/lib/comprobantes/reglas.ts repite los mismos valores para dar
--     mensajes claros antes de subir, y integracion/comprobantes.test.ts comprueba que coincidan.
--
-- SUPUESTO A VALIDAR (nota técnica de HU-007): límite de 5 MB por archivo.
--
-- No se tocan los permisos de storage.objects: los administra el servicio de Storage y ninguna
-- política abre nada al rol anon. Lo que cada quien ve lo deciden solo las políticas de abajo.
-- Idempotente: se puede volver a aplicar.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'comprobantes',
  'comprobantes',
  false,
  5242880, -- 5 MiB
  array['image/jpeg', 'image/png', 'application/pdf']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Sube: solo a su carpeta, con nombre <uuid>.<jpg|png|pdf>.
drop policy if exists "comprobantes: sube en su carpeta" on storage.objects;
create policy "comprobantes: sube en su carpeta" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'comprobantes'
    and name ~ (
      '^' || (select auth.uid())::text
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|pdf)$'
    )
  );

-- Lee: el dueño de la carpeta y los admins (una sola política de lectura para el bucket).
drop policy if exists "comprobantes: lee el dueno o un admin" on storage.objects;
create policy "comprobantes: lee el dueno o un admin" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'comprobantes'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (select privado.es_admin())
    )
  );
