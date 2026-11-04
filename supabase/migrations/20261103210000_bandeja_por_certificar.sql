-- HU-124 (D-90): la bandeja del admin avisa de los monitores que crearon su cuenta y aún no tienen certificado.
-- `monitor` no guardaba cuándo se registró cada uno, y sin esa fecha no hay orden por antigüedad. Va en `monitor_privado`
-- porque `monitor` lo lee cualquiera. El dueño no la puede cambiar: su `update` es solo sobre `llave` (HU-013).
-- Idempotente.

alter table public.monitor_privado add column if not exists registrado_en timestamptz;

-- Los que ya existen: la fecha de su cuenta en Auth (la fila de monitor se crea justo después, HU-013).
update public.monitor_privado mp
set registrado_en = u.created_at
from auth.users u
where u.id = mp.id_monitor
  and mp.registrado_en is null
  and u.created_at is not null;

-- Por si una cuenta vieja no tiene fecha en Auth: mejor una fecha de hoy que dejarla por fuera de la lista.
update public.monitor_privado set registrado_en = now() where registrado_en is null;

alter table public.monitor_privado alter column registrado_en set default now();
alter table public.monitor_privado alter column registrado_en set not null;

comment on column public.monitor_privado.registrado_en is
  'Cuándo creó su cuenta (HU-124). La bandeja del admin ordena por esta fecha a los monitores por certificar.';

-- Con los permisos de quien consulta (como desembolsos_ejecutables): un admin activo ve a todos, un monitor solo su propia
-- fila y cualquier otro rol nada, porque manda la política de monitor_privado.
create or replace view public.monitores_por_certificar
with (security_invoker = true) as
select
  m.id,
  m.nombre,
  mp.correo,
  mp.numero_telefono,
  mp.registrado_en
from public.monitor m
join public.monitor_privado mp on mp.id_monitor = m.id
where not exists (select 1 from public.certificado c where c.id_monitor = m.id);

comment on view public.monitores_por_certificar is
  'Monitores con cuenta y sin ningún certificado (HU-124, D-90): salen de la lista con su primer certificado.';

revoke all on table public.monitores_por_certificar from public, anon, authenticated, service_role;
grant select on table public.monitores_por_certificar to authenticated, service_role;
