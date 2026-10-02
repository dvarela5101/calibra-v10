-- Tope de correos por sesión al dejar el contacto. HU-075.
--
-- D-34 (2-oct-2026): antes de publicar, un tope de intentos por sesión al escribir correos al agendar. Completa lo
-- aceptado para el aviso «Ese correo ya está en Calibra» de HU-068: el CAPTCHA (HU-058) solo protege crear la sesión
-- anónima, y con una sesión válida se podían probar correos sin límite para averiguar cuáles tienen cuenta.
-- D-36 (2-oct-2026): una misma sesión escribe hasta 5 correos distintos por hora móvil. Cuentan todos los distintos,
-- existan o no en Calibra, para que el tope no revele nada. Al pasarse no se guarda el contacto ni se dice si el correo
-- existe, y se le pide esperar (el mensaje lo pone el servidor).
--
-- Supuestos de HU-075 por confirmar con dvarela5101 (registro de la HU; no son decisiones D-n):
--   1. El tope cubre también editar el contacto (/agendar/contacto?editar=1), que responde «Ese correo ya es de otro
--      contacto de Calibra»: sin tope, bastaría dejar un primer correo para probar los demás sin límite.
--   2. Volver a enviar el correo que la sesión ya tiene guardado (para cambiar solo el nombre o el teléfono) no cuenta:
--      no revela nada. Lo decide el servidor, que en ese caso no llama al tope.
--   3. Para contar, la base guarda por una hora el SHA-256 de cada correo escrito, no el correo, y lo borra después.
--      No cambia el aviso de privacidad.
--   4. Un correo inválido o un envío sin la autorización no cuentan: el servidor los rechaza antes de llegar aquí.
--
-- Diseño (registro de HU-075):
--   * Una función aparte que anota y cuenta, y que el servidor llama antes de las dos ramas de registrarContacto (crear
--     el Lead con registrar_lead o editar el que ya tiene). No va dentro de registrar_lead: cuando el correo ya es de
--     otro Lead, esa función lanza 23505 y la transacción entera se deshace, así que el intento anotado se perdería y
--     justo los correos que existen no contarían.
--   * Dos envíos de la misma sesión se cuentan uno detrás del otro con el candado por sesión de registrar_lead (6801).
--   * El tope (5) y la ventana (60 minutos) viven en la base, en parametros_contacto().
--   * La versión con p_ahora queda interna, sin grant (como registrar_pago tras HU-027 y revisar_pago en HU-020): el
--     servidor entra por public.anotar_correo_de_contacto, que llama a privado.anotar_correo_de_contacto_del_servidor,
--     y esa usa now().
--   * Al anotar se borran las filas viejas de la sesión; un proceso de pg_cron borra cada hora las de todas, y las de
--     una sesión borrada se van con ella (on delete cascade).
-- No redefine ninguna función existente.
-- Idempotente.

-- ---------------------------------------------------------------------------
-- Parámetros (D-36)
-- ---------------------------------------------------------------------------
create or replace function public.parametros_contacto()
returns table (
  tope_correos integer,
  tope_ventana_min integer
)
language sql
stable
parallel safe
set search_path = ''
as $$
  select
    5,    -- tope_correos: correos distintos que una sesión puede escribir en la ventana
    60    -- tope_ventana_min: la ventana del tope, una hora móvil
$$;

revoke all on function public.parametros_contacto() from public, anon, authenticated, service_role;
grant execute on function public.parametros_contacto() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Los correos que escribió cada sesión en la ventana
-- ---------------------------------------------------------------------------
-- Una fila por sesión y correo distinto. escrito_en es la primera vez dentro de la ventana: repetir el correo no la
-- mueve.
create table if not exists privado.correo_de_contacto (
  id_sesion uuid not null references auth.users (id) on delete cascade,
  correo_hash text not null,
  escrito_en timestamptz not null default now(),
  primary key (id_sesion, correo_hash),
  constraint correo_de_contacto_hash check (correo_hash ~ '^[0-9a-f]{64}$')
);
-- Lo que recorre la purga de cada hora.
create index if not exists correo_de_contacto_escrito_en_idx on privado.correo_de_contacto (escrito_en);

comment on table privado.correo_de_contacto is
  'Correos distintos que escribió cada sesión al dejar su contacto, para el tope de D-36. Guarda el SHA-256 del correo normalizado (minúsculas, sin espacios en los bordes, como lead.correo) y no el correo: alcanza para saber si la sesión ya lo escribió y no deja en la base los correos de terceros que alguien probó (supuesto 3). Se purga pasada la ventana. HU-075.';

