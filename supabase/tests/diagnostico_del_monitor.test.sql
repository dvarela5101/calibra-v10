-- Pruebas pgTAP del diagnóstico del monitor (HU-022): public.diagnostico_de_mi_monitoria(id_monitoria), sus dos capas de privado
-- y el cierre de la política de lectura de `diagnostico`.
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.
--
-- La puerta pública y la capa `_ahora` usan now(): lo que depende de la hora real (estados, 29 y 31 días) se prueba con citas
-- cuya fecha sale de "hoy en Bogotá". La frontera de los 30 días se prueba con el núcleo privado.diagnostico_de_mi_monitoria(id,
-- p_ahora), que no ejecuta ninguna sesión: se llama como postgres, con los claims del monitor puestos (auth.uid() lee ese ajuste).
-- Las monitorías se insertan como postgres: un trigger completa id_monitor y exige que la fecha caiga en el día de la franja, así
-- que cada cita tiene su propia franja, con el día de la semana de su fecha.
--
-- Elenco (ids terminados en 0022NN). Materia 'PGTAP-22-A' (nombre 'Materia Veintidós') y su Evaluación 'Parcial Veintidós Alfa': los
-- nombres son distintos entre sí y de los códigos. Nombres, correo y teléfono del Lead son únicos para buscarlos.
--   Monitores: A (dicta todas las citas) y B (otro monitor). Admin 01.
--   Leads (cada uno con su sesión anónima): 01 Lucía, autorizó con v2, sesión 01; 02 Mateo, v1, sesión 02; 03 Nora, v2, sesión 04.
--   Sesión 03: anónima sin Lead.
--   Citas de A (50000000-...-0022NN), todas con la misma materia:
--     01 confirmada, Lead 01, diagnóstico 01 completo (8 preguntas, 3 falladas, repetido), lunes 2-nov 10:00, 90 min
--     02 confirmada, Lead 01, sin diagnóstico           03 confirmada, Lead 01, con un pago rechazado (P-24)
--     04 realizada, el fin hace unos 29 días            05 pendiente de pago vigente        06 pendiente de pago vencida
--     07 cancelada                                      08 realizada, el fin hace unos 31 días
--     09 confirmada, grupal (tiene fila en monitoria_grupal)                               10 confirmada, el fin hace unos 40 días
--     11 realizada, lunes 7-sep-2026 10:00, 90 min, finalizada un día después (el reloj de los 30 días)
--     12 Lead 02 (v1), diagnóstico del Lead 02          13 Lead 01 (v2), diagnóstico de otro Lead (03, v2)
--     14 Lead 02 (v1), diagnóstico de otro Lead (03, v2)  15 Lead 01 (v2), diagnóstico sin Lead (de la sesión 01)
--     16 Lead 02 (v1), diagnóstico sin Lead (de la sesión 02)                              17 Lead 01, diagnóstico que se borra
--   Diagnósticos (60000000-...-0022NN): 01 a 17 ligados a la cita del mismo número por monitoria.id_diagnostico; 90, con
--   diagnostico.id_monitoria de la cita individual 02; 91, con id_monitoria de la grupal 09.

begin;
create extension if not exists pgtap with schema extensions;

select plan(91);

-- ---------------------------------------------------------------------------
-- Estructura y permisos
-- ---------------------------------------------------------------------------
select has_function('privado', 'diagnostico_de_mi_monitoria', array['uuid', 'timestamp with time zone'],
  'Existe el núcleo privado.diagnostico_de_mi_monitoria(id, p_ahora), con la hora como parámetro');
select has_function('privado', 'diagnostico_de_mi_monitoria_ahora', array['uuid'],
  'Existe la capa que pone la hora de la base: privado.diagnostico_de_mi_monitoria_ahora(id)');
select has_function('public', 'diagnostico_de_mi_monitoria', array['uuid'],
  'Existe su puerta en la Data API: public.diagnostico_de_mi_monitoria(id)');
select has_function('privado', 'dias_de_vista_tras_realizada', '{}'::name[],
  'Existe privado.dias_de_vista_tras_realizada(), el plazo de una realizada');
select has_function('privado', 'dicta_grupal', array['uuid'],
  'Existe privado.dicta_grupal(id), la cláusula de las grupales en la política de diagnostico');

select ok(
  (select count(*) = 3
          and bool_and(prosecdef) filter (where oid <> 'public.diagnostico_de_mi_monitoria(uuid)'::regprocedure)
          and not bool_or(prosecdef) filter (where oid = 'public.diagnostico_de_mi_monitoria(uuid)'::regprocedure)
   from pg_proc
   where oid in ('privado.diagnostico_de_mi_monitoria(uuid, timestamptz)'::regprocedure,
                 'privado.diagnostico_de_mi_monitoria_ahora(uuid)'::regprocedure,
                 'public.diagnostico_de_mi_monitoria(uuid)'::regprocedure)),
  'El núcleo y la capa _ahora son security definer (leen lead, monitoria_grupal y las columnas sin grant); la puerta corre con los permisos de quien llama');
-- Con coalesce y contando las cinco: sin search_path, proconfig es nulo y el bool_and solo ignoraría esa función.
select ok(
  (select count(*) = 5 and bool_and(coalesce('search_path=""' = any(proconfig), false))
   from pg_proc
   where oid in ('privado.diagnostico_de_mi_monitoria(uuid, timestamptz)'::regprocedure,
                 'privado.diagnostico_de_mi_monitoria_ahora(uuid)'::regprocedure,
                 'public.diagnostico_de_mi_monitoria(uuid)'::regprocedure,
                 'privado.dias_de_vista_tras_realizada()'::regprocedure,
                 'privado.dicta_grupal(uuid)'::regprocedure)),
  'Las cinco fijan un search_path vacío');
select ok(
  (select count(*) = 3 and bool_and(provolatile = 's')
   from pg_proc
   where oid in ('privado.diagnostico_de_mi_monitoria(uuid, timestamptz)'::regprocedure,
                 'privado.diagnostico_de_mi_monitoria_ahora(uuid)'::regprocedure,
                 'public.diagnostico_de_mi_monitoria(uuid)'::regprocedure)),
  'Las tres capas son stable: solo leen, no escriben ni toman candados');

select is(
  pg_get_function_result('privado.diagnostico_de_mi_monitoria(uuid, timestamptz)'::regprocedure),
  'TABLE(fecha date, hora time without time zone, duracion_min integer, nombre_materia text, nombre_estudiante text, hay_diagnostico boolean, nombre_evaluacion text, fecha_realizacion timestamp with time zone, respondidas integer, aciertos integer, repetido boolean, habilidades jsonb, errores jsonb, prerrequisitos jsonb, respuestas_autorizadas boolean, preguntas jsonb)',
  'El núcleo devuelve exactamente esas 16 columnas, en ese orden: ni correo, teléfono, token, semilla, falta de material ni ids del Lead o de la sesión');
