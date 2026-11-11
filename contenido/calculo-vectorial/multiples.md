# Integrales dobles y triples

Integrales dobles sobre rectángulos y regiones generales, cambio de orden, coordenadas polares y cambio de variables, integrales triples y sus aplicaciones (secciones 5.1 a 6.3 del libro guía). Es del Parcial 2, semana 13. Errores a cazar: invertir mal el orden de integración, no cambiar los límites al cambiar de variable y olvidar el jacobiano.

## Habilidades
kc: doble-iterada · Calcular integrales dobles iteradas sobre rectángulos y regiones generales, y cambiar el orden de integración · prerrequisitos: calculo-diferencial/teorema-fundamental
kc: polares-cambio · Pasar una integral doble a coordenadas polares o a otras variables con el jacobiano y ajustar los límites · prerrequisitos: doble-iterada, coordenadas
kc: triples · Plantear y calcular integrales triples en coordenadas cartesianas, cilíndricas y esféricas con sus límites y su jacobiano · prerrequisitos: doble-iterada, coordenadas
kc: aplicaciones-multiples · Calcular con integrales dobles y triples áreas, volúmenes, masas y centros de masa · prerrequisitos: triples, polares-cambio

## Errores
mc: multiples-e1 · doble-iterada · inviertes mal el orden y no ajustas los límites correctamente
mc: multiples-e2 · doble-iterada · integras primero respecto a y pero usas los límites como si fuera respecto a x
mc: multiples-e3 · doble-iterada · olvidas dividir por los exponentes al integrar
mc: multiples-e4 · polares-cambio · no cambias correctamente el límite de r al cambiar de variable
mc: multiples-e5 · polares-cambio · usas solo la mitad del círculo
mc: multiples-e6 · polares-cambio · mantienes los límites rectangulares en lugar de adaptarlos a polares
mc: multiples-e7 · polares-cambio · olvidas el jacobiano de la transformación
mc: multiples-e8 · polares-cambio · confundes el jacobiano con el argumento de la función
mc: multiples-e9 · polares-cambio · inviertes el orden sin el jacobiano
mc: region-como-rectangulo-envolvente · doble-iterada · tomas la región como el rectángulo que la contiene y usas los valores extremos de x y de y como límites
mc: evalua-solo-limite-superior · doble-iterada · al evaluar la antiderivada en los límites usas solo el superior y olvidas restar el valor en el inferior
mc: producto-de-integrales-sin-ser-producto · doble-iterada · separas la integral de una suma como el producto de dos integrales simples
mc: curvas-superior-e-inferior-invertidas · doble-iterada · intercambias cuál curva es el límite superior y cuál el inferior
mc: angulo-completo-en-region-parcial · polares-cambio · recorres θ de 0 a 2π aunque la región es solo una parte del círculo, como un semicírculo o un sector
mc: jacobiano-omitido-en-triples · triples · pasas a cilíndricas o esféricas y no multiplicas por el jacobiano (r en cilíndricas, ρ² sen φ en esféricas)
mc: esfericas-sin-sen-phi · triples · en esféricas usas el jacobiano ρ² pero olvidas el factor sen φ
mc: radio-igual-al-lado-derecho · triples · de una ecuación como x² + y² = 9 o x² + y² + z² = 4 tomas el número del lado derecho como radio, sin sacar la raíz
mc: solido-como-caja-envolvente · triples · tomas el sólido como la caja o el cilindro que lo contiene y usas los extremos de cada variable como límites constantes
mc: cono-con-phi-recto · triples · para un sólido que está sobre un cono z = √(x² + y²) dejas φ llegar hasta π/2, sin ver que el cono corta en φ = π/4
mc: una-sola-frontera-sin-restar · aplicaciones-multiples · en una región o un sólido entre dos curvas o superficies integras solo la de arriba y no restas la de abajo
mc: suma-en-lugar-de-resta · aplicaciones-multiples · sumas los valores de las dos curvas o superficies que acotan la región en vez de restarlos
mc: limites-de-interseccion-mal-resueltos · aplicaciones-multiples · al hallar dónde se cortan las curvas resuelves o factorizas mal la ecuación y tomas límites de integración equivocados
mc: simetria-sin-duplicar · aplicaciones-multiples · aprovechas la simetría para integrar solo una parte de la región y no multiplicas por el factor que la compensa
mc: masa-sin-densidad · aplicaciones-multiples · ignoras la función de densidad y trabajas con el área, por ejemplo al dividir entre el área en vez de entre la masa
mc: centro-de-masa-sin-dividir-entre-masa · aplicaciones-multiples · das el momento como coordenada del centro de masa, sin dividirlo entre la masa
mc: momentos-intercambiados · aplicaciones-multiples · usas en el numerador el momento de la otra coordenada y obtienes ȳ cuando pedían x̄, o al revés

