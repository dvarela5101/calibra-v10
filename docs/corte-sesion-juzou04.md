# Corte (HU-057): sesión de Vercel y GitHub con Juzou04

El proyecto de Vercel del prototipo y el repo `Juzou04/Calibra` son de Juzou04, y Vercel no deja transferir un proyecto entre cuentas Hobby. Por decisión de dvarela5101 (20-oct-2026), v10 sale en **ese mismo proyecto de Vercel**, y esta parte la hacen las dos personas juntas: Juzou04 en los paneles y dvarela5101 con los valores.

Lo que ya está hecho: el proyecto Supabase nuevo (`glgkmwlssdbonnbehitu`) con el esquema, el banco, Auth, SMTP, Storage, Vault y el primer admin; y el código de v10 en la rama `v10` de `Juzou04/Calibra`. `main` sigue siendo el prototipo, que no cambia hasta el corte.

Ningún valor secreto va en el chat ni en el repo. Se pegan directo en el panel.

## Antes de la sesión (dvarela5101)

Tener a mano, en el gestor de contraseñas:

- De Supabase, proyecto **Calibra v10**, **Project Settings**, **API Keys**: la URL del proyecto, la llave publicable (`sb_publishable_…`) y la llave secreta (`sb_secret_…`).
- La contraseña de aplicación de Gmail de `calibra.monitorias@gmail.com`.
- `C:\Users\DAVID\Respaldos\calibra-corte\cron-secreto.txt` (el mismo valor que ya está en Vault como `calibra_cron_secreto`).
- La llave de pago de Calibra, su titular, la imagen del QR publicada en una dirección `https://`, y el nombre y documento del proveedor del pago (Ley 1480).

## 1. La dirección del sitio (Juzou04)

La dirección de producción del prototipo es `https://calibra-eight.vercel.app` (la de `Juzou04/Calibra`, comprobada el 20-oct-2026). Es la dirección final de v10 (D-72 f). Juzou04 confirma en Vercel, proyecto, **Settings**, **Domains**, que no hay otro dominio, y anota el sufijo de los previews (`calibra-<algo>-<sufijo>.vercel.app`, en **Deployments**) para las redirecciones de Supabase.

## 2. Ajustes del proyecto (Juzou04)

En **Settings**, **General** (o **Build and Deployment**):

- **Framework Preset**: Next.js. El `vercel.json` de v10 ya lo fija, pero conviene dejarlo igual en el panel.
- **Node.js Version**: 22.x.
- **Root Directory**, **Build Command**, **Output Directory** e **Install Command**: los valores por defecto, sin sobrescribir.
- **Production Branch** (en **Git**): `main`.

En **Deployment Protection**: la protección estándar de Vercel no protege la dirección de producción, y así tiene que quedar, porque la base llama a la app por ella (`calibra_sitio_url`). Los previews quedan protegidos por inicio de sesión en Vercel; para probarlos, quien no sea Juzou04 necesita que la apague para Preview durante la prueba o que comparta un enlace.

## 3. Variables de entorno (Juzou04 pega, dvarela5101 dicta)

**Settings**, **Environment Variables**. Cada una con **Production** y **Preview** marcados (D-72 e: los previews usan la base de producción). Las marcadas como sensibles, con **Sensitive**.

| Variable | Valor | Sensible |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://glgkmwlssdbonnbehitu.supabase.co` | no |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | la llave publicable `sb_publishable_…` | no |
| `SUPABASE_SECRET_KEY` | la llave secreta `sb_secret_…` | **sí** |
| `SITIO_URL` | `https://calibra-eight.vercel.app` | no |
| `CORREO_DATOS_PERSONALES` | `calibra.monitorias@gmail.com` | no |
| `SMTP_SERVIDOR` | `smtp.gmail.com` | no |
| `SMTP_PUERTO` | `465` | no |
| `SMTP_USUARIO` | `calibra.monitorias@gmail.com` | no |
| `SMTP_CONTRASENA` | la contraseña de aplicación, sin espacios | **sí** |
| `CORREO_REMITENTE` | `Calibra <calibra.monitorias@gmail.com>` | no |
| `CRON_SECRETO` | el contenido de `cron-secreto.txt` | **sí** |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | la llave del sitio del widget de Turnstile | no |
| `LLAVE_PLATAFORMA` | la llave de pago de Calibra | no |
| `LLAVE_PLATAFORMA_TITULAR` | el titular, como lo muestra el banco | no |
| `LLAVE_PLATAFORMA_QR_URL` | la dirección `https://` de la imagen del QR | no |
| `PROVEEDOR_NOMBRE` | nombre o razón social de quien recibe el pago | no |
| `PROVEEDOR_DOCUMENTO` | cédula o NIT | no |

No se cargan `TURNSTILE_SECRET_KEY` (la secreta va solo en Supabase, Attack Protection), `RESEND_API_KEY` ni `MAILPIT_URL`. Las variables viejas del prototipo se pueden borrar después del cierre.

## 4. Token y secretos de GitHub (Juzou04)

1. En Vercel, **Account Settings**, **Tokens**: crear un token `calibra-ci` con alcance a su cuenta y sin vencimiento corto (o de un año).
2. Anotar dos identificadores: el **Project ID** (proyecto, **Settings**, **General**) y el ID de la cuenta (**Account Settings**, **General**, «Vercel ID»).
3. En GitHub, `Juzou04/Calibra`, **Settings**, **Secrets and variables**, **Actions**, **New repository secret**: `VERCEL_TOKEN`, `VERCEL_ORG_ID` (el ID de la cuenta) y `VERCEL_PROJECT_ID`.

En un repo personal solo su dueño puede crear secretos de Actions.

## 5. La prueba en un preview

Con todo lo anterior, Claude (en la sesión de dvarela5101) prepara la rama `v10` para fusionarse con `main` conservando las dos historias y abre el PR `v10` → `main`. El CI corre completo y publica un preview contra el proyecto nuevo. Ahí se hace la prueba de HU-057 (sesión anónima con CAPTCHA real, diagnóstico y correo, recuperar contraseña, agendar con comprobante, rutas `/api/procesos/*` con 401, crons sin errores).

## 6. El corte

Fusionar el PR. El push a `main` corre el CI y despliega v10 a producción en la misma dirección. Volver atrás: en Vercel, **Deployments**, el último despliegue del prototipo, **Instant Rollback** (Juzou04).
