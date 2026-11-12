# Variables aleatorias conjuntas

Distribuciones conjuntas discretas (tabla) y continuas (densidad): marginales, condicionales, independencia, esperanzas de funciones de dos variables, covarianza y correlación. Corresponde a las sesiones 8 y 9 del programa 2026-2 y es del Parcial 2, semana 16.

## Habilidades
kc: conjunta-marginal · Obtener probabilidades y distribuciones marginales a partir de una distribución conjunta discreta (tabla) o continua (densidad) · prerrequisitos: discretas, continuas
kc: condicional-independencia · Calcular distribuciones y valores esperados condicionales y decidir si dos variables son independientes · prerrequisitos: conjunta-marginal, condicional
kc: covarianza-correlacion · Calcular valores esperados de funciones de dos variables, la covarianza y la correlación, e interpretarlas · prerrequisitos: conjunta-marginal

## Errores
mc: conj-rango-incompleto · conjunta-marginal · sumas o integras solo una parte del rango de la otra variable y dejas fuera el resto
mc: conj-marginal-eje-equivocado · conjunta-marginal · sumas o integras sobre la variable equivocada y obtienes la marginal de la otra variable
mc: conj-producto-de-marginales · conjunta-marginal · multiplicas las marginales para hallar una probabilidad conjunta, como si las variables fueran independientes
mc: conj-constante-sin-normalizar · conjunta-marginal · no impones que la densidad integre 1 y trabajas con la constante sin determinar
mc: conj-limites-fijos-en-triangulo · conjunta-marginal · usas límites constantes en una región triangular, sin dejar que un límite dependa de la otra variable
mc: conj-una-celda-como-marginal · conjunta-marginal · tomas el valor de una sola celda de la tabla como si fuera la probabilidad que te piden
mc: cond-sin-dividir-marginal · condicional-independencia · tomas la conjunta (o su suma ponderada) como si fuera la condicional y no divides entre la marginal
mc: cond-al-reves · condicional-independencia · condicionas al revés y calculas la condicional de la otra variable
mc: cond-ignora-la-condicion · condicional-independencia · ignoras la condición y das la probabilidad o la media marginal en lugar de la condicional
mc: indep-igualdad-en-un-punto · condicional-independencia · concluyes independencia porque la igualdad con el producto de las marginales se cumple en un solo punto o celda
mc: indep-decide-por-la-forma · condicional-independencia · decides la independencia por la forma de la fórmula o de la región, sin comparar la densidad con el producto de las marginales
mc: indep-compara-con-una-marginal · condicional-independencia · comparas la densidad conjunta con una sola marginal en vez de con el producto de las dos
mc: cov-exy-sin-restar-medias · covarianza-correlacion · tomas E[XY] como si fuera la covarianza y no restas E[X]E[Y]
mc: cov-g-en-las-medias · covarianza-correlacion · tratas E[g(X,Y)] como g(E[X],E[Y]), por ejemplo E[XY] como E[X]E[Y] aunque las variables no sean independientes
mc: corr-divide-entre-varianzas · covarianza-correlacion · pasas entre covarianza y correlación con el producto de las varianzas en vez del de las desviaciones estándar
mc: cov-cero-implica-independencia · covarianza-correlacion · crees que una covarianza igual a cero significa que las variables son independientes
mc: cov-signo-mal · covarianza-correlacion · te equivocas de signo: restas E[XY] − E[X]E[Y] al revés o sumas un término que debía restarse

## Preguntas

### P16 · dificultad 1 · kc: conjunta-marginal · borrador · origen: ia (sonnet-5.5)
En una línea de empaque, X es el número de paros de la banda en un turno y Y es el número de rechazos de calidad en ese turno. La distribución conjunta es: p(0,0) = 0,10, p(0,1) = 0,15, p(0,2) = 0,05, p(1,0) = 0,25, p(1,1) = 0,20, p(1,2) = 0,05, p(2,0) = 0,05, p(2,1) = 0,10 y p(2,2) = 0,05. ¿Cuál es P(Y = 1)?

- A) 0,50 · [conj-marginal-eje-equivocado] sumas la fila X = 1 y obtienes P(X = 1) en vez de P(Y = 1)
- B) 0,20 · [conj-una-celda-como-marginal] tomas solo la celda p(1,1) como si fuera la probabilidad de Y = 1
- C) 0,45 · CORRECTA
- D) 0,35 · [conj-rango-incompleto] sumas la columna Y = 1 solo en las filas X = 0 y X = 1 y dejas fuera la fila X = 2

