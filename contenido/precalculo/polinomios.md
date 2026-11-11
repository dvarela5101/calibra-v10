# Polinomios

Operaciones con polinomios: suma, resta y multiplicación (con productos notables) y división larga y sintética con cociente y residuo. Cae en el Parcial 1 (semana 4).

## Habilidades
kc: operar-polinomios · Sumar, restar y multiplicar polinomios, incluidos los productos notables · prerrequisitos: exponentes-enteros
kc: division-polinomios · Dividir polinomios con división larga o sintética y dar el cociente y el residuo · prerrequisitos: operar-polinomios

## Errores
mc: cuadrado-binomio-sin-doble-producto · operar-polinomios · desarrollas (a ± b)² como a² ± b² y te olvidas del término del doble producto
mc: resta-signo-solo-primer-termino · operar-polinomios · al restar un polinomio cambias el signo solo de su primer término y dejas los demás como estaban
mc: multiplica-exponentes-al-multiplicar-potencias · operar-polinomios · al multiplicar potencias de la misma base multiplicas los exponentes en vez de sumarlos
mc: cubo-binomio-sin-terminos-mixtos · operar-polinomios · desarrollas (a ± b)³ como a³ ± b³ y olvidas los términos 3a²b y 3ab²
mc: distribuye-solo-sobre-un-termino · operar-polinomios · al multiplicar por un polinomio de varios términos multiplicas solo uno de ellos y copias el resto sin multiplicar
mc: negativo-por-negativo-queda-negativo · operar-polinomios · al multiplicar dos términos negativos, o al elevar uno al cuadrado, dejas el producto negativo
mc: resta-parcial-sumada-en-division-larga · division-polinomios · en la división larga sumas el producto parcial al dividendo en vez de restarlo, y los términos que no son el líder quedan mal
mc: raiz-con-signo-contrario-al-sintetizar · division-polinomios · en la división sintética por x − a usas −a, o por x + a usas a, en vez de la raíz del divisor
mc: omite-coeficiente-cero-en-sintetica · division-polinomios · en la división sintética no escribes un 0 para la potencia que falta en el dividendo y se te corren los coeficientes
mc: residuo-como-coeficiente-del-cociente · division-polinomios · lees todos los números de la última fila de la división sintética como coeficientes del cociente, incluido el residuo
mc: residuo-sumado-al-cociente-sin-dividir · division-polinomios · escribes el resultado como cociente más residuo, sin dividir el residuo entre el divisor
mc: cociente-por-primer-termino-del-divisor · division-polinomios · en la división larga multiplicas cada término del cociente solo por el primer término del divisor y olvidas los demás

## Preguntas

### P16 · dificultad 1 · kc: operar-polinomios · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Desarrolla −2x³(x² − 5).

- A) −2x⁵ − 10x³ · [negativo-por-negativo-queda-negativo] multiplicas −2x³ por −5 y el producto te queda −10x³
- B) −2x⁵ + 10x³ · CORRECTA
- C) −2x⁵ − 5 · [distribuye-solo-sobre-un-termino] multiplicas −2x³ solo por x² y copias el −5 sin multiplicarlo
- D) −2x⁶ + 10x³ · [multiplica-exponentes-al-multiplicar-potencias] al multiplicar x³ por x² multiplicas los exponentes (3·2 = 6) en vez de sumarlos

solución: se distribuye −2x³ sobre cada término del paréntesis. Primero, (−2x³)(x²) = −2x⁵, porque al multiplicar potencias de x los exponentes se suman (3 + 2 = 5). Segundo, (−2x³)(−5) = +10x³, porque negativo por negativo es positivo. El resultado es −2x⁵ + 10x³.

### P17 · dificultad 2 · kc: operar-polinomios · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Calcula el producto (x − 2)(x² + 3x − 4).

- A) −x² − 7x + 8 · [multiplica-exponentes-al-multiplicar-potencias] al multiplicar potencias de x multiplicas los exponentes: x·x² te da x², no x³
- B) x³ + 3x² − 4x − 2 · [distribuye-solo-sobre-un-termino] multiplicas solo la x del primer factor por el trinomio y copias el −2 sin multiplicarlo
- C) x³ + x² − 10x − 8 · [negativo-por-negativo-queda-negativo] multiplicas −2 por −4 y el producto te queda −8 en vez de +8
- D) x³ + x² − 10x + 8 · CORRECTA

solución: se multiplica cada término de x − 2 por cada término del trinomio. Con x: x³ + 3x² − 4x. Con −2: −2x² − 6x + 8, porque (−2)(−4) = +8. Se suman los dos resultados y se agrupan los términos semejantes: x³ + (3 − 2)x² + (−4 − 6)x + 8 = x³ + x² − 10x + 8.

### P18 · dificultad 2 · kc: operar-polinomios · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Simplifica (x + 1)³ − (x − 1)².

