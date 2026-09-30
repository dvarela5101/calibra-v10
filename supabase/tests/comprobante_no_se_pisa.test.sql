-- Pruebas pgTAP de HU-067: un comprobante subido no se reemplaza ni se mueve.
-- Corre con: npx supabase test db
-- Todo ocurre en una transacción que termina en rollback: no deja datos.

begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

select is(
  (select array_agg(tgname::text) from pg_trigger
   where tgrelid = 'storage.objects'::regclass and tgname = 'comprobantes_no_se_pisan' and tgenabled <> 'D'
     and (tgtype & 2) = 2    -- before
     and (tgtype & 16) = 16), -- update
  array['comprobantes_no_se_pisan'],
  'El trigger corre antes de cada UPDATE de storage.objects');

select ok(
  not has_function_privilege('authenticated', 'privado.impedir_pisar_comprobantes()', 'execute')
  and not has_function_privilege('service_role', 'privado.impedir_pisar_comprobantes()', 'execute')
  and not has_function_privilege('anon', 'privado.impedir_pisar_comprobantes()', 'execute'),
  'La función del trigger no la ejecuta ninguna sesión');

-- Un comprobante y un archivo de otro bucket. Se trabaja como postgres, que es el rol con que el Storage
-- escribe cuando pisa un archivo (subida con URL firmada o con la llave secreta).
insert into storage.buckets (id, name) values ('otro-bucket-067', 'otro-bucket-067');
insert into storage.objects (bucket_id, name, version, metadata) values
  ('comprobantes', 'f6700000-0000-0000-0000-000000000001/f6700000-0000-0000-0000-000000000001.png', 'v1',
   '{"eTag": "\"uno\"", "size": 16, "mimetype": "image/png"}'),
  ('otro-bucket-067', 'f6700000-0000-0000-0000-000000000001/otro.png', 'v1',
   '{"eTag": "\"otro\"", "size": 16, "mimetype": "image/png"}');

create temp table ruta on commit drop as
select 'f6700000-0000-0000-0000-000000000001/f6700000-0000-0000-0000-000000000001.png'::text as nombre;

select throws_ok(
  $$update storage.objects set version = 'v2', metadata = '{"eTag": "\"dos\"", "size": 16, "mimetype": "image/jpeg"}'
    where bucket_id = 'comprobantes' and name = (select nombre from ruta)$$,
  '42501', 'Un comprobante no se puede reemplazar ni mover: sube uno nuevo.',
  'Pisar el contenido (nueva versión y metadatos, como hace el Storage) se rechaza');

select throws_ok(
  $$update storage.objects set version = 'v2' where bucket_id = 'comprobantes' and name = (select nombre from ruta)$$,
  '42501', null,
  'Cambiar solo la versión se rechaza');

-- Con la llave secreta el Storage prueba la escritura con el rol service_role: tampoco puede.
grant select on ruta to service_role;
set local role service_role;
select throws_ok(
  $$update storage.objects set version = 'v2' where bucket_id = 'comprobantes' and name = (select nombre from ruta)$$,
  '42501', null,
  'Tampoco con el rol service_role (la llave secreta): el trigger no depende del rol');
reset role;

select throws_ok(
  $$update storage.objects set metadata = metadata || '{"eTag": "\"dos\""}'
    where bucket_id = 'comprobantes' and name = (select nombre from ruta)$$,
  '42501', null,
  'Cambiar solo el eTag se rechaza');

select throws_ok(
  $$update storage.objects set name = 'f6700000-0000-0000-0000-000000000001/f6700000-0000-0000-0000-000000000002.png'
    where bucket_id = 'comprobantes' and name = (select nombre from ruta)$$,
  '42501', null,
  'Moverlo a otra ruta se rechaza: pago.comprobante apunta a esa ruta');

select throws_ok(
  $$update storage.objects set bucket_id = 'otro-bucket-067'
    where bucket_id = 'comprobantes' and name = (select nombre from ruta)$$,
  '42501', null,
  'Sacarlo del bucket se rechaza');

select throws_ok(
  $$update storage.objects set bucket_id = 'comprobantes'
    where bucket_id = 'otro-bucket-067' and name = 'f6700000-0000-0000-0000-000000000001/otro.png'$$,
  '42501', null,
  'Meter un archivo de otro bucket al de comprobantes se rechaza: entraría sin pasar por la cuota');

select lives_ok(
  $$update storage.objects set last_accessed_at = now() where bucket_id = 'comprobantes' and name = (select nombre from ruta)$$,
  'Lo que no toca el contenido ni la ruta (la última lectura) se puede actualizar');

select lives_ok(
  $$update storage.objects set user_metadata = '{"nota": "x"}' where bucket_id = 'comprobantes' and name = (select nombre from ruta)$$,
  'Los metadatos de usuario tampoco son contenido');

select results_eq(
  $$select version, metadata ->> 'eTag' from storage.objects where bucket_id = 'comprobantes' and name = (select nombre from ruta)$$,
  $$values ('v1'::text, '"uno"'::text)$$,
  'Después de todo, el comprobante sigue con su contenido original');

select lives_ok(
  $$update storage.objects set version = 'v2' where bucket_id = 'otro-bucket-067' and name = 'f6700000-0000-0000-0000-000000000001/otro.png'$$,
  'Los archivos de otros buckets no se ven afectados');

-- Borrar sigue igual (la limpieza de HU-059 borra con la API de Storage, que habilita este permiso).
set local storage.allow_delete_query = 'true';
select lives_ok(
  $$delete from storage.objects where bucket_id = 'comprobantes' and name = (select nombre from ruta)$$,
  'Borrar un comprobante (como hace la API de Storage con la llave secreta) sigue funcionando');

select * from finish();
rollback;
