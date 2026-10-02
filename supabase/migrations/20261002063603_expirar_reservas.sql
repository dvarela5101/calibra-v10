-- Expirar las reservas sin comprobante a los 10 minutos. HU-027.
--
-- RN-34: una monitoría en pendiente_pago que pasó su reserva (reserva_hasta = fecha_creacion + 10 minutos) sin
-- comprobante pasa a cancelada con motivo reserva_expirada, y la fecha queda libre. Sección 6.3: "Expirar reservas |
-- Cada minuto": un proceso de pg_cron que corre dentro de la base, como el cierre automático de HU-023 (sin pg_net ni
-- configuración externa). P-40: los bordes son inclusivos, así que vence cuando ahora > reserva_hasta; en
-- reserva_hasta exacto todavía se paga (registrar_pago, HU-018) y el proceso no la cancela.
-- D-12: la vencida es la misma que muestra la agenda del monitor (privado.agenda_del_monitor): pendiente_pago, sin
-- ningún pago (cuentan también los rechazados) y fuera de su reserva. Ahora el predicado es una función,
-- privado.reserva_vencida, que usan el proceso, la disponibilidad y agendar.
-- D-16: no se avisa a nadie. El trigger de HU-051 ya ignora reserva_expirada; aquí no se toca.
--
-- Nota técnica de HU-027: la disponibilidad considera reserva_hasta por sí misma, sin depender del minuto en que
-- corre el proceso.
--   * privado.fecha_libre (HU-016) no cuenta las reservas vencidas.
--   * privado.agendar_monitoria (HU-017) cancela en el momento la vencida de esa franja y fecha antes de revisar si
--     está libre: el índice único monitoria_franja_fecha_activa_key (where estado <> 'cancelada') no puede mirar la
--     hora, y sin esto la lista mostraría la fecha libre y agendar respondería ocupada.
--   * privado.registrar_pago (HU-018) responde vencida, y no cancelada, si la monitoría se canceló por
--     reserva_expirada: el resultado no depende de quién ganó la carrera (supuesto del registro de HU-027).
-- Las tres se redefinen desde la versión de main y cada una dice qué cambió.
--
-- Revisión de HU-018 (dvarela5101, 2-oct-2026; registro de HU-027), ya que aquí se redefine registrar_pago:
--   * la autorización (es_mi_lead) se lee sin candado antes del `for update`;
--   * la versión con p_ahora queda interna, sin grant a authenticated: la sesión ejecuta
--     privado.registrar_pago_de_la_sesion, que usa now(), y public.registrar_pago pasa a llamarla.
--
-- No se tocan privado.agenda_del_monitor (HU-021), el trigger de avisos (HU-051) ni
-- privado.validar_franja_del_monitor (HU-015, P-30): esta última sigue contando como activa una vencida que el
-- proceso todavía no canceló, un minuto como máximo.
-- Idempotente.

-- ---------------------------------------------------------------------------
-- La reserva vencida (RN-34, D-12, P-40)
-- ---------------------------------------------------------------------------
-- Recibe la fila (id, estado y fecha_creacion) para que quien la llama la evalúe sobre la versión de la fila que está
-- mirando. Sin hora no hay vencimiento: con p_ahora nulo devuelve false, nunca null.
-- security invoker: basta, porque quienes la llaman (el proceso, fecha_libre y agendar_monitoria) son security
-- definer y la corren como su dueño, que lee pago. Nadie con sesión ni el servidor la ejecutan.
create or replace function privado.reserva_vencida(
  p_id_monitoria uuid,
  p_estado public.estado_monitoria,
  p_fecha_creacion timestamptz,
  p_ahora timestamptz
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    p_estado = 'pendiente_pago'
      and not public.dentro_de_plazo(public.reserva_hasta(p_fecha_creacion), p_ahora)
      and not exists (select 1 from public.pago p where p.id_monitoria = p_id_monitoria),
    false
  );
$$;

