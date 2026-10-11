-- Materias y evaluaciones editables desde la app. HU-055.
--
-- D-62 (a, b y c) y D-63 c del 10-oct-2026: un admin activo crea materias, corrige el nombre y el código de una materia y el nombre
-- y la semana de una evaluación, y borra una materia o una evaluación que no tenga nada ligado. Lo demás del banco (temas, habilidades,
-- preguntas, qué evaluaciones están activas y si son acumulativas) sigue saliendo del markdown de contenido/ con la carga
-- (scripts/contenido/cargar.mts).
--
-- Lo que hace:
--   * `materia.carpeta`: la carpeta de contenido/ de la que vino la materia, nula si se creó en la app. La carga reconoce la materia por
--     ella y no por el código, así que corregir un código no crea otra materia. Única (los nulos no chocan) y con la forma que valida
--     el convertidor.
--   * `materia.editada_en_app` y `evaluacion.editada_en_app`: un trigger por tabla las sube cuando una sesión de verdad cambia lo que
--     la carga trae del markdown (nombre y código de la materia, nombre y semana de la evaluación). La carga las lee: conserva lo
--     marcado y avisa de la diferencia. Es la marca de D-62 a; no la baja nadie desde la app.
--   * Los mismos triggers recortan y validan, solo para una sesión y solo lo que cambió, lo que la app ya exige antes de escribir
--     (nombre de 1 a 120 caracteres; código en mayúsculas con la forma de un código Uniandes): la base dice lo mismo que la app
--     para quien escriba por la Data API. Recortan lo mismo que `trim()` de JavaScript (tabulador, saltos de línea, espacio de no
--     separación y demás), no solo el espacio: un nombre de solo un tabulador es vacío aquí igual que en la app. Un valor
--     guardado que no cambia no se reescribe ni se vuelve a validar (los fixtures
--     `INT-...`, `E2E-...` y `PRB-...` no tienen forma Uniandes, y `materia.md` no pone tope al nombre).
--   * «Una sesión de verdad» es el rol `authenticated` con usuario, no solo `auth.uid()` no nulo: ocho pruebas pgTAP insertan sus
--     materias de fixture como `postgres` con los claims de un usuario todavía puestos (`reset role` no los limpia). La carga, la
--     semilla, el SQL Editor, la llave secreta (`service_role`) y esos fixtures pasan sin marca ni normalización.
--   * Un índice único sobre `lower(btrim(codigo))`: dos materias no se distinguen por mayúsculas o espacios, que es como
--     `fechas_libres_de_materia` y `agendar_monitoria` comparan el código. `materia_codigo_key` (exacto) se queda: la semilla usa
--     `on conflict (codigo)`.
--   * Permisos de escritura de un admin activo, por columna y con una sola política por tabla y acción: insert y update de
--     `nombre` y `codigo` en materia; update de `nombre` y `semana` en evaluación. Nadie con sesión inserta evaluaciones (las trae el
--     banco) ni borra directo.
--   * Borrar va solo por funciones. `public.ligado_de_materia/_evaluacion` dicen qué tiene ligado (la lista, en un orden fijo) y
--     `public.borrar_materia/_evaluacion` borran solo si no hay nada. Son `security invoker` y llaman a la función de `privado`
--     (`security definer`), como el equipo de admins (HU-054). Toman la fila con `for update` y vuelven a mirar lo ligado con el
--     candado puesto: lo que otra transacción ligó mientras esperaba se ve, y nada se cuela entre la comprobación y el `delete`
--     (un `tema` se iría en cascada sin avisar).
--   * Ligado de una materia: evaluaciones, temas, certificados, solicitudes de monitor, diagnósticos y monitorías (en cualquier
--     estado). Ligado de una evaluación: temas y diagnósticos. `diagnostico_en_curso` no cuenta: su llave a la evaluación es en
--     cascada a propósito (HU-081) y solo existe para una evaluación activa, que siempre tiene temas. Si una HU futura agrega otra
--     llave hacia `materia` o `evaluacion`, la prueba supabase/tests/gestionar_materias.test.sql falla y obliga a decidir si cuenta.
--
-- Idempotente (npm run db:verificar la reaplica sobre la base final, después de `politicas_v10`, que revoca todo sobre estas dos
-- tablas: por eso los permisos se vuelven a dar aquí, en la última de la cadena). Si una base local ya tiene dos códigos que solo
-- difieren en mayúsculas o espacios, el índice único no se crea: se arregla con npm run db:reiniciar.

