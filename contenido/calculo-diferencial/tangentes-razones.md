# Rectas tangentes y razones relacionadas

Recta tangente y recta normal a una curva, y problemas de razones relacionadas. Es del Parcial 2 (semanas 5 a 8 del programa). De Precálculo hacen falta las rectas, la geometría (Pitágoras, áreas y volúmenes) y las ecuaciones. Falta el catálogo de errores de recta-tangente.

## Habilidades
kc: recta-tangente · Hallar la recta tangente y la normal a una curva en un punto, y las tangentes que salen de un punto externo · prerrequisitos: derivada-significado, reglas-derivacion
kc: razones-relacionadas · Plantear y resolver un problema de razones relacionadas derivando respecto al tiempo · prerrequisitos: derivacion-implicita, derivada-significado

## Errores
mc: deriva-sin-tiempo · razones-relacionadas · derivas la fórmula respecto de la variable geométrica y olvidas multiplicar por su derivada respecto del tiempo
mc: confunde-tasas · razones-relacionadas · tomas la tasa de cambio del volumen, o del área, como si fuera la tasa del radio
mc: tasas-proporcionales · razones-relacionadas · divides las tasas dadas como si las magnitudes fueran proporcionales, en vez de derivar la fórmula que las relaciona
mc: misma-velocidad-extremos · razones-relacionadas · supones que las dos variables ligadas por la figura cambian con la misma rapidez, como los dos extremos de una escalera
mc: signo-tasa-ignorado · razones-relacionadas · no tomas en cuenta el signo de la tasa: una magnitud que disminuye tiene derivada negativa
mc: catetos-intercambiados · razones-relacionadas · intercambias los dos lados del triángulo al despejar con Pitágoras y la razón sale invertida

## Preguntas

### P11 · dificultad 2 · kc: razones-relacionadas · revisada · origen: humano · revisó: prototipo · ⚠ revisar
Un globo esférico se infla a razón de 10 cm³/s. ¿A qué velocidad crece el radio cuando r = 5 cm? ($V = \frac{4}{3}\pi r^3$)

- A) $\frac{dr}{dt} = \frac{10}{4\pi\cdot 25} = \frac{1}{10\pi}$ cm/s · CORRECTA
- B) $\frac{dr}{dt} = \frac{10}{r^2}$ · [deriva-sin-tiempo]
- C) $\frac{dr}{dt} = 10$ cm/s · [confunde-tasas]
- D) $\frac{dr}{dt} = 2$ cm/s · [tasas-proporcionales]

### P12 · dificultad 2 · kc: razones-relacionadas · retirada · origen: humano · revisó: prototipo
Una escalera de 10 m resbala por una pared. Si el extremo inferior se aleja a 2 m/s, ¿a qué velocidad baja el extremo superior cuando está a 6 m del suelo?

- A) $\frac{dy}{dt} = -\frac{3}{2}$ m/s · CORRECTA
- B) $\frac{dy}{dt} = -2$ m/s · [misma-velocidad-extremos]
- C) $\frac{dy}{dt} = 2$ m/s · [signo-tasa-ignorado]
- D) $\frac{dy}{dt} = -\frac{8}{3}$ m/s · [catetos-intercambiados]
