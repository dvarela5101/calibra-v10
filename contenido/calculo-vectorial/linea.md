# Integrales de línea

Integrales de funciones escalares sobre trayectorias e integrales de línea de campos vectoriales, incluido el caso de los campos gradiente (secciones 7.1 y 7.2 del libro guía). Es del Parcial 2, semana 13. Errores a cazar: parametrizar con la orientación contraria y confundir la integral de un campo escalar con la de uno vectorial.

## Habilidades
kc: integral-linea-escalar · Calcular la integral de una función escalar sobre una trayectoria con el factor de longitud de arco · prerrequisitos: trayectorias
kc: integral-linea-vectorial · Calcular el trabajo de un campo vectorial sobre una curva parametrizada con la orientación correcta, también con el teorema de los campos gradiente · prerrequisitos: trayectorias, gradiente-direccional

## Errores
mc: linea-e1 · integral-linea-vectorial · parametrizas con la orientación contraria
mc: linea-e2 · integral-linea-vectorial · confundes la integral de línea de un campo escalar con la de un campo vectorial
mc: linea-e3 · integral-linea-vectorial · integras y² en lugar de y
mc: linea-e4 · integral-linea-vectorial · parametrizas con orientación horaria
mc: linea-e5 · integral-linea-vectorial · solo recorres la mitad de la curva
mc: linea-e6 · integral-linea-vectorial · usas parametrización no cerrada
mc: linea-e7 · integral-linea-vectorial · inviertes la orientación de la integral
mc: linea-e8 · integral-linea-vectorial · confundes la integral de un campo vectorial con la de un campo escalar
mc: linea-e9 · integral-linea-vectorial · asumes que toda integral sobre un campo conservativo es cero
mc: linea-esc-sin-factor-arco · integral-linea-escalar · integras f(r(t)) dt y olvidas multiplicar por |r'(t)|, el factor de longitud de arco
mc: linea-esc-norma-sin-raiz · integral-linea-escalar · usas |r'(t)|² como factor de longitud de arco, sin sacar la raíz cuadrada
mc: linea-esc-una-componente-de-velocidad · integral-linea-escalar · multiplicas por una sola componente de r'(t) en lugar de por su norma |r'(t)|
mc: linea-esc-signo-por-sentido · integral-linea-escalar · crees que la integral de una función escalar cambia de signo si recorres la curva en sentido contrario
mc: linea-esc-valor-extremo-por-longitud · integral-linea-escalar · evalúas f en un extremo de la curva y lo multiplicas por la longitud en lugar de integrar
mc: linea-esc-solo-longitud · integral-linea-escalar · integras solo |r'(t)| y olvidas la función f

## Preguntas

### P7 · dificultad 2 · kc: integral-linea-vectorial · revisada · origen: humano · revisó: prototipo · ⚠ revisar
Calcula $\int_C y\,dx$ donde C es el segmento de (0,0) a (1,1) parametrizado como r(t) = (t, t) con 0 ≤ t ≤ 1:

- A) 1/2 · CORRECTA
- B) -1/2 · [linea-e1]
- C) 1 · [linea-e2]
- D) 2 · [linea-e3]

### P8 · dificultad 2 · kc: integral-linea-vectorial · revisada · origen: humano · revisó: prototipo · ⚠ revisar
Para calcular $\int_C F\cdot dr$ donde F = (y, -x) y C es el círculo unitario recorrido en sentido antihorario, la parametrización correcta es:

- A) r(t) = (cos t, sen t), 0 ≤ t ≤ 2π · CORRECTA
- B) r(t) = (sen t, cos t), 0 ≤ t ≤ 2π · [linea-e4]
- C) r(t) = (cos t, sen t), 0 ≤ t ≤ π · [linea-e5]
- D) r(t) = (t, √(1-t²)), -1 ≤ t ≤ 1 · [linea-e6]

### P9 · dificultad 2 · kc: integral-linea-vectorial · revisada · origen: humano · revisó: prototipo · ⚠ revisar
Si F = ∇f es un campo conservativo y C es una curva de A a B, entonces $\int_C F\cdot dr$ es igual a:

- A) f(B) - f(A) · CORRECTA
- B) f(A) - f(B) · [linea-e7]
- C) |F| · longitud(C) · [linea-e8]
- D) 0 · [linea-e9]

### P15 · dificultad 1 · kc: integral-linea-vectorial · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04 · ⚠ revisar
Calcula $\int_C F\cdot dr$, donde F(x,y) = (y, x) y C es el segmento parametrizado por r(t) = (2t, t), con 0 ≤ t ≤ 1:

- A) −2 · [linea-e1] recorres el segmento de (2, 1) a (0, 0), contra el sentido en que crece t
- B) 0 · [linea-e9] crees que la integral vale 0 solo porque F es conservativo, aunque el segmento no es una curva cerrada
- C) 2 · CORRECTA
- D) 2√5 · [linea-e8] después del producto punto F·r'(t) = 4t multiplicas además por |r'(t)| = √5, el factor de longitud de arco que lleva la integral de un campo escalar

solución: con r(t) = (2t, t) se tiene r'(t) = (2, 1) y F(r(t)) = (t, 2t). Entonces F·r' = 2t + 2t = 4t y $\int_C F\cdot dr = \int_0^1 4t\,dt = 2$.
Comprobación: F = ∇(xy), así que la integral es el valor de xy en (2, 1) menos su valor en (0, 0), es decir, 2 − 0 = 2.
No vale 0 porque ese resultado es para curvas cerradas, y este segmento va de (0, 0) a (2, 1). Si al producto punto se le agrega el factor |r'(t)| = √5 de la longitud de arco, que corresponde a la integral de un campo escalar, se obtiene $\int_0^1 4\sqrt{5}\,t\,dt = 2\sqrt{5}$; con la orientación contraria se obtiene −2.

### P79 · dificultad 1 · kc: integral-linea-escalar · borrador · origen: ia (sonnet-5.5)
Calcula $\int_C (x+y)\,ds$, donde C es el segmento parametrizado por r(t) = (3t, 4t), con 0 ≤ t ≤ 1:

- A) 7/2 · [linea-esc-sin-factor-arco] integras x + y = 7t entre 0 y 1 sin multiplicar por |r'(t)| = 5
- B) 35 · [linea-esc-valor-extremo-por-longitud] evalúas x + y en el punto final (3, 4), que da 7, y lo multiplicas por la longitud 5 del segmento en lugar de integrar
- C) 35/2 · CORRECTA
- D) 5 · [linea-esc-solo-longitud] integras solo |r'(t)| = 5 y olvidas la función x + y

solución: r'(t) = (3, 4), así que |r'(t)| = √(9 + 16) = 5. Sobre la curva x + y = 3t + 4t = 7t. Entonces $\int_C (x+y)\,ds = \int_0^1 7t\cdot 5\,dt = 35\cdot\frac{1}{2} = \frac{35}{2}$.
Sin el factor 5 queda 7/2; evaluar en el extremo y multiplicar por la longitud da 35; integrar solo la rapidez da 5.

### P80 · dificultad 2 · kc: integral-linea-escalar · borrador · origen: ia (sonnet-5.5)
Calcula $\int_C xy\,ds$, donde C es el cuarto de la circunferencia x² + y² = 4 en el primer cuadrante, parametrizado por r(t) = (2 cos t, 2 sen t), con 0 ≤ t ≤ π/2:

- A) 4 · CORRECTA
- B) 8 · [linea-esc-norma-sin-raiz] usas x'(t)² + y'(t)² = 4 como factor de longitud de arco en lugar de su raíz cuadrada 2
- C) π · [linea-esc-solo-longitud] integras solo |r'(t)| = 2 entre 0 y π/2 y olvidas la función xy
- D) 8/3 · [linea-esc-una-componente-de-velocidad] multiplicas por y'(t) = 2 cos t en lugar de por |r'(t)| = 2

solución: r'(t) = (−2 sen t, 2 cos t), |r'(t)| = 2. Sobre la curva xy = 4 cos t sen t. Entonces $\int_C xy\,ds = \int_0^{\pi/2} 4\cos t\,\sen t\cdot 2\,dt = 8\int_0^{\pi/2}\sen t\cos t\,dt = 8\cdot\frac{1}{2} = 4$.
Con 4 como factor sale 8; con solo |r'| sale la longitud π; con y'(t) sale $8\int_0^{\pi/2}\cos^2 t\,\sen t\,dt = 8/3$.

### P81 · dificultad 2 · kc: integral-linea-escalar · borrador · origen: ia (sonnet-5.5)
Sea C el arco de la parábola y = x² que va de (1, 1) a (0, 0). El valor de $\int_C x\,ds$ es:

- A) $\frac{5\sqrt{5}-1}{12}$ · CORRECTA
- B) $-\frac{5\sqrt{5}-1}{12}$ · [linea-esc-signo-por-sentido] como C se recorre de (1, 1) a (0, 0), contra el sentido en que crece x, crees que la integral sale con signo negativo
- C) 3/2 · [linea-esc-norma-sin-raiz] usas 1 + 4t² como factor de longitud de arco en lugar de su raíz cuadrada √(1 + 4t²)
- D) 2/3 · [linea-esc-una-componente-de-velocidad] multiplicas por y'(t) = 2t en lugar de por |r'(t)| = √(1 + 4t²)

