# Continuidad

Continuidad en un punto, parámetros que la garantizan, clasificación de las discontinuidades y teorema del valor intermedio. Es del Parcial 1 (semana 3 del programa). De Precálculo hacen falta las desigualdades y las funciones a trozos.

## Habilidades
kc: continuidad · Decidir si una función es continua en un punto, hallar parámetros para que lo sea y clasificar sus discontinuidades · prerrequisitos: limites-laterales
kc: teorema-valor-intermedio · Usar el teorema del valor intermedio para garantizar que una ecuación tiene solución en un intervalo · prerrequisitos: continuidad

## Errores
mc: limite-existe-implica-continua · continuidad · crees que basta con que el límite exista para que la función sea continua en el punto
mc: formula-falla-no-hay-valor · continuidad · dices que la función no está definida en el punto porque la fórmula falla allí, aunque el enunciado le asigna un valor
mc: simplificar-elimina-discontinuidad · continuidad · simplificas el factor que se anula y concluyes que la función es continua, sin comparar el límite con el valor que la función toma en el punto
mc: parametro-ignora-un-lado · continuidad · al buscar el parámetro igualas un solo límite lateral con el valor de la función y no usas el otro
mc: olvida-un-punto-de-union · continuidad · en una función a trozos con dos puntos de unión impones la continuidad solo en uno de ellos
mc: clasifica-sin-laterales · continuidad · clasificas una discontinuidad sin calcular los límites laterales: llamas evitable a una con límite infinito, o de salto a una con límites iguales
mc: tvi-sin-continuidad · teorema-valor-intermedio · aplicas el teorema del valor intermedio sin comprobar que la función es continua en todo el intervalo
mc: signos-no-opuestos · teorema-valor-intermedio · afirmas que hay una raíz en [a, b] sin comprobar que f(a) y f(b) tienen signos opuestos
mc: mismo-signo-sin-raiz · teorema-valor-intermedio · crees que si f(a) y f(b) tienen el mismo signo la función no puede anularse dentro del intervalo
mc: raiz-unica · teorema-valor-intermedio · concluyes que la raíz es única, o que hay exactamente una, porque el teorema garantiza que hay al menos una
mc: valor-fuera-de-los-extremos · teorema-valor-intermedio · garantizas que la función toma un valor k aunque k no está entre f(a) y f(b)

## Preguntas

### P2 · dificultad 2 · kc: continuidad · revisada · origen: humano · revisó: prototipo · ⚠ revisar
Sea $f(x) = \frac{x^2 - 1}{x - 1}$ para x ≠ 1 y f(1) = 3. ¿La función es continua en x = 1?

- A) No, porque $\lim_{x\to 1} f(x) = 2 \ne f(1) = 3$ · CORRECTA
- B) Sí, porque el límite existe · [limite-existe-implica-continua]
- C) No, porque f(1) no está definida · [formula-falla-no-hay-valor]
- D) Sí, porque se puede aplicar L'Hôpital · [simplificar-elimina-discontinuidad]

### P44 · dificultad 1 · kc: continuidad · borrador · origen: ia (sonnet-5.5)
Sea $g(x) = \frac{x^2 + x - 12}{x + 4}$ para x ≠ −4 y g(−4) = 2. ¿Qué tipo de discontinuidad tiene g en x = −4?

- A) De salto, porque g(−4) = 2 queda separado del resto de la gráfica · [clasifica-sin-laterales] llamas de salto a una discontinuidad cuyos límites laterales son iguales, sin calcularlos
- B) Evitable: el límite en x = −4 vale −7, distinto de g(−4) = 2, y bastaría redefinir g(−4) = −7 · CORRECTA
- C) Ninguna, porque el límite de g en x = −4 existe · [limite-existe-implica-continua] das por continua la función porque el límite existe, sin compararlo con g(−4) = 2
- D) Ninguna, porque al simplificar el factor x + 4 queda x − 3, que es continua · [simplificar-elimina-discontinuidad] simplificas el factor x + 4 y no comparas el límite −7 con el valor g(−4) = 2

solución: el numerador se factoriza como x² + x − 12 = (x + 4)(x − 3), así que para x ≠ −4 se tiene g(x) = x − 3 y $\lim_{x\to -4} g(x) = -7$ por los dos lados. Como g(−4) = 2 es distinto de −7, g no es continua en x = −4. Los límites laterales existen, son finitos e iguales, así que la discontinuidad es evitable: bastaría redefinir g(−4) = −7.

### P45 · dificultad 2 · kc: continuidad · borrador · origen: ia (sonnet-5.5)
Sea $f(x) = \frac{x^3 - 8}{x - 2}$ si x < 2, f(2) = a y f(x) = bx − 6 si x > 2. ¿Qué condiciones sobre a y b hacen que f sea continua en x = 2?

