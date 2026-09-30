-- Ajustes de la revisión de HU-003. HU-063.
--
-- La migración de HU-003 (`*_plazos_y_comision.sql`) ya está en `main` y no se edita: esta la
-- corrige encima. Decisiones del 29-sep-2026 (REVISION_REGLAS.md §4):
--
--   * N-2: la comisión solo la calcula el servidor. `comision()`, `monto_neto()` y los parámetros
--     de comisión pasan a `service_role`; ninguna sesión de la app (ni la anónima) los llama por
--     RPC. Los parámetros de comisión salen de `parametros_negocio()` y viven en
--     `parametros_comision()`, así los plazos siguen disponibles para `authenticated`.
--   * N-6: el desembolso solo se ejecuta cuando ya venció la ventana de reporte de inasistencia.
--     Con el borde inclusivo de P-40, en el instante exacto fin + 24 h el reporte todavía se puede
--     hacer (ahora <= límite) y el desembolso ya "se alcanzaba" (ahora >= límite): los dos plazos
--     coincidían. `desembolso_ejecutable()` decide el instante compuesto: alcanzado
--     `desembolsable_desde` Y ya no dentro de `reporte_inasistencia_hasta`. La regla no depende de
--     que los dos parámetros valgan lo mismo.
--   * `ventana_resena_hasta(null)` rechaza en vez de devolver nulo, igual que su gemelo de
--     TypeScript. La vista `monitoria_plazos` ya no la llama para una grupal sin finalizar.
--   * Las funciones que leen parámetros son `stable`: su valor cambia con una migración, y una
--     función `immutable` puede plegarse a constante o indexarse con el valor viejo.
--
-- N-1 (redondeo al peso más cercano) y P-14 (tope de 15.000) se quedan como están.
-- Idempotente: se puede volver a aplicar.

-- ---------------------------------------------------------------------------
-- Parámetros de plazo: sin la comisión
-- ---------------------------------------------------------------------------
-- Cambiar las columnas de salida obliga a borrar la función. Las demás funciones la llaman por
-- nombre en su cuerpo (no hay dependencias registradas), así que se recrean en la misma migración.
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
  desembolso_min integer
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
    1440    -- desembolso_min: desembolsable desde 24 h después del fin (RN-83)
$$;

-- ---------------------------------------------------------------------------
-- Parámetros de comisión: solo el servidor (N-2)
-- ---------------------------------------------------------------------------
create or replace function public.parametros_comision()
returns table (
  comision_porcentaje integer,
  comision_tope integer
)
language sql
stable
parallel safe
set search_path = ''
as $$
  select
    10,     -- comision_porcentaje: 10 % del monto bruto (RN-81)
    15000   -- comision_tope: tope de la comisión en COP (RN-81, P-14)
$$;

-- ---------------------------------------------------------------------------
-- Comisión y neto: mismas fórmulas, ahora `stable` y leyendo parametros_comision()
-- ---------------------------------------------------------------------------
create or replace function public.comision(p_monto_bruto integer)
returns integer
language plpgsql
stable
strict
parallel safe
set search_path = ''
as $$
declare
  v_porcentaje integer;
  v_tope integer;
begin
  if p_monto_bruto < 0 then
    raise exception 'El monto bruto debe ser un entero de pesos mayor o igual a cero (recibido: %)', p_monto_bruto
      using errcode = 'invalid_parameter_value';
  end if;

  select p.comision_porcentaje, p.comision_tope into v_porcentaje, v_tope
  from public.parametros_comision() p;

  return least(((p_monto_bruto::bigint * v_porcentaje + 50) / 100)::integer, v_tope);
end;
$$;

create or replace function public.monto_neto(p_monto_bruto integer)
returns integer
language sql
stable
strict
parallel safe
set search_path = ''
as $$
  select p_monto_bruto - public.comision(p_monto_bruto);
$$;

-- ---------------------------------------------------------------------------
-- Reseña de una grupal: sin fecha de finalización no hay ventana (igual que en TypeScript)
-- ---------------------------------------------------------------------------
-- Ya no es `strict`: con un nulo tiene que ejecutarse para poder rechazarlo.
create or replace function public.ventana_resena_hasta(p_fecha_finalizacion timestamptz)
returns timestamptz
language plpgsql
stable
parallel safe
set search_path = ''
as $$
begin
  if p_fecha_finalizacion is null then
    raise exception 'La fecha de finalización es obligatoria para calcular la ventana de reseña.'
      using errcode = 'null_value_not_allowed';
  end if;

  return p_fecha_finalizacion
    + make_interval(mins => (select p.resena_grupal_min from public.parametros_negocio() p));
