# Reparto de trabajo

**Actualizado:** 29 de septiembre de 2026, noche (reasignación de HU-064 y HU-065). Trabajan en paralelo dos personas, cada una con su propia sesión de Claude y su propio Supabase local: `dvarela5101`, dueña del repo y del producto, y `Juzou04`. El protocolo para no pisarse está en [CLAUDE.md](../CLAUDE.md), sección "Trabajo en paralelo".

## Estado de partida

- **Hecha:** HU-001, HU-002, HU-003, HU-004, HU-006, HU-007 y HU-012.
- **HU-005 (banco por habilidades):** la hacen las dos personas juntas, en persona. Ninguna sesión la toma sola. Es el cuello de botella del diagnóstico: de ella dependen HU-060, HU-061, HU-009 y, detrás, casi todo el flujo del estudiante.
- Las decisiones de negocio del corte 1 están en [REVISION_REGLAS.md](../REVISION_REGLAS.md) §4, "Decisiones del 29-sep-2026", y cada HU las trae en su contexto.

## Las próximas 6 HUs

Cada persona hace las suyas en este orden. Cuando la siguiente depende de la anterior, espera a que dvarela5101 apruebe la anterior (`Hecha`).

**dvarela5101: el camino del monitor**

| Orden | HU | Talla | Puede empezar cuando |
|---|---|---|---|
| 1 | [HU-008](../backlog/HU-008.md) Aviso de privacidad y autorización de datos | S | Ya |
| 2 | [HU-013](../backlog/HU-013.md) Cuenta de monitor por invitación | M | Ya |
| 3 | [HU-015](../backlog/HU-015.md) Franjas semanales del monitor | M | HU-013 esté `Hecha` |
| 4 | [HU-066](../backlog/HU-066.md) Enviar los correos por SMTP de Gmail (decisión D-1) | S | Ya: se puede adelantar mientras HU-015 espera la aprobación de HU-013 |
| 5 | [HU-065](../backlog/HU-065.md) Reintentar los correos que fallaron | S | Ya (pasó de Juzou04 a dvarela5101 el 29-sep, por la noche) |
| 6 | [HU-015](../backlog/HU-015.md) Franjas semanales del monitor | M | Ya: HU-013 quedó `Hecha` |
| 7 | [HU-064](../backlog/HU-064.md) Ajustes de la revisión de HU-006 y HU-012 (incluye el texto del desembolso de N-6) | S | Ya (pasó de Juzou04 a dvarela5101) |

**Juzou04: comprobantes, plazos y panel de admin (su propio código)**

| Orden | HU | Talla | Puede empezar cuando |
|---|---|---|---|
| 1 | [HU-063](../backlog/HU-063.md) Ajustes de la revisión de HU-003 y HU-007 | S | Ya |
| 2 | [HU-059](../backlog/HU-059.md) Endurecer los comprobantes | S | Ya (después de HU-063, porque las dos tocan el bucket) |
| 3 | [HU-062](../backlog/HU-062.md) Solicitud de certificación del aspirante a monitor | M | Ya: HU-008 quedó `Hecha` |
| 4 | [HU-067](../backlog/HU-067.md) Impedir que un pagador pise su propio comprobante (P1, subida el 29-sep) | S | Ya. Va bien con HU-059: las dos tocan el bucket |

Por qué así:
- HU-013 y HU-015 forman una cadena, y conviene que la tenga la misma cabeza.
- HU-063 y HU-059 tocan el mismo bucket y el código que escribió Juzou04, así que van seguidas y con la misma persona.
- HU-062 usa el panel de admin (HU-012) y la autorización de datos (HU-008).
- El único cruce entre personas es HU-062 → HU-008. HU-008 es la primera y la más corta de dvarela5101, para que esté lista a tiempo.

Posibles choques:
- **HU-013 y HU-062** agregan pantallas al panel de admin. Cada una va en su propia ruta (`/admin/...`) y no edita la bandeja de HU-012 más allá de un enlace.
- **HU-013 y HU-062** agregan plantillas de correo en `src/lib/correo/plantillas.ts`. Si chocan, se combinan las dos listas.
- **HU-063, HU-059, HU-015 y HU-062** crean migraciones nuevas. Nunca se edita una que ya esté en `main`, y `src/lib/supabase/tipos.ts` se regenera con `npm run db:tipos`.

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
