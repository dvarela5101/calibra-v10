# Funciones exponenciales y logarítmicas

Funciones exponenciales con sus transformaciones y modelos de interés y decaimiento, logaritmos con sus leyes y el cambio de base, y ecuaciones exponenciales y logarítmicas con la revisión del dominio. Es del Parcial 3 (semana 12).

## Habilidades
kc: exponenciales · Evaluar y graficar funciones exponenciales y usarlas en modelos de crecimiento, decaimiento e interés compuesto · prerrequisitos: exponentes-racionales, graficas-transformaciones
kc: propiedades-log · Evaluar logaritmos y usar sus leyes para expandir o combinar expresiones, y el cambio de base · prerrequisitos: exponenciales, inversa
kc: ecuaciones-exp-log · Resolver ecuaciones exponenciales y logarítmicas, descartando las soluciones que salen del dominio del logaritmo · prerrequisitos: propiedades-log

## Errores
mc: interes-sin-dividir-tasa-entre-periodos · exponenciales · en el interés compuesto usas la tasa anual completa en cada periodo en vez de dividirla entre el número de periodos por año
mc: exponente-sin-ajustar-al-periodo · exponenciales · usas el tiempo en años como exponente sin multiplicarlo por los periodos por año, o sin dividirlo entre la vida media
mc: exp-potencia-como-producto · exponenciales · calculas una potencia como si fuera un producto, por ejemplo 2³ como 2·3
mc: exp-coeficiente-entra-en-la-base · exponenciales · metes el coeficiente que multiplica a la exponencial dentro de la base, como si a·bˣ fuera (a·b)ˣ
mc: exp-traslacion-horizontal-invertida · exponenciales · lees x − h en el exponente como un desplazamiento a la izquierda, y evalúas con x + h
mc: exp-asintota-ignora-traslacion-vertical · exponenciales · dejas la asíntota horizontal en y = 0 aunque la gráfica esté desplazada hacia arriba o hacia abajo
mc: log-suma-es-suma-de-logs · propiedades-log · crees que el logaritmo de una suma es la suma de los logaritmos, o que una suma de logaritmos es el logaritmo de una suma
mc: log-cociente-es-cociente-de-logs · propiedades-log · conviertes el logaritmo de un cociente en el cociente de los logaritmos, o al revés
mc: log-potencia-sin-bajar-exponente · propiedades-log · escribes el logaritmo de una potencia como la potencia del logaritmo, en vez de bajar el exponente como factor
mc: cambio-base-invertido · propiedades-log · al cambiar de base pones el logaritmo de la base arriba y el del argumento abajo
mc: cambio-base-divide-entre-la-base · propiedades-log · cambias de base dividiendo el logaritmo del argumento entre la base misma, no entre su logaritmo
mc: exponente-y-coeficiente-no-se-intercambian · propiedades-log · al expandir no bajas el exponente del argumento, o al combinar no subes el coeficiente de un logaritmo como exponente
mc: log-a-exponencial-invertida · ecuaciones-exp-log · al pasar de forma logarítmica a exponencial intercambias la base y el valor del logaritmo
mc: suma-de-logs-sin-combinar · ecuaciones-exp-log · en una ecuación con una suma de logaritmos sumas los argumentos en vez de multiplicarlos
mc: solucion-extrana-sin-verificar-dominio · ecuaciones-exp-log · aceptas todas las raíces de la ecuación resultante sin comprobar que los argumentos de los logaritmos queden positivos
mc: exp-base-multiplica-al-exponente · ecuaciones-exp-log · al despejar escribes bˣ = c como b·x = c
mc: reescribe-base-sin-distribuir-el-exponente · ecuaciones-exp-log · al reescribir una potencia con la base común multiplicas solo la x por el exponente de la base y no todo el exponente
mc: iguala-exponentes-con-bases-distintas · ecuaciones-exp-log · igualas los exponentes sin reescribir las dos potencias con la misma base

## Preguntas

