# Calibra v10: revisión de reglas y plan de reconstrucción

**Fecha:** 28 de septiembre de 2026. **Base:** `calibra_reglas_negocio.md` (modelo v10) y el prototipo de `Calibra/` (rama `main`, `index.html` del 22 de septiembre). **Resultado:** 56 historias de usuario en `backlog/`, todas en estado `Backlog`, agrupadas por tipo de usuario en `HU_POR_ACTOR.md`.

## 1. Veredicto

Reconstruir desde cero es la decisión correcta para la aplicación y la base de datos. No lo es para el contenido ni para el motor del diagnóstico: son el activo del producto y se portan.

Por qué reconstruir:

1. **El modelo cambió de fondo.** v10 tiene 17 entidades con estados, plazos y dinero (pagos, reembolsos, desembolsos). El prototipo tiene franjas de hora concreta, citas sin estados, estudiantes identificados solo por su correo y ningún rol de admin. Casi ninguna tabla sobrevive tal cual.
2. **Las reglas del prototipo chocan con v10.** "Nada de localStorage" y "estado en memoria" impiden la sesión anónima persistente (RN-10); "sin autenticación" choca con las cuentas de Estudiante, Monitor y Admin; "nunca mostrar cifras de comisión" choca con RN-81, que ya fija la comisión.
3. **La arquitectura no da para esto.** Un solo `index.html` de 8.204 líneas, sin build ni pruebas unitarias, no aguanta procesos programados, archivos privados, tiempo real y permisos por rol. Además `monitores.clave` es pública y la inserción en `monitores` sigue abierta, como documenta la migración 003.
4. **La base actual no se puede reutilizar con seguridad.** `schema.sql` empieza con `drop table ... cascade` y el proyecto `uotlhaitdkfroavqkvee` tiene datos reales. Lo sano es un proyecto (o esquema) nuevo y dejar el actual como archivo histórico.

Qué se porta en vez de reescribir:

- El banco de preguntas (`contenido/*.md`, 8 materias) y `convertir.js`, cambiando solo el destino ([HU-005](backlog/HU-005.md)).
- El cálculo del diagnóstico por knowledge components, con el oráculo de `verificar.js` como prueba de regresión ([HU-005](backlog/HU-005.md)).
- La Edge Function `enviar-correo`: plantillas en HTML y texto plano, con sus pruebas ([HU-006](backlog/HU-006.md)).
- Los tokens de diseño y las reglas de accesibilidad: texto de 14 px o más, áreas táctiles de 44 px, contraste AA, sin degradados ni iconos de IA ([HU-001](backlog/HU-001.md)).
- Las capturas de `capturas/` como referencia de experiencia de usuario.

Una advertencia: los correos y teléfonos que guarda hoy el prototipo se recogieron sin autorización de tratamiento de datos. No deberían migrarse como leads contactables ([HU-008](backlog/HU-008.md)).

## 2. Mapa de cambios: del prototipo a v10

