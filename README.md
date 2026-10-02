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

Requisitos: Node 22.18 o superior (ver `.nvmrc`) y npm. Los scripts del banco de preguntas (`scripts/contenido/*.mts`) corren TypeScript directo con Node, que lo admite sin banderas desde la 22.18. Después de clonar, un solo comando instala y levanta la app:

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
| `npm run verificar` | Lint, tipos, pruebas unitarias, banco de preguntas, build y e2e, en el orden del pipeline |
| `npm run db:iniciar` | Levanta Supabase local (Postgres, Auth, REST, Storage y Mailpit) con las migraciones |
| `npm run db:env` | Escribe `.env.local` con las llaves del Supabase local |
| `npm run db:tipos` | Regenera `src/lib/supabase/tipos.ts` desde el esquema local |
| `npm run db:reiniciar` | Borra la base local y aplica las migraciones y la semilla desde cero |
| `npm run db:verificar` | Reaplica las migraciones (idempotencia) y corre las pruebas pgTAP |
| `npm run db:detener` | Detiene los contenedores locales de Supabase |
| `npm run contenido:validar` | Valida el banco de preguntas (`contenido/`) sin tocar ninguna base: errores con archivo y línea, conteos y cobertura |
| `npm run contenido:cargar` | Valida y carga el banco en la base local. Con `-- --borradores` también carga las preguntas en borrador |

Una migración nueva que cambia las columnas de salida de una función tiene que borrarla antes con `drop function`. Desde entonces la migración vieja que la creó ya no se puede reaplicar sobre la base final, y `db:verificar` fallaría al reaplicarla. Sin editar la migración vieja, `scripts/verificar-bd.mjs` lleva una lista de preámbulos (`PREAMBULOS`) que dice qué borrar antes de reaplicar cada una. Hoy tiene una entrada: `parametros_negocio()`, que HU-063 dejó sin la comisión.

## Variables de entorno

La plantilla es `.env.example`. Cópiala como `.env.local` y completa los valores. Ningún `.env` con valores se versiona: `.gitignore` los excluye y `pruebas/secretos.test.ts` falla si alguno entra al repo o si aparece una llave secreta en un archivo versionable.

