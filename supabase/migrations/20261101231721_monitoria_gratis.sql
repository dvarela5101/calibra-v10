-- Monitoría de prueba gratis: un admin la marca y el estudiante la ve «Gratis». HU-116.
--
-- D-84 (dvarela5101, 1-nov-2026): (a) el precio de la franja y de la monitoría no cambia (`valor_total > 0` sigue igual): lo
-- gratis es una marca de la monitoría, no un precio 0; (b) solo un admin la marca, desde la ficha de la cita; (c) el estudiante
-- ve el precio normal tachado y «Gratis» en verde, sin la palabra «prueba».
--
-- Supuestos de la HU (d–g, por confirmar con dvarela5101) y los que salen de construirla (quedan en el registro de la HU):
--   d. Se marca una individual en `pendiente_pago`, con la reserva vigente y sin ningún pago, y pasa a `confirmada` sin pago ni
--      comprobante. Una confirmada, realizada o cancelada no se marca. Se desmarca solo mientras siga confirmada y no haya
--      empezado: vuelve a `pendiente_pago` con su precio normal.
--   e. Sin dinero: no tiene pagos, así que no hay reembolso al cancelarla ni al aceptar un reporte de inasistencia (los dos
--      salen de los pagos aprobados), y el trigger del desembolso la salta: no nace desembolso al pasar a realizada.
--   f. La confirmación al estudiante sale como siempre (el trigger de `confirmacion_cita` mira el cambio de estado) y lee la
--      marca para decir «Gratis» en vez de pedir el pago.
--   g. Cada marca y cada desmarca quedan en public.marca_gratis (quién y cuándo), que solo leen los admins.
--   h. (nuevo) RN-34 da 10 minutos para pagar desde que se aparta la fecha (`reserva_hasta(fecha_creacion)`). Al desmarcar, la
--      reserva vuelve a contar desde ese momento (`fecha_creacion` = la hora del desmarcado): si no, la monitoría volvería ya
--      vencida y el proceso de cada minuto la cancelaría antes de que el estudiante alcance a pagar.
--   i. (nuevo) Al desmarcar no se manda correo: el estudiante ve el pago en su reserva. La confirmación ya anotada no se repite
--      si después paga (su token de gestión es el mismo, D-20).
--
-- Qué cambia en lo que ya existe (cada pieza parte de su última versión en `main`):
--   * public.monitoria: la columna `gratis` y un check (una gratis nunca está por pagar). La leen los participantes y los admins
--     con la política de siempre; nadie con sesión escribe `monitoria`.
--   * privado.crear_desembolso_al_realizar, de 20261003051738_desembolsos.sql: salta las gratis.
--   * privado.datos_de_cita, de 20261028033026_lugar_por_monitoria.sql, y sus tres puertas (public.cita_por_token,
--     privado/public.mi_cita, privado/public.mis_citas, de 20261003202252_reportar_inasistencia.sql): una columna más al final,
--     `gratis`. Postgres no deja cambiar las columnas de salida con `create or replace`: se borran y se recrean con sus permisos.
--   * public.datos_de_confirmacion_cita, de 20261028033026_lugar_por_monitoria.sql: lo mismo, para el correo.
--   scripts/verificar-bd.mjs borra datos_de_confirmacion_cita antes de reaplicar 20261002064121_confirmacion_cita.sql, como ya
--   hacía con las otras seis.
--
-- No se toca el mínimo de precio (`franja_precio_positivo`, `monitoria_valor_positivo`), ni el pago, ni las grupales.
--
-- Candados: la monitoría `for update`, como todas las funciones que la tocan (HU-018, HU-020, HU-052). registrar_pago toma el
-- mismo candado antes de crear el pago, así que una marca y un comprobante a la vez quedan en fila: si el pago llega primero, la
-- marca ve la monitoría confirmada y responde `no_por_pagar`; si la marca llega primero, registrar_pago la ve confirmada y no
-- crea el pago.
-- Idempotente: db:verificar reaplica cada migración sobre la base final.

-- ---------------------------------------------------------------------------
-- La marca en la monitoría (D-84 a)
-- ---------------------------------------------------------------------------
alter table public.monitoria add column if not exists gratis boolean not null default false;