| Pieza | Hoy en el prototipo | En v10 | Acción | HU |
|---|---|---|---|---|
| Arquitectura | `index.html` único, sin build | Proyecto con framework, build, CI y despliegue en Vercel | Reconstruir | [HU-001](backlog/HU-001.md) |
| Sesión | En memoria; `sesion_id` cambia al recargar | Sesión anónima persistente que se vuelve cuenta | Reconstruir | [HU-004](backlog/HU-004.md) |
| Cuentas | Ninguna; `monitores.clave` pública; puerta por teléfono | Estudiante, Monitor y Admin con login y roles | Nuevo | [HU-004](backlog/HU-004.md), [HU-013](backlog/HU-013.md), [HU-012](backlog/HU-012.md), [HU-032](backlog/HU-032.md) |
| Base de datos | 13 tablas más 2 de la puerta; `schema.sql` con `drop cascade` | 17 entidades de v10 más el banco de preguntas | Reconstruir | [HU-002](backlog/HU-002.md) |
| Contenido | `contenido/*.md` y `convertir.js` | Mismo formato, organizado por evaluación | Portar | [HU-005](backlog/HU-005.md) |
| Diagnóstico | Cálculo en el navegador, resultado por subtema, se pierde al recargar | Cálculo en el servidor, resultado por tema, recuperable | Portar el cálculo, reconstruir el flujo | [HU-005](backlog/HU-005.md), [HU-009](backlog/HU-009.md), [HU-011](backlog/HU-011.md), [HU-031](backlog/HU-031.md) |
| Leads | Sin autorización; también capta monitores y profesores | Lead con autorización (Ley 1581) y estados comerciales | Reconstruir | [HU-008](backlog/HU-008.md), [HU-010](backlog/HU-010.md), [HU-053](backlog/HU-053.md) |
| Certificación | Evaluación presencial, prueba de 3 preguntas y tabla `monitores_aprobados` | Certificado por materia emitido por un admin | Reconstruir | [HU-014](backlog/HU-014.md) |
| Franjas | Horas concretas de 1 h | Franjas semanales con precio y duración | Reconstruir | [HU-015](backlog/HU-015.md) |
| Citas | `reservar_franja()` atómica, sin estados | Monitoria con estados, bloqueo de 10 minutos y plazos | Reconstruir, conservando la reserva atómica | [HU-017](backlog/HU-017.md), [HU-027](backlog/HU-027.md) |
| Pagos | Fuera de la app (`CALIBRA_PAGO`); PSE evaluado y descartado | Transferencia por Llave, comprobante y revisión manual | Nuevo | [HU-007](backlog/HU-007.md), [HU-018](backlog/HU-018.md), [HU-020](backlog/HU-020.md), [HU-034](backlog/HU-034.md) |
| Brief al monitor | Correo al crearse la cita | Hub del monitor, en vivo en las grupales | Reconstruir | [HU-022](backlog/HU-022.md), [HU-040](backlog/HU-040.md) |
| Correo | Edge Function sin dominio verificado | Servicio de correo por eventos | Portar | [HU-006](backlog/HU-006.md) |
| Búsqueda de monitores | Filtros por subtema, precio y nivel; calificaciones de ejemplo; chip "mismo profesor" | Monitores certificados y sus fechas libres | Reconstruir, más simple | [HU-016](backlog/HU-016.md) |
| Perfil del monitor | Carrera, semestre, nivel, precio por hora, encaje, presentación | Campos por definir (P-01); el precio pasa a la franja | Pendiente | [HU-049](backlog/HU-049.md) |
| Canal de profesores | `s-profesor` capta correos | No está en v10 | Decidir (P-43) | Ninguna |
| Admin, reembolsos, desembolsos, inasistencia, reseñas y grupales | No existen | Todo el bloque operativo | Nuevo | Cortes 1 y 2 |
| Pruebas | `verificar.js`, 522 comprobaciones a 390 px | Pruebas del motor de plazos y suite de punta a punta | Reconstruir | [HU-003](backlog/HU-003.md), [HU-048](backlog/HU-048.md) |

## 3. Hallazgos de la revisión

El documento de reglas es sólido: separa lo decidido de lo supuesto, deriva cada plazo en un campo y sus flujos y diccionario son coherentes entre sí. Lo revisé regla por regla contra el diagrama, los flujos y el prototipo, y encontré 26 puntos que no están cubiertos o que chocan entre sí. No agregué reglas: cada punto queda como pregunta con una recomendación, y las HUs afectadas lo citan en su contexto.

Los más delicados:

- **P-25.** Tal como está escrita, la evaluación de T − 24 h convertiría en individual toda grupal de pago único, porque tiene un solo pago por diseño.
- **P-33.** `Diagnostico.idLead` es obligatorio, pero el diagnóstico se hace antes de que exista el Lead.
- **P-22.** Se acepta dejar solo el teléfono, pero todos los enlaces (recuperación, confirmación, reseña, llave del reembolso) salen por correo.
- **P-18.** El modelo no incluye temas ni preguntas, ni su relación con la Evaluación, justo lo que el prototipo ya tiene resuelto.
- **P-28 y P-29.** El desembolso no se puede anular y su monto bruto puede quedar desactualizado.
- **P-43.** El emparejamiento por mismo profesor, uno de los tres diferenciadores del BRIEF, desapareció sin una decisión explícita.

### Preguntas nuevas (P-18 a P-43)

**P-18 · Evaluación, temas y preguntas** (RN-14, RN-20) · **bloquea el corte 1**

- Qué pasa: El Diagnóstico se genera de una Evaluación y guarda `resultadoPorTema`, pero el modelo no incluye Tema, Pregunta, Opción ni knowledge components, ni cómo se relaciona una Evaluación (semana, acumulativa) con los temas. El prototipo sí tiene ese banco.
- Recomendación: Incorporar el banco del prototipo: Tema (hoy subtema) con sus preguntas, y una relación Evaluación–Tema de muchos a muchos. Una evaluación acumulativa incluye los temas de las anteriores de la misma materia.
- HUs: [HU-002](backlog/HU-002.md), [HU-005](backlog/HU-005.md), [HU-009](backlog/HU-009.md), [HU-055](backlog/HU-055.md)