- A) Basta con que a = 12, sea cual sea b · [parametro-ignora-un-lado] igualas solo el límite por la izquierda con f(2) y no usas el de la derecha para hallar b
- B) Basta con que a = 2b − 6, sea cual sea b · [parametro-ignora-un-lado] igualas solo el límite por la derecha con f(2) y no usas el de la izquierda
- C) Ningún valor, porque el cociente no está definido en x = 2 · [formula-falla-no-hay-valor] dices que f no está definida en x = 2 porque el cociente falla allí, aunque el enunciado le asigna el valor a
- D) Hace falta que a = 12 y b = 9 · CORRECTA

solución: para x < 2 se tiene $\frac{x^3 - 8}{x - 2} = x^2 + 2x + 4$, así que el límite por la izquierda en x = 2 es 12. El límite por la derecha es 2b − 6. La continuidad pide 12 = f(2) = 2b − 6, o sea a = 12 y b = 9. El cociente falla en x = 2, pero allí f vale a, que es justo lo que se ajusta. Si solo se pide a = 12, el límite por la derecha 2b − 6 coincide con 12 únicamente cuando b = 9. Si solo se pide a = 2b − 6, el límite por la izquierda sigue siendo 12 y coincide con a únicamente cuando b = 9.

### P46 · dificultad 3 · kc: continuidad · borrador · origen: ia (sonnet-5.5)
Sea f(x) = ax + b si x ≤ −1, f(x) = x² si −1 < x < 2 y f(x) = bx − a si x ≥ 2. ¿Qué valores de a y b hacen que f sea continua en todos los reales?

- A) a = −1 y b = 0 · [olvida-un-punto-de-union] impones la continuidad solo en x = −1 y no compruebas x = 2
- B) a = 0 y b = 2 · [olvida-un-punto-de-union] impones la continuidad solo en x = 2 y no compruebas x = −1
- C) a = 2 y b = 3 · CORRECTA
- D) Cualquier par de valores, porque cada trozo es continuo y en x = −1 y en x = 2 existen los límites laterales · [limite-existe-implica-continua] das por continua la función porque existen los límites laterales, sin igualarlos con el valor en cada punto de unión

solución: cada trozo es un polinomio, así que solo hay que revisar x = −1 y x = 2. En x = −1: f(−1) = −a + b y el límite por la izquierda es −a + b; el límite por la derecha es (−1)² = 1, así que −a + b = 1. En x = 2: el límite por la izquierda es 2² = 4 y f(2) = 2b − a es también el límite por la derecha, así que 2b − a = 4. Restando la primera ecuación de la segunda queda b = 3 y entonces a = 2. Con a = 2 y b = 3 la función vale 1 en x = −1 y 4 en x = 2, sin saltos. Los pares a = −1, b = 0 y a = 0, b = 2 cumplen una sola de las dos ecuaciones.

### P47 · dificultad 1 · kc: teorema-valor-intermedio · borrador · origen: ia (sonnet-5.5)
Sea f una función continua en [2, 6] con f(2) = 3 y f(6) = 11. ¿Cuál de estas afirmaciones garantiza el teorema del valor intermedio?

- A) Existe al menos un c en (2, 6) con f(c) = 8 · CORRECTA
- B) Existe al menos un c en (2, 6) con f(c) = 14 · [valor-fuera-de-los-extremos] garantizas que f toma el valor 14, que no está entre f(2) = 3 y f(6) = 11
- C) f no se anula en [2, 6], porque f(2) y f(6) son positivos · [mismo-signo-sin-raiz] crees que, con el mismo signo en los extremos, f no puede anularse dentro del intervalo
- D) Existe un único c en (2, 6) con f(c) = 8 · [raiz-unica] concluyes que c es único, cuando el teorema solo garantiza que existe al menos uno

solución: f es continua en [2, 6] y 8 está entre f(2) = 3 y f(6) = 11, así que el teorema garantiza al menos un c en (2, 6) con f(c) = 8. El valor 14 es mayor que f(6) = 11 y no está entre los extremos. Con el mismo signo en los extremos el teorema no dice nada sobre los ceros: f podría bajar de 3, cruzar el eje y volver a subir. Tampoco garantiza que c sea único: la función lineal por tramos que une (2, 3), (3, 9), (4, 7) y (6, 11) vale 8 en tres puntos.

### P48 · dificultad 2 · kc: teorema-valor-intermedio · borrador · origen: ia (sonnet-5.5)
¿Cuál de las siguientes conclusiones es verdadera y se justifica con el teorema del valor intermedio?

