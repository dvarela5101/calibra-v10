# Campos conservativos, Green, Stokes y Gauss

Campos conservativos y función potencial, y los teoremas de Green, Stokes y Gauss (secciones 8.1 a 8.4 del libro guía). Se ven después del Parcial 2 y entran solo al examen final. Errores a cazar: aplicar Green a una curva que no es cerrada, equivocar la orientación de la frontera y usar Gauss donde corresponde Stokes.

## Habilidades
kc: campos-conservativos · Decidir si un campo es conservativo, hallar su función potencial y usarla para calcular integrales de línea · prerrequisitos: integral-linea-vectorial, divergencia-rotacional
kc: green · Usar el teorema de Green para pasar de una integral de línea cerrada a una integral doble, con la orientación correcta · prerrequisitos: integral-linea-vectorial, doble-iterada
kc: stokes · Usar el teorema de Stokes para calcular una circulación con el flujo del rotacional, orientando la frontera con la regla de la mano derecha · prerrequisitos: flujo, divergencia-rotacional
kc: gauss · Usar el teorema de la divergencia para calcular el flujo a través de una superficie cerrada con una integral triple · prerrequisitos: flujo, triples

## Errores
mc: teoremas-e1 · green · aplicas Green a una curva que no es cerrada
mc: teoremas-e2 · green · equivocas la orientación de la frontera
mc: teoremas-e3 · green · confundes las condiciones de aplicabilidad
mc: teoremas-e4 · stokes · usas Gauss donde corresponde Stokes
mc: teoremas-e5 · stokes · confundes las condiciones de Stokes
mc: teoremas-e6 · gauss · usas Stokes donde corresponde Gauss
mc: teoremas-e7 · gauss · aplicas teorema incorrecto para superficies cerradas
mc: teoremas-e8 · gauss · confundes campo conservativo con divergencia nula
mc: conservativo-sin-comparar-cruzadas · campos-conservativos · das el campo por conservativo sin comparar ∂P/∂y con ∂Q/∂x
mc: cruzadas-con-derivada-equivocada · campos-conservativos · comparas ∂P/∂x con ∂Q/∂y en vez de las derivadas cruzadas ∂P/∂y y ∂Q/∂x
mc: divergencia-nula-como-criterio-conservativo · campos-conservativos · usas que la divergencia es cero para decidir que el campo es conservativo
mc: potencial-sin-funcion-de-las-otras-variables · campos-conservativos · al hallar el potencial integras solo una componente y olvidas la función de las otras variables que sale de comparar con las demás componentes
mc: potencial-suma-integrales-por-separado · campos-conservativos · integras cada componente respecto de su variable y sumas los resultados, repitiendo los términos comunes
mc: potencial-evaluado-al-reves · campos-conservativos · calculas f(inicio) − f(fin) en vez de f(fin) − f(inicio)
mc: green-integrando-suma-de-parciales · green · usas ∂P/∂x + ∂Q/∂y como integrando de Green, que es el de la forma de flujo, en vez de ∂Q/∂x − ∂P/∂y
mc: green-integrando-resta-invertida · green · restas las parciales al revés, ∂P/∂y − ∂Q/∂x, y el signo del resultado se invierte
mc: stokes-frontera-contra-la-normal · stokes · recorres la frontera en sentido contrario a la regla de la mano derecha respecto de la normal elegida y el signo del resultado sale invertido
mc: rotacional-signo-componente-j · stokes · al calcular el rotacional pones mal el signo de la componente en j y usas ∂R/∂x − ∂P/∂z
mc: stokes-flujo-de-f-no-del-rotacional · stokes · integras F·n sobre la superficie en vez de integrar el rotacional de F
mc: gauss-superficie-abierta-sin-tapas · gauss · aplicas Gauss a una superficie abierta como si fuera cerrada, sin restar el flujo de las tapas que faltan
mc: divergencia-parciales-cruzadas · gauss · calculas la divergencia como ∂P/∂y + ∂Q/∂z + ∂R/∂x en vez de ∂P/∂x + ∂Q/∂y + ∂R/∂z
mc: gauss-normal-con-sentido-contrario · gauss · tomas la normal con el sentido contrario al que pide el enunciado y el flujo, o el de una tapa, sale con el signo equivocado
mc: gauss-divergencia-por-area · gauss · multiplicas la divergencia constante por el área de la superficie en vez de por el volumen del sólido

