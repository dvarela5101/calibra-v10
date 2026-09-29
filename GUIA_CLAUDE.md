# Guía para Claude: cómo usar el backlog de HUs

Este documento es para ti, Claude, cuando inicias una sesión en un repo que contiene este sistema de backlog. Léelo completo antes de tocar código. Te dice qué es el sistema, cómo tomar trabajo de él y cómo dejar todo registrado.

## 1. Qué es esto

Un backlog de historias de usuario (HU) hecho de archivos markdown dentro del repo:

```
CLAUDE.md              Reglas resumidas (también las lees al iniciar)
BACKLOG.md             Índice/tablero generado automáticamente (solo lectura)
backlog/
  _plantilla.md        Plantilla de una HU
  HU-001.md ...        Una HU por archivo
scripts/backlog.py     CLI: única forma de crear HUs y cambiar su estado
```

Cada HU tiene un frontmatter con `id`, `titulo`, `estado`, `prioridad` (P0 = más urgente ... P3), `talla` (XS–XL), `depende_de`, `creada` y `actualizada`. El cuerpo tiene la historia, contexto, criterios de aceptación, fuera de alcance, notas técnicas, definición de terminado y un registro.

**Regla de oro:** nunca edites a mano el frontmatter ni `BACKLOG.md`. Todo cambio de estado se hace con `python scripts/backlog.py ...` para que el registro y el índice queden consistentes. Título, prioridad, talla y dependencias se cambian con `python scripts/backlog.py edit HU-XXX`. Lo que sí puedes editar a mano en el archivo de la HU es el cuerpo: marcar criterios (`- [x]`) y agregar notas técnicas.

## 2. Estados y qué significan

`Backlog` → `Lista` → `En progreso` → `En revision` → `Hecha`, más `Bloqueada`.

| Estado | Significado | ¿Puedes tomarla? |
|---|---|---|
| Backlog | Idea sin refinar | No |
| Lista | Refinada, con criterios claros | Sí |
| En progreso | Alguien la está trabajando | Solo si te la asignan / retomas |
| En revision | Terminada, esperando validación humana | No |
| Bloqueada | Detenida por algo externo | No |
| Hecha | Aprobada por la persona | No |

## 3. Cómo iniciar la sesión

Antes de nada, comprueba el estado general:

```bash
python scripts/backlog.py list
```

Luego, según lo que pida la persona:

**Caso A. "Toma la siguiente HU" (o no da ningún ID)**

```bash
python scripts/backlog.py take
```

Elige la HU elegible de mayor prioridad y la pasa a `En progreso`. Elegible significa: estado `Lista` y todas sus dependencias en `Hecha`. El desempate es por número de HU. Si `take` dice que no hay elegibles, díselo a la persona y explica por qué (nada en `Lista`, o las dependencias siguen pendientes). No inventes trabajo ni tomes HUs de `Backlog`.

Si solo quieres ver cuál sería la siguiente sin iniciarla: `python scripts/backlog.py next`.

**Caso B. La persona te da un ID (por ejemplo "trabaja HU-012")**

```bash
python scripts/backlog.py show HU-012
```

Verifica que esté en `Lista` (o `En progreso` si se retoma trabajo previo) y que sus dependencias estén `Hecha`. Si todo está bien:

```bash
python scripts/backlog.py start HU-012
```

Si la HU no está lista o tiene dependencias sin cerrar, avisa antes de empezar y deja que la persona decida.

**Caso C. Retomar una HU `En progreso`**

Lee el archivo completo, en especial la sección `## Registro`: ahí está lo que ya se hizo y las decisiones tomadas. Continúa desde ahí sin repetir trabajo.

## 4. Mientras trabajas

1. **Lee la HU completa** (historia, contexto, criterios, fuera de alcance, notas técnicas) antes de escribir código.
2. **Trabaja solo contra los criterios de aceptación** y respeta la sección "Fuera de alcance".
3. **Si algo es ambiguo o contradictorio, pregunta antes de construir.** Deja constancia con `python scripts/backlog.py log HU-XXX "duda: ..."`.
4. **Registra decisiones y hallazgos importantes:**
   ```bash
   python scripts/backlog.py log HU-XXX "Elegí X sobre Y porque ..."
   ```
5. **Si te bloqueas** (falta información, dependencia externa, acceso):
   ```bash
   python scripts/backlog.py block HU-XXX -m "motivo concreto y qué se necesita para desbloquear"
   ```
   y avisa a la persona.