select is(
  pg_get_function_result('privado.diagnostico_de_mi_monitoria_ahora(uuid)'::regprocedure),
  pg_get_function_result('privado.diagnostico_de_mi_monitoria(uuid, timestamptz)'::regprocedure),
  'La capa _ahora devuelve las mismas 16 columnas, en el mismo orden');
select is(
  pg_get_function_result('public.diagnostico_de_mi_monitoria(uuid)'::regprocedure),
  pg_get_function_result('privado.diagnostico_de_mi_monitoria(uuid, timestamptz)'::regprocedure),
  'La puerta devuelve las mismas 16 columnas, en el mismo orden');
select is(
  array[pg_get_function_identity_arguments('privado.diagnostico_de_mi_monitoria(uuid, timestamptz)'::regprocedure),
        pg_get_function_identity_arguments('privado.diagnostico_de_mi_monitoria_ahora(uuid)'::regprocedure),
        pg_get_function_identity_arguments('public.diagnostico_de_mi_monitoria(uuid)'::regprocedure)],
  array['p_id_monitoria uuid, p_ahora timestamp with time zone', 'p_id_monitoria uuid', 'p_id_monitoria uuid'],
  'La puerta solo recibe la cita: el monitor sale del JWT y la hora es la de la base, nunca un parámetro');

select ok(
  not has_function_privilege('anon', 'public.diagnostico_de_mi_monitoria(uuid)', 'execute')
  and not has_function_privilege('anon', 'privado.diagnostico_de_mi_monitoria_ahora(uuid)', 'execute')
  and not has_function_privilege('anon', 'privado.diagnostico_de_mi_monitoria(uuid, timestamptz)', 'execute')
  and not has_function_privilege('anon', 'privado.dias_de_vista_tras_realizada()', 'execute')
  and not has_function_privilege('anon', 'privado.dicta_grupal(uuid)', 'execute'),
  'El visitante sin sesión (anon) no ejecuta ninguna');
select ok(
  not has_function_privilege('service_role', 'public.diagnostico_de_mi_monitoria(uuid)', 'execute')
  and not has_function_privilege('service_role', 'privado.diagnostico_de_mi_monitoria_ahora(uuid)', 'execute')
  and not has_function_privilege('service_role', 'privado.diagnostico_de_mi_monitoria(uuid, timestamptz)', 'execute')
  and not has_function_privilege('service_role', 'privado.dias_de_vista_tras_realizada()', 'execute')
  and not has_function_privilege('service_role', 'privado.dicta_grupal(uuid)', 'execute'),
  'service_role tampoco: sin sesión no hay auth.uid() ni monitor');
select ok(
  has_function_privilege('authenticated', 'public.diagnostico_de_mi_monitoria(uuid)', 'execute')
  and has_function_privilege('authenticated', 'privado.diagnostico_de_mi_monitoria_ahora(uuid)', 'execute')
  and has_function_privilege('authenticated', 'privado.dicta_grupal(uuid)', 'execute'),
  'Con sesión se ejecutan la puerta (invoker), la capa _ahora que ella llama y dicta_grupal (la política corre como quien lee)');