**P-19 · Evaluación presencial y prueba de certificación** (RN-21) · **bloquea el corte 1**

- Qué pasa: Hoy un monitor se aprueba con una evaluación presencial de 15 a 20 minutos y además presenta una prueba de 3 preguntas en la app. En v10 el admin emite el certificado, pero no se dice con base en qué.
- Recomendación: Mantener la evaluación presencial como requisito y dejar constancia en el certificado. La prueba en la app puede quedar como filtro previo opcional.
- HUs: [HU-013](backlog/HU-013.md), [HU-014](backlog/HU-014.md)

**P-20 · Alta de cuentas de monitor** (RN-06) · **bloquea el corte 1**

- Qué pasa: No se define quién crea la cuenta del monitor: autorregistro, invitación del admin o una lista aprobada (lo que hace hoy la migración 003).
- Recomendación: Invitación del admin con un enlace de registro de un solo uso, enviada después de la evaluación presencial.
- HUs: [HU-013](backlog/HU-013.md)

**P-21 · Nombre del Lead** (RN-01, RN-11) · **bloquea el corte 1**

- Qué pasa: RN-01 exige el nombre (no nulo), pero RN-11 solo pide correo y/o teléfono al final del diagnóstico.
- Recomendación: Pedir el nombre en el mismo formulario del contacto.
- HUs: [HU-010](backlog/HU-010.md)

**P-22 · Contacto solo por teléfono** (RN-11, RN-12, RN-44, RN-61, RN-72) · **bloquea el corte 1**

- Qué pasa: Se permite dejar solo el teléfono, pero el enlace de recuperación, la confirmación de la cita, la reseña individual y la solicitud de llave del reembolso salen por correo. No hay canal definido para teléfonos.
- Recomendación: Correo obligatorio y teléfono opcional. WhatsApp o SMS serían un canal nuevo, para más adelante.
- HUs: [HU-006](backlog/HU-006.md), [HU-010](backlog/HU-010.md), [HU-019](backlog/HU-019.md), [HU-025](backlog/HU-025.md), [HU-031](backlog/HU-031.md), [HU-035](backlog/HU-035.md)

**P-23 · Leads duplicados** (RN-01, RN-12) · **bloquea el corte 1**

- Qué pasa: La misma persona en dos navegadores genera dos Leads con el mismo correo. No se define cómo unirlos, y unirlos solo por el correo equivaldría a mostrar resultados con solo escribir un correo, lo que prohíbe RN-12.
- Recomendación: Un Lead por correo normalizado. Si el correo ya existe, se envía un enlace de verificación y la sesión nueva se liga solo cuando se abre.
- HUs: [HU-010](backlog/HU-010.md)

**P-24 · Pago rechazado después de la sesión** (RN-43, RN-45) · **bloquea el corte 1**

- Qué pasa: RN-43 cancela la individual solo si aún no se realizó. Con el escalamiento cíclico, una revisión puede llegar después de la sesión, y no se dice qué pasa entonces.
- Recomendación: No cancelar la monitoría. El pago rechazado queda fuera del desembolso (RN-45) y el admin registra el caso para cobrarlo por fuera o asumirlo.
- HUs: [HU-020](backlog/HU-020.md)

**P-25 · Evaluación de T − 24 h en pago único** (RN-50, RN-55)

- Qué pasa: La evaluación de T − 24 h cuenta pagos y con uno solo convierte la sesión en individual. En modalidad `unico` hay un solo pago por diseño, así que, tal como está escrita, convertiría toda grupal de pago único.
- Recomendación: Aplicar la evaluación solo a la modalidad `dividido`.
- HUs: [HU-041](backlog/HU-041.md)

**P-26 · Integrantes de una grupal de pago único** (RN-16, RN-70, RN-71)

- Qué pasa: En pago único los integrantes no pasan por ningún flujo: no pueden hacer el diagnóstico ligado a la sesión (RN-16) y, como la reseña cuelga del pago, solo el organizador puede reseñar (RN-71).
- Recomendación: Ofrecer el enlace del grupo para el diagnóstico en ambas modalidades, y aceptar que en pago único solo reseña el organizador (o definir otra identidad para la reseña).
- HUs: [HU-036](backlog/HU-036.md), [HU-039](backlog/HU-039.md), [HU-047](backlog/HU-047.md)

**P-27 · Pagos aprobados frente a no rechazados** (RN-55, sección 7)

