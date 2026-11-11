# Funciones de varias variables

Coordenadas cilíndricas y esféricas, dominio, curvas de nivel y trazas de funciones de dos y tres variables, y límites y continuidad de funciones de dos variables. Es del Parcial 1 (semana 7 del programa).

## Habilidades
kc: coordenadas · Pasar puntos y ecuaciones entre coordenadas cartesianas, cilíndricas y esféricas · prerrequisitos: algebra-lineal/vectores
kc: dominio-niveles · Hallar el dominio de una función de varias variables y describir sus curvas o superficies de nivel y sus trazas
kc: limites-continuidad · Decidir si existe el límite de una función de dos variables en un punto, con trayectorias o con coordenadas polares, y si es continua · prerrequisitos: dominio-niveles, calculo-diferencial/limite-algebraico

## Errores
mc: cil-radio-sin-raiz · coordenadas · calculas r como x² + y², sin sacar la raíz, o reemplazas x² + y² por r en vez de por r²
mc: radio-cil-incluye-z · coordenadas · calculas el radio cilíndrico r con √(x² + y² + z²), como si fuera la distancia al origen y no la distancia al eje z
mc: angulo-sin-ajuste-cuadrante · coordenadas · calculas θ con arctan(y/x) y no ajustas el resultado al cuadrante donde está el punto
mc: rho-ignora-z · coordenadas · tomas ρ como la distancia al eje z, olvidando la coordenada z, o reemplazas x² + y² por ρ² sin el factor sen²φ
mc: phi-desde-plano-xy · coordenadas · mides φ desde el plano xy y no desde el eje z positivo, así que intercambias el seno y el coseno de φ
mc: coordenada-sin-factor-radial · coordenadas · al sustituir en una ecuación escribes cada coordenada sin el factor r o ρ que la acompaña
mc: ln-admite-cero · dominio-niveles · aceptas que el argumento de un logaritmo valga 0, es decir, exiges ≥ 0 en vez de > 0
mc: radicando-cero-mal-tratado · dominio-niveles · tratas mal el caso en que el radicando vale 0: lo excluyes cuando la raíz está en el numerador, o lo incluyes cuando está en el denominador
mc: restricciones-incompletas · dominio-niveles · impones solo algunas de las condiciones que exigen los distintos pedazos de la función y olvidas las demás
mc: cuadrado-a-lineal-sin-valor-absoluto · dominio-niveles · al resolver una desigualdad con cuadrados pasas de x² ≥ y² a x ≥ y, sin el valor absoluto
mc: radio-igual-a-la-constante · dominio-niveles · al describir una curva de nivel circular tomas como radio la constante del lado derecho, sin sacarle la raíz
mc: nivel-fuera-del-rango · dominio-niveles · dibujas una curva de nivel para un valor de c que la función nunca toma
mc: traza-confundida-con-nivel · dominio-niveles · confundes la traza en un plano vertical (x = k o y = k) con la curva de nivel, y le das la forma de una curva de nivel
mc: trayectoria-unica-basta · limites-continuidad · calculas el límite por una sola trayectoria y concluyes que ese es el valor del límite
mc: rectas-bastan · limites-continuidad · compruebas los ejes o las rectas y, como todas dan el mismo valor, concluyes que el límite existe sin probar curvas como las parábolas
mc: cero-sobre-cero-es-el-limite · limites-continuidad · al sustituir el punto queda 0/0 y lo tomas como el valor del límite, sin analizar la expresión
mc: polares-sin-contar-potencias-de-r · limites-continuidad · al pasar a polares no cuentas cuántas potencias de r quedan: si queda un factor r dices que no existe por depender de θ, y si no queda ninguno dices que vale 0
mc: continua-si-limite-existe · limites-continuidad · crees que basta con que el límite exista para que la función sea continua, sin comparar con el valor de f en el punto
mc: indefinida-en-el-punto-sin-limite · limites-continuidad · como la expresión no está definida en el punto, dices que el límite no existe

## Preguntas

