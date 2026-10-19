# Integración por partes

## Habilidades
kc: partes-eleccion-u · Elegir u y dv con la prioridad ILATE
kc: partes-formula · Aplicar uv − ∫v du con signos y términos correctos
kc: partes-reiterada · Aplicar partes varias veces o en forma cíclica

## Errores
mc: u-orden-aparicion · partes-eleccion-u · eliges u por orden de aparición, no por la prioridad ILATE
mc: u-dv-confundidos · partes-eleccion-u · confundes el papel de u y dv
mc: sin-separar-u-dv · partes-eleccion-u · no separas el integrando en u y dv
mc: signo-partes · partes-formula · te equivocas en el signo de la fórmula uv − ∫v du
mc: omite-uv · partes-formula · omites el término u·v
mc: omite-integral-restante · partes-formula · olvidas restar la integral ∫v du
mc: producto-factor-a-factor · partes-formula · integras un producto factor por factor, como si ∫f·g fuera ∫f·∫g
mc: partes-una-sola-vez · partes-reiterada · te detienes tras una aplicación de partes aunque la integral que queda sigue siendo un producto
mc: deshace-paso · partes-reiterada · al repetir partes inviertes la elección de u y dv y deshaces el paso anterior
mc: ciclica-no-reconocida · partes-reiterada · no reconoces que la integral original reaparece y hay que despejarla
mc: despeje-incompleto · partes-reiterada · al despejar la integral original olvidas dividir entre 2

## Preguntas

### P1 · dificultad 2 · kc: partes-eleccion-u · revisada · origen: humano · revisó: prototipo
En ∫ x·ln(x) dx, ¿qué eliges como u?

- A) x · [u-orden-aparicion] eliges u por orden de aparición, no por prioridad ILATE
- B) ln(x) · CORRECTA
- C) dx · [u-dv-confundidos] confundes u con dv
- D) x · ln(x) · [sin-separar-u-dv] no separas el producto en u y dv

### P4 · dificultad 2 · kc: partes-formula · revisada · origen: humano · revisó: prototipo
En ∫ x·eˣ dx, con u = x y dv = eˣ dx, el resultado es:

- A) x·eˣ − eˣ + C · CORRECTA
- B) x·eˣ + eˣ + C · [signo-partes] te equivocas en el signo de la fórmula de partes
- C) eˣ + C · [omite-uv]
- D) x²·eˣ/2 + C · [producto-factor-a-factor] integras como si fuera un producto de potencias

### P13 · dificultad 2 · kc: partes-eleccion-u · revisada · origen: ia (desconocido) · revisó: Juzou04
En ∫ eˣ·x² dx, ¿qué conviene elegir como u?

- A) eˣ · [u-orden-aparicion] eliges u por el orden en que aparece, no por la prioridad ILATE
- B) x² · CORRECTA
- C) dx · [u-dv-confundidos] tomas como u el diferencial, que siempre va en dv
- D) eˣ·x² · [sin-separar-u-dv] tomas todo el integrando como u sin separarlo en u y dv

solución: por la prioridad ILATE, la parte algebraica (x²) va antes que la exponencial, así que u = x² y dv = eˣ dx. Así du = 2x dx baja el grado del polinomio y v = eˣ es inmediata: ∫ eˣ·x² dx = x²·eˣ − ∫ 2x·eˣ dx, que se resuelve con otra aplicación de partes. Con u = eˣ quedaría v = x³/3 y la integral restante subiría de grado. El diferencial dx nunca es u, y tomar todo el integrando como u deja dv = dx y no avanza.

### P14 · dificultad 3 · kc: partes-eleccion-u · revisada · origen: ia (desconocido) · revisó: Juzou04
En ∫ x³·ln(x) dx un compañero toma u = x³ y dv = ln(x) dx. ¿Qué opinas?

