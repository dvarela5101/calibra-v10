# Superficies e integrales de superficie

Parametrización de superficies, vector normal, plano tangente, área, integrales de funciones escalares y flujo de un campo vectorial sobre una superficie orientada. Es del Parcial 2 (semana 13 del programa).

## Habilidades
kc: superficie-parametrizada · Parametrizar una superficie, hallar su vector normal y su plano tangente, y calcular su área · prerrequisitos: polares-cambio, plano-tangente
kc: flujo · Calcular integrales de funciones escalares y el flujo de un campo vectorial sobre una superficie orientada · prerrequisitos: superficie-parametrizada

## Errores
mc: normal-suma-de-derivadas · superficie-parametrizada · sumas los vectores r_u y r_v para obtener la normal, en vez de hacer su producto vectorial
mc: determinante-normal-sin-alternar-signo · superficie-parametrizada · al desarrollar el determinante de r_u × r_v no cambias el signo del término de j y la normal sale con esa componente invertida
mc: posicion-como-vector-normal · superficie-parametrizada · tomas el vector de posición r(u₀, v₀) del punto como si fuera la normal de la superficie
mc: area-superficie-igual-area-de-region · superficie-parametrizada · calculas el área de la región D del plano y la entregas como área de la superficie, sin el factor de inclinación |r_u × r_v|
mc: area-superficie-sin-raiz · superficie-parametrizada · usas 1 + f_x² + f_y² como elemento de área sin sacar la raíz cuadrada
mc: area-superficie-sin-el-uno · superficie-parametrizada · escribes el elemento de área como √(f_x² + f_y²) y olvidas el 1 que aporta la componente z de la normal
mc: radio-igual-a-altura · superficie-parametrizada · tomas la altura z de corte como el radio máximo en la región de integración, sin despejar el radio a partir de la ecuación de la superficie
mc: integral-escalar-sin-factor-de-superficie · flujo · integras la función sobre la región D del plano sin multiplicar por |r_u × r_v|, el factor de dS
mc: elemento-de-superficie-sin-raiz · flujo · usas |r_u × r_v|² en lugar de |r_u × r_v| como factor de dS
mc: integral-escalar-solo-area · flujo · integras 1 en lugar de la función o el campo y entregas el área de la superficie
mc: flujo-orientacion-ignorada · flujo · calculas el flujo con la normal contraria a la orientación pedida y el signo sale invertido
mc: normal-grafica-sin-signo-menos · flujo · en una superficie z = g(x, y) usas la normal (g_x, g_y, 1) en vez de (−g_x, −g_y, 1)
mc: flujo-con-una-sola-componente · flujo · multiplicas el área por una sola componente del campo, sin hacer el producto punto F · n con la normal de la superficie

## Preguntas

### P85 · dificultad 1 · kc: superficie-parametrizada · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
La superficie S se parametriza con $r(u,v) = (u, v, u^2 + v^2)$. ¿Cuánto vale el vector normal $r_u \times r_v$ en el punto que corresponde a (u, v) = (1, 2)?

- A) (−2, −4, 1) · CORRECTA
- B) (1, 1, 6) · [normal-suma-de-derivadas] sumas r_u = (1, 0, 2) y r_v = (0, 1, 4) en vez de hacer su producto vectorial
- C) (−2, 4, 1) · [determinante-normal-sin-alternar-signo] no cambias el signo del término de j al desarrollar el determinante y la segunda componente sale +4 en vez de −4
- D) (1, 2, 5) · [posicion-como-vector-normal] tomas el vector de posición r(1, 2) del punto como si fuera la normal

solución: r_u = (1, 0, 2u) = (1, 0, 2) y r_v = (0, 1, 2v) = (0, 1, 4) en (1, 2). El producto vectorial es r_u × r_v = (0·4 − 2·1, 2·0 − 1·4, 1·1 − 0·0) = (−2, −4, 1). En general es (−2u, −2v, 1).

### P86 · dificultad 2 · kc: superficie-parametrizada · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
¿Cuál es el área de la parte del plano $z = 2x + 2y$ que queda sobre el disco $x^2 + y^2 \le 4$?

- A) 12π · CORRECTA
- B) 4π · [area-superficie-igual-area-de-region] entregas el área del disco, que es 4π, como área de la superficie inclinada
- C) 36π · [area-superficie-sin-raiz] usas 1 + 2² + 2² = 9 como factor de área sin sacarle la raíz y multiplicas por 4π
- D) 8√2π · [area-superficie-sin-el-uno] usas √(2² + 2²) = 2√2 como factor de área y olvidas el 1 que viene de la componente z de la normal

