# Rectas tangentes y razones relacionadas

Recta tangente y recta normal a una curva, y problemas de razones relacionadas. Es del Parcial 2 (semanas 5 a 8 del programa). De Precálculo hacen falta las rectas, la geometría (Pitágoras, áreas y volúmenes) y las ecuaciones. Los errores que faltaban y las preguntas nuevas son borradores de IA (HU-101), escritos con el criterio del modelo y apuntes libres, y esperan la revisión de un desarrollador.

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
mc: derivada-sin-evaluar · recta-tangente · usas la derivada f'(x) como pendiente sin evaluarla en el punto, y la recta queda con una expresión en x donde debería ir un número
mc: pendiente-es-valor-funcion · recta-tangente · tomas el valor f(a) como pendiente de la tangente, en vez de f'(a)
mc: punto-mal-sustituido · recta-tangente · al escribir la recta que pasa por un punto lo sustituyes mal: intercambias las coordenadas del punto o omites su ordenada
mc: normal-sin-reciproco · recta-tangente · para la normal, o para una perpendicular, solo cambias el signo de la pendiente y no la inviertes
mc: normal-sin-signo · recta-tangente · para la normal, o para una perpendicular, solo inviertes la pendiente y no le cambias el signo
mc: punto-externo-como-tangencia · recta-tangente · tomas el punto por donde debe pasar la tangente como si fuera el punto de tangencia, aunque no está en la curva

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

### P79 · dificultad 1 · kc: recta-tangente · borrador · origen: ia (sonnet-5.5)
¿Cuál es la ecuación de la recta tangente a la curva $y = 2x^2 - 3x + 1$ en el punto de abscisa x = 2?

- A) y − 3 = (4x − 3)(x − 2) · [derivada-sin-evaluar] usas la derivada 4x − 3 como pendiente sin evaluarla en x = 2
- B) y = 3x − 3 · [pendiente-es-valor-funcion] tomas f(2) = 3 como pendiente de la tangente
- C) y = 5x − 7 · CORRECTA
- D) y = 5x − 13 · [punto-mal-sustituido] usas la pendiente correcta pero escribes y − 2 = 5(x − 3), con las coordenadas del punto intercambiadas

solución: el punto de tangencia es (2, f(2)) = (2, 3), porque f(2) = 8 − 6 + 1 = 3. La derivada es f'(x) = 4x − 3, así que la pendiente es f'(2) = 5. La recta es y − 3 = 5(x − 2), es decir y = 5x − 7.
A deja la derivada sin evaluar: el resultado no es una recta, porque la pendiente sigue dependiendo de x. B usa f(2) = 3, que es la altura del punto y no la pendiente. D escribe y − 2 = 5(x − 3), que equivale a y = 5x − 13 y pasa por (3, 2), no por (2, 3).

### P80 · dificultad 2 · kc: recta-tangente · borrador · origen: ia (sonnet-5.5)
¿Cuál es la ecuación de la recta normal a la curva $y = x^2 + 4x$ en el punto de abscisa x = 1?

- A) $y - 5 = -\frac{1}{2x+4}(x - 1)$ · [derivada-sin-evaluar] inviertes y cambias el signo de la derivada 2x + 4 pero la dejas sin evaluar en x = 1
- B) $y - 5 = -\frac{1}{6}(x - 1)$ · CORRECTA
- C) $y - 5 = -6(x - 1)$ · [normal-sin-reciproco] para la normal solo cambias el signo de la pendiente 6 y no la inviertes
- D) $y - 5 = \frac{1}{6}(x - 1)$ · [normal-sin-signo] para la normal solo inviertes la pendiente 6 y no le cambias el signo

solución: el punto es (1, f(1)) = (1, 5), porque f(1) = 1 + 4 = 5. La derivada es f'(x) = 2x + 4, así que la tangente tiene pendiente f'(1) = 6. La normal es perpendicular a la tangente y su pendiente es el opuesto del recíproco: −1/6. La recta es y − 5 = −(1/6)(x − 1).
A no evalúa la derivada: la pendiente de la normal debe ser un número. C da −6, que es el opuesto de 6 pero no su recíproco negativo (6·(−6) = −36, no −1). D da 1/6, que es el recíproco pero con el signo de la tangente (6·(1/6) = 1, no −1).

