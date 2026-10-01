-- Finalizar una sesión. HU-023.
--
-- P-05: la finaliza el monitor; si no lo hace, se le recuerda y la monitoría se cierra sola. Al pasar a
-- realizada se guarda fecha_finalizacion (el desembolso lo crea HU-028; el correo de reseña, HU-035).
--
-- Decisiones del 1-oct-2026 (dvarela5101):
--   D-13: el monitor puede finalizar una monitoría confirmada desde su inicio (con la hora exacta ya se puede,
--         P-40); antes no.
--   D-14: una individual confirmada que nadie finalizó se cierra sola 24 h después del fin programado. Es un
--         plazo más de la sección 6.1: `cierre_automatico_min` en parametros_negocio(). Un proceso de pg_cron
--         la revisa cada 15 minutos.
--   D-15: el recordatorio es en la app (panel y agenda del monitor), sin correo: los avisos al monitor
--         quedan para HU-051 (P-11).
--
-- Nadie con sesión actualiza `monitoria`: el monitor finaliza por una función security definer que toma su
-- identidad de auth.uid() y la hora de now(). El cierre automático no se expone: lo corre pg_cron.
-- Idempotente.

-- ---------------------------------------------------------------------------
-- Parámetros de plazo: más el cierre automático (D-14)
-- ---------------------------------------------------------------------------
-- Cambiar las columnas de salida obliga a borrar la función (como en *_ajustes_plazos_y_comision.sql). Las
-- demás la llaman por nombre de columna en su cuerpo, así que no hay que recrearlas. La migración de HU-063,
-- al reaplicarse, la borra y la deja con sus 11 columnas; esta, que va después, la vuelve a dejar con 12.
drop function if exists public.parametros_negocio();

create function public.parametros_negocio()
returns table (
  reserva_min integer,
  revision_min integer,
  antelacion_individual_min integer,
  antelacion_grupal_min integer,
  cancelacion_individual_min integer,
  cancelacion_grupal_min integer,
  pago_integrantes_min integer,
  diferencia_min integer,
  reporte_inasistencia_min integer,
  resena_grupal_min integer,
  desembolso_min integer,
  cierre_automatico_min integer
)
language sql
stable
parallel safe
set search_path = ''
as $$
  select
    10,     -- reserva_min: bloqueo de la franja al agendar (RN-34)
    60,     -- revision_min: un admin revisa cada pago en 1 h (RN-42)
    180,    -- antelacion_individual_min: mínimo 3 h antes de T (RN-35)
    2160,   -- antelacion_grupal_min: mínimo 36 h antes de T (RN-35)
    720,    -- cancelacion_individual_min: se cancela hasta 12 h antes de T (RN-60)
    1440,   -- cancelacion_grupal_min: se cancela hasta 24 h antes de T (RN-60)
    1440,   -- pago_integrantes_min: los integrantes pagan hasta 24 h antes de T (RN-54)
    300,    -- diferencia_min: la diferencia se cubre hasta 5 h antes de T (RN-55)
    1440,   -- reporte_inasistencia_min: se reporta hasta 24 h después del fin (RN-62)
    60,     -- resena_grupal_min: reseña grupal hasta 1 h después de finalizar (RN-71)
    1440,   -- desembolso_min: desembolsable desde 24 h después del fin (RN-83)
    1440    -- cierre_automatico_min: una individual sin finalizar se cierra 24 h después del fin (P-05, D-14)
$$;

-- `/cierreAutomaticoDesde`: desde aquí una individual confirmada se cierra sola (borde inclusivo, P-40).
create or replace function public.cierre_automatico_desde(p_fin_programado timestamptz)
returns timestamptz
language sql
stable
strict
parallel safe
set search_path = ''
as $$
  select p_fin_programado
    + make_interval(mins => (select p.cierre_automatico_min from public.parametros_negocio() p));
$$;

do $$
declare
  f text;
