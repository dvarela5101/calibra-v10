-- Pruebas pgTAP de HU-070: la regla de correo seguro, compartida por todas las tablas que guardan un correo.
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.
-- Los casos de la función son los mismos de src/lib/correo/contacto.test.ts (esCorreo).

begin;
create extension if not exists pgtap with schema extensions;

select plan(31);

-- ---------------------------------------------------------------------------
-- 1. La función: estructura y permisos
-- ---------------------------------------------------------------------------
select has_function('privado', 'es_correo_seguro', array['text'], 'Existe privado.es_correo_seguro(text)');

select ok(
  (select p.provolatile = 'i' and not p.prosecdef and p.proconfig @> array['search_path=""']
     from pg_proc p where p.oid = 'privado.es_correo_seguro(text)'::regprocedure),
  'Es inmutable, corre con los permisos de quien la llama y con el search_path vacío');

-- Postgres evalúa un check con los permisos de quien escribe la fila: sin este execute, un insert fallaría.
select ok(
  has_function_privilege('anon', 'privado.es_correo_seguro(text)', 'execute')
  and has_function_privilege('authenticated', 'privado.es_correo_seguro(text)', 'execute')
  and has_function_privilege('service_role', 'privado.es_correo_seguro(text)', 'execute'),
  'La ejecutan anon, authenticated y service_role (los checks la evalúan con los permisos de quien escribe)');

select ok(
  not exists (select 1 from pg_proc p, aclexplode(p.proacl) a
               where p.oid = 'privado.es_correo_seguro(text)'::regprocedure and a.grantee = 0),
  'No queda execute para PUBLIC');

-- ---------------------------------------------------------------------------
-- 2. La función: acepta y rechaza lo mismo que esCorreo()
-- ---------------------------------------------------------------------------
create temp table casos_correo (correo text, valido boolean) on commit drop;
insert into casos_correo (correo, valido) values
  -- Se aceptan.
  ('ana@uniandes.edu.co', true),
  ('ana.perez+calibra@uniandes.edu.co', true),
  ('ana.perez+monitor@uniandes.edu.co', true),
  ('o''neil@example.com', true),
  ('a@b.co', true),
  ('ANA@Uniandes.EDU.CO', true),
  ('primer_apellido-2@sub.dominio.com', true),
  ('ana_p%1@sub.uniandes.edu.co', true),
  ('ana@uni-andes.co', true),
  ('a-b.c@x-y.z-w.org', true),
  ('a@1.co', true),
  (repeat('a', 249) || '@b.co', true),
  -- Lo que no es un correo.
  ('', false),
  ('ana.uniandes.edu.co', false),
  ('ana@', false),
  ('@uniandes.edu.co', false),
  ('ana@uniandes', false),
  ('ana@@uniandes.edu.co', false),
  ('ana perez@uniandes.edu.co', false),
  ('ana@uniandes.edu.co ', false),
  (E'ana@uniandes.edu.co\t', false),
  (E'ana@uniandes.edu.co\n', false),
  (E'ana@uniandes.edu.co\nBcc: otro@dominio.co', false),
  ('ana@uniandes.edu.co,otro@dominio.co', false),
  ('ana@uniandes.edu.co;otro@dominio.co', false),
  ('<ana@uniandes.edu.co>', false),
  ('Ana <ana@uniandes.edu.co>', false),
  ('"ana"@uniandes.edu.co', false),
  ('3001234567', false),
  ('+57 300 123 4567', false),
  ('ana@x@uniandes.edu.co', false),
  -- Lo que en un enlace mailto: se leería como parámetros.
  ('ana@x.co?bcc=otro@y.co', false),
  ('ana@x.co?', false),
  ('ana@x.co&cc=otro', false),
  ('ana@x.co=1', false),
  ('ana@x.co#ancla', false),
  ('ana@x.co/ruta', false),
  ('ana@x.co%3Fbcc%3Dotro', false),
  ('ana@uni_andes.edu.co', false),
  ('ana@uniandés.edu.co', false),
  ('ana@año.co', false),
  ('ana?cc=x@uniandes.edu.co', false),
  ('ana&cc=x@uniandes.edu.co', false),
  ('ana=x@uniandes.edu.co', false),
  ('ana#x@uniandes.edu.co', false),
  ('ana/x@uniandes.edu.co', false),
  ('ana!x@uniandes.edu.co', false),
  ('ana*x@uniandes.edu.co', false),
  ('ana$x@uniandes.edu.co', false),
  ('ana{x@uniandes.edu.co', false),
  ('ana|x@uniandes.edu.co', false),
  ('ana^x@uniandes.edu.co', false),
  ('ana~x@uniandes.edu.co', false),
  ('ánã@uniandes.edu.co', false),
  -- Etiquetas vacías y dominios sin punto.
  ('a@x..co', false),
  ('a@.x.co', false),
  ('a@x.co.', false),
  ('a@.', false),
  ('a@x.', false),
  ('a@..', false),
  ('a@x', false),
  ('a@-', false),
  -- El largo máximo: 254.
  (repeat('a', 250) || '@b.co', false);