### P81 · dificultad 2 · kc: recta-tangente · borrador · origen: ia (sonnet-5.5)
¿Cuál es la ecuación de la recta tangente a la curva $y = x^2 + 3$ que es perpendicular a la recta x + 2y = 4?

- A) $y = \frac{1}{2}x + \frac{47}{16}$ · [normal-sin-reciproco] para la perpendicular solo cambias el signo de la pendiente −1/2 y no la inviertes
- B) y = 2x − 2 · [punto-mal-sustituido] usas el punto y la pendiente correctos pero escribes y = 2(x − 1) y omites la ordenada 4 del punto
- C) y = −2x + 2 · [normal-sin-signo] para la perpendicular solo inviertes la pendiente −1/2 y no le cambias el signo
- D) y = 2x + 2 · CORRECTA

solución: la recta x + 2y = 4 equivale a y = −x/2 + 2, con pendiente −1/2. Una recta perpendicular tiene pendiente 2, porque (−1/2)·2 = −1. La tangente a $y = x^2 + 3$ tiene pendiente 2x, y 2x = 2 da x = 1. El punto de tangencia es (1, 4), porque 1 + 3 = 4. La recta es y − 4 = 2(x − 1), es decir y = 2x + 2.
A usa la pendiente 1/2: 2x = 1/2 da x = 1/4, el punto (1/4, 49/16) y la recta y = x/2 + 47/16. C usa la pendiente −2: 2x = −2 da x = −1, el punto (−1, 4) y la recta y = −2x + 2. B escribe y = 2(x − 1) y olvida sumar la ordenada 4.

### P82 · dificultad 3 · kc: recta-tangente · borrador · origen: ia (sonnet-5.5)
El punto (1, −5) no está en la curva $y = x^2 - 2x$, pero por él pasan dos rectas tangentes a la curva. ¿Cuál es la ecuación de la que tiene pendiente positiva?

- A) y = 4x − 9 · CORRECTA
- B) y = 4x − 12 · [punto-mal-sustituido] usas el punto de tangencia y la pendiente correctos pero escribes y = 4(x − 3) y omites la ordenada 3 del punto de tangencia
- C) y = −5 · [punto-externo-como-tangencia] tomas (1, −5) como el punto de tangencia y usas la pendiente f'(1) = 0
- D) y = 3x − 6 · [pendiente-es-valor-funcion] ubicas bien el punto de tangencia pero tomas f(3) = 3 como pendiente en vez de f'(3)

solución: sea a la abscisa del punto de tangencia. La pendiente es f'(a) = 2a − 2 y el punto es (a, a² − 2a). La tangente es y − (a² − 2a) = (2a − 2)(x − a). Como pasa por (1, −5): −5 − a² + 2a = (2a − 2)(1 − a) = −2a² + 4a − 2. Al reunir queda a² − 2a − 3 = 0, que se factoriza como (a − 3)(a + 1) = 0, así que a = 3 o a = −1. La pendiente 2a − 2 es positiva solo con a = 3 (da 4; con a = −1 da −4). El punto de tangencia es (3, 3), y la recta es y − 3 = 4(x − 3), es decir y = 4x − 9. Comprobación: en x = 1 da −5.
B olvida sumar la ordenada 3, y D usa f(3) = 3 como pendiente. C trata (1, −5) como punto de tangencia, pero ese punto no está en la curva: f(1) = −1.

### P83 · dificultad 1 · kc: razones-relacionadas · borrador · origen: ia (sonnet-5.5)
Una mancha de aceite circular se extiende de modo que su radio crece a 3 cm/s. ¿A qué razón crece el área de la mancha cuando el radio mide 8 cm? ($A = \pi r^2$)

- A) 16π cm²/s · [deriva-sin-tiempo] derivas $A = \pi r^2$ respecto de r y no multiplicas por dr/dt
- B) 48π cm²/s · CORRECTA
- C) 3 cm²/s · [confunde-tasas] tomas la tasa del radio como si fuera la tasa del área
- D) 24π cm²/s · [tasas-proporcionales] tratas el área como proporcional al radio y multiplicas 3 por A/r = 8π

