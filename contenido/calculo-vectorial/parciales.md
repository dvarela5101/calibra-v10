# Derivadas parciales, plano tangente y gradiente

Derivadas parciales y regla de la cadena, plano tangente y linealización, gradiente y derivada direccional (secciones 2.3 a 2.6 y 3.1 a 3.2 del libro guía). Es del Parcial 1, semana 7. Errores a cazar: derivar respecto a la variable equivocada, confundir el gradiente con la derivada direccional y olvidar normalizar el vector de dirección.

## Habilidades
kc: derivadas-parciales · Calcular derivadas parciales de primer y segundo orden, y derivar composiciones con la regla de la cadena en varias variables · prerrequisitos: calculo-diferencial/regla-cadena
kc: plano-tangente · Hallar el plano tangente a una gráfica o a una superficie de nivel y usar la linealización para aproximar valores · prerrequisitos: derivadas-parciales, algebra-lineal/vectores
kc: gradiente-direccional · Calcular el gradiente y la derivada direccional, y hallar la dirección y la tasa de máximo crecimiento · prerrequisitos: derivadas-parciales

## Errores
mc: parciales-e1 · derivadas-parciales · derivas respecto a y en lugar de x
mc: parciales-e2 · derivadas-parciales · olvidas evaluar en el punto dado
mc: parciales-e3 · derivadas-parciales · calculas el gradiente completo en lugar de la derivada parcial pedida
mc: parciales-e4 · gradiente-direccional · confundes las componentes del gradiente
mc: parciales-e5 · gradiente-direccional · confundes el gradiente con la derivada direccional en alguna dirección
mc: parciales-e6 · gradiente-direccional · derivas pero no evalúas correctamente en el punto
mc: parciales-e7 · gradiente-direccional · olvidas normalizar el vector de dirección
mc: parciales-e8 · gradiente-direccional · confundes la derivada direccional con el gradiente
mc: parciales-e9 · gradiente-direccional · normalizas pero luego calculas la magnitud del gradiente en lugar del producto punto
mc: parcial-compuesta-sin-derivada-interna · derivadas-parciales · al derivar una función compuesta omites multiplicar por la derivada de lo que va adentro
mc: cadena-multivariable-una-sola-ruta · derivadas-parciales · en la regla de la cadena con dos variables intermedias sumas solo la ruta de una de ellas
mc: cadena-multivariable-derivadas-cruzadas · derivadas-parciales · en la regla de la cadena multiplicas cada derivada parcial por la derivada de la otra variable intermedia
mc: plano-sin-valor-de-f · plano-tangente · armas el plano o la linealización con las pendientes pero omites el valor de la función en el punto
mc: plano-parciales-intercambiadas · plano-tangente · pones la parcial respecto a y como coeficiente de x y la parcial respecto a x como coeficiente de y
mc: plano-normal-grafica-con-mas-uno · plano-tangente · para la gráfica z = f(x, y) usas el vector normal (fₓ, f_y, 1) en lugar de (fₓ, f_y, −1)
mc: plano-nivel-igualado-al-valor-k · plano-tangente · en una superficie de nivel igualas el plano a la constante k en lugar de al producto punto del gradiente con el punto de tangencia
mc: plano-parciales-en-punto-equivocado · plano-tangente · evalúas las parciales en un punto distinto del de tangencia, con las coordenadas en otro orden
mc: linealizacion-incremento-con-signo-equivocado · plano-tangente · tomas con signo positivo un incremento que en realidad es negativo porque el punto nuevo queda por debajo del base
mc: maximo-gradiente-sin-norma · gradiente-direccional · para la tasa o la dirección de máximo crecimiento entregas el gradiente tal cual, sin su longitud o sin normalizarlo

## Preguntas

### P1 · dificultad 2 · kc: derivadas-parciales · revisada · origen: humano · revisó: prototipo · ⚠ revisar
Dada f(x,y) = x²y + y³, calcula $\frac{\partial f}{\partial x}$ en el punto (2,1).

- A) 4 · CORRECTA
- B) 7 · [parciales-e1]
- C) 4y · [parciales-e2]
- D) 2x + 3y² · [parciales-e3]

### P2 · dificultad 2 · kc: gradiente-direccional · revisada · origen: humano · revisó: prototipo · ⚠ revisar
Para f(x,y) = eˣʸ, el gradiente ∇f en (1,0) es:

- A) (0, 1) · CORRECTA
- B) (1, 0) · [parciales-e4]
- C) 0 · [parciales-e5]
- D) (e, 1) · [parciales-e6]