select results_eq(
  $$select correo from casos_correo where privado.es_correo_seguro(correo) is distinct from valido order by correo$$,
  $$select correo from casos_correo where false$$,
  'La función acepta y rechaza los mismos casos que esCorreo()');

select is(privado.es_correo_seguro(null), false, 'Un correo nulo no es un correo seguro (la tabla decide si lo admite)');

-- ---------------------------------------------------------------------------
-- 3. Cada tabla con un correo lo exige, al insertar y al actualizar
-- ---------------------------------------------------------------------------
insert into auth.users (id, is_anonymous) values
  ('a0000000-0000-0000-0000-000000000070', false),
  ('a0000000-0000-0000-0000-000000000071', false),
  ('b0000000-0000-0000-0000-000000000070', false),
  ('b0000000-0000-0000-0000-000000000071', false);
insert into public.monitor (id, nombre) values
  ('b0000000-0000-0000-0000-000000000070', 'Monitor HU-070'),
  ('b0000000-0000-0000-0000-000000000071', 'Monitor HU-070 B');

-- admin.correo
select lives_ok(
  $$insert into public.admin (id, nombre, correo, orden_revision)
    values ('a0000000-0000-0000-0000-000000000070', 'Admin HU-070', 'admin-0070@example.com', 9000070)$$,
  'admin: se guarda un correo normal');
select throws_ok(
  $$insert into public.admin (id, nombre, correo, orden_revision)
    values ('a0000000-0000-0000-0000-000000000071', 'Admin HU-070 B', 'ana@x.co?bcc=otro@y.co', 9000071)$$,
  '23514', 'new row for relation "admin" violates check constraint "admin_correo_seguro"',
  'admin: un correo con parámetros de mailto se rechaza al insertar');
select throws_ok(
  $$update public.admin set correo = 'ana@x.co?bcc=otro@y.co' where id = 'a0000000-0000-0000-0000-000000000070'$$,
  '23514', 'new row for relation "admin" violates check constraint "admin_correo_seguro"',
  'admin: ni al actualizar');

-- monitor_privado.correo
select lives_ok(
  $$insert into public.monitor_privado (id_monitor, numero_telefono, correo, llave)
    values ('b0000000-0000-0000-0000-000000000070', '+570070000001', 'monitor-0070@example.com', 'llave-0070')$$,
  'monitor_privado: se guarda un correo normal');
select throws_ok(
  $$insert into public.monitor_privado (id_monitor, numero_telefono, correo, llave)
    values ('b0000000-0000-0000-0000-000000000071', '+570070000002', 'ana@x.co?bcc=otro@y.co', 'llave-0071')$$,
  '23514', 'new row for relation "monitor_privado" violates check constraint "monitor_privado_correo_seguro"',
  'monitor_privado: un correo con parámetros de mailto se rechaza al insertar');
select throws_ok(
  $$update public.monitor_privado set correo = 'ana@x.co?bcc=otro@y.co' where id_monitor = 'b0000000-0000-0000-0000-000000000070'$$,
  '23514', 'new row for relation "monitor_privado" violates check constraint "monitor_privado_correo_seguro"',
  'monitor_privado: ni al actualizar');

-- invitacion_monitor.correo (llega en minúsculas, así que solo frena la regla nueva)
select lives_ok(
  $$insert into public.invitacion_monitor (correo, token_hash, id_admin)
    values ('invitado-0070@example.com', repeat('7', 64), 'a0000000-0000-0000-0000-000000000070')$$,
  'invitacion_monitor: se guarda un correo normal');