## Preguntas

### P4 · dificultad 2 · kc: doble-iterada · revisada · origen: humano · revisó: prototipo · ⚠ revisar
Calcula $\iint_R xy\,dA$ donde R es el rectángulo [0,2] × [0,1]. Al integrar primero respecto a x:

- A) 1 · CORRECTA
- B) 2 · [multiples-e1]
- C) 1/2 · [multiples-e2]
- D) 4 · [multiples-e3]

### P5 · dificultad 2 · kc: polares-cambio · revisada · origen: humano · revisó: prototipo · ⚠ revisar
Al convertir $\iint_R f(x,y)\,dA$ a coordenadas polares donde R es el círculo x² + y² ≤ 4, los límites correctos son:

- A) 0 ≤ r ≤ 2, 0 ≤ θ ≤ 2π · CORRECTA
- B) 0 ≤ r ≤ 4, 0 ≤ θ ≤ 2π · [multiples-e4]
- C) 0 ≤ r ≤ 2, 0 ≤ θ ≤ π · [multiples-e5]
- D) -2 ≤ r ≤ 2, 0 ≤ θ ≤ 2π · [multiples-e6]

### P6 · dificultad 2 · kc: polares-cambio · revisada · origen: humano · revisó: prototipo · ⚠ revisar
Al calcular $\iint_R e^{x^2+y^2}\,dA$ sobre el círculo unitario usando coordenadas polares, el elemento de área correcto es:

- A) r dr dθ · CORRECTA
- B) dr dθ · [multiples-e7]
- C) r² dr dθ · [multiples-e8]
- D) dθ dr · [multiples-e9]

### P14 · dificultad 3 · kc: polares-cambio · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04 · ⚠ revisar
Calcula $\iint_D \sqrt{x^2+y^2}\,dA$, donde D es la región del plano que cumple 1 ≤ x² + y² ≤ 4:

- A) 7π/3 · [multiples-e5] recorres θ solo de 0 a π, así que integras sobre la mitad de la región
- B) 3π · [multiples-e7] olvidas el factor r del elemento de área y dejas como integrando solo r
- C) 14π/3 · CORRECTA
- D) 42π · [multiples-e4] tomas r entre 1 y 4, usando el 4 de x² + y² ≤ 4 como si fuera el radio exterior

solución: en coordenadas polares x = r cos θ, y = r sen θ, se tiene √(x² + y²) = r y dA = r dr dθ. La condición 1 ≤ x² + y² ≤ 4 pide 1 ≤ r ≤ 2, y como la región es un anillo completo, 0 ≤ θ ≤ 2π.
Entonces $\iint_D \sqrt{x^2+y^2}\,dA = \int_0^{2\pi}\int_1^2 r\cdot r\,dr\,d\theta$. La integral en r vale $\left[\frac{r^3}{3}\right]_1^2 = \frac{7}{3}$, y la de θ multiplica por $2\pi$: el resultado es $\frac{14\pi}{3}$.
Las otras opciones salen de errores concretos: sin el factor r del jacobiano, $2\pi\int_1^2 r\,dr = 3\pi$; con r entre 1 y 4, $2\pi\int_1^4 r^2\,dr = 42\pi$; con θ entre 0 y π, $\pi\int_1^2 r^2\,dr = \frac{7\pi}{3}$.

### P63 · dificultad 1 · kc: doble-iterada · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Calcula $\iint_R (x + y^2)\,dA$, donde R es el rectángulo [1,3] × [0,3]:

- A) 81/2 · [evalua-solo-limite-superior] evalúas la antiderivada de la integral externa solo en x = 3 y no restas su valor en x = 1
- B) 30 · CORRECTA
- C) 36 · [producto-de-integrales-sin-ser-producto] separas la integral de la suma como el producto ∫x dx·∫y² dy
- D) 78 · [multiples-e3] integras sin dividir entre el exponente nuevo, como si ∫y² dy = y³ y ∫3x dx = 3x²

