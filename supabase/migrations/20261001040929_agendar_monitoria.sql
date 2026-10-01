-- Agendar una monitoría individual. HU-017.
--
-- RN-03: se agenda sin cuenta, como Lead (D-3: si la sesión no es Lead, primero deja su contacto, HU-068).
-- RN-32: la monitoría nace con una fecha concreta, la materia y el Lead, y su valor_total es una copia del
-- precio de la franja en ese momento. RN-33: una fecha con una monitoría no cancelada está ocupada; el
-- índice único monitoria_franja_fecha_activa_key lo garantiza aunque dos personas confirmen a la vez.
-- RN-34: nace en pendiente_pago y ocupa la fecha (su vencimiento a los 10 minutos es de HU-027).
-- RN-35 y P-40: 3 h de antelación, con la exacta todavía se puede. RN-37: con menos de 12 h se avisa que
-- no se podrá cancelar.
--
-- Decisiones del 30-sep-2026 (dvarela5101):
--   D-7: se liga el diagnóstico más reciente de la materia aunque ya esté ligado a otra cita: el monitor de
--        cada cita lo ve. Por eso la cita individual apunta a su diagnóstico (monitoria.id_diagnostico) y
--        varias citas pueden compartir uno. diagnostico.id_monitoria queda para el diagnóstico que se hace
--        dentro de una grupal (RN-15, HU-039), donde una monitoría tiene varios.
--   D-8: un Lead tiene como máximo una reserva por pagar vigente a la vez.
--   D-9: solo se agenda dentro de las 4 semanas que muestra la lista (D-4).
--   D-10: con menos de 12 h hay que marcar "Entiendo que no podré cancelarla" para confirmar.
--
-- Nadie con sesión inserta en monitoria: la función security definer de privado hace la reserva con la
-- identidad de la sesión (auth.uid()) y la hora de la base (now()). No recibe ni la sesión ni la hora como
-- parámetro, así que nadie puede agendar a nombre de otro ni saltarse la antelación. La regla de "fecha
-- libre" es la de HU-016 (privado.fecha_libre): lo que se muestra y lo que se acepta no discrepan.
-- Idempotente.

-- ---------------------------------------------------------------------------
-- La cita individual apunta a su diagnóstico (D-7, RN-15)
-- ---------------------------------------------------------------------------
-- Destino de la llave compuesta: el diagnóstico debe ser de la misma materia que la cita (RN-15).
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'diagnostico_id_materia_key' and conrelid = 'public.diagnostico'::regclass
  ) then
    alter table public.diagnostico add constraint diagnostico_id_materia_key unique (id, id_materia);
  end if;
end $$;

alter table public.monitoria add column if not exists id_diagnostico uuid;
comment on column public.monitoria.id_diagnostico is
  'Diagnóstico que orienta una cita individual: el más reciente de la materia al agendar (P-35, D-7). Varias citas pueden compartirlo.';

-- Si el diagnóstico se borra (supresión de datos o limpieza de sesiones, HU-056), la cita sigue sin él.
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'monitoria_diagnostico_fk' and conrelid = 'public.monitoria'::regclass
  ) then
    alter table public.monitoria
      add constraint monitoria_diagnostico_fk foreign key (id_diagnostico, id_materia)
      references public.diagnostico (id, id_materia) on delete set null (id_diagnostico);
  end if;
end $$;

create index if not exists monitoria_id_diagnostico_idx on public.monitoria (id_diagnostico, id_materia);

-- El monitor de una cita ve el diagnóstico al que ella apunta (RN-13 autoriza compartirlo con él).
create or replace function privado.dicta_cita_con_diagnostico(p_id_diagnostico uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.monitoria m
    where m.id_diagnostico = p_id_diagnostico and m.id_monitor = (select auth.uid())
  );
$$;

revoke all on function privado.dicta_cita_con_diagnostico(uuid) from public, anon, authenticated, service_role;
grant execute on function privado.dicta_cita_con_diagnostico(uuid) to authenticated;

-- La misma política de HU-002 con una condición más. Una sola política de lectura en la tabla.
drop policy if exists "dueno, monitor o admin leen" on public.diagnostico;
create policy "dueno, monitor o admin leen" on public.diagnostico
  for select to authenticated
  using (
    (select privado.es_admin())
    or id_sesion_anonima = (select auth.uid())
    or (id_lead is not null and privado.es_mi_lead(id_lead))
    or (id_monitoria is not null and privado.dicta_monitoria(id_monitoria))
    or privado.dicta_cita_con_diagnostico(id)
  );

