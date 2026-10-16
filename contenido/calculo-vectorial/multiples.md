# Integrales dobles y triples

5.1 a 6.3. Errores a cazar: invertir mal el orden de integración, no cambiar los límites al cambiar de variable, y olvidar el jacobiano.

## Habilidades
kc: multiples · Integrales dobles y triples

## Errores
mc: multiples-e1 · multiples · inviertes mal el orden y no ajustas los límites correctamente
mc: multiples-e2 · multiples · integras primero respecto a y pero usas los límites como si fuera respecto a x
mc: multiples-e3 · multiples · olvidas dividir por los exponentes al integrar
mc: multiples-e4 · multiples · no cambias correctamente el límite de r al cambiar de variable
mc: multiples-e5 · multiples · usas solo la mitad del círculo
mc: multiples-e6 · multiples · mantienes los límites rectangulares en lugar de adaptarlos a polares
mc: multiples-e7 · multiples · olvidas el jacobiano de la transformación
mc: multiples-e8 · multiples · confundes el jacobiano con el argumento de la función
mc: multiples-e9 · multiples · inviertes el orden sin el jacobiano

## Preguntas

### P4 · dificultad 2 · kc: multiples · revisada · origen: humano · revisó: prototipo
Calcula $\iint_R xy\,dA$ donde R es el rectángulo [0,2] × [0,1]. Al integrar primero respecto a x:

- A) 1 · CORRECTA
- B) 2 · [multiples-e1]
- C) 1/2 · [multiples-e2]
- D) 4 · [multiples-e3]

### P5 · dificultad 2 · kc: multiples · revisada · origen: humano · revisó: prototipo
Al convertir $\iint_R f(x,y)\,dA$ a coordenadas polares donde R es el círculo x² + y² ≤ 4, los límites correctos son:

- A) 0 ≤ r ≤ 2, 0 ≤ θ ≤ 2π · CORRECTA
- B) 0 ≤ r ≤ 4, 0 ≤ θ ≤ 2π · [multiples-e4]
- C) 0 ≤ r ≤ 2, 0 ≤ θ ≤ π · [multiples-e5]
- D) -2 ≤ r ≤ 2, 0 ≤ θ ≤ 2π · [multiples-e6]

### P6 · dificultad 2 · kc: multiples · revisada · origen: humano · revisó: prototipo
Al calcular $\iint_R e^{x^2+y^2}\,dA$ sobre el círculo unitario usando coordenadas polares, el elemento de área correcto es:

- A) r dr dθ · CORRECTA
- B) dr dθ · [multiples-e7]
- C) r² dr dθ · [multiples-e8]
- D) dθ dr · [multiples-e9]

### P14 · dificultad 3 · kc: multiples · borrador · origen: ia (sonnet-5.5)
Calcula $\iint_D \sqrt{x^2+y^2}\,dA$, donde D es la región del plano que cumple 1 ≤ x² + y² ≤ 4:

- A) 7π/3 · [multiples-e5] recorres θ solo de 0 a π, así que integras sobre la mitad de la región
- B) 3π · [multiples-e7] olvidas el factor r del elemento de área y dejas como integrando solo r
- C) 14π/3 · CORRECTA
- D) 42π · [multiples-e4] tomas r entre 1 y 4, usando el 4 de x² + y² ≤ 4 como si fuera el radio exterior

solución: en coordenadas polares x = r cos θ, y = r sen θ, se tiene √(x² + y²) = r y dA = r dr dθ. La condición 1 ≤ x² + y² ≤ 4 pide 1 ≤ r ≤ 2, y como la región es un anillo completo, 0 ≤ θ ≤ 2π.
Entonces $\iint_D \sqrt{x^2+y^2}\,dA = \int_0^{2\pi}\int_1^2 r\cdot r\,dr\,d\theta$. La integral en r vale $\left[\frac{r^3}{3}\right]_1^2 = \frac{7}{3}$, y la de θ multiplica por $2\pi$: el resultado es $\frac{14\pi}{3}$.
Las otras opciones salen de errores concretos: sin el factor r del jacobiano, $2\pi\int_1^2 r\,dr = 3\pi$; con r entre 1 y 4, $2\pi\int_1^4 r^2\,dr = 42\pi$; con θ entre 0 y π, $\pi\int_1^2 r^2\,dr = \frac{7\pi}{3}$.