solución: para z = f(x, y) el elemento de área es √(1 + f_x² + f_y²) dA. Aquí f_x = 2 y f_y = 2, así que el factor es √(1 + 4 + 4) = 3, constante. El área es 3 · (área del disco) = 3 · π · 2² = 12π.

### P87 · dificultad 2 · kc: superficie-parametrizada · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
La superficie $r(u,v) = (u^2, u + v, v^2)$ pasa por el punto (1, 3, 4) cuando (u, v) = (1, 2). ¿Cuál es la ecuación de su plano tangente en ese punto?

- A) 2x − 4y + z = −6 · CORRECTA
- B) x + 3y + 4z = 26 · [posicion-como-vector-normal] usas el vector de posición (1, 3, 4) como normal del plano
- C) 2x + 2y + 4z = 24 · [normal-suma-de-derivadas] usas r_u + r_v = (2, 2, 4) como normal del plano
- D) 4x + 8y + 2z = 36 · [determinante-normal-sin-alternar-signo] no cambias el signo del término de j al calcular r_u × r_v y obtienes la normal (4, 8, 2) en vez de (4, −8, 2)

solución: r_u = (2u, 1, 0) = (2, 1, 0) y r_v = (0, 1, 2v) = (0, 1, 4). La normal es r_u × r_v = (1·4 − 0·1, 0·0 − 2·4, 2·1 − 1·0) = (4, −8, 2), que es paralela a (2, −4, 1). El plano por (1, 3, 4) es 2(x − 1) − 4(y − 3) + (z − 4) = 0, es decir, 2x − 4y + z = −6. Comprobación: 2 − 12 + 4 = −6.

### P88 · dificultad 2 · kc: superficie-parametrizada · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Halla el área de la parte del cono $z = 2\sqrt{x^2 + y^2}$ que queda por debajo del plano z = 6.

- A) 9√5π · CORRECTA
- B) 9π · [area-superficie-igual-area-de-region] entregas el área de la región circular de radio 3, sin el factor de inclinación del cono
- C) 45π · [area-superficie-sin-raiz] usas 1 + z_x² + z_y² = 5 como factor de área sin sacar la raíz cuadrada
- D) 36√5π · [radio-igual-a-altura] tomas el radio de la región como 6, que es la altura de corte, cuando z = 2r = 6 da r = 3

solución: la superficie es z = f(x, y) con f = 2r en polares, y |∇f| = 2 en todo punto, así que el factor de área es √(1 + 4) = √5. El corte z = 6 da 2r = 6, es decir, r = 3. El área es ∬ √5 dA = √5 · π · 3² = 9√5π.

### P89 · dificultad 3 · kc: superficie-parametrizada · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
¿Cuál es el área de la parte del paraboloide $z = x^2 + y^2$ que queda por debajo del plano z = 6?

- A) 62π/3 · CORRECTA
- B) 78π · [area-superficie-sin-raiz] integras 1 + 4r² sin sacar la raíz cuadrada
- C) 8√6π · [area-superficie-sin-el-uno] integras √(z_x² + z_y²) = 2r sin el 1 bajo la raíz
- D) (π/6)(145√145 − 1) · [radio-igual-a-altura] tomas el radio máximo como 6, que es la altura de corte, cuando r² = 6 da r = √6

solución: con f = x² + y², el factor de área es √(1 + 4x² + 4y²) = √(1 + 4r²). El corte z = 6 da r² = 6, o sea 0 ≤ r ≤ √6. El área es ∫₀^{2π} ∫₀^{√6} r·√(1 + 4r²) dr dθ = 2π · [(1 + 4r²)^{3/2} / 12] entre 0 y √6 = 2π · (125 − 1)/12 = 62π/3.

### P90 · dificultad 1 · kc: flujo · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Sea F(x, y, z) = (3, 1, 2). La superficie S es el cuadrado de la parte del plano x = 1 con 0 ≤ y ≤ 2 y 0 ≤ z ≤ 2, orientado con la normal que apunta hacia x positivo. ¿Cuánto vale el flujo de F a través de S?

- A) 12 · CORRECTA
- B) −12 · [flujo-orientacion-ignorada] usas la normal (−1, 0, 0), que apunta hacia x negativo, y el signo sale invertido
- C) 8 · [flujo-con-una-sola-componente] multiplicas el área 4 por la componente z del campo, que es 2, sin hacer el producto punto con la normal
- D) 4 · [integral-escalar-solo-area] integras 1 sobre la superficie y entregas su área en lugar del flujo

solución: la normal unitaria es n = (1, 0, 0), constante. Entonces F · n = 3 y el flujo es ∬ 3 dS = 3 · (área) = 3 · 4 = 12.

