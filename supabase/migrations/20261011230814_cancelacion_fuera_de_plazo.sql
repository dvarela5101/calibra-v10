-- Un admin autoriza una cancelación fuera de plazo, en casos extremos. HU-052.
--
-- RN-60: una individual se cancela hasta 12 h antes de su inicio. Pasado ese plazo el Lead no cancela solo; el caso extremo lo
-- resuelve un admin. D-60 (todas como se recomendaba): (a) tres motivos cerrados (fuerza mayor de quien agendó, una falla de
-- Calibra y otro, con nota obligatoria); (b) se autoriza hasta que empiece la sesión; (c) el monitor recibe el correo de siempre
-- y no cobra; (d) sin tope ni contador por persona. RN-43 y RN-60: lo pagado se devuelve completo. RN-33 y RN-35: la fecha queda
-- libre, pero agendarla otra vez sigue pidiendo 3 h de antelación. RN-64: desde el instante exacto del inicio ya no se autoriza
-- (ahí empieza el reporte de inasistencia). P-40: con 12 h exactas todavía se cancela solo, así que no se autoriza.
--
-- Supuestos (no son D-n; quedan en el registro de la HU):
--   1. No se escribe una segunda cancelación. El cuerpo de privado.cancelar_cita (HU-024) pasa a privado.cancelar_cita_con_permiso:
--      sin admin se comporta igual que hoy; con admin cambia solo el chequeo del plazo, el texto del reembolso y que anota la fila
--      de registro. privado.cancelar_cita(uuid, timestamptz) queda con su firma, como envoltura: las pruebas de HU-024 la nombran
--      y tienen que pasar sin editarse.
--   2. El motivo de la cancelación sigue siendo `estudiante`; la autorización se guarda aparte, en public.cancelacion_excepcional
--      (quién, cuándo, categoría y nota). Así el aviso al monitor, el correo al Lead y P-07 no cambian.
--   3. Cualquier admin activo autoriza, sin turno (RN-60). El reembolso nace al primer admin activo (D-26), no a quien autoriza;
--      sin admin activo nace sin admin (D-28).
--   4. La nota se guarda sin los espacios ni saltos de línea de los bordes (vacía es nula), se cuenta por caracteres y la leen
--      solo los admins: no sale en ningún correo, en la cita del Lead ni en la agenda del monitor. Ninguna función existente la lee.
--   5. `autorizada_en` es la hora que recibe el núcleo (p_ahora): desde las puertas, now() de la base, nunca la del navegador.
--   6. Un reporte de inasistencia ya creado para la monitoría cuenta como «ya empezó»: p_ahora es la hora en que empezó la
--      transacción y no la de cuando toma el candado; una autorización que empezó un instante antes del inicio y espera detrás de
--      un reporte creado en el inicio no puede cancelar una cita que ya tiene un reporte en revisión.
--
-- Esta migración redefine dos piezas de otras HUs partiendo de su última versión en `main`:
--   * privado.cancelar_cita, de 20261002173529_cancelar_cita.sql (HU-024): queda como envoltura del núcleo.
--   * privado.reembolsar_pago_aprobado_tarde, de 20261005134333_resolver_reportes.sql (HU-030): solo cambia el texto del motivo
--     de la rama `estudiante`, que sale de privado.motivo_de_cancelacion_del_estudiante.
-- Si una migración posterior toca alguna de las dos, se parte de esa versión.
--
-- Candados, en el orden de HU-018, HU-020 y HU-029: la monitoría `for update` (la primera de todas las funciones que la tocan),
-- después sus pagos `order by id for update`, y recién entonces los inserts. No se bloquea ningún reporte: la sesión no ha
-- empezado y RN-64 lo impide; sí se mira si ya existe uno, con una lectura que basta porque quien lo crea tiene la monitoría
-- tomada primero. Dos autorizaciones, o una autorización y la cancelación del Lead, quedan en fila: gana una y la otra lee
-- `cancelada`/`estudiante` y responde `ya_cancelada`. Un admin desactivado mientras esperaba el candado se detecta bajo el candado.
--
-- Nadie con sesión escribe la tabla nueva (authenticated solo tiene `select`): lo hace el núcleo `security definer`, que no
-- ejecuta ningún rol. La sesión entra por public.autorizar_cancelacion_fuera_de_plazo, con la identidad del admin (auth.uid()), el
-- patrón de tres capas de HU-030. No manda correos: el aviso al monitor lo anota el trigger de la monitoría, y los del Lead (la
-- cancelación y el pedido de la llave) los anotan privado.cancelar_cita_con_permiso y los triggers de reembolso, como siempre.
--
-- Orden de creación (importa): Postgres valida el cuerpo de una función `language sql` al crearla, así que cada pieza va después
-- de lo que nombra: la tabla, el texto del motivo, el núcleo, la envoltura, el trigger de P-07, la vista y la puerta.
-- Idempotente: db:verificar reaplica cada migración sobre la base final. Al reaplicar las de HU-024 y HU-030 la envoltura y el
-- trigger vuelven un instante a su versión vieja; esta, que es posterior, los restablece.

