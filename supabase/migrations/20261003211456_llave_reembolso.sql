-- Quien pagó entrega la llave de su reembolso desde el enlace que le llega. HU-025.
--
-- RN-44 y RN-61, flujo F4. Un reembolso nace en `esperando_llave` (HU-024, P-07 o HU-030) con su token en
-- `solicitud_llave` (HU-024). P-10 (29-sep-2026): quien pagó tiene 7 días para entregar su llave, con un recordatorio a
-- los 3; si vence, el caso se cierra y un admin puede reabrirlo. P-22: el pedido sale por correo. D-27 (2-oct-2026): si el
-- Lead canceló a tiempo, el correo de la cancelación (HU-024) ya pidió las llaves de los pagos hechos con su correo
-- (`solicitud_llave.en_correo_de_cancelacion`); esta HU pide aparte las demás (pago aprobado tarde, otro contacto,
-- inasistencia de HU-030).
--
-- Supuestos del registro de HU-025 (por confirmar con dvarela5101; no son decisiones D-n):
--   1. Los 7 días y el recordatorio a los 3 cuentan desde que se pidió la llave (al crearse el reembolso) o desde que un
--      admin reabre el caso, con el borde de P-40: en el instante exacto todavía se puede entregar.
--   2. El pedido aparte sale solo para los reembolsos cuya llave no pidió el correo de cancelación; el recordatorio va a
--      todos los que siguen esperando.
--   3. La llave es texto libre (celular, correo o alias del banco) de 1 a 200 caracteres, como la del monitor; una vez
--      entregada, el enlace no deja cambiarla.
--   4. Un caso cerrado lo reabre cualquier admin activo: vuelven a correr los 7 días y sale el mismo enlace.
--   5. Reenviar el enlace sin reabrir queda como función de la base para la pantalla de HU-026.
--   6. La página de la cita no cambia por el cierre: HU-029 toca cita_por_token, mi_cita y mis_citas.
--
-- Diseño:
--   * El cierre es una columna, no un valor del enum: `reembolso.cerrado_en` (solo con `esperando_llave`). Así siguen
--     valiendo `reembolso_llave_segun_estado` y los tres valores de `estado_reembolso`. `reembolso.plazo_llave_desde` dice
--     desde cuándo corren los 7 días: nace con el reembolso (los que ya existían toman su `fecha_generacion`) y se
--     reinicia al reabrir. El plazo (7 días) y el recordatorio (3 días) viven en `public.parametros_reembolso()`, y los
--     bordes se deciden solo con `public.dentro_de_plazo` y `public.plazo_alcanzado` (P-40), como el motor de plazos.
--   * La llave guardada tiene de 1 a 200 caracteres una vez normalizados los espacios (como la del monitor). Solo la ven
--     los admins: la política de `reembolso` sigue siendo «admin lee» y ninguna función de esta migración la devuelve
--     (criterio 3).
--   * Los correos salen por una bandeja de salida, `public.pedido_llave`, un correo por fila (la entidad del correo es
--     `pedido_llave.id`):
--       pedido        al crearse el reembolso (trigger de `reembolso`). No mira `en_correo_de_cancelacion`, porque al
--                     insertar todavía vale false (cancelar_cita la marca después, en la misma transacción): la app la lee
--                     al procesar, ya confirmada, y descarta los que pidió el correo de cancelación (supuesto 2).
--       recordatorio  a los 3 días (privado.vencer_pedidos_de_llave, con pg_cron).
--       reapertura    cuando un admin reabre el caso (supuesto 4).
--       reenvio       cuando un admin reenvía el enlace sin reabrir (supuesto 5).
--     `plazo_desde` es la foto del ciclo: el reintento (HU-065) arma el mismo «vence el …» aunque después se reabra, y la
--     app descarta el correo de un ciclo que ya no es el actual. Los tipos pedido, reapertura y reenvio usan la plantilla
--     del pedido; recordatorio, la suya.
--   * Pedirle a la app que procese: una sola vez por sentencia (un trigger de sentencia de `reembolso`, así una
--     cancelación con N pagos hace una petición y no N), al reabrir, al reenviar y al anotar recordatorios, siempre
--     dentro de `begin/exception` (como HU-019 y HU-024: el pedido nunca tumba lo demás). pg_cron lo repite cada 5 minutos
--     por si se perdió (`calibra-pedir-llaves`). La petición la hace privado.disparar_proceso (HU-059), con la dirección y
--     el secreto de Vault que ya usan HU-019 y HU-024: sin ellos no pide nada (así en local y en la nube hasta el corte).
--   * El recordatorio y el cierre son SQL puro: privado.vencer_pedidos_de_llave(p_ahora), cada 15 minutos. El cierre no
--     manda correo. Quien entrega la llave después de los 7 días recibe `cerrado` aunque el trabajo no haya corrido.
--   * Las puertas:
--       public.entregar_llave(token, llave)       la página de la llave (servidor, service_role). Usa now().
--       public.datos_de_llave(token)              lo que muestra esa página (service_role). Nunca la llave ni el contacto.
--       public.datos_de_pedido_llave(id)          lo que necesita el correo (service_role). Nunca la llave.
--       public.reabrir_reembolso(id)              un admin activo reabre un caso cerrado (sesión). Usa now().
--       public.reenviar_pedido_llave(id)          un admin activo reenvía el enlace (sesión). Usa now().
--     Las versiones con p_ahora quedan internas, sin grant (como revisar_pago y ejecutar_desembolso).
--   * Bloqueos: entregar, reabrir y reenviar bloquean solo la fila del reembolso, `for no key update` (el mismo candado
--     que toma un UPDATE que no cambia llaves: no frena a quien inserta en solicitud_llave o pedido_llave). Leen el pago y
--     la monitoría sin candado, así que no forman ciclos con las cadenas monitoría, pago y reembolso de HU-018, HU-020,
--     HU-024 y HU-028. El cierre masivo usa `skip locked`: no espera a quien está entregando la llave. Reabrir puede
--     cambiar el admin del caso (ver abajo), así que antes de leer el reembolso toma compartido el candado del turno
--     (hashtextextended('turno_de_admins', 0), HU-074), el mismo orden que reasignar_casos_de_admin: candado y después
--     filas.
--
-- Se redefinen desde su versión de main (20261002163338_reasignar_pagos.sql, HU-074), y cada una dice qué cambió:
-- privado.reasignar_casos_de_admin y privado.equipo_de_admins. Un caso cerrado deja de ser un caso abierto: no se mueve,
-- no cuenta y no impide desactivar al último admin. Por eso reabrir le da el caso al primer admin activo (D-26) cuando su
-- admin ya no está activo: si no, el caso reabierto quedaría con un admin desactivado y no aparecería en ninguna bandeja.
-- No se tocan privado.reembolsar_pago_aprobado_tarde (la redefine HU-030), privado.asignar_reembolsos_sin_admin (asignar un
-- caso cerrado no estorba) ni las funciones de la cita (supuesto 6).
-- Idempotente.

