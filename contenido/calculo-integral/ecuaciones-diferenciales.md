# Ecuaciones diferenciales de primer orden

## Habilidades
kc: edo-separables · Separar variables e integrar
kc: edo-lineal · Resolver lineales con factor integrante
kc: edo-exponencial · Reconocer y resolver dy/dx = ky con condición inicial

## Errores
mc: no-separa · edo-separables · integras ambos lados sin separar antes las variables
mc: deriva-en-vez-de-integrar · edo-separables · derivas cuando la ecuación pide integrar
mc: constante-antes · edo-separables · fijas o descartas la constante antes de terminar de integrar
mc: factor-con-q · edo-lineal · usas Q(x) en vez de P(x) para el factor integrante
mc: factor-sin-exponencial · edo-lineal · olvidas la exponencial en el factor integrante
mc: factor-mezclado · edo-lineal · mezclas el procedimiento del factor integrante con otros métodos
mc: integra-directo-ky · edo-exponencial · resuelves dy/dx = ky como integración directa sin ver que y está en ambos lados
mc: pierde-k-exponente · edo-exponencial · pierdes la constante k del exponente
mc: constante-sumada · edo-exponencial · sumas la constante en vez de multiplicar la exponencial

## Preguntas

### P5 · dificultad 2 · kc: edo-separables · revisada · origen: humano · revisó: prototipo
Una ecuación diferencial de variables separables tiene la forma dy/dx = f(x)·g(y). ¿Cuál es el primer paso para resolverla?

- A) Separar variables y escribir $\frac{1}{g(y)}\,dy = f(x)\,dx$ · CORRECTA
- B) Integrar ambos lados directamente sin separar · [no-separa] no separas las variables antes de integrar
- C) Derivar ambos lados para simplificar · [deriva-en-vez-de-integrar] confundes resolver con derivar
- D) Sustituir y = 0 para encontrar la constante · [constante-antes] intentas encontrar la constante antes de integrar

### P6 · dificultad 3 · kc: edo-lineal · revisada · origen: humano · revisó: prototipo
Para la ecuación diferencial dy/dx + P(x)y = Q(x), el factor integrante es:

- A) $e^{\int P(x)\,dx}$ · CORRECTA
- B) $e^{\int Q(x)\,dx}$ · [factor-con-q] confundes P(x) con Q(x) en la fórmula del factor integrante
- C) $\int P(x)\,dx$ · [factor-sin-exponencial] olvidas aplicar la exponencial al integrar P(x)
- D) $P(x)\cdot e^x$ · [factor-mezclado] mezclas la fórmula con la solución de homogéneas

### P7 · dificultad 2 · kc: edo-exponencial · revisada · origen: humano · revisó: prototipo
Si dy/dx = ky donde k es constante, la solución general es:

- A) y = Ceᵏˣ · CORRECTA
- B) y = C + kx · [integra-directo-ky] resuelves como si fuera integración directa sin reconocer la exponencial
- C) y = kx² + C · [integra-directo-ky] integras k dos veces ignorando que y está en la ecuación
- D) y = eˣ + k · [pierde-k-exponente] olvidas la constante k en el exponente

### P33 · dificultad 2 · kc: edo-separables · borrador · origen: ia (desconocido)
Resuelves dy/dx = x·y² separando variables. ¿Qué queda para integrar?

- A) $\int \frac{dy}{y^2} = \int x\,dx$ · CORRECTA
- B) $\int dy = \int x\cdot y^2\,dx$ · [no-separa] integras sin separar antes las variables
- C) $\frac{d^2y}{dx^2} = y^2 + 2xy\cdot\frac{dy}{dx}$ · [deriva-en-vez-de-integrar] derivas la ecuación en vez de integrarla
- D) Primero se halla C con y(0) y después se separa · [constante-antes] buscas la constante antes de integrar

### P34 · dificultad 3 · kc: edo-separables · borrador · origen: ia (desconocido)
La solución general de $\frac{dy}{dx} = \frac{2x}{y}$ es:

- A) $y^2 = 2x^2 + C$ · CORRECTA
- B) $y = \frac{x^2}{y} + C$ · [no-separa] integras sin separar antes las variables
- C) $y^2 = 2x^2$ · [constante-antes] descartas la constante antes de terminar de integrar
- D) $y' = \frac{2}{y} - \frac{2x\cdot y'}{y^2}$ · [deriva-en-vez-de-integrar] derivas la ecuación en vez de integrarla

### P35 · dificultad 2 · kc: edo-lineal · borrador · origen: ia (desconocido)
Para dy/dx + 2y = eˣ, el factor integrante es:

- A) $e^{2x}$ · CORRECTA
- B) $e^{e^x}$ · [factor-con-q] usas el lado derecho en vez del coeficiente de y
- C) 2x · [factor-sin-exponencial]
- D) $2\cdot e^x$ · [factor-mezclado] mezclas el coeficiente de y con el lado derecho

### P36 · dificultad 3 · kc: edo-lineal · borrador · origen: ia (desconocido)
Para $\frac{dy}{dx} + \frac{1}{x}\cdot y = x$, con x > 0, ¿qué factor integrante usas y qué ecuación queda?

- A) $\mu = x$, y queda $(x\cdot y)' = x^2$ · CORRECTA
- B) $\mu = e^{x^2/2}$, y queda $(e^{x^2/2}\cdot y)' = x\cdot e^{x^2/2}$ · [factor-con-q]
- C) $\mu = \ln(x)$, y queda $(\ln(x)\cdot y)' = x\cdot\ln(x)$ · [factor-sin-exponencial]
- D) $\mu = x$, y queda $x\cdot y = x$ · [factor-mezclado] multiplicas por el factor pero te saltas la integración

### P37 · dificultad 2 · kc: edo-exponencial · borrador · origen: ia (desconocido)
Una población crece según dP/dt = 0,03·P, con P(0) = 500. ¿Cuál es P(t)?

- A) $P(t) = 500\cdot e^{0,03t}$ · CORRECTA
- B) $P(t) = 500 + 0,03t$ · [integra-directo-ky] resuelves como integración directa sin ver que P está en ambos lados
- C) $P(t) = 500\cdot e^t + 0,03$ · [pierde-k-exponente] sacas la constante del exponente
- D) $P(t) = e^{0,03t} + 500$ · [constante-sumada] sumas la condición inicial en vez de multiplicar

### P38 · dificultad 3 · kc: edo-exponencial · borrador · origen: ia (desconocido)
Si dy/dx = −2y y y(0) = 3, ¿cuánto vale y(1)?

- A) $3\cdot e^{-2}$ · CORRECTA
- B) 1 · [integra-directo-ky] resuelves y = 3 − 2x como si fuera integración directa
- C) $3\cdot e^{-1}$ · [pierde-k-exponente]
- D) $e^{-2} + 3$ · [constante-sumada] sumas la condición inicial en vez de multiplicar
