-- Pruebas pgTAP de agendar una monitoría individual (HU-017).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.
--
-- La prueba corre a cualquier hora, así que las fechas salen de "hoy en Bogotá" y las franjas se abren en el
-- día de la semana que toca. Los bordes de 3 h y de 12 h se construyen con now(), que dentro de una
-- transacción no cambia: la franja empieza exactamente a esa distancia de now() (y a un microsegundo menos
-- para el lado de afuera), y la función de la base usa esa misma now().
--
-- Lo que no se prueba aquí es la concurrencia real: dos conexiones a la vez no caben en una transacción. Se
-- cubre el resultado `ocupada` cuando la fecha ya tiene una monitoría activa; el índice único
-- monitoria_franja_fecha_activa_key (RN-33) es el que cierra la carrera.
--
-- Elenco. Cada visitante es una sesión anónima c0000000-...-0000000017NN y su Lead es 40000000-...-0000000017NN
-- (el mismo NN). Monitores: MA (certificado en A y B), MB (solo en B) y MC (en A, con la cuenta suspendida).
-- Materias: A = 'PGTAP-17-A' y B = 'PGTAP-17-B'.
--   01 flujo principal   02 otra persona        03 sesión sin Lead      04 todo lo que no se puede
--   05 reserva vencida   06 reserva de 10 min   07 diagnósticos A y B    08 solo diagnóstico de la otra materia
--   09 diagnóstico de su sesión   10 y 11 el mismo Lead por dos sesiones   12 cuenta de Estudiante
--   13 a 16 bordes de antelación   17 a 20 casos que sí se agendan   21 reserva vencida por un microsegundo
--   22 antelación y casilla (nunca agenda)

begin;
create extension if not exists pgtap with schema extensions;

select plan(90);

-- ---------------------------------------------------------------------------
-- Estructura y permisos
-- ---------------------------------------------------------------------------
select has_function('privado', 'agendar_monitoria', array['uuid', 'date', 'text', 'boolean'],
  'Existe privado.agendar_monitoria, la reserva atómica');
select has_function('public', 'agendar_monitoria', array['uuid', 'date', 'text', 'boolean'],
  'Existe su puerta en la Data API');
select ok(
  (select prosecdef from pg_proc where oid = 'privado.agendar_monitoria(uuid, date, text, boolean)'::regprocedure)
  and not (select prosecdef from pg_proc where oid = 'public.agendar_monitoria(uuid, date, text, boolean)'::regprocedure),
  'La de privado es security definer (es la que escribe en monitoria); la puerta corre con los permisos de quien llama');
select ok(
  (select bool_and('search_path=""' = any(proconfig)) from pg_proc
   where oid in ('privado.agendar_monitoria(uuid, date, text, boolean)'::regprocedure,
                 'public.agendar_monitoria(uuid, date, text, boolean)'::regprocedure)),
  'Las dos fijan un search_path vacío');
select is(
  pg_get_function_identity_arguments('privado.agendar_monitoria(uuid, date, text, boolean)'::regprocedure),
  'p_id_franja uuid, p_fecha date, p_codigo_materia text, p_acepta_sin_cancelacion boolean',
  'No recibe la sesión ni la hora: nadie agenda a nombre de otro Lead ni se salta la antelación (RN-35)');
select matches(
  pg_get_function_arguments('public.agendar_monitoria(uuid, date, text, boolean)'::regprocedure),
  'p_acepta_sin_cancelacion boolean DEFAULT false$',
  'Sin marcar la casilla de "no podré cancelarla" se entiende que no la marcó (D-10)');
select ok(
  not has_function_privilege('anon', 'public.agendar_monitoria(uuid, date, text, boolean)', 'execute')
  and not has_function_privilege('anon', 'privado.agendar_monitoria(uuid, date, text, boolean)', 'execute'),
  'Sin sesión (anon) no se agenda: ni la puerta pública ni la de privado');
select ok(
  has_function_privilege('authenticated', 'public.agendar_monitoria(uuid, date, text, boolean)', 'execute')
  and has_function_privilege('authenticated', 'privado.agendar_monitoria(uuid, date, text, boolean)', 'execute'),
  'Con sesión sí (también la anónima del visitante, que es authenticated): la puerta llega a la de privado');
select ok(
  not has_function_privilege('service_role', 'public.agendar_monitoria(uuid, date, text, boolean)', 'execute')
  and not has_function_privilege('service_role', 'privado.agendar_monitoria(uuid, date, text, boolean)', 'execute'),
  'service_role no la necesita: sin sesión no hay Lead');
select ok(
  not exists (
    select 1
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid in ('privado.agendar_monitoria(uuid, date, text, boolean)'::regprocedure,
                    'public.agendar_monitoria(uuid, date, text, boolean)'::regprocedure,
                    'privado.semanas_para_agendar()'::regprocedure,
                    'privado.dicta_cita_con_diagnostico(uuid)'::regprocedure)
      and a.grantee = 0),
  'Nadie las hereda de PUBLIC');
select is(privado.semanas_para_agendar(), 4,
  'D-4 y D-9: se agenda dentro de las 4 semanas que muestra la lista');
select ok(
  not has_function_privilege('anon', 'privado.semanas_para_agendar()', 'execute')
  and not has_function_privilege('authenticated', 'privado.semanas_para_agendar()', 'execute')
  and not has_function_privilege('service_role', 'privado.semanas_para_agendar()', 'execute'),
  'semanas_para_agendar solo se llama desde otras funciones de la base');
select ok(
  not has_function_privilege('anon', 'privado.dicta_cita_con_diagnostico(uuid)', 'execute')
  and has_function_privilege('authenticated', 'privado.dicta_cita_con_diagnostico(uuid)', 'execute'),
  'dicta_cita_con_diagnostico (la usa la política de diagnostico) la ejecuta quien tiene sesión y no el visitante sin ella');
select ok(
  not has_any_column_privilege('anon', 'public.monitoria', 'insert')
  and not has_any_column_privilege('authenticated', 'public.monitoria', 'insert')
  and not has_any_column_privilege('authenticated', 'public.monitoria', 'update')
  and not has_table_privilege('authenticated', 'public.monitoria', 'delete'),
  'Nadie con sesión escribe en monitoria: solo la función security definer, con la identidad de la sesión');
select has_column('public', 'monitoria', 'id_diagnostico', 'La cita individual apunta a su diagnóstico (D-7)');
select ok(
  exists (
    select 1 from pg_constraint
    where conname = 'monitoria_diagnostico_fk' and conrelid = 'public.monitoria'::regclass
      and confrelid = 'public.diagnostico'::regclass and contype = 'f'
      and confdeltype = 'n' and confdelsetcols is not null),
  'Existe monitoria_diagnostico_fk: si el diagnóstico se borra, la cita sigue sin él (solo se anula id_diagnostico)');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'diagnostico' and cmd = 'SELECT'),
  1, 'diagnostico sigue con una sola política de lectura (una permisiva por tabla y acción)');

