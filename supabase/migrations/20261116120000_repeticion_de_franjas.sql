-- Repetición de franjas al abrirlas. HU-140.
--
-- D-94 (16-nov-2026, dvarela5101): el monitor abre sus franjas desde un calendario y elige cuánto se repiten: solo ese día,
-- cada día de la semana durante N semanas (2 a 16) o todas las semanas sin fecha final. Hasta ahora el trigger
-- `privado.validar_franja_del_monitor` forzaba `abierta_desde = hoy` y `cerrada_desde = null` en cada INSERT, y el
-- `grant insert` no incluía esas columnas. Esta migración:
--   a) deja que el monitor fije `abierta_desde` (hoy o una fecha futura que caiga en el `dia` de la franja) y `cerrada_desde`
--      (exclusivo, posterior al inicio; nulo = sin fecha final) al insertar;
--   b) hace que el solape entre franjas del mismo día mire también las fechas: dos franjas a la misma hora chocan solo si
--      sus rangos de fechas `[abierta_desde, cerrada_desde)` se cruzan (nulo = sin fin) y la otra sigue vigente;
--   c) amplía el `grant insert` con las dos columnas.
-- En UPDATE todo queda igual (`abierta_desde` no se cambia). El tope de 16 semanas vive solo en la app: un cierre posterior
-- normal puede quedar más lejos.
--
-- Lo demás ya estaba: `privado.fecha_libre` (20261002063603_expirar_reservas.sql) exige `fecha >= abierta_desde` y
-- `fecha < cerrada_desde`, y de ahí salen `fechas_libres_de_materia` y `agendar_monitoria`; `privado.monitoria_en_franja_abierta`
-- ya rechaza las fechas desde el cierre. Idempotente.

-- ---------------------------------------------------------------------------
-- El trigger de la franja, con fechas de inicio y de cierre al insertar
-- ---------------------------------------------------------------------------
-- El mismo cuerpo de 20261028033026_lugar_por_monitoria.sql; cambian la rama INSERT y la comprobación de solapes.
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
  -- Las escrituras de confianza no pasan por las reglas del monitor: postgres (sin `set role` el valor es
  -- 'none') y service_role. Cualquier otro rol sí, así que un rol nuevo con permisos queda cubierto.
  -- PostgREST escribe como el monitor con `set role authenticated`. Se mira el rol de la base y no el del
  -- JWT: los claims pueden seguir puestos en una conexión que ya no escribe como la persona.
  if coalesce(current_setting('role', true), 'none') in ('none', 'postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;

  if new.id_monitor is distinct from (select auth.uid()) then
    raise exception 'Solo puedes manejar tus propias franjas.' using errcode = '42501';
  end if;

  -- Dos escrituras simultáneas del mismo monitor se revisan en fila: si no, las dos pasarían el
  -- chequeo de solapes antes de ver a la otra.
  perform pg_advisory_xact_lock(hashtextextended('franja:' || new.id_monitor::text, 0));

  if extract(second from new.hora) <> 0 then
    raise exception 'Escribe la hora en horas y minutos, por ejemplo 14:00.' using errcode = 'P0001';
  end if;
  if new.duracion_min <= 0 or v_fin > 24 * 60 then
    raise exception 'La franja debe terminar el mismo día: revisa la hora y la duración.' using errcode = 'P0001';
  end if;

  if tg_op = 'INSERT' then
    if not exists (select 1 from public.certificado c where c.id_monitor = new.id_monitor) then
      raise exception 'Para abrir franjas necesitas al menos un certificado. Un admin te certifica después de tu evaluación presencial.'
        using errcode = 'P0001';
    end if;

    -- D-94: el inicio y el cierre pueden venir del monitor. Sin inicio, la franja abre hoy; sin cierre, no tiene fecha final.
    if new.abierta_desde is null then
      new.abierta_desde := v_hoy;
    elsif new.abierta_desde < v_hoy then
      raise exception 'Una franja no puede empezar en una fecha que ya pasó.' using errcode = 'P0001';
    elsif new.abierta_desde > v_hoy and extract(isodow from new.abierta_desde)::int <> new.dia then
      raise exception 'La fecha de inicio no coincide con el día de la franja.' using errcode = 'P0001';
    end if;
    if new.cerrada_desde is not null and new.cerrada_desde <= new.abierta_desde then
      raise exception 'La franja tiene que durar al menos un día.' using errcode = 'P0001';
    end if;
  else
    if new.id_monitor is distinct from old.id_monitor or new.abierta_desde is distinct from old.abierta_desde then
      raise exception 'Esa parte de la franja no se puede cambiar.' using errcode = '42501';
    end if;

    if old.cerrada_desde is not null and old.cerrada_desde <= v_hoy then
      raise exception 'Esta franja ya está cerrada. Para volver a ofrecer ese horario, abre otra.' using errcode = 'P0001';
    end if;

    v_cambia_horario := new.dia is distinct from old.dia or new.hora is distinct from old.hora
      or new.duracion_min is distinct from old.duracion_min;
    if v_cambia_horario and exists (
      select 1 from public.monitoria m where m.id_franja = old.id and m.estado <> 'cancelada'
    ) then
      raise exception 'No puedes cambiar el día, la hora ni la duración de una franja que ya tiene monitorías: sus horarios dependen de ella. Ciérrala y abre otra con el horario nuevo; si se cruza con esta, podrás abrirla cuando esta ya esté cerrada.'
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

  -- Sin solapes con otra franja del mismo monitor que siga abierta (P-30). Desde D-94 el cruce también es de fechas: el mismo
  -- día y hora solo chocan si sus rangos [abierta_desde, cerrada_desde) comparten alguna fecha (cierre nulo = sin fin).
  if (new.cerrada_desde is null or new.cerrada_desde > v_hoy) and exists (
    select 1 from public.franja f
    where f.id_monitor = new.id_monitor
      and f.id <> new.id
      and f.dia = new.dia
      and (f.cerrada_desde is null or f.cerrada_desde > v_hoy)
      and int4range(extract(epoch from f.hora)::int / 60, extract(epoch from f.hora)::int / 60 + f.duracion_min)
          && int4range(v_inicio, v_fin)
      and daterange(f.abierta_desde, f.cerrada_desde, '[)') && daterange(new.abierta_desde, new.cerrada_desde, '[)')
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

-- ---------------------------------------------------------------------------
-- El monitor puede fijar el inicio y el cierre al abrir la franja
-- ---------------------------------------------------------------------------
-- Los grants por columna se suman a los de HU-015. El UPDATE sigue sin `abierta_desde`.
grant insert (abierta_desde, cerrada_desde) on table public.franja to authenticated;
