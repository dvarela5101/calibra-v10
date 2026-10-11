-- Pruebas pgTAP de las materias y evaluaciones editables desde la app (HU-055).
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.
--
-- Qué cubre: la estructura y los permisos por columna; lo que escribe un admin activo (marca de «editada en la app», normalización y
-- validación de lo que cambió); quién no escribe; las tres formas de escritura de confianza (carga, llave secreta y los fixtures de
-- otras pruebas, que dejan claims de un usuario puestos); lo ligado a una materia y a una evaluación; borrar; y la guarda contra
-- llaves foráneas nuevas hacia `materia` o `evaluacion`.
--
-- Materias de lo ligado (una por hijo, para ver el arreglo exacto de cada una):
--   5501 una evaluación · 5502 un tema con habilidad, pregunta y opciones · 5503 un certificado · 5504 una solicitud de monitor
--   5505 un diagnóstico · 5506 una monitoría cancelada · 5507 una monitoría pendiente_pago con la reserva vencida
--   5508 vacía (la consultan los que no son admin y se compara con la que lo tiene todo) · 5509 los seis hijos · 5510 vacía (la borra el admin)
-- Materias de edición: 5521 a 5529 (ver cada una abajo; la 5529 guarda tabulador y salto de línea en los bordes). Evaluaciones de
-- edición: 5521 a 5525, en la materia 5527 (la 5525 también los guarda).

begin;
create extension if not exists pgtap with schema extensions;

select plan(194);

-- ---------------------------------------------------------------------------
-- Ayudantes (viven solo en esta sesión). Los tres corren con los permisos de quien llama (security invoker), para ver lo que ve
-- cada rol.
-- ---------------------------------------------------------------------------
-- resultado_de(sql): ejecuta la sentencia y devuelve 'ok' o 'SQLSTATE:hint'. El hint solo se lee en un 23514, que es donde los
-- triggers de esta HU dicen qué campo falló (los demás errores traen hints de Postgres o de Supabase que no importan aquí).
create function pg_temp.resultado_de(p_sql text) returns text
language plpgsql
as $$
declare
  v_hint text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return sqlstate || ':' || case when sqlstate = '23514' then coalesce(v_hint, '') else '' end;
end;
$$;
-- filas_de(sql): cuántas filas tocó un insert, update o delete.
create function pg_temp.filas_de(p_sql text) returns integer
language plpgsql
as $$
declare
  v_filas integer;
begin
  execute p_sql;
  get diagnostics v_filas = row_count;
  return v_filas;
end;
$$;
-- llaves_hacia(tabla): las tablas con una llave foránea hacia ella, ordenadas y separadas por comas.
create function pg_temp.llaves_hacia(p_tabla regclass) returns text
language sql
stable
as $$
  select coalesce(string_agg(n.nspname || '.' || c.relname, ',' order by n.nspname || '.' || c.relname), '')
  from (select distinct conrelid from pg_constraint where contype = 'f' and confrelid = p_tabla) k
  join pg_class c on c.oid = k.conrelid
  join pg_namespace n on n.oid = c.relnamespace;
$$;

-- ---------------------------------------------------------------------------
-- 1. Estructura y permisos
-- ---------------------------------------------------------------------------
select has_column('public', 'materia', 'carpeta', 'La materia guarda la carpeta de contenido/ de la que vino');
select col_type_is('public', 'materia', 'carpeta', 'text', 'La carpeta es texto');
select col_is_null('public', 'materia', 'carpeta', 'La carpeta puede ser nula (materia creada en la app)');
select has_column('public', 'materia', 'editada_en_app', 'La materia lleva la marca de editada en la app');
select col_type_is('public', 'materia', 'editada_en_app', 'boolean', 'La marca de la materia es booleana');
select col_not_null('public', 'materia', 'editada_en_app', 'La marca de la materia nunca es nula');
select has_column('public', 'evaluacion', 'editada_en_app', 'La evaluación lleva la marca de editada en la app');
select col_type_is('public', 'evaluacion', 'editada_en_app', 'boolean', 'La marca de la evaluación es booleana');
select col_not_null('public', 'evaluacion', 'editada_en_app', 'La marca de la evaluación nunca es nula');

select is(
  (select indexdef from pg_indexes where schemaname = 'public' and indexname = 'materia_carpeta_key'),
  'CREATE UNIQUE INDEX materia_carpeta_key ON public.materia USING btree (carpeta)',
  'La carpeta es única (los nulos no chocan)');
select is(
  (select indexdef from pg_indexes where schemaname = 'public' and indexname = 'materia_codigo_lower_key'),
  'CREATE UNIQUE INDEX materia_codigo_lower_key ON public.materia USING btree (lower(btrim(codigo)))',
  'El código es único sin mirar mayúsculas ni espacios en los bordes');

select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'materia' and cmd = 'INSERT'),
  1, 'Materia: una sola política de insert');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'materia' and cmd = 'UPDATE'),
  1, 'Materia: una sola política de update');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'materia' and cmd in ('DELETE', 'ALL')),
  0, 'Materia: ninguna política de delete (ni una que sirva para todo)');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'evaluacion' and cmd = 'UPDATE'),
  1, 'Evaluación: una sola política de update');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'evaluacion' and cmd in ('INSERT', 'DELETE', 'ALL')),
  0, 'Evaluación: ninguna política de insert ni de delete (las trae el banco)');
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public'
     and policyname in ('admin crea materias', 'admin edita materias', 'admin edita evaluaciones')
     and with_check ~ 'es_admin' and coalesce(qual, with_check) ~ 'es_admin'),
  3, 'Las tres políticas de escritura piden ser admin activo, en lo que filtran y en lo que dejan escribir');

select is(
  (select coalesce(array_agg(a.attname::text order by a.attname), '{}'::text[]) from pg_attribute a
   where a.attrelid = 'public.materia'::regclass and a.attnum > 0 and not a.attisdropped
     and has_column_privilege('authenticated', a.attrelid, a.attnum, 'insert')),
  array['codigo', 'nombre'],
  'Con sesión se inserta de una materia solo el nombre y el código');
select is(
  (select coalesce(array_agg(a.attname::text order by a.attname), '{}'::text[]) from pg_attribute a
   where a.attrelid = 'public.materia'::regclass and a.attnum > 0 and not a.attisdropped
     and has_column_privilege('authenticated', a.attrelid, a.attnum, 'update')),
  array['codigo', 'nombre'],
  'Con sesión se actualiza de una materia solo el nombre y el código');
select is(
  (select coalesce(array_agg(a.attname::text order by a.attname), '{}'::text[]) from pg_attribute a
   where a.attrelid = 'public.evaluacion'::regclass and a.attnum > 0 and not a.attisdropped
     and has_column_privilege('authenticated', a.attrelid, a.attnum, 'update')),
  array['nombre', 'semana'],
  'Con sesión se actualiza de una evaluación solo el nombre y la semana');
select is(
  (select coalesce(array_agg(a.attname::text order by a.attname), '{}'::text[]) from pg_attribute a
   where a.attrelid = 'public.evaluacion'::regclass and a.attnum > 0 and not a.attisdropped
     and has_column_privilege('authenticated', a.attrelid, a.attnum, 'insert')),
  '{}'::text[],
  'Con sesión no se inserta ninguna columna de una evaluación');
select ok(
  not has_table_privilege('authenticated', 'public.materia', 'delete')
  and not has_table_privilege('authenticated', 'public.evaluacion', 'delete'),
  'Nadie con sesión borra materias ni evaluaciones directo (se borra con las funciones)');
select ok(
  not has_any_column_privilege('anon', 'public.materia', 'insert')
  and not has_any_column_privilege('anon', 'public.materia', 'update')
  and not has_any_column_privilege('anon', 'public.evaluacion', 'insert')
  and not has_any_column_privilege('anon', 'public.evaluacion', 'update')
  and not has_table_privilege('anon', 'public.materia', 'delete')
  and not has_table_privilege('anon', 'public.evaluacion', 'delete'),
  'Sin sesión no se escribe nada de materias ni de evaluaciones');

select is(
  (select count(*)::int from (values
     ('public.ligado_de_materia(uuid)'), ('public.ligado_de_evaluacion(uuid)'),
     ('public.borrar_materia(uuid)'), ('public.borrar_evaluacion(uuid)'),
     ('privado.ligado_de_materia(uuid)'), ('privado.ligado_de_evaluacion(uuid)'),
     ('privado.borrar_materia(uuid)'), ('privado.borrar_evaluacion(uuid)')) f (n)
   where has_function_privilege('authenticated', f.n, 'execute')),
  8, 'Las ocho funciones las ejecuta authenticated');
