-- Confirmación de la cita y enlace para gestionarla. HU-019.
--
-- P-04: la gestión de la cita (ver, cancelar, reportar) se hace con un enlace con token que llega en el correo de
-- confirmación. P-22: el correo es obligatorio, así que la confirmación siempre sale por correo. RN-12: el token es
-- aleatorio e imposible de adivinar, y nunca se muestra nada de una cita solo con un correo o un teléfono escrito.
-- RN-38: la monitoría pasa a `confirmada` con el comprobante, sin esperar al admin (RN-43 puede cancelarla si el admin
-- rechaza el pago).
--
-- Decisiones del 2-oct-2026 (dvarela5101) que tocan la base:
--   D-19  El correo sale al `lead.correo` de la monitoría. Si el Lead no tiene (un Lead antiguo con solo teléfono), al
--         contacto del primer pago, que `registrar_pago` (HU-018) garantiza que es un correo. Sin copia a nadie más.
--   D-20  El token se guarda tal cual (64 hexadecimales, 256 bits), sin hash y sin vencimiento. En claro a propósito, como
--         `invitacion_resena.token` (HU-035), `diagnostico.token_recuperacion` y `monitoria_grupal.token_enlace`: el
--         reintento de HU-065 tiene que volver a mandar el mismo enlace (con un hash habría que rotarlo en cada envío, y
--         dos corridas a la vez invalidarían el ya enviado) y el mismo enlace sigue sirviendo a HU-024 (cancelar, hasta 12 h
--         antes) y a HU-029 (reportar, hasta 24 h después del fin). La tabla solo la lee `service_role`; el token solo abre
--         la cita (nunca datos de contacto ni del pago). Abrir el enlace no liga el navegador a la cuenta del Lead (a
--         diferencia de HU-068): solo lee y, más adelante, actúa sobre esa cita.
--   D-21  El lugar (presencial) o el enlace de la videollamada (virtual) llegan con la cita `confirmada`, aunque el pago
--         siga en revisión (RN-38, D-5, P-31). Dejan de mostrarse cuando la cita ya no está confirmada: cancelada (por
--         ejemplo, si se rechaza el pago) o realizada. `datos_de_confirmacion_cita` sí los trae: es para el correo, que
--         sale con la cita confirmada.
--
-- Cuándo se anota la confirmación: un trigger de `monitoria` en `pendiente_pago -> confirmada`, solo individuales (igual
-- que HU-051 y HU-035). No se toca `registrar_pago` (HU-018): confirme quien confirme, mientras la confirmación sea un
-- UPDATE de `monitoria.estado`, el correo sale. La fila va en la misma transacción del cambio: si se deshace, también la
-- fila. Una monitoría insertada directamente como `confirmada` no dispara nada (el trigger es de UPDATE).
--
--   * El mismo trigger le pide a la app con pg_net que procese las confirmaciones (`/api/procesos/confirmar-citas`).
--     pg_net envía la petición solo si la transacción se confirma, así que el correo sale en segundos.
--   * pg_cron repite el pedido cada 5 minutos si quedan confirmaciones sin procesar: cubre una petición perdida.
--   * Un correo que falla queda `fallido` en `correo_envio` y lo reintenta el proceso de HU-065, que lo reconstruye a
--     partir de la monitoría. La clave del correo (`confirmacion_cita:<id_monitoria>`) impide mandarlo dos veces.
--   * El correo solo debe salir si la cita sigue vigente (confirmada, individual y sin empezar). Eso lo decide la app con
--     lo que devuelve `datos_de_confirmacion_cita` (estado, grupal e inicio).
--
-- La cita para la página: una sola forma de salida (`privado.datos_de_cita`) para las tres puertas.
--   * `cita_por_token(token)`: con el token del correo, para el servidor (service_role). Sin filas si no existe.
--   * `mi_cita(id)` y `mis_citas()`: con la sesión del Lead (la que agendó, una cuenta de Estudiante o una que confirmó el
--     correo con HU-068), por `privado.es_mi_lead`. Sin filas si la cita no es de la sesión.
--   Solo individuales: las grupales tienen otras reglas y otras HUs. Ninguna trae el contacto del Lead ni del pagador
--   (P-37) ni cifras de comisión; el nombre del monitor sí se muestra (D-6). Trae los plazos ya calculados con el motor
--   de plazos (`cancelable_hasta`, `reporte_inasistencia_hasta`) y el estado del pago (D-11), del reembolso y del
--   reporte, para que HU-024, HU-025 y HU-029 no tengan que cambiar las columnas de salida (cambiarlas exige
--   `drop function` y una entrada en PREAMBULOS de scripts/verificar-bd.mjs).
--
-- La dirección de la app y el secreto viven en Vault (`calibra_sitio_url` y `calibra_cron_secreto`, como en HU-065,
-- HU-051 y HU-035). Sin ellos el pedido no hace nada: así en local, y en la nube hasta el corte (HU-057).
-- Idempotente.

