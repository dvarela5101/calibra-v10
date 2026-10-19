# La derivada

La derivada como límite del cociente incremental, su significado como pendiente de la tangente y razón de cambio instantánea, y cuándo una función es derivable. Es del Parcial 2 (semana 5 del programa). De Precálculo hacen falta las rectas y su ecuación. Los errores que faltaban y las preguntas nuevas son borradores de IA (HU-101), escritos con el criterio del modelo y apuntes libres, y esperan la revisión de un desarrollador.

## Habilidades
kc: derivada-definicion · Calcular la derivada de una función en un punto con el límite del cociente incremental · prerrequisitos: limite-algebraico
kc: derivada-significado · Interpretar la derivada como pendiente de la recta tangente y como razón de cambio instantánea · prerrequisitos: derivada-definicion
kc: diferenciabilidad · Decidir si una función es derivable en un punto y hallar parámetros para que lo sea · prerrequisitos: derivada-definicion, continuidad

## Errores
mc: secante-por-tangente · derivada-significado · confundes la derivada con la pendiente de una recta secante entre dos puntos
mc: promedio-por-instantanea · derivada-significado · tomas la razón de cambio promedio en un intervalo por la razón de cambio instantánea
mc: tangente-es-cualquier-recta · derivada-significado · crees que cualquier recta que pasa por el punto de la curva tiene la pendiente de la derivada
mc: olvida-dividir-por-h · derivada-definicion · tomas solo el numerador f(a + h) − f(a), que tiende a 0, y no lo divides entre h
mc: potencia-binomio-sin-terminos-medios · derivada-definicion · desarrollas (a + h)² o (a + h)³ como a² + h² o a³ + h³, sin los términos intermedios
mc: confunde-derivada-con-valor · derivada-definicion · das el valor de la función en el punto como si fuera el valor de su derivada, o al revés
mc: cociente-incremental-invertido · derivada-definicion · escribes el cociente incremental al revés, con h arriba y f(a + h) − f(a) abajo, y obtienes el inverso de la derivada
mc: resta-invertida-en-numerador · derivada-definicion · restas f(a) − f(a + h) en vez de f(a + h) − f(a), y el signo de la derivada sale cambiado
mc: unidades-de-la-funcion · derivada-significado · expresas la derivada con las unidades de la función y olvidas que es una razón de cambio, medida por unidad de la variable
mc: signo-derivada-invertido · derivada-significado · lees una derivada negativa como crecimiento y una positiva como decrecimiento
mc: continua-implica-derivable · diferenciabilidad · crees que si la función es continua en un punto entonces es derivable allí
mc: no-derivable-implica-discontinua · diferenciabilidad · crees que si la función no es derivable en un punto entonces tampoco es continua allí
mc: deriva-un-solo-tramo · diferenciabilidad · derivas la fórmula de un solo tramo, o miras un solo lado, y concluyes que la función es derivable sin comparar los dos lados
mc: iguala-solo-valores · diferenciabilidad · al pedir derivabilidad en una función a trozos exiges solo que los dos tramos valgan lo mismo en el punto de unión y no igualas las pendientes
mc: iguala-solo-pendientes · diferenciabilidad · igualas las derivadas de los dos tramos en el punto de unión y no exiges que los valores coincidan
mc: valor-y-pendiente-cruzados · diferenciabilidad · al plantear las condiciones en el punto de unión igualas el valor de un tramo con la pendiente del otro
mc: conjugado-incompleto-cociente · derivada-definicion · al racionalizar el cociente incremental multiplicas solo el numerador por el conjugado y cambias el valor de la expresión

## Preguntas

### P5 · dificultad 2 · kc: derivada-significado · revisada · origen: humano · revisó: prototipo · ⚠ revisar
La derivada de una función en x = 2 es la pendiente de:

- A) La recta tangente en x = 2 · CORRECTA
- B) La recta secante entre x = 2 y x = 3 · [secante-por-tangente]
- C) La cuerda que une dos puntos cerca de x = 2 · [promedio-por-instantanea]
- D) Cualquier recta que pase por f(2) · [tangente-es-cualquier-recta]

