# Expresiones racionales

Simplificación de expresiones racionales con sus restricciones, producto y cociente, y suma y resta con el mínimo común denominador, incluidas las fracciones compuestas. Cae en el Parcial 2, semana 8. Hace falta saber factorizar polinomios.

## Habilidades
kc: simplificar-racionales · Simplificar, multiplicar y dividir expresiones racionales cancelando factores comunes y dando las restricciones · prerrequisitos: factorizar-basico
kc: sumar-racionales · Sumar y restar expresiones racionales con el mínimo común denominador y simplificar fracciones compuestas · prerrequisitos: simplificar-racionales

## Errores
mc: cancela-sumandos-racionales · simplificar-racionales · cancelas términos sueltos del numerador y del denominador, como x² con x², en vez de factorizar y cancelar factores completos
mc: cancela-factor-signo-opuesto-racional · simplificar-racionales · cancelas un factor (a − x) con (x − a) como si fueran el mismo y pierdes el signo menos
mc: olvida-restriccion-factor-cancelado · simplificar-racionales · das las restricciones solo de la expresión simplificada y olvidas los valores que anulaban un factor que cancelaste
mc: restringe-ceros-del-numerador · simplificar-racionales · excluyes los valores que anulan el numerador en vez de los que anulan el denominador
mc: cancela-potencia-completa · simplificar-racionales · al cancelar un factor con una potencia del mismo factor eliminas la potencia entera en vez de restar los exponentes
mc: division-sin-invertir-racional · simplificar-racionales · al dividir multiplicas numerador por numerador y denominador por denominador, sin invertir la segunda fracción
mc: invierte-primera-racional · simplificar-racionales · al dividir inviertes la primera fracción en vez de la segunda
mc: suma-numeradores-y-denominadores · sumar-racionales · sumas numerador con numerador y denominador con denominador, como si a/b + c/d fuera (a + c)/(b + d)
mc: numeradores-sin-ajustar-al-mcd · sumar-racionales · pones el denominador común pero sumas los numeradores originales sin multiplicarlos por el factor que le falta a cada fracción
mc: resta-sin-distribuir-signo-racional · sumar-racionales · al restar fracciones el signo menos solo cambia el primer término del segundo numerador y no lo distribuyes a todos
mc: inversa-de-suma-es-suma-de-inversas · sumar-racionales · en una fracción compuesta inviertes cada sumando por separado y crees que 1/(1/a + 1/b) es a + b
mc: mcd-con-exponente-menor · sumar-racionales · tomas como denominador común cada factor con su menor exponente en vez del mayor
mc: multiplica-por-factor-equivocado · sumar-racionales · al pasar cada fracción al denominador común multiplicas su numerador por su propio denominador o por un factor que no es el que le falta

## Preguntas

### P36 · dificultad 1 · kc: simplificar-racionales · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Simplifica $\frac{x^2 - 25}{x^2 + 3x - 10}$ y da las restricciones de x. ¿Cuál afirmación es correcta?

- A) $\frac{x-5}{x-2}$, con x ≠ −5 y x ≠ 2 · CORRECTA
- B) $\frac{x-5}{x-2}$, con x ≠ 2 · [olvida-restriccion-factor-cancelado] solo restringes lo que ves en la expresión simplificada y olvidas que x = −5 también anula el denominador original
- C) $\frac{x-5}{x-2}$, con x ≠ 5 · [restringe-ceros-del-numerador] excluyes x = 5, que anula el numerador, en vez de los valores que anulan el denominador
- D) $\frac{-25}{3x - 10}$, con x ≠ 10/3 · [cancela-sumandos-racionales] cancelas x² de arriba con x² de abajo y trabajas con lo que queda

solución: se factoriza x² − 25 = (x − 5)(x + 5) y x² + 3x − 10 = (x + 5)(x − 2). El cociente es (x − 5)(x + 5) / ((x + 5)(x − 2)) = (x − 5)/(x − 2). Las restricciones salen del denominador original: x + 5 ≠ 0 y x − 2 ≠ 0, es decir x ≠ −5 y x ≠ 2, aunque el factor x + 5 se cancele.

### P37 · dificultad 2 · kc: simplificar-racionales · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Simplifica $\frac{4 - x^2}{x^2 - x - 2}$ y da las restricciones de x. ¿Cuál afirmación es correcta?

- A) $-\frac{x+2}{x+1}$, con x ≠ −1 y x ≠ 2 · CORRECTA
- B) $\frac{x+2}{x+1}$, con x ≠ −1 y x ≠ 2 · [cancela-factor-signo-opuesto-racional] cancelas (2 − x) con (x − 2) como si fueran iguales y pierdes el signo menos
- C) $-\frac{x+2}{x+1}$, con x ≠ −1 · [olvida-restriccion-factor-cancelado] restringes solo lo que anula el denominador simplificado y olvidas x = 2, que anulaba el factor cancelado
- D) $-\frac{x+2}{x+1}$, con x ≠ 2 y x ≠ −2 · [restringe-ceros-del-numerador] excluyes ±2, que son los ceros del numerador, y no x = −1 del denominador