## Preguntas

### P10 · dificultad 2 · kc: green · revisada · origen: humano · revisó: prototipo · ⚠ revisar
El teorema de Green permite calcular $\int_C P\,dx + Q\,dy$ como una integral doble sobre la región D cuando:

- A) C es una curva cerrada simple que encierra D · CORRECTA
- B) C es cualquier curva (no necesariamente cerrada) · [teoremas-e1]
- C) C es cerrada con orientación horaria · [teoremas-e2]
- D) P y Q son constantes · [teoremas-e3]

### P11 · dificultad 2 · kc: stokes · revisada · origen: humano · revisó: prototipo · ⚠ revisar
Para aplicar el teorema de Stokes a $\int_C F\cdot dr$ donde C es la frontera de una superficie S:

- A) C debe recorrerse según la regla de la mano derecha respecto a la normal de S · CORRECTA
- B) C debe recorrerse en sentido horario · [teoremas-e2]
- C) S debe ser una superficie cerrada · [teoremas-e4]
- D) F debe ser conservativo · [teoremas-e5]

### P12 · dificultad 2 · kc: gauss · revisada · origen: humano · revisó: prototipo · ⚠ revisar
El teorema de Gauss (divergencia) relaciona $\iint_S F\cdot n\,dS$ con:

- A) $∭_V \mathrm{div}\,F\,dV$ donde S encierra V · CORRECTA
- B) $\iint_S \mathrm{rot}\,F\cdot n\,dS$ · [teoremas-e6]
- C) $\int_C F\cdot dr$ donde C es la frontera de S · [teoremas-e7]
- D) 0 si F es conservativo · [teoremas-e8]

### P16 · dificultad 1 · kc: green · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04 · ⚠ revisar
Sea C la circunferencia x² + y² = 1 recorrida en sentido antihorario. Por el teorema de Green, $\oint_C (3x-y)\,dx + (2x+4y)\,dy$ vale:

- A) −3π · [teoremas-e2] recorres la frontera en sentido horario, así que el signo del resultado cambia
- B) 0 · [teoremas-e3] crees que toda integral sobre una curva cerrada vale 0, sin comprobar si ∂Q/∂x = ∂P/∂y
- C) 7π · [teoremas-e4] integras la divergencia ∂P/∂x + ∂Q/∂y = 3 + 4, que es la forma de flujo (Gauss en el plano), en lugar de ∂Q/∂x − ∂P/∂y
- D) 3π · CORRECTA

solución: con P = 3x − y y Q = 2x + 4y, el teorema de Green da $\oint_C P\,dx + Q\,dy = \iint_D \left(\frac{\partial Q}{\partial x} - \frac{\partial P}{\partial y}\right)dA$, donde D es el disco x² + y² ≤ 1 y C es su frontera, cerrada y en sentido antihorario.
Aquí ∂Q/∂x = 2 y ∂P/∂y = −1, así que el integrando vale 2 − (−1) = 3 y la integral es 3 por el área del disco, es decir, 3π. El término 3x de P no cambia el resultado, porque no depende de y.
Comprobación directa con x = cos t, y = sen t: el integrando queda sen²t + 2cos²t + sen t cos t y su integral de 0 a 2π es π + 2π + 0 = 3π.
Las otras opciones salen de errores concretos: −3π es el resultado con la orientación horaria; 0 solo valdría si ∂Q/∂x = ∂P/∂y, y aquí la diferencia es 3; 7π sale de integrar ∂P/∂x + ∂Q/∂y = 3 + 4 sobre el disco.

### P95 · dificultad 1 · kc: campos-conservativos · borrador · origen: ia (sonnet-5.5)
¿Cuál de estos campos de R² es conservativo?

