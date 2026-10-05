# Límites

Cálculo de límites por factorización y racionalización, límites laterales, límites con senos y límites al infinito con sus asíntotas. Es del Parcial 1 (semanas 2 a 4 del programa). El programa enseña el límite de sen x / x después del Parcial 1, pero entra aquí porque el material del parcial lo pide. De Precálculo hacen falta la factorización, la racionalización, las expresiones racionales, el valor absoluto y la trigonometría básica.

## Habilidades
kc: limite-algebraico · Calcular un límite de la forma 0/0 con factorización o racionalización
kc: limites-laterales · Decidir si existe un límite comparando los límites laterales, con valor absoluto o funciones a trozos · prerrequisitos: limite-algebraico
kc: limite-trigonometrico · Calcular límites con sen x / x y con el teorema del encaje · prerrequisitos: limite-algebraico
kc: limites-infinito-asintotas · Calcular límites al infinito y límites infinitos, y hallar con ellos las asíntotas horizontales y verticales · prerrequisitos: limite-algebraico, limites-laterales

## Errores
mc: cero-sobre-cero-es-numero · limite-algebraico · al sustituir queda 0/0 y lo tomas como un valor (0 o 1) en vez de simplificar la expresión
mc: cancela-terminos-sueltos · limite-algebraico · cancelas términos sueltos del numerador y del denominador en vez de factorizar y cancelar factores completos
mc: no-definida-implica-sin-limite · limite-algebraico · crees que si la función no está definida en el punto, el límite no existe
mc: denominador-cero-implica-infinito · limite-algebraico · tomas el denominador que tiende a 0 como una división por cero y concluyes que el límite es infinito, aunque el numerador también tiende a 0
mc: conjugado-incompleto · limite-algebraico · al racionalizar multiplicas solo el numerador, o solo el denominador, por el conjugado y cambias el valor de la expresión
mc: cancela-factor-signo-opuesto · limite-algebraico · cancelas (a − x) con (x − a) como si fueran iguales y pierdes el signo menos
mc: abs-sin-separar-casos · limites-laterales · tratas |x − a| como x − a sin separar según el lado por el que te acercas
mc: un-solo-lado-basta · limites-laterales · concluyes que el límite existe después de calcular un solo límite lateral
mc: compara-laterales-con-valor · limites-laterales · para decidir si el límite existe comparas cada lateral con f(a), cuando basta con que los dos coincidan entre sí
mc: tramo-invertido · limites-laterales · al acercarte por la derecha usas la fórmula del tramo de la izquierda, o al revés
mc: signo-del-infinito-sin-revisar · limites-laterales · al acercarte a un cero del denominador no revisas el signo del cociente en cada lado y das el infinito con el signo equivocado
mc: infinitos-opuestos-valen-infinito · limites-laterales · cuando un límite lateral tiende a +∞ y el otro a −∞ dices que el límite existe y es infinito
mc: cancela-x-con-seno · limite-trigonometrico · cancelas la x del denominador con la x del argumento del seno, como si sen x / x fuera sen
mc: argumento-distinto-del-denominador · limite-trigonometrico · usas que sen u / u tiende a 1 aunque el denominador no es el argumento del seno y no ajustas el factor que falta, por ejemplo en sen 3x / x
mc: limite-notable-lejos-de-cero · limite-trigonometrico · aplicas que sen u / u tiende a 1 cuando u no tiende a 0
mc: oscila-sin-encaje · limite-trigonometrico · dices que un producto no tiene límite porque uno de sus factores oscila, en vez de acotarlo con el teorema del encaje
mc: encaje-cotas-distintas · limite-trigonometrico · usas el teorema del encaje con dos cotas cuyos límites no coinciden
mc: lhopital-circular · limite-trigonometrico · justificas el límite de sen x / x con L'Hôpital, sin ver que derivar el seno ya usa ese límite
mc: infinito-menos-infinito-cero · limites-infinito-asintotas · restas dos expresiones que tienden a infinito y concluyes que el límite es 0, sin racionalizar
mc: mismo-grado-limite-uno · limites-infinito-asintotas · con numerador y denominador del mismo grado dices que el límite es 1, sin dividir los coeficientes principales
mc: raiz-sin-signo-en-menos-infinito · limites-infinito-asintotas · escribes √(x²) como x también cuando x tiende a −∞ y el límite sale con el signo contrario
mc: vertical-por-denominador-cero · limites-infinito-asintotas · marcas una asíntota vertical en cada cero del denominador, aunque el factor se cancele con el numerador
mc: una-sola-horizontal · limites-infinito-asintotas · das una sola asíntota horizontal sin calcular por separado el límite en +∞ y en −∞
mc: exponencial-limite-invertido · limites-infinito-asintotas · crees que eˣ tiende a 0 cuando x crece, o que e⁻ˣ crece sin límite