- A) Se complica, porque tendría que integrar ln(x) para hallar v: conviene u = ln(x) · CORRECTA
- B) Está bien, porque x³ aparece primero · [u-orden-aparicion] eliges u por orden de aparición, no por prioridad ILATE
- C) Está bien, porque da igual cuál sea u y cuál dv · [u-dv-confundidos] crees que u y dv son intercambiables
- D) Debería tomar u = x³·ln(x) y dv = dx · [sin-separar-u-dv] no separas el producto en u y dv

solución: con u = x³ y dv = ln(x) dx habría que integrar ln(x) para hallar v (v = x·ln(x) − x), y la integral que queda es más difícil que la original. Por ILATE el logaritmo va antes que la parte algebraica: u = ln(x), du = dx/x, dv = x³ dx y v = x⁴/4. Entonces ∫ x³·ln(x) dx = (x⁴/4)·ln(x) − ∫ (x⁴/4)·(1/x) dx = (x⁴/4)·ln(x) − x⁴/16 + C. El orden en que aparecen los factores no decide nada, u y dv no son intercambiables, y tomar todo el producto como u deja dv = dx y no simplifica.

### P15 · dificultad 2 · kc: partes-formula · revisada · origen: ia (desconocido) · revisó: Juzou04
En ∫ x·cos(x) dx, con u = x y dv = cos(x) dx, el resultado es:

- A) x·sen(x) + cos(x) + C · CORRECTA
- B) x·sen(x) − cos(x) + C · [signo-partes] te equivocas en el signo de la fórmula de partes
- C) cos(x) + C · [omite-uv]
- D) (x²/2)·sen(x) + C · [producto-factor-a-factor] integras cada factor por separado

solución: con u = x, du = dx, dv = cos(x) dx y v = sen(x): ∫ x·cos(x) dx = x·sen(x) − ∫ sen(x) dx = x·sen(x) + cos(x) + C. Comprobación: la derivada de x·sen(x) + cos(x) es sen(x) + x·cos(x) − sen(x) = x·cos(x). El −cos(x) sale de equivocar el signo de la fórmula; cos(x) + C es solo −∫ sen(x) dx, sin el término u·v; y (x²/2)·sen(x) integra cada factor por separado.

### P16 · dificultad 3 · kc: partes-formula · revisada · origen: ia (desconocido) · revisó: Juzou04
∫ ln(x) dx, usando u = ln(x) y dv = dx, da:

- A) x·ln(x) − x + C · CORRECTA
- B) x·ln(x) + x + C · [signo-partes] te equivocas en el signo de la fórmula de partes
- C) −x + C · [omite-uv]
- D) x·ln(x) + C · [omite-integral-restante]

solución: con u = ln(x), du = dx/x, dv = dx y v = x: ∫ ln(x) dx = x·ln(x) − ∫ x·(1/x) dx = x·ln(x) − ∫ dx = x·ln(x) − x + C. Comprobación: la derivada de x·ln(x) − x es ln(x) + 1 − 1 = ln(x). El +x sale de equivocar el signo de la fórmula, −x + C omite el término u·v, y x·ln(x) + C olvida restar la integral ∫ v du.

### P17 · dificultad 2 · kc: partes-formula · revisada · origen: ia (desconocido) · revisó: Juzou04
En $\int x\cdot e^{2x}\,dx$, con u = x y $dv = e^{2x}\,dx$, el resultado es:

- A) $\frac{x}{2}e^{2x} - \frac{1}{4}e^{2x} + C$ · CORRECTA
- B) $\frac{x}{2}e^{2x} + C$ · [omite-integral-restante]
- C) $\frac{x^2}{2}\cdot\frac{e^{2x}}{2} + C$ · [producto-factor-a-factor] integras cada factor por separado
- D) $\frac{x}{2}e^{2x} + \frac{1}{4}e^{2x} + C$ · [signo-partes] te equivocas en el signo de la fórmula de partes

