# Funciones cuadráticas

Forma normal de una función cuadrática: completar el cuadrado, leer el vértice, decidir si hay valor máximo o mínimo y hallar los interceptos. Es del Parcial 3 (semana 12).

## Habilidades
kc: forma-normal · Llevar una función cuadrática a su forma normal completando el cuadrado y hallar el vértice, el valor máximo o mínimo y los interceptos · prerrequisitos: ecuaciones-cuadraticas, graficas-transformaciones

## Errores
mc: vertice-signo-invertido · forma-normal · lees el vértice de a(x − h)² + k como (−h, k) y tomas la abscisa con el signo al revés
mc: suma-mitad-sin-elevar · forma-normal · para completar el cuadrado sumas y restas b/2 en vez de (b/2)²
mc: suma-cuadrado-sin-restarlo · forma-normal · completas el cuadrado sumando (b/2)² pero no lo restas, y cambias la función
mc: no-multiplica-compensacion-por-a · forma-normal · con a ≠ 1 sumas (b/2)² dentro del paréntesis y lo restas sin multiplicarlo por a
mc: extremo-con-signo-de-a-invertido · forma-normal · crees que a > 0 da un valor máximo y a < 0 un valor mínimo
mc: extremo-es-la-abscisa · forma-normal · das la abscisa del vértice como si fuera el valor máximo o mínimo
mc: intercepto-y-como-vertice · forma-normal · confundes el intercepto con el eje y con la ordenada del vértice

## Preguntas

### P96 · dificultad 1 · kc: forma-normal · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
¿Cuál es el vértice de la parábola $f(x) = x^2 - 6x + 5$?

- A) (−3, −4) · [vertice-signo-invertido] escribes f(x) = (x − 3)² − 4 y lees la abscisa del vértice como −3, con el signo al revés
- B) (3, −4) · CORRECTA
- C) (3, 2) · [suma-mitad-sin-elevar] sumas y restas 3 en vez de 9 para completar el cuadrado, y queda (x − 3)² + 2
- D) (3, 5) · [suma-cuadrado-sin-restarlo] sumas 9 para formar (x − 3)² pero no lo restas, y el término independiente 5 queda como ordenada

solución: x² − 6x + 5 = (x² − 6x + 9) − 9 + 5 = (x − 3)² − 4. En la forma a(x − h)² + k el vértice es (h, k) = (3, −4).

### P97 · dificultad 2 · kc: forma-normal · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Sea $f(x) = x^2 + 4x - 1$. ¿Cuál afirmación sobre su valor extremo es correcta?

- A) Tiene un valor máximo igual a −5 · [extremo-con-signo-de-a-invertido] crees que con a = 1 > 0 la parábola tiene un máximo
- B) Tiene un valor mínimo igual a −2 · [extremo-es-la-abscisa] das la abscisa del vértice, x = −2, como si fuera el valor mínimo
- C) Tiene un valor mínimo igual a −1 · [intercepto-y-como-vertice] tomas el intercepto con el eje y, f(0) = −1, como el valor mínimo
- D) Tiene un valor mínimo igual a −5 · CORRECTA

solución: x² + 4x − 1 = (x² + 4x + 4) − 4 − 1 = (x + 2)² − 5. Como a = 1 > 0, la parábola abre hacia arriba y el mínimo ocurre en x = −2 con valor −5. El valor −2 es la abscisa del vértice y −1 es f(0).

### P98 · dificultad 2 · kc: forma-normal · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
La forma normal de $f(x) = 2x^2 - 12x + 7$ es:

- A) 2(x − 3)² − 11 · CORRECTA
- B) 2(x − 3)² − 2 · [no-multiplica-compensacion-por-a] sumas 9 dentro del paréntesis y restas solo 9, sin multiplicarlo por el 2 de afuera
- C) 2(x − 3)² + 1 · [suma-mitad-sin-elevar] completas con 3 en vez de 9 y tratas x² − 6x + 3 como si fuera (x − 3)²
- D) 2(x − 3)² + 7 · [suma-cuadrado-sin-restarlo] sumas 9 dentro del paréntesis y no compensas, dejando el 7 como constante

solución: se saca el 2 de los términos con x: 2(x² − 6x) + 7. Se completa el cuadrado: x² − 6x + 9 = (x − 3)², y al sumar 9 dentro del paréntesis se está sumando 2·9 = 18, así que se resta 18: 2(x − 3)² − 18 + 7 = 2(x − 3)² − 11.

### P99 · dificultad 2 · kc: forma-normal · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Sea $f(x) = -2x^2 + 12x - 13$. ¿Cuál afirmación sobre su valor extremo es correcta?

- A) Tiene un valor mínimo igual a 5 · [extremo-con-signo-de-a-invertido] crees que con a = −2 < 0 la parábola tiene un mínimo
- B) Tiene un valor máximo igual a 3 · [extremo-es-la-abscisa] das la abscisa del vértice, x = 3, como si fuera el valor máximo
- C) Tiene un valor máximo igual a 5 · CORRECTA
- D) Tiene un valor máximo igual a −13 · [intercepto-y-como-vertice] tomas el intercepto con el eje y, f(0) = −13, como el valor máximo

solución: −2x² + 12x − 13 = −2(x² − 6x) − 13 = −2(x − 3)² + 18 − 13 = −2(x − 3)² + 5. Como a = −2 < 0, abre hacia abajo y el máximo ocurre en x = 3 con valor 5. Comprobación: f(3) = −18 + 36 − 13 = 5.

### P100 · dificultad 3 · kc: forma-normal · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Sea $f(x) = -2x^2 + 8x - 6$. ¿Cuál afirmación sobre su gráfica es correcta?

- A) Vértice (−2, 2), corta el eje x en −3 y en −1, y el eje y en −6 · [vertice-signo-invertido] escribes f(x) = −2(x − 2)² + 2 y lees el vértice como (−2, 2), con la abscisa al revés
- B) Vértice (2, 2), corta el eje x en 1 y en 3, y el eje y en 2 · [intercepto-y-como-vertice] tomas la ordenada del vértice, 2, como intercepto con el eje y
- C) Vértice (2, −10), no corta el eje x, y corta el eje y en −6 · [no-multiplica-compensacion-por-a] sumas 4 dentro del paréntesis y restas solo 4, sin multiplicarlo por −2, y queda −2(x − 2)² − 10
- D) Vértice (2, 2), corta el eje x en 1 y en 3, y el eje y en −6 · CORRECTA

solución: −2x² + 8x − 6 = −2(x² − 4x) − 6 = −2(x² − 4x + 4) + 8 − 6 = −2(x − 2)² + 2, con vértice (2, 2). Para los interceptos con x: −2(x − 2)² + 2 = 0 da (x − 2)² = 1, es decir x = 1 o x = 3. El intercepto con y es f(0) = −6. Como a < 0 el máximo es 2, y por eso la gráfica sí llega al eje x.
