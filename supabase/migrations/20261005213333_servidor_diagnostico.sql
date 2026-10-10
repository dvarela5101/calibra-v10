-- Servidor del diagnóstico: diagnóstico en curso, guardado y lo que lee cada sesión. HU-081.
--
-- RN-10, RN-14 y RN-15; P-33 y P-35; D-7; D-13 y D-14 del banco (30-sep-2026: una evaluación activa y la opción correcta, la
-- misconcepción y el error solo los ve el servidor); D-49 (4-oct-2026: al recargar sigue la pregunta pendiente mientras no pasen
-- 2 horas sin responder; el resultado muestra el detalle de lo que eligió; las marcas de falta de material se guardan con el
-- diagnóstico) y D-51 (sin preguntas nuevas no se crea nada; volver a tomarlo repite sin excluir las vistas y queda marcado).
-- HU-060 hizo el motor puro; esta migración le pone debajo lo transaccional. Diseño: docs/diseno/2026-09-29-banco-por-habilidades.md
-- («Qué guarda el diagnóstico»).
--
-- Lo que hace:
--   * `diagnostico_en_curso`: una fila por sesión, cerrada a la Data API (RLS sin políticas y grants solo para service_role, como
--     el banco). Guarda la foto del banco al empezar (las candidatas completas y el contexto), la semilla, las vistas antes y las
--     copias de los pasos ya respondidos. Es otra tabla y no `diagnostico` a propósito: `diagnostico` exige `respuestas`, `puntaje`
--     y el resultado, agendar liga el más reciente de la materia sin mirar si terminó y el dueño y el monitor lo leen.
--   * `diagnostico`: `resultado_por_tema` pasa a `resultado_por_habilidad`; suma `semilla`, `repetido`, `respondidas` (generada),
--     `aciertos` y `falta_material`, con sus checks, y `respuestas` sale del grant por columnas de `authenticated`. Nadie con
--     sesión lee las copias, la semilla, el repetido, los aciertos, la marca de falta de material ni el token de recuperación.
--   * Seis funciones para service_role, que es lo que alcanza supabase-js: `banco_de_la_evaluacion`, `vistas_de_la_sesion`,
--     `diagnostico_en_curso_de`, `iniciar_diagnostico`, `responder_diagnostico` y `terminar_diagnostico`. Las tres últimas y la
--     lectura vigente dependen de la hora o escriben, así que tienen tres capas (como HU-075): el núcleo privado con `p_ahora` y sin
--     grant (nadie elige la hora), la que ejecuta el servidor con now() y la puerta pública con los permisos de quien llama.
--   * Una purga de los en curso vencidos, con pg_cron.
--
-- No redefine ninguna función de otra HU. Sí cambia dos cosas de otras:
--   * el grant por columnas de `diagnostico` de 20261001040929_agendar_monitoria.sql (HU-017): parte de su lista, cambia
--     `resultado_por_tema` por `resultado_por_habilidad` y quita `respuestas`;
--   * el nombre de la columna `resultado_por_tema` de 20260929022931_esquema_v10.sql (HU-002). Como `npm run db:verificar` reaplica
--     cada migración sobre la base final, scripts/verificar-bd.mjs devuelve el nombre antiguo antes de reaplicar HU-017 (PREAMBULOS)
--     y esta migración, que es posterior, lo renombra otra vez y deja el grant final.
-- `privado.es_mi_lead` (HU-068, la usan las políticas de lectura de `lead`, `monitoria` y `diagnostico`) no se toca: se agrega
-- `privado.leads_de_la_sesion`, los Leads de una sesión por las mismas vías pero con la sesión como parámetro y en un solo arreglo,
-- y una prueba pgTAP compara las dos por cada vía. `vistas_de_la_sesion` resuelve ese arreglo una vez y filtra `diagnostico` con
-- `id_sesion_anonima = sesión or id_lead = any(arreglo)`, que usa los índices de las dos columnas; llamar una función por cada
-- diagnóstico de la materia haría crecer el costo con los diagnósticos de todos y no con los de la persona.
--
-- Supuestos del registro de HU-081 (por confirmar con dvarela5101; no son decisiones D-n):
--   * El en curso guarda la foto completa de las candidatas y el contexto, no solo las claves: un banco recargado a mitad (HU-061)
--     no cambia la pregunta pendiente ni la que la persona vio.
--   * El `id` del en curso es el `id` que tendrá el `diagnostico` al terminar: así el último paso es idempotente y la pestaña que
--     llega tarde recibe `terminado` y no `ninguno`.
--   * El en curso vence a las 2 horas de su última respuesta (o de su inicio). Recargar, leer e iniciar la misma Evaluación no lo
--     alargan. A las 2 horas exactas ya venció. Leer nunca borra: lo hacen `iniciar` y la purga.
--   * La marca de falta de material va en `diagnostico.falta_material`, sin grant, y no dentro de `resultado_por_habilidad`: esa
--     la leen el dueño, el monitor de la cita y el admin, y la marca no es de ellos.
--   * `semilla` y `aciertos` son `not null` sin valor por defecto, y `respondidas` se genera de `respuestas`, que debe ser un
--     arreglo: la migración exige `diagnostico` vacío. No hay datos reales que migrar (la nube no se toca hasta HU-057); una base
--     local con diagnósticos de pruebas viejas se arregla con `npm run db:reiniciar`. Reaplicarla sobre la base final no falla.
--   * Un `diagnostico` solo nace completo: `respuestas` con al menos un paso, `aciertos` entre 0 y lo respondido, `semilla` de 32
--     bits sin signo, `puntaje` de 0 a 100 y un resultado con `habilidades`, `errores` y `prerrequisitos`.
--   * Sin check entre `iniciado_en` y `actualizado_en`: ninguna regla lo usa y las pruebas de vencimiento envejecen la fila.
--   * Las claves se ordenan con `collate "C"` (el orden que usa el motor al comparar cadenas), no con la intercalación de la base.
--   * Una `p_copia` que no es un objeto JSON no se aplica en `responder_diagnostico` (devuelve false) y hace fallar a
--     `terminar_diagnostico` (invalid_parameter_value, sin escribir): el servidor la arma siempre como objeto.
--
-- Candados: `iniciar_diagnostico` toma 6802 por sesión y después las filas del en curso; `terminar_diagnostico` toma la fila del
-- en curso (`for update`) y después 6801, el candado por sesión de registrar_lead, confirmar_correo_de_lead y
-- anotar_correo_de_contacto (HU-068, HU-075); `registrar_lead` solo toma 6801. Nadie toma 6801 y después 6802 ni la fila: sin ciclo.
-- Idempotente (reaplicarla no falla ni duplica el cron; exige `diagnostico` vacío solo la primera vez).

