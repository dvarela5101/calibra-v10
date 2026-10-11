-- Registrar que un Lead pidió no recibir más mensajes. HU-089.
--
-- D-61 f (10-oct-2026): un botón «Pidió no recibir mensajes» apaga lead.acepta_contacto y guarda qué admin lo registró
-- y cuándo. No cambia el estado (no es descartado) ni toca citas, pagos o el consentimiento de datos. Como
-- lead_para_contactar (HU-053) ya excluye a quien no acepta contacto, el Lead deja de salir en la descarga.
--
-- Diseño:
--   * Quién y cuándo viven en public.lead_sin_contacto y no en lead, por la misma razón que lead_gestion: el dueño del
--     Lead lee su fila de lead y no debe ver el id del admin.
--   * Nadie con sesión escribe acepta_contacto ni lead_sin_contacto: lo hace privado.registrar_sin_contacto (definer),
--     con el Lead bloqueado. La sesión entra por public.registrar_sin_contacto (invoker), como en HU-030.
--   * Si la persona vuelve a aceptar contacto (HU-068, con la llave secreta), un trigger borra el registro: ya no es
--     actual. Solo queda el último registro, sin historial.
--   * Las vistas de HU-053 no cambian: db:verificar reaplica todas las migraciones en orden, y la de HU-053 volvería a
--     crear lead_para_gestion sin columnas agregadas aquí (create or replace view no deja quitarlas). La lista lee
--     lead_sin_contacto aparte, con la política «admin lee».
-- No redefine ninguna función existente.
-- Idempotente.

-- ---------------------------------------------------------------------------
-- Quién registró el pedido y cuándo
-- ---------------------------------------------------------------------------
create table if not exists public.lead_sin_contacto (
  id_lead uuid primary key references public.lead (id) on delete cascade,
  id_admin uuid references public.admin (id) on delete set null,
  registrado_en timestamptz not null
);
create index if not exists lead_sin_contacto_id_admin_idx on public.lead_sin_contacto (id_admin);

comment on table public.lead_sin_contacto is
  'Qué admin registró que el Lead pidió no recibir más mensajes y cuándo (D-61 f). Solo el último; se borra si la persona vuelve a aceptar contacto. La escribe solo privado.registrar_sin_contacto; la leen solo los admins. HU-089.';

alter table public.lead_sin_contacto enable row level security;
revoke all on table public.lead_sin_contacto from public, anon, authenticated, service_role;
grant select on table public.lead_sin_contacto to authenticated;
grant select, insert, update, delete on table public.lead_sin_contacto to service_role;

drop policy if exists "admin lee" on public.lead_sin_contacto;
create policy "admin lee" on public.lead_sin_contacto
  for select to authenticated
  using ((select privado.es_admin()));

-- ---------------------------------------------------------------------------
-- Registrar el pedido
-- ---------------------------------------------------------------------------
-- Devuelve registrado, ya_no_acepta, no_existe o no_autorizado. Con el Lead bloqueado, dos admins a la vez no se pisan:
-- el segundo ve ya_no_acepta y no cambia quién ni cuándo. No toca estado, así que el trigger de lead_gestion no corre.
create or replace function privado.registrar_sin_contacto(p_id_lead uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_acepta boolean;
begin
  if not coalesce((select privado.es_admin()), false) then
    return 'no_autorizado';
  end if;

  select l.acepta_contacto into v_acepta
  from public.lead l
  where l.id = p_id_lead
  for update;
  if not found then
    return 'no_existe';
  end if;
  if not v_acepta then
    return 'ya_no_acepta';
  end if;

  update public.lead set acepta_contacto = false where id = p_id_lead;
  insert into public.lead_sin_contacto (id_lead, id_admin, registrado_en)
  values (p_id_lead, (select auth.uid()), now())
  on conflict (id_lead) do update
    set id_admin = excluded.id_admin,
        registrado_en = excluded.registrado_en;
  return 'registrado';
end;
$$;

comment on function privado.registrar_sin_contacto(uuid) is
  'Un admin activo registra que el Lead pidió no recibir más mensajes: apaga acepta_contacto y guarda su id y la hora (D-61 f). Interna: la sesión entra por public.registrar_sin_contacto. HU-089.';

revoke all on function privado.registrar_sin_contacto(uuid) from public, anon, authenticated, service_role;
grant execute on function privado.registrar_sin_contacto(uuid) to authenticated;

-- La puerta en la Data API, con los permisos de quien llama. Solo con sesión: service_role no tiene auth.uid().
create or replace function public.registrar_sin_contacto(p_id_lead uuid)
returns text
language sql
volatile
security invoker
set search_path = ''
as $$
  select privado.registrar_sin_contacto(p_id_lead);
$$;

comment on function public.registrar_sin_contacto(uuid) is
  'Registra que un Lead pidió no recibir más mensajes (D-61 f). Devuelve registrado, ya_no_acepta, no_existe o no_autorizado. HU-089.';

revoke all on function public.registrar_sin_contacto(uuid) from public, anon, authenticated, service_role;
grant execute on function public.registrar_sin_contacto(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Si la persona vuelve a aceptar, el registro se borra
-- ---------------------------------------------------------------------------
create or replace function privado.borrar_sin_contacto()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.lead_sin_contacto where id_lead = new.id;
  return new;
end;
$$;
revoke all on function privado.borrar_sin_contacto() from public, anon, authenticated, service_role;

drop trigger if exists lead_borrar_sin_contacto on public.lead;
create trigger lead_borrar_sin_contacto
  after update of acepta_contacto on public.lead
  for each row
  when (new.acepta_contacto and not old.acepta_contacto)
  execute function privado.borrar_sin_contacto();
