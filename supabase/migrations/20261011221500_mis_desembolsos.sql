-- Mis desembolsos: lo que el monitor ve de cada desembolso suyo. HU-050.
--
-- RN-80 a RN-83: el monitor ve sus desembolsos con su materia, su día y su hora, y según la situación, cuándo se
-- puede transferir, qué lo retiene, cuándo y con qué referencia se transfirió o que se anuló. RN-45, RN-81 y RN-82: las
-- cifras son el total de la monitoría (bruto), la comisión de Calibra y lo que se le transfiere (neto). N-2: la
-- comisión la calcula solo el servidor, aquí la base; la app no calcula nada. N-6: se puede transferir después de
-- fin + 24 h. P-28: un desembolso anulado no se transfiere. P-29: los montos de un por transferir son el cálculo de
-- ahora, los de uno transferido son los que quedaron al ejecutarlo. P-37: nada del estudiante ni de quien pagó.
--
-- D-59 (10-oct-2026, dvarela5101): (a) el monitor ve en esta pantalla tres cifras, en este orden: el total de la
-- monitoría, la comisión de Calibra y lo que se le transfiere; es la única excepción a la regla de la comisión (CLAUDE.md).
-- (b) Si un reporte de inasistencia en revisión retiene el desembolso, el monitor lee solo que Calibra tiene que resolver
-- algo antes de transferir, sin las palabras «reporte» ni «inasistencia».
--
-- Diseño (registro de HU-050; los supuestos 1, 2, 3 y 6 son los que toca la base):
--   * La tabla `desembolso` sigue cerrada para el monitor (solo la lee un admin): una política le dejaría leer el
--     bruto, la comisión, la llave y el admin de la fila por la Data API, y D-59 permite tres cifras, no la fila.
--     La lectura es una función security definer que devuelve 13 columnas y una situación cerrada de siete valores.
--   * La situación sale de privado.estado_para_ejecutar (la única fuente del porqué) y del estado del desembolso:
--       transferido        el desembolso está desembolsado (manda el estado del desembolso, no el de la monitoría).
--       anulado            el desembolso está anulado (P-28), sin ninguna cifra.
--       listo              estado_para_ejecutar no encuentra nada que lo retenga: un admin lo transfiere.
--       en_plazo           antes_de_plazo (N-6): todavía no es estrictamente después de fin + 24 h.
--       pago_en_revision   pagos_en_revision (D-39).
--       pago_rechazado     caso_abierto: un pago rechazado con su caso P-24 sin cerrar (HU-078).
--       en_espera          cualquier otro motivo: con_reporte, sin_pagos_aprobados, no_realizada y cualquier motivo que
--                          agregue una HU futura. Es el valor por defecto a propósito: un motivo nuevo sale como la
--                          frase más opaca, nunca como una nueva que alguien lea por la Data API. La función no tiene
--                          un valor «con reporte»: ni llamándola directo se lee que hay un reporte (D-59 b). Un
--                          reporte en revisión dentro de la ventana de reporte sale en_plazo y tampoco revela nada.
--   * estado_para_ejecutar entra por un `cross join lateral` (inner): siempre devuelve una fila, pero un motivo nulo por
--     falta de fila se confundiría con «se puede ejecutar» (listo). Con el inner, esa fila desaparece en vez de mentir.
--   * Los montos de un por transferir salen de privado.calcular_desembolso en la misma sentencia, nunca de la foto de la
--     fila (P-29). Los de un transferido son lo guardado al ejecutar. Un anulado no lleva montos, llave, referencia ni día.
--   * fecha_desembolso sale como `date` de Bogotá: ninguna ruta de la app puede mostrar un día corrido por la zona del
--     servidor. desembolsable_desde solo viaja en en_plazo, y es la posterior entre desembolsable_desde y
--     reporte_inasistencia_hasta (public.desembolso_ejecutable exige las dos; hoy valen lo mismo).
--   * Permisos con el patrón de HU-028 y HU-030, no con el de la agenda: la versión con p_ahora no tiene grant (ninguna
--     sesión elige la hora); la sesión entra por privado.mis_desembolsos_de_la_sesion, que pasa now(), desde la puerta
--     security invoker public.mis_desembolsos(). Con las dos últimas, es lo único que entrega la comisión a una sesión.
--   * La lectura no escribe ni toma candados (ni la monitoría, ni el desembolso, ni los pagos): nunca espera a un admin que
--     ejecuta, acepta un reporte o revisa un pago. Es una sola sentencia con funciones stable: situación y montos salen
--     del mismo instante.
--   * No redefine ninguna función ni vista de otra HU, ni cambia la tabla, sus políticas ni sus permisos.
-- Idempotente.