solución: la marginal de Y en y = 1 suma la columna completa sobre todos los valores de X: p(0,1) + p(1,1) + p(2,1) = 0,15 + 0,20 + 0,10 = 0,45. Con la fila X = 1 se obtiene P(X = 1) = 0,50; la celda p(1,1) sola vale 0,20; y sin la fila X = 2 queda 0,35.

### P17 · dificultad 2 · kc: conjunta-marginal · borrador · origen: ia (sonnet-5.5)
Para una bomba, X es el tiempo total de uso (en miles de horas) y Y es el tiempo hasta su primera revisión, con 0 ≤ y ≤ x ≤ 1. La densidad conjunta es f(x,y) = k·x en esa región y cero fuera. Calcula P(Y ≤ 0,5).

- A) 0,6875 · CORRECTA
- B) 0,7500 · [conj-limites-fijos-en-triangulo] integras x de 0 a 1 para hallar la marginal de Y, sin dejar que x arranque en y
- C) 0,1250 · [conj-marginal-eje-equivocado] integras sobre y, obtienes la marginal de X y calculas P(X ≤ 0,5)
- D) 0,2292 · [conj-constante-sin-normalizar] dejas k = 1 sin imponer que la densidad integre 1

solución: la densidad integra 1: ∫₀¹ ∫₀ˣ k·x dy dx = k∫₀¹ x² dx = k/3, así que k = 3. La marginal de Y integra x desde y hasta 1: f_Y(y) = ∫ᵧ¹ 3x dx = 1,5(1 − y²). Entonces P(Y ≤ 0,5) = ∫₀^0,5 1,5(1 − y²) dy = 1,5(0,5 − 0,125/3) = 0,6875. Con x de 0 a 1 saldría f_Y = 1,5 y 0,75; con la marginal de X (f_X = 3x²) saldría 0,125; con k = 1 saldría 0,2292.

### P18 · dificultad 2 · kc: conjunta-marginal · borrador · origen: ia (sonnet-5.5)
X es el número de fallas de la máquina A (0 o 1) y Y es el de la máquina B (0, 1 o 2) en un turno. Distribución conjunta: p(0,0) = 0,20, p(0,1) = 0,20, p(0,2) = 0,05, p(1,0) = 0,10, p(1,1) = 0,25 y p(1,2) = 0,20. Calcula P(X = 1 o Y = 2).

- A) 0,6625 · [conj-producto-de-marginales] restas P(X = 1)·P(Y = 2) en vez de la celda p(1,2), como si fueran independientes
- B) 0,50 · [conj-rango-incompleto] sumas las celdas del evento pero dejas fuera p(1,0)
- C) 0,20 · [conj-una-celda-como-marginal] tomas solo la celda p(1,2), que corresponde a X = 1 y Y = 2 a la vez
- D) 0,60 · CORRECTA

solución: las marginales salen de sumar filas y columnas: P(X = 1) = 0,10 + 0,25 + 0,20 = 0,55 y P(Y = 2) = 0,05 + 0,20 = 0,25. La celda p(1,2) = 0,20 está en los dos eventos, así que P(X = 1 o Y = 2) = 0,55 + 0,25 − 0,20 = 0,60. Restar el producto 0,55·0,25 da 0,6625; la celda sola da 0,20; y sin p(1,0) las celdas suman 0,50.

### P19 · dificultad 3 · kc: conjunta-marginal · borrador · origen: ia (sonnet-5.5)
Dos esfuerzos X e Y de una viga cumplen x ≥ 0, y ≥ 0 y x + y ≤ 1, con densidad conjunta f(x,y) = k(2x + y) en esa región y cero fuera. Calcula P(X > 0,5).

- A) 0,2500 · [conj-marginal-eje-equivocado] integras sobre x, obtienes la marginal de Y y calculas P(Y > 0,5)
- B) 0,3750 · CORRECTA
- C) 0,6667 · [conj-limites-fijos-en-triangulo] tomas y de 0 a 1 en lugar de 0 a 1 − x, tanto para hallar k como para la marginal
- D) 0,1875 · [conj-constante-sin-normalizar] dejas k = 1 sin imponer que la densidad integre 1

