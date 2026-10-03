-- Ejecutar desembolsos a monitores. HU-028.
--
-- RN-80: un desembolso por monitoría, creado en `pendiente` cuando la monitoría pasa a `realizada`, con bruto (pagos
-- aprobados), comisión, neto y una copia de la llave del monitor (`llave_destino`). Un admin lo ejecuta a mano y deja
-- referencia, fecha e id_admin. RN-45: solo cuentan los pagos aprobados. RN-81 y RN-82: la comisión es la de
-- public.comision() sobre el total de la monitoría (P-14). RN-83 y N-6: no se ejecuta hasta estrictamente después de
-- fin + 24 h (public.desembolso_ejecutable) ni con un reporte en revisión o aceptado. P-28: un `anulado` (lo deja así
-- HU-030, D-37) nunca se ejecuta. P-29: bruto, comisión y neto se vuelven a calcular al ejecutar, con los pagos
-- aprobados de ese momento. D-39 (c): no se ejecuta mientras la monitoría tenga un pago en revisión.
-- Fuera de alcance (D-39): lo cobrado o asumido de P-24 y el bloqueo por un caso abierto son de HU-078.
--
-- Supuestos de HU-028 por confirmar con dvarela5101 (registro de la HU; no son decisiones D-n):
--   1. Con un pago en revisión no se ejecuta (D-39 (c) ya lo decidió) y se vuelve a validar al ejecutar.
--   2. Si al ejecutar no hay pagos aprobados (el único se rechazó por P-24), no se ejecuta: sin_pagos_aprobados. El
--      desembolso sigue pendiente hasta que se decida qué hacer con esos casos.
--   3. El admin escribe la referencia y la fecha de la transferencia; la fecha no puede ser futura (en Bogotá) ni
--      anterior a la sesión.
--   4. Al admin se le da el neto, nunca el bruto ni la comisión (CLAUDE.md, P-32): estado_para_ejecutar solo devuelve
--      el neto. Los tres montos quedan en la tabla para auditoría.
--   5. Dos admins podrían transferir el mismo desembolso por fuera de la app: la base solo deja registrarlo una vez (el
--      segundo recibe ya_desembolsado).
--   6. Solo las individuales generan desembolso por ahora; las grupales llegan con HU-036, HU-038 y HU-046.
--   7. No se avisa al monitor por correo (D-16 no lo incluye).
--
-- Diseño (registro de HU-028):
--   * Un trigger after update of estado de monitoria crea el desembolso al pasar a `realizada`, así cubre los dos
--     caminos (el monitor que finaliza y el cierre automático), como el de la invitación a reseñar de HU-035. Guarda
--     una foto de los montos con los pagos aprobados de ese momento (las columnas no aceptan nulo) y la llave del
--     monitor. Es solo de UPDATE: las monitorías que se insertan ya realizadas (fixtures) no lo disparan. No crea
--     desembolsos para las que ya estaban realizadas antes de esta migración.
--   * Un monitor sin monitor_privado no puede pasar una monitoría a realizada: el trigger lanza un error. No pasa en
--     producción (registrar_monitor crea las dos filas en la misma transacción), y un desembolso sin llave no sirve.
--   * privado.calcular_desembolso es la única fuente de los montos, para el trigger y para la ejecución.
--   * privado.estado_para_ejecutar dice, sin bloquear nada, si se puede ejecutar y por qué no: lo usa la pantalla
--     para anticipar y ejecutar_desembolso para volver a validar con la misma lógica. Recibe la hora (la vista usa
--     now()); el plazo sale de public.desembolso_ejecutable, nunca de plazo_alcanzado(desembolsable_desde, ...) (N-6).
--   * Lo que bloquea por la monitoría (un reporte en revisión o aceptado, un pago en revisión, ningún pago aprobado)
--     vive en una sola función, privado.bloqueo_del_desembolso, que usan estado_para_ejecutar y la vista
--     desembolsos_ejecutables de la bandeja.
--   * Redefine la vista desembolsos_ejecutables (HU-012; versión vigente en 20260929231832_ajustes_plazos_y_comision.sql)
--     con las mismas columnas en el mismo orden: antes listaba desembolsos con un pago en revisión o sin pagos
--     aprobados que la página y la base no dejan ejecutar. Ahora coincide con estado_para_ejecutar a la hora de la
--     base, salvo la defensa no_realizada, que la vista sigue sin mirar. El neto que lista es el de la foto: el que
--     se transfiere se recalcula al ejecutar (P-29).
--   * Al ejecutar, bajo candado y en el orden de revisar_pago: primero la monitoría `for update` (no `for no key
--     update`: así choca con el `for key share` de la llave foránea al insertar un pago o un reporte) y después el
--     desembolso. Dos admins quedan en fila: el segundo lee `desembolsado`. No toma el candado del turno de admins
--     porque no elige admin. HU-029 y HU-030 deben bloquear primero la monitoría, igual.
--   * Ejecutar recibe el neto que vio el admin: si cambió (se aprobó un pago entre que lo miró y lo registró),
--     responde monto_cambio sin tocar nada, para que lo vuelva a mirar antes de dar por hecha la transferencia.
--   * Nadie con sesión escribe en desembolso: lo hace la función security definer de privado con la identidad de la
--     sesión (auth.uid()). Las versiones con p_ahora quedan internas, sin grant (como revisar_pago); la sesión entra
--     por las de privado *_de_la_sesion, que usan now(), desde las puertas de public.
-- No redefine ninguna función existente; solo la vista desembolsos_ejecutables, con las columnas que ya tenía (así
-- create or replace view la reemplaza, conserva sus permisos y las migraciones viejas se pueden volver a aplicar).
-- Idempotente.

