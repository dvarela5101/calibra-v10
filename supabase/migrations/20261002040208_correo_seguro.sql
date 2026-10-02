-- Correo seguro: una sola regla para todos los correos que guarda la base. HU-070.
--
-- Un correo como `ana@x.co?bcc=otro@y.co` pasaba la validación compartida (`esCorreo`, HU-006): rechazaba
-- espacios, comas, comillas y paréntesis, pero no `?`, `&`, `=`, `#` ni `/`. Puesto en un enlace `mailto:`, eso se
-- lee como copia oculta o cuerpo del mensaje. HU-062 ya exigía una regla estricta, pero solo en
-- `solicitud_monitor`; esta migración la vuelve la de todas las tablas que guardan un correo.
--
--   * La regla vive en `privado.es_correo_seguro()` y es la misma de `PATRON_DE_CORREO` en
--     src/lib/correo/contacto.ts (una prueba de Vitest comprueba que las dos expresiones no se separen): hasta 254
--     caracteres; antes de la arroba, solo letras, dígitos y . _ % + ' - ; después, etiquetas de letras, dígitos y
--     guiones separadas por puntos, con al menos un punto y ninguna etiqueta vacía. Mayúsculas y minúsculas valen
--     igual: pasar a minúsculas es asunto de quien guarda el correo, y lo exigen aparte `lead_correo_normalizado`,
--     `invitacion_monitor_correo_normalizado` y `solicitud_monitor_correo`.
--   * Cada tabla con un correo lo exige con un check: admin.correo, lead.correo (si lo hay),
--     monitor_privado.correo, invitacion_monitor.correo, correo_envio.destinatario y solicitud_monitor.correo (que
--     reemplaza su check propio, y sigue pidiendo minúsculas). `pago.contacto` no se toca: es un correo o un teléfono
--     (RN-44), y la regla de correo no le cabe.
--   * Postgres evalúa un check con los permisos de quien escribe la fila, por eso la función lleva `execute` para
--     anon, authenticated y service_role. Es pura (no lee ninguna tabla) y la Data API no expone `privado`: nadie
--     la llama desde afuera.
--   * Antes de agregar los checks se cuentan las filas que no cumplen la regla. Si hay alguna, la migración se
--     detiene y dice dónde: no se reescribe ni se borra ningún dato por su cuenta. Se corrigen a mano y se vuelve a
--     aplicar.
-- Idempotente.

create or replace function privado.es_correo_seguro(p_correo text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_correo is not null
    and char_length(p_correo) <= 254
    and p_correo ~ '^[A-Za-z0-9._%+''-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$';
$$;
comment on function privado.es_correo_seguro(text) is
  'La regla de correo de Calibra (HU-070): letras, dígitos y . _ % + '' - antes de la arroba y un dominio de letras, dígitos, guiones y puntos. Misma expresión que PATRON_DE_CORREO en src/lib/correo/contacto.ts.';
revoke all on function privado.es_correo_seguro(text) from public;
grant execute on function privado.es_correo_seguro(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Antes de exigirla: ¿la cumplen los datos que ya hay?
-- ---------------------------------------------------------------------------
do $$
declare
  v_tabla text;
  v_columna text;
  v_cuantas bigint;
  v_problemas text := '';
begin
  for v_tabla, v_columna in
    select t.tabla, t.columna
    from (values
      ('admin', 'correo'),
      ('lead', 'correo'),
      ('monitor_privado', 'correo'),
      ('invitacion_monitor', 'correo'),
      ('correo_envio', 'destinatario'),
      ('solicitud_monitor', 'correo')
    ) as t (tabla, columna)
  loop
    execute format(
      'select count(*) from public.%I where %I is not null and not privado.es_correo_seguro(%I)',
      v_tabla, v_columna, v_columna
    ) into v_cuantas;
    if v_cuantas > 0 then
      v_problemas := v_problemas || format(' public.%s.%s: %s fila(s).', v_tabla, v_columna, v_cuantas);
    end if;
  end loop;

  if v_problemas <> '' then
    raise exception 'No se puede exigir el correo seguro (HU-070): hay correos que no cumplen la regla.%', v_problemas
      using errcode = '23514',
            hint = 'Corrige esas filas (por ejemplo: select * from public.<tabla> where not privado.es_correo_seguro(<columna>)) y vuelve a aplicar la migración.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Los checks
-- ---------------------------------------------------------------------------
alter table public.admin drop constraint if exists admin_correo_seguro;
alter table public.admin add constraint admin_correo_seguro
  check (privado.es_correo_seguro(correo));

-- El correo del Lead es opcional (RN-11): puede dejar solo el teléfono.
alter table public.lead drop constraint if exists lead_correo_seguro;
alter table public.lead add constraint lead_correo_seguro
  check (correo is null or privado.es_correo_seguro(correo));

alter table public.monitor_privado drop constraint if exists monitor_privado_correo_seguro;
alter table public.monitor_privado add constraint monitor_privado_correo_seguro
  check (privado.es_correo_seguro(correo));

alter table public.invitacion_monitor drop constraint if exists invitacion_monitor_correo_seguro;
alter table public.invitacion_monitor add constraint invitacion_monitor_correo_seguro
  check (privado.es_correo_seguro(correo));

alter table public.correo_envio drop constraint if exists correo_envio_destinatario_seguro;
alter table public.correo_envio add constraint correo_envio_destinatario_seguro
  check (privado.es_correo_seguro(destinatario));

-- Reemplaza el check de HU-062: la misma regla que las demás tablas, y el correo sigue llegando en minúsculas.
alter table public.solicitud_monitor drop constraint if exists solicitud_monitor_correo;
alter table public.solicitud_monitor add constraint solicitud_monitor_correo
  check (correo = lower(correo) and privado.es_correo_seguro(correo));