## Preguntas

### P1 · dificultad 2 · kc: limite-algebraico · revisada · origen: humano · revisó: prototipo · ⚠ revisar
Calcula el límite: $\lim_{x\to 2} \frac{x^2 - 4}{x - 2}$

- A) 4 · CORRECTA
- B) 0 · [cero-sobre-cero-es-numero]
- C) No existe · [no-definida-implica-sin-limite]
- D) 2 · [cancela-terminos-sueltos]

### P3 · dificultad 2 · kc: limite-trigonometrico, limite-algebraico · retirada · origen: humano · revisó: prototipo
Evalúa $\lim_{x\to 0} \frac{\sen(x)}{x}$

- A) 1 · CORRECTA
- B) 0 · [cero-sobre-cero-es-numero]
- C) ∞ · [denominador-cero-implica-infinito]
- D) Aplico L'Hôpital: cos(0)/1 = 1, pero justificas mal · [lhopital-circular]

### P29 · dificultad 1 · kc: limite-algebraico · borrador · origen: ia (sonnet-5.5)
Halla el límite: $\lim_{x\to 2} \frac{\sqrt{3x+10} - 4}{x - 2}$

- A) 3 · [conjugado-incompleto] multiplicas solo el numerador por el conjugado y olvidas el denominador: queda 3(x − 2)/(x − 2) = 3
- B) No existe · [no-definida-implica-sin-limite] como la expresión no está definida en x = 2, concluyes que el límite no existe
- C) 3/8 · CORRECTA
- D) ∞ · [denominador-cero-implica-infinito] el denominador tiende a 0 y concluyes que el límite es infinito, aunque el numerador también tiende a 0

solución: al sustituir x = 2 queda 0/0, así que hay que racionalizar. Se multiplican numerador y denominador por el conjugado √(3x+10) + 4. El numerador queda (3x + 10) − 16 = 3x − 6 = 3(x − 2). Entonces el cociente es 3(x − 2) / ((x − 2)(√(3x+10) + 4)) = 3 / (√(3x+10) + 4) para x ≠ 2, y al sustituir x = 2 da 3 / (4 + 4) = 3/8.

### P30 · dificultad 2 · kc: limite-algebraico · borrador · origen: ia (sonnet-5.5)
Calcula $\lim_{x\to 6} \frac{36 - x^2}{x^2 - 4x - 12}$

- A) 0 · [cero-sobre-cero-es-numero] al sustituir queda 0/0 y lo tomas como el valor 0
- B) −3/2 · CORRECTA
- C) 3/2 · [cancela-factor-signo-opuesto] cancelas (6 − x) con (x − 6) como si fueran iguales y pierdes el signo menos
- D) −1 · [cancela-terminos-sueltos] cancelas los términos x² de arriba y de abajo y evalúas lo que queda, 36/(−4x − 12), en x = 6

solución: al sustituir x = 6 queda 0/0. Se factoriza: 36 − x² = (6 − x)(6 + x) y x² − 4x − 12 = (x − 6)(x + 2). Como 6 − x = −(x − 6), el cociente es −(x − 6)(6 + x) / ((x − 6)(x + 2)) = −(6 + x)/(x + 2) para x ≠ 6. Al sustituir x = 6 da −12/8 = −3/2.

