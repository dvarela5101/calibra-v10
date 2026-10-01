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

### P39 · dificultad 2 · kc: serie-criterio · borrador · origen: ia (desconocido)
¿Qué se puede concluir de $\sum \frac{1}{\sqrt{n}}$?

- A) Diverge, porque es una serie p con p = 1/2 ≤ 1 · CORRECTA
- B) Converge, porque 1/√n tiende a 0 · [termino-a-cero] crees que si el término tiende a 0 la serie converge
- C) Converge, porque el criterio del cociente da límite 1 · [criterio-ineficiente] usas un criterio que aquí no decide y lo interpretas mal
- D) Converge, porque cada término es menor que 1 · [compara-con-divergente] comparas con ∑ 1, que diverge y no permite concluir

### P40 · dificultad 3 · kc: serie-criterio · borrador · origen: ia (desconocido)
¿Converge $\sum \frac{n}{n + 1}$?

- A) No: el término general tiende a 1, no a 0, así que diverge · CORRECTA
- B) Sí, porque $\frac{n}{n + 1} < 1$ para todo n · [compara-con-divergente] comparas con ∑ 1, que diverge y no permite concluir
- C) Hay que usar el criterio de la raíz para decidir · [criterio-ineficiente] usas un criterio que aquí no decide
- D) No se puede saber: el criterio del término solo sirve cuando el término tiende a 0 · [termino-a-cero] confundes el criterio del término general

### P9 · dificultad 3 · kc: serie-potencias · revisada · origen: humano · revisó: prototipo
Una serie de potencias $\sum a_n(x-c)^n$ tiene radio de convergencia R = 4. ¿Qué puedes afirmar?

- A) Converge absolutamente para |x-c| < 4 · CORRECTA
- B) Converge para todo x en (0, 4) · [radio-sin-centro] interpretas R como intervalo absoluto sin considerar el centro c
- C) Diverge para x = c + 4 siempre · [extremos-asumidos] asumes divergencia en los extremos sin verificar
- D) R = 4 significa que converge solo en 4 puntos · [radio-como-puntos] confundes radio con número de puntos

### P41 · dificultad 2 · kc: serie-potencias · borrador · origen: ia (desconocido)
La serie $\sum \frac{(x - 3)^n}{2^n}$ tiene radio de convergencia R = 2. ¿Dónde converge con seguridad?

- A) En (1, 5) · CORRECTA
- B) En (−2, 2) · [radio-sin-centro] olvidas que el intervalo va centrado en 3
- C) En [1, 5], incluidos los extremos · [extremos-asumidos] incluyes los extremos sin verificarlos
- D) Solo en x = 1 y en x = 5 · [radio-como-puntos] confundes el radio con puntos aislados

### P42 · dificultad 3 · kc: serie-potencias, serie-criterio · borrador · origen: ia (desconocido)
$\sum \frac{x^n}{n}$ tiene R = 1. ¿Qué pasa en x = −1 y en x = 1?

- A) Converge en x = −1 y diverge en x = 1 · CORRECTA
- B) Diverge en los dos, porque en el borde siempre diverge · [extremos-asumidos]
- C) Converge en los dos, porque 1/n tiende a 0 · [termino-a-cero] crees que si el término tiende a 0 la serie converge
- D) Diverge en los dos, porque R = 1 quiere decir que solo converge en x = 0 · [radio-como-puntos] confundes el radio con puntos aislados

### P10 · dificultad 2 · kc: serie-taylor · revisada · origen: humano · revisó: prototipo
Para encontrar la serie de Taylor de f(x) = eˣ centrada en x = 0, necesitas:

- A) Calcular $f^{(n)}(0)$ para todo n y usar $\sum \frac{f^{(n)}(0)}{n!}x^n$ · CORRECTA
- B) Integrar eˣ repetidamente · [taylor-integra] confundes derivadas con integrales en la construcción de la serie
- C) Usar la serie de ln(x) · [taylor-funcion-equivocada] confundes eˣ con su función inversa
- D) Solo calcular f'(0) y f''(0) · [taylor-trunca] crees que la serie termina después de dos términos

### P43 · dificultad 2 · kc: serie-taylor · borrador · origen: ia (desconocido)
En la serie de Taylor de sen(x) centrada en 0, el coeficiente de x³ es:

- A) −1/6 · CORRECTA
- B) −1 · [olvida-factorial] usas f'''(0) sin dividir entre 3!
- C) 1/6 · [taylor-funcion-equivocada] usas el signo de otra serie conocida
- D) 0, porque solo cuentan f(0) y f'(0) · [taylor-trunca]

### P44 · dificultad 3 · kc: serie-taylor · borrador · origen: ia (desconocido)
Los primeros términos de la serie de Taylor de ln(1 + x) centrada en 0 son:

- A) $x - \frac{x^2}{2} + \frac{x^3}{3} - …$ · CORRECTA
- B) $x - x^2 + 2x^3 - …$ · [olvida-factorial] usas las derivadas sin dividir entre n!
- C) $1 + x + \frac{x^2}{2} + \frac{x^3}{6} + …$ · [taylor-funcion-equivocada] usas la serie de eˣ
- D) $x - \frac{x^2}{2}$, y ahí termina · [taylor-trunca]

### P45 · dificultad 2 · kc: serie-taylor · borrador · origen: ia (desconocido)
Para el coeficiente de x² en la serie de Taylor de f centrada en 0, calculas:

- A) $\frac{f''(0)}{2}$ · CORRECTA
- B) La segunda integral de f evaluada en 0 · [taylor-integra]
- C) $f''(0)$ · [olvida-factorial] no divides entre 2!
- D) 1/2, igual que en la serie de eˣ · [taylor-funcion-equivocada]
