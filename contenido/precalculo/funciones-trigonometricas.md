# Funciones trigonométricas y sus gráficas

Valores exactos de las seis funciones trigonométricas en cualquier ángulo, usando el ángulo de referencia y el cuadrante, y lectura de amplitud, periodo y desfase en funciones seno y coseno transformadas. Es del Parcial 4 (semana 16).

## Habilidades
kc: angulo-referencia · Hallar el valor exacto de las funciones trigonométricas de cualquier ángulo, en grados o radianes, con el ángulo de referencia y el cuadrante · prerrequisitos: razones-triangulo
kc: graficas-trig · Hallar la amplitud, el periodo y el desfase de funciones seno y coseno transformadas y reconocerlos en su gráfica · prerrequisitos: angulo-referencia, graficas-transformaciones

## Errores
mc: ref-signo-cuadrante-ignorado · angulo-referencia · das el valor del ángulo de referencia sin ajustar el signo según el cuadrante en que cae el ángulo
mc: ref-seno-coseno-intercambiados · angulo-referencia · intercambias seno con coseno (o tangente con cotangente) al leer el valor del ángulo notable
mc: ref-razon-base-por-su-reciproca · angulo-referencia · calculas el seno, el coseno o la tangente y lo das como respuesta cuando te piden la cosecante, la secante o la cotangente
mc: ref-tangente-signo-del-seno · angulo-referencia · das a la tangente (o a la cotangente) el mismo signo que tiene el seno, sin mirar el cuadrante
mc: ref-reciproca-cruzada · angulo-referencia · tomas la secante como 1/sen y la cosecante como 1/cos
mc: ref-cociente-sin-dividir · angulo-referencia · tomas la tangente como el valor del seno, o la cotangente como el valor del coseno, sin dividir entre la otra coordenada
mc: amplitud-con-signo · graficas-trig · das como amplitud el coeficiente tal cual, con su signo negativo, en vez de su valor absoluto
mc: amplitud-es-el-maximo · graficas-trig · tomas como amplitud el valor máximo de la función, sin restar el desplazamiento vertical
mc: amplitud-multiplicada-por-b · graficas-trig · multiplicas el coeficiente de adelante por el coeficiente de x y lo das como amplitud
mc: periodo-multiplica-por-b · graficas-trig · calculas el periodo como 2π·b en vez de 2π/b
mc: periodo-igual-a-b · graficas-trig · tomas el coeficiente de x como si fuera el periodo
mc: desfase-sin-dividir-por-b · graficas-trig · tomas el término suelto del paréntesis como desfase sin factorizar ni dividir entre el coeficiente de x
mc: desfase-signo-invertido · graficas-trig · das el desfase con el signo contrario: lo pones a la izquierda cuando el desplazamiento es a la derecha, o al revés

## Preguntas

### P131 · dificultad 1 · kc: angulo-referencia · borrador · origen: ia (sonnet-5.5)
El valor exacto de sec 150° es:

- A) −2√3/3 · CORRECTA
- B) 2√3/3 · [ref-signo-cuadrante-ignorado] el ángulo de referencia es 30°, la secante de 30° vale 2√3/3 y no cambias el signo aunque 150° está en el segundo cuadrante, donde el coseno es negativo
- C) −√3/2 · [ref-razon-base-por-su-reciproca] calculas cos 150° y lo das como respuesta, sin tomar el inverso que pide la secante
- D) 2 · [ref-reciproca-cruzada] tomas sec 150° como 1/sen 150° = 1/(1/2) en vez de 1/cos 150°

solución: 150° está en el segundo cuadrante y su ángulo de referencia es 180° − 150° = 30°. Ahí el coseno es negativo, así que cos 150° = −√3/2. La secante es el inverso del coseno: sec 150° = 1/(−√3/2) = −2/√3 = −2√3/3.

### P132 · dificultad 2 · kc: angulo-referencia · borrador · origen: ia (sonnet-5.5)
El valor exacto de tan(7π/6) es:

- A) √3/3 · CORRECTA
- B) −√3/3 · [ref-tangente-signo-del-seno] como el seno es negativo en el tercer cuadrante, le pones signo negativo a la tangente, pero allí seno y coseno son negativos y el cociente es positivo
- C) √3 · [ref-seno-coseno-intercambiados] calculas cos/sen en vez de sen/cos y obtienes la cotangente
- D) −1/2 · [ref-cociente-sin-dividir] das el valor de sen(7π/6) como si fuera la tangente, sin dividir entre el coseno

