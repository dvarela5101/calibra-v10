# Pruebas de hipótesis

Hipótesis nula y alterna, región crítica, errores de tipo I y II, potencia y p-valor; pruebas para medias, diferencias de medias, proporciones y varianzas, y la prueba chi-cuadrado de bondad de ajuste (sesiones 13 y 14 del programa 2026-2). Es del Parcial 2, semana 16. Errores a cazar: confundir los dos tipos de error, leer el p-valor como la probabilidad de que H₀ sea cierta y equivocarse en los grados de libertad.

## Habilidades
kc: ph-conceptos · Plantear las hipótesis y explicar la región crítica, los errores de tipo I y II, la potencia y el p-valor · prerrequisitos: inferencia
kc: ph-parametros · Ejecutar pruebas de hipótesis para medias, diferencias de medias, proporciones y varianzas con el estadístico, la región crítica o el p-valor · prerrequisitos: ph-conceptos, distribuciones-muestrales
kc: bondad-ajuste · Aplicar la prueba chi-cuadrado de bondad de ajuste: frecuencias esperadas, estadístico, grados de libertad y decisión · prerrequisitos: ph-conceptos, distribuciones-muestrales

## Errores
mc: inferencia-e4 · ph-conceptos · confundes rechazo con aceptación
mc: inferencia-e5 · ph-conceptos · interpretas mal el p-valor como probabilidad de la hipótesis
mc: inferencia-e6 · ph-conceptos · confundes p-valor con nivel de significancia
mc: ph-tipos-i-ii-intercambiados · ph-conceptos · confundes el error de tipo I con el de tipo II y das la probabilidad de uno como la del otro
mc: ph-potencia-como-error · ph-conceptos · tomas la potencia de la prueba como una probabilidad de error en vez de la probabilidad de rechazar una H₀ falsa
mc: ph-hipotesis-sobre-xbar · ph-conceptos · planteas las hipótesis sobre la media muestral x̄ en vez de sobre la media poblacional μ
mc: ph-igualdad-en-h1 · ph-conceptos · pones el signo igual en la hipótesis alterna y la desigualdad en la nula
mc: ph-error-estandar-sin-raiz-n · ph-parametros · al estandarizar x̄ divides entre σ (o entre σ/n) en vez de entre σ/√n
mc: ph-cola-contraria · ph-parametros · pones la región crítica o el área del p-valor en la cola contraria a la que indica H₁
mc: ph-compara-estadistico-con-alfa · ph-parametros · comparas el estadístico de prueba con α en vez de con el valor crítico o el p-valor con α
mc: ph-phat-en-error-estandar · ph-parametros · en la prueba de una proporción calculas el error estándar con p̂ en vez de con p₀
mc: ph-pvalor-sin-duplicar-bilateral · ph-parametros · en una prueba bilateral tomas el área de una sola cola como p-valor y no la duplicas
mc: ph-z-con-sigma-desconocida · ph-parametros · usas el cuantil de Z con la desviación muestral s cuando σ es desconocida y n es pequeño, en vez del de t
mc: ph-pareadas-como-independientes · ph-parametros · con datos pareados de las mismas unidades aplicas la prueba de dos muestras independientes en vez de trabajar con las diferencias
mc: ba-gl-con-n-menos-1 · bondad-ajuste · tomas el tamaño de la muestra menos 1 como grados de libertad en vez del número de categorías menos 1
mc: ba-no-resta-parametros-estimados · bondad-ajuste · no restas de los grados de libertad los parámetros que estimaste con los mismos datos
mc: ba-divide-entre-observado · bondad-ajuste · divides cada (O − E)² entre la frecuencia observada en vez de la esperada
mc: ba-sin-elevar-al-cuadrado · bondad-ajuste · usas |O − E| en lugar de (O − E)² y no elevas las diferencias al cuadrado
mc: ba-proporciones-sin-multiplicar-n · bondad-ajuste · usas las probabilidades del modelo como frecuencias esperadas sin multiplicarlas por n
mc: ba-rechazo-cola-izquierda · bondad-ajuste · rechazas H₀ cuando χ² cae en la cola izquierda, por debajo del cuantil inferior
mc: ba-no-agrupa-categorias · bondad-ajuste · dejas sin agrupar categorías cuya frecuencia esperada es menor que 5

