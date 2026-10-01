-- Banco de preguntas por habilidades. HU-005.
--
-- El banco vive en markdown (`contenido/<materia>/`) y el convertidor (`scripts/contenido/convertir.mts`)
-- lo valida y lo carga aquí con upsert por la clave de cada fila dentro de su materia. El markdown manda
-- (decisión del 30-sep-2026): lo que sale del banco no se borra; una pregunta queda retirada y una
-- evaluación inactiva. Diseño: docs/diseno/2026-09-29-banco-por-habilidades.md.
--
--   * Materia → temas → habilidades (knowledge components) → misconcepciones (el error típico de una
--     habilidad). Una pregunta es de un tema, mide una o más habilidades de su materia y tiene cuatro
--     opciones: la correcta y tres incorrectas, cada una con la misconcepción que delata.
--   * Los prerrequisitos de una habilidad pueden ser de otra materia. Los ciclos los rechaza el
--     convertidor, que ve el banco entero.
--   * P-18: una Evaluación es un conjunto de temas de su materia (`evaluacion_tema`). Una acumulativa
--     llega ya con los temas de las anteriores: los expande el convertidor.
--   * D-13: una evaluación queda activa solo si cada habilidad de sus temas tiene al menos 3 preguntas
--     revisadas en al menos 2 dificultades. Lo calcula el convertidor y lo deja en `evaluacion.activa`.
--   * D-14: una opción incorrecta puede traer su propio texto de error (`opcion.error`); si no lo trae,
--     vale el de su misconcepción.
--   * Nadie con sesión lee estas tablas: la calificación va en el servidor, y el navegador nunca recibe
--     la opción correcta, la misconcepción de una opción ni la solución. Solo service_role (RLS activa y
--     sin políticas). `materia` y `evaluacion` conservan su lectura pública.
--   * Cada tabla hija copia `id_materia` y usa llaves foráneas compuestas (id, id_materia), como
--     `diagnostico`. Así la base garantiza que una pregunta solo mide habilidades de su materia, que una
--     opción solo ofrece misconcepciones de su materia y que una evaluación solo incluye temas de su
--     materia.
-- Idempotente.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'estado_pregunta' and typnamespace = 'public'::regnamespace) then
    create type public.estado_pregunta as enum ('borrador', 'revisada', 'retirada');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Temas, habilidades, prerrequisitos y misconcepciones
-- ---------------------------------------------------------------------------
create table if not exists public.tema (
  id uuid primary key default gen_random_uuid(),
  id_materia uuid not null references public.materia (id) on delete cascade,
  clave text not null,
  nombre text not null,
  orden integer not null,
  constraint tema_clave_formato check (clave ~ '^[a-z0-9][a-z0-9_-]*$'),
  constraint tema_nombre_no_vacio check (btrim(nombre) <> ''),
  constraint tema_orden_positivo check (orden > 0),
  constraint tema_id_materia_clave_key unique (id_materia, clave),
  -- Destino de las llaves compuestas de habilidad, pregunta y evaluacion_tema.
  constraint tema_id_materia_key unique (id, id_materia)
);
comment on table public.tema is
  'Tema de una materia: un archivo contenido/<materia>/<clave>.md del banco. HU-005.';
comment on column public.tema.orden is
  'Posición del tema en la lista "## Temas" de materia.md (1, 2, ...). HU-005.';

create table if not exists public.habilidad (
  id uuid primary key default gen_random_uuid(),
  id_materia uuid not null,
  id_tema uuid not null,
  clave text not null,
  descripcion text not null,
  constraint habilidad_clave_formato check (clave ~ '^[a-z0-9][a-z0-9_-]*$'),
  constraint habilidad_descripcion_no_vacia check (btrim(descripcion) <> ''),
  constraint habilidad_tema_fk foreign key (id_tema, id_materia)
    references public.tema (id, id_materia) on delete cascade,
  constraint habilidad_id_materia_clave_key unique (id_materia, clave),
  -- Destino de las llaves compuestas de misconcepcion y pregunta_habilidad.
  constraint habilidad_id_materia_key unique (id, id_materia)
);
comment on table public.habilidad is
  'Habilidad (knowledge component) declarada en un tema; su clave es única en la materia. HU-005.';
create index if not exists habilidad_id_tema_idx on public.habilidad (id_tema, id_materia);

-- Sin id_materia: un prerrequisito puede ser de otra materia ("calculo-diferencial/regla-producto").
create table if not exists public.habilidad_prerrequisito (
  id_habilidad uuid not null references public.habilidad (id) on delete cascade,
  id_prerrequisito uuid not null references public.habilidad (id) on delete cascade,
  primary key (id_habilidad, id_prerrequisito),
  constraint habilidad_prerrequisito_distintos check (id_habilidad <> id_prerrequisito)
);
comment on table public.habilidad_prerrequisito is
  'Habilidad que conviene dominar antes de otra; puede ser de otra materia. El convertidor rechaza los ciclos. HU-005.';
create index if not exists habilidad_prerrequisito_id_prerrequisito_idx
  on public.habilidad_prerrequisito (id_prerrequisito);