solución: 7π/6 está en el tercer cuadrante y su ángulo de referencia es 7π/6 − π = π/6. Ahí sen(7π/6) = −1/2 y cos(7π/6) = −√3/2. La tangente es el cociente: (−1/2)/(−√3/2) = 1/√3 = √3/3. En el tercer cuadrante la tangente es positiva.

### P133 · dificultad 2 · kc: angulo-referencia · borrador · origen: ia (sonnet-5.5)
El valor exacto de csc(5π/3) es:

- A) −2√3/3 · CORRECTA
- B) 2√3/3 · [ref-signo-cuadrante-ignorado] usas el ángulo de referencia π/3 y das csc(π/3) = 2√3/3 sin notar que 5π/3 está en el cuarto cuadrante, donde el seno es negativo
- C) −√3/2 · [ref-razon-base-por-su-reciproca] calculas sen(5π/3) y lo das como respuesta, sin tomar el inverso que pide la cosecante
- D) 2 · [ref-reciproca-cruzada] tomas csc(5π/3) como 1/cos(5π/3) = 1/(1/2) en vez de 1/sen(5π/3)

solución: 5π/3 está en el cuarto cuadrante y su ángulo de referencia es 2π − 5π/3 = π/3. Ahí el seno es negativo: sen(5π/3) = −√3/2. La cosecante es el inverso del seno: csc(5π/3) = 1/(−√3/2) = −2/√3 = −2√3/3.

### P134 · dificultad 2 · kc: angulo-referencia · borrador · origen: ia (sonnet-5.5)
El valor exacto de cot 120° es:

- A) −√3/3 · CORRECTA
- B) √3/3 · [ref-tangente-signo-del-seno] como el seno es positivo en el segundo cuadrante, le pones signo positivo a la cotangente, pero allí el coseno es negativo y el cociente sale negativo
- C) −√3 · [ref-seno-coseno-intercambiados] calculas sen/cos en vez de cos/sen y obtienes la tangente
- D) −1/2 · [ref-cociente-sin-dividir] das el valor de cos 120° como si fuera la cotangente, sin dividir entre el seno

solución: 120° está en el segundo cuadrante y su ángulo de referencia es 180° − 120° = 60°. Ahí cos 120° = −1/2 y sen 120° = √3/2. La cotangente es cos/sen: (−1/2)/(√3/2) = −1/√3 = −√3/3.

### P135 · dificultad 3 · kc: angulo-referencia · borrador · origen: ia (sonnet-5.5)
El valor exacto de cot(35π/6) es:

- A) −√3 · CORRECTA
- B) √3 · [ref-tangente-signo-del-seno] reduces bien el ángulo, pero como el seno es positivo en el segundo cuadrante le pones signo positivo a la cotangente, cuando allí el coseno es negativo
- C) −√3/3 · [ref-seno-coseno-intercambiados] calculas sen/cos en vez de cos/sen y das la tangente en lugar de la cotangente
- D) √3/2 · [ref-cociente-sin-dividir] das el valor de cos(35π/6) como si fuera la cotangente, sin dividir entre el seno

solución: la cotangente tiene periodo π, y 35π/6 = 5π + 5π/6, así que cot(35π/6) = cot(5π/6). El ángulo 5π/6 está en el segundo cuadrante y su ángulo de referencia es π − 5π/6 = π/6. Ahí cos(5π/6) = −√3/2 y sen(5π/6) = 1/2. Entonces cot(5π/6) = (−√3/2)/(1/2) = −√3.

### P136 · dificultad 1 · kc: graficas-trig · borrador · origen: ia (sonnet-5.5)
¿Cuál es la amplitud de f(x) = −3 cos(2x) + 1?

- A) 3 · CORRECTA
- B) −3 · [amplitud-con-signo] das el coeficiente −3 como amplitud, pero la amplitud es una distancia y no puede ser negativa
- C) 4 · [amplitud-es-el-maximo] das el valor máximo de la función, −3·(−1) + 1 = 4, en vez de la distancia de la línea media al máximo
- D) 6 · [amplitud-multiplicada-por-b] multiplicas 3 por el 2 que acompaña a x, pero ese número solo cambia el periodo

solución: la amplitud de a·cos(bx) + d es |a|, la distancia de la línea media y = 1 al máximo. Aquí |−3| = 3. El signo negativo solo refleja la gráfica, el 2 acorta el periodo y el +1 desplaza la gráfica hacia arriba.

### P137 · dificultad 2 · kc: graficas-trig · borrador · origen: ia (sonnet-5.5)
Para f(x) = 2 sen(3x − π), ¿cuáles son la amplitud, el periodo y el desfase?