## Preguntas

### P11 · dificultad 3 · kc: ph-conceptos · revisada · origen: humano · revisó: prototipo · ⚠ revisar
En una prueba de hipótesis, un p-valor de 0,03 con α = 0,05 indica que:

- A) Rechazas H₀ porque p-valor < α · CORRECTA
- B) Aceptas H₀ porque el p-valor es pequeño · [inferencia-e4]
- C) Hay 3% de probabilidad de que H₀ sea cierta · [inferencia-e5]
- D) El error tipo I es 3% · [inferencia-e6]

### P51 · dificultad 1 · kc: ph-conceptos · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Una llenadora debe entregar μ = 50 g. Se prueba H₀: μ = 50 frente a H₁: μ > 50 con la regla "rechazar H₀ si x̄ > 52", con n = 36 y σ = 6. Una muestra dio x̄ = 52,5 y, si la máquina se desajustara, la media real sería μ = 53. Usa P(Z > 1) = 0,1587, P(Z > 2) = 0,0228 y P(Z > 2,5) = 0,0062. ¿Cuál es la probabilidad de error de tipo I de esta regla?

- A) 0,1587 · [ph-tipos-i-ii-intercambiados] calculas la probabilidad de no rechazar cuando la media real es 53, que es el error de tipo II
- B) 0,0062 · [inferencia-e6] das el p-valor de la muestra observada como si fuera el nivel de significancia de la regla
- C) 0,0228 · CORRECTA
- D) 0,8413 · [ph-potencia-como-error] das la probabilidad de rechazar cuando la media real es 53, que es la potencia

solución: el error de tipo I es rechazar H₀ siendo cierta, así que se calcula con μ = 50. El error estándar es 6/√36 = 1, y rechazar significa x̄ > 52, o sea z = (52 − 50)/1 = 2. Entonces α = P(Z > 2) = 0,0228. El 0,1587 es β con μ = 53 (P(x̄ ≤ 52) = P(Z ≤ −1)); el 0,0062 es el p-valor de x̄ = 52,5; el 0,8413 es la potencia en μ = 53.

### P52 · dificultad 2 · kc: ph-conceptos · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Una ingeniera quiere comprobar si el diámetro medio de los tornillos de una línea se alejó del valor de diseño de 8,0 mm, en cualquier dirección. Mide 36 tornillos y obtiene x̄ = 8,05 mm. ¿Qué formulación y qué lectura del resultado son correctas?

- A) H₀: μ ≠ 8,0 frente a H₁: μ = 8,0; si no rechazas H₀, solo concluyes que no hay evidencia suficiente de que el diámetro medio se alejó de 8,0 · [ph-igualdad-en-h1] pones el signo igual en la alterna y la desigualdad en la nula
- B) H₀: μ = 8,0 frente a H₁: μ ≠ 8,0; si no rechazas H₀, solo concluyes que no hay evidencia suficiente de que el diámetro medio se alejó de 8,0 · CORRECTA
- C) H₀: x̄ = 8,0 frente a H₁: x̄ ≠ 8,0; si no rechazas H₀, solo concluyes que no hay evidencia suficiente de que el diámetro medio se alejó de 8,0 · [ph-hipotesis-sobre-xbar] formulas la hipótesis sobre la media de la muestra, que ya conoces, y no sobre la media de la población
- D) H₀: μ = 8,0 frente a H₁: μ ≠ 8,0; si no rechazas H₀, queda demostrado que el diámetro medio es exactamente 8,0 · [inferencia-e4] crees que no rechazar H₀ equivale a probar que es cierta

solución: las hipótesis se plantean sobre el parámetro poblacional μ, no sobre x̄, que es un dato de la muestra. La nula lleva la igualdad (μ = 8,0) y la alterna es la afirmación que se quiere respaldar; como se busca cualquier desvío, es bilateral (μ ≠ 8,0). No rechazar H₀ significa que la muestra no aporta evidencia suficiente en su contra, no que H₀ esté demostrada.

