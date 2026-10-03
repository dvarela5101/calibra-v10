-- El Lead reporta que el monitor no asistió, y la cita muestra las observaciones del admin. HU-029.
--
-- RN-62: el Lead reporta la inasistencia del monitor desde el inicio de la sesión hasta 24 h después de su fin. RN-64: no antes
-- de que empiece (con la hora exacta del inicio ya se puede). RN-65: se reporta sobre una `confirmada` o una `realizada` (el
-- cierre automático de HU-023 pasa la individual a `realizada` en el mismo instante en que la ventana se cierra, N-6). P-40:
-- bordes inclusivos. RN-83: con un reporte `en_revision` o `aceptado` el desembolso queda suspendido. P-04: la gestión de la
-- cita se hace con el enlace del correo (token de HU-019) o con la sesión del navegador (HU-024 hizo lo mismo para cancelar).
-- La hora de las decisiones la pone la base (`now()`), nunca el navegador.
--
-- El corazón es `privado.reportar_inasistencia(id, ahora)`: crea un `reporte_inasistencia` en `en_revision`, asignado al primer
-- admin activo (`privado.siguiente_admin_activo()`), o dice por qué no. Nadie lo ejecuta directamente: lo llaman dos puertas,
-- como en HU-024.
--   * `reportar_inasistencia_por_token(token)`: el enlace del correo. Solo service_role.
--   * `reportar_inasistencia_de_mi_cita(id)`: la sesión del Lead (`privado.es_mi_lead`). Solo authenticated.
-- Cada puerta le pasa `now()`; `p_ahora` existe solo para probar los bordes de la ventana.
--
-- Qué NO hace: no cambia la monitoría (la decide HU-030), no toca `pago`, `reembolso` ni `desembolso`, no manda correos y no
-- pide nada del pago (RN-62 no lo condiciona: una `confirmada` ya empezada puede tener el pago en revisión o rechazado, P-24).
-- Un reporte rechazado no se repite: hay un solo reporte por monitoría (`reporte_inasistencia_id_monitoria_key`).
--
-- RN-83, sin código nuevo en `desembolso`: la suspensión es una propiedad derivada. `public.desembolsos_ejecutables` excluye los
-- desembolsos de una monitoría con un reporte `en_revision` o `aceptado`, se evalúa en vivo y por eso da igual que el reporte
-- llegue antes o después de que exista la fila de `desembolso`. AVISO PARA HU-028: `public.desembolso_ejecutable(fin, ahora)`
-- solo compara horas y no conoce los reportes; al reclamar y revalidar hay que usar la vista (o replicar sus tres
-- condiciones: `pendiente`, ventana vencida y sin reporte `en_revision` o `aceptado`), no la función sola. Reportar exige
-- `ahora <= fin + 24 h` y ejecutar `ahora > fin + 24 h` (N-6): ningún reporte nuevo llega a un desembolso ya ejecutable.
--
-- Bloqueos: solo la fila de la monitoría (`for update of m`, el mismo primer bloqueo de `registrar_pago`, `finalizar_monitoria`,
-- `revisar_pago` y `cancelar_cita`) y el índice único del reporte; el `on conflict` cierra la carrera de dos reportes
-- simultáneos. No toma bloqueo de `pago`. Regla para HU-030: monitoría primero, luego el reporte y luego los pagos.
--
-- D-37: la cita para la página suma `observaciones_reporte` al final de la salida de `datos_de_cita`, `cita_por_token`,
-- `mi_cita` y `mis_citas` (cambia columnas: se borran las seis funciones y se vuelven a crear, con sus permisos; la entrada
-- de PREAMBULOS de scripts/verificar-bd.mjs permite reaplicar la migración de HU-019 sobre la base final).
--
-- Pregunta 3 del plan (valor por defecto): `reporte_observaciones_con_texto` obliga a que las observaciones sean no vacías y de
-- hasta 500 caracteres, el mismo patrón que `pago_observaciones_con_texto` (HU-020). Así HU-030 escribe, y la página muestra,
-- un texto corto.
--
-- Idempotente.

