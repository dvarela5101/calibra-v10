-- Solicitud de certificación del aspirante a monitor. HU-062.
--
-- P-19: quien quiere ser monitor deja su nombre, teléfono, correo y las materias en las que quiere
-- certificarse, para que un admin lo contacte y haga la evaluación presencial. Después el admin lo invita
-- (HU-013) y lo certifica (HU-014); nada de eso ocurre aquí.
--
--   * La solicitud la crea el servidor con la llave secreta, llamando a crear_solicitud_monitor(), que en
--     una sola transacción guarda la solicitud y sus materias: si algo no sirve, no queda nada. Ninguna
--     sesión inserta directo.
--   * El formulario es público y no pide sesión, así que la función frena el abuso: una persona con una
--     solicitud abierta (nueva o contactada) con el mismo correo o teléfono no crea otra (se devuelve la
--     que ya tiene), y entre todos no se crean más de 30 solicitudes por hora.
--   * Solo los admins la leen y le cambian el estado (contactada, evaluada o descartada). Nadie más lee
--     ninguna, ni la persona que la envió. Una solicitud nueva o contactada está abierta (columna
--     `abierta`): el admin aún tiene algo que hacer con ella. La lista del admin va de la más antigua a la
--     más nueva y abre en la página de la abierta más antigua.
--   * La autorización de datos (RN-13, Ley 1581) es obligatoria y se guarda con su fecha. La retención
--     sigue P-13 (hasta que retire la autorización o tras 24 meses sin actividad); borrarlas cuando toque
--     va con el proceso de retención, no aquí.
-- Idempotente.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'estado_solicitud_monitor' and typnamespace = 'public'::regnamespace) then
    create type public.estado_solicitud_monitor as enum ('nueva', 'contactada', 'evaluada', 'descartada');
  end if;
end $$;

create table if not exists public.solicitud_monitor (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  correo text not null,
  numero_telefono text not null,
  estado public.estado_solicitud_monitor not null default 'nueva',
  acepta_tratamiento_datos boolean not null,
  fecha_consentimiento timestamptz not null,
  creada_en timestamptz not null default now(),
  actualizada_en timestamptz not null default now(),
  id_admin_actualizo uuid references public.admin (id) on delete set null,
  -- Abierta mientras el admin tenga algo que hacer con ella.
  abierta boolean generated always as (estado in ('nueva', 'contactada')) stored,
  constraint solicitud_monitor_nombre check (nombre = btrim(nombre) and char_length(nombre) between 1 and 120),
  -- El correo llega normalizado (minúsculas, sin espacios) desde el servidor. Solo letras, dígitos y
  -- . _ % + ' - antes de la arroba, y un dominio de letras, dígitos, guiones y puntos: nada como ?, & o =
  -- que, en el enlace mailto: del panel del admin, se lea como parámetros (copia oculta, cuerpo).
  constraint solicitud_monitor_correo check (
    correo ~ '^[a-z0-9._%+''-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$' and char_length(correo) <= 254
  ),
  -- Con indicativo, como lo deja normalizarTelefono(): + y de 8 a 15 cifras (E.164).
  constraint solicitud_monitor_telefono check (numero_telefono ~ '^\+[0-9]{8,15}$'),
  constraint solicitud_monitor_autoriza_datos check (acepta_tratamiento_datos)
);
comment on table public.solicitud_monitor is
  'Solicitud de certificación de un aspirante a monitor (P-19). La crea el servidor; la leen y gestionan los admins. HU-062.';
-- El orden de la lista del admin (y el tope por hora), y la abierta más antigua, que marca dónde abre.
create index if not exists solicitud_monitor_orden_idx on public.solicitud_monitor (creada_en, id);
create index if not exists solicitud_monitor_abiertas_idx on public.solicitud_monitor (creada_en, id) where abierta;
create index if not exists solicitud_monitor_correo_idx on public.solicitud_monitor (correo);
create index if not exists solicitud_monitor_numero_telefono_idx on public.solicitud_monitor (numero_telefono);
create index if not exists solicitud_monitor_id_admin_actualizo_idx on public.solicitud_monitor (id_admin_actualizo);

create table if not exists public.solicitud_monitor_materia (
  id_solicitud uuid not null references public.solicitud_monitor (id) on delete cascade,
  id_materia uuid not null references public.materia (id),
  primary key (id_solicitud, id_materia)
);
comment on table public.solicitud_monitor_materia is
  'Materias en las que el aspirante quiere certificarse. HU-062.';
create index if not exists solicitud_monitor_materia_id_materia_idx on public.solicitud_monitor_materia (id_materia);

-- ---------------------------------------------------------------------------
-- Quién lee y quién cambia
-- ---------------------------------------------------------------------------
alter table public.solicitud_monitor enable row level security;
alter table public.solicitud_monitor_materia enable row level security;

