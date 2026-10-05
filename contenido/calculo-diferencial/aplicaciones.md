# Aplicaciones de la derivada

Extremos, teorema del valor medio, concavidad, regla de L'Hôpital y trazado de curvas, con las derivadas de orden superior que usan. Es del Parcial 3 (semanas 9 a 11 del programa). De Precálculo hacen falta las desigualdades y las tablas de signos. Faltan los errores de teorema-valor-medio, concavidad-inflexion y trazado-curvas, y los de lhopital están incompletos.

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
