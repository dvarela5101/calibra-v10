-- Pruebas pgTAP del motor de plazos y comisión (HU-003 y los ajustes de HU-063).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.

begin;
create extension if not exists pgtap with schema extensions;

select plan(110);

-- ---------------------------------------------------------------------------
-- 1. Estructura y permisos (auto_expose_new_tables = false: nada sin GRANT explícito)
-- ---------------------------------------------------------------------------
select has_function('public', f, 'Existe public.' || f)
from unnest(array[
  'parametros_negocio', 'dentro_de_plazo', 'plazo_alcanzado', 'inicio_sesion', 'fin_programado',
  'reserva_hasta', 'revision_hasta', 'cancelable_hasta', 'fecha_limite_pago', 'fecha_limite_diferencia',
  'reporte_inasistencia_hasta', 'ventana_resena_hasta', 'desembolsable_desde', 'cumple_antelacion',
  'comision', 'monto_neto', 'parametros_comision', 'desembolso_ejecutable'
]) as f;

select has_view('public', 'monitoria_plazos', 'Existe la vista monitoria_plazos');

select is(
  (select reloptions from pg_class where oid = 'public.monitoria_plazos'::regclass),
  array['security_invoker=true'],
  'La vista corre con los permisos de quien consulta (así RLS de monitoria sigue mandando)');

select is(
  (select count(*)::int
   from unnest(array[
     'public.parametros_negocio()', 'public.dentro_de_plazo(timestamptz, timestamptz)',
     'public.plazo_alcanzado(timestamptz, timestamptz)', 'public.inicio_sesion(date, time)',
     'public.fin_programado(timestamptz, integer)', 'public.reserva_hasta(timestamptz)',
     'public.revision_hasta(timestamptz)', 'public.cancelable_hasta(timestamptz, boolean)',
     'public.fecha_limite_pago(timestamptz)', 'public.fecha_limite_diferencia(timestamptz)',
     'public.reporte_inasistencia_hasta(timestamptz)', 'public.ventana_resena_hasta(timestamptz)',
     'public.desembolsable_desde(timestamptz)',
     'public.cumple_antelacion(timestamptz, timestamptz, boolean)',
     'public.desembolso_ejecutable(timestamptz, timestamptz)'
   ]) as firma
   where has_function_privilege('anon', firma, 'execute')
      or not has_function_privilege('authenticated', firma, 'execute')
      or not has_function_privilege('service_role', firma, 'execute')),
  0,
  'Las 15 funciones de plazos: authenticated y service_role ejecutan, anon no');

-- N-2: la comisión solo la calcula el servidor. Ni anon ni authenticated (la sesión anónima de
-- Supabase también es authenticated) ejecutan la comisión, el neto ni sus parámetros.
select is(
  (select count(*)::int
   from unnest(array[
     'public.parametros_comision()', 'public.comision(integer)', 'public.monto_neto(integer)'
   ]) as firma
   where has_function_privilege('anon', firma, 'execute')
      or has_function_privilege('authenticated', firma, 'execute')
      or not has_function_privilege('service_role', firma, 'execute')),
  0,
  'Las 3 funciones de la comisión: solo service_role ejecuta (N-2)');

-- Ningún permiso se hereda de PUBLIC: las tres tienen una única ACL, la de service_role (y el dueño).
select is(
  (select count(*)::int
   from pg_proc p, lateral aclexplode(p.proacl) a
   where p.oid in ('public.parametros_comision()'::regprocedure, 'public.comision(integer)'::regprocedure,
                   'public.monto_neto(integer)'::regprocedure)
     and a.grantee = 0),
  0,
  'La comisión no tiene ningún permiso para PUBLIC');

select ok(
  not has_table_privilege('anon', 'public.monitoria_plazos', 'select')
  and has_table_privilege('authenticated', 'public.monitoria_plazos', 'select')
  and has_table_privilege('service_role', 'public.monitoria_plazos', 'select')
  and not has_table_privilege('authenticated', 'public.monitoria_plazos', 'insert'),
  'monitoria_plazos: solo lectura, sin acceso para anon');

