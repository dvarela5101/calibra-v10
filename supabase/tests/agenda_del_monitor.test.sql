-- Pruebas pgTAP de la agenda del monitor (HU-021).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.
--
-- La puerta pública (public.mi_agenda) siempre usa now(); las reglas que dependen de la hora (D-12) se prueban con
-- privado.agenda_del_monitor y un `ahora` fijo, el lunes 5 de octubre de 2026 a las 12:00 en Bogotá, para que los
-- bordes no dependan del día en que corre la prueba. Al final se comprueba con now() que la puerta pasa la hora real.
-- Las monitorías se insertan como postgres: el trigger completa id_monitor desde la franja y exige que la fecha
-- caiga en el día de la franja (por eso las fechas son lunes, martes, miércoles o viernes según la franja).
--
-- Elenco (todos los ids terminan en 21NN; las materias son 'PGTAP-21-A' y 'PGTAP-21-B'):
--   Monitores: A (agenda principal, cuatro franjas, diez monitorías), B (otra agenda, dos monitorías), C (sin
--   monitorías), D (los estados del pago, D-11) y E (las reservas vencidas, D-12).
--   Leads: 01 (Lucía) y 02 (Mateo), cada uno con su sesión anónima. Admin: 01.
--   Monitorías de A (01 a 10), en el orden en que la agenda las debe mostrar:
--     03 realizada, vie 25-sep 07:30   04 cancelada (estudiante), lun 28-sep 10:00
--     06 cancelada (estudiante) y 07 confirmada, las dos vie 2-oct 07:30 (mismo inicio: desempata el id)
--     10 por pagar, lun 5-oct 10:00    02 confirmada, lun 5-oct 15:00 (otra franja, el mismo día)
--     05 cancelada (pago rechazado), mié 7-oct 18:00    01 confirmada, mié 14-oct 18:00
--     08 confirmada y 09 cancelada (reserva expirada), las dos vie 16-oct 07:30 (otra vez desempata el id)
--   B: 31 y 32. D: 11 a 19. E: 21 a 29.

begin;
create extension if not exists pgtap with schema extensions;

select plan(56);

-- ---------------------------------------------------------------------------
-- Estructura y permisos
-- ---------------------------------------------------------------------------
select has_function('privado', 'agenda_del_monitor', array['timestamp with time zone'],
  'Existe privado.agenda_del_monitor, la agenda con la hora como parámetro (para probar los plazos)');
select has_function('public', 'mi_agenda', '{}'::name[],
  'Existe su puerta en la Data API: public.mi_agenda()');
select ok(
  (select prosecdef from pg_proc where oid = 'privado.agenda_del_monitor(timestamptz)'::regprocedure)
  and not (select prosecdef from pg_proc where oid = 'public.mi_agenda()'::regprocedure),
  'La de privado es security definer (lee lead y pago, que el monitor no lee); la puerta corre con los permisos de quien llama');
select ok(
  (select bool_and('search_path=""' = any(proconfig)) from pg_proc
   where oid in ('privado.agenda_del_monitor(timestamptz)'::regprocedure, 'public.mi_agenda()'::regprocedure)),
  'Las dos fijan un search_path vacío');
select is(
  array[pg_get_function_identity_arguments('privado.agenda_del_monitor(timestamptz)'::regprocedure),
        pg_get_function_identity_arguments('public.mi_agenda()'::regprocedure)],
  array['p_ahora timestamp with time zone', ''],
  'La puerta no recibe nada, ni el monitor ni la hora: nadie pide la agenda de otro monitor ni cambia el reloj (HU-021)');
select ok(
  not has_function_privilege('anon', 'public.mi_agenda()', 'execute')
  and not has_function_privilege('anon', 'privado.agenda_del_monitor(timestamptz)', 'execute'),
  'Sin sesión (anon) no hay agenda: ni la puerta pública ni la de privado');
select ok(
  has_function_privilege('authenticated', 'public.mi_agenda()', 'execute')
  and has_function_privilege('authenticated', 'privado.agenda_del_monitor(timestamptz)', 'execute'),
  'Con sesión sí: la puerta (invoker) llega a la función de privado con el permiso de quien llama');
select ok(
  not has_function_privilege('service_role', 'public.mi_agenda()', 'execute')
  and not has_function_privilege('service_role', 'privado.agenda_del_monitor(timestamptz)', 'execute'),
  'service_role no la necesita: sin sesión no hay auth.uid() ni monitor');
select ok(
  not exists (
    select 1
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid in ('privado.agenda_del_monitor(timestamptz)'::regprocedure, 'public.mi_agenda()'::regprocedure)
      and a.grantee = 0),
  'Nadie las hereda de PUBLIC');

-- Lo que devuelve: solo lo que la agenda muestra. P-37 (nombre sí, correo y teléfono no) y P-24 (estado del pago, sin cifras).
select is(
  (select array_agg(a.n order by a.o)
   from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as a(n, m, o)
   where p.oid = 'privado.agenda_del_monitor(timestamptz)'::regprocedure and a.m = 't'),
  array['id_monitoria', 'fecha', 'hora', 'duracion_min', 'presencial', 'nombre_materia', 'codigo_materia',
        'nombre_estudiante', 'estado', 'motivo_cancelacion', 'reserva_vencida', 'estado_pago', 'inicio'],
  'La función de privado devuelve fecha, hora, duración, modalidad, materia, nombre de quien agendó, estado, motivo, reserva vencida, estado del pago e inicio');
