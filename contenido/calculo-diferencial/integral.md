# Antiderivadas e integral definida

Antiderivadas, integral definida como área neta y como límite de sumas de Riemann, y teorema fundamental del cálculo. Es del Parcial 3 (semanas 12 y 13 del programa). De Precálculo hacen falta la notación de sumatoria y las áreas geométricas. Los errores que faltaban y las preguntas nuevas son borradores de IA (HU-101), escritos con el criterio del modelo y apuntes libres, y esperan la revisión de un desarrollador.

## Habilidades
kc: antiderivadas · Hallar la antiderivada general de potencias, funciones trigonométricas y exponenciales · prerrequisitos: reglas-derivacion, derivadas-trascendentes
kc: integral-definida · Interpretar la integral definida como área neta y límite de sumas de Riemann, y usar sus propiedades · prerrequisitos: limites-infinito-asintotas
kc: teorema-fundamental · Evaluar una integral definida con una antiderivada y derivar una función definida por una integral · prerrequisitos: antiderivadas, integral-definida, regla-cadena

## Errores
mc: omite-constante-integracion · antiderivadas · escribes una sola antiderivada sin la constante + C, como si la antiderivada fuera única
mc: exponente-sin-dividir · antiderivadas · al integrar xⁿ subes el exponente a n + 1 pero no divides entre n + 1
mc: deriva-en-vez-de-integrar · antiderivadas · derivas la función en lugar de buscar su antiderivada
mc: uno-sobre-x-sin-antiderivada · antiderivadas · aplicas la regla de la potencia a 1/x, te sale dividir entre 0 y concluyes que no tiene antiderivada en vez de usar ln x
mc: signo-seno-al-integrar · antiderivadas · escribes que la antiderivada de sen x es cos x, sin el signo menos, por confundirla con la derivada de cos x
mc: constante-igual-al-valor · antiderivadas · con la condición F(a) = b igualas la constante C a b, en vez de evaluar F(a) y despejar C
mc: extremo-izquierdo-por-derecho · integral-definida · usas los extremos izquierdos de los subintervalos cuando el enunciado pide los derechos
mc: ancho-sin-dividir-por-n · integral-definida · tomas como ancho de cada rectángulo todo el largo del intervalo, b − a, sin dividirlo entre n
mc: omite-ancho-del-rectangulo · integral-definida · sumas las alturas de los rectángulos y no las multiplicas por el ancho
mc: area-neta-como-total · integral-definida · cuentas como positivas también las partes que quedan bajo el eje x y das el área total en vez del área neta
mc: invertir-limites-sin-signo · integral-definida · al intercambiar los límites de integración dejas el valor igual, sin cambiarle el signo
mc: suma-de-tramos-mal · integral-definida · para hallar un tramo de la integral sumas las dos integrales que te dan, en vez de restar la del tramo conocido
mc: coeficiente-ignorado-en-linealidad · integral-definida · al separar la integral de una combinación de funciones no multiplicas por el coeficiente que acompaña a f
mc: omite-region-bajo-el-eje · integral-definida · calculas solo el área de la región que queda sobre el eje x y descartas la que queda bajo él
mc: resta-limites-invertida · teorema-fundamental · restas F(a) − F(b) en lugar de F(b) − F(a) y el resultado te sale con el signo cambiado
mc: solo-limite-superior · teorema-fundamental · sustituyes solo el límite superior en la antiderivada y no restas el valor en el límite inferior
mc: evalua-el-integrando-en-los-limites · teorema-fundamental · calculas f(b) − f(a) con el integrando mismo en vez de usar su antiderivada
mc: omite-derivada-del-limite · teorema-fundamental · al derivar una integral con límite g(x) evalúas el integrando en g(x) pero no multiplicas por g'(x)
mc: variable-de-integracion-en-respuesta · teorema-fundamental · al derivar la integral dejas la variable t del integrando en el resultado, en vez de sustituirla por el límite
mc: deriva-el-integrando · teorema-fundamental · derivas el integrando en lugar de evaluarlo en el límite, como si el teorema pidiera f'
mc: signo-limite-inferior-omitido · teorema-fundamental · al derivar una integral cuyo límite inferior es variable sumas ese término en vez de restarlo