### P111 · dificultad 1 · kc: exponenciales · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Se depositan 1000 dólares al 10 % anual con capitalización semestral. ¿Cuánto dinero hay en la cuenta después de 1 año?

- A) 1102,50 dólares · CORRECTA
- B) 1210 dólares · [interes-sin-dividir-tasa-entre-periodos] aplicas el 10 % completo en cada semestre en vez del 5 %, y calculas 1000·(1,10)²
- C) 1050 dólares · [exponente-sin-ajustar-al-periodo] usas el 5 % por semestre pero con exponente 1, los años, en vez de los 2 semestres
- D) 2100 dólares · [exp-potencia-como-producto] calculas (1,05)² como 1,05·2 y resulta 1000·1,05·2

solución: cada semestre se aplica la mitad de la tasa anual: 10 %/2 = 5 %. En 1 año hay 2 semestres, así que el monto es 1000·(1,05)² = 1000·1,1025 = 1102,50 dólares.

### P112 · dificultad 2 · kc: exponenciales · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Sea $m(x) = 4\cdot 3^{x-2} - 1$. ¿Cuál es su asíntota horizontal y su intercepto con el eje y?

- A) Asíntota y = −1; intercepto −5/9 · CORRECTA
- B) Asíntota y = 0; intercepto −5/9 · [exp-asintota-ignora-traslacion-vertical] la gráfica está bajada una unidad, pero dejas la asíntota en el eje x
- C) Asíntota y = −1; intercepto 35 · [exp-traslacion-horizontal-invertida] evalúas con x + 2 en el exponente, y calculas 4·3² − 1
- D) Asíntota y = −1; intercepto −25 · [exp-potencia-como-producto] calculas 3⁻² como 3·(−2) = −6 y obtienes 4·(−6) − 1

solución: 3ˣ⁻² tiende a 0 cuando x tiende a −∞, así que m(x) tiende a −1 y la asíntota es y = −1. El intercepto es m(0) = 4·3⁻² − 1 = 4/9 − 1 = −5/9.

### P113 · dificultad 2 · kc: exponenciales · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Sea $k(x) = 3\cdot 2^{x-2} + 5$. ¿Cuál es su asíntota horizontal y cuánto vale k(4)?

- A) Asíntota y = 5; k(4) = 17 · CORRECTA
- B) Asíntota y = 0; k(4) = 17 · [exp-asintota-ignora-traslacion-vertical] la gráfica está subida 5 unidades, pero dejas la asíntota en y = 0
- C) Asíntota y = 5; k(4) = 197 · [exp-traslacion-horizontal-invertida] evalúas con x + 2 en el exponente y calculas 3·2⁶ + 5
- D) Asíntota y = 5; k(4) = 41 · [exp-coeficiente-entra-en-la-base] metes el 3 dentro de la base y calculas (3·2)² + 5

solución: 2ˣ⁻² tiende a 0 cuando x tiende a −∞, así que k(x) tiende a 5 y la asíntota es y = 5. Además k(4) = 3·2² + 5 = 12 + 5 = 17.

### P114 · dificultad 2 · kc: exponenciales · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Una muestra de 640 g de una sustancia radiactiva tiene una vida media de 5 días. ¿Cuántos gramos quedan después de 15 días?

- A) 80 g · CORRECTA
- B) 5/256 g · [exponente-sin-ajustar-al-periodo] usas los 15 días como exponente de 1/2 sin dividirlos entre la vida media, y calculas 640·(1/2)¹⁵
- C) 960 g · [exp-potencia-como-producto] calculas (1/2)³ como (1/2)·3 y resulta 640·(1/2)·3
- D) 32 768 000 g · [exp-coeficiente-entra-en-la-base] metes los 640 g dentro de la base y calculas (640·1/2)³

solución: en 15 días pasan 15/5 = 3 vidas medias. La cantidad es 640·(1/2)³ = 640/8 = 80 g.