select is(
  (select array_agg(a.n order by a.o)
   from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as a(n, m, o)
   where p.oid = 'public.mi_agenda()'::regprocedure and a.m = 't'),
  (select array_agg(a.n order by a.o)
   from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as a(n, m, o)
   where p.oid = 'privado.agenda_del_monitor(timestamptz)'::regprocedure and a.m = 't'),
  'La puerta devuelve exactamente las mismas columnas, en el mismo orden');
select ok(
  not exists (
    select 1
    from pg_proc p, unnest(p.proargnames, p.proargmodes) as a(n, m)
    where p.oid in ('privado.agenda_del_monitor(timestamptz)'::regprocedure, 'public.mi_agenda()'::regprocedure)
      and a.m = 't'
      and a.n ~* '(correo|mail|telefono|celular|numero|llave|lugar|enlace|valor|monto|precio|comision|contacto|pagador)'),
  'Ninguna columna de salida es de correo, teléfono, llave, lugar, enlace, valor, monto, precio ni comisión');

-- Sin sesión de monitor, la puerta ni se ejecuta.
set local role anon;
select throws_ok($$select * from public.mi_agenda()$$, '42501', null,
  'anon no puede llamar a mi_agenda: permiso denegado');
reset role;
set local role service_role;
select throws_ok($$select * from public.mi_agenda()$$, '42501', null,
  'service_role tampoco: no es un monitor');
reset role;

-- ---------------------------------------------------------------------------
-- Fixtures (como postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, is_anonymous) values
  ('a0000000-0000-0000-0000-000000002101', false),
  ('b0000000-0000-0000-0000-0000000021a0', false),
  ('b0000000-0000-0000-0000-0000000021b0', false),
  ('b0000000-0000-0000-0000-0000000021c0', false),
  ('b0000000-0000-0000-0000-0000000021d0', false),
  ('b0000000-0000-0000-0000-0000000021e0', false),
  ('c0000000-0000-0000-0000-000000002101', true),
  ('c0000000-0000-0000-0000-000000002102', true);

insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-000000002101', 'Admin', 'admin21@calibra.test', 9002101);
insert into public.monitor (id, nombre) values
  ('b0000000-0000-0000-0000-0000000021a0', 'Ana 21'),
  ('b0000000-0000-0000-0000-0000000021b0', 'Beto 21'),
  ('b0000000-0000-0000-0000-0000000021c0', 'Caro 21'),
  ('b0000000-0000-0000-0000-0000000021d0', 'Dani 21'),
  ('b0000000-0000-0000-0000-0000000021e0', 'Eva 21');
insert into public.monitor_privado (id_monitor, numero_telefono, correo, llave) values
  ('b0000000-0000-0000-0000-0000000021a0', '3002101000', 'ana.secreta21@example.com', 'llave-secreta-21');

insert into public.materia (id, nombre, codigo) values
  ('10000000-0000-0000-0000-0000000021a1', 'Materia 21 A', 'PGTAP-21-A'),
  ('10000000-0000-0000-0000-0000000021b1', 'Materia 21 B', 'PGTAP-21-B');
-- A dicta las dos materias; los demás, una.
insert into public.certificado (id_monitor, id_materia, id_admin) values
  ('b0000000-0000-0000-0000-0000000021a0', '10000000-0000-0000-0000-0000000021a1', 'a0000000-0000-0000-0000-000000002101'),
  ('b0000000-0000-0000-0000-0000000021a0', '10000000-0000-0000-0000-0000000021b1', 'a0000000-0000-0000-0000-000000002101'),
  ('b0000000-0000-0000-0000-0000000021b0', '10000000-0000-0000-0000-0000000021b1', 'a0000000-0000-0000-0000-000000002101'),
  ('b0000000-0000-0000-0000-0000000021c0', '10000000-0000-0000-0000-0000000021a1', 'a0000000-0000-0000-0000-000000002101'),
  ('b0000000-0000-0000-0000-0000000021d0', '10000000-0000-0000-0000-0000000021a1', 'a0000000-0000-0000-0000-000000002101'),
  ('b0000000-0000-0000-0000-0000000021e0', '10000000-0000-0000-0000-0000000021a1', 'a0000000-0000-0000-0000-000000002101');

-- Franjas. De A: a1 lunes 10:00 presencial (60 min), a2 miércoles 18:00 virtual (90), a3 viernes 07:30 virtual (45),
-- a4 lunes 15:00 virtual (60). Precio, lugar y enlace llevan datos que la agenda no debe mostrar.
insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min, lugar, enlace, abierta_desde, cerrada_desde) values
  ('30000000-0000-0000-0000-0000000021a1', 'b0000000-0000-0000-0000-0000000021a0', 1, '10:00', true, 135790, 60,
   'Salón secreto 2101', null, '2026-01-01', null),
  ('30000000-0000-0000-0000-0000000021a2', 'b0000000-0000-0000-0000-0000000021a0', 3, '18:00', false, 135790, 90,
   null, 'https://meet.example/sala-secreta-2101', '2026-01-01', null),
  ('30000000-0000-0000-0000-0000000021a3', 'b0000000-0000-0000-0000-0000000021a0', 5, '07:30', false, 135790, 45,
   null, 'https://meet.example/sala-secreta-2101', '2026-01-01', null),
  ('30000000-0000-0000-0000-0000000021a4', 'b0000000-0000-0000-0000-0000000021a0', 1, '15:00', false, 135790, 60,
   null, 'https://meet.example/sala-secreta-2101', '2026-01-01', null),
  ('30000000-0000-0000-0000-0000000021b1', 'b0000000-0000-0000-0000-0000000021b0', 2, '09:00', true, 135790, 60,
   'Salón secreto 2102', null, '2026-01-01', null),
  ('30000000-0000-0000-0000-0000000021d1', 'b0000000-0000-0000-0000-0000000021d0', 1, '09:00', false, 135790, 60,
   null, 'https://meet.example/sala-secreta-2103', '2026-01-01', null),
  ('30000000-0000-0000-0000-0000000021e1', 'b0000000-0000-0000-0000-0000000021e0', 1, '09:00', false, 135790, 60,
   null, 'https://meet.example/sala-secreta-2104', '2026-01-01', null);