- `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: públicas por diseño, llegan al navegador.
- `SUPABASE_SECRET_KEY`: solo servidor. Nunca con prefijo `NEXT_PUBLIC_`.
- `SMTP_SERVIDOR`, `SMTP_PUERTO`, `SMTP_USUARIO`, `SMTP_CONTRASENA`, `RESEND_API_KEY` y `CORREO_REMITENTE`: solo servidor, para el correo transaccional (ver [Correo transaccional](#correo-transaccional)). `SITIO_URL` es la dirección pública para los enlaces de los correos. En local no hacen falta: el correo sale por Mailpit.
- `CRON_SECRETO`: solo servidor. El secreto con que pg_cron llama a las rutas de `/api/procesos` (HU-065); el mismo valor va en Vault.

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
- Un desembolso es ejecutable **después** de `desembolsable_desde`, no desde ese instante: en el instante exacto la ventana de reporte sigue abierta (N-6, HU-063). Así lo dice la bandeja. El encabezado de `20260929070017_bandeja_admin.sql` todavía habla del "borde inclusivo de HU-003"; quedó superado por `*_ajustes_plazos_y_comision.sql` y no se edita porque ya está en `main`.
- Un admin desactivado (RN-23) no ve nada de la bandeja: ni la vista ni las tablas que lee (`supabase/tests/bandeja_admin.test.sql`, HU-064).
- Los textos de ayuda no prometen lo que aún no existe: el orden por vencimiento se anuncia solo en los pagos, y el paso al siguiente admin cuando vence un pago se anunciará con el escalamiento (HU-034).
- El tiempo restante de un pago sale del motor de plazos (HU-003) y respeta el borde inclusivo de P-40.
- Cada sección se vuelve accionable cuando llegan HU-020 (pagos), HU-026 (reembolsos), HU-030 (reportes) y HU-028 (desembolsos).

## Equipo de admins

`/admin/equipo` (HU-054, enlazada desde la bandeja): el equipo de admins en su orden de revisión (RN-07), con quién está activo y cuántos casos abiertos tiene (pagos en revisión, reembolsos activos y reportes en revisión, en un solo número). Un admin sube o baja a otro un puesto y desactiva a otro (RN-23), con confirmación.

- `public.equipo_de_admins()` y `public.mover_admin(id, direccion)` (invoker, con la sesión) sobre funciones definer de `privado` que exigen un admin activo: a cualquier otro, el equipo le llega vacío y mover responde `sin_permiso`. Mover intercambia el orden con el vecino en una sola sentencia (la llave única es diferible).
- El turno es `privado.siguiente_admin_activo(id)`: el admin activo que sigue en el orden, volviendo al primero, saltándose a los desactivados. Lo usan la asignación de pagos (HU-018) y la reasignación al desactivar (HU-074), y lo usará el escalamiento de pagos (HU-034).
- Desactivar pasa por `desactivarCuenta()` (`src/lib/auth/cuentas.ts`): primero `public.reasignar_casos_de_admin(id)` (solo `service_role`) pasa sus reembolsos activos, reportes en revisión y pagos en revisión al siguiente activo (P-44, HU-074), después lo banea en Auth y al final reasigna otra vez. Los pagos pasan con `fecha_asignacion` nueva: quien los recibe tiene su hora entera (RN-42). Si la primera reasignación falla, no se desactiva. Sus certificados, sus revisiones y sus pagos aprobados o rechazados se conservan.
- Por qué reasigna dos veces: el baneo va por la API de Auth, en otra transacción, y hasta entonces el admin sigue activo y `registrar_pago` lo puede elegir. La segunda vuelta pasa esos pagos. Para un pago que se está creando justo cuando se reasigna, `reasignar_casos_de_admin` toma en exclusivo el candado de transacción `hashtextextended('turno_de_admins', 0)` y `registrar_pago` lo toma compartido antes de elegir admin (`*_reasignar_pagos.sql`): uno espera al otro. Lo que elija un admin con el turno debe tomar el mismo candado.
- Nadie se desactiva a sí mismo y el equipo nunca se queda sin admins activos (`src/lib/admin/equipo-reglas.ts`). Agregar admins aún no tiene pantalla: [HU-072](backlog/HU-072.md).

## Certificados de monitor

`/admin/certificados` (HU-014): después de la evaluación presencial (P-19), el admin certifica al monitor en una materia con la fecha de esa evaluación. El certificado no vence, y es uno por monitor y materia (RN-21). El monitor ve sus materias certificadas en `/monitor`, y con al menos una puede abrir franjas.

- Solo un admin activo inserta, y a su nombre: la política "admin certifica" exige `privado.es_admin()` y que `id_admin` sea él. La fecha de emisión la pone la base. Nadie con sesión cambia ni borra un certificado: revocar está fuera de alcance.
- Los certificados de un admin desactivado siguen vigentes (RN-23).
- Las materias reales llegarán con el banco de preguntas (HU-005) o con la gestión de materias (HU-055). Mientras tanto (D-2), la semilla local trae tres de prueba: MATE-1214, MATE-1207 y FISI-1018.

## Solicitudes para ser monitor

`/quiero-ser-monitor` (HU-062, P-19): quien quiere ser monitor deja su nombre, su teléfono, su correo y las materias en las que quiere certificarse, con la autorización de datos (RN-13). Se llega desde el pie de cualquier página. Está fuera del grupo `(publico)`, así que no crea una sesión anónima de estudiante.

- La solicitud la guarda el servidor con la llave secreta, con `crear_solicitud_monitor()`, que guarda la solicitud y sus materias en una sola transacción. Si falta un dato, el correo no sirve o no hay autorización, no se guarda nada. Ninguna sesión inserta directo. El correo solo admite letras, dígitos y `. _ % + ' -` antes de la arroba, y un dominio de letras, dígitos, guiones y puntos (en el `mailto:` del admin, un `?` sería un parámetro).
- Como el formulario no pide sesión, tiene tres frenos contra los envíos masivos. Si la persona ya tiene una solicitud abierta (nueva o contactada) con el mismo correo o teléfono, se le devuelve esa y no se crea otra. Entre todos no se crean más de 30 solicitudes por hora: las creaciones van de a una (un candado) y la siguiente recibe el error 54000, con un mensaje que pide intentarlo en una hora. Y un campo trampa (`sitio_web`), fuera de la vista y del teclado, hace que lo que envíe un programa reciba la misma respuesta sin que se guarde nada.
- `/admin/solicitudes` las muestra de la más antigua a la más nueva, por páginas de 50 (`?pagina=2`). Sin `?pagina=` redirige a la página de la solicitud abierta más antigua (o a la última, si no hay abiertas), para que lo pendiente quede a la vista; la columna generada `abierta` dice cuáles lo están. El orden no depende del estado, así que al marcar una solicitud ninguna cambia de lugar. El admin las marca como contactada, evaluada o descartada, a su nombre. Solo un admin activo las lee y les cambia el estado; nadie más lee ninguna, ni quien la envió. Si la evaluación sale bien, el admin invita al aspirante (`/admin/monitores`, HU-013) y lo certifica (`/admin/certificados`, HU-014).
- El aviso de privacidad (`/privacidad`) dice qué datos se piden y para qué. Las solicitudes siguen la misma retención que el contacto (P-13); borrarlas cuando toque va con el proceso de retención.