select is(
  (select count(*)::int from (values
     ('public.ligado_de_materia(uuid)'), ('public.ligado_de_evaluacion(uuid)'),
     ('public.borrar_materia(uuid)'), ('public.borrar_evaluacion(uuid)'),
     ('privado.ligado_de_materia(uuid)'), ('privado.ligado_de_evaluacion(uuid)'),
     ('privado.borrar_materia(uuid)'), ('privado.borrar_evaluacion(uuid)')) f (n)
   where has_function_privilege('anon', f.n, 'execute')),
  0, 'Ninguna de las ocho funciones la ejecuta anon');
select is(
  (select count(*)::int from (values
     ('public.ligado_de_materia(uuid)'), ('public.ligado_de_evaluacion(uuid)'),
     ('public.borrar_materia(uuid)'), ('public.borrar_evaluacion(uuid)'),
     ('privado.ligado_de_materia(uuid)'), ('privado.ligado_de_evaluacion(uuid)'),
     ('privado.borrar_materia(uuid)'), ('privado.borrar_evaluacion(uuid)'),
     ('privado.al_escribir_materia()'), ('privado.al_escribir_evaluacion()')) f (n)
   where has_function_privilege('service_role', f.n, 'execute')),
  0, 'La llave secreta no ejecuta ninguna de las funciones de esta HU (borra el admin con su sesión)');
select is(
  (select count(*)::int from (values ('privado.al_escribir_materia()'), ('privado.al_escribir_evaluacion()')) f (n)
   cross join (values ('anon'), ('authenticated'), ('service_role')) r (rol)
   where has_function_privilege(r.rol, f.n, 'execute')),
  0, 'Nadie ejecuta las funciones de los triggers (corren al escribir, no se llaman)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('ligado_de_materia', 'ligado_de_evaluacion', 'borrar_materia', 'borrar_evaluacion')
     and not p.prosecdef),
  4, 'Las cuatro puertas de public son security invoker (el definer va en privado)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'privado' and p.proname in ('ligado_de_materia', 'ligado_de_evaluacion', 'borrar_materia', 'borrar_evaluacion')
     and p.prosecdef and array_to_string(p.proconfig, ',') ~ 'search_path'),
  4, 'Las cuatro de privado son security definer con search_path fijo');
select trigger_is('public', 'materia', 'materia_al_escribir', 'privado', 'al_escribir_materia',
  'La materia tiene su trigger de marca y normalización');
select trigger_is('public', 'evaluacion', 'evaluacion_al_escribir', 'privado', 'al_escribir_evaluacion',
  'La evaluación tiene su trigger de marca y normalización');

-- ---------------------------------------------------------------------------
-- 2. Fixtures (como postgres, sin claims: escritura de confianza)
-- ---------------------------------------------------------------------------
insert into auth.users (id, is_anonymous, banned_until) values
  ('a0000000-0000-0000-0000-00000000550a', false, null),                          -- admin A, activo
  ('a0000000-0000-0000-0000-00000000550d', false, now() + interval '100 years'),  -- admin desactivado
  ('b0000000-0000-0000-0000-000000005501', false, null),                          -- monitor
  ('c0000000-0000-0000-0000-000000005501', true, null),                           -- sesión anónima con Lead
  ('c0000000-0000-0000-0000-000000005502', true, null);                           -- sesión anónima sin Lead
insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-00000000550a', 'Admin A', 'admin-a-hu055@calibra.test', 9005501),
  ('a0000000-0000-0000-0000-00000000550d', 'Admin D', 'admin-d-hu055@calibra.test', 9005502);
insert into public.monitor (id, nombre) values ('b0000000-0000-0000-0000-000000005501', 'Monitor Uno');
insert into public.monitor_privado (id_monitor, numero_telefono, correo, llave) values
  ('b0000000-0000-0000-0000-000000005501', '3000005501', 'm-hu055@example.com', 'llave-m1');
insert into public.lead (id, id_sesion_anonima, nombre, correo, acepta_tratamiento_datos, fecha_consentimiento) values
  ('40000000-0000-0000-0000-000000005501', 'c0000000-0000-0000-0000-000000005501', 'Lead Uno', 'lead-hu055@example.com', true, now());
insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min) values
  ('30000000-0000-0000-0000-000000005501', 'b0000000-0000-0000-0000-000000005501', 1, '10:00', true, 25000, 60);

insert into public.materia (id, nombre, codigo) values
  ('10000000-0000-0000-0000-000000005501', 'Con una evaluación', 'PRB-5501'),
  ('10000000-0000-0000-0000-000000005502', 'Con un tema', 'PRB-5502'),
  ('10000000-0000-0000-0000-000000005503', 'Con un certificado', 'PRB-5503'),
  ('10000000-0000-0000-0000-000000005504', 'Con una solicitud', 'PRB-5504'),
  ('10000000-0000-0000-0000-000000005505', 'Con un diagnóstico', 'PRB-5505'),
  ('10000000-0000-0000-0000-000000005506', 'Con una monitoría cancelada', 'PRB-5506'),
  ('10000000-0000-0000-0000-000000005507', 'Con una reserva vencida', 'PRB-5507'),
  ('10000000-0000-0000-0000-000000005508', 'Vacía uno', 'PRB-5508'),
  ('10000000-0000-0000-0000-000000005509', 'Con todo', 'PRB-5509'),
  ('10000000-0000-0000-0000-000000005510', 'Vacía dos', 'PRB-5510'),
  ('10000000-0000-0000-0000-000000005521', 'Nombre original', 'PRB-5521'),
  ('10000000-0000-0000-0000-000000005522', 'Cambia el código', 'PRB-5522'),
  ('10000000-0000-0000-0000-000000005523', 'Código sin forma', 'PRB-5523'),
  ('10000000-0000-0000-0000-000000005524', ' Código histórico ', ' prb-5524 '),
  ('10000000-0000-0000-0000-000000005525', repeat('L', 130), 'PRB-5525'),
  ('10000000-0000-0000-0000-000000005526', 'Intocable', 'PRB-5526'),
  ('10000000-0000-0000-0000-000000005527', 'Padre de evaluaciones', 'PRB-5527');
insert into public.materia (id, nombre, codigo, carpeta) values
  ('10000000-0000-0000-0000-000000005528', 'Con carpeta', 'PRB-5528', 'prb-carpeta-55');
-- Un nombre y un código guardados con tabulador y salto de línea en los bordes (el banco o una carga directa pueden dejarlos así).
insert into public.materia (id, nombre, codigo) values
  ('10000000-0000-0000-0000-000000005529', E'\tCon blancos\n', E'\tprb-5529\n');

-- Evaluaciones: una por materia con evaluación; cinco en la materia 5509 (la que lo tiene todo); cuatro de edición en la 5527.
insert into public.evaluacion (id, id_materia, semana, nombre) values
  ('20000000-0000-0000-0000-000000005501', '10000000-0000-0000-0000-000000005501', 1, 'Parcial EV'),
  ('20000000-0000-0000-0000-000000005505', '10000000-0000-0000-0000-000000005505', 1, 'Parcial DI'),
  ('20000000-0000-0000-0000-000000005509', '10000000-0000-0000-0000-000000005509', 1, 'Con temas y diagnóstico'),
  ('20000000-0000-0000-0000-000000005510', '10000000-0000-0000-0000-000000005509', 2, 'Solo temas'),
  ('20000000-0000-0000-0000-000000005511', '10000000-0000-0000-0000-000000005509', 3, 'Solo diagnóstico'),
  ('20000000-0000-0000-0000-000000005512', '10000000-0000-0000-0000-000000005509', 4, 'Vacía'),
  ('20000000-0000-0000-0000-000000005513', '10000000-0000-0000-0000-000000005509', 5, 'Con un diagnóstico en curso'),
  ('20000000-0000-0000-0000-000000005521', '10000000-0000-0000-0000-000000005527', 3, 'Parcial 1'),
  ('20000000-0000-0000-0000-000000005522', '10000000-0000-0000-0000-000000005527', 6, 'Parcial 2'),
  ('20000000-0000-0000-0000-000000005523', '10000000-0000-0000-0000-000000005527', 9, ' Parcial 3 '),
  ('20000000-0000-0000-0000-000000005524', '10000000-0000-0000-0000-000000005527', 12, 'Parcial 4'),
  ('20000000-0000-0000-0000-000000005525', '10000000-0000-0000-0000-000000005527', 15, E'\tParcial 5\n');

