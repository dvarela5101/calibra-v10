-- Pagar por Llave y adjuntar el comprobante. HU-018.
--
-- RN-40: el Lead transfiere a la llave de la plataforma (configuración del servidor, no de la base) y adjunta el
-- comprobante en la misma página. RN-41: adjuntarlo crea un Pago en en_revision; no hay estado previo. RN-42: el
-- pago se asigna al primer admin activo según orden_revision (privado.siguiente_admin_activo, HU-054), con su fecha
-- de asignación; escalarlo es de HU-034. RN-44: cada pago guarda el nombre y un contacto de quien paga.
-- RN-38: si los pagos no rechazados cubren el valor_total, la monitoría pasa a confirmada sin esperar al admin. El
-- trigger de HU-051 anota entonces el aviso al monitor; aquí no se toca.
-- P-36: el monto no lo escribe el pagador. Es el valor_total de la monitoría (la copia del precio de la franja al
-- agendar, RN-32) y lo pone esta función.
-- P-40: la reserva de 10 minutos se mide al crear el pago, con el reloj de la base y el borde inclusivo:
-- dentro_de_plazo(reserva_hasta(fecha_creacion), ahora), el mismo predicado de agendar y el que usará HU-027.
--
-- Supuestos de HU-018 por confirmar con dvarela5101 (registro de la HU; no son decisiones D-n):
--   3. El pagador es el Lead: solo paga la sesión del Lead de la monitoría (privado.es_mi_lead), y el contacto es un
--      correo que llega normalizado del servidor (normalizarCorreo, como en HU-068).
--   4. Un solo comprobante por monitoría individual: un pago por el valor_total, con un archivo, solo mientras la
--      monitoría está pendiente_pago y la reserva sigue vigente.
--
-- Criterio 7: el comprobante tiene que estar en la carpeta de la sesión que paga, revisado por el servidor (HU-059)
-- y en el bucket. El servidor ya lo comprobó (rutaEsDelUsuario y revisarComprobanteDesdeServidor), pero la base no
-- confía en quien la llama: lo vuelve a mirar con la monitoría bloqueada.
--
-- Nadie con sesión inserta en pago ni actualiza monitoria: lo hace la función security definer de privado con la
-- identidad de la sesión (auth.uid()). La puerta pública le pasa la hora de la base (now()); p_ahora existe solo
-- para probar los bordes del plazo.
-- Idempotente.

-- ---------------------------------------------------------------------------
-- Un comprobante respalda un solo pago (supuesto 4)
-- ---------------------------------------------------------------------------
-- La función lo mira antes de insertar; el índice cierra la carrera de dos pagos con el mismo archivo en el mismo
-- instante. De paso indexa la llave foránea a comprobante_revisado.
create unique index if not exists pago_comprobante_key on public.pago (comprobante);

-- ---------------------------------------------------------------------------
-- Registrar el pago
-- ---------------------------------------------------------------------------
-- Resultado:
--   registrado               se creó el pago (id_pago) en en_revision y, como cubre el valor_total, la monitoría
--                            quedó confirmada (RN-38).
--   ya_pagada                la monitoría ya está confirmada o realizada: un doble envío u otra pestaña que pagó.
--   cancelada                la monitoría está cancelada.
--   vencida                  pasaron los 10 minutos de la reserva (RN-34, P-40): ya no se adjunta el comprobante.
--   no_individual            es una grupal: sus pagos llegan con HU-036 y HU-038.
--   datos_invalidos          el nombre (1 a 120 caracteres) o el correo de contacto no sirven.
--   comprobante_ajeno        el comprobante no está en la carpeta de la sesión que paga.
--   comprobante_sin_revisar  el servidor no lo revisó (HU-059) o lo descartó.
--   comprobante_no_existe    no está en el bucket.
--   comprobante_usado        ya respalda otro pago.
--   sin_admin                no hay ningún admin activo a quien asignarlo: no se crea nada.
--   no_es_tuya               la monitoría no existe o no es del Lead de la sesión (no se dice cuál de las dos). El
--                            monitor o un admin de esa monitoría también reciben no_es_tuya: solo el Lead paga.
--   sin_sesion               no hay sesión.
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

  -- `for update`: dos envíos a la vez (un doble clic, dos pestañas) quedan en fila y el segundo ve lo que dejó el
  -- primero. La cancelación de la reserva vencida (HU-027) bloquea la misma fila: solo gana uno.
  select m.id_lead, m.estado, m.fecha_creacion, m.valor_total
    into v_id_lead, v_estado, v_fecha_creacion, v_valor_total
  from public.monitoria m
  where m.id = p_id_monitoria
  for update;
  if not found or not privado.es_mi_lead(v_id_lead) then
    resultado := 'no_es_tuya';
    return next;
    return;
  end if;

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
    resultado := 'cancelada';
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

comment on function privado.registrar_pago(uuid, text, text, text, timestamptz) is
  'Crea el pago en revisión del Lead de la sesión, asignado al primer admin activo, y confirma la monitoría (RN-38). p_ahora solo para las pruebas. HU-018.';

revoke all on function privado.registrar_pago(uuid, text, text, text, timestamptz) from public, anon, authenticated, service_role;
grant execute on function privado.registrar_pago(uuid, text, text, text, timestamptz) to authenticated;

-- La puerta en la Data API, con los permisos de quien llama y la hora de la base. Solo con sesión: la anónima del
-- Lead es authenticated. service_role no la necesita: sin sesión no hay Lead.
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
  from privado.registrar_pago(p_id_monitoria, p_comprobante, p_nombre, p_contacto, now()) r;
$$;

comment on function public.registrar_pago(uuid, text, text, text) is
  'El Lead de la sesión registra el pago por Llave de su monitoría individual con el comprobante que subió. HU-018.';

revoke all on function public.registrar_pago(uuid, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.registrar_pago(uuid, text, text, text) to authenticated;