solución: el denominador se factoriza como (x + 1)(x − 2) y el numerador como (2 + x)(2 − x). Como 2 − x es lo mismo que −(x − 2), el factor x − 2 se cancela y el resultado es −(x + 2)/(x + 1). Las restricciones salen de la expresión de partida: el denominador se anula con x = 2 y con x = −1.

### P38 · dificultad 2 · kc: simplificar-racionales · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Multiplica y simplifica $\frac{x^2 - 4}{x^2 + x} \cdot \frac{x^2 - x}{x^2 - 4x + 4}$. ¿Cuál afirmación es correcta sobre el resultado y sus restricciones?

- A) $\frac{(x+2)(x-1)}{(x+1)(x-2)}$, con x ≠ 0, x ≠ −1 y x ≠ 2 · CORRECTA
- B) $\frac{(x+2)(x-1)}{(x+1)(x-2)}$, con x ≠ −1 y x ≠ 2 · [olvida-restriccion-factor-cancelado] restringes solo lo que ves en la expresión final y olvidas x = 0, que anulaba el factor x que cancelaste
- C) $\frac{-4(x-1)}{(x-2)^2}$, con x ≠ 2 · [cancela-sumandos-racionales] cancelas x² con x² en la primera fracción, te queda −4/x y sigues con eso
- D) $\frac{(x+2)(x-1)}{x+1}$, con x ≠ 0, x ≠ −1 y x ≠ 2 · [cancela-potencia-completa] cancelas el factor (x − 2) del numerador con todo el (x − 2)² del denominador

solución: se factoriza todo: (x − 2)(x + 2) / (x(x + 1)) · x(x − 1) / (x − 2)². Se cancela x y se cancela un factor (x − 2), y queda (x + 2)(x − 1) / ((x + 1)(x − 2)). Como el producto original no está definido cuando x = 0, x = −1 o x = 2, esas son las restricciones, aunque x = 0 ya no aparezca en el resultado.

### P39 · dificultad 2 · kc: simplificar-racionales · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Divide y simplifica $\frac{x^2 - x - 6}{x^2 - 1} \div \frac{x^2 - 9}{x^2 + 2x + 1}$.

- A) $\frac{(x+1)(x+2)}{(x-1)(x+3)}$ · CORRECTA
- B) $\frac{(x+2)(x+3)(x-3)^2}{(x-1)(x+1)^3}$ · [division-sin-invertir-racional] haces el producto de las dos fracciones tal como están, sin dar vuelta a la segunda
- C) $\frac{(x-1)(x+3)}{(x+1)(x+2)}$ · [invierte-primera-racional] inviertes la primera fracción en vez de la segunda
- D) $\frac{x+2}{(x-1)(x+3)}$ · [cancela-potencia-completa] cancelas (x + 1)² del numerador con un solo factor (x + 1) del denominador y eliminas el cuadrado entero

solución: dividir es multiplicar por la inversa de la segunda: (x − 3)(x + 2) / ((x − 1)(x + 1)) · (x + 1)² / ((x − 3)(x + 3)). Se cancela x − 3 y un factor x + 1 (el cuadrado queda en x + 1), y queda (x + 1)(x + 2) / ((x − 1)(x + 3)).

### P40 · dificultad 3 · kc: simplificar-racionales · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Simplifica $\frac{9 - x^2}{x^2 + x - 2} \div \frac{x^2 - x - 6}{x^2 + 4x + 4}$.

- A) $-\frac{x+3}{x-1}$ · CORRECTA
- B) $\frac{x+3}{x-1}$ · [cancela-factor-signo-opuesto-racional] cancelas (3 − x) con (x − 3) como si fueran iguales y pierdes el signo menos
- C) $-\frac{(x-3)^2(x+3)}{(x-1)(x+2)^2}$ · [division-sin-invertir-racional] multiplicas las dos fracciones tal como están, sin invertir la segunda
- D) $-\frac{x-1}{x+3}$ · [invierte-primera-racional] inviertes la primera fracción y multiplicas por la segunda sin invertirla

solución: factorizando los cuatro polinomios se tiene (3 − x)(3 + x), (x + 2)(x − 1), (x − 3)(x + 2) y (x + 2)². Dividir equivale a multiplicar por el recíproco del divisor: (3 − x)(3 + x) / ((x + 2)(x − 1)) · (x + 2)² / ((x − 3)(x + 2)). Tras eliminar dos factores x + 2 resta (3 − x)(3 + x) / ((x − 1)(x − 3)), y como 3 − x = −(x − 3), el resultado final es −(x + 3)/(x − 1).

### P41 · dificultad 1 · kc: sumar-racionales · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Suma $\frac{2}{x+3} + \frac{5}{x-1}$.

