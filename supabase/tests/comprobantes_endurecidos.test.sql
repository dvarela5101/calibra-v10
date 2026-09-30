-- Pruebas pgTAP de HU-059: comprobantes revisados, cuota por sesión y huérfanos.
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos. Las filas de storage.objects
-- se insertan por SQL (el trigger de la cuota corre igual); borrarlas por SQL lo impide el Storage, y
-- el rollback las quita. now() no cambia dentro de la transacción, así que los bordes son exactos.

begin;
create extension if not exists pgtap with schema extensions;

select plan(46);

-- ---------------------------------------------------------------------------
-- 1. Estructura y permisos
-- ---------------------------------------------------------------------------
select has_table('public', 'comprobante_revisado', 'Existe la tabla comprobante_revisado');
select has_table('privado', 'subida_comprobante', 'Existe el registro de subidas privado.subida_comprobante');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.comprobante_revisado'::regclass)
  and (select relrowsecurity from pg_class where oid = 'privado.subida_comprobante'::regclass),
  'Las dos tablas nuevas tienen RLS');

select ok(
  has_table_privilege('service_role', 'public.comprobante_revisado', 'select, insert, update, delete')
  and not has_table_privilege('authenticated', 'public.comprobante_revisado', 'select')
  and not has_table_privilege('authenticated', 'public.comprobante_revisado', 'insert')
  and not has_table_privilege('anon', 'public.comprobante_revisado', 'select'),
  'comprobante_revisado: solo el servidor (service_role) la lee y la escribe');

select ok(
  not has_table_privilege('service_role', 'privado.subida_comprobante', 'select')
  and not has_table_privilege('authenticated', 'privado.subida_comprobante', 'select')
  and not has_table_privilege('anon', 'privado.subida_comprobante', 'select'),
  'El registro de subidas no lo lee ni escribe ninguna sesión: solo el trigger');

select is(
  (select confrelid::regclass::text from pg_constraint
   where conname = 'pago_comprobante_revisado_fk' and conrelid = 'public.pago'::regclass and contype = 'f'),
  'comprobante_revisado',
  'pago.comprobante es una llave foránea a comprobante_revisado');

select is(
  (select array_agg(tgname::text order by tgname) from pg_trigger
   where tgrelid = 'storage.objects'::regclass and tgname = 'comprobantes_cuota' and tgenabled <> 'D'
     and (tgtype & 2) = 2   -- before
     and (tgtype & 4) = 4), -- insert
  array['comprobantes_cuota'],
  'El trigger de la cuota corre antes de cada inserción en storage.objects');

select ok(
  has_function_privilege('authenticated', 'public.parametros_comprobantes()', 'execute')
  and has_function_privilege('service_role', 'public.parametros_comprobantes()', 'execute')
  and not has_function_privilege('anon', 'public.parametros_comprobantes()', 'execute'),
  'parametros_comprobantes(): authenticated y service_role, anon no');

select ok(
  has_function_privilege('authenticated', 'public.mi_cuota_de_comprobantes()', 'execute')
  and not has_function_privilege('anon', 'public.mi_cuota_de_comprobantes()', 'execute'),
  'mi_cuota_de_comprobantes(): cualquier sesión (authenticated), sin sesión no');

select ok(
  has_function_privilege('service_role', 'public.anotar_comprobante_revisado(text, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.anotar_comprobante_revisado(text, text)', 'execute')
  and not has_function_privilege('anon', 'public.anotar_comprobante_revisado(text, text)', 'execute')
  and has_function_privilege('service_role', 'public.tomar_comprobantes_huerfanos(integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.tomar_comprobantes_huerfanos(integer)', 'execute')
  and not has_function_privilege('anon', 'public.tomar_comprobantes_huerfanos(integer)', 'execute'),
  'anotar_comprobante_revisado() y tomar_comprobantes_huerfanos(): solo service_role');

select ok(
  not has_function_privilege('authenticated', 'privado.exigir_cuota_de_comprobantes()', 'execute')
  and not has_function_privilege('service_role', 'privado.exigir_cuota_de_comprobantes()', 'execute')
  and not has_function_privilege('authenticated', 'privado.disparar_proceso(text)', 'execute')
  and not has_function_privilege('service_role', 'privado.disparar_proceso(text)', 'execute')
  and not has_function_privilege('anon', 'privado.uso_de_cuota_de_comprobantes(text)', 'execute'),
  'Las funciones de privado no las ejecuta ninguna sesión, salvo uso_de_cuota para authenticated');