revoke all on table public.solicitud_monitor from public, anon, authenticated, service_role;
revoke all on table public.solicitud_monitor_materia from public, anon, authenticated, service_role;
grant select on table public.solicitud_monitor to authenticated;
grant select on table public.solicitud_monitor_materia to authenticated;
-- El admin solo cambia el estado y deja su id; la fecha la pone el trigger.
grant update (estado, id_admin_actualizo) on table public.solicitud_monitor to authenticated;
grant select, insert, update, delete on table public.solicitud_monitor to service_role;
grant select, insert, update, delete on table public.solicitud_monitor_materia to service_role;

drop policy if exists "admin lee" on public.solicitud_monitor;
create policy "admin lee" on public.solicitud_monitor
  for select to authenticated
  using ((select privado.es_admin()));

-- Marca contactada, evaluada o descartada, a su nombre. Volver a "nueva" no tiene sentido: ya la atendió.
drop policy if exists "admin cambia el estado" on public.solicitud_monitor;
create policy "admin cambia el estado" on public.solicitud_monitor
  for update to authenticated
  using ((select privado.es_admin()))
  with check (
    (select privado.es_admin())
    and estado <> 'nueva'
    and id_admin_actualizo = (select auth.uid())
  );

drop policy if exists "admin lee" on public.solicitud_monitor_materia;
create policy "admin lee" on public.solicitud_monitor_materia
  for select to authenticated
  using ((select privado.es_admin()));

-- La fecha del último cambio la pone la base, no quien actualiza.
create or replace function privado.tocar_solicitud_monitor()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.actualizada_en := now();
  return new;
end;
$$;
revoke all on function privado.tocar_solicitud_monitor() from public, anon, authenticated, service_role;

drop trigger if exists solicitud_monitor_tocar on public.solicitud_monitor;
create trigger solicitud_monitor_tocar
  before update on public.solicitud_monitor
  for each row
  execute function privado.tocar_solicitud_monitor();

-- ---------------------------------------------------------------------------
-- Crear una solicitud (solo el servidor)
-- ---------------------------------------------------------------------------
-- Guarda la solicitud y sus materias en una sola transacción. Las materias repetidas cuentan una vez.
-- Sin materias, con más de 20 o con una que no existe, lanza y no guarda nada. Si la persona ya tiene una
-- solicitud abierta (nueva o contactada) con el mismo correo o teléfono, devuelve esa y no crea otra. Con
-- 30 solicitudes creadas en la última hora, lanza 54000 y no guarda nada. Los candados se toman siempre en
-- el mismo orden (correo, teléfono, tope), así que no se bloquean entre sí. Corre con los permisos de quien
-- llama (security invoker) y solo la puede llamar service_role.
create or replace function public.crear_solicitud_monitor(
  p_nombre text,
  p_correo text,
  p_numero_telefono text,
  p_materias uuid[],
  p_fecha_consentimiento timestamptz
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_materias uuid[];
  v_id uuid;
begin
  -- Dos envíos a la vez de la misma persona se atienden uno detrás del otro, para no duplicarla.
  perform pg_advisory_xact_lock(hashtextextended('solicitud_monitor:' || coalesce(p_correo, ''), 0));
  perform pg_advisory_xact_lock(hashtextextended('solicitud_monitor:' || coalesce(p_numero_telefono, ''), 0));

  select coalesce(array_agg(distinct m), '{}') into v_materias from unnest(p_materias) as m where m is not null;
  if cardinality(v_materias) = 0 then
    raise exception 'Elige al menos una materia.' using errcode = 'check_violation';
  end if;
  if cardinality(v_materias) > 20 then
    raise exception 'Elige como máximo 20 materias.' using errcode = 'check_violation';
  end if;

  select s.id into v_id
  from public.solicitud_monitor s
  where (s.correo = p_correo or s.numero_telefono = p_numero_telefono)
    and s.abierta
  order by s.creada_en
  limit 1;
  if v_id is not null then
    return v_id;
  end if;

  -- El tope es de todos: las creaciones van de a una, para que dos envíos a la vez no lo pasen.
  perform pg_advisory_xact_lock(hashtextextended('solicitud_monitor:tope', 0));
  if (select count(*) from public.solicitud_monitor s where s.creada_en > now() - interval '1 hour') >= 30 then
    raise exception 'Recibimos muchas solicitudes en la última hora.' using errcode = 'program_limit_exceeded';
  end if;

  insert into public.solicitud_monitor (nombre, correo, numero_telefono, acepta_tratamiento_datos, fecha_consentimiento)
  values (p_nombre, p_correo, p_numero_telefono, true, p_fecha_consentimiento)
  returning id into v_id;

  -- Una materia que no existe hace fallar la llave foránea y, con ella, toda la solicitud.
  insert into public.solicitud_monitor_materia (id_solicitud, id_materia)
  select v_id, m from unnest(v_materias) as m;

  return v_id;
end;
$$;

revoke all on function public.crear_solicitud_monitor(text, text, text, uuid[], timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.crear_solicitud_monitor(text, text, text, uuid[], timestamptz) to service_role;