- A) F = (y², x) · [conservativo-sin-comparar-cruzadas] lo das por conservativo porque sus dos componentes son polinomios sencillos, sin comparar ∂P/∂y con ∂Q/∂x
- B) F = (x², 2xy) · [cruzadas-con-derivada-equivocada] ves que ∂P/∂x = 2x coincide con ∂Q/∂y = 2x y concluyes que es conservativo, aunque hay que comparar ∂P/∂y con ∂Q/∂x
- C) F = (2xy + 3, x² − 1) · CORRECTA
- D) F = (y, −x) · [divergencia-nula-como-criterio-conservativo] calculas div F = 0 y concluyes que es conservativo, aunque ∂Q/∂x − ∂P/∂y = −2

solución: un campo F = (P, Q) definido en todo R² es conservativo exactamente cuando ∂P/∂y = ∂Q/∂x. En C, ∂P/∂y = 2x y ∂Q/∂x = 2x, así que lo es. En A, ∂P/∂y = 2y y ∂Q/∂x = 1, que no coinciden. En B, ∂P/∂y = 0 y ∂Q/∂x = 2y, que no coinciden; la igualdad ∂P/∂x = ∂Q/∂y no es el criterio. En D, ∂P/∂y = 1 y ∂Q/∂x = −1; que la divergencia valga 0 no dice nada sobre si es conservativo.

### P96 · dificultad 2 · kc: campos-conservativos · borrador · origen: ia (sonnet-5.5)
El campo F = (2xy + 3, x² + 6y) es conservativo. ¿Cuál es una función potencial f, es decir, una f con ∇f = F?

- A) f = x²y + 3x · [potencial-sin-funcion-de-las-otras-variables] integras 2xy + 3 respecto de x y no añades la función de y que sale de comparar ∂f/∂y con x² + 6y
- B) f = x²y + 3x + 3y² · CORRECTA
- C) f = 2x²y + 3x + 3y² · [potencial-suma-integrales-por-separado] integras P respecto de x y Q respecto de y por separado y sumas, con lo que el término x²y queda repetido
- D) No existe, porque ∂P/∂x = 2y no coincide con ∂Q/∂y = 6 · [cruzadas-con-derivada-equivocada] comparas ∂P/∂x con ∂Q/∂y en vez de las derivadas cruzadas, que sí coinciden (2x = 2x)

solución: ∂P/∂y = 2x = ∂Q/∂x, así que F es conservativo. Se integra P respecto de x: f = x²y + 3x + g(y). Se deriva respecto de y: ∂f/∂y = x² + g′(y), y debe valer Q = x² + 6y, así que g′(y) = 6y y g(y) = 3y². Entonces f = x²y + 3x + 3y². Comprobación: ∂f/∂x = 2xy + 3 y ∂f/∂y = x² + 6y.

### P97 · dificultad 2 · kc: campos-conservativos · borrador · origen: ia (sonnet-5.5)
Sea F = (y² + 2x, 2xy + 3) y sea C una curva suave cualquiera que va de (1, 1) a (2, 3). El valor de $\int_C F\cdot dr$ es:

- A) 20 · [potencial-sin-funcion-de-las-otras-variables] usas f = xy² + x², que viene de integrar solo la primera componente, y te falta el término 3y
- B) 43 · [potencial-suma-integrales-por-separado] usas f = 2xy² + x² + 3y, que suma las integrales de cada componente y repite el término xy²
- C) −26 · [potencial-evaluado-al-reves] restas f(1, 1) − f(2, 3) en vez de f(2, 3) − f(1, 1)
- D) 26 · CORRECTA

solución: ∂P/∂y = 2y = ∂Q/∂x, así que F es conservativo y la integral solo depende de los extremos. Integrando P respecto de x: f = xy² + x² + g(y); como ∂f/∂y = 2xy + g′(y) debe valer 2xy + 3, g′(y) = 3 y g(y) = 3y. Entonces f = xy² + x² + 3y. El valor es f(2, 3) − f(1, 1) = (18 + 4 + 9) − (1 + 1 + 3) = 31 − 5 = 26.

