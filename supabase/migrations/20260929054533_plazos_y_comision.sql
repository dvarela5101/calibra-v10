-- Motor de plazos y montos derivados. HU-003.
--
-- Fuente de verdad de la tabla de plazos (sección 6.1), de las fórmulas de la sección 7
-- y de la comisión (RN-81). La app repite las mismas fórmulas en src/lib/plazos/motor.ts
-- para las pantallas, y integracion/plazos.test.ts comprueba que ambas coincidan.
--
-- Convenciones:
--   * Los parámetros viven SOLO en public.parametros_negocio(). Ninguna otra función
--     ni la app lleva un número propio: para cambiar un plazo se crea una migración
--     nueva que redefine esa función.
--   * Todos los plazos se guardan en minutos; la comisión, en porcentaje entero y pesos.
--   * Bordes inclusivos (P-40, resuelto el 2026-09-28): con 12 h exactas todavía se puede
--     cancelar y con 3 h exactas se puede agendar. "Hasta X" significa ahora <= X y
--     "desde X" significa ahora >= X. Solo se deciden en dentro_de_plazo() y
--     plazo_alcanzado(). Hoy únicamente cumple_antelacion() las llama; las demás funciones
--     devuelven el instante límite sin compararlo. Quien compare `ahora` contra ese límite
--     debe componer dentro_de_plazo(x_hasta(...), ahora) o plazo_alcanzado(x_desde(...), ahora),
--     sin repetir < ni >.
--   * Las funciones reciben `ahora` como argumento (no llaman now()): así se prueban los
--     bordes y los procesos programados pasan now() o una hora fija.
--   * Nulo entra, nulo sale (strict): ventana_resena_hasta(null) es null.
--   * Son funciones puras (no leen tablas), en public para que la app las llame por RPC.
--     Solo authenticated y service_role las ejecutan; las sesiones anónimas de Supabase
--     usan el rol authenticated.
-- Idempotente: se puede volver a aplicar.

-- ---------------------------------------------------------------------------
-- Parámetros: el único lugar de configuración
-- ---------------------------------------------------------------------------
create or replace function public.parametros_negocio()
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
  comision_porcentaje integer,
  comision_tope integer
)
language sql
immutable
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
    10,     -- comision_porcentaje: 10 % del monto bruto (RN-81)
    15000   -- comision_tope: tope de la comisión en COP (RN-81)
$$;

-- ---------------------------------------------------------------------------
-- Bordes inclusivos (P-40)
-- ---------------------------------------------------------------------------
-- "Hasta X": todavía dentro del plazo con ahora = X.
create or replace function public.dentro_de_plazo(p_limite timestamptz, p_ahora timestamptz)
returns boolean
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select p_ahora <= p_limite;
$$;

-- "Desde X": el plazo ya se alcanzó con ahora = X.
create or replace function public.plazo_alcanzado(p_desde timestamptz, p_ahora timestamptz)
returns boolean
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select p_ahora >= p_desde;
$$;

-- ---------------------------------------------------------------------------
-- Inicio y fin de la sesión (RN-36)
-- ---------------------------------------------------------------------------
-- Inicio = fecha + hora de la franja, en la zona del negocio. No depende de la zona
-- de la sesión de Postgres.
create or replace function public.inicio_sesion(p_fecha date, p_hora time)
returns timestamptz
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select (p_fecha + p_hora) at time zone 'America/Bogota';
$$;

create or replace function public.fin_programado(p_inicio timestamptz, p_duracion_min integer)
returns timestamptz
language sql
stable
strict
parallel safe
set search_path = ''
as $$
  select p_inicio + make_interval(mins => p_duracion_min);
$$;

-- ---------------------------------------------------------------------------
-- Plazos (sección 6.1)
-- ---------------------------------------------------------------------------
create or replace function public.reserva_hasta(p_fecha_creacion timestamptz)
returns timestamptz
language sql
stable
strict
parallel safe
set search_path = ''
as $$
  select p_fecha_creacion + make_interval(mins => (select p.reserva_min from public.parametros_negocio() p));
$$;

create or replace function public.revision_hasta(p_fecha_asignacion timestamptz)
returns timestamptz
language sql
stable
strict
parallel safe
set search_path = ''
as $$
  select p_fecha_asignacion + make_interval(mins => (select p.revision_min from public.parametros_negocio() p));
$$;

create or replace function public.cancelable_hasta(p_inicio timestamptz, p_es_grupal boolean)
returns timestamptz
language sql
stable
strict
parallel safe
set search_path = ''
as $$
  select p_inicio - make_interval(
    mins => (select case when p_es_grupal then p.cancelacion_grupal_min else p.cancelacion_individual_min end
             from public.parametros_negocio() p)
  );
$$;

create or replace function public.fecha_limite_pago(p_inicio timestamptz)
returns timestamptz
language sql
stable
strict
parallel safe
set search_path = ''
as $$
  select p_inicio - make_interval(mins => (select p.pago_integrantes_min from public.parametros_negocio() p));
$$;