-- ---------------------------------------------------------------------------
-- El diagnóstico en curso
-- ---------------------------------------------------------------------------
create table if not exists public.diagnostico_en_curso (
  id uuid primary key default gen_random_uuid(),
  id_sesion uuid not null references auth.users (id) on delete cascade,
  id_evaluacion uuid not null,
  id_materia uuid not null,
  -- Entero de 32 bits sin signo: no cabe en integer.
  semilla bigint not null,
  vistas_antes text[] not null default '{}',
  repetido boolean not null default false,
  candidatas jsonb not null,
  contexto jsonb not null,
  pasos jsonb not null default '[]',
  paso integer not null default 0,
  iniciado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint diagnostico_en_curso_id_sesion_key unique (id_sesion),
  -- Un en curso es efímero: no debe impedir borrar una Evaluación (en `diagnostico` la llave queda sin cascada).
  constraint diagnostico_en_curso_evaluacion_fk foreign key (id_evaluacion, id_materia)
    references public.evaluacion (id, id_materia) on delete cascade,
  constraint diagnostico_en_curso_semilla_rango check (semilla between 0 and 4294967295),
  -- Con coalesce: un CHECK que da NULL (por ejemplo, un objeto sin la clave) pasa.
  constraint diagnostico_en_curso_formas check (
    coalesce(jsonb_typeof(candidatas) = 'array', false)
    and coalesce(jsonb_typeof(contexto) = 'object', false)
    and coalesce(jsonb_typeof(pasos) = 'array', false)
  ),
  constraint diagnostico_en_curso_paso_coincide check (paso >= 0 and paso = jsonb_array_length(pasos))
);

comment on table public.diagnostico_en_curso is
  'Diagnóstico que una sesión está tomando: una fila por sesión, cerrada a la Data API (solo service_role). Guarda la foto del banco al empezar, la semilla, las vistas antes y las copias de los pasos respondidos. Al terminar pasa a diagnostico con el mismo id y se borra; vence a las 2 horas de su última respuesta. HU-081.';
comment on column public.diagnostico_en_curso.id is
  'Identificador que recibe el navegador en cada respuesta (nunca la semilla). Es el id que tendrá el diagnóstico al terminar. HU-081.';
comment on column public.diagnostico_en_curso.semilla is
  'Semilla de 32 bits sin signo (crypto.randomInt): con el banco y el motor públicos permite calcular el orden de las opciones y la correcta, así que nunca sale de la base. HU-081.';
comment on column public.diagnostico_en_curso.vistas_antes is
  'Claves de las preguntas que la sesión (o un Lead de la sesión) vio en diagnósticos terminados de la materia (D-49 a). Vacía al volver a tomarlo (D-51). HU-081.';
comment on column public.diagnostico_en_curso.repetido is
  'D-51: el diagnóstico se tomó de nuevo sin excluir las preguntas vistas, porque no quedaban preguntas nuevas. HU-081.';
comment on column public.diagnostico_en_curso.candidatas is
  'Foto de las preguntas revisadas que miden alguna habilidad de la Evaluación al empezar, completas (opciones, correcta, misconcepciones, errores y solución). Editar el banco después no las cambia. HU-081.';
comment on column public.diagnostico_en_curso.contexto is
  'Foto del contexto al empezar: versión del formato, Evaluación y materia, habilidades con sus prerrequisitos, misconcepciones y descripciones de las habilidades de la materia. HU-081.';
comment on column public.diagnostico_en_curso.pasos is
  'Copias de los pasos ya respondidos (la pregunta como estaba, el orden de las opciones, la letra elegida y la fecha). HU-081.';
comment on column public.diagnostico_en_curso.paso is
  'Preguntas ya respondidas, desde 0. Es el número que la respuesta debe traer para aplicarse (una sola vez). HU-081.';
comment on column public.diagnostico_en_curso.actualizado_en is
  'Última respuesta, o el inicio si no hay ninguna: de aquí sale el vencimiento de 2 horas. HU-081.';

create index if not exists diagnostico_en_curso_id_evaluacion_idx on public.diagnostico_en_curso (id_evaluacion, id_materia);
-- Lo que recorre la purga.
create index if not exists diagnostico_en_curso_actualizado_en_idx on public.diagnostico_en_curso (actualizado_en);

-- Sin políticas: anon y authenticated no tienen ningún permiso y service_role (el servidor) se salta RLS.
alter table public.diagnostico_en_curso enable row level security;
revoke all on table public.diagnostico_en_curso from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.diagnostico_en_curso to service_role;

-- ---------------------------------------------------------------------------
-- diagnostico: resultado por habilidad y columnas del servidor
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'diagnostico' and column_name = 'resultado_por_tema'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'diagnostico' and column_name = 'resultado_por_habilidad'
  ) then
    alter table public.diagnostico rename column resultado_por_tema to resultado_por_habilidad;
  end if;
end $$;

-- `semilla` y `aciertos` son `not null` sin valor por defecto: con filas en `diagnostico` esto falla (23502). Es lo previsto.
alter table public.diagnostico add column if not exists semilla bigint not null;
alter table public.diagnostico add column if not exists repetido boolean not null default false;
-- Una columna generada no puede quedar fuera de sintonía con `respuestas`. Si `respuestas` no es un arreglo, el INSERT falla.
alter table public.diagnostico add column if not exists respondidas integer
  generated always as (jsonb_array_length(respuestas)) stored;