### P51 · dificultad 1 · kc: derivada-definicion · borrador · origen: ia (sonnet-5.5)
Sea f(x) = 2x² + x. El valor de $\lim_{h\to 0} \frac{f(3+h) - f(3)}{h}$ es:

- A) 0 · [olvida-dividir-por-h] tomas solo el numerador f(3 + h) − f(3), que tiende a 0, y no lo divides entre h
- B) 13 · CORRECTA
- C) 1/13 · [cociente-incremental-invertido] pones h arriba y f(3 + h) − f(3) abajo, y obtienes el inverso de la derivada
- D) 1 · [potencia-binomio-sin-terminos-medios] desarrollas (3 + h)² como 9 + h², sin el término 6h, y el numerador queda 2h² + h

solución: f(3) = 2·9 + 3 = 21 y f(3 + h) = 2(9 + 6h + h²) + 3 + h = 21 + 13h + 2h². Entonces f(3 + h) − f(3) = 13h + 2h², el cociente es 13 + 2h y su límite cuando h → 0 es 13. Si no se divide entre h, el numerador tiende a 0 (opción A). Si se invierte el cociente se obtiene 1/13 (opción C). Si se desarrolla (3 + h)² como 9 + h², el numerador queda 2h² + h, el cociente 2h + 1 y el límite 1 (opción D).

### P52 · dificultad 2 · kc: derivada-definicion · borrador · origen: ia (sonnet-5.5)
Usa la definición de derivada para hallar f'(−2) si f(x) = x³ − 3x.

- A) −3 · [potencia-binomio-sin-terminos-medios] desarrollas (−2 + h)³ como −8 + h³, sin los términos intermedios; el numerador queda h³ − 3h y el cociente tiende a −3
- B) −2 · [confunde-derivada-con-valor] das f(−2) = −2, el valor de la función, en lugar de su derivada
- C) −9 · [resta-invertida-en-numerador] restas f(−2) − f(−2 + h) en vez de f(−2 + h) − f(−2), y el signo del resultado sale cambiado
- D) 9 · CORRECTA

solución: f(−2) = −8 + 6 = −2. Además (−2 + h)³ = −8 + 12h − 6h² + h³, de modo que f(−2 + h) = −8 + 12h − 6h² + h³ + 6 − 3h = −2 + 9h − 6h² + h³. Entonces f(−2 + h) − f(−2) = 9h − 6h² + h³, el cociente es 9 − 6h + h² y el límite cuando h → 0 es 9. Con (−2 + h)³ = −8 + h³ el cociente sale h² − 3 y el límite −3 (opción A). El valor f(−2) = −2 es la opción B. Restar en el orden contrario cambia el signo y da −9 (opción C).

### P53 · dificultad 2 · kc: derivada-definicion · borrador · origen: ia (sonnet-5.5)
Con la definición de derivada, la derivada de $f(x) = \frac{1}{x+2}$ es:

- A) $-\frac{1}{(x+2)^2}$ · CORRECTA
- B) $\frac{1}{(x+2)^2}$ · [resta-invertida-en-numerador] restas f(x) − f(x + h) en vez de f(x + h) − f(x), y el signo queda al revés
- C) $-(x+2)^2$ · [cociente-incremental-invertido] pones h en el numerador y f(x + h) − f(x) en el denominador, y obtienes el inverso de la derivada
- D) 0 · [olvida-dividir-por-h] te quedas con f(x + h) − f(x) sin dividir entre h, y eso tiende a 0

solución: $\frac{f(x+h) - f(x)}{h} = \frac{1}{h}\left(\frac{1}{x+h+2} - \frac{1}{x+2}\right)$. Con denominador común (x + h + 2)(x + 2) el numerador es (x + 2) − (x + h + 2) = −h. Queda $\frac{-h}{h(x+h+2)(x+2)} = \frac{-1}{(x+h+2)(x+2)}$, y al hacer h → 0 resulta $-\frac{1}{(x+2)^2}$. Restar en orden contrario da $\frac{1}{(x+2)^2}$ (opción B). El cociente invertido da $-(x+2)^2$ (opción C). Sin dividir entre h, la diferencia $-\frac{h}{(x+h+2)(x+2)}$ tiende a 0 (opción D).

