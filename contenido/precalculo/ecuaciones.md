# Ecuaciones lineales y no lineales

Ecuaciones lineales y racionales que se reducen a una lineal, ecuaciones cuadráticas (factorización, completar el cuadrado, fórmula y discriminante) y ecuaciones con radicales, con valor absoluto o de tipo cuadrático. Es del Parcial 2 (semana 8). De Precálculo hacen falta la factorización y la suma de expresiones racionales.

## Habilidades
kc: ecuaciones-lineales · Resolver ecuaciones lineales y ecuaciones racionales que se reducen a una lineal, descartando las soluciones que anulan un denominador · prerrequisitos: sumar-racionales
kc: ecuaciones-cuadraticas · Resolver ecuaciones cuadráticas por factorización, completando el cuadrado o con la fórmula cuadrática, y usar el discriminante · prerrequisitos: factorizar-basico
kc: ecuaciones-radicales-abs · Resolver ecuaciones con radicales, con valor absoluto y de tipo cuadrático, comprobando las soluciones · prerrequisitos: ecuaciones-cuadraticas

## Errores
mc: distribuye-solo-primer-termino-ecuacion · ecuaciones-lineales · multiplicas por un paréntesis o por un denominador común solo el primer término de la suma y dejas el segundo sin multiplicar
mc: pasa-termino-sin-cambiar-signo · ecuaciones-lineales · pasas un término al otro lado de la ecuación sin cambiarle el signo
mc: mcd-no-multiplica-todos-los-terminos · ecuaciones-lineales · al multiplicar por el denominador común no multiplicas todos los términos, y dejas sin multiplicar el que no tiene fracción
mc: no-descarta-solucion-extrana-racional · ecuaciones-lineales · llegas a un valor que anula un denominador y lo das como solución, o no ves que la ecuación se cumple para todo x del dominio
mc: despeja-coeficiente-fraccionario-al-reves · ecuaciones-lineales · para despejar x con un coeficiente fraccionario multiplicas por la fracción en vez de por su inverso
mc: ignora-menos-del-coeficiente-al-despejar · ecuaciones-lineales · cuando x queda con coeficiente negativo, despejas como si el coeficiente fuera positivo y pierdes el signo de la solución
mc: formula-usa-b-sin-cambiar-signo · ecuaciones-cuadraticas · en la fórmula cuadrática escribes b en vez de −b en el numerador
mc: formula-divide-solo-la-raiz-entre-2a · ecuaciones-cuadraticas · en la fórmula cuadrática divides entre 2a solo la raíz y no todo el numerador
mc: discriminante-con-b-negativo-mal-elevado · ecuaciones-cuadraticas · al calcular b² con b negativo escribes −b² en vez de (−b)² y el discriminante sale equivocado
mc: producto-no-cero-iguala-factores-a-constante · ecuaciones-cuadraticas · aplicas que si un producto es cero uno de los factores es cero a un producto igual a otro número, y igualas cada factor a ese número
mc: cuadrado-igual-d-solo-raiz-positiva · ecuaciones-cuadraticas · al sacar raíz cuadrada en una ecuación del tipo (algo)² = d tomas solo la raíz positiva
mc: completa-cuadrado-sin-compensar-en-el-otro-lado · ecuaciones-cuadraticas · al completar el cuadrado sumas el término que falta solo a un lado de la ecuación
mc: raiz-con-signo-contrario-al-despejar · ecuaciones-cuadraticas · al despejar x en un factor o después de sacar la raíz, dejas el número con el signo opuesto
mc: cuadrado-de-binomio-sin-doble-producto-radical · ecuaciones-radicales-abs · al elevar al cuadrado un binomio, en una ecuación con radical, elevas cada término y te falta el doble producto
mc: no-comprueba-solucion-extrana-radical-o-abs · ecuaciones-radicales-abs · no sustituyes las soluciones en la ecuación original y das como válida una que no la cumple
mc: abs-ecuacion-solo-una-rama · ecuaciones-radicales-abs · en |A| = B planteas solo la rama A = B y no la rama A = −B
mc: abs-rama-negativa-sin-distribuir-el-menos · ecuaciones-radicales-abs · al plantear la rama negativa de un valor absoluto cambias el signo de un solo término de lo que hay dentro
mc: despeja-rama-o-factor-con-signo-contrario · ecuaciones-radicales-abs · al despejar la variable en una rama de un valor absoluto o en un factor de la ecuación en u, pasas el número con el signo equivocado
mc: sustitucion-sin-volver-a-x · ecuaciones-radicales-abs · resuelves la ecuación en la variable auxiliar u y das los valores de u como si fueran los de x
mc: eleva-solo-un-lado-en-ecuacion-radical · ecuaciones-radicales-abs · elevas al cuadrado solo el lado del radical y dejas el otro lado sin elevar