select ok(
  not has_column_privilege('authenticated', 'public.diagnostico', 'token_recuperacion', 'select')
  and not has_column_privilege('anon', 'public.diagnostico', 'token_recuperacion', 'select'),
  'Ninguna sesión lee el token de recuperación del diagnóstico (RN-12): ni el Lead ni el monitor de la cita (D-7)');
select ok(
  has_column_privilege('authenticated', 'public.diagnostico', 'resultado_por_habilidad', 'select')
  and has_column_privilege('authenticated', 'public.diagnostico', 'id_lead', 'select')
  and has_column_privilege('service_role', 'public.diagnostico', 'token_recuperacion', 'select'),
  'Las sesiones leen el resto del diagnóstico (según la política) y el servidor también el token');
-- HU-081: las copias de las preguntas traen la correcta y la solución, y la semilla permite calcularlas: ni el dueño ni el monitor
-- de la cita las leen por la Data API.
select ok(
  not has_column_privilege('authenticated', 'public.diagnostico', 'respuestas', 'select')
  and not has_column_privilege('authenticated', 'public.diagnostico', 'semilla', 'select')
  and not has_column_privilege('authenticated', 'public.diagnostico', 'repetido', 'select')
  and not has_column_privilege('authenticated', 'public.diagnostico', 'respondidas', 'select')
  and not has_column_privilege('authenticated', 'public.diagnostico', 'aciertos', 'select')
  and not has_column_privilege('authenticated', 'public.diagnostico', 'falta_material', 'select')
  and not has_any_column_privilege('anon', 'public.diagnostico', 'select'),
  'Ninguna sesión lee las copias, la semilla, el repetido, lo respondido, los aciertos ni la marca de falta de material del diagnóstico');

-- ---------------------------------------------------------------------------
-- Fixtures (como postgres)
-- ---------------------------------------------------------------------------
-- Las fechas y los bordes de tiempo, calculados una sola vez en el día de Bogotá.
create temporary table ref as
select (now() at time zone 'America/Bogota')::date as hoy,
       ((now() + interval '2 hours') at time zone 'America/Bogota')::date as f2h,
       ((now() + interval '3 hours') at time zone 'America/Bogota')::date as f3h,
       ((now() + interval '3 hours' - interval '1 microsecond') at time zone 'America/Bogota')::date as f3hm,
       ((now() + interval '5 hours') at time zone 'America/Bogota')::date as f5h,
       ((now() + interval '12 hours') at time zone 'America/Bogota')::date as f12h,
       ((now() + interval '12 hours' - interval '1 microsecond') at time zone 'America/Bogota')::date as f12hm;
grant select on ref to anon, authenticated;

-- Lo que devuelve cada llamada que importa, para comparar ids después.
create temporary table r (k text primary key, resultado text, id_monitoria uuid);
grant select, insert on r to authenticated;

insert into auth.users (id, is_anonymous) values
  ('a0000000-0000-0000-0000-000000001701', false),
  ('b0000000-0000-0000-0000-0000000017a0', false),
  ('b0000000-0000-0000-0000-0000000017b0', false),
  ('b0000000-0000-0000-0000-0000000017c0', false),
  ('d0000000-0000-0000-0000-000000001712', false);
insert into auth.users (id, is_anonymous)
select ('c0000000-0000-0000-0000-0000000017' || n)::uuid, true
from unnest(array['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11',
                  '13', '14', '15', '16', '17', '18', '19', '20', '21', '22']) n;
-- MC: monitor con la cuenta suspendida.
update auth.users set banned_until = '2099-01-01' where id = 'b0000000-0000-0000-0000-0000000017c0';

insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-000000001701', 'Admin', 'admin17@calibra.test', 9001701);
insert into public.monitor (id, nombre) values
  ('b0000000-0000-0000-0000-0000000017a0', 'MA'),
  ('b0000000-0000-0000-0000-0000000017b0', 'MB'),
  ('b0000000-0000-0000-0000-0000000017c0', 'MC');
insert into public.materia (id, nombre, codigo) values
  ('10000000-0000-0000-0000-0000000017a1', 'Materia A', 'PGTAP-17-A'),
  ('10000000-0000-0000-0000-0000000017b1', 'Materia B', 'PGTAP-17-B');
insert into public.certificado (id_monitor, id_materia, id_admin) values
  ('b0000000-0000-0000-0000-0000000017a0', '10000000-0000-0000-0000-0000000017a1', 'a0000000-0000-0000-0000-000000001701'),
  ('b0000000-0000-0000-0000-0000000017a0', '10000000-0000-0000-0000-0000000017b1', 'a0000000-0000-0000-0000-000000001701'),
  ('b0000000-0000-0000-0000-0000000017b0', '10000000-0000-0000-0000-0000000017b1', 'a0000000-0000-0000-0000-000000001701'),
  ('b0000000-0000-0000-0000-0000000017c0', '10000000-0000-0000-0000-0000000017a1', 'a0000000-0000-0000-0000-000000001701');

-- Franjas "de calendario": cada una abre en el día de la semana de hoy + `desp` días, así que la fecha
-- hoy + desp (y las siguientes semanas) caen en su día. Abiertas desde hace 60 días.
--   01 y 02: el flujo principal.   03: de MB, que solo está certificado en B.   04: se cierra el día hoy + 17.
--   05: de MC, suspendido.   06 y 07: los dos lados del horizonte (hoy + 27 y hoy + 28).   08: reservas vencidas.
--   09 y 10: diagnósticos.   11: las dos sesiones de un Lead y la cuenta de Estudiante.   12: código con espacios.
insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min, lugar, enlace, abierta_desde, cerrada_desde)
select v.id, v.id_monitor, extract(isodow from r.hoy + v.desp)::smallint, v.hora, v.lugar is not null, v.precio, 60,
       v.lugar, v.enlace, r.hoy - 60, r.hoy + v.cierra