solución: la integral interna en y vale ∫₀³ (x + y²) dy = 3x + 9. Entonces $\int_1^3 (3x+9)\,dx$ = $\left[\frac{3x^2}{2} + 9x\right]_1^3$ = $\left(\frac{27}{2} + 27\right) - \left(\frac{3}{2} + 9\right)$ = $30$.
Las otras salen de errores concretos: solo con el valor en x = 3 da 81/2; el producto (∫₁³ x dx)(∫₀³ y² dy) = 4 · 9 = 36 no es la integral de la suma; sin dividir entre el exponente queda [3x² + 27x] entre 1 y 3, que da 78.

### P64 · dificultad 2 · kc: doble-iterada · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Al cambiar el orden de integración de $\int_0^1\int_x^{\sqrt{x}} f(x,y)\,dy\,dx$ se obtiene:

- A) $\int_0^1\int_{y}^{y^2} f(x,y)\,dx\,dy$ · [curvas-superior-e-inferior-invertidas] intercambias los límites de x y pones y² como límite superior y y como inferior
- B) $\int_0^1\int_0^1 f(x,y)\,dx\,dy$ · [region-como-rectangulo-envolvente] tomas la región como el cuadrado [0,1] × [0,1] que la contiene
- C) $\int_0^1\int_{y^2}^{y} f(x,y)\,dx\,dy$ · CORRECTA
- D) $\int_0^1\int_{y}^{\sqrt{y}} f(x,y)\,dx\,dy$ · [multiples-e1] al invertir el orden despejas mal la curva y escribes x = √y en lugar de x = y²

solución: la región es 0 ≤ x ≤ 1 con x ≤ y ≤ √x, es decir, entre la recta y = x y la curva y = √x (que equivale a x = y²). Para y entre 0 y 1, x va desde la curva x = y² (a la izquierda) hasta la recta x = y (a la derecha), porque y² ≤ y en [0,1]. La integral queda $\int_0^1\int_{y^2}^{y} f\,dx\,dy$.
Las otras describen otra región: con y y y² intercambiados el límite inferior queda por encima del superior; con el cuadrado se agrega todo lo que está fuera de la región; con x = √y se usa la rama equivocada de la curva.

### P65 · dificultad 2 · kc: doble-iterada · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Calcula $\iint_D (x+y)\,dA$, donde D es el triángulo de vértices (0,0), (2,0) y (2,4):

- A) 32/3 · CORRECTA
- B) 24 · [region-como-rectangulo-envolvente] integras sobre el rectángulo [0,2] × [0,4] que contiene al triángulo
- C) 16 · [producto-de-integrales-sin-ser-producto] calculas (∫₀² x dx)(∫₀⁴ y dy) = 2·8, como si la integral de la suma fuera un producto
- D) −32/3 · [curvas-superior-e-inferior-invertidas] pones y = 2x como límite superior y y = 0 como inferior, así que el resultado cambia de signo

solución: el lado que une (0,0) con (2,4) está en la recta y = 2x, así que D es 0 ≤ x ≤ 2 con 0 ≤ y ≤ 2x. La integral interna es $\int_0^{2x} (x+y)\,dy = x\cdot 2x + \frac{(2x)^2}{2} = 4x^2$. Entonces $\int_0^2 4x^2\,dx = \frac{32}{3}$.
El rectángulo da ∫₀²(4x + 8) dx = 24, el producto de integrales da 16, y con los límites invertidos el resultado es −32/3.

### P66 · dificultad 3 · kc: doble-iterada · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Calcula $\int_0^1\int_{\sqrt{y}}^{1} e^{x^3}\,dx\,dy$ (conviene cambiar el orden de integración):

- A) e/3 · [evalua-solo-limite-superior] al integrar x²·e^{x³} en x usas solo el valor de la antiderivada en x = 1 y no restas el de x = 0
- B) −(e − 1)/3 · [curvas-superior-e-inferior-invertidas] al cambiar el orden pones y de x² a 0, con el límite superior y el inferior intercambiados
- C) e − 1 · [multiples-e3] integras x²·e^{x³} sin dividir entre el 3 que aparece al derivar el exponente
- D) (e − 1)/3 · CORRECTA

