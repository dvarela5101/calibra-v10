-- Pruebas pgTAP del servidor del diagnóstico (HU-081): el diagnóstico en curso, la foto del banco, las vistas antes, iniciar,
-- responder, terminar, la purga y quién lee qué.
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos. El proceso real de pg_cron no ve estas filas.
--
-- Lo que dependen de la hora se prueba con las versiones que reciben p_ahora y con un `ahora` fijo, A = martes 10 de marzo de 2020 a
-- las 12:00 en Bogotá. Está en el pasado a propósito, como en tope_de_correos.test.sql: ningún diagnóstico en curso que ya esté en la
-- base local (de una prueba de integración) es de antes de A, así que lo que devuelve la purga es exacto. Las puertas públicas usan
-- now(), que dentro de la transacción no cambia, y se prueban con su propia sesión.
-- Lo que no cabe en una transacción (dos conexiones a la vez: terminar contra registrar_lead, iniciar contra iniciar, responder
-- contra la purga) lo cubre integracion/diagnostico.test.ts. Aquí se prueba que cada función toma su candado por sesión (pg_locks).
--
-- Elenco (ids terminados en 81NN):
--   sesiones c0000000-...-81NN: 01 flujo de iniciar, 02 y 03 bordes de las 2 horas, 04 creó el Lead 1, 05 confirmó su correo (lead_sesion),
--     06 cuenta de Estudiante del Lead 1, 07 creó el Lead 2, 08 empate de fecha, 09 respuestas con elementos raros, 10 y 11 reemplazo
--     entre dos sesiones, 12 responder, 13 terminar sin Lead, 14 candado de iniciar, 15 candado de terminar, 16 puertas públicas,
--     17 a 20 purga, 21 a 23 lectura vigente, 24 terminar que no aplica, 25 checks de las tablas, 26 terminar con un check roto.
--   admin a0000000-...-8101 y monitor b0000000-...-8101. Leads 40000000-...-8101 (sesiones 04, 05 y 06) y -8102 (sesión 07).
--   materia A 10000000-...-8101 ('PGTAP-81') y B -8102; evaluaciones 20000000-...-81NN: 01 «Parcial 2» (acumulativa: temas 1 y 2),
--     02 inactiva, 03 «Parcial 1» (tema 1), 04 de la materia B. Temas 50000000-...-81NN: 01 derivadas, 02 integrales, 03 vectores.
--   habilidades 60000000-...-81NN: 01 regla-cadena, 02 potencia (tema 1), 03 antiderivada (tema 2), 04 producto-punto y 05 suma-vectores
--     (materia B). Preguntas 80000000-...-81NN = P1 a P7 (P6 borrador, P7 retirada).
-- Los diagnósticos terminados de las pruebas de vistas son 60000000-...-81NN.

begin;
create extension if not exists pgtap with schema extensions;

select plan(286);

create temporary table ref as select timestamptz '2020-03-10 12:00-05' as a;
create temporary table r (k text, resultado text, id uuid);
-- Las puertas públicas se prueban como service_role y anotan aquí sus resultados.
grant select, insert on r to service_role;

-- ---------------------------------------------------------------------------
-- Fixtures (como postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, is_anonymous)
select ('c0000000-0000-0000-0000-0000000081' || lpad(n::text, 2, '0'))::uuid, n <> 6
from generate_series(1, 26) n;
insert into auth.users (id, is_anonymous) values
  ('a0000000-0000-0000-0000-000000008101', false),
  ('b0000000-0000-0000-0000-000000008101', false);

insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-000000008101', 'Admin HU-081', 'admin81@example.com', 9000081);
insert into public.monitor (id, nombre) values
  ('b0000000-0000-0000-0000-000000008101', 'Monitor HU-081');

insert into public.materia (id, nombre, codigo) values
  ('10000000-0000-0000-0000-000000008101', 'Materia HU-081', 'PGTAP-81'),
  ('10000000-0000-0000-0000-000000008102', 'Otra materia HU-081', 'PGTAP-81-B');

insert into public.evaluacion (id, id_materia, semana, nombre) values
  ('20000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008101', 6, 'Parcial 2'),
  ('20000000-0000-0000-0000-000000008102', '10000000-0000-0000-0000-000000008101', 7, 'Parcial inactivo'),
  ('20000000-0000-0000-0000-000000008103', '10000000-0000-0000-0000-000000008101', 8, 'Parcial 1'),
  ('20000000-0000-0000-0000-000000008104', '10000000-0000-0000-0000-000000008102', 6, 'Parcial B');
update public.evaluacion set clave = 'parcial-2', activa = true, acumulativo = true where id = '20000000-0000-0000-0000-000000008101';
update public.evaluacion set clave = 'inactivo' where id = '20000000-0000-0000-0000-000000008102';
update public.evaluacion set clave = 'parcial-1', activa = true where id = '20000000-0000-0000-0000-000000008103';
update public.evaluacion set clave = 'parcial-b', activa = true where id = '20000000-0000-0000-0000-000000008104';

insert into public.tema (id, id_materia, clave, nombre, orden) values
  ('50000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008101', 'derivadas', 'Derivadas', 1),
  ('50000000-0000-0000-0000-000000008102', '10000000-0000-0000-0000-000000008101', 'integrales', 'Integrales', 2),
  ('50000000-0000-0000-0000-000000008103', '10000000-0000-0000-0000-000000008102', 'vectores', 'Vectores', 1);

insert into public.evaluacion_tema (id_evaluacion, id_tema, id_materia) values
  ('20000000-0000-0000-0000-000000008101', '50000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008101'),
  ('20000000-0000-0000-0000-000000008101', '50000000-0000-0000-0000-000000008102', '10000000-0000-0000-0000-000000008101'),
  ('20000000-0000-0000-0000-000000008102', '50000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008101'),
  ('20000000-0000-0000-0000-000000008103', '50000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008101'),
  ('20000000-0000-0000-0000-000000008104', '50000000-0000-0000-0000-000000008103', '10000000-0000-0000-0000-000000008102');

-- regla-cadena se inserta antes que potencia, y antiderivada (la primera por orden alfabético) es del segundo tema: el orden de la
-- foto no es el de inserción ni el alfabético, es tema.orden y luego clave.
insert into public.habilidad (id, id_materia, id_tema, clave, descripcion) values
  ('60000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008101', '50000000-0000-0000-0000-000000008101', 'regla-cadena', 'Derivar una función compuesta'),
  ('60000000-0000-0000-0000-000000008102', '10000000-0000-0000-0000-000000008101', '50000000-0000-0000-0000-000000008101', 'potencia', 'Derivar una potencia'),
  ('60000000-0000-0000-0000-000000008103', '10000000-0000-0000-0000-000000008101', '50000000-0000-0000-0000-000000008102', 'antiderivada', 'Hallar una antiderivada'),
  ('60000000-0000-0000-0000-000000008104', '10000000-0000-0000-0000-000000008102', '50000000-0000-0000-0000-000000008103', 'producto-punto', 'Calcular un producto punto'),
  ('60000000-0000-0000-0000-000000008105', '10000000-0000-0000-0000-000000008102', '50000000-0000-0000-0000-000000008103', 'suma-vectores', 'Sumar vectores');

-- regla-cadena pide potencia (de su materia) y suma-vectores (de otra); producto-punto pide suma-vectores (de su materia) y potencia (de otra).
insert into public.habilidad_prerrequisito (id_habilidad, id_prerrequisito) values
  ('60000000-0000-0000-0000-000000008101', '60000000-0000-0000-0000-000000008102'),
  ('60000000-0000-0000-0000-000000008101', '60000000-0000-0000-0000-000000008105'),
  ('60000000-0000-0000-0000-000000008104', '60000000-0000-0000-0000-000000008105'),
  ('60000000-0000-0000-0000-000000008104', '60000000-0000-0000-0000-000000008102');

insert into public.misconcepcion (id, id_materia, id_habilidad, clave, descripcion) values
  ('70000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008101', '60000000-0000-0000-0000-000000008101', 'olvida-cadena', 'Olvidas multiplicar por la derivada de adentro'),
  ('70000000-0000-0000-0000-000000008102', '10000000-0000-0000-0000-000000008101', '60000000-0000-0000-0000-000000008102', 'resta-uno', 'Restas uno al exponente dos veces'),
  ('70000000-0000-0000-0000-000000008103', '10000000-0000-0000-0000-000000008101', '60000000-0000-0000-0000-000000008103', 'integra-mal', 'Derivas en lugar de integrar');

-- Se insertan fuera de orden de clave (P5, P3, P1, P7, P4, P6, P2).
insert into public.pregunta (id, id_materia, id_tema, clave, enunciado, dificultad, estado, origen, revisor, solucion) values
  ('80000000-0000-0000-0000-000000008105', '10000000-0000-0000-0000-000000008101', '50000000-0000-0000-0000-000000008101', 'P5', 'Enunciado P5', 2, 'revisada', 'humano', 'prueba', null),
  ('80000000-0000-0000-0000-000000008103', '10000000-0000-0000-0000-000000008101', '50000000-0000-0000-0000-000000008101', 'P3', 'Enunciado P3', 3, 'revisada', 'humano', 'prueba', 'sol-P3'),
  ('80000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008101', '50000000-0000-0000-0000-000000008101', 'P1', 'Enunciado P1', 1, 'revisada', 'humano', 'prueba', 'sol-P1'),
  ('80000000-0000-0000-0000-000000008107', '10000000-0000-0000-0000-000000008101', '50000000-0000-0000-0000-000000008101', 'P7', 'Enunciado P7', 2, 'retirada', 'humano', null, null),
  ('80000000-0000-0000-0000-000000008104', '10000000-0000-0000-0000-000000008101', '50000000-0000-0000-0000-000000008102', 'P4', 'Enunciado P4', 2, 'revisada', 'humano', 'prueba', null),
  ('80000000-0000-0000-0000-000000008106', '10000000-0000-0000-0000-000000008101', '50000000-0000-0000-0000-000000008101', 'P6', 'Enunciado P6', 2, 'borrador', 'humano', null, null),
  ('80000000-0000-0000-0000-000000008102', '10000000-0000-0000-0000-000000008101', '50000000-0000-0000-0000-000000008101', 'P2', 'Enunciado P2', 2, 'revisada', 'humano', 'prueba', null);

-- P1 mide potencia; P2 regla-cadena; P3 las dos; P4 antiderivada (tema 2); P5 regla-cadena y antiderivada (una de fuera de «Parcial 1»).
insert into public.pregunta_habilidad (id_pregunta, id_habilidad, id_materia) values
  ('80000000-0000-0000-0000-000000008101', '60000000-0000-0000-0000-000000008102', '10000000-0000-0000-0000-000000008101'),
  ('80000000-0000-0000-0000-000000008102', '60000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008101'),
  ('80000000-0000-0000-0000-000000008103', '60000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008101'),
  ('80000000-0000-0000-0000-000000008103', '60000000-0000-0000-0000-000000008102', '10000000-0000-0000-0000-000000008101'),
  ('80000000-0000-0000-0000-000000008104', '60000000-0000-0000-0000-000000008103', '10000000-0000-0000-0000-000000008101'),
  ('80000000-0000-0000-0000-000000008105', '60000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008101'),
  ('80000000-0000-0000-0000-000000008105', '60000000-0000-0000-0000-000000008103', '10000000-0000-0000-0000-000000008101'),
  ('80000000-0000-0000-0000-000000008106', '60000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008101'),
  ('80000000-0000-0000-0000-000000008107', '60000000-0000-0000-0000-000000008102', '10000000-0000-0000-0000-000000008101');

-- Cuatro opciones por pregunta, insertadas D, B, A, C: A es la correcta; B, C y D delatan una misconcepción cada una; la C trae su error.
insert into public.opcion (id_pregunta, id_materia, letra, texto, correcta, id_misconcepcion, error)
select p.id, p.id_materia, l.letra, p.clave || '-' || l.letra, l.letra = 'A',
  case l.letra
    when 'B' then '70000000-0000-0000-0000-000000008101'::uuid
    when 'C' then '70000000-0000-0000-0000-000000008102'::uuid
    when 'D' then '70000000-0000-0000-0000-000000008103'::uuid
  end,
  case when l.letra = 'C' then 'error-' || p.clave end
from public.pregunta p
cross join (values ('D'), ('B'), ('A'), ('C')) as l(letra)
where p.id_materia = '10000000-0000-0000-0000-000000008101';

-- Leads: el 1 lo creó la sesión 04, la 05 confirmó su correo y la 06 es su cuenta de Estudiante; el 2 lo creó la sesión 07.
insert into public.lead (id, id_sesion_anonima, nombre, correo, acepta_tratamiento_datos, fecha_consentimiento) values
  ('40000000-0000-0000-0000-000000008101', 'c0000000-0000-0000-0000-000000008104', 'Lead Uno', 'lead81-1@example.com', true, now()),
  ('40000000-0000-0000-0000-000000008102', 'c0000000-0000-0000-0000-000000008107', 'Lead Dos', 'lead81-2@example.com', true, now());
insert into public.lead_sesion (id_sesion, id_lead) values
  ('c0000000-0000-0000-0000-000000008105', '40000000-0000-0000-0000-000000008101');
insert into public.estudiante (id, id_lead) values
  ('c0000000-0000-0000-0000-000000008106', '40000000-0000-0000-0000-000000008101');