### P54 · dificultad 3 · kc: derivada-definicion · borrador · origen: ia (sonnet-5.5)
Sea $f(x) = \sqrt{4x+1}$. El valor de f'(2), calculado con el límite del cociente incremental, es:

- A) 4 · [conjugado-incompleto-cociente] multiplicas solo el numerador por el conjugado √(9 + 4h) + 3 y olvidas el denominador: el numerador queda 4h y el cociente 4h/h = 4
- B) 3 · [confunde-derivada-con-valor] das f(2) = 3, el valor de la función, en lugar de su derivada
- C) 2/3 · CORRECTA
- D) 3/2 · [cociente-incremental-invertido] pones h arriba y f(2 + h) − f(2) abajo, y obtienes el inverso de la derivada

solución: f(2) = √9 = 3 y f(2 + h) = √(9 + 4h). Al sustituir h = 0 en $\frac{\sqrt{9+4h} - 3}{h}$ queda 0/0, así que se racionaliza multiplicando arriba y abajo por √(9 + 4h) + 3. El numerador es (9 + 4h) − 9 = 4h, y el cociente es $\frac{4h}{h(\sqrt{9+4h} + 3)} = \frac{4}{\sqrt{9+4h} + 3}$ para h ≠ 0. Cuando h → 0 da 4/(3 + 3) = 2/3. Si solo se multiplica el numerador, queda 4h/h = 4 (opción A). El valor f(2) = 3 es la opción B y el inverso de 2/3 es 3/2 (opción D).

### P55 · dificultad 1 · kc: derivada-significado · borrador · origen: ia (sonnet-5.5)
Se sabe que f(4) = 7, f(6) = 3 y f'(4) = −3. ¿Cuál afirmación sobre la recta tangente a la gráfica de f en el punto (4, 7) es correcta?

- A) Tiene pendiente −2, la que sube o baja la gráfica por unidad entre x = 4 y x = 6 · [secante-por-tangente] usas la pendiente de la secante entre (4, 7) y (6, 3) en lugar de la derivada en x = 4
- B) No se puede saber su pendiente, porque por (4, 7) pasan rectas de todas las pendientes · [tangente-es-cualquier-recta]
- C) Tiene pendiente −3, así que al avanzar hacia la derecha por el punto la recta baja · CORRECTA
- D) Tiene pendiente −3, así que al avanzar hacia la derecha por el punto la recta sube · [signo-derivada-invertido]

solución: la derivada f'(4) es la pendiente de la recta tangente en x = 4, o sea −3. Una pendiente negativa significa que la recta, y la gráfica cerca del punto, bajan al avanzar hacia la derecha. La pendiente de la secante es (3 − 7)/(6 − 4) = −2, pero es la de la recta que une dos puntos de la gráfica, no la de la tangente (opción A). Por (4, 7) pasan muchas rectas, pero solo una es tangente y su pendiente es f'(4) (opción B). La opción D contradice el signo de la pendiente: con pendiente negativa la recta baja.

### P56 · dificultad 2 · kc: derivada-significado · borrador · origen: ia (sonnet-5.5)
La distancia recorrida por un ciclista, en metros, es s(t) = 2t² + 3t, con t en segundos. Su velocidad instantánea en t = 3 s es:

- A) 15 m/s · CORRECTA
- B) 9 m/s · [promedio-por-instantanea] tomas la velocidad media entre t = 0 y t = 3, que es 27/3, como si fuera la velocidad en el instante t = 3
- C) 17 m/s · [secante-por-tangente] usas la pendiente de la secante entre t = 3 y t = 4, que es (44 − 27)/1, en lugar de la derivada en t = 3
- D) 15 m · [unidades-de-la-funcion] das el número correcto pero con las unidades de la distancia, sin dividir entre el tiempo