solución: e^{x³} no tiene antiderivada elemental en x, así que se invierte el orden. La región es 0 ≤ y ≤ 1 con √y ≤ x ≤ 1, o sea 0 ≤ x ≤ 1 con 0 ≤ y ≤ x². Entonces la integral es $\int_0^1\int_0^{x^2} e^{x^3}\,dy\,dx$ = $\int_0^1 x^2 e^{x^3}\,dx$ = $\left[\frac{e^{x^3}}{3}\right]_0^1$ = $\frac{e-1}{3}$.

### P67 · dificultad 1 · kc: polares-cambio · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Calcula $\iint_D (x^2+y^2)^2\,dA$, donde D es el semicírculo x² + y² ≤ 4 con y ≥ 0:

- A) 64π/3 · [angulo-completo-en-region-parcial] recorres θ de 0 a 2π aunque D es solo el semicírculo superior
- B) 32π/3 · CORRECTA
- C) 32π/5 · [multiples-e7] olvidas el factor r del elemento de área e integras r⁴ dr dθ
- D) 512π/9 · [multiples-e8] usas el integrando r⁴ también como elemento de área, en lugar de r

solución: en polares (x² + y²)² = r⁴ y dA = r dr dθ. El semicírculo superior es 0 ≤ r ≤ 2, 0 ≤ θ ≤ π. Entonces $\int_0^\pi\int_0^2 r^5\,dr\,d\theta$ = $\pi\cdot\frac{32}{3}$ = $\frac{32\pi}{3}$.
Con θ hasta 2π sale el doble; sin el factor r queda π · 32/5; con r⁴ como elemento de área queda π · 512/9.

### P68 · dificultad 2 · kc: polares-cambio · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Evalúa $\iint_D \frac{2}{\sqrt{x^2+y^2}}\,dA$ sobre la mitad inferior (y ≤ 0) del anillo 4 ≤ x² + y² ≤ 25, llamada D:

- A) 2π ln(5/2) · [multiples-e7] olvidas el factor r de dA y integras solo 2/r
- B) 12π · [angulo-completo-en-region-parcial] recorres θ de 0 a 2π aunque D es solo la mitad inferior del anillo
- C) 6π · CORRECTA
- D) 42π · [multiples-e4] tomas r entre 4 y 25, usando el 25 de x² + y² ≤ 25 como radio exterior

solución: en polares la función vale 2/r y dA = r dr dθ. De 4 ≤ x² + y² ≤ 25 sale 2 ≤ r ≤ 5, y y ≤ 0 da π ≤ θ ≤ 2π. Entonces $\int_\pi^{2\pi}\int_2^5 \frac{2}{r}\,r\,dr\,d\theta$ = $\pi\cdot 2\int_2^5 dr$ = $6\pi$.
Sin el factor r queda 2π ln(5/2); con θ hasta 2π queda 12π; con r entre 4 y 25 queda π · 2 · 21 = 42π.

### P69 · dificultad 1 · kc: triples · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Calcula $∭_E z\,dV$, donde E es el cilindro sólido x² + y² ≤ 9, 0 ≤ z ≤ 5:

- A) 225π/2 · CORRECTA
- B) 75π · [jacobiano-omitido-en-triples] en cilíndricas usas dV = dr dθ dz y olvidas el factor r
- C) 2025π/2 · [radio-igual-al-lado-derecho] de x² + y² ≤ 9 tomas r hasta 9 en lugar de hasta 3
- D) 450 · [solido-como-caja-envolvente] integras sobre la caja −3 ≤ x ≤ 3, −3 ≤ y ≤ 3, 0 ≤ z ≤ 5 que contiene al cilindro

solución: en cilíndricas dV = r dr dθ dz, con 0 ≤ r ≤ 3, 0 ≤ θ ≤ 2π y 0 ≤ z ≤ 5. Entonces $\int_0^{2\pi}\int_0^3\int_0^5 z\,r\,dz\,dr\,d\theta$ = $2\pi\cdot\frac{9}{2}\cdot\frac{25}{2}$ = $\frac{225\pi}{2}$.
Sin el factor r queda 2π · 3 · 25/2 = 75π; con r hasta 9 queda 2π · 81/2 · 25/2 = 2025π/2; con la caja queda 6 · 6 · 25/2 = 450.