### P17 · dificultad 1 · kc: coordenadas · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
El punto con coordenadas cartesianas (−2, 2, 1) tiene, en coordenadas cilíndricas (r, θ, z), con 0 ≤ θ < 2π, la forma:

- A) (2√2, −π/4, 1) · [angulo-sin-ajuste-cuadrante] calculas θ = arctan(2/(−2)) = −π/4 y no lo llevas al segundo cuadrante, donde está el punto
- B) (2√2, 3π/4, 1) · CORRECTA
- C) (8, 3π/4, 1) · [cil-radio-sin-raiz] calculas r como x² + y² = 8 y olvidas sacar la raíz
- D) (3, 3π/4, 1) · [radio-cil-incluye-z] calculas r con √(x² + y² + z²) = 3, que es la distancia al origen y no al eje z

solución: r = √(x² + y²) = √(4 + 4) = 2√2. El ángulo cumple tan θ = y/x = −1 y el punto tiene x < 0 e y > 0, así que está en el segundo cuadrante: θ = 3π/4 (arctan(−1) = −π/4 cae en el cuarto cuadrante). La altura no cambia: z = 1.

### P18 · dificultad 2 · kc: coordenadas · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
El punto con coordenadas cartesianas (−1, 1, √6) tiene, en coordenadas esféricas (ρ, θ, φ), con φ medido desde el eje z positivo y 0 ≤ θ < 2π, la forma:

- A) (√2, 3π/4, π/6) · [rho-ignora-z] tomas ρ = √(x² + y²) = √2 y olvidas la coordenada z
- B) (2√2, 3π/4, π/3) · [phi-desde-plano-xy] mides φ desde el plano xy, con sen φ = z/ρ, y obtienes π/3 en vez de π/6
- C) (2√2, 3π/4, π/6) · CORRECTA
- D) (2√2, −π/4, π/6) · [angulo-sin-ajuste-cuadrante] calculas θ = arctan(−1) = −π/4 y no lo llevas al segundo cuadrante

solución: ρ = √(1 + 1 + 6) = √8 = 2√2. El ángulo φ cumple cos φ = z/ρ = √6/(2√2) = √3/2, así que φ = π/6. Para θ: tan θ = −1 con x < 0 e y > 0, es decir, segundo cuadrante, y θ = 3π/4.

### P19 · dificultad 2 · kc: coordenadas · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
¿Qué ecuación en variables (r, θ, z) describe la superficie esférica x² + y² + z² = 6y?

- A) r² + z² = 6r sen θ · CORRECTA
- B) r² = 6r sen θ · [radio-cil-incluye-z] tomas r² como x² + y² + z², es decir, r como la distancia al origen, y la z desaparece
- C) r² + z² = 6 sen θ · [coordenada-sin-factor-radial] sustituyes y por sen θ y olvidas el factor r
- D) r + z² = 6r sen θ · [cil-radio-sin-raiz] reemplazas x² + y² por r en vez de por r²

solución: se sustituye con x = r cos θ, y = r sen θ y z = z; la suma x² + y² vale r². La ecuación de la esfera pasa entonces a r² + z² = 6r sen θ. La opción B omite z²; la C no multiplica por r el término de y; la D deja r donde debía ir r².

### P20 · dificultad 2 · kc: coordenadas · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
El paraboloide z = x² + y² se escribe en coordenadas esféricas, para ρ > 0, como:

- A) ρ = cos φ · [rho-ignora-z] reemplazas x² + y² por ρ², sin el factor sen²φ
- B) $\rho = \frac{\sen\varphi}{\cos^2\varphi}$ · [phi-desde-plano-xy] tomas z = ρ sen φ y x² + y² = ρ² cos²φ, midiendo φ desde el plano xy
- C) $\rho = \frac{\sen^2\varphi}{\cos\varphi}$ · [coordenada-sin-factor-radial] escribes x² + y² como sen²φ, sin el factor ρ²
- D) $\rho = \frac{\cos\varphi}{\sen^2\varphi}$ · CORRECTA

solución: en esféricas z = ρ cos φ y x² + y² = ρ² sen²φ. La ecuación queda ρ cos φ = ρ² sen²φ. Como ρ > 0, se divide entre ρ y se despeja: ρ = cos φ / sen²φ.

