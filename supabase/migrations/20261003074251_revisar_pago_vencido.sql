-- Revisar un pago que el admin asignado no revisó a tiempo. HU-077.
--
-- RN-42: el admin asignado (pago.id_admin) tiene una hora para revisar cada pago, contada desde fecha_asignacion
-- (public.revision_hasta). HU-020 dejaba revisar solo al asignado, aunque se le hubiera pasado la hora. D-38
-- (2-oct-2026), punto (b): pasada esa hora, cualquier admin activo puede aprobarlo o rechazarlo, y queda registrado
-- quién lo revisó. Que el pago pase solo al siguiente admin sigue siendo de HU-034.
-- D-39 (revisión del PR #32): quién puede revisar se comprueba antes que el texto de las observaciones.
--
-- Supuestos del registro de HU-077 (por confirmar con dvarela5101; no son decisiones D-n):
--   (1) la hora del asignado pasa en revision_hasta(fecha_asignacion), con el borde de P-40: justo en ese instante el
--       pago todavía es solo del asignado; un microsegundo después, de cualquier admin activo;
--   (2) la bandeja muestra a los demás admins los pagos vencidos (va en el servidor, no aquí);
--   (3) quien revisa queda en la columna nueva pago.id_admin_revisor; a los pagos ya revisados con HU-020 se les pone
--       el asignado, que era el único que podía revisarlos;
--   (4) revisar el pago de otro no lo reasigna: id_admin sigue siendo el asignado (reasignar es de HU-034);
--   (5) el asignado puede seguir revisándolo después de su hora, como en HU-020.
--
-- Diseño: se redefine privado.revisar_pago desde su versión de main (20261002142240_revisar_pagos.sql) y se dice qué
-- cambió. Quién puede revisar se mira sin candado (un admin que no puede no toma la fila de la monitoría ni espera a
-- quien la tiene) y otra vez con la fila del pago bloqueada: HU-074 y HU-034 cambian id_admin y fecha_asignacion. Dos
-- admins que revisan a la vez quedan en fila sobre la monitoría, como en HU-020: el segundo lee el pago ya revisado y
-- responde ya_revisado (criterio 4).
-- privado.revisar_pago_de_la_sesion y public.revisar_pago no se redefinen; de public.revisar_pago solo cambia el
-- comentario.
-- Idempotente.

-- ---------------------------------------------------------------------------
-- Quién revisó el pago (criterio 3, supuesto 3)
-- ---------------------------------------------------------------------------
-- Sin restricción que la ate al estado: otras pruebas insertan pagos ya revisados sin ella, y la única que la escribe
-- es privado.revisar_pago. Apunta a admin, que nunca se borra (RN-23). La lectura sigue la de la tabla: solo admins.
alter table public.pago add column if not exists id_admin_revisor uuid references public.admin (id);
create index if not exists pago_id_admin_revisor_idx on public.pago (id_admin_revisor);
comment on column public.pago.id_admin_revisor is
  'El admin que aprobó o rechazó el pago. Puede ser distinto del asignado (id_admin) cuando revisó otro admin después de la hora de este (D-38). Nula mientras el pago está en revisión. HU-077.';

-- Supuesto 3: con HU-020 solo revisaba el asignado, así que los pagos ya revisados quedan con él. Solo toca los que no
-- tienen revisor: reaplicada no cambia nada.
update public.pago set id_admin_revisor = id_admin
where estado <> 'en_revision' and id_admin_revisor is null;

-- ---------------------------------------------------------------------------
-- Revisar el pago (D-38)
-- ---------------------------------------------------------------------------
-- privado.revisar_pago de 20261002142240_revisar_pagos.sql. Tres cambios, marcados con HU-077; la firma, los demás
-- resultados (P-24, cancelar la cita, ya_revisado, no_individual), el orden de los bloqueos (la monitoría y después
-- el pago) y los permisos no cambian:
--   1. (Criterio 1, supuestos 1 y 5) Revisa el asignado o, pasada su hora, cualquier admin activo: que quien llama es
--      un admin activo ya lo dice es_admin(), al principio. Se mira sin candado y otra vez con la fila del pago
--      bloqueada, las dos veces con id_admin y fecha_asignacion.
--   2. (D-39) observaciones_invalidas se responde después de saber que quien llama puede revisar: el que no puede
--      recibe no_asignado sin que importe el texto. El texto se sigue validando antes de bloquear nada.
--   3. (Criterio 3, supuesto 4) Al aprobar y al rechazar guarda id_admin_revisor = quien llama. id_admin no cambia.
-- Con esto no_asignado quiere decir: el pago es de otro admin y su hora todavía no pasa (o, ya con la fila bloqueada,
-- se lo reasignaron con una hora nueva). Un pago que no existe responde no_encontrado aunque las observaciones pasen
-- de 500 caracteres.
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

  -- HU-077: queda quién rechazó; id_admin sigue siendo el asignado.
  update public.pago
  set estado = 'rechazado', fecha_revision = p_ahora, observaciones = v_observaciones, id_admin_revisor = v_uid
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

-- Como en HU-020: la versión con p_ahora queda interna, sin grant. La usan revisar_pago_de_la_sesion, con now(), y las
-- pruebas, como postgres.
revoke all on function privado.revisar_pago(uuid, text, text, timestamptz) from public, anon, authenticated, service_role;

-- La puerta no cambia; su comentario sí, porque ya no revisa solo el asignado.
comment on function public.revisar_pago(uuid, text, text) is
  'El admin asignado, o cualquier admin activo cuando ya pasó la hora del asignado (D-38), aprueba o rechaza un pago en revisión; el rechazo cancela la cita que aún no empezó. HU-020, HU-077.';