6. **Si descubres trabajo nuevo que no cabe en la HU**, no lo cuelgues de ella. Créalo aparte:
   ```bash
   python scripts/backlog.py new "Título de la nueva HU" -p P2 -e M -d HU-XXX
   ```
   Queda en `Backlog` (sin refinar) y la mencionas al final de tu respuesta.

## 5. Al terminar

1. Marca en el archivo de la HU los criterios cumplidos (`- [x]`).
2. Ejecuta las pruebas relevantes y confirma que pasan.
3. Deja la HU en revisión con un resumen útil (qué hiciste y cómo verificarlo):
   ```bash
   python scripts/backlog.py review HU-XXX -m "Implementado X. Verificar con: ..."
   ```
4. **No la pases a `Hecha` por tu cuenta.** Solo usa `done` si la persona lo pide o aprueba explícitamente:
   ```bash
   python scripts/backlog.py done HU-XXX -m "Aprobada por la persona"
   ```
5. Cierra tu respuesta con tres cosas: qué se hizo, cómo verificarlo, y qué HUs nuevas creaste (si creaste alguna).

## 6. Crear y refinar HUs (si la persona te lo pide)

```bash
python scripts/backlog.py new "Título" -p P1 -e M -d HU-001,HU-002
```

- `-p` prioridad: `P0` (urgente) a `P3`. Por defecto `P2`.
- `-e` talla: `XS`, `S`, `M`, `L`, `XL`. Por defecto `M`.
- `-d` dependencias: IDs separados por coma; deben existir.

Después completa el archivo generado siguiendo la plantilla. Una HU bien refinada tiene: historia "Como ___ quiero ___ para ___", contexto suficiente para no adivinar, criterios de aceptación verificables (dado/cuando/entonces), y fuera de alcance explícito. Cuando esté lista y la persona esté de acuerdo:

```bash
python scripts/backlog.py ready HU-XXX
```

## 7. Referencia de comandos

| Comando | Qué hace |
|---|---|
| `list [-s estado] [--all]` | Lista HUs (oculta las `Hecha` salvo `--all`) |
| `show HU-XXX` | Muestra la HU completa |
| `next` | Muestra la siguiente elegible sin iniciarla |
| `take` | Toma la siguiente elegible y la pasa a `En progreso` |
| `new "título" [-p] [-e] [-d]` | Crea una HU en `Backlog` |
| `ready HU-XXX` | `Backlog` → `Lista` |
| `start HU-XXX` | → `En progreso` |
| `review HU-XXX -m "..."` | → `En revision` |
| `done HU-XXX -m "..."` | → `Hecha` |
| `block HU-XXX -m "..."` | → `Bloqueada` |
| `log HU-XXX "mensaje"` | Agrega una línea al registro |
| `index` | Regenera `BACKLOG.md` |

Los comandos de estado (`ready`, `start`, `review`, `done`, `block`) aceptan `-m` para dejar un mensaje en el registro. Todos se ejecutan desde la raíz del repo.

## 8. Reglas que no se negocian

- Una sola HU `En progreso` por sesión, salvo que la persona pida lo contrario.
- Nunca tomes por iniciativa propia HUs en `Backlog` ni `Bloqueada`.
- Nunca marques `Hecha` sin aprobación de la persona.
- Nunca edites `BACKLOG.md` ni el frontmatter a mano.
- Nunca metas cambios fuera del alcance de la HU: si algo lo amerita, crea una HU nueva.
- Si el script falla o el estado de una HU parece inconsistente, dilo; no lo arregles editando archivos a escondidas.

## 9. Ejemplo de sesión completa

```text
Persona: Toma la siguiente HU.

$ python scripts/backlog.py take
HU-002 → En progreso
Lee ahora backlog/HU-002.md y trabaja contra sus criterios de aceptacion.

$ python scripts/backlog.py show HU-002       # leo historia, criterios, fuera de alcance
... implemento, corro pruebas ...
$ python scripts/backlog.py log HU-002 "Uso bcrypt para el hash; el contexto no fijaba algoritmo"
... marco criterios [x] en backlog/HU-002.md ...
$ python scripts/backlog.py review HU-002 -m "Login con correo listo. Verificar: pytest tests/test_login.py"

Claude: Terminé HU-002 y quedó En revisión. Verifica con pytest tests/test_login.py.
        Creé HU-005 (Bloqueo tras 5 intentos fallidos) en Backlog porque estaba fuera de alcance.
```