## Preguntas

### P46 · dificultad 1 · kc: ecuaciones-lineales · borrador · origen: ia (sonnet-5.5)
Resuelve la ecuación $\frac{3}{4}(x - 8) = 6$.

- A) x = 25/2 · [despeja-coeficiente-fraccionario-al-reves] multiplicas 6 por 3/4 en vez de por 4/3 y llegas a x − 8 = 9/2
- B) x = 56/3 · [distribuye-solo-primer-termino-ecuacion] multiplicas 3/4 solo por x y dejas el −8 sin multiplicar: queda (3/4)x − 8 = 6
- C) x = 16 · CORRECTA
- D) x = 0 · [pasa-termino-sin-cambiar-signo] pasas el −6 al lado derecho sin cambiarle el signo y queda (3/4)x = 6 − 6

solución: se multiplican ambos lados por 4/3: x − 8 = 8, y entonces x = 16. Comprobación: (3/4)(16 − 8) = (3/4)·8 = 6.

### P47 · dificultad 2 · kc: ecuaciones-lineales · borrador · origen: ia (sonnet-5.5)
Resuelve $\frac{x}{x-4} = \frac{4}{x-4} + 2$.

- A) x = 4 · [no-descarta-solucion-extrana-racional] llegas a x = 4 y no ves que ese valor anula el denominador x − 4
- B) x = 6 · [mcd-no-multiplica-todos-los-terminos] multiplicas por x − 4 los dos cocientes pero no el 2, y queda x = 4 + 2
- C) x = 0 · [distribuye-solo-primer-termino-ecuacion] escribes 2(x − 4) como 2x − 4 y queda x = 4 + 2x − 4
- D) No tiene solución · CORRECTA

solución: la ecuación solo tiene sentido si x ≠ 4. Se multiplica todo por x − 4: x = 4 + 2(x − 4), es decir, x = 2x − 4, y entonces x = 4. Ese valor anula el denominador, así que se descarta y la ecuación no tiene solución.

### P48 · dificultad 2 · kc: ecuaciones-lineales · borrador · origen: ia (sonnet-5.5)
¿Cuál es el conjunto solución de $\frac{5}{x-3} - 2 = \frac{11-2x}{x-3}$?

- A) Todos los números reales · [no-descarta-solucion-extrana-racional] la ecuación se reduce a una identidad y olvidas que x = 3 anula el denominador
- B) x = 4 · [mcd-no-multiplica-todos-los-terminos] multiplicas por x − 3 pero dejas el −2 sin multiplicar: queda 5 − 2 = 11 − 2x
- C) No tiene solución · [distribuye-solo-primer-termino-ecuacion] escribes −2(x − 3) como −2x − 3 y queda 5 − 2x − 3 = 11 − 2x, que da 2 = 11
- D) Todos los números reales excepto 3 · CORRECTA

solución: la ecuación exige x ≠ 3. Se multiplica todo por x − 3: 5 − 2(x − 3) = 11 − 2x, es decir, 11 − 2x = 11 − 2x. Es una identidad: se cumple para todo x del dominio, o sea, para todo real distinto de 3.

### P49 · dificultad 2 · kc: ecuaciones-lineales · borrador · origen: ia (sonnet-5.5)
Resuelve $\frac{3}{5}x - 4 = 2x + 3$.

- A) x = −49/5 · [despeja-coeficiente-fraccionario-al-reves] llegas a −(7/5)x = 7 y multiplicas 7 por −7/5 en vez de por −5/7
- B) x = 5 · [ignora-menos-del-coeficiente-al-despejar] llegas a −(7/5)x = 7 y despejas como si el coeficiente fuera 7/5 positivo
- C) x = 5/7 · [pasa-termino-sin-cambiar-signo] pasas el −4 al lado derecho sin cambiarle el signo y queda −(7/5)x = 3 − 4
- D) x = −5 · CORRECTA