-- ---------------------------------------------------------------------------
-- Las confirmaciones por mandar (y el token de cada cita)
-- ---------------------------------------------------------------------------
create table if not exists public.confirmacion_cita (
  id uuid primary key default gen_random_uuid(),
  id_monitoria uuid not null references public.monitoria (id) on delete cascade,
  -- El secreto del enlace (64 caracteres hexadecimales, 256 bits). En claro a propósito: ver la cabecera (D-20).
  token text not null default encode(extensions.gen_random_bytes(32), 'hex'),
  creada_en timestamptz not null default now(),
  -- La app ya la tomó y dejó el correo en `correo_envio` (enviado, fallido para reintentar o descartado), o la abandonó.
  procesado_en timestamptz,
  -- Corridas en las que no se pudo procesar (error de la base o de los datos). La app la abandona a las 5, para que
  -- una confirmación que siempre falla no tape a las demás.
  intentos integer not null default 0,
  constraint confirmacion_cita_id_monitoria_key unique (id_monitoria),
  constraint confirmacion_cita_token_key unique (token),
  constraint confirmacion_cita_token_hex check (token ~ '^[0-9a-f]{64}$'),
  constraint confirmacion_cita_intentos_no_negativos check (intentos >= 0)
);

comment on table public.confirmacion_cita is
  'Confirmación por correo de una individual confirmada, con el token de su enlace de gestión (P-04, D-20): la anota un trigger de monitoria y la manda la app. HU-019.';
comment on column public.confirmacion_cita.token is
  'Secreto del enlace de gestión de la cita, en claro porque no vence y el reintento reenvía el mismo (D-20).';

-- Lo que busca el proceso: las que faltan, de la más antigua a la más reciente.
create index if not exists confirmacion_cita_pendientes_idx on public.confirmacion_cita (creada_en) where procesado_en is null;

-- Nadie con sesión la lee ni la escribe: el trigger inserta (security definer) y la app trabaja con la llave secreta, que
-- lee y solo marca `procesado_en` e `intentos`. Sin políticas, RLS niega todo a anon y authenticated.
alter table public.confirmacion_cita enable row level security;
revoke all on table public.confirmacion_cita from public, anon, authenticated, service_role;
grant select, update (procesado_en, intentos) on table public.confirmacion_cita to service_role;

-- ---------------------------------------------------------------------------
-- Pedirle a la app que procese las confirmaciones
-- ---------------------------------------------------------------------------
-- Solo si hay confirmaciones sin procesar y la configuración está en Vault. Devuelve el id de la petición de pg_net, o
-- null si no pidió nada. security definer: lee Vault y usa pg_net, que no son de nadie más.
create or replace function privado.disparar_confirmaciones_cita()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sitio text;
  v_secreto text;
begin
  if not exists (select 1 from public.confirmacion_cita where procesado_en is null) then
    return null;
  end if;

  select decrypted_secret into v_sitio from vault.decrypted_secrets where name = 'calibra_sitio_url';
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'calibra_cron_secreto';
  if coalesce(btrim(v_sitio), '') = '' or coalesce(btrim(v_secreto), '') = '' then
    return null;
  end if;

  return net.http_post(
    url := rtrim(btrim(v_sitio), '/') || '/api/procesos/confirmar-citas',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Authorization', 'Bearer ' || btrim(v_secreto), 'Content-Type', 'application/json'),
    timeout_milliseconds := 60000
  );
end;
$$;

