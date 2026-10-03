-- El Lead cancela su monitoría individual confirmada, hasta 12 h antes. HU-024.
--
-- RN-60: una individual se cancela hasta 12 h antes de su inicio, con el borde inclusivo (P-40: con 12 h exactas todavía
-- se cancela). RN-43: lo pagado se devuelve completo. RN-33: al cancelarse, la fecha queda libre (el índice de fechas
-- activas excluye las canceladas). El plazo y la hora los decide la base (`now()`), nunca el navegador.
--
-- Decisiones del 2-oct-2026 (dvarela5101) que tocan la base:
--   D-26  El reembolso va al primer admin activo (`privado.siguiente_admin_activo()` sin id), con el motivo
--         «Cancelaste la monitoría dentro del plazo.».
--   D-27  HU-024 SÍ manda un correo de cancelación al Lead. Si la cancelación crea un reembolso, ese mismo correo pide la
--         llave con un enlace a la página que construirá HU-025 (`/reembolso?token=...`). Si todavía hay un pago en
--         revisión (P-07), el correo explica que la llave se pide solo si se aprueba. HU-025 manda aparte el pedido de
--         los reembolsos que se crean después (pago aprobado tarde, inasistencia): la marca
--         `solicitud_llave.en_correo_de_cancelacion` le dice cuáles ya se pidieron en el correo de cancelación.
--   D-28  Sin admin activo el Lead igual cancela: `reembolso.id_admin` pasa a opcional y el reembolso queda sin admin hasta
--         que un trabajo de pg_cron (`calibra-asignar-reembolsos`, cada 5 minutos) se lo asigna al primer admin activo.
--         Cubre tanto a un admin nuevo como a uno reactivado.
--   D-29  Solo se cancelan las `confirmada`: una por pagar la cancela el vencimiento de la reserva (HU-027) o el rechazo
--         del pago, no el Lead.
--
-- El corazón es `privado.cancelar_cita(id, ahora)`: bloquea la monitoría y sus pagos, la pasa a `cancelada` con motivo
-- `estudiante` (el trigger de HU-051 anota el aviso al monitor, que no se toca), crea un reembolso por cada pago aprobado y
-- anota el correo de cancelación con una foto de lo que pasó, para que el correo y su reintento (HU-065) digan lo mismo
-- aunque después cambien el Lead o los pagos. Nadie lo ejecuta directamente: lo llaman dos puertas.
--   * `cancelar_cita_por_token(token)`: el enlace del correo de confirmación (token de HU-019). Solo service_role.
--   * `cancelar_mi_cita(id)`: la sesión del Lead (`privado.es_mi_lead`). Solo authenticated.
-- Cada puerta le pasa `now()`; `p_ahora` existe solo para probar los bordes del plazo.
--
-- El correo sale como el de la confirmación (HU-019): la fila de `cancelacion_cita` la anota `cancelar_cita` y le pide a la
-- app, con pg_net, que procese las pendientes (`/api/procesos/avisar-cancelaciones`); pg_cron repite el pedido cada 5
-- minutos por si se perdió. Un correo que falla lo reintenta HU-065, que lo reconstruye a partir de la monitoría. La clave
-- del correo (`cancelacion_cita:<id_monitoria>`) impide mandarlo dos veces. La dirección de la app y el secreto viven en
-- Vault (`calibra_sitio_url` y `calibra_cron_secreto`): sin ellos el pedido no hace nada, así en local y en la nube hasta
-- el corte (HU-057).
--
-- P-07: un pago que el admin aprueba DESPUÉS de que el estudiante canceló también recibe su reembolso (un trigger de
-- `pago`). Un pago rechazado nunca tiene reembolso (RN-43). Ese reembolso nace con `en_correo_de_cancelacion = false`: su
-- llave la pide HU-025.
--
-- Idempotente.

-- ---------------------------------------------------------------------------
-- D-28: un reembolso puede quedar sin admin
-- ---------------------------------------------------------------------------
alter table public.reembolso alter column id_admin drop not null;

comment on column public.reembolso.id_admin is
  'Admin que lo ejecuta. Nulo si al crearlo no había ningún admin activo (D-28): privado.asignar_reembolsos_sin_admin se lo asigna. HU-024.';