comment on column public.monitoria.gratis is
  'Monitoría regalada por un admin (D-84): confirmada sin pago, sin desembolso ni reembolso; valor_total conserva el precio normal. Solo la cambia privado.marcar_monitoria_gratis. HU-116.';

-- Una gratis nunca está por pagar: marcar la confirma y desmarcar le quita la marca a la vez que la devuelve a por pagar.
alter table public.monitoria drop constraint if exists monitoria_gratis_no_por_pagar;
alter table public.monitoria add constraint monitoria_gratis_no_por_pagar check (not gratis or estado <> 'pendiente_pago');

-- ---------------------------------------------------------------------------
-- El registro: quién marcó o desmarcó, y cuándo (supuesto g)
-- ---------------------------------------------------------------------------
-- Una fila por cada marca o desmarca: se conserva la historia. `on delete cascade` en la monitoría, como
-- cancelacion_excepcional; `id_admin` sin cascada: a un admin se le desactiva y no se borra (RN-23).
create table if not exists public.marca_gratis (
  id uuid primary key default gen_random_uuid(),
  id_monitoria uuid not null references public.monitoria (id) on delete cascade,
  id_admin uuid not null references public.admin (id),
  gratis boolean not null,
  hecha_en timestamptz not null default now()
);
create index if not exists marca_gratis_id_monitoria_idx on public.marca_gratis (id_monitoria, hecha_en desc);
create index if not exists marca_gratis_id_admin_idx on public.marca_gratis (id_admin);

comment on table public.marca_gratis is
  'Cada vez que un admin marcó una monitoría como gratis o le quitó la marca (D-84): quién y cuándo. Solo la leen los admins; no sale en ninguna página ni correo del estudiante o del monitor. La escribe privado.marcar_monitoria_gratis. HU-116.';
comment on column public.marca_gratis.gratis is 'true: la marcó como gratis; false: le quitó la marca.';
comment on column public.marca_gratis.hecha_en is 'La hora de la base cuando el admin la marcó o desmarcó, nunca la del navegador.';

-- Solo los admins la leen; nadie con sesión la escribe. service_role la lee (las pruebas) y tampoco la escribe.
alter table public.marca_gratis enable row level security;
revoke all on table public.marca_gratis from public, anon, authenticated, service_role;
grant select on table public.marca_gratis to authenticated, service_role;

drop policy if exists "admin lee" on public.marca_gratis;
create policy "admin lee" on public.marca_gratis
  for select to authenticated
  using ((select privado.es_admin()));

-- ---------------------------------------------------------------------------
-- Marcar y desmarcar (tres capas, como HU-052)
-- ---------------------------------------------------------------------------
-- p_gratis: true marca, false desmarca. p_ahora nulo se toma como now(). Resultado, en el orden en que se mira:
--   marcada          estaba por pagar, con la reserva vigente y sin pagos: quedó confirmada y gratis, con su registro.
--   desmarcada       estaba confirmada, gratis y sin empezar: quedó por pagar, sin la marca y con la reserva desde ahora (h).
--   sin_sesion       no hay sesión.
--   sin_permiso      quien llama no es un admin activo (también si lo desactivaron mientras esperaba el candado).
--   pedido_invalido  p_gratis es nulo.
--   no_existe        no hay monitoría con ese id.
--   no_individual    es una grupal (fuera de alcance).
--   ya_marcada       al marcar: ya es gratis (un doble clic u otro admin).
--   no_por_pagar     al marcar: no está por pagar (confirmada, realizada o cancelada).
--   reserva_vencida  al marcar: la reserva de 10 minutos ya venció (RN-34) y el proceso de cada minuto la va a cancelar.
--   con_pagos        al marcar: ya tiene algún pago (defensa: con un comprobante la monitoría ya no está por pagar).
--   no_marcada       al desmarcar: no es gratis.
--   no_confirmada    al desmarcar: no está confirmada (realizada o cancelada).
--   ya_empezo        llegó el inicio de la sesión (o falta un dato de la hora: falla cerrado).
-- Ninguno escribe nada salvo `marcada` y `desmarcada`. El admin del registro es siempre auth.uid(). La versión con p_ahora queda
-- interna, sin grant: la sesión entra por privado.marcar_monitoria_gratis_de_la_sesion, con now().
create or replace function privado.marcar_monitoria_gratis(p_id_monitoria uuid, p_gratis boolean, p_ahora timestamptz default now())
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_ahora timestamptz := coalesce(p_ahora, now());
  v_estado public.estado_monitoria;
  v_gratis boolean;
  v_fecha date;
  v_fecha_creacion timestamptz;
  v_id_franja uuid;
  v_hora time;