- Qué pasa: Para seguir siendo grupal se cuentan pagos no rechazados (RN-55), pero la diferencia de la conversión se calcula con pagos aprobados (sección 7). Si el pago del pagador único sigue en revisión, se le cobraría la diferencia por el total.
- Recomendación: Usar el mismo criterio en los dos cálculos (no rechazados) y recalcular si después se rechaza.
- HUs: [HU-041](backlog/HU-041.md), [HU-042](backlog/HU-042.md)

**P-28 · Desembolso de una monitoría cancelada** (RN-62, RN-65, RN-80) · **bloquea el corte 1**

- Qué pasa: El desembolso se crea al pasar a `realizada`. Si después se acepta un reporte de inasistencia, la monitoría pasa a `cancelada`, pero EstadoDesembolso solo tiene `pendiente` y `desembolsado`: queda pendiente para siempre.
- Recomendación: Agregar el estado `anulado`.
- HUs: [HU-002](backlog/HU-002.md), [HU-028](backlog/HU-028.md), [HU-030](backlog/HU-030.md)

**P-29 · Momento del cálculo del monto bruto** (RN-45, RN-80) · **bloquea el corte 1**

- Qué pasa: `montoBruto` se calcula al crear el desembolso con los pagos aprobados en ese momento. Los pagos que se aprueben o rechacen después no lo actualizan.
- Recomendación: Calcular bruto, comisión y neto al ejecutar el desembolso, o recalcular cada vez que cambie un pago de la monitoría.
- HUs: [HU-028](backlog/HU-028.md)

**P-30 · Cambios en franjas con reservas** (RN-30, RN-32, RN-33) · **bloquea el corte 1**

- Qué pasa: El precio se copia al agendar (RN-32), pero el día, la hora y la duración no: si el monitor edita la franja, cambia el inicio de monitorías ya pagadas. Tampoco se definen el cierre de franjas, los solapes entre franjas del mismo monitor ni el bloqueo de fechas puntuales.
- Recomendación: Impedir cambiar día, hora o duración, o cerrar, una franja con reservas futuras; permitir cerrarla para fechas sin reservas; impedir solapes; dejar el bloqueo de fechas para un corte posterior.
- HUs: [HU-015](backlog/HU-015.md)

**P-31 · Lugar o enlace de la sesión** (RN-30) · **bloquea el corte 1**

- Qué pasa: La franja dice si es presencial, pero no dónde (salón) ni con qué enlace (virtual). La cita confirmada no dice a dónde ir.
- Recomendación: Agregar a la franja un lugar o un enlace de videollamada según la modalidad.
- HUs: [HU-015](backlog/HU-015.md)

**P-32 · Comisión visible para el monitor** (RN-81, RN-82)

- Qué pasa: El prototipo prohibía mostrar cifras de comisión porque no estaban validadas. RN-81 ya la fija (10 % con tope de 15.000), pero no se dice si el monitor ve bruto, comisión y neto.
- Recomendación: Mostrarle al monitor bruto, comisión y neto de cada desembolso.
- HUs: [HU-050](backlog/HU-050.md)

**P-33 · Diagnóstico antes de ser Lead** (RN-10, RN-11, RN-14, secciones 6.3 y 10) · **bloquea el corte 1**

- Qué pasa: `Diagnostico.idLead` es obligatorio, pero el visitante hace el diagnóstico antes de dejar su contacto, y Lead exige nombre y consentimiento. La limpieza diaria habla de sesiones anónimas "sin lead", así que existen diagnósticos sin Lead.
- Recomendación: Guardar `idSesionAnonima` en el Diagnóstico y dejar `idLead` nulo hasta que la persona deje su contacto.
- HUs: [HU-002](backlog/HU-002.md), [HU-009](backlog/HU-009.md)

**P-34 · Contacto como condición para ver el resultado** (RN-10, RN-11) · **bloquea el corte 1**

- Qué pasa: F1 dice que "al ver los resultados" se pide el contacto, pero no si es obligatorio para verlos.
- Recomendación: No bloquear el resultado. Pedir el contacto como paso siguiente, con un beneficio claro (recibir el enlace y agendar).
- HUs: [HU-010](backlog/HU-010.md)

**P-35 · Qué diagnóstico se liga al agendar** (RN-14, RN-15) · **bloquea el corte 1**

- Qué pasa: RN-15 dice que el diagnóstico se liga al agendar, pero un Lead puede tener varios (RN-14), incluso de otras materias.
- Recomendación: Ligar el más reciente de la misma materia de la monitoría.
- HUs: [HU-017](backlog/HU-017.md)