-- ---------------------------------------------------------------------------
-- La referencia de la transferencia (supuesto 3)
-- ---------------------------------------------------------------------------
alter table public.desembolso drop constraint if exists desembolso_referencia_con_texto;
alter table public.desembolso add constraint desembolso_referencia_con_texto
  check (referencia_transferencia is null or (referencia_transferencia ~ '^[^[:space:]]'
    and referencia_transferencia ~ '[^[:space:]]$' and char_length(referencia_transferencia) <= 100));
comment on column public.desembolso.referencia_transferencia is
  'Referencia de la transferencia al monitor que escribe el admin al ejecutarlo: de 1 a 100 caracteres, sin espacios en los bordes. HU-028.';

-- ---------------------------------------------------------------------------
-- Los montos: una sola fuente (RN-45, RN-81, RN-82, P-29)
-- ---------------------------------------------------------------------------
-- Bruto = suma de los pagos aprobados de la monitoría (0 si no hay). La comisión solo la calcula el servidor (N-2):
-- public.comision y public.monto_neto solo las ejecuta service_role, y esta función, como su dueño. Sin grant: la
-- llaman el trigger, estado_para_ejecutar y ejecutar_desembolso.
create or replace function privado.calcular_desembolso(p_id_monitoria uuid)
returns table (monto_bruto integer, comision integer, monto_neto integer)
language sql
stable
security definer
set search_path = ''
as $$
  select b.bruto, public.comision(b.bruto), public.monto_neto(b.bruto)
  from (
    select coalesce(sum(p.monto), 0)::integer as bruto
    from public.pago p
    where p.id_monitoria = p_id_monitoria
      and p.estado = 'aprobado'
  ) b;
$$;

