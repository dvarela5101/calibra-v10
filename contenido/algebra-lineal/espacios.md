# Espacios vectoriales e independencia lineal

Errores que vale la pena cazar: confundir generar con ser linealmente independiente, olvidar que un subespacio tiene que contener el vector cero, y contar mal la dimensión al no verificar que la base sea independiente.

## Habilidades
kc: espacios · Espacios vectoriales e independencia lineal

## Errores
mc: espacios-e1 · espacios · confundes generar el espacio con ser base
mc: espacios-e2 · espacios · olvidas verificar independencia lineal
mc: espacios-e3 · espacios · crees que una base debe contener el vector cero
mc: espacios-e4 · espacios · confundes no contener un vector específico con no ser subespacio
mc: espacios-e5 · espacios · olvidas verificar si el origen satisface la ecuación
mc: espacios-e6 · espacios · generalizas incorrectamente sin verificar el origen
mc: espacios-e7 · espacios · cuentas mal la dimensión olvidando que una base debe ser independiente
mc: espacios-e8 · espacios · asumes sin verificar cuáles son independientes
mc: espacios-e9 · espacios · confundes dependencia lineal con pertenencia al espacio

## Preguntas

### P10 · dificultad 2 · kc: espacios · revisada · origen: humano · revisó: prototipo
¿El conjunto {(1, 0), (0, 1), (1, 1)} forma una base de ℝ²?

- A) No, porque tiene más de 2 vectores (no es linealmente independiente) · CORRECTA
- B) Sí, porque genera ℝ² · [espacios-e1]
- C) Sí, es una base válida · [espacios-e2]
- D) No, porque no contiene el vector cero · [espacios-e3]

### P11 · dificultad 2 · kc: espacios · revisada · origen: humano · revisó: prototipo
Sea S = {(x, y) : 2x + 3y = 0}. ¿S es un subespacio de ℝ²?

- A) Sí, contiene el origen y es cerrado bajo suma y multiplicación escalar · CORRECTA
- B) No, porque no contiene el vector (1, 1) · [espacios-e4]
- C) No, porque la ecuación tiene constantes · [espacios-e5]
- D) Sí, cualquier recta es un subespacio · [espacios-e6]

### P12 · dificultad 2 · kc: espacios · revisada · origen: humano · revisó: prototipo
Si dim(V) = 3 y tenemos 4 vectores en V, ¿qué podemos concluir?

- A) Los 4 vectores son linealmente dependientes · CORRECTA
- B) Los 4 vectores forman una base de V · [espacios-e7]
- C) Exactamente 3 de los 4 vectores son independientes · [espacios-e8]
- D) Los vectores no pertenecen a V · [espacios-e9]

### P16 · dificultad 1 · kc: espacios · borrador · origen: ia (sonnet-5.5)
¿Cuál de los siguientes conjuntos es una base de ℝ²?

- A) {(1, 2), (3, 1)} · CORRECTA
- B) {(2, −3), (−4, 6)} · [espacios-e2] no verificas la independencia lineal: (−4, 6) es −2 veces (2, −3), y los dos vectores son dependientes
- C) {(0, 0), (1, 5)} · [espacios-e3] crees que una base debe contener el vector cero, cuando un conjunto con el vector cero es siempre linealmente dependiente
- D) {(1, 1), (2, 0), (0, 3)} · [espacios-e1] ves que el conjunto genera ℝ² y concluyes que es base, pero tiene tres vectores en un espacio de dimensión 2 y es linealmente dependiente

solución: una base de ℝ² es un conjunto linealmente independiente que genera ℝ². En ℝ² eso pide exactamente 2 vectores cuyo determinante sea distinto de cero. {(1, 2), (3, 1)}: det = 1·1 − 2·3 = −5 ≠ 0, así que es independiente y genera ℝ². {(2, −3), (−4, 6)}: (−4, 6) = −2·(2, −3), luego son dependientes. {(0, 0), (1, 5)}: contiene el vector cero, así que es dependiente y no puede ser base. {(1, 1), (2, 0), (0, 3)} genera ℝ², pero tres vectores en ℝ² son siempre dependientes: −6·(1, 1) + 3·(2, 0) + 2·(0, 3) = (0, 0).