### P21 · dificultad 3 · kc: coordenadas · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
El hiperboloide x² + y² − z² = 1 se escribe en coordenadas esféricas como:

- A) ρ² cos 2φ = 1 · [phi-desde-plano-xy] mides φ desde el plano xy, con x² + y² = ρ² cos²φ y z² = ρ² sen²φ, y el signo del resultado queda invertido
- B) ρ² cos 2φ = −1 · CORRECTA
- C) cos 2φ = −1 · [coordenada-sin-factor-radial] escribes x² + y² y z² sin el factor ρ², y la ecuación pierde ρ
- D) ρ² sen²φ = 1 · [rho-ignora-z] reemplazas x² + y² por ρ² y z² por ρ² cos²φ, mezclando las dos descripciones

solución: en esféricas x² + y² = ρ² sen²φ y z² = ρ² cos²φ. La ecuación queda ρ²(sen²φ − cos²φ) = 1. Como sen²φ − cos²φ = −cos 2φ, resulta −ρ² cos 2φ = 1, es decir, ρ² cos 2φ = −1.

### P22 · dificultad 1 · kc: dominio-niveles · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
El dominio de $f(x,y) = \ln x + \sqrt{y}$ es:

- A) x ≥ 0 e y ≥ 0 · [ln-admite-cero] aceptas x = 0, donde ln x no está definido
- B) x > 0 e y > 0 · [radicando-cero-mal-tratado] excluyes y = 0, aunque √0 = 0 sí está definido
- C) x > 0 e y ≥ 0 · CORRECTA
- D) x > 0, sin condición sobre y · [restricciones-incompletas] impones la condición del logaritmo y olvidas que √y exige y ≥ 0

solución: ln x existe solo si x > 0. √y existe si y ≥ 0, y √0 = 0 sí está definido. Las dos condiciones valen a la vez: x > 0 e y ≥ 0.

### P23 · dificultad 2 · kc: dominio-niveles · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
El dominio de $f(x,y) = \frac{1}{\sqrt{x^2 - y^2}}$ es:

- A) |x| ≥ |y| · [radicando-cero-mal-tratado] incluyes los puntos donde x² − y² = 0, que anulan el denominador
- B) |x| > |y| · CORRECTA
- C) x > y · [cuadrado-a-lineal-sin-valor-absoluto] pasas de x² > y² a x > y, sin el valor absoluto
- D) x ≠ y y x ≠ −y · [restricciones-incompletas] solo evitas que el denominador sea 0 y olvidas que el radicando debe ser positivo

solución: la raíz está en el denominador, así que el radicando debe ser estrictamente positivo: x² − y² > 0, es decir, x² > y². Al sacar raíz cuadrada a ambos lados queda |x| > |y|. Por ejemplo, (1, −5) cumple x > y pero no está en el dominio, porque 1 − 25 < 0.

### P24 · dificultad 2 · kc: dominio-niveles · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
El dominio de $f(x,y) = \sqrt{x^2 - 1}\,\ln y$ es:

- A) |x| ≥ 1 e y > 0 · CORRECTA
- B) |x| > 1 e y > 0 · [radicando-cero-mal-tratado] excluyes x = ±1, aunque la raíz está en el numerador y √0 sí está definido
- C) x ≥ 1 e y > 0 · [cuadrado-a-lineal-sin-valor-absoluto] pasas de x² ≥ 1 a x ≥ 1 y pierdes la rama x ≤ −1
- D) |x| ≥ 1 e y ≥ 0 · [ln-admite-cero] aceptas y = 0, donde ln y no está definido

solución: la raíz exige x² − 1 ≥ 0, es decir, |x| ≥ 1 (x ≥ 1 o x ≤ −1); el valor x = ±1 sí vale porque √0 = 0. El logaritmo exige y > 0. El dominio es |x| ≥ 1 e y > 0.

### P25 · dificultad 2 · kc: dominio-niveles · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Sea f(x, y) = 9x² + 9y². ¿Cómo son sus curvas de nivel f(x, y) = c?