### P31 · dificultad 3 · kc: limite-algebraico · borrador · origen: ia (sonnet-5.5)
Calcula $\lim_{x\to 1} \frac{\sqrt{x+3} - \sqrt{5-x}}{1 - x^2}$

- A) 1/4 · [cancela-factor-signo-opuesto] cancelas (x − 1) con (1 − x) como si fueran iguales y pierdes el signo menos
- B) −1 · [conjugado-incompleto] multiplicas solo el numerador por el conjugado y olvidas el denominador: queda (2x − 2)/(1 − x²), que se simplifica a −2/(1 + x) y tiende a −1
- C) ∞ · [denominador-cero-implica-infinito] el denominador 1 − x² tiende a 0 y concluyes que el límite es infinito, aunque el numerador también tiende a 0
- D) −1/4 · CORRECTA

solución: al sustituir x = 1 quedan √4 − √4 = 0 arriba y 0 abajo. Se multiplican numerador y denominador por el conjugado √(x+3) + √(5−x). El numerador queda (x + 3) − (5 − x) = 2x − 2 = 2(x − 1), y el denominador queda (1 − x)(1 + x)(√(x+3) + √(5−x)). Como x − 1 = −(1 − x), el cociente es −2 / ((1 + x)(√(x+3) + √(5−x))) para x ≠ 1. Al sustituir x = 1 da −2 / (2·(2 + 2)) = −1/4.

### P32 · dificultad 1 · kc: limites-laterales · borrador · origen: ia (sonnet-5.5)
Sea f una función definida cerca de x = a, aunque f(a) puede no existir o valer otra cosa. ¿Cuál de estas condiciones es necesaria y suficiente para que $\lim_{x\to a} f(x)$ exista como número real?

- A) Que los dos límites laterales existan y sean iguales entre sí · CORRECTA
- B) Que los dos límites laterales existan y sean iguales a f(a) · [compara-laterales-con-valor] exiges que cada lateral coincida con f(a), cuando basta con que coincidan entre sí
- C) Que exista el límite por la izquierda · [un-solo-lado-basta] crees que basta con tener un solo límite lateral
- D) Que los dos límites laterales sean infinitos, aunque uno sea +∞ y el otro −∞ · [infinitos-opuestos-valen-infinito] tomas dos infinitos de signo opuesto como un límite que existe

solución: el límite existe como número real exactamente cuando los dos límites laterales existen y coinciden entre sí. El valor de f(a) no interviene. La opción B exige de más: f(x) = x² para x ≠ 0 con f(0) = 1 tiene límite 0 en x = 0, y ninguno de sus laterales vale f(0). La opción C no basta: f(x) = |x|/x tiene límite por la izquierda (−1) y no tiene límite en x = 0. La opción D no sirve: 1/x tiende a −∞ por la izquierda y a +∞ por la derecha, y eso no es un número real.

### P33 · dificultad 2 · kc: limites-laterales · borrador · origen: ia (sonnet-5.5)
Sea $f(x) = \frac{2x^2 - 8}{|x - 2|}$ para x ≠ 2. ¿Qué ocurre con $\lim_{x\to 2} f(x)$?

- A) Por la izquierda el límite es −8, así que existe y vale −8 · [un-solo-lado-basta] calculas solo el lateral izquierdo y concluyes que el límite existe
- B) Por la izquierda el límite es −8 y por la derecha es 8, así que no existe · CORRECTA
- C) Por los dos lados el límite es 8, así que existe y vale 8 · [abs-sin-separar-casos] cambias |x − 2| por x − 2 en los dos lados sin separar los casos
- D) Por la izquierda el límite es 8 y por la derecha es −8, así que no existe · [tramo-invertido] usas |x − 2| = x − 2 al acercarte por la izquierda y |x − 2| = −(x − 2) al acercarte por la derecha

solución: el numerador se factoriza como 2x² − 8 = 2(x − 2)(x + 2). A la izquierda de 2, |x − 2| vale −(x − 2) y la función queda −2(x + 2), que tiende a −8. A la derecha de 2, |x − 2| vale x − 2 y la función queda 2(x + 2), que tiende a 8. Los dos laterales son distintos, así que el límite no existe.