### P3 · dificultad 2 · kc: gradiente-direccional · revisada · origen: humano · revisó: prototipo · ⚠ revisar
La derivada direccional de f(x,y) = x² + y² en (1,1) en la dirección del vector (3,4) es:

- A) 2 · CORRECTA
- B) 10 · [parciales-e7]
- C) (2, 2) · [parciales-e8]
- D) 2√2 · [parciales-e9]

### P13 · dificultad 3 · kc: gradiente-direccional · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04 · ⚠ revisar
Sea f(x,y) = ln(x² + y²). La derivada direccional de f en el punto P(1, 2), en la dirección que va de P hacia el punto Q(4, −2), es:

- A) −2 · [parciales-e7] no divides el vector (3, −4) entre su longitud 5 antes de hacer el producto punto con el gradiente
- B) −2/5 · CORRECTA
- C) 2√5/5 · [parciales-e9] normalizas la dirección, pero entregas la magnitud del gradiente en lugar de su producto punto con ella
- D) (2/5, 4/5) · [parciales-e8] entregas el gradiente en P en lugar de su producto punto con la dirección unitaria

solución: el gradiente de f es $\nabla f = \left(\frac{2x}{x^2+y^2}, \frac{2y}{x^2+y^2}\right)$, que en P(1, 2) vale (2/5, 4/5).
La dirección de P hacia Q es v = Q − P = (3, −4), con longitud |v| = 5, así que el vector unitario es u = (3/5, −4/5).
La derivada direccional es ∇f(P)·u = (2/5)(3/5) + (4/5)(−4/5) = 6/25 − 16/25 = −10/25 = −2/5.
Las otras opciones salen de errores concretos: sin normalizar, (2/5)(3) + (4/5)(−4) = −2; la magnitud del gradiente es |∇f(P)| = 2√5/5; y (2/5, 4/5) es el gradiente mismo, no una derivada direccional.

### P32 · dificultad 1 · kc: derivadas-parciales · borrador · origen: ia (sonnet-5.5)
Para f(x, y) = x²y³ − 4xy + 2y⁴, calcula $\frac{\partial f}{\partial y}$ evaluada en (1, 2). El resultado es:

- A) 72 · CORRECTA
- B) 8 · [parciales-e1] derivas respecto a x en lugar de y: 2xy³ − 4y evaluado en (1, 2)
- C) (8, 72) · [parciales-e3] entregas el gradiente completo en el punto en lugar de la parcial respecto a y
- D) 3x²y² − 4x + 8y³ · [parciales-e2] derivas bien respecto a y pero dejas la expresión sin evaluarla en (1, 2)

solución: con x tratada como constante, $\frac{\partial f}{\partial y} = 3x^2y^2 - 4x + 8y^3$. Sustituyendo (1, 2): 3·1·4 − 4 + 8·8 = 12 − 4 + 64 = 72.

### P33 · dificultad 2 · kc: derivadas-parciales · borrador · origen: ia (sonnet-5.5)
Sea f(x, y) = x²·e³ʸ. La derivada parcial mixta $\frac{\partial^2 f}{\partial y\,\partial x}$ (primero respecto a x, luego respecto a y) en el punto (1, 0) es:

- A) 6 · CORRECTA
- B) 2 · [parcial-compuesta-sin-derivada-interna] al derivar e³ʸ respecto a y no multiplicas por 3 y queda 2x·e³ʸ
- C) 3 · [parciales-e1] derivas solo respecto a y y te quedas con f_y(1, 0) en lugar de la parcial mixta
- D) (2, 3) · [parciales-e3] entregas el gradiente (fₓ, f_y) en (1, 0) en lugar de la parcial mixta

solución: primero fₓ = 2x·e³ʸ. Luego se deriva respecto a y, y la derivada de e³ʸ es 3e³ʸ: f_xy = 6x·e³ʸ. En (1, 0) vale 6·1·1 = 6. Las otras opciones salen de omitir el factor 3 (2), de quedarse con f_y = 3x²e³ʸ = 3 y de dar el par (fₓ, f_y) = (2, 3).

### P34 · dificultad 2 · kc: derivadas-parciales · borrador · origen: ia (sonnet-5.5)
Sea w = x·y², con x = t³ y y = 2t + 1. El valor de $\frac{dw}{dt}$ en t = 1 es:

- A) 39 · CORRECTA
- B) 27 · [cadena-multivariable-una-sola-ruta] sumas solo la ruta por x, w_x·(dx/dt), y olvidas la ruta por y
- C) 15 · [parcial-compuesta-sin-derivada-interna] sumas w_x + w_y sin multiplicar por dx/dt ni por dy/dt
- D) 36 · [cadena-multivariable-derivadas-cruzadas] multiplicas w_x por dy/dt y w_y por dx/dt, en lugar de cada parcial por la derivada de su propia variable

