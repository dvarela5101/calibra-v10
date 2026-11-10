# Factorización

Factorización de polinomios: factor común, diferencia de cuadrados, trinomios de segundo grado, agrupación y sumas y diferencias de cubos, siempre hasta llegar a factores que ya no se pueden descomponer. Es del Parcial 1, semana 4.

## Habilidades
kc: factorizar-basico · Factorizar con factor común, diferencia de cuadrados y trinomios ax² + bx + c · prerrequisitos: operar-polinomios
kc: factorizar-avanzado · Factorizar por agrupación y con suma o diferencia de cubos hasta llegar a factores irreducibles · prerrequisitos: factorizar-basico

## Errores
mc: factor-comun-solo-numero · factorizar-basico · sacas solo el número del factor común y dejas la variable dentro del paréntesis
mc: factor-comun-solo-variable · factorizar-basico · sacas solo la variable del factor común y dejas el número dentro del paréntesis
mc: factor-comun-se-pierde · factorizar-basico · sacas el factor común y luego lo omites de la respuesta final, o borras el término que quedaba en 1
mc: suma-cuadrados-como-diferencia · factorizar-basico · factorizas una suma de cuadrados como si fuera una diferencia, con un factor (A + B) y otro (A − B)
mc: diferencia-cuadrados-sin-terminar · factorizar-basico · te detienes después de la primera diferencia de cuadrados y no ves que uno de los factores todavía se puede descomponer
mc: trinomio-sin-comprobar-termino-medio · factorizar-basico · armas factores que dan bien el primer y el último término, pero no compruebas que el término medio salga con el signo y el valor correctos
mc: trinomio-coeficiente-principal-mal-tratado · factorizar-basico · en un trinomio con coeficiente principal distinto de 1 usas factores con ax sin dividir entre a, o te olvidas de a
mc: cubos-signo-trinomio-intercambiado · factorizar-avanzado · en una suma o diferencia de cubos usas en el trinomio el signo que corresponde a la otra fórmula
mc: cubos-como-binomio-al-cubo · factorizar-avanzado · factorizas A³ ± B³ como (A ± B)³
mc: cubos-coeficiente-sin-elevar · factorizar-avanzado · al armar el trinomio de una suma o diferencia de cubos no elevas al cuadrado el coeficiente de A
mc: agrupacion-signo-segundo-grupo · factorizar-avanzado · al sacar el factor común del segundo grupo ignoras el signo negativo, y el paréntesis que sale es el contrario
mc: agrupacion-sin-binomio-comun · factorizar-avanzado · sacas el factor común de cada grupo pero no sacas el binomio que se repite, y dejas la expresión como una resta de dos términos
mc: trinomio-irreducible-factorizado · factorizar-avanzado · sigues factorizando el trinomio que sale de una fórmula de cubos como si fuera un cuadrado perfecto

## Preguntas

### P26 · dificultad 1 · kc: factorizar-basico · borrador · origen: ia (sonnet-5.5)
Factoriza por completo 6x² + 3x.

- A) 3(2x² + x) · [factor-comun-solo-numero] sacas solo el 3 y dejas una x dentro del paréntesis
- B) 3x(2x + 1) · CORRECTA
- C) x(6x + 3) · [factor-comun-solo-variable] sacas solo la x y dejas el 3 como factor común dentro del paréntesis
- D) 3x(2x) · [factor-comun-se-pierde] al dividir 3x entre el factor común 3x no dejas el 1 y borras ese término

solución: el máximo común divisor de 6 y 3 es 3, y la menor potencia de x es x, así que el factor común es 3x. Se divide cada término: 6x² ÷ 3x = 2x y 3x ÷ 3x = 1. Queda 3x(2x + 1). En A y en C el paréntesis conserva un factor común (x en A, 3 en C). En D falta el término 1: 3x·2x = 6x², que no es el polinomio.

### P27 · dificultad 2 · kc: factorizar-basico · borrador · origen: ia (sonnet-5.5)
Factoriza por completo 4x³ − 16x.

