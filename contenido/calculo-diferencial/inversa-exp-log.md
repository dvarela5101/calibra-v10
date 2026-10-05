# Función inversa, exponencial y logaritmo

Cuándo una función tiene inversa, cómo se halla y cómo se resuelven las ecuaciones con exponenciales y logaritmos. Es del Parcial 1 (semana 2 del programa). De Precálculo hacen falta las ecuaciones, la ecuación cuadrática y las leyes de las potencias.

## Habilidades
kc: funcion-inversa · Decidir si una función es inyectiva y hallar su inversa · prerrequisitos: dominio-composicion
kc: ecuaciones-exp-log · Resolver ecuaciones exponenciales y logarítmicas con las leyes de potencias y logaritmos, y descartar las soluciones fuera del dominio · prerrequisitos: funcion-inversa, dominio-composicion

## Errores
mc: inversa-como-reciproco · funcion-inversa · confundes la inversa f⁻¹(x) con el recíproco 1/f(x)
mc: evalua-en-vez-de-resolver · funcion-inversa · para hallar f⁻¹(a) evalúas f en a en vez de resolver la ecuación f(x) = a
mc: funcion-implica-inyectiva · funcion-inversa · das por inyectiva a toda función, sin aplicar la prueba de la recta horizontal
mc: inversa-sin-restringir-dominio · funcion-inversa · inviertes una función que no es inyectiva y dejas un ± en la fórmula en vez de restringir el dominio
mc: dominio-inversa-es-dominio · funcion-inversa · das como dominio de la inversa el dominio de la función original en vez de su rango
mc: despeje-orden-mal · funcion-inversa · al despejar x deshaces las operaciones en el mismo orden en que se hicieron, no en el inverso
mc: log-suma-confundida · ecuaciones-exp-log · confundes ln(a + b) con ln a + ln b, tanto al separar como al combinar logaritmos
mc: coeficiente-log-en-argumento · ecuaciones-exp-log · pasas el coeficiente de un logaritmo como factor del argumento: escribes 2 ln x como ln(2x)
mc: ln-igual-uno-vale-uno · ecuaciones-exp-log · de ln A = 1 concluyes que A = 1 en vez de A = e
mc: iguala-exponentes-bases-distintas · ecuaciones-exp-log · igualas los exponentes de dos potencias aunque las bases son distintas
mc: no-deshace-sustitucion · ecuaciones-exp-log · resuelves la cuadrática en la variable auxiliar u, como u = 2ˣ, y entregas los valores de u como si fueran los de x
mc: no-descarta-fuera-dominio · ecuaciones-exp-log · das como solución un valor que no cumple la ecuación original: deja un logaritmo con argumento no positivo o iguala una exponencial a un número negativo

## Preguntas

### P21 · dificultad 1 · kc: funcion-inversa · borrador · origen: ia (sonnet-5.5)
La función $f(x) = (x - 2)^2 + 1$ está definida para todos los reales. ¿Cuál afirmación sobre su inversa es correcta?

- A) No tiene inversa en todo ℝ, porque f(1) = f(3): dos entradas distintas dan la misma salida · CORRECTA
- B) Sí tiene inversa, porque f es una función y cada x da un solo valor f(x) · [funcion-implica-inyectiva] crees que como f es una función ya tiene inversa, sin buscar dos entradas con la misma salida
- C) Sí tiene inversa, y es $f^{-1}(x) = 2 \pm \sqrt{x - 1}$ · [inversa-sin-restringir-dominio] despejas x y dejas el ± en la fórmula en vez de restringir el dominio de f
- D) Sí tiene inversa, y es $f^{-1}(x) = \frac{1}{(x - 2)^2 + 1}$ · [inversa-como-reciproco] tomas el recíproco 1/f(x) como si fuera la inversa

solución: f(1) = (1 − 2)² + 1 = 2 y f(3) = (3 − 2)² + 1 = 2. Hay dos entradas distintas con la misma salida: la recta horizontal y = 2 corta la parábola en dos puntos, así que f no es inyectiva y no tiene inversa en todo ℝ. Para tenerla habría que restringir el dominio, por ejemplo a x ≥ 2. La fórmula 2 ± √(x − 1) da dos valores de x para cada x > 1, y eso no es una función. El recíproco 1/f(x) tampoco es la inversa: por ejemplo, f(1/f(1)) = f(1/2) = 3,25, no 1.

### P22 · dificultad 2 · kc: funcion-inversa · borrador · origen: ia (sonnet-5.5)
Sea $f(x) = 2 + \frac{3}{x - 1}$ para $x \ne 1$. El valor de $f^{-1}(5)$ es:

- A) $-\frac{3}{2}$ · [despeje-orden-mal] deshaces los pasos de f en el mismo orden en que f los hizo: primero el −1, luego el cociente y al final el +2
- B) $\frac{4}{11}$ · [inversa-como-reciproco]
- C) 2 · CORRECTA
- D) $\frac{11}{4}$ · [evalua-en-vez-de-resolver]

