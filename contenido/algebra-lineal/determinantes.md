# Determinantes e inversas

Errores que vale la pena cazar: equivocar el signo del cofactor, creer que el determinante de una suma es la suma de determinantes, y concluir que una matriz con determinante cero tiene inversa.

## Habilidades
kc: determinantes · Determinantes e inversas

## Errores
mc: determinantes-e1 · determinantes · te equivocas en el signo del cofactor
mc: determinantes-e2 · determinantes · sumas las diagonales en lugar de restar (det = ad - bc)
mc: determinantes-e3 · determinantes · multiplicas todos los elementos creyendo que eso es el determinante
mc: determinantes-e4 · determinantes · crees que det(A + B) = det(A) + det(B)
mc: determinantes-e5 · determinantes · confundes la suma con el producto de matrices
mc: determinantes-e6 · determinantes · restas los determinantes incorrectamente
mc: determinantes-e7 · determinantes · crees que det = 0 no impide inversión
mc: determinantes-e8 · determinantes · confundes determinante cero con propiedades de la identidad
mc: determinantes-e9 · determinantes · confundes dependencia lineal con perpendicularidad

## Preguntas

### P7 · dificultad 2 · kc: determinantes · revisada · origen: humano · revisó: prototipo
Calcula el determinante de la matriz A = [[2, 1], [3, 4]].

- A) 5 · CORRECTA
- B) -5 · [determinantes-e1]
- C) 11 · [determinantes-e2]
- D) 20 · [determinantes-e3]

### P8 · dificultad 2 · kc: determinantes · revisada · origen: humano · revisó: prototipo
Si det(A) = 3 y det(B) = 2, ¿cuál es det(A + B)?

- A) No se puede determinar sin conocer A y B · CORRECTA
- B) 5 · [determinantes-e4]
- C) 6 · [determinantes-e5]
- D) 1 · [determinantes-e6]

### P9 · dificultad 2 · kc: determinantes · revisada · origen: humano · revisó: prototipo
La matriz C = [[1, 2], [2, 4]] tiene determinante cero. ¿Qué puedes concluir?

- A) C no tiene inversa · CORRECTA
- B) C tiene inversa igual a [[4, -2], [-2, 1]] · [determinantes-e7]
- C) C es la matriz identidad · [determinantes-e8]
- D) Las filas de C son perpendiculares · [determinantes-e9]

### P15 · dificultad 3 · kc: determinantes · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04
Sea A = [[1, 2, 1], [2, k, 3], [1, 1, 2]], donde k es un número real. ¿Para qué valores de k la matriz A tiene inversa?

- A) Para todo k excepto k = −8 · [determinantes-e9] igualas a cero el producto punto de las filas 2 y 3, como si A perdiera la inversa cuando dos filas son perpendiculares y no cuando son linealmente dependientes
- B) Para todo k, porque un determinante igual a cero no impide que la matriz tenga inversa · [determinantes-e7] crees que una matriz con determinante cero puede tener inversa
- C) Para todo k excepto k = −1 · [determinantes-e1] no alternas los signos de los cofactores de la primera fila y obtienes det(A) = k + 1 en vez de k − 3
- D) Para todo k excepto k = 3 · CORRECTA

solución: A tiene inversa exactamente cuando det(A) ≠ 0. Expandiendo por la primera fila, con los signos + − +: det(A) = 1·(2k − 3) − 2·(4 − 3) + 1·(2 − k) = 2k − 3 − 2 + 2 − k = k − 3. Entonces det(A) = 0 solo cuando k = 3, y A es invertible para todo k ≠ 3. En k = 3 la fila 3 es la fila 2 menos la fila 1, así que las filas son linealmente dependientes y A no tiene inversa. Para k = −8 las filas 2 y 3 son perpendiculares, pero det(A) = −11 ≠ 0 y A sí tiene inversa. Para k = −1, det(A) = −4 ≠ 0.