**P-36 · Monto del pago** (RN-38, RN-41) · **bloquea el corte 1**

- Qué pasa: RN-38 habla de comprobantes que "cubren" el valor, lo que sugiere que el pagador escribe el monto, pero no se define. Si lo escribe, puede declarar algo distinto de lo que transfirió.
- Recomendación: Fijar el monto al valor esperado (valor de la individual, precio por persona o diferencia). El admin lo verifica contra el comprobante.
- HUs: [HU-018](backlog/HU-018.md), [HU-038](backlog/HU-038.md)

**P-37 · Datos del estudiante que ve el monitor** (RN-13) · **bloquea el corte 1**

- Qué pasa: El consentimiento cubre compartir el diagnóstico con el monitor (RN-13), no el correo ni el teléfono del estudiante.
- Recomendación: El monitor ve el nombre y el diagnóstico. El contacto no, salvo que se agregue al texto del consentimiento.
- HUs: [HU-021](backlog/HU-021.md)

**P-38 · Precio al convertir una grupal en individual** (RN-32, RN-55)

- Qué pasa: Al convertir, `valorTotal` pasa a "el precio de la franja". Si el monitor cambió el precio después de agendar, no se sabe si aplica el vigente o el de ese momento (RN-32 protege las monitorías ya agendadas).
- Recomendación: Guardar también el precio individual al agendar la grupal y usar ese.
- HUs: [HU-041](backlog/HU-041.md)

**P-39 · Plazo de cancelación después de la conversión** (RN-55, RN-60)

- Qué pasa: Una grupal se cancela hasta T − 24 h. Al convertirse en individual justo a T − 24 h, le aplicaría el plazo de 12 h, lo que reabre la cancelación.
- Recomendación: Mantener el plazo de 24 h para las sesiones convertidas.
- HUs: [HU-041](backlog/HU-041.md)

**P-40 · Bordes de los plazos** (Sección 6.1) · **bloquea el corte 1**

- Qué pasa: No se dice si los bordes son inclusivos ("hasta 12 h antes", "al menos 3 h").
- Recomendación: Inclusivos: con 12 h exactas todavía se puede cancelar y con 3 h exactas se puede agendar.
- HUs: [HU-003](backlog/HU-003.md)

**P-41 · Cancelación o reprogramación por el monitor** (RN-60, sección 5.7)

- Qué pasa: El monitor no puede cancelar ni reprogramar, y MotivoCancelacion no tiene un motivo del monitor. Si se enferma, la única vía es que el estudiante reporte inasistencia.
- Recomendación: Agregar la cancelación por el monitor con reembolso total, y contarla para P-09. La reprogramación puede esperar.
- HUs: [HU-021](backlog/HU-021.md)

**P-42 · Autorización de datos de quien paga sin ser Lead** (RN-05, RN-13, RN-44)

- Qué pasa: Los integrantes que pagan sin hacer el diagnóstico dejan nombre y contacto en el Pago, pero el Pago no registra autorización de tratamiento de datos (Ley 1581).
- Recomendación: Agregar la casilla de autorización al formulario de pago y guardarla en el Pago.
- HUs: [HU-038](backlog/HU-038.md), [HU-042](backlog/HU-042.md)

**P-43 · Ideas del BRIEF que no están en v10** (P-16)

- Qué pasa: El BRIEF original ponía como corazón del producto la calibración por subtema, el emparejamiento por mismo profesor y el brief al monitor. v10 conserva la primera y la tercera, pero no el emparejamiento por profesor ni el canal para profesores (`s-profesor`).
- Recomendación: Decidir de forma explícita si se descartan o pasan a ideas futuras, junto con las de P-16.
- HUs: [HU-010](backlog/HU-010.md), [HU-016](backlog/HU-016.md)

### Pendientes del documento original y las HUs que tocan