solución: se deriva $A = \pi r^2$ respecto de t: dA/dt = 2πr·dr/dt. Con r = 8 y dr/dt = 3, queda dA/dt = 2π·8·3 = 48π cm²/s.
A deja 2πr = 16π, que es dA/dr y no dA/dt. C toma dr/dt = 3 como dA/dt. D usa A/r = 64π/8 = 8π como si A = (A/r)·r fuera lineal en r, lo que da 24π; pero A crece con r², y por eso aparece el factor 2.

### P84 · dificultad 2 · kc: razones-relacionadas · borrador · origen: ia (sonnet-5.5)
Un bote se acerca a un muelle jalado por una cuerda que pasa por una argolla fija en el muelle, 6 m por encima de la proa del bote. La cuerda se recoge a 1,5 m/s. Sea x la distancia horizontal entre la proa y el muelle. Cuando x = 8 m, ¿cuánto vale dx/dt?

- A) −3/2 m/s · [misma-velocidad-extremos] supones que la distancia horizontal cambia con la misma rapidez que la longitud de la cuerda
- B) +15/8 m/s · [signo-tasa-ignorado] tomas ds/dt = +1,5 aunque la cuerda se acorta, y dx/dt sale positiva
- C) −15/8 m/s · CORRECTA
- D) −6/5 m/s · [catetos-intercambiados] al despejar dx/dt de x·x' = s·s' escribes x'= x·s'/s en vez de s·s'/x, y la razón sale invertida

solución: sea s la longitud de cuerda entre la argolla y la proa. Por Pitágoras s² = x² + 6². Cuando x = 8, s² = 64 + 36 = 100 y s = 10. Se deriva respecto de t: 2s·ds/dt = 2x·dx/dt, de donde dx/dt = (s/x)·ds/dt. Como la cuerda se acorta, ds/dt = −1,5. Entonces dx/dt = (10/8)(−1,5) = −15/8 m/s: el signo negativo indica que x disminuye.
A iguala dx/dt con ds/dt, pero la hipotenusa y el cateto no cambian igual. B ignora que s disminuye y toma +1,5. D usa la razón x/s = 8/10 en vez de s/x = 10/8, y da −1,2 m/s.

### P85 · dificultad 3 · kc: razones-relacionadas · borrador · origen: ia (sonnet-5.5)
Un tanque cónico con el vértice hacia abajo tiene 6 m de altura y 3 m de radio en la parte superior. Se vacía a razón de 2 m³/min. Sea r el radio de la superficie del agua y h su profundidad. Cuando h = 4 m, ¿cuánto vale dr/dt? ($V = \frac{1}{3}\pi r^2 h$)

- A) $-\frac{1}{4\pi}$ m/min · CORRECTA
- B) $-\frac{1}{2\pi}$ m/min · [misma-velocidad-extremos] supones que el radio de la superficie y la profundidad cambian con la misma rapidez, dr/dt = dh/dt
- C) $\frac{1}{4\pi}$ m/min · [signo-tasa-ignorado] tomas dV/dt = +2 aunque el tanque se vacía, y dr/dt sale positiva
- D) $-\frac{1}{16\pi}$ m/min · [catetos-intercambiados] escribes la razón del triángulo al revés, r = 2h en vez de r = h/2, y todo el cálculo posterior sale invertido

solución: por triángulos semejantes, r/h = 3/6, así que r = h/2. Entonces $V = \frac{1}{3}\pi\left(\frac{h}{2}\right)^2 h = \frac{\pi}{12}h^3$. Se deriva: dV/dt = (π/4)·h²·dh/dt. El tanque se vacía, así que dV/dt = −2, y con h = 4: −2 = (π/4)·16·dh/dt = 4π·dh/dt, de donde dh/dt = −1/(2π) m/min. Como r = h/2, dr/dt = (1/2)·dh/dt = −1/(4π) m/min.
B se queda con dh/dt como si fuera dr/dt, pero r cambia la mitad de rápido que h. C ignora el signo de dV/dt. D usa r = 2h: V = (4π/3)h³, dV/dt = 4πh²·dh/dt, con h = 4 da dh/dt = −2/(64π) = −1/(32π), y dr/dt = 2·dh/dt = −1/(16π).
