-- Reasignar los pagos en revisión de un admin que se desactiva. HU-074.
--
-- RN-07: los admins revisan pagos, reembolsos y reportes por turnos según `orden_revision`. RN-42: un admin tiene una
-- hora para revisar cada pago, contada desde `fecha_asignacion`. RN-23: a un admin se le desactiva, nunca se le borra.
-- P-44 (HU-054): al desactivarlo, sus reembolsos y reportes abiertos pasan al siguiente admin activo. D-35
-- (2-oct-2026) pasó HU-074 a Lista: sus pagos en revisión también pasan. Deja atrás el supuesto (4) de HU-054, que los
-- dejaba con el desactivado hasta que escalaran por RN-42.
--
-- Supuestos del registro de HU-074 (por confirmar con dvarela5101):
--   (1) nadie recibe correo por la reasignación: quien desactiva ve a quién pasaron los casos y quien los recibe los ve
--       en su bandeja;
--   (2) el pago reasignado empieza una hora nueva (fecha_asignacion = now()) y en la bandeja de quien lo recibe queda
--       detrás de los que ya tenía, porque se ordena por fecha_asignacion;
--   (3) casos_abiertos sigue siendo un solo número, que ahora suma los pagos en revisión;
--   (4) los pagos aprobados o rechazados se quedan con el admin desactivado (RN-23).
--
-- Criterio 3, un pago que se crea mientras se desactiva su admin. desactivarCuenta() (HU-004) reasigna en la base y
-- después banea por la API de Auth, en otra transacción: entre las dos el admin sigue activo y registrar_pago lo puede
-- elegir. Se cierra así:
--   * un candado de transacción con la clave hashtextextended('turno_de_admins', 0);
--   * privado.registrar_pago lo toma compartido justo antes de elegir al admin: dos pagos no se esperan entre sí;
--   * privado.reasignar_casos_de_admin lo toma exclusivo antes de todo: espera a que confirmen los pagos que ya
--     eligieron (y así los mueve) y, mientras dura, ningún pago elige;
--   * desactivarCuenta() vuelve a reasignar después del baneo: lo que eligió al admin entre la primera reasignación y
--     el baneo pasa en esa segunda vuelta.
-- Las dos funciones deben usar exactamente la misma clave: con claves distintas el candado no cierra nada. Si el
-- servidor se cae entre el baneo y la segunda reasignación, los pagos de esa ventana quedan con el desactivado y se
-- ven en sus casos abiertos.
--
-- Se redefinen desde la versión de main y cada una dice qué cambió: privado.reasignar_casos_de_admin y
-- privado.equipo_de_admins (de 20261001074954_equipo_de_admins.sql) y privado.registrar_pago (de
-- 20261002063603_expirar_reservas.sql). Las puertas públicas no cambian; de public.reasignar_casos_de_admin solo
-- cambia el comentario. No se tocan privado.siguiente_admin_activo ni privado.registrar_pago_de_la_sesion.
-- Idempotente.