solución: con u = x, du = dx, dv = e^(2x) dx y v = e^(2x)/2: ∫ x·e^(2x) dx = (x/2)·e^(2x) − ∫ (1/2)·e^(2x) dx = (x/2)·e^(2x) − (1/4)·e^(2x) + C. Comprobación: la derivada es (1/2)·e^(2x) + x·e^(2x) − (1/2)·e^(2x) = x·e^(2x). La opción sin −(1/4)·e^(2x) olvida restar la integral ∫ v du, la que tiene +(1/4)·e^(2x) equivoca el signo, y (x²/2)·(e^(2x)/2) integra cada factor por separado.

### P18 · dificultad 3 · kc: partes-reiterada, partes-formula · revisada · origen: ia (desconocido) · revisó: Juzou04
Al resolver ∫ x²·eˣ dx con u = x² queda x²·eˣ − ∫ 2x·eˣ dx. ¿Qué sigue?

- A) Aplicar partes otra vez a ∫ 2x·eˣ dx, con u = 2x · CORRECTA
- B) Escribir x²·eˣ − 2x·eˣ + C y terminar · [partes-una-sola-vez] te detienes aunque la integral que queda sigue siendo un producto
- C) Aplicar partes a ∫ 2x·eˣ dx, pero ahora con u = eˣ · [deshace-paso] inviertes la elección de u y dv y deshaces el paso anterior
- D) Integrar 2x·eˣ como x²·eˣ, así que el resultado es C · [producto-factor-a-factor] integras cada factor por separado

solución: la integral que queda, ∫ 2x·eˣ dx, sigue siendo un producto de un polinomio por una exponencial, así que se aplica partes otra vez con u = 2x (du = 2 dx) y dv = eˣ dx (v = eˣ): ∫ 2x·eˣ dx = 2x·eˣ − 2eˣ. El resultado es x²·eˣ − 2x·eˣ + 2eˣ + C; su derivada es x²·eˣ. Escribir x²·eˣ − 2x·eˣ + C es detenerse antes de tiempo (falta el +2eˣ). Tomar ahora u = eˣ y dv = 2x dx da v = x² y devuelve x²·eˣ − ∫ x²·eˣ dx: deshace el paso anterior. Integrar 2x·eˣ factor por factor como x²·eˣ no es válido.

### P19 · dificultad 3 · kc: partes-reiterada · revisada · origen: ia (desconocido) · revisó: Juzou04
Para I = ∫ eˣ·sen(x) dx, tras aplicar partes dos veces (primero u = sen(x), luego u = cos(x)) llegas a I = eˣ·sen(x) − eˣ·cos(x) − I. ¿Cuánto vale I?

- A) $\frac{e^x}{2}(\sen(x) - \cos(x)) + C$ · CORRECTA
- B) $e^x\sen(x) - e^x\cos(x) + C$ · [ciclica-no-reconocida] ignoras que la integral original reaparece y hay que despejarla
- C) Hay que aplicar partes una tercera vez, ahora con u = eˣ · [deshace-paso] al repetir partes inviertes la elección de u y deshaces el paso anterior
- D) $e^x(\sen(x) - \cos(x)) + C$ · [despeje-incompleto] al despejar I olvidas dividir entre 2

solución: la integral original reaparece a la derecha con signo menos, así que se despeja: I + I = eˣ·sen(x) − eˣ·cos(x), es decir 2I = eˣ·(sen(x) − cos(x)), e I = (eˣ/2)·(sen(x) − cos(x)) + C. Comprobación: la derivada es (eˣ/2)·(sen(x) − cos(x)) + (eˣ/2)·(cos(x) + sen(x)) = eˣ·sen(x). Quedarse con eˣ·sen(x) − eˣ·cos(x) ignora el −I; eˣ·(sen(x) − cos(x)) despeja pero no divide entre 2; y una tercera aplicación con u = eˣ invierte la elección y regresa al paso anterior.

