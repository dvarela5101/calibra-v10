# Falta de material

Este documento lista las materias y las habilidades del banco a las que les falta material, para saber qué hay que conseguir. Lo crea y lo mantiene [HU-061](../backlog/HU-061.md) (D-49 c). [PROCESO.md](PROCESO.md#falta-de-material) dice cuándo se actualiza. No lleva nombres de archivos del material.

Última actualización: corrida de Cálculo Diferencial (HU-061), 5-oct-2026.

## 1. Habilidades sin preguntas sin ver o con una sola respuesta

Hay dos motivos (D-49 c):

- `sin preguntas sin ver`: el diagnóstico nunca repite una pregunta, así que a una habilidad con pocas preguntas se le acaban.
- `tope de 20 con una sola respuesta`: el tope de 20 preguntas deja a la habilidad con una sola respuesta.

### De la cobertura proyectada de la skill

La meta por habilidad es de 4 preguntas, con 2 o más de dificultad 2, 2 o más de dificultad 1 o 3 y al menos una de dificultad 3. Las habilidades que no la alcanzan son las que se quedarían sin preguntas sin ver.

Alcance de la corrida (Parcial 1 de Cálculo Diferencial): las 10 habilidades llegan a la meta, así que no hay filas.

Fuera del alcance, las 20 habilidades de los parciales 2 y 3 de Cálculo Diferencial no llegan, porque D-50 b dejó sus preguntas nuevas para otra corrida. Para ellas ya hay material: parciales anteriores, talleres, una solución de parcial y libros. Hace falta escribir sus preguntas, y estas filas se quitan cuando una corrida nueva las genere.

| Materia | Habilidad | Evaluación | Motivo | Origen de la anotación | Qué le falta |
|---|---|---|---|---|---|
| Cálculo Diferencial | `derivada-definicion` | parcial-2 | `sin preguntas sin ver` | cobertura proyectada de la skill | tiene 0 de 4 preguntas, faltan 4 |
| Cálculo Diferencial | `derivada-significado` | parcial-2 | `sin preguntas sin ver` | cobertura proyectada de la skill | tiene 1 de 4 preguntas, faltan 3 |
| Cálculo Diferencial | `diferenciabilidad` | parcial-2 | `sin preguntas sin ver` | cobertura proyectada de la skill | tiene 0 de 4 preguntas, faltan 4 |
| Cálculo Diferencial | `reglas-derivacion` | parcial-2 | `sin preguntas sin ver` | cobertura proyectada de la skill | tiene 0 de 4 preguntas, faltan 4 |
| Cálculo Diferencial | `derivadas-trascendentes` | parcial-2 | `sin preguntas sin ver` | cobertura proyectada de la skill | tiene 1 de 4 preguntas, faltan 3 |
| Cálculo Diferencial | `regla-cadena` | parcial-2 | `sin preguntas sin ver` | cobertura proyectada de la skill | tiene 2 de 4 preguntas, faltan 2 |
| Cálculo Diferencial | `derivacion-implicita` | parcial-2 | `sin preguntas sin ver` | cobertura proyectada de la skill | tiene 0 de 4 preguntas, faltan 4 |
| Cálculo Diferencial | `derivacion-logaritmica` | parcial-2 | `sin preguntas sin ver` | cobertura proyectada de la skill | tiene 0 de 4 preguntas, faltan 4 |
| Cálculo Diferencial | `recta-tangente` | parcial-2 | `sin preguntas sin ver` | cobertura proyectada de la skill | tiene 0 de 4 preguntas, faltan 4 |
| Cálculo Diferencial | `razones-relacionadas` | parcial-2 | `sin preguntas sin ver` | cobertura proyectada de la skill | tiene 1 de 4 preguntas, faltan 3 |
| Cálculo Diferencial | `extremos-absolutos` | parcial-3 | `sin preguntas sin ver` | cobertura proyectada de la skill | tiene 0 de 4 preguntas, faltan 4 |
| Cálculo Diferencial | `teorema-valor-medio` | parcial-3 | `sin preguntas sin ver` | cobertura proyectada de la skill | tiene 0 de 4 preguntas, faltan 4 |
| Cálculo Diferencial | `extremos-locales` | parcial-3 | `sin preguntas sin ver` | cobertura proyectada de la skill | tiene 2 de 4 preguntas, faltan 2 |
| Cálculo Diferencial | `concavidad-inflexion` | parcial-3 | `sin preguntas sin ver` | cobertura proyectada de la skill | tiene 0 de 4 preguntas, faltan 4 |
| Cálculo Diferencial | `lhopital` | parcial-3 | `sin preguntas sin ver` | cobertura proyectada de la skill | tiene 0 de 4 preguntas, faltan 4 |
| Cálculo Diferencial | `trazado-curvas` | parcial-3 | `sin preguntas sin ver` | cobertura proyectada de la skill | tiene 0 de 4 preguntas, faltan 4 |
| Cálculo Diferencial | `optimizacion` | parcial-3 | `sin preguntas sin ver` | cobertura proyectada de la skill | tiene 1 de 4 preguntas, faltan 3 |
| Cálculo Diferencial | `antiderivadas` | parcial-3 | `sin preguntas sin ver` | cobertura proyectada de la skill | tiene 0 de 4 preguntas, faltan 4 |
| Cálculo Diferencial | `integral-definida` | parcial-3 | `sin preguntas sin ver` | cobertura proyectada de la skill | tiene 0 de 4 preguntas, faltan 4 |
| Cálculo Diferencial | `teorema-fundamental` | parcial-3 | `sin preguntas sin ver` | cobertura proyectada de la skill | tiene 0 de 4 preguntas, faltan 4 |

### De las marcas de HU-060

Todavía no hay marcas. Al 5-oct-2026 el motor del diagnóstico (HU-060) está en progreso y el guardado de la marca (HU-081) tiene estado Lista, y esta corrida no usa la base de datos. Cuando haya diagnósticos guardados, aquí van las habilidades marcadas `sin_preguntas_sin_ver` o `tope_una_respuesta`, con su materia.

## 2. Materias del banco sin cobertura de D-13

D-13 pide 3 preguntas revisadas en 2 dificultades por habilidad. Esta sección sale del reporte de `npm run contenido:validar` (cobertura por habilidad), que cuenta solo preguntas revisadas. Física II e Introducción a la Programación cumplen en todas sus habilidades y no aparecen.

### Álgebra Lineal (`algebra-lineal`)

HU-061 no registra material fuente para esta materia (inventario del 4-oct-2026). Cumplen 0 de 4 habilidades.

| Habilidad | Revisadas hoy | Qué falta para la cobertura de D-13 |
|---|---|---|
| `vectores` | 3, dificultad 2 | 1 pregunta revisada más, con al menos una de otra dificultad |
| `sistemas` | 3, dificultad 2 | 1 pregunta revisada más, con al menos una de otra dificultad |
| `determinantes` | 3, dificultad 2 | 1 pregunta revisada más, con al menos una de otra dificultad |
| `espacios` | 3, dificultad 2 | 1 pregunta revisada más, con al menos una de otra dificultad |

### Cálculo Integral (`calculo-integral`)

Hay resúmenes semanales y 4 talleres (2024-1). No hay parciales, soluciones ni programa. Además tiene 39 borradores de IA sin solución, que se completan en una HU aparte. Cumplen 0 de 18 habilidades.

| Habilidad | Revisadas hoy | Qué falta para la cobertura de D-13 |
|---|---|---|
| `partes-eleccion-u` | 1, dificultad 2 | 2 preguntas revisadas más, con al menos una de otra dificultad |
| `partes-formula` | 1, dificultad 2 | 2 preguntas revisadas más, con al menos una de otra dificultad |
| `partes-reiterada` | 0 | 3 preguntas revisadas, en al menos 2 dificultades |
| `sust-reconocer` | 1, dificultad 2 | 2 preguntas revisadas más, con al menos una de otra dificultad |
| `sust-dx` | 0 | 3 preguntas revisadas, en al menos 2 dificultades |
| `sust-limites` | 0 | 3 preguntas revisadas, en al menos 2 dificultades |
| `impropia-p` | 1, dificultad 3 | 2 preguntas revisadas más, con al menos una de otra dificultad |
| `impropia-limite` | 1, dificultad 3 | 2 preguntas revisadas más, con al menos una de otra dificultad |
| `impropia-discontinuidad` | 0 | 3 preguntas revisadas, en al menos 2 dificultades |
| `edo-separables` | 1, dificultad 2 | 2 preguntas revisadas más, con al menos una de otra dificultad |
| `edo-lineal` | 1, dificultad 3 | 2 preguntas revisadas más, con al menos una de otra dificultad |
| `edo-exponencial` | 1, dificultad 2 | 2 preguntas revisadas más, con al menos una de otra dificultad |
| `serie-criterio` | 1, dificultad 2 | 2 preguntas revisadas más, con al menos una de otra dificultad |
| `serie-potencias` | 1, dificultad 3 | 2 preguntas revisadas más, con al menos una de otra dificultad |
| `serie-taylor` | 1, dificultad 2 | 2 preguntas revisadas más, con al menos una de otra dificultad |
| `app-volumen` | 1, dificultad 2 | 2 preguntas revisadas más, con al menos una de otra dificultad |
| `app-arco` | 1, dificultad 3 | 2 preguntas revisadas más, con al menos una de otra dificultad |
| `app-area` | 0 | 3 preguntas revisadas, en al menos 2 dificultades |

### Cálculo Vectorial (`calculo-vectorial`)

HU-061 no registra material fuente para esta materia (inventario del 4-oct-2026). Cumplen 0 de 4 habilidades.

| Habilidad | Revisadas hoy | Qué falta para la cobertura de D-13 |
|---|---|---|
| `parciales` | 3, dificultad 2 | 1 pregunta revisada más, con al menos una de otra dificultad |
| `multiples` | 3, dificultad 2 | 1 pregunta revisada más, con al menos una de otra dificultad |
| `linea` | 3, dificultad 2 | 1 pregunta revisada más, con al menos una de otra dificultad |
| `teoremas` | 3, dificultad 2 | 1 pregunta revisada más, con al menos una de otra dificultad |

### Física I (`fisica-1`)

HU-061 no registra material fuente para esta materia (inventario del 4-oct-2026). Cumplen 0 de 4 habilidades.

| Habilidad | Revisadas hoy | Qué falta para la cobertura de D-13 |
|---|---|---|
| `cinematica` | 3, dificultad 2 | 1 pregunta revisada más, con al menos una de otra dificultad |
| `newton` | 3, dificultad 2 | 1 pregunta revisada más, con al menos una de otra dificultad |
| `energia` | 3, dificultad 2 | 1 pregunta revisada más, con al menos una de otra dificultad |
| `rotacional` | 3, dificultad 2 | 1 pregunta revisada más, con al menos una de otra dificultad |

### Probabilidad y Estadística (`probabilidad-estadistica`)

Hay sesiones y complementarias con solución (2025-I). No hay programa ni parciales. Cumplen 3 de 5 habilidades.

| Habilidad | Revisadas hoy | Qué falta para la cobertura de D-13 |
|---|---|---|
| `conteo` | 1, dificultad 2 | 2 preguntas revisadas más, con al menos una de otra dificultad |
| `condicional` | 2, dificultades 2 y 3 | 1 pregunta revisada más |

### Cálculo Diferencial (`calculo-diferencial`)

Hay programa, parciales, talleres con solución, soluciones, apuntes y libros. Cumplen 0 de 30 habilidades. Las 20 de los parciales 2 y 3 están en la sección 1. Las 10 del Parcial 1 ya tienen la meta de preguntas con los borradores de IA. Para estas no hay que conseguir material: falta que los desarrolladores revisen los borradores.

| Habilidad | Revisadas hoy | Preguntas proyectadas | Qué falta |
|---|---|---|---|
| `dominio-composicion` | 0 | 4 (4 por revisar) | revisar los borradores (HU nueva A) |
| `transformaciones-graficas` | 0 | 4 (4 por revisar) | revisar los borradores (HU nueva A) |
| `funcion-inversa` | 0 | 4 (4 por revisar) | revisar los borradores (HU nueva A) |
| `ecuaciones-exp-log` | 0 | 4 (4 por revisar) | revisar los borradores (HU nueva A) |
| `limite-algebraico` | 1, dificultad 2 | 4 (3 por revisar) | revisar los borradores (HU nueva A) |
| `limites-laterales` | 0 | 4 (4 por revisar) | revisar los borradores (HU nueva A) |
| `limite-trigonometrico` | 0 | 4 (4 por revisar) | revisar los borradores (HU nueva A) |
| `limites-infinito-asintotas` | 0 | 4 (4 por revisar) | revisar los borradores (HU nueva A) |
| `continuidad` | 1, dificultad 2 | 4 (3 por revisar) | revisar los borradores (HU nueva A) |
| `teorema-valor-intermedio` | 0 | 4 (4 por revisar) | revisar los borradores (HU nueva A) |
