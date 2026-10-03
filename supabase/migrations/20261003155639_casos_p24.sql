-- Pagos por cobrar o asumir: cerrar los casos P-24. HU-078.
--
-- P-24 (HU-020): si la sesión ya empezó, rechazar el pago no cancela la monitoría y el admin anota en
-- pago.observaciones qué se hará con ese cobro. D-39 (2-oct-2026): (a) esos casos se ven en la sección «Pagos por
-- cobrar o asumir» de la bandeja y un admin cierra cada uno como cobrado (el pagador pagó por fuera) o asumido
-- (Calibra no lo cobra); (b) en los dos casos el monto cuenta en el desembolso del monitor, con la misma comisión
-- (P-14, RN-81): amplía RN-45; (c) un desembolso no se ejecuta mientras su monitoría tenga un caso P-24 abierto, como
-- con un pago en revisión (HU-028). D-38: cerrar no se deshace y pide confirmación (la confirmación va en la pantalla).
-- RN-43: el pago rechazado no se reembolsa; cerrar el caso no lo aprueba: sigue rechazado.
--
-- Supuestos del registro de HU-078 (por confirmar con dvarela5101; no son decisiones D-n):
--   1. Un caso P-24 es un pago rechazado cuya monitoría no quedó cancelada. Si el rechazo la canceló (RN-43), o el
--      estudiante ya la había cancelado (P-07), no hay nada que cobrar ni asumir.
--   2. La sección la ven todos los admins activos y cualquiera cierra el caso.
--   3. El caso se cierra desde la página del pago; la nota es opcional, de hasta 500 caracteres.
--   4. Un caso cerrado cuenta en el desembolso aunque se haya cerrado después de que la monitoría se realizó: el monto
--      se recalcula al ejecutar (P-29).
--   5. Si no hay pagos aprobados ni casos cerrados, el desembolso sigue sin poder ejecutarse (nada que transferir).
--
-- Diseño (registro de HU-078):
--   * El cierre vive en columnas nuevas de pago: cierre_rechazo (cobrado o asumido), nota_cierre, id_admin_cierre y
--     fecha_cierre. Una restricción las ata: las cuatro nulas, o las tres obligatorias llenas solo en un pago
--     rechazado. id_admin_cierre es la tercera llave de pago a admin: cada embebido admin(...) desde pago en la app ya
--     nombra la suya (admin!pago_id_admin_fkey, como desde HU-077).
--   * Qué es un caso y si está abierto lo dice una sola función, privado.estado_caso_p24, que usan cerrar_caso_p24,
--     calcular_desembolso y bloqueo_del_desembolso. Recibe los estados (no ids) para que cerrar_caso_p24 decida con lo
--     que leyó bajo candado.
--   * privado.cerrar_caso_p24 bloquea la monitoría `for update` y después el pago, el orden de revisar_pago,
--     cancelar_cita y ejecutar_desembolso. Así cerrar y ejecutar el desembolso de esa monitoría quedan en fila: el
--     desembolso se ejecuta con el caso abierto (no se ejecuta) o ya cerrado (cuenta en el bruto), nunca a medias, y
--     sigue siendo cierto lo que dice ejecutar_desembolso: nadie cambia un pago de la monitoría mientras se tiene su
--     fila. Dos admins que cierran a la vez quedan en fila: el segundo lee el caso cerrado (ya_cerrado).
--   * Se redefinen desde su versión de main (20261003051738_desembolsos.sql, HU-028), y se dice qué cambió en cada una:
--     privado.calcular_desembolso (el bruto suma también los casos cerrados) y privado.bloqueo_del_desembolso (el
--     motivo nuevo caso_abierto). La vista desembolsos_ejecutables, privado.estado_para_ejecutar y
--     privado.ejecutar_desembolso ya usan esas dos funciones: no se redefinen; de la vista solo cambia el comentario.
--     El trigger de HU-028 también usa calcular_desembolso: la foto de una monitoría que pasa a realizada con un caso ya
--     cerrado lo cuenta.
--   * Nadie con sesión escribe en pago: lo hace la función security definer de privado con la identidad de la sesión
--     (auth.uid()). La versión con p_ahora queda interna, sin grant (como revisar_pago); la sesión entra por
--     privado.cerrar_caso_p24_de_la_sesion, que usa now(), desde la puerta public.cerrar_caso_p24.
-- Idempotente.