solución: se pasan las x a la izquierda y los números a la derecha: (3/5)x − 2x = 3 + 4, es decir, −(7/5)x = 7. Se multiplica por −5/7 y x = −5. Comprobación: (3/5)(−5) − 4 = −7 y 2(−5) + 3 = −7.

### P50 · dificultad 3 · kc: ecuaciones-lineales · borrador · origen: ia (sonnet-5.5)
Resuelve $\frac{x+1}{2} - \frac{2x-3}{3} = 1$.

- A) x = −6 · [distribuye-solo-primer-termino-ecuacion] al multiplicar por 6 escribes −2(2x − 3) como −4x − 3 y queda 3x + 3 − 4x − 3 = 6
- B) x = 3 · CORRECTA
- C) x = 8 · [mcd-no-multiplica-todos-los-terminos] multiplicas las dos fracciones por 6 pero dejas el 1 sin multiplicar: queda 3x + 3 − 4x + 6 = 1
- D) x = −3 · [ignora-menos-del-coeficiente-al-despejar] llegas a −x = −3 y concluyes x = −3

solución: el denominador común es 6. Multiplicando todo por 6: 3(x + 1) − 2(2x − 3) = 6, es decir, 3x + 3 − 4x + 6 = 6, o sea, −x + 9 = 6. Entonces −x = −3 y x = 3. Comprobación: (3 + 1)/2 − (6 − 3)/3 = 2 − 1 = 1.

### P51 · dificultad 1 · kc: ecuaciones-cuadraticas · borrador · origen: ia (sonnet-5.5)
Al resolver x² − 4x − 5 = 0 con la fórmula cuadrática, ¿cuáles son las soluciones?

- A) x = 7 y x = 1 · [formula-divide-solo-la-raiz-entre-2a] divides entre 2 solo la raíz: x = 4 ± 6/2 = 4 ± 3
- B) x = 5 y x = −1 · CORRECTA
- C) x = 3 y x = 1 · [discriminante-con-b-negativo-mal-elevado] calculas (−4)² como −16 y el discriminante queda −16 + 20 = 4 en vez de 36
- D) x = 1 y x = −5 · [formula-usa-b-sin-cambiar-signo] pones −4 en vez de 4 en el numerador: x = (−4 ± 6)/2

solución: a = 1, b = −4, c = −5. El discriminante es (−4)² − 4·1·(−5) = 16 + 20 = 36. Entonces x = (4 ± 6)/2, que da x = 5 y x = −1. Comprobación: 25 − 20 − 5 = 0 y 1 + 4 − 5 = 0.

### P52 · dificultad 2 · kc: ecuaciones-cuadraticas · borrador · origen: ia (sonnet-5.5)
Al resolver x² − 6x − 1 = 0 completando el cuadrado, ¿cuáles son las soluciones?

- A) x = 3 + √10 · [cuadrado-igual-d-solo-raiz-positiva] de (x − 3)² = 10 tomas solo x − 3 = +√10
- B) x = 2 y x = 4 · [completa-cuadrado-sin-compensar-en-el-otro-lado] sumas 9 solo a la izquierda y queda (x − 3)² = 1
- C) x = 3 ± √10 · CORRECTA
- D) x = −3 ± √10 · [raiz-con-signo-contrario-al-despejar] de x − 3 = ±√10 despejas x = −3 ± √10

solución: x² − 6x = 1. La mitad de −6 es −3 y su cuadrado es 9, que se suma a los dos lados: x² − 6x + 9 = 10, es decir, (x − 3)² = 10. Entonces x − 3 = ±√10 y x = 3 ± √10.

### P53 · dificultad 2 · kc: ecuaciones-cuadraticas · borrador · origen: ia (sonnet-5.5)
Resuelve x(x − 3) = 10.

- A) x = 10 y x = 13 · [producto-no-cero-iguala-factores-a-constante] igualas cada factor a 10: x = 10 y x − 3 = 10
- B) x = −5 y x = 2 · [raiz-con-signo-contrario-al-despejar] factorizas bien (x − 5)(x + 2) = 0 pero lees cada solución con el signo del número del factor
- C) x = 5 y x = −2 · CORRECTA
- D) $x = \frac{3 \pm \sqrt{31}}{2}$ · [discriminante-con-b-negativo-mal-elevado] con la fórmula calculas (−3)² como −9 y el discriminante queda −9 + 40 = 31

