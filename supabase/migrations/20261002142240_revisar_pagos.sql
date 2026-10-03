-- Revisar pagos: aprobar o rechazar. HU-020.
--
-- RN-42: el admin asignado (pago.id_admin) revisa cada pago contra su comprobante; la hora de plazo se muestra, pero
-- escalar el pago vencido es de HU-034. §5.2: enRevision → aprobado o rechazado, sin vuelta atrás.
-- RN-43 y §5.1: si se rechaza el pago de una individual que aún no se realizó, la monitoría pasa de confirmada a
-- cancelada (pago_rechazado) y la fecha queda libre (el índice único y privado.fecha_libre solo cuentan las que no
-- están canceladas). Un pago rechazado no se reembolsa.
-- RN-45: solo los pagos aprobados entran al desembolso; lo aplica HU-028 al ejecutarlo (P-29). Aquí no se toca.
-- P-24: si la monitoría ya se realizó, rechazar su pago no la cancela; el pago queda fuera del desembolso y el admin
-- registra el caso para cobrarlo por fuera o asumirlo (pago.observaciones).
-- P-07 y docs/reparto.md (2-oct-2026): con la cita ya cancelada por el estudiante (HU-024) se aprueba o se rechaza
-- sin error y solo cambia el pago; el reembolso de un pago aprobado lo crea el trigger de HU-024, no esta función.
--
-- Supuestos de HU-020 por confirmar con dvarela5101 (registro de la HU; no son decisiones D-n):
--   1. Solo revisa el admin asignado, aunque se le haya vencido la hora (no hay escalamiento hasta HU-034). Se mira
--      primero sin candado, para que otro admin no tome la fila de la monitoría, y otra vez con la fila del pago ya
--      bloqueada: HU-074 y HU-034 cambian id_admin.
--   2. "Aún no se realizó" se mide también por la hora: una confirmada cuya sesión ya empezó (inicio alcanzado, con
--      el borde inclusivo de P-40, el mismo predicado de finalizar_monitoria) se trata como realizada (P-24).
--   3. El caso de P-24 se registra en la columna nueva pago.observaciones, obligatoria en ese rechazo.
--   7. La revisión es irreversible: un pago que ya no está en_revision no se toca.
--   8. Grupales: no_individual; el criterio 4 queda para HU-038.
-- El correo al pagador (supuesto 4) lo manda el servidor después de la llamada, solo si cancelo_monitoria.
--
-- Bloqueos: primero la monitoría y después el pago, el orden de registrar_pago, finalizar_monitoria y el que debe
-- seguir HU-024. Así un rechazo, el cierre automático, el monitor que finaliza y la cancelación del estudiante quedan
-- en fila sobre la monitoría, y cada uno decide con lo que dejó el anterior.
--
-- Nadie con sesión escribe en pago ni en monitoria: lo hace la función security definer de privado con la identidad
-- de la sesión (auth.uid()). La versión con p_ahora queda interna, sin grant (como registrar_pago tras HU-027); la
-- sesión entra por privado.revisar_pago_de_la_sesion, que usa now().
-- Idempotente.

-- ---------------------------------------------------------------------------
-- Dónde queda registrado el caso de P-24 (supuesto 3)
-- ---------------------------------------------------------------------------
alter table public.pago add column if not exists observaciones text;
alter table public.pago drop constraint if exists pago_observaciones_con_texto;
alter table public.pago add constraint pago_observaciones_con_texto
  check (observaciones is null or (observaciones ~ '[^[:space:]]' and char_length(observaciones) <= 500));
comment on column public.pago.observaciones is
  'Lo que anota el admin al rechazar el pago. Obligatoria cuando la monitoría ya se realizó o ya empezó (P-24): qué se hará con ese cobro, cobrarlo por fuera o asumirlo. HU-020.';