- A) $\frac{7x+13}{(x+3)(x-1)}$ · CORRECTA
- B) $\frac{7}{2x+2}$ · [suma-numeradores-y-denominadores] sumas numeradores por un lado y denominadores por el otro
- C) $\frac{7}{(x+3)(x-1)}$ · [numeradores-sin-ajustar-al-mcd] usas el denominador común pero sumas 2 + 5 sin multiplicar cada numerador por el factor que le falta
- D) $\frac{7x+1}{(x+3)(x-1)}$ · [multiplica-por-factor-equivocado] multiplicas cada numerador por su propio denominador: 2(x + 3) + 5(x − 1)

solución: el denominador común es (x + 3)(x − 1). A la primera fracción le falta el factor x − 1 y a la segunda le falta x + 3: 2(x − 1) + 5(x + 3) = 2x − 2 + 5x + 15 = 7x + 13. El resultado es (7x + 13) / ((x + 3)(x − 1)).

### P42 · dificultad 2 · kc: sumar-racionales · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Resta $\frac{3}{(x-2)^2} - \frac{1}{x-2}$.

- A) $\frac{5-x}{(x-2)^2}$ · CORRECTA
- B) $\frac{1-x}{(x-2)^2}$ · [resta-sin-distribuir-signo-racional] escribes 3 − x − 2: el signo menos solo cambia la x y no el −2 de x − 2
- C) $\frac{2}{x-2}$ · [mcd-con-exponente-menor] tomas x − 2 con el menor exponente como denominador común y restas 3 − 1 sobre él
- D) $\frac{2}{(x-2)(x-3)}$ · [suma-numeradores-y-denominadores] restas numeradores por un lado, 3 − 1, y denominadores por el otro, (x − 2)² − (x − 2)

solución: el denominador común es (x − 2)², el mayor exponente del factor x − 2. A la segunda fracción le falta un factor x − 2: 3/(x − 2)² − (x − 2)/(x − 2)². Se resta todo el numerador: 3 − (x − 2) = 3 − x + 2 = 5 − x. El resultado es (5 − x)/(x − 2)².

### P43 · dificultad 2 · kc: sumar-racionales · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Suma $\frac{5}{x^2(x+2)} + \frac{4}{x(x+2)^2}$.

- A) $\frac{9x+10}{x^2(x+2)^2}$ · CORRECTA
- B) $\frac{9}{x(x+2)}$ · [mcd-con-exponente-menor] tomas x(x + 2), con el menor exponente de cada factor, como denominador común y sumas 5 + 4
- C) $\frac{9x+8}{x(x+2)}$ · [multiplica-por-factor-equivocado] multiplicas cada numerador por su propio denominador sobre x²(x + 2)² y simplificas
- D) $\frac{9}{x^2(x+2)^2}$ · [numeradores-sin-ajustar-al-mcd] pones x²(x + 2)² abajo pero sumas 5 + 4 sin multiplicar por los factores que faltan

solución: el denominador común es x²(x + 2)², con el mayor exponente de cada factor. A la primera fracción le falta x + 2 y a la segunda le falta x: 5(x + 2) + 4x = 9x + 10. El resultado es (9x + 10) / (x²(x + 2)²).

### P44 · dificultad 2 · kc: sumar-racionales · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Simplifica $\frac{1}{\frac{1}{x} + \frac{1}{x+2}}$.

- A) $\frac{x(x+2)}{2x+2}$ · CORRECTA
- B) 2x + 2 · [inversa-de-suma-es-suma-de-inversas] inviertes cada sumando del denominador por separado y sumas x + (x + 2)
- C) $\frac{x(x+2)}{2}$ · [numeradores-sin-ajustar-al-mcd] sumas 1 + 1 sobre el denominador común sin multiplicar cada numerador por su factor faltante
- D) x + 1 · [suma-numeradores-y-denominadores] sumas 1/x + 1/(x + 2) como 2/(2x + 2) y luego inviertes

solución: el denominador común de la suma de abajo es x(x + 2), así que el numerador resulta (x + 2) + x = 2x + 2 y la suma queda (2x + 2)/(x² + 2x). Como arriba hay un 1, la respuesta es el recíproco de ese cociente: x(x + 2)/(2x + 2).

### P45 · dificultad 3 · kc: sumar-racionales · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Simplifica $\frac{1}{\frac{2}{x-1} - \frac{3}{x+1}}$.

- A) $\frac{x^2-1}{5-x}$ · CORRECTA
- B) 1 − x · [resta-sin-distribuir-signo-racional] en el denominador escribes 2(x + 1) − 3x − 3, el signo menos solo cambia el 3x y no el −3, y obtienes −x − 1
- C) $\frac{x-5}{6}$ · [inversa-de-suma-es-suma-de-inversas] inviertes cada término del denominador por separado y restas (x − 1)/2 − (x + 1)/3
- D) 1 − x² · [numeradores-sin-ajustar-al-mcd] restas 2 − 3 sobre el denominador común sin multiplicar cada numerador por su factor faltante

solución: para restar abajo se usa (x − 1)(x + 1) = x² − 1; el numerador es 2(x + 1) − 3(x − 1), que vale 5 − x. Entonces la expresión es 1 dividido entre (5 − x)/(x² − 1), es decir (x² − 1)/(5 − x).
