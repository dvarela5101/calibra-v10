# Derivadas parciales y gradiente

2.3 a 2.6. Errores a cazar: derivar respecto a la variable equivocada, confundir el gradiente con la derivada direccional, y olvidar normalizar el vector de dirección.

## Habilidades
kc: parciales · Derivadas parciales y gradiente

## Errores
mc: parciales-e1 · parciales · derivas respecto a y en lugar de x
mc: parciales-e2 · parciales · olvidas evaluar en el punto dado
mc: parciales-e3 · parciales · calculas el gradiente completo en lugar de la derivada parcial pedida
mc: parciales-e4 · parciales · confundes las componentes del gradiente
mc: parciales-e5 · parciales · confundes el gradiente con la derivada direccional en alguna dirección
mc: parciales-e6 · parciales · derivas pero no evalúas correctamente en el punto
mc: parciales-e7 · parciales · olvidas normalizar el vector de dirección
mc: parciales-e8 · parciales · confundes la derivada direccional con el gradiente
mc: parciales-e9 · parciales · normalizas pero luego calculas la magnitud del gradiente en lugar del producto punto

## Preguntas

### P1 · dificultad 2 · kc: parciales · revisada · origen: humano · revisó: prototipo
Dada f(x,y) = x²y + y³, calcula $\frac{\partial f}{\partial x}$ en el punto (2,1).

- A) 4 · CORRECTA
- B) 7 · [parciales-e1]
- C) 4y · [parciales-e2]
- D) 2x + 3y² · [parciales-e3]

### P2 · dificultad 2 · kc: parciales · revisada · origen: humano · revisó: prototipo
Para f(x,y) = eˣʸ, el gradiente ∇f en (1,0) es:

- A) (0, 1) · CORRECTA
- B) (1, 0) · [parciales-e4]
- C) 0 · [parciales-e5]
- D) (e, 1) · [parciales-e6]

### P3 · dificultad 2 · kc: parciales · revisada · origen: humano · revisó: prototipo
La derivada direccional de f(x,y) = x² + y² en (1,1) en la dirección del vector (3,4) es:

- A) 2 · CORRECTA
- B) 10 · [parciales-e7]
- C) (2, 2) · [parciales-e8]
- D) 2√2 · [parciales-e9]