## Preguntas

### P111 · dificultad 1 · kc: antiderivadas · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04
La antiderivada general de f(x) = 15x⁴ − 8x³ es:

- A) 3x⁵ − 2x⁴ · [omite-constante-integracion] das una antiderivada sin la constante + C
- B) 3x⁵ − 2x⁴ + C · CORRECTA
- C) 15x⁵ − 8x⁴ + C · [exponente-sin-dividir] subes cada exponente en 1 pero dejas los coeficientes 15 y −8 sin dividir entre 5 y entre 4
- D) 60x³ − 24x² + C · [deriva-en-vez-de-integrar] derivas f(x) en lugar de integrarla

solución: se integra término a término con la regla de la potencia, ∫xⁿ dx = xⁿ⁺¹/(n + 1) + C. Para 15x⁴: 15x⁵/5 = 3x⁵. Para −8x³: −8x⁴/4 = −2x⁴. La antiderivada general es 3x⁵ − 2x⁴ + C. La opción A olvida la constante, que hace que sea la antiderivada general. La opción C sube el exponente pero no divide entre n + 1 (deja 15x⁵ y −8x⁴). La opción D es f'(x) = 60x³ − 24x², es decir, se derivó en vez de integrar.

### P112 · dificultad 2 · kc: antiderivadas · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04
Para x > 0, la antiderivada general de f(x) = $\sqrt{x} + \frac{5}{x}$ es:

- A) $\frac{2}{3}x^{3/2} + 5\ln x$ · [omite-constante-integracion] escribes la antiderivada sin la constante + C
- B) $x^{3/2} + 5\ln x + C$ · [exponente-sin-dividir] subes el exponente de √x de 1/2 a 3/2 pero no divides entre 3/2
- C) No tiene antiderivada, porque la regla de la potencia divide entre 0 en el término 5/x · [uno-sobre-x-sin-antiderivada]
- D) $\frac{2}{3}x^{3/2} + 5\ln x + C$ · CORRECTA

solución: √x = x^{1/2}, así que ∫x^{1/2} dx = x^{3/2}/(3/2) = (2/3)x^{3/2}. El término 5/x es 5·x⁻¹: aquí la regla de la potencia no sirve (exigiría dividir entre −1 + 1 = 0), pero se sabe que la derivada de ln x es 1/x, así que ∫5/x dx = 5 ln x. Con la constante queda (2/3)x^{3/2} + 5 ln x + C. La opción A omite + C. La opción B no divide entre el nuevo exponente 3/2. La opción C concluye que 5/x no se puede integrar solo porque la regla de la potencia falla; sí tiene antiderivada, que es 5 ln x.

### P113 · dificultad 2 · kc: antiderivadas · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04
Para x > 0, la antiderivada general de f(x) = $\frac{6}{x}$ + 4 sen x − eˣ es:

- A) $6\ln x - 4\cos x - e^x + C$ · CORRECTA
- B) $6\ln x + 4\cos x - e^x + C$ · [signo-seno-al-integrar] tomas cos x como la antiderivada de sen x, sin el signo menos
- C) $-\frac{6}{x^2} + 4\cos x - e^x + C$ · [deriva-en-vez-de-integrar] derivas f(x) término a término en lugar de integrarla
- D) $-4\cos x - e^x + C$ · [uno-sobre-x-sin-antiderivada] descartas el término 6/x porque crees que no tiene antiderivada

solución: ∫6/x dx = 6 ln x (porque la derivada de ln x es 1/x). ∫4 sen x dx = −4 cos x, ya que la derivada de cos x es −sen x. ∫−eˣ dx = −eˣ. Se suma la constante: 6 ln x − 4 cos x − eˣ + C. La opción B pierde el signo menos de la antiderivada del seno. La opción C es f'(x) = −6/x² + 4 cos x − eˣ, o sea que se derivó. La opción D elimina 6/x creyendo que no se puede integrar, cuando su antiderivada es 6 ln x.