solución: la velocidad instantánea es s'(3), el límite de $\frac{s(3+h) - s(3)}{h}$. Como s(3) = 27 y s(3 + h) = 2(9 + 6h + h²) + 9 + 3h = 27 + 15h + 2h², el cociente es 15 + 2h y el límite es 15. Las unidades son metros por segundo, porque es una distancia dividida entre un tiempo (opción D). La velocidad media en [0, 3] es 27/3 = 9 m/s (opción B). La pendiente de la secante entre t = 3 y t = 4 es (44 − 27)/1 = 17 m/s, porque s(4) = 44 (opción C).

### P57 · dificultad 3 · kc: derivada-significado · borrador · origen: ia (sonnet-5.5)
Una colonia de bacterias tiene P(t) = 2t³ − 9t² + 30 miles de bacterias después de t horas. Se sabe que P'(t) = 6t² − 18t. ¿Cuál es la interpretación correcta de P'(1)?

- A) A la hora 1 la población crece a razón de 12 mil bacterias por hora · [signo-derivada-invertido] ignoras el signo negativo de P'(1) = −12, o lo lees como crecimiento
- B) A la hora 1 la población decrece a razón de 7 mil bacterias por hora · [promedio-por-instantanea] tomas la razón de cambio promedio entre t = 0 y t = 1, que es 23 − 30, como si fuera la razón de cambio en t = 1
- C) A la hora 1 la población ha disminuido en 12 mil bacterias · [unidades-de-la-funcion] das la derivada en miles de bacterias, como si fuera un cambio total, y no en miles de bacterias por hora
- D) A la hora 1 la población decrece a razón de 12 mil bacterias por hora · CORRECTA

solución: P'(1) = 6 − 18 = −12. La derivada es la razón de cambio instantánea de P, así que sus unidades son miles de bacterias por hora, y el signo negativo indica que la población disminuye. Entonces, a la hora 1 la población decrece a razón de 12 mil bacterias por hora. Leer −12 como crecimiento es la opción A. Como P(0) = 30 y P(1) = 23, la razón de cambio promedio en [0, 1] es −7 mil por hora, que no es la razón instantánea en t = 1 (opción B). La opción C da la derivada en las unidades de P y la lee como un cambio total, pero el cambio real de P(0) a P(1) es −7 mil.

### P58 · dificultad 1 · kc: diferenciabilidad · borrador · origen: ia (sonnet-5.5)
Sea f(x) = |x − 3|. ¿Cuál afirmación sobre f en x = 3 es correcta?

- A) Es derivable en x = 3, porque es continua allí · [continua-implica-derivable] crees que como la función es continua en el punto, también es derivable
- B) Es continua en x = 3, pero no es derivable: las pendientes a los dos lados son −1 y 1 · CORRECTA
- C) No es continua en x = 3, porque no es derivable allí · [no-derivable-implica-discontinua] crees que como la función no es derivable en el punto, tampoco es continua
- D) Es derivable en x = 3 y f'(3) = 1, porque a la derecha de 3 la función es x − 3 · [deriva-un-solo-tramo] derivas la fórmula de un solo lado y no la comparas con la del otro

solución: f(x) = x − 3 si x ≥ 3 y f(x) = 3 − x si x < 3. Los dos límites laterales valen 0 = f(3), así que f es continua en 3. El cociente incremental $\frac{f(3+h) - f(3)}{h} = \frac{|h|}{h}$ vale 1 si h > 0 y −1 si h < 0. Los límites laterales son distintos, por lo que f'(3) no existe: la gráfica tiene un pico. Continua no implica derivable (opción A), y no ser derivable no implica ser discontinua (opción C). La derivada por la derecha vale 1, pero hay que comparar con la de la izquierda, que vale −1 (opción D).

### P59 · dificultad 2 · kc: diferenciabilidad · borrador · origen: ia (sonnet-5.5)
Sea f(x) = x² + 1 si x ≤ 1 y f(x) = 3x − 1 si x > 1. ¿Cuál afirmación sobre f en x = 1 es correcta?