### P98 · dificultad 2 · kc: campos-conservativos · borrador · origen: ia (sonnet-5.5)
¿Para qué valor de k el campo F = (kxy + 2y, 3x² + 2x + y²) es conservativo?

- A) k = −2 · [divergencia-nula-como-criterio-conservativo] igualas a cero la divergencia, ky + 2y = 0, y despejas k
- B) k = 2 · [cruzadas-con-derivada-equivocada] igualas ∂P/∂x = ky con ∂Q/∂y = 2y, en vez de las derivadas cruzadas
- C) Para cualquier valor de k · [conservativo-sin-comparar-cruzadas] das el campo por conservativo porque sus componentes son polinomios, sin comparar ∂P/∂y con ∂Q/∂x
- D) k = 6 · CORRECTA

solución: se necesita ∂P/∂y = ∂Q/∂x en todo punto. ∂P/∂y = kx + 2 y ∂Q/∂x = 6x + 2. Son iguales para todo x solo si k = 6. Con k = 2 se igualan ∂P/∂x y ∂Q/∂y, que no es el criterio; con k = −2 se anula la divergencia, que tampoco lo es.

### P99 · dificultad 3 · kc: campos-conservativos · borrador · origen: ia (sonnet-5.5)
Sea F = (yz + 2x, xz + 3y², xy + 2z) y sea C la curva r(t) = (t, t², t³) con 1 ≤ t ≤ 2. El valor de $\int_C F\cdot dr$ es:

- A) 66 · [potencial-sin-funcion-de-las-otras-variables] usas f = xyz + x², que viene de integrar solo la primera componente, y te faltan los términos y³ y z²
- B) 318 · [potencial-suma-integrales-por-separado] usas f = 3xyz + x² + y³ + z², que suma las tres integrales y repite el término xyz
- C) 192 · CORRECTA
- D) −192 · [potencial-evaluado-al-reves] restas f(1, 1, 1) − f(2, 4, 8) en vez de f(2, 4, 8) − f(1, 1, 1)

solución: el rotacional de F tiene componentes (x − x, y − y, z − z) = (0, 0, 0), así que F es conservativo en R³. Integrando la primera componente respecto de x: f = xyz + x² + g(y, z). Derivando respecto de y: xz + ∂g/∂y debe valer xz + 3y², así que g = y³ + h(z). Derivando respecto de z: xy + h′(z) debe valer xy + 2z, así que h = z². Entonces f = xyz + x² + y³ + z². La curva va de (1, 1, 1) a (2, 4, 8), y el valor es f(2, 4, 8) − f(1, 1, 1) = (64 + 4 + 64 + 64) − (1 + 1 + 1 + 1) = 196 − 4 = 192.

### P100 · dificultad 2 · kc: green · borrador · origen: ia (sonnet-5.5)
Sea C la parábola y = x² recorrida de (0, 0) a (1, 1) y sea F = (3y + x, 5x). Se cierra C con el segmento recto de (1, 1) a (0, 0), de modo que la curva cerrada resultante encierra la región entre y = x² y y = x, que tiene área 1/6 y queda a la izquierda al recorrerla. El valor de $\int_C F\cdot dr$ es:

- A) 1/3 · [teoremas-e1] aplicas Green directamente a C, que no es cerrada, sin restar la integral sobre el segmento que la cierra
- B) 29/6 · CORRECTA
- C) 25/6 · [teoremas-e2] tomas la curva cerrada con la orientación contraria, así que la integral cerrada sale −1/3 en vez de 1/3
- D) 14/3 · [green-integrando-suma-de-parciales] integras ∂P/∂x + ∂Q/∂y = 1 sobre la región en vez de ∂Q/∂x − ∂P/∂y = 2

