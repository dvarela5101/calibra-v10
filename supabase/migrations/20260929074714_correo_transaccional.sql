-- Registro de envíos de correo. HU-006.
--
-- Una fila por correo que la app manda: a quién, con qué plantilla, cuándo y con qué resultado.
-- NO guarda el cuerpo ni los datos de la plantilla: esos traen enlaces con token y datos de
-- personas, y el registro solo debe servir para saber qué salió y qué falló.
--
-- La `clave` identifica el correo, no el intento: plantilla más la entidad que lo motiva (por
-- ejemplo `solicitud_llave_reembolso:<id del reembolso>`). Es única, y de ahí sale que un reintento
-- no duplique el correo: si la fila ya está `enviado`, no se vuelve a mandar. También es la
-- Idempotency-Key que se le pasa al proveedor, por si el envío llegó pero la respuesta no.
-- Resend acepta claves de 1 a 256 caracteres y las recuerda 24 horas.
--
-- Escribe solo el servidor con la llave secreta (service_role). Los admins leen el registro para
-- saber qué pasó con un correo; nadie más, porque tiene los correos de las personas.
-- Idempotente.

do $$ begin
  create type public.estado_correo as enum ('pendiente', 'enviado', 'fallido');
exception when duplicate_object then null; end $$;

create table if not exists public.correo_envio (
  id uuid primary key default gen_random_uuid(),
  clave text not null,
  plantilla text not null,
  destinatario text not null,
  estado public.estado_correo not null default 'pendiente',
  intentos integer not null default 0,
  ultimo_error text,
  id_proveedor text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  enviado_en timestamptz,
  constraint correo_envio_clave_key unique (clave),
  constraint correo_envio_clave_larga check (char_length(clave) between 1 and 256),
  constraint correo_envio_plantilla_con_texto check (char_length(plantilla) > 0),
  constraint correo_envio_destinatario_con_arroba check (destinatario like '%_@_%'),
  constraint correo_envio_intentos_no_negativos check (intentos >= 0),
  -- Un correo enviado tiene su fecha; uno que no se envió no la tiene.
  constraint correo_envio_enviado_con_fecha check ((estado = 'enviado') = (enviado_en is not null)),
  -- El error es un mensaje corto para diagnosticar, no un volcado de la respuesta del proveedor.
  constraint correo_envio_error_corto check (ultimo_error is null or char_length(ultimo_error) <= 500)
);

comment on table public.correo_envio is
  'Registro de correos enviados (destinatario, plantilla, fecha, resultado). Sin cuerpo ni datos. HU-006.';

-- Los que no llegaron a enviarse son los que interesa encontrar rápido.
create index if not exists correo_envio_sin_enviar_idx on public.correo_envio (estado, actualizado_en)
  where estado <> 'enviado';

alter table public.correo_envio enable row level security;
revoke all on table public.correo_envio from public, anon, authenticated, service_role;

drop policy if exists "admin lee" on public.correo_envio;
create policy "admin lee" on public.correo_envio
  for select to authenticated
  using ((select privado.es_admin()));

-- authenticated solo lee (y la política decide quién); service_role escribe (auto_expose_new_tables = false).
grant select on table public.correo_envio to authenticated;
grant select, insert, update, delete on table public.correo_envio to service_role;