### P114 · dificultad 3 · kc: antiderivadas · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04
La función F cumple F'(x) = 6x² − 4 sen x y F(0) = 7. Entonces F(x) es:

- A) 2x³ + 4 cos x + 7 · [constante-igual-al-valor] pones C = 7 sin evaluar F(0)
- B) 2x³ − 4 cos x + 11 · [signo-seno-al-integrar] tomas −4 cos x como antiderivada de −4 sen x, y con esa expresión F(0) = 7 te da C = 11
- C) 2x³ + 4 cos x + 3 · CORRECTA
- D) 6x³ + 4 cos x + 3 · [exponente-sin-dividir] subes el exponente de 6x² a 3 pero no divides entre 3

solución: ∫6x² dx = 2x³ y ∫−4 sen x dx = 4 cos x (porque la derivada de cos x es −sen x). Así F(x) = 2x³ + 4 cos x + C. La condición da F(0) = 0 + 4·cos 0 + C = 4 + C = 7, de donde C = 3 y F(x) = 2x³ + 4 cos x + 3. La opción A iguala la constante al valor 7 en lugar de despejarla (con eso F(0) sería 11). La opción B integra mal el seno: con −4 cos x queda F(0) = −4 + C = 7, de donde C = 11. La opción D no divide entre 3: con 6x³ + 4 cos x + C, F(0) = 4 + C = 7 y C = 3, igual que en la correcta, pero la parte polinómica está mal.

### P115 · dificultad 1 · kc: integral-definida · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04
La suma de Riemann de f(x) = 2x + 3 en [1, 7], con n = 3 rectángulos del mismo ancho y extremos derechos de cada subintervalo, vale:

- A) 54 · [extremo-izquierdo-por-derecho] tomas los extremos izquierdos 1, 3 y 5 en lugar de los derechos
- B) 39 · [omite-ancho-del-rectangulo] sumas las tres alturas 9, 13 y 17 pero no las multiplicas por el ancho
- C) 78 · CORRECTA
- D) 234 · [ancho-sin-dividir-por-n] usas como ancho todo el largo del intervalo, 7 − 1 = 6, en vez de (7 − 1)/3 = 2

solución: el ancho es Δx = (7 − 1)/3 = 2 y los subintervalos son [1, 3], [3, 5] y [5, 7]. Los extremos derechos son 3, 5 y 7, con alturas f(3) = 9, f(5) = 13 y f(7) = 17. La suma es (9 + 13 + 17)·2 = 39·2 = 78. Con extremos izquierdos (1, 3, 5) las alturas son 5, 9 y 13 y la suma da 27·2 = 54 (opción A). La opción B se queda en 9 + 13 + 17 = 39, sin multiplicar por el ancho. La opción D multiplica 39 por 6 y obtiene 234.

### P116 · dificultad 2 · kc: integral-definida · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04
Sea f continua con $\int_2^7 f(x)\,dx = 9$ y $\int_2^4 f(x)\,dx = 5$. El valor de $\int_7^4 (2f(x) - 1)\,dx$ es:

- A) −5 · CORRECTA
- B) 5 · [invertir-limites-sin-signo] tratas ∫ de 7 a 4 como ∫ de 4 a 7, sin cambiar el signo
- C) −1 · [coeficiente-ignorado-en-linealidad] separas la integral pero no multiplicas por 2 la integral de f
- D) −25 · [suma-de-tramos-mal] hallas ∫ de 4 a 7 de f como 9 + 5 = 14 en lugar de 9 − 5 = 4

solución: por la propiedad de los tramos, ∫₂⁷ f = ∫₂⁴ f + ∫₄⁷ f, así que ∫₄⁷ f = 9 − 5 = 4. Por linealidad, ∫₄⁷ (2f − 1) dx = 2·4 − (7 − 4) = 8 − 3 = 5. Al invertir los límites cambia el signo: ∫₇⁴ (2f − 1) dx = −5. La opción B deja el 5 sin cambiar el signo. La opción C usa ∫₄⁷ f − 3 = 1 y da −1, olvidando el factor 2. La opción D calcula ∫₄⁷ f = 14, con lo que ∫₄⁷ (2f − 1) = 25 y, al invertir, −25.