### P20 · dificultad 3 · kc: partes-reiterada · revisada · origen: ia (desconocido) · revisó: Juzou04
Para I = ∫ eˣ·cos(x) dx, tras dos aplicaciones de partes llegas a I = eˣ·cos(x) + eˣ·sen(x) − I. Entonces I es:

- A) $\frac{e^x}{2}(\cos(x) + \sen(x)) + C$ · CORRECTA
- B) $e^x(\cos(x) + \sen(x)) + C$ · [despeje-incompleto] al despejar I olvidas dividir entre 2
- C) $e^x\cos(x) + e^x\sen(x) - I$ · [ciclica-no-reconocida] dejas la integral original en la respuesta sin despejarla
- D) $e^x\cos(x) + C$ · [partes-una-sola-vez] te quedas con el primer término de la primera aplicación de partes

solución: la integral original reaparece a la derecha con signo menos: 2I = eˣ·cos(x) + eˣ·sen(x), así que I = (eˣ/2)·(cos(x) + sen(x)) + C. Comprobación: la derivada es (eˣ/2)·(cos(x) + sen(x)) + (eˣ/2)·(cos(x) − sen(x)) = eˣ·cos(x). eˣ·(cos(x) + sen(x)) olvida dividir entre 2, la expresión que todavía tiene −I no está despejada, y eˣ·cos(x) es solo el término u·v de la primera aplicación.

### P52 · dificultad 2 · kc: partes-reiterada, partes-formula · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04
Calcula $\int x^2\,\sen(3x)\,dx$.

- A) $-\frac{x^2\cos 3x}{3}-\frac{2x\,\sen 3x}{9}-\frac{2\cos 3x}{27}+C$ · [signo-partes] cambias el signo del término ∫v du en la fórmula y lo sumas en vez de restarlo
- B) $\frac{2x\,\sen 3x}{9}+\frac{2\cos 3x}{27}+C$ · [omite-uv] olvidas el término uv de la fórmula y solo conservas lo que viene de la integral
- C) $-\frac{x^2\cos 3x}{3}+\frac{2x\,\sen 3x}{9}+\frac{2\cos 3x}{27}+C$ · CORRECTA
- D) $-\frac{x^2\cos 3x}{3}+\frac{2x\,\sen 3x}{9}+C$ · [omite-integral-restante] en la segunda aplicación de partes te quedas con u·v y olvidas restar la integral ∫v du que todavía queda

solución: Se toma $u=x^2$, $dv=\sen(3x)\,dx$, de modo que $du=2x\,dx$ y $v=-\frac{\cos 3x}{3}$. Entonces $\int x^2\sen 3x\,dx=-\frac{x^2\cos 3x}{3}+\frac{2}{3}\int x\cos 3x\,dx$. La integral que queda sigue siendo un producto, así que se aplica partes otra vez con $u=x$, $dv=\cos(3x)\,dx$, $du=dx$, $v=\frac{\sen 3x}{3}$: $\int x\cos 3x\,dx=\frac{x\,\sen 3x}{3}-\frac{1}{3}\int \sen 3x\,dx$, que da $\frac{x\,\sen 3x}{3}+\frac{\cos 3x}{9}$. Al multiplicar por $\frac{2}{3}$ y sumar queda $-\frac{x^2\cos 3x}{3}+\frac{2x\,\sen 3x}{9}+\frac{2\cos 3x}{27}+C$. La opción A sale de usar $uv+\int v\,du$ en la primera aplicación (el término $\frac{2}{3}\int x\cos 3x\,dx$ cambia de signo y arrastra al resto). La opción B sale de descartar $uv=-\frac{x^2\cos 3x}{3}$ y quedarse solo con $\frac{2}{3}\int x\cos 3x\,dx$ ya resuelta. La opción D aplica bien la primera vez, pero en la segunda se queda con $\frac{x\,\sen 3x}{3}$ y olvida restar $\frac{1}{3}\int \sen 3x\,dx$: le falta el término $\frac{2\cos 3x}{27}$.
