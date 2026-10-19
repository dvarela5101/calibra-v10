# Aplicaciones de la derivada

Extremos, teorema del valor medio, concavidad, regla de L'Hôpital y trazado de curvas, con las derivadas de orden superior que usan. Es del Parcial 3 (semanas 9 a 11 del programa). De Precálculo hacen falta las desigualdades y las tablas de signos. Los errores que faltaban y las preguntas nuevas son borradores de IA (HU-101), escritos con el criterio del modelo y apuntes libres, y esperan la revisión de un desarrollador.

## Habilidades
kc: extremos-absolutos · Hallar los extremos absolutos de una función continua en un intervalo cerrado · prerrequisitos: reglas-derivacion, continuidad
kc: teorema-valor-medio · Verificar las hipótesis del teorema de Rolle o del valor medio y hallar el punto que garantizan · prerrequisitos: continuidad, diferenciabilidad
kc: extremos-locales · Clasificar un punto crítico con el criterio de la primera o de la segunda derivada · prerrequisitos: derivada-significado, reglas-derivacion
kc: concavidad-inflexion · Usar el signo de la segunda derivada para decidir dónde una función es cóncava hacia arriba o hacia abajo y hallar sus puntos de inflexión · prerrequisitos: extremos-locales
kc: lhopital · Calcular un límite con la regla de L'Hôpital, verificando antes que hay una indeterminación · prerrequisitos: limite-algebraico, reglas-derivacion
kc: trazado-curvas · Describir la gráfica de una función con su dominio, asíntotas, crecimiento y concavidad · prerrequisitos: limites-infinito-asintotas, extremos-locales, concavidad-inflexion

## Errores
mc: omite-extremos-del-intervalo · extremos-absolutos · hallas el punto crítico y lo das por extremo absoluto sin comparar con los valores en los extremos del intervalo
mc: solo-evalua-extremos · extremos-absolutos · evalúas la función solo en los extremos del intervalo y no buscas los puntos críticos
mc: extremo-por-posicion · extremos-absolutos · eliges un extremo del intervalo sin evaluar la función, porque supones que el máximo siempre está en un borde
mc: critico-implica-maximo · extremos-locales · crees que todo punto crítico es un máximo sin aplicar ningún criterio
mc: confunde-critico-con-inflexion · extremos-locales · confundes el punto donde f' = 0 con el punto donde f'' = 0
mc: local-por-absoluto · extremos-locales · das por absoluto un extremo local sin mirar el comportamiento de la función en el resto del dominio
mc: criterio-segunda-invertido · extremos-locales · inviertes el criterio de la segunda derivada: f'' > 0 te da un máximo
mc: derivada-cero-es-creciente · extremos-locales · lees f'(c) = 0 como si la función estuviera creciendo en c
mc: lhopital-sin-indeterminacion · lhopital · aplicas L'Hôpital sin comprobar que el límite es una indeterminación 0/0 o ∞/∞
mc: critico-fuera-del-intervalo · extremos-absolutos · incluyes un punto crítico que no está en el intervalo dado y comparas su valor con los demás
mc: da-abscisa-en-vez-del-valor · extremos-absolutos · das la x donde ocurre el extremo cuando la pregunta pide el valor de la función
mc: ignora-derivada-no-existe · extremos-absolutos · solo buscas los puntos donde f' = 0 y pasas por alto los puntos del intervalo donde f no es derivable
mc: tvm-sin-verificar-hipotesis · teorema-valor-medio · aplicas Rolle o el teorema del valor medio sin comprobar la continuidad en el intervalo cerrado y la derivabilidad en el abierto
mc: c-fuera-del-intervalo · teorema-valor-medio · despejas c de la ecuación y aceptas una solución que no está en el intervalo abierto (a, b)
mc: tvm-como-rolle · teorema-valor-medio · exiges f'(c) = 0 o f(a) = f(b) en el teorema del valor medio, como si fuera el de Rolle
mc: c-punto-medio · teorema-valor-medio · supones que el punto c que garantiza el teorema es el punto medio del intervalo
mc: hipotesis-falla-no-hay-c · teorema-valor-medio · crees que si una hipótesis del teorema falla, ya no existe ningún punto con esa derivada
mc: segunda-cero-sin-salida · extremos-locales · cuando f''(c) = 0 concluyes que no se puede decidir, sin mirar el signo de f' a los lados de c
mc: inflexion-por-segunda-cero · concavidad-inflexion · llamas punto de inflexión a todo punto donde f'' = 0, sin comprobar que f'' cambia de signo
mc: concavidad-por-crecimiento · concavidad-inflexion · confundes la concavidad con el crecimiento: dices que f es cóncava hacia arriba donde crece y cóncava hacia abajo donde decrece
mc: signo-segunda-invertido · concavidad-inflexion · lees f'' > 0 como cóncava hacia abajo y f'' < 0 como cóncava hacia arriba
mc: inflexion-fuera-dominio · concavidad-inflexion · das como inflexión un punto donde f'' cambia de signo pero f no está definida
mc: cociente-en-lhopital · lhopital · derivas el cociente completo con la regla del cociente en vez de derivar numerador y denominador por separado
mc: deriva-solo-una-parte · lhopital · derivas solo el numerador o solo el denominador y dejas la otra parte sin derivar
mc: lhopital-cociente-invertido · lhopital · después de derivar escribes la derivada del denominador sobre la del numerador, en vez de numerador sobre denominador
mc: cero-por-infinito-sin-reescribir · lhopital · en una forma 0·∞ derivas cada factor por separado o la tomas como 0, sin escribirla como cociente
mc: uno-a-infinito-es-uno · lhopital · tomas una forma 1^∞ como 1 porque la base tiende a 1
mc: olvida-deshacer-logaritmo · lhopital · en una forma 1^∞ calculas el límite del logaritmo y lo das como respuesta, sin elevar e a ese valor
mc: intervalos-crecimiento-con-concavidad · trazado-curvas · usas el signo de f'' para decir dónde crece f y el de f' para decir dónde es cóncava
mc: omite-asintota-vertical · trazado-curvas · describes la gráfica con su asíntota horizontal y olvidas la asíntota vertical en un cero del denominador
mc: vertical-en-borde-del-dominio · trazado-curvas · marcas una asíntota vertical en el borde del dominio sin calcular el límite, aunque la función tiende a un número finito
mc: inflexion-donde-primera-cero · concavidad-inflexion · buscas los cambios de concavidad donde f' = 0, en vez de donde f'' cambia de signo
mc: concavidad-invertida-al-trazar · trazado-curvas · al describir la gráfica lees f'' > 0 como cóncava hacia abajo y f'' < 0 como cóncava hacia arriba
mc: maximo-minimo-invertidos-al-trazar · trazado-curvas · al describir la gráfica cambias máximos por mínimos: lees f'' < 0 en un punto crítico como mínimo
mc: inflexion-en-critico-al-trazar · trazado-curvas · al describir la gráfica pones la inflexión en el punto donde f' = 0
mc: inflexion-en-asintota · trazado-curvas · das como inflexión un punto donde f'' cambia de signo pero f no está definida, como en una asíntota vertical