-- ---------------------------------------------------------------------------
-- La solicitud de llave: el token de la página de la llave (HU-025)
-- ---------------------------------------------------------------------------
-- Uno por reembolso, lo cree quien lo cree (HU-024, P-07, HU-030): lo anota un trigger de `reembolso`. En claro a propósito,
-- como el de la confirmación (D-20): el reintento del correo tiene que volver a mandar el mismo enlace.
create table if not exists public.solicitud_llave (
  id_reembolso uuid primary key references public.reembolso (id) on delete cascade,
  -- El secreto del enlace (64 caracteres hexadecimales, 256 bits).
  token text not null default encode(extensions.gen_random_bytes(32), 'hex'),
  creada_en timestamptz not null default now(),
  -- El correo de cancelación de HU-024 ya pidió esta llave (D-27): HU-025 no la vuelve a pedir.
  en_correo_de_cancelacion boolean not null default false,
  constraint solicitud_llave_token_key unique (token),
  constraint solicitud_llave_token_hex check (token ~ '^[0-9a-f]{64}$')
);

comment on table public.solicitud_llave is
  'Token del enlace con que quien pagó entrega la llave de su reembolso (HU-025), uno por reembolso. HU-024.';
comment on column public.solicitud_llave.token is
  'Secreto del enlace /reembolso?token=..., en claro porque el reintento del correo reenvía el mismo (D-20).';
comment on column public.solicitud_llave.en_correo_de_cancelacion is
  'El correo de cancelación (HU-024, D-27) ya pidió esta llave; HU-025 pide solo las demás.';

-- Nadie con sesión la lee ni la escribe: el trigger inserta (security definer) y la app trabaja con la llave secreta.
-- Sin políticas, RLS niega todo a anon y authenticated.
alter table public.solicitud_llave enable row level security;
revoke all on table public.solicitud_llave from public, anon, authenticated, service_role;
grant select on table public.solicitud_llave to service_role;

create or replace function privado.anotar_solicitud_llave()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.solicitud_llave (id_reembolso)
  values (new.id)
  on conflict (id_reembolso) do nothing;
  return null;
end;
$$;

revoke all on function privado.anotar_solicitud_llave() from public, anon, authenticated, service_role;

drop trigger if exists reembolso_anota_solicitud_llave on public.reembolso;
create trigger reembolso_anota_solicitud_llave
  after insert on public.reembolso
  for each row
  execute function privado.anotar_solicitud_llave();

-- Los reembolsos que ya existían (de antes de esta migración) también tienen su token.
insert into public.solicitud_llave (id_reembolso)
select r.id from public.reembolso r
on conflict (id_reembolso) do nothing;

-- ---------------------------------------------------------------------------
-- Las cancelaciones por avisar
-- ---------------------------------------------------------------------------
create table if not exists public.cancelacion_cita (
  id uuid primary key default gen_random_uuid(),
  id_monitoria uuid not null references public.monitoria (id) on delete cascade,
  creada_en timestamptz not null default now(),
  -- Foto al cancelar: el correo y su reintento dicen lo mismo aunque después cambien el Lead o los pagos.
  -- A quién va: el correo del Lead o, si no tiene, el contacto del primer pago (D-19). Nulo si no hay a quién.
  correo_destino text,
  -- Había al menos un pago en revisión (P-07): el correo explica que la llave se pide solo si se aprueba.
  con_pago_en_revision boolean not null,
  -- Algún reembolso creado se pide a un contacto distinto de `correo_destino`: ese pedido lo manda HU-025.
  reembolso_a_otro_contacto boolean not null,
  -- La app ya la tomó y dejó el correo en `correo_envio` (enviado, fallido para reintentar o descartado), o la abandonó.
  procesado_en timestamptz,
  -- Corridas en las que no se pudo procesar (error de la base o de los datos). La app la abandona a las 5, para que una
  -- cancelación que siempre falla no tape a las demás.
  intentos integer not null default 0,
  constraint cancelacion_cita_id_monitoria_key unique (id_monitoria),
  constraint cancelacion_cita_intentos_no_negativos check (intentos >= 0)
);

comment on table public.cancelacion_cita is
  'Correo de cancelación por mandar al Lead que canceló su individual (D-27): la anota privado.cancelar_cita y la manda la app. HU-024.';

-- Lo que busca el proceso: las que faltan, de la más antigua a la más reciente.
create index if not exists cancelacion_cita_pendientes_idx on public.cancelacion_cita (creada_en) where procesado_en is null;

