-- Invitar a un admin por correo. HU-072.
--
-- Un admin activo invita a una persona con su correo. A esa persona le llega un enlace de un solo uso que vence a
-- los 7 días (el patrón de la invitación de monitor, HU-013) y, al registrarse, queda como admin al final del orden
-- de revisión (RN-07). Aquí se guarda el SHA-256 del token, nunca el token: leer la tabla no da enlaces válidos.
--
-- Lo que esta migración deja:
--   * `public.invitacion_admin`: con RLS activa y SIN políticas, y permisos solo para service_role. A diferencia de
--     `invitacion_monitor`, ni siquiera un admin la lee: el hash de una invitación vigente no debe llegar a un
--     navegador. La lista y la cancelación pasan por funciones que no lo devuelven.
--   * `crear_invitacion_admin`, `registrar_admin` e `invitador_activo`: solo service_role (el servidor, con la llave
--     secreta).
--   * `invitaciones_de_admin` y `cancelar_invitacion_admin`: con la sesión de un admin activo.
--
-- Una invitación sirve solo mientras quien la hizo siga siendo un admin activo. `registrar_admin` lo comprueba al gastarla
-- y el servidor lo comprueba antes de mostrar el formulario (`invitador_activo`). Si la cuenta de quien invitó se
-- compromete y el equipo la desactiva, sus invitaciones abiertas dejan de servir al instante, incluida la que se
-- insertó justo antes del baneo (no hay barrido que una carrera pueda saltarse). Si se la reactiva, vuelven a servir
-- hasta que venzan: la fila no se toca. Cualquier admin activo la puede cancelar, y la lista dice que quien invitó ya
-- no está activo.
--
-- Por qué `crear_invitacion_admin` vive en `privado` como `security definer` y `public` solo trae la puerta: para
-- comprobar en la base que quien invita sea un admin ACTIVO hace falta `privado.admin_activo`, que service_role no
-- ejecuta. Es el patrón de `reasignar_casos_de_admin` (HU-054): definer en `privado` concedida a service_role y una
-- puerta `security invoker` en `public`.
--
-- Por qué no se bloquea la lista de admins con `for update` al calcular el orden del nuevo: cada `insert` en
-- certificado, pago, desembolso, reembolso, reporte_inasistencia o invitacion_monitor toma FOR KEY SHARE sobre su
-- admin, y FOR UPDATE choca con eso: un alta frenaría esos pagos y certificados. Basta serializar el cálculo de
-- `max + 1` con un candado de transacción (`orden_de_admins`), que además sirve con la tabla vacía.
--
-- Candados de transacción (pg_advisory_xact_lock), siempre en este orden:
--   1. `invitacion_admin:<correo>`: lo toman crear_invitacion_admin y registrar_admin, así que invitar y registrar
--      el mismo correo se hacen en fila.
--   2. `orden_de_admins`: solo registrar_admin.
--   cancelar_invitacion_admin no toma ninguno (le basta el bloqueo de fila de su `update`), así que no hay ciclo.
-- Idempotente.

-- ---------------------------------------------------------------------------
-- La tabla
-- ---------------------------------------------------------------------------
create table if not exists public.invitacion_admin (
  id uuid primary key default gen_random_uuid(),
  correo text not null,
  token_hash text not null,
  -- Quien invita. Sin cascada: a un admin se le desactiva, no se le borra (RN-23).
  id_admin uuid not null references public.admin (id),
  creada_en timestamptz not null default now(),
  vence_en timestamptz not null default now() + interval '7 days',
  usada_en timestamptz,
  cancelada_en timestamptz,
  id_admin_nuevo uuid references public.admin (id) on delete set null,
  constraint invitacion_admin_token_hash_key unique (token_hash),
  constraint invitacion_admin_token_hash_sha256 check (token_hash ~ '^[0-9a-f]{64}$'),
  -- El correo llega normalizado (minúsculas, sin espacios) y con la regla de correo seguro de HU-070.
  constraint invitacion_admin_correo_normalizado check (correo = lower(btrim(correo))),
  constraint invitacion_admin_correo_seguro check (privado.es_correo_seguro(correo)),
  constraint invitacion_admin_vence_despues check (vence_en > creada_en),
  constraint invitacion_admin_una_salida check (usada_en is null or cancelada_en is null),
  constraint invitacion_admin_nuevo_gastada check (id_admin_nuevo is null or usada_en is not null)
);
comment on table public.invitacion_admin is
  'Invitación de un solo uso para crear una cuenta de admin (HU-072). Guarda el hash del token, no el token. Cerrada a la Data API: solo service_role la toca; la lista y la cancelación pasan por funciones.';