### P117 · dificultad 2 · kc: integral-definida · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04
Se calcula la suma de Riemann de f(x) = x² − 10 en [0, 8] con n = 4 rectángulos del mismo ancho y extremos derechos. El resultado es:

- A) 32 · [extremo-izquierdo-por-derecho] usas los extremos izquierdos 0, 2, 4 y 6
- B) 640 · [ancho-sin-dividir-por-n] usas como ancho 8 − 0 = 8 en lugar de 8/4 = 2
- C) 184 · [area-neta-como-total] tomas el valor absoluto de las alturas, aunque f es negativa en los dos primeros extremos derechos, y sumas áreas totales
- D) 160 · CORRECTA

solución: Δx = (8 − 0)/4 = 2 y los extremos derechos son 2, 4, 6 y 8. Las alturas son f(2) = −6, f(4) = 6, f(6) = 26 y f(8) = 54. La suma de alturas es −6 + 6 + 26 + 54 = 80 y multiplicada por Δx = 2 da 160. La opción A usa las alturas −10, −6, 6 y 26, que suman 16, y da 32. La opción B multiplica 80 por 8 y da 640. La opción C suma |−6| + 6 + 26 + 54 = 92 y multiplica por 2: 184. Una suma de Riemann cuenta con signo las alturas negativas (representan área neta), así que no se usan valores absolutos.

### P118 · dificultad 3 · kc: integral-definida · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04
La gráfica de f(x) = 3 − |x| tiene su vértice en (0, 3), corta el eje x en −3 y en 3, queda sobre el eje entre esos dos cortes y bajo el eje fuera de ellos. Usando áreas geométricas, el valor de $\int_5^{-2} (3 - |x|)\,dx$ es:

- A) $\frac{13}{2}$ · [invertir-limites-sin-signo] calculas el área neta entre −2 y 5 pero no cambias el signo al estar los límites invertidos
- B) $-\frac{13}{2}$ · CORRECTA
- C) $\frac{21}{2}$ · [area-neta-como-total] sumas todas las áreas como positivas, incluida la de la región bajo el eje, y das el área total
- D) $-\frac{17}{2}$ · [omite-region-bajo-el-eje] solo cuentas las regiones sobre el eje e inviertes el signo, sin restar la región bajo el eje

solución: se calcula primero ∫₋₂⁵ (3 − |x|) dx por regiones. De −2 a 0 la altura va de 1 a 3: trapecio de área (1 + 3)/2·2 = 4. De 0 a 3: triángulo de base 3 y altura 3, área 9/2. De 3 a 5: triángulo bajo el eje con base 2 y altura 2 (f(5) = −2), área 2, que cuenta como −2. El área neta es 4 + 9/2 − 2 = 13/2. Como los límites están invertidos (de 5 a −2), se cambia el signo: −13/2. La opción A deja 13/2. La opción C es el área total 4 + 9/2 + 2 = 21/2. La opción D usa solo las regiones sobre el eje, 4 + 9/2 = 17/2, y le cambia el signo.

### P119 · dificultad 1 · kc: teorema-fundamental · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04
El valor de $\int_1^3 (6x^2 - 4)\,dx$ es:

- A) −44 · [resta-limites-invertida] restas F(1) − F(3) en lugar de F(3) − F(1)
- B) 44 · CORRECTA
- C) 42 · [solo-limite-superior] sustituyes solo el límite 3 en la antiderivada y no restas F(1)
- D) 48 · [evalua-el-integrando-en-los-limites] calculas f(3) − f(1) con el integrando 6x² − 4, en vez de usar su antiderivada

solución: una antiderivada de f(x) = 6x² − 4 es F(x) = 2x³ − 4x. Por el teorema fundamental, la integral es F(3) − F(1). F(3) = 54 − 12 = 42 y F(1) = 2 − 4 = −2, así que el valor es 42 − (−2) = 44. La opción A da −44 al restar en el orden contrario. La opción C se queda en F(3) = 42. La opción D evalúa el integrando: f(3) = 50 y f(1) = 2, y 50 − 2 = 48.