### P115 · dificultad 3 · kc: exponenciales · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Se depositan 4000 dólares al 9 % anual con capitalización mensual durante 2,5 años. ¿Cuál expresión da el monto final?

- A) $4000\left(1+\frac{0.09}{12}\right)^{30}$ · CORRECTA
- B) $4000\,(1+0.09)^{30}$ · [interes-sin-dividir-tasa-entre-periodos] cuentas los 30 meses pero aplicas el 9 % completo en cada mes
- C) $4000\left(1+\frac{0.09}{12}\right)^{2.5}$ · [exponente-sin-ajustar-al-periodo] divides la tasa entre 12 pero dejas como exponente los 2,5 años en vez de los 30 meses
- D) $\left(4000\left(1+\frac{0.09}{12}\right)\right)^{30}$ · [exp-coeficiente-entra-en-la-base] metes el capital de 4000 dentro de la base y lo elevas a 30

solución: la tasa mensual es 0,09/12 = 0,0075 y en 2,5 años hay 12·2,5 = 30 meses. El monto es 4000(1 + 0,09/12)³⁰. El capital multiplica a la potencia, no entra en la base.

### P116 · dificultad 1 · kc: propiedades-log · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Para x > 0 y y > 0, ¿cuál de estas igualdades es verdadera?

- A) $\log(xy) = \log x + \log y$ · CORRECTA
- B) $\log(x+y) = \log x + \log y$ · [log-suma-es-suma-de-logs] distribuyes el logaritmo sobre una suma, como si fuera lineal
- C) $\log\frac{x}{y} = \frac{\log x}{\log y}$ · [log-cociente-es-cociente-de-logs] conviertes el logaritmo de un cociente en un cociente de logaritmos
- D) $\log_2 x = \frac{\log x}{2}$ · [cambio-base-divide-entre-la-base] cambias de base dividiendo entre 2, la base, y no entre log 2

solución: la ley del producto dice que log(xy) = log x + log y. En B, por ejemplo, con x = y = 10 queda log 20 ≈ 1,30 y log 10 + log 10 = 2. En C, con x = 100 y y = 10 queda log 10 = 1 y log 100 / log 10 = 2. En D, la fórmula correcta es log₂ x = log x / log 2; con x = 8 queda 3, mientras que log 8 / 2 ≈ 0,45.

### P117 · dificultad 2 · kc: propiedades-log · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Para calcular $\log_5 3$ con una calculadora que solo tiene el logaritmo natural, ¿cuál expresión usas?

- A) $\frac{\ln 3}{\ln 5}$ · CORRECTA
- B) $\frac{\ln 5}{\ln 3}$ · [cambio-base-invertido] pones el logaritmo de la base arriba y el del argumento abajo
- C) $\frac{\ln 3}{5}$ · [cambio-base-divide-entre-la-base] divides ln 3 entre 5, la base, y no entre ln 5
- D) $\ln\frac{3}{5}$ · [log-cociente-es-cociente-de-logs] tomas el cociente de los logaritmos como el logaritmo del cociente

solución: la fórmula de cambio de base es log_b a = ln a / ln b. Con a = 3 y b = 5 queda ln 3 / ln 5 ≈ 0,68. La opción B da el inverso, 1,46. La opción C da ≈ 0,22. La opción D da ln 0,6 ≈ −0,51, que ni siquiera es positivo.

### P118 · dificultad 2 · kc: propiedades-log · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Al expandir $\ln\frac{x^2 y}{z^3}$, con x, y y z positivos, se obtiene:

- A) $2\ln x + \ln y - 3\ln z$ · CORRECTA
- B) $(\ln x)^2 + \ln y - (\ln z)^3$ · [log-potencia-sin-bajar-exponente] escribes el logaritmo de una potencia como la potencia del logaritmo
- C) $\frac{2\ln x + \ln y}{3\ln z}$ · [log-cociente-es-cociente-de-logs] conviertes el logaritmo del cociente en un cociente de logaritmos
- D) $2\ln x + \ln y - \ln z$ · [exponente-y-coeficiente-no-se-intercambian] no bajas el exponente 3 de z³ y lo pierdes al expandir