## Contacto al agendar

`/agendar/contacto?siguiente=/ruta` (HU-068, D-3): el diagnóstico es opcional, así que quien va a agendar sin ser Lead deja aquí nombre, correo, teléfono opcional y su autorización de datos (HU-008). Al terminar vuelve a `siguiente`. Quien ya es Lead sigue de largo; con `&editar=1` cambia sus datos.

- La base admite un Lead por correo normalizado y uno por sesión. Lo crea el servidor con `public.registrar_lead()`, que también le liga los diagnósticos que la sesión hizo antes. Solo lo llama service_role.
- Si el correo ya es de otro Lead (P-23), no se liga nada: se manda el correo `verificacion_lead` con un enlace a `/contacto/verificar`. El enlace vence en 24 horas y sirve una vez. Se mandan como máximo 3 por hora al mismo Lead: lo cuenta y lo crea `public.crear_verificacion_lead()` con la fila del Lead bloqueada, así que ni muchos pedidos a la vez lo pasan. El aviso al visitante dice si el enlace salió, se frenó o falló.
- En esa página (que muestra el correo a medias, `a***@u***.edu.co`), el botón "Sí, es mi correo" liga **el navegador que abrió el enlace** a ese Lead (`lead_sesion`, que `privado.es_mi_lead` tiene en cuenta), con sus diagnósticos. Abrir el enlace no cambia nada, así que un revisor de enlaces no lo gasta.
- Una sesión, un Lead: `registrar_lead` y `confirmar_correo_de_lead` toman el mismo candado por sesión y cuentan el Lead propio, el confirmado y el de la cuenta de Estudiante.
- `siguiente` solo admite rutas internas ya normalizadas (`rutaSiguiente`, y un CHECK en la base): `/.//otro.sitio` termina en `/`.
- El origen del Lead es la campaña con la que llegó el visitante (`?utm_campaign=...`). `OrigenDeCampana` la guarda en la cookie `calibra_origen` por 30 días.

## Monitores y fechas libres

`/monitores?materia=CODIGO` (HU-016, D-4, D-5): los monitores certificados en la materia y sus fechas libres de las próximas 4 semanas (`SEMANAS_DEL_HORIZONTE`), con hora, duración, modalidad y precio. Sin materia, o con un código que no existe, el visitante la elige. Los enlaces a esta lista se arman con `rutaDeMonitores(codigo)`.

- Las fechas las calcula la base: `public.fechas_libres_de_materia(codigo, semanas)` (security invoker) llama a `privado.fechas_libres_de_materia`, que es security definer porque nadie fuera del servidor lee `monitoria` y la primera página de un visitante corre sin sesión (rol `anon`). Devuelve solo lo público: nunca el contacto ni la llave del monitor, ni el lugar o el enlace de la franja.
- `privado.fecha_libre(franja, fecha, ahora)` es la regla única de "esta fecha se puede agendar": el día de la franja, abierta en esa fecha (HU-015), la antelación de 3 h del motor de plazos (P-40, borde incluido), sin monitoría que no esté cancelada ni sea una reserva vencida (RN-33; HU-027, `privado.reserva_vencida`) y con el monitor activo. La reserva (HU-017) usa la misma.
- Se ordena por la fecha libre más próxima de cada monitor y luego por nombre. Cada fecha lleva a agendarla (HU-017).

## Agendar una monitoría individual

Cada fecha libre de `/monitores` lleva a `/agendar?franja=…&fecha=…&materia=…` (HU-017). La página confirma lo mismo que mostró la lista (lo vuelve a leer de `public.fechas_libres_de_materia`). Quien todavía no es Lead deja su contacto en `/agendar/contacto` (HU-068) y vuelve. Al apartar, la base crea la monitoría en `pendiente_pago` y lleva a `/agendar/reserva/<id>`, donde HU-018 pondrá el pago.

- La reserva la hace `public.agendar_monitoria(franja, fecha, materia, acepta_sin_cancelacion)` (security invoker, solo con sesión) sobre `privado.agendar_monitoria` (definer). Toma la identidad de `auth.uid()` y la hora de `now()`: nadie agenda a nombre de otro ni elige la hora con que se mide la antelación.
- En una transacción:
  - pone en fila al Lead (una reserva por pagar vigente a la vez, D-8) y a la franja (`for update`);
  - revisa el certificado en la materia, las 4 semanas de la lista (D-9, `privado.semanas_para_agendar()`) y `privado.fecha_libre` (HU-016);
  - pide la casilla de RN-37 con menos de 12 h (D-10);
  - copia el precio de la franja en `valor_total` (RN-32) y liga el diagnóstico más reciente de la materia (P-35, D-7).
