-- Cualquier admin activo registra la transferencia de un reembolso. HU-082.
--
-- D-48 a y b (cualquier admin activo registra y ve la llave; el reembolso que quedó con un admin desactivado tiene
-- salida), D-38 b como precedente (HU-077: id_admin_revisor), D-26, D-28 y P-44. Parte de la versión de
-- privado.ejecutar_reembolso de 20261004055644_gestionar_reembolsos.sql (HU-026), la única que la define.
--
-- Supuestos de HU-082 (por confirmar con dvarela5101; no son decisiones D-n):
--   1. Orden de resultados de privado.ejecutar_reembolso: sin_sesion, sin_permiso, no_encontrado, referencia_invalida,
--      fecha_invalida, (candado) no_encontrado, ya_reembolsado, sin_llave, reembolsado. no_asignado desaparece: el texto
--      se valida ahora para cualquier admin activo.
--   2. id_admin no cambia nunca al registrar (sigue siendo el asignado). P-44 (reasignar_casos_de_admin) solo mueve
--      esperando_llave y pendiente, así que no toca los reembolsados y id_admin_registro tampoco se mueve.
--   3. id_admin_registro es nula mientras no se registra y no lleva restricción que la ate al estado (como
--      id_admin_revisor): hay pruebas que insertan reembolsados directos y reembolso_ejecutado_completo no se amplía.
--      Los reembolsados sin id_admin (D-28) quedan con id_admin_registro nula tras el relleno.
--   4. Un pendiente sin admin (D-28) lo registra cualquier admin activo sin esperar a privado.asignar_reembolsos_sin_admin;
--      el cron sigue asignando y no toca reembolsados.
--   5. Se mantiene el supuesto 4 de HU-026: un registro es definitivo; si dos admins transfieren por fuera, se registra
--      una vez y se acepta el riesgo (ahora mayor).
-- RLS no cambia: la columna nueva la leen los admins por la política «admin lee» y nadie más; nadie con sesión escribe.
-- Un efecto de bloqueo nuevo: el UPDATE ahora llena una llave foránea a admin, que toma FOR KEY SHARE sobre la fila del
-- admin de la sesión; privado.mover_admin (FOR UPDATE sobre los admins) solo la hace esperar, sin ciclo.
-- Idempotente.

-- ---------------------------------------------------------------------------
-- Quién registró la transferencia (criterio 2, supuesto 3)
-- ---------------------------------------------------------------------------
-- Apunta a admin, que nunca se borra (RN-23).
alter table public.reembolso add column if not exists id_admin_registro uuid references public.admin (id);
create index if not exists reembolso_id_admin_registro_idx on public.reembolso (id_admin_registro);
comment on column public.reembolso.id_admin_registro is
  'El admin que registró la transferencia. Puede ser distinto del asignado (id_admin) cuando la registró otro admin activo (D-48). Nula mientras no se registra. HU-082.';

-- Criterio 3: con HU-026 solo registraba el asignado, así que los reembolsados quedan con él. Reaplicada no cambia nada.
update public.reembolso set id_admin_registro = id_admin
where estado = 'reembolsado' and id_admin_registro is null and id_admin is not null;

-- ---------------------------------------------------------------------------
-- Registrar la transferencia (criterio 2, supuestos 1 a 4)
-- ---------------------------------------------------------------------------
-- privado.ejecutar_reembolso de 20261004055644_gestionar_reembolsos.sql. Cambios, marcados con HU-082; la firma, el
-- retorno, la seguridad y los permisos no cambian:
--   (1) se quita la lectura de id_admin y las dos comprobaciones de no_asignado; la lectura sin candado queda solo con
--       fecha_generacion;
--   (2) bajo el candado ya no se lee id_admin y se vuelve a mirar es_admin(): un admin desactivado mientras esperaba el
--       candado recibe sin_permiso (cada sentencia ve su propia foto en READ COMMITTED);
--   (3) el UPDATE guarda id_admin_registro = quien llama; id_admin no se toca.
-- p_referencia: se le quitan los espacios y saltos de línea de los bordes. p_fecha: el día de la transferencia, que se
-- guarda a mediodía en Bogotá.
-- Resultado, en el orden en que se mira:
--   reembolsado          quedó reembolsado con la referencia y la fecha; id_admin_registro es quien llama.
--   ya_reembolsado       ya estaba registrado (un doble clic, otra pestaña, otro admin): no se toca nada.
--   sin_llave            espera la llave (abierto, vencido o cerrado): no hay a dónde transferir.
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
  v_fecha_generacion timestamptz;
  v_estado public.estado_reembolso;
begin
  if v_uid is null then
    return 'sin_sesion';
  end if;
  if not (select privado.es_admin()) then
    return 'sin_permiso';
  end if;

  -- Sin candado: cuándo se creó. fecha_generacion no cambia, así que basta esta lectura para la fecha.
  select r.fecha_generacion into v_fecha_generacion
  from public.reembolso r
  where r.id = p_id_reembolso;
  if not found then
    return 'no_encontrado';
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
  select r.estado into v_estado
  from public.reembolso r
  where r.id = p_id_reembolso
  for no key update;
  if not found then
    return 'no_encontrado';
  end if;

  -- Un admin desactivado mientras esperaba el candado no registra (criterio 5).
  if not (select privado.es_admin()) then
    return 'sin_permiso';
  end if;

  if v_estado = 'reembolsado' then
    return 'ya_reembolsado';
  end if;
  if v_estado = 'esperando_llave' then
    return 'sin_llave';
  end if;

  update public.reembolso
  set estado = 'reembolsado',
      referencia_transferencia = v_referencia,
      fecha_reembolso = (p_fecha + time '12:00') at time zone 'America/Bogota',
      id_admin_registro = v_uid
  where id = p_id_reembolso;
  return 'reembolsado';
end;
$$;

comment on function privado.ejecutar_reembolso(uuid, text, date, timestamptz) is
  'Cualquier admin activo registra la transferencia de un reembolso pendiente (referencia y fecha) y pasa a reembolsado; guarda quién lo registró. Interna: la sesión entra por public.ejecutar_reembolso. HU-026, HU-082.';

-- La versión con p_ahora queda interna: ninguna sesión elige la hora ni mueve el día de hoy.
revoke all on function privado.ejecutar_reembolso(uuid, text, date, timestamptz) from public, anon, authenticated, service_role;

-- Los envoltorios no cambian; solo su comment.
comment on function privado.ejecutar_reembolso_de_la_sesion(uuid, text, date) is
  'Registra la transferencia de un reembolso con la sesión del admin y la hora de la base: privado.ejecutar_reembolso sin p_ahora. HU-026, HU-082.';

comment on function public.ejecutar_reembolso(uuid, text, date) is
  'Cualquier admin activo registra la transferencia de un reembolso pendiente (referencia y fecha). HU-026, HU-082.';