from ref r cross join (values
  ('30000000-0000-0000-0000-000000001701'::uuid, 'b0000000-0000-0000-0000-0000000017a0'::uuid, 10, '10:00'::time, 25000, 'Salón 101'::text, null::text, null::int),
  ('30000000-0000-0000-0000-000000001702'::uuid, 'b0000000-0000-0000-0000-0000000017a0'::uuid, 11, '15:00'::time, 20000, null, 'https://meet.example/17-02', null),
  ('30000000-0000-0000-0000-000000001703'::uuid, 'b0000000-0000-0000-0000-0000000017b0'::uuid, 12, '09:00'::time, 18000, 'Salón 202', null, null),
  ('30000000-0000-0000-0000-000000001704'::uuid, 'b0000000-0000-0000-0000-0000000017a0'::uuid, 10, '12:00'::time, 22000, 'Salón 104', null, 17),
  ('30000000-0000-0000-0000-000000001705'::uuid, 'b0000000-0000-0000-0000-0000000017c0'::uuid, 10, '14:00'::time, 21000, 'Salón 305', null, null),
  ('30000000-0000-0000-0000-000000001706'::uuid, 'b0000000-0000-0000-0000-0000000017a0'::uuid, 27, '10:00'::time, 15000, 'Salón 106', null, null),
  ('30000000-0000-0000-0000-000000001707'::uuid, 'b0000000-0000-0000-0000-0000000017a0'::uuid, 28, '10:00'::time, 15000, 'Salón 107', null, null),
  ('30000000-0000-0000-0000-000000001708'::uuid, 'b0000000-0000-0000-0000-0000000017a0'::uuid, 13, '08:00'::time, 20000, null, 'https://meet.example/17-08', null),
  ('30000000-0000-0000-0000-000000001709'::uuid, 'b0000000-0000-0000-0000-0000000017a0'::uuid, 15, '09:00'::time, 24000, 'Salón 109', null, null),
  ('30000000-0000-0000-0000-000000001710'::uuid, 'b0000000-0000-0000-0000-0000000017a0'::uuid, 16, '09:00'::time, 24000, 'Salón 110', null, null),
  ('30000000-0000-0000-0000-000000001711'::uuid, 'b0000000-0000-0000-0000-0000000017a0'::uuid, 19, '16:00'::time, 26000, null, 'https://meet.example/17-11', null),
  ('30000000-0000-0000-0000-000000001712'::uuid, 'b0000000-0000-0000-0000-0000000017a0'::uuid, 20, '17:00'::time, 19000, 'Salón 112', null, null)
) v(id, id_monitor, desp, hora, precio, lugar, enlace, cierra);

-- Franjas "de borde": empiezan exactamente a esa distancia de now(). La fecha de cada una está en la tabla ref.
--   21: en 2 h.  22: en 3 h exactas.  23: en 3 h menos un microsegundo.  24: en 5 h.  25: en 12 h exactas.
--   26: en 12 h menos un microsegundo.
insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min, lugar, abierta_desde)
select v.id, 'b0000000-0000-0000-0000-0000000017a0',
       extract(isodow from v.t at time zone 'America/Bogota')::smallint,
       (v.t at time zone 'America/Bogota')::time, true, v.precio, 60, 'Salón 300', r.hoy - 60
from ref r cross join (values
  ('30000000-0000-0000-0000-000000001721'::uuid, now() + interval '2 hours', 12000),
  ('30000000-0000-0000-0000-000000001722'::uuid, now() + interval '3 hours', 13000),
  ('30000000-0000-0000-0000-000000001723'::uuid, now() + interval '3 hours' - interval '1 microsecond', 14000),
  ('30000000-0000-0000-0000-000000001724'::uuid, now() + interval '5 hours', 15000),
  ('30000000-0000-0000-0000-000000001725'::uuid, now() + interval '12 hours', 16000),
  ('30000000-0000-0000-0000-000000001726'::uuid, now() + interval '12 hours' - interval '1 microsecond', 17000)
) v(id, t, precio);

-- Los Leads 01 a 11 y 13 a 22, cada uno con su sesión. El 12 es de una cuenta de Estudiante (sin sesión
-- anónima) y la sesión 11 no tiene Lead propio: confirmó el correo del Lead 10 (P-23).
insert into public.lead (id, id_sesion_anonima, nombre, correo, acepta_tratamiento_datos, fecha_consentimiento)
select ('40000000-0000-0000-0000-0000000017' || n)::uuid, ('c0000000-0000-0000-0000-0000000017' || n)::uuid,
       'Lead ' || n, 'agendar17-' || n || '@calibra.test', true, now()
from unnest(array['01', '02', '04', '05', '06', '07', '08', '09', '10',
                  '13', '14', '15', '16', '17', '18', '19', '20', '21', '22']) n;
insert into public.lead (id, nombre, correo, acepta_tratamiento_datos, fecha_consentimiento) values
  ('40000000-0000-0000-0000-000000001712', 'Lead 12', 'agendar17-12@calibra.test', true, now());
insert into public.estudiante (id, id_lead) values
  ('d0000000-0000-0000-0000-000000001712', '40000000-0000-0000-0000-000000001712');
insert into public.lead_sesion (id_sesion, id_lead) values
  ('c0000000-0000-0000-0000-000000001711', '40000000-0000-0000-0000-000000001710');

-- Los bordes se construyeron exactos: el inicio de cada franja es now() más (o menos) esa distancia.
select ok(
  (select public.inicio_sesion(r.f3h, f.hora) = now() + interval '3 hours'
     and public.inicio_sesion(r.f3hm, g.hora) = now() + interval '3 hours' - interval '1 microsecond'
     and public.inicio_sesion(r.f12h, h.hora) = now() + interval '12 hours'
     and public.inicio_sesion(r.f12hm, i.hora) = now() + interval '12 hours' - interval '1 microsecond'
     and public.inicio_sesion(r.f2h, j.hora) = now() + interval '2 hours'
     and public.inicio_sesion(r.f5h, k.hora) = now() + interval '5 hours'
   from ref r, public.franja f, public.franja g, public.franja h, public.franja i, public.franja j, public.franja k
   where f.id = '30000000-0000-0000-0000-000000001722' and g.id = '30000000-0000-0000-0000-000000001723'
     and h.id = '30000000-0000-0000-0000-000000001725' and i.id = '30000000-0000-0000-0000-000000001726'
     and j.id = '30000000-0000-0000-0000-000000001721' and k.id = '30000000-0000-0000-0000-000000001724'),
  'Las franjas de borde empiezan exactamente a 2 h, 3 h, 5 h y 12 h de now() (y a un microsegundo menos)');

-- ---------------------------------------------------------------------------
-- Sin sesión y sin Lead
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"role":"authenticated"}';
select results_eq(
  $$select resultado, id_monitoria
    from public.agendar_monitoria('30000000-0000-0000-0000-000000001701', (select hoy + 10 from ref), 'PGTAP-17-A')$$,
  $$values ('sin_sesion'::text, null::uuid)$$,
  'Sin sesión (el token no trae sub) no se agenda: sin_sesion y ningún id');

set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001703","role":"authenticated","is_anonymous":true}';
select results_eq(
  $$select resultado, id_monitoria
    from public.agendar_monitoria('30000000-0000-0000-0000-000000001701', (select hoy + 10 from ref), 'PGTAP-17-A')$$,
  $$values ('no_es_lead'::text, null::uuid)$$,
  'D-3: una sesión que todavía no dejó su contacto no es Lead: no_es_lead (primero se le pide el contacto, HU-068)');

set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000017a0","role":"authenticated"}';
select results_eq(
  $$select resultado, id_monitoria
    from public.agendar_monitoria('30000000-0000-0000-0000-000000001701', (select hoy + 10 from ref), 'PGTAP-17-A')$$,
  $$values ('no_es_lead'::text, null::uuid)$$,
  'Las cuentas del equipo (un monitor) nunca son Lead: tampoco agendan');
