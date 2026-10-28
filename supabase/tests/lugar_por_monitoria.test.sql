-- Pruebas pgTAP del enlace o el lugar de cada monitoría (HU-107, D-76).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.
--
-- Las reglas que dependen de la hora se prueban con privado.poner_lugar_de_monitoria y un `ahora` fijo, el lunes 5 de
-- octubre de 2026 a las 12:00 en Bogotá. Al final se comprueba que la puerta pública pasa la hora real.
--
-- Elenco (los ids terminan en 107N):
--   Monitores: A (dicta todo) y B (otro monitor). Lead: Lucía, con su sesión anónima. Admin: uno.
--   Franjas de A: p (lunes 10:00, presencial, con el lugar viejo «Salón viejo 107»), v (miércoles 18:00, virtual, sin enlace).
--   Monitorías de A: 1 presencial confirmada lun 12-oct, 2 virtual confirmada mié 7-oct, 3 virtual cancelada mié 14-oct,
--   4 virtual confirmada que ya pasó (mié 30-sep), 5 virtual pendiente de pago mié 21-oct.

begin;
create extension if not exists pgtap with schema extensions;

select plan(38);

-- ---------------------------------------------------------------------------
-- Estructura y permisos
-- ---------------------------------------------------------------------------
select has_table('public', 'lugar_de_monitoria', 'Existe public.lugar_de_monitoria');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.lugar_de_monitoria'::regclass),
  'Tiene RLS');
select ok(
  not has_table_privilege('anon', 'public.lugar_de_monitoria', 'select')
  and not has_table_privilege('authenticated', 'public.lugar_de_monitoria', 'select')
  and not has_table_privilege('authenticated', 'public.lugar_de_monitoria', 'insert')
  and not has_table_privilege('authenticated', 'public.lugar_de_monitoria', 'update'),
  'Ni anon ni authenticated la leen ni la escriben directo: el Lead no ve el dato antes de la cita confirmada (D-5)');
select ok(
  has_table_privilege('service_role', 'public.lugar_de_monitoria', 'select'),
  'service_role la lee (el correo de confirmación corre con él)');

select has_function('public', 'poner_lugar_de_mi_monitoria', array['uuid', 'text'], 'Existe la puerta para poner el dato');
select has_function('public', 'lugares_de_mi_agenda', '{}'::name[], 'Existe la puerta para leer los datos de la agenda');
select ok(
  (select prosecdef from pg_proc where oid = 'privado.poner_lugar_de_monitoria(uuid, text, timestamptz)'::regprocedure)
  and (select prosecdef from pg_proc where oid = 'privado.lugares_de_mi_agenda()'::regprocedure)
  and not (select prosecdef from pg_proc where oid = 'public.poner_lugar_de_mi_monitoria(uuid, text)'::regprocedure)
  and not (select prosecdef from pg_proc where oid = 'public.lugares_de_mi_agenda()'::regprocedure),
  'Las de privado son security definer y las puertas corren con los permisos de quien llama');
select ok(
  (select bool_and('search_path=""' = any(proconfig)) from pg_proc
   where oid in ('privado.poner_lugar_de_monitoria(uuid, text, timestamptz)'::regprocedure,
                 'privado.lugares_de_mi_agenda()'::regprocedure,
                 'privado.lugar_inicial_de_monitoria()'::regprocedure,
                 'public.poner_lugar_de_mi_monitoria(uuid, text)'::regprocedure,
                 'public.lugares_de_mi_agenda()'::regprocedure)),
  'Todas fijan un search_path vacío');
select ok(
  not has_function_privilege('anon', 'public.poner_lugar_de_mi_monitoria(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.lugares_de_mi_agenda()', 'execute')
  and not has_function_privilege('anon', 'privado.poner_lugar_de_monitoria(uuid, text, timestamptz)', 'execute'),
  'Sin sesión (anon) no se ejecutan');
select ok(
  not exists (
    select 1
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid in ('privado.poner_lugar_de_monitoria(uuid, text, timestamptz)'::regprocedure,
                    'privado.lugares_de_mi_agenda()'::regprocedure,
                    'privado.lugar_inicial_de_monitoria()'::regprocedure,
                    'public.poner_lugar_de_mi_monitoria(uuid, text)'::regprocedure,
                    'public.lugares_de_mi_agenda()'::regprocedure)
      and a.grantee = 0),
  'Nadie las hereda de PUBLIC');