## Preguntas

### P7 · dificultad 2 · kc: extremos-locales · revisada · origen: humano · revisó: prototipo · ⚠ revisar
f(x) = x³ - 3x tiene un punto crítico en x = 1. ¿Qué tipo de punto es?

- A) Mínimo local · CORRECTA
- B) Máximo local · [critico-implica-maximo]
- C) Punto de inflexión · [confunde-critico-con-inflexion]
- D) Máximo absoluto · [local-por-absoluto]

### P8 · dificultad 2 · kc: extremos-absolutos · retirada · origen: humano · revisó: prototipo
Encuentra el máximo de h(x) = -x² + 4x en [0, 5].

- A) En x = 2, h(2) = 4 · CORRECTA
- B) En x = 2, porque es punto crítico · [omite-extremos-del-intervalo]
- C) En x = 5, h(5) = 5 · [solo-evalua-extremos]
- D) En x = 0, porque es el inicio del intervalo · [extremo-por-posicion]

### P9 · dificultad 2 · kc: extremos-locales · revisada · origen: humano · revisó: prototipo · ⚠ revisar
Si f'(c) = 0 y f''(c) > 0, entonces x = c es:

- A) Mínimo local · CORRECTA
- B) Máximo local · [criterio-segunda-invertido]
- C) Necesariamente el mínimo absoluto · [local-por-absoluto]
- D) Un punto donde f es creciente · [derivada-cero-es-creciente]

### P86 · dificultad 1 · kc: extremos-absolutos · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04
Halla el valor mínimo absoluto de f(x) = x² − 6x en el intervalo [4, 8].

- A) 16 · [extremo-por-posicion] eliges el borde derecho, x = 8, porque supones que el mínimo siempre está en un extremo del intervalo, y calculas f(8) = 16
- B) −9 · [critico-fuera-del-intervalo] tomas el vértice x = 3 como punto crítico sin notar que no está en [4, 8], y das f(3) = −9
- C) −8 · CORRECTA
- D) 4 · [da-abscisa-en-vez-del-valor] das la x donde ocurre el mínimo, x = 4, en lugar del valor f(4)

solución: f'(x) = 2x − 6 = 0 cuando x = 3, pero 3 no está en [4, 8], así que no cuenta. Quedan solo los extremos del intervalo: f(4) = 16 − 24 = −8 y f(8) = 64 − 48 = 16. El menor es −8 (f es creciente en todo [4, 8]). La opción de 16 es el valor en el borde derecho elegido sin comparar; −9 es el valor en el vértice, que está fuera del intervalo; 4 es la posición del mínimo, no su valor.

### P87 · dificultad 2 · kc: extremos-absolutos · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04
Halla el valor mínimo absoluto de f(x) = x³ − 12x en el intervalo [0, 3].

- A) −16 · CORRECTA
- B) −9 · [solo-evalua-extremos] evalúas f solo en los extremos, f(0) = 0 y f(3) = −9, y te quedas con el menor sin buscar los puntos críticos
- C) 0 · [extremo-por-posicion] eliges el borde izquierdo porque supones que el mínimo siempre está en un extremo, y das f(0) = 0
- D) 2 · [da-abscisa-en-vez-del-valor] das la x donde ocurre el mínimo, x = 2, en lugar del valor de f en ese punto

solución: f'(x) = 3x² − 12 = 3(x − 2)(x + 2), con ceros x = 2 y x = −2. Solo x = 2 está en [0, 3]. Se comparan f(0) = 0, f(2) = 8 − 24 = −16 y f(3) = 27 − 36 = −9. El mínimo absoluto es −16. Con solo los extremos se obtiene −9, que no es el menor; 0 es el valor en el borde izquierdo sin comparar; 2 es el lugar del mínimo, no su valor.

### P88 · dificultad 2 · kc: extremos-absolutos · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04
Halla el valor mínimo absoluto de $f(x) = \frac{x}{x^2+1}$ en el intervalo [0, 3].

- A) $\frac{1}{2}$ · [omite-extremos-del-intervalo] hallas el punto crítico x = 1 y das f(1) como mínimo sin compararlo con los valores en los extremos
- B) $-\frac{1}{2}$ · [critico-fuera-del-intervalo] incluyes el punto crítico x = −1, que no está en [0, 3], y das f(−1)
- C) $\frac{3}{10}$ · [extremo-por-posicion] eliges el borde derecho porque supones que el mínimo siempre está en un extremo, y das f(3)
- D) 0 · CORRECTA

