# Extremos y multiplicadores de Lagrange

Puntos críticos de funciones de dos variables, su clasificación con el criterio de la segunda derivada y los extremos con una restricción mediante multiplicadores de Lagrange. Cae en el Parcial 1 (semana 7).

## Habilidades
kc: extremos-libres · Hallar los puntos críticos de una función de dos variables y clasificarlos con el criterio de la segunda derivada · prerrequisitos: derivadas-parciales
kc: lagrange · Hallar extremos con restricción con multiplicadores de Lagrange · prerrequisitos: gradiente-direccional

## Errores
mc: critico-con-una-sola-parcial · extremos-libres · tomas como punto crítico uno donde se anula solo una de las dos derivadas parciales
mc: discriminante-sin-cuadrado · extremos-libres · calculas D = fxx·fyy − fxy en vez de fxx·fyy − (fxy)²
mc: fxx-positivo-es-maximo · extremos-libres · lees fxx > 0 como máximo y fxx < 0 como mínimo, al revés de lo correcto
mc: d-negativo-decide-por-fxx · extremos-libres · con D < 0 miras el signo de fxx para decidir entre máximo y mínimo, sin ver que D < 0 ya es punto de silla
mc: d-cero-es-silla · extremos-libres · con D = 0 concluyes que es punto de silla, cuando el criterio no decide
mc: d-cero-decide-por-fxx · extremos-libres · con D = 0 usas el signo de fxx para decidir entre máximo y mínimo, cuando el criterio no decide
mc: divide-entre-variable-pierde-puntos · extremos-libres · al resolver simplificas dividiendo entre x o entre y y pierdes los puntos críticos donde esa variable vale 0
mc: igualar-gradientes-sin-lambda · lagrange · planteas ∇f = ∇g sin el multiplicador λ y obtienes un punto que no está sobre la restricción
mc: lambda-es-el-valor-extremo · lagrange · das el valor de λ como si fuera el valor máximo o mínimo de f
mc: constante-restriccion-como-radio · lagrange · lees la constante de x² + y² = c como el radio y usas c² en su lugar
mc: primer-candidato-es-el-extremo · lagrange · te quedas con el primer punto candidato que encuentras, sin evaluar f en todos para comparar
mc: divide-entre-variable-pierde-candidatos · lagrange · al despejar divides entre x o entre y y pierdes los candidatos donde esa variable vale 0
mc: da-el-punto-no-el-valor · lagrange · das las coordenadas del punto donde ocurre el extremo cuando se pide el valor de f
mc: gradiente-de-f-cero-ignora-restriccion · lagrange · resuelves ∇f = 0 como en un problema libre y olvidas la restricción

## Preguntas

### P43 · dificultad 1 · kc: extremos-libres · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
El punto (0, 0) es crítico de f(x, y) = x² + 3xy + y². Según el criterio de la segunda derivada, ¿cómo se clasifica?

- A) Punto de silla, porque D = 2·2 − 3² = −5 < 0 · CORRECTA
- B) Mínimo local, porque D = 2·2 − 3 = 1 > 0 y fxx = 2 > 0 · [discriminante-sin-cuadrado] calculas D como fxx·fyy − fxy, sin elevar fxy al cuadrado, y te sale D = 1 > 0
- C) Máximo local, porque fxx = 2 > 0 · [fxx-positivo-es-maximo] ves fxx = 2 > 0 y lo lees como concavidad hacia abajo, o sea máximo
- D) Mínimo local, porque fxx = 2 > 0 aunque D = −5 < 0 · [d-negativo-decide-por-fxx] con D negativo miras solo el signo de fxx y decides que es mínimo

solución: fx = 2x + 3y y fy = 3x + 2y se anulan en (0, 0). Las segundas derivadas son fxx = 2, fyy = 2 y fxy = 3. D = fxx·fyy − (fxy)² = 4 − 9 = −5. Como D < 0, el punto es de silla, sin importar el signo de fxx.

