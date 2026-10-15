-- Cuenta de Estudiante: el rol nace con el correo confirmado, el correo queda fijo y los envíos tienen tope. HU-032.
--
-- D-55 b (dvarela5101): el correo de un Estudiante queda fijo; si lo necesita cambiar, escribe a soporte. RN-02: el
-- Estudiante es un Lead que creó su cuenta. RN-12: nadie recibe el rol con un correo que no confirmó.
--
-- La cuenta es el mismo usuario de Auth de la sesión anónima (el id no cambia): Auth lo convierte al confirmar el correo
-- y esta migración pone el rol. Hasta entonces mi_rol() sigue en «anonimo», aunque la sesión haya pedido la cuenta con el
-- correo de otra persona.
--
-- Diseño (registro de HU-032):
--   * crear_estudiante recibe solo el id del usuario y lee auth.users (correo, correo confirmado, is_anonymous). Con un
--     p_correo, «confirmado» sería una afirmación de quien llama; así el criterio 12 es una propiedad de la base. Es el
--     único camino de la app para insertar en estudiante. No hay un trigger sobre estudiante que lo exija a toda inserción
--     porque las pruebas pgTAP y Fixtures.crearEstudiante insertan Estudiantes directos sobre usuarios sin correo o con un
--     correo distinto del Lead.
--   * Bloquea la fila del Lead con for update: un cambio de su correo que corra a la vez espera a esta transacción y el
--     trigger lo rechaza; uno que ya terminó se ve aquí como correo_distinto. Sin el bloqueo pasarían los dos.
--   * ya_tiene_cuenta se comprueba antes que correo_distinto: dos usuarios de Auth no comparten correo, así que el segundo
--     usuario de un Lead siempre saldría con un correo distinto.
--   * No escribe lead (RN-09: el estado del Lead no cambia).
--   * Un trigger deja fijo el correo de un Lead con cuenta. Pasar el correo a nulo queda libre (supresión de datos).
--   * Los topes de envío (criterio 13) viven en la base como los de HU-075: 3 pedidos por sesión y 20 en total en una hora
--     móvil. El total se cuenta con un candado por nombre, como el de solicitud_monitor:tope, para que dos sesiones a la vez
--     no pasen el techo. Un intento frenado no se anota. El servidor cuenta todo lo posterior a ahora - ventana, sin techo:
--     now() es el inicio de la transacción, y quien esperó un candado debe ver las filas de quien lo ganó aunque su
--     transacción haya empezado un instante después.
-- No redefine ninguna función existente.
-- Idempotente.