- Si dos personas confirman la misma fecha a la vez, el índice `monitoria_franja_fecha_activa_key` deja pasar a una y la otra recibe `ocupada` (RN-33).
- D-7: la cita individual apunta a su diagnóstico (`monitoria.id_diagnostico`) y varias citas pueden compartirlo; el monitor de cada una lo lee por la política de `diagnostico`. `diagnostico.id_monitoria` queda para la grupal.
- Una reserva `pendiente_pago` ocupa la fecha mientras está vigente (`reserva_hasta`, 10 minutos desde que se creó). Para D-8 también cuenta solo en ese lapso.
- Reserva vencida (RN-34, HU-027): la que pasó su `reserva_hasta` sin ningún pago, ni siquiera uno rechazado. Con el borde incluido (P-40), vence cuando la hora es posterior a `reserva_hasta`. La define `privado.reserva_vencida`, el mismo predicado de la agenda del monitor (D-12). Cada minuto pg_cron corre `privado.expirar_reservas(now())` (trabajo `calibra-expirar-reservas`), que la pasa a `cancelada` con motivo `reserva_expirada`. No se avisa a nadie (D-16).
- La disponibilidad no espera al proceso: `privado.fecha_libre` ya no cuenta la vencida, y si alguien pide esa fecha, `agendar_monitoria` la cancela en ese momento, porque el índice único no puede mirar la hora.
- Si el comprobante llega justo cuando vence la reserva, solo uno gana, porque el proceso y `registrar_pago` bloquean la misma fila. Gane quien gane, el pago tardío recibe `vencida`, y la página de la reserva dice "Tu reserva venció" esté cancelada o no.

## Agenda del monitor

`/monitor/agenda` (HU-021, enlazada desde `/monitor`): las monitorías del monitor, por finalizar (HU-023), próximas (pendientes de pago vigentes y confirmadas, de la más cercana a la más lejana) y pasadas (realizadas, canceladas con su motivo y reservas vencidas, de la más reciente a la más antigua; D-12). Cada una con fecha, hora, duración, materia, modalidad, el nombre de quien agendó y el estado del pago.

- La da `public.mi_agenda()` (invoker, solo con sesión) sobre `privado.agenda_del_monitor(ahora)` (definer): el monitor no lee `lead` ni `pago`, así que la función devuelve solo sus monitorías (`auth.uid()`), el nombre del Lead (nunca su correo ni su teléfono, P-37) y el estado agregado del pago (D-11), sin valor ni comisión (P-24).
- Estado del pago (D-11): rechazado si algún comprobante lo fue, si no en revisión, si no aprobado; sin comprobantes, sin pagar.

## Finalizar una sesión

`/monitor/agenda` (HU-023) muestra arriba, en "Por finalizar", las confirmadas que ya empezaron, con el botón "Marcar como realizada" y la hora en que se cierran solas. El panel del monitor recuerda cuántas tiene (D-15).

- `public.finalizar_monitoria(id)` (invoker, solo con sesión) sobre `privado.finalizar_monitoria` (definer): con `auth.uid()` y `now()`, la pasa a `realizada` con `fecha_finalizacion` si es del monitor, está confirmada y ya llegó su inicio (D-13, borde incluido).
- Cierre automático (P-05, D-14): pg_cron corre cada 15 minutos `privado.cerrar_monitorias_sin_finalizar(now())`, que cierra cada individual confirmada que alcanzó `public.cierre_automatico_desde(fin programado)` = fin + `cierre_automatico_min` (24 h, en `parametros_negocio()`). Las grupales no se cierran solas (su monitor entrega el enlace de reseña, HU-046).
- El desembolso al pasar a `realizada` es de HU-028. El correo de reseña individual sale con HU-035 (ver "Reseña individual").

## Avisos al monitor

HU-051 (D-16): el monitor recibe un correo cuando una monitoría individual suya queda `confirmada` (fecha y hora en Bogotá, duración, materia, modalidad y el nombre del estudiante, nunca su contacto, P-37) y cuando el estudiante cancela una confirmada. Las reservas por pagar y las que vencen sin pago no se avisan. Sale aunque el cambio de estado lo haga otra HU (HU-018 confirma, HU-024 cancela).

