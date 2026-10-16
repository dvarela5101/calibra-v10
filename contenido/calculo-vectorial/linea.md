# Integrales de línea

7.1 a 7.6. Errores a cazar: parametrizar con la orientación contraria, confundir la integral de un campo escalar con la de uno vectorial.

## Habilidades
kc: linea · Integrales de línea

## Errores
mc: linea-e1 · linea · parametrizas con la orientación contraria
mc: linea-e2 · linea · confundes la integral de línea de un campo escalar con la de un campo vectorial
mc: linea-e3 · linea · integras y² en lugar de y
mc: linea-e4 · linea · parametrizas con orientación horaria
mc: linea-e5 · linea · solo recorres la mitad de la curva
mc: linea-e6 · linea · usas parametrización no cerrada
mc: linea-e7 · linea · inviertes la orientación de la integral
mc: linea-e8 · linea · confundes la integral de un campo vectorial con la de un campo escalar
mc: linea-e9 · linea · asumes que toda integral sobre un campo conservativo es cero

## Preguntas

### P7 · dificultad 2 · kc: linea · revisada · origen: humano · revisó: prototipo
Calcula $\int_C y\,dx$ donde C es el segmento de (0,0) a (1,1) parametrizado como r(t) = (t, t) con 0 ≤ t ≤ 1:

- A) 1/2 · CORRECTA
- B) -1/2 · [linea-e1]
- C) 1 · [linea-e2]
- D) 2 · [linea-e3]

### P8 · dificultad 2 · kc: linea · revisada · origen: humano · revisó: prototipo
Para calcular $\int_C F\cdot dr$ donde F = (y, -x) y C es el círculo unitario recorrido en sentido antihorario, la parametrización correcta es:

- A) r(t) = (cos t, sen t), 0 ≤ t ≤ 2π · CORRECTA
- B) r(t) = (sen t, cos t), 0 ≤ t ≤ 2π · [linea-e4]
- C) r(t) = (cos t, sen t), 0 ≤ t ≤ π · [linea-e5]
- D) r(t) = (t, √(1-t²)), -1 ≤ t ≤ 1 · [linea-e6]

### P9 · dificultad 2 · kc: linea · revisada · origen: humano · revisó: prototipo
Si F = ∇f es un campo conservativo y C es una curva de A a B, entonces $\int_C F\cdot dr$ es igual a:

- A) f(B) - f(A) · CORRECTA
- B) f(A) - f(B) · [linea-e7]
- C) |F| · longitud(C) · [linea-e8]
- D) 0 · [linea-e9]

### P15 · dificultad 1 · kc: linea · borrador · origen: ia (sonnet-5.5)
Calcula $\int_C F\cdot dr$, donde F(x,y) = (y, x) y C es el segmento parametrizado por r(t) = (2t, t), con 0 ≤ t ≤ 1:

- A) −2 · [linea-e1] recorres el segmento de (2, 1) a (0, 0), contra el sentido en que crece t
- B) 0 · [linea-e9] crees que la integral vale 0 solo porque F es conservativo, aunque el segmento no es una curva cerrada
- C) 2 · CORRECTA
- D) 2√5 · [linea-e8] después del producto punto F·r'(t) = 4t multiplicas además por |r'(t)| = √5, el factor de longitud de arco que lleva la integral de un campo escalar

solución: con r(t) = (2t, t) se tiene r'(t) = (2, 1) y F(r(t)) = (t, 2t). Entonces F·r' = 2t + 2t = 4t y $\int_C F\cdot dr = \int_0^1 4t\,dt = 2$.
Comprobación: F = ∇(xy), así que la integral es el valor de xy en (2, 1) menos su valor en (0, 0), es decir, 2 − 0 = 2.
No vale 0 porque ese resultado es para curvas cerradas, y este segmento va de (0, 0) a (2, 1). Si al producto punto se le agrega el factor |r'(t)| = √5 de la longitud de arco, que corresponde a la integral de un campo escalar, se obtiene $\int_0^1 4\sqrt{5}\,t\,dt = 2\sqrt{5}$; con la orientación contraria se obtiene −2.