-- Temas (5502 con toda su cadena: habilidad, misconcepción, pregunta y opciones; 5509 solo el tema) y los de las evaluaciones.
insert into public.tema (id, id_materia, clave, nombre, orden) values
  ('51000000-0000-0000-0000-000000005502', '10000000-0000-0000-0000-000000005502', 'tema-te', 'Tema del banco', 1),
  ('51000000-0000-0000-0000-000000005509', '10000000-0000-0000-0000-000000005509', 'tema-all', 'Tema de la materia completa', 1);
insert into public.habilidad (id, id_materia, id_tema, clave, descripcion) values
  ('61000000-0000-0000-0000-000000005502', '10000000-0000-0000-0000-000000005502',
   '51000000-0000-0000-0000-000000005502', 'habilidad-te', 'Hace algo');
insert into public.misconcepcion (id, id_materia, id_habilidad, clave, descripcion) values
  ('71000000-0000-0000-0000-000000005502', '10000000-0000-0000-0000-000000005502',
   '61000000-0000-0000-0000-000000005502', 'error-te', 'Se equivoca en algo');
insert into public.pregunta (id, id_materia, id_tema, clave, enunciado, dificultad, estado, origen, revisor, solucion) values
  ('81000000-0000-0000-0000-000000005502', '10000000-0000-0000-0000-000000005502',
   '51000000-0000-0000-0000-000000005502', 'P1', 'Enunciado', 2, 'revisada', 'humano', 'prototipo', 'Paso a paso');
insert into public.pregunta_habilidad (id_pregunta, id_habilidad, id_materia) values
  ('81000000-0000-0000-0000-000000005502', '61000000-0000-0000-0000-000000005502', '10000000-0000-0000-0000-000000005502');
insert into public.opcion (id, id_pregunta, id_materia, letra, texto, correcta, id_misconcepcion, error) values
  ('f1000000-0000-0000-0000-000000005521', '81000000-0000-0000-0000-000000005502', '10000000-0000-0000-0000-000000005502',
   'A', 'La correcta', true, null, null),
  ('f1000000-0000-0000-0000-000000005522', '81000000-0000-0000-0000-000000005502', '10000000-0000-0000-0000-000000005502',
   'B', 'La incorrecta', false, '71000000-0000-0000-0000-000000005502', null);
-- «Con temas y diagnóstico» y «Solo temas» cubren el tema de la materia 5509.
insert into public.evaluacion_tema (id_evaluacion, id_tema, id_materia) values
  ('20000000-0000-0000-0000-000000005509', '51000000-0000-0000-0000-000000005509', '10000000-0000-0000-0000-000000005509'),
  ('20000000-0000-0000-0000-000000005510', '51000000-0000-0000-0000-000000005509', '10000000-0000-0000-0000-000000005509');

-- Certificados del monitor en las materias 5503, 5506, 5507 y 5509 (las monitorías los necesitan).
insert into public.certificado (id_monitor, id_materia, id_admin) values
  ('b0000000-0000-0000-0000-000000005501', '10000000-0000-0000-0000-000000005503', 'a0000000-0000-0000-0000-00000000550a'),
  ('b0000000-0000-0000-0000-000000005501', '10000000-0000-0000-0000-000000005506', 'a0000000-0000-0000-0000-00000000550a'),
  ('b0000000-0000-0000-0000-000000005501', '10000000-0000-0000-0000-000000005507', 'a0000000-0000-0000-0000-00000000550a'),
  ('b0000000-0000-0000-0000-000000005501', '10000000-0000-0000-0000-000000005509', 'a0000000-0000-0000-0000-00000000550a');

-- Una solicitud de monitor que pide las materias 5504 y 5509.
insert into public.solicitud_monitor (id, nombre, correo, numero_telefono, acepta_tratamiento_datos, fecha_consentimiento) values
  ('90000000-0000-0000-0000-000000005501', 'Aspirante Uno', 'aspirante-hu055@example.com', '+573000005501', true, now());
insert into public.solicitud_monitor_materia (id_solicitud, id_materia) values
  ('90000000-0000-0000-0000-000000005501', '10000000-0000-0000-0000-000000005504'),
  ('90000000-0000-0000-0000-000000005501', '10000000-0000-0000-0000-000000005509');

-- Monitorías (lunes de 2020): cancelada (5506), pendiente_pago con la reserva de hace tres días (5507) y realizada (5509).
insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado, motivo_cancelacion) values
  ('50000000-0000-0000-0000-000000005506', '30000000-0000-0000-0000-000000005501', '10000000-0000-0000-0000-000000005506',
   '40000000-0000-0000-0000-000000005501', '2020-01-06', 25000, 'cancelada', 'estudiante');
insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado, fecha_creacion) values
  ('50000000-0000-0000-0000-000000005507', '30000000-0000-0000-0000-000000005501', '10000000-0000-0000-0000-000000005507',
   '40000000-0000-0000-0000-000000005501', '2020-01-13', 25000, 'pendiente_pago', now() - interval '3 days');
insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado, fecha_finalizacion) values
  ('50000000-0000-0000-0000-000000005509', '30000000-0000-0000-0000-000000005501', '10000000-0000-0000-0000-000000005509',
   '40000000-0000-0000-0000-000000005501', '2020-01-20', 25000, 'realizada', '2020-01-20 16:30:00+00');

-- Diagnósticos: uno en la materia 5505 y dos en la 5509 (de «Con temas y diagnóstico» y de «Solo diagnóstico»).
insert into public.diagnostico (id, id_lead, id_evaluacion, id_materia, respuestas, puntaje, resultado_por_habilidad, semilla, aciertos) values
  ('60000000-0000-0000-0000-000000005505', '40000000-0000-0000-0000-000000005501',
   '20000000-0000-0000-0000-000000005505', '10000000-0000-0000-0000-000000005505',
   '[{"clave":"P1"}]', 40, '{"habilidades":[],"errores":[],"prerrequisitos":[]}', 1, 0),
  ('60000000-0000-0000-0000-000000005509', '40000000-0000-0000-0000-000000005501',
   '20000000-0000-0000-0000-000000005509', '10000000-0000-0000-0000-000000005509',
   '[{"clave":"P1"}]', 60, '{"habilidades":[],"errores":[],"prerrequisitos":[]}', 1, 0),
  ('60000000-0000-0000-0000-000000005511', '40000000-0000-0000-0000-000000005501',
   '20000000-0000-0000-0000-000000005511', '10000000-0000-0000-0000-000000005509',
   '[{"clave":"P1"}]', 80, '{"habilidades":[],"errores":[],"prerrequisitos":[]}', 1, 0);

-- Un diagnóstico en curso de «Con un diagnóstico en curso»: se va en cascada con la evaluación (HU-081), no cuenta como ligado.
insert into public.diagnostico_en_curso (id_sesion, id_evaluacion, id_materia, semilla, candidatas, contexto) values
  ('c0000000-0000-0000-0000-000000005502', '20000000-0000-0000-0000-000000005513', '10000000-0000-0000-0000-000000005509',
   1, '[]', '{}');

-- ---------------------------------------------------------------------------
-- 3. La carpeta y el índice del código (como postgres)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$insert into public.materia (nombre, codigo, carpeta) values ('X', 'PRB-5540', 'Calculo-Diferencial')$$,
  '23514', null, 'La carpeta va en minúsculas, como la valida el convertidor');
select throws_ok(
  $$insert into public.materia (nombre, codigo, carpeta) values ('X', 'PRB-5540', 'calculo--diferencial')$$,
  '23514', null, 'La carpeta no lleva guiones seguidos');
select throws_ok(
  $$insert into public.materia (nombre, codigo, carpeta) values ('X', 'PRB-5540', 'prb-carpeta-55')$$,
  '23505', 'duplicate key value violates unique constraint "materia_carpeta_key"',
  'Dos materias no comparten carpeta');
select throws_ok(
  $$insert into public.materia (nombre, codigo) values ('Repetida', 'prb-5521')$$,
  '23505', 'duplicate key value violates unique constraint "materia_codigo_lower_key"',
  'El código no se repite aunque solo cambien las mayúsculas');