select ok(
  not has_function_privilege('authenticated', 'privado.diagnostico_de_mi_monitoria(uuid, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'privado.dias_de_vista_tras_realizada()', 'execute'),
  'Nadie con sesión ejecuta el núcleo con p_ahora ni el plazo: la hora queda fuera del alcance de las sesiones');
select ok(
  not exists (
    select 1
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid in ('privado.diagnostico_de_mi_monitoria(uuid, timestamptz)'::regprocedure,
                    'privado.diagnostico_de_mi_monitoria_ahora(uuid)'::regprocedure,
                    'public.diagnostico_de_mi_monitoria(uuid)'::regprocedure,
                    'privado.dias_de_vista_tras_realizada()'::regprocedure,
                    'privado.dicta_grupal(uuid)'::regprocedure)
      and a.grantee = 0),
  'Nadie las hereda de PUBLIC');
select is(privado.dias_de_vista_tras_realizada(), 30, 'D-54 b: una cita realizada se ve hasta 30 días después del fin de la sesión');
select ok(to_regprocedure('privado.dicta_cita_con_diagnostico(uuid)') is null,
  'privado.dicta_cita_con_diagnostico ya no existe: la política no la usa y se borró');

-- ---------------------------------------------------------------------------
-- Fixtures (como postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, is_anonymous) values
  ('a0000000-0000-0000-0000-000000002201', false),
  ('b0000000-0000-0000-0000-0000000022a0', false),
  ('b0000000-0000-0000-0000-0000000022b0', false),
  ('c0000000-0000-0000-0000-000000002201', true),
  ('c0000000-0000-0000-0000-000000002202', true),
  ('c0000000-0000-0000-0000-000000002203', true),
  ('c0000000-0000-0000-0000-000000002204', true);

insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-000000002201', 'Admin 22', 'admin22@calibra.test', 9002201);
insert into public.monitor (id, nombre) values
  ('b0000000-0000-0000-0000-0000000022a0', 'Ana 22'),
  ('b0000000-0000-0000-0000-0000000022b0', 'Beto 22');

insert into public.materia (id, nombre, codigo) values
  ('10000000-0000-0000-0000-0000000022a1', 'Materia Veintidós', 'PGTAP-22-A');
insert into public.evaluacion (id, id_materia, semana, nombre) values
  ('20000000-0000-0000-0000-0000000022a1', '10000000-0000-0000-0000-0000000022a1', 5, 'Parcial Veintidós Alfa');
insert into public.certificado (id_monitor, id_materia, id_admin) values
  ('b0000000-0000-0000-0000-0000000022a0', '10000000-0000-0000-0000-0000000022a1', 'a0000000-0000-0000-0000-000000002201'),
  ('b0000000-0000-0000-0000-0000000022b0', '10000000-0000-0000-0000-0000000022a1', 'a0000000-0000-0000-0000-000000002201');

-- Tres Leads con contacto único. Solo el 01 y el 03 autorizaron con el texto que nombra las respuestas (v2, HU-087).
insert into public.lead (id, id_sesion_anonima, nombre, numero_telefono, correo, acepta_tratamiento_datos, fecha_consentimiento, version_autorizacion) values
  ('40000000-0000-0000-0000-000000002201', 'c0000000-0000-0000-0000-000000002201', 'Lucía Veintidós', '3002201111',
   'lucia.secreta22@calibra.test', true, now(), 'v2'),
  ('40000000-0000-0000-0000-000000002202', 'c0000000-0000-0000-0000-000000002202', 'Mateo Veintidós', '3002202222',
   'mateo.secreto22@calibra.test', true, now(), 'v1'),
  ('40000000-0000-0000-0000-000000002203', 'c0000000-0000-0000-0000-000000002204', 'Nora Veintidós', '3002203333',
   'nora.secreta22@calibra.test', true, now(), 'v2');

-- Hoy en Bogotá, para las fechas que dependen de now().
create temporary table ref_22 as select (now() at time zone 'America/Bogota')::date as hoy;

-- Las citas: una franja por cita, con el día de la semana de su fecha. Las realizadas de hace 29 y 31 días empiezan a las 00:30 y
-- duran 90 minutos, así que su fin queda entre 28 días y 22 horas y 29 días y 22 horas (la de 29) y entre 30 días y 22 horas y
-- 31 días y 22 horas (la de 31) antes de now(): a un lado y al otro de los 30 días sea cual sea la hora a la que corra la prueba.
-- Las finalizadas llevan una fecha_finalizacion que NO es el fin de la sesión, para que el plazo no dependa de ella.
create temporary table citas_22 (
  nn text primary key, id_lead uuid, estado public.estado_monitoria, motivo public.motivo_cancelacion,
  fecha date, hora time, dur integer, finalizada timestamptz, creada timestamptz
);
insert into citas_22 (nn, id_lead, estado, motivo, fecha, hora, dur, finalizada, creada)
select v.nn, v.id_lead::uuid, v.estado::public.estado_monitoria, v.motivo::public.motivo_cancelacion, v.fecha, v.hora::time, v.dur,
       v.finalizada, coalesce(v.creada, now())
from (values
  ('01', '40000000-0000-0000-0000-000000002201', 'confirmada', null, date '2026-11-02', '10:00', 90, null::timestamptz, null::timestamptz),
  ('02', '40000000-0000-0000-0000-000000002201', 'confirmada', null, date '2026-11-09', '10:00', 60, null, null),
  ('03', '40000000-0000-0000-0000-000000002201', 'confirmada', null, (select hoy from ref_22) + 10, '09:00', 60, null, null),
  ('04', '40000000-0000-0000-0000-000000002201', 'realizada', null, (select hoy from ref_22) - 29, '00:30', 90, now() - interval '40 days', null),
  ('05', '40000000-0000-0000-0000-000000002201', 'pendiente_pago', null, (select hoy from ref_22) + 12, '09:00', 60, null, null),
  ('06', '40000000-0000-0000-0000-000000002201', 'pendiente_pago', null, (select hoy from ref_22) + 13, '09:00', 60, null, now() - interval '3 days'),
  ('07', '40000000-0000-0000-0000-000000002201', 'cancelada', 'estudiante', (select hoy from ref_22) + 14, '09:00', 60, null, null),
  ('08', '40000000-0000-0000-0000-000000002201', 'realizada', null, (select hoy from ref_22) - 31, '00:30', 90, now() - interval '1 day', null),
  ('09', '40000000-0000-0000-0000-000000002201', 'confirmada', null, (select hoy from ref_22) + 16, '09:00', 60, null, null),
  ('10', '40000000-0000-0000-0000-000000002201', 'confirmada', null, (select hoy from ref_22) - 40, '00:30', 90, null, null),
  ('11', '40000000-0000-0000-0000-000000002201', 'realizada', null, date '2026-09-07', '10:00', 90, timestamptz '2026-09-08 11:30-05', null),
  ('12', '40000000-0000-0000-0000-000000002202', 'confirmada', null, (select hoy from ref_22) + 20, '09:00', 60, null, null),
  ('13', '40000000-0000-0000-0000-000000002201', 'confirmada', null, (select hoy from ref_22) + 21, '09:00', 60, null, null),
  ('14', '40000000-0000-0000-0000-000000002202', 'confirmada', null, (select hoy from ref_22) + 22, '09:00', 60, null, null),
  ('15', '40000000-0000-0000-0000-000000002201', 'confirmada', null, (select hoy from ref_22) + 23, '09:00', 60, null, null),
  ('16', '40000000-0000-0000-0000-000000002202', 'confirmada', null, (select hoy from ref_22) + 24, '09:00', 60, null, null),
  ('17', '40000000-0000-0000-0000-000000002201', 'confirmada', null, (select hoy from ref_22) + 25, '09:00', 60, null, null)
) as v(nn, id_lead, estado, motivo, fecha, hora, dur, finalizada, creada);

insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min, lugar, enlace, abierta_desde, cerrada_desde)
select ('30000000-0000-0000-0000-0000000022' || c.nn)::uuid, 'b0000000-0000-0000-0000-0000000022a0', extract(isodow from c.fecha)::smallint,
       c.hora, false, 135790, c.dur, null, 'https://meet.example/sala-secreta-22', '2026-01-01', null
from citas_22 c;

-- Lo que las preguntas de un diagnóstico guardan: 8 copias con las opciones en el orden del banco (A a D), el orden en que las vio la
-- persona (`orden[i]` es la letra del banco de la posición i), la letra que vio y eligió, y datos que nadie debe ver (clave,
-- tema, misconcepción y texto de error de cada opción). La correcta del banco nunca es la A. 3 falladas (1, 5 y 7) y 5 acertadas.
--   k  orden en que las vio   correcta (banco)   eligió (vista)   elegida (banco)
--   1  C A D B  (ciclo de 4)  B                  A                C        falla
--   2  B C A D  (ciclo de 3)  C                  B                C        acierta
--   3  A B C D                D                  D                D        acierta, sin solución
--   4  D C B A                C                  B                C        acierta
--   5  B D A C  (ciclo de 4)  B                  C                A        falla
--   6  C A B D                C                  A                C        acierta
--   7  D A B C                D                  B                A        falla
--   8  A C B D                B                  C                B        acierta
create temporary table plan_22 (k integer primary key, orden text[], correcta text, elegida text, con_solucion boolean);
insert into plan_22 values
  (1, '{C,A,D,B}', 'B', 'A', true),
  (2, '{B,C,A,D}', 'C', 'B', true),
  (3, '{A,B,C,D}', 'D', 'D', false),
  (4, '{D,C,B,A}', 'C', 'B', true),
  (5, '{B,D,A,C}', 'B', 'C', true),
  (6, '{C,A,B,D}', 'C', 'A', true),
  (7, '{D,A,B,C}', 'D', 'B', true),
  (8, '{A,C,B,D}', 'B', 'C', true);

