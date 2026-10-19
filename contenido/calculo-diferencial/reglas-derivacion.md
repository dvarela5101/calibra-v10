# Reglas de derivación

Derivadas de potencias, sumas, productos y cocientes, derivadas de funciones trascendentes, regla de la cadena, derivación implícita y derivación logarítmica. Es del Parcial 2 (semanas 6 y 7 del programa). De Precálculo hacen falta el álgebra, la trigonometría, los exponentes y los logaritmos. Los errores que faltaban y las preguntas nuevas son borradores de IA (HU-101), escritos con el criterio del modelo y apuntes libres, y esperan la revisión de un desarrollador.

## Habilidades
kc: reglas-derivacion · Derivar potencias, sumas, productos y cocientes con las reglas de derivación
kc: derivadas-trascendentes · Derivar funciones trigonométricas, exponenciales, logarítmicas y trigonométricas inversas · prerrequisitos: reglas-derivacion
kc: regla-cadena · Derivar una composición de funciones con la regla de la cadena · prerrequisitos: reglas-derivacion, dominio-composicion
kc: derivacion-implicita · Hallar dy/dx de una curva dada de forma implícita · prerrequisitos: regla-cadena
kc: derivacion-logaritmica · Derivar funciones de la forma f(x)^g(x) o con muchos factores usando logaritmos · prerrequisitos: regla-cadena, derivadas-trascendentes

## Errores
mc: seno-no-cambia-a-coseno · derivadas-trascendentes · al derivar sen u dejas sen u y solo multiplicas por la derivada del interior, sin pasarlo a cos u
mc: omite-derivada-interior · regla-cadena · derivas la función de afuera y olvidas multiplicar por la derivada de lo que está adentro
mc: interior-sin-derivar · regla-cadena · multiplicas por la expresión de adentro, o por parte de ella, en vez de multiplicar por su derivada
mc: interior-derivado-queda-adentro · regla-cadena · derivas la expresión de adentro pero la dejas dentro de la función de afuera en lugar de multiplicar por ella
mc: producto-factor-a-factor · reglas-derivacion · derivas un producto, o un cociente, derivando cada factor por separado y multiplicando, o dividiendo, esas derivadas
mc: cociente-sin-cuadrado · reglas-derivacion · en la regla del cociente dejas el denominador sin elevar al cuadrado
mc: cociente-resta-invertida · reglas-derivacion · en el numerador de la regla del cociente restas en el orden contrario: pones f·g' − f'·g en vez de f'·g − f·g'
mc: potencia-sin-bajar-exponente · reglas-derivacion · al derivar una potencia restas 1 al exponente pero no multiplicas por el exponente original
mc: potencia-sin-restar-uno · reglas-derivacion · al derivar una potencia multiplicas por el exponente pero dejas el exponente igual, sin restarle 1
mc: exponente-negativo-suma-uno · reglas-derivacion · al derivar una potencia de exponente negativo le sumas 1 al exponente en vez de restárselo, y x⁻² te queda como x⁻¹
mc: derivada-coseno-sin-signo · derivadas-trascendentes · derivas cos u como sen u y olvidas el signo menos
mc: exponencial-sin-ln-base · derivadas-trascendentes · derivas aˣ como aˣ y olvidas multiplicar por ln a
mc: log-base-sin-ln-a · derivadas-trascendentes · derivas el logaritmo en base a como si fuera ln y olvidas dividir entre ln a
mc: exponencial-como-potencia · derivadas-trascendentes · derivas aˣ con la regla de la potencia, como x·aˣ⁻¹, como si el exponente fuera constante
mc: arcsen-arctan-intercambiadas · derivadas-trascendentes · mezclas las fórmulas de las inversas trigonométricas: usas la de arcsen para arctan, o la de arctan para arcsen
mc: derivada-y-sin-dydx · derivacion-implicita · derivas un término con y como si y fuera la variable independiente y no multiplicas por dy/dx
mc: producto-xy-un-termino · derivacion-implicita · al derivar un producto de x con y usas solo uno de los dos términos de la regla del producto
mc: despeje-signo-mal · derivacion-implicita · al pasar términos al otro lado para despejar dy/dx no les cambias el signo
mc: coordenadas-invertidas · derivacion-implicita · al evaluar dy/dx en el punto (a, b) sustituyes x = b y y = a
mc: potencia-en-exponencial · derivacion-logaritmica · derivas una expresión con exponente variable, como xˣ o 3ˣ, con la regla de la potencia: bajas el exponente y le restas 1
mc: exponencial-con-base-variable · derivacion-logaritmica · derivas f(x)^g(x) como si la base fuera constante: dejas la misma potencia y la multiplicas por ln f y por g'
mc: omite-multiplicar-por-y · derivacion-logaritmica · después de derivar ln y entregas la expresión de y'/y como si fuera y', sin multiplicar por y
mc: cociente-log-como-suma · derivacion-logaritmica · al tomar logaritmo de un cociente sumas el logaritmo del denominador en vez de restarlo
mc: exponente-no-baja-del-log · derivacion-logaritmica · al tomar logaritmo de una potencia o de una raíz no bajas el exponente como factor