comment on column public.invitacion_admin.token_hash is
  'SHA-256 del token en hex. El token viaja solo en el correo.';
comment on column public.invitacion_admin.id_admin is
  'El admin que invitó. Sin cascada (RN-23): si ya no está activo, la lista lo marca.';
comment on column public.invitacion_admin.id_admin_nuevo is
  'El admin que se registró con esta invitación. Solo existe si la invitación se usó.';

-- Una sola invitación abierta por correo. El índice no puede mirar el vencimiento (now() no es inmutable), así que
-- crear_invitacion_admin cancela primero TODAS las abiertas de ese correo, vencidas o no.
create unique index if not exists invitacion_admin_correo_abierta_key
  on public.invitacion_admin (correo) where usada_en is null and cancelada_en is null;
create index if not exists invitacion_admin_id_admin_idx on public.invitacion_admin (id_admin);
create index if not exists invitacion_admin_id_admin_nuevo_idx on public.invitacion_admin (id_admin_nuevo);

-- Sin políticas: con RLS activa eso niega todo a anon y authenticated (como aviso_monitor y diagnostico_en_curso).
alter table public.invitacion_admin enable row level security;
revoke all on table public.invitacion_admin from public, anon, authenticated, service_role;
-- Desde el 30-oct-2026 la Data API no expone nada sin GRANT explícito, tampoco a service_role.
grant select, insert, update, delete on table public.invitacion_admin to service_role;

