-- El admin asignado registra la transferencia de un reembolso pendiente. HU-026.
--
-- RN-43, RN-44, RN-60 (el reembolso es el pago completo), RN-61 y RN-63, flujo F4. P-07, P-10, P-22, P-40, P-44, D-26,
-- D-27, D-28. Un reembolso nace en `esperando_llave` (HU-024, P-07 o HU-030), pasa a `pendiente` cuando quien pagó entrega
-- su llave desde el enlace (HU-025) y aquí pasa a `reembolsado` cuando su admin registra la transferencia que hizo por
-- fuera de la app. Reenviar el enlace ya lo hace public.reenviar_pedido_llave (HU-025) y la asignación al crear ya la
-- hacen HU-024 y D-28: esta migración no los toca.
--
-- Supuestos del registro de HU-026 (por confirmar con dvarela5101; no son decisiones D-n). Los que toca la base:
--   1. Solo el admin asignado registra la transferencia (no_asignado) y id_admin queda como quien la registró, sin
--      columna nueva. Reenviar y reabrir siguen abiertos a cualquier admin activo (HU-025). Un pendiente sin admin (D-28)
--      espera a que privado.asignar_reembolsos_sin_admin se lo asigne.
--   2. La referencia es obligatoria, de 1 a 100 caracteres sin espacios en los bordes, sin unicidad.
--   3. La fecha no puede ser futura ni anterior al día en que se creó el reembolso (en Bogotá) y se guarda a mediodía de
--      Bogotá, como la del desembolso (HU-028).
--   4. Registrar es definitivo: la base lo registra una sola vez (ya_reembolsado) y una corrección va por soporte o por
--      una HU nueva. Si dos admins transfieren por fuera, se registra una vez y se acepta el riesgo, como en HU-028.
--   5. No se manda correo al pagador al reembolsar: lo ve en la página de la llave y en su cita.
--   7. Una llave equivocada en `pendiente` queda fuera de alcance: quien pagó escribe a soporte (supuesto 3 de HU-025).
--   9. La llave del pagador solo se le muestra en pantalla al admin asignado. Lo decide la app: la política «admin lee» de
--      reembolso no cambia.
--   Los demás (6, 8, 10 y 11) son de la pantalla y de la bandeja, y no cambian la base.
--
-- Diseño:
--   * La referencia del reembolso lleva el mismo check que la del desembolso (HU-028). No se exige id_admin en un
--     reembolsado (hay reembolsados sin admin de D-28 que el cron no toca) ni fecha_reembolso >= fecha_generacion (la
--     fecha guardada es el mediodía del día, que puede quedar antes de la hora de creación del mismo día).
--   * public.estado_de_reembolso(id): el estado que muestra la página y el fin de los 7 días del ciclo, con la hora de la
--     base y la misma regla que public.datos_de_llave: uno que espera la llave y ya venció es `cerrado` aunque el cierre
--     de pg_cron (calibra-vencer-llaves, cada 15 minutos) no haya corrido. security invoker: la política «admin lee» deja
--     sin filas a quien no es un admin activo, así que no hace falta una versión en privado.
--   * privado.ejecutar_reembolso: quién puede (sesión, admin activo y asignado) se mira antes que el texto (D-39, como en
--     HU-077), con una lectura sin candado; después la referencia y la fecha; después un solo candado, la fila del
--     reembolso `for no key update` (el mismo de entregar_llave, reabrir y reenviar), y bajo él se vuelven a mirar el
--     estado y el admin. Todo lo que decide vive en esa fila: el pago ya está aprobado, que es final, así que no bloquea
--     la monitoría ni el pago (HU-025 eligió lo mismo). No toma el candado del turno porque no elige admin. Una función
--     con un solo candado que no pide otro no entra en un ciclo. id_admin no cambia: ya es quien registra.
--   * Sin monto esperado (a diferencia de ejecutar_desembolso): ni el monto ni la llave cambian después de `pendiente`
--     (entregar_llave no deja cambiar una llave entregada). Si una HU deja pedir la llave de nuevo, tiene que agregar aquí
--     la llave que vio el admin, como p_neto_esperado en HU-028: el admin transfiere a la llave que vio.
--   * Nadie con sesión escribe en reembolso: lo hace la función security definer de privado con la identidad de la sesión
--     (auth.uid()). La versión con p_ahora queda interna, sin grant (como ejecutar_desembolso); la sesión entra por
--     privado.ejecutar_reembolso_de_la_sesion, con now(), desde public.ejecutar_reembolso.
-- No redefine ninguna función existente.
-- Idempotente.