-- Dos Leads, cada uno con su sesión anónima y datos de contacto que la agenda no debe mostrar.
insert into public.lead (id, id_sesion_anonima, nombre, numero_telefono, correo, acepta_tratamiento_datos, fecha_consentimiento) values
  ('40000000-0000-0000-0000-000000002101', 'c0000000-0000-0000-0000-000000002101', 'Lucía Prueba 21', '3002101111',
   'lucia.secreta21@calibra.test', true, now()),
  ('40000000-0000-0000-0000-000000002102', 'c0000000-0000-0000-0000-000000002102', 'Mateo Prueba 21', '3002102222',
   'mateo.secreto21@calibra.test', true, now());

-- Monitorías de A (se insertan sin orden; el valor_total lleva un número que la agenda no debe mostrar).
insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado, motivo_cancelacion, fecha_finalizacion) values
  ('50000000-0000-0000-0000-000000002101', '30000000-0000-0000-0000-0000000021a2', '10000000-0000-0000-0000-0000000021b1',
   '40000000-0000-0000-0000-000000002101', '2026-10-14', 987654, 'confirmada', null, null),
  ('50000000-0000-0000-0000-000000002102', '30000000-0000-0000-0000-0000000021a4', '10000000-0000-0000-0000-0000000021a1',
   '40000000-0000-0000-0000-000000002102', '2026-10-05', 987654, 'confirmada', null, null),
  ('50000000-0000-0000-0000-000000002103', '30000000-0000-0000-0000-0000000021a3', '10000000-0000-0000-0000-0000000021a1',
   '40000000-0000-0000-0000-000000002101', '2026-09-25', 987654, 'realizada', null, '2026-09-25 08:20-05'),
  ('50000000-0000-0000-0000-000000002104', '30000000-0000-0000-0000-0000000021a1', '10000000-0000-0000-0000-0000000021a1',
   '40000000-0000-0000-0000-000000002102', '2026-09-28', 987654, 'cancelada', 'estudiante', null),
  ('50000000-0000-0000-0000-000000002105', '30000000-0000-0000-0000-0000000021a2', '10000000-0000-0000-0000-0000000021b1',
   '40000000-0000-0000-0000-000000002102', '2026-10-07', 987654, 'cancelada', 'pago_rechazado', null),
  ('50000000-0000-0000-0000-000000002106', '30000000-0000-0000-0000-0000000021a3', '10000000-0000-0000-0000-0000000021a1',
   '40000000-0000-0000-0000-000000002101', '2026-10-02', 987654, 'cancelada', 'estudiante', null),
  ('50000000-0000-0000-0000-000000002107', '30000000-0000-0000-0000-0000000021a3', '10000000-0000-0000-0000-0000000021a1',
   '40000000-0000-0000-0000-000000002102', '2026-10-02', 987654, 'confirmada', null, null),
  ('50000000-0000-0000-0000-000000002108', '30000000-0000-0000-0000-0000000021a3', '10000000-0000-0000-0000-0000000021a1',
   '40000000-0000-0000-0000-000000002101', '2026-10-16', 987654, 'confirmada', null, null),
  ('50000000-0000-0000-0000-000000002109', '30000000-0000-0000-0000-0000000021a3', '10000000-0000-0000-0000-0000000021a1',
   '40000000-0000-0000-0000-000000002102', '2026-10-16', 987654, 'cancelada', 'reserva_expirada', null),
  ('50000000-0000-0000-0000-000000002110', '30000000-0000-0000-0000-0000000021a1', '10000000-0000-0000-0000-0000000021a1',
   '40000000-0000-0000-0000-000000002101', '2026-10-05', 987654, 'pendiente_pago', null, null);
-- B: una confirmada de Mateo y una cancelada de Lucía.
insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado, motivo_cancelacion, fecha_finalizacion) values
  ('50000000-0000-0000-0000-000000002131', '30000000-0000-0000-0000-0000000021b1', '10000000-0000-0000-0000-0000000021b1',
   '40000000-0000-0000-0000-000000002102', '2026-10-06', 987654, 'confirmada', null, null),
  ('50000000-0000-0000-0000-000000002132', '30000000-0000-0000-0000-0000000021b1', '10000000-0000-0000-0000-0000000021b1',
   '40000000-0000-0000-0000-000000002101', '2026-10-13', 987654, 'cancelada', 'pago_rechazado', null);