-- ---------------------------------------------------------------------------
-- Columnas, índices, permisos y políticas
-- ---------------------------------------------------------------------------
alter table public.materia add column if not exists carpeta text;
alter table public.materia add column if not exists editada_en_app boolean not null default false;
alter table public.evaluacion add column if not exists editada_en_app boolean not null default false;

-- La misma forma que valida el convertidor (scripts/contenido/banco.mts).
alter table public.materia drop constraint if exists materia_carpeta_formato;
alter table public.materia add constraint materia_carpeta_formato
  check (carpeta is null or carpeta ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

create unique index if not exists materia_carpeta_key on public.materia (carpeta);
create unique index if not exists materia_codigo_lower_key on public.materia (lower(btrim(codigo)));

comment on column public.materia.carpeta is
  'Carpeta de contenido/ de la que vino la materia, nula si se creó en la app. La carga del banco reconoce la materia por ella. HU-055.';
comment on column public.materia.editada_en_app is
  'Un admin cambió el nombre o el código desde la app: la carga del banco conserva lo de la base y avisa la diferencia (D-62 a). HU-055.';
comment on column public.evaluacion.editada_en_app is
  'Un admin cambió el nombre o la semana desde la app: la carga del banco conserva lo de la base y avisa la diferencia (D-62 a). HU-055.';

grant insert (nombre, codigo) on table public.materia to authenticated;
grant update (nombre, codigo) on table public.materia to authenticated;
grant update (nombre, semana) on table public.evaluacion to authenticated;

drop policy if exists "admin crea materias" on public.materia;
create policy "admin crea materias" on public.materia
  for insert to authenticated
  with check ((select privado.es_admin()));

drop policy if exists "admin edita materias" on public.materia;
create policy "admin edita materias" on public.materia
  for update to authenticated
  using ((select privado.es_admin()))
  with check ((select privado.es_admin()));

drop policy if exists "admin edita evaluaciones" on public.evaluacion;
create policy "admin edita evaluaciones" on public.evaluacion
  for update to authenticated
  using ((select privado.es_admin()))
  with check ((select privado.es_admin()));

-- ---------------------------------------------------------------------------
-- Triggers: la marca y la normalización, solo para una sesión de verdad
-- ---------------------------------------------------------------------------
create or replace function privado.al_escribir_materia()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  -- Lo que `trim()` de JavaScript quita de los bordes (la app recorta así): `btrim` sin esto solo quita el espacio.
  c_blancos constant text := E' \t\n\r\x0b\x0c\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
  v_nombre text := btrim(new.nombre, c_blancos);
  v_codigo text := upper(btrim(new.codigo, c_blancos));
  v_nombre_cambia boolean := true;   -- en un insert, todo es nuevo
  v_codigo_cambia boolean := true;
begin
  -- Solo una sesión de verdad: el rol que la Data API usa para un usuario y con usuario. La carga, la semilla, el SQL Editor, la
  -- llave secreta y los fixtures de pgTAP (rol `postgres`, aunque tengan claims puestos) pasan sin marca ni normalización.
  if current_user <> 'authenticated' or (select auth.uid()) is null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    v_nombre_cambia := v_nombre is distinct from btrim(old.nombre, c_blancos);
    v_codigo_cambia := v_codigo is distinct from upper(btrim(old.codigo, c_blancos));
  end if;

  -- Se valida y se normaliza solo lo que cambió. Lo que no cambió queda tal cual estaba.
  if v_nombre_cambia then
    if v_nombre = '' or char_length(v_nombre) > 120 then
      raise exception 'El nombre va de 1 a 120 caracteres' using errcode = '23514', hint = 'nombre';
    end if;
    new.nombre := v_nombre;
  else
    new.nombre := old.nombre;
  end if;
  if v_codigo_cambia then
    if v_codigo !~ '^[A-Z]{4}-[0-9]{4}$' then
      raise exception 'El código no tiene forma de código Uniandes' using errcode = '23514', hint = 'codigo';
    end if;
    new.codigo := v_codigo;
  else
    new.codigo := old.codigo;
  end if;

  if tg_op = 'INSERT' or v_nombre_cambia or v_codigo_cambia then
    new.editada_en_app := true;
  end if;
  return new;
end;
$$;

revoke all on function privado.al_escribir_materia() from public, anon, authenticated, service_role;

drop trigger if exists materia_al_escribir on public.materia;
create trigger materia_al_escribir
  before insert or update on public.materia
  for each row execute function privado.al_escribir_materia();

create or replace function privado.al_escribir_evaluacion()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  -- El mismo recorte que en la materia: lo que `trim()` de JavaScript quita de los bordes.
  c_blancos constant text := E' \t\n\r\x0b\x0c\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
  v_nombre text := btrim(new.nombre, c_blancos);
  v_nombre_cambia boolean := true;
  v_semana_cambia boolean := true;
begin
  -- La misma guarda que en la materia: solo el rol `authenticated` con usuario.
  if current_user <> 'authenticated' or (select auth.uid()) is null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    v_nombre_cambia := v_nombre is distinct from btrim(old.nombre, c_blancos);
    v_semana_cambia := new.semana is distinct from old.semana;
  end if;

  -- La semana positiva ya la exige `evaluacion_semana_positiva`.
  if v_nombre_cambia then
    if v_nombre = '' or char_length(v_nombre) > 120 then
      raise exception 'El nombre va de 1 a 120 caracteres' using errcode = '23514', hint = 'nombre';
    end if;
    new.nombre := v_nombre;
  else
    new.nombre := old.nombre;
  end if;

  if tg_op = 'INSERT' or v_nombre_cambia or v_semana_cambia then
    new.editada_en_app := true;
  end if;
  return new;
end;
$$;

revoke all on function privado.al_escribir_evaluacion() from public, anon, authenticated, service_role;

drop trigger if exists evaluacion_al_escribir on public.evaluacion;
create trigger evaluacion_al_escribir
  before insert or update on public.evaluacion
  for each row execute function privado.al_escribir_evaluacion();

-- ---------------------------------------------------------------------------
-- Lo ligado y borrar
-- ---------------------------------------------------------------------------
-- Qué tiene ligado una materia, en un orden fijo. Vacío para quien no es admin activo: ni se entera de lo que hay.
create or replace function privado.ligado_de_materia(p_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not (select privado.es_admin()) then '{}'::text[]
    else array_remove(array[
      case when exists (select 1 from public.evaluacion where id_materia = p_id) then 'evaluaciones' end,
      case when exists (select 1 from public.tema where id_materia = p_id) then 'temas' end,
      case when exists (select 1 from public.certificado where id_materia = p_id) then 'certificados' end,
      case when exists (select 1 from public.solicitud_monitor_materia where id_materia = p_id) then 'solicitudes' end,
      case when exists (select 1 from public.diagnostico where id_materia = p_id) then 'diagnosticos' end,
      case when exists (select 1 from public.monitoria where id_materia = p_id) then 'monitorias' end
    ], null)
  end;
$$;

revoke all on function privado.ligado_de_materia(uuid) from public, anon, authenticated, service_role;
grant execute on function privado.ligado_de_materia(uuid) to authenticated;

create or replace function public.ligado_de_materia(p_id uuid)
returns text[]
language sql
stable
security invoker
set search_path = ''
as $$
  select privado.ligado_de_materia(p_id);
$$;

comment on function public.ligado_de_materia(uuid) is
  'Qué tiene ligado una materia (evaluaciones, temas, certificados, solicitudes, diagnosticos, monitorias), en ese orden. Vacío para quien no es admin activo. HU-055.';

revoke all on function public.ligado_de_materia(uuid) from public, anon, authenticated, service_role;
grant execute on function public.ligado_de_materia(uuid) to authenticated;

-- Qué tiene ligado una evaluación: los temas que cubre y los diagnósticos que se tomaron con ella.
create or replace function privado.ligado_de_evaluacion(p_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not (select privado.es_admin()) then '{}'::text[]
    else array_remove(array[
      case when exists (select 1 from public.evaluacion_tema where id_evaluacion = p_id) then 'temas' end,
      case when exists (select 1 from public.diagnostico where id_evaluacion = p_id) then 'diagnosticos' end
    ], null)
  end;
$$;

revoke all on function privado.ligado_de_evaluacion(uuid) from public, anon, authenticated, service_role;
grant execute on function privado.ligado_de_evaluacion(uuid) to authenticated;

create or replace function public.ligado_de_evaluacion(p_id uuid)
returns text[]
language sql
stable
security invoker
set search_path = ''
as $$
  select privado.ligado_de_evaluacion(p_id);
$$;

comment on function public.ligado_de_evaluacion(uuid) is
  'Qué tiene ligado una evaluación (temas, diagnosticos), en ese orden. Vacío para quien no es admin activo. HU-055.';

revoke all on function public.ligado_de_evaluacion(uuid) from public, anon, authenticated, service_role;
grant execute on function public.ligado_de_evaluacion(uuid) to authenticated;

-- Borra una materia sin nada ligado. Resultado: borrada, no_existe, no_autorizado o ligada:<lista separada por comas>.
create or replace function privado.borrar_materia(p_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ligado text[];
begin
  if not (select privado.es_admin()) then
    return 'no_autorizado';
  end if;
  -- El candado espera a quien está ligando algo (su llave toma FOR KEY SHARE sobre esta fila).
  perform 1 from public.materia where id = p_id for update;
  if not found then
    return 'no_existe';
  end if;
  -- Instrucción nueva: ve lo que se confirmó mientras esperaba el candado.
  v_ligado := privado.ligado_de_materia(p_id);
  if cardinality(v_ligado) > 0 then
    return 'ligada:' || array_to_string(v_ligado, ',');
  end if;
  delete from public.materia where id = p_id;
  return 'borrada';
end;
$$;

revoke all on function privado.borrar_materia(uuid) from public, anon, authenticated, service_role;
grant execute on function privado.borrar_materia(uuid) to authenticated;

create or replace function public.borrar_materia(p_id uuid)
returns text
language sql
volatile
security invoker
set search_path = ''
as $$
  select privado.borrar_materia(p_id);
$$;

comment on function public.borrar_materia(uuid) is
  'D-62 c: borra una materia que no tenga nada ligado. Resultado: borrada, no_existe, no_autorizado o ligada:<lista>. Solo un admin activo. HU-055.';

revoke all on function public.borrar_materia(uuid) from public, anon, authenticated, service_role;
grant execute on function public.borrar_materia(uuid) to authenticated;

-- Borra una evaluación sin nada ligado. Mismo resultado que borrar_materia.
create or replace function privado.borrar_evaluacion(p_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ligado text[];
begin
  if not (select privado.es_admin()) then
    return 'no_autorizado';
  end if;
  perform 1 from public.evaluacion where id = p_id for update;
  if not found then
    return 'no_existe';
  end if;
  v_ligado := privado.ligado_de_evaluacion(p_id);
  if cardinality(v_ligado) > 0 then
    return 'ligada:' || array_to_string(v_ligado, ',');
  end if;
  delete from public.evaluacion where id = p_id;
  return 'borrada';
end;
$$;

revoke all on function privado.borrar_evaluacion(uuid) from public, anon, authenticated, service_role;
grant execute on function privado.borrar_evaluacion(uuid) to authenticated;

create or replace function public.borrar_evaluacion(p_id uuid)
returns text
language sql
volatile
security invoker
set search_path = ''
as $$
  select privado.borrar_evaluacion(p_id);
$$;

comment on function public.borrar_evaluacion(uuid) is
  'D-62 c: borra una evaluación que no tenga nada ligado. Resultado: borrada, no_existe, no_autorizado o ligada:<lista>. Solo un admin activo. HU-055.';

revoke all on function public.borrar_evaluacion(uuid) from public, anon, authenticated, service_role;
grant execute on function public.borrar_evaluacion(uuid) to authenticated;