-- ---------------------------------------------------------------------------
-- Las observaciones del reporte: un texto corto y no vacío (o nulo)
-- ---------------------------------------------------------------------------
alter table public.reporte_inasistencia drop constraint if exists reporte_observaciones_con_texto;
alter table public.reporte_inasistencia add constraint reporte_observaciones_con_texto
  check (observaciones is null or (observaciones ~ '[^[:space:]]' and char_length(observaciones) <= 500));

comment on column public.reporte_inasistencia.observaciones is
  'Lo que el admin anota al decidir el reporte (HU-030): un texto corto, no vacío, de hasta 500 caracteres. La cita lo muestra si el reporte se rechazó (D-37). HU-029.';

-- ---------------------------------------------------------------------------
-- El corazón: reportar la inasistencia
-- ---------------------------------------------------------------------------
-- Resultado, en este orden de comprobaciones:
--   no_existe         no hay monitoría con ese id.
--   no_individual     es una grupal: su reporte es de HU-045.
--   ya_reportada      ya existe un reporte de esa monitoría, en cualquier estado. Va antes que el estado y la ventana: una
--                     página vieja, un doble clic o una cita ya cancelada por el reporte aceptado dicen "ya hay reporte".
--   no_reportable     por pagar o cancelada (se reporta sobre una confirmada o una realizada, RN-65).
--   aun_no_empieza    todavía no llegó el inicio (RN-64). Con la hora exacta del inicio ya se puede.
--   fuera_de_ventana  pasaron las 24 h después del fin (RN-62). Con fin + 24 h exactas todavía se puede (P-40).
--   sin_admin         no hay ningún admin activo a quien asignar el reporte: no se crea nada.
--   reportada         se creó el reporte `en_revision`, asignado al primer admin activo, con `fecha_reporte = p_ahora`.
-- security definer y sin control de dueño: de quién es la cita lo deciden las puertas. Nadie la ejecuta directamente.
create or replace function privado.reportar_inasistencia(p_id_monitoria uuid, p_ahora timestamptz)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_estado public.estado_monitoria;
  v_fecha date;
  v_hora time;
  v_duracion integer;
  v_inicio timestamptz;
  v_admin uuid;
begin
  select m.estado, m.fecha, f.hora, f.duracion_min
    into v_estado, v_fecha, v_hora, v_duracion
  from public.monitoria m
  join public.franja f on f.id = m.id_franja
  where m.id = p_id_monitoria
  for update of m;
  if not found then
    return 'no_existe';
  end if;

  if exists (select 1 from public.monitoria_grupal g where g.id_monitoria = p_id_monitoria) then
    return 'no_individual';
  end if;

  if exists (select 1 from public.reporte_inasistencia r where r.id_monitoria = p_id_monitoria) then
    return 'ya_reportada';
  end if;

  if v_estado not in ('confirmada', 'realizada') then
    return 'no_reportable';
  end if;

  -- RN-64 y RN-62, con los bordes inclusivos de P-40. Las funciones del plazo son estrictas (con un dato nulo devuelven nulo),
  -- y `is not true` falla cerrado: sin hora de la franja o sin `p_ahora` no se crea nada.
  v_inicio := public.inicio_sesion(v_fecha, v_hora);
  if public.plazo_alcanzado(v_inicio, p_ahora) is not true then
    return 'aun_no_empieza';
  end if;
  if public.dentro_de_plazo(
       public.reporte_inasistencia_hasta(public.fin_programado(v_inicio, v_duracion)), p_ahora) is not true then
    return 'fuera_de_ventana';
  end if;

  v_admin := privado.siguiente_admin_activo();
  if v_admin is null then
    return 'sin_admin';
  end if;

  insert into public.reporte_inasistencia (id_monitoria, id_admin, fecha_reporte)
  values (p_id_monitoria, v_admin, p_ahora)
  on conflict on constraint reporte_inasistencia_id_monitoria_key do nothing;
  if not found then
    return 'ya_reportada';
  end if;
  return 'reportada';