- A) amplitud 2, periodo 2π/3, desfase π/3 · CORRECTA
- B) amplitud 2, periodo 2π/3, desfase −π/3 · [desfase-signo-invertido] factorizas bien 3(x − π/3), pero lees el desplazamiento hacia la izquierda en vez de hacia la derecha
- C) amplitud 2, periodo 2π/3, desfase π · [desfase-sin-dividir-por-b] tomas el π del paréntesis como desfase sin factorizar el 3
- D) amplitud 6, periodo 2π/3, desfase π/3 · [amplitud-multiplicada-por-b] multiplicas el 2 de adelante por el 3 que acompaña a x y lo das como amplitud

solución: la amplitud es |a| = 2. El periodo es 2π/|b| = 2π/3. Para el desfase se factoriza el coeficiente de x: 3x − π = 3(x − π/3), así que la gráfica del seno se desplaza π/3 unidades a la derecha y el desfase es π/3.

### P138 · dificultad 2 · kc: graficas-trig · borrador · origen: ia (sonnet-5.5)
La gráfica de f se obtiene de la de y = sen x comprimiéndola horizontalmente hasta que su periodo se reduce a la mitad y desplazándola después π/4 unidades a la derecha. ¿Cuál es f?

- A) f(x) = sen(2x − π/2) · CORRECTA
- B) f(x) = sen(2x − π/4) · [desfase-sin-dividir-por-b] escribes el desplazamiento π/4 directamente en el paréntesis sin multiplicarlo por el 2 que acompaña a x
- C) f(x) = sen(2x + π/2) · [desfase-signo-invertido] escribes 2(x + π/4) para un desplazamiento hacia la derecha, que corresponde a uno hacia la izquierda
- D) f(x) = sen(x/2 − π/8) · [periodo-multiplica-por-b] para un periodo π tomas b = 1/2, como si el periodo fuera 2π·b, y obtienes una onda más estirada en vez de comprimida

solución: reducir el periodo de 2π a π exige b = 2π/π = 2, es decir, sen(2x). Para desplazar π/4 a la derecha se cambia x por x − π/4 en la función ya comprimida: sen(2(x − π/4)) = sen(2x − π/2). El desfase es π/4 y no π/2: el término π/2 del paréntesis aparece porque se distribuye el 2.

### P139 · dificultad 2 · kc: graficas-trig · borrador · origen: ia (sonnet-5.5)
Para f(x) = −2 sen(4x) + 3, ¿cuáles son la amplitud y el periodo?

- A) amplitud 2, periodo π/2 · CORRECTA
- B) amplitud 5, periodo π/2 · [amplitud-es-el-maximo] das como amplitud el valor máximo de f, que es 5, sin restar el desplazamiento vertical de 3
- C) amplitud 2, periodo 4 · [periodo-igual-a-b] tomas el 4 que acompaña a x como si fuera el periodo
- D) amplitud −2, periodo π/2 · [amplitud-con-signo] das el coeficiente −2 como amplitud, pero la amplitud no puede ser negativa

solución: la amplitud es |−2| = 2, la distancia de la línea media y = 3 al máximo 5. El periodo es 2π/4 = π/2. El signo negativo solo refleja la gráfica y el +3 solo la sube.

### P140 · dificultad 3 · kc: graficas-trig · borrador · origen: ia (sonnet-5.5)
La gráfica de f(x) = a cos(bx) + d, con a y b positivos, tiene valor máximo 7 y valor mínimo −1. Dos máximos consecutivos están en x = 0 y x = 4π/3. ¿Cuáles son a y b?

- A) a = 4, b = 3/2 · CORRECTA
- B) a = 7, b = 3/2 · [amplitud-es-el-maximo] tomas el valor máximo 7 como la amplitud a, sin restar la altura de la línea media
- C) a = 4, b = 2/3 · [periodo-multiplica-por-b] con periodo 4π/3 planteas 2π·b = 4π/3 en vez de 2π/b = 4π/3
- D) a = 4, b = 4π/3 · [periodo-igual-a-b] tomas la distancia entre los dos máximos como si fuera b, en vez de usarla como periodo

solución: la amplitud es la mitad de la distancia entre el máximo y el mínimo: a = (7 − (−1))/2 = 4, y la línea media es d = (7 + (−1))/2 = 3. La distancia entre dos máximos consecutivos es el periodo: 4π/3. Como el periodo es 2π/b, se tiene 2π/b = 4π/3, de donde b = 2π·3/(4π) = 3/2.
