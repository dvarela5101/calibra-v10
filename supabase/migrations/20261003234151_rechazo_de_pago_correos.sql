-- Correos del rechazo de un pago: al monitor y al pagador, sin que se pierdan. HU-076.
--
-- Hoy rechazar un pago avisa al pagador desde la acción del admin, fuera de la transacción (si el correo falla o la
-- acción se corta, nadie se entera), y al monitor no le avisa nadie. Decisiones: D-16 (avisos al monitor), D-11 (el
-- monitor lo ve en su agenda), D-19 (destinatarios), D-38 (el rechazo cancela la cita y el monitor se entera),
-- D-39 d (la cita ya cancelada por el estudiante: correo corto «no hay reembolso») y D-39 e (el correo del pagador
-- queda anotado en la misma transacción del rechazo y se reintenta, HU-065).
--
-- Tres salidas de un rechazo, según cómo esté la monitoría al rechazar:
--   A. Cita futura (confirmada o por pagar): el rechazo la cancela con motivo `pago_rechazado`. Aviso al monitor (si
--      estaba confirmada) y al pagador (`cita_cancelada`, la plantilla pago_rechazado_individual de HU-020).
--   B. La cita ya estaba cancelada por el estudiante (HU-024): solo cambia el pago. Al pagador, `cita_ya_cancelada`
--      (pago_rechazado_sin_reembolso); al monitor nada, porque ya lo avisó la cancelación del estudiante.
--   C. P-24 (realizada, o confirmada que ya empezó): no se cancela nada y no se escribe a nadie; lo contacta el admin.
--
-- Qué construye:
--   1. Monitor: evento `pago_rechazado` en aviso_monitor. privado.anotar_aviso_monitor suma una rama
--      (confirmada -> cancelada con motivo pago_rechazado). La app lo manda por el procesador de HU-051.
--   2. Pagador: public.aviso_rechazo_pago (bandeja de salida, una fila por pago rechazado), el trigger
--      pago_anota_aviso_rechazo que la llena en la misma transacción, privado.disparar_avisos_rechazo_pago (pg_net) y
--      un trabajo de pg_cron cada 5 minutos, como en HU-051.
--   3. privado.revisar_pago cancela la monitoría antes de marcar el pago como rechazado (supuesto 1).
--
-- Supuestos del registro de HU-076 (por confirmar con dvarela5101; no son decisiones D-n):
--   (1) Orden dentro de revisar_pago: hoy marca el pago `rechazado` y después cancela la monitoría. El trigger del pago
--       necesita ver la monitoría ya cancelada para distinguir A de B y C, así que se invierte el orden de esos dos
--       UPDATE (monitoría primero, pago después). Los bloqueos no cambian: la monitoría y el pago ya están bloqueados
--       antes, en ese orden. Alternativa descartada: que el trigger de monitoria anote al pagador leyendo los pagos
--       `rechazado`; depende del orden contrario y deja sin trabajo al trigger del pago en el caso B.
--   (2) El aviso al pagador depende de la monitoría al rechazar: cancelada con motivo `pago_rechazado` (la canceló este
--       rechazo, o ya la había cancelado el rechazo de otro pago de la misma cita: el correo sigue siendo cierto) ->
--       `cita_cancelada`; con motivo `estudiante` -> `cita_ya_cancelada`; cualquier otro caso (P-24, grupal,
--       monitor_no_asistio, diferencia_no_cubierta) -> nada.
--   (3) El aviso al monitor es solo confirmada -> cancelada. Una `pendiente_pago` cancelada por el rechazo (rama
--       defensiva de revisar_pago) avisa al pagador pero no al monitor: D-16 no avisa las reservas por pagar.
--   (4) El aviso al pagador no caduca: la app lo manda aunque la sesión ya haya pasado, hasta 5 intentos.
-- Idempotente.

-- ---------------------------------------------------------------------------
-- Monitor: el evento pago_rechazado (D-16, D-38)
-- ---------------------------------------------------------------------------
alter table public.aviso_monitor drop constraint if exists aviso_monitor_evento_valido;
alter table public.aviso_monitor add constraint aviso_monitor_evento_valido
  check (evento in ('confirmada', 'cancelada', 'pago_rechazado'));

comment on table public.aviso_monitor is
  'Avisos por correo al monitor (D-16): los anota un trigger de monitoria y los manda la app. Eventos: confirmada, cancelada (la cancela el estudiante) y pago_rechazado (D-38). HU-051, HU-076.';