- A) x³ + 2x² + 5x · CORRECTA
- B) x³ − x² + 2x · [cubo-binomio-sin-terminos-mixtos] desarrollas (x + 1)³ como x³ + 1 y olvidas los términos 3x² y 3x
- C) x³ + 2x² + 3x · [cuadrado-binomio-sin-doble-producto] desarrollas (x − 1)² como x² + 1 y olvidas el término −2x
- D) x³ + 2x² + x + 2 · [resta-signo-solo-primer-termino] al restar (x² − 2x + 1) cambias el signo solo de x² y dejas −2x + 1 como estaba

solución: se desarrolla cada potencia por separado. El cuadrado es (x − 1)² = 1 − 2x + x², y el cubo (x + 1)³ aporta los términos 1, 3x, 3x² y x³. Restar el cuadrado invierte el signo de sus tres términos: se resta 1, se suma 2x y se resta x². Por grados: las constantes dan 1 − 1 = 0, las x dan 3 + 2 = 5, las x² dan 3 − 1 = 2 y x³ queda igual. El resultado es x³ + 2x² + 5x.

### P19 · dificultad 2 · kc: operar-polinomios · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Desarrolla (x − 2)³.

- A) x³ − 8 · [cubo-binomio-sin-terminos-mixtos] desarrollas el cubo como x³ + (−2)³ y olvidas los términos mixtos 3x²(−2) y 3x(−2)²
- B) x³ − 6x² − 12x − 8 · [negativo-por-negativo-queda-negativo] calculas (−2)² como −4 y el término 3x(−2)² te queda −12x
- C) x³ − 6x² + 12x − 8 · CORRECTA
- D) x³ − 4x² + 4x − 2 · [distribuye-solo-sobre-un-termino] después de elevar al cuadrado multiplicas solo la x del otro factor por el trinomio y copias el −2

solución: se escribe (x − 2)³ = (x − 2)²(x − 2) con (x − 2)² = x² − 4x + 4. Al multiplicar queda x³ − 4x² + 4x − 2x² + 8x − 8, y al sumar los términos semejantes resulta x³ − 6x² + 12x − 8.

### P20 · dificultad 3 · kc: operar-polinomios · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Simplifica (3x − 2)(x² − 2x + 5) − x(x − 3)².

- A) 2x³ − 14x² + 28x − 10 · [resta-signo-solo-primer-termino] al restar x(x − 3)² ya desarrollado cambias el signo solo de su primer término, x³, y dejas −6x² + 9x como estaba
- B) 2x³ − 2x² + 10x − 10 · CORRECTA
- C) 2x³ − 8x² + 10x − 10 · [cuadrado-binomio-sin-doble-producto] desarrollas (x − 3)² como x² + 9 y olvidas el término −6x
- D) 2x³ − 2x² + 2x − 10 · [negativo-por-negativo-queda-negativo] en el primer producto calculas (−2)(−2x) como −4x en vez de +4x

solución: primer producto: (3x − 2)(x² − 2x + 5) = 3x³ − 6x² + 15x − 2x² + 4x − 10 = 3x³ − 8x² + 19x − 10. Segundo producto: (x − 3)² = x² − 6x + 9, así que x(x − 3)² = x³ − 6x² + 9x. Al restar se invierten los signos de sus tres términos: 3x³ − 8x² + 19x − 10 − x³ + 6x² − 9x = 2x³ − 2x² + 10x − 10.

### P21 · dificultad 1 · kc: division-polinomios · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Al dividir x² − 5x + 8 entre x − 3, el resultado, escrito como cociente más residuo sobre divisor, es:

- A) $x - 2 + 2$ · [residuo-sumado-al-cociente-sin-dividir] sumas el residuo 2 al cociente x − 2 sin dividirlo entre x − 3
- B) $x - 8 + \frac{32}{x - 3}$ · [raiz-con-signo-contrario-al-sintetizar] en la división sintética entre x − 3 usas −3 en vez de 3
- C) $x - 2 + \frac{2}{x - 3}$ · CORRECTA
- D) $x^2 - 2x + 2$ · [residuo-como-coeficiente-del-cociente] lees los tres números de la última fila (1, −2, 2) como coeficientes del cociente, incluido el residuo

solución: para dividir entre x − 3 se usa la raíz 3 en la división sintética. Coeficientes 1, −5, 8. Se baja el 1; 3 · 1 = 3 y −5 + 3 = −2; 3 · (−2) = −6 y 8 − 6 = 2. El cociente es x − 2 (los dos primeros números) y el residuo es 2 (el último). Entonces x² − 5x + 8 = (x − 3)(x − 2) + 2, y el resultado es x − 2 + 2/(x − 3).

### P22 · dificultad 2 · kc: division-polinomios · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
El resultado de dividir x³ − 2x² + 5x − 1 entre x² + 2 es:

- A) $4x + 1$ · [residuo-sumado-al-cociente-sin-dividir] sumas el residuo 3x + 3 al cociente x − 2 sin dividirlo entre x² + 2
- B) $x - 2 + \frac{3x + 3}{x^2 + 2}$ · CORRECTA
- C) $x - 2 + \frac{7x - 5}{x^2 + 2}$ · [resta-parcial-sumada-en-division-larga] en cada paso sumas el producto parcial al dividendo en vez de restarlo
- D) $x - 2 + \frac{5x - 1}{x^2 + 2}$ · [cociente-por-primer-termino-del-divisor] multiplicas cada término del cociente solo por x² y olvidas el +2 del divisor