select throws_ok(
  $$insert into public.materia (nombre, codigo) values ('Repetida', ' PRB-5521 ')$$,
  '23505', 'duplicate key value violates unique constraint "materia_codigo_lower_key"',
  'El código no se repite aunque solo cambien los espacios de los bordes');
select lives_ok(
  $$insert into public.materia (nombre, codigo) values ('Sin carpeta uno', 'PRB-5541'), ('Sin carpeta dos', 'PRB-5542')$$,
  'Varias materias sin carpeta conviven (los nulos no chocan)');
select is(
  (select count(*)::int from public.materia where editada_en_app and lower(btrim(codigo)) like 'prb-55%'),
  0, 'Ningún fixture de confianza quedó marcado como editado en la app');

-- ---------------------------------------------------------------------------
-- 4. Lo que escribe un admin activo (criterios 3, 4, 5, 7 y 11)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-00000000550a","role":"authenticated"}';

-- Crear
select lives_ok(
  $$insert into public.materia (nombre, codigo) values ('  Cálculo de prueba  ', ' zzzz-5501 ')$$,
  'Un admin crea una materia con el código en minúsculas y espacios');
select results_eq(
  $$select nombre, codigo, editada_en_app, carpeta from public.materia where lower(btrim(codigo)) = 'zzzz-5501'$$,
  $$values ('Cálculo de prueba'::text, 'ZZZZ-5501'::text, true, null::text)$$,
  'Queda con el nombre recortado, el código en mayúsculas, la marca verdadera y sin carpeta');
select is(
  pg_temp.resultado_de($$insert into public.materia (nombre, codigo) values ('', 'ZZZZ-5502')$$),
  '23514:nombre', 'Nombre vacío: 23514 con el hint del campo');
select is(
  pg_temp.resultado_de($$insert into public.materia (nombre, codigo) values ('   ', 'ZZZZ-5502')$$),
  '23514:nombre', 'Nombre de solo espacios: 23514');
-- `trim()` de la app quita más que el espacio: un nombre de solo blancos es vacío en la app y tiene que serlo aquí.
select is(
  pg_temp.resultado_de($$insert into public.materia (nombre, codigo) values (E'\t', 'ZZZZ-5502')$$),
  '23514:nombre', 'Nombre de solo un tabulador: 23514');
select is(
  pg_temp.resultado_de($$insert into public.materia (nombre, codigo) values (E'\n', 'ZZZZ-5502')$$),
  '23514:nombre', 'Nombre de solo un salto de línea: 23514');
select is(
  pg_temp.resultado_de($$insert into public.materia (nombre, codigo) values (chr(160), 'ZZZZ-5502')$$),
  '23514:nombre', 'Nombre de solo un espacio de no separación: 23514');
select lives_ok(
  $$insert into public.materia (nombre, codigo) values (E'\t Cálculo con blancos\n' || chr(160), E'\tzzzz-5506\n')$$,
  'Un admin crea una materia con tabuladores y saltos de línea en los bordes del nombre y del código');
select results_eq(
  $$select nombre, codigo, editada_en_app from public.materia where codigo = 'ZZZZ-5506'$$,
  $$values ('Cálculo con blancos'::text, 'ZZZZ-5506'::text, true)$$,
  'Quedan recortados como los recorta la app: el nombre sin blancos en los bordes y el código en mayúsculas');
select is(
  pg_temp.resultado_de($$insert into public.materia (nombre, codigo) values (repeat('a', 121), 'ZZZZ-5502')$$),
  '23514:nombre', 'Nombre de 121 caracteres: 23514');
select is(
  pg_temp.resultado_de($$insert into public.materia (nombre, codigo) values (repeat('a', 120), 'ZZZZ-5503')$$),
  'ok', 'Nombre de 120 caracteres: pasa');
select is(
  pg_temp.resultado_de($$insert into public.materia (nombre, codigo) values ('Código corto', 'ZZ-1')$$),
  '23514:codigo', 'ZZ-1: 23514 con el hint del código');
select is(
  pg_temp.resultado_de($$insert into public.materia (nombre, codigo) values ('Código corto', 'ABCD-12')$$),
  '23514:codigo', 'ABCD-12: 23514');
select is(
  pg_temp.resultado_de($$insert into public.materia (nombre, codigo) values ('Con tilde', 'ÁBCD-1234')$$),
  '23514:codigo', 'ÁBCD-1234: 23514 (solo letras sin tilde)');
select is(
  pg_temp.resultado_de($$insert into public.materia (nombre, codigo) values ('Cinco dígitos', 'ABCD-12345')$$),
  '23514:codigo', 'ABCD-12345: 23514');
select is(
  pg_temp.resultado_de($$insert into public.materia (nombre, codigo) values ('Repetida', ' zzzz-5501')$$),
  '23505:', 'Un código que solo difiere en mayúsculas y espacios: 23505');
select is(
  pg_temp.resultado_de($$insert into public.materia (nombre, codigo, carpeta) values ('Con carpeta', 'ZZZZ-5504', 'x')$$),
  '42501:', 'Un admin no escribe la carpeta (permiso de columna)');
select is(
  pg_temp.resultado_de($$insert into public.materia (nombre, codigo, editada_en_app) values ('Con marca', 'ZZZZ-5505', false)$$),
  '42501:', 'Un admin no escribe la marca (permiso de columna)');

-- Editar el nombre y el código de una materia
select is(
  pg_temp.resultado_de($$update public.materia set nombre = 'Nombre original', codigo = 'PRB-5521' where id = '10000000-0000-0000-0000-000000005521'$$),
  'ok', 'Guardar una materia sin cambiar nada pasa, aunque su código no tenga forma Uniandes');
select results_eq(
  $$select nombre, codigo, editada_en_app from public.materia where id = '10000000-0000-0000-0000-000000005521'$$,
  $$values ('Nombre original'::text, 'PRB-5521'::text, false)$$,
  'Guardar el mismo valor no marca la materia');
select lives_ok(
  $$update public.materia set nombre = '  Nombre original  ' where id = '10000000-0000-0000-0000-000000005521'$$,
  'Guardar el mismo nombre con espacios en los bordes pasa');
select results_eq(
  $$select nombre, editada_en_app from public.materia where id = '10000000-0000-0000-0000-000000005521'$$,
  $$values ('Nombre original'::text, false)$$,
  'El nombre con espacios de más no cuenta como cambio: queda el guardado y la marca sigue falsa');
select lives_ok(
  $$update public.materia set nombre = ' Nombre nuevo ' where id = '10000000-0000-0000-0000-000000005521'$$,
  'Cambiar el nombre pasa');
select results_eq(
  $$select nombre, codigo, editada_en_app from public.materia where id = '10000000-0000-0000-0000-000000005521'$$,
  $$values ('Nombre nuevo'::text, 'PRB-5521'::text, true)$$,
  'Cambiar el nombre lo recorta, marca la materia y no toca el código');
select lives_ok(
  $$update public.materia set codigo = ' zzzz-5522 ' where id = '10000000-0000-0000-0000-000000005522'$$,
  'Cambiar el código a uno con forma Uniandes (en minúsculas y con espacios) pasa');
select results_eq(
  $$select nombre, codigo, editada_en_app from public.materia where id = '10000000-0000-0000-0000-000000005522'$$,
  $$values ('Cambia el código'::text, 'ZZZZ-5522'::text, true)$$,
  'Cambiar el código lo normaliza, marca la materia y no toca el nombre');
select is(
  pg_temp.resultado_de($$update public.materia set codigo = 'XX-1' where id = '10000000-0000-0000-0000-000000005523'$$),
  '23514:codigo', 'Cambiar el código a uno sin forma: 23514');
select is(
  pg_temp.resultado_de($$update public.materia set codigo = ' zzzz-5501' where id = '10000000-0000-0000-0000-000000005523'$$),
  '23505:', 'Cambiar el código al de otra materia: 23505');
select is(
  pg_temp.resultado_de($$update public.materia set nombre = 'Otro nombre', codigo = 'PRB-5523' where id = '10000000-0000-0000-0000-000000005523'$$),
  'ok', 'Cambiar solo el nombre de una materia con código sin forma pasa (el app manda los dos campos)');