select results_eq(
  $$select schedule, command from cron.job where jobname = 'calibra-limpiar-comprobantes'$$,
  $$values ('17 * * * *'::text, $c$select privado.disparar_proceso('/api/procesos/limpiar-comprobantes')$c$::text)$$,
  'La limpieza corre cada hora (minuto 17) con pg_cron');

-- ---------------------------------------------------------------------------
-- 2. Parámetros (N-4)
-- ---------------------------------------------------------------------------
select results_eq(
  $$select cuota_subidas, cuota_ventana_min, huerfano_tras_min from public.parametros_comprobantes()$$,
  $$values (5, 24 * 60, 24 * 60)$$,
  'parametros_comprobantes(): 5 comprobantes cada 24 horas, huérfano después de 24 horas');

-- ---------------------------------------------------------------------------
-- 3. Un pago solo apunta a un comprobante revisado
-- ---------------------------------------------------------------------------
insert into auth.users (id, is_anonymous) values
  ('a0000000-0000-0000-0000-000000000591', false),
  ('b0000000-0000-0000-0000-000000000591', false),
  ('c0000000-0000-0000-0000-000000000591', true);
insert into public.materia (id, nombre, codigo) values ('10000000-0000-0000-0000-000000000591', 'Materia HU-059', 'HU059-1');
insert into public.admin (id, nombre, correo, orden_revision) values
  ('a0000000-0000-0000-0000-000000000591', 'Admin HU-059', 'admin-059@example.com', 9000591);
insert into public.monitor (id, nombre) values ('b0000000-0000-0000-0000-000000000591', 'Monitor HU-059');
insert into public.certificado (id_monitor, id_materia, id_admin) values
  ('b0000000-0000-0000-0000-000000000591', '10000000-0000-0000-0000-000000000591', 'a0000000-0000-0000-0000-000000000591');
insert into public.franja (id, id_monitor, dia, hora, presencial, precio, duracion_min) values
  ('30000000-0000-0000-0000-000000000591', 'b0000000-0000-0000-0000-000000000591', 1, '10:00', true, 25000, 60);
insert into public.lead (id, id_sesion_anonima, nombre, correo, acepta_tratamiento_datos, fecha_consentimiento) values
  ('40000000-0000-0000-0000-000000000591', 'c0000000-0000-0000-0000-000000000591', 'Lead HU-059', 'lead-059@example.com', true, now());
insert into public.monitoria (id, id_franja, id_materia, id_lead, fecha, valor_total) values
  ('50000000-0000-0000-0000-000000000591', '30000000-0000-0000-0000-000000000591', '10000000-0000-0000-0000-000000000591',
   '40000000-0000-0000-0000-000000000591', '2030-01-07', 25000);

create temp table pago_base on commit drop as
select '50000000-0000-0000-0000-000000000591'::uuid as id_monitoria, 25000 as monto, 'Pagador'::text as nombre,
       'pagador@example.com'::text as contacto, 'a0000000-0000-0000-0000-000000000591'::uuid as id_admin;

select throws_ok(
  $$insert into public.pago (id_monitoria, monto, nombre_pagador, contacto, id_admin, comprobante)
    select id_monitoria, monto, nombre, contacto, id_admin,
           'c0000000-0000-0000-0000-000000000591/11111111-1111-1111-1111-111111111111.png' from pago_base$$,
  '23503', null,
  'Un pago no puede apuntar a un comprobante que el servidor no revisó (o que descartó)');

insert into public.comprobante_revisado (ruta, tipo) values
  ('c0000000-0000-0000-0000-000000000591/22222222-2222-2222-2222-222222222222.png', 'image/png');

select lives_ok(
  $$insert into public.pago (id_monitoria, monto, nombre_pagador, contacto, id_admin, comprobante)
    select id_monitoria, monto, nombre, contacto, id_admin,
           'c0000000-0000-0000-0000-000000000591/22222222-2222-2222-2222-222222222222.png' from pago_base$$,
  'Un pago sí puede apuntar a un comprobante revisado');

select throws_ok(
  $$delete from public.comprobante_revisado
    where ruta = 'c0000000-0000-0000-0000-000000000591/22222222-2222-2222-2222-222222222222.png'$$,
  '23503', null,
  'No se puede quitar de revisados un comprobante que un pago usa');

select throws_ok(
  $$insert into public.comprobante_revisado (ruta, tipo)
    values ('c0000000-0000-0000-0000-000000000591/33333333-3333-3333-3333-333333333333.png', 'image/gif')$$,
  '23514', null,
  'comprobante_revisado solo admite JPG, PNG y PDF');