- A) Es derivable en x = 1, porque los dos tramos valen 2 en ese punto y la función es continua · [continua-implica-derivable] crees que como la función es continua en el punto, también es derivable
- B) No es continua en x = 1, porque las derivadas laterales 2 y 3 son distintas · [no-derivable-implica-discontinua] crees que como la función no es derivable en el punto, tampoco es continua
- C) Es continua en x = 1, pero no es derivable: las derivadas laterales son 2 y 3 · CORRECTA
- D) Es derivable en x = 1 y f'(1) = 2, derivando x² + 1, que es el tramo que incluye a x = 1 · [deriva-un-solo-tramo] derivas la fórmula del tramo que contiene al punto y no la comparas con la del otro tramo

solución: f(1) = 1² + 1 = 2. Por la izquierda el límite es 1² + 1 = 2 y por la derecha 3·1 − 1 = 2, luego f es continua en 1. Para la derivada, la pendiente del tramo izquierdo es 2x = 2 en x = 1, y la del tramo derecho es 3. Las derivadas laterales son distintas, así que f'(1) no existe. Continua no implica derivable (opción A), y la falta de derivada no hace discontinua a la función, que aquí sí es continua (opción B). Derivar solo el tramo x² + 1 da 2, pero la derivada exige que coincida con la del otro tramo (opción D).

### P60 · dificultad 2 · kc: diferenciabilidad · borrador · origen: ia (sonnet-5.5)
Sea f(x) = ax + b si x < 0 y f(x) = 2x² − 4x + 7 si x ≥ 0. Para que f sea derivable en x = 0, se necesita que:

- A) b = 7, y a puede tomar cualquier valor · [iguala-solo-valores] exiges solo que los dos tramos valgan lo mismo en x = 0 y no igualas las pendientes
- B) a = −4, y b puede tomar cualquier valor · [iguala-solo-pendientes] igualas solo las pendientes de los dos tramos y no exiges que los valores coincidan
- C) a = 7 y b = −4 · [valor-y-pendiente-cruzados] confundes el valor de la función con el de su derivada: pones la pendiente donde va el valor y al revés
- D) a = −4 y b = 7 · CORRECTA

solución: para ser derivable, f debe ser continua y sus derivadas laterales deben coincidir. Continuidad en 0: el límite por la izquierda es b y f(0) = 7, luego b = 7. Derivada: por la izquierda la pendiente es a; por la derecha, la derivada de 2x² − 4x + 7 es 4x − 4, que en x = 0 vale −4. Entonces a = −4. Si se exige solo el valor, queda a libre (opción A). Si se exige solo la pendiente, queda b libre (opción B). Intercambiar valor y pendiente da a = 7 y b = −4 (opción C).

### P61 · dificultad 3 · kc: diferenciabilidad · borrador · origen: ia (sonnet-5.5)
Sea f(x) = ax² + bx + 1 si x < 1 y f(x) = 5x − 3 si x ≥ 1. Los valores de a y b que hacen derivable a f en x = 1 son:

- A) a = 4 y b = −3 · CORRECTA
- B) hay infinitos pares (a, b), todos con a + b = 1 · [iguala-solo-valores] impones solo que los tramos valgan lo mismo en x = 1, y te queda una sola ecuación con dos incógnitas
- C) hay infinitos pares (a, b), todos con 2a + b = 5 · [iguala-solo-pendientes] impones solo que las pendientes coincidan en x = 1, y te queda una sola ecuación con dos incógnitas
- D) a = −2 y b = 6 · [valor-y-pendiente-cruzados] igualas el valor del tramo izquierdo con la pendiente del derecho y la pendiente del izquierdo con el valor del derecho

solución: se necesitan dos condiciones en x = 1. Continuidad: el límite por la izquierda es a + b + 1 y el valor por la derecha es 5·1 − 3 = 2, luego a + b = 1. Derivada: por la izquierda es 2ax + b, que en x = 1 vale 2a + b; por la derecha es 5. Entonces 2a + b = 5. Restando la primera ecuación de la segunda, a = 4, y de ahí b = 1 − 4 = −3. Usar solo la primera ecuación deja infinitos pares con a + b = 1 (opción B); usar solo la segunda, infinitos con 2a + b = 5 (opción C). Si se intercambian valor y pendiente del tramo derecho, se resuelve a + b + 1 = 5 y 2a + b = 2, y sale a = −2, b = 6 (opción D).
