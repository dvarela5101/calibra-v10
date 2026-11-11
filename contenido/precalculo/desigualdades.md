# Desigualdades

Resolución de desigualdades lineales, dobles y con valor absoluto, y de desigualdades polinomiales y racionales con una tabla de signos, siempre con la solución escrita como intervalo o unión de intervalos. Cae en el Parcial 2 (semana 8).

## Habilidades
kc: desigualdades-lineales · Resolver desigualdades lineales, dobles y con valor absoluto y escribir la solución como intervalo · prerrequisitos: ecuaciones-lineales
kc: desigualdades-no-lineales · Resolver desigualdades polinomiales y racionales con una tabla de signos · prerrequisitos: desigualdades-lineales, factorizar-basico

## Errores
mc: desig-sentido-no-invertido · desigualdades-lineales · multiplicas o divides por un número negativo y dejas el sentido de la desigualdad como estaba
mc: desig-abs-menor-como-union · desigualdades-lineales · resuelves |u| < b o |u| ≤ b separando en u < −b o u > b, en vez de acotar u entre −b y b
mc: desig-abs-mayor-como-intervalo · desigualdades-lineales · resuelves |u| > b o |u| ≥ b acotando u entre −b y b, en vez de separar u < −b o u > b
mc: desig-abs-sin-aislar · desigualdades-lineales · separas el valor absoluto en dos casos sin haberlo aislado antes, con el coeficiente o el término suelto metidos dentro
mc: desig-extremo-cerrado-mal · desigualdades-lineales · cierras con corchete el extremo de una desigualdad estricta, o lo abres con paréntesis cuando la desigualdad incluye la igualdad
mc: desig-doble-operacion-a-medias · desigualdades-lineales · en una desigualdad doble sumas, restas o divides solo en el término del medio y dejas los extremos sin tocar
mc: desig-termino-pasa-sin-cambiar-signo · desigualdades-lineales · al pasar un número al otro lado de la desigualdad lo sumas o restas con el mismo signo que tenía, en vez de operar con su opuesto
mc: desig-divide-por-expresion-con-x · desigualdades-no-lineales · divides ambos lados entre una expresión con x como si fuera positiva y pierdes las soluciones donde esa expresión es negativa o cero
mc: desig-multiplica-por-denominador · desigualdades-no-lineales · pasas el denominador a multiplicar al otro lado sin cambiar el sentido, como si fuera siempre positivo
mc: desig-signos-contrarios-al-pedido · desigualdades-no-lineales · armas bien la tabla de signos pero tomas los tramos del signo contrario al que pide la desigualdad
mc: desig-cero-del-denominador-cerrado · desigualdades-no-lineales · cierras con corchete el valor que anula el denominador porque la desigualdad incluye la igualdad
mc: desig-factor-par-cambia-signo · desigualdades-no-lineales · crees que un factor elevado al cuadrado cambia de signo en su cero y alternas los signos de tramo en tramo
mc: desig-cada-factor-cumple · desigualdades-no-lineales · en un producto o un cociente le pides a cada factor por separado la desigualdad, en vez de combinar sus signos

## Preguntas

### P61 · dificultad 1 · kc: desigualdades-lineales · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Resuelve 5 − 3x ≥ 14 y escribe la solución como intervalo.

- A) [−3, ∞) · [desig-sentido-no-invertido] al dividir −3x ≥ 9 entre −3 dejas el ≥ como estaba
- B) (−∞, −3] · CORRECTA
- C) (−∞, −3) · [desig-extremo-cerrado-mal] resuelves bien pero abres el extremo −3, aunque la desigualdad incluye la igualdad
- D) (−∞, −19/3] · [desig-termino-pasa-sin-cambiar-signo] pasas el 5 al otro lado sumándolo y te queda −3x ≥ 19

solución: se resta 5 a ambos lados: −3x ≥ 9. Se divide entre −3, que es negativo, y el sentido se invierte: x ≤ −3. Como la desigualdad incluye la igualdad, el −3 está en la solución: (−∞, −3]. Comprobación: x = −3 da 5 + 9 = 14 ≥ 14, y x = 0 da 5, que no cumple.

