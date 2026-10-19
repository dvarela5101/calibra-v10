# Series y convergencia

## Habilidades
kc: serie-criterio · Elegir y aplicar un criterio de convergencia adecuado
kc: serie-potencias · Interpretar el radio y el intervalo de convergencia
kc: serie-taylor · Construir series de Taylor con derivadas en el centro

## Errores
mc: criterio-ineficiente · serie-criterio · escoges un criterio más complicado o que no decide cuando uno directo basta
mc: compara-con-divergente · serie-criterio · comparas con una serie que no permite concluir
mc: termino-a-cero · serie-criterio · crees que si el término general tiende a 0 la serie converge
mc: radio-sin-centro · serie-potencias · interpretas el radio sin tener en cuenta el centro
mc: extremos-asumidos · serie-potencias · decides qué pasa en los extremos sin verificarlos
mc: radio-como-puntos · serie-potencias · confundes el radio de convergencia con puntos aislados
mc: taylor-integra · serie-taylor · construyes los coeficientes integrando en vez de derivando
mc: taylor-funcion-equivocada · serie-taylor · usas la serie de otra función conocida
mc: taylor-trunca · serie-taylor · crees que la serie termina después de pocos términos
mc: olvida-factorial · serie-taylor · usas $f^{(n)}(0)$ como coeficiente sin dividir entre n!

## Preguntas

### P8 · dificultad 2 · kc: serie-criterio · revisada · origen: humano · revisó: prototipo
Para determinar si una serie $\sum \frac{1}{n^2}$ converge, ¿qué criterio es más directo?

- A) Criterio de la integral o criterio p con p = 2 · CORRECTA
- B) Criterio del cociente · [criterio-ineficiente] usas un criterio más complejo cuando el criterio p es suficiente
- C) Criterio de la raíz · [criterio-ineficiente] aplicas un criterio que no es el más eficiente para esta forma
- D) Comparación con 1/n · [compara-con-divergente] comparas con una serie divergente en vez de convergente

### P39 · dificultad 2 · kc: serie-criterio · revisada · origen: ia (desconocido) · revisó: Juzou04
¿Qué se puede concluir de $\sum \frac{1}{\sqrt{n}}$?

- A) Diverge, porque es una serie p con p = 1/2 ≤ 1 · CORRECTA
- B) Converge, porque 1/√n tiende a 0 · [termino-a-cero] crees que si el término tiende a 0 la serie converge
- C) Converge, porque el criterio del cociente da límite 1 · [criterio-ineficiente] usas un criterio que aquí no decide y lo interpretas mal
- D) Converge, porque cada término es menor que 1 · [compara-con-divergente] comparas con ∑ 1, que diverge y no permite concluir

solución: es una serie p, ∑ 1/nᵖ, con p = 1/2 ≤ 1, así que diverge (lo confirma el criterio de la integral con ∫ desde 1 hasta ∞ de x^(−1/2) dx, que diverge). Que el término tienda a 0 no basta para converger. El criterio del cociente da límite 1, y con 1 no decide. Y comparar con ∑ 1, que diverge, no permite concluir que una serie menor converja.

### P40 · dificultad 3 · kc: serie-criterio · revisada · origen: ia (desconocido) · revisó: Juzou04
¿Converge $\sum \frac{n}{n + 1}$?

- A) No: el término general tiende a 1, no a 0, así que diverge · CORRECTA
- B) Sí, porque $\frac{n}{n + 1} < 1$ para todo n · [compara-con-divergente] comparas con ∑ 1, que diverge y no permite concluir
- C) Hay que usar el criterio de la raíz para decidir · [criterio-ineficiente] usas un criterio que aquí no decide
- D) No se puede saber: el criterio del término solo sirve cuando el término tiende a 0 · [termino-a-cero] confundes el criterio del término general

solución: el término general n/(n + 1) tiende a 1, no a 0, así que por el criterio del término general (o de la divergencia) la serie diverge. Que cada término sea menor que 1 solo la compara con ∑ 1, que diverge, y eso no permite concluir. El criterio de la raíz no hace falta y aquí da límite 1, que no decide. El criterio del término general sirve justamente cuando el término NO tiende a 0.

### P9 · dificultad 3 · kc: serie-potencias · revisada · origen: humano · revisó: prototipo
Una serie de potencias $\sum a_n(x-c)^n$ tiene radio de convergencia R = 4. ¿Qué puedes afirmar?

- A) Converge absolutamente para |x-c| < 4 · CORRECTA
- B) Converge para todo x en (0, 4) · [radio-sin-centro] interpretas R como intervalo absoluto sin considerar el centro c
- C) Diverge para x = c + 4 siempre · [extremos-asumidos] asumes divergencia en los extremos sin verificar
- D) R = 4 significa que converge solo en 4 puntos · [radio-como-puntos] confundes radio con número de puntos

### P41 · dificultad 2 · kc: serie-potencias · revisada · origen: ia (desconocido) · revisó: Juzou04
La serie $\sum \frac{(x - 3)^n}{2^n}$ tiene radio de convergencia R = 2. ¿Dónde converge con seguridad?

- A) En (1, 5) · CORRECTA
- B) En (−2, 2) · [radio-sin-centro] olvidas que el intervalo va centrado en 3
- C) En [1, 5], incluidos los extremos · [extremos-asumidos] incluyes los extremos sin verificarlos
- D) Solo en x = 1 y en x = 5 · [radio-como-puntos] confundes el radio con puntos aislados

