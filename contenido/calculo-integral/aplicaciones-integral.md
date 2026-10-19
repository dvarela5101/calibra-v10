# Aplicaciones de la integral

## Habilidades
kc: app-volumen · Plantear volúmenes de revolución con discos o cascarones
kc: app-arco · Plantear la longitud de arco
kc: app-area · Plantear el área entre curvas

## Errores
mc: radio-sin-cuadrado · app-volumen · olvidas elevar al cuadrado el radio
mc: omite-pi · app-volumen · omites el factor π o 2π
mc: discos-vs-cascarones · app-volumen · confundes o mezclas los métodos de discos y cascarones
mc: arco-solo-derivada · app-arco · crees que la longitud es la integral de la derivada
mc: arco-f-en-vez-de-fprima · app-arco · usas f(x) en lugar de f'(x) en la fórmula
mc: arco-distancia-vertical · app-arco · usas la diferencia de alturas en vez de la longitud de la curva
mc: area-sin-orden · app-area · restas las curvas en el orden equivocado
mc: area-sin-intersecciones · app-area · usas límites que no son los puntos de corte
mc: area-integra-una · app-area · integras solo una de las curvas

## Preguntas

### P11 · dificultad 2 · kc: app-volumen · revisada · origen: humano · revisó: prototipo
El volumen de un sólido de revolución al rotar y = f(x) alrededor del eje x entre a y b es:

- A) $\pi\int_a^b [f(x)]^2\,dx$ · CORRECTA
- B) $\pi\int_a^b f(x)\,dx$ · [radio-sin-cuadrado]
- C) $\int_a^b [f(x)]^2\,dx$ · [omite-pi] omites el π en la fórmula del volumen
- D) $2\pi\int_a^b x f(x)\,dx$ · [discos-vs-cascarones] confundes método de discos con método de cascarones

### P46 · dificultad 2 · kc: app-volumen · revisada · origen: ia (desconocido) · revisó: Juzou04
El volumen al rotar y = √x, entre x = 0 y x = 4, alrededor del eje x es:

- A) 8π · CORRECTA
- B) 16π/3 · [radio-sin-cuadrado]
- C) 8 · [omite-pi] omites el π en la fórmula del volumen
- D) $2\pi\cdot\int_0^4 x\cdot\sqrt{x}\,dx$ · [discos-vs-cascarones] usas cascarones para una rotación alrededor del eje x

solución: al rotar alrededor del eje x se usan discos de radio √x: V = π·∫ de 0 a 4 de (√x)² dx = π·∫ de 0 a 4 de x dx = π·8 = 8π. 16π/3 sale de π·∫ √x dx, sin elevar el radio al cuadrado; 8 omite el π; y 2π·∫ x·√x dx es el volumen con cascarones alrededor del eje y (128π/5), no del eje x.

### P47 · dificultad 3 · kc: app-volumen · revisada · origen: ia (desconocido) · revisó: Juzou04
Rotas la región bajo y = x², entre x = 0 y x = 2, alrededor del eje y. Con cascarones, el volumen es:

- A) $2\pi\cdot\int_0^2 x\cdot x^2\,dx = 8\pi$ · CORRECTA
- B) $\pi\cdot\int_0^2 (x^2)^2\,dx$ · [discos-vs-cascarones] usas discos alrededor del eje x en vez de cascarones
- C) $\int_0^2 x\cdot x^2\,dx = 4$ · [omite-pi] omites el factor 2π
- D) $2\pi\cdot\int_0^2 x^2\cdot x^2\,dx$ · [discos-vs-cascarones] mezclas la altura con el radio del cascarón

solución: con cascarones alrededor del eje y, cada cascarón tiene radio x, altura x² y espesor dx: V = 2π·∫ de 0 a 2 de x·x² dx = 2π·[x⁴/4] de 0 a 2 = 2π·4 = 8π. π·∫ (x²)² dx es el método de discos para una rotación alrededor del eje x (32π/5); ∫ x·x² dx = 4 omite el 2π; y 2π·∫ x²·x² dx toma la altura como radio.

### P12 · dificultad 3 · kc: app-arco · revisada · origen: humano · revisó: prototipo
Para calcular la longitud de arco de y = f(x) de a a b, usas:

- A) $\int_a^b \sqrt{1 + [f'(x)]^2}\,dx$ · CORRECTA
- B) $\int_a^b f'(x)\,dx$ · [arco-solo-derivada] crees que la longitud es solo la integral de la derivada
- C) $\int_a^b \sqrt{[f(x)]^2}\,dx$ · [arco-f-en-vez-de-fprima] confundes la fórmula usando f(x) en lugar de f'(x)
- D) $[f(b) - f(a)]$ · [arco-distancia-vertical] usas la distancia vertical en lugar de la longitud de curva

### P48 · dificultad 2 · kc: app-arco · revisada · origen: ia (desconocido) · revisó: Juzou04
La longitud de $y = x^{3/2}$ entre x = 0 y x = 1 se plantea como:

- A) $\int_0^1 \sqrt{1 + \frac{9}{4}\cdot x}\,dx$ · CORRECTA
- B) $\int_0^1 \frac{3}{2}\cdot\sqrt{x}\,dx$ · [arco-solo-derivada]
- C) $\int_0^1 \sqrt{1 + x^3}\,dx$ · [arco-f-en-vez-de-fprima] usas f(x) en lugar de f'(x)
- D) f(1) − f(0) = 1 · [arco-distancia-vertical]