reset role;
select is((select count(*)::int from public.monitoria where id_franja = '30000000-0000-0000-0000-000000001701'), 0,
  'Ninguna de esas llamadas dejó una monitoría');

-- ---------------------------------------------------------------------------
-- Agendar: nace en pendiente_pago con una copia del precio (RN-32, RN-34)
-- ---------------------------------------------------------------------------
-- El precio de la franja cambió antes de agendar: la monitoría guarda el de ese momento.
update public.franja set precio = 27000 where id = '30000000-0000-0000-0000-000000001701';

set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001701","role":"authenticated","is_anonymous":true}';
insert into r select 'm_a', * from public.agendar_monitoria(
  '30000000-0000-0000-0000-000000001701', (select hoy + 10 from ref), 'PGTAP-17-A');
select is((select resultado from r where k = 'm_a'), 'agendada',
  'Con una fecha libre y una materia certificada del monitor, el Lead agenda: agendada');
reset role;
select results_eq(
  $$select m.estado::text, m.valor_total, m.id_lead, m.id_monitor, m.id_materia, m.id_franja, m.fecha, m.id_diagnostico
    from public.monitoria m join r on r.id_monitoria = m.id where r.k = 'm_a'$$,
  $$select 'pendiente_pago'::text, 27000, '40000000-0000-0000-0000-000000001701'::uuid,
           'b0000000-0000-0000-0000-0000000017a0'::uuid, '10000000-0000-0000-0000-0000000017a1'::uuid,
           '30000000-0000-0000-0000-000000001701'::uuid, (select hoy + 10 from ref), null::uuid$$,
  'RN-32 y RN-34: nace pendiente_pago, con el precio de la franja en ese momento, el Lead de la sesión, el monitor de la franja, la materia del código y la fecha pedida; sin diagnóstico queda nulo');
update public.franja set precio = 30000 where id = '30000000-0000-0000-0000-000000001701';
select is((select m.valor_total from public.monitoria m join r on r.id_monitoria = m.id where r.k = 'm_a'), 27000,
  'RN-32: el valor_total es una copia: si el monitor cambia el precio después, la monitoría no cambia');

-- Un doble clic (misma franja y fecha) devuelve la misma reserva; otra fecha o franja la rechaza (D-8).
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001701","role":"authenticated","is_anonymous":true}';
select results_eq(
  $$select resultado, id_monitoria = (select id_monitoria from r where k = 'm_a')
    from public.agendar_monitoria('30000000-0000-0000-0000-000000001701', (select hoy + 10 from ref), 'PGTAP-17-A')$$,
  $$values ('ya_agendada'::text, true)$$,
  'Un doble clic (mismo Lead, misma franja y fecha) devuelve ya_agendada con el mismo id, sin crear otra');
select results_eq(
  $$select resultado, id_monitoria = (select id_monitoria from r where k = 'm_a')
    from public.agendar_monitoria('30000000-0000-0000-0000-000000001701', (select hoy + 17 from ref), 'PGTAP-17-A')$$,
  $$values ('reserva_pendiente'::text, true)$$,
  'D-8: con una reserva por pagar vigente, otra fecha de la misma franja da reserva_pendiente (con el id de la que ya tiene)');
select results_eq(
  $$select resultado, id_monitoria = (select id_monitoria from r where k = 'm_a')
    from public.agendar_monitoria('30000000-0000-0000-0000-000000001702', (select hoy + 11 from ref), 'PGTAP-17-A')$$,
  $$values ('reserva_pendiente'::text, true)$$,
  'D-8: y también otra franja: un Lead tiene como máximo una reserva por pagar vigente');
reset role;
select is((select count(*)::int from public.monitoria where id_lead = '40000000-0000-0000-0000-000000001701'), 1,
  'Esas tres llamadas no crearon nada: el Lead sigue con una sola monitoría');

-- RN-33: otra persona no puede tomar una fecha ocupada; una cancelada la libera.
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001702","role":"authenticated","is_anonymous":true}';
select results_eq(
  $$select resultado, id_monitoria
    from public.agendar_monitoria('30000000-0000-0000-0000-000000001701', (select hoy + 10 from ref), 'PGTAP-17-A')$$,
  $$values ('ocupada'::text, null::uuid)$$,
  'RN-33 y RN-34: otra persona pide una fecha con una reserva por pagar: ocupada');
reset role;
update public.monitoria set estado = 'confirmada' where id = (select id_monitoria from r where k = 'm_a');
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001702","role":"authenticated","is_anonymous":true}';
select results_eq(
  $$select resultado, id_monitoria
    from public.agendar_monitoria('30000000-0000-0000-0000-000000001701', (select hoy + 10 from ref), 'PGTAP-17-A')$$,
  $$values ('ocupada'::text, null::uuid)$$,
  'RN-33: una confirmada también ocupa la fecha');
reset role;
update public.monitoria set estado = 'cancelada', motivo_cancelacion = 'estudiante'
where id = (select id_monitoria from r where k = 'm_a');
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001702","role":"authenticated","is_anonymous":true}';
insert into r select 'm_b', * from public.agendar_monitoria(
  '30000000-0000-0000-0000-000000001701', (select hoy + 10 from ref), 'PGTAP-17-A');
select is((select resultado from r where k = 'm_b'), 'agendada',
  'RN-33: una monitoría cancelada no ocupa la fecha: otra persona la agenda');
reset role;
select results_eq(
  $$select m.estado::text, m.valor_total, m.id_lead, m.fecha
    from public.monitoria m join r on r.id_monitoria = m.id where r.k = 'm_b'$$,
  $$select 'pendiente_pago'::text, 30000, '40000000-0000-0000-0000-000000001702'::uuid, (select hoy + 10 from ref)$$,
  'Una sesión solo agenda a nombre de su propio Lead (el 02, no el 01 que tuvo la fecha antes), con el precio vigente');

-- D-8: la reserva cancelada ya no cuenta como "por pagar vigente".
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001701","role":"authenticated","is_anonymous":true}';
insert into r select 'm_c', * from public.agendar_monitoria(
  '30000000-0000-0000-0000-000000001701', (select hoy + 17 from ref), 'PGTAP-17-A');
select is((select resultado from r where k = 'm_c'), 'agendada',
  'D-8: una reserva cancelada (o confirmada) ya no cuenta como por pagar: el mismo Lead agenda otra fecha');
reset role;

-- ---------------------------------------------------------------------------
-- no_disponible: lo que no se puede reservar (Lead 04, que nunca llega a tener una reserva)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001704","role":"authenticated","is_anonymous":true}';
select results_eq(
  $$select resultado, id_monitoria
    from public.agendar_monitoria('30000000-0000-0000-0000-000000000000', (select hoy + 10 from ref), 'PGTAP-17-A')$$,
  $$values ('no_disponible'::text, null::uuid)$$,
  'Una franja que no existe no está disponible');