-- ---------------------------------------------------------------------------
-- 2. Parámetros: un solo lugar, con los valores de la sección 6.1 y RN-81
-- ---------------------------------------------------------------------------
select results_eq(
  $$select reserva_min, revision_min, antelacion_individual_min, antelacion_grupal_min,
           cancelacion_individual_min, cancelacion_grupal_min, pago_integrantes_min, diferencia_min,
           reporte_inasistencia_min, resena_grupal_min, desembolso_min, cierre_automatico_min
    from public.parametros_negocio()$$,
  $$values (10, 60, 3 * 60, 36 * 60, 12 * 60, 24 * 60, 24 * 60, 5 * 60, 24 * 60, 60, 24 * 60, 24 * 60)$$,
  'parametros_negocio() trae exactamente la tabla 6.1, con el cierre automático de HU-023 (D-14)');

select is(
  (select array_agg(name order by ord)
   from unnest((select proargnames from pg_proc where oid = 'public.parametros_negocio()'::regprocedure))
        with ordinality as t(name, ord)),
  array['reserva_min', 'revision_min', 'antelacion_individual_min', 'antelacion_grupal_min',
        'cancelacion_individual_min', 'cancelacion_grupal_min', 'pago_integrantes_min', 'diferencia_min',
        'reporte_inasistencia_min', 'resena_grupal_min', 'desembolso_min', 'cierre_automatico_min'],
  'parametros_negocio() ya no devuelve la comisión: solo esas 12 columnas de plazo (la última, de HU-023)');

select results_eq(
  $$select comision_porcentaje, comision_tope from public.parametros_comision()$$,
  $$values (10, 15000)$$,
  'parametros_comision() trae la comisión de RN-81 y el tope de P-14');

-- Los parámetros y todo lo que los lee cambian con una migración: `stable`, nunca `immutable`.
select is(
  (select array_agg(proname::text order by proname)
   from pg_proc
   where pronamespace = 'public'::regnamespace
     and proname in ('parametros_negocio', 'parametros_comision', 'comision', 'monto_neto',
                     'reserva_hasta', 'revision_hasta', 'cancelable_hasta', 'fecha_limite_pago',
                     'fecha_limite_diferencia', 'reporte_inasistencia_hasta', 'ventana_resena_hasta',
                     'desembolsable_desde', 'cumple_antelacion', 'desembolso_ejecutable', 'fin_programado')
     and provolatile <> 's'),
  null::text[],
  'Ninguna función que lee parámetros es immutable ni volatile: todas son stable');

select is(
  (select array_agg(proname::text order by proname)
   from pg_proc
   where pronamespace = 'public'::regnamespace
     and proname in ('dentro_de_plazo', 'plazo_alcanzado', 'inicio_sesion')
     and provolatile <> 'i'),
  null::text[],
  'Las tres funciones puras (los bordes y el inicio de la sesión) siguen siendo immutable');

-- ---------------------------------------------------------------------------
-- 3. Inicio y fin de la sesión (RN-36)
-- ---------------------------------------------------------------------------
select is(public.inicio_sesion('2026-09-28', '12:00'), '2026-09-28 17:00:00+00'::timestamptz,
  'inicio_sesion: 12:00 en Bogotá son las 17:00 UTC');
select is(public.inicio_sesion('2026-09-28', '00:00'), '2026-09-28 05:00:00+00'::timestamptz,
  'inicio_sesion: la medianoche de Bogotá son las 05:00 UTC');
select is(public.inicio_sesion('2026-09-28', '23:59:59'), '2026-09-29 04:59:59+00'::timestamptz,
  'inicio_sesion: 23:59:59 en Bogotá ya es el día siguiente en UTC');
select is(public.inicio_sesion('2028-02-29', '08:00'), '2028-02-29 13:00:00+00'::timestamptz,
  'inicio_sesion: 29 de febrero de un año bisiesto');

set local timezone = 'Asia/Tokyo';
select is(public.inicio_sesion('2026-10-05', '10:00'), '2026-10-05 15:00:00+00'::timestamptz,
  'inicio_sesion no depende de la zona de la sesión (Tokio)');
set local timezone = 'UTC';
select is(public.inicio_sesion('2026-10-05', '10:00'), '2026-10-05 15:00:00+00'::timestamptz,
  'inicio_sesion no depende de la zona de la sesión (UTC)');
reset timezone;

select is(public.fin_programado('2026-10-05 15:00:00+00', 90), '2026-10-05 16:30:00+00'::timestamptz,
  'fin_programado: inicio más duracion_min');

