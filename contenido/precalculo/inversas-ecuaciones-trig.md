# Funciones trigonométricas inversas y ecuaciones

Evaluación del arcoseno, el arcocoseno y el arcotangente con sus composiciones, y resolución de ecuaciones trigonométricas en un intervalo dado, con todas sus soluciones. Cae en el Parcial 4 (semana 16).

## Habilidades
kc: inversas-trig · Evaluar arcoseno, arcocoseno y arcotangente y sus composiciones respetando su rango · prerrequisitos: angulo-referencia, inversa
kc: ecuaciones-trig · Resolver ecuaciones trigonométricas en un intervalo y dar todas sus soluciones · prerrequisitos: inversas-trig, identidades-basicas

## Errores
mc: inversa-cancela-sin-rango · inversas-trig · das cualquier ángulo que tenga ese valor, sin comprobar que esté en el rango de la función inversa
mc: arccos-negativo-como-impar · inversas-trig · tratas el arcocoseno de un valor negativo como el negativo del arcocoseno del valor positivo, como si fuera una función impar
mc: arco-como-reciproco · inversas-trig · confundes la función inversa con el recíproco y inviertes el valor, como si sen⁻¹ fuera 1/sen
mc: arctan-rango-cero-pi · inversas-trig · para un valor negativo de la tangente das un ángulo del segundo cuadrante, como si el rango del arcotangente fuera (0, π)
mc: argumento-como-razon-pedida · inversas-trig · tomas el valor del argumento como si ya fuera la razón que te piden, sin armar el triángulo rectángulo
mc: lado-faltante-por-suma-resta · inversas-trig · hallas el lado que falta sumando o restando los lados dados, en vez de usar el teorema de Pitágoras
mc: referencia-sin-signo · inversas-trig · usas el ángulo de referencia positivo y olvidas que el signo negativo del valor lo lleva a otro cuadrante
mc: una-solucion-por-vuelta · ecuaciones-trig · te quedas con el ángulo que te da la calculadora y olvidas la otra solución que tiene el mismo valor en el intervalo
mc: segunda-solucion-regla-ajena · ecuaciones-trig · para la segunda solución aplicas una regla que no corresponde al signo del valor (π − θ, π + θ o 2π − θ) y caes en un cuadrante donde la función tiene otro signo
mc: divide-por-factor-trig · ecuaciones-trig · divides los dos lados por sen x o por cos x y pierdes las soluciones que lo hacen cero
mc: angulo-multiple-sin-ampliar-intervalo · ecuaciones-trig · en una ecuación con 2x resuelves el ángulo doble solo en el intervalo original, sin ampliarlo al doble, y pierdes la mitad de las soluciones

## Preguntas

### P146 · dificultad 1 · kc: inversas-trig · borrador · origen: ia (sonnet-5.5)
El valor de arcsen(−√3/2) es:

- A) −π/3 · CORRECTA
- B) 4π/3 · [inversa-cancela-sin-rango] das un ángulo cuyo seno vale −√3/2, pero el arcoseno solo devuelve ángulos entre −π/2 y π/2
- C) π/3 · [referencia-sin-signo] usas el ángulo de referencia π/3 y olvidas que el valor es negativo
- D) −2√3/3 · [arco-como-reciproco] lees arcsen como el recíproco del seno y calculas 1/(−√3/2)

solución: el arcoseno devuelve el único ángulo de [−π/2, π/2] cuyo seno es el valor dado. Como sen(π/3) = √3/2 y el valor buscado es negativo, el ángulo queda en la parte negativa del intervalo: −π/3. Se comprueba: sen(−π/3) = −√3/2. El ángulo 4π/3 también tiene seno −√3/2, pero está fuera del rango del arcoseno.

### P147 · dificultad 2 · kc: inversas-trig · borrador · origen: ia (sonnet-5.5)
El valor de arctan(−√3) es:

- A) −π/3 · CORRECTA
- B) 2π/3 · [arctan-rango-cero-pi] buscas el ángulo entre 0 y π con tangente −√3 y das el del segundo cuadrante
- C) 5π/3 · [inversa-cancela-sin-rango] das un ángulo con tangente −√3, pero fuera del rango (−π/2, π/2) del arcotangente
- D) −√3/3 · [arco-como-reciproco] calculas 1/(−√3) como si arctan fuera el recíproco de la tangente