### P34 · dificultad 2 · kc: limites-laterales · borrador · origen: ia (sonnet-5.5)
Sea $f(x) = \frac{x^2 + 2x - 15}{x^2 - 7x + 12}$ para x ≠ 3 y x ≠ 4, y sea f(3) = 5. Sobre los límites de f en x = 3 y en x = 4, ¿cuál afirmación es correcta?

- A) En x = 3 el límite no existe, porque −8 ≠ f(3); en x = 4 tampoco existe · [compara-laterales-con-valor] comparas los laterales de x = 3 con f(3) = 5 en vez de compararlos entre sí
- B) En x = 3 el límite existe y vale −8; en x = 4 existe y es infinito · [infinitos-opuestos-valen-infinito] tomas los laterales −∞ y +∞ de x = 4 como un límite infinito que existe
- C) En x = 3 el límite existe y vale −8; en x = 4 no existe, porque por la izquierda tiende a −∞ y por la derecha a +∞ · CORRECTA
- D) En x = 3 el límite existe y vale −8; en x = 4 es +∞, porque cerca de 4 el numerador y el denominador son positivos · [signo-del-infinito-sin-revisar] no revisas el signo del denominador a la izquierda de 4 y das +∞

solución: el numerador se factoriza como (x − 3)(x + 5) y el denominador como (x − 3)(x − 4), así que f(x) = (x + 5)/(x − 4) para x ≠ 3 y x ≠ 4. En x = 3 los dos laterales valen 8/(−1) = −8. El valor f(3) = 5 no cuenta para el límite, así que el límite existe y vale −8. En x = 4 el numerador tiende a 9. Por la izquierda x − 4 es negativo y cercano a 0, y el cociente tiende a −∞. Por la derecha x − 4 es positivo y cercano a 0, y el cociente tiende a +∞. Los laterales son distintos, así que el límite en x = 4 no existe.

### P35 · dificultad 3 · kc: limites-laterales · borrador · origen: ia (sonnet-5.5)
¿Cuál afirmación es correcta sobre $\lim_{x\to 2} \frac{x + 5}{(x - 2)\,|x - 2|}$?

- A) Existe y es +∞, porque |x − 2| = x − 2 y queda $\frac{x + 5}{(x - 2)^2}$ · [abs-sin-separar-casos] cambias |x − 2| por x − 2 en los dos lados sin separar los casos
- B) No existe: por la izquierda tiende a +∞ y por la derecha a −∞ · [tramo-invertido] usas |x − 2| = x − 2 al acercarte por la izquierda y |x − 2| = −(x − 2) al acercarte por la derecha
- C) Existe y es −∞, porque cerca de 2 el denominador es negativo · [signo-del-infinito-sin-revisar] das el signo del denominador a la izquierda de 2 como si valiera también a la derecha
- D) No existe: por la izquierda tiende a −∞ y por la derecha a +∞ · CORRECTA

solución: si x < 2, |x − 2| = −(x − 2), así que el denominador (x − 2)|x − 2| es −(x − 2)², negativo y cercano a 0, mientras el numerador tiende a 7: el cociente tiende a −∞. Si x > 2, |x − 2| = x − 2 y el denominador es (x − 2)², positivo y cercano a 0: el cociente tiende a +∞. Los laterales son infinitos de signo opuesto, así que el límite no existe.

### P36 · dificultad 1 · kc: limite-trigonometrico · borrador · origen: ia (sonnet-5.5)
¿Cuál de estas afirmaciones es verdadera?

- A) $\lim_{x\to 0} \frac{\sen 7x}{x} = 1$ · [argumento-distinto-del-denominador] usas que sen u / u tiende a 1 aunque el denominador es x y no 7x, y no ajustas el factor 7
- B) $\lim_{x\to 0} \frac{\sen 7x}{x} = 7$ · CORRECTA
- C) $\lim_{x\to 0} \frac{\sen 7x}{x} = \sen 7$ · [cancela-x-con-seno] cancelas la x del denominador con la x del argumento del seno y evalúas lo que queda
- D) $\lim_{x\to 2} \frac{\sen x}{x} = 1$ · [limite-notable-lejos-de-cero] aplicas que sen u / u tiende a 1 aunque u se acerca a 2 y no a 0

