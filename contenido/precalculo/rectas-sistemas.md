# Rectas, sistemas y modelos lineales

Ecuaciones de rectas, sistemas de dos ecuaciones lineales con dos incógnitas y problemas en palabras que se resuelven con una ecuación o un sistema lineal. Cae en el Parcial 2 (semana 8).

## Habilidades
kc: rectas · Hallar la ecuación de una recta con pendiente y punto, con dos puntos, paralela o perpendicular a otra, y leer su pendiente e intercepto · prerrequisitos: ecuaciones-lineales
kc: sistemas-2x2 · Resolver un sistema lineal 2×2 y reconocer cuándo no tiene solución o tiene infinitas · prerrequisitos: rectas
kc: modelos-lineales · Plantear y resolver con una ecuación o un sistema lineal un problema dado en palabras · prerrequisitos: sistemas-2x2

## Errores
mc: pendiente-invertida-cambio-x-sobre-y · rectas · calculas la pendiente como cambio en x sobre cambio en y, es decir, al revés
mc: resta-de-negativo-sin-cambiar-signo · rectas · al restar una coordenada negativa la tratas como positiva y el cambio sale mal
mc: pendiente-general-sin-cambiar-signo · rectas · en Ax + By = C tomas la pendiente como A/B, sin el signo menos de −A/B
mc: pendiente-es-coeficiente-de-x · rectas · lees la pendiente de Ax + By = C como el coeficiente A, sin despejar y
mc: perpendicular-solo-invierte · rectas · para la pendiente de la perpendicular inviertes la pendiente pero no le cambias el signo
mc: perpendicular-solo-cambia-signo · rectas · para la pendiente de la perpendicular cambias el signo pero no inviertes la pendiente
mc: punto-pendiente-signo-del-punto · rectas · al escribir y − y₁ = m(x − x₁) cambias el signo de una coordenada del punto
mc: distribuye-solo-un-termino-al-sustituir · sistemas-2x2 · al sustituir una expresión multiplicas el coeficiente solo por uno de los términos y no por todos
mc: solucion-con-x-e-y-intercambiadas · sistemas-2x2 · entregas el par con los valores de x e y intercambiados
mc: despeja-sin-cambiar-signo · sistemas-2x2 · al despejar una variable no cambias el signo del término que pasa al otro lado
mc: resta-sin-cambiar-signo-del-segundo-termino · sistemas-2x2 · al restar dos ecuaciones no cambias el signo de un término negativo de la ecuación que restas
mc: confunde-infinitas-con-sin-solucion · sistemas-2x2 · cambias un caso por el otro: dices que no hay solución cuando queda 0 = 0, o que hay infinitas cuando queda una igualdad falsa
mc: compara-solo-un-coeficiente · sistemas-2x2 · decides cuántas soluciones hay mirando solo los coeficientes de x, sin comparar los de y ni los términos independientes
mc: solucion-cero-cero-al-eliminar-todo · sistemas-2x2 · cuando al eliminar desaparecen x e y, concluyes que la solución es x = 0, y = 0
mc: relacion-planteada-al-reves · modelos-lineales · cambias los papeles en la relación del enunciado, por ejemplo intercambias el cobro fijo con el cobro por unidad
mc: ignora-el-termino-fijo · modelos-lineales · omites el cargo fijo del modelo y usas solo la parte que depende de la variable
mc: responde-otra-cantidad-del-planteamiento · modelos-lineales · resuelves bien pero contestas una cantidad intermedia que no es la que preguntan
mc: porcentaje-sobre-la-base-equivocada · modelos-lineales · aplicas el porcentaje sobre una cantidad que no es la base del enunciado
mc: reparte-por-igual-sin-ponderar · modelos-lineales · supones partes o precios iguales en vez de plantear la ecuación con las cantidades de cada tipo
mc: asigna-todo-el-total-a-un-solo-articulo · modelos-lineales · divides el total entre el precio de un solo tipo de artículo como si el otro no existiera

## Preguntas

### P71 · dificultad 1 · kc: rectas · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
¿Cuál es la pendiente de la recta 3x + 4y = 12?

- A) 3/4 · [pendiente-general-sin-cambiar-signo] tomas A/B = 3/4 y olvidas que la pendiente es −A/B
- B) −3/4 · CORRECTA
- C) 3 · [pendiente-es-coeficiente-de-x] tomas el coeficiente de x como si fuera la pendiente, sin despejar y
- D) −4/3 · [pendiente-invertida-cambio-x-sobre-y] inviertes la razón y usas −B/A, el cambio en x sobre el cambio en y

solución: se despeja y: 4y = −3x + 12, y = −(3/4)x + 3. La pendiente es el coeficiente de x, −3/4, y el intercepto con el eje y es 3.

### P72 · dificultad 2 · kc: rectas · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
La recta que pasa por (−1, 7) y (5, −2) tiene ecuación:

- A) y = −3x/2 + 17/2 · [punto-pendiente-signo-del-punto] usas la pendiente correcta pero escribes y − 7 = −(3/2)(x − 1), con el signo de la coordenada −1 cambiado
- B) y = −2x/3 + 19/3 · [pendiente-invertida-cambio-x-sobre-y] calculas la pendiente como 6/(−9), cambio en x sobre cambio en y
- C) y = −3x/2 + 11/2 · CORRECTA
- D) y = −9x/4 + 19/4 · [resta-de-negativo-sin-cambiar-signo] calculas 5 − (−1) como 5 − 1 = 4 y la pendiente te sale −9/4

solución: la pendiente es m = (−2 − 7)/(5 − (−1)) = −9/6 = −3/2. Con el punto (−1, 7): y − 7 = −(3/2)(x + 1), y = −(3/2)x − 3/2 + 7 = −(3/2)x + 11/2. Comprobación: en x = 5 da −15/2 + 11/2 = −2.

### P73 · dificultad 2 · kc: rectas · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
La recta perpendicular a y = (2/3)x + 1 que pasa por (−3, 4) es:

- A) y = 3x/2 + 17/2 · [perpendicular-solo-invierte] inviertes 2/3 y obtienes 3/2, pero no cambias el signo
- B) y = −3x/2 − 1/2 · CORRECTA
- C) y = −2x/3 + 2 · [perpendicular-solo-cambia-signo] cambias el signo de 2/3 y no inviertes la pendiente
- D) y = −3x/2 + 17/2 · [punto-pendiente-signo-del-punto] usas la pendiente correcta, −3/2, pero escribes y − 4 = −(3/2)(x − 3) con el signo de la coordenada −3 cambiado

solución: la pendiente perpendicular a 2/3 es −3/2. Con el punto (−3, 4): y − 4 = −(3/2)(x + 3), y = −(3/2)x − 9/2 + 4 = −(3/2)x − 1/2. Comprobación: en x = −3 da 9/2 − 1/2 = 4.

### P74 · dificultad 2 · kc: rectas · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
La recta paralela a 3x + 5y = 15 que pasa por (4, 1) corta el eje y en:

- A) −7/5 · [pendiente-general-sin-cambiar-signo] tomas la pendiente como 3/5 en vez de −3/5
- B) −11 · [pendiente-es-coeficiente-de-x] tomas el coeficiente 3 como pendiente de la paralela
- C) 7/5 · [punto-pendiente-signo-del-punto] escribes y + 1 = −(3/5)(x − 4), con el signo de la coordenada y del punto cambiado
- D) 17/5 · CORRECTA

solución: se despeja y en 3x + 5y = 15: y = −(3/5)x + 3, así que la pendiente es −3/5 y la paralela tiene la misma. Con el punto (4, 1): y − 1 = −(3/5)(x − 4), y = −(3/5)x + 12/5 + 1 = −(3/5)x + 17/5. El intercepto es 17/5.

### P75 · dificultad 3 · kc: rectas · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Sea L la recta que pasa por (−4, 5) y (2, −7). La recta perpendicular a L que pasa por (3, −2) corta el eje x en x igual a:

- A) −1 · [perpendicular-solo-invierte] usas −1/2 como pendiente de la perpendicular, inviertes −2 pero no le cambias el signo
- B) 7 · CORRECTA
- C) −9 · [resta-de-negativo-sin-cambiar-signo] calculas 2 − (−4) como 2 − 4 = −2 y la pendiente de L te sale 6
- D) 4 · [perpendicular-solo-cambia-signo] usas 2 como pendiente de la perpendicular, cambias el signo de −2 pero no la inviertes

solución: la pendiente de L es (−7 − 5)/(2 − (−4)) = −12/6 = −2. La perpendicular tiene pendiente 1/2. Con el punto (3, −2): y + 2 = (1/2)(x − 3). Corta el eje x cuando y = 0: 2 = (x − 3)/2, x − 3 = 4, x = 7.

### P76 · dificultad 1 · kc: sistemas-2x2 · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
La solución (x, y) del sistema 3x + 2y = 12 y 3x − y = 3 es:

- A) (3, 2) · [solucion-con-x-e-y-intercambiadas] resuelves bien pero entregas el par con x e y intercambiados
- B) (−2, 9) · [resta-sin-cambiar-signo-del-segundo-termino] restas las ecuaciones y haces 2y − y = y en vez de 2y − (−y) = 3y, y luego sustituyes en la primera
- C) (5/3, 2) · [distribuye-solo-un-termino-al-sustituir] despejas y = 3x − 3 y al sustituir multiplicas el 2 solo por 3x, quedando 3x + 6x − 3 = 12
- D) (2, 3) · CORRECTA