-- Nadie con sesión la lee ni la escribe: la función security definer inserta y la app trabaja con la llave secreta, que lee
-- y solo marca `procesado_en` e `intentos`. Sin políticas, RLS niega todo a anon y authenticated.
alter table public.cancelacion_cita enable row level security;
revoke all on table public.cancelacion_cita from public, anon, authenticated, service_role;
grant select, update (procesado_en, intentos) on table public.cancelacion_cita to service_role;

-- ---------------------------------------------------------------------------
-- Pedirle a la app que procese las cancelaciones
-- ---------------------------------------------------------------------------
-- Solo si hay cancelaciones sin procesar y la configuración está en Vault. Devuelve el id de la petición de pg_net, o null
-- si no pidió nada. security definer: lee Vault y usa pg_net, que no son de nadie más.
create or replace function privado.disparar_cancelaciones_cita()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sitio text;
  v_secreto text;
begin
  if not exists (select 1 from public.cancelacion_cita where procesado_en is null) then
    return null;
  end if;

  select decrypted_secret into v_sitio from vault.decrypted_secrets where name = 'calibra_sitio_url';
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'calibra_cron_secreto';
  if coalesce(btrim(v_sitio), '') = '' or coalesce(btrim(v_secreto), '') = '' then
    return null;
  end if;

  return net.http_post(
    url := rtrim(btrim(v_sitio), '/') || '/api/procesos/avisar-cancelaciones',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Authorization', 'Bearer ' || btrim(v_secreto), 'Content-Type', 'application/json'),
    timeout_milliseconds := 60000
  );
end;
$$;

revoke all on function privado.disparar_cancelaciones_cita() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- El corazón: cancelar la cita
-- ---------------------------------------------------------------------------
-- Resultado:
--   cancelada       la monitoría pasó a cancelada (motivo `estudiante`) y la fecha quedó libre. Si había pagos aprobados,
--                   cada uno tiene su reembolso en `esperando_llave` (con el primer admin activo, o sin admin, D-28).
--   no_existe       no hay monitoría con ese id.
--   no_individual   es una grupal: sus cancelaciones tienen otras reglas y otras HUs.
--   ya_cancelada    ya la había cancelado el estudiante: un doble clic u otra pestaña. No se hace nada más.
--   no_cancelable   no está confirmada (por pagar, realizada o cancelada por otro motivo, D-29).
--   fuera_de_plazo  pasaron las 12 h antes del inicio (RN-60, P-40). Una cita agendada con menos de 12 h (RN-37) nace con
--                   el plazo ya vencido.
-- security definer y sin control de dueño: de quién es la cita lo deciden las puertas. Nadie la ejecuta directamente.
-- Bloquea la monitoría y, después, sus pagos (el mismo orden que HU-018 y HU-020): una cancelación y una aprobación del pago
-- a la vez no dejan un pago aprobado sin reembolso (si la aprobación llega después, la atiende el trigger de P-07).
create or replace function privado.cancelar_cita(p_id_monitoria uuid, p_ahora timestamptz)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id_lead uuid;
  v_id_franja uuid;
  v_fecha date;
  v_estado public.estado_monitoria;
  v_motivo public.motivo_cancelacion;
  v_hora time;
  v_admin uuid;
  v_destino text;
  v_nuevos uuid[];
  v_con_pago_en_revision boolean;
  v_a_otro_contacto boolean;
