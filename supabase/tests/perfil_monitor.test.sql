-- Pruebas pgTAP del perfil del monitor (HU-049, D-58 a y b).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.
--
-- Elenco (ids terminados en 49NN): admin 01; monitores A (certificado, dueño del perfil que se edita), B (sin
-- certificado), C (certificado, con la cuenta desactivada) y D (certificado, otro monitor); un Lead con su sesión
-- anónima y un estudiante. Los casos de contacto son los de src/lib/monitores/perfil.test.ts.

begin;
create extension if not exists pgtap with schema extensions;

select plan(50);

-- ---------------------------------------------------------------------------
-- Estructura y permisos
-- ---------------------------------------------------------------------------
select has_column('public', 'perfil_monitor', 'carrera', 'El perfil guarda la carrera (D-58 a)');
select has_column('public', 'perfil_monitor', 'semestre', 'El perfil guarda el semestre (D-58 a)');
select has_column('public', 'perfil_monitor', 'presentacion', 'El perfil guarda la presentación (D-58 a)');
select col_type_is('public', 'perfil_monitor', 'semestre', 'smallint', 'El semestre es un entero');
select ok(
  has_column_privilege('authenticated', 'public.perfil_monitor', 'carrera', 'update')
  and has_column_privilege('authenticated', 'public.perfil_monitor', 'semestre', 'update')
  and has_column_privilege('authenticated', 'public.perfil_monitor', 'presentacion', 'update'),
  'Con sesión se pueden cambiar los tres campos (la política dice de qué fila)');
select ok(not has_column_privilege('authenticated', 'public.perfil_monitor', 'id_monitor', 'update'),
  'El perfil no cambia de dueño');
select ok(
  not has_table_privilege('authenticated', 'public.perfil_monitor', 'insert')
  and not has_table_privilege('anon', 'public.perfil_monitor', 'insert'),
  'Nadie crea perfiles por la Data API: la fila la crea registrar_monitor (HU-013)');
select ok(
  not has_table_privilege('authenticated', 'public.perfil_monitor', 'delete')
  and not has_table_privilege('anon', 'public.perfil_monitor', 'delete'),
  'Nadie borra perfiles: se borran con el monitor (RN-08)');
select ok(not has_table_privilege('anon', 'public.perfil_monitor', 'update'), 'Sin sesión no se cambia ningún perfil');
select ok(
  (select prosecdef from pg_proc where oid = 'privado.cuenta_activa(uuid)'::regprocedure)
  and (select 'search_path=""' = any(proconfig) from pg_proc where oid = 'privado.cuenta_activa(uuid)'::regprocedure),
  'privado.cuenta_activa lee auth.users como security definer, con search_path vacío');
select ok(
  has_function_privilege('anon', 'privado.cuenta_activa(uuid)', 'execute')
  and has_function_privilege('authenticated', 'privado.cuenta_activa(uuid)', 'execute'),
  'La política la llama para visitantes y usuarios con sesión');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'perfil_monitor' and cmd = 'SELECT'),
  1, 'Una sola política de lectura (reemplaza la lectura pública sin filtro)');

-- ---------------------------------------------------------------------------
-- Fixtures (como postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, is_anonymous, banned_until) values
  ('a0000000-0000-0000-0000-000000004901', false, null),
  ('b0000000-0000-0000-0000-00000000490a', false, null),
  ('b0000000-0000-0000-0000-00000000490b', false, null),
  ('b0000000-0000-0000-0000-00000000490c', false, '2099-01-01'),
  ('b0000000-0000-0000-0000-00000000490d', false, null),
  ('c0000000-0000-0000-0000-000000004901', true, null),
  ('c0000000-0000-0000-0000-000000004902', false, null);
insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-000000004901', 'Admin', 'admin-49@calibra.test', 9004901);
insert into public.monitor (id, nombre) values
  ('b0000000-0000-0000-0000-00000000490a', 'Monitor A'),
  ('b0000000-0000-0000-0000-00000000490b', 'Monitor B'),
  ('b0000000-0000-0000-0000-00000000490c', 'Monitor C'),
  ('b0000000-0000-0000-0000-00000000490d', 'Monitor D');