### P62 · dificultad 2 · kc: desigualdades-lineales · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
El conjunto solución de |3x − 5| ≤ 7 es:

- A) (−∞, −2/3] ∪ [4, ∞) · [desig-abs-menor-como-union] separas en 3x − 5 ≤ −7 o 3x − 5 ≥ 7, como si fuera un "mayor que"
- B) [−7/3, 7/3] · [desig-doble-operacion-a-medias] en −7 ≤ 3x − 5 ≤ 7 sumas 5 solo al término del medio y dejas los extremos en −7 y 7
- C) [−2/3, 4] · CORRECTA
- D) [−4, 2/3] · [desig-termino-pasa-sin-cambiar-signo] en −7 ≤ 3x − 5 ≤ 7 restas 5 a los tres lados en vez de sumarlo

solución: |3x − 5| ≤ 7 equivale a −7 ≤ 3x − 5 ≤ 7. Se suma 5 a las tres expresiones: −2 ≤ 3x ≤ 12. Se divide entre 3: −2/3 ≤ x ≤ 4. La solución es [−2/3, 4]. Comprobación: x = 4 da |7| = 7 y x = −2/3 da |−7| = 7, ambos cumplen; x = 5 da 10 > 7.

### P63 · dificultad 2 · kc: desigualdades-lineales · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Resuelve |1 − 2x| > 5.

- A) (−2, 3) · [desig-abs-mayor-como-intervalo] acotas 1 − 2x entre −5 y 5, como si la desigualdad fuera "menor que"
- B) Todos los reales · [desig-sentido-no-invertido] separas 1 − 2x < −5 o 1 − 2x > 5 y al dividir entre −2 no inviertes: te quedan x < 3 o x > −2, que juntas cubren la recta
- C) (−∞, −2] ∪ [3, ∞) · [desig-extremo-cerrado-mal] separas bien los casos pero cierras los extremos, aunque la desigualdad es estricta
- D) (−∞, −2) ∪ (3, ∞) · CORRECTA

solución: |1 − 2x| > 5 equivale a 1 − 2x < −5 o 1 − 2x > 5. En el primer caso −2x < −6 y, al dividir entre −2, x > 3. En el segundo −2x > 4 y x < −2. La solución es (−∞, −2) ∪ (3, ∞). Comprobación: x = 4 da |−7| = 7 > 5 y x = 0 da 1, que no cumple; en x = 3 y x = −2 el valor absoluto es 5, que no es mayor que 5.

### P64 · dificultad 2 · kc: desigualdades-lineales · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Resuelve 2|x − 3| + 1 < 9.

- A) (−2, 7) · [desig-abs-sin-aislar] tratas toda la expresión como un valor absoluto: planteas −9 < 2(x − 3) + 1 < 9 sin aislar antes |x − 3|
- B) (−4, 4) · [desig-doble-operacion-a-medias] llegas a −4 < x − 3 < 4 y sumas 3 solo en el término del medio
- C) (−∞, −1) ∪ (7, ∞) · [desig-abs-menor-como-union] aíslas |x − 3| < 4 y lo separas en x − 3 < −4 o x − 3 > 4
- D) (−1, 7) · CORRECTA

solución: primero se aísla el valor absoluto. Se resta 1: 2|x − 3| < 8. Se divide entre 2: |x − 3| < 4. Eso equivale a −4 < x − 3 < 4. Se suma 3 a las tres expresiones: −1 < x < 7. La solución es (−1, 7). Comprobación: x = 0 da 2·3 + 1 = 7 < 9, y x = 7 da 2·4 + 1 = 9, que no es menor que 9.

### P65 · dificultad 3 · kc: desigualdades-lineales · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Resuelve 2|x/3 − 1| + 3 ≥ 7.

