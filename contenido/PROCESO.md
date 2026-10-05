# Reprocesar una materia con IA

Este documento es el instructivo de [HU-061](../backlog/HU-061.md). Lo sigue una sesión de Claude Code para reprocesar el banco de una materia a partir de su material fuente: un mapa de habilidades, un catálogo de errores y preguntas nuevas en borrador. El diseño y el porqué de cada regla están en [docs/diseno/2026-09-29-banco-por-habilidades.md](../docs/diseno/2026-09-29-banco-por-habilidades.md), sección "Reprocesamiento con IA". El formato del banco está en [README.md](README.md).

La skill `/reprocesar-materia <materia> <ruta-del-material>` arranca la corrida y remite a este documento. Se invoca solo a mano. La primera palabra es la materia (la carpeta en `contenido/`, por ejemplo `calculo-diferencial`) y el resto es la ruta del material, que puede tener espacios.

Cada materia va en su propia HU, en una rama (`hu-XXX-contenido-<materia>`; la del piloto es `hu-061-reprocesar`), con un PR y un commit con squash. El alcance de cada corrida (qué materia, qué Evaluaciones tienen preguntas nuevas, quién aprueba el mapa) lo fija la HU de la materia. En el piloto, Cálculo Diferencial, el mapa cubre toda la materia, las preguntas nuevas son solo del Parcial 1 y el mapa lo aprueba Juzou04 en la sesión (D-50 a, b y c).

## Reglas que valen en todos los pasos

- La IA nunca marca una pregunta `revisada` ni escribe `revisó:`. Revisar lo hacen los desarrolladores por fuera de la app, después de fusionar los borradores (D-50 d y e). No hay flujo de revisión ni se nombra a un monitor en el repo.
- El material fuente no entra al repo. Eso incluye los archivos, el texto extraído, el inventario con nombres, los borradores del mapa y cualquier reporte intermedio. Ni el diff, ni la descripción del PR, ni el registro de la HU nombran archivos del material o lo citan. Se informan cifras y conteos por tipo.
- La carpeta de trabajo está fuera del clon y fuera del material. Por defecto es `../_tmp/reprocesar-<materia>`, relativa al clon, y la sesión la anuncia al empezar. Ahí quedan `inventario.md`, `texto/` (el texto extraído), `mapa.md`, `catalogo.md`, `borradores/` y los reportes.
- Orquesta la sesión principal. Un subagente `sonnet` escribe cada tema y un subagente `opus` verifica, para que el verificador no comparta los errores del autor. En `origen:` va el modelo con su versión, por ejemplo `ia (sonnet-5.5)`, no el alias.
- Cada subagente recibe instrucciones autocontenidas: no ve esta conversación. Los ejemplos que se le dan salen de `contenido/`, nunca del material.
- La corrida no usa la base de datos. Corre `npm run contenido:validar`, que no abre ninguna conexión, y no `npm run contenido:cargar`.
- No se hace push antes del paso 7.

## Paso 1. Inventario

Se recorre la ruta del material y se escribe `inventario.md` en la carpeta de trabajo, con una fila por archivo:

- el tipo: programa, parcial, taller, solución, resumen, apunte, libro u otro;
- si trae solución;
- si no se pudo leer, y por qué.

Los libros se cuentan y se pueden usar como fuente (D-50 g). No se cuentan `__MACOSX`, `._*`, `.DS_Store`, `*.download`, `*.pyc`, los recursos de páginas web guardadas ni las carpetas de salidas de IA. Si la carpeta trae material de otras materias, se usa solo el que corresponde a esta y el inventario lo dice.

Cómo se lee:

- Los PDF con texto, con `pdftotext`.
- Los PDF escaneados y los ejercicios con notación matemática, como imagen con la herramienta Read, por páginas (máximo 20 por llamada). `pdftotext` pierde los signos de integral y los exponentes.
- Los `.pptx` y `.docx`, con `zipfile` de Python. No se instala nada con pip.
- Un archivo de OneDrive que está solo en la nube no se abre, porque abrirlo lo descargaría. Se anota como no leído.

Todo lo leído queda como texto en `texto/`, también lo que se leyó como imagen (se transcribe). El chequeo de copia del paso 6 solo ve lo que hay en esa carpeta.