### P70 · dificultad 2 · kc: triples · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Calcula $∭_B (x^2+y^2+z^2)\,dV$, donde B es la bola x² + y² + z² ≤ 4:

- A) 32π/3 · [jacobiano-omitido-en-triples] pasas el integrando a ρ² pero no multiplicas por el jacobiano ρ² sen φ
- B) 64π²/5 · [esfericas-sin-sen-phi] usas ρ² dρ dφ dθ como elemento de volumen y olvidas el factor sen φ
- C) 4096π/5 · [radio-igual-al-lado-derecho] de x² + y² + z² ≤ 4 tomas ρ hasta 4 en lugar de hasta 2
- D) 128π/5 · CORRECTA

solución: en esféricas x² + y² + z² = ρ² y dV = ρ² sen φ dρ dφ dθ, con 0 ≤ ρ ≤ 2, 0 ≤ φ ≤ π y 0 ≤ θ ≤ 2π. Entonces $\int_0^{2\pi}\int_0^\pi\int_0^2 \rho^4 \sen\varphi\,d\rho\,d\varphi\,d\theta$ = $2\pi\cdot 2\cdot\frac{32}{5}$ = $\frac{128\pi}{5}$.
Sin el jacobiano queda 2π · 2 · 8/3 = 32π/3; sin sen φ queda 2π · π · 32/5 = 64π²/5; con ρ hasta 4 queda 2π · 2 · 1024/5 = 4096π/5.

### P71 · dificultad 2 · kc: triples · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Calcula $∭_E z\,dV$, donde E es el sólido entre el plano xy y el paraboloide z = 4 − x² − y²:

- A) 256π/15 · [jacobiano-omitido-en-triples] en cilíndricas dejas dV = dz dr dθ y olvidas el factor r
- B) 32π/3 · CORRECTA
- C) 896π/3 · [radio-igual-al-lado-derecho] de 0 = 4 − r² y del 4 de la ecuación tomas r hasta 4 en lugar de hasta 2
- D) 32π · [solido-como-caja-envolvente] tomas z entre 0 y 4 para todo r entre 0 y 2, como si E fuera el cilindro que lo contiene

solución: el paraboloide corta al plano z = 0 en r = 2. En cilíndricas, 0 ≤ θ ≤ 2π, 0 ≤ r ≤ 2 y 0 ≤ z ≤ 4 − r². Entonces $\int_0^{2\pi}\int_0^2\int_0^{4-r^2} z\,r\,dz\,dr\,d\theta$ = $2\pi\int_0^2 \frac{r(4-r^2)^2}{2}\,dr$ = $\pi\int_0^2 (16r - 8r^3 + r^5)\,dr$ = $\pi\left(32 - 32 + \frac{32}{3}\right)$ = $\frac{32\pi}{3}$.
Sin el factor r queda 256π/15; con r hasta 4 queda 896π/3; con el cilindro 2π · 2 · 8 = 32π.

### P72 · dificultad 2 · kc: triples · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Calcula $∭_E z\,dV$, donde E es la parte de la bola x² + y² + z² ≤ 9 que queda sobre el cono z = √(x² + y²):

- A) 81π/4 · [cono-con-phi-recto] dejas φ llegar hasta π/2, como si el cono fuera el plano xy, en lugar de hasta π/4
- B) 9√2π/2 · [jacobiano-omitido-en-triples] pasas z a ρ cos φ pero no multiplicas por el jacobiano ρ² sen φ
- C) 81π/8 · CORRECTA
- D) 81√2π/4 · [esfericas-sin-sen-phi] usas ρ² dρ dφ dθ como elemento de volumen y olvidas el factor sen φ

solución: en esféricas z = ρ cos φ y dV = ρ² sen φ dρ dφ dθ. El cono z = √(x² + y²) corresponde a φ = π/4, y el sólido está sobre él: 0 ≤ φ ≤ π/4. Como además 0 ≤ ρ ≤ 3 y 0 ≤ θ ≤ 2π, $\int_0^{2\pi}\int_0^{\pi/4}\int_0^3 \rho^3 \cos\varphi\,\sen\varphi\,d\rho\,d\varphi\,d\theta$ = $2\pi\cdot\frac{1}{4}\cdot\frac{81}{4}$ = $\frac{81\pi}{8}$.
Con φ hasta π/2 la integral en φ vale 1/2 y sale 81π/4; sin el jacobiano queda 2π · √2/2 · 9/2 = 9√2π/2; sin sen φ queda 2π · √2/2 · 81/4 = 81√2π/4.