solución: el producto es 10, no 0, así que primero se lleva a cero: x² − 3x − 10 = 0. Se factoriza: (x − 5)(x + 2) = 0, y entonces x = 5 o x = −2. Comprobación: 5·2 = 10 y (−2)(−5) = 10.

### P54 · dificultad 2 · kc: ecuaciones-cuadraticas · borrador · origen: ia (sonnet-5.5)
Resuelve 2x² − 7x + 3 = 0.

- A) No tiene soluciones reales · [discriminante-con-b-negativo-mal-elevado] calculas (−7)² como −49 y el discriminante queda −49 − 24 = −73
- B) x = 33/4 y x = 23/4 · [formula-divide-solo-la-raiz-entre-2a] divides entre 4 solo la raíz: x = 7 ± 5/4
- C) x = −1/2 y x = −3 · [formula-usa-b-sin-cambiar-signo] pones −7 en vez de 7 en el numerador: x = (−7 ± 5)/4
- D) x = 3 y x = 1/2 · CORRECTA

solución: a = 2, b = −7, c = 3. El discriminante es (−7)² − 4·2·3 = 49 − 24 = 25. Entonces x = (7 ± 5)/4, que da x = 3 y x = 1/2. Comprobación: 18 − 21 + 3 = 0 y 1/2 − 7/2 + 3 = 0.

### P55 · dificultad 3 · kc: ecuaciones-cuadraticas · borrador · origen: ia (sonnet-5.5)
Resuelve (x + 2)(x − 6) = −3.

- A) x = 2 ± √13 · CORRECTA
- B) x = −5 y x = 3 · [producto-no-cero-iguala-factores-a-constante] igualas cada factor a −3: x + 2 = −3 y x − 6 = −3
- C) x = 5 y x = −1 · [completa-cuadrado-sin-compensar-en-el-otro-lado] llegas a x² − 4x = 9, sumas 4 solo a la izquierda y queda (x − 2)² = 9
- D) x = 2 + √13 · [cuadrado-igual-d-solo-raiz-positiva] de (x − 2)² = 13 tomas solo x − 2 = +√13

solución: se desarrolla y se lleva a cero: x² − 4x − 12 = −3, es decir, x² − 4x − 9 = 0. No factoriza con enteros, así que se completa el cuadrado: x² − 4x = 9, y se suma 4 a los dos lados: (x − 2)² = 13. Entonces x = 2 ± √13. Comprobación: (4 + √13)(√13 − 4) = 13 − 16 = −3.

### P56 · dificultad 1 · kc: ecuaciones-radicales-abs · borrador · origen: ia (sonnet-5.5)
Resuelve 2|x − 1| + 3 = 11.

- A) x = 5 y x = −5 · [abs-rama-negativa-sin-distribuir-el-menos] con |x − 1| = 4 escribes la rama negativa como −x − 1 = 4
- B) x = 3 y x = −5 · [despeja-rama-o-factor-con-signo-contrario] de x − 1 = ±4 despejas x = ±4 − 1
- C) x = 5 y x = −3 · CORRECTA
- D) x = 5 · [abs-ecuacion-solo-una-rama] planteas solo x − 1 = 4 y olvidas la rama x − 1 = −4

solución: primero se aísla el valor absoluto: 2|x − 1| = 8, es decir, |x − 1| = 4. Hay dos ramas: x − 1 = 4, que da x = 5, y x − 1 = −4, que da x = −3. Comprobación: 2·4 + 3 = 11 en los dos casos.

### P57 · dificultad 2 · kc: ecuaciones-radicales-abs · borrador · origen: ia (sonnet-5.5)
Resuelve |x − 3| = 2x − 1.

