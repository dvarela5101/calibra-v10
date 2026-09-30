-- Contacto al agendar: el visitante queda como Lead sin haber hecho el diagnóstico. HU-068.
--
-- D-3 (30-sep-2026): el diagnóstico es opcional para agendar. La monitoría exige un Lead
-- (`monitoria.id_lead`), así que el contacto se pide al agendar cuando la sesión todavía no lo es.
-- P-21 y P-22: nombre y correo obligatorios, teléfono opcional. RN-13: sin autorización no hay Lead.
--
-- P-23: un Lead por correo normalizado. Si el correo ya es de otro Lead, no se liga nada todavía: se
-- manda un enlace de verificación a ese correo y la sesión que lo abre y confirma queda ligada al Lead
-- (`lead_sesion`). Se liga la sesión que abre el enlace, no la que lo pidió: así quien escriba un correo
-- ajeno no ve los datos de otra persona aunque esa persona abra el enlace (RN-12).
--
-- Todo lo escribe el servidor con la llave secreta: ninguna sesión escribe estas tablas, y las dos
-- funciones solo las puede llamar service_role.
-- Idempotente.

-- ---------------------------------------------------------------------------
-- Un Lead por correo (P-23)
-- ---------------------------------------------------------------------------
-- El servidor guarda el correo normalizado (minúsculas, sin espacios); la base lo exige y no deja dos
-- Leads con el mismo, tampoco si dos pestañas lo intentan a la vez.
alter table public.lead drop constraint if exists lead_correo_normalizado;
alter table public.lead add constraint lead_correo_normalizado
  check (correo is null or (correo = lower(btrim(correo)) and correo like '%_@_%.%'));
create unique index if not exists lead_correo_key on public.lead (correo) where correo is not null;

-- Una sesión crea un solo Lead: si dos pestañas envían el contacto a la vez, la segunda no crea otro.
create unique index if not exists lead_id_sesion_anonima_key on public.lead (id_sesion_anonima)
  where id_sesion_anonima is not null;

-- ---------------------------------------------------------------------------
-- Otras sesiones del mismo Lead (P-23)
-- ---------------------------------------------------------------------------
-- La sesión que creó el Lead sigue en lead.id_sesion_anonima. Aquí van las que confirmaron el correo
-- desde el enlace de verificación (otro navegador u otro dispositivo). Una sesión es de un solo Lead.
create table if not exists public.lead_sesion (
  id_sesion uuid primary key references auth.users (id) on delete cascade,
  id_lead uuid not null references public.lead (id) on delete cascade,
  ligada_en timestamptz not null default now()
);
comment on table public.lead_sesion is
  'Sesiones que confirmaron el correo de un Lead con el enlace de verificación (P-23). HU-068.';
create index if not exists lead_sesion_id_lead_idx on public.lead_sesion (id_lead);

alter table public.lead_sesion enable row level security;
revoke all on table public.lead_sesion from public, anon, authenticated;
grant select, insert, delete on table public.lead_sesion to service_role;

-- ---------------------------------------------------------------------------
-- Enlace de verificación del correo (P-23)
-- ---------------------------------------------------------------------------
-- Como la invitación de monitor (HU-013): 256 bits aleatorios que viajan solo en el correo; aquí va su
-- SHA-256. Un solo uso y vence a las 24 horas. `siguiente` es la ruta interna a la que vuelve quien
-- confirma (por ejemplo, la fecha que estaba agendando).
create table if not exists public.verificacion_lead (
  id uuid primary key default gen_random_uuid(),
  id_lead uuid not null references public.lead (id) on delete cascade,
  token_hash text not null,
  siguiente text not null default '/',
  creada_en timestamptz not null default now(),
  vence_en timestamptz not null default now() + interval '24 hours',
  usada_en timestamptz,
  constraint verificacion_lead_token_hash_key unique (token_hash),
  constraint verificacion_lead_token_hash_sha256 check (token_hash ~ '^[0-9a-f]{64}$'),
  -- Solo rutas del propio sitio: empiezan por una barra que no va seguida de otra ni de una invertida.
  constraint verificacion_lead_siguiente_interna
    check (char_length(siguiente) <= 500 and (siguiente = '/' or siguiente ~ '^/[^/\\]')),
  constraint verificacion_lead_vence_despues check (vence_en > creada_en)
);
comment on table public.verificacion_lead is
  'Enlace de un solo uso para confirmar el correo de un Lead que ya existe (P-23). Guarda el hash del token. HU-068.';
create index if not exists verificacion_lead_id_lead_idx on public.verificacion_lead (id_lead);

