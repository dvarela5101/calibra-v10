# Trayectorias y campos vectoriales

Derivación de trayectorias en el espacio (velocidad, aceleración, recta tangente y longitud de arco) y campos vectoriales con su divergencia y su rotacional. Cae en el Parcial 1, semana 7.

## Habilidades
kc: trayectorias · Calcular la velocidad, la aceleración, la recta tangente y la longitud de arco de una trayectoria · prerrequisitos: calculo-diferencial/reglas-derivacion, algebra-lineal/vectores
kc: divergencia-rotacional · Calcular la divergencia y el rotacional de un campo vectorial e interpretar cuándo se anulan · prerrequisitos: derivadas-parciales

## Errores
mc: deriva-producto-por-factores · trayectorias · derivas un producto componente a componente como si (u·v)′ fuera u′·v′
mc: confunde-orden-de-derivada · trayectorias · derivas una cantidad de veces distinta de la pedida: la segunda derivada cuando piden la velocidad, o la primera cuando piden la aceleración
mc: norma-sin-raiz-cuadrada · trayectorias · integras el cuadrado de la rapidez, |σ′|², sin sacar la raíz de la suma de cuadrados
mc: longitud-integra-suma-de-componentes · trayectorias · para la longitud de arco integras la suma de las componentes de σ′ en vez de su norma
mc: posicion-en-lugar-de-velocidad · trayectorias · evalúas la trayectoria σ en el parámetro y lo tomas como si fuera la derivada
mc: longitud-rapidez-final-por-intervalo · trayectorias · multiplicas la rapidez en el extremo final por la longitud del intervalo, como si la rapidez fuera constante
mc: div-con-derivadas-cruzadas · divergencia-rotacional · sumas derivadas parciales cruzadas, como ∂P/∂y, ∂Q/∂z y ∂R/∂x, en vez de derivar cada componente respecto de su propia variable
mc: div-como-vector · divergencia-rotacional · derivas cada componente respecto de su propia variable pero las dejas como vector en vez de sumarlas
mc: confunde-div-con-rot · divergencia-rotacional · intercambias la divergencia y el rotacional y entregas uno cuando piden el otro
mc: rot-orden-invertido · divergencia-rotacional · restas las derivadas cruzadas del rotacional al revés y obtienes el vector opuesto
mc: rot-j-sin-menos · divergencia-rotacional · al desarrollar el determinante del rotacional olvidas el signo menos del componente j
mc: div-y-rot-se-anulan-juntos · divergencia-rotacional · crees que si la divergencia o el rotacional de un campo es nulo, el otro también lo es

## Preguntas

### P53 · dificultad 1 · kc: trayectorias · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Sea σ(t) = (t·e²ᵗ, t² + 1, cos t). ¿Cuál es el vector velocidad en t = 0?

- A) (2, 0, 0) · [deriva-producto-por-factores] derivas t·e²ᵗ como (t)′·(e²ᵗ)′ = 1·2e²ᵗ y en t = 0 queda 2
- B) (1, 0, 0) · CORRECTA
- C) (0, 1, 1) · [posicion-en-lugar-de-velocidad] evalúas σ en t = 0 y tomas la posición como si fuera la velocidad
- D) (4, 2, −1) · [confunde-orden-de-derivada] derivas dos veces y entregas la aceleración, cuando piden la velocidad

solución: la velocidad es σ′(t). Para la primera componente se usa la regla del producto: (t·e²ᵗ)′ = e²ᵗ + 2t·e²ᵗ = e²ᵗ(1 + 2t). La segunda es (t² + 1)′ = 2t y la tercera (cos t)′ = −sen t. Entonces σ′(t) = (e²ᵗ(1 + 2t), 2t, −sen t) y σ′(0) = (1, 0, 0).

### P54 · dificultad 2 · kc: trayectorias · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
La trayectoria σ(t) = (t·eᵗ⁻¹, t³, ln t) pasa por un punto en t = 1. ¿Cuál es la recta tangente a la trayectoria en ese punto?

- A) (1, 1, 0) + s·(2, 3, 1) · CORRECTA
- B) (1, 1, 0) + s·(1, 3, 1) · [deriva-producto-por-factores] derivas t·eᵗ⁻¹ como (t)′·(eᵗ⁻¹)′ = eᵗ⁻¹ y la dirección sale con 1 en la primera componente
- C) (1, 1, 0) + s·(3, 6, −1) · [confunde-orden-de-derivada] usas la segunda derivada σ″(1) como dirección de la recta tangente
- D) (1, 1, 0) + s·(1, 1, 0) · [posicion-en-lugar-de-velocidad] usas σ(1) también como dirección, sin derivar la trayectoria