-- ---------------------------------------------------------------------------
-- El cierre del caso (criterio 2, supuesto 3)
-- ---------------------------------------------------------------------------
-- id_admin_cierre apunta a admin, que nunca se borra (RN-23). La lectura sigue la de la tabla: solo admins.
alter table public.pago add column if not exists cierre_rechazo text;
alter table public.pago add column if not exists nota_cierre text;
alter table public.pago add column if not exists id_admin_cierre uuid references public.admin (id);
alter table public.pago add column if not exists fecha_cierre timestamptz;
create index if not exists pago_id_admin_cierre_idx on public.pago (id_admin_cierre);

alter table public.pago drop constraint if exists pago_cierre_rechazo_valido;
alter table public.pago add constraint pago_cierre_rechazo_valido
  check (cierre_rechazo in ('cobrado', 'asumido'));
alter table public.pago drop constraint if exists pago_nota_cierre_con_texto;
alter table public.pago add constraint pago_nota_cierre_con_texto
  check (nota_cierre is null or (nota_cierre ~ '^[^[:space:]]' and nota_cierre ~ '[^[:space:]]$'
    and char_length(nota_cierre) <= 500));
-- Las cuatro nulas (sin cerrar) o, en un pago rechazado, cómo, quién y cuándo; la nota es opcional.
alter table public.pago drop constraint if exists pago_cierre_coherente;
alter table public.pago add constraint pago_cierre_coherente
  check ((cierre_rechazo is null and nota_cierre is null and id_admin_cierre is null and fecha_cierre is null)
    or (cierre_rechazo is not null and id_admin_cierre is not null and fecha_cierre is not null
        and estado = 'rechazado'));

comment on column public.pago.cierre_rechazo is
  'Cómo se cerró el caso P-24 de este pago rechazado: cobrado (el pagador pagó por fuera) o asumido (Calibra no lo cobra). Nula mientras el caso está abierto o si no es un caso. En los dos casos el monto cuenta en el desembolso (D-39). HU-078.';
comment on column public.pago.nota_cierre is
  'Nota opcional de quien cerró el caso P-24: de 1 a 500 caracteres, sin espacios en los bordes. HU-078.';
comment on column public.pago.id_admin_cierre is
  'El admin que cerró el caso P-24. Nula mientras el caso está abierto. HU-078.';
comment on column public.pago.fecha_cierre is
  'Cuándo se cerró el caso P-24. Nula mientras el caso está abierto. HU-078.';

-- ---------------------------------------------------------------------------
-- Qué es un caso P-24 y si está abierto (supuesto 1)
-- ---------------------------------------------------------------------------
-- La única definición. Nulo = el pago no es un caso (no está rechazado, o su monitoría está cancelada); abierto = es un
-- caso sin cerrar; cerrado = ya tiene cierre_rechazo. Recibe los valores y no los ids: cerrar_caso_p24 decide con lo
-- que leyó bajo candado, y las demás la llaman con el pago y su monitoría. security invoker y sin leer tablas: la usa
-- bloqueo_del_desembolso, que la vista desembolsos_ejecutables ejecuta con los permisos de quien consulta. Por eso
-- authenticated y service_role la ejecutan; privado no está en la Data API.
create or replace function privado.estado_caso_p24(
  p_estado_pago public.estado_pago,
  p_estado_monitoria public.estado_monitoria,
  p_cierre_rechazo text
)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when p_estado_pago = 'rechazado' and p_estado_monitoria <> 'cancelada' then
      case when p_cierre_rechazo is null then 'abierto' else 'cerrado' end
  end;
$$;
comment on function privado.estado_caso_p24(public.estado_pago, public.estado_monitoria, text) is
  'El caso P-24 de un pago: nulo si no es un caso (no está rechazado o su monitoría está cancelada), abierto o cerrado. La única definición: la usan cerrar_caso_p24, calcular_desembolso y bloqueo_del_desembolso. HU-078.';
revoke all on function privado.estado_caso_p24(public.estado_pago, public.estado_monitoria, text)
  from public, anon, authenticated, service_role;