| ID | Tema | Recomendación del documento | HUs donde aparece |
|---|---|---|---|
| P-01 | Campos de PerfilMonitor | Definirlos con el equipo antes de construir el perfil; las listas van en tablas hijas. | [HU-002](backlog/HU-002.md), [HU-013](backlog/HU-013.md), [HU-016](backlog/HU-016.md), [HU-049](backlog/HU-049.md) |
| P-02 | Regla del descuento grupal y tope de cupos | Diseñarla respetando RN-59: con 2 personas el monitor no gana menos que en una individual. | [HU-036](backlog/HU-036.md) |
| P-03 | Escala de calificación de la reseña | Escala de 1 a 5 y comentario opcional. | [HU-035](backlog/HU-035.md), [HU-047](backlog/HU-047.md) |
| P-04 | Cómo cancela o reporta un Lead sin cuenta | Enlace con token en el correo de confirmación de la cita. | [HU-019](backlog/HU-019.md), [HU-029](backlog/HU-029.md) |
| P-05 | Quién marca `realizada` una individual | Que el monitor la marque y, si no lo hace, recordarle o cerrarla sola después del fin programado. | [HU-023](backlog/HU-023.md) |
| P-06 | Grupal con el primer pago rechazado o sin pagos | Cancelar la monitoría por `pagoRechazado`. | [HU-020](backlog/HU-020.md), [HU-036](backlog/HU-036.md), [HU-041](backlog/HU-041.md) |
| P-07 | Cancelar con el pago en revisión | Crear el reembolso solo cuando el pago quede aprobado. | [HU-024](backlog/HU-024.md), [HU-044](backlog/HU-044.md) |
| P-08 | Casos extremos de cancelación tardía | Definir una lista corta de criterios y registrar quién autorizó. | [HU-052](backlog/HU-052.md) |
| P-09 | Consecuencias para el monitor con reportes aceptados | Contar los reportes aceptados y definir un umbral de suspensión. | [HU-030](backlog/HU-030.md) |
| P-10 | Plazo para entregar la llave del reembolso | Definir un plazo y qué pasa si vence: recordatorio y luego cierre del caso. | [HU-025](backlog/HU-025.md), [HU-026](backlog/HU-026.md) |
| P-11 | Notificaciones al monitor | Al menos: nueva monitoría, cancelación y pago aprobado. | [HU-021](backlog/HU-021.md), [HU-051](backlog/HU-051.md) |
| P-12 | Cupos mínimo y máximo de una grupal | Fijarlo junto con la regla del descuento. | [HU-036](backlog/HU-036.md) |
| P-13 | Retención de datos | Definir los plazos en la política de datos (Ley 1581). | [HU-008](backlog/HU-008.md), [HU-056](backlog/HU-056.md) |
| P-14 | Base de la comisión y quién la asume | Confirmar que sale del monitor y se calcula sobre el total (RN-82). | [HU-028](backlog/HU-028.md) |
| P-15 | Alcance del MVP | Resuelto con la propuesta de cortes de este documento (sección 5). | [HU-001](backlog/HU-001.md) |
| P-16 | Ideas previas no modeladas | Decidir si entran al backlog o quedan como ideas futuras (ver también P-43). | [HU-009](backlog/HU-009.md), [HU-014](backlog/HU-014.md), [HU-016](backlog/HU-016.md), [HU-035](backlog/HU-035.md) |
| P-17 | Stack | Next.js con TypeScript en Vercel, y Supabase para Postgres, Auth, Storage, Realtime y tareas programadas. | [HU-001](backlog/HU-001.md) |

### Observaciones menores

- El documento cita `calibra.puml` y `calibra.png` como archivos hermanos, pero no están en la carpeta. La fuente completa del diagrama está en su sección 11.
- Según el `CLAUDE.md` del prototipo, los códigos FISI-1018, FISI-1019, MATE-1203 e ISIS-1221 no están confirmados contra un programa oficial. Conviene confirmarlos antes de cargarlos ([HU-005](backlog/HU-005.md)), porque `Materia.codigo` es la llave con la que se emparejan.

## 4. Decisiones que desbloquean el corte 1

Estas preguntas aparecen como pendientes en HUs del corte 1. Sin ellas, esas HUs no deberían pasar a `Lista`.