- A) x = −2 · [abs-ecuacion-solo-una-rama] planteas solo la rama x − 3 = 2x − 1
- B) x = −2 y x = −2/3 · [abs-rama-negativa-sin-distribuir-el-menos] escribes la rama negativa como −x − 3 = 2x − 1 en vez de −(x − 3) = 2x − 1
- C) x = −2 y x = 4/3 · [no-comprueba-solucion-extrana-radical-o-abs] resuelves bien las dos ramas pero no compruebas que x = −2 da 2x − 1 = −5, y un valor absoluto no puede ser negativo
- D) x = 4/3 · CORRECTA

solución: como |x − 3| ≥ 0, hace falta 2x − 1 ≥ 0. Rama x − 3 = 2x − 1: x = −2, que da 2x − 1 = −5 < 0, así que se descarta. Rama −(x − 3) = 2x − 1: 3 − x = 2x − 1, es decir, x = 4/3. Comprobación: |4/3 − 3| = 5/3 y 2·(4/3) − 1 = 5/3.

### P58 · dificultad 2 · kc: ecuaciones-radicales-abs · borrador · origen: ia (sonnet-5.5)
Resuelve $\sqrt{x+5} = x - 1$.

- A) x = −1 y x = 4 · [no-comprueba-solucion-extrana-radical-o-abs] resuelves bien la cuadrática pero no compruebas que x = −1 da √4 = −2
- B) No tiene solución · [eleva-solo-un-lado-en-ecuacion-radical] elevas al cuadrado solo la raíz y dejas x − 1 sin elevar: x + 5 = x − 1
- C) x = 4 · CORRECTA
- D) $x = \frac{1 \pm \sqrt{17}}{2}$ · [cuadrado-de-binomio-sin-doble-producto-radical] escribes (x − 1)² como x² + 1 y queda x + 5 = x² + 1

solución: al elevar ambos lados al cuadrado queda x + 5 = x² − 2x + 1, o sea x² − 3x − 4 = 0, que se factoriza como (x − 4)(x + 1) = 0. Hay que probar cada candidata en la ecuación original. Con x = 4: √9 = 3 y 4 − 1 = 3, sirve. Con x = −1: √4 = 2 pero −1 − 1 = −2, así que es extraña y se descarta.

### P59 · dificultad 2 · kc: ecuaciones-radicales-abs · borrador · origen: ia (sonnet-5.5)
Resuelve x⁴ − 13x² + 36 = 0.

- A) x = 4 y x = 9 · [sustitucion-sin-volver-a-x] con u = x² resuelves u² − 13u + 36 = 0 y das los valores de u como si fueran los de x
- B) No tiene soluciones reales · [despeja-rama-o-factor-con-signo-contrario] factorizas (u − 4)(u − 9) = 0 pero lees u = −4 y u = −9, que no son cuadrados de reales
- C) x = 2 y x = 3 · [cuadrado-igual-d-solo-raiz-positiva] de x² = 4 y x² = 9 tomas solo la raíz positiva
- D) x = ±2 y x = ±3 · CORRECTA

solución: con u = x² la ecuación queda u² − 13u + 36 = 0, es decir, (u − 4)(u − 9) = 0, y entonces u = 4 o u = 9. Se vuelve a x: x² = 4 da x = ±2 y x² = 9 da x = ±3. Son cuatro soluciones. Comprobación: 16 − 52 + 36 = 0 y 81 − 117 + 36 = 0.

### P60 · dificultad 3 · kc: ecuaciones-radicales-abs · borrador · origen: ia (sonnet-5.5)
Resuelve x − 3√x − 4 = 0.

- A) x = 4 · [sustitucion-sin-volver-a-x] con u = √x llegas a u = 4 (descartas u = −1) y das u = 4 como valor de x
- B) x = −1/2 · [eleva-solo-un-lado-en-ecuacion-radical] aíslas el radical y elevas al cuadrado solo 3√x: x − 4 = 9x
- C) x = 16 · CORRECTA
- D) $x = \frac{9 \pm \sqrt{145}}{2}$ · [cuadrado-de-binomio-sin-doble-producto-radical] aíslas el radical y escribes (x − 4)² como x² − 16: queda x² − 16 = 9x

solución: con u = √x (u ≥ 0) la ecuación queda u² − 3u − 4 = 0, es decir, (u − 4)(u + 1) = 0. Entonces u = 4 o u = −1. Como √x no puede ser negativo, se descarta u = −1. Con u = 4, x = 16. Comprobación: 16 − 3·4 − 4 = 0.