select throws_ok(
  $$insert into public.comprobante_revisado (ruta, tipo) values ('comprobante.png', 'image/png')$$,
  '23514', null,
  'comprobante_revisado solo admite rutas de comprobante (carpeta/uuid.extensión)');

-- ---------------------------------------------------------------------------
-- 4. Anotar un revisado: solo si existe y tiene 24 horas o menos
-- ---------------------------------------------------------------------------
insert into storage.objects (bucket_id, name, created_at) values
  ('comprobantes', 'd5900000-0000-0000-0000-000000000001/d5900000-0000-0000-0000-000000000001.png', now() - interval '1 hour'),
  ('comprobantes', 'd5900000-0000-0000-0000-000000000002/d5900000-0000-0000-0000-000000000002.png', now() - interval '24 hours'),
  ('comprobantes', 'd5900000-0000-0000-0000-000000000003/d5900000-0000-0000-0000-000000000003.png', now() - interval '24 hours' - interval '1 microsecond');

select is(
  array[
    public.anotar_comprobante_revisado('d5900000-0000-0000-0000-000000000001/d5900000-0000-0000-0000-000000000001.png', 'image/png'),
    public.anotar_comprobante_revisado('d5900000-0000-0000-0000-000000000002/d5900000-0000-0000-0000-000000000002.png', 'image/png'),
    public.anotar_comprobante_revisado('d5900000-0000-0000-0000-000000000003/d5900000-0000-0000-0000-000000000003.png', 'image/png'),
    public.anotar_comprobante_revisado('d5900000-0000-0000-0000-000000000004/d5900000-0000-0000-0000-000000000004.png', 'image/png')],
  array['anotado', 'anotado', 'vencido', 'no_existe'],
  'Anota uno de 1 hora y uno de 24 horas exactas; no uno de más de 24 horas ni uno que no existe');

select is(
  (select array_agg(ruta order by ruta) from public.comprobante_revisado where ruta like 'd5900000-%'),
  array['d5900000-0000-0000-0000-000000000001/d5900000-0000-0000-0000-000000000001.png',
        'd5900000-0000-0000-0000-000000000002/d5900000-0000-0000-0000-000000000002.png'],
  'Solo quedan anotados los dos que se podían anotar');

select is(
  public.anotar_comprobante_revisado('d5900000-0000-0000-0000-000000000001/d5900000-0000-0000-0000-000000000001.png', 'image/png'),
  'anotado',
  'Anotar dos veces el mismo no falla ni lo duplica');

-- ---------------------------------------------------------------------------
-- 5. Cuota: máximo 5 subidas por carpeta en las últimas 24 horas (el trigger)
-- ---------------------------------------------------------------------------
select lives_ok(
  $$insert into storage.objects (bucket_id, name)
    select 'comprobantes', 'a5900000-0000-0000-0000-00000000000a/' || gen_random_uuid() || '.png' from generate_series(1, 5)$$,
  'Cinco comprobantes de la misma sesión en 24 horas entran');

select is(
  (select count(*)::int from privado.subida_comprobante where carpeta = 'a5900000-0000-0000-0000-00000000000a'),
  5,
  'Cada subida queda en el registro de subidas');

select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('comprobantes', 'a5900000-0000-0000-0000-00000000000a/' || gen_random_uuid() || '.png')$$,
  '23514', 'Ya subiste 5 comprobantes en las últimas 24 horas, el máximo permitido.',
  'El sexto se rechaza con un mensaje claro');

select is(
  (select count(*)::int from privado.subida_comprobante where carpeta = 'a5900000-0000-0000-0000-00000000000a'),
  5,
  'Una subida rechazada no queda en el registro');

select lives_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('comprobantes', 'a5900000-0000-0000-0000-00000000000b/' || gen_random_uuid() || '.png')$$,
  'La cuota es por sesión: otra carpeta sigue subiendo');

insert into storage.buckets (id, name) values ('otro-bucket-059', 'otro-bucket-059');
select lives_ok(
  $$insert into storage.objects (bucket_id, name)
    select 'otro-bucket-059', 'a5900000-0000-0000-0000-00000000000a/' || gen_random_uuid() || '.png' from generate_series(1, 2)$$,
  'Otros buckets no cuentan ni se limitan');

