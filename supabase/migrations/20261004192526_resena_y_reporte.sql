-- No invitar a reseñar a quien reportó que el monitor no llegó. HU-080, D-40.
--
-- Parte de la versión de `20261001233317_resena_individual.sql` (HU-035), la única que define estas piezas. D-40: mientras
-- el reporte de inasistencia (HU-029) esté en revisión, o si se acepta, la individual no se puede calificar ni se invita a
-- hacerlo; si el admin lo rechaza, la invitación sale.
--
-- Diseño: la invitación se anota siempre (el trigger de HU-035 no cambia) y la decisión de mandarla se toma al procesar,
-- leyendo el reporte en vivo. Una invitación "en espera" es una fila con `procesado_en` nulo cuya monitoría tiene un
-- reporte abierto. La app la salta sin marcarla ni sumar intentos; al rechazarse el reporte la fila deja de estar en espera
-- por sí sola (no hay columna que cambiar) y el siguiente pedido a la app la manda.
--
-- Supuestos:
--   1. "Reporte abierto" = `en_revision` o `aceptado` (D-40; RN-83 usa el mismo par). Uno `rechazado` no bloquea nunca.
--   2. La invitación se anota siempre; la espera es derivada, no una columna. Nada se descarta por un reporte, y HU-030 no
--      escribe en `invitacion_resena`.
--   3. Un reporte `aceptado` deja la fila sin procesar para siempre (la monitoría pasará a `cancelada`). Es inofensivo: el
--      listado y `disparar_invitaciones_resena` la excluyen.
--   4. `con_reporte` va después de `ya_resenada` y antes de `disponible` y `no_disponible` en `resena_por_token` y
--      `registrar_resena`: quien ya reseñó ve "ya calificaste" y su reseña se conserva; y un aceptado cancela la monitoría,
--      por eso gana a `no_disponible`.
--   5. La individual no tiene ventana de reseña (RN-72, el enlace no vence): rechazado el reporte, la invitación se manda
--      aunque pasen días.
--   6. Carreras: si el reporte se crea cuando la app ya leyó `disponible`, sale un correo y el enlace queda cubierto por
--      `con_reporte`; si se crea cuando `registrar_resena` ya comprobó, queda una reseña con reporte (D-40 c). No se
--      agregan bloqueos.
-- Ninguna función cambia sus columnas de salida. Idempotente.

-- ---------------------------------------------------------------------------
-- La regla, en un solo lugar
-- ---------------------------------------------------------------------------
-- security invoker: la llaman funciones que ya corren con los permisos de service_role (que lee reporte_inasistencia) o con
-- los del dueño (disparar_invitaciones_resena).
create or replace function privado.monitoria_con_reporte_abierto(p_id_monitoria uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.reporte_inasistencia r
    where r.id_monitoria = p_id_monitoria and r.estado in ('en_revision', 'aceptado')
  );
$$;

comment on function privado.monitoria_con_reporte_abierto(uuid) is
  'La monitoría tiene un reporte de inasistencia en revisión o aceptado (D-40). Un reporte rechazado no cuenta. HU-080.';