select throws_ok(
  $$insert into public.invitacion_monitor (correo, token_hash, id_admin)
    values ('ana@x.co?bcc=otro@y.co', repeat('8', 64), 'a0000000-0000-0000-0000-000000000070')$$,
  '23514', 'new row for relation "invitacion_monitor" violates check constraint "invitacion_monitor_correo_seguro"',
  'invitacion_monitor: un correo con parámetros de mailto se rechaza al insertar');
select throws_ok(
  $$update public.invitacion_monitor set correo = 'ana@x.co?bcc=otro@y.co' where correo = 'invitado-0070@example.com'$$,
  '23514', 'new row for relation "invitacion_monitor" violates check constraint "invitacion_monitor_correo_seguro"',
  'invitacion_monitor: ni al actualizar');

-- lead.correo (opcional: puede dejar solo el teléfono, RN-11)
select lives_ok(
  $$insert into public.lead (nombre, correo, acepta_tratamiento_datos, fecha_consentimiento)
    values ('Lead HU-070', 'lead-0070@example.com', true, now())$$,
  'lead: se guarda un correo normal');
select lives_ok(
  $$insert into public.lead (nombre, numero_telefono, acepta_tratamiento_datos, fecha_consentimiento)
    values ('Lead HU-070 sin correo', '+570070000003', true, now())$$,
  'lead: sin correo (solo teléfono) sigue valiendo');
select throws_ok(
  $$insert into public.lead (nombre, correo, acepta_tratamiento_datos, fecha_consentimiento)
    values ('Lead HU-070 B', 'ana@x.co?bcc=otro@y.co', true, now())$$,
  '23514', 'new row for relation "lead" violates check constraint "lead_correo_seguro"',
  'lead: un correo con parámetros de mailto se rechaza al insertar');
select throws_ok(
  $$update public.lead set correo = 'ana@x.co?bcc=otro@y.co' where correo = 'lead-0070@example.com'$$,
  '23514', 'new row for relation "lead" violates check constraint "lead_correo_seguro"',
  'lead: ni al actualizar');

-- correo_envio.destinatario
select lives_ok(
  $$insert into public.correo_envio (clave, plantilla, destinatario) values ('c-0070-1', 'p', 'ana@example.com')$$,
  'correo_envio: se guarda un destinatario normal');
select throws_ok(
  $$insert into public.correo_envio (clave, plantilla, destinatario) values ('c-0070-2', 'p', 'ana@x.co?bcc=otro@y.co')$$,
  '23514', 'new row for relation "correo_envio" violates check constraint "correo_envio_destinatario_seguro"',
  'correo_envio: un destinatario con parámetros de mailto se rechaza al insertar');
select throws_ok(
  $$update public.correo_envio set destinatario = 'ana@x.co?bcc=otro@y.co' where clave = 'c-0070-1'$$,
  '23514', 'new row for relation "correo_envio" violates check constraint "correo_envio_destinatario_seguro"',
  'correo_envio: ni al actualizar');

-- solicitud_monitor.correo: la regla compartida reemplazó a la de HU-062, y el correo sigue llegando en minúsculas.
select lives_ok(
  $$insert into public.solicitud_monitor (nombre, correo, numero_telefono, acepta_tratamiento_datos, fecha_consentimiento)
    values ('Aspirante HU-070', 'aspirante-0070@example.com', '+570070000004', true, now())$$,
  'solicitud_monitor: se guarda un correo normal');
select throws_ok(
  $$insert into public.solicitud_monitor (nombre, correo, numero_telefono, acepta_tratamiento_datos, fecha_consentimiento)
    values ('Aspirante HU-070 B', 'ana@x.co?bcc=otro@y.co', '+570070000005', true, now())$$,
  '23514', 'new row for relation "solicitud_monitor" violates check constraint "solicitud_monitor_correo"',
  'solicitud_monitor: un correo con parámetros de mailto se rechaza al insertar');
select throws_ok(
  $$insert into public.solicitud_monitor (nombre, correo, numero_telefono, acepta_tratamiento_datos, fecha_consentimiento)
    values ('Aspirante HU-070 C', 'Aspirante@Example.com', '+570070000006', true, now())$$,
  '23514', 'new row for relation "solicitud_monitor" violates check constraint "solicitud_monitor_correo"',
  'solicitud_monitor: con mayúsculas se sigue rechazando (llega normalizado)');