## Preguntas

### P4 · dificultad 2 · kc: regla-cadena · revisada · origen: humano · revisó: prototipo · ⚠ revisar
Deriva: f(x) = (3x² + 1)⁵

- A) f'(x) = 5(3x² + 1)⁴ · 6x = 30x(3x² + 1)⁴ · CORRECTA
- B) f'(x) = 5(3x² + 1)⁴ · [omite-derivada-interior]
- C) f'(x) = 15x²(3x² + 1)⁴ · [interior-sin-derivar]
- D) f'(x) = 5(6x)⁴ · [interior-derivado-queda-adentro]

### P6 · dificultad 2 · kc: regla-cadena, derivadas-trascendentes · revisada · origen: humano · revisó: prototipo · ⚠ revisar
Deriva: g(x) = sen(x³)

- A) g'(x) = 3x² cos(x³) · CORRECTA
- B) g'(x) = cos(x³) · [omite-derivada-interior]
- C) g'(x) = 3x² sen(x³) · [seno-no-cambia-a-coseno]
- D) g'(x) = cos(3x²) · [interior-derivado-queda-adentro]

### P62 · dificultad 1 · kc: reglas-derivacion · borrador · origen: ia (sonnet-5.5)
Si f(x) = 3x⁵ − x⁻², ¿cuál es f'(x)?

- A) 3x⁴ − x⁻³ · [potencia-sin-bajar-exponente] restas 1 a cada exponente pero no multiplicas por el exponente original
- B) 15x⁴ + 2x⁻¹ · [exponente-negativo-suma-uno] en el término de exponente negativo sumas 1 al exponente en vez de restárselo
- C) 15x⁴ + 2x⁻³ · CORRECTA
- D) 15x⁵ + 2x⁻² · [potencia-sin-restar-uno] multiplicas por el exponente pero no le restas 1 al exponente

solución: se deriva término a término con (xⁿ)' = n·xⁿ⁻¹. Para 3x⁵ queda 3·5·x⁴ = 15x⁴. Para −x⁻² queda −(−2)·x⁻³ = 2x⁻³. Entonces f'(x) = 15x⁴ + 2x⁻³. La A baja el exponente sin el factor n (3x⁴ y −x⁻³). La B suma 1 al exponente −2 y obtiene −1 (2x⁻¹). La D multiplica por el exponente pero deja x⁵ y x⁻².

### P63 · dificultad 2 · kc: reglas-derivacion · borrador · origen: ia (sonnet-5.5)
Deriva $g(x) = (x + 2)\sqrt{x}$.