solución: se restan las ecuaciones: (3x + 2y) − (3x − y) = 12 − 3, así que 3y = 9 y y = 3. Sustituyendo en 3x − y = 3: 3x = 6, x = 2. Comprobación en la primera: 6 + 6 = 12.

### P77 · dificultad 2 · kc: sistemas-2x2 · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Resuelve por sustitución el sistema x − 2y = 8 y 3x + y = 3.

- A) (−6, −7) · [distribuye-solo-un-termino-al-sustituir] despejas x = 8 + 2y y escribes 3x como 3·8 + 2y, multiplicando el 3 solo por el 8
- B) (2, −3) · CORRECTA
- C) (−3, 2) · [solucion-con-x-e-y-intercambiadas] resuelves bien pero entregas el par con x e y intercambiados
- D) (−2/5, 21/5) · [despeja-sin-cambiar-signo] despejas x = 8 − 2y, sin cambiar el signo del término −2y al pasarlo

solución: de x − 2y = 8 se despeja x = 8 + 2y. En la segunda ecuación: 3(8 + 2y) + y = 3, 24 + 7y = 3, 7y = −21, y = −3. Entonces x = 8 + 2(−3) = 2. Comprobación en la segunda: 6 − 3 = 3.

### P78 · dificultad 2 · kc: sistemas-2x2 · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Resuelve por eliminación el sistema x + 2y = 2 y 3x − 5y = 17.

- A) (24, 11) · [despeja-sin-cambiar-signo] despejas x = 2 + 2y en la primera ecuación, sin cambiar el signo de 2y al pasarlo
- B) (−1, 4) · [solucion-con-x-e-y-intercambiadas] resuelves bien pero entregas el par con x e y intercambiados
- C) (24, −11) · [resta-sin-cambiar-signo-del-segundo-termino] multiplicas la primera por 3 y restas, pero haces 6y − 5y = y en vez de 6y − (−5y) = 11y
- D) (4, −1) · CORRECTA

solución: se multiplica la primera ecuación por 3: 3x + 6y = 6. Se resta la segunda: (3x + 6y) − (3x − 5y) = 6 − 17, así que 11y = −11 y y = −1. De la primera: x = 2 − 2(−1) = 4. Comprobación en la segunda: 12 + 5 = 17.

### P79 · dificultad 2 · kc: sistemas-2x2 · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Al resolver el sistema x + 3y = 2 y 2x + 6y = 7, ¿qué se concluye?

- A) Tiene infinitas soluciones · [confunde-infinitas-con-sin-solucion] al eliminar una variable desaparece también la otra y lo tomas como un caso de infinitas, sin mirar que queda 0 = 3
- B) Tiene una sola solución, porque los coeficientes de x son distintos · [compara-solo-un-coeficiente] comparas 1 con 2 y no revisas los coeficientes de y ni los términos independientes
- C) No tiene solución · CORRECTA
- D) Tiene una sola solución, x = 0 y y = 0 · [solucion-cero-cero-al-eliminar-todo] como al eliminar desaparecen x e y, concluyes que ambas valen 0

solución: se multiplica la primera ecuación por 2: 2x + 6y = 4. Al restarle la segunda queda 0 = 4 − 7 = −3, que es falso. Las dos rectas tienen la misma pendiente, −1/3, y cortan al eje y en puntos distintos: son paralelas, así que el sistema no tiene solución. El par (0, 0) tampoco sirve: no cumple la primera ecuación.

### P80 · dificultad 3 · kc: sistemas-2x2 · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
El sistema formado por $\frac{x}{2} + \frac{y}{3} = 1$ y 3x + 2y = 6 tiene:

- A) Ninguna solución · [confunde-infinitas-con-sin-solucion] al quitar denominadores y restar queda 0 = 0, y lo lees como que no hay solución
- B) Una sola solución, x = 0 y y = 0 · [solucion-cero-cero-al-eliminar-todo] como al eliminar desaparecen x e y, concluyes que ambas valen 0
- C) Una sola solución, porque los coeficientes de x, 1/2 y 3, son distintos · [compara-solo-un-coeficiente] comparas solo los coeficientes de x sin multiplicar la primera ecuación por 6
- D) Infinitas soluciones · CORRECTA

solución: se multiplica la primera ecuación por 6: 3x + 2y = 6, que es exactamente la segunda. Las dos ecuaciones describen la misma recta, así que todos los puntos de 3x + 2y = 6 son solución. El par (0, 0) no lo es: 0 ≠ 6.

### P81 · dificultad 1 · kc: modelos-lineales · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Un taxi cobra 5 mil pesos por abordar y 3 mil pesos por cada kilómetro. Un viaje costó 23 mil pesos. ¿Cuántos kilómetros recorrió?