select throws_ok(
  $$update public.solicitud_monitor set correo = 'ana@x.co?bcc=otro@y.co' where correo = 'aspirante-0070@example.com'$$,
  '23514', 'new row for relation "solicitud_monitor" violates check constraint "solicitud_monitor_correo"',
  'solicitud_monitor: ni al actualizar');

-- ---------------------------------------------------------------------------
-- 4. Quien escribe con su rol evalúa el check con sus propios permisos
-- ---------------------------------------------------------------------------
set local role service_role;
select lives_ok(
  $$insert into public.correo_envio (clave, plantilla, destinatario) values ('c-0070-3', 'p', 'servidor@example.com')$$,
  'El servidor (service_role) guarda un correo normal');
select throws_ok(
  $$insert into public.correo_envio (clave, plantilla, destinatario) values ('c-0070-4', 'p', 'ana@x.co?bcc=otro@y.co')$$,
  '23514', null,
  'Y a él también le rechaza el de parámetros, con el error del check y no con uno de permisos');
reset role;

-- Un admin con su sesión cambia el estado de una solicitud: el check corre con los permisos de authenticated.
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-0000-0000-000000000070","role":"authenticated"}';
update public.solicitud_monitor
   set estado = 'contactada', id_admin_actualizo = 'a0000000-0000-0000-0000-000000000070'
 where correo = 'aspirante-0070@example.com';
reset role;
select is(
  (select estado::text from public.solicitud_monitor where correo = 'aspirante-0070@example.com'),
  'contactada',
  'Un admin con su sesión cambia el estado de la solicitud: el check no le exige permisos de más');

set local role anon;
select is(privado.es_correo_seguro('ana@uniandes.edu.co'), true, 'Sin sesión (anon) también puede evaluar la función');
reset role;

-- ---------------------------------------------------------------------------
-- 5. Antes de exigirla, la migración comprueba los datos que ya hay
-- ---------------------------------------------------------------------------
-- Con un correo que no la cumple ya guardado (se quita el check para poder dejarlo), el bloque de la migración
-- se detiene y dice la tabla, la columna y cuántas filas. Es una copia del bloque de la migración
-- `*_correo_seguro.sql`: si ese bloque cambia, este también.
alter table public.correo_envio drop constraint correo_envio_destinatario_seguro;
insert into public.correo_envio (clave, plantilla, destinatario) values ('c-0070-5', 'p', 'ana@x.co?bcc=otro@y.co');

select throws_ok(
  $prueba$
  do $$
  declare
    v_tabla text;
    v_columna text;
    v_cuantas bigint;
    v_problemas text := '';
  begin
    for v_tabla, v_columna in
      select t.tabla, t.columna
      from (values
        ('admin', 'correo'),
        ('lead', 'correo'),
        ('monitor_privado', 'correo'),
        ('invitacion_monitor', 'correo'),
        ('correo_envio', 'destinatario'),
        ('solicitud_monitor', 'correo')
      ) as t (tabla, columna)
    loop
      execute format(
        'select count(*) from public.%I where %I is not null and not privado.es_correo_seguro(%I)',
        v_tabla, v_columna, v_columna
      ) into v_cuantas;
      if v_cuantas > 0 then
        v_problemas := v_problemas || format(' public.%s.%s: %s fila(s).', v_tabla, v_columna, v_cuantas);
      end if;
    end loop;

    if v_problemas <> '' then
      raise exception 'No se puede exigir el correo seguro (HU-070): hay correos que no cumplen la regla.%', v_problemas
        using errcode = '23514',
              hint = 'Corrige esas filas (por ejemplo: select * from public.<tabla> where not privado.es_correo_seguro(<columna>)) y vuelve a aplicar la migración.';
    end if;
  end $$;
  $prueba$,
  '23514',
  'No se puede exigir el correo seguro (HU-070): hay correos que no cumplen la regla. public.correo_envio.destinatario: 1 fila(s).',
  'Con un correo que no la cumple ya guardado, la comprobación previa se detiene y dice la tabla, la columna y cuántas');

select * from finish();
rollback;