solución: primero k: ∫₀¹ ∫₀^(1−x) (2x + y) dy dx = ∫₀¹ (0,5 + x − 1,5x²) dx = 0,5, así que k = 2. La marginal de X integra y de 0 a 1 − x: f_X(x) = 2[2x(1 − x) + (1 − x)²/2] = 1 + 2x − 3x². Entonces P(X > 0,5) = ∫₀,₅¹ (1 + 2x − 3x²) dx = [x + x² − x³] de 0,5 a 1 = 1 − 0,625 = 0,375. La marginal de Y es 2(1 − y) y da 0,25; con límites de 0 a 1 para y se obtiene k = 2/3 y 0,6667; con k = 1 se obtiene 0,1875.

### P20 · dificultad 3 · kc: conjunta-marginal · borrador · origen: ia (sonnet-5.5)
X es el número de turnos extra (0, 1 o 2) y Y el número de entregas tardías (0, 1 o 2) en una semana. Distribución conjunta: p(0,0) = 0,12, p(0,1) = 0,08, p(0,2) = 0,02, p(1,0) = 0,10, p(1,2) = 0,10, p(2,0) = 0,03, p(2,1) = 0,12 y p(2,2) = 0,15. La celda p(1,1) no está escrita. Calcula P(X + Y = 2).

- A) 0,3648 · [conj-producto-de-marginales] sumas P(X = i)·P(Y = 2 − i), como si fueran independientes
- B) 0,28 · [conj-una-celda-como-marginal] tomas solo la celda p(1,1), la que había que calcular, como si fuera la probabilidad del evento
- C) 0,33 · CORRECTA
- D) 0,30 · [conj-rango-incompleto] sumas p(0,2) y p(1,1) y dejas fuera p(2,0)

solución: la tabla debe sumar 1; las ocho celdas dadas suman 0,72, así que p(1,1) = 0,28. El evento X + Y = 2 reúne las celdas (0,2), (1,1) y (2,0): 0,02 + 0,28 + 0,03 = 0,33. Con las marginales P(X) = (0,22; 0,48; 0,30) y P(Y) = (0,25; 0,48; 0,27), el producto 0,22·0,27 + 0,48·0,48 + 0,30·0,25 da 0,3648. La celda p(1,1) sola da 0,28 y sin p(2,0) quedan 0,30.

### P21 · dificultad 1 · kc: condicional-independencia · borrador · origen: ia (sonnet-5.5)
Un sensor tiene X = 1 si activa la alarma y X = 0 si no, y Y es el nivel de vibración (0 bajo, 1 medio, 2 alto). Distribución conjunta: p(0,0) = 0,12, p(0,1) = 0,18, p(0,2) = 0,10, p(1,0) = 0,08, p(1,1) = 0,32 y p(1,2) = 0,20. Si la vibración es media, ¿cuál es la probabilidad de que la alarma esté activa? Es decir, P(X = 1 | Y = 1).

- A) 0,64 · CORRECTA
- B) 0,32 · [cond-sin-dividir-marginal] usas la conjunta p(1,1) como si fuera la condicional y no divides entre P(Y = 1)
- C) 0,53 · [cond-al-reves] divides entre P(X = 1) y obtienes P(Y = 1 | X = 1)
- D) 0,60 · [cond-ignora-la-condicion] das P(X = 1) sin tener en cuenta que la vibración es media

solución: P(Y = 1) = 0,18 + 0,32 = 0,50, y P(X = 1 | Y = 1) = p(1,1) / P(Y = 1) = 0,32 / 0,50 = 0,64. Sin dividir queda 0,32; dividiendo entre P(X = 1) = 0,60 queda 0,53 (es la condicional contraria); y P(X = 1) = 0,60 ignora la información.

### P22 · dificultad 2 · kc: condicional-independencia · borrador · origen: ia (sonnet-5.5)
En un taller, X es el número de operarios ausentes (0, 1 o 2) y Y el número de órdenes retrasadas (0, 1 o 2). Distribución conjunta: p(0,0) = 0,05, p(0,1) = 0,10, p(0,2) = 0,05, p(1,0) = 0,05, p(1,1) = 0,20, p(1,2) = 0,15, p(2,0) = 0,15, p(2,1) = 0,10 y p(2,2) = 0,15. Calcula el número esperado de órdenes retrasadas cuando hay exactamente un operario ausente, E[Y | X = 1].