- El trigger `monitoria_anota_aviso_monitor` (`privado.anotar_aviso_monitor`, definer) anota el aviso en `public.aviso_monitor` en la misma transacción del cambio de estado. Solo individuales y solo dos transiciones: `pendiente_pago → confirmada` y `confirmada → cancelada` con motivo `estudiante`.
- El mismo trigger llama `privado.disparar_avisos_monitor()`, que con pg_net hace un `POST` a `/api/procesos/avisar-monitores` (mismo secreto y mismas entradas de Vault que los reintentos de HU-065). pg_net lo envía al confirmarse la transacción, así que el correo sale en segundos. pg_cron repite el pedido cada 5 minutos si quedan avisos sin procesar. Si el pedido falla (Vault o pg_net), el trigger lo deja en un aviso del log y el cambio de estado sigue: nunca tumba una confirmación ni una cancelación.
- Cada corrida toma hasta 10 avisos y deja de tomar pasados 20 s, como los reintentos. Un aviso que no se puede procesar (error de la base o de los datos) suma un intento en `aviso_monitor.intentos` y se abandona a los 5, para no tapar a los demás.
- La ruta (`src/lib/avisos/servidor.ts`) lee los datos con `public.datos_de_aviso_monitor(id)` (solo `service_role`) y manda el correo con la entidad = id de la monitoría: la clave única de `correo_envio` impide mandarlo dos veces. Antes de mandarlo comprueba que el aviso siga valiendo: si la monitoría ya se canceló, el de confirmada no sale. Un correo que falla queda para los reintentos de HU-065, que lo reconstruyen desde la monitoría.

## Reseña individual

HU-035 (RN-70, RN-72, D-17): cuando una monitoría individual pasa a `realizada`, sea porque la finaliza el monitor o por el cierre automático, el Lead recibe un correo con el enlace a la reseña de su pago. En `/resena?token=…` califica de 1 a 5, con un comentario opcional de hasta 1000 caracteres. Un pago tiene como máximo una reseña, y un pago rechazado no se reseña. El enlace no vence.

- El trigger `monitoria_anota_invitacion_resena` (`privado.anotar_invitacion_resena`, definer) anota en `public.invitacion_resena` una invitación por cada pago no rechazado y sin reseña, en la misma transacción del paso a `realizada`. Las grupales no reciben invitación: su reseña es por enlace del monitor (RN-71, HU-046 y HU-047).
- Se mandan como los avisos al monitor: `privado.disparar_invitaciones_resena()` hace un `POST` con pg_net a `/api/procesos/invitar-resenas` (mismos `calibra_sitio_url` y `calibra_cron_secreto` de Vault), y pg_cron lo repite cada 5 minutos si quedan pendientes. El pedido nunca tumba el cambio de estado. Cada corrida procesa hasta 10 invitaciones durante 20 s como máximo, y una que falla 5 veces se abandona.
- El correo usa la plantilla `resena_individual`, con la entidad = id del pago: la clave única de `correo_envio` impide mandarlo dos veces. Si falla, HU-065 lo reconstruye con el mismo enlace.
- El token se guarda en claro en `invitacion_resena`, y la tabla solo la lee `service_role`. Así el reintento puede mandar el mismo enlace sin rotarlo. Solo sirve para dejar una reseña.
- La página lee con `public.resena_por_token` y guarda con `public.registrar_resena`, las dos solo para `service_role`. `registrar_resena` bloquea el pago y vuelve a revisar todo, así que dos envíos a la vez dejan una sola reseña. `resena` tiene los `check` de D-17.

## Cita confirmada y enlace de gestión

HU-019 (P-04, D-19 a D-25): cuando una monitoría individual pasa de `pendiente_pago` a `confirmada` (al subir el comprobante, HU-018), el Lead recibe un correo con el resumen de la cita y un enlace para verla y gestionarla. El correo va al Lead; si no tiene correo, al contacto del primer pago (D-19).

- El trigger `monitoria_anota_confirmacion_cita` (`privado.anotar_confirmacion_cita`, definer) anota la confirmación en `public.confirmacion_cita`, una por monitoría, con su token. Solo individuales y solo esa transición. Una monitoría insertada ya `confirmada` no dispara nada: las pruebas la crean `pendiente_pago` y la confirman con un `UPDATE`.
- Se manda como los avisos al monitor y la reseña: `privado.disparar_confirmaciones_cita()` hace un `POST` con pg_net a `/api/procesos/confirmar-citas` (mismos secretos de Vault), y pg_cron lo repite cada 5 minutos si quedan pendientes. El correo no sale si la cita ya no está confirmada o ya empezó. Plantilla `confirmacion_cita`, entidad = id de la monitoría; HU-065 lo reintenta con el mismo enlace.
- El token se guarda tal cual y no vence mientras exista la cita (D-20): sirve para ver la cita y, con HU-024 y HU-029, para cancelarla y reportar inasistencia. Abrirlo no liga el navegador al Lead.
- `/cita?token=…` muestra la cita (`public.cita_por_token`, solo `service_role`). Sin token, `/cita` lista las citas del navegador (`public.mis_citas`) y `/cita/[id]` abre una (`public.mi_cita`), las dos con la sesión del Lead (`privado.es_mi_lead`). Las rutas van fuera de `(publico)`: abrir el enlace no crea una sesión anónima. Llevan `noindex` y `no-referrer`.
- El lugar de la presencial o el enlace de la virtual solo salen con la cita confirmada, aunque el pago siga en revisión (D-21). Si el pago se rechaza, o la cita terminó, se cancela o se realiza, dejan de mostrarse.
- La página dice hasta cuándo se puede cancelar, sin botón: cancelar llega con HU-024 (D-25). `src/lib/citas/reglas.ts` (`vistaDeCita`) decide los textos de cada estado.
- "Mis citas" está en el pie de página y en la reserva confirmada ("Ver y gestionar mi cita").