-- D-11: las monitorías de D, todas de Lucía en lunes, con cada combinación de pagos.
--   11 sin pagos             12 en_revision               13 aprobado                14 rechazado
--   15 aprobado + en_revision    16 aprobado + rechazado    17 en_revision + rechazado
--   18 aprobado + en_revision + rechazado                  19 dos aprobados
insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado, motivo_cancelacion, fecha_finalizacion) values
  ('50000000-0000-0000-0000-000000002111', '30000000-0000-0000-0000-0000000021d1', '10000000-0000-0000-0000-0000000021a1',
   '40000000-0000-0000-0000-000000002101', '2026-10-05', 987654, 'pendiente_pago', null, null),
  ('50000000-0000-0000-0000-000000002112', '30000000-0000-0000-0000-0000000021d1', '10000000-0000-0000-0000-0000000021a1',
   '40000000-0000-0000-0000-000000002101', '2026-10-12', 987654, 'pendiente_pago', null, null),
  ('50000000-0000-0000-0000-000000002113', '30000000-0000-0000-0000-0000000021d1', '10000000-0000-0000-0000-0000000021a1',
   '40000000-0000-0000-0000-000000002101', '2026-10-19', 987654, 'confirmada', null, null),
  ('50000000-0000-0000-0000-000000002114', '30000000-0000-0000-0000-0000000021d1', '10000000-0000-0000-0000-0000000021a1',
   '40000000-0000-0000-0000-000000002101', '2026-10-26', 987654, 'cancelada', 'pago_rechazado', null),
  ('50000000-0000-0000-0000-000000002115', '30000000-0000-0000-0000-0000000021d1', '10000000-0000-0000-0000-0000000021a1',
   '40000000-0000-0000-0000-000000002101', '2026-11-02', 987654, 'confirmada', null, null),
  ('50000000-0000-0000-0000-000000002116', '30000000-0000-0000-0000-0000000021d1', '10000000-0000-0000-0000-0000000021a1',
   '40000000-0000-0000-0000-000000002101', '2026-11-09', 987654, 'cancelada', 'pago_rechazado', null),
  ('50000000-0000-0000-0000-000000002117', '30000000-0000-0000-0000-0000000021d1', '10000000-0000-0000-0000-0000000021a1',
   '40000000-0000-0000-0000-000000002101', '2026-11-16', 987654, 'cancelada', 'pago_rechazado', null),
  ('50000000-0000-0000-0000-000000002118', '30000000-0000-0000-0000-0000000021d1', '10000000-0000-0000-0000-0000000021a1',
   '40000000-0000-0000-0000-000000002101', '2026-11-23', 987654, 'cancelada', 'pago_rechazado', null),
  ('50000000-0000-0000-0000-000000002119', '30000000-0000-0000-0000-0000000021d1', '10000000-0000-0000-0000-0000000021a1',
   '40000000-0000-0000-0000-000000002101', '2026-11-30', 987654, 'confirmada', null, null);

-- D-12: las monitorías de E, todas de Mateo en lunes. La fecha de creación se fija respecto al `ahora` de la
-- prueba (lunes 5 de octubre de 2026, 12:00 en Bogotá), salvo 28 y 29, que se fijan respecto a now().
--   21 por pagar, creada hace 10 min exactos   22 por pagar, hace 10 min y un microsegundo
--   23 por pagar, hace 1 min                   24 por pagar, hace 3 días
--   25 confirmada, 26 cancelada (reserva expirada) y 27 realizada, las tres de hace 3 días
--   28 y 29: como 21 y 22, pero respecto a now() (para la puerta pública)
insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado, motivo_cancelacion, fecha_finalizacion, fecha_creacion) values
  ('50000000-0000-0000-0000-000000002121', '30000000-0000-0000-0000-0000000021e1', '10000000-0000-0000-0000-0000000021a1',
   '40000000-0000-0000-0000-000000002102', '2026-10-05', 987654, 'pendiente_pago', null, null,
   timestamptz '2026-10-05 12:00-05' - interval '10 minutes'),
  ('50000000-0000-0000-0000-000000002122', '30000000-0000-0000-0000-0000000021e1', '10000000-0000-0000-0000-0000000021a1',
   '40000000-0000-0000-0000-000000002102', '2026-10-12', 987654, 'pendiente_pago', null, null,
   timestamptz '2026-10-05 12:00-05' - interval '10 minutes' - interval '1 microsecond'),
  ('50000000-0000-0000-0000-000000002123', '30000000-0000-0000-0000-0000000021e1', '10000000-0000-0000-0000-0000000021a1',
   '40000000-0000-0000-0000-000000002102', '2026-10-19', 987654, 'pendiente_pago', null, null,
   timestamptz '2026-10-05 12:00-05' - interval '1 minute'),
  ('50000000-0000-0000-0000-000000002124', '30000000-0000-0000-0000-0000000021e1', '10000000-0000-0000-0000-0000000021a1',
   '40000000-0000-0000-0000-000000002102', '2026-10-26', 987654, 'pendiente_pago', null, null,
   timestamptz '2026-10-05 12:00-05' - interval '3 days'),
  ('50000000-0000-0000-0000-000000002125', '30000000-0000-0000-0000-0000000021e1', '10000000-0000-0000-0000-0000000021a1',
   '40000000-0000-0000-0000-000000002102', '2026-11-02', 987654, 'confirmada', null, null,
   timestamptz '2026-10-05 12:00-05' - interval '3 days'),
  ('50000000-0000-0000-0000-000000002126', '30000000-0000-0000-0000-0000000021e1', '10000000-0000-0000-0000-0000000021a1',
   '40000000-0000-0000-0000-000000002102', '2026-11-09', 987654, 'cancelada', 'reserva_expirada', null,
   timestamptz '2026-10-05 12:00-05' - interval '3 days'),
  ('50000000-0000-0000-0000-000000002127', '30000000-0000-0000-0000-0000000021e1', '10000000-0000-0000-0000-0000000021a1',
   '40000000-0000-0000-0000-000000002102', '2026-11-16', 987654, 'realizada', null, '2026-10-02 10:00-05',
   timestamptz '2026-10-05 12:00-05' - interval '3 days'),
  ('50000000-0000-0000-0000-000000002128', '30000000-0000-0000-0000-0000000021e1', '10000000-0000-0000-0000-0000000021a1',
   '40000000-0000-0000-0000-000000002102', '2026-11-23', 987654, 'pendiente_pago', null, null,
   now() - interval '10 minutes'),
  ('50000000-0000-0000-0000-000000002129', '30000000-0000-0000-0000-0000000021e1', '10000000-0000-0000-0000-0000000021a1',
   '40000000-0000-0000-0000-000000002102', '2026-11-30', 987654, 'pendiente_pago', null, null,
   now() - interval '10 minutes' - interval '1 microsecond');

