-- Bandeja del admin: desembolsos ejecutables. HU-012.
--
-- RN-83: un desembolso no se ejecuta hasta que venza la ventana de reporte de inasistencia
-- (`desembolsable_desde`, fin programado + 24 h, con el borde inclusivo de HU-003) y mientras la
-- monitoría no tenga un reporte `en_revision` o `aceptado`. Un reporte `rechazado` no lo bloquea
-- (HU-030: el desembolso vuelve a ser ejecutable). Solo cuentan los `pendiente`.
--
-- Esta vista es la única definición de "ejecutable": la bandeja la lista y HU-028 la usará para
-- decidir si deja ejecutar.
--
--   * No expone bruto, comisión ni la llave del monitor: la bandeja solo necesita saber cuánto
--     hay que transferir (neto). La comisión sigue sin decidirse para quien la ve (P-32) y la
--     llave la lee HU-028 de la tabla, al ejecutar.
--   * security_invoker: la vista respeta las políticas de desembolso, monitoria y reporte, así
--     que solo un admin ve filas. Sin sesión ni para otros roles sale vacía o sin permiso.
--   * El desembolso no tiene admin asignado hasta que se ejecuta (`id_admin` nulo, RN-80), así
--     que todos los admins ven los mismos ejecutables.
-- Idempotente.

create or replace view public.desembolsos_ejecutables
with (security_invoker = true)
as
select
  d.id,
  d.id_monitoria,
  d.monto_neto,
  d.fecha_generacion,
  p.desembolsable_desde,
  m.fecha as fecha_sesion
from public.desembolso d
join public.monitoria m on m.id = d.id_monitoria
join public.monitoria_plazos p on p.id_monitoria = d.id_monitoria
where d.estado = 'pendiente'
  and public.plazo_alcanzado(p.desembolsable_desde, now())
  and not exists (
    select 1
    from public.reporte_inasistencia r
    where r.id_monitoria = d.id_monitoria
      and r.estado in ('en_revision', 'aceptado')
  );

comment on view public.desembolsos_ejecutables is
  'Desembolsos pendientes que ya se pueden ejecutar (RN-83). Sin bruto, comisión ni llave. HU-012.';

-- Permisos explícitos (auto_expose_new_tables = false).
revoke all on table public.desembolsos_ejecutables from public, anon, authenticated, service_role;
grant select on table public.desembolsos_ejecutables to authenticated, service_role;
