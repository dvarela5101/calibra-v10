-- El admin asignado resuelve un reporte de inasistencia: lo acepta o lo rechaza con observaciones. HU-030.
--
-- RN-62 (el admin gestiona el caso, sin plazo de resolución), RN-63 (los reportes no tienen escalamiento), RN-64, RN-65 (el
-- reporte aceptado cancela la monitoría aunque ya estuviera realizada), RN-60 y RN-61 (el reembolso es el pago completo) y RN-83
-- (con un reporte en revisión o aceptado el desembolso no se ejecuta); flujos F4 y F5. P-07, P-28, P-37, P-44, D-26, D-27, D-28,
-- D-37, D-38, D-39, D-40 y D-48. Hasta ahora nada escribía `aceptado`, `rechazado`, `anulado` ni `monitor_no_asistio`: HU-029
-- creó el reporte y sus columnas de decisión, HU-028 el bloqueo del desembolso, HU-025 el pedido de llave que dice «aceptamos el
-- reporte» y HU-080 la reanudación de las invitaciones a reseñar al rechazar. Esta migración suma lo que escribe.
--
-- Redefine tres piezas de otras HUs, cada una partiendo de su última versión en `main` (se comprobó con `grep` en
-- supabase/migrations y con pg_get_functiondef en la base local al 5-oct-2026):
--   * el check `aviso_monitor_evento_valido`, de 20261004181723_rechazo_de_pago_correos.sql (HU-076, que le sumó
--     `pago_rechazado` a los dos de HU-051): suma `inasistencia_aceptada`;
--   * privado.anotar_aviso_monitor, de 20261004181723_rechazo_de_pago_correos.sql (HU-076; no la de
--     20261001071311_avisos_al_monitor.sql, que quedó superada y no trae `pago_rechazado`): suma una rama y conserva la de
--     `pago_rechazado`;
--   * privado.reembolsar_pago_aprobado_tarde, de 20261002173529_cancelar_cita.sql (HU-024, la única que la define): suma el
--     caso `monitor_no_asistio`. El trigger pago_reembolsa_cancelacion no cambia.
-- Si una rama integra otra migración que redefina alguna de las tres, hay que partir de esa versión.
--
-- Supuestos del registro de HU-030 (por confirmar con dvarela5101; no son decisiones D-n). Los que toca la base:
--   1. Solo el admin asignado resuelve el reporte (no_asignado para los demás). No se guarda quién resolvió: es id_admin, porque
--      un reporte decidido no se reasigna (P-44 solo mueve los `en_revision`). Sin columna nueva.
--   2. Las observaciones son un solo campo (reporte_inasistencia.observaciones, de hasta 500 caracteres, el check de HU-029).
--      Si se acepta, las lee quien pagó con el pedido de llave porque van en reembolso.motivo; si se rechaza, las lee el Lead
--      en su cita. Opcionales en las dos decisiones.
--   3. Aceptar y rechazar son definitivas (ya_decidido): hay un solo reporte por monitoría y uno rechazado no se repite.
--   4. Aceptar cancela la monitoría aunque ya estuviera `realizada`; fecha_finalizacion se conserva como rastro.
--   5. Los reembolsos nacen con el primer admin activo (D-26), no con quien decide; sin admin activo nacen sin admin (D-28).
--   6. El motivo del reembolso sale de una sola función, privado.motivo_de_inasistencia: la usan la decisión y el trigger de
--      P-07, así que un pago aprobado antes o después de aceptar dice lo mismo.
--   7. Un pago `rechazado` nunca se reembolsa (RN-43); uno `en_revision` recibe su reembolso cuando se apruebe (P-07).
--   9. Un desembolso ya `desembolsado` no se toca: el dinero ya salió. La decisión se guarda igual.
--  13. Rechazar no mira el estado de la monitoría; aceptar exige `confirmada` o `realizada` (no_aceptable si no).
--  14. Con p_ahora nulo se usa now().
--  15. Los reportes de las monitorías grupales no se resuelven aquí (no_individual): llegan con HU-045.
--
-- Diseño:
--   * Quién puede se mira antes que el texto (D-39, como en HU-077): sesión, admin activo, decisión, reporte, asignado y
--     después el largo de las observaciones, con una lectura sin candado. Así un admin que no es el asignado no se entera de
--     nada ni espera a nadie.
--   * Candados, en el orden que dejó escrito HU-029: la monitoría `for update` (no `for no key update`: así choca con el
--     `for key share` de la llave foránea al insertar un pago, como reportar_inasistencia y ejecutar_desembolso), después el
--     reporte `for update` y, si se acepta, sus pagos `order by id for update`. El desembolso lo toma el UPDATE, después.
--     revisar_pago, ejecutar_desembolso, finalizar_monitoria, cancelar_cita y cerrar_caso_p24 toman la monitoría primero:
--     dos de ellas a la vez quedan en fila y no forman ciclo. Bajo el candado se vuelven a mirar el admin activo, el estado
--     del reporte y el asignado (un admin desactivado, una decisión o una reasignación pudieron llegar en medio).
--   * Nadie con sesión escribe en estas tablas (authenticated solo tiene `select`): lo hace la función security definer de
--     privado con la identidad de la sesión (auth.uid()). La versión con p_ahora queda interna, sin grant (como
--     ejecutar_reembolso y revisar_pago); la sesión entra por privado.resolver_reporte_inasistencia_de_la_sesion, con now(),
--     desde public.resolver_reporte_inasistencia.
--   * No manda correos: el aviso al monitor lo anota el trigger de la monitoría (evento nuevo `inasistencia_aceptada`) y los
--     del pagador (solicitud y pedido de llave) los anotan los triggers de reembolso. La app los manda por sus procesadores.
-- Idempotente.