-- ---------------------------------------------------------------------------
-- Fixtures (como postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, is_anonymous) values
  ('a0000000-0000-0000-0000-000000001071', false),
  ('b0000000-0000-0000-0000-0000000010a7', false),
  ('b0000000-0000-0000-0000-0000000010b7', false),
  ('c0000000-0000-0000-0000-000000001071', true);

insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-000000001071', 'Admin 107', 'admin107@calibra.test', 9001071);
insert into public.monitor (id, nombre) values
  ('b0000000-0000-0000-0000-0000000010a7', 'Ana 107'),
  ('b0000000-0000-0000-0000-0000000010b7', 'Beto 107');
insert into public.materia (id, nombre, codigo) values
  ('10000000-0000-0000-0000-000000001071', 'Materia 107', 'PGTAP-107');
insert into public.certificado (id_monitor, id_materia, id_admin) values
  ('b0000000-0000-0000-0000-0000000010a7', '10000000-0000-0000-0000-000000001071', 'a0000000-0000-0000-0000-000000001071'),
  ('b0000000-0000-0000-0000-0000000010b7', '10000000-0000-0000-0000-000000001071', 'a0000000-0000-0000-0000-000000001071');

-- Una franja vieja con el lugar puesto (como las de antes de D-76) y una virtual sin enlace (como las de ahora).
insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min, lugar, enlace, abierta_desde) values
  ('30000000-0000-0000-0000-0000000010a1', 'b0000000-0000-0000-0000-0000000010a7', 1, '10:00', true, 30000, 60,
   'Salón viejo 107', null, '2026-01-01'),
  ('30000000-0000-0000-0000-0000000010a2', 'b0000000-0000-0000-0000-0000000010a7', 3, '18:00', false, 30000, 60,
   null, null, '2026-01-01');

insert into public.lead (id, id_sesion_anonima, nombre, numero_telefono, correo, acepta_tratamiento_datos, fecha_consentimiento) values
  ('40000000-0000-0000-0000-000000001071', 'c0000000-0000-0000-0000-000000001071', 'Lucía 107', '3001071111',
   'lucia107@calibra.test', true, now());

insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado, motivo_cancelacion) values
  ('50000000-0000-0000-0000-000000001071', '30000000-0000-0000-0000-0000000010a1', '10000000-0000-0000-0000-000000001071',
   '40000000-0000-0000-0000-000000001071', '2026-10-12', 30000, 'confirmada', null),
  ('50000000-0000-0000-0000-000000001072', '30000000-0000-0000-0000-0000000010a2', '10000000-0000-0000-0000-000000001071',
   '40000000-0000-0000-0000-000000001071', '2026-10-07', 30000, 'confirmada', null),
  ('50000000-0000-0000-0000-000000001073', '30000000-0000-0000-0000-0000000010a2', '10000000-0000-0000-0000-000000001071',
   '40000000-0000-0000-0000-000000001071', '2026-10-14', 30000, 'cancelada', 'estudiante'),
  ('50000000-0000-0000-0000-000000001074', '30000000-0000-0000-0000-0000000010a2', '10000000-0000-0000-0000-000000001071',
   '40000000-0000-0000-0000-000000001071', '2026-09-30', 30000, 'confirmada', null),
  ('50000000-0000-0000-0000-000000001075', '30000000-0000-0000-0000-0000000010a2', '10000000-0000-0000-0000-000000001071',
   '40000000-0000-0000-0000-000000001071', '2026-10-21', 30000, 'pendiente_pago', null);

-- ---------------------------------------------------------------------------
-- El dato inicial sale de la franja, si la franja lo tiene (criterio 8)
-- ---------------------------------------------------------------------------
select is(
  (select lugar from public.lugar_de_monitoria where id_monitoria = '50000000-0000-0000-0000-000000001071'),
  'Salón viejo 107',
  'Una monitoría nueva en una franja vieja con lugar empieza con ese lugar');
select is(
  (select count(*)::int from public.lugar_de_monitoria where id_monitoria = '50000000-0000-0000-0000-000000001072'),
  0,
  'Una monitoría en una franja sin enlace empieza sin dato');