select results_eq(
  $$select resultado, id_monitoria
    from public.agendar_monitoria('30000000-0000-0000-0000-000000001701', (select hoy + 24 from ref), 'PGTAP-17-NO')$$,
  $$values ('no_disponible'::text, null::uuid)$$,
  'Una materia que no existe (el código se compara exacto, sin comodines) no está disponible, aunque la fecha esté libre');
select results_eq(
  $$select resultado from public.agendar_monitoria('30000000-0000-0000-0000-000000001701', (select hoy + 24 from ref), 'PGTAP-17-%')
    union all
    select resultado from public.agendar_monitoria('30000000-0000-0000-0000-000000001701', (select hoy + 24 from ref), null)
    union all
    select resultado from public.agendar_monitoria('30000000-0000-0000-0000-000000001701', null, 'PGTAP-17-A')$$,
  $$values ('no_disponible'::text), ('no_disponible'), ('no_disponible')$$,
  'Un código con comodín, un código nulo y una fecha nula tampoco están disponibles');
select results_eq(
  $$select resultado, id_monitoria
    from public.agendar_monitoria('30000000-0000-0000-0000-000000001703', (select hoy + 12 from ref), 'PGTAP-17-A')$$,
  $$values ('no_disponible'::text, null::uuid)$$,
  'RN-22: la franja es de un monitor que no está certificado en esa materia (MB solo en B)');
select results_eq(
  $$select resultado, id_monitoria
    from public.agendar_monitoria('30000000-0000-0000-0000-000000001701', (select hoy + 11 from ref), 'PGTAP-17-A')$$,
  $$values ('no_disponible'::text, null::uuid)$$,
  'RN-30: una fecha que no cae en el día de la semana de la franja no está disponible');
select results_eq(
  $$select resultado, id_monitoria
    from public.agendar_monitoria('30000000-0000-0000-0000-000000001701', (select hoy - 4 from ref), 'PGTAP-17-A')$$,
  $$values ('no_disponible'::text, null::uuid)$$,
  'Una fecha pasada (en el día correcto de la franja) no está disponible');
select results_eq(
  $$select resultado, id_monitoria
    from public.agendar_monitoria('30000000-0000-0000-0000-000000001707', (select hoy + 28 from ref), 'PGTAP-17-A')$$,
  $$values ('no_disponible'::text, null::uuid)$$,
  'D-9: hoy + 28 días ya queda fuera de las 4 semanas que muestra la lista');
select results_eq(
  $$select resultado, id_monitoria
    from public.agendar_monitoria('30000000-0000-0000-0000-000000001704', (select hoy + 17 from ref), 'PGTAP-17-A')$$,
  $$values ('no_disponible'::text, null::uuid)$$,
  'HU-015: una franja cerrada desde el 17 no recibe reservas ese mismo día (cerrada_desde es exclusivo hacia atrás)');
select results_eq(
  $$select resultado, id_monitoria
    from public.agendar_monitoria('30000000-0000-0000-0000-000000001704', (select hoy + 24 from ref), 'PGTAP-17-A')$$,
  $$values ('no_disponible'::text, null::uuid)$$,
  'Ni en las semanas siguientes');
select results_eq(
  $$select resultado, id_monitoria
    from public.agendar_monitoria('30000000-0000-0000-0000-000000001705', (select hoy + 10 from ref), 'PGTAP-17-A')$$,
  $$values ('no_disponible'::text, null::uuid)$$,
  'Un monitor con la cuenta suspendida no recibe reservas');
reset role;
select is((select count(*)::int from public.monitoria where id_lead = '40000000-0000-0000-0000-000000001704'), 0,
  'Ninguna de esas llamadas dejó una monitoría');

-- Controles: con la suspensión vencida, la misma solicitud sí se agenda (la causa era la suspensión).
update auth.users set banned_until = '2026-01-01' where id = 'b0000000-0000-0000-0000-0000000017c0';
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001704","role":"authenticated","is_anonymous":true}';
select is(
  (select resultado from public.agendar_monitoria('30000000-0000-0000-0000-000000001705', (select hoy + 10 from ref), 'PGTAP-17-A')),
  'agendada', 'Con la suspensión ya vencida, el mismo monitor recibe la reserva');

-- Los dos lados del horizonte y del cierre, cada uno con su Lead.
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001717","role":"authenticated","is_anonymous":true}';
select is(
  (select resultado from public.agendar_monitoria('30000000-0000-0000-0000-000000001706', (select hoy + 27 from ref), 'PGTAP-17-A')),
  'agendada', 'D-9: hoy + 27 días (la última fecha de las 4 semanas) sí se agenda');
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001718","role":"authenticated","is_anonymous":true}';
select is(
  (select resultado from public.agendar_monitoria('30000000-0000-0000-0000-000000001704', (select hoy + 10 from ref), 'PGTAP-17-A')),
  'agendada', 'En la franja que cierra el 17, la fecha anterior al cierre (el 10) sí se agenda');

-- La materia llega por su código: la de MB es B, y un código con espacios y minúsculas encuentra la misma materia.
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001719","role":"authenticated","is_anonymous":true}';
insert into r select 'm_19', * from public.agendar_monitoria(
  '30000000-0000-0000-0000-000000001703', (select hoy + 12 from ref), 'PGTAP-17-B');
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001720","role":"authenticated","is_anonymous":true}';
insert into r select 'm_20', * from public.agendar_monitoria(
  '30000000-0000-0000-0000-000000001712', (select hoy + 20 from ref), '  pgtap-17-a ');
reset role;
select results_eq(
  $$select r.k, r.resultado, m.id_materia, m.id_monitor, m.id_lead
    from r join public.monitoria m on m.id = r.id_monitoria where r.k in ('m_19', 'm_20') order by r.k$$,
  $$values
    ('m_19'::text, 'agendada'::text, '10000000-0000-0000-0000-0000000017b1'::uuid,
     'b0000000-0000-0000-0000-0000000017b0'::uuid, '40000000-0000-0000-0000-000000001719'::uuid),
    ('m_20', 'agendada', '10000000-0000-0000-0000-0000000017a1', 'b0000000-0000-0000-0000-0000000017a0',
     '40000000-0000-0000-0000-000000001720')$$,
  'La materia sale del código (B para la franja de MB), sin distinguir mayúsculas ni espacios (A con "  pgtap-17-a ")');