-- La cuota cuenta subidas, no archivos: aunque el archivo ya no esté, la subida sigue contando.
insert into privado.subida_comprobante (carpeta, subido_en)
select 'a5900000-0000-0000-0000-00000000000f', now() - interval '1 hour' from generate_series(1, 5);
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('comprobantes', 'a5900000-0000-0000-0000-00000000000f/' || gen_random_uuid() || '.png')$$,
  '23514', null,
  'Cinco subidas cuyos archivos ya no están (descartados o borrados) siguen contando');

-- Lo de hace más de 24 horas no cuenta; con exactamente 24 horas tampoco (la ventana es "últimas 24 h").
insert into privado.subida_comprobante (carpeta, subido_en)
select 'a5900000-0000-0000-0000-00000000000c', now() - interval '24 hours' from generate_series(1, 5);
select lives_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('comprobantes', 'a5900000-0000-0000-0000-00000000000c/' || gen_random_uuid() || '.png')$$,
  'Cinco subidas de hace exactamente 24 horas ya no cuentan');

select is(
  (select count(*)::int from privado.subida_comprobante where carpeta = 'a5900000-0000-0000-0000-00000000000c'),
  1,
  'Y el trigger purga del registro las subidas que ya salieron de la ventana');

-- El conteo que ve la sesión (sin pasar por el trigger, que además purga): el mismo borde.
insert into privado.subida_comprobante (carpeta, subido_en) values
  ('a5900000-0000-0000-0000-000000000010', now() - interval '24 hours'),
  ('a5900000-0000-0000-0000-000000000011', now() - interval '24 hours' + interval '1 microsecond');
select is(
  array[
    (select usados from privado.uso_de_cuota_de_comprobantes('a5900000-0000-0000-0000-000000000010')),
    (select usados from privado.uso_de_cuota_de_comprobantes('a5900000-0000-0000-0000-000000000011'))],
  array[0, 1],
  'El uso de la cuota no cuenta una subida de hace 24 horas exactas y sí una de un microsegundo menos');

insert into privado.subida_comprobante (carpeta, subido_en)
select 'a5900000-0000-0000-0000-00000000000d', now() - interval '24 hours' + interval '1 microsecond' from generate_series(1, 5);
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('comprobantes', 'a5900000-0000-0000-0000-00000000000d/' || gen_random_uuid() || '.png')$$,
  '23514', null,
  'Cinco subidas de hace 24 horas menos un microsegundo todavía cuentan');

-- Lo que ve la sesión: su uso, el máximo y desde cuándo se libera un cupo. El esperado se calcula antes,
-- con el rol dueño: la sesión no puede leer el registro.
create temp table libre_a on commit drop as
select min(subido_en) + interval '24 hours' as libre
from privado.subida_comprobante where carpeta = 'a5900000-0000-0000-0000-00000000000a';
grant select on libre_a to authenticated;

set local role authenticated;
set local request.jwt.claims to '{"sub":"a5900000-0000-0000-0000-00000000000a","role":"authenticated","is_anonymous":true}';
select results_eq(
  $$select usados, maximo, libre_desde = (select libre from libre_a) from public.mi_cuota_de_comprobantes()$$,
  $$values (5, 5, true)$$,
  'mi_cuota_de_comprobantes(): 5 de 5, y el cupo se libera 24 horas después de la subida más vieja');

-- Una sesión que intenta escribir en la carpeta llena de otra recibe el rechazo de la política (42501),
-- no el de la cuota: así no se entera de si la otra llegó al tope.
set local request.jwt.claims to '{"sub":"a5900000-0000-0000-0000-00000000000e","role":"authenticated"}';
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('comprobantes', 'a5900000-0000-0000-0000-00000000000a/' || gen_random_uuid() || '.png')$$,
  '42501', null,
  'Escribir en la carpeta de otra sesión llena falla por la política, sin revelar su cuota');

select results_eq(
  $$select usados, maximo, libre_desde from public.mi_cuota_de_comprobantes()$$,
  $$values (0, 5, null::timestamptz)$$,
  'Una sesión sin subidas tiene la cuota libre');

select throws_ok($$select * from public.tomar_comprobantes_huerfanos(10)$$, '42501', null,
  'Una sesión no puede tomar huérfanos: solo el servidor');
select throws_ok(
  $$select public.anotar_comprobante_revisado('d5900000-0000-0000-0000-000000000001/d5900000-0000-0000-0000-000000000001.png', 'image/png')$$,
  '42501', null,
  'Una sesión no puede anotar revisados: solo el servidor');