-- Los pagos. Un pago solo apunta a un comprobante que el servidor revisó (HU-059): uno por pago, con su ruta
-- <uuid>/<uuid>.pdf. Monto, pagador y contacto llevan datos que la agenda no debe mostrar.
--   A: 01, 02, 03, 07 y 08 aprobado; 05 rechazado; 10 en revisión; sin pagos: 04, 06 y 09.   B: 31 aprobado, 32 rechazado.
create temporary table pagos_21 (id uuid, id_monitoria uuid, estado public.estado_pago);
insert into pagos_21 values
  ('60000000-0000-0000-0000-000000002101', '50000000-0000-0000-0000-000000002101', 'aprobado'),
  ('60000000-0000-0000-0000-000000002102', '50000000-0000-0000-0000-000000002102', 'aprobado'),
  ('60000000-0000-0000-0000-000000002103', '50000000-0000-0000-0000-000000002103', 'aprobado'),
  ('60000000-0000-0000-0000-000000002105', '50000000-0000-0000-0000-000000002105', 'rechazado'),
  ('60000000-0000-0000-0000-000000002107', '50000000-0000-0000-0000-000000002107', 'aprobado'),
  ('60000000-0000-0000-0000-000000002108', '50000000-0000-0000-0000-000000002108', 'aprobado'),
  ('60000000-0000-0000-0000-000000002110', '50000000-0000-0000-0000-000000002110', 'en_revision'),
  ('60000000-0000-0000-0000-000000002131', '50000000-0000-0000-0000-000000002131', 'aprobado'),
  ('60000000-0000-0000-0000-000000002132', '50000000-0000-0000-0000-000000002132', 'rechazado'),
  ('60000000-0000-0000-0000-000000002112', '50000000-0000-0000-0000-000000002112', 'en_revision'),
  ('60000000-0000-0000-0000-000000002113', '50000000-0000-0000-0000-000000002113', 'aprobado'),
  ('60000000-0000-0000-0000-000000002114', '50000000-0000-0000-0000-000000002114', 'rechazado'),
  ('60000000-0000-0000-0000-000000002151', '50000000-0000-0000-0000-000000002115', 'aprobado'),
  ('60000000-0000-0000-0000-000000002152', '50000000-0000-0000-0000-000000002115', 'en_revision'),
  ('60000000-0000-0000-0000-000000002161', '50000000-0000-0000-0000-000000002116', 'aprobado'),
  ('60000000-0000-0000-0000-000000002162', '50000000-0000-0000-0000-000000002116', 'rechazado'),
  ('60000000-0000-0000-0000-000000002171', '50000000-0000-0000-0000-000000002117', 'en_revision'),
  ('60000000-0000-0000-0000-000000002172', '50000000-0000-0000-0000-000000002117', 'rechazado'),
  ('60000000-0000-0000-0000-000000002181', '50000000-0000-0000-0000-000000002118', 'aprobado'),
  ('60000000-0000-0000-0000-000000002182', '50000000-0000-0000-0000-000000002118', 'en_revision'),
  ('60000000-0000-0000-0000-000000002183', '50000000-0000-0000-0000-000000002118', 'rechazado'),
  ('60000000-0000-0000-0000-000000002191', '50000000-0000-0000-0000-000000002119', 'aprobado'),
  ('60000000-0000-0000-0000-000000002192', '50000000-0000-0000-0000-000000002119', 'aprobado');
insert into public.comprobante_revisado (ruta, tipo)
select 'c0000000-0000-0000-0000-000000002101/' || id || '.pdf', 'application/pdf' from pagos_21;
insert into public.pago (id, id_monitoria, monto, nombre_pagador, contacto, estado, id_admin, fecha_revision, comprobante)
select id, id_monitoria, 876543, 'Pagador Secreto 21', 'pagador.secreto21@example.com', estado,
       'a0000000-0000-0000-0000-000000002101', case when estado = 'en_revision' then null else now() end,
       'c0000000-0000-0000-0000-000000002101/' || id || '.pdf'
from pagos_21;

-- Lo que la agenda nunca debe mostrar, como patrones de texto: correos, teléfonos, llave, lugar, enlace, precio de
-- la franja, valor de la monitoría y monto, nombre y contacto de quien pagó.
create temporary table sensibles_21 (patron text, dato text);
insert into sensibles_21 values
  ('%@%', 'cualquier correo'),
  ('%lucia.secreta21%', 'correo del Lead 01'),
  ('%mateo.secreto21%', 'correo del Lead 02'),
  ('%3002101111%', 'teléfono del Lead 01'),
  ('%3002102222%', 'teléfono del Lead 02'),
  ('%3002101000%', 'teléfono del monitor'),
  ('%llave-secreta-21%', 'llave del monitor'),
  ('%Salón secreto%', 'lugar de la franja'),
  ('%https://%', 'enlace de la franja'),
  ('%sala-secreta%', 'enlace de la franja'),
  ('%135790%', 'precio de la franja'),
  ('%987654%', 'valor de la monitoría'),
  ('%876543%', 'monto del pago'),
  ('%Pagador Secreto%', 'nombre de quien pagó'),
  ('%pagador.secreto21%', 'contacto de quien pagó');