revoke all on function privado.disparar_confirmaciones_cita() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- El trigger: anota la confirmación al pasar a confirmada
-- ---------------------------------------------------------------------------
-- Solo individuales y solo el paso de `pendiente_pago` a `confirmada`. Una confirmación por monitoría: los estados no
-- vuelven atrás, y si una monitoría se confirmara otra vez no se duplica ni se le cambia el token.
create or replace function privado.anotar_confirmacion_cita()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (old.estado = 'pendiente_pago' and new.estado = 'confirmada') then
    return null;
  end if;

  if exists (select 1 from public.monitoria_grupal g where g.id_monitoria = new.id) then
    return null;
  end if;

  insert into public.confirmacion_cita (id_monitoria)
  values (new.id)
  on conflict on constraint confirmacion_cita_id_monitoria_key do nothing;

  -- El pedido a la app nunca tumba el cambio de estado: si Vault o pg_net fallan (por ejemplo, una dirección mal
  -- escrita), la confirmación queda anotada y pg_cron la vuelve a pedir.
  begin
    perform privado.disparar_confirmaciones_cita();
  exception when others then
    raise warning 'calibra: no se pudo pedir la confirmación de la cita (%): %', sqlstate, sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function privado.anotar_confirmacion_cita() from public, anon, authenticated, service_role;

drop trigger if exists monitoria_anota_confirmacion_cita on public.monitoria;
create trigger monitoria_anota_confirmacion_cita
  after update of estado on public.monitoria
  for each row
  when (old.estado is distinct from new.estado)
  execute function privado.anotar_confirmacion_cita();