Sale de este paso: `inventario.md`, `texto/` y los conteos por tipo. Al PR y al registro de la HU pasan solo los conteos, sin nombres de archivo.

## Paso 2. Mapa de habilidades

La sesión lee el texto y arma, en `mapa.md` (no en `contenido/`):

- los temas, en orden;
- las habilidades de cada tema, cada una concreta y verificable con una pregunta;
- los prerrequisitos entre habilidades;
- las Evaluaciones, con la semana que dice el programa.

Reglas del mapa:

- Un prerrequisito apunta solo a una habilidad que existe en el banco, o el convertidor da error. Los de una materia que no está en el banco (Precálculo, por ejemplo) se nombran en el texto libre del tema. No puede haber ciclos.
- Las Evaluaciones salen del programa. El examen final no se agrega como Evaluación en el piloto.
- Si una Evaluación pasa de 10 habilidades, la sesión lo dice al pedir la aprobación: con el tope de 20 preguntas del motor no alcanzan 2 por habilidad (lo trata [HU-060](../backlog/HU-060.md)).

Después de escribir el mapa hay una pausa obligatoria. La sesión avisa dónde quedó, se detiene y no sigue hasta que quien nombra la HU de la materia lo apruebe en el chat (Juzou04 en el piloto; dvarela5101 puede objetarlo después, al revisar la HU). La aprobación queda en el registro de la HU de la corrida:

```bash
python scripts/backlog.py log HU-XXX "Mapa aprobado por <usuario>"
```

Mientras no haya aprobación no se escribe nada en `contenido/`.

## Paso 3. Catálogo de errores

Con el mapa aprobado, la sesión escribe en `catalogo.md` las misconcepciones de cada habilidad. Las fuentes son las soluciones de parciales y talleres, las notas de monitores si las hay y los errores del banco actual. Si una materia solo tiene los errores del banco y el criterio del modelo, el PR lo dice, porque entonces la revisión humana del catálogo pesa más.

- Cada misconcepción es de una habilidad del mapa y se redacta como pide el README (sección "Cómo se redactan los errores"): en segunda persona, lo que pensó el estudiante, en minúscula y sin punto final.
- Se redacta con palabras propias. No se copia del material.
- Una misconcepción debería poder salir como trampa en 2 preguntas, porque el motor la necesita dos veces para confirmarla.
- La clave dice el error (`lhopital-sin-indeterminacion`), no un número.

Se cuenta para el PR cuántas son nuevas, cuántas vienen de las provisionales y cuántas provisionales se quitaron.

## Paso 4. Reubicar lo existente

Con el mapa aprobado y el catálogo escrito, se pasa todo a `contenido/<materia>/` de una vez, para que el convertidor nunca vea habilidades a medio mover:

- `materia.md` con los temas y las Evaluaciones del programa. Su texto libre describe por tipo el material usado (por ejemplo, "programa, parciales, talleres con solución y libros"), sin nombres de archivos ni de profesores, y se corrige lo que ya no es cierto.
- Un archivo por tema, con sus habilidades, sus errores y las preguntas que ya existían.

Las preguntas que ya existían se reubican así:

- Conservan id, dificultad, enunciado, opciones, estado y revisor.
- Si cambia su `kc` o alguna `[mc]`, quedan con `⚠ revisar`.
- Si la dificultad no parece correcta, no se cambia. Se anota como motivo de la `⚠`. Una revisada con `⚠ revisar` cuenta para la cobertura y se carga, y por eso tocar la dificultad cambiaría qué Evaluaciones se activan.
- Si hay que cambiar el enunciado o las opciones, la pregunta se marca `retirada` y se escribe una nueva con otro id.
- Los borradores que ya existían siguen como borradores.

El formato de la marca no tiene un campo para el motivo. Cada motivo va en el reporte `revisar.md` de la carpeta de trabajo y de ahí al PR.

Los temas, las habilidades y las misconcepciones provisionales que el mapa reemplaza se quitan. Mientras esas filas sigan en la base local, `npm run contenido:cargar` falla (ver la sección "Comandos" del README). Producción no está cargada. El PR avisa que hay que borrarlas a mano.

## Paso 5. Llenar huecos