revoke all on function privado.monitoria_con_reporte_abierto(uuid) from public, anon, authenticated, service_role;
grant execute on function privado.monitoria_con_reporte_abierto(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Pedirle a la app que procese: solo si hay algo que se pueda mandar
-- ---------------------------------------------------------------------------
-- Igual que la de HU-035 salvo el primer `if`: las invitaciones en espera no cuentan, o el cron llamaría a la app cada 5
-- minutos por una fila que no sale.
create or replace function privado.disparar_invitaciones_resena()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sitio text;
  v_secreto text;
begin
  if not exists (
    select 1
    from public.invitacion_resena i
    join public.pago p on p.id = i.id_pago
    where i.procesado_en is null
      and not privado.monitoria_con_reporte_abierto(p.id_monitoria)
  ) then
    return null;
  end if;

  select decrypted_secret into v_sitio from vault.decrypted_secrets where name = 'calibra_sitio_url';
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'calibra_cron_secreto';
  if coalesce(btrim(v_sitio), '') = '' or coalesce(btrim(v_secreto), '') = '' then
    return null;
  end if;

  return net.http_post(
    url := rtrim(btrim(v_sitio), '/') || '/api/procesos/invitar-resenas',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Authorization', 'Bearer ' || btrim(v_secreto), 'Content-Type', 'application/json'),
    timeout_milliseconds := 60000
  );
end;
$$;

revoke all on function privado.disparar_invitaciones_resena() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Lo que procesa la app
-- ---------------------------------------------------------------------------
-- Las más antiguas sin procesar y sin reporte abierto. Reemplaza al select directo de la app a la tabla.
create or replace function public.invitaciones_resena_por_procesar(p_limite integer)
returns table (
  id uuid,
  id_pago uuid,
  intentos integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select i.id, i.id_pago, i.intentos
  from public.invitacion_resena i
  join public.pago p on p.id = i.id_pago
  where i.procesado_en is null
    and not privado.monitoria_con_reporte_abierto(p.id_monitoria)
  order by i.creada_en, i.id
  limit p_limite;
$$;

comment on function public.invitaciones_resena_por_procesar(integer) is
  'Invitaciones a reseñar por mandar, de la más antigua a la más reciente, sin las que esperan un reporte de inasistencia (D-40). Solo para el servidor (service_role). HU-080.';

revoke all on function public.invitaciones_resena_por_procesar(integer) from public, anon, authenticated, service_role;
grant execute on function public.invitaciones_resena_por_procesar(integer) to service_role;

-- ¿Sigue en espera? Para cuando el reporte llega entre el listado y la lectura del correo: la app no la descarta.
create or replace function public.invitacion_resena_en_espera(p_id_pago uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.invitacion_resena i
    join public.pago p on p.id = i.id_pago
    where i.id_pago = p_id_pago
      and i.procesado_en is null
      and privado.monitoria_con_reporte_abierto(p.id_monitoria)
  );
$$;

comment on function public.invitacion_resena_en_espera(uuid) is
  'La invitación del pago está sin procesar y espera por un reporte de inasistencia abierto (D-40). Solo para el servidor (service_role). HU-080.';

revoke all on function public.invitacion_resena_en_espera(uuid) from public, anon, authenticated, service_role;
grant execute on function public.invitacion_resena_en_espera(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Lo que la app necesita para escribir el correo (HU-035 + reporte abierto)
-- ---------------------------------------------------------------------------
create or replace function public.datos_de_invitacion_resena(p_id_pago uuid)
returns table (
  token text,
  disponible boolean,
  correo_lead text,
  nombre_lead text,
  nombre_monitor text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    i.token,
    m.estado = 'realizada'
      and p.estado <> 'rechazado'
      and not exists (select 1 from public.monitoria_grupal g where g.id_monitoria = m.id)
      and not exists (select 1 from public.resena r where r.id_pago = p.id)
      and not privado.monitoria_con_reporte_abierto(m.id),
    l.correo,
    l.nombre,
    mo.nombre
  from public.invitacion_resena i
  join public.pago p on p.id = i.id_pago
  join public.monitoria m on m.id = p.id_monitoria
  join public.lead l on l.id = m.id_lead
  join public.monitor mo on mo.id = m.id_monitor
  where i.id_pago = p_id_pago;
$$;

comment on function public.datos_de_invitacion_resena(uuid) is
  'Datos del correo con el enlace de reseña de un pago (RN-72). Solo para el servidor (service_role). HU-035, HU-080.';

revoke all on function public.datos_de_invitacion_resena(uuid) from public, anon, authenticated, service_role;
grant execute on function public.datos_de_invitacion_resena(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Lo que la app necesita para pintar la página del enlace (HU-035 + con_reporte)
-- ---------------------------------------------------------------------------
-- estado: 'ya_resenada' | 'con_reporte' | 'disponible' | 'no_disponible', en ese orden de prioridad. Sin filas si el token
-- no existe. No trae datos de contacto ni del pago: solo lo que la página muestra.
create or replace function public.resena_por_token(p_token text)
returns table (
  estado text,
  nombre_monitor text,
  nombre_materia text,
  inicio timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    case
      when exists (select 1 from public.resena r where r.id_pago = p.id) then 'ya_resenada'
      when privado.monitoria_con_reporte_abierto(m.id) then 'con_reporte'
      when m.estado = 'realizada'
        and p.estado <> 'rechazado'
        and not exists (select 1 from public.monitoria_grupal g where g.id_monitoria = m.id) then 'disponible'
      else 'no_disponible'
    end,
    mo.nombre,
    ma.nombre,
    public.inicio_sesion(m.fecha, f.hora)
  from public.invitacion_resena i
  join public.pago p on p.id = i.id_pago
  join public.monitoria m on m.id = p.id_monitoria
  join public.franja f on f.id = m.id_franja
  join public.materia ma on ma.id = m.id_materia
  join public.monitor mo on mo.id = m.id_monitor
  where i.token = p_token;
$$;

comment on function public.resena_por_token(text) is
  'Estado del enlace de reseña y datos para pintar su página (RN-70, RN-72, D-40). Solo para el servidor (service_role). HU-035, HU-080.';

revoke all on function public.resena_por_token(text) from public, anon, authenticated, service_role;
grant execute on function public.resena_por_token(text) to service_role;

-- ---------------------------------------------------------------------------
-- Guardar la reseña (HU-035 + con_reporte)
-- ---------------------------------------------------------------------------
-- Resultado:
--   registrada     se guardó la reseña.
--   ya_resenada    el pago ya tiene reseña (RN-70: una por pago).
--   con_reporte    la monitoría tiene un reporte de inasistencia en revisión o aceptado (D-40).
--   no_disponible  la monitoría no está realizada, es grupal o el pago fue rechazado.
--   no_existe      el token no corresponde a ninguna invitación.
-- Bloquea el pago (`for update`), así un rechazo o una segunda reseña simultáneos esperan y se evalúan de nuevo. La
-- calificación fuera de 1 a 5 o un comentario de más de 1000 caracteres los rechaza la restricción de `resena`
-- (check_violation); la app los valida antes. El comentario se recorta y, si queda vacío, se guarda nulo.
create or replace function public.registrar_resena(p_token text, p_calificacion integer, p_comentario text)
returns text
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_id_pago uuid;
  v_estado_pago public.estado_pago;
  v_estado_monitoria public.estado_monitoria;
  v_id_monitoria uuid;
begin
  select i.id_pago into v_id_pago
  from public.invitacion_resena i
  where i.token = p_token;
  if not found then
    return 'no_existe';
  end if;

  select p.estado, m.estado, m.id into v_estado_pago, v_estado_monitoria, v_id_monitoria
  from public.pago p
  join public.monitoria m on m.id = p.id_monitoria
  where p.id = v_id_pago
  for update of p;

  if exists (select 1 from public.resena r where r.id_pago = v_id_pago) then
    return 'ya_resenada';
  end if;
  if privado.monitoria_con_reporte_abierto(v_id_monitoria) then
    return 'con_reporte';
  end if;
  if v_estado_monitoria <> 'realizada'
     or v_estado_pago = 'rechazado'
     or exists (select 1 from public.monitoria_grupal g where g.id_monitoria = v_id_monitoria) then
    return 'no_disponible';
  end if;

  begin
    insert into public.resena (id_pago, calificacion, comentario)
    values (v_id_pago, p_calificacion, nullif(btrim(p_comentario), ''));
  exception when unique_violation then
    return 'ya_resenada';
  end;
  return 'registrada';
end;
$$;

comment on function public.registrar_resena(text, integer, text) is
  'Guarda la reseña de un pago a partir del token del enlace (RN-70, RN-72, D-17, D-40). Solo para el servidor (service_role). HU-035, HU-080.';

revoke all on function public.registrar_resena(text, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.registrar_resena(text, integer, text) to service_role;

-- ---------------------------------------------------------------------------
-- Pedir el procesamiento en cuanto un reporte se rechaza
-- ---------------------------------------------------------------------------
-- Sin depender de HU-030: se dispara con cualquier update que deje el reporte en `rechazado`. Nunca tumba el cambio; si
-- falla, el cron de cinco minutos lo cubre.
create or replace function privado.reanudar_invitaciones_resena()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform privado.disparar_invitaciones_resena();
  exception when others then
    raise warning 'calibra: no se pudo pedir la invitación a reseñar (%): %', sqlstate, sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function privado.reanudar_invitaciones_resena() from public, anon, authenticated, service_role;

drop trigger if exists reporte_reanuda_invitaciones_resena on public.reporte_inasistencia;
create trigger reporte_reanuda_invitaciones_resena
  after update of estado on public.reporte_inasistencia
  for each row
  when (old.estado is distinct from new.estado and new.estado = 'rechazado')
  execute function privado.reanudar_invitaciones_resena();