-- ---------------------------------------------------------------------------
-- RN-35 y P-40: 3 h de antelación; RN-37 y D-10: con menos de 12 h hay que marcar la casilla
-- ---------------------------------------------------------------------------
-- El Lead 22 prueba todo lo que no reserva. Las franjas 21 a 26 empiezan a 2 h, 3 h, 3 h menos un microsegundo,
-- 5 h, 12 h y 12 h menos un microsegundo.
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001722","role":"authenticated","is_anonymous":true}';
select results_eq(
  $$select resultado, id_monitoria
    from public.agendar_monitoria('30000000-0000-0000-0000-000000001721', (select f2h from ref), 'PGTAP-17-A', true)$$,
  $$values ('sin_antelacion'::text, null::uuid)$$,
  'RN-35: con 2 h para el inicio no se agenda, ni marcando la casilla');
select results_eq(
  $$select resultado, id_monitoria
    from public.agendar_monitoria('30000000-0000-0000-0000-000000001721', (select f2h from ref), 'PGTAP-17-A')$$,
  $$values ('sin_antelacion'::text, null::uuid)$$,
  'Y sin marcarla, la antelación se revisa primero: sin_antelacion');
select results_eq(
  $$select resultado, id_monitoria
    from public.agendar_monitoria('30000000-0000-0000-0000-000000001723', (select f3hm from ref), 'PGTAP-17-A', true)$$,
  $$values ('sin_antelacion'::text, null::uuid)$$,
  'P-40: a 3 h menos un microsegundo ya no se puede');
select results_eq(
  $$select resultado, id_monitoria
    from public.agendar_monitoria('30000000-0000-0000-0000-000000001722', (select f3h from ref), 'PGTAP-17-A')$$,
  $$values ('confirmar_sin_cancelacion'::text, null::uuid)$$,
  'P-40: a 3 h exactas la antelación se cumple, pero con menos de 12 h falta marcar la casilla: confirmar_sin_cancelacion y no se reservó nada');
select results_eq(
  $$select resultado, id_monitoria
    from public.agendar_monitoria('30000000-0000-0000-0000-000000001724', (select f5h from ref), 'PGTAP-17-A')$$,
  $$values ('confirmar_sin_cancelacion'::text, null::uuid)$$,
  'RN-37 y D-10: a 5 h, sin marcar la casilla "Entiendo que no podré cancelarla" no se reserva');
select results_eq(
  $$select resultado, id_monitoria
    from public.agendar_monitoria('30000000-0000-0000-0000-000000001724', (select f5h from ref), 'PGTAP-17-A', false)$$,
  $$values ('confirmar_sin_cancelacion'::text, null::uuid)$$,
  'Con la casilla en false, igual');
select results_eq(
  $$select resultado, id_monitoria
    from public.agendar_monitoria('30000000-0000-0000-0000-000000001724', (select f5h from ref), 'PGTAP-17-A', null)$$,
  $$values ('confirmar_sin_cancelacion'::text, null::uuid)$$,
  'Con la casilla nula (no se marcó), igual');
select results_eq(
  $$select resultado, id_monitoria
    from public.agendar_monitoria('30000000-0000-0000-0000-000000001726', (select f12hm from ref), 'PGTAP-17-A')$$,
  $$values ('confirmar_sin_cancelacion'::text, null::uuid)$$,
  'P-40: a 12 h menos un microsegundo ya no se puede cancelar: falta la casilla');
reset role;
select is((select count(*)::int from public.monitoria where id_lead = '40000000-0000-0000-0000-000000001722'), 0,
  'Ninguna de esas llamadas reservó nada');

-- Con la casilla, o con antelación suficiente, sí.
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001713","role":"authenticated","is_anonymous":true}';
insert into r select 'm_13', * from public.agendar_monitoria(
  '30000000-0000-0000-0000-000000001722', (select f3h from ref), 'PGTAP-17-A', true);
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001714","role":"authenticated","is_anonymous":true}';
insert into r select 'm_14', * from public.agendar_monitoria(
  '30000000-0000-0000-0000-000000001724', (select f5h from ref), 'PGTAP-17-A', true);
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001715","role":"authenticated","is_anonymous":true}';
insert into r select 'm_15', * from public.agendar_monitoria(
  '30000000-0000-0000-0000-000000001725', (select f12h from ref), 'PGTAP-17-A');
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001716","role":"authenticated","is_anonymous":true}';
insert into r select 'm_16', * from public.agendar_monitoria(
  '30000000-0000-0000-0000-000000001726', (select f12hm from ref), 'PGTAP-17-A', true);
select is((select resultado from r where k = 'm_13'), 'agendada',
  'P-40: con las 3 h exactas, y la casilla marcada, todavía se agenda');
select is((select resultado from r where k = 'm_14'), 'agendada',
  'A 5 h, con la casilla marcada, se agenda');
select is((select resultado from r where k = 'm_15'), 'agendada',
  'P-40: con 12 h exactas se puede cancelar todavía (cancelable_hasta es inclusivo): no hace falta la casilla');
select is((select resultado from r where k = 'm_16'), 'agendada',
  'A 12 h menos un microsegundo, con la casilla marcada, se agenda');
reset role;
select results_eq(
  $$select r.k, m.estado::text, m.valor_total from r join public.monitoria m on m.id = r.id_monitoria
    where r.k in ('m_13', 'm_14', 'm_15', 'm_16') order by r.k$$,
  $$values ('m_13'::text, 'pendiente_pago'::text, 13000), ('m_14', 'pendiente_pago', 15000),
           ('m_15', 'pendiente_pago', 16000), ('m_16', 'pendiente_pago', 17000)$$,
  'Las cuatro quedaron pendiente_pago con el precio de su franja');

-- ---------------------------------------------------------------------------
-- D-8: una reserva por pagar vence a los 10 minutos y deja de contar (RN-34)
-- ---------------------------------------------------------------------------
-- 05: reserva de hace 11 minutos. 06: de hace justo 10 minutos (todavía vigente, borde inclusivo, P-40).
-- 21: de hace 10 minutos y un microsegundo (ya vencida).
insert into public.monitoria (id, id_franja, id_monitor, id_materia, id_lead, fecha, estado, valor_total, fecha_creacion)
select v.id, '30000000-0000-0000-0000-000000001708', 'b0000000-0000-0000-0000-0000000017a0',
       '10000000-0000-0000-0000-0000000017a1', v.id_lead, r.hoy + v.desp, 'pendiente_pago'::public.estado_monitoria,
       20000, v.creada
from ref r cross join (values
  ('50000000-0000-0000-0000-000000001705'::uuid, '40000000-0000-0000-0000-000000001705'::uuid, 13,
   now() - interval '11 minutes'),
  ('50000000-0000-0000-0000-000000001706'::uuid, '40000000-0000-0000-0000-000000001706'::uuid, 20,
   now() - interval '10 minutes'),
  ('50000000-0000-0000-0000-000000001721'::uuid, '40000000-0000-0000-0000-000000001721'::uuid, 27,
   now() - interval '10 minutes' - interval '1 microsecond')
) v(id, id_lead, desp, creada);

set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001705","role":"authenticated","is_anonymous":true}';
insert into r select 'm_05', * from public.agendar_monitoria(
  '30000000-0000-0000-0000-000000001702', (select hoy + 18 from ref), 'PGTAP-17-A');