-- ---------------------------------------------------------------------------
-- El monitor pone y cambia el dato (criterios 2 y 3)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000010a7","role":"authenticated"}';

select lives_ok(
  $$select privado.poner_lugar_de_monitoria('50000000-0000-0000-0000-000000001072', '  https://meet.google.com/abc-defg-hij  ', '2026-10-05 12:00-05')$$,
  'El monitor pone el enlace de su monitoría virtual (con espacios de los lados)');
select lives_ok(
  $$select privado.poner_lugar_de_monitoria('50000000-0000-0000-0000-000000001072', 'https://meet.google.com/xyz-otra-sala', '2026-10-05 12:30-05')$$,
  'Y lo cambia');
select lives_ok(
  $$select privado.poner_lugar_de_monitoria('50000000-0000-0000-0000-000000001071', 'ML-301', '2026-10-05 12:00-05')$$,
  'Cambia el lugar de su monitoría presencial');
select lives_ok(
  $$select privado.poner_lugar_de_monitoria('50000000-0000-0000-0000-000000001075', 'https://meet.google.com/pendiente', '2026-10-05 12:00-05')$$,
  'También en una pendiente de pago');

select results_eq(
  $$select id_monitoria, lugar, enlace from public.lugares_de_mi_agenda() order by id_monitoria$$,
  $$values ('50000000-0000-0000-0000-000000001071'::uuid, 'ML-301'::text, null::text),
           ('50000000-0000-0000-0000-000000001072'::uuid, null::text, 'https://meet.google.com/xyz-otra-sala'::text),
           ('50000000-0000-0000-0000-000000001075'::uuid, null::text, 'https://meet.google.com/pendiente'::text)$$,
  'La agenda lee el dato actual de sus monitorías, sin espacios de los lados');

select throws_ok(
  $$select privado.poner_lugar_de_monitoria('50000000-0000-0000-0000-000000001072', 'http://meet.google.com/abc', '2026-10-05 12:00-05')$$,
  'P0001', 'Escribe el enlace de la videollamada completo, que empiece por https://.',
  'Una virtual no acepta un enlace sin https');
select throws_ok(
  $$select privado.poner_lugar_de_monitoria('50000000-0000-0000-0000-000000001072', 'https://meet.google.com/a b', '2026-10-05 12:00-05')$$,
  'P0001', 'Escribe el enlace de la videollamada completo, que empiece por https://.',
  'Ni uno con espacios');
select throws_ok(
  $$select privado.poner_lugar_de_monitoria('50000000-0000-0000-0000-000000001072', 'https://x.co/' || repeat('a', 490), '2026-10-05 12:00-05')$$,
  'P0001', 'Escribe el enlace de la videollamada completo, que empiece por https://.',
  'Ni uno de más de 500 caracteres');
select throws_ok(
  $$select privado.poner_lugar_de_monitoria('50000000-0000-0000-0000-000000001071', '   ', '2026-10-05 12:00-05')$$,
  'P0001', 'Escribe el lugar de la sesión, por ejemplo el salón o el edificio.',
  'Una presencial no acepta un lugar vacío');
select throws_ok(
  $$select privado.poner_lugar_de_monitoria('50000000-0000-0000-0000-000000001071', repeat('a', 201), '2026-10-05 12:00-05')$$,
  'P0001', 'El lugar es demasiado largo: usa hasta 200 caracteres.',
  'Ni uno de más de 200 caracteres');
select is(
  (select l.enlace from public.lugares_de_mi_agenda() l where l.id_monitoria = '50000000-0000-0000-0000-000000001072'),
  'https://meet.google.com/xyz-otra-sala',
  'Un intento que no sirve no cambia nada');

-- Solo vigentes (criterio 4).
select throws_ok(
  $$select privado.poner_lugar_de_monitoria('50000000-0000-0000-0000-000000001073', 'https://meet.google.com/abc', '2026-10-05 12:00-05')$$,
  'P0001', 'Esa monitoría ya no está vigente: no se le puede cambiar el lugar ni el enlace.',
  'No en una cancelada');
select throws_ok(
  $$select privado.poner_lugar_de_monitoria('50000000-0000-0000-0000-000000001074', 'https://meet.google.com/abc', '2026-10-05 12:00-05')$$,
  'P0001', 'Esa monitoría ya no está vigente: no se le puede cambiar el lugar ni el enlace.',
  'No en una que ya terminó');
