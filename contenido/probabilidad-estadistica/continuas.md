# Variables aleatorias continuas

Sesión 5 y 7 del programa. Walpole pp. 87-94, 171-211.
Errores que vale la pena cazar: leer la densidad como si fuera una probabilidad, olvidar estandarizar antes de usar la tabla normal, y calcular P(X = a) distinto de cero en una continua.

## Habilidades
kc: continuas · Variables aleatorias continuas

## Errores
mc: continuas-e1 · continuas · confundes densidad con probabilidad
mc: continuas-e2 · continuas · tratas la continua como discreta uniforme
mc: continuas-e3 · continuas · no reconoces que en continuas un punto tiene probabilidad cero
mc: continuas-e4 · continuas · olvidas estandarizar
mc: continuas-e5 · continuas · confundes la desviación estándar con la varianza
mc: continuas-e6 · continuas · confundes diferencia con probabilidad
mc: continuas-e7 · continuas · confundes densidad con probabilidad acumulada
mc: continuas-e8 · continuas · tratas continua como discreta
mc: continuas-e9 · continuas · agregas una condición innecesaria

## Preguntas

### P7 · dificultad 2 · kc: continuas · revisada · origen: humano · revisó: prototipo
Para una variable continua X, ¿qué es cierto sobre P(X = a) donde a es una constante?

- A) P(X = a) = 0 siempre · CORRECTA
- B) P(X = a) = f(a) donde f es la densidad · [continuas-e1]
- C) P(X = a) = 1/n donde n es el rango · [continuas-e2]
- D) Depende del valor de a · [continuas-e3]

### P8 · dificultad 3 · kc: continuas · revisada · origen: humano · revisó: prototipo
Si X ~ N(100, 25), para calcular P(X < 110) usando la tabla estándar Z ~ N(0,1):

- A) Calculas $Z = \frac{110-100}{5} = 2$ y buscas P(Z < 2) · CORRECTA
- B) Buscas directamente P(X < 110) en la tabla · [continuas-e4]
- C) Calculas $Z = \frac{110-100}{25} = 0,4$ · [continuas-e5]
- D) Restas 110 - 100 = 10 y ese es el resultado · [continuas-e6]

### P9 · dificultad 2 · kc: continuas · revisada · origen: humano · revisó: prototipo
Una función f(x) puede ser densidad de probabilidad solo si:

- A) f(x) ≥ 0 para todo x y $\int f(x)\,dx = 1$ en su dominio · CORRECTA
- B) f(x) ≤ 1 para todo x · [continuas-e7]
- C) f(x) = 1/n donde n es el número de valores · [continuas-e8]
- D) Solo si f(x) es simétrica · [continuas-e9]