Un subagente `sonnet` por tema escribe las preguntas que faltan en `borradores/<tema>.md`. La sesión principal las pasa a `contenido/` con los ids definitivos. Cada subagente recibe el tema, sus habilidades con su descripción, el catálogo del tema, el formato del README, ejemplos de `contenido/`, los ids que le tocan, cuántas preguntas se esperan por habilidad y dificultad, y las reglas de fuente de más abajo.

### Meta de preguntas

Cada habilidad del alcance debe llegar a esto, contando las preguntas que ya existen:

- al menos 4 preguntas;
- 2 o más de dificultad 2, porque la ronda 1 del motor usa la media;
- 2 o más de dificultad 1 o 3;
- al menos una de dificultad 3, que es la que usa "lo domina".

Con esta meta, rechazar cualquier pregunta deja la cobertura de D-13 (3 preguntas revisadas en 2 dificultades). Con 4 preguntas pero solo una fuera de la dificultad 2, rechazar esa deja tres de la misma dificultad y la habilidad pierde la cobertura. Cada misconcepción debería salir como trampa en 2 preguntas.

### Cómo es cada pregunta nueva

- queda `borrador · origen: ia (<modelo con versión>)`;
- tiene `solución:` paso a paso;
- tiene cuatro opciones, y cada incorrecta apunta a una misconcepción del catálogo de la materia (con texto de error propio si es más específico, D-14);
- usa un id nuevo, que sigue al mayor de la materia, contando las retiradas;
- no lleva `revisada` ni `revisó:`.

### Fuentes (D-50 g)

La IA puede usar parciales, talleres, soluciones, resúmenes y libros. Se toma la estructura de un ejercicio, qué pide y cómo se resuelve, con otra función y otros números. Con la misma función y los mismos números es copia. Los enunciados, las opciones, las soluciones y el texto de los libros no se copian ni se parafrasean de cerca.

Al terminar, se calcula la cobertura proyectada (ver "Scripts de la skill"). Si alguna habilidad del alcance no llega a la meta, se escriben las preguntas que faltan antes de seguir.

## Paso 6. Verificación

### Verificación cruzada

Cada pregunta nueva la resuelve un subagente `opus` que no la escribió. Recibe solo el enunciado y las cuatro opciones, sin la marca `CORRECTA`, sin las `[mc]` y sin la solución. La sesión arma ese texto aparte; el verificador no lee `contenido/`. Responde qué opción es la correcta y si ve dos defendibles.

La pregunta queda `⚠ revisar` si ocurre cualquiera de estas:

- no llega a la opción `CORRECTA`;
- ve dos opciones defendibles;
- falla la comprobación con código.

El autor tiene un intento para corregirla y se verifica otra vez. La marca se queda, y el PR dice, para cada pregunta marcada, si la corrección pasó la segunda verificación.

### Comprobación con código

Cuando el cálculo se puede comprobar con código, se comprueba, con Python y su librería estándar. Las derivadas se comprueban por diferencia central y los límites evaluando cerca del punto. Si las opciones son expresiones, cada una se evalúa en al menos 5 puntos con tolerancia relativa de 1e-4: la correcta coincide y ninguna otra. Si la comprobación falla, la verificación falló. El código vive en la carpeta de trabajo. El PR lista las preguntas que no se pudieron comprobar así.

### Chequeo de copia

Se corre `chequeo-copia.mjs` sobre toda la carpeta de la materia. Ningún texto nuevo (enunciados, opciones, soluciones, misconcepciones y textos libres) puede compartir 8 o más palabras seguidas, ya normalizadas, con el texto extraído, y eso incluye el texto de los libros. Además, un subagente `opus` recibe los enunciados nuevos y el texto extraído, y comprueba que ninguna pregunta tenga la misma función y los mismos números que un ejercicio del material (D-50 g). El script marca preguntas como punto de partida, pero la decisión es del verificador. Lo que salga de cualquiera de los dos se reescribe y se vuelve a verificar; no se deja en el PR. El PR da el resultado en cifras, sin citar el material.

El texto que ya tenían las preguntas reubicadas no es texto nuevo: la regla del paso 4 manda conservar su enunciado y sus opciones. Si el chequeo marca una secuencia ahí, no se reescribe. El PR la cuenta aparte, con el id de la pregunta, y queda anotada en `revisar.md` para que quien revise decida si la retira y escribe otra.