| Pendiente | Tema | HUs del corte 1 que bloquea | Recomendación |
|---|---|---|---|
| P-04 | Cómo cancela o reporta un Lead sin cuenta | [HU-019](backlog/HU-019.md), [HU-029](backlog/HU-029.md) | Enlace con token en el correo de confirmación de la cita. |
| P-05 | Quién marca `realizada` una individual | [HU-023](backlog/HU-023.md) | Que el monitor la marque y, si no lo hace, recordarle o cerrarla sola después del fin programado. |
| P-07 | Cancelar con el pago en revisión | [HU-024](backlog/HU-024.md) | Crear el reembolso solo cuando el pago quede aprobado. |
| P-10 | Plazo para entregar la llave del reembolso | [HU-025](backlog/HU-025.md) | Definir un plazo y qué pasa si vence: recordatorio y luego cierre del caso. |
| P-13 | Retención de datos | [HU-008](backlog/HU-008.md) | Definir los plazos en la política de datos (Ley 1581). |
| P-14 | Base de la comisión y quién la asume | [HU-028](backlog/HU-028.md) | Confirmar que sale del monitor y se calcula sobre el total (RN-82). |
| P-17 | Stack | [HU-001](backlog/HU-001.md) | Next.js con TypeScript en Vercel, y Supabase para Postgres, Auth, Storage, Realtime y tareas programadas. |
| P-18 | Evaluación, temas y preguntas | [HU-002](backlog/HU-002.md), [HU-005](backlog/HU-005.md), [HU-009](backlog/HU-009.md) | Incorporar el banco del prototipo: Tema (hoy subtema) con sus preguntas, y una relación Evaluación–Tema de muchos a muchos. Una evaluación acumulativa incluye los temas de las anteriores de la misma materia. |
| P-19 | Evaluación presencial y prueba de certificación | [HU-013](backlog/HU-013.md), [HU-014](backlog/HU-014.md) | Mantener la evaluación presencial como requisito y dejar constancia en el certificado. La prueba en la app puede quedar como filtro previo opcional. |
| P-20 | Alta de cuentas de monitor | [HU-013](backlog/HU-013.md) | Invitación del admin con un enlace de registro de un solo uso, enviada después de la evaluación presencial. |
| P-21 | Nombre del Lead | [HU-010](backlog/HU-010.md) | Pedir el nombre en el mismo formulario del contacto. |
| P-22 | Contacto solo por teléfono | [HU-010](backlog/HU-010.md), [HU-019](backlog/HU-019.md), [HU-025](backlog/HU-025.md) | Correo obligatorio y teléfono opcional. WhatsApp o SMS serían un canal nuevo, para más adelante. |
| P-23 | Leads duplicados | [HU-010](backlog/HU-010.md) | Un Lead por correo normalizado. Si el correo ya existe, se envía un enlace de verificación y la sesión nueva se liga solo cuando se abre. |
| P-24 | Pago rechazado después de la sesión | [HU-020](backlog/HU-020.md) | No cancelar la monitoría. El pago rechazado queda fuera del desembolso (RN-45) y el admin registra el caso para cobrarlo por fuera o asumirlo. |
| P-28 | Desembolso de una monitoría cancelada | [HU-002](backlog/HU-002.md), [HU-028](backlog/HU-028.md), [HU-030](backlog/HU-030.md) | Agregar el estado `anulado`. |
| P-29 | Momento del cálculo del monto bruto | [HU-028](backlog/HU-028.md) | Calcular bruto, comisión y neto al ejecutar el desembolso, o recalcular cada vez que cambie un pago de la monitoría. |
| P-30 | Cambios en franjas con reservas | [HU-015](backlog/HU-015.md) | Impedir cambiar día, hora o duración, o cerrar, una franja con reservas futuras; permitir cerrarla para fechas sin reservas; impedir solapes; dejar el bloqueo de fechas para un corte posterior. |
| P-31 | Lugar o enlace de la sesión | [HU-015](backlog/HU-015.md) | Agregar a la franja un lugar o un enlace de videollamada según la modalidad. |
| P-33 | Diagnóstico antes de ser Lead | [HU-002](backlog/HU-002.md), [HU-009](backlog/HU-009.md) | Guardar `idSesionAnonima` en el Diagnóstico y dejar `idLead` nulo hasta que la persona deje su contacto. |
| P-34 | Contacto como condición para ver el resultado | [HU-010](backlog/HU-010.md) | No bloquear el resultado. Pedir el contacto como paso siguiente, con un beneficio claro (recibir el enlace y agendar). |
| P-35 | Qué diagnóstico se liga al agendar | [HU-017](backlog/HU-017.md) | Ligar el más reciente de la misma materia de la monitoría. |
| P-36 | Monto del pago | [HU-018](backlog/HU-018.md) | Fijar el monto al valor esperado (valor de la individual, precio por persona o diferencia). El admin lo verifica contra el comprobante. |
| P-37 | Datos del estudiante que ve el monitor | [HU-021](backlog/HU-021.md) | El monitor ve el nombre y el diagnóstico. El contacto no, salvo que se agregue al texto del consentimiento. |
| P-40 | Bordes de los plazos | [HU-003](backlog/HU-003.md) | Inclusivos: con 12 h exactas todavía se puede cancelar y con 3 h exactas se puede agendar. |

Si el equipo acepta en bloque las recomendaciones de las tablas anteriores, casi todo el corte 1 se puede dar por refinado en una sola reunión.

## 5. Cortes propuestos