solución: es una serie geométrica de razón (x − 3)/2. Converge cuando |x − 3| < 2, es decir, en el intervalo (1, 5), centrado en 3 con radio 2. En x = 1 y en x = 5 la razón vale −1 y 1, y la serie diverge, así que los extremos no entran. (−2, 2) olvida el centro 3, incluir [1, 5] supone los extremos sin verificarlos, y el radio no son puntos aislados.

### P42 · dificultad 3 · kc: serie-potencias, serie-criterio · revisada · origen: ia (desconocido) · revisó: Juzou04
$\sum \frac{x^n}{n}$ tiene R = 1. ¿Qué pasa en x = −1 y en x = 1?

- A) Converge en x = −1 y diverge en x = 1 · CORRECTA
- B) Diverge en los dos, porque en el borde siempre diverge · [extremos-asumidos]
- C) Converge en los dos, porque 1/n tiende a 0 · [termino-a-cero] crees que si el término tiende a 0 la serie converge
- D) Diverge en los dos, porque R = 1 quiere decir que solo converge en x = 0 · [radio-como-puntos] confundes el radio con puntos aislados

solución: en x = 1 queda ∑ 1/n, la serie armónica, que diverge. En x = −1 queda ∑ (−1)ⁿ/n, una serie alternante con términos 1/n que decrecen a 0: converge por el criterio de series alternantes. En el borde hay que revisar cada extremo, porque puede pasar cualquier cosa. Que 1/n tienda a 0 no basta en x = 1. Y R = 1 quiere decir que converge cuando |x| < 1, no solo en x = 0.

### P10 · dificultad 2 · kc: serie-taylor · revisada · origen: humano · revisó: prototipo
Para encontrar la serie de Taylor de f(x) = eˣ centrada en x = 0, necesitas:

- A) Calcular $f^{(n)}(0)$ para todo n y usar $\sum \frac{f^{(n)}(0)}{n!}x^n$ · CORRECTA
- B) Integrar eˣ repetidamente · [taylor-integra] confundes derivadas con integrales en la construcción de la serie
- C) Usar la serie de ln(x) · [taylor-funcion-equivocada] confundes eˣ con su función inversa
- D) Solo calcular f'(0) y f''(0) · [taylor-trunca] crees que la serie termina después de dos términos

### P43 · dificultad 2 · kc: serie-taylor · revisada · origen: ia (desconocido) · revisó: Juzou04
En la serie de Taylor de sen(x) centrada en 0, el coeficiente de x³ es:

- A) −1/6 · CORRECTA
- B) −1 · [olvida-factorial] usas f'''(0) sin dividir entre 3!
- C) 1/6 · [taylor-funcion-equivocada] usas el signo de otra serie conocida
- D) 0, porque solo cuentan f(0) y f'(0) · [taylor-trunca]

solución: el coeficiente de x³ es f'''(0)/3!. Con f(x) = sen(x), f'''(x) = −cos(x) y f'''(0) = −1, así que el coeficiente es −1/6: sen(x) = x − x³/6 + x⁵/120 − … El −1 no divide entre 3!, el 1/6 tiene el signo de otra serie, y la serie no se corta en f(0) y f'(0).

### P44 · dificultad 3 · kc: serie-taylor · revisada · origen: ia (desconocido) · revisó: Juzou04
Los primeros términos de la serie de Taylor de ln(1 + x) centrada en 0 son:

- A) $x - \frac{x^2}{2} + \frac{x^3}{3} - …$ · CORRECTA
- B) $x - x^2 + 2x^3 - …$ · [olvida-factorial] usas las derivadas sin dividir entre n!
- C) $1 + x + \frac{x^2}{2} + \frac{x^3}{6} + …$ · [taylor-funcion-equivocada] usas la serie de eˣ
- D) $x - \frac{x^2}{2}$, y ahí termina · [taylor-trunca]

solución: con f(x) = ln(1 + x): f(0) = 0, f'(0) = 1, f''(0) = −1 y f'''(0) = 2. Los coeficientes f⁽ⁿ⁾(0)/n! son 0, 1, −1/2 y 2/6 = 1/3, así que ln(1 + x) = x − x²/2 + x³/3 − … x − x² + 2x³ usa las derivadas sin dividir entre n!, 1 + x + x²/2 + x³/6 es la serie de eˣ, y la serie no termina después de dos términos.

### P45 · dificultad 2 · kc: serie-taylor · revisada · origen: ia (desconocido) · revisó: Juzou04
Para el coeficiente de x² en la serie de Taylor de f centrada en 0, calculas:

- A) $\frac{f''(0)}{2}$ · CORRECTA
- B) La segunda integral de f evaluada en 0 · [taylor-integra]
- C) $f''(0)$ · [olvida-factorial] no divides entre 2!
- D) 1/2, igual que en la serie de eˣ · [taylor-funcion-equivocada]

solución: en la serie de Taylor centrada en 0, el coeficiente de xⁿ es f⁽ⁿ⁾(0)/n!. Para n = 2 es f''(0)/2! = f''(0)/2. Los coeficientes salen de derivar, no de integrar; f''(0) solo olvida dividir entre 2!; y 1/2 es el caso particular de eˣ, donde f''(0) = 1.