- A) 4(x³ − 4x) · [factor-comun-solo-numero] sacas solo el 4 y dejas la x dentro del paréntesis
- B) 4x(x² − 4) · [diferencia-cuadrados-sin-terminar] sacas 4x pero no ves que x² − 4 es una diferencia de cuadrados y te detienes ahí
- C) 4x(x + 2)(x − 2) · CORRECTA
- D) x(2x + 4)(2x − 4) · [factor-comun-solo-variable] sacas solo la x y factorizas 4x² − 16 sin sacar antes el 4, así que cada factor sigue teniendo un 2 en común

solución: el factor común de 4x³ y 16x es 4x. Queda 4x(x² − 4). Ahora x² − 4 = x² − 2² es una diferencia de cuadrados y vale (x + 2)(x − 2). La factorización completa es 4x(x + 2)(x − 2). Las opciones A, B y D son productos iguales al polinomio, pero ninguna está completa: en A sobra una x común, en B queda una diferencia de cuadrados y en D los dos factores de grado 1 todavía se pueden dividir entre 2.

### P28 · dificultad 2 · kc: factorizar-basico · borrador · origen: ia (sonnet-5.5)
Factoriza por completo 3x⁴ − 48.

- A) 3(x + 2)²(x − 2)² · [suma-cuadrados-como-diferencia] factorizas x² + 4 como (x + 2)(x − 2), igual que una diferencia de cuadrados
- B) (x² + 4)(x + 2)(x − 2) · [factor-comun-se-pierde] sacas el 3 como factor común y lo omites al escribir la respuesta final
- C) 3(x² + 4)(x² − 4) · [diferencia-cuadrados-sin-terminar] te detienes después de la primera diferencia de cuadrados y no ves que x² − 4 se puede descomponer
- D) 3(x² + 4)(x + 2)(x − 2) · CORRECTA

solución: se saca el factor común 3: 3x⁴ − 48 = 3(x⁴ − 16). Luego x⁴ − 16 = (x²)² − 4² = (x² + 4)(x² − 4). El factor x² − 4 es otra diferencia de cuadrados: (x + 2)(x − 2). El factor x² + 4 es una suma de cuadrados y no se puede factorizar. Resultado: 3(x² + 4)(x + 2)(x − 2). En A, (x + 2)(x − 2) = x² − 4, no x² + 4, así que el producto no da el polinomio.

### P29 · dificultad 2 · kc: factorizar-basico · borrador · origen: ia (sonnet-5.5)
Factoriza por completo 2x² + 10x + 12.

- A) 2(x + 2)(x + 3) · CORRECTA
- B) (x + 2)(x + 3) · [factor-comun-se-pierde] sacas el 2 como factor común y lo olvidas al escribir la respuesta
- C) 2(x − 2)(x − 3) · [trinomio-sin-comprobar-termino-medio] eliges −2 y −3 porque su producto es 6, sin comprobar que su suma sea +5
- D) (2x + 4)(2x + 6) · [trinomio-coeficiente-principal-mal-tratado] reemplazas 2x por z, factorizas z² + 10z + 24 como (z + 4)(z + 6) y no divides entre 2

solución: el 2 divide a los tres términos, así que 2x² + 10x + 12 = 2(x² + 5x + 6). Dentro del paréntesis hay que hallar dos números con producto 6 y suma 5, que son 2 y 3. El resultado es 2(x + 2)(x + 3). En B falta el 2: al multiplicar (x + 3)(x + 2) se obtiene x² + 5x + 6, que es la mitad del polinomio. En C, (x − 2)(x − 3) tiene suma −5. En D, (2x + 4)(2x + 6) = 4x² + 20x + 24, que es el doble del polinomio, porque faltó dividir entre 2.

### P30 · dificultad 3 · kc: factorizar-basico · borrador · origen: ia (sonnet-5.5)
Factoriza por completo 4x⁴ + 17x² + 4.