-- Lo que la agenda de A debe mostrar, en el orden en que debe mostrarlo. `inicio` está escrito a mano, en hora
-- de Bogotá (UTC-5), sin pasar por la función de la base.
create temporary table esperado_a (
  orden integer, nn text, fecha date, hora time, duracion_min integer, presencial boolean,
  nombre_materia text, codigo_materia text, nombre_estudiante text, estado text, motivo text,
  estado_pago text, inicio timestamptz
);
insert into esperado_a values
  (1,  '03', '2026-09-25', '07:30', 45, false, 'Materia 21 A', 'PGTAP-21-A', 'Lucía Prueba 21', 'realizada',      null,               'aprobado',    '2026-09-25 07:30-05'),
  (2,  '04', '2026-09-28', '10:00', 60, true,  'Materia 21 A', 'PGTAP-21-A', 'Mateo Prueba 21', 'cancelada',      'estudiante',       'sin_pagar',   '2026-09-28 10:00-05'),
  (3,  '06', '2026-10-02', '07:30', 45, false, 'Materia 21 A', 'PGTAP-21-A', 'Lucía Prueba 21', 'cancelada',      'estudiante',       'sin_pagar',   '2026-10-02 07:30-05'),
  (4,  '07', '2026-10-02', '07:30', 45, false, 'Materia 21 A', 'PGTAP-21-A', 'Mateo Prueba 21', 'confirmada',     null,               'aprobado',    '2026-10-02 07:30-05'),
  (5,  '10', '2026-10-05', '10:00', 60, true,  'Materia 21 A', 'PGTAP-21-A', 'Lucía Prueba 21', 'pendiente_pago', null,               'en_revision', '2026-10-05 10:00-05'),
  (6,  '02', '2026-10-05', '15:00', 60, false, 'Materia 21 A', 'PGTAP-21-A', 'Mateo Prueba 21', 'confirmada',     null,               'aprobado',    '2026-10-05 15:00-05'),
  (7,  '05', '2026-10-07', '18:00', 90, false, 'Materia 21 B', 'PGTAP-21-B', 'Mateo Prueba 21', 'cancelada',      'pago_rechazado',   'rechazado',   '2026-10-07 18:00-05'),
  (8,  '01', '2026-10-14', '18:00', 90, false, 'Materia 21 B', 'PGTAP-21-B', 'Lucía Prueba 21', 'confirmada',     null,               'aprobado',    '2026-10-14 18:00-05'),
  (9,  '08', '2026-10-16', '07:30', 45, false, 'Materia 21 A', 'PGTAP-21-A', 'Lucía Prueba 21', 'confirmada',     null,               'aprobado',    '2026-10-16 07:30-05'),
  (10, '09', '2026-10-16', '07:30', 45, false, 'Materia 21 A', 'PGTAP-21-A', 'Mateo Prueba 21', 'cancelada',      'reserva_expirada', 'sin_pagar',   '2026-10-16 07:30-05');
grant select on esperado_a, sensibles_21 to authenticated;

-- Control: cada dato sensible de la prueba existe de verdad en las tablas. Si la agenda no lo trae, es porque la
-- función no lo devuelve y no porque el dato no estuviera.
select ok(
  (select bool_and(exists (
     select 1 from (
       select to_jsonb(l)::text as t from public.lead l
       union all select to_jsonb(p)::text from public.pago p
       union all select to_jsonb(f)::text from public.franja f
       union all select to_jsonb(m)::text from public.monitoria m
       union all select to_jsonb(mp)::text from public.monitor_privado mp) s
     where s.t ilike sens.patron))
   from sensibles_21 sens),
  'Control: cada dato sensible de la prueba (correos, teléfonos, llave, lugar, enlace, precio, valor, monto, pagador) está en alguna tabla');

-- ---------------------------------------------------------------------------
-- P-37, RN-17 y RN-36: el monitor A ve sus monitorías (de cuatro franjas), con su fecha, hora, duración, modalidad
-- y materia, ordenadas por inicio y, a igual inicio, por id
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000021a0","role":"authenticated"}';

select set_eq(
  $$select right(id_monitoria::text, 2) from public.mi_agenda()$$,
  $$select nn from esperado_a$$,
  'El monitor A ve sus diez monitorías, de cuatro franjas y de las dos materias que dicta: pendiente de pago, confirmadas, realizada y canceladas');
select is(
  (select count(*)::int from public.mi_agenda()
   where id_monitoria in ('50000000-0000-0000-0000-000000002131', '50000000-0000-0000-0000-000000002132')),
  0, 'HU-021: y ninguna del monitor B');
select results_eq(
  $$select right(id_monitoria::text, 2) from public.mi_agenda()$$,
  $$select nn from esperado_a order by orden$$,
  'Van ordenadas por inicio (la de las 10:00 antes que la de las 15:00 del mismo día, aunque tenga mayor id) y, a igual inicio, por id: la cancelada o la vigente según el id');