create table if not exists public.misconcepcion (
  id uuid primary key default gen_random_uuid(),
  id_materia uuid not null,
  id_habilidad uuid not null,
  clave text not null,
  descripcion text not null,
  constraint misconcepcion_clave_formato check (clave ~ '^[a-z0-9][a-z0-9_-]*$'),
  constraint misconcepcion_descripcion_no_vacia check (btrim(descripcion) <> ''),
  constraint misconcepcion_habilidad_fk foreign key (id_habilidad, id_materia)
    references public.habilidad (id, id_materia) on delete cascade,
  constraint misconcepcion_id_materia_clave_key unique (id_materia, clave),
  -- Destino de la llave compuesta de opcion.
  constraint misconcepcion_id_materia_key unique (id, id_materia)
);
comment on table public.misconcepcion is
  'Error típico de una habilidad; las opciones incorrectas lo ofrecen como trampa. HU-005.';
create index if not exists misconcepcion_id_habilidad_idx on public.misconcepcion (id_habilidad, id_materia);

-- ---------------------------------------------------------------------------
-- Preguntas y opciones
-- ---------------------------------------------------------------------------
create table if not exists public.pregunta (
  id uuid primary key default gen_random_uuid(),
  id_materia uuid not null,
  id_tema uuid not null,
  clave text not null,
  enunciado text not null,
  dificultad smallint not null,
  estado public.estado_pregunta not null,
  origen text not null,
  revisor text,
  solucion text,
  constraint pregunta_clave_formato check (clave ~ '^[A-Za-z0-9][A-Za-z0-9_-]*$'),
  constraint pregunta_enunciado_no_vacio check (btrim(enunciado) <> ''),
  constraint pregunta_dificultad_rango check (dificultad between 1 and 3),
  -- "humano" o "ia (<modelo>)", con el modelo sin paréntesis.
  constraint pregunta_origen_formato check (origen = 'humano' or origen ~ '^ia \([^()]+\)$'),
  -- A producción solo llega lo que aprobó alguien que sabe la materia, y queda dicho quién fue.
  constraint pregunta_revisada_con_revisor check (estado <> 'revisada' or revisor is not null),
  constraint pregunta_tema_fk foreign key (id_tema, id_materia)
    references public.tema (id, id_materia) on delete cascade,
  constraint pregunta_id_materia_clave_key unique (id_materia, clave),
  -- Destino de las llaves compuestas de opcion y pregunta_habilidad.
  constraint pregunta_id_materia_key unique (id, id_materia)
);
comment on table public.pregunta is
  'Pregunta del banco. Su clave es estable en la materia y nunca se reutiliza: la que sale del banco queda retirada. HU-005.';
comment on column public.pregunta.origen is
  '"humano" o "ia (<modelo>)". HU-005.';
comment on column public.pregunta.solucion is
  'Paso a paso para el revisor y el monitor. El estudiante no la ve. HU-005.';
create index if not exists pregunta_id_tema_idx on public.pregunta (id_tema, id_materia);

-- La pregunta y la habilidad tienen que ser de la misma materia (las dos llaves usan el mismo id_materia).
create table if not exists public.pregunta_habilidad (
  id_pregunta uuid not null,
  id_habilidad uuid not null,
  id_materia uuid not null,
  primary key (id_pregunta, id_habilidad),
  constraint pregunta_habilidad_pregunta_fk foreign key (id_pregunta, id_materia)
    references public.pregunta (id, id_materia) on delete cascade,
  constraint pregunta_habilidad_habilidad_fk foreign key (id_habilidad, id_materia)
    references public.habilidad (id, id_materia) on delete cascade
);
comment on table public.pregunta_habilidad is
  'Habilidades que mide cada pregunta, todas de su materia. HU-005.';
create index if not exists pregunta_habilidad_id_pregunta_idx on public.pregunta_habilidad (id_pregunta, id_materia);
create index if not exists pregunta_habilidad_id_habilidad_idx on public.pregunta_habilidad (id_habilidad, id_materia);

create table if not exists public.opcion (
  id uuid primary key default gen_random_uuid(),
  id_pregunta uuid not null,
  id_materia uuid not null,
  letra char(1) not null,
  texto text not null,
  correcta boolean not null,
  id_misconcepcion uuid,
  error text,
  constraint opcion_letra_valida check (letra in ('A', 'B', 'C', 'D')),
  constraint opcion_texto_no_vacio check (btrim(texto) <> ''),
  -- La correcta no delata ningún error. Cada incorrecta delata el de su misconcepción, con texto propio
  -- o sin él.
  constraint opcion_misconcepcion_segun_correcta check (
    (correcta and id_misconcepcion is null and error is null)
    or (not correcta and id_misconcepcion is not null)
  ),
  constraint opcion_id_pregunta_letra_key unique (id_pregunta, letra),
  constraint opcion_pregunta_fk foreign key (id_pregunta, id_materia)
    references public.pregunta (id, id_materia) on delete cascade,
  -- Sin cascada: borrar una misconcepción que alguna opción ofrece falla. Al borrar la materia entera sí
  -- se van juntas: la cascada (materia → tema → pregunta → opcion) borra las opciones antes de que se
  -- revise esta llave (lo prueba supabase/tests/banco_por_habilidades.test.sql).
  constraint opcion_misconcepcion_fk foreign key (id_misconcepcion, id_materia)
    references public.misconcepcion (id, id_materia)
);
comment on table public.opcion is
  'Opción A-D de una pregunta. La correcta, la misconcepción y el error solo los ve el servidor. HU-005.';