- A) (2x² + 1)(2x² + 4) · [trinomio-sin-comprobar-termino-medio] los extremos dan 4x⁴ y 4, pero no compruebas el término medio: sale 10x² y no 17x²
- B) (2x − 1)(x − 2)(2x + 1)(x + 2) · [suma-cuadrados-como-diferencia] tratas 4x² + 1 y x² + 4 como restas de cuadrados y las separas en binomios
- C) (4x² + 16)(4x² + 1) · [trinomio-coeficiente-principal-mal-tratado] reemplazas 4x² por z, factorizas z² + 17z + 16 como (z + 16)(z + 1) y no divides entre 4
- D) (4x² + 1)(x² + 4) · CORRECTA

solución: la expresión es un trinomio cuadrático en x². Sea z = 4x²; entonces 4x⁴ + 17x² + 4 equivale a (z² + 17z + 16)/4, que es (z + 16)(z + 1)/4. Al volver a x queda (4x² + 16)(4x² + 1)/4 = (x² + 4)(4x² + 1). Al multiplicar se recupera 4x⁴ + x² + 16x² + 4 = 4x⁴ + 17x² + 4. Ninguno de los dos factores se descompone más, porque ambos son sumas de cuadrados. En A, (2x² + 1)(2x² + 4) = 4x⁴ + 10x² + 4, y el término medio sale 10x² en vez de 17x². En B, (2x − 1)(x − 2)(2x + 1)(x + 2) = 4x⁴ − 17x² + 4, que tiene el signo contrario. En C falta dividir entre 4.

### P31 · dificultad 1 · kc: factorizar-avanzado · borrador · origen: ia (sonnet-5.5)
Factoriza por completo x³ + 27.

- A) (x + 3)³ · [cubos-como-binomio-al-cubo] factorizas la suma de cubos como el binomio (x + 3) elevado al cubo
- B) (x + 3)(x² − 3x + 9) · CORRECTA
- C) (x + 3)(x² + 3x + 9) · [cubos-signo-trinomio-intercambiado] pones en el trinomio el signo + que corresponde a la diferencia de cubos
- D) (x + 3)(x − 3)² · [trinomio-irreducible-factorizado] sigues factorizando x² − 3x + 9 como (x − 3)², cuando ese trinomio no se puede factorizar

solución: como 27 = 3³, el polinomio x³ + 27 es una suma de cubos con A = x y B = 3. Se aplica la identidad A³ + B³ = (A + B)(B² − AB + A²) y resulta el producto de x + 3 por x² − 3x + 9. El trinomio x² − 3x + 9 no tiene raíces reales (su discriminante es 9 − 36 < 0), así que no se factoriza más. En A, (x + 3)³ = x³ + 9x² + 27x + 27. En C, (x + 3)(x² + 3x + 9) = x³ + 6x² + 18x + 27. En D, (x − 3)² = x² − 6x + 9, que no es el trinomio.

### P32 · dificultad 2 · kc: factorizar-avanzado · borrador · origen: ia (sonnet-5.5)
Factoriza por completo 8x³ − 125.

- A) (2x − 5)³ · [cubos-como-binomio-al-cubo] factorizas la diferencia de cubos como el binomio (2x − 5) elevado al cubo
- B) (2x − 5)(2x² + 10x + 25) · [cubos-coeficiente-sin-elevar] al armar el trinomio escribes A² = 2x² en vez de (2x)² = 4x²
- C) (2x − 5)(4x² − 10x + 25) · [cubos-signo-trinomio-intercambiado] pones en el trinomio el signo − que corresponde a la suma de cubos
- D) (2x − 5)(4x² + 10x + 25) · CORRECTA

solución: 8x³ − 125 se escribe como (2x)³ − 5³, diferencia de cubos con A = 2x y B = 5. La identidad es A³ − B³ = (A − B)(B² + AB + A²), con A² = (2x)² = 4x², AB = 10x y B² = 25. Así se obtiene (2x − 5)(4x² + 10x + 25). El trinomio no tiene raíces reales (discriminante 100 − 400 < 0), por lo que no admite más factores. En B se olvidó elevar el 2 al cuadrado, y en C el signo del término medio es el de la suma de cubos.

### P33 · dificultad 2 · kc: factorizar-avanzado · borrador · origen: ia (sonnet-5.5)
Factoriza por completo 2x³ − 5x² − 8x + 20.