begin
  select m.id_lead, m.id_franja, m.fecha, m.estado, m.motivo_cancelacion
    into v_id_lead, v_id_franja, v_fecha, v_estado, v_motivo
  from public.monitoria m
  where m.id = p_id_monitoria
  for update;
  if not found then
    return 'no_existe';
  end if;

  if exists (select 1 from public.monitoria_grupal g where g.id_monitoria = p_id_monitoria) then
    return 'no_individual';
  end if;

  if v_estado = 'cancelada' and v_motivo = 'estudiante' then
    return 'ya_cancelada';
  end if;
  if v_estado <> 'confirmada' then
    return 'no_cancelable';
  end if;

  -- RN-60 y P-40: hasta 12 h antes del inicio, con el borde inclusivo. Las funciones del plazo son estrictas (con un dato
  -- nulo devuelven nulo), y `is not true` falla cerrado: sin hora de la franja o sin `p_ahora` no se cancela nada.
  select f.hora into v_hora from public.franja f where f.id = v_id_franja;
  if public.dentro_de_plazo(public.cancelable_hasta(public.inicio_sesion(v_fecha, v_hora), false), p_ahora) is not true then
    return 'fuera_de_plazo';
  end if;

  perform 1 from public.pago p where p.id_monitoria = p_id_monitoria order by p.id for update;

  -- Libera la fecha (el índice de fechas activas excluye las canceladas) y dispara el aviso al monitor de HU-051.
  update public.monitoria
  set estado = 'cancelada', motivo_cancelacion = 'estudiante'
  where id = p_id_monitoria;

  -- RN-43 y D-26: un reembolso por cada pago aprobado, por su monto completo, al primer admin activo. Sin admin activo
  -- el reembolso nace sin admin (D-28). El trigger de `reembolso` crea su solicitud de llave. `on conflict`: si por algún
  -- camino ya tenía reembolso, no se duplica.
  v_admin := privado.siguiente_admin_activo();
  with nuevos as (
    insert into public.reembolso (id_pago, id_admin, monto, motivo)
    select p.id, v_admin, p.monto, 'Cancelaste la monitoría dentro del plazo.'
    from public.pago p
    where p.id_monitoria = p_id_monitoria and p.estado = 'aprobado'
    on conflict on constraint reembolso_id_pago_key do nothing
    returning id
  )
  select coalesce(array_agg(nuevos.id), array[]::uuid[]) into v_nuevos from nuevos;

  -- D-19 y D-27: el correo va al mismo destinatario que la confirmación y pide solo las llaves de los reembolsos cuyo pago
  -- hizo ese mismo correo (sin distinguir mayúsculas ni espacios). Las de otro contacto las pide HU-025.
  v_destino := coalesce(
    (select l.correo from public.lead l where l.id = v_id_lead),
    (select p.contacto from public.pago p where p.id_monitoria = p_id_monitoria order by p.fecha_pago, p.id limit 1)
  );

  update public.solicitud_llave s
  set en_correo_de_cancelacion = true
  from public.reembolso r
  join public.pago p on p.id = r.id_pago
  where s.id_reembolso = r.id
    and r.id = any (v_nuevos)
    and lower(btrim(p.contacto)) = lower(btrim(v_destino));

  v_a_otro_contacto := exists (
    select 1 from public.solicitud_llave s
    where s.id_reembolso = any (v_nuevos) and not s.en_correo_de_cancelacion
  );
  -- P-07: un pago todavía en revisión puede aprobarse después; el correo avisa que entonces se pide la llave.
  v_con_pago_en_revision := exists (
    select 1 from public.pago p where p.id_monitoria = p_id_monitoria and p.estado = 'en_revision'
  );

  insert into public.cancelacion_cita (id_monitoria, correo_destino, con_pago_en_revision, reembolso_a_otro_contacto)
  values (p_id_monitoria, v_destino, v_con_pago_en_revision, v_a_otro_contacto)
  on conflict on constraint cancelacion_cita_id_monitoria_key do nothing;

  -- El pedido a la app nunca tumba la cancelación: si Vault o pg_net fallan (por ejemplo, una dirección mal escrita), la
  -- cancelación queda anotada y pg_cron la vuelve a pedir.
  begin
    perform privado.disparar_cancelaciones_cita();
  exception when others then
    raise warning 'calibra: no se pudo pedir el correo de cancelación de la cita (%): %', sqlstate, sqlerrm;
  end;

  return 'cancelada';
end;
$$;

comment on function privado.cancelar_cita(uuid, timestamptz) is
  'Cancela una individual confirmada dentro del plazo (RN-60), con reembolso por cada pago aprobado (D-26, D-28) y el correo anotado (D-27). Sin control de dueño: lo hacen las puertas. HU-024.';

revoke all on function privado.cancelar_cita(uuid, timestamptz) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Puerta 1: el enlace del correo de confirmación (servidor)
-- ---------------------------------------------------------------------------
-- El token es el de HU-019 (`confirmacion_cita.token`). Uno inventado o mal formado no coincide con ninguno: `no_existe`.
create or replace function privado.cancelar_cita_por_token(p_token text)
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
  return privado.cancelar_cita(v_id_monitoria, now());
end;
$$;

revoke all on function privado.cancelar_cita_por_token(text) from public, anon, authenticated, service_role;
grant execute on function privado.cancelar_cita_por_token(text) to service_role;