### P53 · dificultad 2 · kc: ph-conceptos · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Una planta de moldeo prueba H₀: μ = 80 frente a H₁: μ > 80, donde μ es la resistencia media (en MPa) de un nuevo lote de piezas. Se conoce σ = 6, se toman n = 36 piezas y se usa α = 0,05 (z₀,₀₅ = 1,645). La muestra dio x̄ = 81,0. Si la resistencia media real fuera μ = 83, ¿cuánto vale β? Redondea a dos decimales.

- A) 0,91 · [ph-potencia-como-error] das la probabilidad de rechazar cuando μ = 83, que es la potencia y no β
- B) 0,05 · [ph-tipos-i-ii-intercambiados] das α, que es la probabilidad del error de tipo I
- C) 0,16 · [inferencia-e6] das el p-valor de la muestra observada como si fuera la probabilidad del error
- D) 0,09 · CORRECTA

solución: el error estándar es 6/√36 = 1. Con α = 0,05 se rechaza H₀ si x̄ > 80 + 1,645·1 = 81,645. β es la probabilidad de no rechazar cuando μ = 83: β = P(x̄ ≤ 81,645 | μ = 83) = P(Z ≤ (81,645 − 83)/1) = P(Z ≤ −1,355) ≈ 0,09. La potencia es 1 − β ≈ 0,91; el 0,05 es α; el 0,16 es el p-valor de x̄ = 81,0, P(Z > 1,0).

### P54 · dificultad 3 · kc: ph-conceptos · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Un proveedor asegura que el tiempo medio de respuesta de su servidor es de a lo sumo 2,0 s. Sospechas que es mayor. Con 25 mediciones obtienes x̄ = 2,3 s y un p-valor de 0,03. ¿Cuál formulación y lectura son correctas?

- A) H₀: μ = 2,0 frente a H₁: μ > 2,0; concluir que es mayor cuando en realidad no lo es sería un error de tipo I, y el p-valor 0,03 es la probabilidad de un resultado tan extremo como el observado si H₀ es cierta · CORRECTA
- B) H₀: x̄ = 2,0 frente a H₁: x̄ > 2,0; concluir que es mayor cuando en realidad no lo es sería un error de tipo I, y el p-valor 0,03 es la probabilidad de un resultado tan extremo como el observado si H₀ es cierta · [ph-hipotesis-sobre-xbar] formulas las hipótesis con la media de la muestra en lugar de la media poblacional
- C) H₀: μ > 2,0 frente a H₁: μ = 2,0; concluir que es mayor cuando en realidad no lo es sería un error de tipo I, y el p-valor 0,03 es la probabilidad de un resultado tan extremo como el observado si H₀ es cierta · [ph-igualdad-en-h1] dejas la igualdad en la alterna, cuando la nula es la que lleva el signo igual
- D) H₀: μ = 2,0 frente a H₁: μ > 2,0; concluir que es mayor cuando en realidad no lo es sería un error de tipo I, y el p-valor 0,03 significa que hay 3% de probabilidad de que H₀ sea cierta · [inferencia-e5] lees el p-valor como la probabilidad de que la hipótesis nula sea verdadera

solución: el parámetro es μ y la nula lleva la igualdad (se puede escribir μ = 2,0 o μ ≤ 2,0); la alterna recoge la sospecha, μ > 2,0. Declarar "mayor" cuando en realidad no lo es significa rechazar una H₀ verdadera: error de tipo I, de probabilidad α. El p-valor es la probabilidad, calculada suponiendo H₀ cierta, de obtener un resultado al menos tan extremo como el observado; no es la probabilidad de que H₀ sea cierta.

### P55 · dificultad 1 · kc: ph-parametros · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Un taller quiere saber si una herramienta nueva reduce el tiempo de ensamble, que hoy tiene media de 120 s. Se prueba H₀: μ = 120 frente a H₁: μ < 120, con σ = 15 s conocida, n = 25 piezas, x̄ = 116,4 s y α = 0,05 (z₀,₀₅ = 1,645). Usa P(Z < −1,20) = 0,1151. ¿Cuál es el estadístico, el p-valor y la conclusión?