| Corte | Prioridad | HUs | Tallas | Qué cubre |
|---|---|---|---|---|
| Corte 1 (MVP) | P0 | 30 (HU-001 a HU-030) | 6 S, 16 M, 8 L | El flujo individual de punta a punta con dinero real: base técnica, diagnóstico anónimo, Lead con autorización, certificación, franjas, agendar, pagar por Llave, revisión del admin, agenda y hub del monitor, finalizar, cancelar con reembolso, inasistencia y desembolso. |
| Corte 2 | P1 | 18 (HU-031 a HU-048) | 1 XS, 2 S, 14 M, 1 L | Recuperación desde otro dispositivo, cuentas de Estudiante, escalamiento de pagos, reseñas, sesiones grupales completas (pago dividido, conversión a individual, hub en vivo) y pruebas de punta a punta. |
| Corte 3 | P2 | 7 (HU-049 a HU-055) | 4 S, 3 M | Perfil del monitor, vista de sus desembolsos, avisos al monitor, cancelación excepcional, gestión de leads, de admins y de materias. |
| Ideas futuras | P3 | 1 (HU-056) | 1 S | Limpieza de sesiones anónimas, que depende de la política de retención (P-13). |

Tres decisiones de alcance que propongo y que el equipo debe validar, porque dejan para después reglas marcadas como decididas:

- El escalamiento automático de pagos (RN-42) pasa al corte 2 ([HU-034](backlog/HU-034.md)). Con uno o dos admins, asignar al primero de la lista basta para empezar.
- La recuperación de resultados desde otro dispositivo (RN-12) pasa al corte 2 ([HU-031](backlog/HU-031.md)). En el corte 1 el visitante vuelve desde el mismo navegador ([HU-011](backlog/HU-011.md)) y gestiona su cita con el enlace de confirmación ([HU-019](backlog/HU-019.md)).
- Las cuentas de Estudiante y las grupales pasan al corte 2. El corte 1 cubre el flujo individual completo, que según RN-03 no necesita cuenta.

En sentido contrario, el reporte de inasistencia ([HU-029](backlog/HU-029.md), [HU-030](backlog/HU-030.md)) queda en el corte 1: desde el primer día se mueve dinero real, y sin ese reporte un estudiante que pagó no tiene ningún recurso si el monitor no llega.

## 6. Cómo quedó en el backlog

- Cada HU se creó con `python scripts/backlog.py new "título" -p ... -e ... -d ...`, como indica `GUIA_CLAUDE.md`, y después se completó solo el cuerpo del archivo siguiendo la plantilla: historia, contexto, criterios Dado/Cuando/Entonces, fuera de alcance, notas técnicas y definición de terminado. El frontmatter y `BACKLOG.md` los escribió el script.
- Cada HU indica su tipo de usuario, corte, épica (E1 a E13), reglas que implementa, pendientes y qué cambia frente a la app actual.
- Todas quedaron en `Backlog`. La guía pide el acuerdo del equipo antes de `ready`, y el script no tiene un comando para devolver una HU de `Lista` a `Backlog`.
- La numeración sigue el orden de ejecución, no el tipo de usuario, porque el script solo acepta dependencias hacia HUs que ya existen y `take` desempata por número. El tipo de usuario va entre corchetes en el título, y la agrupación completa está en `HU_POR_ACTOR.md`.
- El registro de cada HU tiene una línea con su origen y sus pendientes.

Para arrancar, desde la carpeta del backlog:

```bash
python scripts/backlog.py list
python scripts/backlog.py show HU-001
python scripts/backlog.py ready HU-001   # cuando el equipo confirme el stack (P-17)
python scripts/backlog.py take           # en la sesión que va a construir
```

HUs sin pendientes, que se pueden pasar a `Lista` apenas el equipo las lea: [HU-004](backlog/HU-004.md), [HU-006](backlog/HU-006.md), [HU-007](backlog/HU-007.md), [HU-011](backlog/HU-011.md), [HU-012](backlog/HU-012.md), [HU-016](backlog/HU-016.md), [HU-022](backlog/HU-022.md), [HU-026](backlog/HU-026.md), [HU-027](backlog/HU-027.md), [HU-033](backlog/HU-033.md), [HU-034](backlog/HU-034.md), [HU-037](backlog/HU-037.md), [HU-040](backlog/HU-040.md), [HU-043](backlog/HU-043.md), [HU-045](backlog/HU-045.md), [HU-046](backlog/HU-046.md), [HU-048](backlog/HU-048.md), [HU-053](backlog/HU-053.md), [HU-054](backlog/HU-054.md).