-- El cuerpo común de los diagnósticos: las copias y el resultado por habilidad tal como los guarda terminar_diagnostico. Las
-- habilidades van en el orden de la materia (no el de los niveles). Los errores guardan primero una sospecha. Una habilidad del error
-- no es de la Evaluación (hab-secreta-9) y otra tiene la descripción caída a su clave (hab-secreta-5).
create temporary table cuerpo_22 as
select
  (select jsonb_agg(jsonb_build_object(
            'clave', 'p-secreta-' || p.k, 'tema', 'tema-secreto-' || p.k, 'enunciado', 'Enunciado ' || p.k,
            'opciones', (select jsonb_agg(jsonb_build_object(
                           'texto', 'k' || p.k || '-' || l, 'correcta', l = p.correcta,
                           'misconcepcion', case when l = p.correcta then null else 'misc-secreta-' || p.k || l end,
                           'error', case when l = p.correcta then null else 'error-secreto-' || p.k || l end) order by l)
                         from unnest(array['A', 'B', 'C', 'D']) as l),
            'dificultad', 2, 'habilidades', jsonb_build_array('hab-secreta-1'),
            'solucion', case when p.con_solucion then to_jsonb('Solución ' || p.k) else 'null'::jsonb end,
            'orden', to_jsonb(p.orden), 'letraElegida', p.elegida, 'fecha', '2026-10-04T23:30:00-05:00') order by p.k)
   from plan_22 p) as respuestas,
  $json$
  {"habilidades":[
     {"habilidad":"hab-secreta-1","descripcion":"Límites básicos","nivel":"lo_domina","respuestas":3,"aciertos":3},
     {"habilidad":"hab-secreta-2","descripcion":"Integrales simples","nivel":"sin_medir","respuestas":0,"aciertos":0},
     {"habilidad":"hab-secreta-3","descripcion":"Derivar potencias","nivel":"no_lo_domina","respuestas":2,"aciertos":0},
     {"habilidad":"hab-secreta-4","descripcion":"Regla de la cadena","nivel":"en_proceso","respuestas":3,"aciertos":2}],
   "errores":[
     {"misconcepcion":"misc-secreta-1","habilidad":"hab-secreta-3","descripcionHabilidad":"Derivar potencias",
      "texto":"Restas uno al exponente pero no multiplicas por el exponente","estado":"sospecha","veces":1,"detalles":[]},
     {"misconcepcion":"misc-secreta-2","habilidad":"hab-secreta-4","descripcionHabilidad":"Regla de la cadena",
      "texto":"Olvidas multiplicar por la derivada de adentro","estado":"confirmada","veces":2,
      "detalles":["Derivaste solo la función de afuera","Dejaste la derivada interna sin multiplicar"]},
     {"misconcepcion":"misc-secreta-3","habilidad":"hab-secreta-9","descripcionHabilidad":"Suma de fracciones",
      "texto":"Sumas numeradores y denominadores por separado","estado":"sospecha","veces":1,"detalles":[]},
     {"misconcepcion":"misc-secreta-4","habilidad":"hab-secreta-5","descripcionHabilidad":"hab-secreta-5",
      "texto":"Confundes el signo del exponente","estado":"sospecha","veces":1,"detalles":[]},
     {"misconcepcion":"misc-secreta-5","habilidad":"hab-secreta-3","descripcionHabilidad":"Derivar potencias",
      "texto":"Usas la regla de la potencia al revés","estado":"confirmada","veces":2,"detalles":[]}],
   "prerrequisitos":[
     {"materia":null,"habilidad":"hab-secreta-6","descripcion":"Suma de fracciones"},
     {"materia":null,"habilidad":"hab-secreta-6","descripcion":"Suma de fracciones"},
     {"materia":"Álgebra Lineal","habilidad":"hab-secreta-7","descripcion":"Despejar variables"},
     {"materia":"Precálculo","habilidad":"hab-secreta-7","descripcion":"Despejar variables"},
     {"materia":null,"habilidad":"hab-secreta-8","descripcion":"Suma de fracciones"}]}
  $json$::jsonb as resultado;

-- Los diagnósticos 01 a 17: cada uno con el Lead y la sesión que dice la tabla. El 01 trae lo que nadie debe ver: el repetido, una
-- marca de falta de material, una semilla y un token reconocibles. Se insertan antes que las citas porque la cita apunta a ellos.
insert into public.diagnostico (id, id_lead, id_sesion_anonima, id_evaluacion, id_materia, respuestas, puntaje, resultado_por_habilidad,
                                semilla, aciertos, repetido, falta_material, fecha_realizacion, token_recuperacion)
select ('60000000-0000-0000-0000-0000000022' || v.nn)::uuid, v.id_lead::uuid, v.sesion::uuid,
       '20000000-0000-0000-0000-0000000022a1', '10000000-0000-0000-0000-0000000022a1',
       c.respuestas, 62.5, c.resultado,
       case v.nn when '01' then 3141592653 else 7 end, 5, v.nn = '01',
       case v.nn when '01' then '[{"habilidad":"hab-secreta-2","motivos":["sin_preguntas_sin_ver"]}]'::jsonb else '[]'::jsonb end,
       case v.nn when '01' then timestamptz '2026-10-05 04:30:00+00' else now() - interval '2 days' end,
       'token-secreto-22-' || v.nn
from (values
  ('01', '40000000-0000-0000-0000-000000002201', 'c0000000-0000-0000-0000-000000002201'),
  ('03', '40000000-0000-0000-0000-000000002201', 'c0000000-0000-0000-0000-000000002201'),
  ('04', '40000000-0000-0000-0000-000000002201', 'c0000000-0000-0000-0000-000000002201'),
  ('05', '40000000-0000-0000-0000-000000002201', 'c0000000-0000-0000-0000-000000002201'),
  ('06', '40000000-0000-0000-0000-000000002201', 'c0000000-0000-0000-0000-000000002201'),
  ('07', '40000000-0000-0000-0000-000000002201', 'c0000000-0000-0000-0000-000000002201'),
  ('08', '40000000-0000-0000-0000-000000002201', 'c0000000-0000-0000-0000-000000002201'),
  ('09', '40000000-0000-0000-0000-000000002201', 'c0000000-0000-0000-0000-000000002201'),
  ('10', '40000000-0000-0000-0000-000000002201', 'c0000000-0000-0000-0000-000000002201'),
  ('11', '40000000-0000-0000-0000-000000002201', 'c0000000-0000-0000-0000-000000002201'),
  ('12', '40000000-0000-0000-0000-000000002202', 'c0000000-0000-0000-0000-000000002202'),
  ('13', '40000000-0000-0000-0000-000000002203', 'c0000000-0000-0000-0000-000000002204'),
  ('14', '40000000-0000-0000-0000-000000002203', null),
  ('15', null,                                   'c0000000-0000-0000-0000-000000002201'),
  ('16', null,                                   'c0000000-0000-0000-0000-000000002202'),
  ('17', '40000000-0000-0000-0000-000000002201', 'c0000000-0000-0000-0000-000000002201')
) as v(nn, id_lead, sesion), cuerpo_22 c;

-- Las citas, cada una apuntando a su diagnóstico (monitoria.id_diagnostico); la 02 queda sin diagnóstico.
insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total, estado, motivo_cancelacion, fecha_finalizacion,
                              fecha_creacion, id_diagnostico)
select ('50000000-0000-0000-0000-0000000022' || c.nn)::uuid, ('30000000-0000-0000-0000-0000000022' || c.nn)::uuid,
       '10000000-0000-0000-0000-0000000022a1', c.id_lead, c.fecha, 987654, c.estado, c.motivo, c.finalizada, c.creada,
       case when c.nn = '02' then null else ('60000000-0000-0000-0000-0000000022' || c.nn)::uuid end
from citas_22 c;

-- La 09 es una grupal.
insert into public.monitoria_grupal (id_monitoria, cupos, modalidad_pago, precio_por_persona) values
  ('50000000-0000-0000-0000-000000002209', 3, 'dividido', 15000);