end;
$$;

-- ---------------------------------------------------------------------------
-- Desembolso ejecutable (RN-83 y N-6)
-- ---------------------------------------------------------------------------
-- Solo compone las dos comparaciones de P-40; no repite < ni >. Con los valores de hoy (24 h y 24 h)
-- es "estrictamente después de fin + 24 h". Si un día `desembolso_min` fuera menor que
-- `reporte_inasistencia_min`, el reporte igual manda: nunca es ejecutable con la ventana abierta.
create or replace function public.desembolso_ejecutable(p_fin_programado timestamptz, p_ahora timestamptz)
returns boolean
language sql
stable
strict
parallel safe
set search_path = ''
as $$
  select public.plazo_alcanzado(public.desembolsable_desde(p_fin_programado), p_ahora)
     and not public.dentro_de_plazo(public.reporte_inasistencia_hasta(p_fin_programado), p_ahora);
$$;

-- ---------------------------------------------------------------------------
-- Vistas: la de plazos ya no llama a ventana_resena_hasta sin fecha, y la bandeja usa N-6
-- ---------------------------------------------------------------------------
-- Mismas columnas, mismo orden y mismos tipos que las de HU-003 y HU-012.
create or replace view public.monitoria_plazos
with (security_invoker = true)
as
select
  m.id as id_monitoria,
  i.inicio,
  s.fin_programado,
  (g.id_monitoria is not null) as es_grupal,
  public.reserva_hasta(m.fecha_creacion) as reserva_hasta,
  public.cancelable_hasta(i.inicio, g.id_monitoria is not null) as cancelable_hasta,
  case when g.id_monitoria is not null then public.fecha_limite_pago(i.inicio) end as fecha_limite_pago,
  case when g.id_monitoria is not null then public.fecha_limite_diferencia(i.inicio) end as fecha_limite_diferencia,
  public.reporte_inasistencia_hasta(s.fin_programado) as reporte_inasistencia_hasta,
  case when g.id_monitoria is not null and m.fecha_finalizacion is not null
    then public.ventana_resena_hasta(m.fecha_finalizacion) end as ventana_resena_hasta,
  public.desembolsable_desde(s.fin_programado) as desembolsable_desde
from public.monitoria m
join public.franja f on f.id = m.id_franja
left join public.monitoria_grupal g on g.id_monitoria = m.id
cross join lateral (select public.inicio_sesion(m.fecha, f.hora) as inicio) i
cross join lateral (select public.fin_programado(i.inicio, f.duracion_min) as fin_programado) s;

comment on view public.monitoria_plazos is
  'Atributos derivados de la Monitoria (inicio, fin y plazos de la sección 6.1). HU-003.';

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
  and not exists (
    select 1
    from public.reporte_inasistencia r
    where r.id_monitoria = d.id_monitoria
      and r.estado in ('en_revision', 'aceptado')
  );

comment on view public.desembolsos_ejecutables is
  'Desembolsos pendientes que ya se pueden ejecutar: la ventana de reporte venció (RN-83, N-6) y no hay reporte activo. Sin bruto, comisión ni llave. HU-012 y HU-063.';

-- ---------------------------------------------------------------------------
-- Permisos explícitos (auto_expose_new_tables = false)
-- ---------------------------------------------------------------------------
-- Plazos y desembolso_ejecutable: authenticated y service_role (las sesiones anónimas de Supabase
-- usan el rol authenticated). Se repasan todas porque drop function borró los permisos de
-- parametros_negocio() y create or replace conserva los que ya tenían las demás.
do $$
declare
  f text;
begin
  foreach f in array array[
    'parametros_negocio()',
    'desembolso_ejecutable(timestamptz, timestamptz)',
    'ventana_resena_hasta(timestamptz)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;

  -- La comisión: solo el servidor (N-2).
  foreach f in array array[
    'parametros_comision()',
    'comision(integer)',
    'monto_neto(integer)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

revoke all on table public.monitoria_plazos from public, anon, authenticated, service_role;
grant select on table public.monitoria_plazos to authenticated, service_role;

revoke all on table public.desembolsos_ejecutables from public, anon, authenticated, service_role;
grant select on table public.desembolsos_ejecutables to authenticated, service_role;