-- Diagnósticos terminados para las vistas antes (todos completos: un paso o más, semilla, aciertos y resultado).
--   01: sesión 04 y Lead 1, Parcial 2, P1 y P2, hace 3 días         02: sesión 05 y Lead 1, Parcial 1, P3 y P5, hace 1 día
--   03: sesión 04 y Lead 1, materia B                                04: sesión 07 y Lead 2, Parcial 2, P4
--   05: sesión 01 sin Lead, Parcial 2, P1                            06: sesión 09 sin Lead, con elementos que no son pasos
--   08: sesión 04 y Lead 1, Parcial 2, P2, hace 5 días (más viejo que el 01)   71 y 72: sesión 08 sin Lead, Parcial 2, con la misma fecha
insert into public.diagnostico (id, id_lead, id_sesion_anonima, id_evaluacion, id_materia, respuestas, fecha_realizacion, puntaje, resultado_por_habilidad, semilla, aciertos)
select v.id::uuid, v.id_lead::uuid, v.sesion::uuid, v.evaluacion::uuid, v.materia::uuid, v.respuestas::jsonb, v.fecha::timestamptz,
  50, '{"habilidades":[],"errores":[],"prerrequisitos":[]}'::jsonb, 1, 0
from (values
  ('60000000-0000-0000-0000-000000008101', '40000000-0000-0000-0000-000000008101', 'c0000000-0000-0000-0000-000000008104',
   '20000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008101', '[{"clave":"P1"},{"clave":"P2"}]', (now() - interval '3 days')::text),
  ('60000000-0000-0000-0000-000000008102', '40000000-0000-0000-0000-000000008101', 'c0000000-0000-0000-0000-000000008105',
   '20000000-0000-0000-0000-000000008103', '10000000-0000-0000-0000-000000008101', '[{"clave":"P3"},{"clave":"P5"}]', (now() - interval '1 day')::text),
  ('60000000-0000-0000-0000-000000008103', '40000000-0000-0000-0000-000000008101', 'c0000000-0000-0000-0000-000000008104',
   '20000000-0000-0000-0000-000000008104', '10000000-0000-0000-0000-000000008102', '[{"clave":"PB1"}]', (now() - interval '1 hour')::text),
  ('60000000-0000-0000-0000-000000008104', '40000000-0000-0000-0000-000000008102', 'c0000000-0000-0000-0000-000000008107',
   '20000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008101', '[{"clave":"P4"}]', now()::text),
  ('60000000-0000-0000-0000-000000008105', null, 'c0000000-0000-0000-0000-000000008101',
   '20000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008101', '[{"clave":"P1"}]', now()::text),
  ('60000000-0000-0000-0000-000000008106', null, 'c0000000-0000-0000-0000-000000008109',
   '20000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008101', '[{"clave":"P1"},"clave",{"nada":1},null,5]', now()::text),
  ('60000000-0000-0000-0000-000000008171', null, 'c0000000-0000-0000-0000-000000008108',
   '20000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008101', '[{"clave":"P1"}]', '2026-01-01 10:00:00-05'),
  ('60000000-0000-0000-0000-000000008172', null, 'c0000000-0000-0000-0000-000000008108',
   '20000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008101', '[{"clave":"P2"}]', '2026-01-01 10:00:00-05'),
  ('60000000-0000-0000-0000-000000008108', '40000000-0000-0000-0000-000000008101', 'c0000000-0000-0000-0000-000000008104',
   '20000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008101', '[{"clave":"P2"}]', (now() - interval '5 days')::text)
) as v(id, id_lead, sesion, evaluacion, materia, respuestas, fecha);

-- Las funciones de HU-081 y quién puede ejecutarlas: la puerta pública (solo service_role), la que ejecuta el servidor con now() (solo
-- service_role) o el núcleo con p_ahora y las ayudas (nadie: no se elige la hora).
create temporary table funciones (firma text, grupo text);
insert into funciones values
  ('public.banco_de_la_evaluacion(uuid)', 'puerta'),
  ('public.vistas_de_la_sesion(uuid, uuid)', 'puerta'),
  ('public.diagnostico_en_curso_de(uuid)', 'puerta'),
  ('public.iniciar_diagnostico(uuid, uuid, bigint, text[], boolean, jsonb, jsonb)', 'puerta'),
  ('public.responder_diagnostico(uuid, uuid, integer, jsonb)', 'puerta'),
  ('public.terminar_diagnostico(uuid, uuid, integer, jsonb, jsonb, jsonb, integer, numeric)', 'puerta'),
  ('privado.diagnostico_en_curso_de_del_servidor(uuid)', 'servidor'),
  ('privado.iniciar_diagnostico_del_servidor(uuid, uuid, bigint, text[], boolean, jsonb, jsonb)', 'servidor'),
  ('privado.responder_diagnostico_del_servidor(uuid, uuid, integer, jsonb)', 'servidor'),
  ('privado.terminar_diagnostico_del_servidor(uuid, uuid, integer, jsonb, jsonb, jsonb, integer, numeric)', 'servidor'),
  ('privado.leads_de_la_sesion(uuid)', 'servidor'),
  ('privado.diagnostico_en_curso_de(uuid, timestamptz)', 'interna'),
  ('privado.iniciar_diagnostico(uuid, uuid, bigint, text[], boolean, jsonb, jsonb, timestamptz)', 'interna'),
  ('privado.responder_diagnostico(uuid, uuid, integer, jsonb, timestamptz)', 'interna'),
  ('privado.terminar_diagnostico(uuid, uuid, integer, jsonb, jsonb, jsonb, integer, numeric, timestamptz)', 'interna'),
  ('privado.purgar_diagnosticos_en_curso(timestamptz)', 'interna'),
  ('privado.vigencia_del_diagnostico_en_curso()', 'interna'),
  ('privado.lead_de_la_sesion(uuid)', 'interna');

-- ---------------------------------------------------------------------------
-- Estructura y permisos de diagnostico_en_curso
-- ---------------------------------------------------------------------------
select has_table('public', 'diagnostico_en_curso', 'Existe public.diagnostico_en_curso');
select columns_are('public', 'diagnostico_en_curso',
  array['id', 'id_sesion', 'id_evaluacion', 'id_materia', 'semilla', 'vistas_antes', 'repetido', 'candidatas', 'contexto', 'pasos', 'paso', 'iniciado_en', 'actualizado_en'],
  'Guarda la sesión, la Evaluación, la semilla, las vistas antes, la foto del banco y los pasos (sin id_monitoria: HU-039 lo agrega)');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.diagnostico_en_curso'::regclass),
  'La tabla tiene RLS');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'diagnostico_en_curso'),
  0, 'Sin políticas: ninguna sesión la lee (como las tablas del banco)');
select ok(
  not has_table_privilege('anon', 'public.diagnostico_en_curso', 'select, insert, update, delete, truncate, references, trigger')
  and not has_any_column_privilege('anon', 'public.diagnostico_en_curso', 'select, insert, update, references')
  and not has_table_privilege('authenticated', 'public.diagnostico_en_curso', 'select, insert, update, delete, truncate, references, trigger')
  and not has_any_column_privilege('authenticated', 'public.diagnostico_en_curso', 'select, insert, update, references'),
  'anon y authenticated no tienen ningún permiso sobre diagnostico_en_curso, ni por tabla ni por columna');
select ok(
  has_table_privilege('service_role', 'public.diagnostico_en_curso', 'select')
  and has_table_privilege('service_role', 'public.diagnostico_en_curso', 'insert')
  and has_table_privilege('service_role', 'public.diagnostico_en_curso', 'update')
  and has_table_privilege('service_role', 'public.diagnostico_en_curso', 'delete')
  and not has_table_privilege('service_role', 'public.diagnostico_en_curso', 'truncate, references, trigger'),
  'service_role lee y escribe el en curso, y no más (sin truncate, references ni trigger)');
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.diagnostico_en_curso'::regclass and contype = 'f'
      and confrelid = 'auth.users'::regclass and confdeltype = 'c')
  and exists (
    select 1 from pg_constraint
    where conrelid = 'public.diagnostico_en_curso'::regclass and contype = 'f' and conname = 'diagnostico_en_curso_evaluacion_fk'
      and confrelid = 'public.evaluacion'::regclass and confdeltype = 'c'),
  'La sesión y la Evaluación se borran en cascada: un en curso es efímero y no impide borrar ninguna de las dos');
select ok(
  exists (select 1 from pg_constraint where conname = 'diagnostico_en_curso_id_sesion_key' and contype = 'u'),
  'Una sola fila por sesión: id_sesion es única');
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'diagnostico_en_curso' and indexname = 'diagnostico_en_curso_actualizado_en_idx'
      and indexdef like '%(actualizado_en)')
  and exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'diagnostico_en_curso' and indexname = 'diagnostico_en_curso_id_evaluacion_idx'),
  'Existen el índice de la purga y el de la llave de la Evaluación');

-- ---------------------------------------------------------------------------
-- Estructura y permisos de las funciones
-- ---------------------------------------------------------------------------
select ok(to_regprocedure(firma) is not null, 'Existe ' || firma)
from funciones order by firma;

select ok(
  (select bool_and(not p.prosecdef) from funciones f join pg_proc p on p.oid = to_regprocedure(f.firma) where f.grupo = 'puerta'),
  'Las puertas públicas corren con los permisos de quien llama (security invoker): solo service_role llega');
select ok(
  (select bool_and(p.prosecdef) from funciones f join pg_proc p on p.oid = to_regprocedure(f.firma)
   where f.grupo <> 'puerta' and f.firma <> 'privado.vigencia_del_diagnostico_en_curso()'),
  'Las de privado que leen o escriben tablas son security definer');
select ok(
  (select bool_and(coalesce('search_path=""' = any(p.proconfig), false)) from funciones f join pg_proc p on p.oid = to_regprocedure(f.firma)),
  'Todas fijan un search_path vacío');
select is(
  (select array_agg(f.firma order by f.firma) from funciones f
   where f.grupo = 'puerta' and not (has_function_privilege('service_role', f.firma, 'execute')
     and not has_function_privilege('authenticated', f.firma, 'execute')
     and not has_function_privilege('anon', f.firma, 'execute'))),
  null::text[], 'Las seis puertas públicas solo las llama el servidor (service_role)');
select is(
  (select array_agg(f.firma order by f.firma) from funciones f
   where f.grupo = 'servidor' and not (has_function_privilege('service_role', f.firma, 'execute')
     and not has_function_privilege('authenticated', f.firma, 'execute')
     and not has_function_privilege('anon', f.firma, 'execute'))),
  null::text[], 'Las que ejecuta el servidor con now() y leads_de_la_sesion también, solo service_role');
select ok(has_schema_privilege('service_role', 'privado', 'usage'), 'service_role entra al esquema privado (las puertas llaman a las de privado)');
select is(
  (select array_agg(f.firma order by f.firma) from funciones f
   where f.grupo = 'interna' and (has_function_privilege('service_role', f.firma, 'execute')
     or has_function_privilege('authenticated', f.firma, 'execute')
     or has_function_privilege('anon', f.firma, 'execute'))),
  null::text[], 'Los núcleos con p_ahora, la purga y las ayudas no tienen grants: nadie elige la hora');
select ok(
  not exists (
    select 1
    from funciones f
    join pg_proc p on p.oid = to_regprocedure(f.firma),
      aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where a.grantee = 0),
  'Nadie las hereda de PUBLIC');
select is(
  (select pg_get_function_result(to_regprocedure('privado.vigencia_del_diagnostico_en_curso()'))), 'interval',
  'La vigencia es un intervalo');
select is(privado.vigencia_del_diagnostico_en_curso(), interval '2 hours', 'D-49 d: el diagnóstico en curso vence a las 2 horas sin responder');
select is(
  (select count(*)::int from cron.job
   where jobname = 'calibra-purgar-diagnosticos' and schedule = '17,47 * * * *' and active),
  1, 'Existe un solo trabajo calibra-purgar-diagnosticos en pg_cron, activo y cada media hora');
select matches(
  (select command from cron.job where jobname = 'calibra-purgar-diagnosticos'),
  '^select privado\.purgar_diagnosticos_en_curso\(now\(\)\)$',
  'El trabajo llama a privado.purgar_diagnosticos_en_curso con now()');

-- Sin permiso ni se ejecutan: una sesión, el visitante y el propio servidor frente a los núcleos.
set local role authenticated;
select throws_ok(
  $$select * from public.iniciar_diagnostico('c0000000-0000-0000-0000-000000008101', '20000000-0000-0000-0000-000000008101', 1, '{}', false, '[]', '{"version":1}')$$,
  '42501', null, 'Una sesión no puede iniciar un diagnóstico por la Data API: permiso denegado');
select throws_ok(
  $$select * from public.diagnostico_en_curso_de('c0000000-0000-0000-0000-000000008101')$$,
  '42501', null, 'Ni leer el en curso de otra sesión');
select throws_ok(
  $$select public.banco_de_la_evaluacion('20000000-0000-0000-0000-000000008101')$$,
  '42501', null, 'Ni leer la foto del banco (trae la correcta y las soluciones)');
select throws_ok(
  $$select * from public.vistas_de_la_sesion('c0000000-0000-0000-0000-000000008101', '20000000-0000-0000-0000-000000008101')$$,
  '42501', null, 'Ni las vistas antes');
select throws_ok(
  $$select public.responder_diagnostico('c0000000-0000-0000-0000-000000008101', gen_random_uuid(), 0, '{"clave":"P1"}')$$,
  '42501', null, 'Ni responder');
select throws_ok(
  $$select * from public.terminar_diagnostico('c0000000-0000-0000-0000-000000008101', gen_random_uuid(), 0, '{"clave":"P1"}', '{}', '[]', 0, 0)$$,
  '42501', null, 'Ni terminar');
select throws_ok(
  $$select * from privado.iniciar_diagnostico('c0000000-0000-0000-0000-000000008101', '20000000-0000-0000-0000-000000008101', 1, '{}', false, '[]', '{"version":1}', now())$$,
  '42501', null, 'Ni el núcleo con p_ahora: nadie elige la hora');