-- ---------------------------------------------------------------------------
-- 4. Plazos derivados (sección 6.1)
-- ---------------------------------------------------------------------------
select is(public.reserva_hasta('2026-10-01 14:00:00+00'), '2026-10-01 14:10:00+00'::timestamptz,
  'reserva_hasta: +10 min');
select is(public.revision_hasta('2026-10-01 14:00:00+00'), '2026-10-01 15:00:00+00'::timestamptz,
  'revision_hasta: +1 h');
select is(public.cancelable_hasta('2026-10-05 15:00:00+00', false), '2026-10-05 03:00:00+00'::timestamptz,
  'cancelable_hasta individual: -12 h');
select is(public.cancelable_hasta('2026-10-05 15:00:00+00', true), '2026-10-04 15:00:00+00'::timestamptz,
  'cancelable_hasta grupal: -24 h');
select is(public.fecha_limite_pago('2026-10-05 15:00:00+00'), '2026-10-04 15:00:00+00'::timestamptz,
  'fecha_limite_pago: -24 h');
select is(public.fecha_limite_diferencia('2026-10-05 15:00:00+00'), '2026-10-05 10:00:00+00'::timestamptz,
  'fecha_limite_diferencia: -5 h');
select is(public.reporte_inasistencia_hasta('2026-10-05 16:00:00+00'), '2026-10-06 16:00:00+00'::timestamptz,
  'reporte_inasistencia_hasta: fin + 24 h');
select is(public.ventana_resena_hasta('2026-10-05 16:20:00+00'), '2026-10-05 17:20:00+00'::timestamptz,
  'ventana_resena_hasta: finalización + 1 h');
select is(public.desembolsable_desde('2026-10-05 16:00:00+00'), '2026-10-06 16:00:00+00'::timestamptz,
  'desembolsable_desde: fin + 24 h');
select throws_ok(
  $$select public.ventana_resena_hasta(null)$$, '22004',
  'La fecha de finalización es obligatoria para calcular la ventana de reseña.',
  'ventana_resena_hasta(null) rechaza, igual que ventanaResenaHasta(null) en TypeScript');

-- ---------------------------------------------------------------------------
-- 5. Bordes inclusivos (P-40): un minuto antes, en el borde y un minuto después
--    "Hasta X" da {true, true, false}; "desde X" da {false, true, true}.
-- ---------------------------------------------------------------------------
select is(
  array[
    public.dentro_de_plazo(limite, borde - interval '1 minute'),
    public.dentro_de_plazo(limite, borde),
    public.dentro_de_plazo(limite, borde + interval '1 minute')],
  array[true, true, false],
  'Borde inclusivo "hasta": ' || nombre)
from (values
  -- (nombre, límite calculado por la función del plazo, borde escrito a mano)
  ('reserva de 10 min', public.reserva_hasta('2026-10-01 14:00:00+00'), '2026-10-01 14:10:00+00'::timestamptz),
  ('revisión de 1 h', public.revision_hasta('2026-10-01 14:00:00+00'), '2026-10-01 15:00:00+00'::timestamptz),
  ('cancelación individual (12 h)', public.cancelable_hasta('2026-10-05 15:00:00+00', false), '2026-10-05 03:00:00+00'::timestamptz),
  ('cancelación grupal (24 h)', public.cancelable_hasta('2026-10-05 15:00:00+00', true), '2026-10-04 15:00:00+00'::timestamptz),
  ('pago de integrantes (24 h)', public.fecha_limite_pago('2026-10-05 15:00:00+00'), '2026-10-04 15:00:00+00'::timestamptz),
  ('diferencia (5 h)', public.fecha_limite_diferencia('2026-10-05 15:00:00+00'), '2026-10-05 10:00:00+00'::timestamptz),
  ('reporte de inasistencia (24 h después del fin)', public.reporte_inasistencia_hasta('2026-10-05 16:00:00+00'), '2026-10-06 16:00:00+00'::timestamptz),
  ('reseña grupal (1 h)', public.ventana_resena_hasta('2026-10-05 16:20:00+00'), '2026-10-05 17:20:00+00'::timestamptz)
) as t(nombre, limite, borde);