solución: f'(x) = (1 − x²)/(x² + 1)², que se anula en x = 1 y x = −1; solo x = 1 está en [0, 3]. Se comparan f(0) = 0, f(1) = 1/2 y f(3) = 3/10. El menor es 0, en x = 0. El valor 1/2 es el del punto crítico, que en realidad es el máximo; −1/2 sale de un punto fuera del intervalo; 3/10 es el valor en el borde derecho elegido sin comparar.

### P89 · dificultad 3 · kc: extremos-absolutos · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04
Halla el valor mínimo absoluto de f(x) = |x² − 2x| en el intervalo [−2, 3].

- A) 3 · [solo-evalua-extremos] evalúas f solo en los extremos, f(−2) = 8 y f(3) = 3, y te quedas con el menor sin buscar otros candidatos
- B) 0 · CORRECTA
- C) 1 · [ignora-derivada-no-existe] resuelves f'(x) = 0, obtienes x = 1, y comparas f(1) = 1 con los extremos, sin ver que f no es derivable en x = 0 y x = 2
- D) 8 · [extremo-por-posicion] eliges el borde izquierdo porque supones que el extremo siempre está en un borde, y das f(−2)

solución: x² − 2x = x(x − 2) cambia de signo en x = 0 y x = 2, así que en esos puntos la gráfica tiene esquinas y f' no existe; son candidatos. Entre 0 y 2, f(x) = 2x − x² y f'(x) = 2 − 2x se anula en x = 1. Candidatos: f(−2) = 8, f(0) = 0, f(1) = 1, f(2) = 0, f(3) = 3. El mínimo absoluto es 0, en x = 0 y en x = 2. Con solo los extremos sale 3; si se ignoran las esquinas sale 1; 8 es el valor en el borde izquierdo sin comparar.

### P90 · dificultad 1 · kc: teorema-valor-medio · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04
Para f(x) = x³ en el intervalo [0, 3], ¿qué valor de c garantiza el teorema del valor medio?

- A) $\frac{3}{2}$ · [c-punto-medio] supones que c es el punto medio del intervalo
- B) $\sqrt{3}$ · CORRECTA
- C) $-\sqrt{3}$ · [c-fuera-del-intervalo] despejas c² = 3 y aceptas también la raíz negativa, que no está en (0, 3)
- D) 0 · [tvm-como-rolle] planteas f'(c) = 0 como en el teorema de Rolle, aunque f(0) ≠ f(3)

solución: f es un polinomio, así que es continua en [0, 3] y derivable en (0, 3). La pendiente de la secante es (f(3) − f(0))/(3 − 0) = 27/3 = 9. Se resuelve f'(c) = 3c² = 9, o sea c² = 3 y c = ±√3. Solo √3 ≈ 1,73 está en (0, 3). El punto medio 3/2 no cumple f'(3/2) = 27/4 ≠ 9; −√3 queda fuera del intervalo; c = 0 resolvería f'(c) = 0, que es la condición de Rolle y además 0 no está en el intervalo abierto.

### P91 · dificultad 2 · kc: teorema-valor-medio · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04
Sea f(x) = x² si x < 1 y f(x) = x² + 1 si x ≥ 1. Se quiere usar el teorema del valor medio en [0, 2]. ¿Cuál afirmación es correcta?

- A) El teorema se aplica sin problema, porque f es un polinomio a cada lado de x = 1, y garantiza un c con $f'(c) = \frac{5}{2}$ · [tvm-sin-verificar-hipotesis] no compruebas que f sea continua en todo el intervalo cerrado
- B) El teorema no se puede aplicar, y por eso ningún punto cumple $f'(c) = \frac{5}{2}$ · [hipotesis-falla-no-hay-c] crees que si falla una hipótesis ya no existe el punto
- C) El teorema no se puede aplicar porque f(0) ≠ f(2), y el teorema exige que los valores en los extremos sean iguales · [tvm-como-rolle] exiges f(a) = f(b), que es una hipótesis de Rolle y no del valor medio
- D) El teorema no se puede aplicar porque f no es continua en x = 1, aunque sí existe un c con $f'(c) = \frac{5}{2}$ · CORRECTA

solución: en x = 1 hay un salto: el límite por la izquierda es 1 y el límite por la derecha es 2, así que f no es continua en [0, 2] y el teorema no se puede aplicar. Pero que falle la hipótesis no impide que la conclusión se cumpla: la pendiente de la secante es (f(2) − f(0))/2 = 5/2 y en (1, 2) se tiene f'(x) = 2x = 5/2 para x = 5/4, que está en el intervalo. El teorema del valor medio no pide f(a) = f(b); eso es Rolle.

### P92 · dificultad 2 · kc: teorema-valor-medio · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04
Para f(x) = x³ − 3x en el intervalo [0, 4], ¿qué valor de c garantiza el teorema del valor medio?

- A) $\frac{4\sqrt{3}}{3}$ · CORRECTA
- B) $-\frac{4\sqrt{3}}{3}$ · [c-fuera-del-intervalo] despejas c² = 16/3 y aceptas también la raíz negativa, que no está en (0, 4)
- C) 2 · [c-punto-medio] supones que c es el punto medio del intervalo
- D) 1 · [tvm-como-rolle] planteas f'(c) = 0 como en el teorema de Rolle y resuelves 3c² − 3 = 0