solución: en B se escribe sen 7x / x = 7·sen(7x)/(7x) y, con u = 7x que tiende a 0, se usa que sen u / u tiende a 1: el límite es 7·1 = 7. En A se olvida el factor 7. En C se cancela una x que está dentro del seno, y eso no se puede hacer. En D, sen u / u tiende a 1 solo cuando u tiende a 0; aquí u = x tiende a 2, la función es continua allí y el límite se obtiene sustituyendo: sen 2 / 2, que no es 1.

### P37 · dificultad 2 · kc: limite-trigonometrico · borrador · origen: ia (sonnet-5.5)
¿Cuánto vale $\lim_{x\to\infty} \frac{\sen 6x}{3x}$ y por qué?

- A) 2, porque $\frac{\sen u}{u}$ tiende a 1 con u = 6x, y queda 2·1 · [limite-notable-lejos-de-cero] aplicas que sen u / u tiende a 1 aunque u = 6x crece sin límite y no se acerca a 0
- B) No existe, porque sen 6x oscila y el cociente no se estabiliza · [oscila-sin-encaje] dices que el cociente no tiene límite porque el numerador oscila, sin acotarlo con el teorema del encaje
- C) 0, porque $-\frac{1}{3x} \le \frac{\sen 6x}{3x} \le \frac{1}{3x}$ y las dos cotas tienden a 0 · CORRECTA
- D) No existe, porque $-1 \le \frac{\sen 6x}{3x} \le 1$ y las cotas −1 y 1 son distintas · [encaje-cotas-distintas] usas el teorema del encaje con las cotas −1 y 1, cuyos límites no coinciden, y concluyes que no hay límite

solución: para x > 0 se cumple −1 ≤ sen 6x ≤ 1. Al dividir entre 3x, que es positivo, queda −1/(3x) ≤ sen 6x/(3x) ≤ 1/(3x). Cuando x tiende a ∞ las dos cotas tienden a 0, así que por el teorema del encaje el límite es 0. La opción A no sirve porque sen u / u tiende a 1 solo cuando u tiende a 0, y aquí u = 6x crece. En B, que el numerador oscile no impide el límite: el denominador crece y aplasta la oscilación. La opción D usa las cotas −1 y 1, que no coinciden, y con ellas el teorema del encaje no dice nada; hay que acotar con 1/(3x).

### P38 · dificultad 2 · kc: limite-trigonometrico · borrador · origen: ia (sonnet-5.5)
Todavía no se ha demostrado cuál es la derivada de sen x. ¿Cuál de estas es una justificación válida de que $\lim_{x\to 0} \frac{\sen x}{x} = 1$?

- A) Por L'Hôpital: la derivada del numerador es cos x, la del denominador es 1, y $\frac{\cos 0}{1} = 1$ · [lhopital-circular] justificas con L'Hôpital sin ver que derivar el seno ya usa este mismo límite
- B) Para x cerca de 0 se cumple $0 \le \frac{\sen x}{x} \le 1$, y por el teorema del encaje el límite es 1 · [encaje-cotas-distintas] usas el teorema del encaje con las cotas 0 y 1, cuyos límites son distintos
- C) Porque $\frac{\sen u}{u}$ tiende a 1 sin importar a qué valor se acerque u · [limite-notable-lejos-de-cero] aplicas que sen u / u tiende a 1 sin pedir que u tienda a 0
- D) Para x cerca de 0 se cumple $\cos x \le \frac{\sen x}{x} \le 1$, y las dos cotas tienden a 1 (teorema del encaje) · CORRECTA