-- ---------------------------------------------------------------------------
-- Monitor: el evento inasistencia_aceptada (D-37)
-- ---------------------------------------------------------------------------
alter table public.aviso_monitor drop constraint if exists aviso_monitor_evento_valido;
alter table public.aviso_monitor add constraint aviso_monitor_evento_valido
  check (evento in ('confirmada', 'cancelada', 'pago_rechazado', 'inasistencia_aceptada'));

comment on table public.aviso_monitor is
  'Avisos por correo al monitor (D-16): los anota un trigger de monitoria y los manda la app. Eventos: confirmada, cancelada (la cancela el estudiante), pago_rechazado (D-38) e inasistencia_aceptada (D-37). HU-051, HU-076, HU-030.';

-- privado.anotar_aviso_monitor de 20261004181723_rechazo_de_pago_correos.sql. Solo suma una rama (HU-030): confirmada o
-- realizada -> cancelada con motivo `monitor_no_asistio` anota el evento `inasistencia_aceptada`. Lo demás igual: nada para
-- las grupales, un aviso no se anota dos veces y el pedido a la app nunca tumba el cambio de estado. Cualquier UPDATE que
-- lleve una monitoría confirmada o realizada a cancelada por monitor_no_asistio anota el aviso, lo haga la decisión o no.
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
  -- HU-030 (D-37): el reporte de inasistencia aceptado cancela la monitoría, venga de confirmada o de realizada (RN-65).
  elsif old.estado in ('confirmada', 'realizada') and new.estado = 'cancelada' and new.motivo_cancelacion = 'monitor_no_asistio' then
    v_evento := 'inasistencia_aceptada';
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
-- El motivo del reembolso por inasistencia: un solo texto (supuesto 6)
-- ---------------------------------------------------------------------------
-- 'El monitor no asistió a la monitoría.' y, si hay observaciones, un espacio y el texto sin los espacios ni saltos de línea
-- de los bordes ([[:space:]] y no btrim, que solo quita espacios: unas observaciones de puros saltos de línea no son texto).
-- Sin observaciones, sin espacio final. Lo usan privado.resolver_reporte_inasistencia y el trigger de P-07. Interna: la llaman
-- funciones security definer, ningún rol la ejecuta.
create or replace function privado.motivo_de_inasistencia(p_observaciones text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select 'El monitor no asistió a la monitoría.'
    || coalesce(' ' || nullif(regexp_replace(p_observaciones, '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''), '');
$$;

comment on function privado.motivo_de_inasistencia(text) is
  'El motivo del reembolso cuando el monitor no asistió: el texto base y, si las hay, las observaciones del admin (D-37). La usan la decisión del reporte y P-07. HU-030.';

revoke all on function privado.motivo_de_inasistencia(text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- P-07: el pago que se aprueba después de cancelar también se reembolsa (ahora, también por inasistencia)
-- ---------------------------------------------------------------------------
-- privado.reembolsar_pago_aprobado_tarde de 20261002173529_cancelar_cita.sql. Cambios (HU-030): (1) acepta también una
-- monitoría `cancelada` con motivo `monitor_no_asistio` (individual, como hasta ahora); (2) el motivo del reembolso sale del
-- motivo de la cancelación: `estudiante` da 'Cancelaste la monitoría dentro del plazo.' (igual que antes) y
-- `monitor_no_asistio` da privado.motivo_de_inasistencia con las observaciones del reporte aceptado, o el texto base si la
-- monitoría quedó así sin reporte. Todo lo demás igual: el primer admin activo (D-26, sin admin D-28), un reembolso por pago
-- (on conflict do nothing) y nada para las grupales. El trigger pago_reembolsa_cancelacion no cambia.
--
-- Sirve para los dos órdenes entre revisar_pago y la decisión, porque las dos toman la monitoría primero: si la decisión va
-- antes, el pago sigue `en_revision`, la monitoría ya está `cancelada` y la aprobación posterior dispara este trigger; si la
-- aprobación va antes, la decisión ve el pago `aprobado` y lo reembolsa ella.
create or replace function privado.reembolsar_pago_aprobado_tarde()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_motivo_cancelacion public.motivo_cancelacion;
  v_observaciones text;
begin
  select m.motivo_cancelacion into v_motivo_cancelacion
  from public.monitoria m
  where m.id = new.id_monitoria
    and m.estado = 'cancelada'
    and m.motivo_cancelacion in ('estudiante', 'monitor_no_asistio')
    and not exists (select 1 from public.monitoria_grupal g where g.id_monitoria = m.id);
  if not found then
    return null;
  end if;

  if v_motivo_cancelacion = 'monitor_no_asistio' then
    -- Sin reporte aceptado (una monitoría cancelada a mano) no hay observaciones: queda el texto base.
    select r.observaciones into v_observaciones
    from public.reporte_inasistencia r
    where r.id_monitoria = new.id_monitoria and r.estado = 'aceptado';

    insert into public.reembolso (id_pago, id_admin, monto, motivo)
    values (new.id, privado.siguiente_admin_activo(), new.monto, privado.motivo_de_inasistencia(v_observaciones))
    on conflict on constraint reembolso_id_pago_key do nothing;
  else
    insert into public.reembolso (id_pago, id_admin, monto, motivo)
    values (new.id, privado.siguiente_admin_activo(), new.monto, 'Cancelaste la monitoría dentro del plazo.')
    on conflict on constraint reembolso_id_pago_key do nothing;
  end if;
  return null;
end;
$$;

revoke all on function privado.reembolsar_pago_aprobado_tarde() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Resolver el reporte: aceptar o rechazar (criterios 1 a 5)
-- ---------------------------------------------------------------------------
-- p_decision: 'aceptar' o 'rechazar'. p_observaciones: se le quitan los espacios y saltos de línea de los bordes; vacías son
-- ninguna; hasta 500 caracteres (el check reporte_observaciones_con_texto). p_ahora nulo se toma como now().
-- Resultado, en el orden en que se mira (quién puede, antes que el texto):
--   aceptado | rechazado   quedó decidido. Aceptar: la monitoría pasa a `cancelada` con `monitor_no_asistio` (venga de
--                          confirmada o de realizada; fecha_finalizacion se conserva), el desembolso `pendiente` pasa a
--                          `anulado` (P-28; uno `desembolsado` no se toca), cada pago `aprobado` recibe su reembolso en
--                          `esperando_llave` con el primer admin activo y el motivo de D-37, y el trigger de la monitoría
--                          anota el aviso al monitor. Rechazar solo escribe el reporte: la monitoría y el desembolso quedan
--                          como estaban (el desembolso vuelve a ser ejecutable pasada la ventana, por RN-83) y HU-080
--                          reanuda las invitaciones a reseñar con su trigger.
--   sin_sesion             no hay sesión.
--   sin_permiso            quien llama no es un admin activo.
--   decision_invalida      p_decision nula o distinta de aceptar y rechazar.
--   no_encontrado          el reporte no existe.
--   no_asignado            el reporte es de otro admin. Se dice antes que las observaciones y se vuelve a mirar bajo el candado
--                          (P-44 pudo reasignarlo mientras tanto).
--   observaciones_invalidas  más de 500 caracteres (char_length, como el check).
--   ya_decidido            el reporte ya no está en revisión (un doble clic, otra pestaña): no se pisa fecha ni observaciones.
--   no_individual          la monitoría es grupal: su reporte es de HU-045.
--   no_aceptable           solo al aceptar: la monitoría ya no está confirmada ni realizada (por ejemplo, ya estaba cancelada).
--                          Rechazar sí se puede.
-- Ningún resultado escribe nada salvo aceptado y rechazado.
create or replace function privado.resolver_reporte_inasistencia(
  p_id_reporte uuid,
  p_decision text,
  p_observaciones text default null,
  p_ahora timestamptz default now()
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_ahora timestamptz := coalesce(p_ahora, now());
  -- [[:space:]] y no btrim, que solo quita espacios (como revisar_pago y ejecutar_desembolso).
  v_observaciones text := nullif(regexp_replace(p_observaciones, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  v_id_monitoria uuid;
  v_id_admin uuid;
  v_estado_reporte public.estado_reporte;
  v_estado_monitoria public.estado_monitoria;
  v_destino uuid;
begin
  if v_uid is null then
    return 'sin_sesion';
  end if;
  if not (select privado.es_admin()) then
    return 'sin_permiso';
  end if;

  if p_decision is null or p_decision not in ('aceptar', 'rechazar') then
    return 'decision_invalida';
  end if;

  -- El reporte, sin candado: hace falta la monitoría para bloquear en orden, y el asignado para decir no_asignado antes que
  -- el texto sin esperar a nadie. La monitoría de un reporte no cambia; el admin sí puede cambiar (P-44) y se vuelve a mirar.
  select r.id_monitoria, r.id_admin into v_id_monitoria, v_id_admin
  from public.reporte_inasistencia r
  where r.id = p_id_reporte;
  if not found then
    return 'no_encontrado';
  end if;
  if v_id_admin is distinct from v_uid then
    return 'no_asignado';
  end if;

  -- Quien llama puede resolver este reporte: ahora sí el texto. Cuenta caracteres, no bytes.
  if char_length(v_observaciones) > 500 then
    return 'observaciones_invalidas';
  end if;

  -- Primero la monitoría `for update` (en fila con revisar_pago, ejecutar_desembolso, finalizar_monitoria, el cierre
  -- automático, cancelar_cita y cerrar_caso_p24), después el reporte y, si se acepta, los pagos por id.
  select m.estado into v_estado_monitoria
  from public.monitoria m
  where m.id = v_id_monitoria
  for update;

  select r.estado, r.id_admin into v_estado_reporte, v_id_admin
  from public.reporte_inasistencia r
  where r.id = p_id_reporte
  for update;
  if not found then
    return 'no_encontrado';
  end if;

  if p_decision = 'aceptar' then
    perform 1 from public.pago p where p.id_monitoria = v_id_monitoria order by p.id for update;
  end if;

  -- Bajo el candado, lo que pudo cambiar mientras esperaba: que lo desactivaran (privado.es_admin lee auth.users en cada
  -- llamada), que otra decisión llegara primero y que P-44 se lo pasara a otro admin.
  if not (select privado.es_admin()) then
    return 'sin_permiso';
  end if;
  if v_estado_reporte <> 'en_revision' then
    return 'ya_decidido';
  end if;
  if v_id_admin is distinct from v_uid then
    return 'no_asignado';
  end if;
  if exists (select 1 from public.monitoria_grupal g where g.id_monitoria = v_id_monitoria) then
    return 'no_individual';
  end if;

  -- Rechazar (criterio 4): solo el reporte. Su trigger de HU-080 reanuda las invitaciones a reseñar.
  if p_decision = 'rechazar' then
    update public.reporte_inasistencia
    set estado = 'rechazado', fecha_decision = v_ahora, observaciones = v_observaciones
    where id = p_id_reporte;
    return 'rechazado';
  end if;

  -- Aceptar (criterios 1 a 3).
  if v_estado_monitoria not in ('confirmada', 'realizada') then
    return 'no_aceptable';
  end if;

  -- El motivo va en la misma sentencia por monitoria_motivo_solo_si_cancelada; fecha_finalizacion se conserva. Dispara
  -- monitoria_anota_aviso_monitor (inasistencia_aceptada).
  update public.monitoria
  set estado = 'cancelada', motivo_cancelacion = 'monitor_no_asistio'
  where id = v_id_monitoria;

  update public.reporte_inasistencia
  set estado = 'aceptado', fecha_decision = v_ahora, observaciones = v_observaciones
  where id = p_id_reporte;

  -- P-28: el desembolso que esperaba se anula. Sin fila (la monitoría aún no se había realizado) no hace nada, y uno ya
  -- `desembolsado` no se toca (supuesto 9).
  update public.desembolso set estado = 'anulado'
  where id_monitoria = v_id_monitoria and estado = 'pendiente';

  -- RN-60: un reembolso por pago aprobado, del monto completo, con el primer admin activo (D-26; si no hubiera ninguno, D-28).
  -- Los triggers de reembolso anotan la solicitud y el pedido de llave y le piden a la app que los mande. Un pago
  -- `en_revision` recibe el suyo cuando se apruebe (reembolsar_pago_aprobado_tarde) y uno `rechazado` nunca (RN-43).
  v_destino := privado.siguiente_admin_activo();
  insert into public.reembolso (id_pago, id_admin, monto, motivo)
  select p.id, v_destino, p.monto, privado.motivo_de_inasistencia(v_observaciones)
  from public.pago p
  where p.id_monitoria = v_id_monitoria and p.estado = 'aprobado'
  order by p.id
  on conflict on constraint reembolso_id_pago_key do nothing;

  return 'aceptado';
end;
$$;

comment on function privado.resolver_reporte_inasistencia(uuid, text, text, timestamptz) is
  'El admin asignado acepta o rechaza un reporte de inasistencia (una sola vez). Aceptar cancela la monitoría por monitor_no_asistio, anula el desembolso pendiente y reembolsa los pagos aprobados; rechazar solo guarda la decisión. Interna: la sesión entra por public.resolver_reporte_inasistencia. HU-030.';

-- La versión con p_ahora queda interna: ninguna sesión elige la hora de la decisión.
revoke all on function privado.resolver_reporte_inasistencia(uuid, text, text, timestamptz) from public, anon, authenticated, service_role;

-- La que ejecuta la sesión del admin: la misma, con la hora de la base.
create or replace function privado.resolver_reporte_inasistencia_de_la_sesion(p_id_reporte uuid, p_decision text, p_observaciones text)
returns text
language sql
volatile
security definer
set search_path = ''
as $$
  select privado.resolver_reporte_inasistencia(p_id_reporte, p_decision, p_observaciones, now());
$$;

comment on function privado.resolver_reporte_inasistencia_de_la_sesion(uuid, text, text) is
  'Resuelve un reporte de inasistencia con la sesión del admin y la hora de la base: privado.resolver_reporte_inasistencia sin p_ahora. HU-030.';

revoke all on function privado.resolver_reporte_inasistencia_de_la_sesion(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function privado.resolver_reporte_inasistencia_de_la_sesion(uuid, text, text) to authenticated;

-- La puerta en la Data API, con los permisos de quien llama. Solo con sesión: service_role no tiene auth.uid().
create or replace function public.resolver_reporte_inasistencia(p_id_reporte uuid, p_decision text, p_observaciones text)
returns text
language sql
volatile
security invoker
set search_path = ''
as $$
  select privado.resolver_reporte_inasistencia_de_la_sesion(p_id_reporte, p_decision, p_observaciones);
$$;

comment on function public.resolver_reporte_inasistencia(uuid, text, text) is
  'El admin asignado acepta o rechaza un reporte de inasistencia, con observaciones opcionales (RN-62 a RN-65, D-37). HU-030.';

revoke all on function public.resolver_reporte_inasistencia(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.resolver_reporte_inasistencia(uuid, text, text) to authenticated;
