-- Bandeja común de pagos y aviso a todos los admins cuando llega uno. HU-034.
--
-- D-56 (10-oct-2026) cambia RN-42: cada pago sigue teniendo un responsable según el orden de revisión (el primer admin
-- activo, como hoy; D-26, D-64), cualquier admin activo lo aprueba o lo rechaza desde el primer minuto, y cuando llega un
-- pago nuevo se avisa por correo a todos los admins activos. No hay hora ni escalamiento. D-70 (14-oct-2026): un pago que
-- nadie revisa no tiene recordatorio.
--
-- Esta migración:
--   1. Redefine privado.revisar_pago (versión vigente: 20261004181723_rechazo_de_pago_correos.sql). Se van las dos
--      comprobaciones de no_asignado (sin candado y con el pago bloqueado) y las lecturas de id_admin y fecha_asignacion
--      que las alimentaban. Las observaciones se validan antes de bloquear. Con el pago bloqueado vuelve a mirar
--      privado.es_admin(): un admin desactivado mientras esperaba el candado recibe sin_permiso, como HU-082 en
--      privado.ejecutar_reembolso (20261004205851_registrar_reembolso_cualquier_admin.sql). Conserva el orden de los
--      bloqueos (monitoría y después pago), id_admin_revisor, P-24, el orden de HU-076 (monitoría antes que pago) y los
--      permisos. La firma no cambia: p_ahora sigue, aunque ya solo fecha la revisión y decide P-24.
--   2. Crea la bandeja de salida public.aviso_pago_nuevo, su trigger sobre pago, el pedido a la app y el trabajo de
--      pg_cron, con el patrón de HU-076 (aviso_rechazo_pago) y privado.disparar_proceso (HU-059), como pide HU-079.
--
-- No toca privado.registrar_pago ni privado.reasignar_casos_de_admin (HU-074): el responsable de un pago nuevo y la
-- reasignación al desactivar un admin siguen igual. pago.fecha_asignacion, revision_min y public.revision_hasta quedan sin
-- uso; quitarlos es otra HU.
--
-- Idempotente.

-- ---------------------------------------------------------------------------
-- 1. Revisar el pago: cualquier admin activo (D-56)
-- ---------------------------------------------------------------------------
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
  -- D-56: quien llama ya es un admin activo, y cualquiera puede revisar: el texto se valida antes de bloquear nada.
  if char_length(v_observaciones) > 500 then
    resultado := 'observaciones_invalidas';
    return next;
    return;
  end if;

  -- La monitoría del pago, sin candado: hace falta para bloquear en orden. El pago no cambia de monitoría.
  select p.id_monitoria into v_id_monitoria
  from public.pago p where p.id = p_id_pago;
  if not found then
    resultado := 'no_encontrado';
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

  -- ...y después el pago. Dos revisiones a la vez quedan en fila: la segunda lee el estado que dejó la primera.
  select p.estado into v_estado_pago
  from public.pago p
  where p.id = p_id_pago
  for update;
  if not found then
    resultado := 'no_encontrado';
    return next;
    return;
  end if;

  -- Un admin desactivado mientras esperaba el candado no revisa (como HU-082): cada sentencia ve su propia foto.
  if not (select privado.es_admin()) then
    resultado := 'sin_permiso';
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
  -- Queda quién aprobó; id_admin sigue siendo el responsable.
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

  -- HU-076: la monitoría se cancela antes de marcar el pago para que pago_anota_aviso_rechazo la lea cancelada. Quien
  -- redefina esta función después debe conservar ese orden.
  -- RN-43: la que aún no se realizó se cancela y libera la fecha. pendiente_pago es defensivo: con un pago no debería
  -- existir (registrar_pago la confirma en la misma transacción), y sin cancelarla ocuparía la fecha para siempre,
  -- porque privado.reserva_vencida no vence una reserva que tiene pagos.
  if not v_ya_empezo and v_estado_monitoria in ('confirmada', 'pendiente_pago') then
    update public.monitoria
    set estado = 'cancelada', motivo_cancelacion = 'pago_rechazado'
    where id = v_id_monitoria;
    cancelo_monitoria := true;
  end if;

  -- Queda quién rechazó; id_admin sigue siendo el responsable.
  update public.pago
  set estado = 'rechazado', fecha_revision = p_ahora, observaciones = v_observaciones, id_admin_revisor = v_uid
  where id = p_id_pago;

  resultado := 'rechazado';
  return next;
end;
$$;

-- Como en HU-020, HU-077 y HU-076: la versión con p_ahora queda interna, sin grant. La usan revisar_pago_de_la_sesion, con
-- now(), y las pruebas, como postgres.
revoke all on function privado.revisar_pago(uuid, text, text, timestamptz) from public, anon, authenticated, service_role;

