-- Ajustes de la revisión de HU-007. HU-063.
--
-- La migración de HU-007 (`*_comprobantes_privados.sql`) ya está en `main` y no se edita: esta la
-- corrige encima.
--
--   * N-3: el límite por comprobante sube de 5 MiB a 10 MiB. El enlace firmado sigue en 60 s (eso
--     vive en `src/lib/comprobantes/reglas.ts`, no en la base). El Storage sigue haciendo cumplir
--     el tamaño (413), `reglas.ts` repite el mismo valor para dar el mensaje antes de subir, y
--     `integracion/comprobantes.test.ts` comprueba que coincidan. El tope global del servicio de
--     Storage (`[storage] file_size_limit` en supabase/config.toml, 50 MiB) queda por encima.
--
-- Los comprobantes ajenos ya no se pueden pisar ni mover: el bucket no tiene política de UPDATE ni
-- de DELETE, y la de INSERT solo deja escribir dentro de la carpeta de quien sube. No hace falta
-- una política nueva; lo que cambia son las pruebas de integración que lo verifican por `move`,
-- `copy` y las URL de subida firmadas con `upsert`.
-- Idempotente: se puede volver a aplicar.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'comprobantes',
  'comprobantes',
  false,
  10485760, -- 10 MiB
  array['image/jpeg', 'image/png', 'application/pdf']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