revoke all on function privado.calcular_desembolso(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- El trigger: crea el desembolso al pasar a realizada (RN-80)
-- ---------------------------------------------------------------------------
-- Solo individuales (supuesto 6). La llave es la del monitor de la franja en ese momento: si después la cambia, este
-- desembolso conserva la anterior (HU-013). Si el desembolso ya existe (la monitoría volvió a realizada), no se toca.
create or replace function privado.crear_desembolso_al_realizar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_llave text;
begin
  if exists (select 1 from public.monitoria_grupal g where g.id_monitoria = new.id) then
    return null;
  end if;

  select mp.llave into v_llave from public.monitor_privado mp where mp.id_monitor = new.id_monitor;
  if not found then
    raise exception 'La monitoría % no puede quedar realizada: su monitor no tiene llave de desembolso (monitor_privado).', new.id
      using hint = 'registrar_monitor crea monitor_privado con el monitor; en una prueba, créalo junto con el monitor.';
  end if;

  insert into public.desembolso (id_monitoria, monto_bruto, comision, monto_neto, llave_destino)
  select new.id, c.monto_bruto, c.comision, c.monto_neto, v_llave
  from privado.calcular_desembolso(new.id) c
  on conflict on constraint desembolso_id_monitoria_key do nothing;
  return null;
end;
$$;

revoke all on function privado.crear_desembolso_al_realizar() from public, anon, authenticated, service_role;

drop trigger if exists monitoria_crea_desembolso on public.monitoria;
create trigger monitoria_crea_desembolso
  after update of estado on public.monitoria
  for each row
  when (old.estado is distinct from new.estado and new.estado = 'realizada')
  execute function privado.crear_desembolso_al_realizar();

-- ---------------------------------------------------------------------------
-- Lo que bloquea un desembolso por su monitoría (RN-83, D-39, supuesto 2)
-- ---------------------------------------------------------------------------
-- La única definición, para estado_para_ejecutar (la página y la ejecución) y la vista desembolsos_ejecutables (la
-- bandeja). Nulo = nada la bloquea; si no, el primero que aplique, en el orden de estado_para_ejecutar:
--   con_reporte          un reporte de inasistencia en revisión o aceptado (uno rechazado no bloquea).
--   pagos_en_revision    un pago en revisión (D-39): ese dinero todavía puede contar (P-29).
--   sin_pagos_aprobados  ningún pago aprobado: no hay nada que transferir (supuesto 2).
-- security invoker: lee con los permisos de quien la llama. Desde estado_para_ejecutar (definer) ve todo; desde la
-- vista, que es security_invoker, ve lo que ve quien consulta: un admin activo lee todos los reportes y pagos, y nadie
-- más ve desembolsos. Por eso authenticated y service_role la ejecutan; privado no está en la Data API.
create or replace function privado.bloqueo_del_desembolso(p_id_monitoria uuid)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when exists (
      select 1 from public.reporte_inasistencia r
      where r.id_monitoria = p_id_monitoria and r.estado in ('en_revision', 'aceptado')
    ) then 'con_reporte'
    when exists (
      select 1 from public.pago p
      where p.id_monitoria = p_id_monitoria and p.estado = 'en_revision'
    ) then 'pagos_en_revision'
    when not exists (
      select 1 from public.pago p
      where p.id_monitoria = p_id_monitoria and p.estado = 'aprobado'
    ) then 'sin_pagos_aprobados'
  end;
$$;
comment on function privado.bloqueo_del_desembolso(uuid) is
  'Por qué la monitoría no deja ejecutar su desembolso (con_reporte, pagos_en_revision, sin_pagos_aprobados) o nulo. La usan estado_para_ejecutar y la vista desembolsos_ejecutables. HU-028.';
revoke all on function privado.bloqueo_del_desembolso(uuid) from public, anon, authenticated, service_role;
grant execute on function privado.bloqueo_del_desembolso(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- ¿Se puede ejecutar? (RN-83, N-6, P-28, D-39, supuestos 1 y 2)
-- ---------------------------------------------------------------------------
-- No bloquea nada. motivo nulo = se puede ejecutar; si no, el primero que aplique:
--   no_encontrado        el desembolso no existe.
--   desembolsado         ya se ejecutó.
--   anulado              la monitoría se canceló después de realizada (P-28, D-37).
--   no_realizada         la monitoría no está realizada (defensa: la vista desembolsos_ejecutables no lo mira).
--   antes_de_plazo       todavía no es estrictamente después de fin + 24 h (N-6).
--   con_reporte          tiene un reporte de inasistencia en revisión o aceptado (uno rechazado no bloquea).
--   pagos_en_revision    la monitoría tiene un pago en revisión (D-39).
--   sin_pagos_aprobados  ningún pago aprobado: no hay nada que transferir (supuesto 2).
-- Los tres últimos los dice privado.bloqueo_del_desembolso, la misma que usa la vista de la bandeja.
-- monto_neto es el neto que se transferiría ahora, recalculado (P-29); en un desembolsado, el que se transfirió. Nunca
-- el bruto ni la comisión (supuesto 4).
create or replace function privado.estado_para_ejecutar(p_id_desembolso uuid, p_ahora timestamptz)
returns table (motivo text, monto_neto integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_estado public.estado_desembolso;
  v_neto_transferido integer;
  v_id_monitoria uuid;
  v_estado_monitoria public.estado_monitoria;
  v_fin_programado timestamptz;
begin
  select d.estado, d.monto_neto, d.id_monitoria, m.estado, pl.fin_programado
  into v_estado, v_neto_transferido, v_id_monitoria, v_estado_monitoria, v_fin_programado
  from public.desembolso d
  join public.monitoria m on m.id = d.id_monitoria
  join public.monitoria_plazos pl on pl.id_monitoria = d.id_monitoria
  where d.id = p_id_desembolso;
  if not found then
    motivo := 'no_encontrado';
    return next;
    return;
  end if;
  if v_estado = 'desembolsado' then
    motivo := 'desembolsado';
    monto_neto := v_neto_transferido;
    return next;
    return;
  end if;

  select c.monto_neto into monto_neto from privado.calcular_desembolso(v_id_monitoria) c;

  -- `is not true`: con una hora nula no se puede decir que ya pasó el plazo.
  motivo := case
    when v_estado = 'anulado' then 'anulado'
    when v_estado_monitoria <> 'realizada' then 'no_realizada'
    when public.desembolso_ejecutable(v_fin_programado, p_ahora) is not true then 'antes_de_plazo'
    else privado.bloqueo_del_desembolso(v_id_monitoria)
  end;
  return next;
end;
$$;

-- La versión con p_ahora queda interna: la usan estado_para_ejecutar_de_la_sesion, ejecutar_desembolso y las pruebas.
revoke all on function privado.estado_para_ejecutar(uuid, timestamptz) from public, anon, authenticated, service_role;

-- La que ejecuta la sesión del admin, con la hora de la base. Quien no es un admin activo no recibe filas.
create or replace function privado.estado_para_ejecutar_de_la_sesion(p_id_desembolso uuid)
returns table (motivo text, monto_neto integer)
language sql
stable
security definer
set search_path = ''
as $$
  select e.motivo, e.monto_neto
  from privado.estado_para_ejecutar(p_id_desembolso, now()) e
  where (select privado.es_admin());
$$;
comment on function privado.estado_para_ejecutar_de_la_sesion(uuid) is
  'Si el admin de la sesión puede ejecutar el desembolso ahora, por qué no y el neto: privado.estado_para_ejecutar sin p_ahora. HU-028.';
revoke all on function privado.estado_para_ejecutar_de_la_sesion(uuid) from public, anon, authenticated, service_role;
grant execute on function privado.estado_para_ejecutar_de_la_sesion(uuid) to authenticated;

-- La puerta en la Data API, con los permisos de quien llama.
create or replace function public.estado_para_ejecutar(p_id_desembolso uuid)
returns table (motivo text, monto_neto integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select e.motivo, e.monto_neto from privado.estado_para_ejecutar_de_la_sesion(p_id_desembolso) e;
$$;
comment on function public.estado_para_ejecutar(uuid) is
  'Para un admin: si el desembolso se puede ejecutar ahora (motivo nulo) o por qué no, y el neto que se transferiría. Nunca el bruto ni la comisión. HU-028.';
revoke all on function public.estado_para_ejecutar(uuid) from public, anon, authenticated, service_role;
grant execute on function public.estado_para_ejecutar(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- La bandeja: desembolsos_ejecutables coincide con estado_para_ejecutar (HU-012, RN-83, D-39)
-- ---------------------------------------------------------------------------
-- Parte de la versión vigente (20260929231832_ajustes_plazos_y_comision.sql) y le cambia solo el filtro: el `not
-- exists` del reporte pasa a privado.bloqueo_del_desembolso, que además excluye los que tienen un pago en revisión o
-- ningún pago aprobado. Así la bandeja solo lista lo que la página deja ejecutar a la hora de la base (la defensa
-- no_realizada de estado_para_ejecutar sigue fuera de la vista). Mismas columnas, en el mismo orden, y
-- security_invoker: create or replace view la reemplaza y conserva los permisos, que de todos modos se repiten abajo.
-- monto_neto sigue siendo el de la foto; el que se transfiere se recalcula al ejecutar (P-29).
create or replace view public.desembolsos_ejecutables
with (security_invoker = true)
as
select
  d.id,
  d.id_monitoria,
  d.monto_neto,
  d.fecha_generacion,
  p.desembolsable_desde,
  m.fecha as fecha_sesion
from public.desembolso d
join public.monitoria m on m.id = d.id_monitoria
join public.monitoria_plazos p on p.id_monitoria = d.id_monitoria
where d.estado = 'pendiente'
  and public.desembolso_ejecutable(p.fin_programado, now())
  and privado.bloqueo_del_desembolso(d.id_monitoria) is null;

comment on view public.desembolsos_ejecutables is
  'Desembolsos pendientes que ya se pueden ejecutar: la ventana de reporte venció (RN-83, N-6), sin reporte activo, sin pagos en revisión (D-39) y con al menos un pago aprobado; coincide con estado_para_ejecutar. El neto es el de la foto (P-29). Sin bruto, comisión ni llave. HU-012, HU-063 y HU-028.';

revoke all on table public.desembolsos_ejecutables from public, anon, authenticated, service_role;
grant select on table public.desembolsos_ejecutables to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Ejecutar el desembolso (RN-80, P-29, supuestos 3 y 5)
-- ---------------------------------------------------------------------------
-- p_referencia: se le quitan los espacios y saltos de línea de los bordes. p_fecha: el día de la transferencia, que se
-- guarda a mediodía en Bogotá. p_neto_esperado: el neto que vio el admin (nulo = no compara).
-- Resultado:
--   desembolsado          quedó desembolsado con id_admin = la sesión, la referencia, la fecha y los montos
--                         recalculados con los pagos aprobados de ahora (P-29).
--   monto_cambio          el neto de ahora no es p_neto_esperado: no se toca nada.
--   ya_desembolsado       ya se ejecutó (otro admin, un doble clic): no se toca nada.
--   anulado               la monitoría se canceló después de realizada (P-28): no se ejecuta.
--   no_realizada, antes_de_plazo, con_reporte, pagos_en_revision, sin_pagos_aprobados
--                         lo que diga privado.estado_para_ejecutar, ya con los candados.
--   fecha_invalida        sin fecha, futura en Bogotá o anterior a la fecha de la sesión.
--   referencia_invalida   vacía o de más de 100 caracteres.
--   no_encontrado         el desembolso no existe.
--   sin_permiso           quien llama no es un admin activo.
--   sin_sesion            no hay sesión.
create or replace function privado.ejecutar_desembolso(
  p_id_desembolso uuid,
  p_referencia text,
  p_fecha date,
  p_neto_esperado integer,
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
  -- [[:space:]] y no btrim, que solo quita espacios (como las observaciones de revisar_pago).
  v_referencia text := nullif(regexp_replace(p_referencia, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  v_id_monitoria uuid;
  v_fecha_sesion date;
  v_estado public.estado_desembolso;
  v_motivo text;
  v_bruto integer;
  v_comision integer;
  v_neto integer;
begin
  if v_uid is null then
    return 'sin_sesion';
  end if;
  if not (select privado.es_admin()) then
    return 'sin_permiso';
  end if;

  if v_referencia is null or char_length(v_referencia) > 100 then
    return 'referencia_invalida';
  end if;
  if p_fecha is null or p_fecha > (p_ahora at time zone 'America/Bogota')::date then
    return 'fecha_invalida';
  end if;

  -- La monitoría del desembolso, sin candado: hace falta para bloquear en orden. El desembolso no cambia de monitoría.
  select d.id_monitoria into v_id_monitoria from public.desembolso d where d.id = p_id_desembolso;
  if not found then
    return 'no_encontrado';
  end if;

  -- Primero la monitoría `for update` (en fila con revisar_pago, registrar_pago, el cierre automático, HU-029 y
  -- HU-030)...
  select m.fecha into v_fecha_sesion
  from public.monitoria m
  where m.id = v_id_monitoria
  for update;

  -- ...y después el desembolso. Dos admins a la vez quedan en fila: el segundo lee el estado que dejó el primero.
  select d.estado into v_estado
  from public.desembolso d
  where d.id = p_id_desembolso
  for update;
  if not found then
    return 'no_encontrado';
  end if;

  if v_estado = 'desembolsado' then
    return 'ya_desembolsado';
  end if;
  if v_estado = 'anulado' then
    return 'anulado';
  end if;
  if p_fecha < v_fecha_sesion then
    return 'fecha_invalida';
  end if;

  -- RN-83, N-6, D-39 y el supuesto 2 con la misma lógica que ve la pantalla, ahora que nada cambia.
  select e.motivo into v_motivo from privado.estado_para_ejecutar(p_id_desembolso, p_ahora) e;
  if v_motivo is not null then
    return v_motivo;
  end if;

  -- P-29: los montos de ahora. Nadie cambia un pago de la monitoría mientras se tiene su fila.
  select c.monto_bruto, c.comision, c.monto_neto into v_bruto, v_comision, v_neto
  from privado.calcular_desembolso(v_id_monitoria) c;
  if p_neto_esperado is not null and p_neto_esperado <> v_neto then
    return 'monto_cambio';
  end if;

  update public.desembolso
  set estado = 'desembolsado',
      id_admin = v_uid,
      referencia_transferencia = v_referencia,
      fecha_desembolso = (p_fecha + time '12:00') at time zone 'America/Bogota',
      monto_bruto = v_bruto,
      comision = v_comision,
      monto_neto = v_neto
  where id = p_id_desembolso;
  return 'desembolsado';
end;
$$;

-- La versión con p_ahora queda interna: ninguna sesión elige la hora ni mueve el borde de N-6.
revoke all on function privado.ejecutar_desembolso(uuid, text, date, integer, timestamptz)
  from public, anon, authenticated, service_role;

-- La que ejecuta la sesión del admin: la misma, con la hora de la base.
create or replace function privado.ejecutar_desembolso_de_la_sesion(
  p_id_desembolso uuid,
  p_referencia text,
  p_fecha date,
  p_neto_esperado integer
)
returns text
language sql
volatile
security definer
set search_path = ''
as $$
  select privado.ejecutar_desembolso(p_id_desembolso, p_referencia, p_fecha, p_neto_esperado, now());
$$;
comment on function privado.ejecutar_desembolso_de_la_sesion(uuid, text, date, integer) is
  'Ejecuta el desembolso con la sesión del admin y la hora de la base: privado.ejecutar_desembolso sin p_ahora. HU-028.';
revoke all on function privado.ejecutar_desembolso_de_la_sesion(uuid, text, date, integer)
  from public, anon, authenticated, service_role;
grant execute on function privado.ejecutar_desembolso_de_la_sesion(uuid, text, date, integer) to authenticated;

-- La puerta en la Data API, con los permisos de quien llama. Solo con sesión: service_role no tiene auth.uid().
create or replace function public.ejecutar_desembolso(
  p_id_desembolso uuid,
  p_referencia text,
  p_fecha date,
  p_neto_esperado integer
)
returns text
language sql
volatile
security invoker
set search_path = ''
as $$
  select privado.ejecutar_desembolso_de_la_sesion(p_id_desembolso, p_referencia, p_fecha, p_neto_esperado);
$$;
comment on function public.ejecutar_desembolso(uuid, text, date, integer) is
  'Un admin registra la transferencia de un desembolso ejecutable (referencia y fecha); los montos se recalculan al ejecutar. HU-028.';
revoke all on function public.ejecutar_desembolso(uuid, text, date, integer) from public, anon, authenticated, service_role;
grant execute on function public.ejecutar_desembolso(uuid, text, date, integer) to authenticated;