- A) z = −1,20, p-valor = 0,12: rechazas H₀ porque −1,20 es menor que α = 0,05 · [ph-compara-estadistico-con-alfa] comparas el estadístico con α, cuando hay que compararlo con el valor crítico o comparar el p-valor con α
- B) z = −6,00, p-valor ≈ 0,00: rechazas H₀ · [ph-error-estandar-sin-raiz-n] divides entre σ/n = 0,6 en vez de entre σ/√n = 3
- C) z = −1,20, p-valor = 0,88: no rechazas H₀ · [ph-cola-contraria] tomas el área de la cola derecha, que es la contraria a la de H₁
- D) z = −1,20, p-valor = 0,12: no rechazas H₀ porque el p-valor supera α · CORRECTA

solución: el error estándar es σ/√n = 15/5 = 3, así que z = (116,4 − 120)/3 = −1,20. Como H₁ es μ < 120, el p-valor es el área a la izquierda: P(Z < −1,20) = 0,1151 ≈ 0,12. Como 0,12 > 0,05, no se rechaza H₀. Equivalente: −1,20 no está por debajo de −1,645.

### P56 · dificultad 2 · kc: ph-parametros · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
El estándar de una línea de empaque admite 10% de piezas defectuosas. En una muestra de 200 piezas aparecen 28 defectuosas. Se prueba H₀: p = 0,10 frente a H₁: p ≠ 0,10 con α = 0,05. Usa P(Z > 1,89) = 0,0294 y P(Z > 1,63) = 0,0516. ¿Cuál es el estadístico, el p-valor y la conclusión?

- A) z = 1,89, p-valor = 0,03: rechazas H₀ · [ph-pvalor-sin-duplicar-bilateral] tomas el área de una sola cola como p-valor aunque la prueba es bilateral
- B) z = 1,89, p-valor = 0,06: no rechazas H₀ · CORRECTA
- C) z = 1,63, p-valor = 0,10: no rechazas H₀ · [ph-phat-en-error-estandar] calculas el error estándar con p̂ = 0,14 en lugar de con p₀ = 0,10
- D) z = 1,89, p-valor = 0,06: rechazas H₀ porque 1,89 es mayor que α = 0,05 · [ph-compara-estadistico-con-alfa] comparas el estadístico con α en vez de comparar el p-valor con α

solución: p̂ = 28/200 = 0,14. Bajo H₀ el error estándar usa p₀: √(0,10·0,90/200) = 0,02121, así que z = (0,14 − 0,10)/0,02121 = 1,89. La prueba es bilateral: p-valor = 2·P(Z > 1,89) = 2·0,0294 = 0,0588 ≈ 0,06. Como 0,06 > 0,05, no se rechaza H₀. Con p̂ en el error estándar saldría z = 1,63 (p-valor 0,10); con una sola cola, 0,03.

### P57 · dificultad 2 · kc: ph-parametros · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Se midió el tiempo de montaje de 8 operarios antes y después de una capacitación, siempre los mismos 8. Con las diferencias (antes − después) se obtuvo d̄ = 0,60 min y s_d = 0,80 min; las desviaciones de los tiempos antes y después, por separado, son 1,9 y 2,1 min. Se prueba H₀: μ_D = 0 frente a H₁: μ_D ≠ 0 con α = 0,05. Valores: t₀,₀₂₅ = 2,365 con 7 g.l., t₀,₀₂₅ = 2,145 con 14 g.l. y z₀,₀₂₅ = 1,96. ¿Cuál es el procedimiento correcto y su conclusión?

- A) t = 2,12 con 7 g.l.; |t| < 2,365, no rechazas H₀ · CORRECTA
- B) t = 0,60 con 14 g.l.; |t| < 2,145, no rechazas H₀ · [ph-pareadas-como-independientes] tratas los tiempos antes y después como dos muestras independientes, aunque son los mismos operarios
- C) z = 2,12; |z| > 1,96, rechazas H₀ · [ph-z-con-sigma-desconocida] usas el cuantil de Z con s_d y n = 8, cuando σ es desconocida y la muestra es pequeña
- D) t = 0,75 con 7 g.l.; |t| < 2,365, no rechazas H₀ · [ph-error-estandar-sin-raiz-n] divides entre s_d en vez de entre s_d/√n

solución: los datos son pareados, así que se trabaja con las diferencias: n = 8, g.l. = 7. El error estándar es 0,80/√8 = 0,2828, y t = 0,60/0,2828 = 2,12. Como σ es desconocida y n es pequeño se usa t con 7 g.l.: |2,12| < 2,365, no se rechaza H₀. Con z (1,96) se rechazaría por error; tratándolos como independientes, el error estándar sería √((1,9² + 2,1²)/8) = 1,0 y t = 0,60.