-- La puerta en la Data API, con los permisos de quien llama: solo la llave secreta (service_role), que ya comprobó la forma
-- del token. Sin ella, adivinar tokens sería cosa de cualquiera.
create or replace function public.cancelar_cita_por_token(p_token text)
returns text
language sql
volatile
security invoker
set search_path = ''
as $$
  select privado.cancelar_cita_por_token(p_token);
$$;

comment on function public.cancelar_cita_por_token(text) is
  'El Lead cancela su individual confirmada con el enlace del correo (P-04). Solo para el servidor (service_role). HU-024.';

revoke all on function public.cancelar_cita_por_token(text) from public, anon, authenticated, service_role;
grant execute on function public.cancelar_cita_por_token(text) to service_role;

-- ---------------------------------------------------------------------------
-- Puerta 2: la sesión del Lead
-- ---------------------------------------------------------------------------
-- Solo si la cita es del Lead de la sesión (privado.es_mi_lead: la que agendó, la cuenta de Estudiante o una que confirmó el
-- correo, HU-068). Si no es suya, no existe o no hay sesión, `no_existe`: no se dice cuál de las tres.
create or replace function privado.cancelar_mi_cita(p_id_monitoria uuid)
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
  return privado.cancelar_cita(p_id_monitoria, now());
end;
$$;

revoke all on function privado.cancelar_mi_cita(uuid) from public, anon, authenticated, service_role;
grant execute on function privado.cancelar_mi_cita(uuid) to authenticated;

-- La puerta en la Data API, con los permisos de quien llama. Solo con sesión: la anónima del Lead es authenticated.
create or replace function public.cancelar_mi_cita(p_id_monitoria uuid)
returns text
language sql
volatile
security invoker
set search_path = ''
as $$
  select privado.cancelar_mi_cita(p_id_monitoria);
$$;

comment on function public.cancelar_mi_cita(uuid) is
  'El Lead de la sesión cancela su individual confirmada hasta 12 h antes (RN-60). HU-024.';

revoke all on function public.cancelar_mi_cita(uuid) from public, anon, authenticated, service_role;
grant execute on function public.cancelar_mi_cita(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- P-07: el pago que se aprueba después de cancelar también se reembolsa
-- ---------------------------------------------------------------------------
-- Si el admin aprueba un pago cuando el estudiante ya canceló (individual, motivo `estudiante`), el dinero se devuelve: el
-- reembolso nace en `esperando_llave` con el primer admin activo (o sin admin, D-28) y su solicitud de llave con
-- `en_correo_de_cancelacion = false` (la pide HU-025). Un pago rechazado nunca tiene reembolso (RN-43). Escrita para que
-- HU-030 sume el caso `monitor_no_asistio` con su propio motivo (D-37).
create or replace function privado.reembolsar_pago_aprobado_tarde()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.monitoria m
    where m.id = new.id_monitoria
      and m.estado = 'cancelada'
      and m.motivo_cancelacion = 'estudiante'
      and not exists (select 1 from public.monitoria_grupal g where g.id_monitoria = m.id)
  ) then
    return null;
  end if;

  insert into public.reembolso (id_pago, id_admin, monto, motivo)
  values (new.id, privado.siguiente_admin_activo(), new.monto, 'Cancelaste la monitoría dentro del plazo.')
  on conflict on constraint reembolso_id_pago_key do nothing;
  return null;
end;
$$;

revoke all on function privado.reembolsar_pago_aprobado_tarde() from public, anon, authenticated, service_role;

drop trigger if exists pago_reembolsa_cancelacion on public.pago;
create trigger pago_reembolsa_cancelacion
  after update of estado on public.pago
  for each row
  when (old.estado = 'en_revision' and new.estado = 'aprobado')
  execute function privado.reembolsar_pago_aprobado_tarde();

-- ---------------------------------------------------------------------------
-- D-28: asignar los reembolsos que quedaron sin admin
-- ---------------------------------------------------------------------------
-- Los reembolsos abiertos (esperando la llave o pendientes) sin admin pasan al primer admin activo. Devuelve cuántos
-- asignó; sin ningún admin activo no hace nada (0). La corre pg_cron cada 5 minutos.
create or replace function privado.asignar_reembolsos_sin_admin()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_admin uuid := privado.siguiente_admin_activo();
  v_asignados integer;