select results_eq(
  $$select nombre, codigo, editada_en_app from public.materia where id = '10000000-0000-0000-0000-000000005523'$$,
  $$values ('Otro nombre'::text, 'PRB-5523'::text, true)$$,
  'El código sin forma queda como estaba y el nombre nuevo marca la materia');
select is(
  pg_temp.resultado_de($$update public.materia set codigo = 'PRB-5524' where id = '10000000-0000-0000-0000-000000005524'$$),
  'ok', 'Reenviar normalizado el código histórico de una materia pasa');
select results_eq(
  $$select nombre, codigo, editada_en_app from public.materia where id = '10000000-0000-0000-0000-000000005524'$$,
  $$values (' Código histórico '::text, ' prb-5524 '::text, false)$$,
  'El código histórico y el nombre quedan como estaban guardados (con sus espacios) y la materia no se marca');
select is(
  pg_temp.resultado_de($$update public.materia set nombre = 'Histórica corregida', codigo = 'PRB-5524' where id = '10000000-0000-0000-0000-000000005524'$$),
  'ok', 'Cambiar solo el nombre de la materia de código histórico pasa');
select results_eq(
  $$select nombre, codigo, editada_en_app from public.materia where id = '10000000-0000-0000-0000-000000005524'$$,
  $$values ('Histórica corregida'::text, ' prb-5524 '::text, true)$$,
  'Su código histórico no se reescribe y el nombre nuevo la marca');
select is(
  pg_temp.resultado_de($$update public.materia set codigo = 'ZZZZ-5525' where id = '10000000-0000-0000-0000-000000005525'$$),
  'ok', 'Cambiar el código de una materia con un nombre de más de 120 caracteres pasa');
select results_eq(
  $$select char_length(nombre), codigo, editada_en_app from public.materia where id = '10000000-0000-0000-0000-000000005525'$$,
  $$values (130, 'ZZZZ-5525'::text, true)$$,
  'Su nombre largo no se reescribe ni se rechaza');
select is(
  pg_temp.resultado_de($$update public.materia set nombre = nombre || 'x' where id = '10000000-0000-0000-0000-000000005525'$$),
  '23514:nombre', 'Pero cambiar ese nombre a otro de más de 120 caracteres sí se rechaza');
select is(
  pg_temp.resultado_de($$update public.materia set nombre = '  ' where id = '10000000-0000-0000-0000-000000005526'$$),
  '23514:nombre', 'Cambiar el nombre a uno vacío: 23514');
select is(
  pg_temp.resultado_de($$update public.materia set nombre = E'\t' where id = '10000000-0000-0000-0000-000000005526'$$),
  '23514:nombre', 'Cambiar el nombre a un tabulador: 23514');
select is(
  pg_temp.resultado_de($$update public.materia set nombre = 'Con blancos', codigo = 'PRB-5529' where id = '10000000-0000-0000-0000-000000005529'$$),
  'ok', 'Reenviar recortados el nombre y el código que se guardaron con tabulador y salto de línea pasa');
select results_eq(
  $$select nombre, codigo, editada_en_app from public.materia where id = '10000000-0000-0000-0000-000000005529'$$,
  $$values (E'\tCon blancos\n'::text, E'\tprb-5529\n'::text, false)$$,
  'Lo guardado con blancos en los bordes no cuenta como cambio: queda como estaba y la materia no se marca');

-- Lo que un admin no toca en una materia
select is(
  pg_temp.resultado_de($$update public.materia set carpeta = 'x' where id = '10000000-0000-0000-0000-000000005526'$$),
  '42501:', 'Un admin no cambia la carpeta');
select is(
  pg_temp.resultado_de($$update public.materia set editada_en_app = false where id = '10000000-0000-0000-0000-000000005522'$$),
  '42501:', 'Un admin no baja la marca');
select is(
  pg_temp.resultado_de($$update public.materia set id = gen_random_uuid() where id = '10000000-0000-0000-0000-000000005526'$$),
  '42501:', 'Un admin no cambia el id');
select is(
  pg_temp.resultado_de($$delete from public.materia where id = '10000000-0000-0000-0000-000000005508'$$),
  '42501:', 'Un admin no borra una materia directo (es con la función)');

-- Evaluaciones: nombre y semana
select lives_ok(
  $$update public.evaluacion set nombre = '  Parcial uno  ' where id = '20000000-0000-0000-0000-000000005521'$$,
  'Un admin cambia el nombre de una evaluación');
select results_eq(
  $$select nombre, semana, editada_en_app from public.evaluacion where id = '20000000-0000-0000-0000-000000005521'$$,
  $$values ('Parcial uno'::text, 3, true)$$,
  'El nombre queda recortado y la evaluación marcada');
select lives_ok(
  $$update public.evaluacion set semana = 7 where id = '20000000-0000-0000-0000-000000005522'$$,
  'Un admin cambia la semana de una evaluación');
select results_eq(
  $$select nombre, semana, editada_en_app from public.evaluacion where id = '20000000-0000-0000-0000-000000005522'$$,
  $$values ('Parcial 2'::text, 7, true)$$,
  'Cambiar solo la semana también marca la evaluación');
select lives_ok(
  $$update public.evaluacion set nombre = '  Parcial 3  ', semana = 9 where id = '20000000-0000-0000-0000-000000005523'$$,
  'Guardar una evaluación con lo mismo (el nombre con espacios) pasa');
select results_eq(
  $$select nombre, semana, editada_en_app from public.evaluacion where id = '20000000-0000-0000-0000-000000005523'$$,
  $$values (' Parcial 3 '::text, 9, false)$$,
  'Sin cambios reales la evaluación no se marca y queda el nombre guardado, con sus espacios');
select is(
  pg_temp.resultado_de($$update public.evaluacion set semana = 0 where id = '20000000-0000-0000-0000-000000005524'$$),
  '23514:', 'Semana 0: 23514 (la exige la restricción de la tabla)');
select is(
  pg_temp.resultado_de($$update public.evaluacion set nombre = '' where id = '20000000-0000-0000-0000-000000005524'$$),
  '23514:nombre', 'Nombre de evaluación vacío: 23514 con el hint del campo');
select is(
  pg_temp.resultado_de($$update public.evaluacion set nombre = E'\t' where id = '20000000-0000-0000-0000-000000005524'$$),
  '23514:nombre', 'Nombre de evaluación de solo un tabulador: 23514');
select is(
  pg_temp.resultado_de($$update public.evaluacion set nombre = chr(160) where id = '20000000-0000-0000-0000-000000005524'$$),
  '23514:nombre', 'Nombre de evaluación de solo un espacio de no separación: 23514');
select is(
  pg_temp.resultado_de($$update public.evaluacion set nombre = 'Parcial 5', semana = 15 where id = '20000000-0000-0000-0000-000000005525'$$),
  'ok', 'Reenviar recortado el nombre de una evaluación guardado con tabulador y salto de línea pasa');
select results_eq(
  $$select nombre, semana, editada_en_app from public.evaluacion where id = '20000000-0000-0000-0000-000000005525'$$,
  $$values (E'\tParcial 5\n'::text, 15, false)$$,
  'Lo guardado con blancos en los bordes no cuenta como cambio: queda como estaba y la evaluación no se marca');
select is(
  pg_temp.resultado_de($$update public.evaluacion set nombre = repeat('a', 121) where id = '20000000-0000-0000-0000-000000005524'$$),
  '23514:nombre', 'Nombre de evaluación de 121 caracteres: 23514');
select is(
  pg_temp.resultado_de($$update public.evaluacion set activa = true where id = '20000000-0000-0000-0000-000000005524'$$),
  '42501:', 'Un admin no cambia si una evaluación está activa');
select is(
  pg_temp.resultado_de($$update public.evaluacion set clave = 'otra' where id = '20000000-0000-0000-0000-000000005524'$$),
  '42501:', 'Un admin no cambia la clave de una evaluación');
select is(
  pg_temp.resultado_de($$update public.evaluacion set acumulativo = true where id = '20000000-0000-0000-0000-000000005524'$$),
  '42501:', 'Un admin no cambia si una evaluación es acumulativa');
select is(
  pg_temp.resultado_de($$update public.evaluacion set editada_en_app = false where id = '20000000-0000-0000-0000-000000005521'$$),
  '42501:', 'Un admin no baja la marca de una evaluación');
select is(
  pg_temp.resultado_de($$delete from public.evaluacion where id = '20000000-0000-0000-0000-000000005524'$$),
  '42501:', 'Un admin no borra una evaluación directo (es con la función)');