### P58 · dificultad 3 · kc: ph-parametros · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
En un sondeo a 150 usuarios, 48 prefieren la versión nueva de una aplicación. La meta es p = 0,40. Se prueba H₀: p = 0,40 frente a H₁: p ≠ 0,40 con α = 0,04. Usa P(Z < −2,00) = 0,0228 y P(Z < −2,10) = 0,0179. ¿Cuál es el estadístico, el p-valor y la conclusión?

- A) z = −2,10, p-valor = 0,0357: rechazas H₀ porque 0,0357 < 0,04 · [ph-phat-en-error-estandar] calculas el error estándar con p̂ = 0,32 en lugar de con p₀ = 0,40
- B) z = −2,00, p-valor = 0,0228: rechazas H₀ porque 0,0228 < 0,04 · [ph-pvalor-sin-duplicar-bilateral] tomas el área de una sola cola como p-valor aunque la prueba es bilateral
- C) z = −2,00, p-valor = 0,0455: no rechazas H₀ porque 0,0455 > 0,04 · CORRECTA
- D) z = −2,00, p-valor = 0,9772: no rechazas H₀ · [ph-cola-contraria] tomas el área de la cola derecha en vez de la de la izquierda, donde cayó el estadístico

solución: p̂ = 48/150 = 0,32. Bajo H₀, el error estándar es √(0,40·0,60/150) = 0,04, así que z = (0,32 − 0,40)/0,04 = −2,00. El estadístico cayó en la cola izquierda, con área 0,0228; como la prueba es bilateral se duplica: p-valor = 0,0455. Como 0,0455 > 0,04, no se rechaza H₀. Con p̂ = 0,32 en el error estándar saldría z = −2,10 y p-valor 0,0357, que sí rechazaría.

### P59 · dificultad 3 · kc: ph-parametros · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Para 8 máquinas se midió el desperdicio de material (kg por turno) antes y después de un ajuste, siempre las mismas 8 máquinas. Con las diferencias (antes − después): d̄ = 0,48 y s_d = 0,80; las desviaciones de antes y después, por separado, son 1,9 y 2,1. Se prueba H₀: μ_D = 0 frente a H₁: μ_D > 0 con α = 0,05. Datos de tabla: P(T > 1,70) = 0,0667 con 7 g.l.; P(T > 0,48) = 0,3195 con 14 g.l.; P(Z > 1,70) = 0,0448. ¿Cuál es el estadístico, el p-valor y la conclusión?

- A) t = 1,70 con 7 g.l., p-valor = 0,9333: no rechazas H₀ · [ph-cola-contraria] tomas el área de la cola izquierda, que es la contraria a la de H₁
- B) t = 1,70 con 7 g.l., p-valor = 0,0667: no rechazas H₀ · CORRECTA
- C) z = 1,70, p-valor = 0,0448: rechazas H₀ · [ph-z-con-sigma-desconocida] usas la normal con s_d y n = 8, cuando σ es desconocida y la muestra es pequeña
- D) t = 0,48 con 14 g.l., p-valor = 0,3195: no rechazas H₀ · [ph-pareadas-como-independientes] trabajas con las dos muestras como si fueran independientes, aunque son las mismas máquinas

solución: son datos pareados, así que se usan las diferencias: n = 8, g.l. = 7, error estándar 0,80/√8 = 0,2828 y t = 0,48/0,2828 = 1,70. H₁ es μ_D > 0, así que el p-valor es el área a la derecha: P(T > 1,70) = 0,0667 > 0,05, no se rechaza H₀. Con la normal el p-valor sería 0,0448 y se rechazaría por error; con la cola izquierda saldría 0,9333; tratando las muestras como independientes saldría t = 0,48 con 14 g.l.

### P60 · dificultad 1 · kc: bondad-ajuste · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Una planta registró 100 paros de máquina en una semana, repartidos de lunes a viernes así: 24, 18, 15, 20 y 23. Se prueba H₀: los paros se reparten por igual entre los 5 días. ¿Cuál es el valor del estadístico χ² y cuántos grados de libertad tiene?