begin
  if v_admin is null then
    return 0;
  end if;

  update public.reembolso
  set id_admin = v_admin
  where id_admin is null and estado in ('esperando_llave', 'pendiente');
  get diagnostics v_asignados = row_count;
  return v_asignados;
end;
$$;

comment on function privado.asignar_reembolsos_sin_admin() is
  'D-28: asigna al primer admin activo los reembolsos abiertos que quedaron sin admin. La corre pg_cron cada 5 minutos. HU-024.';

revoke all on function privado.asignar_reembolsos_sin_admin() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Lo que la app necesita para escribir el correo
-- ---------------------------------------------------------------------------
-- Con los permisos de quien llama: solo la llave secreta (service_role), que lee esas tablas. Sin filas si la monitoría no
-- tiene una cancelación anotada. Trae el estado, el motivo y si es grupal para que la app decida si el correo sigue valiendo
-- (cancelada por el estudiante, individual y con a quién escribirle) antes de mandar nada; el inicio y los nombres, para el
-- texto; y el token de la cita (`confirmacion_cita.token`, nulo si no hay) para el botón «Ver mi cita». Nada del contacto
-- del monitor, ni comisión (P-37). El correo de destino y las banderas son la foto de cuando se canceló.
create or replace function public.datos_de_cancelacion_cita(p_id_monitoria uuid)
returns table (
  creada_en timestamptz,
  correo_destino text,
  con_pago_en_revision boolean,
  reembolso_a_otro_contacto boolean,
  estado public.estado_monitoria,
  motivo_cancelacion public.motivo_cancelacion,
  grupal boolean,
  nombre_lead text,
  nombre_materia text,
  inicio timestamptz,
  token_cita text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    c.creada_en,
    c.correo_destino,
    c.con_pago_en_revision,
    c.reembolso_a_otro_contacto,
    m.estado,
    m.motivo_cancelacion,
    g.id_monitoria is not null,
    l.nombre,
    ma.nombre,
    public.inicio_sesion(m.fecha, f.hora),
    (select cc.token from public.confirmacion_cita cc where cc.id_monitoria = m.id)
  from public.cancelacion_cita c
  join public.monitoria m on m.id = c.id_monitoria
  join public.franja f on f.id = m.id_franja
  join public.materia ma on ma.id = m.id_materia
  join public.lead l on l.id = m.id_lead
  left join public.monitoria_grupal g on g.id_monitoria = m.id
  where c.id_monitoria = p_id_monitoria;
$$;

comment on function public.datos_de_cancelacion_cita(uuid) is
  'Datos del correo de cancelación de una cita (D-27). Solo para el servidor (service_role). HU-024.';

revoke all on function public.datos_de_cancelacion_cita(uuid) from public, anon, authenticated, service_role;
grant execute on function public.datos_de_cancelacion_cita(uuid) to service_role;

-- Los reembolsos de esa monitoría cuya llave pide el correo de cancelación (D-27), con el token de su enlace, del más
-- antiguo al más reciente. La app arma con ellos los enlaces `/reembolso?token=...`.
create or replace function public.llaves_de_cancelacion(p_id_monitoria uuid)
returns table (id_reembolso uuid, monto integer, token text)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.id, r.monto, s.token
  from public.pago p
  join public.reembolso r on r.id_pago = p.id
  join public.solicitud_llave s on s.id_reembolso = r.id
  where p.id_monitoria = p_id_monitoria
    and s.en_correo_de_cancelacion
  order by r.fecha_generacion, r.id;
$$;

comment on function public.llaves_de_cancelacion(uuid) is
  'Reembolsos y tokens de llave que el correo de cancelación de una cita pide (D-27). Solo para el servidor (service_role). HU-024.';

revoke all on function public.llaves_de_cancelacion(uuid) from public, anon, authenticated, service_role;
grant execute on function public.llaves_de_cancelacion(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Los trabajos de pg_cron
-- ---------------------------------------------------------------------------
-- cron.schedule con el mismo nombre reemplaza el trabajo: reaplicar la migración no lo duplica.
select cron.schedule('calibra-avisar-cancelaciones', '*/5 * * * *', 'select privado.disparar_cancelaciones_cita()');
select cron.schedule('calibra-asignar-reembolsos', '*/5 * * * *', 'select privado.asignar_reembolsos_sin_admin()');