insert into public.perfil_monitor (id_monitor, carrera, semestre, presentacion) values
  ('b0000000-0000-0000-0000-00000000490a', null, null, null),
  ('b0000000-0000-0000-0000-00000000490b', 'Física', 3, 'Sin certificado'),
  ('b0000000-0000-0000-0000-00000000490c', 'Química', 5, 'Cuenta desactivada'),
  ('b0000000-0000-0000-0000-00000000490d', 'Economía', 8, 'Otro monitor');
insert into public.materia (id, nombre, codigo) values ('10000000-0000-0000-0000-000000004901', 'Materia', 'PGTAP-49');
insert into public.certificado (id_monitor, id_materia, id_admin) values
  ('b0000000-0000-0000-0000-00000000490a', '10000000-0000-0000-0000-000000004901', 'a0000000-0000-0000-0000-000000004901'),
  ('b0000000-0000-0000-0000-00000000490c', '10000000-0000-0000-0000-000000004901', 'a0000000-0000-0000-0000-000000004901'),
  ('b0000000-0000-0000-0000-00000000490d', '10000000-0000-0000-0000-000000004901', 'a0000000-0000-0000-0000-000000004901');
insert into public.lead (id, id_sesion_anonima, nombre, correo, acepta_tratamiento_datos, fecha_consentimiento) values
  ('40000000-0000-0000-0000-000000004901', 'c0000000-0000-0000-0000-000000004901', 'Lead', 'lead-49@calibra.test', true, now()),
  ('40000000-0000-0000-0000-000000004902', null, 'Estudiante', 'est-49@calibra.test', true, now());
insert into public.estudiante (id, id_lead) values
  ('c0000000-0000-0000-0000-000000004902', '40000000-0000-0000-0000-000000004902');

-- D-58 b: teléfonos, correos, arrobas y enlaces, en la carrera y en la presentación.
create temporary table casos (texto text, con_contacto boolean);
insert into casos values
  ('3001234567', true), ('300 123 4567', true), ('+57 300-123-4567', true), ('300.123.4567', true), ('1234567', true),
  ('2022-2023', true), ('escríbeme a ana@uniandes.edu.co', true), ('@usuario', true), ('https://calibra.co', true),
  ('mira HTTP://ejemplo.com', true), ('www.ejemplo.com', true), ('WWW.EJEMPLO.COM', true),
  ('Monitor de Cálculo 2 desde 2024-1, nota 4,8', false), ('de 2022 a 2023', false), ('123456', false),
  ('Ingeniería de Sistemas', false);

-- Cada caso se prueba en su propio subbloque: cuenta cuántos se aceptan.
create function pg_temp.aceptados(p_campo text, p_con_contacto boolean) returns int language plpgsql as $$
declare
  c record;
  n int := 0;
begin
  for c in select texto from casos where con_contacto = p_con_contacto loop
    begin
      execute format('update public.perfil_monitor set %I = $1 where id_monitor = %L', p_campo, 'b0000000-0000-0000-0000-00000000490a')
        using c.texto;
      n := n + 1;
    exception when check_violation then null;
    end;
  end loop;
  return n;
end $$;
grant select on casos to authenticated;

-- ---------------------------------------------------------------------------
-- El dueño guarda su perfil: los bordes de cada campo
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-00000000490a","role":"authenticated"}';

select lives_ok(
  $$update public.perfil_monitor set carrera = 'Ingeniería de Sistemas', semestre = 6,
      presentacion = E'Monitor de Cálculo 2 desde 2024-1, nota 4,8\nTrabajé de 2022 a 2023'
    where id_monitor = 'b0000000-0000-0000-0000-00000000490a'$$,
  'El dueño guarda carrera, semestre y presentación');
select is(
  (select row(carrera, semestre)::text from public.perfil_monitor where id_monitor = 'b0000000-0000-0000-0000-00000000490a'),
  '("Ingeniería de Sistemas",6)', 'Quedan guardados');

select lives_ok($$update public.perfil_monitor set carrera = repeat('á', 80) where id_monitor = 'b0000000-0000-0000-0000-00000000490a'$$,
  'Carrera de 80 caracteres (no bytes): sí');
select throws_ok($$update public.perfil_monitor set carrera = repeat('á', 81) where id_monitor = 'b0000000-0000-0000-0000-00000000490a'$$,
  '23514', null, 'Carrera de 81 caracteres: no');
select throws_ok($$update public.perfil_monitor set carrera = '   ' where id_monitor = 'b0000000-0000-0000-0000-00000000490a'$$,
  '23514', null, 'Carrera de solo espacios: no (vacía se guarda como nulo)');