-- ---------------------------------------------------------------------------
-- La referencia y la fecha de la transferencia (supuestos 2 y 3)
-- ---------------------------------------------------------------------------
alter table public.reembolso drop constraint if exists reembolso_referencia_con_texto;
alter table public.reembolso add constraint reembolso_referencia_con_texto
  check (referencia_transferencia is null or (referencia_transferencia ~ '^[^[:space:]]'
    and referencia_transferencia ~ '[^[:space:]]$' and char_length(referencia_transferencia) <= 100));
comment on column public.reembolso.referencia_transferencia is
  'Referencia de la transferencia a quien pagó que escribe el admin al registrarla: de 1 a 100 caracteres, sin espacios en los bordes. HU-026.';
comment on column public.reembolso.fecha_reembolso is
  'El día de la transferencia a quien pagó, guardado a mediodía de Bogotá: representa un día, no una hora. HU-026.';

-- ---------------------------------------------------------------------------
-- Lo que necesita la página para decidir qué ofrecer
-- ---------------------------------------------------------------------------
-- Con los permisos de quien llama: un admin activo recibe una fila; los demás, ninguna (la política «admin lee» de
-- reembolso). Sin filas si el reembolso no existe.
--   estado    esperando_llave, pendiente o reembolsado; o cerrado si espera la llave y el caso se cerró o ya pasaron los 7
--             días (P-40: con 7 días exactos todavía no), como en public.datos_de_llave.
--   vence_en  el fin de los 7 días del ciclo actual.
create or replace function public.estado_de_reembolso(p_id_reembolso uuid)
returns table (estado text, vence_en timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    case
      when r.estado = 'esperando_llave'
       and (r.cerrado_en is not null
            or public.dentro_de_plazo(public.entrega_de_llave_hasta(r.plazo_llave_desde), now()) is not true)
      then 'cerrado'
      else r.estado::text
    end,
    public.entrega_de_llave_hasta(r.plazo_llave_desde)
  from public.reembolso r
  where r.id = p_id_reembolso;
$$;

comment on function public.estado_de_reembolso(uuid) is
  'Para un admin: el estado del reembolso para la página (esperando_llave, cerrado, pendiente o reembolsado) y el fin de los 7 días, con la hora de la base. Nunca la llave. HU-026.';

revoke all on function public.estado_de_reembolso(uuid) from public, anon, authenticated, service_role;
grant execute on function public.estado_de_reembolso(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Registrar la transferencia (criterio 2, supuestos 1 a 4)
-- ---------------------------------------------------------------------------
-- p_referencia: se le quitan los espacios y saltos de línea de los bordes. p_fecha: el día de la transferencia, que se
-- guarda a mediodía en Bogotá.
-- Resultado, en el orden en que se mira:
--   reembolsado          quedó reembolsado con la referencia y la fecha; id_admin sigue siendo quien lo registró.
--   ya_reembolsado       ya estaba registrado (un doble clic, otra pestaña): no se toca nada.
--   sin_llave            espera la llave (abierto, vencido o cerrado): no hay a dónde transferir.
--   no_asignado          no es el admin asignado (otro admin, o nadie todavía por D-28). Se dice antes que la referencia
--                        o la fecha, y se vuelve a mirar bajo el candado (P-44 pudo reasignarlo mientras tanto).
--   fecha_invalida       sin fecha, futura en Bogotá o anterior al día en Bogotá en que se creó el reembolso.
--   referencia_invalida  vacía o de más de 100 caracteres.
--   no_encontrado        el reembolso no existe.
--   sin_permiso          quien llama no es un admin activo.
--   sin_sesion           no hay sesión.
create or replace function privado.ejecutar_reembolso(
  p_id_reembolso uuid,
  p_referencia text,
  p_fecha date,
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
  -- [[:space:]] y no btrim, que solo quita espacios (como ejecutar_desembolso).
  v_referencia text := nullif(regexp_replace(p_referencia, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  v_id_admin uuid;
  v_fecha_generacion timestamptz;
  v_estado public.estado_reembolso;
begin
  if v_uid is null then
    return 'sin_sesion';
  end if;
  if not (select privado.es_admin()) then
    return 'sin_permiso';
  end if;

  -- Sin candado: quién lo tiene y cuándo se creó. Quién puede se mira antes que el texto. fecha_generacion no cambia, así
  -- que basta esta lectura para la fecha; el admin sí puede cambiar (P-44) y se vuelve a mirar bajo el candado.
  select r.id_admin, r.fecha_generacion into v_id_admin, v_fecha_generacion
  from public.reembolso r
  where r.id = p_id_reembolso;
  if not found then
    return 'no_encontrado';
  end if;
  if v_id_admin is distinct from v_uid then
    return 'no_asignado';
  end if;

  if v_referencia is null or char_length(v_referencia) > 100 then
    return 'referencia_invalida';
  end if;
  -- `is not true`: sin fecha o sin hora no se puede decir que esté entre los dos días (falla cerrado).
  if (p_fecha <= (p_ahora at time zone 'America/Bogota')::date
      and p_fecha >= (v_fecha_generacion at time zone 'America/Bogota')::date) is not true then
    return 'fecha_invalida';
  end if;

  -- El único candado: la fila del reembolso. Dos registros a la vez, o uno con entregar_llave, reabrir, reenviar o
  -- reasignar_casos_de_admin, quedan en fila: el segundo lee lo que dejó el primero.
  select r.estado, r.id_admin into v_estado, v_id_admin
  from public.reembolso r
  where r.id = p_id_reembolso
  for no key update;
  if not found then
    return 'no_encontrado';
  end if;

  if v_estado = 'reembolsado' then
    return 'ya_reembolsado';
  end if;
  if v_estado = 'esperando_llave' then
    return 'sin_llave';
  end if;
  -- Solo reasignar_casos_de_admin (P-44) cambia el admin de un pendiente entre la lectura y el candado.
  if v_id_admin is distinct from v_uid then
    return 'no_asignado';
  end if;

  update public.reembolso
  set estado = 'reembolsado',
      referencia_transferencia = v_referencia,
      fecha_reembolso = (p_fecha + time '12:00') at time zone 'America/Bogota'
  where id = p_id_reembolso;
  return 'reembolsado';
end;
$$;

comment on function privado.ejecutar_reembolso(uuid, text, date, timestamptz) is
  'El admin asignado registra la transferencia de un reembolso pendiente (referencia y fecha) y pasa a reembolsado. Interna: la sesión entra por public.ejecutar_reembolso. HU-026.';

-- La versión con p_ahora queda interna: ninguna sesión elige la hora ni mueve el día de hoy.
revoke all on function privado.ejecutar_reembolso(uuid, text, date, timestamptz) from public, anon, authenticated, service_role;

-- La que ejecuta la sesión del admin: la misma, con la hora de la base.
create or replace function privado.ejecutar_reembolso_de_la_sesion(p_id_reembolso uuid, p_referencia text, p_fecha date)
returns text
language sql
volatile
security definer
set search_path = ''
as $$
  select privado.ejecutar_reembolso(p_id_reembolso, p_referencia, p_fecha, now());
$$;

comment on function privado.ejecutar_reembolso_de_la_sesion(uuid, text, date) is
  'Registra la transferencia de un reembolso con la sesión del admin y la hora de la base: privado.ejecutar_reembolso sin p_ahora. HU-026.';

revoke all on function privado.ejecutar_reembolso_de_la_sesion(uuid, text, date) from public, anon, authenticated, service_role;
grant execute on function privado.ejecutar_reembolso_de_la_sesion(uuid, text, date) to authenticated;

-- La puerta en la Data API, con los permisos de quien llama. Solo con sesión: service_role no tiene auth.uid().
create or replace function public.ejecutar_reembolso(p_id_reembolso uuid, p_referencia text, p_fecha date)
returns text
language sql
volatile
security invoker
set search_path = ''
as $$
  select privado.ejecutar_reembolso_de_la_sesion(p_id_reembolso, p_referencia, p_fecha);
$$;

comment on function public.ejecutar_reembolso(uuid, text, date) is
  'El admin asignado registra la transferencia de un reembolso pendiente (referencia y fecha). HU-026.';

revoke all on function public.ejecutar_reembolso(uuid, text, date) from public, anon, authenticated, service_role;
grant execute on function public.ejecutar_reembolso(uuid, text, date) to authenticated;