reset role;
set local role anon;
select throws_ok(
  $$select * from public.diagnostico_en_curso_de('c0000000-0000-0000-0000-000000008101')$$,
  '42501', null, 'Ni el visitante sin sesión');
reset role;
set local role service_role;
select throws_ok(
  $$select * from privado.iniciar_diagnostico('c0000000-0000-0000-0000-000000008101', '20000000-0000-0000-0000-000000008101', 1, '{}', false, '[]', '{"version":1}', now())$$,
  '42501', null, 'Ni el servidor puede llamar al núcleo con p_ahora (una hora inventada vence o alarga un diagnóstico)');
select throws_ok(
  $$select privado.purgar_diagnosticos_en_curso(now())$$,
  '42501', null, 'Ni la purga: solo la corre pg_cron');
reset role;

-- ---------------------------------------------------------------------------
-- diagnostico: columnas, permisos de lectura y checks
-- ---------------------------------------------------------------------------
select has_column('public', 'diagnostico', c, 'diagnostico tiene la columna ' || c)
from unnest(array['semilla', 'repetido', 'respondidas', 'aciertos', 'falta_material', 'resultado_por_habilidad']) c;
select hasnt_column('public', 'diagnostico', 'resultado_por_tema', 'resultado_por_tema ya no existe: pasó a resultado_por_habilidad');
select is(
  (select attgenerated::text from pg_attribute where attrelid = 'public.diagnostico'::regclass and attname = 'respondidas'),
  's', 'respondidas es una columna generada y almacenada (el largo de respuestas)');
select set_eq(
  $$select column_name::text from information_schema.columns
    where table_schema = 'public' and table_name = 'diagnostico'
      and has_column_privilege('authenticated', 'public.diagnostico', column_name, 'select')$$,
  $$values ('id'), ('id_lead'), ('id_sesion_anonima'), ('id_evaluacion'), ('id_materia'), ('id_monitoria'),
           ('puntaje'), ('resultado_por_habilidad'), ('fecha_realizacion')$$,
  'Las sesiones leen exactamente esas columnas: sin respuestas, semilla, repetido, respondidas, aciertos, falta_material ni token_recuperacion');
select is(
  (select count(*)::int from information_schema.columns
   where table_schema = 'public' and table_name = 'diagnostico'
     and has_column_privilege('anon', 'public.diagnostico', column_name, 'select')),
  0, 'El visitante sin sesión no lee ninguna columna de diagnostico');
select ok(
  has_column_privilege('service_role', 'public.diagnostico', 'respuestas', 'select')
  and has_column_privilege('service_role', 'public.diagnostico', 'semilla', 'select')
  and has_column_privilege('service_role', 'public.diagnostico', 'falta_material', 'select')
  and has_column_privilege('service_role', 'public.diagnostico', 'token_recuperacion', 'select'),
  'El servidor sí lee todo (HU-061 consulta falta_material con la llave secreta)');

-- Checks de un diagnóstico completo. La sesión 25 hace los intentos y sus filas se borran al final.
select lives_ok(
  $$insert into public.diagnostico (id, id_sesion_anonima, id_evaluacion, id_materia, respuestas, puntaje, resultado_por_habilidad, semilla, aciertos)
    values ('60000000-0000-0000-0000-000000008191', 'c0000000-0000-0000-0000-000000008125', '20000000-0000-0000-0000-000000008101',
            '10000000-0000-0000-0000-000000008101', '[{"clave":"P1"},{"clave":"P2"}]', 50,
            '{"habilidades":[],"errores":[],"prerrequisitos":[]}', 1, 1)$$,
  'Un diagnóstico completo se inserta');
select is(
  (select respondidas from public.diagnostico where id = '60000000-0000-0000-0000-000000008191'),
  2, 'respondidas se genera del largo de respuestas');
select is(
  (select repetido::text || ' ' || falta_material::text from public.diagnostico where id = '60000000-0000-0000-0000-000000008191'),
  'false []', 'repetido nace falso y falta_material nace como un arreglo vacío');
select throws_ok(
  $$insert into public.diagnostico (id_sesion_anonima, id_evaluacion, id_materia, respuestas, puntaje, resultado_por_habilidad, semilla, aciertos)
    values ('c0000000-0000-0000-0000-000000008125', '20000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008101',
            '[]', 50, '{"habilidades":[],"errores":[],"prerrequisitos":[]}', 1, 0)$$,
  '23514', 'new row for relation "diagnostico" violates check constraint "diagnostico_respondidas_minimas"',
  'Nunca un diagnóstico vacío: respuestas sin ningún paso se rechaza');
select throws_ok(
  $$insert into public.diagnostico (id_sesion_anonima, id_evaluacion, id_materia, respuestas, puntaje, resultado_por_habilidad, semilla, aciertos)
    values ('c0000000-0000-0000-0000-000000008125', '20000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008101',
            '{}', 50, '{"habilidades":[],"errores":[],"prerrequisitos":[]}', 1, 0)$$,
  '22023', null, 'respuestas que no es un arreglo se rechaza (la columna generada no puede calcular su largo)');
select throws_ok(
  $$insert into public.diagnostico (id_sesion_anonima, id_evaluacion, id_materia, respuestas, puntaje, resultado_por_habilidad, semilla, aciertos)
    values ('c0000000-0000-0000-0000-000000008125', '20000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008101',
            '[{"clave":"P1"},{"clave":"P2"}]', 50, '{"habilidades":[],"errores":[],"prerrequisitos":[]}', 1, 3)$$,
  '23514', 'new row for relation "diagnostico" violates check constraint "diagnostico_aciertos_en_rango"',
  'Más aciertos que preguntas respondidas se rechaza');
select throws_ok(
  $$insert into public.diagnostico (id_sesion_anonima, id_evaluacion, id_materia, respuestas, puntaje, resultado_por_habilidad, semilla, aciertos)
    values ('c0000000-0000-0000-0000-000000008125', '20000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008101',
            '[{"clave":"P1"}]', 50, '{"habilidades":[],"errores":[],"prerrequisitos":[]}', 1, -1)$$,
  '23514', 'new row for relation "diagnostico" violates check constraint "diagnostico_aciertos_en_rango"',
  'Aciertos negativos se rechazan');
select throws_ok(
  $$insert into public.diagnostico (id_sesion_anonima, id_evaluacion, id_materia, respuestas, puntaje, resultado_por_habilidad, semilla, aciertos)
    values ('c0000000-0000-0000-0000-000000008125', '20000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008101',
            '[{"clave":"P1"}]', 50, '{"habilidades":[],"errores":[],"prerrequisitos":[]}', -1, 0)$$,
  '23514', 'new row for relation "diagnostico" violates check constraint "diagnostico_semilla_rango"',
  'Una semilla negativa se rechaza');
select throws_ok(
  $$insert into public.diagnostico (id_sesion_anonima, id_evaluacion, id_materia, respuestas, puntaje, resultado_por_habilidad, semilla, aciertos)
    values ('c0000000-0000-0000-0000-000000008125', '20000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008101',
            '[{"clave":"P1"}]', 50, '{"habilidades":[],"errores":[],"prerrequisitos":[]}', 4294967296, 0)$$,
  '23514', 'new row for relation "diagnostico" violates check constraint "diagnostico_semilla_rango"',
  'Una semilla de más de 32 bits se rechaza');
select lives_ok(
  $$insert into public.diagnostico (id_sesion_anonima, id_evaluacion, id_materia, respuestas, puntaje, resultado_por_habilidad, semilla, aciertos)
    values ('c0000000-0000-0000-0000-000000008125', '20000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008101',
            '[{"clave":"P1"}]', 100, '{"habilidades":[],"errores":[],"prerrequisitos":[]}', 4294967295, 1),
           ('c0000000-0000-0000-0000-000000008125', '20000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008101',
            '[{"clave":"P1"}]', 0, '{"habilidades":[],"errores":[],"prerrequisitos":[]}', 0, 0)$$,
  'Los bordes valen: semilla 0 y 4294967295, puntaje 0 y 100, todos los pasos acertados o ninguno');
select throws_ok(
  $$insert into public.diagnostico (id_sesion_anonima, id_evaluacion, id_materia, respuestas, puntaje, resultado_por_habilidad, semilla, aciertos)
    values ('c0000000-0000-0000-0000-000000008125', '20000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008101',
            '[{"clave":"P1"}]', 100.01, '{"habilidades":[],"errores":[],"prerrequisitos":[]}', 1, 1)$$,
  '23514', 'new row for relation "diagnostico" violates check constraint "diagnostico_puntaje_en_rango"',
  'Un puntaje de más de 100 se rechaza');
select throws_ok(
  $$insert into public.diagnostico (id_sesion_anonima, id_evaluacion, id_materia, respuestas, puntaje, resultado_por_habilidad, semilla, aciertos)
    values ('c0000000-0000-0000-0000-000000008125', '20000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008101',
            '[{"clave":"P1"}]', -0.01, '{"habilidades":[],"errores":[],"prerrequisitos":[]}', 1, 0)$$,
  '23514', 'new row for relation "diagnostico" violates check constraint "diagnostico_puntaje_en_rango"',
  'Ni uno negativo');
-- Cada clave del resultado por separado: con la clave que falta, `jsonb_typeof(NULL) = 'array'` da NULL y un CHECK sin coalesce lo deja pasar.
select throws_ok(
  $$insert into public.diagnostico (id_sesion_anonima, id_evaluacion, id_materia, respuestas, puntaje, resultado_por_habilidad, semilla, aciertos)
    values ('c0000000-0000-0000-0000-000000008125', '20000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008101',
            '[{"clave":"P1"}]', 50, '{"errores":[],"prerrequisitos":[]}', 1, 0)$$,
  '23514', 'new row for relation "diagnostico" violates check constraint "diagnostico_resultado_completo"',
  'Un resultado sin habilidades se rechaza');
select throws_ok(
  $$insert into public.diagnostico (id_sesion_anonima, id_evaluacion, id_materia, respuestas, puntaje, resultado_por_habilidad, semilla, aciertos)
    values ('c0000000-0000-0000-0000-000000008125', '20000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008101',
            '[{"clave":"P1"}]', 50, '{"habilidades":[],"prerrequisitos":[]}', 1, 0)$$,
  '23514', 'new row for relation "diagnostico" violates check constraint "diagnostico_resultado_completo"',
  'Ni sin errores');
select throws_ok(
  $$insert into public.diagnostico (id_sesion_anonima, id_evaluacion, id_materia, respuestas, puntaje, resultado_por_habilidad, semilla, aciertos)
    values ('c0000000-0000-0000-0000-000000008125', '20000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008101',
            '[{"clave":"P1"}]', 50, '{"habilidades":[],"errores":[]}', 1, 0)$$,
  '23514', 'new row for relation "diagnostico" violates check constraint "diagnostico_resultado_completo"',
  'Ni sin prerrequisitos');
select throws_ok(
  $$insert into public.diagnostico (id_sesion_anonima, id_evaluacion, id_materia, respuestas, puntaje, resultado_por_habilidad, semilla, aciertos)
    values ('c0000000-0000-0000-0000-000000008125', '20000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008101',
            '[{"clave":"P1"}]', 50, '[]', 1, 0)$$,
  '23514', 'new row for relation "diagnostico" violates check constraint "diagnostico_resultado_completo"',
  'Ni un resultado que no es un objeto');
select throws_ok(
  $$insert into public.diagnostico (id_sesion_anonima, id_evaluacion, id_materia, respuestas, puntaje, resultado_por_habilidad, semilla, aciertos)
    values ('c0000000-0000-0000-0000-000000008125', '20000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008101',
            '[{"clave":"P1"}]', 50, '{"habilidades":{},"errores":[],"prerrequisitos":[]}', 1, 0)$$,
  '23514', 'new row for relation "diagnostico" violates check constraint "diagnostico_resultado_completo"',
  'Ni con habilidades que no es un arreglo');
select throws_ok(
  $$insert into public.diagnostico (id_sesion_anonima, id_evaluacion, id_materia, respuestas, puntaje, resultado_por_habilidad, semilla, aciertos, falta_material)
    values ('c0000000-0000-0000-0000-000000008125', '20000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008101',
            '[{"clave":"P1"}]', 50, '{"habilidades":[],"errores":[],"prerrequisitos":[]}', 1, 0, '{}')$$,
  '23514', 'new row for relation "diagnostico" violates check constraint "diagnostico_falta_material_forma"',
  'falta_material que no es un arreglo se rechaza');
select throws_ok(
  $$insert into public.diagnostico (id_sesion_anonima, id_evaluacion, id_materia, respuestas, puntaje, resultado_por_habilidad, aciertos)
    values ('c0000000-0000-0000-0000-000000008125', '20000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008101',
            '[{"clave":"P1"}]', 50, '{"habilidades":[],"errores":[],"prerrequisitos":[]}', 0)$$,
  '23502', null, 'Sin semilla no hay diagnóstico (not null, sin valor por defecto)');
select throws_ok(
  $$insert into public.diagnostico (id_sesion_anonima, id_evaluacion, id_materia, respuestas, puntaje, resultado_por_habilidad, semilla)
    values ('c0000000-0000-0000-0000-000000008125', '20000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008101',
            '[{"clave":"P1"}]', 50, '{"habilidades":[],"errores":[],"prerrequisitos":[]}', 1)$$,
  '23502', null, 'Ni sin aciertos');
delete from public.diagnostico where id_sesion_anonima = 'c0000000-0000-0000-0000-000000008125';

