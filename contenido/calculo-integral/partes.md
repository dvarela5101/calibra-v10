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

### P13 · dificultad 2 · kc: partes-eleccion-u · borrador · origen: ia (desconocido)
En ∫ eˣ·x² dx, ¿qué conviene elegir como u?

- A) eˣ · [u-orden-aparicion] eliges u por el orden en que aparece, no por la prioridad ILATE
- B) x² · CORRECTA
- C) dx · [u-dv-confundidos] tomas como u el diferencial, que siempre va en dv
- D) eˣ·x² · [sin-separar-u-dv] tomas todo el integrando como u sin separarlo en u y dv

### P14 · dificultad 3 · kc: partes-eleccion-u · borrador · origen: ia (desconocido)
En ∫ x³·ln(x) dx un compañero toma u = x³ y dv = ln(x) dx. ¿Qué opinas?

- A) Se complica, porque tendría que integrar ln(x) para hallar v: conviene u = ln(x) · CORRECTA
- B) Está bien, porque x³ aparece primero · [u-orden-aparicion] eliges u por orden de aparición, no por prioridad ILATE
- C) Está bien, porque da igual cuál sea u y cuál dv · [u-dv-confundidos] crees que u y dv son intercambiables
- D) Debería tomar u = x³·ln(x) y dv = dx · [sin-separar-u-dv] no separas el producto en u y dv

### P15 · dificultad 2 · kc: partes-formula · borrador · origen: ia (desconocido)
En ∫ x·cos(x) dx, con u = x y dv = cos(x) dx, el resultado es:

- A) x·sen(x) + cos(x) + C · CORRECTA
- B) x·sen(x) − cos(x) + C · [signo-partes] te equivocas en el signo de la fórmula de partes
- C) cos(x) + C · [omite-uv]
- D) (x²/2)·sen(x) + C · [producto-factor-a-factor] integras cada factor por separado

### P16 · dificultad 3 · kc: partes-formula · borrador · origen: ia (desconocido)
∫ ln(x) dx, usando u = ln(x) y dv = dx, da:

- A) x·ln(x) − x + C · CORRECTA
- B) x·ln(x) + x + C · [signo-partes] te equivocas en el signo de la fórmula de partes
- C) −x + C · [omite-uv]
- D) x·ln(x) + C · [omite-integral-restante]

### P17 · dificultad 2 · kc: partes-formula · borrador · origen: ia (desconocido)
En $\int x\cdot e^{2x}\,dx$, con u = x y $dv = e^{2x}\,dx$, el resultado es:

- A) $\frac{x}{2}e^{2x} - \frac{1}{4}e^{2x} + C$ · CORRECTA
- B) $\frac{x}{2}e^{2x} + C$ · [omite-integral-restante]
- C) $\frac{x^2}{2}\cdot\frac{e^{2x}}{2} + C$ · [producto-factor-a-factor] integras cada factor por separado
- D) $\frac{x}{2}e^{2x} + \frac{1}{4}e^{2x} + C$ · [signo-partes] te equivocas en el signo de la fórmula de partes

### P18 · dificultad 3 · kc: partes-reiterada, partes-formula · borrador · origen: ia (desconocido)
Al resolver ∫ x²·eˣ dx con u = x² queda x²·eˣ − ∫ 2x·eˣ dx. ¿Qué sigue?

- A) Aplicar partes otra vez a ∫ 2x·eˣ dx, con u = 2x · CORRECTA
- B) Escribir x²·eˣ − 2x·eˣ + C y terminar · [partes-una-sola-vez] te detienes aunque la integral que queda sigue siendo un producto
- C) Aplicar partes a ∫ 2x·eˣ dx, pero ahora con u = eˣ · [deshace-paso] inviertes la elección de u y dv y deshaces el paso anterior
- D) Integrar 2x·eˣ como x²·eˣ, así que el resultado es C · [producto-factor-a-factor] integras cada factor por separado

### P19 · dificultad 3 · kc: partes-reiterada · borrador · origen: ia (desconocido)
Para I = ∫ eˣ·sen(x) dx, tras aplicar partes dos veces (primero u = sen(x), luego u = cos(x)) llegas a I = eˣ·sen(x) − eˣ·cos(x) − I. ¿Cuánto vale I?

- A) $\frac{e^x}{2}(\sen(x) - \cos(x)) + C$ · CORRECTA
- B) $e^x\sen(x) - e^x\cos(x) + C$ · [ciclica-no-reconocida] ignoras que la integral original reaparece y hay que despejarla
- C) Hay que aplicar partes una tercera vez, ahora con u = eˣ · [deshace-paso] al repetir partes inviertes la elección de u y deshaces el paso anterior
- D) $e^x(\sen(x) - \cos(x)) + C$ · [despeje-incompleto] al despejar I olvidas dividir entre 2

### P20 · dificultad 3 · kc: partes-reiterada · borrador · origen: ia (desconocido)
Para I = ∫ eˣ·cos(x) dx, tras dos aplicaciones de partes llegas a I = eˣ·cos(x) + eˣ·sen(x) − I. Entonces I es:

- A) $\frac{e^x}{2}(\cos(x) + \sen(x)) + C$ · CORRECTA
- B) $e^x(\cos(x) + \sen(x)) + C$ · [despeje-incompleto] al despejar I olvidas dividir entre 2
- C) $e^x\cos(x) + e^x\sen(x) - I$ · [ciclica-no-reconocida] dejas la integral original en la respuesta sin despejarla
- D) $e^x\cos(x) + C$ · [partes-una-sola-vez] te quedas con el primer término de la primera aplicación de partes