solución: ln(x²y/z³) = ln(x²y) − ln(z³) = ln x² + ln y − ln z³ = 2 ln x + ln y − 3 ln z. Los exponentes bajan como coeficientes, y el cociente se vuelve una resta.

### P119 · dificultad 2 · kc: propiedades-log · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Con a, b y c positivos, la expresión $2\ln a + 3\ln b - \ln c$ es igual a:

- A) $\ln\frac{a^2 b^3}{c}$ · CORRECTA
- B) $\ln\frac{ab}{c}$ · [exponente-y-coeficiente-no-se-intercambian] no subes los coeficientes 2 y 3 como exponentes de a y de b
- C) $\ln\frac{a^2 + b^3}{c}$ · [log-suma-es-suma-de-logs] conviertes la suma de logaritmos en el logaritmo de una suma
- D) $\frac{\ln a^2 + \ln b^3}{\ln c}$ · [log-cociente-es-cociente-de-logs] tratas la resta de logaritmos como un cociente de logaritmos

solución: los coeficientes suben como exponentes: 2 ln a = ln a² y 3 ln b = ln b³. La suma se vuelve un producto: ln(a²b³). La resta de ln c se vuelve división entre c: ln(a²b³/c).

### P120 · dificultad 3 · kc: propiedades-log · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Si $\log_2 3 = p$, ¿cuánto vale $\log_9 8$ en términos de p?

- A) $\frac{3}{2p}$ · CORRECTA
- B) $\frac{2p}{3}$ · [cambio-base-invertido] pones log₂ 9 arriba y log₂ 8 abajo
- C) $\frac{3}{p}$ · [exponente-y-coeficiente-no-se-intercambian] escribes log₂ 9 como log₂ 3, sin subir el exponente 2 de 9 = 3² como coeficiente
- D) $\frac{3}{p^2}$ · [log-potencia-sin-bajar-exponente] escribes log₂ 3² como (log₂ 3)², la potencia del logaritmo, y no como 2·log₂ 3

solución: por cambio de base a base 2, log₉ 8 = log₂ 8 / log₂ 9. Como 8 = 2³, log₂ 8 = 3. Como 9 = 3², log₂ 9 = 2·log₂ 3 = 2p. Entonces log₉ 8 = 3/(2p).

### P121 · dificultad 1 · kc: ecuaciones-exp-log · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
¿Cuál de estas afirmaciones sobre la solución de cada ecuación es correcta?

- A) La solución de log₃ x = 4 es x = 3⁴ = 81 · CORRECTA
- B) La solución de log₃ x = 4 es x = 4³ = 64 · [log-a-exponencial-invertida] intercambias la base 3 y el valor 4 al pasar a forma exponencial
- C) La solución de 3ˣ = 20 cumple 3x = 20 · [exp-base-multiplica-al-exponente] cambias la potencia 3ˣ por el producto 3·x
- D) La solución de log₂ x + log₂ (x − 2) = 3 sale de x + (x − 2) = 8 · [suma-de-logs-sin-combinar] sumas los argumentos en vez de multiplicarlos

solución: log₃ x = 4 significa 3⁴ = x, o sea x = 81. En B se invirtieron base y valor. En C, 3ˣ = 20 se resuelve con logaritmos, x = log₃ 20 ≈ 2,73, mientras que 3x = 20 da 6,67. En D, la suma de logaritmos se convierte en el producto de los argumentos: x(x − 2) = 8.

### P122 · dificultad 2 · kc: ecuaciones-exp-log · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Resuelve $9^{x+1} = 27^{x-1}$.