comment on column public.opcion.error is
  'Texto de error propio de una opción incorrecta. Null: vale la descripción de su misconcepción. HU-005.';
-- Una sola correcta por pregunta. Cuántas opciones tiene (cuatro) lo revisa el convertidor.
create unique index if not exists opcion_una_correcta_key on public.opcion (id_pregunta) where correcta;
create index if not exists opcion_id_pregunta_idx on public.opcion (id_pregunta, id_materia);
create index if not exists opcion_id_misconcepcion_idx on public.opcion (id_misconcepcion, id_materia);

-- ---------------------------------------------------------------------------
-- Evaluaciones: clave, activa y temas (P-18)
-- ---------------------------------------------------------------------------
-- Columnas nulas o con default: las inserciones que ya existen (pruebas, integración, e2e) no las mandan.
alter table public.evaluacion add column if not exists clave text;
alter table public.evaluacion add column if not exists activa boolean not null default false;

alter table public.evaluacion drop constraint if exists evaluacion_clave_formato;
alter table public.evaluacion add constraint evaluacion_clave_formato
  check (clave is null or clave ~ '^[a-z0-9][a-z0-9_-]*$');
-- La llave del upsert del convertidor. Las evaluaciones sin clave (nula) no chocan entre sí.
alter table public.evaluacion drop constraint if exists evaluacion_id_materia_clave_key;
alter table public.evaluacion add constraint evaluacion_id_materia_clave_key unique (id_materia, clave);

comment on column public.evaluacion.clave is
  'Clave de la evaluación en materia.md ("parcial-1"), única en la materia. Nula si no viene del banco. HU-005.';
comment on column public.evaluacion.activa is
  'Cada habilidad de sus temas tiene al menos 3 preguntas revisadas en al menos 2 dificultades. La calcula el convertidor. HU-005.';

create table if not exists public.evaluacion_tema (
  id_evaluacion uuid not null,
  id_tema uuid not null,
  id_materia uuid not null,
  primary key (id_evaluacion, id_tema),
  constraint evaluacion_tema_evaluacion_fk foreign key (id_evaluacion, id_materia)
    references public.evaluacion (id, id_materia) on delete cascade,
  constraint evaluacion_tema_tema_fk foreign key (id_tema, id_materia)
    references public.tema (id, id_materia) on delete cascade
);
comment on table public.evaluacion_tema is
  'Temas que cubre una evaluación, todos de su materia (P-18). Una acumulativa incluye los de las anteriores. HU-005.';
create index if not exists evaluacion_tema_id_evaluacion_idx on public.evaluacion_tema (id_evaluacion, id_materia);
create index if not exists evaluacion_tema_id_tema_idx on public.evaluacion_tema (id_tema, id_materia);

-- ---------------------------------------------------------------------------
-- Quién lee y quién cambia: solo el servidor
-- ---------------------------------------------------------------------------
-- Sin políticas: anon y authenticated no tienen ningún permiso, y service_role (el servidor y el
-- convertidor) se salta RLS. Lo que el navegador necesite del banco pasa por el servidor.
alter table public.tema enable row level security;
alter table public.habilidad enable row level security;
alter table public.habilidad_prerrequisito enable row level security;
alter table public.misconcepcion enable row level security;
alter table public.pregunta enable row level security;
alter table public.pregunta_habilidad enable row level security;
alter table public.opcion enable row level security;
alter table public.evaluacion_tema enable row level security;

revoke all on table public.tema from public, anon, authenticated, service_role;
revoke all on table public.habilidad from public, anon, authenticated, service_role;
revoke all on table public.habilidad_prerrequisito from public, anon, authenticated, service_role;
revoke all on table public.misconcepcion from public, anon, authenticated, service_role;
revoke all on table public.pregunta from public, anon, authenticated, service_role;
revoke all on table public.pregunta_habilidad from public, anon, authenticated, service_role;
revoke all on table public.opcion from public, anon, authenticated, service_role;
revoke all on table public.evaluacion_tema from public, anon, authenticated, service_role;

grant select, insert, update, delete on table public.tema to service_role;
grant select, insert, update, delete on table public.habilidad to service_role;
grant select, insert, update, delete on table public.habilidad_prerrequisito to service_role;
grant select, insert, update, delete on table public.misconcepcion to service_role;
grant select, insert, update, delete on table public.pregunta to service_role;
grant select, insert, update, delete on table public.pregunta_habilidad to service_role;
grant select, insert, update, delete on table public.opcion to service_role;
grant select, insert, update, delete on table public.evaluacion_tema to service_role;