select is(
  array[
    public.plazo_alcanzado(limite, borde - interval '1 minute'),
    public.plazo_alcanzado(limite, borde),
    public.plazo_alcanzado(limite, borde + interval '1 minute')],
  array[false, true, true],
  'Borde inclusivo "desde": desembolso (24 h después del fin)')
from (values (
  public.desembolsable_desde('2026-10-05 16:00:00+00'), '2026-10-06 16:00:00+00'::timestamptz
)) as t(limite, borde);

-- N-6: el desembolso solo se ejecuta cuando ya venció la ventana de reporte. En el instante exacto
-- fin + 24 h el reporte todavía se puede hacer, así que el desembolso todavía no es ejecutable.
select is(
  array[
    public.desembolso_ejecutable(fin, borde - interval '1 minute'),
    public.desembolso_ejecutable(fin, borde - interval '1 microsecond'),
    public.desembolso_ejecutable(fin, borde),
    public.desembolso_ejecutable(fin, borde + interval '1 microsecond'),
    public.desembolso_ejecutable(fin, borde + interval '1 minute')],
  array[false, false, false, true, true],
  'Desembolso ejecutable: nunca en el borde exacto de fin + 24 h, sí desde un instante después')
from (values ('2026-10-05 16:00:00+00'::timestamptz, '2026-10-06 16:00:00+00'::timestamptz)) as t(fin, borde);

select is(
  array[
    public.dentro_de_plazo(public.reporte_inasistencia_hasta(fin), borde),
    public.plazo_alcanzado(public.desembolsable_desde(fin), borde),
    public.desembolso_ejecutable(fin, borde)],
  array[true, true, false],
  'En fin + 24 h exacto el reporte sigue abierto, el plazo de desembolso ya se alcanzó y aun así no es ejecutable')
from (values ('2026-10-05 16:00:00+00'::timestamptz, '2026-10-06 16:00:00+00'::timestamptz)) as t(fin, borde);

select is(public.desembolso_ejecutable(null, now()), null::boolean, 'desembolso_ejecutable(null, ...) es null (strict)');

select is(
  array[
    public.cumple_antelacion(i, i - interval '3 hours' - interval '1 minute', false),
    public.cumple_antelacion(i, i - interval '3 hours', false),
    public.cumple_antelacion(i, i - interval '3 hours' + interval '1 minute', false)],
  array[true, true, false],
  'Antelación individual: con 3 h exactas todavía se puede agendar (P-40)')
from (values ('2026-10-05 15:00:00+00'::timestamptz)) as t(i);

select is(
  array[
    public.cumple_antelacion(i, i - interval '36 hours' - interval '1 minute', true),
    public.cumple_antelacion(i, i - interval '36 hours', true),
    public.cumple_antelacion(i, i - interval '36 hours' + interval '1 minute', true)],
  array[true, true, false],
  'Antelación grupal: con 36 h exactas todavía se puede agendar (P-40)')
from (values ('2026-10-05 15:00:00+00'::timestamptz)) as t(i);

select is(public.cumple_antelacion('2026-10-05 15:00:00+00', '2026-10-05 15:00:00+00', false), false,
  'Agendar con la sesión ya empezando nunca cumple la antelación');

select is(
  array[public.dentro_de_plazo('2026-10-05 03:00:00+00', '2026-10-05 03:00:01+00')],
  array[false],
  'El borde no se redondea a minutos: un segundo de más ya es fuera de plazo');

-- ---------------------------------------------------------------------------
-- 6. Comisión de la plataforma (RN-81)
-- ---------------------------------------------------------------------------
select is(array[public.comision(b), public.monto_neto(b)], array[c, n], 'Comisión y neto de ' || b)
from (values
  (25000, 2500, 22500),
  (100000, 10000, 90000),
  (150000, 15000, 135000),
  (200000, 15000, 185000),
  (0, 0, 0),
  (149990, 14999, 134991),
  (150010, 15000, 135010)
) as t(b, c, n);

-- N-1 (29-sep-2026): RN-81 no fija el redondeo y se queda el peso más cercano, con medio peso hacia arriba.
select is(public.comision(b), c, 'Redondeo al peso más cercano: bruto ' || b || ' da ' || c)
from (values (4, 0), (5, 1), (14, 1), (15, 2), (149994, 14999), (149995, 15000)) as t(b, c);