-- ---------------------------------------------------------------------------
-- Parámetros de P-10
-- ---------------------------------------------------------------------------
-- Aparte de parametros_negocio() (como parametros_contacto de HU-075): cambiar sus columnas exige drop function y una
-- entrada en PREAMBULOS de scripts/verificar-bd.mjs.
create or replace function public.parametros_reembolso()
returns table (
  plazo_llave_min integer,
  recordatorio_llave_min integer
)
language sql
stable
parallel safe
set search_path = ''
as $$
  select
    10080,  -- plazo_llave_min: quien pagó tiene 7 días para entregar su llave (P-10)
    4320    -- recordatorio_llave_min: el recordatorio sale a los 3 días (P-10)
$$;

revoke all on function public.parametros_reembolso() from public, anon, authenticated, service_role;
grant execute on function public.parametros_reembolso() to authenticated, service_role;

-- Los dos instantes, como en el motor de plazos (HU-003): devuelven el límite sin compararlo. Quien compare `ahora`
-- compone public.dentro_de_plazo(public.entrega_de_llave_hasta(...), ahora) o
-- public.plazo_alcanzado(public.recordatorio_de_llave_desde(...), ahora). Nulo entra, nulo sale.
create or replace function public.entrega_de_llave_hasta(p_desde timestamptz)
returns timestamptz
language sql
stable
strict
parallel safe
set search_path = ''
as $$
  select p_desde + make_interval(mins => (select p.plazo_llave_min from public.parametros_reembolso() p));
$$;

create or replace function public.recordatorio_de_llave_desde(p_desde timestamptz)
returns timestamptz
language sql
stable
strict
parallel safe
set search_path = ''
as $$
  select p_desde + make_interval(mins => (select p.recordatorio_llave_min from public.parametros_reembolso() p));
$$;