-- Checks de la tabla del en curso (la sesión 25 también).
select lives_ok(
  $$insert into public.diagnostico_en_curso (id, id_sesion, id_evaluacion, id_materia, semilla, candidatas, contexto)
    values ('60000000-0000-0000-0000-000000008192', 'c0000000-0000-0000-0000-000000008125', '20000000-0000-0000-0000-000000008101',
            '10000000-0000-0000-0000-000000008101', 1, '[]', '{}')$$,
  'Un en curso mínimo se inserta (candidatas arreglo, contexto objeto, sin pasos)');
select is(
  (select paso::text || ' ' || pasos::text || ' ' || vistas_antes::text || ' ' || repetido::text from public.diagnostico_en_curso
   where id = '60000000-0000-0000-0000-000000008192'),
  '0 [] {} false', 'Nace en el paso 0, sin pasos, sin vistas antes y sin marcar como repetido');
select throws_ok(
  $$insert into public.diagnostico_en_curso (id_sesion, id_evaluacion, id_materia, semilla, candidatas, contexto)
    values ('c0000000-0000-0000-0000-000000008125', '20000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008101', 2, '[]', '{}')$$,
  '23505', 'duplicate key value violates unique constraint "diagnostico_en_curso_id_sesion_key"',
  'Cada sesión tiene a lo sumo un diagnóstico en curso');
delete from public.diagnostico_en_curso where id_sesion = 'c0000000-0000-0000-0000-000000008125';
select throws_ok(
  $$insert into public.diagnostico_en_curso (id_sesion, id_evaluacion, id_materia, semilla, candidatas, contexto, pasos, paso)
    values ('c0000000-0000-0000-0000-000000008125', '20000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008101', 1, '[]', '{}', '[]', 1)$$,
  '23514', 'new row for relation "diagnostico_en_curso" violates check constraint "diagnostico_en_curso_paso_coincide"',
  'paso tiene que ser el largo de pasos');
select throws_ok(
  $$insert into public.diagnostico_en_curso (id_sesion, id_evaluacion, id_materia, semilla, candidatas, contexto, pasos, paso)
    values ('c0000000-0000-0000-0000-000000008125', '20000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008101', 1, '[]', '{}', '[{"clave":"P1"}]', 0)$$,
  '23514', 'new row for relation "diagnostico_en_curso" violates check constraint "diagnostico_en_curso_paso_coincide"',
  'Ni con pasos de más');
select throws_ok(
  $$insert into public.diagnostico_en_curso (id_sesion, id_evaluacion, id_materia, semilla, candidatas, contexto)
    values ('c0000000-0000-0000-0000-000000008125', '20000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008101', -1, '[]', '{}')$$,
  '23514', 'new row for relation "diagnostico_en_curso" violates check constraint "diagnostico_en_curso_semilla_rango"',
  'Una semilla negativa se rechaza también en el en curso');
select throws_ok(
  $$insert into public.diagnostico_en_curso (id_sesion, id_evaluacion, id_materia, semilla, candidatas, contexto)
    values ('c0000000-0000-0000-0000-000000008125', '20000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008101', 4294967296, '[]', '{}')$$,
  '23514', 'new row for relation "diagnostico_en_curso" violates check constraint "diagnostico_en_curso_semilla_rango"',
  'Ni una de más de 32 bits');
select throws_ok(
  $$insert into public.diagnostico_en_curso (id_sesion, id_evaluacion, id_materia, semilla, candidatas, contexto)
    values ('c0000000-0000-0000-0000-000000008125', '20000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008101', 1, '{}', '{}')$$,
  '23514', 'new row for relation "diagnostico_en_curso" violates check constraint "diagnostico_en_curso_formas"',
  'candidatas tiene que ser un arreglo');
select throws_ok(
  $$insert into public.diagnostico_en_curso (id_sesion, id_evaluacion, id_materia, semilla, candidatas, contexto)
    values ('c0000000-0000-0000-0000-000000008125', '20000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008101', 1, '[]', '[]')$$,
  '23514', 'new row for relation "diagnostico_en_curso" violates check constraint "diagnostico_en_curso_formas"',
  'contexto tiene que ser un objeto');
select throws_ok(
  $$insert into public.diagnostico_en_curso (id_sesion, id_evaluacion, id_materia, semilla, candidatas, contexto, pasos)
    values ('c0000000-0000-0000-0000-000000008125', '20000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008101', 1, '[]', '{}', '{}')$$,
  '23514', 'new row for relation "diagnostico_en_curso" violates check constraint "diagnostico_en_curso_formas"',
  'pasos tiene que ser un arreglo');
select throws_ok(
  $$insert into public.diagnostico_en_curso (id_sesion, id_evaluacion, id_materia, semilla, candidatas, contexto)
    values ('c0000000-0000-0000-0000-000000008125', '20000000-0000-0000-0000-000000008102', '10000000-0000-0000-0000-000000008102', 1, '[]', '{}')$$,
  '23503', 'insert or update on table "diagnostico_en_curso" violates foreign key constraint "diagnostico_en_curso_evaluacion_fk"',
  'La Evaluación y la materia tienen que ser las de la misma Evaluación (llave compuesta)');

-- ---------------------------------------------------------------------------
-- El Lead de una sesión y la regla de privado.es_mi_lead con la sesión como parámetro
-- ---------------------------------------------------------------------------
select is(privado.lead_de_la_sesion('c0000000-0000-0000-0000-000000008104'), '40000000-0000-0000-0000-000000008101'::uuid,
  'La sesión que creó el Lead es del Lead');
select is(privado.lead_de_la_sesion('c0000000-0000-0000-0000-000000008105'), '40000000-0000-0000-0000-000000008101'::uuid,
  'La que confirmó el correo (lead_sesion) también');
select is(privado.lead_de_la_sesion('c0000000-0000-0000-0000-000000008106'), '40000000-0000-0000-0000-000000008101'::uuid,
  'Y la cuenta de Estudiante del Lead');
select is(privado.lead_de_la_sesion('c0000000-0000-0000-0000-000000008107'), '40000000-0000-0000-0000-000000008102'::uuid,
  'Otra sesión es del otro Lead');
select is(privado.lead_de_la_sesion('c0000000-0000-0000-0000-000000008103'), null::uuid,
  'Una sesión que no es de ningún Lead da nulo');
select is(privado.lead_de_la_sesion(null), null::uuid, 'Sin sesión, nulo');

-- Lo que da privado.es_mi_lead corriendo como cada sesión (request.jwt.claims) tiene que ser lo que da leads_de_la_sesion.
create temporary table equivalencia (sesion uuid, id_lead uuid, es_mi_lead boolean);
grant insert, select on equivalencia to authenticated;
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000008104","role":"authenticated","is_anonymous":true}';
insert into equivalencia select 'c0000000-0000-0000-0000-000000008104'::uuid, l, privado.es_mi_lead(l)
  from unnest(array['40000000-0000-0000-0000-000000008101', '40000000-0000-0000-0000-000000008102']::uuid[]) l;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000008105","role":"authenticated","is_anonymous":true}';
insert into equivalencia select 'c0000000-0000-0000-0000-000000008105'::uuid, l, privado.es_mi_lead(l)
  from unnest(array['40000000-0000-0000-0000-000000008101', '40000000-0000-0000-0000-000000008102']::uuid[]) l;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000008106","role":"authenticated","is_anonymous":false}';
insert into equivalencia select 'c0000000-0000-0000-0000-000000008106'::uuid, l, privado.es_mi_lead(l)
  from unnest(array['40000000-0000-0000-0000-000000008101', '40000000-0000-0000-0000-000000008102']::uuid[]) l;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000008107","role":"authenticated","is_anonymous":true}';
insert into equivalencia select 'c0000000-0000-0000-0000-000000008107'::uuid, l, privado.es_mi_lead(l)
  from unnest(array['40000000-0000-0000-0000-000000008101', '40000000-0000-0000-0000-000000008102']::uuid[]) l;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000008103","role":"authenticated","is_anonymous":true}';
insert into equivalencia select 'c0000000-0000-0000-0000-000000008103'::uuid, l, privado.es_mi_lead(l)
  from unnest(array['40000000-0000-0000-0000-000000008101', '40000000-0000-0000-0000-000000008102']::uuid[]) l;
reset role;
select is((select count(*)::int from equivalencia), 10, 'Cinco sesiones frente a los dos Leads');
select is((select count(*)::int from equivalencia where es_mi_lead), 4,
  'es_mi_lead da verdadero para las tres vías del Lead 1 (creó, confirmó, Estudiante) y para la creadora del Lead 2');
select is(
  (select count(*)::int from equivalencia e where e.es_mi_lead is distinct from (e.id_lead = any(privado.leads_de_la_sesion(e.sesion)))),
  0, 'leads_de_la_sesion da lo mismo que es_mi_lead para cada sesión y cada Lead (si HU-068 cambia las vías, cambian las dos)');
select is(privado.leads_de_la_sesion('c0000000-0000-0000-0000-000000008104'), array['40000000-0000-0000-0000-000000008101']::uuid[],
  'Los Leads de la sesión que creó el Lead 1: ese');
select is(privado.leads_de_la_sesion('c0000000-0000-0000-0000-000000008105'), array['40000000-0000-0000-0000-000000008101']::uuid[],
  'La que confirmó el correo (lead_sesion), el mismo');
select is(privado.leads_de_la_sesion('c0000000-0000-0000-0000-000000008106'), array['40000000-0000-0000-0000-000000008101']::uuid[],
  'Y la cuenta de Estudiante');
select is(privado.leads_de_la_sesion('c0000000-0000-0000-0000-000000008107'), array['40000000-0000-0000-0000-000000008102']::uuid[],
  'La sesión de otro Lead no trae el Lead 1');
select is(privado.leads_de_la_sesion('c0000000-0000-0000-0000-000000008103'), '{}'::uuid[], 'Una sesión que no es de ningún Lead: arreglo vacío');
select is(privado.leads_de_la_sesion(null), '{}'::uuid[], 'Sin sesión, arreglo vacío (no nulo)');

-- Una sesión puede ser de dos Leads (creó uno y confirmó el correo de otro): es_mi_lead acepta cualquiera y el arreglo trae los dos.
savepoint dos_leads;
insert into public.lead_sesion (id_sesion, id_lead) values ('c0000000-0000-0000-0000-000000008107', '40000000-0000-0000-0000-000000008101');
create temporary table de_dos_leads (id_lead uuid, es_mi_lead boolean);
grant insert, select on de_dos_leads to authenticated;
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000008107","role":"authenticated","is_anonymous":true}';
insert into de_dos_leads select l, privado.es_mi_lead(l)
  from unnest(array['40000000-0000-0000-0000-000000008101', '40000000-0000-0000-0000-000000008102']::uuid[]) l;
reset role;
select is(privado.leads_de_la_sesion('c0000000-0000-0000-0000-000000008107'),
  array['40000000-0000-0000-0000-000000008101', '40000000-0000-0000-0000-000000008102']::uuid[],
  'Una sesión que creó un Lead y confirmó el correo de otro trae los dos, sin repetir y ordenados');
select is((select array_agg(id_lead order by id_lead) from de_dos_leads where es_mi_lead),
  array['40000000-0000-0000-0000-000000008101', '40000000-0000-0000-0000-000000008102']::uuid[],
  'Y es_mi_lead da verdadero para los dos: el arreglo no se queda corto frente a la regla');
rollback to savepoint dos_leads;

-- ---------------------------------------------------------------------------
-- banco_de_la_evaluacion: la foto del banco al empezar
-- ---------------------------------------------------------------------------
select is(public.banco_de_la_evaluacion('20000000-0000-0000-0000-000000008102'), null::jsonb, 'Una Evaluación inactiva no tiene foto (null)');
select is(public.banco_de_la_evaluacion('20000000-0000-0000-0000-0000000081ff'), null::jsonb, 'Una Evaluación que no existe, tampoco');
select is(public.banco_de_la_evaluacion(null), null::jsonb, 'Ni una nula');

create temporary table foto as select public.banco_de_la_evaluacion('20000000-0000-0000-0000-000000008101') as j;
create temporary table foto3 as select public.banco_de_la_evaluacion('20000000-0000-0000-0000-000000008103') as j;
create temporary table fotob as select public.banco_de_la_evaluacion('20000000-0000-0000-0000-000000008104') as j;

select is((select array_agg(k order by k) from foto, jsonb_object_keys(j) k), array['candidatas', 'contexto'], 'La foto trae contexto y candidatas');
select is((select (j -> 'contexto' ->> 'version')::int from foto), 1, 'La versión del formato de la foto es 1');
select is((select j -> 'contexto' -> 'evaluacion' from foto),
  '{"id":"20000000-0000-0000-0000-000000008101","nombre":"Parcial 2"}'::jsonb, 'La Evaluación: id y nombre');
select is((select j -> 'contexto' -> 'materia' from foto),
  '{"id":"10000000-0000-0000-0000-000000008101","codigo":"PGTAP-81","nombre":"Materia HU-081"}'::jsonb, 'La materia: id, código y nombre');
select is(
  (select array_agg(h ->> 'clave' order by n) from foto, jsonb_array_elements(j -> 'contexto' -> 'habilidades') with ordinality t(h, n)),
  array['potencia', 'regla-cadena', 'antiderivada'],
  'Las habilidades van por tema.orden y luego por clave, no por inserción ni por orden alfabético: las dos del tema 1 y la del tema 2 (acumulativa)');
select is(
  (select h -> 'prerrequisitos' from foto, jsonb_array_elements(j -> 'contexto' -> 'habilidades') h where h ->> 'clave' = 'regla-cadena'),
  '[{"materia":null,"habilidad":"potencia","descripcion":"Derivar una potencia"},
    {"materia":"Otra materia HU-081","habilidad":"suma-vectores","descripcion":"Sumar vectores"}]'::jsonb,
  'Los prerrequisitos de una habilidad: con materia nula si es de la misma y con el NOMBRE de la otra materia si es de otra, la misma primero');