solución: la desigualdad cos x ≤ sen x / x ≤ 1 vale para x ≠ 0 cerca de 0 (sale de comparar áreas en el círculo unitario). Sus dos cotas tienden a 1 cuando x tiende a 0, y el teorema del encaje da el límite 1. La opción A es circular: la derivada del seno se obtiene precisamente de este límite. La opción B usa las cotas 0 y 1, cuyos límites son distintos, y con ellas el teorema del encaje no concluye nada. La opción C es falsa: sen u / u tiende a 1 solo cuando u tiende a 0, y con u cerca de π, por ejemplo, el cociente se acerca a 0.

### P39 · dificultad 3 · kc: limite-trigonometrico · borrador · origen: ia (sonnet-5.5)
Calcula $\lim_{x\to 0} \frac{\sen 4x + x^2 \cos(1/x)}{x}$

- A) 4 · CORRECTA
- B) 1 · [argumento-distinto-del-denominador] usas que sen u / u tiende a 1 con el sen 4x del numerador aunque el denominador es x y no 4x
- C) sen 4 · [cancela-x-con-seno] cancelas la x del denominador con la x del argumento de sen 4x y evalúas lo que queda
- D) No existe · [oscila-sin-encaje] dices que el límite no existe porque cos(1/x) oscila, sin acotar x² cos(1/x) con el teorema del encaje

solución: se separa en dos términos: sen 4x / x + x·cos(1/x). Primero: sen 4x / x = 4·sen(4x)/(4x) y, con u = 4x que tiende a 0, tiende a 4·1 = 4. Segundo: como −1 ≤ cos(1/x) ≤ 1, se tiene −|x| ≤ x·cos(1/x) ≤ |x|, y las dos cotas tienden a 0, así que por el teorema del encaje x·cos(1/x) tiende a 0. La suma es 4 + 0 = 4.

### P40 · dificultad 1 · kc: limites-infinito-asintotas · borrador · origen: ia (sonnet-5.5)
¿Cuál de estas afirmaciones es verdadera?

- A) $\lim_{x\to\infty} \frac{9x^2 + 2}{3x^2 - x} = 3$ · CORRECTA
- B) $\lim_{x\to\infty} (x^2 - x) = 0$ · [infinito-menos-infinito-cero] restas dos expresiones que tienden a infinito y concluyes que el resultado es 0
- C) $\lim_{x\to-\infty} \frac{\sqrt{x^2}}{x} = 1$ · [raiz-sin-signo-en-menos-infinito] escribes √(x²) como x aunque x es negativo, y el límite sale con el signo contrario
- D) $\lim_{x\to\infty} e^{-x} = \infty$ · [exponencial-limite-invertido] crees que e⁻ˣ crece sin límite cuando x crece

solución: en A, al dividir numerador y denominador entre x² queda (9 + 2/x²)/(3 − 1/x), que tiende a 9/3 = 3. En B, x² − x = x(x − 1) crece sin límite, no vale 0. En C, si x es negativo, √(x²) = |x| = −x, así que √(x²)/x = −1 y el límite es −1. En D, e⁻ˣ = 1/eˣ y eˣ crece sin límite, así que e⁻ˣ tiende a 0.

### P41 · dificultad 2 · kc: limites-infinito-asintotas · borrador · origen: ia (sonnet-5.5)
Sea $f(x) = \frac{2x^2 - 18}{(x - 3)\sqrt{x^2 + 4}}$. ¿Cuáles son sus asíntotas?

- A) Vertical x = 3; horizontales y = 2 e y = −2 · [vertical-por-denominador-cero] marcas x = 3 porque anula el denominador, aunque el factor x − 3 se cancela con el numerador
- B) Ninguna vertical; horizontales y = 2 e y = −2 · CORRECTA
- C) Ninguna vertical; una sola horizontal, y = 2 · [una-sola-horizontal] calculas el límite en +∞ y das esa horizontal sin calcular el límite en −∞
- D) Ninguna vertical; horizontales y = 1 e y = −1 · [mismo-grado-limite-uno] ves numerador y denominador del mismo grado y dices que el límite es 1 sin dividir los coeficientes principales

