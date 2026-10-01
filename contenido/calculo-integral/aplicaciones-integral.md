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

### P46 · dificultad 2 · kc: app-volumen · borrador · origen: ia (desconocido)
El volumen al rotar y = √x, entre x = 0 y x = 4, alrededor del eje x es:

- A) 8π · CORRECTA
- B) 16π/3 · [radio-sin-cuadrado]
- C) 8 · [omite-pi] omites el π en la fórmula del volumen
- D) $2\pi\cdot\int_0^4 x\cdot\sqrt{x}\,dx$ · [discos-vs-cascarones] usas cascarones para una rotación alrededor del eje x

### P47 · dificultad 3 · kc: app-volumen · borrador · origen: ia (desconocido)
Rotas la región bajo y = x², entre x = 0 y x = 2, alrededor del eje y. Con cascarones, el volumen es:

- A) $2\pi\cdot\int_0^2 x\cdot x^2\,dx = 8\pi$ · CORRECTA
- B) $\pi\cdot\int_0^2 (x^2)^2\,dx$ · [discos-vs-cascarones] usas discos alrededor del eje x en vez de cascarones
- C) $\int_0^2 x\cdot x^2\,dx = 4$ · [omite-pi] omites el factor 2π
- D) $2\pi\cdot\int_0^2 x^2\cdot x^2\,dx$ · [discos-vs-cascarones] mezclas la altura con el radio del cascarón

### P12 · dificultad 3 · kc: app-arco · revisada · origen: humano · revisó: prototipo
Para calcular la longitud de arco de y = f(x) de a a b, usas:

- A) $\int_a^b \sqrt{1 + [f'(x)]^2}\,dx$ · CORRECTA
- B) $\int_a^b f'(x)\,dx$ · [arco-solo-derivada] crees que la longitud es solo la integral de la derivada
- C) $\int_a^b \sqrt{[f(x)]^2}\,dx$ · [arco-f-en-vez-de-fprima] confundes la fórmula usando f(x) en lugar de f'(x)
- D) $[f(b) - f(a)]$ · [arco-distancia-vertical] usas la distancia vertical en lugar de la longitud de curva

### P48 · dificultad 2 · kc: app-arco · borrador · origen: ia (desconocido)
La longitud de $y = x^{3/2}$ entre x = 0 y x = 1 se plantea como:

- A) $\int_0^1 \sqrt{1 + \frac{9}{4}\cdot x}\,dx$ · CORRECTA
- B) $\int_0^1 \frac{3}{2}\cdot\sqrt{x}\,dx$ · [arco-solo-derivada]
- C) $\int_0^1 \sqrt{1 + x^3}\,dx$ · [arco-f-en-vez-de-fprima] usas f(x) en lugar de f'(x)
- D) f(1) − f(0) = 1 · [arco-distancia-vertical]

### P49 · dificultad 3 · kc: app-arco · borrador · origen: ia (desconocido)
La longitud de la recta y = 2x entre x = 0 y x = 3 es:

- A) 3√5 · CORRECTA
- B) 6, la diferencia de alturas f(3) − f(0) · [arco-distancia-vertical]
- C) $\int_0^3 2\,dx$ · [arco-solo-derivada]
- D) $\int_0^3 \sqrt{1 + 4x^2}\,dx$ · [arco-f-en-vez-de-fprima] usas f(x) en lugar de f'(x)

### P50 · dificultad 2 · kc: app-area · borrador · origen: ia (desconocido)
El área entre y = x y y = x², entre sus puntos de corte, es:

- A) $\int_0^1 (x - x^2)\,dx = \frac{1}{6}$ · CORRECTA
- B) $\int_0^1 (x^2 - x)\,dx = -\frac{1}{6}$ · [area-sin-orden] restas la curva de arriba a la de abajo
- C) $\int_0^2 (x - x^2)\,dx$ · [area-sin-intersecciones]
- D) $\int_0^1 x\,dx = \frac{1}{2}$ · [area-integra-una]

### P51 · dificultad 3 · kc: app-area · borrador · origen: ia (desconocido)
El área encerrada entre y = 4 − x² y el eje x es:

- A) 32/3 · CORRECTA
- B) −32/3 · [area-sin-orden] restas la parábola al eje en vez de al revés
- C) $\int_0^4 (4 - x^2)\,dx$ · [area-sin-intersecciones]
- D) $\int_{-2}^2 x^2\,dx = \frac{16}{3}$ · [area-integra-una]