- A) $\frac{3x+2}{2\sqrt{x}}$ · CORRECTA
- B) $\frac{1}{2\sqrt{x}}$ · [producto-factor-a-factor] derivas cada factor por separado y multiplicas: (x + 2)' por (√x)'
- C) $\frac{2x+2}{\sqrt{x}}$ · [potencia-sin-bajar-exponente] al derivar √x = x^(1/2) restas 1 al exponente pero no multiplicas por 1/2, y te queda 1/√x
- D) $\frac{\sqrt{x}\,(x+4)}{2}$ · [potencia-sin-restar-uno] al derivar √x multiplicas por 1/2 pero dejas el exponente en 1/2, y te queda √x/2

solución: regla del producto: g' = (x + 2)'·√x + (x + 2)·(√x)'. Como (√x)' = 1/(2√x), g' = √x + (x + 2)/(2√x) = (2x + x + 2)/(2√x) = (3x + 2)/(2√x). La B es (x + 2)'·(√x)' = 1/(2√x). La C usa (√x)' = 1/√x: √x + (x + 2)/√x = (2x + 2)/√x. La D usa (√x)' = √x/2: √x + (x + 2)√x/2 = √x(x + 4)/2.

### P64 · dificultad 2 · kc: reglas-derivacion · borrador · origen: ia (sonnet-5.5)
Deriva $h(x) = \frac{2x - 3}{x^2 + 1}$.

- A) $\frac{1}{x}$ · [producto-factor-a-factor] derivas numerador y denominador por separado y divides: 2 entre 2x
- B) $\frac{-2x^2 + 6x + 2}{x^2 + 1}$ · [cociente-sin-cuadrado] aplicas bien el numerador de la regla del cociente pero dejas el denominador sin elevar al cuadrado
- C) $\frac{2x^2 - 6x - 2}{(x^2 + 1)^2}$ · [cociente-resta-invertida] restas en el orden contrario: (2x − 3)·2x − 2·(x² + 1)
- D) $\frac{-2x^2 + 6x + 2}{(x^2 + 1)^2}$ · CORRECTA

solución: regla del cociente (f/g)' = (f'g − fg')/g². Con f = 2x − 3 y g = x² + 1: numerador = 2(x² + 1) − (2x − 3)(2x) = 2x² + 2 − 4x² + 6x = −2x² + 6x + 2, y el denominador es (x² + 1)². La A deriva arriba y abajo por separado (2/2x). La B olvida el cuadrado. La C resta al revés y obtiene el opuesto del numerador correcto.

### P65 · dificultad 3 · kc: reglas-derivacion · borrador · origen: ia (sonnet-5.5)
Deriva $h(x) = \frac{x^{-2} + 3}{x^2 - 1}$.

- A) $-\frac{8x}{(x^2 - 1)^2}$ · [exponente-negativo-suma-uno] derivas x⁻² como −2x⁻¹, sumando 1 al exponente en vez de restárselo
- B) $-\frac{6x^4 + 4x^2 - 2}{x^3(x^2 - 1)^2}$ · CORRECTA
- C) $\frac{6x^4 + 4x^2 - 2}{x^3(x^2 - 1)^2}$ · [cociente-resta-invertida] restas en el orden contrario y el numerador queda con el signo opuesto
- D) $-\frac{6x^4 + 4x^2 - 2}{x^3(x^2 - 1)}$ · [cociente-sin-cuadrado] calculas bien el numerador pero dejas (x² − 1) sin elevar al cuadrado en el denominador

solución: f = x⁻² + 3, f' = −2x⁻³; g = x² − 1, g' = 2x. Numerador de la regla del cociente: f'g − fg' = −2x⁻³(x² − 1) − (x⁻² + 3)(2x) = −2x⁻¹ + 2x⁻³ − 2x⁻¹ − 6x = −4x⁻¹ + 2x⁻³ − 6x. Multiplicando arriba y abajo por x³ queda (−4x² + 2 − 6x⁴)/(x³(x² − 1)²) = −(6x⁴ + 4x² − 2)/(x³(x² − 1)²). La A usa f' = −2x⁻¹ y el numerador se reduce a −8x. La C es el opuesto del resultado correcto. La D omite el cuadrado.

