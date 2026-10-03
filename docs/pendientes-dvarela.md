# Pendientes de dvarela5101

**Actualizado:** 1 de octubre de 2026. Son las tareas que solo tú puedes hacer: tocan cuentas, contraseñas, paneles o decisiones del producto. Van ordenadas por **cuándo hacen falta**. Marca cada una al terminarla, o dile a Claude "ya hice X" y él marca la casilla y sigue.

Nada de lo de aquí se pega en el chat ni se guarda en el repo: las contraseñas y las llaves van directo al panel que corresponda.

**Cómo está hoy el proyecto.** La app solo corre en local (cada una con su Supabase en Docker). GitHub no tiene los secretos de Vercel, así que el CI pasa en verde pero **no despliega** (el paso "Desplegar en Vercel" se salta con un aviso). La base en la nube no se toca hasta el corte (HU-057): hasta entonces sostiene el prototipo en vivo.

---

## A. Ahora (no dependen de nada)

### A1. Aprobar las HUs en revisión

Si te gusta, dile a Claude "apruebo HU-XXX" (él corre `python scripts/backlog.py done HU-XXX` en `main`). Si algo no te gusta, dilo: se corrige en un PR nuevo. Para probarlas: `npm run db:iniciar`, `npm run db:env`, `npm run dev` y abre http://localhost:3000.