select is(
  pg_temp.resultado_de($$insert into public.evaluacion (id_materia, semana, nombre) values ('10000000-0000-0000-0000-000000005527', 1, 'Nueva')$$),
  '42501:', 'Un admin no crea evaluaciones (las trae el banco)');

reset role;

-- ---------------------------------------------------------------------------
-- 5. Quién no escribe ni se entera de lo ligado: monitor, Lead, sesión anónima y admin desactivado (criterios 10 y 17)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-000000005501","role":"authenticated"}';
select is(
  pg_temp.resultado_de($$insert into public.materia (nombre, codigo) values ('Del monitor', 'ZZZZ-5530')$$),
  '42501:', 'Monitor: no crea una materia');
select is(
  pg_temp.filas_de($$update public.materia set nombre = 'Del monitor' where id = '10000000-0000-0000-0000-000000005526'$$),
  0, 'Monitor: no cambia una materia (cero filas)');
select is(
  pg_temp.filas_de($$update public.evaluacion set nombre = 'Del monitor' where id = '20000000-0000-0000-0000-000000005524'$$),
  0, 'Monitor: no cambia una evaluación (cero filas)');
select is(public.ligado_de_materia('10000000-0000-0000-0000-000000005509')::text, '{}',
  'Monitor: no se entera de lo que tiene ligado una materia');
select is(public.ligado_de_evaluacion('20000000-0000-0000-0000-000000005509')::text, '{}',
  'Monitor: no se entera de lo que tiene ligado una evaluación');
select is(public.borrar_materia('10000000-0000-0000-0000-000000005508'), 'no_autorizado', 'Monitor: no borra una materia');
select is(public.borrar_evaluacion('20000000-0000-0000-0000-000000005512'), 'no_autorizado', 'Monitor: no borra una evaluación');
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000005501","role":"authenticated","is_anonymous":true}';
select is(
  pg_temp.resultado_de($$insert into public.materia (nombre, codigo) values ('Del Lead', 'ZZZZ-5530')$$),
  '42501:', 'Lead: no crea una materia');
select is(
  pg_temp.filas_de($$update public.materia set nombre = 'Del Lead' where id = '10000000-0000-0000-0000-000000005526'$$),
  0, 'Lead: no cambia una materia (cero filas)');
select is(
  pg_temp.filas_de($$update public.evaluacion set nombre = 'Del Lead' where id = '20000000-0000-0000-0000-000000005524'$$),
  0, 'Lead: no cambia una evaluación (cero filas)');
select is(public.ligado_de_materia('10000000-0000-0000-0000-000000005509')::text, '{}',
  'Lead: no se entera de lo que tiene ligado una materia');
select is(public.ligado_de_evaluacion('20000000-0000-0000-0000-000000005509')::text, '{}',
  'Lead: no se entera de lo que tiene ligado una evaluación');
select is(public.borrar_materia('10000000-0000-0000-0000-000000005508'), 'no_autorizado', 'Lead: no borra una materia');
select is(public.borrar_evaluacion('20000000-0000-0000-0000-000000005512'), 'no_autorizado', 'Lead: no borra una evaluación');
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000005502","role":"authenticated","is_anonymous":true}';
select is(
  pg_temp.resultado_de($$insert into public.materia (nombre, codigo) values ('De una sesión anónima', 'ZZZZ-5530')$$),
  '42501:', 'Sesión anónima: no crea una materia');
select is(
  pg_temp.filas_de($$update public.materia set nombre = 'De una sesión anónima' where id = '10000000-0000-0000-0000-000000005526'$$),
  0, 'Sesión anónima: no cambia una materia (cero filas)');
select is(
  pg_temp.filas_de($$update public.evaluacion set nombre = 'De una sesión anónima' where id = '20000000-0000-0000-0000-000000005524'$$),
  0, 'Sesión anónima: no cambia una evaluación (cero filas)');
select is(public.ligado_de_materia('10000000-0000-0000-0000-000000005509')::text, '{}',
  'Sesión anónima: no se entera de lo que tiene ligado una materia');
select is(public.ligado_de_evaluacion('20000000-0000-0000-0000-000000005509')::text, '{}',
  'Sesión anónima: no se entera de lo que tiene ligado una evaluación');
select is(public.borrar_materia('10000000-0000-0000-0000-000000005508'), 'no_autorizado', 'Sesión anónima: no borra una materia');
select is(public.borrar_evaluacion('20000000-0000-0000-0000-000000005512'), 'no_autorizado', 'Sesión anónima: no borra una evaluación');
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-00000000550d","role":"authenticated"}';
select is(
  pg_temp.resultado_de($$insert into public.materia (nombre, codigo) values ('Del desactivado', 'ZZZZ-5530')$$),
  '42501:', 'Admin desactivado: no crea una materia');
select is(
  pg_temp.filas_de($$update public.materia set nombre = 'Del desactivado' where id = '10000000-0000-0000-0000-000000005526'$$),
  0, 'Admin desactivado: no cambia una materia (cero filas)');
select is(
  pg_temp.filas_de($$update public.evaluacion set nombre = 'Del desactivado' where id = '20000000-0000-0000-0000-000000005524'$$),
  0, 'Admin desactivado: no cambia una evaluación (cero filas)');
select is(public.ligado_de_materia('10000000-0000-0000-0000-000000005509')::text, '{}',
  'Admin desactivado: no se entera de lo que tiene ligado una materia');
select is(public.ligado_de_evaluacion('20000000-0000-0000-0000-000000005509')::text, '{}',
  'Admin desactivado: no se entera de lo que tiene ligado una evaluación');
select is(public.borrar_materia('10000000-0000-0000-0000-000000005508'), 'no_autorizado', 'Admin desactivado: no borra una materia');
select is(public.borrar_evaluacion('20000000-0000-0000-0000-000000005512'), 'no_autorizado', 'Admin desactivado: no borra una evaluación');
reset role;

-- Con el rol authenticated pero sin usuario (un pedido sin `sub`): no es una sesión de verdad. El trigger no actúa (un código sin
-- forma no da 23514) y la política rechaza.
set local role authenticated;
set local request.jwt.claims to '{"role":"authenticated"}';
select is(
  pg_temp.resultado_de($$insert into public.materia (nombre, codigo) values ('Sin usuario', 'ZZ-1')$$),
  '42501:', 'Rol authenticated sin usuario: no crea una materia, y la rechaza la política y no el trigger');
reset role;

-- Sin sesión (anon): ni escribe ni ejecuta las funciones.
set local role anon;
set local request.jwt.claims to '';
select throws_ok(
  $$insert into public.materia (nombre, codigo) values ('Sin sesión', 'ZZZZ-5531')$$,
  '42501', null, 'Sin sesión no se crea una materia');
select throws_ok(
  $$update public.materia set nombre = 'Sin sesión' where id = '10000000-0000-0000-0000-000000005526'$$,
  '42501', null, 'Sin sesión no se cambia una materia');
select throws_ok(
  $$update public.evaluacion set nombre = 'Sin sesión' where id = '20000000-0000-0000-0000-000000005524'$$,
  '42501', null, 'Sin sesión no se cambia una evaluación');
select throws_ok($$select public.ligado_de_materia('10000000-0000-0000-0000-000000005509')$$,
  '42501', null, 'Sin sesión no se ejecuta ligado_de_materia');
select throws_ok($$select public.ligado_de_evaluacion('20000000-0000-0000-0000-000000005509')$$,
  '42501', null, 'Sin sesión no se ejecuta ligado_de_evaluacion');
select throws_ok($$select public.borrar_materia('10000000-0000-0000-0000-000000005508')$$,
  '42501', null, 'Sin sesión no se ejecuta borrar_materia');
select throws_ok($$select public.borrar_evaluacion('20000000-0000-0000-0000-000000005512')$$,
  '42501', null, 'Sin sesión no se ejecuta borrar_evaluacion');
reset role;

select results_eq(
  $$select nombre from public.materia where id = '10000000-0000-0000-0000-000000005526'$$,
  $$values ('Intocable'::text)$$,
  'Después de todos los intentos, la materia intocable sigue igual');
select is(
  (select count(*)::int from public.materia where id in ('10000000-0000-0000-0000-000000005508', '10000000-0000-0000-0000-000000005510')),
  2, 'Y las materias vacías siguen ahí: nadie sin permiso borró nada');