alter table public.diagnostico add column if not exists aciertos smallint not null;
-- Forma: [{"habilidad": "<clave>", "motivos": ["sin_preguntas_sin_ver" | "tope_una_respuesta"]}], solo las habilidades con marca.
alter table public.diagnostico add column if not exists falta_material jsonb not null default '[]';

-- Cada constraint con drop antes: un `add constraint` a secas falla al reaplicar (42710) y db:verificar reaplica cada migración.
alter table public.diagnostico drop constraint if exists diagnostico_semilla_rango;
alter table public.diagnostico add constraint diagnostico_semilla_rango
  check (semilla between 0 and 4294967295);

alter table public.diagnostico drop constraint if exists diagnostico_respondidas_minimas;
alter table public.diagnostico add constraint diagnostico_respondidas_minimas
  check (respondidas >= 1);

alter table public.diagnostico drop constraint if exists diagnostico_aciertos_en_rango;
alter table public.diagnostico add constraint diagnostico_aciertos_en_rango
  check (aciertos >= 0 and aciertos <= respondidas);

alter table public.diagnostico drop constraint if exists diagnostico_puntaje_en_rango;
alter table public.diagnostico add constraint diagnostico_puntaje_en_rango
  check (puntaje between 0 and 100);

alter table public.diagnostico drop constraint if exists diagnostico_falta_material_forma;
alter table public.diagnostico add constraint diagnostico_falta_material_forma
  check (coalesce(jsonb_typeof(falta_material) = 'array', false));

alter table public.diagnostico drop constraint if exists diagnostico_resultado_completo;
alter table public.diagnostico add constraint diagnostico_resultado_completo
  check (
    coalesce(
      jsonb_typeof(resultado_por_habilidad) = 'object'
      and jsonb_typeof(resultado_por_habilidad -> 'habilidades') = 'array'
      and jsonb_typeof(resultado_por_habilidad -> 'errores') = 'array'
      and jsonb_typeof(resultado_por_habilidad -> 'prerrequisitos') = 'array',
      false
    )
  );

comment on column public.diagnostico.respuestas is
  'Copias de las preguntas respondidas, cada una con la correcta, las misconcepciones y la solución, el orden de las opciones y la letra elegida: solo servidor. Un arreglo con al menos un paso. HU-081.';
comment on column public.diagnostico.semilla is
  'Semilla de 32 bits sin signo con la que el motor armó este diagnóstico: solo servidor, nunca sale de la base. HU-081.';
comment on column public.diagnostico.repetido is
  'D-51: se tomó de nuevo sin excluir las preguntas que la persona ya había visto. Sin grant: lo leen las funciones del servidor. HU-081.';
comment on column public.diagnostico.respondidas is
  'Preguntas respondidas: el largo de respuestas (columna generada). HU-081.';
comment on column public.diagnostico.aciertos is
  'Preguntas acertadas. Una pregunta que mide varias habilidades cuenta una vez, así que no sale de sumar el resultado por habilidad. HU-081.';
comment on column public.diagnostico.falta_material is
  'Habilidades que el motor marcó con falta de material y por qué (regla 12 de HU-060, D-49 c), para que HU-061 las anote en contenido/FALTA-MATERIAL.md: [{habilidad, motivos}]. Sin grant: ninguna sesión la lee. HU-081.';
comment on column public.diagnostico.resultado_por_habilidad is
  'Lo que calificó el motor, tal como se vio al terminar: {habilidades, errores, prerrequisitos}, con los nombres legibles y sin la marca de falta de material (esa va en falta_material). Los errores traen el texto de error de las opciones que la persona eligió (D-49 d). HU-081.';

-- Con D-7 el monitor de cada cita individual lee el diagnóstico (RN-13 lo autoriza); la política de lectura no cambia. Las
-- sesiones leen por columnas, sin el token de recuperación (RN-12) y, desde esta HU, sin las copias de las preguntas
-- (`respuestas` traía la correcta y la solución), la semilla, el repetido, lo respondido, los aciertos ni la marca de falta de
-- material. `revoke select` de la tabla también quita los grants por columna que ya tenía. service_role conserva todo.
revoke select on table public.diagnostico from authenticated;
grant select (
  id, id_lead, id_sesion_anonima, id_evaluacion, id_materia, id_monitoria,
  puntaje, resultado_por_habilidad, fecha_realizacion
) on table public.diagnostico to authenticated;

-- ---------------------------------------------------------------------------
-- Ayudas de la base (esquema privado)
-- ---------------------------------------------------------------------------
-- El en curso vence a las 2 horas de su última respuesta (D-49 d). La app tiene la misma cifra
-- (HORAS_DE_VIGENCIA_DEL_DIAGNOSTICO en src/lib/diagnostico/reglas.ts); integracion/diagnostico.test.ts las compara.
create or replace function privado.vigencia_del_diagnostico_en_curso()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '2 hours' $$;

comment on function privado.vigencia_del_diagnostico_en_curso() is
  'D-49 d: tiempo sin responder tras el cual un diagnóstico en curso vence. HU-081.';
revoke all on function privado.vigencia_del_diagnostico_en_curso() from public, anon, authenticated, service_role;

