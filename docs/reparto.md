# Reparto de trabajo

**Actualizado:** 1 de octubre de 2026 (ver "Actualización del 1-oct-2026"; lo de abajo es el reparto del 30-sep). Trabajan en paralelo dos personas, cada una con su propia sesión de Claude y su propio Supabase local: `dvarela5101`, dueña del repo y del producto, y `Juzou04`. El protocolo para no pisarse está en [CLAUDE.md](../CLAUDE.md), sección "Trabajo en paralelo".

## Actualización del 1-oct-2026

- **Hecha:** dvarela5101 terminó su lista (HU-014, HU-068, HU-016, HU-017, HU-021 y HU-023), y también están aprobadas HU-059, HU-062 y HU-067 de Juzou04.
- **Juzou04:** [HU-018](../backlog/HU-018.md) (pagar por Llave y adjuntar el comprobante) y [HU-027](../backlog/HU-027.md) (expirar reservas sin comprobante a los 10 minutos) son suyas, confirmado por dvarela5101. Después, [HU-020](../backlog/HU-020.md) (revisar pagos), que espera a HU-018. HU-005 sigue en persona.
- **dvarela5101:** [HU-069](../backlog/HU-069.md) (el aviso de privacidad y el registro dicen que el nombre del monitor se ve) y [HU-071](../backlog/HU-071.md) (página 404 en español), las dos XS. Las pasó de Backlog a Lista el 1-oct.
- **Lo que sigue a HU-018:** HU-019 (confirmación con enlace), luego HU-024 (cancelar), HU-025 y HU-026 (reembolsos) y HU-029 y HU-030 (inasistencia); HU-028 (desembolsos) cuando estén HU-020 y HU-023. Se reparte cuando HU-018 esté `Hecha`.

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