solución: la integral de una función escalar no depende del sentido, así que se parametriza con r(t) = (t, t²), 0 ≤ t ≤ 1. Entonces |r'(t)| = √(1 + 4t²) y $\int_C x\,ds = \int_0^1 t\sqrt{1+4t^2}\,dt$. Con u = 1 + 4t², du = 8t dt: $\frac{1}{8}\int_1^5 \sqrt{u}\,du = \frac{1}{8}\cdot\frac{2}{3}(5\sqrt{5}-1) = \frac{5\sqrt{5}-1}{12}$.
Sin la raíz queda $\int_0^1 t(1+4t^2)\,dt = 3/2$; con y'(t) queda $\int_0^1 2t^2\,dt = 2/3$.

### P82 · dificultad 2 · kc: integral-linea-escalar · borrador · origen: ia (sonnet-5.5)
Calcula $\int_C (x+y+z)\,ds$, donde C es el segmento parametrizado por r(t) = (2t, 4t, 4t), con 0 ≤ t ≤ 1:

- A) 5 · [linea-esc-sin-factor-arco] integras x + y + z = 10t entre 0 y 1 sin multiplicar por |r'(t)| = 6
- B) 180 · [linea-esc-norma-sin-raiz] usas 4 + 16 + 16 = 36 como factor de longitud de arco en lugar de su raíz cuadrada 6
- C) 60 · [linea-esc-valor-extremo-por-longitud] evalúas x + y + z en el punto final (2, 4, 4), que da 10, y lo multiplicas por la longitud 6 del segmento en lugar de integrar
- D) 30 · CORRECTA

solución: r'(t) = (2, 4, 4), así que |r'(t)| = √(4 + 16 + 16) = 6. Sobre la curva x + y + z = 10t. Entonces $\int_C (x+y+z)\,ds = \int_0^1 10t\cdot 6\,dt = 60\cdot\frac{1}{2} = 30$.
Sin el factor 6 queda 5; con 36 queda 180; el valor en el extremo por la longitud da 60.

### P83 · dificultad 3 · kc: integral-linea-escalar · borrador · origen: ia (sonnet-5.5)
Sea C la curva r(t) = (cos t + t sen t, sen t − t cos t), con 0 ≤ t ≤ 2. El valor de $\int_C (x^2+y^2)\,ds$ es:

- A) 14/3 · [linea-esc-sin-factor-arco] integras x² + y² = 1 + t² entre 0 y 2 sin multiplicar por |r'(t)| = t
- B) 6 · CORRECTA
- C) −6 · [linea-esc-signo-por-sentido] crees que la integral cambia de signo por una convención de sentido, aunque una integral de función escalar no depende de él
- D) 136/15 · [linea-esc-norma-sin-raiz] usas |r'(t)|² = t² como factor de longitud de arco en lugar de su raíz cuadrada t

solución: r'(t) = (t cos t, t sen t), así que |r'(t)| = t. Además x² + y² = (cos t + t sen t)² + (sen t − t cos t)² = 1 + t² (los productos cruzados se cancelan). Entonces $\int_C (x^2+y^2)\,ds = \int_0^2 (1+t^2)\,t\,dt = \left[\frac{t^2}{2}+\frac{t^4}{4}\right]_0^2 = 2 + 4 = 6$.
Sin el factor t queda 14/3; con t² queda 136/15.

### P84 · dificultad 3 · kc: integral-linea-vectorial · borrador · origen: ia (sonnet-5.5)
Sea F(x, y, z) = (2xy + z², x², 2xz) y sea C el segmento parametrizado por r(t) = (t, 2t, 2t), con 1 ≤ t ≤ 2. El valor de $\int_C F\cdot dr$ es:

- A) −42 · [linea-e1] recorres el segmento de (2, 4, 4) a (1, 2, 2), contra el sentido en que crece t
- B) 0 · [linea-e9] crees que la integral vale 0 porque F es conservativo, aunque el segmento no es una curva cerrada
- C) 126 · [linea-e8] después de calcular F·r'(t) multiplicas además por |r'(t)| = 3, el factor de longitud de arco que lleva la integral de un campo escalar
- D) 42 · CORRECTA

solución: con r'(t) = (1, 2, 2) y F(r(t)) = (8t² , t², 4t²) se tiene F·r' = 8t² + 2t² + 8t² = 18t², así que $\int_C F\cdot dr = \int_1^2 18t^2\,dt = 6(8-1) = 42$.
Comprobación: F = ∇f con f = x²y + xz². Entonces la integral es f(2, 4, 4) − f(1, 2, 2) = 48 − 6 = 42.
No vale 0 porque eso es para curvas cerradas; el sentido contrario da −42 y multiplicar por |r'| = 3 da 126.