- A) χ² = 2,95 con 4 g.l. · [ba-divide-entre-observado] divides cada (O − E)² entre la frecuencia observada y no entre la esperada
- B) χ² = 2,70 con 99 g.l. · [ba-gl-con-n-menos-1] tomas n − 1 = 99 como grados de libertad, en vez de categorías − 1
- C) χ² = 2,70 con 4 g.l. · CORRECTA
- D) χ² = 0,70 con 4 g.l. · [ba-sin-elevar-al-cuadrado] sumas |O − E|/E sin elevar la diferencia al cuadrado

solución: bajo H₀ cada día espera 100/5 = 20 paros. χ² = (24−20)²/20 + (18−20)²/20 + (15−20)²/20 + (20−20)²/20 + (23−20)²/20 = (16 + 4 + 25 + 0 + 9)/20 = 54/20 = 2,70. Hay 5 categorías, así que g.l. = 5 − 1 = 4.

### P61 · dificultad 2 · kc: bondad-ajuste · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Una línea de pintura clasifica el acabado de las piezas en 4 categorías que, según el proveedor, ocurren con proporciones 40%, 30%, 20% y 10%. En 200 piezas se observaron 100, 50, 30 y 20. Se prueba el ajuste con α = 0,05. Valores: χ²₀,₀₅ = 7,815 y χ²₀,₉₅ = 0,352, ambos con 3 g.l. ¿Cuál es el estadístico y la decisión?

- A) χ² = 9,17: no cae por debajo de 0,352, no rechazas H₀ · [ba-rechazo-cola-izquierda] rechazas solo si χ² es muy pequeño, en la cola izquierda
- B) χ² = 0,67: es menor que 7,815, no rechazas H₀ · [ba-sin-elevar-al-cuadrado] sumas |O − E|/E sin elevar al cuadrado
- C) χ² = 9,33: supera 7,815, rechazas H₀ · [ba-divide-entre-observado] divides entre la frecuencia observada y no entre la esperada
- D) χ² = 9,17: supera 7,815, rechazas H₀ · CORRECTA

solución: multiplicando 200 por cada proporción salen los esperados 80, 60, 40 y 20. Sumando (O − E)²/E por categoría: 400/80 + 100/60 + 100/40 + 0/20 = 5 + 1,667 + 2,5 + 0 = 9,17. Son 4 categorías sin parámetros estimados, así que hay 3 g.l., y esta prueba rechaza solo por la derecha, cuando χ² > 7,815. Como 9,17 > 7,815, se rechaza H₀.

### P62 · dificultad 2 · kc: bondad-ajuste · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
Un fabricante afirma que sus fallas se reparten 50% eléctricas, 30% mecánicas y 20% de software. En 80 fallas se observaron 36 eléctricas, 30 mecánicas y 14 de software. Se prueba el ajuste con α = 0,05 y χ²₀,₀₅ = 5,991 con 2 g.l. ¿Cuál es el estadístico, los grados de libertad y la decisión?

- A) χ² = 6413 con 2 g.l.: rechazas H₀ · [ba-proporciones-sin-multiplicar-n] usas 0,5, 0,3 y 0,2 como frecuencias esperadas, sin multiplicarlas por n = 80
- B) χ² = 2,15 con 2 g.l.: no rechazas H₀ · CORRECTA
- C) χ² = 2,15 con 79 g.l.: no rechazas H₀ · [ba-gl-con-n-menos-1] tomas n − 1 = 79 como grados de libertad, en vez de categorías − 1
- D) χ² = 1,93 con 2 g.l.: no rechazas H₀ · [ba-divide-entre-observado] divides cada (O − E)² entre la frecuencia observada y no entre la esperada

solución: las frecuencias esperadas son 80·(0,5; 0,3; 0,2) = 40, 24 y 16. χ² = (36−40)²/40 + (30−24)²/24 + (14−16)²/16 = 0,40 + 1,50 + 0,25 = 2,15, con 3 − 1 = 2 g.l. Como 2,15 < 5,991, no se rechaza H₀.

