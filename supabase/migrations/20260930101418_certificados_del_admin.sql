-- Certificados que emite el admin. HU-014.
--
-- RN-21: un certificado por monitor y materia (restricción única de HU-002), sin vencimiento.
-- P-19: el admin lo emite después de la evaluación presencial, y queda constancia de su fecha
-- (`fecha_evaluacion`). No hay prueba en la app para monitores.
-- D-2 (30-sep-2026): no espera el banco de preguntas (HU-005): la materia solo tiene que existir.
-- RN-23: un certificado sigue vigente aunque el admin que lo emitió se desactive. Nada lo liga a que
-- ese admin siga activo: la lectura es pública y las franjas solo miran que el certificado exista.
--
-- Escritura: solo un admin activo inserta, a su nombre (`id_admin` es él). La fecha de emisión la pone
-- la base (hoy en Bogotá). Nadie con sesión actualiza ni borra: revocar está fuera de alcance.
-- Idempotente.

alter table public.certificado add column if not exists fecha_evaluacion date;

-- Los certificados que ya existían (solo pruebas y semillas locales) toman la fecha de emisión.
update public.certificado set fecha_evaluacion = fecha_emision where fecha_evaluacion is null;

-- El valor por defecto solo lo usan las escrituras de confianza (pruebas, herramientas). La pantalla
-- del admin siempre la pide, y la acción siempre la manda. La importación del prototipo (HU-057)
-- debe mandar la fecha real de cada evaluación: con el valor por defecto quedaría la del día de la carga.
alter table public.certificado
  alter column fecha_evaluacion set default ((now() at time zone 'America/Bogota')::date),
  alter column fecha_evaluacion set not null;

-- La evaluación presencial es anterior (o igual) a la emisión: no se certifica por una evaluación futura.
alter table public.certificado drop constraint if exists certificado_evaluacion_antes_de_emision;
alter table public.certificado add constraint certificado_evaluacion_antes_de_emision
  check (fecha_evaluacion <= fecha_emision);

comment on column public.certificado.fecha_evaluacion is
  'Fecha de la evaluación presencial que aprobó el monitor (P-19). HU-014.';

-- ---------------------------------------------------------------------------
-- El admin certifica
-- ---------------------------------------------------------------------------
-- auto_expose_new_tables = false: permiso por columna. fecha_emision la pone la base; id, su default.
grant insert (id_monitor, id_materia, id_admin, fecha_evaluacion) on table public.certificado to authenticated;

drop policy if exists "admin certifica" on public.certificado;
create policy "admin certifica" on public.certificado
  for insert to authenticated
  with check ((select privado.es_admin()) and id_admin = (select auth.uid()));