solución: f⁻¹(5) es el x que cumple f(x) = 5. Entonces 2 + 3/(x − 1) = 5, 3/(x − 1) = 3, x − 1 = 1 y x = 2. Se comprueba: f(2) = 2 + 3/1 = 5. El valor 11/4 sale de calcular f(5) = 2 + 3/4, que evalúa f en vez de resolver f(x) = 5. El valor 4/11 es 1/f(5), el recíproco. Y −3/2 sale de sumar 1 a 5, invertir 3/u y restar 2, que es el orden de los pasos de f; para deshacerlos hay que empezar por el último, el +2.

### P23 · dificultad 2 · kc: funcion-inversa · borrador · origen: ia (sonnet-5.5)
Sea $f(x) = (x + 1)^2 - 4$ con dominio $x \le -1$. El valor de $f^{-1}(5)$ es:

- A) −4 o 2 · [inversa-sin-restringir-dominio]
- B) −4 · CORRECTA
- C) 32 · [evalua-en-vez-de-resolver]
- D) No existe, porque 5 no está en el dominio x ≤ −1 de f · [dominio-inversa-es-dominio] crees que f⁻¹ solo se puede evaluar en números del dominio de f, y no en los de su rango

solución: Se resuelve f(x) = 5: (x + 1)² − 4 = 5, (x + 1)² = 9, x + 1 = ±3, así que x = 2 o x = −4. El dominio pide x ≤ −1 y solo −4 lo cumple, por lo que f⁻¹(5) = −4. Existe porque 5 está en el rango de f: con x ≤ −1 el rango es [−4, ∞), y f⁻¹ recibe valores del rango de f, no de su dominio. El valor 32 sale de calcular f(5) = 36 − 4, no de resolver f(x) = 5.

### P24 · dificultad 3 · kc: funcion-inversa · borrador · origen: ia (sonnet-5.5)
Sea $f(x) = \ln(x^2 + 4)$ con dominio todos los reales. ¿Cuál afirmación es correcta?

- A) f es inyectiva en ℝ porque el logaritmo lo es, y su inversa es $f^{-1}(x) = \sqrt{e^x - 4}$ · [funcion-implica-inyectiva] crees que f es inyectiva porque el logaritmo lo es, sin mirar que x² + 4 repite valores
- B) Restringida a x ≥ 0, su inversa es $f^{-1}(x) = \sqrt{e^x - 4}$, con dominio $[0, \infty)$, el mismo de f restringida · [dominio-inversa-es-dominio]
- C) Restringida a x ≥ 0, su inversa es $f^{-1}(x) = e^{\sqrt{x} - 4}$ · [despeje-orden-mal] deshaces los pasos de f en su mismo orden (raíz, −4, exponencial) en vez de empezar por el logaritmo
- D) f no es inyectiva en ℝ, porque f(−1) = f(1); restringida a x ≥ 0, su inversa es $f^{-1}(x) = \sqrt{e^x - 4}$, con dominio $[\ln 4, \infty)$ · CORRECTA

solución: f(−1) = ln 5 = f(1), así que f no es inyectiva en ℝ: el logaritmo sí lo es, pero x² + 4 repite valores. En x ≥ 0 sí es inyectiva. Para hallar la inversa se despeja: y = ln(x² + 4), eʸ = x² + 4, x = √(eʸ − 4), y por tanto f⁻¹(x) = √(eˣ − 4). Su dominio es el rango de f en x ≥ 0: como x² + 4 ≥ 4, f(x) ≥ ln 4 y el rango es [ln 4, ∞). Con x = 0 la fórmula daría √(1 − 4), que no existe, así que el dominio no es [0, ∞). La fórmula e^(√x − 4) deshace los pasos de f en su mismo orden (raíz, −4, exponencial); el primero que hay que deshacer es el logaritmo, con la exponencial.

### P25 · dificultad 1 · kc: ecuaciones-exp-log · borrador · origen: ia (sonnet-5.5)
Resuelve para $x$: $2\ln(x + 1) = 2$

- A) 0 · [ln-igual-uno-vale-uno]
- B) $e - 1$ · CORRECTA
- C) $\frac{e^2 - 2}{2}$ · [coeficiente-log-en-argumento] metes el 2 dentro del logaritmo como factor: 2 ln(x + 1) = ln(2x + 2)
- D) $e$ · [log-suma-confundida] separas ln(x + 1) como ln x + ln 1 = ln x

solución: Se divide entre 2: ln(x + 1) = 1. Se aplica la exponencial: x + 1 = e, así que x = e − 1 ≈ 1,72, que cumple x + 1 > 0. El valor 0 sale de tomar x + 1 = 1. El valor (e² − 2)/2 sale de escribir 2 ln(x + 1) como ln(2x + 2) en vez de ln((x + 1)²). Y e sale de separar ln(x + 1) en ln x + ln 1 = ln x.

