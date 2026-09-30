# Pendientes de dvarela5101

**Actualizado:** 29 de septiembre de 2026. Son las tareas que solo tú puedes hacer: tocan cuentas, contraseñas, paneles o decisiones del producto. Van ordenadas por **cuándo hacen falta**. Marca cada una al terminarla, o dile a Claude "ya hice X" y él marca la casilla y sigue.

Nada de lo de aquí se pega en el chat ni se guarda en el repo: las contraseñas y las llaves van directo al panel que corresponda.

**Cómo está hoy el proyecto.** La app solo corre en local (cada una con su Supabase en Docker). GitHub no tiene los secretos de Vercel, así que el CI pasa en verde pero **no despliega** (el paso "Desplegar en Vercel" se salta con un aviso). La base en la nube no se toca hasta el corte (HU-057): hasta entonces sostiene el prototipo en vivo.

---

## A. Ahora (no dependen de nada)

### A1. Aprobar las HUs en revisión

Si te gusta, dile a Claude "apruebo HU-XXX" (él corre `python scripts/backlog.py done HU-XXX` en `main`). Si algo no te gusta, dilo: se corrige en un PR nuevo. Para probarlas: `npm run db:iniciar`, `npm run db:env`, `npm run dev` y abre http://localhost:3000.

- [ ] **HU-008, aviso de privacidad** ([PR #6](https://github.com/dvarela5101/calibra-v10/pull/6), ya fusionado). Abre `/privacidad` y el pie de cualquier página. **Juzou04 la necesita aprobada para empezar HU-062.**
- [ ] **HU-013, cuenta de monitor por invitación** ([PR #7](https://github.com/dvarela5101/calibra-v10/pull/7)). Entra como `admin1@calibra.test` (contraseña `calibra-admin-local`, solo local), ve a "Invitar a un monitor", invita a cualquier correo, abre el correo en Mailpit (http://127.0.0.1:54324) y crea la cuenta con el enlace. HU-015 (franjas) espera esta aprobación.

### A2. Decisiones de las HUs recientes

- [ ] **Texto del aviso de privacidad (HU-008).** Además de lo que pide la HU, el aviso menciona los datos del pagador y el comprobante, el uso para revisar pagos y tramitar reembolsos, y los correos sobre citas y pagos. Salen del modelo de datos, pero no estaban escritos como regla. Confirma que quedan o dime qué quitar.
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

- [ ] **Base en la nube.** v10 usará el mismo proyecto Supabase del prototipo (`uotlhaitdkfroavqkvee`). En el corte: respaldo, mover las tablas del prototipo a un esquema aparte, aplicar las migraciones de v10 y desactivar el webhook y la función `enviar-correo` del prototipo.
- [ ] **Variables de Supabase en Vercel:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` y `SUPABASE_SECRET_KEY` (esta última **Sensitive**). Salen de Supabase, **Project Settings**, **API Keys**.
- [ ] **Supabase Auth en la nube:** activar el inicio anónimo, contraseña mínima de 8, `Site URL` y URLs de redirección de producción, la plantilla de "recuperar contraseña" y un SMTP propio para los correos de Auth (se puede usar el mismo Gmail).
- [ ] **Admins reales:** la lista de admins y su orden de revisión.
- [ ] **CAPTCHA (HU-058):** crear las llaves de Cloudflare Turnstile (gratis) y cargarlas en Vercel y en Supabase Auth. HU-058 pasa a `Lista` cuando existan.
- [ ] **Datos del prototipo:** decidir si los diagnósticos viejos se importan como históricos. Los leads del prototipo no se migran como contactables (no tenían autorización de datos).
- [ ] **Publicar** en el repo real de Calibra y archivar el repo temporal.

---

## D. Decisiones de negocio pendientes (corte 2 y 3)

No bloquean el trabajo actual. Cada una tiene una recomendación en `REVISION_REGLAS.md`; cuando quieras, se resuelven en una sola sesión como la del 29 de septiembre.

- [ ] **P-01:** campos del perfil del monitor (HU-049).
- [ ] **P-02 y P-12:** descuento grupal y cupos mínimo y máximo (HU-036).
- [ ] **P-03:** escala de las reseñas (se recomienda de 1 a 5).
- [ ] **P-06, P-25, P-26, P-27, P-38 y P-39:** grupales de pago único y paso a individual (HU-036, HU-041, HU-042, HU-047).
- [ ] **P-08:** casos extremos de cancelación tardía (HU-052).
- [ ] **P-11:** avisos al monitor (HU-051).
- [ ] **P-22:** Lead solo con teléfono (HU-031, HU-035).
- [ ] **P-32:** si el monitor ve la comisión (HU-050).
- [ ] **P-42:** autorización de datos de quien paga sin ser Lead (HU-038, HU-042).
- [ ] **HU-032:** cómo recuperar el historial desde otro dispositivo.

### Validaciones pendientes

- [ ] **Retención de datos (P-13):** los plazos (90 días, 24 meses, 5 años) quedaron "a validar con asesoría" legal.
- [ ] **Cierre automático de sesiones (P-05):** se propuso 24 h después del fin programado; falta confirmarlo antes de HU-023.

---

## E. En persona con Juzou04

- [ ] **HU-005, banco de preguntas por habilidades.** Es el cuello de botella del diagnóstico; ninguna sesión de Claude la toma sola.
- [ ] Después: HU-060 (motor adaptativo) y HU-061 (reprocesar el banco con IA). En HU-061 una persona revisa cada pregunta que genera la IA.
