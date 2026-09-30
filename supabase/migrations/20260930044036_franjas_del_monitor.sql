-- Franjas semanales del monitor. HU-015.
--
-- RN-30: el monitor abre franjas recurrentes (día ISO, hora, modalidad, precio y duración). RN-22 y
-- el flujo F2: abre franjas cuando ya tiene al menos un certificado (sin certificado nadie podría
-- agendarle: la monitoría exige una materia certificada).
--
-- P-31: una franja presencial lleva el lugar; una virtual, el enlace de la videollamada (https).
--
-- P-30:
--   * No hay solapes entre las franjas del mismo monitor mientras estén abiertas a la vez: restricción
--     de exclusión sobre (monitor, día, minutos del día, fechas en que está abierta).
--   * Cerrar es poner `cerrada_desde`: desde esa fecha la franja ya no recibe reservas. Solo se puede
--     cerrar desde una fecha posterior a su última monitoría activa (no cancelada). Así, "cerrar una
--     franja con reservas futuras" (cerrarla ya) se impide, y "cerrarla para fechas sin reservas" (desde
--     después de la última) se permite.
--   * Día, hora y duración no se cambian si la franja tiene alguna monitoría no cancelada, pasada o
--     futura: los plazos de cada monitoría (inicio, fin, ventana de reporte, desembolso; vista
--     `monitoria_plazos`) se calculan con la hora y la duración actuales de la franja (RN-36), así que
--     cambiarlas movería también las ya dictadas. Para otro horario, se cierra y se abre otra.
--   * El precio sí se cambia: la monitoría guarda su copia en `valor_total` (RN-32).
--
-- Escritura: el monitor inserta y actualiza solo sus franjas. No se borran (las monitorías las
-- referencian); se cierran.
-- Idempotente.
--
-- Dónde se aplica cada regla: las del monitor (certificado, lugar o enlace, solapes, cambios con
-- reservas, cierre) las aplica un trigger a toda escritura con sesión (rol `authenticated`), que es
-- como escriben los monitores. Las escrituras de confianza (postgres, service_role: pruebas y
-- herramientas del equipo) no pasan por él. El cierre sí se respeta siempre al agendar: una monitoría
-- no se crea en una fecha en que la franja ya está cerrada.

alter table public.franja add column if not exists lugar text;
alter table public.franja add column if not exists enlace text;
alter table public.franja add column if not exists abierta_desde date not null
  default ((now() at time zone 'America/Bogota')::date);
alter table public.franja add column if not exists cerrada_desde date;

alter table public.franja drop constraint if exists franja_lugar_largo;
alter table public.franja add constraint franja_lugar_largo check (lugar is null or char_length(lugar) between 1 and 200);
alter table public.franja drop constraint if exists franja_enlace_https;
alter table public.franja add constraint franja_enlace_https check (enlace is null or (enlace ~ '^https://[^\s]+$' and char_length(enlace) <= 500));
alter table public.franja drop constraint if exists franja_modalidad_coherente;
-- El lugar es de la presencial y el enlace de la virtual; nunca los dos.
alter table public.franja add constraint franja_modalidad_coherente
  check ((presencial and enlace is null) or (not presencial and lugar is null));
alter table public.franja drop constraint if exists franja_cierre_despues_de_apertura;
alter table public.franja add constraint franja_cierre_despues_de_apertura
  check (cerrada_desde is null or cerrada_desde >= abierta_desde);
create index if not exists franja_monitor_dia_idx on public.franja (id_monitor, dia);

-- ---------------------------------------------------------------------------
-- Reglas del monitor al escribir sus franjas (P-30, P-31, F2)
-- ---------------------------------------------------------------------------
-- security definer: revisa monitorías y certificados sin depender de lo que la sesión alcance a leer.
-- Los mensajes (P0001) son para la persona: la app los muestra tal cual.
create or replace function privado.validar_franja_del_monitor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_inicio int := extract(epoch from new.hora)::int / 60;
  v_fin int := extract(epoch from new.hora)::int / 60 + new.duracion_min;
  v_cambia_horario boolean;