### P44 · dificultad 2 · kc: extremos-libres · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Sea f(x, y) = xy(6 − x − y). ¿Cuál afirmación es correcta sobre sus puntos críticos?

- A) Tiene 4 puntos críticos y (2, 2) es un máximo local · CORRECTA
- B) Tiene 1 punto crítico, (2, 2), y es un máximo local · [divide-entre-variable-pierde-puntos] simplificas dividiendo entre x y entre y, y pierdes los puntos críticos donde x = 0 o y = 0
- C) Tiene 4 puntos críticos y (2, 2) es un mínimo local · [fxx-positivo-es-maximo] en (2, 2) tienes fxx = −4 < 0 y lo lees como mínimo
- D) Tiene infinitos puntos críticos, los de las rectas y = 0 y 2x + y = 6, y (2, 2) es un máximo local · [critico-con-una-sola-parcial] igualas a cero solo fx y llamas críticos a todos los puntos de esas rectas

solución: fx = 6y − 2xy − y² = y(6 − 2x − y) y fy = 6x − x² − 2xy = x(6 − x − 2y). Si y = 0, fy = 0 da x = 0 o x = 6. Si x = 0, fx = 0 da y = 0 o y = 6. Si x y y son distintos de 0, 2x + y = 6 y x + 2y = 6 dan (2, 2). Los puntos críticos son (0, 0), (6, 0), (0, 6) y (2, 2). En (2, 2): fxx = −2y = −4, fyy = −2x = −4 y fxy = 6 − 2x − 2y = −2, así que D = 16 − 4 = 12 > 0 y fxx < 0: máximo local.

### P45 · dificultad 2 · kc: extremos-libres · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
El punto (0, 0) es crítico de f(x, y) = x² + 4xy + 4y². ¿Qué se puede afirmar usando solo el criterio de la segunda derivada en ese punto?

- A) D = 0, así que el criterio no permite concluir nada · CORRECTA
- B) D = 0, así que es un punto de silla · [d-cero-es-silla] con D = 0 concluyes que el punto es de silla
- C) D = 2·8 − 4 = 12 > 0 y fxx > 0, así que es un mínimo local · [discriminante-sin-cuadrado] calculas D como fxx·fyy − fxy, sin elevar fxy = 4 al cuadrado
- D) D = 0 y fxx = 2 > 0, así que es un mínimo local · [d-cero-decide-por-fxx] con D = 0 usas el signo de fxx = 2 para decidir que es mínimo

solución: fxx = 2, fyy = 8 y fxy = 4. D = fxx·fyy − (fxy)² = 16 − 16 = 0. Cuando D = 0 el criterio no decide: puede ser máximo, mínimo o silla. Hay que mirar la función directamente; aquí f = (x + 2y)² ≥ 0, pero eso ya no es el criterio de la segunda derivada.

### P46 · dificultad 2 · kc: extremos-libres · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Sea f(x, y) = x³ − 3x + y² − 2y. ¿Qué dice el criterio de la segunda derivada sobre sus puntos críticos?

- A) (1, 1) es un mínimo local y (−1, 1) es un punto de silla · CORRECTA
- B) (1, 1) es un mínimo local y (−1, 1) es un máximo local · [d-negativo-decide-por-fxx] en (−1, 1) tienes D < 0, pero miras fxx = −6 < 0 y decides que es máximo
- C) (1, 1) es un máximo local y (−1, 1) es un punto de silla · [fxx-positivo-es-maximo] en (1, 1) ves fxx = 6 > 0 y lo lees como máximo
- D) Todos los puntos de las rectas x = 1 y x = −1 son críticos · [critico-con-una-sola-parcial] resuelves solo fx = 0 y dejas y libre, sin usar fy = 0

solución: fx = 3x² − 3 = 0 da x = 1 o x = −1, y fy = 2y − 2 = 0 da y = 1. Los puntos críticos son (1, 1) y (−1, 1). Las segundas derivadas son fxx = 6x, fyy = 2 y fxy = 0. En (1, 1): D = 12 > 0 y fxx = 6 > 0, mínimo local. En (−1, 1): D = −12 < 0, punto de silla.