select throws_ok($$update public.perfil_monitor set carrera = E'Física\nQuímica' where id_monitor = 'b0000000-0000-0000-0000-00000000490a'$$,
  '23514', null, 'Carrera con salto de línea: no');

select lives_ok($$update public.perfil_monitor set semestre = 1 where id_monitor = 'b0000000-0000-0000-0000-00000000490a'$$, 'Semestre 1: sí');
select lives_ok($$update public.perfil_monitor set semestre = 12 where id_monitor = 'b0000000-0000-0000-0000-00000000490a'$$, 'Semestre 12: sí');
select throws_ok($$update public.perfil_monitor set semestre = 0 where id_monitor = 'b0000000-0000-0000-0000-00000000490a'$$,
  '23514', null, 'Semestre 0: no');
select throws_ok($$update public.perfil_monitor set semestre = 13 where id_monitor = 'b0000000-0000-0000-0000-00000000490a'$$,
  '23514', null, 'Semestre 13: no');

select lives_ok($$update public.perfil_monitor set presentacion = repeat('ñ', 500) where id_monitor = 'b0000000-0000-0000-0000-00000000490a'$$,
  'Presentación de 500 caracteres: sí');
select throws_ok($$update public.perfil_monitor set presentacion = repeat('ñ', 501) where id_monitor = 'b0000000-0000-0000-0000-00000000490a'$$,
  '23514', null, 'Presentación de 501 caracteres: no');
select throws_ok($$update public.perfil_monitor set presentacion = E' \n ' where id_monitor = 'b0000000-0000-0000-0000-00000000490a'$$,
  '23514', null, 'Presentación de solo espacios: no');
select throws_ok($$update public.perfil_monitor set presentacion = E'Hola\tchao' where id_monitor = 'b0000000-0000-0000-0000-00000000490a'$$,
  '23514', null, 'Presentación con otro carácter de control: no');


select is(pg_temp.aceptados('carrera', true), 0, 'D-58 b: ninguna carrera con teléfono, correo, arroba o enlace entra');
select is(pg_temp.aceptados('presentacion', true), 0, 'D-58 b: ninguna presentación con teléfono, correo, arroba o enlace entra');
select is(pg_temp.aceptados('carrera', false), 4, 'D-58 b: «2024-1, nota 4,8», «de 2022 a 2023» y seis dígitos sí entran en la carrera');
select is(pg_temp.aceptados('presentacion', false), 4, 'D-58 b: y en la presentación');

select lives_ok(
  $$update public.perfil_monitor set carrera = null, semestre = null, presentacion = null
    where id_monitor = 'b0000000-0000-0000-0000-00000000490a'$$,
  'Los tres campos son opcionales: se pueden dejar sin valor');
select throws_ok(
  $$update public.perfil_monitor set carrera = 'Medicina', semestre = 13 where id_monitor = 'b0000000-0000-0000-0000-00000000490a'$$,
  '23514', null, 'Todo o nada: con un campo inválido no se guarda ninguno');
select is((select carrera from public.perfil_monitor where id_monitor = 'b0000000-0000-0000-0000-00000000490a'), null,
  'La carrera válida de ese intento no quedó guardada');

select throws_ok(
  $$update public.perfil_monitor set id_monitor = 'b0000000-0000-0000-0000-00000000490b' where id_monitor = 'b0000000-0000-0000-0000-00000000490a'$$,
  '42501', null, 'El dueño no cambia el id del perfil');
select throws_ok(
  $$insert into public.perfil_monitor (id_monitor) values ('b0000000-0000-0000-0000-00000000490a')$$,
  '42501', null, 'El monitor no crea perfiles');

-- Lectura del dueño: siempre la suya.
select is((select count(*)::int from public.perfil_monitor where id_monitor = 'b0000000-0000-0000-0000-00000000490a'), 1,
  'El dueño ve su perfil');

reset role;

-- ---------------------------------------------------------------------------
-- Nadie más cambia el perfil de A
-- ---------------------------------------------------------------------------
create function pg_temp.cambiados_como(p_claims text) returns int language plpgsql as $$
declare
  n int;
begin
  perform set_config('request.jwt.claims', p_claims, true);
  set local role authenticated;
  update public.perfil_monitor set carrera = 'Hackeada' where id_monitor = 'b0000000-0000-0000-0000-00000000490a';
  get diagnostics n = row_count;
  reset role;
  return n;