alter table public.verificacion_lead enable row level security;
revoke all on table public.verificacion_lead from public, anon, authenticated;
grant select, insert, update, delete on table public.verificacion_lead to service_role;

-- ---------------------------------------------------------------------------
-- El Lead de una sesión incluye las que confirmaron el correo
-- ---------------------------------------------------------------------------
-- Misma función de HU-002 (políticas de lead, monitoría y diagnóstico), más lead_sesion.
create or replace function privado.es_mi_lead(p_id_lead uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.lead l
    where l.id = p_id_lead
      and (
        l.id_sesion_anonima = (select auth.uid())
        or exists (
          select 1 from public.estudiante e
          where e.id = (select auth.uid()) and e.id_lead = l.id
        )
        or exists (
          select 1 from public.lead_sesion s
          where s.id_sesion = (select auth.uid()) and s.id_lead = l.id
        )
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- Crear el Lead de una sesión (servidor)
-- ---------------------------------------------------------------------------
-- En una sola transacción: crea el Lead de la sesión y le liga los diagnósticos que la sesión hizo antes
-- (P-33). Si el correo ya es de otro Lead (`lead_correo_key`) o la sesión ya tiene uno
-- (`lead_id_sesion_anonima_key`), la restricción única lanza 23505 y no se crea nada: con el correo
-- ajeno, el servidor manda el enlace de verificación. Corre con los permisos de quien llama y solo la
-- llama service_role, después de comprobar la sesión.
create or replace function public.registrar_lead(
  p_id_sesion uuid,
  p_nombre text,
  p_correo text,
  p_numero_telefono text,
  p_acepta_contacto boolean,
  p_fecha_consentimiento timestamptz,
  p_origen text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id_lead uuid;
begin
  insert into public.lead (
    id_sesion_anonima, nombre, correo, numero_telefono,
    acepta_tratamiento_datos, fecha_consentimiento, acepta_contacto, origen
  ) values (
    p_id_sesion, btrim(p_nombre), lower(btrim(p_correo)), nullif(btrim(p_numero_telefono), ''),
    true, p_fecha_consentimiento, p_acepta_contacto, nullif(btrim(p_origen), '')
  )
  returning id into v_id_lead;

  update public.diagnostico d
  set id_lead = v_id_lead
  where d.id_sesion_anonima = p_id_sesion and d.id_lead is null;

  return v_id_lead;
end;
$$;

revoke all on function public.registrar_lead(uuid, text, text, text, boolean, timestamptz, text) from public, anon, authenticated;
grant execute on function public.registrar_lead(uuid, text, text, text, boolean, timestamptz, text) to service_role;

-- ---------------------------------------------------------------------------
-- Confirmar el correo desde el enlace (servidor)
-- ---------------------------------------------------------------------------
-- En una sola transacción: gasta el enlace, liga la sesión que lo abrió al Lead y le pasa los
-- diagnósticos de esa sesión. Devuelve el Lead y a dónde volver, o nada si el enlace ya no sirve (usado,
-- vencido o inexistente) o si esa sesión ya es de otro Lead.
create or replace function public.confirmar_correo_de_lead(p_token_hash text, p_id_sesion uuid)
returns table (id_lead uuid, siguiente text)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_id_lead uuid;
  v_siguiente text;
  v_lead_de_la_sesion uuid;
begin
  select l.id into v_lead_de_la_sesion
  from public.lead l
  where l.id_sesion_anonima = p_id_sesion
  union all
  select s.id_lead from public.lead_sesion s where s.id_sesion = p_id_sesion
  limit 1;

  update public.verificacion_lead v
  set usada_en = now()
  where v.token_hash = p_token_hash
    and v.usada_en is null
    and v.vence_en > now()
    and (v_lead_de_la_sesion is null or v_lead_de_la_sesion = v.id_lead)
  returning v.id_lead, v.siguiente into v_id_lead, v_siguiente;

  if v_id_lead is null then
    return;
  end if;

  if v_lead_de_la_sesion is null then
    insert into public.lead_sesion (id_sesion, id_lead) values (p_id_sesion, v_id_lead);
    update public.diagnostico d
    set id_lead = v_id_lead
    where d.id_sesion_anonima = p_id_sesion and d.id_lead is null;
  end if;

  id_lead := v_id_lead;
  siguiente := v_siguiente;
  return next;
end;
$$;

revoke all on function public.confirmar_correo_de_lead(text, uuid) from public, anon, authenticated;
grant execute on function public.confirmar_correo_de_lead(text, uuid) to service_role;