select throws_ok($$select public.comision(-1)$$, '22023', null,
  'comision rechaza un bruto negativo');
select throws_ok($$select public.monto_neto(-25000)$$, '22023', null,
  'monto_neto rechaza un bruto negativo');
select is(public.comision(null), null::integer, 'comision(null) es null');

-- ---------------------------------------------------------------------------
-- 7. Vista monitoria_plazos: valores y acceso (RLS de monitoria)
-- ---------------------------------------------------------------------------
insert into auth.users (id, is_anonymous) values
  ('a0000000-0000-0000-0000-000000000001', false),
  ('b0000000-0000-0000-0000-000000000001', false),
  ('b0000000-0000-0000-0000-000000000002', false),
  ('c0000000-0000-0000-0000-00000000000a', true),
  ('c0000000-0000-0000-0000-00000000000b', true);

insert into public.materia (id, nombre, codigo) values
  ('10000000-0000-0000-0000-000000000001', 'Materia uno', 'PRB-1');
-- orden_revision es único y la semilla (supabase/seed.sql) usa 1 y 2: aquí, números altos.
insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-000000000001', 'Admin Prueba', 'admin@example.com', 9000001);
insert into public.monitor (id, nombre) values
  ('b0000000-0000-0000-0000-000000000001', 'Monitor Uno'),
  ('b0000000-0000-0000-0000-000000000002', 'Monitor Dos');
insert into public.certificado (id_monitor, id_materia, id_admin) values
  ('b0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001');

-- Franja del monitor 1: lunes a las 10:00, 90 minutos.
insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min) values
  ('30000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 1, '10:00', true, 25000, 90);

insert into public.lead (id, id_sesion_anonima, nombre, correo, acepta_tratamiento_datos, fecha_consentimiento) values
  ('40000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000a', 'Lead A', 'a@example.com', true, now());

-- Individual (5 oct), grupal sin finalizar (19 oct) y grupal ya realizada (12 oct). Todas en lunes.
insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, fecha_creacion) values
  ('50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-00000000000a',
   '2026-10-05', 25000, '2026-10-01 14:00:00+00'),
  ('50000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-00000000000a',
   '2026-10-19', 60000, '2026-10-01 14:00:00+00');
insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, fecha_creacion, estado, fecha_finalizacion) values
  ('50000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-00000000000a',
   '2026-10-12', 60000, '2026-10-01 14:00:00+00', 'realizada', '2026-10-12 16:45:00+00');
insert into public.monitoria_grupal (id_monitoria, cupos, modalidad_pago, precio_por_persona) values
  ('50000000-0000-0000-0000-000000000002', 3, 'dividido', 20000),
  ('50000000-0000-0000-0000-000000000003', 3, 'dividido', 20000);

select results_eq(
  $$select inicio, fin_programado, es_grupal, reserva_hasta, cancelable_hasta,
           fecha_limite_pago, fecha_limite_diferencia, reporte_inasistencia_hasta,
           ventana_resena_hasta, desembolsable_desde
    from public.monitoria_plazos where id_monitoria = '50000000-0000-0000-0000-000000000001'$$,
  $$values (
    '2026-10-05 15:00:00+00'::timestamptz, '2026-10-05 16:30:00+00'::timestamptz, false,
    '2026-10-01 14:10:00+00'::timestamptz, '2026-10-05 03:00:00+00'::timestamptz,
    null::timestamptz, null::timestamptz, '2026-10-06 16:30:00+00'::timestamptz,
    null::timestamptz, '2026-10-06 16:30:00+00'::timestamptz)$$,
  'Vista: una individual (12 h para cancelar y sin plazos de grupal)');

select results_eq(
  $$select inicio, es_grupal, cancelable_hasta, fecha_limite_pago, fecha_limite_diferencia, ventana_resena_hasta
    from public.monitoria_plazos where id_monitoria = '50000000-0000-0000-0000-000000000002'$$,
  $$values (
    '2026-10-19 15:00:00+00'::timestamptz, true, '2026-10-18 15:00:00+00'::timestamptz,
    '2026-10-18 15:00:00+00'::timestamptz, '2026-10-19 10:00:00+00'::timestamptz, null::timestamptz)$$,
  'Vista: una grupal sin finalizar (24 h para cancelar, límites de pago y diferencia, sin ventana de reseña)');