### P73 · dificultad 3 · kc: triples · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Calcula $∭_E z^2\,dV$, donde E es el sólido con 4 ≤ x² + y² + z² ≤ 9 y z ≥ √(x² + y²):

- A) 211π(4 − √2)/30 · CORRECTA
- B) 422π/15 · [cono-con-phi-recto] dejas φ llegar hasta π/2 en lugar de hasta π/4, el ángulo del cono
- C) 211π(π + 2)/20 · [esfericas-sin-sen-phi] usas ρ² dρ dφ dθ como elemento de volumen y olvidas el factor sen φ
- D) 59017π(4 − √2)/30 · [radio-igual-al-lado-derecho] de x² + y² + z² ≤ 9 tomas ρ entre 2 y 9 en lugar de entre 2 y 3

solución: en esféricas z² = ρ² cos² φ y dV = ρ² sen φ dρ dφ dθ. El cono z = √(x² + y²) es φ = π/4, así que 0 ≤ φ ≤ π/4; además 2 ≤ ρ ≤ 3 y 0 ≤ θ ≤ 2π. La integral es $2\pi\int_2^3\rho^4\,d\rho\int_0^{\pi/4}\cos^2\varphi\,\sen\varphi\,d\varphi$ = $2\pi\cdot\frac{211}{5}\cdot\frac{1}{3}\left(1-\frac{\sqrt{2}}{4}\right)$ = $\frac{211\pi(4-\sqrt{2})}{30}$.
Con φ hasta π/2 la integral en φ vale 1/3 y sale 422π/15; sin sen φ la integral en φ es π/8 + 1/4; con ρ hasta 9 la integral en ρ vale 59017/5.

### P74 · dificultad 1 · kc: aplicaciones-multiples · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
El área de la región acotada por y = x² y y = x + 2 es:

- A) 15/2 · [una-sola-frontera-sin-restar] integras solo la recta de arriba, y = x + 2, y no restas la parábola
- B) 21/2 · [suma-en-lugar-de-resta] sumas las dos curvas en el integrando en lugar de restarlas
- C) 3/2 · [limites-de-interseccion-mal-resueltos] al resolver x² = x + 2 factorizas como (x − 1)(x + 2) y tomas x entre −2 y 1
- D) 9/2 · CORRECTA

solución: las curvas se cortan donde x² = x + 2, es decir x² − x − 2 = (x − 2)(x + 1) = 0, o sea x = −1 y x = 2. En ese intervalo la recta queda arriba de la parábola. Entonces $A$ = $\int_{-1}^{2} (x + 2 - x^2)\,dx$ = $\left[\frac{x^2}{2} + 2x - \frac{x^3}{3}\right]_{-1}^{2}$ = $\frac{10}{3} + \frac{7}{6}$ = $\frac{9}{2}$.
Solo con la recta sale 15/2; con la suma sale 21/2; con los límites −2 y 1 sale 3/2.

### P75 · dificultad 2 · kc: aplicaciones-multiples · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
El volumen del sólido limitado por el paraboloide z = x² + y² y el plano z = 3 es:

- A) 9π · [una-sola-frontera-sin-restar] integras solo la altura del plano, 3, y no restas la del paraboloide
- B) 9π/2 · CORRECTA
- C) 27π/2 · [suma-en-lugar-de-resta] sumas las alturas del plano y del paraboloide en lugar de restarlas
- D) 9π/4 · [simetria-sin-duplicar] por la simetría recorres θ solo de 0 a π y no multiplicas por 2

solución: el paraboloide corta al plano en r² = 3, o sea r = √3. El volumen es $V$ = $\int_0^{2\pi}\int_0^{\sqrt{3}} (3 - r^2)\,r\,dr\,d\theta$ = $2\pi\left[\frac{3r^2}{2} - \frac{r^4}{4}\right]_0^{\sqrt{3}}$ = $2\pi\left(\frac{9}{2} - \frac{9}{4}\right)$ = $\frac{9\pi}{2}$.
Solo con el plano sale 2π · 9/2 = 9π; con la suma sale 2π · 27/4 = 27π/2; con θ hasta π sale la mitad, 9π/4.

