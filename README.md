# Calibra v10

Reconstrucción de Calibra sobre el modelo de negocio v10 (`calibra_reglas_negocio.md`). Calibra conecta a estudiantes de ciclo básico con monitores certificados: un diagnóstico de opción múltiple calibrado dice en qué subtema falla el estudiante, y el monitor recibe ese diagnóstico antes de la sesión.

El prototipo anterior (`../Calibra`, un solo `index.html`) queda como referencia de solo lectura.

## Stack (decisión P-17, 28 de septiembre de 2026)

| Pieza | Elección | Para qué |
| --- | --- | --- |
| Framework | Next.js 16 (App Router) + TypeScript | Páginas, servidor y API en un solo proyecto |
| Hosting | Vercel | Producción desde `main` y un preview por cada PR |
| Datos y cuentas | Supabase: Postgres, Auth (con inicio anónimo), Storage, Realtime y tareas programadas | Se conectan desde HU-002 y HU-004 |
| Pruebas de lógica | Vitest | `src/**/*.test.ts` y `pruebas/` |
| Pruebas de flujos | Playwright (Chromium, 390x844 y 1280x800) | `e2e/` |

La decisión quedó registrada en `backlog/HU-001.md`. Se recomienda un proyecto Supabase nuevo: el `schema.sql` del prototipo empieza con `drop table ... cascade`, y el proyecto `uotlhaitdkfroavqkvee` queda como fuente de datos históricos.

## Arrancar en local

Requisitos: Node 22 o superior (ver `.nvmrc`) y npm. Después de clonar, un solo comando instala y levanta la app:

```bash
npm run inicio
```

Abre http://localhost:3000. La página de inicio funciona sin variables de entorno. Las siguientes veces basta con `npm run dev`.

Para las sesiones, el login y todo lo que toca datos hace falta el Supabase local (Docker Desktop abierto):

```bash
npm run db:iniciar
npm run db:env
npm run dev
```

`db:env` escribe `.env.local` con las llaves del Supabase local; nunca pongas ahí las del proyecto real.

Si tu stack local ya estaba corriendo de antes, sin Storage, `npm run db:iniciar` no le agrega el servicio que falta: hay que correr `npm run db:detener` y luego `npm run db:iniciar`. Sin Storage no existe el bucket `comprobantes` y fallan las pruebas de integración de comprobantes. Para una base limpia con las migraciones y la semilla, `npm run db:reiniciar`.

Para las pruebas de punta a punta hace falta Chromium de Playwright, una sola vez por máquina:

```bash
npx playwright install --no-shell chromium
```

## Scripts

| Comando | Qué hace |
| --- | --- |
| `npm run inicio` | `npm install` y servidor de desarrollo |
| `npm run dev` | Servidor de desarrollo |
| `npm run lint` | ESLint |
| `npm run typecheck` | Genera los tipos de rutas y corre `tsc --noEmit` |
| `npm test` | Pruebas unitarias (Vitest) |
| `npm run test:integracion` | Pruebas de integración (Vitest) contra el Supabase local |
| `npm run test:e2e` | Pruebas de punta a punta (Playwright). Levanta `npm run dev`, o `npm run start` si `CI` está definido. Necesita el Supabase local |
| `npm run build` | Build de producción |
| `npm run verificar` | Todo lo anterior en el orden del pipeline |
| `npm run db:iniciar` | Levanta Supabase local (Postgres, Auth, REST, Storage y Mailpit) con las migraciones |
| `npm run db:env` | Escribe `.env.local` con las llaves del Supabase local |
| `npm run db:tipos` | Regenera `src/lib/supabase/tipos.ts` desde el esquema local |
| `npm run db:reiniciar` | Borra la base local y aplica las migraciones y la semilla desde cero |
| `npm run db:verificar` | Reaplica las migraciones (idempotencia) y corre las pruebas pgTAP |
| `npm run db:detener` | Detiene los contenedores locales de Supabase |

Una migración nueva que cambia las columnas de salida de una función tiene que borrarla antes con `drop function`. Desde entonces la migración vieja que la creó ya no se puede reaplicar sobre la base final, y `db:verificar` fallaría al reaplicarla. Sin editar la migración vieja, `scripts/verificar-bd.mjs` lleva una lista de preámbulos (`PREAMBULOS`) que dice qué borrar antes de reaplicar cada una. Hoy tiene una entrada: `parametros_negocio()`, que HU-063 dejó sin la comisión.

## Variables de entorno

La plantilla es `.env.example`. Cópiala como `.env.local` y completa los valores. Ningún `.env` con valores se versiona: `.gitignore` los excluye y `pruebas/secretos.test.ts` falla si alguno entra al repo o si aparece una llave secreta en un archivo versionable.