-- privado.anotar_aviso_monitor de 20261001071311_avisos_al_monitor.sql. Solo suma una rama (HU-076): confirmada ->
-- cancelada con motivo `pago_rechazado` anota el evento `pago_rechazado`. Lo demás igual: nada para las grupales,
-- un aviso no se anota dos veces y el pedido a la app nunca tumba el cambio de estado.
create or replace function privado.anotar_aviso_monitor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evento text;
begin
  if old.estado = 'pendiente_pago' and new.estado = 'confirmada' then
    v_evento := 'confirmada';
  elsif old.estado = 'confirmada' and new.estado = 'cancelada' and new.motivo_cancelacion = 'estudiante' then
    v_evento := 'cancelada';
  -- HU-076 (D-38): el rechazo de un pago cancela la cita confirmada y el monitor se entera.
  elsif old.estado = 'confirmada' and new.estado = 'cancelada' and new.motivo_cancelacion = 'pago_rechazado' then
    v_evento := 'pago_rechazado';
  else
    return null;
  end if;

  if exists (select 1 from public.monitoria_grupal g where g.id_monitoria = new.id) then
    return null;
  end if;

  insert into public.aviso_monitor (id_monitoria, evento)
  values (new.id, v_evento)
  on conflict on constraint aviso_monitor_monitoria_evento_key do nothing;

  -- El pedido a la app nunca tumba el cambio de estado: si Vault o pg_net fallan (por ejemplo, una dirección mal
  -- escrita), el aviso queda anotado y pg_cron lo vuelve a pedir.
  begin
    perform privado.disparar_avisos_monitor();
  exception when others then
    raise warning 'calibra: no se pudo pedir el aviso al monitor (%): %', sqlstate, sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function privado.anotar_aviso_monitor() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Pagador: la bandeja de salida (D-39 d, e)
-- ---------------------------------------------------------------------------
create table if not exists public.aviso_rechazo_pago (
  id uuid primary key default gen_random_uuid(),
  id_pago uuid not null references public.pago (id) on delete cascade,
  -- Foto al rechazar: qué correo corresponde. cita_cancelada: la cita la canceló el rechazo (pago_rechazado_individual).
  -- cita_ya_cancelada: ya la había cancelado el estudiante (pago_rechazado_sin_reembolso).
  caso text not null,
  creado_en timestamptz not null default now(),
  -- La app ya lo tomó y lo dejó en `correo_envio` (enviado, fallido para reintentar o descartado), o lo abandonó.
  procesado_en timestamptz,
  -- Corridas en las que no se pudo procesar. La app lo abandona a las 5, para que uno que siempre falla no tape a los demás.
  intentos integer not null default 0,
  constraint aviso_rechazo_pago_caso_valido check (caso in ('cita_cancelada', 'cita_ya_cancelada')),
  constraint aviso_rechazo_pago_intentos_no_negativos check (intentos >= 0),
  -- Un pago se rechaza una sola vez (sin vuelta atrás, §5.2 de HU-020): un aviso por pago.
  constraint aviso_rechazo_pago_id_pago_key unique (id_pago)
);

comment on table public.aviso_rechazo_pago is
  'Avisos por correo al pagador cuando se rechaza su pago: los anota un trigger de pago en la misma transacción del rechazo y los manda la app. HU-076.';

-- Lo que busca el proceso: los que faltan, del más antiguo al más reciente.
create index if not exists aviso_rechazo_pago_pendientes_idx on public.aviso_rechazo_pago (creado_en) where procesado_en is null;

-- Como aviso_monitor: sin políticas, RLS niega todo a anon y authenticated; el trigger inserta (security definer) y la
-- app procesa con la llave secreta, que solo lee y marca `procesado_en` e `intentos`.
alter table public.aviso_rechazo_pago enable row level security;
revoke all on table public.aviso_rechazo_pago from public, anon, authenticated, service_role;
grant select, update (procesado_en, intentos) on table public.aviso_rechazo_pago to service_role;

-- Pedirle a la app que procese los avisos: copia de privado.disparar_avisos_monitor. Solo si hay avisos sin procesar
-- y la configuración está en Vault; devuelve el id de la petición de pg_net, o null si no pidió nada.
create or replace function privado.disparar_avisos_rechazo_pago()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sitio text;
  v_secreto text;
begin
  if not exists (select 1 from public.aviso_rechazo_pago where procesado_en is null) then
    return null;
  end if;

  select decrypted_secret into v_sitio from vault.decrypted_secrets where name = 'calibra_sitio_url';
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'calibra_cron_secreto';
  if coalesce(btrim(v_sitio), '') = '' or coalesce(btrim(v_secreto), '') = '' then
    return null;
  end if;

  return net.http_post(
    url := rtrim(btrim(v_sitio), '/') || '/api/procesos/avisar-rechazos',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Authorization', 'Bearer ' || btrim(v_secreto), 'Content-Type', 'application/json'),
    timeout_milliseconds := 60000
  );
end;
$$;