solución: en t = 1 se tiene x = 1 y y = 3. Las parciales son w_x = y² = 9 y w_y = 2xy = 6. Las derivadas intermedias son dx/dt = 3t² = 3 y dy/dt = 2. Entonces dw/dt = w_x·dx/dt + w_y·dy/dt = 9·3 + 6·2 = 27 + 12 = 39. Se puede comprobar con w = t³(2t + 1)², cuya derivada en t = 1 es 3·9 + 1·2·3·2 = 39.

### P35 · dificultad 3 · kc: derivadas-parciales · borrador · origen: ia (sonnet-5.5)
Sea w = x²y, con x = s·t² y y = s² + t. El valor de $\frac{\partial w}{\partial t}$ en (s, t) = (1, 2) es:

- A) 112 · CORRECTA
- B) 96 · [cadena-multivariable-una-sola-ruta] incluyes solo el término que pasa por x y olvidas el que pasa por y
- C) 40 · [parcial-compuesta-sin-derivada-interna] sumas w_x + w_y sin multiplicar por ∂x/∂t ni por ∂y/∂t
- D) 88 · [cadena-multivariable-derivadas-cruzadas] multiplicas w_x por ∂y/∂t y w_y por ∂x/∂t

solución: en (1, 2) se tiene x = 1·4 = 4 y y = 1 + 2 = 3. Las parciales son w_x = 2xy = 24 y w_y = x² = 16. Las derivadas respecto a t son ∂x/∂t = 2st = 4 y ∂y/∂t = 1. Entonces ∂w/∂t = 24·4 + 16·1 = 96 + 16 = 112.

### P36 · dificultad 1 · kc: plano-tangente · borrador · origen: ia (sonnet-5.5)
El plano tangente a la gráfica de f(x, y) = x² + 3y² en el punto (1, 1, 4) es:

- A) z = 2x + 6y − 4 · CORRECTA
- B) z = 2x + 6y − 8 · [plano-sin-valor-de-f] escribes 2(x − 1) + 6(y − 1) y omites sumar el valor f(1, 1) = 4
- C) z = 6x + 2y − 4 · [plano-parciales-intercambiadas] usas 6 como coeficiente de (x − 1) y 2 como el de (y − 1)
- D) z = 12 − 2x − 6y · [plano-normal-grafica-con-mas-uno] usas el normal (fₓ, f_y, 1) y el plano queda con las pendientes de signo contrario

solución: fₓ = 2x y f_y = 6y, que en (1, 1) valen 2 y 6. El plano es z = f(1, 1) + fₓ(x − 1) + f_y(y − 1) = 4 + 2(x − 1) + 6(y − 1) = 2x + 6y − 4.

### P37 · dificultad 2 · kc: plano-tangente · borrador · origen: ia (sonnet-5.5)
El plano tangente a la superficie xy + yz + zx = 11 en el punto (1, 2, 3) es:

- A) 5x + 4y + 3z = 22 · CORRECTA
- B) 5x + 4y + 3z = 11 · [plano-nivel-igualado-al-valor-k] igualas el plano a la constante 11 de la superficie en lugar de a 5·1 + 4·2 + 3·3
- C) 4x + 5y + 3z = 23 · [plano-parciales-intercambiadas] pones la parcial respecto a y como coeficiente de x y la de x como coeficiente de y
- D) 3x + 4y + 5z = 26 · [plano-parciales-en-punto-equivocado] evalúas las parciales en (3, 2, 1) en lugar de (1, 2, 3)

solución: con F = xy + yz + zx, el gradiente es (y + z, x + z, x + y), que en (1, 2, 3) vale (5, 4, 3). El plano es 5(x − 1) + 4(y − 2) + 3(z − 3) = 0, es decir 5x + 4y + 3z = 5 + 8 + 9 = 22. Comprobación: el punto cumple 5 + 8 + 9 = 22.

### P38 · dificultad 2 · kc: plano-tangente · borrador · origen: ia (sonnet-5.5)
Con la aproximación lineal de la función f(x, y) = √(y² + x²) cerca de (6, 8), estima f(6.1, 7.9). El resultado es:

- A) 9.98 · CORRECTA
- B) 10.14 · [linealizacion-incremento-con-signo-equivocado] usas Δy = +0.1 aunque 7.9 está por debajo de 8
- C) −0.02 · [plano-sin-valor-de-f] sumas solo las pendientes por los incrementos y olvidas f(6, 8) = 10
- D) 10.02 · [plano-parciales-en-punto-equivocado] evalúas las parciales en (8, 6) y obtienes pendientes 4/5 y 3/5 en lugar de 3/5 y 4/5

solución: en (6, 8) se tiene f = 10, fₓ = x/√(x² + y²) = 3/5 y f_y = y/√(x² + y²) = 4/5. Los incrementos son Δx = 0.1 y Δy = −0.1. Entonces L = 10 + (3/5)(0.1) + (4/5)(−0.1) = 10 + 0.06 − 0.08 = 9.98.

### P39 · dificultad 2 · kc: plano-tangente · borrador · origen: ia (sonnet-5.5)
El plano tangente a la gráfica de f(x, y) = x²y − y³ en el punto (2, 1, 3) corta al eje z en el punto de altura:

- A) −6 · CORRECTA
- B) −9 · [plano-sin-valor-de-f] armas el plano como 4(x − 2) + (y − 1) y olvidas sumar f(2, 1) = 3
- C) −3 · [plano-parciales-intercambiadas] usas 1 como coeficiente de (x − 2) y 4 como el de (y − 1)
- D) 12 · [plano-normal-grafica-con-mas-uno] usas el normal (fₓ, f_y, 1) y el plano queda con las pendientes de signo contrario

solución: fₓ = 2xy = 4 y f_y = x² − 3y² = 1 en (2, 1). El plano es z = 3 + 4(x − 2) + (y − 1) = 4x + y − 6. El eje z es x = 0, y = 0, así que z = −6.

### P40 · dificultad 3 · kc: plano-tangente · borrador · origen: ia (sonnet-5.5)
La superficie x²y + yz² = 4 pasa por el punto (1, 2, 1). Cerca de ese punto, z es función de x y de y. Usa el plano tangente para aproximar el valor de z en (x, y) = (1.1, 1.9):

- A) 0.95 · CORRECTA
- B) 0.85 · [linealizacion-incremento-con-signo-equivocado] tomas Δy = +0.1 aunque 1.9 está por debajo de 2
- C) −1.05 · [plano-nivel-igualado-al-valor-k] igualas el plano 4x + 2y + 4z a la constante 4 en lugar de a 12
- D) −0.05 · [plano-sin-valor-de-f] entregas el cambio Δz y olvidas sumar el valor z = 1 del punto base

solución: con F = x²y + yz², el gradiente es (2xy, x² + z², 2yz), que en (1, 2, 1) vale (4, 2, 4). El plano tangente es 4(x − 1) + 2(y − 2) + 4(z − 1) = 0. Con x = 1.1 y y = 1.9: 4(0.1) + 2(−0.1) + 4(z − 1) = 0, así que 0.2 + 4(z − 1) = 0 y z = 1 − 0.05 = 0.95.

### P41 · dificultad 1 · kc: gradiente-direccional · borrador · origen: ia (sonnet-5.5)
Sea f(x, y) = x²y + y. La tasa máxima de crecimiento de f en el punto (2, 1) es:

- A) √41 · CORRECTA
- B) (4, 5) · [maximo-gradiente-sin-norma] entregas el vector gradiente en lugar de su longitud
- C) (5, 4) · [parciales-e4] confundes las componentes del gradiente y además das un vector en lugar de su longitud
- D) 4 · [parciales-e5] tomas la derivada en la dirección del eje x, que es una sola componente, como si fuera la tasa máxima

solución: ∇f = (2xy, x² + 1), que en (2, 1) vale (4, 5). La tasa máxima de crecimiento es |∇f| = √(16 + 25) = √41.

### P42 · dificultad 2 · kc: gradiente-direccional · borrador · origen: ia (sonnet-5.5)
Sea f(x, y) = x² − xy. El vector unitario en la dirección de máximo crecimiento de f en el punto (2, 1) es:

- A) (3, −2)/√13 · CORRECTA
- B) (3, −2) · [maximo-gradiente-sin-norma] entregas el gradiente sin dividirlo entre su longitud
- C) (−2, 3)/√13 · [parciales-e4] normalizas, pero pones las componentes del gradiente en el orden contrario
- D) (0, −1) · [parciales-e6] derivas bien pero evalúas el gradiente en (1, 2) en lugar de (2, 1)

solución: ∇f = (2x − y, −x), que en (2, 1) vale (3, −2). La dirección de máximo crecimiento es la del gradiente, y para que sea unitaria se divide entre |∇f| = √(9 + 4) = √13: (3, −2)/√13.
