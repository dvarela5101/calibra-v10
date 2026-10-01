# Variables aleatorias discretas

Sesión 4 y 6 del programa. Walpole pp. 81-87, 111-135, 143-170.
Errores que vale la pena cazar: confundir la función de probabilidad con la acumulada, usar la media donde se pide la varianza, y aplicar binomial a ensayos que no son independientes ni de probabilidad constante.

## Habilidades
kc: discretas · Variables aleatorias discretas

## Errores
mc: discretas-e1 · discretas · calculas la varianza np(1-p) en vez de la media
mc: discretas-e2 · discretas · confundes la media con el parámetro p
mc: discretas-e3 · discretas · usas n sin multiplicar por p
mc: discretas-e4 · discretas · confundes la función acumulada con la función de probabilidad
mc: discretas-e5 · discretas · sumas todas las probabilidades ignorando la condición
mc: discretas-e6 · discretas · calculas P(X > 3) en lugar de P(X ≤ 3)
mc: discretas-e7 · discretas · confundes varianza con desviación de la media
mc: discretas-e8 · discretas · olvidas restar el cuadrado de la media
mc: discretas-e9 · discretas · elevas la media al cuadrado sin calcular E(X²)

## Preguntas

### P4 · dificultad 2 · kc: discretas · revisada · origen: humano · revisó: prototipo
Una variable aleatoria X sigue distribución binomial con n = 10 y p = 0,3. ¿Cuál es E(X)?

- A) 3 · CORRECTA
- B) 2,1 · [discretas-e1]
- C) 0,3 · [discretas-e2]
- D) 10 · [discretas-e3]

### P5 · dificultad 3 · kc: discretas · revisada · origen: humano · revisó: prototipo
Si P(X = k) = 0,2 para k = 1,2,3,4,5, ¿cuál es P(X ≤ 3)?

- A) 0,6 · CORRECTA
- B) 0,2 · [discretas-e4]
- C) 1,0 · [discretas-e5]
- D) 0,4 · [discretas-e6]

### P6 · dificultad 2 · kc: discretas · revisada · origen: humano · revisó: prototipo
La varianza de una variable aleatoria discreta X se calcula como:

- A) E[(X - μ)²] o E(X²) - [E(X)]² · CORRECTA
- B) E(X) - μ · [discretas-e7]
- C) E(X²) · [discretas-e8]
- D) [E(X)]² · [discretas-e9]