### P66 · dificultad 1 · kc: derivadas-trascendentes · borrador · origen: ia (sonnet-5.5)
Deriva $f(x) = 2\cos x - 3^x$.

- A) $2\sen x - 3^x \ln 3$ · [derivada-coseno-sin-signo] derivas cos x como sen x y pierdes el signo menos
- B) $-2\sen x - 3^x \ln 3$ · CORRECTA
- C) $-2\sen x - 3^x$ · [exponencial-sin-ln-base] derivas 3ˣ como 3ˣ y olvidas multiplicar por ln 3
- D) $-2\sen x - x\cdot 3^{x-1}$ · [exponencial-como-potencia] derivas 3ˣ con la regla de la potencia, como si el exponente fuera una constante

solución: (cos x)' = −sen x, así que (2 cos x)' = −2 sen x. Para la exponencial, (aˣ)' = aˣ ln a, y (3ˣ)' = 3ˣ ln 3. Entonces f'(x) = −2 sen x − 3ˣ ln 3. La A pierde el signo de la derivada del coseno, la C pierde el factor ln 3 y la D usa (xⁿ)' = n·xⁿ⁻¹ con n = x, que no vale cuando la x está en el exponente.

### P67 · dificultad 2 · kc: derivadas-trascendentes, reglas-derivacion · borrador · origen: ia (sonnet-5.5)
Deriva $f(x) = 2^x \sen x$.

- A) 2ˣ ln 2·cos x · [producto-factor-a-factor] multiplicas la derivada de 2ˣ por la derivada de sen x, sin usar la regla del producto
- B) 2ˣ(ln 2·sen x + sen x) · [seno-no-cambia-a-coseno] al derivar sen x dejas sen x en vez de pasarlo a cos x
- C) 2ˣ(sen x + cos x) · [exponencial-sin-ln-base] derivas 2ˣ como 2ˣ y olvidas el factor ln 2
- D) 2ˣ(ln 2·sen x + cos x) · CORRECTA

solución: regla del producto: f' = (2ˣ)'·sen x + 2ˣ·(sen x)'. Como (2ˣ)' = 2ˣ ln 2 y (sen x)' = cos x, f' = 2ˣ ln 2·sen x + 2ˣ cos x = 2ˣ(ln 2·sen x + cos x). La A multiplica las dos derivadas. La B deja el seno sin derivar. La C olvida ln 2.

### P68 · dificultad 3 · kc: derivadas-trascendentes, reglas-derivacion · borrador · origen: ia (sonnet-5.5)
Deriva $f(x) = \log_2 x \cdot \text{arctan}\,x$.

- A) $\frac{\text{arctan}\,x}{x \ln 2} + \frac{\log_2 x}{1 + x^2}$ · CORRECTA
- B) $\frac{\text{arctan}\,x}{x} + \frac{\log_2 x}{1 + x^2}$ · [log-base-sin-ln-a] derivas log₂ x como 1/x y olvidas dividir entre ln 2
- C) $\frac{\text{arctan}\,x}{x \ln 2} + \frac{\log_2 x}{\sqrt{1 - x^2}}$ · [arcsen-arctan-intercambiadas] usas para arctan la derivada de arcsen
- D) $\frac{1}{x(1 + x^2)\ln 2}$ · [producto-factor-a-factor] multiplicas la derivada de log₂ x por la derivada de arctan x

solución: regla del producto con (log₂ x)' = 1/(x ln 2) y (arctan x)' = 1/(1 + x²). Entonces f' = (1/(x ln 2))·arctan x + log₂ x·(1/(1 + x²)). La B omite ln 2. La C usa 1/√(1 − x²), que es la derivada de arcsen x. La D multiplica las dos derivadas sin aplicar la regla del producto.

### P69 · dificultad 1 · kc: regla-cadena, derivadas-trascendentes · borrador · origen: ia (sonnet-5.5)
Deriva $g(x) = \text{arctan}(2x)$.

