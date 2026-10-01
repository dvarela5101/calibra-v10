-- La agenda del monitor. HU-021.
--
-- RN-17 y RN-36: el monitor ve sus monitorías con fecha, hora, duración, materia y modalidad. P-37: ve el
-- nombre de quien agendó, nunca su correo ni su teléfono. P-24: ve el estado del pago, sin cifras (ni el
-- valor ni la comisión).
--
-- Decisiones del 1-oct-2026 (dvarela5101):
--   D-11: con varios comprobantes, el estado del pago de la monitoría es rechazado si alguno lo fue (RN-43
--         cancela la cita), si no en revisión si alguno lo está, si no aprobado; sin comprobantes, sin pagar.
--   D-12: una reserva pendiente de pago que ya venció (RN-34) se muestra entre las pasadas como reserva
--         vencida, aunque HU-027 todavía no la haya cancelado. Como dice RN-34, vence la que pasó sus 10
--         minutos sin comprobante: con alguno (HU-018 admite varios, RN-38) no está vencida.
--
-- Por qué en la base: el monitor no lee `lead` (tiene el contacto del estudiante) ni `pago` (tiene el del
-- pagador). La función security definer devuelve solo sus monitorías (auth.uid()) y solo lo que la agenda
-- muestra: el nombre del Lead y el estado agregado del pago. `p_ahora` existe para las pruebas: la puerta
-- pública siempre pasa now().
-- Idempotente.

create or replace function privado.agenda_del_monitor(p_ahora timestamptz)
returns table (
  id_monitoria uuid,
  fecha date,
  hora time,
  duracion_min integer,
  presencial boolean,
  nombre_materia text,
  codigo_materia text,
  nombre_estudiante text,
  estado public.estado_monitoria,
  motivo_cancelacion public.motivo_cancelacion,
  reserva_vencida boolean,
  estado_pago text,
  inicio timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.id,
    m.fecha,
    f.hora,
    f.duracion_min,
    f.presencial,
    ma.nombre,
    ma.codigo,
    l.nombre,
    m.estado,
    m.motivo_cancelacion,
    m.estado = 'pendiente_pago'
      and not pa.con_comprobante
      and not public.dentro_de_plazo(public.reserva_hasta(m.fecha_creacion), p_ahora),
    pa.estado_pago,
    public.inicio_sesion(m.fecha, f.hora)
  from public.monitoria m
  join public.franja f on f.id = m.id_franja
  join public.materia ma on ma.id = m.id_materia
  join public.lead l on l.id = m.id_lead
  cross join lateral (
    select case
      when bool_or(p.estado = 'rechazado') then 'rechazado'
      when bool_or(p.estado = 'en_revision') then 'en_revision'
      when bool_or(p.estado = 'aprobado') then 'aprobado'
      else 'sin_pagar'
    end as estado_pago,
    count(*) > 0 as con_comprobante
    from public.pago p
    where p.id_monitoria = m.id
  ) pa
  where m.id_monitor = (select auth.uid())
  order by public.inicio_sesion(m.fecha, f.hora), m.id;
$$;

revoke all on function privado.agenda_del_monitor(timestamptz) from public, anon, authenticated, service_role;
grant execute on function privado.agenda_del_monitor(timestamptz) to authenticated;

-- La puerta en la Data API, con los permisos de quien llama y la hora real. Solo con sesión: sin ella no hay
-- monitor. service_role no la necesita (no tiene auth.uid()).
create or replace function public.mi_agenda()
returns table (
  id_monitoria uuid,
  fecha date,
  hora time,
  duracion_min integer,
  presencial boolean,
  nombre_materia text,
  codigo_materia text,
  nombre_estudiante text,
  estado public.estado_monitoria,
  motivo_cancelacion public.motivo_cancelacion,
  reserva_vencida boolean,
  estado_pago text,
  inicio timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select a.id_monitoria, a.fecha, a.hora, a.duracion_min, a.presencial, a.nombre_materia, a.codigo_materia,
         a.nombre_estudiante, a.estado, a.motivo_cancelacion, a.reserva_vencida, a.estado_pago, a.inicio
  from privado.agenda_del_monitor(now()) a;
$$;

comment on function public.mi_agenda() is
  'Las monitorías del monitor de la sesión, con el nombre de quien agendó y el estado del pago, sin contacto ni cifras. HU-021.';

revoke all on function public.mi_agenda() from public, anon, authenticated, service_role;
grant execute on function public.mi_agenda() to authenticated;
