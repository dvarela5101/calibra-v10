# Optimización

Plantear la función que se optimiza con su restricción y hallar el máximo o el mínimo. Es del Parcial 3 (semana 11 del programa). De Precálculo hacen falta la geometría (áreas y volúmenes) y las ecuaciones. Las preguntas nuevas son borradores de IA (HU-101), escritos con el criterio del modelo y apuntes libres, y esperan la revisión de un desarrollador.

## Habilidades
kc: optimizacion · Plantear la función a optimizar con su restricción y hallar el máximo o el mínimo · prerrequisitos: extremos-absolutos, extremos-locales

## Errores
mc: deriva-sin-restriccion · optimizacion · derivas A = x·y sin usar antes la restricción para dejar una sola variable
mc: tantea-en-vez-de-optimizar · optimizacion · propones dimensiones que cumplen la restricción en vez de derivar para hallar el óptimo
mc: no-comprueba-sentido · optimizacion · das un resultado que no tiene sentido en la situación, como un lado nulo o una longitud negativa, sin comprobarlo
mc: restriccion-mal-planteada · optimizacion · escribes mal la restricción, por ejemplo x + y = 100 en vez de 2x + 2y = 100 para un perímetro de 100
mc: cantidad-pedida-confundida · optimizacion · entregas la variable donde ocurre el óptimo, o la cantidad auxiliar que minimizaste (como la distancia al cuadrado), en vez de la cantidad que pide el enunciado

## Preguntas

### P10 · dificultad 2 · kc: optimizacion · revisada · origen: humano · revisó: prototipo · ⚠ revisar
Quieres cercar un terreno rectangular con 100 m de cerca. ¿Qué dimensiones maximizan el área?

- A) 25 m × 25 m (cuadrado) · CORRECTA
- B) 50 m × 50 m · [restriccion-mal-planteada]
- C) 30 m × 20 m · [tantea-en-vez-de-optimizar]
- D) 100 m × 0 m · [no-comprueba-sentido]

### P108 · dificultad 1 · kc: optimizacion · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04
Dos números positivos x e y cumplen x + 3y = 90. ¿Cuál es el mayor valor posible del producto xy?

- A) 600 · [tantea-en-vez-de-optimizar] pruebas x = 30 y y = 20, que cumplen la condición, y te quedas con su producto sin derivar para hallar el máximo
- B) 45 · [cantidad-pedida-confundida] das el valor de x en el máximo, no el valor máximo del producto
- C) 675 · CORRECTA
- D) 0 · [deriva-sin-restriccion] derivas xy respecto de x tomando y como constante, te queda y = 0 y concluyes que el producto es 0

solución: de x + 3y = 90 se despeja x = 90 − 3y, así que el producto queda en una sola variable: P(y) = (90 − 3y)·y = 90y − 3y². Su derivada es P'(y) = 90 − 6y, que se anula en y = 15. Como P'' = −6 < 0, es un máximo. Entonces x = 90 − 45 = 45 y P = 45·15 = 675. La opción 45 es el valor de x en el óptimo, no el del producto. La opción 600 sale de probar x = 30 y y = 20 (30 + 60 = 90), que cumple la condición pero no es el máximo. La opción 0 sale de derivar xy sin sustituir antes la condición: queda y = 0, que no es un punto del problema.

### P109 · dificultad 2 · kc: optimizacion · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04
De una lámina cuadrada de 24 cm de lado se recorta un cuadrado de lado x en cada esquina y se doblan los bordes hacia arriba para formar una caja sin tapa. ¿Cuál es el mayor volumen posible de la caja, en cm³?

- A) 2048 · [restriccion-mal-planteada] tomas el lado de la base como 24 − x en vez de 24 − 2x, porque olvidas que se recorta en los dos extremos
- B) 1024 · CORRECTA
- C) 4 · [cantidad-pedida-confundida] das el lado del cuadrado recortado, no el volumen máximo
- D) 0 · [no-comprueba-sentido] tomas la otra raíz de V' = 0, x = 12, con la que la base mide 0 y la caja no existe

solución: al recortar x en cada esquina, el lado de la base queda 24 − 2x y la altura es x. El volumen es V(x) = x(24 − 2x)² con 0 < x < 12. Derivando, V'(x) = (24 − 2x)² − 4x(24 − 2x) = (24 − 2x)(24 − 6x). Se anula en x = 12 y en x = 4. Con x = 12 la base mide 0 y el volumen es 0, así que no sirve; con x = 4 la base mide 16 y V = 4·16² = 1024. Es un máximo porque V crece de 0 hasta x = 4 y luego decrece hasta 0 en x = 12. La opción 2048 sale de plantear V = x(24 − x)², cuyo máximo está en x = 8. La opción 4 es el lado del corte. La opción 0 es el volumen con x = 12.

### P110 · dificultad 3 · kc: optimizacion · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04
¿Cuál es la menor distancia entre el punto (4, 0) y la parábola y² = 2x?

- A) 7 · [cantidad-pedida-confundida] das el mínimo de la distancia al cuadrado y no sacas la raíz
- B) 4 · [tantea-en-vez-de-optimizar] tomas el vértice (0, 0) de la parábola como el punto más cercano y mides su distancia, sin derivar
- C) $2\sqrt{2}$ · [deriva-sin-restriccion] derivas (x − 4)² + y² respecto de x con y constante, obtienes x = 4 y sustituyes en la parábola
- D) $\sqrt{7}$ · CORRECTA

solución: un punto (x, y) de la parábola cumple y² = 2x con x ≥ 0. Su distancia al cuadrado al punto (4, 0) es d² = (x − 4)² + y². Sustituyendo y² = 2x queda una sola variable: d²(x) = (x − 4)² + 2x = x² − 6x + 16. Minimizar d² da el mismo punto que minimizar d. Su derivada 2x − 6 se anula en x = 3, que está en el dominio x ≥ 0, y la segunda derivada 2 > 0 confirma un mínimo. Entonces d² = 9 − 18 + 16 = 7 y la distancia mínima es $\sqrt{7}$ (en los puntos (3, ±$\sqrt{6}$)). La opción 7 es d², no d. La opción 4 es la distancia al vértice, que es mayor que $\sqrt{7}$. La opción $2\sqrt{2}$ sale de derivar sin sustituir la parábola: queda x = 4, y² = 8 y d = $\sqrt{8}$, que no es el mínimo.