select is((select resultado from r where k = 'm_05'), 'agendada',
  'D-8: una reserva por pagar de hace 11 minutos ya venció y no cuenta: el mismo Lead agenda otra fecha');
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001706","role":"authenticated","is_anonymous":true}';
select results_eq(
  $$select resultado, id_monitoria = '50000000-0000-0000-0000-000000001706'::uuid
    from public.agendar_monitoria('30000000-0000-0000-0000-000000001702', (select hoy + 25 from ref), 'PGTAP-17-A')$$,
  $$values ('reserva_pendiente'::text, true)$$,
  'P-40: una de hace justo 10 minutos todavía está vigente (reserva_hasta es inclusivo): reserva_pendiente');
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001721","role":"authenticated","is_anonymous":true}';
select is(
  (select resultado from public.agendar_monitoria('30000000-0000-0000-0000-000000001702', (select hoy + 25 from ref), 'PGTAP-17-A')),
  'agendada', 'Y con 10 minutos y un microsegundo ya venció: agenda otra fecha');
reset role;
select is((select count(*)::int from public.monitoria where id_lead = '40000000-0000-0000-0000-000000001705'), 2,
  'La vencida sigue en la tabla (la cancela la tarea de HU-027) y la nueva se sumó');

-- ---------------------------------------------------------------------------
-- Diagnóstico (RN-15, P-35, D-7)
-- ---------------------------------------------------------------------------
insert into public.evaluacion (id, id_materia, semana, nombre) values
  ('20000000-0000-0000-0000-0000000017a1', '10000000-0000-0000-0000-0000000017a1', 1, 'Parcial A'),
  ('20000000-0000-0000-0000-0000000017b1', '10000000-0000-0000-0000-0000000017b1', 1, 'Parcial B');
-- 01 a 03: del Lead 07 (dos de A, el más reciente de las tres es el de B). 04: de otro Lead (22), el más
-- reciente de todos en A. 05: del Lead 08, solo de B. 06 y 07: del Lead 09, el 07 sin Lead (solo con su sesión).
insert into public.diagnostico (id, id_lead, id_sesion_anonima, id_evaluacion, id_materia, respuestas, puntaje, resultado_por_habilidad, semilla, aciertos, fecha_realizacion) values
  ('60000000-0000-0000-0000-000000001701', '40000000-0000-0000-0000-000000001707', null,
   '20000000-0000-0000-0000-0000000017a1', '10000000-0000-0000-0000-0000000017a1', '[{"clave":"P1"}]', 40, '{"habilidades":[],"errores":[],"prerrequisitos":[]}', 1, 0, now() - interval '5 days'),
  ('60000000-0000-0000-0000-000000001702', '40000000-0000-0000-0000-000000001707', 'c0000000-0000-0000-0000-000000001707',
   '20000000-0000-0000-0000-0000000017a1', '10000000-0000-0000-0000-0000000017a1', '[{"clave":"P1"}]', 60, '{"habilidades":[],"errores":[],"prerrequisitos":[]}', 1, 0, now() - interval '2 days'),
  ('60000000-0000-0000-0000-000000001703', '40000000-0000-0000-0000-000000001707', null,
   '20000000-0000-0000-0000-0000000017b1', '10000000-0000-0000-0000-0000000017b1', '[{"clave":"P1"}]', 80, '{"habilidades":[],"errores":[],"prerrequisitos":[]}', 1, 0, now() - interval '1 day'),
  ('60000000-0000-0000-0000-000000001704', '40000000-0000-0000-0000-000000001722', 'c0000000-0000-0000-0000-000000001722',
   '20000000-0000-0000-0000-0000000017a1', '10000000-0000-0000-0000-0000000017a1', '[{"clave":"P1"}]', 70, '{"habilidades":[],"errores":[],"prerrequisitos":[]}', 1, 0, now() - interval '1 hour'),
  ('60000000-0000-0000-0000-000000001705', '40000000-0000-0000-0000-000000001708', null,
   '20000000-0000-0000-0000-0000000017b1', '10000000-0000-0000-0000-0000000017b1', '[{"clave":"P1"}]', 50, '{"habilidades":[],"errores":[],"prerrequisitos":[]}', 1, 0, now() - interval '1 day'),
  ('60000000-0000-0000-0000-000000001706', '40000000-0000-0000-0000-000000001709', null,
   '20000000-0000-0000-0000-0000000017a1', '10000000-0000-0000-0000-0000000017a1', '[{"clave":"P1"}]', 30, '{"habilidades":[],"errores":[],"prerrequisitos":[]}', 1, 0, now() - interval '6 days'),
  ('60000000-0000-0000-0000-000000001707', null, 'c0000000-0000-0000-0000-000000001709',
   '20000000-0000-0000-0000-0000000017a1', '10000000-0000-0000-0000-0000000017a1', '[{"clave":"P1"}]', 55, '{"habilidades":[],"errores":[],"prerrequisitos":[]}', 1, 0, now() - interval '3 days');

-- P-35: el diagnóstico más reciente de ESA materia (el 02), no el de B (más reciente, otra materia) ni el de otro Lead.
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001707","role":"authenticated","is_anonymous":true}';
insert into r select 'd1', * from public.agendar_monitoria(
  '30000000-0000-0000-0000-000000001709', (select hoy + 15 from ref), 'PGTAP-17-A');
select is((select resultado from r where k = 'd1'), 'agendada', 'El Lead con diagnósticos agenda');
reset role;
select is(
  (select m.id_diagnostico from public.monitoria m join r on r.id_monitoria = m.id where r.k = 'd1'),
  '60000000-0000-0000-0000-000000001702'::uuid,
  'P-35: se liga el diagnóstico más reciente de la materia de la cita (no el viejo de A, ni el de B que es más nuevo, ni el de otro Lead)');

-- D-7: se comparte aunque ya esté ligado a otra cita.
update public.monitoria set estado = 'confirmada' where id = (select id_monitoria from r where k = 'd1');
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001707","role":"authenticated","is_anonymous":true}';
insert into r select 'd2', * from public.agendar_monitoria(
  '30000000-0000-0000-0000-000000001709', (select hoy + 22 from ref), 'PGTAP-17-A');
select is((select resultado from r where k = 'd2'), 'agendada',
  'Con la primera ya confirmada, el Lead agenda una segunda cita de la misma materia');
reset role;
select is(
  (select count(*)::int from public.monitoria
   where id_diagnostico = '60000000-0000-0000-0000-000000001702' and id in (select id_monitoria from r where k in ('d1', 'd2'))),
  2, 'D-7: el diagnóstico más reciente ya estaba ligado a otra cita y se liga igual: las dos lo comparten');