-- El Lead de una sesión por las tres vías de privado.es_mi_lead, con la prioridad de leadDeLaSesion (src/lib/leads/servidor.ts): el
-- que creó desde esa sesión, uno cuyo correo confirmó con el enlace de verificación (P-23) y el de su cuenta de Estudiante.
-- Nulo si la sesión no es de ningún Lead.
create or replace function privado.lead_de_la_sesion(p_id_sesion uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select x.id_lead
  from (
    select 1 as prioridad, l.id as id_lead from public.lead l where l.id_sesion_anonima = p_id_sesion
    union all
    select 2, s.id_lead from public.lead_sesion s where s.id_sesion = p_id_sesion
    union all
    select 3, e.id_lead from public.estudiante e where e.id = p_id_sesion
  ) x
  order by x.prioridad
  limit 1;
$$;

comment on function privado.lead_de_la_sesion(uuid) is
  'El Lead de una sesión (la que lo creó, una que confirmó su correo o su cuenta de Estudiante), o nulo. Es la regla de privado.es_mi_lead con la sesión como parámetro: service_role no tiene auth.uid(). HU-081.';
revoke all on function privado.lead_de_la_sesion(uuid) from public, anon, authenticated, service_role;

-- Todos los Leads de una sesión, por las tres vías de privado.es_mi_lead (20260930172923_lead_al_agendar.sql) con la sesión como
-- parámetro en lugar de auth.uid(): el que creó, uno cuyo correo confirmó y el de su cuenta de Estudiante. Un arreglo vacío si no es
-- de ninguno. Es un conjunto y no uno solo (como lead_de_la_sesion) porque es_mi_lead acepta cualquiera de los tres. La usa
-- vistas_de_la_sesion una sola vez por llamada: `d.id_lead = any(...)` usa diagnostico_id_lead_idx, y llamar a una función de
-- «¿este Lead es de la sesión?» por cada diagnóstico de la materia no usa ningún índice. Si HU-068 cambia las vías de un Lead, hay
-- que cambiar las dos: la prueba de equivalencia de supabase/tests lo hace visible.
create or replace function privado.leads_de_la_sesion(p_id_sesion uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct x.id_lead), '{}'::uuid[])
  from (
    select l.id as id_lead from public.lead l where l.id_sesion_anonima = p_id_sesion
    union all
    select s.id_lead from public.lead_sesion s where s.id_sesion = p_id_sesion
    union all
    select e.id_lead from public.estudiante e where e.id = p_id_sesion
  ) x;
$$;

comment on function privado.leads_de_la_sesion(uuid) is
  'Los Leads de una sesión (la que los creó, una que confirmó su correo o su cuenta de Estudiante): la regla de privado.es_mi_lead con la sesión como parámetro, en un arreglo. La llama vistas_de_la_sesion con la llave secreta. HU-081.';
revoke all on function privado.leads_de_la_sesion(uuid) from public, anon, authenticated, service_role;
-- service_role ya entra al esquema privado (20261001074954_equipo_de_admins.sql); entrar no le da nada más que lo que se le concede.
grant usage on schema privado to service_role;
grant execute on function privado.leads_de_la_sesion(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- La foto del banco al empezar
-- ---------------------------------------------------------------------------
-- Una sola sentencia: la foto es consistente aunque se cargue el banco al mismo tiempo (HU-061). Devuelve null si la Evaluación
-- no existe o no está activa (D-13). Si no, {contexto, candidatas}:
--   * contexto.habilidades: las de los temas de la Evaluación (las de una acumulativa ya vienen expandidas en evaluacion_tema),
--     por tema.orden y luego clave. La base no guarda el orden de archivo de las habilidades dentro de un tema. Cada prerrequisito
--     directo con la clave y la descripción de su habilidad y `materia` igual al nombre de su materia si es otra y null si es la
--     misma; por materia y clave.
--   * contexto.misconcepciones: todas las de la materia (el motor lanza RangeError si una opción ofrece una que no está), por
--     clave. descripcionesDeHabilidad: todas las habilidades de la materia, para los errores de habilidades de fuera de la
--     Evaluación.
--   * candidatas: preguntas `revisada` de la materia que miden al menos una habilidad de la Evaluación (D-13), por clave, con
--     sus cuatro opciones de la A a la D, el tema como clave, las claves de TODAS las habilidades que mide y la solución o null.
-- Trae la correcta, las misconcepciones y las soluciones: solo service_role.
create or replace function public.banco_de_la_evaluacion(p_id_evaluacion uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with ev as (
    select e.id, e.id_materia, e.nombre, m.codigo as codigo_materia, m.nombre as nombre_materia
    from public.evaluacion e
    join public.materia m on m.id = e.id_materia
    where e.id = p_id_evaluacion and e.activa
  ),
  habilidades_ev as (
    select h.id, h.clave, h.descripcion, t.orden as orden_tema
    from ev
    join public.evaluacion_tema et on et.id_evaluacion = ev.id and et.id_materia = ev.id_materia
    join public.tema t on t.id = et.id_tema and t.id_materia = et.id_materia
    join public.habilidad h on h.id_tema = t.id and h.id_materia = t.id_materia
  ),
  prerrequisitos_ev as (
    select
      hp.id_habilidad,
      case when d.id_materia = ev.id_materia then null else md.nombre end as materia,
      d.clave,
      d.descripcion
    from ev
    cross join habilidades_ev he
    join public.habilidad_prerrequisito hp on hp.id_habilidad = he.id
    join public.habilidad d on d.id = hp.id_prerrequisito
    join public.materia md on md.id = d.id_materia
  ),
  candidatas_ev as (
    select p.id, p.clave, p.enunciado, p.dificultad, p.solucion, t.clave as clave_tema
    from ev
    join public.pregunta p on p.id_materia = ev.id_materia and p.estado = 'revisada'
    join public.tema t on t.id = p.id_tema and t.id_materia = p.id_materia
    where exists (
      select 1
      from public.pregunta_habilidad ph
      join habilidades_ev he on he.id = ph.id_habilidad
      where ph.id_pregunta = p.id
    )
  )
  select jsonb_build_object(
    'contexto', jsonb_build_object(
      'version', 1,
      'evaluacion', jsonb_build_object('id', ev.id, 'nombre', ev.nombre),
      'materia', jsonb_build_object('id', ev.id_materia, 'codigo', ev.codigo_materia, 'nombre', ev.nombre_materia),
      'habilidades', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'clave', he.clave,
            'descripcion', he.descripcion,
            'prerrequisitos', coalesce((
              select jsonb_agg(
                jsonb_build_object('materia', pr.materia, 'habilidad', pr.clave, 'descripcion', pr.descripcion)
                order by pr.materia collate "C" nulls first, pr.clave collate "C"
              )
              from prerrequisitos_ev pr
              where pr.id_habilidad = he.id
            ), '[]'::jsonb)
          )
          order by he.orden_tema, he.clave collate "C"
        )
        from habilidades_ev he
      ), '[]'::jsonb),
      'misconcepciones', coalesce((
        select jsonb_agg(
          jsonb_build_object('clave', mc.clave, 'habilidad', hm.clave, 'descripcion', mc.descripcion)
          order by mc.clave collate "C"
        )
        from public.misconcepcion mc
        join public.habilidad hm on hm.id = mc.id_habilidad and hm.id_materia = mc.id_materia
        where mc.id_materia = ev.id_materia
      ), '[]'::jsonb),
      'descripcionesDeHabilidad', coalesce((
        select jsonb_object_agg(hd.clave, hd.descripcion)
        from public.habilidad hd
        where hd.id_materia = ev.id_materia
      ), '{}'::jsonb)
    ),
    'candidatas', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'clave', c.clave,
          'tema', c.clave_tema,
          'enunciado', c.enunciado,
          'opciones', (
            select jsonb_agg(
              jsonb_build_object('texto', o.texto, 'correcta', o.correcta, 'misconcepcion', mo.clave, 'error', o.error)
              order by o.letra
            )
            from public.opcion o
            left join public.misconcepcion mo on mo.id = o.id_misconcepcion and mo.id_materia = o.id_materia
            where o.id_pregunta = c.id
          ),
          'dificultad', c.dificultad,
          'habilidades', (
            select jsonb_agg(hp2.clave order by hp2.clave collate "C")
            from public.pregunta_habilidad ph2
            join public.habilidad hp2 on hp2.id = ph2.id_habilidad and hp2.id_materia = ph2.id_materia
            where ph2.id_pregunta = c.id
          ),
          'solucion', c.solucion
        )
        order by c.clave collate "C"
      )
      from candidatas_ev c
    ), '[]'::jsonb)
  )
  from ev;