### P91 · dificultad 2 · kc: flujo · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Calcula $\iint_S z\, dS$, donde S es la parte del plano z = 3 − x con 0 ≤ x ≤ 2 y 0 ≤ y ≤ 1.

- A) 4√2 · CORRECTA
- B) 4 · [integral-escalar-sin-factor-de-superficie] integras 3 − x sobre el rectángulo del plano xy y no multiplicas por el factor de dS
- C) 8 · [elemento-de-superficie-sin-raiz] usas 1 + 1 = 2 como factor de dS, sin sacar la raíz cuadrada
- D) 2√2 · [integral-escalar-solo-area] integras 1 en lugar de z y entregas el área de S

solución: S es la gráfica de g(x, y) = 3 − x, con g_x = −1 y g_y = 0, así que dS = √(1 + 1 + 0) dA = √2 dA. Entonces ∬ z dS = √2 ∫₀¹ ∫₀² (3 − x) dx dy = √2 · (6 − 2) = 4√2.

### P92 · dificultad 2 · kc: flujo · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Sea F(x, y, z) = (x, y, 3) y sea S la parte del paraboloide $z = 1 - x^2 - y^2$ con z ≥ 0, orientada hacia arriba (la normal tiene componente z positiva). ¿Cuánto vale el flujo de F a través de S?

- A) 4π · CORRECTA
- B) −4π · [flujo-orientacion-ignorada] calculas el flujo con la normal que apunta hacia abajo y el signo sale invertido
- C) 2π · [normal-grafica-sin-signo-menos] usas la normal (g_x, g_y, 1) = (−2x, −2y, 1) en vez de (−g_x, −g_y, 1) = (2x, 2y, 1), y F·N queda 3 − 2r²
- D) 3π · [flujo-con-una-sola-componente] tomas solo la componente z de F, que es 3, e integras 3 sobre el disco de radio 1

solución: con g = 1 − x² − y², la normal hacia arriba es N = (−g_x, −g_y, 1) = (2x, 2y, 1) y dS = |N| dA, así que el flujo es ∬ F · N dA sobre el disco r ≤ 1. F · N = 2x² + 2y² + 3 = 2r² + 3. Entonces ∫₀^{2π} ∫₀¹ (2r² + 3) r dr dθ = 2π (1/2 + 3/2) = 4π.

### P93 · dificultad 2 · kc: flujo · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Calcula $\iint_S (x^2 + y^2)\, dS$, donde S es la parte del cilindro x² + y² = 4 con 0 ≤ z ≤ 3.

- A) 48π · CORRECTA
- B) 24π · [integral-escalar-sin-factor-de-superficie] integras con dθ dz y no multiplicas por el factor |r_θ × r_z| = 2
- C) 96π · [elemento-de-superficie-sin-raiz] usas |r_θ × r_z|² = 4 en lugar de |r_θ × r_z| = 2 como factor de dS
- D) 12π · [integral-escalar-solo-area] integras 1 en lugar de x² + y² y entregas el área lateral del cilindro

solución: se parametriza r(θ, z) = (2 cos θ, 2 sen θ, z) con 0 ≤ θ ≤ 2π y 0 ≤ z ≤ 3. Entonces r_θ × r_z = (2 cos θ, 2 sen θ, 0), cuyo módulo es 2, y dS = 2 dθ dz. En S se cumple x² + y² = 4, así que la integral es ∫₀³ ∫₀^{2π} 4 · 2 dθ dz = 8 · 2π · 3 = 48π.

### P94 · dificultad 3 · kc: flujo · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Sea F(x, y, z) = (x, y, 2) y sea S la parte del cono $z = \sqrt{x^2 + y^2}$ con 0 ≤ z ≤ 1, orientada con la normal que tiene componente z positiva. ¿Cuánto vale el flujo de F a través de S?

- A) 4π/3 · CORRECTA
- B) −4π/3 · [flujo-orientacion-ignorada] usas la normal que tiene componente z negativa y el signo sale invertido
- C) 8π/3 · [normal-grafica-sin-signo-menos] usas la normal (g_x, g_y, 1) = (x/r, y/r, 1) en vez de (−x/r, −y/r, 1), y F·N queda r + 2
- D) 2π · [flujo-con-una-sola-componente] tomas solo la componente z de F, que es 2, e integras 2 sobre el disco de radio 1

solución: con g = √(x² + y²) = r, g_x = x/r y g_y = y/r. La normal con componente z positiva es N = (−x/r, −y/r, 1), y el flujo es ∬ F · N dA sobre el disco r ≤ 1. F · N = −(x² + y²)/r + 2 = 2 − r. Entonces ∫₀^{2π} ∫₀¹ (2 − r) r dr dθ = 2π (1 − 1/3) = 4π/3.