-- ---------------------------------------------------------------------------
-- La autorización: quién, cuándo, por qué
-- ---------------------------------------------------------------------------
-- Una fila por monitoría cancelada con autorización: la llave primaria es una defensa más contra una segunda autorización
-- (el candado de la monitoría ya las pone en fila). `on delete cascade` en la monitoría, como cancelacion_cita y aviso_monitor:
-- sin él no se podría borrar una monitoría de prueba. `id_admin` sin cascada: a un admin se le desactiva y no se borra (RN-23),
-- y su rastro se conserva.
create table if not exists public.cancelacion_excepcional (
  id_monitoria uuid primary key references public.monitoria (id) on delete cascade,
  id_admin uuid not null references public.admin (id),
  categoria text not null,
  nota text,
  autorizada_en timestamptz not null default now(),
  constraint cancelacion_excepcional_categoria_valida check (categoria in ('fuerza_mayor', 'falla_de_calibra', 'otro')),
  constraint cancelacion_excepcional_nota_con_texto check (
    nota is null or (nota ~ '^[^[:space:]]' and nota ~ '[^[:space:]]$' and char_length(nota) <= 500)
  ),
  constraint cancelacion_excepcional_otro_exige_nota check (categoria <> 'otro' or nota is not null)
);
create index if not exists cancelacion_excepcional_id_admin_idx on public.cancelacion_excepcional (id_admin);

comment on table public.cancelacion_excepcional is
  'Cancelaciones que un admin autorizó fuera del plazo (RN-60, D-60): quién, cuándo, la categoría y la nota. Solo la leen los admins; no sale en ningún correo ni página del Lead o del monitor. La escribe privado.cancelar_cita_con_permiso. HU-052.';
comment on column public.cancelacion_excepcional.categoria is
  'fuerza_mayor, falla_de_calibra u otro (D-60 a). «otro» exige nota.';
comment on column public.cancelacion_excepcional.nota is
  'Texto libre del admin, hasta 500 caracteres, sin espacios ni saltos de línea en los bordes. Puede traer datos personales aunque el formulario pida no escribirlos: solo la leen los admins.';
comment on column public.cancelacion_excepcional.autorizada_en is
  'La hora de la base cuando el admin autorizó (la de p_ahora del núcleo), nunca la del navegador.';

-- Solo los admins la leen; nadie con sesión la escribe. service_role la lee (las pruebas) y tampoco la escribe.
alter table public.cancelacion_excepcional enable row level security;
revoke all on table public.cancelacion_excepcional from public, anon, authenticated, service_role;
grant select on table public.cancelacion_excepcional to authenticated, service_role;

drop policy if exists "admin lee" on public.cancelacion_excepcional;
create policy "admin lee" on public.cancelacion_excepcional
  for select to authenticated
  using ((select privado.es_admin()));

-- ---------------------------------------------------------------------------
-- El texto del motivo del reembolso: un solo lugar (supuesto 2)
-- ---------------------------------------------------------------------------
-- 'Cancelaste la monitoría dentro del plazo.' o, si un admin la autorizó fuera del plazo, 'Cancelaste la monitoría y un admin
-- autorizó hacerlo fuera del plazo.'. La usan el núcleo de la cancelación y el trigger de P-07, así que un pago aprobado antes o
-- después de autorizar dice lo mismo. Ninguno de los dos textos lleva la categoría ni la nota: los lee quien pagó, en el pedido
-- de la llave. Interna: la llaman funciones security definer, ningún rol la ejecuta.
create or replace function privado.motivo_de_cancelacion_del_estudiante(p_id_monitoria uuid)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when exists (select 1 from public.cancelacion_excepcional e where e.id_monitoria = p_id_monitoria)
      then 'Cancelaste la monitoría y un admin autorizó hacerlo fuera del plazo.'
    else 'Cancelaste la monitoría dentro del plazo.'
  end;