select is(
  (select h -> 'prerrequisitos' from foto, jsonb_array_elements(j -> 'contexto' -> 'habilidades') h where h ->> 'clave' = 'potencia'),
  '[]'::jsonb, 'Una habilidad sin prerrequisitos trae un arreglo vacío');
select is(
  (select array_agg(m ->> 'clave' || ':' || (m ->> 'habilidad') order by n) from foto, jsonb_array_elements(j -> 'contexto' -> 'misconcepciones') with ordinality t(m, n)),
  array['integra-mal:antiderivada', 'olvida-cadena:regla-cadena', 'resta-uno:potencia'],
  'Las misconcepciones de la materia, por clave, cada una con su habilidad');
select is((select j -> 'contexto' -> 'misconcepciones' -> 1 ->> 'descripcion' from foto), 'Olvidas multiplicar por la derivada de adentro',
  'Cada misconcepción trae su descripción: el título del error');
select is((select j -> 'contexto' -> 'descripcionesDeHabilidad' from foto),
  '{"potencia":"Derivar una potencia","regla-cadena":"Derivar una función compuesta","antiderivada":"Hallar una antiderivada"}'::jsonb,
  'Las descripciones de todas las habilidades de la materia');
select is(
  (select array_agg(c ->> 'clave' order by n) from foto, jsonb_array_elements(j -> 'candidatas') with ordinality t(c, n)),
  array['P1', 'P2', 'P3', 'P4', 'P5'],
  'Las candidatas son las preguntas revisadas que miden alguna habilidad de la Evaluación, por clave (ni el borrador P6 ni la retirada P7)');
select is(
  (select c from foto, jsonb_array_elements(j -> 'candidatas') c where c ->> 'clave' = 'P3'),
  '{"clave":"P3","tema":"derivadas","enunciado":"Enunciado P3","dificultad":3,"habilidades":["potencia","regla-cadena"],"solucion":"sol-P3",
    "opciones":[
      {"texto":"P3-A","correcta":true,"misconcepcion":null,"error":null},
      {"texto":"P3-B","correcta":false,"misconcepcion":"olvida-cadena","error":null},
      {"texto":"P3-C","correcta":false,"misconcepcion":"resta-uno","error":"error-P3"},
      {"texto":"P3-D","correcta":false,"misconcepcion":"integra-mal","error":null}]}'::jsonb,
  'Una candidata completa: tema como clave, sus dos habilidades, la solución y las cuatro opciones de la A a la D (insertadas D, B, A, C) con la correcta, la misconcepción como clave y el error cuando lo hay');
select is(
  (select jsonb_typeof(c -> 'solucion') from foto, jsonb_array_elements(j -> 'candidatas') c where c ->> 'clave' = 'P2'),
  'null', 'Sin solución, la solución es null');
select is(
  (select array_agg(c ->> 'clave' order by n) from foto3, jsonb_array_elements(j -> 'candidatas') with ordinality t(c, n)),
  array['P1', 'P2', 'P3', 'P5'],
  'Con «Parcial 1» (solo el tema 1), P4 no sale: no mide ninguna habilidad de la Evaluación');
select is(
  (select c -> 'habilidades' from foto3, jsonb_array_elements(j -> 'candidatas') c where c ->> 'clave' = 'P5'),
  '["antiderivada","regla-cadena"]'::jsonb,
  'P5 mide una habilidad de la Evaluación y otra de fuera: trae las claves de las dos, ordenadas');
select is(
  (select array_agg(h ->> 'clave' order by n) from foto3, jsonb_array_elements(j -> 'contexto' -> 'habilidades') with ordinality t(h, n)),
  array['potencia', 'regla-cadena'], 'Las habilidades de «Parcial 1»: solo las del tema 1');
select is(
  (select array_agg(m ->> 'clave' order by n) from foto3, jsonb_array_elements(j -> 'contexto' -> 'misconcepciones') with ordinality t(m, n)),
  array['integra-mal', 'olvida-cadena', 'resta-uno'],
  'Las misconcepciones incluyen la de una habilidad de fuera de la Evaluación (el motor lanza RangeError si una opción ofrece una que no está)');
select is((select j -> 'contexto' -> 'descripcionesDeHabilidad' from foto3), (select j -> 'contexto' -> 'descripcionesDeHabilidad' from foto),
  'Las descripciones de habilidad son las de toda la materia, también con «Parcial 1» (para los errores de habilidades de fuera)');
select is(
  (select h -> 'prerrequisitos' from fotob, jsonb_array_elements(j -> 'contexto' -> 'habilidades') h where h ->> 'clave' = 'producto-punto'),
  '[{"materia":null,"habilidad":"suma-vectores","descripcion":"Sumar vectores"},
    {"materia":"Materia HU-081","habilidad":"potencia","descripcion":"Derivar una potencia"}]'::jsonb,
  'En la otra materia: el prerrequisito de la misma es nulo y el de la otra trae el nombre de «Materia HU-081»');
select is((select j -> 'contexto' -> 'misconcepciones' from fotob), '[]'::jsonb,
  'La materia B no tiene misconcepciones: no trae las de la materia A');
select is((select jsonb_array_length(j -> 'candidatas') from fotob), 0, 'Y sin preguntas, candidatas es un arreglo vacío');
set local role service_role;
select isnt(public.banco_de_la_evaluacion('20000000-0000-0000-0000-000000008101'), null::jsonb, 'service_role lee la foto del banco');
reset role;

-- ---------------------------------------------------------------------------
-- vistas_de_la_sesion: las preguntas vistas y el último diagnóstico
-- ---------------------------------------------------------------------------
-- Un en curso no cuenta: está en otra tabla. Este lo trae P4 en sus pasos y se borra al terminar la sección.
insert into public.diagnostico_en_curso (id, id_sesion, id_evaluacion, id_materia, semilla, candidatas, contexto, pasos, paso)
values ('60000000-0000-0000-0000-000000008193', 'c0000000-0000-0000-0000-000000008104', '20000000-0000-0000-0000-000000008101',
        '10000000-0000-0000-0000-000000008101', 1, '[]', '{"version":1}', '[{"clave":"P4"}]', 1);

select results_eq(
  $$select claves, id_ultimo from public.vistas_de_la_sesion('c0000000-0000-0000-0000-000000008104', '20000000-0000-0000-0000-000000008101')$$,
  $$values (array['P1','P2','P3','P5']::text[], '60000000-0000-0000-0000-000000008101'::uuid)$$,
  'La sesión que creó el Lead: sus diagnósticos y los del Lead hechos por otra sesión (P1, P2, P3, P5, y no P4 del en curso); el último de «Parcial 2» es el suyo aunque el otro sea más reciente');
select results_eq(
  $$select claves, id_ultimo from public.vistas_de_la_sesion('c0000000-0000-0000-0000-000000008105', '20000000-0000-0000-0000-000000008101')$$,
  $$values (array['P1','P2','P3','P5']::text[], '60000000-0000-0000-0000-000000008101'::uuid)$$,
  'La sesión que confirmó el correo (lead_sesion) ve las del Lead, también las que hizo la creadora');
select results_eq(
  $$select claves, id_ultimo from public.vistas_de_la_sesion('c0000000-0000-0000-0000-000000008106', '20000000-0000-0000-0000-000000008101')$$,
  $$values (array['P1','P2','P3','P5']::text[], '60000000-0000-0000-0000-000000008101'::uuid)$$,
  'La cuenta de Estudiante del Lead, también');
select results_eq(
  $$select claves, id_ultimo from public.vistas_de_la_sesion('c0000000-0000-0000-0000-000000008104', '20000000-0000-0000-0000-000000008103')$$,
  $$values (array['P1','P2','P3','P5']::text[], '60000000-0000-0000-0000-000000008102'::uuid)$$,
  'Con «Parcial 1» las vistas son las mismas (son de la materia) y el último es el de esa Evaluación');
select results_eq(
  $$select claves, id_ultimo from public.vistas_de_la_sesion('c0000000-0000-0000-0000-000000008104', '20000000-0000-0000-0000-000000008104')$$,
  $$values (array['PB1']::text[], '60000000-0000-0000-0000-000000008103'::uuid)$$,
  'Otra materia: solo cuentan los diagnósticos de la materia de la Evaluación');
select results_eq(
  $$select claves, id_ultimo from public.vistas_de_la_sesion('c0000000-0000-0000-0000-000000008107', '20000000-0000-0000-0000-000000008101')$$,
  $$values (array['P4']::text[], '60000000-0000-0000-0000-000000008104'::uuid)$$,
  'Otro Lead: solo lo suyo, nada del Lead 1');
select results_eq(
  $$select claves, id_ultimo from public.vistas_de_la_sesion('c0000000-0000-0000-0000-000000008107', '20000000-0000-0000-0000-000000008103')$$,
  $$values (array['P4']::text[], '60000000-0000-0000-0000-000000008104'::uuid)$$,
  'Sin diagnósticos de «Parcial 1», el último es el de la materia (la acumulativa pudo ver todas las preguntas sin haberse tomado)');
select results_eq(
  $$select claves, id_ultimo from public.vistas_de_la_sesion('c0000000-0000-0000-0000-000000008101', '20000000-0000-0000-0000-000000008101')$$,
  $$values (array['P1']::text[], '60000000-0000-0000-0000-000000008105'::uuid)$$,
  'Una sesión sin Lead: solo sus propios diagnósticos');
select results_eq(
  $$select claves, id_ultimo from public.vistas_de_la_sesion('c0000000-0000-0000-0000-000000008101', '20000000-0000-0000-0000-000000008104')$$,
  $$values ('{}'::text[], null::uuid)$$,
  'Sin diagnósticos de la materia: claves vacío e id nulo');
select results_eq(
  $$select claves, id_ultimo from public.vistas_de_la_sesion('c0000000-0000-0000-0000-000000008103', '20000000-0000-0000-0000-000000008101')$$,
  $$values ('{}'::text[], null::uuid)$$,
  'Una sesión que no ha hecho nada: vacío');
select results_eq(
  $$select claves, id_ultimo from public.vistas_de_la_sesion('c0000000-0000-0000-0000-000000008104', '20000000-0000-0000-0000-0000000081ff')$$,
  $$values ('{}'::text[], null::uuid)$$,
  'Una Evaluación que no existe: vacío');
select results_eq(
  $$select claves, id_ultimo from public.vistas_de_la_sesion('c0000000-0000-0000-0000-000000008109', '20000000-0000-0000-0000-000000008101')$$,
  $$values (array['P1']::text[], '60000000-0000-0000-0000-000000008106'::uuid)$$,
  'Un elemento de respuestas que no es un paso (la cadena "clave", un objeto sin clave, null, un número) no mete un NULL en las claves');
select is(
  (select id_ultimo from public.vistas_de_la_sesion('c0000000-0000-0000-0000-000000008108', '20000000-0000-0000-0000-000000008101')),
  '60000000-0000-0000-0000-000000008172'::uuid, 'Con la misma fecha de realización gana el id mayor');
select is(
  (select claves from public.vistas_de_la_sesion('c0000000-0000-0000-0000-000000008108', '20000000-0000-0000-0000-000000008101')),
  array['P1', 'P2'], 'Las claves de varios diagnósticos salen distintas y ordenadas');
delete from public.diagnostico_en_curso where id = '60000000-0000-0000-0000-000000008193';

-- El costo de vistas_de_la_sesion no puede crecer con los diagnósticos de los demás: resuelve los Leads de la sesión una vez por
-- llamada y no ejecuta una función por cada diagnóstico con Lead de la materia. Se cuentan las llamadas a leads_de_la_sesion
-- dentro de la transacción (track_functions) para una sesión sin Lead, que obliga a mirar todos los diagnósticos con Lead.
select cmp_ok(
  (select count(*) from public.diagnostico where id_materia = '10000000-0000-0000-0000-000000008101' and id_lead is not null
     and id_sesion_anonima is distinct from 'c0000000-0000-0000-0000-000000008101'),
  '>=', 4::bigint, 'La materia tiene varios diagnósticos de otras sesiones con Lead: con una llamada por fila habría varias');
set local track_functions = 'all';
create temporary table llamadas_antes as
  select coalesce(pg_stat_get_xact_function_calls('privado.leads_de_la_sesion(uuid)'::regprocedure), 0) as n;
create temporary table vistas_sin_lead as
  select * from public.vistas_de_la_sesion('c0000000-0000-0000-0000-000000008101', '20000000-0000-0000-0000-000000008101');
select is(
  coalesce(pg_stat_get_xact_function_calls('privado.leads_de_la_sesion(uuid)'::regprocedure), 0) - (select n from llamadas_antes),
  1::bigint, 'vistas_de_la_sesion resuelve los Leads de la sesión una sola vez, no una por cada diagnóstico con Lead de la materia');
set local track_functions = 'none';

-- ---------------------------------------------------------------------------
-- iniciar_diagnostico
-- ---------------------------------------------------------------------------
-- Creado: la sesión 01 con «Parcial 2». Cada resultado se compara con la foto de la fila de antes.
insert into r select 'c1', * from privado.iniciar_diagnostico(
  'c0000000-0000-0000-0000-000000008101', '20000000-0000-0000-0000-000000008101', 12345, array['P1'], false,
  '[{"clave":"P1"}]', '{"version":1}', (select a from ref));