- A) Para c ≥ 0 son circunferencias centradas en el origen de radio c/3 · [radio-igual-a-la-constante] escribes el radio como c/3, sin sacarle la raíz a c
- B) Para c > 0 son circunferencias centradas en el origen de radio √c/3; para c = 0 es solo el origen, y para c < 0 no hay puntos · CORRECTA
- C) Para todo valor real de c son circunferencias centradas en el origen · [nivel-fuera-del-rango] dibujas niveles negativos, que la función nunca toma
- D) Son parábolas, porque al fijar x = k queda z = 9k² + 9y² · [traza-confundida-con-nivel] describes la traza en el plano x = k y la tomas por la curva de nivel

solución: la igualdad 9x² + 9y² = c equivale a x² + y² = c/9, que tiene puntos solo si c ≥ 0. Con c > 0 se obtiene la circunferencia de radio √c/3 (por ejemplo, c = 36 da radio 2, no 12). Con c = 0 queda únicamente el origen, y con c < 0 no hay ningún punto. Las parábolas z = 9k² + 9y² son trazas en planos verticales, no curvas de nivel.

### P26 · dificultad 3 · kc: dominio-niveles · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Sobre la superficie z = 9 − x² − y², ¿cuál afirmación es verdadera?

- A) Hay una curva de nivel z = 10, y es una circunferencia · [nivel-fuera-del-rango] no ves que la función nunca supera 9, así que ese nivel no existe
- B) La traza en el plano x = 2 es una circunferencia · [traza-confundida-con-nivel] describes la traza vertical como si fuera una curva de nivel
- C) La curva de nivel z = 0 es la circunferencia x² + y² = 9, de radio 3 · CORRECTA
- D) La curva de nivel z = 0 es una circunferencia de radio 9 · [radio-igual-a-la-constante] tomas el 9 de x² + y² = 9 como radio, sin sacarle la raíz

solución: con z = 0 queda 9 − x² − y² = 0, es decir x² + y² = 9, una circunferencia de radio 3. La función alcanza su máximo, 9, en el origen, así que el nivel z = 10 no tiene puntos. En el plano x = 2 la traza es z = 5 − y², que es una parábola y no una circunferencia.

### P27 · dificultad 1 · kc: limites-continuidad · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Sobre $\lim_{(x,y)\to(0,0)} \frac{xy}{x^2 + y^2}$, ¿cuál afirmación es correcta?

- A) No existe · CORRECTA
- B) Vale 0 · [rectas-bastan] ves que por el eje x y por el eje y el valor es 0, y concluyes que ese es el límite
- C) Vale 1/2 · [trayectoria-unica-basta] lo calculas solo por la recta y = x y das ese valor
- D) Vale 1 · [cero-sobre-cero-es-el-limite] al sustituir queda 0/0 y lo tomas como el valor 1

solución: por el eje x (y = 0) la función vale 0 en todo punto, así que el límite por esa trayectoria es 0. Por la recta y = x queda x²/(2x²) = 1/2. Como dos trayectorias dan valores distintos, el límite no existe.

### P28 · dificultad 2 · kc: limites-continuidad · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Sobre $\lim_{(x,y)\to(0,0)} \frac{x y^2}{x^2 + y^4}$, ¿cuál afirmación es correcta?

- A) Vale 0 · [rectas-bastan] por cada recta y = mx el límite es 0 y concluyes que vale 0, sin probar curvas
- B) Vale 1/2 · [trayectoria-unica-basta] lo calculas solo por la parábola x = y² y das ese valor
- C) No existe · CORRECTA
- D) Vale 1 · [cero-sobre-cero-es-el-limite] al sustituir queda 0/0 y lo tomas como el valor 1

solución: por y = mx queda m²x³/(x² + m⁴x⁴) = m²x/(1 + m⁴x²), que tiende a 0 para todo m. Pero por la parábola x = y² queda y⁴/(y⁴ + y⁴) = 1/2. Dos trayectorias dan valores distintos (0 y 1/2), así que el límite no existe.