solución: sea C′ el segmento de (1, 1) a (0, 0). La curva cerrada C + C′ es antihoraria y por Green $\oint P\,dx + Q\,dy = \iint_D \left(\frac{\partial Q}{\partial x} - \frac{\partial P}{\partial y}\right)dA = \iint_D (5 - 3)\,dA = 2·\frac{1}{6} = \frac{1}{3}$.
En C′, con x = y = t y t de 1 a 0, el integrando es (3t + t)dt + 5t dt = 9t dt y la integral vale −9/2.
Entonces $\int_C = \frac{1}{3} - \left(-\frac{9}{2}\right) = \frac{29}{6}$.
Comprobación directa con x = t, y = t²: (3t² + t)dt + 5t·2t dt = (13t² + t)dt, y su integral de 0 a 1 es 13/3 + 1/2 = 29/6.

### P101 · dificultad 2 · kc: green · borrador · origen: ia (sonnet-5.5)
Sea C el borde del rectángulo con vértices (0, 0), (2, 0), (2, 3), (0, 3), recorrido en ese orden. El valor de $\oint_C (x^2 + 3y)\,dx + (2x + y^2)\,dy$ es:

- A) 6 · [green-integrando-resta-invertida] calculas ∂P/∂y − ∂Q/∂x = 1 en vez de ∂Q/∂x − ∂P/∂y = −1, y el resultado sale con el signo contrario
- B) 30 · [green-integrando-suma-de-parciales] integras ∂P/∂x + ∂Q/∂y = 2x + 2y sobre el rectángulo en vez de ∂Q/∂x − ∂P/∂y
- C) 0 · [teoremas-e3] das la integral cerrada por nula sin comprobar que ∂Q/∂x y ∂P/∂y son distintos
- D) −6 · CORRECTA

solución: el recorrido (0, 0), (2, 0), (2, 3), (0, 3) es antihorario, así que la región D = [0, 2] × [0, 3] queda a la izquierda y se puede aplicar Green. Con P = x² + 3y y Q = 2x + y²: ∂Q/∂x − ∂P/∂y = 2 − 3 = −1. Entonces $\oint_C = \iint_D (-1)\,dA = -1·6 = -6$.

### P102 · dificultad 3 · kc: green · borrador · origen: ia (sonnet-5.5)
Sea C la frontera de la región 1 ≤ x² + y² ≤ 4, orientada de modo que la región quede siempre a la izquierda. El valor de $\oint_C -y^3\,dx + x^3\,dy$ es:

- A) 45π/2 · CORRECTA
- B) 24π · [teoremas-e3] aplicas Green solo con la circunferencia exterior, como si la región no tuviera hueco, y te falta la frontera interior
- C) 51π/2 · [teoremas-e2] recorres también la circunferencia interior en sentido antihorario, en vez de horario
- D) −45π/2 · [green-integrando-resta-invertida] calculas ∂P/∂y − ∂Q/∂x = −3(x² + y²) en vez de ∂Q/∂x − ∂P/∂y

solución: con P = −y³ y Q = x³, ∂Q/∂x − ∂P/∂y = 3x² + 3y² = 3r². Con la región a la izquierda, la circunferencia exterior se recorre en sentido antihorario y la interior en sentido horario, y Green vale para toda la región D entre ambas: $\iint_D 3r^2\,dA = \int_0^{2\pi}\int_1^2 3r^2\cdot r\,dr\,d\theta = 2\pi\cdot\frac{3}{4}(16 - 1) = \frac{45\pi}{2}$.
Si solo se usa el disco de radio 2 sale 24π, y si la circunferencia interior se recorre antihoraria se suma 3π/2 en vez de restarse: 24π + 3π/2 = 51π/2.

### P103 · dificultad 1 · kc: stokes · borrador · origen: ia (sonnet-5.5)
Sea C la circunferencia x² + y² = 4 en el plano z = 0, recorrida en sentido antihorario visto desde arriba (desde z positivo). Con F = (−y, x, 5), el valor de $\oint_C F\cdot dr$ es:

- A) 20π · [stokes-flujo-de-f-no-del-rotacional] integras F·n = 5 sobre el disco x² + y² ≤ 4 en vez de integrar el rotacional de F
- B) −8π · [stokes-frontera-contra-la-normal] tomas la normal del disco hacia abajo, que no corresponde a este recorrido, y el resultado sale con el signo contrario
- C) 8π · CORRECTA
- D) 0 · [teoremas-e4] calculas div F = 0 y concluyes que la circulación es 0, usando Gauss donde corresponde Stokes

solución: C es la frontera del disco D: x² + y² ≤ 4 en z = 0. El recorrido antihorario visto desde arriba corresponde, por la regla de la mano derecha, a la normal n = k. El rotacional es rot F = (0, 0, 1 − (−1)) = (0, 0, 2), y rot F·n = 2. Por Stokes, $\oint_C F\cdot dr = \iint_D 2\,dA = 2·4\pi = 8\pi$.

### P104 · dificultad 2 · kc: stokes · borrador · origen: ia (sonnet-5.5)
Sea C el triángulo de vértices (1, 0, 0), (0, 1, 0), (0, 0, 1), recorrido en ese orden, y sea F = (z, x, y). El valor de $\oint_C F\cdot dr$ es:

- A) 1/2 · [rotacional-signo-componente-j] al calcular el rotacional usas ∂R/∂x − ∂P/∂z en la componente j y te queda (1, −1, 1)
- B) 3/2 · CORRECTA
- C) −3/2 · [stokes-frontera-contra-la-normal] tomas la normal del plano hacia abajo, que no corresponde a este recorrido, y el resultado sale con el signo contrario
- D) 0 · [teoremas-e5] crees que Stokes exige un campo conservativo y que la circulación sobre una curva cerrada es 0, cuando rot F = (1, 1, 1) no es nulo

solución: C es la frontera del triángulo S del plano x + y + z = 1 en el primer octante. Con ese orden de vértices, la normal que da la regla de la mano derecha apunta hacia arriba: (1, 1, 1) multiplicado por un positivo. El rotacional es rot F = (∂R/∂y − ∂Q/∂z, ∂P/∂z − ∂R/∂x, ∂Q/∂x − ∂P/∂y) = (1 − 0, 1 − 0, 1 − 0) = (1, 1, 1).
Con z = 1 − x − y, el vector n dS es (1, 1, 1) dx dy, así que rot F·n dS = 3 dx dy, y la proyección sobre el plano xy es un triángulo de área 1/2. Por Stokes, el valor es 3·(1/2) = 3/2.

### P105 · dificultad 2 · kc: stokes · borrador · origen: ia (sonnet-5.5)
Sea C la curva en que el plano z = y corta al cilindro x² + y² = 1, recorrida en sentido antihorario visto desde arriba. Con F = (2z, x, y²), el valor de $\oint_C F\cdot dr$ es:

- A) 3π · [rotacional-signo-componente-j] pones el signo contrario en la componente j del rotacional y usas (2y, −2, 1) en vez de (2y, 2, 1)
- B) π · [stokes-frontera-contra-la-normal] tomas la normal del plano z = y hacia abajo, que no corresponde a este recorrido, y el resultado sale con el signo contrario
- C) 0 · [teoremas-e4] calculas div F = 0 y concluyes que la circulación es 0, usando Gauss donde corresponde Stokes
- D) −π · CORRECTA

solución: se toma como superficie S la parte del plano z = y dentro del cilindro, que se proyecta sobre el disco D: x² + y² ≤ 1. El recorrido antihorario visto desde arriba da la normal hacia arriba: n dS = (−∂z/∂x, −∂z/∂y, 1) dx dy = (0, −1, 1) dx dy.
El rotacional es rot F = (∂R/∂y − ∂Q/∂z, ∂P/∂z − ∂R/∂x, ∂Q/∂x − ∂P/∂y) = (2y − 0, 2 − 0, 1 − 0) = (2y, 2, 1). Entonces rot F·n dS = (−2 + 1) dx dy = −dx dy y la integral es −área(D) = −π.
Comprobación directa con r(t) = (cos t, sen t, sen t): F·r′ = −2 sen²t + cos²t + sen²t·cos t, y su integral de 0 a 2π es −2π + π + 0 = −π.