select results_eq(
  $$select right(id_monitoria::text, 2), fecha, hora, duracion_min, presencial, nombre_materia, codigo_materia,
           nombre_estudiante, estado::text, motivo_cancelacion::text, reserva_vencida, estado_pago, inicio
    from public.mi_agenda()$$,
  $$select nn, fecha, hora, duracion_min, presencial, nombre_materia, codigo_materia,
           nombre_estudiante, estado, motivo, false, estado_pago, inicio
    from esperado_a order by orden$$,
  'Cada fila trae fecha, hora, duración, modalidad, materia (nombre y código), nombre de quien agendó, estado, motivo, reserva vencida, estado del pago e inicio');
select set_eq(
  $$select right(id_monitoria::text, 2), fecha, hora, duracion_min, presencial from public.mi_agenda()$$,
  $$select nn, fecha, hora, duracion_min, presencial from esperado_a$$,
  'La fecha es la de la monitoría; la hora, la duración y la modalidad (presencial o virtual) son las de su franja');
select set_eq(
  $$select right(id_monitoria::text, 2), nombre_materia, codigo_materia from public.mi_agenda()$$,
  $$select nn, nombre_materia, codigo_materia from esperado_a$$,
  'La materia es la de la monitoría (A dicta dos), con su nombre y su código');
select set_eq(
  $$select right(id_monitoria::text, 2), nombre_estudiante from public.mi_agenda()$$,
  $$select nn, nombre_estudiante from esperado_a$$,
  'P-37: el nombre del estudiante es el del Lead que agendó esa monitoría (Lucía en unas, Mateo en otras)');
select set_eq(
  $$select right(id_monitoria::text, 2), estado::text, motivo_cancelacion::text from public.mi_agenda()$$,
  $$select nn, estado, motivo from esperado_a$$,
  'Cada una con su estado, y las canceladas con su motivo (estudiante, pago rechazado, reserva expirada); las demás, sin motivo');
select set_eq(
  $$select right(id_monitoria::text, 2), estado_pago from public.mi_agenda()$$,
  $$select nn, estado_pago from esperado_a$$,
  'P-24: el estado del pago de cada monitoría (sin pagar, en revisión, aprobado o rechazado); el pago de una no se mezcla con el de otra');
select set_eq(
  $$select right(id_monitoria::text, 2), inicio from public.mi_agenda()$$,
  $$select nn, inicio from esperado_a$$,
  'RN-36: el inicio es la fecha más la hora de la franja en hora de Bogotá (la de las 18:00 es a las 23:00 UTC)');
select ok(
  (select bool_and(inicio = public.inicio_sesion(fecha, hora)) from public.mi_agenda()),
  'Y es el mismo que calcula public.inicio_sesion(fecha, hora)');
select ok(
  not exists (select 1 from public.mi_agenda() a, sensibles_21 s where a::text ilike s.patron),
  'P-37 y P-24: ningún valor de la fila trae correo, teléfono, llave, lugar, enlace, precio, valor, monto ni datos de quien pagó');
select is(
  (select count(*)::int from public.lead) + (select count(*)::int from public.pago),
  0, 'El monitor no lee lead (contacto del estudiante) ni pago (contacto del pagador) directamente: por eso existe la función');

-- ---------------------------------------------------------------------------
-- HU-021: el monitor B ve solo las suyas
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000021b0","role":"authenticated"}';
select set_eq(
  $$select right(id_monitoria::text, 2), nombre_estudiante, estado::text, motivo_cancelacion::text, estado_pago, presencial
    from public.mi_agenda()$$,
  $$values ('31'::text, 'Mateo Prueba 21'::text, 'confirmada'::text, null::text, 'aprobado'::text, true),
           ('32', 'Lucía Prueba 21', 'cancelada', 'pago_rechazado', 'rechazado', true)$$,
  'El monitor B ve sus dos monitorías (la de Mateo y la de Lucía), con su pago, y ninguna de A, D ni E');
select ok(
  not exists (select 1 from public.mi_agenda() a, sensibles_21 s where a::text ilike s.patron),
  'Tampoco en su agenda hay datos de contacto ni cifras');

-- ---------------------------------------------------------------------------
-- Quien no es monitor de esas citas no recibe nada
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000021c0","role":"authenticated"}';
select is((select count(*)::int from public.mi_agenda()), 0,
  'Un monitor sin monitorías recibe cero filas');
-- Lucía agendó siete de las monitorías de A, pero agendar no es dictar: ella no es el monitor de ninguna.
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000002101","role":"authenticated","is_anonymous":true}';
select is((select count(*)::int from public.mi_agenda()), 0,
  'Una sesión anónima con Lead (la de quien agendó) recibe cero filas: no es el monitor de esas citas');
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-000000002101","role":"authenticated"}';
select is((select count(*)::int from public.mi_agenda()), 0,
  'Un admin recibe cero filas: la agenda es del monitor de cada cita, no de quien administra');
set local request.jwt.claims to '{"role":"authenticated"}';
select is((select count(*)::int from public.mi_agenda()), 0,
  'Una sesión sin sub (el token no trae usuario) recibe cero filas');
set local request.jwt.claims to '';
select is((select count(*)::int from public.mi_agenda()), 0,
  'Y sin claims, también cero');
reset role;

-- ---------------------------------------------------------------------------
-- D-11: el estado del pago de la monitoría, con varios comprobantes
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000021d0","role":"authenticated"}';
select is(
  (select estado_pago from privado.agenda_del_monitor('2026-10-05 12:00-05') where id_monitoria = '50000000-0000-0000-0000-000000002111'),
  'sin_pagar', 'D-11: sin comprobantes, sin pagar');
select is(
  (select estado_pago from privado.agenda_del_monitor('2026-10-05 12:00-05') where id_monitoria = '50000000-0000-0000-0000-000000002112'),
  'en_revision', 'D-11: un comprobante en revisión, en revisión');