-- ---------------------------------------------------------------------------
-- Crear el Estudiante (servidor)
-- ---------------------------------------------------------------------------
-- Devuelve:
--   creada          el usuario ya es Estudiante (también si lo era antes: repetirla no falla, criterio 14).
--   no_confirmada   no existe el usuario, sigue anónimo, no tiene correo o no lo ha confirmado.
--   sin_lead        la sesión no es de ningún Lead (ni lo creó, ni confirmó su correo, ni es su Estudiante).
--   ya_tiene_cuenta otro usuario ya es el Estudiante de ese Lead.
--   correo_distinto el Lead no tiene correo o es otro que el confirmado en Auth.
-- Nunca lanza por una condición de negocio: tras cualquier resultado distinto de creada, estudiante no cambia.
create or replace function privado.crear_estudiante(p_id_usuario uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_correo text;
  v_anonimo boolean;
  v_confirmado timestamptz;
  v_id_lead uuid;
  v_correo_del_lead text;
  v_restriccion text;
begin
  -- El candado por sesión de registrar_lead, confirmar_correo_de_lead y anotar_correo_de_contacto: dos clics, o crear la
  -- cuenta y editar el contacto a la vez, se atienden uno detrás del otro.
  perform pg_advisory_xact_lock(6801, hashtext(p_id_usuario::text));

  -- Repetirla no falla (criterio 14).
  if exists (select 1 from public.estudiante e where e.id = p_id_usuario) then
    return 'creada';
  end if;

  -- Lo que Auth dice del usuario, no lo que diga quien llama: sin correo confirmado y sin dejar de ser anónimo no hay rol.
  select lower(btrim(u.email)), u.is_anonymous, u.email_confirmed_at
    into v_correo, v_anonimo, v_confirmado
  from auth.users u
  where u.id = p_id_usuario;
  if not found or coalesce(v_anonimo, true) or v_confirmado is null or coalesce(v_correo, '') = '' then
    return 'no_confirmada';
  end if;

  v_id_lead := privado.lead_de_la_sesion(p_id_usuario);
  if v_id_lead is null then
    return 'sin_lead';
  end if;

  -- Con el Lead bloqueado, un cambio de su correo que corra a la vez espera a esta transacción y el trigger lo rechaza; uno
  -- que ya terminó se ve aquí. Sin este bloqueo, los dos pasarían.
  select l.correo into v_correo_del_lead from public.lead l where l.id = v_id_lead for update;
  if not found then
    return 'sin_lead';
  end if;

  if exists (select 1 from public.estudiante e where e.id_lead = v_id_lead) then
    return 'ya_tiene_cuenta';
  end if;
  if v_correo_del_lead is null or v_correo_del_lead <> v_correo then
    return 'correo_distinto';
  end if;

  -- Con el Lead bloqueado la llave única no debería saltar; si salta la de estudiante_id_lead_key es la misma respuesta, y
  -- cualquier otra se propaga. El bloque con excepción es una subtransacción: no se pierde el candado de la sesión.
  begin
    insert into public.estudiante (id, id_lead) values (p_id_usuario, v_id_lead);
  exception when unique_violation then
    get stacked diagnostics v_restriccion = constraint_name;
    if v_restriccion = 'estudiante_id_lead_key' then
      return 'ya_tiene_cuenta';
    end if;
    raise;
  end;
  return 'creada';
end;
$$;

comment on function privado.crear_estudiante(uuid) is
  'Crea el Estudiante del usuario si Auth lo tiene confirmado y no anónimo y su correo es el del Lead de la sesión. Devuelve creada, no_confirmada, sin_lead, ya_tiene_cuenta o correo_distinto; no escribe lead. Interna: el servidor entra por public.crear_estudiante. HU-032.';
revoke all on function privado.crear_estudiante(uuid) from public, anon, authenticated, service_role;
-- service_role ya entra al esquema privado (20261001074954_equipo_de_admins.sql); entrar no le da nada más que lo que se le concede.
grant execute on function privado.crear_estudiante(uuid) to service_role;

-- La puerta para el servidor, con los permisos de quien llama: solo la llave secreta, después de confirmar el correo.
create or replace function public.crear_estudiante(p_id_usuario uuid)
returns text
language sql
volatile
security invoker
set search_path = ''
as $$
  select privado.crear_estudiante(p_id_usuario);
$$;

comment on function public.crear_estudiante(uuid) is
  'Crea el Estudiante de un usuario con el correo confirmado (criterios 4, 10, 12 y 14 de HU-032). Devuelve creada, no_confirmada, sin_lead, ya_tiene_cuenta o correo_distinto. Solo service_role. HU-032.';
revoke all on function public.crear_estudiante(uuid) from public, anon, authenticated, service_role;
grant execute on function public.crear_estudiante(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- El correo de un Lead con cuenta queda fijo (D-55 b)
-- ---------------------------------------------------------------------------
-- Solo cuando el correo cambia a otro valor no nulo: nombre, teléfono y autorización se siguen actualizando, repetir el mismo
-- correo no hace nada y pasarlo a nulo queda libre. Quien llama reconoce el rechazo por el código 23514 y el nombre
-- lead_correo_fijo_con_cuenta en el mensaje, como esPorElCorreo reconoce lead_correo_key.
create or replace function privado.fijar_correo_con_cuenta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.estudiante e where e.id_lead = new.id) then
    raise exception 'lead_correo_fijo_con_cuenta: el correo de un contacto con cuenta no se cambia' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function privado.fijar_correo_con_cuenta() is
  'Trigger de lead: rechaza cambiar el correo de un Lead que ya tiene cuenta de Estudiante (D-55 b). Pasarlo a nulo se permite. HU-032.';
-- Un trigger no necesita execute en tiempo de ejecución (como privado.borrar_sin_contacto).
revoke all on function privado.fijar_correo_con_cuenta() from public, anon, authenticated, service_role;

drop trigger if exists lead_correo_fijo_con_cuenta on public.lead;
create trigger lead_correo_fijo_con_cuenta
  before update of correo on public.lead
  for each row
  when (new.correo is not null and new.correo is distinct from old.correo)
  execute function privado.fijar_correo_con_cuenta();

-- ---------------------------------------------------------------------------
-- Parámetros de los topes (criterio 13)
-- ---------------------------------------------------------------------------
create or replace function public.parametros_cuenta()
returns table (
  tope_envios_sesion integer,
  tope_envios_total integer,
  ventana_min integer
)
language sql
stable
parallel safe
set search_path = ''
as $$
  select
    3,    -- tope_envios_sesion: pedidos de cuenta que una sesión puede hacer en la ventana
    20,   -- tope_envios_total: pedidos de todas las sesiones en la ventana (el límite de correos de Auth se comparte)
    60    -- ventana_min: la ventana de los topes, una hora móvil
$$;

comment on function public.parametros_cuenta() is
  'Topes de los pedidos de cuenta de Estudiante: 3 por sesión y 20 en total en una hora móvil. HU-032.';
revoke all on function public.parametros_cuenta() from public, anon, authenticated, service_role;
grant execute on function public.parametros_cuenta() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Los pedidos de cuenta de cada sesión en la ventana
-- ---------------------------------------------------------------------------
-- Una fila por pedido. No guarda el correo: solo la sesión y la hora.
create table if not exists privado.envio_de_cuenta (
  id bigint generated always as identity primary key,
  id_sesion uuid not null references auth.users (id) on delete cascade,
  enviado_en timestamptz not null default now()
);
-- Lo que recorren el conteo total y la purga de cada hora.
create index if not exists envio_de_cuenta_enviado_en_idx on privado.envio_de_cuenta (enviado_en);
-- El conteo de una sesión.
create index if not exists envio_de_cuenta_sesion_idx on privado.envio_de_cuenta (id_sesion, enviado_en);

comment on table privado.envio_de_cuenta is
  'Pedidos de cuenta de Estudiante de cada sesión, para los topes del criterio 13 de HU-032: guarda la sesión y la hora, no el correo. Se purga pasada la ventana; los de una sesión borrada se van con ella.';

-- Nadie la lee ni la escribe directamente, tampoco el servidor: solo las funciones de abajo.
alter table privado.envio_de_cuenta enable row level security;
revoke all on table privado.envio_de_cuenta from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Anotar un pedido y decir si la sesión puede seguir
-- ---------------------------------------------------------------------------
-- Devuelve ok (se anotó), tope_de_sesion (la sesión ya hizo tope_envios_sesion pedidos en la ventana) o tope_global (todas las
-- sesiones ya hicieron tope_envios_total). Un intento frenado no se anota. Lo anotado justo en ahora - ventana ya no cuenta (el
-- borde de HU-075).
--   * Sin p_ahora (el servidor): ahora es now() y no hay techo, así que cuenta todo lo posterior a ahora - ventana. now() es el
--     inicio de la transacción, no el momento en que gana el candado: con un techo en ahora, quien esperó el candado no vería
--     las filas de quien lo ganó pero empezó un instante después, y la sesión pasaría el tope (6 pedidos a la vez de una sesión
--     dejaban 4 filas con un tope de 3).
--   * Con p_ahora (las pruebas): cuenta lo que cae en (ahora - ventana, ahora]. Con un ahora en el pasado, la prueba no cuenta las
--     filas reales de otras corridas.
-- Una sesión que no existe en auth.users falla con 23503 al anotar.
create or replace function privado.anotar_envio_de_cuenta(p_id_sesion uuid, p_ahora timestamptz default null)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tope_sesion integer;
  v_tope_total integer;
  v_ventana integer;
  v_ahora timestamptz;
  v_desde timestamptz;
  v_techo timestamptz;
begin
  -- El candado por sesión de registrar_lead (HU-068): dos pedidos de la misma sesión se cuentan uno detrás del otro. Sin él,
  -- dos a la vez con 2 anotados verían 2 los dos y quedarían 4.
  perform pg_advisory_xact_lock(6801, hashtext(p_id_sesion::text));

  select p.tope_envios_sesion, p.tope_envios_total, p.ventana_min
    into v_tope_sesion, v_tope_total, v_ventana
  from public.parametros_cuenta() p;
  v_ahora := coalesce(p_ahora, now());
  v_desde := v_ahora - make_interval(mins => v_ventana);
  v_techo := coalesce(p_ahora, 'infinity');

  -- Lo de esta sesión que ya salió de la ventana deja de contar (lo de las demás lo borra el proceso de cada hora).
  delete from privado.envio_de_cuenta e
  where e.id_sesion = p_id_sesion
    and e.enviado_en <= v_desde;

  if (select count(*) from privado.envio_de_cuenta e
      where e.id_sesion = p_id_sesion and e.enviado_en > v_desde and e.enviado_en <= v_techo) >= v_tope_sesion then
    return 'tope_de_sesion';
  end if;

  -- El techo es de todas las sesiones: los pedidos que llegan a esta línea van de a uno, para que dos sesiones a la vez no lo
  -- pasen (el patrón de solicitud_monitor:tope). Orden de candados: la sesión y después este; ninguna función toma el
  -- candado global y después uno de sesión, así que no hay ciclo.
  perform pg_advisory_xact_lock(hashtextextended('envio_de_cuenta:tope', 0));
  if (select count(*) from privado.envio_de_cuenta e
      where e.enviado_en > v_desde and e.enviado_en <= v_techo) >= v_tope_total then
    return 'tope_global';
  end if;

  insert into privado.envio_de_cuenta (id_sesion, enviado_en) values (p_id_sesion, v_ahora);
  return 'ok';
end;
$$;

comment on function privado.anotar_envio_de_cuenta(uuid, timestamptz) is
  'Anota un pedido de cuenta de la sesión y dice si puede seguir: ok, tope_de_sesion o tope_global. Un intento frenado no se anota. Sin p_ahora usa la hora de la base y no pone techo a lo que cuenta; con p_ahora (solo las pruebas) cuenta hasta esa hora. HU-032.';
-- La versión con p_ahora es interna: nadie elige la hora para salirse de la ventana. La usan
-- anotar_envio_de_cuenta_del_servidor, sin p_ahora (la hora de la base), y las pruebas, como postgres.
revoke all on function privado.anotar_envio_de_cuenta(uuid, timestamptz) from public, anon, authenticated, service_role;

-- La que ejecuta el servidor: la misma, con la hora de la base.
create or replace function privado.anotar_envio_de_cuenta_del_servidor(p_id_sesion uuid)
returns text
language sql
volatile
security definer
set search_path = ''
as $$
  select privado.anotar_envio_de_cuenta(p_id_sesion);
$$;

comment on function privado.anotar_envio_de_cuenta_del_servidor(uuid) is
  'Anota el pedido de cuenta de la sesión con la hora de la base: privado.anotar_envio_de_cuenta sin p_ahora. HU-032.';
revoke all on function privado.anotar_envio_de_cuenta_del_servidor(uuid) from public, anon, authenticated, service_role;
grant execute on function privado.anotar_envio_de_cuenta_del_servidor(uuid) to service_role;

-- La puerta para el servidor, con los permisos de quien llama: solo la llave secreta. No recibe la hora.
create or replace function public.anotar_envio_de_cuenta(p_id_sesion uuid)
returns text
language sql
volatile
security invoker
set search_path = ''
as $$
  select privado.anotar_envio_de_cuenta_del_servidor(p_id_sesion);
$$;

comment on function public.anotar_envio_de_cuenta(uuid) is
  'Anota un pedido de cuenta de Estudiante de la sesión y dice si puede seguir: ok, tope_de_sesion (3 por hora) o tope_global (20 por hora). Solo service_role. HU-032.';
revoke all on function public.anotar_envio_de_cuenta(uuid) from public, anon, authenticated, service_role;
grant execute on function public.anotar_envio_de_cuenta(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- La purga de cada hora
-- ---------------------------------------------------------------------------
-- Borra los pedidos que ya salieron de la ventana, de todas las sesiones (anotar solo borra los de la sesión que pide), con el
-- mismo borde: lo anotado justo en ahora - ventana se borra. Devuelve cuántos borró; correrla dos veces seguidas no borra
-- nada la segunda. Solo la corre pg_cron (como postgres): ninguna sesión ni el servidor la ejecutan.
create or replace function privado.purgar_envios_de_cuenta(p_ahora timestamptz)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_borrados integer;
begin
  delete from privado.envio_de_cuenta e
  where e.enviado_en <= p_ahora - make_interval(mins => (select p.ventana_min from public.parametros_cuenta() p));
  get diagnostics v_borrados = row_count;
  return v_borrados;
end;
$$;

comment on function privado.purgar_envios_de_cuenta(timestamptz) is
  'Borra los pedidos de cuenta que ya salieron de la ventana, de todas las sesiones, y devuelve cuántos. La corre pg_cron cada hora. HU-032.';
revoke all on function privado.purgar_envios_de_cuenta(timestamptz) from public, anon, authenticated, service_role;

-- cron.schedule con el mismo nombre reemplaza el trabajo: reaplicar la migración no lo duplica.
select cron.schedule(
  'calibra-purgar-envios-de-cuenta',
  '53 * * * *',
  'select privado.purgar_envios_de_cuenta(now())'
);