### P106 · dificultad 3 · kc: stokes · borrador · origen: ia (sonnet-5.5)
Considera la mitad superior (z ≥ 0) de la esfera unitaria, llamada S, orientada con normal exterior, y el campo F = (y + z², 3x, xy + z). El valor de $\iint_S (\mathrm{rot}\,F)\cdot n\,dS$ es:

- A) 2π · CORRECTA
- B) −2π · [stokes-frontera-contra-la-normal] orientas la circunferencia frontera al revés de lo que pide la normal exterior, y el resultado sale con el signo contrario
- C) 0 · [teoremas-e4] usas que div(rot F) = 0 y concluyes que el flujo del rotacional es 0, aunque el hemisferio no es una superficie cerrada
- D) 2π/3 · [stokes-flujo-de-f-no-del-rotacional] calculas el flujo de F, que vale $\iint_S z^2\,dS$ = 2π/3, en vez del flujo de su rotacional

solución: la frontera de S es la circunferencia x² + y² = 1, z = 0, y la normal exterior (hacia arriba) pide recorrerla en sentido antihorario visto desde arriba. Por Stokes, el flujo del rotacional por S es igual al flujo por cualquier otra superficie con esa frontera y esa orientación, por ejemplo el disco x² + y² ≤ 1 en z = 0 con n = k.
El rotacional es rot F = (∂R/∂y − ∂Q/∂z, ∂P/∂z − ∂R/∂x, ∂Q/∂x − ∂P/∂y) = (x, 2z − y, 3 − 1). Sobre el disco, rot F·k = 2, y el flujo es 2·π = 2π.
La opción C no vale: div(rot F) = 0 daría flujo 0 solo sobre una superficie cerrada, y aquí el flujo por el hemisferio es 2π, igual al del disco; el flujo total por la superficie cerrada (hemisferio más disco con normal hacia abajo) sí vale 2π − 2π = 0.

### P107 · dificultad 1 · kc: gauss · borrador · origen: ia (sonnet-5.5)
La superficie esférica S, de ecuación x² + y² + z² = 4, está orientada hacia afuera, y el campo es F = (2x, y, z). El flujo $\iint_S F\cdot n\,dS$ es:

- A) 64π · [gauss-divergencia-por-area] multiplicas div F = 4 por el área de la esfera, 16π, en vez de por el volumen de la bola
- B) 128π/3 · CORRECTA
- C) −128π/3 · [gauss-normal-con-sentido-contrario] tomas la normal hacia adentro, en vez de la normal exterior que pide el enunciado
- D) 0 · [teoremas-e8] crees que, como F es conservativo, su divergencia es nula y el flujo vale 0

solución: S es cerrada y encierra la bola V de radio 2. Por el teorema de la divergencia, $\iint_S F\cdot n\,dS = ∭_V \mathrm{div}\,F\,dV$. Aquí div F = 2 + 1 + 1 = 4, y el volumen de la bola es (4/3)π·8 = 32π/3, así que el flujo es 4·32π/3 = 128π/3. Que F sea conservativo (es el gradiente de x² + (y² + z²)/2) no implica div F = 0.

### P108 · dificultad 2 · kc: gauss · borrador · origen: ia (sonnet-5.5)
Sea S la frontera de la caja [0, 1] × [0, 2] × [0, 3], con la normal exterior, y sea F = (2x + yz, 3y, z + x²). El flujo $\iint_S F\cdot n\,dS$ es:

- A) 132 · [gauss-divergencia-por-area] multiplicas div F = 6 por el área total de las seis caras, 22, en vez de por el volumen de la caja
- B) 15 · [divergencia-parciales-cruzadas] calculas la divergencia como ∂P/∂y + ∂Q/∂z + ∂R/∂x = z + 2x
- C) 0 · [teoremas-e6] calculas el flujo del rotacional de F, que sobre una superficie cerrada vale 0, usando Stokes donde corresponde Gauss
- D) 36 · CORRECTA