## Paso 7. Validar y abrir el PR

1. `npm run contenido:validar` no da errores. Sin `--borradores`, ningún borrador está entre las filas que se cargarían y la Evaluación del piloto sigue inactiva hasta la revisión (D-50 e).
2. `npm run verificar`, como pide CLAUDE.md antes de dejar una HU en revisión.
3. Se trae lo último de `main`, se vuelve a validar y se abre el PR. Con el CI en verde se fusiona con squash, un commit por HU.

El PR trae:

- la cobertura actual (la del convertidor, `npm run contenido:validar`) y la proyectada (la de la skill, contando borradores);
- cuántas preguntas son nuevas, cuántas se reubicaron y cuántas se retiraron;
- las cifras del catálogo (nuevas, de las provisionales, provisionales quitadas) y cuántas misconcepciones salen como trampa en 2 preguntas o más;
- las preguntas con `⚠ revisar`, con el motivo de cada una y si la corrección pasó la segunda verificación;
- las preguntas que no se pudieron comprobar con código;
- el resultado del chequeo de copia en cifras;
- los conteos del inventario por tipo;
- el aviso de que `contenido:cargar` falla en la base local hasta borrar a mano lo provisional;
- una guía de revisión: primero las `⚠`, después por habilidad, en el orden del mapa.

### Qué entra al PR y qué no

Entran `contenido/<materia>/`, `contenido/FALTA-MATERIAL.md`, `backlog/HU-XXX.md` y `BACKLOG.md`, y `contenido/PROCESO.md` y `.claude/skills/reprocesar-materia/` solo si la corrida cambió el proceso. No entran el material, el texto extraído, el inventario con nombres, el mapa en borrador, los reportes y nada más de la carpeta de trabajo.

## Falta de material

`contenido/FALTA-MATERIAL.md` lista las materias y las habilidades a las que les falta material, para saber qué conseguir. Lo crea y lo mantiene esta HU (D-49 c). El nombre va en mayúsculas junto a este archivo, y el convertidor ignora los archivos sueltos de la raíz de `contenido/`.

Cada corrida de la skill lo actualiza: quita lo que ya tiene material y agrega lo que falta. Tiene una fila por materia y habilidad, con estas columnas:

- el motivo: `sin preguntas sin ver` (el diagnóstico nunca repite una pregunta, así que a la habilidad no le quedan más) o `tope de 20 con una sola respuesta` (el tope deja a la habilidad con una sola respuesta);
- de dónde sale la anotación: la cobertura proyectada de la skill, o una marca `faltaMaterial` de HU-060 (`sin_preguntas_sin_ver` o `tope_una_respuesta`) sacada de la base;
- qué le falta, en cifras.

De la cobertura proyectada entran las habilidades del alcance que no llegan a la meta de preguntas, porque son las que se quedarían sin preguntas sin ver. Aparte, el documento trae las materias del banco que no tienen cobertura de D-13 (el reporte de `contenido:validar` las muestra). No lleva nombres de archivos del material.

## Scripts de la skill

Viven en `.claude/skills/reprocesar-materia/` y se corren desde la raíz del clon.

```bash
# Cobertura actual y proyectada. Sale con 2 si alguna habilidad del alcance no llega a la meta.
node .claude/skills/reprocesar-materia/cobertura-proyectada.mjs <materia> [--evaluacion parcial-1 | --temas a,b] [--json]

# Chequeo de copia contra el texto extraído. Sale con 2 si hay coincidencias.
node .claude/skills/reprocesar-materia/chequeo-copia.mjs <materia> --texto <carpeta-de-trabajo>/texto [--desde-id N] [--detalle]

# Pruebas de los dos scripts
node --test .claude/skills/reprocesar-materia/reprocesar.test.mjs
```

- `cobertura-proyectada.mjs` cuenta revisadas y borradores, nunca retiradas. El convertidor cuenta solo revisadas, también con `--borradores`.
- `chequeo-copia.mjs` no imprime texto del material. `--detalle` agrega de qué archivo del texto extraído sale cada coincidencia: sirve en la carpeta de trabajo y no va al PR.
- La pista de "misma función y mismos números" del chequeo busca fragmentos matemáticos idénticos. Es una heurística: no encuentra un ejercicio escrito de otra manera, y no reemplaza al verificador.