- A) $\frac{1}{1 + 4x^2}$ · [omite-derivada-interior] derivas la función de afuera y no multiplicas por la derivada de 2x
- B) $\frac{2x}{1 + 4x^2}$ · [interior-sin-derivar] multiplicas por la expresión de adentro, 2x, en vez de multiplicar por su derivada
- C) $\frac{2}{1 + 4x^2}$ · CORRECTA
- D) $\frac{2}{\sqrt{1 - 4x^2}}$ · [arcsen-arctan-intercambiadas] usas para arctan la derivada de arcsen

solución: la derivada de arctan u es u'/(1 + u²). Con u = 2x, u' = 2 y 1 + u² = 1 + 4x², así que g'(x) = 2/(1 + 4x²). La A olvida el factor 2, la B multiplica por 2x en vez de por 2 y la D usa la fórmula de arcsen.

### P70 · dificultad 3 · kc: regla-cadena, derivadas-trascendentes · borrador · origen: ia (sonnet-5.5)
Deriva $f(x) = \log_2(\cos 3x)$ en un intervalo donde cos 3x > 0.

- A) $\frac{3\tan 3x}{\ln 2}$ · [derivada-coseno-sin-signo] derivas cos 3x como sen 3x y pierdes el signo menos
- B) $-3\tan 3x$ · [log-base-sin-ln-a] derivas el logaritmo en base 2 como si fuera ln y olvidas dividir entre ln 2
- C) $-\frac{\tan 3x}{\ln 2}$ · [omite-derivada-interior] al derivar cos 3x no multiplicas por la derivada de 3x
- D) $-\frac{3\tan 3x}{\ln 2}$ · CORRECTA

solución: hay tres capas: log₂, cos y 3x. Se deriva de afuera hacia adentro: (log₂ u)' = u'/(u ln 2), con u = cos 3x y u' = −sen 3x·3 = −3 sen 3x. Entonces f' = −3 sen 3x/(cos 3x·ln 2) = −3 tan 3x/ln 2. La A cambia el signo de u', la B omite ln 2 y la C omite el 3 que viene de derivar 3x.

### P71 · dificultad 1 · kc: derivacion-implicita, reglas-derivacion · borrador · origen: ia (sonnet-5.5)
La curva $x^2 + y^3 + y = 8x$ define a y como función de x. ¿Cuánto vale dy/dx?

- A) $8 - 2x - 3y^2$ · [derivada-y-sin-dydx] derivas y³ como 3y² sin multiplicar por dy/dx
- B) $\frac{2x - 8}{3y^2 + 1}$ · [despeje-signo-mal] al pasar 2x y 8 al otro lado no les cambias el signo
- C) $\frac{8 - 2x}{3y^2 + 1}$ · CORRECTA
- D) $\frac{8 - 2x}{y^2 + 1}$ · [potencia-sin-bajar-exponente] derivas y³ como y²·y' y olvidas el factor 3 del exponente

solución: se deriva respecto de x: 2x + 3y²·y' + y' = 8. Se agrupan los términos con y': y'(3y² + 1) = 8 − 2x, y entonces y' = (8 − 2x)/(3y² + 1). La A no multiplica 3y² por y', y queda y' = 8 − 2x − 3y². La B mueve los términos sin cambiar el signo. La D baja el exponente sin el factor 3.

### P72 · dificultad 2 · kc: derivacion-implicita · borrador · origen: ia (sonnet-5.5)
El punto (1, 2) está en la curva $x^2 + 3xy + y^2 = 11$. ¿Cuánto vale dy/dx en ese punto?

- A) −4 · [derivada-y-sin-dydx] derivas y² como 2y sin multiplicar por dy/dx
- B) −8/7 · CORRECTA
- C) −2/7 · [producto-xy-un-termino] derivas 3xy como 3x·y' y pierdes el término 3y de la regla del producto
- D) −7/8 · [coordenadas-invertidas] calculas dy/dx con x = 2 y y = 1 en vez de x = 1 y y = 2