- A) x = 5 · CORRECTA
- B) x = 4 · [reescribe-base-sin-distribuir-el-exponente] escribes 9ˣ⁺¹ como 3²ˣ⁺¹, y multiplicas solo la x por 2
- C) No tiene solución · [iguala-exponentes-con-bases-distintas] igualas los exponentes x + 1 = x − 1 sin reescribir las dos bases como potencias de 3
- D) x = 2 · [exp-base-multiplica-al-exponente] cambias las potencias por productos, 9(x + 1) = 27(x − 1), y despejas

solución: se escribe 9 = 3² y 27 = 3³: 3²⁽ˣ⁺¹⁾ = 3³⁽ˣ⁻¹⁾. Con la misma base, los exponentes son iguales: 2x + 2 = 3x − 3, así que x = 5. Se comprueba: 9⁶ = 3¹² = 531441 y 27⁴ = 3¹² = 531441.

### P123 · dificultad 2 · kc: ecuaciones-exp-log · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Resuelve $25^{x} = 125^{x-1}$.

- A) x = 3 · CORRECTA
- B) x = 1 · [reescribe-base-sin-distribuir-el-exponente] escribes 125ˣ⁻¹ como 5³ˣ⁻¹, y multiplicas por 3 solo la x
- C) No tiene solución · [iguala-exponentes-con-bases-distintas] igualas x = x − 1 sin reescribir las bases como potencias de 5
- D) x = 5/4 · [exp-base-multiplica-al-exponente] cambias las potencias por productos, 25x = 125(x − 1), y despejas

solución: se escribe 25 = 5² y 125 = 5³: 5²ˣ = 5³⁽ˣ⁻¹⁾. Los exponentes son iguales: 2x = 3x − 3, así que x = 3. Se comprueba: 25³ = 5⁶ y 125² = 5⁶.

### P124 · dificultad 2 · kc: ecuaciones-exp-log · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Resuelve $\log x + \log(x-3) = 1$ (logaritmo en base 10).

- A) x = 5 · CORRECTA
- B) $x = \frac{3+\sqrt{13}}{2}$ · [log-a-exponencial-invertida] conviertes log(x(x − 3)) = 1 en x(x − 3) = 1¹⁰ = 1 en vez de 10¹ = 10
- C) x = 13/2 · [suma-de-logs-sin-combinar] sumas los argumentos, x + (x − 3) = 10, en vez de multiplicarlos
- D) x = −2 y x = 5 · [solucion-extrana-sin-verificar-dominio] aceptas las dos raíces de x² − 3x − 10 = 0 sin ver que x = −2 deja argumentos negativos

solución: log x + log(x − 3) = log(x(x − 3)) = 1, así que x(x − 3) = 10¹ = 10. Queda x² − 3x − 10 = 0, que se factoriza como (x − 5)(x + 2) = 0. Con x = −2, los argumentos x y x − 3 son negativos, así que no sirve. Con x = 5 queda log 5 + log 2 = log 10 = 1.

### P125 · dificultad 3 · kc: ecuaciones-exp-log · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Resuelve $\log_2(x+1) + \log_2(x-3) = 5$.

- A) x = 7 · CORRECTA
- B) x = −5 y x = 7 · [solucion-extrana-sin-verificar-dominio] aceptas las dos raíces de x² − 2x − 35 = 0 sin ver que x = −5 deja argumentos negativos
- C) x = 17 · [suma-de-logs-sin-combinar] sumas los argumentos, (x + 1) + (x − 3) = 32, en vez de multiplicarlos
- D) $x = 1+\sqrt{29}$ · [log-a-exponencial-invertida] conviertes log₂(…) = 5 en (x + 1)(x − 3) = 5² = 25 en vez de 2⁵ = 32

solución: la suma de logaritmos se combina en un producto: log₂((x + 1)(x − 3)) = 5, así que (x + 1)(x − 3) = 2⁵ = 32. Queda x² − 2x − 35 = 0, o sea (x − 7)(x + 5) = 0. El dominio exige x + 1 > 0 y x − 3 > 0, es decir, x > 3. Por eso x = −5 se descarta y x = 7 sirve: log₂ 8 + log₂ 4 = 3 + 2 = 5.