-- Con D-7 el monitor de cada cita individual lee el diagnóstico. token_recuperacion es un secreto portador
-- (RN-12: el enlace para recuperar los resultados desde otro dispositivo) y solo lo usa el servidor con la
-- llave secreta: las sesiones leen el diagnóstico por columnas, sin él. Una columna nueva de diagnostico
-- necesita su grant aquí para que las sesiones la lean.
revoke select on table public.diagnostico from authenticated;
grant select (
  id, id_lead, id_sesion_anonima, id_evaluacion, id_materia, id_monitoria,
  respuestas, puntaje, resultado_por_tema, fecha_realizacion
) on table public.diagnostico to authenticated;

-- ---------------------------------------------------------------------------
-- Agendar
-- ---------------------------------------------------------------------------
-- Semanas hacia adelante en que se agenda (D-4, D-9). La lista de HU-016 usa el mismo número
-- (SEMANAS_DEL_HORIZONTE en src/lib/disponibilidad/reglas.ts); integracion/agendar.test.ts los compara.
create or replace function privado.semanas_para_agendar()
returns integer
language sql
immutable
set search_path = ''
as $$ select 4 $$;

revoke all on function privado.semanas_para_agendar() from public, anon, authenticated, service_role;

-- Resultado:
--   agendada                   se creó la monitoría (id_monitoria) en pendiente_pago.
--   ya_agendada                el Lead ya tiene esta misma fecha por pagar (id_monitoria): un doble clic.
--   reserva_pendiente          el Lead ya tiene otra reserva por pagar vigente (id_monitoria), D-8.
--   confirmar_sin_cancelacion  faltan menos de 12 h y no marcó la casilla (D-10): no se reservó nada.
--   sin_antelacion             faltan menos de 3 h (RN-35).
--   ocupada                    otra persona ya la tiene (RN-33), aunque haya confirmado en el mismo instante.
--   no_disponible              la franja no existe, no abre ese día, está cerrada, el monitor está
--                              suspendido o no está certificado en la materia, o la fecha está fuera
--                              de las semanas que se muestran (D-9).
--   no_es_lead                 la sesión todavía no dejó su contacto (D-3).
--   sin_sesion                 no hay sesión.
create or replace function privado.agendar_monitoria(
  p_id_franja uuid,
  p_fecha date,
  p_codigo_materia text,
  p_acepta_sin_cancelacion boolean
)
returns table (resultado text, id_monitoria uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_ahora timestamptz := now();
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_id_lead uuid;
  v_pendiente_id uuid;
  v_pendiente_franja uuid;
  v_pendiente_fecha date;
  v_id_materia uuid;
  v_id_monitor uuid;
  v_dia smallint;
  v_hora time;
  v_precio integer;
  v_inicio timestamptz;
  v_id_diagnostico uuid;
  v_id uuid;
begin
  if v_uid is null then
    resultado := 'sin_sesion';
    return next;
    return;
  end if;

  -- El Lead de la sesión, como privado.es_mi_lead: la sesión que lo creó, una que confirmó su correo o la
  -- cuenta de Estudiante que salió de él. Las cuentas del equipo nunca son Lead (HU-068).
  select x.id into v_id_lead
  from (
    select l.id from public.lead l where l.id_sesion_anonima = v_uid
    union all
    select s.id_lead from public.lead_sesion s where s.id_sesion = v_uid
    union all
    select e.id_lead from public.estudiante e where e.id = v_uid
  ) x
  limit 1;
  if v_id_lead is null then
    resultado := 'no_es_lead';
    return next;
    return;
  end if;

  -- D-8: en fila las reservas del mismo Lead, para que dos pestañas no aparten dos fechas a la vez.
  perform 1 from public.lead l where l.id = v_id_lead for update;

  select m.id, m.id_franja, m.fecha into v_pendiente_id, v_pendiente_franja, v_pendiente_fecha
  from public.monitoria m
  where m.id_lead = v_id_lead
    and m.estado = 'pendiente_pago'
    and public.dentro_de_plazo(public.reserva_hasta(m.fecha_creacion), v_ahora)
  order by m.fecha_creacion desc
  limit 1;
  if v_pendiente_id is not null then
    resultado := case
      when v_pendiente_franja = p_id_franja and v_pendiente_fecha = p_fecha then 'ya_agendada'
      else 'reserva_pendiente'
    end;
    id_monitoria := v_pendiente_id;
    return next;
    return;
  end if;

  -- La materia por su código, como la lista de HU-016 (sin distinguir mayúsculas; la exacta primero).
  select ma.id into v_id_materia
  from public.materia ma
  where lower(ma.codigo) = lower(btrim(p_codigo_materia))
  order by (ma.codigo = btrim(p_codigo_materia)) desc, ma.id
  limit 1;

  -- `for update` pone en fila a quienes agendan esta franja y al monitor que la cambia o la cierra (HU-015):
  -- cada uno lee lo que dejó el anterior.
  select f.id_monitor, f.dia, f.hora, f.precio into v_id_monitor, v_dia, v_hora, v_precio
  from public.franja f
  where f.id = p_id_franja
  for update;

  if v_id_monitor is null
     or v_id_materia is null
     or p_fecha is null
     or not exists (
       select 1 from public.certificado c where c.id_monitor = v_id_monitor and c.id_materia = v_id_materia
     )
     or p_fecha < v_hoy
     or p_fecha >= v_hoy + 7 * privado.semanas_para_agendar() then
    resultado := 'no_disponible';
    return next;
    return;
  end if;

  if not privado.fecha_libre(p_id_franja, p_fecha, v_ahora) then
    resultado := case
      when exists (
        select 1 from public.monitoria m
        where m.id_franja = p_id_franja and m.fecha = p_fecha and m.estado <> 'cancelada'
      ) then 'ocupada'
      when extract(isodow from p_fecha) = v_dia
        and not public.cumple_antelacion(public.inicio_sesion(p_fecha, v_hora), v_ahora, false) then 'sin_antelacion'
      else 'no_disponible'
    end;
    return next;
    return;
  end if;

  -- RN-37 y D-10: con menos de 12 h (pasado cancelable_hasta) hace falta la casilla.
  v_inicio := public.inicio_sesion(p_fecha, v_hora);
  if not public.dentro_de_plazo(public.cancelable_hasta(v_inicio, false), v_ahora)
     and not coalesce(p_acepta_sin_cancelacion, false) then
    resultado := 'confirmar_sin_cancelacion';
    return next;
    return;
  end if;

  -- P-35 y D-7: el diagnóstico más reciente de la materia, de este Lead o de esta sesión, esté o no ligado
  -- a otra cita.
  select d.id into v_id_diagnostico
  from public.diagnostico d
  where d.id_materia = v_id_materia
    and (d.id_lead = v_id_lead or d.id_sesion_anonima = v_uid)
  order by d.fecha_realizacion desc, d.id desc
  limit 1;

  begin
    insert into public.monitoria (
      id_franja, id_monitor, id_materia, id_lead, fecha, estado, valor_total, id_diagnostico
    ) values (
      p_id_franja, v_id_monitor, v_id_materia, v_id_lead, p_fecha, 'pendiente_pago', v_precio, v_id_diagnostico
    )
    returning id into v_id;
  exception when unique_violation then
    -- RN-33: la otra persona confirmó primero.
    resultado := 'ocupada';
    return next;
    return;
  end;

  resultado := 'agendada';
  id_monitoria := v_id;
  return next;
end;
$$;

revoke all on function privado.agendar_monitoria(uuid, date, text, boolean) from public, anon, authenticated, service_role;
grant execute on function privado.agendar_monitoria(uuid, date, text, boolean) to authenticated;

-- La puerta en la Data API, con los permisos de quien llama (como public.fechas_libres_de_materia). Solo con
-- sesión: la anónima del visitante es authenticated. service_role no la necesita: sin sesión no hay Lead.
create or replace function public.agendar_monitoria(
  p_id_franja uuid,
  p_fecha date,
  p_codigo_materia text,
  p_acepta_sin_cancelacion boolean default false
)
returns table (resultado text, id_monitoria uuid)
language sql
volatile
security invoker
set search_path = ''
as $$
  select a.resultado, a.id_monitoria
  from privado.agendar_monitoria(p_id_franja, p_fecha, p_codigo_materia, p_acepta_sin_cancelacion) a;
$$;

comment on function public.agendar_monitoria(uuid, date, text, boolean) is
  'Aparta una fecha de una franja para el Lead de la sesión: crea la monitoría en pendiente_pago. HU-017.';

revoke all on function public.agendar_monitoria(uuid, date, text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.agendar_monitoria(uuid, date, text, boolean) to authenticated;