solución: x³ ÷ x² = x. Se resta x(x² + 2) = x³ + 2x: queda −2x² + 3x − 1. Ahora −2x² ÷ x² = −2. Se resta −2(x² + 2) = −2x² − 4: queda 3x + 3, que tiene grado menor que el divisor y es el residuo. El cociente es x − 2, y el resultado es x − 2 + (3x + 3)/(x² + 2). Comprobación: (x − 2)(x² + 2) + 3x + 3 = x³ − 2x² + 2x − 4 + 3x + 3 = x³ − 2x² + 5x − 1.

### P23 · dificultad 2 · kc: division-polinomios · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Se divide x³ − 4x² + 5 entre x − 3 con división sintética. ¿Cuáles son el cociente y el residuo?

- A) cociente x² − 7x + 21, residuo −58 · [raiz-con-signo-contrario-al-sintetizar] usas −3 en la división sintética en vez de la raíz 3 del divisor
- B) cociente x − 1, residuo 2 · [omite-coeficiente-cero-en-sintetica] escribes solo los coeficientes 1, −4 y 5, sin el 0 que corresponde a x
- C) cociente x² − x − 3, residuo −4 · CORRECTA
- D) cociente x³ − x² − 3x − 4, residuo 0 · [residuo-como-coeficiente-del-cociente] lees los cuatro números de la última fila como coeficientes del cociente, incluido el residuo

solución: el dividendo no tiene término en x, así que sus coeficientes son 1, −4, 0, 5 y la raíz del divisor es 3. Se baja el 1; 3 · 1 = 3 y −4 + 3 = −1; 3 · (−1) = −3 y 0 − 3 = −3; 3 · (−3) = −9 y 5 − 9 = −4. Los tres primeros números son los coeficientes del cociente, que tiene un grado menos que el dividendo: x² − x − 3. El último número es el residuo: −4.

### P24 · dificultad 2 · kc: division-polinomios · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Al dividir x³ + 6x + 2 entre x + 4, el resultado, escrito como cociente más residuo sobre divisor, es:

- A) $x^2 - 4x - 64$ · [residuo-sumado-al-cociente-sin-dividir] sumas el residuo −86 al cociente x² − 4x + 22 sin dividirlo entre x + 4
- B) $x + 2 - \frac{6}{x + 4}$ · [omite-coeficiente-cero-en-sintetica] no escribes el 0 de x² en la fila de coeficientes y trabajas con 1, 6 y 2
- C) $x^2 - 4x + 22 - \frac{86}{x + 4}$ · CORRECTA
- D) $x^2 + 4x + 22 + \frac{90}{x + 4}$ · [raiz-con-signo-contrario-al-sintetizar] usas 4 en la división sintética, pero la raíz de x + 4 es −4

solución: x + 4 = x − (−4), así que la raíz es −4. El dividendo x³ + 0x² + 6x + 2 tiene coeficientes 1, 0, 6, 2. Se baja el 1; (−4)(1) = −4 y 0 − 4 = −4; (−4)(−4) = 16 y 6 + 16 = 22; (−4)(22) = −88 y 2 − 88 = −86. El cociente es x² − 4x + 22 y el residuo es −86, así que el resultado es x² − 4x + 22 − 86/(x + 4).

### P25 · dificultad 3 · kc: division-polinomios · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Al dividir x⁴ − 2x³ + 3x − 5 entre x² − x + 2, ¿cuáles son el cociente y el residuo?

- A) cociente x² − 2x, residuo 3x − 5 · [cociente-por-primer-termino-del-divisor] multiplicas cada término del cociente solo por x² y olvidas −x y +2 del divisor
- B) cociente x² − 3x + 5, residuo −8x + 5 · [resta-parcial-sumada-en-division-larga] en cada paso sumas el producto parcial al dividendo en vez de restarlo
- C) cociente x² + x − 2, residuo 0 · [residuo-sumado-al-cociente-sin-dividir] sumas el residuo 2x + 1 al cociente x² − x − 3 y das la suma como cociente
- D) cociente x² − x − 3, residuo 2x + 1 · CORRECTA

solución: primero se completa el dividendo con el término que falta, el de x², cuyo coeficiente es 0. Primer paso: x⁴ entre x² da x², y x²(x² − x + 2) = x⁴ − x³ + 2x², que al restarse deja −x³ − 2x² + 3x − 5. Segundo paso: −x³ entre x² da −x, y −x por el divisor da x² − 2x − x³, que al restarse deja −3x² + 5x − 5. Tercer paso: −3x² entre x² da −3, y −3(x² − x + 2) = −3x² + 3x − 6, que al restarse deja 2x + 1. Como su grado es menor que el del divisor, ahí termina: cociente x² − x − 3 y residuo 2x + 1. Para comprobar, el producto del divisor por el cociente es x⁴ − 2x³ + x − 6, y sumarle el residuo 2x + 1 devuelve el dividendo original.