$$;

comment on function privado.motivo_de_cancelacion_del_estudiante(uuid) is
  'El motivo del reembolso cuando cancela el estudiante: dentro del plazo o autorizado por un admin fuera de él (D-60). La usan el núcleo de la cancelación y P-07. HU-052.';

revoke all on function privado.motivo_de_cancelacion_del_estudiante(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- El núcleo: cancelar la cita, con o sin la autorización de un admin
-- ---------------------------------------------------------------------------
-- Es el cuerpo de privado.cancelar_cita de HU-024 (20261002173529_cancelar_cita.sql), copiado sin cambios salvo lo que dice HU-052.
-- p_id_admin nulo es el Lead que cancela dentro del plazo (HU-024); con admin es la autorización de HU-052, y entonces
-- p_categoria y p_nota son los de la tabla (la puerta ya los validó; los checks de la tabla son la última defensa).
-- Resultado:
--   cancelada       la monitoría pasó a cancelada (motivo `estudiante`) y la fecha quedó libre. Si había pagos aprobados, cada uno
--                   tiene su reembolso en `esperando_llave` (con el primer admin activo, o sin admin, D-28). Con admin, además,
--                   quedó la fila de cancelacion_excepcional.
--   no_existe       no hay monitoría con ese id.
--   sin_permiso     solo con admin: p_id_admin dejó de ser un admin activo mientras esperaba el candado.
--   no_individual   es una grupal: sus cancelaciones tienen otras reglas y otras HUs.
--   ya_cancelada    ya la había cancelado el estudiante (o ya la autorizó otro admin): un doble clic u otra pestaña.
--   no_cancelable   no está confirmada (por pagar, realizada o cancelada por otro motivo, D-29).
--   fuera_de_plazo  solo sin admin: pasaron las 12 h antes del inicio (RN-60, P-40).
--   dentro_de_plazo solo con admin: todavía hay plazo (con 12 h exactas sigue dentro, P-40): el Lead la cancela solo.
--   ya_empezo       solo con admin: llegó el inicio de la sesión (RN-64: desde el instante exacto ya no se autoriza), o la
--                   monitoría ya tiene un reporte de inasistencia, o falta un dato de la hora (falla cerrado).
-- security definer y sin control de dueño: de quién es la cita y quién autoriza lo deciden las puertas. Nadie la ejecuta.
-- Bloquea la monitoría y, después, sus pagos (el mismo orden que HU-018 y HU-020): una cancelación y una aprobación del pago a la
-- vez no dejan un pago aprobado sin reembolso (si la aprobación llega después, la atiende el trigger de P-07).
create or replace function privado.cancelar_cita_con_permiso(
  p_id_monitoria uuid,
  p_ahora timestamptz,
  p_id_admin uuid,
  p_categoria text,
  p_nota text
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id_lead uuid;
  v_id_franja uuid;
  v_fecha date;
  v_estado public.estado_monitoria;
  v_motivo public.motivo_cancelacion;
  v_hora time;
  v_inicio timestamptz;
  v_admin uuid;
  v_destino text;
  v_nuevos uuid[];
  v_con_pago_en_revision boolean;
  v_a_otro_contacto boolean;
begin
  select m.id_lead, m.id_franja, m.fecha, m.estado, m.motivo_cancelacion
    into v_id_lead, v_id_franja, v_fecha, v_estado, v_motivo
  from public.monitoria m
  where m.id = p_id_monitoria
  for update;
  if not found then
    return 'no_existe';
  end if;

  -- HU-052: bajo el candado se vuelve a mirar que quien autoriza siga siendo un admin activo (lo pudieron desactivar mientras
  -- esperaba, y su token sigue vigente). privado.admin_activo mira banned_until en cada llamada.
  if p_id_admin is not null and not privado.admin_activo(p_id_admin) then
    return 'sin_permiso';
  end if;

  if exists (select 1 from public.monitoria_grupal g where g.id_monitoria = p_id_monitoria) then
    return 'no_individual';
  end if;

  if v_estado = 'cancelada' and v_motivo = 'estudiante' then
    return 'ya_cancelada';
  end if;
  if v_estado <> 'confirmada' then
    return 'no_cancelable';
  end if;

  -- RN-60 y P-40. Las funciones del plazo son estrictas (con un dato nulo devuelven nulo): sin hora de la franja o sin `p_ahora`
  -- no se cancela nada.
  select f.hora into v_hora from public.franja f where f.id = v_id_franja;
  v_inicio := public.inicio_sesion(v_fecha, v_hora);
  if p_id_admin is null then
    -- El Lead, hasta 12 h antes del inicio, con el borde inclusivo. `is not true` falla cerrado.
    if public.dentro_de_plazo(public.cancelable_hasta(v_inicio, false), p_ahora) is not true then
      return 'fuera_de_plazo';
    end if;
  else
    -- HU-052: el admin autoriza solo lo que el Lead ya no puede cancelar (pasadas las 12 h, con el borde inclusivo) y antes de que
    -- empiece la sesión (D-60 b). En el instante exacto del inicio ya no: RN-64 deja reportar desde ahí. `is not false` falla
    -- cerrado: con un dato nulo responde ya_empezo.
    if public.dentro_de_plazo(public.cancelable_hasta(v_inicio, false), p_ahora) is true then
      return 'dentro_de_plazo';
    end if;
    if public.plazo_alcanzado(v_inicio, p_ahora) is not false then
      return 'ya_empezo';
    end if;
    -- Un reporte solo existe si la sesión ya empezó, y p_ahora es la hora en que empezó la transacción, no la de este candado
    -- (supuesto 6): si ya hay un reporte, la sesión empezó.
    if exists (select 1 from public.reporte_inasistencia r where r.id_monitoria = p_id_monitoria) then
      return 'ya_empezo';
    end if;
  end if;

  perform 1 from public.pago p where p.id_monitoria = p_id_monitoria order by p.id for update;

  -- Libera la fecha (el índice de fechas activas excluye las canceladas) y dispara el aviso al monitor de HU-051.
  update public.monitoria
  set estado = 'cancelada', motivo_cancelacion = 'estudiante'
  where id = p_id_monitoria;

  -- HU-052: quién autorizó, cuándo, la categoría y la nota. Va antes de los reembolsos porque el motivo de estos lee esta fila.
  -- Insert plano, sin `on conflict`: la llave primaria es una defensa y, si algo la dispara, la transacción entera se revierte
  -- (nunca queda una cancelación sin registro ni un registro sin cancelación).
  if p_id_admin is not null then
    insert into public.cancelacion_excepcional (id_monitoria, id_admin, categoria, nota, autorizada_en)
    values (p_id_monitoria, p_id_admin, p_categoria, p_nota, p_ahora);
  end if;

  -- RN-43 y D-26: un reembolso por cada pago aprobado, por su monto completo, al primer admin activo (no a quien autoriza). Sin
  -- admin activo el reembolso nace sin admin (D-28). El trigger de `reembolso` crea su solicitud de llave. `on conflict`: si por
  -- algún camino ya tenía reembolso, no se duplica.
  v_admin := privado.siguiente_admin_activo();
  with nuevos as (
    insert into public.reembolso (id_pago, id_admin, monto, motivo)
    select p.id, v_admin, p.monto, privado.motivo_de_cancelacion_del_estudiante(p_id_monitoria)
    from public.pago p
    where p.id_monitoria = p_id_monitoria and p.estado = 'aprobado'
    on conflict on constraint reembolso_id_pago_key do nothing
    returning id
  )
  select coalesce(array_agg(nuevos.id), array[]::uuid[]) into v_nuevos from nuevos;

  -- D-19 y D-27: el correo va al mismo destinatario que la confirmación y pide solo las llaves de los reembolsos cuyo pago
  -- hizo ese mismo correo (sin distinguir mayúsculas ni espacios). Las de otro contacto las pide HU-025.
  v_destino := coalesce(
    (select l.correo from public.lead l where l.id = v_id_lead),
    (select p.contacto from public.pago p where p.id_monitoria = p_id_monitoria order by p.fecha_pago, p.id limit 1)
  );

  update public.solicitud_llave s
  set en_correo_de_cancelacion = true
  from public.reembolso r
  join public.pago p on p.id = r.id_pago
  where s.id_reembolso = r.id
    and r.id = any (v_nuevos)
    and lower(btrim(p.contacto)) = lower(btrim(v_destino));

  v_a_otro_contacto := exists (
    select 1 from public.solicitud_llave s
    where s.id_reembolso = any (v_nuevos) and not s.en_correo_de_cancelacion
  );
  -- P-07: un pago todavía en revisión puede aprobarse después; el correo avisa que entonces se pide la llave.
  v_con_pago_en_revision := exists (
    select 1 from public.pago p where p.id_monitoria = p_id_monitoria and p.estado = 'en_revision'
  );

  insert into public.cancelacion_cita (id_monitoria, correo_destino, con_pago_en_revision, reembolso_a_otro_contacto)
  values (p_id_monitoria, v_destino, v_con_pago_en_revision, v_a_otro_contacto)
  on conflict on constraint cancelacion_cita_id_monitoria_key do nothing;

  -- El pedido a la app nunca tumba la cancelación: si Vault o pg_net fallan (por ejemplo, una dirección mal escrita), la
  -- cancelación queda anotada y pg_cron la vuelve a pedir.
  begin
    perform privado.disparar_cancelaciones_cita();
  exception when others then
    raise warning 'calibra: no se pudo pedir el correo de cancelación de la cita (%): %', sqlstate, sqlerrm;
  end;

  return 'cancelada';
end;
$$;

comment on function privado.cancelar_cita_con_permiso(uuid, timestamptz, uuid, text, text) is
  'El núcleo de la cancelación de una individual confirmada: el Lead dentro del plazo (sin admin, RN-60) o un admin fuera de él, hasta el inicio (con admin, D-60), con reembolso por cada pago aprobado (D-26, D-28) y el correo anotado (D-27). Sin control de dueño: lo hacen las puertas. HU-024 y HU-052.';

revoke all on function privado.cancelar_cita_con_permiso(uuid, timestamptz, uuid, text, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- La envoltura: privado.cancelar_cita conserva su firma (supuesto 1)
-- ---------------------------------------------------------------------------
-- Es la de HU-024: (id, ahora) -> resultado, security definer, search_path vacío y sin ningún grant. Las dos puertas del Lead
-- (cancelar_cita_por_token y cancelar_mi_cita) y las pruebas de HU-024 la siguen llamando igual. Los nombres de los parámetros
-- tienen que ser los mismos: Postgres no deja cambiarlos con `create or replace`.
create or replace function privado.cancelar_cita(p_id_monitoria uuid, p_ahora timestamptz)
returns text
language sql
volatile
security definer
set search_path = ''
as $$
  select privado.cancelar_cita_con_permiso(p_id_monitoria, p_ahora, null, null, null);
$$;

comment on function privado.cancelar_cita(uuid, timestamptz) is
  'Cancela una individual confirmada dentro del plazo (RN-60), con reembolso por cada pago aprobado (D-26, D-28) y el correo anotado (D-27). Sin control de dueño: lo hacen las puertas. Envoltura sin admin de privado.cancelar_cita_con_permiso. HU-024 y HU-052.';

revoke all on function privado.cancelar_cita(uuid, timestamptz) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- P-07: el pago que se aprueba después de cancelar también se reembolsa (con el motivo de la autorización)
-- ---------------------------------------------------------------------------
-- privado.reembolsar_pago_aprobado_tarde de 20261005134333_resolver_reportes.sql (HU-030). Un solo cambio (HU-052): en la rama
-- `estudiante` el motivo del reembolso sale de privado.motivo_de_cancelacion_del_estudiante en vez de la cadena fija, para que un
-- pago aprobado después de autorizar diga lo mismo que los aprobados antes. La rama `monitor_no_asistio` queda tal cual. Todo lo
-- demás igual: el primer admin activo (D-26, sin admin D-28), un reembolso por pago (on conflict do nothing) y nada para las
-- grupales. El trigger pago_reembolsa_cancelacion no cambia.
--
-- Sirve para los dos órdenes entre revisar_pago y la autorización, porque las dos toman la monitoría primero: si autorizar va
-- antes, el pago sigue `en_revision` y su aprobación posterior encuentra la fila de cancelacion_excepcional ya confirmada; si la
-- aprobación va antes, el núcleo ve el pago `aprobado` y lo reembolsa.
create or replace function privado.reembolsar_pago_aprobado_tarde()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_motivo_cancelacion public.motivo_cancelacion;
  v_observaciones text;
begin
  select m.motivo_cancelacion into v_motivo_cancelacion
  from public.monitoria m
  where m.id = new.id_monitoria
    and m.estado = 'cancelada'
    and m.motivo_cancelacion in ('estudiante', 'monitor_no_asistio')
    and not exists (select 1 from public.monitoria_grupal g where g.id_monitoria = m.id);
  if not found then
    return null;
  end if;

  if v_motivo_cancelacion = 'monitor_no_asistio' then
    -- Sin reporte aceptado (una monitoría cancelada a mano) no hay observaciones: queda el texto base.
    select r.observaciones into v_observaciones
    from public.reporte_inasistencia r
    where r.id_monitoria = new.id_monitoria and r.estado = 'aceptado';

    insert into public.reembolso (id_pago, id_admin, monto, motivo)
    values (new.id, privado.siguiente_admin_activo(), new.monto, privado.motivo_de_inasistencia(v_observaciones))
    on conflict on constraint reembolso_id_pago_key do nothing;
  else
    insert into public.reembolso (id_pago, id_admin, monto, motivo)
    values (new.id, privado.siguiente_admin_activo(), new.monto, privado.motivo_de_cancelacion_del_estudiante(new.id_monitoria))
    on conflict on constraint reembolso_id_pago_key do nothing;
  end if;
  return null;
end;
$$;

revoke all on function privado.reembolsar_pago_aprobado_tarde() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- La lista: las citas que ya no se pueden cancelar a tiempo y todavía no empiezan
-- ---------------------------------------------------------------------------
-- Es exactamente la condición con la que el núcleo deja pasar a un admin, con la hora de la base y las mismas dos funciones: lo
-- que la lista muestra y lo que la base autoriza no difieren en el borde (con 12 h exactas la cita no entra y el núcleo responde
-- dentro_de_plazo; con el inicio exacto, tampoco). `privado.es_admin()` hace que un Lead o un monitor, que sí leen sus propias
-- monitorías, reciban cero filas. security_invoker: se lee con los permisos de quien llama. No se concede a service_role: es_admin
-- no tiene `execute` para ese rol y un `select` con la llave secreta fallaría.
create or replace view public.citas_sin_plazo_para_cancelar
with (security_invoker = true)
as
select m.id as id_monitoria, p.inicio, p.cancelable_hasta
from public.monitoria m
join public.monitoria_plazos p on p.id_monitoria = m.id
where (select privado.es_admin())
  and m.estado = 'confirmada'
  and not p.es_grupal
  and public.dentro_de_plazo(p.cancelable_hasta, now()) is false
  and public.plazo_alcanzado(p.inicio, now()) is false;

comment on view public.citas_sin_plazo_para_cancelar is
  'Individuales confirmadas a las que ya se les pasó el plazo de 12 h para cancelar y todavía no empiezan: las que un admin puede autorizar cancelar (D-60). Vacía para quien no es admin. HU-052.';

revoke all on table public.citas_sin_plazo_para_cancelar from public, anon, authenticated, service_role;
grant select on table public.citas_sin_plazo_para_cancelar to authenticated;

-- ---------------------------------------------------------------------------
-- La puerta del admin: autorizar la cancelación (tres capas, como HU-030)
-- ---------------------------------------------------------------------------
-- p_categoria: fuerza_mayor, falla_de_calibra u otro. p_nota: se le quitan los espacios y saltos de línea de los bordes; vacía es
-- ninguna; hasta 500 caracteres; con `otro` es obligatoria. p_ahora nulo se toma como now().
-- Resultado, en el orden en que se mira (quién puede, antes que el texto):
--   autorizada          la monitoría quedó cancelada con el registro de la autorización (ver el núcleo).
--   sin_sesion          no hay sesión.
--   sin_permiso         quien llama no es un admin activo.
--   categoria_invalida  la categoría es nula o no está en la lista.
--   nota_invalida       la nota tiene más de 500 caracteres, o la categoría es `otro` y no hay nota.
--   y los del núcleo tal cual: no_existe, no_individual, ya_cancelada, no_cancelable, dentro_de_plazo, ya_empezo.
-- Ninguno escribe nada salvo `autorizada`. El admin que queda en el registro es siempre auth.uid(): la puerta no recibe un id de
-- admin. La versión con p_ahora queda interna, sin grant (como resolver_reporte_inasistencia y revisar_pago): ninguna sesión
-- elige la hora; la sesión entra por privado.autorizar_cancelacion_fuera_de_plazo_de_la_sesion, con now().
create or replace function privado.autorizar_cancelacion_fuera_de_plazo(
  p_id_monitoria uuid,
  p_categoria text,
  p_nota text,
  p_ahora timestamptz default now()
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_ahora timestamptz := coalesce(p_ahora, now());
  -- [[:space:]] y no btrim, que solo quita espacios: una nota de puros saltos de línea no es texto.
  v_nota text := nullif(regexp_replace(p_nota, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  v_resultado text;
begin
  if v_uid is null then
    return 'sin_sesion';
  end if;
  if not (select privado.es_admin()) then
    return 'sin_permiso';
  end if;

  if p_categoria is null or p_categoria not in ('fuerza_mayor', 'falla_de_calibra', 'otro') then
    return 'categoria_invalida';
  end if;
  -- Cuenta caracteres, no bytes.
  if char_length(v_nota) > 500 or (p_categoria = 'otro' and v_nota is null) then
    return 'nota_invalida';
  end if;

  v_resultado := privado.cancelar_cita_con_permiso(p_id_monitoria, v_ahora, v_uid, p_categoria, v_nota);
  if v_resultado = 'cancelada' then
    return 'autorizada';
  end if;
  return v_resultado;
end;
$$;

comment on function privado.autorizar_cancelacion_fuera_de_plazo(uuid, text, text, timestamptz) is
  'Un admin activo autoriza la cancelación de una individual confirmada fuera del plazo, antes de que empiece (RN-60, D-60): valida el motivo y la nota y llama al núcleo con su identidad. Interna: la sesión entra por public.autorizar_cancelacion_fuera_de_plazo. HU-052.';

-- La versión con p_ahora queda interna: ninguna sesión elige la hora de la autorización.
revoke all on function privado.autorizar_cancelacion_fuera_de_plazo(uuid, text, text, timestamptz) from public, anon, authenticated, service_role;

-- La que ejecuta la sesión del admin: la misma, con la hora de la base.
create or replace function privado.autorizar_cancelacion_fuera_de_plazo_de_la_sesion(p_id_monitoria uuid, p_categoria text, p_nota text)
returns text
language sql
volatile
security definer
set search_path = ''
as $$
  select privado.autorizar_cancelacion_fuera_de_plazo(p_id_monitoria, p_categoria, p_nota, now());
$$;

comment on function privado.autorizar_cancelacion_fuera_de_plazo_de_la_sesion(uuid, text, text) is
  'Autoriza una cancelación fuera de plazo con la sesión del admin y la hora de la base: privado.autorizar_cancelacion_fuera_de_plazo sin p_ahora. HU-052.';

revoke all on function privado.autorizar_cancelacion_fuera_de_plazo_de_la_sesion(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function privado.autorizar_cancelacion_fuera_de_plazo_de_la_sesion(uuid, text, text) to authenticated;

-- La puerta en la Data API, con los permisos de quien llama. Solo con sesión: service_role no tiene auth.uid().
create or replace function public.autorizar_cancelacion_fuera_de_plazo(p_id_monitoria uuid, p_categoria text, p_nota text)
returns text
language sql
volatile
security invoker
set search_path = ''
as $$
  select privado.autorizar_cancelacion_fuera_de_plazo_de_la_sesion(p_id_monitoria, p_categoria, p_nota);
$$;

comment on function public.autorizar_cancelacion_fuera_de_plazo(uuid, text, text) is
  'Un admin activo autoriza cancelar una individual confirmada fuera del plazo, hasta el inicio, con un motivo de la lista y una nota (RN-60, D-60). HU-052.';

revoke all on function public.autorizar_cancelacion_fuera_de_plazo(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.autorizar_cancelacion_fuera_de_plazo(uuid, text, text) to authenticated;