revoke all on function public.entrega_de_llave_hasta(timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.entrega_de_llave_hasta(timestamptz) to authenticated, service_role;
revoke all on function public.recordatorio_de_llave_desde(timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.recordatorio_de_llave_desde(timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- El reembolso: el plazo, el cierre y la llave
-- ---------------------------------------------------------------------------
-- Los reembolsos que ya existían cuentan el plazo desde que se generaron. Se agrega nula, se llena y después se exige:
-- reaplicada no cambia nada.
alter table public.reembolso add column if not exists plazo_llave_desde timestamptz;
update public.reembolso set plazo_llave_desde = fecha_generacion where plazo_llave_desde is null;
alter table public.reembolso alter column plazo_llave_desde set default now();
alter table public.reembolso alter column plazo_llave_desde set not null;

alter table public.reembolso add column if not exists cerrado_en timestamptz;

comment on column public.reembolso.plazo_llave_desde is
  'Desde cuándo corren los 7 días para entregar la llave (P-10): al generarse el reembolso o al reabrirlo. HU-025.';
comment on column public.reembolso.cerrado_en is
  'Cuándo se cerró el caso porque pasaron los 7 días sin llave (P-10). Nula si sigue abierto o si ya tiene llave. Un admin lo reabre con public.reabrir_reembolso. HU-025.';

-- Solo se cierra lo que espera la llave: un caso cerrado nunca tiene llave (reembolso_llave_segun_estado).
alter table public.reembolso drop constraint if exists reembolso_cerrado_solo_esperando;
alter table public.reembolso add constraint reembolso_cerrado_solo_esperando
  check (cerrado_en is null or estado = 'esperando_llave');

-- Supuesto 3: de 1 a 200 caracteres una vez normalizados los espacios, como monitor_privado.llave.
alter table public.reembolso drop constraint if exists reembolso_llave_con_texto;
alter table public.reembolso add constraint reembolso_llave_con_texto
  check (llave_destino is null
         or char_length(btrim(regexp_replace(llave_destino, '[[:space:]]+', ' ', 'g'))) between 1 and 200);

-- ---------------------------------------------------------------------------
-- Los correos por mandar: la bandeja de salida
-- ---------------------------------------------------------------------------
create table if not exists public.pedido_llave (
  id uuid primary key default gen_random_uuid(),
  id_reembolso uuid not null references public.reembolso (id) on delete cascade,
  -- pedido (al crearse el reembolso), recordatorio (a los 3 días), reapertura (un admin reabrió) o reenvio (un admin
  -- reenvió el enlace).
  tipo text not null,
  -- Foto del ciclo: el plazo_llave_desde del reembolso al anotarlo. El correo dice que vence 7 días después.
  plazo_desde timestamptz not null,
  creada_en timestamptz not null default now(),
  -- La app ya la tomó y dejó el correo en `correo_envio` (enviado, fallido para reintentar o descartado), o la abandonó.
  procesado_en timestamptz,
  -- Corridas en las que no se pudo procesar. La app la abandona a las 5, para que un pedido que siempre falla no tape a
  -- los demás.
  intentos integer not null default 0,
  constraint pedido_llave_tipo_valido check (tipo in ('pedido', 'recordatorio', 'reapertura', 'reenvio')),
  constraint pedido_llave_intentos_no_negativos check (intentos >= 0)
);

comment on table public.pedido_llave is
  'Correos que piden la llave de un reembolso (P-10, P-22): el pedido, el recordatorio a los 3 días, la reapertura y el reenvío. Los anota la base y los manda la app; la entidad del correo es el id. HU-025.';
comment on column public.pedido_llave.plazo_desde is
  'Foto de reembolso.plazo_llave_desde al anotarlo: el ciclo al que pertenece el correo. HU-025.';

-- Un pedido, un recordatorio y una reapertura por ciclo: correr el cierre dos veces o reabrir dos veces en el mismo
-- instante no duplica el correo.
create unique index if not exists pedido_llave_ciclo_key on public.pedido_llave (id_reembolso, tipo, plazo_desde)
  where tipo <> 'reenvio';
-- Un solo reenvío en cola por reembolso: un doble clic no manda dos correos. Ya procesado, se puede reenviar otra vez.
create unique index if not exists pedido_llave_reenvio_en_cola_key on public.pedido_llave (id_reembolso)
  where tipo = 'reenvio' and procesado_en is null;
-- La llave foránea, para el borrado en cascada.
create index if not exists pedido_llave_id_reembolso_idx on public.pedido_llave (id_reembolso);
-- Lo que busca el proceso: los que faltan, del más antiguo al más reciente.
create index if not exists pedido_llave_pendientes_idx on public.pedido_llave (creada_en) where procesado_en is null;

-- Nadie con sesión la lee ni la escribe: las funciones security definer insertan y la app trabaja con la llave secreta,
-- que lee y solo marca `procesado_en` e `intentos`. Sin políticas, RLS niega todo a anon y authenticated.
alter table public.pedido_llave enable row level security;
revoke all on table public.pedido_llave from public, anon, authenticated, service_role;
grant select, update (procesado_en, intentos) on table public.pedido_llave to service_role;

-- ---------------------------------------------------------------------------
-- Pedirle a la app que mande los pedidos
-- ---------------------------------------------------------------------------
-- Solo si hay pedidos sin procesar; privado.disparar_proceso (HU-059) no pide nada sin la configuración de Vault.
-- Devuelve el id de la petición de pg_net, o null si no pidió nada. pg_net la manda solo si la transacción se confirma.
create or replace function privado.disparar_pedidos_llave()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.pedido_llave where procesado_en is null) then
    return null;
  end if;
  return privado.disparar_proceso('/api/procesos/pedir-llaves');
end;
$$;

revoke all on function privado.disparar_pedidos_llave() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- El pedido de cada reembolso nuevo (criterio 1)
-- ---------------------------------------------------------------------------
-- Venga de donde venga el reembolso (HU-024, P-07, HU-030), si nace esperando la llave se anota su pedido con el plazo
-- con que nació. Si su llave ya la pidió el correo de cancelación, la app lo descarta al procesarlo (supuesto 2).
create or replace function privado.anotar_pedido_llave()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.pedido_llave (id_reembolso, tipo, plazo_desde)
  values (new.id, 'pedido', new.plazo_llave_desde)
  on conflict do nothing;
  return null;
end;
$$;

revoke all on function privado.anotar_pedido_llave() from public, anon, authenticated, service_role;

drop trigger if exists reembolso_anota_pedido_llave on public.reembolso;
create trigger reembolso_anota_pedido_llave
  after insert on public.reembolso
  for each row
  when (new.estado = 'esperando_llave')
  execute function privado.anotar_pedido_llave();

-- Una sola petición por sentencia: una cancelación con varios pagos aprobados crea varios reembolsos en un INSERT.
-- Si la sentencia no creó ninguno esperando la llave, no pide nada. El pedido nunca tumba el INSERT: si Vault o pg_net
-- fallan, el pedido queda anotado y pg_cron lo vuelve a pedir.
create or replace function privado.pedir_llaves_a_la_app()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from nuevos where nuevos.estado = 'esperando_llave') then
    begin
      perform privado.disparar_pedidos_llave();
    exception when others then
      raise warning 'calibra: no se pudo pedir el correo de la llave del reembolso (%): %', sqlstate, sqlerrm;
    end;
  end if;
  return null;
end;
$$;

revoke all on function privado.pedir_llaves_a_la_app() from public, anon, authenticated, service_role;

drop trigger if exists reembolso_pide_llaves_a_la_app on public.reembolso;
create trigger reembolso_pide_llaves_a_la_app
  after insert on public.reembolso
  referencing new table as nuevos
  for each statement
  execute function privado.pedir_llaves_a_la_app();

-- ---------------------------------------------------------------------------
-- El recordatorio a los 3 días y el cierre a los 7 (criterios 4 y 5)
-- ---------------------------------------------------------------------------
-- 1. Cierra los que esperan la llave y ya pasaron los 7 días (P-40: con 7 días exactos todavía no), con
--    cerrado_en = p_ahora. `skip locked`: no espera a quien está entregando la llave (si la entrega, ya no está
--    esperando; si no, la próxima corrida lo cierra).
-- 2. Anota el recordatorio de los que siguen abiertos, ya cumplieron 3 días y todavía están en plazo, uno por ciclo. Los
--    recién cerrados ya no cuentan (la misma transacción ve el UPDATE). Va también a los que pidió el correo de
--    cancelación (supuesto 2): es la red si ese correo no salió.
-- 3. Si anotó recordatorios, le pide a la app que los mande.
-- Devuelve cuántos cerró y cuántos recordatorios anotó. Con p_ahora nulo no hace nada. Solo la corre pg_cron, con now().
create or replace function privado.vencer_pedidos_de_llave(p_ahora timestamptz)
returns table (cerrados integer, recordatorios integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.reembolso
  set cerrado_en = p_ahora
  where id in (
    select r.id
    from public.reembolso r
    where r.estado = 'esperando_llave'
      and r.cerrado_en is null
      and not public.dentro_de_plazo(public.entrega_de_llave_hasta(r.plazo_llave_desde), p_ahora)
    order by r.id
    for no key update skip locked
  );
  get diagnostics cerrados = row_count;

  insert into public.pedido_llave (id_reembolso, tipo, plazo_desde)
  select r.id, 'recordatorio', r.plazo_llave_desde
  from public.reembolso r
  where r.estado = 'esperando_llave'
    and r.cerrado_en is null
    and public.plazo_alcanzado(public.recordatorio_de_llave_desde(r.plazo_llave_desde), p_ahora)
    and public.dentro_de_plazo(public.entrega_de_llave_hasta(r.plazo_llave_desde), p_ahora)
  order by r.id
  on conflict do nothing;
  get diagnostics recordatorios = row_count;

  if recordatorios > 0 then
    begin
      perform privado.disparar_pedidos_llave();
    exception when others then
      raise warning 'calibra: no se pudo pedir el recordatorio de la llave (%): %', sqlstate, sqlerrm;
    end;
  end if;
  return next;
end;
$$;

comment on function privado.vencer_pedidos_de_llave(timestamptz) is
  'P-10: cierra los reembolsos que pasaron 7 días sin llave y anota el recordatorio de los que cumplieron 3. La corre pg_cron cada 15 minutos. HU-025.';

revoke all on function privado.vencer_pedidos_de_llave(timestamptz) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Entregar la llave (criterio 2)
-- ---------------------------------------------------------------------------
-- Resultado:
--   entregada        se guardó la llave (normalizada) y el reembolso pasó a pendiente, en el mismo UPDATE.
--   llave_invalida   vacía o de más de 200 caracteres una vez normalizados los espacios (supuesto 3).
--   cerrado          el caso se cerró, o ya pasaron los 7 días aunque el cierre todavía no haya corrido (P-40: con 7 días
--                    exactos todavía se entrega). Sin p_ahora, también: falla cerrado.
--   ya_entregada     ya tiene llave (pendiente o reembolsado): el enlace no deja cambiarla (supuesto 3).
--   no_existe        el token no es de ningún reembolso.
-- Nunca devuelve la llave. Bloquea solo la fila del reembolso: dos envíos a la vez quedan en fila y el segundo ve lo
-- que dejó el primero; el cierre de pg_cron la salta mientras tanto.
create or replace function privado.entregar_llave(p_token text, p_llave text, p_ahora timestamptz)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- Como la llave del monitor (HU-013): los espacios seguidos cuentan como uno y no hay espacios en los bordes.
  v_llave text := btrim(regexp_replace(p_llave, '[[:space:]]+', ' ', 'g'));
  v_id uuid;
  v_estado public.estado_reembolso;
  v_cerrado_en timestamptz;
  v_desde timestamptz;
begin
  select r.id, r.estado, r.cerrado_en, r.plazo_llave_desde
    into v_id, v_estado, v_cerrado_en, v_desde
  from public.solicitud_llave s
  join public.reembolso r on r.id = s.id_reembolso
  where s.token = p_token
  for no key update of r;
  if not found then
    return 'no_existe';
  end if;

  if v_estado <> 'esperando_llave' then
    return 'ya_entregada';
  end if;
  if v_cerrado_en is not null
     or public.dentro_de_plazo(public.entrega_de_llave_hasta(v_desde), p_ahora) is not true then
    return 'cerrado';
  end if;
  if v_llave is null or char_length(v_llave) not between 1 and 200 then
    return 'llave_invalida';
  end if;

  update public.reembolso
  set llave_destino = v_llave, estado = 'pendiente'
  where id = v_id;
  return 'entregada';
end;
$$;

comment on function privado.entregar_llave(text, text, timestamptz) is
  'Guarda la llave que entrega quien pagó, con el token de su enlace, y pasa el reembolso a pendiente (P-10, supuesto 3). Interna: el servidor entra por public.entregar_llave. HU-025.';

-- La versión con p_ahora queda interna: nadie elige la hora ni mueve el borde de los 7 días.
revoke all on function privado.entregar_llave(text, text, timestamptz) from public, anon, authenticated, service_role;

-- La que usa el servidor: la misma, con la hora de la base (como anotar_correo_de_contacto_del_servidor de HU-075).
create or replace function privado.entregar_llave_del_servidor(p_token text, p_llave text)
returns text
language sql
volatile
security definer
set search_path = ''
as $$
  select privado.entregar_llave(p_token, p_llave, now());
$$;

revoke all on function privado.entregar_llave_del_servidor(text, text) from public, anon, authenticated, service_role;
grant execute on function privado.entregar_llave_del_servidor(text, text) to service_role;

-- La puerta en la Data API, con los permisos de quien llama: solo la llave secreta (service_role), que ya comprobó la
-- forma del token. Sin ella, adivinar tokens sería cosa de cualquiera.
create or replace function public.entregar_llave(p_token text, p_llave text)
returns text
language sql
volatile
security invoker
set search_path = ''
as $$
  select privado.entregar_llave_del_servidor(p_token, p_llave);
$$;

comment on function public.entregar_llave(text, text) is
  'Quien pagó entrega la llave de su reembolso con el enlace del correo (criterio 2). Solo para el servidor (service_role). HU-025.';

revoke all on function public.entregar_llave(text, text) from public, anon, authenticated, service_role;
grant execute on function public.entregar_llave(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Lo que muestra la página de la llave
-- ---------------------------------------------------------------------------
-- Con los permisos de quien llama: solo la llave secreta (service_role). Sin filas si el token no es de ningún reembolso.
-- `estado` es el de la página: esperando_llave (el formulario), pendiente (ya la recibimos), reembolsado o cerrado (el
-- caso se cerró o ya pasaron los 7 días, con la misma regla que privado.entregar_llave). `vence_en` es el fin de los 7
-- días del ciclo actual. Nunca la llave ni el contacto (criterio 3).
create or replace function public.datos_de_llave(p_token text)
returns table (
  estado text,
  monto integer,
  motivo text,
  vence_en timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    case
      when r.estado = 'esperando_llave'
       and (r.cerrado_en is not null
            or public.dentro_de_plazo(public.entrega_de_llave_hasta(r.plazo_llave_desde), now()) is not true)
      then 'cerrado'
      else r.estado::text
    end,
    r.monto,
    r.motivo,
    public.entrega_de_llave_hasta(r.plazo_llave_desde)
  from public.solicitud_llave s
  join public.reembolso r on r.id = s.id_reembolso
  where s.token = p_token;
$$;

comment on function public.datos_de_llave(text) is
  'Lo que muestra la página de la llave de un reembolso: estado para la vista, monto, motivo y vencimiento. Nunca la llave ni el contacto. Solo para el servidor (service_role). HU-025.';

revoke all on function public.datos_de_llave(text) from public, anon, authenticated, service_role;
grant execute on function public.datos_de_llave(text) to service_role;

-- ---------------------------------------------------------------------------
-- Lo que la app necesita para escribir el correo
-- ---------------------------------------------------------------------------
-- Con los permisos de quien llama: solo la llave secreta (service_role). Sin filas si el pedido no existe. Trae lo que
-- la app necesita para decidir si el correo sigue valiendo antes de mandar nada: el estado y el cierre del reembolso, el
-- ciclo del pedido (`plazo_desde`) frente al actual (`plazo_llave_desde`) y si el correo de cancelación ya pidió esa
-- llave. Para el texto: el nombre de quien pagó, el monto, el motivo, el vencimiento del ciclo del pedido (`vence_en`,
-- una foto: el reintento dice lo mismo), el token del enlace y el motivo de la cancelación de la monitoría (el pedido de
-- una inasistencia, D-37). El destinatario es el contacto del pago, que registrar_pago exige que sea un correo. Nunca la
-- llave.
create or replace function public.datos_de_pedido_llave(p_id uuid)
returns table (
  tipo text,
  plazo_desde timestamptz,
  vence_en timestamptz,
  plazo_llave_desde timestamptz,
  estado public.estado_reembolso,
  cerrado_en timestamptz,
  en_correo_de_cancelacion boolean,
  contacto text,
  nombre_pagador text,
  monto integer,
  motivo text,
  token text,
  motivo_cancelacion public.motivo_cancelacion
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    pl.tipo,
    pl.plazo_desde,
    public.entrega_de_llave_hasta(pl.plazo_desde),
    r.plazo_llave_desde,
    r.estado,
    r.cerrado_en,
    s.en_correo_de_cancelacion,
    p.contacto,
    p.nombre_pagador,
    r.monto,
    r.motivo,
    s.token,
    m.motivo_cancelacion
  from public.pedido_llave pl
  join public.reembolso r on r.id = pl.id_reembolso
  join public.solicitud_llave s on s.id_reembolso = r.id
  join public.pago p on p.id = r.id_pago
  join public.monitoria m on m.id = p.id_monitoria
  where pl.id = p_id;
$$;

comment on function public.datos_de_pedido_llave(uuid) is
  'Datos del correo que pide la llave de un reembolso (pedido, recordatorio, reapertura o reenvío). Nunca la llave. Solo para el servidor (service_role). HU-025.';

revoke all on function public.datos_de_pedido_llave(uuid) from public, anon, authenticated, service_role;
grant execute on function public.datos_de_pedido_llave(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Reabrir un caso cerrado (criterio 5, supuesto 4)
-- ---------------------------------------------------------------------------
-- Resultado:
--   reabierto     el caso volvió a esperar la llave: cerrado_en nulo, los 7 días (y el recordatorio) vuelven a contar
--                 desde p_ahora y sale un pedido de tipo reapertura con el mismo enlace (el token no cambia). Si su admin
--                 ya no está activo (o no tenía), pasa al primer admin activo (D-26).
--   no_cerrado    el caso no está cerrado: espera la llave dentro del plazo, o ya la tiene. Un caso que pasó los 7 días
--                 sin que el cierre haya corrido cuenta como cerrado, como en la página.
--   no_encontrado el reembolso no existe.
--   sin_permiso   quien llama no es un admin activo.
--   sin_sesion    no hay sesión.
create or replace function privado.reabrir_reembolso(p_id_reembolso uuid, p_ahora timestamptz)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_estado public.estado_reembolso;
  v_cerrado_en timestamptz;
  v_desde timestamptz;
  v_id_admin uuid;
begin
  if v_uid is null then
    return 'sin_sesion';
  end if;
  if not (select privado.es_admin()) then
    return 'sin_permiso';
  end if;

  -- Reabrir puede elegir admin: el candado del turno, compartido, antes de bloquear la fila (el orden de
  -- reasignar_casos_de_admin, que lo toma exclusivo y después mueve reembolsos). La clave es la de HU-074.
  perform pg_advisory_xact_lock_shared(hashtextextended('turno_de_admins', 0));

  select r.estado, r.cerrado_en, r.plazo_llave_desde, r.id_admin
    into v_estado, v_cerrado_en, v_desde, v_id_admin
  from public.reembolso r
  where r.id = p_id_reembolso
  for no key update;
  if not found then
    return 'no_encontrado';
  end if;

  if v_estado <> 'esperando_llave'
     or (v_cerrado_en is null and public.dentro_de_plazo(public.entrega_de_llave_hasta(v_desde), p_ahora) is true) then
    return 'no_cerrado';
  end if;

  update public.reembolso
  set cerrado_en = null,
      plazo_llave_desde = p_ahora,
      id_admin = case
        when v_id_admin is not null and privado.admin_activo(v_id_admin) then v_id_admin
        else privado.siguiente_admin_activo()
      end
  where id = p_id_reembolso;

  insert into public.pedido_llave (id_reembolso, tipo, plazo_desde)
  values (p_id_reembolso, 'reapertura', p_ahora)
  on conflict do nothing;

  begin
    perform privado.disparar_pedidos_llave();
  exception when others then
    raise warning 'calibra: no se pudo pedir el correo de la llave al reabrir (%): %', sqlstate, sqlerrm;
  end;
  return 'reabierto';
end;
$$;

-- La versión con p_ahora queda interna: ninguna sesión elige desde cuándo corren los 7 días.
revoke all on function privado.reabrir_reembolso(uuid, timestamptz) from public, anon, authenticated, service_role;

-- La que ejecuta la sesión del admin: la misma, con la hora de la base.
create or replace function privado.reabrir_reembolso_de_la_sesion(p_id_reembolso uuid)
returns text
language sql
volatile
security definer
set search_path = ''
as $$
  select privado.reabrir_reembolso(p_id_reembolso, now());
$$;

comment on function privado.reabrir_reembolso_de_la_sesion(uuid) is
  'Reabre un caso cerrado con la sesión del admin y la hora de la base: privado.reabrir_reembolso sin p_ahora. HU-025.';

revoke all on function privado.reabrir_reembolso_de_la_sesion(uuid) from public, anon, authenticated, service_role;
grant execute on function privado.reabrir_reembolso_de_la_sesion(uuid) to authenticated;

-- La puerta en la Data API, con los permisos de quien llama. Solo con sesión: service_role no tiene auth.uid().
create or replace function public.reabrir_reembolso(p_id_reembolso uuid)
returns text
language sql
volatile
security invoker
set search_path = ''
as $$
  select privado.reabrir_reembolso_de_la_sesion(p_id_reembolso);
$$;

comment on function public.reabrir_reembolso(uuid) is
  'Un admin activo reabre un reembolso cerrado sin llave (P-10): vuelven a correr los 7 días y sale el mismo enlace. HU-025.';

revoke all on function public.reabrir_reembolso(uuid) from public, anon, authenticated, service_role;
grant execute on function public.reabrir_reembolso(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Reenviar el enlace sin reabrir (supuesto 5, para la pantalla de HU-026)
-- ---------------------------------------------------------------------------
-- Resultado:
--   reenviado     hay un pedido de tipo reenvio en cola, con el ciclo actual (el plazo no cambia). Si ya había uno sin
--                 procesar (un doble clic), no se anota otro: sale un solo correo.
--   cerrado       el caso se cerró o pasó los 7 días: hay que reabrirlo.
--   ya_entregada  ya tiene llave.
--   no_encontrado el reembolso no existe.
--   sin_permiso   quien llama no es un admin activo.
--   sin_sesion    no hay sesión.
create or replace function privado.reenviar_pedido_llave(p_id_reembolso uuid, p_ahora timestamptz)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_estado public.estado_reembolso;
  v_cerrado_en timestamptz;
  v_desde timestamptz;
begin
  if v_uid is null then
    return 'sin_sesion';
  end if;
  if not (select privado.es_admin()) then
    return 'sin_permiso';
  end if;

  select r.estado, r.cerrado_en, r.plazo_llave_desde
    into v_estado, v_cerrado_en, v_desde
  from public.reembolso r
  where r.id = p_id_reembolso
  for no key update;
  if not found then
    return 'no_encontrado';
  end if;

  if v_estado <> 'esperando_llave' then
    return 'ya_entregada';
  end if;
  if v_cerrado_en is not null
     or public.dentro_de_plazo(public.entrega_de_llave_hasta(v_desde), p_ahora) is not true then
    return 'cerrado';
  end if;

  insert into public.pedido_llave (id_reembolso, tipo, plazo_desde)
  values (p_id_reembolso, 'reenvio', v_desde)
  on conflict do nothing;

  begin
    perform privado.disparar_pedidos_llave();
  exception when others then
    raise warning 'calibra: no se pudo pedir el correo de la llave al reenviar (%): %', sqlstate, sqlerrm;
  end;
  return 'reenviado';
end;
$$;

revoke all on function privado.reenviar_pedido_llave(uuid, timestamptz) from public, anon, authenticated, service_role;

create or replace function privado.reenviar_pedido_llave_de_la_sesion(p_id_reembolso uuid)
returns text
language sql
volatile
security definer
set search_path = ''
as $$
  select privado.reenviar_pedido_llave(p_id_reembolso, now());
$$;

comment on function privado.reenviar_pedido_llave_de_la_sesion(uuid) is
  'Reenvía el enlace de la llave con la sesión del admin y la hora de la base: privado.reenviar_pedido_llave sin p_ahora. HU-025.';

revoke all on function privado.reenviar_pedido_llave_de_la_sesion(uuid) from public, anon, authenticated, service_role;
grant execute on function privado.reenviar_pedido_llave_de_la_sesion(uuid) to authenticated;

create or replace function public.reenviar_pedido_llave(p_id_reembolso uuid)
returns text
language sql
volatile
security invoker
set search_path = ''
as $$
  select privado.reenviar_pedido_llave_de_la_sesion(p_id_reembolso);
$$;

comment on function public.reenviar_pedido_llave(uuid) is
  'Un admin activo vuelve a mandar el enlace para entregar la llave de un reembolso que la espera, sin reabrir ni cambiar el plazo. HU-025.';

revoke all on function public.reenviar_pedido_llave(uuid) from public, anon, authenticated, service_role;
grant execute on function public.reenviar_pedido_llave(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Un caso cerrado no es un caso abierto: reasignar al desactivar (P-44)
-- ---------------------------------------------------------------------------
-- privado.reasignar_casos_de_admin de 20261002163338_reasignar_pagos.sql (HU-074). Un cambio: los reembolsos cerrados
-- (P-10, cerrado_en) ya no son casos abiertos. No cuentan para saber si hay algo que mover, no se mueven (se quedan con
-- el admin que se desactiva, como lo ya cerrado de RN-23) y no hacen fallar con sin_otro_admin. Si alguien reabre uno,
-- privado.reabrir_reembolso se lo da al primer admin activo. La firma, el candado del turno, los pagos y los reportes, el
-- total que devuelve y los permisos no cambian; public.reasignar_casos_de_admin, que la llama, tampoco.
create or replace function privado.reasignar_casos_de_admin(p_id_admin uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_destino uuid;
  v_reembolsos integer;
  v_reportes integer;
  v_pagos integer;
begin
  -- Criterio 3: antes de mirar nada. Espera a que confirmen los pagos que ya eligieron admin, así que el exists y el
  -- UPDATE de abajo los ven; mientras dura, registrar_pago no elige. La clave tiene que ser exactamente la misma que
  -- usa privado.registrar_pago.
  perform pg_advisory_xact_lock(hashtextextended('turno_de_admins', 0));

  if not exists (
    select 1 from public.reembolso
    where id_admin = p_id_admin and estado in ('esperando_llave', 'pendiente') and cerrado_en is null
    union all
    select 1 from public.reporte_inasistencia where id_admin = p_id_admin and estado = 'en_revision'
    union all
    select 1 from public.pago where id_admin = p_id_admin and estado = 'en_revision'
  ) then
    return 0;
  end if;

  v_destino := privado.siguiente_admin_activo(p_id_admin);
  if v_destino is null then
    raise exception 'No hay otro admin activo que reciba los casos abiertos.' using errcode = 'P0001', hint = 'sin_otro_admin';
  end if;

  -- HU-025: los cerrados sin llave se quedan.
  update public.reembolso set id_admin = v_destino
  where id_admin = p_id_admin and estado in ('esperando_llave', 'pendiente') and cerrado_en is null;
  get diagnostics v_reembolsos = row_count;

  update public.reporte_inasistencia set id_admin = v_destino
  where id_admin = p_id_admin and estado = 'en_revision';
  get diagnostics v_reportes = row_count;

  -- RN-42: quien lo recibe empieza una hora nueva. fecha_pago (cuándo llegó el comprobante) no cambia, y los pagos
  -- aprobados o rechazados se quedan con este admin (RN-23).
  update public.pago set id_admin = v_destino, fecha_asignacion = now()
  where id_admin = p_id_admin and estado = 'en_revision';
  get diagnostics v_pagos = row_count;

  return v_reembolsos + v_reportes + v_pagos;
end;
$$;

revoke all on function privado.reasignar_casos_de_admin(uuid) from public, anon, authenticated, service_role;
grant execute on function privado.reasignar_casos_de_admin(uuid) to service_role;

comment on function public.reasignar_casos_de_admin(uuid) is
  'P-44: pasa los casos abiertos de un admin (reembolsos sin cerrar, reportes y pagos en revisión) al siguiente activo. Solo service_role, antes y después de banearlo. HU-054, HU-074, HU-025.';

-- ---------------------------------------------------------------------------
-- La pantalla del equipo: los casos cerrados no cuentan
-- ---------------------------------------------------------------------------
-- privado.equipo_de_admins de 20261002163338_reasignar_pagos.sql (HU-074). Un cambio: casos_abiertos ya no cuenta los
-- reembolsos cerrados (P-10), los mismos que reasignar_casos_de_admin deja de mover. Las columnas, el filtro (solo un
-- admin activo) y los permisos no cambian; public.equipo_de_admins, que la llama, tampoco.
create or replace function privado.equipo_de_admins()
returns table (id uuid, nombre text, correo text, orden_revision integer, activo boolean, casos_abiertos integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    a.id,
    a.nombre,
    a.correo,
    a.orden_revision,
    privado.admin_activo(a.id),
    (
      (select count(*) from public.reembolso r
       where r.id_admin = a.id and r.estado in ('esperando_llave', 'pendiente') and r.cerrado_en is null)
      + (select count(*) from public.reporte_inasistencia ri where ri.id_admin = a.id and ri.estado = 'en_revision')
      + (select count(*) from public.pago p where p.id_admin = a.id and p.estado = 'en_revision')
    )::integer
  from public.admin a
  where (select privado.es_admin())
  order by a.orden_revision;
$$;

revoke all on function privado.equipo_de_admins() from public, anon, authenticated, service_role;
grant execute on function privado.equipo_de_admins() to authenticated;

-- ---------------------------------------------------------------------------
-- Los trabajos de pg_cron
-- ---------------------------------------------------------------------------
-- cron.schedule con el mismo nombre reemplaza el trabajo: reaplicar la migración no lo duplica.
select cron.schedule('calibra-pedir-llaves', '*/5 * * * *', 'select privado.disparar_pedidos_llave()');
select cron.schedule('calibra-vencer-llaves', '*/15 * * * *', 'select privado.vencer_pedidos_de_llave(now())');
