# Operaciones de funciones e inversas

Suma, producto, cociente y composición de funciones con sus dominios, y funciones uno a uno con su inversa y el dominio de esta. Cae en el Parcial 3 (semana 12).

## Habilidades
kc: composicion · Hallar sumas, productos, cocientes y composiciones de funciones con su dominio · prerrequisitos: evaluar-dominio
kc: inversa · Decidir si una función es uno a uno y hallar su inversa con su dominio · prerrequisitos: composicion

## Errores
mc: composicion-orden-invertido · composicion · inviertes el orden de las funciones: en f∘g aplicas f primero y g después, o en f/g divides g entre f
mc: composicion-como-producto · composicion · multiplicas f(x) por g(x) en vez de sustituir g(x) dentro de f
mc: composicion-cuadrado-termino-a-termino · composicion · al sustituir g(x) en una expresión con un cuadrado, elevas cada término de g(x) por separado y pierdes el doble producto
mc: dominio-composicion-ignora-interna · composicion · hallas el dominio de f∘g solo con la fórmula ya simplificada, sin exigir que x esté en el dominio de g
mc: dominio-cociente-sin-ceros-del-divisor · composicion · en el dominio de f/g no excluyes los valores de x donde g(x) = 0
mc: dominio-union-en-vez-de-interseccion · composicion · para el dominio de f/g tomas la unión de los dominios de f y de g en vez de su intersección
mc: inversa-como-reciproco · inversa · tomas f⁻¹(x) como 1/f(x), como si el −1 fuera un exponente
mc: inversa-sin-invertir-orden · inversa · deshaces las operaciones de f en el mismo orden en que f las aplica, en vez de en orden contrario
mc: inversa-solo-cambia-signo · inversa · crees que la inversa de f es la función opuesta, −f(x)
mc: uno-a-uno-confunde-con-funcion · inversa · crees que una función es uno a uno solo porque a cada x le corresponde un único valor de salida, sin revisar si dos entradas distintas comparten la misma salida
mc: dominio-inversa-igual-al-de-f · inversa · das como dominio de f⁻¹ el dominio de f, cuando debe ser el rango de f
mc: inversa-rama-contraria · inversa · al despejar x con una raíz eliges el signo de la raíz sin revisar la restricción del dominio de f

## Preguntas

### P101 · dificultad 1 · kc: composicion · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Si f(x) = x² y g(x) = 2x + 1, ¿cuál es (f∘g)(x)?

- A) 2x² + 1 · [composicion-orden-invertido] calculas g(f(x)) en vez de f(g(x)): aplicas primero el cuadrado y después duplicas y sumas 1
- B) 4x² + 4x + 1 · CORRECTA
- C) 2x³ + x² · [composicion-como-producto] multiplicas f(x)·g(x) = x²(2x + 1) en vez de sustituir g(x) dentro de f
- D) 4x² + 1 · [composicion-cuadrado-termino-a-termino] sustituyes bien, pero elevas al cuadrado cada término de 2x + 1 por separado y pierdes el doble producto 4x

solución: (f∘g)(x) = f(g(x)) = f(2x + 1) = (2x + 1)². El cuadrado del binomio da (2x)² + 2·(2x)·1 + 1 = 4x² + 4x + 1.

### P102 · dificultad 2 · kc: composicion · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Sean f(x) = x² + 1 y g(x) = √(x − 2). La función f∘g, ya simplificada, y su dominio son:

- A) (f∘g)(x) = x − 1, con dominio todos los reales · [dominio-composicion-ignora-interna] la fórmula simplificada x − 1 existe para todo x y olvidas que g exige x ≥ 2
- B) (f∘g)(x) = (x² + 1)·√(x − 2), con dominio x ≥ 2 · [composicion-como-producto] multiplicas f(x)·g(x) en vez de evaluar f en g(x)
- C) (f∘g)(x) = x − 1, con dominio x ≥ 2 · CORRECTA
- D) (f∘g)(x) = √(x² − 1), con dominio x ≤ −1 o x ≥ 1 · [composicion-orden-invertido] calculas g(f(x)) en vez de f(g(x))

solución: (f∘g)(x) = f(√(x − 2)) = (√(x − 2))² + 1 = (x − 2) + 1 = x − 1. Para evaluar f∘g, x debe estar en el dominio de g, que pide x − 2 ≥ 0, es decir x ≥ 2. La fórmula x − 1 sola no lo muestra, pero el dominio de f∘g sigue siendo x ≥ 2.

### P103 · dificultad 2 · kc: composicion · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Considera f(x) = √(x + 3) y g(x) = x² − 6x + 8. ¿Dónde está definido el cociente f/g?