solución: S es cerrada y encierra la caja V, así que $\iint_S F\cdot n\,dS = ∭_V \mathrm{div}\,F\,dV$. Con P = 2x + yz, Q = 3y y R = z + x²: div F = 2 + 3 + 1 = 6. El volumen de la caja es 1·2·3 = 6, y el flujo es 6·6 = 36.

### P109 · dificultad 2 · kc: gauss · borrador · origen: ia (sonnet-5.5)
Sea S la parte del paraboloide z = 4 − x² − y² con z ≥ 0, con la normal que apunta hacia arriba y hacia afuera, y sea F = (x, y, z + 1). El flujo $\iint_S F\cdot n\,dS$ es:

- A) 24π · [gauss-superficie-abierta-sin-tapas] usas Gauss como si S fuera cerrada y no restas el flujo por el disco x² + y² ≤ 4 en z = 0 que cierra el sólido
- B) 0 · [teoremas-e7] igualas el flujo con la circulación de F sobre la frontera de S, la circunferencia x² + y² = 4 en z = 0, que vale 0
- C) 20π · [gauss-normal-con-sentido-contrario] tomas la normal del disco de abajo hacia arriba y restas +4π en vez de −4π
- D) 28π · CORRECTA

solución: S no es cerrada, así que se le agrega la tapa D: x² + y² ≤ 4 en z = 0, con la normal exterior −k. Sea V el sólido entre D y S. Por Gauss, el flujo total vale $∭_V \mathrm{div}\,F\,dV$ con div F = 3 y volumen $\int_0^{2\pi}\int_0^2 (4 - r^2)\,r\,dr\,d\theta = 8\pi$, es decir, 24π. El flujo por la tapa es $\iint_D F\cdot(-k)\,dA = -\iint_D (0 + 1)\,dA = -4\pi$. Entonces el flujo por S es 24π − (−4π) = 28π.
Comprobación directa: con n dS = (2x, 2y, 1) dx dy y z = 4 − r², F·n dS = (2r² + 5 − r²) dx dy = (r² + 5) dx dy, cuya integral sobre el disco de radio 2 es 2π(4 + 10) = 28π.

### P110 · dificultad 3 · kc: gauss · borrador · origen: ia (sonnet-5.5)
Sea S la superficie lateral del cilindro x² + y² = 1, 0 ≤ z ≤ 2 (sin las tapas), con la normal que apunta hacia afuera del eje, y sea F = (x³, y³, z²). El flujo $\iint_S F\cdot n\,dS$ es:

- A) 3π · CORRECTA
- B) 7π · [gauss-superficie-abierta-sin-tapas] usas Gauss como si S fuera cerrada y no restas el flujo por la tapa superior
- C) 11π · [gauss-normal-con-sentido-contrario] tomas la normal de la tapa superior hacia abajo, y sumas su flujo en vez de restarlo
- D) −4π · [divergencia-parciales-cruzadas] calculas la divergencia como ∂P/∂y + ∂Q/∂z + ∂R/∂x = 0, con lo que el flujo total sale 0 y solo queda restar la tapa superior

solución: se cierra el sólido V con las tapas inferior (z = 0, normal −k) y superior (z = 2, normal k). Por Gauss, el flujo total es $∭_V \mathrm{div}\,F\,dV$ con div F = 3x² + 3y² + 2z. En coordenadas cilíndricas, $∭ 3r^2\,dV = 3\cdot\frac{1}{4}\cdot 2\pi\cdot 2 = 3\pi$ y $∭ 2z\,dV = 2\cdot 2\cdot\pi = 4\pi$, así que el flujo total es 7π.
En la tapa inferior, F·(−k) = −z² = 0, y el flujo es 0. En la tapa superior, F·k = z² = 4 y el flujo es 4·π = 4π. El flujo por la lateral es 7π − 4π − 0 = 3π.
Comprobación directa: sobre la lateral n = (x, y, 0) y F·n = x⁴ + y⁴, cuya integral con altura 2 es 2·∫₀^{2π}(cos⁴θ + sen⁴θ)dθ = 2·(3π/2) = 3π.