-- ---------------------------------------------------------------------------
-- Reasignar los casos abiertos de un admin (P-44, HU-074)
-- ---------------------------------------------------------------------------
-- privado.reasignar_casos_de_admin de 20261001074954_equipo_de_admins.sql. Dos cambios; la firma, el destino (un solo
-- admin, el siguiente activo), el error sin_otro_admin y los permisos no cambian:
--   1. (Criterio 3) Toma el candado del turno en exclusivo como primera sentencia.
--   2. (Criterio 1) Sus pagos en revisión también son casos abiertos: cuentan para saber si hay algo que mover, pasan
--      al destino con fecha_asignacion = now() y se suman al total que devuelve.
-- Pasa sus reembolsos activos (esperando la llave o pendientes), sus reportes en revisión y sus pagos en revisión al
-- siguiente admin activo. Devuelve cuántos casos movió. Si no tiene casos abiertos, no hace nada (0). Si los tiene y no
-- hay otro admin activo que los reciba, falla: mejor no desactivar que dejar casos sin dueño.
create or replace function privado.reasignar_casos_de_admin(p_id_admin uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_destino uuid;
  v_reembolsos integer;
  v_reportes integer;
  v_pagos integer;
begin
  -- Criterio 3: antes de mirar nada. Espera a que confirmen los pagos que ya eligieron admin, así que el exists y el
  -- UPDATE de abajo los ven; mientras dura, registrar_pago no elige. La clave tiene que ser exactamente la misma que
  -- usa privado.registrar_pago.
  perform pg_advisory_xact_lock(hashtextextended('turno_de_admins', 0));

  if not exists (
    select 1 from public.reembolso where id_admin = p_id_admin and estado in ('esperando_llave', 'pendiente')
    union all
    select 1 from public.reporte_inasistencia where id_admin = p_id_admin and estado = 'en_revision'
    union all
    select 1 from public.pago where id_admin = p_id_admin and estado = 'en_revision'
  ) then
    return 0;
  end if;

  v_destino := privado.siguiente_admin_activo(p_id_admin);
  if v_destino is null then
    raise exception 'No hay otro admin activo que reciba los casos abiertos.' using errcode = 'P0001', hint = 'sin_otro_admin';
  end if;

  update public.reembolso set id_admin = v_destino
  where id_admin = p_id_admin and estado in ('esperando_llave', 'pendiente');
  get diagnostics v_reembolsos = row_count;

  update public.reporte_inasistencia set id_admin = v_destino
  where id_admin = p_id_admin and estado = 'en_revision';
  get diagnostics v_reportes = row_count;

  -- RN-42: quien lo recibe empieza una hora nueva. fecha_pago (cuándo llegó el comprobante) no cambia, y los pagos
  -- aprobados o rechazados se quedan con este admin (RN-23).
  update public.pago set id_admin = v_destino, fecha_asignacion = now()
  where id_admin = p_id_admin and estado = 'en_revision';
  get diagnostics v_pagos = row_count;

  return v_reembolsos + v_reportes + v_pagos;
end;
$$;

revoke all on function privado.reasignar_casos_de_admin(uuid) from public, anon, authenticated, service_role;
grant execute on function privado.reasignar_casos_de_admin(uuid) to service_role;

comment on function public.reasignar_casos_de_admin(uuid) is
  'P-44: pasa los casos abiertos de un admin (reembolsos, reportes y pagos en revisión) al siguiente activo. Solo service_role, antes y después de banearlo. HU-054, HU-074.';

-- ---------------------------------------------------------------------------
-- La pantalla del equipo: los casos abiertos cuentan los pagos (criterio 2)
-- ---------------------------------------------------------------------------
-- privado.equipo_de_admins de 20261001074954_equipo_de_admins.sql. Un cambio: casos_abiertos suma también los pagos en
-- revisión del admin, los mismos que mueve reasignar_casos_de_admin. Las columnas, el filtro (solo un admin activo) y
-- los permisos no cambian; public.equipo_de_admins, que la llama, tampoco.
create or replace function privado.equipo_de_admins()
returns table (id uuid, nombre text, correo text, orden_revision integer, activo boolean, casos_abiertos integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    a.id,
    a.nombre,
    a.correo,
    a.orden_revision,
    privado.admin_activo(a.id),
    (
      (select count(*) from public.reembolso r where r.id_admin = a.id and r.estado in ('esperando_llave', 'pendiente'))
      + (select count(*) from public.reporte_inasistencia ri where ri.id_admin = a.id and ri.estado = 'en_revision')
      + (select count(*) from public.pago p where p.id_admin = a.id and p.estado = 'en_revision')
    )::integer
  from public.admin a
  where (select privado.es_admin())
  order by a.orden_revision;
$$;

revoke all on function privado.equipo_de_admins() from public, anon, authenticated, service_role;
grant execute on function privado.equipo_de_admins() to authenticated;

-- ---------------------------------------------------------------------------
-- El pago nuevo no elige admin mientras se reasigna (criterio 3)
-- ---------------------------------------------------------------------------
-- privado.registrar_pago de 20261002063603_expirar_reservas.sql. Un cambio: toma el candado del turno, compartido,
-- justo antes de elegir al admin. La firma, los resultados y los permisos (ningún grant: es la versión interna) no
-- cambian; privado.registrar_pago_de_la_sesion y public.registrar_pago, que la llaman, tampoco.
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

  -- HU-074, criterio 3: compartido, así dos pagos no se esperan entre sí, pero ninguno elige mientras
  -- privado.reasignar_casos_de_admin (que lo toma exclusivo) mueve los casos de un admin que se desactiva. La elección
  -- de abajo ve lo que esa reasignación confirmó. La clave tiene que ser exactamente la misma que usa reasignar.
  perform pg_advisory_xact_lock_shared(hashtextextended('turno_de_admins', 0));

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