### P47 · dificultad 3 · kc: extremos-libres · revisada · origen: ia (sonnet-5.5) · ⚠ revisar · revisó: dvarela5101
Sea f(x, y) = x³ + y⁴ − 6x². ¿Cuál afirmación es correcta?

- A) Tiene dos puntos críticos, (0, 0) y (4, 0), y en ambos D = 0, así que el criterio no decide en ninguno · CORRECTA
- B) Tiene dos puntos críticos, (0, 0) y (4, 0), y en ambos D = 0, así que los dos son puntos de silla · [d-cero-es-silla] con D = 0 concluyes que el punto es de silla
- C) Tiene dos puntos críticos; en (0, 0) hay un máximo local y en (4, 0) un mínimo local, por el signo de fxx · [d-cero-decide-por-fxx] con D = 0 decides por el signo de fxx(0, 0) = −12 y fxx(4, 0) = 12
- D) Tiene un solo punto crítico, (4, 0), y ahí D = 0, así que el criterio no decide · [divide-entre-variable-pierde-puntos] simplificas 3x² − 12x = 0 dividiendo entre x y pierdes el punto con x = 0

solución: las parciales son fx = 3x² − 12x = 3x(x − 4) y fy = 4y³. La condición fy = 0 da y = 0, y fx = 0 da x = 0 o x = 4, de modo que los puntos críticos son (0, 0) y (4, 0). Las segundas derivadas son fxx = 6x − 12, fyy = 12y² y fxy = 0. En (0, 0) se anula fyy, luego D = (−12)(0) − 0 = 0. En (4, 0) también fyy = 0 y D = 12·0 − 0 = 0. Como D = 0 en ambos, el criterio no concluye nada. Mirando la función: cerca de (0, 0), f(x, 0) ≈ −6x² baja y f(0, y) = y⁴ sube, así que es silla; cerca de (4, 0), x³ − 6x² tiene un mínimo en x = 4 y y⁴ ≥ 0, así que es un mínimo local. Por eso B y C son falsas.

### P48 · dificultad 1 · kc: lagrange · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
¿Cuál es el valor máximo de f(x, y) = x + y sujeto a x² + y² = 8?

- A) 4 · CORRECTA
- B) (2, 2) · [da-el-punto-no-el-valor] das el punto donde ocurre el máximo y no el valor de f en ese punto
- C) 8√2 · [constante-restriccion-como-radio] tomas el 8 como el radio y trabajas con x² + y² = 64
- D) 1 · [igualar-gradientes-sin-lambda] planteas (1, 1) = (2x, 2y) sin λ, te sale x = y = 1/2 y evalúas f ahí

solución: ∇f = (1, 1) y ∇g = (2x, 2y) para g = x² + y². De ∇f = λ∇g sale 1 = 2λx y 1 = 2λy, así que x = y. Con x² + y² = 8 queda 2x² = 8, x = ±2. Los candidatos son (2, 2) con f = 4 y (−2, −2) con f = −4. El máximo es 4.

### P49 · dificultad 2 · kc: lagrange · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
¿Cuál es el valor mínimo de f(x, y) = x² − 2y² sujeto a x² + y² = 9?

- A) −18 · CORRECTA
- B) 9 · [divide-entre-variable-pierde-candidatos] divides 2x = 2λx entre x, sacas λ = 1 y pierdes los candidatos con x = 0
- C) −2 · [lambda-es-el-valor-extremo] das el valor de λ en el punto del mínimo en lugar del valor de f
- D) −162 · [constante-restriccion-como-radio] tomas el 9 como el radio y trabajas con x² + y² = 81