solución: f es un polinomio, continua en [0, 4] y derivable en (0, 4). La pendiente de la secante es (f(4) − f(0))/4 = (52 − 0)/4 = 13. Se resuelve f'(c) = 3c² − 3 = 13, o sea c² = 16/3 y c = ±4/√3 = ±4√3/3. Solo el positivo, ≈ 2,31, está en (0, 4). El punto medio 2 da f'(2) = 9 ≠ 13; c = 1 sale de f'(c) = 0, condición de Rolle que aquí no corresponde porque f(0) ≠ f(4); la raíz negativa queda fuera del intervalo.

### P93 · dificultad 3 · kc: teorema-valor-medio · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04
Sea h(x) = |x| − x² en el intervalo [−1, 1]. Se observa que h(−1) = h(1) = 0. ¿Cuál afirmación es correcta?

- A) El teorema de Rolle no se puede aplicar porque h no es derivable en x = 0, pero sí existen puntos con h'(c) = 0, por ejemplo $c = \frac{1}{2}$ · CORRECTA
- B) El teorema de Rolle se aplica, porque h es continua en [−1, 1] y h(−1) = h(1), y garantiza un c con h'(c) = 0 · [tvm-sin-verificar-hipotesis] no compruebas la derivabilidad en el intervalo abierto
- C) El teorema de Rolle no se puede aplicar, así que ningún punto cumple h'(c) = 0 · [hipotesis-falla-no-hay-c] crees que si falla una hipótesis ya no existe el punto
- D) El teorema de Rolle se aplica y el punto que garantiza es c = 0, el punto medio del intervalo · [c-punto-medio] supones que c es el punto medio

solución: h es continua en [−1, 1] y h(−1) = h(1) = 0, pero en x = 0 la gráfica tiene una esquina (h'(x) = 1 − 2x a la derecha y −1 − 2x a la izquierda), así que h no es derivable en todo (−1, 1) y Rolle no se puede aplicar. Eso no impide que la conclusión se cumpla: para x > 0, h'(x) = 1 − 2x = 0 en x = 1/2, y para x < 0, h'(x) = −1 − 2x = 0 en x = −1/2. En c = 0 la derivada ni siquiera existe, así que no es el punto buscado.

### P94 · dificultad 1 · kc: extremos-locales · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04
La función f(x) = x³ − 12x tiene puntos críticos en x = −2 y x = 2. ¿Qué ocurre en x = −2?

- A) Hay un mínimo local · [criterio-segunda-invertido] ves f''(−2) = −12 < 0 y lo lees como mínimo
- B) Hay un punto de inflexión · [confunde-critico-con-inflexion] tomas el punto crítico como punto de inflexión, porque confundes el cero de f' con el cero de f''
- C) La función es creciente en x = −2 · [derivada-cero-es-creciente] lees f'(−2) = 0 como si f estuviera creciendo en ese punto
- D) Hay un máximo local · CORRECTA

solución: f'(x) = 3x² − 12 = 3(x − 2)(x + 2) y f''(x) = 6x. En x = −2, f''(−2) = −12 < 0, así que hay un máximo local (con f(−2) = 16). Si se invierte el criterio, el signo negativo se lee como mínimo; la inflexión ocurre donde f'' = 0, es decir en x = 0, no en un punto donde f' = 0; y en un punto crítico la tangente es horizontal, la función no está creciendo ni decreciendo en ese punto.

### P95 · dificultad 3 · kc: extremos-locales · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04
La función g(x) = (x − 1)⁴ + 2 tiene un punto crítico en x = 1, y allí g''(1) = 0. ¿Qué se puede concluir en x = 1?

- A) Hay un mínimo local, porque g' pasa de negativa a positiva en x = 1 · CORRECTA
- B) Hay un punto de inflexión, porque g''(1) = 0 · [confunde-critico-con-inflexion] tomas el punto crítico como punto de inflexión sin revisar si g'' cambia de signo
- C) Hay un máximo local, porque es un punto crítico y g'' no es positiva · [critico-implica-maximo] lees todo punto crítico como máximo sin aplicar un criterio
- D) No se puede decidir, porque el criterio de la segunda derivada no da información cuando g'' = 0 · [segunda-cero-sin-salida] te detienes cuando g''(1) = 0, sin probar el criterio de la primera derivada

solución: g'(x) = 4(x − 1)³ y g''(x) = 12(x − 1)², con g''(1) = 0, así que el criterio de la segunda derivada no decide. Se usa el de la primera: si x < 1, g'(x) < 0, y si x > 1, g'(x) > 0, de modo que g pasa de decrecer a crecer y x = 1 es un mínimo local. No es inflexión: g'' = 12(x − 1)² es no negativa a ambos lados, no cambia de signo. Tampoco es máximo, y "no se puede decidir" es falso porque otro criterio sí decide.

### P96 · dificultad 1 · kc: concavidad-inflexion · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04
¿Cuál de estas condiciones basta para que la gráfica de f tenga un punto de inflexión en x = c?

- A) Que f''(c) = 0 · [inflexion-por-segunda-cero] llamas inflexión a todo punto donde f'' se anula, sin pedir que cambie de signo
- B) Que f sea continua en c y que f'' cambie de signo en c · CORRECTA
- C) Que f'(c) = 0 · [inflexion-donde-primera-cero] confundes el punto donde f' = 0 con el punto donde f'' cambia de signo
- D) Que f'' cambie de signo en c, aunque f no esté definida en c · [inflexion-fuera-dominio] aceptas como inflexión un punto donde la función no existe

