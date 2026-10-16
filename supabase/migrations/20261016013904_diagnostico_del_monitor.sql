-- El monitor ve el diagnóstico de su cita: función con permisos y cierre de la política de lectura. HU-022.
--
-- Decisiones: D-7 (la cita individual apunta a su diagnóstico con monitoria.id_diagnostico), D-13/D-14 del banco (el texto de error
-- propio de la opción y la solución solo salen del servidor; el monitor las ve aquí, ya terminado el diagnóstico, D-49 d), D-53 b
-- (el monitor ve la marca de repetido), D-54 a, b y c (el diagnóstico llega al monitor con la cita confirmada o realizada; una
-- realizada deja de verse 30 días después del fin de la sesión; ve todas las preguntas, falladas y acertadas, con la opción elegida,
-- la correcta y la solución) y D-67 a (con la autorización vieja, `v1`, ve el resultado y no las respuestas).
--
-- Por qué una función y no la tabla: hasta ahora el monitor leía `diagnostico` por la tabla (política de HU-017,
-- 20261001040929_agendar_monitoria.sql) sin mirar el estado de la cita ni un plazo, y solo por las columnas con grant. Las copias de
-- las preguntas (`respuestas`), lo respondido, los aciertos, el repetido y la marca de falta de material no tienen grant (HU-081):
-- lo que HU-022 muestra sale de esta función, que proyecta en SQL solo lo que la pantalla pinta (sin claves de pregunta, habilidad,
-- misconcepción ni materia, sin correo, teléfono, token de recuperación, semilla ni ids del Lead o de la sesión) y devuelve nada si
-- la cita no se ve: no existe, no es del monitor que llama, es grupal (HU-040 decide) o su estado no se ve (pendiente de pago,
-- cancelada, o realizada hace más de 30 días). No distingue entre esos casos, como `finalizar_monitoria` (`no_encontrada`).
--
-- Tres capas, con la hora fuera del alcance de las sesiones (patrón de 20261002181821_tope_de_correos.sql y de
-- 20261005213333_servidor_diagnostico.sql):
--   * privado.diagnostico_de_mi_monitoria(p_id_monitoria, p_ahora): el núcleo, `security definer`, SIN ningún grant. Lleva la hora
--     como parámetro para probar la frontera de los 30 días con pgTAP y con la integración (que corren como postgres).
--   * privado.diagnostico_de_mi_monitoria_ahora(p_id_monitoria): lo mismo con now(). La ejecutan las sesiones, a través de la puerta.
--   * public.diagnostico_de_mi_monitoria(p_id_monitoria): la puerta de la Data API, `security invoker`, solo `authenticated`.
-- `agenda_del_monitor` (HU-021) le da el grant al núcleo con `p_ahora` por ser anterior a este patrón; esta migración no la toca.
--
-- La autorización que cuenta es la del Lead de la cita (quien agendó y dio su consentimiento), leída hoy con
-- privado.autorizo_respuestas (HU-087): si el Lead edita su contacto con el texto nuevo pasa a `v2` y el monitor empieza a ver sus
-- respuestas. Además se exige que el diagnóstico sea de ese Lead o no tenga Lead (una sesión que aún no dejaba su contacto):
-- `agendar_monitoria` solo liga el diagnóstico del Lead o el de la sesión que agenda, y esto descarta lo imposible sin costo.
--
-- Cierre de la política de `diagnostico` (criterio 12): se quita la cláusula del monitor de la cita individual
-- (privado.dicta_cita_con_diagnostico, que se borra) y la de privado.dicta_monitoria pasa a privado.dicta_grupal. `dicta_monitoria`
-- es verdadera para CUALQUIER monitoría del monitor y `diagnostico.id_monitoria` no está limitada a grupales (su llave solo exige
-- la misma materia; convertir una grupal en individual, RN-55, borra su fila de monitoria_grupal y deja el diagnóstico apuntándole):
-- por esa vía el monitor leería por la tabla, sin estado ni plazo, lo que este cierre prohíbe. `dicta_grupal` exige la fila de
-- monitoria_grupal, así que las grupales (HU-040) siguen abiertas y ninguna cita individual lo está. `dicta_monitoria` no se toca:
-- la usan otras políticas. El cierre va en la misma migración que la función, para que no exista un momento con las dos vías.
-- Parte de la política que dejó HU-095 (20261015090000_cerrar_lectura_de_diagnostico.sql, D-71 a): las ramas del dueño, la sesión
-- que hizo el diagnóstico y la cuenta de Estudiante de su Lead (privado.es_cuenta_de_lead, D-53 e y D-55 c), quedan igual.
--
-- No cambia `mi_agenda()` ni ninguna firma. No redefine funciones de otras HUs.
-- Idempotente.