solución: el punto es σ(1) = (1·e⁰, 1, ln 1) = (1, 1, 0). La dirección es σ′(t) = (eᵗ⁻¹(1 + t), 3t², 1/t), así que σ′(1) = (2, 3, 1). La recta es (1, 1, 0) + s·(2, 3, 1). La opción C usa σ″(t) = (eᵗ⁻¹(2 + t), 6t, −1/t²), que en t = 1 es (3, 6, −1) y no da la dirección tangente.

### P55 · dificultad 2 · kc: trayectorias · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Halla la longitud de arco de σ(t) = (t, t², 2t³/3) para 0 ≤ t ≤ 1.

- A) 3 · [longitud-rapidez-final-por-intervalo] multiplicas la rapidez en t = 1, que es 3, por la longitud del intervalo, que es 1
- B) 47/15 · [norma-sin-raiz-cuadrada] integras |σ′|² = (1 + 2t²)² sin sacar la raíz
- C) 8/3 · [longitud-integra-suma-de-componentes] integras la suma de las componentes de σ′, que es 1 + 2t + 2t²
- D) 5/3 · CORRECTA

solución: σ′(t) = (1, 2t, 2t²), así que |σ′|² = 1 + 4t² + 4t⁴ = (1 + 2t²)². Entonces |σ′| = 1 + 2t² y la longitud es ∫₀¹ (1 + 2t²) dt = 1 + 2/3 = 5/3.

### P56 · dificultad 2 · kc: trayectorias · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Sea σ(t) = (t·sen t, cos 2t, t²). ¿Cuál es el vector aceleración en t = π/2?

- A) (0, 4, 2) · [deriva-producto-por-factores] derivas t·sen t como producto de factores: (t)″·(sen t)″ = 0 en la primera componente
- B) (π/2, −1, π²/4) · [posicion-en-lugar-de-velocidad] evalúas σ(π/2), la posición, como si fuera la aceleración
- C) (−π/2, 4, 2) · CORRECTA
- D) (1, 0, π) · [confunde-orden-de-derivada] derivas una sola vez y entregas la velocidad, cuando piden la aceleración

solución: σ′(t) = (sen t + t·cos t, −2 sen 2t, 2t) y σ″(t) = (2 cos t − t·sen t, −4 cos 2t, 2). En t = π/2: 2 cos(π/2) − (π/2)·sen(π/2) = −π/2, −4 cos π = 4 y 2. La aceleración es (−π/2, 4, 2).

### P57 · dificultad 3 · kc: trayectorias · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Halla la longitud de arco de σ(t) = (t²/2, √2·t, ln t) para 1 ≤ t ≤ 2.

- A) 29/6 · [norma-sin-raiz-cuadrada] integras |σ′|² = (t + 1/t)² sin sacar la raíz
- B) 3/2 + ln 2 · CORRECTA
- C) 5/2 · [longitud-rapidez-final-por-intervalo] multiplicas la rapidez en t = 2, que es 5/2, por la longitud del intervalo, que es 1
- D) 3/2 + √2 + ln 2 · [longitud-integra-suma-de-componentes] integras la suma de las componentes de σ′, que es t + √2 + 1/t

solución: σ′(t) = (t, √2, 1/t). Entonces |σ′|² = t² + 2 + 1/t² = (t + 1/t)², y como t > 0, |σ′| = t + 1/t. La longitud es ∫₁² (t + 1/t) dt = [t²/2 + ln t] de 1 a 2 = (2 − 1/2) + ln 2 = 3/2 + ln 2.

### P58 · dificultad 1 · kc: divergencia-rotacional · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Dado el campo F(x, y, z) = (xy², y²z, xz³), ¿cuál es su divergencia?

- A) 2xy + y² + z³ · [div-con-derivadas-cruzadas] sumas ∂P/∂y + ∂Q/∂z + ∂R/∂x en vez de derivar cada componente respecto de su propia variable
- B) y² + 2yz + 3xz² · CORRECTA
- C) (y², 2yz, 3xz²) · [div-como-vector] derivas cada componente respecto de su variable pero no las sumas, y dejas un vector
- D) (−y², −z³, −2xy) · [confunde-div-con-rot] calculas el rotacional, que es un vector, cuando piden la divergencia

solución: con P = xy², Q = y²z y R = xz³, se suma div F = ∂P/∂x + ∂Q/∂y + ∂R/∂z = y² + 2yz + 3xz². El resultado es un campo escalar. La opción D es el rotacional, con sus tres componentes (∂R/∂y − ∂Q/∂z, ∂P/∂z − ∂R/∂x, ∂Q/∂x − ∂P/∂y) = (0 − y², 0 − z³, 0 − 2xy).

### P59 · dificultad 2 · kc: divergencia-rotacional · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Calcula el rotacional de F(x, y, z) = (yz², x²z, xyz).