select is(
  (select count(*)::int from public.evaluacion where id = '20000000-0000-0000-0000-000000005512'),
  1, 'Y la evaluación vacía también');

-- ---------------------------------------------------------------------------
-- 6. Escritura de confianza: la carga y la semilla (postgres), la llave secreta (service_role) y los fixtures de otras
--    pruebas (postgres con los claims de un usuario todavía puestos). Ninguna normaliza, valida ni marca (criterio 8).
-- ---------------------------------------------------------------------------
-- Forma 1: postgres sin claims.
set local request.jwt.claims to '';
insert into public.materia (id, nombre, codigo) values ('10000000-0000-0000-0000-000000005531', '  Con espacios  ', 'prb-5531');
update public.materia set nombre = ' Otro nombre ' where id = '10000000-0000-0000-0000-000000005531';
insert into public.evaluacion (id, id_materia, semana, nombre) values
  ('20000000-0000-0000-0000-000000005531', '10000000-0000-0000-0000-000000005527', 4, '  Con espacios  ');
update public.evaluacion set nombre = ' Otro nombre ', semana = 5 where id = '20000000-0000-0000-0000-000000005531';
select results_eq(
  $$select nombre, codigo, editada_en_app from public.materia where id = '10000000-0000-0000-0000-000000005531'$$,
  $$values (' Otro nombre '::text, 'prb-5531'::text, false)$$,
  'Postgres sin claims: la materia se guarda tal cual, también al actualizar, y no se marca');
select results_eq(
  $$select nombre, semana, editada_en_app from public.evaluacion where id = '20000000-0000-0000-0000-000000005531'$$,
  $$values (' Otro nombre '::text, 5, false)$$,
  'Postgres sin claims: la evaluación se guarda tal cual, también al actualizar, y no se marca');

-- Forma 2: service_role con los claims de un usuario (la llave secreta no marca aunque el pedido traiga sesión).
set local role service_role;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-00000000550a","role":"authenticated"}';
insert into public.materia (id, nombre, codigo) values ('10000000-0000-0000-0000-000000005532', '  Con espacios  ', 'prb-5532');
update public.materia set nombre = ' Otro nombre ' where id = '10000000-0000-0000-0000-000000005532';
insert into public.evaluacion (id, id_materia, semana, nombre) values
  ('20000000-0000-0000-0000-000000005532', '10000000-0000-0000-0000-000000005527', 4, '  Con espacios  ');
update public.evaluacion set nombre = ' Otro nombre ', semana = 5 where id = '20000000-0000-0000-0000-000000005532';
reset role;
select results_eq(
  $$select nombre, codigo, editada_en_app from public.materia where id = '10000000-0000-0000-0000-000000005532'$$,
  $$values (' Otro nombre '::text, 'prb-5532'::text, false)$$,
  'service_role con claims: la materia se guarda tal cual y no se marca');
select results_eq(
  $$select nombre, semana, editada_en_app from public.evaluacion where id = '20000000-0000-0000-0000-000000005532'$$,
  $$values (' Otro nombre '::text, 5, false)$$,
  'service_role con claims: la evaluación se guarda tal cual y no se marca');

-- Forma 3: lo que dejan ocho pruebas existentes. Se prueba un permiso con el rol de un usuario, se vuelve a postgres con `reset role` y los
-- claims siguen puestos (`set local` dura toda la transacción), y los fixtures se insertan así. Con `auth.uid()` solo, esto fallaría.
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-00000000550a","role":"authenticated"}';
reset role;
select is((select current_user::text), 'postgres', 'Forma 3: el rol volvió a postgres');
select isnt((select auth.uid()), null, 'Forma 3: y auth.uid() sigue viendo el usuario (por eso no basta para decidir que hay sesión)');
insert into public.materia (id, nombre, codigo) values ('10000000-0000-0000-0000-000000005533', '  Con espacios  ', 'prb-5533');
update public.materia set nombre = ' Otro nombre ' where id = '10000000-0000-0000-0000-000000005533';
insert into public.evaluacion (id, id_materia, semana, nombre) values
  ('20000000-0000-0000-0000-000000005533', '10000000-0000-0000-0000-000000005527', 4, '  Con espacios  ');
update public.evaluacion set nombre = ' Otro nombre ', semana = 5 where id = '20000000-0000-0000-0000-000000005533';
select results_eq(
  $$select nombre, codigo, editada_en_app from public.materia where id = '10000000-0000-0000-0000-000000005533'$$,
  $$values (' Otro nombre '::text, 'prb-5533'::text, false)$$,
  'Forma 3: la materia se guarda tal cual (sin 23514 por el código) y no se marca');
select results_eq(
  $$select nombre, semana, editada_en_app from public.evaluacion where id = '20000000-0000-0000-0000-000000005533'$$,
  $$values (' Otro nombre '::text, 5, false)$$,
  'Forma 3: la evaluación se guarda tal cual y no se marca');
set local request.jwt.claims to '';

-- ---------------------------------------------------------------------------
-- 7. Lo ligado (criterios 12, 13 y 15)
-- ---------------------------------------------------------------------------
-- Cuántos hijos tiene la materia con tema antes de intentar borrarla (se mide como postgres: con sesión no se leen esas tablas).
create temporary table antes as
  select (select count(*) from public.tema where id_materia = '10000000-0000-0000-0000-000000005502') as temas,
         (select count(*) from public.habilidad where id_materia = '10000000-0000-0000-0000-000000005502') as habilidades,
         (select count(*) from public.pregunta where id_materia = '10000000-0000-0000-0000-000000005502') as preguntas,
         (select count(*) from public.opcion where id_materia = '10000000-0000-0000-0000-000000005502') as opciones;

set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-00000000550a","role":"authenticated"}';

select is(public.ligado_de_materia('10000000-0000-0000-0000-000000005501')::text, '{evaluaciones}', 'Una evaluación: {evaluaciones}');
select is(public.ligado_de_materia('10000000-0000-0000-0000-000000005502')::text, '{temas}', 'Un tema: {temas}');
select is(public.ligado_de_materia('10000000-0000-0000-0000-000000005503')::text, '{certificados}', 'Un certificado: {certificados}');
select is(public.ligado_de_materia('10000000-0000-0000-0000-000000005504')::text, '{solicitudes}', 'Una solicitud: {solicitudes}');
select is(public.ligado_de_materia('10000000-0000-0000-0000-000000005505')::text, '{evaluaciones,diagnosticos}',
  'Un diagnóstico (con su evaluación): {evaluaciones,diagnosticos}');
select is(public.ligado_de_materia('10000000-0000-0000-0000-000000005506')::text, '{certificados,monitorias}',
  'Una monitoría cancelada cuenta: {certificados,monitorias}');
select is(public.ligado_de_materia('10000000-0000-0000-0000-000000005507')::text, '{certificados,monitorias}',
  'Una monitoría pendiente_pago con la reserva vencida cuenta: {certificados,monitorias}');
select is(public.ligado_de_materia('10000000-0000-0000-0000-000000005509')::text,
  '{evaluaciones,temas,certificados,solicitudes,diagnosticos,monitorias}', 'Con los seis hijos: la lista completa, en el orden fijo');
-- La materia vacía se consulta con otra materia de la misma prueba que lo tiene todo: una consulta sin su `where id_materia = p_id` lo vería.
select is(public.ligado_de_materia('10000000-0000-0000-0000-000000005508')::text, '{}', 'Una materia vacía: {}');
select is(public.ligado_de_materia('99999999-9999-9999-9999-999999999999')::text, '{}', 'Una materia que no existe: {}');

select is(public.ligado_de_evaluacion('20000000-0000-0000-0000-000000005510')::text, '{temas}', 'Una evaluación con temas: {temas}');
select is(public.ligado_de_evaluacion('20000000-0000-0000-0000-000000005511')::text, '{diagnosticos}',
  'Una evaluación con un diagnóstico: {diagnosticos}');
select is(public.ligado_de_evaluacion('20000000-0000-0000-0000-000000005509')::text, '{temas,diagnosticos}',
  'Con temas y diagnósticos: {temas,diagnosticos}');
-- La hermana (misma materia que otra con diagnóstico y temas) sin nada propio: la consulta mira id_evaluacion, no id_materia.
select is(public.ligado_de_evaluacion('20000000-0000-0000-0000-000000005512')::text, '{}',
  'Una evaluación vacía, hermana de otras ligadas: {}');