- A) (−∞, −3] ∪ [9, ∞) · CORRECTA
- B) [−3, 9] · [desig-abs-mayor-como-intervalo] aíslas |x/3 − 1| ≥ 2 y lo conviertes en −2 ≤ x/3 − 1 ≤ 2
- C) (−∞, −12] ∪ [9, ∞) · [desig-abs-sin-aislar] metes el 2 y el 3 dentro del valor absoluto: planteas |2(x/3 − 1) + 3| ≥ 7, o sea |2x/3 + 1| ≥ 7
- D) (−∞, −12] ∪ [18, ∞) · [desig-termino-pasa-sin-cambiar-signo] pasas el 3 al otro lado sumándolo: 2|x/3 − 1| ≥ 10, así que |x/3 − 1| ≥ 5

solución: se aísla el valor absoluto. Se resta 3: 2|x/3 − 1| ≥ 4. Se divide entre 2: |x/3 − 1| ≥ 2. Eso equivale a x/3 − 1 ≤ −2 o x/3 − 1 ≥ 2. En el primer caso x/3 ≤ −1 y x ≤ −3. En el segundo x/3 ≥ 3 y x ≥ 9. La solución es (−∞, −3] ∪ [9, ∞). Comprobación: x = −3 da 2·2 + 3 = 7, x = 9 da 2·2 + 3 = 7, x = 0 da 5 < 7.

### P66 · dificultad 1 · kc: desigualdades-no-lineales · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Resuelve x² < 6x.

- A) (−∞, 6) · [desig-divide-por-expresion-con-x] divides ambos lados entre x y te queda x < 6, sin ver que x puede ser negativo o cero
- B) (−∞, 0) ∪ (6, ∞) · [desig-signos-contrarios-al-pedido] factorizas x(x − 6) < 0 y armas bien los signos, pero tomas los tramos positivos
- C) (0, 6) · CORRECTA
- D) (−∞, 0) · [desig-cada-factor-cumple] pides que x < 0 y x − 6 < 0 a la vez, como si cada factor tuviera que ser negativo

solución: se pasa todo a un lado: x² − 6x < 0, es decir x(x − 6) < 0. El factor x es negativo para x < 0 y positivo para x > 0. El factor x − 6 es negativo para x < 6 y positivo para x > 6. El producto es negativo cuando los signos son distintos, o sea entre 0 y 6. La solución es (0, 6). Comprobación: x = 3 da 9 < 18, x = −1 da 1 < −6 que es falso y x = 7 da 49 < 42 que es falso.

### P67 · dificultad 2 · kc: desigualdades-no-lineales · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Resuelve (x − 2)²(x + 3) > 0.

- A) (−3, ∞) · [desig-divide-por-expresion-con-x] divides entre (x − 2)², que parece siempre positivo, y no ves que x = 2 anula el producto
- B) (−∞, −3) ∪ (2, ∞) · [desig-factor-par-cambia-signo] alternas los signos en x = 2, como si (x − 2)² cambiara de signo allí
- C) (−3, 2) ∪ (2, ∞) · CORRECTA
- D) (−∞, −3) · [desig-signos-contrarios-al-pedido] armas bien la tabla pero tomas el tramo negativo en vez del positivo

solución: el factor (x − 2)² es positivo para todo x ≠ 2 y vale 0 en x = 2, así que no cambia el signo del producto. Entonces el signo de (x − 2)²(x + 3) es el de x + 3 para x ≠ 2: positivo si x > −3 y negativo si x < −3. El producto vale 0 en x = −3 y en x = 2. Como se pide > 0, la solución es (−3, 2) ∪ (2, ∞). Comprobación: x = 0 da 4·3 = 12 > 0, x = 2 da 0 y x = −4 da 36·(−1) < 0.

### P68 · dificultad 2 · kc: desigualdades-no-lineales · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Resuelve $\frac{2x-1}{x+3} \le 0$.