select throws_ok(
  $$select privado.poner_lugar_de_monitoria('50000000-0000-0000-0000-000000001072', 'https://meet.google.com/abc', '2026-10-07 19:00-05')$$,
  'P0001', 'Esa monitoría ya no está vigente: no se le puede cambiar el lugar ni el enlace.',
  'Ni en la confirmada justo cuando termina (mié 7-oct, 18:00 a 19:00)');

-- La puerta pública usa la hora real: la del 7-oct de 2026 ya pasó cuando corre esta prueba, la del 21-oct depende del día.
select throws_ok(
  $$select public.poner_lugar_de_mi_monitoria('50000000-0000-0000-0000-000000001074', 'https://meet.google.com/abc')$$,
  'P0001', 'Esa monitoría ya no está vigente: no se le puede cambiar el lugar ni el enlace.',
  'La puerta pública pasa la hora real');

-- El monitor no lee la tabla directo.
select throws_ok($$select * from public.lugar_de_monitoria$$, '42501', null,
  'Ni el monitor lee la tabla directo: solo por la función');

-- ---------------------------------------------------------------------------
-- Otro monitor y el estudiante (criterio 4)
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000010b7","role":"authenticated"}';
select throws_ok(
  $$select privado.poner_lugar_de_monitoria('50000000-0000-0000-0000-000000001072', 'https://meet.google.com/robo', '2026-10-05 12:00-05')$$,
  'P0001', 'No encontramos esa monitoría en tu agenda.',
  'Otro monitor no pone el dato de una monitoría que no dicta');
select throws_ok(
  $$select privado.poner_lugar_de_monitoria('50000000-0000-0000-0000-00000000107f', 'https://meet.google.com/robo', '2026-10-05 12:00-05')$$,
  'P0001', 'No encontramos esa monitoría en tu agenda.',
  'Y una que no existe responde lo mismo');
select is(
  (select count(*)::int from public.lugares_de_mi_agenda()),
  0,
  'Ni lee los de otro');

set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001071","role":"authenticated","is_anonymous":true}';
select throws_ok(
  $$select privado.poner_lugar_de_monitoria('50000000-0000-0000-0000-000000001072', 'https://meet.google.com/robo', '2026-10-05 12:00-05')$$,
  'P0001', 'No encontramos esa monitoría en tu agenda.',
  'El estudiante tampoco');
select throws_ok($$select * from public.lugar_de_monitoria$$, '42501', null,
  'Ni lee la tabla directo, aunque la monitoría sea suya');
reset role;

-- ---------------------------------------------------------------------------
-- La cita y el correo leen el dato de la monitoría (criterios 5 y 6)
-- ---------------------------------------------------------------------------
select is(
  (select enlace from privado.datos_de_cita('50000000-0000-0000-0000-000000001072')),
  'https://meet.google.com/xyz-otra-sala',
  'La página de la cita confirmada muestra el enlace actual de la monitoría');
select is(
  (select enlace from privado.datos_de_cita('50000000-0000-0000-0000-000000001075')),
  null,
  'Antes de confirmarse no lo muestra (D-21)');

insert into public.confirmacion_cita (id_monitoria) values ('50000000-0000-0000-0000-000000001071');
select is(
  (select lugar from public.datos_de_confirmacion_cita('50000000-0000-0000-0000-000000001071')),
  'ML-301',
  'El correo de confirmación lleva el lugar que puso el monitor');

-- ---------------------------------------------------------------------------
-- La franja ya no exige lugar ni enlace (criterio 1)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000010b7","role":"authenticated"}';
select lives_ok(
  $$insert into public.franja (id_monitor, dia, hora, presencial, precio, duracion_min)
    values ('b0000000-0000-0000-0000-0000000010b7', 2, '09:00', false, 30000, 60)$$,
  'El monitor abre una franja virtual sin enlace');
select lives_ok(
  $$insert into public.franja (id_monitor, dia, hora, presencial, precio, duracion_min)
    values ('b0000000-0000-0000-0000-0000000010b7', 4, '09:00', true, 30000, 60)$$,
  'Y una presencial sin lugar');
reset role;

select * from finish();
rollback;