- A) 1,00 · [cond-al-reves] calculas E[X | Y = 1], condicionando en la variable contraria
- B) 1,10 · [cond-ignora-la-condicion] das E[Y], la media marginal, sin condicionar a X = 1
- C) 0,50 · [cond-sin-dividir-marginal] sumas y·p(1,y) y no divides entre P(X = 1)
- D) 1,25 · CORRECTA

solución: P(X = 1) = 0,05 + 0,20 + 0,15 = 0,40, así que P(Y = y | X = 1) = (0,125; 0,50; 0,375) para y = 0, 1, 2. Entonces E[Y | X = 1] = 0·0,125 + 1·0,50 + 2·0,375 = 1,25. Sin dividir entre 0,40 se obtiene 0,50; la media marginal E[Y] vale 1,10; y E[X | Y = 1] = (0·0,10 + 1·0,20 + 2·0,10) / 0,40 = 1,00.

### P23 · dificultad 2 · kc: condicional-independencia · borrador · origen: ia (sonnet-5.5)
Las tensiones X e Y (normalizadas) de dos cables de un puente tienen densidad conjunta f(x,y) = 2 − x − y para 0 ≤ x ≤ 1 y 0 ≤ y ≤ 1, y cero fuera. Sus marginales son f_X(x) = 1,5 − x y f_Y(y) = 1,5 − y. ¿Son independientes? Elige la justificación correcta.

- A) Sí son independientes: en el punto (0,5; 0,2) la densidad vale 1,3 y f_X(0,5)·f_Y(0,2) = 1·1,3 = 1,3 · [indep-igualdad-en-un-punto] verificas la igualdad en un solo punto y la tomas como prueba para todos los puntos
- B) No son independientes: en el punto (0,1; 0,2) la densidad vale 1,70, pero f_X(0,1)·f_Y(0,2) = 1,4·1,3 = 1,82 · CORRECTA
- C) No son independientes, porque la densidad f(x,y) = 2 − x − y es distinta de la marginal f_X(x) = 1,5 − x · [indep-compara-con-una-marginal] comparas la conjunta con una sola marginal, y esas dos casi nunca coinciden aunque haya independencia
- D) Sí son independientes, porque el soporte es un cuadrado · [indep-decide-por-la-forma] te basas en que la región es un rectángulo y no comparas la densidad con el producto de las marginales

solución: X y Y son independientes solo si f(x,y) = f_X(x)·f_Y(y) en todos los puntos del soporte. Basta un punto donde falle: en (0,1; 0,2), f = 1,70 y el producto de marginales es 1,4·1,3 = 1,82. La igualdad sí se cumple en (0,5; 0,2), pero un punto no prueba independencia. Comparar f con una sola marginal no sirve (siempre difieren), y el soporte rectangular es necesario pero no suficiente.

### P24 · dificultad 3 · kc: condicional-independencia · borrador · origen: ia (sonnet-5.5)
Un punto (X,Y) se reparte de manera uniforme en el triángulo 0 ≤ y ≤ x ≤ 1, con densidad f(x,y) = 2 dentro y cero fuera. Sus marginales son f_X(x) = 2x y f_Y(y) = 2(1 − y). ¿Son independientes? Elige la justificación correcta.

- A) Sí son independientes, porque la densidad constante f(x,y) = 2 se escribe como producto de una constante por otra · [indep-decide-por-la-forma] te basas en que la fórmula se factoriza y no revisas que la región no es un rectángulo
- B) Sí son independientes: en el punto (1; 0,5) la densidad vale 2 y f_X(1)·f_Y(0,5) = 2·1 = 2 · [indep-igualdad-en-un-punto] verificas la igualdad en un solo punto y la tomas como prueba para todos los puntos
- C) No son independientes: f(0,2; 0,6) = 0, pero f_X(0,2) = 0,4 y f_Y(0,6) = 0,8 son positivas · CORRECTA
- D) No son independientes, porque la densidad f(x,y) = 2 es distinta de la marginal f_X(x) = 2x · [indep-compara-con-una-marginal] comparas la conjunta con una sola marginal en vez de con el producto de las dos