-- ---------------------------------------------------------------------------
-- Revisar el pago
-- ---------------------------------------------------------------------------
-- p_decision: 'aprobar' o 'rechazar'. p_observaciones: opcional (se le quitan los espacios y saltos de línea de los
-- bordes; vacía cuenta como ninguna), salvo al rechazar el pago de una monitoría realizada o ya empezada. Al aprobar
-- no se guardan.
-- Resultado (cancelo_monitoria es true solo cuando el rechazo canceló la cita):
--   aprobado                 el pago quedó aprobado con fecha_revision = ahora. La monitoría no cambia.
--   rechazado                el pago quedó rechazado con fecha_revision = ahora y las observaciones. Según la monitoría:
--                              confirmada sin empezar (o pendiente_pago, que con pago no debería existir): cancelada
--                              por pago_rechazado y la fecha libre (cancelo_monitoria);
--                              realizada o confirmada ya empezada (P-24): no cambia;
--                              cancelada (por el estudiante u otro motivo): no cambia.
--   observaciones_requeridas es el rechazo de P-24 y no vienen observaciones: no se toca nada.
--   observaciones_invalidas  las observaciones pasan de 500 caracteres: no se toca nada.
--   ya_revisado              el pago ya está aprobado o rechazado (un doble clic, otra pestaña): no se toca nada.
--   no_asignado              el pago está asignado a otro admin.
--   no_individual            es el pago de una grupal: su rechazo llega con HU-038 (P-06).
--   no_encontrado            el pago no existe.
--   decision_invalida        p_decision no es aprobar ni rechazar.
--   sin_permiso              quien llama no es un admin activo (un admin desactivado tampoco revisa lo suyo).
--   sin_sesion               no hay sesión.
-- Nunca crea ni toca reembolsos (RN-43; el de P-07 es del trigger de HU-024) ni desembolsos (RN-45, HU-028).
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
  if char_length(v_observaciones) > 500 then
    resultado := 'observaciones_invalidas';
    return next;
    return;
  end if;

  -- La monitoría del pago, sin candado: hace falta para bloquear en orden. El pago no cambia de monitoría. El admin
  -- también se lee sin candado (como es_mi_lead en registrar_pago): otro admin recibe no_asignado sin tomar la fila de
  -- la monitoría ni esperar a quien la tiene. Se vuelve a mirar ya bloqueado.
  select p.id_monitoria, p.id_admin into v_id_monitoria, v_id_admin from public.pago p where p.id = p_id_pago;
  if not found then
    resultado := 'no_encontrado';
    return next;
    return;
  end if;
  if v_id_admin <> v_uid then
    resultado := 'no_asignado';
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
  -- estado y el admin se leen ya bloqueados (HU-074 y HU-034 reasignan).
  select p.estado, p.id_admin into v_estado_pago, v_id_admin
  from public.pago p
  where p.id = p_id_pago
  for update;
  if not found then
    resultado := 'no_encontrado';
    return next;
    return;
  end if;

  if v_id_admin <> v_uid then
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
  if p_decision = 'aprobar' then
    update public.pago
    set estado = 'aprobado', fecha_revision = p_ahora
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

  update public.pago
  set estado = 'rechazado', fecha_revision = p_ahora, observaciones = v_observaciones
  where id = p_id_pago;

  -- RN-43: la que aún no se realizó se cancela y libera la fecha. pendiente_pago es defensivo: con un pago no debería
  -- existir (registrar_pago la confirma en la misma transacción), y sin cancelarla ocuparía la fecha para siempre,
  -- porque privado.reserva_vencida no vence una reserva que tiene pagos.
  if not v_ya_empezo and v_estado_monitoria in ('confirmada', 'pendiente_pago') then
    update public.monitoria
    set estado = 'cancelada', motivo_cancelacion = 'pago_rechazado'
    where id = v_id_monitoria;
    cancelo_monitoria := true;
  end if;

  resultado := 'rechazado';
  return next;
end;
$$;

-- La versión con p_ahora queda interna: ninguna sesión elige la hora de la revisión ni mueve el borde de P-24. La usan
-- revisar_pago_de_la_sesion, con now(), y las pruebas, como postgres.
revoke all on function privado.revisar_pago(uuid, text, text, timestamptz) from public, anon, authenticated, service_role;

-- La que ejecuta la sesión del admin: la misma, con la hora de la base.
create or replace function privado.revisar_pago_de_la_sesion(
  p_id_pago uuid,
  p_decision text,
  p_observaciones text default null
)
returns table (resultado text, cancelo_monitoria boolean)
language sql
volatile
security definer
set search_path = ''
as $$
  select r.resultado, r.cancelo_monitoria
  from privado.revisar_pago(p_id_pago, p_decision, p_observaciones, now()) r;
$$;
comment on function privado.revisar_pago_de_la_sesion(uuid, text, text) is
  'Revisa el pago con la sesión del admin y la hora de la base: privado.revisar_pago sin p_ahora. HU-020.';
revoke all on function privado.revisar_pago_de_la_sesion(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function privado.revisar_pago_de_la_sesion(uuid, text, text) to authenticated;

-- La puerta en la Data API, con los permisos de quien llama. Solo con sesión: service_role no tiene auth.uid().
create or replace function public.revisar_pago(
  p_id_pago uuid,
  p_decision text,
  p_observaciones text default null
)
returns table (resultado text, cancelo_monitoria boolean)
language sql
volatile
security invoker
set search_path = ''
as $$
  select r.resultado, r.cancelo_monitoria
  from privado.revisar_pago_de_la_sesion(p_id_pago, p_decision, p_observaciones) r;
$$;
comment on function public.revisar_pago(uuid, text, text) is
  'El admin asignado aprueba o rechaza un pago en revisión; el rechazo cancela la cita que aún no empezó. HU-020.';
revoke all on function public.revisar_pago(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.revisar_pago(uuid, text, text) to authenticated;
