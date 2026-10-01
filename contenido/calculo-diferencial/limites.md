# Límites y continuidad

Errores a cazar: aplicar L Hôpital sin indeterminación, y confundir que el límite exista con que la función esté definida.

## Habilidades
kc: limites · Límites y continuidad

## Errores
mc: limites-e1 · limites · aplicas L'Hôpital sin verificar que hay una forma indeterminada 0/0
mc: limites-e2 · limites · confundes que la función no esté definida en x=2 con que el límite no exista
mc: limites-e3 · limites · sustituyes directamente sin reconocer la indeterminación
mc: limites-e4 · limites · confundes la existencia del límite con la continuidad de la función
mc: limites-e5 · limites · no reconoces que f(1) = 3 está explícitamente definida
mc: limites-e6 · limites · aplicas reglas de derivación sin verificar las condiciones de continuidad
mc: limites-e7 · limites · aplicas límite directo sin reconocer que es un límite notable
mc: limites-e8 · limites · confundes la forma 0/0 con una división por cero que tiende a infinito
mc: limites-e9 · limites · aplicas L'Hôpital sin mencionar primero que hay indeterminación 0/0

## Preguntas

### P1 · dificultad 2 · kc: limites · revisada · origen: humano · revisó: prototipo
Calcula el límite: $\lim_{x\to 2} \frac{x^2 - 4}{x - 2}$

- A) 4 · CORRECTA
- B) 0 · [limites-e1]
- C) No existe · [limites-e2]
- D) 2 · [limites-e3]

### P2 · dificultad 2 · kc: limites · revisada · origen: humano · revisó: prototipo
Sea $f(x) = \frac{x^2 - 1}{x - 1}$ para x ≠ 1 y f(1) = 3. ¿La función es continua en x = 1?

- A) No, porque $\lim_{x\to 1} f(x) = 2 \ne f(1) = 3$ · CORRECTA
- B) Sí, porque el límite existe · [limites-e4]
- C) No, porque f(1) no está definida · [limites-e5]
- D) Sí, porque se puede aplicar L'Hôpital · [limites-e6]

### P3 · dificultad 2 · kc: limites · revisada · origen: humano · revisó: prototipo
Evalúa $\lim_{x\to 0} \frac{\sen(x)}{x}$

- A) 1 · CORRECTA
- B) 0 · [limites-e7]
- C) ∞ · [limites-e8]
- D) Aplico L'Hôpital: cos(0)/1 = 1, pero justificas mal · [limites-e9]