select is((select resultado from r where k = 'c1'), 'creado', 'Una sesión sin diagnóstico en curso: creado');
select isnt((select id from r where k = 'c1'), null::uuid, 'Con el id del diagnóstico en curso');
select results_eq(
  $$select id_evaluacion, id_materia, semilla, vistas_antes, repetido, candidatas, contexto, pasos, paso, iniciado_en, actualizado_en
    from public.diagnostico_en_curso where id_sesion = 'c0000000-0000-0000-0000-000000008101'$$,
  $$select '20000000-0000-0000-0000-000000008101'::uuid, '10000000-0000-0000-0000-000000008101'::uuid, 12345::bigint, array['P1']::text[],
           false, '[{"clave":"P1"}]'::jsonb, '{"version":1}'::jsonb, '[]'::jsonb, 0, a, a from ref$$,
  'La fila guarda la Evaluación, la materia (la de la Evaluación), la semilla, las vistas antes, la foto, el paso 0 y las dos fechas en p_ahora');
select is((select count(*)::int from public.diagnostico_en_curso where id = (select id from r where k = 'c1')), 1,
  'El id que devuelve es el de la fila');

-- Candado 6802 por sesión: una sesión nueva sin el candado, y con él después de iniciar.
select ok(
  not exists (
    select 1 from pg_locks l
    where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.classid = 6802
      and l.objid = hashtext('c0000000-0000-0000-0000-000000008114')::oid and l.objsubid = 2),
  'Antes de iniciar, la sesión 14 no tiene el candado 6802');
insert into r select 'c14', * from privado.iniciar_diagnostico(
  'c0000000-0000-0000-0000-000000008114', '20000000-0000-0000-0000-000000008101', 1, '{}', false, '[]', '{"version":1}', (select a from ref));
select ok(
  exists (
    select 1 from pg_locks l
    where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.granted and l.classid = 6802
      and l.objid = hashtext('c0000000-0000-0000-0000-000000008114')::oid and l.objsubid = 2),
  'Iniciar toma el candado 6802 de la sesión: dos iniciar de la misma sesión van uno detrás del otro');

-- ya_en_curso: la misma Evaluación, con otros parámetros y más tarde. No cambia nada.
create temporary table antes_c1 as select * from public.diagnostico_en_curso where id_sesion = 'c0000000-0000-0000-0000-000000008101';
insert into r select 'c2', * from privado.iniciar_diagnostico(
  'c0000000-0000-0000-0000-000000008101', '20000000-0000-0000-0000-000000008101', 999, '{}', true,
  '[{"clave":"OTRA"}]', '{"version":1}', (select a from ref) + interval '10 minutes');
select is((select resultado from r where k = 'c2'), 'ya_en_curso', 'La misma Evaluación (recargar): ya_en_curso');
select is((select id from r where k = 'c2'), (select id from r where k = 'c1'), 'Con el mismo id: la misma pregunta pendiente');
select is_empty(
  $$select * from antes_c1 except select * from public.diagnostico_en_curso where id_sesion = 'c0000000-0000-0000-0000-000000008101'$$,
  'La fila no cambia: ni la semilla ni las vistas ni la foto ni actualizado_en (recargar no alarga las 2 horas)');
select is((select count(*)::int from public.diagnostico_en_curso where id_sesion = 'c0000000-0000-0000-0000-000000008101'), 1,
  'Sigue habiendo una fila');

-- Gana la pendiente aunque la Evaluación ya esté inactiva.
update public.evaluacion set activa = false where id = '20000000-0000-0000-0000-000000008101';
insert into r select 'c3', * from privado.iniciar_diagnostico(
  'c0000000-0000-0000-0000-000000008101', '20000000-0000-0000-0000-000000008101', 5, '{}', false, '[]', '{"version":1}', (select a from ref) + interval '20 minutes');
select is((select resultado || ' ' || (id = (select id from r where k = 'c1'))::text from r where k = 'c3'), 'ya_en_curso true',
  'Con la Evaluación desactivada a mitad, la pendiente se sigue devolviendo: tiene sus copias');
update public.evaluacion set activa = true where id = '20000000-0000-0000-0000-000000008101';

-- Otra versión de la foto: no cuenta como la misma, se reemplaza.
insert into r select 'c4', * from privado.iniciar_diagnostico(
  'c0000000-0000-0000-0000-000000008101', '20000000-0000-0000-0000-000000008101', 6, '{}', false, '[]', '{"version":2}', (select a from ref) + interval '30 minutes');
select is((select resultado from r where k = 'c4'), 'creado', 'Con otra versión del formato de la foto se reemplaza');
select isnt((select id from r where k = 'c4'), (select id from r where k = 'c1'), 'Con otro id');
select is((select semilla from public.diagnostico_en_curso where id_sesion = 'c0000000-0000-0000-0000-000000008101'), 6::bigint, 'Con la semilla nueva');

-- Otra Evaluación: el anterior desaparece y queda una fila.
insert into r select 'c5', * from privado.iniciar_diagnostico(
  'c0000000-0000-0000-0000-000000008101', '20000000-0000-0000-0000-000000008103', 7, array['P3'], false, '[]', '{"version":1}', (select a from ref) + interval '40 minutes');
select is((select resultado from r where k = 'c5'), 'creado', 'Otra Evaluación: se descarta el anterior y empieza uno nuevo');
select is(
  (select array_agg(d.id_evaluacion) from public.diagnostico_en_curso d where d.id_sesion = 'c0000000-0000-0000-0000-000000008101'),
  array['20000000-0000-0000-0000-000000008103'::uuid], 'Queda una sola fila y es la de la Evaluación nueva');
select is((select count(*)::int from public.diagnostico_en_curso where id = (select id from r where k = 'c4')), 0, 'La anterior se borró');

-- Evaluación inactiva o inexistente: nada se escribe y la pendiente de otra Evaluación sigue.
create temporary table antes_c5 as select * from public.diagnostico_en_curso where id_sesion = 'c0000000-0000-0000-0000-000000008101';
insert into r select 'c6', * from privado.iniciar_diagnostico(
  'c0000000-0000-0000-0000-000000008101', '20000000-0000-0000-0000-000000008102', 8, '{}', false, '[]', '{"version":1}', (select a from ref) + interval '50 minutes');
select is((select resultado || ' ' || coalesce(id::text, 'sin id') from r where k = 'c6'), 'evaluacion_no_disponible sin id',
  'Una Evaluación inactiva: evaluacion_no_disponible, sin id');
insert into r select 'c7', * from privado.iniciar_diagnostico(
  'c0000000-0000-0000-0000-000000008101', '20000000-0000-0000-0000-0000000081ff', 8, '{}', false, '[]', '{"version":1}', (select a from ref) + interval '50 minutes');
select is((select resultado from r where k = 'c7'), 'evaluacion_no_disponible', 'Una que no existe, también');
select is_empty(
  $$select * from antes_c5 except select * from public.diagnostico_en_curso where id_sesion = 'c0000000-0000-0000-0000-000000008101'$$,
  'Y el en curso de la otra Evaluación queda intacto: no se borra antes de comprobar la nueva');
select is((select count(*)::int from public.diagnostico_en_curso where id_sesion = 'c0000000-0000-0000-0000-000000008101'), 1,
  'Una sola fila');

-- Atómico: si lo nuevo no nace (violaría un not null), lo anterior no se pierde.
select throws_ok(
  $$select * from privado.iniciar_diagnostico('c0000000-0000-0000-0000-000000008101', '20000000-0000-0000-0000-000000008101', 9, '{}', false, null, '{"version":1}', timestamptz '2020-03-10 12:00-05')$$,
  '23502', null, 'Un error de la base al crear (candidatas nulas) se propaga: el servidor lo trata como fallo');
select is(
  (select id from public.diagnostico_en_curso where id_sesion = 'c0000000-0000-0000-0000-000000008101'),
  (select id from r where k = 'c5'), 'Y el anterior sigue: solo se pierde si el nuevo nace');

-- Cuenta del equipo: un admin o un monitor no toman diagnósticos.
insert into r select 'e1', * from privado.iniciar_diagnostico(
  'a0000000-0000-0000-0000-000000008101', '20000000-0000-0000-0000-000000008101', 1, '{}', false, '[]', '{"version":1}', (select a from ref));
insert into r select 'e2', * from privado.iniciar_diagnostico(
  'b0000000-0000-0000-0000-000000008101', '20000000-0000-0000-0000-000000008101', 1, '{}', false, '[]', '{"version":1}', (select a from ref));
select is((select resultado || ' ' || coalesce(id::text, 'sin id') from r where k = 'e1'), 'cuenta_del_equipo sin id', 'Un admin: cuenta_del_equipo');
select is((select resultado || ' ' || coalesce(id::text, 'sin id') from r where k = 'e2'), 'cuenta_del_equipo sin id', 'Un monitor también');
select is(
  (select count(*)::int from public.diagnostico_en_curso where id_sesion in ('a0000000-0000-0000-0000-000000008101', 'b0000000-0000-0000-0000-000000008101')),
  0, 'Y no se escribe nada');

-- Bordes de las 2 horas, con una sesión cada uno: a 1 h 59 min 59 s sigue vigente y a las 2 horas exactas ya venció.
insert into r select 'b1', * from privado.iniciar_diagnostico(
  'c0000000-0000-0000-0000-000000008102', '20000000-0000-0000-0000-000000008101', 1, '{}', false, '[]', '{"version":1}', (select a from ref));
insert into r select 'b2', * from privado.iniciar_diagnostico(
  'c0000000-0000-0000-0000-000000008102', '20000000-0000-0000-0000-000000008101', 2, '{}', false, '[]', '{"version":1}', (select a from ref) + interval '1 hour 59 minutes 59 seconds');
select is((select resultado || ' ' || (id = (select id from r where k = 'b1'))::text from r where k = 'b2'), 'ya_en_curso true',
  'A 1 h 59 min 59 s de la última respuesta sigue vigente: la misma pregunta');
insert into r select 'b3', * from privado.iniciar_diagnostico(
  'c0000000-0000-0000-0000-000000008103', '20000000-0000-0000-0000-000000008101', 1, '{}', false, '[]', '{"version":1}', (select a from ref));
insert into r select 'b4', * from privado.iniciar_diagnostico(
  'c0000000-0000-0000-0000-000000008103', '20000000-0000-0000-0000-000000008101', 2, '{}', false, '[]', '{"version":1}', (select a from ref) + interval '2 hours');
select is((select resultado || ' ' || (id <> (select id from r where k = 'b3'))::text from r where k = 'b4'), 'creado true',
  'A las 2 horas exactas ya venció: empieza uno nuevo con otro id');
select results_eq(
  $$select semilla, actualizado_en, iniciado_en from public.diagnostico_en_curso where id_sesion = 'c0000000-0000-0000-0000-000000008103'$$,
  $$select 2::bigint, a + interval '2 hours', a + interval '2 hours' from ref$$,
  'Con otra semilla, y el vencido se borró (queda una fila con las dos fechas en p_ahora)');

-- Dos sesiones: reemplazar el en curso de una no toca el de la otra, tampoco el vencido (un delete sin id_sesion lo borraría).
insert into r select 'd1', * from privado.iniciar_diagnostico(
  'c0000000-0000-0000-0000-000000008110', '20000000-0000-0000-0000-000000008101', 1, '{}', false, '[]', '{"version":1}', (select a from ref));
insert into r select 'd2', * from privado.iniciar_diagnostico(
  'c0000000-0000-0000-0000-000000008111', '20000000-0000-0000-0000-000000008101', 2, '{}', false, '[]', '{"version":1}', (select a from ref) - interval '3 hours');
create temporary table antes_s11 as select * from public.diagnostico_en_curso where id_sesion = 'c0000000-0000-0000-0000-000000008111';
insert into r select 'd3', * from privado.iniciar_diagnostico(
  'c0000000-0000-0000-0000-000000008110', '20000000-0000-0000-0000-000000008103', 3, '{}', false, '[]', '{"version":1}', (select a from ref));
select is((select resultado from r where k = 'd3'), 'creado', 'La sesión 10 reemplaza su en curso con otra Evaluación');
select is_empty(
  $$select * from antes_s11 except select * from public.diagnostico_en_curso where id_sesion = 'c0000000-0000-0000-0000-000000008111'$$,
  'La fila de la sesión 11 (vencida) queda idéntica: los delete de iniciar llevan id_sesion');
select is((select count(*)::int from public.diagnostico_en_curso where id_sesion = 'c0000000-0000-0000-0000-000000008111'), 1,
  'Y la de la sesión 11 sigue ahí');
select is(
  (select array_agg(d.id_evaluacion) from public.diagnostico_en_curso d where d.id_sesion = 'c0000000-0000-0000-0000-000000008110'),
  array['20000000-0000-0000-0000-000000008103'::uuid], 'La sesión 10 tiene una sola fila y es la nueva');

-- ---------------------------------------------------------------------------
-- diagnostico_en_curso_de: la lectura vigente
-- ---------------------------------------------------------------------------
-- Dos sesiones con su en curso y una tercera sin ninguno: cada una recibe solo el suyo (un filtro por sesión que faltara mostraría la
-- pregunta de otra persona).
insert into r select 'l1', * from privado.iniciar_diagnostico(
  'c0000000-0000-0000-0000-000000008121', '20000000-0000-0000-0000-000000008101', 21, '{}', false, '[]', '{"version":1}', (select a from ref));
insert into r select 'l2', * from privado.iniciar_diagnostico(
  'c0000000-0000-0000-0000-000000008122', '20000000-0000-0000-0000-000000008103', 22, '{}', false, '[]', '{"version":1}', (select a from ref));
select is(
  (select array_agg(d.id) from privado.diagnostico_en_curso_de('c0000000-0000-0000-0000-000000008121', (select a from ref)) d),
  array[(select id from r where k = 'l1')], 'La sesión 21 recibe solo su diagnóstico en curso');
select is(
  (select array_agg(d.id) from privado.diagnostico_en_curso_de('c0000000-0000-0000-0000-000000008122', (select a from ref)) d),
  array[(select id from r where k = 'l2')], 'La sesión 22, solo el suyo');
