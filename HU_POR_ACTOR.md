# Historias de usuario de Calibra v10 por tipo de usuario

Agrupación de las 56 HUs de `backlog/`. El tablero oficial sigue siendo `BACKLOG.md`, que regenera el script; este archivo solo las ordena por tipo de usuario. El contexto, los hallazgos y los cortes están en `REVISION_REGLAS.md`.

Cómo leerlo:

- La numeración sigue el orden de ejecución (dependencias y prioridad), no el tipo de usuario, para que `backlog.py take` escoja bien. El tipo de usuario va entre corchetes al inicio de cada título.
- Prioridad y corte van juntos: P0 es el corte 1 (MVP), P1 el corte 2, P2 el corte 3 y P3 ideas futuras.
- Pendientes son preguntas abiertas que hay que resolver antes de pasar la HU a `Lista`.
- Para filtrar por tipo de usuario en PowerShell: `python scripts/backlog.py list | Select-String "\[Monitor\]"`.

## Resumen

| Tipo de usuario | HUs | Corte 1 | Corte 2 | Corte 3 e ideas |
|---|---|---|---|---|
| [Visitante anónimo](#visitante) | 4 | 4 | 0 | 0 |
| [Lead](#lead) | 8 | 6 | 2 | 0 |
| [Pagador](#pagador) | 2 | 1 | 1 | 0 |
| [Estudiante](#estudiante) | 6 | 0 | 6 | 0 |
| [Integrante de una grupal](#integrante) | 3 | 0 | 3 | 0 |
| [Monitor](#monitor) | 10 | 5 | 2 | 3 |
| [Admin](#admin) | 10 | 6 | 0 | 4 |
| [Sistema (procesos programados)](#sistema) | 5 | 1 | 3 | 1 |
| [Tareas técnicas](#tecnica) | 8 | 7 | 1 | 0 |
| **Total** | **56** | **30** | **18** | **8** |

<a id="visitante"></a>
## Visitante anónimo

Sin cuenta. Toma el diagnóstico y deja su contacto.

| ID | Historia de usuario | Prio | Talla | Depende de | Pendientes |
|---|---|---|---|---|---|
| [HU-008](backlog/HU-008.md) | Leer el aviso de privacidad y autorizar el tratamiento de mis datos | P0 | S | HU-001 | P-13 |
| [HU-009](backlog/HU-009.md) | Tomar el diagnóstico sin iniciar sesión | P0 | L | HU-004, HU-005 | P-18, P-33 |
| [HU-010](backlog/HU-010.md) | Dejar mi contacto al terminar el diagnóstico y quedar como Lead | P0 | M | HU-009, HU-008 | P-21, P-22, P-23, P-34 |
| [HU-011](backlog/HU-011.md) | Ver mi último diagnóstico al volver, con acceso directo a agendar | P0 | S | HU-009 | Ninguno |

<a id="lead"></a>
## Lead

Sin cuenta, ya dejó su contacto. Agenda, paga, cancela, reporta y reseña individuales mediante enlaces con token.

| ID | Historia de usuario | Prio | Talla | Depende de | Pendientes |
|---|---|---|---|---|---|
| [HU-016](backlog/HU-016.md) | Ver los monitores certificados de una materia y sus fechas libres | P0 | M | HU-014, HU-015 | Ninguno |
| [HU-017](backlog/HU-017.md) | Agendar una monitoría individual | P0 | L | HU-016, HU-010, HU-003 | P-35 |
| [HU-018](backlog/HU-018.md) | Pagar por Llave y adjuntar el comprobante | P0 | L | HU-017, HU-007 | P-36 |
| [HU-019](backlog/HU-019.md) | Recibir la confirmación de mi cita con un enlace para gestionarla | P0 | M | HU-018, HU-006 | P-04, P-22 |
| [HU-024](backlog/HU-024.md) | Cancelar mi monitoría individual hasta 12 h antes | P0 | M | HU-019, HU-003 | P-07 |
| [HU-029](backlog/HU-029.md) | Reportar que el monitor no asistió | P0 | M | HU-019 | P-04 |
| [HU-031](backlog/HU-031.md) | Recuperar mis resultados desde otro dispositivo con un enlace | P1 | M | HU-010, HU-006 | P-22 |
| [HU-035](backlog/HU-035.md) | Reseñar mi monitoría individual desde el correo | P1 | M | HU-023, HU-006 | P-03, P-22 |

<a id="pagador"></a>
## Pagador

Cualquier persona que pagó: Lead, organizador o integrante. Entrega su llave para reembolsos y cubre diferencias.

| ID | Historia de usuario | Prio | Talla | Depende de | Pendientes |
|---|---|---|---|---|---|
| [HU-025](backlog/HU-025.md) | Entregar mi llave para recibir un reembolso | P0 | M | HU-024, HU-006 | P-10, P-22 |
| [HU-042](backlog/HU-042.md) | Cubrir la diferencia cuando mi grupal pasa a individual | P1 | M | HU-041 | P-27, P-42 |

<a id="estudiante"></a>
## Estudiante

Lead con cuenta. Gestiona sus citas y organiza sesiones grupales.

| ID | Historia de usuario | Prio | Talla | Depende de | Pendientes |
|---|---|---|---|---|---|
| [HU-032](backlog/HU-032.md) | Crear mi cuenta de Estudiante sin perder mis diagnósticos ni citas | P1 | M | HU-010, HU-004 | Ninguno |
| [HU-033](backlog/HU-033.md) | Gestionar mis citas y diagnósticos desde mi cuenta | P1 | M | HU-032, HU-019, HU-024 | Ninguno |
| [HU-036](backlog/HU-036.md) | Agendar una sesión grupal como organizador | P1 | L | HU-033, HU-017, HU-018 | P-02, P-06, P-12, P-26 |
| [HU-037](backlog/HU-037.md) | Compartir el enlace del grupo y ver quién ha pagado | P1 | M | HU-036 | Ninguno |
| [HU-044](backlog/HU-044.md) | Cancelar mi sesión grupal hasta 24 h antes | P1 | M | HU-036, HU-024 | P-07 |
| [HU-045](backlog/HU-045.md) | Reportar inasistencia del monitor en mi grupal | P1 | XS | HU-029, HU-036 | Ninguno |

<a id="integrante"></a>
## Integrante de una grupal

Sin cuenta. Paga su cupo desde el enlace del grupo, hace el diagnóstico si quiere y reseña con el selector.

| ID | Historia de usuario | Prio | Talla | Depende de | Pendientes |
|---|---|---|---|---|---|
| [HU-038](backlog/HU-038.md) | Pagar mi cupo desde el enlace del grupo | P1 | M | HU-037, HU-018 | P-36, P-42 |
| [HU-039](backlog/HU-039.md) | Hacer el diagnóstico al pagar mi cupo y quedar como Lead | P1 | M | HU-038, HU-010 | P-26 |
| [HU-047](backlog/HU-047.md) | Reseñar la sesión grupal eligiendo mi nombre | P1 | M | HU-046, HU-038, HU-035 | P-03, P-26 |

<a id="monitor"></a>
## Monitor

Con cuenta. Abre franjas, ve su agenda y su hub de diagnósticos, finaliza sesiones y recibe desembolsos.

| ID | Historia de usuario | Prio | Talla | Depende de | Pendientes |
|---|---|---|---|---|---|
| [HU-013](backlog/HU-013.md) | Crear mi cuenta de monitor e iniciar sesión | P0 | M | HU-004 | P-19, P-20 |
| [HU-015](backlog/HU-015.md) | Abrir, editar y cerrar mis franjas semanales | P0 | M | HU-013, HU-003 | P-30, P-31 |
| [HU-021](backlog/HU-021.md) | Ver mi agenda de monitorías | P0 | M | HU-015, HU-017 | P-37 |
| [HU-022](backlog/HU-022.md) | Ver en mi hub el diagnóstico de cada monitoría | P0 | L | HU-021, HU-009 | Ninguno |
| [HU-023](backlog/HU-023.md) | Finalizar una sesión | P0 | S | HU-021 | P-05 |
| [HU-040](backlog/HU-040.md) | Ver los diagnósticos de mi grupal en vivo, por integrante y promedio por tema | P1 | M | HU-022, HU-039 | Ninguno |
| [HU-046](backlog/HU-046.md) | Finalizar una grupal y entregar el enlace de reseña | P1 | S | HU-023, HU-036 | Ninguno |
| [HU-049](backlog/HU-049.md) | Administrar mi perfil | P2 | M | HU-013 | P-01 |
| [HU-050](backlog/HU-050.md) | Ver mis desembolsos | P2 | S | HU-028 | P-32 |
| [HU-051](backlog/HU-051.md) | Recibir avisos de nuevas monitorías y cancelaciones | P2 | S | HU-021, HU-006 | P-11 |

<a id="admin"></a>
## Admin

Con cuenta. Certifica monitores, revisa pagos, gestiona reembolsos, reportes y desembolsos.

| ID | Historia de usuario | Prio | Talla | Depende de | Pendientes |
|---|---|---|---|---|---|
| [HU-012](backlog/HU-012.md) | Iniciar sesión y ver mi bandeja de trabajo | P0 | M | HU-004 | Ninguno |
| [HU-014](backlog/HU-014.md) | Emitir certificados de monitor por materia | P0 | S | HU-012, HU-013, HU-005 | P-19 |
| [HU-020](backlog/HU-020.md) | Revisar pagos: aprobar o rechazar | P0 | L | HU-012, HU-018, HU-006 | P-24 |
| [HU-026](backlog/HU-026.md) | Gestionar reembolsos | P0 | M | HU-025, HU-012 | Ninguno |
| [HU-028](backlog/HU-028.md) | Ejecutar desembolsos a monitores | P0 | M | HU-023, HU-020 | P-14, P-28, P-29 |
| [HU-030](backlog/HU-030.md) | Resolver reportes de inasistencia | P0 | M | HU-029, HU-026, HU-028 | P-28 |
| [HU-052](backlog/HU-052.md) | Autorizar una cancelación fuera de plazo en casos extremos | P2 | S | HU-024, HU-026 | P-08 |
| [HU-053](backlog/HU-053.md) | Gestionar leads | P2 | M | HU-010, HU-012 | Ninguno |
| [HU-054](backlog/HU-054.md) | Gestionar el equipo de admins y el turno de revisión | P2 | S | HU-012 | Ninguno |
| [HU-055](backlog/HU-055.md) | Gestionar materias y evaluaciones | P2 | M | HU-005, HU-012 | P-18 |

<a id="sistema"></a>
## Sistema (procesos programados)

Sin usuario: expiraciones, escalamientos y evaluaciones automáticas de la sección 6.3.

| ID | Historia de usuario | Prio | Talla | Depende de | Pendientes |
|---|---|---|---|---|---|
| [HU-027](backlog/HU-027.md) | Expirar reservas sin comprobante a los 10 minutos | P0 | S | HU-017 | Ninguno |
| [HU-034](backlog/HU-034.md) | Escalar al siguiente admin los pagos sin revisar tras 1 hora | P1 | M | HU-020, HU-006 | Ninguno |
| [HU-041](backlog/HU-041.md) | Evaluar las grupales al vencer el plazo de pago | P1 | M | HU-038 | P-06, P-25, P-27, P-38, P-39 |
| [HU-043](backlog/HU-043.md) | Cancelar y reembolsar cuando no se cubre la diferencia | P1 | S | HU-042, HU-024 | Ninguno |
| [HU-056](backlog/HU-056.md) | Limpiar sesiones anónimas antiguas | P3 | S | HU-010 | P-13 |

<a id="tecnica"></a>
## Tareas técnicas

Base del proyecto nuevo: stack, esquema, autenticación, banco de preguntas, correo, archivos y pruebas.

| ID | Historia de usuario | Prio | Talla | Depende de | Pendientes |
|---|---|---|---|---|---|
| [HU-001](backlog/HU-001.md) | Definir el stack y crear el esqueleto del proyecto nuevo | P0 | M | Ninguna | P-17 |
| [HU-002](backlog/HU-002.md) | Esquema de base de datos del modelo v10 con políticas de acceso | P0 | L | HU-001 | P-18, P-28, P-33 |
| [HU-003](backlog/HU-003.md) | Motor de plazos y montos derivados con pruebas de casos límite | P0 | M | HU-002 | P-40 |
| [HU-004](backlog/HU-004.md) | Autenticación: sesión anónima persistente, cuentas y roles | P0 | L | HU-002 | Ninguno |
| [HU-005](backlog/HU-005.md) | Migrar el banco de preguntas y el motor de diagnóstico al esquema nuevo | P0 | L | HU-002 | P-18 |
| [HU-006](backlog/HU-006.md) | Correo transaccional con plantillas | P0 | M | HU-001 | Ninguno |
| [HU-007](backlog/HU-007.md) | Almacenamiento privado de comprobantes de pago | P0 | S | HU-002, HU-004 | Ninguno |
| [HU-048](backlog/HU-048.md) | Pruebas de punta a punta de los flujos principales | P1 | M | HU-030 | Ninguno |