begin
  -- Solo las escrituras con sesión (monitores): PostgREST las hace con `set role authenticated`. postgres
  -- y service_role son de confianza. Se mira el rol de la base y no el del JWT: los claims pueden seguir
  -- puestos en una conexión que ya no escribe como la persona.
  if coalesce(current_setting('role', true), 'none') <> 'authenticated' then
    return new;
  end if;

  if new.id_monitor is distinct from (select auth.uid()) then
    raise exception 'Solo puedes manejar tus propias franjas.' using errcode = '42501';
  end if;

  -- Dos escrituras simultáneas del mismo monitor se revisan en fila: si no, las dos pasarían el
  -- chequeo de solapes antes de ver a la otra.
  perform pg_advisory_xact_lock(hashtextextended('franja:' || new.id_monitor::text, 0));

  if new.duracion_min <= 0 or v_fin > 24 * 60 then
    raise exception 'La franja debe terminar el mismo día: revisa la hora y la duración.' using errcode = 'P0001';
  end if;
  if new.presencial and coalesce(btrim(new.lugar), '') = '' then
    raise exception 'Una franja presencial necesita el lugar de la sesión.' using errcode = 'P0001';
  end if;
  if not new.presencial and coalesce(btrim(new.enlace), '') = '' then
    raise exception 'Una franja virtual necesita el enlace de la videollamada.' using errcode = 'P0001';
  end if;

  if tg_op = 'INSERT' then
    if not exists (select 1 from public.certificado c where c.id_monitor = new.id_monitor) then
      raise exception 'Para abrir franjas necesitas al menos un certificado. Un admin te certifica después de tu evaluación presencial.'
        using errcode = 'P0001';
    end if;
    new.abierta_desde := v_hoy;
    new.cerrada_desde := null;
  else
    if new.id_monitor is distinct from old.id_monitor or new.abierta_desde is distinct from old.abierta_desde then
      raise exception 'Esa parte de la franja no se puede cambiar.' using errcode = '42501';
    end if;

    v_cambia_horario := new.dia is distinct from old.dia or new.hora is distinct from old.hora
      or new.duracion_min is distinct from old.duracion_min;
    if v_cambia_horario and exists (
      select 1 from public.monitoria m where m.id_franja = old.id and m.estado <> 'cancelada'
    ) then
      raise exception 'No puedes cambiar el día, la hora ni la duración de una franja que ya tiene monitorías: sus horarios dependen de ella. Ciérrala y abre otra con el horario nuevo.'
        using errcode = 'P0001';
    end if;

    if new.presencial is distinct from old.presencial and exists (
      select 1 from public.monitoria m where m.id_franja = old.id and m.estado <> 'cancelada' and m.fecha >= v_hoy
    ) then
      raise exception 'No puedes cambiar entre presencial y virtual mientras la franja tenga monitorías agendadas.'
        using errcode = 'P0001';
    end if;

    if new.cerrada_desde is distinct from old.cerrada_desde and new.cerrada_desde is not null then
      if new.cerrada_desde < v_hoy then
        raise exception 'La franja se cierra desde hoy o desde una fecha futura.' using errcode = 'P0001';
      end if;
      if exists (
        select 1 from public.monitoria m
        where m.id_franja = old.id and m.estado <> 'cancelada' and m.fecha >= new.cerrada_desde
      ) then
        raise exception 'No puedes cerrarla desde esa fecha: tiene monitorías agendadas ese día o después. Ciérrala desde el día siguiente a la última.'
          using errcode = 'P0001';
      end if;
    end if;
  end if;

  -- Sin solapes con otra franja del mismo monitor que siga abierta (P-30).
  if (new.cerrada_desde is null or new.cerrada_desde > v_hoy) and exists (
    select 1 from public.franja f
    where f.id_monitor = new.id_monitor
      and f.id <> new.id
      and f.dia = new.dia
      and (f.cerrada_desde is null or f.cerrada_desde > v_hoy)
      and int4range(extract(epoch from f.hora)::int / 60, extract(epoch from f.hora)::int / 60 + f.duracion_min)
          && int4range(v_inicio, v_fin)
  ) then
    raise exception 'Se cruza con otra de tus franjas abiertas el mismo día.' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function privado.validar_franja_del_monitor() from public, anon, authenticated, service_role;

drop trigger if exists franja_validar_monitor on public.franja;
create trigger franja_validar_monitor
  before insert or update on public.franja
  for each row execute function privado.validar_franja_del_monitor();

-- Una franja cerrada no recibe monitorías desde su fecha de cierre (vale para todos).
create or replace function privado.monitoria_en_franja_abierta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.franja f
    where f.id = new.id_franja and f.cerrada_desde is not null and new.fecha >= f.cerrada_desde
  ) then
    raise exception 'La franja está cerrada desde esa fecha.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function privado.monitoria_en_franja_abierta() from public, anon, authenticated, service_role;

drop trigger if exists monitoria_franja_abierta on public.monitoria;
create trigger monitoria_franja_abierta
  before insert or update of id_franja, fecha on public.monitoria
  for each row execute function privado.monitoria_en_franja_abierta();

-- ---------------------------------------------------------------------------
-- Escritura del monitor sobre sus franjas
-- ---------------------------------------------------------------------------
-- auto_expose_new_tables = false: los grants van por columna. abierta_desde la pone el trigger y id no
-- viene del trigger; no se borran franjas (las monitorías las referencian): se cierran.
grant insert (id, id_monitor, dia, hora, presencial, precio, duracion_min, lugar, enlace) on table public.franja to authenticated;
grant update (dia, hora, presencial, precio, duracion_min, lugar, enlace, cerrada_desde) on table public.franja to authenticated;

drop policy if exists "monitor crea sus franjas" on public.franja;
create policy "monitor crea sus franjas" on public.franja
  for insert to authenticated
  with check (id_monitor = (select auth.uid()));

drop policy if exists "monitor edita sus franjas" on public.franja;
create policy "monitor edita sus franjas" on public.franja
  for update to authenticated
  using (id_monitor = (select auth.uid()))
  with check (id_monitor = (select auth.uid()));