- A) La ecuación $\frac{1}{x} = 0$ tiene solución en (−1, 1): la función vale −1 en x = −1 y 1 en x = 1 · [tvi-sin-continuidad] aplicas el teorema sin comprobar que la función es continua en todo el intervalo, y 1/x no está definida en x = 0
- B) La ecuación $x^3 + 2x - 7 = 0$ tiene solución en (1, 2): la función es continua, vale −4 en x = 1 y 5 en x = 2 · CORRECTA
- C) La ecuación $x^3 - 9x = 0$ tiene exactamente una solución en (−4, 4): la función vale −28 en x = −4 y 28 en x = 4 · [raiz-unica] concluyes que la solución es única porque el teorema garantiza que existe al menos una
- D) La ecuación $x^2 - 3x + 1 = 0$ no tiene solución en (0, 3): la función vale 1 en x = 0 y 1 en x = 3 · [mismo-signo-sin-raiz] crees que, con el mismo signo en los extremos, la función no puede anularse dentro del intervalo

solución: en la opción B, $x^3 + 2x - 7$ es un polinomio, así que es continua; vale −4 en x = 1 y 5 en x = 2, con signos opuestos, y el teorema da una solución en (1, 2). En la A, $\frac{1}{x}$ no es continua en x = 0, que está en [−1, 1], así que el teorema no se aplica; de hecho $\frac{1}{x}$ nunca vale 0. En la C, $x^3 - 9x = x(x - 3)(x + 3)$ se anula en −3, 0 y 3, así que hay tres soluciones y el teorema solo garantiza al menos una. En la D, con el mismo signo en los extremos el teorema no dice nada, y las soluciones $\frac{3 \pm \sqrt{5}}{2}$, aproximadamente 0,38 y 2,62, están en (0, 3).

### P49 · dificultad 2 · kc: teorema-valor-intermedio · borrador · origen: ia (sonnet-5.5)
Sea f(x) = x + 1 si x < 2 y f(x) = x + 4 si x ≥ 2, con f(0) = 1 y f(5) = 9. ¿Cuál de estas afirmaciones sobre f en el intervalo [0, 5] es verdadera?

- A) f toma el valor 4 en algún punto de (0, 5), porque 4 está entre f(0) = 1 y f(5) = 9 · [tvi-sin-continuidad] aplicas el teorema sin comprobar que f es continua: en x = 2 salta de 3 a 6 y se salta el 4
- B) f se anula en algún punto de (0, 5), por el teorema del valor intermedio · [signos-no-opuestos] afirmas que hay una raíz sin comprobar que f(0) y f(5) tienen signos opuestos, y aquí los dos son positivos
- C) f toma el valor 12 en algún punto de (0, 5), por el teorema del valor intermedio · [valor-fuera-de-los-extremos] garantizas que f toma el valor 12, que no está entre f(0) = 1 y f(5) = 9
- D) El teorema del valor intermedio no se puede aplicar porque f no es continua en x = 2, y de hecho f no toma el valor 4 · CORRECTA

solución: en x = 2 el límite por la izquierda es 3 y f(2) = 6, así que f salta y no es continua en [0, 5]: el teorema no se aplica. El primer tramo toma los valores de 1 hasta 3, sin llegar a 3, y el segundo, los de 6 a 9; por eso f nunca vale 4, aunque 4 esté entre f(0) = 1 y f(5) = 9. Tampoco vale 0, porque f ≥ 1 en todo el intervalo y los dos extremos son positivos, ni 12, porque el valor más grande es f(5) = 9.

### P50 · dificultad 3 · kc: teorema-valor-intermedio · borrador · origen: ia (sonnet-5.5)
Sea f(x) = x³ − 4x² − x + 7. ¿Cuál de estas afirmaciones sobre las raíces de f en el intervalo [−2, 4] es verdadera?

- A) No tiene raíces en (−2, 2), porque f(−2) y f(2) son negativos · [mismo-signo-sin-raiz] crees que, con el mismo signo en los extremos, f no puede anularse dentro del intervalo
- B) Tiene exactamente una raíz en (−2, 4), porque f(−2) < 0 < f(4) · [raiz-unica] concluyes que la raíz es única porque el teorema garantiza que existe al menos una
- C) Tiene al menos tres raíces: una en (−2, 0), otra en (0, 2) y otra en (2, 4) · CORRECTA
- D) Tiene una raíz en (2, 3), porque f es continua en [2, 3] · [signos-no-opuestos] afirmas que hay una raíz en (2, 3) sin comprobar que f(2) y f(3) tienen signos opuestos

solución: f es un polinomio, así que es continua. Se evalúa en −2, 0, 2, 3 y 4: f(−2) = −15, f(0) = 7, f(2) = −3, f(3) = −5 y f(4) = 3. En [−2, 0], [0, 2] y [2, 4] los extremos tienen signos opuestos, así que el teorema da una raíz en cada intervalo: al menos tres. En la opción A, f(−2) y f(2) tienen el mismo signo y el teorema no dice nada; de hecho hay dos raíces en (−2, 2). En la B hay tres raíces, no una. En la D, f(2) = −3 y f(3) = −5 tienen el mismo signo, así que el teorema no garantiza una raíz en (2, 3); de hecho f es negativa en todo [2, 3] y la tercera raíz está en (3, 4).