- [x] **HU-008, aviso de privacidad**: aprobada el 29-sep.
- [x] **HU-013, cuenta de monitor por invitación**: aprobada el 29-sep.
- [x] **HU-063 de Juzou04**: aprobada el 29-sep con cambios menores (van en HU-064 y en una nota de HU-028).
- [x] **HU-066, correos por Gmail** ([PR #9](https://github.com/dvarela5101/calibra-v10/pull/9)). Se prueba de verdad cuando cargues las variables SMTP (sección B).
- [x] **HU-065, reintentar los correos que fallaron** ([PR #10](https://github.com/dvarela5101/calibra-v10/pull/10)). En local se prueba con las pruebas; en la nube necesita lo de la sección C.
- [x] **HU-015, franjas del monitor.** Entra como monitor certificado a `/monitor/franjas`: abre, edita y cierra franjas. Las decisiones que te tocan están en A2.
- [x] **HU-064, ajustes de la revisión de HU-006 y HU-012.** Textos de la bandeja, https en producción para los enlaces de los correos, server-only y la prueba del admin desactivado.
- [x] **HU-014, certificar monitores** ([PR #13](https://github.com/dvarela5101/calibra-v10/pull/13)): aprobada el 30-sep.
- [x] **HU-068, contacto al agendar.** Aprobada el 30-sep. Las decisiones que quedaron abiertas están en A2.
- [x] **HU-016, HU-017, HU-021, HU-023, HU-059, HU-062 y HU-067**: aprobadas entre el 30-sep y el 1-oct.
- [x] **HU-035, reseña desde el correo**: aprobada el 2-oct. Sus decisiones siguen en A2.
- [x] **HU-070, correo seguro**: aprobada el 2-oct.
- [x] **HU-018, pagar por Llave** (de Juzou04, [PR #28](https://github.com/dvarela5101/calibra-v10/pull/28)): aprobada el 2-oct tras la revisión. Sus supuestos siguen abiertos en A2.
- [x] **HU-005, HU-051, HU-054, HU-069 y HU-071**: aprobadas el 2-oct.
- [x] **HU-019 y HU-073**: aprobadas el 2-oct. Los textos de HU-019 siguen en A2.
- [x] **HU-027, expirar reservas** (de Juzou04, [PR #31](https://github.com/dvarela5101/calibra-v10/pull/31)): aprobada el 2-oct.
- [x] **HU-020, revisar pagos** (de Juzou04, [PR #32](https://github.com/dvarela5101/calibra-v10/pull/32)): aprobada el 2-oct. Para verla: agenda y paga dos monitorías como en HU-018. Los pagos le quedan a `admin1@calibra.test` (contraseña `calibra-admin-local`), que va primero en el orden. Entra con esa cuenta a `/admin` y abre un pago desde la bandeja:
  - "Ver comprobante" abre la imagen con un enlace que dura 60 segundos;
  - "Aprobar pago" lo saca de la bandeja;
  - en el otro pago, "Rechazar el pago" te muestra qué va a pasar antes de confirmar. La cita se cancela, la fecha vuelve a la lista y el correo al pagador llega a Mailpit (http://127.0.0.1:54324).

  Si abres la misma dirección con `admin2@calibra.test`, ves el pago sin botones. Los supuestos que te tocan están en A2.
- [ ] **HU-074, pagos de un admin que se desactiva** (de Juzou04, [PR #34](https://github.com/dvarela5101/calibra-v10/pull/34)): agenda y paga una monitoría como en HU-018, y el pago le queda a `admin1@calibra.test`. Entra con `admin2@calibra.test` (contraseña `calibra-admin-local`) a `/admin/equipo`. La tarjeta de Admin Uno dice "1 caso abierto". Desactívalo: el aviso dice a quién pasaron sus casos, y en `/admin` de admin2 aparece el pago con una hora nueva para revisarlo. Reactivar todavía no tiene pantalla (HU-072): para volver a tener a Admin Uno, `npm run db:reiniciar`.
- [ ] **HU-075, tope de correos al dejar el contacto** (de Juzou04, [PR #35](https://github.com/dvarela5101/calibra-v10/pull/35)): abre `/agendar/contacto` en una ventana de incógnito y deja tu contacto con un correo. Después entra a `/agendar/contacto?editar=1` y cambia el correo cuatro veces, cada vez por uno distinto. Al quinto cambio, que es el sexto correo distinto, ves «Probaste varios correos seguidos. Espera un rato y vuelve a intentarlo.» y el contacto no cambia. Volver a escribir uno de los correos que ya usaste sí funciona.
- [ ] **HU-028, ejecutar desembolsos** (de Juzou04, [PR #37](https://github.com/dvarela5101/calibra-v10/pull/37)): cuando una monitoría pasa a realizada se crea su desembolso, y pasadas 24 horas del fin aparece en «Desembolsos ejecutables» de la bandeja. Como en local habría que esperar ese día, lo más rápido es ver la prueba en el navegador: `CI=1 npx playwright test e2e/desembolsos.spec.ts --headed`. Abre el desembolso desde la bandeja, muestra el neto y la llave del monitor (nunca la comisión), y registra la transferencia con referencia y fecha. La prueba también abre uno con un reporte en revisión, que se ve con el motivo y sin formulario. Los casos con un pago en revisión (D-39) o sin pagos aprobados los cubren las pruebas de integración y de pgTAP.
- [ ] **HU-077, revisar un pago vencido de otro admin** (de Juzou04, [PR #38](https://github.com/dvarela5101/calibra-v10/pull/38)): agenda y paga una monitoría como en HU-018; el pago le queda a `admin1@calibra.test`. Entra con `admin2@calibra.test` a `/admin/pagos/<id>`: durante la primera hora ves «Este pago está asignado a Admin Uno hasta el …» y ningún botón. Pasada la hora (o en la prueba `CI=1 npx playwright test e2e/revisar-pagos.spec.ts --headed`), el pago aparece en la bandeja de admin2 como «De Admin Uno · Vencido hace …», y admin2 lo puede aprobar o rechazar. El pago revisado dice quién lo revisó.
- [ ] **HU-078, pagos por cobrar o asumir** (de Juzou04, [PR #39](https://github.com/dvarela5101/calibra-v10/pull/39)): rechaza, como admin, el pago de una monitoría cuya sesión ya empezó (P-24, con observaciones). El caso aparece en la sección «Pagos por cobrar o asumir» de la bandeja, para todos los admins. Ábrelo y ciérralo como cobrado o asumido, con una nota opcional: sale de la sección y queda quién lo cerró y cuándo. Mientras está abierto, el desembolso de esa monitoría no se puede ejecutar; cerrado, el monto de ese pago cuenta en el desembolso. La prueba en el navegador: `CI=1 npx playwright test e2e/casos-p24.spec.ts --headed`.
- [ ] **HU-029, reportar inasistencia** (tu código, cerrado por Juzou04, rama `hu-029-reportar`): abre una cita confirmada cuya sesión ya empezó, desde el enlace del correo o desde «Mis citas». Aparece el botón «El monitor no llegó». Al reportar, el caso queda en revisión, asignado a un admin, y el desembolso de esa monitoría no se puede ejecutar mientras tanto (RN-83). Con la cita ya reportada, o pasadas 24 horas del fin, el botón ya no está. La prueba de integración `integracion/reportar.test.ts` lo recorre contra la base.
- [ ] **Las HUs que Claude saque mientras no estás** quedan `En revision`; la lista está en `BACKLOG.md` y cada una trae en su registro cómo verificarla.

### A2. Decisiones de las HUs recientes

- [ ] **Texto del aviso de privacidad (HU-008).** Además de lo que pide la HU, el aviso menciona los datos del pagador y el comprobante, el uso para revisar pagos y tramitar reembolsos, y los correos sobre citas y pagos. Salen del modelo de datos, pero no estaban escritos como regla. Confirma que quedan o dime qué quitar.
- [ ] **Franjas (HU-015): certificado para abrir franjas.** Un monitor sin certificado no puede abrir franjas: nadie podría agendarle, porque la monitoría exige una materia certificada. Sale del orden del flujo F2, no de una regla escrita. Recomendación: dejarlo así.
- [ ] **Franjas (HU-015): cambiar el horario.** P-30 dice que no se cambian día, hora ni duración con reservas **futuras**. Hoy tampoco se cambian si la franja tiene monitorías **pasadas** (no canceladas): los plazos de cada monitoría (inicio, fin, ventana de reporte, desembolso) se calculan con el horario actual de la franja, y cambiarlo reescribiría el historial. Para otro horario se cierra la franja y se abre otra. Recomendación: dejarlo así. La otra opción es guardar hora y duración en cada monitoría, como el precio.
- [x] **Franjas (HU-015): cambiar entre presencial y virtual.** Con monitorías futuras no se puede (el estudiante agendó una modalidad). El lugar y el enlace sí se corrigen, pero hoy nadie avisa al estudiante del cambio. Recomendación: dejarlo así y avisar cuando exista el correo de la cita (HU-019). **Decidido el 2-oct (D-23):** sin aviso por correo por ahora; la página de la cita (HU-019) siempre muestra el dato actual.
- [ ] **Franjas (HU-015): una franja cerrada es definitiva.** Cuando llega su fecha de cierre ya no se edita ni se reabre; para volver a ofrecer ese horario se abre otra. Un cierre programado para más adelante sí se puede mover. Recomendación: dejarlo así.
- [x] **Franjas (HU-015): cuándo ve el estudiante el lugar y el enlace.** Hoy nadie fuera del monitor los ve: con el enlace a la vista, cualquiera entraría a una sesión pagada. Recomendación: el enlace solo en la cita confirmada (HU-019). El lugar de una presencial se podría mostrar antes, al elegir la franja (HU-016), porque ayuda a decidir. Dime si el lugar se muestra al agendar. **Decidido el 30-sep (D-5):** el lugar tampoco se muestra antes de agendar; llega con la cita confirmada.
- [ ] **Contacto al agendar (HU-068): detalles del enlace para confirmar el correo.** Cuando alguien escribe un correo que ya es de otro contacto, le mandamos un enlace a ese correo (P-23). Recomendación para cada punto:
  - el enlace vence a las 24 horas;
  - se mandan como máximo 3 por hora al mismo contacto, para que nadie le llene el buzón;
  - el navegador que queda con los datos es el que abre el enlace y confirma, no el que escribió el correo. Así nadie ve los datos de otra persona con solo escribir su correo.

  Confirma o dime qué cambiar.
- [ ] **Contacto al agendar (HU-068): lo que la revisión dejó para ti.** Ninguna de las dos frena el MVP:
  - El primer correo no se verifica (P-23). Quien escriba primero el correo de otra persona crea ese contacto y su navegador lo conserva. Si después la dueña real confirma el enlace, comparte ese contacto con ese navegador. Recomendación: aceptarlo en el MVP. Más adelante, cuando alguien confirme un correo que nunca se verificó, el navegador que lo escribió pierde el acceso salvo que también lo confirme.
  - El aviso "Ese correo ya está en Calibra" le dice a quien escribe que ese correo existe. Recomendación: aceptarlo con el CAPTCHA (HU-058) y un tope de intentos por sesión antes de publicar. La otra opción es verificar todo correo antes de crear el contacto, que cambia el criterio 1 y agrega un paso.
- [ ] **Contacto al agendar (HU-068): teléfono sin indicativo.** Si alguien escribe el teléfono sin "+", se guarda con el de Colombia (+57). Recomendación: dejarlo así.
- [ ] **Contacto al agendar (HU-068): origen del contacto.** Si alguien llega por un enlace de campaña (`?utm_campaign=...`), el contacto guarda la última campaña con la que llegó en los últimos 30 días. Recomendación: dejarlo así. Para tus campañas, usa enlaces con `utm_campaign`.
- [x] **Monitores y fechas libres (HU-016).** Decidido el 30-sep (D-4 a D-6 en `REVISION_REGLAS.md` §4): todo como se recomendó. 4 semanas; sin fechas libres o desactivado no aparece; orden por la fecha más próxima y luego por nombre; enlace desde el inicio; solo "Presencial", sin lugar; el nombre como lo registró, y el aviso de privacidad lo cubre [HU-069](../backlog/HU-069.md).
- [ ] **Reseña individual (HU-035).** Recomendación para cada punto:
  - el comentario admite hasta 1000 caracteres;
  - la reseña la deja quien tenga el enlace del correo, sin iniciar sesión (RN-72), y el enlace no vence;
  - el aviso de privacidad todavía no menciona las reseñas: queda en [HU-073](../backlog/HU-073.md) (Backlog), con el texto que te propongo.

  Confirma o dime qué cambiar.
- [x] **Correo seguro (HU-070): qué correos se rechazan.** Antes de la arroba solo se aceptan letras, dígitos y `. _ % + ' -`. Quedan fuera direcciones válidas pero raras, con `!`, `&`, `*` o `/`, y las de dominio con tildes o ñ. Recomendación: dejarlo así; nadie en una universidad colombiana usa esas direcciones. **Aceptado el 2-oct.**
- [x] **Agendar, confirmar, cancelar y CAPTCHA (HU-019, HU-024, HU-058, HU-073, HU-074).** Decidido el 2-oct en la hoja de decisiones: D-19 a D-35 en `REVISION_REGLAS.md` §4.
- [x] **Cancelar (HU-024): el correo de cancelación (D-27).** Decidido el 2-oct: lo manda HU-024 con el enlace a la página de la llave de HU-025, y se mantiene RN-60 (fuera de plazo no se cancela).
- [x] **Tope de correos por sesión (HU-075).** Decidido el 2-oct (D-36): 5 correos distintos por sesión cada hora; cuentan todos; al pasarse se pide esperar.
- [ ] **Pagar por Llave (HU-018): lo que dejó Juzou04.** Las recomendaciones son las suyas:
  - la llave, su titular y la imagen del QR van como variables de Vercel (sección C). Tendrás que subir la imagen del QR a una dirección pública;
  - la página muestra el nombre, el documento y el correo del proveedor. El art. 50 de la Ley 1480 pide también dirección y teléfono, que no tienen variable: validarlo con asesoría legal;
  - el pagador es el Lead, con su nombre y correo prellenados y editables, y el contacto es siempre un correo;
  - un comprobante respalda un solo pago en todo el sistema. Afectará a las grupales si una transferencia cubre varias citas;
  - sin ningún admin activo, el pago se rechaza con un mensaje (la pantalla del equipo no deja desactivar al último);
  - quien transfirió pero llegó tarde solo ve «tu reserva expiró». Falta decidir qué se le dice y cómo se le devuelve el dinero;
  - con cualquier comprobante válido la cita se confirma y se avisa al monitor antes de que un admin lo revise (RN-38). Hasta HU-020, la revisión es solo posterior.
- [x] **Revisar pagos (HU-020): lo que dejó Juzou04.** **Decidido el 2-oct (D-38):** se aceptan, salvo dos que van en HUs nuevas: el monitor sí recibe un correo cuando el rechazo cancela su cita ([HU-076](../backlog/HU-076.md)), y un pago que el asignado no revisó a tiempo lo puede revisar cualquier admin activo ([HU-077](../backlog/HU-077.md)). Las recomendaciones eran:
  - solo revisa el admin asignado, aunque se le haya pasado la hora. Los demás admins ven el pago sin botones. Pasarlo a otro admin es de HU-034 (escalamiento) y HU-074 (admin desactivado);
  - si la sesión ya empezó, rechazar el pago no cancela la cita: cuenta como realizada (P-24);
  - en ese caso el admin tiene que escribir qué se hará con el cobro, cobrarlo por fuera o asumirlo. Queda en una columna nueva del pago, `observaciones`;
  - al pagador solo se le escribe cuando el rechazo cancela la cita. Si la sesión ya empezó o el estudiante ya había cancelado, no le llega correo;
  - al monitor no se le avisa del rechazo: ve el estado del pago en su agenda (D-11);
  - aprobar o rechazar no se deshace (§5.2), y rechazar pide confirmación;
  - los pagos de las grupales no se revisan todavía: llegan con HU-038.
- [x] **Revisar pagos (HU-020): lo que encontró la revisión del PR #32.** **Decidido el 2-oct (D-39):** los casos P-24 se ven en la bandeja y se cierran como cobrados o asumidos, y en los dos casos el monto cuenta en el desembolso ([HU-078](../backlog/HU-078.md)); un desembolso espera a que se revisen los pagos de su monitoría ([HU-028](../backlog/HU-028.md)); el correo del rechazo al pagador se anota en la misma transacción, y si la cita ya estaba cancelada le llega uno corto sin reembolso ([HU-076](../backlog/HU-076.md)); se aceptan las observaciones obligatorias solo en P-24 y las grupales con HU-038.
- [x] **Revisar pagos (HU-020): la referencia de la transferencia.** **Decidido el 2-oct (D-38):** se deja así, sin HU para marcar referencias repetidas por ahora. HU-007 y HU-059 dicen que marcar como posible duplicado una referencia ya usada va con HU-020. Pero hoy nadie escribe la referencia (HU-018 no la pide), así que la revisión muestra "Sin referencia" y no tiene con qué comparar. Lo que sí está cubierto es que un mismo comprobante no respalda dos pagos. Recomendación: una HU aparte que pida la referencia al pagar y que marque las repetidas en la revisión.
- [ ] **Pagos de un admin que se desactiva (HU-074): lo que dejó Juzou04.** Las recomendaciones son las suyas:
  - nadie recibe correo por la reasignación: quien desactiva ve a quién pasaron los casos, y quien los recibe los ve en su bandeja;
  - el pago reasignado empieza una hora nueva para revisarlo, y en la bandeja de quien lo recibe queda detrás de los que ya tenía;
  - "casos abiertos" sigue siendo un solo número, que ahora suma los pagos en revisión;
  - los pagos ya aprobados o rechazados se quedan con el admin desactivado (RN-23).
- [ ] **Confirmación de la cita (HU-019): textos que puso Claude.** Recomendación: dejarlos así.
  - En la página, el texto del pago dice «…te avisamos por correo.» (en el correo, «…a este correo», D-22), porque quien abre el enlace desde otro dispositivo no está «en este correo».
  - Con el pago aprobado: «Tu pago está aprobado.»; con el pago rechazado y la cita aún confirmada: «No pudimos verificar tu pago.», sin lugar ni enlace.
  - Si alguien agenda cuando ya pasó el plazo para cancelar, el correo dice «No podrás cancelarla: cuando la agendaste ya había pasado el plazo para hacerlo.» No nombra las 12 horas: los plazos no se escriben fijos en los correos (viven en la base).
  - El enlace de la videollamada se muestra como «Abrir la videollamada», no la dirección completa.
  - Los motivos de cancelación y el estado del reembolso en palabras (por ejemplo, «Vamos a devolverte el dinero. Te escribimos al correo del pago para pedirte la llave.») son una primera versión; HU-024 y HU-025 los ajustan.
- [ ] **Tope de correos (HU-075): lo que dejó Juzou04.** Las recomendaciones son las suyas:
  - el tope cuenta también los cambios de correo en `/agendar/contacto?editar=1`. Esa pantalla responde «Ese correo ya es de otro contacto de Calibra»; sin tope, bastaría dejar un primer correo para probar todos los demás;
  - volver a enviar el correo que la sesión ya tiene guardado (para cambiar solo el nombre o el teléfono) no cuenta: no revela nada;
  - para contar, la base guarda el hash de cada correo escrito, no el correo, y lo borra cuando pasa la hora: en el siguiente envío de esa sesión o en la limpieza horaria, así que dura menos de dos horas. Por eso no cambia el aviso de privacidad;
  - un correo inválido o un envío sin la autorización no cuentan, porque se rechazan antes de llegar a la base.
- [ ] **Desembolsos (HU-028): lo que dejó Juzou04.** El primer supuesto (no se ejecuta con un pago en revisión) ya lo decidiste con D-39. Los demás, con la recomendación de Juzou04:
  - si al ejecutar no hay pagos aprobados (por ejemplo, el único se rechazó por P-24), no se ejecuta y la pantalla dice que no hay nada que transferir. El desembolso sigue pendiente hasta que se decida qué hacer con esos casos (HU-078 los cierra como cobrados o asumidos);
  - el admin escribe la referencia y la fecha de la transferencia: la fecha viene con hoy y no puede ser futura ni anterior a la sesión;
  - la pantalla muestra el neto y la llave destino, nunca el bruto ni la comisión (CLAUDE.md, P-32);
  - dos admins podrían transferir el mismo desembolso por fuera de la app: la base solo deja registrarlo una vez y al segundo le dice que ya se desembolsó. Con dos admins se acepta ese riesgo;
  - por ahora solo las individuales generan desembolso; las grupales llegan con HU-036, HU-038 y HU-046;
  - no se le avisa al monitor por correo (D-16 no lo incluye).
- [ ] **Pagos vencidos (HU-077): lo que dejó Juzou04.** Las recomendaciones son las suyas:
  - la hora del asignado termina una hora después de asignado el pago; justo en ese instante el pago todavía es solo suyo (P-40);
  - para que otro admin lo encuentre, «Pagos por revisar» de su bandeja muestra también los pagos vencidos de los demás, después de los propios, con de quién son y desde cuándo están vencidos;
  - quien revisó queda en una columna nueva del pago; a los pagos ya revisados se les puso el asignado, que era el único que podía revisarlos;
  - revisar el pago de otro no se lo reasigna: el asignado sigue siendo el mismo (reasignar es de HU-034);
  - el asignado puede seguir revisándolo después de su hora.
- [ ] **Casos P-24 (HU-078): lo que dejó Juzou04.** Las recomendaciones son las suyas:
  - un caso es un pago rechazado cuya monitoría no quedó cancelada; si el rechazo la canceló, o el estudiante ya la había cancelado, no hay nada que cobrar ni asumir;
  - la sección la ven todos los admins activos y cualquiera cierra el caso;
  - el caso se cierra desde la página del pago, con una nota opcional de hasta 500 caracteres;
  - un caso cerrado cuenta en el desembolso aunque se cierre después de que la monitoría se realizó, porque el monto se recalcula al ejecutar (P-29);
  - si no hay pagos aprobados ni casos cerrados, el desembolso sigue sin poder ejecutarse.
- [ ] **Reportar inasistencia (HU-029): preguntas que quedaron en tu código.** Al cerrarla, Juzou04 encontró estas decisiones sin confirmar; el registro de la HU hablaba de cuatro preguntas, pero en el código solo aparecen tres:
  - si no hay ningún admin activo, el reporte no se crea y la persona ve «Intenta de nuevo en unos minutos» con el correo de soporte;
  - RN-62 no mira el pago, así que se puede reportar aunque el pago esté rechazado o en revisión (P-24);
  - las observaciones del admin al resolver deben tener texto y hasta 500 caracteres (le pone ese límite a HU-030);
  - las observaciones del admin solo se muestran en la página cuando el reporte se rechaza, aunque la base las entrega siempre (D-37);
  - el texto «te devolvemos el dinero de tu pago» no distingue cuando pagó otra persona: D-37 le reembolsa a cada pagador.
- [ ] **Correo que ya tiene cuenta (HU-013).** Si invitas a un correo que ya tiene cuenta de Calibra (por ejemplo, de estudiante), hoy el registro no la convierte en monitor y le pide escribir al equipo. Confirma que así está bien, o pide que se pueda convertir.

### A3. Preparar la cuenta de Gmail (para HU-066)

La app va a enviar los correos desde `calibra.monitorias@gmail.com` (decisión D-1). Google exige una contraseña de aplicación.

- [ ] Activa la **verificación en dos pasos** en esa cuenta: Cuenta de Google, **Seguridad**, **Verificación en dos pasos**.
- [ ] Crea una **contraseña de aplicación**: Cuenta de Google, **Seguridad**, **Contraseñas de aplicaciones**. Nombre: "Calibra". Google muestra 16 letras una sola vez: guárdalas en un gestor de contraseñas hasta el paso B.
- [ ] Guarda la contraseña normal de la cuenta donde también la pueda usar Juzou04, para que la cuenta no dependa de una sola persona.
- [ ] No desactives la verificación en dos pasos: Google borraría la contraseña de aplicación y los correos dejarían de salir.
- [ ] Revisa el buzón con frecuencia. El aviso de privacidad promete responder consultas de datos en máximo 10 días hábiles y reclamos en máximo 15.

---

## B. Cuando quieras ver la app publicada en Vercel

Sin esto, cada PR se prueba solo en local. Ojo: mientras no haya base en la nube (paso C), el sitio publicado muestra las páginas pero no tiene inicio de sesión ni datos.

- [ ] **Conectar el repo a Vercel.** En tu terminal, dentro de `calibra-v10`: `npx vercel link` (crea o elige el proyecto). Anota el `orgId` y el `projectId` que quedan en `.vercel/project.json` (esa carpeta no se versiona).
- [ ] **Crear un token** en vercel.com/account/tokens.
- [ ] **Cargar tres secretos en GitHub:** repo `dvarela5101/calibra-v10`, **Settings**, **Secrets and variables**, **Actions**: `VERCEL_TOKEN`, `VERCEL_ORG_ID` y `VERCEL_PROJECT_ID`. Desde ahí el CI despliega `main` a producción y cada PR a un preview.
- [ ] **Variables en Vercel** (proyecto, **Settings**, **Environment Variables**, para **Production** y **Preview**; luego **Redeploy**):

| Variable | Valor | Para qué |
|---|---|---|
| `SITIO_URL` | La dirección pública, por ejemplo `https://calibra-v10.vercel.app` (Vercel, **Domains**) | Los enlaces de los correos. Sin ella, invitar monitores falla |
| `CORREO_DATOS_PERSONALES` | `calibra.monitorias@gmail.com` | Canal de consultas en el aviso de privacidad |
| `SMTP_SERVIDOR` | `smtp.gmail.com` | Enviar correos por Gmail (cuando HU-066 esté fusionada) |
| `SMTP_PUERTO` | `465` | Igual |
| `SMTP_USUARIO` | `calibra.monitorias@gmail.com` | Igual |
| `SMTP_CONTRASENA` | Las 16 letras de A3, sin espacios. Márcala **Sensitive** | Igual |
| `CORREO_REMITENTE` | `Calibra <calibra.monitorias@gmail.com>` | El nombre que ve quien recibe el correo |

---

## C. En el corte a producción (HU-057)

Todavía no. Se hace una sola vez, cuando el flujo principal esté listo, y lo guía HU-057. Lo dejo aquí para que no sorprenda.

**Deuda técnica antes de salir (decisión del 1-oct, D-18).** La idea es que, con toda la base lista, el corte sea solo poner variables de entorno y configurar los paneles de Vercel y Supabase. Por eso toda HU que agregue configuración externa (una llave, un secreto de Vault, un ajuste de Auth) la anota en esta sección y en `.env.example`, sin valores. Si aquí falta algo, es un error de esa HU.

- [ ] **Base en la nube.** v10 usará el mismo proyecto Supabase del prototipo (`uotlhaitdkfroavqkvee`). En el corte: respaldo, mover las tablas del prototipo a un esquema aparte, aplicar las migraciones de v10 y desactivar el webhook y la función `enviar-correo` del prototipo.
- [ ] **Variables de Supabase en Vercel:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` y `SUPABASE_SECRET_KEY` (esta última **Sensitive**). Salen de Supabase, **Project Settings**, **API Keys**.
- [ ] **Supabase Auth en la nube:** activar el inicio anónimo, contraseña mínima de 8, `Site URL` y URLs de redirección de producción, la plantilla de "recuperar contraseña" y un SMTP propio para los correos de Auth (se puede usar el mismo Gmail).
- [ ] **Reintento automático de correos (HU-065).** Genera un secreto largo (por ejemplo, en una terminal: `openssl rand -hex 32`) y:
  - cárgalo en Vercel como `CRON_SECRETO` (**Sensitive**);
  - en Supabase, guárdalo en **Vault** (panel del proyecto, **Integrations**, **Vault**; mejor que el SQL Editor, que guarda el historial de consultas) con el nombre `calibra_cron_secreto`;
  - en Vault, también la dirección del sitio con el nombre `calibra_sitio_url`: la de producción, con `https://` y sin barra al final (por ejemplo `https://calibra.vercel.app`). Tiene que ser la dirección final, sin redirecciones ni protección de despliegue de Vercel, o la llamada fallaría.
  Desde ahí, cada 10 minutos la base le pide a la app que reintente los correos que fallaron por algo temporal, durante 24 horas. Con lo mismo salen los avisos al monitor de HU-051 (cita confirmada y cancelación del estudiante), la confirmación de la cita al Lead (HU-019) y el correo de cancelación con el pedido de llave (HU-024): sin esto, no salen. Sin esto no se reintentan solos. Los que fallan de forma definitiva, o agotan las 24 horas, el admin los ve en su bandeja en "Correos que no salieron".
- [ ] **Admins reales:** la lista de admins y su orden de revisión. Hoy se crean con SQL; después el orden se cambia y se desactiva desde `/admin/equipo` (HU-054). Invitar admins desde la app es [HU-072](../backlog/HU-072.md), en Backlog con tres preguntas para ti.
- [ ] **CAPTCHA (HU-058), deuda técnica (D-18):** HU-058 se construye con las llaves de prueba de Cloudflare Turnstile. Antes de salir hay que crear las llaves reales (gratis, en el panel de Cloudflare, modo «Managed», D-32) y cargarlas: la del sitio en Vercel como `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, y la secreta solo en Supabase Auth (**Authentication**, **Attack Protection**, CAPTCHA). La app nunca valida el token: lo hace Supabase. Con las de prueba en producción, el CAPTCHA no protege nada.
- [ ] **Pago por Llave (HU-018), deuda técnica (D-18):** en local y en CI la reserva muestra una llave, un titular y un QR de prueba (los escribe `npm run db:env`). Antes de salir, carga estas variables en Vercel (**Production** y **Preview**). Sin las tres primeras, la página dice que el pago por Llave no está disponible y nadie puede adjuntar el comprobante.
  - `LLAVE_PLATAFORMA`: la llave real de Calibra en el banco (el celular, correo o documento con que está registrada).
  - `LLAVE_PLATAFORMA_TITULAR`: el nombre del titular, tal como lo muestra el banco al transferir.
  - `LLAVE_PLATAFORMA_QR_URL`: sube a un lugar público la imagen del QR que te da el banco para esa llave (por ejemplo, un bucket público de Supabase) y pon aquí su dirección `https://`.
  - `PROVEEDOR_NOMBRE` y `PROVEEDOR_DOCUMENTO`: el nombre o razón social y el documento (cédula o NIT) de quien recibe el pago. La página los muestra antes de pagar (Ley 1480 de 2011, art. 50). Son datos legales: valídalos con asesoría, como P-13. Mientras falten, sale solo "Calibra". El correo que los acompaña es `CORREO_DATOS_PERSONALES` (sección B).
- [ ] **Datos del prototipo:** decidir si los diagnósticos viejos se importan como históricos. Los leads del prototipo no se migran como contactables (no tenían autorización de datos).
- [ ] **Publicar** en el repo real de Calibra y archivar el repo temporal.

---

## D. Decisiones de negocio pendientes (corte 2 y 3)

No bloquean el trabajo actual. Cada una tiene una recomendación en `REVISION_REGLAS.md`; cuando quieras, se resuelven en una sola sesión como la del 29 de septiembre.

- [ ] **P-01:** campos del perfil del monitor (HU-049).
- [ ] **P-02 y P-12:** descuento grupal y cupos mínimo y máximo (HU-036).
- [x] **P-03:** escala de las reseñas. Decidido el 1-oct (D-17): de 1 a 5, comentario opcional.
- [ ] **P-06, P-25, P-26, P-27, P-38 y P-39:** grupales de pago único y paso a individual (HU-036, HU-041, HU-042, HU-047).
- [ ] **P-08:** casos extremos de cancelación tardía (HU-052).
- [x] **P-11:** avisos al monitor. Decidido el 1-oct (D-16): correo al confirmarse una monitoría y cuando el estudiante la cancela. HU-051 pasa al corte 1.
- [ ] **P-22:** Lead solo con teléfono (HU-031, HU-035).
- [ ] **P-32:** si el monitor ve la comisión (HU-050).
- [ ] **P-42:** autorización de datos de quien paga sin ser Lead (HU-038, HU-042).
- [ ] **HU-032:** cómo recuperar el historial desde otro dispositivo.

### Validaciones pendientes

- [ ] **Retención de datos (P-13):** los plazos (90 días, 24 meses, 5 años) quedaron "a validar con asesoría" legal.
- [x] **Cierre automático de sesiones (P-05):** confirmado el 1-oct (D-14), 24 h después del fin programado.

---

## E. En persona con Juzou04

- [ ] **HU-005, banco de preguntas por habilidades.** Queda para después (30-sep): ya no frena agendar (D-2 y D-3), pero sin él no hay diagnóstico. Ninguna sesión de Claude la toma sola.
- [ ] Después: HU-060 (motor adaptativo) y HU-061 (reprocesar el banco con IA). En HU-061 una persona revisa cada pregunta que genera la IA.
