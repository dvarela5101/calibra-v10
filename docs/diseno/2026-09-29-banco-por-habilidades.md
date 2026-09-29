# Banco de preguntas por habilidades y diagnóstico adaptativo

**Fecha:** 29 de septiembre de 2026. **Estado:** aprobado en conversación con la persona. **HUs:** [HU-005](../../backlog/HU-005.md) (banco), [HU-060](../../backlog/HU-060.md) (motor), [HU-061](../../backlog/HU-061.md) (reprocesamiento con IA), [HU-009](../../backlog/HU-009.md) (tomar el diagnóstico).

## Para qué

Reprocesar todo el banco de Calibra siguiendo el modelo de knowledge components de Khan Academy, para que:

- el diagnóstico se adapte al estudiante y cada uno vea preguntas distintas;
- el resultado diga qué habilidad domina y cuál no, y qué error concreto comete;
- el banco crezca con preguntas generadas por IA sin perder calidad.

## Decisiones

| Tema | Decisión |
|---|---|
| Papel de la IA | Escribe preguntas **antes** del examen, como borradores. Nunca corre durante el examen. Una persona que sabe la materia revisa cada pregunta antes de que llegue a producción. |
| Resultado | Nivel **por habilidad**, tipo Khan: lo domina, en proceso, no lo domina, sin medir. Cambia RN-17: el hub del monitor muestra habilidades, no promedio por tema. |
| Largo | Adaptativo con tope. Una pregunta por habilidad y una segunda donde hay duda. Termina cuando todas tienen nivel o al llegar al tope. |
| Alcance del nivel | Foto de cada diagnóstico. No se acumula un perfil entre diagnósticos. Se guarda cada respuesta con su habilidad y su error, así un perfil acumulado se puede agregar después sin migrar. |
| Prerrequisitos | Se etiquetan al reprocesar y se muestran al monitor ("revisar antes: regla de la cadena"). El motor no hace preguntas de otra materia. |
| Dónde vive el banco | Markdown en `calibra-v10/contenido/`, público, igual que hoy el del prototipo. La revisión se hace en PRs. |
| Material fuente | Parciales, talleres y guías se quedan en el PC donde se procesan. **Nunca entran al repo**: son de los profesores y de la universidad, y el repo es público. |
| P-18 | Una Evaluación es un conjunto de temas de su materia (relación muchos a muchos). Una evaluación acumulativa incluye los temas de las anteriores de la misma materia. |

## Flujo

```
material fuente (PC de quien procesa)
  → sesión de Claude que sigue contenido/PROCESO.md (HU-061)
  → PR con borradores, una materia por PR
  → un monitor revisa y marca "revisada"
  → merge a main
  → el convertidor valida y carga en Supabase solo lo revisado (HU-005)
  → el motor elige preguntas y calcula niveles (HU-060)
```

## Formato del banco (HU-005)

```
contenido/
  README.md              reglas de redacción
  PROCESO.md             instructivo del reprocesamiento (HU-061)
  <materia>/
    materia.md           código, nombre, libro y Evaluaciones (temas que cubre cada una, acumulativa)
    <tema>.md            un archivo por tema: habilidades, errores y preguntas
```

Un tema por dentro:

```markdown
## Habilidades
kc: partes-formula · Aplicar uv − ∫v du con signos correctos · prerrequisitos: calculo-diferencial/regla-producto

## Errores
mc: signo-partes · partes-formula · te equivocas en el signo de la fórmula uv − ∫v du

## Preguntas
### P4 · dificultad 2 · kc: partes-formula · revisada · origen: ia (sonnet-5.5) · revisó: Laura
En ∫ x·eˣ dx, con u = x y dv = eˣ dx, el resultado es:
- A) x·eˣ − eˣ + C · CORRECTA
- B) x·eˣ + eˣ + C · [signo-partes]
- C) eˣ + C · [omite-uv]
- D) x²·eˣ/2 + C · [producto-factor-a-factor]
solución: con u = x, du = dx y v = eˣ: x·eˣ − ∫eˣ dx = x·eˣ − eˣ + C
```

- **Estados:** `borrador` (nadie la ha revisado), `revisada` (la aprobó alguien que sabe la materia; solo estas llegan a producción) y `retirada` (no se usa; se conserva por historial).
- **Origen:** `humano` o `ia (<modelo>)`. Toda pregunta `revisada` dice quién la revisó.
- **Solución:** paso a paso. Obligatoria en las preguntas de origen IA. El estudiante no la ve; sirve al revisor y al monitor.
- **Ids:** estables dentro de la materia y nunca se reutilizan. El diagnóstico guarda una copia de cada pregunta tal como la vio el estudiante, así que editar el banco no altera diagnósticos viejos y no hace falta versionar preguntas.
- **Materias sin habilidades todavía** (las 7 que no son Cálculo Integral): al migrarlas, cada tema recibe una habilidad provisional con su mismo nombre, y cada texto de error distinto se vuelve una misconcepción. Así funcionan con el motor nuevo hasta que se reprocesen.

**El convertidor rechaza** (error, no carga):