solución: el arcotangente devuelve un ángulo del intervalo abierto (−π/2, π/2). Como tan(π/3) = √3, y la tangente es impar, tan(−π/3) = −√3, y −π/3 está en ese intervalo. Los ángulos 2π/3 y 5π/3 también tienen tangente −√3, pero no están en el rango.

### P148 · dificultad 2 · kc: inversas-trig · borrador · origen: ia (sonnet-5.5)
Calcula arccos(cos(4π/3)).

- A) 2π/3 · CORRECTA
- B) 4π/3 · [inversa-cancela-sin-rango] cancelas arccos con cos y devuelves el ángulo de entrada, que no está en [0, π]
- C) −π/3 · [arccos-negativo-como-impar] escribes arccos(−1/2) = −arccos(1/2), como si el arcocoseno fuera impar
- D) π/3 · [referencia-sin-signo] das el ángulo de referencia π/3 y olvidas que el coseno es negativo

solución: cos(4π/3) = −1/2, así que se pide arccos(−1/2). El arcocoseno devuelve un ángulo del intervalo [0, π] con coseno −1/2. En ese intervalo el coseno es negativo solo en el segundo cuadrante, con ángulo de referencia π/3: π − π/3 = 2π/3. Como 4π/3 queda fuera de [0, π], la composición no devuelve el ángulo de entrada.

### P149 · dificultad 2 · kc: inversas-trig · borrador · origen: ia (sonnet-5.5)
Calcula sen(arccos(−3/5)).

- A) 4/5 · CORRECTA
- B) −4/5 · [arccos-negativo-como-impar] tomas arccos(−3/5) como −arccos(3/5), un ángulo del cuarto cuadrante, y le pones seno negativo
- C) −3/5 · [argumento-como-razon-pedida] devuelves el valor del argumento como si fuera el seno
- D) 2/5 · [lado-faltante-por-suma-resta] hallas el cateto que falta como 5 − 3 = 2 en vez de usar Pitágoras

solución: sea θ = arccos(−3/5), con θ en [0, π] y cos θ = −3/5. Como el coseno es negativo, θ está en el segundo cuadrante, donde el seno es positivo. Con la identidad sen²θ + cos²θ = 1 se obtiene sen²θ = 1 − 9/25 = 16/25, y como sen θ ≥ 0, sen θ = 4/5.

### P150 · dificultad 3 · kc: inversas-trig · borrador · origen: ia (sonnet-5.5)
Calcula sen(arctan(−3/4)).

- A) −3/5 · CORRECTA
- B) 3/5 · [arctan-rango-cero-pi] ubicas el ángulo en el segundo cuadrante, como si arctan devolviera valores entre 0 y π, y le pones seno positivo
- C) −3/4 · [argumento-como-razon-pedida] devuelves el valor del argumento como si fuera el seno, sin dividir entre la hipotenusa
- D) −3/7 · [lado-faltante-por-suma-resta] hallas la hipotenusa como 4 + 3 = 7 en vez de usar Pitágoras

solución: sea θ = arctan(−3/4), con θ en (−π/2, π/2) y tan θ = −3/4. Como la tangente es negativa, θ está en el cuarto cuadrante. Se arma un triángulo con cateto opuesto 3 (en valor absoluto) y cateto adyacente 4, así que la hipotenusa es √(9 + 16) = 5. El seno en el cuarto cuadrante es negativo: sen θ = −3/5.

### P151 · dificultad 1 · kc: ecuaciones-trig · borrador · origen: ia (sonnet-5.5)
Las soluciones de 2 sen x + 3 = 4 en el intervalo [0, 2π) son:

- A) π/6 y 5π/6 · CORRECTA
- B) π/6 · [una-solucion-por-vuelta] te quedas con el ángulo que da el arcoseno y olvidas la otra solución del mismo valor
- C) π/6 y 7π/6 · [segunda-solucion-regla-ajena] para la segunda solución sumas π a π/6, y eso cambia el signo del seno
- D) π/6 y 11π/6 · [segunda-solucion-regla-ajena] para la segunda solución usas 2π − π/6, que lleva el seno al signo contrario

solución: al despejar queda sen x = 1/2. El seno es positivo en los cuadrantes primero y segundo y el ángulo de referencia es π/6, así que las soluciones son π/6 y π − π/6 = 5π/6. Se comprueba: 2 sen(5π/6) + 3 = 2(1/2) + 3 = 4.

