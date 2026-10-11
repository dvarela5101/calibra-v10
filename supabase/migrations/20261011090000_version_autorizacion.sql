-- Versión del texto de la autorización de datos con que autorizó cada Lead. HU-087.
--
-- D-54 c (10-oct-2026): el monitor ve las respuestas del diagnóstico de su estudiante (HU-022). Para eso la autorización
-- pasa de «compartir el resultado de mi diagnóstico» (v1) a «compartir mis respuestas y el resultado de mi diagnóstico»
-- (v2). D-67 (10-oct-2026): con v1 el monitor ve el resultado y no las respuestas, hasta que la persona autorice con el
-- texto nuevo. El texto legal final lo valida asesoría.
--
-- Diseño (registro de HU-087):
--   * lead.version_autorizacion, con default 'v1': los Leads que ya existen quedan con la versión anterior. La versión
--     la pone el servidor (VERSION_AUTORIZACION en src/lib/privacidad/consentimiento.ts), nunca el navegador. No se
--     deduce de fecha_consentimiento: una base restaurada o una fecha mal puesta cambiaría quién ve qué.
--   * registrar_lead gana p_version_autorizacion al final, con default 'v1': quien no lo pase deja al Lead del lado
--     seguro (sin respuestas para el monitor). Cambia la firma, así que se borra la de 7 parámetros.
--   * privado.autorizo_respuestas(id_lead), para las funciones de privado que entregan el diagnóstico al monitor
--     (HU-022). No va en la Data API.
-- Redefine public.registrar_lead (20260930172923_lead_al_agendar.sql): parte de esa versión, la única en main.
-- Idempotente.

-- ---------------------------------------------------------------------------
-- La versión en el Lead
-- ---------------------------------------------------------------------------
alter table public.lead add column if not exists version_autorizacion text not null default 'v1';

alter table public.lead drop constraint if exists lead_version_autorizacion;
alter table public.lead
  add constraint lead_version_autorizacion check (version_autorizacion in ('v1', 'v2'));

comment on column public.lead.version_autorizacion is
  'Versión del texto de la autorización de datos con que autorizó (RN-13). v1: compartir el resultado del diagnóstico con el monitor. v2: compartir las respuestas y el resultado (D-54 c). La pone el servidor. HU-087.';

-- ---------------------------------------------------------------------------
-- registrar_lead con la versión
-- ---------------------------------------------------------------------------
drop function if exists public.registrar_lead(uuid, text, text, text, boolean, timestamptz, text);

-- En una sola transacción: crea el Lead de la sesión y le liga los diagnósticos que la sesión hizo antes
-- (P-33). Si el correo ya es de otro Lead (`lead_correo_key`) o la sesión ya tiene uno (lo creó ella,
-- confirmó el correo de otro o es un Estudiante), lanza 23505 y no se crea nada: con el correo ajeno, el
-- servidor manda el enlace de verificación. Corre con los permisos de quien llama y solo la llama
-- service_role, después de comprobar la sesión.
--
-- Una sesión, un Lead: crear y confirmar toman el mismo candado por sesión, así que dos pestañas que
-- dejan el contacto y confirman un enlace a la vez no dejan a la sesión con dos Leads.
--
-- HU-087: guarda con qué versión del texto autorizó (p_version_autorizacion, 'v1' si no se pasa).
create or replace function public.registrar_lead(
  p_id_sesion uuid,
  p_nombre text,
  p_correo text,
  p_numero_telefono text,
  p_acepta_contacto boolean,
  p_fecha_consentimiento timestamptz,
  p_origen text,
  p_version_autorizacion text default 'v1'
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id_lead uuid;
begin
  perform pg_advisory_xact_lock(6801, hashtext(p_id_sesion::text));
  if exists (select 1 from public.lead_sesion s where s.id_sesion = p_id_sesion)
     or exists (select 1 from public.estudiante e where e.id = p_id_sesion) then
    raise exception 'La sesión ya tiene un Lead.' using errcode = 'unique_violation';
  end if;

  insert into public.lead (
    id_sesion_anonima, nombre, correo, numero_telefono,
    acepta_tratamiento_datos, fecha_consentimiento, acepta_contacto, origen, version_autorizacion
  ) values (
    p_id_sesion, btrim(p_nombre), lower(btrim(p_correo)), nullif(btrim(p_numero_telefono), ''),
    true, p_fecha_consentimiento, p_acepta_contacto, nullif(btrim(p_origen), ''), p_version_autorizacion
  )
  returning id into v_id_lead;

  update public.diagnostico d
  set id_lead = v_id_lead
  where d.id_sesion_anonima = p_id_sesion and d.id_lead is null;

  return v_id_lead;
end;
$$;

revoke all on function public.registrar_lead(uuid, text, text, text, boolean, timestamptz, text, text) from public, anon, authenticated, service_role;
grant execute on function public.registrar_lead(uuid, text, text, text, boolean, timestamptz, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- ¿Autorizó que el monitor vea sus respuestas? (D-67)
-- ---------------------------------------------------------------------------
-- true solo si el Lead autorizó con el texto que nombra las respuestas (v2). Un Lead que no existe da false. Para las
-- funciones de privado que entregan el diagnóstico al monitor (HU-022): ningún rol de la Data API la ejecuta.
create or replace function privado.autorizo_respuestas(p_id_lead uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select l.version_autorizacion = 'v2' from public.lead l where l.id = p_id_lead), false);
$$;

comment on function privado.autorizo_respuestas(uuid) is
  'D-67: si el Lead autorizó con el texto v2 (el monitor ve sus respuestas). false con v1 o si el Lead no existe. Solo para otras funciones de privado (HU-022). HU-087.';

revoke all on function privado.autorizo_respuestas(uuid) from public, anon, authenticated, service_role;