solución: la longitud es ∫ √(1 + (y')²) dx. Con y = x^(3/2), y' = (3/2)·x^(1/2) y (y')² = (9/4)·x, así que L = ∫ de 0 a 1 de √(1 + (9/4)·x) dx (vale (13√13 − 8)/27 ≈ 1,44). ∫ (3/2)·√x dx integra solo la derivada; √(1 + x³) eleva al cuadrado f(x) en vez de f'(x); y f(1) − f(0) = 1 es la diferencia de alturas, no la longitud de la curva.

### P49 · dificultad 3 · kc: app-arco · revisada · origen: ia (desconocido) · revisó: Juzou04
La longitud de la recta y = 2x entre x = 0 y x = 3 es:

- A) 3√5 · CORRECTA
- B) 6, la diferencia de alturas f(3) − f(0) · [arco-distancia-vertical]
- C) $\int_0^3 2\,dx$ · [arco-solo-derivada]
- D) $\int_0^3 \sqrt{1 + 4x^2}\,dx$ · [arco-f-en-vez-de-fprima] usas f(x) en lugar de f'(x)

solución: con y = 2x, y' = 2 y L = ∫ de 0 a 3 de √(1 + 2²) dx = 3√5 ≈ 6,71. Comprobación: es la distancia entre (0, 0) y (3, 6), √(3² + 6²) = √45 = 3√5. El 6 es la diferencia de alturas f(3) − f(0); ∫ de 0 a 3 de 2 dx = 6 integra solo la derivada; y √(1 + 4x²) usa f(x) = 2x en vez de f'(x) = 2.

### P50 · dificultad 2 · kc: app-area · revisada · origen: ia (desconocido) · revisó: Juzou04
El área entre y = x y y = x², entre sus puntos de corte, es:

- A) $\int_0^1 (x - x^2)\,dx = \frac{1}{6}$ · CORRECTA
- B) $\int_0^1 (x^2 - x)\,dx = -\frac{1}{6}$ · [area-sin-orden] restas la curva de arriba a la de abajo
- C) $\int_0^2 (x - x^2)\,dx$ · [area-sin-intersecciones]
- D) $\int_0^1 x\,dx = \frac{1}{2}$ · [area-integra-una]

solución: las curvas se cortan donde x = x², es decir, en x = 0 y x = 1. En (0, 1), x ≥ x², así que el área es ∫ de 0 a 1 de (x − x²) dx = 1/2 − 1/3 = 1/6. Restar al revés da −1/6, y un área no puede ser negativa. Los límites de 0 a 2 no son los puntos de corte, y ∫ x dx = 1/2 integra solo una de las curvas.

### P51 · dificultad 3 · kc: app-area · revisada · origen: ia (desconocido) · revisó: Juzou04
El área encerrada entre y = 4 − x² y el eje x es:

- A) 32/3 · CORRECTA
- B) −32/3 · [area-sin-orden] restas la parábola al eje en vez de al revés
- C) $\int_0^4 (4 - x^2)\,dx$ · [area-sin-intersecciones]
- D) $\int_{-2}^2 x^2\,dx = \frac{16}{3}$ · [area-integra-una] integras solo el término x² y dejas por fuera el 4

solución: la parábola corta el eje x donde 4 − x² = 0, en x = −2 y x = 2, y entre ellos está por encima del eje. El área es ∫ de −2 a 2 de (4 − x²) dx = 16 − 16/3 = 32/3. −32/3 resta al revés. Los límites de 0 a 4 no son los puntos de corte (entre 2 y 4 la parábola está bajo el eje). Y ∫ de −2 a 2 de x² dx = 16/3 integra solo el término x² y deja por fuera el 4.

### P55 · dificultad 2 · kc: app-area · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04
Halla el área de la región encerrada entre las curvas $y=2x^2$ y $y=x+3$.

- A) $\frac{27}{8}$ · [area-sin-intersecciones] solo usas la raíz positiva x = 3/2 y tomas el 0 como límite inferior
- B) $\frac{65}{8}$ · [area-integra-una] integras solo la recta entre los puntos de corte, sin restar la parábola
- C) $\frac{125}{24}$ · CORRECTA
- D) $-\frac{125}{24}$ · [area-sin-orden] restas la recta de la parábola, parábola menos recta, y das el resultado negativo

solución: Los puntos de corte salen de $2x^2=x+3$, es decir, $2x^2-x-3=0$, que factoriza como $(2x-3)(x+1)=0$, con $x=-1$ y $x=\frac{3}{2}$. En ese intervalo la recta queda por encima de la parábola (en $x=0$: $3>0$). El área es $\int_{-1}^{3/2}\left(x+3-2x^2\right)dx$. Una antiderivada es $\frac{x^2}{2}+3x-\frac{2x^3}{3}$, que vale $\frac{27}{8}$ en x = 3/2 y $-\frac{11}{6}$ en x = −1, así que el área es $\frac{27}{8}+\frac{11}{6}=\frac{125}{24}$. La opción A integra la misma diferencia pero desde 0 hasta 3/2, olvidando la raíz x = −1: da $\frac{27}{8}$. La opción B integra solo $x+3$ entre −1 y 3/2: $\frac{65}{8}$. La opción D resta en el orden contrario, $\int_{-1}^{3/2}(2x^2-x-3)\,dx=-\frac{125}{24}$.