### P152 · dificultad 2 · kc: ecuaciones-trig · borrador · origen: ia (sonnet-5.5)
Las soluciones de 2 cos x + √3 = 0 en el intervalo [0, 2π) son:

- A) 5π/6 y 7π/6 · CORRECTA
- B) 5π/6 · [una-solucion-por-vuelta] te quedas con el ángulo que da el arcocoseno y olvidas el otro ángulo con el mismo coseno
- C) π/6 y 11π/6 · [segunda-solucion-regla-ajena] ubicas el ángulo de referencia π/6 en los cuadrantes donde el coseno es positivo
- D) π/6 y 5π/6 · [segunda-solucion-regla-ajena] para la segunda solución usas π − θ con θ = 5π/6, regla que sirve para el seno y no para el coseno

solución: al despejar queda cos x = −√3/2. El coseno es negativo en los cuadrantes segundo y tercero, y el ángulo de referencia es π/6. Las soluciones son π − π/6 = 5π/6 y π + π/6 = 7π/6. Se comprueba: cos(7π/6) = −√3/2.

### P153 · dificultad 2 · kc: ecuaciones-trig · borrador · origen: ia (sonnet-5.5)
Las soluciones de 2 sen²x = sen x en el intervalo [0, 2π) son:

- A) 0, π/6, 5π/6 y π · CORRECTA
- B) π/6 y 5π/6 · [divide-por-factor-trig] divides ambos lados entre sen x y pierdes las soluciones de sen x = 0
- C) 0, π/6 y π · [una-solucion-por-vuelta] resuelves sen x = 1/2 y te quedas solo con π/6, olvidando 5π/6
- D) 0, π/6, π y 11π/6 · [segunda-solucion-regla-ajena] para sen x = 1/2 usas 2π − π/6 como segunda solución, regla que sirve para el coseno

solución: se pasa todo a un lado y se saca sen x como factor: sen x (2 sen x − 1) = 0. Si sen x = 0, x = 0 o x = π. Si sen x = 1/2, el seno es positivo en los cuadrantes primero y segundo: x = π/6 o x = π − π/6 = 5π/6. Dividir entre sen x eliminaría 0 y π, que sí son soluciones.

### P154 · dificultad 2 · kc: ecuaciones-trig · borrador · origen: ia (sonnet-5.5)
Las soluciones de sen 2x = √3/2 en el intervalo [0, 2π) son:

- A) π/6, π/3, 7π/6 y 4π/3 · CORRECTA
- B) π/6 y π/3 · [angulo-multiple-sin-ampliar-intervalo] resuelves 2x solo entre 0 y 2π, sin ampliarlo hasta 4π
- C) π/6, 2π/3, 7π/6 y 5π/3 · [segunda-solucion-regla-ajena] para la segunda solución de 2x sumas π a π/3, y eso cambia el signo del seno
- D) π/6 y 7π/6 · [una-solucion-por-vuelta] tomas solo 2x = π/3 en cada vuelta y olvidas 2x = 2π/3

solución: si x está en [0, 2π), entonces 2x está en [0, 4π), es decir, dos vueltas. Se resuelve sen u = √3/2 con u = 2x: u = π/3, 2π/3, 7π/3 o 8π/3. Al dividir entre 2: x = π/6, π/3, 7π/6 o 4π/3.

### P155 · dificultad 3 · kc: ecuaciones-trig · borrador · origen: ia (sonnet-5.5)
Las soluciones de 2 sen²(2x) = √3 sen 2x en el intervalo [0, π) son:

- A) 0, π/6, π/3 y π/2 · CORRECTA
- B) π/6 y π/3 · [divide-por-factor-trig] divides entre sen 2x y pierdes las soluciones de sen 2x = 0
- C) 0, π/6 y π/3 · [angulo-multiple-sin-ampliar-intervalo] resuelves 2x solo entre 0 y π, cuando debe ir entre 0 y 2π, y pierdes x = π/2
- D) 0, π/6 y π/2 · [una-solucion-por-vuelta] en sen 2x = √3/2 tomas solo 2x = π/3 y olvidas 2x = 2π/3

solución: se pasa todo a un lado y se factoriza: sen 2x (2 sen 2x − √3) = 0. Si x está en [0, π), 2x está en [0, 2π). Si sen 2x = 0, 2x = 0 o 2x = π, así que x = 0 o x = π/2. Si sen 2x = √3/2, 2x = π/3 o 2π/3, así que x = π/6 o x = π/3. Las soluciones son 0, π/6, π/3 y π/2.