grant execute on function privado.estado_caso_p24(public.estado_pago, public.estado_monitoria, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Cerrar el caso (criterio 2, supuestos 2 y 3)
-- ---------------------------------------------------------------------------
-- p_cierre: 'cobrado' o 'asumido'. p_nota: opcional (se le quitan los espacios y saltos de línea de los bordes; vacía
-- cuenta como ninguna).
-- Resultado:
--   cerrado          el caso quedó cerrado con p_cierre, la nota, id_admin_cierre = la sesión y fecha_cierre = ahora.
--                    El pago sigue rechazado; desde ahora cuenta en el desembolso (D-39).
--   ya_cerrado       el caso ya estaba cerrado (otro admin, un doble clic): no se toca nada.
--   no_es_caso       el pago no está rechazado o su monitoría está cancelada (supuesto 1): no se toca nada.
--   no_encontrado    el pago no existe.
--   nota_invalida    la nota pasa de 500 caracteres.
--   cierre_invalido  p_cierre no es cobrado ni asumido.
--   sin_permiso      quien llama no es un admin activo (supuesto 2: cualquier admin activo cierra).
--   sin_sesion       no hay sesión.
create or replace function privado.cerrar_caso_p24(
  p_id_pago uuid,
  p_cierre text,
  p_nota text default null,
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
  v_nota text := nullif(regexp_replace(p_nota, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  v_id_monitoria uuid;
  v_estado_monitoria public.estado_monitoria;
  v_estado_pago public.estado_pago;
  v_cierre_rechazo text;
  v_caso text;
begin
  if v_uid is null then
    return 'sin_sesion';
  end if;
  if not (select privado.es_admin()) then
    return 'sin_permiso';
  end if;

  if p_cierre is null or p_cierre not in ('cobrado', 'asumido') then
    return 'cierre_invalido';
  end if;
  if char_length(v_nota) > 500 then
    return 'nota_invalida';
  end if;

  -- La monitoría del pago, sin candado: hace falta para bloquear en orden. El pago no cambia de monitoría.
  select p.id_monitoria into v_id_monitoria from public.pago p where p.id = p_id_pago;
  if not found then
    return 'no_encontrado';
  end if;

  -- Primero la monitoría `for update` (en fila con revisar_pago, cancelar_cita, ejecutar_desembolso y el cierre
  -- automático)...
  select m.estado into v_estado_monitoria
  from public.monitoria m
  where m.id = v_id_monitoria
  for update;

  -- ...y después el pago. Dos admins a la vez quedan en fila: el segundo lee el cierre que dejó el primero.
  select p.estado, p.cierre_rechazo into v_estado_pago, v_cierre_rechazo
  from public.pago p
  where p.id = p_id_pago
  for update;
  if not found then
    return 'no_encontrado';
  end if;

  v_caso := privado.estado_caso_p24(v_estado_pago, v_estado_monitoria, v_cierre_rechazo);
  if v_caso is null then
    return 'no_es_caso';
  end if;
  -- D-38: cerrar no se deshace ni se rehace.
  if v_caso = 'cerrado' then
    return 'ya_cerrado';
  end if;

  update public.pago
  set cierre_rechazo = p_cierre,
      nota_cierre = v_nota,
      id_admin_cierre = v_uid,
      fecha_cierre = p_ahora
  where id = p_id_pago;
  return 'cerrado';
end;
$$;

-- La versión con p_ahora queda interna: ninguna sesión elige la hora del cierre. La usan cerrar_caso_p24_de_la_sesion,
-- con now(), y las pruebas, como postgres.
revoke all on function privado.cerrar_caso_p24(uuid, text, text, timestamptz)
  from public, anon, authenticated, service_role;

-- La que ejecuta la sesión del admin: la misma, con la hora de la base.
create or replace function privado.cerrar_caso_p24_de_la_sesion(
  p_id_pago uuid,
  p_cierre text,
  p_nota text default null
)
returns text
language sql
volatile
security definer
set search_path = ''
as $$
  select privado.cerrar_caso_p24(p_id_pago, p_cierre, p_nota, now());
$$;
comment on function privado.cerrar_caso_p24_de_la_sesion(uuid, text, text) is
  'Cierra el caso P-24 con la sesión del admin y la hora de la base: privado.cerrar_caso_p24 sin p_ahora. HU-078.';
revoke all on function privado.cerrar_caso_p24_de_la_sesion(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function privado.cerrar_caso_p24_de_la_sesion(uuid, text, text) to authenticated;

-- La puerta en la Data API, con los permisos de quien llama. Solo con sesión: service_role no tiene auth.uid().
create or replace function public.cerrar_caso_p24(
  p_id_pago uuid,
  p_cierre text,
  p_nota text default null
)
returns text
language sql
volatile
security invoker
set search_path = ''
as $$
  select privado.cerrar_caso_p24_de_la_sesion(p_id_pago, p_cierre, p_nota);
$$;
comment on function public.cerrar_caso_p24(uuid, text, text) is
  'Un admin activo cierra el caso P-24 de un pago rechazado como cobrado o asumido, con una nota opcional; no se deshace y desde ahí el monto cuenta en el desembolso (D-39). HU-078.';
revoke all on function public.cerrar_caso_p24(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.cerrar_caso_p24(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Los montos: un caso cerrado cuenta en el bruto (criterio 3, D-39 (b), supuesto 4)
-- ---------------------------------------------------------------------------
-- privado.calcular_desembolso de 20261003051738_desembolsos.sql. Un cambio, marcado con HU-078: el bruto suma los
-- pagos aprobados y los rechazados con el caso P-24 cerrado (cobrado o asumido), por eso lee también la monitoría de
-- cada pago. La firma, la comisión de public.comision sobre ese total (RN-81, P-14), security definer y los permisos
-- (ninguno) no cambian. Se le agrega un comentario.
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
    -- HU-078: la monitoría dice si el pago rechazado es un caso P-24.
    join public.monitoria m on m.id = p.id_monitoria
    where p.id_monitoria = p_id_monitoria
      -- HU-078 (D-39 (b)): también los rechazados con el caso cerrado.
      and (p.estado = 'aprobado' or privado.estado_caso_p24(p.estado, m.estado, p.cierre_rechazo) = 'cerrado')
  ) b;
$$;

revoke all on function privado.calcular_desembolso(uuid) from public, anon, authenticated, service_role;
comment on function privado.calcular_desembolso(uuid) is
  'Bruto (los pagos aprobados más los rechazados con el caso P-24 cerrado), comisión y neto del desembolso de la monitoría. La única fuente de los montos, para el trigger y la ejecución. HU-028, HU-078.';

-- ---------------------------------------------------------------------------
-- Lo que bloquea un desembolso por su monitoría: el caso abierto (criterio 4, D-39 (c), supuesto 5)
-- ---------------------------------------------------------------------------
-- privado.bloqueo_del_desembolso de 20261003051738_desembolsos.sql. Dos cambios, marcados con HU-078; la firma, el
-- orden de los motivos de antes, security invoker y los permisos no cambian. Nulo = nada la bloquea; si no, el primero
-- que aplique:
--   con_reporte          un reporte de inasistencia en revisión o aceptado (uno rechazado no bloquea).
--   pagos_en_revision    un pago en revisión (D-39): ese dinero todavía puede contar (P-29).
--   caso_abierto         (nuevo) un caso P-24 abierto (D-39 (c)): si se cierra, ese monto cuenta (supuesto 4).
--   sin_pagos_aprobados  ningún pago aprobado ni caso cerrado: no hay nada que transferir (supuesto 5). Conserva el
--                        nombre de HU-028, que la app ya conoce; ahora también mira los casos cerrados, como el bruto.
-- caso_abierto va antes que sin_pagos_aprobados por la misma razón que pagos_en_revision: un caso abierto todavía puede
-- contar. Lo usan estado_para_ejecutar (la página y la ejecución) y la vista desembolsos_ejecutables (la bandeja), que
-- así no listan un desembolso con un caso abierto, y la ejecución lo vuelve a validar bajo candado.
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
    -- HU-078 (D-39 (c)): un caso P-24 abierto.
    when exists (
      select 1 from public.pago p
      join public.monitoria m on m.id = p.id_monitoria
      where p.id_monitoria = p_id_monitoria
        and privado.estado_caso_p24(p.estado, m.estado, p.cierre_rechazo) = 'abierto'
    ) then 'caso_abierto'
    -- HU-078 (supuesto 5): lo mismo que suma calcular_desembolso, los aprobados y los casos cerrados.
    when not exists (
      select 1 from public.pago p
      join public.monitoria m on m.id = p.id_monitoria
      where p.id_monitoria = p_id_monitoria
        and (p.estado = 'aprobado' or privado.estado_caso_p24(p.estado, m.estado, p.cierre_rechazo) = 'cerrado')
    ) then 'sin_pagos_aprobados'
  end;
$$;
comment on function privado.bloqueo_del_desembolso(uuid) is
  'Por qué la monitoría no deja ejecutar su desembolso (con_reporte, pagos_en_revision, caso_abierto, sin_pagos_aprobados) o nulo. La usan estado_para_ejecutar y la vista desembolsos_ejecutables. HU-028, HU-078.';
revoke all on function privado.bloqueo_del_desembolso(uuid) from public, anon, authenticated, service_role;
grant execute on function privado.bloqueo_del_desembolso(uuid) to authenticated, service_role;

-- La vista no cambia (ya filtra con bloqueo_del_desembolso); su comentario sí.
comment on view public.desembolsos_ejecutables is
  'Desembolsos pendientes que ya se pueden ejecutar: la ventana de reporte venció (RN-83, N-6), sin reporte activo, sin pagos en revisión ni casos P-24 abiertos (D-39) y con al menos un pago aprobado o un caso cerrado; coincide con estado_para_ejecutar. El neto es el de la foto (P-29). Sin bruto, comisión ni llave. HU-012, HU-063, HU-028 y HU-078.';
