---
name: reprocesar-materia
description: Reprocesa el banco de preguntas de una materia con IA (mapa de habilidades, catálogo de errores y preguntas nuevas en borrador) a partir de su material fuente, siguiendo contenido/PROCESO.md. Solo se invoca a mano.
argument-hint: <materia> <ruta-del-material>
disable-model-invocation: true
---

# Reprocesar una materia

Argumentos recibidos: $ARGUMENTS

El proceso completo está en `contenido/PROCESO.md`. Este archivo solo dice cómo arrancar. Si algo de aquí parece distinto de `PROCESO.md`, manda `PROCESO.md`.

## Antes de empezar

1. Separa los argumentos. La primera palabra es la materia: la carpeta en `contenido/`, como `calculo-diferencial`. Todo lo que sigue, tal cual, es la ruta del material. La ruta puede tener espacios, así que no la partas por palabras; si viene entre comillas, quítalas.
2. Comprueba que la materia existe en `contenido/` y que la ruta existe y es una carpeta. Si falta algo, dilo y para; si falta la ruta, pídela.
3. Confirma el id de la HU de la corrida (sale de la rama, `hu-XXX-...`, o de lo que diga la persona). Lo necesitas para dejar la aprobación del mapa en su registro.
4. Anuncia la carpeta de trabajo: `../_tmp/reprocesar-<materia>`, relativa al clon, salvo que la persona indique otra. Debe quedar fuera del clon y fuera del material.

## Cómo seguir

Lee `contenido/PROCESO.md` completo y síguelo en orden, del paso 1 al 7. Hay una pausa obligatoria al final del paso 2: no escribas en `contenido/` hasta que la persona apruebe el mapa en el chat.

Los scripts de esta carpeta (`PROCESO.md` explica cuándo y con qué opciones):

```bash
node "${CLAUDE_SKILL_DIR}/cobertura-proyectada.mjs" <materia> [--evaluacion <clave>]
node "${CLAUDE_SKILL_DIR}/chequeo-copia.mjs" <materia> --texto <carpeta-de-trabajo>/texto
```

El material no entra al repo y no se nombra en el diff, en el PR ni en el registro de la HU.