solución: un punto de inflexión es un punto de la gráfica donde la concavidad cambia. Para eso f debe ser continua en c (hay un punto de la gráfica y la curva no salta allí) y f'' debe cambiar de signo en c. Que f''(c) = 0 no basta: x⁴ en x = 0 tiene f'' = 0 y no cambia de concavidad. Que f'(c) = 0 habla de tangente horizontal, es decir, de puntos críticos. Y un cambio de signo de f'' en un punto fuera del dominio (como en 1/x, en x = 0) no genera ningún punto de la gráfica, y por eso tampoco hay continuidad en c.

### P97 · dificultad 2 · kc: concavidad-inflexion · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04
Sea f(x) = x⁴ − 6x². ¿En qué intervalo es f cóncava hacia abajo?

- A) (−∞, −1) ∪ (1, ∞) · [signo-segunda-invertido] lees f'' > 0 como cóncava hacia abajo
- B) $(-\sqrt{3}, \sqrt{3})$ · [inflexion-donde-primera-cero] partes la recta con los ceros de f' (x = 0 y x = ±√3) en lugar de los ceros de f'', y tomas el tramo central
- C) (−1, 1) · CORRECTA
- D) $(-\infty, -\sqrt{3})$ ∪ $(0, \sqrt{3})$ · [concavidad-por-crecimiento] das los intervalos donde f decrece, como si decrecer fuera lo mismo que ser cóncava hacia abajo

solución: f'(x) = 4x³ − 12x y f''(x) = 12x² − 12 = 12(x − 1)(x + 1). f'' es negativa solo entre −1 y 1, así que f es cóncava hacia abajo en (−1, 1) y hacia arriba en (−∞, −1) y (1, ∞). La opción A invierte el signo; B usa los ceros de f' en lugar de los de f''; D son los intervalos de decrecimiento, que se obtienen con f' y no con f''.

### P98 · dificultad 2 · kc: concavidad-inflexion · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04
Sea $f(x) = \frac{1}{x-1}$. ¿Cuál descripción de su concavidad es correcta?

- A) Cóncava hacia abajo en (−∞, 1) y hacia arriba en (1, ∞), con un punto de inflexión en x = 1 · [inflexion-fuera-dominio] das como inflexión el punto donde f'' cambia de signo aunque f no está definida allí
- B) Cóncava hacia arriba en (−∞, 1) y hacia abajo en (1, ∞), sin puntos de inflexión · [signo-segunda-invertido] lees f'' > 0 como cóncava hacia abajo y f'' < 0 como cóncava hacia arriba
- C) Cóncava hacia abajo en todo su dominio, porque f es decreciente en cada tramo · [concavidad-por-crecimiento] confundes decrecer con ser cóncava hacia abajo
- D) Cóncava hacia abajo en (−∞, 1) y hacia arriba en (1, ∞), sin puntos de inflexión · CORRECTA

solución: f'(x) = −1/(x − 1)² y f''(x) = 2/(x − 1)³. Si x < 1, f''(x) < 0 y f es cóncava hacia abajo; si x > 1, f''(x) > 0 y es cóncava hacia arriba. f'' nunca vale 0, y el único cambio de signo ocurre en x = 1, donde f no está definida; por eso no hay punto de inflexión. La opción A llama inflexión a ese punto; B invierte los signos; C usa el hecho de que f' < 0 en todo el dominio, que describe el crecimiento y no la concavidad.

### P99 · dificultad 3 · kc: concavidad-inflexion · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04
Sea f(x) = 3x⁵ − 10x⁴. ¿Cuál es la descripción correcta de sus puntos de inflexión y su concavidad?

- A) Dos puntos de inflexión, x = 0 y x = 2 · [inflexion-por-segunda-cero] llamas inflexión a x = 0 solo porque f''(0) = 0, sin ver que f'' no cambia de signo allí
- B) Un solo punto de inflexión, x = 2; cóncava hacia abajo en (−∞, 2) y hacia arriba en (2, ∞) · CORRECTA
- C) Un solo punto de inflexión, x = 2; cóncava hacia arriba en (−∞, 2) y hacia abajo en (2, ∞) · [signo-segunda-invertido] lees f'' > 0 como cóncava hacia abajo y f'' < 0 como cóncava hacia arriba
- D) Un solo punto de inflexión, x = 8/3, donde f pasa de decrecer a crecer · [inflexion-donde-primera-cero] tomas el cero de f' como el punto donde cambia la concavidad

solución: f'(x) = 15x⁴ − 40x³ = 5x³(3x − 8) y f''(x) = 60x³ − 120x² = 60x²(x − 2). Los ceros de f'' son x = 0 y x = 2. Como x² ≥ 0, el signo de f'' es el de (x − 2) salvo en x = 0: es negativo a ambos lados de 0 (por ejemplo f''(−1) = −180 y f''(1) = −60) y positivo para x > 2 (f''(3) = 540). Entonces f'' no cambia de signo en 0, y ahí no hay inflexión aunque f''(0) = 0; sí cambia en 2. Así, f es cóncava hacia abajo en (−∞, 2) y hacia arriba en (2, ∞). La opción A cuenta x = 0 como inflexión; C invierte el signo de f''; D usa el cero de f' (x = 8/3, un mínimo local), que no es donde cambia la concavidad.

### P100 · dificultad 1 · kc: lhopital · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04
Al calcular $\lim_{x\to 0}\frac{e^{2x}-1}{\sen 4x}$ con la regla de L'Hôpital, ¿qué límite hay que calcular después de aplicarla una vez?

- A) $\lim_{x\to 0}\frac{2e^{2x}\sen 4x - 4(e^{2x}-1)\cos 4x}{\sen^2 4x}$ · [cociente-en-lhopital] derivas el cociente completo con la regla del cociente en lugar de derivar numerador y denominador por separado
- B) $\lim_{x\to 0}\frac{4\cos 4x}{2e^{2x}}$ · [lhopital-cociente-invertido] escribes la derivada del denominador sobre la del numerador
- C) $\lim_{x\to 0}\frac{2e^{2x}}{4\cos 4x}$ · CORRECTA
- D) $\lim_{x\to 0}\frac{2e^{2x}}{\sen 4x}$ · [deriva-solo-una-parte] derivas solo el numerador y dejas el denominador sin derivar