solución: independencia exige f(x,y) = f_X(x)·f_Y(y) en todo punto. El punto (0,2; 0,6) queda fuera del triángulo (y > x), así que f = 0, mientras que f_X(0,2)·f_Y(0,6) = 0,4·0,8 = 0,32 ≠ 0. Que la fórmula sea constante no basta, porque el soporte triangular liga a x con y. La igualdad en (1; 0,5) es casual y comparar con una sola marginal no es la prueba.

### P25 · dificultad 3 · kc: condicional-independencia · borrador · origen: ia (sonnet-5.5)
Sean X el tiempo de secado e Y el tiempo de curado de una pieza (en horas, con 0 ≤ y ≤ x ≤ 1). Su densidad conjunta es f(x,y) = 2(x + y) dentro de esa región y cero fuera. Calcula el valor esperado condicional E[Y | X = 0,5], con tres decimales.

- A) 0,278 · CORRECTA
- B) 0,208 · [cond-sin-dividir-marginal] integras y·f(0,5; y) sin dividir entre la marginal f_X(0,5)
- C) 0,417 · [cond-ignora-la-condicion] das E[Y], la media marginal, sin condicionar a X = 0,5
- D) 0,767 · [cond-al-reves] calculas E[X | Y = 0,5], condicionando en la variable contraria

solución: la marginal es f_X(x) = ∫₀ˣ 2(x + y) dy = 3x², así que f(y | x) = 2(x + y) / (3x²) para 0 ≤ y ≤ x. Entonces E[Y | X = x] = ∫₀ˣ y·2(x + y)/(3x²) dy = 5x/9, y en x = 0,5 vale 5/18 ≈ 0,278. Sin dividir entre f_X(0,5) = 0,75 se obtiene 0,2083. La media marginal, con f_Y(y) = 1 + 2y − 3y², es E[Y] = 5/12 ≈ 0,417. Y E[X | Y = 0,5] = ∫ x·2(x + 0,5) dx de 0,5 a 1, dividido entre f_Y(0,5) = 1,25, vale 0,9583/1,25 ≈ 0,767.

### P26 · dificultad 1 · kc: covarianza-correlacion · borrador · origen: ia (sonnet-5.5)
Para dos tiempos de proceso X e Y (en minutos) se sabe que E[X] = 3, E[Y] = 5 y E[XY] = 16,5. ¿Cuánto vale Cov(X,Y)?

- A) 16,5 · [cov-exy-sin-restar-medias] das E[XY] como covarianza y no restas E[X]E[Y]
- B) 0 · [cov-g-en-las-medias] tomas E[XY] = E[X]E[Y] = 15 y la resta te da cero
- C) −1,5 · [cov-signo-mal] restas al revés: E[X]E[Y] − E[XY]
- D) 1,5 · CORRECTA

solución: Cov(X,Y) = E[XY] − E[X]E[Y] = 16,5 − 3·5 = 1,5. Dar E[XY] = 16,5 omite la resta; suponer E[XY] = E[X]E[Y] = 15 solo vale con independencia y daría cero; y restar al revés cambia el signo a −1,5.

### P27 · dificultad 2 · kc: covarianza-correlacion · borrador · origen: ia (sonnet-5.5)
Los pedidos semanales (en cientos) de dos productos son X (0 o 2) y Y (0, 2 o 4), con distribución conjunta p(0,0) = 0,20, p(0,2) = 0,15, p(0,4) = 0,05, p(2,0) = 0,10, p(2,2) = 0,25 y p(2,4) = 0,25. Calcula el coeficiente de correlación ρ entre X y Y, con tres decimales.

- A) −0,395 · [cov-signo-mal] restas al revés, E[X]E[Y] − E[XY], y la correlación sale con el signo cambiado
- B) 0,260 · [corr-divide-entre-varianzas] divides la covarianza entre el producto de las varianzas, 0,96·2,4, en vez de entre el de las desviaciones estándar
- C) 0,395 · CORRECTA
- D) 0,000 · [cov-g-en-las-medias] tomas E[XY] = E[X]E[Y] y la covarianza queda en cero

solución: P(X = 2) = 0,60, así que E[X] = 1,2 y E[X²] = 2,4, de donde Var(X) = 2,4 − 1,44 = 0,96. Para Y: P(Y = 0, 2, 4) = (0,30; 0,40; 0,30), E[Y] = 2,0, E[Y²] = 6,4 y Var(Y) = 6,4 − 4 = 2,4. E[XY] = 2·(2·0,25 + 4·0,25) = 3,0, y Cov = 3,0 − 1,2·2,0 = 0,6. Entonces ρ = 0,6 / √(0,96·2,4) = 0,6 / 1,518 ≈ 0,395. Con el producto de varianzas, 0,6/2,304 ≈ 0,260.