- `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: públicas por diseño, llegan al navegador.
- `SUPABASE_SECRET_KEY`: solo servidor. Nunca con prefijo `NEXT_PUBLIC_`.
- `RESEND_API_KEY` y `CORREO_REMITENTE`: solo servidor, para el correo transaccional (ver [Correo transaccional](#correo-transaccional)). `SITIO_URL` es la dirección pública para los enlaces de los correos. En local no hacen falta: el correo sale por Mailpit.

## Base de datos

El esquema del modelo v10 vive en `supabase/migrations/` y se prueba en un Supabase local sobre Docker. Hay que tener Docker Desktop abierto.

```bash
npm run db:iniciar
npm run db:verificar
```

- **Estrategia (decidida el 28 de septiembre de 2026):** v10 usará el mismo proyecto Supabase del prototipo (`uotlhaitdkfroavqkvee`), pero solo desde el corte final ([HU-057](backlog/HU-057.md)). Hasta entonces el prototipo sigue vivo sobre esa base, y **ninguna migración se aplica al proyecto real**. Nada de `supabase db push`, `--linked` ni el MCP contra ese proyecto para escribir.
- Las migraciones son idempotentes: `npm run db:verificar` las vuelve a aplicar sobre la base que ya las tiene y luego corre `supabase/tests/*.sql` (pgTAP).
- Nuevas migraciones: `npx supabase migration new <nombre>`. Nunca inventes el nombre del archivo.
- Antes de cerrar un cambio de esquema: `npx supabase db advisors --local --level warn` sin hallazgos.

## Autenticación

Supabase Auth con `@supabase/ssr` (HU-004):

- **Visitantes:** al abrir una página pública (`src/app/(publico)`) se crea una sesión anónima que vive en una cookie persistente. Al volverse Estudiante conserva el mismo id (`src/lib/auth/convertir.ts`), así que sus diagnósticos siguen siendo suyos.
- **Monitores y admins:** entran por `/ingresar` con correo y contraseña. `/monitor` y `/admin` exigen su rol con `exigirRol()` (`src/lib/auth/sesion.ts`), que lee el rol de `public.mi_rol()` en la base. El proxy (`src/proxy.ts`) solo refresca la sesión: no autoriza.
- **Olvidé mi contraseña:** `/restablecer` envía un correo (plantilla `supabase/templates/recuperar.html`); el enlace pasa por `/auth/confirmar` y lleva a `/restablecer/nueva`. En local los correos llegan a Mailpit: http://127.0.0.1:54324.
- **Desactivar una cuenta (RN-23):** `desactivarCuenta()` (`src/lib/auth/cuentas.ts`) la banea en Auth. No puede volver a entrar, deja de ser admin al instante aunque su token siga vigente, y sus filas y certificados se conservan.
- **Admins de prueba en local.** La semilla (`supabase/seed.sql`) crea `admin1@calibra.test` y `admin2@calibra.test`, los dos con la contraseña `calibra-admin-local` y con su orden de revisión (1 y 2). La corren `npm run db:reiniciar` y el primer `npm run db:iniciar` de una base nueva; nunca corre contra el proyecto real. La lista real de admins y su orden la define el equipo antes del corte a producción (HU-057).
- Crear monitores llega con HU-013. Mientras tanto, las pruebas los crean con la llave secreta local.

## Bandeja del admin

`/admin` (HU-012) muestra lo que tiene asignado el admin que entró: pagos en revisión ordenados por vencimiento (con el tiempo que les queda o cuánto llevan vencidos), reembolsos activos por estado, reportes de inasistencia en revisión y desembolsos ejecutables. Arriba hay un contador por sección.

- `cargarBandeja()` (`src/lib/admin/bandeja.ts`) siempre se llama con el id de la sesión. Las políticas dejan leer a todo admin, así que el filtro por admin lo pone quien llama.
- Los desembolsos no tienen admin hasta que se ejecutan (RN-80): los ejecutables son los mismos para todos. La regla de RN-83 (pasaron 24 horas del fin y no hay un reporte en revisión ni aceptado) vive en la vista `desembolsos_ejecutables`, que HU-028 también usará. La vista no expone bruto, comisión ni la llave del monitor.
- El tiempo restante de un pago sale del motor de plazos (HU-003) y respeta el borde inclusivo de P-40.
- Cada sección se vuelve accionable cuando llegan HU-020 (pagos), HU-026 (reembolsos), HU-030 (reportes) y HU-028 (desembolsos).

## Comprobantes de pago

Los comprobantes van en el bucket privado `comprobantes` de Supabase Storage (HU-007). La ruta es `<id del usuario>/<uuid>.<jpg|png|pdf>`, con el id del usuario de Auth que sube (la sesión anónima del pagador también lo es), y `pago.comprobante` guarda esa ruta.

- Se suben desde el navegador con la sesión del pagador, directo al Storage: un archivo de hasta 10 MB no cabe en una función de Vercel, que acepta 4,5 MB. `subirComprobante()` (`src/lib/comprobantes/almacenamiento.ts`) valida tipo, tamaño y contenido y devuelve un mensaje en español. El bucket vuelve a hacer cumplir el tamaño y los tipos por su cuenta.
- Leen el dueño de la carpeta y los admins. Desde la app nadie borra, y nadie mueve, copia sobre otro archivo ni pisa el comprobante de otra persona (`move`, `copy` y las URL de subida firmadas con `upsert` fallan, y `integracion/comprobantes.test.ts` lo comprueba). Queda un caso abierto: el dueño puede pisar el suyo con una URL de subida firmada creada con `upsert` antes de que el archivo exista ([HU-067](backlog/HU-067.md)). Un admin abre un comprobante con `enlaceDeComprobanteDePago()`, que pide un enlace firmado de 60 segundos cada vez que se abre el pago.
- Quien cree un pago desde el servidor con la llave secreta debe comprobar con `rutaEsDelUsuario()` que la ruta sea de la carpeta del pagador antes de guardarla en `pago.comprobante`. Si no, alguien podría apuntar su pago al comprobante de otra persona.
- El límite de 10 MB (N-3, HU-063; era 5 MB) y los tipos están en el bucket, que declara la migración `*_ajustes_comprobantes.sql` sobre la de `*_comprobantes_privados.sql`. Se repiten en `src/lib/comprobantes/reglas.ts` para dar mensajes claros antes de subir, y `integracion/comprobantes.test.ts` comprueba que coincidan.

## Correo transaccional

`enviarCorreoDesdeServidor()` (`src/lib/correo/servidor.ts`, HU-006) manda los correos de la sección 8 de las reglas de negocio, en español, con versión HTML y texto plano. Las plantillas son funciones puras en `src/lib/correo/plantillas.ts`:

| Plantilla | Evento | Destinatario |
| --- | --- | --- |
| `recuperacion_diagnostico` | Diagnóstico completado: enlace con token para recuperar los resultados | Lead |
| `resena_individual` | Monitoría individual realizada: enlace a la reseña, sin límite de tiempo | Lead |
| `solicitud_llave_reembolso` | Reembolso creado: se pide la llave para devolver el dinero | Pagador |
| `pago_rechazado_individual` | Pago rechazado en una individual: la cita se cancela | Pagador |
| `pago_rechazado_grupal` | Pago rechazado en una grupal: se anula ese cupo | Pagador |
| `escalamiento_pago` | Pago sin revisar tras el plazo: pasa al siguiente admin | Admin |

Cada llamada lleva la plantilla, sus datos, el destinatario y una `entidad`, que es lo que motiva el correo (el id del reembolso o del diagnóstico). Plantilla más entidad forman la clave del correo. La entidad debe cambiar cada vez que el mismo evento tenga que volver a avisar: el escalamiento de un pago vuelve al primer admin al terminar la lista (RN-42), así que ahí la entidad es `pago:admin:n`, con el número de escalamiento, y no `pago:admin`, que la segunda vuelta descartaría como ya enviado. Solo admite ASCII imprimible, porque viaja como `Idempotency-Key`.

- La clave es única en `correo_envio`, el registro de envíos (destinatario, plantilla, fecha, resultado; sin el cuerpo). Si el correo ya salió, otra llamada con la misma clave no lo manda otra vez.
- Un fallo pasajero (red, 5xx, límite de ritmo) se reintenta hasta tres veces con espera creciente. Uno definitivo (llave inválida, remitente sin verificar) no. Si no sale, queda `fallido` con su error y la siguiente llamada con la misma clave lo reintenta sobre la misma fila. Como el registro no guarda el cuerpo, reintentar es volver a llamar con los mismos datos.
- La clave también viaja como `Idempotency-Key` a Resend, por si el envío llegó pero la respuesta no. Resend la recuerda 24 horas y rechaza reusarla con otro contenido, así que una plantilla no puede leer el reloj.
- Un contacto que no es un correo (un teléfono) no se envía: WhatsApp y SMS quedan fuera (P-22).
- La función no lanza por un fallo del proveedor ni del registro: devuelve `ok: false` con el motivo, para que un correo caído no tumbe el flujo que lo pidió.

En producción el proveedor es Resend (`RESEND_API_KEY` y `CORREO_REMITENTE`, ver `.env.example`). En local, sin esas variables, el correo sale por el Mailpit del Supabase local y se ve en http://127.0.0.1:54324. Los enlaces de los correos se arman con `urlDelSitio()` a partir de `SITIO_URL`. La llave solo la lee código de servidor: `pruebas/correo-sin-llaves.test.ts` y `e2e/correo.spec.ts` comprueban que no llegue al navegador.

Antes de mandar a personas reales hay que verificar un dominio en Resend. Mientras no esté verificado, Resend solo entrega a la cuenta dueña de la llave.

### Reintentos y procesos programados (HU-065)

Si un correo falla por algo temporal (red, un 4xx de SMTP, un 5xx o el límite de ritmo de Resend, o el proveedor sin configurar), queda `fallido` con `reintentable = true`. Cada 10 minutos pg_cron corre `privado.disparar_reintento_correos()`, que con pg_net hace un `POST` a `/api/procesos/reintentar-correos` con `Authorization: Bearer <CRON_SECRETO>`. La ruta (`src/lib/correo/reintentos.ts`) toma los reintentables de las últimas 24 horas, reconstruye cada correo desde su entidad (`src/lib/correo/reconstructores.ts`) y lo vuelve a mandar con la misma clave. Lo definitivo, o lo que siguió fallando 24 horas, aparece en la bandeja del admin como "Correos que no salieron".

- La base toma la dirección del sitio y el secreto de Vault (`calibra_sitio_url` y `calibra_cron_secreto`). Sin ellos no dispara nada, que es lo que pasa en local.
- Toda plantilla que una HU empiece a disparar necesita su reconstructor: `pruebas/reconstructores.test.ts` falla si falta.
- La invitación de monitor se reconstruye con un token nuevo, porque el token no se guarda: el enlace que no llegó deja de servir.

## CI y despliegue

`.github/workflows/ci.yml` corre en cada push a `main` y en cada PR hacia `main`:

1. **Verificar:** `npm ci`, lint, typecheck y pruebas unitarias; luego levanta Supabase local, reaplica las migraciones y corre pgTAP, las pruebas de integración, el build y las e2e. Si fallan las e2e, sube el reporte de Playwright como artefacto.
2. **Desplegar** (solo si Verificar pasó): con la CLI de Vercel publica en producción desde `main`, o un preview en cada PR, y comenta la URL del preview en el PR.

`vercel.json` apaga los despliegues automáticos de la integración Git de Vercel, para que solo despliegue el pipeline y nunca salga a producción un commit con pruebas rotas.

### Configuración pendiente (una sola vez)

Mientras falten los secretos, el paso de despliegue se salta con un aviso y el pipeline queda en verde.

1. Crear el repo en GitHub y subir `main`.
2. En la raíz del proyecto, `npx vercel link` para crear o enlazar el proyecto de Vercel. `.vercel/project.json` trae `orgId` y `projectId`.
3. Crear un token en https://vercel.com/account/tokens.
4. En GitHub, Settings → Secrets and variables → Actions, crear `VERCEL_TOKEN`, `VERCEL_ORG_ID` y `VERCEL_PROJECT_ID`.
5. En Vercel, Settings → Environment Variables, cargar las variables de Supabase para Production y Preview cuando existan.
6. Opcional: proteger `main` exigiendo el check "Verificar (lint, tipos, pruebas, e2e)".

## Configuración regional y diseño

- Zona horaria de negocio `America/Bogota`, idioma `es`, locale `es-CO`: `src/config/regional.ts`. Toda fecha se muestra en esa zona aunque el servidor corra en UTC (`src/lib/fechas.ts`).
- Tokens de diseño del prototipo: `src/styles/tokens.css`. Los colores `--alert`, `--warn` y `--success` son solo relleno; para texto se usan `--alert-text`, `--success-text` y `--muted`, que pasan WCAG AA. `src/styles/tokens.test.ts` lo comprueba.
- Reglas que no se negocian: ningún texto por debajo de 14 px, áreas táctiles de 44 px o más, sin degradados, sin emojis decorativos, sin iconos de cerebro, robot o IA, y nunca mostrar cifras de comisión.

## Estructura

```
src/app/              Rutas (App Router)
src/config/           Configuración regional
src/lib/              Utilidades compartidas
src/styles/           Tokens de diseño
e2e/                  Pruebas de Playwright
pruebas/              Pruebas del repo (secretos)
supabase/migrations/  Esquema de la base (migraciones idempotentes)
supabase/tests/       Pruebas pgTAP de restricciones y políticas
backlog/              Una HU por archivo (sistema de backlog)
scripts/backlog.py    CLI del backlog
docs/                 Documentación del sistema de backlog
```

## Backlog

El trabajo se organiza en historias de usuario dentro de `backlog/`, y el tablero es `BACKLOG.md`, que se genera solo. Todo cambio de estado pasa por `python scripts/backlog.py` (requiere Python 3.8 o superior). La guía completa para trabajar con Claude está en `GUIA_CLAUDE.md`, y el detalle del sistema en `docs/sistema-backlog.md`.

Documentos de referencia: `calibra_reglas_negocio.md` (reglas del modelo v10), `REVISION_REGLAS.md` (pendientes P-18 en adelante) y `HU_POR_ACTOR.md`.