-- Un pago rechazado en la cita 03 (P-24): la cita sigue confirmada y el diagnóstico se sigue viendo.
insert into public.comprobante_revisado (ruta, tipo) values
  ('c0000000-0000-0000-0000-000000002201/60000000-0000-0000-0000-000000002203.pdf', 'application/pdf');
insert into public.pago (id, id_monitoria, monto, nombre_pagador, contacto, estado, id_admin, fecha_revision, comprobante) values
  ('60000000-0000-0000-0000-000000002203', '50000000-0000-0000-0000-000000002203', 876543, 'Pagador Secreto 22',
   'pagador.secreto22@example.com', 'rechazado', 'a0000000-0000-0000-0000-000000002201', now(),
   'c0000000-0000-0000-0000-000000002201/60000000-0000-0000-0000-000000002203.pdf');

-- Los diagnósticos 90 y 91, hechos con id_monitoria: el 90 apunta a una cita individual de A (la 02), el 91 a la grupal (la 09). Son de
-- otras personas (el Lead 03 y una sesión sin Lead), así que el monitor solo podría leerlos por la cláusula de la monitoría.
insert into public.diagnostico (id, id_lead, id_sesion_anonima, id_evaluacion, id_materia, id_monitoria, respuestas, puntaje,
                                resultado_por_habilidad, semilla, aciertos)
select v.id::uuid, v.id_lead::uuid, v.sesion::uuid, '20000000-0000-0000-0000-0000000022a1', '10000000-0000-0000-0000-0000000022a1',
       v.id_monitoria::uuid, c.respuestas, 40, c.resultado, 11, 3
from (values
  ('60000000-0000-0000-0000-000000002290', '40000000-0000-0000-0000-000000002203', null::text, '50000000-0000-0000-0000-000000002202'),
  ('60000000-0000-0000-0000-000000002291', null, 'c0000000-0000-0000-0000-000000002203', '50000000-0000-0000-0000-000000002209')
) as v(id, id_lead, sesion, id_monitoria), cuerpo_22 c;

-- Los textos sensibles, para buscarlos en la respuesta entera.
create temporary table sensibles_22 (patron text);
insert into sensibles_22 values
  ('hab-secreta'), ('misc-secreta'), ('p-secreta'), ('tema-secreto'), ('error-secreto'),
  ('lucia.secreta22'), ('3002201111'), ('mateo.secreto22'), ('3002202222'), ('@'),
  ('token-secreto-22'), ('3141592653'), ('sin_preguntas_sin_ver'),
  ('40000000-0000-0000-0000-000000002201'), ('c0000000-0000-0000-0000-000000002201'),
  ('Pagador Secreto'), ('876543'), ('987654'), ('135790'), ('sala-secreta');

-- Lo que las 8 preguntas del 01 deben mostrar a la persona que las ve, escrito a mano (no calculado): cada opción en la posición en que
-- la vio, la letra que eligió y la posición de la correcta.
create temporary table esperado_preguntas_22 (k integer primary key, a text, b text, c text, d text, elegida text, correcta text, solucion text);
insert into esperado_preguntas_22 values
  (1, 'k1-C', 'k1-A', 'k1-D', 'k1-B', 'A', 'D', 'Solución 1'),
  (2, 'k2-B', 'k2-C', 'k2-A', 'k2-D', 'B', 'B', 'Solución 2'),
  (3, 'k3-A', 'k3-B', 'k3-C', 'k3-D', 'D', 'D', null),
  (4, 'k4-D', 'k4-C', 'k4-B', 'k4-A', 'B', 'B', 'Solución 4'),
  (5, 'k5-B', 'k5-D', 'k5-A', 'k5-C', 'C', 'A', 'Solución 5'),
  (6, 'k6-C', 'k6-A', 'k6-B', 'k6-D', 'A', 'A', 'Solución 6'),
  (7, 'k7-D', 'k7-A', 'k7-B', 'k7-C', 'B', 'A', 'Solución 7'),
  (8, 'k8-A', 'k8-C', 'k8-B', 'k8-D', 'C', 'C', 'Solución 8');
grant select on esperado_preguntas_22 to authenticated;

-- Control de los fixtures: las 17 citas, los 19 diagnósticos y la grupal existen.
select is((select count(*)::int from public.monitoria where id::text like '50000000-0000-0000-0000-0000000022%'), 17,
  'Control: las 17 citas existen');
select is((select count(*)::int from public.diagnostico where id::text like '60000000-0000-0000-0000-0000000022%'), 18,
  'Control: los 16 diagnósticos ligados por la cita y los 2 hechos con id_monitoria existen (la cita 02 no tiene)');