solución: al sustituir x = 0 queda 0/0, así que L'Hôpital aplica. Se deriva por separado el numerador, (e^{2x} − 1)' = 2e^{2x}, y el denominador, (sen 4x)' = 4cos 4x, y se calcula el límite de ese cociente: 2/(4) = 1/2. La opción A es la derivada del cociente, que es otra cosa; B invierte el cociente; D deja sen 4x sin derivar.

### P101 · dificultad 2 · kc: lhopital · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04
Calcula $\lim_{x\to 0}\frac{\sen 3x}{x+2}$

- A) 3 · [lhopital-sin-indeterminacion] aplicas L'Hôpital sin comprobar que el denominador no tiende a 0, y calculas 3cos 0/1
- B) 0 · CORRECTA
- C) $\frac{3}{2}$ · [deriva-solo-una-parte] derivas solo el numerador y dejas x + 2 sin derivar
- D) $\frac{1}{3}$ · [lhopital-cociente-invertido] aplicas L'Hôpital sin necesidad y además escribes la derivada del denominador sobre la del numerador

solución: al sustituir x = 0 el numerador es sen 0 = 0 y el denominador es 0 + 2 = 2, así que el límite no es una indeterminación: es 0/2 = 0 por continuidad. L'Hôpital solo se usa con 0/0 o ∞/∞. Si se aplicara de todos modos se obtendría 3cos 3x/1, que tiende a 3, un valor falso. Derivar solo el numerador da 3cos 0/2 = 3/2, y el cociente invertido de derivadas daría 1/(3cos 0) = 1/3.

### P102 · dificultad 2 · kc: lhopital · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04
Calcula $\lim_{x\to 0}(1+3x)^{2/x}$

- A) 1 · [uno-a-infinito-es-uno] ves que la base tiende a 1 y concluyes que toda la potencia tiende a 1
- B) 6 · [olvida-deshacer-logaritmo] calculas el límite de ln L = 6 y lo das como respuesta, sin elevar e a ese valor
- C) 0 · [cero-por-infinito-sin-reescribir] escribes ln L = (2/x)·ln(1 + 3x) como 0·∞ y derivas cada factor por separado, lo que da ln L = −∞ y L = 0
- D) e⁶ · CORRECTA

solución: es una forma 1^∞. Sea L el límite; entonces ln L = lim (2/x)·ln(1 + 3x) = lim 2 ln(1 + 3x)/x, que es 0/0. Por L'Hôpital: lim 2·(3/(1 + 3x))/1 = 6. Como ln L = 6, L = e⁶. Dejar 1 ignora que la base se acerca a 1 mientras el exponente crece; 6 es el valor de ln L y no de L; derivar los factores por separado en la forma 0·∞ da −∞ y de ahí L = 0, pero la regla pide pasar a cociente.

### P103 · dificultad 3 · kc: lhopital · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04
Calcula $\lim_{x\to 0}(\cos x + \sen 3x)^{1/x}$

- A) e³ · CORRECTA
- B) 1 · [uno-a-infinito-es-uno] ves que la base tiende a cos 0 + sen 0 = 1 y concluyes que toda la potencia tiende a 1
- C) 3 · [olvida-deshacer-logaritmo] calculas el límite de ln L = 3 y lo das como respuesta, sin elevar e a ese valor
- D) 0 · [cero-por-infinito-sin-reescribir] escribes ln L = (1/x)·ln(cos x + sen 3x) como 0·∞ y derivas cada factor por separado, lo que da ln L = −∞ y L = 0

solución: la base tiende a 1 y el exponente 1/x tiende a infinito: forma 1^∞. Sea L el límite; entonces ln L = lim ln(cos x + sen 3x)/x, que es 0/0. Por L'Hôpital: lim (−sen x + 3cos 3x)/(cos x + sen 3x) = (0 + 3)/(1 + 0) = 3. Luego ln L = 3 y L = e³. Quedarse con 1 es tomar 1^∞ como 1; dar 3 es olvidar que ese valor es el del logaritmo; el 0 sale de derivar por separado los factores (1/x) y ln(cos x + sen 3x) en la forma 0·∞, que da −∞.

### P104 · dificultad 1 · kc: trazado-curvas · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04
La función f(x) = x³ − 3x tiene f'(x) = 3(x² − 1) y f''(x) = 6x. ¿Cuál descripción corresponde a la gráfica de f?

- A) Crece en (−∞, −1) y (1, ∞) y decrece en (−1, 1); es cóncava hacia arriba para x < 0 y hacia abajo para x > 0 · [concavidad-invertida-al-trazar] lees f'' > 0 como cóncava hacia abajo y f'' < 0 como cóncava hacia arriba
- B) Crece en (−∞, −1) y (1, ∞) y decrece en (−1, 1); es cóncava hacia abajo para x < 0 y hacia arriba para x > 0 · CORRECTA
- C) Crece para x > 0 y decrece para x < 0; es cóncava hacia arriba en (−∞, −1) y (1, ∞) y hacia abajo en (−1, 1) · [intervalos-crecimiento-con-concavidad] usas el signo de f'' para el crecimiento y el de f' para la concavidad
- D) Crece en (−1, 1) y decrece en (−∞, −1) y (1, ∞); es cóncava hacia abajo para x < 0 y hacia arriba para x > 0 · [maximo-minimo-invertidos-al-trazar] inviertes el criterio de la segunda derivada: f''(−1) < 0 te da un mínimo y f''(1) > 0 un máximo

