# Pendientes de dvarela5101

**Actualizado:** 29 de septiembre de 2026. Son las tareas que solo tú puedes hacer: tocan cuentas, contraseñas o decisiones del producto. Marca cada una al terminarla. Si prefieres, dile a Claude "ya hice X" y él marca la casilla y sigue.

Nada de lo de aquí se pega en el chat ni se guarda en el repo: las contraseñas y las llaves van directo a Vercel.

## 1. Preparar la cuenta de Gmail (para HU-066)

La app va a enviar los correos desde `calibra.monitorias@gmail.com` (decisión D-1). Para eso Google exige una contraseña de aplicación.

- [ ] Entra a la cuenta `calibra.monitorias@gmail.com` y activa la **verificación en dos pasos**: Cuenta de Google, **Seguridad**, **Verificación en dos pasos**.
- [ ] Crea una **contraseña de aplicación**: Cuenta de Google, **Seguridad**, **Contraseñas de aplicaciones** (o busca "contraseñas de aplicaciones" en la barra de la cuenta). Ponle de nombre "Calibra Vercel". Google muestra 16 letras una sola vez: cópialas directo al paso 2.
- [ ] Guarda la contraseña normal de la cuenta en un lugar que también pueda usar Juzou04 (por ejemplo, un gestor de contraseñas compartido), para que la cuenta no dependa de una sola persona.
- [ ] No desactives la verificación en dos pasos: si la desactivas, Google borra la contraseña de aplicación y los correos dejan de salir.

## 2. Variables en Vercel

En Vercel: proyecto `calibra-v10`, **Settings**, **Environment Variables**. Cada una se marca para **Production** y **Preview**. Después de agregarlas, haz **Redeploy** del último despliegue (una variable nueva solo aplica a despliegues nuevos).

| Variable | Valor | Para qué | Cuándo |
|---|---|---|---|
| `SITIO_URL` | La dirección pública del sitio, por ejemplo `https://calibra-v10.vercel.app` (la ves en Vercel, **Domains**) | Los enlaces de los correos. Sin ella, invitar monitores falla | Ya |
| `CORREO_DATOS_PERSONALES` | `calibra.monitorias@gmail.com` | Sale en el aviso de privacidad como canal de consultas | Ya |
| `SMTP_SERVIDOR` | `smtp.gmail.com` | Enviar los correos por Gmail | Cuando se fusione HU-066 |
| `SMTP_PUERTO` | `465` | Igual | Cuando se fusione HU-066 |
| `SMTP_USUARIO` | `calibra.monitorias@gmail.com` | Igual | Cuando se fusione HU-066 |
| `SMTP_CONTRASENA` | Las 16 letras del paso 1, sin espacios | Igual. Es secreta: márcala como **Sensitive** | Cuando se fusione HU-066 |
| `CORREO_REMITENTE` | `Calibra <calibra.monitorias@gmail.com>` | El nombre que ve quien recibe el correo | Cuando se fusione HU-066 |

- [ ] `SITIO_URL`
- [ ] `CORREO_DATOS_PERSONALES`
- [ ] Las cinco variables de SMTP (cuando HU-066 esté fusionada)
- [ ] Redeploy

## 3. Aprobar las HUs en revisión

Revisa cada una en el sitio de preview de su PR o en local. Si te gusta, dile a Claude "apruebo HU-XXX" (él corre `python scripts/backlog.py done HU-XXX` en `main`). Si algo no te gusta, dilo: se corrige en un PR nuevo.

- [ ] **HU-008, aviso de privacidad** ([PR #6](https://github.com/dvarela5101/calibra-v10/pull/6), ya fusionado). Abre `/privacidad` y el pie de cualquier página. **Juzou04 la necesita aprobada para empezar HU-062.**
- [ ] **HU-013, cuenta de monitor por invitación** ([PR #7](https://github.com/dvarela5101/calibra-v10/pull/7)). Entra como admin, ve a "Invitar a un monitor", invítate a un correo tuyo y crea la cuenta con el enlace. HU-015 (franjas) espera esta aprobación.

## 4. Decisiones que te tocan

- [ ] **Texto del aviso de privacidad.** Además de lo que pide HU-008, el aviso menciona los datos del pagador y el comprobante de pago, el uso para revisar pagos y tramitar reembolsos, y los correos sobre citas y pagos. Salen del modelo de datos, pero no estaban escritos como regla. Confirma que quedan o dime qué quitar. El texto legal final lo valida el equipo.
- [ ] **Correo que ya tiene cuenta (HU-013).** Si invitas a un correo que ya tiene cuenta de Calibra (por ejemplo, de estudiante), hoy el registro no la convierte en monitor y le pide escribir al equipo. Confirma que así está bien, o pide que se pueda convertir.

## 5. Cuidar el buzón

- [ ] Revisa `calibra.monitorias@gmail.com` con frecuencia. El aviso de privacidad promete responder las consultas de datos en máximo 10 días hábiles y los reclamos en máximo 15.
- [ ] Ten en cuenta el límite de Gmail: unos 500 correos al día. Si Google bloquea el envío, los correos quedan como fallidos en el registro y la app no se cae.