-- Nadie la lee ni la escribe directamente, tampoco el servidor: solo las funciones de abajo.
alter table privado.correo_de_contacto enable row level security;
revoke all on table privado.correo_de_contacto from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Anotar el correo y decir si la sesión puede seguir (D-36)
-- ---------------------------------------------------------------------------
-- true: puede seguir (el correo ya estaba anotado en la ventana o se anotó ahora). false: la sesión ya escribió
-- tope_correos correos distintos en la ventana y este es otro; no se anota (un intento frenado no cuenta) y el servidor
-- no guarda el contacto ni manda enlace. No lee lead: la respuesta no depende de si el correo existe en Calibra.
-- La ventana tiene el borde de crear_verificacion_lead (HU-068): cuenta lo escrito después de ahora - ventana; lo
-- escrito justo en ahora - ventana ya no cuenta.
-- Un correo nulo o en blanco es un error: el servidor nunca lo manda (el correo es obligatorio, P-21).
create or replace function privado.anotar_correo_de_contacto(
  p_id_sesion uuid,
  p_correo text,
  p_ahora timestamptz default now()
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_correo text := lower(btrim(p_correo));
  v_hash text;
  v_tope integer;
  v_ventana integer;
begin
  if v_correo is null or v_correo = '' then
    raise exception 'Falta el correo.' using errcode = 'invalid_parameter_value';
  end if;
  v_hash := encode(extensions.digest(v_correo, 'sha256'), 'hex');

  -- El candado por sesión de registrar_lead y confirmar_correo_de_lead (HU-068): dos envíos de la misma sesión (dos
  -- pestañas, un doble clic) se cuentan uno detrás del otro, y quedan en fila con los que crean o ligan su Lead. Sin
  -- él, dos correos nuevos a la vez con 4 anotados verían 4 los dos y quedarían 6.
  perform pg_advisory_xact_lock(6801, hashtext(p_id_sesion::text));

  select p.tope_correos, p.tope_ventana_min into v_tope, v_ventana from public.parametros_contacto() p;

  -- Lo de esta sesión que ya salió de la ventana deja de contar (lo de las demás lo borra el proceso de cada hora).
  delete from privado.correo_de_contacto c
  where c.id_sesion = p_id_sesion
    and c.escrito_en <= p_ahora - make_interval(mins => v_ventana);

  -- Criterio 3: un correo que la sesión ya escribió en la ventana no suma, aunque el tope esté lleno.
  if exists (
    select 1 from privado.correo_de_contacto c where c.id_sesion = p_id_sesion and c.correo_hash = v_hash
  ) then
    return true;
  end if;

  -- Criterios 1 y 2: con el tope lleno, un correo distinto no pasa, exista o no en Calibra.
  if (select count(*) from privado.correo_de_contacto c where c.id_sesion = p_id_sesion) >= v_tope then
    return false;
  end if;

  insert into privado.correo_de_contacto (id_sesion, correo_hash, escrito_en) values (p_id_sesion, v_hash, p_ahora);
  return true;
end;
$$;

-- La versión con p_ahora es interna: nadie elige la hora para salirse de la ventana. La usan
-- anotar_correo_de_contacto_del_servidor, con now(), y las pruebas, como postgres.
revoke all on function privado.anotar_correo_de_contacto(uuid, text, timestamptz) from public, anon, authenticated, service_role;

-- La que ejecuta el servidor: la misma, con la hora de la base. service_role ya entra al esquema privado
-- (20261001074954_equipo_de_admins.sql); entrar no le da nada más que lo que se le concede, como esta.
create or replace function privado.anotar_correo_de_contacto_del_servidor(p_id_sesion uuid, p_correo text)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select privado.anotar_correo_de_contacto(p_id_sesion, p_correo, now());
$$;
comment on function privado.anotar_correo_de_contacto_del_servidor(uuid, text) is
  'Anota el correo que escribió la sesión con la hora de la base: privado.anotar_correo_de_contacto sin p_ahora. HU-075.';
revoke all on function privado.anotar_correo_de_contacto_del_servidor(uuid, text) from public, anon, authenticated, service_role;
grant execute on function privado.anotar_correo_de_contacto_del_servidor(uuid, text) to service_role;

-- La puerta para el servidor, con los permisos de quien llama: solo la llave secreta (registrarContacto, después de
-- comprobar la sesión). No recibe la hora.
create or replace function public.anotar_correo_de_contacto(p_id_sesion uuid, p_correo text)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  select privado.anotar_correo_de_contacto_del_servidor(p_id_sesion, p_correo);
$$;

comment on function public.anotar_correo_de_contacto(uuid, text) is
  'D-36: anota el correo que escribió la sesión al dejar su contacto y dice si puede seguir (false: ya escribió el tope de correos distintos en la última hora). Solo service_role. HU-075.';

revoke all on function public.anotar_correo_de_contacto(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.anotar_correo_de_contacto(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- La purga de cada hora (supuesto 3)
-- ---------------------------------------------------------------------------
-- Borra los correos anotados que ya salieron de la ventana, de todas las sesiones (anotar solo borra los de la sesión
-- que escribe), con el mismo borde: lo escrito justo en ahora - ventana se borra. Devuelve cuántos borró; correrla dos
-- veces seguidas no borra nada la segunda. Solo la corre pg_cron (como postgres): ninguna sesión ni el servidor la
-- ejecutan. No toma el candado de cada sesión: borra solo lo que salió de la ventana con su propia hora, así que frente
-- a una anotación que corre a la vez, a lo sumo adelanta unos milisegundos el fin de la ventana de una fila.
create or replace function privado.purgar_correos_de_contacto(p_ahora timestamptz)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_borrados integer;
begin
  delete from privado.correo_de_contacto c
  where c.escrito_en <= p_ahora - make_interval(mins => (select p.tope_ventana_min from public.parametros_contacto() p));
  get diagnostics v_borrados = row_count;
  return v_borrados;
end;
$$;

revoke all on function privado.purgar_correos_de_contacto(timestamptz) from public, anon, authenticated, service_role;

-- cron.schedule con el mismo nombre reemplaza el trabajo: reaplicar la migración no lo duplica.
select cron.schedule(
  'calibra-purgar-correos-de-contacto',
  '47 * * * *',
  'select privado.purgar_correos_de_contacto(now())'
);