- A) (x² − xz, −yz, z² − 2xz) · [rot-orden-invertido] restas cada par de derivadas cruzadas al revés y obtienes el vector opuesto
- B) (xz − x², −yz, 2xz − z²) · [rot-j-sin-menos] al desarrollar el determinante olvidas el signo menos del componente j y calculas ∂R/∂x − ∂P/∂z
- C) xy · [confunde-div-con-rot] calculas la divergencia, que es un escalar, cuando piden el rotacional
- D) (xz − x², yz, 2xz − z²) · CORRECTA

solución: con P = yz², Q = x²z y R = xyz: i: ∂R/∂y − ∂Q/∂z = xz − x². j: ∂P/∂z − ∂R/∂x = 2yz − yz = yz. k: ∂Q/∂x − ∂P/∂y = 2xz − z². El rotacional es (xz − x², yz, 2xz − z²). La opción C, xy, es la divergencia: 0 + 0 + xy.

### P60 · dificultad 2 · kc: divergencia-rotacional · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Para el campo F(x, y, z) = (x³, 2y², z³), ¿cuál afirmación sobre su rotacional y su divergencia es correcta?

- A) rot F = 0 y div F = (3x², 4y, 3z²) · [div-como-vector] derivas cada componente respecto de su propia variable pero dejas el resultado como vector, sin sumar
- B) rot F = 0 y div F = 3x² + 4y + 3z² · CORRECTA
- C) rot F = 3x² + 4y + 3z² y div F = (0, 0, 0) · [confunde-div-con-rot] intercambias los nombres: llamas rotacional a la divergencia y divergencia al rotacional
- D) rot F = 0 y div F = 0, porque un campo sin rotacional tampoco tiene divergencia · [div-y-rot-se-anulan-juntos] crees que si el rotacional es nulo, la divergencia también lo es

solución: cada componente depende solo de su propia variable, así que todas las derivadas cruzadas valen 0 y rot F = (0, 0, 0). La divergencia es ∂(x³)/∂x + ∂(2y²)/∂y + ∂(z³)/∂z = 3x² + 4y + 3z². Que el rotacional sea nulo no obliga a que la divergencia lo sea: las dos operaciones miden cosas distintas.

### P61 · dificultad 2 · kc: divergencia-rotacional · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Sea F(x, y, z) = (x²z, xy², yz²). ¿Cuál es el rotacional de F en el punto (1, 2, 3)?

- A) (9, −1, 4) · [rot-j-sin-menos] olvidas el signo menos del componente j y calculas ∂R/∂x − ∂P/∂z en vez de ∂P/∂z − ∂R/∂x
- B) (9, 1, 4) · CORRECTA
- C) 22 · [confunde-div-con-rot] calculas la divergencia en el punto cuando piden el rotacional
- D) (−9, −1, −4) · [rot-orden-invertido] restas las derivadas cruzadas al revés, ∂Q/∂z − ∂R/∂y y las demás, y sale el vector opuesto

solución: con P = x²z, Q = xy² y R = yz²: i: ∂R/∂y − ∂Q/∂z = z² − 0 = z². j: ∂P/∂z − ∂R/∂x = x² − 0 = x². k: ∂Q/∂x − ∂P/∂y = y² − 0 = y². El rotacional es (z², x², y²) y en (1, 2, 3) vale (9, 1, 4). La divergencia, 2xz + 2xy + 2yz, vale 22 ahí.

### P62 · dificultad 3 · kc: divergencia-rotacional · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Sea F(x, y, z) = (y², z², x²). ¿Cuál afirmación es correcta?

- A) div F = 0 y rot F = (−2z, −2x, −2y); como el rotacional no es nulo, F no es el gradiente de ninguna función · CORRECTA
- B) div F = 0 y rot F = 0; por tanto F es el gradiente de alguna función · [div-y-rot-se-anulan-juntos] ves que la divergencia es nula y concluyes que el rotacional también lo es
- C) div F = 2(x + y + z) y rot F = (−2z, −2x, −2y); F no es un gradiente · [div-con-derivadas-cruzadas] sumas ∂P/∂y + ∂Q/∂z + ∂R/∂x en vez de las derivadas respecto de la propia variable
- D) div F = 0 y rot F = (2z, 2x, 2y); F no es un gradiente · [rot-orden-invertido] restas las derivadas cruzadas al revés y obtienes el rotacional con el signo contrario

solución: con P = y², Q = z² y R = x², cada componente no depende de su propia variable, así que ∂P/∂x = ∂Q/∂y = ∂R/∂z = 0 y div F = 0. El rotacional es (∂R/∂y − ∂Q/∂z, ∂P/∂z − ∂R/∂x, ∂Q/∂x − ∂P/∂y) = (0 − 2z, 0 − 2x, 0 − 2y) = (−2z, −2x, −2y). Si F fuera el gradiente de una función de clase C², su rotacional sería 0; como no lo es, F no es un gradiente. Divergencia nula no implica rotacional nulo.