select is(
  (select ventana_resena_hasta from public.monitoria_plazos where id_monitoria = '50000000-0000-0000-0000-000000000003'),
  '2026-10-12 17:45:00+00'::timestamptz,
  'Vista: una grupal realizada tiene ventana de reseña de 1 h desde la finalización');

-- Acceso: la vista respeta las políticas de monitoria (security_invoker).
set local role authenticated;

set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.monitoria_plazos), 3, 'Un admin ve los plazos de todas las monitorías');

set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-00000000000a","role":"authenticated","is_anonymous":true}';
select is((select count(*)::int from public.monitoria_plazos), 3, 'Quien agendó ve los plazos de sus monitorías');

set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.monitoria_plazos), 3, 'El monitor de la franja ve los plazos de sus monitorías');

set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.monitoria_plazos), 0, 'Otro monitor no ve los plazos de monitorías ajenas');

set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-00000000000b","role":"authenticated","is_anonymous":true}';
select is((select count(*)::int from public.monitoria_plazos), 0, 'Otra sesión anónima no ve los plazos de monitorías ajenas');

select lives_ok(
  $$select public.parametros_negocio(), public.desembolso_ejecutable(now(), now()),
           public.ventana_resena_hasta(now()), public.reserva_hasta(now())$$,
  'Una sesión anónima (rol authenticated) ejecuta las funciones de plazos');
select throws_ok($$select public.comision(25000)$$, '42501', null,
  'Una sesión con rol authenticated no calcula la comisión (N-2)');
select throws_ok($$select public.monto_neto(25000)$$, '42501', null,
  'Una sesión con rol authenticated no calcula el neto (N-2)');
select throws_ok($$select * from public.parametros_comision()$$, '42501', null,
  'Una sesión con rol authenticated no lee los parámetros de la comisión (N-2)');

reset role;

set local role anon;
select throws_ok($$select * from public.monitoria_plazos$$, '42501', null,
  'Sin sesión (anon) no se leen los plazos');
select throws_ok($$select public.comision(25000)$$, '42501', null,
  'Sin sesión (anon) no se ejecutan las funciones del motor');
select throws_ok($$select * from public.parametros_negocio()$$, '42501', null,
  'Sin sesión (anon) no se leen los parámetros de plazo');
reset role;

set local role service_role;
select is(public.comision(25000), 2500, 'service_role sí calcula la comisión');
select is(public.monto_neto(25000), 22500, 'service_role sí calcula el neto');
select results_eq($$select comision_porcentaje, comision_tope from public.parametros_comision()$$,
  $$values (10, 15000)$$, 'service_role sí lee los parámetros de la comisión');
reset role;

-- ---------------------------------------------------------------------------
-- 8. Cada función lee SU parámetro (y ninguna lleva un número propio)
--    La tabla real repite valores (1440 cuatro veces, 60 dos veces), así que una función que leyera
--    el campo equivocado pasaría sin que nadie lo note. Se redefine parametros_negocio() con primos
--    distintos, dentro de esta transacción (termina en rollback), y se mide cada desfase.
-- ---------------------------------------------------------------------------
create or replace function public.parametros_negocio()
returns table (
  reserva_min integer, revision_min integer, antelacion_individual_min integer, antelacion_grupal_min integer,
  cancelacion_individual_min integer, cancelacion_grupal_min integer, pago_integrantes_min integer,
  diferencia_min integer, reporte_inasistencia_min integer, resena_grupal_min integer, desembolso_min integer,
  cierre_automatico_min integer
)
language sql stable parallel safe set search_path = ''
as $$ select 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 59 $$;

create or replace function public.parametros_comision()
returns table (comision_porcentaje integer, comision_tope integer)
language sql stable parallel safe set search_path = ''
as $$ select 47, 53 $$;

