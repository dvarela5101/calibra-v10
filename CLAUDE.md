@AGENTS.md

# Calibra v10

Reconstrucción de Calibra sobre el modelo v10 (`calibra_reglas_negocio.md`). Stack decidido en HU-001 (P-17): Next.js 16 App Router + TypeScript en Vercel, Supabase (Postgres, Auth con inicio anónimo, Storage, Realtime, tareas programadas), Vitest y Playwright. El prototipo `../Calibra` es referencia de solo lectura. Lee `README.md` para comandos, CI y estructura.

## Reglas del proyecto

- Antes de escribir código de Next.js, lee la guía correspondiente en `node_modules/next/dist/docs/` (ver `AGENTS.md`).
- Zona horaria de negocio `America/Bogota` y textos en español (`src/config/regional.ts`). Nunca calcules una fecha con la zona del servidor.
- Colores solo desde `src/styles/tokens.css`. `--alert`, `--warn` y `--success` son relleno; para texto, `--alert-text`, `--success-text` y `--muted`.
- Ningún texto por debajo de 14 px, áreas táctiles de 44 px o más, sin degradados, sin emojis decorativos, sin iconos de cerebro, robot o IA. Nunca mostrar cifras de comisión.
- Ninguna llave secreta en el repo. Las variables nuevas se documentan en `.env.example` sin valor.
- Antes de dejar una HU en revisión: `npm run verificar` (lint, typecheck, Vitest, build y Playwright) y, si tocó la base, `npm run db:verificar`.
- Un commit por HU, con el id en el asunto (por ejemplo `HU-003: motor de plazos...`). El repo `dvarela5101/calibra-v10` es temporal: en el corte (HU-057) se sube al repo real de Calibra conservando el historial. Nunca hagas push al repo del prototipo antes de eso.

## Base de datos

- El proyecto Supabase real (`uotlhaitdkfroavqkvee`) sostiene el prototipo en vivo hasta el corte final (HU-057). **No le apliques migraciones ni escribas en él**: nada de `supabase db push`, `--linked`, ni `apply_migration`/`execute_sql` de escritura por MCP. Leerlo para consultar está bien.
- Todo cambio de esquema es una migración nueva en `supabase/migrations/` (créala con `npx supabase migration new <nombre>`), idempotente, y se prueba en la base local (`npm run db:reiniciar`, `npm run db:verificar`). Cada regla nueva lleva su prueba pgTAP en `supabase/tests/`.
- RLS en toda tabla y permisos explícitos (`revoke`/`grant`). Las funciones `security definer` van en el esquema `privado`, que la Data API no expone. Una sola política permisiva por tabla y acción.
- `npx supabase db advisors --local --level warn` debe quedar sin hallazgos.
- `auto_expose_new_tables = false` (como en la nube desde el 30-oct-2026): toda tabla o función nueva necesita su `grant` explícito, también para `service_role`.
- Después de cambiar el esquema: `npm run db:tipos`.

## Autenticación

- Autoriza en el servidor, cerca de los datos: `exigirRol()`/`obtenerSesion()` de `src/lib/auth/sesion.ts` en cada página o acción protegida. El proxy solo refresca la sesión.
- En el servidor usa `getClaims()`, nunca `getSession()`. El rol sale de `public.mi_rol()`, no de claims editables ni de `user_metadata`.
- La llave secreta solo en `src/lib/supabase/admin.ts` (con `server-only`).
- Las pruebas que tocan Auth corren contra el Supabase local: `npm run test:integracion` y `npm run test:e2e`, con usuarios creados y borrados por la propia prueba.

## Trabajo en paralelo (dos personas, cada una con su sesión de Claude)

El estado de las HUs vive en `backlog/` en la rama `main`. Git es el candado.

**Tomar una HU**
1. `git switch main` y `git pull`.
2. `python scripts/backlog.py take` (o `start HU-XXX` si acordaron cuál) y `python scripts/backlog.py log HU-XXX "Tomada por <nombre>"`.
3. Commit SOLO de `backlog/` y `BACKLOG.md` (`HU-XXX: en progreso (<nombre>)`) y `git push` a `main` de inmediato. Ese push reserva la HU.
4. Si el push se rechaza: `git pull --rebase`. Si la otra persona ya tomó esa misma HU, descarta tu reserva (`git rebase --abort` o `git reset --hard origin/main`) y toma otra.
5. Trabaja en una rama `hu-XXX-<tema>` creada desde `main`.

**Reglas**
- **Antes de cada commit, trae lo último de `main`.** Corre `git fetch` y, si `origin/main` avanzó, intégralo antes de commitear:
  - en `main`: `git pull --rebase --autostash`;
  - en tu rama: `git merge --autostash origin/main`.

  Si entraron cambios, vuelve a correr las verificaciones que apliquen antes del commit.
