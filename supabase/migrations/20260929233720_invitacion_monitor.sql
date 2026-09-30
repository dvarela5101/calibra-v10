-- Cuenta de monitor por invitación. HU-013.
--
-- P-20: no hay autorregistro de monitores. Tras la evaluación presencial (P-19), un admin invita al
-- aspirante con su correo y le llega un enlace de registro de un solo uso que vence a los 7 días.
-- El enlace de Supabase Auth no sirve (otp_expiry es 1 hora), así que el token es propio: 256 bits
-- aleatorios que viajan solo en el correo. Aquí se guarda su SHA-256 en hex, nunca el token, para
-- que leer la tabla no dé enlaces válidos.
--
-- Al registrarse, el servidor crea la cuenta en Auth con la llave secreta y llama a
-- public.registrar_monitor(), que en una sola transacción gasta la invitación y crea monitor,
-- monitor_privado y perfil_monitor. Si la invitación ya no sirve, no crea nada.
--
-- RN-80: el monitor puede cambiar su llave. Los desembolsos guardan su propia copia
-- (desembolso.llave_destino), así que los ya creados conservan la anterior.
-- Idempotente.

create table if not exists public.invitacion_monitor (
  id uuid primary key default gen_random_uuid(),
  correo text not null,
  token_hash text not null,
  id_admin uuid not null references public.admin (id),
  creada_en timestamptz not null default now(),
  vence_en timestamptz not null default now() + interval '7 days',
  usada_en timestamptz,
  id_monitor uuid references public.monitor (id) on delete set null,
  constraint invitacion_monitor_token_hash_key unique (token_hash),
  constraint invitacion_monitor_token_hash_sha256 check (token_hash ~ '^[0-9a-f]{64}$'),
  -- El correo llega normalizado (minúsculas, sin espacios) desde el servidor.
  constraint invitacion_monitor_correo_normalizado check (correo = lower(btrim(correo)) and correo like '%_@_%.%'),
  constraint invitacion_monitor_vence_despues check (vence_en > creada_en)
);
comment on table public.invitacion_monitor is
  'Invitación de un solo uso para crear una cuenta de monitor (P-20). Guarda el hash del token, no el token.';
create index if not exists invitacion_monitor_id_admin_idx on public.invitacion_monitor (id_admin);
create index if not exists invitacion_monitor_id_monitor_idx on public.invitacion_monitor (id_monitor);

alter table public.invitacion_monitor enable row level security;
revoke all on table public.invitacion_monitor from public, anon, authenticated;
grant select on table public.invitacion_monitor to authenticated;
grant select, insert, update, delete on table public.invitacion_monitor to service_role;

drop policy if exists "admin lee" on public.invitacion_monitor;
create policy "admin lee" on public.invitacion_monitor
  for select to authenticated
  using ((select privado.es_admin()));

-- RN-80: el monitor cambia su propia llave. Solo esa columna: teléfono y correo no se tocan aquí.
grant update (llave) on table public.monitor_privado to authenticated;
drop policy if exists "dueno cambia su llave" on public.monitor_privado;
create policy "dueno cambia su llave" on public.monitor_privado
  for update to authenticated
  using (id_monitor = (select auth.uid()))
  with check (id_monitor = (select auth.uid()));

alter table public.monitor_privado drop constraint if exists monitor_privado_llave_con_texto;
alter table public.monitor_privado
  add constraint monitor_privado_llave_con_texto check (char_length(btrim(llave)) between 1 and 200);

-- Gasta la invitación y crea el monitor. Corre con los permisos de quien llama (security invoker) y
-- solo la puede llamar service_role: el servidor, después de crear la cuenta en Auth.
-- Devuelve false si la invitación no existe, ya se usó o venció, o si el correo no coincide.
create or replace function public.registrar_monitor(
  p_token_hash text,
  p_id_usuario uuid,
  p_correo text,
  p_nombre text,
  p_numero_telefono text,
  p_llave text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id_invitacion uuid;
begin
  update public.invitacion_monitor i
  set usada_en = now(), id_monitor = null
  where i.token_hash = p_token_hash
    and i.correo = lower(btrim(p_correo))
    and i.usada_en is null
    and i.vence_en > now()
  returning i.id into v_id_invitacion;

  if v_id_invitacion is null then
    return false;
  end if;

  insert into public.monitor (id, nombre) values (p_id_usuario, btrim(p_nombre));
  insert into public.monitor_privado (id_monitor, numero_telefono, correo, llave)
    values (p_id_usuario, btrim(p_numero_telefono), lower(btrim(p_correo)), btrim(p_llave));
  insert into public.perfil_monitor (id_monitor) values (p_id_usuario);

  update public.invitacion_monitor set id_monitor = p_id_usuario where id = v_id_invitacion;
  return true;
end;
$$;

revoke all on function public.registrar_monitor(text, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.registrar_monitor(text, uuid, text, text, text, text) to service_role;