revoke all on function privado.reserva_vencida(uuid, public.estado_monitoria, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- El proceso: cancelar las reservas vencidas (RN-34, sección 6.3)
-- ---------------------------------------------------------------------------
-- Pasa a cancelada (reserva_expirada) cada monitoría por pagar con la reserva vencida. RN-34 vale también para las
-- grupales (hoy no existen), así que no las excluye. Devuelve cuántas canceló; correrla dos veces seguidas no cambia
-- nada la segunda (criterio 3). Solo la corre pg_cron (como postgres): ninguna sesión ni el servidor la ejecutan.
--
-- Criterio 2, un comprobante que llega en el mismo instante: registrar_pago (HU-018) bloquea la monitoría
-- `for update` y en la misma transacción crea el pago y la pasa a confirmada. Este UPDATE toma el mismo bloqueo de
-- fila, así que solo gana uno:
--   * Si el pago llega primero, el UPDATE espera y, en READ COMMITTED, vuelve a evaluar su WHERE sobre la versión
--     nueva de la fila: ya está confirmada y la salta. Lo que decide es la columna estado (m.estado y el p_estado que
--     recibe reserva_vencida). El `not exists` de pagos de reserva_vencida usa la instantánea de la sentencia y no
--     vería el pago recién confirmado.
--   * Si el proceso llega primero, registrar_pago espera, lee la fila cancelada por reserva_expirada y responde
--     vencida, sin crear el pago.
-- Los dos usan el now() del inicio de su transacción y el mismo borde (P-40): en reserva_hasta exacto el pago entra y
-- el proceso no cancela; un microsegundo después, al revés.
create or replace function privado.expirar_reservas(p_ahora timestamptz)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_canceladas integer;
begin
  update public.monitoria m
  set estado = 'cancelada', motivo_cancelacion = 'reserva_expirada'
  where m.estado = 'pendiente_pago'
    and privado.reserva_vencida(m.id, m.estado, m.fecha_creacion, p_ahora);
  get diagnostics v_canceladas = row_count;
  return v_canceladas;
end;
$$;

revoke all on function privado.expirar_reservas(timestamptz) from public, anon, authenticated, service_role;

-- Lo que el proceso recorre cada minuto: solo las monitorías por pagar.
create index if not exists monitoria_pendientes_idx on public.monitoria (fecha_creacion)
  where estado = 'pendiente_pago';

-- cron.schedule con el mismo nombre reemplaza el trabajo: reaplicar la migración no lo duplica.
select cron.schedule('calibra-expirar-reservas', '* * * * *', 'select privado.expirar_reservas(now())');

-- ---------------------------------------------------------------------------
-- Nota técnica: la fecha libre no espera al proceso (HU-016)
-- ---------------------------------------------------------------------------
-- privado.fecha_libre de 20261001034154_fechas_libres_de_materia.sql. Único cambio: una monitoría por pagar con la
-- reserva vencida ya no ocupa la fecha, aunque el proceso todavía no la haya cancelado. Se mide con el mismo p_ahora
-- de la antelación (la puerta pública pasa now()). La firma no cambia.
create or replace function privado.fecha_libre(p_id_franja uuid, p_fecha date, p_ahora timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.franja f
    where f.id = p_id_franja
      and extract(isodow from p_fecha) = f.dia
      and p_fecha >= f.abierta_desde
      and (f.cerrada_desde is null or p_fecha < f.cerrada_desde)
      and public.cumple_antelacion(public.inicio_sesion(p_fecha, f.hora), p_ahora, false)
      and not exists (
        select 1 from public.monitoria m
        where m.id_franja = f.id and m.fecha = p_fecha and m.estado <> 'cancelada'
          -- HU-027: la reserva vencida no ocupa la fecha.
          and not privado.reserva_vencida(m.id, m.estado, m.fecha_creacion, p_ahora)
      )
      -- Un monitor desactivado (cuenta suspendida en Auth) no recibe reservas.
      and not exists (
        select 1 from auth.users u
        where u.id = f.id_monitor and u.banned_until > p_ahora
      )
  );
$$;

revoke all on function privado.fecha_libre(uuid, date, timestamptz) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Nota técnica: agendar cancela en el momento la vencida de esa fecha (HU-017)
-- ---------------------------------------------------------------------------
-- privado.agendar_monitoria de 20261001040929_agendar_monitoria.sql. Único cambio: el UPDATE marcado con HU-027,
-- después de bloquear la franja y antes de revisar la fecha libre. Sin él, fecha_libre daría la fecha por libre y el
-- insert chocaría con el índice único (ocupada). También deja al mismo Lead volver a pedir la fecha de su reserva
-- vencida. Los resultados y la firma no cambian.
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

  -- HU-027: la reserva vencida de esta franja y fecha se cancela aquí, sin esperar al proceso de cada minuto. Con la
  -- franja bloqueada nadie más agenda esta fecha a la vez. Si su Lead la está pagando, este UPDATE espera el bloqueo
  -- de la fila y, si quedó confirmada, la salta, como el proceso (privado.expirar_reservas).
  update public.monitoria m
  set estado = 'cancelada', motivo_cancelacion = 'reserva_expirada'
  where m.id_franja = p_id_franja
    and m.fecha = p_fecha
    and m.estado = 'pendiente_pago'
    and privado.reserva_vencida(m.id, m.estado, m.fecha_creacion, v_ahora);

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

-- ---------------------------------------------------------------------------
-- El pago que llega tarde recibe vencida, gane quien gane (HU-018)
-- ---------------------------------------------------------------------------
-- privado.registrar_pago de 20261002055415_pagar_por_llave.sql. Tres cambios; la firma y los demás resultados
-- no cambian:
--   1. (HU-027) Lee también motivo_cancelacion y, si la monitoría está cancelada por reserva_expirada (el proceso o
--      agendar llegaron primero), responde vencida en vez de cancelada: es lo mismo que habría respondido si el pago
--      hubiera llegado antes que la cancelación.
--   2. (Revisión de HU-018) La autorización (es_mi_lead) se lee sin candado antes del `for update`.
--   3. (Revisión de HU-018) Esta versión, la que recibe p_ahora, ya no tiene grant a authenticated: la sesión entra
--      por privado.registrar_pago_de_la_sesion, que usa now(), y public.registrar_pago pasa a llamar a esa.
create or replace function privado.registrar_pago(
  p_id_monitoria uuid,
  p_comprobante text,
  p_nombre text,
  p_contacto text,
  p_ahora timestamptz default now()
)
returns table (resultado text, id_pago uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_nombre text := btrim(p_nombre);
  v_id_lead uuid;
  v_estado public.estado_monitoria;
  v_motivo public.motivo_cancelacion;
  v_fecha_creacion timestamptz;
  v_valor_total integer;
  v_admin uuid;
  v_id uuid;
begin
  if v_uid is null then
    resultado := 'sin_sesion';
    return next;
    return;
  end if;

  -- Revisión de HU-018: primero se autoriza con una lectura sin candado, para que una sesión que no es la del Lead
  -- no pueda bloquear la fila de la reserva de otra persona. El Lead de una monitoría no cambia, así que basta mirarlo
  -- una vez.
  select m.id_lead into v_id_lead from public.monitoria m where m.id = p_id_monitoria;
  if not found or not privado.es_mi_lead(v_id_lead) then
    resultado := 'no_es_tuya';
    return next;
    return;
  end if;

  -- `for update`: dos envíos a la vez (un doble clic, dos pestañas) quedan en fila y el segundo ve lo que dejó el
  -- primero. La cancelación de la reserva vencida (HU-027) bloquea la misma fila: solo gana uno.
  select m.estado, m.motivo_cancelacion, m.fecha_creacion, m.valor_total
    into v_estado, v_motivo, v_fecha_creacion, v_valor_total
  from public.monitoria m
  where m.id = p_id_monitoria
  for update;

  -- Las grupales pagan por persona o con un pago único del organizador (HU-036, HU-038).
  if exists (select 1 from public.monitoria_grupal g where g.id_monitoria = p_id_monitoria) then
    resultado := 'no_individual';
    return next;
    return;
  end if;

  if v_estado in ('confirmada', 'realizada') then
    resultado := 'ya_pagada';
    return next;
    return;
  end if;
  if v_estado = 'cancelada' then
    -- HU-027: la que se canceló por vencerse la reserva responde lo mismo que una vencida sin cancelar.
    resultado := case when v_motivo = 'reserva_expirada' then 'vencida' else 'cancelada' end;
    return next;
    return;
  end if;

  -- pendiente_pago: la reserva tiene que seguir vigente al crear el pago (criterio 4, P-40). Si venció, HU-027 la
  -- cancela; aquí solo se rehúsa el pago.
  if not public.dentro_de_plazo(public.reserva_hasta(v_fecha_creacion), p_ahora) then
    resultado := 'vencida';
    return next;
    return;
  end if;

  -- RN-44 y supuesto 3: el nombre con el largo de solicitud_monitor (1 a 120) y el contacto, un correo que el
  -- servidor ya normalizó (minúsculas, sin espacios) y que cumple la regla de correo de todo Calibra (HU-070).
  if v_nombre is null
     or char_length(v_nombre) not between 1 and 120
     or not privado.es_correo_seguro(p_contacto)
     or p_contacto <> lower(p_contacto) then
    resultado := 'datos_invalidos';
    return next;
    return;
  end if;

  -- Criterio 7: el comprobante está en la carpeta de quien paga (rutaEsDelUsuario de HU-007)...
  if split_part(coalesce(p_comprobante, ''), '/', 1) <> v_uid::text then
    resultado := 'comprobante_ajeno';
    return next;
    return;
  end if;

  -- ...el servidor lo revisó (HU-059). `for share`: la limpieza de huérfanos no le quita la marca mientras tanto...
  perform 1 from public.comprobante_revisado c where c.ruta = p_comprobante for share;
  if not found then
    resultado := 'comprobante_sin_revisar';
    return next;
    return;
  end if;

  -- ...y sigue en el bucket. `for share`, como en anotar_comprobante_revisado: nadie lo borra a la vez.
  perform 1 from storage.objects o where o.bucket_id = 'comprobantes' and o.name = p_comprobante for share;
  if not found then
    resultado := 'comprobante_no_existe';
    return next;
    return;
  end if;

  if exists (select 1 from public.pago p where p.comprobante = p_comprobante) then
    resultado := 'comprobante_usado';
    return next;
    return;
  end if;

  -- RN-42: el primer admin activo según orden_revision (salta a los desactivados, RN-07). Sin ninguno no se crea
  -- nada: pago.id_admin es obligatorio y el pago quedaría sin quien lo revise.
  v_admin := privado.siguiente_admin_activo();
  if v_admin is null then
    resultado := 'sin_admin';
    return next;
    return;
  end if;

  -- P-36: el monto es el valor_total; RN-41: nace en en_revision (el valor por defecto de estado).
  begin
    insert into public.pago (
      id_monitoria, monto, nombre_pagador, contacto, id_admin, fecha_pago, fecha_asignacion, comprobante
    ) values (
      p_id_monitoria, v_valor_total, v_nombre, p_contacto, v_admin, p_ahora, p_ahora, p_comprobante
    )
    returning id into v_id;
  exception when unique_violation then
    -- pago_comprobante_key: otro pago tomó el mismo archivo en el mismo instante.
    resultado := 'comprobante_usado';
    return next;
    return;
  end;

  -- RN-38: con los pagos no rechazados cubriendo el valor_total, la monitoría queda confirmada sin esperar al admin.
  -- Con P-36 el primer pago de una individual siempre lo cubre.
  if (
    select coalesce(sum(p.monto), 0) from public.pago p
    where p.id_monitoria = p_id_monitoria and p.estado <> 'rechazado'
  ) >= v_valor_total then
    update public.monitoria set estado = 'confirmada'
    where id = p_id_monitoria and estado = 'pendiente_pago';
  end if;

  resultado := 'registrado';
  id_pago := v_id;
  return next;
end;
$$;

-- Revisión de HU-018: la versión con p_ahora queda interna. Ninguna sesión la ejecuta (podría elegir la hora y pagar
-- una reserva vencida); la usan registrar_pago_de_la_sesion, con now(), y las pruebas, como postgres.
revoke all on function privado.registrar_pago(uuid, text, text, text, timestamptz) from public, anon, authenticated, service_role;

-- La que ejecuta la sesión del Lead: la misma, con la hora de la base.
create or replace function privado.registrar_pago_de_la_sesion(
  p_id_monitoria uuid,
  p_comprobante text,
  p_nombre text,
  p_contacto text
)
returns table (resultado text, id_pago uuid)
language sql
volatile
security definer
set search_path = ''
as $$
  select r.resultado, r.id_pago
  from privado.registrar_pago(p_id_monitoria, p_comprobante, p_nombre, p_contacto, now()) r;
$$;
comment on function privado.registrar_pago_de_la_sesion(uuid, text, text, text) is
  'Registra el pago de la sesión del Lead con la hora de la base: privado.registrar_pago sin p_ahora. HU-018, HU-027.';
revoke all on function privado.registrar_pago_de_la_sesion(uuid, text, text, text) from public, anon, authenticated, service_role;
grant execute on function privado.registrar_pago_de_la_sesion(uuid, text, text, text) to authenticated;

-- La puerta pública de 20261002055415_pagar_por_llave.sql. Único cambio: llama a registrar_pago_de_la_sesion en vez
-- de pasarle now() a la versión con p_ahora, que ya no ejecuta ninguna sesión.
create or replace function public.registrar_pago(
  p_id_monitoria uuid,
  p_comprobante text,
  p_nombre text,
  p_contacto text
)
returns table (resultado text, id_pago uuid)
language sql
volatile
security invoker
set search_path = ''
as $$
  select r.resultado, r.id_pago
  from privado.registrar_pago_de_la_sesion(p_id_monitoria, p_comprobante, p_nombre, p_contacto) r;
$$;
revoke all on function public.registrar_pago(uuid, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.registrar_pago(uuid, text, text, text) to authenticated;