revoke all on function privado.disparar_avisos_rechazo_pago() from public, anon, authenticated, service_role;

-- El trigger del pago: anota el aviso en la misma transacción del rechazo. Lee la monitoría sin `for update`: quien
-- rechaza (privado.revisar_pago) ya la tiene bloqueada y la canceló antes de marcar el pago (supuesto 1). Las
-- grupales no se avisan (HU-038). P-24 y los demás motivos no escriben nada (supuesto 2).
create or replace function privado.anotar_aviso_rechazo_pago()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_estado public.estado_monitoria;
  v_motivo public.motivo_cancelacion;
  v_caso text;
begin
  select m.estado, m.motivo_cancelacion into v_estado, v_motivo
  from public.monitoria m where m.id = new.id_monitoria;

  if exists (select 1 from public.monitoria_grupal g where g.id_monitoria = new.id_monitoria) then
    return null;
  end if;

  if v_estado = 'cancelada' and v_motivo = 'pago_rechazado' then
    v_caso := 'cita_cancelada';
  elsif v_estado = 'cancelada' and v_motivo = 'estudiante' then
    v_caso := 'cita_ya_cancelada';
  else
    return null;
  end if;

  insert into public.aviso_rechazo_pago (id_pago, caso)
  values (new.id, v_caso)
  on conflict on constraint aviso_rechazo_pago_id_pago_key do nothing;

  -- El pedido a la app nunca tumba el rechazo: si Vault o pg_net fallan, el aviso queda anotado y pg_cron lo vuelve a pedir.
  begin
    perform privado.disparar_avisos_rechazo_pago();
  exception when others then
    raise warning 'calibra: no se pudo pedir el aviso del rechazo (%): %', sqlstate, sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function privado.anotar_aviso_rechazo_pago() from public, anon, authenticated, service_role;

drop trigger if exists pago_anota_aviso_rechazo on public.pago;
create trigger pago_anota_aviso_rechazo
  after update of estado on public.pago
  for each row
  when (old.estado = 'en_revision' and new.estado = 'rechazado')
  execute function privado.anotar_aviso_rechazo_pago();

-- cron.schedule con el mismo nombre reemplaza el trabajo: reaplicar la migración no lo duplica.
select cron.schedule('calibra-avisar-rechazos', '*/5 * * * *', 'select privado.disparar_avisos_rechazo_pago()');