begin
  if v_uid is null then
    return 'sin_sesion';
  end if;
  if not (select privado.es_admin()) then
    return 'sin_permiso';
  end if;
  if p_gratis is null then
    return 'pedido_invalido';
  end if;

  select m.estado, m.gratis, m.fecha, m.fecha_creacion, m.id_franja
    into v_estado, v_gratis, v_fecha, v_fecha_creacion, v_id_franja
  from public.monitoria m
  where m.id = p_id_monitoria
  for update;
  if not found then
    return 'no_existe';
  end if;

  -- Bajo el candado se vuelve a mirar que siga siendo un admin activo (como HU-052).
  if not privado.admin_activo(v_uid) then
    return 'sin_permiso';
  end if;
  if exists (select 1 from public.monitoria_grupal g where g.id_monitoria = p_id_monitoria) then
    return 'no_individual';
  end if;

  if p_gratis then
    if v_gratis then
      return 'ya_marcada';
    end if;
    if v_estado <> 'pendiente_pago' then
      return 'no_por_pagar';
    end if;
    if privado.reserva_vencida(p_id_monitoria, v_estado, v_fecha_creacion, v_ahora) then
      return 'reserva_vencida';
    end if;
    if exists (select 1 from public.pago p where p.id_monitoria = p_id_monitoria) then
      return 'con_pagos';
    end if;
  else
    if not v_gratis then
      return 'no_marcada';
    end if;
    if v_estado <> 'confirmada' then
      return 'no_confirmada';
    end if;
  end if;

  -- RN-64: desde el instante exacto del inicio la sesión ya empezó. `is not false` falla cerrado con un dato nulo.
  select f.hora into v_hora from public.franja f where f.id = v_id_franja;
  if public.plazo_alcanzado(public.inicio_sesion(v_fecha, v_hora), v_ahora) is not false then
    return 'ya_empezo';
  end if;

  if p_gratis then
    -- Los triggers de siempre anotan la confirmación al estudiante y el aviso al monitor (pendiente_pago → confirmada).
    update public.monitoria set gratis = true, estado = 'confirmada' where id = p_id_monitoria;
  else
    -- Supuesto h: la reserva de 10 minutos vuelve a contar desde ahora. Ningún trigger anota correo en confirmada → por pagar.
    update public.monitoria set gratis = false, estado = 'pendiente_pago', fecha_creacion = v_ahora where id = p_id_monitoria;
  end if;
  insert into public.marca_gratis (id_monitoria, id_admin, gratis, hecha_en) values (p_id_monitoria, v_uid, p_gratis, v_ahora);
  return case when p_gratis then 'marcada' else 'desmarcada' end;
end;
$$;

comment on function privado.marcar_monitoria_gratis(uuid, boolean, timestamptz) is
  'Un admin activo marca una individual por pagar como gratis (queda confirmada sin pago) o le quita la marca (vuelve a por pagar), con su registro (D-84). Interna: la sesión entra por public.marcar_monitoria_gratis. HU-116.';

revoke all on function privado.marcar_monitoria_gratis(uuid, boolean, timestamptz) from public, anon, authenticated, service_role;

-- La que ejecuta la sesión del admin: la misma, con la hora de la base.
create or replace function privado.marcar_monitoria_gratis_de_la_sesion(p_id_monitoria uuid, p_gratis boolean)
returns text
language sql
volatile
security definer
set search_path = ''
as $$
  select privado.marcar_monitoria_gratis(p_id_monitoria, p_gratis, now());
$$;

