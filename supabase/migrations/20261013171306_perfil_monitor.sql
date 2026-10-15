-- HU-049 (D-58 a y b): el monitor llena su perfil (carrera, semestre y presentación, los tres opcionales) y la
-- tarjeta de /monitores lo muestra. Idempotente: `npm run db:verificar` reaplica todas las migraciones.
--
-- La fila ya existe: la crea `registrar_monitor` (HU-013). Aquí solo se actualiza, con la sesión del monitor y
-- un grant por columna, como la llave (20260929233720_invitacion_monitor.sql). HU-092 cambiará la escritura por
-- la función `guardar_perfil_monitor`, que guarda además los temas.

alter table public.perfil_monitor add column if not exists carrera text;
alter table public.perfil_monitor add column if not exists semestre smallint;
alter table public.perfil_monitor add column if not exists presentacion text;

comment on table public.perfil_monitor is
  'Perfil 1:1 del monitor (RN-08): carrera, semestre y presentación, opcionales (D-58 a). Lo ven todos si el monitor tiene un certificado y la cuenta activa.';

-- Reglas del texto, las mismas de src/lib/monitores/perfil.ts (que da el mensaje). Los largos se cuentan en
-- caracteres sobre btrim(...), para que un campo de solo espacios tampoco entre por la Data API.
-- D-58 b: sin teléfonos (7 o más dígitos seguidos, aunque lleven espacios, puntos o guiones), sin arrobas y sin
-- enlaces. «2022-2023» cuenta como teléfono: el monitor lo escribe «de 2022 a 2023».
-- La regla va escrita en cada CHECK y no en una función: una función en un CHECK pide permiso de ejecución a quien
-- escribe.

alter table public.perfil_monitor drop constraint if exists perfil_monitor_carrera_valida;
alter table public.perfil_monitor
  add constraint perfil_monitor_carrera_valida check (
    char_length(btrim(carrera)) between 1 and 80
    and carrera !~ '[[:cntrl:]]'
    and carrera !~ '[0-9]([ .-]*[0-9]){6,}'
    and strpos(carrera, '@') = 0
    and carrera !~* '(://|www\.)'
  );

alter table public.perfil_monitor drop constraint if exists perfil_monitor_semestre_valido;
alter table public.perfil_monitor
  add constraint perfil_monitor_semestre_valido check (semestre between 1 and 12);

-- La presentación admite saltos de línea (un párrafo por línea) y ningún otro carácter de control.
alter table public.perfil_monitor drop constraint if exists perfil_monitor_presentacion_valida;
alter table public.perfil_monitor
  add constraint perfil_monitor_presentacion_valida check (
    -- btrim con el salto de línea: una presentación de solo espacios y saltos tampoco entra.
    char_length(btrim(presentacion, E' \n')) between 1 and 500
    and translate(presentacion, E'\n', '') !~ '[[:cntrl:]]'
    and presentacion !~ '[0-9]([ .-]*[0-9]){6,}'
    and strpos(presentacion, '@') = 0
    and presentacion !~* '(://|www\.)'
  );

-- Escritura: el monitor cambia los tres campos de su fila. Sin insert ni delete: la fila la crea registrar_monitor
-- y se borra con el monitor (on delete cascade).
grant update (carrera, semestre, presentacion) on table public.perfil_monitor to authenticated;
drop policy if exists "dueno cambia su perfil" on public.perfil_monitor;
create policy "dueno cambia su perfil" on public.perfil_monitor
  for update to authenticated
  using (id_monitor = (select auth.uid()))
  with check (id_monitor = (select auth.uid()));

-- ¿La cuenta del monitor está activa? Lee auth.users, que nadie más lee: security definer, como privado.es_admin().
-- Una cuenta suspendida en Auth (banned_until en el futuro) está desactivada, como en privado.fecha_libre.
create or replace function privado.cuenta_activa(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from auth.users u where u.id = p_id and u.banned_until > now());
$$;

revoke all on function privado.cuenta_activa(uuid) from public;
grant execute on function privado.cuenta_activa(uuid) to anon, authenticated;

-- Lectura: el dueño y los admins siempre; los demás (también los visitantes), solo si el monitor tiene al menos un
-- certificado y la cuenta activa. Reemplaza la «lectura publica» de 20260929022942_politicas_v10.sql.
drop policy if exists "lectura publica" on public.perfil_monitor;
drop policy if exists "lectura del perfil" on public.perfil_monitor;
create policy "lectura del perfil" on public.perfil_monitor
  for select to anon, authenticated
  using (
    id_monitor = (select auth.uid())
    or (select privado.es_admin())
    or (
      exists (select 1 from public.certificado c where c.id_monitor = perfil_monitor.id_monitor)
      and privado.cuenta_activa(id_monitor)
    )
  );
