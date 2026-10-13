# Reparto de trabajo

**Actualizado:** 10 de octubre de 2026 (ver "Ajuste del 10-oct-2026"; después vienen el ajuste del 4-oct, el ajuste del 3-oct, el ajuste del 2-oct en la noche, la revisión de HU-020, el ajuste de la tarde, la actualización del 2-oct, la del 1-oct y el reparto del 30-sep). Trabajan en paralelo dos personas, cada una con su propia sesión de Claude y su propio Supabase local: `dvarela5101`, dueña del repo y del producto, y `Juzou04`. El protocolo para no pisarse está en [CLAUDE.md](../CLAUDE.md), sección "Trabajo en paralelo".

## Ajuste del 10-oct-2026

- **Decisiones del 10-oct (D-52 a D-66):** dvarela5101 respondió las preguntas del refinamiento del diagnóstico y de las dependencias del corte. Pasan a Lista HU-009, HU-011, HU-022, HU-031, HU-032, HU-033, HU-048, HU-049, HU-050, HU-052, HU-053, HU-055, HU-056, HU-072, HU-079, HU-084 y HU-085.
- **HUs nuevas, en Backlog y por refinar:** [HU-086](../backlog/HU-086.md) (ligar un diagnóstico hecho después de agendar), [HU-087](../backlog/HU-087.md) (autorización y aviso ampliados a las respuestas; HU-022 depende de ella), [HU-088](../backlog/HU-088.md) (reseñas en la tarjeta del monitor), [HU-089](../backlog/HU-089.md) (pidió no recibir mensajes; entra al corte) y [HU-090](../backlog/HU-090.md) (retiro de la autorización desde la gestión de leads). Sus cuerpos ya están escritos; les falta la revisión de quien las tome.
- **HU-034 vuelve a refinarse** (D-56): RN-42 pasa a bandeja común con aviso a todos los admins y sin escalamiento por hora. Toca código de la cadena del admin de Juzou04 (HU-020, HU-074, HU-077).
- **Al corte (HU-057) se suman** HU-084 (D-57) y HU-089 (D-61 f); por HU-084 también entran HU-022 y HU-087.
- **D-67:** HU-087 y HU-088 quedan sin preguntas. HU-087 deja de esperar a HU-010 (depende de HU-008 y HU-068) y pasa a Lista con HU-089, las dos del corte.
- **Reparto confirmado por dvarela5101.** Juzou04 lleva más carga y lo más grande (tiene más límite en su cuenta de Claude), la cadena del diagnóstico (tiene el material de las materias) y lo que sale de su código de admin. dvarela5101 lleva lo que sale de su código: contacto, autorización y lista de monitores. Cada lista va en orden.

| Persona | Siguiente, en orden |
|---|---|
| Juzou04 | 1) Fusionar [HU-081](../backlog/HU-081.md) ([PR #51](https://github.com/dvarela5101/calibra-v10/pull/51)) y [HU-083](../backlog/HU-083.md) ([PR #52](https://github.com/dvarela5101/calibra-v10/pull/52)). 2) [HU-009](../backlog/HU-009.md) (M). 3) [HU-011](../backlog/HU-011.md) (M). 4) [HU-022](../backlog/HU-022.md) (L; su punto 8 espera HU-087). 5) [HU-084](../backlog/HU-084.md) (S). 6) [HU-055](../backlog/HU-055.md) (L). 7) Volver a refinar [HU-034](../backlog/HU-034.md) con D-56 y construirla. 8) [HU-052](../backlog/HU-052.md) (M) y [HU-050](../backlog/HU-050.md) (M) |
| dvarela5101 | 1) [HU-056](../backlog/HU-056.md) (S). 2) [HU-087](../backlog/HU-087.md) (S). 3) [HU-053](../backlog/HU-053.md) (M) y después [HU-089](../backlog/HU-089.md) (S). 4) [HU-010](../backlog/HU-010.md) (M), cuando HU-009 esté `Hecha`. 5) [HU-031](../backlog/HU-031.md) (M). 6) [HU-048](../backlog/HU-048.md) (M). 7) [HU-049](../backlog/HU-049.md) (M) y después [HU-092](../backlog/HU-092.md) (M), partición de HU-049 (D-58, 13-oct) |