-- ---------------------------------------------------------------------------
-- Visibilidad por estado (la puerta pública, con la hora real)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000022a0","role":"authenticated"}';
select is((select count(*)::int from public.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002201')), 1,
  'Una confirmada con diagnóstico: una fila');
select is((select count(*)::int from public.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002202')), 1,
  'Una confirmada sin diagnóstico: una fila (la cabecera de la cita)');
select is((select count(*)::int from public.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002203')), 1,
  'Una confirmada con un pago rechazado (P-24): la cita ya empezó y se sigue viendo; la función no mira el pago');
select is((select count(*)::int from public.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002204')), 1,
  'Una realizada con el fin hace unos 29 días: se ve (aunque su fecha_finalizacion sea de hace 40)');
select is((select count(*)::int from public.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002210')), 1,
  'Una confirmada con el fin hace unos 40 días y sin finalizar: se sigue viendo, no tiene plazo');
select is((select count(*)::int from public.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002205')), 0,
  'Una pendiente de pago vigente: ninguna fila');
select is((select count(*)::int from public.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002206')), 0,
  'Una pendiente de pago vencida: ninguna fila');
select is((select count(*)::int from public.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002207')), 0,
  'Una cancelada: ninguna fila');
select is((select count(*)::int from public.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002208')), 0,
  'Una realizada con el fin hace unos 31 días: ninguna fila (aunque su fecha_finalizacion sea de ayer)');
select is((select count(*)::int from public.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002209')), 0,
  'Una grupal (con fila en monitoria_grupal): ninguna fila, aunque esté confirmada y apunte a un diagnóstico (HU-040 decide)');
reset role;

-- ---------------------------------------------------------------------------
-- El reloj: la frontera de los 30 días (el núcleo, como postgres con los claims del monitor A)
-- ---------------------------------------------------------------------------
-- La cita 11 es del lunes 7-sep-2026 a las 10:00 (Bogotá), de 90 minutos: fin = 11:30. Se finalizó un día después. El plazo cuenta
-- desde el fin programado: fin + 720 horas.
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000022a0","role":"authenticated"}';
select is(
  (select count(*)::int from privado.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002211',
     timestamptz '2026-09-07 11:30-05' + interval '720 hours' - interval '1 minute')),
  1, 'A 30 días menos un minuto del fin, la realizada se ve');
select is(
  (select count(*)::int from privado.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002211',
     timestamptz '2026-09-07 11:30-05' + interval '720 hours')),
  0, 'Justo a 30 días del fin ya no se ve: se ve mientras ahora < fin + 30 días');
select is(
  (select count(*)::int from privado.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002211',
     timestamptz '2026-09-07 11:30-05' + interval '720 hours' + interval '1 minute')),
  0, 'A 30 días y un minuto del fin, tampoco');
select is(
  (select count(*)::int from privado.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002211',
     timestamptz '2026-09-08 11:30-05' + interval '720 hours' - interval '1 minute')),
  0, 'El plazo no cuenta desde fecha_finalizacion (un día después del fin): a fecha_finalizacion + 30 días menos un minuto ya no se ve');
select is(
  (select count(*)::int from privado.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002211',
     timestamptz '2026-09-07 10:00-05' + interval '720 hours' + interval '30 minutes' - interval '1 minute')),
  1, 'Tampoco cuenta desde el inicio: a inicio + 30 días + 29 minutos (antes de fin + 30 días) todavía se ve');
select is(
  (select count(*)::int from privado.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002201', timestamptz '2035-01-01 00:00+00')),
  1, 'Una confirmada no tiene plazo: años después se sigue viendo');
select is(
  (select count(*)::int from privado.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002205', timestamptz '2026-09-07 00:00+00')
   ) + (select count(*)::int from privado.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002207', timestamptz '2026-09-07 00:00+00')),
  0, 'La hora no abre lo que el estado cierra: una pendiente de pago y una cancelada no se ven a ninguna hora');

-- ---------------------------------------------------------------------------
-- Quién llama
-- ---------------------------------------------------------------------------
-- Todos reciben cero filas, idénticas a las de una cita que no existe: no se distingue «no existe» de «no es tuya».
set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000022b0","role":"authenticated"}';
select is((select count(*)::int from public.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002201')), 0,
  'Otro monitor: ninguna fila');
select results_eq(
  $$select * from public.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002201')$$,
  $$select * from public.diagnostico_de_mi_monitoria('00000000-0000-0000-0000-000000000000')$$,
  'Otro monitor recibe lo mismo que por una cita inexistente');
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-000000002201","role":"authenticated","is_anonymous":false}';
select is((select count(*)::int from public.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002201')), 0,
  'Un admin que no dicta la cita: ninguna fila');
select results_eq(
  $$select * from public.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002201')$$,
  $$select * from public.diagnostico_de_mi_monitoria('00000000-0000-0000-0000-000000000000')$$,
  'Un admin recibe lo mismo que por una cita inexistente');
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000002201","role":"authenticated","is_anonymous":true}';
select is((select count(*)::int from public.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002201')), 0,
  'El Lead que agendó la cita (su sesión): ninguna fila');
select results_eq(
  $$select * from public.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002201')$$,
  $$select * from public.diagnostico_de_mi_monitoria('00000000-0000-0000-0000-000000000000')$$,
  'El Lead recibe lo mismo que por una cita inexistente');
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000002203","role":"authenticated","is_anonymous":true}';
select is((select count(*)::int from public.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002201')), 0,
  'Una sesión anónima sin Lead: ninguna fila');
select results_eq(
  $$select * from public.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002201')$$,
  $$select * from public.diagnostico_de_mi_monitoria('00000000-0000-0000-0000-000000000000')$$,
  'Una sesión anónima recibe lo mismo que por una cita inexistente');
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000022a0","role":"authenticated"}';
select is((select count(*)::int from public.diagnostico_de_mi_monitoria('00000000-0000-0000-0000-000000000000')), 0,
  'El monitor de la cita con un id que no existe: ninguna fila');
select is((select count(*)::int from public.diagnostico_de_mi_monitoria(null)), 0,
  'Con un id nulo: ninguna fila, sin error');
select throws_ok(
  $$select * from privado.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002201', now())$$, '42501', null,
  'El propio monitor, con sesión, no puede llamar al núcleo con una hora a su gusto: permiso denegado');
select throws_ok(
  $$select * from privado.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002211', timestamptz '2026-09-07 00:00+00')$$, '42501', null,
  'Ni para ver una realizada vencida con una hora vieja');
reset role;
set local role anon;
select throws_ok($$select * from public.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002201')$$, '42501', null,
  'El visitante sin sesión (anon) no puede ejecutarla: permiso denegado');
reset role;

-- ---------------------------------------------------------------------------
-- Contenido de la cita visible con diagnóstico (la 01: Lead v2, 8 preguntas, 3 falladas)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000022a0","role":"authenticated"}';
select results_eq(
  $$select fecha, hora, duracion_min, nombre_materia, nombre_estudiante, hay_diagnostico, nombre_evaluacion, fecha_realizacion,
           respondidas, aciertos, repetido, respuestas_autorizadas
    from public.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002201')$$,
  $$values (date '2026-11-02', time '10:00', 90, 'Materia Veintidós'::text, 'Lucía Veintidós'::text, true,
            'Parcial Veintidós Alfa'::text, timestamptz '2026-10-05 04:30+00', 8, 5, true, true)$$,
  'La cabecera y el encabezado, columna por columna: fecha, hora, duración, materia, estudiante, Evaluación, fecha, 8 respondidas, 5 aciertos, repetido');
select is(
  (select repetido from public.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002212')), false,
  'Un diagnóstico que no es repetido sale con repetido falso');

-- Habilidades
select is(
  (select habilidades from public.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002201')),
  $json$[
    {"descripcion":"Límites básicos","nivel":"lo_domina","respuestas":3,"aciertos":3},
    {"descripcion":"Integrales simples","nivel":"sin_medir","respuestas":0,"aciertos":0},
    {"descripcion":"Derivar potencias","nivel":"no_lo_domina","respuestas":2,"aciertos":0},
    {"descripcion":"Regla de la cadena","nivel":"en_proceso","respuestas":3,"aciertos":2}]$json$::jsonb,
  'Las habilidades salen en el orden guardado (el de la materia, no el de los niveles), con el nivel y las cifras guardados y solo esas cuatro claves');

-- Errores
select is(
  (select errores from public.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002201')),
  $json$[
    {"titulo":"Olvidas multiplicar por la derivada de adentro","estado":"confirmada","veces":2,
     "descripcionDeLaHabilidad":"Regla de la cadena","detalles":["Derivaste solo la función de afuera","Dejaste la derivada interna sin multiplicar"]},
    {"titulo":"Usas la regla de la potencia al revés","estado":"confirmada","veces":2,
     "descripcionDeLaHabilidad":"Derivar potencias","detalles":[]},
    {"titulo":"Restas uno al exponente pero no multiplicas por el exponente","estado":"sospecha","veces":1,
     "descripcionDeLaHabilidad":"Derivar potencias","detalles":[]},
    {"titulo":"Sumas numeradores y denominadores por separado","estado":"sospecha","veces":1,
     "descripcionDeLaHabilidad":"Suma de fracciones","detalles":[]},
    {"titulo":"Confundes el signo del exponente","estado":"sospecha","veces":1,
     "descripcionDeLaHabilidad":null,"detalles":[]}]$json$::jsonb,
  'Los errores: los confirmados primero (en su orden), luego las sospechas (en el suyo); con detalle y sin él; la habilidad que no es de la Evaluación sale con su descripción; la descripción caída a la clave sale nula');

-- Prerrequisitos
select is(
  (select prerrequisitos from public.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002201')),
  $json$[
    {"materia":null,"descripcion":"Suma de fracciones"},
    {"materia":"Álgebra Lineal","descripcion":"Despejar variables"},
    {"materia":"Precálculo","descripcion":"Despejar variables"},
    {"materia":null,"descripcion":"Suma de fracciones"}]$json$::jsonb,
  'Los prerrequisitos: el repetido (misma materia y misma clave) sale una vez; la misma clave de dos materias sale dos veces; dos claves con la misma descripción salen las dos');

-- Preguntas
select is((select jsonb_array_length(preguntas) from public.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002201')), 8,
  'Las 8 preguntas, falladas y acertadas');
select results_eq(
  $$select (p.v ->> 'enunciado'),
          (p.v -> 'opciones' -> 0 ->> 'texto'), (p.v -> 'opciones' -> 1 ->> 'texto'),
          (p.v -> 'opciones' -> 2 ->> 'texto'), (p.v -> 'opciones' -> 3 ->> 'texto'),
          (select string_agg(o ->> 'letra', '' order by n) from jsonb_array_elements(p.v -> 'opciones') with ordinality as q(o, n)),
          (p.v ->> 'letraElegida'), (p.v ->> 'letraCorrecta'), (p.v ->> 'solucion')
    from public.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002201') r,
         jsonb_array_elements(r.preguntas) with ordinality as p(v, o)
    order by p.o$$,
  $$select 'Enunciado ' || k, a, b, c, d, 'ABCD', elegida, correcta, solucion from esperado_preguntas_22 order by k$$,
  'Las preguntas en el orden en que se respondieron, con las opciones en el orden visto (ciclos de 4 y de 3 incluidos), la letra elegida que vio la persona, la posición de la correcta y la solución (nula en la 3)');
reset role;

-- ---------------------------------------------------------------------------
-- Autorización de las respuestas (D-67)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000022a0","role":"authenticated"}';
select results_eq(
  $$select respuestas_autorizadas, preguntas is null, hay_diagnostico, habilidades is not null, errores is not null, prerrequisitos is not null
    from public.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002212')$$,
  $$values (false, true, true, true, true, true)$$,
  'Lead con v1: sin preguntas, y sí el resto del diagnóstico (habilidades, errores y prerrequisitos)');
select results_eq(
  $$select respuestas_autorizadas, preguntas is null from public.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002213')$$,
  $$values (false, true)$$,
  'Cita de un Lead con v2 cuyo diagnóstico es de otro Lead: sin preguntas');
select results_eq(
  $$select respuestas_autorizadas, preguntas is null from public.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002214')$$,
  $$values (false, true)$$,
  'Cita de un Lead con v1 cuyo diagnóstico es de otro Lead con v2: sin preguntas');
select results_eq(
  $$select respuestas_autorizadas, jsonb_array_length(preguntas) from public.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002215')$$,
  $$values (true, 8)$$,
  'Diagnóstico sin Lead (de la sesión) y Lead de la cita con v2: las 8 preguntas');
select results_eq(
  $$select respuestas_autorizadas, preguntas is null from public.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002216')$$,
  $$values (false, true)$$,
  'Diagnóstico sin Lead y Lead de la cita con v1: sin preguntas (no se autoriza por no tener Lead)');
reset role;
-- El Lead 02 edita su contacto con el texto nuevo (HU-087) y pasa a v2: la misma cita ya entrega las preguntas.
update public.lead set version_autorizacion = 'v2' where id = '40000000-0000-0000-0000-000000002202';
set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000022a0","role":"authenticated"}';
select results_eq(
  $$select respuestas_autorizadas, jsonb_array_length(preguntas) from public.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002212')$$,
  $$values (true, 8)$$,
  'Es la versión actual del Lead: al pasar a v2 la misma cita entrega las preguntas');
select results_eq(
  $$select respuestas_autorizadas, jsonb_array_length(preguntas) from public.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002216')$$,
  $$values (true, 8)$$,
  'Y la del diagnóstico sin Lead de ese mismo Lead');
select results_eq(
  $$select respuestas_autorizadas, preguntas is null from public.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002214')$$,
  $$values (false, true)$$,
  'Pero el diagnóstico de otro Lead sigue sin mostrarse aunque ahora los dos sean v2');
reset role;

-- ---------------------------------------------------------------------------
-- Nada sensible
-- ---------------------------------------------------------------------------
-- Las claves de las cuatro columnas jsonb, recorridas a todos los niveles, contra la lista cerrada.
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000022a0","role":"authenticated"}';
create temporary table respuesta_22 as
select r.* from public.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002201') r;
create temporary table claves_22 as
select c.col, array_agg(distinct k order by k) as claves
from (
  select 'habilidades' as col, jsonb_path_query(r.habilidades, 'strict $.**') as j from respuesta_22 r
  union all select 'errores', jsonb_path_query(r.errores, 'strict $.**') from respuesta_22 r
  union all select 'prerrequisitos', jsonb_path_query(r.prerrequisitos, 'strict $.**') from respuesta_22 r
  union all select 'preguntas', jsonb_path_query(r.preguntas, 'strict $.**') from respuesta_22 r
) c
cross join lateral jsonb_object_keys(case when jsonb_typeof(c.j) = 'object' then c.j else '{}'::jsonb end) as k
group by c.col;
select is((select claves from claves_22 where col = 'habilidades'), array['aciertos', 'descripcion', 'nivel', 'respuestas'],
  'Las habilidades solo llevan descripcion, nivel, respuestas y aciertos: no su clave');
select is((select claves from claves_22 where col = 'errores'), array['descripcionDeLaHabilidad', 'detalles', 'estado', 'titulo', 'veces'],
  'Los errores solo llevan titulo, estado, veces, descripcionDeLaHabilidad y detalles: ni la clave de la misconcepción ni la de la habilidad');
select is((select claves from claves_22 where col = 'prerrequisitos'), array['descripcion', 'materia'],
  'Los prerrequisitos solo llevan materia (el nombre) y descripcion: no la clave de la habilidad');
select is((select claves from claves_22 where col = 'preguntas'),
  array['enunciado', 'letra', 'letraCorrecta', 'letraElegida', 'opciones', 'solucion', 'texto'],
  'Las preguntas solo llevan enunciado, opciones (letra y texto), letraElegida, letraCorrecta y solucion: ni clave, tema, dificultad, habilidades, fecha ni orden, ni por opción correcta, misconcepcion o error');
select is(
  (select coalesce(array_agg(s.patron order by s.patron), '{}')
   from sensibles_22 s, respuesta_22 r
   where position(lower(s.patron) in lower(to_jsonb(r)::text)) > 0),
  '{}'::text[],
  'La respuesta entera no contiene ninguno de los textos sensibles: claves, contacto del Lead, token, semilla, falta de material, ids del Lead y de la sesión, ni cifras de pago');
select is(
  (select count(*)::int from sensibles_22 s, public.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002203') r
   where position(lower(s.patron) in lower(to_jsonb(r)::text)) > 0),
  0, 'Tampoco la de la cita con el pago rechazado: no sale ninguna cifra ni dato de pago');

-- ---------------------------------------------------------------------------
-- Cierre de la política de lectura de diagnostico (criterio 12)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000022a0","role":"authenticated"}';
select is(
  (select count(*)::int from public.diagnostico
   where id::text like '60000000-0000-0000-0000-0000000022%' and id <> '60000000-0000-0000-0000-000000002291'),
  0, 'El monitor A, por la tabla, no lee ninguno de los diagnósticos ligados a sus citas individuales por monitoria.id_diagnostico');
select is(
  (select count(*)::int from public.diagnostico where id = '60000000-0000-0000-0000-000000002290'),
  0, 'Ni el que apunta a una cita individual suya por diagnostico.id_monitoria (el caso que dicta_monitoria dejaba abierto)');
select is(
  (select count(*)::int from public.diagnostico where id = '60000000-0000-0000-0000-000000002291'),
  1, 'Sí el hecho dentro de una grupal que dicta (dicta_grupal)');
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000022b0","role":"authenticated"}';
select is(
  (select count(*)::int from public.diagnostico where id::text like '60000000-0000-0000-0000-0000000022%'),
  0, 'Otro monitor no lee ninguno, tampoco el de la grupal');
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000002201","role":"authenticated","is_anonymous":true}';
select is(
  (select count(*)::int from public.diagnostico where id in ('60000000-0000-0000-0000-000000002201', '60000000-0000-0000-0000-000000002215')),
  2, 'La sesión que hizo el diagnóstico lo sigue leyendo (el suyo con Lead y el suyo sin Lead)');
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000002204","role":"authenticated","is_anonymous":true}';
select is(
  (select count(*)::int from public.diagnostico where id = '60000000-0000-0000-0000-000000002214'),
  0, 'La sesión que creó el Lead no lee el diagnóstico de su Lead que no hizo ella (HU-095, D-53 e)');
set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000002203","role":"authenticated","is_anonymous":true}';
select is(
  (select count(*)::int from public.diagnostico where id::text like '60000000-0000-0000-0000-0000000022%'),
  1, 'Una sesión sin Lead lee solo el suyo (el 91)');
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-000000002201","role":"authenticated","is_anonymous":false}';
select is(
  (select count(*)::int from public.diagnostico where id::text like '60000000-0000-0000-0000-0000000022%'),
  18, 'El admin sigue leyendo todos');
reset role;
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'diagnostico' and cmd = 'SELECT'),
  1, 'Sigue habiendo una sola política de lectura en diagnostico');
select ok(
  (select qual from pg_policies where schemaname = 'public' and tablename = 'diagnostico' and cmd = 'SELECT') like '%dicta_grupal%',
  'La política abre las grupales con privado.dicta_grupal');
select ok(
  (select qual from pg_policies where schemaname = 'public' and tablename = 'diagnostico' and cmd = 'SELECT') not like '%dicta_cita_con_diagnostico%',
  'La política ya no nombra dicta_cita_con_diagnostico');
select ok(
  (select qual from pg_policies where schemaname = 'public' and tablename = 'diagnostico' and cmd = 'SELECT') not like '%dicta_monitoria%',
  'Ni dicta_monitoria, que acepta cualquier monitoría del monitor, también las individuales');
select ok(
  (select qual from pg_policies where schemaname = 'public' and tablename = 'diagnostico' and cmd = 'SELECT') like '%es_admin%'
  and (select qual from pg_policies where schemaname = 'public' and tablename = 'diagnostico' and cmd = 'SELECT') like '%es_cuenta_de_lead%'
  and (select qual from pg_policies where schemaname = 'public' and tablename = 'diagnostico' and cmd = 'SELECT') not like '%es_mi_lead%'
  and (select qual from pg_policies where schemaname = 'public' and tablename = 'diagnostico' and cmd = 'SELECT') like '%id_sesion_anonima%',
  'Y conserva la cláusula del admin, la de la cuenta de Estudiante del Lead (HU-095, sin es_mi_lead) y la de la sesión dueña');
select ok(
  not has_column_privilege('authenticated', 'public.diagnostico', 'respuestas', 'select')
  and not has_column_privilege('authenticated', 'public.diagnostico', 'token_recuperacion', 'select'),
  'El grant de columnas no cambió: las copias de las preguntas y el token siguen sin lectura por la Data API');

-- ---------------------------------------------------------------------------
-- Sin diagnóstico y diagnóstico borrado
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"b0000000-0000-0000-0000-0000000022a0","role":"authenticated"}';
select is(
  (select r.hay_diagnostico or r.nombre_evaluacion is not null or r.fecha_realizacion is not null or r.respondidas is not null
          or r.aciertos is not null or r.repetido is not null or r.habilidades is not null or r.errores is not null
          or r.prerrequisitos is not null or r.respuestas_autorizadas is not null or r.preguntas is not null
   from privado.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002202', now()) r),
  false, 'Una cita sin diagnóstico: hay_diagnostico falso y todos los campos del diagnóstico nulos');
select results_eq(
  $$select fecha, hora, duracion_min, nombre_materia, nombre_estudiante, hay_diagnostico
    from privado.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002202', now())$$,
  $$values (date '2026-11-09', time '10:00', 60, 'Materia Veintidós'::text, 'Lucía Veintidós'::text, false)$$,
  'Y la cabecera de la cita está completa');
-- La supresión de datos borra el diagnóstico: la cita queda con id_diagnostico nulo (on delete set null).
select is(
  (select count(*)::int from public.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002217') where hay_diagnostico),
  1, 'Antes de borrar: la cita 17 muestra su diagnóstico');
delete from public.diagnostico where id = '60000000-0000-0000-0000-000000002217';
select is(
  (select id_diagnostico from public.monitoria where id = '50000000-0000-0000-0000-000000002217'),
  null::uuid, 'El diagnóstico se borró y la llave dejó la cita con id_diagnostico nulo');
select results_eq(
  $$select hay_diagnostico, nombre_evaluacion is null and fecha_realizacion is null and respondidas is null and aciertos is null
           and repetido is null and habilidades is null and errores is null and prerrequisitos is null
           and respuestas_autorizadas is null and preguntas is null, nombre_estudiante
    from privado.diagnostico_de_mi_monitoria('50000000-0000-0000-0000-000000002217', now())$$,
  $$values (false, true, 'Lucía Veintidós'::text)$$,
  'Con la cita visible, la función responde la cabecera sin diagnóstico (una fila, no un error) y todo lo del diagnóstico nulo');

select * from finish();
rollback;