### P76 · dificultad 2 · kc: aplicaciones-multiples · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Una lámina ocupa la región entre y = x² y y = x + 2 y tiene densidad δ(x,y) = y. Su masa es:

- A) 36/5 · CORRECTA
- B) 6/5 · [limites-de-interseccion-mal-resueltos] al resolver x² = x + 2 factorizas como (x − 1)(x + 2) y tomas x entre −2 y 1
- C) 9/2 · [masa-sin-densidad] ignoras la densidad y calculas el área de la región
- D) 69/5 · [suma-en-lugar-de-resta] al evaluar la integral interna en y sumas los valores en las dos curvas en lugar de restarlos

solución: la masa es $\iint_D y\,dA$, con −1 ≤ x ≤ 2 y x² ≤ y ≤ x + 2 (se cortan en x = −1 y x = 2). La integral interna es $\int_{x^2}^{x+2} y\,dy = \frac{(x+2)^2 - x^4}{2}$. Entonces $m$ = $\frac{1}{2}\int_{-1}^{2}\left[(x+2)^2 - x^4\right]dx$ = $\frac{1}{2}\left(21 - \frac{33}{5}\right)$ = $\frac{36}{5}$.
Con los límites −2 y 1 sale 6/5; sin la densidad sale el área, 9/2; con la suma en lugar de la resta sale ½(21 + 33/5) = 69/5.

### P77 · dificultad 2 · kc: aplicaciones-multiples · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Una lámina triangular con vértices (0,0), (3,0) y (0,6) tiene densidad δ(x,y) = y. La coordenada x̄ de su centro de masa es:

- A) 3/2 · [masa-sin-densidad] divides el momento entre el área del triángulo, 9, en lugar de dividirlo entre la masa
- B) 27/2 · [centro-de-masa-sin-dividir-entre-masa] das el momento ∬ x·δ dA como si fuera x̄, sin dividirlo entre la masa
- C) 3/4 · CORRECTA
- D) 3 · [momentos-intercambiados] usas en el numerador el momento ∬ y·δ dA, que corresponde a ȳ

solución: la hipotenusa es y = 6 − 2x, así que D es 0 ≤ x ≤ 3 con 0 ≤ y ≤ 6 − 2x. La masa es $m = \iint y\,dA = \int_0^3 \frac{(6-2x)^2}{2}\,dx = 18$. El momento es $\iint x\,y\,dA = \int_0^3 \frac{x(6-2x)^2}{2}\,dx = \frac{27}{2}$. Entonces x̄ = (27/2)/18 = 3/4.
Dividir entre el área 9 da 3/2; sin dividir queda 27/2; con el momento ∬ y² dA = 54 se obtiene 54/18 = 3, que es ȳ.

### P78 · dificultad 3 · kc: aplicaciones-multiples · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Una placa ocupa el semicírculo x² + y² ≤ 4 con y ≥ 0 y tiene densidad δ(x,y) = x² + y². La coordenada ȳ de su centro de masa es:

- A) 8/(5π) · [simetria-sin-duplicar] calculas el momento solo en el primer cuadrante por simetría y no lo duplicas
- B) 64/5 · [centro-de-masa-sin-dividir-entre-masa] das el momento ∬ y·δ dA como si fuera ȳ, sin dividirlo entre la masa
- C) 0 · [momentos-intercambiados] usas el momento ∬ x·δ dA, que se anula por simetría y corresponde a x̄
- D) 16/(5π) · CORRECTA

solución: en polares δ = r², dA = r dr dθ, con 0 ≤ r ≤ 2 y 0 ≤ θ ≤ π. La masa es $m = \int_0^\pi\int_0^2 r^3\,dr\,d\theta = 4\pi$. El momento respecto al eje x es $\iint y\,\delta\,dA$ = $\int_0^\pi \sen\theta\,d\theta\int_0^2 r^4\,dr$ = $2\cdot\frac{32}{5}$ = $\frac{64}{5}$. Entonces ȳ = (64/5)/(4π) = 16/(5π).
Sin dividir queda 64/5; con el momento en x se obtiene 0; con solo el primer cuadrante el momento es 32/5 y sale 8/(5π).
