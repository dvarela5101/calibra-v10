# Leyes de Newton

Talleres 4 a 6. Errores a cazar: poner la normal siempre igual al peso, confundir fricción estática con cinética, y olvidar la tercera ley en sistemas acoplados.

## Habilidades
kc: newton · Leyes de Newton

## Errores
mc: newton-e1 · newton · asumes que la normal siempre es igual al peso
mc: newton-e2 · newton · confundes la componente paralela con la perpendicular al plano
mc: newton-e3 · newton · duplicas incorrectamente el valor de la normal
mc: newton-e4 · newton · confundes fricción estática con fricción cinética
mc: newton-e5 · newton · usas mal el peso en el cálculo del coeficiente
mc: newton-e6 · newton · divides incorrectamente las fuerzas
mc: newton-e7 · newton · olvidas aplicar la tercera ley de Newton al sistema acoplado
mc: newton-e8 · newton · asumes que la tensión es igual a la fuerza aplicada
mc: newton-e9 · newton · divides la fuerza por el número de bloques sin considerar las masas

## Preguntas

### P4 · dificultad 2 · kc: newton · revisada · origen: humano · revisó: prototipo
Un bloque de 5 kg está en reposo sobre un plano inclinado de 30°. ¿Cuál es la magnitud de la fuerza normal? (g = 10 m/s²)

- A) 43.3 N · CORRECTA
- B) 50 N · [newton-e1]
- C) 25 N · [newton-e2]
- D) 86.6 N · [newton-e3]

### P5 · dificultad 2 · kc: newton · revisada · origen: humano · revisó: prototipo
Un objeto requiere 40 N para comenzar a moverse sobre una superficie, pero solo 30 N para mantenerlo en movimiento. Si la masa es 5 kg, ¿cuál es el coeficiente de fricción estática? (g = 10 m/s²)

- A) 0.8 · CORRECTA
- B) 0.6 · [newton-e4]
- C) 1.0 · [newton-e5]
- D) 0.4 · [newton-e6]

### P6 · dificultad 2 · kc: newton · revisada · origen: humano · revisó: prototipo
Dos bloques de 3 kg y 5 kg están conectados por una cuerda. Si se aplica una fuerza de 16 N al bloque de 5 kg, ¿cuál es la tensión en la cuerda? (superficie sin fricción)

- A) 6 N · CORRECTA
- B) 10 N · [newton-e7]
- C) 16 N · [newton-e8]
- D) 8 N · [newton-e9]

### P14 · dificultad 3 · kc: newton · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04
Un bloque de 4 kg está sobre un plano inclinado 37° con la horizontal, y el coeficiente de fricción cinética entre el bloque y el plano es $\mu_k = 0.25$. Una cuerda ligera, paralela al plano, pasa por una polea ligera y sin fricción en la parte alta del plano y sostiene del otro lado un bloque de 20 kg que cuelga libremente. El sistema se suelta desde el reposo: el bloque que cuelga desciende y el del plano sube. ¿Cuál es la tensión de la cuerda mientras se mueven? (g = 10 m/s², sen 37° = 0.6, cos 37° = 0.8)

- A) 200 N · [newton-e8] tomas la tensión igual al peso del bloque que cuelga, 20 kg × 10 m/s², como si ese peso pasara completo por la cuerda
- B) 65 N · [newton-e2] confundes la componente paralela con la perpendicular al plano: usas mg·cos 37° como la parte del peso que baja por el plano y mg·sen 37° como la normal
- C) 60 N · CORRECTA
- D) 100 N · [newton-e9] repartes el peso del bloque que cuelga entre los dos bloques, 200 N ÷ 2, sin considerar sus masas

solución: se toma como positivo el sentido del movimiento. En el plano, la normal es N = 4×10×cos 37° = 32 N, la fricción cinética es 0.25×32 = 8 N y la componente del peso a lo largo del plano es 4×10×sen 37° = 24 N; las dos van hacia abajo del plano, contra el movimiento. Segunda ley para el bloque del plano: T − 24 − 8 = 4a. Segunda ley para el bloque que cuelga: 200 − T = 20a. Al sumar queda 200 − 32 = 24a, así que a = 7 m/s², y T = 200 − 20×7 = 60 N. Se comprueba con el otro bloque: 60 − 32 = 4×7 = 28. Los 200 N suponen que la cuerda transmite todo el peso, los 100 N lo reparten entre dos bloques sin mirar las masas, y los 65 N salen de intercambiar seno y coseno (a = 6.75 m/s²).