begin
  foreach f in array array['parametros_negocio()', 'cierre_automatico_desde(timestamptz)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- El monitor finaliza (D-13)
-- ---------------------------------------------------------------------------
-- Resultado:
--   finalizada     pasó a realizada con fecha_finalizacion = ahora.
--   ya_finalizada  ya estaba realizada (un doble clic, o se cerró sola un instante antes).
--   no_empezo      todavía no llega su inicio.
--   no_confirmada  está pendiente de pago o cancelada: no hay sesión que finalizar.
--   no_encontrada  no existe o no es de este monitor (no se dice cuál de las dos).
--   sin_sesion     no hay sesión.
create or replace function privado.finalizar_monitoria(p_id_monitoria uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_ahora timestamptz := now();
  v_estado public.estado_monitoria;
  v_fecha date;
  v_hora time;
begin
  if v_uid is null then
    return 'sin_sesion';
  end if;

  -- `for update`: en fila con el cierre automático y con otra pestaña del mismo monitor.
  select m.estado, m.fecha, f.hora into v_estado, v_fecha, v_hora
  from public.monitoria m
  join public.franja f on f.id = m.id_franja
  where m.id = p_id_monitoria and m.id_monitor = v_uid
  for update of m;
  if not found then
    return 'no_encontrada';
  end if;
  if v_estado = 'realizada' then
    return 'ya_finalizada';
  end if;
  if v_estado <> 'confirmada' then
    return 'no_confirmada';
  end if;
  if not public.plazo_alcanzado(public.inicio_sesion(v_fecha, v_hora), v_ahora) then
    return 'no_empezo';
  end if;

  update public.monitoria
  set estado = 'realizada', fecha_finalizacion = v_ahora
  where id = p_id_monitoria;
  return 'finalizada';
end;
$$;

revoke all on function privado.finalizar_monitoria(uuid) from public, anon, authenticated, service_role;
grant execute on function privado.finalizar_monitoria(uuid) to authenticated;

-- La puerta en la Data API, con los permisos de quien llama. Solo con sesión.
create or replace function public.finalizar_monitoria(p_id_monitoria uuid)
returns text
language sql
volatile
security invoker
set search_path = ''
as $$
  select privado.finalizar_monitoria(p_id_monitoria);
$$;

comment on function public.finalizar_monitoria(uuid) is
  'El monitor de la sesión marca como realizada una monitoría confirmada que ya empezó. HU-023.';

revoke all on function public.finalizar_monitoria(uuid) from public, anon, authenticated, service_role;
grant execute on function public.finalizar_monitoria(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Cierre automático (D-14)
-- ---------------------------------------------------------------------------
-- Pasa a realizada cada individual confirmada que alcanzó su cierre automático (fin programado + 24 h, borde
-- inclusivo). fecha_finalizacion es el momento del cierre. Las grupales no se cierran solas: su monitor
-- finaliza y entrega el enlace de reseña (RN-71, HU-046). Devuelve cuántas cerró; correrla dos veces seguidas
-- no cambia nada la segunda. Solo la corre pg_cron (como postgres): ninguna sesión la ejecuta.
create or replace function privado.cerrar_monitorias_sin_finalizar(p_ahora timestamptz)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cerradas integer;
begin
  update public.monitoria m
  set estado = 'realizada', fecha_finalizacion = p_ahora
  from public.franja f
  where f.id = m.id_franja
    and m.estado = 'confirmada'
    and not exists (select 1 from public.monitoria_grupal g where g.id_monitoria = m.id)
    and public.plazo_alcanzado(
      public.cierre_automatico_desde(public.fin_programado(public.inicio_sesion(m.fecha, f.hora), f.duracion_min)),
      p_ahora
    );
  get diagnostics v_cerradas = row_count;
  return v_cerradas;
end;
$$;

revoke all on function privado.cerrar_monitorias_sin_finalizar(timestamptz) from public, anon, authenticated, service_role;

-- cron.schedule con el mismo nombre reemplaza el trabajo: reaplicar la migración no lo duplica.
select cron.schedule('calibra-cerrar-monitorias', '*/15 * * * *', 'select privado.cerrar_monitorias_sin_finalizar(now())');