reset role;
-- Sin claims de nuevo, como el resto de la prueba.
set local request.jwt.claims to '{}';

set local role anon;
select throws_ok($$select * from public.mi_cuota_de_comprobantes()$$, '42501', null,
  'Sin sesión (anon) no se consulta la cuota');
reset role;

-- ---------------------------------------------------------------------------
-- 6. Huérfanos: más de 24 horas sin que ningún pago los use (con el reloj de la base)
-- ---------------------------------------------------------------------------
insert into storage.objects (bucket_id, name, created_at) values
  ('comprobantes', 'e5900000-0000-0000-0000-000000000001/e5900000-0000-0000-0000-000000000001.png', now() - interval '25 hours'), -- sin pago
  ('comprobantes', 'e5900000-0000-0000-0000-000000000002/e5900000-0000-0000-0000-000000000002.png', now() - interval '25 hours'), -- con pago
  ('comprobantes', 'e5900000-0000-0000-0000-000000000003/e5900000-0000-0000-0000-000000000003.png', now() - interval '1 hour'),
  ('comprobantes', 'e5900000-0000-0000-0000-000000000004/e5900000-0000-0000-0000-000000000004.png', now() - interval '24 hours'),
  ('comprobantes', 'e5900000-0000-0000-0000-000000000005/e5900000-0000-0000-0000-000000000005.png', now() - interval '24 hours' - interval '1 microsecond');

insert into public.comprobante_revisado (ruta, tipo) values
  ('e5900000-0000-0000-0000-000000000001/e5900000-0000-0000-0000-000000000001.png', 'image/png'),
  ('e5900000-0000-0000-0000-000000000002/e5900000-0000-0000-0000-000000000002.png', 'image/png');
insert into public.pago (id_monitoria, monto, nombre_pagador, contacto, id_admin, comprobante)
select id_monitoria, monto, nombre, contacto, id_admin, 'e5900000-0000-0000-0000-000000000002/e5900000-0000-0000-0000-000000000002.png'
from pago_base;

-- Sin límite práctico: la base local puede tener otros huérfanos de desarrollo, y el orden es por antigüedad.
create temp table tomados on commit drop as
select ruta from public.tomar_comprobantes_huerfanos(1000000) where ruta like 'e5900000-%';

select results_eq(
  $$select ruta from tomados order by ruta$$,
  $$values ('e5900000-0000-0000-0000-000000000001/e5900000-0000-0000-0000-000000000001.png'),
           ('e5900000-0000-0000-0000-000000000005/e5900000-0000-0000-0000-000000000005.png')$$,
  'Toma solo los de más de 24 horas sin pago: no el que un pago usa, ni el de 1 hora, ni el de 24 horas exactas');

select is(
  (select count(*)::int from public.comprobante_revisado
   where ruta = 'e5900000-0000-0000-0000-000000000001/e5900000-0000-0000-0000-000000000001.png'),
  0,
  'Al tomar un huérfano le quita la fila de revisado');

select is(
  public.anotar_comprobante_revisado('e5900000-0000-0000-0000-000000000001/e5900000-0000-0000-0000-000000000001.png', 'image/png'),
  'vencido',
  'Una revisión que llega mientras corre la limpieza no puede volver a anotar lo que la limpieza tomó');

select is(
  (select count(*)::int from public.comprobante_revisado
   where ruta = 'e5900000-0000-0000-0000-000000000002/e5900000-0000-0000-0000-000000000002.png'),
  1,
  'El revisado de un comprobante con pago se queda');

select is(
  (select count(*)::int from public.tomar_comprobantes_huerfanos(1)),
  1,
  'p_limite acota cuántos toma por vuelta');

-- ---------------------------------------------------------------------------
-- 7. El disparo de la limpieza
-- ---------------------------------------------------------------------------
select throws_ok($$select privado.disparar_proceso('https://otro.sitio/robar')$$, '22023', null,
  'disparar_proceso solo acepta rutas /api/procesos/<nombre>');
select throws_ok($$select privado.disparar_proceso('/api/procesos/../admin')$$, '22023', null,
  'disparar_proceso rechaza una ruta con puntos');
select is(
  (select privado.disparar_proceso('/api/procesos/limpiar-comprobantes')
   where not exists (select 1 from vault.decrypted_secrets where name in ('calibra_sitio_url', 'calibra_cron_secreto'))),
  null::bigint,
  'Sin la dirección y el secreto en Vault (en local), el disparo no hace nada');

select * from finish();
rollback;