- A) (−∞, 1/2] · [desig-multiplica-por-denominador] pasas x + 3 a multiplicar sin cambiar el sentido y queda 2x − 1 ≤ 0
- B) (−3, 1/2] · CORRECTA
- C) [−3, 1/2] · [desig-cero-del-denominador-cerrado] cierras el −3 porque la desigualdad incluye la igualdad, aunque ahí el denominador es 0
- D) (−∞, −3] · [desig-cada-factor-cumple] pides que el numerador y el denominador sean ≤ 0 a la vez

solución: el numerador 2x − 1 es negativo para x < 1/2, vale 0 en x = 1/2 y es positivo después. El denominador x + 3 es negativo para x < −3 y positivo después. El cociente es negativo cuando los signos son distintos, o sea para −3 < x < 1/2. En x = 1/2 el cociente vale 0 y cumple el ≤. En x = −3 el cociente no está definido y se excluye. La solución es (−3, 1/2]. Comprobación: x = 0 da −1/3 ≤ 0, x = 1 da 1/4 > 0 y x = −4 da (−9)/(−1) = 9 > 0.

### P69 · dificultad 2 · kc: desigualdades-no-lineales · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Resuelve $\frac{x+1}{x-2} \le 3$.

- A) [7/2, ∞) · [desig-multiplica-por-denominador] multiplicas por x − 2 como si fuera positivo y resuelves x + 1 ≤ 3(x − 2)
- B) (−∞, 2] ∪ [7/2, ∞) · [desig-cero-del-denominador-cerrado] llegas bien a la tabla pero cierras el 2, donde el denominador vale 0
- C) (2, 7/2] · [desig-signos-contrarios-al-pedido] armas bien la tabla de $\frac{7-2x}{x-2}$ pero tomas el tramo positivo en vez del negativo
- D) (−∞, 2) ∪ [7/2, ∞) · CORRECTA

solución: no se multiplica por x − 2, porque su signo cambia. Se pasa el 3 al lado izquierdo y se combina: $\frac{x+1}{x-2} - 3 = \frac{x + 1 - 3x + 6}{x-2} = \frac{7-2x}{x-2} \le 0$. El numerador 7 − 2x es positivo para x < 7/2 y negativo después. El denominador x − 2 es negativo para x < 2 y positivo después. El cociente es negativo para x < 2 (positivo sobre negativo) y para x > 7/2 (negativo sobre positivo), y vale 0 en x = 7/2. En x = 2 no está definido. La solución es (−∞, 2) ∪ [7/2, ∞). Comprobación: x = 0 da −1/2 ≤ 3, x = 3 da 4 > 3 y x = 4 da 5/2 ≤ 3.

### P70 · dificultad 3 · kc: desigualdades-no-lineales · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Resuelve x²(x² − 9) ≥ 0.

- A) (−∞, −3] ∪ [3, ∞) · [desig-divide-por-expresion-con-x] divides entre x² y resuelves x² − 9 ≥ 0, sin ver que x = 0 también cumple
- B) [−3, 0] ∪ [3, ∞) · [desig-factor-par-cambia-signo] alternas los signos en x = 0, como si x² cambiara de signo allí
- C) (−3, 0) ∪ (0, 3) · [desig-signos-contrarios-al-pedido] armas bien la tabla pero tomas los tramos negativos
- D) (−∞, −3] ∪ {0} ∪ [3, ∞) · CORRECTA

solución: se factoriza x² − 9 = (x − 3)(x + 3), así que el producto es x²(x − 3)(x + 3). El factor x² es positivo para x ≠ 0 y vale 0 en x = 0, sin cambiar de signo. El signo del producto es entonces el de (x − 3)(x + 3) para x ≠ 0: positivo si x < −3 o x > 3, y negativo si −3 < x < 3. Como se pide ≥ 0, entran los tramos positivos y los ceros x = −3, x = 3 y x = 0. La solución es (−∞, −3] ∪ {0} ∪ [3, ∞). Comprobación: x = 0 da 0 ≥ 0, x = 1 da −8 < 0 y x = 4 da 16·7 > 0.