solución: se deriva: 2x + 3(y + x·y') + 2y·y' = 0. Entonces y'(3x + 2y) = −(2x + 3y), y' = −(2x + 3y)/(3x + 2y). En (1, 2): −(2 + 6)/(3 + 4) = −8/7. La A deja 2y sin y' y da −(2x + 5y)/(3x) = −4. La C usa solo 3x·y' y da −2x/(3x + 2y) = −2/7. La D intercambia las coordenadas y da −(4 + 3)/(6 + 2) = −7/8.

### P73 · dificultad 2 · kc: derivacion-implicita · borrador · origen: ia (sonnet-5.5)
El punto (1, 2) está en la curva $x^2 y + y^3 = 10$. ¿Cuál es la pendiente de la recta tangente en ese punto?

- A) −4/7 · [coordenadas-invertidas] sustituyes x = 2 y y = 1 en la expresión de dy/dx
- B) −1/3 · [producto-xy-un-termino] derivas x²y como 2xy y olvidas el término x²·y'
- C) −16 · [derivada-y-sin-dydx] derivas y³ como 3y² sin multiplicar por dy/dx
- D) −4/13 · CORRECTA

solución: se deriva: 2xy + x²·y' + 3y²·y' = 0, de modo que y' = −2xy/(x² + 3y²). En (1, 2): −4/(1 + 12) = −4/13. La A sustituye con las coordenadas cambiadas: −4/(4 + 3) = −4/7. La B omite x²·y' y queda −2xy/(3y²) = −1/3. La C deja 3y² sin y' y da −(2xy + 3y²)/x² = −16.

### P74 · dificultad 3 · kc: derivacion-implicita, derivadas-trascendentes, regla-cadena · borrador · origen: ia (sonnet-5.5)
Para la curva $\sen(xy) = x + y$, ¿cuánto vale dy/dx?

- A) $\frac{1 - y\cos(xy)}{x\cos(xy) - 1}$ · CORRECTA
- B) $\frac{1 + y\cos(xy)}{x\cos(xy) - 1}$ · [despeje-signo-mal] pasas y·cos(xy) al otro lado sin cambiarle el signo
- C) $\frac{1}{x\cos(xy) - 1}$ · [producto-xy-un-termino] derivas xy como x·y' y pierdes el término y
- D) $\cos(xy) - 1$ · [omite-derivada-interior] derivas sen(xy) como cos(xy) y no multiplicas por la derivada de xy

solución: se deriva: cos(xy)·(y + x·y') = 1 + y'. Se separan los términos con y': x·cos(xy)·y' − y' = 1 − y·cos(xy), luego y' = (1 − y cos(xy))/(x cos(xy) − 1). La B no cambia el signo de y·cos(xy) al pasarlo. La C usa (xy)' = x·y'. La D reduce el lado izquierdo a cos(xy) y da cos(xy) = 1 + y'.

### P75 · dificultad 1 · kc: derivacion-logaritmica · borrador · origen: ia (sonnet-5.5)
Si y = x^(5x) para x > 0, ¿cuánto vale y'?

- A) $5x\cdot x^{5x-1}$ · [potencia-en-exponencial] usas la regla de la potencia y bajas 5x como exponente
- B) $5\,x^{5x}\ln x$ · [exponencial-con-base-variable] usas la regla de aˣ con la base x como si fuera constante: x^(5x)·ln x·5
- C) $5(\ln x + 1)$ · [omite-multiplicar-por-y] calculas bien y'/y pero no lo multiplicas por y
- D) $5\,x^{5x}(\ln x + 1)$ · CORRECTA

solución: se toma logaritmo: ln y = 5x·ln x. Se deriva: y'/y = 5 ln x + 5x·(1/x) = 5(ln x + 1). Se multiplica por y: y' = 5x^(5x)(ln x + 1). La A es la regla de la potencia, que no vale con exponente variable. La B solo deriva el exponente y olvida que la base también varía. La C se queda en y'/y.