comment on function privado.marcar_monitoria_gratis_de_la_sesion(uuid, boolean) is
  'Marca o desmarca una monitoría gratis con la sesión del admin y la hora de la base: privado.marcar_monitoria_gratis sin p_ahora. HU-116.';

revoke all on function privado.marcar_monitoria_gratis_de_la_sesion(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function privado.marcar_monitoria_gratis_de_la_sesion(uuid, boolean) to authenticated;

-- La puerta en la Data API, con los permisos de quien llama. Solo con sesión: service_role no tiene auth.uid().
create or replace function public.marcar_monitoria_gratis(p_id_monitoria uuid, p_gratis boolean)
returns text
language sql
volatile
security invoker
set search_path = ''
as $$
  select privado.marcar_monitoria_gratis_de_la_sesion(p_id_monitoria, p_gratis);
$$;

comment on function public.marcar_monitoria_gratis(uuid, boolean) is
  'Un admin activo marca como gratis una individual por pagar (queda confirmada sin pago) o le quita la marca mientras no empiece (D-84). HU-116.';

revoke all on function public.marcar_monitoria_gratis(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.marcar_monitoria_gratis(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- El desembolso: una gratis no tiene (supuesto e)
-- ---------------------------------------------------------------------------
-- privado.crear_desembolso_al_realizar de 20261003051738_desembolsos.sql. Un cambio, marcado con HU-116; la firma, security
-- definer y los permisos no cambian, y el trigger que la llama tampoco.
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
  -- HU-116 (D-84): una monitoría gratis no se cobra ni se le paga al monitor.
  if new.gratis then
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

-- ---------------------------------------------------------------------------
-- La cita y el correo de confirmación dicen si es gratis (D-84 c, supuesto f)
-- ---------------------------------------------------------------------------
-- `create or replace` no deja cambiar las columnas de salida. Borrarlas borra sus permisos: se repiten abajo.
drop function if exists public.cita_por_token(text);
drop function if exists public.mi_cita(uuid);
drop function if exists public.mis_citas();
drop function if exists privado.mi_cita(uuid);
drop function if exists privado.mis_citas();
drop function if exists privado.datos_de_cita(uuid);
drop function if exists public.datos_de_confirmacion_cita(uuid);

-- El cuerpo de 20261028033026_lugar_por_monitoria.sql con `gratis` al final.
create function public.datos_de_confirmacion_cita(p_id_monitoria uuid)
returns table (
  token text,
  creada_en timestamptz,
  estado public.estado_monitoria,
  grupal boolean,
  correo_destino text,
  nombre_lead text,
  nombre_monitor text,
  nombre_materia text,
  inicio timestamptz,
  duracion_min integer,
  presencial boolean,
  lugar text,
  enlace text,
  valor_total integer,
  cancelable_hasta timestamptz,
  gratis boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    c.token,
    c.creada_en,
    m.estado,
    g.id_monitoria is not null,
    coalesce(
      l.correo,
      (select p.contacto from public.pago p where p.id_monitoria = m.id order by p.fecha_pago, p.id limit 1)
    ),
    l.nombre,
    mo.nombre,
    ma.nombre,
    t.inicio,
    f.duracion_min,
    f.presencial,
    lm.lugar,
    lm.enlace,
    m.valor_total,
    public.cancelable_hasta(t.inicio, g.id_monitoria is not null),
    m.gratis
  from public.confirmacion_cita c
  join public.monitoria m on m.id = c.id_monitoria
  join public.franja f on f.id = m.id_franja
  left join public.lugar_de_monitoria lm on lm.id_monitoria = m.id
  join public.materia ma on ma.id = m.id_materia
  join public.monitor mo on mo.id = m.id_monitor
  join public.lead l on l.id = m.id_lead
  left join public.monitoria_grupal g on g.id_monitoria = m.id
  cross join lateral (select public.inicio_sesion(m.fecha, f.hora) as inicio) t
  where c.id_monitoria = p_id_monitoria;
$$;

comment on function public.datos_de_confirmacion_cita(uuid) is
  'Lo que la app necesita para el correo de confirmación de una cita, con el lugar y el enlace de la monitoría y si es gratis (D-84). Sin filas si la monitoría no tiene confirmación anotada. Solo para el servidor (service_role). HU-019, HU-107, HU-116.';

revoke all on function public.datos_de_confirmacion_cita(uuid) from public, anon, authenticated, service_role;
grant execute on function public.datos_de_confirmacion_cita(uuid) to service_role;

-- El cuerpo de 20261028033026_lugar_por_monitoria.sql con `gratis` al final. Lo demás, como en HU-019 y HU-029: security
-- definer porque ni el servidor con el token ni el Lead leen `pago`, `reembolso` ni `reporte_inasistencia`; no controla de quién
-- es la cita (lo hacen las puertas); solo la ejecuta service_role. Sin filas si la monitoría no existe o es grupal.
create function privado.datos_de_cita(p_id_monitoria uuid)
returns table (
  id_lead uuid,
  id_monitoria uuid,
  estado public.estado_monitoria,
  motivo_cancelacion public.motivo_cancelacion,
  nombre_monitor text,
  nombre_materia text,
  codigo_materia text,
  fecha date,
  hora time,
  duracion_min integer,
  presencial boolean,
  valor_total integer,
  lugar text,
  enlace text,
  inicio timestamptz,
  fin_programado timestamptz,
  cancelable_hasta timestamptz,
  reporte_hasta timestamptz,
  estado_pago text,
  estado_reembolso text,
  estado_reporte text,
  observaciones_reporte text,
  gratis boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.id_lead,
    m.id,
    m.estado,
    m.motivo_cancelacion,
    mo.nombre,
    ma.nombre,
    ma.codigo,
    m.fecha,
    f.hora,
    f.duracion_min,
    f.presencial,
    m.valor_total,
    case when m.estado = 'confirmada' then lm.lugar end,
    case when m.estado = 'confirmada' then lm.enlace end,
    t.inicio,
    t.fin,
    public.cancelable_hasta(t.inicio, false),
    public.reporte_inasistencia_hasta(t.fin),
    pa.estado_pago,
    re.estado_reembolso,
    rp.estado_reporte,
    rp.observaciones_reporte,
    m.gratis
  from public.monitoria m
  join public.franja f on f.id = m.id_franja
  left join public.lugar_de_monitoria lm on lm.id_monitoria = m.id
  join public.materia ma on ma.id = m.id_materia
  join public.monitor mo on mo.id = m.id_monitor
  cross join lateral (
    select public.inicio_sesion(m.fecha, f.hora) as inicio,
           public.fin_programado(public.inicio_sesion(m.fecha, f.hora), f.duracion_min) as fin
  ) t
  cross join lateral (
    select case
      when bool_or(p.estado = 'rechazado') then 'rechazado'
      when bool_or(p.estado = 'en_revision') then 'en_revision'
      when bool_or(p.estado = 'aprobado') then 'aprobado'
      else 'sin_pagar'
    end as estado_pago
    from public.pago p
    where p.id_monitoria = m.id
  ) pa
  cross join lateral (
    select case
      when bool_or(r.estado = 'esperando_llave') then 'esperando_llave'
      when bool_or(r.estado = 'pendiente') then 'pendiente'
      when bool_or(r.estado = 'reembolsado') then 'reembolsado'
    end as estado_reembolso
    from public.reembolso r
    join public.pago p on p.id = r.id_pago
    where p.id_monitoria = m.id
  ) re
  left join lateral (
    select r.estado::text as estado_reporte,
           case when r.estado <> 'en_revision' then nullif(btrim(r.observaciones, E' \t\r\n'), '') end as observaciones_reporte
    from public.reporte_inasistencia r
    where r.id_monitoria = m.id
  ) rp on true
  where m.id = p_id_monitoria
    and not exists (select 1 from public.monitoria_grupal g where g.id_monitoria = m.id);
$$;

comment on function privado.datos_de_cita(uuid) is
  'La cita individual para la página, sin controlar de quién es (lo hacen cita_por_token, mi_cita y mis_citas). Lugar y enlace solo si está confirmada (D-21); con las observaciones del reporte ya decidido (D-37) y si es gratis (D-84). HU-019, HU-029 y HU-116.';

revoke all on function privado.datos_de_cita(uuid) from public, anon, authenticated, service_role;
grant execute on function privado.datos_de_cita(uuid) to service_role;

-- Puerta 1: el enlace del correo (servidor). Igual que en HU-029, con `gratis`.
create function public.cita_por_token(p_token text)
returns table (
  id_monitoria uuid,
  estado public.estado_monitoria,
  motivo_cancelacion public.motivo_cancelacion,
  nombre_monitor text,
  nombre_materia text,
  codigo_materia text,
  fecha date,
  hora time,
  duracion_min integer,
  presencial boolean,
  valor_total integer,
  lugar text,
  enlace text,
  inicio timestamptz,
  fin_programado timestamptz,
  cancelable_hasta timestamptz,
  reporte_hasta timestamptz,
  estado_pago text,
  estado_reembolso text,
  estado_reporte text,
  observaciones_reporte text,
  gratis boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select d.id_monitoria, d.estado, d.motivo_cancelacion, d.nombre_monitor, d.nombre_materia, d.codigo_materia, d.fecha,
         d.hora, d.duracion_min, d.presencial, d.valor_total, d.lugar, d.enlace, d.inicio, d.fin_programado,
         d.cancelable_hasta, d.reporte_hasta, d.estado_pago, d.estado_reembolso, d.estado_reporte,
         d.observaciones_reporte, d.gratis
  from public.confirmacion_cita c
  cross join lateral privado.datos_de_cita(c.id_monitoria) d
  where c.token = p_token;
$$;

comment on function public.cita_por_token(text) is
  'La cita de un token de gestión (P-04, RN-12), sin datos de contacto. Sin filas si el token no existe. Solo para el servidor (service_role). HU-019.';

revoke all on function public.cita_por_token(text) from public, anon, authenticated, service_role;
grant execute on function public.cita_por_token(text) to service_role;

-- Puerta 2: una cita de la sesión. Igual que en HU-029, con `gratis`.
create function privado.mi_cita(p_id_monitoria uuid)
returns table (
  id_monitoria uuid,
  estado public.estado_monitoria,
  motivo_cancelacion public.motivo_cancelacion,
  nombre_monitor text,
  nombre_materia text,
  codigo_materia text,
  fecha date,
  hora time,
  duracion_min integer,
  presencial boolean,
  valor_total integer,
  lugar text,
  enlace text,
  inicio timestamptz,
  fin_programado timestamptz,
  cancelable_hasta timestamptz,
  reporte_hasta timestamptz,
  estado_pago text,
  estado_reembolso text,
  estado_reporte text,
  observaciones_reporte text,
  gratis boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id_monitoria, d.estado, d.motivo_cancelacion, d.nombre_monitor, d.nombre_materia, d.codigo_materia, d.fecha,
         d.hora, d.duracion_min, d.presencial, d.valor_total, d.lugar, d.enlace, d.inicio, d.fin_programado,
         d.cancelable_hasta, d.reporte_hasta, d.estado_pago, d.estado_reembolso, d.estado_reporte,
         d.observaciones_reporte, d.gratis
  from privado.datos_de_cita(p_id_monitoria) d
  where privado.es_mi_lead(d.id_lead);
$$;

revoke all on function privado.mi_cita(uuid) from public, anon, authenticated, service_role;
grant execute on function privado.mi_cita(uuid) to authenticated;

create function public.mi_cita(p_id_monitoria uuid)
returns table (
  id_monitoria uuid,
  estado public.estado_monitoria,
  motivo_cancelacion public.motivo_cancelacion,
  nombre_monitor text,
  nombre_materia text,
  codigo_materia text,
  fecha date,
  hora time,
  duracion_min integer,
  presencial boolean,
  valor_total integer,
  lugar text,
  enlace text,
  inicio timestamptz,
  fin_programado timestamptz,
  cancelable_hasta timestamptz,
  reporte_hasta timestamptz,
  estado_pago text,
  estado_reembolso text,
  estado_reporte text,
  observaciones_reporte text,
  gratis boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id_monitoria, c.estado, c.motivo_cancelacion, c.nombre_monitor, c.nombre_materia, c.codigo_materia, c.fecha,
         c.hora, c.duracion_min, c.presencial, c.valor_total, c.lugar, c.enlace, c.inicio, c.fin_programado,
         c.cancelable_hasta, c.reporte_hasta, c.estado_pago, c.estado_reembolso, c.estado_reporte,
         c.observaciones_reporte, c.gratis
  from privado.mi_cita(p_id_monitoria) c;
$$;

comment on function public.mi_cita(uuid) is
  'Una cita individual del Lead de la sesión, sin datos de contacto (P-04, criterio 4). Sin filas si no es suya. HU-019.';

revoke all on function public.mi_cita(uuid) from public, anon, authenticated, service_role;
grant execute on function public.mi_cita(uuid) to authenticated;

-- Puerta 3: las citas de la sesión. Igual que en HU-029, con `gratis`.
create function privado.mis_citas()
returns table (
  id_monitoria uuid,
  estado public.estado_monitoria,
  motivo_cancelacion public.motivo_cancelacion,
  nombre_monitor text,
  nombre_materia text,
  codigo_materia text,
  fecha date,
  hora time,
  duracion_min integer,
  presencial boolean,
  valor_total integer,
  lugar text,
  enlace text,
  inicio timestamptz,
  fin_programado timestamptz,
  cancelable_hasta timestamptz,
  reporte_hasta timestamptz,
  estado_pago text,
  estado_reembolso text,
  estado_reporte text,
  observaciones_reporte text,
  gratis boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with mias as (
    select m.id, public.inicio_sesion(m.fecha, f.hora) as inicio
    from public.monitoria m
    join public.franja f on f.id = m.id_franja
    where m.id_lead in (select l.id from public.lead l where privado.es_mi_lead(l.id))
      and m.estado <> 'pendiente_pago'
      and m.motivo_cancelacion is distinct from 'reserva_expirada'
      and not exists (select 1 from public.monitoria_grupal g where g.id_monitoria = m.id)
    order by 2 desc, m.id
    limit 50
  )
  select d.id_monitoria, d.estado, d.motivo_cancelacion, d.nombre_monitor, d.nombre_materia, d.codigo_materia, d.fecha,
         d.hora, d.duracion_min, d.presencial, d.valor_total, d.lugar, d.enlace, d.inicio, d.fin_programado,
         d.cancelable_hasta, d.reporte_hasta, d.estado_pago, d.estado_reembolso, d.estado_reporte,
         d.observaciones_reporte, d.gratis
  from mias
  cross join lateral privado.datos_de_cita(mias.id) d
  order by d.inicio desc, d.id_monitoria;
$$;

revoke all on function privado.mis_citas() from public, anon, authenticated, service_role;
grant execute on function privado.mis_citas() to authenticated;

create function public.mis_citas()
returns table (
  id_monitoria uuid,
  estado public.estado_monitoria,
  motivo_cancelacion public.motivo_cancelacion,
  nombre_monitor text,
  nombre_materia text,
  codigo_materia text,
  fecha date,
  hora time,
  duracion_min integer,
  presencial boolean,
  valor_total integer,
  lugar text,
  enlace text,
  inicio timestamptz,
  fin_programado timestamptz,
  cancelable_hasta timestamptz,
  reporte_hasta timestamptz,
  estado_pago text,
  estado_reembolso text,
  estado_reporte text,
  observaciones_reporte text,
  gratis boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id_monitoria, c.estado, c.motivo_cancelacion, c.nombre_monitor, c.nombre_materia, c.codigo_materia, c.fecha,
         c.hora, c.duracion_min, c.presencial, c.valor_total, c.lugar, c.enlace, c.inicio, c.fin_programado,
         c.cancelable_hasta, c.reporte_hasta, c.estado_pago, c.estado_reembolso, c.estado_reporte,
         c.observaciones_reporte, c.gratis
  from privado.mis_citas() c;
$$;

comment on function public.mis_citas() is
  'Las citas individuales del Lead de la sesión (sin las por pagar ni las vencidas), de la más reciente a la más antigua, hasta 50. HU-019.';

revoke all on function public.mis_citas() from public, anon, authenticated, service_role;
grant execute on function public.mis_citas() to authenticated;