end $$;

select is(pg_temp.cambiados_como('{"sub":"b0000000-0000-0000-0000-00000000490d","role":"authenticated"}'), 0,
  'Otro monitor no cambia el perfil de A');
select is(pg_temp.cambiados_como('{"sub":"a0000000-0000-0000-0000-000000004901","role":"authenticated"}'), 0,
  'Un admin no cambia el perfil de A (D-58 b: sin moderación en la app)');
select is(pg_temp.cambiados_como('{"sub":"c0000000-0000-0000-0000-000000004901","role":"authenticated","is_anonymous":true}'), 0,
  'Un Lead (sesión anónima) no cambia el perfil de A');
select is(pg_temp.cambiados_como('{"sub":"c0000000-0000-0000-0000-000000004902","role":"authenticated"}'), 0,
  'Un estudiante no cambia el perfil de A');

set local role anon;
set local request.jwt.claims to '{"role":"anon"}';
select throws_ok(
  $$update public.perfil_monitor set carrera = 'Hackeada' where id_monitor = 'b0000000-0000-0000-0000-00000000490a'$$,
  '42501', null, 'Un visitante sin sesión no cambia ningún perfil');
reset role;

select is((select carrera from public.perfil_monitor where id_monitor = 'b0000000-0000-0000-0000-00000000490a'), null,
  'El perfil de A sigue como lo dejó su dueño');

-- ---------------------------------------------------------------------------
-- Quién ve qué perfil: A y D certificados y activos; B sin certificado; C desactivado
-- ---------------------------------------------------------------------------
create temporary view ids_49 as
  select array['b0000000-0000-0000-0000-00000000490a', 'b0000000-0000-0000-0000-00000000490b',
               'b0000000-0000-0000-0000-00000000490c', 'b0000000-0000-0000-0000-00000000490d']::uuid[] as ids;
grant select on ids_49 to anon, authenticated;

create function pg_temp.visibles(p_rol text, p_claims text) returns text language plpgsql as $$
declare
  r text;
begin
  perform set_config('request.jwt.claims', p_claims, true);
  execute format('set local role %I', p_rol);
  select string_agg(right(p.id_monitor::text, 1), '' order by p.id_monitor) into r
    from public.perfil_monitor p where p.id_monitor in (select unnest(ids) from ids_49);
  reset role;
  return coalesce(r, '');
end $$;

select is(pg_temp.visibles('anon', '{"role":"anon"}'), 'ad',
  'Un visitante ve los perfiles de los monitores certificados y activos, no el sin certificado ni el desactivado');
select is(pg_temp.visibles('authenticated', '{"sub":"c0000000-0000-0000-0000-000000004901","role":"authenticated","is_anonymous":true}'), 'ad',
  'Un Lead ve lo mismo que un visitante');
select is(pg_temp.visibles('authenticated', '{"sub":"c0000000-0000-0000-0000-000000004902","role":"authenticated"}'), 'ad',
  'Un estudiante ve lo mismo');
select is(pg_temp.visibles('authenticated', '{"sub":"b0000000-0000-0000-0000-00000000490d","role":"authenticated"}'), 'ad',
  'Otro monitor certificado no ve el del sin certificado ni el del desactivado');
select is(pg_temp.visibles('authenticated', '{"sub":"b0000000-0000-0000-0000-00000000490b","role":"authenticated"}'), 'abd',
  'El monitor sin certificado ve el suyo');
select is(pg_temp.visibles('authenticated', '{"sub":"b0000000-0000-0000-0000-00000000490c","role":"authenticated"}'), 'acd',
  'El monitor desactivado ve el suyo');
select is(pg_temp.visibles('authenticated', '{"sub":"a0000000-0000-0000-0000-000000004901","role":"authenticated"}'), 'abcd',
  'Un admin los ve todos');

-- Con una suspensión vencida la cuenta vuelve a estar activa; sin certificado el perfil se oculta otra vez.
update auth.users set banned_until = '2020-01-01' where id = 'b0000000-0000-0000-0000-00000000490c';
delete from public.certificado where id_monitor = 'b0000000-0000-0000-0000-00000000490d';
select is(pg_temp.visibles('anon', '{"role":"anon"}'), 'ac',
  'Una suspensión vencida no oculta el perfil; perder el último certificado sí');

select * from finish();
rollback;