end;
$$;

comment on function privado.reportar_inasistencia(uuid, timestamptz) is
  'Crea el reporte de inasistencia del monitor en revisión, asignado al primer admin activo (RN-62 a RN-65). No toca monitoría, pagos ni desembolso. Sin control de dueño: lo hacen las puertas. HU-029.';

revoke all on function privado.reportar_inasistencia(uuid, timestamptz) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Puerta 1: el enlace del correo de confirmación (servidor)
-- ---------------------------------------------------------------------------
-- El token es el de HU-019 (`confirmacion_cita.token`). Uno inventado, mal formado, vacío o nulo no coincide con ninguno:
-- `no_existe`.
create or replace function privado.reportar_inasistencia_por_token(p_token text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id_monitoria uuid;
begin
  select c.id_monitoria into v_id_monitoria from public.confirmacion_cita c where c.token = p_token;
  if not found then
    return 'no_existe';
  end if;
  return privado.reportar_inasistencia(v_id_monitoria, now());
end;
$$;

revoke all on function privado.reportar_inasistencia_por_token(text) from public, anon, authenticated, service_role;
grant execute on function privado.reportar_inasistencia_por_token(text) to service_role;

-- La puerta en la Data API, con los permisos de quien llama: solo la llave secreta (service_role), que ya comprobó la forma
-- del token. Sin ella, adivinar tokens sería cosa de cualquiera.
create or replace function public.reportar_inasistencia_por_token(p_token text)
returns text
language sql
volatile
security invoker
set search_path = ''
as $$
  select privado.reportar_inasistencia_por_token(p_token);
$$;

comment on function public.reportar_inasistencia_por_token(text) is
  'El Lead reporta que el monitor no asistió con el enlace del correo (P-04). Solo para el servidor (service_role). HU-029.';

revoke all on function public.reportar_inasistencia_por_token(text) from public, anon, authenticated, service_role;
grant execute on function public.reportar_inasistencia_por_token(text) to service_role;

-- ---------------------------------------------------------------------------
-- Puerta 2: la sesión del Lead
-- ---------------------------------------------------------------------------
-- Solo si la cita es del Lead de la sesión (privado.es_mi_lead: la que agendó, la cuenta de Estudiante o una que confirmó el
-- correo, HU-068). Si no es suya, no existe o no hay sesión, `no_existe`: no se dice cuál de las tres (el monitor y un admin,
-- que no son el Lead, tampoco).
create or replace function privado.reportar_inasistencia_de_mi_cita(p_id_monitoria uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id_lead uuid;
begin
  select m.id_lead into v_id_lead from public.monitoria m where m.id = p_id_monitoria;
  if not found or not privado.es_mi_lead(v_id_lead) then
    return 'no_existe';
  end if;
  return privado.reportar_inasistencia(p_id_monitoria, now());
end;
$$;

revoke all on function privado.reportar_inasistencia_de_mi_cita(uuid) from public, anon, authenticated, service_role;
grant execute on function privado.reportar_inasistencia_de_mi_cita(uuid) to authenticated;

-- La puerta en la Data API, con los permisos de quien llama. Solo con sesión: la anónima del Lead es authenticated.
create or replace function public.reportar_inasistencia_de_mi_cita(p_id_monitoria uuid)
returns text
language sql
volatile
security invoker
set search_path = ''
as $$
  select privado.reportar_inasistencia_de_mi_cita(p_id_monitoria);
$$;

comment on function public.reportar_inasistencia_de_mi_cita(uuid) is
  'El Lead de la sesión reporta que el monitor no asistió, desde el inicio hasta 24 h después del fin (RN-62). HU-029.';

revoke all on function public.reportar_inasistencia_de_mi_cita(uuid) from public, anon, authenticated, service_role;
grant execute on function public.reportar_inasistencia_de_mi_cita(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- D-37: borrar las seis funciones de la cita antes de recrearlas con una columna más
-- ---------------------------------------------------------------------------
-- `create or replace` no deja cambiar las columnas de salida. Borrarlas borra sus permisos: se repiten abajo.
drop function if exists public.cita_por_token(text);
drop function if exists public.mi_cita(uuid);
drop function if exists public.mis_citas();
drop function if exists privado.mi_cita(uuid);
drop function if exists privado.mis_citas();
drop function if exists privado.datos_de_cita(uuid);

-- ---------------------------------------------------------------------------
-- D-37: la cita para la página, con las observaciones del reporte
-- ---------------------------------------------------------------------------
-- Mismo cuerpo que en HU-019; la columna nueva va al final y el estado del reporte sale de una unión lateral que da las dos.
-- Las observaciones solo salen con el reporte ya decidido (`aceptado` o `rechazado`) y no vacías, sin espacios ni saltos de
-- línea de los lados (btrim solo quita espacios por defecto). La base las entrega en cualquier decisión; la página decide cuándo
-- mostrarlas. Se repiten `revoke`, `grant` y `comment` porque borrar una
-- función borra sus permisos.
-- security definer: la página la leen el servidor con el token y el Lead con su sesión, y ninguno de los dos lee `pago`,
-- `reembolso` ni `reporte_inasistencia` (ni el lugar y el enlace de `franja`, P-31). No controla de quién es la cita: las
-- puertas de abajo lo hacen. Solo la ejecuta service_role (y las funciones de privado que la llaman, que son del mismo
-- dueño). Sin filas si la monitoría no existe o es grupal.
--
--   lugar y enlace  solo si la cita está `confirmada` (D-21): no en realizada ni en cancelada.
--   cancelable_hasta  public.cancelable_hasta(inicio, false): 12 h antes del inicio (RN-60, individual). Una cita agendada
--                     con menos de 12 h (RN-37) nace con el plazo ya vencido.
--   reporte_hasta  public.reporte_inasistencia_hasta(fin_programado): 24 h después del fin (RN-62, RN-64).
--   estado_pago  rechazado > en_revision > aprobado > sin_pagar, la misma expresión de privado.agenda_del_monitor (D-11).
--   estado_reembolso  esperando_llave > pendiente > reembolsado entre los reembolsos de sus pagos; nulo si no hay.
--   estado_reporte  el estado del reporte de inasistencia (uno por monitoría); nulo si no hay.
--   observaciones_reporte  lo que el admin anotó al decidir el reporte (HU-030), sin espacios de los lados; nulo con el
--                     reporte en revisión, sin reporte o si la nota quedó en blanco (D-37).
create function privado.datos_de_cita(p_id_monitoria uuid)
returns table (
  id_lead uuid,
  id_monitoria uuid,
  estado public.estado_monitoria,
  motivo_cancelacion public.motivo_cancelacion,
  nombre_monitor text,
  nombre_materia text,
  codigo_materia text,
  fecha date,
  hora time,
  duracion_min integer,
  presencial boolean,
  valor_total integer,
  lugar text,
  enlace text,
  inicio timestamptz,
  fin_programado timestamptz,
  cancelable_hasta timestamptz,
  reporte_hasta timestamptz,
  estado_pago text,
  estado_reembolso text,
  estado_reporte text,
  observaciones_reporte text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.id_lead,
    m.id,
    m.estado,
    m.motivo_cancelacion,
    mo.nombre,
    ma.nombre,
    ma.codigo,
    m.fecha,
    f.hora,
    f.duracion_min,
    f.presencial,
    m.valor_total,
    case when m.estado = 'confirmada' then f.lugar end,
    case when m.estado = 'confirmada' then f.enlace end,
    t.inicio,
    t.fin,
    public.cancelable_hasta(t.inicio, false),
    public.reporte_inasistencia_hasta(t.fin),
    pa.estado_pago,
    re.estado_reembolso,
    rp.estado_reporte,
    rp.observaciones_reporte
  from public.monitoria m
  join public.franja f on f.id = m.id_franja
  join public.materia ma on ma.id = m.id_materia
  join public.monitor mo on mo.id = m.id_monitor
  cross join lateral (
    select public.inicio_sesion(m.fecha, f.hora) as inicio,
           public.fin_programado(public.inicio_sesion(m.fecha, f.hora), f.duracion_min) as fin
  ) t
  cross join lateral (
    select case
      when bool_or(p.estado = 'rechazado') then 'rechazado'
      when bool_or(p.estado = 'en_revision') then 'en_revision'
      when bool_or(p.estado = 'aprobado') then 'aprobado'
      else 'sin_pagar'
    end as estado_pago
    from public.pago p
    where p.id_monitoria = m.id
  ) pa
  cross join lateral (
    select case
      when bool_or(r.estado = 'esperando_llave') then 'esperando_llave'
      when bool_or(r.estado = 'pendiente') then 'pendiente'
      when bool_or(r.estado = 'reembolsado') then 'reembolsado'
    end as estado_reembolso
    from public.reembolso r
    join public.pago p on p.id = r.id_pago
    where p.id_monitoria = m.id
  ) re
  left join lateral (
    select r.estado::text as estado_reporte,
           case when r.estado <> 'en_revision' then nullif(btrim(r.observaciones, E' 	
'), '') end as observaciones_reporte
    from public.reporte_inasistencia r
    where r.id_monitoria = m.id
  ) rp on true
  where m.id = p_id_monitoria
    and not exists (select 1 from public.monitoria_grupal g where g.id_monitoria = m.id);
$$;

comment on function privado.datos_de_cita(uuid) is
  'La cita individual para la página, sin controlar de quién es (lo hacen cita_por_token, mi_cita y mis_citas). Lugar y enlace solo si está confirmada (D-21); con las observaciones del reporte ya decidido (D-37). HU-019 y HU-029.';

revoke all on function privado.datos_de_cita(uuid) from public, anon, authenticated, service_role;
grant execute on function privado.datos_de_cita(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Puerta 1: el enlace del correo (servidor)
-- ---------------------------------------------------------------------------
-- Con los permisos de quien llama: solo la llave secreta (service_role). Un token inventado, mal formado o vacío no coincide
-- con ninguno: cero filas, sin distinguir entre "mal formado" y "no existe". No devuelve el id del Lead.
create function public.cita_por_token(p_token text)
returns table (
  id_monitoria uuid,
  estado public.estado_monitoria,
  motivo_cancelacion public.motivo_cancelacion,
  nombre_monitor text,
  nombre_materia text,
  codigo_materia text,
  fecha date,
  hora time,
  duracion_min integer,
  presencial boolean,
  valor_total integer,
  lugar text,
  enlace text,
  inicio timestamptz,
  fin_programado timestamptz,
  cancelable_hasta timestamptz,
  reporte_hasta timestamptz,
  estado_pago text,
  estado_reembolso text,
  estado_reporte text,
  observaciones_reporte text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select d.id_monitoria, d.estado, d.motivo_cancelacion, d.nombre_monitor, d.nombre_materia, d.codigo_materia, d.fecha,
         d.hora, d.duracion_min, d.presencial, d.valor_total, d.lugar, d.enlace, d.inicio, d.fin_programado,
         d.cancelable_hasta, d.reporte_hasta, d.estado_pago, d.estado_reembolso, d.estado_reporte,
         d.observaciones_reporte
  from public.confirmacion_cita c
  cross join lateral privado.datos_de_cita(c.id_monitoria) d
  where c.token = p_token;
$$;

comment on function public.cita_por_token(text) is
  'La cita de un token de gestión (P-04, RN-12), sin datos de contacto. Sin filas si el token no existe. Solo para el servidor (service_role). HU-019.';

revoke all on function public.cita_por_token(text) from public, anon, authenticated, service_role;
grant execute on function public.cita_por_token(text) to service_role;

-- ---------------------------------------------------------------------------
-- Puerta 2: una cita de la sesión
-- ---------------------------------------------------------------------------
-- La cita solo sale si es del Lead de la sesión (privado.es_mi_lead: la que agendó, la cuenta de Estudiante o una que
-- confirmó el correo, HU-068). Si no es suya o no existe, cero filas: no se dice cuál de las dos. security definer porque
-- el Lead no lee pago, reembolso ni reporte; sin sesión (auth.uid() nulo) es_mi_lead da falso.
create function privado.mi_cita(p_id_monitoria uuid)
returns table (
  id_monitoria uuid,
  estado public.estado_monitoria,
  motivo_cancelacion public.motivo_cancelacion,
  nombre_monitor text,
  nombre_materia text,
  codigo_materia text,
  fecha date,
  hora time,
  duracion_min integer,
  presencial boolean,
  valor_total integer,
  lugar text,
  enlace text,
  inicio timestamptz,
  fin_programado timestamptz,
  cancelable_hasta timestamptz,
  reporte_hasta timestamptz,
  estado_pago text,
  estado_reembolso text,
  estado_reporte text,
  observaciones_reporte text
)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id_monitoria, d.estado, d.motivo_cancelacion, d.nombre_monitor, d.nombre_materia, d.codigo_materia, d.fecha,
         d.hora, d.duracion_min, d.presencial, d.valor_total, d.lugar, d.enlace, d.inicio, d.fin_programado,
         d.cancelable_hasta, d.reporte_hasta, d.estado_pago, d.estado_reembolso, d.estado_reporte,
         d.observaciones_reporte
  from privado.datos_de_cita(p_id_monitoria) d
  where privado.es_mi_lead(d.id_lead);
$$;

revoke all on function privado.mi_cita(uuid) from public, anon, authenticated, service_role;
grant execute on function privado.mi_cita(uuid) to authenticated;

-- La puerta en la Data API, con los permisos de quien llama. Solo con sesión: la anónima del Lead es authenticated.
create function public.mi_cita(p_id_monitoria uuid)
returns table (
  id_monitoria uuid,
  estado public.estado_monitoria,
  motivo_cancelacion public.motivo_cancelacion,
  nombre_monitor text,
  nombre_materia text,
  codigo_materia text,
  fecha date,
  hora time,
  duracion_min integer,
  presencial boolean,
  valor_total integer,
  lugar text,
  enlace text,
  inicio timestamptz,
  fin_programado timestamptz,
  cancelable_hasta timestamptz,
  reporte_hasta timestamptz,
  estado_pago text,
  estado_reembolso text,
  estado_reporte text,
  observaciones_reporte text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id_monitoria, c.estado, c.motivo_cancelacion, c.nombre_monitor, c.nombre_materia, c.codigo_materia, c.fecha,
         c.hora, c.duracion_min, c.presencial, c.valor_total, c.lugar, c.enlace, c.inicio, c.fin_programado,
         c.cancelable_hasta, c.reporte_hasta, c.estado_pago, c.estado_reembolso, c.estado_reporte,
         c.observaciones_reporte
  from privado.mi_cita(p_id_monitoria) c;
$$;

comment on function public.mi_cita(uuid) is
  'Una cita individual del Lead de la sesión, sin datos de contacto (P-04, criterio 4). Sin filas si no es suya. HU-019.';

revoke all on function public.mi_cita(uuid) from public, anon, authenticated, service_role;
grant execute on function public.mi_cita(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Puerta 3: las citas de la sesión
-- ---------------------------------------------------------------------------
-- Las individuales del Lead de la sesión, de la más reciente a la más antigua y hasta 50. Sin las que siguen por pagar
-- (`pendiente_pago`) ni las que vencieron sin pago (`cancelada` por `reserva_expirada`): para el Lead eso todavía no es una
-- cita. Se eligen primero las 50 y después se arma cada una con privado.datos_de_cita, para tener una sola forma de salida.
create function privado.mis_citas()
returns table (
  id_monitoria uuid,
  estado public.estado_monitoria,
  motivo_cancelacion public.motivo_cancelacion,
  nombre_monitor text,
  nombre_materia text,
  codigo_materia text,
  fecha date,
  hora time,
  duracion_min integer,
  presencial boolean,
  valor_total integer,
  lugar text,
  enlace text,
  inicio timestamptz,
  fin_programado timestamptz,
  cancelable_hasta timestamptz,
  reporte_hasta timestamptz,
  estado_pago text,
  estado_reembolso text,
  estado_reporte text,
  observaciones_reporte text
)
language sql
stable
security definer
set search_path = ''
as $$
  with mias as (
    select m.id, public.inicio_sesion(m.fecha, f.hora) as inicio
    from public.monitoria m
    join public.franja f on f.id = m.id_franja
    where m.id_lead in (select l.id from public.lead l where privado.es_mi_lead(l.id))
      and m.estado <> 'pendiente_pago'
      and m.motivo_cancelacion is distinct from 'reserva_expirada'
      and not exists (select 1 from public.monitoria_grupal g where g.id_monitoria = m.id)
    order by 2 desc, m.id
    limit 50
  )
  select d.id_monitoria, d.estado, d.motivo_cancelacion, d.nombre_monitor, d.nombre_materia, d.codigo_materia, d.fecha,
         d.hora, d.duracion_min, d.presencial, d.valor_total, d.lugar, d.enlace, d.inicio, d.fin_programado,
         d.cancelable_hasta, d.reporte_hasta, d.estado_pago, d.estado_reembolso, d.estado_reporte,
         d.observaciones_reporte
  from mias
  cross join lateral privado.datos_de_cita(mias.id) d
  order by d.inicio desc, d.id_monitoria;
$$;

revoke all on function privado.mis_citas() from public, anon, authenticated, service_role;
grant execute on function privado.mis_citas() to authenticated;

create function public.mis_citas()
returns table (
  id_monitoria uuid,
  estado public.estado_monitoria,
  motivo_cancelacion public.motivo_cancelacion,
  nombre_monitor text,
  nombre_materia text,
  codigo_materia text,
  fecha date,
  hora time,
  duracion_min integer,
  presencial boolean,
  valor_total integer,
  lugar text,
  enlace text,
  inicio timestamptz,
  fin_programado timestamptz,
  cancelable_hasta timestamptz,
  reporte_hasta timestamptz,
  estado_pago text,
  estado_reembolso text,
  estado_reporte text,
  observaciones_reporte text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id_monitoria, c.estado, c.motivo_cancelacion, c.nombre_monitor, c.nombre_materia, c.codigo_materia, c.fecha,
         c.hora, c.duracion_min, c.presencial, c.valor_total, c.lugar, c.enlace, c.inicio, c.fin_programado,
         c.cancelable_hasta, c.reporte_hasta, c.estado_pago, c.estado_reembolso, c.estado_reporte,
         c.observaciones_reporte
  from privado.mis_citas() c;
$$;

comment on function public.mis_citas() is
  'Las citas individuales del Lead de la sesión (sin las por pagar ni las vencidas), de la más reciente a la más antigua, hasta 50. HU-019.';

revoke all on function public.mis_citas() from public, anon, authenticated, service_role;
grant execute on function public.mis_citas() to authenticated;