- A) (2x − 5)(x² + 4) · [agrupacion-signo-segundo-grupo] al sacar 4 de −8x + 20 ignoras el signo menos y escribes 4(2x − 5) en vez de −4(2x − 5)
- B) (2x − 5)(x − 2)(x + 2) · CORRECTA
- C) (2x − 5)(x² − 4) · [diferencia-cuadrados-sin-terminar] te detienes en x² − 4 y no ves que es una diferencia de cuadrados
- D) x²(2x − 5) − 4(2x − 5) · [agrupacion-sin-binomio-comun] sacas el factor común de cada grupo pero no sacas el binomio 2x − 5 que se repite

solución: se agrupa: (2x³ − 5x²) + (−8x + 20). Del primer grupo sale x²: x²(2x − 5). Del segundo sale −4: −4(2x − 5). Entonces x²(2x − 5) − 4(2x − 5) = (2x − 5)(x² − 4). Como x² − 4 es una diferencia de cuadrados, queda (2x − 5)(x − 2)(x + 2). La opción A cambia el signo del segundo grupo: (2x − 5)(x² + 4) = 2x³ − 5x² + 8x − 20. La opción C es igual al polinomio, pero le falta un paso. La opción D es igual al polinomio, pero sigue siendo una resta y no un producto.

### P34 · dificultad 2 · kc: factorizar-avanzado · borrador · origen: ia (sonnet-5.5)
Factoriza por completo 27x⁴ − x.

- A) x(3x − 1)(9x² + 3x + 1) · CORRECTA
- B) x(3x − 1)(3x² + 3x + 1) · [cubos-coeficiente-sin-elevar] al armar el trinomio escribes A² = 3x² en vez de (3x)² = 9x²
- C) x(3x − 1)(3x + 1)² · [trinomio-irreducible-factorizado] sigues factorizando 9x² + 3x + 1 como (3x + 1)², cuando ese trinomio no se puede factorizar
- D) (3x − 1)(9x² + 3x + 1) · [factor-comun-se-pierde] sacas la x como factor común y la omites al escribir la respuesta final

solución: el factor común de 27x⁴ y x es x: 27x⁴ − x = x(27x³ − 1). Ahora 27x³ − 1 = (3x)³ − 1³ es una diferencia de cubos con A = 3x y B = 1: (3x − 1)(9x² + 3x + 1). El trinomio no tiene raíces reales (discriminante 9 − 36 < 0). Resultado: x(3x − 1)(9x² + 3x + 1). En C, (3x + 1)² = 9x² + 6x + 1, que no es el trinomio. En D falta la x, así que el producto es 27x³ − 1.

### P35 · dificultad 3 · kc: factorizar-avanzado · borrador · origen: ia (sonnet-5.5)
Factoriza por completo x⁴ + 8x − x³ − 8.

- A) x(x³ + 8) − (x³ + 8) · [agrupacion-sin-binomio-comun] sacas el factor común de cada grupo pero no sacas el binomio x³ + 8 que se repite
- B) (x + 1)(x + 2)(x² − 2x + 4) · [agrupacion-signo-segundo-grupo] en −x³ − 8 sacas x³ + 8 sin el signo menos, así que escribes x(x³ + 8) + (x³ + 8)
- C) (x − 1)(x + 2)(x² − 2x + 4) · CORRECTA
- D) (x − 1)(x + 2)(x − 2)² · [trinomio-irreducible-factorizado] sigues factorizando x² − 2x + 4 como (x − 2)², cuando ese trinomio no se puede factorizar

solución: se agrupa (x⁴ + 8x) + (−x³ − 8). Del primer grupo sale x: x(x³ + 8). Del segundo sale −1: −(x³ + 8). Entonces x(x³ + 8) − (x³ + 8) = (x − 1)(x³ + 8). Ahora x³ + 8 = x³ + 2³ es una suma de cubos: (x + 2)(x² − 2x + 4). El trinomio no tiene raíces reales (discriminante 4 − 16 < 0). Resultado: (x − 1)(x + 2)(x² − 2x + 4). En D, (x − 2)² = x² − 4x + 4, que no es el trinomio.