- A) x ≥ −3 · [dominio-cociente-sin-ceros-del-divisor] tomas el dominio de f y no excluyes los ceros de g, que son x = 2 y x = 4
- B) x ≥ −3, con x ≠ 2 y x ≠ 4 · CORRECTA
- C) todos los reales, con x ≠ 2 y x ≠ 4 · [dominio-union-en-vez-de-interseccion] unes el dominio de f con el de g (que es ℝ) en vez de intersecarlos, y solo excluyes los ceros de g
- D) x > −3 · [composicion-orden-invertido] calculas el dominio de g/f: excluyes el cero de f (x = −3) y ningún cero de g

solución: para f/g se necesitan tres condiciones. Primero, x + 3 ≥ 0, es decir x ≥ −3. Segundo, nada que pedir a g, que existe para todo real. Tercero, el divisor no puede anularse: g(x) = (x − 2)(x − 4) vale cero en x = 2 y en x = 4. Queda [−3, 2) ∪ (2, 4) ∪ (4, ∞).

### P104 · dificultad 2 · kc: composicion · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Sean f(x) = √(6 − x) y g(x) = √(x + 2). El dominio de f/g es:

- A) −2 ≤ x ≤ 6 · [dominio-cociente-sin-ceros-del-divisor] intersecas los dominios de f y g, pero no excluyes x = −2, donde g vale 0
- B) −2 ≤ x < 6 · [composicion-orden-invertido] calculas el dominio de g/f: excluyes x = 6, donde f vale 0, en vez de x = −2
- C) −2 < x ≤ 6 · CORRECTA
- D) todos los reales · [dominio-union-en-vez-de-interseccion] unes los dominios x ≤ 6 y x ≥ −2 en vez de intersecarlos

solución: f necesita 6 − x ≥ 0, o sea x ≤ 6. g necesita x + 2 ≥ 0, o sea x ≥ −2. Para el cociente, x está en ambos dominios y además g(x) ≠ 0. g(x) = 0 cuando x = −2, así que se excluye. El dominio es (−2, 6].

### P105 · dificultad 3 · kc: composicion · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Sean f(x) = x² − 4x y g(x) = √(x + 1) + 2. La función f∘g, simplificada al máximo, y su dominio son:

- A) (f∘g)(x) = √(x² − 4x + 1) + 2, con dominio x ≤ 2 − √3 o x ≥ 2 + √3 · [composicion-orden-invertido] calculas g(f(x)) en vez de f(g(x))
- B) (f∘g)(x) = x − 3, con dominio todos los reales · [dominio-composicion-ignora-interna] simplificas bien a x − 3 y olvidas que g exige x ≥ −1
- C) (f∘g)(x) = x − 3 − 4√(x + 1), con dominio x ≥ −1 · [composicion-cuadrado-termino-a-termino] elevas al cuadrado cada término de √(x + 1) + 2 por separado y obtienes x + 1 + 4 sin el término 4√(x + 1)
- D) (f∘g)(x) = x − 3, con dominio x ≥ −1 · CORRECTA

solución: (f∘g)(x) = f(g(x)) = g² − 4g = g·(g − 4), con g = √(x + 1) + 2. Entonces g − 4 = √(x + 1) − 2 y el producto (√(x + 1) + 2)(√(x + 1) − 2) es una diferencia de cuadrados: (x + 1) − 4 = x − 3. El dominio sale de g: x + 1 ≥ 0, o sea x ≥ −1 (f no restringe nada). Por eso el dominio de f∘g es x ≥ −1 aunque la fórmula x − 3 exista para todo x.

### P106 · dificultad 1 · kc: inversa · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
La función inversa de f(x) = 3x + 2 es:

- A) f⁻¹(x) = $\frac{1}{3x + 2}$ · [inversa-como-reciproco] tomas la inversa como el recíproco 1/f(x)
- B) f⁻¹(x) = −3x − 2 · [inversa-solo-cambia-signo] tomas la inversa como la función opuesta −f(x)
- C) f⁻¹(x) = $\frac{x - 2}{3}$ · CORRECTA
- D) f⁻¹(x) = $\frac{x}{3}$ − 2 · [inversa-sin-invertir-orden] deshaces en el mismo orden de f: divides entre 3 y luego restas 2, en vez de restar 2 y luego dividir

solución: f multiplica por 3 y después suma 2. Para deshacerlo se hace lo contrario en orden contrario: primero restar 2 y después dividir entre 3. Con y = 3x + 2: x = (y − 2)/3, así que f⁻¹(x) = (x − 2)/3. Comprobación: f((x − 2)/3) = x − 2 + 2 = x.

### P107 · dificultad 2 · kc: inversa · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Sea f(x) = x² − 6x, con dominio todos los reales. ¿Cuál afirmación es correcta?

- A) Es uno a uno, porque a cada valor de x le corresponde un único valor de f(x) · [uno-a-uno-confunde-con-funcion] confundes ser función con ser uno a uno: eso solo dice que cada entrada tiene una salida
- B) Es uno a uno y su inversa es f⁻¹(x) = $\frac{1}{x^2 - 6x}$ · [inversa-como-reciproco] además de creerla uno a uno, tomas la inversa como el recíproco de f
- C) Es uno a uno, porque f(1) = −5 y f(2) = −8 son distintos · [uno-a-uno-confunde-con-funcion] pruebas un solo par de entradas con salidas distintas y concluyes que ninguna salida se repite
- D) No es uno a uno, porque f(1) = f(5) = −5, así que no tiene inversa en todo ℝ · CORRECTA

