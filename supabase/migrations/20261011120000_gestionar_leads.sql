-- Gestionar leads desde la plataforma. HU-053.
--
-- RN-09 (supuesto): estados nuevo, contactado y descartado, sin transiciones automáticas. D-61 (10-oct-2026):
--   a) la materia de un Lead se deduce de sus diagnósticos y monitorías, en cualquier estado;
--   c) un descartado nunca sale en la descarga;
--   d) libre entre nuevo y contactado; descartado es definitivo desde la pantalla;
--   f) quien pide no recibir más mensajes se registra con otro botón (HU-089), no descartándolo.
--
-- Diseño (notas técnicas de HU-053):
--   * Quién cambió el estado y cuándo vive en public.lead_gestion y no en lead: authenticated lee la tabla lead
--     completa (su dueño, por la Data API) y vería qué admin lo tocó.
--   * El admin solo puede cambiar lead.estado (permiso de columna) y nunca el de un descartado (la política). Lo que
--     anota lead_gestion lo pone un trigger con auth.uid() y now(): ni la app ni la Data API lo mandan.
--   * Dos vistas con security_invoker, filtradas para admin: lead_para_gestion (la lista) y lead_para_contactar (la
--     descarga: solo acepta_contacto y no descartados). La descarga lee solo la segunda, así que la regla no depende
--     de la ruta.
-- No redefine ninguna función existente.
-- Idempotente.

-- ---------------------------------------------------------------------------
-- Quién marcó cada Lead y cuándo
-- ---------------------------------------------------------------------------
-- Una fila por Lead que un admin ya marcó; sin fila, nadie lo ha gestionado. id_admin queda nulo si el cambio lo hizo
-- el servidor (llave secreta) o si el admin se borra.
create table if not exists public.lead_gestion (
  id_lead uuid primary key references public.lead (id) on delete cascade,
  id_admin uuid references public.admin (id) on delete set null,
  estado_cambiado_en timestamptz not null
);
create index if not exists lead_gestion_id_admin_idx on public.lead_gestion (id_admin);

comment on table public.lead_gestion is
  'Quién cambió por última vez el estado comercial de cada Lead y cuándo (RN-09). La escribe solo el trigger de lead; la leen solo los admins: el dueño del Lead no ve quién lo marcó. HU-053.';

alter table public.lead_gestion enable row level security;
revoke all on table public.lead_gestion from public, anon, authenticated, service_role;
grant select on table public.lead_gestion to authenticated;
grant select, insert, update, delete on table public.lead_gestion to service_role;

drop policy if exists "admin lee" on public.lead_gestion;
create policy "admin lee" on public.lead_gestion
  for select to authenticated
  using ((select privado.es_admin()));

-- ---------------------------------------------------------------------------
-- El admin cambia el estado (D-61 d)
-- ---------------------------------------------------------------------------
-- Solo la columna estado. Las demás (nombre, correo, teléfono, origen, consentimiento, acepta_contacto) siguen sin
-- poder escribirse con una sesión: el servidor usa la llave secreta.
grant update (estado) on table public.lead to authenticated;

-- Un descartado no se toca: un update sobre él no ve la fila y no cambia nada (descartado es definitivo).
drop policy if exists "admin cambia el estado" on public.lead;
create policy "admin cambia el estado" on public.lead
  for update to authenticated
  using ((select privado.es_admin()) and estado <> 'descartado')
  with check ((select privado.es_admin()));

-- Anota quién y cuándo. Corre como definer porque nadie con sesión escribe en lead_gestion. No toca la fila de lead,
-- así que no cambia lo que comprueba el with check. Solo con un cambio real (la condición del trigger).
create or replace function privado.anotar_gestion_de_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.lead_gestion (id_lead, id_admin, estado_cambiado_en)
  values (
    new.id,
    (select a.id from public.admin a where a.id = (select auth.uid())),
    now()
  )
  on conflict (id_lead) do update
    set id_admin = excluded.id_admin,
        estado_cambiado_en = excluded.estado_cambiado_en;
  return new;
end;
$$;
revoke all on function privado.anotar_gestion_de_lead() from public, anon, authenticated, service_role;

drop trigger if exists lead_anotar_gestion on public.lead;
create trigger lead_anotar_gestion
  after update of estado on public.lead
  for each row
  when (old.estado is distinct from new.estado)
  execute function privado.anotar_gestion_de_lead();

-- ---------------------------------------------------------------------------
-- La lista del admin (D-61 a)
-- ---------------------------------------------------------------------------
-- ids_materia: las materias de sus diagnósticos y de sus monitorías, sin repetidos y en cualquier estado. Los nombres
-- los pone la app desde materia, que es de lectura pública.
create or replace view public.lead_para_gestion
with (security_invoker = true)
as
select
  l.id,
  l.nombre,
  l.correo,
  l.numero_telefono,
  l.estado,
  l.origen,
  l.acepta_contacto,
  l.fecha_creacion,
  g.estado_cambiado_en,
  g.id_admin as id_admin_estado,
  coalesce(
    array(
      select distinct x.id_materia
      from (
        select d.id_materia from public.diagnostico d where d.id_lead = l.id
        union
        select m.id_materia from public.monitoria m where m.id_lead = l.id
      ) x
      where x.id_materia is not null
      order by x.id_materia
    ),
    '{}'::uuid[]
  ) as ids_materia
from public.lead l
left join public.lead_gestion g on g.id_lead = l.id
where (select privado.es_admin());

comment on view public.lead_para_gestion is
  'Los Leads para la gestión del admin, con quién marcó su estado y las materias de sus diagnósticos y monitorías (D-61 a). Cero filas para quien no es admin activo. HU-053.';

-- La descarga (D-61 c): solo quienes aceptaron contacto y no están descartados.
create or replace view public.lead_para_contactar
with (security_invoker = true)
as
select g.*
from public.lead_para_gestion g
where g.acepta_contacto
  and g.estado <> 'descartado';

comment on view public.lead_para_contactar is
  'Los Leads que entran en la descarga para contactar: aceptaron novedades (acepta_contacto) y no están descartados (D-61 c). Cero filas para quien no es admin activo. HU-053.';

revoke all on table public.lead_para_gestion from public, anon, authenticated, service_role;
grant select on table public.lead_para_gestion to authenticated, service_role;
revoke all on table public.lead_para_contactar from public, anon, authenticated, service_role;
grant select on table public.lead_para_contactar to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Los orígenes del filtro
-- ---------------------------------------------------------------------------
-- Las campañas distintas con las que llegaron los Leads, en orden. Vacío para quien no es admin activo.
create or replace function public.origenes_de_leads()
returns setof text
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct l.origen
  from public.lead l
  where l.origen is not null
    and (select privado.es_admin())
  order by l.origen;
$$;

revoke all on function public.origenes_de_leads() from public, anon, authenticated, service_role;
grant execute on function public.origenes_de_leads() to authenticated, service_role;
