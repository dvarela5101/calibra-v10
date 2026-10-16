# Vectores, rectas y planos

La guía del parcial 1 lista estas habilidades, y cada una es una pregunta posible:
calcular la magnitud de un vector, encontrar un vector unitario en una dirección dada, calcular el producto punto, calcular el ángulo entre dos vectores, calcular el vector proyección de un vector sobre otro, calcular el producto cruz, encontrar un vector perpendicular a dos vectores dados, calcular el área del paralelogramo y el volumen del paralelepípedo, hallar ecuaciones paramétricas de una recta, calcular la distancia de un punto a una recta y de un punto a un plano, y determinar si dos rectas se intersectan, son paralelas o se cruzan.

Errores que vale la pena cazar: proyectar sobre el vector equivocado (proy de a sobre b no es proy de b sobre a), usar producto punto donde se pide producto cruz, olvidar normalizar al buscar un unitario, y confundir rectas que se cruzan con rectas paralelas.

## Habilidades
kc: vectores · Vectores, rectas y planos

## Errores
mc: vectores-e1 · vectores · olvidas normalizar el vector dividiendo por su magnitud
mc: vectores-e2 · vectores · confundes las componentes del vector original
mc: vectores-e3 · vectores · crees que un vector unitario siempre tiene componentes iguales
mc: vectores-e4 · vectores · proyectas b sobre a en lugar de a sobre b
mc: vectores-e5 · vectores · confundes la proyección vectorial con la proyección escalar
mc: vectores-e6 · vectores · usas producto cruz en lugar de la fórmula de proyección
mc: vectores-e7 · vectores · calculas el producto punto en lugar del producto cruz
mc: vectores-e8 · vectores · sumas los vectores creyendo que eso da perpendicularidad
mc: vectores-e9 · vectores · multiplicas componente a componente

## Preguntas

### P1 · dificultad 2 · kc: vectores · revisada · origen: humano · revisó: prototipo
Dado el vector v = (3, -4), ¿cuál es el vector unitario en la dirección de v?

- A) (3/5, -4/5) · CORRECTA
- B) (3, -4) · [vectores-e1]
- C) (-4/5, 3/5) · [vectores-e2]
- D) (1, 1) · [vectores-e3]

### P2 · dificultad 2 · kc: vectores · revisada · origen: humano · revisó: prototipo
Sean a = (2, 1, -1) y b = (1, 3, 2). Calcula la proyección de a sobre b.

- A) (5/14, 15/14, 10/14) · CORRECTA
- B) (2/6, 6/6, -2/6) · [vectores-e4]
- C) 5 · [vectores-e5]
- D) (-1, 2, 3) · [vectores-e6]

### P3 · dificultad 2 · kc: vectores · revisada · origen: humano · revisó: prototipo
Encuentra un vector perpendicular a u = (1, 2, 3) y v = (4, 5, 6).

- A) (-3, 6, -3) · CORRECTA
- B) 32 · [vectores-e7]
- C) (5, 7, 9) · [vectores-e8]
- D) (4, 10, 18) · [vectores-e9]

### P13 · dificultad 3 · kc: vectores · borrador · origen: ia (sonnet-5.5)
Sean A(1, 2, −1) y B(3, 4, 0) dos puntos del espacio. ¿Cuál es el vector de magnitud 15 que tiene la misma dirección y el mismo sentido que el vector que va de A a B?

- A) (30, 30, 15) · [vectores-e1] multiplicas el vector de A a B por 15 sin dividirlo antes por su magnitud 3, y el resultado mide 45 en vez de 15
- B) (9, 12, 0) · [vectores-e2] usas las coordenadas del punto B como si fueran las componentes del vector de A a B, en vez de restar las de A, y después lo llevas a magnitud 15
- C) (10, 10, 5) · CORRECTA
- D) (5√3, 5√3, 5√3) · [vectores-e3] crees que un vector de la magnitud pedida debe tener las tres componentes iguales, sin usar la dirección de A a B

solución: el vector de A a B es B − A = (3 − 1, 4 − 2, 0 − (−1)) = (2, 2, 1). Su magnitud es √(4 + 4 + 1) = 3, así que el vector unitario en esa dirección es (2/3, 2/3, 1/3). Para que la magnitud sea 15 se multiplica por 15: (10, 10, 5). Comprobación: √(100 + 100 + 25) = √225 = 15.