### P63 · dificultad 3 · kc: bondad-ajuste · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
En 100 días se contó el número de caídas de un servidor por día: 0 caídas en 18 días, 1 en 45, 2 en 26, 3 en 6 y 4 o más en 5 (esos 5 días tuvieron exactamente 4). El total fue de 135 caídas, así que se estimó λ̂ = 1,35 por día y se ajustó una Poisson. Con λ̂ = 1,35: P(0) = 0,2592, P(1) = 0,3500, P(2) = 0,2362, P(3) = 0,1063 y P(≥4) = 0,0482. Valores con α = 0,05: χ²₀,₀₅ = 5,991 (2 g.l.) y 7,815 (3 g.l.); χ²₀,₉₅ = 0,103 (2 g.l.). ¿Cuál es el procedimiento correcto y su decisión?

- A) χ² = 6,80 con 2 g.l.: cae por encima de 0,103, no rechazas H₀ · [ba-rechazo-cola-izquierda] rechazas solo si χ² es muy pequeño, en la cola izquierda
- B) χ² = 6,80 con 3 g.l.: no supera 7,815, no rechazas H₀ · [ba-no-resta-parametros-estimados] no restas el parámetro λ estimado de los grados de libertad
- C) χ² = 7,54 con 3 g.l.: no supera 7,815, no rechazas H₀ · [ba-no-agrupa-categorias] dejas la categoría "4 o más", con esperado 4,82, sin agrupar con la anterior
- D) χ² = 6,80 con 2 g.l.: supera 5,991, rechazas H₀ · CORRECTA

solución: las esperadas con n = 100 son 25,92; 35,00; 23,62; 10,63 y 4,82. La última es menor que 5, así que se agrupa "3" y "4 o más": esperado 15,45 y observado 11. Quedan 4 categorías: χ² = (18−25,92)²/25,92 + (45−35)²/35 + (26−23,62)²/23,62 + (11−15,45)²/15,45 = 2,42 + 2,86 + 0,24 + 1,28 = 6,80. Los g.l. son 4 − 1 − 1 = 2 (se estimó λ). Como 6,80 > 5,991, se rechaza H₀. Sin restar el parámetro (3 g.l.) o sin agrupar (χ² = 7,54 con 3 g.l.) no se rechazaría.

### P64 · dificultad 3 · kc: bondad-ajuste · revisada · origen: ia (sonnet-5.5) · revisó: dvarela5101
De 200 lotes de 4 piezas se contó cuántas son defectuosas: 0 en 71 lotes, 1 en 70, 2 en 50, 3 en 6 y 4 en 3. Hubo 200 piezas defectuosas de 800, así que se estimó p̂ = 0,25 y se ajustó una binomial(4; 0,25), con P(0) = 0,3164, P(1) = 0,4219, P(2) = 0,2109, P(3) = 0,0469 y P(4) = 0,0039. Valores con α = 0,05: χ²₀,₀₅ = 5,991 (2 g.l.) y 7,815 (3 g.l.). ¿Cuál es el procedimiento correcto y su decisión?

- A) χ² = 12,35 con 3 g.l.: supera 7,815, rechazas H₀ · [ba-no-agrupa-categorias] dejas la categoría 4, con esperado 0,78, sin agrupar con la 3
- B) χ² = 4,97 con 3 g.l.: no supera 7,815, no rechazas H₀ · [ba-no-resta-parametros-estimados] no restas el parámetro p estimado de los grados de libertad
- C) χ² = 40595 con 2 g.l.: rechazas H₀ · [ba-proporciones-sin-multiplicar-n] usas las probabilidades de la binomial como frecuencias esperadas, sin multiplicarlas por n = 200
- D) χ² = 4,97 con 2 g.l.: no supera 5,991, no rechazas H₀ · CORRECTA

solución: las esperadas con n = 200 son 63,28; 84,38; 42,19; 9,38 y 0,78. Las dos últimas se agrupan ("3 o 4"): esperado 10,16 y observado 9. Quedan 4 categorías: χ² = (71−63,28)²/63,28 + (70−84,38)²/84,38 + (50−42,19)²/42,19 + (9−10,16)²/10,16 = 0,94 + 2,45 + 1,45 + 0,13 = 4,97. Los g.l. son 4 − 1 − 1 = 2 (se estimó p). Como 4,97 < 5,991, no se rechaza H₀. Sin agrupar sale χ² = 12,35; sin restar el parámetro, 3 g.l.