solución: f'(x) = 3(x − 1)(x + 1) es positiva si x < −1 o x > 1, y negativa en (−1, 1): f crece, decrece y vuelve a crecer, con máximo local en x = −1 (f''(−1) = −6 < 0) y mínimo local en x = 1 (f''(1) = 6 > 0). f''(x) = 6x es negativa si x < 0 y positiva si x > 0: cóncava hacia abajo a la izquierda de 0 y hacia arriba a la derecha, con inflexión en el origen. En C se intercambian los papeles de f' y f''; en A se invierte el signo de f''; en D se invierte el criterio de la segunda derivada y por eso el crecimiento sale al revés.

### P105 · dificultad 2 · kc: trazado-curvas · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04
Sea $f(x) = \frac{3x}{x-2}$. Se tiene $f'(x) = \frac{-6}{(x-2)^2}$ y $f''(x) = \frac{12}{(x-2)^3}$. ¿Cuál descripción corresponde a la gráfica de f?

- A) Solo tiene la asíntota horizontal y = 3; decrece en (−∞, 2) y en (2, ∞); es cóncava hacia abajo en (−∞, 2) y hacia arriba en (2, ∞) · [omite-asintota-vertical] olvidas la asíntota vertical en el cero del denominador
- B) Asíntotas x = 2 y y = 3; decrece en (−∞, 2) y en (2, ∞); es cóncava hacia arriba en (−∞, 2) y hacia abajo en (2, ∞) · [concavidad-invertida-al-trazar] lees f'' > 0 como cóncava hacia abajo y f'' < 0 como cóncava hacia arriba
- C) Asíntotas x = 2 y y = 3; decrece en (−∞, 2) y en (2, ∞); es cóncava hacia abajo en (−∞, 2) y hacia arriba en (2, ∞) · CORRECTA
- D) Asíntotas x = 2 y y = 3; decrece en (−∞, 2) y crece en (2, ∞); es cóncava hacia abajo en todo su dominio · [intervalos-crecimiento-con-concavidad] usas el signo de f'' para el crecimiento y el de f' para la concavidad

solución: el denominador se anula en x = 2 y el numerador no, y lim 3x/(x − 2) cuando x tiende a 2 por un lado es +∞ y por el otro −∞: asíntota vertical x = 2. Cuando x tiende a ±∞ el cociente tiende a 3: asíntota horizontal y = 3. f'(x) = −6/(x − 2)² es negativa en todo el dominio: f decrece en (−∞, 2) y en (2, ∞). f''(x) = 12/(x − 2)³ es negativa si x < 2 y positiva si x > 2: cóncava hacia abajo a la izquierda de 2 y hacia arriba a la derecha. En A falta la asíntota vertical; B invierte el signo de f''; D lee el crecimiento en f'' (negativa y luego positiva) y la concavidad en f' (negativa siempre).

### P106 · dificultad 2 · kc: trazado-curvas · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04
Sea f(x) = x ln x, definida para x > 0. Se tiene f'(x) = ln x + 1 y f''(x) = 1/x. ¿Cuál descripción corresponde a la gráfica de f?

- A) Decrece en $(0, \frac{1}{e})$ y crece en $(\frac{1}{e}, \infty)$; es cóncava hacia arriba en todo su dominio y no tiene asíntotas · CORRECTA
- B) Decrece en $(0, \frac{1}{e})$ y crece en $(\frac{1}{e}, \infty)$; es cóncava hacia arriba en todo su dominio y tiene la asíntota vertical x = 0 · [vertical-en-borde-del-dominio] marcas asíntota vertical en el borde del dominio sin calcular que f(x) tiende a 0
- C) Decrece en $(0, \frac{1}{e})$ y crece en $(\frac{1}{e}, \infty)$; es cóncava hacia abajo en $(0, \frac{1}{e})$ y hacia arriba después, con inflexión en $x = \frac{1}{e}$ · [inflexion-en-critico-al-trazar] tomas el punto donde f' = 0 como el punto donde cambia la concavidad
- D) Decrece en $(0, \frac{1}{e})$ y crece en $(\frac{1}{e}, \infty)$; es cóncava hacia abajo en todo su dominio y no tiene asíntotas · [concavidad-invertida-al-trazar] lees f'' > 0 como cóncava hacia abajo

solución: f'(x) = ln x + 1 se anula en x = 1/e; es negativa para 0 < x < 1/e y positiva después: f decrece y luego crece, con mínimo en x = 1/e. f''(x) = 1/x es positiva en todo el dominio: cóncava hacia arriba siempre, sin inflexión. Cuando x tiende a 0 por la derecha, x ln x tiende a 0 (se resuelve con L'Hôpital sobre ln x/(1/x)): no hay asíntota vertical. Cuando x tiende a ∞, f(x) crece sin límite y f(x)/x = ln x también, así que no hay asíntota horizontal ni oblicua. La opción B inventa una asíntota vertical; C parte la concavidad en el punto crítico; D invierte el signo de f''.

### P107 · dificultad 3 · kc: trazado-curvas · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04
Sea $f(x) = \frac{x^2}{x^2-4}$. Se tiene $f'(x) = \frac{-8x}{(x^2-4)^2}$ y $f''(x) = \frac{24x^2+32}{(x^2-4)^3}$. ¿Cuál descripción corresponde a la gráfica de f?