Sin dueño, después del corte: HU-032, HU-033, HU-072, HU-079, HU-085, HU-086, HU-088, HU-090 y las grupales (D-47).

Posibles choques:
- **HU-087 y HU-010:** las dos tocan la casilla de autorización (`CasillasConsentimiento`); van con la misma persona y en ese orden.
- **HU-087 y HU-022:** el punto 8 de HU-022 (el monitor ve las respuestas) usa la versión de la autorización que guarda HU-087. Si HU-022 llega antes, se construye sin ese punto y se completa al fusionar HU-087. El texto nuevo se valida con asesoría (o lo aprueba dvarela5101) antes de salir.
- **HU-053 y HU-089:** la misma pantalla `/admin/leads`; misma persona.
- **HU-055 y HU-009:** HU-055 cambia el cargador del banco y la tabla `materia`; HU-009 lee las materias con Evaluación activa. El que llegue segundo integra `main`.
- **HU-034 y HU-052, HU-050:** todas de Juzou04; tocan la bandeja del admin.

Material que dvarela5101 le pide a Juzou04 de su carpeta de materias:
- El código oficial de Física II (¿FISI-1019 o FISI-1028?) y la semana 5 de su Parcial 1, y confirmar FISI-1018, MATE-1203 e ISIS-1221 contra el programa (`REVISION_REGLAS.md` §3). HU-055 carga por código: hace falta antes del corte.
- Material para más Evaluaciones activas: hoy solo 2 de 8 materias tienen una, y HU-009 solo ofrece esas (D-53 a). Se procesa como en HU-061.

## Ajuste del 4-oct-2026