solución: se factoriza el numerador: 2x² − 18 = 2(x − 3)(x + 3). Para x ≠ 3, f(x) = 2(x + 3)/√(x² + 4). Cerca de x = 3 esa expresión tiende a 12/√13, un número finito, así que x = 3 no es asíntota vertical (y √(x² + 4) nunca se anula). Cuando x tiende a +∞, √(x² + 4) se comporta como x y f(x) tiende a 2x/x = 2. Cuando x tiende a −∞, √(x² + 4) se comporta como |x| = −x y f(x) tiende a 2x/(−x) = −2. Las horizontales son y = 2 e y = −2.

### P42 · dificultad 2 · kc: limites-infinito-asintotas · borrador · origen: ia (sonnet-5.5)
Sea $f(x) = \frac{5e^{x}}{e^{x} + 2}$. ¿Cuáles son sus asíntotas horizontales?

- A) Solo y = 5 · [una-sola-horizontal] das una sola horizontal sin calcular por separado el límite en −∞
- B) y = 0 cuando x → +∞ y y = 5 cuando x → −∞ · [exponencial-limite-invertido] crees que eˣ tiende a 0 cuando x crece y a infinito cuando x tiende a −∞
- C) y = 1 cuando x → +∞ y y = 0 cuando x → −∞ · [mismo-grado-limite-uno] ves eˣ arriba y abajo con el mismo crecimiento y dices que el cociente tiende a 1 sin dividir los coeficientes 5 y 1
- D) y = 5 cuando x → +∞ y y = 0 cuando x → −∞ · CORRECTA

solución: f(x) = 5eˣ/(eˣ + 2) = 5/(1 + 2e⁻ˣ). Cuando x tiende a +∞, e⁻ˣ tiende a 0 y f(x) tiende a 5. Cuando x tiende a −∞, eˣ tiende a 0 y f(x) tiende a 5·0/(0 + 2) = 0. Son dos horizontales distintas: y = 5 por la derecha y y = 0 por la izquierda.

### P43 · dificultad 3 · kc: limites-infinito-asintotas · borrador · origen: ia (sonnet-5.5)
¿Cuál de estas afirmaciones es verdadera?

- A) $\lim_{x\to-\infty} \left(\sqrt{x^2 + 8x} + x\right) = -4$ · CORRECTA
- B) $\lim_{x\to\infty} \left(\sqrt{x^2 + 6x} - x\right) = 0$ · [infinito-menos-infinito-cero] restas dos expresiones que tienden a infinito y concluyes que el límite es 0, sin racionalizar
- C) $\lim_{x\to-\infty} \frac{3x - 1}{\sqrt{x^2 + 5}} = 3$ · [raiz-sin-signo-en-menos-infinito] tomas √(x²) como x en −∞, donde vale −x, y el límite sale con el signo contrario
- D) La gráfica de $f(x) = \frac{x^2 - 49}{x^2 - 5x - 14}$ tiene asíntotas verticales en x = 7 y en x = −2 · [vertical-por-denominador-cero] marcas x = 7 porque anula el denominador, aunque el factor x − 7 se cancela con el numerador

solución: en A se racionaliza: (√(x² + 8x) + x)(√(x² + 8x) − x) = 8x, así que la expresión es 8x/(√(x² + 8x) − x). Si x es negativo, al dividir numerador y denominador entre x, √(x² + 8x)/x = −√(1 + 8/x), y queda 8/(−√(1 + 8/x) − 1), que tiende a 8/(−2) = −4. En B, con el mismo método, √(x² + 6x) − x = 6x/(√(x² + 6x) + x), que tiende a 6/(1 + 1) = 3, no a 0. En C, si x es negativo, √(x² + 5) se comporta como −x y el cociente tiende a 3x/(−x) = −3. En D, el numerador es (x − 7)(x + 7) y el denominador es (x − 7)(x + 2), así que f(x) = (x + 7)/(x + 2) para x ≠ 7: solo x = −2 es asíntota vertical, y en x = 7 hay un hueco donde la función tiende a 14/9.