$$;

comment on function public.banco_de_la_evaluacion(uuid) is
  'La foto del banco que guarda un diagnóstico al empezar: {contexto, candidatas} de una Evaluación activa, o null si no existe o está inactiva. Trae la correcta, las misconcepciones y las soluciones: solo service_role. HU-081.';
revoke all on function public.banco_de_la_evaluacion(uuid) from public, anon, authenticated, service_role;
grant execute on function public.banco_de_la_evaluacion(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Las vistas antes (criterio 5, D-49 a)
-- ---------------------------------------------------------------------------
-- Las preguntas de los diagnósticos terminados de la materia de la Evaluación cuya `id_sesion_anonima` es la sesión o cuyo
-- `id_lead` es un Lead de la sesión (la regla de privado.es_mi_lead, resuelta una vez con privado.leads_de_la_sesion: un
-- InitPlan, así que ni cambia con el plan ni se evalúa por fila). Un diagnóstico en curso no cuenta: no está en
-- `diagnostico`. `claves`: las distintas y ordenadas, de los elementos de `respuestas` que son objetos con `clave`.
-- `id_ultimo`: el último diagnóstico de esa Evaluación y, si no hay, el último de la materia (una acumulativa puede haber visto
-- todas las preguntas sin haberse tomado), por fecha_realizacion desc, id desc (el orden de agendar). Evaluación inexistente:
-- claves vacío e id_ultimo nulo.
create or replace function public.vistas_de_la_sesion(p_id_sesion uuid, p_id_evaluacion uuid)
returns table (claves text[], id_ultimo uuid)
language sql
stable
security invoker
set search_path = ''
as $$
  with ev as (
    select e.id_materia from public.evaluacion e where e.id = p_id_evaluacion
  ),
  propios as (
    select d.id, d.id_evaluacion, d.fecha_realizacion, d.respuestas
    from ev
    join public.diagnostico d on d.id_materia = ev.id_materia
    where d.id_sesion_anonima = p_id_sesion
       -- El `::uuid[]` evita que Postgres lea `any((select ...))` como «any de las filas de una subconsulta».
       or d.id_lead = any((select privado.leads_de_la_sesion(p_id_sesion))::uuid[])
  )
  select
    coalesce((
      select array_agg(distinct v.clave order by v.clave)
      from propios p
      cross join lateral (
        select e ->> 'clave' as clave
        from jsonb_array_elements(p.respuestas) e
        where jsonb_typeof(e) = 'object' and e ->> 'clave' is not null
      ) v
    ), '{}'::text[]),
    (
      select p.id
      from propios p
      order by (p.id_evaluacion = p_id_evaluacion) desc, p.fecha_realizacion desc, p.id desc
      limit 1
    );
$$;

comment on function public.vistas_de_la_sesion(uuid, uuid) is
  'Claves de las preguntas que la sesión (o un Lead de la sesión) vio en diagnósticos terminados de la materia de la Evaluación, y el id del último diagnóstico (el de la Evaluación y, si no hay, el de la materia). Solo service_role. HU-081.';
revoke all on function public.vistas_de_la_sesion(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.vistas_de_la_sesion(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Leer el diagnóstico en curso (no escribe nada)
-- ---------------------------------------------------------------------------
-- Una fila o ninguna: la de la sesión, si no ha vencido (actualizado_en + vigencia > p_ahora). Sin el filtro por sesión se le
-- mostraría a una persona la pregunta de otra.
create or replace function privado.diagnostico_en_curso_de(p_id_sesion uuid, p_ahora timestamptz default now())
returns setof public.diagnostico_en_curso
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return query
  select d.*
  from public.diagnostico_en_curso d
  where d.id_sesion = p_id_sesion
    and d.actualizado_en + privado.vigencia_del_diagnostico_en_curso() > p_ahora;
end;
$$;

comment on function privado.diagnostico_en_curso_de(uuid, timestamptz) is
  'El diagnóstico en curso vigente de la sesión, con la hora como parámetro (para probar los bordes). Sin grants. HU-081.';
revoke all on function privado.diagnostico_en_curso_de(uuid, timestamptz) from public, anon, authenticated, service_role;

create or replace function privado.diagnostico_en_curso_de_del_servidor(p_id_sesion uuid)
returns setof public.diagnostico_en_curso
language sql
volatile
security definer
set search_path = ''
as $$
  select * from privado.diagnostico_en_curso_de(p_id_sesion, now());
$$;

comment on function privado.diagnostico_en_curso_de_del_servidor(uuid) is
  'El diagnóstico en curso vigente de la sesión con la hora de la base. HU-081.';
revoke all on function privado.diagnostico_en_curso_de_del_servidor(uuid) from public, anon, authenticated, service_role;
grant execute on function privado.diagnostico_en_curso_de_del_servidor(uuid) to service_role;

create or replace function public.diagnostico_en_curso_de(p_id_sesion uuid)
returns setof public.diagnostico_en_curso
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from privado.diagnostico_en_curso_de_del_servidor(p_id_sesion);
$$;

comment on function public.diagnostico_en_curso_de(uuid) is
  'El diagnóstico en curso vigente de la sesión (una fila o ninguna). No escribe nada, ni borra el vencido. Trae las copias y la semilla: solo service_role. HU-081.';
revoke all on function public.diagnostico_en_curso_de(uuid) from public, anon, authenticated, service_role;
grant execute on function public.diagnostico_en_curso_de(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Iniciar o reemplazar el diagnóstico en curso
-- ---------------------------------------------------------------------------
-- Resultados: `creado` y `ya_en_curso` traen el id del en curso; `evaluacion_no_disponible` y `cuenta_del_equipo` no traen id.
-- Orden (cada paso con el candado 6802 de la sesión, que no usa ninguna otra función):
--   1. Dos `iniciar` de la misma sesión van uno detrás del otro.
--   2. La sesión es de un admin o de un monitor: `cuenta_del_equipo`, sin escribir. Mira las tablas, no `mi_rol`: a propósito
--      también frena a un admin desactivado (`mi_rol` ya no lo cuenta como admin), que es lo prudente.
--   3. Borra el en curso de la sesión si ya venció.
--   4. Hay uno vigente de la misma Evaluación y con la misma versión de la foto: `ya_en_curso`, sin tocar nada (ni
--      `actualizado_en` ni la semilla). Gana la pendiente aunque la Evaluación ya esté inactiva: tiene sus copias.
--   5. La Evaluación no existe o no está activa: `evaluacion_no_disponible`, sin escribir y sin borrar el en curso de otra.
--   6. Borra el en curso vigente de otra Evaluación (o de otra versión de la foto), inserta el nuevo y devuelve `creado`. Todo en
--      la misma transacción: el anterior solo se pierde si el nuevo nace. Todos los `delete` llevan `id_sesion`.
-- Un error de la base (llave, check) se propaga: el servidor lo trata como fallo.
create or replace function privado.iniciar_diagnostico(
  p_id_sesion uuid,
  p_id_evaluacion uuid,
  p_semilla bigint,
  p_vistas_antes text[],
  p_repetido boolean,
  p_candidatas jsonb,
  p_contexto jsonb,
  p_ahora timestamptz default now()
)
returns table (resultado text, id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_id_materia uuid;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(6802, hashtext(p_id_sesion::text));

  if exists (select 1 from public.admin a where a.id = p_id_sesion)
     or exists (select 1 from public.monitor m where m.id = p_id_sesion) then
    return query select 'cuenta_del_equipo'::text, null::uuid;
    return;
  end if;

  delete from public.diagnostico_en_curso d
  where d.id_sesion = p_id_sesion
    and d.actualizado_en + privado.vigencia_del_diagnostico_en_curso() <= p_ahora;

  select d.id into v_id
  from public.diagnostico_en_curso d
  where d.id_sesion = p_id_sesion
    and d.id_evaluacion = p_id_evaluacion
    and d.contexto ->> 'version' = p_contexto ->> 'version';
  if found then
    return query select 'ya_en_curso'::text, v_id;
    return;
  end if;

  select e.id_materia into v_id_materia
  from public.evaluacion e
  where e.id = p_id_evaluacion and e.activa;
  if not found then
    return query select 'evaluacion_no_disponible'::text, null::uuid;
    return;
  end if;

  delete from public.diagnostico_en_curso d where d.id_sesion = p_id_sesion;

  insert into public.diagnostico_en_curso as d (
    id_sesion, id_evaluacion, id_materia, semilla, vistas_antes, repetido, candidatas, contexto, iniciado_en, actualizado_en
  ) values (
    p_id_sesion, p_id_evaluacion, v_id_materia, p_semilla, p_vistas_antes, p_repetido, p_candidatas, p_contexto, p_ahora, p_ahora
  )
  returning d.id into v_id;

  return query select 'creado'::text, v_id;
end;
$$;

comment on function privado.iniciar_diagnostico(uuid, uuid, bigint, text[], boolean, jsonb, jsonb, timestamptz) is
  'Inicia el diagnóstico en curso de una sesión, o devuelve el que ya tiene de la misma Evaluación, con la hora como parámetro. Sin grants. HU-081.';
revoke all on function privado.iniciar_diagnostico(uuid, uuid, bigint, text[], boolean, jsonb, jsonb, timestamptz)
  from public, anon, authenticated, service_role;

create or replace function privado.iniciar_diagnostico_del_servidor(
  p_id_sesion uuid,
  p_id_evaluacion uuid,
  p_semilla bigint,
  p_vistas_antes text[],
  p_repetido boolean,
  p_candidatas jsonb,
  p_contexto jsonb
)
returns table (resultado text, id uuid)
language sql
volatile
security definer
set search_path = ''
as $$
  select * from privado.iniciar_diagnostico(
    p_id_sesion, p_id_evaluacion, p_semilla, p_vistas_antes, p_repetido, p_candidatas, p_contexto, now());
$$;

comment on function privado.iniciar_diagnostico_del_servidor(uuid, uuid, bigint, text[], boolean, jsonb, jsonb) is
  'privado.iniciar_diagnostico con la hora de la base. HU-081.';
revoke all on function privado.iniciar_diagnostico_del_servidor(uuid, uuid, bigint, text[], boolean, jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function privado.iniciar_diagnostico_del_servidor(uuid, uuid, bigint, text[], boolean, jsonb, jsonb) to service_role;

create or replace function public.iniciar_diagnostico(
  p_id_sesion uuid,
  p_id_evaluacion uuid,
  p_semilla bigint,
  p_vistas_antes text[],
  p_repetido boolean,
  p_candidatas jsonb,
  p_contexto jsonb
)
returns table (resultado text, id uuid)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from privado.iniciar_diagnostico_del_servidor(
    p_id_sesion, p_id_evaluacion, p_semilla, p_vistas_antes, p_repetido, p_candidatas, p_contexto);
$$;

comment on function public.iniciar_diagnostico(uuid, uuid, bigint, text[], boolean, jsonb, jsonb) is
  'Inicia o reemplaza el diagnóstico en curso de la sesión. Resultados: creado, ya_en_curso (con el id), evaluacion_no_disponible o cuenta_del_equipo. Solo service_role, después de comprobar la sesión. HU-081.';
revoke all on function public.iniciar_diagnostico(uuid, uuid, bigint, text[], boolean, jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.iniciar_diagnostico(uuid, uuid, bigint, text[], boolean, jsonb, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Aplicar una respuesta una sola vez (compare-and-swap)
-- ---------------------------------------------------------------------------
-- Un solo UPDATE: solo aplica si el diagnóstico es ese `id`, es de esa sesión, está en ese `paso` y no ha vencido. true: se
-- aplicó. false: no se aplicó nada (id de otro diagnóstico, de otra sesión, paso viejo o adelantado, vencido, o una copia que no
-- es un objeto). Sin candado de sesión: la fila ya lo es. Dos pestañas con el mismo paso: la segunda espera la fila, la
-- reevalúa (READ COMMITTED), ve el paso nuevo y no aplica.
create or replace function privado.responder_diagnostico(
  p_id_sesion uuid,
  p_id uuid,
  p_paso integer,
  p_copia jsonb,
  p_ahora timestamptz default now()
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_copia is null or jsonb_typeof(p_copia) <> 'object' then
    return false;
  end if;

  update public.diagnostico_en_curso d
  set pasos = d.pasos || jsonb_build_array(p_copia),
      paso = d.paso + 1,
      actualizado_en = p_ahora
  where d.id = p_id
    and d.id_sesion = p_id_sesion
    and d.paso = p_paso
    and d.actualizado_en + privado.vigencia_del_diagnostico_en_curso() > p_ahora;
  return found;
end;
$$;

comment on function privado.responder_diagnostico(uuid, uuid, integer, jsonb, timestamptz) is
  'Aplica una respuesta al diagnóstico en curso una sola vez, con la hora como parámetro. Sin grants. HU-081.';
revoke all on function privado.responder_diagnostico(uuid, uuid, integer, jsonb, timestamptz)
  from public, anon, authenticated, service_role;

create or replace function privado.responder_diagnostico_del_servidor(p_id_sesion uuid, p_id uuid, p_paso integer, p_copia jsonb)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select privado.responder_diagnostico(p_id_sesion, p_id, p_paso, p_copia, now());
$$;

comment on function privado.responder_diagnostico_del_servidor(uuid, uuid, integer, jsonb) is
  'privado.responder_diagnostico con la hora de la base. HU-081.';
revoke all on function privado.responder_diagnostico_del_servidor(uuid, uuid, integer, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function privado.responder_diagnostico_del_servidor(uuid, uuid, integer, jsonb) to service_role;

create or replace function public.responder_diagnostico(p_id_sesion uuid, p_id uuid, p_paso integer, p_copia jsonb)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  select privado.responder_diagnostico_del_servidor(p_id_sesion, p_id, p_paso, p_copia);
$$;

comment on function public.responder_diagnostico(uuid, uuid, integer, jsonb) is
  'Aplica la respuesta (la copia del paso) al diagnóstico en curso si es ese id, esa sesión y ese paso y no venció: true, o false sin cambios. Solo service_role. HU-081.';
revoke all on function public.responder_diagnostico(uuid, uuid, integer, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.responder_diagnostico(uuid, uuid, integer, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Terminar: insertar el diagnóstico y borrar el en curso, en una transacción
-- ---------------------------------------------------------------------------
-- Recibe la última copia y el resultado que ya calculó el servidor con el motor (la base no recalcula nada). Orden:
--   1. Toma la fila del en curso `for update` (con alias: `id` e `id_sesion` sin calificar chocarían con la salida). Sin fila, o
--      con otro paso, o vencida: `no_aplicada`, sin escribir. Dos pestañas en la última respuesta: la segunda espera la fila, la
--      encuentra borrada y recibe `no_aplicada`; el servidor busca el diagnóstico con ese id y responde `terminado`.
--   2. Toma el candado por sesión 6801 de registrar_lead, confirmar_correo_de_lead y anotar_correo_de_contacto. Así, o el Lead ya
--      existe cuando se calcula `id_lead`, o `registrar_lead` corre después y su UPDATE ... where id_lead is null ve el
--      diagnóstico ya confirmado. Sin el candado, `registrar_lead` no vería una fila insertada y sin confirmar.
--   3. `id_lead` se calcula DESPUÉS del candado, en una sentencia aparte: el candado solo sirve si lo que se lee después ya ve lo
--      que otra transacción confirmó antes de soltarlo. Por eso la función es plpgsql volátil y no `language sql` ni una sola
--      sentencia con CTE (la instantánea se tomaría antes del candado y `id_lead` quedaría nulo).
--   4. Inserta en `diagnostico` con el mismo id del en curso (hace idempotente el último paso) y borra el en curso. Si el INSERT
--      viola un check, todo se deshace: el en curso sigue y no hay diagnóstico.
-- `token_recuperacion` toma su valor por defecto y nunca sale de la base.
create or replace function privado.terminar_diagnostico(
  p_id_sesion uuid,
  p_id uuid,
  p_paso integer,
  p_copia jsonb,
  p_resultado jsonb,
  p_falta_material jsonb,
  p_aciertos integer,
  p_puntaje numeric,
  p_ahora timestamptz default now()
)
returns table (resultado text, id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_en_curso public.diagnostico_en_curso%rowtype;
  v_id_lead uuid;
begin
  if p_copia is null or jsonb_typeof(p_copia) <> 'object' then
    raise exception 'La copia del último paso debe ser un objeto JSON.' using errcode = 'invalid_parameter_value';
  end if;

  select d.* into v_en_curso
  from public.diagnostico_en_curso d
  where d.id = p_id and d.id_sesion = p_id_sesion
  for update;
  if not found
     or v_en_curso.paso <> p_paso
     or v_en_curso.actualizado_en + privado.vigencia_del_diagnostico_en_curso() <= p_ahora then
    return query select 'no_aplicada'::text, null::uuid;
    return;
  end if;

  perform pg_advisory_xact_lock(6801, hashtext(p_id_sesion::text));
  v_id_lead := privado.lead_de_la_sesion(p_id_sesion);

  insert into public.diagnostico (
    id, id_lead, id_sesion_anonima, id_evaluacion, id_materia, respuestas, puntaje, resultado_por_habilidad,
    falta_material, aciertos, semilla, repetido, fecha_realizacion
  ) values (
    p_id, v_id_lead, p_id_sesion, v_en_curso.id_evaluacion, v_en_curso.id_materia,
    v_en_curso.pasos || jsonb_build_array(p_copia), p_puntaje, p_resultado,
    p_falta_material, p_aciertos, v_en_curso.semilla, v_en_curso.repetido, p_ahora
  );

  delete from public.diagnostico_en_curso d where d.id = p_id;

  return query select 'terminado'::text, p_id;
end;
$$;

comment on function privado.terminar_diagnostico(uuid, uuid, integer, jsonb, jsonb, jsonb, integer, numeric, timestamptz) is
  'Inserta el diagnóstico terminado (con id_lead si la sesión ya es de un Lead, bajo el candado 6801) y borra el en curso en una transacción, con la hora como parámetro. Sin grants. HU-081.';
revoke all on function privado.terminar_diagnostico(uuid, uuid, integer, jsonb, jsonb, jsonb, integer, numeric, timestamptz)
  from public, anon, authenticated, service_role;

create or replace function privado.terminar_diagnostico_del_servidor(
  p_id_sesion uuid,
  p_id uuid,
  p_paso integer,
  p_copia jsonb,
  p_resultado jsonb,
  p_falta_material jsonb,
  p_aciertos integer,
  p_puntaje numeric
)
returns table (resultado text, id uuid)
language sql
volatile
security definer
set search_path = ''
as $$
  select * from privado.terminar_diagnostico(
    p_id_sesion, p_id, p_paso, p_copia, p_resultado, p_falta_material, p_aciertos, p_puntaje, now());
$$;

comment on function privado.terminar_diagnostico_del_servidor(uuid, uuid, integer, jsonb, jsonb, jsonb, integer, numeric) is
  'privado.terminar_diagnostico con la hora de la base. HU-081.';
revoke all on function privado.terminar_diagnostico_del_servidor(uuid, uuid, integer, jsonb, jsonb, jsonb, integer, numeric)
  from public, anon, authenticated, service_role;
grant execute on function privado.terminar_diagnostico_del_servidor(uuid, uuid, integer, jsonb, jsonb, jsonb, integer, numeric)
  to service_role;

create or replace function public.terminar_diagnostico(
  p_id_sesion uuid,
  p_id uuid,
  p_paso integer,
  p_copia jsonb,
  p_resultado jsonb,
  p_falta_material jsonb,
  p_aciertos integer,
  p_puntaje numeric
)
returns table (resultado text, id uuid)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from privado.terminar_diagnostico_del_servidor(
    p_id_sesion, p_id, p_paso, p_copia, p_resultado, p_falta_material, p_aciertos, p_puntaje);
$$;

comment on function public.terminar_diagnostico(uuid, uuid, integer, jsonb, jsonb, jsonb, integer, numeric) is
  'Termina el diagnóstico: inserta diagnostico (mismo id que el en curso) y borra el en curso en una transacción. Resultados: terminado (con el id) o no_aplicada (sin fila, otro paso o vencido). Solo service_role. HU-081.';
revoke all on function public.terminar_diagnostico(uuid, uuid, integer, jsonb, jsonb, jsonb, integer, numeric)
  from public, anon, authenticated, service_role;
grant execute on function public.terminar_diagnostico(uuid, uuid, integer, jsonb, jsonb, jsonb, integer, numeric) to service_role;

-- ---------------------------------------------------------------------------
-- La purga de cada media hora
-- ---------------------------------------------------------------------------
-- Borra los en curso vencidos de todas las sesiones y devuelve cuántos; correrla dos veces seguidas no borra nada la segunda.
-- No la exige ningún criterio (el vencido se borra al volver a iniciar), pero sin ella el de quien nunca vuelve se queda hasta que
-- HU-056 borre la sesión, y cada fila pesa decenas de KB. Frente a un `responder` o un `terminar` que corren a la vez se ordena por
-- la fila: el DELETE que espera a un UPDATE reevalúa su condición y no borra lo que acaba de refrescarse. Solo la corre pg_cron.
create or replace function privado.purgar_diagnosticos_en_curso(p_ahora timestamptz)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_borrados integer;
begin
  delete from public.diagnostico_en_curso d
  where d.actualizado_en + privado.vigencia_del_diagnostico_en_curso() <= p_ahora;
  get diagnostics v_borrados = row_count;
  return v_borrados;
end;
$$;

comment on function privado.purgar_diagnosticos_en_curso(timestamptz) is
  'Borra los diagnósticos en curso vencidos de todas las sesiones y devuelve cuántos. Solo la corre pg_cron. HU-081.';
revoke all on function privado.purgar_diagnosticos_en_curso(timestamptz) from public, anon, authenticated, service_role;

-- cron.schedule con el mismo nombre reemplaza el trabajo: reaplicar la migración no lo duplica.
select cron.schedule(
  'calibra-purgar-diagnosticos',
  '17,47 * * * *',
  'select privado.purgar_diagnosticos_en_curso(now())'
);