solución: ∇f = (2x, −4y) y ∇g = (2x, 2y). De ∇f = λ∇g: 2x = 2λx, o sea x(1 − λ) = 0, y −4y = 2λy, o sea y(−2 − λ) = 0. Si x = 0, entonces y = ±3 (con λ = −2) y f = −18. Si y = 0, entonces x = ±3 (con λ = 1) y f = 9. El mínimo es −18; el máximo es 9.

### P50 · dificultad 2 · kc: lagrange · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
¿Cuál es el valor mínimo de f(x, y) = x² + 2y² sujeto a x + y = 6?

- A) 24 · CORRECTA
- B) 0 · [gradiente-de-f-cero-ignora-restriccion] resuelves ∇f = 0, obtienes (0, 0) y olvidas que ese punto no está sobre la recta
- C) 3/8 · [igualar-gradientes-sin-lambda] planteas (2x, 4y) = (1, 1) sin λ, te sale (1/2, 1/4) y evalúas f ahí, aunque ese punto no está sobre la recta
- D) (4, 2) · [da-el-punto-no-el-valor] das el punto donde ocurre el mínimo y no el valor de f en ese punto

solución: con g = x + y, ∇g = (1, 1) y ∇f = (2x, 4y). La condición ∇f = λ∇g da 2x = λ y 4y = λ, o sea x = 2y. Al imponer x + y = 6 resulta 3y = 6, y = 2 y x = 4. El valor es f(4, 2) = 16 + 8 = 24. Es el mínimo porque f crece sin límite sobre la recta al alejarse.

### P51 · dificultad 2 · kc: lagrange · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
¿Cuál es el valor máximo de f(x, y) = xy sujeto a x² + 9y² = 18?

- A) 3 · CORRECTA
- B) −3 · [primer-candidato-es-el-extremo] te quedas con el primer candidato que encuentras, (3, −1), sin evaluar f en los demás
- C) 1/6 · [lambda-es-el-valor-extremo] das el valor de λ en el punto del máximo en lugar del valor de f
- D) 0 · [igualar-gradientes-sin-lambda] planteas (y, x) = (2x, 18y) sin λ, te sale (0, 0) y evalúas f ahí, aunque ese punto no está sobre la elipse

solución: con g = x² + 9y², ∇f = (y, x) y ∇g = (2x, 18y). La condición ∇f = λ∇g da y = 2λx y x = 18λy, de donde y = 36λ²y. Como y = 0 obligaría a x = 0, que no está en la elipse, λ = ±1/6. Con λ = 1/6, x = 3y y la restricción da 9y² + 9y² = 18, o sea y = ±1: los puntos (3, 1) y (−3, −1) con f = 3. Con λ = −1/6, x = −3y y salen (3, −1) y (−3, 1) con f = −3. El máximo es 3.

### P52 · dificultad 3 · kc: lagrange · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Halla el máximo de f(x, y) = y² + x² − 2x en la elipse x² + 9y² = 9. ¿Cuál es?

- A) 15 · CORRECTA
- B) −1/8 · [divide-entre-variable-pierde-candidatos] divides 2y = 18λy entre y, sacas λ = 1/9 y pierdes los candidatos con y = 0
- C) 3 · [primer-candidato-es-el-extremo] te quedas con el primer candidato que encuentras, (3, 0), sin evaluar f en los demás
- D) −1 · [gradiente-de-f-cero-ignora-restriccion] resuelves ∇f = 0, obtienes (1, 0) y olvidas que ese punto no está sobre la elipse

solución: con g = x² + 9y², ∇f = (2x − 2, 2y) y ∇g = (2x, 18y). La condición ∇f = λ∇g da 2x − 2 = 2λx y 2y = 18λy. La segunda ecuación equivale a y(1 − 9λ) = 0. Si y = 0, la restricción da x = ±3: f(3, 0) = 3 y f(−3, 0) = 15. Si λ = 1/9, la primera ecuación da x = 9/8, luego y² = 55/64 y f = 81/64 + 55/64 − 9/4 = −1/8. Los candidatos valen 15, 3 y −1/8, y el máximo es 15.