## Franjas del monitor

`/monitor/franjas` (HU-015): el monitor certificado abre franjas semanales (día, hora, duración, precio y modalidad, con lugar o enlace de videollamada), las edita y las cierra desde una fecha. Las reglas (P-30, P-31) las aplica el trigger `privado.validar_franja_del_monitor` a toda escritura que no sea de confianza, y `src/lib/franjas/reglas.ts` da los mismos mensajes antes de ir a la base.

- La franja se lee en público (para agendar), pero el lugar y el enlace no: los permisos de `select` son por columna. El monitor lee los suyos con `public.acceso_a_mis_franjas()`. Quien necesite mostrarlos a un estudiante (la cita confirmada, HU-019) los lee desde el servidor.
- Día, hora y duración no cambian si la franja tiene monitorías no canceladas: los plazos de cada monitoría salen del horario de la franja. El precio sí cambia; la monitoría guarda su `valor_total` (RN-32).
- Cerrar es poner `cerrada_desde`, posterior a la última monitoría activa. Una franja ya cerrada no se edita ni se reabre.
- Las escrituras con la llave secreta (pruebas, herramientas) no pasan por esas reglas: quien escriba franjas así tiene que respetarlas por su cuenta.

## Comprobantes de pago

Los comprobantes van en el bucket privado `comprobantes` de Supabase Storage (HU-007). La ruta es `<id del usuario>/<uuid>.<jpg|png|pdf>`, con el id del usuario de Auth que sube (la sesión anónima del pagador también lo es), y `pago.comprobante` guarda esa ruta.