select is(
  (select count(*)::int from privado.diagnostico_en_curso_de('c0000000-0000-0000-0000-000000008123', (select a from ref))),
  0, 'Una sesión sin diagnóstico en curso no recibe nada (ni el de otra)');
select is(
  (select semilla from privado.diagnostico_en_curso_de('c0000000-0000-0000-0000-000000008121', (select a from ref))),
  21::bigint, 'Trae la fila completa: la semilla y las copias que el servidor necesita');
select is(
  (select count(*)::int from privado.diagnostico_en_curso_de('c0000000-0000-0000-0000-000000008121', (select a from ref) + interval '1 hour 59 minutes 59 seconds')),
  1, 'A 1 h 59 min 59 s sigue vigente');
select is(
  (select count(*)::int from privado.diagnostico_en_curso_de('c0000000-0000-0000-0000-000000008121', (select a from ref) + interval '2 hours')),
  0, 'A las 2 horas exactas ya venció: no se devuelve');
select is(
  (select count(*)::int from public.diagnostico_en_curso where id_sesion = 'c0000000-0000-0000-0000-000000008121'),
  1, 'Leer el vencido no lo borra: no escribe nada (lo borran iniciar y la purga)');
select is(
  (select actualizado_en from public.diagnostico_en_curso where id_sesion = 'c0000000-0000-0000-0000-000000008121'),
  (select a from ref), 'Ni mueve actualizado_en');

-- ---------------------------------------------------------------------------
-- responder_diagnostico
-- ---------------------------------------------------------------------------
insert into r select 'r0', * from privado.iniciar_diagnostico(
  'c0000000-0000-0000-0000-000000008112', '20000000-0000-0000-0000-000000008101', 33, '{}', false, '[]', '{"version":1}', (select a from ref));
select is(
  privado.responder_diagnostico('c0000000-0000-0000-0000-000000008112', (select id from r where k = 'r0'), 0, '{"clave":"P1","letraElegida":"B"}',
    (select a from ref) + interval '1 minute'),
  true, 'Una respuesta con el paso pendiente se aplica');
select results_eq(
  $$select paso, pasos, actualizado_en from public.diagnostico_en_curso where id_sesion = 'c0000000-0000-0000-0000-000000008112'$$,
  $$select 1, '[{"clave":"P1","letraElegida":"B"}]'::jsonb, a + interval '1 minute' from ref$$,
  'El paso sube, la copia se agrega al final y actualizado_en se mueve a la hora de la respuesta');
create temporary table antes_r as select * from public.diagnostico_en_curso where id_sesion = 'c0000000-0000-0000-0000-000000008112';
select is(
  privado.responder_diagnostico('c0000000-0000-0000-0000-000000008112', (select id from r where k = 'r0'), 0, '{"clave":"P2"}', (select a from ref) + interval '2 minutes'),
  false, 'Repetida (doble clic, dos pestañas) o con el paso viejo: no se aplica');
select is(
  privado.responder_diagnostico('c0000000-0000-0000-0000-000000008112', (select id from r where k = 'r0'), 2, '{"clave":"P2"}', (select a from ref) + interval '2 minutes'),
  false, 'Con un paso adelantado, tampoco');
select is(
  privado.responder_diagnostico('c0000000-0000-0000-0000-000000008112', gen_random_uuid(), 1, '{"clave":"P2"}', (select a from ref) + interval '2 minutes'),
  false, 'Con el id de otro diagnóstico (la persona empezó otro en otra pestaña): no se aplica a este');
select is(
  privado.responder_diagnostico('c0000000-0000-0000-0000-000000008101', (select id from r where k = 'r0'), 1, '{"clave":"P2"}', (select a from ref) + interval '2 minutes'),
  false, 'Con el id de un diagnóstico de otra sesión, tampoco');
select is(
  privado.responder_diagnostico('c0000000-0000-0000-0000-000000008112', (select id from r where k = 'r0'), 1, '[{"clave":"P2"}]', (select a from ref) + interval '2 minutes'),
  false, 'Una copia que no es un objeto no se aplica');
select is(
  privado.responder_diagnostico('c0000000-0000-0000-0000-000000008112', (select id from r where k = 'r0'), 1, null, (select a from ref) + interval '2 minutes'),
  false, 'Ni una copia nula');
select is(
  privado.responder_diagnostico('c0000000-0000-0000-0000-000000008112', (select id from r where k = 'r0'), 1, '{"clave":"P2"}', (select a from ref) + interval '2 hours 1 minute'),
  false, 'A las 2 horas exactas de la última respuesta ya venció: no se aplica');
select is_empty(
  $$select * from antes_r except select * from public.diagnostico_en_curso where id_sesion = 'c0000000-0000-0000-0000-000000008112'$$,
  'Ninguno de esos intentos cambió la fila');
select is(
  privado.responder_diagnostico('c0000000-0000-0000-0000-000000008112', (select id from r where k = 'r0'), 1, '{"clave":"P2","letraElegida":"A"}',
    (select a from ref) + interval '2 hours 59 seconds'),
  true, 'A 1 h 59 min 59 s de la última respuesta sigue vigente: se aplica y alarga las 2 horas desde esa respuesta');
select results_eq(
  $$select paso, pasos from public.diagnostico_en_curso where id_sesion = 'c0000000-0000-0000-0000-000000008112'$$,
  $$select 2, '[{"clave":"P1","letraElegida":"B"},{"clave":"P2","letraElegida":"A"}]'::jsonb$$,
  'Las copias quedan en el orden en que se respondieron');
select is(
  privado.responder_diagnostico('c0000000-0000-0000-0000-000000008112', (select id from r where k = 'r0'), 2, '{"clave":"P3"}', (select a from ref) + interval '2 hours 59 seconds'),
  true, 'Y el paso siguiente se aplica: el paso sube de uno en uno');

-- ---------------------------------------------------------------------------
-- terminar_diagnostico
-- ---------------------------------------------------------------------------
-- Cuatro sesiones: la 04 creó el Lead 1, la 05 confirmó su correo, la 06 es su cuenta de Estudiante y la 13 no es de ningún Lead.
-- Cada una inicia (con la semilla 40 + su número), responde un paso y termina con P3.
create temporary table fin (sesion uuid, id uuid, paso integer);
insert into fin select s, (select id from privado.iniciar_diagnostico(s, '20000000-0000-0000-0000-000000008103', 40 + n, '{}', n = 5, '[]', '{"version":1}', (select a from ref))), 0
from (values ('c0000000-0000-0000-0000-000000008104'::uuid, 4), ('c0000000-0000-0000-0000-000000008105'::uuid, 5),
             ('c0000000-0000-0000-0000-000000008106'::uuid, 6), ('c0000000-0000-0000-0000-000000008113'::uuid, 13)) v(s, n);
select ok(
  (select bool_and(privado.responder_diagnostico(f.sesion, f.id, 0, '{"clave":"P1"}', (select a from ref) + interval '1 minute')) from fin f),
  'Las cuatro sesiones responden su primer paso');
update fin set paso = 1;

-- El candado 6801 por sesión (el de registrar_lead): la sesión 15 no lo tiene hasta que termina.
insert into r select 'f0', * from privado.iniciar_diagnostico(
  'c0000000-0000-0000-0000-000000008115', '20000000-0000-0000-0000-000000008103', 15, '{}', false, '[]', '{"version":1}', (select a from ref));
select ok(
  not exists (
    select 1 from pg_locks l
    where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.classid = 6801
      and l.objid = hashtext('c0000000-0000-0000-0000-000000008115')::oid and l.objsubid = 2),
  'Antes de terminar, la sesión 15 no tiene el candado 6801');
select is(
  (select resultado from privado.terminar_diagnostico('c0000000-0000-0000-0000-000000008115', (select id from r where k = 'f0'), 0, '{"clave":"P3"}',
     '{"habilidades":[],"errores":[],"prerrequisitos":[]}', '[]', 1, 100, (select a from ref) + interval '1 minute')),
  'terminado', 'Terminar con el paso pendiente: terminado');
select ok(
  exists (
    select 1 from pg_locks l
    where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.granted and l.classid = 6801
      and l.objid = hashtext('c0000000-0000-0000-0000-000000008115')::oid and l.objsubid = 2),
  'Terminar toma el candado 6801 de la sesión, el de registrar_lead: o el Lead ya existe al calcular id_lead o registrar_lead corre después y lo liga');
select is(
  (select id_lead from public.diagnostico where id = (select id from r where k = 'f0')),
  null::uuid, 'Una sesión que no es de ningún Lead: el diagnóstico nace sin id_lead (registrar_lead lo ligará después)');
delete from public.diagnostico where id = (select id from r where k = 'f0');

-- Terminar con la sesión 04: el diagnóstico nace completo y el en curso se borra.
create temporary table term (k text, resultado text, id uuid);
insert into term
select 'u' || right(f.sesion::text, 2), t.resultado, t.id
from fin f
cross join lateral privado.terminar_diagnostico(f.sesion, f.id, f.paso, '{"clave":"P3"}',
  '{"habilidades":[{"habilidad":"potencia","nivel":"lo_domina"}],"errores":[],"prerrequisitos":[]}',
  '[{"habilidad":"potencia","motivos":["sin_preguntas_sin_ver"]}]', 2, 100, (select a from ref) + interval '2 minutes') t;
select is((select count(*)::int from term where resultado = 'terminado'), 4, 'Las cuatro terminan');
select is((select count(*)::int from term t join fin f on f.id = t.id), 4, 'Cada una devuelve el id de su en curso: es el id que tendrá el diagnóstico');
select is((select count(*)::int from public.diagnostico_en_curso where id in (select id from fin)), 0, 'Y los en curso se borraron en la misma transacción');
select results_eq(
  $$select d.id_sesion_anonima, d.id_evaluacion, d.id_materia, d.respuestas, d.puntaje, d.resultado_por_habilidad, d.falta_material,
           d.aciertos, d.semilla, d.repetido, d.respondidas, d.fecha_realizacion
    from public.diagnostico d where d.id = (select id from fin where sesion = 'c0000000-0000-0000-0000-000000008104')$$,
  $$select 'c0000000-0000-0000-0000-000000008104'::uuid, '20000000-0000-0000-0000-000000008103'::uuid, '10000000-0000-0000-0000-000000008101'::uuid,
           '[{"clave":"P1"},{"clave":"P3"}]'::jsonb, 100::numeric,
           '{"habilidades":[{"habilidad":"potencia","nivel":"lo_domina"}],"errores":[],"prerrequisitos":[]}'::jsonb,
           '[{"habilidad":"potencia","motivos":["sin_preguntas_sin_ver"]}]'::jsonb,
           2::smallint, 44::bigint, false, 2, a + interval '2 minutes' from ref$$,
  'El diagnóstico guarda las copias (las del en curso más la última), el puntaje, el resultado, la marca de falta de material aparte, los aciertos, la semilla y la fecha; respondidas se genera');
select is((select repetido from public.diagnostico where id = (select id from fin where sesion = 'c0000000-0000-0000-0000-000000008105')), true,
  'La marca de repetido (D-51) pasa del en curso al diagnóstico');
select is(
  (select array_agg(d.id_lead order by d.id_sesion_anonima) from public.diagnostico d where d.id in (select id from fin)),
  array['40000000-0000-0000-0000-000000008101'::uuid, '40000000-0000-0000-0000-000000008101'::uuid, '40000000-0000-0000-0000-000000008101'::uuid, null::uuid],
  'Nace con id_lead cuando la sesión ya es de un Lead, por las tres vías (creó, confirmó el correo, cuenta de Estudiante), y nulo si no (hueco 3)');
select matches((select token_recuperacion from public.diagnostico where id = (select id from fin where sesion = 'c0000000-0000-0000-0000-000000008104')),
  '^[0-9a-f]{64}$', 'El token de recuperación toma su valor por defecto: 64 caracteres hexadecimales');
select is((select count(distinct token_recuperacion)::int from public.diagnostico where id in (select id from fin)), 4, 'Y es único');

-- No aplicada: sin escribir, y la segunda llamada no duplica.
select is(
  (select resultado from privado.terminar_diagnostico('c0000000-0000-0000-0000-000000008104', (select id from fin where sesion = 'c0000000-0000-0000-0000-000000008104'),
     1, '{"clave":"P3"}', '{"habilidades":[],"errores":[],"prerrequisitos":[]}', '[]', 2, 100, (select a from ref) + interval '3 minutes')),
  'no_aplicada', 'La segunda llamada (doble clic en la última respuesta) da no_aplicada');
select is((select count(*)::int from public.diagnostico where id = (select id from fin where sesion = 'c0000000-0000-0000-0000-000000008104')), 1,
  'Y no duplica el diagnóstico');

insert into r select 'n0', * from privado.iniciar_diagnostico(
  'c0000000-0000-0000-0000-000000008124', '20000000-0000-0000-0000-000000008103', 77, '{}', false, '[]', '{"version":1}', (select a from ref));
select is(
  privado.responder_diagnostico('c0000000-0000-0000-0000-000000008124', (select id from r where k = 'n0'), 0, '{"clave":"P1"}', (select a from ref) + interval '1 minute'),
  true, 'La sesión 24 responde su primer paso');
create temporary table antes_n0 as select * from public.diagnostico_en_curso where id_sesion = 'c0000000-0000-0000-0000-000000008124';
select is(
  (select resultado from privado.terminar_diagnostico('c0000000-0000-0000-0000-000000008124', (select id from r where k = 'n0'), 0, '{"clave":"P3"}',
     '{"habilidades":[],"errores":[],"prerrequisitos":[]}', '[]', 1, 100, (select a from ref) + interval '2 minutes')),
  'no_aplicada', 'Con el paso viejo: no_aplicada');