-- ---------------------------------------------------------------------------
-- Lo que la app necesita para escribir el correo
-- ---------------------------------------------------------------------------
-- Con los permisos de quien llama: solo la llave secreta (service_role), que lee esas tablas. Sin filas si la monitoría no
-- tiene confirmación anotada. Trae el estado, si es grupal y el inicio para que la app decida si la cita sigue vigente
-- (confirmada, individual y sin empezar) antes de mandar nada. `lugar` y `enlace` salen tal cual (D-21: el correo sale
-- con la cita confirmada). `correo_destino` es el del Lead o, si no tiene, el contacto del primer pago (D-19). Nada del
-- contacto del monitor, ni comisión (P-37). `cancelable_hasta` es el plazo de la cita (RN-60); la app lo compara con
-- `creada_en` para saber si al confirmar todavía se podía cancelar (RN-37), sin leer el reloj.
create or replace function public.datos_de_confirmacion_cita(p_id_monitoria uuid)
returns table (
  token text,
  creada_en timestamptz,
  estado public.estado_monitoria,
  grupal boolean,
  correo_destino text,
  nombre_lead text,
  nombre_monitor text,
  nombre_materia text,
  inicio timestamptz,
  duracion_min integer,
  presencial boolean,
  lugar text,
  enlace text,
  valor_total integer,
  cancelable_hasta timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    c.token,
    c.creada_en,
    m.estado,
    g.id_monitoria is not null,
    coalesce(
      l.correo,
      (select p.contacto from public.pago p where p.id_monitoria = m.id order by p.fecha_pago, p.id limit 1)
    ),
    l.nombre,
    mo.nombre,
    ma.nombre,
    t.inicio,
    f.duracion_min,
    f.presencial,
    f.lugar,
    f.enlace,
    m.valor_total,
    public.cancelable_hasta(t.inicio, g.id_monitoria is not null)
  from public.confirmacion_cita c
  join public.monitoria m on m.id = c.id_monitoria
  join public.franja f on f.id = m.id_franja
  join public.materia ma on ma.id = m.id_materia
  join public.monitor mo on mo.id = m.id_monitor
  join public.lead l on l.id = m.id_lead
  left join public.monitoria_grupal g on g.id_monitoria = m.id
  cross join lateral (select public.inicio_sesion(m.fecha, f.hora) as inicio) t
  where c.id_monitoria = p_id_monitoria;
$$;

comment on function public.datos_de_confirmacion_cita(uuid) is
  'Datos del correo de confirmación de una cita (P-04, D-19, D-21). Solo para el servidor (service_role). HU-019.';

revoke all on function public.datos_de_confirmacion_cita(uuid) from public, anon, authenticated, service_role;
grant execute on function public.datos_de_confirmacion_cita(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- La cita para la página: una sola forma de salida
-- ---------------------------------------------------------------------------
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
create or replace function privado.datos_de_cita(p_id_monitoria uuid)
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
  estado_reporte text
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
    (select r.estado::text from public.reporte_inasistencia r where r.id_monitoria = m.id)
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
  where m.id = p_id_monitoria
    and not exists (select 1 from public.monitoria_grupal g where g.id_monitoria = m.id);
$$;

comment on function privado.datos_de_cita(uuid) is
  'La cita individual para la página, sin controlar de quién es (lo hacen cita_por_token, mi_cita y mis_citas). Lugar y enlace solo si está confirmada (D-21). HU-019.';

revoke all on function privado.datos_de_cita(uuid) from public, anon, authenticated, service_role;
grant execute on function privado.datos_de_cita(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Puerta 1: el enlace del correo (servidor)
-- ---------------------------------------------------------------------------
-- Con los permisos de quien llama: solo la llave secreta (service_role). Un token inventado, mal formado o vacío no coincide
-- con ninguno: cero filas, sin distinguir entre "mal formado" y "no existe". No devuelve el id del Lead.
create or replace function public.cita_por_token(p_token text)
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
  estado_reporte text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select d.id_monitoria, d.estado, d.motivo_cancelacion, d.nombre_monitor, d.nombre_materia, d.codigo_materia, d.fecha,
         d.hora, d.duracion_min, d.presencial, d.valor_total, d.lugar, d.enlace, d.inicio, d.fin_programado,
         d.cancelable_hasta, d.reporte_hasta, d.estado_pago, d.estado_reembolso, d.estado_reporte
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
create or replace function privado.mi_cita(p_id_monitoria uuid)
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
  estado_reporte text
)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id_monitoria, d.estado, d.motivo_cancelacion, d.nombre_monitor, d.nombre_materia, d.codigo_materia, d.fecha,
         d.hora, d.duracion_min, d.presencial, d.valor_total, d.lugar, d.enlace, d.inicio, d.fin_programado,
         d.cancelable_hasta, d.reporte_hasta, d.estado_pago, d.estado_reembolso, d.estado_reporte
  from privado.datos_de_cita(p_id_monitoria) d
  where privado.es_mi_lead(d.id_lead);
$$;

revoke all on function privado.mi_cita(uuid) from public, anon, authenticated, service_role;
grant execute on function privado.mi_cita(uuid) to authenticated;

-- La puerta en la Data API, con los permisos de quien llama. Solo con sesión: la anónima del Lead es authenticated.
create or replace function public.mi_cita(p_id_monitoria uuid)
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
  estado_reporte text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id_monitoria, c.estado, c.motivo_cancelacion, c.nombre_monitor, c.nombre_materia, c.codigo_materia, c.fecha,
         c.hora, c.duracion_min, c.presencial, c.valor_total, c.lugar, c.enlace, c.inicio, c.fin_programado,
         c.cancelable_hasta, c.reporte_hasta, c.estado_pago, c.estado_reembolso, c.estado_reporte
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
create or replace function privado.mis_citas()
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
  estado_reporte text
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
         d.cancelable_hasta, d.reporte_hasta, d.estado_pago, d.estado_reembolso, d.estado_reporte
  from mias
  cross join lateral privado.datos_de_cita(mias.id) d
  order by d.inicio desc, d.id_monitoria;
$$;

revoke all on function privado.mis_citas() from public, anon, authenticated, service_role;
grant execute on function privado.mis_citas() to authenticated;

create or replace function public.mis_citas()
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
  estado_reporte text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id_monitoria, c.estado, c.motivo_cancelacion, c.nombre_monitor, c.nombre_materia, c.codigo_materia, c.fecha,
         c.hora, c.duracion_min, c.presencial, c.valor_total, c.lugar, c.enlace, c.inicio, c.fin_programado,
         c.cancelable_hasta, c.reporte_hasta, c.estado_pago, c.estado_reembolso, c.estado_reporte
  from privado.mis_citas() c;
$$;

comment on function public.mis_citas() is
  'Las citas individuales del Lead de la sesión (sin las por pagar ni las vencidas), de la más reciente a la más antigua, hasta 50. HU-019.';

revoke all on function public.mis_citas() from public, anon, authenticated, service_role;
grant execute on function public.mis_citas() to authenticated;

-- cron.schedule con el mismo nombre reemplaza el trabajo: reaplicar la migración no lo duplica.
select cron.schedule('calibra-confirmar-citas', '*/5 * * * *', 'select privado.disparar_confirmaciones_cita()');