- Se suben desde el navegador con la sesión del pagador, directo al Storage: un archivo de hasta 10 MB no cabe en una función de Vercel, que acepta 4,5 MB. `subirComprobante()` (`src/lib/comprobantes/almacenamiento.ts`) valida tipo, tamaño y contenido y devuelve un mensaje en español. El bucket vuelve a hacer cumplir el tamaño y los tipos por su cuenta.
- Leen el dueño de la carpeta y los admins. Desde la app nadie borra, y nadie mueve, copia sobre otro archivo ni pisa el comprobante de otra persona (`move`, `copy` y las URL de subida firmadas con `upsert` fallan, y `integracion/comprobantes.test.ts` lo comprueba). Tampoco el dueño ni el servidor pisan ni mueven un comprobante que ya existe: un trigger sobre `storage.objects` rechaza cambiar su contenido o su ruta, porque la subida con una URL firmada creada con `upsert` no pasa por las políticas ([HU-067](backlog/HU-067.md)). Para cambiar un comprobante se sube otro. Un admin abre un comprobante con `enlaceDeComprobanteDePago()`, que pide un enlace firmado de 60 segundos cada vez que se abre el pago.
- Quien cree un pago desde el servidor con la llave secreta debe comprobar con `rutaEsDelUsuario()` que la ruta sea de la carpeta del pagador antes de guardarla en `pago.comprobante`. Si no, alguien podría apuntar su pago al comprobante de otra persona.
- Antes de crear el pago, el servidor revisa el contenido con `revisarComprobanteDesdeServidor()` (`src/lib/comprobantes/servidor.ts`, HU-059): los primeros bytes tienen que ser del tipo que se declaró al subir y del de la extensión. Si coinciden, la ruta queda en `comprobante_revisado`. Si no, se descarta: el archivo se borra, salvo que un pago ya lo use (se conserva como evidencia), y si el borrado falla lo borra después la limpieza. Un comprobante de más de 24 horas ya no se anota y hay que subirlo de nuevo. `pago.comprobante` es una llave foránea a `comprobante_revisado`, así que la base no deja crear un pago con un comprobante sin revisar o descartado. Las pruebas que crean pagos anotan antes su comprobante como revisado (`Fixtures.marcarRevisado()`).
- Cada sesión sube máximo 5 comprobantes cada 24 horas (N-4). Cuenta subidas y no archivos: uno descartado o borrado sigue contando hasta que pasan las 24 horas. Lo hace cumplir un trigger sobre `storage.objects`, que también frena las subidas con URL firmada; `subirComprobante()` consulta antes `mi_cuota_de_comprobantes()` para decir desde cuándo se puede subir otro. El protocolo S3 del Storage queda apagado en `supabase/config.toml`: la app no lo usa y sus subidas multiparte sin completar no pasan por ese trigger.
- Un comprobante que lleva más de 24 horas sin que ningún pago lo use se borra (N-4). Cada hora pg_cron llama a `/api/procesos/limpiar-comprobantes` con el mismo secreto y la misma dirección en Vault que los reintentos de correo (ver [Reintentos y procesos programados](#reintentos-y-procesos-programados-hu-065)); sin ellos, en local, no corre sola. La ruta borra con la API de Storage, porque por SQL lo bloquea el propio Storage.
- El límite de 10 MB (N-3, HU-063; era 5 MB) y los tipos están en el bucket, que declara la migración `*_ajustes_comprobantes.sql` sobre la de `*_comprobantes_privados.sql`. Se repiten en `src/lib/comprobantes/reglas.ts` para dar mensajes claros antes de subir, y `integracion/comprobantes.test.ts` comprueba que coincidan.

## Correo transaccional

`enviarCorreoDesdeServidor()` (`src/lib/correo/servidor.ts`, HU-006) manda los correos de la sección 8 de las reglas de negocio, en español, con versión HTML y texto plano. Las plantillas son funciones puras en `src/lib/correo/plantillas.ts`:

| Plantilla | Evento | Destinatario |
| --- | --- | --- |
| `recuperacion_diagnostico` | Diagnóstico completado: enlace con token para recuperar los resultados | Lead |
| `resena_individual` | Monitoría individual realizada: enlace a la reseña, sin límite de tiempo | Lead |
| `confirmacion_cita` | Monitoría individual confirmada: resumen y enlace para gestionar la cita (HU-019) | Lead |
| `solicitud_llave_reembolso` | Reembolso creado: se pide la llave para devolver el dinero | Pagador |
| `pago_rechazado_individual` | Pago rechazado en una individual: la cita se cancela | Pagador |
| `pago_rechazado_grupal` | Pago rechazado en una grupal: se anula ese cupo | Pagador |
| `escalamiento_pago` | Pago sin revisar tras el plazo: pasa al siguiente admin | Admin |
| `invitacion_monitor` | El admin invita a un aspirante tras la evaluación presencial (HU-013) | Aspirante a monitor |

Cada llamada lleva la plantilla, sus datos, el destinatario y una `entidad`, que es lo que motiva el correo (el id del reembolso o del diagnóstico). Plantilla más entidad forman la clave del correo. La entidad debe cambiar cada vez que el mismo evento tenga que volver a avisar: el escalamiento de un pago vuelve al primer admin al terminar la lista (RN-42), así que ahí la entidad es `pago:admin:n`, con el número de escalamiento, y no `pago:admin`, que la segunda vuelta descartaría como ya enviado. Solo admite ASCII imprimible, porque viaja como `Idempotency-Key`.

- La clave es única en `correo_envio`, el registro de envíos (destinatario, plantilla, fecha, resultado; sin el cuerpo). Si el correo ya salió, otra llamada con la misma clave no lo manda otra vez.
- Un fallo pasajero (red, 5xx, límite de ritmo) se reintenta hasta tres veces con espera creciente. Uno definitivo (llave inválida, remitente sin verificar) no. Si no sale, queda `fallido` con su error y la siguiente llamada con la misma clave lo reintenta sobre la misma fila. Como el registro no guarda el cuerpo, reintentar es volver a llamar con los mismos datos.
- Con Resend, la clave también viaja como `Idempotency-Key`, por si el envío llegó pero la respuesta no. Resend la recuerda 24 horas y rechaza reusarla con otro contenido, así que una plantilla no puede leer el reloj. SMTP no tiene ese encabezado: la idempotencia la pone el registro, y la clave da un `Message-ID` estable. Si la conexión se cae justo después de entregar el mensaje, el reintento puede duplicarlo; es raro y se acepta.
- Un contacto que no es un correo (un teléfono) no se envía: WhatsApp y SMS quedan fuera (P-22).
- La función no lanza por un fallo del proveedor ni del registro: devuelve `ok: false` con el motivo, para que un correo caído no tumbe el flujo que lo pidió.

El proveedor sale del entorno (`elegirProveedor`, ver `.env.example`), en este orden:

1. **SMTP de Gmail** (HU-066, decisión D-1): mientras no haya dominio propio, los correos salen desde `calibra.monitorias@gmail.com` con `SMTP_SERVIDOR`, `SMTP_PUERTO`, `SMTP_USUARIO` y `SMTP_CONTRASENA`, que es una contraseña de aplicación de Google. Las respuestas llegan a ese buzón. Gmail permite unos 500 correos al día; si se pasa, responde 550 y el envío queda `fallido` (no se reintenta solo: al día siguiente, volver a disparar el mismo correo lo manda sobre la misma fila).
2. **Resend**, cuando haya dominio verificado (`RESEND_API_KEY` y `CORREO_REMITENTE`). Sin dominio verificado, Resend solo entrega a la cuenta dueña de la llave.
3. **Mailpit**, solo en local y sin nada de lo anterior: el correo se ve en http://127.0.0.1:54324.

Los enlaces de los correos se arman con `urlDelSitio()` a partir de `SITIO_URL`. En producción (`NODE_ENV=production`) `SITIO_URL` y todo enlace de un correo tienen que ser https, porque llevan tokens; http solo se acepta en local, es decir, fuera de producción o hacia la propia máquina (`localhost`, `127.0.0.1`), que es como la e2e corre el build (HU-064). La llave de Resend y la contraseña de SMTP solo las lee código de servidor: `proveedor.ts`, `smtp.ts`, `registro.ts` y `servidor.ts` llevan `import "server-only"`, y `pruebas/correo-sin-llaves.test.ts` y `e2e/correo.spec.ts` comprueban que no lleguen al navegador.

### Reintentos y procesos programados (HU-065)

Si un correo falla por algo temporal (red, un 4xx de SMTP, un 5xx o el límite de ritmo de Resend, o el proveedor sin configurar), queda `fallido` con `reintentable = true`. Cada 10 minutos pg_cron corre `privado.disparar_reintento_correos()`, que con pg_net hace un `POST` a `/api/procesos/reintentar-correos` con `Authorization: Bearer <CRON_SECRETO>`. La ruta (`src/lib/correo/reintentos.ts`) toma los reintentables de las últimas 24 horas, reconstruye cada correo desde su entidad (`src/lib/correo/reconstructores.ts`) y lo vuelve a mandar con la misma clave. Lo definitivo, o lo que siguió fallando 24 horas, aparece en la bandeja del admin como "Correos que no salieron".

- La base toma la dirección del sitio y el secreto de Vault (`calibra_sitio_url` y `calibra_cron_secreto`). Sin ellos no dispara nada, que es lo que pasa en local. Los avisos al monitor (HU-051) usan los mismos.
- Toda plantilla que una HU empiece a disparar necesita su reconstructor: `pruebas/reconstructores.test.ts` falla si falta.
- Se reintentan los fallidos temporales que llevan al menos 2 minutos quietos y los `pendiente` abandonados (su envío murió hace más de 5 minutos). Cada corrida toma hasta 10 y deja de tomar pasados 20 s, para terminar antes del límite de la función (60 s).
- La invitación de monitor se reconstruye con un token nuevo, porque el token no se guarda: el enlace que no llegó deja de servir. Si el primer envío sí llegó y solo se perdió la respuesta, ese enlace también deja de servir; es raro y se acepta. Con Resend, además, el reintento repetiría la `Idempotency-Key` con otro contenido y Resend lo rechazaría (409, definitivo): al pasar a Resend hay que revisar este caso.

## CI y despliegue

`.github/workflows/ci.yml` corre en cada push a `main` y en cada PR hacia `main`:

1. **Verificar:** `npm ci`, lint, typecheck, pruebas unitarias y el `--dry-run` del banco de preguntas; luego levanta Supabase local, reaplica las migraciones y corre pgTAP, las pruebas de integración, el build y las e2e. Si fallan las e2e, sube el reporte de Playwright como artefacto.
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
pruebas/              Pruebas del repo (secretos, convertidor y banco de ejemplo)
contenido/            Banco de preguntas por habilidades, una carpeta por materia (ver contenido/README.md)
scripts/contenido/    Convertidor del banco: valida, carga y migración del prototipo
supabase/migrations/  Esquema de la base (migraciones idempotentes)
supabase/tests/       Pruebas pgTAP de restricciones y políticas
backlog/              Una HU por archivo (sistema de backlog)
scripts/backlog.py    CLI del backlog
docs/                 Documentación del sistema de backlog
```

## Backlog

El trabajo se organiza en historias de usuario dentro de `backlog/`, y el tablero es `BACKLOG.md`, que se genera solo. Todo cambio de estado pasa por `python scripts/backlog.py` (requiere Python 3.8 o superior). La guía completa para trabajar con Claude está en `GUIA_CLAUDE.md`, y el detalle del sistema en `docs/sistema-backlog.md`.

Documentos de referencia: `calibra_reglas_negocio.md` (reglas del modelo v10), `REVISION_REGLAS.md` (pendientes P-18 en adelante) y `HU_POR_ACTOR.md`.