### P28 · dificultad 2 · kc: covarianza-correlacion · borrador · origen: ia (sonnet-5.5)
En una muestra de 2 piezas, X es el número de defectuosas, con P(X = 0) = 0,25, P(X = 1) = 0,50 y P(X = 2) = 0,25. Se define el costo de ajuste Y = (X − 1)². ¿Cuál afirmación sobre Cov(X,Y) es correcta?

- A) Cov(X,Y) = 0, así que X y Y son independientes · [cov-cero-implica-independencia] pasas de covarianza cero a independencia, cuando Y queda fijada por X
- B) Cov(X,Y) = 1,00, que indica una asociación positiva fuerte · [cov-signo-mal] sumas E[XY] y E[X]E[Y] en vez de restarlos
- C) Cov(X,Y) = 0,50, que indica una asociación positiva · [cov-exy-sin-restar-medias] das E[XY] = 0,50 como covarianza sin restar E[X]E[Y]
- D) Cov(X,Y) = 0, y aun así X y Y son dependientes porque Y queda fijada por X · CORRECTA

solución: Y toma el valor 1 cuando X = 0 o X = 2, y 0 cuando X = 1. Entonces E[X] = 1, E[Y] = 0,5 y E[XY] = 0·1·0,25 + 1·0·0,50 + 2·1·0,25 = 0,5, de modo que Cov(X,Y) = 0,5 − 1·0,5 = 0. Aun así Y es función de X, así que son dependientes: covarianza cero no implica independencia. Dar E[XY] = 0,50 omite la resta, y sumar da 1,00.

### P29 · dificultad 3 · kc: covarianza-correlacion · borrador · origen: ia (sonnet-5.5)
Dos señales X e Y tienen E[X] = 2, E[Y] = 3, Var(X) = 4, Var(Y) = 9 y correlación ρ = −0,5. Calcula E[(X − Y)²].

- A) 1 · [cov-g-en-las-medias] evalúas (E[X] − E[Y])² y olvidas la variabilidad de X − Y
- B) 8 · [cov-signo-mal] pones +2Cov en lugar de −2Cov al hallar Var(X − Y)
- C) 20 · CORRECTA
- D) 50 · [corr-divide-entre-varianzas] calculas Cov = ρ·Var(X)·Var(Y) = −18 en vez de ρ·σ_X·σ_Y

solución: Cov(X,Y) = ρ·σ_X·σ_Y = −0,5·2·3 = −3. Entonces Var(X − Y) = 4 + 9 − 2(−3) = 19 y E[X − Y] = −1, de modo que E[(X − Y)²] = Var(X − Y) + (E[X − Y])² = 19 + 1 = 20. Evaluar en las medias da 1; con +2Cov queda 7 + 1 = 8; y con Cov = −18 queda 49 + 1 = 50.

### P30 · dificultad 3 · kc: covarianza-correlacion · borrador · origen: ia (sonnet-5.5)
Dos magnitudes X e Y cumplen Cov(X,Y) = 0, Var(X) = 9 y Var(Y) = 4. Se definen U = X + Y y V = X − Y. ¿Cuánto vale la correlación entre U y V, con tres decimales?

- A) −0,385 · [cov-signo-mal] restas al revés en Cov(U,V) y obtienes Var(Y) − Var(X)
- B) 0,000 · [cov-cero-implica-independencia] como Cov(X,Y) = 0 crees que no hay relación entre las combinaciones U y V
- C) 0,030 · [corr-divide-entre-varianzas] divides Cov(U,V) entre Var(U)·Var(V) = 169 en vez de entre σ_U·σ_V
- D) 0,385 · CORRECTA

solución: Cov(U,V) = Var(X) − Var(Y) + Cov(Y,X) − Cov(X,Y) = 9 − 4 = 5. Como Cov(X,Y) = 0, Var(U) = Var(V) = 9 + 4 = 13. Entonces ρ_UV = 5 / √(13·13) = 5/13 ≈ 0,385. Con Var(U)·Var(V) = 169 saldría 0,030, y restando al revés −0,385. Que X y Y no estén correlacionadas no hace que U y V lo estén.