-- D-3: sin diagnóstico de la materia, la cita queda sin él (el Lead 08 solo tiene uno de B).
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001708","role":"authenticated","is_anonymous":true}';
insert into r select 'd3', * from public.agendar_monitoria(
  '30000000-0000-0000-0000-000000001710', (select hoy + 16 from ref), 'PGTAP-17-A');
select is((select resultado from r where k = 'd3'), 'agendada', 'Un Lead sin diagnóstico de la materia agenda igual (D-3)');
reset role;
select is(
  (select m.id_diagnostico from public.monitoria m join r on r.id_monitoria = m.id where r.k = 'd3'),
  null::uuid, 'D-3: sin diagnóstico de esa materia la cita queda sin él (el de B no sirve para A)');

-- P-33: un diagnóstico sin Lead, solo de su sesión, también cuenta; y es más reciente que el viejo del Lead.
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001709","role":"authenticated","is_anonymous":true}';
insert into r select 'd4', * from public.agendar_monitoria(
  '30000000-0000-0000-0000-000000001710', (select hoy + 23 from ref), 'PGTAP-17-A');
select is((select resultado from r where k = 'd4'), 'agendada', 'El Lead con un diagnóstico de su sesión agenda');
reset role;
select is(
  (select m.id_diagnostico from public.monitoria m join r on r.id_monitoria = m.id where r.k = 'd4'),
  '60000000-0000-0000-0000-000000001707'::uuid,
  'P-33: cuenta el diagnóstico con id_lead nulo y la sesión del Lead, y gana por ser el más reciente');

-- ---------------------------------------------------------------------------
-- D-7: quién lee un diagnóstico
-- ---------------------------------------------------------------------------
-- Los diagnósticos de esta prueba son los 17NN. MA dicta las citas d1, d2 (diagnóstico 02), d3 (ninguno) y d4 (07).
set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000017a0","role":"authenticated"}';
select is(
  (select coalesce(array_agg(right(id::text, 2) order by id), '{}') from public.diagnostico
   where id::text like '60000000-0000-0000-0000-0000000017%'),
  array['02', '07'],
  'D-7: el monitor de una cita lee el diagnóstico al que ella apunta, y solo esos (no los demás, aunque sean de la misma materia)');
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000017b0","role":"authenticated"}';
select is(
  (select coalesce(array_agg(right(id::text, 2) order by id), '{}') from public.diagnostico
   where id::text like '60000000-0000-0000-0000-0000000017%'),
  '{}'::text[],
  'Otro monitor, sin citas que apunten a un diagnóstico, no lee ninguno');
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001707","role":"authenticated","is_anonymous":true}';
select is(
  (select coalesce(array_agg(right(id::text, 2) order by id), '{}') from public.diagnostico
   where id::text like '60000000-0000-0000-0000-0000000017%'),
  array['01', '02', '03'],
  'El Lead dueño lee los suyos, y no los de otro Lead');
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001722","role":"authenticated","is_anonymous":true}';
select is(
  (select coalesce(array_agg(right(id::text, 2) order by id), '{}') from public.diagnostico
   where id::text like '60000000-0000-0000-0000-0000000017%'),
  array['04'],
  'Otro Lead solo lee el suyo: que haya una cita con el diagnóstico 02 no se lo abre a nadie más');
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001702","role":"authenticated","is_anonymous":true}';
select is(
  (select count(*)::int from public.diagnostico where id::text like '60000000-0000-0000-0000-0000000017%'),
  0, 'Un Lead sin diagnósticos tampoco lee los de otros');
reset role;

-- RN-15: el diagnóstico de la cita es de la misma materia (llave compuesta).
select throws_ok(
  $$update public.monitoria set id_diagnostico = '60000000-0000-0000-0000-000000001703'
    where id = (select id_monitoria from r where k = 'd1')$$,
  '23503', null,
  'RN-15: una cita de A no puede apuntar a un diagnóstico de B');

-- Si el diagnóstico se borra (supresión de datos, HU-056), la cita sigue sin él.
delete from public.diagnostico where id = '60000000-0000-0000-0000-000000001702';
select is(
  (select count(*)::int from public.monitoria
   where id in (select id_monitoria from r where k in ('d1', 'd2')) and id_diagnostico is null and id_materia = '10000000-0000-0000-0000-0000000017a1'),
  2, 'Al borrar el diagnóstico las dos citas siguen en su sitio, con la materia intacta y sin diagnóstico');

-- ---------------------------------------------------------------------------
-- La sesión liga el Lead (P-23): otras sesiones y cuentas del mismo Lead agendan para él
-- ---------------------------------------------------------------------------
-- La sesión 11 no tiene Lead propio: confirmó el correo del Lead 10 (lead_sesion).
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001711","role":"authenticated","is_anonymous":true}';
insert into r select 'm_11', * from public.agendar_monitoria(
  '30000000-0000-0000-0000-000000001711', (select hoy + 19 from ref), 'PGTAP-17-A');
select is((select resultado from r where k = 'm_11'), 'agendada',
  'Una sesión ligada a un Lead por lead_sesion agenda');
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000001710","role":"authenticated","is_anonymous":true}';
select results_eq(
  $$select resultado, id_monitoria = (select id_monitoria from r where k = 'm_11')
    from public.agendar_monitoria('30000000-0000-0000-0000-000000001711', (select hoy + 19 from ref), 'PGTAP-17-A')$$,
  $$values ('ya_agendada'::text, true)$$,
  'D-8 es por Lead, no por sesión: la sesión que creó el Lead ve la reserva de la otra (ya_agendada, el mismo id)');
select results_eq(
  $$select resultado, id_monitoria = (select id_monitoria from r where k = 'm_11')
    from public.agendar_monitoria('30000000-0000-0000-0000-000000001711', (select hoy + 26 from ref), 'PGTAP-17-A')$$,
  $$values ('reserva_pendiente'::text, true)$$,
  'Y no puede apartar otra fecha por la otra sesión: reserva_pendiente');
-- La cuenta de Estudiante que salió del Lead 12.
set local request.jwt.claims to '{"sub":"d0000000-0000-0000-0000-000000001712","role":"authenticated","is_anonymous":false}';
insert into r select 'm_12', * from public.agendar_monitoria(
  '30000000-0000-0000-0000-000000001711', (select hoy + 26 from ref), 'PGTAP-17-A');
select is((select resultado from r where k = 'm_12'), 'agendada', 'Una cuenta de Estudiante agenda a nombre de su Lead');
reset role;
select results_eq(
  $$select r.k, m.id_lead from r join public.monitoria m on m.id = r.id_monitoria where r.k in ('m_11', 'm_12') order by r.k$$,
  $$values ('m_11'::text, '40000000-0000-0000-0000-000000001710'::uuid), ('m_12', '40000000-0000-0000-0000-000000001712')$$,
  'Cada una quedó a nombre de su Lead (el 10 para la sesión ligada, el 12 para la cuenta de Estudiante), nunca de otro');

select * from finish();
rollback;