select is(
  (select resultado from privado.terminar_diagnostico('c0000000-0000-0000-0000-000000008124', (select id from r where k = 'n0'), 2, '{"clave":"P3"}',
     '{"habilidades":[],"errores":[],"prerrequisitos":[]}', '[]', 1, 100, (select a from ref) + interval '2 minutes')),
  'no_aplicada', 'Con un paso adelantado, también');
select is(
  (select resultado from privado.terminar_diagnostico('c0000000-0000-0000-0000-000000008124', gen_random_uuid(), 1, '{"clave":"P3"}',
     '{"habilidades":[],"errores":[],"prerrequisitos":[]}', '[]', 1, 100, (select a from ref) + interval '2 minutes')),
  'no_aplicada', 'Con el id de otro diagnóstico, también');
select is(
  (select resultado from privado.terminar_diagnostico('c0000000-0000-0000-0000-000000008101', (select id from r where k = 'n0'), 1, '{"clave":"P3"}',
     '{"habilidades":[],"errores":[],"prerrequisitos":[]}', '[]', 1, 100, (select a from ref) + interval '2 minutes')),
  'no_aplicada', 'Con el id de una sesión ajena, también');
select is(
  (select resultado from privado.terminar_diagnostico('c0000000-0000-0000-0000-000000008124', (select id from r where k = 'n0'), 1, '{"clave":"P3"}',
     '{"habilidades":[],"errores":[],"prerrequisitos":[]}', '[]', 1, 100, (select a from ref) + interval '1 minute' + interval '2 hours')),
  'no_aplicada', 'Vencido (a las 2 horas exactas de la última respuesta): no_aplicada');
select is_empty(
  $$select * from antes_n0 except select * from public.diagnostico_en_curso where id_sesion = 'c0000000-0000-0000-0000-000000008124'$$,
  'Ninguna de esas llamadas escribió nada: el en curso sigue igual');
select is((select count(*)::int from public.diagnostico where id_sesion_anonima = 'c0000000-0000-0000-0000-000000008124'), 0,
  'Y no hay diagnóstico a medias');
select throws_ok(
  $$select * from privado.terminar_diagnostico('c0000000-0000-0000-0000-000000008124', (select id from public.diagnostico_en_curso where id_sesion = 'c0000000-0000-0000-0000-000000008124'),
     1, '[{"clave":"P3"}]', '{"habilidades":[],"errores":[],"prerrequisitos":[]}', '[]', 1, 100, timestamptz '2020-03-10 12:02-05')$$,
  '22023', null, 'Una copia que no es un objeto no termina nada (el servidor la arma siempre como objeto)');

-- Si el INSERT viola un check, el en curso sigue y no hay diagnóstico (aciertos de más).
select throws_ok(
  $$select * from privado.terminar_diagnostico('c0000000-0000-0000-0000-000000008124', (select id from public.diagnostico_en_curso where id_sesion = 'c0000000-0000-0000-0000-000000008124'),
     1, '{"clave":"P3"}', '{"habilidades":[],"errores":[],"prerrequisitos":[]}', '[]', 5, 100, timestamptz '2020-03-10 12:02-05')$$,
  '23514', 'new row for relation "diagnostico" violates check constraint "diagnostico_aciertos_en_rango"',
  'Un check roto al insertar (más aciertos que preguntas) hace fallar a terminar');
select is_empty(
  $$select * from antes_n0 except select * from public.diagnostico_en_curso where id_sesion = 'c0000000-0000-0000-0000-000000008124'$$,
  'El en curso sigue intacto: todo ocurre en una transacción');
select is((select count(*)::int from public.diagnostico where id_sesion_anonima = 'c0000000-0000-0000-0000-000000008124'), 0,
  'Y no quedó ningún diagnóstico a medias');

-- ---------------------------------------------------------------------------
-- Las puertas públicas, con la llave secreta y la hora de la base
-- ---------------------------------------------------------------------------
set local role service_role;
insert into r select 'p1', * from public.iniciar_diagnostico(
  'c0000000-0000-0000-0000-000000008116', '20000000-0000-0000-0000-000000008103', 88, array['P9'], false, '[{"clave":"P1"}]', '{"version":1}');
select is((select resultado from r where k = 'p1'), 'creado', 'La puerta de iniciar crea el en curso con la hora de la base');
select is(
  (select array_agg(d.id) from public.diagnostico_en_curso_de('c0000000-0000-0000-0000-000000008116') d),
  array[(select id from r where k = 'p1')], 'La de leer devuelve el en curso vigente (recién creado con now())');
select is(public.responder_diagnostico('c0000000-0000-0000-0000-000000008116', (select id from r where k = 'p1'), 0, '{"clave":"P1"}'), true,
  'La de responder aplica el paso pendiente');
select is(public.responder_diagnostico('c0000000-0000-0000-0000-000000008116', (select id from r where k = 'p1'), 0, '{"clave":"P1"}'), false,
  'Y no lo aplica dos veces');
select is(
  (select resultado || ' ' || (id = (select id from r where k = 'p1'))::text from public.iniciar_diagnostico(
    'c0000000-0000-0000-0000-000000008116', '20000000-0000-0000-0000-000000008103', 1, '{}', false, '[]', '{"version":1}')),
  'ya_en_curso true', 'Iniciar otra vez la misma Evaluación devuelve la pendiente');
select is(
  (select resultado from public.terminar_diagnostico('c0000000-0000-0000-0000-000000008116', (select id from r where k = 'p1'), 1, '{"clave":"P2"}',
     '{"habilidades":[],"errores":[],"prerrequisitos":[]}', '[]', 1, 50)),
  'terminado', 'La de terminar inserta el diagnóstico y borra el en curso');
select results_eq(
  $$select claves, id_ultimo from public.vistas_de_la_sesion('c0000000-0000-0000-0000-000000008116', '20000000-0000-0000-0000-000000008103')$$,
  $$select array['P1','P2']::text[], (select id from r where k = 'p1')$$,
  'Y las vistas antes de esa sesión ya cuentan lo que hizo');
select is(
  (select resultado || ' ' || coalesce(id::text, 'sin id') from public.iniciar_diagnostico(
    'a0000000-0000-0000-0000-000000008101', '20000000-0000-0000-0000-000000008103', 1, '{}', false, '[]', '{"version":1}')),
  'cuenta_del_equipo sin id', 'La puerta también frena a un admin');
reset role;

-- ---------------------------------------------------------------------------
-- La purga
-- ---------------------------------------------------------------------------
-- Cuatro en curso con la última respuesta hace 3 horas (vencido), hace 2 horas exactas (vencido, el borde), hace 1 h 59 min (vigente) y
-- ahora (vigente). Los de las pruebas de arriba (el de la sesión 11, vencido, y los demás) también cuentan: se compara contra el total.
insert into public.diagnostico_en_curso (id, id_sesion, id_evaluacion, id_materia, semilla, candidatas, contexto, actualizado_en)
select ('60000000-0000-0000-0000-0000000081' || lpad(n::text, 2, '0'))::uuid,
  ('c0000000-0000-0000-0000-0000000081' || lpad(n::text, 2, '0'))::uuid,
  '20000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008101', n, '[]', '{"version":1}',
  (select a from ref) - (case n when 17 then interval '3 hours' when 18 then interval '2 hours' when 19 then interval '1 hour 59 minutes' else interval '0' end)
from generate_series(17, 20) n;
create temporary table purga as select
  (select count(*)::int from public.diagnostico_en_curso) as antes,
  (select count(*)::int from public.diagnostico) as diagnosticos_antes,
  privado.purgar_diagnosticos_en_curso((select a from ref)) as borrados;
select is((select antes - borrados from purga), (select count(*)::int from public.diagnostico_en_curso),
  'La purga devuelve cuántos borró');
select cmp_ok((select borrados from purga), '>=', 3, 'Borró al menos los dos vencidos de la prueba y el de la sesión 11');
select is(
  (select array_agg(right(id_sesion::text, 2) order by id_sesion) from public.diagnostico_en_curso
   where id_sesion in ('c0000000-0000-0000-0000-000000008117', 'c0000000-0000-0000-0000-000000008118', 'c0000000-0000-0000-0000-000000008119', 'c0000000-0000-0000-0000-000000008120')),
  array['19', '20'], 'Borra solo los vencidos (hace 3 horas y hace 2 horas exactas) y deja los vigentes (hace 1 h 59 min y ahora)');
select is((select count(*)::int from public.diagnostico_en_curso where id_sesion = 'c0000000-0000-0000-0000-000000008111'), 0,
  'También el vencido de la sesión 11: la purga es de todas las sesiones');
select is((select count(*)::int from public.diagnostico), (select diagnosticos_antes from purga), 'La purga no toca los diagnósticos terminados');
select is(privado.purgar_diagnosticos_en_curso((select a from ref)), 0, 'Correrla dos veces seguidas no borra nada la segunda');

-- ---------------------------------------------------------------------------
-- Quién lee qué (las políticas de lectura no cambian; las columnas sí)
-- ---------------------------------------------------------------------------
-- Un monitor con una cita ligada al diagnóstico de la sesión 04 (D-7: lo lee el monitor de la cita, hasta que HU-022 lo cierre).
insert into public.certificado (id, id_monitor, id_materia, id_admin) values
  ('90000000-0000-0000-0000-000000008101', 'b0000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008101', 'a0000000-0000-0000-0000-000000008101');
insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min) values
  ('30000000-0000-0000-0000-000000008101', 'b0000000-0000-0000-0000-000000008101', 1, '10:00', true, 25000, 60);
insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, id_diagnostico) values
  ('50000000-0000-0000-0000-000000008101', '30000000-0000-0000-0000-000000008101', '10000000-0000-0000-0000-000000008101',
   '40000000-0000-0000-0000-000000008101', (date_trunc('week', now() at time zone 'America/Bogota') + interval '14 days')::date, 25000,
   (select id from fin where sesion = 'c0000000-0000-0000-0000-000000008104'));
create temporary table dx as select id from fin where sesion = 'c0000000-0000-0000-0000-000000008104';
grant select on dx to authenticated;
create temporary table columnas (c text);
insert into columnas values ('respuestas'), ('semilla'), ('repetido'), ('respondidas'), ('aciertos'), ('falta_material'), ('token_recuperacion');
grant select on columnas to authenticated;

-- La sesión que terminó el diagnóstico y la otra sesión del mismo Lead (nació con id_lead: la ve aunque lo hizo otra).
set local role authenticated;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000008104","role":"authenticated","is_anonymous":true}';
select is((select count(*)::int from public.diagnostico d join dx on dx.id = d.id), 1, 'La sesión dueña lee su diagnóstico (id, puntaje y resultado por habilidad)');
select results_eq(
  $$select d.puntaje, d.resultado_por_habilidad -> 'habilidades' -> 0 ->> 'habilidad' from public.diagnostico d join dx on dx.id = d.id$$,
  $$values (100::numeric, 'potencia'::text)$$, 'Con el resultado por habilidad que guardó el servidor');
select throws_ok(format('select %I from public.diagnostico limit 1', c), '42501', null, 'La sesión dueña no lee ' || c)
from columnas order by c;
select throws_ok($$select * from public.diagnostico_en_curso$$, '42501', null, 'Ni el en curso de nadie (permiso denegado)');
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000008105","role":"authenticated","is_anonymous":true}';
select is((select count(*)::int from public.diagnostico d join dx on dx.id = d.id), 1,
  'Otra sesión del mismo Lead (confirmó el correo) lee el diagnóstico: nació con id_lead del Lead');
select throws_ok(format('select %I from public.diagnostico limit 1', c), '42501', null, 'La otra sesión del Lead no lee ' || c)
from columnas order by c;
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000008106","role":"authenticated","is_anonymous":false}';
select is((select count(*)::int from public.diagnostico d join dx on dx.id = d.id), 1, 'La cuenta de Estudiante del Lead también');
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000008107","role":"authenticated","is_anonymous":true}';
select is((select count(*)::int from public.diagnostico d join dx on dx.id = d.id), 0, 'Una sesión de otro Lead no lo ve');
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000008103","role":"authenticated","is_anonymous":true}';
select is((select count(*)::int from public.diagnostico d join dx on dx.id = d.id), 0, 'Ni una sesión sin Lead');
-- El monitor de la cita ve ese diagnóstico, solo por esas columnas.
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-000000008101","role":"authenticated","is_anonymous":false}';
select is((select count(*)::int from public.diagnostico d join dx on dx.id = d.id), 1, 'El monitor de la cita lo lee (D-7)');
select is((select count(*)::int from public.diagnostico), 1, 'Y solo ese: no los demás diagnósticos de la materia');
select throws_ok(format('select %I from public.diagnostico limit 1', c), '42501', null, 'El monitor de la cita no lee ' || c)
from columnas order by c;
select throws_ok($$select * from public.diagnostico_en_curso$$, '42501', null, 'Ni el monitor lee el en curso');
-- El admin ve todas las filas, con las mismas columnas.
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-000000008101","role":"authenticated","is_anonymous":false}';
select is((select count(*)::int from public.diagnostico d join dx on dx.id = d.id), 1, 'El admin lee el diagnóstico');
select throws_ok(format('select %I from public.diagnostico limit 1', c), '42501', null, 'El admin no lee ' || c)
from columnas order by c;
select throws_ok($$select * from public.diagnostico_en_curso$$, '42501', null, 'Ni el admin lee el en curso');
reset role;
set local role anon;
select throws_ok($$select id from public.diagnostico$$, '42501', null, 'El visitante sin sesión no lee diagnostico');
select throws_ok($$select * from public.diagnostico_en_curso$$, '42501', null, 'Ni diagnostico_en_curso');
reset role;

select * from finish();
rollback;