- una pregunta sin exactamente una opción `CORRECTA`;
- una opción incorrecta sin misconcepción, o con una que no existe en su materia;
- una habilidad, misconcepción o prerrequisito inexistente, o prerrequisitos con ciclo;
- ids repetidos, o una pregunta `revisada` sin revisor.

**Metas de cobertura** (reporte, no bloquea la carga):

- cada habilidad con al menos 3 preguntas revisadas, en al menos 2 dificultades;
- cada misconcepción ofrecida como trampa en al menos 2 preguntas, porque confirmarla exige que el estudiante la elija dos veces.

Una Evaluación solo queda activa si todas sus habilidades cumplen la cobertura.

## Motor (HU-060)

Propuesta de reglas. HU-060 las fija con pruebas.

**Selección**

1. Ronda 1: una pregunta por habilidad de la Evaluación, sorteada entre las revisadas de dificultad media (o la más cercana), sin repetir preguntas que la misma persona ya vio.
2. Ronda 2, donde hay duda. Hay duda si la respuesta fue incorrecta, o si fue correcta en dificultad menor que 3.
   - Si falló con la misconcepción X, la siguiente pregunta de esa habilidad ofrece X como trampa.
   - Si la vuelve a elegir, X queda confirmada. Si acierta, X queda descartada.
   - Primero se atienden las habilidades con una misconcepción en sospecha.
3. Termina cuando todas las habilidades tienen nivel o al llegar al tope de la Evaluación (20 por defecto).

**Crédito de una pregunta con varias habilidades**

- Si acierta, suma a todas sus habilidades.
- Si falla, resta a la habilidad de la misconcepción elegida, que es la que señala qué falló. Si esa habilidad no está entre las de la pregunta, resta a todas.

**Estados de una misconcepción** (se conservan del prototipo, `evidenciaKc` en `index.html`)

- sospecha: la eligió una vez;
- confirmada: la eligió dos veces;
- descartada: acertó una pregunta que la ofrecía como trampa.

**Nivel por habilidad**

- **Lo domina:** todas sus respuestas correctas, con al menos 2, o 1 en dificultad 3.
- **No lo domina:** una misconcepción confirmada de esa habilidad, o ningún acierto con al menos 2 respuestas.
- **En proceso:** aciertos y fallos, sin misconcepción confirmada.
- **Sin medir:** no alcanzó evidencia antes del tope.

**Qué guarda el diagnóstico**

- la copia de cada pregunta mostrada, con la respuesta elegida;
- el nivel por habilidad;
- las misconcepciones confirmadas y en sospecha;
- los prerrequisitos de las habilidades débiles;
- el puntaje global (aciertos sobre respondidas), que se conserva por compatibilidad.

Todo se calcula en el servidor. El navegador nunca recibe la opción correcta ni la misconcepción de una opción.

## Reprocesamiento con IA (HU-061)

La sesión de Claude corre en el PC donde está el material, dentro del clon de `calibra-v10`, siguiendo `contenido/PROCESO.md` o la skill `/reprocesar-materia <materia> <ruta-del-material>`. El orquestador reparte cada tema a subagentes Sonnet.

Por materia, en una rama y un PR:

1. **Inventario.** Lista el material y reporta lo que no pudo leer.
2. **Mapa de habilidades.** Temas, habilidades y prerrequisitos. **Pausa obligatoria:** una persona aprueba el mapa antes de seguir.
3. **Catálogo de errores.** Sale de las soluciones de parciales, las notas y los errores existentes, redactado con palabras propias y nunca copiado.
4. **Reubicar lo existente.**
   - Las preguntas del prototipo que no eran borrador entran como `revisada · origen: humano · revisó: prototipo`.
   - Los borradores siguen como `borrador`.
5. **Llenar huecos.** Preguntas nuevas hasta cumplir la cobertura. Son inspiradas en el material, no copias. Cada opción incorrecta sale del catálogo y cada pregunta lleva su solución.
6. **Verificación cruzada.** Otro subagente resuelve cada pregunta sin ver la respuesta. Si llega a otra, o ve dos opciones defendibles, la pregunta queda marcada `⚠ revisar`. Donde se puede, el cálculo se comprueba con código.
7. **Validar y abrir el PR.** `--dry-run` del convertidor y PR con el reporte de cobertura, las preguntas marcadas y por dónde empezar a revisar.

La IA nunca marca `revisada`.

**Piloto:** Cálculo Integral, que ya tiene 18 habilidades, 56 misconcepciones y 41 borradores. Se mide qué porcentaje de lo generado aprueba el revisor antes de correr las otras 7 materias, cada una con su propia HU.

## Cambios a las reglas

- **RN-14 y el diccionario de Diagnóstico:** `resultadoPorTema` pasa a ser el resultado por habilidad.
- **RN-17:** el monitor ve el nivel por habilidad de cada diagnóstico y, en las grupales, cuántos integrantes están en cada nivel por habilidad, en lugar del promedio por tema. Afecta [HU-022](../../backlog/HU-022.md) y [HU-040](../../backlog/HU-040.md).
- **P-18:** resuelta como está en la tabla de decisiones.
