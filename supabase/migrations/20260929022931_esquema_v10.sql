-- Modelo de dominio v10 (calibra_reglas_negocio.md, secciones 5, 10, 11 y 14). HU-002.
--
-- Idempotente: se puede volver a aplicar sobre una base que ya la tiene.
-- Convenciones:
--   * Montos en pesos enteros (integer); fechas con zona (timestamptz).
--   * Franja.dia es el día ISO (1 = lunes ... 7 = domingo) y Franja.hora es time.
--   * Las cuentas (estudiante, monitor, admin) usan el id del usuario de Supabase Auth.
--   * Los atributos derivados (/x) no se guardan: los calcula HU-003.
--   * Tokens de enlace: 256 bits aleatorios en hex (la sección 14 pide >= 128 bits).
--   * monitoria.id_monitor y diagnostico.id_materia son copias que un trigger
--     llena desde franja y evaluacion. Existen para que RN-22 y RN-15 se
--     cumplan con llaves foráneas compuestas, sin depender de la app.

create extension if not exists pgcrypto with schema extensions;

-- Esquema no expuesto por la Data API: triggers y funciones auxiliares.
create schema if not exists privado;
revoke all on schema privado from public;

-- ---------------------------------------------------------------------------
-- Enums (sección 5)
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.estado_monitoria as enum ('pendiente_pago', 'confirmada', 'realizada', 'cancelada');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.estado_pago as enum ('en_revision', 'aprobado', 'rechazado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.estado_reembolso as enum ('esperando_llave', 'pendiente', 'reembolsado');
exception when duplicate_object then null; end $$;

-- 'anulado' viene de P-28: desembolso de una monitoría cancelada después de realizada.
do $$ begin
  create type public.estado_desembolso as enum ('pendiente', 'desembolsado', 'anulado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.estado_reporte as enum ('en_revision', 'aceptado', 'rechazado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.estado_lead as enum ('nuevo', 'contactado', 'descartado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.motivo_cancelacion as enum (
    'reserva_expirada', 'pago_rechazado', 'estudiante', 'monitor_no_asistio', 'diferencia_no_cubierta'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.modalidad_pago as enum ('unico', 'dividido');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Personas y cuentas
-- ---------------------------------------------------------------------------
create table if not exists public.admin (
  id uuid primary key references auth.users (id) on delete cascade,
  nombre text not null,
  correo text not null,
  orden_revision integer not null,
  constraint admin_orden_revision_key unique (orden_revision) deferrable initially immediate
);
comment on table public.admin is 'Personal de la plataforma. orden_revision es su turno en la lista rotativa (RN-07).';

create table if not exists public.lead (
  id uuid primary key default gen_random_uuid(),
  id_sesion_anonima uuid references auth.users (id) on delete set null,
  nombre text not null,
  numero_telefono text,
  correo text,
  acepta_tratamiento_datos boolean not null,
  fecha_consentimiento timestamptz not null,
  acepta_contacto boolean not null default false,
  estado public.estado_lead not null default 'nuevo',
  origen text,
  fecha_creacion timestamptz not null default now(),
  -- RN-13: sin autorización de tratamiento de datos no hay Lead.
  constraint lead_autoriza_datos check (acepta_tratamiento_datos),
  -- RN-11: correo y/o teléfono.
  constraint lead_tiene_contacto check (correo is not null or numero_telefono is not null)
);
comment on table public.lead is 'Persona contactable sin cuenta (RN-01). Datos personales: sin lectura pública.';
create index if not exists lead_id_sesion_anonima_idx on public.lead (id_sesion_anonima);

create table if not exists public.estudiante (
  id uuid primary key references auth.users (id) on delete cascade,
  id_lead uuid not null references public.lead (id),
  fecha_registro timestamptz not null default now(),
  constraint estudiante_id_lead_key unique (id_lead)
);
comment on table public.estudiante is 'Lead que creó cuenta (RN-02). Nombre y contacto siguen en lead.';

-- Monitor se parte en dos: lo público (nombre) y lo privado (contacto y llave),
-- porque RLS filtra filas, no columnas, y el nombre se muestra a cualquiera.
create table if not exists public.monitor (
  id uuid primary key references auth.users (id) on delete cascade,
  nombre text not null
);
comment on table public.monitor is 'Datos públicos del monitor. El contacto y la llave están en monitor_privado.';

create table if not exists public.monitor_privado (
  id_monitor uuid primary key references public.monitor (id) on delete cascade,
  numero_telefono text not null,
  correo text not null,
  llave text not null
);
comment on table public.monitor_privado is 'Contacto y llave de desembolso del monitor (RN-06). Solo el monitor y los admins.';

-- P-01: los campos del perfil no están definidos; la tabla nace solo con la llave.
create table if not exists public.perfil_monitor (
  id_monitor uuid primary key references public.monitor (id) on delete cascade
);
comment on table public.perfil_monitor is 'Perfil 1:1 del monitor (RN-08). Campos pendientes (P-01).';

-- ---------------------------------------------------------------------------
-- Materias, evaluaciones y certificados
-- ---------------------------------------------------------------------------
create table if not exists public.materia (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  codigo text not null,
  constraint materia_codigo_key unique (codigo)
);

create table if not exists public.evaluacion (
  id uuid primary key default gen_random_uuid(),
  id_materia uuid not null references public.materia (id),
  semana integer not null,
  nombre text not null,
  acumulativo boolean not null default false,
  constraint evaluacion_semana_positiva check (semana > 0),
  -- Destino de la llave compuesta de diagnostico (RN-15).
  constraint evaluacion_id_materia_key unique (id, id_materia)
);
create index if not exists evaluacion_id_materia_idx on public.evaluacion (id_materia);

create table if not exists public.certificado (
  id uuid primary key default gen_random_uuid(),
  id_monitor uuid not null references public.monitor (id),
  id_materia uuid not null references public.materia (id),
  id_admin uuid not null references public.admin (id),
  fecha_emision date not null default (now() at time zone 'America/Bogota')::date,
  -- RN-21: como máximo un certificado por monitor y materia.
  constraint certificado_monitor_materia_key unique (id_monitor, id_materia)
);
create index if not exists certificado_id_materia_idx on public.certificado (id_materia);
create index if not exists certificado_id_admin_idx on public.certificado (id_admin);

-- ---------------------------------------------------------------------------
-- Franjas y monitorías
-- ---------------------------------------------------------------------------
create table if not exists public.franja (
  id uuid primary key default gen_random_uuid(),
  id_monitor uuid not null references public.monitor (id),
  dia smallint not null,
  hora time not null,
  presencial boolean not null,
  precio integer not null,
  duracion_min integer not null,
  constraint franja_dia_iso check (dia between 1 and 7),
  constraint franja_precio_positivo check (precio > 0),
  constraint franja_duracion_positiva check (duracion_min > 0),
  -- Destino de la llave compuesta de monitoria.
  constraint franja_id_monitor_key unique (id, id_monitor)
);
create index if not exists franja_id_monitor_idx on public.franja (id_monitor);

create table if not exists public.monitoria (
  id uuid primary key default gen_random_uuid(),
  id_franja uuid not null,
  id_monitor uuid not null,
  id_materia uuid not null,
  id_lead uuid not null references public.lead (id),
  fecha date not null,
  estado public.estado_monitoria not null default 'pendiente_pago',
  valor_total integer not null,
  fecha_creacion timestamptz not null default now(),
  motivo_cancelacion public.motivo_cancelacion,
  fecha_finalizacion timestamptz,
  constraint monitoria_valor_positivo check (valor_total > 0),
  constraint monitoria_motivo_solo_si_cancelada check ((estado = 'cancelada') = (motivo_cancelacion is not null)),
  constraint monitoria_realizada_con_fecha check (estado <> 'realizada' or fecha_finalizacion is not null),
  constraint monitoria_franja_fk foreign key (id_franja, id_monitor) references public.franja (id, id_monitor),
  -- RN-22: solo materias en las que el monitor de la franja tiene certificado.
  constraint monitoria_certificado_fk foreign key (id_monitor, id_materia)
    references public.certificado (id_monitor, id_materia),
  -- Destino de la llave compuesta de diagnostico (RN-15).
  constraint monitoria_id_materia_key unique (id, id_materia)
);
-- RN-33: una franja no tiene dos monitorías activas en la misma fecha.
create unique index if not exists monitoria_franja_fecha_activa_key
  on public.monitoria (id_franja, fecha) where estado <> 'cancelada';
create index if not exists monitoria_id_franja_monitor_idx on public.monitoria (id_franja, id_monitor);
create index if not exists monitoria_id_monitor_materia_idx on public.monitoria (id_monitor, id_materia);
create index if not exists monitoria_id_lead_idx on public.monitoria (id_lead);

-- Sección 14: especialización como tabla hija con la misma llave.
-- Convertir una grupal en individual es borrar esta fila (RN-55).
create table if not exists public.monitoria_grupal (
  id_monitoria uuid primary key references public.monitoria (id) on delete cascade,
  cupos integer not null,
  modalidad_pago public.modalidad_pago not null,
  token_enlace text not null default encode(extensions.gen_random_bytes(32), 'hex'),
  precio_por_persona integer not null,
  constraint monitoria_grupal_cupos_minimos check (cupos >= 2),
  constraint monitoria_grupal_precio_positivo check (precio_por_persona > 0),
  constraint monitoria_grupal_token_enlace_key unique (token_enlace)
);

-- ---------------------------------------------------------------------------
-- Diagnóstico
-- ---------------------------------------------------------------------------
create table if not exists public.diagnostico (
  id uuid primary key default gen_random_uuid(),
  -- P-33: nulo hasta que la persona deja su contacto; mientras tanto la identifica la sesión anónima.
  id_lead uuid references public.lead (id) on delete cascade,
  id_sesion_anonima uuid references auth.users (id) on delete set null,
  id_evaluacion uuid not null,
  id_materia uuid not null,
  id_monitoria uuid,
  respuestas jsonb not null,
  puntaje numeric(5, 2) not null,
  resultado_por_tema jsonb not null,
  fecha_realizacion timestamptz not null default now(),
  token_recuperacion text not null default encode(extensions.gen_random_bytes(32), 'hex'),
  constraint diagnostico_tiene_dueno check (id_lead is not null or id_sesion_anonima is not null),
  constraint diagnostico_token_recuperacion_key unique (token_recuperacion),
  constraint diagnostico_evaluacion_fk foreign key (id_evaluacion, id_materia)
    references public.evaluacion (id, id_materia),
  -- RN-15: si orienta una monitoría, la evaluación es de la misma materia.
  constraint diagnostico_monitoria_fk foreign key (id_monitoria, id_materia)
    references public.monitoria (id, id_materia)
);
create index if not exists diagnostico_id_lead_idx on public.diagnostico (id_lead);
create index if not exists diagnostico_id_sesion_anonima_idx on public.diagnostico (id_sesion_anonima);
create index if not exists diagnostico_id_evaluacion_idx on public.diagnostico (id_evaluacion, id_materia);
create index if not exists diagnostico_id_monitoria_idx on public.diagnostico (id_monitoria, id_materia);

-- ---------------------------------------------------------------------------
-- Dinero: pagos, desembolsos y reembolsos
-- ---------------------------------------------------------------------------
create table if not exists public.pago (
  id uuid primary key default gen_random_uuid(),
  id_monitoria uuid not null references public.monitoria (id),
  monto integer not null,
  nombre_pagador text not null,
  contacto text not null,
  estado public.estado_pago not null default 'en_revision',
  fecha_pago timestamptz not null default now(),
  id_admin uuid not null references public.admin (id),
  fecha_asignacion timestamptz not null default now(),
  fecha_revision timestamptz,
  referencia_transferencia text,
  comprobante text not null,
  constraint pago_monto_positivo check (monto > 0),
  constraint pago_revision_con_fecha check ((estado = 'en_revision') = (fecha_revision is null))
);
create index if not exists pago_id_monitoria_idx on public.pago (id_monitoria);
create index if not exists pago_id_admin_idx on public.pago (id_admin);

-- id_admin es nulo hasta ejecutarlo: RN-80 dice que el admin se registra al ejecutar,
-- y la relación Admin — Desembolso es 0..1 (sección 10).
create table if not exists public.desembolso (
  id uuid primary key default gen_random_uuid(),
  id_monitoria uuid not null references public.monitoria (id),
  id_admin uuid references public.admin (id),
  monto_bruto integer not null,
  comision integer not null,
  monto_neto integer not null,
  llave_destino text not null,
  estado public.estado_desembolso not null default 'pendiente',
  fecha_generacion timestamptz not null default now(),
  fecha_desembolso timestamptz,
  referencia_transferencia text,
  constraint desembolso_id_monitoria_key unique (id_monitoria),
  constraint desembolso_montos_no_negativos check (monto_bruto >= 0 and comision >= 0),
  constraint desembolso_neto check (monto_neto = monto_bruto - comision),
  constraint desembolso_ejecutado_completo check (
    estado <> 'desembolsado'
    or (id_admin is not null and fecha_desembolso is not null and referencia_transferencia is not null)
  )
);
create index if not exists desembolso_id_admin_idx on public.desembolso (id_admin);

create table if not exists public.reembolso (
  id uuid primary key default gen_random_uuid(),
  id_pago uuid not null references public.pago (id),
  id_admin uuid not null references public.admin (id),
  monto integer not null,
  motivo text not null,
  llave_destino text,
  estado public.estado_reembolso not null default 'esperando_llave',
  fecha_generacion timestamptz not null default now(),
  fecha_reembolso timestamptz,
  referencia_transferencia text,
  constraint reembolso_id_pago_key unique (id_pago),
  constraint reembolso_monto_positivo check (monto > 0),
  constraint reembolso_llave_segun_estado check ((estado = 'esperando_llave') = (llave_destino is null)),
  constraint reembolso_ejecutado_completo check (
    estado <> 'reembolsado' or (fecha_reembolso is not null and referencia_transferencia is not null)
  )
);
create index if not exists reembolso_id_admin_idx on public.reembolso (id_admin);

-- ---------------------------------------------------------------------------
-- Inasistencia y reseñas
-- ---------------------------------------------------------------------------
create table if not exists public.reporte_inasistencia (
  id uuid primary key default gen_random_uuid(),
  id_monitoria uuid not null references public.monitoria (id),
  id_admin uuid not null references public.admin (id),
  fecha_reporte timestamptz not null default now(),
  estado public.estado_reporte not null default 'en_revision',
  fecha_decision timestamptz,
  observaciones text,
  constraint reporte_inasistencia_id_monitoria_key unique (id_monitoria),
  constraint reporte_decision_con_fecha check ((estado = 'en_revision') = (fecha_decision is null))
);
create index if not exists reporte_inasistencia_id_admin_idx on public.reporte_inasistencia (id_admin);

-- La escala de calificacion está pendiente (P-03): no se restringe todavía.
create table if not exists public.resena (
  id uuid primary key default gen_random_uuid(),
  id_pago uuid not null references public.pago (id),
  calificacion integer not null,
  comentario text,
  fecha timestamptz not null default now(),
  constraint resena_id_pago_key unique (id_pago)
);

-- ---------------------------------------------------------------------------
-- Triggers que llenan las copias usadas por las llaves compuestas
-- ---------------------------------------------------------------------------
create or replace function privado.completar_monitoria()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_id_monitor uuid;
  v_dia smallint;
begin
  select f.id_monitor, f.dia into v_id_monitor, v_dia
  from public.franja f
  where f.id = new.id_franja;

  if not found then
    return new; -- la llave foránea reporta la franja inexistente
  end if;

  if new.id_monitor is null then
    new.id_monitor := v_id_monitor;
  end if;

  -- RN-36: la sesión es la fecha más la hora de la franja, así que la fecha cae en su día.
  if extract(isodow from new.fecha) <> v_dia then
    raise exception 'La fecha % no cae en el día % de la franja', new.fecha, v_dia
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create or replace trigger monitoria_completar
  before insert or update of id_franja, id_monitor, fecha on public.monitoria
  for each row execute function privado.completar_monitoria();

create or replace function privado.completar_diagnostico()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id_materia is null then
    select e.id_materia into new.id_materia
    from public.evaluacion e
    where e.id = new.id_evaluacion;
  end if;
  return new;
end;
$$;

create or replace trigger diagnostico_completar
  before insert or update of id_evaluacion, id_materia on public.diagnostico
  for each row execute function privado.completar_diagnostico();