- A) Solo tiene la asíntota horizontal y = 1; crece en (−∞, −2) y (−2, 0) y decrece en (0, 2) y (2, ∞); máximo local en (0, 0); cóncava hacia abajo en (−2, 2) y hacia arriba fuera de [−2, 2]; sin puntos de inflexión · [omite-asintota-vertical] olvidas las asíntotas verticales en los ceros del denominador
- B) Asíntotas x = −2, x = 2 y y = 1; crece en (−∞, −2) y (−2, 0) y decrece en (0, 2) y (2, ∞); máximo local en (0, 0); cóncava hacia abajo en (−2, 2) y hacia arriba fuera de [−2, 2]; puntos de inflexión en x = −2 y x = 2 · [inflexion-en-asintota] das como inflexión los puntos donde f'' cambia de signo aunque f no está definida allí
- C) Asíntotas x = −2, x = 2 y y = 1; decrece en (−∞, −2) y (−2, 0) y crece en (0, 2) y (2, ∞); mínimo local en (0, 0); cóncava hacia abajo en (−2, 2) y hacia arriba fuera de [−2, 2]; sin puntos de inflexión · [maximo-minimo-invertidos-al-trazar] inviertes el criterio de la segunda derivada: f''(0) < 0 te da un mínimo
- D) Asíntotas x = −2, x = 2 y y = 1; crece en (−∞, −2) y (−2, 0) y decrece en (0, 2) y (2, ∞); máximo local en (0, 0); cóncava hacia abajo en (−2, 2) y hacia arriba fuera de [−2, 2]; sin puntos de inflexión · CORRECTA

solución: el denominador se anula en x = ±2 y el numerador no, así que x = −2 y x = 2 son asíntotas verticales; lim f(x) = 1 cuando x tiende a ±∞ da la horizontal y = 1. f'(x) = −8x/(x² − 4)² tiene el signo de −x: positiva para x < 0 (salvo x = −2) y negativa para x > 0 (salvo x = 2); f crece hasta x = 0 y decrece después, con f'(0) = 0 y f''(0) = 32/(−64) = −1/2 < 0: máximo local en (0, 0). El numerador de f'' es siempre positivo, así que f'' tiene el signo de (x² − 4)³, o sea el de x² − 4: negativa en (−2, 2) y positiva si |x| > 2. Esos cambios de signo ocurren en x = ±2, donde f no está definida, por lo que no hay puntos de inflexión. En A faltan las verticales; B llama inflexión a x = ±2; C lee el signo negativo de f''(0) como mínimo.

### P123 · dificultad 2 · kc: extremos-locales · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04
La función f(x) = x²eˣ tiene puntos críticos en x = −2 y x = 0. ¿Cuál clasificación es correcta?

- A) Máximo local en x = −2 y máximo local en x = 0 · [critico-implica-maximo] lees todo punto crítico como máximo, sin aplicar ningún criterio
- B) Mínimo local en x = −2 y máximo local en x = 0 · [criterio-segunda-invertido] inviertes el criterio de la segunda derivada: f'' < 0 te da un mínimo y f'' > 0 un máximo
- C) Máximo local en x = −2 y mínimo local en x = 0 · CORRECTA
- D) Máximo local en x = −2, que además es el máximo absoluto, y mínimo local en x = 0 · [local-por-absoluto] das por absoluto un extremo local sin mirar el comportamiento de f cuando x crece

solución: f'(x) = (2x + x²)eˣ = x(x + 2)eˣ, con ceros x = −2 y x = 0. Además f''(x) = (x² + 4x + 2)eˣ. En x = −2: f''(−2) = (4 − 8 + 2)e⁻² = −2e⁻² < 0, así que hay un máximo local, con f(−2) = 4e⁻² ≈ 0,54. En x = 0: f''(0) = 2 > 0, así que hay un mínimo local, con f(0) = 0. La opción A toma ambos puntos como máximos; B invierte el signo del criterio; D es falsa porque f(x) = x²eˣ crece sin límite cuando x → ∞ (por ejemplo f(10) ≈ 2,2·10⁶), así que no tiene máximo absoluto.

### P124 · dificultad 2 · kc: extremos-locales · revisada · origen: ia (sonnet-5.5) · revisó: Juzou04
La función f(x) = 3x⁴ − 4x³ tiene puntos críticos en x = 0 y x = 1. ¿Cuál clasificación es correcta?

- A) Máximo local en x = 0 y mínimo local en x = 1 · [critico-implica-maximo] lees x = 0 como máximo porque f'' no es positiva allí, sin mirar el signo de f' a los lados
- B) En x = 0 no hay máximo ni mínimo, y en x = 1 hay un mínimo local · CORRECTA
- C) En x = 0 no se puede decidir porque f''(0) = 0, y en x = 1 hay un mínimo local · [segunda-cero-sin-salida] te detienes cuando f''(0) = 0, sin mirar el signo de f' a los lados de 0
- D) En x = 0 no hay máximo ni mínimo, y en x = 1 hay un punto de inflexión · [confunde-critico-con-inflexion] tomas el punto crítico x = 1 como inflexión, porque confundes el cero de f' con el cero de f''

solución: f'(x) = 12x³ − 12x² = 12x²(x − 1) y f''(x) = 36x² − 24x. En x = 1: f''(1) = 12 > 0, así que hay un mínimo local (f(1) = −1). En x = 0: f''(0) = 0 y el criterio de la segunda derivada no decide, pero se puede usar el de la primera: 12x² ≥ 0 y x − 1 < 0 cerca de 0, así que f'(x) < 0 a ambos lados de 0; f' no cambia de signo y no hay extremo local en x = 0 (la función solo baja). La opción A toma x = 0 como máximo, pero f decrece a ambos lados; C se queda en que el criterio no decide; D llama inflexión a x = 1, pero allí f''(1) = 12 ≠ 0: la inflexión ocurre en los ceros de f'', que son x = 0 y x = 2/3.