- Nunca tomes, continúes ni edites una HU `En progreso` de la otra persona. Una HU solo se toma si sus dependencias están `Hecha` en `main`.
- Terminar: `review` en tu rama, verifica todo, `git merge origin/main`, vuelve a verificar y abre un PR hacia `main`. Con CI en verde, la misma sesión lo fusiona con squash (un commit por HU) y la HU queda `En revision`. La persona revisa después y aprueba con `done` en `main`; lo que no le guste se corrige en un PR nuevo.
- Archivos generados que chocan: no los resuelvas a mano, regenéralos. `BACKLOG.md` con `python scripts/backlog.py index`, `src/lib/supabase/tipos.ts` con `npm run db:tipos` y `package-lock.json` con `npm install`.
- Migraciones: nunca edites una que ya esté en `main`; crea una nueva. Si tu rama redefine una función SQL (`create or replace`), parte de la versión que está en `main` al momento del merge y corre `npm run db:reiniciar` y `npm run db:verificar` después de fusionar `main`.
- Cada uno usa su propio Supabase local (Docker). Nadie escribe en el proyecto real (ver "Base de datos").

# Instrucciones para Claude — Sistema de backlog de HUs

Este repo tiene un backlog de historias de usuario (HU) en `backlog/HU-XXX.md`. Cada HU tiene frontmatter con `estado`, `prioridad`, `talla` y `depende_de`. El indice legible esta en `BACKLOG.md` (generado, no editar a mano). La guia completa esta en `GUIA_CLAUDE.md`.

Toda la gestion se hace con `python scripts/backlog.py`. No cambies el frontmatter a mano: usa el script para que el estado, el registro y el indice queden consistentes. Para cambiar titulo, prioridad, talla o dependencias: `backlog.py edit HU-XXX [-t ...] [-p ...] [-e ...] [-d ...]`.

## Estados

`Backlog` → `Lista` → `En progreso` → `En revision` → `Hecha` (y `Bloqueada` desde cualquiera).

- **Backlog**: idea todavia sin refinar. Claude NO las toma.
- **Lista**: refinada, con criterios de aceptacion claros. Es lo unico que Claude puede tomar.
- **En revision**: Claude termino y espera que la persona valide.
- **Hecha**: la persona la aprobo (o pidio expresamente cerrarla).

## Como iniciar una sesion de trabajo

1. Si la persona te da un ID (por ejemplo "trabaja HU-012"): `python scripts/backlog.py show HU-012`, verifica que este `Lista` (o `En progreso` si se retoma) y que sus dependencias esten `Hecha`, luego `python scripts/backlog.py start HU-012`.
2. Si la persona dice "toma la siguiente" (o no da ID): `python scripts/backlog.py take`. Elige la HU de mayor prioridad (P0 primero) en estado `Lista` cuyas dependencias esten `Hecha`, la pasa a `En progreso` y la muestra. Si no hay elegibles, dilo y explica por que (dependencias pendientes, nada en `Lista`); no inventes trabajo.
3. Lee la HU completa (historia, contexto, criterios, fuera de alcance, notas tecnicas) antes de escribir codigo.

## Mientras trabajas

- Trabaja **solo** contra los criterios de aceptacion. Respeta "Fuera de alcance".
- Si la HU es ambigua o contradictoria, para y pregunta antes de construir; deja la pregunta en el registro (`backlog.py log HU-XXX "..."`).
- Registra decisiones importantes y hallazgos con `backlog.py log HU-XXX "mensaje"`.
- Si te bloqueas (falta informacion, dependencia externa): `backlog.py block HU-XXX -m "motivo concreto"` y avisa a la persona.
- Si descubres trabajo nuevo que no cabe en la HU, no lo metas a escondidas: crea una HU nueva en `Backlog` con `backlog.py new "titulo"` y mencionala al final.

## Al terminar

1. Marca los criterios cumplidos en el archivo de la HU (`- [x]`).
2. Ejecuta las pruebas relevantes.
3. `python scripts/backlog.py review HU-XXX -m "resumen breve de lo hecho y como verificarlo"`.
4. Solo pasa a `Hecha` (`backlog.py done`) si la persona lo pide o aprueba. Por defecto queda `En revision`.
5. Cierra tu respuesta con: que se hizo, como verificarlo, y HUs nuevas creadas (si las hay).

## Reglas

- Una HU `En progreso` a la vez por sesion, salvo que la persona pida lo contrario.
- Nunca tomes HUs en `Backlog` ni en `Bloqueada` por iniciativa propia.
- Nunca edites `BACKLOG.md` a mano; se regenera con `backlog.py index`.