-- ---------------------------------------------------------------------------
-- El plazo de una realizada
-- ---------------------------------------------------------------------------
-- Los días que una cita realizada sigue mostrando su diagnóstico al monitor (D-54 b). La app tiene la misma cifra
-- (DIAS_DE_VISTA_TRAS_REALIZADA en src/lib/agenda/reglas.ts); integracion/diagnostico-del-monitor.test.ts las compara.
create or replace function privado.dias_de_vista_tras_realizada()
returns integer
language sql
immutable
set search_path = ''
as $$ select 30 $$;

comment on function privado.dias_de_vista_tras_realizada() is
  'D-54 b: días, contados desde el fin programado de la sesión, que una cita realizada sigue mostrando su diagnóstico al monitor. Sin grants. HU-022.';
revoke all on function privado.dias_de_vista_tras_realizada() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- El núcleo: la hora como parámetro, sin grants
-- ---------------------------------------------------------------------------
create or replace function privado.diagnostico_de_mi_monitoria(p_id_monitoria uuid, p_ahora timestamptz)
returns table (
  fecha date,
  hora time,
  duracion_min integer,
  nombre_materia text,
  nombre_estudiante text,
  hay_diagnostico boolean,
  nombre_evaluacion text,
  fecha_realizacion timestamptz,
  respondidas integer,
  aciertos integer,
  repetido boolean,
  habilidades jsonb,
  errores jsonb,
  prerrequisitos jsonb,
  respuestas_autorizadas boolean,
  preguntas jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with cita as (
    select m.id, m.fecha, f.hora, f.duracion_min, ma.nombre as nombre_materia, l.nombre as nombre_estudiante,
           m.id_lead, m.id_diagnostico
    from public.monitoria m
    join public.franja f on f.id = m.id_franja
    join public.materia ma on ma.id = m.id_materia
    join public.lead l on l.id = m.id_lead
    where m.id = p_id_monitoria
      -- Solo el monitor de la cita: otro monitor, un admin, un Lead o una sesión anónima reciben lo mismo que por una cita que no existe.
      and m.id_monitor = (select auth.uid())
      -- Las grupales las decide HU-040: hoy responden como inexistentes.
      and not exists (select 1 from public.monitoria_grupal g where g.id_monitoria = m.id)
      and (
        -- Confirmada, también la que ya empezó y espera finalizarse: sin plazo.
        m.estado = 'confirmada'
        -- Realizada: mientras ahora < fin programado + 30 días, en tiempo absoluto (D-54 b). El fin es el programado, no
        -- fecha_finalizacion. make_interval(hours => ...) evita la ambigüedad de "30 días" en timestamptz.
        or (m.estado = 'realizada'
            and p_ahora < public.fin_programado(public.inicio_sesion(m.fecha, f.hora), f.duracion_min)
                          + make_interval(hours => 24 * privado.dias_de_vista_tras_realizada()))
      )
  ),
  dx as (
    select c.*, d.id as id_dx, e.nombre as nombre_evaluacion, d.fecha_realizacion, d.respondidas,
           d.aciertos::integer as aciertos, d.repetido, d.respuestas, d.resultado_por_habilidad as resultado,
           -- D-67: autorizó el Lead de la cita con el texto que nombra las respuestas, y el diagnóstico es suyo o no tiene Lead.
           (privado.autorizo_respuestas(c.id_lead) and (d.id_lead is null or d.id_lead = c.id_lead)) as autoriza
    from cita c
    left join public.diagnostico d on d.id = c.id_diagnostico
    left join public.evaluacion e on e.id = d.id_evaluacion and e.id_materia = d.id_materia
  )
  select
    x.fecha, x.hora, x.duracion_min, x.nombre_materia, x.nombre_estudiante,
    x.id_dx is not null, x.nombre_evaluacion, x.fecha_realizacion, x.respondidas, x.aciertos, x.repetido,
    -- Habilidades: las de la Evaluación, en el orden guardado, con el nivel guardado (nada se recalcula).
    case when x.id_dx is null then null else (
      select coalesce(jsonb_agg(jsonb_build_object(
               'descripcion', t.h -> 'descripcion', 'nivel', t.h -> 'nivel',
               'respuestas', t.h -> 'respuestas', 'aciertos', t.h -> 'aciertos') order by t.o), '[]'::jsonb)
      from jsonb_array_elements(x.resultado -> 'habilidades') with ordinality as t(h, o)) end,
    -- Errores: primero los confirmados, luego en el orden guardado. Si la descripción de la habilidad cayó a su clave
    -- (resultado.ts), no hay descripción: no se muestra la clave.
    case when x.id_dx is null then null else (
      select coalesce(jsonb_agg(jsonb_build_object(
               'titulo', t.e -> 'texto', 'estado', t.e -> 'estado', 'veces', t.e -> 'veces',
               'descripcionDeLaHabilidad', case when t.e ->> 'descripcionHabilidad' is distinct from t.e ->> 'habilidad'
                                               then t.e -> 'descripcionHabilidad' end,
               'detalles', coalesce(t.e -> 'detalles', '[]'::jsonb))
             order by (t.e ->> 'estado' = 'confirmada') desc nulls last, t.o), '[]'::jsonb)
      from jsonb_array_elements(x.resultado -> 'errores') with ordinality as t(e, o)) end,
    -- Prerrequisitos: sin repetir por (materia, habilidad), en el orden de la primera aparición.
    case when x.id_dx is null then null else (
      select coalesce(jsonb_agg(jsonb_build_object('materia', u.materia, 'descripcion', u.descripcion) order by u.o), '[]'::jsonb)
      from (select distinct on (t.p ->> 'materia', t.p ->> 'habilidad')
                   t.p -> 'materia' as materia, t.p -> 'descripcion' as descripcion, t.o
            from jsonb_array_elements(x.resultado -> 'prerrequisitos') with ordinality as t(p, o)
            order by t.p ->> 'materia', t.p ->> 'habilidad', t.o) u) end,
    case when x.id_dx is null then null else x.autoriza end,
    -- Preguntas: solo si el Lead de la cita autorizó con `v2`. Las opciones salen en el orden en que las vio la persona
    -- (orden[k - 1] es la letra del banco de la posición k) y las letras elegida y correcta, ya en ese orden. De la copia no
    -- sale ninguna clave interna ni, por opción, `correcta`, `misconcepcion` ni `error`.
    case when x.id_dx is null or not x.autoriza then null else (
      select coalesce(jsonb_agg(jsonb_build_object(
               'enunciado', t.r -> 'enunciado',
               'opciones', (select jsonb_agg(jsonb_build_object('letra', chr(64 + g.k),
                              'texto', t.r -> 'opciones' -> (ascii(t.r -> 'orden' ->> (g.k - 1)) - 65) -> 'texto') order by g.k)
                            from generate_series(1, 4) as g(k)),
               'letraElegida', t.r -> 'letraElegida',
               'letraCorrecta', (select chr(64 + g.k) from generate_series(1, 4) as g(k)
                                 where (t.r -> 'opciones' -> (ascii(t.r -> 'orden' ->> (g.k - 1)) - 65) -> 'correcta') = 'true'::jsonb
                                 order by g.k limit 1),
               'solucion', t.r -> 'solucion') order by t.o), '[]'::jsonb)
      from jsonb_array_elements(x.respuestas) with ordinality as t(r, o)) end
  from dx x;
$$;

comment on function privado.diagnostico_de_mi_monitoria(uuid, timestamptz) is
  'La cita del monitor que llama (auth.uid()) y, si tiene diagnóstico ligado, su proyección: habilidades, errores, prerrequisitos y, si el Lead de la cita autorizó con v2, las preguntas. Sin filas si la cita no existe, no es suya, es grupal o su estado no se ve (confirmada, o realizada hasta 30 días después del fin). Con la hora como parámetro: sin grants. HU-022.';
revoke all on function privado.diagnostico_de_mi_monitoria(uuid, timestamptz) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- La capa que pone la hora de la base
-- ---------------------------------------------------------------------------
create or replace function privado.diagnostico_de_mi_monitoria_ahora(p_id_monitoria uuid)
returns table (
  fecha date,
  hora time,
  duracion_min integer,
  nombre_materia text,
  nombre_estudiante text,
  hay_diagnostico boolean,
  nombre_evaluacion text,
  fecha_realizacion timestamptz,
  respondidas integer,
  aciertos integer,
  repetido boolean,
  habilidades jsonb,
  errores jsonb,
  prerrequisitos jsonb,
  respuestas_autorizadas boolean,
  preguntas jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.* from privado.diagnostico_de_mi_monitoria(p_id_monitoria, now()) r;
$$;

comment on function privado.diagnostico_de_mi_monitoria_ahora(uuid) is
  'privado.diagnostico_de_mi_monitoria con la hora de la base: nadie con sesión elige la hora. La ejecutan las sesiones a través de la puerta pública. HU-022.';
revoke all on function privado.diagnostico_de_mi_monitoria_ahora(uuid) from public, anon, authenticated, service_role;
grant execute on function privado.diagnostico_de_mi_monitoria_ahora(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- La puerta en la Data API
-- ---------------------------------------------------------------------------
create or replace function public.diagnostico_de_mi_monitoria(p_id_monitoria uuid)
returns table (
  fecha date,
  hora time,
  duracion_min integer,
  nombre_materia text,
  nombre_estudiante text,
  hay_diagnostico boolean,
  nombre_evaluacion text,
  fecha_realizacion timestamptz,
  respondidas integer,
  aciertos integer,
  repetido boolean,
  habilidades jsonb,
  errores jsonb,
  prerrequisitos jsonb,
  respuestas_autorizadas boolean,
  preguntas jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.* from privado.diagnostico_de_mi_monitoria_ahora(p_id_monitoria) r;
$$;

comment on function public.diagnostico_de_mi_monitoria(uuid) is
  'El diagnóstico ligado a una cita del monitor que llama, solo lo que la pantalla muestra, o ninguna fila si la cita no se ve (no existe, no es suya, es grupal, está pendiente de pago o cancelada, o es una realizada de hace más de 30 días). Solo con sesión. HU-022.';
revoke all on function public.diagnostico_de_mi_monitoria(uuid) from public, anon, authenticated, service_role;
grant execute on function public.diagnostico_de_mi_monitoria(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Cierre de la política de lectura de diagnostico
-- ---------------------------------------------------------------------------
-- Las grupales que dicta el monitor (HU-040): la monitoría tiene fila en monitoria_grupal. A diferencia de dicta_monitoria, no
-- acepta una cita individual. La ejecuta quien lee (la política corre con sus permisos), así que lleva el grant.
create or replace function privado.dicta_grupal(p_id_monitoria uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.monitoria m
    join public.monitoria_grupal g on g.id_monitoria = m.id
    where m.id = p_id_monitoria and m.id_monitor = (select auth.uid())
  );
$$;

comment on function privado.dicta_grupal(uuid) is
  'Si la monitoría es una grupal (tiene fila en monitoria_grupal) del monitor que llama. La usa la política de lectura de diagnostico: las grupales (HU-040) siguen abiertas y ninguna cita individual lo está. HU-022.';
revoke all on function privado.dicta_grupal(uuid) from public, anon, authenticated, service_role;
grant execute on function privado.dicta_grupal(uuid) to authenticated;

-- La misma política de HU-095 sin la cláusula del monitor de la cita individual y con las grupales por dicta_grupal. Una sola
-- política permisiva por tabla y acción.
drop policy if exists "dueno, monitor o admin leen" on public.diagnostico;
create policy "dueno, monitor o admin leen" on public.diagnostico
  for select to authenticated
  using (
    (select privado.es_admin())
    or id_sesion_anonima = (select auth.uid())
    -- D-53 e: la cuenta de Estudiante de su Lead (D-55 c), no privado.es_mi_lead (HU-095).
    or (id_lead is not null and privado.es_cuenta_de_lead(id_lead))
    or (id_monitoria is not null and privado.dicta_grupal(id_monitoria))
  );

comment on policy "dueno, monitor o admin leen" on public.diagnostico is
  'Leen el diagnóstico: la sesión que lo hizo, la cuenta de Estudiante de su Lead (D-53 e, D-55 c), el monitor de la grupal que apunta a él y el admin. El monitor de una cita individual lo lee con public.diagnostico_de_mi_monitoria. HU-095, HU-022.';

-- Después de la política: ya nada depende de ella. Solo la usaba esa política.
drop function if exists privado.dicta_cita_con_diagnostico(uuid);