### P120 · dificultad 2 · kc: teorema-fundamental · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04
El valor de $\int_0^{\pi/2} (2\cos x + \sen x)\,dx$ es:

- A) −3 · [resta-limites-invertida] restas F(0) − F(π/2) en lugar de F(π/2) − F(0)
- B) 2 · [solo-limite-superior] sustituyes solo π/2 en la antiderivada y no restas F(0) = −1
- C) 3 · CORRECTA
- D) −1 · [evalua-el-integrando-en-los-limites] calculas f(π/2) − f(0) con el integrando 2 cos x + sen x

solución: una antiderivada de f(x) = 2 cos x + sen x es F(x) = 2 sen x − cos x. Entonces F(π/2) = 2·1 − 0 = 2 y F(0) = 0 − 1 = −1. La integral vale F(π/2) − F(0) = 2 − (−1) = 3. La opción A es −3 por restar al revés. La opción B es F(π/2) = 2, sin restar F(0). La opción D evalúa el integrando: f(π/2) = 1 y f(0) = 2, y 1 − 2 = −1.

### P121 · dificultad 2 · kc: teorema-fundamental · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04
La derivada de $G(x) = \int_0^{x^3} \sqrt{t^2 + 5}\,dt$ es:

- A) $3x^2\sqrt{x^6 + 5}$ · CORRECTA
- B) $\sqrt{x^6 + 5}$ · [omite-derivada-del-limite] evalúas el integrando en x³ pero no multiplicas por la derivada del límite, 3x²
- C) $3x^2\sqrt{t^2 + 5}$ · [variable-de-integracion-en-respuesta] multiplicas por 3x² pero dejas la variable t en el integrando en lugar de reemplazarla por x³
- D) $\frac{3x^5}{\sqrt{x^6 + 5}}$ · [deriva-el-integrando] derivas el integrando √(t² + 5) y lo evalúas en x³, en vez de solo evaluarlo

solución: por el teorema fundamental con la regla de la cadena, si G(x) = ∫₀^g(x) f(t) dt, entonces G'(x) = f(g(x))·g'(x). Aquí f(t) = √(t² + 5) y g(x) = x³, con g'(x) = 3x². Resulta G'(x) = √((x³)² + 5)·3x² = 3x²√(x⁶ + 5). La opción B olvida el factor 3x². La opción C deja una t que ya no existe después de integrar. La opción D usa f'(t) = t/√(t² + 5), evaluada en x³ y multiplicada por 3x², lo que da 3x⁵/√(x⁶ + 5); el teorema pide f, no f'.

### P122 · dificultad 3 · kc: teorema-fundamental · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04
La derivada de $H(x) = \int_x^{x^2} (t^2 + 1)\,dt$ es:

- A) x⁴ − x² · [omite-derivada-del-limite] evalúas el integrando en cada límite, pero no multiplicas por la derivada de x² (que es 2x)
- B) 2x⁵ + x² + 2x + 1 · [signo-limite-inferior-omitido] sumas el término del límite inferior x en vez de restarlo
- C) 4x³ − 2x · [deriva-el-integrando] derivas el integrando t² + 1 y lo evalúas en los dos límites, en vez de evaluar el integrando
- D) 2x⁵ − x² + 2x − 1 · CORRECTA

solución: con límites variables, H'(x) = f(g₂(x))·g₂'(x) − f(g₁(x))·g₁'(x), donde f(t) = t² + 1, g₂(x) = x² y g₁(x) = x. Entonces H'(x) = (x⁴ + 1)·2x − (x² + 1)·1 = 2x⁵ + 2x − x² − 1. La opción A es (x⁴ + 1) − (x² + 1) = x⁴ − x², sin el factor 2x. La opción B suma el término inferior en lugar de restarlo (el límite inferior aporta un signo menos). La opción C usa f'(t) = 2t: 2x²·2x − 2x = 4x³ − 2x, que confunde el integrando con su derivada.