### P29 · dificultad 2 · kc: limites-continuidad · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Sea f(x, y) = x²y/(x² + y²) para (x, y) ≠ (0, 0), y f(0, 0) = 1. ¿Cuál afirmación es correcta?

- A) El límite en (0, 0) es 1, porque al sustituir queda 0/0 y vale f(0, 0) · [cero-sobre-cero-es-el-limite] tomas el 0/0 como el valor que le asignan a f en el origen
- B) El límite en (0, 0) es 0 y f no es continua allí · CORRECTA
- C) El límite en (0, 0) es 0 y f es continua allí, porque el límite existe · [continua-si-limite-existe] no comparas el límite con f(0, 0) = 1
- D) El límite en (0, 0) no existe, porque en polares queda r cos²θ sen θ, que depende de θ · [polares-sin-contar-potencias-de-r] ves θ en el resultado pero no que está multiplicado por r, que tiende a 0

solución: en polares x²y/(x² + y²) = r³cos²θ sen θ / r² = r cos²θ sen θ. Como |cos²θ sen θ| ≤ 1, el valor absoluto es a lo sumo r, que tiende a 0, y por el teorema del encaje el límite es 0. Como f(0, 0) = 1 ≠ 0, f no es continua en el origen.

### P30 · dificultad 2 · kc: limites-continuidad · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Sea g(x, y) = (x² − y²)/(x − y) para x ≠ y. ¿Se puede definir g(1, 1) para que g sea continua en (1, 1)?

- A) No, porque g no está definida en (1, 1) · [indefinida-en-el-punto-sin-limite] como la expresión no está definida allí, dices que el límite no existe
- B) Sí, con g(1, 1) = 0 · [cero-sobre-cero-es-el-limite] sustituyes, queda 0/0 y lo tomas como el valor 0
- C) Sí, y g ya es continua en (1, 1) sin asignarle valor, porque el límite existe · [continua-si-limite-existe] crees que basta con que exista el límite para que haya continuidad
- D) Sí, con g(1, 1) = 2 · CORRECTA

solución: para x ≠ y, (x² − y²)/(x − y) = (x − y)(x + y)/(x − y) = x + y. Cuando (x, y) tiende a (1, 1), x + y tiende a 2, así que el límite existe y vale 2. Para que g sea continua en (1, 1) hay que asignar g(1, 1) = 2. Sin ese valor g no está definida en el punto y no puede ser continua allí.

### P31 · dificultad 3 · kc: limites-continuidad · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Sea f(x, y) = 2x²y²/(x⁴ + y⁴) para (x, y) ≠ (0, 0), y f(0, 0) = 0. ¿Cuál justificación es correcta sobre la continuidad de f en (0, 0)?

- A) No es continua: en polares queda $\frac{2\cos^2\theta\,\sen^2\theta}{\cos^4\theta + \sen^4\theta}$, que no depende de r y cambia con θ, así que el límite no existe · CORRECTA
- B) Es continua: en polares r tiende a 0 y por eso el cociente tiende a 0 = f(0, 0) · [polares-sin-contar-potencias-de-r] no ves que la r se cancela y no queda ningún factor que tienda a 0
- C) Es continua: por los dos ejes el límite es 0, igual que f(0, 0) · [rectas-bastan] solo miras los ejes y concluyes que el límite existe
- D) No es continua: la expresión no está definida en (0, 0), así que el límite no existe · [indefinida-en-el-punto-sin-limite] concluyes que no hay límite porque la fórmula da 0/0 en el origen

solución: en polares 2x²y²/(x⁴ + y⁴) = 2r⁴cos²θ sen²θ / (r⁴(cos⁴θ + sen⁴θ)) = 2cos²θ sen²θ / (cos⁴θ + sen⁴θ): la r se cancela del todo. Con θ = 0 el valor es 0 y con θ = π/4 es 2(1/4)/(1/2) = 1. Dos trayectorias dan valores distintos, así que el límite no existe y f no es continua en el origen. Que la fórmula no esté definida allí no es lo que decide: g(x, y) = (x² − y²)/(x − y) tampoco lo está en (1, 1) y sí tiene límite.
