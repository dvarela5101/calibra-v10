-- Semilla de la base LOCAL. HU-012.
--
-- La corren `supabase db reset` y `supabase start` sobre una base nueva. Nunca se usa contra el
-- proyecto real. Ojo: `supabase db push` sin más no aplica semillas, pero `supabase db push
-- --include-seed` sí la aplicaría, igual que `db reset --linked`. CLAUDE.md prohíbe todo `db push`
-- y todo `--linked` contra el proyecto real. No la ejecutes a mano contra una base remota: crea
-- cuentas con una contraseña que está en el repo.
--
-- Admins iniciales de PRUEBA con su orden de revisión (RN-07). La lista real de admins y su orden
-- la define la persona antes del corte a producción (HU-057); esta semilla no llega ahí.
--
--   admin1@calibra.test  orden 1  (primero de la lista rotativa)
--   admin2@calibra.test  orden 2
--   contraseña de ambos en local: calibra-admin-local (ver README)
--
-- Idempotente: volver a correrla no duplica nada ni cambia lo que ya existe.
-- El orden de revisión es único y las pruebas pgTAP usan números altos (9000001 en adelante)
-- para no chocar con estos.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
) values
  (
    '00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'admin1@calibra.test',
    extensions.crypt('calibra-admin-local', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'admin2@calibra.test',
    extensions.crypt('calibra-admin-local', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
  )
on conflict (id) do nothing;

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select
  gen_random_uuid(), u.id, u.id::text,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'email', now(), now(), now()
from auth.users u
where u.id in ('a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002')
  and not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email');

insert into public.admin (id, nombre, correo, orden_revision) values
  ('a1000000-0000-4000-8000-000000000001', 'Admin Uno', 'admin1@calibra.test', 1),
  ('a1000000-0000-4000-8000-000000000002', 'Admin Dos', 'admin2@calibra.test', 2)
on conflict (id) do nothing;