select is(
  (select estado_pago from privado.agenda_del_monitor('2026-10-05 12:00-05') where id_monitoria = '50000000-0000-0000-0000-000000002113'),
  'aprobado', 'D-11: un comprobante aprobado, aprobado');
select is(
  (select estado_pago from privado.agenda_del_monitor('2026-10-05 12:00-05') where id_monitoria = '50000000-0000-0000-0000-000000002114'),
  'rechazado', 'D-11: un comprobante rechazado, rechazado');
select is(
  (select estado_pago from privado.agenda_del_monitor('2026-10-05 12:00-05') where id_monitoria = '50000000-0000-0000-0000-000000002115'),
  'en_revision', 'D-11: aprobado y en revisión, en revisión (todavía no está todo aprobado)');
select is(
  (select estado_pago from privado.agenda_del_monitor('2026-10-05 12:00-05') where id_monitoria = '50000000-0000-0000-0000-000000002116'),
  'rechazado', 'D-11: aprobado y rechazado, rechazado (RN-43 cancela la cita)');
select is(
  (select estado_pago from privado.agenda_del_monitor('2026-10-05 12:00-05') where id_monitoria = '50000000-0000-0000-0000-000000002117'),
  'rechazado', 'D-11: en revisión y rechazado, rechazado');
select is(
  (select estado_pago from privado.agenda_del_monitor('2026-10-05 12:00-05') where id_monitoria = '50000000-0000-0000-0000-000000002118'),
  'rechazado', 'D-11: aprobado, en revisión y rechazado a la vez, rechazado: manda el rechazo');
select is(
  (select estado_pago from privado.agenda_del_monitor('2026-10-05 12:00-05') where id_monitoria = '50000000-0000-0000-0000-000000002119'),
  'aprobado', 'D-11: dos comprobantes aprobados, aprobado');
select is(
  (select count(*)::int from privado.agenda_del_monitor('2026-10-05 12:00-05')),
  9, 'Con varios pagos (hasta tres) o ninguno, cada monitoría sale una sola vez: nueve monitorías, nueve filas');
reset role;

-- ---------------------------------------------------------------------------
-- D-12 y P-40: una reserva por pagar que ya venció se marca como reserva vencida, aunque HU-027 todavía no la
-- haya cancelado. La reserva dura 10 minutos desde su creación (RN-34) y el borde es inclusivo.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000021e0","role":"authenticated"}';
select is(
  (select reserva_vencida from privado.agenda_del_monitor('2026-10-05 12:00-05') where id_monitoria = '50000000-0000-0000-0000-000000002121'),
  false, 'P-40: una reserva por pagar creada hace justo 10 minutos todavía no está vencida (el borde es inclusivo)');
select results_eq(
  $$select reserva_vencida, estado::text from privado.agenda_del_monitor('2026-10-05 12:00-05')
    where id_monitoria = '50000000-0000-0000-0000-000000002122'$$,
  $$values (true, 'pendiente_pago'::text)$$,
  'D-12: con 10 minutos y un microsegundo ya está vencida, y sigue pendiente_pago (la cancela HU-027): se marca, no se cambia el estado');
select is(
  (select reserva_vencida from privado.agenda_del_monitor('2026-10-05 12:00-05') where id_monitoria = '50000000-0000-0000-0000-000000002123'),
  false, 'Una reserva por pagar de hace 1 minuto está vigente');
select is(
  (select reserva_vencida from privado.agenda_del_monitor('2026-10-05 12:00-05') where id_monitoria = '50000000-0000-0000-0000-000000002124'),
  true, 'Una reserva por pagar de hace 3 días está vencida');
select is(
  (select reserva_vencida from privado.agenda_del_monitor('2026-10-05 12:00-05') where id_monitoria = '50000000-0000-0000-0000-000000002125'),
  false, 'Una confirmada nunca es reserva vencida, por vieja que sea su creación');
select is(
  (select reserva_vencida from privado.agenda_del_monitor('2026-10-05 12:00-05') where id_monitoria = '50000000-0000-0000-0000-000000002126'),
  false, 'Una cancelada (la reserva expirada que HU-027 ya canceló) tampoco: se muestra con su motivo');
select is(
  (select reserva_vencida from privado.agenda_del_monitor('2026-10-05 12:00-05') where id_monitoria = '50000000-0000-0000-0000-000000002127'),
  false, 'Una realizada tampoco');
select is(
  (select count(*)::int from privado.agenda_del_monitor('2026-10-05 12:00-05')
   where reserva_vencida and right(id_monitoria::text, 2) between '21' and '27'),
  2, 'De las siete monitorías de E fijadas a ese `ahora` (21 a 27), solo dos están vencidas: la de 10 minutos y un microsegundo y la de 3 días');

-- La puerta pública usa la hora real (now() es el mismo durante toda la transacción).
select is(
  (select reserva_vencida from public.mi_agenda() where id_monitoria = '50000000-0000-0000-0000-000000002128'),
  false, 'Con la hora real: creada hace justo 10 minutos, no vencida');
select is(
  (select reserva_vencida from public.mi_agenda() where id_monitoria = '50000000-0000-0000-0000-000000002129'),
  true, 'Con la hora real: creada hace 10 minutos y un microsegundo, vencida');
select set_eq(
  $$select * from public.mi_agenda()$$,
  $$select * from privado.agenda_del_monitor(now())$$,
  'La puerta pública es la función de privado con now(): las mismas filas y columnas');
reset role;

select * from finish();
rollback;