solución: una función es uno a uno cuando no hay dos entradas distintas con la misma salida. Aquí f(1) = 1 − 6 = −5 y f(5) = 25 − 30 = −5, o sea dos entradas distintas dan −5. Entonces f no es uno a uno en ℝ y no tiene inversa allí (la gráfica es una parábola y una recta horizontal la corta en dos puntos).

### P108 · dificultad 2 · kc: inversa · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Sea $f(x) = \frac{2x + 1}{x - 3}$, con x ≠ 3. Su inversa y el dominio de esta son:

- A) $f^{-1}(x) = \frac{x - 3}{2x + 1}$, con x ≠ −1/2 · [inversa-como-reciproco] tomas la inversa como el recíproco de f
- B) $f^{-1}(x) = \frac{3x + 1}{x - 2}$, con x ≠ 3 · [dominio-inversa-igual-al-de-f] hallas bien la fórmula, pero conservas el dominio de f en vez del rango de f (que excluye 2)
- C) $f^{-1}(x) = \frac{3x + 1}{x - 2}$, con x ≠ 2 · CORRECTA
- D) $f^{-1}(x) = -\frac{2x + 1}{x - 3}$, con x ≠ 3 · [inversa-solo-cambia-signo] tomas la inversa como la función opuesta −f(x)

solución: se escribe y = (2x + 1)/(x − 3) y se despeja x: y(x − 3) = 2x + 1, luego xy − 3y = 2x + 1, luego x(y − 2) = 3y + 1, así que x = (3y + 1)/(y − 2). Cambiando los nombres, f⁻¹(x) = (3x + 1)/(x − 2). El dominio de f⁻¹ es el rango de f. El valor 2 nunca es salida de f, porque (2x + 1)/(x − 3) = 2 lleva a 2x + 1 = 2x − 6, que es imposible. Por eso el dominio de f⁻¹ es x ≠ 2.

### P109 · dificultad 2 · kc: inversa · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Sea f(x) = x² − 4, con dominio x ≥ 0. La función inversa y su dominio son:

- A) f⁻¹(x) = √x + 4, con x ≥ 0 · [inversa-sin-invertir-orden] deshaces en el mismo orden de f: sacas la raíz y luego sumas 4, en vez de sumar 4 y luego sacar la raíz
- B) f⁻¹(x) = −√(x + 4), con x ≥ −4 · [inversa-rama-contraria] tomas la raíz negativa aunque la restricción x ≥ 0 exige que la inversa dé valores no negativos
- C) f⁻¹(x) = √(x + 4), con x ≥ 0 · [dominio-inversa-igual-al-de-f] hallas bien la fórmula, pero usas como dominio el de f (x ≥ 0) en vez de su rango
- D) f⁻¹(x) = √(x + 4), con x ≥ −4 · CORRECTA

solución: con y = x² − 4 y x ≥ 0: x² = y + 4, y como x no es negativo, x = √(y + 4). Entonces f⁻¹(x) = √(x + 4). El dominio de f⁻¹ es el rango de f: para x ≥ 0, x² − 4 ≥ −4 y toma todos los valores de −4 en adelante. Por eso el dominio de f⁻¹ es x ≥ −4.

### P110 · dificultad 3 · kc: inversa · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Sea f(x) = x² − 4x + 7, con dominio x ≤ 2. La función inversa y su dominio son:

- A) f⁻¹(x) = 2 + √(x − 3), con x ≥ 3 · [inversa-rama-contraria] tomas la raíz positiva aunque la restricción x ≤ 2 exige que la inversa dé valores menores o iguales que 2
- B) f⁻¹(x) = 2 ± √(x − 3), con x ≥ 3 · [uno-a-uno-confunde-con-funcion] ignoras la restricción y tratas f como uno a uno en todo ℝ, así que dejas las dos ramas de la raíz
- C) f⁻¹(x) = 2 − √(x − 3), con x ≤ 2 · [dominio-inversa-igual-al-de-f] hallas bien la fórmula, pero usas como dominio el de f en vez de su rango
- D) f⁻¹(x) = 2 − √(x − 3), con x ≥ 3 · CORRECTA

solución: se completa el cuadrado: f(x) = (x − 2)² + 3. Con y = (x − 2)² + 3 queda (x − 2)² = y − 3, luego x − 2 = ±√(y − 3). Como x ≤ 2, x − 2 ≤ 0, y se elige el signo negativo: x = 2 − √(y − 3). Así f⁻¹(x) = 2 − √(x − 3). El rango de f, para x ≤ 2, empieza en f(2) = 3 y crece, así que el dominio de f⁻¹ es x ≥ 3.