create or replace function public.fecha_limite_diferencia(p_inicio timestamptz)
returns timestamptz
language sql
stable
strict
parallel safe
set search_path = ''
as $$
  select p_inicio - make_interval(mins => (select p.diferencia_min from public.parametros_negocio() p));
$$;

create or replace function public.reporte_inasistencia_hasta(p_fin_programado timestamptz)
returns timestamptz
language sql
stable
strict
parallel safe
set search_path = ''
as $$
  select p_fin_programado
    + make_interval(mins => (select p.reporte_inasistencia_min from public.parametros_negocio() p));
$$;

create or replace function public.ventana_resena_hasta(p_fecha_finalizacion timestamptz)
returns timestamptz
language sql
stable
strict
parallel safe
set search_path = ''
as $$
  select p_fecha_finalizacion + make_interval(mins => (select p.resena_grupal_min from public.parametros_negocio() p));
$$;

create or replace function public.desembolsable_desde(p_fin_programado timestamptz)
returns timestamptz
language sql
stable
strict
parallel safe
set search_path = ''
as $$
  select p_fin_programado + make_interval(mins => (select p.desembolso_min from public.parametros_negocio() p));
$$;

-- Antelación mínima para agendar (RN-35): 3 h en individual y 36 h en grupal, medidas
-- desde `p_ahora` hasta el inicio. Con la antelación exacta todavía se puede agendar.
create or replace function public.cumple_antelacion(p_inicio timestamptz, p_ahora timestamptz, p_es_grupal boolean)
returns boolean
language sql
stable
strict
parallel safe
set search_path = ''
as $$
  select public.dentro_de_plazo(
    p_inicio - make_interval(
      mins => (select case when p_es_grupal then p.antelacion_grupal_min else p.antelacion_individual_min end
               from public.parametros_negocio() p)
    ),
    p_ahora
  );
$$;

-- ---------------------------------------------------------------------------
-- Comisión de la plataforma (RN-81) y neto del monitor
-- ---------------------------------------------------------------------------
-- comision = min(10 % del bruto, 15.000). Los montos son pesos enteros (sección 14), así
-- que el 10 % se redondea al peso más cercano y, en el empate de medio peso, hacia arriba.
-- SUPUESTO A VALIDAR: RN-81 no fija el redondeo (solo importa si el bruto no es múltiplo
-- de 10). Cambiarlo es tocar esta función y la de src/lib/plazos/motor.ts.
create or replace function public.comision(p_monto_bruto integer)
returns integer
language plpgsql
immutable
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
  from public.parametros_negocio() p;

  return least(((p_monto_bruto::bigint * v_porcentaje + 50) / 100)::integer, v_tope);
end;
$$;

create or replace function public.monto_neto(p_monto_bruto integer)
returns integer
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select p_monto_bruto - public.comision(p_monto_bruto);
$$;

-- ---------------------------------------------------------------------------
-- Atributos derivados de la Monitoria (sección 10), listos para consultar
-- ---------------------------------------------------------------------------
-- security_invoker: cada quien ve solo las monitorías que ya le deja ver su política
-- (participantes y admins). Los atributos exclusivos de la grupal salen nulos en una
-- individual. Usa la hora y la duración actuales de la franja: HU-015 debe impedir
-- cambiarlas con reservas futuras (P-30); hasta entonces nada lo impide.
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
  case when g.id_monitoria is not null then public.ventana_resena_hasta(m.fecha_finalizacion) end as ventana_resena_hasta,
  public.desembolsable_desde(s.fin_programado) as desembolsable_desde
from public.monitoria m
join public.franja f on f.id = m.id_franja
left join public.monitoria_grupal g on g.id_monitoria = m.id
cross join lateral (select public.inicio_sesion(m.fecha, f.hora) as inicio) i
cross join lateral (select public.fin_programado(i.inicio, f.duracion_min) as fin_programado) s;

comment on view public.monitoria_plazos is
  'Atributos derivados de la Monitoria (inicio, fin y plazos de la sección 6.1). HU-003.';

-- ---------------------------------------------------------------------------
-- Permisos explícitos (auto_expose_new_tables = false)
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'parametros_negocio()',
    'dentro_de_plazo(timestamptz, timestamptz)',
    'plazo_alcanzado(timestamptz, timestamptz)',
    'inicio_sesion(date, time)',
    'fin_programado(timestamptz, integer)',
    'reserva_hasta(timestamptz)',
    'revision_hasta(timestamptz)',
    'cancelable_hasta(timestamptz, boolean)',
    'fecha_limite_pago(timestamptz)',
    'fecha_limite_diferencia(timestamptz)',
    'reporte_inasistencia_hasta(timestamptz)',
    'ventana_resena_hasta(timestamptz)',
    'desembolsable_desde(timestamptz)',
    'cumple_antelacion(timestamptz, timestamptz, boolean)',
    'comision(integer)',
    'monto_neto(integer)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

revoke all on table public.monitoria_plazos from public, anon, authenticated, service_role;
grant select on table public.monitoria_plazos to authenticated, service_role;