### P26 · dificultad 2 · kc: ecuaciones-exp-log · borrador · origen: ia (sonnet-5.5)
Resuelve para $x$: $4^x - 3\cdot 2^x - 10 = 0$

- A) $x = \log_2 5$ · CORRECTA
- B) $x = 5$ o $x = -2$ · [no-deshace-sustitucion]
- C) $x = \log_2 5$ o $x = \log_2(-2)$ · [no-descarta-fuera-dominio] no descartas 2ˣ = −2, que no tiene solución porque una exponencial siempre es positiva
- D) $x = 1$ · [iguala-exponentes-bases-distintas] de 2ˣ = 5 escribes 5 como 5¹ e igualas los exponentes de 2ˣ y 5¹

solución: Con u = 2ˣ (u > 0) se tiene 4ˣ = (2ˣ)² = u², y la ecuación queda u² − 3u − 10 = 0, que factoriza como (u − 5)(u + 2) = 0. Entonces u = 5 o u = −2. Como 2ˣ > 0, u = −2 no sirve. De 2ˣ = 5 sale x = log₂ 5 = ln 5 / ln 2 ≈ 2,32. Comprobación: 4ˣ = 25 y 3·2ˣ = 15, y 25 − 15 − 10 = 0. Dar x = 5 y x = −2 es entregar los valores de u como si fueran x. Incluir log₂(−2) es no descartar u = −2. Y x = 1 sale de escribir 5 = 5¹ e igualar los exponentes de dos potencias con bases distintas.

### P27 · dificultad 2 · kc: ecuaciones-exp-log · borrador · origen: ia (sonnet-5.5)
Resuelve para $x$: $3^{4x} - 12\cdot 3^{2x} + 35 = 0$

- A) $x = 5$ o $x = 7$ · [no-deshace-sustitucion]
- B) $x = \frac{1}{2}$ · [iguala-exponentes-bases-distintas] de 3²ˣ = 5 y 3²ˣ = 7 escribes 5 y 7 como potencias de exponente 1 e igualas los exponentes: 2x = 1
- C) $x = \frac{1}{2}\log_3 5$ o $x = \frac{1}{2}\log_3 7$ · CORRECTA
- D) $x = \log_3\frac{5}{2}$ o $x = \log_3\frac{7}{2}$ · [coeficiente-log-en-argumento] metes el factor 1/2 dentro del logaritmo: de (1/2)·log₃ 5 escribes log₃(5/2)

solución: Con u = 3²ˣ (u > 0) se tiene 3⁴ˣ = u², y la ecuación queda u² − 12u + 35 = 0, o sea (u − 5)(u − 7) = 0, con u = 5 o u = 7. Las dos son positivas y sirven. De 3²ˣ = 5 sale 2x = log₃ 5, es decir x = (1/2)·log₃ 5; con 7 pasa lo mismo. Comprobación: para x = (1/2)·log₃ 5, 3²ˣ = 5 y 3⁴ˣ = 25, y 25 − 60 + 35 = 0. Dar x = 5 y x = 7 es entregar los valores de u como si fueran x. Dar x = 1/2 sale de igualar los exponentes de potencias con bases distintas. Y log₃(5/2) no es lo mismo que (1/2)·log₃ 5 = log₃ √5, porque el factor 1/2 no entra al argumento como factor.

### P28 · dificultad 3 · kc: ecuaciones-exp-log · borrador · origen: ia (sonnet-5.5)
Resuelve para $x$: $\ln(x + 3) + \ln(x - 1) = 1$

- A) $x = \frac{e - 2}{2}$ · [log-suma-confundida] combinas ln(x + 3) + ln(x − 1) como ln(2x + 2), sumando los argumentos en vez de multiplicarlos
- B) $x = -1 + \sqrt{5}$ · [ln-igual-uno-vale-uno]
- C) $x = -1 \pm \sqrt{4 + e}$ · [no-descarta-fuera-dominio]
- D) $x = -1 + \sqrt{4 + e}$ · CORRECTA

solución: Los logaritmos exigen x + 3 > 0 y x − 1 > 0, o sea x > 1. Se combinan: ln((x + 3)(x − 1)) = 1, entonces (x + 3)(x − 1) = e, x² + 2x − 3 − e = 0, es decir (x + 1)² = 4 + e y x = −1 ± √(4 + e). La raíz con signo menos es negativa (≈ −3,59) y queda fuera de x > 1; la otra, ≈ 1,59, sirve. Dejar las dos raíces es no descartar la negativa. El valor −1 + √5 sale de igualar el producto a 1 (de ln A = 1 se concluye A = 1). Y (e − 2)/2 ≈ 0,36 sale de sumar los argumentos, y además queda fuera del dominio.