select is((extract(epoch from (f - t)) / 60)::int, esperado, 'Desfase de ' || nombre)
from (values
  ('reserva_hasta = reserva_min', public.reserva_hasta('2026-10-05 15:00:00+00'), '2026-10-05 15:00:00+00'::timestamptz, 7),
  ('revision_hasta = revision_min', public.revision_hasta('2026-10-05 15:00:00+00'), '2026-10-05 15:00:00+00'::timestamptz, 11),
  ('cancelable_hasta individual = -cancelacion_individual_min', public.cancelable_hasta('2026-10-05 15:00:00+00', false), '2026-10-05 15:00:00+00'::timestamptz, -19),
  ('cancelable_hasta grupal = -cancelacion_grupal_min', public.cancelable_hasta('2026-10-05 15:00:00+00', true), '2026-10-05 15:00:00+00'::timestamptz, -23),
  ('fecha_limite_pago = -pago_integrantes_min', public.fecha_limite_pago('2026-10-05 15:00:00+00'), '2026-10-05 15:00:00+00'::timestamptz, -29),
  ('fecha_limite_diferencia = -diferencia_min', public.fecha_limite_diferencia('2026-10-05 15:00:00+00'), '2026-10-05 15:00:00+00'::timestamptz, -31),
  ('reporte_inasistencia_hasta = reporte_inasistencia_min', public.reporte_inasistencia_hasta('2026-10-05 15:00:00+00'), '2026-10-05 15:00:00+00'::timestamptz, 37),
  ('ventana_resena_hasta = resena_grupal_min', public.ventana_resena_hasta('2026-10-05 15:00:00+00'), '2026-10-05 15:00:00+00'::timestamptz, 41),
  ('desembolsable_desde = desembolso_min', public.desembolsable_desde('2026-10-05 15:00:00+00'), '2026-10-05 15:00:00+00'::timestamptz, 43),
  ('cierre_automatico_desde = cierre_automatico_min', public.cierre_automatico_desde('2026-10-05 15:00:00+00'), '2026-10-05 15:00:00+00'::timestamptz, 59)
) as t(nombre, f, t, esperado);

select is(
  array[
    public.cumple_antelacion(i, i - interval '13 minutes', false),
    public.cumple_antelacion(i, i - interval '12 minutes', false),
    public.cumple_antelacion(i, i - interval '17 minutes', true),
    public.cumple_antelacion(i, i - interval '16 minutes', true)],
  array[true, false, true, false],
  'cumple_antelacion usa antelacion_individual_min (13) e antelacion_grupal_min (17)')
from (values ('2026-10-05 15:00:00+00'::timestamptz)) as t(i);

select is(array[public.comision(100), public.comision(1000), public.monto_neto(100)], array[47, 53, 53],
  'comision usa comision_porcentaje (47 %) y comision_tope (53) de parametros_comision()');

-- desembolso_ejecutable lee los DOS parámetros: con reporte de 37 min y desembolso de 43 min manda el más tardío...
select is(
  array[
    public.desembolso_ejecutable(f, f + interval '42 minutes'),
    public.desembolso_ejecutable(f, f + interval '43 minutes' - interval '1 microsecond'),
    public.desembolso_ejecutable(f, f + interval '43 minutes'),
    public.desembolso_ejecutable(f, f + interval '44 minutes')],
  array[false, false, true, true],
  'desembolso_ejecutable con reporte 37 y desembolso 43: manda desembolso_min y su borde es inclusivo')
from (values ('2026-10-05 15:00:00+00'::timestamptz)) as t(f);

-- ...y con el reporte más largo que el desembolso, el reporte igual manda (N-6), con borde exclusivo.
create or replace function public.parametros_negocio()
returns table (
  reserva_min integer, revision_min integer, antelacion_individual_min integer, antelacion_grupal_min integer,
  cancelacion_individual_min integer, cancelacion_grupal_min integer, pago_integrantes_min integer,
  diferencia_min integer, reporte_inasistencia_min integer, resena_grupal_min integer, desembolso_min integer,
  cierre_automatico_min integer
)
language sql stable parallel safe set search_path = ''
as $$ select 7, 11, 13, 17, 19, 23, 29, 31, 43, 41, 37, 59 $$;

select is(
  array[
    public.desembolso_ejecutable(f, f + interval '37 minutes'),
    public.desembolso_ejecutable(f, f + interval '43 minutes'),
    public.desembolso_ejecutable(f, f + interval '43 minutes' + interval '1 microsecond')],
  array[false, false, true],
  'desembolso_ejecutable con reporte 43 y desembolso 37: el reporte abierto impide ejecutar hasta que venza')
from (values ('2026-10-05 15:00:00+00'::timestamptz)) as t(f);

select * from finish();
rollback;