-- ---------------------------------------------------------------------------
-- Revisar el pago: la monitoría se cancela antes de marcar el pago (supuesto 1)
-- ---------------------------------------------------------------------------
-- privado.revisar_pago de 20261003074251_revisar_pago_vencido.sql. Único cambio (HU-076): al rechazar, el UPDATE de la
-- monitoría va antes que el del pago, para que pago_anota_aviso_rechazo la lea cancelada. La firma, los resultados, el
-- orden de los bloqueos y los permisos no cambian. Quien redefina esta función después debe conservar ese orden.
create or replace function privado.revisar_pago(
  p_id_pago uuid,
  p_decision text,
  p_observaciones text default null,
  p_ahora timestamptz default now()
)
returns table (resultado text, cancelo_monitoria boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  -- [[:space:]] y no btrim, que solo quita espacios: unas observaciones de puros saltos de línea no son texto.
  v_observaciones text := nullif(regexp_replace(p_observaciones, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  v_id_monitoria uuid;
  v_estado_monitoria public.estado_monitoria;
  v_fecha date;
  v_hora time;
  v_estado_pago public.estado_pago;
  v_id_admin uuid;
  -- HU-077: desde ella corre la hora del asignado.
  v_fecha_asignacion timestamptz;
  v_ya_empezo boolean;
begin
  cancelo_monitoria := false;

  if v_uid is null then
    resultado := 'sin_sesion';
    return next;
    return;
  end if;
  if not (select privado.es_admin()) then
    resultado := 'sin_permiso';
    return next;
    return;
  end if;

  if p_decision is null or p_decision not in ('aprobar', 'rechazar') then
    resultado := 'decision_invalida';
    return next;
    return;
  end if;
  -- HU-077 (D-39): el largo de las observaciones se mira más abajo, cuando ya se sabe que quien llama puede revisar.

  -- La monitoría del pago, sin candado: hace falta para bloquear en orden. El pago no cambia de monitoría. El admin
  -- y la hora de la asignación también se leen sin candado (como es_mi_lead en registrar_pago): el admin que no puede
  -- revisar recibe no_asignado sin tomar la fila de la monitoría ni esperar a quien la tiene. Se vuelven a mirar ya
  -- bloqueados.
  select p.id_monitoria, p.id_admin, p.fecha_asignacion into v_id_monitoria, v_id_admin, v_fecha_asignacion
  from public.pago p where p.id = p_id_pago;
  if not found then
    resultado := 'no_encontrado';
    return next;
    return;
  end if;
  -- HU-077 (D-38): revisa el asignado o, si ya pasó su hora, cualquier admin activo. P-40: justo en revision_hasta el
  -- pago todavía es solo del asignado. coalesce: sin hora (p_ahora nulo) no se da por pasada.
  if v_id_admin <> v_uid
     and coalesce(public.dentro_de_plazo(public.revision_hasta(v_fecha_asignacion), p_ahora), true) then
    resultado := 'no_asignado';
    return next;
    return;
  end if;
  -- HU-077 (D-39): quien llama puede revisar; el texto se valida antes de bloquear nada.
  if char_length(v_observaciones) > 500 then
    resultado := 'observaciones_invalidas';
    return next;
    return;
  end if;

  -- Primero la monitoría `for update` (en fila con el cierre automático, el monitor que finaliza, registrar_pago y la
  -- cancelación de HU-024)...
  select m.estado, m.fecha, f.hora into v_estado_monitoria, v_fecha, v_hora
  from public.monitoria m
  join public.franja f on f.id = m.id_franja
  where m.id = v_id_monitoria
  for update of m;

  -- ...y después el pago. Dos revisiones a la vez quedan en fila: la segunda lee el estado que dejó la primera. El
  -- estado, el admin y la hora de la asignación se leen ya bloqueados (HU-074 y HU-034 reasignan con una hora nueva).
  select p.estado, p.id_admin, p.fecha_asignacion into v_estado_pago, v_id_admin, v_fecha_asignacion
  from public.pago p
  where p.id = p_id_pago
  for update;
  if not found then
    resultado := 'no_encontrado';
    return next;
    return;
  end if;

  -- HU-077: la misma regla de arriba, con lo que dejó una reasignación que llegó en medio.
  if v_id_admin <> v_uid
     and coalesce(public.dentro_de_plazo(public.revision_hasta(v_fecha_asignacion), p_ahora), true) then
    resultado := 'no_asignado';
    return next;
    return;
  end if;
  -- §5.2: sin vuelta atrás. Aprobar dos veces no cambia fecha_revision.
  if v_estado_pago <> 'en_revision' then
    resultado := 'ya_revisado';
    return next;
    return;
  end if;
  if exists (select 1 from public.monitoria_grupal g where g.id_monitoria = v_id_monitoria) then
    resultado := 'no_individual';
    return next;
    return;
  end if;

  -- F3: si aprueba, todo sigue. Con la cita cancelada por el estudiante, el reembolso lo crea el trigger de HU-024.
  -- HU-077: queda quién aprobó; id_admin sigue siendo el asignado.
  if p_decision = 'aprobar' then
    update public.pago
    set estado = 'aprobado', fecha_revision = p_ahora, id_admin_revisor = v_uid
    where id = p_id_pago;
    resultado := 'aprobado';
    return next;
    return;
  end if;

  -- Rechazar. P-24 (supuesto 2): la realizada y la confirmada que ya empezó (P-40, como finalizar_monitoria).
  v_ya_empezo := v_estado_monitoria = 'realizada'
    or (v_estado_monitoria = 'confirmada'
        and public.plazo_alcanzado(public.inicio_sesion(v_fecha, v_hora), p_ahora));
  if v_ya_empezo and v_observaciones is null then
    resultado := 'observaciones_requeridas';
    return next;
    return;
  end if;

  -- HU-076: la monitoría se cancela antes de marcar el pago para que pago_anota_aviso_rechazo la lea cancelada.
  -- RN-43: la que aún no se realizó se cancela y libera la fecha. pendiente_pago es defensivo: con un pago no debería
  -- existir (registrar_pago la confirma en la misma transacción), y sin cancelarla ocuparía la fecha para siempre,
  -- porque privado.reserva_vencida no vence una reserva que tiene pagos.
  if not v_ya_empezo and v_estado_monitoria in ('confirmada', 'pendiente_pago') then
    update public.monitoria
    set estado = 'cancelada', motivo_cancelacion = 'pago_rechazado'
    where id = v_id_monitoria;
    cancelo_monitoria := true;
  end if;

  -- HU-077: queda quién rechazó; id_admin sigue siendo el asignado.
  update public.pago
  set estado = 'rechazado', fecha_revision = p_ahora, observaciones = v_observaciones, id_admin_revisor = v_uid
  where id = p_id_pago;

  resultado := 'rechazado';
  return next;
end;
$$;

-- Como en HU-020 y HU-077: la versión con p_ahora queda interna, sin grant.
revoke all on function privado.revisar_pago(uuid, text, text, timestamptz) from public, anon, authenticated, service_role;
