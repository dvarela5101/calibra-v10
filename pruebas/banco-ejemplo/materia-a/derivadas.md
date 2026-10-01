# Derivadas

Reglas básicas de derivación.

## Habilidades
kc: potencia · Derivar potencias de x con la regla de la potencia
kc: cadena · Derivar funciones compuestas con la regla de la cadena · prerrequisitos: potencia

## Errores
mc: no-resta-uno · potencia · bajas el exponente pero no le restas 1
mc: suma-uno · potencia · sumas 1 al exponente, como si integraras
mc: no-baja · potencia · restas 1 al exponente pero no lo bajas como factor
mc: olvida-interna · cadena · derivas la función externa y olvidas multiplicar por la derivada interna
mc: solo-interna · cadena · derivas solo la función interna

## Preguntas

### P1 · dificultad 1 · kc: potencia · revisada · origen: humano · revisó: Ana
La derivada de $x^{3}$ es:

- A) $3x^{2}$ · CORRECTA
- B) $3x^{3}$ · [no-resta-uno]
- C) $\frac{x^{4}}{4}$ · [suma-uno] integras en vez de derivar
- D) $x^{2}$ · [no-baja]

### P2 · dificultad 2 · kc: potencia · revisada · origen: humano · revisó: Ana
Si f(x) = 5x⁴, entonces f'(x) es:

- A) 20x³ · CORRECTA
- B) 20x⁴ · [no-resta-uno] multiplicas por 4 pero dejas el exponente en 4
- C) x⁵ · [suma-uno]
- D) 5x³ · [no-baja] restas 1 al exponente y olvidas multiplicar por 4

### P3 · dificultad 2 · kc: potencia, cadena · revisada · origen: ia (modelo-de-prueba) · revisó: Ana
La derivada de (x² + 1)³ es:

- A) 6x(x² + 1)² · CORRECTA
- B) 3(x² + 1)² · [olvida-interna]
- C) 3(x² + 1)³ · 2x · [no-resta-uno] derivas la potencia sin restarle 1 al exponente
- D) 6x · [solo-interna]

solución: con la regla de la cadena,
d/dx (x² + 1)³ = 3(x² + 1)² · 2x
= 6x(x² + 1)²

### P4 · dificultad 1 · kc: cadena · revisada · origen: humano · revisó: Beto
La derivada de sen(2x) es:

- A) 2cos(2x) · CORRECTA
- B) cos(2x) · [olvida-interna]
- C) 2sen(2x) · [solo-interna] multiplicas por la derivada interna pero no derivas el seno
- D) 2 · [solo-interna]

### P5 · dificultad 3 · kc: cadena · revisada · origen: humano · revisó: Beto
La derivada de $\sqrt{x^{2} + 1}$ es:

- A) $\frac{x}{\sqrt{x^{2} + 1}}$ · CORRECTA
- B) $\frac{1}{2\sqrt{x^{2} + 1}}$ · [olvida-interna]
- C) $2x$ · [solo-interna]
- D) $\sqrt{2x}$ · [solo-interna] derivas solo lo de adentro y lo dejas dentro de la raíz

### P6 · dificultad 2 · kc: potencia · retirada · origen: humano
La derivada de x es:

- A) 1 · CORRECTA
- B) x · [no-resta-uno]
- C) x²/2 · [suma-uno]
- D) 0 · [no-baja]

### P7 · dificultad 3 · kc: cadena · borrador · origen: ia (modelo-de-prueba) · ⚠ revisar
La derivada de $e^{3x^{2}}$ es:

- A) $6x\,e^{3x^{2}}$ · CORRECTA
- B) $e^{3x^{2}}$ · [olvida-interna]
- C) $6x$ · [solo-interna]
- D) $e^{6x}$ · [solo-interna] derivas el exponente y lo dejas en el exponente

solución: la derivada de $e^{u}$ es $e^{u}\,u'$ con $u = 3x^{2}$, así que queda $6x\,e^{3x^{2}}$.