### P76 · dificultad 2 · kc: derivacion-logaritmica · borrador · origen: ia (sonnet-5.5)
Deriva $y = (\cos x)^x$ en un intervalo donde cos x > 0.

- A) $x(\cos x)^{x-1}(-\sen x)$ · [potencia-en-exponencial] usas la regla de la potencia con la cadena, como si el exponente x fuera constante
- B) $(\cos x)^x(\ln(\cos x) - x\tan x)$ · CORRECTA
- C) $(\cos x)^x \ln(\cos x)$ · [exponencial-con-base-variable] usas la regla de aˣ como si cos x fuera constante
- D) $\ln(\cos x) - x\tan x$ · [omite-multiplicar-por-y] dejas y'/y y no lo multiplicas por y

solución: ln y = x·ln(cos x). Se deriva: y'/y = ln(cos x) + x·(−sen x/cos x) = ln(cos x) − x tan x. Se multiplica por y = (cos x)ˣ. La A baja el exponente como en una potencia, la C solo deriva el exponente y la D se queda en y'/y.

### P77 · dificultad 2 · kc: derivacion-logaritmica, regla-cadena · borrador · origen: ia (sonnet-5.5)
Sea $y = \frac{x^4(2x + 1)^3}{(x - 5)^2}$. Entonces y' es igual a:

- A) $y\left(\frac{4}{x} + \frac{3}{2x+1} - \frac{2}{x-5}\right)$ · [omite-derivada-interior] al derivar ln(2x + 1) no multiplicas por la derivada de 2x + 1
- B) $y\left(\frac{1}{x} + \frac{2}{2x+1} - \frac{1}{x-5}\right)$ · [exponente-no-baja-del-log] al tomar logaritmo no bajas los exponentes 4, 3 y 2
- C) $y\left(\frac{4}{x} + \frac{6}{2x+1} - \frac{2}{x-5}\right)$ · CORRECTA
- D) $y\left(\frac{4}{x} + \frac{6}{2x+1} + \frac{2}{x-5}\right)$ · [cociente-log-como-suma] sumas el logaritmo del denominador en vez de restarlo

solución: ln y = 4 ln x + 3 ln(2x + 1) − 2 ln(x − 5). Se deriva: y'/y = 4/x + 3·2/(2x + 1) − 2/(x − 5) = 4/x + 6/(2x + 1) − 2/(x − 5). Se multiplica por y. La A olvida el factor 2 de la derivada de 2x + 1 (queda 3/(2x + 1)). La B pierde los exponentes al sacar logaritmo. La D suma el término del denominador.

### P78 · dificultad 3 · kc: derivacion-logaritmica · borrador · origen: ia (sonnet-5.5)
Sea $y = \frac{x^2\sqrt{x + 3}}{(x + 1)^3}$. ¿Cuánto vale y'(1)?

- A) 5/32 · CORRECTA
- B) 29/32 · [cociente-log-como-suma] sumas el término del denominador en vez de restarlo
- C) 3/16 · [exponente-no-baja-del-log] no bajas los exponentes 2, 1/2 y 3 al tomar logaritmo
- D) 5/8 · [omite-multiplicar-por-y] calculas y'/y en x = 1 y no lo multiplicas por y(1) = 1/4

solución: ln y = 2 ln x + ½ ln(x + 3) − 3 ln(x + 1). Entonces y'/y = 2/x + 1/(2(x + 3)) − 3/(x + 1). En x = 1: 2 + 1/8 − 3/2 = 5/8. Como y(1) = 1·2/8 = 1/4, y'(1) = (5/8)(1/4) = 5/32. La B suma 3/2 y da (29/8)(1/4) = 29/32. La C sin exponentes da (1 + 1/4 − 1/2)(1/4) = 3/16. La D deja 5/8, que es y'/y.