-- ---------------------------------------------------------------------------
-- La lectura, con la hora como parámetro (para probar los plazos)
-- ---------------------------------------------------------------------------
-- El filtro es auth.uid(), no un parámetro: un admin, un Lead o una sesión sin monitor reciben una lista vacía. Solo
-- individuales (D-47): el trigger de HU-028 no crea desembolso para una grupal.
create or replace function privado.desembolsos_del_monitor(p_ahora timestamptz)
returns table (
  id_desembolso uuid,
  fecha date,
  hora time,
  duracion_min integer,
  nombre_materia text,
  situacion text,
  desembolsable_desde timestamptz,
  monto_bruto integer,
  comision integer,
  monto_neto integer,
  llave_destino text,
  referencia_transferencia text,
  fecha_desembolso date
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    d.id,
    m.fecha,
    f.hora,
    f.duracion_min,
    ma.nombre,
    s.situacion,
    case when s.situacion = 'en_plazo'
      then greatest(pl.desembolsable_desde, pl.reporte_inasistencia_hasta) end,
    case d.estado when 'pendiente' then c.monto_bruto when 'desembolsado' then d.monto_bruto end,
    case d.estado when 'pendiente' then c.comision when 'desembolsado' then d.comision end,
    case d.estado when 'pendiente' then c.monto_neto when 'desembolsado' then d.monto_neto end,
    case when d.estado in ('pendiente', 'desembolsado') then d.llave_destino end,
    case when d.estado = 'desembolsado' then d.referencia_transferencia end,
    case when d.estado = 'desembolsado' then (d.fecha_desembolso at time zone 'America/Bogota')::date end
  from public.desembolso d
  join public.monitoria m on m.id = d.id_monitoria
  join public.franja f on f.id = m.id_franja
  join public.materia ma on ma.id = m.id_materia
  join public.monitoria_plazos pl on pl.id_monitoria = m.id
  cross join lateral privado.estado_para_ejecutar(d.id, p_ahora) e
  left join lateral (
    select x.monto_bruto, x.comision, x.monto_neto
    from privado.calcular_desembolso(d.id_monitoria) x
    where d.estado = 'pendiente'
  ) c on true
  cross join lateral (
    select case
      when d.estado = 'desembolsado' then 'transferido'
      when d.estado = 'anulado' then 'anulado'
      when e.motivo is null then 'listo'
      when e.motivo = 'antes_de_plazo' then 'en_plazo'
      when e.motivo = 'pagos_en_revision' then 'pago_en_revision'
      when e.motivo = 'caso_abierto' then 'pago_rechazado'
      else 'en_espera'
    end as situacion
  ) s
  where m.id_monitor = (select auth.uid())
  order by m.fecha, f.hora, d.id;
$$;

comment on function privado.desembolsos_del_monitor(timestamptz) is
  'Los desembolsos del monitor de la sesión (auth.uid()) con una situación cerrada de siete valores, sin motivos internos, y las tres cifras de D-59: de ahora si está por transferir, las guardadas si se transfirió, ninguna si se anuló. Con p_ahora para probar los plazos; sin grant. HU-050.';

-- La versión con p_ahora queda interna: la usan privado.mis_desembolsos_de_la_sesion y las pruebas, como postgres.
revoke all on function privado.desembolsos_del_monitor(timestamptz) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- La entrada de la sesión, con la hora de la base
-- ---------------------------------------------------------------------------
-- Las 13 columnas una por una, no `select *`: una columna que se sume después a la interna no ensancha sola lo que llega
-- a la sesión.
create or replace function privado.mis_desembolsos_de_la_sesion()
returns table (
  id_desembolso uuid,
  fecha date,
  hora time,
  duracion_min integer,
  nombre_materia text,
  situacion text,
  desembolsable_desde timestamptz,
  monto_bruto integer,
  comision integer,
  monto_neto integer,
  llave_destino text,
  referencia_transferencia text,
  fecha_desembolso date
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id_desembolso, r.fecha, r.hora, r.duracion_min, r.nombre_materia, r.situacion, r.desembolsable_desde,
         r.monto_bruto, r.comision, r.monto_neto, r.llave_destino, r.referencia_transferencia, r.fecha_desembolso
  from privado.desembolsos_del_monitor(now()) r;
$$;

comment on function privado.mis_desembolsos_de_la_sesion() is
  'Los desembolsos del monitor de la sesión con la hora de la base: privado.desembolsos_del_monitor sin p_ahora. Con public.mis_desembolsos, lo único que entrega la comisión a una sesión (D-59). HU-050.';
revoke all on function privado.mis_desembolsos_de_la_sesion() from public, anon, authenticated, service_role;
grant execute on function privado.mis_desembolsos_de_la_sesion() to authenticated;

-- ---------------------------------------------------------------------------
-- La puerta en la Data API
-- ---------------------------------------------------------------------------
-- Con los permisos de quien llama. Solo con sesión: sin ella no hay auth.uid() ni monitor, así que service_role no la
-- necesita.
create or replace function public.mis_desembolsos()
returns table (
  id_desembolso uuid,
  fecha date,
  hora time,
  duracion_min integer,
  nombre_materia text,
  situacion text,
  desembolsable_desde timestamptz,
  monto_bruto integer,
  comision integer,
  monto_neto integer,
  llave_destino text,
  referencia_transferencia text,
  fecha_desembolso date
)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.id_desembolso, r.fecha, r.hora, r.duracion_min, r.nombre_materia, r.situacion, r.desembolsable_desde,
         r.monto_bruto, r.comision, r.monto_neto, r.llave_destino, r.referencia_transferencia, r.fecha_desembolso
  from privado.mis_desembolsos_de_la_sesion() r;
$$;

comment on function public.mis_desembolsos() is
  'Los desembolsos del monitor de la sesión: situación cerrada, montos y llave. Con privado.mis_desembolsos_de_la_sesion, lo único que entrega la comisión a una sesión (D-59). HU-050.';
revoke all on function public.mis_desembolsos() from public, anon, authenticated, service_role;
grant execute on function public.mis_desembolsos() to authenticated;