-- ---------------------------------------------------------------------------
-- Crear la invitación (solo service_role)
-- ---------------------------------------------------------------------------
-- Resultado: creada, es_admin (el correo es de un admin activo), es_admin_desactivado, es_monitor o sin_permiso
-- (quien invita no es un admin activo). Nada de lo que no sea `creada` cambia la tabla. Los nombres de la tabla de
-- salida no repiten columnas (id_invitacion, vencimiento): en plpgsql chocarían con las del cuerpo.
create or replace function privado.crear_invitacion_admin(p_token_hash text, p_correo text, p_id_admin uuid)
returns table (resultado text, id_invitacion uuid, vencimiento timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_correo text := lower(btrim(p_correo));
  v_id uuid;
  v_vence timestamptz;
begin
  -- Segunda barrera: la acción ya exigió un admin activo con su sesión, pero la llave secreta no tiene sesión.
  if p_id_admin is null or not privado.admin_activo(p_id_admin) then
    return query select 'sin_permiso'::text, null::uuid, null::timestamptz;
    return;
  end if;

  -- Quien invita (o registra) el mismo correo a la vez espera su turno: el segundo cancela la invitación del primero.
  perform pg_advisory_xact_lock(hashtextextended('invitacion_admin:' || v_correo, 0));

  -- admin.correo no es único y puede traer mayúsculas: se compara normalizado. Si hubiera dos filas con el mismo
  -- correo, una activa y otra no, gana la activa.
  if exists (select 1 from public.admin a where lower(btrim(a.correo)) = v_correo and privado.admin_activo(a.id)) then
    return query select 'es_admin'::text, null::uuid, null::timestamptz;
    return;
  end if;
  if exists (select 1 from public.admin a where lower(btrim(a.correo)) = v_correo) then
    return query select 'es_admin_desactivado'::text, null::uuid, null::timestamptz;
    return;
  end if;
  if exists (select 1 from public.monitor_privado m where lower(btrim(m.correo)) = v_correo) then
    return query select 'es_monitor'::text, null::uuid, null::timestamptz;
    return;
  end if;

  update public.invitacion_admin i
  set cancelada_en = now()
  where i.correo = v_correo and i.usada_en is null and i.cancelada_en is null;

  insert into public.invitacion_admin (correo, token_hash, id_admin)
    values (v_correo, p_token_hash, p_id_admin)
    returning id, vence_en into v_id, v_vence;

  return query select 'creada'::text, v_id, v_vence;
end;
$$;

comment on function privado.crear_invitacion_admin(text, text, uuid) is
  'Crea la invitación de un admin y cancela las abiertas del mismo correo. Comprueba que quien invita sea un admin activo. Solo service_role, por public.crear_invitacion_admin. HU-072.';
revoke all on function privado.crear_invitacion_admin(text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function privado.crear_invitacion_admin(text, text, uuid) to service_role;

create or replace function public.crear_invitacion_admin(p_token_hash text, p_correo text, p_id_admin uuid)
returns table (resultado text, id_invitacion uuid, vencimiento timestamptz)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from privado.crear_invitacion_admin(p_token_hash, p_correo, p_id_admin);
$$;

comment on function public.crear_invitacion_admin(text, text, uuid) is
  'Crea la invitación de un admin (HU-072). Solo service_role: el servidor, con el hash del token y el id del admin que invita.';
revoke all on function public.crear_invitacion_admin(text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.crear_invitacion_admin(text, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- ¿Quien invitó sigue activo? (solo service_role)
-- ---------------------------------------------------------------------------
-- service_role no ejecuta `privado.admin_activo` (HU-054 lo cerró a propósito), así que esta función es la puerta que
-- sí: la usa `registrar_admin` al gastar la invitación y, por `public`, el servidor antes de mostrar el formulario.
-- Un id nulo o que no es de ningún admin da false.
create or replace function privado.invitador_activo(p_id_admin uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select privado.admin_activo(p_id_admin);
$$;

comment on function privado.invitador_activo(uuid) is
  'Si el admin que hizo una invitación sigue activo. Solo service_role, por public.invitador_activo y por registrar_admin. HU-072.';
revoke all on function privado.invitador_activo(uuid) from public, anon, authenticated, service_role;
grant execute on function privado.invitador_activo(uuid) to service_role;

create or replace function public.invitador_activo(p_id_admin uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select privado.invitador_activo(p_id_admin);
$$;

comment on function public.invitador_activo(uuid) is
  'Si el admin que hizo una invitación sigue activo: una invitación de un admin desactivado no sirve (HU-072). Solo service_role.';
revoke all on function public.invitador_activo(uuid) from public, anon, authenticated, service_role;
grant execute on function public.invitador_activo(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Registrar al admin (solo service_role)
-- ---------------------------------------------------------------------------
-- Como registrar_monitor: el servidor crea antes la cuenta en Auth y llama aquí con su id. Corre con los permisos
-- de quien llama (service_role ya tiene insert en admin y select en monitor_privado). Devuelve false, sin cambiar
-- nada, si la invitación no existe, ya se usó, se canceló, venció, es de otro correo o quien la hizo ya no es un admin
-- activo. Si algo más falla, lanza y revierte la llamada entera, incluido el gasto de la invitación: nada se queda a
-- medias.
create or replace function public.registrar_admin(p_token_hash text, p_id_usuario uuid, p_correo text, p_nombre text)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_correo text := lower(btrim(p_correo));
  v_id uuid;
  v_orden integer;
begin
  if btrim(coalesce(p_nombre, '')) = '' then
    raise exception 'El nombre no puede estar vacío' using errcode = '22023';
  end if;

  -- El mismo candado de crear_invitacion_admin: registrar y volver a invitar ese correo se hacen en fila.
  perform pg_advisory_xact_lock(hashtextextended('invitacion_admin:' || v_correo, 0));

  update public.invitacion_admin i
  set usada_en = now()
  where i.token_hash = p_token_hash
    and i.correo = v_correo
    and i.usada_en is null
    and i.cancelada_en is null
    and i.vence_en > now()
    -- Si quien invitó ya no está activo (su cuenta se desactivó), la invitación no sirve. Se mira aquí, al gastarla, y
    -- no al desactivar: así tampoco hay carrera con una invitación que se inserta justo antes del baneo.
    and privado.invitador_activo(i.id_admin)
  returning i.id into v_id;
  if v_id is null then
    return false;
  end if;

  -- admin.correo no es único: otro admin o un monitor con ese correo se rechaza (y revierte también el gasto).
  if exists (select 1 from public.admin a where lower(btrim(a.correo)) = v_correo)
     or exists (select 1 from public.monitor_privado m where lower(btrim(m.correo)) = v_correo) then
    raise exception 'Ese correo ya es de un admin o de un monitor' using errcode = 'P0001', hint = 'correo_en_uso';
  end if;

  -- Dos altas a la vez calcularían el mismo número: se hacen en fila. No se bloquean las filas de admin.
  perform pg_advisory_xact_lock(hashtextextended('orden_de_admins', 0));
  select coalesce(max(a.orden_revision), 0) + 1 into v_orden from public.admin a;

  insert into public.admin (id, nombre, correo, orden_revision)
    values (p_id_usuario, btrim(p_nombre), v_correo, v_orden);
  update public.invitacion_admin set id_admin_nuevo = p_id_usuario where id = v_id;
  return true;
end;
$$;

comment on function public.registrar_admin(text, uuid, text, text) is
  'Gasta la invitación y da de alta al admin al final del orden de revisión. Solo service_role, después de crear la cuenta en Auth. HU-072.';
revoke all on function public.registrar_admin(text, uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.registrar_admin(text, uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- La lista y la cancelación, con la sesión de un admin activo
-- ---------------------------------------------------------------------------
-- El patrón de equipo_de_admins: definer en `privado` concedida a authenticated y una puerta `invoker` en `public`
-- que solo hace select. A cualquier otro rol (monitor, estudiante, sesión anónima, admin desactivado) la lista le
-- llega vacía y cancelar responde sin_permiso; a anon, 42501. El hash no sale en ninguna.
create or replace function privado.invitaciones_de_admin()
returns table (id uuid, correo text, invitada_por text, invito_activo boolean, creada_en timestamptz, vence_en timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.correo, a.nombre, privado.admin_activo(a.id), i.creada_en, i.vence_en
  from public.invitacion_admin i
  join public.admin a on a.id = i.id_admin
  where (select privado.es_admin())
    and i.usada_en is null
    and i.cancelada_en is null
    and i.vence_en > now()
  order by i.creada_en desc, i.id;
$$;

revoke all on function privado.invitaciones_de_admin() from public, anon, authenticated, service_role;
grant execute on function privado.invitaciones_de_admin() to authenticated;

create or replace function public.invitaciones_de_admin()
returns table (id uuid, correo text, invitada_por text, invito_activo boolean, creada_en timestamptz, vence_en timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from privado.invitaciones_de_admin();
$$;

comment on function public.invitaciones_de_admin() is
  'Las invitaciones de admin abiertas (sin usar, sin cancelar y sin vencer), sin el hash, y si quien invitó sigue activo. Solo para un admin activo; a los demás, vacío. HU-072.';
revoke all on function public.invitaciones_de_admin() from public, anon, authenticated, service_role;
grant execute on function public.invitaciones_de_admin() to authenticated;

-- Resultado: cancelada, no_abierta (existe, pero ya se usó, se canceló o venció), no_encontrada o sin_permiso.
create or replace function privado.cancelar_invitacion_admin(p_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not (select privado.es_admin()) then
    return 'sin_permiso';
  end if;

  update public.invitacion_admin i
  set cancelada_en = now()
  where i.id = p_id
    and i.usada_en is null
    and i.cancelada_en is null
    and i.vence_en > now()
  returning i.id into v_id;
  if v_id is not null then
    return 'cancelada';
  end if;

  if exists (select 1 from public.invitacion_admin i where i.id = p_id) then
    return 'no_abierta';
  end if;
  return 'no_encontrada';
end;
$$;

revoke all on function privado.cancelar_invitacion_admin(uuid) from public, anon, authenticated, service_role;
grant execute on function privado.cancelar_invitacion_admin(uuid) to authenticated;

create or replace function public.cancelar_invitacion_admin(p_id uuid)
returns text
language sql
volatile
security invoker
set search_path = ''
as $$
  select privado.cancelar_invitacion_admin(p_id);
$$;

comment on function public.cancelar_invitacion_admin(uuid) is
  'Un admin activo cancela una invitación abierta: su enlace deja de servir. HU-072.';
revoke all on function public.cancelar_invitacion_admin(uuid) from public, anon, authenticated, service_role;
grant execute on function public.cancelar_invitacion_admin(uuid) to authenticated;