comment on function public.revisar_pago(uuid, text, text) is
  'Cualquier admin activo aprueba o rechaza un pago en revisión desde que llega (D-56); el responsable sigue en id_admin y quien revisó queda en id_admin_revisor. El rechazo cancela la cita que aún no empezó. HU-020, HU-077, HU-034.';

-- ---------------------------------------------------------------------------
-- 2. El aviso de pago nuevo: bandeja de salida
-- ---------------------------------------------------------------------------
create table if not exists public.aviso_pago_nuevo (
  id uuid primary key default gen_random_uuid(),
  id_pago uuid not null references public.pago (id) on delete cascade,
  -- El destinatario. Sin llave foránea a propósito: con ella, cada pago nuevo tomaría `for key share` sobre varias filas de
  -- admin en una sola sentencia y podría cruzarse con privado.mover_admin, que bloquea todas `for update`. Los admins no
  -- se borran (RN-23) y la cascada del pago limpia estas filas.
  id_admin uuid not null,
  -- Foto del responsable al llegar el pago (pago.id_admin en ese momento), también sin llave. Un correo reintentado
  -- tiene que ser igual al primero, y HU-074 puede reasignar el pago entre los dos.
  id_responsable uuid not null,
  creado_en timestamptz not null default now(),
  -- La app ya lo tomó y lo dejó en `correo_envio` (enviado, fallido para reintentar o descartado), o lo abandonó.
  procesado_en timestamptz,
  -- Corridas en las que no se pudo procesar. La app lo abandona a las 5, para que uno que siempre falla no tape a los demás.
  intentos integer not null default 0,
  constraint aviso_pago_nuevo_intentos_no_negativos check (intentos >= 0),
  constraint aviso_pago_nuevo_pago_admin_key unique (id_pago, id_admin)
);

comment on table public.aviso_pago_nuevo is
  'Avisos por correo a cada admin activo cuando llega un pago a revisión (D-56): los anota un trigger de pago en la misma transacción y los manda la app. HU-034.';

-- Lo que busca el proceso: los que faltan, del más antiguo al más reciente.
create index if not exists aviso_pago_nuevo_pendientes_idx on public.aviso_pago_nuevo (creado_en) where procesado_en is null;

-- Como aviso_rechazo_pago: sin políticas, RLS niega todo a anon y authenticated; el trigger inserta (security definer) y
-- la app procesa con la llave secreta, que solo lee y marca `procesado_en` e `intentos`.
alter table public.aviso_pago_nuevo enable row level security;
revoke all on table public.aviso_pago_nuevo from public, anon, authenticated, service_role;
grant select, update (procesado_en, intentos) on table public.aviso_pago_nuevo to service_role;

-- Pedirle a la app que procese los avisos: solo si hay alguno sin procesar. privado.disparar_proceso mira Vault y devuelve
-- null si no está configurado (en local). Nota de HU-079: no se copia disparar_avisos_rechazo_pago.
create or replace function privado.disparar_avisos_pago_nuevo()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.aviso_pago_nuevo where procesado_en is null) then
    return null;
  end if;
  return privado.disparar_proceso('/api/procesos/avisar-pagos-nuevos');
end;
$$;

revoke all on function privado.disparar_avisos_pago_nuevo() from public, anon, authenticated, service_role;

-- El trigger del pago: en la misma transacción que lo registra (y por tanto bajo el candado del turno que tomó
-- registrar_pago, HU-074), una fila por cada admin activo en ese momento, el responsable incluido. Un pago insertado ya
-- revisado no llega aquí (el `when` del trigger). Las grupales no se avisan (HU-038, D-47).
create or replace function privado.anotar_aviso_pago_nuevo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.monitoria_grupal g where g.id_monitoria = new.id_monitoria) then
    return null;
  end if;

  insert into public.aviso_pago_nuevo (id_pago, id_admin, id_responsable)
  select new.id, a.id, new.id_admin
  from public.admin a
  where privado.admin_activo(a.id)
  on conflict on constraint aviso_pago_nuevo_pago_admin_key do nothing;

  -- El pedido a la app nunca tumba el pago: si Vault o pg_net fallan, los avisos quedan anotados y pg_cron los vuelve a pedir.
  begin
    perform privado.disparar_avisos_pago_nuevo();
  exception when others then
    raise warning 'calibra: no se pudo pedir el aviso del pago nuevo (%): %', sqlstate, sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function privado.anotar_aviso_pago_nuevo() from public, anon, authenticated, service_role;

drop trigger if exists pago_anota_aviso_nuevo on public.pago;
create trigger pago_anota_aviso_nuevo
  after insert on public.pago
  for each row
  when (new.estado = 'en_revision')
  execute function privado.anotar_aviso_pago_nuevo();

-- cron.schedule con el mismo nombre reemplaza el trabajo: reaplicar la migración no lo duplica.
select cron.schedule('calibra-avisar-pagos-nuevos', '*/5 * * * *', 'select privado.disparar_avisos_pago_nuevo()');
