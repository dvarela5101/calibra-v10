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
- [ ] **Las HUs que Claude saque mientras no estás** quedan `En revision`; la lista está en `BACKLOG.md` y cada una trae en su registro cómo verificarla.

### A2. Decisiones de las HUs recientes

- [ ] **Texto del aviso de privacidad (HU-008).** Además de lo que pide la HU, el aviso menciona los datos del pagador y el comprobante, el uso para revisar pagos y tramitar reembolsos, y los correos sobre citas y pagos. Salen del modelo de datos, pero no estaban escritos como regla. Confirma que quedan o dime qué quitar.
- [ ] **Franjas (HU-015): certificado para abrir franjas.** Un monitor sin certificado no puede abrir franjas: nadie podría agendarle, porque la monitoría exige una materia certificada. Sale del orden del flujo F2, no de una regla escrita. Recomendación: dejarlo así.
- [ ] **Franjas (HU-015): cambiar el horario.** P-30 dice que no se cambian día, hora ni duración con reservas **futuras**. Hoy tampoco se cambian si la franja tiene monitorías **pasadas** (no canceladas): los plazos de cada monitoría (inicio, fin, ventana de reporte, desembolso) se calculan con el horario actual de la franja, y cambiarlo reescribiría el historial. Para otro horario se cierra la franja y se abre otra. Recomendación: dejarlo así. La otra opción es guardar hora y duración en cada monitoría, como el precio.
- [ ] **Franjas (HU-015): cambiar entre presencial y virtual.** Con monitorías futuras no se puede (el estudiante agendó una modalidad). El lugar y el enlace sí se corrigen, pero hoy nadie avisa al estudiante del cambio. Recomendación: dejarlo así y avisar cuando exista el correo de la cita (HU-019).
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
  Desde ahí, cada 10 minutos la base le pide a la app que reintente los correos que fallaron por algo temporal, durante 24 horas. Con lo mismo salen los avisos al monitor de HU-051 (cita confirmada y cancelación del estudiante): sin esto, no salen. Sin esto no se reintentan solos. Los que fallan de forma definitiva, o agotan las 24 horas, el admin los ve en su bandeja en "Correos que no salieron".
- [ ] **Admins reales:** la lista de admins y su orden de revisión.
- [ ] **CAPTCHA (HU-058), deuda técnica (D-18):** HU-058 se construye con las llaves de prueba de Cloudflare Turnstile. Antes de salir hay que crear las llaves reales (gratis, en el panel de Cloudflare) y cargarlas: la del sitio y la secreta en Vercel, y la secreta en Supabase Auth (**Authentication**, **Attack Protection**, CAPTCHA). Con las de prueba en producción, el CAPTCHA no protege nada.
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