select is(public.ligado_de_evaluacion('20000000-0000-0000-0000-000000005513')::text, '{}',
  'Un diagnóstico en curso no cuenta como ligado: {}');

-- ---------------------------------------------------------------------------
-- 8. Borrar (criterios 12 a 17)
-- ---------------------------------------------------------------------------
select is(public.borrar_materia('10000000-0000-0000-0000-000000005501'), 'ligada:evaluaciones', 'No borra una materia con una evaluación');
select is(public.borrar_materia('10000000-0000-0000-0000-000000005502'), 'ligada:temas', 'No borra una materia con un tema');
select is(public.borrar_materia('10000000-0000-0000-0000-000000005503'), 'ligada:certificados', 'No borra una materia con un certificado');
select is(public.borrar_materia('10000000-0000-0000-0000-000000005504'), 'ligada:solicitudes', 'No borra una materia con una solicitud');
select is(public.borrar_materia('10000000-0000-0000-0000-000000005505'), 'ligada:evaluaciones,diagnosticos',
  'No borra una materia con un diagnóstico');
select is(public.borrar_materia('10000000-0000-0000-0000-000000005506'), 'ligada:certificados,monitorias',
  'No borra una materia con una monitoría cancelada');
select is(public.borrar_materia('10000000-0000-0000-0000-000000005507'), 'ligada:certificados,monitorias',
  'No borra una materia con una reserva vencida');
select is(public.borrar_materia('10000000-0000-0000-0000-000000005509'),
  'ligada:evaluaciones,temas,certificados,solicitudes,diagnosticos,monitorias', 'No borra una materia con los seis hijos');
select is(
  (select count(*)::int from public.materia where id in
    ('10000000-0000-0000-0000-000000005501', '10000000-0000-0000-0000-000000005502', '10000000-0000-0000-0000-000000005503',
     '10000000-0000-0000-0000-000000005504', '10000000-0000-0000-0000-000000005505', '10000000-0000-0000-0000-000000005506',
     '10000000-0000-0000-0000-000000005507', '10000000-0000-0000-0000-000000005509')),
  8, 'Las ocho materias con algo ligado siguen ahí');

select is(public.borrar_materia('99999999-9999-9999-9999-999999999999'), 'no_existe', 'Una materia que no existe: no_existe');
select is(public.borrar_materia(null), 'no_existe', 'Un id nulo: no_existe');
select is(public.borrar_evaluacion('99999999-9999-9999-9999-999999999999'), 'no_existe', 'Una evaluación que no existe: no_existe');

select is(public.borrar_evaluacion('20000000-0000-0000-0000-000000005510'), 'ligada:temas', 'No borra una evaluación con temas');
select is(public.borrar_evaluacion('20000000-0000-0000-0000-000000005511'), 'ligada:diagnosticos', 'No borra una evaluación con un diagnóstico');
select is(public.borrar_evaluacion('20000000-0000-0000-0000-000000005509'), 'ligada:temas,diagnosticos',
  'No borra una evaluación con temas y diagnósticos');
select is(
  (select count(*)::int from public.evaluacion where id_materia = '10000000-0000-0000-0000-000000005509'),
  5, 'Las cinco evaluaciones de la materia con todo siguen ahí');

-- Borra lo que no tiene nada: la materia vacía y la evaluación vacía, y nada más.
select is(public.borrar_materia('10000000-0000-0000-0000-000000005510'), 'borrada', 'Borra una materia vacía');
select is((select count(*)::int from public.materia where id = '10000000-0000-0000-0000-000000005510'), 0, 'La materia borrada ya no está');
select is(
  (select count(*)::int from public.materia where id in
    ('10000000-0000-0000-0000-000000005501', '10000000-0000-0000-0000-000000005502', '10000000-0000-0000-0000-000000005503',
     '10000000-0000-0000-0000-000000005504', '10000000-0000-0000-0000-000000005505', '10000000-0000-0000-0000-000000005506',
     '10000000-0000-0000-0000-000000005507', '10000000-0000-0000-0000-000000005508', '10000000-0000-0000-0000-000000005509',
     '10000000-0000-0000-0000-000000005521', '10000000-0000-0000-0000-000000005522', '10000000-0000-0000-0000-000000005523',
     '10000000-0000-0000-0000-000000005524', '10000000-0000-0000-0000-000000005525', '10000000-0000-0000-0000-000000005526',
     '10000000-0000-0000-0000-000000005527', '10000000-0000-0000-0000-000000005528')),
  17, 'Las demás materias siguen ahí (el delete lleva su where)');
select is(public.borrar_evaluacion('20000000-0000-0000-0000-000000005512'), 'borrada', 'Borra una evaluación vacía');
select is(
  (select count(*)::int from public.evaluacion where id_materia = '10000000-0000-0000-0000-000000005509'),
  4, 'La evaluación borrada ya no está y sus cuatro hermanas siguen');
select is(public.borrar_evaluacion('20000000-0000-0000-0000-000000005513'), 'borrada',
  'Borra una evaluación que solo tenía un diagnóstico en curso');

reset role;

-- Lo que con sesión no se lee, como postgres.
-- La guarda contra la cascada: borrar la materia con tema perdería en silencio sus temas, habilidades, preguntas y opciones.
select results_eq(
  $$select (select count(*) from public.tema where id_materia = '10000000-0000-0000-0000-000000005502'),
           (select count(*) from public.habilidad where id_materia = '10000000-0000-0000-0000-000000005502'),
           (select count(*) from public.pregunta where id_materia = '10000000-0000-0000-0000-000000005502'),
           (select count(*) from public.opcion where id_materia = '10000000-0000-0000-0000-000000005502')$$,
  $$select temas, habilidades, preguntas, opciones from antes$$,
  'Los temas, habilidades, preguntas y opciones de la materia con tema no cambiaron');
select is(
  (select count(*)::int from public.evaluacion_tema where id_evaluacion in
    ('20000000-0000-0000-0000-000000005509', '20000000-0000-0000-0000-000000005510')),
  2, 'Los temas de las evaluaciones ligadas siguen en evaluacion_tema');
select is(
  (select count(*)::int from public.diagnostico_en_curso where id_evaluacion = '20000000-0000-0000-0000-000000005513'),
  0, 'El diagnóstico en curso se fue con su evaluación (HU-081, en cascada)');
select is(
  (select count(*)::int from public.diagnostico where id in
    ('60000000-0000-0000-0000-000000005505', '60000000-0000-0000-0000-000000005509', '60000000-0000-0000-0000-000000005511')),
  3, 'Los diagnósticos siguen ahí');

-- ---------------------------------------------------------------------------
-- 9. Guarda de llaves nuevas
-- ---------------------------------------------------------------------------
-- Si una HU futura agrega una llave foránea hacia `materia` o `evaluacion`, esta prueba falla: hay que decidir si cuenta como ligado y
-- sumar su término a privado.ligado_de_materia / ligado_de_evaluacion (y a esta lista).
select is(
  pg_temp.llaves_hacia('public.materia'),
  'public.certificado,public.evaluacion,public.solicitud_monitor_materia,public.tema',
  'Las tablas con llave hacia materia son las que ligado_de_materia conoce');
select is(
  pg_temp.llaves_hacia('public.evaluacion'),
  'public.diagnostico,public.diagnostico_en_curso,public.evaluacion_tema',
  'Las tablas con llave hacia evaluacion son las que ligado_de_evaluacion conoce (diagnostico_en_curso, en cascada, no cuenta)');
-- Una tabla de verdad (la transacción termina en rollback): una temporal no puede tener una llave hacia una tabla permanente.
create table public.zz_llave_nueva_a_materia (id_materia uuid references public.materia (id));
create table public.zz_llave_nueva_a_evaluacion (id_evaluacion uuid references public.evaluacion (id));
select isnt(
  pg_temp.llaves_hacia('public.materia'),
  'public.certificado,public.evaluacion,public.solicitud_monitor_materia,public.tema',
  'Una llave nueva hacia materia cambia la lista y la guarda la detecta');
select isnt(
  pg_temp.llaves_hacia('public.evaluacion'),
  'public.diagnostico,public.diagnostico_en_curso,public.evaluacion_tema',
  'Una llave nueva hacia evaluacion cambia la lista y la guarda la detecta');

select * from finish();
rollback;