- **Hechas desde el ajuste anterior:** HU-025, HU-026 y HU-058 (Juzou04). **En revisión:** HU-076 (dvarela5101, [PR #45](https://github.com/dvarela5101/calibra-v10/pull/45)).
- **Decisiones del 4-oct (D-41 a D-51):** las grupales (HU-036 a HU-047) pasan a Lista, pero salen después del corte (D-47). HU-060, HU-061, HU-081 y la nueva HU-082 pasan a Lista.

| Persona | Siguiente, en orden |
|---|---|
| dvarela5101 | Cerrar [HU-076](../backlog/HU-076.md); [HU-080](../backlog/HU-080.md) (S) y [HU-082](../backlog/HU-082.md) (S). En paralelo, refinar las dependencias del corte que no tienen dueño: HU-031, HU-034, HU-048, HU-049, HU-050, HU-052, HU-053, HU-055 y HU-056 |
| Juzou04 | [HU-030](../backlog/HU-030.md) y la cadena del diagnóstico: [HU-060](../backlog/HU-060.md) y [HU-061](../backlog/HU-061.md) (piloto con Cálculo Diferencial, D-50), después [HU-081](../backlog/HU-081.md), y al refinarlas HU-009, HU-011 y HU-022 |

Posibles choques:
- **HU-080 y HU-030:** HU-080 lee el estado del reporte de inasistencia; HU-030 lo cambia. Si HU-030 cambia los estados de `reporte_inasistencia`, avisa en el PR.
- **HU-082 y HU-030:** HU-030 crea reembolsos al aceptar un reporte; HU-082 cambia quién registra su transferencia. No redefinen la misma función.
- **HU-076 y HU-030:** HU-030 redefinirá `anotar_aviso_monitor` y su check, que HU-076 amplía con `pago_rechazado`: parte de la versión de `main`.

## Ajuste del 3-oct-2026

- **Hechas:** HU-024 ([PR #36](https://github.com/dvarela5101/calibra-v10/pull/36)) y HU-029 ([PR #40](https://github.com/dvarela5101/calibra-v10/pull/40)), las dos cerradas por Juzou04 con el código de dvarela5101. **En progreso, de Juzou04:** HU-025 (llave del reembolso, traspasada) y HU-058 (CAPTCHA).
- **Nueva:** [HU-080](../backlog/HU-080.md) (no invitar a reseñar a quien reportó, D-40), en Lista. Sale de la pregunta 4 de HU-029.
- **La cadena del diagnóstico pasa a Juzou04** (decisión de dvarela5101): [HU-060](../backlog/HU-060.md) (motor adaptativo) y [HU-061](../backlog/HU-061.md) (reprocesar el banco de una materia con IA) primero; después [HU-009](../backlog/HU-009.md) (tomar el diagnóstico), [HU-011](../backlog/HU-011.md) (ver el último diagnóstico) y [HU-022](../backlog/HU-022.md) (el diagnóstico en el hub del monitor). Las cinco siguen en Backlog: antes de tomarlas hay que refinarlas y pasar a dvarela5101 las preguntas de negocio que salgan.
- **Material de las materias (HU-061):** el material fuente (parciales, talleres, guías, notas de monitores) está en el PC de Juzou04, en carpetas por materia. Cuando Juzou04 trabaje la cadena, **agrega esa carpeta a la sesión de Claude Code** (en la app, agregar la carpeta a la sesión; en la terminal, `/add-dir <ruta>`) para que Claude la pueda leer. La carpeta queda fuera del repo: ningún archivo del material se comitea (criterio de HU-061).

| Persona | Siguiente, en orden |
|---|---|
| dvarela5101 | [HU-080](../backlog/HU-080.md) (S); después [HU-076](../backlog/HU-076.md) (correos del rechazo), cuando HU-025 esté fusionada |
| Juzou04 | Cerrar [HU-025](../backlog/HU-025.md) y [HU-058](../backlog/HU-058.md); después [HU-026](../backlog/HU-026.md) y [HU-030](../backlog/HU-030.md); y la cadena del diagnóstico: HU-060 y HU-061, luego HU-009, HU-011 y HU-022 |

Posibles choques:
- **HU-076 y HU-025:** las dos tocan las plantillas y los reconstructores de correos (`src/lib/correo/`). Por eso HU-076 espera a que HU-025 esté fusionada.
- **HU-080 y HU-030:** HU-080 lee el estado del reporte de inasistencia; HU-030 lo cambia al resolverlo. Si HU-030 cambia los estados de `reporte_inasistencia`, avisa en el PR.

## Ajuste del 2-oct-2026, noche

- **Traspaso de dvarela5101 a Juzou04:** HU-024 (cancelar) y HU-058 (CAPTCHA) las cierra Juzou04, con permiso de dvarela5101 (la reserva en `main` sigue a nombre de dvarela5101 hasta que Juzou04 la pase a su nombre con `log`). El código está completo y revisado en las ramas `hu-024-cancelar` y `hu-058-captcha`; lo que falta está en el registro de cada HU. Orden: HU-024 primero y HU-058 después (el CAPTCHA cambia el stack local de las dos personas).
- **dvarela5101 sigue con HU-029** (reportar inasistencia) en la rama `hu-029-reportar`, que **parte de `hu-024-cancelar`**: usa el botón y la migración de HU-024. No se abre su PR hasta que HU-024 esté fusionada; entonces se integra `main`.
- **HU-025** (llave del reembolso) tiene plan, pero espera a que HU-024 esté `Hecha`. HU-076 sigue después de HU-025.

| Persona | Ahora | Después |
|---|---|---|
| dvarela5101 | [HU-029](../backlog/HU-029.md) (rama `hu-029-reportar`) | [HU-025](../backlog/HU-025.md) (cuando HU-024 esté `Hecha`) y [HU-076](../backlog/HU-076.md) |
| Juzou04 | Cerrar [HU-024](../backlog/HU-024.md) y luego [HU-058](../backlog/HU-058.md) (traspasadas); [HU-028](../backlog/HU-028.md) y [HU-075](../backlog/HU-075.md) (en curso) | Lo mismo del ajuste anterior: HU-078, HU-026 (espera a HU-025), HU-030 y, en el hueco, HU-077 |

Posibles choques:
- **Rama `hu-024-cancelar`:** la tocan las dos personas (Juzou04 la cierra y `hu-029-reportar` parte de ella). Juzou04 no reescribe su historia (sin `rebase` ni `push --force`), para que dvarela5101 pueda integrarla.
- **HU-029 y HU-024:** las dos usan la página de la cita (`src/app/cita/`) y las funciones `cita_por_token`, `mi_cita` y `mis_citas`. HU-029 les agrega una columna de salida (D-37). Si Juzou04 cambia algo de eso al cerrar HU-024, avisa en el PR.
- **HU-058 y HU-075:** las dos tocan el formulario de contacto. El PR que llegue segundo integra al otro.
- **HU-024 y HU-020:** HU-024 ajusta `supabase/tests/revisar_pago.test.sql` (de HU-020): el pago aprobado de una cita ya cancelada por el estudiante ahora sí tiene reembolso (P-07).

## Ajuste del 2-oct-2026, revisión de HU-020

- **Hecha:** HU-020 ([PR #32](https://github.com/dvarela5101/calibra-v10/pull/32)). **En revision:** HU-074 (Juzou04, [PR #34](https://github.com/dvarela5101/calibra-v10/pull/34)). **En progreso:** HU-024 y HU-058 (dvarela5101), HU-028 y HU-075 (Juzou04).
- D-39 cierra la revisión de HU-020: amplía [HU-076](../backlog/HU-076.md) (correos del rechazo, también al pagador), crea [HU-078](../backlog/HU-078.md) (casos P-24) y suma un criterio a HU-028. HU-076, HU-077 y HU-078 pasan a Lista. Reparto confirmado por dvarela5101.

| Persona | Siguiente, en orden |
|---|---|
| dvarela5101 | [HU-024](../backlog/HU-024.md) (cancelar), [HU-025](../backlog/HU-025.md) (llave del reembolso), [HU-076](../backlog/HU-076.md) (correos del rechazo) y [HU-029](../backlog/HU-029.md) (reportar inasistencia). En paralelo, [HU-058](../backlog/HU-058.md) (CAPTCHA) |
| Juzou04 | [HU-028](../backlog/HU-028.md) y [HU-075](../backlog/HU-075.md) (en curso); después [HU-078](../backlog/HU-078.md) (casos P-24, sigue a HU-028), [HU-026](../backlog/HU-026.md) (espera a HU-025) y [HU-030](../backlog/HU-030.md). En el hueco: [HU-077](../backlog/HU-077.md) (otro admin revisa un pago vencido) |

Posibles choques:
- **HU-028 y HU-078:** HU-078 cambia el cálculo y el bloqueo del desembolso que deja HU-028, así que va después.
- **HU-076 y HU-077:** las dos tocan la revisión de pagos de HU-020 (`acciones.ts`, y HU-077 también `privado.revisar_pago`). El PR que llegue segundo integra al otro.
- **HU-076 y HU-024:** el correo al pagador de una cita ya cancelada sigue el tono del correo de cancelación de HU-024. HU-025 va antes que HU-076 para no hacer esperar a HU-026.

## Ajuste del 2-oct-2026, tarde

- **Hecha:** HU-019 y HU-073. **En revision:** HU-027 (Juzou04). **Por fusionar:** HU-020 (Juzou04, [PR #32](https://github.com/dvarela5101/calibra-v10/pull/32), CI en verde, en conflicto con `main` desde que entró HU-019).
- D-36 pasa HU-075 a Lista. D-37 resuelve lo que faltaba de HU-030, que pasa a Lista.
- Juzou04 se queda con la cadena del admin, sobre su propio código (pagos, comprobantes y bandeja). dvarela5101 sigue con la cadena del estudiante. Confirmado por dvarela5101.

| Persona | Siguiente, en orden |
|---|---|
| dvarela5101 | [HU-024](../backlog/HU-024.md) (cancelar), [HU-025](../backlog/HU-025.md) (llave del reembolso), [HU-029](../backlog/HU-029.md) (reportar inasistencia). En paralelo, [HU-058](../backlog/HU-058.md) (CAPTCHA) |
| Juzou04 | Fusionar [HU-020](../backlog/HU-020.md) y terminar [HU-074](../backlog/HU-074.md); después [HU-028](../backlog/HU-028.md) (desembolsos), [HU-026](../backlog/HU-026.md) (gestionar reembolsos, espera a HU-025) y [HU-030](../backlog/HU-030.md) (resolver inasistencias, espera a HU-029, HU-026 y HU-028). En el hueco mientras espera HU-025: [HU-075](../backlog/HU-075.md) (tope de correos, S) |

Posibles choques:
- **HU-025 y HU-026:** HU-025 crea la página de la llave y el pedido por correo; HU-026 es la bandeja donde el admin ejecuta el reembolso. Se tocan en `reembolso` (la llave y el paso a `pendiente`): HU-026 parte de lo que deje HU-025.
- **HU-028 y HU-030:** HU-030 deja el desembolso `anulado` (P-28); HU-028 no debe ejecutar un `anulado` ni uno con un reporte `en_revision` o `aceptado` (RN-83).
- **HU-029 y HU-030:** HU-029 agrega a la página de la cita (HU-019) el estado del reporte y las observaciones; HU-030 las escribe.
- **HU-075:** toca la función que registra el contacto (HU-068, de dvarela5101). Si dvarela5101 hace HU-058 a la vez, las dos tocan el formulario de contacto: el PR que llegue segundo integra al otro.

## Actualización del 2-oct-2026

- **Hecha:** HU-018 (Juzou04), HU-035, HU-070, HU-005, HU-051, HU-054, HU-069 y HU-071. Con HU-018 se desbloquean HU-019, HU-020 y HU-027.
- Las decisiones D-19 a D-35 (`REVISION_REGLAS.md` §4) resuelven las preguntas de HU-019, HU-024 y HU-058, pasan HU-073 y HU-074 a Lista y crean HU-075 (Backlog).

| Persona | Siguiente, en orden |
|---|---|
| dvarela5101 | [HU-073](../backlog/HU-073.md) (aviso de privacidad: reseñas y Cloudflare, XS), [HU-019](../backlog/HU-019.md) (confirmación de la cita), [HU-024](../backlog/HU-024.md) (cancelar), [HU-025](../backlog/HU-025.md) (llave del reembolso), [HU-029](../backlog/HU-029.md) (reportar inasistencia) y [HU-058](../backlog/HU-058.md) (CAPTCHA, D-33) |
| Juzou04 | [HU-027](../backlog/HU-027.md) (expirar reservas), [HU-020](../backlog/HU-020.md) (revisar pagos) y después [HU-074](../backlog/HU-074.md) (pagos de un admin desactivado). Propuesta: confirmar con Juzou04 |

Posibles choques:
- **HU-019 y HU-020:** rechazar un pago cancela la cita (RN-43) y puede pasar después de que salió la confirmación. HU-020 debe aprobar y rechazar sin error una cita que el estudiante ya canceló (HU-024), y solo cambiar el estado y la fecha de revisión del pago.
- **HU-024 y HU-020:** el reembolso de una cancelación con el pago aún en revisión se crea cuando el admin lo aprueba (P-07). HU-024 lo hace con un trigger sobre `pago`.
- **HU-058:** cambia la sesión anónima, los formularios de cuentas y las utilidades de prueba. Al fusionarla, cada persona reinicia su Supabase local (`npm run db:detener` y `npm run db:iniciar`).

## Actualización del 1-oct-2026

- **Hecha:** dvarela5101 terminó su lista (HU-014, HU-068, HU-016, HU-017, HU-021 y HU-023), y también están aprobadas HU-059, HU-062 y HU-067 de Juzou04.
- **Juzou04:** [HU-018](../backlog/HU-018.md) (pagar por Llave y adjuntar el comprobante) y [HU-027](../backlog/HU-027.md) (expirar reservas sin comprobante a los 10 minutos) son suyas, confirmado por dvarela5101. Después, [HU-020](../backlog/HU-020.md) (revisar pagos), que espera a HU-018. HU-005 sigue en persona.
- **dvarela5101:** [HU-069](../backlog/HU-069.md) (el aviso de privacidad y el registro dicen que el nombre del monitor se ve) y [HU-071](../backlog/HU-071.md) (página 404 en español), las dos XS. Las pasó de Backlog a Lista el 1-oct.
- **Lo que sigue a HU-018:** HU-019 (confirmación con enlace), luego HU-024 (cancelar), HU-025 y HU-026 (reembolsos) y HU-029 y HU-030 (inasistencia); HU-028 (desembolsos) cuando estén HU-020 y HU-023. Se reparte cuando HU-018 esté `Hecha`.

### Plan hasta el domingo (1-oct-2026)

dvarela5101 pasó a `Lista` HU-051 (ahora P0, D-16), HU-054, HU-070, HU-035 (D-17) y HU-058 (D-18). HU-018 es el cuello de botella: de ella dependen ocho HUs, así que Juzou04 empieza por ahí.

| Persona | Ahora | Cuando HU-018 esté `Hecha` |
|---|---|---|
| dvarela5101 | HU-069 y HU-071 (reservadas), [HU-051](../backlog/HU-051.md), [HU-054](../backlog/HU-054.md) y [HU-035](../backlog/HU-035.md) | La cadena del estudiante: HU-019 (confirmación con enlace), HU-024 (cancelar), HU-025 (entregar la llave del reembolso) y HU-029 (reportar inasistencia) |
| Juzou04 | HU-018 y HU-027 (confirmadas); en los huecos, [HU-070](../backlog/HU-070.md) (toca su validador de HU-062) y [HU-058](../backlog/HU-058.md). Propuesta: confirmar con Juzou04 | La cadena del admin: HU-020 (revisar pagos), HU-028 (desembolsos), HU-026 (gestionar reembolsos) y HU-030 (resolver inasistencias). Propuesta: confirmar con Juzou04 |
| Las dos | HU-005, en persona | HU-057 (corte), según se decida la salida temprana |

## Estado de partida

- **Hecha:** HU-001 a HU-004, HU-006, HU-007, HU-008, HU-012, HU-013, HU-015, HU-063, HU-064, HU-065 y HU-066.
- **HU-005 (banco por habilidades) queda para después.** La hacen las dos personas juntas, en persona, y ninguna sesión la toma sola. Ya no frena el agendamiento: con D-2, certificar no espera el banco, y con D-3 el diagnóstico es opcional para agendar (el contacto se pide al agendar, [HU-068](../backlog/HU-068.md)). Del banco siguen dependiendo el diagnóstico (HU-060, HU-061, HU-009, HU-010, HU-011) y lo que lo muestra.
- Las decisiones de negocio están en [REVISION_REGLAS.md](../REVISION_REGLAS.md) §4 ("Decisiones del 29-sep-2026" y "Decisiones del 30-sep-2026"), y cada HU las trae en su contexto.

## Las próximas HUs

Cada persona hace las suyas en este orden. Cuando la siguiente depende de la anterior, espera a que dvarela5101 apruebe la anterior (`Hecha`).

**dvarela5101: certificar y agendar**

| Orden | HU | Talla | Puede empezar cuando |
|---|---|---|---|
| 1 | [HU-014](../backlog/HU-014.md) Emitir certificados de monitor por materia | S | Ya (D-2) |
| 2 | [HU-068](../backlog/HU-068.md) Dejar mi contacto al agendar y quedar como Lead | M | Ya (D-3) |
| 3 | [HU-016](../backlog/HU-016.md) Ver los monitores certificados de una materia y sus fechas libres | M | HU-014 esté `Hecha` |
| 4 | [HU-017](../backlog/HU-017.md) Agendar una monitoría individual | L | HU-016 y HU-068 estén `Hecha` |
| 5 | [HU-021](../backlog/HU-021.md) Ver mi agenda de monitorías (monitor) | M | HU-017 esté `Hecha` |
| 6 | [HU-023](../backlog/HU-023.md) Finalizar una sesión | S | HU-021 esté `Hecha` |

**Juzou04: comprobantes, pagos y panel de admin (su propio código)**

| Orden | HU | Talla | Puede empezar cuando |
|---|---|---|---|
| 1 | [HU-059](../backlog/HU-059.md) Endurecer los comprobantes | S | Ya |
| 2 | [HU-067](../backlog/HU-067.md) Impedir que un pagador pise su propio comprobante | S | Ya. Va bien con HU-059: las dos tocan el bucket |
| 3 | [HU-062](../backlog/HU-062.md) Solicitud de certificación del aspirante a monitor | M | Ya |
| 4 | [HU-018](../backlog/HU-018.md) Pagar por Llave y adjuntar el comprobante | L | HU-017 esté `Hecha`. Propuesta: confirmar con Juzou04 |
| 5 | [HU-020](../backlog/HU-020.md) Revisar pagos: aprobar o rechazar | L | HU-018 esté `Hecha`. Propuesta: confirmar con Juzou04 |
| 6 | [HU-027](../backlog/HU-027.md) Expirar reservas sin comprobante a los 10 minutos | S | HU-017 esté `Hecha`. Propuesta: confirmar con Juzou04 |

Por qué así:
- HU-014, HU-016 y HU-017 forman la cadena de agendar y siguen a las franjas (HU-015): conviene que la tenga la misma cabeza. HU-068 se puede hacer mientras HU-014 espera aprobación.
- HU-018 y HU-020 usan los comprobantes (HU-007, HU-059, HU-067) y la bandeja del admin (HU-012), que son código de Juzou04.
- El cruce entre personas es HU-017 → HU-018 y HU-027. Mientras HU-017 no esté `Hecha`, Juzou04 tiene tres HUs propias.

Posibles choques:
- **HU-014 y HU-062** agregan pantallas al panel de admin (certificar y ver solicitudes de certificación). Cada una va en su propia ruta (`/admin/...`) y no edita la bandeja de HU-012 más allá de un enlace. Si HU-062 ya lista aspirantes, HU-014 puede certificar desde ahí: se coordina en el PR que llegue segundo.
- **HU-068 y HU-062** agregan plantillas de correo en `src/lib/correo/plantillas.ts` (y su reconstructor para los reintentos de HU-065). Si chocan, se combinan las listas.
- **HU-014, HU-068, HU-059, HU-062 y HU-067** pueden crear migraciones nuevas. Nunca se edita una que ya esté en `main`, y `src/lib/supabase/tipos.ts` se regenera con `npm run db:tipos`.

## Cómo arrancar el chat de cada persona

Se abre Claude Code en `calibra-v10` y se le dice, por ejemplo:

> Lee CLAUDE.md y docs/reparto.md. Soy dvarela5101 (o Juzou04). Haz mi siguiente HU del reparto siguiendo el protocolo de trabajo en paralelo.

La sesión:
1. Trae `main`.
2. Reserva **con `start HU-XXX`**, nunca con `take`, porque `take` podría elegir una HU de la otra persona.
3. Anota `log HU-XXX "Tomada por <persona>"` y hace push de la reserva.
4. Trabaja en su rama, abre el PR y lo fusiona con CI en verde.
5. Deja la HU `En revision`.

Si la siguiente HU depende de una que aún no está `Hecha`, la sesión se detiene y lo dice.

## Después de estas 6

- **HU-064 y HU-065 pasaron a dvarela5101** el 29-sep por la noche, mientras Juzou04 no estaba: HU-065 encaja con el correo por Gmail (HU-066) y HU-064 recoge además un ajuste de la revisión de HU-063. Juzou04 sigue con HU-059, HU-062 y HU-067.
- **Juntos, en persona:** HU-005, y después HU-060 (motor adaptativo) y HU-061 (reprocesar el banco con IA; su piloto corre en el PC de Juzou04).
- **Cuando HU-005 y HU-013 estén `Hecha`:** HU-014 (certificados).
- **Cuando HU-014 y HU-015 estén `Hecha`:** HU-016 (ver monitores y fechas libres), y a partir de ahí la cadena de agendar, pagar y reembolsar.