- A) 4 km · [relacion-planteada-al-reves] planteas 3 + 5x = 23, con el cobro fijo y el cobro por kilómetro intercambiados
- B) 6 km · CORRECTA
- C) 23/3 km · [ignora-el-termino-fijo] divides 23 entre 3 sin restar antes los 5 mil del cobro de abordaje
- D) 18 km · [responde-otra-cantidad-del-planteamiento] calculas 23 − 5 = 18, que es lo pagado por los kilómetros, y lo das como si fueran los kilómetros

solución: el costo es C = 5 + 3x, con x en kilómetros. Si C = 23: 3x = 18 y x = 6. Comprobación: 5 + 3·6 = 23.

### P82 · dificultad 2 · kc: modelos-lineales · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
En una cafetería, 3 cafés y 2 jugos cuestan 19 mil pesos, y 1 café con 1 jugo cuesta 8 mil pesos. ¿Cuánto cuesta un café?

- A) 5 mil pesos · [relacion-planteada-al-reves] asignas los 3 a los jugos y los 2 a los cafés: planteas 2c + 3j = 19
- B) 19/3 mil pesos · [asigna-todo-el-total-a-un-solo-articulo] divides 19 entre los 3 cafés como si los jugos no costaran nada
- C) 4 mil pesos · [reparte-por-igual-sin-ponderar] supones que el café y el jugo cuestan lo mismo y divides 8 entre 2
- D) 3 mil pesos · CORRECTA

solución: sean c el precio de un café y j el de un jugo, en miles de pesos. Entonces 3c + 2j = 19 y c + j = 8. De la segunda, j = 8 − c. En la primera: 3c + 2(8 − c) = 19, c + 16 = 19, c = 3. Entonces j = 5. Comprobación: 9 + 10 = 19.

### P83 · dificultad 2 · kc: modelos-lineales · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Una tienda ofrece 20 % de descuento sobre el precio de lista y cobra además 5 mil pesos de envío. Una compra costó 53 mil pesos en total. ¿Cuál era el precio de lista, en miles de pesos?

- A) 57,6 mil pesos · [porcentaje-sobre-la-base-equivocada] restas el envío, 53 − 5 = 48, y le sumas el 20 % de 48 en vez de dividir entre 0,8
- B) 60 mil pesos · CORRECTA
- C) 66,25 mil pesos · [ignora-el-termino-fijo] divides 53 entre 0,8 sin restar antes los 5 mil del envío
- D) 48 mil pesos · [responde-otra-cantidad-del-planteamiento] restas el envío y contestas lo que se pagó por la mercancía, no el precio de lista

solución: sea p el precio de lista. Después del descuento se paga 0,8p y se suman 5 de envío: 0,8p + 5 = 53. Entonces 0,8p = 48 y p = 60. Comprobación: 0,8·60 + 5 = 53.

### P84 · dificultad 2 · kc: modelos-lineales · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Un cine vendió 120 boletos y recaudó 720 mil pesos. Cada boleto de adulto costó 8 mil pesos y cada boleto de niño 5 mil. ¿Cuántos boletos de adulto se vendieron?

- A) 60 adultos · [reparte-por-igual-sin-ponderar] supones que se vendieron tantos boletos de adulto como de niño
- B) 80 adultos · [relacion-planteada-al-reves] intercambias los precios y planteas 5a + 8(120 − a) = 720
- C) 40 adultos · CORRECTA
- D) 90 adultos · [asigna-todo-el-total-a-un-solo-articulo] divides 720 entre 8 como si todo el dinero fuera de boletos de adulto

solución: sea a el número de boletos de adulto; los de niño son 120 − a. El recaudo es 8a + 5(120 − a) = 720, es decir, 3a + 600 = 720, 3a = 120 y a = 40. Comprobación: 40·8 + 80·5 = 320 + 400 = 720.

### P85 · dificultad 3 · kc: modelos-lineales · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Se tienen 20 litros de una solución salina al 40 %. ¿Cuántos litros de solución al 10 % hay que añadir para obtener una mezcla al 30 %?

- A) 20 L · [reparte-por-igual-sin-ponderar] como 30 % queda entre 10 % y 40 %, supones que hay que añadir la misma cantidad que ya tienes
- B) 30 L · [responde-otra-cantidad-del-planteamiento] resuelves bien pero contestas el volumen total de la mezcla, no lo que se añade
- C) 40 L · [porcentaje-sobre-la-base-equivocada] aplicas el 30 % solo a los litros añadidos y no al volumen total: 0,1x + 8 = 0,3x
- D) 10 L · CORRECTA

solución: sea x los litros añadidos. La sal que hay es 0,4·20 + 0,1x y debe ser el 30 % del volumen total: 0,1x + 8 = 0,3(x + 20) = 0,3x + 6. Entonces 2 = 0,2x y x = 10. Comprobación: la sal es 8 + 1 = 9 litros y el 30 % de 30 litros es 9.
